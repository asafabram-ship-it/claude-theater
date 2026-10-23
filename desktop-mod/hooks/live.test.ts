// live.ts: the reducers over this session's agents and the merge over the
// scanner's payload. Pure, so no engine is driven here.

import type { AgentInfo } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { isLaunchAck, liveAged, liveAgedOut, liveAgentReturned, liveSpawned, liveStatus, liveToolReturned, liveToolStarted, mergeLive } from './live'
import type { LiveMap } from './live'
import { EMPTY_PAYLOAD, IN_FLIGHT_MAX_SEC, MAX_AGE_MIN, PERSONA_EMOJI, RUNNING_STALE_SEC, personaIndex } from './model'
import type { Agent, Payload } from './model'
import { resetScannerCaches } from './scanner'

const SESSION = '0123456789abcdef-session'
const T0 = 1_000_000

function spawn(id: string, toolUseId = `t-${id}`, now = T0): LiveMap {
  return liveSpawned({}, { agentId: id, tool_use_id: toolUseId, description: `desc ${id}`, subagentType: 'Explore', prompt: `Read ${id}. Then stop.`, model: 'haiku' }, now)
}

function listed(id: string, status: AgentInfo['status'], extra: Partial<AgentInfo> = {}): AgentInfo {
  return { id, description: `listed ${id}`, type: 'general-purpose', status, ...extra }
}

function scanAgent(over: Partial<Agent>): Agent {
  return {
    id: 'x', persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: '', subagent_type: '', status: 'running', tool: '', phase: 'thinking',
    task: '', task_short: '', result: null, start_ms: T0, end_ms: null, session: SESSION.slice(0, 8), session_full: SESSION,
    cwd: '', project: '', mtime_ms: T0, is_session: false, closed: false, is_workflow: false, truncated: false, model: '', ...over,
  }
}

function payloadOf(...agents: Agent[]): Payload {
  return { ...EMPTY_PAYLOAD, agents, scanned_ms: T0 }
}

test('spawn → tool → thinking → result keeps start_ms and the last tool', () => {
  let live = spawn('a1')
  expect(live.a1?.start_ms).toBe(T0)
  expect(live.a1?.phase).toBe('thinking')
  live = liveToolStarted(live, 'a1', 'Read', T0 + 1000)
  expect(live.a1?.phase).toBe('tool')
  expect(live.a1?.tool).toBe('Read')
  live = liveToolReturned(live, 'a1', T0 + 2000)
  expect(live.a1?.phase).toBe('thinking')
  expect(live.a1?.tool).toBe('Read')
  expect(liveToolStarted(live, 'nobody', 'Read', T0)).toBe(live)
  live = liveAgentReturned(live, 't-a1', '  all   done ', false, T0 + 3000)
  expect(live.a1?.result).toBe('all done')
  expect(live.a1?.end_ms).toBe(T0 + 3000)
  expect(live.a1?.tool).toBe('Read') // Python keeps last_tool_use_name on a done agent (the drawer's tool chip)
  expect(live.a1?.engine_status).toBe('running')
  // a re-spawn of the same id keeps its first start
  live = liveSpawned(live, { agentId: 'a1', tool_use_id: 't2', description: '', subagentType: '', prompt: '', model: '' }, T0 + 9000)
  expect(live.a1?.start_ms).toBe(T0)
})

test('mergeLive marks a failed/killed live agent `failed` (the pane draws ❌ from the payload, never from the live map)', () => {
  let live = spawn('a1')
  live = liveAgentReturned(live, 't-a1', undefined, true, T0 + 1)
  const merged = mergeLive(payloadOf(), live, SESSION, T0 + 2)
  expect(merged.agents.find(a => a.id === 'a1')?.failed).toBe(true)
  const ok = mergeLive(payloadOf(), spawn('a2'), SESSION, T0 + 2)
  expect('failed' in (ok.agents.find(a => a.id === 'a2') ?? {})).toBe(false)
})

test('a background Agent call returns a launch acknowledgment, not a result: the agent stays running', () => {
  const live = spawn('a1')
  const ack = 'Async agent launched successfully. (This tool result is internal metadata — never quote it.)\nagentId: a1 (internal ID)\nThe agent is working in the background.'
  expect(isLaunchAck(ack)).toBe(true)
  expect(isLaunchAck('All done.')).toBe(false)
  expect(isLaunchAck(undefined)).toBe(false)
  expect(liveAgentReturned(live, 't-a1', ack, false, T0 + 1000)).toBe(live)
  expect(liveStatus(live.a1!, T0 + 1000)).toBe('running')
  // a denied/errored launch still marks the agent failed
  expect(liveAgentReturned(live, 't-a1', ack, true, T0 + 1000).a1?.engine_status).toBe('failed')
})

test('Agent call denied or errored marks the agent failed; unknown tool_use_id is ignored', () => {
  const live = spawn('a1')
  expect(liveAgentReturned(live, 'other', 'x', false, T0)).toBe(live)
  const failed = liveAgentReturned(live, 't-a1', undefined, true, T0 + 1)
  expect(failed.a1?.engine_status).toBe('failed')
  expect(failed.a1?.result).toBe('')
})

test('liveAged copies engine statuses, stamps end_ms on a terminal one, same map when unchanged', () => {
  const live = spawn('a1')
  expect(liveAged(live, [listed('a1', 'running')], T0 + 100)).toBe(live)
  expect(liveAged(live, [], T0 + 100)).toBe(live)
  const done = liveAged(live, [listed('a1', 'completed')], T0 + 500)
  expect(done).not.toBe(live)
  expect(done.a1?.engine_status).toBe('completed')
  expect(done.a1?.end_ms).toBe(T0 + 500)
  expect(done.a1?.last_ms).toBe(T0 + 500)
  // an end_ms already set by the Agent call's return is kept
  const returned = liveAgentReturned(live, 't-a1', 'ok', false, T0 + 200)
  expect(liveAged(returned, [listed('a1', 'completed')], T0 + 900).a1?.end_ms).toBe(T0 + 200)
})

test('liveAged: an unlisted agent whose Agent call returned goes completed after RUNNING_STALE_SEC of silence', () => {
  const returned = liveAgentReturned(spawn('a1'), 't-a1', 'ok', false, T0)
  expect(liveAged(returned, [], T0 + RUNNING_STALE_SEC * 1000)).toBe(returned)
  const aged = liveAged(returned, [], T0 + RUNNING_STALE_SEC * 1000 + 1)
  expect(aged.a1?.engine_status).toBe('completed')
  // still running with no result: never marked done by silence alone
  const quiet = spawn('b1')
  expect(liveAged(quiet, [], T0 + 10 * RUNNING_STALE_SEC * 1000)).toBe(quiet)
})

test('liveAged adds an agent the engine lists but the map never saw spawning', () => {
  const live = spawn('a1')
  const aged = liveAged(live, [listed('a1', 'running'), listed('z9', 'running', { type: 'teammate' })], T0 + 10)
  expect(aged.z9?.description).toBe('listed z9')
  expect(aged.z9?.subagent_type).toBe('teammate')
  expect(aged.z9?.start_ms).toBe(T0 + 10)
  expect(aged.z9?.end_ms).toBe(null)
  expect(aged.a1).toBe(live.a1)
})

test('liveAged evicts a done entry past MAX_AGE_MIN (and mergeLive skips one a stale state still carries); a running one stays', () => {
  const window = MAX_AGE_MIN * 60_000
  let live: LiveMap = { ...spawn('old', 't-old'), ...spawn('fresh', 't-fresh'), ...spawn('busy', 't-busy') }
  live = liveAgentReturned(live, 't-old', 'done long ago', false, T0 + 10)
  live = liveAgentReturned(live, 't-fresh', 'done just now', false, T0 + window) // last event inside the window
  expect(liveAgedOut(live.old!, T0 + 10 + window)).toBe(false)
  expect(liveAgedOut(live.old!, T0 + 11 + window)).toBe(true)
  const aged = liveAged(live, [], T0 + 11 + window)
  expect(aged.old).toBeUndefined()
  expect(aged.fresh?.result).toBe('done just now')
  expect(aged.busy?.engine_status).toBe('running') // never evicted while running, however old
  // belt and braces: a reload with the un-aged map cannot resurrect the old one
  const merged = mergeLive(payloadOf(), live, SESSION, T0 + 11 + window)
  expect(merged.agents.map(a => a.id).sort()).toEqual(['busy', 'fresh'])
  // the same map comes back while nothing aged out (listed running: no silence rule either)
  const all = [listed('old', 'running'), listed('fresh', 'running'), listed('busy', 'running')]
  expect(liveAged(live, all, T0 + 10 + window)).toBe(live)
})

test('liveStatus: done wins, mid-tool is rescued up to IN_FLIGHT_MAX_SEC, idle without a tool is stale', () => {
  const fresh = spawn('a1').a1!
  expect(liveStatus(fresh, T0)).toBe('running')
  expect(liveStatus(fresh, T0 + RUNNING_STALE_SEC * 1000 + 1)).toBe('stale')
  const midTool = liveToolStarted(spawn('a1'), 'a1', 'Bash', T0).a1!
  expect(liveStatus(midTool, T0 + 5 * RUNNING_STALE_SEC * 1000)).toBe('running')
  expect(liveStatus(midTool, T0 + IN_FLIGHT_MAX_SEC * 1000 + 1)).toBe('stale')
  const killed = { ...fresh, engine_status: 'killed' }
  expect(liveStatus(killed, T0)).toBe('done')
  const returned = liveAgentReturned(spawn('a1'), 't-a1', 'ok', false, T0).a1!
  expect(liveStatus(returned, T0)).toBe('done')
})

test('mergeLive: empty live map returns the payload untouched', () => {
  const payload = payloadOf(scanAgent({ id: 'x' }))
  expect(mergeLive(payload, {}, SESSION, T0)).toBe(payload)
})

test('mergeLive adds an unseen live agent to this session room with the lead project', () => {
  const lead = scanAgent({ id: SESSION, is_session: true, project: 'C:/proj', cwd: 'C:/proj', start_ms: T0 - 50_000 })
  const other = scanAgent({ id: 'other', session_full: 'zzz', session: 'zzz', start_ms: T0 - 1000 })
  const live = liveToolStarted(spawn('a1', 't-a1', T0 + 10), 'a1', 'Read', T0 + 20)
  const merged = mergeLive(payloadOf(lead, other), live, SESSION, T0 + 30)
  const a1 = merged.agents.find(a => a.id === 'a1')!
  expect(a1.session_full).toBe(SESSION)
  expect(a1.session).toBe(SESSION.slice(0, 8))
  expect(a1.project).toBe('C:/proj')
  expect(a1.cwd).toBe('C:/proj')
  expect(a1.role).toBe('desc a1')
  expect(a1.subagent_type).toBe('Explore')
  expect(a1.task).toBe('Read a1. Then stop.')
  expect(a1.task_short).toBe('Read a1.')
  expect(a1.tool).toBe('Read')
  expect(a1.phase).toBe('tool')
  expect(a1.status).toBe('running')
  expect(a1.start_ms).toBe(T0 + 10)
  expect(a1.mtime_ms).toBe(T0 + 20)
  expect(a1.is_session).toBe(false)
  expect(a1.closed).toBe(false)
  expect(a1.persona_id).toBe(personaIndex('a1'))
  expect(a1.emoji).toBe(PERSONA_EMOJI[personaIndex('a1')])
  expect(a1.model).toBe('haiku') // from agent.spawn
  // the scanner's objects are untouched and the other room is kept
  expect(merged.agents.length).toBe(3)
  expect(merged.agents.some(a => a.id === 'other')).toBe(true)
  expect(merged).not.toBe(lead)
})

test('mergeLive replaces the scanner agent of the same id but keeps its persona, project and cwd', () => {
  // resolvePersonas remembers seats across scans (Python behaviour); an earlier
  // test seated (SESSION, a1) elsewhere, so start from an empty office.
  resetScannerCaches()
  const scanned = scanAgent({ id: 'a1', persona_id: 7, emoji: PERSONA_EMOJI[7] ?? '', project: 'C:/p', cwd: 'C:/p/sub', role: 'old role', subagent_type: 'old', task: 'old task', task_short: 'old task', tool: 'Grep', phase: 'tool', start_ms: T0 - 5 })
  const live = liveToolReturned(liveToolStarted(spawn('a1'), 'a1', 'Bash', T0 + 1), 'a1', T0 + 2)
  const merged = mergeLive(payloadOf(scanned), live, SESSION, T0 + 3)
  expect(merged.agents.length).toBe(1)
  const a1 = merged.agents[0]!
  expect(a1.persona_id).toBe(7)
  expect(a1.emoji).toBe(PERSONA_EMOJI[7])
  expect(a1.project).toBe('C:/p')
  expect(a1.cwd).toBe('C:/p/sub')
  expect(a1.role).toBe('desc a1')
  expect(a1.task).toBe('Read a1. Then stop.')
  expect(a1.tool).toBe('Bash')
  expect(a1.phase).toBe('thinking')
  expect(a1.start_ms).toBe(T0 - 5)
  expect(scanned.tool).toBe('Grep')
})

test('mergeLive: a listed-only agent (no spawn seen) falls back to the scanner task and role', () => {
  const scanned = scanAgent({ id: 'z9', role: 'scan role', subagent_type: 'scan type', task: 'scan task', task_short: 'scan task' })
  const live = liveAged({}, [listed('z9', 'running', { description: '' })], T0)
  const z9 = mergeLive(payloadOf(scanned), live, SESSION, T0).agents[0]!
  expect(z9.task).toBe('scan task')
  expect(z9.task_short).toBe('scan task')
  expect(z9.role).toBe('scan role')
  expect(z9.subagent_type).toBe('general-purpose')
})

test('mergeLive status: done with result, failed, stale by silence, scanner done wins', () => {
  const now = T0 + 1000
  let live: LiveMap = { ...spawn('r1'), ...spawn('f1', 't-f1'), ...spawn('s1', 't-s1', T0 - 2 * RUNNING_STALE_SEC * 1000), ...spawn('d1', 't-d1') }
  live = liveAgentReturned(live, 't-r1', 'the answer', false, now - 10)
  live = liveAgentReturned(live, 't-f1', 'boom', true, now - 10)
  const scannedDone = scanAgent({ id: 'd1', status: 'done', result: 'from transcript', end_ms: now - 500, truncated: false })
  const merged = mergeLive(payloadOf(scannedDone), live, SESSION, now)
  const by = (id: string) => merged.agents.find(a => a.id === id)!
  expect(by('r1').status).toBe('done')
  expect(by('r1').result).toBe('the answer')
  expect(by('r1').end_ms).toBe(now - 10)
  expect(by('f1').status).toBe('done')
  expect(live.f1?.engine_status).toBe('failed')
  expect(by('s1').status).toBe('stale')
  expect(by('d1').status).toBe('done')
  expect(by('d1').result).toBe('from transcript')
  expect(by('d1').end_ms).toBe(now - 500)
})

test('mergeLive sorts running, stale, done; lead first within a status; newest first', () => {
  const lead = scanAgent({ id: SESSION, is_session: true, start_ms: T0 - 100_000 })
  const oldRunner = scanAgent({ id: 'old', start_ms: T0 - 50_000 })
  const doneOne = scanAgent({ id: 'done', status: 'done', start_ms: T0 + 5000 })
  let live: LiveMap = { ...spawn('new', 't-new', T0 + 100), ...spawn('stale', 't-stale', T0 - 2 * RUNNING_STALE_SEC * 1000) }
  live = liveAged(live, [listed('new', 'running'), listed('stale', 'running')], T0 + 100)
  const merged = mergeLive(payloadOf(doneOne, oldRunner, lead), live, SESSION, T0 + 200)
  expect(merged.agents.map(a => a.id)).toEqual([SESSION, 'new', 'old', 'stale', 'done'])
})

test("mergeLive model: live (agent.spawn) wins when non-empty, else the scanner's transcript model, else ''", () => {
  const scanned = scanAgent({ id: 'a1', model: 'claude-sonnet-5-5' })
  const scannedNoModel = scanAgent({ id: 'a2', model: '' })
  let live: LiveMap = { ...spawn('a1') } // model 'haiku'
  live = liveSpawned(live, { agentId: 'a2', tool_use_id: 't-a2', description: '', subagentType: '', prompt: '', model: '' }, T0)
  live = liveSpawned(live, { agentId: 'a3', tool_use_id: 't-a3', description: '', subagentType: '', prompt: '', model: 'claude-opus-5-5' }, T0)
  live = liveAged(live, [listed('z9', 'running')], T0) // listed only: no model known
  const merged = mergeLive(payloadOf(scanned, scannedNoModel), live, SESSION, T0 + 1)
  const by = (id: string) => merged.agents.find(a => a.id === id)!
  expect(by('a1').model).toBe('haiku')
  expect(by('a2').model).toBe('')
  expect(by('a3').model).toBe('claude-opus-5-5')
  expect(by('z9').model).toBe('')
  // a live entry with no model falls back to the scanner's
  const fallback = mergeLive(payloadOf(scanAgent({ id: 'a2', model: 'claude-haiku-4-5-20251001' })), { a2: live.a2! }, SESSION, T0 + 1)
  expect(fallback.agents[0]!.model).toBe('claude-haiku-4-5-20251001')
  expect(scanned.model).toBe('claude-sonnet-5-5') // the scanner's object is untouched
})
