import { Dialog } from '@base-ui-components/react/dialog';
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  CheckSquare,
  Crosshair,
  Download,
  Eye,
  FileJson,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GitCompare,
  History,
  Inbox,
  List,
  Pause,
  Radio,
  ScrollText,
  Search,
  Settings,
  Shield,
  Tag,
  Terminal,
  Upload,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Components are imported from their own files, not from the './components' barrel:
// the barrel would pull the lazily loaded ones back into the start-up bundle.
import { FilterButton } from './components/common/FilterButton';
import { ConsoleErrorDetail } from './components/console/ConsoleErrorDetail';
import { ConsoleErrorRow } from './components/console/ConsoleErrorRow';
import { lazyComponent } from './components/lazy';
import { RequestRow } from './components/requests/RequestRow';
import { DiffDialog } from './components/views/DiffDialog';
import { GroupedView } from './components/views/GroupedView';
import { TimelineView } from './components/views/TimelineView';
import { useCapture } from './hooks/useCapture';
import { useCaptureSettings } from './hooks/useCaptureSettings';
import { useCollections } from './hooks/useCollections';
import { useJiraSettings } from './hooks/useJiraSettings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePreferences } from './hooks/usePreferences';
import { useQaAnalysis } from './hooks/useQaAnalysis';
import { useRules } from './hooks/useRules';
import { useSessions } from './hooks/useSessions';
import { useStepRecorder } from './hooks/useStepRecorder';
import { useElementPicker } from './hooks/useElementPicker';
import { dateLocale, t } from './locales';
import type { QAIssue, QAIssueCategory, QAIssueSeverity } from './qa';
import { maskRequest, maskRequests } from './qa/masking';
import type { NegativeScenario } from './qa/negativeTesting';
import { candidatesOf, findValueInRequests, partsOf, previewValue, searchTermFor, streamRequests, type ValueMatch } from './utils/valueFinder';
import { useElementWatch } from './hooks/useElementWatch';
import { useStreamMessages } from './hooks/useStreamMessages';

/** Path and query of a URL, for short labels. */
function shortPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
import type { FocusField } from './components/detail/RequestDetail';
import { createSessionReport, createSessionReportHtml, createSessionReportJson } from './qa/report';
import type {
  ApiRequest,
  ConsoleError,
  MockRule,
  RequestCollection,
  RequestTag,
  ResourceType,
  SortOption,
  SortPresetId,
} from './types';
import { downloadFile, today } from './utils/download';
import { generateBulkCurl, generateCsv, generateJsonSchema, generateOpenApiSpec } from './utils/exporters';
import { generateClaudePrompt, generateHar, generateMarkdownReport, generatePostmanCollection } from './utils/generators';
import { filterRequests, groupByDomain, isFailed, isSlow, SORT_PRESETS, sortRequests, type RequestFilter } from './utils/requestList';

// Dialogs and tabs that most sessions never open are downloaded on first use.
const RequestDetail = lazyComponent(() => import('./components/detail/RequestDetail').then((module) => module.RequestDetail));
const QACheckView = lazyComponent(() => import('./components/qa/QACheckView').then((module) => module.QACheckView));
const TeamToolsPanel = lazyComponent(() => import('./components/qa/TeamToolsPanel').then((module) => module.TeamToolsPanel));
const BugReportDialog = lazyComponent(() => import('./components/qa/BugReportDialog').then((module) => module.BugReportDialog));
const MockManager = lazyComponent(() => import('./components/mocks/MockManager').then((module) => module.MockManager));
const PausedRequestDialog = lazyComponent(() => import('./components/breakpoints/PausedRequestDialog').then((module) => module.PausedRequestDialog));
const BreakpointManager = lazyComponent(() => import('./components/breakpoints/BreakpointManager').then((module) => module.BreakpointManager));
const SessionHistory = lazyComponent(() => import('./components/sessions/SessionHistory').then((module) => module.SessionHistory));
const SettingsPanel = lazyComponent(() => import('./components/settings/SettingsPanel').then((module) => module.SettingsPanel));
const CollectionManager = lazyComponent(() => import('./components/collections/CollectionManager').then((module) => module.CollectionManager));
const CollectionViewer = lazyComponent(() => import('./components/collections/CollectionViewer').then((module) => module.CollectionViewer));
const ValueFinderDialog = lazyComponent(() => import('./components/finder/ValueFinderDialog').then((module) => module.ValueFinderDialog));
const TagManager = lazyComponent(() => import('./components/collections/TagManager').then((module) => module.TagManager));

const sortPresets = SORT_PRESETS;

/** Resource kinds offered as a filter when everything is captured, not only API calls. */
const TYPE_FILTERS: Array<'all' | 'api' | ResourceType> = ['all', 'api', 'document', 'script', 'stylesheet', 'image', 'font', 'media', 'other'];

export default function App() {
  // ---- What is selected and shown -------------------------------------------------------------
  const [selectedRequest, setSelectedRequest] = useState<ApiRequest | null>(null);
  const [selectedError, setSelectedError] = useState<ConsoleError | null>(null);
  const [filter, setFilter] = useState<RequestFilter>('all');
  const [qaFilter, setQaFilter] = useState<'all' | QAIssueSeverity | QAIssueCategory>('all');
  const [urlFilter, setUrlFilter] = useState('');
  const [bodySearch, setBodySearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'api' | ResourceType>('all');
  const harInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<'list' | 'timeline' | 'grouped'>('grouped');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [sortPreset, setSortPreset] = useState<SortPresetId | ''>('');
  const [autoSelect, setAutoSelect] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Dialogs
  const [bugReportIssue, setBugReportIssue] = useState<QAIssue | null>(null);
  const [showMockManager, setShowMockManager] = useState(false);
  const [mockInitialRule, setMockInitialRule] = useState<MockRule | null>(null);
  const [showBreakpointManager, setShowBreakpointManager] = useState(false);
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCollectionManager, setShowCollectionManager] = useState(false);
  const [viewingCollection, setViewingCollection] = useState<RequestCollection | null>(null);
  const [showTagManager, setShowTagManager] = useState(false);

  // Element picker: a clicked page element is looked up in the responses; a chosen match opens
  // its request with the field in view, and closing that request returns to the results.
  const pickCommandRef = useRef<() => void>(() => {});
  const [lastMatch, setLastMatch] = useState<ValueMatch | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const [pickCount, setPickCount] = useState(0);
  const [focusField, setFocusField] = useState<FocusField | null>(null);

  // Comparing two requests
  const [compareMode, setCompareMode] = useState(false);
  const [compareRequests, setCompareRequests] = useState<[ApiRequest | null, ApiRequest | null]>([null, null]);
  const [showDiff, setShowDiff] = useState(false);

  // Group selection
  const [groupSelectionMode, setGroupSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ---- State that lives in hooks --------------------------------------------------------------
  const clearDomFindingsRef = useRef<() => void>(() => {});
  const watchStopRef = useRef<() => void>(() => {});
  const handleTabChanged = useCallback(() => {
    setSelectedRequest(null);
    setSelectedError(null);
    clearDomFindingsRef.current();
    watchStopRef.current(); // the watched element belongs to the previous tab
  }, []);

  const { captureSettings, updateCaptureSettings } = useCaptureSettings();
  const {
    requests, consoleErrors, debuggerStatus, debuggerError, pausedRequests, capturedTabId, snapshot,
    reconnectDebugger, resumePausedRequest, replaceRequests, showSnapshot, returnToCapture, captureScreenshot,
    clearRequests: clearCapturedRequests, clearConsoleErrors: clearCapturedErrors,
  } = useCapture(handleTabChanged, captureSettings.maxRequests, () => pickCommandRef.current());
  // The picker searches WebSocket/SSE messages too; they are polled only once it has been used.
  const [finderUsed, setFinderUsed] = useState(false);
  const streamMessages = useStreamMessages(finderUsed);
  const finderRequests = useMemo(() => [...requests, ...streamRequests(streamMessages)], [requests, streamMessages]);
  const finderRequestsRef = useRef(finderRequests);
  finderRequestsRef.current = finderRequests;
  const picker = useElementPicker(finderRequests, capturedTabId);
  const watch = useElementWatch(finderRequests, capturedTabId);
  watchStopRef.current = watch.stop;

  // Recorded steps are linked to the requests captured after them.
  const requestsRef = useRef(requests);
  useEffect(() => {
    requestsRef.current = requests;
  }, [requests]);
  const requestIdsSince = useCallback(
    (since: number) => requestsRef.current.filter((request) => request.timestamp >= since).map((request) => request.id),
    [],
  );
  const recorder = useStepRecorder(capturedTabId, requestIdsSince);
  const { jiraSettings, saveJiraSettings } = useJiraSettings();

  const {
    qaSettings, contractSpecText, excludedQARuleIds, domChecksLoading, contractDocument, contractError,
    qaIssues, coverage, contractStatusByRequest, handleQASettingsChange, handleContractSpecChange,
    handleDismissQAIssue, handleExcludeQARule, handleRestoreExcludedQARules, setExcludedRules,
    runDomChecks, highlightQAIssue, clearDomFindings,
  } = useQaAnalysis(requests, consoleErrors);
  useEffect(() => {
    clearDomFindingsRef.current = clearDomFindings;
  }, [clearDomFindings]);

  const {
    darkMode, fontSize, maskSecretsOnExport, language,
    handleDarkModeChange, handleFontSizeChange, handleMaskSecretsChange, handleLanguageChange,
  } = usePreferences();
  const { mockRules, breakpointRules, saveMockRules, saveBreakpointRules } = useRules();
  const { sessions, saveSession: storeSession, loadSessionRequests, deleteSession, updateSession, compareSessions } = useSessions();
  const {
    collections, tags, requestMeta, favorites, toggleFavorite, createCollection, deleteCollection,
    addToCollection, addRequestToCollection, removeFromCollection, createTag, deleteTag, togglePin,
  } = useCollections();

  // Clean up copy timer on unmount
  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  // Auto-select new requests
  useEffect(() => {
    if (autoSelect && requests.length > 0) {
      setSelectedRequest(requests[0]);
    }
  }, [autoSelect, requests]);

  // ---- Clearing -------------------------------------------------------------------------------
  const clearRequests = useCallback(() => {
    clearCapturedRequests();
    setSelectedRequest(null);
  }, [clearCapturedRequests]);

  const clearConsoleErrors = useCallback(() => {
    clearCapturedErrors();
    setSelectedError(null);
  }, [clearCapturedErrors]);

  const clearAll = useCallback(() => {
    clearRequests();
    clearConsoleErrors();
  }, [clearRequests, clearConsoleErrors]);

  // ---- Export ---------------------------------------------------------------------------------
  // Everything that leaves the browser goes through here: credentials are masked unless the user
  // switched masking off in the settings. Masking is done at export time, not on every capture.
  const forExport = useCallback(
    (list: ApiRequest[]) => maskRequests(list, maskSecretsOnExport),
    [maskSecretsOnExport],
  );
  const requestForExport = useCallback(
    (request: ApiRequest | undefined) => (request && maskSecretsOnExport ? maskRequest(request) : request),
    [maskSecretsOnExport],
  );

  const exportSessionReport = useCallback((format: 'md' | 'html' | 'json') => {
    const exported = forExport(requests);
    const report = format === 'md' ? createSessionReport(exported, consoleErrors, qaIssues) : format === 'html' ? createSessionReportHtml(exported, consoleErrors, qaIssues) : createSessionReportJson(exported, consoleErrors, qaIssues);
    const contentType = format === 'md' ? 'text/markdown' : format === 'html' ? 'text/html' : 'application/json';
    downloadFile(`qa-session-report-${today()}.${format}`, report, contentType);
  }, [forExport, requests, consoleErrors, qaIssues]);

  const exportToPostman = useCallback(() => {
    downloadFile(`reqpane-${today()}.postman_collection.json`, JSON.stringify(generatePostmanCollection(forExport(requests)), null, 2), 'application/json');
    setShowExportMenu(false);
  }, [forExport, requests]);

  const exportToHar = useCallback(() => {
    downloadFile(`reqpane-${today()}.har`, JSON.stringify(generateHar(forExport(requests)), null, 2), 'application/json');
  }, [forExport, requests]);

  const exportToMarkdown = useCallback(() => {
    const exported = forExport(requests);
    // Get page info from the first request or use defaults
    const pageInfo = exported.length > 0
      ? { url: exported[0].pageUrl, title: exported[0].pageTitle }
      : { url: t().unknown, title: t().unknown };
    downloadFile(`api-report-${today()}.md`, generateMarkdownReport(exported, consoleErrors, pageInfo), 'text/markdown');
    setShowExportMenu(false);
  }, [forExport, requests, consoleErrors]);

  const exportToOpenApi = useCallback(() => {
    downloadFile(`openapi-${today()}.json`, generateOpenApiSpec(forExport(requests)), 'application/json');
    setShowExportMenu(false);
  }, [forExport, requests]);

  const exportToJsonSchema = useCallback(() => {
    const body = selectedRequest?.responseBody;
    if (!body) return;
    downloadFile(`json-schema-${today()}.json`, generateJsonSchema(body), 'application/json');
    setShowExportMenu(false);
  }, [selectedRequest]);

  const exportToCsv = useCallback(() => {
    downloadFile(`api-export-${today()}.csv`, generateCsv(forExport(requests)), 'text/csv');
    setShowExportMenu(false);
  }, [forExport, requests]);

  const exportToBulkCurl = useCallback(() => {
    downloadFile(`curl-collection-${today()}.sh`, generateBulkCurl(forExport(requests)), 'text/plain');
    setShowExportMenu(false);
  }, [forExport, requests]);

  const exportSelected = useCallback(() => {
    const selected = requests.filter((request) => selectedIds.has(request.id));
    if (selected.length === 0) return;
    downloadFile(`selected-curl-${today()}.sh`, generateBulkCurl(forExport(selected)), 'text/plain');
  }, [forExport, requests, selectedIds]);

  const copyToClipboard = useCallback(async (request: ApiRequest) => {
    await navigator.clipboard.writeText(generateClaudePrompt(maskSecretsOnExport ? maskRequest(request) : request));
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [maskSecretsOnExport]);

  // ---- Sessions -------------------------------------------------------------------------------
  const saveSession = useCallback(async () => {
    if (await storeSession(requests)) setShowExportMenu(false);
  }, [storeSession, requests]);

  const loadSession = useCallback(async (sessionId: string) => {
    const saved = await loadSessionRequests(sessionId);
    if (!saved) return;
    showSnapshot(saved, { kind: 'session', name: sessions.find((session) => session.id === sessionId)?.name || '' });
    setSelectedRequest(null);
    setShowSessionHistory(false);
  }, [loadSessionRequests, showSnapshot, sessions]);

  // ---- HAR import -----------------------------------------------------------------------------
  const importHar = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const { parseHar } = await import('./utils/harImport');
      const imported = parseHar(await file.text());
      if (imported.length === 0) throw new Error('empty');
      showSnapshot(imported, { kind: 'har', name: file.name });
      setSelectedRequest(null);
      setFilter('all');
      setShowExportMenu(false);
    } catch {
      window.alert(t().importHarError);
    }
  }, [showSnapshot]);

  // ---- Mocks ----------------------------------------------------------------------------------
  const openMockFor = useCallback((rule: MockRule) => {
    saveMockRules([...mockRules, rule]);
    setMockInitialRule(rule);
    setShowMockManager(true);
  }, [mockRules, saveMockRules]);

  const createNegativeMockFor = useCallback(async (request: ApiRequest, scenario: NegativeScenario) => {
    // negativeTesting depends on the contract checker; it is loaded with the request detail anyway.
    const { createNegativeMock } = await import('./qa/negativeTesting');
    openMockFor(createNegativeMock(request, scenario));
  }, [openMockFor]);

  // ---- Request list ---------------------------------------------------------------------------
  const hasOtherResources = useMemo(
    () => requests.some((request) => request.type !== 'xhr' && request.type !== 'fetch'),
    [requests],
  );
  const filteredRequests = useMemo(() => {
    const byType = typeFilter === 'all' || !hasOtherResources
      ? requests
      : requests.filter((request) => (typeFilter === 'api' ? request.type === 'xhr' || request.type === 'fetch' : request.type === typeFilter));
    return filterRequests(byType, { filter, urlFilter, bodySearch });
  }, [requests, typeFilter, hasOtherResources, filter, urlFilter, bodySearch]);
  const groupedRequests = useMemo(() => groupByDomain(filteredRequests), [filteredRequests]);
  const sortedRequests = useMemo(
    () => sortRequests(filteredRequests, sortBy, sortPreset),
    [filteredRequests, sortBy, sortPreset],
  );

  const apiErrorCount = requests.filter(isFailed).length;
  const slowCount = requests.filter(isSlow).length;
  const consoleErrorCount = consoleErrors.length;

  // Toggle request for comparison
  const toggleCompareRequest = useCallback((req: ApiRequest) => {
    setCompareRequests((prev) => {
      if (prev[0]?.id === req.id) return [null, prev[1]];
      if (prev[1]?.id === req.id) return [prev[0], null];
      if (!prev[0]) return [req, prev[1]];
      if (!prev[1]) return [prev[0], req];
      return [req, prev[1]]; // Replace first if both selected
    });
  }, []);

  // Group selection
  const toggleGroupSelect = useCallback((requestId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else {
        next.add(requestId);
      }
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedIds(new Set(sortedRequests.map(r => r.id)));
  }, [sortedRequests]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const deleteSelected = useCallback(() => {
    replaceRequests(requests.filter(r => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
  }, [replaceRequests, requests, selectedIds]);

  // Integrate keyboard shortcuts
  useKeyboardShortcuts({
    'ctrl+f': () => {
      const input = document.querySelector<HTMLInputElement>('input[data-search="url"]');
      input?.focus();
    },
    'ctrl+shift+f': () => {
      const input = document.querySelector<HTMLInputElement>('input[data-search="body"]');
      input?.focus();
    },
    'ctrl+e': () => setShowExportMenu(prev => !prev),
    'ctrl+l': clearAll,
    'ctrl+shift+e': exportToHar,
    'ctrl+1': () => setFilter('all'),
    'ctrl+2': () => setFilter('errors'),
    'ctrl+3': () => setFilter('slow'),
    'ctrl+4': () => setFilter('console'),
    'ctrl+shift+c': () => {
      setCompareMode(prev => !prev);
      if (compareMode) setCompareRequests([null, null]);
    },
    'ctrl+shift+s': () => setShowSettings(prev => !prev),
    'escape': () => {
      setSelectedRequest(null);
      setSelectedError(null);
      setShowExportMenu(false);
    },
  });

  const pickElement = async () => {
    if (picker.picking) {
      picker.cancel();
      return;
    }
    setFinderOpen(false);
    setFocusField(null);
    setSelectedRequest(null);
    setFinderUsed(true);
    if (watch.active) watch.stop(); // a new element replaces the watched one
    const element = await picker.start();
    if (!element) return;
    setPickCount((count) => count + 1);
    // A single match opens its request straight away; several or none show the list.
    // Requests that arrived while the user was picking count too.
    const matches = findValueInRequests(finderRequestsRef.current, candidatesOf(element), { parts: partsOf(element), limit: 2 });
    if (matches.length === 1) openValueMatch(matches[0], element.text, false);
    else setFinderOpen(true);
  };

  const openValueMatch = (match: ValueMatch, query: string, fromList = true) => {
    setLastMatch(match);
    setFocusField({
      requestId: match.request.id,
      path: match.path,
      ancestors: match.ancestors,
      search: searchTermFor(match, query),
      fromList,
      section: match.section,
      value: match.value,
      pageValue: picker.picked?.text ?? query,
    });
    setFinderOpen(false);
    setSelectedRequest(match.request);
  };

  pickCommandRef.current = () => void pickElement();

  /** Bug report draft: the value shown on the page next to the field it was found in. */
  const reportValueMismatch = () => {
    const element = picker.picked;
    const match = lastMatch;
    if (!element || !match) return;
    const field = match.path.replace(/^root\.?/, '') || t().valueFinderWholeBody;
    const pageValue = element.text.slice(0, 120);
    setBugReportIssue({
      id: crypto.randomUUID(),
      ruleId: 'page-value',
      category: 'dom',
      severity: 'warning',
      title: t().valueBugTitle(pageValue, field),
      description: t().valueBugDescription({
        pageValue,
        selector: element.selector,
        frameUrl: element.frameUrl,
        request: `${match.request.method} ${match.request.url}`,
        field,
        responseValue: previewValue(match.value),
      }),
      timestamp: Date.now(),
      url: match.request.url,
      requestId: match.request.id,
      evidence: { selector: element.selector, field },
    });
  };

  const closeRequestDetail = () => {
    // A request opened from the picker results goes back to them.
    if (focusField?.fromList && focusField.requestId === selectedRequest?.id && picker.picked) setFinderOpen(true);
    setFocusField(null);
    setSelectedRequest(null);
  };

  return (
    <div className="app-shell flex flex-col" key={language}>
      {/* Header */}
      <header className="px-4 pt-5 pb-4 border-b border-[var(--color-border)]">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[var(--color-accent)] rounded-lg flex items-center justify-center">
              <Terminal className="w-4 h-4 text-white" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-base font-semibold">{t().appTitle}</h1>
              <p className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${debuggerStatus === 'attached' ? 'bg-green-500' :
                  debuggerStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'
                  }`} />
                {debuggerStatus === 'attached'
                  ? t().requestsCount(requests.length)
                  : debuggerStatus === 'error'
                    ? (debuggerError || t().cannotCapture)
                    : t().notCapturing}
                {captureSettings.throttle !== 'none' && (
                  <span className="ml-1 rounded bg-amber-100 px-1 text-amber-700" title={t().throttling}>{t().throttleLabels[captureSettings.throttle]}</span>
                )}
                {recorder.recording && (
                  <button onClick={recorder.stop} className="ml-1 rounded bg-red-500 px-1 text-white" title={t().stopRecording(recorder.steps.length)}>● REC {recorder.steps.length}</button>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => void pickElement()}
              className={`p-1.5 rounded transition-colors ${picker.picking
                ? 'bg-[var(--color-accent)] text-white animate-pulse'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                }`}
              title={picker.picking ? t().pickElementActive : t().pickElement}
              aria-pressed={picker.picking}
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowBreakpointManager(true)}
              className={`p-1.5 rounded transition-colors ${breakpointRules.some((r) => r.enabled)
                ? 'bg-red-500 text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                }`}
              title={t().breakpointsActive(breakpointRules.filter((r) => r.enabled).length)}
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowMockManager(true)}
              className={`p-1.5 rounded transition-colors ${mockRules.some((r) => r.enabled)
                ? 'bg-purple-500 text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                }`}
              title={t().mockRulesActive(mockRules.filter((r) => r.enabled).length)}
            >
              <Shield className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => updateCaptureSettings({ preserveLog: !captureSettings.preserveLog })}
              className={`p-1.5 rounded transition-colors ${captureSettings.preserveLog
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                }`}
              title={captureSettings.preserveLog ? t().preserveLogOn : t().preserveLogOff}
              aria-pressed={captureSettings.preserveLog}
            >
              <ScrollText className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setAutoSelect(!autoSelect)}
              className={`p-1.5 rounded transition-colors ${autoSelect
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                }`}
              title={autoSelect ? t().autoSelectOn : t().autoSelectOff}
            >
              <Radio className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowCollectionManager(true)}
              className="p-1.5 rounded transition-colors text-text-muted hover:text-text hover:bg-hover"
              title={t().collections}
            >
              <Bookmark className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowTagManager(true)}
              className="p-1.5 rounded transition-colors text-text-muted hover:text-text hover:bg-hover"
              title={t().tags}
            >
              <Tag className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowSessionHistory(true)}
              className="p-1.5 rounded transition-colors text-text-muted hover:text-text hover:bg-hover"
              title={t().sessionHistory}
            >
              <History className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-1.5 rounded transition-colors text-text-muted hover:text-text hover:bg-hover"
              title={t().settings}
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="p-1.5 rounded transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]"
                title={t().exportOptions}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-50 py-1 min-w-[200px] max-h-[70vh] overflow-y-auto">
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    {t().exportOptions}
                  </div>
                  <button
                    onClick={exportToHar}
                    className="w-full px-3 py-2 text-xs text-left hover:bg-[var(--color-hover)] flex items-center gap-2"
                  >
                    <Download className="w-3.5 h-3.5" /> {t().exportAsHar}
                  </button>
                  <button
                    onClick={exportToPostman}
                    className="w-full px-3 py-2 text-xs text-left hover:bg-[var(--color-hover)] flex items-center gap-2"
                  >
                    <FileJson className="w-3.5 h-3.5" /> {t().exportToPostman}
                  </button>
                  <button
                    onClick={exportToMarkdown}
                    className="w-full px-3 py-2 text-xs text-left hover:bg-[var(--color-hover)] flex items-center gap-2"
                  >
                    <FileText className="w-3.5 h-3.5" /> {t().markdownReport}
                  </button>
                  <button
                    onClick={exportToOpenApi}
                    className="w-full px-3 py-2 text-xs text-left hover:bg-[var(--color-hover)] flex items-center gap-2"
                  >
                    <FileJson className="w-3.5 h-3.5" /> {t().exportOpenApi}
                  </button>
                  <button
                    onClick={exportToCsv}
                    className="w-full px-3 py-2 text-xs text-left hover:bg-[var(--color-hover)] flex items-center gap-2"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" /> {t().exportCsv}
                  </button>
                  <button
                    onClick={exportToBulkCurl}
                    className="w-full px-3 py-2 text-xs text-left hover:bg-[var(--color-hover)] flex items-center gap-2"
                  >
                    <Terminal className="w-3.5 h-3.5" /> {t().exportBulkCurl}
                  </button>
                  {selectedRequest?.responseBody != null && (
                    <button
                      onClick={exportToJsonSchema}
                      className="w-full px-3 py-2 text-xs text-left hover:bg-[var(--color-hover)] flex items-center gap-2"
                    >
                      <FileJson className="w-3.5 h-3.5" /> {t().exportJsonSchema}
                    </button>
                  )}
                  <hr className="my-1 border-[var(--color-border)]" />
                  <button
                    onClick={saveSession}
                    className="w-full px-3 py-2 text-xs text-left hover:bg-[var(--color-hover)] flex items-center gap-2"
                  >
                    <History className="w-3.5 h-3.5" /> {t().saveSession}
                  </button>
                  <hr className="my-1 border-[var(--color-border)]" />
                  <button
                    onClick={() => harInputRef.current?.click()}
                    className="w-full px-3 py-2 text-xs text-left hover:bg-[var(--color-hover)] flex items-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5" /> {t().importHar}
                  </button>
                </div>
              )}
            </div>
            <input
              ref={harInputRef}
              type="file"
              accept=".har,.json,application/json"
              className="hidden"
              onChange={(event) => {
                void importHar(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <button
              onClick={() => setGroupSelectionMode(prev => !prev)}
              className={`p-1.5 rounded transition-colors ${groupSelectionMode
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                }`}
              title={t().groupOperations}
            >
              <CheckSquare className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={clearAll}
              className="px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] rounded transition-colors"
            >
              {t().clear}
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="@container flex flex-wrap gap-1 p-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
          <FilterButton
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            {t().all}
          </FilterButton>
          <FilterButton
            active={filter === 'errors'}
            onClick={() => setFilter('errors')}
            count={apiErrorCount}
            isError
          >
            {t().errors}
          </FilterButton>
          <FilterButton
            active={filter === 'slow'}
            onClick={() => setFilter('slow')}
            count={slowCount}
          >
            {t().slow}
          </FilterButton>
          <FilterButton
            active={filter === 'console'}
            onClick={() => setFilter('console')}
            count={consoleErrorCount}
            isError
          >
            {t().console}
          </FilterButton>
          <FilterButton
            active={filter === 'qa'}
            onClick={() => {
              setFilter('qa');
              void runDomChecks();
            }}
            count={qaIssues.length}
            isError
          >
            {t().qaCheck}
          </FilterButton>
        </div>

        {/* Resource type filter: shown once something other than API calls is in the list */}
        {hasOtherResources && (
          <div className="mt-2 flex flex-wrap gap-1">
            {TYPE_FILTERS.map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-2 py-0.5 rounded text-[10px] ${typeFilter === type
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
              >
                {type === 'all' ? t().all : type === 'api' ? 'XHR / Fetch' : t().resourceTypeLabels[type]}
              </button>
            ))}
          </div>
        )}

        {/* URL Filter */}
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={urlFilter}
            onChange={(e) => setUrlFilter(e.target.value)}
            placeholder={t().filterByUrl}
            data-search="url"
            className="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          {urlFilter && (
            <button
              onClick={() => setUrlFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Body Search */}
        <div className="relative mt-2">
          <FileSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={bodySearch}
            onChange={(e) => setBodySearch(e.target.value)}
            placeholder={t().searchInBody}
            data-search="body"
            className="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          {bodySearch && (
            <button
              onClick={() => setBodySearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* View Mode, Sort & Compare */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
          <div className="flex gap-1 p-0.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)]">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'list'
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              title={t().listView}
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'timeline'
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              title={t().timelineView}
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'grouped'
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              title={t().groupByDomain}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as SortOption);
                setSortPreset(''); // reset preset when single sort changes
              }}
              className="px-2 py-1 text-[10px] rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
              title={t().sortBy}
            >
              <option value="newest">{t().sortNewest}</option>
              <option value="oldest">{t().sortOldest}</option>
              <option value="method">{t().sortByMethod}</option>
              <option value="status">{t().sortByStatus}</option>
              <option value="duration">{t().sortByDuration}</option>
              <option value="type">{t().sortByType}</option>
              <option value="domain">{t().sortByDomain}</option>
            </select>
            <select
              value={sortPreset}
              onChange={(e) => {
                setSortPreset(e.target.value as SortPresetId | '');
                if (e.target.value) {
                  // Reset single sort to a neutral value when preset is active
                  setSortBy('newest');
                }
              }}
              className="px-2 py-1 text-[10px] rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
              title={t().sortPresets}
            >
              <option value="">{t().sortPresets}</option>
              {sortPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {t()[preset.labelKey] as string}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setCompareMode(!compareMode);
                if (compareMode) {
                  setCompareRequests([null, null]);
                }
              }}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${compareMode
                ? 'bg-blue-500 text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                }`}
            >
              <GitCompare className="w-3.5 h-3.5" />
              {compareMode ? t().exitCompare : t().compare}
            </button>
          </div>
        </div>

        {/* Compare Selection Info */}
        {compareMode && (
          <div className="mt-2 p-2 rounded-lg bg-blue-50 border border-blue-200 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-blue-700">
                {t().selectToCompare(compareRequests.filter(Boolean).length)}
              </span>
              {compareRequests[0] && compareRequests[1] && (
                <button
                  onClick={() => setShowDiff(true)}
                  className="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  {t().viewDiff}
                </button>
              )}
            </div>
          </div>
        )}
        {(picker.picking || picker.error) && (
          <p className={`mt-2 text-[11px] ${picker.error ? 'text-red-500' : 'text-[var(--color-accent)]'}`} role="status">
            {picker.error ? t().pickElementFailed(picker.error) : t().pickElementActive}
          </p>
        )}
        {watch.error && !watch.active && <p className="mt-2 text-[11px] text-red-500" role="status">{t().watchFailed}</p>}
        {watch.active && (
          <div className="mt-2 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent-light)] px-2.5 py-1.5 text-[11px]" role="status">
            <div className="flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 text-[var(--color-accent)] animate-pulse shrink-0" />
              <span className="min-w-0 truncate">{t().watchActive(watch.initialText ?? '', watch.changes.length)}</span>
              <button onClick={watch.stop} className="ml-auto text-[var(--color-accent)] hover:underline shrink-0">{t().watchStop}</button>
            </div>
            {watch.changes.length === 0 && <p className="mt-1 text-[var(--color-text-muted)]">{t().watchWaiting}</p>}
            <ul className="mt-1 space-y-1 max-h-40 overflow-y-auto">
              {watch.changes.slice(0, 8).map((change) => {
                const best = change.matches[0];
                return (
                  <li key={change.at} className="min-w-0">
                    <span className="text-[var(--color-text-muted)]">{new Date(change.at).toLocaleTimeString(dateLocale())}</span>{' '}
                    <span className="font-mono">{change.from ?? '∅'} → {change.to ?? '∅'}</span>{' '}
                    {best ? (
                      <button
                        onClick={() => openValueMatch(best, change.to ?? '', false)}
                        className="text-[var(--color-accent)] hover:underline font-mono break-all text-left"
                        title={best.request.url}
                      >
                        {best.request.method} {shortPath(best.request.url)} · {best.path.replace(/^root\.?/, '') || t().valueFinderWholeBody}
                      </button>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">{t().watchNotFromRequests(change.checked)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </header>

      {/* Debugger disconnected banner */}
      {debuggerStatus === 'detached' && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs">
          <span className="text-amber-700 dark:text-amber-300">{t().captureStopped}</span>
          <button
            onClick={reconnectDebugger}
            className="px-2 py-0.5 bg-amber-600 text-white rounded text-xs hover:bg-amber-700 transition-colors"
          >
            {t().reconnect}
          </button>
        </div>
      )}

      {/* A saved session or an imported file is shown instead of live capture */}
      {snapshot && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between gap-2 text-xs">
          <span className="text-blue-700 dark:text-blue-300 truncate">
            {snapshot.kind === 'har' ? t().snapshotHar(snapshot.name) : t().snapshotSession(snapshot.name)}
          </span>
          <button
            onClick={() => {
              returnToCapture();
              setSelectedRequest(null);
            }}
            className="shrink-0 px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition-colors"
          >
            {t().returnToCapture}
          </button>
        </div>
      )}

      {/* Group Selection Toolbar */}
      {groupSelectionMode && selectedIds.size > 0 && (
        <div className="px-4 py-2 bg-[var(--color-accent)]/10 border-b border-[var(--color-accent)]/20 flex items-center justify-between text-xs">
          <span className="font-medium text-[var(--color-accent)]">
            {t().selectedCount(selectedIds.size)}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={selectAllFiltered}
              className="px-2 py-1 rounded bg-[var(--color-accent)] text-white hover:opacity-90"
            >
              {t().selectAll}
            </button>
            <button
              onClick={deselectAll}
              className="px-2 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-hover)]"
            >
              {t().deselectAll}
            </button>
            <button
              onClick={deleteSelected}
              className="px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600"
            >
              {t().deleteSelected}
            </button>
            <button
              onClick={exportSelected}
              className="px-2 py-1 rounded bg-[var(--color-accent)] text-white hover:opacity-90"
            >
              {t().exportSelected}
            </button>
            {collections.length > 0 && (
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    const selectedReqs = requests.filter(r => selectedIds.has(r.id));
                    addToCollection(e.target.value, Array.from(selectedIds), selectedReqs);
                    e.target.value = '';
                  }
                }}
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-xs"
                defaultValue=""
              >
                <option value="" disabled>{t().addSelectedToCollection}</option>
                {collections.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Request List or Console Errors */}
      <div className="flex-1 overflow-auto">
        {filter === 'qa' ? (
          <><TeamToolsPanel requests={requests} settings={qaSettings} contractSpecText={contractSpecText} excludedRuleIds={excludedQARuleIds} mockRules={mockRules} maskSecrets={maskSecretsOnExport} recorder={recorder} onSaveMocks={saveMockRules} onApplyProfile={profile => {
            handleQASettingsChange(profile.qaSettings); handleContractSpecChange(profile.contractSpecText);
            setExcludedRules(profile.excludedRuleIds);
            saveMockRules(profile.mockRules);
          }} />
          <QACheckView
            issues={qaIssues}
            filter={qaFilter}
            onFilterChange={setQaFilter}
            onOpenRequest={(issue) => {
              const request = requests.find((item) => item.id === issue.requestId);
              if (request) {
                setSelectedRequest(request);
                setFilter('all');
              }
            }}
            onHighlightIssue={(issue) => void highlightQAIssue(issue)}
            onRefreshDomChecks={() => void runDomChecks()}
            domChecksLoading={domChecksLoading}
            contractSpecText={contractSpecText}
            contractError={contractError}
            contractCoverage={coverage}
            onContractSpecChange={handleContractSpecChange}
            onCreateBugReport={setBugReportIssue}
            onDismissIssue={handleDismissQAIssue}
            onExcludeRule={handleExcludeQARule}
            excludedRuleCount={excludedQARuleIds.length}
            onRestoreExcludedRules={handleRestoreExcludedQARules}
            onExportSessionReport={exportSessionReport}
            sessions={sessions}
            onCompareSessions={compareSessions}
          /></>
        ) : filter === 'console' ? (
          // Console Errors List
          consoleErrors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
              <AlertTriangle
                className="w-12 h-12 mb-3 opacity-30"
                strokeWidth={1}
              />
              <p className="text-sm">{t().noConsoleErrors}</p>
              <p className="text-xs mt-1">{t().noConsoleErrorsDesc}</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {consoleErrors.map((err) => (
                <ConsoleErrorRow
                  key={err.id}
                  error={err}
                  isSelected={selectedError?.id === err.id}
                  onClick={() =>
                    setSelectedError(selectedError?.id === err.id ? null : err)
                  }
                />
              ))}
            </div>
          )
        ) : // API Requests List
          filteredRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
              <Inbox className="w-12 h-12 mb-3 opacity-30" strokeWidth={1} />
              <p className="text-sm">{t().noRequests}</p>
              <p className="text-xs mt-1">{t().noRequestsDesc}</p>
            </div>
          ) : viewMode === 'timeline' ? (
            <TimelineView
              requests={filteredRequests}
              selectedRequest={selectedRequest}
              onSelect={(req) =>
                setSelectedRequest(selectedRequest?.id === req.id ? null : req)
              }
            />
          ) : viewMode === 'grouped' ? (
            <GroupedView
              groupedRequests={groupedRequests}
              selectedRequest={selectedRequest}
              favorites={favorites}
              compareMode={compareMode}
              compareRequests={compareRequests}
              groupSelectionMode={groupSelectionMode}
              selectedIds={selectedIds}
              requestMeta={requestMeta}
              tags={tags}
              onSelect={(req) =>
                setSelectedRequest(selectedRequest?.id === req.id ? null : req)
              }
              onToggleFavorite={toggleFavorite}
              onToggleCompare={toggleCompareRequest}
              onToggleGroupSelect={toggleGroupSelect}
              onTogglePin={togglePin}
            />
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {sortedRequests.map((req) => (
                <RequestRow
                  key={req.id}
                  request={req}
                  isSelected={selectedRequest?.id === req.id}
                  isFavorite={favorites.includes(req.id)}
                  isPinned={requestMeta[req.id]?.pinned || false}
                  tags={requestMeta[req.id]?.tags?.map(tagId => tags.find(t => t.id === tagId)).filter(Boolean) as RequestTag[] | undefined}
                  compareMode={compareMode}
                  isCompareSelected={
                    compareRequests[0]?.id === req.id ||
                    compareRequests[1]?.id === req.id
                  }
                  groupSelectionMode={groupSelectionMode}
                  isGroupSelected={selectedIds.has(req.id)}
                  onClick={() =>
                    setSelectedRequest(
                      selectedRequest?.id === req.id ? null : req
                    )
                  }
                  onToggleFavorite={() => toggleFavorite(req.id)}
                  onToggleCompare={() => toggleCompareRequest(req)}
                  onToggleGroupSelect={() => toggleGroupSelect(req.id)}
                  onTogglePin={() => togglePin(req.id)}
                  contractStatus={contractStatusByRequest.get(req.id)}
                />
              ))}
            </div>
          )}
      </div>

      {/* Request Detail Bottom Sheet */}
      <Dialog.Root
        open={!!selectedRequest}
        onOpenChange={(open) => !open && closeRequestDetail()}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl flex flex-col shadow-xl">
            {selectedRequest && (
              <RequestDetail
                request={selectedRequest}
                onClose={closeRequestDetail}
                focusField={focusField?.requestId === selectedRequest.id ? focusField : null}
                onReportMismatch={picker.picked && lastMatch ? reportValueMismatch : undefined}
                onWatch={picker.picked && !watch.active ? () => { closeRequestDetail(); setFinderOpen(false); void watch.start(); } : undefined}
                onShowAllMatches={picker.picked ? () => { setFocusField(null); setSelectedRequest(null); setFinderOpen(true); } : undefined}
                onCopy={() => copyToClipboard(selectedRequest)}
                copied={copied}
                mockRules={mockRules}
                onCreateMock={openMockFor}
                onOpenMockManager={() => {
                  setMockInitialRule(null)
                  setShowMockManager(true)
                }}
                onCreateNegativeMock={(scenario) => void createNegativeMockFor(selectedRequest, scenario)}
                contractDocument={contractDocument}
                collections={collections}
                onAddToCollection={addRequestToCollection}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={finderOpen && !!picker.picked} onOpenChange={(open) => !open && setFinderOpen(false)}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl flex flex-col shadow-xl">
            {picker.picked && (
              <ValueFinderDialog
                key={pickCount}
                picked={picker.picked}
                requests={finderRequests}
                onOpenMatch={openValueMatch}
                onPickAgain={() => void pickElement()}
                onWatch={watch.active ? undefined : () => { setFinderOpen(false); void watch.start(); }}
                onClose={() => setFinderOpen(false)}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={!!bugReportIssue} onOpenChange={(open) => !open && setBugReportIssue(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl shadow-xl">
            {bugReportIssue && <BugReportDialog issue={bugReportIssue} request={requestForExport(requests.find((request) => request.id === bugReportIssue.requestId))} jiraSettings={jiraSettings} onCaptureScreenshot={captureScreenshot} onClose={() => setBugReportIssue(null)} />}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* A request stopped at a breakpoint: edit it, let it go or cancel it. Closing the sheet lets it go. */}
      <Dialog.Root
        open={pausedRequests.length > 0}
        onOpenChange={(open) => {
          if (!open && pausedRequests[0]) resumePausedRequest(pausedRequests[0], 'continue');
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl flex flex-col shadow-xl">
            {pausedRequests[0] && (
              <PausedRequestDialog
                key={pausedRequests[0].requestId}
                paused={pausedRequests[0]}
                queued={pausedRequests.length - 1}
                onResume={resumePausedRequest}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Console Error Detail Bottom Sheet */}
      <Dialog.Root
        open={!!selectedError}
        onOpenChange={(open) => !open && setSelectedError(null)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl flex flex-col shadow-xl">
            {selectedError && (
              <ConsoleErrorDetail
                error={selectedError}
                onClose={() => setSelectedError(null)}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Mock Manager Dialog */}
      <Dialog.Root
        open={showMockManager}
        onOpenChange={(open) => {
          setShowMockManager(open)
          if (!open) setMockInitialRule(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl flex flex-col shadow-xl">
            <MockManager
              rules={mockRules}
              onSave={saveMockRules}
              onClose={() => {
                setShowMockManager(false)
                setMockInitialRule(null)
              }}
              initialRule={mockInitialRule}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Breakpoint Manager Dialog */}
      <Dialog.Root
        open={showBreakpointManager}
        onOpenChange={setShowBreakpointManager}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl flex flex-col shadow-xl">
            <BreakpointManager
              rules={breakpointRules}
              onSave={saveBreakpointRules}
              onClose={() => setShowBreakpointManager(false)}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Session History Dialog */}
      <Dialog.Root
        open={showSessionHistory}
        onOpenChange={setShowSessionHistory}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-2xl flex flex-col shadow-xl">
            <SessionHistory
              sessions={sessions}
              onLoad={loadSession}
              onDelete={deleteSession}
              onTogglePin={(sessionId, pinned) => updateSession(sessionId, { pinned })}
              onClose={() => setShowSessionHistory(false)}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Settings Dialog */}
      <Dialog.Root open={showSettings} onOpenChange={setShowSettings}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-2xl flex flex-col shadow-xl">
            <SettingsPanel
              darkMode={darkMode}
              fontSize={fontSize}
              onDarkModeChange={handleDarkModeChange}
              onFontSizeChange={handleFontSizeChange}
              maskSecretsOnExport={maskSecretsOnExport}
              onMaskSecretsChange={handleMaskSecretsChange}
              qaSettings={qaSettings}
              onQASettingsChange={handleQASettingsChange}
              captureSettings={captureSettings}
              onCaptureSettingsChange={updateCaptureSettings}
              language={language}
              onLanguageChange={handleLanguageChange}
              jiraSettings={jiraSettings}
              onJiraSettingsChange={saveJiraSettings}
              onClose={() => setShowSettings(false)}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Collection Manager Dialog */}
      <Dialog.Root
        open={showCollectionManager && !viewingCollection}
        onOpenChange={(open) => {
          setShowCollectionManager(open)
          if (!open) setViewingCollection(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl flex flex-col shadow-xl">
            <CollectionManager
              collections={collections}
              onCreate={createCollection}
              onDelete={deleteCollection}
              onViewCollection={(collection) => setViewingCollection(collection)}
              onClose={() => setShowCollectionManager(false)}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Collection Viewer Dialog */}
      <Dialog.Root
        open={!!viewingCollection}
        onOpenChange={(open) => {
          if (!open) setViewingCollection(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl flex flex-col shadow-xl">
            {viewingCollection && (
              <CollectionViewer
                collection={viewingCollection}
                onRemoveRequest={removeFromCollection}
                onSelectRequest={(req: ApiRequest) => {
                  setSelectedRequest(req)
                  setViewingCollection(null)
                  setShowCollectionManager(false)
                }}
                onBack={() => setViewingCollection(null)}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Tag Manager Dialog */}
      <Dialog.Root
        open={showTagManager}
        onOpenChange={setShowTagManager}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl flex flex-col shadow-xl">
            <TagManager
              tags={tags}
              onCreate={createTag}
              onDelete={deleteTag}
              onClose={() => setShowTagManager(false)}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Diff Dialog */}
      <DiffDialog
        open={showDiff}
        onClose={() => setShowDiff(false)}
        requests={compareRequests}
      />
    </div>
  );
}
