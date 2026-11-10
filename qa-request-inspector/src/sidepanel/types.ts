export type ResourceType =
  | "fetch"
  | "xhr"
  | "document"
  | "script"
  | "stylesheet"
  | "image"
  | "font"
  | "media"
  | "other";

/** Phases of a request in milliseconds (from the browser's resource timing). */
export interface RequestTimings {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
}

export interface GraphQLInfo {
  operationName: string;
  operationType: "query" | "mutation" | "subscription";
}

export interface ApiRequest {
  id: string;
  type: ResourceType;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  status: number;
  statusText: string;
  duration: number;
  timestamp: number;
  error: string | null;
  pageUrl: string;
  pageTitle: string;
  mocked?: boolean;
  /** The request or its response was changed at a breakpoint or by a "patch" rule. */
  modified?: boolean;
  timings?: RequestTimings;
  /** Bytes received over the network (compressed), when the browser reported it. */
  transferSize?: number;
  protocol?: string;
  remoteAddress?: string;
  fromCache?: boolean;
  graphql?: GraphQLInfo;
}

export type RuleMode = "mock" | "patch" | "delay" | "block";

/** One change of a "patch" rule: a JSON path in the real response and its new value (JSON text). */
export interface ResponsePatch {
  path: string;
  value: string;
  remove?: boolean;
}

export interface MockRule {
  id: string;
  urlPattern: string;
  method: "ALL" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * mock (default): answer instead of the server; patch: change fields of the real response;
   * delay: send the real request later; block: fail the request.
   */
  mode?: RuleMode;
  status: number;
  statusText: string;
  responseBody: string;
  responseHeaders: Record<string, string>;
  enabled: boolean;
  delay?: number; // ms delay before responding
  abort?: boolean; // fail the matched request (used for timeout simulation)
  description?: string;
  sequence?: Array<{ status: number; responseBody: string; delay?: number; abort?: boolean }>;
  sequenceEnd?: "repeat" | "last" | "passthrough";
  /** patch mode: fields to change in the real JSON response. */
  patches?: ResponsePatch[];
  /** patch mode: replace the HTTP status as well (0 or undefined keeps the real one). */
  patchStatus?: number;
  createdAt: number;
  updatedAt: number;
}

export interface BreakpointRule {
  id: string;
  urlPattern: string;
  method: "ALL" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  enabled: boolean;
  /** request (default): pause before sending; response: pause when the response arrives. */
  stage?: "request" | "response";
}

/** Capture settings shared with the background (public/captureStore.js normalizes them). */
export interface CaptureSettings {
  preserveLog: boolean;
  maxRequests: number;
  captureAllResources: boolean;
  throttle: "none" | "fast3g" | "slow3g" | "offline" | "custom";
  customLatencyMs: number;
  customDownloadKbps: number;
  customUploadKbps: number;
}

export interface JiraSettings {
  baseUrl: string;
  /** basic: e-mail + API token (Jira Cloud); bearer: personal access token (Jira Server / Data Center). */
  authType: "basic" | "bearer";
  email: string;
  token: string;
  projectKey: string;
  issueType: string;
}

export type Language = "ru" | "en";

/** A WebSocket frame or an SSE message kept by the background. */
export interface StreamMessage {
  id: string;
  protocol: string;
  direction: string;
  url: string;
  /** Text of the message; for a binary frame the first bytes, base64-encoded. */
  data: string;
  timestamp: number;
  binary?: boolean;
  /** Size of a binary frame in bytes. */
  size?: number;
}

/** A request paused at a breakpoint, with everything needed to edit it. */
export interface PausedRequest {
  requestId: string;
  tabId: number;
  stage: "request" | "response";
  url: string;
  method: string;
  headers: Record<string, string>;
  postData: string | null;
  response?: { status: number; headers: Record<string, string>; body: string; binary: boolean };
}

export interface ConsoleError {
  id: string;
  type: "error" | "unhandledrejection" | "console.error";
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  stack?: string | null;
  timestamp: number;
  pageUrl: string;
  pageTitle: string;
}

export interface UsageResult {
  count: number;
  elements: Array<{
    selector: string;
    textPreview: string;
    isVisible: boolean;
    tagName: string;
  }>;
}

export interface Session {
  id: string;
  name: string;
  timestamp: number;
  count: number;
  /** A reference session: kept until deleted, outside the 24-hour / three-session limit. */
  pinned?: boolean;
}

export type HttpMethod = "ALL" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type FilterType = "all" | "errors" | "slow" | "console";
export type SortOption =
  | "newest"
  | "oldest"
  | "method"
  | "status"
  | "duration"
  | "type"
  | "domain";

/** Sort presets — multi-criteria sort combinations */
export type SortPresetId =
  | "method-status"
  | "method-type"
  | "status-method"
  | "type-method"
  | "type-status";

export interface SortPreset {
  id: SortPresetId;
  labelKey: string; // locale key
  comparators: Array<(a: ApiRequest, b: ApiRequest) => number>;
}
export type ViewMode = "list" | "timeline" | "grouped";
export type ScanStatus = "idle" | "scanning" | "complete";

// Load Testing types
export interface LoadTestConfig {
  iterations: number; // Total requests to send (1-100)
  concurrency: number; // Parallel requests (1-10)
  delayMs: number; // Delay between batches (0-5000ms)
  timeout: number; // Request timeout (1000-60000ms)
}

export interface LoadTestRun {
  status: number;
  duration: number;
  error?: string;
  timestamp: number;
  /** URL of the request (for scenario tests) */
  url?: string;
  /** Method of the request (for scenario tests) */
  method?: string;
}

export interface LoadTestStats {
  total: number;
  successful: number;
  failed: number;
  minTime: number;
  maxTime: number;
  avgTime: number;
  medianTime: number;
  p95Time: number;
  p99Time: number;
  requestsPerSecond: number;
}

export interface LoadTestResult {
  config: LoadTestConfig;
  runs: LoadTestRun[];
  stats: LoadTestStats;
  startTime: number;
  endTime: number;
}

export interface SavedLoadTest {
  id: string;
  url: string;
  method: string;
  result: LoadTestResult;
  savedAt: number;
  /** Optional scenario name */
  scenarioName?: string;
}

/** A single step in a load test scenario */
export interface ScenarioStep {
  id: string;
  request: ApiRequest;
  /** Label for display purposes */
  label: string;
  /** Delay before this step (ms) */
  delayMs: number;
}

/** A load test scenario — sequence of requests */
export interface LoadTestScenario {
  id: string;
  name: string;
  steps: ScenarioStep[];
  config: LoadTestConfig;
  createdAt: number;
  updatedAt: number;
}

/** Comparison between two load test results */
export interface LoadTestComparison {
  id: string;
  label: string;
  resultA: LoadTestResult;
  resultB: LoadTestResult;
  createdAt: number;
}

/** A single point on a time-series chart */
export interface TimeSeriesPoint {
  /** Seconds since test start */
  time: number;
  /** Average duration at this point */
  avgDuration: number;
  /** Success rate at this point (0-1) */
  successRate: number;
  /** Requests per second at this point */
  rps: number;
}

// Collections & Tags
export interface RequestCollection {
  id: string;
  name: string;
  description: string;
  color: string;
  requestIds: string[];
  /** Полные данные запросов, сохранённые в коллекции (для постоянного хранения) */
  requests: ApiRequest[];
  createdAt: number;
  updatedAt: number;
}

export interface RequestTag {
  id: string;
  name: string;
  color: string;
}

export interface RequestMeta {
  pinned?: boolean;
  tags?: string[]; // tag IDs
  notes?: string;
  collectionId?: string;
}

// Keyboard shortcuts
export interface KeyboardShortcut {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  description: string;
  action: string;
}

// Group operations
export type GroupOperation =
  | "delete"
  | "export"
  | "addToCollection"
  | "tag"
  | "pin"
  | "copy";
