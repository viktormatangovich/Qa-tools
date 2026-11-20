import { KeyRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { dateLocale, t } from '../../locales';
import type { ApiRequest } from '../../types';
import { findJwts, jwtState, jwtTimes, NOTABLE_CLAIMS, type FoundJwt } from '../../utils/jwt';
import { JsonTreeView } from '../json/JsonTreeView';

/** "5 min ago" / "in 2 h" for a moment relative to now. */
function relative(ms: number, now: number): string {
  const formatter = new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto' });
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return formatter.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return formatter.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return formatter.format(Math.round(diff / 3_600_000), 'hour');
  return formatter.format(Math.round(diff / 86_400_000), 'day');
}

const formatDate = (ms: number) => new Date(ms).toLocaleString(dateLocale());

const STATE_STYLE = {
  valid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  expired: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  notYetValid: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
} as const;

function claimText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function TokenCard({ found, requestTime }: { found: FoundJwt; requestTime: number }) {
  const [showPayload, setShowPayload] = useState(false);
  const now = Date.now();
  const times = jwtTimes(found.payload);
  const stateNow = jwtState(found.payload, now);
  const stateThen = jwtState(found.payload, requestTime);
  const claims = NOTABLE_CLAIMS.filter((claim) => found.payload[claim] !== undefined);

  return (
    <article className="rounded-lg border border-border p-2.5 text-[11px] space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <KeyRound className="w-3.5 h-3.5 text-accent" />
        <span className="font-medium">{t().jwtSources[found.source.kind]}</span>
        <span className="font-mono text-text-muted break-all">{found.source.name}</span>
        <span className="ml-auto font-mono text-[10px] text-text-muted">{String(found.header.alg ?? '?')}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATE_STYLE[stateNow]}`}>{t().jwtNow}: {t().jwtStates[stateNow]}</span>
        {stateThen !== stateNow && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATE_STYLE[stateThen]}`}>{t().jwtAtRequest}: {t().jwtStates[stateThen]}</span>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {times.exp !== undefined && (<><dt className="text-text-muted">exp</dt><dd>{formatDate(times.exp)} · {relative(times.exp, now)}</dd></>)}
        {times.iat !== undefined && (<><dt className="text-text-muted">iat</dt><dd>{formatDate(times.iat)} · {relative(times.iat, now)}</dd></>)}
        {times.nbf !== undefined && (<><dt className="text-text-muted">nbf</dt><dd>{formatDate(times.nbf)}</dd></>)}
        {times.exp !== undefined && times.iat !== undefined && (
          <><dt className="text-text-muted">{t().jwtLifetime}</dt><dd>{Math.round((times.exp - times.iat) / 60_000)} {t().jwtMinutes}</dd></>
        )}
        {claims.map((claim) => (
          <span key={claim} className="contents">
            <dt className="text-text-muted font-mono">{claim}</dt>
            <dd className="font-mono break-all">{claimText(found.payload[claim])}</dd>
          </span>
        ))}
      </dl>
      <button onClick={() => setShowPayload((open) => !open)} className="text-accent hover:underline text-[10px]">
        {showPayload ? t().jwtHidePayload : t().jwtShowPayload}
      </button>
      {showPayload && <JsonTreeView data={{ header: found.header, payload: found.payload }} />}
    </article>
  );
}

/**
 * Tokens of the request decoded on the spot: expiry now and at the moment of the request, subject,
 * roles and scope — the usual reason for a 401 or 403. Nothing is sent anywhere.
 */
export function JwtInspector({ request }: { request: ApiRequest }) {
  const tokens = useMemo(() => findJwts(request), [request]);
  if (!tokens.length) return null;
  return (
    <section className="mb-3 space-y-2">
      <h3 className="text-xs font-semibold flex items-center gap-1.5">JWT <span className="text-[10px] font-normal text-text-muted">{t().jwtHint}</span></h3>
      {tokens.map((found) => <TokenCard key={found.token} found={found} requestTime={request.timestamp} />)}
    </section>
  );
}
