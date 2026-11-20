import { AlertTriangle, Inbox } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from './components/common/Sheet';
import { ConsoleErrorDetail } from './components/console/ConsoleErrorDetail';
import { ConsoleErrorRow } from './components/console/ConsoleErrorRow';
import { WatchLog } from './components/finder/WatchLog';
import { AppHeader, type HeaderDialog } from './components/layout/AppHeader';
import { ListControls, type ViewMode } from './components/layout/ListControls';
import { StatusBanners } from './components/layout/StatusBanners';
import { lazyComponent } from './components/lazy';
import type { PaletteCommand } from './components/palette/CommandPalette';
import { RequestList } from './components/requests/RequestList';
import { DiffDialog } from './components/views/DiffDialog';
import { TimelineView } from './components/views/TimelineView';
import type { FocusField } from './components/detail/RequestDetail';
import { useCapture } from './hooks/useCapture';
import { useCaptureSettings } from './hooks/useCaptureSettings';
import { useCollections } from './hooks/useCollections';
import { useElementPicker } from './hooks/useElementPicker';
import { useElementWatch } from './hooks/useElementWatch';
import { useExports, withNotes } from './hooks/useExports';
import { useJiraSettings } from './hooks/useJiraSettings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePreferences } from './hooks/usePreferences';
import { useQaAnalysis } from './hooks/useQaAnalysis';
import { useRules } from './hooks/useRules';
import { useSessions } from './hooks/useSessions';
import { useStepRecorder } from './hooks/useStepRecorder';
import { useStreamMessages } from './hooks/useStreamMessages';
import { useUpdateCheck } from './hooks/useUpdateCheck';
import { useWatchdog } from './hooks/useWatchdog';
import { useWhatsNew } from './hooks/useWhatsNew';
import { t } from './locales';
import type { QAIssue, QAIssueCategory, QAIssueSeverity } from './qa';
import type { NegativeScenario } from './qa/negativeTesting';
import type { ApiRequest, ConsoleError, MockRule, RequestCollection, ResourceType, SortOption, SortPresetId } from './types';
import { filterRequests, groupByDomain, isFailed, isSlow, sortRequests, type RequestFilter } from './utils/requestList';
import { candidatesOf, findValueInRequests, partsOf, previewValue, searchTermFor, streamRequests, type ValueMatch } from './utils/valueFinder';
import { endpointKey } from './utils/endpointHistory';

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
const CommandPalette = lazyComponent(() => import('./components/palette/CommandPalette').then((module) => module.CommandPalette));
const WhatsNewDialog = lazyComponent(() => import('./components/palette/WhatsNewDialog').then((module) => module.WhatsNewDialog));

export default function App() {
  // ---- What is selected and shown -------------------------------------------------------------
  const [selectedRequest, setSelectedRequest] = useState<ApiRequest | null>(null);
  const [selectedError, setSelectedError] = useState<ConsoleError | null>(null);
  const [filter, setFilter] = useState<RequestFilter>('all');
  const [qaFilter, setQaFilter] = useState<'all' | QAIssueSeverity | QAIssueCategory>('all');
  const [urlFilter, setUrlFilter] = useState('');
  const [bodySearch, setBodySearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'api' | ResourceType>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [sortPreset, setSortPreset] = useState<SortPresetId | ''>('');
  const [autoSelect, setAutoSelect] = useState(false);
  const [dialog, setDialog] = useState<HeaderDialog | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bugReportIssue, setBugReportIssue] = useState<QAIssue | null>(null);
  const [mockInitialRule, setMockInitialRule] = useState<MockRule | null>(null);
  const [viewingCollection, setViewingCollection] = useState<RequestCollection | null>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const pickCommandRef = useRef<() => void>(() => {});

  // Element picker → response field
  const [lastMatch, setLastMatch] = useState<ValueMatch | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const [pickCount, setPickCount] = useState(0);
  const [focusField, setFocusField] = useState<FocusField | null>(null);

  // Compare and group selection
  const [compareMode, setCompareMode] = useState(false);
  const [compareRequests, setCompareRequests] = useState<[ApiRequest | null, ApiRequest | null]>([null, null]);
  const [showDiff, setShowDiff] = useState(false);
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
    darkMode, fontSize, maskSecretsOnExport, language, checkUpdates,
    handleDarkModeChange, handleFontSizeChange, handleMaskSecretsChange, handleLanguageChange, handleCheckUpdatesChange,
  } = usePreferences();
  const { mockRules, breakpointRules, saveMockRules, saveBreakpointRules } = useRules();
  const { sessions, saveSession: storeSession, loadSessionRequests, deleteSession, updateSession, compareSessions } = useSessions();
  const {
    collections, tags, requestMeta, favorites, toggleFavorite, createCollection, deleteCollection, setNote,
    addToCollection, addRequestToCollection, removeFromCollection, createTag, deleteTag, togglePin,
  } = useCollections();
  const exports = useExports({ requests, consoleErrors, qaIssues, requestMeta, maskSecretsOnExport });
  const watchdog = useWatchdog(requests, !snapshot, capturedTabId);
  const watchedKeys = useMemo(() => new Set(watchdog.watched.map((endpoint) => endpoint.key)), [watchdog.watched]);
  const isWatched = useCallback((request: ApiRequest) => watchedKeys.size > 0 && watchedKeys.has(endpointKey(request)), [watchedKeys]);
  const updates = useUpdateCheck(checkUpdates);
  const whatsNew = useWhatsNew();

  // Auto-select new requests
  useEffect(() => {
    if (autoSelect && requests.length > 0) setSelectedRequest(requests[0]);
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

  // ---- Sessions and HAR -----------------------------------------------------------------------
  const saveSession = useCallback(async () => {
    // Notes travel with a saved session.
    if (await storeSession(withNotes(requests, requestMeta))) setShowExportMenu(false);
  }, [storeSession, requests, requestMeta]);

  const loadSession = useCallback(async (sessionId: string) => {
    const saved = await loadSessionRequests(sessionId);
    if (!saved) return;
    showSnapshot(saved, { kind: 'session', name: sessions.find((session) => session.id === sessionId)?.name || '' });
    setSelectedRequest(null);
    setDialog(null);
  }, [loadSessionRequests, showSnapshot, sessions]);

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

  // A note of an imported or saved request shows up like one typed here.
  const noteOf = useCallback((request: ApiRequest) => requestMeta[request.id]?.notes ?? request.note, [requestMeta]);
  const metaWithNotes = useMemo(() => {
    if (!requests.some((request) => request.note)) return requestMeta;
    const merged = { ...requestMeta };
    for (const request of requests) {
      if (request.note && !merged[request.id]?.notes) merged[request.id] = { ...merged[request.id], notes: request.note };
    }
    return merged;
  }, [requests, requestMeta]);

  // ---- Mocks ----------------------------------------------------------------------------------
  const openMockFor = useCallback((rule: MockRule) => {
    saveMockRules([...mockRules, rule]);
    setMockInitialRule(rule);
    setDialog('mocks');
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
  const sortedRequests = useMemo(() => sortRequests(filteredRequests, sortBy, sortPreset), [filteredRequests, sortBy, sortPreset]);

  const counts = useMemo(() => ({
    errors: requests.filter(isFailed).length,
    slow: requests.filter(isSlow).length,
    console: consoleErrors.length,
    qa: qaIssues.length,
  }), [requests, consoleErrors.length, qaIssues.length]);

  const toggleSelected = useCallback((request: ApiRequest) => {
    setSelectedRequest((current) => (current?.id === request.id ? null : request));
  }, []);

  const toggleCompareRequest = useCallback((req: ApiRequest) => {
    setCompareRequests((prev) => {
      if (prev[0]?.id === req.id) return [null, prev[1]];
      if (prev[1]?.id === req.id) return [prev[0], null];
      if (!prev[0]) return [req, prev[1]];
      if (!prev[1]) return [prev[0], req];
      return [req, prev[1]]; // Replace first if both selected
    });
  }, []);

  const toggleCompareMode = useCallback(() => {
    setCompareMode((active) => {
      if (active) setCompareRequests([null, null]);
      return !active;
    });
  }, []);

  const toggleGroupSelect = useCallback((requestId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(requestId)) next.delete(requestId);
      else next.add(requestId);
      return next;
    });
  }, []);

  const openQa = useCallback(() => {
    setFilter('qa');
    void runDomChecks();
  }, [runDomChecks]);

  const openRequestById = useCallback((requestId: string) => {
    const request = requests.find((item) => item.id === requestId);
    if (request) {
      setFilter('all');
      setSelectedRequest(request);
    }
  }, [requests]);

  // ---- Element picker -------------------------------------------------------------------------
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

  // ---- Command palette ------------------------------------------------------------------------
  const exportActions = {
    har: exports.exportToHar,
    postman: exports.exportToPostman,
    markdown: exports.exportToMarkdown,
    openApi: exports.exportToOpenApi,
    csv: exports.exportToCsv,
    bulkCurl: exports.exportToBulkCurl,
    jsonSchema: selectedRequest?.responseBody != null ? () => exports.exportToJsonSchema(selectedRequest) : undefined,
    saveSession: () => void saveSession(),
    importHar: (file: File | undefined) => void importHar(file),
  };

  const paletteCommands = (): PaletteCommand[] => {
    const s = t();
    const go = s.paletteSections;
    const list: PaletteCommand[] = [
      { id: 'filter-all', section: go.filters, label: s.all, keywords: 'all requests', shortcut: 'Ctrl+1', run: () => setFilter('all') },
      { id: 'filter-errors', section: go.filters, label: s.errors, keywords: 'errors 4xx 5xx', shortcut: 'Ctrl+2', run: () => setFilter('errors') },
      { id: 'filter-slow', section: go.filters, label: s.slow, keywords: 'slow', shortcut: 'Ctrl+3', run: () => setFilter('slow') },
      { id: 'filter-console', section: go.filters, label: s.console, keywords: 'console errors', shortcut: 'Ctrl+4', run: () => setFilter('console') },
      { id: 'qa', section: go.filters, label: s.qaCheck, keywords: 'qa check audit contract openapi', run: openQa },
      { id: 'view-list', section: go.view, label: s.listView, keywords: 'list', run: () => setViewMode('list') },
      { id: 'view-timeline', section: go.view, label: s.timelineView, keywords: 'timeline waterfall', run: () => setViewMode('timeline') },
      { id: 'view-grouped', section: go.view, label: s.groupByDomain, keywords: 'group domain', run: () => setViewMode('grouped') },
      { id: 'compare', section: go.view, label: compareMode ? s.exitCompare : s.compare, keywords: 'compare diff', shortcut: 'Ctrl+Shift+C', run: toggleCompareMode },
      { id: 'group-select', section: go.view, label: s.groupOperations, keywords: 'select bulk', run: () => setGroupSelectionMode((active) => !active) },
      { id: 'pick', section: go.tools, label: s.pickElement, keywords: 'picker element field finder', shortcut: 'Alt+Shift+F', run: () => void pickElement() },
      { id: 'mocks', section: go.tools, label: s.mockManagerTitle, keywords: 'mock rules patch block delay', run: () => setDialog('mocks') },
      { id: 'breakpoints', section: go.tools, label: s.paletteBreakpoints, keywords: 'breakpoint pause', run: () => setDialog('breakpoints') },
      { id: 'preserve', section: go.tools, label: captureSettings.preserveLog ? s.preserveLogOn : s.preserveLogOff, keywords: 'preserve log navigation', run: () => updateCaptureSettings({ preserveLog: !captureSettings.preserveLog }) },
      { id: 'autoselect', section: go.tools, label: autoSelect ? s.autoSelectOn : s.autoSelectOff, keywords: 'auto select', run: () => setAutoSelect((active) => !active) },
      { id: 'record', section: go.tools, label: recorder.recording ? s.stopRecording(recorder.steps.length) : s.paletteRecordSteps, keywords: 'record steps playwright', run: () => (recorder.recording ? recorder.stop() : openQa()) },
      { id: 'clear', section: go.tools, label: s.clear, keywords: 'clear reset', shortcut: 'Ctrl+L', run: clearAll },
      { id: 'export-har', section: go.export, label: s.exportAsHar, keywords: 'export har download', shortcut: 'Ctrl+Shift+E', run: exportActions.har },
      { id: 'export-postman', section: go.export, label: s.exportToPostman, keywords: 'export postman', run: exportActions.postman },
      { id: 'export-md', section: go.export, label: s.markdownReport, keywords: 'export markdown report', run: exportActions.markdown },
      { id: 'export-openapi', section: go.export, label: s.exportOpenApi, keywords: 'export openapi swagger', run: exportActions.openApi },
      { id: 'export-csv', section: go.export, label: s.exportCsv, keywords: 'export csv excel', run: exportActions.csv },
      { id: 'export-curl', section: go.export, label: s.exportBulkCurl, keywords: 'export curl bash', run: exportActions.bulkCurl },
      { id: 'report-md', section: go.export, label: s.paletteSessionReport, keywords: 'session report qa', run: () => exports.exportSessionReport('md') },
      { id: 'save-session', section: go.export, label: s.saveSession, keywords: 'save session', run: exportActions.saveSession },
      { id: 'sessions', section: go.panels, label: s.sessionHistory, keywords: 'sessions history', run: () => setDialog('sessions') },
      { id: 'collections', section: go.panels, label: s.collections, keywords: 'collections bookmarks', run: () => setDialog('collections') },
      { id: 'tags', section: go.panels, label: s.tags, keywords: 'tags labels', run: () => setDialog('tags') },
      { id: 'settings', section: go.panels, label: s.settings, keywords: 'settings preferences', shortcut: 'Ctrl+Shift+S', run: () => setDialog('settings') },
      { id: 'whats-new', section: go.panels, label: s.whatsNewMenu, keywords: 'whats new changelog release', run: whatsNew.show },
    ];
    if (snapshot) list.unshift({ id: 'return', section: go.tools, label: s.returnToCapture, keywords: 'live capture', run: () => { returnToCapture(); setSelectedRequest(null); } });
    if (debuggerStatus === 'detached') list.unshift({ id: 'reconnect', section: go.tools, label: s.reconnect, keywords: 'reconnect debugger', run: reconnectDebugger });
    if (selectedRequest) {
      const request = selectedRequest;
      list.unshift(
        { id: 'watch', section: go.request, label: isWatched(request) ? s.watchdogUnwatch : s.watchdogWatch, keywords: 'watchdog watch alert', run: () => watchdog.toggle(request) },
        { id: 'copy-prompt', section: go.request, label: s.copy, keywords: 'copy claude prompt', run: () => void exports.copyPrompt(request) },
      );
    }
    return list;
  };

  // ---- Keyboard -------------------------------------------------------------------------------
  useKeyboardShortcuts({
    'ctrl+k': () => setPaletteOpen((open) => !open),
    'ctrl+f': () => document.querySelector<HTMLInputElement>('input[data-search="url"]')?.focus(),
    'ctrl+shift+f': () => document.querySelector<HTMLInputElement>('input[data-search="body"]')?.focus(),
    'ctrl+e': () => setShowExportMenu((open) => !open),
    'ctrl+l': clearAll,
    'ctrl+shift+e': exports.exportToHar,
    'ctrl+1': () => setFilter('all'),
    'ctrl+2': () => setFilter('errors'),
    'ctrl+3': () => setFilter('slow'),
    'ctrl+4': () => setFilter('console'),
    'ctrl+shift+c': toggleCompareMode,
    'ctrl+shift+s': () => setDialog((open) => (open === 'settings' ? null : 'settings')),
    'escape': () => {
      setSelectedRequest(null);
      setSelectedError(null);
      setShowExportMenu(false);
    },
  }, ['ctrl+k']);

  const closeDialog = () => setDialog(null);

  return (
    <div className="app-shell flex flex-col" key={language}>
      <header className="px-4 pt-5 pb-4 border-b border-[var(--color-border)]">
        <AppHeader
          debuggerStatus={debuggerStatus}
          debuggerError={debuggerError}
          requestCount={requests.length}
          throttle={captureSettings.throttle}
          recording={recorder.recording}
          recordedSteps={recorder.steps.length}
          onStopRecording={recorder.stop}
          picking={picker.picking}
          onPickElement={() => void pickElement()}
          activeBreakpoints={breakpointRules.filter((rule) => rule.enabled).length}
          activeMocks={mockRules.filter((rule) => rule.enabled).length}
          preserveLog={captureSettings.preserveLog}
          onTogglePreserveLog={() => updateCaptureSettings({ preserveLog: !captureSettings.preserveLog })}
          autoSelect={autoSelect}
          onToggleAutoSelect={() => setAutoSelect((active) => !active)}
          groupSelectionMode={groupSelectionMode}
          onToggleGroupSelection={() => setGroupSelectionMode((active) => !active)}
          onOpen={setDialog}
          onOpenPalette={() => setPaletteOpen(true)}
          onClear={clearAll}
          exports={exportActions}
          exportMenuOpen={showExportMenu}
          onExportMenuOpenChange={setShowExportMenu}
        />
        <ListControls
          filter={filter}
          onFilterChange={setFilter}
          counts={counts}
          onOpenQa={openQa}
          showTypeFilter={hasOtherResources}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          urlFilter={urlFilter}
          onUrlFilterChange={setUrlFilter}
          bodySearch={bodySearch}
          onBodySearchChange={setBodySearch}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sortBy={sortBy}
          onSortByChange={(sort) => {
            setSortBy(sort);
            setSortPreset(''); // reset preset when single sort changes
          }}
          sortPreset={sortPreset}
          onSortPresetChange={(preset) => {
            setSortPreset(preset);
            if (preset) setSortBy('newest'); // a preset replaces the single sort
          }}
          compareMode={compareMode}
          onToggleCompare={toggleCompareMode}
          compareSelected={compareRequests.filter(Boolean).length}
          onShowDiff={() => setShowDiff(true)}
        />
        {(picker.picking || picker.error) && (
          <p className={`mt-2 text-[11px] ${picker.error ? 'text-red-500' : 'text-[var(--color-accent)]'}`} role="status">
            {picker.error ? t().pickElementFailed(picker.error) : t().pickElementActive}
          </p>
        )}
        {watch.error && !watch.active && <p className="mt-2 text-[11px] text-red-500" role="status">{t().watchFailed}</p>}
        {watch.active && (
          <WatchLog initialText={watch.initialText} changes={watch.changes} onStop={watch.stop} onOpenMatch={(match, query) => openValueMatch(match, query, false)} />
        )}
      </header>

      <StatusBanners
        debuggerDetached={debuggerStatus === 'detached'}
        onReconnect={reconnectDebugger}
        snapshot={snapshot}
        onReturnToCapture={() => {
          returnToCapture();
          setSelectedRequest(null);
        }}
        update={updates.available}
        currentVersion={updates.current}
        onDismissUpdate={updates.dismiss}
        alerts={watchdog.alerts}
        onOpenAlert={(alert) => openRequestById(alert.requestId)}
        onDismissAlerts={watchdog.dismissAlerts}
        group={{
          active: groupSelectionMode,
          selected: selectedIds.size,
          collections,
          onSelectAll: () => setSelectedIds(new Set(sortedRequests.map((request) => request.id))),
          onDeselectAll: () => setSelectedIds(new Set()),
          onDelete: () => {
            replaceRequests(requests.filter((request) => !selectedIds.has(request.id)));
            setSelectedIds(new Set());
          },
          onExport: () => exports.exportSelected(selectedIds),
          onAddToCollection: (collectionId) => addToCollection(collectionId, Array.from(selectedIds), requests.filter((request) => selectedIds.has(request.id))),
        }}
      />

      {/* Request list, console errors or QA tools */}
      <div ref={listScrollRef} className="relative flex-1 overflow-auto">
        {filter === 'qa' ? (
          <>
            <TeamToolsPanel requests={requests} settings={qaSettings} contractSpecText={contractSpecText} excludedRuleIds={excludedQARuleIds} mockRules={mockRules} maskSecrets={maskSecretsOnExport} recorder={recorder} onSaveMocks={saveMockRules} onApplyProfile={(profile) => {
              handleQASettingsChange(profile.qaSettings);
              handleContractSpecChange(profile.contractSpecText);
              setExcludedRules(profile.excludedRuleIds);
              saveMockRules(profile.mockRules);
            }} />
            <QACheckView
              issues={qaIssues}
              filter={qaFilter}
              onFilterChange={setQaFilter}
              onOpenRequest={(issue) => issue.requestId && openRequestById(issue.requestId)}
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
              onExportSessionReport={exports.exportSessionReport}
              sessions={sessions}
              onCompareSessions={compareSessions}
            />
          </>
        ) : filter === 'console' ? (
          consoleErrors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
              <AlertTriangle className="w-12 h-12 mb-3 opacity-30" strokeWidth={1} />
              <p className="text-sm">{t().noConsoleErrors}</p>
              <p className="text-xs mt-1">{t().noConsoleErrorsDesc}</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {consoleErrors.map((err) => (
                <ConsoleErrorRow key={err.id} error={err} isSelected={selectedError?.id === err.id} onClick={() => setSelectedError(selectedError?.id === err.id ? null : err)} />
              ))}
            </div>
          )
        ) : filteredRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
            <Inbox className="w-12 h-12 mb-3 opacity-30" strokeWidth={1} />
            <p className="text-sm">{t().noRequests}</p>
            <p className="text-xs mt-1">{t().noRequestsDesc}</p>
            <p className="text-[10px] mt-3">{t().paletteHint}</p>
          </div>
        ) : viewMode === 'timeline' ? (
          <TimelineView requests={filteredRequests} selectedRequest={selectedRequest} onSelect={toggleSelected} />
        ) : (
          <RequestList
            mode={viewMode === 'grouped' ? 'grouped' : 'list'}
            requests={sortedRequests}
            groupedRequests={groupedRequests}
            scrollRef={listScrollRef}
            selectedId={selectedRequest?.id ?? null}
            favorites={favorites}
            requestMeta={metaWithNotes}
            tags={tags}
            compareMode={compareMode}
            compareIds={[compareRequests[0]?.id, compareRequests[1]?.id]}
            groupSelectionMode={groupSelectionMode}
            selectedIds={selectedIds}
            contractStatusByRequest={contractStatusByRequest}
            isWatched={isWatched}
            onSelect={toggleSelected}
            onToggleFavorite={toggleFavorite}
            onToggleCompare={toggleCompareRequest}
            onToggleGroupSelect={toggleGroupSelect}
            onTogglePin={togglePin}
          />
        )}
      </div>

      {/* Request detail */}
      <Sheet open={!!selectedRequest} onOpenChange={(open) => !open && closeRequestDetail()}>
        {selectedRequest && (
          <RequestDetail
            request={selectedRequest}
            onClose={closeRequestDetail}
            focusField={focusField?.requestId === selectedRequest.id ? focusField : null}
            onReportMismatch={picker.picked && lastMatch ? reportValueMismatch : undefined}
            onWatch={picker.picked && !watch.active ? () => { closeRequestDetail(); setFinderOpen(false); void watch.start(); } : undefined}
            onShowAllMatches={picker.picked ? () => { setFocusField(null); setSelectedRequest(null); setFinderOpen(true); } : undefined}
            onCopy={() => void exports.copyPrompt(selectedRequest)}
            copied={exports.copied}
            mockRules={mockRules}
            onCreateMock={openMockFor}
            onOpenMockManager={() => {
              setMockInitialRule(null);
              setDialog('mocks');
            }}
            onCreateNegativeMock={(scenario) => void createNegativeMockFor(selectedRequest, scenario)}
            contractDocument={contractDocument}
            collections={collections}
            onAddToCollection={addRequestToCollection}
            note={noteOf(selectedRequest)}
            onNoteChange={(note) => setNote(selectedRequest.id, note)}
            watched={isWatched(selectedRequest)}
            onToggleWatch={() => watchdog.toggle(selectedRequest)}
            requests={requests}
            onOpenRequest={(request) => {
              setFocusField(null);
              setSelectedRequest(request);
            }}
          />
        )}
      </Sheet>

      <Sheet open={finderOpen && !!picker.picked} onOpenChange={(open) => !open && setFinderOpen(false)}>
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
      </Sheet>

      <Sheet open={!!bugReportIssue} onOpenChange={(open) => !open && setBugReportIssue(null)} flex={false}>
        {bugReportIssue && (
          <BugReportDialog
            issue={bugReportIssue}
            request={exports.requestForExport(requests.find((request) => request.id === bugReportIssue.requestId))}
            jiraSettings={jiraSettings}
            onCaptureScreenshot={captureScreenshot}
            onClose={() => setBugReportIssue(null)}
          />
        )}
      </Sheet>

      {/* A request stopped at a breakpoint: edit it, let it go or cancel it. Closing the sheet lets it go. */}
      <Sheet open={pausedRequests.length > 0} onOpenChange={(open) => { if (!open && pausedRequests[0]) resumePausedRequest(pausedRequests[0], 'continue'); }}>
        {pausedRequests[0] && (
          <PausedRequestDialog key={pausedRequests[0].requestId} paused={pausedRequests[0]} queued={pausedRequests.length - 1} onResume={resumePausedRequest} />
        )}
      </Sheet>

      <Sheet open={!!selectedError} onOpenChange={(open) => !open && setSelectedError(null)}>
        {selectedError && <ConsoleErrorDetail error={selectedError} onClose={() => setSelectedError(null)} />}
      </Sheet>

      <Sheet open={dialog === 'mocks'} onOpenChange={(open) => { if (!open) { closeDialog(); setMockInitialRule(null); } }}>
        <MockManager rules={mockRules} onSave={saveMockRules} onClose={() => { closeDialog(); setMockInitialRule(null); }} initialRule={mockInitialRule} />
      </Sheet>

      <Sheet open={dialog === 'breakpoints'} onOpenChange={(open) => !open && closeDialog()}>
        <BreakpointManager rules={breakpointRules} onSave={saveBreakpointRules} onClose={closeDialog} />
      </Sheet>

      <Sheet open={dialog === 'sessions'} onOpenChange={(open) => !open && closeDialog()}>
        <SessionHistory
          sessions={sessions}
          onLoad={loadSession}
          onDelete={deleteSession}
          onTogglePin={(sessionId, pinned) => updateSession(sessionId, { pinned })}
          onClose={closeDialog}
        />
      </Sheet>

      <Sheet open={dialog === 'settings'} onOpenChange={(open) => !open && closeDialog()}>
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
          checkUpdates={checkUpdates}
          onCheckUpdatesChange={handleCheckUpdatesChange}
          watchedEndpoints={watchdog.watched}
          onWatchedEndpointsChange={watchdog.save}
          onShowWhatsNew={() => { closeDialog(); whatsNew.show(); }}
          onClose={closeDialog}
        />
      </Sheet>

      <Sheet open={dialog === 'collections' && !viewingCollection} onOpenChange={(open) => { if (!open) { closeDialog(); setViewingCollection(null); } }}>
        <CollectionManager
          collections={collections}
          onCreate={createCollection}
          onDelete={deleteCollection}
          onViewCollection={(collection) => setViewingCollection(collection)}
          onClose={closeDialog}
        />
      </Sheet>

      <Sheet open={!!viewingCollection} onOpenChange={(open) => !open && setViewingCollection(null)}>
        {viewingCollection && (
          <CollectionViewer
            collection={viewingCollection}
            onRemoveRequest={removeFromCollection}
            onSelectRequest={(req: ApiRequest) => {
              setSelectedRequest(req);
              setViewingCollection(null);
              closeDialog();
            }}
            onBack={() => setViewingCollection(null)}
          />
        )}
      </Sheet>

      <Sheet open={dialog === 'tags'} onOpenChange={(open) => !open && closeDialog()}>
        <TagManager tags={tags} onCreate={createTag} onDelete={deleteTag} onClose={closeDialog} />
      </Sheet>

      <Sheet open={whatsNew.open && !paletteOpen} onOpenChange={(open) => !open && whatsNew.close()}>
        <WhatsNewDialog version={whatsNew.version} onClose={whatsNew.close} onOpenPalette={() => setPaletteOpen(true)} />
      </Sheet>

      {paletteOpen && (
        <CommandPalette
          commands={paletteCommands()}
          requests={requests}
          onOpenRequest={(request) => {
            setFilter('all');
            setSelectedRequest(request);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      <DiffDialog open={showDiff} onClose={() => setShowDiff(false)} requests={compareRequests} />
    </div>
  );
}
