import type { ApiRequest, RequestTimings, ResourceType } from '../types';
import { withGraphql } from './graphql.ts';

const MAX_ENTRIES = 2000;
const MAX_BODY_CHARS = 5 * 1024 * 1024;

interface HarHeader { name?: unknown; value?: unknown }
interface HarEntry {
  startedDateTime?: string;
  time?: number;
  _resourceType?: string;
  serverIPAddress?: string;
  request?: { method?: string; url?: string; headers?: HarHeader[]; postData?: { text?: string } };
  response?: {
    status?: number;
    statusText?: string;
    headers?: HarHeader[];
    content?: { mimeType?: string; text?: string; encoding?: string; size?: number };
    _transferSize?: number;
    _error?: string | null;
    httpVersion?: string;
  };
  timings?: Record<string, number | undefined>;
  comment?: unknown;
}

const RESOURCE_TYPES: Record<string, ResourceType> = {
  xhr: 'xhr', fetch: 'fetch', document: 'document', script: 'script', stylesheet: 'stylesheet',
  image: 'image', font: 'font', media: 'media',
};

function headers(list: HarHeader[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of list || []) {
    if (typeof header?.name !== 'string' || header.name.startsWith(':')) continue;
    const value = String(header.value ?? '');
    result[header.name] = header.name in result ? `${result[header.name]}, ${value}` : value;
  }
  return result;
}

function decodeBase64(text: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null; // binary content
  }
}

function responseBody(content: NonNullable<HarEntry['response']>['content']): unknown {
  if (!content || typeof content.text !== 'string' || content.text === '') return null;
  const text = content.encoding === 'base64' ? decodeBase64(content.text) : content.text;
  if (text === null) return null;
  const trimmed = text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}... [truncated]` : text;
  if ((content.mimeType || '').includes('json')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function timings(source: HarEntry['timings']): RequestTimings | undefined {
  if (!source) return undefined;
  const value = (key: string) => Math.max(0, Number(source[key]) || 0);
  const ssl = value('ssl');
  const result = {
    blocked: value('blocked'),
    dns: value('dns'),
    // In HAR the TLS time is included in "connect".
    connect: Math.max(0, value('connect') - ssl),
    ssl,
    send: value('send'),
    wait: value('wait'),
    receive: value('receive'),
  };
  return Object.values(result).some((part) => part > 0) ? result : undefined;
}

/**
 * Converts a HAR file (DevTools, Charles, Reqpane itself) into the request list of the panel,
 * newest first. Throws a readable error when the text is not a HAR log.
 */
export function parseHar(text: string): ApiRequest[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('not-json');
  }
  const entries = (parsed as { log?: { entries?: unknown } })?.log?.entries;
  if (!Array.isArray(entries)) throw new Error('not-har');

  const requests: ApiRequest[] = [];
  for (const entry of entries.slice(0, MAX_ENTRIES) as HarEntry[]) {
    const url = entry?.request?.url;
    // The panel parses request URLs in many places: entries without a usable URL are skipped.
    if (typeof url !== 'string' || !URL.canParse(url)) continue;
    const status = Number(entry.response?.status) || 0;
    const started = Date.parse(entry.startedDateTime || '');
    const error = entry.response?._error || (status === 0 ? 'Request failed' : null);
    const transferSize = Number(entry.response?._transferSize);
    const requestTimings = timings(entry.timings);

    requests.push(withGraphql({
      id: crypto.randomUUID(),
      type: RESOURCE_TYPES[(entry._resourceType || '').toLowerCase()] ?? (entry._resourceType ? 'other' : 'fetch'),
      method: (entry.request?.method || 'GET').toUpperCase(),
      url,
      requestHeaders: headers(entry.request?.headers),
      requestBody: typeof entry.request?.postData?.text === 'string' ? entry.request.postData.text : null,
      responseHeaders: headers(entry.response?.headers),
      responseBody: responseBody(entry.response?.content),
      status,
      statusText: entry.response?.statusText || '',
      duration: Math.max(0, Math.round(Number(entry.time) || 0)),
      timestamp: Number.isNaN(started) ? Date.now() : started,
      error: error || null,
      pageUrl: '',
      pageTitle: '',
      ...(requestTimings ? { timings: requestTimings } : {}),
      ...(Number.isFinite(transferSize) && transferSize > 0 ? { transferSize } : {}),
      ...(entry.response?.httpVersion ? { protocol: entry.response.httpVersion } : {}),
      ...(entry.serverIPAddress ? { remoteAddress: entry.serverIPAddress } : {}),
      // generateHar writes the QA note into the standard HAR comment field.
      ...(typeof entry.comment === 'string' && entry.comment.trim() ? { note: entry.comment } : {}),
    }));
  }
  return requests.sort((a, b) => b.timestamp - a.timestamp);
}
