import { useCallback, useEffect, useState } from 'react';
import { loadStored, saveStored } from '../utils/storage';
import { compareVersions } from '../utils/version';

/** Shows "What's new" once after an update (or the first start); it can be reopened from the palette. */
export function useWhatsNew() {
  const version = chrome.runtime.getManifest().version;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void loadStored(['lastSeenVersion']).then((stored) => {
      if (!stored.lastSeenVersion || compareVersions(version, stored.lastSeenVersion) > 0) setOpen(true);
    });
  }, [version]);

  const close = useCallback(() => {
    setOpen(false);
    saveStored({ lastSeenVersion: version });
  }, [version]);

  return { version, open, show: useCallback(() => setOpen(true), []), close };
}
