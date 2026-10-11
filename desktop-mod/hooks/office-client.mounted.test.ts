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
// What the module POSTS cannot be seen from here: a `ui.message` reaches only
// the posting plugin's own hooks (never a test hook beneath), and that hook
// is Task 2.5's. So these cases assert what the mounted module shows of its
// own — the keyboard focus a click or `j` lands on a tile, the search Input
// keeping its text across a publish, the fx clocks running and stopping, the
// spacer and the window — and Task 2.5's tests assert the posts' effects
// (the drawer opening, `showDone` flipping in the store, `props.search`).
// Until then the engine's core answers `{}` to every post: heard, nothing
// changes.

import { expect, mock, test } from 'claude-code/testing'

import { EMPTY_PAYLOAD, PERSONA_EMOJI, POLL_MS } from './model'
import type { Agent } from './model'
import { CHROME_ROWS, chromeRows, windowOf } from './office-chrome'
import { FX_BG, FX_ENTER_MS, FX_TICK_MS, SEARCH_DEBOUNCE_MS } from './office-client'
import { TILE_W } from './office-layout'
import { OFFICE_KEY } from './office-props'
import type { OfficeProps } from './office-props'

/** Enabled in Task 2.4 (the desktop branch of ui.tsx returns the Client). */
const ENABLED = true

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

/** The LAYOUT rows (0 = the first room head) whose drawn Text carries a run with `bg` as its backgroundColor. */
async function bgRows(ui: Finder, p: OfficeProps, bg: string): Promise<number[]> {
  const kids = await kidsOf(ui)
  const chromeEls = 3 + (p.footer ? 1 : 0) + (p.helpOpen || p.drawer ? 1 : 0)
  const body = kids.slice(chromeEls)
  const spacer = body[0]?.type === 'Box' ? Number(body[0].props.height ?? 0) : 0
  const rows = spacer > 0 ? body.slice(1) : body
  const out: number[] = []
  rows.forEach((row, i) => {
    if ((row.children ?? []).some(c => typeof c !== 'string' && c.props.backgroundColor === bg)) out.push(spacer + i)
  })
  return out
}

test('DESKTOP (2.4): the pane is one Client; it draws the room head, the tiles and the chrome; a click on a tile focuses it; a newcomer walks in on the fx clock, which then stops', async ($, on) => {
  if (!ENABLED) return
  let agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', persona_id: 7 })]
  const { clock } = beneath(on, () => agents)
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
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /🟢 2/ })).toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'showDone' })).toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'still' })).toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' })).toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /💬/ })).toBeDefined()         // the room head's title and the lead's mark
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /Opus 5\.5/ })).toBeDefined()   // the model pill
  expect(await withBg(ui, FX_BG.focus)).toBe(false)
  // the lead is the first tile: RTL → at the right edge; its tile starts one row under the room head (layout row 1)
  const x = 45 - TILE_W + 2
  const y = CHROME_ROWS + 1 + 2
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x, y, button: 'left' })
  // the click gave the tile the keyboard focus (its head row is highlighted) and posted `open` (Task 2.5's hook opens the drawer)
  expect(await bgRows(ui, p0, FX_BG.focus)).toEqual([1])
  // the chrome is dead: a click on the toolbar row moves no focus
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 2, y: 1, button: 'left' })
  expect(await bgRows(ui, p0, FX_BG.focus)).toEqual([1])
  // toolbar: ☐ is pressable by key (its post is Task 2.5's)
  await ui.press({ key: 'showDone' })
  // a newcomer walks in: FX_BG.enter on its tile, the fx clock runs FX_ENTER_MS then stops (no setState loop)
  agents = [...agents, agent({ id: 'n1', persona_id: 5, role: 'index the docs' })]
  await clock.advance(POLL_MS * 4)   // SETTLE
  const p1 = await officeProps(ui)
  const n1 = p1.rooms[0]?.agents.find(a => a.id === 'n1')
  expect(n1?.enteredAt).toBeGreaterThan(0)
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /index the docs/ })).toBeDefined()
  expect(await bgRows(ui, p1, FX_BG.enter)).toEqual([1, 3])   // the head and the name row of n1's tile (the first block)
  await ui.advance(FX_ENTER_MS + FX_TICK_MS)
  expect(await withBg(ui, FX_BG.enter)).toBe(false)
  await ui.advance(FX_TICK_MS * 8)   // the clock is stopped: nothing else happens
  expect(await withBg(ui, FX_BG.enter)).toBe(false)
  expect(await bgRows(ui, p1, FX_BG.focus)).toEqual([1])      // the focus survived the publish
  await ui.unmount()
})

test('DESKTOP (2.4): the engine scrolls natively — the Client is full height and the engine\'s offset reaches it as props.offset', async ($, on) => {
  if (!ENABLED) return
  const many = Array.from({ length: 30 }, (_, i) => agent({ id: `a${i}`, session_full: `s${i % 3}`, session: `s${i % 3}` }))
  const { clock } = beneath(on, () => many)
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

test('DESKTOP (2.4): keys walk the tiles; the search Input keeps its text across a publish and the debounce; an fx runs its clock and stops', async ($, on) => {
  if (!ENABLED) return
  // four agents at 45 columns (3 tiles per row): lead, a1, a2 in the first block, a3 alone in the second
  let agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', persona_id: 7 }), agent({ id: 'a2', persona_id: 8 }), agent({ id: 'a3', persona_id: 9 })]
  const { clock } = beneath(on, () => agents)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ in: OFFICE_KEY, columns: 45, rows: 30 })
  const p0 = await officeProps(ui)
  // a click gives the Client the focus (on the lead); `j` walks it tile by tile — into the second block (layout row 7)
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 45 - TILE_W + 2, y: CHROME_ROWS + 1 + 2, button: 'left' })
  expect(await bgRows(ui, p0, FX_BG.focus)).toEqual([1])
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await bgRows(ui, p0, FX_BG.focus)).toEqual([1])   // a2: still the first block
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await bgRows(ui, p0, FX_BG.focus)).toEqual([7])   // a3: the second block
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await bgRows(ui, p0, FX_BG.focus)).toEqual([7])   // clamped at the last tile
  await ui.key({ in: OFFICE_KEY, key: 'k' })
  expect(await bgRows(ui, p0, FX_BG.focus)).toEqual([1])
  await ui.key({ in: OFFICE_KEY, key: 'f' })                // the toolbar's showDone: a post (Task 2.5's), nothing local
  await ui.key({ in: OFFICE_KEY, key: 'return' })           // open the focused tile: a post (Task 2.5's)
  expect(await bgRows(ui, p0, FX_BG.focus)).toEqual([1])
  // typing while a publish lands (a1 moves to Write): the field keeps 'ab' through the redraw and the debounce
  await ui.input({ key: 'search', text: 'ab', kind: 'change' })
  agents = agents.map(a => (a.id === 'a1' ? { ...a, tool: 'Write' } : a))
  await clock.advance(POLL_MS * 2)
  expect((await officeProps(ui)).rooms[0]?.agents.find(a => a.id === 'a1')?.fam).toBe('write')   // the publish redrew the Client
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('ab')
  await ui.advance(SEARCH_DEBOUNCE_MS)                      // the search post goes out (Task 2.5 echoes it into props.search)
  await ui.advance(SEARCH_DEBOUNCE_MS * 4)
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('ab')
  expect((await officeProps(ui)).search).toBe('')           // no hook answered: the hooks' search is still empty, the field keeps the text
  // Enter with an empty field: the module posts at once and keeps '' as its text — drawn as the Input's value on its
  // next render (a keystroke never redraws: the engine's field is live; here the next publish is that render)
  await ui.input({ key: 'search', text: '', kind: 'submit' })
  agents = agents.map(a => (a.id === 'a2' ? { ...a, tool: 'Grep' } : a))
  await clock.advance(POLL_MS * 2)
  expect((await officeProps(ui)).rooms[0]?.agents.find(a => a.id === 'a2')?.fam).toBe('search')
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('')
  // a newcomer walks in: FX_BG.enter on its tile, gone after FX_ENTER_MS; no fault, no loop
  agents = [...agents, agent({ id: 'n1', persona_id: 5 })]
  await clock.advance(POLL_MS * 4)
  const p1 = await officeProps(ui)
  expect(await bgRows(ui, p1, FX_BG.enter)).toEqual([7, 9])   // n1 is the second tile of the second block
  await ui.advance(FX_ENTER_MS + FX_TICK_MS)
  expect(await withBg(ui, FX_BG.enter)).toBe(false)
  await ui.advance(FX_TICK_MS * 8)
  expect(await withBg(ui, FX_BG.enter)).toBe(false)
  await ui.unmount()
})

test('DESKTOP (2.4): the window — a spacer for the rows scrolled past, the rows of the window, a click in full-layout coordinates', async ($, on) => {
  if (!ENABLED) return
  const many = Array.from({ length: 12 }, (_, i) => agent({ id: `a${i}` }))
  const { clock } = beneath(on, () => many)
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
  // a6's tile is the third block (layout rows 13..18), inside the window: the click lands on it (its head row is highlighted)
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 45 - TILE_W + 2, y: chrome + 13 + 2, button: 'left' })
  expect(await bgRows(ui, p, FX_BG.focus)).toEqual([13])
  // a hover over a7 (the second tile of the same block, one tile to the left in RTL) highlights its head row — the
  // same row as the focus, another colour; leaving clears it. (A tile above the window, in the spacer, draws nothing.)
  await ui.pointer({ in: OFFICE_KEY, type: 'move', x: 45 - 2 * TILE_W - 1 + 2, y: chrome + 13 + 1 })
  expect(await bgRows(ui, p, FX_BG.hover)).toEqual([13])
  expect(await bgRows(ui, p, FX_BG.focus)).toEqual([13])
  await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
  expect(await withBg(ui, FX_BG.hover)).toBe(false)
  expect(await bgRows(ui, p, FX_BG.focus)).toEqual([13])
  await ui.unmount()
})
