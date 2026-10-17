// office-client.tsx MOUNTED through the kit on the desktop: ui.tsx's desktop
// branch (Task 2.4) returns the Client from the literal path, so the engine
// lists the module among the plugin's surface modules and draws it. Before
// that neither a test hook beneath the plugin nor an inline test plugin
// (copied to a temp folder) could draw `./office-client.tsx`; Task 2.3 tested
// the module directly (office-client.test.ts). The first two tests are the
// brief's (adapted to the Phase 0 amendment: the engine scrolls natively over
// a full-height Client, `props.offset` is the engine's window); the others
// are Task 2.3's drafts against the mounted module.
//
// What the module POSTS reaches the plugin's own `ui.message` hook (ui.tsx,
// Task 2.5; never a test hook beneath), which applies it to prefs / view /
// the store, so the next draw hands the module new props: a click on a tile
// opens its drawer (the chrome grows by the drawer's rows), `f` flips
// "show finished", the search text reaches `props.search`. These cases assert
// what the mounted module shows — the keyboard focus a click or `j` lands on
// a tile, the search Input keeping its text across a publish, a newcomer's
// head walking in on the fx clock (and the clock stopping), the hover, the
// spacer and the window — and those effects of its posts; register.test.ts
// covers every message kind.

import { expect, test } from 'claude-code/testing'

import { PERSONA_EMOJI, POLL_MS } from './model'
import type { Agent } from './model'
import { CHROME_ROWS, chromeRows, windowOf } from './office-chrome'
import { FX_BG, FX_ENTER_MS, FX_TICK_MS, SEARCH_DEBOUNCE_MS } from './office-client'
import { HOVER_BG, NO_DECOR, layoutOffice } from './office-layout'
import type { OfficeDecor } from './office-layout'
import { OFFICE_KEY } from './office-props'
import type { OfficeProps } from './office-props'
import { T0, beneath } from './test-kit'

/** Enabled in Task 2.4 (the desktop branch of ui.tsx returns the Client). */
const ENABLED = true

const PANE = { plugin: 'agent-theater', component: 'Pane', requestId: 'agent-theater', props: { title: 'T', isFocused: true, bodyColumns: 45, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const
function agent(over: Partial<Agent> & { id: string }): Agent {
  return { persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: 'map the docs', subagent_type: 'Explore', status: 'running', tool: 'Read', phase: 'tool', task: 't', task_short: 't', result: null, start_ms: T0 - 30_000, end_ms: null, session: 'sess-a', session_full: 'sess-aaaa', cwd: '/w', project: '/w', mtime_ms: T0 - 1000, is_session: false, closed: false, is_workflow: false, truncated: false, model: 'claude-opus-5-5', ...over }
}

/** The $.store the mounted cases start from: Hebrew, muted, finished hidden, no pins. */
const PREFS = () => ({ prefs: { lang: 'he', muted: true, showDone: false, pins: [] } })

type Found = { props: Record<string, unknown> }
type Drawn = { type: string; props: Record<string, unknown>; children?: Array<Drawn | string> }
type Finder = {
  find: (q: { type?: string; key?: string; text?: RegExp; in?: string }) => Promise<Found | undefined>
  findAll: (q: { type?: string; in?: string }) => Promise<Found[]>
  drawn: (scope?: { in?: string }) => Promise<unknown>
}

/** The office Client's props as last drawn. */
async function officeProps(ui: Finder): Promise<OfficeProps> {
  const c = await ui.find({ type: 'Client' })
  expect(c).toBeDefined()
  return c!.props.props as OfficeProps
}

/** Whether a Text the module drew carries `bg` as its backgroundColor (an fx or highlight overlay). */
async function withBg(ui: Finder, bg: string): Promise<boolean> {
  return (await ui.findAll({ in: OFFICE_KEY, type: 'Text' })).some(n => n.props.backgroundColor === bg)
}

/** The module's drawn tree: its children (the chrome lines, the help | drawer, then the spacer and the window's rows). */
async function kidsOf(ui: Finder): Promise<Drawn[]> {
  return ((await ui.drawn({ in: OFFICE_KEY })) as Drawn).children?.filter((k): k is Drawn => typeof k !== 'string') ?? []
}

/** The help popover | the drawer: the module's framed Boxes (drawn under the fixed chrome, or after the spacer at the window's top). */
const isOverlay = (k: Drawn) => k.type === 'Box' && k.props.borderStyle !== undefined

/** The drawn rows: layout row y is `rows[y - spacer]` (the chrome, the help | drawer and the spacer Box left out). */
async function drawnRows(ui: Finder, p: OfficeProps): Promise<{ spacer: number; rows: Drawn[] }> {
  const kids = (await kidsOf(ui)).filter(k => !isOverlay(k))
  const body = kids.slice(3 + (p.footer ? 1 : 0))
  const spacer = body[0]?.type === 'Box' ? Number(body[0].props.height ?? 0) : 0
  return { spacer, rows: spacer > 0 ? body.slice(1) : body }
}

function textOf(n: Drawn | string): string {
  return typeof n === 'string' ? n : (n.children ?? []).map(textOf).join('')
}

/** Layout row `y` as the module drew it, as glyphs (a wide glyph's second cell is no character). */
async function drawnRow(ui: Finder, p: OfficeProps, y: number): Promise<string> {
  const { spacer, rows } = await drawnRows(ui, p)
  const row = rows[y - spacer]
  return row ? textOf(row) : ''
}

/** Layout row `y` of the props under a decor, as glyphs: what the module must draw there. */
function laidRow(p: OfficeProps, d: OfficeDecor, y: number): string {
  return layoutOffice(p, d).rows[y]?.cells.map(c => c.ch).join('') ?? ''
}

/** The decor of `id` walking in at `progress` (0 → 1). */
function walking(id: string, progress: number): OfficeDecor {
  return { hover: null, hop: new Set(), entering: new Map([[id, progress]]) }
}

/** The LAYOUT rows (0 = the first room head) whose drawn Text carries a run with `bg` as its backgroundColor. */
async function bgRows(ui: Finder, p: OfficeProps, bg: string): Promise<number[]> {
  const { spacer, rows } = await drawnRows(ui, p)
  const out: number[] = []
  rows.forEach((row, i) => {
    if ((row.children ?? []).some(c => typeof c !== 'string' && c.props.backgroundColor === bg)) out.push(spacer + i)
  })
  return out
}

test('DESKTOP (2.4): the pane is one Client; it draws the room head, the agent rows and the chrome; a click on a row focuses it; a newcomer walks in on the fx clock, which then stops', { timeoutMs: 30_000 }, async ($, on) => {
  if (!ENABLED) return
  let agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', persona_id: 7 })]
  const { clock } = beneath(on, () => agents, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const client = await ui.find({ type: 'Client' })
  expect(client?.key).toBe(OFFICE_KEY)
  expect(client?.props.module).toBe('hooks/office-client.tsx')   // the source's literal is ./office-client.tsx; the engine carries the plugin's path
  expect(await ui.find({ type: 'Box' })).toBeUndefined()          // nothing but the Client in the plugin's own tree
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  const p0 = await officeProps(ui)
  expect(p0.v).toBe(1)
  expect(p0.rooms.map(r => r.agents.map(a => a.id))).toEqual([['lead', 'a1']])
  await ui.resize({ in: OFFICE_KEY, columns: 45, rows: 30 })
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /^🟢$/ }), 'the counts icon').toBeDefined()   // the header's counts, a Text per run (THE HEBREW RULE)
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /^2$/ }), 'the count').toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'showDone' }), 'showDone').toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'still' }), 'still').toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }), 'search').toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /💬/ }), 'the lead mark').toBeDefined()         // the lead's mark (with its minutes)
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /Opus 5\.5/ }), 'the pill').toBeDefined()   // the model pill
  expect(await withBg(ui, FX_BG.focus)).toBe(false)
  // the lead is the first row under the room head (layout row 1), the whole row its hit
  const x = 5
  const y = CHROME_ROWS + 1
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x, y, button: 'left' })
  // the click gave the row the keyboard focus (highlighted) and posted `open`: the hook opened its drawer
  const pOpen = await officeProps(ui)
  expect(pOpen.selected).toBe('lead')
  expect(pOpen.drawer?.id).toBe('lead')
  expect(await bgRows(ui, pOpen, FX_BG.focus)).toEqual([1])
  // the chrome is dead: a click on the toolbar row moves no focus
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 2, y: 1, button: 'left' })
  expect(await bgRows(ui, pOpen, FX_BG.focus)).toEqual([1])
  // toolbar: ☐ pressed by key → its post flips the pref → the next props carry it
  expect(pOpen.prefs.showDone).toBe(false)
  await ui.press({ key: 'showDone' })
  expect((await officeProps(ui)).prefs.showDone).toBe(true)
  // a newcomer walks in: its emoji (the third row: layout row 3) starts WALK_CELLS inside the reading edge and steps out
  // to it on the fx clock, which then stops (no setState loop)
  agents = [...agents, agent({ id: 'n1', persona_id: 5, role: 'index the docs' })]
  await clock.advance(POLL_MS * 4)   // SETTLE
  const p1 = await officeProps(ui)
  const n1 = p1.rooms[0]?.agents.find(a => a.id === 'n1')
  expect(n1?.enteredAt).toBeGreaterThan(0)
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /index the …/ })).toBeDefined()   // (its name gives the walk-in its cells: cut by WALK_CELLS at the start)
  expect(await drawnRow(ui, p1, 3)).toBe(laidRow(p1, walking('n1', 0), 3))
  expect(await drawnRow(ui, p1, 3)).not.toBe(laidRow(p1, NO_DECOR, 3))
  await ui.advance(FX_TICK_MS)
  expect(await drawnRow(ui, p1, 3)).toBe(laidRow(p1, walking('n1', FX_TICK_MS / FX_ENTER_MS), 3))
  await ui.advance(FX_ENTER_MS)
  expect(await drawnRow(ui, p1, 3)).toBe(laidRow(p1, NO_DECOR, 3))   // home
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /^index the docs$/ })).toBeDefined()   // ... and the name whole once home
  await ui.advance(FX_TICK_MS * 8)   // the clock is stopped: nothing else happens
  expect(await drawnRow(ui, p1, 3)).toBe(laidRow(p1, NO_DECOR, 3))
  expect(await bgRows(ui, p1, FX_BG.focus)).toEqual([1])      // the focus survived the publish
  await ui.unmount()
})

test('DESKTOP (2.4): the engine scrolls natively — the Client is full height and the engine\'s offset reaches it as props.offset', async ($, on) => {
  if (!ENABLED) return
  const many = Array.from({ length: 30 }, (_, i) => agent({ id: `a${i}`, session_full: `s${i % 3}`, session: `s${i % 3}` }))
  const { clock } = beneath(on, () => many, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 20 } } })
  const client = await ui.find({ type: 'Client' })
  const p0 = client?.props.props as OfficeProps
  expect(p0.offset).toBe(0)
  expect(p0.rows).toBe(20)
  expect(p0.columns).toBe(45)
  expect(client?.props.width).toBe(45)
  expect(client?.props.height as number).toBeGreaterThan(20)        // taller than the body: the engine shows a scrollbar
  await ui.redraw({ ...PANE.props, scroll: { offset: 3, bodyRows: 20 } })
  const after = await ui.find({ type: 'Client' })
  expect((after?.props.props as OfficeProps).offset).toBe(3)
  expect(after?.props.height).toBe(client?.props.height)            // the content did not change: neither did the height
  await ui.unmount()
})

test('DESKTOP (2.4): keys walk the rows; the search Input keeps its text across a publish and the debounce; an fx runs its clock and stops', { timeoutMs: 30_000 }, async ($, on) => {
  if (!ENABLED) return
  // four agents at 45 columns: lead, a1, a2, a3 on layout rows 1..4
  let agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', persona_id: 7 }), agent({ id: 'a2', persona_id: 8 }), agent({ id: 'a3', persona_id: 9 })]
  const { clock } = beneath(on, () => agents, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ in: OFFICE_KEY, columns: 45, rows: 30 })
  const p0 = await officeProps(ui)
  // a click gives the Client the focus (on the lead); `j` walks it row by row
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 5, y: CHROME_ROWS + 1, button: 'left' })
  const pSel = await officeProps(ui)                        // the click's `open` opened the lead's drawer (the chrome grew)
  expect(pSel.selected).toBe('lead')
  expect(await bgRows(ui, pSel, FX_BG.focus)).toEqual([1])
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await bgRows(ui, pSel, FX_BG.focus)).toEqual([3])   // a2
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await bgRows(ui, pSel, FX_BG.focus)).toEqual([4])   // a3
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await bgRows(ui, pSel, FX_BG.focus)).toEqual([4])   // clamped at the last row
  await ui.key({ in: OFFICE_KEY, key: 'k' })
  expect(await bgRows(ui, pSel, FX_BG.focus)).toEqual([3])
  expect((await officeProps(ui)).selected).toBe('lead')     // j / k post nothing (the focus is the module's own): the drawer stays
  await ui.key({ in: OFFICE_KEY, key: 'f' })                // the toolbar's showDone: a post, the pref flips
  expect((await officeProps(ui)).prefs.showDone).toBe(true)
  await ui.key({ in: OFFICE_KEY, key: 'up' })               // focus a1 (up from a2) ...
  await ui.key({ in: OFFICE_KEY, key: 'return' })           // ... and open it: its drawer replaces the lead's
  expect((await officeProps(ui)).drawer?.id).toBe('a1')
  await ui.key({ in: OFFICE_KEY, key: 'x' })                // x closes it
  expect((await officeProps(ui)).drawer).toBeNull()
  expect(await bgRows(ui, p0, FX_BG.focus)).toEqual([2])    // a1's row (no drawer: the chrome is p0's again)
  // typing while a publish lands (a1 moves to Write): the field keeps 'ab' through the redraw and the debounce
  await ui.input({ key: 'search', text: 'ab', kind: 'change' })
  agents = agents.map(a => (a.id === 'a1' ? { ...a, tool: 'Write' } : a))
  await clock.advance(POLL_MS * 2)
  expect((await officeProps(ui)).rooms[0]?.agents.find(a => a.id === 'a1')?.fam).toBe('write')   // the publish redrew the Client
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('ab')
  expect((await officeProps(ui)).search).toBe('')           // not yet: the module waits SEARCH_DEBOUNCE_MS of quiet
  await ui.advance(SEARCH_DEBOUNCE_MS)                      // the search post goes out: the hook writes view.search, the pane redraws
  expect((await officeProps(ui)).search).toBe('ab')
  expect((await officeProps(ui)).empty?.kind).toBe('nomatch') // nobody matches "ab"
  await ui.advance(SEARCH_DEBOUNCE_MS * 4)
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('ab') // the echo keeps the typed text
  // Enter with an empty field: the module posts at once and keeps '' as its text; the hook clears view.search
  await ui.input({ key: 'search', text: '', kind: 'submit' })
  expect((await officeProps(ui)).search).toBe('')
  agents = agents.map(a => (a.id === 'a2' ? { ...a, tool: 'Grep' } : a))
  await clock.advance(POLL_MS * 2)
  expect((await officeProps(ui)).rooms[0]?.agents.find(a => a.id === 'a2')?.fam).toBe('search')
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('')
  // a newcomer walks in: n1 is the fifth row (layout row 5); home after FX_ENTER_MS; no fault, no loop
  agents = [...agents, agent({ id: 'n1', persona_id: 5 })]
  await clock.advance(POLL_MS * 4)
  const p1 = await officeProps(ui)
  expect(await drawnRow(ui, p1, 5)).toBe(laidRow(p1, walking('n1', 0), 5))
  expect(await drawnRow(ui, p1, 5)).not.toBe(laidRow(p1, NO_DECOR, 5))
  await ui.advance(FX_ENTER_MS + FX_TICK_MS)
  expect(await drawnRow(ui, p1, 5)).toBe(laidRow(p1, NO_DECOR, 5))
  await ui.advance(FX_TICK_MS * 8)
  expect(await drawnRow(ui, p1, 5)).toBe(laidRow(p1, NO_DECOR, 5))
  await ui.unmount()
})

test('DESKTOP (2.4): the window — a spacer for the rows scrolled past, the rows of the window, a click in full-layout coordinates', async ($, on) => {
  if (!ENABLED) return
  const many = Array.from({ length: 40 }, (_, i) => agent({ id: `a${i}` }))
  const { clock } = beneath(on, () => many, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, scroll: { offset: 12, bodyRows: 10 } } })
  const p = await officeProps(ui)
  expect(p.offset).toBe(12)
  expect(p.rows).toBe(10)
  const chrome = chromeRows(p)
  expect(chrome).toBe(CHROME_ROWS)
  const kids = await kidsOf(ui)
  const chromeElements = 3 + (p.footer ? 1 : 0)
  const { from, count } = windowOf(chrome, 12, 10, Number.POSITIVE_INFINITY, 45)
  expect(from).toBe(12 - chrome)
  expect(count).toBe(10)
  expect(kids[chromeElements]).toMatchObject({ type: 'Box', props: { height: from } })
  expect(kids.length).toBe(chromeElements + 1 + count)
  // a12's row is layout row 13, inside the window (9..18): the click lands on it (its row is highlighted)
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 5, y: chrome + 13, button: 'left' })
  expect((await officeProps(ui)).selected).toBe('a12')         // the click's `open` reached the hooks: a12's drawer
  await ui.press({ key: 'close' })                              // closed again: the chrome is the window's three lines
  expect((await officeProps(ui)).drawer).toBeNull()
  expect(await bgRows(ui, p, FX_BG.focus)).toEqual([13])
  // a hover over a13 (the row under it) highlights its row — another row, another colour; leaving clears it. (A row above
  // the window, in the spacer, draws nothing.)
  await ui.pointer({ in: OFFICE_KEY, type: 'move', x: 30, y: chrome + 14 })
  expect(await bgRows(ui, p, HOVER_BG)).toEqual([14])
  expect(await bgRows(ui, p, FX_BG.focus)).toEqual([13])
  await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
  expect(await withBg(ui, HOVER_BG)).toBe(false)
  expect(await bgRows(ui, p, FX_BG.focus)).toEqual([13])
  // a click in the spacer (a row scrolled past, drawn as blank rows) opens nothing; the hover there is nothing either
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 5, y: chrome + 1, button: 'left' })
  expect((await officeProps(ui)).selected).toBeNull()
  await ui.pointer({ in: OFFICE_KEY, type: 'move', x: 5, y: chrome + 1 })
  expect(await withBg(ui, HOVER_BG)).toBe(false)
  await ui.unmount()
})

test('DESKTOP: a drawer or the help opened while the pane is scrolled opens IN VIEW — drawn at the top of the window, after the spacer, with the office rows under it where they were (the clicked row still drawn, focused); closed, the window is as before', async ($, on) => {
  if (!ENABLED) return
  // 60 agents at 30 columns: 61 layout rows; a 25-row window scrolled 40 rows down shows layout rows from 37
  const many = Array.from({ length: 60 }, (_, i) => agent({ id: `a${i}` }))
  const { clock } = beneath(on, () => many, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 30, scroll: { offset: 40, bodyRows: 25 } } })
  const p0 = await officeProps(ui)
  expect(p0.offset).toBe(40)
  expect(layoutOffice(p0).rows.length).toBe(61)
  const before = await drawnRows(ui, p0)
  expect(before.spacer).toBe(37)
  // a click on a36 (its row is layout row 37, the window's first row)
  const hit = layoutOffice(p0).hits.find(h => h.kind === 'agent' && h.id === 'a36')!
  expect(hit.y).toBe(37)
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: hit.x + 2, y: chromeRows(p0) + hit.y, button: 'left' })
  const p1 = await officeProps(ui)
  expect(p1.drawer?.id).toBe('a36')
  expect(p1.offset).toBe(40)                                         // nothing scrolled: the engine's window stays
  // the module's tree: the fixed chrome, the spacer, the DRAWER (the window's top: Client row 3 + 37 = 40), then the rows
  const kids = await kidsOf(ui)
  expect(kids[CHROME_ROWS]).toMatchObject({ type: 'Box', props: { height: 37 } })
  expect(isOverlay(kids[CHROME_ROWS]!)).toBe(false)
  expect(kids[CHROME_ROWS + 1]).toMatchObject({ type: 'Box', props: { borderStyle: 'double' } })
  expect(textOf(kids[CHROME_ROWS + 1]!)).toMatch(/משימה/)        // the drawer's task heading
  // ... and the rows under it start at the same layout row: the clicked row is drawn, with the selection on it
  const open = await drawnRows(ui, p1)
  expect(open.spacer).toBe(37)
  expect(await drawnRow(ui, p1, 37)).toBe(laidRow(p1, NO_DECOR, 37))
  expect(await drawnRow(ui, p1, 37)).toContain(p1.rooms[0]!.agents.find(a => a.id === 'a36')!.emoji)
  expect(await bgRows(ui, p1, FX_BG.focus)).toEqual([37])          // the click's focus (laid over its selection) on its row
  expect(open.rows.length).toBe(25 - (chromeRows(p1) - CHROME_ROWS))   // the window less the drawer's rows
  // the help (h) takes the same place; h again closes it, x the drawer: the window is as before
  await ui.key({ in: OFFICE_KEY, key: 'h' })
  const p2 = await officeProps(ui)
  expect(p2.helpOpen).toBe(true)
  const help = await kidsOf(ui)
  expect(help[CHROME_ROWS]).toMatchObject({ type: 'Box', props: { height: 37 } })
  expect(help[CHROME_ROWS + 1]).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
  expect(textOf(help[CHROME_ROWS + 1]!)).toMatch(/k \/ j/)
  await ui.key({ in: OFFICE_KEY, key: 'h' })
  await ui.key({ in: OFFICE_KEY, key: 'x' })
  const p3 = await officeProps(ui)
  expect(p3.drawer).toBeNull()
  expect((await kidsOf(ui)).some(isOverlay)).toBe(false)
  expect((await drawnRows(ui, p3)).spacer).toBe(37)
  expect(await drawnRow(ui, p3, 37)).toBe(await drawnRow(ui, p0, 37))
  await ui.unmount()
})
