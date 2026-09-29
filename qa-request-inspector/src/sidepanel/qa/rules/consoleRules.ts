import type { QAAnalysisInput } from "../core/rulesEngine";
import type { QARule } from "../core/types";

export const consoleErrorRule: QARule<QAAnalysisInput> = {
  id: "console.runtime-error",
  name: "Ошибка консоли",
  category: "console",
  check: ({ consoleErrors, settings }) => !settings.consoleErrorsEnabled ? [] : consoleErrors.map((error) => ({
    id: `console.runtime-error:${error.id}`,
    ruleId: "console.runtime-error",
    category: "console",
    severity: "error",
    title: error.type === "unhandledrejection" ? "Необработанное отклонение Promise" : "Ошибка JavaScript",
    description: error.message,
    timestamp: error.timestamp,
    url: error.pageUrl,
    evidence: { type: error.type },
  })),
};
