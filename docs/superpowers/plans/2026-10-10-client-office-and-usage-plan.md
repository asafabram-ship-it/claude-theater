# Client Office + 5-Hour Usage Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**סטטוס:** שלב 1 (Tasks 1.1-1.4 + 1.4b) הושלם 2026-10-10 13:15 (`4bc5b6e`, 93 בדיקות); ההכרעות של אסף נרשמו באפיון סעיף 2 פריטים 7-9 (Task 1.2b מותנה במדידה; מחיקה מלאה של יומן האבחון; Task 1.4b בוצע). Task 0.1 הושלם 06:12 (ה-probe בתיקיית הטעינה החמה של הסשן, `dev-mods\<session-id>\theater-probe`); Task 0.2 (הבדיקה החיה) ו-Task 1.5 (מדידה) ממתינים לאסף - ראו HANDOFF 13:15. פרומפט ההמשך: `desktop-mod/פרומפט להמשך - בניית המשרד על Client.md`.

**Goal:** On the Claude Desktop app, draw the Theater office inside ONE `Client` surface module so that data updates and scrolling never blink, characters are clickable, the scan stops slowing the machine, and the prompt footer shows the five-hour rate-limit meter.

**Architecture:** The hooks module (`register.tsx`) keeps feeding a slim `OfficeProps` object into a single keyed `<Client key="office" module="./office-client.tsx">` that the engine keeps alive across the pane's redraws; the module lays the office out as text cells (emoji heads, half-block desks, run-merged rows), windows the rows itself, hit-tests clicks, and posts actions back through `ui.message`. The hooks own the pane's scroll (`ui.scroll` answered without `next`). The 5-hour meter is a label added to the `SessionMode` footer site from `session.measure`.

**Tech Stack:** Claude Code mods API (engine 2.1.293 bundled with the Desktop app), TypeScript/TSX hooks module + surface module, `claude plugin validate|test`, `tsc`, git branch `feat/desktop-mod`.

Spec: `docs/superpowers/specs/2026-10-10-client-office-and-usage-design.md` (Hebrew). Section numbers below refer to it.

## תקציר בעברית (למי שקורא רק את זה)

ארבעה שלבים, כל אחד עובד ונבדק לבד, וכל משימה נסגרת ב-commit + push ל-`feat/desktop-mod`:
0. **בדיקה חיה** (מוד זעיר מחוץ לריפו): האם Client בדסקטופ באמת לא מהבהב, לוקח לחיצות, ומצייר ריבועי צבע. רק אם עובר ממשיכים.
1. **סריקה חסכונית**: 5 שניות במקום 1.5, פרסור רק של מה שנוסף לקובץ, בלי יומן אבחון, פרסום אחד במקום שלושה. מדידת CPU לפני/אחרי.
2. **המשרד על Client**: פריסה טהורה (`office-layout.ts`), נתונים רזים (`office-props.ts`), המודול (`office-client.tsx`), חיווט ב-`register.tsx` ו-`ui.tsx`, בדיקות, הפעלה מחדש ובדיקה בעין.
3. **מד 5 השעות**: `usage.ts` + hooks על `session.measure` ו-`SessionMode`, וגם בכותרת החלונית.
4. **ניקיון**: מחיקת השיבוטים הזמניים מהמחקר, עדכון HANDOFF.

## Global Constraints

- Engine for every check: `C:/Users/asafa/AppData/Roaming/Claude/claude-code/2.1.293/83cb0bd7fed4/claude.exe` (the `claude` on PATH is too old for mods). Call it `$E` below.
- Checks after every task: `$E plugin validate C:/Users/asafa/agent-theater/desktop-mod` (must print `✔ Validation passed`), `$E plugin test C:/Users/asafa/agent-theater/desktop-mod` (0 fail), `C:/Users/asafa/AppData/Local/Temp/theater-tsc/node_modules/.bin/tsc -p C:/Users/asafa/AppData/Local/Temp/theater-tsc` (no output = clean).
- Plugin name stays `agent-theater`; pane id `agent-theater`; `$.state` plugin key `agent-theater`.
- Engine rules `claude plugin validate` enforces: `$` is never passed to a function imported from another file (helpers that take `$` live in the file that uses them); an event is hooked at most once WITHOUT a matcher per module; `$.state` atoms are `const atom({ plugin: 'agent-theater', key: '<literal>' } as const, DEFAULT)` declared in the file that reads them and declared in `types/index.d.ts`; a `Client`'s `module` prop is a string literal path relative to the hooks module; never name a local `h` (JSX compiles to `h`).
- Client contract (spec §4): props are plain JSON with NO `undefined` anywhere (the whole tree is refused otherwise); the module's tree ≤ 20,000 nodes / 32 deep / 100,000 characters serialized and ≤ 1 s per call or the instance unmounts; `surface.every` started once while `surface.state === undefined`; never three `setState`-only renders in a row; `surface.post` ≤ 100,000 characters.
- No bidi control characters (U+202A–U+202E, U+200E/F) in any Text: the desktop refuses them. Hebrew strings are single runs.
- `Date.now()` is not used in the hooks module (use `$.clock.now()`); the surface module counts time in `surface.every` ticks and from `props.nowMin`.
- Conversation with the user: Hebrew, simple. Code and commit messages: English. Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and is pushed: `git push origin feat/desktop-mod`.
- The mod is currently DISABLED (`CLAUDE_CODE_PLUGIN_DIRS` removed from `~/.claude/settings.json`; backup `settings.json.bak-2026-10-08-theater-off`). It is re-enabled only in Task 2.8, after Phases 0–2 pass their tests.
- Windows MAX_PATH: never clone or write under the long scratchpad path; the probe mod lives in `C:\Users\asafa\.claude\dev-mods\theater-probe\` (short).

---

## File Structure

| File | Responsibility | Phase |
| --- | --- | --- |
| `C:\Users\asafa\.claude\dev-mods\theater-probe\{.claude-plugin/plugin.json, hooks/hooks.json, hooks/register.tsx, hooks/probe-client.tsx}` | Throwaway probe: one Client, counter, 100 tiles, pointer log, own scroll, SessionMode label. Not in the repo. | 0 |
| `desktop-mod/hooks/model.ts` | Constants: `POLL_MS` 5000, `GLOB_TTL_SEC` 30, new `REDRAW_LATCH_MS`, `MAX_EVENTS`, `DESKTOP` flag object | 1, 2 |
| `desktop-mod/hooks/scanner.ts` | Incremental transcript parsing (`textLen` + kept events per file) | 1 |
| `desktop-mod/hooks/register.tsx` | Remove diag; one publish per poll; `ui.message`, `ui.scroll`, `ui.fault` hooks; `requestRedraw`; scroll offset in memory; usage hooks | 1, 2, 3 |
| `desktop-mod/hooks/ui.tsx` | Desktop branch returns the Client node; `finishBeat` no longer writes `view`; `firstSeen`/stars feed `office-props` | 1, 2, 3 |
| `desktop-mod/hooks/office-layout.ts` (new) | Pure: cells, rows, tiles, room heads, run merging, hit-testing, windowing | 2 |
| `desktop-mod/hooks/office-props.ts` (new) | Pure: `OfficeProps`/`OfficeMessage` types, `buildOfficeProps`, `assertJson` | 2 |
| `desktop-mod/hooks/office-client.tsx` (new) | The surface module: chrome (header/toolbar/search/help/drawer) + windowed office rows, pointer, keys, event fx | 2 |
| `desktop-mod/hooks/usage.ts` (new) | Pure: pick `five_hour`, format the label and the bar | 3 |
| `desktop-mod/types/index.d.ts` | Contract: drop `live`, add `stars` to the payload | 1, 2 |
| `desktop-mod/hooks/*.test.ts` | Tests per task | all |
| `desktop-mod/HANDOFF.md` | Probe results, CPU numbers, state of the work | 0, 1, 2 |

---

## Shared interfaces (defined once; every task uses these names)

```ts
// hooks/office-props.ts (Task 2.2)
export const OFFICE_KEY = 'office'                       // the Client's key and the ui.message matcher
export type OfficeAgent = {
  id: string; emoji: string; name: string
  status: 'running' | 'stale' | 'done'
  fam: '' | 'search' | 'read' | 'write' | 'cmd' | 'agent'   // toolFamily(tool) from office-svg.ts
  act: string                                               // activityLabel(a, lang)
  model: string                                             // modelLabel(a.model) or '?'
  modelFam: 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other'
  startMin: number | null                                   // elapsed minutes (agentElapsed at the minute clock), null = unknown
  isLead: boolean; failed: boolean; longRunning: boolean
  star: number                                              // detection stamp (the poll's clock) of a just-finished agent inside the ⭐ window, else 0
  enteredAt: number                                         // ms the office first saw it (firstSeen), 0 when unknown
}
export type OfficeRoom = {
  id: string; title: string; small: string; pinned: boolean; showDone: boolean
  run: number; stale: number; done: number
  agents: OfficeAgent[]
}
export type OfficeDrawer = {
  id: string; name: string; chips: string[]; model: string; act: string; task: string; result: string; truncated: boolean
  elapsedMin: number | null                                 // whole minutes of agentElapsed(sel, nowMin, true): the duration when done, else the elapsed; null = unknown
  sub: string                                               // the dim subtitle under the name, as today: role || task_short (≤ 48)
}
export type OfficeProps = {
  v: 1
  lang: 'he' | 'en'; rtl: boolean
  columns: number; rows: number
  offset: number
  nowMin: number
  counts: { run: number; idle: number; done: number }
  prefs: { showDone: boolean; muted: boolean; still: boolean }
  search: string; selected: string | null; helpOpen: boolean; demo: boolean
  rooms: OfficeRoom[]
  drawer: OfficeDrawer | null
  footer: string
  usage: { pct: number; resetsAt: string } | null
  empty: { kind: 'office' | 'nomatch' | 'nonewindow' | 'noactive'; msg: string; sub: string } | null
  labels: Record<string, string>                            // the i18n strings the module draws (toolbar, help rows, drawer headings)
}
export type OfficeMessage =
  | { t: 'open'; id: string } | { t: 'close' } | { t: 'pin'; room: string } | { t: 'roomDone'; room: string }
  | { t: 'showDone' } | { t: 'mute' } | { t: 'lang' } | { t: 'help' } | { t: 'demo' } | { t: 'still' }
  | { t: 'search'; q: string } | { t: 'focus'; id: string } | { t: 'content'; rows: number } | { t: 'pull'; seq: number }
```

```ts
// hooks/office-layout.ts (Task 2.1)
export const TILE_W = 14, TILE_H = 6, TILE_GAP = 1, EMOJI_CELLS = 2
export type Cell = { ch: string; fg?: string; bg?: string; bold?: true; dim?: true }
export type CellRow = { id: string; cells: Cell[] }
export type Run = { text: string; fg?: string; bg?: string; bold?: true; dim?: true }
export type Hit = { kind: 'agent' | 'pin' | 'roomDone'; id: string; x: number; y: number; w: number; h: number }
export type OfficeLayout = { rows: CellRow[]; hits: Hit[] }
export function blankRow(id: string, columns: number): CellRow
export function put(row: CellRow, x: number, text: string, style?: Omit<Cell, 'ch'>): void   // clips to the row; an emoji takes EMOJI_CELLS
export function tilesPerRow(columns: number): number                                        // max(1, floor((columns + TILE_GAP) / (TILE_W + TILE_GAP)))
export function tileX(i: number, perRow: number, columns: number, rtl: boolean): number
export function layoutOffice(props: OfficeProps): OfficeLayout
export function rowRuns(cells: readonly Cell[]): Run[]
export function hitAt(layout: OfficeLayout, x: number, y: number): Hit | undefined
export function windowRows(layout: OfficeLayout, offset: number, count: number): CellRow[]
export const MODEL_BG: Record<OfficeAgent['modelFam'], string>  // opus '#7b5cf0', sonnet '#2f7fe8', haiku '#1fa876', fable '#d9872b', other '#3a4470'
export const STATUS_FG: Record<OfficeAgent['status'], string>   // running '#7ee29a', stale '#e6c07e', done '#9fb0e6'
```

```ts
// hooks/usage.ts (Task 3.1)
export type FiveHour = { pct: number; resetsAt: string }
export function pickFiveHour(limits: ReadonlyArray<{ kind: string; percentUsed: number; resetsAt?: string }>): FiveHour | null
export function usageBar(pct: number, cells?: number): string            // '▰▰▰▰▱▱▱▱▱▱' (10 cells by default)
export function usageLabel(u: FiveHour, lang: 'he' | 'en', now: number): string   // '⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30' ('⚠' prefix at ≥ 80)
```

---

# Phase 0 — Live probe (spec §12). Gate for everything in Phase 2.

### Task 0.1: The probe mod

**Files:**
- Create: `C:\Users\asafa\.claude\dev-mods\theater-probe\.claude-plugin\plugin.json`
- Create: `C:\Users\asafa\.claude\dev-mods\theater-probe\hooks\hooks.json`
- Create: `C:\Users\asafa\.claude\dev-mods\theater-probe\hooks\register.tsx`
- Create: `C:\Users\asafa\.claude\dev-mods\theater-probe\hooks\probe-client.tsx`

**Interfaces:**
- Produces: a command `/theater-probe` that opens pane `theater-probe`; a log file `C:\Users\asafa\.claude\theater-probe.log` with one line per event.

- [ ] **Step 1: Write the manifest and hooks.json**

`plugin.json`:
```json
{ "name": "theater-probe", "version": "0.1.0", "description": "Probe: does a Client in a desktop pane survive redraws and scroll, take clicks, draw colour cells" }
```
`hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```

- [ ] **Step 2: Write the surface module `hooks/probe-client.tsx`**

```tsx
// Probe surface module: 100 half-block tiles, a counter on its own clock, a Button, an Input,
// pointer logging. No `$` here: everything reaches the hooks through surface.post.
import type { ClientModule, ClientSurface } from 'claude-code'

type Props = { seq: number; offset: number; hot: number; rows: number; columns: number }
type State = { tick: number; last: string; stop: () => void }

const COLS = 10
const TILE_W = 6
const PAL = ['#7b5cf0', '#2f7fe8', '#1fa876', '#d9872b', '#e6c07e']

const Probe: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text, Button, Input } = surface.elements
  if (surface.state === undefined) {
    let tick = 0
    const stop = surface.every(250, () => {
      tick += 1
      const s = surface.state
      if (s) surface.setState({ ...s, tick })
    })
    surface.onPointer(ev => {
      const s = surface.state
      if (!s) return
      const line = `${ev.type} x=${ev.x} y=${ev.y} ${ev.button ?? ''}`
      surface.post({ t: 'pointer', line })
      if (ev.type === 'down') surface.setState({ ...s, last: line })
    })
    surface.onKey(ev => surface.post({ t: 'key', line: `${ev.key}${ev.ctrl ? ' ctrl' : ''}` }))
    surface.setState({ tick: 0, last: '-', stop })
  }
  const s = surface.state ?? { tick: 0, last: '-', stop: () => undefined }
  const rows: ReturnType<typeof Text>[] = []
  for (let r = 0; r < COLS; r++) {
    const kids: Array<ReturnType<typeof Text> | string> = []
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c
      const hot = i === props.hot
      const fg = PAL[(i + props.seq) % PAL.length] ?? '#fff'
      kids.push(Text({ color: hot ? '#ffffff' : fg, backgroundColor: hot ? '#c62828' : undefined, children: ['🦉', '▀'.repeat(TILE_W - 2)] }))
    }
    rows.push(Text({ key: `r${r}`, wrap: 'truncate', children: kids }))
  }
  const visible = rows.slice(props.offset, props.offset + Math.max(1, props.rows - 4))
  return Box({
    flexDirection: 'column',
    children: [
      Text({ bold: true, children: [`probe tick=${s.tick} seq=${props.seq} offset=${props.offset} size=${surface.columns}x${surface.rows} last=${s.last}`] }),
      Box({ flexDirection: 'row', columnGap: 1, children: [
        Button({ key: 'probe-btn', label: 'Press me', hotkey: 'p', onPress: () => surface.post({ t: 'press' }) }),
        Input({ key: 'probe-in', placeholder: 'type here', value: '', onInput: (v: string) => surface.post({ t: 'input', line: v }) }),
      ] }),
      Text({ dimColor: true, children: ['שלום עולם — עברית בריצה אחת'] }),
      ...visible,
    ],
  })
}
export default Probe
```

- [ ] **Step 3: Write the hooks module `hooks/register.tsx`**

```tsx
// Probe hooks: /theater-probe opens the pane; a 2 s timer changes props; ui.scroll is answered
// without next (own offset); ui.message logs; ui.fault logs; SessionMode gets a test label.
import type { EngineInterface, Register } from 'claude-code'

const PANE = 'theater-probe'
let seq = 0
let hot = 0
let offset = 0
let contentRows = 10
let faults = 0
let redrawPending = false

async function log($: EngineInterface, line: string): Promise<void> {
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
    const path = `${home}/.claude/theater-probe.log`
    const old = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
    await $.fs.write(path, `${old}${new Date().toISOString()} ${line}\n`.slice(-200_000))
  } catch {
    // probe only
  }
}

function requestRedraw($: EngineInterface): void {
  if (redrawPending) return
  redrawPending = true
  $.clock.after(100, () => {
    redrawPending = false
    $.ui.invalidate('ui.render')
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'theater-probe', description: 'Open the Client probe pane', immediate: true }).catch(() => undefined)
    $.clock.every(2000, () => {
      seq += 1
      hot = (hot + 7) % 100
      requestRedraw($)
    })
    return next(e)
  })
  on('command.run', { command: 'theater-probe' }, async $ => {
    await $.ui.open({ id: PANE, title: 'probe' })
    void log($, 'opened')
    return { text: 'theater-probe: pane opened; log at ~/.claude/theater-probe.log' }
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    void log($, `render seq=${seq} offset=${offset} scroll=${e.props.scroll?.offset ?? '-'} cols=${e.props.bodyColumns} rows=${e.props.scroll?.bodyRows ?? '-'}`)
    if (e.surface === 'desktop' && 'Client' in els) {
      const { Client } = els
      return Box({ flexDirection: 'column', children: [
        Client({ key: 'probe', module: './probe-client.tsx', width: e.props.bodyColumns, height: e.props.scroll?.bodyRows ?? 20,
          props: { seq, offset, hot, rows: e.props.scroll?.bodyRows ?? 20, columns: e.props.bodyColumns ?? 60 } }),
      ] })
    }
    return Text({ children: [`probe (no Client on ${e.surface}) seq=${seq}`] })
  })
  on('ui.scroll', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    const max = Math.max(0, contentRows - 1)
    offset = Math.max(0, Math.min(max, offset + e.by))
    void log($, `scroll by=${e.by} -> offset=${offset} (engine offset=${e.offset})`)
    requestRedraw($)
    return {}
  })
  on('ui.message', { element: 'probe' }, async ($, e) => {
    const d = e.data as { t?: string; line?: string }
    void log($, `message ${d.t ?? '?'} ${d.line ?? ''}`)
    if (d.t === 'press') {
      // answer with new props and NO ui.render: the drawing must change (seq jumps by 100)
      seq += 100
      return { props: { seq, offset, hot, rows: 20, columns: 60 } }
    }
    return {}
  })
  on('ui.fault', async ($, e, next) => {
    faults += 1
    void log($, `FAULT #${faults} phase=${e.phase} reason=${e.reason}`)
    return next(e)
  })
  on('ui.render', { component: 'SessionMode' }, ($, e, next) =>
    next({ ...e, props: { ...e.props, modes: ['⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30', ...e.props.modes] } }))
}
```

- [ ] **Step 4: Validate**

Run: `$E plugin validate C:/Users/asafa/.claude/dev-mods/theater-probe`
Expected: `✔ Validation passed` (warnings about fs.write are fine). If `ui.fault` is refused as "hooked without a matcher" on this build, add the matcher `{ element: 'probe' }`.

- [ ] **Step 5: Load it for one session**

The probe is loaded via the desktop app's hot-reload folder: tell the user (Hebrew) to open a NEW conversation; the app asks "Enable hot reloading for this session?" → "Enable for this session". No commit (outside the repo).

### Task 0.2: Run the checklist and record the verdict

**Files:**
- Modify: `desktop-mod/HANDOFF.md` (new section "שלב 0 — תוצאות הבדיקה החיה")

- [ ] **Step 1: Ask the user to run, in a new conversation, `/theater-probe`, and then (one at a time, Hebrew instructions):**
  1. Watch 30 s: the tick counter climbs every 250 ms while the hot tile moves every 2 s. PASS = no blink, counter never resets.
  2. Wheel 20 ticks over the pane body. PASS = the rows window moves, no blink, log shows `scroll by=… engine offset=0` (window never moved).
  3. Click three tiles, press "Press me", type `abc` in the field, click a tile then press `a`. PASS = log shows `message pointer down x=… y=…` with sane cells, `message press`, `message input abc`, `message key a`.
  4. After "Press me" the header shows `seq` jumped by 100 with NO `render` line after the `message press` line in the log. PASS = the `{ props }` answer channel works.
  5. Screenshot of the pane for cell metrics (emoji = 1 or 2 cells? colour backgrounds? `▀` two-tone? Hebrew line order?).
  6. Task Manager, 60 s: CPU of `claude.exe` and of the Claude app with the pane open.
  7. Look at the footer under the prompt: where did `⏳ 5h …` land (between Auto and Fable? at the right?).
- [ ] **Step 2: Write the results into `desktop-mod/HANDOFF.md`** under a new heading `## שלב 0 — תוצאות הבדיקה החיה (תאריך)`: one line per item, PASS/FAIL, the CPU numbers, the emoji width, the SessionMode placement.
- [ ] **Step 3: Decide.** 1–3 PASS → continue with Phase 1 and 2. Item 1 FAIL but 4 PASS → Phase 2 switches to the pull channel (spec §6.6; Task 2.5 Step 7). 1 and 4 FAIL → stop; report to the user; Approach C (non-interactive Svg + `settled()`) is re-opened as a new brainstorm.
- [ ] **Step 4: Commit**

```bash
cd C:/Users/asafa/agent-theater && git add desktop-mod/HANDOFF.md && git commit -m "docs(mod): phase 0 probe results

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push origin feat/desktop-mod
```

---

# Phase 1 — Economical scan (spec §8). Independent of the Client; measured.

### Task 1.1: Slower poll, slower listing; tests use the constants

**Files:**
- Modify: `desktop-mod/hooks/model.ts:58` (`GLOB_TTL_SEC`), `:70` (`POLL_MS`)
- Modify: `desktop-mod/hooks/ui.test.ts`, `desktop-mod/hooks/band.test.ts` (literal `1500` → `POLL_MS`)
- Test: `desktop-mod/hooks/scanner.test.ts` (listing TTL)

- [ ] **Step 1: Write the failing test** (append to `scanner.test.ts`)

```ts
import { GLOB_TTL_SEC, POLL_MS } from './model'
test('phase 1 cadence: the poll is 5 s and listings are reused for 30 s', () => {
  expect(POLL_MS).toBe(5000)
  expect(GLOB_TTL_SEC).toBe(30)
})
```
- [ ] **Step 2: Run** `$E plugin test C:/Users/asafa/agent-theater/desktop-mod` → FAIL (1500 ≠ 5000).
- [ ] **Step 3: Change the constants** in `model.ts`: `export const GLOB_TTL_SEC = 30` and `export const POLL_MS = 5000`. Update the doc comments (`/** The scan period: 5 s (was the extension's 1.5 s); only while the pane is open. */`).
- [ ] **Step 4: Replace the literal poll period in the tests.** In `ui.test.ts` and `band.test.ts` every `clock.advance(1500)` and `+ 1500` that means "one poll" becomes `POLL_MS` (import it from `./model`). `SETTLE_MS` (5000) now equals one poll, so expressions like `SETTLE_MS + 1500` become `SETTLE_MS + POLL_MS`. Run the tests; where a test asserted "unchanged after 5 quiet polls" keep the loop count, only the step changes.
- [ ] **Step 5: Run** validate + test + tsc → all green.
- [ ] **Step 6: Commit**

```bash
git add desktop-mod/hooks/model.ts desktop-mod/hooks/*.test.ts && git commit -m "perf(mod): poll every 5 s, reuse directory listings 30 s

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push origin feat/desktop-mod
```

### Task 1.2: Parse only what was appended to a transcript

**Files:**
- Modify: `desktop-mod/hooks/scanner.ts:1228-1245` (`AgentCacheEntry`), `:1360-1470` (the agent loop), `:690-722` (`SESSION_MODEL_CACHE` / `sessionModelFor`)
- Modify: `desktop-mod/hooks/model.ts` (add `MAX_EVENTS`)
- Test: `desktop-mod/hooks/scanner.test.ts`

**Interfaces:**
- Produces: `AgentCacheEntry.textLen: number` and `.events: TranscriptEvent[]`; `export function appendParse(prev: { textLen: number; events: TranscriptEvent[]; versions: string[] }, whole: string): { textLen: number; events: TranscriptEvent[]; versions: string[]; skipped: number; reset: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
import { appendParse } from './scanner'
test('appendParse: a grown transcript parses only the new lines; a shrunk one re-parses', () => {
  const l1 = JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-10-10T10:00:00Z', message: { role: 'user', content: 'Read it.' }, agentId: 'a1', sessionId: 's1', version: '2.1.293' })
  const l2 = JSON.stringify({ type: 'assistant', uuid: 'a', timestamp: '2026-10-10T10:00:01Z', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Read', input: {} }] }, agentId: 'a1', sessionId: 's1' })
  const first = appendParse({ textLen: 0, events: [], versions: [] }, l1 + '\n')
  expect(first.events).toHaveLength(1)
  expect(first.textLen).toBe(l1.length + 1)
  const second = appendParse(first, l1 + '\n' + l2 + '\n')
  expect(second.events).toHaveLength(2)
  expect(second.reset).toBe(false)
  expect(second.events[1]?.raw.type).toBe('assistant')
  // a partial trailing line is held back until its newline arrives
  const partial = appendParse(second, l1 + '\n' + l2 + '\n' + '{"type":"user"')
  expect(partial.events).toHaveLength(2)
  expect(partial.textLen).toBe(second.textLen)
  // shrunk (rewritten) file: start over
  const shrunk = appendParse(second, l2 + '\n')
  expect(shrunk.reset).toBe(true)
  expect(shrunk.events).toHaveLength(1)
})
```
- [ ] **Step 2: Run** → FAIL (`appendParse` not exported).
- [ ] **Step 3: Implement** in `scanner.ts` (near `parseEvents`):

```ts
/** Keep at most this many parsed events per transcript (the tail is what status/phase/done read). */
export const MAX_EVENTS = 400   // put in model.ts and import it

/**
 * Incremental parse: transcripts are append-only, so a file that grew is
 * parsed from `prev.textLen` on, never from the start again. A trailing line
 * without its newline waits for the next scan. A file shorter than before was
 * rewritten: parse it whole (`reset`).
 */
export function appendParse(
  prev: { textLen: number; events: TranscriptEvent[]; versions: string[] },
  whole: string,
): { textLen: number; events: TranscriptEvent[]; versions: string[]; skipped: number; reset: boolean } {
  const reset = whole.length < prev.textLen
  const from = reset ? 0 : prev.textLen
  const cut = whole.lastIndexOf('\n')
  if (cut < from) return { textLen: prev.textLen, events: reset ? [] : prev.events, versions: prev.versions, skipped: 0, reset }
  const fresh = whole.slice(from, cut + 1)
  const parsed = parseEvents(fresh.split('\n').filter(ln => ln.trim() !== ''))
  const events = (reset ? parsed.events : [...prev.events, ...parsed.events]).slice(-MAX_EVENTS)
  const versions = [...new Set([...(reset ? [] : prev.versions), ...parsed.versions])]
  return { textLen: cut + 1, events, versions, skipped: parsed.skipped, reset }
}
```
- [ ] **Step 4: Wire it into the agent loop.** Add `textLen: number` and `events: TranscriptEvent[]` to `AgentCacheEntry` (and `textLen: 0, events: []` in `negativeEntry`). In the `else` branch of the loop (the file changed), when the file fits (`!oversized`) and a previous entry with `adict !== null` exists, replace

```ts
      const tail = whole ?? (await readTail(io, path, size))
      let events: TranscriptEvent[] = []
      let fileSkipped = 0
      if (tail.text !== null) {
        const parsed = parseEvents(tailLines(tail.text))
        events = parsed.events
        fileSkipped = parsed.skipped
        for (const v of parsed.versions) fileVersions.add(v)
      }
```
with

```ts
      let events: TranscriptEvent[] = []
      let fileSkipped = 0
      let textLen = 0
      if (whole && whole.text !== null) {
        const prev = entry && entry.adict !== null ? { textLen: entry.textLen, events: entry.events, versions: entry.versions } : { textLen: 0, events: [], versions: [] }
        const inc = appendParse(prev, whole.text)
        events = inc.events
        fileSkipped = inc.skipped
        textLen = inc.textLen
        for (const v of inc.versions) fileVersions.add(v)
      } else {
        const tail = await readTail(io, path, size)
        if (tail.text !== null) {
          const parsed = parseEvents(tailLines(tail.text))
          events = parsed.events
          fileSkipped = parsed.skipped
          for (const v of parsed.versions) fileVersions.add(v)
        } else if (tail.oversized) {
          oversizedFiles.add(path)
          AGENT_CACHE.set(path, negativeEntry(mtimeMs, size, now, { oversized: true, retry: true }))
          continue
        }
      }
```
and store `textLen` and `events` on the entry written at the end of the branch (`AGENT_CACHE.set(path, { …, textLen, events })`). `readWhole` stays (one `$.fs.read`, no process); the CPU saving is the parse.
- [ ] **Step 5: Same for the session model.** `noteSessionModel(sessionFile, mtimeMs, whole)` parses the whole file for the last `message.model`; give `SESSION_MODEL_CACHE` entries `textLen` and search only `whole.slice(textLen)` for a newer model (fall back to the cached one when the suffix has none).
- [ ] **Step 6: Run** validate + test (the fixture tests in `scanner.test.ts` must still pass unchanged) + tsc.
- [ ] **Step 7: Commit**

```bash
git add desktop-mod/hooks/scanner.ts desktop-mod/hooks/model.ts desktop-mod/hooks/scanner.test.ts && git commit -m "perf(mod): parse only the appended part of a transcript (append-only files)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push origin feat/desktop-mod
```

### Task 1.3: Remove the diagnostics writes

**Files:**
- Modify: `desktop-mod/hooks/register.tsx` (`flushDiag`, every `diagLine(...)` call, `diagFlushedAt`, the import of `diagLine, takeDiag`)
- Modify: `desktop-mod/hooks/ui.tsx` (`DIAG`, `diagLine`, `takeDiag`, the `diagLine(...)` calls in the render hook and handlers)
- Test: `desktop-mod/hooks/ui.test.ts`

- [ ] **Step 1: Write the failing test** (in the FLICKER GUARD test's `beneath` helper, count `fs.write` calls):

```ts
  let fsWrites = 0
  on('fs.write', ($, e, next) => { fsWrites += 1; return next(e) })
  // … after the five quiet polls:
  expect(fsWrites).toBe(0)   // no diagnostics file is written any more
```
(expose `fsWrites` through `captured`.)
- [ ] **Step 2: Run** → FAIL (the diag flush writes).
- [ ] **Step 3: Delete** `flushDiag`, `diagFlushedAt`, `DIAG`, `diagLine`, `takeDiag` and every call site; delete `C:\Users\asafa\.claude\agent-theater-diag.log`.
- [ ] **Step 4: Run** validate (the `fs.write` call disappears from the `calls:` list) + test + tsc.
- [ ] **Step 5: Commit** `chore(mod): remove the redraw diagnostics log`.

### Task 1.4: One publish per poll (stars in the payload, no deferred view write, retitle in the same tick)

**Files:**
- Modify: `desktop-mod/types/index.d.ts` (`TheaterPayload.stars`, drop `TheaterView.justFinished`)
- Modify: `desktop-mod/hooks/model.ts` (`EMPTY_PAYLOAD.stars = {}`, `DEFAULT_VIEW` without `justFinished`)
- Modify: `desktop-mod/hooks/register.tsx` (`poll`: compute stars, retitle before the write)
- Modify: `desktop-mod/hooks/ui.tsx` (`finishBeat`: no `$.clock.after` write of `justFinished`; read `office.stars`; `renderKey` takes `payload.stars`)
- Test: `desktop-mod/hooks/ui.test.ts`

**Interfaces:**
- Produces: `TheaterPayload.stars: Record<string, number>` (agent id → end_ms inside the ⭐ window); `export function starsOf(prevStatus: Record<string, TheaterStatus>, agents: readonly Agent[], prev: Record<string, number>, now: number): Record<string, number>` in `ui.tsx` (pure; moves `detectFinishes` + `pruneJustFinished` into one call).

- [ ] **Step 1: Write the failing test** (extend the FLICKER GUARD test): after one agent finishes and the next poll publishes, `captured.writes.payload` grew by exactly 1 and `captured.writes.view` by 0; `(await ui.find({ in: undefined, type: 'Svg' }))` is not asserted here (Phase 2 removes the Svg); assert the ⭐ via `payload.stars` through a `state.get` tap.
- [ ] **Step 2: Run** → FAIL (`view` is written by the deferred beat).
- [ ] **Step 3: Implement.** In `poll`, before the publish: `const stars = starsOf(prevStatus, merged.agents, (await read($, payloadAtom)).stars, now); merged.stars = stars` (`prevStatus` moves from `ui.tsx` to `register.tsx` as a module map, updated in `starsOf`). Toasts and the chime move from `finishBeat` to `poll` (they are side effects of the finish, not of drawing): for each id in `stars` not in the previous stars → `$.ui.toast(...)`, `ding`. `finishBeat` in `ui.tsx` becomes read-only: it returns `office.stars` and prunes nothing. The retitle: compute `run` from `merged` and call `$.ui.open({ id, title })` BEFORE `update($, payloadAtom, …)` in the same tick (the engine coalesces redraws inside one redraw period).
- [ ] **Step 4: Run** validate + test + tsc. Fix the tests that read `view.justFinished` (now `payload.stars`).
- [ ] **Step 5: Commit** `fix(mod): one publish per poll — stars ride the payload, no deferred view write`.

### Task 1.4b: Restore the finish beat's housekeeping in the publish branch

Added 2026-10-10 after Task 1.4's review (user decision, spec §2 item 9). Task 1.4 removed the deferred `$.clock.after` beat block, which also (a) reset `view.selected` to `null` when the selected agent left the office and (b) pruned `prefs.pins` and the `$.store` `roomDone` entries of rooms no longer present (both gated on a real, non-empty office). Restore both inside the publish branch of `poll` in `register.tsx`, in the same tick as the payload write, as rare extra writes only when something actually vanished — never on a quiet poll, never in the demo or on an empty/failed scan.

**Files:**
- Modify: `desktop-mod/hooks/register.tsx` (publish branch of `poll`)
- Modify: `desktop-mod/hooks/ui.test.ts`

- [ ] **Step 1: Failing tests first** (real scan path, like THE FLICKER GUARD extension): (1) select an agent (drawer open), make its transcript age out of the office → after the next structure publish `view.selected === null`, exactly one extra `view` write, the drawer closed; (2) pin a room and set a roomDone override for it, make the room vanish → `prefs.pins` no longer lists it and the store's roomDone no longer lists it, one `prefs` write and one store write; (3) quiet polls afterwards → 0 writes (the existing invariant stays green); (4) demo mode and an empty office never prune.
- [ ] **Step 2: Implement** in the publish branch: from the published office compute the live agent ids and room ids; `if (view.selected !== null && !liveIds.has(view.selected))` write `view` with `selected: null`; if the office is real and non-empty: prune `prefs.pins` (write `prefs` only if it changed) and the store's roomDone (write only if it changed). Same tick as the payload write; `$.clock.now()` only.
- [ ] **Step 3: Checks** — `$E plugin validate`, `$E plugin test` (0 fail), `tsc` (clean).
- [ ] **Step 4: Commit** `fix(mod): restore selection reset and pin/roomDone pruning in the publish branch` and push.

### Task 1.5: Measure

- [ ] **Step 1:** Temporarily re-enable the mod for ONE measurement session: add `"CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\asafa\\agent-theater\\desktop-mod"` under `env` in `~/.claude/settings.json` (keep the backup), open a new conversation, `/theater`, start a task with 5 subagents.
- [ ] **Step 2:** Task Manager → Details, 60 s: average CPU of `claude.exe` (the session) and of `Claude.exe` (the app), pane open; then pane closed. Also the baseline from before this phase is unknown (the mod was disabled): record the numbers as the new baseline.
- [ ] **Step 3:** Remove the env line again (the mod stays disabled until Task 2.8). Write the numbers in `HANDOFF.md` ("שלב 1 — מדידה"). Targets (spec §8.7): < 3% quiet, < 10% with five working agents. If above target: the remaining suspect is `tasklist` (30 s) and the per-scan `Promise.all` stats; raise `POLL_MS` to 8000 and re-measure before Phase 2.
- [ ] **Step 4: Commit** `docs(mod): phase 1 CPU measurement`.

---

### Task 1.2b (conditional): new-bytes-only tail read for transcripts above TAIL_SWITCH

User decision (spec §2 item 7, 2026-10-10): run ONLY if Task 1.5 still measures above the §8.7 targets after `POLL_MS` = 8000 was tried. Spec §8 item 2: `TAIL_SWITCH` = 256 KB; above it, read through `$.process.run` (PowerShell) only the bytes after the kept `textLen` (`Seek`), at most once per poll per changed file, and feed them to `appendParse` (Task 1.2) instead of re-reading a 200 KB tail. Write the steps when the task is activated — tests first: a 300 KB file that grows by one line is parsed from the new bytes only; a file that shrank restarts from zero; a tail that cuts a line in half is held back until the newline arrives.

---

# Phase 2 — The office on one Client (spec §5–7, §10–11). Only after Phase 0 items 1–3 PASS.

### Task 2.1: `office-layout.ts` — pure cells, tiles, rows, hits, window

**Files:**
- Create: `desktop-mod/hooks/office-layout.ts`
- Test: `desktop-mod/hooks/office-layout.test.ts`

**Interfaces:** the `office-layout.ts` block in "Shared interfaces". Consumes `OfficeProps`, `OfficeAgent`, `OfficeRoom` from `./office-props` (Task 2.2 defines them; create the type file first if executing in order — see Task 2.2 Step 0).

- [ ] **Step 0:** If `office-props.ts` does not exist yet, create it with ONLY the types and `OFFICE_KEY` from "Shared interfaces" (Task 2.2 adds the functions).
- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'claude-code/testing'
import { EMOJI_CELLS, TILE_H, TILE_W, blankRow, hitAt, layoutOffice, put, rowRuns, tileX, tilesPerRow, windowRows } from './office-layout'
import type { OfficeProps } from './office-props'

function props(over: Partial<OfficeProps> = {}): OfficeProps {
  const ag = (id: string, i: number) => ({ id, emoji: '🦉', name: `סוכן ${i}`, status: 'running' as const, fam: 'read' as const, act: '📖 קורא', model: 'Opus 5.5', modelFam: 'opus' as const, startMin: 3, isLead: i === 0, failed: false, longRunning: false, star: 0, enteredAt: 0 })
  return {
    v: 1, lang: 'he', rtl: true, columns: 45, rows: 30, offset: 0, nowMin: 0,
    counts: { run: 2, idle: 0, done: 0 }, prefs: { showDone: false, muted: false, still: false },
    search: '', selected: null, helpOpen: false, demo: false,
    rooms: [{ id: 'sess-a', title: 'תקרא את המסמך', small: 'acme', pinned: false, showDone: false, run: 2, stale: 0, done: 0, agents: [ag('lead', 0), ag('a1', 1)] }],
    drawer: null, footer: '', usage: null, empty: null, labels: {}, ...over,
  }
}

test('cells: put clips to the row and an emoji takes EMOJI_CELLS', () => {
  const row = blankRow('r', 6)
  put(row, 4, 'abc')
  expect(row.cells.map(c => c.ch).join('')).toBe('    ab')
  const r2 = blankRow('r2', 6)
  put(r2, 0, '🦉x', { fg: '#fff' })
  expect(r2.cells[0]?.ch).toBe('🦉')
  expect(r2.cells[EMOJI_CELLS]?.ch).toBe('x')
  expect(r2.cells[1]?.ch).toBe('')            // the emoji's second cell is empty, not a space
})

test('tiles per row and x positions, LTR and RTL', () => {
  expect(tilesPerRow(45)).toBe(3)
  expect(tilesPerRow(14)).toBe(1)
  expect(tileX(0, 3, 45, false)).toBe(0)
  expect(tileX(1, 3, 45, false)).toBe(TILE_W + 1)
  expect(tileX(0, 3, 45, true)).toBe(45 - TILE_W)
})

test('layoutOffice: a room head row, then tile rows; hits cover every tile cell and the pin', () => {
  const lay = layoutOffice(props())
  expect(lay.rows[0]?.id).toBe('room:sess-a:head')
  expect(lay.rows).toHaveLength(1 + TILE_H)
  const lead = lay.hits.find(h => h.kind === 'agent' && h.id === 'lead')
  expect(lead).toBeDefined()
  expect(hitAt(lay, (lead?.x ?? 0) + 2, (lead?.y ?? 0) + 2)?.id).toBe('lead')
  expect(hitAt(lay, 0, 0)?.kind).toBe('pin')
  expect(hitAt(lay, 200, 200)).toBeUndefined()
})

test('rowRuns merges neighbours with the same style; windowRows slices by offset', () => {
  const row = blankRow('r', 8)
  put(row, 0, 'aa', { fg: '#f00' })
  put(row, 2, 'bb', { fg: '#f00' })
  put(row, 4, 'cc')
  const runs = rowRuns(row.cells)
  expect(runs.map(r => r.text)).toEqual(['aabb', 'cc  '])
  expect(runs[0]?.fg).toBe('#f00')
  const lay = layoutOffice(props())
  expect(windowRows(lay, 2, 3).map(r => r.id)).toEqual(lay.rows.slice(2, 5).map(r => r.id))
})

test('bounds: 100 agents in 10 rooms at 45 and 200 columns stay small', () => {
  const rooms = Array.from({ length: 10 }, (_, r) => ({
    id: `s${r}`, title: `חדר ${r}`, small: '', pinned: false, showDone: true, run: 10, stale: 0, done: 0,
    agents: Array.from({ length: 10 }, (_, i) => ({ id: `a${r}-${i}`, emoji: '🦉', name: `סוכן ${i}`, status: 'running' as const, fam: 'read' as const, act: '📖 קורא', model: 'Opus 5.5', modelFam: 'opus' as const, startMin: 1, isLead: false, failed: false, longRunning: false, star: 0, enteredAt: 0 })),
  }))
  for (const columns of [45, 200]) {
    const lay = layoutOffice(props({ columns, rooms }))
    const runs = lay.rows.reduce((n, r) => n + rowRuns(r.cells).length, 0)
    expect(runs).toBeLessThan(6000)               // well under 20,000 nodes even unwindowed
    expect(JSON.stringify(lay.rows.map(r => rowRuns(r.cells))).length).toBeLessThan(300_000)
  }
})
```
- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement `office-layout.ts`**

```ts
// Pure layout of the office in text cells. No engine, no `$`: both the hooks
// (content height) and the surface module (drawing, hit-testing) call it.
import type { OfficeAgent, OfficeProps, OfficeRoom } from './office-props'

export const TILE_W = 14
export const TILE_H = 6
export const TILE_GAP = 1
export const EMOJI_CELLS = 2

export type Cell = { ch: string; fg?: string; bg?: string; bold?: true; dim?: true }
export type CellRow = { id: string; cells: Cell[] }
export type Run = { text: string; fg?: string; bg?: string; bold?: true; dim?: true }
export type Hit = { kind: 'agent' | 'pin' | 'roomDone'; id: string; x: number; y: number; w: number; h: number }
export type OfficeLayout = { rows: CellRow[]; hits: Hit[] }

export const MODEL_BG: Record<OfficeAgent['modelFam'], string> = { opus: '#7b5cf0', sonnet: '#2f7fe8', haiku: '#1fa876', fable: '#d9872b', other: '#3a4470' }
export const STATUS_FG: Record<OfficeAgent['status'], string> = { running: '#7ee29a', stale: '#e6c07e', done: '#9fb0e6' }
const DESK = '#8b5a2b'
const SCREEN: Record<OfficeAgent['status'], string> = { running: '#39d353', stale: '#6b7280', done: '#1f2937' }
const EMOJI_RE = /\p{Extended_Pictographic}/u

export function blankRow(id: string, columns: number): CellRow {
  return { id, cells: Array.from({ length: Math.max(0, columns) }, () => ({ ch: ' ' })) }
}

/** Writes `text` from cell `x`, clipping at the row's end; an emoji fills EMOJI_CELLS (its second cell stays ''). */
export function put(row: CellRow, x: number, text: string, style: Omit<Cell, 'ch'> = {}): void {
  let i = x
  for (const ch of text) {
    if (i >= row.cells.length) break
    if (i >= 0) row.cells[i] = { ch, ...style }
    const wide = EMOJI_RE.test(ch) ? EMOJI_CELLS : 1
    for (let k = 1; k < wide && i + k < row.cells.length; k++) if (i + k >= 0) row.cells[i + k] = { ch: '', ...style }
    i += wide
  }
}

export function tilesPerRow(columns: number): number {
  return Math.max(1, Math.floor((columns + TILE_GAP) / (TILE_W + TILE_GAP)))
}

export function tileX(i: number, perRow: number, columns: number, rtl: boolean): number {
  const col = i % perRow
  return rtl ? columns - TILE_W - col * (TILE_W + TILE_GAP) : col * (TILE_W + TILE_GAP)
}

function cut(s: string, max: number): string {
  let w = 0
  let out = ''
  for (const ch of s) {
    const cw = EMOJI_RE.test(ch) ? EMOJI_CELLS : 1
    if (w + cw > max) return out.length < s.length ? out.slice(0, Math.max(0, out.length - 1)) + '…' : out
    out += ch
    w += cw
  }
  return out
}

function centred(x: number, w: number, text: string): number {
  let tw = 0
  for (const ch of text) tw += EMOJI_RE.test(ch) ? EMOJI_CELLS : 1
  return x + Math.max(0, Math.floor((w - tw) / 2))
}

/** One agent tile into rows[y..y+TILE_H) at x. */
function tile(rows: CellRow[], y: number, x: number, a: OfficeAgent, index: number, selected: boolean): void {
  const fg = STATUS_FG[a.status]
  const frame = selected ? { fg: '#ffffff', bold: true as const } : {}
  put(rows[y]!, centred(x, TILE_W, a.emoji), a.emoji, frame)
  if (a.isLead) put(rows[y]!, x, '💬')
  put(rows[y]!, x + TILE_W - 2, String(index), { dim: true })
  const desk = rows[y + 1]!
  put(desk, x + 2, '▀'.repeat(TILE_W - 4), { fg: DESK, bg: '#3a2a1a' })
  put(desk, x + 6, '▀▀', { fg: SCREEN[a.status], bg: '#111827' })
  put(rows[y + 2]!, centred(x, TILE_W, cut(a.name, TILE_W)), cut(a.name, TILE_W), { fg, bold: true })
  const pill = ` ${cut(a.model, TILE_W - 2)} `
  put(rows[y + 3]!, centred(x, TILE_W, pill), pill, { fg: a.modelFam === 'other' ? '#e8ecff' : '#ffffff', bg: MODEL_BG[a.modelFam] })
  put(rows[y + 4]!, centred(x, TILE_W, cut(a.act, TILE_W)), cut(a.act, TILE_W), { fg, dim: a.status === 'done' ? true : undefined })
  const badges = `${a.failed ? '❌' : ''}${a.star ? '⭐' : ''}${a.longRunning ? '⏰' : ''}`
  const mins = a.startMin === null ? '' : a.startMin < 1 ? '<1' : String(a.startMin)
  const line = `${mins}${badges}`
  put(rows[y + 5]!, centred(x, TILE_W, line), line, { dim: true })
}

export function layoutOffice(props: OfficeProps): OfficeLayout {
  const rows: CellRow[] = []
  const hits: Hit[] = []
  const perRow = tilesPerRow(props.columns)
  for (const room of props.rooms) {
    const head = blankRow(`room:${room.id}:head`, props.columns)
    const counts = `🟢${room.run}${room.stale ? ` ⏳${room.stale}` : ''}${room.done ? ` ✅${room.done}` : ''}`
    const pin = room.pinned ? '📌' : '○'
    const title = cut(`💬 ${room.title}`, props.columns - EMOJI_CELLS - 1 - counts.length - 1)
    if (props.rtl) {
      put(head, props.columns - EMOJI_CELLS, pin)
      put(head, props.columns - EMOJI_CELLS - 1 - titleWidth(title), title, { bold: true })
      put(head, 0, counts)
      hits.push({ kind: 'pin', id: room.id, x: props.columns - EMOJI_CELLS, y: rows.length, w: EMOJI_CELLS, h: 1 })
      if (room.done) hits.push({ kind: 'roomDone', id: room.id, x: 0, y: rows.length, w: counts.length, h: 1 })
    } else {
      put(head, 0, pin)
      put(head, EMOJI_CELLS + 1, title, { bold: true })
      put(head, props.columns - counts.length, counts)
      hits.push({ kind: 'pin', id: room.id, x: 0, y: rows.length, w: EMOJI_CELLS, h: 1 })
      if (room.done) hits.push({ kind: 'roomDone', id: room.id, x: props.columns - counts.length, y: rows.length, w: counts.length, h: 1 })
    }
    rows.push(head)
    const shown = room.agents.filter(a => a.status !== 'done' || room.showDone)
    for (let i = 0; i < shown.length; i += perRow) {
      const y = rows.length
      for (let k = 0; k < TILE_H; k++) rows.push(blankRow(`room:${room.id}:row:${i / perRow}:${k}`, props.columns))
      shown.slice(i, i + perRow).forEach((a, j) => {
        const x = tileX(i + j, perRow, props.columns, props.rtl)
        tile(rows, y, x, a, i + j + 1, props.selected === a.id)
        hits.push({ kind: 'agent', id: a.id, x, y, w: TILE_W, h: TILE_H })
      })
    }
    rows.push(blankRow(`room:${room.id}:gap`, props.columns))
  }
  return { rows, hits }
}

function titleWidth(s: string): number {
  let w = 0
  for (const ch of s) w += EMOJI_RE.test(ch) ? EMOJI_CELLS : 1
  return w
}

export function rowRuns(cells: readonly Cell[]): Run[] {
  const runs: Run[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.fg === c.fg && last.bg === c.bg && last.bold === c.bold && last.dim === c.dim) last.text += c.ch
    else runs.push({ text: c.ch, ...(c.fg ? { fg: c.fg } : {}), ...(c.bg ? { bg: c.bg } : {}), ...(c.bold ? { bold: true } : {}), ...(c.dim ? { dim: true } : {}) })
  }
  return runs
}

export function hitAt(layout: OfficeLayout, x: number, y: number): Hit | undefined {
  return layout.hits.find(h => x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h)
}

export function windowRows(layout: OfficeLayout, offset: number, count: number): CellRow[] {
  const from = Math.max(0, Math.min(offset, Math.max(0, layout.rows.length - count)))
  return layout.rows.slice(from, from + Math.max(0, count))
}
```
(`rowRuns` with the expected text `'aabb', 'cc  '`: the two trailing blanks merge with `cc` because both have no style.)
- [ ] **Step 4: Run** → PASS; validate + tsc.
- [ ] **Step 5: Commit** `feat(mod): office-layout — pure cell layout, runs, hit-testing, windowing`.

### Task 2.2: `office-props.ts` — the slim props builder

**Files:**
- Create/complete: `desktop-mod/hooks/office-props.ts`
- Test: `desktop-mod/hooks/office-props.test.ts`

**Interfaces:**
- Produces: `export type OfficePropsInput = { payload: Payload; prefs: Prefs; view: View; roomDone: Readonly<Record<string, boolean>>; offset: number; columns: number; rows: number; now: number; usage: { pct: number; resetsAt: string } | null; firstSeen: Readonly<Record<string, number>> }`; `export function buildOfficeProps(input: OfficePropsInput): OfficeProps`; `export function assertJson(v: unknown, path?: string): void` (throws `Error('undefined at <path>')`); `export function modelFamily(model: string): OfficeAgent['modelFam']`.
- Consumes from `ui.tsx` (already exported): `officeView`, `roomStats`, `headerCounts`, `cardName`, `agentElapsed`, `isLongRunning`, `minuteClock`, `roomShowsDone`, `emptyKind`, `effectivePayload`; from `i18n.ts`: `I18N`, `activityLabel`, `modelLabel`, `dirOf`; from `office-svg.ts`: `toolFamily`; from `model.ts`: `JUST_FINISHED_MS`, `UNKNOWN_MODEL_PILL` (from office-svg).

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'claude-code/testing'
import { EMPTY_PAYLOAD, DEFAULT_PREFS, DEFAULT_VIEW, PERSONA_EMOJI } from './model'
import type { Agent } from './model'
import { assertJson, buildOfficeProps, modelFamily } from './office-props'

const T0 = 1_700_000_000_000
function agent(over: Partial<Agent> & { id: string }): Agent {
  return { persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: '', subagent_type: '', status: 'running', tool: 'Read', phase: 'tool', task: 'x'.repeat(5000), task_short: 'x', result: 'y'.repeat(4000), start_ms: T0 - 120_000, end_ms: null, session: 'sess-a', session_full: 'sess-aaaa', cwd: '/w', project: '/w', mtime_ms: T0 - 1000, is_session: false, closed: false, is_workflow: false, truncated: false, model: 'claude-opus-5-5', ...over }
}
function input(agents: Agent[], over = {}) {
  return { payload: { ...EMPTY_PAYLOAD, agents, stars: {} }, prefs: DEFAULT_PREFS, view: DEFAULT_VIEW, roomDone: {}, offset: 0, columns: 45, rows: 30, now: T0, usage: null, firstSeen: {}, ...over }
}

test('modelFamily', () => {
  expect(modelFamily('claude-opus-5-5')).toBe('opus')
  expect(modelFamily('claude-sonnet-5-5')).toBe('sonnet')
  expect(modelFamily('claude-haiku-5-5')).toBe('haiku')
  expect(modelFamily('claude-fable-5-1')).toBe('fable')
  expect(modelFamily('')).toBe('other')
})

test('buildOfficeProps: slim, JSON-clean, task/result only in the drawer', () => {
  const p = buildOfficeProps(input([agent({ id: 'a1' }), agent({ id: 'a2', status: 'done', end_ms: T0 - 1000 })]))
  assertJson(p)
  expect(p.v).toBe(1)
  expect(p.rooms).toHaveLength(1)
  expect(p.rooms[0]?.agents.map(a => a.id)).toEqual(['a1', 'a2'])
  expect(JSON.stringify(p)).not.toContain('xxxxxxxxxx')
  expect(p.rooms[0]?.agents[0]?.startMin).toBe(2)
  expect(p.rooms[0]?.agents[0]?.modelFam).toBe('opus')
  expect(p.drawer).toBeNull()
  const withDrawer = buildOfficeProps(input([agent({ id: 'a1' })], { view: { ...DEFAULT_VIEW, selected: 'a1' } }))
  expect(withDrawer.drawer?.task.length).toBe(4000)
  expect(withDrawer.drawer?.result.length).toBe(4000)
})

test('buildOfficeProps: 100 agents stay under the Client props bound', () => {
  const many = Array.from({ length: 100 }, (_, i) => agent({ id: `a${i}`, session_full: `s${i % 10}`, session: `s${i % 10}` }))
  const p = buildOfficeProps(input(many))
  expect(JSON.stringify(p).length).toBeLessThan(60_000)
})

test('assertJson throws on undefined anywhere', () => {
  expect(() => assertJson({ a: [{ b: undefined }] })).toThrow(/a\.0\.b/)
  expect(() => assertJson({ a: null, b: [1, 'x', true] })).not.toThrow()
})
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (`office-props.ts`; the type block from "Shared interfaces" plus):

```ts
import { I18N, activityLabel, dirOf, modelLabel } from './i18n'
import { JUST_FINISHED_MS } from './model'
import type { Agent, Payload, Prefs, View } from './model'
import { UNKNOWN_MODEL_PILL, toolFamily } from './office-svg'
import { agentElapsed, cardName, effectivePayload, emptyKind, headerCounts, isLongRunning, minuteClock, officeView, roomShowsDone, roomStats } from './ui'

export function modelFamily(model: string): OfficeAgent['modelFam'] {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('fable')) return 'fable'
  return 'other'
}

export function assertJson(v: unknown, path = ''): void {
  if (v === undefined) throw new Error(`undefined at ${path || '<root>'}`)
  if (Array.isArray(v)) v.forEach((x, i) => assertJson(x, `${path}${path ? '.' : ''}${i}`))
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertJson(x, `${path}${path ? '.' : ''}${k}`)
}

const LABEL_KEYS = ['appTitle', 'showDone', 'switchTo', 'demoLabel', 'exitDemo', 'close', 'helpTitle', 'keysHint', 'scFinished', 'scMove', 'scOpen', 'scClose', 'scMute', 'scLang', 'scDemo', 'scHelp', 'searchPlaceholder', 'working', 'idleN', 'finished', 'dWorking', 'dDone', 'dStale', 'dFailed', 'dDuration', 'dElapsed', 'dAction', 'dTask', 'dResult', 'dModel', 'taskUnavailable', 'resultTruncated', 'watchDemo'] as const

export function buildOfficeProps(input: OfficePropsInput): OfficeProps {
  const { prefs, view, roomDone, now } = input
  const lang = prefs.lang
  const L = I18N[lang]
  const office = effectivePayload(input.payload, view, now)
  const showDone = view.demo || prefs.showDone
  const { rooms, stat, order } = officeView(office.agents, view.search, lang, showDone, roomDone, prefs.pins)
  const nowMin = minuteClock(now)
  const stars = office.stars ?? {}
  const toAgent = (a: Agent): OfficeAgent => {
    const el = agentElapsed(a, nowMin)
    const starAt = stars[a.id]
    return {
      id: a.id, emoji: a.emoji, name: cardName(a, lang), status: a.status, fam: toolFamily(a.tool),
      act: activityLabel(a, lang), model: modelLabel(a.model) || UNKNOWN_MODEL_PILL, modelFam: modelFamily(a.model),
      startMin: el === null ? null : Math.max(0, Math.floor(el / 60_000)),
      isLead: a.is_session, failed: a.failed === true, longRunning: isLongRunning(a, now),
      star: a.status === 'done' && starAt !== undefined && now - starAt < JUST_FINISHED_MS ? starAt : 0,
      enteredAt: input.firstSeen[a.id] ?? 0,
    }
  }
  const outRooms: OfficeRoom[] = rooms.map(s => {
    const st = stat.get(s)
    return {
      id: s, title: st?.topic || st?.label || s.slice(0, 8), small: st?.topic ? st.label : (st?.sid ?? s.slice(0, 8)),
      pinned: prefs.pins.includes(s), showDone: roomShowsDone(roomDone, showDone, s),
      run: st?.running ?? 0, stale: st?.stale ?? 0, done: st?.done ?? 0,
      agents: order.filter(a => a.session_full === s).map(toAgent),
    }
  })
  const sel = view.selected !== null ? office.agents.find(a => a.id === view.selected) : undefined
  const drawer: OfficeDrawer | null = sel ? {
    id: sel.id, name: `${sel.emoji} ${cardName(sel, lang)}`,
    chips: [sel.failed ? `❌ ${L.dFailed}` : sel.status === 'running' ? L.dWorking : sel.status === 'done' ? L.dDone : L.dStale, sel.subagent_type].filter(Boolean),
    model: modelLabel(sel.model) || UNKNOWN_MODEL_PILL, act: activityLabel(sel, lang),
    task: sel.task || L.taskUnavailable, result: sel.result ?? '', truncated: sel.truncated,
  } : null
  const kind = order.length === 0 ? emptyKind(view.search, office.agents.length, showDone) : null
  const labels: Record<string, string> = {}
  for (const k of LABEL_KEYS) labels[k] = L[k]
  const props: OfficeProps = {
    v: 1, lang, rtl: dirOf(lang) === 'rtl', columns: input.columns, rows: input.rows, offset: input.offset, nowMin,
    counts: headerCounts(office.agents),
    prefs: { showDone: prefs.showDone, muted: prefs.muted, still: prefs.still === true },
    search: view.search, selected: view.selected, helpOpen: view.helpOpen, demo: view.demo,
    rooms: outRooms, drawer, footer: input.footer ?? '', usage: input.usage,
    empty: kind === null ? null : { kind, msg: kind === 'noactive' ? L.emptyNoActive : kind === 'nonewindow' ? L.emptyNoneInWindow : kind === 'nomatch' ? L.emptyNoMatch : L.emptyOffice, sub: kind === 'office' ? L.emptySub : '' },
    labels,
  }
  assertJson(props)
  return props
}
```
(`OfficePropsInput` gets `footer?: string`; `toolFamily`/`UNKNOWN_MODEL_PILL` are exported by `office-svg.ts` already; `effectivePayload` and the others by `ui.tsx`. `headerCounts` returns `{run, idle, done}`.) Importing `./ui` from `office-props.ts` is a hooks-side import only; the surface module imports only `./office-layout` and the types.
- [ ] **Step 4: Run** → PASS; validate + tsc (watch for an import cycle `ui.tsx ↔ office-props.ts`: `ui.tsx` will import `buildOfficeProps` in Task 2.4; cycles between ES modules are allowed here because every use is inside functions, but if `tsc`/validate complains, move the pure helpers `officeView, roomStats, headerCounts, cardName, agentElapsed, isLongRunning, minuteClock, roomShowsDone, emptyKind, effectivePayload` into a new `office-view.ts` and re-export them from `ui.tsx`).
- [ ] **Step 5: Commit** `feat(mod): office-props — slim JSON props for the desktop Client`.

### Task 2.3: `office-client.tsx` — the surface module

> Note (2026-10-10, after Task 1.4): `finishBeat` no longer exists — the render reads `office.stars` (`ui.tsx`), and `OfficeAgent.star` is the detection stamp (the poll's clock when the finish was seen), not a transcript `end_ms`. Also from Phase 0: `wrap: 'truncate'` is not enforced on the desktop, so `office-layout` must fit rows to `columns` itself; a narrow docked pane measured 31 columns.

**Files:**
- Create: `desktop-mod/hooks/office-client.tsx`
- Test: `desktop-mod/hooks/office-client.test.ts` (mounts the pane on the desktop through the hooks, Task 2.4 wires that; until then the test mounts a minimal pane via a test-only hook — see Step 1)

**Interfaces:**
- Consumes: `OfficeProps`, `OfficeMessage`, `OFFICE_KEY` (office-props), `layoutOffice`, `rowRuns`, `hitAt`, `windowRows`, `TILE_H` (office-layout).
- Produces: default export `Office: ClientModule<OfficeProps, OfficeState>`; `export const CHROME_ROWS = 3` (header, toolbar, search); `export const FX_TICK_MS = 250`, `FX_ENTER_MS = 700`, `FX_DONE_MS = 1000`.

- [ ] **Step 1: Write the failing test.** The kit mounts a drawing through the plugin's hooks; to test the module before Task 2.4, register (in the test file itself) a plugin-side `ui.render` hook is not possible — so this test depends on Task 2.4's desktop branch. Write it now, run it after Task 2.4 Step 3 (keep both tasks in one review cycle if executing with subagents).

```ts
import { expect, mock, test } from 'claude-code/testing'
import { EMPTY_PAYLOAD, PERSONA_EMOJI, POLL_MS } from './model'
import type { Agent } from './model'
import { CHROME_ROWS, FX_ENTER_MS } from './office-client'
import { TILE_H } from './office-layout'

const T0 = 1_700_000_000_000
const PANE = { plugin: 'agent-theater', component: 'Pane', requestId: 'agent-theater', props: { title: 'T', isFocused: true, bodyColumns: 45, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const
function agent(over: Partial<Agent> & { id: string }): Agent {
  return { persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: 'map the docs', subagent_type: 'Explore', status: 'running', tool: 'Read', phase: 'tool', task: 't', task_short: 't', result: null, start_ms: T0 - 30_000, end_ms: null, session: 'sess-a', session_full: 'sess-aaaa', cwd: '/w', project: '/w', mtime_ms: T0 - 1000, is_session: false, closed: false, is_workflow: false, truncated: false, model: 'claude-opus-5-5', ...over }
}

/** The hooks beneath: an empty ~/.claude, the pane shown, the payload rewritten to `current()` on every publish. */
function beneath(on: Parameters<typeof mock.store>[0], current: () => Agent[]) {
  const clock = mock.clock(on, { now: T0 })
  const store: Record<string, unknown> = { prefs: { lang: 'he', muted: true, showDone: false, pins: [] } }
  on('store.get', ($, e) => ({ value: store[e.key] }))
  on('store.set', ($, e) => { store[e.key] = e.value; return { value: undefined } })
  on('store.delete', ($, e) => { delete store[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  mock.env(on, { HOME: 'C:/Users/test', USERPROFILE: 'C:/Users/test' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'test-session' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('agent.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [{ id: 'agent-theater', title: 'T', isShown: true, isFocused: false, isPlaced: true }] }))
  on('state.set', { plugin: 'agent-theater', key: 'payload' }, ($, e, next) => next({ ...e, value: { ...EMPTY_PAYLOAD, stars: {}, agents: current(), scanned_ms: clock.now() } }))
  return { clock, store }
}

test('DESKTOP: the pane is one Client; it draws the room head, the tiles and the chrome; a click on a tile opens the drawer', async ($, on) => {
  let agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', persona_id: 7 })]
  const { clock, store } = beneath(on, () => agents)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount(PANE)
  const client = await ui.find({ type: 'Client' })
  expect(client?.key).toBe('office')
  expect(client?.props.module).toBe('./office-client.tsx')
  expect(await ui.find({ type: 'Box' })).toBeUndefined()          // nothing but the Client in the plugin's own tree
  await ui.resize({ in: 'office', columns: 45, rows: 30 })
  expect(await ui.find({ in: 'office', type: 'Text', text: /🟢 2/ })).toBeDefined()
  expect(await ui.find({ in: 'office', type: 'Button', key: 'showDone' })).toBeDefined()
  expect(await ui.find({ in: 'office', type: 'Input', key: 'search' })).toBeDefined()
  expect(await ui.find({ in: 'office', type: 'Text', text: /💬/ })).toBeDefined()
  expect(await ui.find({ in: 'office', type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  // the lead is the first tile: RTL → at the right edge; its tile starts one row under the room head
  const x = 45 - 14 + 2
  const y = CHROME_ROWS + 1 + 2
  await ui.pointer({ in: 'office', type: 'down', x, y, button: 'left' })
  expect(await ui.find({ in: 'office', type: 'Text', text: /המשימה|Task/ })).toBeDefined()   // the drawer opened (labels.dTask)
  await ui.press({ key: 'close' })
  expect(await ui.find({ in: 'office', type: 'Text', text: /המשימה|Task/ })).toBeUndefined()
  // toolbar: ☑ toggles showDone through ui.message → prefs → store
  await ui.press({ key: 'showDone' })
  expect((store.prefs as { showDone: boolean }).showDone).toBe(true)
  // a newcomer walks in: the fx clock runs FX_ENTER_MS then stops (no setState loop)
  agents = [...agents, agent({ id: 'n1', persona_id: 5 })]
  await clock.advance(POLL_MS * 4)   // SETTLE
  expect(await ui.find({ in: 'office', type: 'Text', text: /n1|סוכן/ })).toBeDefined()
  await ui.advance(FX_ENTER_MS + 250)
  await ui.unmount()
})

test('DESKTOP: scrolling is the plugin\'s own — the engine window never moves and the Client windows its rows', async ($, on) => {
  const many = Array.from({ length: 30 }, (_, i) => agent({ id: `a${i}`, session_full: `s${i % 3}`, session: `s${i % 3}` }))
  const { clock } = beneath(on, () => many)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount(PANE)
  await ui.resize({ in: 'office', columns: 45, rows: 20 })
  let nextCalled = 0
  on('ui.scroll', () => { nextCalled += 1; return {} })
  const r = await $.ui.scroll({ component: 'Pane', requestId: 'agent-theater', offset: 3, by: 3, bodyRows: 20, contentRows: 80, origin: { kind: 'person' } })
  expect(r.deny).toBeUndefined()
  expect(nextCalled).toBe(0)
  await clock.advance(200)   // the 100 ms latch
  const client = await ui.find({ type: 'Client' })
  expect((client?.props.props as { offset: number }).offset).toBe(3)
  await ui.unmount()
})
```
- [ ] **Step 2: Implement `office-client.tsx`**

```tsx
// The desktop office: ONE surface module draws the whole pane (chrome + rooms),
// windows its own rows, hit-tests the pointer and posts actions to the hooks.
// No `$` here. State survives the plugin's redraws (the engine keeps the instance).
import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'

import { hitAt, layoutOffice, rowRuns, windowRows, type Hit, type OfficeLayout } from './office-layout'
import type { OfficeMessage, OfficeProps } from './office-props'

export const CHROME_ROWS = 3
export const FX_TICK_MS = 250
export const FX_ENTER_MS = 700
export const FX_DONE_MS = 1000

type Fx = { id: string; kind: 'enter' | 'done'; left: number }
type OfficeState = {
  hover: string | null
  fx: Fx[]
  stop: (() => void) | null
  seenEnter: Record<string, number>
  seenStar: Record<string, number>
  lastContent: number
  layoutKey: string
  layout: OfficeLayout | null
}

function send(surface: ClientSurface<OfficeState>, m: OfficeMessage): void {
  surface.post(m)
}

/** Layout memo: the props that change the layout, as one string. */
function layoutKeyOf(p: OfficeProps): string {
  return JSON.stringify([p.columns, p.rtl, p.selected, p.rooms])
}

function startFx(surface: ClientSurface<OfficeState>, s: OfficeState): OfficeState {
  if (s.stop || s.fx.length === 0) return s
  const stop = surface.every(FX_TICK_MS, () => {
    const cur = surface.state
    if (!cur) return
    const fx = cur.fx.map(f => ({ ...f, left: f.left - FX_TICK_MS })).filter(f => f.left > 0)
    if (fx.length === 0 && cur.stop) {
      cur.stop()
      surface.setState({ ...cur, fx, stop: null })
    } else surface.setState({ ...cur, fx })
  })
  return { ...s, stop }
}

const Office: ClientModule<OfficeProps, OfficeState> = (props, surface) => {
  const { Box, Text, Button, Input } = surface.elements
  try {
    let s: OfficeState = surface.state ?? { hover: null, fx: [], stop: null, seenEnter: {}, seenStar: {}, lastContent: -1, layoutKey: '', layout: null }
    if (surface.state === undefined) {
      surface.onPointer(ev => {
        const cur = surface.state
        if (!cur || !cur.layout) return
        const drawerRows = props.drawer ? 8 : props.helpOpen ? 10 : 0
        const y = ev.y - CHROME_ROWS - drawerRows + props.offset
        const hit = hitAt(cur.layout, ev.x, y)
        if (ev.type === 'down' && ev.button === 'left' && hit) {
          if (hit.kind === 'agent') send(surface, { t: 'open', id: hit.id })
          else if (hit.kind === 'pin') send(surface, { t: 'pin', room: hit.id })
          else send(surface, { t: 'roomDone', room: hit.id })
        } else if (ev.type === 'move' || ev.type === 'leave') {
          const id = ev.type === 'leave' ? null : hit?.kind === 'agent' ? hit.id : null
          if (id !== cur.hover) surface.setState({ ...cur, hover: id })
        }
      })
      surface.onKey(ev => {
        const k = ev.key
        if (k === 'x' || k === 'escape') send(surface, { t: 'close' })
        else if (k === 'f') send(surface, { t: 'showDone' })
        else if (k === 'm') send(surface, { t: 'mute' })
        else if (k === 'l') send(surface, { t: 'lang' })
        else if (k === 'h') send(surface, { t: 'help' })
        else if (k === 'd') send(surface, { t: 'demo' })
        else if (k === 's') send(surface, { t: 'still' })
      })
      surface.setState(s)
    }
    // event fx from the props' stamps (a redraw with the same stamps starts nothing)
    if (!props.prefs.still) {
      const fx = [...s.fx]
      const seenEnter = { ...s.seenEnter }
      const seenStar = { ...s.seenStar }
      let changed = false
      for (const room of props.rooms) for (const a of room.agents) {
        if (a.enteredAt && seenEnter[a.id] !== a.enteredAt) { seenEnter[a.id] = a.enteredAt; if (Object.keys(s.seenEnter).length > 0) { fx.push({ id: a.id, kind: 'enter', left: FX_ENTER_MS }); changed = true } }
        if (a.star && seenStar[a.id] !== a.star) { seenStar[a.id] = a.star; fx.push({ id: a.id, kind: 'done', left: FX_DONE_MS }); changed = true }
      }
      if (changed || Object.keys(seenEnter).length !== Object.keys(s.seenEnter).length) {
        s = startFx(surface, { ...s, fx, seenEnter, seenStar })
        surface.setState(s)
      }
    }
    // layout, memoised by the props that shape it
    const key = layoutKeyOf(props)
    if (s.layoutKey !== key || !s.layout) {
      s = { ...s, layoutKey: key, layout: layoutOffice(props) }
      surface.setState(s)
      if (s.layout.rows.length !== s.lastContent) {
        send(surface, { t: 'content', rows: s.layout.rows.length })
        s.lastContent = s.layout.rows.length
      }
    }
    const layout = s.layout!
    const L = props.labels
    const row = props.rtl ? 'row-reverse' : 'row'
    const usage = props.usage ? ` · ⏳ ${Math.round(props.usage.pct)}%` : ''
    const header = Text({ bold: true, wrap: 'truncate', children: [`🎭 🟢 ${props.counts.run} ${L.working ?? ''}${props.counts.idle ? ` · ⏳ ${props.counts.idle}` : ''} · ✅ ${props.counts.done}${usage}`] })
    const toolbar = Box({ flexDirection: row, columnGap: 1, children: [
      Button({ key: 'showDone', hotkey: 'f', plain: true, label: props.prefs.showDone ? '☑' : '☐', onPress: () => send(surface, { t: 'showDone' }) }),
      Button({ key: 'mute', hotkey: 'm', plain: true, label: props.prefs.muted ? '🔕' : '🔔', onPress: () => send(surface, { t: 'mute' }) }),
      Button({ key: 'lang', hotkey: 'l', plain: true, label: props.lang === 'he' ? 'EN' : 'עב', onPress: () => send(surface, { t: 'lang' }) }),
      Button({ key: 'help', hotkey: 'h', plain: true, label: '?', onPress: () => send(surface, { t: 'help' }) }),
      Button({ key: 'demo', hotkey: 'd', plain: true, label: props.demo ? '🎬 ✕' : '🎬', onPress: () => send(surface, { t: 'demo' }) }),
      Button({ key: 'still', hotkey: 's', plain: true, label: props.prefs.still ? '🖼' : '🎞', onPress: () => send(surface, { t: 'still' }) }),
    ] })
    const search = Input({ key: 'search', placeholder: `🔍 ${(L.searchPlaceholder ?? '').replace(/…$/, '')}`, value: props.search, onInput: (v: string) => send(surface, { t: 'search', q: v }), onSubmit: (v: string) => send(surface, { t: 'search', q: v }) })
    const kids: RenderElement[] = [header, toolbar, search]
    let extraRows = 0
    if (props.helpOpen) {
      extraRows = 10
      const rows: Array<[string, string]> = [[L.scFinished ?? '', 'f'], [L.scMove ?? '', 'k / j'], [L.scOpen ?? '', 'o · Enter'], [L.scClose ?? '', 'x · Esc'], [L.scMute ?? '', 'm'], [L.scLang ?? '', 'l'], [L.scDemo ?? '', 'd'], [L.scHelp ?? '', 'h']]
      kids.push(Box({ key: 'help', flexDirection: 'column', borderStyle: 'round', paddingX: 1, children: [
        Box({ flexDirection: row, justifyContent: 'space-between', children: [Text({ bold: true, children: [L.helpTitle ?? ''] }), Button({ key: 'closeHelp', plain: true, label: '✕', onPress: () => send(surface, { t: 'help' }) })] }),
        ...rows.map(([what, keys]) => Box({ flexDirection: row, justifyContent: 'space-between', columnGap: 1, children: [Text({ children: [what] }), Text({ color: 'cyan', children: [keys] })] })),
      ] }))
    } else if (props.drawer) {
      extraRows = 8
      const d = props.drawer
      kids.push(Box({ key: 'drawer', flexDirection: 'column', borderStyle: 'double', paddingX: 1, children: [
        Box({ flexDirection: row, justifyContent: 'space-between', columnGap: 1, children: [Text({ bold: true, children: [d.name] }), Button({ key: 'close', hotkey: 'x', plain: true, role: 'dismiss', label: `✕ ${L.close ?? ''}`, onPress: () => send(surface, { t: 'close' }) })] }),
        Box({ flexDirection: row, columnGap: 1, children: d.chips.map(c => Text({ inverse: true, children: [` ${c} `] })) }),
        Text({ children: [`${L.dModel ?? ''}: 🧠 ${d.model} · ${L.dAction ?? ''}: ${d.act}`] }),
        Text({ bold: true, children: [L.dTask ?? ''] }),
        Text({ wrap: 'truncate', children: [d.task] }),
        ...(d.result ? [Text({ bold: true, children: [L.dResult ?? ''] }), Text({ wrap: 'truncate', children: [d.result] })] : []),
      ] }))
    }
    if (props.empty) {
      kids.push(Box({ flexDirection: 'column', alignItems: 'center', children: [
        Text({ children: ['🏢'] }), Text({ bold: true, children: [props.empty.msg] }),
        ...(props.empty.sub ? props.empty.sub.split(/\s[-—]\s/).map(l => Text({ dimColor: true, children: [l] })) : []),
        ...(props.empty.kind === 'office' ? [Button({ key: 'watchDemo', variant: 'primary', label: L.watchDemo ?? '', onPress: () => send(surface, { t: 'demo' }) })] : []),
      ] }))
    } else {
      const count = Math.max(1, (surface.rows || props.rows) - CHROME_ROWS - extraRows)
      const hop = new Set(s.fx.filter(f => f.kind === 'done').map(f => f.id))
      const entering = new Set(s.fx.filter(f => f.kind === 'enter').map(f => f.id))
      for (const r of windowRows(layout, props.offset, count)) {
        const runs = rowRuns(r.cells)
        kids.push(Text({ key: r.id, wrap: 'truncate', children: runs.map(run => {
          const text = run.text
          if (!run.fg && !run.bg && !run.bold && !run.dim) return text
          return Text({ ...(run.fg ? { color: run.fg } : {}), ...(run.bg ? { backgroundColor: run.bg } : {}), ...(run.bold ? { bold: true } : {}), ...(run.dim ? { dimColor: true } : {}), children: [text] })
        }) }))
      }
      // hover / hop / walk-in: one line of state under the office rather than re-laying the rows
      if (s.hover || hop.size || entering.size) {
        const bits = [s.hover ? `👆 ${s.hover}` : '', hop.size ? `⭐ ${[...hop].join(' ')}` : '', entering.size ? `🚶 ${[...entering].join(' ')}` : ''].filter(Boolean)
        kids.push(Text({ dimColor: true, wrap: 'truncate', children: [bits.join(' · ')] }))
      }
    }
    if (props.footer) kids.push(Text({ dimColor: true, wrap: 'truncate', children: [props.footer] }))
    return Box({ flexDirection: 'column', children: kids })
  } catch (err) {
    return Text({ color: 'red', children: [`office: ${err instanceof Error ? err.message : String(err)}`] })
  }
}

export default Office
```
Notes for the implementer: the walk-in/hop are drawn as a status line in this first cut (spec §7.4 wants a visual effect on the tile; Task 2.7 refines it into the tile rows once the probe's cell metrics are known — the row ids stay the same). Keep the module under one second: `layoutOffice` runs only when `layoutKey` changes.
- [ ] **Step 3:** Continue with Task 2.4 (the test needs the desktop branch), then run validate + test + tsc for both.
- [ ] **Step 4: Commit** (with Task 2.4) `feat(mod): office-client — the desktop office as one Client surface module`.

### Task 2.4: `ui.tsx` — the desktop branch returns the Client; `finishBeat` is read-only

> Note (2026-10-10, after Task 1.4): there is no `finishBeat` any more; the stars come from `office.stars` in the payload (Task 1.4). Read the ledger's Task 1.4 carry-forward before implementing; where this task says "finishBeat", read "the stars already in the payload".

**Files:**
- Modify: `desktop-mod/hooks/ui.tsx:673-690` (the render hook head), the `desktop` branches (`desktopRoom`, `desktopMessage`, the `Svg` imports), `finishBeat`
- Modify: `desktop-mod/hooks/model.ts` (add `export const DESKTOP = { clientFailed: false }`)
- Test: `desktop-mod/hooks/office-client.test.ts` (Task 2.3), `desktop-mod/hooks/ui.test.ts`

- [ ] **Step 1: Write the failing test** (`ui.test.ts`): `mount` on `desktop` → `find({ type: 'Svg' })` is undefined and `find({ type: 'Client' })?.key === 'office'`; after `DESKTOP.clientFailed = true` (import from `./model`) and `ui.redraw()`, `find({ type: 'Client' })` is undefined and `find({ key: 'open:a1' })` exists (the text cards).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** At the top of the render hook, after reading `prefs`, `payload`, `view`, `scanError`, `roomDone`, `now`:

```tsx
    const els = $.ui.resolve(e)
    const desktopClient = e.surface === 'desktop' && 'Client' in els && !DESKTOP.clientFailed
    if (desktopClient && e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      const width = Math.max(MIN_WIDTH, e.props.bodyColumns || 80)
      const rowsAvail = e.props.scroll?.bodyRows ?? 30
      const footerBits: string[] = []
      if (payload.oversized > 0) footerBits.push(I18N[prefs.lang].oversizedN(payload.oversized))
      if (scanError) footerBits.push(scanError)
      const props = buildOfficeProps({ payload, prefs, view, roomDone, offset: scrollOffset(), columns: width, rows: rowsAvail, now, usage: usageNow(), firstSeen, footer: footerBits.join(' · ') })
      return <Client key={OFFICE_KEY} module="./office-client.tsx" width={width} height={rowsAvail} props={props} />
    }
```
`scrollOffset()` and `usageNow()` are getters exported from `model.ts` over module objects (`export const SCROLL = { offset: 0, contentRows: 0 }`, `export const USAGE = { fiveHour: null as { pct: number; resetsAt: string } | null }`) so `register.tsx` writes them and `ui.tsx` reads them without `$`. `firstSeen` is the existing module map in `ui.tsx`, maintained by `walkIns` (call `walkIns(firstSeen, payload.agents, now)` before building the props so newcomers get their stamp).
The old desktop code (`desktopRoom`, `desktopMessage`, `roomRowSvgs`, `messageSvg`, `prefs.still ? undefined : true`) is deleted; `office-svg.ts` keeps `messageSvg`/`roomRowSvgs` for `vscode`/`mobile` only where the existing non-desktop branch used them (if it never did, delete those too and keep `toolFamily`, `UNKNOWN_MODEL_PILL`, `escapeXml`, `fitText` which other code imports).
`finishBeat` returns `office.stars` and no longer schedules writes (Task 1.4 moved the beat to `poll`).
- [ ] **Step 4: Run** validate + test (both files) + tsc.
- [ ] **Step 5: Commit** (with 2.3).

### Task 2.5: `register.tsx` — messages, scroll, fault, latch, pull channel

**Files:**
- Modify: `desktop-mod/hooks/register.tsx`
- Modify: `desktop-mod/hooks/model.ts` (`REDRAW_LATCH_MS = 100`, `SCROLL`, `USAGE`, `DESKTOP` objects)
- Modify: `desktop-mod/types/index.d.ts` (remove `live`)
- Test: `desktop-mod/hooks/register.test.ts` (new) — messages change prefs/view; scroll; fault

- [ ] **Step 1: Write the failing tests** (`register.test.ts`; reuse the `beneath` helper from Task 2.3 by exporting it from a new `hooks/test-kit.ts`):

```ts
test('ui.message from the office changes prefs/view and the store; unknown data is ignored', async ($, on) => {
  const { clock, store } = beneath(on, () => [])
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount(PANE)
  await ui.post({ t: 'showDone' }, { in: 'office' })
  expect((store.prefs as { showDone: boolean }).showDone).toBe(true)
  await ui.post({ t: 'lang' }, { in: 'office' })
  expect((store.prefs as { lang: string }).lang).toBe('en')
  await ui.post({ t: 'search', q: 'abc' }, { in: 'office' })
  expect(((await ui.find({ type: 'Client' }))?.props.props as { search: string }).search).toBe('abc')
  await ui.post({ t: 'content', rows: 123 }, { in: 'office' })
  await ui.post({ nonsense: true }, { in: 'office' })
  await ui.unmount()
})

test('ui.fault on the office falls back to the text cards and toasts once', async ($, on) => {
  const { clock } = beneath(on, () => [agent({ id: 'a1' })])
  const toasts: string[] = []
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  await $.ui.fault({ surface: 'desktop', component: 'Pane', requestId: 'agent-theater', element: 'office', module: './office-client.tsx', phase: 'render', reason: 'boom' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ key: 'open:a1' })).toBeDefined()
  expect(toasts).toHaveLength(1)
  await ui.unmount()
})
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** in `register.tsx` (top-level helpers; `$` stays in this file):

```tsx
let redrawPending = false
/** One redraw at most per REDRAW_LATCH_MS, whoever asks (scroll, a message that changed nothing in state). */
function requestRedraw($: EngineInterface): void {
  if (redrawPending) return
  redrawPending = true
  $.clock.after(REDRAW_LATCH_MS, () => {
    redrawPending = false
    try { $.ui.invalidate('ui.render') } catch { /* nothing drawn yet */ }
  })
}

async function applyMessage($: EngineInterface, m: OfficeMessage): Promise<void> {
  switch (m.t) {
    case 'open': await update($, viewAtom, v => ({ ...v, selected: m.id, helpOpen: false })); return
    case 'close': await update($, viewAtom, v => ({ ...v, selected: null, helpOpen: false })); return
    case 'help': await update($, viewAtom, v => ({ ...v, helpOpen: !v.helpOpen })); return
    case 'search': await update($, viewAtom, v => (v.search === m.q ? v : { ...v, search: m.q, focusIndex: -1 })); return
    case 'demo': await setDemo($, !(await read($, viewAtom)).demo); return
    case 'showDone': await savePrefs($, p => ({ ...p, showDone: !p.showDone })); return
    case 'mute': await savePrefs($, p => ({ ...p, muted: !p.muted })); return
    case 'still': await savePrefs($, p => ({ ...p, still: !p.still })); return
    case 'lang': await setLang($, (await read($, prefsAtom)).lang === 'he' ? 'en' : 'he'); return
    case 'pin': await savePrefs($, p => ({ ...p, pins: p.pins.includes(m.room) ? p.pins.filter(x => x !== m.room) : [...p.pins, m.room] })); return
    case 'roomDone': { const prefs = await read($, prefsAtom); const rd = await loadRoomDone($); await saveRoomDone($, toggledRoomDone(rd, prefs.showDone, m.room)); requestRedraw($); return }
    case 'focus': await update($, viewAtom, v => ({ ...v, selected: m.id })); return
    case 'content': SCROLL.contentRows = Math.max(0, Math.floor(m.rows)); return
    case 'pull': return
  }
}
```
(`savePrefs`, `setLang`, `setDemo`, `loadRoomDone`, `saveRoomDone` move from `ui.tsx` into `register.tsx` or into a new `prefs.ts` that takes `$` — remember the validate rule: a helper that takes `$` must be declared in the file that calls it with `$`, so put them in `register.tsx` and have `ui.tsx` keep its own copies for the terminal handlers, or move ALL handlers to `register.tsx` and have `ui.tsx` post nothing — simplest: `ui.tsx`'s terminal handlers stay as they are (they already live beside `$`), and `register.tsx` gets its own `savePrefs/setLang/setDemo/loadRoomDone/saveRoomDone` (eight lines each, duplicated on purpose; `toggledRoomDone` is pure and imported).)

Hooks:

```tsx
  on('ui.message', { element: OFFICE_KEY }, async ($, e) => {
    const d = e.data as Partial<OfficeMessage> | null
    if (!d || typeof d !== 'object' || typeof d.t !== 'string') return {}
    try { await applyMessage($, d as OfficeMessage) } catch { /* never fail the surface */ }
    return {}
  }).catch(() => ({}))

  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    const max = Math.max(0, SCROLL.contentRows - e.bodyRows)
    const offset = Math.max(0, Math.min(max, SCROLL.offset + e.by))
    if (offset !== SCROLL.offset) { SCROLL.offset = offset; requestRedraw($) }
    return {}
  }).catch(($, e, next) => next(e))

  on('ui.fault', { element: OFFICE_KEY }, async ($, e, next) => {
    if (!DESKTOP.clientFailed) {
      DESKTOP.clientFailed = true
      const prefs = await read($, prefsAtom)
      $.ui.toast(prefs.lang === 'he' ? `התיאטרון: ציור המשרד נכשל (${e.phase}); מוצגים כרטיסים` : `Theater: the office failed (${e.phase}); showing cards`)
    }
    return next(e)
  }).catch(($, e, next) => next(e))
```
`/theater` (command.run) resets `DESKTOP.clientFailed = false` and `SCROLL.offset = 0` before opening.
- [ ] **Step 4: Remove `live` from `types/index.d.ts`** (`PluginState['agent-theater'].live`) — nothing reads it since commit 2573ee4.
- [ ] **Step 5:** Run validate + test + tsc. Validate must list `ui.message`, `ui.scroll`, `ui.fault` under hooks.
- [ ] **Step 6: Commit** `feat(mod): office messages, owned scroll, ui.fault fallback, redraw latch`.
- [ ] **Step 7 (only if Phase 0 item 1 FAILED and item 4 PASSED): the pull channel.** In `applyMessage` `case 'pull'`: build the props exactly as `ui.tsx` does (`buildOfficeProps(...)`) and return them: change the `ui.message` hook to `return d.t === 'pull' ? { props: await currentOfficeProps($) } : {}` where `currentOfficeProps($)` reads the atoms and calls `buildOfficeProps`; in `office-client.tsx` start `surface.every(2000, () => surface.post({ t: 'pull', seq: ++n }))` in the init block; in `poll`, skip `update($, payloadAtom, …)` while `DESKTOP.pullMode` (keep the payload in a module variable the pull reads). Test: `ui.post({ t: 'pull', seq: 1 }, { in: 'office' })` → the Client's props change with `captured.prefsReads` unchanged (no render).

### Task 2.6: Remove the Svg desktop tests, keep the text-surface ones

**Files:**
- Modify: `desktop-mod/hooks/ui.test.ts` (delete `tileOf`, `roomSvgOf`, the DESKTOP SVG test, the RESIZE SVG test, the `🎞/🖼` Svg assertions, the DESKTOP RTL Svg message test; keep every terminal/vscode/mobile test and the FLICKER GUARD with its write counts)
- Modify: `desktop-mod/hooks/office-svg.test.ts` (keep the pure helper tests `toolFamily`, `fitText`, `escapeXml`; delete `roomSvg`/`roomRowSvgs`/`tileGroup` tests if those functions were deleted in Task 2.4)

- [ ] **Step 1:** Run the suite, list the failing tests, delete/replace each with the office-client equivalents written in Tasks 2.3 and 2.5.
- [ ] **Step 2:** The FLICKER GUARD test's desktop assertion becomes: five quiet polls → `renders()` unchanged AND `captured.writes.payload` unchanged; one visible change → `writes.payload + 1` and the Client's `props.props` differ (`JSON.stringify`).
- [ ] **Step 3:** validate + test (0 fail) + tsc. Commit `test(mod): desktop tests target the Client office`.

### Task 2.7: Tile effects in the rows (walk-in, hop) and hover frame

**Files:**
- Modify: `desktop-mod/hooks/office-layout.ts` (`layoutOffice(props, decor?)` takes `decor: { hover: string | null; hop: Set<string>; entering: Map<string, number> }`)
- Modify: `desktop-mod/hooks/office-client.tsx` (pass the decor; memo key includes the decor)
- Test: `desktop-mod/hooks/office-layout.test.ts`

- [ ] **Step 1: Write the failing test:** with `decor.hop = new Set(['a1'])` the tile's emoji sits one row higher (row y+0 empty at the emoji cell, the emoji in the room head row is NOT allowed — so the hop is drawn as the emoji replaced by `⭐🦉` on the same row); with `decor.entering = new Map([['a1', 0.5]])` (progress 0..1) the emoji's x is shifted by `round((1 - p) * 3)` cells toward the walk-in side; with `decor.hover = 'a1'` the tile's desk row gets `bg: '#1f2a44'`.
- [ ] **Step 2: Implement** in `tile(...)` (three `if`s), and in the module compute `entering` progress as `1 - left / FX_ENTER_MS`; the layout memo key appends `JSON.stringify([hover, [...hop], [...entering])`. Remove the status line of Task 2.3.
- [ ] **Step 3:** validate + test + tsc. Commit `feat(mod): tile walk-in, hop and hover inside the office rows`.

### Task 2.8: Re-enable the mod, verify by eye, update docs

**Files:**
- Modify: `~/.claude/settings.json` (`env.CLAUDE_CODE_PLUGIN_DIRS`), `desktop-mod/HANDOFF.md`, `README.md` (desktop section), `CHANGELOG.md`

- [ ] **Step 1:** Add `"CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\asafa\\agent-theater\\desktop-mod"` back under `env` in `~/.claude/settings.json`; ask the user (Hebrew) to open a new conversation and type `/theater`, then run a task with several subagents.
- [ ] **Step 2: Checklist with the user:** no blink while agents come and go for 2 minutes; wheel-scroll smooth; click on a character opens the drawer; ☑ 🔔 EN work; Hebrew names readable; CPU numbers (Task Manager) within Phase 1's targets. Screenshot into `docs/screenshots/desktop-client-office.png`.
- [ ] **Step 3:** Fix what the eye finds (each fix its own commit with a test where possible).
- [ ] **Step 4:** Update `HANDOFF.md` (state: Client office live; what was verified; known limits: mixed-direction titles, emoji width), `README.md` ("Desktop: one Client region, no Svg"), `CHANGELOG.md` (`0.5.0 — desktop office on a Client surface module; 5 s scan; stars in the payload`).
- [ ] **Step 5: Commit** `docs(mod): client office verified on the desktop; handoff, readme, changelog`.

---

# Phase 3 — The 5-hour usage meter (spec §9)

### Task 3.1: `usage.ts` — pure formatting

**Files:**
- Create: `desktop-mod/hooks/usage.ts`
- Test: `desktop-mod/hooks/usage.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'claude-code/testing'
import { pickFiveHour, usageBar, usageLabel } from './usage'

test('pickFiveHour takes the five_hour window only', () => {
  expect(pickFiveHour([])).toBeNull()
  expect(pickFiveHour([{ kind: 'seven_day', percentUsed: 10 }])).toBeNull()
  expect(pickFiveHour([{ kind: 'seven_day', percentUsed: 10 }, { kind: 'five_hour', percentUsed: 42.4, resetsAt: '2026-10-10T11:30:00Z' }])).toEqual({ pct: 42.4, resetsAt: '2026-10-10T11:30:00Z' })
  expect(pickFiveHour([{ kind: 'five_hour', percentUsed: 7 }])).toEqual({ pct: 7, resetsAt: '' })
})

test('usageBar: 10 cells, rounded', () => {
  expect(usageBar(0)).toBe('▱▱▱▱▱▱▱▱▱▱')
  expect(usageBar(42)).toBe('▰▰▰▰▱▱▱▱▱▱')
  expect(usageBar(100)).toBe('▰▰▰▰▰▰▰▰▰▰')
  expect(usageBar(120)).toBe('▰▰▰▰▰▰▰▰▰▰')
})

test('usageLabel: percent, local reset time, ⚠ from 80%', () => {
  const u = { pct: 42.4, resetsAt: '2026-10-10T11:30:00Z' }
  const label = usageLabel(u, 'he', Date.UTC(2026, 9, 10, 9, 0))
  expect(label.startsWith('⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · ')).toBe(true)
  expect(label).toMatch(/\d\d:\d\d$/)
  expect(usageLabel({ pct: 81, resetsAt: '' }, 'en', 0)).toBe('⚠ 5h ▰▰▰▰▰▰▰▰▱▱ 81%')
})
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```ts
// The five-hour rate-limit window as the footer label draws it. Pure.
export type FiveHour = { pct: number; resetsAt: string }

export function pickFiveHour(limits: ReadonlyArray<{ kind: string; percentUsed: number; resetsAt?: string }>): FiveHour | null {
  const l = limits.find(x => x.kind === 'five_hour')
  return l ? { pct: l.percentUsed, resetsAt: l.resetsAt ?? '' } : null
}

export function usageBar(pct: number, cells = 10): string {
  const on = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)))
  return '▰'.repeat(on) + '▱'.repeat(cells - on)
}

/** `⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30` — the reset hour in the machine's local time; `⚠` from 80%. */
export function usageLabel(u: FiveHour, _lang: 'he' | 'en', _now: number): string {
  const pct = Math.round(u.pct)
  const head = pct >= 80 ? '⚠' : '⏳'
  let when = ''
  if (u.resetsAt) {
    const d = new Date(u.resetsAt)
    if (!Number.isNaN(d.getTime())) when = ` · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${head} 5h ${usageBar(u.pct)} ${pct}%${when}`
}
```
- [ ] **Step 4: Run** → PASS; validate; tsc. Commit `feat(mod): usage — five-hour label formatting`.

### Task 3.2: Hooks — `session.measure`, first reading, `SessionMode` label

**Files:**
- Modify: `desktop-mod/hooks/register.tsx` (two hooks + session.start read)
- Modify: `desktop-mod/hooks/model.ts` (`USAGE` object from Task 2.4)
- Test: `desktop-mod/hooks/usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('the footer gets the five-hour label after a session.measure; none without a five_hour reading', async ($, on) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: [] } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'SessionMode' }, ($, e) => { const { Text } = $.ui.resolve(e); return Text({ children: [e.props.modes.join(' & ')] }) })
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const MODE = { plugin: 'agent-theater', component: 'SessionMode', requestId: 'session-mode', props: { modes: ['focus'] } } as const
  let ui = await $.ui.mount(MODE)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('focus')
  await ui.unmount()
  await $.session.measure({ context: { tokens: 1, window: 200000, percent: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-10T11:30:00Z' }], changed: ['rateLimits'] })
  ui = await $.ui.mount(MODE)
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/^⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · \d\d:\d\d & focus$/)
  await ui.unmount()
})
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (`register.tsx`):

```tsx
  on('session.measure', async ($, e, next) => {
    try {
      const u = pickFiveHour(e.rateLimits)
      const same = JSON.stringify(u) === JSON.stringify(USAGE.fiveHour)
      if (!same) { USAGE.fiveHour = u; requestRedraw($) }
    } catch { /* decoration */ }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const u = USAGE.fiveHour
    if (!u) return next(e)
    const prefs = await read($, prefsAtom).catch(() => DEFAULT_PREFS)
    const now = await $.clock.now().catch(() => 0)
    return next({ ...e, props: { ...e.props, modes: [usageLabel(u, prefs.lang, now), ...e.props.modes] } })
  }).catch(($, e, next) => next(e))
```
and in `session.start`, after the prefs load: `try { USAGE.fiveHour = pickFiveHour((await $.session.usage()).rateLimits) } catch { USAGE.fiveHour = null }`.
- [ ] **Step 4: Run** validate (hooks list gains `session.measure`, `ui.render` ×3 with matchers; calls gain `session.usage`) + test + tsc.
- [ ] **Step 5: Commit** `feat(mod): five-hour usage label on the prompt footer (SessionMode) from session.measure`.

### Task 3.3: The meter in the pane header

**Files:**
- Modify: `desktop-mod/hooks/ui.tsx` (desktop: `usage: USAGE.fiveHour` already passed in Task 2.4; terminal header: append ` · ⏳ 42%` to `countsText` when `USAGE.fiveHour`)
- Modify: `desktop-mod/hooks/office-client.tsx` (header already draws `props.usage`; make it the full `usageLabel` when `columns >= 60`, else `⏳ 42%`)
- Test: `desktop-mod/hooks/usage.test.ts` (mount the pane on desktop after a measure → the Client's `props.props.usage.pct === 42`; on terminal the header Text contains `⏳ 42%`)

- [ ] **Step 1:** Write the test, run → FAIL, implement, run → PASS, validate, tsc.
- [ ] **Step 2: Commit** `feat(mod): five-hour meter in the office header`.

### Task 3.4: Live placement check

- [ ] **Step 1:** In the verification session (Task 2.8 or a new one): where does the label land on the footer line? Record in `HANDOFF.md`. If it is not between "Auto" and "Fable 5.1": try `PromptHint` (`on('ui.render', { component: 'PromptHint' }, ($, e, next) => USAGE.fiveHour ? next({ ...e, props: { ...e.props, hint: `${usageLabel(...)}  ${e.props.hint}` } }) : next(e))`) and look again; keep whichever the user prefers, delete the other. The pane header keeps it regardless.
- [ ] **Step 2: Commit** `docs(mod): usage label placement verified` (plus the hook change if any).

---

# Phase 4 — Cleanup

### Task 4.1: Delete the research clones; final handoff

- [ ] **Step 1:** Delete `C:\tmp\pixel-office-clone`, `C:\tmp\agent-office-ro`, `C:\tmp\pa-clone`, `C:\tmp\ap-clone-69e31b17`, `C:\tmp\cc-gitdir-69e31b17`, `C:\tmp\ccp-playground-gitdir`, `C:\tmp\ck-stage-69e31b17`, `C:\tmp\idle-art-clone`, every `scratchpad\repos*` folder of this session, and `subst H: /D` if `subst` lists an `H:` alias. Also delete `C:\Users\asafa\.claude\dev-mods\theater-probe` (Phase 0) and `~/.claude/theater-probe.log`.
- [ ] **Step 2:** `HANDOFF.md`: final state, how to run the checks, what is still open (mixed-direction titles; VS Code/mobile keep text cards; merge `feat/desktop-mod` → `main` when the user says so).
- [ ] **Step 3: Commit** `chore: research cleanup; handoff` and push.

---

## Self-review (done while writing)

- **Spec coverage:** §5 architecture → 2.3/2.4/2.5; §6.1 one publish → 1.4; §6.2 props → 2.2; §6.3 messages → 2.5; §6.4 scroll → 2.5 + 2.3 (windowing); §6.5 latch → 2.5; §6.6 pull channel → 2.5 Step 7 (conditional); §7.1–7.3 → 2.1/2.3; §7.4 fx → 2.3 + 2.7; §7.5 untouched; §8 scan → 1.1–1.5; §9 usage → 3.1–3.4; §10 errors → 2.3 try/catch, 2.5 ui.fault, 2.2 assertJson; §11 tests → each task; §12 probe → 0.1/0.2; §15 cleanup → 4.1.
- **Placeholders:** none; every code step carries its code.
- **Type consistency:** `OfficeProps`/`OfficeMessage`/`OFFICE_KEY` (office-props), `layoutOffice/rowRuns/hitAt/windowRows/TILE_*` (office-layout), `CHROME_ROWS/FX_*` (office-client), `SCROLL/USAGE/DESKTOP/REDRAW_LATCH_MS/POLL_MS/MAX_EVENTS` (model), `pickFiveHour/usageBar/usageLabel` (usage), `appendParse` (scanner), `starsOf` (ui) — used with the same names in every task that references them.
- **Known judgement calls left to the implementer:** the `ui.tsx ↔ office-props.ts` import cycle (Task 2.2 Step 4 says how to break it); the exact row count of the help/drawer blocks (Task 2.3 uses 10/8; adjust to what is drawn and keep `extraRows` in step with `onPointer`).
