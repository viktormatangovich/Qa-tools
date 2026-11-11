import assert from "node:assert/strict";
import test from "node:test";
import { contentTypeOf, decodeFormBody, encodeFormBody, formBodyToObject, isFormEncoded, requestBodyTree } from "./formBody.ts";
import { graphqlInfo, withGraphql } from "./graphql.ts";
import { nodeMatch, searchJson } from "./jsonSearch.ts";
import { parseHar } from "./harImport.ts";
import { filterRequests } from "./requestList.ts";
import type { ApiRequest } from "../types.ts";
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

// ---- Form-encoded bodies ------------------------------------------------------------------------

test("a form-encoded body is decoded to name=value lines and encoded back", () => {
  const body = "name=1&prompt=%D0%BF%D1%80%D0%BE%D0%BC%D0%BF%D1%82";
  assert.equal(decodeFormBody(body), "name=1\nprompt=промпт");
  assert.equal(encodeFormBody(decodeFormBody(body)), body);
  assert.equal(
    encodeFormBody("name=1\nprompt=новый промпт & ещё=да"),
    "name=1&prompt=%D0%BD%D0%BE%D0%B2%D1%8B%D0%B9%20%D0%BF%D1%80%D0%BE%D0%BC%D0%BF%D1%82%20%26%20%D0%B5%D1%89%D1%91%3D%D0%B4%D0%B0",
  );
});

test("form decoding keeps line breaks, plus signs, flags and broken escapes", () => {
  // In the decoded text a line break inside a value is \n and a backslash is \.
  assert.equal(decodeFormBody("q=a+b&text=line1%0Aline2%5Cn&flag&bad=100%"), "q=a b\ntext=line1\\nline2\\\\n\nflag\nbad=100%");
  assert.equal(encodeFormBody("q=a b\ntext=line1\\nline2\\\\n\nflag", true), "q=a+b&text=line1%0Aline2%5Cn&flag");
  assert.equal(encodeFormBody("a=1\r\n\n  \nb=2"), "a=1&b=2");
});

test("a body is offered for decoding only when it looks like a form", () => {
  assert.equal(isFormEncoded("name=1&prompt=%D0%BF"), true);
  assert.equal(isFormEncoded("token=abc=="), true);
  assert.equal(isFormEncoded('{"a":"b=c"}'), false);
  assert.equal(isFormEncoded("just text"), false);
  assert.equal(isFormEncoded("a=1 & b=2"), false);
  assert.equal(isFormEncoded("", "application/x-www-form-urlencoded; charset=UTF-8"), true);
  assert.equal(contentTypeOf({ "Content-Type": "application/x-www-form-urlencoded" }), "application/x-www-form-urlencoded");
});

test("a request body becomes a tree: JSON as is, a form decoded, anything else stays text", () => {
  const form = formBodyToObject("name=1&prompt=%D0%BF%D1%80%D0%BE%D0%BC%D0%BF%D1%82&id=1&id=2&flag&__proto__=x");
  assert.deepEqual({ ...form }, { name: "1", prompt: "промпт", id: ["1", "2"], flag: "", ["__proto__"]: "x" });
  assert.equal(Object.getPrototypeOf(form), null);

  assert.deepEqual(requestBodyTree('{"a":{"b":1}}'), { kind: "json", data: { a: { b: 1 } } });
  assert.deepEqual(requestBodyTree({ a: 1 }), { kind: "json", data: { a: 1 } });
  assert.equal(requestBodyTree('{"a":'), null);
  assert.equal(requestBodyTree('"just a string"'), null);
  assert.equal(requestBodyTree("plain text"), null);
  assert.equal(requestBodyTree(null), null);
  assert.equal(requestBodyTree("a=1&b=%D0%B1")?.kind, "form");
  assert.deepEqual(requestBodyTree("q=a+b", "application/x-www-form-urlencoded")?.data, Object.assign(Object.create(null), { q: "a b" }));
});

test("the body search of the request list finds field names and decoded values", () => {
  const request = (id: string, requestBody: unknown, responseBody: unknown, requestHeaders: Record<string, string> = {}) =>
    ({ id, url: `https://api.test/${id}`, method: "POST", status: 200, duration: 10, requestBody, responseBody, requestHeaders, responseHeaders: {} }) as unknown as ApiRequest;
  const requests = [
    request("form", "name=1&prompt=%D0%BF%D1%80%D0%BE%D0%BC%D0%BF%D1%82", null),
    request("json", '{"filter":{"dateFrom":"2026-11-01"}}', { items: [{ totalCount: 5 }] }),
    request("escaped", null, '{"title":"\\u041e\\u0442\\u0447\\u0451\\u0442"}'),
    request("object", { userId: 7 }, null),
  ];
  const ids = (query: string) => filterRequests(requests, { filter: "all", urlFilter: "", bodySearch: query }).map((r) => r.id);

  assert.deepEqual(ids("промпт"), ["form"], "a form value is decoded");
  assert.deepEqual(ids("prompt"), ["form"], "a form field name");
  assert.deepEqual(ids("DATEFROM"), ["json"], "a request field name, any case");
  assert.deepEqual(ids("totalcount"), ["json"], "a response field name");
  assert.deepEqual(ids("отчёт"), ["escaped"], "\\u-escaped text is found as Cyrillic");
  assert.deepEqual(ids("userid"), ["object"], "a body kept as an object, not [object Object]");
  assert.deepEqual(ids('"totalcount":5'), ["json"], "a fragment of the raw text still matches");
  assert.deepEqual(ids("object"), [], "nothing matches [object Object]");
});

// ---- Search in a JSON response ------------------------------------------------------------------

test("response search finds field names as well as values and opens their parents", () => {
  const data = {
    userId: 7,
    items: [{ title: "Отчёт", Price: 10 }, { title: "user guide", price: null }],
    meta: { long: "x".repeat(100) + "needle" },
  };
  const found = searchJson(data, "  USER ");
  // The field name "userId" and the value "user guide", in tree order.
  assert.deepEqual(found.paths, ["root.userId", "root.items.1.title"]);
  assert.deepEqual([...found.ancestors].sort(), ["root", "root.items", "root.items.1"]);

  assert.deepEqual(searchJson(data, "price").paths, ["root.items.0.Price", "root.items.1.price"]);
  assert.deepEqual(searchJson(data, "null").paths, ["root.items.1.price"]);
  // A long value is searched in full, not in the shortened text the tree shows.
  assert.deepEqual(searchJson(data, "needle").paths, ["root.meta.long"]);
  // Objects are not searched as "[object Object]", array indices are not field names.
  assert.deepEqual(searchJson(data, "object").paths, []);
  assert.deepEqual(searchJson(data, "1").paths, ["root.items.0.Price"]);
  assert.deepEqual(searchJson(data, "   ").paths, []);
  assert.deepEqual(nodeMatch("items", [], "item"), { key: true, value: false });
});
