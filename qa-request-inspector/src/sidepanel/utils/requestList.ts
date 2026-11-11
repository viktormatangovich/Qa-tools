import type { LocaleStrings } from '../locales';
import type { ApiRequest, SortOption, SortPresetId } from '../types';
import { contentTypeOf, requestBodyTree } from './formBody.ts';
import { searchJson } from './jsonSearch.ts';

export type RequestFilter = 'all' | 'errors' | 'slow' | 'console' | 'qa';

type Comparator = (a: ApiRequest, b: ApiRequest) => number;

const byMethod: Comparator = (a, b) => a.method.localeCompare(b.method);
const byStatus: Comparator = (a, b) => (b.status || 0) - (a.status || 0);
const byType: Comparator = (a, b) => a.type.localeCompare(b.type);

/** Multi-criteria sorts offered in the toolbar. */
export const SORT_PRESETS: Array<{ id: SortPresetId; labelKey: keyof LocaleStrings; comparators: Comparator[] }> = [
  { id: 'method-status', labelKey: 'sortPresetMethodStatus', comparators: [byMethod, byStatus] },
  { id: 'method-type', labelKey: 'sortPresetMethodType', comparators: [byMethod, byType] },
  { id: 'status-method', labelKey: 'sortPresetStatusMethod', comparators: [byStatus, byMethod] },
  { id: 'type-method', labelKey: 'sortPresetTypeMethod', comparators: [byType, byMethod] },
  { id: 'type-status', labelKey: 'sortPresetTypeStatus', comparators: [byType, byStatus] },
];

function hostname(request: ApiRequest): string {
  try {
    return new URL(request.url).hostname;
  } catch {
    return 'unknown';
  }
}

export const isFailed = (request: ApiRequest): boolean => request.status >= 400 || Boolean(request.error);
export const isSlow = (request: ApiRequest): boolean => request.duration > 1000;

type BodyField = 'requestBody' | 'responseBody';

interface SearchableBody {
  /** Raw text, lower-cased: finds fragments such as `"status":"ok"`. */
  text: string;
  /** Parsed JSON or a decoded form; null for plain text. */
  tree: unknown;
}

// Bodies are parsed once per request object, not on every keystroke in the search field.
const searchableCache = new WeakMap<ApiRequest, Partial<Record<BodyField, SearchableBody>>>();

function searchableBody(request: ApiRequest, field: BodyField): SearchableBody {
  const cached = searchableCache.get(request) ?? {};
  if (!cached[field]) {
    const value: unknown = request[field];
    const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    const contentType = contentTypeOf(field === 'requestBody' ? request.requestHeaders : request.responseHeaders);
    cached[field] = { text: text.toLowerCase(), tree: requestBodyTree(value, contentType)?.data ?? null };
    searchableCache.set(request, cached);
  }
  return cached[field];
}

/**
 * The same rule as the search in the JSON tree: a field name or a value contains the query. The
 * structure is searched after parsing, so form values are decoded and "п"-escaped text is
 * found as Cyrillic; the raw text is searched too, for fragments spanning a name and a value.
 */
function bodyMatches(request: ApiRequest, field: BodyField, query: string): boolean {
  const body = searchableBody(request, field);
  if (body.text.includes(query)) return true;
  return body.tree !== null && searchJson(body.tree, query).paths.length > 0;
}

export function filterRequests(
  requests: ApiRequest[],
  { filter, urlFilter, bodySearch }: { filter: RequestFilter; urlFilter: string; bodySearch: string },
): ApiRequest[] {
  const url = urlFilter.toLowerCase();
  const body = bodySearch.toLowerCase();
  return requests.filter((request) => {
    // GraphQL calls share one URL: the operation name is searched as well.
    if (url && !(request.url || '').toLowerCase().includes(url) && !(request.graphql?.operationName || '').toLowerCase().includes(url)) return false;
    if (body && !bodyMatches(request, 'requestBody', body) && !bodyMatches(request, 'responseBody', body)) return false;
    if (filter === 'errors') return isFailed(request);
    if (filter === 'slow') return isSlow(request);
    return true;
  });
}

export function groupByDomain(requests: ApiRequest[]): Record<string, ApiRequest[]> {
  const groups: Record<string, ApiRequest[]> = {};
  for (const request of requests) (groups[hostname(request)] ||= []).push(request);
  return groups;
}

export function sortRequests(requests: ApiRequest[], sortBy: SortOption, presetId: SortPresetId | ''): ApiRequest[] {
  const sorted = [...requests];
  const preset = presetId ? SORT_PRESETS.find((candidate) => candidate.id === presetId) : undefined;
  if (preset) {
    return sorted.sort((a, b) => {
      for (const compare of preset.comparators) {
        const result = compare(a, b);
        if (result !== 0) return result;
      }
      return 0;
    });
  }
  switch (sortBy) {
    case 'newest': return sorted.sort((a, b) => b.timestamp - a.timestamp);
    case 'oldest': return sorted.sort((a, b) => a.timestamp - b.timestamp);
    case 'method': return sorted.sort(byMethod);
    case 'status': return sorted.sort(byStatus);
    case 'duration': return sorted.sort((a, b) => b.duration - a.duration);
    case 'type': return sorted.sort(byType);
    case 'domain': return sorted.sort((a, b) => hostname(a).localeCompare(hostname(b)));
    default: return sorted;
  }
}
