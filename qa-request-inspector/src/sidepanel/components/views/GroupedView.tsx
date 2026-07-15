import { Collapsible } from '@base-ui-components/react/collapsible'
import { ChevronDown, FolderOpen } from 'lucide-react'
import type { ApiRequest, RequestTag } from '../../types'
import { RequestRow } from '../requests/RequestRow'

interface GroupedViewProps {
  groupedRequests: Record<string, ApiRequest[]>
  selectedRequest: ApiRequest | null
  favorites: string[]
  compareMode: boolean
  compareRequests: [ApiRequest | null, ApiRequest | null]
  groupSelectionMode?: boolean
  selectedIds?: Set<string>
  requestMeta?: Record<string, { pinned?: boolean; tags?: string[] }>
  tags?: RequestTag[]
  onSelect: (req: ApiRequest) => void
  onToggleFavorite: (id: string) => void
  onToggleCompare: (req: ApiRequest) => void
  onToggleGroupSelect?: (id: string) => void
  onTogglePin?: (id: string) => void
}

export function GroupedView({
  groupedRequests,
  selectedRequest,
  favorites,
  compareMode,
  compareRequests,
  groupSelectionMode = false,
  selectedIds = new Set(),
  requestMeta = {},
  tags = [],
  onSelect,
  onToggleFavorite,
  onToggleCompare,
  onToggleGroupSelect,
  onTogglePin,
}: GroupedViewProps) {
  const domains = Object.keys(groupedRequests).sort()

  return (
    <div className="divide-y divide-border">
      {domains.map(domain => (
        <Collapsible.Root key={domain} defaultOpen>
          <Collapsible.Trigger className="w-full flex items-center gap-2 px-4 py-2.5 bg-surface hover:bg-hover transition-colors">
            <ChevronDown className="w-4 h-4 text-text-muted [[data-state=closed]_&]:rotate-[-90deg] transition-transform" />
            <FolderOpen className="w-4 h-4 text-accent" />
            <span className="flex-1 text-left text-sm font-medium truncate">{domain}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-hover text-text-muted">
              {groupedRequests[domain].length}
            </span>
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <div className="divide-y divide-border">
              {groupedRequests[domain].map(req => (
                <RequestRow
                  key={req.id}
                  request={req}
                  isSelected={selectedRequest?.id === req.id}
                  isFavorite={favorites.includes(req.id)}
                  isPinned={requestMeta[req.id]?.pinned || false}
                  tags={requestMeta[req.id]?.tags?.map(tagId => tags.find(t => t.id === tagId)).filter(Boolean) as RequestTag[] | undefined}
                  compareMode={compareMode}
                  isCompareSelected={compareRequests[0]?.id === req.id || compareRequests[1]?.id === req.id}
                  groupSelectionMode={groupSelectionMode}
                  isGroupSelected={selectedIds.has(req.id)}
                  onClick={() => onSelect(req)}
                  onToggleFavorite={() => onToggleFavorite(req.id)}
                  onToggleCompare={() => onToggleCompare(req)}
                  onToggleGroupSelect={() => onToggleGroupSelect?.(req.id)}
                  onTogglePin={() => onTogglePin?.(req.id)}
                />
              ))}
            </div>
          </Collapsible.Panel>
        </Collapsible.Root>
      ))}
    </div>
  )
}
