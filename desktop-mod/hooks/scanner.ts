// Scanner: the TypeScript port of claude_theater.py's file reading over `$.fs`.
// Reads ~/.claude/projects/**/agent-*.jsonl, the parent session files, the
// workflow journal.jsonl files and the ~/.claude/sessions/<pid>.json registry,
// and produces the office payload (every open conversation, one room each).
//
// OWNER: builder "scanner". Contract (do not rename exports; register.tsx and
// live.ts call them):
//   scanAll(io, now)     -> Payload           the whole office, sorted, personas resolved
//   demoPayload(now)     -> Payload           the synthetic office (--demo), never touches files
//   resolveHome(io)      -> string            "~" (HOME, else USERPROFILE), "" when neither
//
// ENGINE RULE (claude plugin validate refuses otherwise): `$` itself is never
// passed across an import. The scanner therefore takes a `ScanIo` adapter: a
// handful of closures register.tsx builds IN ITS OWN FILE over $.fs / $.env
// (`scanIo($)`). This also makes the scanner testable with an in-memory Io
// over the fixtures, no engine needed.
// The pure functions below port the Python functions of the same name and
// MUST keep their semantics (tests under hooks/scanner.test.ts use the
// fixtures in ../../fixtures/cc-2.1 and cc-future).
//
// Rules:
// - No DOM, no Node: every read goes through io.read / io.list / io.stat / io.exists
//   (= $.fs.read / list / stat / exists, same shapes, see ScanIo).
// - Never throw out of scanAll: a file that cannot be read is skipped and counted.
// - Files over FS_READ_LIMIT (4 MiB): `$.fs.read` rejects them and `$.fs` has no
//   tail read. Behaviour (documented in the plan): the file is SKIPPED, counted in
//   payload.oversized, and the agent it holds is not drawn; the footer shows the
//   count. (A future builder may use `$.process.run(['tail', ...])` / PowerShell
//   `Get-Content -Tail` to read the tail; keep it optional and failure-tolerant.)
// - Throttle: directory listings are cached GLOB_TTL_SEC between scans; parsed
//   agents are cached per (path, mtime, size) and only `status`/`closed` are
//   recomputed on a cache hit (Python _AGENT_CACHE). Caches are module-level
//   (lost on hot reload, which is fine: they are rebuilt on the next scan).

import type { FsEntry, FsStat } from 'claude-code'

import {
  CONTINUATION_STOP_REASONS,
  EMPTY_PAYLOAD,
  IN_FLIGHT_MAX_SEC,
  RUNNING_STALE_SEC,
  type Agent,
  type Payload,
  type TheaterPhase,
  type TheaterStatus,
} from './model'

/**
 * The file-system surface the scanner needs, as closures over `$` built by the
 * hooks module (`scanIo($)` in register.tsx). Same contracts as `$.fs.*`:
 * `read` rejects a missing file and one over FS_READ_LIMIT; `list` rejects a
 * missing directory; `stat` rejects ENOENT; `exists` never rejects.
 */
export type ScanIo = {
  read: (path: string) => Promise<string>
  list: (path: string) => Promise<FsEntry[]>
  stat: (path: string) => Promise<FsStat>
  exists: (path: string) => Promise<boolean>
  /** $HOME, else %USERPROFILE% (register.tsx reads both with literal names, as `$.env.get` requires). */
  home: () => Promise<string | undefined>
}

// ---------------------------------------------------------------------------
// Transcript events (Python class Event / parse_agent_event / parse_events)
// ---------------------------------------------------------------------------

/** One parsed transcript line (agent-*.jsonl or a session file). */
export type TranscriptEvent = {
  /** The record's `type` ("user", "assistant", "system", ...). */
  kind: string
  /** Concatenated text blocks of the message ("" when none). */
  text: string
  /** Names of the tool_use blocks in an assistant message. */
  toolUses: string[]
  /** True when a user record carries a tool_result block. */
  hasToolResult: boolean
  /** `message.stop_reason`, null when absent. */
  stopReason: string | null
  /** Record timestamp in ms, null when unreadable. */
  tsMs: number | null
  /** The record's `version` field ("" when absent). */
  version: string
  /** The raw parsed record (for `cwd`, `sessionId`, ...). */
  raw: Record<string, unknown>
}

/**
 * Python parse_agent_event: one JSON line → TranscriptEvent, or null when the
 * line is not a JSON object with a `type` (counted as skipped by the caller).
 * Never throws.
 */
export function parseAgentEvent(line: string): TranscriptEvent | null {
  void line
  throw notImplemented('parseAgentEvent')
}

/** Python parse_events: every line, in order, dropping unparsable ones; returns the events and the skipped count. */
export function parseEvents(lines: string[]): { events: TranscriptEvent[]; skipped: number } {
  void lines
  throw notImplemented('parseEvents')
}

/** Python last_tool_use_name: name of the last tool_use in the last assistant event that has one, else "". */
export function lastToolUseName(events: TranscriptEvent[]): string {
  void events
  throw notImplemented('lastToolUseName')
}

// ---------------------------------------------------------------------------
// State decisions (Python detect_done / compute_in_flight / compute_phase /
// compute_status). These four are the semantics the whole product rests on.
// ---------------------------------------------------------------------------

export type DoneInfo = {
  isDone: boolean
  endMs: number | null
  result: string | null
  truncated: boolean
}

/**
 * Python detect_done: the last user/assistant event is an assistant message
 * with NO tool_use and a stop_reason that is not in CONTINUATION_STOP_REASONS
 * (deny-list: tool_use, pause_turn). Result text collapsed and clipped with
 * clipResult().
 */
export function detectDone(events: TranscriptEvent[]): DoneInfo {
  void events
  void CONTINUATION_STOP_REASONS
  throw notImplemented('detectDone')
}

/** Python compute_in_flight: last assistant dispatched a tool, or last record is a user tool_result. */
export function computeInFlight(events: TranscriptEvent[]): boolean {
  void events
  throw notImplemented('computeInFlight')
}

/** Python compute_phase: "tool" when the last assistant turn has a pending tool_use, else "thinking". */
export function computePhase(events: TranscriptEvent[]): TheaterPhase {
  void events
  throw notImplemented('computePhase')
}

/**
 * Python compute_status — the single ordered decision, shared by agents and
 * session leads. `nowSec`/`mtimeSec` in SECONDS (as Python), to keep the
 * thresholds readable:
 *   1. done wins
 *   2. closed + idle (raw mtime > RUNNING_STALE_SEC) collapses to done
 *   3. in_flight and not closed and silent <= IN_FLIGHT_MAX_SEC → running
 *   4. else stale when idle, else running
 */
export function computeStatus(
  nowSec: number,
  mtimeSec: number,
  isDone: boolean,
  inFlight: boolean,
  closed: boolean,
): TheaterStatus {
  void nowSec
  void mtimeSec
  void isDone
  void inFlight
  void closed
  void RUNNING_STALE_SEC
  void IN_FLIGHT_MAX_SEC
  throw notImplemented('computeStatus')
}

// ---------------------------------------------------------------------------
// Workflow agents (journal.jsonl beside the agent file)
// ---------------------------------------------------------------------------

/** Python is_workflow_agent: the agent file's directory holds a journal.jsonl (or the path says /workflows/). */
export function isWorkflowAgent(io: ScanIo, agentPath: string): Promise<boolean> {
  void io
  void agentPath
  throw notImplemented('isWorkflowAgent')
}

/**
 * Python workflow_journal_result: the journal's `result` record for this
 * agent id → DoneInfo (endMs null: the journal carries no timestamp; the
 * caller substitutes the file mtime). Not found → isDone false.
 */
export function workflowJournalResult(io: ScanIo, agentPath: string, agentId: string): Promise<DoneInfo> {
  void io
  void agentPath
  void agentId
  throw notImplemented('workflowJournalResult')
}

// ---------------------------------------------------------------------------
// Parent session file: names, project cwd, topic
// ---------------------------------------------------------------------------

export type NameInfo = { description: string; subagent_type: string }

/** Python _norm_prompt: collapse whitespace, trim; the join key between an agent's task and its Agent/Task call. */
export function normPrompt(s: string): string {
  void s
  throw notImplemented('normPrompt')
}

/** Python parent_session_file: `<dir>/<session_id>.jsonl` beside the agent file, or null. */
export function parentSessionFile(agentPath: string, sessionId: string): string | null {
  void agentPath
  void sessionId
  throw notImplemented('parentSessionFile')
}

/**
 * Python name_map_for: every Agent/Task tool_use in the parent transcript →
 * { normPrompt(prompt): { description, subagent_type } }. mtime-cached per file.
 */
export function nameMapFor(io: ScanIo, parentFile: string | null): Promise<Map<string, NameInfo>> {
  void io
  void parentFile
  throw notImplemented('nameMapFor')
}

/** Python project_cwd_for: the conversation's real working directory from the parent file's first record ("" unknown). */
export function projectCwdFor(io: ScanIo, parentFile: string | null): Promise<string> {
  void io
  void parentFile
  throw notImplemented('projectCwdFor')
}

/** Python session_summary: (topic, cwd) of a top-level conversation — the first user text, shortened. */
export function sessionSummary(io: ScanIo, sessionFile: string): Promise<{ topic: string; cwd: string }> {
  void io
  void sessionFile
  throw notImplemented('sessionSummary')
}

// ---------------------------------------------------------------------------
// Open conversations registry (~/.claude/sessions/<pid>.json)
// ---------------------------------------------------------------------------

/**
 * Python live_session_ids: the session ids of OPEN conversations, or null when
 * the registry directory does not exist (older build → nothing is hidden).
 * A registry record whose pid is dead is ignored where the host lets us tell
 * (Python _pid_alive); through `$` there is no kill(pid, 0), so a builder may
 * add a closure to ScanIo (built in register.tsx) or trust the file's presence. Cached by the
 * directory listing signature.
 */
export function liveSessionIds(io: ScanIo, home: string, nowSec: number): Promise<Set<string> | null> {
  void io
  void home
  void nowSec
  throw notImplemented('liveSessionIds')
}

// ---------------------------------------------------------------------------
// Personas (Python resolve_personas): distinct within a room, stable across scans
// ---------------------------------------------------------------------------

/**
 * Mutates `persona_id`/`emoji` on each agent: group by room (session_full or
 * the agent's own id), re-seat incumbents on their remembered slot, place
 * newcomers by linear probing from personaIndex(id). Module-level memory
 * `(roomKey, id) → slot`, pruned of agents no longer present.
 */
export function resolvePersonas(agents: Agent[]): void {
  void agents
  throw notImplemented('resolvePersonas')
}

// ---------------------------------------------------------------------------
// Entry points used by register.tsx
// ---------------------------------------------------------------------------

/** "~": $HOME, else %USERPROFILE%; "" when neither is set (the scan then yields an empty office). */
export async function resolveHome(io: ScanIo): Promise<string> {
  const home = (await io.home()) ?? ''
  return home.replace(/[\\/]+$/, '')
}

/**
 * Python _scan_agents + scan_sessions: the whole office.
 * - every agent-*.jsonl under ~/.claude/projects changed within MAX_AGE_MIN
 * - plus every open top-level conversation as its room's lead (is_session)
 * - closed = registry says the chat is gone; status via computeStatus
 * - role/subagent_type re-resolved every scan from the parent's name map
 * - resolvePersonas, then sort (STATUS_ORDER, lead first, newest first)
 * `now` is ms since epoch (the caller's $.clock.now()). Never throws: on an unexpected
 * error it returns the last good payload (or EMPTY_PAYLOAD) and rethrows
 * NOTHING — the caller records $.state scanError from the `error` field.
 */
export async function scanAll(io: ScanIo, now: number): Promise<Payload & { error?: string }> {
  void io
  // STUB: an empty office until the scanner is ported.
  return { ...EMPTY_PAYLOAD, scanned_ms: now }
}

/**
 * Python demo_payload: a synthetic, populated office (rooms, personas, one
 * long-running ⏰ agent, one just-finished ⭐ agent, a stale one, an MCP tool).
 * Pure: builds in memory, never reads files. `phase` cycles the scene so the
 * demo animates (Python: phase=None picks by time).
 */
export function demoPayload(now: number, phase?: number): Payload {
  void phase
  // STUB: the ui builder may draw against this until the scanner builder fills it.
  return { ...EMPTY_PAYLOAD, scanned_ms: now, demo: true }
}

function notImplemented(name: string): Error {
  return new Error(`agent-theater scanner: ${name} is not ported yet`)
}
