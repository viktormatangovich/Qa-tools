import { Check, Pin, Star, Tag, Turtle } from 'lucide-react'
import type { ApiRequest, RequestTag } from '../../types'
import { formatBytes, getPayloadSize } from '../../utils'

interface RequestRowProps {
  request: ApiRequest
  isSelected: boolean
  isFavorite: boolean
  isPinned?: boolean
  tags?: RequestTag[]
  compareMode?: boolean
  isCompareSelected?: boolean
  groupSelectionMode?: boolean
  isGroupSelected?: boolean
  onClick: () => void
  onToggleFavorite: () => void
  onToggleCompare?: () => void
  onToggleGroupSelect?: () => void
  onTogglePin?: () => void
}

export function RequestRow({
  request,
  isSelected,
  isFavorite,
  isPinned = false,
  tags,
  compareMode = false,
  isCompareSelected = false,
  groupSelectionMode = false,
  isGroupSelected = false,
  onClick,
  onToggleFavorite,
  onToggleCompare,
  onToggleGroupSelect,
  onTogglePin,
}: RequestRowProps) {
  const isError = request.status >= 400 || request.error
  const isSlow = request.duration > 1000
  const responseSize = getPayloadSize(request.responseBody)

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'text-emerald-600'
      case 'POST': return 'text-blue-600'
      case 'PUT': return 'text-amber-600'
      case 'PATCH': return 'text-orange-600'
      case 'DELETE': return 'text-red-600'
      default: return 'text-text-muted'
    }
  }

  const getStatusColor = (status: number) => {
    if (status === 0) return 'text-red-600 bg-red-50'
    if (status < 300) return 'text-emerald-600 bg-emerald-50'
    if (status < 400) return 'text-amber-600 bg-amber-50'
    return 'text-red-600 bg-red-50'
  }

  let pathname = ''
  try {
    pathname = new URL(request.url).pathname
  } catch {
    pathname = request.url
  }

  return (
    <div className={`flex items-stretch transition-colors ${
      isSelected ? 'bg-accent-light' : 'hover:bg-hover'
    } ${isPinned ? 'border-l-2 border-l-[var(--color-accent)]' : ''}`}>
      {groupSelectionMode && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleGroupSelect?.(); }}
          className={`px-2 flex items-center transition-colors ${
            isGroupSelected ? 'text-[var(--color-accent)]' : 'text-text-muted hover:text-[var(--color-accent)]'
          }`}
        >
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
            isGroupSelected ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' : 'border-current'
          }`}>
            {isGroupSelected && <Check className="w-3 h-3 text-white" />}
          </div>
        </button>
      )}
      {compareMode && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleCompare?.(); }}
          className={`px-2 flex items-center transition-colors ${
            isCompareSelected ? 'text-blue-500' : 'text-text-muted hover:text-blue-400'
          }`}
          title={isCompareSelected ? 'Remove from comparison' : 'Add to comparison'}
        >
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
            isCompareSelected ? 'bg-blue-500 border-blue-500' : 'border-current'
          }`}>
            {isCompareSelected && <Check className="w-3 h-3 text-white" />}
          </div>
        </button>
      )}
      <button
        onClick={onClick}
        className="flex-1 px-4 py-3 text-left min-w-0"
      >
        <div className="flex items-center gap-2 mb-1">
          {isPinned && (
            <Pin className="w-3 h-3 text-[var(--color-accent)] shrink-0" fill="currentColor" />
          )}
          <span className={`text-xs font-mono font-semibold ${getMethodColor(request.method)}`}>
            {request.method}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getStatusColor(request.status)}`}>
            {request.status || 'ERR'}
          </span>
          <span className={`text-[10px] flex items-center gap-0.5 ${isSlow ? 'text-amber-600' : 'text-text-muted'}`}>
            {isSlow && <Turtle className="w-3 h-3" />}
            {(request.duration / 1000).toFixed(2)}s
          </span>
          {responseSize > 0 && (
            <span className="text-[10px] text-text-muted">
              {formatBytes(responseSize)}
            </span>
          )}
          {request.mocked && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
              MOCKED
            </span>
          )}
          {isError && !request.mocked && (
            <span className="text-[10px] text-red-500">
              {request.error || request.statusText}
            </span>
          )}
        </div>
        <p className="text-xs font-mono text-text truncate">
          {pathname}
        </p>
        {tags && tags.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5">
            {tags.map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: tag.color + '20', color: tag.color }}
              >
                <Tag className="w-2 h-2" />
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </button>
      {onTogglePin && (
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          className={`px-2 flex items-center transition-colors ${
            isPinned ? 'text-[var(--color-accent)]' : 'text-text-muted hover:text-[var(--color-accent)]'
          }`}
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          <Pin className="w-3.5 h-3.5" fill={isPinned ? 'currentColor' : 'none'} />
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        className={`px-2 flex items-center transition-colors ${
          isFavorite ? 'text-amber-500' : 'text-text-muted hover:text-amber-400'
        }`}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star className="w-3.5 h-3.5" fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}
