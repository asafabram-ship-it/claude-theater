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
//   $.agent.list() sampled by the poll               liveAged (engine_status; silence rules)
//
// Status of a live agent (mergeLive): engine_status completed/failed/killed or
// result present → 'done' (failed/killed draw ❌); else silent >
// RUNNING_STALE_SEC → 'stale'; else 'running'. An agent $.agent.list does not
// know (workflow/fork) lives by its tool.call events alone and is marked done
// when silent 90 s (RUNNING_STALE_SEC) after its Agent call returned.
//
// Tests: hooks/live.test.ts drives the reducers directly (no engine needed):
// spawn → card; tool.call → "קורא"; return → "חושב"; finish → ⭐ + result.

import type { AgentInfo } from 'claude-code'

import { RUNNING_STALE_SEC, clipResult } from './model'
import type { LiveAgent, Payload } from './model'

export type LiveMap = Record<string, LiveAgent>

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
 * `text` undefined (denied, or no text) → done with an empty result.
 */
export function liveAgentReturned(live: LiveMap, toolUseId: string, text: string | undefined, isError: boolean, now: number): LiveMap {
  const entry = Object.values(live).find(a => a.tool_use_id === toolUseId)
  if (!entry) return live
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
      tool: '',
    },
  }
}

/**
 * The poll sampled $.agent.list(): copy each listed agent's status; an agent
 * not listed whose Agent call already returned and that is silent for
 * RUNNING_STALE_SEC is marked completed. Never drops an entry (the scanner's
 * MAX_AGE_MIN window is the eviction; mergeLive hides what the scanner hides).
 */
export function liveAged(live: LiveMap, listed: readonly AgentInfo[], now: number): LiveMap {
  void listed
  void now
  void RUNNING_STALE_SEC
  // STUB: pass-through until the builder ports the rules above.
  return live
}

/**
 * PURE merge of the live map over the scanned payload. A live agent REPLACES
 * the scanner's agent of the same id (keeping the scanner's project, cwd,
 * persona_id/emoji when present); a live agent the scanner has not seen yet is
 * added to this session's room (session_full = sessionId, session = its first
 * 8 chars). Then re-sort as scanAll does (STATUS_ORDER, lead first, newest
 * first) and re-run resolvePersonas (import it from ./scanner).
 */
export function mergeLive(payload: Payload, live: LiveMap, sessionId: string, now: number): Payload {
  void live
  void sessionId
  void now
  // STUB: pass-through until the builder merges.
  return payload
}
