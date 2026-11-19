import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Loader2, Eye, Search, X } from 'lucide-react'
import type { UsageResult, ScanStatus } from '../../types'
import { JsonTreeNode } from './JsonTreeNode'
import { t } from '../../locales'
import { searchJson } from '../../utils/jsonSearch'

interface JsonTreeViewProps {
  data: unknown
  usageCache?: Map<string, UsageResult>
  // Field usage on the page (response only): without onScan the scan controls are not shown.
  onHighlight?: (path: string, value: unknown) => void
  onScan?: () => void
  scanStatus?: ScanStatus
  progress?: { scanned: number; total: number }
  /** Placeholder of the search field. */
  searchPlaceholder?: string
  searchQuery?: string
  onSearchChange?: (query: string) => void
  /** A node to open and scroll to (a match of the element picker). */
  focus?: { path: string; ancestors: string[] } | null
}

export function JsonTreeView({
  data,
  usageCache,
  onHighlight,
  onScan,
  scanStatus,
  progress = { scanned: 0, total: 0 },
  searchPlaceholder,
  searchQuery = '',
  onSearchChange,
  focus,
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

  const search = useMemo(() => searchJson(data, searchQuery), [data, searchQuery])
  const matchCount = search.paths.length

  // A match inside a collapsed object is not rendered, so it could be neither seen nor reached
  // with Enter: open its parents whenever the query or the response changes. Done during render
  // (not in an effect) so that the scroll effect below already finds the opened nodes.
  const [expandedFor, setExpandedFor] = useState(search)
  if (expandedFor !== search) {
    setExpandedFor(search)
    if (search.ancestors.size > 0) {
      setExpandedPaths(prev => {
        const next = new Set(prev)
        search.ancestors.forEach(path => next.add(path))
        return next
      })
    }
  }

  // Open the parents of the focused node during render, like for search matches above.
  const [expandedForFocus, setExpandedForFocus] = useState(focus)
  if (expandedForFocus !== focus) {
    setExpandedForFocus(focus)
    if (focus) {
      setExpandedPaths(prev => {
        const next = new Set(prev)
        focus.ancestors.forEach(path => next.add(path))
        return next
      })
    }
  }

  const treeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!focus || !treeRef.current) return
    const row = treeRef.current.querySelector(`[data-json-path="${CSS.escape(focus.path)}"]`) as HTMLElement | null
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    row.classList.add('ring-2', 'ring-accent', 'bg-accent-light')
    return () => row.classList.remove('ring-2', 'ring-accent', 'bg-accent-light')
  }, [focus])
  const [focusedMatchIndex, setFocusedMatchIndex] = useState(0)

  // Scroll to the first match when search query changes
  useEffect(() => {
    if (!searchQuery.trim() || !treeRef.current) return
    // Opened by the element picker: Enter continues from the picked field, which the focus effect
    // has already scrolled to, instead of jumping to the first match.
    const focusIndex = focus ? search.paths.indexOf(focus.path) : -1
    setFocusedMatchIndex(Math.max(0, focusIndex))
    if (focusIndex >= 0) return
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
          placeholder={searchPlaceholder ?? t().searchInResponse}
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
        {onScan && (
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
              {t().scanningProgress(progress.scanned, progress.total)}
            </>
          ) : (
            <>
              <Eye className="w-3 h-3" />
              {scanStatus === 'complete' ? t().rescanDom : t().findInDom}
            </>
          )}
        </button>
        )}

        {scanStatus === 'complete' && usageCache && (
          <span className="text-[10px] text-text-muted">
            {t().fieldsFoundOnPage(Array.from(usageCache.values()).filter(u => u.count > 0).length)}
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
        aria-label={t().jsonTreeLabel}
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
