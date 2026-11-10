import { useCallback, useEffect, useState } from 'react';
import { defaultJiraSettings } from '../qa/jira';
import type { JiraSettings } from '../types';
import { loadStored, saveStored } from '../utils/storage';

/**
 * Connection to Jira for creating issues from a bug report. Kept in extension storage on this
 * device only; the token is not included in the settings export.
 */
export function useJiraSettings() {
  const [jiraSettings, setJiraSettings] = useState<JiraSettings>(defaultJiraSettings);

  useEffect(() => {
    void loadStored(['jiraSettings']).then((stored) => {
      if (stored.jiraSettings) setJiraSettings({ ...defaultJiraSettings, ...stored.jiraSettings });
    });
  }, []);

  const saveJiraSettings = useCallback((settings: JiraSettings) => {
    setJiraSettings(settings);
    saveStored({ jiraSettings: settings });
  }, []);

  return { jiraSettings, saveJiraSettings };
}
