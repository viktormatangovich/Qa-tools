import { useCallback, useEffect, useState } from 'react';
import { loadStored, saveStored } from '../utils/storage';
import {
  compareVersions,
  isCheckDue,
  MANIFEST_URL,
  parseLatestRelease,
  parseManifestVersion,
  RELEASES_API,
  type LatestVersion,
} from '../utils/version';

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

/** Latest published version: the newest GitHub release, else the version on the main branch. */
async function fetchLatest(): Promise<LatestVersion | null> {
  try {
    const release = parseLatestRelease(await fetchJson(RELEASES_API));
    if (release) return release;
  } catch {
    // No releases yet, rate limit or offline: fall back to the manifest of the main branch.
  }
  try {
    return parseManifestVersion(await fetchJson(MANIFEST_URL));
  } catch {
    return null;
  }
}

/**
 * Once a day (when enabled) asks GitHub for the latest version number. Nothing about the user or
 * the captured data is sent: these are plain GET requests without cookies.
 */
export function useUpdateCheck(enabled: boolean) {
  const current = chrome.runtime.getManifest().version;
  const [latest, setLatest] = useState<LatestVersion | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const stored = await loadStored(['updateCheck', 'dismissedUpdateVersion']);
      if (cancelled) return;
      setDismissed(stored.dismissedUpdateVersion ?? null);
      if (stored.updateCheck?.latest) setLatest(stored.updateCheck.latest);
      if (!isCheckDue(stored.updateCheck?.checkedAt, Date.now())) return;
      const found = await fetchLatest();
      if (cancelled) return;
      saveStored({ updateCheck: { checkedAt: Date.now(), latest: found ?? stored.updateCheck?.latest } });
      if (found) setLatest(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const dismiss = useCallback(() => {
    if (!latest) return;
    setDismissed(latest.version);
    saveStored({ dismissedUpdateVersion: latest.version });
  }, [latest]);

  const available = enabled && latest && compareVersions(latest.version, current) > 0 && dismissed !== latest.version ? latest : null;
  return { current, available, dismiss };
}
