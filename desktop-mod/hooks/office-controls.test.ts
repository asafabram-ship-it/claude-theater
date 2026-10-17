// EVERY CONTROL of the desktop office, each driven end to end through the kit
// on the real mount (Task 2.8b-4): the office Client's Button, letter key or
// pointer event → the module's post (office-client.tsx `surface.post`) → the
// plugin's own `ui.message` hook (ui.tsx applyOfficeMessage) → prefs / view /
// the $.store → the next props the pane hands the Client (office-props.ts
// buildOfficeProps) → what the module draws. One test per control; what each
// asserts is what a person sees change. A failing test here is a bug in the
// owning file, never a test to loosen.
//
// The mechanics (the window, the fx clock, the write budget, a bad post) are
// office-client.mounted.test.ts's and register.test.ts's; the fake-surface
// cases of office-client.test.ts cover the module alone. This file reads the
// effects: the pref or view flipped and mirrored, the rooms and rows redrawn,
// the drawer or help opened, the labels in the other language.
//
// The office of these tests: room A (a Hebrew-titled conversation) with its
// lead, a reader and RECENT_DONE + 1 finished writers — the room draws the
// RECENT_DONE most recent and a "N more finished" row for the rest — and
// room B with one MCP agent (the one that matches the search "triage").

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { I18N } from './i18n'
import { PERSONA_EMOJI, POLL_MS, REDRAW_LATCH_MS } from './model'
import type { Agent, Prefs } from './model'
import { CHROME_ROWS, HELP_ROWS, REFUSED_RE, chromeRows, overlayRows } from './office-chrome'
import { FX_BG, SEARCH_DEBOUNCE_MS } from './office-client'
import { EMOJI_CELLS, HOVER_BG, PIN, layoutOffice, textWidth } from './office-layout'
import type { Hit } from './office-layout'
import { OFFICE_KEY } from './office-props'
import type { OfficeProps } from './office-props'
import { personaName } from './personas'
import { T0, beneath } from './test-kit'
import { RECENT_DONE } from './ui'

const SA = 'sess-aaaa-1111-frontend'
const SB = 'sess-bbbb-2222-research'
const COLUMNS = 45
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
type Drawn = { type: string; props: Record<string, unknown>; children?: Array<Drawn | string> }

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

/** The module's drawn tree: its children (the chrome lines, the help | drawer, then the spacer and the window's rows). */
async function kidsOf(ui: Ui): Promise<Drawn[]> {
  return ((await ui.drawn({ in: OFFICE_KEY })) as unknown as Drawn).children?.filter((k): k is Drawn => typeof k !== 'string') ?? []
}
/** The help popover | the drawer: the module's framed Boxes. */
const isOverlay = (k: Drawn) => k.type === 'Box' && k.props.borderStyle !== undefined
async function overlay(ui: Ui): Promise<Drawn | undefined> {
  return (await kidsOf(ui)).find(isOverlay)
}
/** The drawn layout rows: layout row y is `rows[y - spacer]` (the chrome, the overlay and the spacer Box left out). */
async function drawnRows(ui: Ui, p: OfficeProps): Promise<{ spacer: number; rows: Drawn[] }> {
  const kids = (await kidsOf(ui)).filter(k => !isOverlay(k))
  const body = kids.slice(CHROME_ROWS + (p.footer ? 1 : 0))
  const spacer = body[0]?.type === 'Box' ? Number(body[0].props.height ?? 0) : 0
  return { spacer, rows: spacer > 0 ? body.slice(1) : body }
}
function textOf(n: Drawn | string): string {
  return typeof n === 'string' ? n : (n.children ?? []).map(textOf).join('')
}
/** Layout row `y` as the module drew it, as glyphs (a wide glyph's second cell is no character). */
async function drawnRow(ui: Ui, p: OfficeProps, y: number): Promise<string> {
  const { spacer, rows } = await drawnRows(ui, p)
  const row = rows[y - spacer]
  return row ? textOf(row) : ''
}
/** The layout rows whose drawn Text carries a run with `bg` as its backgroundColor. */
async function bgRows(ui: Ui, p: OfficeProps, bg: string): Promise<number[]> {
  const { spacer, rows } = await drawnRows(ui, p)
  const out: number[] = []
  rows.forEach((row, i) => {
    if ((row.children ?? []).some(c => typeof c !== 'string' && c.props.backgroundColor === bg)) out.push(spacer + i)
  })
  return out
}
/** How the drawn layout row `y` holds its 📌: a plain run (pinned: bright), a dim run (the hover affordance), or not at all. */
async function pinRun(ui: Ui, p: OfficeProps, y: number): Promise<'bright' | 'dim' | 'none'> {
  const { spacer, rows } = await drawnRows(ui, p)
  for (const c of rows[y - spacer]?.children ?? []) {
    if (typeof c === 'string') { if (c.includes(PIN)) return 'bright'; continue }
    if (textOf(c).includes(PIN)) return c.props.dimColor === true ? 'dim' : 'bright'
  }
  return 'none'
}
/** The global constraints on what is drawn: every row exactly `columns` cells, nothing a surface refuses. */
async function rowsOk(ui: Ui, p: OfficeProps): Promise<void> {
  const { rows } = await drawnRows(ui, p)
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    const t = textOf(row)
    expect(textWidth(t)).toBe(p.columns)
    expect(t).not.toMatch(REFUSED_RE)
  }
}

/** The layout hit `kind`/`id` of the props as drawn (a row, a room's pin cell, its ✅ counts, its "more finished" row). */
function hitOf(p: OfficeProps, kind: Hit['kind'], id: string): Hit {
  const hit = layoutOffice(p).hits.find(h => h.kind === kind && h.id === id)
  expect(hit, `${kind} ${id}`).toBeDefined()
  return hit!
}
/** A left click inside the Client on the middle of the layout hit, where the module draws it. */
async function click(ui: Ui, kind: Hit['kind'], id: string): Promise<void> {
  const p = await officeProps(ui)
  const hit = hitOf(p, kind, id)
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: hit.x + Math.floor(hit.w / 2), y: chromeRows(p) + hit.y, button: 'left' })
}
/** The pointer moved over the ROW of the layout hit (its middle cell: on a head row, the title's field, not the pin cell). */
async function moveOver(ui: Ui, kind: Hit['kind'], id: string): Promise<void> {
  const p = await officeProps(ui)
  const hit = hitOf(p, kind, id)
  await ui.pointer({ in: OFFICE_KEY, type: 'move', x: Math.floor(p.columns / 2), y: chromeRows(p) + hit.y })
}

// ---------------------------------------------------------------------------
// the toolbar
// ---------------------------------------------------------------------------

test('☐ showDone: the Button flips prefs.showDone (mirrored to $.store), the box reads ☑, room A draws every finished agent and its row reads הסתר שסיימו; pressed again, the recent three and עוד 1 שסיימו are back', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  expect(p0.prefs.showDone).toBe(false)
  expect(await label(ui, 'showDone')).toBe('שסיימו ☐')
  expect(ids(p0, SA)).toEqual(DRAWN_A)
  expect(roomOf(p0, SA)).toMatchObject({ showDone: false, moreDone: 1, moreLabel: MORE_LABEL })
  expect(await drawnRow(ui, p0, hitOf(p0, 'moreDone', SA).y)).toContain(MORE_LABEL)
  await ui.press({ key: 'showDone' })
  const p1 = await officeProps(ui)
  expect(p1.prefs.showDone).toBe(true)
  expect((captured.store.prefs as Prefs).showDone).toBe(true)
  expect(await label(ui, 'showDone')).toBe('שסיימו ☑')
  expect(ids(p1, SA)).toEqual(ALL_A)
  expect(roomOf(p1, SA)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
  expect(await drawnRow(ui, p1, hitOf(p1, 'moreDone', SA).y)).toContain(HIDE_LABEL)
  expect(p1.counts).toEqual(p0.counts)   // the header counts the whole office either way
  await rowsOk(ui, p1)
  await ui.press({ key: 'showDone' })
  const p2 = await officeProps(ui)
  expect(p2.prefs.showDone).toBe(false)
  expect((captured.store.prefs as Prefs).showDone).toBe(false)
  expect(ids(p2, SA)).toEqual(DRAWN_A)
  expect(roomOf(p2, SA).moreLabel).toBe(MORE_LABEL)
  expect(await label(ui, 'showDone')).toBe('שסיימו ☐')
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

test('? help: the Button opens the help popover (view.helpOpen: the framed Box with its title, the demo / still / lang Buttons and the shortcut rows, the chrome taller by HELP_ROWS, the office rows under it as they were); its ✕ closes it; h opens and closes it too', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  expect(p0.helpOpen).toBe(false)
  expect(await label(ui, 'help')).toBe('עזרה ?')
  expect(await overlay(ui)).toBeUndefined()
  const row1 = await drawnRow(ui, p0, 1)
  await ui.press({ key: 'help' })
  const p1 = await officeProps(ui)
  expect(p1.helpOpen).toBe(true)
  expect(chromeRows(p1)).toBe(CHROME_ROWS + HELP_ROWS)
  const help = await overlay(ui)
  expect(help).toMatchObject({ type: 'Box', props: { key: 'help', borderStyle: 'round', height: HELP_ROWS } })
  expect(textOf(help!)).toMatch(/קיצורי מקלדת/)
  expect(textOf(help!)).toMatch(/k \/ j/)
  for (const k of ['demo', 'still', 'lang', 'closeHelp']) expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: k }), k).toBeDefined()
  expect(await drawnRow(ui, p1, 1)).toBe(row1)
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
// the help popover's Buttons (and their letters with the help closed)
// ---------------------------------------------------------------------------

test('🎬 demo: the help\'s Button starts the demo (view.demo): the demo cast\'s two rooms fill the office with their finished shown (☑ by effect, prefs.showDone untouched), the Button reads יציאה; pressed again the fixture is back; closed, d does the same', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  expect(p0.demo).toBe(false)
  expect(p0.rooms.map(r => r.id)).toEqual([SA, SB])
  await ui.press({ key: 'help' })
  expect(await label(ui, 'demo')).toBe('דמו 🎬')
  await ui.press({ key: 'demo' })
  const p1 = await officeProps(ui)
  expect(p1.demo).toBe(true)
  expect(p1.helpOpen).toBe(true)   // the demo leaves the help as it was
  expect(p1.rooms.map(r => r.id).sort()).toEqual(['demo-session-frontend-1111', 'demo-session-research-2222'])
  expect(p1.rooms.flatMap(r => r.agents).length).toBeGreaterThanOrEqual(9)
  expect(p1.rooms.every(r => r.showDone)).toBe(true)
  expect(p1.rooms.flatMap(r => r.agents).some(a => a.status === 'done')).toBe(true)
  expect(p1.prefs.showDone).toBe(false)
  expect((captured.store.prefs as Prefs).showDone).toBe(false)
  expect(await label(ui, 'showDone')).toBe('שסיימו ☑')
  expect(await label(ui, 'demo')).toBe('יציאה ✕ 🎬')
  await rowsOk(ui, p1)
  await ui.press({ key: 'demo' })
  const p2 = await officeProps(ui)
  expect(p2.demo).toBe(false)
  expect(p2.rooms.map(r => r.id)).toEqual([SA, SB])
  expect(ids(p2, SA)).toEqual(DRAWN_A)
  expect(await label(ui, 'showDone')).toBe('שסיימו ☐')
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

test('🎞 still: the help\'s Button flips prefs.still (mirrored to $.store) and reads 🖼; pressed again, 🎞; closed, s does the same', { timeoutMs: 30_000 }, async ($, on) => {
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

test('🌐 language: the help\'s Button switches to English (prefs.lang mirrored, the pane retitled): rtl off, every label English, the pin at the left edge and the time at the right; pressed again, Hebrew; closed, l does the same', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  expect([p0.lang, p0.rtl]).toEqual(['he', true])
  expect(hitOf(p0, 'pin', SA).x).toBe(COLUMNS - EMOJI_CELLS)
  await ui.press({ key: 'help' })
  expect(await label(ui, 'lang')).toBe('🌐 English')
  await ui.press({ key: 'lang' })
  const p1 = await officeProps(ui)
  expect([p1.lang, p1.rtl]).toEqual(['en', false])
  expect((captured.store.prefs as Prefs).lang).toBe('en')
  expect(captured.opens[captured.opens.length - 1]).toBe('🟢 3 · 🎭 Theater')
  expect(p1.helpOpen).toBe(true)
  expect(await label(ui, 'lang')).toBe('🌐 עברית')
  expect([await label(ui, 'showDone'), await label(ui, 'mute'), await label(ui, 'help')]).toEqual(['☐ Finished', '🔔 Sound', '? Help'])
  expect([await label(ui, 'demo'), await label(ui, 'still')]).toEqual(['🎬 Demo', '🎞 Motion'])
  expect(p1.labels.helpTitle).toBe('Keyboard shortcuts')
  expect(roomOf(p1, SA).moreLabel).toBe('1 more finished')
  expect(roomOf(p1, SA).agents.find(a => a.id === 'a1')?.act).toBe('📖 Reading')
  expect(roomOf(p1, SA).agents.find(a => a.id === 'a1')?.name).toBe(personaName(7, 'en'))
  expect(hitOf(p1, 'pin', SA).x).toBe(0)
  expect(await drawnRow(ui, p1, hitOf(p1, 'agent', 'a1').y)).toMatch(/⏱️ \d+ min\s*$/)
  expect(await drawnRow(ui, p1, hitOf(p1, 'moreDone', SA).y)).toContain('1 more finished')
  await rowsOk(ui, p1)
  await ui.press({ key: 'lang' })
  const p2 = await officeProps(ui)
  expect([p2.lang, p2.rtl]).toEqual(['he', true])
  expect((captured.store.prefs as Prefs).lang).toBe('he')
  expect(captured.opens[captured.opens.length - 1]).toBe('🟢 3 · 🎭 התיאטרון')
  expect(await label(ui, 'lang')).toBe('🌐 English')
  expect(await label(ui, 'showDone')).toBe('שסיימו ☐')
  expect(roomOf(p2, SA).agents.find(a => a.id === 'a1')?.name).toBe(personaName(7, 'he'))
  await ui.press({ key: 'closeHelp' })
  await ui.key({ in: OFFICE_KEY, key: 'l' })
  expect((await officeProps(ui)).lang).toBe('en')
  expect(await label(ui, 'help')).toBe('? Help')
  await ui.key({ in: OFFICE_KEY, key: 'l' })
  expect((await officeProps(ui)).lang).toBe('he')
  expect(await label(ui, 'help')).toBe('עזרה ?')
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// the room head
// ---------------------------------------------------------------------------

test('📌 pin: the pointer over an unpinned room head draws a dim 📌 at its pin cell (off the head, nothing; no post); a click on the pin cell pins the room (prefs.pins mirrored), which moves to the top with a bright 📌, hovered or not; a click there again unpins it', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  expect(p0.rooms.map(r => [r.id, r.pinned])).toEqual([[SA, false], [SB, false]])
  const headB = hitOf(p0, 'pin', SB)
  expect(headB.x).toBe(COLUMNS - EMOJI_CELLS)   // RTL: the pin cell at the right edge
  expect(await pinRun(ui, p0, headB.y)).toBe('none')
  expect(await drawnRow(ui, p0, headB.y)).not.toContain('○')
  expect(await drawnRow(ui, p0, 0)).toContain(TITLE_A)
  // the hover: a dim 📌 on B's head alone, the props untouched, nothing written
  const writes = { ...captured.writes }
  const stores = { ...captured.storeWrites }
  await moveOver(ui, 'pin', SB)
  expect(await pinRun(ui, p0, headB.y)).toBe('dim')
  expect(await pinRun(ui, p0, 0)).toBe('none')
  expect(JSON.stringify(await officeProps(ui))).toBe(JSON.stringify(p0))
  expect(captured.writes).toEqual(writes)
  expect(captured.storeWrites).toEqual(stores)
  // off the head, over b1's row: the affordance goes (the row hover takes over)
  await moveOver(ui, 'agent', 'b1')
  expect(await pinRun(ui, p0, headB.y)).toBe('none')
  expect(await bgRows(ui, p0, HOVER_BG)).toEqual([hitOf(p0, 'agent', 'b1').y])
  await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
  expect(await bgRows(ui, p0, HOVER_BG)).toEqual([])
  // the click on the pin cell
  await click(ui, 'pin', SB)
  const p1 = await officeProps(ui)
  expect((captured.store.prefs as Prefs).pins).toEqual([SB])
  expect(p1.rooms.map(r => [r.id, r.pinned])).toEqual([[SB, true], [SA, false]])
  expect(hitOf(p1, 'pin', SB).y).toBe(0)
  expect(await pinRun(ui, p1, 0)).toBe('bright')
  expect(await drawnRow(ui, p1, 0)).toContain('research')
  expect(await pinRun(ui, p1, hitOf(p1, 'pin', SA).y)).toBe('none')
  await rowsOk(ui, p1)
  // a pinned head keeps its 📌 bright under the pointer
  await moveOver(ui, 'pin', SB)
  expect(await pinRun(ui, p1, 0)).toBe('bright')
  await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
  // unpinned again
  await click(ui, 'pin', SB)
  const p2 = await officeProps(ui)
  expect((captured.store.prefs as Prefs).pins).toEqual([])
  expect(p2.rooms.map(r => [r.id, r.pinned])).toEqual([[SA, false], [SB, false]])
  expect(await pinRun(ui, p2, hitOf(p2, 'pin', SB).y)).toBe('none')
  await ui.unmount()
})

test('room counts ✅: a click on a room head\'s counts toggles that room\'s finished alone (the $.store override, prefs untouched): after the redraw latch room A draws all of them with הסתר שסיימו; a click again hides them', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured, clock } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  const counts = hitOf(p0, 'roomDone', SA)
  expect(counts.x).toBe(0)   // RTL: the counts at the left edge
  expect(await drawnRow(ui, p0, counts.y)).toContain(`🟢2 ✅${DONE.length}`)
  expect(layoutOffice(p0).hits.some(h => h.kind === 'roomDone' && h.id === SB)).toBe(false)   // room B has no finished: no ✅ count, nothing to click
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
  expect(await label(ui, 'showDone')).toBe('שסיימו ☐')
  expect(await drawnRow(ui, p1, hitOf(p1, 'moreDone', SA).y)).toContain(HIDE_LABEL)
  await rowsOk(ui, p1)
  await click(ui, 'roomDone', SA)
  await clock.advance(REDRAW_LATCH_MS)
  const p2 = await officeProps(ui)
  expect(captured.store.roomDone).toEqual({})
  expect(roomOf(p2, SA)).toMatchObject({ showDone: false, moreDone: 1, moreLabel: MORE_LABEL })
  expect(ids(p2, SA)).toEqual(DRAWN_A)
  await ui.unmount()
})

test('the עוד N שסיימו row: a click on it shows the room\'s finished (the same override as the counts); the row then reads הסתר שסיימו, and a click on that hides them again', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured, clock } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  const more = hitOf(p0, 'moreDone', SA)
  expect(more.w).toBe(COLUMNS)   // the whole row is the hit
  expect(await drawnRow(ui, p0, more.y)).toContain(MORE_LABEL)
  expect(layoutOffice(p0).hits.some(h => h.kind === 'moreDone' && h.id === SB)).toBe(false)   // room B holds no finished: no such row
  await click(ui, 'moreDone', SA)
  expect(captured.store.roomDone).toEqual({ [SA]: true })
  await clock.advance(REDRAW_LATCH_MS)
  const p1 = await officeProps(ui)
  expect(ids(p1, SA)).toEqual(ALL_A)
  expect(roomOf(p1, SA)).toMatchObject({ showDone: true, moreDone: 0, moreLabel: HIDE_LABEL })
  const hide = hitOf(p1, 'moreDone', SA)
  expect(hide.y).toBe(more.y + 1)   // one row lower: the held-back writer is drawn above it
  expect(await drawnRow(ui, p1, hide.y)).toContain(HIDE_LABEL)
  expect(await drawnRow(ui, p1, hide.y)).not.toContain(MORE_LABEL)
  await click(ui, 'moreDone', SA)
  await clock.advance(REDRAW_LATCH_MS)
  const p2 = await officeProps(ui)
  expect(captured.store.roomDone).toEqual({})
  expect(ids(p2, SA)).toEqual(DRAWN_A)
  expect(await drawnRow(ui, p2, hitOf(p2, 'moreDone', SA).y)).toContain(MORE_LABEL)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// the rows and the drawer
// ---------------------------------------------------------------------------

test('row click: a click on an agent row selects it and opens its drawer (view.selected, the framed Box with the persona, the chips, the task; the row highlighted); a click on another row moves the drawer there', { timeoutMs: 30_000 }, async ($, on) => {
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
  expect(drawer).toMatchObject({ type: 'Box', props: { key: 'drawer', borderStyle: 'double', height: overlayRows(p1) } })
  expect(textOf(drawer!)).toMatch(/משימה/)
  expect(textOf(drawer!)).toContain('Task of a1.')
  expect(textOf(drawer!)).toMatch(/עובד/)
  expect(chromeRows(p1)).toBe(CHROME_ROWS + overlayRows(p1))
  const rowA1 = hitOf(p1, 'agent', 'a1').y
  expect(await bgRows(ui, p1, FX_BG.focus)).toEqual([rowA1])   // the click's keyboard focus, laid over its selection
  expect(await drawnRow(ui, p1, rowA1)).toContain(personaName(7, 'he'))
  // another row (a finished one): its drawer, with a duration
  await click(ui, 'agent', 'd1')
  const p2 = await officeProps(ui)
  expect(p2.selected).toBe('d1')
  expect(p2.drawer).toMatchObject({ id: 'd1', done: true, sub: 'write part 1', result: 'Done.' })
  expect(textOf((await overlay(ui))!)).toMatch(/סיים/)
  expect(textOf((await overlay(ui))!)).toMatch(/משך \d+ דק׳/)
  expect(await bgRows(ui, p2, FX_BG.focus)).toEqual([hitOf(p2, 'agent', 'd1').y])
  await ui.unmount()
})

test('drawer ✕: the Button closes the drawer (view.selected null, the chrome back to its three rows); the keyboard focus stays on the row', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await mountOffice($, on)
  await click(ui, 'agent', 'a1')
  expect((await officeProps(ui)).drawer?.id).toBe('a1')
  expect(await label(ui, 'close')).toBe('✕ סגירה')
  await ui.press({ key: 'close' })
  const p1 = await officeProps(ui)
  expect(p1.drawer).toBeNull()
  expect(p1.selected).toBeNull()
  expect(await overlay(ui)).toBeUndefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'close' })).toBeUndefined()
  expect(chromeRows(p1)).toBe(CHROME_ROWS)
  expect(await bgRows(ui, p1, FX_BG.selected)).toEqual([])
  expect(await bgRows(ui, p1, FX_BG.focus)).toEqual([hitOf(p1, 'agent', 'a1').y])
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// the search
// ---------------------------------------------------------------------------

test('🔍 search: the typed text reaches view.search after the debounce and narrows the office to the matching agents (the header counts unchanged); a text nobody matches shows the no-match office; Enter on an empty field clears it and every room is back', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  const input = async () => (await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))
  expect((await input())?.props.placeholder).toBe('🔍 חיפוש סוכנים')
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
  expect(await drawnRow(ui, p1, 0)).toContain('research')
  // nobody matches: the no-match office, no rows
  await ui.input({ key: 'search', text: 'zzz', kind: 'submit' })
  const p2 = await officeProps(ui)
  expect(p2.search).toBe('zzz')
  expect(p2.rooms).toEqual([])
  expect(p2.empty?.kind).toBe('nomatch')
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /אין סוכנים שתואמים/ })).toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'watchDemo' })).toBeUndefined()
  // cleared
  await ui.input({ key: 'search', text: '', kind: 'submit' })
  const p3 = await officeProps(ui)
  expect(p3.search).toBe('')
  expect(p3.empty).toBeNull()
  expect(p3.rooms.map(r => r.agents.map(a => a.id))).toEqual([DRAWN_A, ['b1']])
  expect((await input())?.props.value).toBe('')
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// the keys
// ---------------------------------------------------------------------------

test('j / k (down / up): the keyboard focus walks the agent rows drawn — room A\'s, then room B\'s past the more row and the gap — clamped at both ends; nothing is posted (no selection, no drawer)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await mountOffice($, on)
  const p0 = await officeProps(ui)
  const y = (id: string) => hitOf(p0, 'agent', id).y
  const focus = () => bgRows(ui, p0, FX_BG.focus)
  expect(await focus()).toEqual([])
  const writes = { ...captured.writes }
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await focus()).toEqual([y('lead-a')])
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await focus()).toEqual([y('a1')])
  await ui.key({ in: OFFICE_KEY, key: 'down' })
  expect(await focus()).toEqual([y('d1')])
  await ui.key({ in: OFFICE_KEY, key: 'k' })
  expect(await focus()).toEqual([y('a1')])
  await ui.key({ in: OFFICE_KEY, key: 'up' })
  expect(await focus()).toEqual([y('lead-a')])
  await ui.key({ in: OFFICE_KEY, key: 'k' })
  expect(await focus()).toEqual([y('lead-a')])   // clamped at the first row
  for (let i = 0; i < DRAWN_A.length + 1; i++) await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await focus()).toEqual([y('b1')])       // past the more row and the gap, clamped at the last
  expect(y('b1')).toBeGreaterThan(y('d3') + 2)
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
  expect(await bgRows(ui, p1, FX_BG.focus)).toEqual([hitOf(p1, 'agent', 'a1').y])
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  await ui.key({ in: OFFICE_KEY, key: 'return' })
  const p2 = await officeProps(ui)
  expect(p2.selected).toBe('d1')
  expect(p2.drawer?.id).toBe('d1')
  await ui.unmount()
})

test('x: closes the drawer (view.selected null); with the help open, closes that too', { timeoutMs: 30_000 }, async ($, on) => {
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

test('hotkeys f / m / h / d / s / l: each flips its control from the keyboard with the help closed — showDone, muted, helpOpen, demo, still, the language — and back; a letter with ctrl held does nothing', { timeoutMs: 30_000 }, async ($, on) => {
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

test('▶ watch a demo: the empty office\'s Button starts the demo (view.demo): the demo cast fills the office; the help\'s demo Button then reads יציאה and ends it, back to the empty office', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await mountOffice($, on, () => [])
  const p0 = await officeProps(ui)
  expect(p0.rooms).toEqual([])
  expect(p0.empty?.kind).toBe('office')
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /המשרד ריק/ })).toBeDefined()
  expect(await label(ui, 'watchDemo')).toBe('▶ צפו בדמו חי')
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
