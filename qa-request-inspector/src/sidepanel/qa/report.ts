import type { ApiRequest, ConsoleError } from "../types";
import type { QAIssue } from "./core/types";
import { qt } from "./messages.ts";

export function createBugReport(issue: QAIssue, request?: ApiRequest): string {
  const m = qt();
  const now = new Date(issue.timestamp).toISOString();
  return `# ${issue.title}\n\n## URL\n${issue.url || request?.pageUrl || m.notAvailable}\n\n## ${m.bugEnvironment}\n- ${m.bugBrowser}: ${navigator.userAgent}\n- ${m.bugTime}: ${now}\n\n## ${m.bugSteps}\n1. ${m.bugStepStart}\n2. ${m.bugStepRepeat}\n\n## ${m.bugExpected}\n${m.bugExpectedText}\n\n## ${m.bugActual}\n${issue.description}\n\n## ${m.bugEvidence}\n- ${m.bugCategory}: ${issue.category}\n- ${m.bugSeverity}: ${issue.severity}\n- ${m.bugRule}: ${issue.ruleId}\n${request ? `- ${m.bugRequest}: ${request.method} ${request.url}\n- ${m.bugStatus}: ${request.status}\n- ${m.bugDuration}: ${request.duration} ${m.ms}` : ""}`;
}

function evidenceValue(issue: QAIssue, key: string): string | undefined {
  const value = issue.evidence?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Returns the observed cause; it deliberately avoids request/response bodies and headers. */
function errorCause(issue: QAIssue, request?: ApiRequest): string {
  if (request?.error) return qt().causeRequestFailed(request.error);

  const expected = evidenceValue(issue, "expected");
  const actual = evidenceValue(issue, "actual");
  const path = evidenceValue(issue, "path");
  if (expected && actual) return qt().causeContract(path || "", expected, actual);

  if (request && request.status >= 400) return qt().causeHttp(request.status, request.statusText);

  return issue.description;
}

/** Builds a reproducible report for findings that originate from the inspected page DOM. */
export function createDetailedBugReport(issue: QAIssue, request?: ApiRequest): string {
  const m = qt();
  const now = new Date(issue.timestamp).toISOString();
  const pageUrl = issue.url || request?.pageUrl || m.notAvailable;
  const pageTitle = evidenceValue(issue, "pageTitle") || request?.pageTitle;
  const selector = evidenceValue(issue, "selector");
  const elementDescription = evidenceValue(issue, "elementDescription") || evidenceValue(issue, "element");
  const pageContext = pageTitle ? `${pageUrl}\n- ${m.bugPageTitle}: ${pageTitle}` : pageUrl;
  const elementContext = [elementDescription && `- ${m.bugElement}: ${elementDescription}`, selector && `- ${m.bugSelector}: \`${selector}\``].filter(Boolean).join("\n") || m.notAvailable;
  const reproductionTarget = elementDescription || selector || m.bugElementFallback;
  const requestEvidence = [request && `- ${m.bugRequest}: ${request.method} ${request.url}\n- ${m.bugStatus}: ${request.status}\n- ${m.bugDuration}: ${request.duration} ${m.ms}`, `## ${m.bugCause}\n${errorCause(issue, request)}`].filter(Boolean).join("\n\n");
  const browser = typeof navigator === "undefined" ? m.notAvailable : navigator.userAgent;
  return `# ${issue.title}\n\n## ${m.bugPage}\n${pageContext}\n\n## ${m.bugElementSection}\n${elementContext}\n\n## ${m.bugEnvironment}\n- ${m.bugBrowser}: ${browser}\n- ${m.bugTime}: ${now}\n\n## ${m.bugSteps}\n1. ${m.bugStepOpen(pageUrl)}\n2. ${m.bugStepFind(reproductionTarget)}\n3. ${m.bugStepAudit}\n\n## ${m.bugExpected}\n${m.bugDomExpectedText}\n\n## ${m.bugActual}\n${issue.description}\n\n## ${m.bugEvidence}\n- ${m.bugCategory}: ${issue.category}\n- ${m.bugSeverity}: ${issue.severity}\n- ${m.bugRule}: ${issue.ruleId}\n${requestEvidence}`;
}

/** Requests that carry a QA note, oldest first (the list itself is newest first). */
function notedRequests(requests: ApiRequest[]): ApiRequest[] {
  return requests.filter((request) => request.note?.trim()).reverse();
}

export function createSessionReport(requests: ApiRequest[], consoleErrors: ConsoleError[], issues: QAIssue[]): string {
  const m = qt();
  const first = requests[requests.length - 1]?.timestamp;
  const last = requests[0]?.timestamp;
  const duration = first && last ? Math.max(0, last - first) : 0;
  const count = (category: string) => issues.filter((issue) => issue.category === category).length;
  const grouped = Object.entries(issues.reduce<Record<string, QAIssue[]>>((groups, issue) => { (groups[issue.category] ||= []).push(issue); return groups; }, {})).map(([category, entries]) => `### ${category}\n${entries.map((issue) => `- [${issue.severity}] ${issue.title}: ${issue.description}`).join("\n")}`).join("\n\n");
  const noted = notedRequests(requests);
  const notes = noted.length ? `\n## ${m.srRequestNotes}\n${noted.map((request) => `### ${request.method} ${request.url}\n- ${m.note}: ${request.note!.trim()}`).join("\n\n")}\n` : "";
  return `# ${m.sessionReportTitle}\n\n- ${m.srDomain}: ${requests[0] ? new URL(requests[0].url).host : m.notAvailable}\n- ${m.srDuration}: ${Math.round(duration / 1000)}s\n\n## ${m.srNetwork}\n- ${m.srRequests}: ${requests.length}\n- ${m.srFailed}: ${requests.filter((request) => request.error || request.status >= 400).length}\n- ${m.srSlow}: ${issues.filter((issue) => issue.ruleId === "network.slow-request").length}\n- ${m.srDuplicates}: ${issues.filter((issue) => issue.ruleId === "network.duplicate-request").length}\n\n## ${m.srConsole}\n- ${m.srErrors}: ${consoleErrors.length}\n\n## ${m.srContract}\n- ${m.srViolations}: ${count("contract")}\n\n## ${m.srDom}\n- ${m.srProblems}: ${count("dom") + count("accessibility")}\n\n## ${m.srSecurity}\n- ${m.srWarnings}: ${count("security")}\n\n## ${m.srByCategory}\n${grouped || m.srNone}\n${notes}`;
}

export function createSessionReportJson(requests: ApiRequest[], consoleErrors: ConsoleError[], issues: QAIssue[]): string {
  const notes = notedRequests(requests).map((request) => ({ requestId: request.id, method: request.method, url: request.url, note: request.note!.trim() }));
  return JSON.stringify({ generatedAt: new Date().toISOString(), requests: requests.length, consoleErrors: consoleErrors.length, issues, ...(notes.length ? { notes } : {}) }, null, 2);
}

export function createSessionReportHtml(requests: ApiRequest[], consoleErrors: ConsoleError[], issues: QAIssue[]): string {
  const m = qt();
  const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
  const noted = notedRequests(requests);
  const notes = noted.length ? `<h2>${escape(m.srRequestNotes)}</h2><ul>${noted.map((request) => `<li><strong>${escape(request.method)}</strong> ${escape(request.url)}<br>${escape(m.note)}: ${escape(request.note!.trim())}</li>`).join("")}</ul>` : "";
  return `<!doctype html><meta charset="utf-8"><title>${escape(m.sessionReportTitle)}</title><h1>${escape(m.sessionReportTitle)}</h1><p>${escape(m.srRequests)}: ${requests.length} &middot; ${escape(m.srConsoleErrors)}: ${consoleErrors.length} &middot; ${escape(m.srProblems)}: ${issues.length}</p><ul>${issues.map((issue) => `<li><strong>${escape(issue.severity)}</strong> ${escape(issue.title)} &mdash; ${escape(issue.description)}</li>`).join("")}</ul>${notes}`;
}
