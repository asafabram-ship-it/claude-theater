# Office pane as framed cards — design (2026-10-19)

Status: approved by Asaf live (cards probe round 4: "עכשיו זה נראה אחלה"; rounds 5-7 refined it the same day — the reference file is round 7). Replaces the cell-grid drawing of the agent rows (Tasks 2.8a/2.8b). Branch `feat/desktop-mod`.

## Why (root cause of "messy" after four rounds)
The office Client drew every row as cells padded with spaces, assuming every glyph is one cell of a monospace font. The desktop draws Text in a proportional UI font, so the columns never lined up. A probe with fixed cell widths (round 2-3) aligned the columns but CLIPPED the text: the desktop draws its letters wider than the cell metric (`Sonnet` → `nnet`, `חושב` cut vertically). Round 4 — column-major layout, each field a vertical Box sized by its widest value — aligned, unclipped, and approved.

## Reference
`docs/research/2026-10-19-cards-probe/register.tsx` is the approved drawing (round 7). Copy its structure and styling; the strings in it (e.g. `${emoji} ${name}`, `🤔 חושב`, toolbar `שסיימו ☐`) were seen correct on the desktop as written — do not re-derive their order with the old LTR-paragraph model (screenshots show the desktop lays a Hebrew-first Text right-to-left).

## Refinements from rounds 5-7 (Asaf, 19.10) — these override anything below
1. **No selection background** (the dark band is gone). The open drawer shows which agent is selected; keyboard focus may show a small `›` marker beside the dot, nothing more.
2. **Every column is rigid and content-sized** (`flexShrink 0`): a shrinking activity column collapsed to nothing on the desktop. If the table cannot fit the pane, drop the activity WORD (keep its emoji) below a width threshold the implementer derives conservatively (the desktop draws letters wider than a cell; round 6 fit at 51 columns with 4 columns), never clip.
3. **Card title on one line:** a height-1 Box with `overflow hidden`, the title cut on a word with `…` by a conservative estimate (`max(8, floor((columns − 18) × 0.7))` characters in the probe), the counts never wrap (`flexShrink 0`).
4. **Cell padding on the reading side only** (`paddingLeft 1` in RTL), so the columns sit closer.
5. **NO time column** in the rows (reverses decision 16 for the desktop office): how long an agent has worked is in the drawer only (`זמן N דק׳` / `משך N דק׳`).
6. **Badges ride the status column** instead of the dot: ⭐ during the just-finished window, ❌ failed, ⏰ long-running; otherwise ● green running / ● amber stale / ○ grey done.
7. **Toolbar names:** `הצג שסיימו ☐` (☑ when on; EN `Show finished`), `צליל 🔔` (🔕), and `הגדרות ⚙️` (EN `Settings`) replacing `עזרה ?`. The popover it opens is titled `הגדרות` and holds language, demo, motion and the keyboard shortcuts.

## Drawing (desktop office Client only; terminal/vscode/mobile text cards unchanged)
- Header line: `🎭 עובדים N · ממתינים N · סיימו N` (bold) at the reading edge, the 5h meter dim at the other edge.
- Toolbar: the three labelled Buttons (`שסיימו ☐`, `צליל 🔔`, `עזרה ?`), gap 2. Search below with a blank line above and below.
- Each room = a card: `Box borderStyle="round" borderColor="#56607a" paddingX={1} paddingY={1} marginBottom={1} width="100%"`:
  - title line (bold title at the reading edge, dim counts at the other edge, 📌 when pinned / dim 📌 on hover at the reading edge, the counts are the roomDone toggle);
  - a dim rule `─…` under it;
  - the agent table, COLUMN-MAJOR: `Box flexDirection=row-reverse (RTL) | row (LTR)` of five column Boxes (`flexDirection=column`, aligned to the reading edge, `flexShrink 0` except the activity column `flexGrow 1, flexShrink 1, overflow hidden`): status dot (● green running / ● amber stale / ○ grey done), `emoji name` (bold; dim when done), model word (dim), activity (`🤔 חושב`, done = `✅ סיים`, dim), time (`⏱️ 3′` for working agents, empty for done) + badges (⭐ ❌ ⏰). Every value one line: each value sits in a `Box height={1} paddingX={1} width="100%"` so no wrap can change a row's height.
  - the `▸ עוד N שסיימו` / `▸ הסתר שסיימו` line (marginTop 1).
- Selected agent: the row's cell Boxes get `backgroundColor #2a3150` in every column; hover a lighter tint; the finish pulse a subtle tint + ⭐.
- No colours on names/models/activities beyond dim/bold; colour only on the status dot.
- Drawer and help keep their content; the drawer drawn as a card in the same style.

## Interaction (unchanged behaviour)
Row click → drawer; pin, roomDone counts, more/hide row, toolbar, help buttons, search, keys j/k/o/x/f/m/h/d/s/l — all as in `office-controls.test.ts`. Hit-testing: the Client knows the y of every line (card top border, padding, title, rule, rows, more, bottom padding/border, gap); every line is height 1 by construction, so pointer y maps to a line; x is irrelevant for rows (whole row), the title line keeps the pin/counts zones.

## Constraints
No flicker (no change to register.tsx publish logic or the Client update path); props JSON < 100k chars; the drawn tree within the engine's limits at 200 agents and a 200×80 pane (window by whole cards or by lines, the implementer decides, tested); both engines 2.1.293 / 2.1.295; tsc clean. The cell-grid helpers no longer used by the Client are removed with their tests; keep what props/text cards still use (`cut`, `glyphs`, `textWidth`).
