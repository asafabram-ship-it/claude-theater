// EVERY CONTROL of the desktop office, each driven end to end through the kit
// on the real mount (Task 2.8b-4; the cards since 2026-10-19; THREE WIDTHS
// since 2026-10-20): the office Client's Button or letter key →
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
// 6: office-layout.ts PANE_GUTTER), so the column's margin is 1 —
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
// THE CLICKS THROUGH THE BUTTONS (phase B, decision 26 of the client-office
// spec; the paint probe of 22.10): every click in the office is a native plain
// Button's press, so a test presses it by its key as the desktop does — a
// row's cells `agent:<id>:who|model|emoji|word|task` (the who cell: `clickAgent`),
// the pin on every title `pin:<room>` (then the pointer's `leave`, which alone
// releases THE PIN'S PLACE: `clickPin`), the more line `more:<room>`
// (`clickMore`) — and the toolbar's, the settings' and the closes by their own
// keys. No y is hit-tested any more (the engine's y drifted a row per card
// against the drawn lines: half-cell frame rows), so the line map's clicks and
// its dead rows are gone; the pointer is read for its `leave` alone, and a
// move or a down anywhere changes nothing. The settings | drawer is THE
// FLOATING OVERLAY: one absolute Box, the root's last child after the reading
// column, at max(offset, chromeRows) on the theme's inverseText, overlayHeight
// rows tall — it takes no row of the flow, so the cards under it never move
// (chromeRows counts the fixed chrome and the footer alone). Every office here
// is short (at most WINDOW_ROWS lines), so THE WINDOW WITH OVERSCAN draws it
// whole at any offset; the last section scrolls a tall one and presses the
// card controls lower down — B's ✅ counts read-only (live check 7, Q6).

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { I18N } from './i18n'
import { PERSONA_EMOJI, POLL_MS } from './model'
import type { Agent, Prefs } from './model'
import { CHROME_ROWS_MIN, CHROME_ROWS_SEARCH, DEMO_ROWS, REFUSED_RE, SEARCH_FROM, WINDOW_ROWS, chromeRows, demoLine, drawerInner, drawerStatus, fixedRows, helpRows, overlayHeight, overscanOf } from './office-chrome'
import { SEARCH_DEBOUNCE_MS } from './office-client'
import { CARD_BORDER, FOCUS_MARK, NO_DECOR, PIN, PIN_OFF, countsFor, geometry, nb, officeModel, textWidth } from './office-layout'
import type { ModelCol, TableMode } from './office-layout'
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
/** The more / hide line as drawn: with no plain space (office-layout.ts nb: a one-line value never wraps); read arrow first (iconLabel: the arrow trails the Hebrew words in the string, ◂ the collapsed one's RTL form). */
const MORE_LINE = nb(`${MORE_LABEL} ◂`)
const HIDE_LINE = nb(`${HIDE_LABEL} ▾`)   // (the arrow follows the state: live check 7)

/**
 * WHAT EACH WIDTH DRAWS (office-layout.ts geometry, office-chrome.ts; the probe's rounds 8-9), pinned by the first test of
 * each width and read by the rest:
 *   column / margin  the reading column's cells and its centring margin (the pane less a cell at each edge, PANE_GUTTER; a
 *                    frozen 100 centred by 10 at 120 — the floating overlay laid at the same margin and width);
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
 *   titleA           room A's title as its card draws it: whole from 51 cells, cut on a word at 34 — every title leaves its
 *                    pin's cells (the pin on every card since decision 26: office-layout.ts cutTitle), so a pin never re-cuts it;
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
  countsA: string; tallA: string; tallB: string; titleA: string; drawerType: boolean
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
  36: { column: 34, margin: 1, toolbar: ICONS, toolbarEn: ICONS, settings: SETTINGS_HE, settingsEn: SETTINGS_EN, exitDemo: 'יציאה ✕ 🎬', demoNote: DEMO_NOTE_MID, hotkeys: false, searchRows: CHROME_ROWS_SEARCH, helpRows: 14, model: 'family', word: false, task: false, countsA: '🟢2', tallA: '🟢31', tallB: '🟢1', titleA: 'תריץ 4 סוכני…', drawerType: false },
  53: { column: 51, margin: 1, toolbar: WORDS_HE, toolbarEn: WORDS_EN, settings: SETTINGS_HE, settingsEn: SETTINGS_EN, exitDemo: 'יציאה ✕ 🎬', demoNote: DEMO_NOTE, hotkeys: false, searchRows: CHROME_ROWS_SEARCH, helpRows: 14, model: 'family', word: true, task: false, countsA: '🟢2 ✅4', tallA: '🟢31 ✅4', tallB: '🟢1 ✅1', titleA: TITLE_A, drawerType: true },
  120: { column: 100, margin: 10, toolbar: WORDS_HE, toolbarEn: WORDS_EN, settings: SETTINGS_HE, settingsEn: SETTINGS_EN, exitDemo: 'יציאה ✕ 🎬', demoNote: DEMO_NOTE, hotkeys: true, searchRows: CHROME_ROWS_MIN, helpRows: 11, model: 'full', word: true, task: true, countsA: '🟢2 ✅4', tallA: '🟢31 ✅4', tallB: '🟢1 ✅1', titleA: TITLE_A, drawerType: true },
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

/** The tall office's body: a 25-row window, so room A's card runs past it and the pane scrolls (the office still short enough to be drawn whole: WINDOW_ROWS). */
const BODY = 25
const READERS = 30
/**
 * The tall office: room A (its lead, READERS readers, the RECENT_DONE + 1 finished writers — the room draws the RECENT_DONE and
 * the "1 more finished" line) is a card of CARD_LINES + 1 + READERS + RECENT_DONE + MORE_LINES lines, past any 25-row window;
 * room B holds a working agent and a finished one (drawn: it is among the recent), so its title line has ✅ counts — read-only since live check 7 (Q6): a click on them changes nothing.
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

/** The module's drawn tree: the root Box — the reading column, then THE FLOATING OVERLAY while the settings or the drawer is open (phase B). */
async function rootOf(ui: Ui): Promise<Drawn> {
  return (await ui.drawn({ in: OFFICE_KEY })) as unknown as Drawn
}
/** The reading column: the root's `column` Box (its width and centring margin; the chrome lines, the spacer, the window's cards). */
async function columnOf(ui: Ui): Promise<Drawn> {
  const column = elements(await rootOf(ui)).find(k => propsOf(k).key === 'column')
  expect(column, 'the column Box').toBeDefined()
  return column!
}
/** The column's children: the chrome lines, then the spacer and the window's cards. */
async function kidsOf(ui: Ui): Promise<Drawn[]> {
  return elements(await columnOf(ui))
}
/** THE FLOATING OVERLAY: the settings popover | the drawer — an absolute Box keyed `help` | `drawer`, the root's last child. */
const isOverlay = (k: Drawn) => k.type === 'Box' && propsOf(k).position === 'absolute' && (propsOf(k).key === 'help' || propsOf(k).key === 'drawer')
async function overlay(ui: Ui): Promise<Drawn | undefined> {
  const kids = elements(await rootOf(ui))
  expect(kids.length, 'the root: the column, then the overlay at most').toBeLessThanOrEqual(2)
  const last = kids[1]
  if (last) expect(isOverlay(last), 'the root\'s second child is the overlay').toBe(true)
  return last
}
/**
 * Where THE FLOATING OVERLAY lies for the props drawn (decision 26): absolute at max(offset, chromeRows) — the window's top,
 * never over the fixed chrome — at the reading column's margin and width, overlayHeight rows tall, framed as a card, on the
 * theme's inverseText (it hides the rows under it on either theme); no margin: it takes no row of the flow.
 */
function overlayAt(p: OfficeProps, key: 'help' | 'drawer') {
  const geo = geometry(p.columns)
  return { type: 'Box', props: { key, position: 'absolute', top: Math.max(p.offset, chromeRows(p)), left: geo.margin, width: geo.W, height: overlayHeight(p), backgroundColor: 'inverseText', borderStyle: 'round', borderColor: CARD_BORDER } }
}
/** A drawn tree as data without its press handles (the kit names each Button's handler by a handle a render mints afresh). */
const shape = (n: unknown) => JSON.stringify(n, (k, v) => (k === 'press' ? undefined : v))
const isNode = (n: unknown): n is Drawn => typeof n === 'object' && n !== null && 'type' in n
function textOf(n: Drawn | string | null | undefined): string {
  return typeof n === 'string' ? n : isNode(n) ? (n.children ?? []).map(textOf).join('') : ''
}
/** What a Button shows: its label (the kit lays a cell's one Text as its label too). */
const labelOf = (n: Drawn | undefined): string => String(propsOf(n).label ?? textOf(n))
const nodesOf = (n: unknown): Drawn[] => (isNode(n) ? [n, ...(n.children ?? []).flatMap(nodesOf)] : [])
/** The element children of a node (the kit's tree may hold strings and holes among them). */
const elements = (n: Drawn | undefined): Drawn[] => (n?.children ?? []).filter(isNode)
/** The room cards drawn, in order: the framed Boxes in the cards' style keyed `room:<id>`, every one whole (phase B: no fragment). */
const isCard = (k: Drawn) => k.type === 'Box' && propsOf(k).borderStyle === 'round' && propsOf(k).borderColor === CARD_BORDER && String(propsOf(k).key ?? '').startsWith('room:')
async function cardsOf(ui: Ui): Promise<Drawn[]> {
  return (await kidsOf(ui)).filter(isCard)
}
/** The card of `room` as drawn (by its key). */
async function cardOf(ui: Ui, room: string): Promise<Drawn> {
  const card = (await cardsOf(ui)).find(c => propsOf(c).key === `room:${room}`)
  expect(card, `card of ${room}`).toBeDefined()
  return card!
}
/** The parts of a card: its title line (the pin Button — on every title since decision 26 — then the title and counts Boxes), the more line under it (a row Box holding the more Button), the table block. */
function partsOf(card: Drawn): { titleLine: Drawn; pin: Drawn; title: Drawn; counts: Drawn; table: Drawn; more: Drawn | undefined } {
  // (the more line DIRECTLY UNDER THE TITLE when the card has one: live check 7, Q3)
  const parts = elements(card)
  const [titleLine, more, , table] = parts.length === 4 ? parts : [parts[0], undefined, parts[1], parts[2]]
  const kids = elements(titleLine)
  const pin = kids.find(n => n.type === 'Button')
  expect(pin, 'the pin Button on the title').toBeDefined()
  const [title, counts] = kids.filter(n => n.type === 'Box')
  return { titleLine: titleLine!, pin: pin!, title: title!, counts: counts!, table: table!, more }
}
/** The table of a card: the Box of column Boxes, wherever it sits in the card (undefined when no row of it is drawn). */
function tableOf(card: Drawn): Drawn | undefined {
  return nodesOf(card).find(n => n.type === 'Box' && elements(n).length > 0 && (n.children ?? []).every(c => isNode(c) && propsOf(c).flexDirection === 'column'))
}
/** The texts of a card's drawn rows, one array per row: [status, who, model?, act emoji, word?, task?] — a column holds one cell per row and nothing else: the status mark a Text, every other value a Button with its one Text. */
function rowsOf(card: Drawn): string[][] {
  const table = tableOf(card)
  if (!table) return []
  const cols = elements(table).map(col => elements(col).filter(c => c.type === 'Text' || c.type === 'Button'))
  return cols[0]!.map((_, i) => cols.map(col => textOf(col[i])))
}
/** The who cell of an agent as the model says the row reads (`${emoji} ${name}`). */
function whoOf(p: OfficeProps, id: string): string {
  const row = officeModel(p).rooms.flatMap(r => r.rows).find(r => r.id === id)
  expect(row, id).toBeDefined()
  return row!.who
}
/** The layout line of an agent's row (the model's: office-layout.ts RowView.y). */
function rowY(p: OfficeProps, id: string): number {
  const row = officeModel(p).rooms.flatMap(r => r.rows).find(r => r.id === id)
  expect(row, id).toBeDefined()
  return row!.y
}
/** The agents (by their who cell) whose drawn row carries the keyboard focus marker. */
async function focused(ui: Ui, p: OfficeProps): Promise<string[]> {
  const mark = p.rtl ? FOCUS_MARK.rtl : FOCUS_MARK.ltr
  return (await cardsOf(ui)).flatMap(c => rowsOf(c).filter(r => r[0]!.includes(mark)).map(r => r[1]!))
}
/** The texts of a room's card: its title, its counts, its more line's label ('' when none). */
async function headOf(ui: Ui, room: string): Promise<{ title: string; counts: string; more: string }> {
  const { title, counts, more } = partsOf(await cardOf(ui, room))
  return { title: textOf(title), counts: textOf(counts), more: more ? labelOf(elements(more)[0]) : '' }
}
/** The keys of the Buttons an agent's row draws (`agent:<id>:<col>`, in the columns' order). */
async function rowKeys(ui: Ui, id: string): Promise<string[]> {
  return (await ui.findAll({ in: OFFICE_KEY, type: 'Button' })).map(b => String(b.props.key)).filter(k => k.startsWith(`agent:${id}:`))
}
/**
 * The global constraints on what is drawn. Every office of these tests is at most WINDOW_ROWS lines, so THE WINDOW WITH
 * OVERSCAN draws it whole at any offset: a card per room in the props' order, every row of the model drawn; the status mark a
 * one-line Text, every other value a plain Button keyed `agent:<id>:<col>` holding one one-line Text; the pin Button on every
 * title; nothing a surface refuses; no background but the floating overlay's inverseText (decision 26).
 */
async function rowsOk(ui: Ui, p: OfficeProps): Promise<void> {
  const cards = await cardsOf(ui)
  const m = officeModel(p)
  expect(m.lines.length).toBeLessThanOrEqual(WINDOW_ROWS)
  expect(cards.map(c => propsOf(c).key)).toEqual(p.rooms.map(r => `room:${r.id}`))
  expect(cards.reduce((n, c) => n + rowsOf(c).length, 0)).toBe(m.lines.filter(l => l.kind === 'row').length)
  for (const card of cards) {
    const { pin, title, counts } = partsOf(card)
    expect(propsOf(pin).key).toBe(`pin:${String(propsOf(card).key).slice('room:'.length)}`)
    expect(propsOf(title).height).toBe(1)
    expect(textOf(title)).not.toMatch(REFUSED_RE)
    expect(textOf(counts)).toMatch(/^🟢\d+/)
    for (const row of rowsOf(card)) {
      expect(row.length).toBeGreaterThanOrEqual(3)   // status, who, the emoji; the model, the word and the task when the mode and the width have them
      expect(row.length).toBeLessThanOrEqual(6)
      for (const v of row) { expect(v).not.toMatch(REFUSED_RE); expect(v).not.toMatch(/\n|⏱|′/) }
    }
    const table = tableOf(card)
    if (table) {
      const [marks, ...values] = elements(table)
      expect(elements(marks).every(c => c.type === 'Text' && propsOf(c).wrap === 'truncate')).toBe(true)
      for (const col of values) {
        for (const c of elements(col)) {
          expect(c.type).toBe('Button')
          expect(String(propsOf(c).key)).toMatch(/^agent:[^:]+:(who|model|emoji|word|task)$/)
          const kids = elements(c)
          expect(kids.length === 1 && kids[0]!.type === 'Text' && propsOf(kids[0]).wrap === 'truncate', String(propsOf(c).key)).toBe(true)
        }
      }
    }
  }
  const ov = await overlay(ui)
  const bgs = (await ui.findAll({ in: OFFICE_KEY })).filter(n => typeof n.props.backgroundColor === 'string').map(n => [n.props.key, n.props.backgroundColor])
  expect(bgs).toEqual(ov ? [[propsOf(ov).key, 'inverseText']] : [])
}

/**
 * A click on the office's controls as the desktop does it (phase B): the Button's press by its key — the kit presses a
 * Client's Button by its key alone. A row opens by its who cell (any of its cells would); a pin press keeps the cards where
 * they are until the pointer leaves the office (THE PIN'S PLACE, live check 7 Q4: office-buttons.test.ts), so these tests,
 * which read the cards in the props' order, let it leave.
 */
const press = (ui: Ui, key: string) => ui.press({ key })
const clickAgent = (ui: Ui, id: string) => press(ui, `agent:${id}:who`)
const clickPin = async (ui: Ui, room: string) => { await press(ui, `pin:${room}`); await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 }) }
const clickMore = (ui: Ui, room: string) => press(ui, `more:${room}`)
/** The pin Button's label on a drawn card: PIN when pinned, PIN_OFF otherwise. */
const pinLabelOf = async (ui: Ui, room: string) => (await ui.find({ in: OFFICE_KEY, type: 'Button', key: `pin:${room}` }))?.props.label

/** Every control at one width: the tests below, each named by its width, over `mountOffice` at that width and the width's table. */
function suite(COLUMNS: Columns): void {
  const W: Width = WIDTHS[COLUMNS]
  const GEO = geometry(COLUMNS)
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

  t('THE WIDTH as mounted (the table above): the toolbar\'s three labels in words or the icons alone, the hotkeys on the Buttons from COMPACT_BELOW, the reading column (the module\'s `column` Box inside the root: frozen at 100 cells and centred by its margin from CENTRE_AT), the table mode (the model column, the activity word, the task column: so many cells per row, each value a Button keyed by its column), the room counts, the pin on every title, the settings\' labels, hotkeys and rows', async ($, on) => {
    const { ui } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    expect(p0.columns).toBe(COLUMNS)
    expect([GEO.W, GEO.margin]).toEqual([W.column, W.margin])
    // the toolbar
    expect([await label(ui, 'showDone'), await label(ui, 'mute'), await label(ui, 'help')]).toEqual(W.toolbar)
    expect([await hotkeyOf(ui, 'showDone'), await hotkeyOf(ui, 'mute'), await hotkeyOf(ui, 'help')]).toEqual(W.hotkeys ? ['f', 'm', 'h'] : [undefined, undefined, undefined])
    expect(chromeRows(p0)).toBe(CHROME_ROWS_MIN)   // six agents shown: no search field at any width
    // the reading column: the root the pane's width, the module's `column` Box in it — its margin and width from CENTRE_AT (an
    // explicit margin: the floating overlay is laid against the root at the same margin)
    expect(await rootOf(ui)).toMatchObject({ type: 'Box', props: { key: 'root', flexDirection: 'column', width: '100%' } })
    expect(propsOf(await columnOf(ui))).toMatchObject({ width: W.column, marginLeft: W.margin, flexShrink: 0 })
    expect(await overlay(ui)).toBeUndefined()
    // the table mode on the fixture, and the cells per row it makes: the mark a Text, each value a Button keyed by its column
    const m = officeModel(p0)
    expect([m.mode.model, m.mode.word, m.geo.centred]).toEqual([W.model, W.word, W.task])
    const cells = 3 + (W.model === 'none' ? 0 : 1) + (W.word ? 1 : 0) + (W.task ? 1 : 0)
    for (const card of await cardsOf(ui)) for (const row of rowsOf(card)) expect(row, row.join('|')).toHaveLength(cells)
    const a1 = rowsOf(await cardOf(ui, SA)).find(r => r[1] === whoOf(p0, 'a1'))
    expect(a1).toEqual(a1RowIn(p0, m.mode, 'קורא'))
    expect(await rowKeys(ui, 'a1')).toEqual(['who', ...(W.model === 'none' ? [] : ['model']), 'emoji', ...(W.word ? ['word'] : []), ...(W.task ? ['task'] : [])].map(c => `agent:a1:${c}`))
    // the room counts: A's ✅ dropped at 36 (the title keeps TITLE_MIN cells), B's 🟢 alone (no finished)
    expect((await headOf(ui, SA)).counts).toBe(nb(W.countsA))
    expect((await headOf(ui, SB)).counts).toBe(nb('🟢1'))
    expect((await headOf(ui, SA)).title).toBe(nb(W.titleA))
    // THE PIN on every title (decision 26): the monochrome PIN_OFF while no room is pinned (the title's cells reserved for it)
    expect([await pinLabelOf(ui, SA), await pinLabelOf(ui, SB)]).toEqual([PIN_OFF, PIN_OFF])
    await rowsOk(ui, p0)
    // the settings' labels, hotkeys and rows: the floating popover at the column's margin and width
    expect(helpRows(COLUMNS)).toBe(W.helpRows)
    await ui.press({ key: 'help' })
    expect([await label(ui, 'demo'), await label(ui, 'lang')]).toEqual(W.settings)
    expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'still' })).toBeUndefined()   // (no motion toggle: live check 7, Q9)
    expect([await hotkeyOf(ui, 'demo'), await hotkeyOf(ui, 'lang')]).toEqual(W.hotkeys ? ['d', 'l'] : [undefined, undefined])
    expect(propsOf((await overlay(ui))!).height).toBe(W.helpRows)
    expect(await overlay(ui)).toMatchObject(overlayAt(await officeProps(ui), 'help'))
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
    expect((await headOf(ui, SA)).more).toBe(MORE_LINE)
    expect(rowsOf(await cardOf(ui, SA)).map(r => r[1])).toEqual(DRAWN_A.map(id => whoOf(p0, id)))
    await ui.press({ key: 'showDone' })
    const p1 = await officeProps(ui)
    expect(p1.prefs.showDone).toBe(true)
    expect((captured.store.prefs as Prefs).showDone).toBe(true)
    expect(await label(ui, 'showDone')).toBe(W.toolbar[0].replace('☐', '☑'))
    expect(ids(p1, SA)).toEqual(ALL_A)
    expect(roomOf(p1, SA)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
    expect((await headOf(ui, SA)).more).toBe(HIDE_LINE)
    expect(rowsOf(await cardOf(ui, SA)).map(r => r[1])).toEqual(ALL_A.map(id => whoOf(p1, id)))
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

  t('⚙️ settings: the Button opens the settings popover (view.helpOpen: the framed Box titled הגדרות with the demo / lang Buttons and the shortcut rows — THE FLOATING OVERLAY, absolute at the window\'s top on the theme\'s inverseText, no chrome row: the column under it as it was, byte for byte); its ✕ closes it; h opens and closes it too', async ($, on) => {
    const { ui } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    expect(p0.helpOpen).toBe(false)
    expect(await label(ui, 'help')).toBe(W.toolbar[2])
    expect(await overlay(ui)).toBeUndefined()
    const rowsA = rowsOf(await cardOf(ui, SA))
    const column0 = shape(await columnOf(ui))
    await ui.press({ key: 'help' })
    const p1 = await officeProps(ui)
    expect(p1.helpOpen).toBe(true)
    expect(chromeRows(p1)).toBe(fixedRows(p1))   // the popover floats: it takes no row of the flow
    expect(overlayHeight(p1)).toBe(W.helpRows)
    const help = await overlay(ui)
    expect(help).toMatchObject(overlayAt(p1, 'help'))
    expect(propsOf(help).height).toBe(W.helpRows)
    expect(propsOf(help).top).toBe(chromeRows(p1))   // (the pane at its top: under the fixed chrome)
    expect(propsOf(help).marginBottom).toBeUndefined()
    expect(shape(await columnOf(ui)), 'the column under the popover').toBe(column0)
    expect(textOf(help!)).toMatch(/הגדרות/)
    expect(textOf(help!)).toContain(nb('k / j'))   // (the shortcuts' column-major table: no plain space in a row)
    expect(textOf(help!)).not.toMatch(/עזרה|קיצורי מקלדת|Esc/)
    for (const k of ['demo', 'lang', 'closeHelp']) expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: k }), k).toBeDefined()
    expect(rowsOf(await cardOf(ui, SA))).toEqual(rowsA)
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

  t('🎬 demo: the settings\' Button starts the demo (view.demo): the demo cast\'s two rooms fill the office and THE DEMO LINE under the header says so (live check 5: the chrome a row taller, every row still opened by its own Button); the cast obeys show finished as the office does — ☐ and the finished held back while the pref is off, ☑ and all of them with it on, a room\'s more line toggling that room — prefs.showDone never touched by the demo itself; the line\'s exit Button and the settings\' Button end it, the fixture back; closed, d does the same', async ($, on) => {
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
      expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: `agent:${id}:who` }), id).toBeUndefined()   // (no row: no Button)
    }
    expect((await headOf(ui, DEMO_S2)).more).toBe(nb(`${I18N.he.moreDoneN(DEMO_HELD.length)} ◂`))
    await rowsOk(ui, pOff)
    // a press on a demo row opens that row (its Button, under the taller chrome)
    await clickAgent(ui, 'demo-mcp-dd')
    expect((await officeProps(ui)).drawer?.id).toBe('demo-mcp-dd')
    await ui.press({ key: 'close' })
    // a room's more line: that room shows its finished (the override in the store), as a real room's does
    await clickMore(ui, DEMO_S2)
    expect(captured.store.roomDone).toEqual({ [DEMO_S2]: true })
    expect(roomOf(await officeProps(ui), DEMO_S2).showDone).toBe(true)
    await clickMore(ui, DEMO_S2)
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
    for (const id of DEMO_HELD) expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: `agent:${id}:who` }), id).toBeDefined()
    expect((await headOf(ui, DEMO_S2)).more).toBe(HIDE_LINE)
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

  t('🌐 language: the settings\' Button switches to English (prefs.lang mirrored, the pane retitled): rtl off, every label English (in this width\'s form), the pin at the left edge (the title line laid left to right), the rows reading left to right in the mode the English names leave; pressed again, Hebrew; closed, l does the same', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    expect([p0.lang, p0.rtl]).toEqual(['he', true])
    // RTL: the title line laid row-reverse — its first child, the pin, at the right (reading) edge, the counts at the left
    expect(propsOf(partsOf(await cardOf(ui, SA)).titleLine).flexDirection).toBe('row-reverse')
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
    expect(propsOf(partsOf(await cardOf(ui, SA)).titleLine).flexDirection).toBe('row')   // LTR: the pin at the left edge
    // the row in the mode the English names leave the office (wider than the Hebrew ones: the word, then the model column, go
    // before the names are cut — office-layout.ts chooseMode, chosen afresh: the names moved the widest values, so the Hebrew
    // mode's token is no hysteresis here, ModeToken): the mark alone at the left edge, the who, the model (its version from
    // MODEL_FULL_FROM), the emoji, the word when the mode has it, the task from CENTRE_AT
    const m0 = officeModel(p0)
    expect(m0.mode).toMatchObject({ model: W.model, word: W.word })
    const m1 = officeModel(p1, NO_DECOR, undefined, m0.token)
    expect(m1.mode).toEqual(officeModel(p1).mode)
    expect(rowsOf(await cardOf(ui, SA)).find(r => r[1] === whoOf(p1, 'a1'))).toEqual(a1RowIn(p1, m1.mode, 'Reading'))
    expect(whoOf(p1, 'a1')).toBe(nb(`${PERSONA_EMOJI[3]} ${personaName(7, 'en')}`))   // (the fixture's agents all carry persona 3's emoji: `agent()`; the English name whole at every width — 11 cells, under the narrowest cap)
    expect(m1.mode.rank).toBeGreaterThanOrEqual(m0.mode.rank)   // never richer than the Hebrew office's
    expect((await headOf(ui, SA)).more).toBe(nb('▸ 1 more finished'))
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
    expect(rowsOf(await cardOf(ui, SA)).find(r => r[1] === whoOf(p2, 'a1'))).toEqual(a1RowIn(p2, m2.mode, 'קורא'))
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

  t('📌 pin: every card\'s title carries its pin Button — the monochrome 📌︎ (PIN_OFF) while the room is not pinned, one width with the colour 📌 so the title never moves; no hover of any kind (the pointer moved and pressed over the office changes nothing: no post, nothing drawn); a press pins the room (prefs.pins mirrored), which moves to the top with the colour 📌 once the pointer leaves; pressed again, unpinned', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    expect(p0.rooms.map(r => [r.id, r.pinned])).toEqual([[SA, false], [SB, false]])
    expect([await pinLabelOf(ui, SA), await pinLabelOf(ui, SB)]).toEqual([PIN_OFF, PIN_OFF])
    expect(textWidth(PIN_OFF)).toBe(textWidth(PIN))   // (one width either way: a pin never re-cuts the title)
    expect((await headOf(ui, SB)).title).not.toContain('○')
    expect((await headOf(ui, SA)).title).toBe(nb(W.titleA))
    // no hover (paint probe 22.10: none draws inside a Client on the desktop) and no hit-test: a move, a down and an up over B's
    // title line draw nothing and post nothing — the module reads the pointer for its leave alone
    const writes = { ...captured.writes }
    const stores = { ...captured.storeWrites }
    const tree = shape(await rootOf(ui))
    const at = { x: GEO.margin + GEO.W - 3, y: chromeRows(p0) + officeModel(p0).rooms[1]!.titleAt }
    await ui.pointer({ in: OFFICE_KEY, type: 'move', ...at })
    await ui.pointer({ in: OFFICE_KEY, type: 'down', ...at, button: 'left' })
    await ui.pointer({ in: OFFICE_KEY, type: 'up', ...at, button: 'left' })
    expect(shape(await rootOf(ui)), 'the pointer drew something').toBe(tree)
    expect(JSON.stringify(await officeProps(ui))).toBe(JSON.stringify(p0))
    expect(captured.writes).toEqual(writes)
    expect(captured.storeWrites).toEqual(stores)
    await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
    // the press on B's pin (then the pointer leaves: THE PIN'S PLACE released)
    await clickPin(ui, SB)
    const p1 = await officeProps(ui)
    expect((captured.store.prefs as Prefs).pins).toEqual([SB])
    expect(p1.rooms.map(r => [r.id, r.pinned])).toEqual([[SB, true], [SA, false]])
    expect((await cardsOf(ui)).map(c => propsOf(c).key)).toEqual([`room:${SB}`, `room:${SA}`])   // B's card drawn first
    expect(await pinLabelOf(ui, SB)).toBe(PIN)
    expect((await headOf(ui, SB)).title).toContain('research')
    expect(await pinLabelOf(ui, SA)).toBe(PIN_OFF)
    await rowsOk(ui, p1)
    // unpinned again
    await clickPin(ui, SB)
    const p2 = await officeProps(ui)
    expect((captured.store.prefs as Prefs).pins).toEqual([])
    expect(p2.rooms.map(r => [r.id, r.pinned])).toEqual([[SA, false], [SB, false]])
    expect(await pinLabelOf(ui, SB)).toBe(PIN_OFF)
    await rowsOk(ui, p2)
    await ui.unmount()
  })

  t('room counts ✅ are READ-ONLY (live check 7, Q6: the more line under the title is the room\'s one toggle): the title line\'s one control is its pin — the counts a dim Text, no Button; the more line under the title the room\'s Button', async ($, on) => {
    const { ui } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    expect((await headOf(ui, SA)).counts).toBe(nb(W.countsA))   // (the ✅ dropped at 36)
    for (const room of [SA, SB]) {
      const { titleLine, counts } = partsOf(await cardOf(ui, room))
      expect(nodesOf(titleLine).filter(n => n.type === 'Button').map(n => propsOf(n).key), room).toEqual([`pin:${room}`])
      expect(elements(counts).map(n => [n.type, propsOf(n).dimColor]), room).toEqual([['Text', true]])
    }
    // the room's finished toggle is the more line's Button (room A holds one finished past RECENT_DONE; B none: no line)
    expect(roomOf(p0, SA).moreDone).toBe(1)
    expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: `more:${SA}` })).toBeDefined()
    expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: `more:${SB}` })).toBeUndefined()
    await ui.unmount()
  })

  t('the ▸ עוד N שסיימו line, DIRECTLY UNDER THE TITLE (live check 7, Q3): a press on its Button shows the room\'s finished (the $.store override, prefs untouched, drawn at once); the line then reads ▾ הסתר שסיימו ON THE SAME LINE — the same Button — and a press on that hides them again', async ($, on) => {
    const { ui, captured } = await mountOffice($, on)
    const p0 = await officeProps(ui)
    const roomA = officeModel(p0).rooms[0]!
    expect(roomA.moreAt).toBe(roomA.titleAt + 1)
    // the card's second line: a row Box holding the one more Button, plain, of regular weight
    const { more } = partsOf(await cardOf(ui, SA))
    expect(elements(more).map(n => [n.type, propsOf(n).key, propsOf(n).plain])).toEqual([['Button', `more:${SA}`, true]])
    expect((await headOf(ui, SA)).more).toBe(MORE_LINE)
    expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: `more:${SB}` })).toBeUndefined()   // room B holds no finished: no such line
    await clickMore(ui, SA)
    expect(captured.store.roomDone).toEqual({ [SA]: true })
    const p1 = await officeProps(ui)
    expect(ids(p1, SA)).toEqual(ALL_A)
    expect(roomOf(p1, SA)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
    expect(roomOf(p1, SB).showDone).toBe(false)
    expect(p1.prefs.showDone).toBe(false)
    expect(await label(ui, 'showDone')).toBe(W.toolbar[0])
    await rowsOk(ui, p1)
    expect(officeModel(p1).rooms[0]!.moreAt).toBe(roomA.moreAt)   // the same line: the held-back writer is drawn under it, among the rows
    expect(propsOf(elements(partsOf(await cardOf(ui, SA)).more)[0]).key).toBe(`more:${SA}`)
    expect((await headOf(ui, SA)).more).toBe(HIDE_LINE)
    await clickMore(ui, SA)
    const p2 = await officeProps(ui)
    expect(captured.store.roomDone).toEqual({})
    expect(ids(p2, SA)).toEqual(DRAWN_A)
    expect((await headOf(ui, SA)).more).toBe(MORE_LINE)
    await ui.unmount()
  })

  // ---------------------------------------------------------------------------
  // the rows and the drawer
  // ---------------------------------------------------------------------------

  t('row click: a press on an agent row\'s Button selects it and opens its drawer (view.selected; THE FLOATING OVERLAY — the card in the cards\' style with the persona, the status line, the task, absolute at the window\'s top on inverseText, no chrome row; the row carries the focus marker, no band); every value cell of the row opens it (the status mark is a Text: no Button); a press on another row moves the drawer there, a second press on the open one closes it', async ($, on) => {
    const { ui, captured } = await mountOffice($, on, fixture, { offset: 0, bodyRows: 40 })
    const p0 = await officeProps(ui)
    expect(p0.drawer).toBeNull()
    expect(p0.selected).toBeNull()
    const column0 = shape(await columnOf(ui))
    await clickAgent(ui, 'a1')
    const p1 = await officeProps(ui)
    expect(p1.selected).toBe('a1')
    expect(p1.drawer).toMatchObject({ id: 'a1', sub: 'map session-token validation', status: 'running', type: 'Explore', task: 'Task of a1.' })
    expect(p1.drawer?.name).toContain(personaName(7, 'he'))
    expect(captured.view).toMatchObject({ selected: 'a1', helpOpen: false, focusIndex: FOCUS_ON_SELECTED })   // (the text cards' focus follows the selection: R2)
    const drawer = await overlay(ui)
    expect(drawer).toMatchObject(overlayAt(p1, 'drawer'))
    expect(drawer).toMatchObject({ props: { paddingY: 1 } })
    expect(propsOf(drawer).marginBottom).toBeUndefined()
    expect(textOf(drawer!)).toMatch(/משימה/)
    expect(textOf(drawer!)).toContain('Task of a1.')
    // THE STATUS LINE (round 8): the word, the clock, the type — cut to the card's inner width at this width (the type past the cut at 36)
    const status = drawerStatus(p1.drawer!, p1.labels, drawerInner(COLUMNS) - 3)
    expect(status).toMatch(/^עובד · זמן \d+ דק׳/)
    expect(status.endsWith('· Explore')).toBe(W.drawerType)
    if (!W.drawerType) expect(status.endsWith('…')).toBe(true)
    expect(textOf(drawer!)).toContain(status)
    expect(chromeRows(p1)).toBe(fixedRows(p1) + (p1.footer ? 1 : 0))   // the drawer floats: no chrome row
    expect(await focused(ui, p1)).toEqual([whoOf(p1, 'a1')])   // the press's keyboard focus: the marker on its row
    await rowsOk(ui, p1)   // (no selection band: the overlay's inverseText the one background)
    expect(rowsOf(await cardOf(ui, SA)).map(r => r[1])).toContain(whoOf(p1, 'a1'))
    expect(whoOf(p1, 'a1')).toContain(personaName(7, 'he'))
    // the cards under the drawer as they were, but for the focus marker on a1's status mark
    expect(shape(await columnOf(ui)).replace(FOCUS_MARK.rtl, '')).toBe(column0)
    // EVERY VALUE CELL of a row is its Button (decision 26: a native Button hits right at any depth): d1's last cell drawn opens
    // d1, its who cell then closes it (the open one: a close, never a flip); the status mark draws no Button
    const cellsD1 = await rowKeys(ui, 'd1')
    expect(cellsD1[0]).toBe('agent:d1:who')
    expect(cellsD1).toHaveLength(rowsOf(await cardOf(ui, SA))[0]!.length - 1)
    expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'agent:d1:status' })).toBeUndefined()
    await press(ui, cellsD1.at(-1)!)
    const pd = await officeProps(ui)
    expect(pd.drawer?.id).toBe('d1')
    expect(await overlay(ui)).toMatchObject(overlayAt(pd, 'drawer'))
    expect(overlayHeight(pd)).toBe(overlayHeight(p1))   // ONE height at a width (live check 7, Q2): d1's result changes nothing
    for (const key of cellsD1.slice(1, -1)) {
      // (each other cell: closes the open d1, then opens it again)
      await press(ui, key)
      expect((await officeProps(ui)).drawer, key).toBeNull()
      await press(ui, key)
      expect((await officeProps(ui)).drawer?.id, key).toBe('d1')
    }
    // d1 again by its who cell: its drawer is open, so the press closes it (live check 7, Q2); once more, it opens — the
    // finished one's drawer, with a duration
    await clickAgent(ui, 'd1')
    expect((await officeProps(ui)).drawer).toBeNull()
    expect((await officeProps(ui)).selected).toBeNull()
    expect(await overlay(ui)).toBeUndefined()
    await clickAgent(ui, 'd1')
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
    await clickAgent(ui, 'a1')
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
    await rowsOk(ui, p1)   // (no overlay: no background at all)
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
    expect((await headOf(ui, SB)).title).toContain('research')
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
    const y = (id: string) => rowY(p0, id)
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
    const { ui } = await mountOffice($, on)
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
    await clickAgent(ui, 'a1')
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
  // the presses in a scrolled pane: THE FLOATING OVERLAY at the window's top, the card controls lower down
  // ---------------------------------------------------------------------------

  t('SCROLLED: a press reaches its Button wherever the pane is scrolled — a row opens its drawer, which floats at the window\'s top (max(offset, chromeRows), on inverseText) while the cards do not move under it and nothing scrolls; the settings opened while scrolled take the same place, and a row press swaps them for its drawer; the card controls lower down answer and land under an open overlay too — A\'s more line above the window (the drawer stays open), B\'s pin at the office\'s end (the settings stay open; the colour 📌 at once, B to the top once the pointer leaves; unpinned at the top under a drawer, which stays) — B\'s ✅ counts read-only; j from no focus lands on the office\'s first row (a short office is drawn whole: a focus off the screen is a scroll away)', async ($, on) => {
    const { ui, captured } = await mountOffice($, on, tallFixture, { offset: 0, bodyRows: BODY })
    const p0 = await officeProps(ui)
    expect(p0.rooms.map(r => r.id)).toEqual([SA, SB])
    expect(ids(p0, SA)).toEqual(['lead-a', ...Array.from({ length: READERS }, (_, i) => `r${i + 1}`), ...DONE.slice(0, RECENT_DONE)])
    const m0 = officeModel(p0)
    const lines = m0.lines
    // (the tall office shows more than SEARCH_FROM agents: the search field on its own line, or beside the toolbar from ONE_LINE_FROM)
    const FIXED = fixedRows(p0)
    expect(FIXED).toBe(W.searchRows)
    expect(chromeRows(p0)).toBe(FIXED)
    expect(lines.length).toBeGreaterThan(FIXED + BODY)   // taller than the window: the pane scrolls ...
    expect(overscanOf(lines.length, BODY)).toBe(lines.length)   // ... and short enough (WINDOW_ROWS) to be drawn whole at any offset
    expect((await headOf(ui, SA)).counts).toBe(nb(W.tallA))   // (31 working; the ✅ dropped at 36)
    const CHROME_KEYS = W.searchRows === CHROME_ROWS_SEARCH ? ['header', 'toolbar', 'searchLine'] : ['header', 'toolbar']
    const kinds = async () => (await kidsOf(ui)).map(k => (isCard(k) ? 'card' : propsOf(k).key))
    // scrolled 15 lines into A's rows (the engine's offset: the chrome and 15 layout lines): every card still drawn whole, no spacer
    const FROM = 15
    await scrollTo(ui, FIXED + FROM, BODY)
    const p1 = await officeProps(ui)
    expect(lines[FROM]).toMatchObject({ kind: 'row', room: SA })
    expect(await kinds()).toEqual([...CHROME_KEYS, 'card', 'card'])
    await rowsOk(ui, p1)
    // j from no focus: the first row drawn — the lead, above the viewport (the walk keeps to the rows drawn)
    await ui.key({ in: OFFICE_KEY, key: 'j' })
    expect(await focused(ui, p1)).toEqual([whoOf(p1, 'lead-a')])
    // a press on the window's first row: its drawer at THE WINDOW'S TOP — Client row offset, the viewport's first rows — nothing
    // scrolled, the focus on the row; the cards under it never move: closed, the column is what it was under the drawer
    const id = lines[FROM]!.agent!
    await clickAgent(ui, id)
    const p2 = await officeProps(ui)
    expect(p2.drawer?.id).toBe(id)
    expect(p2.offset).toBe(p1.offset)
    expect(await focused(ui, p2)).toEqual([whoOf(p2, id)])
    expect(await overlay(ui)).toMatchObject(overlayAt(p2, 'drawer'))
    expect(propsOf(await overlay(ui)).top).toBe(FIXED + FROM)
    expect(await kinds()).toEqual([...CHROME_KEYS, 'card', 'card'])
    await rowsOk(ui, p2)
    const under = shape(await columnOf(ui))
    await press(ui, 'close')
    expect((await officeProps(ui)).drawer).toBeNull()
    expect(await overlay(ui)).toBeUndefined()
    expect(shape(await columnOf(ui)), 'the cards moved under the drawer').toBe(under)
    // the settings while scrolled: the same place, the column unmoved; a row press under them opens its drawer and closes them
    await ui.key({ in: OFFICE_KEY, key: 'h' })
    const ph = await officeProps(ui)
    expect(ph.helpOpen).toBe(true)
    expect(await overlay(ui)).toMatchObject(overlayAt(ph, 'help'))
    expect(propsOf(await overlay(ui)).top).toBe(FIXED + FROM)
    expect(shape(await columnOf(ui)), 'the cards moved under the settings').toBe(under)
    const other = lines[FROM + 2]!
    expect(other.kind).toBe('row')
    await clickAgent(ui, other.agent!)
    const pq = await officeProps(ui)
    expect(pq.helpOpen).toBe(false)
    expect(pq.drawer?.id).toBe(other.agent)
    expect(await overlay(ui)).toMatchObject(overlayAt(pq, 'drawer'))
    expect(await focused(ui, pq)).toEqual([whoOf(pq, other.agent!)])
    // A's more line under its title (Q3) lies above the window: its Button shows A's held-back writer and hides it again from the
    // same line — the drawer staying open
    const roomA = m0.rooms[0]!
    expect(roomA.moreAt).toBe(roomA.titleAt + 1)
    expect(roomA.moreAt).toBeLessThan(FROM)
    expect((await headOf(ui, SA)).more).toBe(MORE_LINE)
    await clickMore(ui, SA)
    expect(captured.store.roomDone).toEqual({ [SA]: true })
    const pa = await officeProps(ui)
    expect(pa.drawer?.id).toBe(other.agent)
    expect(roomOf(pa, SA)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
    expect(ids(pa, SA)).toEqual([...ids(p0, SA), DONE[RECENT_DONE]])
    expect(officeModel(pa).rooms[0]!.moreAt).toBe(roomA.moreAt)
    expect((await headOf(ui, SA)).more).toBe(HIDE_LINE)
    await rowsOk(ui, pa)
    await clickMore(ui, SA)
    expect(captured.store.roomDone).toEqual({})
    expect(ids(await officeProps(ui), SA)).toEqual(ids(p0, SA))
    expect((await officeProps(ui)).drawer?.id).toBe(other.agent)
    await ui.key({ in: OFFICE_KEY, key: 'x' })
    // the window at the office's end (the furthest the engine scrolls: the Client's height less the window): B whole — its ✅
    // counts read-only (no Button on its title but the pin; one finished: no more line either)
    await scrollTo(ui, FIXED + lines.length - BODY, BODY)
    const pe = await officeProps(ui)
    await rowsOk(ui, pe)
    expect((await headOf(ui, SB)).counts).toBe(nb(W.tallB))
    expect(nb(countsFor(roomOf(pe, SB), GEO))).toBe(nb(W.tallB))
    expect((await headOf(ui, SB)).more).toBe('')
    expect(roomOf(pe, SB).moreLabel).toBe('')
    expect(nodesOf(partsOf(await cardOf(ui, SB)).titleLine).filter(n => n.type === 'Button').map(n => propsOf(n).key)).toEqual([`pin:${SB}`])
    // B's pin there, the settings open: B pinned, the settings stay; THE PIN'S PLACE — the colour 📌 at once, the cards in the
    // order drawn until the pointer leaves, B first then
    await ui.key({ in: OFFICE_KEY, key: 'h' })
    await press(ui, `pin:${SB}`)
    const p6 = await officeProps(ui)
    expect((captured.store.prefs as Prefs).pins).toEqual([SB])
    expect(p6.helpOpen).toBe(true)
    expect(p6.offset).toBe(pe.offset)
    expect(p6.rooms.map(r => [r.id, r.pinned])).toEqual([[SB, true], [SA, false]])
    expect(await pinLabelOf(ui, SB)).toBe(PIN)
    expect((await cardsOf(ui)).map(c => propsOf(c).key)).toEqual([`room:${SA}`, `room:${SB}`])
    await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
    expect((await cardsOf(ui)).map(c => propsOf(c).key)).toEqual([`room:${SB}`, `room:${SA}`])
    await rowsOk(ui, await officeProps(ui))
    await ui.key({ in: OFFICE_KEY, key: 'h' })
    // scrolled back to the top: B's card first with its colour 📌; b1's drawer opened, it floats under the fixed chrome (the offset
    // above it); B's pin unpins it, the drawer staying open
    await scrollTo(ui, 0, BODY)
    expect(await pinLabelOf(ui, SB)).toBe(PIN)
    await clickAgent(ui, 'b1')
    const p7 = await officeProps(ui)
    expect(p7.drawer?.id).toBe('b1')
    expect(await overlay(ui)).toMatchObject(overlayAt(p7, 'drawer'))
    expect(propsOf(await overlay(ui)).top).toBe(chromeRows(p7))
    await clickPin(ui, SB)
    const p8 = await officeProps(ui)
    expect((captured.store.prefs as Prefs).pins).toEqual([])
    expect(p8.rooms.map(r => r.id)).toEqual([SA, SB])
    expect(p8.drawer?.id).toBe('b1')
    expect([await pinLabelOf(ui, SA), await pinLabelOf(ui, SB)]).toEqual([PIN_OFF, PIN_OFF])
    await rowsOk(ui, p8)
    await ui.unmount()
  })
}

for (const columns of [36, 53, 120] as const) suite(columns)
