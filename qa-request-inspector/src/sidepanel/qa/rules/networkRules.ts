import type { ApiRequest } from "../../types";
import type { QAAnalysisInput } from "../core/rulesEngine";
import type { QAIssue, QARule } from "../core/types";
import { qt } from "../messages.ts";

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
  get name() { return qt().ruleClientError; },
  category: "network",
  check: ({ requests, settings }) => !settings.networkErrorsEnabled ? [] : requests
    .filter((request) => request.status >= 400 && request.status < 500)
    .map((request) => requestIssue(
      "network.http-client-error",
      "error",
      qt().clientErrorTitle(request.status),
      `${request.method}: ${request.statusText || qt().clientErrorFallback}.`,
      request,
    )),
};

export const httpServerErrorRule: QARule<QAAnalysisInput> = {
  id: "network.http-server-error",
  get name() { return qt().ruleServerError; },
  category: "network",
  check: ({ requests, settings }) => !settings.networkErrorsEnabled ? [] : requests
    .filter((request) => request.status >= 500 && request.status < 600)
    .map((request) => requestIssue(
      "network.http-server-error",
      "critical",
      qt().serverErrorTitle(request.status),
      `${request.method}: ${request.statusText || qt().serverErrorFallback}.`,
      request,
    )),
};

export const slowRequestRule: QARule<QAAnalysisInput> = {
  id: "network.slow-request",
  get name() { return qt().slowRequest; },
  category: "performance",
  check: ({ requests, settings }) => !settings.slowRequestsEnabled ? [] : requests
    .filter((request) => request.duration > settings.slowRequestThresholdMs)
    .map((request) => requestIssue(
      "network.slow-request",
      "warning",
      qt().slowRequest,
      qt().slowRequestDescription(request.method, request.duration, settings.slowRequestThresholdMs),
      request,
    )),
};

export const failedRequestRule: QARule<QAAnalysisInput> = {
  id: "network.failed-request",
  get name() { return qt().failedRequest; },
  category: "network",
  check: ({ requests, settings }) => !settings.networkErrorsEnabled ? [] : requests
    .filter((request) => Boolean(request.error))
    .map((request) => requestIssue(
      "network.failed-request",
      "error",
      qt().failedRequest,
      request.error || qt().requestNotCompleted,
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
  get name() { return qt().duplicateRequest; },
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
        title: qt().duplicateRequest,
        description: qt().duplicateDescription(representative.method, chronological.length, interval),
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
  get name() { return qt().largeResponse; },
  category: "performance",
  check: ({ requests, settings }) => !settings.largeResponsesEnabled ? [] : requests.flatMap((request) => {
    const size = responseSize(request.responseBody);
    return size > settings.largeResponseThresholdBytes ? [requestIssue("network.large-response", "warning", qt().largeResponse, qt().largeResponseDescription(request.method, size, settings.largeResponseThresholdBytes), request)] : [];
  }),
};
