// THE BUTTONS (live check 7, 2026-10-21: "the buttons are not smooth" — slow, no response or the wrong action, the office
// jumping under the pointer, unclear what is clickable). Each test drives the real mount in Asaf's set-up — the DEMO,
// Hebrew, a 53-column pane (a 51-cell reading column: the toolbar on its own line, the search on a line of its own under
// it, no hotkeys) — through the office Client's Button, key or pointer → the post → ui.message → the props the module
// draws, and asserts what the person expects to see. The causes (R1-R14) and Asaf's answers (Q1-Q10) are decision 24 of
// docs/superpowers/specs/2026-10-10-client-office-and-usage-design.md and the "Live check 7" section of
// docs/superpowers/specs/2026-10-19-office-cards-design.md. A failing test here is a bug in the owning file.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { DEFAULT_PREFS, DEFAULT_VIEW, PERSONA_EMOJI, POLL_MS } from './model'
import type { Agent } from './model'
import { chromeRows } from './office-chrome'
import { geometry, officeModel, rowCount } from './office-layout'
import type { Hit } from './office-layout'
import { OFFICE_KEY, buildOfficeProps } from './office-props'
import type { OfficeProps } from './office-props'
import { demoPayload } from './scanner'
import { T0, beneath } from './test-kit'

const COLUMNS = 53
const ROWS = 60
const S1 = 'demo-session-frontend-1111'
const S2 = 'demo-session-research-2222'
const NEWCOMER = 'demo-newcomer-hh'
/** The $.store the tests start from: Hebrew, the chime on, finished hidden (Asaf's default ☐), no pins. */
const PREFS = () => ({ prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })

type Ui = Mounted<'desktop', 'Pane'>
function paneAt(columns: number, scroll: { offset: number; bodyRows: number }) {
  return { plugin: 'agent-theater', component: 'Pane', requestId: 'agent-theater', surface: 'desktop', props: { title: 'T', isFocused: true, bodyColumns: columns, placement: 'dock', scroll, view: {} } } as const
}
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
const idsOf = (p: OfficeProps, id: string) => roomOf(p, id).agents.map(a => a.id)
const hitOf = (p: OfficeProps, kind: Hit['kind'], id: string): Hit => {
  const hit = officeModel(p).hits.find(h => h.kind === kind && h.id === id)
  expect(hit, `${kind} ${id}`).toBeDefined()
  return hit!
}
/** The Client cell a person aims at for a hit: its middle cell, past the centring margin, at Client row chromeRows + y. */
function cellOf(p: OfficeProps, hit: Hit): { x: number; y: number } {
  return { x: geometry(p.columns).margin + hit.x + Math.floor(hit.w / 2), y: chromeRows(p) + hit.y }
}
async function down(ui: Ui, at: { x: number; y: number }): Promise<void> {
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: at.x, y: at.y, button: 'left' })
}

function agent(id: string, over: Partial<Agent> = {}): Agent {
  return {
    id, persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: '', subagent_type: 'Explore', status: 'running', tool: 'Read', phase: 'tool',
    task: 'x', task_short: 'x', result: null, start_ms: T0 - 180_000, end_ms: null, session: 'sess-aaa', session_full: 'sess-aaaa-1111', cwd: '/w', project: '/w',
    mtime_ms: T0 - 1000, is_session: false, closed: false, is_workflow: false, truncated: false, model: 'claude-opus-5-5', ...over,
  }
}

/**
 * Mounted at 53 columns over a one-agent office, the demo started from the keyboard (d) — its switch published at once, at
 * demo phase 1 (scanner.ts demoPayload: T0 is phase 8, the poll's first tick POLL_MS later phase 1) — then the clock moved
 * on to `phase` without a poll in between when `phase` lies before the next tick (phase 6).
 */
async function demoAt($: Engine, on: On, phase = 1, prefs = PREFS(), extra?: (on: On, clock: ReturnType<typeof beneath>['clock'], writes: ReturnType<typeof beneath>['captured']['writes']) => void) {
  const { captured, clock } = beneath(on, () => [agent('real-1')], prefs)
  extra?.(on, clock, captured.writes)   // (the test's own hooks beneath: registered before the first call on $)
  on('ui.status', () => ({ value: undefined }))
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount(paneAt(COLUMNS, { offset: 0, bodyRows: ROWS }))
  await ui.resize({ in: OFFICE_KEY, columns: COLUMNS, rows: ROWS })
  await ui.key({ in: OFFICE_KEY, key: 'd' })
  await clock.settle()
  const steps = (((phase - 1) % 12) + 12) % 12
  if (steps > 0) await clock.advance(steps * 1000)
  expect((await officeProps(ui)).demo).toBe(true)
  return { ui, captured, clock }
}

// ---------------------------------------------------------------------------
// R6: the demo is drawn from what the poll published, never re-drawn from the clock on a click
// ---------------------------------------------------------------------------

test('R6 · the demo is drawn from the cast the poll published: a mute press two seconds after a publish (the newcomer due by the clock) redraws the same rows — no agent walks in on a click', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await demoAt($, on, 3)     // published at phase 1; the clock now at phase 3, where the newcomer walks in
  const p0 = await officeProps(ui)
  expect(idsOf(p0, S2)).not.toContain(NEWCOMER)
  await ui.press({ key: 'mute' })
  const p1 = await officeProps(ui)
  expect(p1.prefs.muted).toBe(true)
  expect(rowCount(p1), 'the mute press moved the rows').toBe(rowCount(p0))
  expect(p1.rooms.map(r => r.agents.map(a => a.id)), 'the mute press changed the cast').toEqual(p0.rooms.map(r => r.agents.map(a => a.id)))
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// Q10: the demo's newcomer walks in at the end of its room's working rows
// ---------------------------------------------------------------------------

test('Q10 · the demo\'s newcomer walks in as the last of its room\'s working rows: every row above it stays where it was; the payload stays sorted running / stale / done', () => {
  for (const showDone of [false, true]) {
    const at = (phase: number) => {
      const p = buildOfficeProps({ payload: demoPayload(T0, phase), prefs: { ...DEFAULT_PREFS, showDone }, view: { ...DEFAULT_VIEW, demo: true }, roomDone: {}, offset: 0, columns: COLUMNS, rows: ROWS, now: T0, usage: null })
      return roomOf(p, S2).agents
    }
    const before = at(2)
    const after = at(3)
    const live = before.filter(a => a.status !== 'done').map(a => a.id)
    expect(after.map(a => a.id), `showDone ${showDone}`).toEqual([...live, NEWCOMER, ...before.filter(a => a.status === 'done').map(a => a.id)])
  }
  const p3 = demoPayload(T0, 3)
  const statuses = p3.agents.map(a => a.status)
  expect(statuses.indexOf('stale')).toBeGreaterThan(statuses.lastIndexOf('running'))
  expect(statuses.indexOf('done')).toBeGreaterThan(statuses.lastIndexOf('stale'))
  expect(p3.agents.map(a => a.id).indexOf(NEWCOMER)).toBe(statuses.lastIndexOf('running'))
  expect(roomOf(buildOfficeProps({ payload: p3, prefs: { ...DEFAULT_PREFS }, view: { ...DEFAULT_VIEW, demo: true }, roomDone: {}, offset: 0, columns: COLUMNS, rows: ROWS, now: T0, usage: null }), S1).agents.map(a => a.id)).not.toContain(NEWCOMER)
})

// ---------------------------------------------------------------------------
// R12: two posts in one frame — the outbox carries both
// ---------------------------------------------------------------------------

test('R12 · two presses in one frame both land (one post per frame: the later post carries the earlier action, THE OUTBOX); an action is applied once, however many posts carry it', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  expect([p0.prefs.showDone, p0.prefs.muted]).toEqual([false, false])
  await Promise.all([ui.press({ key: 'showDone' }), ui.press({ key: 'mute' })])
  const p1 = await officeProps(ui)
  expect(p1.prefs.muted, 'mute').toBe(true)
  expect(p1.prefs.showDone, 'show finished, pressed in the same frame').toBe(true)
  expect(captured.store.prefs).toMatchObject({ showDone: true, muted: true })
  // the next act's post (a new frame here: the kit moves no frame clock between acts) carries the earlier actions again —
  // applied once: the flips stay flipped
  await ui.press({ key: 'help' })
  const p2 = await officeProps(ui)
  expect([p2.prefs.showDone, p2.prefs.muted, p2.helpOpen]).toEqual([true, true, true])
  // an old single post (no batch) is still applied
  await ui.post({ t: 'help' }, { in: OFFICE_KEY })
  expect((await officeProps(ui)).helpOpen).toBe(false)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// R2 + R3: a press is drawn from the ui.message hook's answer, not from a redraw
// ---------------------------------------------------------------------------

test('R2 · a press reaches the module in the ui.message hook answer ({ props }, built from the values just written), not in a redraw: with every redraw the plugin asks for swallowed beneath ($.ui.invalidate answered, never passed on), a room finished toggle — a $.store write, which redraws nothing by itself — is still drawn', { timeoutMs: 30_000 }, async ($, on) => {
  const swallow = { on: false, n: 0 }
  const { ui, captured } = await demoAt($, on, 1, PREFS(), o => {
    o('ui.invalidate', ($, e, next) => {
      if (!swallow.on) return next(e)
      swallow.n += 1
      return { value: undefined }
    })
  })
  const p0 = await officeProps(ui)
  expect(roomOf(p0, S2).showDone).toBe(false)
  swallow.on = true
  await down(ui, cellOf(p0, hitOf(p0, 'moreDone', S2)))
  expect(captured.store.roomDone).toEqual({ [S2]: true })
  expect(swallow.n, 'the redraw was asked for').toBeGreaterThanOrEqual(1)
  // (the Client element's props are the render's — no render ran; what the MODULE draws came from the answer: the room's
  // line now hides its finished, and every finished row of it is drawn)
  expect((await officeProps(ui)).rooms.find(r => r.id === S2)?.showDone, 'no render ran').toBe(false)
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /הסתר/ }), 'drawn from the answer').toBeDefined()
  for (const id of ['demo-dedupe-kk', 'demo-label-ll']) {
    const who = officeModel(buildOfficeProps({ payload: demoPayload(T0, 1), prefs: { ...DEFAULT_PREFS }, view: { ...DEFAULT_VIEW, demo: true }, roomDone: { [S2]: true }, offset: 0, columns: COLUMNS, rows: ROWS, now: T0, usage: null })).rooms.flatMap(r => r.rows).find(r => r.id === id)!.who
    expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: who }), id).toBeDefined()
  }
  await ui.unmount()
})

test('R3 · a room\'s finished toggle is drawn at once — no latch to wait for: the more line clicked, the room shows every finished in the next props, the clock not moved; clicked again, hidden again', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  expect(roomOf(p0, S2).showDone).toBe(false)
  await down(ui, cellOf(p0, hitOf(p0, 'moreDone', S2)))
  expect(captured.store.roomDone).toEqual({ [S2]: true })
  const p1 = await officeProps(ui)
  expect(roomOf(p1, S2).showDone, 'drawn without the clock moving').toBe(true)
  await down(ui, cellOf(p1, hitOf(p1, 'moreDone', S2)))
  expect(roomOf(await officeProps(ui), S2).showDone).toBe(false)
  expect(captured.store.roomDone).toEqual({})
  await ui.unmount()
})
