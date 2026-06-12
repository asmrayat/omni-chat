# UI Context — OmniChat

## Aesthetic
Dark, technical, calm — a broadcast switchboard. One amber "on-air" accent; everything else quiet slate.

## Color Palette (CSS variables — the only source of color)
--bg: #14161c
--bg-raised: #1c1f27
--bg-input: #10121a
--border: #2a2e39
--text: #e8e6df
--muted: #8b8fa0
--accent: #f5a524        (on-air amber: Broadcast button, working lamp)
--accent-ink: #1a1304
--ok: #3fb950
--err: #f25555

## Typography
- Body: system-ui stack, 13.5px/1.45
- Utility: var(--mono) for statuses, labels, hints (10–12px)
- Max 3 sizes per view; weight 600–700 only for the brand and primary action.

## Spacing & Radius
- Spacing rhythm: 6 / 8 / 10 / 12 / 14 px (panel is narrow — stay tight)
- --radius: 10px cards/inputs; 999px chips/badges; 7–8px small buttons

## Component Conventions
- **Chat transcript**: user prompt = right-aligned amber-tinted bubble; each AI reply = left-aligned message with 24px monogram avatar (brand color, NOT brand logos), name + mono status, bubble, and a Copy/Open action row. Typing = 3-dot blink (disabled under reduced motion).
- **Chip (channel)**: pill + status lamp. Lamp encodes state: gray idle, amber pulse working, green sent, red error.
- **Buttons**: primary = amber filled ("Broadcast"); ghost = bordered muted ("New session").
- **Entry card**: raised bg, timestamp in mono, prompt text, row of delivery badges (clickable → focuses that provider's tab).
- **Empty state**: explains the flow in 2 sentences; invitation, not decoration.

## Do Not
- No drop shadows except the on-air glow on the active Broadcast button and brand dot.
- No raw hex outside :root. No more than one accent color. No animation beyond the working-lamp pulse (and none under reduced motion).
