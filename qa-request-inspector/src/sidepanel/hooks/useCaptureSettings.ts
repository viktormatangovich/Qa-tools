import { useCallback, useEffect, useState } from 'react';
import type { CaptureSettings } from '../types';
import { loadStored, saveStored } from '../utils/storage';

/** Defaults and limits mirror public/captureStore.js, which validates the stored value for the background. */
export const defaultCaptureSettings: CaptureSettings = {
  preserveLog: false,
  maxRequests: 100,
  captureAllResources: false,
  throttle: 'none',
  customLatencyMs: 300,
  customDownloadKbps: 1000,
  customUploadKbps: 500,
};
export const MIN_REQUESTS = 50;
export const MAX_REQUESTS = 1000;

/**
 * Capture settings: preserve log, request limit, resource types, network throttling.
 * The background reads them from storage and reacts to changes, so saving is all it takes.
 */
export function useCaptureSettings() {
  const [captureSettings, setCaptureSettings] = useState<CaptureSettings>(defaultCaptureSettings);

  useEffect(() => {
    void loadStored(['captureSettings']).then((stored) => {
      if (stored.captureSettings) setCaptureSettings({ ...defaultCaptureSettings, ...stored.captureSettings });
    });
  }, []);

  const updateCaptureSettings = useCallback((patch: Partial<CaptureSettings>) => {
    setCaptureSettings((previous) => {
      const next = { ...previous, ...patch };
      next.maxRequests = Math.min(MAX_REQUESTS, Math.max(MIN_REQUESTS, Math.round(next.maxRequests) || defaultCaptureSettings.maxRequests));
      saveStored({ captureSettings: next });
      return next;
    });
  }, []);

  return { captureSettings, updateCaptureSettings };
}
