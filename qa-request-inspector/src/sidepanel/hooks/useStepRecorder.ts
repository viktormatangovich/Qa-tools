import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../locales';
import { stepText, type ManualStep, type RecordedAction } from '../qa/teamTools';
import { sendToPage } from '../utils/pageMessaging';

const MAX_RECORDED_STEPS = 200;

/**
 * Records clicks and input on the captured page as reproduction steps.
 *
 * The content script reports each action; a navigation is added as its own step and the recorder
 * is started again in the new document. `linkRequestIds` returns the ids of requests captured
 * since the previous step, so a step knows which requests it caused.
 */
export function useStepRecorder(capturedTabId: number | null, linkRequestIds: (since: number) => string[]) {
  const [recording, setRecording] = useState(false);
  const [steps, setSteps] = useState<ManualStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tabRef = useRef(capturedTabId);
  const linkRef = useRef(linkRequestIds);
  const lastUrlRef = useRef('');
  useEffect(() => {
    tabRef.current = capturedTabId;
    linkRef.current = linkRequestIds;
  }, [capturedTabId, linkRequestIds]);

  const addStep = useCallback((action: RecordedAction) => {
    setSteps((previous) => {
      if (previous.length >= MAX_RECORDED_STEPS) return previous;
      // Requests are attached to the step that came before them.
      const last = previous[previous.length - 1];
      const linked = last ? previous.slice(0, -1).concat({ ...last, requestIds: linkRef.current(last.timestamp) }) : previous;
      return [...linked, { id: crypto.randomUUID(), text: stepText(action, t().stepWords), timestamp: Date.now(), requestIds: [], action }];
    });
  }, []);

  useEffect(() => {
    if (!recording) return;

    const onMessage = (message: { type?: string; action?: RecordedAction }, sender: chrome.runtime.MessageSender) => {
      if (message?.type !== 'RECORDED_STEP' || !message.action) return;
      if (tabRef.current !== null && sender.tab?.id !== tabRef.current) return;
      if (message.action.pageUrl && sender.frameId === 0) lastUrlRef.current = message.action.pageUrl;
      addStep(message.action);
    };

    // A navigation unloads the content script: note the new page and start recording there again.
    const onUpdated = (tabId: number, changeInfo: { status?: string; url?: string }, tab: chrome.tabs.Tab) => {
      if (tabId !== tabRef.current) return;
      if (changeInfo.status === 'complete') {
        const url = tab.url || '';
        if (url && url !== lastUrlRef.current) {
          lastUrlRef.current = url;
          addStep({ kind: 'navigate', url, pageUrl: url, timestamp: Date.now() });
        }
        void sendToPage({ type: 'START_STEP_RECORDING' }, { allFrames: true }).catch(() => {});
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [recording, addStep]);

  const start = useCallback(async () => {
    setError(null);
    try {
      await sendToPage({ type: 'START_STEP_RECORDING' }, { allFrames: true });
      const tab = tabRef.current !== null ? await chrome.tabs.get(tabRef.current).catch(() => null) : null;
      lastUrlRef.current = tab?.url || '';
      setSteps(lastUrlRef.current ? [{
        id: crypto.randomUUID(),
        text: stepText({ kind: 'navigate', url: lastUrlRef.current }, t().stepWords),
        timestamp: Date.now(),
        requestIds: [],
        action: { kind: 'navigate', url: lastUrlRef.current, pageUrl: lastUrlRef.current, timestamp: Date.now() },
      }] : []);
      setRecording(true);
    } catch {
      // Browser pages (chrome://, the Web Store) do not accept scripts.
      setError(t().recorderUnavailable);
    }
  }, []);

  const stop = useCallback(() => {
    setRecording(false);
    setSteps((previous) => {
      const last = previous[previous.length - 1];
      return last ? previous.slice(0, -1).concat({ ...last, requestIds: linkRef.current(last.timestamp) }) : previous;
    });
    void sendToPage({ type: 'STOP_STEP_RECORDING' }, { allFrames: true }).catch(() => {});
  }, []);

  const clear = useCallback(() => setSteps([]), []);

  return { recording, steps, error, start, stop, clear };
}

export type StepRecorder = ReturnType<typeof useStepRecorder>;
