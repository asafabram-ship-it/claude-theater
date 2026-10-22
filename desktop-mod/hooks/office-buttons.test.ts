// THE BUTTONS (live check 7, 2026-10-21: "the buttons are not smooth" — slow, no response or the wrong action, the office
// jumping under the pointer, unclear what is clickable). Each test drives the real mount in Asaf's set-up — the DEMO,
// Hebrew, a 53-column pane (a 51-cell reading column: the toolbar on its own line, the search on a line of its own under
// it, no hotkeys) — through the office Client's Button or key → the post → ui.message → the props the module draws, and
// asserts what the person expects to see. The causes (R1-R14) and Asaf's answers (Q1-Q10) are decision 24 of
// docs/superpowers/specs/2026-10-10-client-office-and-usage-design.md and the "Live check 7" section of
// docs/superpowers/specs/2026-10-19-office-cards-design.md. A failing test here is a bug in the owning file.
//
// THE CLICKS THROUGH THE BUTTONS (phase B, decision 26; the paint probe of 22.10, which found the cause of "not smooth": a
// card frame's border rows are half a cell on the desktop, so the engine's y drifted a row per card against the lines the
// module hit-tested): every click in the office is a native plain Button, pressed here by its key as the desktop presses it
// — a row's cells `agent:<id>:who|model|emoji|word|task`, the pin on every title `pin:<room>` (the colour 📌 pinned, the
// monochrome PIN_OFF otherwise: one width, no hover — none draws inside a Client), the more line `more:<room>` (a regular
// plain Button: Q7's link colour withdrawn, a Button draws none). The pointer is read for its `leave` alone, which releases
// THE PIN'S PLACE (Q4). So the hit zones, the dim hover 📌 and the link colour of phase A are gone from these tests; what
// they guarded — the right action on the right control, nothing moving under the pointer — is asserted through the presses.

import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { DEFAULT_PREFS, DEFAULT_VIEW, PERSONA_EMOJI, POLL_MS } from './model'
import type { Agent } from './model'
import { I18N } from './i18n'
import { HELP, chromeRows, overlayHeight } from './office-chrome'
import { LESS_MARK, MORE_MARK, PIN, PIN_OFF, nb, officeModel, rowCount } from './office-layout'
import { LABEL_KEYS, OFFICE_KEY, buildOfficeProps } from './office-props'
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
/**
 * A click on the office's controls as the desktop does it (phase B): the Button's press by its key — the kit presses a
 * Client's Button by its key alone. A row opens by its who cell (any of its cells would); `clickPin` lets the pointer leave
 * after the press (THE PIN'S PLACE: the cards keep the order drawn until it does — the R5 tests press the pin alone).
 */
const press = (ui: Ui, key: string) => ui.press({ key })
const clickAgent = (ui: Ui, id: string) => press(ui, `agent:${id}:who`)
const clickPin = async (ui: Ui, room: string) => { await press(ui, `pin:${room}`); await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 }) }
const clickMore = (ui: Ui, room: string) => press(ui, `more:${room}`)
/** The pin Button's label on a drawn card: PIN when pinned, PIN_OFF otherwise. */
const pinLabelOf = async (ui: Ui, room: string) => (await ui.find({ in: OFFICE_KEY, type: 'Button', key: `pin:${room}` }))?.props.label
/** The more / hide line's label as the module drew it (undefined when the room draws no such line). */
const moreLabelOf = async (ui: Ui, room: string) => (await ui.find({ in: OFFICE_KEY, type: 'Button', key: `more:${room}` }))?.props.label

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
  await clickMore(ui, S2)
  expect(captured.store.roomDone).toEqual({ [S2]: true })
  expect(swallow.n, 'the redraw was asked for').toBeGreaterThanOrEqual(1)
  // (the Client element's props are the render's — no render ran; what the MODULE draws came from the answer: the room's
  // line now hides its finished, and every finished row of it is drawn)
  expect((await officeProps(ui)).rooms.find(r => r.id === S2)?.showDone, 'no render ran').toBe(false)
  expect(await moreLabelOf(ui, S2), 'drawn from the answer').toMatch(/הסתר/)
  for (const id of ['demo-dedupe-kk', 'demo-label-ll']) {
    const who = officeModel(buildOfficeProps({ payload: demoPayload(T0, 1), prefs: { ...DEFAULT_PREFS }, view: { ...DEFAULT_VIEW, demo: true }, roomDone: { [S2]: true }, offset: 0, columns: COLUMNS, rows: ROWS, now: T0, usage: null })).rooms.flatMap(r => r.rows).find(r => r.id === id)!.who
    expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: who }), id).toBeDefined()
  }
  await ui.unmount()
})

test('R3 · a room\'s finished toggle is drawn at once — no latch to wait for: the more line pressed, the room shows every finished in the next props, the clock not moved; pressed again, hidden again', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  expect(roomOf(p0, S2).showDone).toBe(false)
  await clickMore(ui, S2)
  expect(captured.store.roomDone).toEqual({ [S2]: true })
  const p1 = await officeProps(ui)
  expect(roomOf(p1, S2).showDone, 'drawn without the clock moving').toBe(true)
  await clickMore(ui, S2)
  expect(roomOf(await officeProps(ui), S2).showDone).toBe(false)
  expect(captured.store.roomDone).toEqual({})
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// R1 (Q1): the search field by the office's agents — a finished toggle never adds or removes chrome
// ---------------------------------------------------------------------------

/** The header line and the search line as drawn (the reading column's children: the root holds the column, then the floating overlay): each child's text (the meter's place among them). */
async function chromeTexts(ui: Ui): Promise<string> {
  type Drawn = { type: string; props?: Record<string, unknown>; children?: Array<Drawn | string> }
  const isNode = (n: unknown): n is Drawn => typeof n === 'object' && n !== null && 'type' in n
  const textOf = (n: Drawn | string | undefined): string => (typeof n === 'string' ? n : isNode(n) ? (n.children ?? []).map(textOf).join('') : '')
  const root = (await ui.drawn({ in: OFFICE_KEY })) as unknown as Drawn
  const column = (root.children ?? []).filter(isNode).find(k => k.props?.key === 'column')
  expect(column, 'the column Box').toBeDefined()
  return (column!.children ?? []).filter(isNode).filter(k => ['header', 'searchLine'].includes(String(k.props?.key)))
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

/** The Hebrew pane's more / hide line: read arrow first (iconLabel — the arrow trails the words in the string), ◂ collapsed. */
const MORE = (n: number) => nb(`${I18N.he.moreDoneN(n)} ${MORE_MARK.rtl}`)
const HIDE = nb(`${I18N.he.hideDone} ${LESS_MARK}`)

test('R8 · the toolbar ☐ / ☑ sets EVERY card (Q6): after a card line showed its finished, ☑ then ☐ hides them again; after ☑ and a card hide line, ☐ then ☑ shows them again — the press clears every per-room override', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  await clickMore(ui, S2)
  expect(roomOf(await officeProps(ui), S2).showDone).toBe(true)
  await ui.press({ key: 'showDone' })      // ☑
  expect(captured.store.roomDone).toEqual({})
  expect((await officeProps(ui)).rooms.every(r => r.showDone)).toBe(true)
  await ui.press({ key: 'showDone' })      // ☐
  expect(roomOf(await officeProps(ui), S2).showDone, 'the toolbar is ☐ but the card still shows its finished').toBe(false)
  // ☑, the card's hide line, ☐, ☑: the card shows its finished
  await ui.press({ key: 'showDone' })
  await clickMore(ui, S2)
  expect(roomOf(await officeProps(ui), S2).showDone).toBe(false)
  await ui.press({ key: 'showDone' })
  await ui.press({ key: 'showDone' })
  const p2 = await officeProps(ui)
  expect(p2.prefs.showDone).toBe(true)
  expect(roomOf(p2, S2).showDone, 'the toolbar is ☑ but the card keeps its finished hidden').toBe(true)
  await ui.unmount()
})

test('R5 · the card one finished line sits DIRECTLY UNDER ITS TITLE (Q3): `עוד 2 שסיימו ◂` collapsed, `הסתר שסיימו ▾` open — it never moves and it is ONE Button (`more:<room>`), so a second press on it toggles it back (never a row drawer)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  const card = officeModel(p0).rooms.find(r => r.id === S2)!
  expect(card.moreAt).toBe(card.titleAt + 1)
  expect(card.more).toBe(MORE(2))
  expect(card.rows[0]!.y).toBeGreaterThan(card.moreAt)
  expect(await moreLabelOf(ui, S2)).toBe(MORE(2))
  await clickMore(ui, S2)
  const p1 = await officeProps(ui)
  expect(roomOf(p1, S2).showDone).toBe(true)
  const open = officeModel(p1).rooms.find(r => r.id === S2)!
  expect(open.moreAt).toBe(card.moreAt)
  expect(open.more).toBe(HIDE)
  expect(await moreLabelOf(ui, S2)).toBe(HIDE)
  await clickMore(ui, S2)                    // the same Button again
  const p2 = await officeProps(ui)
  expect(p2.drawer, 'the second press opened a drawer').toBeNull()
  expect(roomOf(p2, S2).showDone, 'the second press did not toggle the room back').toBe(false)
  expect(await moreLabelOf(ui, S2)).toBe(MORE(2))
  await ui.unmount()
})

test('R8 · the line only where it hides or shows something (Q6): the demo frontend room with its one finisher draws none, ☐ or ☑; the title ✅ counts are read-only (the title line\'s one Button its pin; the counts a dim Text)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, clock } = await demoAt($, on, 1)
  await clock.advance(POLL_MS)              // phase 6: the poll publishes the finisher done
  const p0 = await officeProps(ui)
  expect(roomOf(p0, S1).agents.some(a => a.status === 'done')).toBe(true)
  expect(roomOf(p0, S1).moreLabel).toBe('')
  expect(await moreLabelOf(ui, S1)).toBeUndefined()
  expect(await moreLabelOf(ui, S2)).toBeDefined()
  await ui.press({ key: 'showDone' })
  expect(roomOf(await officeProps(ui), S1).moreLabel).toBe('')
  expect(await moreLabelOf(ui, S1)).toBeUndefined()
  for (const room of [S1, S2]) {
    const line = await titleLineOf(ui, room)
    expect(allNodes(line).filter(n => n.type === 'Button').map(n => n.props?.key), room).toEqual([`pin:${room}`])
    const counts = (line.children ?? []).filter(isDrawn).filter(k => k.type === 'Box')[1]
    expect((counts?.children ?? []).filter(isDrawn).map(n => [n.type, n.props?.dimColor]), room).toEqual([['Text', true]])
  }
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
/** The room cards as drawn: the reading column's Boxes keyed `room:<id>`, in order (the root holds the column, then the floating overlay). */
async function drawnCards(ui: Ui): Promise<DrawnNode[]> {
  const root = (await ui.drawn({ in: OFFICE_KEY })) as unknown as DrawnNode
  const column = (root.children ?? []).filter(isDrawn).find(k => k.props?.key === 'column')
  expect(column, 'the column Box').toBeDefined()
  return (column!.children ?? []).filter(isDrawn).filter(k => String(k.props?.key ?? '').startsWith('room:'))
}
/** The room cards as drawn, in order: their title Texts (the bold Text of each card's title line). */
async function drawnTitles(ui: Ui): Promise<string[]> {
  return (await drawnCards(ui)).map(card => drawnText(allNodes(card).find(n => n.type === 'Text' && n.props?.bold === true)))
}
/** A room's title line as drawn: the card's first child (the pin Button, the title Box, the counts Box). */
async function titleLineOf(ui: Ui, room: string): Promise<DrawnNode> {
  const card = (await drawnCards(ui)).find(c => c.props?.key === `room:${room}`)
  const line = (card?.children ?? []).find(isDrawn)
  expect(line, `the title line of ${room}`).toBeDefined()
  return line!
}

test('R5 · a pin shows at once and its card stays where it is under the pointer (Q4): a second press on the same Button unpins it (never another card\'s row); pinned again, the card moves to the top only once the pointer leaves the office', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  const second = p0.rooms[1]!.id
  const order0 = await drawnTitles(ui)
  expect(await pinLabelOf(ui, second)).toBe(PIN_OFF)
  await press(ui, `pin:${second}`)
  expect((captured.store.prefs as { pins: string[] }).pins).toEqual([second])
  const p1 = await officeProps(ui)
  expect(roomOf(p1, second).pinned).toBe(true)
  expect(p1.rooms[0]!.id, 'the props put the pinned room first').toBe(second)
  expect(await drawnTitles(ui), 'the card moved under the pointer').toEqual(order0)
  expect(await pinLabelOf(ui, second), 'the colour 📌 at once').toBe(PIN)
  await press(ui, `pin:${second}`)            // the same Button again: unpins
  expect((captured.store.prefs as { pins: string[] }).pins, 'the second press did not unpin').toEqual([])
  expect((await officeProps(ui)).drawer).toBeNull()
  expect(await pinLabelOf(ui, second)).toBe(PIN_OFF)
  await press(ui, `pin:${second}`)            // pinned again; the pointer leaves: the card goes to the top
  expect(await drawnTitles(ui)).toEqual(order0)
  await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
  expect(await drawnTitles(ui)).toEqual([order0[1], order0[0]])
  expect(await pinLabelOf(ui, second)).toBe(PIN)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// R10 + R9 + Q7 (phase B): nothing reflows under a decoration; the controls are the Buttons drawn; the more line a plain Button
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
  await clickAgent(ui, 'demo-mcp-dd')
  expect((await officeProps(ui)).drawer?.id).toBe('demo-mcp-dd')
  expect(await statusMin()).toEqual(before)
  await ui.unmount()
})

test('R9 · the controls are what is drawn (phase B, decision 26: every click a native plain Button): the pin a Button on EVERY title — the monochrome PIN_OFF unpinned, no 📌 Text anywhere on the title, never dim; the more line a plain Button of regular weight with no colour (Q7\'s link colour withdrawn: a Button draws none on the desktop), never on a background; a row\'s values its Buttons, the status mark a Text; the two close Buttons alike (role dismiss, the ✕ and the word, x)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  // the pin on every title: one Button, its label PIN_OFF, no colour or dim; no Text 📌 elsewhere on the title line
  for (const room of p0.rooms.map(r => r.id)) {
    const line = await titleLineOf(ui, room)
    const pins = allNodes(line).filter(n => n.type === 'Button')
    expect(pins.map(n => [n.props?.key, n.props?.label]), room).toEqual([[`pin:${room}`, PIN_OFF]])
    expect([pins[0]!.props?.plain, pins[0]!.props?.color, pins[0]!.props?.dimColor], room).toEqual([true, undefined, undefined])
    expect(allNodes(line).filter(n => n.type === 'Text' && drawnText(n).includes(PIN)), room).toEqual([])
  }
  // the more line: a plain Button of regular weight, no colour, no dim, on no background
  const more = await ui.find({ in: OFFICE_KEY, type: 'Button', key: `more:${S2}` })
  expect(more?.props).toMatchObject({ plain: true, label: officeModel(p0).rooms.find(r => r.id === S2)!.more })
  for (const k of ['color', 'dimColor', 'bold', 'backgroundColor'] as const) expect(more?.props[k], k).toBeUndefined()
  // a row: its values Buttons keyed by the agent and the column; the status mark a Text, no Button
  const keys = (await ui.findAll({ in: OFFICE_KEY, type: 'Button' })).map(b => String(b.props.key)).filter(k => k.startsWith('agent:demo-mcp-dd:'))
  expect(keys[0]).toBe('agent:demo-mcp-dd:who')
  expect(keys.length).toBeGreaterThanOrEqual(3)
  expect(keys.some(k => k.endsWith(':status'))).toBe(false)
  // the closes: the drawer's and the settings'
  await press(ui, keys.at(-1)!)
  expect((await officeProps(ui)).drawer?.id).toBe('demo-mcp-dd')
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

// ---------------------------------------------------------------------------
// Q2 (phase A): the drawer one height per width, a second click closes it, the settings close it
// ---------------------------------------------------------------------------

test('Q2 · the drawer is ONE height at a width, whoever it shows (a result or none, a long task or a short one): it floats (THE FLOATING OVERLAY: no chrome row), so browsing the agents never moves the cards; a second press on the open agent closes it; the settings Button closes an open drawer, and closing the settings brings no old drawer back', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  const heights = new Set<number>()
  const results = new Set<string>()
  const chromes = new Set<number>()
  const tops = new Set<string>()
  for (const id of ['demo-mcp-dd', 'demo-writer-ff', 'demo-build-ee', 'demo-conv-research', 'demo-finisher-gg', 'demo-reader-bb']) {
    await clickAgent(ui, id)
    const q = await officeProps(ui)
    expect(q.drawer?.id, id).toBe(id)
    heights.add(overlayHeight(q))
    expect((await ui.find({ in: OFFICE_KEY, type: 'Box', key: 'drawer' }))?.props.height, id).toBe(overlayHeight(q))
    results.add(String(q.drawer?.result ?? ''))
    chromes.add(chromeRows(q))
    tops.add(JSON.stringify(officeModel(q).rooms.map(r => r.top)))
  }
  expect(results.size, 'agents with different results').toBeGreaterThan(1)
  expect([...heights], 'the drawer changed height between agents').toHaveLength(1)
  expect([...chromes], 'the drawer took a chrome row').toEqual([chromeRows(p0)])
  expect(tops.size).toBe(1)
  // the same row again: closed
  await clickAgent(ui, 'demo-reader-bb')
  const p2 = await officeProps(ui)
  expect(p2.drawer, 'a second press on the open agent').toBeNull()
  expect(p2.selected).toBeNull()
  expect(chromeRows(p2)).toBe(chromeRows(p0))
  // the settings close an open drawer; closed, nothing comes back
  await clickAgent(ui, 'demo-mcp-dd')
  expect((await officeProps(ui)).drawer?.id).toBe('demo-mcp-dd')
  await ui.press({ key: 'help' })
  const p3 = await officeProps(ui)
  expect([p3.helpOpen, p3.selected, p3.drawer]).toEqual([true, null, null])
  await ui.press({ key: 'closeHelp' })
  const p4 = await officeProps(ui)
  expect([p4.helpOpen, p4.selected, p4.drawer]).toEqual([false, null, null])
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// R7 (Q5): leaving the demo draws the office as it was before it, at once
// ---------------------------------------------------------------------------

test('R7 · the demo exit draws the office as it was before the demo AT ONCE (the last real office the pane drew — never the demo cast without its banner while the scan runs), refreshed when the scan lands; the exit posts its target, so a double press leaves the demo off', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, clock } = await demoAt($, on, 1)
  expect((await officeProps(ui)).rooms.map(r => r.id).sort()).toEqual([S1, S2])
  await ui.press({ key: 'exitDemo' })
  const p1 = await officeProps(ui)          // (before the kick's scan has settled)
  expect(p1.demo).toBe(false)
  expect(p1.rooms.map(r => r.id), 'the demo cast drawn as the office').toEqual(['sess-aaaa-1111'])
  expect(await ui.find({ in: OFFICE_KEY, key: 'exitDemo' })).toBeUndefined()
  await clock.settle()
  expect((await officeProps(ui)).rooms.map(r => r.id)).toEqual(['sess-aaaa-1111'])
  // in again, then the exit pressed twice in one frame: the demo stays off
  await ui.key({ in: OFFICE_KEY, key: 'd' })
  await clock.settle()
  expect((await officeProps(ui)).demo).toBe(true)
  await Promise.all([ui.press({ key: 'exitDemo' }), ui.press({ key: 'exitDemo' })])
  await clock.settle()
  const p2 = await officeProps(ui)
  expect(p2.demo, 'a double press re-entered the demo').toBe(false)
  expect(p2.rooms.map(r => r.id)).toEqual(['sess-aaaa-1111'])
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// R11 (Q9): the dead motion toggle is gone
// ---------------------------------------------------------------------------

test('R11 · the motion toggle is gone (Q9: nothing read it but its own icon) — the settings draw the demo and the language Buttons alone, no shortcut row promises s, the s key posts nothing; the stored prefs keep their `still` field', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1, { prefs: { lang: 'he', muted: false, showDone: false, pins: [], still: true } as never })
  await ui.press({ key: 'help' })
  const buttons = (await ui.findAll({ in: OFFICE_KEY, type: 'Button' })).map(b => b.props.key)
  expect(buttons).not.toContain('still')
  expect(buttons).toEqual(expect.arrayContaining(['demo', 'lang', 'closeHelp']))
  expect(HELP.map(([, keys]) => keys)).not.toContain('s')
  expect(LABEL_KEYS as readonly string[]).not.toContain('scStill')
  expect(LABEL_KEYS as readonly string[]).not.toContain('hbMotion')
  expect('scStill' in I18N.he || 'hbMotion' in I18N.he || 'scStill' in I18N.en || 'hbMotion' in I18N.en).toBe(false)
  await ui.press({ key: 'closeHelp' })
  const before = JSON.stringify(await officeProps(ui))
  const writes = { ...captured.writes }
  await ui.key({ in: OFFICE_KEY, key: 's' })
  expect(JSON.stringify(await officeProps(ui))).toBe(before)
  expect(captured.writes).toEqual(writes)
  expect((captured.store.prefs as { still?: boolean }).still).toBe(true)
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// The phase A review: overlapping posts — each action applied once, only the newest answer drawn; the pin's frame between
// ---------------------------------------------------------------------------

type Captured = ReturnType<typeof beneath>['captured']
/** The runtime's own next turn (the kit's tests have no DOM or node types: the global taken as it is). */
const tick = () => new Promise<void>(r => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(r, 0))
/** Waits up to `n` turns until `cond` holds (a hook held beneath, a write landed); whether it does. */
async function until(cond: () => boolean, n = 400): Promise<boolean> {
  for (let i = 0; i < n && !cond(); i++) await tick()
  return cond()
}
/** A one-shot hold beneath on the plugin's next write of `key` ($.store; `state:<key>` for $.state — test-kit.ts): released by the function returned. */
function hold(captured: Captured, key: string): () => void {
  let release!: () => void
  captured.hold[key] = new Promise<void>(r => (release = r))
  return () => release()
}
const storedPrefs = (captured: Captured) => captured.store.prefs as { muted: boolean; pins: string[] }
/** The mute Button's label as the MODULE drew it (what the person sees), not the Client element's props. */
async function drawnMute(ui: Ui): Promise<string> {
  return String((await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'mute' }))?.props.label ?? '')
}
/** The agent rows the module drew: their status cells (the mark, the focus marker beside it). */
async function drawnRows(ui: Ui): Promise<number> {
  const root = (await ui.drawn({ in: OFFICE_KEY })) as unknown as DrawnNode
  return allNodes(root).filter(n => n.type === 'Text' && /^[‹›]?[●○⭐❌⏰][‹›]?$/u.test(drawnText(n))).length
}

test('THE OUTBOX applies an action ONCE when posts overlap: a post of two actions still applying its first (its $.store write held) when the next frame\'s post carries them again — the later post applies the second, and the first then skips it (mute pressed once: the office ends muted, one prefs write)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  expect(p0.prefs.muted).toBe(false)
  const prefs0 = captured.writes.prefs
  const release = hold(captured, 'roomDone')
  // one frame: the more line (roomDone, its store write held) and mute — one post [roomDone, mute]
  const first = Promise.all([clickMore(ui, S2), ui.press({ key: 'mute' })])
  expect(await until(() => captured.seq.includes('held:roomDone')), 'the roomDone write held').toBe(true)
  // the next frame: settings — its post carries [roomDone, mute, help] (no frame cleared the outbox in between)
  const views = captured.writes.view
  const second = ui.press({ key: 'help' })
  expect(await until(() => captured.writes.view > views), 'the settings applied while roomDone is held').toBe(true)
  release()
  await Promise.all([first, second])
  await until(() => false, 20)
  const p1 = await officeProps(ui)
  const log = `prefs writes ${captured.writes.prefs - prefs0}, store muted ${storedPrefs(captured).muted}, props muted ${p1.prefs.muted}`
  expect(captured.writes.prefs - prefs0, log).toBe(1)
  expect(storedPrefs(captured).muted, log).toBe(true)
  expect(p1.prefs.muted, log).toBe(true)
  expect([p1.helpOpen, roomOf(p1, S2).showDone]).toEqual([true, true])
  await ui.unmount()
})

test('THE NEWEST ANSWER: a slower post answering after a newer one never draws over it — the more line (its $.store write held), then mute: once the held write lands the module draws 🔕 and the room\'s hide line, as the prefs and the store say (the older answer, read before mute wrote, once drew 🔔 and stuck: equal props, no redraw)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  expect(await drawnMute(ui)).toContain('🔔')
  const release = hold(captured, 'roomDone')
  const more = clickMore(ui, S2)
  expect(await until(() => captured.seq.includes('held:roomDone'))).toBe(true)
  const mute = ui.press({ key: 'mute' })
  expect(await until(() => storedPrefs(captured).muted === true), 'mute applied while roomDone is held').toBe(true)
  await until(() => false, 20)
  release()
  await Promise.all([more, mute])
  await until(() => false, 20)
  const p1 = await officeProps(ui)
  expect([storedPrefs(captured).muted, p1.prefs.muted, roomOf(p1, S2).showDone]).toEqual([true, true, true])
  expect(await drawnMute(ui), 'the module draws the sound as the prefs say').toContain('🔕')
  expect(await moreLabelOf(ui, S2), 'the room\'s hide line drawn').toBe(officeModel(p1).rooms.find(r => r.id === S2)!.more)
  expect(await moreLabelOf(ui, S2)).toBe(HIDE)
  await ui.unmount()
})

test('THE NEWEST ANSWER: mute (its prefs $.store mirror held), then the settings — once the held write lands the module draws the settings popover and 🔕 (the mute answer, read before the settings opened, once closed the popover the person had just opened)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  const release = hold(captured, 'prefs')
  const mute = ui.press({ key: 'mute' })
  expect(await until(() => captured.seq.includes('held:prefs'))).toBe(true)
  const views = captured.writes.view
  const help = ui.press({ key: 'help' })
  expect(await until(() => captured.writes.view > views)).toBe(true)
  await until(() => false, 20)
  release()
  await Promise.all([mute, help])
  await until(() => false, 20)
  const p1 = await officeProps(ui)
  expect([p1.helpOpen, p1.prefs.muted]).toEqual([true, true])
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'closeHelp' }), 'the settings popover drawn').toBeDefined()
  expect(await drawnMute(ui)).toContain('🔕')
  await ui.unmount()
})

test('THE NEWEST ANSWER: a poll publish inside a post\'s hook — the more line (its $.store write held), the demo\'s next publish walks the newcomer in, then the held write lands: the module draws the rows the props hold (the answer, read before the publish, once drew the cast without the newcomer and stuck)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured, clock } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  expect(idsOf(p0, S2)).not.toContain(NEWCOMER)
  const total = (p: OfficeProps) => p.rooms.reduce((n, r) => n + r.agents.length, 0)
  const release = hold(captured, 'roomDone')
  const more = clickMore(ui, S2)
  expect(await until(() => captured.seq.includes('held:roomDone'))).toBe(true)
  const payloads = captured.writes.payload
  const advance = clock.advance(POLL_MS)       // the next poll (phase 6): the newcomer in, the finisher done
  expect(await until(() => captured.writes.payload > payloads), 'the publish while roomDone is held').toBe(true)
  await until(() => false, 20)
  const p1 = await officeProps(ui)
  expect(idsOf(p1, S2)).toContain(NEWCOMER)
  release()
  await Promise.all([more, advance])
  await until(() => false, 20)
  const p2 = await officeProps(ui)
  expect(roomOf(p2, S2).showDone).toBe(true)
  expect(await drawnRows(ui), 'the rows drawn are not the props\' rows').toBe(total(p2))
  await ui.unmount()
})

test('R5 · a pin press draws the colour 📌 on the SAME Button once its answer lands — before the pointer leaves — and the title never slides (PIN and PIN_OFF one width: the title cut once for both); the cards keep the order drawn until the leave; the frame between the press and its answer draws nothing new (no hover exists to keep); unpinned, PIN_OFF again', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  const p0 = await officeProps(ui)
  const second = p0.rooms[1]!.id
  const titles0 = await drawnTitles(ui)
  expect(await pinLabelOf(ui, second)).toBe(PIN_OFF)
  // the pin's prefs write held beneath: the frame between the press and its answer
  const release = hold(captured, 'state:prefs')
  const pin = press(ui, `pin:${second}`)
  expect(await until(() => captured.seq.includes('held:state:prefs'))).toBe(true)
  await until(() => false, 20)
  expect(await pinLabelOf(ui, second), 'the frame between the press and the answer').toBe(PIN_OFF)
  expect(await drawnTitles(ui)).toEqual(titles0)
  release()
  await pin
  // (the press's act settles before a held hook does: the hook's last write awaited)
  expect(await until(() => storedPrefs(captured).pins.length > 0)).toBe(true)
  await until(() => false, 20)
  expect(storedPrefs(captured).pins).toEqual([second])
  expect(await pinLabelOf(ui, second), 'the colour 📌 before the pointer left').toBe(PIN)
  expect(await drawnTitles(ui), 'a title slid, or a card moved before the leave').toEqual(titles0)
  await press(ui, `pin:${second}`)              // unpinned, the pointer still in the office
  expect(storedPrefs(captured).pins).toEqual([])
  expect(await pinLabelOf(ui, second)).toBe(PIN_OFF)
  expect(await drawnTitles(ui)).toEqual(titles0)
  // pinned again, then the pointer leaves: the card goes to the top, its title as it was
  await clickPin(ui, second)
  expect(storedPrefs(captured).pins).toEqual([second])
  expect(await pinLabelOf(ui, second)).toBe(PIN)
  expect(await drawnTitles(ui)).toEqual([titles0[1], titles0[0]])
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// R14 pre-empts on the mount: the language switch retitles first
// ---------------------------------------------------------------------------

test('R14 · the language switch retitles the pane BEFORE it writes the prefs (as the poll does: the retitle and the write in one tick are one redraw, the title never a step behind)', { timeoutMs: 30_000 }, async ($, on) => {
  const { ui, captured } = await demoAt($, on, 1)
  await ui.press({ key: 'help' })
  const seq0 = captured.seq.length
  await ui.press({ key: 'lang' })
  const seq = captured.seq.slice(seq0)
  expect(seq).toContain('open')
  expect(seq).toContain('prefs')
  expect(seq.indexOf('open'), JSON.stringify(seq)).toBeLessThan(seq.indexOf('prefs'))
  expect((await officeProps(ui)).lang).toBe('en')
  expect(captured.opens.at(-1)).toMatch(/Theater/)
  await ui.unmount()
})
