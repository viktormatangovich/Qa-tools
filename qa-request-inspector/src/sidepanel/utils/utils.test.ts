import assert from "node:assert/strict";
import test from "node:test";
import { contentTypeOf, decodeFormBody, encodeFormBody, formBodyToObject, isFormEncoded, requestBodyTree } from "./formBody.ts";
import { graphqlInfo, withGraphql } from "./graphql.ts";
import { nodeMatch, searchJson } from "./jsonSearch.ts";
import { parseHar } from "./harImport.ts";
import { filterRequests } from "./requestList.ts";
import type { ApiRequest } from "../types.ts";
import { hexDump } from "./hex.ts";
import { candidatesOf, findValueInRequests, parseDisplayedValue, partsOf, searchTermFor, streamRequests, explainChange } from "./valueFinder.ts";
import { buildSettingsFile, readSettingsFile } from "./settingsTransfer.ts";
import { generateHar, generateMarkdownReport } from "./generators.ts";
import { setQaLanguage } from "../qa/messages.ts";

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

// ---- Value finder (element on the page -> field of a response) ------------------------------

test("displayed numbers are read with thousands separators, decimals and short suffixes", () => {
  assert.deepEqual(parseDisplayedValue("1 234").numbers, [1234]);
  assert.deepEqual(parseDisplayedValue("1 234 ₸").numbers, [1234]);
  assert.deepEqual(parseDisplayedValue("1,234").numbers, [1234, 1.234]);
  assert.deepEqual(parseDisplayedValue("12,5").numbers, [12.5]);
  assert.deepEqual(parseDisplayedValue("Заказы 12 из 40").numbers, [12, 40]);
  assert.deepEqual(parseDisplayedValue("18.11.2026").numbers, []);
  const short = parseDisplayedValue("1,2K");
  assert.deepEqual(short.numbers, [1200]);
  assert.deepEqual(short.ranges, [[1150, 1250]]);
  assert.deepEqual(parseDisplayedValue("3 млн").ranges, [[2500000, 3500000]]);
});

test("a picked counter is found as a field, an array length and an approximate value", () => {
  const request = (id: string, timestamp: number, responseBody: unknown) =>
    ({ id, method: "GET", url: `https://api.test/${id}`, timestamp, responseBody, status: 200 }) as unknown as ApiRequest;
  const requests = [
    request("old", 1, { meta: { total: 12 }, id: 12 }),
    request("new", 2, JSON.stringify({ items: new Array(12).fill(0), name: "Alpha 12" })),
    request("views", 3, { views: 1234 }),
    request("text", 4, "plain text"),
  ];
  const twelve = findValueInRequests(requests, candidatesOf({ text: "12", attributes: [] }));
  assert.deepEqual(twelve.map((match) => [match.request.id, match.path, match.kind]).slice(0, 3), [
    ["old", "root.meta.total", "exact"],
    ["old", "root.id", "exact"],
    ["new", "root.items", "length"],
  ]);
  assert.deepEqual(twelve[0].ancestors, ["root", "root.meta"]);

  const short = findValueInRequests(requests, candidatesOf({ text: "1,2K", attributes: [{ name: "title", value: "1 234" }] }));
  assert.equal(short[0].path, "root.views");
  assert.equal(short[0].kind, "number");
  assert.equal(short[0].source, "title");

  const word = findValueInRequests(requests, candidatesOf({ text: "alpha", attributes: [] }));
  assert.deepEqual(word.map((match) => [match.path, match.kind]), [["root.name", "contains"]]);
});

test("a bare number is not matched inside ids and timestamps, and the search term follows the match", () => {
  const request = { id: "r", method: "POST", url: "https://api.test/tops", timestamp: 1, status: 200,
    responseBody: { items: [{ comments: "482", msg_id: "799d0482ab", ts: "1794824022", tags: ["a", "b"] }] } } as unknown as ApiRequest;
  const found = findValueInRequests([request], candidatesOf({ text: "482", attributes: [] }));
  assert.deepEqual(found.map((match) => match.path), ["root.items.0.comments"]);
  assert.equal(searchTermFor(found[0], "482"), "482");

  const length = findValueInRequests([request], candidatesOf({ text: "2", attributes: [] }));
  assert.equal(searchTermFor(length.find((match) => match.kind === "length")!, "2"), "tags");

  const word = findValueInRequests([request], candidatesOf({ text: "d0482", attributes: [] }));
  assert.equal(word[0].kind, "contains");
  assert.equal(searchTermFor(word[0], " d0482 "), "d0482");
});

test("percents, money, durations and dates are read in the units a response keeps them", () => {
  const percent = parseDisplayedValue("45%");
  assert.deepEqual(percent.numbers, [45]);
  assert.deepEqual(percent.derived, [{ value: 0.45, note: "percent" }]);
  assert.deepEqual(parseDisplayedValue("12,50 ₽").derived, [{ value: 1250, note: "cents" }]);
  const duration = parseDisplayedValue("2 ч 5 мин");
  assert.deepEqual(duration.derived.map((item) => [item.value, item.note]), [[7500, "seconds"], [7500000, "milliseconds"], [125, "minutes"]]);
  assert.deepEqual(parseDisplayedValue("5 сообщений").derived, []);

  const day = parseDisplayedValue("18.11.2026");
  assert.deepEqual(day.numbers, []);
  assert.deepEqual(day.dates, [[new Date(2026, 10, 18).getTime(), new Date(2026, 10, 19).getTime()]]);
  const minute = parseDisplayedValue("18 ноября 2026 г. в 12:30");
  assert.deepEqual(minute.dates, [[new Date(2026, 10, 18, 12, 30).getTime(), new Date(2026, 10, 18, 12, 31).getTime()]]);
  assert.equal(parseDisplayedValue("2026-11-18").dates.length, 1);
  assert.equal(parseDisplayedValue("Nov 18, 2026").dates.length, 1);
  assert.equal(parseDisplayedValue("31.02.2026").dates.length, 0);
});

const responseOf = (id: string, timestamp: number, responseBody: unknown) =>
  ({ id, method: "GET", url: `https://api.test/${id}`, timestamp, responseBody, status: 200 }) as unknown as ApiRequest;

test("converted values and dates are found with their unit", () => {
  const seconds = new Date(2026, 10, 18, 12, 30, 15).getTime() / 1000;
  const requests = [responseOf("r", 1, { share: 0.45, price: 1250, ttl: 7500, created: seconds, day: "2026-11-18", iso: new Date(2026, 10, 18, 12, 30).toISOString() })];
  const find = (text: string) => findValueInRequests(requests, candidatesOf({ text, attributes: [] })).map((match) => [match.path, match.kind, match.detail?.note]);
  assert.deepEqual(find("45%"), [["root.share", "converted", "percent"]]);
  assert.deepEqual(find("12,50 ₸"), [["root.price", "converted", "cents"]]);
  assert.deepEqual(find("2 ч 5 мин"), [["root.ttl", "converted", "seconds"]]);
  assert.deepEqual(find("18.11.2026").map(([path]) => path), ["root.created", "root.day", "root.iso"]);
  assert.deepEqual(find("18.11.2026 12:30").map(([path]) => path), ["root.created", "root.iso"]);
});

test("a counter the page computes is found as a filtered count or a sum", () => {
  const items = [
    { id: 1, unread: true, price: 10 }, { id: 2, unread: false, price: 20 },
    { id: 3, unread: true, price: 30 }, { id: 4, unread: true, price: 40 },
  ];
  const requests = [responseOf("list", 1, { items })];
  const three = findValueInRequests(requests, candidatesOf({ text: "3", attributes: [] }));
  const computed = three.find((match) => match.kind === "computed");
  assert.deepEqual(computed?.detail?.computed, { op: "count", field: "unread", equals: true });
  assert.equal(computed?.path, "root.items");
  assert.equal(searchTermFor(computed!, "3"), "unread");
  const sum = findValueInRequests(requests, candidatesOf({ text: "100 ₽", attributes: [] })).find((match) => match.kind === "computed");
  assert.deepEqual(sum?.detail?.computed, { op: "sum", field: "price" });
});

test("a table row is matched to the array item holding several of its texts", () => {
  const items = [
    { id: 7, author: { name: "Иван Петров" }, comments: 482, date: "2026-11-18" },
    { id: 8, author: { name: "Анна Смирнова" }, comments: 12, date: "2026-11-17" },
  ];
  const requests = [responseOf("rows", 1, { items })];
  const element = { text: "Иван Петров 18.11.2026 482 комментария", attributes: [], parts: ["Иван Петров", "18.11.2026", "482 комментария"] };
  const found = findValueInRequests(requests, candidatesOf(element), { parts: partsOf(element) });
  assert.equal(found[0].kind, "row");
  assert.equal(found[0].path, "root.items.0");
  assert.deepEqual(found[0].detail?.row, { matched: 3, total: 3 });
  assert.equal(searchTermFor(found[0], element.text), "Иван Петров");
  assert.ok(!found.some((match) => match.kind === "row" && match.path === "root.items.1"));
  assert.deepEqual(partsOf({ parts: ["only one"] }), []);
});

test("headers, URL parameters, request bodies and stream messages are searched too", () => {
  const request = {
    id: "h", method: "POST", url: "https://api.test/list?limit=25&tag=a&tag=b", timestamp: 2, status: 200,
    responseHeaders: { "x-total-count": "482", "content-type": "application/json" },
    requestHeaders: { "content-type": "application/json" },
    requestBody: JSON.stringify({ filter: { pageSize: 25 } }),
    responseBody: { items: [] },
  } as unknown as ApiRequest;
  const sections = (text: string, requests: ApiRequest[]) =>
    findValueInRequests(requests, candidatesOf({ text, attributes: [] })).map((match) => [match.section, match.path]);
  assert.deepEqual(sections("482", [request]), [["headers", "root.x-total-count"]]);
  // pageSize ranks first: a counter-like field name.
  assert.deepEqual(sections("25", [request]), [["requestBody", "root.filter.pageSize"], ["query", "root.limit"]]);

  const streams = streamRequests([
    { id: "1", protocol: "WebSocket", direction: "received", url: "wss://api.test/ws", data: '{"unread":7}', timestamp: 5 },
    { id: "2", protocol: "WebSocket", direction: "received", url: "wss://api.test/ws", data: "AAEC", timestamp: 6, binary: true, size: 3 },
  ]);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].method, "WS ↓");
  assert.deepEqual(sections("7", [request, ...streams]), [["stream", "root.unread"]]);
});

test("a change of a watched element is explained by the requests finished just before it", () => {
  const at = 10_000;
  const request = (id: string, timestamp: number, responseBody: unknown) =>
    ({ id, method: "GET", url: `https://api.test/${id}`, timestamp, duration: 100, responseBody, status: 200 }) as unknown as ApiRequest;
  const requests = [
    request("before-start", 1_000, { unread: 481 }),
    request("cause", 9_500, { unread: 481 }),
    request("after", 12_000, { unread: 481 }),
  ];
  const change = explainChange(requests, { at, from: "482", to: "481" }, 5_000);
  assert.equal(change.checked, 1);
  assert.deepEqual(change.matches.map((match) => match.request.id), ["cause"]);

  const computed = explainChange([request("other", 9_000, { total: 10 })], { at, from: "482", to: "481" }, 5_000);
  assert.equal(computed.checked, 1);
  assert.deepEqual(computed.matches, []);
});

test("a QA note survives a HAR export and import", () => {
  const request: ApiRequest = { id: "n1", type: "fetch", method: "GET", url: "https://example.test/api/items", requestHeaders: {}, requestBody: null, responseHeaders: {}, responseBody: null, status: 200, statusText: "OK", duration: 5, timestamp: 1000, error: null, pageUrl: "", pageTitle: "", note: "Empty list for a new user" };
  const har = generateHar([request, { ...request, id: "n2", note: undefined }]);
  assert.equal(har.log.entries[0].comment, "Empty list for a new user");
  assert.equal("comment" in har.log.entries[1], false);
  const [first, second] = parseHar(JSON.stringify(har)).sort((a, b) => (a.note ? -1 : b.note ? 1 : 0));
  assert.equal(first.note, "Empty list for a new user");
  assert.equal(second.note, undefined);
});

test("the Markdown report shows notes and follows the selected language", () => {
  const request: ApiRequest = { id: "m1", type: "fetch", method: "GET", url: "https://example.test/api/items", requestHeaders: {}, requestBody: null, responseHeaders: {}, responseBody: null, status: 404, statusText: "Not Found", duration: 5, timestamp: 1000, error: null, pageUrl: "", pageTitle: "", note: "Should be 200" };
  const ru = generateMarkdownReport([request], [], { url: "", title: "" });
  assert.match(ru, /^# Отчёт по API/);
  assert.ok(ru.includes("- **Заметка:** Should be 200"));
  setQaLanguage("en");
  try {
    const en = generateMarkdownReport([request], [], { url: "", title: "" });
    assert.match(en, /^# API report/);
    assert.ok(en.includes("## Failed requests (1)"));
    assert.ok(en.includes("- **Note:** Should be 200"));
  } finally {
    setQaLanguage("ru");
  }
});
