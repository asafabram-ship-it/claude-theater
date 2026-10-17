# Office pane UI polish — design (2026-10-17)

Status: approved by Asaf (live check 3, AskUserQuestion ×4). Builds on Task 2.8a (compact rows, `07f9acc`).
Branch `feat/desktop-mod`, code in `desktop-mod/hooks/`.

## Why
Live check 3 (Hebrew, ~34 cols): "looks better", but the minutes column (`1′`, `54′`, `114′`) has no meaning to the reader; two rooms are both titled `/theater` (the first user message is the slash command) and one is the folder name `scratch-2026-1…`; the toolbar icons (🎞 🎬 ? EN 🔔 ☐) and the room `○` are cryptic. Asaf asked to also make sure every control works.

## 1. Agent row — time
- Running / stale agent: a clock field at the row's end, `⏱ 3 דק׳` (EN `⏱ 3 min`), `<1` minute shown as `⏱ <1 דק׳`/`⏱ <1 min` or similar whole text.
- It must READ correctly in RTL under the engine's UBA (one LTR Text per row, no control marks): the Hebrew reader sees the clock, then the number, then `דק׳` from the right. Derive the cell order from the UBA and extend `mergeSafe`-style tests to assert the visual reading order of this field (not only "no merge").
- Done agent: no time field (duration stays in the drawer, `זמן N דק׳`). The ⭐ and ❌/⏰ badges stay.
- When the field does not fit whole, it is dropped (never cut); it shrinks before the activity word.

## 2. Room title
Precedence: (a) the app's conversation title — the last `{"type":"custom-title","customTitle":…}` record in the transcript (also accept an `ai-title`-style record if present; verify real transcripts under `~/.claude/projects`); (b) the first user message that is not a slash command (`/theater`, any `/word …`), not a pasted block, not an injected tag (existing `stripInjectedBlocks`); (c) the folder name as today. The scanner reads titles incrementally like the rest (tail parse already exists); a title change re-titles the room on the next poll. Cleaned with `cleanAgentText` like other text.

## 3. Toolbar and room head
- Toolbar row: `☐ שסיימו`, `🔔 צליל` (🔕 when muted), `? עזרה` — icon + word each (EN: `Finished`, `Sound`, `Help`). Hotkeys unchanged (f, m, h…).
- Demo (🎬), still/freeze (🎞) and language (EN/עב) move into the help window as labelled buttons; their hotkeys (d, s, l) keep working.
- Room head: no `○`. `📌` drawn only when pinned; on hover over the room head a dim `📌` appears at the same place; a click there toggles the pin (hit unchanged in position). The counts click (roomDone) unchanged.
- Every Hebrew label obeys the Hebrew rule (`hebrewRuleOk`, mergeSafe) — icon placement chosen so it reads icon-then-word for the reader.

## 4. Every control works
- A kit test (mounted Client where possible, else the fake surface) that exercises EVERY control and asserts its effect on props/state: ☐ showDone, 🔔 mute, ? help open/close, demo, still, language, 📌 pin (click + hover affordance), room counts roomDone, the `עוד N שסיימו`/`הסתר שסיימו` row, row click → drawer, drawer ✕, search typing + clear, keys j/k/o/x and the hotkeys f/m/h/d/s/l.
- A by-eye checklist for Asaf in the report.

## Constraints (unchanged)
No flicker (no change to register.tsx publish logic or the Client update path), JSON props < 100k chars, rows exactly `columns` cells at 24..200 both directions, no control/bidi chars in any Text, both engines 2.1.293/2.1.295, tsc clean.
