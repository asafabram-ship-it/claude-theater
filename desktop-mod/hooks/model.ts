// Shared model: the payload/agent types (re-exported from the contract), the
// constants ported from claude_theater.py, the $.state atoms every module
// reads, and the few pure helpers both the scanner and the UI need.
//
// Owned by the architect. Builders ADD to this file only when a value is
// needed by two of {scanner, live, ui}; otherwise keep it in your own module.

import type {
  TheaterAgent,
  TheaterLiveAgent,
  TheaterPayload,
  TheaterPhase,
  TheaterPrefs,
  TheaterStatus,
  TheaterView,
} from '../types'

export type {
  TheaterAgent,
  TheaterLiveAgent,
  TheaterPayload,
  TheaterPhase,
  TheaterPrefs,
  TheaterStatus,
  TheaterView,
}

/** Shorter aliases used inside the hooks modules. */
export type Agent = TheaterAgent
export type Payload = TheaterPayload
export type LiveAgent = TheaterLiveAgent
export type Prefs = TheaterPrefs
export type View = TheaterView

// ---------------------------------------------------------------------------
// Constants (claude_theater.py lines 39-58, 266-267, 658) — same values, except the
// two phase-1 cadence constants (GLOB_TTL_SEC, POLL_MS: the scan was slowing the machine).
// ---------------------------------------------------------------------------

/**
 * The plugin's name (plugin.json `name`, the $.state / $.store namespace, the
 * pane id). The spec says "claude-theater", but `claude plugin validate`
 * refuses a third-party name starting with "claude-" (reserved for Anthropic's
 * own), so the mod is `agent-theater` — a change the engine forces.
 */
export const PLUGIN = 'agent-theater' as const
/** The pane's id for $.ui.open / the ui.render matcher. */
export const PANE_ID = 'agent-theater' as const
/** The slash command. */
export const COMMAND = 'theater' as const

/** Only show agents whose file changed in the last N minutes. */
export const MAX_AGE_MIN = 180
/** An at-rest agent untouched this long is shown as idle (`stale`). */
export const RUNNING_STALE_SEC = 90
/** A mid-tool/mid-turn agent silent longer than this is treated as hung and may go idle. */
export const IN_FLIGHT_MAX_SEC = 1200
/** Directory listings are reused this long between scans: 30 s (was the Python _throttled_glob's 6 s). */
export const GLOB_TTL_SEC = 30
/** Stop reasons that mean "the turn continues", never "done". */
export const CONTINUATION_STOP_REASONS: readonly string[] = ['tool_use', 'pause_turn']
/** A result longer than this is cut and `truncated` set. */
export const RESULT_CHAR_LIMIT = 4000
/** Claude Code versions the parser was tested against (major.minor). */
export const KNOWN_CC_VERSIONS: readonly string[] = ['2.1']
/** Tail window read from a transcript, bytes (Python read_tail_lines max_bytes). */
export const TAIL_MAX_BYTES = 200_000
/** Keep at most this many parsed events per transcript (the tail is what status/phase/done read). */
export const MAX_EVENTS = 400
/** `$.fs.read` rejects a file over 4 MiB; the scanner degrades instead of crashing. */
export const FS_READ_LIMIT = 4 * 1024 * 1024
/** The scan period: 5 s (was the extension's 1.5 s); only while the pane is open. */
export const POLL_MS = 5000
/** ⏰ long-running badge threshold. */
export const LONG_RUNNING_MS = 10 * 60 * 1000
/** ⭐ "just finished" window (PAGE line 1583: the `recent` class is removed 10 s after the finish). */
export const JUST_FINISHED_MS = 10 * 1000

/** Display order of statuses. */
export const STATUS_ORDER: Record<TheaterStatus, number> = { running: 0, stale: 1, done: 2 }

/**
 * 48 persona emojis, index-aligned with PERSONAS_EN / PERSONAS_HE in
 * personas.ts. First 16 unchanged so an existing agent keeps its avatar.
 */
export const PERSONA_EMOJI: readonly string[] = [
  '🕵️', '✍️', '🏃', '🔬', '📚', '🧭', '🔭', '🔨',
  '🪄', '🎯', '🦉', '🦊', '🐝', '🤖', '🐯', '🦅',
  '🔧', '🧪', '📐', '🎨', '⚖️', '🩺', '💼', '🔑',
  '🧯', '🧰', '🖋️', '📊', '🧠', '🛡️', '⚙️', '🔩',
  '🕹️', '📡', '🔦', '🗺️', '📷', '🎥', '🎙️', '🔔',
  '🐜', '🐺', '🦫', '🐢', '🦆', '🐬', '🦂', '🦇',
]

// ---------------------------------------------------------------------------
// Pure helpers shared by scanner, live and ui.
// ---------------------------------------------------------------------------

/** Python persona_index: 32-bit Java-style string hash mod the cast size. Stable per id. */
export function personaIndex(agentId: string): number {
  let h = 0
  for (const ch of agentId ?? '') {
    h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) >>> 0
  }
  return h % PERSONA_EMOJI.length
}

/** Python short_task: first sentence (if it ends before char 90) else the first 90 chars + "…". */
export function shortTask(task: string): string {
  const flat = (task ?? '').split(/\s+/).filter(Boolean).join(' ')
  for (const sep of ['. ', '? ', '! ', ': ']) {
    const idx = flat.indexOf(sep)
    if (idx > 0 && idx < 90) return flat.slice(0, idx + 1).trim()
  }
  return flat.length > 90 ? flat.slice(0, 90).trim() + '…' : flat
}

/** `mcp__<server>__<tool>` → `<server>`, else "". */
export function mcpServer(tool: string): string {
  const parts = (tool ?? '').split('__')
  return parts.length >= 3 ? (parts[1] ?? '') : ''
}

/** Python detect_done's result shaping: collapse whitespace and cut to RESULT_CHAR_LIMIT. */
export function clipResult(text: string): { result: string; truncated: boolean } {
  const full = (text ?? '').split(/\s+/).filter(Boolean).join(' ')
  const truncated = full.length > RESULT_CHAR_LIMIT
  return { result: truncated ? full.slice(0, RESULT_CHAR_LIMIT) + '…' : full, truncated }
}

// ---------------------------------------------------------------------------
// $.state values. ENGINE RULE (claude plugin validate): `read`/`update` accept
// only an atom declared as a const IN THE SAME FILE with literal plugin/key,
// so atoms are NOT exported from here. Each module that touches state declares
// its own, e.g.
//   const prefsAtom = atom({ plugin: 'agent-theater', key: 'prefs' } as const, DEFAULT_PREFS)
// using these defaults (the contract's keys: payload, sessionId, prefs, view,
// paneOpened, scanError, tick — see ../types/index.d.ts).
// ---------------------------------------------------------------------------

export const EMPTY_PAYLOAD: TheaterPayload = {
  agents: [],
  versions: [],
  skipped: 0,
  oversized: 0,
  scanned_ms: 0,
  demo: false,
  stars: {},
}

export const DEFAULT_PREFS: TheaterPrefs = { lang: 'he', muted: false, showDone: false, pins: [] }

export const DEFAULT_VIEW: TheaterView = {
  selected: null,
  search: '',
  helpOpen: false,
  demo: false,
  focusIndex: -1,
}

/**
 * Payload field `model` (TheaterAgent.model, see ../types/index.d.ts): the raw
 * model id, "" when unknown. Filled by scanner.ts (transcripts: the latest
 * assistant record's `message.model`) and live.ts (agent.spawn's model wins
 * when non-empty); shortened for display by i18n.ts `modelLabel()`.
 */
export const UNKNOWN_MODEL = '' as const

/** $.store keys (prefs mirror). */
export const STORE_PREFS_KEY = 'prefs'
