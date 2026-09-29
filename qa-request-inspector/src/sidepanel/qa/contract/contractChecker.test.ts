import assert from "node:assert/strict";
import test from "node:test";
import { contractCoverage, contractIssues, loadOpenApiSpecFromUrl, matchEndpoint, parseOpenApiSpec, validateRequest, validateResponse } from "./contractChecker.ts";
import { contractTestSuggestions } from "./suggestions.ts";
import { diffOpenApi } from "./contractDiff.ts";

const spec = parseOpenApiSpec(JSON.stringify({
  openapi: "3.0.3",
  paths: {
    "/users/{id}/orders/{orderId}": {
      get: {
        responses: {
          "200": { content: { "application/json": { schema: { type: "object", required: ["id"], properties: { id: { type: "integer" }, status: { type: "string", enum: ["paid"] } } } } } },
        },
      },
    },
  },
}));
const request = { id: "request", type: "fetch" as const, method: "GET", url: "https://example.test/users/123/orders/5?debug=1", requestHeaders: {}, requestBody: null, responseHeaders: { "content-type": "application/json" }, responseBody: { id: "5", status: "wrong" }, status: 200, statusText: "OK", duration: 10, timestamp: 1, error: null, pageUrl: "https://example.test", pageTitle: "Example" };

test("matches templated paths while ignoring query strings", () => assert.equal(matchEndpoint(spec, request)?.pathTemplate, "/users/{id}/orders/{orderId}"));
test("reports schema violations with JSON paths", () => {
  const violations = validateResponse(spec, request);
  assert.equal(violations[0]?.path, "$.id");
  assert.equal(violations[1]?.path, "$.status");
  assert.equal(contractIssues(spec, [request]).length, 2);
});
test("calculates API Contract Coverage from exercised endpoints", () => assert.deepEqual(contractCoverage(spec, [request]), { total: 1, exercised: 1, validated: 1, passed: 0, failed: 1 }));
test("creates deterministic boundary suggestions without sending requests", () => assert.deepEqual(contractTestSuggestions({ type: "integer", minimum: 18, maximum: 20 }), [17, 18, 19, 20, 21, null, "0"]));
test("finds removed endpoints as breaking contract changes", () => assert.match(diffOpenApi(spec, parseOpenApiSpec('{"openapi":"3.0.3","paths":{}}'))[0]?.message || "", /Endpoint removed/));
test("validates required query parameters and request body schema", () => {
  const requestSpec = parseOpenApiSpec('{"openapi":"3.0.3","paths":{"/orders":{"post":{"parameters":[{"name":"quantity","in":"query","required":true,"schema":{"type":"integer"}}],"requestBody":{"required":true,"content":{"application/json":{"schema":{"type":"object","required":["name"]}}}},"responses":{"200":{}}}}}}');
  const invalidRequest = { ...request, method: "POST", url: "https://example.test/orders?quantity=wrong", requestBody: "{}" };
  assert.equal(validateRequest(requestSpec, invalidRequest).length, 2);
});

test("loads a valid OpenAPI document from an HTTP URL", async () => {
  const text = '{"openapi":"3.0.3","paths":{}}';
  const loaded = await loadOpenApiSpecFromUrl("https://example.test/openapi.json", async () => new Response(text, { status: 200 }));
  assert.equal(loaded, text);
});

test("rejects unsupported URLs and invalid downloaded documents", async () => {
  await assert.rejects(() => loadOpenApiSpecFromUrl("file:///openapi.json"), /HTTP\(S\)/);
  await assert.rejects(() => loadOpenApiSpecFromUrl("https://example.test/openapi.json", async () => new Response("{}", { status: 200 })), /OpenAPI 3.x/);
});
