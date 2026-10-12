// office-props.ts: the slim JSON props of the desktop office Client. Pure:
// a payload, prefs, view and clocks in — plain JSON out (no undefined, task
// and result only inside the drawer, every text capped, 100 agents far under
// the Client's props bound).

import { expect, test } from 'claude-code/testing'

import { I18N } from './i18n'
import { DEFAULT_PREFS, DEFAULT_VIEW, EMPTY_PAYLOAD, JUST_FINISHED_MS, PERSONA_EMOJI } from './model'
import type { Agent } from './model'
import { DRAWER_TEXT_TIGHT, MAX_PROPS_AGENTS, PROPS_BUDGET, PROPS_MAX_CHARS, assertJson, buildOfficeProps, modelFamily } from './office-props'
import type { OfficePropsInput } from './office-props'
import { officeView } from './ui'

/** A wall-clock minute (T0 % 60_000 === 0), so the minute clock the tiles are timed from equals `now`. */
const T0 = 1_700_000_040_000
function agent(over: Partial<Agent> & { id: string }): Agent {
  return { persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: '', subagent_type: '', status: 'running', tool: 'Read', phase: 'tool', task: 'x'.repeat(5000), task_short: 'x', result: 'y'.repeat(4000), start_ms: T0 - 120_000, end_ms: null, session: 'sess-a', session_full: 'sess-aaaa', cwd: '/w', project: '/w', mtime_ms: T0 - 1000, is_session: false, closed: false, is_workflow: false, truncated: false, model: 'claude-opus-5-5', ...over }
}
function input(agents: Agent[], over: Partial<OfficePropsInput> = {}): OfficePropsInput {
  return { payload: { ...EMPTY_PAYLOAD, agents, stars: {} }, prefs: DEFAULT_PREFS, view: DEFAULT_VIEW, roomDone: {}, offset: 0, columns: 45, rows: 30, now: T0, usage: null, firstSeen: {}, ...over }
}

test('modelFamily', () => {
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
  // the office hides a finished agent until "show finished" (officeView / roomShowsDone, as today); the header counts it either way
  const hidden = buildOfficeProps(input(two))
  expect(hidden.rooms[0]?.agents.map(a => a.id)).toEqual(['a1'])
  expect(hidden.rooms[0]?.showDone).toBe(false)
  expect(hidden.counts).toEqual({ run: 1, idle: 0, done: 1 })
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
  expect(p.rooms[0]?.agents[0]).toEqual({ id: 'a1', emoji: PERSONA_EMOJI[3] ?? '', name: 'Reviewer', status: 'running', fam: 'read', act: '📖 קורא', model: 'Opus 5.5', modelFam: 'opus', startMin: 2, isLead: false, failed: false, longRunning: false, star: 0, enteredAt: 0 })
  expect(JSON.stringify(p)).not.toContain('xxxxxxxxxx')
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
  // the drawer says whether its clock is a duration (status done — a failed agent's too, whose chip reads ❌) or the elapsed time
  expect(finished.drawer?.done).toBe(true)
  expect(withDrawer.drawer?.done).toBe(false)
  const failedOne = agent({ id: 'f1', status: 'done', failed: true, end_ms: T0 - 1000 })
  const failed = buildOfficeProps(input([failedOne], { prefs: shown, view: { ...DEFAULT_VIEW, selected: 'f1' } }))
  expect(failed.drawer?.chips[0]).toBe(`❌ ${I18N.he.dFailed}`)
  expect(failed.drawer?.done).toBe(true)
  const wide = buildOfficeProps(input([agent({ id: 'a1', emoji: '🦉'.repeat(30) })], { view: { ...DEFAULT_VIEW, selected: 'a1' } }))
  expect(wide.drawer?.name).toBe('🦉'.repeat(23) + '…') // the 48-cell cap: whole glyphs, an ellipsis for the rest
  // a selection the office no longer holds draws no drawer
  expect(buildOfficeProps(input([agent({ id: 'a1' })], { view: { ...DEFAULT_VIEW, selected: 'gone' } })).drawer).toBeNull()
})

test('buildOfficeProps: the empty office names its kind with the i18n message', () => {
  const p = buildOfficeProps(input([]))
  expect(p.rooms).toEqual([])
  expect(p.counts).toEqual({ run: 0, idle: 0, done: 0 })
  expect(p.empty).toEqual({ kind: 'office', msg: I18N.he.emptyOffice, sub: I18N.he.emptySub })
})

test('buildOfficeProps: star while the stamp is alive, enteredAt from firstSeen, offset clamped, name capped', () => {
  const done = agent({ id: 'a1', role: 'r'.repeat(40), status: 'done', end_ms: T0 - 1000 })
  const shown = { ...DEFAULT_PREFS, showDone: true }
  const p = buildOfficeProps(input([done], { payload: { ...EMPTY_PAYLOAD, agents: [done], stars: { a1: T0 - 3000 } }, prefs: shown, firstSeen: { a1: T0 - 500 }, offset: -4 }))
  const a = p.rooms[0]?.agents[0]
  expect(a?.star).toBe(T0 - 3000)
  expect(a?.enteredAt).toBe(T0 - 500)
  expect(a?.name).toHaveLength(24)
  expect(p.offset).toBe(0)
  const expired = buildOfficeProps(input([done], { payload: { ...EMPTY_PAYLOAD, agents: [done], stars: { a1: T0 - JUST_FINISHED_MS } }, prefs: shown }))
  expect(expired.rooms[0]?.agents[0]?.star).toBe(0)
  expect(expired.rooms[0]?.agents[0]?.enteredAt).toBe(0)
})

test('buildOfficeProps: 100 agents stay under the Client props bound', () => {
  const many = Array.from({ length: 100 }, (_, i) => agent({ id: `a${i}`, session_full: `s${i % 10}`, session: `s${i % 10}` }))
  const p = buildOfficeProps(input(many))
  expect(JSON.stringify(p).length).toBeLessThan(60_000) // measured 23,401 on 2026-10-10 (spec §6.2: ~25 KB)
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
  expect(p.footer.startsWith('+400 ')).toBe(true)
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
