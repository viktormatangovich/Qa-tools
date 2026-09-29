import type { ApiRequest, ConsoleError } from "../types";
import type { QAIssue } from "./core/types";

export function createBugReport(issue: QAIssue, request?: ApiRequest): string {
  const now = new Date(issue.timestamp).toISOString();
  return `# ${issue.title}\n\n## URL\n${issue.url || request?.pageUrl || "\u041d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e"}\n\n## \u041e\u043a\u0440\u0443\u0436\u0435\u043d\u0438\u0435\n- \u0411\u0440\u0430\u0443\u0437\u0435\u0440: ${navigator.userAgent}\n- \u0412\u0440\u0435\u043c\u044f: ${now}\n\n## \u0428\u0430\u0433\u0438 \u0434\u043b\u044f \u0432\u043e\u0441\u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0434\u0435\u043d\u0438\u044f\n1. \u041d\u0430\u0447\u043d\u0438\u0442\u0435 \u0441\u0435\u0441\u0441\u0438\u044e \u0437\u0430\u043f\u0438\u0441\u0438.\n2. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435, \u0432\u044b\u0437\u044b\u0432\u0430\u044e\u0449\u0435\u0435 \u043e\u0448\u0438\u0431\u043a\u0443.\n\n## \u041e\u0436\u0438\u0434\u0430\u0435\u043c\u044b\u0439 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\n\u041f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0432\u044b\u043f\u043e\u043b\u043d\u044f\u0435\u0442 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0431\u0435\u0437 \u044d\u0442\u043e\u0439 \u043e\u0448\u0438\u0431\u043a\u0438.\n\n## \u0424\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\n${issue.description}\n\n## \u0422\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0434\u043e\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u0430\n- \u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f: ${issue.category}\n- \u041a\u0440\u0438\u0442\u0438\u0447\u043d\u043e\u0441\u0442\u044c: ${issue.severity}\n- \u041f\u0440\u0430\u0432\u0438\u043b\u043e: ${issue.ruleId}\n${request ? `- \u0417\u0430\u043f\u0440\u043e\u0441: ${request.method} ${request.url}\n- \u0421\u0442\u0430\u0442\u0443\u0441: ${request.status}\n- \u0414\u043b\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c: ${request.duration} \u043c\u0441` : ""}`;
}

function evidenceValue(issue: QAIssue, key: string): string | undefined {
  const value = issue.evidence?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Returns the observed cause; it deliberately avoids request/response bodies and headers. */
function errorCause(issue: QAIssue, request?: ApiRequest): string {
  if (request?.error) return `Запрос не завершился: ${request.error}`;

  const expected = evidenceValue(issue, "expected");
  const actual = evidenceValue(issue, "actual");
  const path = evidenceValue(issue, "path");
  if (expected && actual) return `Значение${path ? ` ${path}` : ""} не соответствует контракту: ожидалось «${expected}», получено «${actual}».`;

  if (request && request.status >= 400) return `Сервер вернул HTTP ${request.status}${request.statusText ? `: ${request.statusText}` : ""}.`;

  return issue.description;
}

/** Builds a reproducible report for findings that originate from the inspected page DOM. */
export function createDetailedBugReport(issue: QAIssue, request?: ApiRequest): string {
  const now = new Date(issue.timestamp).toISOString();
  const pageUrl = issue.url || request?.pageUrl || "\u041d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e";
  const pageTitle = evidenceValue(issue, "pageTitle") || request?.pageTitle;
  const selector = evidenceValue(issue, "selector");
  const elementDescription = evidenceValue(issue, "elementDescription") || evidenceValue(issue, "element");
  const pageContext = pageTitle ? `${pageUrl}\n- \u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b: ${pageTitle}` : pageUrl;
  const elementContext = [elementDescription && `- \u042d\u043b\u0435\u043c\u0435\u043d\u0442: ${elementDescription}`, selector && `- \u0421\u0435\u043b\u0435\u043a\u0442\u043e\u0440: \`${selector}\``].filter(Boolean).join("\n") || "\u041d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e";
  const reproductionTarget = elementDescription || selector || "\u043f\u0440\u043e\u0431\u043b\u0435\u043c\u043d\u044b\u0439 \u044d\u043b\u0435\u043c\u0435\u043d\u0442";
  const requestEvidence = [request && `- \u0417\u0430\u043f\u0440\u043e\u0441: ${request.method} ${request.url}\n- \u0421\u0442\u0430\u0442\u0443\u0441: ${request.status}\n- \u0414\u043b\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c: ${request.duration} \u043c\u0441`, `## \u041f\u0440\u0438\u0447\u0438\u043d\u0430 \u0432\u043e\u0437\u043d\u0438\u043a\u043d\u043e\u0432\u0435\u043d\u0438\u044f \u043e\u0448\u0438\u0431\u043a\u0438\n${errorCause(issue, request)}`].filter(Boolean).join("\n\n");
  const browser = typeof navigator === "undefined" ? "Unavailable" : navigator.userAgent;
  return `# ${issue.title}\n\n## \u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430\n${pageContext}\n\n## \u041f\u0440\u043e\u0431\u043b\u0435\u043c\u043d\u044b\u0439 \u044d\u043b\u0435\u043c\u0435\u043d\u0442\n${elementContext}\n\n## \u041e\u043a\u0440\u0443\u0436\u0435\u043d\u0438\u0435\n- \u0411\u0440\u0430\u0443\u0437\u0435\u0440: ${browser}\n- \u0412\u0440\u0435\u043c\u044f: ${now}\n\n## \u0428\u0430\u0433\u0438 \u0434\u043b\u044f \u0432\u043e\u0441\u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0434\u0435\u043d\u0438\u044f\n1. \u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443: ${pageUrl}.\n2. \u041d\u0430\u0439\u0434\u0438\u0442\u0435 ${reproductionTarget}.\n3. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0443 DOM / \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e\u0441\u0442\u0438.\n\n## \u041e\u0436\u0438\u0434\u0430\u0435\u043c\u044b\u0439 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\n\u0423 \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u0430 \u0435\u0441\u0442\u044c \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0435 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e\u0435 \u0438\u043c\u044f \u0438\u043b\u0438 \u0434\u0440\u0443\u0433\u043e\u0439 \u0430\u0442\u0440\u0438\u0431\u0443\u0442, \u0442\u0440\u0435\u0431\u0443\u0435\u043c\u044b\u0439 \u043f\u0440\u0430\u0432\u0438\u043b\u043e\u043c \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438.\n\n## \u0424\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\n${issue.description}\n\n## \u0422\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0434\u043e\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u0430\n- \u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f: ${issue.category}\n- \u041a\u0440\u0438\u0442\u0438\u0447\u043d\u043e\u0441\u0442\u044c: ${issue.severity}\n- \u041f\u0440\u0430\u0432\u0438\u043b\u043e: ${issue.ruleId}\n${requestEvidence}`;
}

export function createSessionReport(requests: ApiRequest[], consoleErrors: ConsoleError[], issues: QAIssue[]): string {
  const first = requests[requests.length - 1]?.timestamp;
  const last = requests[0]?.timestamp;
  const duration = first && last ? Math.max(0, last - first) : 0;
  const count = (category: string) => issues.filter((issue) => issue.category === category).length;
  const grouped = Object.entries(issues.reduce<Record<string, QAIssue[]>>((groups, issue) => { (groups[issue.category] ||= []).push(issue); return groups; }, {})).map(([category, entries]) => `### ${category}\n${entries.map((issue) => `- [${issue.severity}] ${issue.title}: ${issue.description}`).join("\n")}`).join("\n\n");
  return `# QA SESSION REPORT\n\n- Domain: ${requests[0] ? new URL(requests[0].url).host : "Not available"}\n- Duration: ${Math.round(duration / 1000)}s\n\n## Network\n- Requests: ${requests.length}\n- Failed: ${requests.filter((request) => request.error || request.status >= 400).length}\n- Slow: ${issues.filter((issue) => issue.ruleId === "network.slow-request").length}\n- Duplicates: ${issues.filter((issue) => issue.ruleId === "network.duplicate-request").length}\n\n## Console\n- Errors: ${consoleErrors.length}\n\n## Contract\n- Violations: ${count("contract")}\n\n## DOM / Accessibility\n- Issues: ${count("dom") + count("accessibility")}\n\n## Security\n- Warnings: ${count("security")}\n\n## Issues by category\n${grouped || "None"}\n`;
}

export function createSessionReportJson(requests: ApiRequest[], consoleErrors: ConsoleError[], issues: QAIssue[]): string {
  return JSON.stringify({ generatedAt: new Date().toISOString(), requests: requests.length, consoleErrors: consoleErrors.length, issues }, null, 2);
}

export function createSessionReportHtml(requests: ApiRequest[], consoleErrors: ConsoleError[], issues: QAIssue[]): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
  return `<!doctype html><meta charset="utf-8"><title>QA Session Report</title><h1>QA Session Report</h1><p>Requests: ${requests.length} &middot; Console errors: ${consoleErrors.length} &middot; Issues: ${issues.length}</p><ul>${issues.map((issue) => `<li><strong>${escape(issue.severity)}</strong> ${escape(issue.title)} &mdash; ${escape(issue.description)}</li>`).join("")}</ul>`;
}
