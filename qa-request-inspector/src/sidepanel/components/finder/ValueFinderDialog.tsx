import { Crosshair, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { dateLocale, t } from '../../locales'
import type { ApiRequest } from '../../types'
import {
  candidatesOf,
  findValueInRequests,
  parseDisplayedValue,
  partsOf,
  previewValue,
  type MatchDetail,
  type PickedElement,
  type ValueMatch,
} from '../../utils/valueFinder'

const LIMIT = 300

const KIND_STYLE: Record<ValueMatch['kind'], string> = {
  exact: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  number: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  converted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  date: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  row: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  approx: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  computed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  length: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  contains: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

/** How the match was found, for the second line of a result. */
function detailText(detail: MatchDetail | undefined, arrayName: string): string | null {
  if (!detail) return null
  if (detail.note) return t().valueFinderNotes[detail.note]
  if (detail.row) return t().valueFinderRow(detail.row.matched, detail.row.total)
  if (detail.computed) {
    const { op, field, equals } = detail.computed
    return op === 'count'
      ? t().valueFinderComputedCount(`${arrayName}[${field}=${JSON.stringify(equals)}].length`)
      : t().valueFinderComputedSum(`sum(${arrayName}[].${field})`)
  }
  return null
}

interface ValueFinderDialogProps {
  picked: PickedElement
  requests: ApiRequest[]
  /** `query` is the searched text as it is in the field (possibly corrected by hand). */
  onOpenMatch: (match: ValueMatch, query: string) => void
  onPickAgain: () => void
  /** Watch the element for changes; absent while it is already watched. */
  onWatch?: () => void
  onClose: () => void
}

/** Results of the element picker: where the value of the clicked element occurs in the responses. */
export function ValueFinderDialog({ picked, requests, onOpenMatch, onPickAgain, onWatch, onClose }: ValueFinderDialogProps) {
  // The value can be corrected by hand when the element text holds more than the counter.
  const [query, setQuery] = useState(picked.text)
  const edited = query !== picked.text
  const candidates = useMemo(
    () => (edited ? [parseDisplayedValue(query)] : candidatesOf(picked)),
    [edited, query, picked],
  )
  const parts = useMemo(() => (edited ? [] : partsOf(picked)), [edited, picked])
  const matches = useMemo(() => findValueInRequests(requests, candidates, { limit: LIMIT, parts }), [requests, candidates, parts])
  const checked = useMemo(() => requests.filter((request) => request.responseBody != null).length, [requests])
  const attributes = edited ? [] : picked.attributes

  return (
    <div className="panel-page flex flex-col h-full">
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-10 h-1 rounded-full bg-border" />
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Crosshair className="w-4 h-4 text-accent shrink-0" />
          <span className="text-sm font-medium">{t().valueFinderTitle}</span>
          <kbd className="hidden sm:inline text-[10px] text-text-muted border border-border rounded px-1" title={t().pickElementShortcutHint}>Alt+Shift+F</kbd>
        </div>
        <div className="flex items-center gap-1">
          {onWatch && (
            <button
              onClick={onWatch}
              className="px-2 py-1 text-xs rounded border border-border hover:bg-hover"
              title={t().watchHint}
            >
              {t().watchButton}
            </button>
          )}
          <button
            onClick={onPickAgain}
            className="px-2 py-1 text-xs rounded border border-border hover:bg-hover"
          >
            {t().valueFinderPickAgain}
          </button>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text rounded hover:bg-hover" aria-label={t().close}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-4 py-2 space-y-1.5 border-b border-border shrink-0">
        <label className="block text-[10px] text-text-muted">
          {t().valueFinderValue} <span className="font-mono">&lt;{picked.tag}&gt;</span>
        </label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg bg-surface border border-border focus:outline-none focus:border-accent"
          />
        </div>
        {picked.frameUrl && (
          <p className="text-[10px] text-text-muted truncate" title={picked.frameUrl}>
            {t().valueFinderInFrame(shortUrl(picked.frameUrl))}
          </p>
        )}
        {parts.length > 0 && (
          <p className="text-[10px] text-text-muted">
            {t().valueFinderParts}{' '}
            {parts.slice(0, 8).map((part, index) => (
              <span key={index} className="font-mono mr-1.5" title={part.raw}>
                «{part.raw.length > 24 ? `${part.raw.slice(0, 23)}…` : part.raw}»
              </span>
            ))}
          </p>
        )}
        {attributes.length > 0 && (
          <p className="text-[10px] text-text-muted">
            {t().valueFinderAlsoAttributes}{' '}
            {attributes.slice(0, 6).map((attribute) => (
              <span key={attribute.name} className="font-mono mr-1.5" title={attribute.value}>
                {attribute.name}="{attribute.value.length > 24 ? `${attribute.value.slice(0, 23)}…` : attribute.value}"
              </span>
            ))}
          </p>
        )}
        <p className="text-[10px] text-text-muted">
          {t().valueFinderChecked(checked)} · {t().valueFinderFound(matches.length)}
          {matches.length >= LIMIT && ` · ${t().valueFinderLimited(LIMIT)}`}
        </p>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {matches.length === 0 ? (
          <p className="px-4 py-8 text-xs text-text-muted text-center">{t().valueFinderNoMatches}</p>
        ) : (
          <ul>
            {matches.map((match, index) => (
              <li key={`${match.request.id}:${match.path}:${index}`}>
                <button
                  onClick={() => onOpenMatch(match, query)}
                  className="w-full text-left px-4 py-2 border-b border-border hover:bg-hover"
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-text-muted min-w-0">
                    <span className="font-semibold text-text">{match.request.method}</span>
                    <span className={match.request.status >= 400 ? 'text-red-500' : ''}>{match.request.status || '—'}</span>
                    <span className="truncate min-w-0 flex-1 font-mono" title={match.request.url}>{shortUrl(match.request.url)}</span>
                    <span className="shrink-0">{new Date(match.request.timestamp).toLocaleTimeString(dateLocale())}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                    {match.section !== 'response' && (
                      <span className="shrink-0 rounded px-1 text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                        {t().valueFinderSections[match.section]}
                      </span>
                    )}
                    <span className="font-mono text-xs truncate min-w-0" title={match.path}>
                      {match.path === 'root' ? t().valueFinderWholeBody : match.path.replace(/^root\./, '')}
                      <span className="text-text-muted"> = </span>
                      {previewValue(match.value)}
                    </span>
                    <span className={`ml-auto shrink-0 rounded px-1 text-[10px] ${KIND_STYLE[match.kind]}`}>
                      {t().valueFinderKinds[match.kind]}
                    </span>
                    {match.source !== 'text' && match.source !== 'part' && (
                      <span className="shrink-0 text-[10px] text-text-muted font-mono">{t().valueFinderFromAttribute(match.source)}</span>
                    )}
                  </div>
                  {detailText(match.detail, typeof match.key === 'string' ? match.key : 'items') && (
                    <div className="mt-0.5 text-[10px] text-text-muted font-mono truncate">
                      {detailText(match.detail, typeof match.key === 'string' ? match.key : 'items')}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
