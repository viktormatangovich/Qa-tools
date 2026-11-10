import type { LocaleStrings } from '../locales';
import type { ApiRequest, SortOption, SortPresetId } from '../types';

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

export function filterRequests(
  requests: ApiRequest[],
  { filter, urlFilter, bodySearch }: { filter: RequestFilter; urlFilter: string; bodySearch: string },
): ApiRequest[] {
  const url = urlFilter.toLowerCase();
  const body = bodySearch.toLowerCase();
  return requests.filter((request) => {
    // GraphQL calls share one URL: the operation name is searched as well.
    if (url && !(request.url || '').toLowerCase().includes(url) && !(request.graphql?.operationName || '').toLowerCase().includes(url)) return false;
    if (body) {
      const requestBody = request.requestBody ? String(request.requestBody).toLowerCase() : '';
      const responseBody = request.responseBody ? JSON.stringify(request.responseBody).toLowerCase() : '';
      if (!requestBody.includes(body) && !responseBody.includes(body)) return false;
    }
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
