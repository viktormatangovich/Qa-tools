import { useEffect, useState } from 'react'
import type { StreamMessage } from '../types'

/**
 * WebSocket/SSE messages of the captured tab, polled from the worker while `active` (the element
 * picker, its results or watching are in use). The worker keeps the last 200 per tab.
 */
export function useStreamMessages(active: boolean) {
  const [messages, setMessages] = useState<StreamMessage[]>([])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let windowId: number | undefined
    const poll = async () => {
      if (windowId === undefined) windowId = (await chrome.windows.getCurrent().catch(() => undefined))?.id
      chrome.runtime.sendMessage({ type: 'GET_STREAM_MESSAGES', windowId }, (response?: { messages?: StreamMessage[] }) => {
        if (!cancelled && !chrome.runtime.lastError) setMessages(response?.messages || [])
      })
    }
    void poll()
    const timer = setInterval(() => void poll(), 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active])

  return messages
}
