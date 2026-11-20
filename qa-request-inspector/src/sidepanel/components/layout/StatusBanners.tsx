import { BellRing, X } from 'lucide-react';
import { dateLocale, t } from '../../locales';
import type { RequestCollection } from '../../types';
import type { LatestVersion } from '../../utils/version';
import type { WatchAlert } from '../../utils/watchdog';

interface StatusBannersProps {
  debuggerDetached: boolean;
  onReconnect: () => void;
  snapshot: { kind: 'har' | 'session'; name: string } | null;
  onReturnToCapture: () => void;
  update: LatestVersion | null;
  currentVersion: string;
  onDismissUpdate: () => void;
  alerts: WatchAlert[];
  onOpenAlert: (alert: WatchAlert) => void;
  onDismissAlerts: () => void;
  group: {
    active: boolean;
    selected: number;
    collections: RequestCollection[];
    onSelectAll: () => void;
    onDeselectAll: () => void;
    onDelete: () => void;
    onExport: () => void;
    onAddToCollection: (collectionId: string) => void;
  };
}

/** The strips between the header and the list: capture stopped, snapshot, update, watchdog, selection. */
export function StatusBanners({ group, ...props }: StatusBannersProps) {
  return (
    <>
      {props.debuggerDetached && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs">
          <span className="text-amber-700 dark:text-amber-300">{t().captureStopped}</span>
          <button onClick={props.onReconnect} className="px-2 py-0.5 bg-amber-600 text-white rounded text-xs hover:bg-amber-700 transition-colors">{t().reconnect}</button>
        </div>
      )}

      {props.snapshot && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between gap-2 text-xs">
          <span className="text-blue-700 dark:text-blue-300 truncate">
            {props.snapshot.kind === 'har' ? t().snapshotHar(props.snapshot.name) : t().snapshotSession(props.snapshot.name)}
          </span>
          <button onClick={props.onReturnToCapture} className="shrink-0 px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition-colors">{t().returnToCapture}</button>
        </div>
      )}

      {props.update && (
        <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950 border-b border-emerald-200 dark:border-emerald-800 flex items-center gap-2 text-xs">
          <span className="flex-1 text-emerald-800 dark:text-emerald-200">{t().updateAvailable(props.update.version, props.currentVersion)}</span>
          <a href={props.update.url} target="_blank" rel="noreferrer" className="shrink-0 px-2 py-0.5 bg-emerald-600 text-white rounded hover:bg-emerald-700">{t().updateDownload}</a>
          <button onClick={props.onDismissUpdate} className="shrink-0 p-0.5 text-emerald-700 hover:text-emerald-900" title={t().updateLater} aria-label={t().updateLater}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {props.alerts.length > 0 && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-300 dark:border-amber-800 text-xs" role="alert">
          <div className="flex items-center gap-2">
            <BellRing className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="flex-1 font-medium text-amber-800 dark:text-amber-200">{t().watchdogAlertsTitle(props.alerts.length)}</span>
            <button onClick={props.onDismissAlerts} className="shrink-0 p-0.5 text-amber-700 hover:text-amber-900" aria-label={t().close}><X className="w-3.5 h-3.5" /></button>
          </div>
          <ul className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
            {props.alerts.slice(0, 5).map((alert) => (
              <li key={alert.id}>
                <button onClick={() => props.onOpenAlert(alert)} className="text-left hover:underline text-amber-900 dark:text-amber-100">
                  <span className="text-amber-700">{new Date(alert.at).toLocaleTimeString(dateLocale())}</span>{' '}
                  {t().watchdogAlert(alert.key, alert.reason, alert.status, alert.duration)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {group.active && group.selected > 0 && (
        <div className="px-4 py-2 bg-[var(--color-accent)]/10 border-b border-[var(--color-accent)]/20 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium text-[var(--color-accent)]">{t().selectedCount(group.selected)}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={group.onSelectAll} className="px-2 py-1 rounded bg-[var(--color-accent)] text-white hover:opacity-90">{t().selectAll}</button>
            <button onClick={group.onDeselectAll} className="px-2 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-hover)]">{t().deselectAll}</button>
            <button onClick={group.onDelete} className="px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600">{t().deleteSelected}</button>
            <button onClick={group.onExport} className="px-2 py-1 rounded bg-[var(--color-accent)] text-white hover:opacity-90">{t().exportSelected}</button>
            {group.collections.length > 0 && (
              <select
                onChange={(event) => {
                  if (event.target.value) {
                    group.onAddToCollection(event.target.value);
                    event.target.value = '';
                  }
                }}
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-xs"
                defaultValue=""
              >
                <option value="" disabled>{t().addSelectedToCollection}</option>
                {group.collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
              </select>
            )}
          </div>
        </div>
      )}
    </>
  );
}
