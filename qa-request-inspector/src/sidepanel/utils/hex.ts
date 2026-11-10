/**
 * Classic hex dump of base64-encoded bytes: offset, 16 bytes in hex, the same bytes as ASCII.
 * Used for binary WebSocket frames.
 */
export function hexDump(base64: string, maxBytes = 512): string {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return '';
  }
  const length = Math.min(binary.length, maxBytes);
  const lines: string[] = [];
  for (let offset = 0; offset < length; offset += 16) {
    const chunk = binary.slice(offset, Math.min(offset + 16, length));
    const hex = Array.from(chunk, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk, (char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code < 0x7f ? char : '.';
    }).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`);
  }
  return lines.join('\n');
}
