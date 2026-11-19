import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../locales'
import type { ApiRequest } from '../types'
import { sendToPage } from '../utils/pageMessaging'
import { candidatesOf, findValueInRequests, partsOf, type PickedElement } from '../utils/valueFinder'

type PickResult = { element?: PickedElement; cancelled?: boolean }

const cancelEverywhere = () => sendToPage({ type: 'CANCEL_ELEMENT_PICK' }, { allFrames: true }).catch(() => {})

/**
 * Element picker on the inspected page (content.js ElementPicker): the page shows a frame under the
 * cursor, a click reports the element, Esc cancels. Every frame is armed, so elements inside
 * iframes can be picked too; the first frame that answers wins and the others are disarmed. While
 * picking, the page asks how many matches the hovered element has (PICKER_HOVER).
 */
export function useElementPicker(requests: ApiRequest[], tabId: number | null) {
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<PickedElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runRef = useRef(0)
  const pickingRef = useRef(false)
  pickingRef.current = picking
  const requestsRef = useRef(requests)
  requestsRef.current = requests

  const cancel = useCallback(() => {
    runRef.current += 1
    if (pickingRef.current) void cancelEverywhere()
    setPicking(false)
  }, [])

  /** Resolves with the picked element, or null when picking was cancelled or failed. */
  const start = useCallback(async (): Promise<PickedElement | null> => {
    const run = ++runRef.current
    setPicking(true)
    setError(null)
    try {
      // content.js guards against double injection: injecting again reaches frames loaded since.
      const result = await sendToPage<PickResult>({ type: 'START_ELEMENT_PICK' }, { allFrames: true, inject: ['content.js'] })
      void cancelEverywhere()
      if (run !== runRef.current || !result?.element) return null
      setPicked(result.element)
      return result.element
    } catch (err) {
      if (run === runRef.current) setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      if (run === runRef.current) setPicking(false)
    }
  }, [])

  // Hover hint: answer only for the tab this panel captures (another window has its own panel).
  useEffect(() => {
    if (!picking) return
    const onMessage = (
      message: { type?: string; element?: PickedElement },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: { label: string }) => void,
    ) => {
      if (message?.type !== 'PICKER_HOVER' || !message.element) return
      if (tabId !== null && sender.tab?.id !== tabId) return
      const element = message.element
      const matches = findValueInRequests(requestsRef.current, candidatesOf(element), { parts: partsOf(element), limit: 100 })
      sendResponse({ label: t().pickHoverMatches(matches.length) })
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [picking, tabId])

  // Leave the page unarmed when the panel goes away while picking.
  useEffect(() => () => {
    if (pickingRef.current) void cancelEverywhere()
  }, [])

  return { picking, picked, error, start, cancel, clear: () => setPicked(null) }
}
