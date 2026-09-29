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
