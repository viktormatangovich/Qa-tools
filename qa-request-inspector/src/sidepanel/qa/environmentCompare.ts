import type { ApiRequest } from "../types";

export interface EnvironmentDifference { key: string; left?: ApiRequest; right?: ApiRequest; changes: string[]; }

export function compareEnvironments(left: ApiRequest[], right: ApiRequest[]): EnvironmentDifference[] {
  const keyFor = (request: ApiRequest) => `${request.method} ${new URL(request.url).pathname}`;
  const rightByKey = new Map(right.map((request) => [keyFor(request), request]));
  return left.flatMap((leftRequest) => {
    const key = keyFor(leftRequest); const rightRequest = rightByKey.get(key); if (!rightRequest) return [{ key, left: leftRequest, changes: ["Endpoint not recorded in the second session."] }];
    const headerKeys = new Set([...Object.keys(leftRequest.responseHeaders).map((key) => key.toLowerCase()), ...Object.keys(rightRequest.responseHeaders).map((key) => key.toLowerCase())]);
    const headerChange = [...headerKeys].some((key) => Object.entries(leftRequest.responseHeaders).find(([name]) => name.toLowerCase() === key)?.[1] !== Object.entries(rightRequest.responseHeaders).find(([name]) => name.toLowerCase() === key)?.[1]);
    const shape = (body: unknown): string => body && typeof body === "object" ? JSON.stringify(Object.keys(body as Record<string, unknown>).sort()) : typeof body;
    const changes = [leftRequest.status !== rightRequest.status ? `Status: ${leftRequest.status} → ${rightRequest.status}` : "", Math.abs(leftRequest.duration - rightRequest.duration) > 100 ? `Timing: ${leftRequest.duration} ms → ${rightRequest.duration} ms` : "", headerChange ? "Response headers differ" : "", shape(leftRequest.responseBody) !== shape(rightRequest.responseBody) ? "Response schema shape differs" : "", JSON.stringify(leftRequest.responseBody) !== JSON.stringify(rightRequest.responseBody) ? "Response values differ" : ""].filter(Boolean);
    return changes.length ? [{ key, left: leftRequest, right: rightRequest, changes }] : [];
  });
}
