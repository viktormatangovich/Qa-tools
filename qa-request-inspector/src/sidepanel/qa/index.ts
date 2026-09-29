import { createRulesEngine } from "./core/rulesEngine";
import { consoleErrorRule } from "./rules/consoleRules";
import { domAccessibilityRule } from "./rules/domRules";
import { sensitiveDataRule } from "./rules/securityRules";
import {
  duplicateRequestRule,
  largeResponseRule,
  failedRequestRule,
  httpClientErrorRule,
  httpServerErrorRule,
  slowRequestRule,
} from "./rules/networkRules";

export { defaultQASettings } from "./core/types";
export type { DOMFinding, QAIssue, QAIssueCategory, QAIssueSeverity, QASettings } from "./core/types";

export const qaRulesEngine = createRulesEngine([
  httpClientErrorRule,
  httpServerErrorRule,
  slowRequestRule,
  largeResponseRule,
  failedRequestRule,
  duplicateRequestRule,
  consoleErrorRule,
  domAccessibilityRule,
  sensitiveDataRule,
]);
