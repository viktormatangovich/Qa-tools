import { useMemo } from 'react';
import { dateLocale, t } from '../../locales';
import type { ApiRequest } from '../../types';
import { endpointHistory, type FieldChange } from '../../utils/endpointHistory';
import { formatBytes, getPayloadSize } from '../../utils/helpers';

const MAX_CHIPS = 6;

function preview(value: unknown): string {
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function ChangeChip({ change }: { change: FieldChange }) {
  const style = change.kind === 'removed' || change.kind === 'type'
    ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
    : change.kind === 'added'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
  const text = change.kind === 'added'
    ? `+ ${change.path}`
    : change.kind === 'removed'
      ? `− ${change.path}`
      : `${change.path}: ${preview(change.before)} → ${preview(change.after)}`;
  return <span className={`rounded px-1 py-0.5 font-mono text-[10px] break-all ${style}`} title={t().historyChangeKinds[change.kind]}>{text}</span>;
}

const statusStyle = (request: ApiRequest) =>
  request.status >= 400 || request.status === 0 || request.error
    ? 'text-red-600 bg-red-50'
    : request.status >= 300 ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50';

interface EndpointHistoryViewProps {
  request: ApiRequest;
  requests: ApiRequest[];
  onOpenRequest?: (request: ApiRequest) => void;
}

/**
 * Every call of this endpoint in the capture, newest first: status, time, size and what changed in
 * the response since the previous call — "sometimes the list comes back empty" becomes visible.
 */
export function EndpointHistoryView({ request, requests, onOpenRequest }: EndpointHistoryViewProps) {
  const history = useMemo(() => endpointHistory(requests, request), [requests, request]);
  const { stats } = history;
  const maxDuration = Math.max(1, stats.maxMs);

  return (
    <div className="space-y-3 text-[11px]">
      <div className="rounded-lg border border-border bg-[var(--color-bg)] p-2.5">
        <p className="font-mono font-medium break-all">{history.key}</p>
        <p className="mt-1 text-text-muted">
          {t().historyStats(stats.count, stats.errors, stats.avgMs, stats.minMs, stats.maxMs)}
          {stats.statuses.length > 1 && <> · {t().historyStatuses}: {stats.statuses.map((status) => status || 'ERR').join(', ')}</>}
        </p>
      </div>
      {stats.count <= 1 && <p className="text-text-muted">{t().historyOnlyOne}</p>}
      <ol className="space-y-1">
        {[...history.entries].reverse().map(({ request: call, changes, statusChanged }) => {
          const current = call.id === request.id;
          const size = getPayloadSize(call.responseBody) || call.transferSize || 0;
          return (
            <li key={call.id}>
              <button
                onClick={() => !current && onOpenRequest?.(call)}
                disabled={current}
                className={`w-full rounded-lg border p-2 text-left ${current ? 'border-accent bg-accent-light' : 'border-border hover:bg-hover'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-text-muted">{new Date(call.timestamp).toLocaleTimeString(dateLocale())}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusStyle(call)}`}>{call.status || 'ERR'}</span>
                  {statusChanged && <span className="text-[10px] text-amber-700">{t().historyStatusChanged}</span>}
                  <span className="relative h-1.5 w-16 rounded bg-hover overflow-hidden" title={`${call.duration} ms`}>
                    <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${Math.max(4, (call.duration / maxDuration) * 100)}%` }} />
                  </span>
                  <span className="text-text-muted">{call.duration} ms</span>
                  {size > 0 && <span className="text-text-muted">{formatBytes(size)}</span>}
                  {current && <span className="ml-auto text-[10px] text-accent">{t().historyCurrent}</span>}
                </div>
                {call.url !== request.url && <p className="mt-1 font-mono text-[10px] text-text-muted truncate">{call.url}</p>}
                {changes.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {changes.slice(0, MAX_CHIPS).map((change) => <ChangeChip key={`${change.kind}:${change.path}`} change={change} />)}
                    {changes.length > MAX_CHIPS && <span className="text-[10px] text-text-muted">{t().historyMoreChanges(changes.length - MAX_CHIPS)}</span>}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
