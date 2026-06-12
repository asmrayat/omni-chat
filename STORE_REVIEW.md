# Chrome Web Store Review Notes

These notes are intended to make Chrome Web Store review and future maintenance easier.

## Single Purpose

OmniChat has one purpose: let users broadcast one prompt to selected AI chat providers and compare the responses.

## Manifest V3

The extension uses Manifest V3 with an event-driven service worker in `background.js`. All executable JavaScript is included in the extension package. There is no remotely hosted executable code.

## Permission Justification

- `sidePanel`: required for the primary side-panel UI.
- `tabs`: required to open, reuse, focus, and manage provider chat tabs.
- `storage`: required for provider preferences, custom agents, active sessions, and local history.
- `scripting`: required to inject packaged scripts into provider pages and user-added custom agents.
- `unlimitedStorage`: used to reduce the chance that local conversation history is evicted.
- `declarativeNetRequest`: used for split view only. A session-scoped rule removes frame-blocking response headers for provider subframes only in the split-view tab.
- Built-in host permissions: required for ChatGPT, Claude, Gemini, DeepSeek, and Grok integrations.
- Optional `https://*/*` host permission: requested at runtime only when a user adds a custom HTTPS chat agent.

## User Data

The extension handles prompt text, captured provider responses, local history, custom agent configuration, preferences, and temporary tab/session identifiers. It does not operate a backend server. Data is sent to third-party AI providers only when the user selects those providers and broadcasts a prompt.

## Known Review Considerations

- Split view uses iframes for provider pages and a session-scoped `declarativeNetRequest` rule. This behavior should remain prominently described because it modifies response headers for the user-facing split-screen feature.
- The extension captures provider responses and stores local history. The Chrome Web Store privacy fields must disclose this as user-provided content and extension activity.
- Custom agents require broad optional host permissions, but access is requested only after a user enters a specific HTTPS URL.
