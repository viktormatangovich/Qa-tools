import { useMemo, useState } from 'react'
import { Pause } from 'lucide-react'
import type { PausedOverrides } from '../../hooks/useCapture'
import { t } from '../../locales'
import type { PausedRequest } from '../../types'
import { contentTypeOf } from '../../utils/formBody'
import { BodyEditor } from '../common/BodyEditor'

interface PausedRequestDialogProps {
  paused: PausedRequest
  /** Other requests waiting behind this one. */
  queued: number
  onResume: (paused: PausedRequest, action: 'continue' | 'cancel', overrides?: PausedOverrides) => void
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const field = 'w-full rounded border border-border bg-bg px-2 py-1.5 font-mono text-xs focus:outline-none focus:border-red-500'

const headersToText = (headers: Record<string, string>) =>
  Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\n')

/** "Name: value" lines back to an object; null when a line has no name. */
function textToHeaders(text: string): Record<string, string> | null {
  const headers: Record<string, string> = {}
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const separator = line.indexOf(':')
    const name = separator > 0 ? line.slice(0, separator).trim() : ''
    if (!name) return null
    headers[name] = line.slice(separator + 1).trim()
  }
  return headers
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/**
 * A request stopped at a breakpoint. Before sending, its URL, method, headers and body can be
 * edited; with the response in hand, the status, headers and body the page will receive.
 */
export function PausedRequestDialog({ paused, queued, onResume }: PausedRequestDialogProps) {
  const isResponse = paused.stage === 'response'
  const initial = useMemo(() => ({
    url: paused.url,
    method: paused.method,
    headers: headersToText(isResponse ? paused.response?.headers || {} : paused.headers),
    body: prettyJson(isResponse ? paused.response?.body || '' : paused.postData || ''),
    status: String(paused.response?.status ?? 200),
  }), [paused, isResponse])

  const [url, setUrl] = useState(initial.url)
  const [method, setMethod] = useState(initial.method)
  const [headers, setHeaders] = useState(initial.headers)
  const [body, setBody] = useState(initial.body)
  const [status, setStatus] = useState(initial.status)

  const parsedHeaders = textToHeaders(headers)
  const binary = isResponse && Boolean(paused.response?.binary)
  const changed = url !== initial.url || method !== initial.method || headers !== initial.headers || body !== initial.body || status !== initial.status
  const statusValid = !isResponse || (Number(status) >= 100 && Number(status) <= 599)
  const canSend = changed && parsedHeaders !== null && statusValid && (isResponse || url.trim() !== '')

  const sendEdited = () => {
    if (!parsedHeaders) return
    onResume(paused, 'continue', isResponse
      ? { status: Number(status), headers: parsedHeaders, body }
      : {
          // Only what was edited is overridden; the rest goes out as the page sent it.
          ...(url.trim() !== initial.url ? { url: url.trim() } : {}),
          ...(method !== initial.method ? { method } : {}),
          ...(headers !== initial.headers ? { headers: parsedHeaders } : {}),
          ...(body !== initial.body ? { postData: body } : {}),
        })
  }

  return (
    <div className="panel-page flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Pause className="h-4 w-4 shrink-0 text-red-500" />
        <h2 className="text-sm font-medium">{isResponse ? t().pausedTitleResponse : t().pausedTitleRequest}</h2>
        {queued > 0 && <span className="text-xs text-text-muted">{t().pausedQueue(queued)}</span>}
      </header>

      <div className="flex-1 space-y-3 overflow-auto p-4">
        {isResponse ? (
          <>
            <p className="break-all font-mono text-xs text-text-muted">{paused.method} {paused.url}</p>
            <label className="block text-xs font-medium">{t().pausedStatus}
              <input type="number" min="100" max="599" value={status} onChange={(event) => setStatus(event.target.value)} className={`${field} mt-1 w-28`} />
            </label>
          </>
        ) : (
          <div className="flex gap-2">
            <label className="block w-28 shrink-0 text-xs font-medium">{t().mockMethod}
              <select value={method} onChange={(event) => setMethod(event.target.value)} className={`${field} mt-1`}>
                {(METHODS.includes(method) ? METHODS : [method, ...METHODS]).map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="block min-w-0 flex-1 text-xs font-medium">URL
              <input type="text" value={url} onChange={(event) => setUrl(event.target.value)} className={`${field} mt-1`} />
            </label>
          </div>
        )}

        <label className="block text-xs font-medium">{t().pausedHeaders}
          <textarea value={headers} onChange={(event) => setHeaders(event.target.value)} spellCheck={false} className={`${field} mt-1 h-28 resize-y`} />
        </label>
        {parsedHeaders === null && <p role="alert" className="text-xs text-red-600">{t().pausedInvalidHeaders}</p>}

        {binary ? (
          <p className="text-xs text-text-muted">{t().pausedBinary}</p>
        ) : (
          <div className="text-xs font-medium">
            <span className="mb-1 block">{t().pausedBody}</span>
            <BodyEditor
              value={body}
              onChange={setBody}
              contentType={contentTypeOf(parsedHeaders ?? undefined)}
              className={`${field} h-40 resize-y`}
            />
          </div>
        )}
        <p className="text-[10px] text-text-muted">{t().pausedHint}</p>
      </div>

      <footer className="flex flex-wrap gap-2 border-t border-border p-4">
        <button onClick={sendEdited} disabled={!canSend || binary} className="rounded bg-red-500 px-3 py-2 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-40">
          {isResponse ? t().pausedReturnEdited : t().pausedSendEdited}
        </button>
        <button onClick={() => onResume(paused, 'continue')} className="rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700">
          {t().pausedContinue}
        </button>
        <button onClick={() => onResume(paused, 'cancel')} className="rounded border border-border px-3 py-2 text-xs hover:bg-hover">
          {t().pausedCancelRequest}
        </button>
      </footer>
    </div>
  )
}
