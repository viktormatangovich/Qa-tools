import type { ApiRequest } from '../types.ts';
import { endpointKey } from './endpointHistory.ts';

/** An endpoint the user asked to watch: an error or a slow answer raises an alert. */
export interface WatchedEndpoint {
  /** endpointKey(): method and path with ids folded. */
  key: string;
  /** A response slower than this is an alert. */
  slowMs: number;
}

export interface WatchAlert {
  id: string;
  key: string;
  reason: 'error' | 'slow';
  requestId: string;
  status: number;
  duration: number;
  at: number;
}

export const DEFAULT_WATCH_SLOW_MS = 2000;

export function isWatched(watched: WatchedEndpoint[], request: Pick<ApiRequest, 'method' | 'url'>): boolean {
  const key = endpointKey(request);
  return watched.some((endpoint) => endpoint.key === key);
}

/** The alert a new request raises, if it belongs to a watched endpoint and failed or was slow. */
export function watchAlertFor(request: ApiRequest, watched: WatchedEndpoint[]): WatchAlert | null {
  if (request.id.startsWith('stream:') || !watched.length) return null;
  const key = endpointKey(request);
  const endpoint = watched.find((item) => item.key === key);
  if (!endpoint) return null;
  const failed = request.status >= 400 || request.status === 0 || !!request.error;
  const slow = (request.duration || 0) > endpoint.slowMs;
  if (!failed && !slow) return null;
  return {
    id: `${request.id}:${failed ? 'error' : 'slow'}`,
    key,
    reason: failed ? 'error' : 'slow',
    requestId: request.id,
    status: request.status,
    duration: request.duration || 0,
    at: request.timestamp,
  };
}

/** Adds or removes the endpoint of `request`. */
export function toggleWatched(watched: WatchedEndpoint[], request: Pick<ApiRequest, 'method' | 'url'>): WatchedEndpoint[] {
  const key = endpointKey(request);
  return watched.some((endpoint) => endpoint.key === key)
    ? watched.filter((endpoint) => endpoint.key !== key)
    : [...watched, { key, slowMs: DEFAULT_WATCH_SLOW_MS }];
}
