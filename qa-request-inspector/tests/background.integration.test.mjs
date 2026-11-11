// Runs public/background.js against a fake chrome API: two windows, tab switch, redirect, mock, restart.
import assert from 'node:assert/strict';
import test from 'node:test';

const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

function event() {
  const listeners = [];
  return {
    addListener: (listener) => listeners.push(listener),
    removeListener: (listener) => listeners.splice(listeners.indexOf(listener), 1),
    fire: (...args) => listeners.map((listener) => listener(...args)),
  };
}

function storageArea(data, onChanged, areaName) {
  const pick = (keys) => {
    if (keys == null) return { ...data };
    const list = typeof keys === 'string' ? [keys] : keys;
    return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]));
  };
  return {
    get: async (keys) => structuredClone(pick(keys)),
    getKeys: async () => Object.keys(data),
    set: async (items) => {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = structuredClone(value);
      }
      onChanged.fire(changes, areaName);
    },
    remove: async (keys) => {
      for (const key of [].concat(keys)) delete data[key];
    },
  };
}

/** `shared` plays the browser: it outlives a service worker restart. */
function createShared() {
  return {
    local: {},
    session: {},
    attached: new Set(),
    focusedWindowId: 1,
    tabs: [
      { id: 11, windowId: 1, url: 'https://one.test/', title: 'One', active: true, lastAccessed: 5 },
      { id: 12, windowId: 1, url: 'https://two.test/', title: 'Two', active: false, lastAccessed: 1 },
      { id: 21, windowId: 2, url: 'https://other.test/', title: 'Other', active: true, lastAccessed: 3 },
    ],
  };
}

function createChrome(shared) {
  const commands = [];
  const badges = [];
  const onChanged = event();
  const chrome = {
    commands,
    badges,
    sidePanel: { setPanelBehavior: () => {} },
    scripting: { executeScript: async () => {} },
    alarms: { create: () => {}, onAlarm: event() },
    action: {
      setBadgeText: async (details) => { badges.push(details); },
      setBadgeBackgroundColor: async () => {},
    },
    runtime: {
      id: 'ext',
      getURL: (path) => `chrome-extension://ext/${path}`,
      sendMessage: async () => {},
      onInstalled: event(),
      onConnect: event(),
      onMessage: event(),
    },
    storage: {
      onChanged,
      local: storageArea(shared.local, onChanged, 'local'),
      session: storageArea(shared.session, onChanged, 'session'),
    },
    windows: { getLastFocused: async () => ({ id: shared.focusedWindowId }) },
    tabs: {
      query: async (filter = {}) =>
        shared.tabs.filter(
          (tab) =>
            (filter.windowId == null || tab.windowId === filter.windowId) &&
            (filter.active == null || tab.active === filter.active),
        ),
      get: async (tabId) => {
        const tab = shared.tabs.find((candidate) => candidate.id === tabId);
        if (!tab) throw new Error('No tab with id: ' + tabId);
        return tab;
      },
      onActivated: event(),
      onDetached: event(),
      onRemoved: event(),
      onUpdated: event(),
      onReplaced: event(),
    },
    debugger: {
      onEvent: event(),
      onDetach: event(),
      attach: async ({ tabId }) => {
        if (shared.attached.has(tabId)) throw new Error('Another debugger is already attached to the tab with id: ' + tabId);
        shared.attached.add(tabId);
        commands.push({ tabId, method: 'attach' });
      },
      detach: async ({ tabId }) => {
        if (!shared.attached.delete(tabId)) throw new Error('Debugger is not attached');
        commands.push({ tabId, method: 'detach' });
      },
      sendCommand: async ({ tabId }, method, params) => {
        commands.push({ tabId, method, params });
        if (shared.results?.[method]) return shared.results[method];
        if (method === 'Network.getResponseBody') return { body: '{"ok":true}', base64Encoded: false };
        return {};
      },
    },
  };
  return chrome;
}

let instance = 0;
async function startWorker(shared) {
  const chrome = createChrome(shared);
  globalThis.chrome = chrome;
  await import(`../public/background.js?instance=${++instance}`);
  await tick();
  return chrome;
}

async function openPanel(chrome, windowId) {
  const port = {
    name: `sidepanel:${windowId}`,
    sender: { url: 'chrome-extension://ext/sidepanel.html' },
    messages: [],
    postMessage(message) { this.messages.push(structuredClone(message)); },
    onDisconnect: event(),
    onMessage: event(),
  };
  port.ofType = (type) => port.messages.filter((message) => message.type === type);
  chrome.runtime.onConnect.fire(port);
  await tick();
  return port;
}

function send(chrome, message) {
  return new Promise((resolve) => {
    chrome.runtime.onMessage.fire(message, { id: 'ext' }, resolve);
  });
}

async function completeRequest(chrome, tabId, requestId, url, extra = {}) {
  const source = { tabId };
  chrome.debugger.onEvent.fire(source, 'Network.requestWillBeSent', {
    requestId, type: 'XHR', timestamp: 1, wallTime: 1700000000,
    request: { url, method: 'GET', headers: {} }, ...extra,
  });
  chrome.debugger.onEvent.fire(source, 'Network.responseReceived', {
    requestId, response: { status: 200, statusText: 'OK', headers: {}, mimeType: 'application/json' },
  });
  chrome.debugger.onEvent.fire(source, 'Network.loadingFinished', { requestId, timestamp: 1.25 });
  await tick();
}

test('each window gets only the requests of its own tab', async () => {
  const shared = createShared();
  const chrome = await startWorker(shared);
  const first = await openPanel(chrome, 1);
  const second = await openPanel(chrome, 2);

  assert.deepEqual([...shared.attached].sort(), [11, 21]);
  assert.equal(first.ofType('TAB_SNAPSHOT')[0].tabId, 11);
  assert.equal(second.ofType('TAB_SNAPSHOT')[0].tabId, 21);
  assert.equal(first.ofType('DEBUGGER_STATUS').at(-1).status, 'attached');

  await completeRequest(chrome, 11, 'r1', 'https://one.test/api');

  const [received] = first.ofType('NEW_API_REQUEST');
  assert.equal(received.payload.url, 'https://one.test/api');
  assert.equal(received.payload.status, 200);
  assert.equal(received.payload.duration, 250);
  assert.deepEqual(received.payload.responseBody, { ok: true });
  assert.equal(second.ofType('NEW_API_REQUEST').length, 0, 'the other window must not see it');
  assert.deepEqual(chrome.badges.at(-1), { tabId: 11, text: '1' }, 'badge is set for the tab only');

  // Messages are answered for the window that sent them.
  assert.equal((await send(chrome, { type: 'GET_API_REQUESTS', windowId: 1 })).requests.length, 1);
  assert.equal((await send(chrome, { type: 'GET_API_REQUESTS', windowId: 2 })).requests.length, 0);
  await send(chrome, { type: 'CLEAR_API_REQUESTS', windowId: 2 });
  assert.equal((await send(chrome, { type: 'GET_API_REQUESTS', windowId: 1 })).requests.length, 1);
  await send(chrome, { type: 'SET_API_REQUESTS', windowId: 1, payload: [] });
  assert.equal((await send(chrome, { type: 'GET_API_REQUESTS', windowId: 1 })).requests.length, 0);
});

test('switching a tab moves only that window and closing the panel detaches', async () => {
  const shared = createShared();
  const chrome = await startWorker(shared);
  const first = await openPanel(chrome, 1);
  await openPanel(chrome, 2);

  chrome.tabs.onActivated.fire({ tabId: 12, windowId: 1 });
  await tick();
  assert.deepEqual([...shared.attached].sort(), [12, 21]);
  assert.equal(first.ofType('TAB_SNAPSHOT').at(-1).tabId, 12);

  first.onDisconnect.fire();
  await tick();
  assert.deepEqual([...shared.attached], [21]);
});

test('a redirect is reported as its own request', async () => {
  const shared = createShared();
  const chrome = await startWorker(shared);
  const panel = await openPanel(chrome, 1);

  chrome.debugger.onEvent.fire({ tabId: 11 }, 'Network.requestWillBeSent', {
    requestId: 'r1', type: 'Fetch', timestamp: 1, request: { url: 'https://one.test/old', method: 'GET', headers: {} },
  });
  await completeRequest(chrome, 11, 'r1', 'https://one.test/new', {
    timestamp: 1.1,
    redirectResponse: { status: 302, statusText: 'Found', headers: { location: '/new' } },
  });

  const requests = panel.ofType('NEW_API_REQUEST').map((message) => message.payload);
  assert.deepEqual(requests.map((request) => [request.url, request.status]), [
    ['https://one.test/old', 302],
    ['https://one.test/new', 200],
  ]);
  assert.equal(requests[0].duration, 100);
});

test('a mock saved to storage is applied and reported once', async () => {
  const shared = createShared();
  const chrome = await startWorker(shared);
  const panel = await openPanel(chrome, 1);

  await send(chrome, {
    type: 'SAVE_MOCK_RULES',
    payload: [{ id: 'm1', enabled: true, method: 'ALL', urlPattern: '/api/items', status: 503, responseBody: '{"error":"down"}' }],
  });
  const enable = chrome.commands.filter((command) => command.method === 'Fetch.enable');
  assert.equal(enable.length, 1, 'patterns are applied once, not once per notification');
  assert.equal(enable[0].params.patterns[0].urlPattern, '*/api/items*');

  chrome.debugger.onEvent.fire({ tabId: 11 }, 'Fetch.requestPaused', {
    requestId: 'f1', networkId: 'n1', resourceType: 'XHR',
    request: { url: 'https://one.test/api/items', method: 'GET', headers: {} },
  });
  await tick();
  // The Network domain reports the same request: it must not be shown twice.
  chrome.debugger.onEvent.fire({ tabId: 11 }, 'Network.requestWillBeSent', {
    requestId: 'n1', type: 'XHR', timestamp: 1, request: { url: 'https://one.test/api/items', method: 'GET', headers: {} },
  });
  chrome.debugger.onEvent.fire({ tabId: 11 }, 'Network.loadingFinished', { requestId: 'n1', timestamp: 1.1 });
  await tick();

  const fulfil = chrome.commands.find((command) => command.method === 'Fetch.fulfillRequest');
  assert.equal(fulfil.params.responseCode, 503);
  const requests = panel.ofType('NEW_API_REQUEST').map((message) => message.payload);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].mocked, true);
  assert.equal(requests[0].type, 'xhr');
  assert.deepEqual(requests[0].responseBody, { error: 'down' });
});

test('a mock made from a captured request drops encoding headers and splits multi-line values', async () => {
  const shared = createShared();
  const chrome = await startWorker(shared);
  await openPanel(chrome, 1);

  await send(chrome, {
    type: 'SAVE_MOCK_RULES',
    payload: [{
      id: 'm1', enabled: true, method: 'ALL', urlPattern: '/api/summary', status: 200, responseBody: '{"ок":1}',
      responseHeaders: {
        'content-type': 'application/json; charset=utf-8',
        'content-encoding': 'br',
        'Content-Length': '12345',
        'transfer-encoding': 'chunked',
        'set-cookie': 'a=1\nb=2',
      },
    }],
  });
  chrome.debugger.onEvent.fire({ tabId: 11 }, 'Fetch.requestPaused', {
    requestId: 'f1', resourceType: 'Fetch',
    request: { url: 'https://one.test/api/summary?tsf=1', method: 'GET', headers: {} },
  });
  await tick();

  const fulfil = chrome.commands.find((command) => command.method === 'Fetch.fulfillRequest');
  assert.ok(fulfil, 'the mock is fulfilled, not passed to the server');
  assert.deepEqual(fulfil.params.responseHeaders, [
    { name: 'content-type', value: 'application/json; charset=utf-8' },
    { name: 'set-cookie', value: 'a=1' },
    { name: 'set-cookie', value: 'b=2' },
  ]);
  assert.equal(Buffer.from(fulfil.params.body, 'base64').toString('utf8'), '{"ок":1}');
});

test('a breakpoint pauses the request and resume continues it', async () => {
  const shared = createShared();
  shared.local.breakpointRules = [{ id: 'b1', enabled: true, method: 'POST', urlPattern: '/pay' }];
  const chrome = await startWorker(shared);
  const panel = await openPanel(chrome, 1);

  chrome.debugger.onEvent.fire({ tabId: 11 }, 'Fetch.requestPaused', {
    requestId: 'f1', resourceType: 'Fetch', request: { url: 'https://one.test/pay', method: 'POST', headers: {} },
  });
  await tick();
  const [paused] = panel.ofType('BREAKPOINT_REQUEST_PAUSED');
  assert.equal(paused.tabId, 11);

  chrome.runtime.onMessage.fire(
    { type: 'RESUME_PAUSED_REQUEST', requestId: paused.requestId, tabId: paused.tabId, action: 'continue' },
    { id: 'ext' },
    () => {},
  );
  await tick();
  assert.ok(chrome.commands.some((command) => command.method === 'Fetch.continueRequest' && command.params.requestId === 'f1'));
});

test('captured requests survive a service worker restart', async () => {
  const shared = createShared();
  const before = await startWorker(shared);
  await openPanel(before, 1);
  await completeRequest(before, 11, 'r1', 'https://one.test/api');
  await tick(650); // debounced save to chrome.storage.session
  assert.equal(shared.session.capture_11.requests.length, 1);

  // The worker is gone, the debugger session and the session storage are still there.
  const after = await startWorker(shared);
  const panel = await openPanel(after, 1);

  const snapshot = panel.ofType('TAB_SNAPSHOT')[0];
  assert.equal(snapshot.requests.length, 1);
  assert.equal(snapshot.requests[0].url, 'https://one.test/api');
  assert.equal(panel.ofType('DEBUGGER_STATUS').at(-1).status, 'attached', 're-attaches over the stale session');
  assert.deepEqual(after.commands.filter((command) => command.method === 'attach' || command.method === 'detach').map((command) => command.method), ['detach', 'attach']);
});

test('expired sessions are removed without reading their bodies', async () => {
  const shared = createShared();
  const now = Date.now();
  shared.local.sessions = [
    { id: 'new', name: 'n', timestamp: now, count: 1 },
    { id: 'old', name: 'o', timestamp: now - 86400001, count: 1 },
  ];
  shared.local.session_new = [{ id: 1 }];
  shared.local.session_old = [{ id: 2 }];
  shared.local.mockRules = [];
  await startWorker(shared);
  await tick();

  assert.deepEqual(shared.local.sessions.map((session) => session.id), ['new']);
  assert.ok('session_new' in shared.local);
  assert.ok(!('session_old' in shared.local));
  assert.ok('mockRules' in shared.local);
});

// ---- 2.2.0: capture settings, real headers, timings, interception ---------------------------------

const requestsOf = (panel) => panel.ofType('NEW_API_REQUEST').map((message) => message.payload);
const commandsOf = (chrome, method) => chrome.commands.filter((command) => command.method === method);
const fromBase64 = (text) => Buffer.from(text, 'base64').toString('utf8');

test('a navigation clears the log unless it is preserved', async () => {
  const shared = createShared();
  const chrome = await startWorker(shared);
  const panel = await openPanel(chrome, 1);
  await completeRequest(chrome, 11, 'r1', 'https://one.test/login');

  chrome.tabs.onUpdated.fire(11, { status: 'loading' });
  await tick();
  assert.equal((await send(chrome, { type: 'GET_API_REQUESTS', windowId: 1 })).requests.length, 0);
  assert.equal(panel.ofType('TAB_SNAPSHOT').at(-1).requests.length, 0, 'the panel is told to start over');

  await chrome.storage.local.set({ captureSettings: { preserveLog: true } });
  await completeRequest(chrome, 11, 'r2', 'https://one.test/login');
  chrome.tabs.onUpdated.fire(11, { status: 'loading' });
  await tick();
  await completeRequest(chrome, 11, 'r3', 'https://one.test/dashboard');
  const kept = (await send(chrome, { type: 'GET_API_REQUESTS', windowId: 1 })).requests;
  assert.deepEqual(kept.map((request) => request.url), ['https://one.test/dashboard', 'https://one.test/login']);
});

test('the request limit comes from the settings and old requests lose their bodies', async () => {
  const shared = createShared();
  shared.local.captureSettings = { maxRequests: 250 };
  const chrome = await startWorker(shared);
  await openPanel(chrome, 1);
  for (let index = 0; index < 260; index++) {
    const source = { tabId: 11 };
    chrome.debugger.onEvent.fire(source, 'Network.requestWillBeSent', {
      requestId: 'r' + index, type: 'XHR', timestamp: 1, request: { url: 'https://one.test/api/' + index, method: 'GET', headers: {} },
    });
    chrome.debugger.onEvent.fire(source, 'Network.responseReceived', {
      requestId: 'r' + index, response: { status: 200, statusText: 'OK', headers: {}, mimeType: 'application/json' },
    });
    chrome.debugger.onEvent.fire(source, 'Network.loadingFinished', { requestId: 'r' + index, timestamp: 1.1 });
  }
  await tick(60);

  const { requests } = await send(chrome, { type: 'GET_API_REQUESTS', windowId: 1 });
  assert.equal(requests.length, 250);
  assert.deepEqual(requests[0].responseBody, { ok: true }, 'new requests keep their bodies');
  assert.equal(typeof requests[249].responseBody, 'string', 'requests beyond the newest 200 keep only a marker');

  // A lower limit applies at once.
  await chrome.storage.local.set({ captureSettings: { maxRequests: 50 } });
  await tick();
  assert.equal((await send(chrome, { type: 'GET_API_REQUESTS', windowId: 1 })).requests.length, 50);
});

test('other resource types are listed only when asked for, without bodies', async () => {
  const shared = createShared();
  const chrome = await startWorker(shared);
  const panel = await openPanel(chrome, 1);
  const script = { type: 'Script', request: { url: 'https://one.test/app.js', method: 'GET', headers: {} } };

  await completeRequest(chrome, 11, 's1', 'https://one.test/app.js', script);
  assert.equal(requestsOf(panel).length, 0, 'scripts are skipped by default');

  await chrome.storage.local.set({ captureSettings: { captureAllResources: true } });
  const before = commandsOf(chrome, 'Network.getResponseBody').length;
  await completeRequest(chrome, 11, 's2', 'https://one.test/app.js', script);
  const [request] = requestsOf(panel);
  assert.equal(request.type, 'script');
  assert.equal(request.responseBody, null);
  assert.equal(commandsOf(chrome, 'Network.getResponseBody').length, before, 'the body is not downloaded');
});

test('headers from the wire and the timing breakdown are attached to the request', async () => {
  const shared = createShared();
  const chrome = await startWorker(shared);
  const panel = await openPanel(chrome, 1);
  const source = { tabId: 11 };

  chrome.debugger.onEvent.fire(source, 'Network.requestWillBeSent', {
    requestId: 'r1', type: 'Fetch', timestamp: 10, wallTime: 1700000000,
    request: { url: 'https://one.test/api/me', method: 'GET', headers: { Accept: '*/*' } },
  });
  chrome.debugger.onEvent.fire(source, 'Network.requestWillBeSentExtraInfo', {
    requestId: 'r1', headers: { ':authority': 'one.test', accept: 'application/json', cookie: 'sid=1' },
  });
  chrome.debugger.onEvent.fire(source, 'Network.responseReceivedExtraInfo', {
    requestId: 'r1', headers: { 'set-cookie': 'sid=2' },
  });
  chrome.debugger.onEvent.fire(source, 'Network.responseReceived', {
    requestId: 'r1',
    response: {
      status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, mimeType: 'application/json',
      protocol: 'h2', remoteIPAddress: '10.0.0.1', remotePort: 443,
      timing: { requestTime: 10.01, dnsStart: 0, dnsEnd: 5, connectStart: 5, connectEnd: 25, sslStart: 10, sslEnd: 25, sendStart: 25, sendEnd: 26, receiveHeadersEnd: 126 },
    },
  });
  chrome.debugger.onEvent.fire(source, 'Network.loadingFinished', { requestId: 'r1', timestamp: 10.2, encodedDataLength: 512 });
  await tick();

  const [request] = requestsOf(panel);
  assert.deepEqual(request.requestHeaders, { accept: 'application/json', cookie: 'sid=1' });
  assert.equal(request.responseHeaders['set-cookie'], 'sid=2');
  assert.equal(request.responseHeaders['content-type'], 'application/json');
  assert.deepEqual(request.timings, { blocked: 10, dns: 5, connect: 5, ssl: 15, send: 1, wait: 100, receive: 64 });
  assert.equal(request.protocol, 'h2');
  assert.equal(request.remoteAddress, '10.0.0.1:443');
  assert.equal(request.transferSize, 512);
  assert.ok(!('_timing' in request) && !('_requestId' in request), 'internal fields are not sent to the panel');
});

test('a request edited at a breakpoint is sent with the changes and shown as modified', async () => {
  const shared = createShared();
  shared.local.breakpointRules = [{ id: 'b1', enabled: true, method: 'POST', urlPattern: '/pay' }];
  const chrome = await startWorker(shared);
  const panel = await openPanel(chrome, 1);
  const source = { tabId: 11 };

  chrome.debugger.onEvent.fire(source, 'Network.requestWillBeSent', {
    requestId: 'n1', type: 'Fetch', timestamp: 1,
    request: { url: 'https://one.test/pay', method: 'POST', headers: { 'content-type': 'application/json' }, postData: '{"amount":10}' },
  });
  chrome.debugger.onEvent.fire(source, 'Fetch.requestPaused', {
    requestId: 'f1', networkId: 'n1', resourceType: 'Fetch',
    request: { url: 'https://one.test/pay', method: 'POST', headers: { 'content-type': 'application/json' }, postData: '{"amount":10}' },
  });
  await tick();
  const [paused] = panel.ofType('BREAKPOINT_REQUEST_PAUSED');
  assert.equal(paused.stage, 'request');
  assert.equal(paused.request.postData, '{"amount":10}');

  chrome.runtime.onMessage.fire(
    { type: 'RESUME_PAUSED_REQUEST', requestId: 'f1', tabId: 11, action: 'continue', overrides: { postData: '{"amount":-1}', headers: { 'x-test': '1' } } },
    { id: 'ext' },
    () => {},
  );
  await tick();
  const resumed = commandsOf(chrome, 'Fetch.continueRequest').at(-1).params;
  assert.equal(fromBase64(resumed.postData), '{"amount":-1}');
  assert.deepEqual(resumed.headers, [{ name: 'x-test', value: '1' }]);
  assert.ok(!('url' in resumed), 'what was not edited is not overridden');

  chrome.debugger.onEvent.fire(source, 'Network.responseReceived', {
    requestId: 'n1', response: { status: 422, statusText: 'Unprocessable', headers: {}, mimeType: 'application/json' },
  });
  chrome.debugger.onEvent.fire(source, 'Network.loadingFinished', { requestId: 'n1', timestamp: 1.5 });
  await tick();
  const [request] = requestsOf(panel);
  assert.equal(request.requestBody, '{"amount":-1}', 'the list shows what was really sent');
  assert.equal(request.modified, true);
  assert.equal(request.status, 422);
});

test('a response paused at a breakpoint can be edited before the page gets it', async () => {
  const shared = createShared();
  shared.local.breakpointRules = [{ id: 'b1', enabled: true, method: 'ALL', urlPattern: '/cart', stage: 'response' }];
  shared.results = { 'Fetch.getResponseBody': { body: '{"items":[1,2]}', base64Encoded: false } };
  const chrome = await startWorker(shared);
  const panel = await openPanel(chrome, 1);
  const source = { tabId: 11 };
  assert.deepEqual(commandsOf(chrome, 'Fetch.enable')[0].params.patterns, [{ urlPattern: '*/cart*', requestStage: 'Response' }]);

  const request = { url: 'https://one.test/cart', method: 'GET', headers: {} };
  chrome.debugger.onEvent.fire(source, 'Network.requestWillBeSent', { requestId: 'n1', type: 'XHR', timestamp: 1, request });
  chrome.debugger.onEvent.fire(source, 'Fetch.requestPaused', {
    requestId: 'f1', networkId: 'n1', resourceType: 'XHR', request,
    responseStatusCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'content-length', value: '15' }],
  });
  await tick();
  const [paused] = panel.ofType('BREAKPOINT_REQUEST_PAUSED');
  assert.equal(paused.stage, 'response');
  assert.deepEqual(paused.response, { status: 200, headers: { 'content-type': 'application/json', 'content-length': '15' }, body: '{"items":[1,2]}', binary: false });

  chrome.runtime.onMessage.fire(
    { type: 'RESUME_PAUSED_REQUEST', requestId: 'f1', tabId: 11, action: 'continue', overrides: { status: 200, headers: paused.response.headers, body: '{"items":[]}' } },
    { id: 'ext' },
    () => {},
  );
  await tick();
  const fulfil = commandsOf(chrome, 'Fetch.fulfillRequest').at(-1).params;
  assert.equal(fromBase64(fulfil.body), '{"items":[]}');
  assert.deepEqual(fulfil.responseHeaders, [{ name: 'content-type', value: 'application/json' }], 'the old content-length is dropped');

  // The Network domain reports the same request: it is shown once, as modified.
  chrome.debugger.onEvent.fire(source, 'Network.loadingFinished', { requestId: 'n1', timestamp: 1.2 });
  await tick();
  const requests = requestsOf(panel);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].modified, true);
  assert.deepEqual(requests[0].responseBody, { items: [] });
});

test('a patch rule changes fields of the real response', async () => {
  const shared = createShared();
  shared.local.mockRules = [{
    id: 'p1', enabled: true, method: 'ALL', urlPattern: '/api/order', mode: 'patch',
    patches: [{ path: '$.total', value: '-5' }, { path: '$.items[*].price', value: '0' }, { path: '$.debug', value: '', remove: true }],
  }];
  shared.results = { 'Fetch.getResponseBody': { body: '{"total":30,"items":[{"price":10},{"price":20}],"debug":true}', base64Encoded: false } };
  const chrome = await startWorker(shared);
  const panel = await openPanel(chrome, 1);
  const source = { tabId: 11 };
  const request = { url: 'https://one.test/api/order', method: 'GET', headers: {} };

  // Before the request is sent the rule does nothing.
  chrome.debugger.onEvent.fire(source, 'Fetch.requestPaused', { requestId: 'f0', networkId: 'n1', resourceType: 'Fetch', request });
  await tick();
  assert.equal(commandsOf(chrome, 'Fetch.fulfillRequest').length, 0);

  chrome.debugger.onEvent.fire(source, 'Fetch.requestPaused', {
    requestId: 'f1', networkId: 'n1', resourceType: 'Fetch', request,
    responseStatusCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }],
  });
  await tick();
  const fulfil = commandsOf(chrome, 'Fetch.fulfillRequest')[0].params;
  assert.equal(fulfil.responseCode, 200);
  assert.deepEqual(JSON.parse(fromBase64(fulfil.body)), { total: -5, items: [{ price: 0 }, { price: 0 }] });
  const [reported] = requestsOf(panel);
  assert.equal(reported.modified, true);
  assert.deepEqual(reported.responseBody, { total: -5, items: [{ price: 0 }, { price: 0 }] });
});

test('block and delay rules act on the real request', async () => {
  const shared = createShared();
  shared.local.mockRules = [
    { id: 'x1', enabled: true, method: 'ALL', urlPattern: 'analytics.test', mode: 'block' },
    { id: 'd1', enabled: true, method: 'ALL', urlPattern: '/slow', mode: 'delay', delay: 40 },
  ];
  const chrome = await startWorker(shared);
  await openPanel(chrome, 1);
  const source = { tabId: 11 };

  chrome.debugger.onEvent.fire(source, 'Fetch.requestPaused', {
    requestId: 'f1', resourceType: 'Script', request: { url: 'https://analytics.test/tag.js', method: 'GET', headers: {} },
  });
  await tick();
  assert.deepEqual(commandsOf(chrome, 'Fetch.failRequest')[0].params, { requestId: 'f1', errorReason: 'BlockedByClient' });

  chrome.debugger.onEvent.fire(source, 'Fetch.requestPaused', {
    requestId: 'f2', resourceType: 'XHR', request: { url: 'https://one.test/slow', method: 'GET', headers: {} },
  });
  await tick(10);
  assert.ok(!commandsOf(chrome, 'Fetch.continueRequest').some((command) => command.params.requestId === 'f2'), 'still waiting');
  await tick(60);
  assert.ok(commandsOf(chrome, 'Fetch.continueRequest').some((command) => command.params.requestId === 'f2'));
  assert.equal(commandsOf(chrome, 'Fetch.fulfillRequest').length, 0, 'the response stays real');
});

test('throttling is applied on attach and when the setting changes', async () => {
  const shared = createShared();
  shared.local.captureSettings = { throttle: 'offline' };
  const chrome = await startWorker(shared);
  await openPanel(chrome, 1);
  assert.equal(commandsOf(chrome, 'Network.emulateNetworkConditions').at(-1).params.offline, true);

  await chrome.storage.local.set({ captureSettings: { throttle: 'none' } });
  await tick();
  const last = commandsOf(chrome, 'Network.emulateNetworkConditions').at(-1).params;
  assert.deepEqual(last, { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

test('binary WebSocket frames keep their size and a prefix for the hex view', async () => {
  const shared = createShared();
  const chrome = await startWorker(shared);
  await openPanel(chrome, 1);
  const source = { tabId: 11 };
  chrome.debugger.onEvent.fire(source, 'Network.webSocketCreated', { requestId: 'w1', url: 'wss://one.test/ws' });
  chrome.debugger.onEvent.fire(source, 'Network.webSocketFrameReceived', {
    requestId: 'w1', response: { opcode: 2, payloadData: Buffer.from([0, 1, 2, 255]).toString('base64') },
  });
  chrome.debugger.onEvent.fire(source, 'Network.webSocketFrameSent', { requestId: 'w1', response: { opcode: 1, payloadData: 'ping' } });
  await tick();

  const { messages } = await send(chrome, { type: 'GET_STREAM_MESSAGES', windowId: 1 });
  assert.equal(messages[0].binary, true);
  assert.equal(messages[0].size, 4);
  assert.equal(messages[0].data, 'AAEC/w==');
  assert.equal(messages[1].binary, undefined);
  assert.equal(messages[1].data, 'ping');
});

test('a screenshot of the captured tab is returned as a data URL', async () => {
  const shared = createShared();
  shared.results = {
    'Page.captureScreenshot': { data: 'UE5H' },
    'Page.getLayoutMetrics': { cssContentSize: { width: 1200, height: 30000 } },
  };
  const chrome = await startWorker(shared);
  await openPanel(chrome, 1);

  const response = await send(chrome, { type: 'CAPTURE_SCREENSHOT', windowId: 1, fullPage: true });
  assert.deepEqual(response, { success: true, dataUrl: 'data:image/png;base64,UE5H' });
  const { params } = commandsOf(chrome, 'Page.captureScreenshot')[0];
  assert.equal(params.captureBeyondViewport, true);
  assert.deepEqual(params.clip, { x: 0, y: 0, width: 1200, height: 16384, scale: 1 });
});

test('pinned sessions survive the cleanup', async () => {
  const shared = createShared();
  const now = Date.now();
  shared.local.sessions = [
    { id: 'reference', name: 'before release', timestamp: now - 30 * 86400000, count: 1, pinned: true },
    { id: 'old', name: 'o', timestamp: now - 86400001, count: 1 },
  ];
  shared.local.session_reference = [{ id: 1 }];
  shared.local.session_old = [{ id: 2 }];
  await startWorker(shared);
  await tick();

  assert.deepEqual(shared.local.sessions.map((session) => session.id), ['reference']);
  assert.ok('session_reference' in shared.local);
  assert.ok(!('session_old' in shared.local));
});
