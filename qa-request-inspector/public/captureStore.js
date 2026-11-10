// Pure helpers for the background service worker (no chrome.* calls), covered by tests/background.test.mjs.

export const BODY_NOT_PERSISTED = "[Тело не сохранено во временном хранилище: превышен объём]";

/**
 * Chooses the tab a side panel should capture: the active website tab of its window,
 * otherwise the most recently used website tab (the panel may be opened as a full page).
 */
export function pickTargetTab(tabs) {
  const websites = tabs.filter((tab) => /^https?:/.test(tab.url || ""));
  return (
    websites.find((tab) => tab.active) ||
    websites.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] ||
    null
  );
}

/** Side panel ports are named "sidepanel:<windowId>"; a bare "sidepanel" is accepted for old pages. */
export function parsePanelPortName(name) {
  if (name === "sidepanel") return { isPanel: true, windowId: null };
  const match = /^sidepanel:(\d+)$/.exec(name || "");
  return match ? { isPanel: true, windowId: Number(match[1]) } : { isPanel: false, windowId: null };
}

/**
 * CDP returns some bodies base64-encoded. Text is decoded as UTF-8;
 * real binary data keeps the previous behaviour (a byte string).
 */
export function decodeBody(body, base64Encoded) {
  if (!base64Encoded) return body;
  const binary = atob(body);
  try {
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return binary;
  }
}

/**
 * Returns a copy of the request list (newest first) that fits into `budget` characters of JSON.
 * Newest requests keep their bodies; once the budget is used up, bodies are replaced by a marker.
 * `sizeOf` lets the caller cache sizes, so large bodies are not serialised again on every save.
 */
export function trimForPersistence(requests, budget, sizeOf = (request) => JSON.stringify(request).length) {
  let used = 0;
  return requests.map((request) => {
    const size = sizeOf(request);
    if (used + size <= budget) {
      used += size;
      return request;
    }
    const slim = {
      ...request,
      requestBody: request.requestBody == null ? request.requestBody : BODY_NOT_PERSISTED,
      responseBody: request.responseBody == null ? request.responseBody : BODY_NOT_PERSISTED,
    };
    used += JSON.stringify(slim).length;
    return slim;
  });
}

/**
 * Sessions kept in history: every pinned ("reference") session, plus the three newest
 * unpinned ones saved within the last 24 hours. Newest first.
 */
export function retainSessions(sessions, now = Date.now()) {
  const recent = sessions
    .filter((session) => !session.pinned && session.timestamp > now - 86400000)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3);
  return [...sessions.filter((session) => session.pinned), ...recent].sort((a, b) => b.timestamp - a.timestamp);
}

// ---------------------------------------------------------------------------------------------
// Capture settings
// ---------------------------------------------------------------------------------------------

export const MIN_REQUESTS_PER_TAB = 50;
export const MAX_REQUESTS_LIMIT = 1000;
/** Only this many newest requests keep their bodies; older ones keep everything else. */
export const BODY_KEEP_COUNT = 200;
export const BODY_DROPPED = "[Тело удалено: хранятся тела только последних 200 запросов]";

/** Throughput is in bytes per second, latency in milliseconds (CDP Network.emulateNetworkConditions). */
export const THROTTLE_PROFILES = {
  none: { offline: false, latency: 0, download: -1, upload: -1 },
  fast3g: { offline: false, latency: 562.5, download: (1.6 * 1024 * 1024 * 0.9) / 8, upload: (750 * 1024 * 0.9) / 8 },
  slow3g: { offline: false, latency: 2000, download: (500 * 1024 * 0.8) / 8, upload: (500 * 1024 * 0.8) / 8 },
  offline: { offline: true, latency: 0, download: 0, upload: 0 },
};

export const defaultCaptureSettings = {
  preserveLog: false,
  maxRequests: 100,
  captureAllResources: false,
  throttle: "none", // none | fast3g | slow3g | offline | custom
  customLatencyMs: 300,
  customDownloadKbps: 1000,
  customUploadKbps: 500,
};

const clampNumber = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

/** Stored settings may be missing, partial or edited by hand: always returns a complete valid object. */
export function normalizeCaptureSettings(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const d = defaultCaptureSettings;
  return {
    preserveLog: Boolean(value.preserveLog),
    maxRequests: clampNumber(value.maxRequests, MIN_REQUESTS_PER_TAB, MAX_REQUESTS_LIMIT, d.maxRequests),
    captureAllResources: Boolean(value.captureAllResources),
    throttle: ["none", "fast3g", "slow3g", "offline", "custom"].includes(value.throttle) ? value.throttle : d.throttle,
    customLatencyMs: clampNumber(value.customLatencyMs, 0, 60000, d.customLatencyMs),
    customDownloadKbps: clampNumber(value.customDownloadKbps, 1, 1000000, d.customDownloadKbps),
    customUploadKbps: clampNumber(value.customUploadKbps, 1, 1000000, d.customUploadKbps),
  };
}

/** Parameters for Network.emulateNetworkConditions. */
export function networkConditions(settings) {
  const profile =
    settings.throttle === "custom"
      ? {
          offline: false,
          latency: settings.customLatencyMs,
          download: (settings.customDownloadKbps * 1024) / 8,
          upload: (settings.customUploadKbps * 1024) / 8,
        }
      : THROTTLE_PROFILES[settings.throttle] || THROTTLE_PROFILES.none;
  return {
    offline: profile.offline,
    latency: profile.latency,
    downloadThroughput: profile.download,
    uploadThroughput: profile.upload,
  };
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

const RESOURCE_KINDS = {
  XHR: "xhr",
  Fetch: "fetch",
  Document: "document",
  Script: "script",
  Stylesheet: "stylesheet",
  Image: "image",
  Font: "font",
  Media: "media",
};

/** Maps a CDP resource type to the request `type` shown in the panel; null for types that are never listed. */
export function resourceKind(cdpType) {
  if (cdpType === "WebSocket" || cdpType === "EventSource") return null; // shown as streams
  return RESOURCE_KINDS[cdpType] || "other";
}

/** A copy of the request without bodies (the same object when there is nothing to drop). */
export function stripBodies(request) {
  const hasRequestBody = request.requestBody != null && request.requestBody !== BODY_DROPPED;
  const hasResponseBody = request.responseBody != null && request.responseBody !== BODY_DROPPED;
  if (!hasRequestBody && !hasResponseBody) return request;
  return {
    ...request,
    requestBody: hasRequestBody ? BODY_DROPPED : request.requestBody,
    responseBody: hasResponseBody ? BODY_DROPPED : request.responseBody,
  };
}

/**
 * Headers the browser really sent or received (Network.*ExtraInfo: Cookie, Set-Cookie and other
 * headers hidden from the provisional list) laid over the provisional ones. Names are compared
 * case-insensitively; HTTP/2 pseudo-headers (":authority") are dropped.
 */
export function mergeHeaders(base, extra) {
  const result = {};
  const names = new Map(); // lower-case name -> name used in the result
  for (const source of [base || {}, extra || {}]) {
    for (const [name, value] of Object.entries(source)) {
      if (name.startsWith(":")) continue;
      const lower = name.toLowerCase();
      const existing = names.get(lower);
      if (existing !== undefined) delete result[existing];
      names.set(lower, name);
      result[name] = String(value);
    }
  }
  return result;
}

const span = (start, end) => (start >= 0 && end >= start ? end - start : 0);
const round = (value) => Math.max(0, Math.round(value * 10) / 10);

/**
 * Phases of a request in milliseconds from a CDP ResourceTiming object.
 * `startTime` / `endTime` are the monotonic timestamps (seconds) of requestWillBeSent and loadingFinished.
 */
export function computeTimings(timing, startTime, endTime) {
  if (!timing || typeof timing.requestTime !== "number") return null;
  const dns = span(timing.dnsStart, timing.dnsEnd);
  const connect = span(timing.connectStart, timing.connectEnd);
  const ssl = span(timing.sslStart, timing.sslEnd);
  const send = span(timing.sendStart, timing.sendEnd);
  const wait = span(timing.sendEnd, timing.receiveHeadersEnd);
  const firstStep = [timing.dnsStart, timing.connectStart, timing.sendStart].filter((value) => value >= 0);
  const blocked = (timing.requestTime - startTime) * 1000 + (firstStep.length ? Math.min(...firstStep) : 0);
  const receive = (endTime - timing.requestTime) * 1000 - Math.max(0, timing.receiveHeadersEnd);
  return {
    blocked: round(blocked),
    dns: round(dns),
    connect: round(connect - ssl),
    ssl: round(ssl),
    send: round(send),
    wait: round(wait),
    receive: round(receive),
  };
}

/** Text of a body returned by CDP and whether it is binary (not valid UTF-8). */
export function decodeText(body, base64Encoded) {
  if (!base64Encoded) return { text: body || "", binary: false };
  const binary = atob(body || "");
  try {
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), binary: false };
  } catch {
    return { text: binary, binary: true };
  }
}

/** UTF-8 text as base64, the form CDP expects for bodies. */
export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text ?? "");
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** { name: value } -> [{ name, value }] (CDP header entries). */
export function headerEntries(headers) {
  return Object.entries(headers || {})
    .filter(([name]) => name && !name.startsWith(":"))
    .map(([name, value]) => ({ name, value: String(value) }));
}

/** [{ name, value }] -> { name: value }; repeated names are joined like the browser does. */
export function headersFromEntries(entries) {
  const result = {};
  for (const { name, value } of entries || []) {
    result[name] = name in result ? `${result[name]}, ${value}` : value;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Response patching: change a few fields of the real response
// ---------------------------------------------------------------------------------------------

function pathTokens(path) {
  return String(path || "")
    .replace(/^\$\.?/, "")
    .replace(/\[(\d+|\*)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
}

function patchAt(current, tokens, index, apply) {
  if (current === null || typeof current !== "object") return;
  const token = tokens[index];
  const last = index === tokens.length - 1;
  const keys = token === "*" ? Object.keys(current) : [token];
  for (const key of keys) {
    if (last) apply(current, key);
    else patchAt(current[key], tokens, index + 1, apply);
  }
}

/**
 * Applies `[{ path: "$.items[*].price", value: "0" }, { path: "$.total", remove: true }]` to a parsed
 * JSON value and returns the patched copy. `value` is JSON text; text that is not JSON is used as a string.
 * Only the last step of a path may be new (a new property of an existing object).
 */
export function applyJsonPatches(source, patches) {
  let result = structuredClone(source);
  for (const patch of patches || []) {
    const tokens = pathTokens(patch.path);
    let value;
    if (!patch.remove) {
      try {
        value = JSON.parse(patch.value);
      } catch {
        value = patch.value;
      }
    }
    if (tokens.length === 0) {
      if (!patch.remove) result = value;
      continue;
    }
    patchAt(result, tokens, 0, (parent, key) => {
      if (patch.remove) {
        if (Array.isArray(parent)) {
          if (/^\d+$/.test(key)) parent[key] = undefined; // removed after the walk, see below
        } else delete parent[key];
      } else if (!Array.isArray(parent) || /^\d+$/.test(key)) {
        parent[key] = structuredClone(value);
      }
    });
  }
  // Array items marked for removal are dropped at the end, so indexes stay valid during the walk.
  const compact = (node) => {
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index--) {
        if (node[index] === undefined) node.splice(index, 1);
        else compact(node[index]);
      }
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(compact);
    }
  };
  compact(result);
  return result;
}
