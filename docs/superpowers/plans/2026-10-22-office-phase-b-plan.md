# Office phase B — native Buttons, the floating overlay, overscan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the desktop every click in the office pane is a native plain `Button` (no pointer hit-test by y), the drawer and the settings float over the cards as one absolute overlay at the window's top, and the agent rows are drawn with overscan — so no click misses, nothing jumps, and no blank rows show.

**Architecture:** The paint probe of 22.10 (decisions 25-26 in `docs/superpowers/specs/2026-10-10-client-office-and-usage-design.md` §2; `docs/superpowers/specs/2026-10-19-office-cards-design.md` sections "Paint probe" and "Phase B, decided") measured that a card frame's border rows are half a cell on the desktop, so the engine's pointer y, scroll offset and absolute `top` (all engine cells) drift about a row per card against the drawn rows; that native Buttons hit right at any depth; that inside a plain Button only `bold` and `dimColor` survive (every colour, underline and italic are lost); that no hover of any kind draws inside a Client; that `dimColor` does not dim a colour emoji while `📌\uFE0E` (VS15) draws a monochrome pin; that an absolute Box at `top: offset` with `backgroundColor: 'inverseText'` sits at the visible window's top and hides the rows; and that the engine renders on every scroll step. Phase B therefore removes the line-map hit-test from the surface module (`office-client.tsx`), turns every click target into a keyed plain Button (the row's who / model / emoji / word / task cells with styled Text children, the pin on every title, the more line, the closes), draws the drawer | settings as an absolute overlay that takes no rows in the flow (`chromeRows` and `officeHeight` shrink by them), and widens the drawn window by overscan. The line map (`officeModel(...).lines`, `RoomView.top/height/titleAt/moreAt/blankAt`, `trimWindow`) stays for windowing and the keyboard walk; `hits`, `hitAt`, `pinZone`, the hover decor and the link colour go. The hooks (`ui.tsx`, `register.tsx`) change nothing but comments: the posts, the batch, the answers and `officeHeight`'s call are as in phase A.

**Tech Stack:** Claude Code plugin ("mod") hooks module in TypeScript/TSX; the Client surface module API (`ClientModule`, `surface.elements` Box/Text/Button/Input, `surface.onPointer/onKey/post/every`); `claude plugin validate` / `claude plugin test` on engine 2.1.304; tsc against the engine's declarations.

## Global Constraints

- Engine for every check: `C:/Users/asafa/AppData/Roaming/Claude/claude-code/2.1.304/aed62990b91e/claude.exe` (the only engine the desktop app installs now; the `claude` on PATH is too old for mods). Call it `$E` below.
- Checks after every task: `$E plugin validate C:/Users/asafa/agent-theater/desktop-mod` (must print `✔ Validation passed`), `$E plugin test C:/Users/asafa/agent-theater/desktop-mod`, `C:/Users/asafa/AppData/Local/Temp/theater-tsc/node_modules/.bin/tsc -p C:/Users/asafa/AppData/Local/Temp/theater-tsc` (no output = clean). The suite is green (0 fail; 287 tests at the base `ec30480`) at the end of Tasks 4 and 5. Tasks 1-3 remove exports that other files still import, so until Task 4 the test files named in each task's Step 4 fail to load and tsc names their imports: each task must leave its OWN files passing and must not touch the other files beyond their import lines.
- The plugin name stays `agent-theater`; the pane id `agent-theater`; the office Client's key `OFFICE_KEY` (`'office'`, office-props.ts).
- Engine rules `claude plugin validate` enforces: `$` is never passed to a function imported from another file; an event is hooked at most once WITHOUT a matcher per module; a `Client`'s `module` prop is a string literal path; never name a local `h` (JSX compiles to `h`).
- Client contract: props are plain JSON with NO `undefined`; the module's tree ≤ 20,000 nodes / 32 deep / 100,000 characters serialized and ≤ 1 s per call; `surface.every` started once while `surface.state === undefined`; never three `setState`-only renders in a row; `surface.post` ≤ 100,000 characters; every post is a numbered batch (THE OUTBOX, phase A) — keep `send`.
- No bidi control characters (U+202A–U+202E, U+200E/F) in any Text. Hebrew strings are single runs; a labelled control reads through `iconLabel` (office-layout.ts). One-line values carry no plain space (`nb`).
- Desktop drawing facts that bind every task (decision 26): a plain Button's label or Text child keeps only `bold` and `dimColor` — never give a Button a colour, an underline or an italic and expect it drawn; a `hover` prop draws nothing — use none; `dimColor` does not dim a colour emoji; an absolute Box is placed against the Client's root region, painted over the children before it, and its `top`/`left` count the engine's cells (as `props.offset` does); a `display: 'none'` Box takes no hover and no pointer.
- The desktop lays a Hebrew-first Text right-to-left: keep the strings as the probe writes them (`docs/research/2026-10-19-cards-probe/register.tsx`); the more line's arrow is `◂` at the END of the string (decision 25; `MORE_MARK`, office-layout.ts), the open state `▾` at the end.
- `Date.now()` is not used in the hooks module (`$.clock.now()`); the surface module counts time in `surface.every` ticks and from `props.nowMin`.
- Conversation with the user: Hebrew, simple. Code, comments and commit messages: English, in the files' own voice (long explanatory comments naming the live check that motivated a rule). Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and is pushed: `git push origin feat/desktop-mod`.
- Branch `feat/desktop-mod`; base for this plan `ec30480`. Never touch `register.tsx`'s TEMPORARY transcript fault line (register.tsx ~755) in this plan.
- The test kit: `$.ui.mount(...)` with `surface: 'desktop'` draws the office Client through the hooks; `ui.press({ in: OFFICE_KEY, key })` presses a Button of the module by its key; `ui.key({ in: OFFICE_KEY, key })` sends a key; `ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })` sends a pointer event; `ui.find({ in: OFFICE_KEY, type: 'Button', key })` finds a drawn element; `ui.redraw(props)`, `ui.resize({ in, columns, rows })`, `ui.drawn`. The office's tests already use all of these (office-buttons.test.ts, office-controls.test.ts).

---

## File Structure

| File | Responsibility after phase B | Task |
| --- | --- | --- |
| `desktop-mod/hooks/office-layout.ts` | The view model: geometry, table mode, cards (`RoomView` with `pinned: boolean`, no hover), the line map (`lines`) for windowing and the keyboard; `PIN`, `PIN_OFF`, `MORE_MARK`, `iconLabel`, `trimWindow`, `rowCount`. No `hits`, no `hitAt`, no `pinZone`, no `LINK_FG`. | 1 |
| `desktop-mod/hooks/office-layout.test.ts` | Its tests: the hit and hover tests go, `pinned` and the always-drawn pin's title cut come. | 1 |
| `desktop-mod/hooks/office-chrome.ts` | The chrome's pure maths: `chromeRows` = the fixed rows + the footer (no overlay), `overlayHeight(p)` (the drawer's or the settings' own rows), `windowOf` with overscan, `overscanOf`, `drawerPad` for a floating card; `overlayInWindow` and `OVERLAY_GAP` go. | 2 |
| `desktop-mod/hooks/office-client.tsx` | The surface module: every click a keyed plain Button; the pointer for `leave` alone; the overlay absolute from the root at `max(offset, chrome)` on `inverseText`; the window with overscan; no fragment. | 3 |
| `desktop-mod/hooks/office-client.test.ts` | Its fake-surface tests: presses through the drawn Buttons' `onPress`; the overlay's props; the overscan window; the render cost. | 2 (pure chrome tests), 3 |
| `desktop-mod/hooks/office-buttons.test.ts`, `office-controls.test.ts`, `office-client.mounted.test.ts`, `register.test.ts`, `ui.test.ts` | Kit tests: clicks by `ui.press` with the Buttons' keys; the overlay and height assertions by the new rules. | 4 |
| `desktop-mod/hooks/ui.tsx` | Unchanged code; its header comment names phase B (the Client's height has no overlay rows). | 5 |
| `docs/superpowers/specs/2026-10-19-office-cards-design.md`, `desktop-mod/HANDOFF.md`, `docs/superpowers/plans/2026-10-10-client-office-and-usage-plan.md` | "Phase B, built" notes; the engine path in the old plan's constraints. | 5 |

**Button keys (the addresses the kit presses; stable across redraws):**
- a row's cells: `agent:<id>:who`, `agent:<id>:model`, `agent:<id>:emoji`, `agent:<id>:word`, `agent:<id>:task` (each drawn only when its column is);
- a card's pin: `pin:<roomId>`; a card's more line: `more:<roomId>`;
- unchanged: `showDone`, `mute`, `help` (the toolbar), `closeHelp`, `demo`, `lang` (the settings), `close` (the drawer), `exitDemo`, `watchDemo`.

---

### Task 1: office-layout.ts — the model without hits or hover

**Files:**
- Modify: `desktop-mod/hooks/office-layout.ts` (lines 95-103 constants; 377-384 `pinZone`/`titleRoom`; 543-609 types; 646-668 `roomBase`; 670-760 `officeModel`, `hitAt`; header comments 1-50, 94, 124-128)
- Test: `desktop-mod/hooks/office-layout.test.ts` (lines 434-435, 746-857, 937-982)

**Interfaces:**
- Consumes: nothing new.
- Produces (every later task relies on these exact names):
  - `export const PIN = '📌'` (unchanged) and `export const PIN_OFF = '📌\uFE0E'` — the unpinned pin (VS15: the monochrome glyph).
  - `export type OfficeDecor = { focus: string | null }`; `export const NO_DECOR: OfficeDecor = { focus: null }`.
  - `export type RoomView = { id; top; height; title; counts; pinned: boolean; titleAt; blankAt; rows; more; moreAt }` — `pin` replaced by `pinned`.
  - `export type OfficeModel = { rooms: RoomView[]; lines: Line[]; geo: Geo; mode: TableMode; token: ModeToken; floors: Floors | null; statusMin: number }` — no `hits`.
  - `officeModel(props, decor = NO_DECOR, cache?, last = null): OfficeModel` (same signature, decor without `hoverRoom`).
  - Removed: `Hit`, `hitAt`, `pinZone`, `LINK_FG`. Kept: `Line`, `LineKind`, `trimWindow`, `iconLabel`, `TITLE_GAP`, `EMOJI_CELLS`, `MORE_MARK`, `LESS_MARK`, `cutTitle`, `countsFor` (their `pinned` parameter kept, the callers below pass `true`).

- [ ] **Step 1: Write the failing tests** — in `office-layout.test.ts`, replace the hit/hover tests. Delete the assertions on `pinZone` (lines 434-435), on `m.hits` and `hitAt` (within the "officeModel: the line map…" test, lines ~784-827), the decor test's `hoverRoom → 'dim'` part (lines 832-857: keep what checks `focus`), the bounds assertion on `hits` (line ~958), and the ROOM MEMO `hoverRoom` part (lines ~978-982). Add this test (the fixtures `props`/`room` helpers of the file build an `OfficeProps` with rooms; use the file's existing builders by their names):

```ts
test('the pin is on every title: a room is pinned or not, the title cut leaves the pin its cells either way, and the decor is the focus alone', () => {
  const p = propsWith([room('A', { pinned: true, agents: [agent('a1')] }), room('B', { pinned: false, agents: [agent('b1')] })])
  const m = officeModel(p)
  expect(m.rooms[0]!.pinned).toBe(true)
  expect(m.rooms[1]!.pinned).toBe(false)
  expect('pin' in m.rooms[0]!).toBe(false)
  expect('hits' in m).toBe(false)
  // the title of the unpinned room is cut as the pinned one's: the pin's cells are reserved on every card (decision 26)
  const geo = geometry(p.columns)
  const counts = countsFor(p.rooms[1]!, geo, true)
  expect(m.rooms[1]!.title).toBe(nb(cutTitle(p.rooms[1]!.title, geo, counts, true)))
  expect(m.rooms[1]!.counts).toBe(nb(counts))
  // the decor: the focus marks a row; nothing else is laid from the local state
  const f = officeModel(p, { focus: 'b1' })
  expect(f.rooms[1]!.rows[0]!.focus).toBe(true)
  expect(f.lines).toEqual(m.lines)
})
```

(`propsWith`, `room`, `agent` stand for the file's own fixture helpers — read the top of `office-layout.test.ts` and use the names it defines; import `countsFor`, `cutTitle`, `geometry`, `nb` from `./office-layout` if not imported.)

- [ ] **Step 2: Run the file to see it fail**

Run: `$E plugin test C:/Users/asafa/agent-theater/desktop-mod 2>&1 | grep -E "office-layout|pass|fail"`
Expected: the new test FAILS (`pinned` undefined / `pin` present), the file's other tests still pass.

- [ ] **Step 3: Change the model** — in `office-layout.ts`:

1. Constants: after `export const PIN = '📌'` add
```ts
/** The unpinned pin on every card's title (decision 26): the same glyph in its TEXT presentation (VS15), which the desktop draws monochrome beside the colour 📌 of a pinned room — `dimColor` does not dim a colour emoji, and no hover reveals anything inside a Client. */
export const PIN_OFF = '📌\uFE0E'
```
   Delete `export const LINK_FG = 'suggestion'` and its comment.
2. Delete `pinZone` (and its comment). Keep `titleRoom`, `countsFor`, `cutTitle` with their `pinned` parameter.
3. Types: delete `Hit`; `RoomView.pin: 'bright' | 'dim' | 'none'` → `/** The room is pinned (prefs.pins): the colour 📌 on its title; else PIN_OFF. The pin Button is drawn on every card. */ pinned: boolean`; `OfficeModel` without `hits`; `OfficeDecor = { focus: string | null }`, `NO_DECOR = { focus: null }`; rewrite the decor comment: "What the surface module lays on the model from its local state: focus — the keyboard focus, a small marker beside the status mark. (No hover: the desktop draws none inside a Client — paint probe 22.10; no finish pulse: the ⭐ is the whole finish.)"
4. `roomBase`: `const counts = countsFor(room, geo, true)` and `cutTitle(room.title, geo, counts, true)` — with the comment `// the pin's cells are reserved on every title: the pin Button is always drawn (decision 26)`.
5. `officeModel`: delete `const hits: Hit[] = []`, `const pz = pinZone(geo)`, the three `hits.push(...)` lines, the `pin:` field (→ `pinned: room.pinned`), and `hits` from the returned object. Delete the `hitAt` function.
6. Comments: the header (lines 1-50) and the `officeModel` comment (670-681) no longer describe hit rectangles or the hovered head; say instead: "the line map is for windowing (office-client.tsx) and the keyboard walk; every click is a native Button (phase B, decision 26)".

- [ ] **Step 4: Run the tests and tsc**

Run: `$E plugin test C:/Users/asafa/agent-theater/desktop-mod 2>&1 | tail -5` and the tsc command.
Expected: office-layout.test.ts passes. OTHER files now fail to compile or run (`office-client.tsx` imports `hitAt`, `LINK_FG`, `PIN`...; the kit tests import `pinZone`, `LINK_FG`) — that is expected until Tasks 2-4; tsc will report those imports. Record the failing files in the ledger line; do not fix them here beyond what Step 3 names.

- [ ] **Step 5: Commit**

```bash
git add desktop-mod/hooks/office-layout.ts desktop-mod/hooks/office-layout.test.ts
git commit -m "refactor(mod): phase B 1/5 - the model without hits or hover: RoomView.pinned, PIN_OFF (VS15), the pin's cells reserved on every title; hitAt, pinZone, LINK_FG and the hover decor removed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(The push waits for Task 3, when the suite is green again.)

---

### Task 2: office-chrome.ts — the chrome without the overlay's rows; the overlay's height; the overscan window

**Files:**
- Modify: `desktop-mod/hooks/office-chrome.ts` (lines 1-35 header; 76-79 `OVERLAY_GAP`, `DRAWER_FRAME_ROWS`; 217-251 `overlayInWindow`, `windowOf`; 311-332 `drawerMax`, `drawerPad`; 370-388 `chromeRows`, `overlayRows`, `officeHeight`)
- Test: `desktop-mod/hooks/office-client.test.ts` — its pure chrome tests only (lines ~205-260 `windowOf`/`overlayInWindow`; ~330-390 `chromeRows`/`officeHeight`; ~1470-1515 `drawerPad`); `desktop-mod/hooks/ui.test.ts` line 24 (the `OVERLAY_GAP` import).

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `export function chromeRows(p: OfficeProps): number` — `fixedRows(p) + (p.footer ? 1 : 0)`; NO overlay rows.
  - `export function overlayHeight(p: OfficeProps): number` — the settings popover's rows (`helpRows(p.columns, !!p.oversized)`) while `p.helpOpen`, else the drawer's card rows (`DRAWER_FRAME_ROWS + drawerLines(p.drawer, p.labels, drawerInner(p.columns), limits, drawerPad(limits, p.rows)).length`) while `p.drawer`, else 0. (Replaces `overlayRows`; no gap.)
  - `export function overscanOf(len: number, bodyRows: number): number` — `len <= WINDOW_ROWS ? len : Math.max(0, bodyRows)`: every line while the office has at most WINDOW_ROWS lines, else a body's worth on each side.
  - `export function windowOf(chrome: number, offset: number, bodyRows: number, len: number, overscan = 0): { from: number; count: number }` — the layout lines to draw: `start = offset - chrome` (the layout line at the window's top; negative while the chrome is in view), `from = min(len, max(0, start - overscan))` (never past the content: the module's spacer is `from` rows), `end = min(len, start + bodyRows + overscan)`, `count = max(0, end - from)`.
  - `export function drawerPad(limits: DrawerLimits, bodyRows: number): number` — `bodyRows > 0 ? Math.min(most, Math.max(0, bodyRows - DRAWER_FRAME_ROWS)) : most` where `most = drawerMax(limits)`: the floating card padded to the most lines a body holds whole.
  - `officeHeight(p, layoutRows)` keeps its formula (`chromeRows(p) + (p.empty ? emptyRows(p) : layoutRows)`) — now without overlay rows.
  - Removed: `OVERLAY_GAP`, `overlayInWindow`, `overlayRows`. Kept: `DRAWER_FRAME_ROWS`, `fixedRows`, `helpRows`, `drawerMax`, `drawerLines`, `drawerInner`, `drawerLimits`, `emptyRows`, `WINDOW_ROWS`, `COMPACT_BELOW`, `searchShown`, `demoLine`, `labelsFit`, `helpPairs`.

- [ ] **Step 1: Write the failing tests** — in `office-client.test.ts`, replace the pure chrome tests named above with these (keep the file's fixture builders; `propsAt`/`withDrawer`/`withHelp` stand for its own helpers — use the names the file defines for an OfficeProps at a width, with a drawer, with the settings open):

```ts
describe('the chrome (phase B: the overlay floats, so it takes no rows)', () => {
  test('chromeRows is the fixed rows and the footer, with or without an overlay; officeHeight does not grow when a drawer or the settings open', () => {
    const p = propsAt(50)
    expect(chromeRows(p)).toBe(fixedRows(p) + (p.footer ? 1 : 0))
    const d = withDrawer(p)
    expect(chromeRows(d)).toBe(chromeRows(p))
    expect(officeHeight(d, rowCount(d))).toBe(officeHeight(p, rowCount(p)))
    const h = withHelp(p)
    expect(chromeRows(h)).toBe(chromeRows(p))
    expect(officeHeight(h, rowCount(h))).toBe(officeHeight(p, rowCount(p)))
  })
  test('overlayHeight: the settings popover rows, the drawer card rows padded to its one height, 0 with neither', () => {
    const p = propsAt(50)
    expect(overlayHeight(p)).toBe(0)
    expect(overlayHeight(withHelp(p))).toBe(helpRows(50, false))
    const d = withDrawer({ ...p, rows: 60 })
    const limits = drawerLimits(50)
    expect(overlayHeight(d)).toBe(DRAWER_FRAME_ROWS + drawerMax(limits))
    // a short pane: padded to what the body holds whole, never below the drawer's own lines
    const short = withDrawer({ ...p, rows: 12 })
    expect(overlayHeight(short)).toBe(DRAWER_FRAME_ROWS + drawerLines(short.drawer!, short.labels, drawerInner(50), limits, drawerPad(limits, 12)).length)
    expect(drawerPad(limits, 12)).toBe(Math.min(drawerMax(limits), 12 - DRAWER_FRAME_ROWS))
    expect(drawerPad(limits, 0)).toBe(drawerMax(limits))
  })
  test('windowOf with overscan: every line of a short office, a body on each side of a long one, never past the content', () => {
    expect(overscanOf(40, 30)).toBe(40)
    expect(overscanOf(WINDOW_ROWS, 30)).toBe(WINDOW_ROWS)
    expect(overscanOf(WINDOW_ROWS + 1, 30)).toBe(30)
    // at the top of a 40-line office under a 6-row chrome on a 30-row body: the whole office
    expect(windowOf(6, 0, 30, 40, overscanOf(40, 30))).toEqual({ from: 0, count: 40 })
    // a 400-line office scrolled to 106: the window's top is layout line 100; a body before and after it
    expect(windowOf(6, 106, 30, 400, 30)).toEqual({ from: 70, count: 90 })
    // near the end: cut at the content
    expect(windowOf(6, 380, 30, 400, 30)).toEqual({ from: 344, count: 56 })
    // no overscan: the body's lines alone
    expect(windowOf(6, 106, 30, 400)).toEqual({ from: 100, count: 30 })
    // an offset past the content: nothing
    expect(windowOf(6, 500, 30, 400, 30)).toEqual({ from: 400, count: 0 })
  })
})
```

Remove `OVERLAY_GAP` from `ui.test.ts`'s import (line 24) and from any expression there (search `OVERLAY_GAP`); remove `overlayInWindow`/`overlayRows` imports from the test files that import them (they are rewritten in Tasks 3-4; here only the import lines and the three pure tests change, so the file compiles).

- [ ] **Step 2: Run to see the new tests fail**

Run: `$E plugin test C:/Users/asafa/agent-theater/desktop-mod 2>&1 | grep -E "chrome|overlayHeight|windowOf|fail"`
Expected: FAIL (`overlayHeight`/`overscanOf` not exported; `chromeRows` still counts the overlay).

- [ ] **Step 3: Change the chrome** — in `office-chrome.ts`:

```ts
/** The border and padding rows of the drawer's card, top and bottom (the floating overlay: office-client.tsx). */
export const DRAWER_FRAME_ROWS = 4
```
(delete `OVERLAY_GAP` and `overlayInWindow` with their comments.)

```ts
/**
 * THE WINDOW WITH OVERSCAN (phase B, decision 26): the layout lines the module draws for the engine's window. `offset` and
 * `bodyRows` are the engine's cells; `chrome` the fixed rows above the layout (chromeRows: no overlay rides the flow any
 * more). The desktop draws a card's border rows as half a cell, so the engine's offset lands a line or so EARLIER in the
 * layout than the rows it shows — about a line per card above the window; the overscan (overscanOf) draws that many lines
 * on each side, so no blank row is ever in view. Layout line y sits at Client row chrome + y, as before.
 */
export function windowOf(chrome: number, offset: number, bodyRows: number, len: number, overscan = 0): { from: number; count: number } {
  const start = offset - chrome
  // (never past the content: a window the engine asks for beyond it draws nothing, and the module's spacer is `from` rows)
  const from = Math.min(Math.max(0, len), Math.max(0, start - overscan))
  const end = Math.min(len, start + bodyRows + overscan)
  return { from, count: Math.max(0, end - from) }
}

/** The overscan for an office of `len` lines on a `bodyRows` body: every line while the office is at most WINDOW_ROWS lines (one render draws it whole), else a body's worth on each side of the window. */
export function overscanOf(len: number, bodyRows: number): number {
  return len <= WINDOW_ROWS ? len : Math.max(0, bodyRows)
}
```

```ts
/**
 * THE DRAWER'S PAD: the lines the floating drawer is padded to on a pane of `bodyRows` — drawerMax (THE DRAWER'S ONE HEIGHT,
 * live check 7 Q2), or on a body too short for that whole card the most lines it holds whole (the overlay is absolute and
 * clipped by the viewport: a card taller than the body would hide its own bottom). drawerLines pads, never cuts. Rows
 * unknown (0): drawerMax.
 */
export function drawerPad(limits: DrawerLimits, bodyRows: number): number {
  const most = drawerMax(limits)
  return bodyRows > 0 ? Math.min(most, Math.max(0, bodyRows - DRAWER_FRAME_ROWS)) : most
}
```

```ts
/** The rows above the layout: the chrome's fixed rows (fixedRows: four, or six with the search on its own line) and the footer line when there is one. The settings popover and the drawer float over the office (phase B) and take none. */
export function chromeRows(p: OfficeProps): number {
  return fixedRows(p) + (p.footer ? 1 : 0)
}

/** The floating overlay's own rows: the settings popover's (helpRows) while it is open, else the drawer's card (its frame and its padded lines: drawerPad), else 0. What the module gives the absolute Box as its height; never part of the Client's height. */
export function overlayHeight(p: OfficeProps): number {
  if (p.helpOpen) return helpRows(p.columns, !!p.oversized)
  if (p.drawer) {
    const limits = drawerLimits(p.columns)
    return DRAWER_FRAME_ROWS + drawerLines(p.drawer, p.labels, drawerInner(p.columns), limits, drawerPad(limits, p.rows)).length
  }
  return 0
}
```

Update the header comment (lines 6-10, 25-26, 34) and the `officeHeight` comment: the overlay floats and is not counted; "the drawer's height must be exact: the rows under it are hit-tested" → delete (nothing is hit-tested by rows now).

- [ ] **Step 4: Run the tests and tsc**

Run: `$E plugin test C:/Users/asafa/agent-theater/desktop-mod 2>&1 | grep -E "chrome|overlayHeight|windowOf|pass|fail"`
Expected: the three chrome tests PASS; `office-client.tsx` and its tests still fail to load (they import the removed names) until Task 3.

- [ ] **Step 5: Commit**

```bash
git add desktop-mod/hooks/office-chrome.ts desktop-mod/hooks/office-client.test.ts desktop-mod/hooks/ui.test.ts
git commit -m "refactor(mod): phase B 2/5 - the chrome without the overlay's rows: chromeRows = fixed + footer, overlayHeight for the floating card, windowOf with overscan (overscanOf), drawerPad for a floating card; OVERLAY_GAP and overlayInWindow removed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: office-client.tsx — every click a Button, the floating overlay, the overscan window; its fake-surface tests

**Files:**
- Modify: `desktop-mod/hooks/office-client.tsx` (whole file: header 1-133; imports 135-142; `OfficeInst`/`OfficeState` 169-215; `decorOf`/`setModel`/`newInst` 251-286; `listen` 305-395; the render 407-789)
- Test: `desktop-mod/hooks/office-client.test.ts` (the fake surface 60-115; the helpers 116-260; every test that calls `f.pointer` — see the list in the Explore map: lines ~632, 671, 749, 849, 880, 916, 979, 1198, 1850, 2087 — and the assertions on `hoverRoom`, `inst.frozen` via hover, the fragment, spacer heights under an overlay, `chromeRows` with an overlay, `drawerPad`'s short pane, `inst.win`, the READING COLUMN's pointer x)

**Interfaces:**
- Consumes (Task 1): `PIN`, `PIN_OFF`, `RoomView.pinned`, `OfficeDecor = { focus }`, `NO_DECOR`, `officeModel`, `trimWindow`, `iconLabel`, `TITLE_GAP`, `CARD_BORDER`, `NBSP`, `nb`, `cut`, `fitCells`, `fitLine`, `geometry`, `roomCache`, `textWidth`, `FIT`, `NO_DECOR`. (Task 2): `chromeRows` not used by the module (it computes `inst.chrome` itself from `fixedRows` + footer), `overlayHeight` not needed (the module has the drawer's lines), `windowOf(chrome, offset, body, len, overscan)`, `overscanOf`, `drawerPad`, `DRAWER_FRAME_ROWS`, `WINDOW_ROWS`, `fixedRows`, `helpRows`, `helpPairs`, `labelsFit`, `demoLine`, `drawerInner`, `drawerLimits`, `drawerLines`, `emptyLines`, `searchShown`, `cleanSearch`, `COMPACT_BELOW`.
- Produces (Task 4 presses these keys and reads these props):
  - Buttons: `agent:<id>:who|model|emoji|word|task` (plain; child `Text` with `wrap: 'truncate'`, `bold`/`dimColor` per the row's weights; `children: [text || NBSP]`), `pin:<roomId>` (plain; `label: room.pinned ? PIN : PIN_OFF`), `more:<roomId>` (plain; `label: room.more`), `close`, `closeHelp`, `showDone`, `mute`, `help`, `demo`, `lang`, `exitDemo`, `watchDemo` as today.
  - The tree: the root `Box({ key: 'root', flexDirection: 'column', width: '100%', children: [column, overlay?] })`; `column = Box({ key: 'column', flexDirection: 'column', width: geo.W, flexShrink: 0, marginLeft: geo.margin, children: kids })`; the overlay (when `props.helpOpen` or `props.drawer`): `Box({ key: 'help' | 'drawer', position: 'absolute', top: overlayTop, left: geo.margin, width: geo.W, height: <helpH | DRAWER_FRAME_ROWS + inst.drawer.length>, backgroundColor: 'inverseText', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: geo.px, paddingY: 1, flexDirection: 'column', overflow: 'hidden', ... })` where `overlayTop = Math.max(offset, inst.chrome)` (`offset` the clamped props.offset: THE STALE OFFSET stays) — NO `marginBottom`.
  - `OfficeState = { focus: string | null; inst: OfficeInst }`; `OfficeInst` loses `margin`, `titleAt`, `view`, `drawn`; keeps `props, chrome, model, lastMode, rowAt, order, win, cache, frozen, drawerKey, drawer, query, propsSearch, posted, debounce, height, typing, id, seq, outbox, flush`.
  - The pointer listener handles `leave` only (THE PIN'S PLACE thaw); `move`, `enter`, `down`, `up` are ignored (a Button's press is the click).
  - Exports kept: `SEARCH_DEBOUNCE_MS`, `OUTBOX_FLUSH_MS`, `OUTBOX_MAX`, `TOOLBAR_GAP`, `INPUT_MIN`, `INPUT_MAX`, `PAIRS_GAP`, `DEMO_FG`, `OfficeInst`, `OfficeState`, `inOrder`, `inputWidth`, default `Office`.

- [ ] **Step 1: Write the failing tests** — in `office-client.test.ts`:

1. The fake surface: add `press(tree: unknown, key: string): void` that finds the Button node with that key in `tree` and calls `(node.props.onPress as (e: unknown) => void)({ surface: 'desktop' })`; throw `new Error(\`no Button ${key}\`)` when absent. Keep `pointer` and `key`.
2. Helpers: `kidsOf` becomes `(tree) => ((tree as Node).children[0] as Node).children as Node[]` (the column's children); add `overlayOf = (tree) => ((tree as Node).children as Node[])[1]` (undefined when none); `cards` no longer matches `fragment`; `pinOf(card)` returns the title line's Button with key starting `pin:`; `cellsOf(col)` returns the column's Buttons OR Texts (the mark column holds Texts, the others Buttons); add `cellText = (n: Node) => n.type === 'Text' ? texts(n) : texts((n.children as Node[])[0])`.
3. Replace every pointer-driven click with a press. The clicks test (line ~749, "pointer: down → hit → one post…") becomes:

```ts
test('clicks (phase B): every control is a plain Button — a row cell opens its agent, the open agent closes, the pin posts and holds the order until the pointer leaves, the more line posts roomDone; no pointer down is read', () => {
  const p = propsAt(50)  // two rooms, the second with 5 finished (a more line), the first pinned
  const f = fake(50, 30)
  let tree = Office(p, f.surface)
  const a = p.rooms[0]!.agents[0]!.id
  for (const cell of ['who', 'model', 'emoji', 'word']) {
    f.press(tree, `agent:${a}:${cell}`)
    expect(f.posts.at(-1)).toEqual({ t: 'open', id: a })
    expect(f.surface.state!.focus).toBe(a)
  }
  // the open agent: its cells close
  const open = { ...p, drawer: drawerFor(p, a), selected: a }
  tree = Office(open, f.surface)
  f.press(tree, `agent:${a}:who`)
  expect(f.posts.at(-1)).toEqual({ t: 'close' })
  // the pin: posted, and THE PIN'S PLACE holds the drawn order until a leave
  const r2 = p.rooms[1]!.id
  tree = Office(p, f.surface)
  f.press(tree, `pin:${r2}`)
  expect(f.posts.at(-1)).toEqual({ t: 'pin', room: r2 })
  expect(f.surface.state!.inst.frozen).toEqual(p.rooms.map(r => r.id))
  const pinned = { ...p, rooms: [{ ...p.rooms[1]!, pinned: true }, p.rooms[0]!] }
  tree = Office(pinned, f.surface)
  expect(cards(tree).map(c => c.props.key)).toEqual(p.rooms.map(r => `room:${r.id}`))   // the order as drawn before the pin
  f.pointer({ type: 'leave', x: 0, y: 0 })
  expect(f.surface.state!.inst.frozen).toBeNull()
  tree = Office(pinned, f.surface)
  expect(cards(tree).map(c => c.props.key)).toEqual([`room:${r2}`, `room:${p.rooms[0]!.id}`])
  // the more line
  f.press(tree, `more:${r2}`)
  expect(f.posts.at(-1)).toEqual({ t: 'roomDone', room: r2 })
  // a pointer down is nothing: no post, no state
  const n = f.posts.length
  f.pointer({ type: 'down', x: 5, y: 5, button: 'left' })
  f.pointer({ type: 'move', x: 5, y: 6 })
  expect(f.posts.length).toBe(n)
  expect('hoverRoom' in f.surface.state!).toBe(false)
})
```

4. The pin's look:

```ts
test('the pin Button is on every title: PIN_OFF (monochrome) for an unpinned room, PIN for a pinned one, both the same width in the line, before the title at the reading edge', () => {
  const p = propsAt(50)
  const tree = Office(p, fake(50, 30).surface)
  for (const card of cards(tree)) {
    const room = p.rooms.find(r => `room:${r.id}` === card.props.key)!
    const pin = pinOf(card)!
    expect(pin.type).toBe('Button')
    expect(pin.props.plain).toBe(true)
    expect(pin.props.label).toBe(room.pinned ? PIN : PIN_OFF)
    expect(pin.props.color).toBeUndefined()
    expect(pin.props.dimColor).toBeUndefined()
    // the title line: pin, title Box, counts Box — in that order whatever the pin's state
    expect((partsOf(card).title.children as Node[]).map(n => n.type)).toEqual(['Button', 'Box', 'Box'])
  }
})
```

5. The more line and the cells:

```ts
test('the more line is a plain Button of regular weight (no colour: a Button draws none) with the room\'s label; a row\'s who / model / emoji / word cells are plain Buttons whose Text child keeps the weights, the status mark a coloured Text', () => {
  const p = propsAt(50)
  const tree = Office(p, fake(50, 30).surface)
  const card = cards(tree)[1]!   // the room with the more line
  const more = partsOf(card).more!
  const b = (more.children as Node[])[0]!
  expect(b.type).toBe('Button')
  expect(b.props.key).toBe(`more:${p.rooms[1]!.id}`)
  expect(b.props.label).toBe(officeModel(p).rooms[1]!.more)
  expect(b.props.color).toBeUndefined()
  expect(b.props.bold).toBeUndefined()
  expect(b.props.dimColor).toBeUndefined()
  const cols = columnsOf(cards(tree)[0]!)
  const [mark, who] = cols
  expect(cellsOf(mark!).every(n => n.type === 'Text' && typeof n.props.color === 'string')).toBe(true)
  for (const col of cols.slice(1)) for (const cell of cellsOf(col)) {
    expect(cell.type).toBe('Button')
    expect(cell.props.plain).toBe(true)
    expect(String(cell.props.key)).toMatch(/^agent:.+:(who|model|emoji|word|task)$/)
    const t = (cell.children as Node[])[0]!
    expect(t.type).toBe('Text')
    expect(t.props.wrap).toBe('truncate')
    expect(t.props.color).toBeUndefined()
  }
  // a working agent's who is bold, a finished one's dim, as the model weights them
  const m = officeModel(p).rooms[0]!.rows
  cellsOf(who!).forEach((cell, i) => {
    const t = (cell.children as Node[])[0]!
    expect(!!t.props.bold).toBe(m[i]!.bold)
    expect(!!t.props.dimColor).toBe(m[i]!.dim && !m[i]!.failed)
  })
})
```

6. The overlay:

```ts
test('THE FLOATING OVERLAY: the drawer (or the settings) is an absolute Box from the root at max(offset, chrome) on inverseText, the reading column wide, its one height — and takes no row: the cards sit where they sat without it', () => {
  const p = propsAt(50)
  const f = fake(50, 30)
  const plain = Office({ ...p, offset: 0 }, f.surface)
  const a = p.rooms[0]!.agents[0]!.id
  const d = { ...p, drawer: drawerFor(p, a), selected: a, offset: 0 }
  const tree = Office(d, f.surface)
  const ov = overlayOf(tree)!
  const chrome = chromeRows(d)
  expect(ov.props).toMatchObject({ key: 'drawer', position: 'absolute', top: chrome, left: geometry(50).margin, width: geometry(50).W, backgroundColor: 'inverseText', height: overlayHeight(d) })
  expect(ov.props.marginBottom).toBeUndefined()
  expect(byKey(tree, 'spacer')).toEqual(byKey(plain, 'spacer'))
  expect(cards(tree).map(c => c.props.key)).toEqual(cards(plain).map(c => c.props.key))
  // scrolled: the overlay rides the window's top
  const scrolled = Office({ ...d, offset: 25, rows: 30 }, f.surface)
  expect(overlayOf(scrolled)!.props.top).toBe(25)
  // the settings: the same Box, keyed help, helpRows tall
  const h = Office({ ...p, helpOpen: true, offset: 40, rows: 30 }, f.surface)
  expect(overlayOf(h)!.props).toMatchObject({ key: 'help', position: 'absolute', top: 40, backgroundColor: 'inverseText', height: helpRows(50, false) })
  // neither open: no overlay child
  expect(overlayOf(plain)).toBeUndefined()
  // no fragment anywhere
  expect(byKey(tree, 'fragment')).toBeUndefined()
})
```

7. The window:

```ts
test('THE WINDOW WITH OVERSCAN: a short office is drawn whole at every offset; a long one a body on each side of the window; the row budget still caps the rows', () => {
  const p = propsAt(50)   // ~30 lines
  const f = fake(50, 20)
  const t0 = Office({ ...p, rows: 20, offset: 0 }, f.surface)
  const t1 = Office({ ...p, rows: 20, offset: 18 }, f.surface)
  expect(f.surface.state!.inst.win).toEqual({ from: 0, count: officeModel(p).lines.length })
  expect(rowsOf(cards(t1)[0]!)).toEqual(rowsOf(cards(t0)[0]!))
  expect(byKey(t1, 'spacer')).toBeUndefined()
  // a long office: 60 agents in one room (> WINDOW_ROWS lines with the frames), a 20-row body scrolled to 50
  const big = propsAt(50, { agents: 120 })
  const len = officeModel(big).lines.length
  expect(len).toBeGreaterThan(WINDOW_ROWS)
  Office({ ...big, rows: 20, offset: 50 }, f.surface)
  const w = windowOf(chromeRows(big), 50, 20, len, 20)
  const t = trimWindow(officeModel(big), w.from, w.count, WINDOW_ROWS)
  expect(f.surface.state!.inst.win).toEqual(t)
  expect(t.from).toBe(Math.max(0, 50 - chromeRows(big) - 20))
})
```

8. The render cost guard (the existing test): a row costs at most 9 nodes (the mark Text + 4 Button/Text pairs) — update its numbers; the tree depth unchanged.
9. Delete: the "THE OVERLAY IN VIEW (render)" test (fragment, spacer under an overlay), "THE DRAWER ON A SHORT PANE" (drawerPad through the chrome — replaced by Task 2's pure test), the hover assertions (`hoverRoom`, `'dim'` pin), the dead-row pointer parts, the READING COLUMN's pointer-x parts (keep its geometry assertions on the `column` Box: `width === geo.W`, `marginLeft === geo.margin`), the `inst.view`/`inst.drawn` assertions. Keep every test of the search field, the toolbar, the demo line, the header ladder, the keyboard walk, THE OUTBOX, THE STALE OFFSET (its pointer clicks become presses: a `more:` press then a shortened office), the memo, the catch block.

- [ ] **Step 2: Run to see them fail**

Run: `$E plugin test C:/Users/asafa/agent-theater/desktop-mod 2>&1 | grep -E "office-client|fail" | head -40`
Expected: the file fails to load (imports) or the new tests fail.

- [ ] **Step 3: Rewrite the module** — in `office-client.tsx`:

1. Imports:
```ts
import { COMPACT_BELOW, DRAWER_FRAME_ROWS, WINDOW_ROWS, cleanSearch, demoLine, drawerInner, drawerLimits, drawerLines, drawerPad, emptyLines, fixedRows, helpPairs, helpRows, labelsFit, overscanOf, searchShown, windowOf } from './office-chrome'
import type { DrawerLine } from './office-chrome'
import { CARD_BORDER, FIT, NBSP, NO_DECOR, PIN, PIN_OFF, TITLE_GAP, cut, fitCells, fitLine, geometry, iconLabel, nb, officeModel, roomCache, textWidth, trimWindow } from './office-layout'
import type { Floors, Geo, ModeToken, OfficeDecor, OfficeModel, RoomCache, RoomView, RowView } from './office-layout'
```
2. `OfficeInst`: delete `margin`, `titleAt`, `view`, `drawn` (and their doc lines); `OfficeState = { focus: string | null; inst: OfficeInst }`; `decorOf = (s) => ({ focus: s.focus })`; `setModel` builds `rowAt` and `order` only (no `titleAt`); `newInst` without the deleted fields.
3. The press handlers, module-level functions beside `send`:
```ts
/** A row cell's press: the agent's drawer opens — or closes when it is the open one (live check 7, Q2: a close, never a flip in the hooks); the keyboard focus follows the click; an Enter after it is the office's again (R14). */
function pressAgent(surface: Surface, id: string): void {
  const cur = surface.state
  if (!cur) return
  const inst = cur.inst
  inst.typing = false
  if (cur.focus !== id) surface.setState({ ...cur, focus: id })
  send(surface, inst, inst.props.drawer?.id === id ? { t: 'close' } : { t: 'open', id })
}
/** The pin Button's press: THE PIN'S PLACE (Q4) — the rooms keep the order drawn now until the pointer leaves the office (the pinned card moves to the top then, never under the pointer). */
function pressPin(surface: Surface, room: string): void {
  const cur = surface.state
  if (!cur) return
  const inst = cur.inst
  inst.typing = false
  inst.frozen ??= inst.model.rooms.map(r => r.id)
  send(surface, inst, { t: 'pin', room })
}
/** The more / hide line's press: the room's one finished toggle (Q3, Q6). */
function pressMore(surface: Surface, room: string): void {
  const cur = surface.state
  if (!cur) return
  cur.inst.typing = false
  send(surface, cur.inst, { t: 'roomDone', room })
}
```
4. `listen`: the pointer listener becomes
```ts
  surface.onPointer(ev => {
    try {
      // every click is a native Button's press (phase B, decision 26: the engine's y drifts a row per card against the drawn
      // rows); the pointer is read for one thing — its LEAVE releases THE PIN'S PLACE, so a pinned card moves to the top
      // only once the pointer is out of the office
      if (ev.type !== 'leave') return
      const cur = surface.state
      if (!cur || cur.inst.frozen === null) return
      cur.inst.frozen = null
      surface.setState({ ...cur })
    } catch {
      // a listener must never throw (the instance would unmount)
    }
  })
```
   `onKey` stays as it is (j/k over `inst.win` and `rowAt`; `d`; `o`/Enter; `KEY_MESSAGES`).
5. The render:
   - `inst.chrome = fixedRows(props, inst.query) + (props.footer ? 1 : 0)` — no overlay rows; delete the local `overlayRows`.
   - The overlay Boxes keep their content; their props become `{ key: 'help' | 'drawer', position: 'absolute', top: overlayTop, left: geo.margin, width: geo.W, height: <as today>, backgroundColor: 'inverseText', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: geo.px, paddingY: 1, flexDirection: 'column', overflow: 'hidden', ...(alignItems for the drawer as today) }` — no `marginBottom`. `overlayTop` is computed after the window (it needs the clamped offset): `const overlayTop = Math.max(offset, inst.chrome)` where `offset` is the clamped one (THE STALE OFFSET block) — in the empty branch `offset = props.offset`.
   - The window: 
```ts
      const over = overscanOf(model.lines.length, body)
      const w0 = windowOf(inst.chrome, offset, body, model.lines.length, over)
      const { from, count } = trimWindow(model, w0.from, w0.count, WINDOW_ROWS)
      inst.win = { from, count }
      const hi = from + count
      const drawn = count > 0 ? model.rooms.filter(r => r.top < hi && r.top + r.height > from) : []
      const spacer = drawn.length === 0 ? from : drawn[0]!.top
      if (spacer > 0) kids.push(Box({ key: 'spacer', height: spacer }))
      drawn.forEach(room => kids.push(card(room)))
```
     (no `atTop`, no `fragmentFirst`, no `fragment`, no `inst.view`, no `inst.drawn`; the overlay is NOT pushed into `kids`.)
   - A cell: 
```ts
      /** One value of the table: a plain Button keyed by the agent and the column, its Text child ONE line that never wraps (no plain space in it; an empty value a no-break space) in the row's weights — bold and dim are what a Button's child keeps on the desktop (paint probe 22.10: colour, underline and italic are lost there). */
      const cell = (id: string, col: string, text: string, style: Record<string, unknown>) =>
        Button({ key: `agent:${id}:${col}`, plain: true, onPress: () => pressAgent(surface, id), children: [Text({ wrap: 'truncate', ...style, children: [text || NBSP] })] })
      /** The status mark: a coloured Text — a Button would lose its colour; the mark is not a click target. */
      const mark = (r: RowView) => Text({ wrap: 'truncate', color: r.color, children: [r.status || NBSP] })
```
     and the columns: `column('status', rows, r => mark(r), false)`, `column('who', rows, r => cell(r.id, 'who', r.who, { bold: r.bold, dimColor: r.dim && !r.failed }), false)`, `column('model', rows, r => cell(r.id, 'model', r.model, { dimColor: true }), false)`, `column('actEmoji', rows, r => cell(r.id, 'emoji', r.actEmoji, { dimColor: r.dim }), ...)`, `column('actWord', rows, r => cell(r.id, 'word', r.actWord, { dimColor: !r.bold }), ...)`, `column('task', rows, r => cell(r.id, 'task', r.task, { dimColor: true }), true)` — `column(name, rows, pick: (r: RowView) => RenderElement, grow)`; its `children: rows.map(pick)`; the minWidth floors as today.
   - The title line: 
```ts
      const titleLine = (room: RoomView): RenderElement => Box({ flexDirection: row, justifyContent: 'space-between', width: '100%', height: 1, paddingX: 1, gap: TITLE_GAP, overflow: 'hidden', children: [
        // THE PIN (decision 26): a plain Button on every card — the colour 📌 of a pinned room, the monochrome PIN_OFF otherwise
        // (no hover exists on the desktop, and dim does not dim an emoji); one width either way, so the title never moves
        Button({ key: `pin:${room.id}`, plain: true, label: room.pinned ? PIN : PIN_OFF, onPress: () => pressPin(surface, room.id) }),
        Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, height: 1, overflow: 'hidden', justifyContent: edge, children: [Text({ bold: true, children: [room.title] })] }),
        Box({ flexShrink: 0, height: 1, children: [Text({ dimColor: true, children: [room.counts] })] }),
      ] })
```
   - The more line: `const moreLine = (room) => Box({ flexDirection: row, paddingX: 1, height: 1, overflow: 'hidden', children: [Button({ key: \`more:${room.id}\`, plain: true, label: room.more, onPress: () => pressMore(surface, room.id) })] })` — with the comment that a Button draws no colour (Q7's link colour withdrawn, decision 26): the arrow at the string's end is the cue.
   - The root: 
```ts
    const column = Box({ key: 'column', flexDirection: 'column', width: geo.W, flexShrink: 0, marginLeft: geo.margin, children: kids })
    return Box({ key: 'root', flexDirection: 'column', width: '100%', children: overlay ? [column, overlay] : [column] })
```
   - The empty office: `inst.win = { from: 0, count: 0 }`; the empty block in `kids`; the overlay (if any) still floats.
   - The catch block resets `st.inst.win` only.
6. The header comment: rewrite the paragraphs on geometry, THE OVERLAY IN VIEW and the clicks (lines 67-105, 113): the window with overscan; the floating overlay; "every click is a native Button: the row's cells, the pin on every title, the more line, the closes — the engine's pointer y drifts a row per card against the drawn rows (the frames' border rows are half a cell on the desktop), so nothing is hit-tested by y; the pointer's leave alone is read (THE PIN'S PLACE)"; the Button fact (bold and dim only).

- [ ] **Step 4: Run the file's tests, validate and tsc**

Run: `$E plugin test C:/Users/asafa/agent-theater/desktop-mod 2>&1 | tail -8`, `$E plugin validate C:/Users/asafa/agent-theater/desktop-mod | tail -3`, the tsc command.
Expected: office-client.test.ts, office-layout.test.ts, the pure chrome tests PASS; validate ✔; tsc clean for the hooks module (the kit test files of Task 4 may still fail at runtime — they press by the old line map — but must compile; fix only their imports if tsc names them, nothing more).

- [ ] **Step 5: Commit**

```bash
git add desktop-mod/hooks/office-client.tsx desktop-mod/hooks/office-client.test.ts
git commit -m "feat(mod): phase B 3/5 - every click in the office a native Button (the row's cells, the pin on every title, the more line), the drawer and the settings one absolute overlay at max(offset, chrome) on inverseText, the window drawn with overscan; the pointer read for its leave alone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: the kit tests — clicks by key; the overlay and the heights by the new rules

**Files:**
- Modify: `desktop-mod/hooks/office-controls.test.ts` (header 37-47; helpers 183-377: `windowNow`, `touched`, `pinOf`, `hitOf`, `click`, `moveOver`, `clickRow`, `deadRow`, `PIN_ZONE`; tests at 383, 515, 627, 684, 730, 743, 775, 829, 964, 1039, 1146, 1221), `desktop-mod/hooks/office-buttons.test.ts` (helpers 33-73, 546; tests 218-225, 269-301, 345-362, 386-454, 412, 642-674), `desktop-mod/hooks/office-client.mounted.test.ts` (helper 96; tests 102, 192, 265, 310), `desktop-mod/hooks/register.test.ts` (helper 70-77; calls 129, 137, 140, 207), `desktop-mod/hooks/ui.test.ts` (helper 314-321; calls 898, 927, 960; heights 684, 714)

**Interfaces:**
- Consumes (Task 3): the Button keys `agent:<id>:who`, `pin:<room>`, `more:<room>`; the overlay Box (`key: 'drawer' | 'help'`, `position: 'absolute'`, `top`, `left`, `width`, `height`, `backgroundColor: 'inverseText'`); `PIN`, `PIN_OFF`; (Task 2) `chromeRows`, `overlayHeight`, `windowOf`, `overscanOf`, `drawerPad`; (Task 1) `RoomView.pinned`.
- Produces: nothing; the suite green.

- [ ] **Step 1: Rewrite the click helpers** — in each file replace the line-map helpers by presses:

office-controls.test.ts:
```ts
/** A click on the office's controls as the desktop does it (phase B): the Button's press by its key. */
const press = (ui: Mounted, key: string) => ui.press({ in: OFFICE_KEY, key })
const clickAgent = (ui: Mounted, id: string) => press(ui, `agent:${id}:who`)
const clickPin = async (ui: Mounted, room: string) => { await press(ui, `pin:${room}`); await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 }) }
const clickMore = (ui: Mounted, room: string) => press(ui, `more:${room}`)
/** The pin Button's label on a drawn card: PIN when pinned, PIN_OFF otherwise. */
const pinLabelOf = async (ui: Mounted, room: string) => (await ui.find({ in: OFFICE_KEY, type: 'Button', key: `pin:${room}` }))?.props.label
```
(`Mounted` = the type of `$.ui.mount`'s result as the file already names it, or `Awaited<ReturnType<typeof mountOffice>>`.) Delete `hitOf`, `click`, `moveOver`, `clickRow`, `deadRow`, `windowNow`, `touched`, `PIN_ZONE`, `pinOf` (replace its uses by `pinLabelOf` comparing to `PIN`/`PIN_OFF`).

office-buttons.test.ts: delete `hitOf`, `cellOf`, `down`, `drawnTitle`; add the same `press`/`clickAgent`/`clickPin`/`clickMore`/`pinLabelOf`.
office-client.mounted.test.ts: delete `lineOf`; clicks by `ui.press({ in: OFFICE_KEY, key: \`agent:${id}:who\` })`.
register.test.ts and ui.test.ts: `click`/`clickIn` become `ui.press({ in: OFFICE_KEY, key: kind === 'agent' ? \`agent:${id}:who\` : kind === 'pin' ? \`pin:${id}\` : \`more:${id}\` })` followed, for a pin, by a `leave`.

- [ ] **Step 2: Rewrite or delete the tests tied to the old model**

Delete: office-controls "SCROLLED (the line map)" (1039), "SCROLLED (the card controls lower down)" (1146) and "OVERLAID at the top" (1221) — replace the three by ONE test:

```ts
t('SCROLLED: a press reaches its Button wherever the pane is scrolled; the drawer floats at the window\'s top; the cards do not move under it', async ($, on) => {
  const many = fixture.concat(moreAgents(40))
  const { ui, props } = await mountOffice($, on, many, { offset: 0, bodyRows: 20 })
  const p0 = props()
  const last = p0.rooms.at(-1)!
  const id = last.agents[0]!.id
  await scrollTo(ui, 30)
  await clickAgent(ui, id)
  const p1 = props()
  expect(p1.drawer?.id).toBe(id)
  const ov = await ui.find({ in: OFFICE_KEY, type: 'Box', key: 'drawer' })
  expect(ov?.props).toMatchObject({ position: 'absolute', top: Math.max(30, chromeRows(p1)), backgroundColor: 'inverseText', height: overlayHeight(p1) })
  const before = (await ui.findAll({ in: OFFICE_KEY, type: 'Box' })).filter(n => String(n.props.key ?? '').startsWith('room:')).map(n => n.props.key)
  await press(ui, 'close')
  const after = (await ui.findAll({ in: OFFICE_KEY, type: 'Box' })).filter(n => String(n.props.key ?? '').startsWith('room:')).map(n => n.props.key)
  expect(after).toEqual(before)
  // a press lower down than any pointer could reach exactly: the last room's more line
  if (last.moreLabel) { await clickMore(ui, last.id); expect(props().rooms.at(-1)!.showDone).not.toBe(last.showDone) }
})
```
(`moreAgents`, `scrollTo`, `fixture`, `mountOffice`, `props()` — the file's own helpers; `scrollTo` exists at :187; `props()` stands for however the file reads the latest Client props — use its existing way, e.g. the `Client` node's `props.props` from `ui.find({ type: 'Client' })`.)

office-controls: "📌 pin" (684) → presses + `pinLabelOf`; the `'dim'` and `pinZone` assertions (627, 689, 697, 1183) deleted; "row click" (775): presses; its `height: overlayRows(p1) - OVERLAY_GAP` → `height: overlayHeight(p1)` and `chromeRows(p1) === fixedRows(p1) + overlayRows(p1)` (797) → `chromeRows(p1) === fixedRows(p1) + (p1.footer ? 1 : 0)`; the `hits`-per-title assertions (550, 573, 735, 750, 1195) deleted; the header comment (37-47) rewritten: "THE CLICKS THROUGH THE BUTTONS (phase B)".
office-buttons: R9's hit zones and the dim 📌 (386-424) → one test that the title holds a `pin:<room>` Button labelled `PIN_OFF`, and no Text `PIN` elsewhere on the title; R5's hover → bright (642-671) → a press on `pin:<room>` makes the label `PIN` at once (before the leave) and the card order unchanged until the leave; `LINK_FG` (412) → the more Button has no `color`; Q2's one height via `chromeRows` (433-454) → via `overlayHeight(p)` equal across agents with different result lengths, and `chromeRows` equal with and without a drawer; "chrome unchanged by toggles" (218-225) kept with `chromeRows`.
office-client.mounted: "opens IN VIEW" (310) → the overlay's `top === p1.offset` when scrolled past the chrome and no `fragment`/`spacer` change; the dead-click rows (265) deleted; the row click (102) by press.
register.test / ui.test: the four and three clicks by press; ui.test 684/714 keep `client.props.height === officeHeight(p, rowCount(p))` and add the same assertion with the drawer open (after `press agent:<id>:who`): equal to the closed height.

- [ ] **Step 3: Run the whole suite, validate, tsc**

Run: `$E plugin test C:/Users/asafa/agent-theater/desktop-mod 2>&1 | tail -6`; `$E plugin validate C:/Users/asafa/agent-theater/desktop-mod | tail -2`; the tsc command.
Expected: 0 fail (expect around 275-290 tests); ✔; clean.

- [ ] **Step 4: Commit and push**

```bash
git add desktop-mod/hooks/office-controls.test.ts desktop-mod/hooks/office-buttons.test.ts desktop-mod/hooks/office-client.mounted.test.ts desktop-mod/hooks/register.test.ts desktop-mod/hooks/ui.test.ts
git commit -m "test(mod): phase B 4/5 - the kit tests press the office's Buttons by key (agent:<id>:who, pin:<room>, more:<room>); the floating overlay and the heights asserted by the new rules; the line-map click helpers removed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin feat/desktop-mod
```

---

### Task 5: docs — ui.tsx's header, the specs, the handoff, the old plan's engine path

**Files:**
- Modify: `desktop-mod/hooks/ui.tsx` (header comment lines 27-49 only), `docs/superpowers/specs/2026-10-19-office-cards-design.md` (after "Phase B, decided"), `desktop-mod/HANDOFF.md` (the top checkpoint), `docs/superpowers/plans/2026-10-10-client-office-and-usage-plan.md` (Global Constraints line 26: the engine path → `C:/Users/asafa/AppData/Roaming/Claude/claude-code/2.1.304/aed62990b91e/claude.exe`, and the Co-Authored-By line 33 → `Claude Fable 5.1`), `desktop-mod/README.md` if it describes clicking the office (search "hover" / "📌").

- [ ] **Step 1: ui.tsx header** — lines 31-37: the Client is sized to its content WITHOUT the overlay (it floats: office-client.tsx); no head hover; every click a Button whose press posts THE OUTBOX.
- [ ] **Step 2: cards spec** — add under "Phase B, decided": `**Built (22.10, commits <sha1>..<sha4>):** as decided; the kit presses by key (the keys listed in the plan 2026-10-22-office-phase-b-plan.md); the pin reserves its cells on every title (countsFor/cutTitle with pinned = true); the overlay's top is max(offset, chromeRows) so at the pane's top it sits under the toolbar and never covers the header.`
- [ ] **Step 3: HANDOFF** — a new top checkpoint paragraph: phase B built (what, the commits, the test count), live check 8 next (what to check: every click lands at any depth; the drawer/settings float and nothing moves; the pin's two glyphs; the more line's look; scrolling shows no blank rows; the overlay at the top of the pane under the toolbar; ≥100 columns the overlay centred with the column).
- [ ] **Step 4: Run validate / test / tsc once more; commit and push**

```bash
git add desktop-mod/hooks/ui.tsx docs/superpowers/specs/2026-10-19-office-cards-design.md desktop-mod/HANDOFF.md docs/superpowers/plans/2026-10-10-client-office-and-usage-plan.md desktop-mod/README.md
git commit -m "docs(mod): phase B 5/5 - the office's clicks are Buttons, the overlay floats; ui.tsx header, the cards spec's built note, the handoff for live check 8, the engine path in the plan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin feat/desktop-mod
```

---

## Self-review notes (controller, 22.10)

- Spec coverage: decision 26 (a)-(f) → Tasks 1 (pin always, `pinned`), 3 (cells as Buttons, the mark a Text, the more Button, the overlay, overscan, pointer = leave), 2 (no overlay rows, overscan maths, drawerPad), 4 (tests), 5 (docs). Decision 25's arrow: unchanged code (`MORE_MARK`), restated in constraints. R13 overscan: Task 2/3. Q8 (hover pin): replaced by the always-drawn pin (decision 26 a).
- Open risk, to measure at live check 8: `left: geo.margin` assumes the desktop places the absolute Box against the root region's left edge; if it is placed against the `column` Box instead, the overlay at ≥100 columns shifts right by the margin — then set `left: 0`. At narrower panes the margin is 0 and both agree.
- Open risk: a drawer whose own lines exceed the body (a very short pane) is clipped at the viewport's bottom; its close Button is at its top and stays reachable.
