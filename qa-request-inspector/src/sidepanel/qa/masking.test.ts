import assert from "node:assert/strict";
import test from "node:test";
import type { ApiRequest } from "../types";
import { MASK, maskBodyText, maskHeaders, maskJson, maskRequest, maskRequests, maskUrl } from "./masking.ts";

const request: ApiRequest = {
  id: "1",
  type: "fetch",
  method: "POST",
  url: "https://api.test/login?access_token=abc123&page=2",
  requestHeaders: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature", "Content-Type": "application/json", Cookie: "sid=42" },
  requestBody: '{"login":"qa@test.io","password":"hunter2","profile":{"apiKey":"k-1","name":"QA"}}',
  responseHeaders: { "set-cookie": "session=abc; HttpOnly", "x-request-id": "r-1" },
  responseBody: { token: "t-1", user: { email: "qa@test.io", refresh_token: "r-2" }, items: [{ secret: 5, title: "ok" }] },
  status: 200,
  statusText: "OK",
  duration: 10,
  timestamp: 1,
  error: null,
  pageUrl: "https://app.test/",
  pageTitle: "App",
};

test("masks credential headers and keeps the scheme", () => {
  const headers = maskHeaders(request.requestHeaders);
  assert.equal(headers.Authorization, `Bearer ${MASK}`);
  assert.equal(headers.Cookie, MASK);
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(maskHeaders(request.responseHeaders)["set-cookie"], MASK);
  assert.equal(maskHeaders({ "X-Api-Key": "k", "x-csrf-token": "c" })["X-Api-Key"], MASK);
  assert.deepEqual(maskHeaders(undefined), {});
});

test("masks secret query parameters only", () => {
  assert.equal(maskUrl(request.url), `https://api.test/login?access_token=${encodeURIComponent(MASK)}&page=2`);
  assert.equal(maskUrl("https://api.test/items?page=2"), "https://api.test/items?page=2");
  assert.equal(maskUrl("not a url"), "not a url");
});

test("masks secret keys in JSON at any depth and leaves other data", () => {
  const body = maskJson(request.responseBody) as { token: string; user: { email: string; refresh_token: string }; items: Array<{ secret: unknown; title: string }> };
  assert.equal(body.token, MASK);
  assert.equal(body.user.refresh_token, MASK);
  assert.equal(body.user.email, "qa@test.io", "personal data is not a credential");
  assert.equal(body.items[0].secret, MASK);
  assert.equal(body.items[0].title, "ok");
});

test("masks JSON, form and plain text bodies", () => {
  const json = JSON.parse(maskBodyText(request.requestBody as string));
  assert.equal(json.password, MASK);
  assert.equal(json.profile.apiKey, MASK);
  assert.equal(json.login, "qa@test.io");
  assert.equal(maskBodyText("user=qa&password=hunter2&remember=1"), `user=qa&password=${MASK}&remember=1`);
  assert.equal(maskBodyText("sent Bearer abcdefgh12345 to server"), `sent Bearer ${MASK} to server`);
  assert.equal(maskBodyText("plain text"), "plain text");
});

test("maskRequest does not modify the source and can be switched off", () => {
  const masked = maskRequest(request);
  assert.equal(request.requestHeaders.Authorization.startsWith("Bearer eyJ"), true);
  assert.equal((request.responseBody as { token: string }).token, "t-1");
  assert.equal(masked.method, "POST");
  assert.equal(masked.status, 200);
  assert.equal(JSON.stringify(masked).includes("hunter2"), false);
  assert.equal(JSON.stringify(masked).includes("eyJhbGci"), false);
  assert.equal(maskRequests([request], false)[0], request);
  assert.notEqual(maskRequests([request], true)[0], request);
});
