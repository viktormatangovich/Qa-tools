import type { JiraSettings } from '../types';

export const defaultJiraSettings: JiraSettings = {
  baseUrl: '',
  authType: 'basic',
  email: '',
  token: '',
  projectKey: '',
  issueType: 'Bug',
};

export interface JiraIssueDraft {
  summary: string;
  /** Jira wiki markup, as produced by jiraReport(). */
  description: string;
  /** PNG screenshot as a data URL; attached to the created issue. */
  screenshotDataUrl?: string;
}

export interface JiraIssueResult {
  key: string;
  url: string;
  /** Set when the issue was created but the screenshot could not be attached. */
  attachmentError?: string;
}

/** Base URL without a trailing slash, or null when it is not an http(s) address. */
export function jiraBaseUrl(settings: Pick<JiraSettings, 'baseUrl'>): string | null {
  try {
    const url = new URL(settings.baseUrl.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** True when everything needed to create an issue is filled in. */
export function isJiraConfigured(settings: JiraSettings | undefined): settings is JiraSettings {
  if (!settings || !jiraBaseUrl(settings) || !settings.token.trim() || !settings.projectKey.trim()) return false;
  return settings.authType === 'bearer' || Boolean(settings.email.trim());
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function jiraAuthHeader(settings: JiraSettings): string {
  return settings.authType === 'bearer'
    ? `Bearer ${settings.token.trim()}`
    : `Basic ${base64Utf8(`${settings.email.trim()}:${settings.token.trim()}`)}`;
}

export function buildIssuePayload(settings: JiraSettings, draft: JiraIssueDraft) {
  return {
    fields: {
      project: { key: settings.projectKey.trim() },
      summary: draft.summary.trim().slice(0, 255),
      description: draft.description,
      issuetype: { name: settings.issueType.trim() || 'Bug' },
    },
  };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, data = ''] = dataUrl.split(',');
  const type = /^data:([^;]+)/.exec(meta)?.[1] || 'image/png';
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type });
}

async function errorText(response: Response): Promise<string> {
  let details = '';
  try {
    const body = (await response.json()) as { errorMessages?: string[]; errors?: Record<string, string> };
    details = [...(body.errorMessages || []), ...Object.entries(body.errors || {}).map(([field, text]) => `${field}: ${text}`)].join('; ');
  } catch {
    // Not JSON: the status is all we have.
  }
  return `HTTP ${response.status}${details ? ` — ${details}` : ''}`;
}

/**
 * Creates an issue through the Jira REST API (v2: works for Cloud and Server / Data Center and
 * accepts wiki markup) and attaches the screenshot. This is the only place where the extension
 * sends captured data to a third party, and only on an explicit click.
 */
export async function createJiraIssue(
  settings: JiraSettings,
  draft: JiraIssueDraft,
  send: typeof fetch = fetch,
): Promise<JiraIssueResult> {
  const base = jiraBaseUrl(settings);
  if (!base || !isJiraConfigured(settings)) throw new Error('Jira is not configured');
  if (!draft.summary.trim()) throw new Error('Summary is empty');

  const headers = {
    Authorization: jiraAuthHeader(settings),
    Accept: 'application/json',
    // Jira Server rejects browser-originated writes without this header (XSRF check).
    'X-Atlassian-Token': 'no-check',
  };

  const response = await send(`${base}/rest/api/2/issue`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildIssuePayload(settings, draft)),
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(await errorText(response));
  const created = (await response.json()) as { key?: string };
  if (!created.key) throw new Error('Jira did not return an issue key');

  const result: JiraIssueResult = { key: created.key, url: `${base}/browse/${created.key}` };

  if (draft.screenshotDataUrl) {
    try {
      const form = new FormData();
      form.append('file', dataUrlToBlob(draft.screenshotDataUrl), 'screenshot.png');
      const attached = await send(`${base}/rest/api/2/issue/${created.key}/attachments`, {
        method: 'POST',
        headers,
        body: form,
        credentials: 'omit',
      });
      if (!attached.ok) result.attachmentError = await errorText(attached);
    } catch (error) {
      result.attachmentError = (error as Error).message;
    }
  }
  return result;
}
