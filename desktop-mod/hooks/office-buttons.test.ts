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
import { I18N } from './i18n'
import { chromeRows } from './office-chrome'
import { LESS_MARK, LINK_FG, MORE_MARK, geometry, nb, officeModel, rowCount } from './office-layout'
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

// ---------------------------------------------------------------------------
// R1 (Q1): the search field by the office's agents — a finished toggle never adds or removes chrome
// ---------------------------------------------------------------------------

/** The header line and the search line as drawn: each child's text (the meter's place among them). */
async function chromeTexts(ui: Ui): Promise<string> {
  type Drawn = { type: string; props?: Record<string, unknown>; children?: Array<Drawn | string> }
  const isNode = (n: unknown): n is Drawn => typeof n === 'object' && n !== null && 'type' in n
  const textOf = (n: Drawn | string | undefined): string => (typeof n === 'string' ? n : isNode(n) ? (n.children ?? []).map(textOf).join('') : '')
  const root = (await ui.drawn({ in: OFFICE_KEY })) as unknown as Drawn
  return (root.children ?? []).filter(isNode).filter(k => ['header', 'searchLine'].includes(String(k.props?.key)))
    .map(k => `${String(k.props?.key)}: ${(k.children ?? []).filter(isNode).map(c => `[${textOf(c)}]`).join(' ')}`).join(' || ')
}

test('R1 · the search field is drawn by the office\'s agents (more than SEARCH_FROM, whatever the finished toggles show — Q1): ☐ → ☑ → ☐ in the demo (14 agents, 12 or 14 shown) keeps the chrome, the header and the meter where they were, and the first card\'s top; only the cards under the toggled rows move', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await demoAt($, on, 1, PREFS(), o => {
    o('session.measure', ($, e) => ({ changed: e.changed }))
    o('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 200_000, percent: 0 }, rateLimits: [{ kind: 'five_hour' as const, percentUsed: 42, resetsAt: new Date(2026, 9, 10, 14, 30).toISOString() }] } }))
  })
  const p0 = await officeProps(ui)
  expect(p0.usage).not.toBeNull()
  expect(p0.rooms.flatMap(r => r.agents).length).toBeLessThanOrEqual(12)
  const chrome0 = chromeRows(p0)
  const head0 = await chromeTexts(ui)
  const top0 = officeModel(p0).rooms[0]!.top
  expect(await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }), 'the field (14 in the office)').toBeDefined()
  for (const step of ['☑', '☐']) {
    await ui.press({ key: 'showDone' })
    const p = await officeProps(ui)
    expect(chromeRows(p), step).toBe(chrome0)
    expect(await chromeTexts(ui), step).toBe(head0)
    expect(officeModel(p).rooms[0]!.top, step).toBe(top0)
    expect(await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }), step).toBeDefined()
  }
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// R8 + R5 (Q3 + Q6): one meaning for the finished controls
// ---------------------------------------------------------------------------

const MORE = (n: number) => nb(`${MORE_MARK} ${I18N.he.moreDoneN(n)}`)
const HIDE = nb(`${LESS_MARK} ${I18N.he.hideDone}`)

test('R8 · the toolbar ☐ / ☑ sets EVERY card (Q6): after a card line showed its finished, ☑ then ☐ hides them again; after ☑ and a card hide line, ☐ then ☑ shows them again — the press clears every per-room override', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  await down(ui, cellOf(p0, hitOf(p0, 'moreDone', S2)))
  expect(roomOf(await officeProps(ui), S2).showDone).toBe(true)
  await ui.press({ key: 'showDone' })      // ☑
  expect(captured.store.roomDone).toEqual({})
  expect((await officeProps(ui)).rooms.every(r => r.showDone)).toBe(true)
  await ui.press({ key: 'showDone' })      // ☐
  expect(roomOf(await officeProps(ui), S2).showDone, 'the toolbar is ☐ but the card still shows its finished').toBe(false)
  // ☑, the card's hide line, ☐, ☑: the card shows its finished
  await ui.press({ key: 'showDone' })
  const p1 = await officeProps(ui)
  await down(ui, cellOf(p1, hitOf(p1, 'moreDone', S2)))
  expect(roomOf(await officeProps(ui), S2).showDone).toBe(false)
  await ui.press({ key: 'showDone' })
  await ui.press({ key: 'showDone' })
  const p2 = await officeProps(ui)
  expect(p2.prefs.showDone).toBe(true)
  expect(roomOf(p2, S2).showDone, 'the toolbar is ☑ but the card keeps its finished hidden').toBe(true)
  await ui.unmount()
})

test('R5 · the card one finished line sits DIRECTLY UNDER ITS TITLE (Q3): `▸ עוד 2 שסיימו` collapsed, `▾ הסתר שסיימו` open — it never moves, so a second click on the same cell toggles it back (never a row drawer)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  const card = officeModel(p0).rooms.find(r => r.id === S2)!
  const more = hitOf(p0, 'moreDone', S2)
  expect(more.y).toBe(card.titleAt + 1)
  expect(card.more).toBe(MORE(2))
  expect(card.rows[0]!.y).toBeGreaterThan(more.y)
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: MORE(2) })).toBeDefined()
  const at = cellOf(p0, more)
  await down(ui, at)
  const p1 = await officeProps(ui)
  expect(roomOf(p1, S2).showDone).toBe(true)
  expect(hitOf(p1, 'moreDone', S2).y).toBe(more.y)
  expect(officeModel(p1).rooms.find(r => r.id === S2)!.more).toBe(HIDE)
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: HIDE })).toBeDefined()
  await down(ui, at)                        // the same cell again
  const p2 = await officeProps(ui)
  expect(p2.drawer, 'the second click opened a drawer').toBeNull()
  expect(roomOf(p2, S2).showDone, 'the second click did not toggle the room back').toBe(false)
  await ui.unmount()
})

test('R8 · the line only where it hides or shows something (Q6): the demo frontend room with its one finisher draws none, ☐ or ☑; the title ✅ counts are read-only (no hit but the pin on the title line, a click on the counts changes nothing)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, clock } = await demoAt($, on, 1)
  await clock.advance(POLL_MS)              // phase 6: the poll publishes the finisher done
  const p0 = await officeProps(ui)
  expect(roomOf(p0, S1).agents.some(a => a.status === 'done')).toBe(true)
  expect(roomOf(p0, S1).moreLabel).toBe('')
  expect(officeModel(p0).hits.some(h => h.kind === 'moreDone' && h.id === S1)).toBe(false)
  await ui.press({ key: 'showDone' })
  expect(roomOf(await officeProps(ui), S1).moreLabel).toBe('')
  const p1 = await officeProps(ui)
  const card = officeModel(p1).rooms.find(r => r.id === S2)!
  expect(officeModel(p1).hits.filter(h => h.y === card.titleAt).map(h => h.kind)).toEqual(['pin'])
  const before = JSON.stringify(p1)
  const geo = geometry(p1.columns)
  await down(ui, { x: geo.margin + 3, y: chromeRows(p1) + card.titleAt })   // (RTL: the counts at the column's left edge)
  expect(JSON.stringify(await officeProps(ui))).toBe(before)
  await ui.unmount()
})

test('R8 · a real office whose rooms hold 2 and 3 finished: no line in either state, and ☐ → ☑ draws the same rows (every finished already drawn)', { timeoutMs: 30_000 }, async ($, on) => {
  const fx = (): Agent[] => {
    const a = (id: string, sess: string, done: boolean, i: number): Agent => agent(id, { session_full: sess, session: sess.slice(0, 8), status: done ? 'done' : 'running', end_ms: done ? T0 - (i + 1) * 1000 : null, result: done ? 'ok' : null })
    return [
      { ...a('lead-a', 'sess-aaaa-1', false, 0), is_session: true, tool: '' }, a('a1', 'sess-aaaa-1', false, 0), a('ad1', 'sess-aaaa-1', true, 1), a('ad2', 'sess-aaaa-1', true, 2),
      { ...a('lead-b', 'sess-bbbb-2', false, 0), is_session: true, tool: '' }, a('bd1', 'sess-bbbb-2', true, 3), a('bd2', 'sess-bbbb-2', true, 4), a('bd3', 'sess-bbbb-2', true, 5),
    ]
  }
  const { clock } = beneath(on, fx, PREFS())
  on('ui.status', () => ({ value: undefined }))
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount(paneAt(COLUMNS, { offset: 0, bodyRows: ROWS }))
  await ui.resize({ in: OFFICE_KEY, columns: COLUMNS, rows: ROWS })
  const rows = (p: OfficeProps) => JSON.stringify(p.rooms.map(r => [r.agents.map(x => x.id), r.moreLabel]))
  const p0 = await officeProps(ui)
  expect(p0.rooms.map(r => r.moreLabel)).toEqual(['', ''])
  await ui.press({ key: 'showDone' })
  const p1 = await officeProps(ui)
  expect(rows(p1)).toBe(rows(p0))
  expect(rowCount(p1)).toBe(rowCount(p0))
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// R5 (Q4): a pin shows at once; its card moves to the top when the pointer leaves the office
// ---------------------------------------------------------------------------

type DrawnNode = { type: string; props?: Record<string, unknown>; children?: Array<DrawnNode | string> }
const isDrawn = (n: unknown): n is DrawnNode => typeof n === 'object' && n !== null && 'type' in n
const drawnText = (n: DrawnNode | string | undefined): string => (typeof n === 'string' ? n : isDrawn(n) ? (n.children ?? []).map(drawnText).join('') : '')
const allNodes = (n: unknown): DrawnNode[] => (isDrawn(n) ? [n, ...(n.children ?? []).flatMap(allNodes)] : [])
/** The room cards as drawn, in order: their title Texts (the bold Text of each card's title line). */
async function drawnTitles(ui: Ui): Promise<string[]> {
  const root = (await ui.drawn({ in: OFFICE_KEY })) as unknown as DrawnNode
  return (root.children ?? []).filter(isDrawn).filter(k => String(k.props?.key ?? '').startsWith('room:') || (k.props?.borderStyle === 'round' && k.props?.key === undefined))
    .map(card => drawnText(allNodes(card).find(n => n.type === 'Text' && n.props?.bold === true)))
}

test('R5 · a pin shows at once and its card stays where it is under the pointer (Q4): a second click on the same cell unpins it (never another card\'s row); pinned again, the card moves to the top only once the pointer leaves the office', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  const second = p0.rooms[1]!.id
  const order0 = await drawnTitles(ui)
  const at = cellOf(p0, hitOf(p0, 'pin', second))
  await down(ui, at)
  expect((captured.store.prefs as { pins: string[] }).pins).toEqual([second])
  const p1 = await officeProps(ui)
  expect(roomOf(p1, second).pinned).toBe(true)
  expect(await drawnTitles(ui), 'the card moved under the pointer').toEqual(order0)
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: '📌' }), 'the bright 📌 at once').toBeDefined()
  await down(ui, at)                          // the same cell again: unpins
  expect((captured.store.prefs as { pins: string[] }).pins, 'the second click did not unpin').toEqual([])
  expect((await officeProps(ui)).drawer).toBeNull()
  await down(ui, at)                          // pinned again; the pointer leaves: the card goes to the top
  expect(await drawnTitles(ui)).toEqual(order0)
  await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
  expect(await drawnTitles(ui)).toEqual([order0[1], order0[0]])
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// R10 + R9 (no hover style yet) + Q7: nothing reflows under a decoration; hit zones are what is drawn; the more line a link
// ---------------------------------------------------------------------------

test('R10 · the status column is floored at every width: the keyboard focus marker a click puts on a row never widens it (53 columns, under WIDE_FROM)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await demoAt($, on, 1)
  const statusMin = async () => {
    const root = (await ui.drawn({ in: OFFICE_KEY })) as unknown as DrawnNode
    return allNodes(root).filter(n => n.type === 'Box' && n.props?.flexDirection === 'column' && (n.children ?? []).some(c => isDrawn(c) && c.type === 'Text' && /^[‹›]?[●○⭐❌⏰][‹›]?$/u.test(drawnText(c)))).map(c => c.props?.minWidth)
  }
  const before = await statusMin()
  expect(before.length).toBeGreaterThan(0)
  for (const w of before) expect(typeof w, 'a floor on every status column').toBe('number')
  const p0 = await officeProps(ui)
  await down(ui, cellOf(p0, hitOf(p0, 'agent', 'demo-mcp-dd')))
  expect(await statusMin()).toEqual(before)
  await ui.unmount()
})

test('R9 · the hit zones are what is drawn: the dim 📌 shows over the pin zone alone (the title\'s middle draws none and pins nothing); a row and the more line answer inside the card frame (its border cell beside them is nothing); the more line reads as a link — a theme link colour at rest, never dim, bold or on a background (Q7); the two close Buttons alike (role dismiss, the ✕ and the word, x)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  const geo = geometry(p0.columns)
  const card = officeModel(p0).rooms.find(r => r.id === S1)!
  const y = chromeRows(p0) + card.titleAt
  // the title's middle: no dim 📌, no pin
  await ui.pointer({ in: OFFICE_KEY, type: 'move', x: geo.margin + Math.floor(geo.W / 2), y })
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: '📌' }), 'a 📌 over the title').toBeUndefined()
  await down(ui, { x: geo.margin + Math.floor(geo.W / 2), y })
  expect((captured.store.prefs as { pins: string[] }).pins).toEqual([])
  // the pin zone: the dim 📌
  await ui.pointer({ in: OFFICE_KEY, type: 'move', ...cellOf(p0, hitOf(p0, 'pin', S1)) })
  expect((await ui.find({ in: OFFICE_KEY, type: 'Text', text: '📌' }))?.props.dimColor).toBe(true)
  await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
  // the card's border cells beside a row and beside the more line: nothing
  const before = JSON.stringify(await officeProps(ui))
  for (const [kind, id] of [['agent', 'demo-mcp-dd'], ['moreDone', S2]] as const) {
    const hit = hitOf(p0, kind, id)
    expect(hit.x, kind).toBe(1)
    expect(hit.w, kind).toBe(geo.W - 2)
    for (const x of [geo.margin, geo.margin + geo.W - 1]) await down(ui, { x, y: chromeRows(p0) + hit.y })
  }
  expect(JSON.stringify(await officeProps(ui))).toBe(before)
  // the more line: a link colour at rest
  const more = await ui.find({ in: OFFICE_KEY, type: 'Text', text: officeModel(p0).rooms.find(r => r.id === S2)!.more })
  expect(more?.props).toMatchObject({ color: LINK_FG })
  expect(more?.props.dimColor).toBeUndefined()
  expect(more?.props.bold).toBeUndefined()
  expect(more?.props.backgroundColor).toBeUndefined()
  // the closes: the drawer's and the settings'
  await down(ui, cellOf(p0, hitOf(p0, 'agent', 'demo-mcp-dd')))
  const close = await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'close' })
  await ui.press({ key: 'close' })
  await ui.press({ key: 'help' })
  const closeHelp = await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'closeHelp' })
  for (const k of ['role', 'label', 'hotkey'] as const) expect(closeHelp?.props[k], k).toEqual(close?.props[k])
  expect(close?.props.role).toBe('dismiss')
  await ui.press({ key: 'closeHelp' })
  expect((await officeProps(ui)).helpOpen).toBe(false)
  await ui.unmount()
})
