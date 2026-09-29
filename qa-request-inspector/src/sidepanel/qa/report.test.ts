import assert from "node:assert/strict";
import test from "node:test";
import { createDetailedBugReport } from "./report.ts";
import type { QAIssue } from "./core/types.ts";

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
