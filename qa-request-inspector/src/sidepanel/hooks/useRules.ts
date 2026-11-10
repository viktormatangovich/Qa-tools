import { useCallback, useEffect, useState } from 'react';
import type { BreakpointRule, MockRule } from '../types';

/** Mock and breakpoint rules. The background owns them: it stores the rules and applies interception. */
export function useRules() {
  const [mockRules, setMockRules] = useState<MockRule[]>([]);
  const [breakpointRules, setBreakpointRules] = useState<BreakpointRule[]>([]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_MOCK_RULES' }, (response) => {
      if (response?.rules) setMockRules(response.rules);
    });
    chrome.runtime.sendMessage({ type: 'GET_BREAKPOINT_RULES' }, (response) => {
      if (response?.rules) setBreakpointRules(response.rules);
    });
  }, []);

  const saveMockRules = useCallback((rules: MockRule[]) => {
    setMockRules(rules);
    void chrome.runtime.sendMessage({ type: 'SAVE_MOCK_RULES', payload: rules });
  }, []);

  const saveBreakpointRules = useCallback((rules: BreakpointRule[]) => {
    setBreakpointRules(rules);
    void chrome.runtime.sendMessage({ type: 'SAVE_BREAKPOINT_RULES', payload: rules });
  }, []);

  return { mockRules, breakpointRules, saveMockRules, saveBreakpointRules };
}
