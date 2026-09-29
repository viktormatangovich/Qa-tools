import assert from "node:assert/strict";
import test from "node:test";
import { generateNegativeTests, negativeTestTargets } from "./negativeTesting.ts";

const request = { id: "1", type: "fetch" as const, method: "POST", url: "https://api.example.test/users?limit=10", requestHeaders: {}, requestBody: '{"age":18,"name":"Ada"}', responseHeaders: {}, responseBody: {}, status: 201, statusText: "Created", duration: 10, timestamp: 0, error: null, pageUrl: "", pageTitle: "" };
const document = { openapi: "3.0.0", paths: { "/users": { post: { parameters: [{ name: "limit", in: "query" as const, required: true, schema: { type: "integer", minimum: 1, maximum: 100 } }], requestBody: { content: { "application/json": { schema: { type: "object", required: ["age"], properties: { age: { type: "integer", minimum: 18, maximum: 120 }, name: { type: "string", maxLength: 3 } } } } } } } } } };

test("builds generic and OpenAPI boundary tests for a request field", () => {
  const target = negativeTestTargets(request, document).find((item) => item.id === "body:age");
  assert.ok(target);
  const tests = generateNegativeTests(request, target.id, document);
  assert.ok(tests.some((item) => item.title === "null"));
  assert.ok(tests.some((item) => item.title === "Ниже min (17)"));
  assert.ok(tests.some((item) => item.title === "Выше max (121)"));
  assert.match(tests.find((item) => item.title === "Обязательное поле отсутствует")?.body || "", /"name"/);
});
