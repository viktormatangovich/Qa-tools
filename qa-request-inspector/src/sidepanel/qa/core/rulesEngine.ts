import type { ApiRequest, ConsoleError } from "../../types";
import type { DOMFinding, QAIssue, QARule, QASettings } from "./types";

export interface QAAnalysisInput {
  requests: ApiRequest[];
  consoleErrors: ConsoleError[];
  domFindings: DOMFinding[];
  settings: QASettings;
}

export interface QARulesEngine {
  analyze(input: QAAnalysisInput): QAIssue[];
}

export function createRulesEngine(
  rules: Array<QARule<QAAnalysisInput>>,
): QARulesEngine {
  return {
    analyze(input) {
      return rules
        .flatMap((rule) => rule.check(input))
        .sort((a, b) => b.timestamp - a.timestamp);
    },
  };
}
