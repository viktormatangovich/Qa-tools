// Captured data survives a service worker restart (chrome.storage.session).
// Stateless module: background.js passes its maps in.

import { trimForPersistence } from "./captureStore.js";

export const CAPTURE_KEY_PREFIX = "capture_";
// chrome.storage.session holds about 10 MB for the whole extension, so each tab gets a share.
const PERSIST_BUDGET_PER_TAB = 2 * 1024 * 1024;
const PERSIST_DELAY_MS = 500;

/** @param {{ apiRequests: Map, consoleErrors: Map }} ctx */
export function createPersistence({ apiRequests, consoleErrors }) {
  const sessionStore = chrome.storage.session;
  const persistTimers = new Map(); // tabId -> timeout
  const requestSizes = new WeakMap(); // request -> JSON size

  function requestSize(request) {
    let size = requestSizes.get(request);
    if (size === undefined) {
      size = JSON.stringify(request).length;
      requestSizes.set(request, size);
    }
    return size;
  }

  function schedulePersist(tabId) {
    if (!sessionStore || persistTimers.has(tabId)) return;
    persistTimers.set(
      tabId,
      setTimeout(() => {
        persistTimers.delete(tabId);
        void persistTab(tabId);
      }, PERSIST_DELAY_MS),
    );
  }

  async function persistTab(tabId) {
    const key = CAPTURE_KEY_PREFIX + tabId;
    const requests = apiRequests.get(tabId) || [];
    const errors = consoleErrors.get(tabId) || [];
    try {
      if (requests.length === 0 && errors.length === 0) {
        await sessionStore.remove(key);
        return;
      }
      await sessionStore.set({
        [key]: { requests: trimForPersistence(requests, PERSIST_BUDGET_PER_TAB, requestSize), errors },
      });
    } catch (err) {
      // Quota exceeded: keep the request list without bodies, or nothing at all.
      try {
        await sessionStore.set({ [key]: { requests: trimForPersistence(requests, 0, requestSize), errors } });
      } catch (err2) {
        await sessionStore.remove(key).catch(() => {});
      }
    }
  }

  async function restoreCapturedData() {
    if (!sessionStore) return;
    try {
      const [stored, tabs] = await Promise.all([sessionStore.get(null), chrome.tabs.query({})]);
      const openTabs = new Set(tabs.map((tab) => tab.id));
      const stale = [];
      for (const [key, value] of Object.entries(stored)) {
        if (!key.startsWith(CAPTURE_KEY_PREFIX)) continue;
        const tabId = Number(key.slice(CAPTURE_KEY_PREFIX.length));
        if (!openTabs.has(tabId)) {
          stale.push(key);
          continue;
        }
        apiRequests.set(tabId, value?.requests || []);
        consoleErrors.set(tabId, value?.errors || []);
      }
      if (stale.length) await sessionStore.remove(stale);
    } catch (err) {
      // Nothing to restore
    }
  }

  /** The tab is gone: drop its pending write and its stored copy. */
  function forgetPersisted(tabId) {
    clearTimeout(persistTimers.get(tabId));
    persistTimers.delete(tabId);
    if (sessionStore) sessionStore.remove(CAPTURE_KEY_PREFIX + tabId).catch(() => {});
  }

  return { schedulePersist, restoreCapturedData, forgetPersisted };
}
