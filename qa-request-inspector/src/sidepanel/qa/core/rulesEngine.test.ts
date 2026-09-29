import assert from "node:assert/strict";
import test from "node:test";
import { createRulesEngine } from "./rulesEngine.ts";
import { defaultQASettings } from "./types.ts";
import { consoleErrorRule } from "../rules/consoleRules.ts";
import { domAccessibilityRule } from "../rules/domRules.ts";
import { sensitiveDataRule } from "../rules/securityRules.ts";
import {
  duplicateRequestRule,
  failedRequestRule,
  httpClientErrorRule,
  httpServerErrorRule,
  largeResponseRule,
  slowRequestRule,
} from "../rules/networkRules.ts";

const qaRulesEngine = createRulesEngine([
  httpClientErrorRule,
  httpServerErrorRule,
  largeResponseRule,
  slowRequestRule,
  failedRequestRule,
  duplicateRequestRule,
  consoleErrorRule,
  domAccessibilityRule,
  sensitiveDataRule,
]);

const request = (overrides: Record<string, unknown> = {}) => ({
  id: "request-1", type: "fetch" as const, method: "GET", url: "https://example.test/api/products",
  requestHeaders: {}, requestBody: null, responseHeaders: {}, responseBody: null,
  status: 200, statusText: "OK", duration: 20, timestamp: 1_000, error: null,
  pageUrl: "https://example.test", pageTitle: "Example", ...overrides,
});

test("reports 4xx, 5xx, slow and failed requests", () => {
  const issues = qaRulesEngine.analyze({
    requests: [request({ id: "four", status: 404, url: "https://example.test/four" }), request({ id: "five", status: 503, url: "https://example.test/five" }), request({ id: "slow", duration: 2001, url: "https://example.test/slow" }), request({ id: "failed", status: 0, error: "net::ERR_FAILED", url: "https://example.test/failed" })],
    consoleErrors: [], domFindings: [], settings: defaultQASettings,
  });
  assert.deepEqual(issues.map((issue) => issue.ruleId).sort(), ["network.failed-request", "network.http-client-error", "network.http-server-error", "network.slow-request"]);
});

test("groups only same request fingerprints within the configured window", () => {
  const issues = qaRulesEngine.analyze({
    requests: [request({ id: "one", timestamp: 1_000 }), request({ id: "two", timestamp: 1_100 }), request({ id: "three", timestamp: 1_200 }), request({ id: "different-query", url: "https://example.test/api/products?page=2", timestamp: 1_250 })],
    consoleErrors: [], domFindings: [], settings: defaultQASettings,
  });
  const duplicate = issues.find((issue) => issue.ruleId === "network.duplicate-request");
  assert.equal(duplicate?.evidence?.count, 3);
});

test("does not flag polling-like endpoints and maps console errors", () => {
  const issues = qaRulesEngine.analyze({
    requests: [request({ id: "one", url: "https://example.test/metrics", timestamp: 1_000 }), request({ id: "two", url: "https://example.test/metrics", timestamp: 1_100 }), request({ id: "three", url: "https://example.test/metrics", timestamp: 1_200 })],
    consoleErrors: [{ id: "console-1", type: "unhandledrejection" as const, message: "nope", timestamp: 2_000, pageUrl: "https://example.test", pageTitle: "Example" }],
    domFindings: [],
    settings: defaultQASettings,
  });
  assert.equal(issues.some((issue) => issue.ruleId === "network.duplicate-request"), false);
  assert.equal(issues.find((issue) => issue.ruleId === "console.runtime-error")?.title, "Необработанное отклонение Promise");
});

test("maps local DOM findings to standard accessibility issues", () => {
  const issues = qaRulesEngine.analyze({
    requests: [], consoleErrors: [], settings: defaultQASettings,
    domFindings: [{ type: "button-without-accessible-name", selector: "button:nth-of-type(2)", tagName: "button", elementDescription: '<button data-testid="main-menu">', pageUrl: "https://example.test/account", pageTitle: "Account", timestamp: 3_000 }],
  });
  assert.deepEqual(issues[0], {
    id: "dom.accessibility-basics:button-without-accessible-name:button:nth-of-type(2)",
    ruleId: "dom.accessibility-basics",
    category: "accessibility",
    severity: "warning",
    title: "У кнопки нет доступного имени",
    description: "У кнопки нет текста, метки или другого доступного имени.",
    timestamp: 3_000,
    url: "https://example.test/account",
    evidence: { selector: "button:nth-of-type(2)", element: "button", elementDescription: '<button data-testid="main-menu">', pageTitle: "Account" },
  });
});

test("masks sensitive query values instead of exposing them", () => {
  const issues = qaRulesEngine.analyze({ requests: [request({ url: "https://example.test/api?access_token=abcdefghijklmnopqrstuvwxyz" })], consoleErrors: [], domFindings: [], settings: defaultQASettings });
  assert.match(issues[0]?.description || "", /access_token=abcdef\.\.\.wxyz/);
  assert.equal(issues[0]?.description.includes("abcdefghijklmnopqrstuvwxyz"), false);
});

test("detects masked sensitive JSON values but does not flag ordinary Authorization headers", () => {
  const issues = qaRulesEngine.analyze({ requests: [request({ requestHeaders: { Authorization: "Bearer normal-auth-header" }, requestBody: '{"password":"very-secret-password"}' })], consoleErrors: [], domFindings: [], settings: defaultQASettings });
  assert.equal(issues.length, 1);
  assert.match(issues[0]?.description || "", /password=very-s\.\.\.word/);
});

test("flags a large response and respects an analyzer toggle", () => {
  const settings = { ...defaultQASettings, largeResponseThresholdBytes: 4 };
  const issues = qaRulesEngine.analyze({ requests: [request({ responseBody: "12345" })], consoleErrors: [], domFindings: [], settings });
  assert.equal(issues.find((issue) => issue.ruleId === "network.large-response")?.severity, "warning");
  assert.equal(qaRulesEngine.analyze({ requests: [request({ responseBody: "12345" })], consoleErrors: [], domFindings: [], settings: { ...settings, largeResponsesEnabled: false } }).some((issue) => issue.ruleId === "network.large-response"), false);
});
