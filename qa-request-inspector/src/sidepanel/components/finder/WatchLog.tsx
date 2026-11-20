import { Eye } from 'lucide-react';
import { dateLocale, t } from '../../locales';
import type { ValueMatch } from '../../utils/valueFinder';

/** Path and query of a URL, for short labels. */
export function shortPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

interface WatchChange {
  at: number;
  from: string | null;
  to: string | null;
  matches: ValueMatch[];
  checked: number;
}

interface WatchLogProps {
  initialText: string | null;
  changes: WatchChange[];
  onStop: () => void;
  onOpenMatch: (match: ValueMatch, query: string) => void;
}

/** Journal of the watched element: every change of its text and the request that brought it. */
export function WatchLog({ initialText, changes, onStop, onOpenMatch }: WatchLogProps) {
  return (
    <div className="mt-2 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent-light)] px-2.5 py-1.5 text-[11px]" role="status">
      <div className="flex items-center gap-2">
        <Eye className="w-3.5 h-3.5 text-[var(--color-accent)] animate-pulse shrink-0" />
        <span className="min-w-0 truncate">{t().watchActive(initialText ?? '', changes.length)}</span>
        <button onClick={onStop} className="ml-auto text-[var(--color-accent)] hover:underline shrink-0">{t().watchStop}</button>
      </div>
      {changes.length === 0 && <p className="mt-1 text-[var(--color-text-muted)]">{t().watchWaiting}</p>}
      <ul className="mt-1 space-y-1 max-h-40 overflow-y-auto">
        {changes.slice(0, 8).map((change) => {
          const best = change.matches[0];
          return (
            <li key={change.at} className="min-w-0">
              <span className="text-[var(--color-text-muted)]">{new Date(change.at).toLocaleTimeString(dateLocale())}</span>{' '}
              <span className="font-mono">{change.from ?? '∅'} → {change.to ?? '∅'}</span>{' '}
              {best ? (
                <button onClick={() => onOpenMatch(best, change.to ?? '')} className="text-[var(--color-accent)] hover:underline font-mono break-all text-left" title={best.request.url}>
                  {best.request.method} {shortPath(best.request.url)} · {best.path.replace(/^root\.?/, '') || t().valueFinderWholeBody}
                </button>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">{t().watchNotFromRequests(change.checked)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
