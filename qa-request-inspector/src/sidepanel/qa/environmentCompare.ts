import type { ApiRequest } from "../types";
export interface CompareOptions { ignoredPaths: string[]; timingMs: number; timingPercent: number; }
export const defaultCompareOptions: CompareOptions = { ignoredPaths: [], timingMs: 100, timingPercent: 20 };
export interface EnvironmentDifference { key: string; left?: ApiRequest; right?: ApiRequest; changes: string[]; }
export function endpointKey(request: ApiRequest): string {
  let path = request.url;
  try { path = new URL(request.url).pathname; } catch { /* Retain invalid imported URL. */ }
  return `${request.method} ${path.replace(/\/(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,})(?=\/|$)/gi, '/{id}')}`;
}
function normalized(value: unknown, ignored: string[], path = '$'): unknown {
  if (ignored.includes(path)) return undefined;
  if (Array.isArray(value)) return value.map((entry, index) => normalized(entry, ignored, `${path}[${index}]`));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => !ignored.includes(`${path}.${key}`) && !ignored.includes(key)).map(([key, entry]) => [key, normalized(entry, ignored, `${path}.${key}`)]));
  return value;
}
function bodyDiff(a: unknown, b: unknown, path = '$'): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => bodyDiff(left[key], right[key], Array.isArray(a) ? `${path}[${key}]` : `${path}.${key}`));
  }
  const display = (value: unknown) => value === undefined ? 'отсутствует' : JSON.stringify(value)?.slice(0, 160);
  return [`${path}: ${display(a)} → ${display(b)}`];
}
export function compareEnvironments(left: ApiRequest[], right: ApiRequest[], options: CompareOptions = defaultCompareOptions): EnvironmentDifference[] {
  const groups = (requests: ApiRequest[]) => {
    const result = new Map<string, ApiRequest[]>();
    [...requests].sort((a, b) => a.timestamp - b.timestamp).forEach(request => { const key = endpointKey(request); result.set(key, [...(result.get(key) || []), request]); });
    return result;
  };
  const a = groups(left), b = groups(right);
  return [...new Set([...a.keys(), ...b.keys()])].flatMap(key => {
    const first = a.get(key) || [], second = b.get(key) || [];
    return Array.from({ length: Math.max(first.length, second.length) }, (_, index) => {
      const l = first[index], r = second[index];
      const changes: string[] = [];
      if (!l) changes.push('Запрос появился во второй сессии.');
      else if (!r) changes.push('Запрос отсутствует во второй сессии.');
      else {
        if (l.status !== r.status) changes.push(`Статус: ${l.status} → ${r.status}`);
        if (r.duration - l.duration > options.timingMs && (l.duration === 0 || (r.duration / l.duration - 1) * 100 > options.timingPercent)) changes.push(`Замедление: ${l.duration} → ${r.duration} мс`);
        const headers = (value: Record<string, string>) => Object.fromEntries(Object.entries(value).map(([name, text]) => [name.toLowerCase(), text]));
        changes.push(...bodyDiff(normalized(headers(l.responseHeaders), options.ignoredPaths), normalized(headers(r.responseHeaders), options.ignoredPaths), '$headers'), ...bodyDiff(normalized(l.responseBody, options.ignoredPaths), normalized(r.responseBody, options.ignoredPaths)));
      }
      return { key: `${key} · вызов ${index + 1}`, left: l, right: r, changes };
    }).filter(entry => entry.changes.length);
  });
}
