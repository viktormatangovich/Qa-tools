// Reqpane background service worker
// Uses chrome.debugger CDP for network capture (no page-context injection)
// CDP domains used: Network, Fetch, Runtime only (no Runtime.evaluate)

import { createInterception } from "./interception.js";
import { createPersistence } from "./persistence.js";
import {
  BODY_KEEP_COUNT,
  computeTimings,
  decodeBody,
  mergeHeaders,
  networkConditions,
  normalizeCaptureSettings,
  parsePanelPortName,
  pickTargetTab,
  resourceKind,
  retainSessions,
  stripBodies,
} from "./captureStore.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// content.js is injected by the side panel on demand (src/sidepanel/utils/pageMessaging.ts),
// so there is nothing to inject here on install or update.

// ========================================
// State
// ========================================

const streamMessages = new Map(); // tabId -> messages[]
const streamUrls = new Map(); // "tabId:requestId" -> url
const mockSequenceIndexes = new Map(); // "tabId:ruleId" -> next index
const apiRequests = new Map(); // tabId -> requests[]
const consoleErrors = new Map(); // tabId -> errors[]
const MAX_ERRORS_PER_TAB = 50;
const MAX_STREAM_MESSAGES = 200;
const MAX_STREAM_TEXT = 65536; // characters of a text frame
const MAX_STREAM_BINARY = 4096; // bytes of a binary frame kept for the hex view
const MAX_RESPONSE_BODY_SIZE = 5 * 1024 * 1024; // 5MB

// CDP state
const debuggerState = new Map(); // tabId -> { attached, fetchEnabled, pageUrl, pageTitle, fetchQueue }
const attaching = new Map(); // tabId -> Promise<boolean> (attach in flight)
const pendingRequests = new Map(); // "tabId:requestId" -> partial request data
const mockedNetworkIds = new Set(); // "tabId:networkId" of mocked requests (for dedup)
const pausedRequests = new Map(); // "tabId:fetchRequestId" -> { tabId, requestId, timeout, stage, networkId, request, ... }
const extraInfo = new Map(); // "tabId:requestId" -> { requestHeaders, responseHeaders } (Network.*ExtraInfo)

// Capture settings (preserve log, request limit, resource types, throttling): storage is the source of truth.
let captureSettings = normalizeCaptureSettings();
const settingsReady = chrome.storage.local
  .get("captureSettings")
  .then((stored) => {
    captureSettings = normalizeCaptureSettings(stored.captureSettings);
  })
  .catch(() => {});

// One side panel per browser window. Each panel captures one tab of its own window.
const panels = new Map(); // windowId -> { port, tabId, generation }

const scoped = (tabId, id) => `${tabId}:${id}`;

function deleteScoped(collection, tabId) {
  const prefix = `${tabId}:`;
  for (const key of collection.keys()) {
    if (key.startsWith(prefix)) collection.delete(key);
  }
}

function clearPausedRequests(tabId) {
  for (const [key, paused] of pausedRequests) {
    if (paused.tabId === tabId) {
      clearTimeout(paused.timeout);
      pausedRequests.delete(key);
    }
  }
}


// Captured data survives a service worker restart (persistence.js).
const { schedulePersist, restoreCapturedData, forgetPersisted } = createPersistence({ apiRequests, consoleErrors });

// Handlers that read captured data wait for this.
const ready = Promise.all([restoreCapturedData(), settingsReady]);

// ========================================
// Mock / breakpoint rules (cached; storage is the source of truth)
// ========================================

let rulesCache = null;

async function getRules() {
  if (!rulesCache) {
    const { mockRules = [], breakpointRules = [] } = await chrome.storage.local.get([
      "mockRules",
      "breakpointRules",
    ]);
    rulesCache = { mockRules, breakpointRules };
  }
  return rulesCache;
}

// Fetch-domain interception: mocks, patches, breakpoints (interception.js).
const { handleRequestPaused, resumePausedRequest, updateFetchPatterns } = createInterception({
  debuggerState,
  pendingRequests,
  mockedNetworkIds,
  pausedRequests,
  mockSequenceIndexes,
  getRules,
  emitRequest,
  notifyTab,
});

// Rules are saved by the side panel either through messages or directly to storage.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.captureSettings) applyCaptureSettings(changes.captureSettings.newValue);
  if (!changes.mockRules && !changes.breakpointRules) return;
  rulesCache = null;
  if (changes.mockRules) mockSequenceIndexes.clear();
  void refreshFetchPatterns();
});

function refreshFetchPatterns() {
  return Promise.all(
    [...debuggerState].map(([tabId, state]) => (state.attached ? updateFetchPatterns(tabId) : null)),
  );
}

function applyCaptureSettings(raw) {
  const previous = captureSettings;
  captureSettings = normalizeCaptureSettings(raw);

  // A lower limit takes effect at once.
  if (captureSettings.maxRequests < previous.maxRequests) {
    for (const [tabId, requests] of apiRequests) {
      if (requests.length > captureSettings.maxRequests) {
        requests.length = captureSettings.maxRequests;
        updateBadge(tabId);
        schedulePersist(tabId);
      }
    }
  }

  const before = JSON.stringify(networkConditions(previous));
  if (before !== JSON.stringify(networkConditions(captureSettings))) {
    for (const [tabId, state] of debuggerState) {
      if (state.attached) void applyNetworkConditions(tabId);
    }
  }
}

/** Throttling / offline emulation for the tab (a no-op profile switches it off). */
async function applyNetworkConditions(tabId) {
  try {
    await chrome.debugger.sendCommand(
      { tabId },
      "Network.emulateNetworkConditions",
      networkConditions(captureSettings),
    );
  } catch (err) {
    // Not attached any more, or the command is not available in this browser version.
  }
}


// ========================================
// Side panels
// ========================================

function panelForTab(tabId) {
  for (const panel of panels.values()) {
    if (panel.tabId === tabId) return panel;
  }
  return null;
}

function post(panel, message) {
  try {
    panel.port.postMessage(message);
  } catch (err) {
    // Port already closed
  }
}

/** Sends a message to the side panel that captures this tab (and to no other window). */
function notifyTab(tabId, message) {
  const panel = panelForTab(tabId);
  if (panel) post(panel, message);
}

function postSnapshot(panel) {
  post(panel, {
    type: "TAB_SNAPSHOT",
    tabId: panel.tabId,
    requests: apiRequests.get(panel.tabId) || [],
    errors: consoleErrors.get(panel.tabId) || [],
  });
}

/** Points the panel of `windowId` at `tabId`: detaches from the previous tab, attaches to the new one. */
async function switchPanelTab(windowId, tabId) {
  const panel = panels.get(windowId);
  if (!panel) return;

  const generation = ++panel.generation; // latest-wins guard for quick tab switches
  const isStale = () => panels.get(windowId) !== panel || panel.generation !== generation;

  const previousTabId = panel.tabId;
  if (previousTabId != null && previousTabId !== tabId) {
    panel.tabId = null;
    if (!panelForTab(previousTabId)) await detachDebugger(previousTabId);
    if (isStale()) return;
  }

  panel.tabId = tabId;
  await ready;
  if (isStale()) return;
  postSnapshot(panel);

  const attached = await attachDebugger(tabId);
  if (isStale()) return;
  if (attached) post(panel, { type: "DEBUGGER_STATUS", status: "attached", tabId });
}

async function registerPanel(port, requestedWindowId) {
  let windowId = requestedWindowId;
  let disconnected = false;

  port.onDisconnect.addListener(() => {
    disconnected = true;
    const panel = panels.get(windowId);
    if (!panel || panel.port !== port) return; // replaced by a newer connection
    panels.delete(windowId);
    if (panel.tabId != null && !panelForTab(panel.tabId)) void detachDebugger(panel.tabId);
  });

  if (windowId == null) {
    try {
      windowId = (await chrome.windows.getLastFocused()).id;
    } catch (err) {
      return;
    }
    if (disconnected) return;
  }

  // A reconnect from the same window keeps capturing the same tab.
  const previous = panels.get(windowId);
  panels.set(windowId, { port, tabId: previous?.tabId ?? null, generation: previous?.generation ?? 0 });

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch (err) {
    // Window already closed
  }
  if (disconnected) return;

  const target = pickTargetTab(tabs);
  if (target?.id != null) {
    await switchPanelTab(windowId, target.id);
  } else {
    post(panels.get(windowId), { type: "DEBUGGER_STATUS", status: "detached", tabId: null });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  const { isPanel, windowId } = parsePanelPortName(port.name);
  if (!isPanel) return;
  // Verify port is from extension page (not content script)
  if (port.sender?.tab && !port.sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  void registerPanel(port, windowId);
});

// Keyboard shortcut (manifest "commands"): starts the element picker in the panel of that window.
// Without an open panel the shortcut opens it; picking then starts from the panel button.
chrome.commands?.onCommand?.addListener((command, tab) => {
  if (command !== "pick-element") return;
  const windowId = tab?.windowId;
  if (windowId === undefined) return;
  const panel = panels.get(windowId);
  if (panel) post(panel, { type: "PICK_ELEMENT_COMMAND" });
  else chrome.sidePanel?.open({ windowId }).catch(() => {});
});

// Tab switching while a side panel is open in that window
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!panels.has(activeInfo.windowId)) return;
  let target;
  try {
    target = await chrome.tabs.get(activeInfo.tabId);
  } catch (err) {
    return; // Tab closed meanwhile
  }
  if (!/^https?:/.test(target.url || "")) return;
  await switchPanelTab(activeInfo.windowId, activeInfo.tabId);
});

// A captured tab dragged to another window no longer belongs to its old panel.
chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  const panel = panels.get(detachInfo.oldWindowId);
  if (!panel || panel.tabId !== tabId) return;
  post(panel, { type: "DEBUGGER_STATUS", status: "detached", tabId, reason: "tab_moved" });
  panel.tabId = null;
  panel.generation++;
  void detachDebugger(tabId);
});

// ========================================
// CDP Debugger Lifecycle
// ========================================

function attachDebugger(tabId) {
  if (debuggerState.get(tabId)?.attached) return Promise.resolve(true);
  if (!attaching.has(tabId)) {
    attaching.set(
      tabId,
      doAttach(tabId, false).finally(() => attaching.delete(tabId)),
    );
  }
  return attaching.get(tabId);
}

async function doAttach(tabId, isRetry) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (err) {
    // A session left over from a previous service worker run: drop it and attach again.
    if (!isRetry && /already attached/i.test(err.message || "")) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch (e) {}
      return doAttach(tabId, true);
    }
    notifyTab(tabId, { type: "DEBUGGER_STATUS", status: "error", tabId, error: err.message });
    return false;
  }

  try {
    const state = { attached: true, fetchEnabled: false, pageUrl: "", pageTitle: "" };
    debuggerState.set(tabId, state);

    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable", {});

    // Enable Fetch domain if rules exist
    await updateFetchPatterns(tabId);

    await settingsReady;
    if (captureSettings.throttle !== "none") await applyNetworkConditions(tabId);

    // Cache page info
    try {
      const tab = await chrome.tabs.get(tabId);
      state.pageUrl = tab.url || "";
      state.pageTitle = tab.title || "";
    } catch (e) {}

    return true; // switchPanelTab reports "attached" to the panel
  } catch (err) {
    debuggerState.delete(tabId);
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {}
    notifyTab(tabId, { type: "DEBUGGER_STATUS", status: "error", tabId, error: err.message });
    return false;
  }
}

function forgetDebuggerSession(tabId) {
  clearPausedRequests(tabId);
  deleteScoped(mockSequenceIndexes, tabId);
  deleteScoped(pendingRequests, tabId);
  deleteScoped(mockedNetworkIds, tabId);
  deleteScoped(extraInfo, tabId);
  debuggerState.delete(tabId);
}

async function detachDebugger(tabId) {
  // Wait for an attach in flight, otherwise the session would outlive this call.
  if (attaching.has(tabId)) await attaching.get(tabId);
  if (!debuggerState.get(tabId)?.attached) return;

  forgetDebuggerSession(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {
    // Already detached
  }
}

// Handle debugger detach events (infobar cancelled, tab closed, DevTools took over)
chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (tabId == null) return;
  forgetDebuggerSession(tabId);
  notifyTab(tabId, { type: "DEBUGGER_STATUS", status: "detached", tabId, reason });
});

// ========================================
// CDP Event Handler
// ========================================

function finishRequest(tabId, state, req, fields, endTime) {
  Object.assign(req, fields);
  req.pageUrl = state.pageUrl || "";
  req.pageTitle = state.pageTitle || "";

  // Headers as really sent and received (with cookies), when the browser reported them.
  const extraKey = scoped(tabId, req._requestId);
  const extra = extraInfo.get(extraKey);
  if (extra) {
    extraInfo.delete(extraKey);
    if (extra.requestHeaders) req.requestHeaders = mergeHeaders(req.requestHeaders, extra.requestHeaders);
    if (extra.responseHeaders) req.responseHeaders = mergeHeaders(req.responseHeaders, extra.responseHeaders);
  }

  const timings = endTime != null ? computeTimings(req._timing, req._startTime, endTime) : null;
  if (timings) req.timings = timings;

  // Clean internal fields
  delete req._startTime;
  delete req._mimeType;
  delete req._timing;
  delete req._requestId;

  emitRequest(tabId, req);
}

function rememberExtraInfo(tabId, requestId, field, headers) {
  const key = scoped(tabId, requestId);
  const entry = extraInfo.get(key) || {};
  entry[field] = headers || {};
  extraInfo.set(key, entry);
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const tabId = source.tabId;
  const state = debuggerState.get(tabId);
  if (!state?.attached) return;

  switch (method) {
    // --- Network domain: WebSocket / SSE ---
    case "Network.webSocketCreated": {
      streamUrls.set(scoped(tabId, params.requestId), params.url);
      break;
    }
    case "Network.webSocketClosed": {
      streamUrls.delete(scoped(tabId, params.requestId));
      break;
    }
    case "Network.webSocketFrameReceived":
    case "Network.webSocketFrameSent":
    case "Network.eventSourceMessageReceived": {
      const key = scoped(tabId, params.requestId);
      const data = String(params.response?.payloadData ?? params.data ?? "");
      // Opcode 2 is a binary WebSocket frame: CDP delivers it base64-encoded.
      const binary = params.response?.opcode === 2;
      const entry = {
        id: crypto.randomUUID(),
        protocol: method.includes("webSocket") ? "WebSocket" : "SSE",
        direction: method.endsWith("Sent") ? "sent" : "received",
        url: streamUrls.get(key) || pendingRequests.get(key)?.url || "",
        // A binary frame keeps a base64 prefix (whole 3-byte groups) for the hex view.
        data: binary ? data.slice(0, Math.ceil(MAX_STREAM_BINARY / 3) * 4) : data.slice(0, MAX_STREAM_TEXT),
        timestamp: Date.now(),
      };
      if (binary) {
        entry.binary = true;
        const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
        entry.size = Math.max(0, Math.floor((data.length * 3) / 4) - padding);
      }
      const list = streamMessages.get(tabId) || [];
      streamMessages.set(tabId, [...list, entry].slice(-MAX_STREAM_MESSAGES));
      break;
    }

    // --- Network domain: headers as sent / received on the wire (cookies included) ---
    case "Network.requestWillBeSentExtraInfo": {
      rememberExtraInfo(tabId, params.requestId, "requestHeaders", params.headers);
      break;
    }
    case "Network.responseReceivedExtraInfo": {
      rememberExtraInfo(tabId, params.requestId, "responseHeaders", params.headers);
      break;
    }

    // --- Network domain: XHR / fetch ---
    case "Network.requestWillBeSent": {
      const type = params.type; // 'XHR', 'Fetch', 'Document', etc.
      const key = scoped(tabId, params.requestId);
      if (type === "EventSource") streamUrls.set(key, params.request.url);
      const kind = resourceKind(type);
      const isApiCall = kind === "xhr" || kind === "fetch";
      if (!kind || (!isApiCall && !captureSettings.captureAllResources)) return;
      // Inline and extension resources are not network requests.
      if (!isApiCall && !/^https?:/i.test(params.request.url)) return;

      // A redirect reuses the requestId: report the finished hop before tracking the next one.
      const redirected = pendingRequests.get(key);
      if (redirected && params.redirectResponse) {
        pendingRequests.delete(key);
        redirected._timing = params.redirectResponse.timing;
        finishRequest(
          tabId,
          state,
          redirected,
          {
            status: params.redirectResponse.status,
            statusText: params.redirectResponse.statusText,
            responseHeaders: params.redirectResponse.headers || {},
            responseBody: null,
            duration: Math.max(0, Math.round((params.timestamp - redirected._startTime) * 1000)),
            error: null,
          },
          params.timestamp,
        );
      }

      pendingRequests.set(key, {
        id: crypto.randomUUID(),
        type: kind,
        _requestId: params.requestId,
        method: params.request.method,
        url: params.request.url,
        requestHeaders: params.request.headers || {},
        requestBody: params.request.postData || null,
        timestamp: params.wallTime ? params.wallTime * 1000 : Date.now(),
        _startTime: params.timestamp,
      });

      // Get post data if needed
      if (params.request.hasPostData && !params.request.postData) {
        const tracked = pendingRequests.get(key);
        try {
          const result = await chrome.debugger.sendCommand(
            { tabId },
            "Network.getRequestPostData",
            { requestId: params.requestId },
          );
          tracked.requestBody = result.postData;
        } catch (e) {
          tracked.requestBody = "[Unable to retrieve request body]";
        }
      }
      break;
    }

    case "Network.responseReceived": {
      const req = pendingRequests.get(scoped(tabId, params.requestId));
      if (!req) return;

      req.status = params.response.status;
      req.statusText = params.response.statusText;
      req.responseHeaders = params.response.headers || {};
      req._mimeType = params.response.mimeType;
      req._timing = params.response.timing;
      if (params.response.protocol) req.protocol = params.response.protocol;
      if (params.response.remoteIPAddress) {
        req.remoteAddress = `${params.response.remoteIPAddress}:${params.response.remotePort}`;
      }
      if (params.response.fromDiskCache || params.response.fromPrefetchCache) req.fromCache = true;
      break;
    }

    case "Network.loadingFinished": {
      const key = scoped(tabId, params.requestId);
      const req = pendingRequests.get(key);
      if (!req) {
        extraInfo.delete(key);
        return;
      }
      pendingRequests.delete(key);

      // Skip mocked requests (already emitted by Fetch handler)
      if (mockedNetworkIds.delete(key)) {
        extraInfo.delete(key);
        return;
      }

      const duration = Math.round((params.timestamp - req._startTime) * 1000);
      let parsedBody = null;
      if (typeof params.encodedDataLength === "number") req.transferSize = params.encodedDataLength;

      // Bodies are read for API calls only: scripts, images and fonts would fill the memory.
      if (req.type !== "xhr" && req.type !== "fetch") {
        finishRequest(tabId, state, req, { duration, responseBody: null, error: null }, params.timestamp);
        break;
      }

      try {
        const { body, base64Encoded } = await chrome.debugger.sendCommand(
          { tabId },
          "Network.getResponseBody",
          { requestId: params.requestId },
        );
        let responseBody = decodeBody(body, base64Encoded);

        // Truncate large bodies
        if (
          typeof responseBody === "string" &&
          responseBody.length > MAX_RESPONSE_BODY_SIZE
        ) {
          responseBody =
            responseBody.slice(0, MAX_RESPONSE_BODY_SIZE) + "... [truncated]";
        }

        // Parse JSON if applicable
        parsedBody = responseBody;
        if ((req._mimeType || "").includes("json")) {
          try {
            parsedBody = JSON.parse(responseBody);
          } catch {
            parsedBody = responseBody;
          }
        }
      } catch (e) {
        parsedBody = null;
      }

      finishRequest(tabId, state, req, { duration, responseBody: parsedBody, error: null }, params.timestamp);
      break;
    }

    case "Network.loadingFailed": {
      const key = scoped(tabId, params.requestId);
      const req = pendingRequests.get(key);
      if (!req) {
        extraInfo.delete(key);
        return;
      }
      pendingRequests.delete(key);

      // Skip mocked
      if (mockedNetworkIds.delete(key)) {
        extraInfo.delete(key);
        return;
      }

      finishRequest(tabId, state, req, {
        duration: Math.round((params.timestamp - req._startTime) * 1000),
        status: 0,
        statusText: params.blockedReason ? "Blocked" : "Network Error",
        responseHeaders: {},
        responseBody: null,
        error: params.errorText || "Request failed",
      });
      break;
    }

    // --- Runtime domain ---
    case "Runtime.exceptionThrown": {
      const details = params.exceptionDetails;
      const isUnhandledRejection = (details.text || "")
        .toLowerCase()
        .includes("unhandled");

      const error = {
        id: crypto.randomUUID(),
        type: isUnhandledRejection ? "unhandledrejection" : "error",
        message:
          details.exception?.description || details.text || "Unknown error",
        filename: details.url || undefined,
        lineno: details.lineNumber || undefined,
        colno: details.columnNumber || undefined,
        stack:
          details.exception?.description ||
          details.stackTrace?.callFrames
            ?.map(
              (f) =>
                `  at ${f.functionName || "(anonymous)"} (${f.url}:${
                  f.lineNumber
                }:${f.columnNumber})`,
            )
            .join("\n") ||
          null,
        timestamp: Date.now(),
        pageUrl: state.pageUrl || "",
        pageTitle: state.pageTitle || "",
      };

      emitConsoleError(tabId, error);
      break;
    }

    case "Runtime.consoleAPICalled": {
      if (params.type !== "error") return;

      const message = params.args
        .map((arg) => {
          if (arg.type === "string") return arg.value;
          if (arg.description) return arg.description;
          try {
            return JSON.stringify(arg.value);
          } catch {
            return String(arg.value);
          }
        })
        .join(" ");

      const error = {
        id: crypto.randomUUID(),
        type: "console.error",
        message,
        timestamp: Date.now(),
        pageUrl: state.pageUrl || "",
        pageTitle: state.pageTitle || "",
      };

      emitConsoleError(tabId, error);
      break;
    }

    // --- Fetch domain (mocks and breakpoints) ---
    case "Fetch.requestPaused": {
      await handleRequestPaused(tabId, state, params);
      break;
    }
  }
});


// ========================================
// Request/Error Emission
// ========================================

function updateBadge(tabId) {
  const count = (apiRequests.get(tabId) || []).length;
  // Per-tab badge: other tabs and windows keep their own counters.
  chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563EB" }).catch(() => {});
}

function emitRequest(tabId, request) {
  if (!apiRequests.has(tabId)) {
    apiRequests.set(tabId, []);
  }

  const requests = apiRequests.get(tabId);
  requests.unshift(request);
  if (requests.length > captureSettings.maxRequests) {
    requests.length = captureSettings.maxRequests;
  }
  // With a high limit only the newest requests keep their bodies.
  if (requests.length > BODY_KEEP_COUNT) {
    requests[BODY_KEEP_COUNT] = stripBodies(requests[BODY_KEEP_COUNT]);
  }

  updateBadge(tabId);
  schedulePersist(tabId);

  notifyTab(tabId, {
    type: "NEW_API_REQUEST",
    payload: request,
    tabId,
  });
}

function emitConsoleError(tabId, error) {
  if (!consoleErrors.has(tabId)) {
    consoleErrors.set(tabId, []);
  }

  const errors = consoleErrors.get(tabId);
  errors.unshift(error);
  if (errors.length > MAX_ERRORS_PER_TAB) {
    errors.pop();
  }

  schedulePersist(tabId);

  notifyTab(tabId, {
    type: "NEW_CONSOLE_ERROR",
    payload: error,
    tabId,
  });
}

// ========================================
// Message Handler
// ========================================

/**
 * The tab a side panel message refers to: the tab captured by the sender's window
 * (`message.windowId`), otherwise by the last focused window, otherwise its active tab.
 */
async function resolveTabId(message) {
  await ready;
  if (message.windowId != null && panels.has(message.windowId)) {
    return panels.get(message.windowId).tabId;
  }
  try {
    const focused = await chrome.windows.getLastFocused();
    const panel = panels.get(focused.id);
    if (panel?.tabId != null) return panel.tabId;
    const [tab] = await chrome.tabs.query({ active: true, windowId: focused.id });
    return tab?.id ?? null;
  } catch (err) {
    return null;
  }
}

/** Runs an async handler and answers the sender; the caller returns true to keep the channel open. */
function respondAsync(sendResponse, handler) {
  handler().then(sendResponse, () => sendResponse({ success: false }));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  switch (message.type) {
    case "GET_TAB_INFO":
      return respondAsync(sendResponse, async () => {
        const tabId = await resolveTabId(message);
        if (tabId == null) return null;
        const tab = await chrome.tabs.get(tabId);
        return { title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl };
      });

    case "GET_STREAM_MESSAGES":
      return respondAsync(sendResponse, async () => {
        const tabId = await resolveTabId(message);
        return { messages: streamMessages.get(tabId) || [] };
      });

    case "CLEAR_STREAM_MESSAGES":
      return respondAsync(sendResponse, async () => {
        streamMessages.delete(await resolveTabId(message));
        return { success: true };
      });

    case "GET_API_REQUESTS":
      return respondAsync(sendResponse, async () => {
        const tabId = await resolveTabId(message);
        return { requests: apiRequests.get(tabId) || [], tabId };
      });

    case "SET_API_REQUESTS":
      // The side panel removed some requests; keep the stored list in step with it.
      return respondAsync(sendResponse, async () => {
        const tabId = await resolveTabId(message);
        if (tabId != null && Array.isArray(message.payload)) {
          apiRequests.set(tabId, message.payload.slice(0, captureSettings.maxRequests));
          updateBadge(tabId);
          schedulePersist(tabId);
        }
        return { success: true };
      });

    case "CLEAR_API_REQUESTS":
      return respondAsync(sendResponse, async () => {
        const tabId = await resolveTabId(message);
        if (tabId != null) {
          apiRequests.set(tabId, []);
          updateBadge(tabId);
          schedulePersist(tabId);
        }
        return { success: true };
      });

    case "GET_CONSOLE_ERRORS":
      return respondAsync(sendResponse, async () => {
        const tabId = await resolveTabId(message);
        return { errors: consoleErrors.get(tabId) || [], tabId };
      });

    case "CLEAR_CONSOLE_ERRORS":
      return respondAsync(sendResponse, async () => {
        const tabId = await resolveTabId(message);
        if (tabId != null) {
          consoleErrors.set(tabId, []);
          schedulePersist(tabId);
        }
        return { success: true };
      });

    case "GET_MOCK_RULES":
      return respondAsync(sendResponse, async () => ({ rules: (await getRules()).mockRules }));

    case "SAVE_MOCK_RULES":
      // Answer only after interception is updated, so the next page request already hits the mock.
      return respondAsync(sendResponse, async () => {
        mockSequenceIndexes.clear();
        await chrome.storage.local.set({ mockRules: message.payload });
        rulesCache = null;
        await refreshFetchPatterns();
        return { success: true };
      });

    case "GET_BREAKPOINT_RULES":
      return respondAsync(sendResponse, async () => ({ rules: (await getRules()).breakpointRules }));

    case "SAVE_BREAKPOINT_RULES":
      return respondAsync(sendResponse, async () => {
        await chrome.storage.local.set({ breakpointRules: message.payload });
        rulesCache = null;
        await refreshFetchPatterns();
        return { success: true };
      });

    case "RESUME_PAUSED_REQUEST": {
      const { requestId, action } = message;
      // Older pages do not send tabId: find the paused request by its id alone.
      const key =
        message.tabId != null
          ? scoped(message.tabId, requestId)
          : [...pausedRequests.keys()].find((k) => pausedRequests.get(k).requestId === requestId);
      const paused = key ? pausedRequests.get(key) : null;
      if (!paused) return;

      clearTimeout(paused.timeout);
      pausedRequests.delete(key);

      // `overrides` carries the edited request (url, method, headers, postData)
      // or the edited response (status, headers, body).
      void resumePausedRequest(paused, action, message.overrides);
      return false;
    }

    case "CAPTURE_SCREENSHOT":
      return respondAsync(sendResponse, async () => {
        const tabId = await resolveTabId(message);
        if (tabId == null) return { success: false, error: "no tab" };
        try {
          const options = { format: "png" };
          if (message.fullPage) {
            const metrics = await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics", {});
            const size = metrics.cssContentSize || metrics.contentSize;
            if (size) {
              options.captureBeyondViewport = true;
              // Chrome cannot render images taller than 16384 px.
              options.clip = { x: 0, y: 0, width: size.width, height: Math.min(size.height, 16384), scale: 1 };
            }
          }
          const { data } = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", options);
          return { success: true, dataUrl: `data:image/png;base64,${data}` };
        } catch (err) {
          // Debugger not attached: fall back to the visible part of the tab.
          try {
            const tab = await chrome.tabs.get(tabId);
            const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
            return { success: true, dataUrl };
          } catch (fallbackError) {
            return { success: false, error: fallbackError.message || err.message };
          }
        }
      });
  }
});

// ========================================
// Tab Lifecycle
// ========================================

function forgetTab(tabId) {
  streamMessages.delete(tabId);
  deleteScoped(streamUrls, tabId);
  apiRequests.delete(tabId);
  consoleErrors.delete(tabId);
  forgetDebuggerSession(tabId);
  forgetPersisted(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
  for (const panel of panels.values()) {
    if (panel.tabId === tabId) panel.tabId = null;
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    // Clear captured data on navigation, unless the log is preserved ("login -> redirect -> error").
    await settingsReady;
    if (!captureSettings.preserveLog) {
      if (apiRequests.has(tabId)) apiRequests.set(tabId, []);
      if (consoleErrors.has(tabId)) consoleErrors.set(tabId, []);
      // The panel keeps its own copy of the list: tell it to start over as well.
      const panel = panelForTab(tabId);
      if (panel) postSnapshot(panel);
      updateBadge(tabId);
      // Requests of the old document can no longer finish; the navigation request itself stays tracked.
      const prefix = `${tabId}:`;
      for (const [key, pending] of pendingRequests) {
        if (key.startsWith(prefix) && pending.type !== "document") {
          pendingRequests.delete(key);
          extraInfo.delete(key);
        }
      }
    }
    deleteScoped(streamUrls, tabId);
    schedulePersist(tabId);

    // Update cached page info
    const state = debuggerState.get(tabId);
    if (state?.attached) {
      try {
        const tab = await chrome.tabs.get(tabId);
        state.pageUrl = tab.url || "";
        state.pageTitle = tab.title || "";
      } catch (e) {}

      // Re-enable Fetch patterns after navigation (safe default)
      await updateFetchPatterns(tabId, true);
    }
  }

  // Update page title when it changes
  if (changeInfo.title) {
    const state = debuggerState.get(tabId);
    if (state) state.pageTitle = changeInfo.title;
  }
});

chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const panel = panelForTab(removedTabId);
  forgetTab(removedTabId);

  if (panel) {
    panel.tabId = null;
    for (const [windowId, candidate] of panels) {
      if (candidate === panel) await switchPanelTab(windowId, addedTabId);
    }
  }
});

// ========================================
// Saved session retention
// ========================================

async function cleanupSessions() {
  const { sessions: stored = [] } = await chrome.storage.local.get("sessions");
  const sessions = retainSessions(stored);
  const retained = new Set(sessions.map((s) => "session_" + s.id));

  // Only key names are needed here: session bodies can be megabytes and this runs every minute.
  const keys = chrome.storage.local.getKeys
    ? await chrome.storage.local.getKeys()
    : Object.keys(await chrome.storage.local.get(null));
  const expired = keys.filter((key) => key.startsWith("session_") && !retained.has(key));

  if (JSON.stringify(sessions) !== JSON.stringify(stored)) {
    await chrome.storage.local.set({ sessions });
    // Every open side panel shows the same history, so this one is a broadcast.
    chrome.runtime.sendMessage({ type: "SESSION_HISTORY_CHANGED", payload: sessions }).catch(() => {});
  }
  if (expired.length) await chrome.storage.local.remove(expired);
}
chrome.alarms.create("qa-session-cleanup", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "qa-session-cleanup") void cleanupSessions().catch(console.error);
});
void cleanupSessions().catch(console.error);
