# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Reqpane - a Chrome extension for capturing API calls, detecting errors, and exporting debug info. Built with React 19, Base UI components, and Tailwind CSS v4 using Chrome Manifest V3.

## Commands

```bash
npm run dev      # Watch mode - rebuilds on file changes
npm run build    # Production build to dist/
npm run zip      # Pack dist/ into ../qa-tools.zip (scripts/zip.mjs, no zip CLI needed)
npm run release  # build + zip
npm run test:qa  # Unit tests for the qa/ layer, utils/ and background.js
npm run test:ui  # Headless Chromium from Playwright with dist/ loaded, local stand only (QA_CHROMIUM_PATH overrides the browser)
```

npm is the only package manager (package-lock.json); do not add bun.lock back.
`qa-tools.zip` in the repository root is the shipped build. After `npm run zip`, put the printed SHA256 into the root `QA-Tools-<version>-sha256.txt`.

## Loading in Chrome

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `dist` folder

## Architecture

### Script Execution Flow
```
background.js (service worker + CDP) → App.tsx (side panel)
content.js (content script) — DOM search/highlight only
```

- **background.js**: Service worker. Split into stateless ES modules that get the worker's maps passed in: `interception.js` (`createInterception`: Fetch-domain mocks, patches, delays, blocks, breakpoints, Fetch patterns) and `persistence.js` (`createPersistence`: mirror to `chrome.storage.session`). Keep new modules stateless factories — the integration test re-imports `background.js?instance=N` to simulate a worker restart while sub-modules stay cached. Uses `chrome.debugger` API (CDP) to capture network requests via Network domain, intercept them via Fetch domain (mock, patch, delay, block, breakpoints at the request and the response stage), capture console errors via Runtime domain, throttle the network and take screenshots (Page domain). Stores requests per tab (Map), reads rules and capture settings from `chrome.storage.local`. Attaches debugger when side panel opens (via port), detaches on close.
- **content.js**: DOM field search/highlight, the element picker (`ElementPicker`: `START_ELEMENT_PICK` is answered only after the click, Esc or a 2-minute timeout with `{ element }` / `{ cancelled }`; `CANCEL_ELEMENT_PICK`; it swallows page clicks while armed), page QA checks, the axe-core audit runner and the step recorder (`StepRecorder` sends `RECORDED_STEP` to the panel). No network capture role. It is **not** in the manifest: `src/sidepanel/utils/pageMessaging.ts` (`sendToPage`) injects it into the active tab on first use; the script guards against double injection. Always talk to the page through `sendToPage`, never `chrome.tabs.sendMessage` directly. `sendToPage` targets the top frame only (several frames answering would race); pass `{ allFrames: true }` for messages every frame must get (start/stop of recording) and `{ inject: [...] }` for extra files such as `axe.min.js`.
- **App.tsx**: React side panel composition plus UI-only state (selection, open dialog, filters). Markup lives in `components/layout/` (`AppHeader`, `ListControls`, `StatusBanners`), `components/requests/RequestList` (flat or grouped list, virtualised through `components/common/VirtualRows` from 120 rows) and `components/finder/WatchLog`; every bottom sheet is `components/common/Sheet`. Exports go through `hooks/useExports` (`forExport` adds notes and masks). The command palette (`components/palette/CommandPalette`, Ctrl+K) lists commands built in `paletteCommands()` in App.tsx — a new panel action should get a palette entry. Domain state lives in hooks: `useCapture` (port to the background, requests, console errors, debugger status), `useCaptureSettings`, `useQaAnalysis`, `useRules`, `useSessions`, `useCollections`, `usePreferences`, `useStepRecorder`, `useJiraSettings`. New state goes into the matching hook, not into App.tsx.

### File Structure
```
src/sidepanel/
├── App.tsx              # Markup and UI-only state; domain state is in hooks/
├── types.ts             # TypeScript interfaces (ApiRequest, MockRule, etc.)
├── components/          # UI components organized by feature
│   ├── common/          # TabButton, FilterButton, CodeCopyBlock, Sheet, VirtualRows
│   ├── requests/        # RequestRow
│   ├── detail/          # RequestDetail (bottom sheet)
│   ├── json/            # JsonTreeView, JsonTreeNode
│   ├── console/         # ConsoleErrorRow, ConsoleErrorDetail
│   ├── mocks/           # MockManager, MockRuleEditor
│   ├── breakpoints/     # BreakpointManager, BreakpointRuleEditor
│   ├── sessions/        # SessionHistory
│   ├── settings/        # SettingsPanel
│   ├── requests/        # RequestRow, RequestList (virtualised)
│   └── views/           # TimelineView, DiffDialog
│   └── lazy.tsx         # lazyComponent(): dialogs/tabs loaded on first use
├── components/layout/   # AppHeader, ListControls, StatusBanners
├── components/palette/  # CommandPalette, WhatsNewDialog
├── hooks/               # useExports, useWatchdog, useUpdateCheck, useWhatsNew, useCapture, useCaptureSettings, useQaAnalysis, useRules, useSessions, useCollections, usePreferences, useStepRecorder, useJiraSettings, useFieldUsage, useElementPicker, useElementWatch, useStreamMessages
├── qa/                  # UI-free logic: rules engine, contract checker, reports, masking, team tools (steps, Playwright), jira.ts, messages.ts (ru/en texts of the qa layer and exporters: qt(), setQaLanguage())
├── locales/             # ru.ts (source dictionary), en.ts (typed as typeof ru), index.ts (t(), setLanguage)
└── utils/               # jwt.ts, snippets.ts (PowerShell/Python), endpointHistory.ts, watchdog.ts, fuzzy.ts (palette ranking), version.ts (update check), virtualList.ts — all tested in utils/features24.test.ts; generators/exporters, harImport.ts, graphql.ts, hex.ts, settingsTransfer.ts, storage.ts (typed chrome.storage.local), requestList.ts, download.ts, pageMessaging.ts, formBody.ts (form-urlencoded decode/encode for components/common/BodyEditor), valueFinder.ts (picked element value → response fields, for hooks/useElementPicker + components/finder/ValueFinderDialog)

public/
├── manifest.json        # Extension manifest v3
├── background.js        # Service worker (CDP-based capture)
├── interception.js      # Fetch-domain interception (stateless factory used by background.js)
├── persistence.js       # chrome.storage.session mirror (stateless factory used by background.js)
├── _locales/            # Extension name and description (ru default, en)
├── captureStore.js      # Pure helpers for background.js: capture settings, header merge, timings, JSON patching (tested)
├── content.js           # Page helper, injected on demand (DOM search/highlight, QA checks)
└── icons/               # SVG icons
```

## Key Technical Details

- **Vite config**: Uses `@tailwindcss/vite` plugin (not PostCSS) for Tailwind v4. Flat output naming (`[name].js`) for extension compatibility.
- **CDP domains**: Network (capture, `*ExtraInfo` events for real headers, `emulateNetworkConditions`), Fetch (interception at the Request and Response stage), Runtime (console errors), Page (`captureScreenshot`, `getLayoutMetrics`). No Runtime.evaluate calls.
- **One panel per window**: the side panel connects with `chrome.runtime.connect({ name: 'sidepanel:<windowId>' })`. The background keeps `panels` (windowId → port, captured tabId), attaches the debugger to that window's active website tab and detaches on port disconnect. Never use "active tab of the current window" in background.js — resolve the tab through `panels` (`resolveTabId`).
- **Background → panel messages go over the port** (`notifyTab`), so other windows do not receive them: `TAB_SNAPSHOT` (after connect, after each tab switch and when a navigation clears the log), `NEW_API_REQUEST`, `NEW_CONSOLE_ERROR`, `DEBUGGER_STATUS`, `BREAKPOINT_REQUEST_PAUSED`, `BREAKPOINT_REQUEST_EXPIRED`, `PICK_ELEMENT_COMMAND` (the `pick-element` keyboard shortcut from manifest `commands`; without a panel the worker opens one). Only `SESSION_HISTORY_CHANGED` is broadcast with `chrome.runtime.sendMessage`.
- **Panel → background messages** (`chrome.runtime.sendMessage`, carry `windowId`): `CLEAR_API_REQUESTS`, `SET_API_REQUESTS`, `CLEAR_CONSOLE_ERRORS`, `GET_STREAM_MESSAGES`, `SAVE_MOCK_RULES`, `SAVE_BREAKPOINT_RULES`, `RESUME_PAUSED_REQUEST` (with `tabId`, `action` and optional `overrides`: edited request `url/method/headers/postData` or edited response `status/headers/body`), `CAPTURE_SCREENSHOT` (`fullPage`), etc. Content script → panel: `RECORDED_STEP`, `PICKER_HOVER` (hovered element while picking; the panel of the captured tab answers `{ label }` with the match count), `ELEMENT_WATCH_CHANGED` (`ElementWatcher`: text of the watched element changed; started with `START_ELEMENT_WATCH` sent to all frames, answered only by the frame holding the last picked element; `STOP_ELEMENT_WATCH`). `useElementWatch` explains each change with `explainChange` (requests finished since the previous change). The finder also searches response headers, URL parameters, request bodies and WebSocket/SSE messages: `useStreamMessages` polls `GET_STREAM_MESSAGES` once the picker was used and `streamRequests` turns messages into pseudo-requests (id prefix `stream:`); `ValueMatch.section` says which part matched and decides the tab `RequestDetail` opens. The element picker is armed in every frame (`useElementPicker`: `sendToPage(..., { allFrames: true, inject: ['content.js'] })`); the first frame that answers wins and the panel then sends `CANCEL_ELEMENT_PICK` to all frames.
- **Service worker restarts**: captured requests/errors are mirrored to `chrome.storage.session` (`capture_<tabId>`, debounced, 2 MB per tab, bodies dropped beyond that) and restored on start; the panel reconnects by itself. Pure helpers live in `public/captureStore.js`.
- **Rules**: mock/breakpoint rules are cached in the worker; `chrome.storage.onChanged` invalidates the cache and refreshes Fetch patterns, so writing `mockRules` straight to storage also works. A `MockRule` has a `mode`: `mock` (default, fulfil at the Request stage), `patch` (Response stage: `patches` applied to the real JSON body with `applyJsonPatches`), `delay`, `block`. A `BreakpointRule` has a `stage` (`request` default, `response`). A request whose response the extension replaced is emitted by the Fetch handler with `modified: true` and skipped in the Network handler through `mockedNetworkIds`, exactly like a mock.
- **Capture settings**: key `captureSettings` (`preserveLog`, `maxRequests` 50–1000, `captureAllResources`, `throttle` + custom values). The panel writes them (`useCaptureSettings`), the worker normalizes them with `normalizeCaptureSettings` and reacts through `storage.onChanged`. Defaults exist in both `public/captureStore.js` and `hooks/useCaptureSettings.ts` — change them together. Only the newest 200 requests keep bodies (`BODY_KEEP_COUNT`, mirrored in `useCapture.ts`). Bodies are downloaded for XHR/fetch only.
- **Snapshots**: a loaded session or an imported HAR is shown with `showSnapshot`; while it is shown, live requests do not enter the list and clearing/deleting does not touch the worker. `returnToCapture` reloads the live list.
- **Tests**: `tests/background.test.mjs` (helpers) and `tests/background.integration.test.mjs` (background.js on a fake `chrome` API) run as part of `npm run test:qa`, together with `qa/*.test.ts` and `utils/utils.test.ts`. Modules under test are run by Node with `--experimental-strip-types`: value imports between them need the `.ts` extension and they must not import `locales/`. In the fake `chrome` of the integration test `chrome.commands` is the array of recorded debugger commands (with `onCommand` attached to it), so background.js reaches the shortcut event as `chrome.commands?.onCommand?.`.
- **Storage keys**: `mockRules`, `breakpointRules`, `captureSettings`, `jiraSettings`, `language`, `favorites`, `sessions`, `session_${id}`, `darkMode`, `fontSize`, `teamWorkspace`, `requestMeta` (pins, tags, `notes`), `watchedEndpoints`, `checkUpdates`, `updateCheck`, `dismissedUpdateVersion`, `lastSeenVersion`; session area: `capture_${tabId}`. `utils/settingsTransfer.ts` lists the keys that count as settings (export/import); a new settings key must be added there. The Jira token is never exported.
- **Request limits**: `captureSettings.maxRequests` per tab (default 100), 50 console errors per tab, 5MB max response body size, 200 stream messages per tab
- **Sessions**: `Session.pinned` marks a reference session kept without a time limit; `retainSessions` (worker) and `retainedSessions` (`qa/teamTools.ts`) implement the same rule — change them together.
- **Localisation**: every user-visible string goes through `t()` from `locales/` and must exist in both `ru.ts` and `en.ts`. Call `t()` at render time, never at module top level. Use `dateLocale()` for dates. Texts produced by `qa/` and `utils/generators.ts` (they cannot import `locales/`) come from `qa/messages.ts` via `qt()`; `setLanguage()` switches both. Letter shortcuts are matched by physical key (`e.code`), so they work with the Russian layout.
- **Notes**: a request note is `RequestMeta.notes` (keyed by request id); `withNotes()` copies it into `ApiRequest.note` for exports and saved sessions, HAR keeps it in the entry `comment`.
- **Watchdog**: `hooks/useWatchdog` alerts only on requests that arrive while it watches (ids already listed after a tab switch or snapshot never alert); endpoints are matched by `endpointKey()` (method + path with numeric ids/UUIDs folded, same rule as the environment compare).
- **Update check**: `hooks/useUpdateCheck` — at most once a day, GET without cookies to the GitHub latest-release API, falling back to `manifest.json` of main. It is the only automatic network request; it is documented in PRIVACY.md and can be switched off (`checkUpdates`). Keep it free of user or capture data.
- **Jira**: `qa/jira.ts` is the only code that sends captured data to a third party; it runs on an explicit click with a confirmation and uses `credentials: 'omit'`. Keep it that way and keep PRIVACY.md in step.
- **axe-core**: emitted as `axe.min.js` and `axe-locale-ru.js` by the plugin in `vite.config.ts`; injected into the page by `useQaAnalysis.runDomChecks` only for the audit. Do not import `axe-core` into the panel bundle.
- **Lazy loading**: RequestDetail, QACheckView, TeamToolsPanel, LoadTestPanel and the dialogs are created with `lazyComponent` and imported from their own files. Do not import them (or anything else) from the `./components` barrel in App.tsx — that pulls them back into the start-up bundle. `qa/contract/contractChecker` (YAML parser, ~100 kB) and `qa/negativeTesting` must stay behind dynamic `import()` on the start-up path.
- **Masking on export**: every export, report, bug report and copied prompt passes requests through `qa/masking.ts` (`maskRequests` / `maskRequest`) when the `maskSecretsOnExport` preference is on (default). A new export must do the same. Saved sessions and the cURL/fetch snippets in the request detail are intentionally not masked.
- **Storage**: read and write `chrome.storage.local` through `utils/storage.ts` (`StoredState` lists the keys).
- **CSS theming**: Uses CSS custom properties in `@theme` block. Dark mode via `html.dark` class.

## Chrome Extension Permissions

- `sidePanel`, `activeTab`, `tabs`, `storage` - Core functionality
- `unlimitedStorage` - Saved sessions with large bodies exceed the 10 MB `storage.local` quota
- `alarms` - Minute timer that removes expired saved sessions
- `notifications` - Watchdog alerts for watched endpoints
- `debugger` - Chrome DevTools Protocol access for network capture, interception, throttling and screenshots (shows yellow infobar)
- `scripting` - Inject content.js (and axe-core) on demand
- `clipboardWrite` - Copy to clipboard feature
- `<all_urls>` host permission - Needed to inject content.js into the inspected page (there is no `content_scripts` entry), to send an issue to the configured Jira server and to download OpenAPI documents

## Design Guidelines

When building UI, follow the frontend-design skill guidelines:
- Choose distinctive fonts (avoid Inter, Roboto, Arial)
- Use bold color choices with sharp accents
- Add motion and micro-interactions
- Create atmosphere with backgrounds and visual details
