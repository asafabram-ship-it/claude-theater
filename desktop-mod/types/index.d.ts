// Claude Theater — the mod's contract: every value it keeps in `$.state`
// (under the plugin name 'agent-theater') and the shapes those values carry.
//
// Self-contained on purpose (no import, no reference): the engine copies this
// file beside any plugin that lists 'agent-theater' under `dependencies`.
// hooks/model.ts re-exports these types for the hooks modules, so this file
// is the one place the shapes are written.
//
// The agent payload keeps the VS Code extension's JSON keys verbatim
// (snake_case) so the port of the Python scanner and of PAGE's JS stays a
// line-by-line translation.

/** `running` = working now · `stale` = at rest past RUNNING_STALE_SEC · `done` = finished (or its chat closed and it is idle). */
export type TheaterStatus = 'running' | 'stale' | 'done'

/** What the agent does RIGHT NOW: a tool is pending (`tool`) or the model reasons / streams (`thinking`). */
export type TheaterPhase = 'tool' | 'thinking'

/**
 * One agent (or one top-level conversation acting as the room lead) as the
 * office draws it. Exactly the keys the Python server emitted.
 */
export type TheaterAgent = {
  /** The agent id (uuid from the file name, the engine's agentId, or the session id for a lead). */
  id: string
  /** Index into the 48-persona cast, after resolvePersonas made it distinct within its room. */
  persona_id: number
  /** PERSONA_EMOJI[persona_id]. */
  emoji: string
  /** The Agent/Task call's short `description` ("" when unknown). */
  role: string
  /** The Agent/Task call's `subagent_type`, "workflow-subagent" for a journal-driven agent, "" when unknown. */
  subagent_type: string
  status: TheaterStatus
  /** Last tool dispatched ("" when none); `mcp__<server>__<tool>` for an MCP tool. */
  tool: string
  phase: TheaterPhase
  /** The full task (first user message / Agent prompt). */
  task: string
  /** First sentence of `task`, at most ~90 chars. */
  task_short: string
  /** Final text, collapsed whitespace, cut to RESULT_CHAR_LIMIT; null while running. */
  result: string | null
  /** First event's timestamp (ms since epoch); null when unreadable. */
  start_ms: number | null
  /** Finish timestamp (ms); null while running. */
  end_ms: number | null
  /** session_full.slice(0, 8). */
  session: string
  /** The owning conversation's session id ("" when sessionless). */
  session_full: string
  /** cwd recorded on the first event ("" when absent). */
  cwd: string
  /** The conversation's real working directory (from the parent session file), "" when unknown. */
  project: string
  /** The transcript file's mtime (ms); for a live agent, the time of its last event. */
  mtime_ms: number
  /** True for the room lead (the top-level conversation itself). */
  is_session: boolean
  /** True when the owning conversation is no longer open (~/.claude/sessions registry). */
  closed: boolean
  /** True for a workflow (journal.jsonl) agent. */
  is_workflow: boolean
  /** True when `result` was cut to RESULT_CHAR_LIMIT. */
  truncated: boolean
  /**
   * Mod-only (not in the Python payload): the model id the agent runs on
   * ("claude-opus-5-5", "claude-haiku-4-5-20251001", ...), from the latest
   * assistant record's `message.model` in its transcript — or, for a live
   * agent of this session, from agent.spawn. "" when unknown. The UI shortens
   * it with i18n modelLabel().
   */
  model: string
  /**
   * Mod-only (not in the Python payload): the room's topic, filled on the
   * lead by session_summary(); absent on subagents.
   */
  topic?: string
  /**
   * Mod-only: true when the engine's events say this session's subagent
   * failed or was killed (live.ts merges it in, so the pane never reads the
   * live map itself — a tool.call of a live agent must not redraw the office).
   * Absent otherwise.
   */
  failed?: boolean
}

/** What one scan of ~/.claude produces: the office. Replaces the server's JSON reply. */
export type TheaterPayload = {
  /** Sorted: running, stale, done; the lead first within a status; newest first. */
  agents: TheaterAgent[]
  /** Distinct Claude Code versions seen in the transcripts (major.minor.patch strings). */
  versions: string[]
  /** Malformed transcript lines skipped during the scan. */
  skipped: number
  /** Number of transcript files skipped because they exceed FS_READ_LIMIT (see "Files over 4 MiB" in the plan). */
  oversized: number
  /** When this payload was computed (ms since epoch). */
  scanned_ms: number
  /** True when the payload is the synthetic demo office, never the real files. */
  demo: boolean
  /**
   * The ⭐ stars: agent id → when the office first saw it finish (the poll's
   * clock, ms), kept while inside the JUST_FINISHED window and pruned by the
   * poll. Stamped by register.tsx (ui.tsx starsOf) on the way to $.state — the
   * scanner and the demo emit `{}` — so a finish costs the one write the
   * publish makes (no deferred `view` write); the pane only draws them.
   */
  stars: Record<string, number>
}

/**
 * One subagent of the CURRENT session as the engine's own events describe it
 * (agent.spawn / tool.call / $.agent.list). Merged OVER the scanner's data by
 * live.ts, so the current conversation never waits for a file to flush.
 */
export type TheaterLiveAgent = {
  /** The engine's agentId (same string the transcript file is named by). */
  id: string
  description: string
  subagent_type: string
  model: string
  /** The Agent tool's prompt. */
  task: string
  /** `running`, `completed`, `failed`, `killed` as $.agent.list says; `running` until it is listed otherwise. */
  engine_status: string
  phase: TheaterPhase
  tool: string
  start_ms: number
  /** Time of the last event seen for it (spawn, tool.call in/out, status change). */
  last_ms: number
  end_ms: number | null
  /** The Agent tool call's result text, cut to RESULT_CHAR_LIMIT; null until the call returns. */
  result: string | null
  truncated: boolean
  /** The spawning Agent tool_use_id. */
  tool_use_id: string
}

/** UI preferences, mirrored in $.store under the same keys so they outlive the session. */
export type TheaterPrefs = {
  /** Default 'he' (RTL). */
  lang: 'he' | 'en'
  /** Finish chime muted. */
  muted: boolean
  /** Show finished agents. */
  showDone: boolean
  /** Pinned rooms (session_full ids), drawn first. */
  pins: string[]
  /** DESKTOP: draw the rooms as still images instead of animated frames (a redraw — a scroll — then does not blink). */
  still?: boolean
}

/** Transient UI state (not persisted). */
export type TheaterView = {
  /** Agent id whose details drawer is open; null when closed. */
  selected: string | null
  /** The search box text. */
  search: string
  /** Keyboard-shortcut help overlay open. */
  helpOpen: boolean
  /** Demo mode on (demoPayload instead of the scan). */
  demo: boolean
  /** Index of the keyboard-focused card, for the arrow-key walk; -1 when none. */
  focusIndex: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-theater': {
      /** The last scan, as the office draws it (after the live merge, the ⭐ stars stamped). */
      payload: TheaterPayload
      /** This session's id ("" until known), so live agents land in the right room. */
      sessionId: string
      prefs: TheaterPrefs
      view: TheaterView
      /** True once the pane was opened (auto-open happens only once per session). */
      paneOpened: boolean
      /** The last scan error's message, drawn dim in the footer; null when the scan is healthy. */
      scanError: string | null
      /**
       * The poll's clock (ms), written every tick while the pane is up. Read
       * ONLY by the text surfaces' pane (their mm:ss timers tick with it); the
       * desktop never reads it, so a tick redraws no room SVG (no frame reload).
       */
      tick: number
    }
  }
}
