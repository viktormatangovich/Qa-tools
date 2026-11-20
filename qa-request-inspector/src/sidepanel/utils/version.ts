/** The public repository the shipped archive comes from. */
export const REPOSITORY = 'viktormatangovich/Qa-tools';
export const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
export const MANIFEST_URL = `https://raw.githubusercontent.com/${REPOSITORY}/main/qa-request-inspector/public/manifest.json`;
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}#readme`;
/** At most one check a day. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** -1, 0 or 1; "v2.10.0" > "2.9.1", missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => value.replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export interface LatestVersion {
  version: string;
  url: string;
}

/** GitHub "latest release" answer → version and page; null when it is not usable. */
export function parseLatestRelease(json: unknown): LatestVersion | null {
  if (!json || typeof json !== 'object') return null;
  const release = json as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
  if (typeof release.tag_name !== 'string' || release.draft || release.prerelease) return null;
  if (!/\d+\.\d+/.test(release.tag_name)) return null;
  return {
    version: release.tag_name.replace(/^v/i, ''),
    url: typeof release.html_url === 'string' && release.html_url.startsWith('https://github.com/') ? release.html_url : REPOSITORY_URL,
  };
}

/** manifest.json of the main branch → version (used while the repository has no releases). */
export function parseManifestVersion(json: unknown): LatestVersion | null {
  const version = (json as { version?: unknown } | null)?.version;
  return typeof version === 'string' && /^\d+\.\d+(\.\d+)?$/.test(version) ? { version, url: REPOSITORY_URL } : null;
}

export function isCheckDue(checkedAt: number | undefined, now: number): boolean {
  return !checkedAt || now - checkedAt >= UPDATE_CHECK_INTERVAL_MS || now < checkedAt;
}
