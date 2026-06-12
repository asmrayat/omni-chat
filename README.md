# OmniChat

Ask multiple AI chat services from one Chrome side panel.

OmniChat lets you type one prompt and broadcast it to ChatGPT, Claude, Gemini, DeepSeek, Grok, and optional custom AI agents. It keeps each provider in its own browser context, captures responses back into the side panel, and includes a split-screen view for comparing live or saved conversations side by side.

## Purpose and Platform Boundaries

OmniChat is built for simultaneous conversation and comparison. The goal is simple: ask the same question across multiple AI tools at the same time so you can compare answers, reasoning styles, speed, and usefulness in one place.

OmniChat does not modify AI models, change provider behavior, bypass provider rules, or interfere with any AI platform. It does not run code on provider servers or claim any partnership with the AI services it can open. The extension only automates the user-facing browser workflow you choose: placing your prompt into selected chat pages, submitting it, and showing the responses back to you for comparison.

## Features

- Broadcast one prompt to several AI providers at once.
- Continue follow-up prompts in the same provider conversations.
- Compare providers in a side panel transcript or full split-screen view.
- Save local conversation history and reopen previous conversations.
- Add custom HTTPS chat agents with runtime host permission prompts.
- No backend server, account system, analytics, or bundled third-party libraries.

## Install for Development

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder.
5. Pin OmniChat and click the toolbar icon to open the side panel.

## How to Use

1. Sign in to the AI services you want to use in the same Chrome profile.
2. Select the provider chips in the side panel.
3. Type a prompt and press **Broadcast**.
4. Use **Split View** to compare providers side by side.
5. Use **History** to reopen saved local conversations.
6. Use **New session** to start fresh provider threads.

## Privacy

OmniChat is a local-first browser extension. It does not run a backend service and does not send data to servers controlled by this project.

The extension uses your prompt text only to submit it to the AI providers you select. Responses are captured from those provider pages so they can be shown in the side panel and saved in local conversation history. Provider preferences and custom agents are stored with Chrome extension storage. Conversation history is stored locally in Chrome extension storage.

AI providers may process prompts and responses according to their own terms and privacy policies. OmniChat does not handle your provider passwords or API keys.

See [PRIVACY.md](PRIVACY.md) for the Chrome Web Store privacy disclosure draft.

## Chrome Web Store Readiness

This project uses Manifest V3 and ships all executable JavaScript inside the extension package. Before submitting to the Chrome Web Store:

1. Run `node scripts/validate-extension.js`.
2. Review [STORE_REVIEW.md](STORE_REVIEW.md).
3. Create a release ZIP from the repository contents, excluding development-only files such as `.git`.
4. Fill out the Chrome Web Store Privacy tab with the disclosures in `PRIVACY.md`.
5. Provide a public privacy policy URL. The GitHub `PRIVACY.md` page is suitable after the repository is public.

## Permissions

- `sidePanel`: opens the OmniChat side panel.
- `tabs`: opens and manages provider tabs for selected AI services.
- `storage`: saves provider preferences, custom agents, active sessions, and local history.
- `scripting`: runs the packaged browser automation script on provider pages and custom agent pages after permission is granted.
- `unlimitedStorage`: keeps local history from being aggressively evicted.
- `declarativeNetRequest`: enables the split-screen view by applying a session-scoped rule only to provider iframes in the split tab.
- Host permissions for built-in providers: lets OmniChat send prompts and capture responses on selected AI sites.
- Optional `https://*/*` host permission: used only when the user adds a custom HTTPS chat agent.

## Development

There is no build step. The extension is plain HTML, CSS, and JavaScript.

```sh
node scripts/validate-extension.js
```

## Release

Update `manifest.json` and `CHANGELOG.md`, run validation, then package the extension folder as a ZIP for Chrome Web Store upload.

## License

MIT. See [LICENSE](LICENSE).
