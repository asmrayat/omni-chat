# AI Workflow Rules — OmniChat

## 🥇 Golden Rule
Work on **ONE feature unit at a time** (one provider's selectors, one panel feature, one background behavior). Never refactor unrelated code while implementing a feature.

## Before Starting Any Task
Read `progress-tracker.md`. Confirm which selectors/providers are currently known-good.

## Task Scope (one unit =)
- Fixing/updating selectors for a single provider, or
- One panel UI capability, or
- One background lifecycle behavior (e.g., tab recovery).

## When Stuck / Decision Needed
Stop. Add a `DECISION NEEDED:` line to the tracker. Do not guess on: new permissions, new providers, changes to the messaging protocol.

## Bug Fix Protocol
Find the root cause (usually a site DOM change → check `SITES` config first). Patch the config, not the engine, unless the engine is provably wrong. Log a one-line explanation in the tracker.

## Never Do
- Never add permissions/hosts without explicit instruction.
- Never delete or rename message types — panel, BG, and content all depend on them.
- Never introduce a build step or dependency without asking.
- Never make the extension read or exfiltrate page content beyond what submitting a prompt requires.

## After Every Task
Update `progress-tracker.md` (status, decisions, session notes) before stopping.
