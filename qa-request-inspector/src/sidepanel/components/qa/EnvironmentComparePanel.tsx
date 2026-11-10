import { useState } from "react";
import type { EnvironmentDifference } from "../../qa/environmentCompare";
import { t } from "../../locales";

interface SessionOption { id: string; name: string; }
interface Props { sessions: SessionOption[]; onCompare: (left: string, right: string) => Promise<EnvironmentDifference[]>; }

export function EnvironmentComparePanel({ sessions, onCompare }: Props) {
  const [left, setLeft] = useState(""); const [right, setRight] = useState(""); const [differences, setDifferences] = useState<EnvironmentDifference[] | null>(null);
  return <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2"><summary className="cursor-pointer text-xs font-medium">{t().envCompareTitle}</summary><p className="mt-2 text-[10px] text-[var(--color-text-muted)]">{t().envCompareHint}</p><div className="mt-2 flex gap-2"><select value={left} onChange={(event) => setLeft(event.target.value)} className="min-w-0 flex-1 rounded border border-border bg-surface p-1 text-xs"><option value="">{t().firstSession}</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select><select value={right} onChange={(event) => setRight(event.target.value)} className="min-w-0 flex-1 rounded border border-border bg-surface p-1 text-xs"><option value="">{t().secondSession}</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select></div><button disabled={!left || !right || left === right} onClick={() => void onCompare(left, right).then(setDifferences)} className="mt-2 rounded border border-border px-2 py-1 text-[10px] disabled:opacity-40">{t().compare}</button>{differences && <div className="mt-2 space-y-1 text-[10px]">{differences.length ? differences.map((difference) => <p key={difference.key}><strong>{difference.key}</strong>: {difference.changes.join(", ")}</p>) : <p>{t().envNoDifferences}</p>}</div>}</details>;
}
