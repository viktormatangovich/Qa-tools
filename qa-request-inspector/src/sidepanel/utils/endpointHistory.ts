import type { ApiRequest } from '../types.ts';

/** Method and path with numeric ids and UUIDs folded, the same rule as the environment compare. */
export function endpointKey(request: Pick<ApiRequest, 'method' | 'url'>): string {
  let path = request.url;
  try {
    path = new URL(request.url).pathname;
  } catch {
    path = request.url.split('?')[0];
  }
  return `${request.method} ${path.replace(/\/(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,})(?=\/|$)/gi, '/{id}')}`;
}

export interface FieldChange {
  path: string;
  kind: 'added' | 'removed' | 'changed' | 'type' | 'length';
  before?: unknown;
  after?: unknown;
}

const MAX_CHANGES = 40;
const MAX_DEPTH = 8;

const typeOf = (value: unknown) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

/**
 * What changed between two JSON bodies: new, missing and changed fields, type changes and array
 * lengths. Arrays are compared by length and by the shape of their first element only — item values
 * shift between calls and would drown the real changes.
 */
export function jsonChanges(before: unknown, after: unknown, path = '', out: FieldChange[] = [], depth = 0, shapeOnly = false): FieldChange[] {
  if (out.length >= MAX_CHANGES || depth > MAX_DEPTH) return out;
  const beforeType = typeOf(before);
  const afterType = typeOf(after);
  const at = path || '(body)';
  if (beforeType !== afterType) {
    out.push({ path: at, kind: 'type', before: beforeType, after: afterType });
    return out;
  }
  if (afterType === 'array') {
    const a = before as unknown[];
    const b = after as unknown[];
    if (a.length !== b.length) out.push({ path: `${at}.length`, kind: 'length', before: a.length, after: b.length });
    if (a.length && b.length) jsonChanges(a[0], b[0], `${path}[0]`, out, depth + 1, true);
    return out;
  }
  if (afterType === 'object') {
    const a = before as Record<string, unknown>;
    const b = after as Record<string, unknown>;
    for (const key of Object.keys(a)) {
      if (out.length >= MAX_CHANGES) break;
      const child = path ? `${path}.${key}` : key;
      if (!(key in b)) out.push({ path: child, kind: 'removed', before: a[key] });
      else jsonChanges(a[key], b[key], child, out, depth + 1, shapeOnly);
    }
    for (const key of Object.keys(b)) {
      if (out.length >= MAX_CHANGES) break;
      if (!(key in a)) out.push({ path: path ? `${path}.${key}` : key, kind: 'added', after: b[key] });
    }
    return out;
  }
  if (!shapeOnly && before !== after) out.push({ path: at, kind: 'changed', before, after });
  return out;
}

function bodyValue(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export interface HistoryEntry {
  request: ApiRequest;
  /** Changes of the response body against the previous call that had a body. */
  changes: FieldChange[];
  /** Status differs from the previous call. */
  statusChanged: boolean;
}

export interface EndpointHistory {
  key: string;
  /** Oldest first. */
  entries: HistoryEntry[];
  stats: { count: number; errors: number; minMs: number; maxMs: number; avgMs: number; statuses: number[] };
}

/** Every captured call of the same endpoint as `target`, with what changed from call to call. */
export function endpointHistory(requests: ApiRequest[], target: Pick<ApiRequest, 'method' | 'url'>): EndpointHistory {
  const key = endpointKey(target);
  const calls = requests
    .filter((request) => !request.id.startsWith('stream:') && endpointKey(request) === key)
    .sort((a, b) => a.timestamp - b.timestamp);

  let previousBody: unknown = undefined;
  let previousStatus: number | undefined;
  const entries = calls.map((request) => {
    const body = bodyValue(request.responseBody);
    const hasBody = body !== null && body !== undefined && body !== '';
    const changes = hasBody && previousBody !== undefined ? jsonChanges(previousBody, body) : [];
    const statusChanged = previousStatus !== undefined && previousStatus !== request.status;
    if (hasBody) previousBody = body;
    previousStatus = request.status;
    return { request, changes, statusChanged };
  });

  const durations = calls.map((request) => request.duration || 0);
  return {
    key,
    entries,
    stats: {
      count: calls.length,
      errors: calls.filter((request) => request.status >= 400 || request.status === 0 || !!request.error).length,
      minMs: durations.length ? Math.min(...durations) : 0,
      maxMs: durations.length ? Math.max(...durations) : 0,
      avgMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      statuses: [...new Set(calls.map((request) => request.status))].sort((a, b) => a - b),
    },
  };
}
