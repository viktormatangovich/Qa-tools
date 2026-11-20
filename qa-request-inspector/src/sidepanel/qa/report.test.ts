import assert from "node:assert/strict";
import test from "node:test";
import { createDetailedBugReport } from "./report.ts";
import type { QAIssue } from "./core/types.ts";
import { createSessionReport, createSessionReportHtml, createSessionReportJson } from "./report.ts";
import { setQaLanguage } from "./messages.ts";
import type { ApiRequest } from "../types.ts";

test("includes page and DOM element context in an accessibility bug report", () => {
  const issue: QAIssue = { id: "issue-1", ruleId: "dom.accessibility-basics", category: "accessibility", severity: "warning", title: "Accessibility issue", description: "Missing accessible name.", timestamp: 0, url: "https://example.test/account", evidence: { selector: "button:nth-of-type(2)", elementDescription: '<button data-testid="main-menu">', pageTitle: "Account" } };
  const report = createDetailedBugReport(issue);
  assert.match(report, /## \u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430\nhttps:\/\/example\.test\/account\n- \u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b: Account/);
  assert.match(report, /<button data-testid="main-menu">/);
  assert.match(report, /`button:nth-of-type\(2\)`/);
});

test("includes an observed contract mismatch as the error cause", () => {
  const issue: QAIssue = {
    id: "contract-1", ruleId: "contract.openapi", category: "contract", severity: "error",
    title: "Нарушение API-контракта", description: "$.discount: Неожиданный тип значения.",
    timestamp: 0, url: "https://example.test/v1/carts",
    evidence: { path: "$.discount", expected: "number", actual: "string" },
  };

  const report = createDetailedBugReport(issue);
  assert.match(report, /## Причина возникновения ошибки\nЗначение \$\.discount не соответствует контракту: ожидалось «number», получено «string»\./);
});

const noted: ApiRequest = { id: "r1", type: "fetch", method: "POST", url: "https://example.test/v1/carts", requestHeaders: {}, requestBody: null, responseHeaders: {}, responseBody: null, status: 500, statusText: "", duration: 10, timestamp: 1, error: null, pageUrl: "", pageTitle: "", note: "Total <b>doubled</b> after retry" };

test("session reports carry request notes; HTML escapes them", () => {
  const plain = { ...noted, id: "r2", note: undefined };
  assert.match(createSessionReport([noted, plain], [], []), /## Заметки к запросам\n### POST https:\/\/example\.test\/v1\/carts\n- Заметка: Total <b>doubled<\/b> after retry/);
  assert.doesNotMatch(createSessionReport([plain], [], []), /Заметк/);
  const html = createSessionReportHtml([noted], [], []);
  assert.match(html, /Заметка: Total &lt;b&gt;doubled&lt;\/b&gt; after retry/);
  assert.doesNotMatch(html, /<b>doubled/);
  assert.deepEqual(JSON.parse(createSessionReportJson([noted, plain], [], [])).notes, [{ requestId: "r1", method: "POST", url: noted.url, note: noted.note }]);
});

test("bug and session reports are produced in English when selected", () => {
  setQaLanguage("en");
  try {
    const issue: QAIssue = { id: "c", ruleId: "contract.openapi", category: "contract", severity: "error", title: "API contract violation", description: "d", timestamp: 0, url: "https://example.test", evidence: { path: "$.total", expected: "number", actual: "string" } };
    const report = createDetailedBugReport(issue);
    assert.match(report, /## Steps to reproduce\n1\. Open the page: https:\/\/example\.test\./);
    assert.match(report, /## Cause\nValue \$\.total does not match the contract: expected "number", got "string"\./);
    const session = createSessionReport([noted], [], []);
    assert.match(session, /^# QA session report\n/);
    assert.match(session, /- Note: Total <b>doubled<\/b> after retry/);
    assert.match(createSessionReportHtml([noted], [], []), /<title>QA session report<\/title>/);
  } finally {
    setQaLanguage("ru");
  }
  assert.match(createSessionReport([], [], []), /^# Отчёт QA-сессии/);
});
