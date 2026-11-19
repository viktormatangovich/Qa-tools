import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiRequest } from '../types'
import { sendToPage } from '../utils/pageMessaging'
import { explainChange, type WatchedChange } from '../utils/valueFinder'

const MAX_CHANGES = 20
/** Wait for the capture to report the request that triggered the change before explaining it. */
const SETTLE_MS = 700

/**
 * Watching the picked element (content.js ElementWatcher): each change of its text is matched
 * against the requests finished since the previous change, so the panel can tell which request
 * brought the new value, or that none did and the page computed it itself.
 */
export function useElementWatch(requests: ApiRequest[], tabId: number | null) {
  const [active, setActive] = useState(false)
  const [initialText, setInitialText] = useState<string | null>(null)
  const [changes, setChanges] = useState<WatchedChange[]>([])
  const [error, setError] = useState<string | null>(null)
  const requestsRef = useRef(requests)
  requestsRef.current = requests
  const sinceRef = useRef(0)

  const stop = useCallback(() => {
    setActive(false)
    void sendToPage({ type: 'STOP_ELEMENT_WATCH' }, { allFrames: true }).catch(() => {})
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      // Every frame gets the message; only the one holding the picked element answers.
      const reply = await sendToPage<{ text: string }>({ type: 'START_ELEMENT_WATCH' }, { allFrames: true })
      if (!reply) throw new Error('no element')
      sinceRef.current = Date.now()
      setInitialText(reply.text)
      setChanges([])
      setActive(true)
    } catch {
      setError('pick-again')
      setActive(false)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const onMessage = (message: { type?: string; at?: number; from?: string | null; to?: string | null }, sender: chrome.runtime.MessageSender) => {
      if (message?.type !== 'ELEMENT_WATCH_CHANGED' || typeof message.at !== 'number') return
      if (tabId !== null && sender.tab?.id !== tabId) return
      const change = { at: message.at, from: message.from ?? null, to: message.to ?? null }
      const since = sinceRef.current
      sinceRef.current = change.at
      const timer = setTimeout(() => {
        timers.delete(timer)
        const explained = explainChange(requestsRef.current, change, since - 1000)
        setChanges((previous) => [explained, ...previous].slice(0, MAX_CHANGES))
      }, SETTLE_MS)
      timers.add(timer)
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
      timers.forEach(clearTimeout)
    }
  }, [active, tabId])

  // A page left watching after the panel closes only costs a MutationObserver until it reloads,
  // but stop it anyway when the panel goes away.
  useEffect(() => () => {
    void sendToPage({ type: 'STOP_ELEMENT_WATCH' }, { allFrames: true }).catch(() => {})
  }, [])

  return { active, initialText, changes, error, start, stop }
}
