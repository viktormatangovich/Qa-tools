import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Loader2, Eye, Search, X } from 'lucide-react'
import type { UsageResult, ScanStatus } from '../../types'
import { JsonTreeNode } from './JsonTreeNode'
import { t } from '../../locales'

interface JsonTreeViewProps {
  data: unknown
  usageCache?: Map<string, UsageResult>
  onHighlight: (path: string, value: unknown) => void
  onScan: () => void
  scanStatus: ScanStatus
  progress: { scanned: number; total: number }
  searchQuery?: string
  onSearchChange?: (query: string) => void
}

export function JsonTreeView({
  data,
  usageCache,
  onHighlight,
  onScan,
  scanStatus,
  progress,
  searchQuery = '',
  onSearchChange,
}: JsonTreeViewProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['root']))

  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    const allPaths = new Set<string>(['root'])
    const traverse = (obj: unknown, path: string) => {
      if (obj && typeof obj === 'object') {
        allPaths.add(path)
        Object.entries(obj as object).forEach(([key, value]) => {
          traverse(value, `${path}.${key}`)
        })
      }
    }
    traverse(data, 'root')
    setExpandedPaths(allPaths)
  }, [data])

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set(['root']))
  }, [])

  const matchCount = useMemo(() => {
    if (!searchQuery.trim()) return 0
    const q = searchQuery.toLowerCase()
    let count = 0
    const traverse = (obj: unknown) => {
      if (obj && typeof obj === 'object') {
        Object.entries(obj as object).forEach(([, value]) => {
          if (String(value).toLowerCase().includes(q)) {
            count++
          }
          traverse(value)
        })
      }
    }
    traverse(data)
    return count
  }, [data, searchQuery])

  const treeRef = useRef<HTMLDivElement>(null)
  const [focusedMatchIndex, setFocusedMatchIndex] = useState(0)

  // Scroll to the first match when search query changes
  useEffect(() => {
    if (!searchQuery.trim() || !treeRef.current) return
    setFocusedMatchIndex(0)
    const firstMatch = treeRef.current.querySelector('[data-search-match="true"]') as HTMLElement | null
    if (firstMatch) {
      firstMatch.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [searchQuery])

  // Update focused match ring class
  useEffect(() => {
    if (!treeRef.current) return
    const matches = treeRef.current.querySelectorAll('[data-search-match="true"]') as NodeListOf<HTMLElement>
    matches.forEach((el, i) => {
      el.classList.toggle('ring-2', i === focusedMatchIndex)
      el.classList.toggle('ring-yellow-400', i === focusedMatchIndex)
      el.classList.toggle('dark:ring-yellow-600', i === focusedMatchIndex)
    })
  }, [focusedMatchIndex, searchQuery])

  // Navigate matches with Enter key
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !searchQuery.trim() || !treeRef.current) return
    e.preventDefault()
    const matches = treeRef.current.querySelectorAll('[data-search-match="true"]') as NodeListOf<HTMLElement>
    if (matches.length === 0) return

    let nextIndex: number
    if (e.shiftKey) {
      // Shift+Enter — previous match
      nextIndex = (focusedMatchIndex - 1 + matches.length) % matches.length
    } else {
      // Enter — next match
      nextIndex = (focusedMatchIndex + 1) % matches.length
    }
    setFocusedMatchIndex(nextIndex)
    matches[nextIndex].scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [searchQuery, focusedMatchIndex])

  return (
    <div className="space-y-2">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t().searchInResponse}
          className="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg bg-surface border border-border placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        {searchQuery && (
          <>
            <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">
              {matchCount > 0 ? `${focusedMatchIndex + 1}/${matchCount}` : matchCount}
            </span>
            <button
              onClick={() => onSearchChange?.('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onScan}
          disabled={scanStatus === 'scanning'}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors border ${
            scanStatus === 'scanning'
              ? 'border-blue-300 bg-blue-50 text-blue-600'
              : scanStatus === 'complete'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                : 'border-border hover:bg-hover'
          }`}
        >
          {scanStatus === 'scanning' ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Сканирование ({progress.scanned}/{progress.total})
            </>
          ) : (
            <>
              <Eye className="w-3 h-3" />
              {scanStatus === 'complete' ? t().rescanDom : t().findInDom}
            </>
          )}
        </button>

        {scanStatus === 'complete' && usageCache && (
          <span className="text-[10px] text-text-muted">
            {Array.from(usageCache.values()).filter(u => u.count > 0).length} полей найдено на странице
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={expandAll}
            className="px-2 py-1 text-[10px] text-text-muted hover:text-text hover:bg-hover rounded"
          >
            {t().expandAll}
          </button>
          <button
            onClick={collapseAll}
            className="px-2 py-1 text-[10px] text-text-muted hover:text-text hover:bg-hover rounded"
          >
            {t().collapse}
          </button>
        </div>
      </div>

      {/* Tree */}
      <div
        ref={treeRef}
        className="bg-bg rounded-lg border border-border p-3 font-mono text-xs overflow-auto max-h-[60vh]"
        role="tree"
        aria-label="JSON response tree"
      >
        <JsonTreeNode
          keyName={null}
          value={data}
          path="root"
          depth={0}
          expandedPaths={expandedPaths}
          toggleExpanded={toggleExpanded}
          usageCache={usageCache}
          onHighlight={onHighlight}
          searchQuery={searchQuery}
        />
      </div>
    </div>
  )
}
