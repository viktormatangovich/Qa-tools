import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ApiRequest } from "../../types";
import type { QAIssue } from "../../qa";
import { jiraReport } from "../../qa/teamTools";
import { createDetailedBugReport } from "../../qa/report";

interface BugReportDialogProps { issue: QAIssue; request?: ApiRequest; onClose: () => void; }

export function BugReportDialog({ issue, request, onClose }: BugReportDialogProps) {
  const [report, setReport] = useState(() => createDetailedBugReport(issue, request));
  useEffect(() => {
    let live = true;
    chrome.storage.local.get('teamWorkspace').then(result => {
      const workspace = result.teamWorkspace as { steps?: import('../../qa/teamTools').ManualStep[]; environment?: import('../../qa/teamTools').Environment } | undefined;
      if (live) setReport(jiraReport(issue.title, workspace?.steps || [], 'Укажите ожидаемый результат.', issue.description, workspace?.environment || 'production', request));
    }).catch(() => {});
    return () => { live = false; };
  }, [issue, request]);
  const filename = useMemo(() => `баг-репорт-${issue.id.replace(/[^a-z0-9]+/gi, "-")}.txt`, [issue.id]);
  const download = () => { const url = URL.createObjectURL(new Blob([report], { type: "text/plain" })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); };
  return <div className="panel-page flex h-full flex-col"><header className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-medium">Баг-репорт</h2><button onClick={onClose}><X className="w-4 h-4" /></button></header><textarea value={report} onChange={(event) => setReport(event.target.value)} className="m-4 flex-1 resize-none rounded border border-border bg-bg p-3 font-mono text-xs" /><footer className="flex gap-2 border-t border-border p-4"><button onClick={() => navigator.clipboard.writeText(report)} className="rounded bg-accent px-3 py-2 text-xs text-white">Копировать текст Jira</button><button onClick={download} className="rounded border border-border px-3 py-2 text-xs">Скачать текст Jira</button></footer></div>;
}
