import type { QAAnalysisInput } from "../core/rulesEngine";
import type { QARule } from "../core/types";

const domRuleMetadata = {
  "broken-image": { category: "dom" as const, severity: "warning" as const, title: "Не загрузилось изображение", description: "Загрузка изображения завершилась без доступных данных." },
  "missing-alt": { category: "accessibility" as const, severity: "warning" as const, title: "У изображения нет alt", description: "У изображения нет атрибута alt, и оно не помечено как декоративное." },
  "input-without-label": { category: "accessibility" as const, severity: "warning" as const, title: "У поля нет доступного имени", description: "У элемента формы нет связанной метки или ARIA-имени." },
  "button-without-accessible-name": { category: "accessibility" as const, severity: "warning" as const, title: "У кнопки нет доступного имени", description: "У кнопки нет текста, метки или другого доступного имени." },
};

export const domAccessibilityRule: QARule<QAAnalysisInput> = {
  id: "dom.accessibility-basics",
  name: "DOM accessibility basics",
  category: "accessibility",
  check: ({ domFindings, settings }) => !settings.accessibilityEnabled ? [] : domFindings.map((finding) => {
    const metadata = domRuleMetadata[finding.type];
    return {
      id: `dom.accessibility-basics:${finding.type}:${finding.selector}`,
      ruleId: "dom.accessibility-basics",
      category: metadata.category,
      severity: metadata.severity,
      title: metadata.title,
      description: metadata.description,
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
