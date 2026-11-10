import { useEffect, useMemo, useState } from "react";
import { Camera, ExternalLink, Trash2, X } from "lucide-react";
import { t } from "../../locales";
import type { ApiRequest, JiraSettings } from "../../types";
import type { QAIssue } from "../../qa";
import { createJiraIssue, isJiraConfigured, jiraBaseUrl, type JiraIssueResult } from "../../qa/jira";
import { jiraReport, type Environment, type ManualStep } from "../../qa/teamTools";
import { createDetailedBugReport } from "../../qa/report";

interface BugReportDialogProps {
  issue: QAIssue;
  request?: ApiRequest;
  jiraSettings: JiraSettings;
  /** PNG screenshot of the inspected tab as a data URL. */
  onCaptureScreenshot: (fullPage: boolean) => Promise<string>;
  onClose: () => void;
}

function saveAs(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
}

export function BugReportDialog({ issue, request, jiraSettings, onCaptureScreenshot, onClose }: BugReportDialogProps) {
  const [summary, setSummary] = useState(issue.title);
  const [report, setReport] = useState(() => createDetailedBugReport(issue, request));
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [fullPage, setFullPage] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [created, setCreated] = useState<JiraIssueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    chrome.storage.local.get('teamWorkspace').then(result => {
      const workspace = result.teamWorkspace as { steps?: ManualStep[]; environment?: Environment } | undefined;
      if (live) setReport(jiraReport(issue.title, workspace?.steps || [], t().bugExpectedPlaceholder, issue.description, workspace?.environment || 'production', request));
    }).catch(() => {});
    return () => { live = false; };
  }, [issue, request]);

  const baseName = useMemo(() => `bug-report-${issue.id.replace(/[^a-z0-9]+/gi, "-")}`, [issue.id]);
  const jiraReady = isJiraConfigured(jiraSettings);

  const download = () => {
    const url = URL.createObjectURL(new Blob([report], { type: "text/plain" }));
    saveAs(url, `${baseName}.txt`);
    URL.revokeObjectURL(url);
  };

  const takeScreenshot = async () => {
    setError(null);
    setCapturing(true);
    try {
      setScreenshot(await onCaptureScreenshot(fullPage));
    } catch {
      setError(t().screenshotFailed);
    } finally {
      setCapturing(false);
    }
  };

  const sendToJira = async () => {
    if (!jiraReady) return;
    const host = jiraBaseUrl(jiraSettings) || jiraSettings.baseUrl;
    // The only action of the extension that sends data to a third party: ask every time.
    if (!window.confirm(t().jiraConfirm(jiraSettings.projectKey, host, Boolean(screenshot)))) return;
    setError(null);
    setSending(true);
    try {
      setCreated(await createJiraIssue(jiraSettings, { summary, description: report, screenshotDataUrl: screenshot || undefined }));
    } catch (sendError) {
      setError(t().jiraError((sendError as Error).message));
    } finally {
      setSending(false);
    }
  };

  return <div className="panel-page flex h-full flex-col">
    <header className="flex items-center justify-between border-b border-border px-4 py-3">
      <h2 className="text-sm font-medium">{t().bugReportTitle}</h2>
      <button onClick={onClose} aria-label={t().shortcutClose}><X className="w-4 h-4" /></button>
    </header>

    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <label className="block text-xs font-medium">{t().bugSummary}
        <input value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={255} className="mt-1 w-full rounded border border-border bg-bg p-2 text-xs" />
      </label>
      <textarea value={report} onChange={(event) => setReport(event.target.value)} aria-label={t().bugReportTitle} className="min-h-40 flex-1 resize-none rounded border border-border bg-bg p-3 font-mono text-xs" />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void takeScreenshot()} disabled={capturing} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1.5 text-xs disabled:opacity-40">
            <Camera className="h-3.5 w-3.5" />{screenshot ? t().screenshotRetake : t().screenshotTake}
          </button>
          <label className="flex items-center gap-1 text-xs text-text-muted">
            <input type="checkbox" checked={fullPage} onChange={(event) => setFullPage(event.target.checked)} />{t().screenshotFullPage}
          </label>
          {screenshot && <>
            <button onClick={() => saveAs(screenshot, `${baseName}.png`)} className="rounded border border-border px-2 py-1.5 text-xs">{t().screenshotDownload}</button>
            <button onClick={() => setScreenshot(null)} aria-label={t().screenshotRemove} title={t().screenshotRemove} className="rounded p-1.5 text-red-500 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
          </>}
        </div>
        {screenshot && <img src={screenshot} alt={t().screenshotAlt} className="max-h-40 rounded border border-border object-contain" />}
      </div>

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {created && <p role="status" className="text-xs">
        {t().jiraCreated(created.key)}{" "}
        <a href={created.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent underline">{created.url}<ExternalLink className="h-3 w-3" /></a>
        {created.attachmentError && <span className="block text-amber-700">{t().jiraAttachmentFailed(created.attachmentError)}</span>}
      </p>}
      {!jiraReady && <p className="text-[10px] text-text-muted">{t().jiraNotConfigured}</p>}
    </div>

    <footer className="flex flex-wrap gap-2 border-t border-border p-4">
      <button onClick={() => void navigator.clipboard.writeText(report)} className="rounded bg-accent px-3 py-2 text-xs text-white">{t().copyJiraText}</button>
      <button onClick={download} className="rounded border border-border px-3 py-2 text-xs">{t().downloadJiraText}</button>
      <button onClick={() => void sendToJira()} disabled={!jiraReady || sending || !summary.trim() || Boolean(created)} className="rounded border border-accent px-3 py-2 text-xs text-accent disabled:opacity-40">
        {sending ? t().jiraSending : t().sendToJira}
      </button>
    </footer>
  </div>;
}
