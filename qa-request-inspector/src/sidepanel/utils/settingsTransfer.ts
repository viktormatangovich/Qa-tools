// Export and import of every setting as one JSON file: moving to another browser profile or
// sharing a set-up with the team. Captured data (requests, sessions, collections) is not settings
// and is not included; neither is the Jira token.

/** Storage keys that make up the settings. */
export const SETTINGS_KEYS = [
  'darkMode',
  'fontSize',
  'language',
  'maskSecretsOnExport',
  'captureSettings',
  'qaSettings',
  'contractSpecText',
  'excludedQARuleIds',
  'mockRules',
  'breakpointRules',
  'teamWorkspace',
  'tags',
  'jiraSettings',
  'checkUpdates',
  'watchedEndpoints',
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];

export interface SettingsFile {
  app: 'reqpane';
  kind: 'settings';
  version: 1;
  exportedAt: string;
  settings: Partial<Record<SettingsKey, unknown>>;
}

type Shape = 'boolean' | 'string' | 'object' | 'array';

const SHAPES: Record<SettingsKey, Shape> = {
  darkMode: 'boolean',
  fontSize: 'string',
  language: 'string',
  maskSecretsOnExport: 'boolean',
  captureSettings: 'object',
  qaSettings: 'object',
  contractSpecText: 'string',
  excludedQARuleIds: 'array',
  mockRules: 'array',
  breakpointRules: 'array',
  teamWorkspace: 'object',
  tags: 'array',
  jiraSettings: 'object',
  checkUpdates: 'boolean',
  watchedEndpoints: 'array',
};

function hasShape(value: unknown, shape: Shape): boolean {
  if (shape === 'array') return Array.isArray(value);
  if (shape === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  return typeof value === shape;
}

/** Builds the export file from what is stored. The Jira token never leaves the browser. */
export function buildSettingsFile(stored: Record<string, unknown>, now = new Date()): SettingsFile {
  const settings: SettingsFile['settings'] = {};
  for (const key of SETTINGS_KEYS) {
    if (stored[key] === undefined) continue;
    settings[key] = key === 'jiraSettings' ? { ...(stored[key] as object), token: '' } : stored[key];
  }
  return { app: 'reqpane', kind: 'settings', version: 1, exportedAt: now.toISOString(), settings };
}

/**
 * Validates an imported file and returns the storage items to write. Unknown keys are ignored and
 * a value of the wrong type is skipped (its name is returned in `skipped`). An imported Jira block
 * keeps the token already stored in this browser.
 */
export function readSettingsFile(text: string, current: Record<string, unknown> = {}): { items: Partial<Record<SettingsKey, unknown>>; skipped: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('not-json');
  }
  const file = parsed as Partial<SettingsFile> | null;
  if (!file || file.app !== 'reqpane' || file.kind !== 'settings' || !file.settings || typeof file.settings !== 'object') {
    throw new Error('not-settings');
  }

  const items: Partial<Record<SettingsKey, unknown>> = {};
  const skipped: string[] = [];
  for (const key of SETTINGS_KEYS) {
    const value = (file.settings as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (!hasShape(value, SHAPES[key])) {
      skipped.push(key);
      continue;
    }
    if (key === 'jiraSettings') {
      const existingToken = (current.jiraSettings as { token?: string } | undefined)?.token || '';
      items[key] = { ...(value as object), token: (value as { token?: string }).token || existingToken };
    } else {
      items[key] = value;
    }
  }
  return { items, skipped };
}
