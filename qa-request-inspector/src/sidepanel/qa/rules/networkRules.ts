import type { ApiRequest } from "../../types";
import type { QAAnalysisInput } from "../core/rulesEngine";
import type { QAIssue, QARule } from "../core/types";

function requestIssue(
  ruleId: string,
  severity: QAIssue["severity"],
  title: string,
  description: string,
  request: ApiRequest,
): QAIssue {
  return {
    id: `${ruleId}:${request.id}`,
    ruleId,
    category: ruleId === "network.slow-request" ? "performance" : "network",
    severity,
    title,
    description,
    timestamp: request.timestamp,
    url: request.url,
    requestId: request.id,
    evidence: {
      method: request.method,
      status: request.status,
      durationMs: request.duration,
    },
  };
}

export const httpClientErrorRule: QARule<QAAnalysisInput> = {
  id: "network.http-client-error",
  name: "Ошибка HTTP клиента",
  category: "network",
  check: ({ requests, settings }) => !settings.networkErrorsEnabled ? [] : requests
    .filter((request) => request.status >= 400 && request.status < 500)
    .map((request) => requestIssue(
      "network.http-client-error",
      "error",
      `Ошибка HTTP ${request.status} на стороне клиента`,
      `${request.method}: ${request.statusText || "ошибка клиента"}.`,
      request,
    )),
};

export const httpServerErrorRule: QARule<QAAnalysisInput> = {
  id: "network.http-server-error",
  name: "Ошибка HTTP сервера",
  category: "network",
  check: ({ requests, settings }) => !settings.networkErrorsEnabled ? [] : requests
    .filter((request) => request.status >= 500 && request.status < 600)
    .map((request) => requestIssue(
      "network.http-server-error",
      "critical",
      `Ошибка HTTP ${request.status} на стороне сервера`,
      `${request.method}: ${request.statusText || "ошибка сервера"}.`,
      request,
    )),
};

export const slowRequestRule: QARule<QAAnalysisInput> = {
  id: "network.slow-request",
  name: "Медленный запрос",
  category: "performance",
  check: ({ requests, settings }) => !settings.slowRequestsEnabled ? [] : requests
    .filter((request) => request.duration > settings.slowRequestThresholdMs)
    .map((request) => requestIssue(
      "network.slow-request",
      "warning",
      "Медленный запрос",
      `${request.method} выполнялся ${request.duration} мс (порог: ${settings.slowRequestThresholdMs} мс).`,
      request,
    )),
};

export const failedRequestRule: QARule<QAAnalysisInput> = {
  id: "network.failed-request",
  name: "Неудавшийся запрос",
  category: "network",
  check: ({ requests, settings }) => !settings.networkErrorsEnabled ? [] : requests
    .filter((request) => Boolean(request.error))
    .map((request) => requestIssue(
      "network.failed-request",
      "error",
      "Неудавшийся запрос",
      request.error || "Запрос не завершился.",
      request,
    )),
};

function normalizedUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

function fingerprint(request: ApiRequest): string {
  return `${request.method}:${normalizedUrl(request.url)}:${request.requestBody || ""}`;
}

function isIgnoredDuplicate(request: ApiRequest): boolean {
  return /(?:analytics|collect|metrics|poll|socket|sse)/i.test(request.url);
}

export const duplicateRequestRule: QARule<QAAnalysisInput> = {
  id: "network.duplicate-request",
  name: "Возможный дублирующийся запрос",
  category: "network",
  check: ({ requests, settings }) => {
    if (!settings.duplicateDetectionEnabled) return [];
    const groups = new Map<string, ApiRequest[]>();
    for (const request of requests) {
      if (isIgnoredDuplicate(request)) continue;
      const key = fingerprint(request);
      const group = groups.get(key) || [];
      group.push(request);
      groups.set(key, group);
    }

    return [...groups.values()].flatMap((group) => {
      const chronological = [...group].sort((a, b) => a.timestamp - b.timestamp);
      if (chronological.length < settings.duplicateMinimumCount) return [];
      const representative = chronological[chronological.length - 1]!;
      const interval = representative.timestamp - chronological[0].timestamp;
      if (interval > settings.duplicateWindowMs) return [];
      return [{
        id: `network.duplicate-request:${fingerprint(representative)}:${chronological[0].timestamp}`,
        ruleId: "network.duplicate-request",
        category: "network",
        severity: "warning",
        title: "Возможный дублирующийся запрос",
        description: `${representative.method} отправлен ${chronological.length} раз за ${interval} мс.`,
        timestamp: representative.timestamp,
        url: representative.url,
        requestId: representative.id,
        evidence: { method: representative.method, count: chronological.length, intervalMs: interval },
      } satisfies QAIssue];
    });
  },
};

function responseSize(responseBody: unknown): number {
  if (responseBody === null || responseBody === undefined) return 0;
  return new TextEncoder().encode(typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody)).length;
}

export const largeResponseRule: QARule<QAAnalysisInput> = {
  id: "network.large-response",
  name: "Большой ответ",
  category: "performance",
  check: ({ requests, settings }) => !settings.largeResponsesEnabled ? [] : requests.flatMap((request) => {
    const size = responseSize(request.responseBody);
    return size > settings.largeResponseThresholdBytes ? [requestIssue("network.large-response", "warning", "Большой ответ", `Размер ответа ${request.method}: ${size} байт (порог: ${settings.largeResponseThresholdBytes} байт).`, request)] : [];
  }),
};
