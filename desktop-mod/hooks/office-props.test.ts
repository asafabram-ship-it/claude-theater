// office-props.ts: the slim JSON props of the desktop office Client. Pure:
// a payload, prefs, view and clocks in — plain JSON out (no undefined, task
// and result only inside the drawer, every text capped, 100 agents far under
// the Client's props bound).

import { expect, test } from 'claude-code/testing'

import { I18N } from './i18n'
import { DEFAULT_PREFS, DEFAULT_VIEW, EMPTY_PAYLOAD, JUST_FINISHED_MS, PERSONA_EMOJI } from './model'
import type { Agent } from './model'
import { assertJson, buildOfficeProps, modelFamily } from './office-props'
import type { OfficePropsInput } from './office-props'

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

test('assertJson throws on undefined anywhere', () => {
  expect(() => assertJson({ a: [{ b: undefined }] })).toThrow(/a\.0\.b/)
  expect(() => assertJson({ a: null, b: [1, 'x', true] })).not.toThrow()
})
