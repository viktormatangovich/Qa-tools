import type { ApiRequest } from '../types.ts';

/** A JSON Web Token found in a captured request or its response, decoded locally. */
export interface FoundJwt {
  /** Where it was found: header name, cookie name, URL parameter or response field. */
  source: { kind: 'header' | 'cookie' | 'query' | 'requestBody' | 'response'; name: string };
  token: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface JwtTimes {
  /** Milliseconds since the epoch. */
  exp?: number;
  iat?: number;
  nbf?: number;
}

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const MAX_TOKENS = 6;
const MAX_DEPTH = 6;

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Header and payload of a JWT; null when the string is not one. The signature is not checked. */
export function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = decodeSegment(parts[0]);
  const payload = decodeSegment(parts[1]);
  if (!header || !payload) return null;
  return { header, payload };
}

const seconds = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value * 1000 : undefined);

/** exp / iat / nbf of a payload in milliseconds. */
export function jwtTimes(payload: Record<string, unknown>): JwtTimes {
  return { exp: seconds(payload.exp), iat: seconds(payload.iat), nbf: seconds(payload.nbf) };
}

/** Validity of a token at a moment: before nbf, valid, or after exp. */
export function jwtState(payload: Record<string, unknown>, at: number): 'valid' | 'expired' | 'notYetValid' {
  const { exp, nbf } = jwtTimes(payload);
  if (exp !== undefined && at >= exp) return 'expired';
  if (nbf !== undefined && at < nbf) return 'notYetValid';
  return 'valid';
}

function tokensIn(text: string): string[] {
  return text.match(JWT_PATTERN) || [];
}

/** Every JWT in the request headers, cookies, URL, request body and response body (at most six). */
export function findJwts(request: Pick<ApiRequest, 'url' | 'requestHeaders' | 'requestBody' | 'responseBody'>): FoundJwt[] {
  const found: FoundJwt[] = [];
  const seen = new Set<string>();
  const add = (token: string, source: FoundJwt['source']) => {
    if (found.length >= MAX_TOKENS || seen.has(token)) return;
    const decoded = decodeJwt(token);
    if (!decoded) return;
    seen.add(token);
    found.push({ source, token, ...decoded });
  };

  for (const [name, value] of Object.entries(request.requestHeaders || {})) {
    if (name.toLowerCase() === 'cookie') {
      for (const pair of String(value).split(/;\s*/)) {
        const separator = pair.indexOf('=');
        if (separator < 0) continue;
        for (const token of tokensIn(pair.slice(separator + 1))) add(token, { kind: 'cookie', name: pair.slice(0, separator) });
      }
      continue;
    }
    for (const token of tokensIn(String(value))) add(token, { kind: 'header', name });
  }

  try {
    for (const [name, value] of new URL(request.url).searchParams) {
      for (const token of tokensIn(value)) add(token, { kind: 'query', name });
    }
  } catch {
    // Not an absolute URL
  }

  const walk = (value: unknown, path: string, kind: 'requestBody' | 'response', depth: number) => {
    if (found.length >= MAX_TOKENS || depth > MAX_DEPTH) return;
    if (typeof value === 'string') {
      for (const token of tokensIn(value)) add(token, { kind, name: path || '(body)' });
    } else if (Array.isArray(value)) {
      value.slice(0, 50).forEach((item, index) => walk(item, `${path}[${index}]`, kind, depth + 1));
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key, kind, depth + 1);
    }
  };

  const parseMaybe = (body: unknown) => {
    if (typeof body !== 'string') return body;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  };
  walk(parseMaybe(request.requestBody), '', 'requestBody', 0);
  walk(parseMaybe(request.responseBody), '', 'response', 0);
  return found;
}

/** Claims worth a line of their own; the rest is shown in the payload tree. */
export const NOTABLE_CLAIMS = ['sub', 'iss', 'aud', 'scope', 'scp', 'role', 'roles', 'email', 'name', 'preferred_username', 'client_id', 'azp', 'sid', 'jti'];
