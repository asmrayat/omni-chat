# Architecture — OmniChat

## Tech Stack Roles
- **manifest.json** — declares side panel, service worker, content scripts, host permissions.
- **background.js (service worker)** — session brain: tab-per-provider map, tab lifecycle, message routing, retry logic, status fan-out.
- **content.js** — runs on each AI site; finds composer, inserts text (framework-safe), submits.
- **sidepanel/** — UI only: composes prompts, renders status; holds no tab state.
- **chrome.storage.session** — tab map (survives service-worker suspension, dies with browser).
- **chrome.storage.sync** — user's enabled-provider selection.

## System Boundaries
- The **panel never touches tabs directly**; it only messages the background worker.
- The **content script never decides which tab it is**; it only acts on `INJECT_PROMPT` messages.
- All site-specific DOM knowledge lives in `content.js` `SITES` config (selectors first, generic heuristics as fallback).

## Data Flow
panel `BROADCAST {text, providers}` → background: get-or-create tab per provider → wait for load → `INJECT_PROMPT` to content script (retry ≤45 s) → content script inserts + submits → background fans out `PROVIDER_STATUS` → panel updates chips and delivery badges.

## Storage Model
- Tab map `{providerId: tabId}` → storage.session
- `enabledProviders` → storage.sync
- Transcript → in-memory in the panel only (cleared on close, by design)

## Invariants
- ❌ Never request new permissions or host patterns without explicit instruction.
- ❌ Never inject remote code; all JS ships in the extension (MV3 requirement).
- ❌ Background never assumes in-memory state survives — always read storage.session.
- ❌ One provider's failure must never abort the loop over the others.
- ❌ Content script never auto-sends anything except the exact text received in `INJECT_PROMPT`.
