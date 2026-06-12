# Project Overview — OmniChat

## Summary
OmniChat is a Chrome (Manifest V3) side-panel extension for power users who compare AI chatbots. You type one prompt in the sidebar, press Broadcast, and the extension opens (or reuses) one tab per selected AI — ChatGPT, Claude, Gemini, DeepSeek, Grok — types your prompt into each site's composer, and submits it. Follow-up prompts go to the same tabs, so each AI keeps its conversation thread.

## Goals
1. A user can broadcast a prompt to 2+ selected providers with one click.
2. Each provider gets exactly one tab per session; follow-ups reuse that tab (thread continuity).
3. Per-provider delivery status (working / sent / error) is visible in the panel within seconds.
4. Provider selection persists across browser restarts (chrome.storage.sync).
5. A broken selector on one site degrades to a visible per-provider error — it never blocks other providers.
6. "New session" resets the tab map so the next broadcast starts fresh threads.

## Core User Flow
Click toolbar icon → side panel opens → toggle provider chips → type prompt → Broadcast → tabs open in background and receive the prompt → status badges turn ✓ → user reads answers in tabs → types follow-up → same tabs receive it.

## Tech Stack
- Chrome Extension Manifest V3 (sidePanel, tabs, storage permissions)
- Vanilla JS (no build step), plain CSS, semantic HTML
- chrome.storage.session (tab map), chrome.storage.sync (preferences)

## Out of Scope (v1)
- Reading/aggregating the AIs' answers back into the panel
- Auto-login or credential handling (user must be signed in to each site)
- Firefox/Safari support; mobile
- Prompt history persistence across panel reloads

## Success Criteria
- Broadcast-to-submitted latency < 10 s per provider on a warm tab
- Zero permissions beyond sidePanel, tabs, storage + the 5 host patterns
- Works at side-panel widths down to 300 px
