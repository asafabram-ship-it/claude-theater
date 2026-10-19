// EVERY CONTROL of the desktop office, each driven end to end through the kit
// on the real mount (Task 2.8b-4; the cards since 2026-10-19): the office
// Client's Button, letter key or pointer event → the module's post
// (office-client.tsx `surface.post`) → the plugin's own `ui.message` hook
// (ui.tsx applyOfficeMessage) → prefs / view / the $.store → the next props the
// pane hands the Client (office-props.ts buildOfficeProps) → what the module
// draws. One test per control; what each asserts is what a person sees change.
// A failing test here is a bug in the owning file, never a test to loosen.
//
// The mechanics (the window, the fx clock, the write budget, a bad post) are
// office-client.mounted.test.ts's and register.test.ts's; the fake-surface
// cases of office-client.test.ts cover the module alone. This file reads the
// effects: the pref or view flipped and mirrored, the cards and rows redrawn,
// the drawer or settings opened, the labels in the other language.
//
// The office of these tests: room A (a Hebrew-titled conversation) with its
// lead, a reader and RECENT_DONE + 1 finished writers — the room draws the
// RECENT_DONE most recent and a "N more finished" line for the rest — and
// room B with one MCP agent (the one that matches the search "triage"). The
// pane is the probe's 51 columns.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { I18N } from './i18n'
import { PERSONA_EMOJI, POLL_MS, REDRAW_LATCH_MS } from './model'
import type { Agent, Prefs } from './model'
import { CHROME_ROWS, HELP_ROWS, OVERLAY_GAP, REFUSED_RE, WINDOW_ROWS, chromeRows, overlayRows, windowOf } from './office-chrome'
import { SEARCH_DEBOUNCE_MS } from './office-client'
import { CARD_BORDER, FOCUS_MARK, PIN, PIN_ZONE, officeModel, trimWindow } from './office-layout'
import type { Hit } from './office-layout'
import { OFFICE_KEY } from './office-props'
import type { OfficeProps } from './office-props'
import { personaName } from './personas'
import { T0, beneath } from './test-kit'
import { RECENT_DONE } from './ui'

const SA = 'sess-aaaa-1111-frontend'
const SB = 'sess-bbbb-2222-research'
const COLUMNS = 51
const ROWS = 30
const TITLE_A = 'תריץ 4 סוכני משנה'
const PANE = { plugin: 'agent-theater', component: 'Pane', requestId: 'agent-theater', props: { title: 'T', isFocused: true, bodyColumns: COLUMNS, placement: 'dock', scroll: { offset: 0, bodyRows: ROWS }, view: {} } } as const
/** The $.store the tests start from: Hebrew, the chime on, finished hidden, no pins. */
const PREFS = () => ({ prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })

/** The finished writers of room A, newest first; the RECENT_DONE first are drawn, the last is held back. */
const DONE = Array.from({ length: RECENT_DONE + 1 }, (_, i) => `d${i + 1}`)
/** Room A's rows while its finished are hidden, and with them all. */
const DRAWN_A = ['lead-a', 'a1', ...DONE.slice(0, RECENT_DONE)]
const ALL_A = ['lead-a', 'a1', ...DONE]
const MORE_LABEL = I18N.he.moreDoneN(1)
const HIDE_LABEL = I18N.he.hideDone

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

type Ui = Mounted<'desktop', 'Pane'>
/** A node of the kit's drawn tree (a Text without props carries no `props` field at all). */
type Drawn = { type: string; props?: Record<string, unknown>; children?: Array<Drawn | string> }
const propsOf = (n: Drawn | undefined): Record<string, unknown> => n?.props ?? {}

/** The pane mounted on the desktop over `agents` (the fixture unless given), the poll run once, the Client sized. */
async function mountOffice($: Engine, on: On, agents: () => Agent[] = fixture) {
  const { captured, clock } = beneath(on, agents, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ in: OFFICE_KEY, columns: COLUMNS, rows: ROWS })
  return { ui, captured, clock }
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
/** The room cards drawn, in order: the framed Boxes in the cards' style without a key. */
async function cardsOf(ui: Ui): Promise<Drawn[]> {
  return (await kidsOf(ui)).filter(k => k.type === 'Box' && propsOf(k).borderStyle === 'round' && propsOf(k).borderColor === CARD_BORDER && propsOf(k).key === undefined)
}
/** The card of `room` as drawn (the cards come in the props' order). */
async function cardOf(ui: Ui, p: OfficeProps, room: string): Promise<Drawn> {
  const i = p.rooms.findIndex(r => r.id === room)
  expect(i, `room ${room}`).toBeGreaterThanOrEqual(0)
  const card = (await cardsOf(ui))[i]
  expect(card, `card of ${room}`).toBeDefined()
  return card!
}
/** The parts of a card: the title line's pin, title and counts Boxes, the rule, the table, the more line. */
function partsOf(card: Drawn): { pin: Drawn; title: Drawn; counts: Drawn; table: Drawn; more: Drawn | undefined } {
  const [titleLine, , table, more] = elements(card)
  const [pin, title, counts] = elements(titleLine)
  return { pin: pin!, title: title!, counts: counts!, table: table!, more }
}
/** The texts of a card's drawn rows, one array per row: [status, who, model?, act]. */
function rowsOf(card: Drawn): string[][] {
  const { table } = partsOf(card)
  if (propsOf(table).flexDirection === undefined) return []
  const cols = elements(table).map(col => elements(col).filter(c => propsOf(c).paddingLeft !== undefined || propsOf(c).paddingRight !== undefined))
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
/** How a room's card draws its 📌: bright (pinned), dim (the hover affordance), or not at all (a blank cell). */
async function pinOf(ui: Ui, p: OfficeProps, room: string): Promise<'bright' | 'dim' | 'none'> {
  const { pin } = partsOf(await cardOf(ui, p, room))
  const t = elements(pin)[0]
  if (!t || !textOf(t).includes(PIN)) return 'none'
  return propsOf(t).dimColor === true ? 'dim' : 'bright'
}
/** The texts of a room's card: its title, its counts, its more line ('' when none). */
async function headOf(ui: Ui, p: OfficeProps, room: string): Promise<{ title: string; counts: string; more: string }> {
  const { title, counts, more } = partsOf(await cardOf(ui, p, room))
  return { title: textOf(title), counts: textOf(counts), more: more ? textOf(more) : '' }
}
/** The global constraints on what is drawn: a card per room the window touches, every row's cells one Text each, nothing a surface refuses, no tint. */
async function rowsOk(ui: Ui, p: OfficeProps): Promise<void> {
  const cards = await cardsOf(ui)
  const m = officeModel(p)
  const w = trimWindow(m, ...(Object.values(windowOf(chromeRows(p), p.offset, p.rows, m.lines.length, overlayRows(p))) as [number, number]), WINDOW_ROWS)
  expect(cards.length).toBe(m.rooms.filter(r => r.top < w.from + w.count && r.top + r.height > w.from).length)
  for (const card of cards) {
    const { title, counts } = partsOf(card)
    expect(propsOf(title).height).toBe(1)
    expect(textOf(title)).not.toMatch(REFUSED_RE)
    expect(textOf(counts)).toMatch(/^🟢\d+/)
    for (const row of rowsOf(card)) {
      expect([3, 4]).toContain(row.length)
      for (const v of row) { expect(v).not.toMatch(REFUSED_RE); expect(v).not.toMatch(/\n|⏱|′/) }
    }
    for (const n of nodesOf(card)) if (propsOf(n).paddingLeft !== undefined || propsOf(n).paddingRight !== undefined) { expect(propsOf(n).height).toBe(1); expect((n.children ?? []).length).toBe(1) }
  }
  expect((await ui.findAll({ in: OFFICE_KEY, type: 'Box' })).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
}

/** The layout hit `kind`/`id` of the props as drawn (a row, a room's pin zone, its ✅ counts, its "more finished" line). */
function hitOf(p: OfficeProps, kind: Hit['kind'], id: string): Hit {
  const hit = officeModel(p).hits.find(h => h.kind === kind && h.id === id)
  expect(hit, `${kind} ${id}`).toBeDefined()
  return hit!
}
/** A left click inside the Client on the middle of the layout hit, where the module draws it. */
async function click(ui: Ui, kind: Hit['kind'], id: string): Promise<void> {
  const p = await officeProps(ui)
  const hit = hitOf(p, kind, id)
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: hit.x + Math.floor(hit.w / 2), y: chromeRows(p) + hit.y, button: 'left' })
}
/** The pointer moved over the LINE of the layout hit (its middle cell: on a title line, the title's field, not the pin zone). */
async function moveOver(ui: Ui, kind: Hit['kind'], id: string): Promise<void> {
  const p = await officeProps(ui)
  const hit = hitOf(p, kind, id)
  await ui.pointer({ in: OFFICE_KEY, type: 'move', x: Math.floor(p.columns / 2), y: chromeRows(p) + hit.y })
}

// ---------------------------------------------------------------------------
// the toolbar
// ---------------------------------------------------------------------------

test('☐ showDone: the Button flips prefs.showDone (mirrored to $.store), the box reads ☑, room A draws every finished agent and its line reads הסתר שסיימו; pressed again, the recent three and עוד 1 שסיימו are back', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  expect(p0.prefs.showDone).toBe(false)
  expect(await label(ui, 'showDone')).toBe('הצג שסיימו ☐')
  expect(ids(p0, SA)).toEqual(DRAWN_A)
  expect(roomOf(p0, SA)).toMatchObject({ showDone: false, moreDone: 1, moreLabel: MORE_LABEL })
  expect((await headOf(ui, p0, SA)).more).toBe(`▸ ${MORE_LABEL}`)
  expect(rowsOf(await cardOf(ui, p0, SA)).map(r => r[1])).toEqual(DRAWN_A.map(id => whoOf(p0, id)))
  await ui.press({ key: 'showDone' })
  const p1 = await officeProps(ui)
  expect(p1.prefs.showDone).toBe(true)
  expect((captured.store.prefs as Prefs).showDone).toBe(true)
  expect(await label(ui, 'showDone')).toBe('הצג שסיימו ☑')
  expect(ids(p1, SA)).toEqual(ALL_A)
  expect(roomOf(p1, SA)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
  expect((await headOf(ui, p1, SA)).more).toBe(`▸ ${HIDE_LABEL}`)
  expect(rowsOf(await cardOf(ui, p1, SA)).map(r => r[1])).toEqual(ALL_A.map(id => whoOf(p1, id)))
  expect(p1.counts).toEqual(p0.counts)   // the header counts the whole office either way
  await rowsOk(ui, p1)
  await ui.press({ key: 'showDone' })
  const p2 = await officeProps(ui)
  expect(p2.prefs.showDone).toBe(false)
  expect((captured.store.prefs as Prefs).showDone).toBe(false)
  expect(ids(p2, SA)).toEqual(DRAWN_A)
  expect(roomOf(p2, SA).moreLabel).toBe(MORE_LABEL)
  expect(await label(ui, 'showDone')).toBe('הצג שסיימו ☐')
  await ui.unmount()
})

test('🔔 mute: the Button flips prefs.muted (mirrored to $.store) and reads 🔕; pressed again, 🔔', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  expect((await officeProps(ui)).prefs.muted).toBe(false)
  expect(await label(ui, 'mute')).toBe('צליל 🔔')
  await ui.press({ key: 'mute' })
  expect((await officeProps(ui)).prefs.muted).toBe(true)
  expect((captured.store.prefs as Prefs).muted).toBe(true)
  expect(await label(ui, 'mute')).toBe('צליל 🔕')
  await ui.press({ key: 'mute' })
  expect((await officeProps(ui)).prefs.muted).toBe(false)
  expect((captured.store.prefs as Prefs).muted).toBe(false)
  expect(await label(ui, 'mute')).toBe('צליל 🔔')
  await ui.unmount()
})

test('⚙️ settings: the Button opens the settings popover (view.helpOpen: the framed Box titled הגדרות with the demo / still / lang Buttons and the shortcut rows, the chrome taller by HELP_ROWS and the gap, the cards under it as they were); its ✕ closes it; h opens and closes it too', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  expect(p0.helpOpen).toBe(false)
  expect(await label(ui, 'help')).toBe('הגדרות ⚙️')
  expect(await overlay(ui)).toBeUndefined()
  const rowsA = rowsOf(await cardOf(ui, p0, SA))
  await ui.press({ key: 'help' })
  const p1 = await officeProps(ui)
  expect(p1.helpOpen).toBe(true)
  expect(chromeRows(p1)).toBe(CHROME_ROWS + HELP_ROWS + OVERLAY_GAP)
  const help = await overlay(ui)
  expect(help).toMatchObject({ type: 'Box', props: { key: 'help', borderStyle: 'round', borderColor: CARD_BORDER, height: HELP_ROWS, marginBottom: OVERLAY_GAP } })
  expect(textOf(help!)).toMatch(/הגדרות/)
  expect(textOf(help!)).not.toMatch(/עזרה|קיצורי מקלדת|Esc/)
  expect(textOf(help!)).toMatch(/k \/ j/)
  for (const k of ['demo', 'still', 'lang', 'closeHelp']) expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: k }), k).toBeDefined()
  expect(rowsOf(await cardOf(ui, p1, SA))).toEqual(rowsA)
  await ui.press({ key: 'closeHelp' })
  expect((await officeProps(ui)).helpOpen).toBe(false)
  expect(await overlay(ui)).toBeUndefined()
  for (const k of ['demo', 'still', 'lang', 'closeHelp']) expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: k }), k).toBeUndefined()
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

test('🎬 demo: the settings\' Button starts the demo (view.demo): the demo cast\'s two rooms fill the office with their finished shown (☑ by effect, prefs.showDone untouched), the Button reads יציאה; pressed again the fixture is back; closed, d does the same', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  expect(p0.demo).toBe(false)
  expect(p0.rooms.map(r => r.id)).toEqual([SA, SB])
  await ui.press({ key: 'help' })
  expect(await label(ui, 'demo')).toBe('דמו 🎬')
  await ui.press({ key: 'demo' })
  const p1 = await officeProps(ui)
  expect(p1.demo).toBe(true)
  expect(p1.helpOpen).toBe(true)   // the demo leaves the settings as they were
  expect(p1.rooms.map(r => r.id).sort()).toEqual(['demo-session-frontend-1111', 'demo-session-research-2222'])
  expect(p1.rooms.flatMap(r => r.agents).length).toBeGreaterThanOrEqual(9)
  expect(p1.rooms.every(r => r.showDone)).toBe(true)
  expect(p1.rooms.flatMap(r => r.agents).some(a => a.status === 'done')).toBe(true)
  expect(p1.prefs.showDone).toBe(false)
  expect((captured.store.prefs as Prefs).showDone).toBe(false)
  expect(await label(ui, 'showDone')).toBe('הצג שסיימו ☑')
  expect(await label(ui, 'demo')).toBe('יציאה ✕ 🎬')
  await rowsOk(ui, p1)
  await ui.press({ key: 'demo' })
  const p2 = await officeProps(ui)
  expect(p2.demo).toBe(false)
  expect(p2.rooms.map(r => r.id)).toEqual([SA, SB])
  expect(ids(p2, SA)).toEqual(DRAWN_A)
  expect(await label(ui, 'showDone')).toBe('הצג שסיימו ☐')
  expect(await label(ui, 'demo')).toBe('דמו 🎬')
  await ui.press({ key: 'closeHelp' })
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'demo' })).toBeUndefined()
  await ui.key({ in: OFFICE_KEY, key: 'd' })
  expect((await officeProps(ui)).demo).toBe(true)
  expect((await officeProps(ui)).rooms.map(r => r.id).sort()).toEqual(['demo-session-frontend-1111', 'demo-session-research-2222'])
  await ui.key({ in: OFFICE_KEY, key: 'd' })
  expect((await officeProps(ui)).demo).toBe(false)
  expect((await officeProps(ui)).rooms.map(r => r.id)).toEqual([SA, SB])
  await ui.unmount()
})

test('🎞 still: the settings\' Button flips prefs.still (mirrored to $.store) and reads 🖼; pressed again, 🎞; closed, s does the same', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  expect((await officeProps(ui)).prefs.still).toBe(false)
  await ui.press({ key: 'help' })
  expect(await label(ui, 'still')).toBe('תנועה 🎞')
  await ui.press({ key: 'still' })
  expect((await officeProps(ui)).prefs.still).toBe(true)
  expect((captured.store.prefs as Prefs & { still?: boolean }).still).toBe(true)
  expect(await label(ui, 'still')).toBe('תנועה 🖼')
  expect((await officeProps(ui)).helpOpen).toBe(true)
  await ui.press({ key: 'still' })
  expect((await officeProps(ui)).prefs.still).toBe(false)
  expect(await label(ui, 'still')).toBe('תנועה 🎞')
  await ui.press({ key: 'closeHelp' })
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'still' })).toBeUndefined()
  await ui.key({ in: OFFICE_KEY, key: 's' })
  expect((await officeProps(ui)).prefs.still).toBe(true)
  await ui.key({ in: OFFICE_KEY, key: 's' })
  expect((await officeProps(ui)).prefs.still).toBe(false)
  await ui.unmount()
})

test('🌐 language: the settings\' Button switches to English (prefs.lang mirrored, the pane retitled): rtl off, every label English, the pin zone at the left edge, the rows reading left to right; pressed again, Hebrew; closed, l does the same', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  expect([p0.lang, p0.rtl]).toEqual(['he', true])
  expect(hitOf(p0, 'pin', SA).x).toBe(COLUMNS - PIN_ZONE)
  await ui.press({ key: 'help' })
  expect(await label(ui, 'lang')).toBe('🌐 English')
  await ui.press({ key: 'lang' })
  const p1 = await officeProps(ui)
  expect([p1.lang, p1.rtl]).toEqual(['en', false])
  expect((captured.store.prefs as Prefs).lang).toBe('en')
  expect(captured.opens[captured.opens.length - 1]).toBe('🟢 3 · 🎭 Theater')
  expect(p1.helpOpen).toBe(true)
  expect(await label(ui, 'lang')).toBe('🌐 עברית')
  expect([await label(ui, 'showDone'), await label(ui, 'mute'), await label(ui, 'help')]).toEqual(['☐ Show finished', '🔔 Sound', '⚙️ Settings'])
  expect([await label(ui, 'demo'), await label(ui, 'still')]).toEqual(['🎬 Demo', '🎞 Motion'])
  expect(p1.labels.settingsTitle).toBe('Settings')
  expect(roomOf(p1, SA).moreLabel).toBe('1 more finished')
  expect(roomOf(p1, SA).agents.find(a => a.id === 'a1')?.act).toBe('📖 Reading')
  expect(roomOf(p1, SA).agents.find(a => a.id === 'a1')?.name).toBe(personaName(7, 'en'))
  expect(hitOf(p1, 'pin', SA).x).toBe(0)
  const a1 = rowsOf(await cardOf(ui, p1, SA)).find(r => r[1] === whoOf(p1, 'a1'))
  const a1Row = officeModel(p1).rooms[0]!.rows.find(r => r.id === 'a1')!
  expect(a1).toEqual([' ●', whoOf(p1, 'a1'), 'Opus', a1Row.act])   // (the focus cell leads in LTR; the version from 60 columns)
  expect(['📖 Reading', '📖']).toContain(a1Row.act)                  // (the English names are wider: the word fits the pane or its emoji stays)
  expect((await headOf(ui, p1, SA)).more).toBe('▸ 1 more finished')
  await rowsOk(ui, p1)
  await ui.press({ key: 'lang' })
  const p2 = await officeProps(ui)
  expect([p2.lang, p2.rtl]).toEqual(['he', true])
  expect((captured.store.prefs as Prefs).lang).toBe('he')
  expect(captured.opens[captured.opens.length - 1]).toBe('🟢 3 · 🎭 התיאטרון')
  expect(await label(ui, 'lang')).toBe('🌐 English')
  expect(await label(ui, 'showDone')).toBe('הצג שסיימו ☐')
  expect(roomOf(p2, SA).agents.find(a => a.id === 'a1')?.name).toBe(personaName(7, 'he'))
  await ui.press({ key: 'closeHelp' })
  await ui.key({ in: OFFICE_KEY, key: 'l' })
  expect((await officeProps(ui)).lang).toBe('en')
  expect(await label(ui, 'help')).toBe('⚙️ Settings')
  await ui.key({ in: OFFICE_KEY, key: 'l' })
  expect((await officeProps(ui)).lang).toBe('he')
  expect(await label(ui, 'help')).toBe('הגדרות ⚙️')
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// the card's title line
// ---------------------------------------------------------------------------

test('📌 pin: the pointer over an unpinned card\'s title line draws a dim 📌 at its pin cell (off the line, nothing; no post); a click in the pin zone pins the room (prefs.pins mirrored), which moves to the top with a bright 📌, hovered or not; a click there again unpins it', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  expect(p0.rooms.map(r => [r.id, r.pinned])).toEqual([[SA, false], [SB, false]])
  const headB = hitOf(p0, 'pin', SB)
  expect(headB.x).toBe(COLUMNS - PIN_ZONE)   // RTL: the pin zone at the right edge
  expect(await pinOf(ui, p0, SB)).toBe('none')
  expect((await headOf(ui, p0, SB)).title).not.toContain('○')
  expect((await headOf(ui, p0, SA)).title).toBe(TITLE_A)
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

test('room counts ✅: a click on a card\'s counts toggles that room\'s finished alone (the $.store override, prefs untouched): after the redraw latch room A draws all of them with הסתר שסיימו; a click again hides them', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured, clock } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  const counts = hitOf(p0, 'roomDone', SA)
  expect(counts.x).toBe(0)   // RTL: the counts zone at the left edge
  expect((await headOf(ui, p0, SA)).counts).toBe(`🟢2 ✅${DONE.length}`)
  expect(officeModel(p0).hits.some(h => h.kind === 'roomDone' && h.id === SB)).toBe(false)   // room B has no finished: no ✅ count, nothing to click
  await click(ui, 'roomDone', SA)
  expect(captured.store.roomDone).toEqual({ [SA]: true })
  expect((await officeProps(ui)).prefs.showDone).toBe(false)
  expect(roomOf(await officeProps(ui), SA).showDone).toBe(false)   // not before the latch
  await clock.advance(REDRAW_LATCH_MS)
  const p1 = await officeProps(ui)
  expect(roomOf(p1, SA)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
  expect(ids(p1, SA)).toEqual(ALL_A)
  expect(roomOf(p1, SB).showDone).toBe(false)
  expect(p1.prefs.showDone).toBe(false)
  expect(await label(ui, 'showDone')).toBe('הצג שסיימו ☐')
  expect((await headOf(ui, p1, SA)).more).toBe(`▸ ${HIDE_LABEL}`)
  await rowsOk(ui, p1)
  await click(ui, 'roomDone', SA)
  await clock.advance(REDRAW_LATCH_MS)
  const p2 = await officeProps(ui)
  expect(captured.store.roomDone).toEqual({})
  expect(roomOf(p2, SA)).toMatchObject({ showDone: false, moreDone: 1, moreLabel: MORE_LABEL })
  expect(ids(p2, SA)).toEqual(DRAWN_A)
  await ui.unmount()
})

test('the ▸ עוד N שסיימו line: a click on it shows the room\'s finished (the same override as the counts); the line then reads הסתר שסיימו, and a click on that hides them again', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured, clock } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  const more = hitOf(p0, 'moreDone', SA)
  expect(more.w).toBe(COLUMNS)   // the whole line is the hit
  expect((await headOf(ui, p0, SA)).more).toBe(`▸ ${MORE_LABEL}`)
  expect(officeModel(p0).hits.some(h => h.kind === 'moreDone' && h.id === SB)).toBe(false)   // room B holds no finished: no such line
  await click(ui, 'moreDone', SA)
  expect(captured.store.roomDone).toEqual({ [SA]: true })
  await clock.advance(REDRAW_LATCH_MS)
  const p1 = await officeProps(ui)
  expect(ids(p1, SA)).toEqual(ALL_A)
  expect(roomOf(p1, SA)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
  const hide = hitOf(p1, 'moreDone', SA)
  expect(hide.y).toBe(more.y + 1)   // one line lower: the held-back writer is drawn above it
  expect((await headOf(ui, p1, SA)).more).toBe(`▸ ${HIDE_LABEL}`)
  await click(ui, 'moreDone', SA)
  await clock.advance(REDRAW_LATCH_MS)
  const p2 = await officeProps(ui)
  expect(captured.store.roomDone).toEqual({})
  expect(ids(p2, SA)).toEqual(DRAWN_A)
  expect((await headOf(ui, p2, SA)).more).toBe(`▸ ${MORE_LABEL}`)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// the rows and the drawer
// ---------------------------------------------------------------------------

test('row click: a click on an agent row selects it and opens its drawer (view.selected, the card in the cards\' style with the persona, the chips, the task; the row carries the focus marker, no band); a click on another row moves the drawer there', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  expect(p0.drawer).toBeNull()
  expect(p0.selected).toBeNull()
  await click(ui, 'agent', 'a1')
  const p1 = await officeProps(ui)
  expect(p1.selected).toBe('a1')
  expect(p1.drawer).toMatchObject({ id: 'a1', sub: 'map session-token validation', done: false, task: 'Task of a1.' })
  expect(p1.drawer?.name).toContain(personaName(7, 'he'))
  expect(captured.view).toMatchObject({ selected: 'a1', helpOpen: false, focusIndex: 1 })
  const drawer = await overlay(ui)
  expect(drawer).toMatchObject({ type: 'Box', props: { key: 'drawer', borderStyle: 'round', borderColor: CARD_BORDER, paddingY: 1, height: overlayRows(p1) - OVERLAY_GAP, marginBottom: OVERLAY_GAP } })
  expect(textOf(drawer!)).toMatch(/משימה/)
  expect(textOf(drawer!)).toContain('Task of a1.')
  expect(textOf(drawer!)).toMatch(/עובד/)
  expect(chromeRows(p1)).toBe(CHROME_ROWS + overlayRows(p1))
  expect(await focused(ui, p1)).toEqual([whoOf(p1, 'a1')])   // the click's keyboard focus: the marker on its row
  expect((await ui.findAll({ in: OFFICE_KEY, type: 'Box' })).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)   // no selection band
  expect(rowsOf(await cardOf(ui, p1, SA)).map(r => r[1])).toContain(whoOf(p1, 'a1'))
  expect(whoOf(p1, 'a1')).toContain(personaName(7, 'he'))
  // another row (a finished one): its drawer, with a duration
  await click(ui, 'agent', 'd1')
  const p2 = await officeProps(ui)
  expect(p2.selected).toBe('d1')
  expect(p2.drawer).toMatchObject({ id: 'd1', done: true, sub: 'write part 1', result: 'Done.' })
  expect(textOf((await overlay(ui))!)).toMatch(/סיים/)
  expect(textOf((await overlay(ui))!)).toMatch(/משך \d+ דק׳/)
  expect(await focused(ui, p2)).toEqual([whoOf(p2, 'd1')])
  await ui.unmount()
})

test('drawer ✕: the Button closes the drawer (view.selected null, the chrome back to its six rows); the keyboard focus stays on the row', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await mountOffice($, on)
  await click(ui, 'agent', 'a1')
  expect((await officeProps(ui)).drawer?.id).toBe('a1')
  expect(await label(ui, 'close')).toBe('סגירה ✕')   // (read ✕ then the word: the ✕ trails the Hebrew word — iconLabel)
  await ui.press({ key: 'close' })
  const p1 = await officeProps(ui)
  expect(p1.drawer).toBeNull()
  expect(p1.selected).toBeNull()
  expect(await overlay(ui)).toBeUndefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'close' })).toBeUndefined()
  expect(chromeRows(p1)).toBe(CHROME_ROWS)
  expect(await focused(ui, p1)).toEqual([whoOf(p1, 'a1')])
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// the search
// ---------------------------------------------------------------------------

test('🔍 search: the typed text reaches view.search after the debounce and narrows the office to the matching agents (the header counts unchanged); a text nobody matches shows the no-match office; Enter on an empty field clears it and every room is back', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  const input = async () => (await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))
  expect((await input())?.props.placeholder).toBe('חיפוש סוכנים 🔍')
  expect((await input())?.props.value).toBe('')
  await ui.input({ key: 'search', text: 'triage', kind: 'change' })
  // (the typed text is the native field's until the next render: the module's onInput keeps it in `inst.query` and never
  // redraws for a keystroke, so the tree as last drawn still carries the old value — the value is read once the post landed)
  expect((await officeProps(ui)).search).toBe('')   // not yet: the module waits SEARCH_DEBOUNCE_MS of quiet
  await ui.advance(SEARCH_DEBOUNCE_MS)
  const p1 = await officeProps(ui)
  expect(p1.search).toBe('triage')
  expect(p1.rooms.map(r => r.agents.map(a => a.id))).toEqual([['b1']])
  expect(p1.empty).toBeNull()
  expect(p1.counts).toEqual(p0.counts)
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
  // cleared
  await ui.input({ key: 'search', text: '', kind: 'submit' })
  const p3 = await officeProps(ui)
  expect(p3.search).toBe('')
  expect(p3.empty).toBeNull()
  expect(p3.rooms.map(r => r.agents.map(a => a.id))).toEqual([DRAWN_A, ['b1']])
  expect((await input())?.props.value).toBe('')
  expect(await cardsOf(ui)).toHaveLength(2)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// the keys
// ---------------------------------------------------------------------------

test('j / k (down / up): the keyboard focus walks the agent rows drawn — room A\'s, then room B\'s past the more line and the card frames — clamped at both ends; nothing is posted (no selection, no drawer)', { timeoutMs: 30_000 }, async ($, on) => {
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

test('o / Enter: opens the focused row\'s drawer (view.selected); with no focus, nothing', { timeoutMs: 30_000 }, async ($, on) => {
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

test('x: closes the drawer (view.selected null); with the settings open, closes those too', { timeoutMs: 30_000 }, async ($, on) => {
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

test('hotkeys f / m / h / d / s / l: each flips its control from the keyboard with the settings closed — showDone, muted, helpOpen, demo, still, the language — and back; a letter with ctrl held does nothing', { timeoutMs: 30_000 }, async ($, on) => {
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
  await flip('s', q => q.prefs.still, false, true)
  await flip('l', q => q.lang, 'he', 'en')
  const before = JSON.stringify(await p())
  await ui.key({ in: OFFICE_KEY, key: 'f', ctrl: true })
  await ui.key({ in: OFFICE_KEY, key: 'q' })
  expect(JSON.stringify(await p())).toBe(before)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// the empty office
// ---------------------------------------------------------------------------

test('▶ watch a demo: the empty office\'s Button starts the demo (view.demo): the demo cast fills the office; the settings\' demo Button then reads יציאה and ends it, back to the empty office', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await mountOffice($, on, () => [])
  const p0 = await officeProps(ui)
  expect(p0.rooms).toEqual([])
  expect(p0.empty?.kind).toBe('office')
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /המשרד ריק/ })).toBeDefined()
  expect(await label(ui, 'watchDemo')).toBe('צפו בדמו חי ▶')
  expect(await cardsOf(ui)).toHaveLength(0)
  await ui.press({ key: 'watchDemo' })
  const p1 = await officeProps(ui)
  expect(p1.demo).toBe(true)
  expect(p1.empty).toBeNull()
  expect(p1.rooms.map(r => r.id).sort()).toEqual(['demo-session-frontend-1111', 'demo-session-research-2222'])
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'watchDemo' })).toBeUndefined()
  await rowsOk(ui, p1)
  await ui.press({ key: 'help' })
  expect(await label(ui, 'demo')).toBe('יציאה ✕ 🎬')
  await ui.press({ key: 'demo' })
  const p2 = await officeProps(ui)
  expect(p2.demo).toBe(false)
  expect(p2.rooms).toEqual([])
  expect(p2.empty?.kind).toBe('office')
  await ui.unmount()
})
