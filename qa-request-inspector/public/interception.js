// Fetch-domain interception for background.js: mock, patch, delay and block rules and breakpoints.
// Stateless module: background.js passes its maps in (the integration test re-imports background.js
// to simulate a service worker restart, while this module stays cached).

import { nextMockResponse } from "./mockSequence.js";
import {
  applyJsonPatches,
  decodeText,
  encodeBase64,
  headerEntries,
  headersFromEntries,
  resourceKind,
} from "./captureStore.js";

const BREAKPOINT_TIMEOUT_MS = 5 * 60 * 1000; // a paused request is released by itself after this
const MAX_RESPONSE_BODY_SIZE = 5 * 1024 * 1024; // 5MB
const scoped = (tabId, id) => `${tabId}:${id}`;

function matchUrlPattern(url, pattern) {
  if (pattern.includes("*")) {
    const regex = new RegExp(
      "^" +
        pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
        "$",
    );
    return regex.test(url);
  }
  return url.includes(pattern);
}

function matchRule(rules, url, method, accept = () => true) {
  return rules.find((rule) => {
    if (!rule.enabled || !accept(rule)) return false;
    if (rule.method && rule.method !== "ALL" && rule.method !== method) return false;
    return matchUrlPattern(url, rule.urlPattern);
  });
}

function toCdpPattern(pattern) {
  // Wrap non-wildcard patterns with * to preserve substring matching semantics
  if (!pattern.includes("*")) {
    return `*${pattern}*`;
  }
  return pattern;
}

/**
 * @param {object} ctx
 * @param {Map} ctx.debuggerState tabId -> CDP state
 * @param {Map} ctx.pendingRequests "tabId:requestId" -> request being captured
 * @param {Set} ctx.mockedNetworkIds requests reported by this module (skipped by the Network handler)
 * @param {Map} ctx.pausedRequests "tabId:fetchRequestId" -> paused request
 * @param {Map} ctx.mockSequenceIndexes "tabId:ruleId" -> next index of a status sequence
 * @param {() => Promise<{mockRules: any[], breakpointRules: any[]}>} ctx.getRules
 * @param {(tabId: number, request: object) => void} ctx.emitRequest
 * @param {(tabId: number, message: object) => void} ctx.notifyTab
 */
export function createInterception(ctx) {
  const { debuggerState, pendingRequests, mockedNetworkIds, pausedRequests, mockSequenceIndexes, getRules, emitRequest, notifyTab } = ctx;

  async function continueRequest(tabId, requestId, overrides) {
    try {
      await chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", { requestId, ...overrides });
    } catch (e) {}
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ruleDelay = (rule) => Math.min(30000, Math.max(0, Number(rule.delay) || 0));

  function parseJsonOrText(text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * Reports a request whose response was replaced by the extension (edited at a breakpoint or patched
   * by a rule). The Network domain reports the same request too, so it is marked to be skipped there.
   */
  function emitModifiedResponse(tabId, state, params, response) {
    const networkKey = params.networkId ? scoped(tabId, params.networkId) : null;
    const pending = networkKey ? pendingRequests.get(networkKey) : null;
    if (networkKey) mockedNetworkIds.add(networkKey);

    const timestamp = pending?.timestamp || Date.now();
    emitRequest(tabId, {
      id: pending?.id || crypto.randomUUID(),
      type: pending?.type || resourceKind(params.resourceType) || "fetch",
      method: params.request.method,
      url: params.request.url,
      requestHeaders: pending?.requestHeaders || params.request.headers || {},
      requestBody: pending?.requestBody ?? params.request.postData ?? null,
      status: response.status,
      statusText: response.statusText,
      responseHeaders: response.headers,
      responseBody: response.body,
      duration: Math.max(0, Date.now() - timestamp),
      timestamp,
      error: null,
      pageUrl: state.pageUrl || "",
      pageTitle: state.pageTitle || "",
      modified: true,
    });
  }

  /** Headers of a response that gets a new body: the old length and encoding no longer apply. */
  function headersForNewBody(entries) {
    return (entries || []).filter(
      ({ name }) => !["content-length", "content-encoding", "transfer-encoding"].includes(name.toLowerCase()),
    );
  }

  async function pauseAtBreakpoint(tabId, params, stage) {
    const pausedKey = scoped(tabId, params.requestId);
    const message = {
      type: "BREAKPOINT_REQUEST_PAUSED",
      requestId: params.requestId,
      tabId,
      stage,
      request: {
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers || {},
        postData: params.request.postData ?? null,
      },
    };

    if (stage === "response") {
      let body = "";
      let binary = false;
      try {
        const result = await chrome.debugger.sendCommand({ tabId }, "Fetch.getResponseBody", {
          requestId: params.requestId,
        });
        ({ text: body, binary } = decodeText(result.body, result.base64Encoded));
      } catch (e) {
        // Redirects and empty responses have no body.
      }
      message.response = {
        status: params.responseStatusCode,
        headers: headersFromEntries(params.responseHeaders),
        body: binary ? "" : body.slice(0, MAX_RESPONSE_BODY_SIZE),
        binary,
      };
    }

    const timeoutId = setTimeout(async () => {
      // Nobody answered: let the request go, so the page does not hang forever.
      pausedRequests.delete(pausedKey);
      await continueRequest(tabId, params.requestId);
      notifyTab(tabId, { type: "BREAKPOINT_REQUEST_EXPIRED", requestId: params.requestId, tabId });
    }, BREAKPOINT_TIMEOUT_MS);

    pausedRequests.set(pausedKey, { tabId, requestId: params.requestId, timeout: timeoutId, stage, params });
    notifyTab(tabId, message);
  }

  /** Answers the side panel's decision about a paused request. */
  async function resumePausedRequest(paused, action, overrides) {
    const { tabId, requestId, params, stage } = paused;

    if (action !== "continue") {
      await chrome.debugger
        .sendCommand({ tabId }, "Fetch.failRequest", { requestId, errorReason: "BlockedByClient" })
        .catch(() => {});
      return;
    }
    if (!overrides) {
      await continueRequest(tabId, requestId);
      return;
    }

    if (stage === "response") {
      const status = Number(overrides.status) || params.responseStatusCode || 200;
      const headers = overrides.headers
        ? headerEntries(overrides.headers)
        : headersForNewBody(params.responseHeaders);
      const body = overrides.body ?? "";
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
          requestId,
          responseCode: status,
          responseHeaders: headersForNewBody(headers),
          body: encodeBase64(body),
        });
      } catch (e) {
        await continueRequest(tabId, requestId);
        return;
      }
      const state = debuggerState.get(tabId);
      if (state) {
        emitModifiedResponse(tabId, state, params, {
          status,
          statusText: "Изменён вручную",
          headers: headersFromEntries(headers),
          body: parseJsonOrText(body),
        });
      }
      return;
    }

    // Request stage: send the edited request instead of the original one.
    const changes = {};
    if (overrides.url && overrides.url !== params.request.url) changes.url = overrides.url;
    if (overrides.method && overrides.method !== params.request.method) changes.method = overrides.method;
    if (overrides.headers) changes.headers = headerEntries(overrides.headers);
    if (overrides.postData != null) changes.postData = encodeBase64(overrides.postData);

    // The list shows what was really sent.
    const pending = params.networkId ? pendingRequests.get(scoped(tabId, params.networkId)) : null;
    if (pending) {
      if (changes.url) pending.url = overrides.url;
      if (changes.method) pending.method = overrides.method;
      if (overrides.headers) pending.requestHeaders = overrides.headers;
      if (overrides.postData != null) pending.requestBody = overrides.postData;
      pending.modified = true;
    }
    await continueRequest(tabId, requestId, changes);
  }

  /** A "patch" rule: the real response with a few JSON fields changed. */
  async function patchResponse(tabId, state, params, rule) {
    let patched;
    try {
      const result = await chrome.debugger.sendCommand({ tabId }, "Fetch.getResponseBody", {
        requestId: params.requestId,
      });
      const { text, binary } = decodeText(result.body, result.base64Encoded);
      if (binary) throw new Error("binary body");
      patched = applyJsonPatches(JSON.parse(text), rule.patches);
    } catch (e) {
      // Not JSON, no body, or a redirect: leave the response as it is.
      await continueRequest(tabId, params.requestId);
      return;
    }

    if (rule.delay) await sleep(ruleDelay(rule));

    const status = Number(rule.patchStatus) || params.responseStatusCode || 200;
    const headers = headersForNewBody(params.responseHeaders);
    try {
      await chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: status,
        responseHeaders: headers,
        body: encodeBase64(JSON.stringify(patched)),
      });
    } catch (e) {
      await continueRequest(tabId, params.requestId);
      return;
    }

    emitModifiedResponse(tabId, state, params, {
      status,
      statusText: "Изменён правилом",
      headers: headersFromEntries(headers),
      body: patched,
    });
  }

  const ruleMode = (rule) => rule.mode || "mock"; // mock | patch | delay | block
  const breakpointStage = (rule) => (rule.stage === "response" ? "response" : "request");

  async function handleRequestPaused(tabId, state, params) {
    const url = params.request.url;
    const reqMethod = params.request.method;
    const { mockRules, breakpointRules } = await getRules();
    // The same request is paused twice when rules ask for both stages: before sending and with the response.
    const stage =
      params.responseStatusCode !== undefined || params.responseErrorReason !== undefined
        ? "response"
        : "request";

    // Check breakpoints first (preserving current behavior)
    if (
      !params.responseErrorReason &&
      matchRule(breakpointRules, url, reqMethod, (rule) => breakpointStage(rule) === stage)
    ) {
      await pauseAtBreakpoint(tabId, params, stage);
      return; // Don't continue or fulfill yet
    }

    if (stage === "response") {
      const patchRule = params.responseErrorReason
        ? null
        : matchRule(mockRules, url, reqMethod, (rule) => ruleMode(rule) === "patch");
      if (patchRule) await patchResponse(tabId, state, params, patchRule);
      else await continueRequest(tabId, params.requestId);
      return;
    }

    // Check mocks second
    let matchedMock = matchRule(mockRules, url, reqMethod, (rule) => ruleMode(rule) !== "patch");

    if (matchedMock && ruleMode(matchedMock) === "block") {
      // Reported by the Network domain as a failed request (net::ERR_BLOCKED_BY_CLIENT).
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.failRequest", {
          requestId: params.requestId,
          errorReason: "BlockedByClient",
        });
      } catch (e) {}
      return;
    }

    if (matchedMock && ruleMode(matchedMock) === "delay") {
      // The real request, later.
      await sleep(ruleDelay(matchedMock));
      await continueRequest(tabId, params.requestId);
      return;
    }

    if (matchedMock?.sequence?.length) {
      const key = scoped(tabId, matchedMock.id);
      const next = nextMockResponse(matchedMock, mockSequenceIndexes.get(key) || 0);
      mockSequenceIndexes.set(key, next.index);
      matchedMock = next.response; // null: the sequence is over, pass through to the server
    }

    if (!matchedMock) {
      await continueRequest(tabId, params.requestId);
      return;
    }

    const startedAt = Date.now();
    if (matchedMock.delay) await sleep(ruleDelay(matchedMock));

    // Track networkId for dedup with Network domain
    if (params.networkId) {
      mockedNetworkIds.add(scoped(tabId, params.networkId));
    }

    if (matchedMock.abort) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.failRequest", {
          requestId: params.requestId,
          errorReason: "TimedOut",
        });
      } catch (e) {}
      return;
    }

    // Build response headers.
    // A mock made from a captured request carries its real headers. Content-Encoding/Content-Length
    // describe the server's compressed body, not this one (the browser would fail to decode it), and
    // CDP rejects a value with line breaks (several Set-Cookie are joined with "\n"): one entry per line.
    const mockHeaders = matchedMock.responseHeaders || {};
    const headers = headersForNewBody(
      Object.entries(mockHeaders).flatMap(([name, value]) =>
        String(value ?? "").split("\n").map((line) => ({ name, value: line })),
      ),
    );
    if (!headers.some((h) => h.name.toLowerCase() === "content-type")) {
      headers.push({ name: "content-type", value: "application/json" });
    }

    try {
      await chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: matchedMock.status || 200,
        responseHeaders: headers,
        body: encodeBase64(matchedMock.responseBody || "{}"),
      });
    } catch (e) {
      console.error("[Reqpane] Mock was not applied, the request goes to the server:", e);
      // Fallback: continue the request normally (it is then reported by the Network domain)
      if (params.networkId) mockedNetworkIds.delete(scoped(tabId, params.networkId));
      await continueRequest(tabId, params.requestId);
      return;
    }

    // Emit mocked request to side panel
    let responseBody;
    try {
      responseBody = JSON.parse(matchedMock.responseBody || "{}");
    } catch {
      responseBody = matchedMock.responseBody;
    }

    emitRequest(tabId, {
      id: crypto.randomUUID(),
      type: params.resourceType === "XHR" ? "xhr" : "fetch",
      method: reqMethod,
      url,
      requestHeaders: params.request.headers || {},
      requestBody: params.request.postData || null,
      status: matchedMock.status || 200,
      statusText: "OK (Mocked)",
      responseHeaders: mockHeaders,
      responseBody,
      duration: Date.now() - startedAt,
      timestamp: startedAt,
      error: null,
      pageUrl: state.pageUrl || "",
      pageTitle: state.pageTitle || "",
      mocked: true,
    });
  }

  // ========================================
  // Fetch Pattern Management
  // ========================================

  /** Updates are queued per tab so that a disable/enable pair never interleaves with another one. */
  function updateFetchPatterns(tabId, force = false) {
    const state = debuggerState.get(tabId);
    if (!state?.attached) return Promise.resolve();
    state.fetchQueue = (state.fetchQueue || Promise.resolve()).then(() =>
      applyFetchPatterns(tabId, state, force),
    );
    return state.fetchQueue;
  }

  async function applyFetchPatterns(tabId, state, force) {
    if (debuggerState.get(tabId) !== state) return; // detached meanwhile

    const { mockRules, breakpointRules } = await getRules();

    // "Request" patterns pause a request before it is sent, "Response" ones when its response arrives.
    const enabledPatterns = [];
    for (const rule of mockRules) {
      if (!rule.enabled) continue;
      const requestStage = ruleMode(rule) === "patch" ? "Response" : "Request";
      enabledPatterns.push(`${requestStage} ${toCdpPattern(rule.urlPattern)}`);
    }
    for (const rule of breakpointRules) {
      if (!rule.enabled) continue;
      const requestStage = breakpointStage(rule) === "response" ? "Response" : "Request";
      enabledPatterns.push(`${requestStage} ${toCdpPattern(rule.urlPattern)}`);
    }
    const uniquePatterns = [...new Set(enabledPatterns)].sort();

    // Fetch.disable releases every paused request, so do nothing when the patterns did not change.
    const signature = JSON.stringify(uniquePatterns);
    if (!force && state.fetchSignature === signature) return;
    state.fetchSignature = signature;

    // Disable existing Fetch interception
    if (state.fetchEnabled) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.disable", {});
      } catch (e) {}
      state.fetchEnabled = false;
    }

    if (uniquePatterns.length > 0) {
      const patterns = uniquePatterns.map((entry) => {
        const separator = entry.indexOf(" ");
        return { urlPattern: entry.slice(separator + 1), requestStage: entry.slice(0, separator) };
      });

      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
          patterns,
        });
        state.fetchEnabled = true;
      } catch (e) {
        state.fetchSignature = undefined; // try again on the next update
        console.error("[Reqpane] Failed to enable Fetch patterns:", e);
      }
    }
  }

  return { continueRequest, handleRequestPaused, resumePausedRequest, updateFetchPatterns };
}
