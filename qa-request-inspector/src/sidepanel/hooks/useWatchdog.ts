import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../locales';
import type { ApiRequest } from '../types';
import { loadStored, saveStored } from '../utils/storage';
import { toggleWatched, watchAlertFor, type WatchAlert, type WatchedEndpoint } from '../utils/watchdog';

const MAX_ALERTS = 20;

/**
 * Watched endpoints: a new captured call that fails or is slow raises an alert in the panel and a
 * Chrome notification. Requests that were already in the list (after a tab switch, a restored
 * capture or a loaded snapshot) never alert — only calls that arrive while the panel watches.
 */
export function useWatchdog(requests: ApiRequest[], live: boolean, capturedTabId: number | null) {
  const [watched, setWatched] = useState<WatchedEndpoint[]>([]);
  const [alerts, setAlerts] = useState<WatchAlert[]>([]);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    void loadStored(['watchedEndpoints']).then((stored) => {
      if (Array.isArray(stored.watchedEndpoints)) setWatched(stored.watchedEndpoints);
    });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.watchedEndpoints) setWatched((changes.watchedEndpoints.newValue as WatchedEndpoint[] | undefined) || []);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // A new tab or a snapshot starts from what is already listed.
  useEffect(() => {
    seen.current = null;
  }, [capturedTabId, live]);

  useEffect(() => {
    if (!live) return;
    if (!seen.current) {
      seen.current = new Set(requests.map((request) => request.id));
      return;
    }
    const fresh: WatchAlert[] = [];
    for (const request of requests) {
      if (seen.current.has(request.id)) continue;
      seen.current.add(request.id);
      const alert = watchAlertFor(request, watched);
      if (alert) fresh.push(alert);
    }
    if (!fresh.length) return;
    setAlerts((previous) => [...fresh, ...previous].slice(0, MAX_ALERTS));
    const first = fresh[0];
    try {
      chrome.notifications?.create(`reqpane-watch-${first.id}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: t().watchdogNotificationTitle,
        message: t().watchdogAlert(first.key, first.reason, first.status, first.duration) + (fresh.length > 1 ? ` (+${fresh.length - 1})` : ''),
        priority: 1,
      });
    } catch {
      // Notifications are not available: the alert is still shown in the panel.
    }
  }, [requests, watched, live]);

  const save = useCallback((next: WatchedEndpoint[]) => {
    setWatched(next);
    saveStored({ watchedEndpoints: next });
  }, []);

  const toggle = useCallback((request: Pick<ApiRequest, 'method' | 'url'>) => {
    setWatched((previous) => {
      const next = toggleWatched(previous, request);
      saveStored({ watchedEndpoints: next });
      return next;
    });
  }, []);

  const dismissAlerts = useCallback(() => setAlerts([]), []);

  return { watched, alerts, toggle, save, dismissAlerts };
}
