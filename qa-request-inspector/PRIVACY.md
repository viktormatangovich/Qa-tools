# Reqpane Privacy Policy

Last updated: November 10, 2026

Reqpane is a browser extension for developers and QA engineers to debug API calls.

## Data Collection

The extension developer does **NOT** collect, receive or store any of your data. There are no servers of ours: captured network data is processed in your browser.

Data leaves your browser only in the cases listed under [Connections Made at Your Request](#connections-made-at-your-request), each of which you start yourself.

## Local Storage

The extension stores the following data locally on your device:

- **Captured requests** - Temporary, stored per tab. By default the list is cleared on navigation; with "Keep the log across page navigations" switched on it is kept until you clear it or close the tab. Request and response headers are stored as the browser sent and received them, **including `Cookie` and `Set-Cookie`**. A copy is kept in the browser's session storage (`chrome.storage.session`, in memory only) so the list survives a restart of the extension's background worker; it is erased when the tab or the browser is closed
- **Console errors** - Temporary, stored per tab, kept the same way
- **WebSocket and SSE messages** - Temporary, in memory only: up to 200 messages per tab, the first 64 KiB of a text message and the first 4 KiB of a binary frame
- **User preferences** - Theme, font size, interface language, capture settings (log preservation, request limit, resource types, network throttling)
- **Mock, patch, delay and block rules** - Custom rules you create for intercepting requests
- **Breakpoint rules** - Custom rules for pausing requests and responses
- **Saved sessions** - Request history you explicitly save. Ordinary sessions are removed after 24 hours (three newest are kept); a session you pin as a reference stays until you delete it
- **Load test history** - Results from load tests you run
- **Favorites, collections and tags** - Requests you mark or group
- **QA settings and OpenAPI specifications** - Analyzer thresholds and specifications you explicitly paste or load, together with external documents downloaded for them
- **Team tools workspace** - Project profiles, business rules, manual and recorded reproduction steps
- **Jira connection** - The address, project key, issue type, account e-mail and API token you enter. **The token is stored unencrypted** in the extension's local storage on this device. It is never included in the settings export

This data is not accessible to the extension developer.

## Recorded Steps

When you start step recording, the extension notes your clicks, typed text, selected options and page addresses on the inspected page as reproduction steps. Values typed into password fields are never read. Recording runs only between "Record steps" and "Stop recording", and the steps stay in local storage until you clear them.

## Screenshots

A screenshot of the inspected tab is taken only when you press the button in a bug report. It is kept in memory while the report is open and is not stored.

## Exported Files

Files you export (HAR, Postman, Markdown, OpenAPI, CSV, cURL), session reports, bug reports, Playwright tests and the copied AI prompt are created at your request and are yours to share. By default, credentials in them — authorization headers, cookies, tokens, passwords and API keys — are replaced with `***`. Personal data such as e-mail addresses is not masked, and recorded steps contain the text you typed. Masking can be switched off in the settings. Saved sessions stay in the browser unmasked.

The settings export contains preferences, rules, profiles, the OpenAPI specification and the Jira connection without the token. It does not contain captured requests, sessions or collections.

## No Analytics or Tracking

Reqpane does not include any analytics, telemetry, or tracking code. We do not collect usage statistics or any other information about how you use the extension.

## Connections Made at Your Request

The extension has no servers of its own. It makes network requests only when you use one of these features:

- **Creating a Jira issue** - When you press "Create a Jira issue" in a bug report and confirm, the issue summary, the report text and the screenshot (if you took one) are sent to the Jira server whose address you entered, authenticated with your token. The report text may contain the request URL, status and the reproduction steps. This is the only feature that sends captured data to a third party, and the third party is the one you configured
- **Replaying requests** - Load testing, the request editor and batch negative checks re-send requests you selected to their original servers
- **Loading an OpenAPI specification by URL** and the external documents it references (`$ref`) - plain downloads from the addresses in the specification
- **Network interception** - Capturing, mocking, pausing, patching, delaying, blocking and throttling the requests of the page you inspect

## Page Scripts

The extension's page helper is not present on pages by default. It is injected into the inspected tab only when you use DOM field search, element highlight, page checks or step recording. The full accessibility audit additionally injects the open-source [axe-core](https://github.com/dequelabs/axe-core) library for the duration of the check; it runs locally and sends nothing anywhere.

## Permissions

The extension requires certain browser permissions to function:

| Permission | Purpose |
|------------|---------|
| `sidePanel` | Display the debugging UI in Chrome's side panel |
| `activeTab` | Read current tab URL and title for request context |
| `tabs` | Detect tab changes to show correct requests per tab |
| `storage` | Save preferences, rules, and session history locally |
| `unlimitedStorage` | Let saved sessions with large response bodies exceed the default 10 MB local storage quota |
| `debugger` | Chrome DevTools Protocol access: capture requests with their real headers and timing, intercept and modify them, emulate network conditions, take a screenshot of the tab |
| `alarms` | Minute timer that removes expired saved sessions |
| `scripting` | Inject the page helper (and axe-core) into the current tab when you use DOM field search, element highlight, page checks or step recording |
| `clipboardWrite` | Copy request data to clipboard |
| `<all_urls>` | Capture requests from, and run the page features above on, any website you choose to inspect; send an issue to the Jira address you configured; download an OpenAPI specification from the address you entered |

## Data Retention

- Tab-specific data (requests, console errors, stream messages) is cleared when you close the tab, and on navigation unless you chose to keep the log
- Temporary saved sessions are removed after 24 hours; pinned (reference) sessions are stored until you delete them
- Preferences, rules, profiles, steps and the Jira connection persist until you change them or uninstall the extension

## Your Control

You have full control over your data:

- Clear all captured requests with the "Clear" button
- Delete saved sessions individually
- Delete load test history
- Clear recorded steps in the team tools
- Remove the Jira token in the settings
- Uninstalling the extension removes all stored data

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last updated" date at the top of this document.

## Contact

If you have questions about this privacy policy, please open an issue on our GitHub repository.
