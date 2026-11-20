// Tests for the 2.4.0 helpers: JWT, PowerShell/Python snippets, endpoint history, watchdog,
// palette ranking, update check and list virtualisation.
import assert from "node:assert/strict";
import test from "node:test";
import type { ApiRequest } from "../types.ts";
import { decodeJwt, findJwts, jwtState, jwtTimes } from "./jwt.ts";
import { generatePowerShell, generatePython } from "./snippets.ts";
import { endpointHistory, endpointKey, jsonChanges } from "./endpointHistory.ts";
import { DEFAULT_WATCH_SLOW_MS, isWatched, toggleWatched, watchAlertFor } from "./watchdog.ts";
import { fuzzyScore, rankByQuery } from "./fuzzy.ts";
import { compareVersions, isCheckDue, parseLatestRelease, parseManifestVersion, UPDATE_CHECK_INTERVAL_MS } from "./version.ts";
import { prefixOffsets, visibleRange } from "./virtualList.ts";

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.c2lnbmF0dXJl`;

function request(partial: Partial<ApiRequest>): ApiRequest {
  return {
    id: crypto.randomUUID(),
    type: "fetch",
    method: "GET",
    url: "https://api.test/items",
    requestHeaders: {},
    requestBody: null,
    status: 200,
    statusText: "OK",
    responseHeaders: {},
    responseBody: null,
    duration: 100,
    timestamp: Date.now(),
    error: null,
    pageUrl: "https://app.test/",
    pageTitle: "App",
    ...partial,
  } as ApiRequest;
}

// ---- JWT --------------------------------------------------------------------------------------

test("a JWT is decoded without checking the signature, Cyrillic claims included", () => {
  const token = jwt({ sub: "42", name: "Иван", exp: 2_000_000_000 });
  const decoded = decodeJwt(token);
  assert.equal(decoded?.header.alg, "HS256");
  assert.equal(decoded?.payload.name, "Иван");
  assert.equal(decodeJwt("not.a.token"), null);
  assert.equal(decodeJwt("abc"), null);
});

test("JWTs are found in Authorization, cookies, URL parameters and response fields, once each", () => {
  const access = jwt({ sub: "1", exp: 1 });
  const refresh = jwt({ sub: "1", typ: "refresh" });
  const found = findJwts(request({
    url: `https://api.test/ws?token=${access}`,
    requestHeaders: { Authorization: `Bearer ${access}`, Cookie: `theme=dark; refresh_token=${refresh}` },
    responseBody: { data: { tokens: [{ access_token: jwt({ sub: "2" }) }] } },
  }));
  assert.deepEqual(found.map((item) => `${item.source.kind}:${item.source.name}`), [
    "header:Authorization",
    "cookie:refresh_token",
    "response:data.tokens[0].access_token",
  ]);
});

test("token times are in milliseconds and the state depends on the moment", () => {
  const payload = { exp: 2000, nbf: 1000, iat: 900 };
  assert.deepEqual(jwtTimes(payload), { exp: 2_000_000, nbf: 1_000_000, iat: 900_000 });
  assert.equal(jwtState(payload, 500_000), "notYetValid");
  assert.equal(jwtState(payload, 1_500_000), "valid");
  assert.equal(jwtState(payload, 2_000_000), "expired");
  assert.equal(jwtState({}, Date.now()), "valid");
});

// ---- Snippets ---------------------------------------------------------------------------------

test("PowerShell: Content-Type and User-Agent use their own parameters, quotes are doubled", () => {
  const code = generatePowerShell(request({
    method: "POST",
    url: "https://api.test/items?q=it's",
    requestHeaders: { "Content-Type": "application/json", "User-Agent": "UA", "X-Trace": "a'b", ":authority": "api.test", "Content-Length": "10" },
    requestBody: '{"name":"Ёж"}',
  }));
  assert.match(code, /\$headers = @\{\n  'X-Trace' = 'a''b'\n\}/);
  assert.match(code, /-Uri 'https:\/\/api\.test\/items\?q=it''s'/);
  assert.match(code, /-ContentType 'application\/json'/);
  assert.match(code, /-UserAgent 'UA'/);
  assert.match(code, /\$body = @'\n\{"name":"Ёж"\}\n'@/);
  assert.match(code, /UTF8\.GetBytes\(\$body\)/);
  assert.doesNotMatch(code, /authority|Content-Length/);
});

test("PowerShell: a GET without headers is a single command", () => {
  const code = generatePowerShell(request({}));
  assert.doesNotMatch(code, /\$headers|\$body/);
  assert.match(code, /Invoke-WebRequest -Uri 'https:\/\/api\.test\/items'/);
});

test("Python: strings are JSON literals and the body is sent as bytes", () => {
  const code = generatePython(request({ method: "PUT", requestHeaders: { Accept: 'a"b' }, requestBody: { a: 1 } }));
  assert.match(code, /"PUT",/);
  assert.match(code, /"Accept": "a\\"b",/);
  assert.match(code, /data="\{\\"a\\":1\}"\.encode\("utf-8"\),/);
});

// ---- Endpoint history -------------------------------------------------------------------------

test("the endpoint key folds numeric ids and UUIDs and drops the query", () => {
  assert.equal(endpointKey({ method: "GET", url: "https://a.test/users/15/posts?x=1" }), "GET /users/{id}/posts");
  assert.equal(endpointKey({ method: "GET", url: "https://a.test/u/123e4567-e89b-12d3-a456-426614174000" }), "GET /u/{id}");
});

test("body changes: fields, types and array lengths, item values are ignored", () => {
  const changes = jsonChanges(
    { total: 2, items: [{ id: 1, name: "a" }, { id: 2, name: "b" }], legacy: true },
    { total: "0", items: [{ id: 9, name: "z", extra: 1 }], fresh: 1 },
  );
  assert.deepEqual(changes, [
    { path: "total", kind: "type", before: "number", after: "string" },
    { path: "items.length", kind: "length", before: 2, after: 1 },
    { path: "items[0].extra", kind: "added", after: 1 },
    { path: "legacy", kind: "removed", before: true },
    { path: "fresh", kind: "added", after: 1 },
  ]);
  assert.deepEqual(jsonChanges({ a: 1 }, { a: 2 }), [{ path: "a", kind: "changed", before: 1, after: 2 }]);
});

test("the history lists calls of one endpoint oldest first with changes and stats", () => {
  const now = Date.now();
  const list = [
    request({ url: "https://api.test/users/2", timestamp: now + 2, status: 500, duration: 300, responseBody: null }),
    request({ url: "https://api.test/users/1", timestamp: now, responseBody: { name: "a" }, duration: 100 }),
    request({ url: "https://api.test/other", timestamp: now + 1 }),
    request({ url: "https://api.test/users/3", timestamp: now + 3, responseBody: '{"name":"b"}', duration: 200 }),
  ];
  const history = endpointHistory(list, { method: "GET", url: "https://api.test/users/7" });
  assert.equal(history.key, "GET /users/{id}");
  assert.deepEqual(history.entries.map((entry) => entry.request.status), [200, 500, 200]);
  assert.equal(history.entries[1].statusChanged, true);
  assert.deepEqual(history.entries[2].changes, [{ path: "name", kind: "changed", before: "a", after: "b" }]);
  assert.deepEqual(history.stats, { count: 3, errors: 1, minMs: 100, maxMs: 300, avgMs: 200, statuses: [200, 500] });
});

// ---- Watchdog ---------------------------------------------------------------------------------

test("a watched endpoint raises an alert on an error or a slow answer, others are ignored", () => {
  const watched = toggleWatched([], { method: "GET", url: "https://api.test/users/1" });
  assert.deepEqual(watched, [{ key: "GET /users/{id}", slowMs: DEFAULT_WATCH_SLOW_MS }]);
  assert.equal(isWatched(watched, { method: "GET", url: "https://api.test/users/99" }), true);
  assert.equal(watchAlertFor(request({ url: "https://api.test/users/5" }), watched), null);
  assert.equal(watchAlertFor(request({ url: "https://api.test/users/5", status: 503 }), watched)?.reason, "error");
  assert.equal(watchAlertFor(request({ url: "https://api.test/users/5", status: 0, error: "net::ERR" }), watched)?.reason, "error");
  assert.equal(watchAlertFor(request({ url: "https://api.test/users/5", duration: 2500 }), watched)?.reason, "slow");
  assert.equal(watchAlertFor(request({ url: "https://api.test/items", status: 500 }), watched), null);
  assert.deepEqual(toggleWatched(watched, { method: "GET", url: "https://api.test/users/3" }), []);
});

// ---- Palette ----------------------------------------------------------------------------------

test("palette ranking: substrings at a word start win, subsequences match, misses are dropped", () => {
  assert.ok(fuzzyScore("har", "Экспорт HAR") > fuzzyScore("har", "Charles"));
  assert.ok(fuzzyScore("эксп har", "Экспорт HAR") > 0);
  assert.ok(fuzzyScore("hr", "HAR") > 0);
  assert.equal(fuzzyScore("xyz", "HAR"), 0);
  assert.deepEqual(rankByQuery("мок", ["Настройки", "Моки", "Создать мок"], (item) => item), ["Моки", "Создать мок"]);
  assert.deepEqual(rankByQuery("", ["a", "b"], (item) => item), ["a", "b"]);
});

// ---- Update check -----------------------------------------------------------------------------

test("versions compare numerically and release answers are validated", () => {
  assert.equal(compareVersions("2.10.0", "2.9.9"), 1);
  assert.equal(compareVersions("v2.4.0", "2.4"), 0);
  assert.equal(compareVersions("2.3.0", "2.4.0"), -1);
  assert.deepEqual(parseLatestRelease({ tag_name: "v2.5.0", html_url: "https://github.com/x/y/releases/tag/v2.5.0" }), { version: "2.5.0", url: "https://github.com/x/y/releases/tag/v2.5.0" });
  assert.equal(parseLatestRelease({ tag_name: "v2.5.0", prerelease: true }), null);
  assert.equal(parseLatestRelease({ message: "Not Found" }), null);
  assert.equal(parseLatestRelease({ tag_name: "v3.0.0", html_url: "https://evil.test/" })?.url.startsWith("https://github.com/"), true);
  assert.equal(parseManifestVersion({ version: "2.4.0" })?.version, "2.4.0");
  assert.equal(parseManifestVersion({ version: "<b>" }), null);
  const now = Date.now();
  assert.equal(isCheckDue(undefined, now), true);
  assert.equal(isCheckDue(now - 1000, now), false);
  assert.equal(isCheckDue(now - UPDATE_CHECK_INTERVAL_MS, now), true);
});

// ---- Virtual list -----------------------------------------------------------------------------

test("the visible range covers the viewport plus overscan", () => {
  const offsets = prefixOffsets(new Array(1000).fill(50));
  assert.equal(offsets[1000], 50_000);
  assert.deepEqual(visibleRange(offsets, 0, 500, 0), [0, 11]);
  assert.deepEqual(visibleRange(offsets, 10_000, 500, 100), [198, 213]);
  assert.deepEqual(visibleRange(offsets, 49_900, 500, 0), [998, 1000]);
  assert.deepEqual(visibleRange(prefixOffsets([]), 0, 500), [0, 0]);
  const mixed = prefixOffsets([40, 60, 60, 40]);
  assert.deepEqual(visibleRange(mixed, 45, 60, 0), [1, 3]);
});
