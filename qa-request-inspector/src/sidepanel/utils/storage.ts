import type { FontSize } from '../components/settings/SettingsPanel';
import type { QASettings } from '../qa/core/types';
import type { ApiRequest, CaptureSettings, JiraSettings, Language, RequestCollection, RequestMeta, RequestTag, Session } from '../types';

/** Everything the side panel keeps in chrome.storage.local, in one place. */
export interface StoredState {
  favorites: string[];
  sessions: Session[];
  darkMode: boolean;
  fontSize: FontSize;
  maskSecretsOnExport: boolean;
  language: Language;
  captureSettings: CaptureSettings;
  jiraSettings: JiraSettings;
  collections: RequestCollection[];
  tags: RequestTag[];
  requestMeta: Record<string, RequestMeta>;
  qaSettings: QASettings;
  contractSpecText: string;
  excludedQARuleIds: string[];
}

export async function loadStored<K extends keyof StoredState>(keys: K[]): Promise<Partial<Pick<StoredState, K>>> {
  return (await chrome.storage.local.get(keys)) as Partial<Pick<StoredState, K>>;
}

/** Fire-and-forget save; the in-memory state is already updated by the caller. */
export function saveStored(items: Partial<StoredState>): void {
  void chrome.storage.local.set(items).catch((error) => console.error('[Reqpane] Failed to save settings:', error));
}

const sessionKey = (sessionId: string) => `session_${sessionId}`;

export async function loadSessionRequests(sessionId: string): Promise<ApiRequest[] | undefined> {
  const key = sessionKey(sessionId);
  return ((await chrome.storage.local.get(key)) as Record<string, ApiRequest[] | undefined>)[key];
}

/** Saves the request list together with the session index, so the two never disagree. */
export async function saveSessionRequests(sessionId: string, requests: ApiRequest[], sessions: Session[]): Promise<void> {
  await chrome.storage.local.set({ sessions, [sessionKey(sessionId)]: requests });
}

export function removeSessionRequests(sessionIds: string[]): void {
  if (sessionIds.length) void chrome.storage.local.remove(sessionIds.map(sessionKey));
}
