// The desktop office's way back into the hooks, driven through the kit on the
// real mount (Task 2.5): the office Client (office-client.tsx) POSTS what the
// person did — a toolbar Button, a letter key, a click on a tile or a room
// head, the search Input — and the plugin's `ui.message` hook (ui.tsx) turns
// each post into the same prefs / view / $.store change the text cards' press
// makes, one atom per message; anything else it ignores. And the fallback: a
// `ui.fault` of the office (register.tsx) draws the text cards and toasts
// once; `/theater` tries the Client again.
//
// A post is seen only by the posting plugin's own hooks (never a test hook
// beneath), so these tests read its effects: the store, the counted $.state
// writes beneath, and the Client's props on the next draw.

import { expect, test } from 'claude-code/testing'
import type { JsonValue } from 'claude-code'

import type { Agent } from './model'
import { PERSONA_EMOJI, POLL_MS, REDRAW_LATCH_MS } from './model'
import { SEARCH_MAX, chromeRows } from './office-chrome'
import { SEARCH_DEBOUNCE_MS } from './office-client'
import { officeModel, type Hit } from './office-layout'
import { OFFICE_KEY, type OfficeProps } from './office-props'
import { T0, beneath } from './test-kit'

const SA = 'sess-aaaa-1111-frontend'
const SB = 'sess-bbbb-2222-research'
const PANE = {
  plugin: 'agent-theater', component: 'Pane', requestId: 'agent-theater',
  props: { title: 'T', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const THEATER = { command: 'theater', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

function agent(over: Partial<Agent> & { id: string }): Agent {
  return {
    persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: '', subagent_type: 'Explore', status: 'running', tool: 'Read', phase: 'tool',
    task: `Task of ${over.id}.`, task_short: `Task of ${over.id}.`, result: null, start_ms: T0 - 30_000, end_ms: null,
    session: SA.slice(0, 8), session_full: SA, cwd: '/home/dev/acme-web', project: '/home/dev/acme-web', mtime_ms: T0 - 1000,
    is_session: false, closed: false, is_workflow: false, truncated: false, model: 'claude-opus-5-5', ...over,
  }
}

/** The $.store the tests start from: Hebrew, the chime on, finished hidden, no pins. */
const PREFS = () => ({ prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })

/** Room A (a lead, a reader, a finished writer) and room B (one MCP agent). */
function fixture(): Agent[] {
  return [
    agent({ id: 'lead-a', is_session: true, tool: '', phase: 'thinking', topic: 'Ship the v2 config migration.' }),
    agent({ id: 'a1', role: 'map session-token validation', persona_id: 7 }),
    agent({ id: 'a2', role: 'draft the v2 migration guide', status: 'done', tool: 'Write', end_ms: T0 - 2000, result: 'Done.', persona_id: 11 }),
    agent({ id: 'b1', role: 'triage open bugs', tool: 'mcp__github__search_issues', session: SB.slice(0, 8), session_full: SB, project: '/home/dev/research', cwd: '/home/dev/research', persona_id: 9 }),
  ]
}

type Ui = {
  find: (q: { type?: string; key?: string; text?: RegExp; in?: string }) => Promise<{ text?: string; props: Record<string, unknown> } | undefined>
  pointer: (ev: { in?: string; type: 'down'; x: number; y: number; button: 'left' }) => Promise<void>
}

/** The office Client's props as last drawn. */
async function propsOf(ui: Ui): Promise<OfficeProps> {
  const c = await ui.find({ type: 'Client' })
  expect(c).toBeDefined()
  return c!.props.props as OfficeProps
}

/** A left click inside the Client on the layout hit `kind`/`id` (a row, a room's pin or its ✅ counts), where the module draws it. */
async function click(ui: Ui, kind: Hit['kind'], id: string): Promise<void> {
  const p = await propsOf(ui)
  const hit = officeModel(p).hits.find(h => h.kind === kind && h.id === id)
  expect(hit).toBeDefined()
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: hit!.x, y: chromeRows(p) + hit!.y, button: 'left' })
}

/** The writes an act made, by key ($.state, then $.store): only the non-zero ones. */
async function writesOf(captured: ReturnType<typeof beneath>['captured'], act: () => Promise<unknown>): Promise<Record<string, number>> {
  const w0 = { ...captured.writes }
  const s0 = { ...captured.storeWrites }
  await act()
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(captured.writes)) if (n !== (w0[k] ?? 0)) out[k] = n - (w0[k] ?? 0)
  for (const [k, n] of Object.entries(captured.storeWrites)) if (n !== (s0[k] ?? 0)) out[`store:${k}`] = n - (s0[k] ?? 0)
  return out
}

test('ui.message: the office Client\'s own posts — toolbar Buttons, letter keys, tile and room-head clicks, the search Input — change prefs / view / the store as the text cards\' presses do, one atom per message', { timeoutMs: 30_000 }, async ($, on) => {
  let agents = fixture()
  const { captured, clock } = beneath(on, () => agents, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  expect(OFFICE_KEY).toBe('office') // the ui.message / ui.fault matchers carry it as a literal (validate reads matchers statically)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ in: OFFICE_KEY, columns: 90, rows: 40 })
  const p0 = await propsOf(ui)
  expect(p0.prefs).toEqual({ showDone: false, muted: false, still: false })
  expect(p0.rooms.map(r => r.agents.map(a => a.id))).toEqual([['lead-a', 'a1', 'a2'], ['b1']])   // (a2, finished, is among room A's recent finished)

  // showDone (the toolbar Button): the pref and its store mirror, nothing else; the finished writer is drawn
  expect(await writesOf(captured, () => ui.press({ key: 'showDone' }))).toEqual({ prefs: 1, 'store:prefs': 1 })
  expect((captured.store.prefs as { showDone: boolean }).showDone).toBe(true)
  expect((await propsOf(ui)).prefs.showDone).toBe(true)
  expect((await propsOf(ui)).rooms[0]?.agents.map(a => a.id)).toEqual(['lead-a', 'a1', 'a2'])
  // ... and back by its letter, through the module's own key handler
  expect(await writesOf(captured, () => ui.key({ in: OFFICE_KEY, key: 'f' }))).toEqual({ prefs: 1, 'store:prefs': 1 })
  expect((await propsOf(ui)).prefs.showDone).toBe(false)

  // mute / still: one pref each
  expect(await writesOf(captured, () => ui.press({ key: 'mute' }))).toEqual({ prefs: 1, 'store:prefs': 1 })
  expect((captured.store.prefs as { muted: boolean }).muted).toBe(true)
  expect((await propsOf(ui)).prefs.muted).toBe(true)
  // (the still Button lives in the help popover since Task 2.8b-3: its letter with the help closed, its Button with it open)
  expect(await writesOf(captured, () => ui.key({ in: OFFICE_KEY, key: 's' }))).toEqual({ prefs: 1, 'store:prefs': 1 })
  expect((await propsOf(ui)).prefs.still).toBe(true)
  expect(await ui.find({ in: OFFICE_KEY, key: 'still' })).toBeUndefined()

  // help: one view write each way; open, it holds the still / demo / language Buttons
  expect(await writesOf(captured, () => ui.press({ key: 'help' }))).toEqual({ view: 1 })
  expect((await propsOf(ui)).helpOpen).toBe(true)
  expect((await ui.find({ in: OFFICE_KEY, key: 'still' }))?.text).toBe('תנועה 🖼')
  expect(await writesOf(captured, () => ui.press({ key: 'still' }))).toEqual({ prefs: 1, 'store:prefs': 1 })
  expect((await propsOf(ui)).prefs.still).toBe(false)
  expect((await ui.find({ in: OFFICE_KEY, key: 'still' }))?.text).toBe('תנועה 🎞')
  expect((await propsOf(ui)).helpOpen).toBe(true)   // a pref flip leaves the help open
  await ui.press({ key: 'help' })
  expect((await propsOf(ui)).helpOpen).toBe(false)

  // a click on a1's tile opens its drawer (selected, the help closed, the text cards' focus on its card); ✕ closes it
  expect(await writesOf(captured, () => click(ui, 'agent', 'a1'))).toEqual({ view: 1 })
  expect(captured.view).toMatchObject({ selected: 'a1', helpOpen: false, focusIndex: 1 })
  expect((await propsOf(ui)).drawer?.id).toBe('a1')
  expect(await writesOf(captured, () => ui.press({ key: 'close' }))).toEqual({ view: 1 })
  expect((await propsOf(ui)).selected).toBeNull()
  expect((await propsOf(ui)).drawer).toBeNull()

  // the pin on room B's head: prefs.pins (+ its mirror) → B is drawn first
  expect(await writesOf(captured, () => click(ui, 'pin', SB))).toEqual({ prefs: 1, 'store:prefs': 1 })
  expect((captured.store.prefs as { pins: string[] }).pins).toEqual([SB])
  expect((await propsOf(ui)).rooms.map(r => [r.id, r.pinned])).toEqual([[SB, true], [SA, false]])
  await click(ui, 'pin', SB)
  expect((captured.store.prefs as { pins: string[] }).pins).toEqual([])

  // room A's ✅ counts: the override lives in $.store, not $.state — no state write; the pane is redrawn ONCE by the
  // redraw latch REDRAW_LATCH_MS later (three toggles inside the latch: one redraw)
  expect(await writesOf(captured, async () => { await click(ui, 'roomDone', SA); await click(ui, 'roomDone', SA); await click(ui, 'roomDone', SA) })).toEqual({ 'store:roomDone': 3 })
  expect(captured.store.roomDone).toEqual({ [SA]: true })
  expect((await propsOf(ui)).rooms.find(r => r.id === SA)?.showDone).toBe(false) // not drawn yet
  const reads1 = captured.prefsReads
  await clock.advance(REDRAW_LATCH_MS)
  expect(captured.prefsReads).toBe(reads1 + 1) // one redraw (the render's one prefs read)
  expect((await propsOf(ui)).rooms.find(r => r.id === SA)).toMatchObject({ showDone: true })
  expect((await propsOf(ui)).rooms.find(r => r.id === SA)?.agents.map(a => a.id)).toEqual(['lead-a', 'a1', 'a2'])
  await click(ui, 'roomDone', SA)
  await clock.advance(REDRAW_LATCH_MS)
  expect(captured.store.roomDone).toEqual({})
  expect((await propsOf(ui)).rooms.find(r => r.id === SA)?.showDone).toBe(false)

  // the search Input — drawn only while the office shows more than SEARCH_FROM agents (spec 2026-10-10 §2 item 22): ten more
  // working agents in room B bring it; then the first keystroke reaches view.search at once (one view write: the hooks size
  // the chrome by it under ONE_LINE_FROM) and the rest after the module's debounce (one more), the office narrows; Enter with
  // the same text writes nothing; an empty Enter clears it; the ten leave again
  expect(await ui.find({ in: OFFICE_KEY, key: 'search' })).toBeUndefined()
  agents = [...fixture(), ...Array.from({ length: 10 }, (_, i) => agent({ id: `x${i}`, role: 'extra work', session: SB.slice(0, 8), session_full: SB, project: '/home/dev/research', cwd: '/home/dev/research', persona_id: 20 + i }))]
  await clock.advance(POLL_MS)
  expect(await ui.find({ in: OFFICE_KEY, key: 'search' })).toBeDefined()
  expect(await writesOf(captured, () => ui.input({ key: 'search', text: 't', kind: 'change' }))).toEqual({ view: 1 })
  expect((await propsOf(ui)).search).toBe('t')
  await ui.input({ key: 'search', text: 'triage', kind: 'change' })
  expect((await propsOf(ui)).search).toBe('t')
  expect(await writesOf(captured, () => ui.advance(SEARCH_DEBOUNCE_MS))).toEqual({ view: 1 })
  expect((await propsOf(ui)).search).toBe('triage')
  expect((await propsOf(ui)).rooms.map(r => r.agents.map(a => a.id))).toEqual([['b1']])
  expect(await ui.find({ in: OFFICE_KEY, key: 'search' })).toBeDefined()   // one agent shown, the search active: the field stays
  expect(await writesOf(captured, () => ui.input({ key: 'search', text: 'triage', kind: 'submit' }))).toEqual({})
  expect(await writesOf(captured, () => ui.input({ key: 'search', text: '', kind: 'submit' }))).toEqual({ view: 1 })
  expect((await propsOf(ui)).search).toBe('')
  agents = fixture()
  await clock.advance(POLL_MS)
  expect(await ui.find({ in: OFFICE_KEY, key: 'search' })).toBeUndefined()

  // the demo: view.demo on and off — its Button in the help popover (`דמו 🎬`, then `יציאה ✕ 🎬`), its letter with the help closed
  await ui.press({ key: 'help' })
  expect((await ui.find({ in: OFFICE_KEY, key: 'demo' }))?.text).toBe('דמו 🎬')
  expect(await writesOf(captured, () => ui.press({ key: 'demo' }))).toEqual({ view: 1 })
  expect((await propsOf(ui)).demo).toBe(true)
  expect((await ui.find({ in: OFFICE_KEY, key: 'demo' }))?.text).toBe('יציאה ✕ 🎬')
  await ui.press({ key: 'demo' })
  expect((await propsOf(ui)).demo).toBe(false)

  // the language: the pref (+ mirror) and the pane retitled in English with the working count; the module's labels follow
  // (the Button in the help popover: `🌐 English`, then `🌐 עברית`)
  expect((await ui.find({ in: OFFICE_KEY, key: 'lang' }))?.text).toBe('🌐 English')
  expect(await writesOf(captured, () => ui.press({ key: 'lang' }))).toEqual({ prefs: 1, 'store:prefs': 1 }) // the retitle is a ui.open, not a write
  expect((captured.store.prefs as { lang: string }).lang).toBe('en')
  expect(captured.opens[captured.opens.length - 1]).toBe('🟢 3 · 🎭 Theater')
  expect((await propsOf(ui)).lang).toBe('en')
  expect((await propsOf(ui)).rtl).toBe(false)
  expect((await ui.find({ in: OFFICE_KEY, key: 'lang' }))?.text).toBe('🌐 עברית')
  expect((await ui.find({ in: OFFICE_KEY, key: 'showDone' }))?.text).toBe('☐ Show finished')
  await ui.press({ key: 'help' })
  await ui.key({ in: OFFICE_KEY, key: 'l' })
  expect((await propsOf(ui)).lang).toBe('he')
  expect((await ui.find({ in: OFFICE_KEY, key: 'showDone' }))?.text).toBe('הצג שסיימו ☐')
  expect(await writesOf(captured, () => ui.key({ in: OFFICE_KEY, key: 'd' }))).toEqual({ view: 1 })
  expect((await propsOf(ui)).demo).toBe(true)
  await ui.key({ in: OFFICE_KEY, key: 'd' })
  expect((await propsOf(ui)).demo).toBe(false)

  // j / k move the module's own keyboard focus and post nothing: no write (a write would redraw the pane per key)
  await click(ui, 'agent', 'lead-a')
  await ui.press({ key: 'close' })
  expect(await writesOf(captured, async () => { await ui.key({ in: OFFICE_KEY, key: 'j' }); await ui.key({ in: OFFICE_KEY, key: 'k' }) })).toEqual({})
  await ui.unmount()
})

test('ui.message: what is not an office message is ignored — content / pull (dropped by the amendment), focus, no `t`, wrong field types, not an object — no write, no redraw; a search text is capped and cleaned', async ($, on) => {
  const { captured, clock } = beneath(on, () => fixture(), PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const before = JSON.stringify(await propsOf(ui))
  const reads0 = captured.prefsReads
  const junk: JsonValue[] = [
    { t: 'content', rows: 123 }, { t: 'pull', seq: 1 }, { t: 'focus', id: 'a1' }, { t: 'nonsense' }, { nonsense: true },
    { t: 'open' }, { t: 'open', id: 7 }, { t: 'pin', room: null }, { t: 'roomDone', room: ['x'] }, { t: 'search', q: 5 }, { t: 7 },
    'showDone', 42, null, [{ t: 'showDone' }],
  ]
  expect(await writesOf(captured, async () => { for (const d of junk) await ui.post(d, { in: OFFICE_KEY }) })).toEqual({})
  await clock.advance(REDRAW_LATCH_MS)
  expect(captured.prefsReads).toBe(reads0) // nothing read, nothing redrawn
  expect(JSON.stringify(await propsOf(ui))).toBe(before)
  // a well-formed post through the same door does land (the kit's post is the module's surface.post)
  await ui.post({ t: 'open', id: 'b1' }, { in: OFFICE_KEY })
  expect((await propsOf(ui)).drawer?.id).toBe('b1')
  // a search text is cut to SEARCH_MAX code points (a pasted page must not swell the Client's props), never inside an emoji
  await ui.post({ t: 'search', q: '🔍'.repeat(SEARCH_MAX + 50) }, { in: OFFICE_KEY })
  expect(Array.from((await propsOf(ui)).search)).toEqual(Array.from('🔍'.repeat(SEARCH_MAX)))
  // ... and its control characters become spaces (an Input value holding one is refused: by the Client, and by the text cards)
  await ui.post({ t: 'search', q: 'tri\u001b[1mage\u0007' }, { in: OFFICE_KEY })
  expect((await propsOf(ui)).search).toBe('tri [1mage ')
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  await ui.unmount()
})

/** An engine scroll offset past the tallest Box a surface draws (10,000 rows): the module's spacer for the rows scrolled past fails the surface's validation. */
const FAULT_OFFSET = 20_000

test('ui.fault on the office: the desktop falls back to the text cards and toasts once; /theater tries the Client again; a second fault toasts again', async ($, on) => {
  const logs: string[] = []
  on('ui.log', ($, e) => { logs.push(e.text); return { value: undefined } })
  const { captured, clock } = beneath(on, () => fixture(), PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Client' }))?.key).toBe(OFFICE_KEY)
  expect(await ui.find({ key: 'open:a1' })).toBeUndefined()
  // a real fault of the module: a redraw hands it an engine scroll offset of FAULT_OFFSET, so the spacer it draws for the
  // rows scrolled past is a Box taller than a surface draws (the bound is 10,000 rows): the surface refuses the tree,
  // unmounts the instance and reports `ui.fault` (phase `render`) for element `office`. (A live engine's offset stays
  // inside the Client's height, itself under that bound; the kit's redraw takes any offset. The module's old trigger —
  // a search post over the post bound — is gone: the module caps its search text, cleanSearch.)
  await ui.redraw({ ...PANE.props, scroll: { offset: FAULT_OFFSET, bodyRows: 40 } })
  expect(captured.toasts).toHaveLength(1)
  expect(captured.toasts[0]).toMatch(/\/theater/)
  expect(captured.toasts[0]).toMatch(/כרטיסים/) // Hebrew, as the prefs say
  expect(logs.filter(l => l.startsWith('office Client failed'))).toHaveLength(1)
  expect(logs.find(l => l.startsWith('office Client failed'))).toMatch(/^office Client failed \(render\): .*height/)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ key: 'open:a1' })).toBeDefined() // the text cards
  expect(await ui.find({ type: 'Text', text: /משרד הסוכנים/ })).toBeDefined()
  // the fallback holds over the redraws (the window back in range) and the polls; no second toast
  await ui.redraw({ ...PANE.props })
  await clock.advance(POLL_MS)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(captured.toasts).toHaveLength(1)
  // /theater: the person asks again → the Client is drawn again, on the window in range
  await $.command.run(THEATER)
  expect((await ui.find({ type: 'Client' }))?.key).toBe(OFFICE_KEY)
  expect(await ui.find({ key: 'open:a1' })).toBeUndefined()
  expect((await propsOf(ui)).offset).toBe(0)
  // it fails again: the cards again, one more toast
  await ui.redraw({ ...PANE.props, scroll: { offset: FAULT_OFFSET, bodyRows: 40 } })
  expect(captured.toasts).toHaveLength(2)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ key: 'open:a1' })).toBeDefined()
  // (reset: the flag is the plugin bundle's module memory)
  await ui.redraw({ ...PANE.props })
  await $.command.run(THEATER)
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  await ui.unmount()
})
