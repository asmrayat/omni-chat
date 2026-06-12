# Code Standards — OmniChat

## Language & Conventions
- Vanilla ES2020+, no build step, no frameworks, no external deps.
- `const`/`let` only; async/await over raw promise chains; every async path try/caught — no silent catches except deliberate fire-and-forget `.catch(() => {})` on panel messaging.

## Structure
- `background.js`, `content.js` at root; UI under `sidepanel/`; icons under `icons/`; docs under `context/`.
- One responsibility per file. Site selector configs live only in `content.js`.

## Naming
- Files kebab-case; functions camelCase; message types SCREAMING_SNAKE (`INJECT_PROMPT`, `PROVIDER_STATUS`); provider ids lowercase (`chatgpt`).

## Styling
- All colors via CSS variables in `:root` of panel.css — no raw hex in rules below it.
- System font stack for body, `var(--mono)` for statuses/labels. Max 3 font sizes per view.
- Respect `prefers-reduced-motion`; visible `:focus-visible` outlines on all interactive elements.

## Messaging Protocol (do not break)
- Panel→BG: `BROADCAST`, `NEW_SESSION`, `GET_SESSION`, `FOCUS_PROVIDER_TAB`
- BG→Content: `INJECT_PROMPT`, `PING`
- BG→Panel: `PROVIDER_STATUS {provider, status: idle|working|sent|error, detail}`

## Error Handling
- Content script returns `{ok:false, error}` — never throws across the message boundary.
- User-facing errors say what to do ("signed in?"), not stack traces.

## Testing
- Manual smoke per provider: fresh broadcast, follow-up reuse, closed-tab recovery, signed-out error path.
