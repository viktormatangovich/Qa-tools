// application/x-www-form-urlencoded bodies ("name=1&prompt=%D0%BF...") shown for editing as
// decoded "name=value" lines and encoded back before sending.
//
// One line is one field. A value may itself contain line breaks (a multi-line prompt), so in the
// decoded text a line break is written as \n, a carriage return as \r and a backslash as \\.

const FORM_PAIR = /^[^=&\s]*(=[^&\s]*)?$/;

/**
 * True when the body is (or is declared as) form-encoded. Without a Content-Type the body must be
 * a non-JSON "a=b&c=d" string with at least one "=", so plain text is not offered for decoding.
 */
export function isFormEncoded(body: string, contentType?: string): boolean {
  if (/application\/x-www-form-urlencoded/i.test(contentType ?? '')) return true;
  const text = body.trim();
  if (!text.includes('=') || /^[[{"]/.test(text)) return false;
  return text.split('&').every((pair) => pair !== '' && FORM_PAIR.test(pair));
}

/** Content-Type from a headers object, whatever the case of the name. */
export function contentTypeOf(headers: Record<string, string> | undefined): string | undefined {
  const entry = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type');
  return entry?.[1];
}

function decodePart(part: string): string {
  const spaced = part.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    // A stray "%" (not a valid escape): keep the text as it was sent.
    return spaced;
  }
}

const escapeLine = (text: string) => text.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n');

function unescapeLine(text: string): string {
  return text.replace(/\\([\\nr])/g, (_, char: string) => (char === 'n' ? '\n' : char === 'r' ? '\r' : '\\'));
}

/** "name=1&prompt=%D0%BF%D1%80" -> "name=1\nprompt=пр". */
export function decodeFormBody(body: string): string {
  if (!body) return '';
  return body
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const separator = pair.indexOf('=');
      if (separator < 0) return escapeLine(decodePart(pair));
      return `${escapeLine(decodePart(pair.slice(0, separator)))}=${escapeLine(decodePart(pair.slice(separator + 1)))}`;
    })
    .join('\n');
}

/**
 * Decoded lines back to a body. Spaces become "+" when the original body used "+", otherwise
 * "%20"; both mean a space to the server.
 */
export function encodeFormBody(text: string, spaceAsPlus = false): string {
  const encode = (part: string) => {
    const encoded = encodeURIComponent(unescapeLine(part));
    return spaceAsPlus ? encoded.replace(/%20/g, '+') : encoded;
  };
  return text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const separator = line.indexOf('=');
      if (separator < 0) return encode(line);
      return `${encode(line.slice(0, separator))}=${encode(line.slice(separator + 1))}`;
    })
    .join('&');
}

/**
 * A form body as an object for the tree view: decoded names and values, a repeated name ("id=1&id=2")
 * becomes an array, a name without "=" gets an empty value.
 */
export function formBodyToObject(body: string): Record<string, string | string[]> {
  // No prototype: a field named "__proto__" or "constructor" is an ordinary field here.
  const fields: Record<string, string | string[]> = Object.create(null);
  for (const pair of body.split('&')) {
    if (pair === '') continue;
    const separator = pair.indexOf('=');
    const name = decodePart(separator < 0 ? pair : pair.slice(0, separator));
    const value = separator < 0 ? '' : decodePart(pair.slice(separator + 1));
    const existing = fields[name];
    if (existing === undefined) fields[name] = value;
    else fields[name] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return fields;
}

/**
 * A request body ready for the JSON tree: parsed JSON (an object or an array), a decoded form, or
 * null for anything else (plain text, a scalar), which is shown as text.
 */
export function requestBodyTree(body: unknown, contentType?: string): { kind: 'json' | 'form'; data: unknown } | null {
  if (body === null || body === undefined || body === '') return null;
  if (typeof body === 'object') return { kind: 'json', data: body };
  if (typeof body !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') return { kind: 'json', data: parsed };
  } catch {
    // not JSON
  }
  return isFormEncoded(body, contentType) ? { kind: 'form', data: formBodyToObject(body) } : null;
}
