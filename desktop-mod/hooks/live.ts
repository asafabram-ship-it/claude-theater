// Live: the CURRENT session's subagents from the engine's own events, merged
// over the scanner's file-based data so this conversation's room is exact and
// immediate (no wait for a transcript flush).
//
// OWNER: builder "live". This module is PURE: reducers over the live map
// (Record<agentId, LiveAgent>) and the merge. register.tsx owns the hooks
// (agent.spawn, tool.call, the poll) and calls these through
// `update($, liveAtom, live => reducer(live, ...))`.
//
// ENGINE RULES (claude plugin validate refuses otherwise):
//   - `$` is never passed to a function imported from another file, so no
//     function here takes `$`.
//   - an event may be hooked only ONCE without a matcher per hooks module, so
//     the single agent.spawn / tool.call hooks live in register.tsx.
//
// Sources (spec table "מקורות נתונים") → reducer:
//   agent.spawn, after next (agentId, model)         liveSpawned
//   tool.call with e.agentId, before next            liveToolStarted  (phase 'tool', tool)
//   tool.call with e.agentId, after next             liveToolReturned (phase 'thinking')
//   main loop's `Agent` tool call, after next        liveAgentReturned (result, end_ms)
//   $.agent.list() sampled by the poll               liveAged (engine_status; silence rules;
//                                                    agents listed but never seen spawning —
//                                                    the mod loaded mid-session — are added)
//
// Status of a live agent (liveStatus, the port of Python compute_status with
// closed=false — the current conversation is open by definition):
//   1. engine_status completed/failed/killed, or a result present → 'done'
//      (failed/killed set `failed` on the merged agent → ❌ in the ui; the pane never
//      reads the live map itself).
//   2. in flight (engine says running AND a tool was dispatched at some point —
//      Python's "last assistant dispatched a tool / last record is a tool_result")
//      and silent <= IN_FLIGHT_MAX_SEC → 'running' (a long Bash is not "idle").
//   3. silent > RUNNING_STALE_SEC → 'stale', else 'running'.
// An agent $.agent.list does not know (workflow/fork) lives by its tool.call
// events alone and is marked completed when silent RUNNING_STALE_SEC after its
// Agent call returned (liveAged).
//
// Tests: hooks/live.test.ts drives the reducers directly (no engine needed):
// spawn → card; tool.call → "קורא"; return → "חושב"; finish → ⭐ + result.

import type { AgentInfo } from 'claude-code'

import { IN_FLIGHT_MAX_SEC, MAX_AGE_MIN, PERSONA_EMOJI, RUNNING_STALE_SEC, STATUS_ORDER, clipResult, personaIndex, shortTask } from './model'
import type { Agent, LiveAgent, Payload, TheaterStatus } from './model'
import { resolvePersonas } from './scanner'

export type LiveMap = Record<string, LiveAgent>

/** Engine task statuses that mean the loop is over. */
const TERMINAL_STATUSES: readonly string[] = ['completed', 'failed', 'killed']

/**
 * The text the Agent tool returns for a `run_in_background` spawn (2.1.288:
 * "Async agent launched successfully. … The agent is working in the
 * background."): an acknowledgment, not the subagent's report.
 */
export function isLaunchAck(text: string | undefined): boolean {
  return typeof text === 'string' && /^\s*Async agent launched/i.test(text)
}

/** What the agent.spawn hook knows once `next` returned. */
export type SpawnInfo = {
  agentId: string
  tool_use_id: string
  description: string
  subagentType: string
  prompt: string
  model: string
}

/** agent.spawn returned with an agentId: add (or refresh) the agent, phase 'thinking'. */
export function liveSpawned(live: LiveMap, spawn: SpawnInfo, now: number): LiveMap {
  const prior = live[spawn.agentId]
  const agent: LiveAgent = {
    id: spawn.agentId,
    description: spawn.description,
    subagent_type: spawn.subagentType,
    model: spawn.model,
    task: spawn.prompt,
    engine_status: 'running',
    phase: 'thinking',
    tool: '',
    start_ms: prior?.start_ms ?? now,
    last_ms: now,
    end_ms: null,
    result: null,
    truncated: false,
    tool_use_id: spawn.tool_use_id,
  }
  return { ...live, [spawn.agentId]: agent }
}

/** tool.call inside a live agent's loop, before next: the tool is pending. Unknown agentId → unchanged. */
export function liveToolStarted(live: LiveMap, agentId: string, tool: string, now: number): LiveMap {
  const a = live[agentId]
  if (!a) return live
  return { ...live, [agentId]: { ...a, phase: 'tool', tool, last_ms: now } }
}

/** tool.call inside a live agent's loop, after next: the tool returned, the model reasons. */
export function liveToolReturned(live: LiveMap, agentId: string, now: number): LiveMap {
  const a = live[agentId]
  if (!a) return live
  return { ...live, [agentId]: { ...a, phase: 'thinking', last_ms: now } }
}

/**
 * The main loop's `Agent` tool call returned: the subagent whose spawn carried
 * this tool_use_id is done with this result (clipped to RESULT_CHAR_LIMIT).
 * `text` undefined (denied, or no text) → done with an empty result. The last
 * tool is KEPT (Python keeps last_tool_use_name on a done agent; the drawer
 * draws it as a chip).
 */
export function liveAgentReturned(live: LiveMap, toolUseId: string, text: string | undefined, isError: boolean, now: number): LiveMap {
  const entry = Object.values(live).find(a => a.tool_use_id === toolUseId)
  if (!entry) return live
  // A background Agent call returns at once with a launch acknowledgment, not
  // the subagent's result: the agent keeps running (its end comes from
  // $.agent.list / the scanner's transcript or task-notification detection).
  if (!isError && isLaunchAck(text)) return live
  const { result, truncated } = clipResult(text ?? '')
  return {
    ...live,
    [entry.id]: {
      ...entry,
      result,
      truncated,
      end_ms: entry.end_ms ?? now,
      last_ms: now,
      engine_status: isError && entry.engine_status === 'running' ? 'failed' : entry.engine_status,
      phase: 'thinking',
    },
  }
}

/**
 * The poll sampled $.agent.list(): copy each listed agent's status (a change
 * counts as activity; a terminal status stamps end_ms); an agent not listed
 * whose Agent call already returned and that is silent for RUNNING_STALE_SEC
 * is marked completed; a listed agent the map has never seen (the mod loaded
 * after it spawned) is added from the listing. A DONE entry silent for longer
 * than MAX_AGE_MIN is evicted (Python's window: an agent whose file is that
 * old leaves the office), so the map — serialized across the host on every
 * tool.call — is bounded by the window, not by the session's length.
 * Returns the SAME map when nothing changed.
 */
export function liveAged(live: LiveMap, listed: readonly AgentInfo[], now: number): LiveMap {
  let out: LiveMap = live
  let changed = false
  const listedIds = new Set<string>()
  for (const info of listed) {
    if (!info || typeof info.id !== 'string' || !info.id) continue
    listedIds.add(info.id)
    const status = typeof info.status === 'string' && info.status ? info.status : 'running'
    const prior = live[info.id]
    if (!prior) {
      const added: LiveAgent = {
        id: info.id,
        description: info.description ?? '',
        subagent_type: info.type ?? '',
        model: '',
        task: '',
        engine_status: status,
        phase: 'thinking',
        tool: '',
        start_ms: now,
        last_ms: now,
        end_ms: TERMINAL_STATUSES.includes(status) ? now : null,
        result: null,
        truncated: false,
        tool_use_id: '',
      }
      if (!changed) { out = { ...live }; changed = true }
      out[info.id] = added
      continue
    }
    if (prior.engine_status === status) continue
    if (!changed) { out = { ...live }; changed = true }
    out[info.id] = {
      ...prior,
      engine_status: status,
      last_ms: now,
      end_ms: TERMINAL_STATUSES.includes(status) ? (prior.end_ms ?? now) : prior.end_ms,
    }
  }
  for (const a of Object.values(live)) {
    if (listedIds.has(a.id)) continue
    if (a.engine_status !== 'running' || a.end_ms === null) continue
    if (now - a.last_ms <= RUNNING_STALE_SEC * 1000) continue
    if (!changed) { out = { ...live }; changed = true }
    out[a.id] = { ...a, engine_status: 'completed' }
  }
  for (const a of Object.values(out)) {
    if (!liveAgedOut(a, now)) continue
    if (!changed) { out = { ...live }; changed = true }
    delete out[a.id]
  }
  return out
}

/** A finished live entry past the office's MAX_AGE_MIN window (measured from its last event / finish). */
export function liveAgedOut(a: LiveAgent, now: number): boolean {
  return liveIsDone(a) && now - Math.max(a.last_ms, a.end_ms ?? 0) > MAX_AGE_MIN * 60_000
}

/** True once the engine (or the Agent call's return) says the loop is over. */
export function liveIsDone(a: LiveAgent): boolean {
  return TERMINAL_STATUSES.includes(a.engine_status) || a.result !== null
}

/**
 * Python compute_status for a live agent (closed=false). in_flight = the
 * engine still runs it and a tool was ever dispatched (phase 'tool', or a
 * tool name kept after it returned): a mid-tool / awaiting-model agent is
 * working, bounded by IN_FLIGHT_MAX_SEC so a hung one is never pinned.
 */
export function liveStatus(a: LiveAgent, now: number): TheaterStatus {
  if (liveIsDone(a)) return 'done'
  const silentSec = (now - a.last_ms) / 1000
  const idle = silentSec > RUNNING_STALE_SEC
  const inFlight = a.engine_status === 'running' && a.tool !== ''
  if (inFlight && silentSec <= IN_FLIGHT_MAX_SEC) return 'running'
  return idle ? 'stale' : 'running'
}

/** The sort scanAll applies: STATUS_ORDER, the lead first, newest first. Stable (JS sort is). */
export function sortAgents(agents: Agent[]): Agent[] {
  return agents.sort((x, y) =>
    (STATUS_ORDER[x.status] ?? 3) - (STATUS_ORDER[y.status] ?? 3)
    || (y.is_session ? 1 : 0) - (x.is_session ? 1 : 0)
    || (y.start_ms ?? 0) - (x.start_ms ?? 0))
}

/** A live entry as the office draws it; `scan` (the scanner's agent of the same id) and `lead` (the room lead) fill what events do not carry. */
function liveToAgent(a: LiveAgent, now: number, sessionId: string, scan: Agent | undefined, lead: Agent | undefined): Agent {
  const pid = scan?.persona_id ?? personaIndex(a.id)
  const task = a.task || scan?.task || ''
  const sessionFull = scan?.session_full || sessionId
  let status = liveStatus(a, now)
  let result = a.result
  let truncated = a.truncated
  let endMs = a.end_ms
  // "done wins" (compute_status step 1): the transcript may have recorded the
  // final text before the Agent call returned to the main loop.
  if (status !== 'done' && scan?.status === 'done') {
    status = 'done'
    result = scan.result
    truncated = scan.truncated
    endMs = scan.end_ms
  }
  return {
    id: a.id,
    persona_id: pid,
    emoji: scan?.emoji ?? PERSONA_EMOJI[pid] ?? '',
    role: a.description || scan?.role || '',
    subagent_type: a.subagent_type || scan?.subagent_type || '',
    status,
    tool: a.tool,
    phase: a.phase,
    task,
    task_short: scan && task === scan.task ? scan.task_short : shortTask(task),
    result,
    start_ms: scan?.start_ms ?? a.start_ms,
    end_ms: endMs,
    session: sessionFull.slice(0, 8),
    session_full: sessionFull,
    cwd: scan?.cwd || lead?.cwd || '',
    project: scan?.project || lead?.project || '',
    mtime_ms: Math.max(a.last_ms, scan?.mtime_ms ?? 0),
    is_session: false,
    closed: scan?.closed ?? false,
    is_workflow: scan?.is_workflow ?? false,
    truncated,
    // live wins when agent.spawn named a model; else the transcript's latest assistant record
    model: a.model || scan?.model || '',
    // ❌ as the engine reports it (the pane draws it from the payload, never from the live map)
    ...(a.engine_status === 'failed' || a.engine_status === 'killed' ? { failed: true } : {}),
  }
}

/**
 * PURE merge of the live map over the scanned payload. A live agent REPLACES
 * the scanner's agent of the same id (keeping the scanner's project, cwd,
 * persona_id/emoji, and its task/role/model when the events carry none); a live
 * agent the scanner has not seen yet is added to this session's room
 * (session_full = sessionId, session = its first 8 chars, project/cwd from the
 * room's lead). A done entry past MAX_AGE_MIN is skipped (belt and braces over
 * liveAged's eviction: stale state after a reload cannot resurrect it). Then
 * re-sort as scanAll does (STATUS_ORDER, lead first, newest first) and re-run
 * resolvePersonas. The scanner's objects are never mutated.
 */
export function mergeLive(payload: Payload, live: LiveMap, sessionId: string, now: number): Payload {
  const entries = Object.values(live).filter(a => !liveAgedOut(a, now))
  if (entries.length === 0) return payload
  const lead = payload.agents.find(a => a.is_session && a.session_full === sessionId)
  const byId = new Map<string, Agent>()
  for (const a of payload.agents) byId.set(a.id, { ...a })
  for (const a of entries) {
    byId.set(a.id, liveToAgent(a, now, sessionId, byId.get(a.id), lead))
  }
  const agents = Array.from(byId.values())
  try {
    resolvePersonas(agents)
  } catch {
    // scanner not ported yet (or a bad agent): keep the hash-based personas.
  }
  return { ...payload, agents: sortAgents(agents) }
}
