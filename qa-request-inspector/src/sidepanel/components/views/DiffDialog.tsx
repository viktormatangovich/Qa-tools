import { Dialog } from '@base-ui-components/react/dialog'
import { GitCompare, X } from 'lucide-react'
import type { ApiRequest } from '../../types'
import { t } from '../../locales'

interface DiffDialogProps {
  open: boolean
  onClose: () => void
  requests: [ApiRequest | null, ApiRequest | null]
}

export function DiffDialog({
  open,
  onClose,
  requests,
}: DiffDialogProps) {
  const [req1, req2] = requests

  if (!req1 || !req2) return null

  const formatJson = (data: unknown) => {
    try {
      if (typeof data === 'string') {
        return JSON.stringify(JSON.parse(data), null, 2)
      }
      return JSON.stringify(data, null, 2)
    } catch {
      return String(data) || t().diffEmpty
    }
  }

  // Simple diff helper - returns lines with diff markers
  const diffLines = (text1: string, text2: string) => {
    const lines1 = text1.split('\n')
    const lines2 = text2.split('\n')
    const maxLines = Math.max(lines1.length, lines2.length)

    const result: Array<{ left: string; right: string; isDiff: boolean }> = []

    for (let i = 0; i < maxLines; i++) {
      const left = lines1[i] ?? ''
      const right = lines2[i] ?? ''
      result.push({ left, right, isDiff: left !== right })
    }

    return result
  }

  const responseBody1 = formatJson(req1.responseBody)
  const responseBody2 = formatJson(req2.responseBody)
  const diffResult = diffLines(responseBody1, responseBody2)

  const hasDifferences = diffResult.some(d => d.isDiff)

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Popup className="diff-dialog fixed inset-4 z-50 bg-surface rounded-xl flex flex-col shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium">{t().diffCompareResponses}</span>
              {!hasDifferences && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  {t().diffIdentical}
                </span>
              )}
              {hasDifferences && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  {t().diffCount(diffResult.filter(d => d.isDiff).length)}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text rounded hover:bg-hover"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Request Labels */}
          <div className="flex border-b border-border shrink-0">
            <div className="flex-1 px-4 py-2 border-r border-border bg-surface">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-semibold text-emerald-600">{req1.method}</span>
                <span className="text-[10px] text-text-muted truncate">{(() => { try { return new URL(req1.url).pathname } catch { return req1.url } })()}</span>
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">
                {t().diffStatusLine(req1.status, req1.duration)}
              </div>
            </div>
            <div className="flex-1 px-4 py-2 bg-surface">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-semibold text-blue-600">{req2.method}</span>
                <span className="text-[10px] text-text-muted truncate">{(() => { try { return new URL(req2.url).pathname } catch { return req2.url } })()}</span>
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">
                {t().diffStatusLine(req2.status, req2.duration)}
              </div>
            </div>
          </div>

          {/* Diff View */}
          <div className="flex-1 min-h-0 min-w-0 overflow-auto">
            <div className="flex min-h-full">
              {/* Left side */}
              <div className="flex-1 min-w-0 border-r border-border overflow-auto">
                <pre className="p-3 text-xs font-mono">
                  {diffResult.map((line, i) => (
                    <div
                      key={i}
                      className={`px-2 py-0.5 ${line.isDiff ? 'bg-red-50 text-red-700' : ''}`}
                    >
                      <span className="text-text-muted mr-2 select-none w-8 inline-block text-right">{i + 1}</span>
                      {line.left || ' '}
                    </div>
                  ))}
                </pre>
              </div>

              {/* Right side */}
              <div className="flex-1 min-h-0 min-w-0 overflow-auto">
                <pre className="p-3 text-xs font-mono">
                  {diffResult.map((line, i) => (
                    <div
                      key={i}
                      className={`px-2 py-0.5 ${line.isDiff ? 'bg-emerald-50 text-emerald-700' : ''}`}
                    >
                      <span className="text-text-muted mr-2 select-none w-8 inline-block text-right">{i + 1}</span>
                      {line.right || ' '}
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-surface shrink-0">
            <div className="flex items-center gap-4 text-[10px] text-text-muted">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-red-100 border border-red-200" /> {t().diffLeft}
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200" /> {t().diffRight}
              </div>
            </div>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              {t().diffClose}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
