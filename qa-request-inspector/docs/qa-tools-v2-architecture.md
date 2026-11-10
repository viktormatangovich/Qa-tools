# QA Tools 2.0 architecture

## Current architecture

The extension is fully local and uses a single Chrome DevTools Protocol capture path:

`background.js (Network + Runtime CDP) -> chrome.runtime messages -> React side panel`

- `background.js` attaches to the active tab while the side panel is open. It captures XHR/fetch events in `apiRequests` and JavaScript/runtime errors in `consoleErrors`.
- `App.tsx` loads the captured tab state, subscribes to `NEW_API_REQUEST` and `NEW_CONSOLE_ERROR`, and owns existing Network Inspector, Console, mocks, breakpoints, sessions, and exports.
- `content.js` is limited to DOM field search/highlighting and is not a network capture path.

Existing `ApiRequest` and `ConsoleError` records are therefore the integration boundary for automated QA. No new debugger attachment, content-script interception, backend, telemetry, or remote processing is introduced.

## Auto QA Check MVP

`src/sidepanel/qa/` is a pure, extensible analysis layer:

```text
ApiRequest[] + ConsoleError[] + QASettings
             -> qaRulesEngine
             -> QAIssue[]
             -> QACheckView
```

`QAIssue` is the common result model for every analyser. It contains severity, category, timestamp, a safe evidence record, and optional request linkage. Evidence intentionally excludes request/response bodies, headers, cookies, and tokens.

The first rules are independent modules: HTTP 4xx, HTTP 5xx, slow request (2,000 ms default), failed request, duplicate request, and runtime/console error. The duplicate fingerprint contains method, normalized URL, and request body; it ignores analytics/polling/socket-like URLs and reports a group only when three matching requests occur within the configured window.

The React calculation is memoized on captured events, so opening filters, dialogs, or request detail does not rerun all rules. A QA Check issue opens its original request using the existing request detail UI rather than duplicating Network Inspector.

## DOM / accessibility checks

The existing `content.js` now performs the lightweight page-local checks when QA Check opens or the user chooses **Scan page**. It returns only a finding type, generated selector, tag name, and timestamp; no page HTML, field values, or data leave the browser.

The checks intentionally cover only broken loaded images, missing image `alt`, unnamed form controls, and unnamed buttons. Hidden controls, `input[type=hidden]`, decorative images (`alt=""`, `role="presentation"`, or `aria-hidden="true"`), and images still loading are excluded. This is a fast QA aid, not a complete WCAG scanner.

## Contract, security, reports, and comparison

- The Contract Checker imports OpenAPI 3.x JSON from local extension storage. It matches HTTP method plus templated paths, validates documented statuses and a bounded subset of response schemas, and reports violations as `QAIssue` records with JSON paths.
- Contract boundary suggestions and specification diff are pure local helpers. Suggestions never execute requests; the diff classifies removed endpoints/operations/statuses and selected schema changes.
- Sensitive Data Detector runs locally on captured URLs, selected headers, and request/response strings. It reports only masked evidence; an `Authorization` header on its own is not classified as a bug.
- Bug reports and session reports are generated as local Markdown downloads/copies. Environment Compare only compares two previously saved sessions; it never sends or replays requests to an environment.
- Negative testing creates an enabled temporary rule in the existing Mock Engine. The user can disable it from the existing Mock Manager in one action.

## Chrome Web Store preparation

The extension remains Manifest V3, ships no remote scripts, analytics, AI, telemetry, account code, or backend. `PRIVACY.md` lists the local data classes; before submission, increment the manifest version, produce the signed review build with `npm run zip`, and manually exercise capture, QA Check, contract import, mock disable, session compare, and all export actions in Chrome.

## Deliberate MVP boundaries

- Threshold persistence and user-configurable ignore lists belong to the Settings milestone.
- Contract, sensitive-data, reports, and negative testing are later milestones.
- The current capture limits (100 requests and 50 console errors per tab) also bound the MVP analysis workload.

## Changes in 2.1.0

- **One panel per browser window.** The side panel connects with a port named `sidepanel:<windowId>`. `background.js` keeps a `panels` map (window → port and captured tab) and sends requests, console errors and debugger status over that port only, so panels in other windows never receive them. After connecting and after each tab switch the panel gets one `TAB_SNAPSHOT` message with everything captured for the tab.
- **Service worker restarts.** Captured requests and console errors are mirrored to `chrome.storage.session` (`capture_<tabId>`, 2 MB per tab, older bodies replaced by a marker) and restored on start. The panel reconnects by itself.
- **Rules.** Mock and breakpoint rules are cached in the worker; `chrome.storage.onChanged` invalidates the cache and refreshes Fetch interception, which is skipped when the URL patterns did not change.
- **Side panel structure.** `App.tsx` holds markup and UI-only state. Domain state is in `hooks/`: `useCapture`, `useQaAnalysis`, `useRules`, `useSessions`, `useCollections`, `usePreferences`. Storage access goes through `utils/storage.ts`.
- **Start-up size.** Dialogs, the request detail, the QA tab and the load tester are loaded on first use (`components/lazy.tsx`). The contract checker with its YAML parser is loaded only when a specification exists.
- **Content script on demand.** `content.js` is no longer declared in the manifest. `utils/pageMessaging.ts` injects it into the active tab the first time DOM search, highlight or page checks are used.
- **Masking on export.** `qa/masking.ts` replaces credentials (authorization headers, cookies, tokens, passwords, API keys) with `***` in everything that leaves the browser. It is on by default and can be switched off in the settings. Saved sessions and the cURL/fetch snippets of the request detail are not masked.

## Changes in 2.2.0

### Capture

- **Settings.** `captureSettings` in `chrome.storage.local` is written by the panel and read by the worker (`normalizeCaptureSettings`, `storage.onChanged`). It holds `preserveLog`, `maxRequests` (50–1000), `captureAllResources` and the throttling profile.
- **Navigation.** Without `preserveLog` the worker clears the tab's lists and posts an empty `TAB_SNAPSHOT`, so the panel and the worker always agree. The pending navigation request (type `document`) stays tracked.
- **Real headers.** `Network.requestWillBeSentExtraInfo` / `responseReceivedExtraInfo` are kept per request id and merged over the provisional headers when the request finishes (`mergeHeaders`: case-insensitive, pseudo-headers dropped).
- **Timing.** `response.timing` is turned into phases by `computeTimings` and stored as `ApiRequest.timings`; `protocol`, `remoteAddress`, `transferSize`, `fromCache` come from the same events.
- **Resource types.** `resourceKind` maps CDP types to `ApiRequest.type`. Only XHR/fetch bodies are downloaded.
- **Body retention.** Beyond the newest 200 requests bodies are replaced by a marker in the worker and in the panel.
- **GraphQL.** `utils/graphql.ts` annotates requests in the panel (`ApiRequest.graphql`); the worker does not know about GraphQL.

### Interception

`Fetch.enable` receives one pattern per rule with its stage. `handleRequestPaused` decides by stage:

| Stage | Order of checks |
|---|---|
| Request | breakpoint (`stage: request`) → rule `block` → rule `delay` → rule `mock` (sequence, delay, abort) → continue |
| Response | breakpoint (`stage: response`) → rule `patch` → continue |

- A paused request is described to the panel in full (`BREAKPOINT_REQUEST_PAUSED`: url, method, headers, postData, and for the response stage status, headers, body). The panel keeps a queue and answers with `RESUME_PAUSED_REQUEST` and optional `overrides`.
- Request overrides go to `Fetch.continueRequest`; the tracked request is updated so the list shows what was sent, with `modified: true`.
- Response overrides and `patch` rules go to `Fetch.fulfillRequest`; `content-length` / `content-encoding` are dropped. The request is emitted by the Fetch handler and skipped in the Network handler.
- An unanswered pause is released after 5 minutes.
- Throttling uses `Network.emulateNetworkConditions`, applied on attach and on every settings change.

### Reports

- **Screenshot.** `CAPTURE_SCREENSHOT` → `Page.captureScreenshot` (optionally the full page, capped at 16384 px), with `tabs.captureVisibleTab` as a fallback.
- **Jira.** `qa/jira.ts` creates the issue through REST API v2 and attaches the screenshot. Runs in the panel, on a click, after a confirmation.
- **Step recorder.** `StepRecorder` in `content.js` reports clicks, input, selection and Enter as structured actions with a locator (test id, role and name, label, placeholder or CSS). `useStepRecorder` words them (`stepText`), adds navigations and restarts the recorder after each navigation. `playwrightUiScenario` turns steps into a test. Password values are never read.
- **HAR import.** `utils/harImport.ts` → `showSnapshot`.

### Checks

- **Contract.** `contractChecker.ts` resolves any local JSON pointer, merges `allOf`, evaluates `oneOf` / `anyOf` / `not` / `discriminator`, and checks pattern, format and the other keywords listed in the README. `bundleExternalRefs` downloads external documents once and inlines them under `x-external`, so validation itself is offline. Paths are matched with `servers` prefixes; concrete paths win over templated ones.
- **Sessions.** `Session.pinned` exempts a session from the 24-hour / three-session rule in both `retainSessions` implementations.
- **Accessibility.** axe-core is injected for the run; its findings arrive as `DOMFinding` with `type: "axe"` and replace the built-in checks that axe covers (`CHECKS_COVERED_BY_AXE`).
- **Streams.** Binary WebSocket frames keep their size and a base64 prefix; the panel renders it with `hexDump`.

### Interface

- **Language.** `locales/en.ts` is typed as `typeof ru`. `main.tsx` reads the language before the first render; changing it re-mounts the panel content (`key={language}`).
- **Settings transfer.** `utils/settingsTransfer.ts` builds and validates one JSON file with every settings key; captured data and the Jira token are excluded.
