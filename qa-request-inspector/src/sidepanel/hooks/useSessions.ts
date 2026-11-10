import { useCallback, useEffect, useState } from 'react';
import { dateLocale, t } from '../locales';
import { compareEnvironments, type CompareOptions } from '../qa/environmentCompare';
import { retainedSessions } from '../qa/teamTools';
import type { ApiRequest, Session } from '../types';
import { loadSessionRequests, loadStored, removeSessionRequests, saveSessionRequests, saveStored } from '../utils/storage';

/**
 * Saved sessions: request lists kept in extension storage. Ordinary sessions are temporary (three
 * newest within 24 hours); a pinned session is a reference and stays until it is deleted.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    void loadStored(['sessions']).then((stored) => {
      if (stored.sessions) setSessions(retainedSessions(stored.sessions));
    });

    // The background removes expired sessions and tells every open panel.
    const handleMessage = (message: Record<string, unknown>) => {
      if (message.type === 'SESSION_HISTORY_CHANGED') setSessions(message.payload as Session[]);
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  /** Returns false when there is nothing to save or the storage refused the data. */
  const saveSession = useCallback(async (requests: ApiRequest[]): Promise<boolean> => {
    if (requests.length === 0) return false;

    const session: Session = {
      id: crypto.randomUUID(),
      name: t().sessionName(new Date().toLocaleString(dateLocale())),
      timestamp: Date.now(),
      count: requests.length,
    };
    const all = [session, ...sessions];
    const kept = retainedSessions(all);

    // Save session data before updating the visible list.
    try {
      await saveSessionRequests(session.id, requests, kept);
    } catch {
      window.alert(t().sessionSaveFailed);
      return false;
    }
    setSessions(kept);
    removeSessionRequests(all.filter((item) => !kept.some((keptItem) => keptItem.id === item.id)).map((item) => item.id));
    return true;
  }, [sessions]);

  const deleteSession = useCallback((sessionId: string) => {
    const remaining = sessions.filter((session) => session.id !== sessionId);
    setSessions(remaining);
    removeSessionRequests([sessionId]);
    saveStored({ sessions: remaining });
  }, [sessions]);

  /** Pins a session as a reference (kept without a time limit) or unpins it; `name` renames it. */
  const updateSession = useCallback((sessionId: string, patch: Partial<Pick<Session, 'pinned' | 'name'>>) => {
    const updated = sessions.map((session) => (session.id === sessionId ? { ...session, ...patch } : session));
    // Unpinning may push the session over the limit of temporary ones.
    const kept = retainedSessions(updated);
    setSessions(kept);
    removeSessionRequests(updated.filter((item) => !kept.some((keptItem) => keptItem.id === item.id)).map((item) => item.id));
    saveStored({ sessions: kept });
  }, [sessions]);

  const compareSessions = useCallback(async (leftId: string, rightId: string) => {
    const [left, right, stored] = await Promise.all([
      loadSessionRequests(leftId),
      loadSessionRequests(rightId),
      chrome.storage.local.get('teamWorkspace') as Promise<{ teamWorkspace?: { compareOptions: CompareOptions } }>,
    ]);
    return compareEnvironments(left || [], right || [], stored.teamWorkspace?.compareOptions);
  }, []);

  return { sessions, saveSession, loadSessionRequests, deleteSession, updateSession, compareSessions };
}
