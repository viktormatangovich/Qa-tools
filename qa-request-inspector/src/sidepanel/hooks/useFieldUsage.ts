import { useState, useEffect, useCallback, useRef } from 'react'
import type { UsageResult } from '../types'
import { sendToPage } from '../utils/pageMessaging'

export function useFieldUsage(data: unknown) {
  const [usageCache, setUsageCache] = useState<Map<string, UsageResult>>(new Map())
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'complete'>('idle')
  const [progress, setProgress] = useState({ scanned: 0, total: 0 })
  const cancelledRef = useRef(false)

  // Extract all leaf values from JSON
  const extractLeafValues = useCallback((obj: unknown, path: string = 'root'): Array<{ path: string; value: unknown }> => {
    const results: Array<{ path: string; value: unknown }> = []

    if (obj === null || obj === undefined) {
      return results
    }

    if (typeof obj !== 'object') {
      // Leaf value - only include strings and numbers that are meaningful
      if (typeof obj === 'string' && obj.length >= 2) {
        results.push({ path, value: obj })
      } else if (typeof obj === 'number') {
        results.push({ path, value: obj })
      }
      return results
    }

    // Traverse object/array
    Object.entries(obj as object).forEach(([key, value]) => {
      const childPath = `${path}.${key}`
      results.push(...extractLeafValues(value, childPath))
    })

    return results
  }, [])

  // Scan all fields in DOM
  const scanAllFields = useCallback(async () => {
    if (!data) return

    cancelledRef.current = false
    setScanStatus('scanning')
    setUsageCache(new Map())

    const leafValues = extractLeafValues(data)
    console.log('[Reqpane] Extracted leaf values:', leafValues.length, leafValues.slice(0, 5))
    setProgress({ scanned: 0, total: leafValues.length })

    if (leafValues.length === 0) {
      console.log('[Reqpane] No leaf values to scan')
      setScanStatus('complete')
      return
    }

    const newCache = new Map<string, UsageResult>()
    const BATCH_SIZE = 15

    // Process in batches
    for (let i = 0; i < leafValues.length; i += BATCH_SIZE) {
      if (cancelledRef.current) return

      const batch = leafValues.slice(i, i + BATCH_SIZE)

      try {
        // The content script is injected into the page on first use.
        const results = await sendToPage<Record<string, UsageResult>>({
          type: 'BATCH_SEARCH_DOM',
          values: batch,
        })

        // Store results
        Object.entries(results ?? {}).forEach(([path, result]) => {
          newCache.set(path, result)
        })
      } catch (err) {
        // Content script might not be ready, set empty results
        console.error('[Reqpane] Error sending message:', err)
        batch.forEach(({ path }) => {
          newCache.set(path, { count: 0, elements: [] })
        })
      }

      setProgress({ scanned: Math.min(i + BATCH_SIZE, leafValues.length), total: leafValues.length })
      setUsageCache(new Map(newCache))

      // Small delay to prevent UI blocking
      await new Promise(r => setTimeout(r, 10))
    }

    setScanStatus('complete')
  }, [data, extractLeafValues])

  // Highlight specific field in page
  const highlightField = useCallback(async (path: string, value: unknown) => {
    const usage = usageCache.get(path)
    if (!usage || usage.count === 0) return

    try {
      await sendToPage({
        type: 'HIGHLIGHT_ELEMENTS',
        elements: usage.elements,
        label: path.split('.').pop() || String(value),
      })
    } catch (err) {
      console.warn('Failed to highlight:', err)
    }
  }, [usageCache])

  // Clear highlights from page
  const clearHighlights = useCallback(async () => {
    try {
      await sendToPage({ type: 'CLEAR_HIGHLIGHTS' })
    } catch {
      // Ignore
    }
  }, [])

  // Clear cache and cancel ongoing scan when data changes
  useEffect(() => {
    cancelledRef.current = true
    setUsageCache(new Map())
    setScanStatus('idle')
    setProgress({ scanned: 0, total: 0 })
  }, [data])

  return {
    usageCache,
    scanStatus,
    progress,
    scanAllFields,
    highlightField,
    clearHighlights,
  }
}
