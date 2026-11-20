import type { ApiRequest } from '../types.ts';

/**
 * Headers a client sets by itself (or that HTTP/2 shows as pseudo-headers): copying them makes the
 * snippet fail or lie, so they are left out.
 */
const SKIPPED_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding']);

function headersOf(request: Pick<ApiRequest, 'requestHeaders'>): Array<[string, string]> {
  return Object.entries(request.requestHeaders || {})
    .filter(([name]) => !name.startsWith(':') && !SKIPPED_HEADERS.has(name.toLowerCase()))
    .map(([name, value]) => [name, String(value)]);
}

function bodyOf(request: Pick<ApiRequest, 'requestBody'>): string | null {
  if (request.requestBody == null || request.requestBody === '') return null;
  return typeof request.requestBody === 'string' ? request.requestBody : JSON.stringify(request.requestBody);
}

/** PowerShell single-quoted string: a quote is doubled. */
const psString = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The request as a Windows PowerShell 5.1 / PowerShell 7 command. Invoke-WebRequest keeps the
 * status and the raw body; Content-Type and User-Agent go through their own parameters because
 * Windows PowerShell refuses them in -Headers.
 */
export function generatePowerShell(request: Pick<ApiRequest, 'method' | 'url' | 'requestHeaders' | 'requestBody'>): string {
  const headers = headersOf(request);
  const contentType = headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1];
  const userAgent = headers.find(([name]) => name.toLowerCase() === 'user-agent')?.[1];
  const rest = headers.filter(([name]) => !['content-type', 'user-agent'].includes(name.toLowerCase()));
  const body = bodyOf(request);

  const lines: string[] = [];
  if (rest.length) {
    lines.push('$headers = @{');
    for (const [name, value] of rest) lines.push(`  ${psString(name)} = ${psString(value)}`);
    lines.push('}');
  }
  if (body !== null) {
    // A here-string keeps quotes and line breaks as they are; it only ends at a line starting with '@.
    if (/^'@/m.test(body)) lines.push(`$body = ${psString(body)}`);
    else lines.push("$body = @'", body, "'@");
  }

  const args = [`-Uri ${psString(request.url)}`, `-Method ${request.method}`];
  if (rest.length) args.push('-Headers $headers');
  if (contentType) args.push(`-ContentType ${psString(contentType)}`);
  if (userAgent) args.push(`-UserAgent ${psString(userAgent)}`);
  if (body !== null) args.push('-Body ([System.Text.Encoding]::UTF8.GetBytes($body))');
  args.push('-UseBasicParsing');

  lines.push(`$response = Invoke-WebRequest ${args.join(' `\n  ')}`);
  lines.push('$response.StatusCode');
  lines.push('$response.Content');
  return lines.join('\n');
}

/** JSON string literals are valid Python string literals. */
const pyString = (value: string) => JSON.stringify(value);

/** The request as a Python script with the requests library. The body is sent byte for byte. */
export function generatePython(request: Pick<ApiRequest, 'method' | 'url' | 'requestHeaders' | 'requestBody'>): string {
  const headers = headersOf(request);
  const body = bodyOf(request);
  const lines = ['import requests', '', 'response = requests.request(', `    ${pyString(request.method)},`, `    ${pyString(request.url)},`];
  if (headers.length) {
    lines.push('    headers={');
    for (const [name, value] of headers) lines.push(`        ${pyString(name)}: ${pyString(value)},`);
    lines.push('    },');
  }
  if (body !== null) lines.push(`    data=${pyString(body)}.encode("utf-8"),`);
  lines.push('    timeout=30,', ')', 'print(response.status_code)', 'print(response.text)');
  return lines.join('\n');
}
