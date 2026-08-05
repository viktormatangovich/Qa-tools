import { ArrowLeft, Trash2, ExternalLink, Clock, Shield, Play, Loader2 } from 'lucide-react'
import { useMemo, useState, useCallback } from 'react'
import type { ApiRequest, RequestCollection } from '../../types'
import { t } from '../../locales'

interface CollectionViewerProps {
  collection: RequestCollection
  onRemoveRequest: (collectionId: string, requestId: string) => void
  onSelectRequest: (request: ApiRequest) => void
  onBack: () => void
}

export function CollectionViewer({
  collection,
  onRemoveRequest,
  onSelectRequest,
  onBack,
}: CollectionViewerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [replayingId, setReplayingId] = useState<string | null>(null)

  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return collection.requests
    const q = searchQuery.toLowerCase()
    return collection.requests.filter(r =>
      r.url.toLowerCase().includes(q) ||
      r.method.toLowerCase().includes(q) ||
      String(r.status).includes(q)
    )
  }, [collection.requests, searchQuery])

  const handleReplay = useCallback(async (req: ApiRequest) => {
    setReplayingId(req.id)
    try {
      const options: RequestInit = {
        method: req.method,
        headers: req.requestHeaders,
      }
      if (req.requestBody && req.method !== 'GET') {
        options.body = typeof req.requestBody === 'string'
          ? req.requestBody
          : JSON.stringify(req.requestBody)
      }
      await fetch(req.url, options)
    } catch {
      // Silently fail — replay is best-effort
    } finally {
      setReplayingId(null)
    }
  }, [])

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'text-emerald-600'
      case 'POST': return 'text-blue-600'
      case 'PUT': return 'text-amber-600'
      case 'PATCH': return 'text-orange-600'
      case 'DELETE': return 'text-red-600'
      default: return 'text-purple-600'
    }
  }

  const getStatusColor = (status: number) => {
    if (status >= 400) return 'bg-red-50 text-red-600'
    if (status >= 300) return 'bg-amber-50 text-amber-600'
    return 'bg-emerald-50 text-emerald-600'
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="p-1 rounded hover:bg-[var(--color-hover)] transition-colors shrink-0"
            title={t().back}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: collection.color }}
          />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{collection.name}</h2>
            {collection.description && (
              <p className="text-[10px] text-[var(--color-text-muted)] truncate">{collection.description}</p>
            )}
          </div>
        </div>
        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 ml-2">
          {collection.requests.length} {t().requests}
        </span>
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-[var(--color-border)]">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t().filterByUrl}
          className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
        />
      </div>

      {/* Request list */}
      <div className="flex-1 overflow-auto">
        {filteredRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
            <ExternalLink className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">
              {searchQuery ? t().noRequests : t().noRequests}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {filteredRequests.map(req => (
              <div
                key={req.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-hover)] cursor-pointer transition-colors group"
                onClick={() => onSelectRequest(req)}
              >
                {/* Method */}
                <span className={`text-[10px] font-mono font-semibold w-12 shrink-0 ${getMethodColor(req.method)}`}>
                  {req.method}
                </span>

                {/* Status */}
                <span className={`text-[10px] px-1 py-0.5 rounded font-medium w-12 shrink-0 text-center ${getStatusColor(req.status)}`}>
                  {req.status}
                </span>

                {/* URL */}
                <span className="flex-1 text-xs font-mono truncate text-[var(--color-text)] min-w-0">
                  {req.url}
                </span>

                {/* Duration */}
                <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1 shrink-0">
                  <Clock className="w-3 h-3" />
                  {formatDuration(req.duration)}
                </span>

                {/* Mocked indicator */}
                {req.mocked && (
                  <span title={t().mockFromRequest}>
                    <Shield className="w-3 h-3 text-purple-500 shrink-0" />
                  </span>
                )}

                {/* Replay button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleReplay(req)
                  }}
                  disabled={replayingId === req.id}
                  className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-blue-500 hover:bg-blue-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0 disabled:opacity-50"
                  title={t().replay}
                >
                  {replayingId === req.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Remove button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveRequest(collection.id, req.id)
                  }}
                  className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                  title={t().removeFromCollection}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}