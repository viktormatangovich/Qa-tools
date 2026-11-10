import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultQASettings, qaRulesEngine } from '../qa';
import type { DOMFinding, QAIssue, QASettings } from '../qa';
import { getLanguage } from '../locales';
import type { OpenApiDocument } from '../qa/contract/types';
import { CHECKS_COVERED_BY_AXE } from '../qa/rules/domRules';
import type { ApiRequest, ConsoleError } from '../types';
import { sendToPage } from '../utils/pageMessaging';
import { loadStored, saveStored } from '../utils/storage';

export type ContractStatus = 'passed' | 'failed' | 'undocumented' | undefined;

// The contract checker pulls in the YAML parser, so it is loaded only once a specification exists.
type ContractChecker = typeof import('../qa/contract/contractChecker');

/** QA Check: settings, rule results, OpenAPI contract validation and page (DOM) checks. */
export function useQaAnalysis(requests: ApiRequest[], consoleErrors: ConsoleError[]) {
  const [qaSettings, setQASettings] = useState<QASettings>(defaultQASettings);
  const [contractSpecText, setContractSpecText] = useState('');
  const [excludedQARuleIds, setExcludedQARuleIds] = useState<string[]>([]);
  const [dismissedQAIssueIds, setDismissedQAIssueIds] = useState<Set<string>>(() => new Set());
  const [domFindings, setDomFindings] = useState<DOMFinding[]>([]);
  const [domChecksLoading, setDomChecksLoading] = useState(false);
  const [checker, setChecker] = useState<ContractChecker | null>(null);

  useEffect(() => {
    void loadStored(['qaSettings', 'contractSpecText', 'excludedQARuleIds']).then((stored) => {
      if (stored.qaSettings) setQASettings({ ...defaultQASettings, ...stored.qaSettings });
      if (stored.contractSpecText) setContractSpecText(stored.contractSpecText);
      if (stored.excludedQARuleIds) setExcludedQARuleIds(stored.excludedQARuleIds);
    });
  }, []);

  const hasSpec = contractSpecText.trim().length > 0;
  useEffect(() => {
    if (!hasSpec || checker) return;
    let live = true;
    void import('../qa/contract/contractChecker').then((module) => {
      if (live) setChecker(module);
    });
    return () => {
      live = false;
    };
  }, [hasSpec, checker]);

  const { contractDocument, contractError } = useMemo<{ contractDocument: OpenApiDocument | null; contractError: string | null }>(() => {
    if (!hasSpec || !checker) return { contractDocument: null, contractError: null };
    try {
      return { contractDocument: checker.parseOpenApiSpec(contractSpecText), contractError: null };
    } catch (error) {
      return { contractDocument: null, contractError: (error as Error).message };
    }
  }, [checker, hasSpec, contractSpecText]);

  const contractEnabled = qaSettings.contractValidationEnabled;

  // The engine only runs when captured data changes, never during unrelated UI renders.
  const qaIssues = useMemo(() => {
    if (!qaSettings.autoQAEnabled) return [];
    const issues = qaRulesEngine.analyze({ requests, consoleErrors, domFindings, settings: qaSettings });
    const contract = checker && contractDocument && contractEnabled ? checker.contractIssues(contractDocument, requests) : [];
    return [...issues, ...contract].filter(
      (issue) => !dismissedQAIssueIds.has(issue.id) && !excludedQARuleIds.includes(issue.ruleId),
    );
  }, [requests, consoleErrors, domFindings, qaSettings, checker, contractDocument, contractEnabled, dismissedQAIssueIds, excludedQARuleIds]);

  const coverage = useMemo(
    () => (checker && contractDocument && contractEnabled ? checker.contractCoverage(contractDocument, requests) : null),
    [checker, contractDocument, contractEnabled, requests],
  );

  const contractStatusByRequest = useMemo(() => {
    const failed = new Set(qaIssues.filter((issue) => issue.category === 'contract').map((issue) => issue.requestId));
    return new Map<string, ContractStatus>(
      requests.map((request) => {
        if (!checker || !contractDocument) return [request.id, undefined];
        if (!checker.matchEndpoint(contractDocument, request)) return [request.id, 'undocumented'];
        return [request.id, failed.has(request.id) ? 'failed' : 'passed'];
      }),
    );
  }, [requests, checker, contractDocument, qaIssues]);

  const handleQASettingsChange = useCallback((incoming: QASettings) => {
    // A project profile saved by an older version has no value for newer switches.
    const settings = { ...defaultQASettings, ...incoming };
    setQASettings(settings);
    saveStored({ qaSettings: settings });
  }, []);

  const handleContractSpecChange = useCallback((text: string) => {
    setContractSpecText(text);
    saveStored({ contractSpecText: text });
  }, []);

  const handleDismissQAIssue = useCallback((issue: QAIssue) => {
    setDismissedQAIssueIds((previous) => new Set(previous).add(issue.id));
  }, []);

  const setExcludedRules = useCallback((ruleIds: string[]) => {
    setExcludedQARuleIds(ruleIds);
    saveStored({ excludedQARuleIds: ruleIds });
  }, []);

  const handleExcludeQARule = useCallback((issue: QAIssue) => {
    setExcludedQARuleIds((previous) => {
      if (previous.includes(issue.ruleId)) return previous;
      const next = [...previous, issue.ruleId];
      saveStored({ excludedQARuleIds: next });
      return next;
    });
  }, []);

  const handleRestoreExcludedQARules = useCallback(() => setExcludedRules([]), [setExcludedRules]);

  const checksEnabled = qaSettings.accessibilityEnabled && qaSettings.autoQAEnabled;
  const axeEnabled = qaSettings.axeEnabled;
  const runDomChecks = useCallback(async () => {
    if (!checksEnabled) return;
    setDomChecksLoading(true);
    try {
      const result = await sendToPage<{ findings?: DOMFinding[] }>({ type: 'RUN_DOM_QA_CHECKS' });
      let findings = result?.findings ?? [];
      if (axeEnabled) {
        // The full WCAG audit: axe-core (and its translation) is injected into the page for this run only.
        try {
          const language = getLanguage();
          const audit = await sendToPage<{ findings?: DOMFinding[]; error?: string }>(
            { type: 'RUN_AXE_CHECKS', language },
            { inject: language === 'ru' ? ['axe.min.js', 'axe-locale-ru.js'] : ['axe.min.js'] },
          );
          if (audit && !audit.error) {
            // axe has its own rules for these; keep one finding per problem.
            findings = [...findings.filter((finding) => !CHECKS_COVERED_BY_AXE.includes(finding.type)), ...(audit.findings ?? [])];
          }
        } catch {
          // The audit could not run on this page: the built-in checks still apply.
        }
      }
      setDomFindings(findings);
    } catch {
      // Browser pages (chrome://, the Web Store) cannot be scanned.
      setDomFindings([]);
    } finally {
      setDomChecksLoading(false);
    }
  }, [checksEnabled, axeEnabled]);

  const highlightQAIssue = useCallback(async (issue: QAIssue) => {
    const selector = issue.evidence?.selector;
    if (typeof selector !== 'string' || !selector) return;
    try {
      await sendToPage({ type: 'HIGHLIGHT_ELEMENTS', elements: [{ selector }], label: issue.title });
    } catch {
      // The page does not accept scripts or was navigated away.
    }
  }, []);

  const clearDomFindings = useCallback(() => setDomFindings([]), []);

  return {
    qaSettings,
    contractSpecText,
    excludedQARuleIds,
    domChecksLoading,
    contractDocument,
    contractError,
    qaIssues,
    coverage,
    contractStatusByRequest,
    handleQASettingsChange,
    handleContractSpecChange,
    handleDismissQAIssue,
    handleExcludeQARule,
    handleRestoreExcludedQARules,
    setExcludedRules,
    runDomChecks,
    highlightQAIssue,
    clearDomFindings,
  };
}
