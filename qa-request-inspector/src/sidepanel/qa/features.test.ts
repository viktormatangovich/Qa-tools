import assert from "node:assert/strict";
import test from "node:test";
import { bundleExternalRefs, hasExternalRefs, matchEndpoint, parseOpenApiSpec, unsupportedContractFeatures, validateRequest, validateResponse } from "./contract/contractChecker.ts";
import { buildIssuePayload, createJiraIssue, isJiraConfigured, jiraAuthHeader, jiraBaseUrl } from "./jira.ts";
import { playwrightUiScenario, retainedSessions, stepText, type ManualStep, type StepWords } from "./teamTools.ts";

const base = { id: "r", type: "fetch" as const, method: "GET", url: "https://api.test/v1/pets/7", requestHeaders: {}, requestBody: null, responseHeaders: { "content-type": "application/json; charset=utf-8" }, responseBody: {}, status: 200, statusText: "OK", duration: 5, timestamp: 1, error: null, pageUrl: "", pageTitle: "" };
const paths = (violations: Array<{ path: string }>) => violations.map((violation) => violation.path);

function specWith(schema: unknown, components: Record<string, unknown> = {}) {
  return parseOpenApiSpec(JSON.stringify({
    openapi: "3.0.3",
    servers: [{ url: "https://api.test/v1" }],
    paths: { "/pets/{id}": { get: { responses: { "200": { content: { "application/json": { schema } } } } } } },
    components: { schemas: components },
  }));
}

// ---- OpenAPI: composition, references, formats -----------------------------------------------

test("a server prefix and a charset in Content-Type do not break matching", () => {
  const spec = specWith({ type: "object" });
  assert.equal(matchEndpoint(spec, base)?.pathTemplate, "/pets/{id}");
  assert.deepEqual(validateResponse(spec, base), []);
});

test("a concrete path wins over a templated one", () => {
  const spec = parseOpenApiSpec(JSON.stringify({ openapi: "3.0.3", paths: { "/users/{id}": { get: { responses: { "200": {} } } }, "/users/me": { get: { responses: { "200": {} } } } } }));
  assert.equal(matchEndpoint(spec, { ...base, url: "https://api.test/users/me" })?.pathTemplate, "/users/me");
});

test("allOf joins properties and required fields of its parts", () => {
  const spec = specWith(
    { allOf: [{ $ref: "#/components/schemas/Base" }, { type: "object", required: ["name"], properties: { name: { type: "string" } } }] },
    { Base: { type: "object", required: ["id"], properties: { id: { type: "integer" } } } },
  );
  assert.deepEqual(validateResponse(spec, { ...base, responseBody: { id: 1, name: "Rex" } }), []);
  assert.deepEqual(paths(validateResponse(spec, { ...base, responseBody: { id: "1" } })).sort(), ["$.id", "$.name"]);
});

test("oneOf needs exactly one matching variant and anyOf at least one", () => {
  const cat = { type: "object", required: ["meow"], properties: { meow: { type: "boolean" } } };
  const dog = { type: "object", required: ["bark"], properties: { bark: { type: "boolean" } } };
  const oneOf = specWith({ oneOf: [cat, dog] });
  assert.deepEqual(validateResponse(oneOf, { ...base, responseBody: { meow: true } }), []);
  assert.equal(validateResponse(oneOf, { ...base, responseBody: { purr: true } }).length, 1, "no variant matches");
  assert.equal(validateResponse(oneOf, { ...base, responseBody: { meow: true, bark: true } }).length, 1, "two variants match");
  const anyOf = specWith({ anyOf: [cat, dog] });
  assert.deepEqual(validateResponse(anyOf, { ...base, responseBody: { meow: true, bark: true } }), []);
  assert.equal(validateResponse(anyOf, { ...base, responseBody: {} }).length, 1);
});

test("a discriminator selects the variant, so its own violations are reported", () => {
  const spec = specWith(
    { oneOf: [{ $ref: "#/components/schemas/Cat" }, { $ref: "#/components/schemas/Dog" }], discriminator: { propertyName: "kind" } },
    {
      Cat: { type: "object", required: ["kind", "lives"], properties: { kind: { type: "string" }, lives: { type: "integer", maximum: 9 } } },
      Dog: { type: "object", required: ["kind"], properties: { kind: { type: "string" } } },
    },
  );
  assert.deepEqual(paths(validateResponse(spec, { ...base, responseBody: { kind: "Cat", lives: 12 } })), ["$.lives"]);
  assert.deepEqual(validateResponse(spec, { ...base, responseBody: { kind: "Dog" } }), []);
});

test("not, pattern, format, const, uniqueItems and OpenAPI 3.1 type lists are checked", () => {
  const spec = specWith({
    type: "object",
    properties: {
      code: { type: "string", pattern: "^[A-Z]{3}$" },
      email: { type: "string", format: "email" },
      when: { type: "string", format: "date-time" },
      version: { const: 2 },
      tags: { type: "array", uniqueItems: true, items: { type: "string" } },
      note: { type: ["string", "null"] },
      role: { not: { enum: ["root"] } },
      price: { type: "number", minimum: 0, exclusiveMinimum: true, multipleOf: 0.5 },
    },
  });
  const good = { code: "ABC", email: "a@b.co", when: "2026-01-02T03:04:05Z", version: 2, tags: ["a", "b"], note: null, role: "user", price: 1.5 };
  assert.deepEqual(validateResponse(spec, { ...base, responseBody: good }), []);
  const bad = { code: "abc", email: "nope", when: "yesterday", version: 3, tags: ["a", "a"], note: 5, role: "root", price: 0 };
  assert.deepEqual(paths(validateResponse(spec, { ...base, responseBody: bad })).sort(), ["$.code", "$.email", "$.note", "$.price", "$.role", "$.tags", "$.version", "$.when"]);
});

test("additionalProperties as a schema, status ranges and referenced parameters", () => {
  const spec = parseOpenApiSpec(JSON.stringify({
    openapi: "3.0.3",
    paths: {
      "/orders/{id}": {
        parameters: [{ $ref: "#/components/parameters/Id" }],
        post: {
          parameters: [{ name: "dryRun", in: "query", required: true, schema: { type: "boolean" } }],
          requestBody: { $ref: "#/components/requestBodies/Order" },
          responses: { "2XX": { $ref: "#/components/responses/Ok" } },
        },
      },
    },
    components: {
      parameters: { Id: { name: "id", in: "path", required: true, schema: { type: "integer" } } },
      requestBodies: { Order: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: { type: "integer" } } } } } },
      responses: { Ok: { content: { "application/json": { schema: { type: "object" } } } } },
    },
  }));
  const request = { ...base, method: "POST", url: "https://api.test/orders/abc", status: 201, requestHeaders: { "Content-Type": "application/json" }, requestBody: '{"apples":2,"pears":"three"}' };
  assert.deepEqual(paths(validateRequest(spec, request)).sort(), ["$.path.id", "$.pears", "$.query.dryRun"]);
  assert.deepEqual(validateResponse(spec, request), [], "201 is covered by 2XX");
  // A form body is not JSON and is not validated against the JSON schema.
  const form = { ...request, url: "https://api.test/orders/5?dryRun=true", requestHeaders: { "content-type": "application/x-www-form-urlencoded" }, requestBody: "apples=2" };
  assert.deepEqual(validateRequest(spec, form), []);
});

test("external references are downloaded, inlined and then validated", async () => {
  const root = JSON.stringify({
    openapi: "3.0.3",
    paths: { "/pets/{id}": { get: { responses: { "200": { content: { "application/json": { schema: { $ref: "./schemas/pet.json#/Pet" } } } } } } } },
  });
  const files: Record<string, string> = {
    "https://spec.test/api/schemas/pet.json": JSON.stringify({ Pet: { type: "object", required: ["owner"], properties: { owner: { $ref: "#/Owner" }, tag: { $ref: "common.yaml#/Tag" } } }, Owner: { type: "object", required: ["name"] } }),
    "https://spec.test/api/schemas/common.yaml": "Tag:\n  type: string\n  maxLength: 3\n",
  };
  const requested: string[] = [];
  const fakeFetch = (async (url: string) => {
    requested.push(url);
    return url in files ? new Response(files[url], { status: 200 }) : new Response("", { status: 404 });
  }) as typeof fetch;

  assert.equal(hasExternalRefs(parseOpenApiSpec(root)), true);
  const bundled = await bundleExternalRefs(root, "https://spec.test/api/openapi.json", fakeFetch);
  assert.equal(bundled.loaded, 2);
  assert.deepEqual(bundled.warnings, []);
  assert.deepEqual(requested, Object.keys(files));

  const spec = parseOpenApiSpec(bundled.text);
  assert.equal(hasExternalRefs(spec), false);
  assert.deepEqual(unsupportedContractFeatures(spec), []);
  const request = { ...base, url: "https://api.test/pets/7" };
  assert.deepEqual(validateResponse(spec, { ...request, responseBody: { owner: { name: "Ann" }, tag: "abc" } }), []);
  assert.deepEqual(paths(validateResponse(spec, { ...request, responseBody: { owner: {}, tag: "too long" } })).sort(), ["$.owner.name", "$.tag"]);

  // Without a base address a relative reference cannot be resolved, and a failed download is reported.
  assert.equal((await bundleExternalRefs(root, undefined, fakeFetch)).warnings.length, 1);
  const missing = root.replace("./schemas/pet.json", "https://spec.test/gone.json");
  const failed = await bundleExternalRefs(missing, undefined, fakeFetch);
  assert.equal(failed.loaded, 0);
  assert.equal(failed.warnings.length, 1);
  assert.equal(unsupportedContractFeatures(parseOpenApiSpec(failed.text)).length, 1);
});

// ---- Sessions ---------------------------------------------------------------------------------

test("pinned sessions are kept beyond the limit of temporary ones", () => {
  const now = 1_000_000_000_000;
  const sessions = [
    { id: "ref", name: "", count: 1, timestamp: now - 90 * 86400000, pinned: true },
    ...["a", "b", "c", "d"].map((id, index) => ({ id, name: "", count: 1, timestamp: now - index - 1 })),
  ];
  assert.deepEqual(retainedSessions(sessions, now).map((session) => session.id), ["a", "b", "c", "ref"]);
});

// ---- Recorded steps ---------------------------------------------------------------------------

const words: StepWords = {
  click: (name) => `click ${name}`,
  fill: (name, value) => `fill ${name}=${value}`,
  fillSecret: (name) => `secret ${name}`,
  select: (name, option) => `select ${name}=${option}`,
  check: (name) => `check ${name}`,
  uncheck: (name) => `uncheck ${name}`,
  upload: (name, files) => `upload ${name}=${files}`,
  press: (key, name) => `press ${key} in ${name}`,
  navigate: (url) => `open ${url}`,
  element: "element",
};

test("recorded actions become readable steps", () => {
  assert.equal(stepText({ kind: "click", name: "Save" }, words), "click Save");
  assert.equal(stepText({ kind: "fill", name: "Password", value: "", secret: true }, words), "secret Password");
  assert.equal(stepText({ kind: "select", name: "Country", value: "kz", optionLabel: "Kazakhstan" }, words), "select Country=Kazakhstan");
  assert.equal(stepText({ kind: "click", selector: "div > span" }, words), "click div > span");
  assert.equal(stepText({ kind: "click" }, words), "click element");
});

test("a Playwright UI scenario is generated from recorded steps", () => {
  const step = (action: ManualStep["action"], text = "manual"): ManualStep => ({ id: text, text, timestamp: 1, requestIds: [], action });
  const scenario = playwrightUiScenario([
    step({ kind: "navigate", url: "https://shop.test/login", pageUrl: "https://shop.test/login" }),
    step({ kind: "fill", value: "user@test", locator: { kind: "label", value: "E-mail" } }),
    step({ kind: "fill", value: "", secret: true, locator: { kind: "placeholder", value: "Password" } }),
    step({ kind: "click", locator: { kind: "role", role: "button", value: "Sign in" } }),
    step({ kind: "navigate", url: "https://shop.test/cart" }),
    step(undefined, "Check the total by eye"),
    step({ kind: "check", locator: { kind: "testid", value: "agree" } }),
    step({ kind: "select", value: "kz", locator: { kind: "css", value: "#country" } }),
  ], "Checkout");

  assert.match(scenario, /test\("Checkout", async \(\{ page \}\) => \{/);
  assert.match(scenario, /await page\.goto\("https:\/\/shop\.test\/login"\);/);
  assert.match(scenario, /await page\.getByLabel\("E-mail"\)\.fill\("user@test"\);/);
  assert.match(scenario, /await page\.getByPlaceholder\("Password"\)\.fill\(process\.env\.TEST_PASSWORD \?\? ''\);/);
  assert.match(scenario, /await page\.getByRole\("button", \{ name: "Sign in" \}\)\.click\(\);/);
  assert.match(scenario, /await page\.waitForURL\("https:\/\/shop\.test\/cart"\);/);
  assert.match(scenario, /\/\/ Check the total by eye/);
  assert.match(scenario, /await page\.getByTestId\("agree"\)\.check\(\);/);
  assert.match(scenario, /await page\.locator\("#country"\)\.selectOption\("kz"\);/);
  assert.ok(!scenario.includes("user-password"), "a password value is never part of the test");
});

// ---- Jira -------------------------------------------------------------------------------------

const jira = { baseUrl: "https://jira.test/jira/", authType: "basic" as const, email: "qa@test", token: "t0ken", projectKey: "QA", issueType: "Bug" };

test("Jira settings are validated and turned into request parts", () => {
  assert.equal(jiraBaseUrl(jira), "https://jira.test/jira");
  assert.equal(jiraBaseUrl({ baseUrl: "ftp://jira" }), null);
  assert.equal(isJiraConfigured(jira), true);
  assert.equal(isJiraConfigured({ ...jira, email: "" }), false, "basic auth needs an e-mail");
  assert.equal(isJiraConfigured({ ...jira, email: "", authType: "bearer" }), true);
  assert.equal(isJiraConfigured({ ...jira, token: " " }), false);
  assert.equal(jiraAuthHeader(jira), `Basic ${Buffer.from("qa@test:t0ken").toString("base64")}`);
  assert.equal(jiraAuthHeader({ ...jira, authType: "bearer" }), "Bearer t0ken");
  assert.deepEqual(buildIssuePayload(jira, { summary: "  Broken cart ", description: "h2. Steps" }), {
    fields: { project: { key: "QA" }, summary: "Broken cart", description: "h2. Steps", issuetype: { name: "Bug" } },
  });
});

test("an issue is created and the screenshot attached to it", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return calls.length === 1 ? new Response('{"key":"QA-7"}', { status: 201 }) : new Response("[]", { status: 200 });
  }) as typeof fetch;

  const result = await createJiraIssue(jira, { summary: "Broken cart", description: "text", screenshotDataUrl: "data:image/png;base64,UE5H" }, fakeFetch);
  assert.deepEqual(result, { key: "QA-7", url: "https://jira.test/jira/browse/QA-7" });
  assert.equal(calls[0].url, "https://jira.test/jira/rest/api/2/issue");
  assert.equal(calls[0].init.credentials, "omit", "browser cookies are never sent");
  assert.equal((calls[0].init.headers as Record<string, string>)["X-Atlassian-Token"], "no-check");
  assert.equal(calls[1].url, "https://jira.test/jira/rest/api/2/issue/QA-7/attachments");
  assert.ok(calls[1].init.body instanceof FormData);
});

test("Jira errors are passed on; a failed attachment does not lose the issue", async () => {
  const rejecting = (async () => new Response('{"errorMessages":["No permission"],"errors":{"summary":"required"}}', { status: 400 })) as typeof fetch;
  await assert.rejects(() => createJiraIssue(jira, { summary: "x", description: "y" }, rejecting), /HTTP 400 — No permission; summary: required/);
  await assert.rejects(() => createJiraIssue({ ...jira, token: "" }, { summary: "x", description: "y" }, rejecting), /not configured/);

  let call = 0;
  const flaky = (async () => (++call === 1 ? new Response('{"key":"QA-8"}', { status: 201 }) : new Response("", { status: 413 }))) as typeof fetch;
  const result = await createJiraIssue(jira, { summary: "x", description: "y", screenshotDataUrl: "data:image/png;base64,UE5H" }, flaky);
  assert.equal(result.key, "QA-8");
  assert.match(result.attachmentError || "", /HTTP 413/);
});
