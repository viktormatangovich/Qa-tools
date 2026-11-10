import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyJsonPatches,
  BODY_DROPPED,
  BODY_NOT_PERSISTED,
  computeTimings,
  decodeBody,
  decodeText,
  defaultCaptureSettings,
  encodeBase64,
  headerEntries,
  headersFromEntries,
  mergeHeaders,
  networkConditions,
  normalizeCaptureSettings,
  parsePanelPortName,
  pickTargetTab,
  resourceKind,
  retainSessions,
  stripBodies,
  trimForPersistence,
} from '../public/captureStore.js';

test('pickTargetTab prefers the active website tab', () => {
  const tabs = [
    { id: 1, url: 'https://a.test/', active: false, lastAccessed: 50 },
    { id: 2, url: 'https://b.test/', active: true, lastAccessed: 10 },
  ];
  assert.equal(pickTargetTab(tabs).id, 2);
});

test('pickTargetTab falls back to the most recent website tab when the panel page is active', () => {
  const tabs = [
    { id: 1, url: 'https://a.test/', active: false, lastAccessed: 50 },
    { id: 2, url: 'http://b.test/', active: false, lastAccessed: 90 },
    { id: 3, url: 'chrome-extension://abc/sidepanel.html', active: true, lastAccessed: 100 },
  ];
  assert.equal(pickTargetTab(tabs).id, 2);
});

test('pickTargetTab returns null without website tabs', () => {
  assert.equal(pickTargetTab([{ id: 1, url: 'chrome://extensions', active: true }]), null);
  assert.equal(pickTargetTab([]), null);
});

test('parsePanelPortName reads the window id', () => {
  assert.deepEqual(parsePanelPortName('sidepanel:42'), { isPanel: true, windowId: 42 });
  assert.deepEqual(parsePanelPortName('sidepanel'), { isPanel: true, windowId: null });
  assert.equal(parsePanelPortName('sidepanel:abc').isPanel, false);
  assert.equal(parsePanelPortName('other').isPanel, false);
});

test('decodeBody decodes base64 UTF-8 text', () => {
  const base64 = Buffer.from('{"name":"Проверка"}', 'utf8').toString('base64');
  assert.equal(decodeBody(base64, true), '{"name":"Проверка"}');
  assert.equal(decodeBody('plain', false), 'plain');
});

test('decodeBody keeps binary data as a byte string', () => {
  const base64 = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64');
  const decoded = decodeBody(base64, true);
  assert.equal(decoded.length, 4);
  assert.equal(decoded.charCodeAt(0), 0xff);
});

test('trimForPersistence keeps newest bodies and strips the rest over budget', () => {
  const body = 'x'.repeat(1000);
  const requests = [1, 2, 3].map((id) => ({ id, url: '/a', requestBody: null, responseBody: body }));
  const one = JSON.stringify(requests[0]).length;
  const result = trimForPersistence(requests, one + 10);
  assert.equal(result[0].responseBody, body);
  assert.equal(result[1].responseBody, BODY_NOT_PERSISTED);
  assert.equal(result[2].responseBody, BODY_NOT_PERSISTED);
  assert.equal(result[1].requestBody, null, 'an absent body stays absent');
  assert.equal(requests[1].responseBody, body, 'the source list is not modified');
});

test('trimForPersistence returns the same objects when everything fits', () => {
  const requests = [{ id: 1, responseBody: 'a' }, { id: 2, responseBody: 'b' }];
  const result = trimForPersistence(requests, 1e6);
  assert.equal(result[0], requests[0]);
  assert.equal(result[1], requests[1]);
});

test('retainSessions keeps three newest sessions of the last 24 hours', () => {
  const now = 1_000_000_000;
  const sessions = [
    { id: 'old', timestamp: now - 86400001 },
    { id: 'a', timestamp: now - 4 },
    { id: 'b', timestamp: now - 1 },
    { id: 'c', timestamp: now - 3 },
    { id: 'd', timestamp: now - 2 },
  ];
  assert.deepEqual(retainSessions(sessions, now).map((s) => s.id), ['b', 'd', 'c']);
});

// ---- 2.2.0 helpers ----------------------------------------------------------------------------

test('retainSessions always keeps pinned sessions', () => {
  const now = 1_000_000_000_000;
  const day = 86400000;
  const sessions = [
    { id: 'ref', timestamp: now - 40 * day, pinned: true },
    { id: 'a', timestamp: now - 1000 },
    { id: 'b', timestamp: now - 2000 },
    { id: 'c', timestamp: now - 3000 },
    { id: 'd', timestamp: now - 4000 },
    { id: 'expired', timestamp: now - day - 1 },
  ];
  assert.deepEqual(retainSessions(sessions, now).map((session) => session.id), ['a', 'b', 'c', 'ref']);
});

test('normalizeCaptureSettings fills defaults and clamps values', () => {
  assert.deepEqual(normalizeCaptureSettings(undefined), defaultCaptureSettings);
  const settings = normalizeCaptureSettings({ maxRequests: 99999, throttle: 'warp', preserveLog: 1, customLatencyMs: -5 });
  assert.equal(settings.maxRequests, 1000);
  assert.equal(settings.throttle, 'none');
  assert.equal(settings.preserveLog, true);
  assert.equal(settings.customLatencyMs, 0);
  assert.equal(normalizeCaptureSettings({ maxRequests: 3 }).maxRequests, 50);
  assert.equal(normalizeCaptureSettings({ maxRequests: 'many' }).maxRequests, 100);
});

test('networkConditions converts kbit/s of a custom profile to bytes per second', () => {
  const custom = normalizeCaptureSettings({ throttle: 'custom', customLatencyMs: 200, customDownloadKbps: 800, customUploadKbps: 80 });
  assert.deepEqual(networkConditions(custom), { offline: false, latency: 200, downloadThroughput: 102400, uploadThroughput: 10240 });
  assert.equal(networkConditions(normalizeCaptureSettings({ throttle: 'offline' })).offline, true);
});

test('resourceKind maps CDP types and leaves streams out', () => {
  assert.equal(resourceKind('XHR'), 'xhr');
  assert.equal(resourceKind('Fetch'), 'fetch');
  assert.equal(resourceKind('Stylesheet'), 'stylesheet');
  assert.equal(resourceKind('Ping'), 'other');
  assert.equal(resourceKind('WebSocket'), null);
  assert.equal(resourceKind('EventSource'), null);
});

test('stripBodies replaces bodies once and keeps empty ones empty', () => {
  const request = { id: 1, requestBody: null, responseBody: { a: 1 } };
  const stripped = stripBodies(request);
  assert.equal(stripped.requestBody, null);
  assert.equal(stripped.responseBody, BODY_DROPPED);
  assert.equal(stripBodies(stripped), stripped, 'nothing left to drop: the same object');
});

test('mergeHeaders prefers headers from the wire and drops pseudo-headers', () => {
  const merged = mergeHeaders({ Accept: '*/*', 'X-Requested-With': 'XMLHttpRequest' }, { ':method': 'GET', accept: 'application/json', cookie: 'sid=1' });
  assert.deepEqual(merged, { 'X-Requested-With': 'XMLHttpRequest', accept: 'application/json', cookie: 'sid=1' });
  assert.deepEqual(mergeHeaders(undefined, undefined), {});
});

test('computeTimings splits a request into phases', () => {
  const timing = { requestTime: 100.05, dnsStart: -1, dnsEnd: -1, connectStart: -1, connectEnd: -1, sslStart: -1, sslEnd: -1, sendStart: 2, sendEnd: 3, receiveHeadersEnd: 43 };
  // Reused connection: no DNS, connect or TLS; 50 ms queued before the request started.
  assert.deepEqual(computeTimings(timing, 100, 100.2), { blocked: 52, dns: 0, connect: 0, ssl: 0, send: 1, wait: 40, receive: 107 });
  assert.equal(computeTimings(undefined, 1, 2), null);
});

test('decodeText and encodeBase64 round-trip UTF-8 and flag binary data', () => {
  const encoded = encodeBase64('{"name":"Привет"}');
  assert.deepEqual(decodeText(encoded, true), { text: '{"name":"Привет"}', binary: false });
  assert.equal(decodeText(Buffer.from([0xff, 0xfe, 0x00]).toString('base64'), true).binary, true);
  assert.deepEqual(decodeText('plain', false), { text: 'plain', binary: false });
});

test('header entries convert both ways', () => {
  assert.deepEqual(headerEntries({ a: 1, ':path': '/' }), [{ name: 'a', value: '1' }]);
  assert.deepEqual(headersFromEntries([{ name: 'set-cookie', value: 'a=1' }, { name: 'set-cookie', value: 'b=2' }]), { 'set-cookie': 'a=1, b=2' });
});

test('applyJsonPatches sets, adds and removes values by path', () => {
  const source = { total: 30, items: [{ id: 1, price: 10 }, { id: 2, price: 20 }], meta: { debug: true } };
  const patched = applyJsonPatches(source, [
    { path: '$.total', value: '0' },
    { path: '$.items[*].price', value: '-1' },
    { path: '$.items[0].name', value: 'not json' },
    { path: '$.meta.debug', value: '', remove: true },
    { path: '$.missing.deep', value: '1' },
  ]);
  assert.deepEqual(patched, { total: 0, items: [{ id: 1, price: -1, name: 'not json' }, { id: 2, price: -1 }], meta: {} });
  assert.equal(source.total, 30, 'the source is not changed');
  assert.deepEqual(applyJsonPatches({ list: [1, 2, 3] }, [{ path: '$.list[1]', value: '', remove: true }]), { list: [1, 3] });
  assert.deepEqual(applyJsonPatches({ a: 1 }, [{ path: '$', value: '[]' }]), []);
});
