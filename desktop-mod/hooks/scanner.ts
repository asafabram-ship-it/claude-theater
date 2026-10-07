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
//   (= $.fs.read / list / stat / exists, same shapes, see ScanIo). Paths are
//   handled as strings with "/" separators (Windows accepts them); `~` is
//   whatever `io.home()` answers, trailing separators stripped.
// - Never throw out of scanAll: a file that cannot be read is skipped and counted.
// - Files over FS_READ_LIMIT (4 MiB): `$.fs.read` rejects them and `$.fs` has no
//   partial read. Behaviour (documented in the plan):
//     * an agent transcript over the limit is SKIPPED (its agent is not drawn),
//     * a parent session file over the limit yields no names / no project cwd
//       for its subagents (role "" / project "") and no topic for its lead
//       (the lead is still drawn, from the file's stat alone),
//     * a workflow journal over the limit yields "no result yet",
//   and every such file is counted ONCE per scan in `payload.oversized`
//   (the footer shows `oversizedN`); never a crash. OPTIONAL closures on ScanIo
//   (`head`, `tail`; the hooks module may build them over `$.process.run`, e.g.
//   PowerShell `Get-Content -TotalCount / -Tail`) lift the limit for a
//   transcript (first line + tail), a journal (tail), a project cwd and a topic
//   (head); only the Agent/Task name map of an oversized parent still needs the
//   whole file and stays unknown (counted). Their absence is always tolerated.
// - Throttle: directory listings are cached GLOB_TTL_SEC between scans (Python
//   _throttled_glob); parsed agents are cached per (path, mtime, size) and only
//   `status`/`closed`/`role` are recomputed on a cache hit (Python _AGENT_CACHE);
//   parent files (names, project cwd), session files (topic) and journals are
//   cached by mtime. Caches are module-level (lost on hot reload, which is
//   fine: they are rebuilt on the next scan) and evicted like the Python ones:
//   agent entries whose file aged out, parent/session entries no longer
//   referenced, persona seats of agents no longer present.
// - `phase` of a room lead: the Python payload put "" there; the mod's
//   TheaterPhase type has no "" so a lead carries 'thinking' (the UI never
//   draws a lead's phase: `tool` is "" for it).

import type { FsEntry, FsStat } from 'claude-code'

import {
  CONTINUATION_STOP_REASONS,
  EMPTY_PAYLOAD,
  FS_READ_LIMIT,
  GLOB_TTL_SEC,
  IN_FLIGHT_MAX_SEC,
  KNOWN_CC_VERSIONS,
  MAX_AGE_MIN,
  PERSONA_EMOJI,
  RESULT_CHAR_LIMIT,
  RUNNING_STALE_SEC,
  STATUS_ORDER,
  TAIL_MAX_BYTES,
  clipResult,
  personaIndex,
  shortTask,
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
  /**
   * OPTIONAL: the first `lines` lines of a file of ANY size (text, lines joined
   * by "\n"). Used only for files over FS_READ_LIMIT; absent → such a file
   * degrades as documented in the header.
   */
  head?: (path: string, lines: number) => Promise<string>
  /** OPTIONAL: the last `bytes` bytes of a file of ANY size, as text. Same role as `head`. */
  tail?: (path: string, bytes: number) => Promise<string>
  /**
   * OPTIONAL: whether the process owning a ~/.claude/sessions record is alive
   * (Python _pid_alive). Absent → every registered session is trusted as open
   * (the engine removes the record on exit; only a crash leaves one behind).
   */
  pidAlive?: (pid: number) => Promise<boolean>
}

// ---------------------------------------------------------------------------
// Path helpers (strings, "/" separators; no Node `path`)
// ---------------------------------------------------------------------------

/** Backslashes → "/", trailing separators stripped (a bare drive root "C:/" keeps its slash). */
export function normPath(p: string): string {
  const s = (p ?? '').replace(/\\/g, '/')
  const stripped = s.replace(/\/+$/, '')
  return stripped === '' && s.startsWith('/') ? '/' : /^[A-Za-z]:$/.test(stripped) ? stripped + '/' : stripped
}

/** The directory part of a "/"-separated path ("" when none). */
export function dirname(p: string): string {
  const s = normPath(p)
  const idx = s.lastIndexOf('/')
  if (idx < 0) return ''
  if (idx === 0) return '/'
  const head = s.slice(0, idx)
  return /^[A-Za-z]:$/.test(head) ? head + '/' : head
}

/** The last path component. */
export function basename(p: string): string {
  const s = normPath(p)
  const idx = s.lastIndexOf('/')
  return idx < 0 ? s : s.slice(idx + 1)
}

/** Joins with "/" (the base's trailing separator tolerated). */
export function joinPath(base: string, ...parts: string[]): string {
  let out = normPath(base)
  for (const part of parts) {
    if (!part) continue
    out = out.endsWith('/') ? out + part : out === '' ? part : `${out}/${part}`
  }
  return out
}

// ---------------------------------------------------------------------------
// Reading helpers: the whole file when it fits, the optional closures otherwise
// ---------------------------------------------------------------------------

/** Why a file's text is unavailable. */
type Unreadable = { text: null; oversized: boolean }
type ReadOutcome = { text: string; oversized: false } | Unreadable

/**
 * Python read_tail_lines on an in-memory text: when longer than `maxBytes`
 * keep the last `maxBytes` chars and drop the (possibly partial) first line.
 * Chars approximate bytes here; the window is a tuning constant, not a contract.
 */
export function tailLines(text: string, maxBytes = TAIL_MAX_BYTES): string[] {
  let data = text ?? ''
  if (data.length > maxBytes) {
    data = data.slice(data.length - maxBytes)
    const nl = data.indexOf('\n')
    if (nl !== -1) data = data.slice(nl + 1)
  }
  return data.split('\n').filter(ln => ln.trim() !== '')
}

/** The first `lines` lines of a file (whole read when it fits, else `io.head`). */
async function readHead(io: ScanIo, path: string, size: number, lines: number): Promise<ReadOutcome> {
  if (size <= FS_READ_LIMIT) {
    try {
      const text = await io.read(path)
      return { text: text.split('\n').slice(0, lines).join('\n'), oversized: false }
    } catch {
      return { text: null, oversized: false }
    }
  }
  if (io.head) {
    try {
      return { text: await io.head(path, lines), oversized: false }
    } catch {
      /* fall through: degrade */
    }
  }
  return { text: null, oversized: true }
}

/** The whole file when it fits, else its last TAIL_MAX_BYTES via `io.tail`. */
async function readTail(io: ScanIo, path: string, size: number): Promise<ReadOutcome> {
  if (size <= FS_READ_LIMIT) {
    try {
      return { text: await io.read(path), oversized: false }
    } catch {
      return { text: null, oversized: false }
    }
  }
  if (io.tail) {
    try {
      return { text: await io.tail(path, TAIL_MAX_BYTES), oversized: false }
    } catch {
      /* fall through */
    }
  }
  return { text: null, oversized: true }
}

/** The whole file (Python: iterate every line). Over the limit: unavailable. */
async function readWhole(io: ScanIo, path: string, size: number): Promise<ReadOutcome> {
  if (size > FS_READ_LIMIT) return { text: null, oversized: true }
  try {
    return { text: await io.read(path), oversized: false }
  } catch {
    return { text: null, oversized: false }
  }
}

/** `io.stat` that answers null instead of rejecting. */
async function statOrNull(io: ScanIo, path: string): Promise<FsStat | null> {
  try {
    return await io.stat(path)
  } catch {
    return null
  }
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const rec: unknown = JSON.parse(line)
    return rec !== null && typeof rec === 'object' && !Array.isArray(rec) ? (rec as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

// ---------------------------------------------------------------------------
// Transcript events (Python class Event / parse_agent_event / parse_events)
// ---------------------------------------------------------------------------

/** One parsed transcript line (agent-*.jsonl or a session file). */
export type TranscriptEvent = {
  /** The record's `type` ("user", "assistant", "system", ...); "unknown" when absent. */
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
  /** The record's `version` field ("" when absent or not a string). */
  version: string
  /** The raw parsed record (for `cwd`, `sessionId`, ...). */
  raw: Record<string, unknown>
}

/** Python iso_to_ms: an ISO-8601 timestamp → ms since epoch, null when unreadable. */
export function isoToMs(s: unknown): number | null {
  if (typeof s !== 'string' || !s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? Math.trunc(t) : null
}

/**
 * Python parse_agent_event: one JSON line → TranscriptEvent, or null when the
 * line is not a JSON object with a `type` (counted as skipped by the caller).
 * Never throws.
 */
export function parseAgentEvent(line: string): TranscriptEvent | null {
  if (!line || line.trim() === '') return null
  const rec = parseJsonObject(line)
  if (rec === null) return null

  const rtype = rec.type
  const msg = asRecord(rec.message)
  const content = msg.content

  const textParts: string[] = []
  const toolUses: string[] = []
  let hasToolResult = false
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      const bt = b.type
      if (bt === 'text') {
        const t = b.text
        if (typeof t === 'string' && t) textParts.push(t)
      } else if (bt === 'tool_use') {
        const name = b.name
        toolUses.push(typeof name === 'string' ? name : '')
      } else if (bt === 'tool_result') {
        hasToolResult = true
      }
    }
  } else if (typeof content === 'string') {
    if (content) textParts.push(content)
  }

  const ver = rec.version
  const stop = msg.stop_reason
  return {
    kind: typeof rtype === 'string' && rtype ? rtype : 'unknown',
    text: textParts.join(' ').trim(),
    toolUses: toolUses.filter(Boolean),
    hasToolResult,
    stopReason: stop === undefined || stop === null ? null : typeof stop === 'string' ? stop : String(stop),
    tsMs: isoToMs(rec.timestamp),
    // Only trust a string version stamp (a future build emitting a number/object
    // must not later crash majorMinor()/sorting).
    version: typeof ver === 'string' ? ver : '',
    raw: rec,
  }
}

/**
 * Python parse_events: every line, in order, dropping unparsable ones; returns
 * the events, the skipped count (non-blank lines that did not parse) and the
 * distinct version stamps seen.
 */
export function parseEvents(lines: string[]): { events: TranscriptEvent[]; skipped: number; versions: string[] } {
  const events: TranscriptEvent[] = []
  const versions = new Set<string>()
  let skipped = 0
  for (const ln of lines) {
    const ev = parseAgentEvent(ln)
    if (ev === null) {
      if (ln && ln.trim() !== '') skipped += 1
      continue
    }
    events.push(ev)
    if (ev.version) versions.add(ev.version)
  }
  return { events, skipped, versions: [...versions] }
}

/** Python last_tool_use_name: name of the last tool_use in the last assistant event that has one, else "". */
export function lastToolUseName(events: TranscriptEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev && ev.kind === 'assistant' && ev.toolUses.length > 0) return ev.toolUses[ev.toolUses.length - 1] ?? ''
  }
  return ''
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

const NOT_DONE: DoneInfo = { isDone: false, endMs: null, result: null, truncated: false }

/**
 * Python detect_done: the last user/assistant event is an assistant message
 * with NO tool_use and a stop_reason that is not in CONTINUATION_STOP_REASONS
 * (deny-list: tool_use, pause_turn). Result text collapsed and clipped with
 * clipResult().
 */
export function detectDone(events: TranscriptEvent[]): DoneInfo {
  let last: TranscriptEvent | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev && (ev.kind === 'assistant' || ev.kind === 'user')) {
      last = ev
      break
    }
  }
  if (last === null || last.kind !== 'assistant') return { ...NOT_DONE }
  const hasTool = last.toolUses.length > 0
  const done = !hasTool && last.stopReason !== null && !CONTINUATION_STOP_REASONS.includes(last.stopReason)
  if (!done) return { ...NOT_DONE }
  const { result, truncated } = clipResult(last.text)
  return { isDone: true, endMs: last.tsMs, result, truncated }
}

/** Python compute_in_flight: last assistant dispatched a tool, or last record is a user tool_result. */
export function computeInFlight(events: TranscriptEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (!ev) continue
    if (ev.kind === 'assistant') return ev.toolUses.length > 0
    if (ev.kind === 'user') return ev.hasToolResult
  }
  return false
}

/** Python compute_phase: "tool" when the last assistant turn has a pending tool_use, else "thinking". */
export function computePhase(events: TranscriptEvent[]): TheaterPhase {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (!ev) continue
    if (ev.kind === 'assistant') return ev.toolUses.length > 0 ? 'tool' : 'thinking'
    if (ev.kind === 'user') return 'thinking' // a tool_result just landed → the model reasons
  }
  return 'thinking'
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
  const silent = nowSec - mtimeSec
  const idle = silent > RUNNING_STALE_SEC
  if (isDone) return 'done'
  if (closed && idle) return 'done'
  if (inFlight && !closed && silent <= IN_FLIGHT_MAX_SEC) return 'running'
  return idle ? 'stale' : 'running'
}

// ---------------------------------------------------------------------------
// Versions (Python major_minor / unknown_versions) — for the UI's drift banner
// ---------------------------------------------------------------------------

/** Python major_minor: "2.1.288" → "2.1"; a stamp without a dot is returned as is. */
export function majorMinor(version: string): string {
  const parts = (version ?? '').split('.')
  return parts.length >= 2 ? parts.slice(0, 2).join('.') : version ?? ''
}

/** Python unknown_versions: the sorted major.minor versions seen that are not in KNOWN_CC_VERSIONS. */
export function unknownVersions(versions: readonly string[]): string[] {
  const out = new Set<string>()
  for (const v of versions) {
    const mm = majorMinor(v)
    if (mm && !KNOWN_CC_VERSIONS.includes(mm)) out.add(mm)
  }
  return [...out].sort()
}

// ---------------------------------------------------------------------------
// Workflow agents (journal.jsonl beside the agent file)
// ---------------------------------------------------------------------------

/**
 * Python is_workflow_agent: the path says /workflows/wf_ (no I/O), else — the
 * mod's extension — the agent file's directory holds a journal.jsonl.
 */
export async function isWorkflowAgent(io: ScanIo, agentPath: string): Promise<boolean> {
  const p = normPath(agentPath)
  if (p.includes('/workflows/wf_')) return true
  try {
    return await io.exists(joinPath(dirname(p), 'journal.jsonl'))
  } catch {
    return false
  }
}

/** Python _workflow_result_text: a prose field of the structured result, else its compact JSON. */
export function workflowResultText(resultObj: unknown): string {
  if (typeof resultObj === 'string') return resultObj
  if (resultObj !== null && typeof resultObj === 'object' && !Array.isArray(resultObj)) {
    const rec = resultObj as Record<string, unknown>
    for (const k of ['notes', 'summary', 'text', 'message', 'result', 'classification_reason']) {
      const v = rec[k]
      if (typeof v === 'string' && v.trim() !== '') return v
    }
    try {
      return JSON.stringify(resultObj)
    } catch {
      return String(resultObj)
    }
  }
  return resultObj === null || resultObj === undefined ? '' : String(resultObj)
}

type JournalCacheEntry = { mtimeMs: number; size: number; oversized: boolean; results: Map<string, DoneInfo> }
/** journal path → parsed `result` records by agentId (Python re-reads every scan; the mod caches by mtime). */
const JOURNAL_CACHE = new Map<string, JournalCacheEntry>()

/** Parses the journal's `result` records (last one per agent wins: re-runs supersede). */
function parseJournalResults(lines: string[]): Map<string, DoneInfo> {
  const out = new Map<string, DoneInfo>()
  for (const ln of lines) {
    if (!ln.includes('"result"')) continue // cheap pre-filter before the JSON parse
    const rec = parseJsonObject(ln)
    if (rec === null || rec.type !== 'result') continue
    const agentId = rec.agentId
    if (typeof agentId !== 'string' || !agentId) continue
    const { result, truncated } = clipResult(workflowResultText(rec.result))
    out.set(agentId, { isDone: true, endMs: null, result: result || null, truncated })
  }
  return out
}

/**
 * Python workflow_journal_result: the journal's `result` record for this
 * agent id → DoneInfo (endMs null: the journal carries no timestamp; the
 * caller substitutes the file mtime). Not found → isDone false.
 */
export async function workflowJournalResult(io: ScanIo, agentPath: string, agentId: string): Promise<DoneInfo> {
  const entry = await journalFor(io, joinPath(dirname(agentPath), 'journal.jsonl'))
  const found = entry?.results.get(agentId)
  return found ? { ...found } : { ...NOT_DONE }
}

async function journalFor(io: ScanIo, journal: string): Promise<JournalCacheEntry | null> {
  const st = await statOrNull(io, journal)
  if (st === null || st.kind !== 'file') return null
  const cached = JOURNAL_CACHE.get(journal)
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached
  const read = await readTail(io, journal, st.size)
  const entry: JournalCacheEntry = {
    mtimeMs: st.mtimeMs,
    size: st.size,
    oversized: read.oversized,
    results: read.text === null ? new Map() : parseJournalResults(tailLines(read.text)),
  }
  JOURNAL_CACHE.set(journal, entry)
  return entry
}

// ---------------------------------------------------------------------------
// Parent session file: names, project cwd, topic
// ---------------------------------------------------------------------------

export type NameInfo = { description: string; subagent_type: string }

/** Python _norm_prompt: collapse whitespace, trim; the join key between an agent's task and its Agent/Task call. */
export function normPrompt(s: string): string {
  return (s ?? '').split(/\s+/).filter(Boolean).join(' ')
}

/**
 * Python parent_session_file: walk up from the agent file's directory to the
 * directory named `<session_id>`; the parent transcript is `<that>.jsonl`
 * beside it. null when sessionless or the session directory is not an ancestor.
 */
export function parentSessionFile(agentPath: string, sessionId: string): string | null {
  if (!sessionId) return null
  let p = dirname(agentPath)
  while (p && basename(p) !== sessionId) {
    const nxt = dirname(p)
    if (nxt === p || nxt === '') return null
    p = nxt
  }
  return p ? p + '.jsonl' : null
}

type NameCacheEntry = { mtimeMs: number; oversized: boolean; map: Map<string, NameInfo> }
type ProjectCacheEntry = { mtimeMs: number; oversized: boolean; cwd: string }
type SessionCacheEntry = { mtimeMs: number; oversized: boolean; topic: string; cwd: string }

const NAME_CACHE = new Map<string, NameCacheEntry>() // parent file → Agent/Task prompt → {description, subagent_type}
const PROJECT_CACHE = new Map<string, ProjectCacheEntry>() // parent file → the conversation's real working dir
const SESSION_CACHE = new Map<string, SessionCacheEntry>() // session file → (topic, cwd)

/** Python name_map_for's parse: every Agent/Task tool_use → first spawn of a prompt wins. */
export function parseNameMap(text: string): Map<string, NameInfo> {
  const m = new Map<string, NameInfo>()
  for (const ln of text.split('\n')) {
    if (!ln.includes('"type":"tool_use"') || !ln.includes('"description"')) continue
    const rec = parseJsonObject(ln)
    if (rec === null || rec.type !== 'assistant') continue
    const content = asRecord(rec.message).content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const b = asRecord(block)
      if (b.type !== 'tool_use' || (b.name !== 'Task' && b.name !== 'Agent')) continue
      const inp = asRecord(b.input)
      const key = normPrompt(typeof inp.prompt === 'string' ? inp.prompt : '')
      // First spawn wins: re-running the same prompt later must not overwrite
      // the earlier agent's role with a new one.
      if (key && !m.has(key)) {
        m.set(key, {
          description: typeof inp.description === 'string' ? inp.description : '',
          subagent_type: typeof inp.subagent_type === 'string' ? inp.subagent_type : '',
        })
      }
    }
  }
  return m
}

/**
 * Python name_map_for: every Agent/Task tool_use in the parent transcript →
 * { normPrompt(prompt): { description, subagent_type } }. mtime-cached per file.
 * `statOf` lets a scan share one stat per parent across its agents.
 */
export async function nameMapFor(
  io: ScanIo,
  parentFile: string | null,
  statOf: (path: string) => Promise<FsStat | null> = path => statOrNull(io, path),
): Promise<Map<string, NameInfo>> {
  if (!parentFile) return new Map()
  const st = await statOf(parentFile)
  if (st === null || st.kind !== 'file') return new Map()
  const cached = NAME_CACHE.get(parentFile)
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.map
  const read = await readWhole(io, parentFile, st.size)
  const entry: NameCacheEntry = {
    mtimeMs: st.mtimeMs,
    oversized: read.oversized,
    map: read.text === null ? new Map() : parseNameMap(read.text),
  }
  NAME_CACHE.set(parentFile, entry)
  return entry.map
}

/** Python project_cwd_for's parse: the first non-empty "cwd" within the first 51 lines. */
export function parseProjectCwd(text: string): string {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length && i <= 50; i++) {
    const ln = lines[i] ?? ''
    if (!ln.includes('"cwd"')) continue
    const rec = parseJsonObject(ln)
    if (rec === null) continue
    const c = rec.cwd
    if (typeof c === 'string' && c) return c
  }
  return ''
}

/** Python project_cwd_for: the conversation's real working directory from the parent file's first records ("" unknown). */
export async function projectCwdFor(
  io: ScanIo,
  parentFile: string | null,
  statOf: (path: string) => Promise<FsStat | null> = path => statOrNull(io, path),
): Promise<string> {
  if (!parentFile) return ''
  const st = await statOf(parentFile)
  if (st === null || st.kind !== 'file') return ''
  const cached = PROJECT_CACHE.get(parentFile)
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.cwd
  // The first lines of a session file can be metadata (queue-operation) with no
  // cwd; the working dir appears on the first user/assistant record.
  const read = await readHead(io, parentFile, st.size, 51)
  const entry: ProjectCacheEntry = {
    mtimeMs: st.mtimeMs,
    oversized: read.oversized,
    cwd: read.text === null ? '' : parseProjectCwd(read.text),
  }
  PROJECT_CACHE.set(parentFile, entry)
  return entry.cwd
}

/** Python _first_user_text: the text of a user record (string content, or the first text block). */
function firstUserText(rec: Record<string, unknown>): string {
  const c = asRecord(rec.message).content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    for (const b of c) {
      if (b !== null && typeof b === 'object' && (b as Record<string, unknown>).type === 'text') {
        const t = (b as Record<string, unknown>).text
        return typeof t === 'string' ? t : ''
      }
      if (typeof b === 'string') return b
    }
  }
  return ''
}

/** Python session_summary's parse over the first 81 lines: (topic = first user text, cwd = first cwd). */
export function parseSessionSummary(text: string): { topic: string; cwd: string } {
  let topic = ''
  let cwd = ''
  const lines = text.split('\n')
  for (let i = 0; i < lines.length && i <= 80; i++) {
    const ln = lines[i] ?? ''
    if (!ln.includes('"cwd"') && !ln.includes('"type":"user"')) continue
    const rec = parseJsonObject(ln)
    if (rec === null) continue
    if (!cwd) cwd = typeof rec.cwd === 'string' ? rec.cwd : ''
    if (!topic && rec.type === 'user') topic = normPrompt(firstUserText(rec))
    if (topic && cwd) break
  }
  return { topic, cwd }
}

/** Python session_summary: (topic, cwd) of a top-level conversation — the first user text, shortened. mtime-cached. */
export async function sessionSummary(
  io: ScanIo,
  sessionFile: string,
  stat?: FsStat | null,
): Promise<{ topic: string; cwd: string }> {
  const st = stat === undefined ? await statOrNull(io, sessionFile) : stat
  if (st === null) return { topic: '', cwd: '' }
  const cached = SESSION_CACHE.get(sessionFile)
  if (cached && cached.mtimeMs === st.mtimeMs) return { topic: cached.topic, cwd: cached.cwd }
  const read = await readHead(io, sessionFile, st.size, 81)
  const parsed = read.text === null ? { topic: '', cwd: '' } : parseSessionSummary(read.text)
  SESSION_CACHE.set(sessionFile, { mtimeMs: st.mtimeMs, oversized: read.oversized, ...parsed })
  return parsed
}

// ---------------------------------------------------------------------------
// Open conversations registry (~/.claude/sessions/<pid>.json)
// ---------------------------------------------------------------------------

type SessionRec = { sessionId: string; pid: number | null }
let SESSIONS_CACHE: { sig: string | null; recs: SessionRec[] } = { sig: null, recs: [] }

/**
 * Python live_session_ids: the session ids of OPEN conversations, or null when
 * the registry directory does not exist (older build → nothing is hidden).
 * JSON parsing is cached on the directory's (name, mtime) signature; liveness
 * (`io.pidAlive`, when the hooks module supplies it) is re-checked every scan.
 * Without `pidAlive` a registered record is trusted (Python assumes alive on
 * any uncertainty too).
 */
export async function liveSessionIds(io: ScanIo, home: string, nowSec: number): Promise<Set<string> | null> {
  void nowSec
  const dir = joinPath(home, '.claude', 'sessions')
  let entries: FsEntry[]
  try {
    entries = await io.list(dir)
  } catch {
    return null
  }
  const files = entries
    .filter(e => e.kind === 'file' && e.name.endsWith('.json'))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const sig = files.map(f => `${f.name}@${f.mtimeMs}`).join('|')
  let recs: SessionRec[]
  if (sig === SESSIONS_CACHE.sig) {
    recs = SESSIONS_CACHE.recs
  } else {
    recs = []
    for (const f of files) {
      let rec: Record<string, unknown> | null = null
      try {
        rec = parseJsonObject(await io.read(joinPath(dir, f.name)))
      } catch {
        continue
      }
      if (rec === null) continue
      const sid = rec.sessionId
      if (typeof sid === 'string' && sid) {
        const pid = rec.pid
        recs.push({ sessionId: sid, pid: typeof pid === 'number' && Number.isFinite(pid) ? pid : null })
      }
    }
    SESSIONS_CACHE = { sig, recs }
  }
  const out = new Set<string>()
  for (const r of recs) {
    let alive = true
    if (io.pidAlive && r.pid !== null && r.pid > 0) {
      try {
        alive = await io.pidAlive(r.pid)
      } catch {
        alive = true // any uncertainty → open (never wrongly hide a chat)
      }
    }
    if (alive) out.add(r.sessionId)
  }
  return out
}

// ---------------------------------------------------------------------------
// Personas (Python resolve_personas): distinct within a room, stable across scans
// ---------------------------------------------------------------------------

/** (roomKey, agentId) → slot; re-seated before newcomers so an avatar never flips. */
const PERSONA_ASSIGNED = new Map<string, number>()

function personaKey(roomKey: string, id: string): string {
  return `${roomKey}\u0000${id}`
}

/**
 * Mutates `persona_id`/`emoji` on each agent: group by room (session_full or
 * the agent's own id), re-seat incumbents on their remembered slot, place
 * newcomers by linear probing from personaIndex(id). Module-level memory
 * `(roomKey, id) → slot`, pruned of agents no longer present.
 */
export function resolvePersonas(agents: Agent[]): void {
  const rooms = new Map<string, Agent[]>()
  for (const a of agents) {
    const key = a.session_full || a.id
    const room = rooms.get(key)
    if (room) room.push(a)
    else rooms.set(key, [a])
  }
  const liveKeys = new Set<string>()
  const n = PERSONA_EMOJI.length
  for (const [roomKey, members] of rooms) {
    // newcomers oldest-first (fixed first-event start_ms), lead pinned first
    members.sort((x, y) => {
      const lx = x.is_session ? 0 : 1
      const ly = y.is_session ? 0 : 1
      if (lx !== ly) return lx - ly
      const sx = x.start_ms ?? 0
      const sy = y.start_ms ?? 0
      if (sx !== sy) return sx - sy
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
    })
    const taken = new Set<number>()
    const seated: Array<[Agent, number]> = []
    const newcomers: Agent[] = []
    for (const a of members) {
      const ck = personaKey(roomKey, a.id)
      liveKeys.add(ck)
      const slot = PERSONA_ASSIGNED.get(ck)
      if (slot !== undefined && slot >= 0 && slot < n && !taken.has(slot)) {
        taken.add(slot)
        seated.push([a, slot])
      } else {
        newcomers.push(a)
      }
    }
    for (const a of newcomers) {
      const base = ((a.persona_id ?? 0) % n + n) % n
      let slot = base
      for (let k = 0; k < n; k++) {
        const cand = (base + k) % n
        if (!taken.has(cand)) {
          slot = cand
          break
        }
      }
      taken.add(slot)
      PERSONA_ASSIGNED.set(personaKey(roomKey, a.id), slot)
      seated.push([a, slot])
    }
    for (const [a, slot] of seated) {
      a.persona_id = slot
      a.emoji = PERSONA_EMOJI[slot] ?? PERSONA_EMOJI[0] ?? ''
    }
  }
  // prune seats of agents no longer present so the map cannot grow unbounded
  for (const key of [...PERSONA_ASSIGNED.keys()]) {
    if (!liveKeys.has(key)) PERSONA_ASSIGNED.delete(key)
  }
}

// ---------------------------------------------------------------------------
// Throttled tree listing (Python _throttled_glob)
// ---------------------------------------------------------------------------

/** One file the listing found. */
export type ListedFile = { path: string; mtimeMs: number; size: number }
type Listing = { sessionFiles: ListedFile[]; agentFiles: ListedFile[] }
type ListingCacheEntry = { at: number; listing: Listing }

/** The deepest an agent file sits below ~/.claude/projects (<enc>/<sid>/subagents/workflows/wf_x/agent.jsonl = 5). */
const MAX_WALK_DEPTH = 6

const GLOB_CACHE = new Map<string, ListingCacheEntry>() // projects dir → (timestamp ms, listing)

async function listOrEmpty(io: ScanIo, dir: string): Promise<FsEntry[]> {
  try {
    return await io.list(dir)
  } catch {
    return []
  }
}

/** Every `agent-*.jsonl` at any depth below `dir` (links not followed, depth-bounded). */
async function walkAgentFiles(io: ScanIo, dir: string, depth: number, out: ListedFile[]): Promise<void> {
  if (depth > MAX_WALK_DEPTH) return
  const entries = await listOrEmpty(io, dir)
  const subdirs: string[] = []
  for (const e of entries) {
    if (e.isLink) continue
    if (e.kind === 'file') {
      if (e.name.startsWith('agent-') && e.name.endsWith('.jsonl')) {
        out.push({ path: joinPath(dir, e.name), mtimeMs: e.mtimeMs, size: e.size })
      }
    } else if (e.kind === 'dir') {
      subdirs.push(joinPath(dir, e.name))
    }
  }
  await Promise.all(subdirs.map(d => walkAgentFiles(io, d, depth + 1, out)))
}

/**
 * Python _throttled_glob for both patterns at once:
 *   projects/* /*.jsonl          → sessionFiles (top-level conversations)
 *   projects/** /agent-*.jsonl   → agentFiles
 * Rebuilt at most every GLOB_TTL_SEC; a failing rebuild keeps the previous list.
 * Keyed by the projects dir so a test pointing at another root never reads
 * this root's paths.
 */
export async function throttledListing(io: ScanIo, projectsDir: string, nowMs: number): Promise<Listing> {
  const cached = GLOB_CACHE.get(projectsDir)
  if (cached && nowMs - cached.at < GLOB_TTL_SEC * 1000) return cached.listing
  let listing: Listing
  try {
    const sessionFiles: ListedFile[] = []
    const agentFiles: ListedFile[] = []
    const top = await io.list(projectsDir)
    const projectDirs: string[] = []
    for (const e of top) {
      if (e.isLink) continue
      if (e.kind === 'dir') projectDirs.push(joinPath(projectsDir, e.name))
      else if (e.kind === 'file' && e.name.startsWith('agent-') && e.name.endsWith('.jsonl')) {
        agentFiles.push({ path: joinPath(projectsDir, e.name), mtimeMs: e.mtimeMs, size: e.size })
      }
    }
    await Promise.all(
      projectDirs.map(async pdir => {
        const entries = await listOrEmpty(io, pdir)
        const subdirs: string[] = []
        for (const e of entries) {
          if (e.isLink) continue
          if (e.kind === 'file' && e.name.endsWith('.jsonl')) {
            const f = { path: joinPath(pdir, e.name), mtimeMs: e.mtimeMs, size: e.size }
            sessionFiles.push(f)
            if (e.name.startsWith('agent-')) agentFiles.push(f)
          } else if (e.kind === 'dir') {
            subdirs.push(joinPath(pdir, e.name))
          }
        }
        await Promise.all(subdirs.map(d => walkAgentFiles(io, d, 2, agentFiles)))
      }),
    )
    listing = { sessionFiles, agentFiles }
  } catch {
    listing = cached ? cached.listing : { sessionFiles: [], agentFiles: [] }
  }
  GLOB_CACHE.set(projectsDir, { at: nowMs, listing })
  return listing
}

// ---------------------------------------------------------------------------
// Agent cache (Python _AGENT_CACHE) and the scan itself
// ---------------------------------------------------------------------------

type AgentCacheEntry = {
  mtimeMs: number
  size: number
  /** The parsed agent, before the per-scan `status`/`closed`/`role` overwrite. */
  adict: Agent
  isDone: boolean
  inFlight: boolean
  versions: string[]
  skipped: number
  parent: string | null
}

const AGENT_CACHE = new Map<string, AgentCacheEntry>()

/** Python extract_task: the first event's text. */
function extractTask(first: TranscriptEvent | null): string {
  return first ? first.text : ''
}

/** The age filter of both Python scans: changed within MAX_AGE_MIN. */
function isRecent(nowMs: number, mtimeMs: number): boolean {
  return (nowMs - mtimeMs) / 60000 <= MAX_AGE_MIN
}

/** Python's display sort: (STATUS_ORDER, lead first, newest first). */
export function sortAgents(agents: Agent[]): void {
  agents.sort((x, y) => {
    const ox = STATUS_ORDER[x.status] ?? 3
    const oy = STATUS_ORDER[y.status] ?? 3
    if (ox !== oy) return ox - oy
    const lx = x.is_session ? 0 : 1
    const ly = y.is_session ? 0 : 1
    if (lx !== ly) return lx - ly
    return (y.start_ms ?? 0) - (x.start_ms ?? 0)
  })
}

/** The last payload scanAll produced (returned again, with `error`, when a scan fails unexpectedly). */
let LAST_GOOD: Payload = { ...EMPTY_PAYLOAD }

/** Drops every module-level cache (tests; a hot reload does this by itself). */
export function resetScannerCaches(): void {
  AGENT_CACHE.clear()
  NAME_CACHE.clear()
  PROJECT_CACHE.clear()
  SESSION_CACHE.clear()
  JOURNAL_CACHE.clear()
  GLOB_CACHE.clear()
  PERSONA_ASSIGNED.clear()
  SESSIONS_CACHE = { sig: null, recs: [] }
  LAST_GOOD = { ...EMPTY_PAYLOAD }
}

// ---------------------------------------------------------------------------
// Entry points used by register.tsx
// ---------------------------------------------------------------------------

/** "~": $HOME, else %USERPROFILE%; "" when neither is set (the scan then yields an empty office). */
export async function resolveHome(io: ScanIo): Promise<string> {
  const home = (await io.home()) ?? ''
  return normPath(home)
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
  try {
    const home = await resolveHome(io)
    if (!home) return { ...EMPTY_PAYLOAD, scanned_ms: now, error: 'HOME/USERPROFILE not set' }
    const payload = await scanOffice(io, home, now)
    LAST_GOOD = payload
    return payload
  } catch (err) {
    return { ...LAST_GOOD, scanned_ms: now, error: err instanceof Error ? err.message : String(err) }
  }
}

async function scanOffice(io: ScanIo, home: string, now: number): Promise<Payload> {
  const nowSec = now / 1000
  const projectsDir = joinPath(home, '.claude', 'projects')
  const live = await liveSessionIds(io, home, nowSec) // open conversations; null = registry unsupported
  const listing = await throttledListing(io, projectsDir, now)

  // One stat per parent file per scan (Python stats per call; through `$` each is a round trip).
  const parentStats = new Map<string, Promise<FsStat | null>>()
  const statOf = (path: string): Promise<FsStat | null> => {
    let p = parentStats.get(path)
    if (!p) {
      p = statOrNull(io, path)
      parentStats.set(path, p)
    }
    return p
  }

  const agents: Agent[] = []
  const versions = new Set<string>()
  let skipped = 0
  const oversizedFiles = new Set<string>()
  const seen = new Set<string>()
  const seenParents = new Set<string>()
  const seenJournals = new Set<string>()

  // A file older than MAX_AGE_MIN at listing time is at most GLOB_TTL_SEC
  // stale: if it was touched since, the next listing brings it back. The
  // survivors are re-stat'd every scan (Python stats every glob hit) so the
  // cache key and `status` track the file, not the listing.
  const candidates = listing.agentFiles.filter(f => isRecent(now, f.mtimeMs + GLOB_TTL_SEC * 1000))
  const stats = await Promise.all(candidates.map(f => statOrNull(io, f.path)))

  for (let i = 0; i < candidates.length; i++) {
    const path = candidates[i]!.path
    const st = stats[i]
    if (st === null || st === undefined || st.kind !== 'file') continue
    const mtimeMs = st.mtimeMs
    const size = st.size
    if (!isRecent(now, mtimeMs)) continue
    seen.add(path)

    let entry = AGENT_CACHE.get(path)
    if (entry && entry.mtimeMs === mtimeMs && entry.size === size) {
      // A workflow agent's done-signal lives in the SIBLING journal.jsonl, which
      // is NOT part of the (mtime,size) key: re-read it every scan until done.
      if (!entry.isDone && entry.adict.is_workflow) {
        const w = await workflowJournalResult(io, path, entry.adict.id)
        if (w.isDone) {
          entry.isDone = true
          entry.inFlight = false
          entry.adict.result = w.result
          entry.adict.truncated = w.truncated
          entry.adict.end_ms = w.endMs ?? mtimeMs
        }
      }
    } else {
      // First line: the agent's identity and task. Tail: its current state.
      // One read when the file fits; the optional head/tail closures otherwise.
      const whole = size <= FS_READ_LIMIT ? await readWhole(io, path, size) : null
      const first = whole ?? (await readHead(io, path, size, 1))
      if (first.text === null) {
        if (first.oversized) oversizedFiles.add(path)
        continue
      }
      const firstLine = first.text.split('\n')[0] ?? ''
      if (firstLine.trim() === '') continue // exists but not flushed yet — not malformed
      const firstEv = parseAgentEvent(firstLine)
      if (firstEv === null) {
        skipped += 1
        continue
      }
      const fileVersions = new Set<string>()
      if (firstEv.version) fileVersions.add(firstEv.version)

      const rawId = firstEv.raw.agentId
      const agentId = (typeof rawId === 'string' && rawId) || basename(path).slice(6, -6)
      const rawSession = firstEv.raw.sessionId
      const session = typeof rawSession === 'string' ? rawSession : ''
      const startMs = firstEv.tsMs
      const task = extractTask(firstEv)

      const tail = whole ?? (await readTail(io, path, size))
      let events: TranscriptEvent[] = []
      let fileSkipped = 0
      if (tail.text !== null) {
        const parsed = parseEvents(tailLines(tail.text))
        events = parsed.events
        fileSkipped = parsed.skipped
        for (const v of parsed.versions) fileVersions.add(v)
      } else if (tail.oversized) {
        oversizedFiles.add(path)
        continue
      }

      const workflow = await isWorkflowAgent(io, path)
      const tool = lastToolUseName(events)
      const pid = personaIndex(agentId)
      const parent = parentSessionFile(path, session)
      const project = await projectCwdFor(io, parent, statOf)
      let done: DoneInfo
      let role = ''
      let subagentType = ''
      if (workflow) {
        // Authoritative status/result is the sibling journal.jsonl; only fall
        // back to the transcript when no result is recorded yet.
        done = await workflowJournalResult(io, path, agentId)
        if (!done.isDone) done = detectDone(events)
        if (done.isDone && done.endMs === null) done.endMs = mtimeMs // the journal carries no timestamp
        subagentType = 'workflow-subagent'
      } else {
        done = detectDone(events)
        const info = task.trim() ? (await nameMapFor(io, parent, statOf)).get(normPrompt(task)) : undefined
        role = info?.description ?? ''
        subagentType = info?.subagent_type ?? ''
      }
      // A finished agent is never in_flight (a workflow agent's lingering
      // StructuredOutput tool_use must not read as "working").
      const inFlight = !done.isDone && computeInFlight(events)
      const rawCwd = firstEv.raw.cwd
      const adict: Agent = {
        id: agentId,
        persona_id: pid,
        emoji: PERSONA_EMOJI[pid] ?? '',
        role,
        subagent_type: subagentType,
        status: 'running', // placeholder: recomputed below every scan
        tool,
        phase: computePhase(events),
        task,
        task_short: shortTask(task),
        result: done.result,
        start_ms: startMs,
        end_ms: done.endMs,
        session: session.slice(0, 8),
        session_full: session,
        cwd: typeof rawCwd === 'string' ? rawCwd : '',
        project,
        mtime_ms: mtimeMs,
        is_session: false,
        closed: false,
        is_workflow: workflow,
        truncated: done.truncated,
      }
      entry = { mtimeMs, size, adict, isDone: done.isDone, inFlight, versions: [...fileVersions], skipped: fileSkipped, parent }
      AGENT_CACHE.set(path, entry)
    }

    for (const v of entry.versions) versions.add(v)
    skipped += entry.skipped
    const a: Agent = { ...entry.adict }
    // `closed` BEFORE status: a subagent whose parent chat has closed collapses
    // once idle by RAW mtime (the in_flight override only rescues LIVE agents).
    const closed = live !== null && a.session_full !== '' && !live.has(a.session_full)
    a.closed = closed
    a.status = computeStatus(nowSec, mtimeMs / 1000, entry.isDone, entry.inFlight, closed)
    // role/subagent_type come from the PARENT file, which the agent-keyed cache
    // cannot notice changing: re-resolve every scan (name_map_for is mtime-cached).
    const parent = entry.parent
    if (parent) seenParents.add(parent)
    if (a.is_workflow) seenJournals.add(joinPath(dirname(path), 'journal.jsonl'))
    const normTask = normPrompt(a.task)
    if (normTask && !a.is_workflow && parent) {
      const info = (await nameMapFor(io, parent, statOf)).get(normTask)
      if (info) {
        a.role = info.description
        a.subagent_type = info.subagent_type
      }
    }
    agents.push(a)
  }

  // Evict entries for files that aged out / vanished so the caches cannot grow
  // unbounded over a long-lived session.
  for (const p of [...AGENT_CACHE.keys()]) if (!seen.has(p)) AGENT_CACHE.delete(p)
  for (const p of [...NAME_CACHE.keys()]) if (!seenParents.has(p)) NAME_CACHE.delete(p)
  for (const p of [...PROJECT_CACHE.keys()]) if (!seenParents.has(p)) PROJECT_CACHE.delete(p)
  for (const p of [...JOURNAL_CACHE.keys()]) if (!seenJournals.has(p)) JOURNAL_CACHE.delete(p)

  // Top-level conversations as room leads (Python scan_sessions).
  agents.push(...(await scanSessions(io, listing.sessionFiles, live, now)))

  for (const [p, e] of NAME_CACHE) if (e.oversized) oversizedFiles.add(p)
  for (const [p, e] of PROJECT_CACHE) if (e.oversized) oversizedFiles.add(p)
  for (const [p, e] of SESSION_CACHE) if (e.oversized) oversizedFiles.add(p)
  for (const [p, e] of JOURNAL_CACHE) if (e.oversized) oversizedFiles.add(p)

  resolvePersonas(agents)
  sortAgents(agents)
  return {
    agents,
    versions: [...versions].sort(),
    skipped,
    oversized: oversizedFiles.size,
    scanned_ms: now,
    demo: false,
  }
}

/**
 * Python scan_sessions: every recent top-level conversation as its room's lead.
 * start_ms is the last-activity time so the timer reads as "active/idle";
 * a conversation missing from the registry is a CLOSED chat → done (the room
 * collapses and hides by default) instead of lingering as stale.
 */
async function scanSessions(io: ScanIo, sessionFiles: ListedFile[], live: Set<string> | null, now: number): Promise<Agent[]> {
  const nowSec = now / 1000
  const entries: Agent[] = []
  const candidates = sessionFiles.filter(f => isRecent(now, f.mtimeMs + GLOB_TTL_SEC * 1000))
  const stats = await Promise.all(candidates.map(f => statOrNull(io, f.path)))
  const seenSessions = new Set<string>()
  for (let i = 0; i < candidates.length; i++) {
    const path = candidates[i]!.path
    const st = stats[i]
    if (st === null || st === undefined || st.kind !== 'file') continue
    const mtimeMs = st.mtimeMs
    if (!isRecent(now, mtimeMs)) continue
    seenSessions.add(path)
    const { topic, cwd } = await sessionSummary(io, path, st)
    const uuid = basename(path).slice(0, -6)
    const closed = live !== null && !live.has(uuid)
    // No transcript is parsed for a session, so in_flight is always false.
    // is_done=closed makes a closed chat leave immediately; an open one falls
    // to the mtime rule.
    const status = computeStatus(nowSec, mtimeMs / 1000, closed, false, closed)
    const pid = personaIndex(uuid)
    entries.push({
      id: uuid,
      persona_id: pid,
      emoji: PERSONA_EMOJI[pid] ?? '',
      role: '',
      subagent_type: '',
      status,
      tool: '',
      phase: 'thinking',
      task: topic,
      task_short: shortTask(topic),
      result: null,
      start_ms: mtimeMs,
      end_ms: closed ? mtimeMs : null,
      session: uuid.slice(0, 8),
      session_full: uuid,
      cwd,
      project: cwd,
      mtime_ms: mtimeMs,
      is_session: true,
      closed,
      is_workflow: false,
      truncated: false,
      topic,
    })
  }
  // evict cache entries for session files no longer in the recent window
  for (const p of [...SESSION_CACHE.keys()]) if (!seenSessions.has(p)) SESSION_CACHE.delete(p)
  return entries
}

// ---------------------------------------------------------------------------
// Demo mode (Python demo_payload): a synthetic, populated office. Builds the
// payload in memory and NEVER reads the real ~/.claude/projects journals.
// ---------------------------------------------------------------------------

type DemoOpts = {
  role?: string
  subagent_type?: string
  start_offset?: number
  result?: string | null
  is_session?: boolean
  mtime_offset?: number
}

function demoAgent(
  now: number,
  aid: string,
  session: string,
  cwd: string,
  status: TheaterStatus,
  tool: string,
  task: string,
  opts: DemoOpts = {},
): Agent {
  const pid = personaIndex(aid)
  const startOffset = opts.start_offset ?? 60
  const mtimeOffset = opts.mtime_offset ?? 0
  return {
    id: aid,
    persona_id: pid,
    emoji: PERSONA_EMOJI[pid] ?? '',
    role: opts.role ?? '',
    subagent_type: opts.subagent_type ?? '',
    status,
    tool: tool || '',
    phase: tool ? 'tool' : 'thinking',
    task,
    task_short: shortTask(task),
    result: status === 'done' ? (opts.result ?? null) : null,
    start_ms: Math.trunc(now - startOffset * 1000),
    end_ms: status === 'done' ? Math.trunc(now - 2000) : null,
    session: session.slice(0, 8),
    session_full: session,
    cwd,
    project: cwd,
    mtime_ms: Math.trunc(now - mtimeOffset * 1000),
    is_session: opts.is_session ?? false,
    closed: false,
    is_workflow: false,
    truncated: false,
    ...(opts.is_session ? { topic: task } : {}),
  }
}

/**
 * Python demo_payload: a synthetic, populated office (rooms, personas, one
 * long-running ⏰ agent, one just-finished ⭐ agent, a stale one, an MCP tool).
 * Pure: builds in memory, never reads files. `phase` cycles the scene so the
 * demo animates (Python: phase=None picks by time): a ~12 s loop where phase 3
 * walks a new agent in and phase 6 finishes the finisher (confetti + chime).
 * (The only cast change from Python: the MCP triager started 11 min ago so the
 * ⏰ badge has a demo subject, as the module contract asks.)
 */
export function demoPayload(now: number, phase?: number): Payload {
  const cwd = '/home/dev/acme-web'
  const s1 = 'demo-session-frontend-1111'
  const s2 = 'demo-session-research-2222'
  const ph = Number.isInteger(phase) ? (((phase as number) % 12) + 12) % 12 : Math.trunc(now / 1000) % 12
  const finishing = ph >= 6 && ph < 10
  const walkedIn = ph >= 3
  const agents: Agent[] = [
    demoAgent(now, 'demo-research-aa', s2, cwd, 'running', 'WebSearch',
      'Research incremental static regeneration approaches and summarize the trade-offs.',
      { role: 'research the ISR landscape', subagent_type: 'general-purpose', start_offset: 95 }),
    demoAgent(now, 'demo-reader-bb', s1, cwd, 'running', 'Read',
      'Read the auth middleware and map every place the session token is validated.',
      { role: 'map session-token validation', subagent_type: 'Explore', start_offset: 42 }),
    demoAgent(now, 'demo-grep-cc', s1, cwd, 'running', 'Grep',
      'Find all TODO and FIXME comments across the repo and group them by file.',
      { start_offset: 18 }),
    demoAgent(now, 'demo-mcp-dd', s2, cwd, 'running', 'mcp__github__search_issues',
      "Pull the open issues labeled 'bug' and cluster them by component.",
      { role: 'triage open bugs', subagent_type: 'general-purpose', start_offset: 660 }),
    demoAgent(now, 'demo-build-ee', s1, cwd, 'stale', 'Bash',
      'Run the full test suite and report any failures.', { start_offset: 320 }),
    demoAgent(now, 'demo-writer-ff', s2, cwd, 'done', 'Write',
      'Draft the migration guide for the v2 config format.',
      {
        role: 'draft the v2 migration guide', subagent_type: 'general-purpose', start_offset: 150,
        result: 'Done. Wrote migration-v2.md: a step-by-step guide covering the renamed keys, the '
          + 'deprecation timeline, and a codemod snippet. Flagged two breaking changes for manual review.',
      }),
    demoAgent(now, 'demo-finisher-gg', s1, cwd, finishing ? 'done' : 'running', 'StructuredOutput',
      'Summarize the security review findings into a prioritized list.',
      {
        role: 'summarize the security review', subagent_type: 'code-reviewer', start_offset: 51,
        result: 'Summary: 3 high, 5 medium, 11 low. Top item: the password-reset token is not '
          + 'compared in constant time.',
      }),
  ]
  if (walkedIn) {
    // appears mid-loop so the pane plays its walk-in animation
    agents.push(demoAgent(now, 'demo-newcomer-hh', s2, cwd, 'running', 'Edit',
      'Apply the review fixes to the config loader and re-run the type checker.',
      { role: 'apply the review fixes', subagent_type: 'general-purpose', start_offset: 3 }))
  }
  // the two conversations themselves → each leads its room with the topic as the title
  agents.push(demoAgent(now, 'demo-conv-frontend', s1, cwd, 'running', '',
    'Ship the v2 config migration and clean up the auth middleware.',
    { start_offset: 380, is_session: true, mtime_offset: 7 }))
  agents.push(demoAgent(now, 'demo-conv-research', s2, cwd, 'running', '',
    'Plan the static-regeneration rollout and triage the bug backlog.',
    { start_offset: 300, is_session: true, mtime_offset: 14 }))
  resolvePersonas(agents)
  sortAgents(agents)
  return { agents, versions: ['2.1.0'], skipped: 0, oversized: 0, scanned_ms: now, demo: true }
}

// RESULT_CHAR_LIMIT is applied through clipResult (model.ts); re-exported so
// the UI can mention the limit in the "truncated" note without importing twice.
export { RESULT_CHAR_LIMIT }
