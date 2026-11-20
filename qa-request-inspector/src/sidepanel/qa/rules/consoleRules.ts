import type { QAAnalysisInput } from "../core/rulesEngine";
import type { QARule } from "../core/types";
import { qt } from "../messages.ts";

export const consoleErrorRule: QARule<QAAnalysisInput> = {
  id: "console.runtime-error",
  get name() { return qt().ruleConsoleError; },
  category: "console",
  check: ({ consoleErrors, settings }) => !settings.consoleErrorsEnabled ? [] : consoleErrors.map((error) => ({
    id: `console.runtime-error:${error.id}`,
    ruleId: "console.runtime-error",
    category: "console",
    severity: "error",
    title: error.type === "unhandledrejection" ? qt().unhandledRejection : qt().javascriptError,
    description: error.message,
    timestamp: error.timestamp,
    url: error.pageUrl,
    evidence: { type: error.type },
  })),
};
