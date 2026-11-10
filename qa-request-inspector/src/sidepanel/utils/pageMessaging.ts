// content.js is not declared in the manifest: it is injected into a page only when a feature
// needs it (DOM search, highlight, accessibility checks, step recording), so ordinary browsing
// carries no script.

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function injectFiles(tabId: number, files: string[]): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files });
  } catch {
    // Some frame refused the script: the top frame alone is enough.
    await chrome.scripting.executeScript({ target: { tabId }, files });
  }
}

interface SendOptions {
  /**
   * Deliver to every frame (start/stop of step recording). By default only the top frame gets the
   * message: with several frames listening, whichever answers first would win.
   */
  allFrames?: boolean;
  /** Extension files to inject before sending, e.g. the axe-core library. */
  inject?: string[];
}

/**
 * Sends a message to the content script of the active tab of this window, injecting the script
 * first if the page does not have it yet. Rejects on browser pages, where injection is not allowed.
 */
export async function sendToPage<T>(message: Record<string, unknown>, options: SendOptions = {}): Promise<T | undefined> {
  const tabId = await activeTabId();
  if (tabId === undefined) return undefined;
  const target = options.allFrames ? undefined : { frameId: 0 };
  const send = () =>
    (target ? chrome.tabs.sendMessage(tabId, message, target) : chrome.tabs.sendMessage(tabId, message)) as Promise<T>;

  if (options.inject?.length) await injectFiles(tabId, options.inject);
  try {
    return await send();
  } catch {
    await injectFiles(tabId, ['content.js']);
    return await send();
  }
}
