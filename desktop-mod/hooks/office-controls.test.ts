// EVERY CONTROL of the desktop office, each driven end to end through the kit
// on the real mount (Task 2.8b-4; the cards since 2026-10-19; THREE WIDTHS
// since 2026-10-20): the office Client's Button, letter key or pointer event →
// the module's post (office-client.tsx `surface.post`) → the plugin's own
// `ui.message` hook (ui.tsx applyOfficeMessage) → prefs / view / the $.store →
// the next props the pane hands the Client (office-props.ts buildOfficeProps)
// → what the module draws. One test per control; what each asserts is what a
// person sees change. A failing test here is a bug in the owning file, never
// a test to loosen.
//
// THE THREE WIDTHS: every test runs at 36, 53 and 120 columns (`suite`): the
// probe's narrow, reference and wide reading columns (rounds 8-9: 34, 51 and
// 100 cells) in their panes — the column a cell in from each edge (live check
// 6: office-layout.ts PANE_GUTTER), so the pointer's x counts a margin of 1 —
// the toolbar in its icon-only form at 36 and in words from 53, the settings'
// Buttons in words at every one of the three (the probe's L) but icons while
// the demo runs at 36; the search on a line of its own under ONE_LINE_FROM and
// beside the toolbar at 120; the reading column frozen at 100 cells and
// centred by a margin of 10 at 120; the table mode poorer at 36 (the
// activity's emoji alone) and richer at 120 (the model's version, the dim task
// column); the room counts shrunk at 36 (the ✅ dropped before the title is cut). WIDTHS
// says what each width draws; the first test of each width pins it, and every
// other test reads its labels and rows from there, so a control is proved at
// the width's own forms, never at the reference width's.
//
// The mechanics (the window, the write budget, a bad post) are
// office-client.mounted.test.ts's and register.test.ts's; the fake-surface
// cases of office-client.test.ts cover the module alone. This file reads the
// effects: the pref or view flipped and mirrored, the cards and rows redrawn,
// the drawer or settings opened, the labels in the other language.
//
// The office of these tests: room A (a Hebrew-titled conversation) with its
// lead, a reader and RECENT_DONE + 1 finished writers — the room draws the
// RECENT_DONE most recent and a "N more finished" line for the rest — and
// room B with one MCP agent (the one that matches the search "triage").
//
// THE POINTER THROUGH THE LINE MAP (the last section): every click lands at
// Client row chromeRows + y of its layout line and column cell margin + x,
// whatever the engine's scroll offset and whether the drawer or the settings
// are open (under the fixed chrome at the top, or AT THE WINDOW'S TOP over a
// frameless fragment once the pane is scrolled). A tall office (room A's card
// runs past a 25-row window) is scrolled by the pane's props, and every line
// of the window and around it is clicked: a row opens its drawer, the rest
// open nothing — the rows above the window (the spacer), past it, the
// overlay's own rows and the chrome included — and the card controls lower
// down (A's more line, B's pin and ✅ counts, B's head hover) answer where the
// window shows them.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { I18N } from './i18n'
import { PERSONA_EMOJI, POLL_MS } from './model'
import type { Agent, Prefs } from './model'
import { CHROME_ROWS_MIN, CHROME_ROWS_SEARCH, DEMO_ROWS, OVERLAY_GAP, REFUSED_RE, SEARCH_FROM, WINDOW_ROWS, chromeRows, demoLine, drawerInner, drawerStatus, fixedRows, helpRows, overlayInWindow, overlayRows, windowOf } from './office-chrome'
import { SEARCH_DEBOUNCE_MS } from './office-client'
import { CARD_BORDER, FOCUS_MARK, NO_DECOR, PIN, countsFor, geometry, nb, officeModel, pinZone, trimWindow } from './office-layout'
import type { Hit, ModelCol, RoomView, TableMode } from './office-layout'
import { OFFICE_KEY } from './office-props'
import type { OfficeProps } from './office-props'
import { personaName } from './personas'
import { T0, beneath } from './test-kit'
import { FOCUS_ON_SELECTED, RECENT_DONE } from './ui'

const SA = 'sess-aaaa-1111-frontend'
const SB = 'sess-bbbb-2222-research'
const ROWS = 30
const TITLE_A = 'תריץ 4 סוכני משנה'
/** The $.store the tests start from: Hebrew, the chime on, finished hidden, no pins. */
const PREFS = () => ({ prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })

/** The finished writers of room A, newest first; the RECENT_DONE first are drawn, the last is held back. */
const DONE = Array.from({ length: RECENT_DONE + 1 }, (_, i) => `d${i + 1}`)
/** Room A's rows while its finished are hidden, and with them all. */
const DRAWN_A = ['lead-a', 'a1', ...DONE.slice(0, RECENT_DONE)]
const ALL_A = ['lead-a', 'a1', ...DONE]
/** Seven more working agents for room B: with them the office shows SEARCH_FROM + 1 agents (the fixture shows six: one finished writer is held back) and draws the search field (the 🔍 test). */
const EXTRA = Array.from({ length: SEARCH_FROM + 1 - 6 }, (_, i) => `x${i + 1}`)
const MORE_LABEL = I18N.he.moreDoneN(1)
const HIDE_LABEL = I18N.he.hideDone
/** The more / hide line as drawn: with no plain space (office-layout.ts nb: a one-line value never wraps). */
const MORE_LINE = nb(`▸ ${MORE_LABEL}`)
const HIDE_LINE = nb(`▾ ${HIDE_LABEL}`)   // (the arrow follows the state: live check 7)

/**
 * WHAT EACH WIDTH DRAWS (office-layout.ts geometry, office-chrome.ts; the probe's rounds 8-9), pinned by the first test of
 * each width and read by the rest:
 *   column / margin  the reading column's cells and its centring margin (the pane less a cell at each edge, PANE_GUTTER; a
 *                    frozen 100 centred by 10 at 120 — the pointer's x counts the margin);
 *   toolbar / settings  the three labels of each, in Hebrew and in English: their words when the set fits the line by
 *                    LINE_FIT (office-chrome.ts labelsFit, the whole column: the probe's L), else the icons alone — a 34-cell
 *                    column holds the settings' two (17 ≤ 28) but not the toolbar's, 51 and 100 both; `exitDemo` the demo Button
 *                    while the demo runs (`יציאה ✕ 🎬`: beside the language at every one of the three);
 *   hotkeys          whether the Buttons carry their letters as hotkeys (from COMPACT_BELOW: the desktop draws a chip per hotkey);
 *   searchRows       the chrome's rows while the search field is drawn: 6 with the field on its own line, 4 beside the
 *                    toolbar from ONE_LINE_FROM;
 *   helpRows         the settings popover's rows: one column of the nine shortcut rows, two pairs of five from WIDE_FROM;
 *   model / word / task  the office's table mode on the fixture (Hebrew): the model column (the family word, its version from
 *                    MODEL_FULL_FROM, or none), the activity word beside its emoji, the dim task column from CENTRE_AT;
 *   countsA / tallA / tallB  the counts of room A (the fixture: 2 working, 4 finished), of the tall office's A (31 working)
 *                    and B (1 and 1): the ✅ dropped at 34 so the title keeps TITLE_MIN cells (office-layout.ts countsFor);
 *   drawerType       whether the drawer's status line has room for the agent type after the clock (`· Explore`): the line
 *                    is cut to the card's inner width by FIT, which 34 columns' 22 cells do not hold.
 */
type Labels = readonly [string, string, string]
type Settings = readonly [string, string]
type Width = {
  column: number; margin: number
  toolbar: Labels; toolbarEn: Labels
  settings: Settings; settingsEn: Settings; exitDemo: string
  /** The demo line's note at this width (office-chrome.ts demoLine: the longest that fits beside the exit Button by LINE_FIT). */
  demoNote: string
  hotkeys: boolean; searchRows: number; helpRows: number
  model: ModelCol; word: boolean; task: boolean
  countsA: string; tallA: string; tallB: string; drawerType: boolean
}
const WORDS_HE: Labels = ['הצג שסיימו ☐', 'צליל 🔔', 'הגדרות ⚙️']
const WORDS_EN: Labels = ['☐ Show finished', '🔔 Sound', '⚙️ Settings']
const ICONS: Labels = ['☐', '🔔', '⚙️']
/** The settings' two Buttons (the motion toggle gone: live check 7, Q9). */
const SETTINGS_HE: Settings = ['דמו 🎬', '🌐 English']
const SETTINGS_EN: Settings = ['🎬 Demo', '🌐 עברית']
/** The demo line's notes (live check 5): the whole sentence, and the middle form a narrow pane draws. */
const DEMO_NOTE = '🎬 זו הדגמה - הסוכנים לא אמיתיים'
const DEMO_NOTE_MID = '🎬 הדגמה - לא אמיתיים'
/** The demo cast's two rooms (scanner.ts demoPayload); the research room always holds RECENT_DONE + 2 finished agents. */
const DEMO_S2 = 'demo-session-research-2222'
const DEMO_ROOMS = ['demo-session-frontend-1111', DEMO_S2]
/** The research room's finished, most recent first (pre-check 6): it draws the RECENT_DONE first while it hides its finished, and counts the rest on its more line. */
const DEMO_DONE = ['demo-writer-ff', 'demo-survey-ii', 'demo-bench-jj', 'demo-dedupe-kk', 'demo-label-ll']
const DEMO_HELD = DEMO_DONE.slice(RECENT_DONE)
const WIDTHS: Record<36 | 53 | 120, Width> = {
  36: { column: 34, margin: 1, toolbar: ICONS, toolbarEn: ICONS, settings: SETTINGS_HE, settingsEn: SETTINGS_EN, exitDemo: 'יציאה ✕ 🎬', demoNote: DEMO_NOTE_MID, hotkeys: false, searchRows: CHROME_ROWS_SEARCH, helpRows: 14, model: 'family', word: false, task: false, countsA: '🟢2', tallA: '🟢31', tallB: '🟢1', drawerType: false },
  53: { column: 51, margin: 1, toolbar: WORDS_HE, toolbarEn: WORDS_EN, settings: SETTINGS_HE, settingsEn: SETTINGS_EN, exitDemo: 'יציאה ✕ 🎬', demoNote: DEMO_NOTE, hotkeys: false, searchRows: CHROME_ROWS_SEARCH, helpRows: 14, model: 'family', word: true, task: false, countsA: '🟢2 ✅4', tallA: '🟢31 ✅4', tallB: '🟢1 ✅1', drawerType: true },
  120: { column: 100, margin: 10, toolbar: WORDS_HE, toolbarEn: WORDS_EN, settings: SETTINGS_HE, settingsEn: SETTINGS_EN, exitDemo: 'יציאה ✕ 🎬', demoNote: DEMO_NOTE, hotkeys: true, searchRows: CHROME_ROWS_MIN, helpRows: 11, model: 'full', word: true, task: true, countsA: '🟢2 ✅4', tallA: '🟢31 ✅4', tallB: '🟢1 ✅1', drawerType: true },
}
type Columns = keyof typeof WIDTHS

function agent(over: Partial<Agent> & { id: string }): Agent {
  return {
    persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: '', subagent_type: 'Explore', status: 'running', tool: 'Read', phase: 'tool',
    task: `Task of ${over.id}.`, task_short: `Task of ${over.id}.`, result: null, start_ms: T0 - 180_000, end_ms: null,
    session: SA.slice(0, 8), session_full: SA, cwd: '/home/dev/acme-web', project: '/home/dev/acme-web', mtime_ms: T0 - 1000,
    is_session: false, closed: false, is_workflow: false, truncated: false, model: 'claude-opus-5-5', ...over,
  }
}

function fixture(): Agent[] {
  return [
    agent({ id: 'lead-a', is_session: true, tool: '', phase: 'thinking', task: TITLE_A, task_short: TITLE_A }),
    agent({ id: 'a1', role: 'map session-token validation', persona_id: 7 }),
    ...DONE.map((id, i) => agent({ id, role: `write part ${i + 1}`, status: 'done', tool: 'Write', end_ms: T0 - (i + 1) * 1000, result: 'Done.', persona_id: 11 + i })),
    agent({ id: 'b1', role: 'triage open bugs', tool: 'mcp__github__search_issues', session: SB.slice(0, 8), session_full: SB, project: '/home/dev/research', cwd: '/home/dev/research', persona_id: 9 }),
  ]
}

/** The tall office's body: a 25-row window, so room A's card runs past it and the drawer and the settings both leave the window a row (overlayInWindow). */
const BODY = 25
const READERS = 30
/**
 * The tall office: room A (its lead, READERS readers, the RECENT_DONE + 1 finished writers — the room draws the RECENT_DONE and
 * the "1 more finished" line) is a card of CARD_LINES + 1 + READERS + RECENT_DONE + MORE_LINES lines, past any 25-row window;
 * room B holds a working agent and a finished one (drawn: it is among the recent), so its title line has ✅ counts to click.
 */
function tallFixture(): Agent[] {
  const inB = { session: SB.slice(0, 8), session_full: SB, project: '/home/dev/research', cwd: '/home/dev/research' }
  return [
    agent({ id: 'lead-a', is_session: true, tool: '', phase: 'thinking', task: TITLE_A, task_short: TITLE_A }),
    ...Array.from({ length: READERS }, (_, i) => agent({ id: `r${i + 1}`, role: `read part ${i + 1}`, persona_id: 7 })),
    ...DONE.map((id, i) => agent({ id, role: `write part ${i + 1}`, status: 'done', tool: 'Write', end_ms: T0 - (i + 1) * 1000, result: 'Done.', persona_id: 11 + i })),
    agent({ id: 'b1', role: 'triage open bugs', tool: 'mcp__github__search_issues', persona_id: 9, ...inB }),
    agent({ id: 'bd', role: 'file the report', status: 'done', tool: 'Write', end_ms: T0 - 5000, result: 'Filed.', persona_id: 10, ...inB }),
  ]
}

type Ui = Mounted<'desktop', 'Pane'>
/** A node of the kit's drawn tree (a Text without props carries no `props` field at all). */
type Drawn = { type: string; props?: Record<string, unknown>; children?: Array<Drawn | string> }
const propsOf = (n: Drawn | undefined): Record<string, unknown> => n?.props ?? {}

/** The pane's mount target at `columns` (its bodyColumns: what the hooks size the Client and its props by), its window `scroll`. */
function paneAt(columns: number, scroll: { offset: number; bodyRows: number }) {
  return { plugin: 'agent-theater', component: 'Pane', requestId: 'agent-theater', surface: 'desktop', props: { title: 'T', isFocused: true, bodyColumns: columns, placement: 'dock', scroll, view: {} } } as const
}
/** The pane scrolled to `offset` (the engine's window offset reaches the Client as props.offset), the body `bodyRows` tall. */
async function scrollTo(ui: Ui, offset: number, bodyRows: number): Promise<void> {
  const p = await officeProps(ui)
  await ui.redraw(paneAt(p.columns, { offset, bodyRows }).props)
  expect((await officeProps(ui)).offset).toBe(offset)
}

/** The office Client's props as last drawn. */
async function officeProps(ui: Ui): Promise<OfficeProps> {
  const c = await ui.find({ type: 'Client' })
  expect(c).toBeDefined()
  return c!.props.props as OfficeProps
}
const roomOf = (p: OfficeProps, id: string) => {
  const r = p.rooms.find(x => x.id === id)
  expect(r, `room ${id}`).toBeDefined()
  return r!
}
const ids = (p: OfficeProps, room: string) => roomOf(p, room).agents.map(a => a.id)
const label = async (ui: Ui, key: string) => (await ui.find({ in: OFFICE_KEY, type: 'Button', key }))?.text
/** The hotkey a Button carries (undefined under COMPACT_BELOW). */
const hotkeyOf = async (ui: Ui, key: string) => (await ui.find({ in: OFFICE_KEY, type: 'Button', key }))?.props.hotkey

/** The module's drawn tree: its children (the chrome lines, the settings | drawer, then the spacer and the window's cards). */
async function kidsOf(ui: Ui): Promise<Drawn[]> {
  return elements((await ui.drawn({ in: OFFICE_KEY })) as unknown as Drawn)
}
/** The settings popover | the drawer: the module's keyed framed Boxes. */
const isOverlay = (k: Drawn) => k.type === 'Box' && propsOf(k).borderStyle !== undefined && propsOf(k).key !== undefined
async function overlay(ui: Ui): Promise<Drawn | undefined> {
  return (await kidsOf(ui)).find(isOverlay)
}
const isNode = (n: unknown): n is Drawn => typeof n === 'object' && n !== null && 'type' in n
function textOf(n: Drawn | string | null | undefined): string {
  return typeof n === 'string' ? n : isNode(n) ? (n.children ?? []).map(textOf).join('') : ''
}
const nodesOf = (n: unknown): Drawn[] => (isNode(n) ? [n, ...(n.children ?? []).flatMap(nodesOf)] : [])
/** The element children of a node (the kit's tree may hold strings and holes among them). */
const elements = (n: Drawn | undefined): Drawn[] => (n?.children ?? []).filter(isNode)
/** The room cards drawn, in order: the framed Boxes in the cards' style without a key, and the frameless FRAGMENT of the window's first card under an overlay at the window's top (THE OVERLAY IN VIEW). */
async function cardsOf(ui: Ui): Promise<Drawn[]> {
  return (await kidsOf(ui)).filter(k => k.type === 'Box' && ((propsOf(k).borderStyle === 'round' && propsOf(k).borderColor === CARD_BORDER && propsOf(k).key === undefined) || propsOf(k).key === 'fragment'))
}
const isFragment = (card: Drawn) => propsOf(card).key === 'fragment'
/** The window of layout lines the module drew for `p` — what the pointer answers on (office-chrome.ts windowOf, office-layout.ts trimWindow). */
function windowNow(p: OfficeProps): { from: number; count: number } {
  const m = officeModel(p)
  const w = windowOf(chromeRows(p), p.offset, p.rows, m.lines.length, overlayRows(p))
  return trimWindow(m, w.from, w.count, WINDOW_ROWS)
}
/** The rooms whose card the window touches, in the props' order: the cards drawn (a card per room, the first a fragment under an overlay at the window's top). */
function touched(p: OfficeProps): RoomView[] {
  const { from, count } = windowNow(p)
  return officeModel(p).rooms.filter(r => r.top < from + count && r.top + r.height > from)
}
/** The card of `room` as drawn (the cards come in the props' order, the rooms the window touches alone). */
async function cardOf(ui: Ui, p: OfficeProps, room: string): Promise<Drawn> {
  const i = touched(p).findIndex(r => r.id === room)
  expect(i, `room ${room} in the window`).toBeGreaterThanOrEqual(0)
  const card = (await cardsOf(ui))[i]
  expect(card, `card of ${room}`).toBeDefined()
  return card!
}
/** The parts of a WHOLE card: the title line's pin Text (drawn only for a pinned or hovered room), its title and counts Boxes, the more line under it, the table block. */
function partsOf(card: Drawn): { pin: Drawn | undefined; title: Drawn; counts: Drawn; table: Drawn; more: Drawn | undefined } {
  expect(isFragment(card), 'a whole card').toBe(false)
  // (the more line DIRECTLY UNDER THE TITLE when the card has one: live check 7, Q3)
  const parts = elements(card)
  const [titleLine, more, , table] = parts.length === 4 ? parts : [parts[0], undefined, parts[1], parts[2]]
  const kids = elements(titleLine)
  const pin = kids.find(n => n.type === 'Text')
  const [title, counts] = kids.filter(n => n.type === 'Box')
  return { pin, title: title!, counts: counts!, table: table!, more }
}
/** The table of a card or a fragment: the Box of column Boxes, wherever it sits in the card (undefined when no row of it is in the window: a spacer, or nothing). */
function tableOf(card: Drawn): Drawn | undefined {
  return nodesOf(card).find(n => n.type === 'Box' && elements(n).length > 0 && (n.children ?? []).every(c => isNode(c) && propsOf(c).flexDirection === 'column'))
}
/** The texts of a card's drawn rows, one array per row: [status, who, model?, act emoji, word?, task?] — the window's rows only (a column holds one Text per row and nothing else). */
function rowsOf(card: Drawn): string[][] {
  const table = tableOf(card)
  if (!table) return []
  const cols = elements(table).map(col => elements(col).filter(c => c.type === 'Text'))
  return cols[0]!.map((_, i) => cols.map(col => textOf(col[i])))
}
/** The who cell of an agent as the model says the row reads (`${emoji} ${name}`). */
function whoOf(p: OfficeProps, id: string): string {
  const row = officeModel(p).rooms.flatMap(r => r.rows).find(r => r.id === id)
  expect(row, id).toBeDefined()
  return row!.who
}
/** The agents (by their who cell) whose drawn row carries the keyboard focus marker. */
async function focused(ui: Ui, p: OfficeProps): Promise<string[]> {
  const mark = p.rtl ? FOCUS_MARK.rtl : FOCUS_MARK.ltr
  return (await cardsOf(ui)).flatMap(c => rowsOf(c).filter(r => r[0]!.includes(mark)).map(r => r[1]!))
}
/** How a room's card draws its 📌: bright (pinned), dim (the hover affordance), or not at all (no pin cell: the title flush at the reading edge). */
async function pinOf(ui: Ui, p: OfficeProps, room: string): Promise<'bright' | 'dim' | 'none'> {
  const { pin } = partsOf(await cardOf(ui, p, room))
  if (!pin || !textOf(pin).includes(PIN)) return 'none'
  return propsOf(pin).dimColor === true ? 'dim' : 'bright'
}
/** The texts of a room's card: its title, its counts, its more line ('' when none). */
async function headOf(ui: Ui, p: OfficeProps, room: string): Promise<{ title: string; counts: string; more: string }> {
  const { title, counts, more } = partsOf(await cardOf(ui, p, room))
  return { title: textOf(title), counts: textOf(counts), more: more ? textOf(more) : '' }
}
/** The global constraints on what is drawn: a card per room the window touches, the rows drawn the line map's rows in the window, every row's cells one Text each, nothing a surface refuses, no tint. */
async function rowsOk(ui: Ui, p: OfficeProps): Promise<void> {
  const cards = await cardsOf(ui)
  const m = officeModel(p)
  const w = windowNow(p)
  expect(cards.length).toBe(touched(p).length)
  expect(cards.reduce((n, c) => n + rowsOf(c).length, 0)).toBe(m.lines.slice(w.from, w.from + w.count).filter(l => l.kind === 'row').length)
  for (const card of cards) {
    if (!isFragment(card)) {
      const { title, counts } = partsOf(card)
      expect(propsOf(title).height).toBe(1)
      expect(textOf(title)).not.toMatch(REFUSED_RE)
      expect(textOf(counts)).toMatch(/^🟢\d+/)
    }
    for (const row of rowsOf(card)) {
      expect(row.length).toBeGreaterThanOrEqual(3)   // status, who, the emoji; the model, the word and the task when the mode and the width have them
      expect(row.length).toBeLessThanOrEqual(6)
      for (const v of row) { expect(v).not.toMatch(REFUSED_RE); expect(v).not.toMatch(/\n|⏱|′/) }
    }
    // a column holds its rows' Texts alone (no Box per value), each a one-line Text
    const table = tableOf(card)
    if (table) for (const col of elements(table)) expect(elements(col).every(c => c.type === 'Text' && propsOf(c).wrap === 'truncate')).toBe(true)
  }
  expect((await ui.findAll({ in: OFFICE_KEY })).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
}

/** The layout hit `kind`/`id` of the props as drawn (a row, a room's pin zone, its ✅ counts, its "more finished" line). */
function hitOf(p: OfficeProps, kind: Hit['kind'], id: string): Hit {
  const hit = officeModel(p).hits.find(h => h.kind === kind && h.id === id)
  expect(hit, `${kind} ${id}`).toBeDefined()
  return hit!
}
/** A left click inside the Client on the middle of the layout hit, where the module draws it: the column's cell past the centring margin (from CENTRE_AT). */
async function click(ui: Ui, kind: Hit['kind'], id: string): Promise<void> {
  const p = await officeProps(ui)
  const hit = hitOf(p, kind, id)
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: geometry(p.columns).margin + hit.x + Math.floor(hit.w / 2), y: chromeRows(p) + hit.y, button: 'left' })
  // (a pin keeps the cards where they are until the pointer leaves the office — live check 7, Q4: office-buttons.test.ts — so
  // these tests, which read the cards in the props' order, let it leave)
  if (kind === 'pin') await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
}
/** The pointer moved over the layout hit: a pin's zone, or the LINE of any other hit (the column's middle cell). */
async function moveOver(ui: Ui, kind: Hit['kind'], id: string): Promise<void> {
  const p = await officeProps(ui)
  const hit = hitOf(p, kind, id)
  const geo = geometry(p.columns)
  // (a pin: the middle of its zone — the hover zone is the hit zone, live check 7 R9; any other line: the column's middle cell)
  await ui.pointer({ in: OFFICE_KEY, type: 'move', x: geo.margin + (kind === 'pin' ? hit.x + Math.floor(hit.w / 2) : Math.floor(geo.W / 2)), y: chromeRows(p) + hit.y })
}
/** A left click inside the Client at the column's middle cell of Client row `y`. */
async function clickRow(ui: Ui, y: number): Promise<void> {
  const geo = geometry((await officeProps(ui)).columns)
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: geo.margin + Math.floor(geo.W / 2), y, button: 'left' })
}
/** A click on Client row `y` (at cell `x`, the column's middle when not given) that must change nothing: the props after it are the props before it. */
async function deadRow(ui: Ui, y: number, why: string, x?: number): Promise<void> {
  const before = JSON.stringify(await officeProps(ui))
  if (x === undefined) await clickRow(ui, y)
  else await ui.pointer({ in: OFFICE_KEY, type: 'down', x, y, button: 'left' })
  expect(JSON.stringify(await officeProps(ui)), why).toBe(before)
}

/** Every control at one width: the tests below, each named by its width, over `mountOffice` at that width and the width's table. */
function suite(COLUMNS: Columns): void {
  const W: Width = WIDTHS[COLUMNS]
  const GEO = geometry(COLUMNS)
  /** The pin zone's cells at this width. */
  const PIN_ZONE = pinZone(GEO)
  const PANE = paneAt(COLUMNS, { offset: 0, bodyRows: ROWS })
  const t = (name: string, fn: ($: Engine, on: On) => Promise<void>) => test(`${COLUMNS} columns · ${name}`, { timeoutMs: 30_000 }, fn)
  /** The a1 row as a table mode draws it: the mark, the who, the model (its version when `full`), the emoji, the word when the mode has it, the task from CENTRE_AT. */
  const a1RowIn = (p: OfficeProps, mode: TableMode, word: string): string[] =>
    ['●', whoOf(p, 'a1'), ...(mode.model === 'none' ? [] : [mode.model === 'full' ? nb('Opus 5.5') : 'Opus']), '📖', ...(mode.word ? [word] : []), ...(GEO.centred ? [nb('Task of a1.')] : [])]

  /** The pane mounted on the desktop over `agents` (the fixture unless given), the poll run once, the Client sized to this width; `scroll` the pane's window (the top of a 30-row body unless given). */
  async function mountOffice($: Engine, on: On, agents: () => Agent[] = fixture, scroll: { offset: number; bodyRows: number } = PANE.props.scroll) {
    const { captured, clock } = beneath(on, agents, PREFS())
    await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
    await clock.advance(POLL_MS)
    const ui = await $.ui.mount(paneAt(COLUMNS, scroll))
    await ui.resize({ in: OFFICE_KEY, columns: COLUMNS, rows: scroll.bodyRows })
    return { ui, captured, clock }
  }

  // ---------------------------------------------------------------------------
  // the width
  // ---------------------------------------------------------------------------

  t('THE WIDTH as mounted (the table above): the toolbar\'s three labels in words or the icons alone, the hotkeys on the Buttons from COMPACT_BELOW, the reading column (the module\'s root Box: frozen at 100 cells and centred by its margin from CENTRE_AT, where a click without the margin lands on nothing), the table mode (the model column, the activity word, the task column: so many Texts per row), the room counts, the settings\' labels, hotkeys and rows', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    expect(p0.columns).toBe(COLUMNS)
    expect([GEO.W, GEO.margin]).toEqual([W.column, W.margin])
    // the toolbar
    expect([await label(ui, 'showDone'), await label(ui, 'mute'), await label(ui, 'help')]).toEqual(W.toolbar)
    expect([await hotkeyOf(ui, 'showDone'), await hotkeyOf(ui, 'mute'), await hotkeyOf(ui, 'help')]).toEqual(W.hotkeys ? ['f', 'm', 'h'] : [undefined, undefined, undefined])
    expect(chromeRows(p0)).toBe(CHROME_ROWS_MIN)   // six agents shown: no search field at any width
    // the reading column: the module's root Box, its margin and width from CENTRE_AT
    const root = (await ui.drawn({ in: OFFICE_KEY })) as unknown as Drawn
    expect(root.type).toBe('Box')
    expect(propsOf(root).marginLeft ?? 0).toBe(W.margin)
    expect(propsOf(root).width ?? COLUMNS).toBe(W.column)
    // the table mode on the fixture, and the Texts per row it makes
    const m = officeModel(p0)
    expect([m.mode.model, m.mode.word, m.geo.centred]).toEqual([W.model, W.word, W.task])
    const cells = 3 + (W.model === 'none' ? 0 : 1) + (W.word ? 1 : 0) + (W.task ? 1 : 0)
    for (const card of await cardsOf(ui)) for (const row of rowsOf(card)) expect(row, row.join('|')).toHaveLength(cells)
    const a1 = rowsOf(await cardOf(ui, p0, SA)).find(r => r[1] === whoOf(p0, 'a1'))
    expect(a1).toEqual(a1RowIn(p0, m.mode, 'קורא'))
    // the room counts: A's ✅ dropped at 36 (the title keeps TITLE_MIN cells), B's 🟢 alone (no finished)
    expect((await headOf(ui, p0, SA)).counts).toBe(nb(W.countsA))
    expect((await headOf(ui, p0, SB)).counts).toBe(nb('🟢1'))
    expect((await headOf(ui, p0, SA)).title).toBe(nb(TITLE_A))
    await rowsOk(ui, p0)
    // the pointer counts the margin: a click where B's pin zone lies in the column's cells, without the margin, pins nothing
    // (at 120 it lands in the title's field; at 36 and 53 the margin of 1 leaves the same click in the pin zone — so it is tried
    // only with a margin wider than half the zone); a click in the left margin is no row at every width
    if (W.margin > PIN_ZONE / 2) {
      const pin = hitOf(p0, 'pin', SB)
      await deadRow(ui, chromeRows(p0) + pin.y, 'the pin zone without the margin', pin.x + Math.floor(pin.w / 2))
      expect((captured.store.prefs as Prefs).pins).toEqual([])
    }
    expect(W.margin).toBeGreaterThanOrEqual(1)
    await deadRow(ui, chromeRows(p0) + hitOf(p0, 'agent', 'a1').y, 'a row\'s line, in the left margin', W.margin - 1)
    // the settings' labels, hotkeys and rows
    expect(helpRows(COLUMNS)).toBe(W.helpRows)
    await ui.press({ key: 'help' })
    expect([await label(ui, 'demo'), await label(ui, 'lang')]).toEqual(W.settings)
    expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'still' })).toBeUndefined()   // (no motion toggle: live check 7, Q9)
    expect([await hotkeyOf(ui, 'demo'), await hotkeyOf(ui, 'lang')]).toEqual(W.hotkeys ? ['d', 'l'] : [undefined, undefined])
    expect(propsOf((await overlay(ui))!).height).toBe(W.helpRows)
    expect(await hotkeyOf(ui, 'closeHelp')).toBe('x')   // (as the drawer's close: live check 7, R9)
    await ui.unmount()
  })

  // ---------------------------------------------------------------------------
  // the toolbar
  // ---------------------------------------------------------------------------

  t('☐ showDone: the Button flips prefs.showDone (mirrored to $.store), the box reads ☑, room A draws every finished agent and its line reads הסתר שסיימו; pressed again, the recent three and עוד 1 שסיימו are back', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    expect(p0.prefs.showDone).toBe(false)
    expect(await label(ui, 'showDone')).toBe(W.toolbar[0])
    expect(ids(p0, SA)).toEqual(DRAWN_A)
    expect(roomOf(p0, SA)).toMatchObject({ showDone: false, moreDone: 1, moreLabel: MORE_LABEL })
    expect((await headOf(ui, p0, SA)).more).toBe(MORE_LINE)
    expect(rowsOf(await cardOf(ui, p0, SA)).map(r => r[1])).toEqual(DRAWN_A.map(id => whoOf(p0, id)))
    await ui.press({ key: 'showDone' })
    const p1 = await officeProps(ui)
    expect(p1.prefs.showDone).toBe(true)
    expect((captured.store.prefs as Prefs).showDone).toBe(true)
    expect(await label(ui, 'showDone')).toBe(W.toolbar[0].replace('☐', '☑'))
    expect(ids(p1, SA)).toEqual(ALL_A)
    expect(roomOf(p1, SA)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
    expect((await headOf(ui, p1, SA)).more).toBe(HIDE_LINE)
    expect(rowsOf(await cardOf(ui, p1, SA)).map(r => r[1])).toEqual(ALL_A.map(id => whoOf(p1, id)))
    expect(p1.counts).toEqual(p0.counts)   // the header counts the whole office either way
    await rowsOk(ui, p1)
    await ui.press({ key: 'showDone' })
    const p2 = await officeProps(ui)
    expect(p2.prefs.showDone).toBe(false)
    expect((captured.store.prefs as Prefs).showDone).toBe(false)
    expect(ids(p2, SA)).toEqual(DRAWN_A)
    expect(roomOf(p2, SA).moreLabel).toBe(MORE_LABEL)
    expect(await label(ui, 'showDone')).toBe(W.toolbar[0])
    await ui.unmount()
  })

  t('🔔 mute: the Button flips prefs.muted (mirrored to $.store) and reads 🔕; pressed again, 🔔', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    expect((await officeProps(ui)).prefs.muted).toBe(false)
    expect(await label(ui, 'mute')).toBe(W.toolbar[1])
    await ui.press({ key: 'mute' })
    expect((await officeProps(ui)).prefs.muted).toBe(true)
    expect((captured.store.prefs as Prefs).muted).toBe(true)
    expect(await label(ui, 'mute')).toBe(W.toolbar[1].replace('🔔', '🔕'))
    await ui.press({ key: 'mute' })
    expect((await officeProps(ui)).prefs.muted).toBe(false)
    expect((captured.store.prefs as Prefs).muted).toBe(false)
    expect(await label(ui, 'mute')).toBe(W.toolbar[1])
    await ui.unmount()
  })

  t('⚙️ settings: the Button opens the settings popover (view.helpOpen: the framed Box titled הגדרות with the demo / lang Buttons and the shortcut rows, the chrome taller by its rows and the gap, the cards under it as they were); its ✕ closes it; h opens and closes it too', async ($, on) => {
    // (a pane tall enough for room A's whole card under the popover — its padding lines make it helpRows tall — so the rows compare whole)
    const { ui } = await mountOffice($, on, fixture, { offset: 0, bodyRows: 40 })
    const p0 = await officeProps(ui)
    expect(p0.helpOpen).toBe(false)
    expect(await label(ui, 'help')).toBe(W.toolbar[2])
    expect(await overlay(ui)).toBeUndefined()
    const rowsA = rowsOf(await cardOf(ui, p0, SA))
    await ui.press({ key: 'help' })
    const p1 = await officeProps(ui)
    expect(p1.helpOpen).toBe(true)
    expect(chromeRows(p1)).toBe(fixedRows(p1) + W.helpRows + OVERLAY_GAP)
    const help = await overlay(ui)
    expect(help).toMatchObject({ type: 'Box', props: { key: 'help', borderStyle: 'round', borderColor: CARD_BORDER, height: W.helpRows, marginBottom: OVERLAY_GAP } })
    expect(textOf(help!)).toMatch(/הגדרות/)
    expect(textOf(help!)).toContain(nb('k / j'))   // (the shortcuts' column-major table: no plain space in a row)
    expect(textOf(help!)).not.toMatch(/עזרה|קיצורי מקלדת|Esc/)
    for (const k of ['demo', 'lang', 'closeHelp']) expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: k }), k).toBeDefined()
    expect(rowsOf(await cardOf(ui, p1, SA))).toEqual(rowsA)
    await ui.press({ key: 'closeHelp' })
    expect((await officeProps(ui)).helpOpen).toBe(false)
    expect(await overlay(ui)).toBeUndefined()
    for (const k of ['demo', 'lang', 'closeHelp']) expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: k }), k).toBeUndefined()
    await ui.key({ in: OFFICE_KEY, key: 'h' })
    expect((await officeProps(ui)).helpOpen).toBe(true)
    expect(await overlay(ui)).toBeDefined()
    await ui.key({ in: OFFICE_KEY, key: 'h' })
    expect((await officeProps(ui)).helpOpen).toBe(false)
    expect(await overlay(ui)).toBeUndefined()
    await ui.unmount()
  })

  // ---------------------------------------------------------------------------
  // the settings popover's Buttons (and their letters with the popover closed)
  // ---------------------------------------------------------------------------

  t('🎬 demo: the settings\' Button starts the demo (view.demo): the demo cast\'s two rooms fill the office and THE DEMO LINE under the header says so (live check 5: the chrome a row taller, every click still on its row); the cast obeys show finished as the office does — ☐ and the finished held back while the pref is off, ☑ and all of them with it on, a room\'s ✅ toggling that room — prefs.showDone never touched by the demo itself; the line\'s exit Button and the settings\' Button end it, the fixture back; closed, d does the same', async ($, on) => {
    const { ui, captured, clock } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    expect(p0.demo).toBe(false)
    expect(p0.rooms.map(r => r.id)).toEqual([SA, SB])
    expect(await ui.find({ in: OFFICE_KEY, key: 'exitDemo' })).toBeUndefined()
    await ui.press({ key: 'help' })
    expect(await label(ui, 'demo')).toBe(W.settings[0])
    await ui.press({ key: 'demo' })
    const p1 = await officeProps(ui)
    expect(p1.demo).toBe(true)
    expect(p1.helpOpen).toBe(true)   // the demo leaves the settings as they were
    expect(p1.rooms.map(r => r.id).sort()).toEqual(DEMO_ROOMS)
    expect(p1.rooms.flatMap(r => r.agents).length).toBeGreaterThanOrEqual(8)
    // the demo line: its note (the longest that fits this width) and its exit Button; the chrome a row taller
    expect(await label(ui, 'exitDemo')).toBe(I18N.he.demoExit)
    expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: new RegExp(`^${nb(demoLine(p1).note)}$`) })).toBeDefined()
    expect(demoLine(p1).note).toBe(W.demoNote)
    expect(fixedRows(p1)).toBe(fixedRows({ ...p1, demo: false }) + DEMO_ROWS)
    // the cast obeys the pref (off): no room shows every finished, the box reads ☐, the store untouched
    expect(p1.prefs.showDone).toBe(false)
    expect(p1.rooms.every(r => !r.showDone)).toBe(true)
    expect((captured.store.prefs as Prefs).showDone).toBe(false)
    expect(await label(ui, 'showDone')).toBe(W.toolbar[0])
    expect(await label(ui, 'demo')).toBe(W.exitDemo)
    await rowsOk(ui, p1)
    await ui.press({ key: 'closeHelp' })
    // THE RECENT FINISHED in the demo (pre-check 6: ☐ → ☑ must change what the demo draws): the research room holds
    // RECENT_DONE + 2 finished — it draws the RECENT_DONE most recent, its more line counts the other two, which are NOT drawn
    const pOff = await officeProps(ui)
    expect(DEMO_HELD.length).toBe(2)
    expect(roomOf(pOff, DEMO_S2)).toMatchObject({ showDone: false, moreDone: DEMO_HELD.length, moreLabel: I18N.he.moreDoneN(DEMO_HELD.length) })
    expect(roomOf(pOff, DEMO_S2).agents.filter(a => a.status === 'done').map(a => a.id)).toEqual(DEMO_DONE.slice(0, RECENT_DONE))
    for (const id of DEMO_HELD) {
      expect(ids(pOff, DEMO_S2), id).not.toContain(id)
      expect(officeModel(pOff).hits.some(h => h.kind === 'agent' && h.id === id), id).toBe(false)
    }
    expect((await headOf(ui, pOff, DEMO_S2)).more).toBe(nb(`▸ ${I18N.he.moreDoneN(DEMO_HELD.length)}`))
    await rowsOk(ui, pOff)
    // a click on a demo row opens that row (the line map under the taller chrome)
    await click(ui, 'agent', 'demo-mcp-dd')
    expect((await officeProps(ui)).drawer?.id).toBe('demo-mcp-dd')
    await ui.press({ key: 'close' })
    // a room's more line: that room shows its finished (the override in the store), as a real room's does
    await click(ui, 'moreDone', DEMO_S2)
    expect(captured.store.roomDone).toEqual({ [DEMO_S2]: true })
    expect(roomOf(await officeProps(ui), DEMO_S2).showDone).toBe(true)
    await click(ui, 'moreDone', DEMO_S2)
    expect(captured.store.roomDone).toEqual({})
    // ☐ → ☑: every demo room shows its finished; and back
    await ui.press({ key: 'showDone' })
    const p2 = await officeProps(ui)
    expect(p2.prefs.showDone).toBe(true)
    expect(p2.rooms.every(r => r.showDone)).toBe(true)
    expect(p2.rooms.flatMap(r => r.agents).some(a => a.id === 'demo-writer-ff')).toBe(true)
    // the two the room held back are drawn now, its more line the hide line
    expect(roomOf(p2, DEMO_S2)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
    expect(roomOf(p2, DEMO_S2).agents.filter(a => a.status === 'done').map(a => a.id)).toEqual(DEMO_DONE)
    for (const id of DEMO_HELD) expect(officeModel(p2).hits.some(h => h.kind === 'agent' && h.id === id), id).toBe(true)
    expect((await headOf(ui, p2, DEMO_S2)).more).toBe(HIDE_LINE)
    expect(await label(ui, 'showDone')).toBe(W.toolbar[0].replace('☐', '☑'))
    await rowsOk(ui, p2)
    await ui.press({ key: 'showDone' })
    expect((await officeProps(ui)).rooms.every(r => !r.showDone)).toBe(true)
    for (const id of DEMO_HELD) expect(ids(await officeProps(ui), DEMO_S2), id).not.toContain(id)
    // the demo line's exit Button ends the demo: the fixture is back, the line gone (the switch's publish: the render kick's
    // poll, which a tick's poll in flight defers — settled here, as ui.test.ts's demo test does)
    await ui.press({ key: 'exitDemo' })
    await clock.settle()
    const p3 = await officeProps(ui)
    expect(p3.demo).toBe(false)
    expect(p3.rooms.map(r => r.id)).toEqual([SA, SB])
    expect(ids(p3, SA)).toEqual(DRAWN_A)
    expect(await ui.find({ in: OFFICE_KEY, key: 'exitDemo' })).toBeUndefined()
    expect(fixedRows(p3)).toBe(fixedRows(p0))
    // the settings' Button too, and closed, the letter
    await ui.press({ key: 'help' })
    await ui.press({ key: 'demo' })
    expect((await officeProps(ui)).demo).toBe(true)
    await ui.press({ key: 'demo' })
    await clock.settle()
    expect((await officeProps(ui)).demo).toBe(false)
    expect(await label(ui, 'demo')).toBe(W.settings[0])
    await ui.press({ key: 'closeHelp' })
    expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'demo' })).toBeUndefined()
    await ui.key({ in: OFFICE_KEY, key: 'd' })
    expect((await officeProps(ui)).demo).toBe(true)
    expect((await officeProps(ui)).rooms.map(r => r.id).sort()).toEqual(DEMO_ROOMS)
    await ui.key({ in: OFFICE_KEY, key: 'd' })
    await clock.settle()
    expect((await officeProps(ui)).demo).toBe(false)
    expect((await officeProps(ui)).rooms.map(r => r.id)).toEqual([SA, SB])
    await ui.unmount()
  })

  t('🎞 still is GONE (live check 7, Q9: nothing read it): no still Button in the settings, and s changes nothing (no write, the props as they were)', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    await ui.press({ key: 'help' })
    expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'still' })).toBeUndefined()
    await ui.press({ key: 'closeHelp' })
    const before = JSON.stringify(await officeProps(ui))
    const writes = { ...captured.writes }
    await ui.key({ in: OFFICE_KEY, key: 's' })
    expect(JSON.stringify(await officeProps(ui))).toBe(before)
    expect(captured.writes).toEqual(writes)
    await ui.unmount()
  })

  t('🌐 language: the settings\' Button switches to English (prefs.lang mirrored, the pane retitled): rtl off, every label English (in this width\'s form), the pin zone at the left edge, the rows reading left to right in the mode the English names leave; pressed again, Hebrew; closed, l does the same', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    expect([p0.lang, p0.rtl]).toEqual(['he', true])
    expect(hitOf(p0, 'pin', SA).x).toBe(GEO.W - PIN_ZONE)
    await ui.press({ key: 'help' })
    expect(await label(ui, 'lang')).toBe(W.settings[1])
    await ui.press({ key: 'lang' })
    const p1 = await officeProps(ui)
    expect([p1.lang, p1.rtl]).toEqual(['en', false])
    expect((captured.store.prefs as Prefs).lang).toBe('en')
    expect(captured.opens[captured.opens.length - 1]).toBe('🟢 3 · 🎭 Theater')
    expect(p1.helpOpen).toBe(true)
    expect([await label(ui, 'demo'), await label(ui, 'lang')]).toEqual(W.settingsEn)
    expect([await label(ui, 'showDone'), await label(ui, 'mute'), await label(ui, 'help')]).toEqual(W.toolbarEn)
    expect(p1.labels.settingsTitle).toBe('Settings')
    expect(roomOf(p1, SA).moreLabel).toBe('1 more finished')
    expect(roomOf(p1, SA).agents.find(a => a.id === 'a1')?.act).toBe('📖 Reading')
    expect(roomOf(p1, SA).agents.find(a => a.id === 'a1')?.name).toBe(personaName(7, 'en'))
    expect(hitOf(p1, 'pin', SA).x).toBe(0)
    // the row in the mode the English names leave the office (wider than the Hebrew ones: the word, then the model column, go
    // before the names are cut — office-layout.ts chooseMode, chosen afresh: the names moved the widest values, so the Hebrew
    // mode's token is no hysteresis here, ModeToken): the mark alone at the left edge, the who, the model (its version from
    // MODEL_FULL_FROM), the emoji, the word when the mode has it, the task from CENTRE_AT
    const m0 = officeModel(p0)
    expect(m0.mode).toMatchObject({ model: W.model, word: W.word })
    const m1 = officeModel(p1, NO_DECOR, undefined, m0.token)
    expect(m1.mode).toEqual(officeModel(p1).mode)
    expect(rowsOf(await cardOf(ui, p1, SA)).find(r => r[1] === whoOf(p1, 'a1'))).toEqual(a1RowIn(p1, m1.mode, 'Reading'))
    expect(whoOf(p1, 'a1')).toBe(nb(`${PERSONA_EMOJI[3]} ${personaName(7, 'en')}`))   // (the fixture's agents all carry persona 3's emoji: `agent()`; the English name whole at every width — 11 cells, under the narrowest cap)
    expect(m1.mode.rank).toBeGreaterThanOrEqual(m0.mode.rank)   // never richer than the Hebrew office's
    expect((await headOf(ui, p1, SA)).more).toBe(nb('▸ 1 more finished'))
    await rowsOk(ui, p1)
    await ui.press({ key: 'lang' })
    const p2 = await officeProps(ui)
    expect([p2.lang, p2.rtl]).toEqual(['he', true])
    expect((captured.store.prefs as Prefs).lang).toBe('he')
    expect(captured.opens[captured.opens.length - 1]).toBe('🟢 3 · 🎭 התיאטרון')
    expect(await label(ui, 'lang')).toBe(W.settings[1])
    expect(await label(ui, 'showDone')).toBe(W.toolbar[0])
    expect(roomOf(p2, SA).agents.find(a => a.id === 'a1')?.name).toBe(personaName(7, 'he'))
    // THE HYSTERESIS is about the width (office-layout.ts ModeToken): the names moved the widest values again, so the Hebrew
    // mode is back at once at every width — at 36 the model column with it (the English rank held it dropped before this fix:
    // one cell to spare), the rows four Texts as before the round trip
    const m2 = officeModel(p2, NO_DECOR, undefined, m1.token)
    expect(m2.mode).toEqual(m0.mode)
    expect(rowsOf(await cardOf(ui, p2, SA)).find(r => r[1] === whoOf(p2, 'a1'))).toEqual(a1RowIn(p2, m2.mode, 'קורא'))
    await ui.press({ key: 'closeHelp' })
    await ui.key({ in: OFFICE_KEY, key: 'l' })
    expect((await officeProps(ui)).lang).toBe('en')
    expect(await label(ui, 'help')).toBe(W.toolbarEn[2])
    await ui.key({ in: OFFICE_KEY, key: 'l' })
    expect((await officeProps(ui)).lang).toBe('he')
    expect(await label(ui, 'help')).toBe(W.toolbar[2])
    await ui.unmount()
  })

  // ---------------------------------------------------------------------------
  // the card's title line
  // ---------------------------------------------------------------------------

  t('📌 pin: the pointer over an unpinned card\'s title line draws a dim 📌 at its pin cell (off the line, nothing; no post); a click in the pin zone pins the room (prefs.pins mirrored), which moves to the top with a bright 📌, hovered or not; a click there again unpins it', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    expect(p0.rooms.map(r => [r.id, r.pinned])).toEqual([[SA, false], [SB, false]])
    const headB = hitOf(p0, 'pin', SB)
    expect(headB.x).toBe(GEO.W - PIN_ZONE)   // RTL: the pin zone at the column's right edge
    expect(await pinOf(ui, p0, SB)).toBe('none')
    expect((await headOf(ui, p0, SB)).title).not.toContain('○')
    expect((await headOf(ui, p0, SA)).title).toBe(nb(TITLE_A))
    // the hover: a dim 📌 on B's card alone, the props untouched, nothing written
    const writes = { ...captured.writes }
    const stores = { ...captured.storeWrites }
    await moveOver(ui, 'pin', SB)
    expect(await pinOf(ui, p0, SB)).toBe('dim')
    expect(await pinOf(ui, p0, SA)).toBe('none')
    expect(JSON.stringify(await officeProps(ui))).toBe(JSON.stringify(p0))
    expect(captured.writes).toEqual(writes)
    expect(captured.storeWrites).toEqual(stores)
    // off the title line, over b1's row: the affordance goes (and no row is tinted: there is no row hover)
    await moveOver(ui, 'agent', 'b1')
    expect(await pinOf(ui, p0, SB)).toBe('none')
    expect((await ui.findAll({ in: OFFICE_KEY, type: 'Box' })).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
    await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
    // the click in the pin zone
    await click(ui, 'pin', SB)
    const p1 = await officeProps(ui)
    expect((captured.store.prefs as Prefs).pins).toEqual([SB])
    expect(p1.rooms.map(r => [r.id, r.pinned])).toEqual([[SB, true], [SA, false]])
    expect(hitOf(p1, 'pin', SB).y).toBe(2)   // the first card's title line
    expect(await pinOf(ui, p1, SB)).toBe('bright')
    expect((await headOf(ui, p1, SB)).title).toContain('research')
    expect(await pinOf(ui, p1, SA)).toBe('none')
    await rowsOk(ui, p1)
    // a pinned card keeps its 📌 bright under the pointer
    await moveOver(ui, 'pin', SB)
    expect(await pinOf(ui, p1, SB)).toBe('bright')
    await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
    // unpinned again
    await click(ui, 'pin', SB)
    const p2 = await officeProps(ui)
    expect((captured.store.prefs as Prefs).pins).toEqual([])
    expect(p2.rooms.map(r => [r.id, r.pinned])).toEqual([[SA, false], [SB, false]])
    expect(await pinOf(ui, p2, SB)).toBe('none')
    await ui.unmount()
  })

  t('room counts ✅ are READ-ONLY (live check 7, Q6: the more line under the title is the room\'s one toggle): the title line answers in its pin zone alone, a click on the counts changes nothing (no override, no prefs, the props as they were)', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    expect((await headOf(ui, p0, SA)).counts).toBe(nb(W.countsA))   // (the ✅ dropped at 36)
    const titleA = officeModel(p0).rooms[0]!.titleAt
    expect(officeModel(p0).hits.filter(h => h.y === titleA).map(h => h.kind)).toEqual(['pin'])
    // RTL: the counts at the column's left edge
    await deadRow(ui, chromeRows(p0) + titleA, 'A\'s ✅ counts', GEO.margin + 2)
    expect(captured.store.roomDone ?? {}).toEqual({})
    expect((captured.store.prefs as Prefs).showDone).toBe(false)
    await ui.unmount()
  })

  t('the ▸ עוד N שסיימו line, DIRECTLY UNDER THE TITLE (live check 7, Q3): a click on it shows the room\'s finished (the $.store override, prefs untouched, drawn at once); the line then reads ▾ הסתר שסיימו ON THE SAME LINE, and a click on that hides them again', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    const more = hitOf(p0, 'moreDone', SA)
    expect([more.x, more.w]).toEqual([1, GEO.W - 2])   // the whole line inside the card's frame is the hit (live check 7, R9)
    expect(more.y).toBe(officeModel(p0).rooms[0]!.titleAt + 1)
    expect((await headOf(ui, p0, SA)).more).toBe(MORE_LINE)
    expect(officeModel(p0).hits.some(h => h.kind === 'moreDone' && h.id === SB)).toBe(false)   // room B holds no finished: no such line
    await click(ui, 'moreDone', SA)
    expect(captured.store.roomDone).toEqual({ [SA]: true })
    const p1 = await officeProps(ui)
    expect(ids(p1, SA)).toEqual(ALL_A)
    expect(roomOf(p1, SA)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
    expect(roomOf(p1, SB).showDone).toBe(false)
    expect(p1.prefs.showDone).toBe(false)
    expect(await label(ui, 'showDone')).toBe(W.toolbar[0])
    await rowsOk(ui, p1)
    const hide = hitOf(p1, 'moreDone', SA)
    expect(hide.y).toBe(more.y)   // the same line: the held-back writer is drawn under it, among the rows
    expect((await headOf(ui, p1, SA)).more).toBe(HIDE_LINE)
    await click(ui, 'moreDone', SA)
    const p2 = await officeProps(ui)
    expect(captured.store.roomDone).toEqual({})
    expect(ids(p2, SA)).toEqual(DRAWN_A)
    expect((await headOf(ui, p2, SA)).more).toBe(MORE_LINE)
    await ui.unmount()
  })

  // ---------------------------------------------------------------------------
  // the rows and the drawer
  // ---------------------------------------------------------------------------

  t('row click: a click on an agent row selects it and opens its drawer (view.selected, the card in the cards\' style with the persona, the status line, the task; the row carries the focus marker, no band); the row\'s last cell opens it too, a cell past the column or in the margin nothing; a click on another row moves the drawer there, a second click on the open one closes it', async ($, on) => {
    // (a 40-row body: the drawer is ONE height at a width — its most lines, live check 7 Q2 — and the opened row stays in view under it)
    const { ui, captured } = await mountOffice($, on, fixture, { offset: 0, bodyRows: 40 })
    const p0 = await officeProps(ui)
    expect(p0.drawer).toBeNull()
    expect(p0.selected).toBeNull()
    await click(ui, 'agent', 'a1')
    const p1 = await officeProps(ui)
    expect(p1.selected).toBe('a1')
    expect(p1.drawer).toMatchObject({ id: 'a1', sub: 'map session-token validation', status: 'running', type: 'Explore', task: 'Task of a1.' })
    expect(p1.drawer?.name).toContain(personaName(7, 'he'))
    expect(captured.view).toMatchObject({ selected: 'a1', helpOpen: false, focusIndex: FOCUS_ON_SELECTED })   // (the text cards' focus follows the selection: R2)
    const drawer = await overlay(ui)
    expect(drawer).toMatchObject({ type: 'Box', props: { key: 'drawer', borderStyle: 'round', borderColor: CARD_BORDER, paddingY: 1, height: overlayRows(p1) - OVERLAY_GAP, marginBottom: OVERLAY_GAP } })
    expect(textOf(drawer!)).toMatch(/משימה/)
    expect(textOf(drawer!)).toContain('Task of a1.')
    // THE STATUS LINE (round 8): the word, the clock, the type — cut to the card's inner width at this width (the type past the cut at 36)
    const status = drawerStatus(p1.drawer!, p1.labels, drawerInner(COLUMNS) - 3)
    expect(status).toMatch(/^עובד · זמן \d+ דק׳/)
    expect(status.endsWith('· Explore')).toBe(W.drawerType)
    if (!W.drawerType) expect(status.endsWith('…')).toBe(true)
    expect(textOf(drawer!)).toContain(status)
    expect(chromeRows(p1)).toBe(fixedRows(p1) + overlayRows(p1))
    expect(await focused(ui, p1)).toEqual([whoOf(p1, 'a1')])   // the click's keyboard focus: the marker on its row
    expect((await ui.findAll({ in: OFFICE_KEY, type: 'Box' })).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)   // no selection band
    expect(rowsOf(await cardOf(ui, p1, SA)).map(r => r[1])).toContain(whoOf(p1, 'a1'))
    expect(whoOf(p1, 'a1')).toContain(personaName(7, 'he'))
    // THE CARD'S BOUNDS: a row's hit is the card's inside (live check 7, R9) — its last cell inside the frame opens the row (d1's
    // drawer); the frame's border cell, the cell past the column (the pane's edge, or the right margin from CENTRE_AT) and the
    // left margin's last cell open nothing
    const yD1 = chromeRows(p1) + hitOf(p1, 'agent', 'd1').y
    await deadRow(ui, yD1, 'the border cell beside the row', GEO.margin + GEO.W - 1)
    await ui.pointer({ in: OFFICE_KEY, type: 'down', x: GEO.margin + GEO.W - 2, y: yD1, button: 'left' })
    const pd = await officeProps(ui)
    expect(pd.drawer?.id).toBe('d1')
    const yA1 = chromeRows(pd) + hitOf(pd, 'agent', 'a1').y   // (d1's drawer is taller than a1's: the result's lines — the chrome re-read)
    await deadRow(ui, yA1, 'the cell past the column', GEO.margin + GEO.W)
    if (GEO.margin > 0) await deadRow(ui, yA1, 'the margin\'s last cell', GEO.margin - 1)
    expect((await officeProps(ui)).drawer?.id).toBe('d1')
    // d1 again (by its middle): its drawer is open, so the second click closes it (live check 7, Q2); once more, it opens — the
    // finished one's drawer, with a duration
    await click(ui, 'agent', 'd1')
    expect((await officeProps(ui)).drawer).toBeNull()
    expect((await officeProps(ui)).selected).toBeNull()
    await click(ui, 'agent', 'd1')
    const p2 = await officeProps(ui)
    expect(p2.selected).toBe('d1')
    expect(p2.drawer).toMatchObject({ id: 'd1', status: 'done', sub: 'write part 1', result: 'Done.' })
    expect(textOf((await overlay(ui))!)).toMatch(/סיים/)
    expect(textOf((await overlay(ui))!)).toMatch(/משך \d+ דק׳/)
    expect(await focused(ui, p2)).toEqual([whoOf(p2, 'd1')])
    await ui.unmount()
  })

  t('drawer ✕: the Button closes the drawer (view.selected null, the chrome back to its fixed rows); the keyboard focus stays on the row', async ($, on) => {
    const { ui } = await mountOffice($, on)
    await click(ui, 'agent', 'a1')
    expect((await officeProps(ui)).drawer?.id).toBe('a1')
    expect(await label(ui, 'close')).toBe('סגירה ✕')   // (read ✕ then the word: the ✕ trails the Hebrew word — iconLabel; never an icon alone)
    expect(await hotkeyOf(ui, 'close')).toBe('x')
    await ui.press({ key: 'close' })
    const p1 = await officeProps(ui)
    expect(p1.drawer).toBeNull()
    expect(p1.selected).toBeNull()
    expect(await overlay(ui)).toBeUndefined()
    expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'close' })).toBeUndefined()
    expect(chromeRows(p1)).toBe(fixedRows(p1))
    expect(await focused(ui, p1)).toEqual([whoOf(p1, 'a1')])
    await ui.unmount()
  })

  // ---------------------------------------------------------------------------
  // the search
  // ---------------------------------------------------------------------------

  t('🔍 search field (spec 2026-10-10 §2 item 22): the fixture\'s six shown agents (seven, one finished held back) draw no search field — the chrome is four rows', async ($, on) => {
    const { ui } = await mountOffice($, on)
    const pf = await officeProps(ui)
    expect(pf.rooms.flatMap(r => r.agents)).toHaveLength(6)
    expect(await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' })).toBeUndefined()
    expect(chromeRows(pf)).toBe(CHROME_ROWS_MIN)
    expect((await kidsOf(ui)).map(k => propsOf(k).key)).not.toContain('searchLine')
    await rowsOk(ui, pf)
    await ui.unmount()
  })

  t('🔍 search (spec 2026-10-10 §2 item 22): with seven more agents in room B the office shows more than SEARCH_FROM and draws the field (on its own line under ONE_LINE_FROM, beside the toolbar from it); the typed text reaches view.search after the debounce and narrows the office to the matching agents (the header counts unchanged; the field stays while the search is active); a text nobody matches shows the no-match office; Enter on an empty field clears it and every room is back', async ($, on) => {
    const input = async () => (await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))
    const { ui } = await mountOffice($, on, () => [...fixture(), ...EXTRA.map(id => agent({ id, role: 'extra work', session: SB.slice(0, 8), session_full: SB, project: '/home/dev/research', cwd: '/home/dev/research', persona_id: 15 }))])
    const p0 = await officeProps(ui)
    expect(p0.rooms.flatMap(r => r.agents)).toHaveLength(SEARCH_FROM + 1)
    expect(chromeRows(p0)).toBe(W.searchRows)
    expect((await kidsOf(ui)).map(k => propsOf(k).key).includes('searchLine')).toBe(W.searchRows === CHROME_ROWS_SEARCH)   // its own line, or inside the toolbar's
    expect((await input())?.props.placeholder).toBe('🔍 חיפוש סוכנים')   // the whole placeholder fits the field at every width
    expect((await input())?.props.value).toBe('')
    // the first keystroke of a search posts at once (under ONE_LINE_FROM the hooks size the chrome by view.search); the next
    // ones wait SEARCH_DEBOUNCE_MS of quiet. (The typed text is the native field's until the next render: the module's onInput
    // keeps it in `inst.query` and never redraws for a keystroke, so the tree as last drawn still carries the old value — the
    // value is read once the post landed)
    await ui.input({ key: 'search', text: 't', kind: 'change' })
    expect((await officeProps(ui)).search).toBe('t')
    expect(chromeRows(await officeProps(ui))).toBe(W.searchRows)
    await ui.input({ key: 'search', text: 'triage', kind: 'change' })
    expect((await officeProps(ui)).search).toBe('t')   // not yet
    await ui.advance(SEARCH_DEBOUNCE_MS)
    const p1 = await officeProps(ui)
    expect(p1.search).toBe('triage')
    expect(p1.rooms.map(r => r.agents.map(a => a.id))).toEqual([['b1']])
    expect(p1.empty).toBeNull()
    expect(p1.counts).toEqual(p0.counts)
    expect(chromeRows(p1)).toBe(W.searchRows)   // one agent shown, but the search is active: the field stays
    expect(await input()).toBeDefined()
    expect((await input())?.props.value).toBe('triage')   // the redraw the post caused draws the typed text
    expect((await headOf(ui, p1, SB)).title).toContain('research')
    expect(await cardsOf(ui)).toHaveLength(1)
    // nobody matches: the no-match office, no cards
    await ui.input({ key: 'search', text: 'zzz', kind: 'submit' })
    const p2 = await officeProps(ui)
    expect(p2.search).toBe('zzz')
    expect(p2.rooms).toEqual([])
    expect(p2.empty?.kind).toBe('nomatch')
    expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /אין סוכנים שתואמים/ })).toBeDefined()
    expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'watchDemo' })).toBeUndefined()
    expect(await cardsOf(ui)).toHaveLength(0)
    expect(await input()).toBeDefined()   // the field stays over the no-match office, to be cleared
    // cleared
    await ui.input({ key: 'search', text: '', kind: 'submit' })
    const p3 = await officeProps(ui)
    expect(p3.search).toBe('')
    expect(p3.empty).toBeNull()
    expect(p3.rooms.map(r => r.agents.map(a => a.id))).toEqual([DRAWN_A, ['b1', ...EXTRA]])
    expect((await input())?.props.value).toBe('')
    expect(await cardsOf(ui)).toHaveLength(2)
    await ui.unmount()
  })

  // ---------------------------------------------------------------------------
  // the keys
  // ---------------------------------------------------------------------------

  t('j / k (down / up): the keyboard focus walks the agent rows drawn — room A\'s, then room B\'s past the more line and the card frames — clamped at both ends; nothing is posted (no selection, no drawer)', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    const y = (id: string) => hitOf(p0, 'agent', id).y
    const focus = () => focused(ui, p0)
    expect(await focus()).toEqual([])
    const writes = { ...captured.writes }
    await ui.key({ in: OFFICE_KEY, key: 'j' })
    expect(await focus()).toEqual([whoOf(p0, 'lead-a')])
    await ui.key({ in: OFFICE_KEY, key: 'j' })
    expect(await focus()).toEqual([whoOf(p0, 'a1')])
    await ui.key({ in: OFFICE_KEY, key: 'down' })
    expect(await focus()).toEqual([whoOf(p0, 'd1')])
    await ui.key({ in: OFFICE_KEY, key: 'k' })
    expect(await focus()).toEqual([whoOf(p0, 'a1')])
    await ui.key({ in: OFFICE_KEY, key: 'up' })
    expect(await focus()).toEqual([whoOf(p0, 'lead-a')])
    await ui.key({ in: OFFICE_KEY, key: 'k' })
    expect(await focus()).toEqual([whoOf(p0, 'lead-a')])   // clamped at the first row
    for (let i = 0; i < DRAWN_A.length + 1; i++) await ui.key({ in: OFFICE_KEY, key: 'j' })
    expect(await focus()).toEqual([whoOf(p0, 'b1')])       // past the more line and the frames, clamped at the last
    expect(y('b1')).toBeGreaterThan(y('d3') + 6)
    const p1 = await officeProps(ui)
    expect(p1.selected).toBeNull()
    expect(p1.drawer).toBeNull()
    expect(captured.writes).toEqual(writes)
    await ui.unmount()
  })

  t('o / Enter: opens the focused row\'s drawer (view.selected); with no focus, nothing', async ($, on) => {
    const { ui } = await mountOffice($, on, fixture, { offset: 0, bodyRows: 40 })   // (the drawer's one height: the opened row in view under it)
    await ui.key({ in: OFFICE_KEY, key: 'o' })
    expect((await officeProps(ui)).drawer).toBeNull()
    await ui.key({ in: OFFICE_KEY, key: 'j' })
    await ui.key({ in: OFFICE_KEY, key: 'j' })
    await ui.key({ in: OFFICE_KEY, key: 'o' })
    const p1 = await officeProps(ui)
    expect(p1.selected).toBe('a1')
    expect(p1.drawer?.id).toBe('a1')
    expect(await overlay(ui)).toMatchObject({ props: { key: 'drawer' } })
    expect(await focused(ui, p1)).toEqual([whoOf(p1, 'a1')])
    await ui.key({ in: OFFICE_KEY, key: 'j' })
    await ui.key({ in: OFFICE_KEY, key: 'return' })
    const p2 = await officeProps(ui)
    expect(p2.selected).toBe('d1')
    expect(p2.drawer?.id).toBe('d1')
    await ui.unmount()
  })

  t('x: closes the drawer (view.selected null); with the settings open, closes those too', async ($, on) => {
    const { ui } = await mountOffice($, on)
    await click(ui, 'agent', 'a1')
    expect((await officeProps(ui)).drawer?.id).toBe('a1')
    await ui.key({ in: OFFICE_KEY, key: 'x' })
    const p1 = await officeProps(ui)
    expect(p1.drawer).toBeNull()
    expect(p1.selected).toBeNull()
    expect(await overlay(ui)).toBeUndefined()
    await ui.press({ key: 'help' })
    expect((await officeProps(ui)).helpOpen).toBe(true)
    await ui.key({ in: OFFICE_KEY, key: 'x' })
    expect((await officeProps(ui)).helpOpen).toBe(false)
    expect(await overlay(ui)).toBeUndefined()
    await ui.unmount()
  })

  t('hotkeys f / m / h / d / l: each flips its control from the keyboard with the settings closed — showDone, muted, helpOpen, demo, the language — and back; a letter with ctrl held does nothing, nor s (no motion toggle: live check 7)', async ($, on) => {
    const { ui } = await mountOffice($, on)
    const p = () => officeProps(ui)
    const flip = async (key: string, read: (p: OfficeProps) => unknown, off: unknown, on: unknown) => {
      expect(read(await p()), key).toEqual(off)
      await ui.key({ in: OFFICE_KEY, key })
      expect(read(await p()), key).toEqual(on)
      await ui.key({ in: OFFICE_KEY, key })
      expect(read(await p()), key).toEqual(off)
    }
    await flip('f', q => q.prefs.showDone, false, true)
    await flip('m', q => q.prefs.muted, false, true)
    await flip('h', q => q.helpOpen, false, true)
    await flip('d', q => q.demo, false, true)
    // (no s: the motion toggle is gone — live check 7, Q9; the last lines check that it changes nothing)
    await flip('l', q => q.lang, 'he', 'en')
    const before = JSON.stringify(await p())
    await ui.key({ in: OFFICE_KEY, key: 'f', ctrl: true })
    await ui.key({ in: OFFICE_KEY, key: 'q' })
    await ui.key({ in: OFFICE_KEY, key: 's' })
    expect(JSON.stringify(await p())).toBe(before)
    await ui.unmount()
  })

  // ---------------------------------------------------------------------------
  // the empty office
  // ---------------------------------------------------------------------------

  t('▶ watch a demo: the empty office\'s Button starts the demo (view.demo): the demo cast fills the office; the settings\' demo Button then reads יציאה and ends it, back to the empty office', async ($, on) => {
    const { ui } = await mountOffice($, on, () => [])
    const p0 = await officeProps(ui)
    expect(p0.rooms).toEqual([])
    expect(p0.empty?.kind).toBe('office')
    expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /המשרד ריק/ })).toBeDefined()
    expect(await label(ui, 'watchDemo')).toBe('צפו בדמו חי ▶')   // (never an icon alone: the empty office's one control)
    expect(await cardsOf(ui)).toHaveLength(0)
    await ui.press({ key: 'watchDemo' })
    const p1 = await officeProps(ui)
    expect(p1.demo).toBe(true)
    expect(p1.empty).toBeNull()
    expect(p1.rooms.map(r => r.id).sort()).toEqual(['demo-session-frontend-1111', 'demo-session-research-2222'])
    expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'watchDemo' })).toBeUndefined()
    expect(await label(ui, 'exitDemo')).toBe(I18N.he.demoExit)   // THE DEMO LINE says it is the demo (live check 5)
    await rowsOk(ui, p1)
    await ui.press({ key: 'help' })
    expect(await label(ui, 'demo')).toBe(W.exitDemo)
    await ui.press({ key: 'demo' })
    const p2 = await officeProps(ui)
    expect(p2.demo).toBe(false)
    expect(p2.rooms).toEqual([])
    expect(p2.empty?.kind).toBe('office')
    await ui.unmount()
  })

  // ---------------------------------------------------------------------------
  // the pointer through the line map: the pane scrolled, the drawer or the settings open
  // ---------------------------------------------------------------------------

  t('SCROLLED (the line map): the pane scrolled into room A, every line of the window and around it is clicked at Client row chromeRows + y — a row in the window opens its drawer (the first click puts the drawer AT THE WINDOW\'S TOP: the rows under it still answer at chromeRows + y, the window shorter by its rows), a frame line or the title\'s middle nothing; a row above the window (the spacer), past it, the drawer\'s own rows and the chrome open nothing; j lands on the window\'s first row; the settings open while scrolled: the same', async ($, on) => {
    const { ui, captured } = await mountOffice($, on, tallFixture, { offset: 0, bodyRows: BODY })
    const p0 = await officeProps(ui)
    expect(p0.rooms.map(r => r.id)).toEqual([SA, SB])
    expect(ids(p0, SA)).toEqual(['lead-a', ...Array.from({ length: READERS }, (_, i) => `r${i + 1}`), ...DONE.slice(0, RECENT_DONE)])
    const lines = officeModel(p0).lines
    // (the tall office shows more than SEARCH_FROM agents: the search field on its own line, or beside the toolbar from ONE_LINE_FROM)
    const FIXED = fixedRows(p0)
    expect(FIXED).toBe(W.searchRows)
    const CHROME_KEYS = W.searchRows === CHROME_ROWS_SEARCH ? ['header', 'toolbar', 'searchLine'] : ['header', 'toolbar']
    expect(lines.length).toBeGreaterThan(FIXED + BODY)   // taller than the window: the pane scrolls
    expect(windowNow(p0)).toEqual({ from: 0, count: BODY - FIXED })
    // scrolled 15 lines into A's rows (the engine's offset: the chrome and 15 layout lines)
    const FROM = 15
    await scrollTo(ui, FIXED + FROM, BODY)
    const p1 = await officeProps(ui)
    expect(p1.rows).toBe(BODY)
    expect(windowNow(p1)).toEqual({ from: FROM, count: BODY })
    expect(lines[FROM]).toMatchObject({ kind: 'row', room: SA })
    await rowsOk(ui, p1)
    expect(rowsOf(await cardOf(ui, p1, SA)).map(r => r[1])).toEqual(lines.slice(FROM, FROM + BODY).filter(l => l.kind === 'row').map(l => whoOf(p1, l.agent!)))
    // j from no focus: the window's first row (line FROM's agent), not the lead on line 4; k stays there; o opens it, x closes it
    await ui.key({ in: OFFICE_KEY, key: 'j' })
    expect(await focused(ui, p1)).toEqual([whoOf(p1, lines[FROM]!.agent!)])
    await ui.key({ in: OFFICE_KEY, key: 'k' })
    expect(await focused(ui, p1)).toEqual([whoOf(p1, lines[FROM]!.agent!)])
    await ui.key({ in: OFFICE_KEY, key: 'o' })
    expect((await officeProps(ui)).drawer?.id).toBe(lines[FROM]!.agent)
    await ui.key({ in: OFFICE_KEY, key: 'x' })
    expect((await officeProps(ui)).drawer).toBeNull()
    // THE SWEEP: four lines above the window to four past it, each clicked at the middle cell of Client row chromeRows + y of the
    // props as last drawn (the window and the chrome re-read before every click: the first row click opens the drawer, which
    // rides the window's top and shortens the window — the rows past it are then dead)
    let opened = 0
    let dead = 0
    for (let y = FROM - 4; y < FROM + BODY + 4; y++) {
      const line = lines[y]!
      if (line.kind === 'more') continue   // the room's toggle: the next test's
      const p = await officeProps(ui)
      const { from, count } = windowNow(p)
      const inWin = y >= from && y < from + count
      const at = `line ${y} (${line.kind}${inWin ? ', in the window' : ''})`
      if (line.kind === 'row' && inWin) {
        await clickRow(ui, chromeRows(p) + y)
        const q = await officeProps(ui)
        expect(q.selected, at).toBe(line.agent)
        expect(q.drawer?.id, at).toBe(line.agent)
        expect(q.offset, at).toBe(p.offset)   // nothing scrolled
        expect(await focused(ui, q), at).toEqual([whoOf(q, line.agent!)])
        opened++
      } else {
        await deadRow(ui, chromeRows(p) + y, at)
        dead++
      }
    }
    // the drawer opened on line FROM's row shortened the window: the rows from FROM to FROM + BODY - H - 1 opened, the rest were dead
    const pd = await officeProps(ui)
    const H = overlayRows(pd)
    expect(pd.drawer).not.toBeNull()
    expect(overlayInWindow(H, BODY)).toBe(true)
    expect(windowNow(pd)).toEqual({ from: FROM, count: BODY - H })
    expect(opened).toBe(BODY - H)
    expect(dead).toBeGreaterThanOrEqual(8)
    expect(pd.selected).toBe(lines[FROM + BODY - H - 1]!.agent)   // the last row in the shortened window
    await rowsOk(ui, pd)
    // the module's tree now: the chrome, a spacer of the FROM lines above the window, the drawer at Client row `offset`, A's fragment
    const kids = await kidsOf(ui)
    expect(kids.map(k => propsOf(k).key ?? propsOf(k).borderStyle)).toEqual([...CHROME_KEYS, 'spacer', 'drawer', 'fragment'])
    expect(propsOf(kids[CHROME_KEYS.length]).height).toBe(FROM)
    expect(FIXED + FROM).toBe(pd.offset)
    expect(chromeRows(pd) + FROM).toBe(pd.offset + H)   // the first row under the drawer: the viewport's row H
    // the drawer's own rows (the viewport's first H), its old place under the chrome (the spacer's rows now) and the chrome: dead
    for (let yy = pd.offset; yy < pd.offset + H; yy++) await deadRow(ui, yy, `the drawer's row ${yy - pd.offset}`)
    for (let yy = FIXED; yy < FIXED + H; yy++) await deadRow(ui, yy, `the spacer's row ${yy}`)
    for (let yy = 0; yy < FIXED; yy++) await deadRow(ui, yy, `the chrome's row ${yy}`)
    // the first row under the drawer opens line FROM's agent; the viewport's last row the window's last
    await clickRow(ui, pd.offset + H)
    expect((await officeProps(ui)).drawer?.id).toBe(lines[FROM]!.agent)
    await clickRow(ui, pd.offset + BODY - 1)
    expect((await officeProps(ui)).drawer?.id).toBe(lines[FROM + BODY - H - 1]!.agent)
    expect(captured.store.roomDone ?? {}).toEqual({})   // no title or more line was ever hit
    expect((captured.store.prefs as Prefs).pins).toEqual([])
    // the settings while scrolled (the drawer closed by x first): at the window's top too; a row past their window and their own rows
    // are dead; a row in their window opens its drawer and closes them
    await ui.key({ in: OFFICE_KEY, key: 'x' })
    expect((await officeProps(ui)).drawer).toBeNull()
    await ui.key({ in: OFFICE_KEY, key: 'h' })
    const ph = await officeProps(ui)
    expect(ph.helpOpen).toBe(true)
    const Hh = overlayRows(ph)
    expect(Hh).toBe(W.helpRows + OVERLAY_GAP)
    expect(windowNow(ph)).toEqual({ from: FROM, count: BODY - Hh })
    expect((await kidsOf(ui)).map(k => propsOf(k).key ?? propsOf(k).borderStyle)).toEqual([...CHROME_KEYS, 'spacer', 'help', 'fragment'])
    await rowsOk(ui, ph)
    await deadRow(ui, chromeRows(ph) + FROM + BODY - Hh, 'the first row past the settings\' window')
    await deadRow(ui, ph.offset + 2, 'a settings row')
    await deadRow(ui, chromeRows(ph) + FROM - 1, 'the row above the window')
    expect((await officeProps(ui)).helpOpen).toBe(true)
    // (the window's first row: the drawer, taller than the settings — its one height, live check 7 Q2 — leaves it in view)
    await clickRow(ui, chromeRows(ph) + FROM)
    const pq = await officeProps(ui)
    expect(pq.helpOpen).toBe(false)
    expect(pq.drawer?.id).toBe(lines[FROM]!.agent)
    expect(await focused(ui, pq)).toEqual([whoOf(pq, lines[FROM]!.agent!)])
    await ui.unmount()
  })

  t('SCROLLED (the card controls lower down): with the window on A\'s end and B\'s card — B\'s title under the pointer draws its dim 📌; B\'s ✅ counts are read-only (live check 7, Q6: B holds one finished, so it has no more line either); A\'s more line, under its title (Q3), lies above the window — at the top it shows A\'s held-back writer and hides it again from the same line; B\'s pin zone pins B, which leaves the window for the top (its 📌 bright there, unpinned after a scroll back)', async ($, on) => {
    const { ui, captured } = await mountOffice($, on, tallFixture, { offset: 0, bodyRows: BODY })
    const p0 = await officeProps(ui)
    const m0 = officeModel(p0)
    const roomA = m0.rooms[0]!
    const roomB = m0.rooms[1]!
    expect((await headOf(ui, p0, SA)).counts).toBe(nb(W.tallA))   // (31 working; the ✅ dropped at 36)
    // A's more line under its title, at the top: A's override, the held-back writer drawn, the hide line on the SAME line
    expect(roomA.moreAt).toBe(roomA.titleAt + 1)
    expect((await headOf(ui, p0, SA)).more).toBe(MORE_LINE)
    await click(ui, 'moreDone', SA)
    expect(captured.store.roomDone).toEqual({ [SA]: true })
    const pa = await officeProps(ui)
    expect(roomOf(pa, SA)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
    expect(ids(pa, SA)).toEqual([...ids(p0, SA), DONE[RECENT_DONE]])
    expect(hitOf(pa, 'moreDone', SA).y).toBe(roomA.moreAt)
    expect((await headOf(ui, pa, SA)).more).toBe(HIDE_LINE)
    await click(ui, 'moreDone', SA)
    expect(captured.store.roomDone).toEqual({})
    expect(ids(await officeProps(ui), SA)).toEqual(ids(p0, SA))
    // the window from A's last rows: its frame, and B whole
    const FROM = roomA.top + roomA.height - 9
    await scrollTo(ui, fixedRows(p0) + FROM, BODY)
    const p1 = await officeProps(ui)
    const w1 = windowNow(p1)
    expect(w1.from).toBe(FROM)
    expect(FROM + w1.count).toBeGreaterThanOrEqual(roomB.top + roomB.height)   // B's card lies whole in the window
    expect(touched(p1).map(r => r.id)).toEqual([SA, SB])
    expect(await cardsOf(ui)).toHaveLength(2)
    await rowsOk(ui, p1)
    expect(hitOf(p1, 'pin', SB).y).toBe(roomB.titleAt)
    // A's more line, scrolled above the window: its old Client row is the spacer now — dead
    await deadRow(ui, chromeRows(p1) + roomA.moreAt, 'A\'s more line, above the window')
    // the head hover at B's scrolled title line: B's 📌 dim, A's none; off it, none; no post
    const writes = { ...captured.writes }
    await moveOver(ui, 'pin', SB)
    expect(await pinOf(ui, p1, SB)).toBe('dim')
    expect(await pinOf(ui, p1, SA)).toBe('none')
    expect(JSON.stringify(await officeProps(ui))).toBe(JSON.stringify(p1))
    await moveOver(ui, 'agent', 'b1')
    expect(await pinOf(ui, p1, SB)).toBe('none')
    await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
    expect(captured.writes).toEqual(writes)
    // B's ✅ counts at its scrolled title line: read-only — no line, no hit, a click there changes nothing
    expect((await headOf(ui, p1, SB)).counts).toBe(nb(W.tallB))
    expect(nb(countsFor(roomOf(p1, SB), GEO))).toBe(nb(W.tallB))
    expect((await headOf(ui, p1, SB)).more).toBe('')
    expect(roomOf(p1, SB).moreLabel).toBe('')
    expect(officeModel(p1).hits.filter(h => h.y === roomB.titleAt).map(h => h.kind)).toEqual(['pin'])
    await deadRow(ui, chromeRows(p1) + roomB.titleAt, 'B\'s ✅ counts', GEO.margin + (p1.rtl ? 2 : GEO.W - 3))
    expect(captured.store.roomDone ?? {}).toEqual({})
    // B's pin zone at its scrolled title line: B pinned, first — out of this window, which keeps A's rows (one card drawn)
    await click(ui, 'pin', SB)
    const p6 = await officeProps(ui)
    expect((captured.store.prefs as Prefs).pins).toEqual([SB])
    expect(p6.rooms.map(r => [r.id, r.pinned])).toEqual([[SB, true], [SA, false]])
    expect(p6.offset).toBe(p1.offset)
    expect(touched(p6).map(r => r.id)).toEqual([SA])
    expect(await cardsOf(ui)).toHaveLength(1)
    expect(hitOf(p6, 'pin', SB).y).toBe(2)
    await rowsOk(ui, p6)
    // scrolled back to the top: B's card first with its bright 📌; a click in its pin zone unpins it
    await scrollTo(ui, 0, BODY)
    const p7 = await officeProps(ui)
    expect(touched(p7).map(r => r.id)).toEqual([SB, SA])
    expect(await pinOf(ui, p7, SB)).toBe('bright')
    await click(ui, 'pin', SB)
    const p8 = await officeProps(ui)
    expect((captured.store.prefs as Prefs).pins).toEqual([])
    expect(p8.rooms.map(r => r.id)).toEqual([SA, SB])
    expect(await pinOf(ui, p8, SA)).toBe('none')
    await ui.unmount()
  })

  t('OVERLAID at the top: under the open settings a row click opens its drawer (the settings close), B\'s pin zone pins B (the settings stay) and A\'s ✅ counts toggle A\'s finished; the settings\' own rows are dead; under the open drawer the pin and the more line land too (the drawer stays), and the drawer\'s rows are dead', async ($, on) => {
    // (a 40-row body: the settings' 15 rows and their gap over a 30-row one would leave B's title line past the window)
    const { ui, captured, clock } = await mountOffice($, on, fixture, { offset: 0, bodyRows: 40 })
    const p0 = await officeProps(ui)
    expect(windowNow(p0)).toEqual({ from: 0, count: officeModel(p0).lines.length })   // the whole office in view
    // the settings: the cards pushed down by their rows; the popover's rows dead; a row under them
    await ui.key({ in: OFFICE_KEY, key: 'h' })
    const p1 = await officeProps(ui)
    expect(p1.helpOpen).toBe(true)
    expect(chromeRows(p1)).toBe(fixedRows(p1) + W.helpRows + OVERLAY_GAP)
    expect(hitOf(p1, 'agent', 'a1').y).toBe(hitOf(p0, 'agent', 'a1').y)   // the layout is the same: only the chrome grew
    for (let yy = fixedRows(p1); yy < fixedRows(p1) + W.helpRows; yy++) await deadRow(ui, yy, `settings row ${yy}`)
    await deadRow(ui, fixedRows(p1) + hitOf(p1, 'agent', 'a1').y, 'a1\'s old Client row, under the popover now')
    expect((await officeProps(ui)).helpOpen).toBe(true)
    await click(ui, 'agent', 'a1')
    const p2 = await officeProps(ui)
    expect(p2.helpOpen).toBe(false)
    expect(p2.drawer?.id).toBe('a1')
    expect(await focused(ui, p2)).toEqual([whoOf(p2, 'a1')])
    // the settings again: B's pin zone under them pins B (the view untouched: the settings stay); A's counts toggle A's finished
    await ui.key({ in: OFFICE_KEY, key: 'x' })
    await ui.key({ in: OFFICE_KEY, key: 'h' })
    expect((await officeProps(ui)).helpOpen).toBe(true)
    await click(ui, 'pin', SB)
    const p3 = await officeProps(ui)
    expect((captured.store.prefs as Prefs).pins).toEqual([SB])
    expect(p3.helpOpen).toBe(true)
    expect(p3.rooms.map(r => r.id)).toEqual([SB, SA])
    expect(await pinOf(ui, p3, SB)).toBe('bright')
    await click(ui, 'pin', SB)
    const p4 = await officeProps(ui)
    expect((captured.store.prefs as Prefs).pins).toEqual([])
    expect(p4.rooms.map(r => r.id)).toEqual([SA, SB])
    await click(ui, 'moreDone', SA)
    expect(captured.store.roomDone).toEqual({ [SA]: true })
    const p5 = await officeProps(ui)
    expect(p5.helpOpen).toBe(true)
    expect(ids(p5, SA)).toEqual(ALL_A)
    expect((await headOf(ui, p5, SA)).more).toBe(HIDE_LINE)
    await rowsOk(ui, p5)
    await click(ui, 'moreDone', SA)
    expect(captured.store.roomDone).toEqual({})
    expect(ids(await officeProps(ui), SA)).toEqual(DRAWN_A)
    await ui.press({ key: 'closeHelp' })
    // the drawer: its rows dead; B's pin zone and A's more line under it land, the drawer staying open on a1
    await click(ui, 'agent', 'a1')
    const p6 = await officeProps(ui)
    expect(p6.drawer?.id).toBe('a1')
    const H = overlayRows(p6)
    expect(chromeRows(p6)).toBe(fixedRows(p6) + H)
    for (let yy = fixedRows(p6); yy < fixedRows(p6) + H; yy++) await deadRow(ui, yy, `drawer row ${yy}`)
    await click(ui, 'pin', SB)
    const p7 = await officeProps(ui)
    expect((captured.store.prefs as Prefs).pins).toEqual([SB])
    expect(p7.drawer?.id).toBe('a1')
    expect(p7.rooms.map(r => r.id)).toEqual([SB, SA])
    await rowsOk(ui, p7)
    await click(ui, 'pin', SB)
    expect((await officeProps(ui)).rooms.map(r => r.id)).toEqual([SA, SB])
    await click(ui, 'moreDone', SA)
    expect(captured.store.roomDone).toEqual({ [SA]: true })
    const p8 = await officeProps(ui)
    expect(p8.drawer?.id).toBe('a1')
    expect(ids(p8, SA)).toEqual(ALL_A)
    expect((await headOf(ui, p8, SA)).more).toBe(HIDE_LINE)
    expect(await focused(ui, p8)).toEqual([whoOf(p8, 'a1')])
    await click(ui, 'moreDone', SA)
    expect(captured.store.roomDone).toEqual({})
    expect(ids(await officeProps(ui), SA)).toEqual(DRAWN_A)
    await ui.unmount()
  })
}

for (const columns of [36, 53, 120] as const) suite(columns)
