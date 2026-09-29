import type { QAAnalysisInput } from "../core/rulesEngine";
import type { QARule } from "../core/types";

const sensitiveKey = /(?:access[_-]?token|refresh[_-]?token|password|api[_-]?key|authorization|email|jwt|secret)/i;
const sensitiveValue = /(?:eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9._-]+|(?:bearer\s+)[a-zA-Z0-9._-]{8,})/i;

export function maskSensitiveValue(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function findSensitive(text: string, source: string): string | undefined {
  try {
    const walk = (value: unknown): string | undefined => {
      if (!value || typeof value !== "object") return undefined;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (sensitiveKey.test(key) && typeof child === "string") return `${source}: ${key}=${maskSensitiveValue(child)}`;
        const nested = walk(child); if (nested) return nested;
      }
      return undefined;
    };
    const jsonFinding = walk(JSON.parse(text));
    if (jsonFinding) return jsonFinding;
  } catch { /* A non-JSON body is handled by token-pattern checks above. */ }
  const query = new URLSearchParams(text.startsWith("?") ? text.slice(1) : text);
  for (const [key, value] of query) if (sensitiveKey.test(key)) return `${source}: ${key}=${maskSensitiveValue(value)}`;
  if (sensitiveValue.test(text)) return `${source}: ${maskSensitiveValue(text.match(sensitiveValue)?.[0] || "secret")}`;
  return undefined;
}

export const sensitiveDataRule: QARule<QAAnalysisInput> = {
  id: "security.sensitive-data",
  name: "Возможная утечка чувствительных данных",
  category: "security",
  check: ({ requests, settings }) => !settings.securityChecksEnabled ? [] : requests.flatMap((request) => {
    const findings: string[] = [];
    const url = new URL(request.url);
    const urlFinding = findSensitive(url.search, "Параметры URL");
    if (urlFinding) findings.push(urlFinding);
    for (const [name, value] of Object.entries(request.requestHeaders)) if (sensitiveKey.test(name) && /(?:query|url|referer)/i.test(name)) findings.push(`Заголовок ${name}: ${maskSensitiveValue(value)}`);
    const bodyFinding = request.requestBody ? findSensitive(request.requestBody, "Тело запроса") : undefined;
    if (bodyFinding) findings.push(bodyFinding);
    const responseText = request.responseBody === null || request.responseBody === undefined ? undefined : typeof request.responseBody === "string" ? request.responseBody : JSON.stringify(request.responseBody);
    const responseFinding = responseText ? findSensitive(responseText, "Тело ответа") : undefined;
    if (responseFinding) findings.push(responseFinding);
    return findings.map((description, index) => ({ id: `security.sensitive-data:${request.id}:${index}`, ruleId: "security.sensitive-data", category: "security", severity: "warning", title: "Возможная утечка чувствительных данных", description, timestamp: request.timestamp, url: request.url, requestId: request.id, evidence: { source: description.split(":")[0] } }));
  }),
};
