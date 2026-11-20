import type { QAAnalysisInput } from "../core/rulesEngine";
import type { DOMFinding, QAIssue, QAIssueSeverity, QARule } from "../core/types";
import { qt } from "../messages.ts";

const domRuleMetadata = {
  "positive-tabindex": { category: "accessibility" as const, severity: "warning" as const },
  "clickable-without-keyboard": { category: "accessibility" as const, severity: "warning" as const },
  "low-contrast": { category: "accessibility" as const, severity: "warning" as const },
  "broken-image": { category: "dom" as const, severity: "warning" as const },
  "missing-alt": { category: "accessibility" as const, severity: "warning" as const },
  "input-without-label": { category: "accessibility" as const, severity: "warning" as const },
  "button-without-accessible-name": { category: "accessibility" as const, severity: "warning" as const },
};

/** Built-in checks that the axe-core audit covers with its own rules; they are dropped when axe ran. */
export const CHECKS_COVERED_BY_AXE: ReadonlyArray<DOMFinding["type"]> = [
  "missing-alt",
  "input-without-label",
  "button-without-accessible-name",
  "positive-tabindex",
  "low-contrast",
];

const AXE_SEVERITY: Record<NonNullable<DOMFinding["axe"]>["impact"], QAIssueSeverity> = {
  critical: "error",
  serious: "error",
  moderate: "warning",
  minor: "info",
};

function axeIssue(finding: DOMFinding, index: number): QAIssue {
  const axe = finding.axe!;
  const wcag = axe.wcag.length ? ` (${axe.wcag.join(", ")})` : "";
  return {
    id: `dom.axe:${axe.ruleId}:${finding.selector || index}`,
    ruleId: `dom.axe.${axe.ruleId}`,
    category: "accessibility",
    severity: AXE_SEVERITY[axe.impact] ?? "warning",
    title: axe.help,
    description: `${axe.summary || axe.help}${wcag}`,
    timestamp: finding.timestamp,
    url: finding.pageUrl,
    evidence: {
      // An element inside a frame or a shadow root has no selector the page can be asked to highlight.
      ...(finding.selector ? { selector: finding.selector } : {}),
      element: finding.tagName,
      elementDescription: finding.elementDescription,
      pageTitle: finding.pageTitle,
      axeRule: axe.ruleId,
      impact: axe.impact,
      helpUrl: axe.helpUrl,
    },
  };
}

export const domAccessibilityRule: QARule<QAAnalysisInput> = {
  id: "dom.accessibility-basics",
  name: "DOM accessibility basics",
  category: "accessibility",
  check: ({ domFindings, settings }) => !settings.accessibilityEnabled ? [] : domFindings.map((finding, index) => {
    if (finding.type === "axe") return axeIssue(finding, index);
    const metadata = domRuleMetadata[finding.type];
    const text = qt().dom[finding.type];
    return {
      id: `dom.accessibility-basics:${finding.type}:${finding.selector}`,
      ruleId: "dom.accessibility-basics",
      category: metadata.category,
      severity: metadata.severity,
      title: text.title,
      description: text.description,
      timestamp: finding.timestamp,
      url: finding.pageUrl,
      evidence: {
        selector: finding.selector,
        element: finding.tagName,
        elementDescription: finding.elementDescription,
        pageTitle: finding.pageTitle,
      },
    };
  }),
};
