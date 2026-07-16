import { Dialog } from '@base-ui-components/react/dialog';
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  CheckSquare,
  Download,
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
  Search,
  Settings,
  Shield,
  Tag,
  Terminal,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BreakpointManager,
  CollectionManager,
  ConsoleErrorDetail,
  ConsoleErrorRow,
  DiffDialog,
  FilterButton,
  GroupedView,
  MockManager,
  RequestDetail,
  RequestRow,
  SessionHistory,
  SettingsPanel,
  TagManager,
  TimelineView
} from './components';
import type { FontSize } from './components';
import type {
  ApiRequest,
  BreakpointRule,
  ConsoleError,
  MockRule,
  RequestCollection,
  RequestTag,
  RequestMeta,
  SortOption,
  SortPresetId,
} from './types';
import {
  generateClaudePrompt,
  generateHar,
  generateMarkdownReport,
  generatePostmanCollection,
  generateOpenApiSpec,
  generateJsonSchema,
  generateCsv,
  generateBulkCurl,
} from './utils';
import { t } from './locales';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

export default function App() {
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [consoleErrors, setConsoleErrors] = useState<ConsoleError[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<ApiRequest | null>(
    null
  );
  const [selectedError, setSelectedError] = useState<ConsoleError | null>(null);
  const [filter, setFilter] = useState<'all' | 'errors' | 'slow' | 'console'>(
    'all'
  );
  const [urlFilter, setUrlFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [autoSelect, setAutoSelect] = useState(false);
  const [mockRules, setMockRules] = useState<MockRule[]>([]);
  const [showMockManager, setShowMockManager] = useState(false);
  const [mockInitialRule, setMockInitialRule] = useState<MockRule | null>(null);
  const [breakpointRules, setBreakpointRules] = useState<BreakpointRule[]>([]);
  const [showBreakpointManager, setShowBreakpointManager] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]); // Array of request IDs
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [sessions, setSessions] = useState<
    Array<{ id: string; name: string; timestamp: number; count: number }>
  >([]);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // New features state
  const [compareMode, setCompareMode] = useState(false);
  const [compareRequests, setCompareRequests] = useState<
    [ApiRequest | null, ApiRequest | null]
  >([null, null]);
  const [showDiff, setShowDiff] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'timeline' | 'grouped'>(
    'grouped'
  );
  const [bodySearch, setBodySearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [sortPreset, setSortPreset] = useState<SortPresetId | ''>('');

  // Sort presets definition
  const sortPresets: Array<{
    id: SortPresetId;
    labelKey: keyof ReturnType<typeof t>;
    comparators: Array<(a: ApiRequest, b: ApiRequest) => number>;
  }> = useMemo(() => [
    {
      id: 'method-status',
      labelKey: 'sortPresetMethodStatus',
      comparators: [
        (a, b) => a.method.localeCompare(b.method),
        (a, b) => (b.status || 0) - (a.status || 0),
      ],
    },
    {
      id: 'method-type',
      labelKey: 'sortPresetMethodType',
      comparators: [
        (a, b) => a.method.localeCompare(b.method),
        (a, b) => a.type.localeCompare(b.type),
      ],
    },
    {
      id: 'status-method',
      labelKey: 'sortPresetStatusMethod',
      comparators: [
        (a, b) => (b.status || 0) - (a.status || 0),
        (a, b) => a.method.localeCompare(b.method),
      ],
    },
    {
      id: 'type-method',
      labelKey: 'sortPresetTypeMethod',
      comparators: [
        (a, b) => a.type.localeCompare(b.type),
        (a, b) => a.method.localeCompare(b.method),
      ],
    },
    {
      id: 'type-status',
      labelKey: 'sortPresetTypeStatus',
      comparators: [
        (a, b) => a.type.localeCompare(b.type),
        (a, b) => (b.status || 0) - (a.status || 0),
      ],
    },
  ], []);

  // Group selection state
  const [groupSelectionMode, setGroupSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Collections & Tags state
  const [collections, setCollections] = useState<RequestCollection[]>([]);
  const [tags, setTags] = useState<RequestTag[]>([]);
  const [requestMeta, setRequestMeta] = useState<Record<string, RequestMeta>>({});
  const [showCollectionManager, setShowCollectionManager] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);

  // Debugger state
  const [debuggerStatus, setDebuggerStatus] = useState<'attached' | 'detached' | 'error'>('detached');
  const [debuggerError, setDebuggerError] = useState<string | null>(null);
  const [pausedRequest, setPausedRequest] = useState<{ requestId: string; url: string; method: string } | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [fontSize, setFontSize] = useState<FontSize>('medium');

  // Connect to background via port (triggers debugger attach)
  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'sidepanel' });
    portRef.current = port;

    port.onDisconnect.addListener(() => {
      portRef.current = null;
      setDebuggerStatus('detached');
    });

    return () => {
      port.disconnect();
      portRef.current = null;
    };
  }, []);

  // Load mock and breakpoint rules on mount
  // Clean up copy timer on unmount
  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_MOCK_RULES' }, (response) => {
      if (response?.rules) {
        setMockRules(response.rules);
      }
    });
    chrome.runtime.sendMessage({ type: 'GET_BREAKPOINT_RULES' }, (response) => {
      if (response?.rules) {
        setBreakpointRules(response.rules);
      }
    });
  }, []);

  // Load favorites, sessions, collections, tags, requestMeta, and settings from storage
  useEffect(() => {
    chrome.storage.local.get(
      ['favorites', 'sessions', 'darkMode', 'fontSize', 'collections', 'tags', 'requestMeta'],
      (result: {
        favorites?: string[];
        sessions?: Array<{
          id: string;
          name: string;
          timestamp: number;
          count: number;
        }>;
        darkMode?: boolean;
        fontSize?: FontSize;
        collections?: RequestCollection[];
        tags?: RequestTag[];
        requestMeta?: Record<string, RequestMeta>;
      }) => {
        if (result.favorites) setFavorites(result.favorites);
        if (result.sessions) setSessions(result.sessions);
        if (result.darkMode !== undefined) setDarkMode(result.darkMode);
        if (result.fontSize) setFontSize(result.fontSize);
        if (result.collections) setCollections(result.collections);
        if (result.tags) setTags(result.tags);
        if (result.requestMeta) setRequestMeta(result.requestMeta);
      }
    );
  }, []);

  // Apply dark mode and font size to document
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    document.documentElement.setAttribute('data-font-size', fontSize);
  }, [darkMode, fontSize]);

  // Save settings when they change
  const handleDarkModeChange = useCallback((enabled: boolean) => {
    setDarkMode(enabled);
    chrome.storage.local.set({ darkMode: enabled });
  }, []);

  const handleFontSizeChange = useCallback((size: FontSize) => {
    setFontSize(size);
    chrome.storage.local.set({ fontSize: size });
  }, []);

  // Load existing requests and console errors, listen for new ones
  useEffect(() => {
    // Get existing requests
    chrome.runtime.sendMessage({ type: 'GET_API_REQUESTS' }, (response) => {
      if (response?.requests) {
        setRequests(response.requests);
      }
    });

    // Get existing console errors
    chrome.runtime.sendMessage({ type: 'GET_CONSOLE_ERRORS' }, (response) => {
      if (response?.errors) {
        setConsoleErrors(response.errors);
      }
    });

    // Listen for new requests, errors, and debugger status
    const handleMessage = (message: Record<string, unknown>) => {
      if (message.type === 'NEW_API_REQUEST') {
        setRequests((prev) =>
          [message.payload as ApiRequest, ...prev].slice(0, 100)
        );
      }
      if (message.type === 'NEW_CONSOLE_ERROR') {
        setConsoleErrors((prev) =>
          [message.payload as ConsoleError, ...prev].slice(0, 50)
        );
      }
      if (message.type === 'DEBUGGER_STATUS') {
        const status = message.status as 'attached' | 'detached' | 'error';
        setDebuggerStatus(status);
        if (status === 'error') {
          setDebuggerError(message.error as string);
        } else {
          setDebuggerError(null);
        }
      }
      if (message.type === 'BREAKPOINT_REQUEST_PAUSED') {
        const req = message.request as { url: string; method: string };
        setPausedRequest({
          requestId: message.requestId as string,
          url: req.url,
          method: req.method,
        });
      }
      if (message.type === 'BREAKPOINT_REQUEST_EXPIRED') {
        setPausedRequest(null);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Auto-select new requests
  useEffect(() => {
    if (autoSelect && requests.length > 0) {
      setSelectedRequest(requests[0]);
    }
  }, [autoSelect, requests]);

  // Refresh when tab changes
  useEffect(() => {
    const handleTabChange = () => {
      chrome.runtime.sendMessage({ type: 'GET_API_REQUESTS' }, (response) => {
        if (response?.requests) {
          setRequests(response.requests);
          setSelectedRequest(null);
        }
      });
      chrome.runtime.sendMessage({ type: 'GET_CONSOLE_ERRORS' }, (response) => {
        if (response?.errors) {
          setConsoleErrors(response.errors);
          setSelectedError(null);
        }
      });
    };

    chrome.tabs.onActivated.addListener(handleTabChange);
    return () => chrome.tabs.onActivated.removeListener(handleTabChange);
  }, []);

  const reconnectDebugger = useCallback(() => {
    if (portRef.current) {
      portRef.current.disconnect();
    }
    const port = chrome.runtime.connect({ name: 'sidepanel' });
    portRef.current = port;
    port.onDisconnect.addListener(() => {
      portRef.current = null;
      setDebuggerStatus('detached');
    });
  }, []);

  const resumePausedRequest = useCallback((action: 'continue' | 'cancel') => {
    if (!pausedRequest) return;
    chrome.runtime.sendMessage({
      type: 'RESUME_PAUSED_REQUEST',
      requestId: pausedRequest.requestId,
      action,
    });
    setPausedRequest(null);
  }, [pausedRequest]);

  const clearRequests = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'CLEAR_API_REQUESTS' }, () => {
      setRequests([]);
      setSelectedRequest(null);
    });
  }, []);

  const clearConsoleErrors = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'CLEAR_CONSOLE_ERRORS' }, () => {
      setConsoleErrors([]);
      setSelectedError(null);
    });
  }, []);

  const clearAll = useCallback(() => {
    clearRequests();
    clearConsoleErrors();
  }, [clearRequests, clearConsoleErrors]);

  const saveMockRules = useCallback((rules: MockRule[]) => {
    setMockRules(rules);
    chrome.runtime.sendMessage({ type: 'SAVE_MOCK_RULES', payload: rules });
  }, []);

  const saveBreakpointRules = useCallback((rules: BreakpointRule[]) => {
    setBreakpointRules(rules);
    chrome.runtime.sendMessage({
      type: 'SAVE_BREAKPOINT_RULES',
      payload: rules,
    });
  }, []);

  // Export to Postman collection
  const exportToPostman = useCallback(() => {
    const collection = generatePostmanCollection(requests);
    const blob = new Blob([JSON.stringify(collection, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-debugger-${new Date()
      .toISOString()
      .slice(0, 10)}.postman_collection.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  }, [requests]);

  // Toggle favorite
  const toggleFavorite = useCallback((requestId: string) => {
    setFavorites((prev) => {
      const newFavorites = prev.includes(requestId)
        ? prev.filter((id) => id !== requestId)
        : [...prev, requestId].slice(-200); // Cap at 200 to prevent unbounded growth
      chrome.storage.local.set({ favorites: newFavorites });
      return newFavorites;
    });
  }, []);

  // Save current session
  const saveSession = useCallback(() => {
    if (requests.length === 0) return;

    const sessionId = crypto.randomUUID();
    const sessionName = `Session ${new Date().toLocaleString()}`;
    const newSession = {
      id: sessionId,
      name: sessionName,
      timestamp: Date.now(),
      count: requests.length,
    };

    // Save session metadata, evict oldest if over 20
    const allSessions = [newSession, ...sessions];
    const newSessions = allSessions.slice(0, 20);
    const evicted = allSessions.slice(20);
    setSessions(newSessions);

    // Save session data
    chrome.storage.local.set({
      sessions: newSessions,
      [`session_${sessionId}`]: requests,
    });

    // Clean up orphaned session data
    if (evicted.length > 0) {
      chrome.storage.local.remove(evicted.map(s => `session_${s.id}`));
    }
    setShowExportMenu(false);
  }, [requests, sessions]);

  // Load session
  const loadSession = useCallback((sessionId: string) => {
    chrome.storage.local.get(
      [`session_${sessionId}`],
      (result: Record<string, ApiRequest[] | undefined>) => {
        const sessionData = result[`session_${sessionId}`];
        if (sessionData) {
          setRequests(sessionData);
          setSelectedRequest(null);
          setShowSessionHistory(false);
        }
      }
    );
  }, []);

  // Delete session
  const deleteSession = useCallback(
    (sessionId: string) => {
      const newSessions = sessions.filter((s) => s.id !== sessionId);
      setSessions(newSessions);
      chrome.storage.local.remove([`session_${sessionId}`]);
      chrome.storage.local.set({ sessions: newSessions });
    },
    [sessions]
  );

  const filteredRequests = requests.filter((req) => {
    // URL filter
    if (
      urlFilter &&
      (!req.url || !req.url.toLowerCase().includes(urlFilter.toLowerCase()))
    ) {
      return false;
    }
    // Body search filter
    if (bodySearch) {
      const searchLower = bodySearch.toLowerCase();
      const reqBody = req.requestBody
        ? String(req.requestBody).toLowerCase()
        : '';
      const resBody = req.responseBody
        ? JSON.stringify(req.responseBody).toLowerCase()
        : '';
      if (!reqBody.includes(searchLower) && !resBody.includes(searchLower)) {
        return false;
      }
    }
    // Status filter
    if (filter === 'errors') return req.status >= 400 || req.error;
    if (filter === 'slow') return req.duration > 1000;
    return true;
  });

  // Group requests by domain
  const groupedRequests = filteredRequests.reduce((acc, req) => {
    try {
      const domain = new URL(req.url).hostname;
      if (!acc[domain]) acc[domain] = [];
      acc[domain].push(req);
    } catch {
      if (!acc['unknown']) acc['unknown'] = [];
      acc['unknown'].push(req);
    }
    return acc;
  }, {} as Record<string, ApiRequest[]>);

  // Sort requests
  const sortedRequests = useMemo(() => {
    const sorted = [...filteredRequests];

    // If a sort preset is active, apply multi-criteria sort
    if (sortPreset) {
      const preset = sortPresets.find(p => p.id === sortPreset);
      if (preset) {
        sorted.sort((a, b) => {
          for (const cmp of preset.comparators) {
            const result = cmp(a, b);
            if (result !== 0) return result;
          }
          return 0;
        });
        return sorted;
      }
    }

    // Otherwise use single-criteria sort
    switch (sortBy) {
      case 'newest':
        sorted.sort((a, b) => b.timestamp - a.timestamp);
        break;
      case 'oldest':
        sorted.sort((a, b) => a.timestamp - b.timestamp);
        break;
      case 'method':
        sorted.sort((a, b) => a.method.localeCompare(b.method));
        break;
      case 'status':
        sorted.sort((a, b) => (b.status || 0) - (a.status || 0));
        break;
      case 'duration':
        sorted.sort((a, b) => b.duration - a.duration);
        break;
      case 'type':
        sorted.sort((a, b) => a.type.localeCompare(b.type));
        break;
      case 'domain':
        sorted.sort((a, b) => {
          try {
            return new URL(a.url).hostname.localeCompare(new URL(b.url).hostname);
          } catch {
            return 0;
          }
        });
        break;
    }
    return sorted;
  }, [filteredRequests, sortBy, sortPreset, sortPresets]);

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

  const apiErrorCount = requests.filter(
    (r) => r.status >= 400 || r.error
  ).length;
  const slowCount = requests.filter((r) => r.duration > 1000).length;
  const consoleErrorCount = consoleErrors.length;

  const copyToClipboard = useCallback(async (req: ApiRequest) => {
    const markdown = generateClaudePrompt(req);
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }, []);

  const exportToHar = useCallback(() => {
    const har = generateHar(requests);
    const blob = new Blob([JSON.stringify(har, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-debugger-${new Date().toISOString().slice(0, 10)}.har`;
    a.click();
    URL.revokeObjectURL(url);
  }, [requests]);

  const exportToMarkdown = useCallback(() => {
    // Get page info from the first request or use defaults
    const pageInfo = requests.length > 0
      ? { url: requests[0].pageUrl, title: requests[0].pageTitle }
      : { url: 'Неизвестно', title: 'Неизвестно' };

    const report = generateMarkdownReport(requests, consoleErrors, pageInfo);
    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-report-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  }, [requests, consoleErrors]);

  // New export functions
  const exportToOpenApi = useCallback(() => {
    const spec = generateOpenApiSpec(requests);
    const blob = new Blob([spec], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openapi-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  }, [requests]);

  const exportToJsonSchema = useCallback(() => {
    const selected = selectedRequest?.responseBody;
    if (!selected) return;
    const schema = generateJsonSchema(selected);
    const blob = new Blob([schema], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `json-schema-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  }, [selectedRequest]);

  const exportToCsv = useCallback(() => {
    const csv = generateCsv(requests);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  }, [requests]);

  const exportToBulkCurl = useCallback(() => {
    const curl = generateBulkCurl(requests);
    const blob = new Blob([curl], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `curl-collection-${new Date().toISOString().slice(0, 10)}.sh`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  }, [requests]);

  // Collections management
  const createCollection = useCallback((name: string, description?: string, color?: string) => {
    const newCollection: RequestCollection = {
      id: crypto.randomUUID(),
      name,
      description: description || '',
      color: color || '#2563EB',
      requestIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = [...collections, newCollection];
    setCollections(updated);
    chrome.storage.local.set({ collections: updated });
  }, [collections]);

  const deleteCollection = useCallback((collectionId: string) => {
    const updated = collections.filter(c => c.id !== collectionId);
    setCollections(updated);
    // Also remove collectionId from requestMeta
    const newMeta = { ...requestMeta };
    Object.keys(newMeta).forEach(id => {
      if (newMeta[id].collectionId === collectionId) {
        const { collectionId: _, ...rest } = newMeta[id];
        newMeta[id] = rest as RequestMeta;
      }
    });
    setRequestMeta(newMeta);
    chrome.storage.local.set({ collections: updated, requestMeta: newMeta });
  }, [collections, requestMeta]);

  const addToCollection = useCallback((collectionId: string, requestIds: string[]) => {
    const updated = collections.map(c => {
      if (c.id !== collectionId) return c;
      const newIds = [...new Set([...c.requestIds, ...requestIds])];
      return { ...c, requestIds: newIds, updatedAt: Date.now() };
    });
    setCollections(updated);
    // Update requestMeta
    const newMeta = { ...requestMeta };
    requestIds.forEach(id => {
      newMeta[id] = { ...(newMeta[id] || {}), collectionId } as RequestMeta;
    });
    setRequestMeta(newMeta);
    chrome.storage.local.set({ collections: updated, requestMeta: newMeta });
  }, [collections, requestMeta]);

  // Tags management
  const createTag = useCallback((name: string, color: string) => {
    const newTag: RequestTag = {
      id: crypto.randomUUID(),
      name,
      color,
    };
    const updated = [...tags, newTag];
    setTags(updated);
    chrome.storage.local.set({ tags: updated });
  }, [tags]);

  const deleteTag = useCallback((tagId: string) => {
    const updated = tags.filter(t => t.id !== tagId);
    setTags(updated);
    // Remove tag from all requestMeta
    const newMeta = { ...requestMeta };
    Object.keys(newMeta).forEach(id => {
      if (newMeta[id]?.tags?.includes(tagId)) {
        newMeta[id] = { ...newMeta[id], tags: newMeta[id].tags!.filter(t => t !== tagId) };
      }
    });
    setRequestMeta(newMeta);
    chrome.storage.local.set({ tags: updated, requestMeta: newMeta });
  }, [tags, requestMeta]);

  // Pin/unpin
  const togglePin = useCallback((requestId: string) => {
    const newMeta = { ...requestMeta };
    const current = newMeta[requestId] || {} as RequestMeta;
    newMeta[requestId] = { ...current, pinned: !current.pinned };
    setRequestMeta(newMeta);
    chrome.storage.local.set({ requestMeta: newMeta });
  }, [requestMeta]);

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
    const remaining = requests.filter(r => !selectedIds.has(r.id));
    setRequests(remaining);
    setSelectedIds(new Set());
    chrome.runtime.sendMessage({ type: 'SET_API_REQUESTS', payload: remaining });
  }, [requests, selectedIds]);

  const exportSelected = useCallback(() => {
    const selectedReqs = requests.filter(r => selectedIds.has(r.id));
    if (selectedReqs.length === 0) return;
    const curl = generateBulkCurl(selectedReqs);
    const blob = new Blob([curl], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selected-curl-${new Date().toISOString().slice(0, 10)}.sh`;
    a.click();
    URL.revokeObjectURL(url);
  }, [requests, selectedIds]);

  // Integrate keyboard shortcuts
  useKeyboardShortcuts({
    'ctrl+f': () => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder*="URL"]');
      input?.focus();
    },
    'ctrl+shift+f': () => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder*="теле"]');
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

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="px-4 pt-5 pb-4 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[var(--color-accent)] rounded-lg flex items-center justify-center">
              <Terminal className="w-4 h-4 text-white" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-base font-semibold">{t().appTitle}</h1>
              <p className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                  debuggerStatus === 'attached' ? 'bg-green-500' :
                  debuggerStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'
                }`} />
                {debuggerStatus === 'attached'
                  ? t().requestsCount(requests.length)
                  : debuggerStatus === 'error'
                  ? (debuggerError || t().cannotCapture)
                  : t().notCapturing}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowBreakpointManager(true)}
              className={`p-1.5 rounded transition-colors ${
                breakpointRules.some((r) => r.enabled)
                  ? 'bg-red-500 text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
              }`}
              title={t().breakpointsActive(breakpointRules.filter((r) => r.enabled).length)}
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowMockManager(true)}
              className={`p-1.5 rounded transition-colors ${
                mockRules.some((r) => r.enabled)
                  ? 'bg-purple-500 text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
              }`}
              title={t().mockRulesActive(mockRules.filter((r) => r.enabled).length)}
            >
              <Shield className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setAutoSelect(!autoSelect)}
              className={`p-1.5 rounded transition-colors ${
                autoSelect
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
                disabled={requests.length === 0}
                className="p-1.5 rounded transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] disabled:opacity-30"
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
                </div>
              )}
            </div>
            <button
              onClick={() => setGroupSelectionMode(prev => !prev)}
              className={`p-1.5 rounded transition-colors ${
                groupSelectionMode
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
        <div className="flex gap-1 p-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
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
        </div>

        {/* URL Filter */}
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={urlFilter}
            onChange={(e) => setUrlFilter(e.target.value)}
            placeholder={t().filterByUrl}
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
        <div className="flex items-center justify-between mt-2">
          <div className="flex gap-1 p-0.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)]">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'list'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
              title={t().listView}
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
              title={t().timelineView}
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'grouped'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
              title={t().groupByDomain}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1">
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
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                compareMode
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

      {/* Breakpoint paused banner */}
      {pausedRequest && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Pause className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
              <span className="text-xs font-medium text-red-700 dark:text-red-300 shrink-0">
                {pausedRequest.method}
              </span>
              <span className="text-xs text-red-600 dark:text-red-400 truncate">
                {pausedRequest.url}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <button
                onClick={() => resumePausedRequest('cancel')}
                className="px-2 py-0.5 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded text-xs hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
              >
                {t().cancel}
              </button>
              <button
                onClick={() => resumePausedRequest('continue')}
                className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition-colors"
              >
                {t().continue}
              </button>
            </div>
          </div>
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
                    addToCollection(e.target.value, Array.from(selectedIds));
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
        {filter === 'console' ? (
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
              />
            ))}
          </div>
        )}
      </div>

      {/* Request Detail Bottom Sheet */}
      <Dialog.Root
        open={!!selectedRequest}
        onOpenChange={(open) => !open && setSelectedRequest(null)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl max-h-[85vh] flex flex-col shadow-xl">
            {selectedRequest && (
              <RequestDetail
                request={selectedRequest}
                onClose={() => setSelectedRequest(null)}
                onCopy={() => copyToClipboard(selectedRequest)}
                copied={copied}
                mockRules={mockRules}
                onCreateMock={(rule) => {
                  saveMockRules([...mockRules, rule])
                  setMockInitialRule(rule)
                  setShowMockManager(true)
                }}
                onOpenMockManager={() => {
                  setMockInitialRule(null)
                  setShowMockManager(true)
                }}
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
          <Dialog.Popup className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl max-h-[85vh] flex flex-col shadow-xl">
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
          <Dialog.Popup className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl max-h-[90vh] flex flex-col shadow-xl">
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
          <Dialog.Popup className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl max-h-[90vh] flex flex-col shadow-xl">
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
          <Dialog.Popup className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-2xl max-h-[90vh] flex flex-col shadow-xl">
            <SessionHistory
              sessions={sessions}
              onLoad={loadSession}
              onDelete={deleteSession}
              onClose={() => setShowSessionHistory(false)}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Settings Dialog */}
      <Dialog.Root open={showSettings} onOpenChange={setShowSettings}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-2xl max-h-[70vh] flex flex-col shadow-xl">
            <SettingsPanel
              darkMode={darkMode}
              fontSize={fontSize}
              onDarkModeChange={handleDarkModeChange}
              onFontSizeChange={handleFontSizeChange}
              onClose={() => setShowSettings(false)}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Collection Manager Dialog */}
      <Dialog.Root
        open={showCollectionManager}
        onOpenChange={setShowCollectionManager}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
          <Dialog.Popup className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl max-h-[85vh] flex flex-col shadow-xl">
            <CollectionManager
              collections={collections}
              onCreate={createCollection}
              onDelete={deleteCollection}
              onClose={() => setShowCollectionManager(false)}
            />
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
          <Dialog.Popup className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl max-h-[85vh] flex flex-col shadow-xl">
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
