// office-props.ts: the slim JSON props of the desktop office Client. Pure:
// a payload, prefs, view and clocks in — plain JSON out (no undefined, task
// and result only inside the drawer, every text capped, 100 agents far under
// the Client's props bound).

import { expect, test } from 'claude-code/testing'

import { I18N, modelFamily } from './i18n'
import { DEFAULT_PREFS, DEFAULT_VIEW, EMPTY_PAYLOAD, JUST_FINISHED_MS, PERSONA_EMOJI } from './model'
import type { Agent } from './model'
import { DRAWER_TEXT_TIGHT, MAX_PROPS_AGENTS, PROPS_BUDGET, PROPS_MAX_CHARS, assertJson, buildOfficeProps } from './office-props'
import type { OfficePropsInput } from './office-props'
import { officeView } from './ui'

/** A wall-clock minute (T0 % 60_000 === 0), so the minute clock the tiles are timed from equals `now`. */
const T0 = 1_700_000_040_000
function agent(over: Partial<Agent> & { id: string }): Agent {
  return { persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: '', subagent_type: '', status: 'running', tool: 'Read', phase: 'tool', task: 'x'.repeat(5000), task_short: 'x', result: 'y'.repeat(4000), start_ms: T0 - 120_000, end_ms: null, session: 'sess-a', session_full: 'sess-aaaa', cwd: '/w', project: '/w', mtime_ms: T0 - 1000, is_session: false, closed: false, is_workflow: false, truncated: false, model: 'claude-opus-5-5', ...over }
}
function input(agents: Agent[], over: Partial<OfficePropsInput> = {}): OfficePropsInput {
  return { payload: { ...EMPTY_PAYLOAD, agents, stars: {} }, prefs: DEFAULT_PREFS, view: DEFAULT_VIEW, roomDone: {}, offset: 0, columns: 45, rows: 30, now: T0, usage: null, ...over }
}
/** A finished agent that ended `secondsAgo` seconds before T0. */
function finishedAgent(id: string, secondsAgo = 1, over: Partial<Agent> = {}): Agent {
  return agent({ id, status: 'done', end_ms: T0 - secondsAgo * 1000, ...over })
}

test('modelFamily (i18n.ts: the text cards\' colour token; the Client props carry the model word alone)', () => {
  expect(modelFamily('claude-opus-5-5')).toBe('opus')
  expect(modelFamily('claude-sonnet-5-5')).toBe('sonnet')
  expect(modelFamily('claude-haiku-5-5')).toBe('haiku')
  expect(modelFamily('claude-fable-5-1')).toBe('fable')
  expect(modelFamily('')).toBe('other')
  expect(modelFamily('claude-mystery-9')).toBe('other')
})

test('buildOfficeProps: slim, JSON-clean, task/result only in the drawer', () => {
  const two = [agent({ id: 'a1', role: 'Reviewer' }), agent({ id: 'a2', status: 'done', end_ms: T0 - 1000 })]
  const shown = { ...DEFAULT_PREFS, showDone: true }
  // a room that hides its finished still draws its RECENT_DONE most recent (THE RECENT FINISHED, ui.tsx officeView) and no
  // "more" row while none is held back; the header counts them either way
  const hidden = buildOfficeProps(input(two))
  expect(hidden.rooms[0]?.agents.map(a => a.id)).toEqual(['a1', 'a2'])
  expect(hidden.rooms[0]).toMatchObject({ showDone: false, moreDone: 0, moreLabel: '' })
  expect(hidden.counts).toEqual({ run: 1, idle: 0, done: 1 })
  // five finished: the three most recently finished (by end_ms, then mtime_ms) ride the props, the rest are counted on the row
  const five = [agent({ id: 'r1' }), ...[5, 1, 4, 2, 3].map((k, i) => agent({ id: `d${i}`, status: 'done', end_ms: T0 - k * 1000 }))]
  const held = buildOfficeProps(input(five))
  expect(held.rooms[0]?.agents.map(a => a.id)).toEqual(['r1', 'd1', 'd3', 'd4'])   // payload order kept; d0 (5 s ago) and d2 (4 s ago) held back
  expect(held.rooms[0]).toMatchObject({ moreDone: 2, moreLabel: I18N.he.moreDoneN(2), done: 5 })
  expect(held.rooms[0]?.moreLabel).toBe('עוד 2 שסיימו')
  const opened = buildOfficeProps(input(five, { roomDone: { 'sess-aaaa': true } }))
  expect(opened.rooms[0]?.agents).toHaveLength(6)
  expect(opened.rooms[0]).toMatchObject({ showDone: true, moreDone: 0, moreLabel: I18N.he.hideDone })
  expect(buildOfficeProps(input(five, { prefs: { ...DEFAULT_PREFS, lang: 'en' } })).rooms[0]?.moreLabel).toBe('2 more finished')
  // a search still filters every agent: the held count is of the agents that match
  expect(buildOfficeProps(input(five, { view: { ...DEFAULT_VIEW, search: 'zzzz' } })).rooms).toEqual([])
  // no finished at all: no row; every finished shown and none held: the hide row only when the room shows some
  expect(buildOfficeProps(input([agent({ id: 'r1' })])).rooms[0]).toMatchObject({ moreDone: 0, moreLabel: '' })
  expect(buildOfficeProps(input([agent({ id: 'r1' })], { prefs: shown })).rooms[0]).toMatchObject({ moreDone: 0, moreLabel: '' })
  const p = buildOfficeProps(input(two, { prefs: shown }))
  assertJson(p)
  expect(JSON.parse(JSON.stringify(p))).toEqual(p) // plain JSON: the round trip loses nothing
  expect(p.v).toBe(1)
  expect(p.nowMin).toBe(T0)
  expect(p.empty).toBeNull()
  expect(p.counts).toEqual({ run: 1, idle: 0, done: 1 })
  expect(p.rooms).toHaveLength(1)
  expect(p.rooms[0]?.showDone).toBe(true)
  expect(p.rooms[0]?.agents.map(a => a.id)).toEqual(['a1', 'a2'])
  // the row's name is the persona's (persona 3), never the role — that is the drawer's subtitle (Asaf's cleanup, 2026-10-17); the row
  // is slim: what the cards draw and nothing else (no clock, no tool or model family, no lead flag, no first-seen stamp)
  expect(p.rooms[0]?.agents[0]).toEqual({ id: 'a1', emoji: PERSONA_EMOJI[3] ?? '', name: 'החוקר', status: 'running', act: '📖 קורא', model: 'Opus 5.5', task: 'x', failed: false, longRunning: false, star: 0 })
  expect(JSON.stringify(p)).not.toContain('xxxxxxxxxx')
  // the row's task (the dim task column from CENTRE_AT columns): the short task cut to TASK_MAX cells, whole glyphs
  expect(buildOfficeProps(input([agent({ id: 'a1', task_short: 'Read the spec and the plan, then report' })])).rooms[0]?.agents[0]?.task).toBe('Read the spec and the p…')
  expect(buildOfficeProps(input([agent({ id: 'a1', task_short: '🦉'.repeat(20) })])).rooms[0]?.agents[0]?.task).toBe('🦉'.repeat(11) + '…')
  expect(buildOfficeProps(input([agent({ id: 'a1', task_short: '' })])).rooms[0]?.agents[0]?.task).toBe('')
  expect(p.drawer).toBeNull()
  const withDrawer = buildOfficeProps(input([agent({ id: 'a1', task_short: 'Read the spec' })], { view: { ...DEFAULT_VIEW, selected: 'a1' } }))
  expect(withDrawer.drawer?.task.length).toBe(4000)
  expect(withDrawer.drawer?.result.length).toBe(4000)
  expect(withDrawer.drawer?.elapsedMin).toBe(2) // running: elapsed since start, at the minute clock
  expect(withDrawer.drawer?.name).toBe('🔬 החוקר') // the persona on the name line, as today's drawer
  expect(withDrawer.drawer?.sub).toBe('Read the spec')
  const roled = buildOfficeProps(input(two, { prefs: shown, view: { ...DEFAULT_VIEW, selected: 'a1' } }))
  expect(roled.drawer?.name).toBe('🔬 החוקר') // a role never replaces the persona nor shows twice
  expect(roled.drawer?.sub).toBe('Reviewer')
  const finished = buildOfficeProps(input(two, { prefs: shown, view: { ...DEFAULT_VIEW, selected: 'a2' } }))
  expect(finished.drawer?.elapsedMin).toBe(1) // done: the duration start → end_ms (119 s)
  // THE STATUS LINE's data (office-chrome.ts drawerStatus words it): the status (done: the clock is a duration — a failed agent's
  // too), the badges (office-layout.ts markOf), the agent type ('' for a lead or unknown)
  expect(finished.drawer).toMatchObject({ status: 'done', failed: false, longRunning: false, star: 0, type: '' })
  expect(withDrawer.drawer).toMatchObject({ status: 'running', failed: false, longRunning: false, star: 0, type: '' })
  expect(buildOfficeProps(input([agent({ id: 'a1', subagent_type: 'Explore' })], { view: { ...DEFAULT_VIEW, selected: 'a1' } })).drawer?.type).toBe('Explore')
  expect(buildOfficeProps(input([agent({ id: 'a1', start_ms: T0 - 60 * 60_000 })], { view: { ...DEFAULT_VIEW, selected: 'a1' } })).drawer?.longRunning).toBe(true)
  const failedOne = agent({ id: 'f1', status: 'done', failed: true, end_ms: T0 - 1000 })
  const failed = buildOfficeProps(input([failedOne], { prefs: shown, view: { ...DEFAULT_VIEW, selected: 'f1' } }))
  expect(failed.drawer).toMatchObject({ status: 'done', failed: true })
  expect(Object.keys(failed.drawer!).sort()).toEqual(['act', 'elapsedMin', 'failed', 'id', 'longRunning', 'model', 'name', 'result', 'star', 'status', 'sub', 'task', 'truncated', 'type'])
  const starred = buildOfficeProps(input([finishedAgent('s1')], { payload: { ...EMPTY_PAYLOAD, agents: [finishedAgent('s1')], stars: { s1: T0 - 3000 } }, prefs: shown, view: { ...DEFAULT_VIEW, selected: 's1' } }))
  expect(starred.drawer?.star).toBe(T0 - 3000)
  const wide = buildOfficeProps(input([agent({ id: 'a1', emoji: '🦉'.repeat(30) })], { view: { ...DEFAULT_VIEW, selected: 'a1' } }))
  expect(wide.drawer?.name).toBe('🦉'.repeat(23) + '…') // the 48-cell cap: whole glyphs, an ellipsis for the rest
  // a selection the office no longer holds draws no drawer
  expect(buildOfficeProps(input([agent({ id: 'a1' })], { view: { ...DEFAULT_VIEW, selected: 'gone' } })).drawer).toBeNull()
})

test('THE BADGED FIRST (the probe\'s round 8): among a room\'s finished, a ⭐ one (its stamp alive) and a ❌ one rank first — kept among the RECENT_DONE the room draws however old their finish, and drawn ahead of the other finished; the working and waiting stay first, in the office\'s order; with every finished shown the same order holds', () => {
  // r1 working; five finished, d0 the oldest (50 s ago) with a live ⭐, d4 failed (40 s ago), d1..d3 fresher
  const star = finishedAgent('d0', 50)
  const bad = finishedAgent('d4', 40, { failed: true })
  const five = [agent({ id: 'r1' }), star, finishedAgent('d1', 3), finishedAgent('d2', 2), finishedAgent('d3', 1), bad]
  const payload = { ...EMPTY_PAYLOAD, agents: five, stars: { d0: T0 - 3000 } }
  const held = buildOfficeProps(input(five, { payload }))
  expect(held.rooms[0]?.agents.map(a => a.id)).toEqual(['r1', 'd0', 'd4', 'd3'])   // the badged two, then the freshest of the rest
  expect(held.rooms[0]?.agents.map(a => a.star !== 0)).toEqual([false, true, false, false])
  expect(held.rooms[0]?.agents.map(a => a.failed)).toEqual([false, false, true, false])
  expect(held.rooms[0]).toMatchObject({ moreDone: 2, moreLabel: I18N.he.moreDoneN(2), done: 5 })
  // the ⭐ expired: d0 ranks by its finish again — the oldest, held back
  const expired = buildOfficeProps(input(five, { payload: { ...payload, stars: { d0: T0 - JUST_FINISHED_MS } } }))
  expect(expired.rooms[0]?.agents.map(a => a.id)).toEqual(['r1', 'd4', 'd2', 'd3'])   // (the rest in the office's order)
  // every finished shown: the live first, then the badged, then the rest in the office's order
  const all = buildOfficeProps(input(five, { payload, prefs: { ...DEFAULT_PREFS, showDone: true } }))
  expect(all.rooms[0]?.agents.map(a => a.id)).toEqual(['r1', 'd0', 'd4', 'd1', 'd2', 'd3'])
  // the walk of the text cards (officeView's order without a recent-done pick) is untouched: the payload's order
  expect(officeView(five, '', 'he', true, {}, []).order.map(a => a.id)).toEqual(['r1', 'd0', 'd1', 'd2', 'd3', 'd4'])
})

test('buildOfficeProps: 200 agents with the task column (show finished on, long short tasks) stay far under the Client props bound', () => {
  const many = Array.from({ length: 200 }, (_, i) => agent({ id: `agent-${String(i).padStart(16, '0')}`, session_full: `s${i % 10}`, session: `s${i % 10}`, task_short: `${'משימה ארוכה למדי מספר '.repeat(3)}${i}`, ...(i % 3 === 0 ? { status: 'done' as const, end_ms: T0 - 1000 } : {}) }))
  const p = buildOfficeProps(input(many, { prefs: { ...DEFAULT_PREFS, showDone: true } }))
  expect(p.rooms.flatMap(r => r.agents)).toHaveLength(200)
  expect(p.rooms.flatMap(r => r.agents).every(a => a.task.length <= 25)).toBe(true)
  expect(JSON.stringify(p).length).toBeLessThan(60_000)   // measured 2026-10-20: see the responsive report
  expect(JSON.stringify(p).length).toBeLessThan(PROPS_BUDGET)
})

test('buildOfficeProps: the empty office names its kind with the i18n message', () => {
  const p = buildOfficeProps(input([]))
  expect(p.rooms).toEqual([])
  expect(p.counts).toEqual({ run: 0, idle: 0, done: 0 })
  expect(p.empty).toEqual({ kind: 'office', msg: I18N.he.emptyOffice, sub: I18N.he.emptySub })
})

test('buildOfficeProps: star while the stamp is alive, offset clamped, name capped', () => {
  const done = agent({ id: 'a1', role: 'r'.repeat(40), status: 'done', end_ms: T0 - 1000 })
  const shown = { ...DEFAULT_PREFS, showDone: true }
  const p = buildOfficeProps(input([done], { payload: { ...EMPTY_PAYLOAD, agents: [done], stars: { a1: T0 - 3000 } }, prefs: shown, offset: -4 }))
  const a = p.rooms[0]?.agents[0]
  expect(a?.star).toBe(T0 - 3000)
  expect(a?.name).toBe('החוקר')   // the persona's name, whatever the role's length (the role is the drawer's subtitle)
  expect(p.offset).toBe(0)
  const expired = buildOfficeProps(input([done], { payload: { ...EMPTY_PAYLOAD, agents: [done], stars: { a1: T0 - JUST_FINISHED_MS } }, prefs: shown }))
  expect(expired.rooms[0]?.agents[0]?.star).toBe(0)
})

test('buildOfficeProps: 100 agents stay under the Client props bound', () => {
  const many = Array.from({ length: 100 }, (_, i) => agent({ id: `a${i}`, session_full: `s${i % 10}`, session: `s${i % 10}` }))
  const p = buildOfficeProps(input(many))
  expect(JSON.stringify(p).length).toBeLessThan(60_000) // measured 16,452 on 2026-10-19 with the slim rows (23,401 on 2026-10-10 with the tool / model family, the minutes, the lead flag and the first-seen stamp; spec §6.2: ~25 KB)
})

test('THE PROPS CAP: 600 agents (show finished on) stay under the props bound — MAX_PROPS_AGENTS of them ride the props, the working ones first in the order of the office, and the footer counts the rest ahead of the scan notes; the header counts stay those of the whole office', () => {
  const shown = { ...DEFAULT_PREFS, showDone: true }
  // 600 agents in 12 rooms (ids as long as the scanner's), every third one finished
  const many = Array.from({ length: 600 }, (_, i) => agent({
    id: `a${String(i).padStart(16, '0')}`, session_full: `sess-${String(i % 12).padStart(4, '0')}-ffff-eeee-dddd-cccccccccccc`, session: `s${i % 12}`,
    ...(i % 3 === 0 ? { status: 'done' as const, end_ms: T0 - 1000 } : {}),
  }))
  const p = buildOfficeProps(input(many, { prefs: shown, footer: '2 transcripts over 4 MiB skipped' }))
  const size = JSON.stringify(p).length
  expect(size).toBeLessThan(PROPS_MAX_CHARS)
  expect(size).toBeLessThanOrEqual(PROPS_BUDGET)
  const carried = p.rooms.flatMap(r => r.agents.map(a => a.id))
  expect(carried).toHaveLength(MAX_PROPS_AGENTS)
  // 400 are working: the finished are the ones left out; what is kept keeps the office's order
  const order = officeView(many, '', 'he', true, {}, []).order
  expect(carried).toEqual(order.filter(a => a.status !== 'done').slice(0, MAX_PROPS_AGENTS).map(a => a.id))
  expect(p.footer).toBe(`${I18N.he.moreAgentsN(400)} · 2 transcripts over 4 MiB skipped`)
  expect(p.footer.startsWith('עוד 400 ')).toBe(true)   // (the count inside the Hebrew: THE HEBREW RULE; `+400 more agents` in English)
  expect(buildOfficeProps(input(many, { prefs: { ...shown, lang: 'en' } })).footer.startsWith('+400 more agents')).toBe(true)
  expect(p.counts).toEqual({ run: 400, idle: 0, done: 200 })
  expect(p.rooms.every(r => r.agents.length > 0)).toBe(true)
  // under the cap nothing is dropped and the footer is the scan notes alone
  const few = buildOfficeProps(input(many.slice(0, 150), { prefs: shown, footer: 'x' }))
  expect(few.rooms.flatMap(r => r.agents)).toHaveLength(150)
  expect(few.footer).toBe('x')
  expect(buildOfficeProps(input(many.slice(0, 150), { prefs: shown })).footer).toBe('')
})

test('THE PROPS BUDGET: an office that is heavy per agent (a room each, uncapped model ids) with a long drawer is measured and degraded until it fits — the long text of the drawer first, then fewer agents — and the footer counts what was left out', () => {
  const shown = { ...DEFAULT_PREFS, showDone: true }
  const heavy = Array.from({ length: 300 }, (_, i) => agent({
    id: `agent-${String(i).padStart(94, '0')}`, role: 'r'.repeat(80), model: `claude-${'x'.repeat(60)}`,
    session_full: `sess-${String(i).padStart(95, '0')}`, session: `s${i}`, topic: 't'.repeat(90), is_session: true,
  }))
  // heavy indeed: one more agent (and its room) costs more than the budget shared by MAX_PROPS_AGENTS
  const sizeOf = (n: number) => JSON.stringify(buildOfficeProps(input(heavy.slice(0, n), { prefs: shown }))).length
  expect(sizeOf(2) - sizeOf(1)).toBeGreaterThan(PROPS_BUDGET / MAX_PROPS_AGENTS)
  const selected = heavy[5]!.id
  const p = buildOfficeProps(input(heavy, { prefs: shown, view: { ...DEFAULT_VIEW, selected } }))
  expect(JSON.stringify(p).length).toBeLessThanOrEqual(PROPS_BUDGET)
  expect(p.drawer?.id).toBe(selected)
  expect(p.drawer!.task.length).toBeLessThanOrEqual(DRAWER_TEXT_TIGHT + 1) // cut (an ellipsis ends it)
  const carried = p.rooms.flatMap(r => r.agents).length
  expect(carried).toBeGreaterThan(0)
  expect(carried).toBeLessThan(MAX_PROPS_AGENTS)
  expect(p.footer).toBe(I18N.he.moreAgentsN(300 - carried))
  // the same office without a selection: no drawer text to shed, fewer agents straight away; still under the budget
  const q = buildOfficeProps(input(heavy, { prefs: shown }))
  expect(JSON.stringify(q).length).toBeLessThanOrEqual(PROPS_BUDGET)
  expect(q.footer).toBe(I18N.he.moreAgentsN(300 - q.rooms.flatMap(r => r.agents).length))
})

test('assertJson throws on undefined anywhere', () => {
  expect(() => assertJson({ a: [{ b: undefined }] })).toThrow(/a\.0\.b/)
  expect(() => assertJson({ a: null, b: [1, 'x', true] })).not.toThrow()
})
