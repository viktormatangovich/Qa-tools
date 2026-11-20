import { ChevronDown, FolderOpen } from 'lucide-react';
import { useMemo, useState, type RefObject } from 'react';
import type { ApiRequest, RequestMeta, RequestTag } from '../../types';
import { VirtualRows } from '../common/VirtualRows';
import { RequestRow } from './RequestRow';

type Item = { kind: 'header'; domain: string; count: number; collapsed: boolean } | { kind: 'row'; request: ApiRequest };

interface RequestListProps {
  mode: 'list' | 'grouped';
  /** Sorted list (list mode). */
  requests: ApiRequest[];
  /** Requests by domain (grouped mode). */
  groupedRequests: Record<string, ApiRequest[]>;
  scrollRef: RefObject<HTMLElement | null>;
  selectedId: string | null;
  favorites: string[];
  requestMeta: Record<string, RequestMeta>;
  tags: RequestTag[];
  compareMode: boolean;
  compareIds: Array<string | undefined>;
  groupSelectionMode: boolean;
  selectedIds: Set<string>;
  contractStatusByRequest: Map<string, 'passed' | 'failed' | 'undocumented' | undefined>;
  isWatched: (request: ApiRequest) => boolean;
  onSelect: (request: ApiRequest) => void;
  onToggleFavorite: (id: string) => void;
  onToggleCompare: (request: ApiRequest) => void;
  onToggleGroupSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
}

/** The request list, flat or grouped by domain; long lists render only the visible rows. */
export function RequestList(props: RequestListProps) {
  const { mode, requests, groupedRequests, requestMeta, tags } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const items = useMemo<Item[]>(() => {
    if (mode === 'list') return requests.map((request) => ({ kind: 'row', request }));
    const list: Item[] = [];
    for (const domain of Object.keys(groupedRequests).sort()) {
      const group = groupedRequests[domain];
      const isCollapsed = collapsed.has(domain);
      list.push({ kind: 'header', domain, count: group.length, collapsed: isCollapsed });
      if (!isCollapsed) for (const request of group) list.push({ kind: 'row', request });
    }
    return list;
  }, [mode, requests, groupedRequests, collapsed]);

  const toggleGroup = (domain: string) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(domain)) next.delete(domain);
    else next.add(domain);
    return next;
  });

  const renderItem = (item: Item) => {
    if (item.kind === 'header') {
      return (
        <button
          onClick={() => toggleGroup(item.domain)}
          aria-expanded={!item.collapsed}
          className="w-full flex items-center gap-2 px-4 py-2.5 bg-surface hover:bg-hover transition-colors"
        >
          <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${item.collapsed ? '-rotate-90' : ''}`} />
          <FolderOpen className="w-4 h-4 text-accent" />
          <span className="flex-1 text-left text-sm font-medium truncate">{item.domain}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-hover text-text-muted">{item.count}</span>
        </button>
      );
    }
    const request = item.request;
    const meta = requestMeta[request.id];
    return (
      <RequestRow
        request={request}
        isSelected={props.selectedId === request.id}
        isFavorite={props.favorites.includes(request.id)}
        isPinned={meta?.pinned || false}
        note={meta?.notes}
        isWatched={props.isWatched(request)}
        tags={meta?.tags?.map((id) => tagById.get(id)).filter((tag): tag is RequestTag => !!tag)}
        compareMode={props.compareMode}
        isCompareSelected={props.compareIds.includes(request.id)}
        groupSelectionMode={props.groupSelectionMode}
        isGroupSelected={props.selectedIds.has(request.id)}
        onClick={() => props.onSelect(request)}
        onToggleFavorite={() => props.onToggleFavorite(request.id)}
        onToggleCompare={() => props.onToggleCompare(request)}
        onToggleGroupSelect={() => props.onToggleGroupSelect(request.id)}
        onTogglePin={() => props.onTogglePin(request.id)}
        contractStatus={props.contractStatusByRequest.get(request.id)}
      />
    );
  };

  return (
    <VirtualRows
      items={items}
      keyOf={(item) => (item.kind === 'header' ? `group:${item.domain}` : item.request.id)}
      estimateHeight={(item) => (item.kind === 'header' ? 41 : 62)}
      render={renderItem}
      scrollRef={props.scrollRef}
      className="divide-y divide-[var(--color-border)]"
    />
  );
}
