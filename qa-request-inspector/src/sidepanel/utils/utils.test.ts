import assert from "node:assert/strict";
import test from "node:test";
import { graphqlInfo, withGraphql } from "./graphql.ts";
import { parseHar } from "./harImport.ts";
import { hexDump } from "./hex.ts";
import { buildSettingsFile, readSettingsFile } from "./settingsTransfer.ts";

// ---- GraphQL ----------------------------------------------------------------------------------

test("the GraphQL operation is read from the body, the name field or the URL", () => {
  const post = (body: unknown) => ({ method: "POST", url: "https://api.test/graphql", requestBody: JSON.stringify(body) });
  assert.deepEqual(graphqlInfo(post({ query: "query GetUser($id: ID!) { user(id: $id) { name } }" })), { operationType: "query", operationName: "GetUser" });
  assert.deepEqual(graphqlInfo(post({ operationName: "AddItem", query: "mutation AddItem { addItem { id } }" })), { operationType: "mutation", operationName: "AddItem" });
  assert.deepEqual(graphqlInfo(post({ query: "{ me { id } }" })), { operationType: "query", operationName: "(anonymous)" });
  assert.deepEqual(graphqlInfo(post([{ query: "query A { a }" }, { query: "mutation B { b }" }])), { operationType: "mutation", operationName: "A, B" });
  assert.deepEqual(
    graphqlInfo({ method: "GET", url: "https://api.test/graphql?operationName=Feed&query=" + encodeURIComponent("query Feed { feed { id } }"), requestBody: null }),
    { operationType: "query", operationName: "Feed" },
  );
});

test("ordinary requests are not taken for GraphQL", () => {
  assert.equal(graphqlInfo({ method: "POST", url: "https://api.test/search", requestBody: '{"query":"red shoes"}' }), undefined);
  assert.equal(graphqlInfo({ method: "POST", url: "https://api.test/x", requestBody: "query=1" }), undefined);
  assert.equal(graphqlInfo({ method: "GET", url: "https://api.test/items?query=shoes", requestBody: null }), undefined);
  const plain = { id: "1", method: "GET", url: "https://api.test/items", requestBody: null } as never;
  assert.equal(withGraphql(plain), plain, "the same object when there is nothing to add");
});

// ---- HAR import -------------------------------------------------------------------------------

const har = {
  log: {
    entries: [
      {
        startedDateTime: "2026-01-01T10:00:00.000Z",
        time: 120.4,
        _resourceType: "xhr",
        serverIPAddress: "10.0.0.1",
        request: { method: "post", url: "https://api.test/login", headers: [{ name: ":authority", value: "api.test" }, { name: "Content-Type", value: "application/json" }], postData: { text: '{"user":"a"}' } },
        response: { status: 200, statusText: "OK", httpVersion: "h2", _transferSize: 300, headers: [{ name: "set-cookie", value: "a=1" }, { name: "set-cookie", value: "b=2" }], content: { mimeType: "application/json", text: '{"ok":true}' } },
        timings: { blocked: 1, dns: 2, connect: 30, ssl: 20, send: 1, wait: 80, receive: 6.4 },
      },
      {
        startedDateTime: "2026-01-01T10:00:05.000Z",
        time: 10,
        _resourceType: "image",
        request: { method: "GET", url: "https://cdn.test/logo.png", headers: [] },
        response: { status: 404, statusText: "Not Found", headers: [], content: { mimeType: "image/png", text: "/9j/4AAQ", encoding: "base64" } },
      },
      {
        startedDateTime: "2026-01-01T10:00:02.000Z",
        time: 5,
        request: { method: "GET", url: "https://api.test/text", headers: [] },
        response: { status: 0, statusText: "", headers: [], content: { mimeType: "text/plain", text: Buffer.from("привет").toString("base64"), encoding: "base64" } },
      },
      { request: {} },
    ],
  },
};

test("a HAR file becomes a request list, newest first", () => {
  const requests = parseHar(JSON.stringify(har));
  assert.deepEqual(requests.map((request) => request.url), ["https://cdn.test/logo.png", "https://api.test/text", "https://api.test/login"]);

  const login = requests[2];
  assert.equal(login.type, "xhr");
  assert.equal(login.method, "POST");
  assert.deepEqual(login.requestHeaders, { "Content-Type": "application/json" });
  assert.equal(login.requestBody, '{"user":"a"}');
  assert.deepEqual(login.responseBody, { ok: true });
  assert.equal(login.responseHeaders["set-cookie"], "a=1, b=2");
  assert.equal(login.duration, 120);
  assert.deepEqual(login.timings, { blocked: 1, dns: 2, connect: 10, ssl: 20, send: 1, wait: 80, receive: 6.4 });
  assert.equal(login.transferSize, 300);
  assert.equal(login.protocol, "h2");
  assert.equal(login.remoteAddress, "10.0.0.1");

  assert.equal(requests[0].type, "image");
  assert.equal(requests[0].responseBody, null, "binary content is not kept");
  assert.equal(requests[1].type, "fetch", "an entry without a resource type is treated as an API call");
  assert.equal(requests[1].responseBody, "привет");
  assert.equal(requests[1].error, "Request failed");
});

test("files that are not HAR are rejected", () => {
  assert.throws(() => parseHar("not json"), /not-json/);
  assert.throws(() => parseHar('{"entries":[]}'), /not-har/);
  assert.deepEqual(parseHar('{"log":{"entries":[]}}'), []);
});

// ---- Hex view ---------------------------------------------------------------------------------

test("binary frames are shown as a hex dump", () => {
  const bytes = Buffer.from([0x00, 0x41, 0x42, 0xff, ...Array.from({ length: 14 }, (_, index) => 0x61 + index)]);
  const dump = hexDump(bytes.toString("base64")).split("\n");
  assert.equal(dump.length, 2);
  assert.equal(dump[0], "00000000  00 41 42 ff 61 62 63 64 65 66 67 68 69 6a 6b 6c  .AB.abcdefghijkl");
  assert.equal(dump[1], `00000010  6d 6e${" ".repeat(42)}  mn`);
  assert.equal(hexDump(bytes.toString("base64"), 4).split("\n").length, 1);
  assert.equal(hexDump("***"), "");
});

// ---- Settings transfer ------------------------------------------------------------------------

test("settings are exported without captured data and without the Jira token", () => {
  const stored = {
    darkMode: true,
    language: "en",
    mockRules: [{ id: "m" }],
    jiraSettings: { baseUrl: "https://jira.test", token: "secret", projectKey: "QA" },
    sessions: [{ id: "s" }],
    collections: [{ id: "c" }],
    session_s: [{ url: "https://private.test" }],
  };
  const file = buildSettingsFile(stored, new Date("2026-01-01T00:00:00Z"));
  assert.deepEqual(file, {
    app: "reqpane",
    kind: "settings",
    version: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    settings: { darkMode: true, language: "en", mockRules: [{ id: "m" }], jiraSettings: { baseUrl: "https://jira.test", token: "", projectKey: "QA" } },
  });
  assert.ok(!JSON.stringify(file).includes("secret"));
});

test("an imported file is validated; the stored Jira token is kept", () => {
  const text = JSON.stringify({
    app: "reqpane", kind: "settings", version: 1, exportedAt: "",
    settings: { darkMode: false, mockRules: "oops", unknownKey: 1, jiraSettings: { baseUrl: "https://jira.test", token: "" }, sessions: [{ id: "x" }] },
  });
  const { items, skipped } = readSettingsFile(text, { jiraSettings: { token: "kept" } });
  assert.deepEqual(items, { darkMode: false, jiraSettings: { baseUrl: "https://jira.test", token: "kept" } });
  assert.deepEqual(skipped, ["mockRules"]);
  assert.throws(() => readSettingsFile("[]"), /not-settings/);
  assert.throws(() => readSettingsFile("{"), /not-json/);
  assert.throws(() => readSettingsFile('{"app":"other","kind":"settings","settings":{}}'), /not-settings/);
});
