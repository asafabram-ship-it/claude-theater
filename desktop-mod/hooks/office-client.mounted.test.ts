// office-client.tsx MOUNTED through the kit on the desktop — every case is
// SKIPPED (`ENABLED = false`; the kit has no test.skip): enable in Task 2.4,
// once ui.tsx's desktop branch returns the Client from a literal path. The
// engine reads a plugin's surface modules off its hooks module, so before
// that neither a test hook beneath the plugin nor an inline test plugin
// (copied to a temp folder) can draw `./office-client.tsx`; Task 2.3 tested
// the module directly (office-client.test.ts). The first two tests are the
// brief's (adapted to the Phase 0 amendment: the engine scrolls natively over
// a full-height Client, `props.offset` is the engine's window); the others
// are Task 2.3's drafts against the mounted module. Task 2.5's `ui.message`
// hook is what turns the posts into prefs / view changes.

import { expect, mock, test } from 'claude-code/testing'

import { EMPTY_PAYLOAD, PERSONA_EMOJI, POLL_MS } from './model'
import type { Agent } from './model'
import { CHROME_ROWS, chromeRows } from './office-chrome'
import { FX_BG, FX_ENTER_MS, FX_TICK_MS, SEARCH_DEBOUNCE_MS } from './office-client'
import { TILE_W } from './office-layout'
import { OFFICE_KEY } from './office-props'
import type { OfficeProps } from './office-props'

/** Enable in Task 2.4 (the desktop branch of ui.tsx returns the Client). */
const ENABLED = false

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

test('DESKTOP (2.4): the pane is one Client; it draws the room head, the tiles and the chrome; a click on a tile opens the drawer', async ($, on) => {
  if (!ENABLED) return
  let agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', persona_id: 7 })]
  const { clock, store } = beneath(on, () => agents)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const client = await ui.find({ type: 'Client' })
  expect(client?.key).toBe(OFFICE_KEY)
  expect(client?.props.module).toBe('./office-client.tsx')
  expect(await ui.find({ type: 'Box' })).toBeUndefined()          // nothing but the Client in the plugin's own tree
  await ui.resize({ in: OFFICE_KEY, columns: 45, rows: 30 })
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /🟢 2/ })).toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'showDone' })).toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' })).toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /💬/ })).toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  // the lead is the first tile: RTL → at the right edge; its tile starts one row under the room head
  const x = 45 - TILE_W + 2
  const y = CHROME_ROWS + 1 + 2
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x, y, button: 'left' })
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /המשימה|משימה|Task/ })).toBeDefined()   // the drawer opened (labels.dTask)
  await ui.press({ key: 'close' })
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /המשימה|משימה|Task/ })).toBeUndefined()
  // toolbar: ☑ toggles showDone through ui.message → prefs → store
  await ui.press({ key: 'showDone' })
  expect((store.prefs as { showDone: boolean }).showDone).toBe(true)
  // a newcomer walks in: the fx clock runs FX_ENTER_MS then stops (no setState loop)
  agents = [...agents, agent({ id: 'n1', persona_id: 5 })]
  await clock.advance(POLL_MS * 4)   // SETTLE
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /n1|סוכן/ })).toBeDefined()
  await ui.advance(FX_ENTER_MS + 250)
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
  expect(client?.props.height as number).toBeGreaterThan(20)        // taller than the body: the engine shows a scrollbar
  await ui.redraw({ ...PANE.props, scroll: { offset: 3, bodyRows: 20 } })
  const after = await ui.find({ type: 'Client' })
  expect((after?.props.props as OfficeProps).offset).toBe(3)
  await ui.unmount()
})

test('DESKTOP (2.4 + 2.5): keys and Buttons reach prefs / view; the search Input keeps its text across a publish and posts once; an fx runs its clock and stops', async ($, on) => {
  if (!ENABLED) return
  let agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', persona_id: 7 })]
  const { clock, store } = beneath(on, () => agents)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ in: OFFICE_KEY, columns: 45, rows: 30 })
  // a click gives the Client the focus; `f` is the toolbar's showDone
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 45 - TILE_W + 2, y: CHROME_ROWS + 1 + 2, button: 'left' })
  await ui.press({ key: 'close' })
  await ui.key({ in: OFFICE_KEY, key: 'f' })
  expect((store.prefs as { showDone: boolean }).showDone).toBe(true)
  // typing while a publish lands: the field keeps 'ab'; the search post lands after the debounce
  await ui.input({ key: 'search', text: 'ab', kind: 'change' })
  await clock.advance(POLL_MS)
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('ab')
  await ui.advance(SEARCH_DEBOUNCE_MS)
  await clock.advance(200)   // the redraw latch
  expect(((await ui.find({ type: 'Client' }))?.props.props as OfficeProps).search).toBe('ab')
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('ab')
  await ui.input({ key: 'search', text: '', kind: 'submit' })
  // a newcomer walks in: FX_BG.enter on its tile, gone after FX_ENTER_MS; no fault, no loop
  agents = [...agents, agent({ id: 'n1', persona_id: 5 })]
  await clock.advance(POLL_MS * 4)
  expect((await ui.findAll({ in: OFFICE_KEY, type: 'Text' })).some(n => n.props.backgroundColor === FX_BG.enter)).toBe(true)
  await ui.advance(FX_ENTER_MS + FX_TICK_MS)
  expect((await ui.findAll({ in: OFFICE_KEY, type: 'Text' })).some(n => n.props.backgroundColor === FX_BG.enter)).toBe(false)
  await ui.advance(FX_TICK_MS * 8)
  await ui.unmount()
})

test('DESKTOP (2.4): the window — a spacer for the rows scrolled past, the rows of the window, a click in full-layout coordinates', async ($, on) => {
  if (!ENABLED) return
  const many = Array.from({ length: 12 }, (_, i) => agent({ id: `a${i}` }))
  const { clock } = beneath(on, () => many)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, scroll: { offset: 12, bodyRows: 10 } } })
  const p = (await ui.find({ type: 'Client' }))?.props.props as OfficeProps
  const chrome = chromeRows(p)
  const drawn = await ui.drawn({ in: OFFICE_KEY })
  const kids = (drawn as unknown as { children: Array<{ type: string; props: Record<string, unknown> }> }).children
  const chromeElements = 3 + (p.footer ? 1 : 0)
  expect(kids[chromeElements]).toMatchObject({ type: 'Box', props: { height: 12 - chrome } })
  expect(kids.length).toBe(chromeElements + 1 + 10)
  // a6's tile is the third block (layout rows 13..18), inside the window: the click opens it
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 45 - TILE_W + 2, y: chrome + 13 + 2, button: 'left' })
  await clock.advance(200)
  expect(((await ui.find({ type: 'Client' }))?.props.props as OfficeProps).selected).toBe('a6')
  await ui.unmount()
})
