/** Saves text as a file through a temporary object URL. */
export function downloadFile(filename: string, content: string, contentType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Date part for export file names, e.g. 2026-11-10. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
