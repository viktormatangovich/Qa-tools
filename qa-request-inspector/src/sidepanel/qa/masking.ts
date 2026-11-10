import type { ApiRequest } from "../types";

/**
 * Masks credentials before captured data leaves the extension (exports, reports, copied prompts).
 * Only secrets are masked: tokens, passwords, cookies, API keys. Personal data such as e-mail
 * addresses or names is left as is — the report must stay useful for reproducing a defect.
 */

export const MASK = "***";

const SECRET_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie)$|token|secret|password|passwd|api[-_]?key|session[-_]?id|csrf|xsrf|signature/i;
const SECRET_KEY = /pass(?:word|wd)?$|token|secret|api[-_]?key|^authorization$|^auth$|^cookie$|session[-_]?id|^sid$|csrf|xsrf|signature|private[-_]?key|client[-_]?secret/i;
/** JWTs and "Bearer <token>" / "Basic <token>" credentials inside free text. */
const SECRET_IN_TEXT = /\beyJ[\w-]{8,}\.[\w-]+\.[\w-]*|\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi;

function maskHeaderValue(value: string): string {
  // Keep the scheme: "Bearer ***" still shows which kind of authentication was used.
  const scheme = /^(Bearer|Basic|Digest|Token)\s+/i.exec(value);
  return scheme ? `${scheme[1]} ${MASK}` : MASK;
}

function maskText(text: string): string {
  return text.replace(SECRET_IN_TEXT, (_match, scheme?: string) => (scheme ? `${scheme} ${MASK}` : MASK));
}

export function maskHeaders(headers: Record<string, string> | undefined | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers || {})) {
    result[name] = SECRET_HEADER.test(name) ? maskHeaderValue(String(value)) : maskText(String(value));
  }
  return result;
}

export function maskUrl(urlText: string): string {
  try {
    const url = new URL(urlText);
    let changed = Boolean(url.password);
    if (url.password) url.password = MASK;
    for (const key of [...new Set(url.searchParams.keys())]) {
      if (SECRET_KEY.test(key)) {
        url.searchParams.set(key, MASK);
        changed = true;
      }
    }
    // An unchanged URL is returned verbatim, so serialisation never alters it.
    return changed ? maskText(url.toString()) : maskText(urlText);
  } catch {
    return maskText(urlText);
  }
}

/** Masks values of secret-looking keys anywhere in a JSON value and credentials inside strings. */
export function maskJson(value: unknown): unknown {
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map(maskJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        SECRET_KEY.test(key) && child !== null && typeof child !== "object" ? MASK : maskJson(child),
      ]),
    );
  }
  return value;
}

/** A body kept as text: JSON, a URL-encoded form or anything else. */
export function maskBodyText(text: string): string {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      return JSON.stringify(maskJson(JSON.parse(trimmed)));
    } catch {
      // Not JSON after all
    }
  }
  if (/^[^\s=&]+=[^&]*(?:&[^\s=&]+=[^&]*)*$/.test(trimmed)) {
    return trimmed
      .split("&")
      .map((pair) => {
        const [key] = pair.split("=", 1);
        let name = key;
        try { name = decodeURIComponent(key); } catch { /* keep the raw key */ }
        return SECRET_KEY.test(name) ? `${key}=${MASK}` : maskText(pair);
      })
      .join("&");
  }
  return maskText(text);
}

export function maskRequest(request: ApiRequest): ApiRequest {
  return {
    ...request,
    url: maskUrl(request.url),
    pageUrl: request.pageUrl ? maskUrl(request.pageUrl) : request.pageUrl,
    requestHeaders: maskHeaders(request.requestHeaders),
    responseHeaders: maskHeaders(request.responseHeaders),
    requestBody: typeof request.requestBody === "string" ? maskBodyText(request.requestBody) : request.requestBody,
    responseBody: typeof request.responseBody === "string" ? maskBodyText(request.responseBody) : maskJson(request.responseBody),
  };
}

export function maskRequests(requests: ApiRequest[], enabled: boolean): ApiRequest[] {
  return enabled ? requests.map(maskRequest) : requests;
}
