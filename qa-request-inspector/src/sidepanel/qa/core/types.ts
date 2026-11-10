export type QAIssueSeverity = "info" | "warning" | "error" | "critical";

export type QAIssueCategory =
  | "network"
  | "console"
  | "performance"
  | "dom"
  | "accessibility"
  | "contract"
  | "security";

export interface QAIssue {
  id: string;
  ruleId: string;
  category: QAIssueCategory;
  severity: QAIssueSeverity;
  title: string;
  description: string;
  timestamp: number;
  url?: string;
  requestId?: string;
  /** Metadata safe to show in the UI. Never put bodies, headers, or tokens here. */
  evidence?: Record<string, string | number | boolean>;
}

export interface QASettings {
  autoQAEnabled: boolean;
  networkErrorsEnabled: boolean;
  slowRequestsEnabled: boolean;
  largeResponsesEnabled: boolean;
  duplicateDetectionEnabled: boolean;
  consoleErrorsEnabled: boolean;
  accessibilityEnabled: boolean;
  /** Full WCAG audit with axe-core when the page is checked (in addition to the built-in checks). */
  axeEnabled: boolean;
  securityChecksEnabled: boolean;
  contractValidationEnabled: boolean;
  slowRequestThresholdMs: number;
  largeResponseThresholdBytes: number;
  duplicateWindowMs: number;
  duplicateMinimumCount: number;
}

export type DOMFindingType =
  | "broken-image"
  | "missing-alt"
  | "input-without-label"
  | "button-without-accessible-name"
  | "positive-tabindex"
  | "clickable-without-keyboard"
  | "low-contrast"
  | "axe";

/** Minimal local-DOM evidence returned by the content script. */
export interface DOMFinding {
  type: DOMFindingType;
  selector: string;
  tagName: string;
  /** Human-readable, redacted element context, e.g. <button data-testid="save">. */
  elementDescription: string;
  pageUrl: string;
  pageTitle: string;
  timestamp: number;
  /** Set for findings of the axe-core audit (type "axe"). */
  axe?: {
    ruleId: string;
    impact: "minor" | "moderate" | "serious" | "critical";
    help: string;
    helpUrl: string;
    summary: string;
    wcag: string[];
  };
}

export const defaultQASettings: QASettings = {
  autoQAEnabled: true,
  networkErrorsEnabled: true,
  slowRequestsEnabled: true,
  largeResponsesEnabled: true,
  duplicateDetectionEnabled: true,
  consoleErrorsEnabled: true,
  accessibilityEnabled: true,
  axeEnabled: true,
  securityChecksEnabled: true,
  contractValidationEnabled: true,
  slowRequestThresholdMs: 2000,
  largeResponseThresholdBytes: 1024 * 1024,
  duplicateWindowMs: 1000,
  duplicateMinimumCount: 3,
};

export interface QARule<T> {
  id: string;
  name: string;
  category: QAIssueCategory;
  check(input: T): QAIssue[];
}
