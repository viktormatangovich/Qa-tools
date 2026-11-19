import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiRequest, ConsoleError, PausedRequest } from '../types';
import { withGraphql } from '../utils/graphql';

export type DebuggerStatus = 'attached' | 'detached' | 'error';
export type { PausedRequest };

/** What the list shows instead of live capture: a saved session or an imported file. */
export interface Snapshot { kind: 'session' | 'har'; name: string }

/** Edited request (url, method, headers, postData) or response (status, headers, body) sent on resume. */
export interface PausedOverrides {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  postData?: string;
  status?: number;
  body?: string;
}

const MAX_CONSOLE_ERRORS = 50;
const MAX_RECONNECT_ATTEMPTS = 3;
/** Mirrors BODY_KEEP_COUNT in public/captureStore.js: older requests lose their bodies. */
const BODY_KEEP_COUNT = 200;
const BODY_DROPPED = '[Тело удалено: хранятся тела только последних 200 запросов]';

function dropBodies(request: ApiRequest): ApiRequest {
  const hasRequestBody = request.requestBody != null && request.requestBody !== BODY_DROPPED;
  const hasResponseBody = request.responseBody != null && request.responseBody !== BODY_DROPPED;
  if (!hasRequestBody && !hasResponseBody) return request;
  return {
    ...request,
    requestBody: hasRequestBody ? BODY_DROPPED : request.requestBody,
    responseBody: hasResponseBody ? BODY_DROPPED : request.responseBody,
  };
}

function prepend(previous: ApiRequest[], request: ApiRequest, limit: number): ApiRequest[] {
  const next = [request, ...previous].slice(0, limit);
  if (next.length > BODY_KEEP_COUNT) next[BODY_KEEP_COUNT] = dropBodies(next[BODY_KEEP_COUNT]);
  return next;
}

/**
 * Connection to the background service worker for this browser window: captured requests,
 * console errors, debugger status and breakpoints.
 *
 * Messages arrive over a port named `sidepanel:<windowId>`, so panels in other windows never
 * see them. `onTabChanged` is called when the window starts capturing a different tab.
 * `maxRequests` is the per-tab limit from the capture settings.
 */
/** `onPickCommand`: the keyboard shortcut of the element picker was pressed in this window. */
export function useCapture(onTabChanged: () => void, maxRequests: number, onPickCommand?: () => void) {
  const onPickCommandRef = useRef(onPickCommand);
  onPickCommandRef.current = onPickCommand;
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [consoleErrors, setConsoleErrors] = useState<ConsoleError[]>([]);
  const [debuggerStatus, setDebuggerStatus] = useState<DebuggerStatus>('detached');
  const [debuggerError, setDebuggerError] = useState<string | null>(null);
  const [pausedRequests, setPausedRequests] = useState<PausedRequest[]>([]);
  const [capturedTabId, setCapturedTabId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const portRef = useRef<chrome.runtime.Port | null>(null);
  const windowIdRef = useRef<number | null>(null); // browser window this panel belongs to
  const capturedTabRef = useRef<number | null>(null); // tab whose requests are shown
  const connectTokenRef = useRef<object | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const onTabChangedRef = useRef(onTabChanged);
  const maxRequestsRef = useRef(maxRequests);
  const snapshotRef = useRef<Snapshot | null>(null); // while set, live requests do not touch the list
  useEffect(() => {
    onTabChangedRef.current = onTabChanged;
  }, [onTabChanged]);
  useEffect(() => {
    maxRequestsRef.current = maxRequests;
    if (!snapshotRef.current) setRequests((previous) => (previous.length > maxRequests ? previous.slice(0, maxRequests) : previous));
  }, [maxRequests]);

  const handleBackgroundMessage = useCallback((message: Record<string, unknown>) => {
    switch (message.type) {
      case 'TAB_SNAPSHOT': {
        // Sent after connecting, after every tab switch and when a navigation clears the log:
        // everything captured for the tab so far.
        const tabId = message.tabId as number;
        const tabChanged = capturedTabRef.current !== tabId;
        if (tabChanged) {
          if (capturedTabRef.current !== null) {
            setPausedRequests([]);
            onTabChangedRef.current();
          }
          capturedTabRef.current = tabId;
          setCapturedTabId(tabId);
          snapshotRef.current = null;
          setSnapshot(null);
        }
        if (!snapshotRef.current) setRequests((message.requests as ApiRequest[]).map(withGraphql));
        setConsoleErrors(message.errors as ConsoleError[]);
        break;
      }
      case 'NEW_API_REQUEST':
        // A loaded session or an imported file stays as it is; the background keeps capturing.
        if (snapshotRef.current) break;
        setRequests((previous) => prepend(previous, withGraphql(message.payload as ApiRequest), maxRequestsRef.current));
        break;
      case 'NEW_CONSOLE_ERROR':
        setConsoleErrors((previous) => [message.payload as ConsoleError, ...previous].slice(0, MAX_CONSOLE_ERRORS));
        break;
      case 'DEBUGGER_STATUS': {
        const status = message.status as DebuggerStatus;
        setDebuggerStatus(status);
        if (status === 'attached') reconnectAttemptsRef.current = 0;
        else setPausedRequests([]); // a detached debugger releases every paused request
        setDebuggerError(status === 'error' ? (message.error as string) : null);
        break;
      }
      case 'BREAKPOINT_REQUEST_PAUSED': {
        const request = message.request as { url: string; method: string; headers?: Record<string, string>; postData?: string | null };
        const paused: PausedRequest = {
          requestId: message.requestId as string,
          tabId: message.tabId as number,
          stage: message.stage === 'response' ? 'response' : 'request',
          url: request.url,
          method: request.method,
          headers: request.headers || {},
          postData: request.postData ?? null,
          response: message.response as PausedRequest['response'],
        };
        setPausedRequests((previous) => [...previous.filter((item) => item.requestId !== paused.requestId), paused]);
        break;
      }
      case 'BREAKPOINT_REQUEST_EXPIRED':
        setPausedRequests((previous) => previous.filter((item) => item.requestId !== message.requestId));
        break;
      case 'PICK_ELEMENT_COMMAND':
        onPickCommandRef.current?.();
        break;
    }
  }, []);

  // Connecting triggers debugger attach for the active tab of this window.
  const connect = useCallback(async (): Promise<void> => {
    const token = {};
    connectTokenRef.current = token;
    clearTimeout(reconnectTimerRef.current);
    portRef.current?.disconnect();
    portRef.current = null;

    if (windowIdRef.current === null) {
      try {
        windowIdRef.current = (await chrome.windows.getCurrent()).id ?? null;
      } catch {
        windowIdRef.current = null;
      }
      if (connectTokenRef.current !== token) return; // unmounted or superseded while waiting
    }

    const windowId = windowIdRef.current;
    const port = chrome.runtime.connect({ name: windowId === null ? 'sidepanel' : `sidepanel:${windowId}` });
    portRef.current = port;
    port.onMessage.addListener(handleBackgroundMessage);
    port.onDisconnect.addListener(() => {
      if (portRef.current !== port) return; // replaced by a newer connection
      portRef.current = null;
      setDebuggerStatus('detached');
      setPausedRequests([]);
      // The service worker was restarted: reconnect, a few times at most.
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => void connect(), 500);
      }
    });
  }, [handleBackgroundMessage]);

  useEffect(() => {
    void connect();
    return () => {
      connectTokenRef.current = null;
      clearTimeout(reconnectTimerRef.current);
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, [connect]);

  const reconnectDebugger = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    void connect();
  }, [connect]);

  /** Answers a paused request; `overrides` sends the edited request or response instead of the original. */
  const resumePausedRequest = useCallback((paused: PausedRequest, action: 'continue' | 'cancel', overrides?: PausedOverrides) => {
    void chrome.runtime.sendMessage({
      type: 'RESUME_PAUSED_REQUEST',
      requestId: paused.requestId,
      tabId: paused.tabId,
      action,
      ...(overrides ? { overrides } : {}),
    });
    setPausedRequests((previous) => previous.filter((item) => item.requestId !== paused.requestId));
  }, []);

  const clearRequests = useCallback(() => {
    setRequests([]);
    if (snapshotRef.current) return; // a snapshot is only a view: captured data stays in the background
    void chrome.runtime.sendMessage({ type: 'CLEAR_API_REQUESTS', windowId: windowIdRef.current });
  }, []);

  const clearConsoleErrors = useCallback(() => {
    setConsoleErrors([]);
    void chrome.runtime.sendMessage({ type: 'CLEAR_CONSOLE_ERRORS', windowId: windowIdRef.current });
  }, []);

  /** Replaces the list both here and in the background, e.g. after deleting selected requests. */
  const replaceRequests = useCallback((remaining: ApiRequest[]) => {
    setRequests(remaining);
    if (snapshotRef.current) return;
    void chrome.runtime.sendMessage({ type: 'SET_API_REQUESTS', windowId: windowIdRef.current, payload: remaining });
  }, []);

  /** Shows a list that is not live capture (a saved session, an imported HAR file). */
  const showSnapshot = useCallback((list: ApiRequest[], source: Snapshot) => {
    snapshotRef.current = source;
    setSnapshot(source);
    setRequests(list.map(withGraphql));
  }, []);

  /** Leaves the snapshot and shows what the background captured meanwhile. */
  const returnToCapture = useCallback(() => {
    snapshotRef.current = null;
    setSnapshot(null);
    chrome.runtime.sendMessage({ type: 'GET_API_REQUESTS', windowId: windowIdRef.current }, (response) => {
      if (chrome.runtime.lastError || snapshotRef.current) return;
      setRequests(((response?.requests as ApiRequest[]) || []).map(withGraphql));
    });
  }, []);

  /** PNG screenshot of the captured tab as a data URL. */
  const captureScreenshot = useCallback(async (fullPage: boolean): Promise<string> => {
    const response = (await chrome.runtime.sendMessage({
      type: 'CAPTURE_SCREENSHOT',
      windowId: windowIdRef.current,
      fullPage,
    })) as { success?: boolean; dataUrl?: string; error?: string } | undefined;
    if (!response?.success || !response.dataUrl) throw new Error(response?.error || 'screenshot failed');
    return response.dataUrl;
  }, []);

  return {
    requests,
    consoleErrors,
    debuggerStatus,
    debuggerError,
    pausedRequests,
    capturedTabId,
    snapshot,
    reconnectDebugger,
    resumePausedRequest,
    clearRequests,
    clearConsoleErrors,
    replaceRequests,
    showSnapshot,
    returnToCapture,
    captureScreenshot,
  };
}
