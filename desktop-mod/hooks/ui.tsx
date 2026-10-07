// UI: draws the 🎭 pane (the office) from $.state and handles its presses /
// typing. The port of PAGE's JS (claude_theater.py) over the engine's
// elements (Box/Text/Button/Input, plus the `confetti.tsx` Client surface
// module for the finish burst on the surfaces that have a frame clock).
//
// OWNER: builder "ui". Contract (register.tsx calls these):
//   registerUi(on)         adds the ui.render hook for the pane; the finish beat
//                          (⭐ + chime + toast) runs inside it, see below
//   paneTitle(lang)        the pane's title for $.ui.open
//
// What it draws (spec "עובר כמו שהוא"), top to bottom:
//   header   title · "🟢 N working · ⏳ M idle · ✅ K finished" (PAGE #counts)
//   toolbar  [f] show finished · [m] 🔔/🔕 · [l] language · [h] help · [d] demo
//            (+ the demo chip with its exit) · [s] jumps to the search box
//   search   an Input (not on mobile, which has none)
//   help     the keyboard-shortcuts popover (PAGE renderHelp) while open
//   drawer   the selected agent (PAGE fillDrawer): chips (status, subagent_type,
//            duration/elapsed, tool), activity, task, result, "result shortened"
//   rooms    one per conversation (session_full): pinned first 📌, then rooms with
//            a running agent, then by last activity (PAGE's sort). Room header:
//            📌 · 💬 topic-or-project · small label/sid · 🟢N · ⏳N · ✅N (toggles
//            that room's "show finished"). Cards in a grid sized to bodyColumns:
//            emoji + persona name (a plain Button: Enter/click opens the drawer),
//            ⏰ ≥ LONG_RUNNING_MS, ⭐ within JUST_FINISHED_MS, ❌ failed/killed
//            (from the live map), role / subagent_type, activityLabel, mm:ss.
//   nav      [k] previous · [j] next · [o] open · [x] close — the arrow-key walk
//   empty    office (with "▶ watch a demo") / no-active / none-in-window / no-match
//   footer   oversized transcripts, scanError, dim
//
// Rules:
// - A render hook never writes state; presses/inputs write with update($, ...)
//   from Button/Input closures declared in this file (so `$` never crosses an
//   import — validate rule).
// - Read state with read($, atom) so the pane redraws on every $.state.set;
//   atoms are declared in THIS file (validate rule), never imported.
// - Draw with the table of e.surface: `$.ui.resolve(e)`. Width is
//   e.props.bodyColumns (narrower than the viewport when docked).
// - Hebrew default; `dirOf(prefs.lang)` decides the row direction (RTL = row-reverse).
// - Every hook is registered with `.catch(($, e, next) => next(e))`.
//
// The finish beat (PAGE updateWS: prevStatus running→done on a VISIBLE card →
// confetti + ding + toast + ⭐) runs INSIDE the render hook, exactly where PAGE
// ran it (on every payload the open page received): the poll's $.state.set of
// `payload` redraws the pane, and the render compares the statuses it remembers
// with the office it draws — once per scan (scanned_ms), so a redraw caused by
// a press never replays it. ENGINE FACTS (probed, 2.1.288): a plugin's hooks
// never see its own $.state.set (so a `state.set{payload}` hook of ours would
// be dead), a render may toast and play audio, a render may NOT write state,
// and a `$.clock.after(0, …)` scheduled from the render may. So the beat
// toasts "<name> — finished" and plays sounds/done.wav (unless muted) at once,
// draws the ⭐ + confetti from module memory in the same frame, and commits
// view.justFinished / the selected-agent reset / the pins + roomDone pruning
// through $.clock.after(0). As in PAGE the beat fires only for an agent the
// office shows (its room shows finished, it matches the search, its chat is
// open) and only while the pane is drawn — which is why demo mode forces
// "show finished" on without persisting it.
//
// Demo mode (PAGE ?demo=1): `view.demo` → the pane draws demoOffice(now), the
// port of Python demo_payload: a 12 s scripted loop (phase 3: a newcomer walks
// in, phases 6-9: the finisher completes → the beat). The poll keeps writing
// `payload` every POLL_MS, so the office redraws and the clock advances.
//
// Per-room "show finished" overrides (PAGE roomDone, tri-state): kept in
// $.store under 'roomDone' (the prefs contract has only the global flag) and
// cached in this module; a room that comes to match the global toggle drops
// its override. Pins live in prefs.pins.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, UiPressArgument } from 'claude-code'

import { I18N, activityLabel, dirOf, type Lang, type Strings } from './i18n'
import {
  DEFAULT_PREFS, DEFAULT_VIEW, EMPTY_PAYLOAD, JUST_FINISHED_MS, LONG_RUNNING_MS, PANE_ID, PERSONA_EMOJI,
  STATUS_ORDER, STORE_PREFS_KEY, personaIndex, shortTask,
} from './model'
import type { Agent, LiveAgent, Payload, Prefs, View } from './model'
import { assignDistinctPersonas, personaName } from './personas'

// $.state atoms (validate: declared as consts in the file that reads them;
// the same keys register.tsx writes — see ../types/index.d.ts).
const payloadAtom = atom({ plugin: 'agent-theater', key: 'payload' } as const, EMPTY_PAYLOAD)
const prefsAtom = atom({ plugin: 'agent-theater', key: 'prefs' } as const, DEFAULT_PREFS)
const viewAtom = atom({ plugin: 'agent-theater', key: 'view' } as const, DEFAULT_VIEW)
const scanErrorAtom = atom({ plugin: 'agent-theater', key: 'scanError' } as const, null)
const liveAtom = atom({ plugin: 'agent-theater', key: 'live' } as const, {} as Record<string, LiveAgent>)

/** $.store key of the per-room "show finished" overrides (PAGE ct_roomDone). */
export const STORE_ROOM_DONE_KEY = 'roomDone'
/** Card width in cells (border included). */
export const CARD_W = 26
/** PAGE ding(): two chimes within this many ms are one (storm guard). */
const DING_GAP_MS = 400
/** The finish chime, the plugin's own file. */
const DING_ASSET = 'sounds/done.wav'
/** PAGE confetti(): the burst is removed after this many ms (the ⭐ outlives it, JUST_FINISHED_MS). */
const BURST_MS = 1050

/** The pane title shown in the tab. */
export function paneTitle(lang: Lang): string {
  return lang === 'he' ? '🎭 התיאטרון' : '🎭 Theater'
}

// ---------------------------------------------------------------------------
// Pure ports of PAGE's helpers (exported for ui.test.ts).
// ---------------------------------------------------------------------------

/** PAGE fmt(): mm:ss, "--:--" for null/negative. */
export function fmt(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0 || !Number.isFinite(ms)) return '--:--'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const x = s % 60
  return `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
}

/** PAGE baseName(): the last path segment, "—" when empty. */
export function baseName(p: string | null | undefined): string {
  return (p ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '—'
}

/** PAGE roomLabel(): the conversation's project, not a nested subagent cwd. */
export function roomLabel(a: Pick<Agent, 'project' | 'cwd'>): string {
  return baseName(a.project || a.cwd)
}

/**
 * PAGE tickTimers() (cards) and fillDrawer() (drawer): what the clock shows.
 * lead → time since last activity; unknown start → null ("--:--"); done →
 * final duration (the drawer falls back to last activity / now when end_ms is
 * null); stale → frozen at last activity; running → live.
 */
export function agentElapsed(a: Agent, now: number, forDrawer = false): number | null {
  const s = a.start_ms ?? 0
  const en = a.end_ms ?? 0
  const mt = a.mtime_ms ?? 0
  if (a.is_session) return mt ? now - mt : null
  if (!s) return null
  if (a.status === 'done') return forDrawer ? (en || mt || now) - s : en ? en - s : null
  if (a.status === 'stale') return mt && mt > s ? mt - s : null
  return now - s
}

/** PAGE longrun: a live (non-lead) agent running over LONG_RUNNING_MS. */
export function isLongRunning(a: Agent, now: number): boolean {
  if (a.status !== 'running' || a.is_session) return false
  const v = agentElapsed(a, now)
  return v !== null && v > LONG_RUNNING_MS
}

/** PAGE matchesSearch(): role, task, tool, persona name (in `lang`), room label. */
export function matchesSearch(a: Agent, q: string, lang: Lang): boolean {
  const needle = q.toLowerCase()
  return (
    (a.role ?? '').toLowerCase().includes(needle) ||
    (a.task ?? '').toLowerCase().includes(needle) ||
    (a.tool ?? '').toLowerCase().includes(needle) ||
    personaName(a.persona_id, lang).toLowerCase().includes(needle) ||
    roomLabel(a).toLowerCase().includes(needle)
  )
}

/** PAGE render(): per-session stats from ALL agents (so a room shows ✅N even when its finished are hidden). */
export type RoomStat = { running: number; stale: number; done: number; label: string; topic: string; sid: string; mtime: number }

export function roomStats(all: readonly Agent[]): Map<string, RoomStat> {
  const stat = new Map<string, RoomStat>()
  for (const a of all) {
    let v = stat.get(a.session_full)
    if (!v) {
      v = { running: 0, stale: 0, done: 0, label: roomLabel(a), topic: '', sid: a.session, mtime: 0 }
      stat.set(a.session_full, v)
    }
    if (a.status === 'running') v.running++
    else if (a.status === 'stale') v.stale++
    else if (a.status === 'done') v.done++
    v.mtime = Math.max(v.mtime, a.mtime_ms ?? 0)
    if (a.is_session && (a.topic || a.task_short)) v.topic = a.topic || a.task_short
    if (!v.label || v.label === '—') v.label = roomLabel(a)
  }
  return stat
}

/** PAGE roomShowsDone(): the room's override, else the global toggle. */
export function roomShowsDone(roomDone: Readonly<Record<string, boolean>>, showDone: boolean, sess: string): boolean {
  return sess in roomDone ? !!roomDone[sess] : showDone
}

/** PAGE toggleRoomDone(): tri-state — an override equal to the global toggle is dropped. */
export function toggledRoomDone(roomDone: Readonly<Record<string, boolean>>, showDone: boolean, sess: string): Record<string, boolean> {
  const nv = !roomShowsDone(roomDone, showDone, sess)
  const out: Record<string, boolean> = { ...roomDone }
  if (nv === showDone) delete out[sess]
  else out[sess] = nv
  return out
}

export type OfficeView = {
  /** Agents the office draws, in payload order (room grouping happens at draw). */
  visible: Agent[]
  /** Room ids in display order. */
  rooms: string[]
  stat: Map<string, RoomStat>
  /** Cards in display order (room by room), the arrow-key walk's list. */
  order: Agent[]
}

/**
 * PAGE render()'s filtering and ordering: search → drop closed chats and the
 * finished the room hides → rooms sorted pinned, then with-running, then by
 * last activity (newest first).
 */
export function officeView(
  all: readonly Agent[],
  q: string,
  lang: Lang,
  showDone: boolean,
  roomDone: Readonly<Record<string, boolean>>,
  pins: readonly string[],
): OfficeView {
  const stat = roomStats(all)
  const needle = q.toLowerCase().trim()
  const searched = needle ? all.filter(a => matchesSearch(a, needle, lang)) : [...all]
  const visible = searched.filter(a => !a.closed && (a.status !== 'done' || roomShowsDone(roomDone, showDone, a.session_full)))
  const rooms = [...new Set(visible.map(a => a.session_full))]
  const pinned = new Set(pins)
  rooms.sort((x, y) => {
    const sx = stat.get(x)
    const sy = stat.get(y)
    return (
      (pinned.has(y) ? 1 : 0) - (pinned.has(x) ? 1 : 0) ||
      ((sy?.running ?? 0) > 0 ? 1 : 0) - ((sx?.running ?? 0) > 0 ? 1 : 0) ||
      (sy?.mtime ?? 0) - (sx?.mtime ?? 0)
    )
  })
  const order: Agent[] = []
  for (const s of rooms) for (const a of visible) if (a.session_full === s) order.push(a)
  return { visible, rooms, stat, order }
}

/** PAGE emptyHTML kind: office (nothing at all) | nomatch | nonewindow | noactive. */
export function emptyKind(q: string, total: number, showDone: boolean): 'office' | 'nomatch' | 'nonewindow' | 'noactive' {
  if (q.trim()) return 'nomatch'
  if (total === 0) return 'office'
  return showDone ? 'nonewindow' : 'noactive'
}

/** PAGE #counts: open-chat agents by status. */
export function headerCounts(all: readonly Agent[]): { run: number; idle: number; done: number } {
  const open = all.filter(a => !a.closed)
  return {
    run: open.filter(a => a.status === 'running').length,
    idle: open.filter(a => a.status === 'stale').length,
    done: open.filter(a => a.status === 'done').length,
  }
}

/**
 * PAGE updateWS's finish test over a whole payload: agents the office shows
 * whose remembered status was not done and is done now. `prev` is updated for
 * EVERY agent of the payload (hidden ones too, so a later toggle cannot replay
 * a stale running→done) and pruned to the payload's ids.
 */
export function detectFinishes(prev: Record<string, Agent['status']>, all: readonly Agent[], shown: ReadonlySet<string>): Agent[] {
  const finished: Agent[] = []
  for (const a of all) {
    const before = prev[a.id]
    if (shown.has(a.id) && before !== undefined && before !== 'done' && a.status === 'done') finished.push(a)
    prev[a.id] = a.status
  }
  const live = new Set(all.map(a => a.id))
  for (const id of Object.keys(prev)) if (!live.has(id)) delete prev[id]
  return finished
}

/** The ⭐ window: entries older than JUST_FINISHED_MS are dropped. */
export function pruneJustFinished(justFinished: Readonly<Record<string, number>>, now: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, t] of Object.entries(justFinished)) if (now - t < JUST_FINISHED_MS) out[id] = t
  return out
}

/** The card's name: the Agent call's description, else the persona. */
export function cardName(a: Agent, lang: Lang): string {
  return a.role || personaName(a.persona_id, lang)
}

// ---------------------------------------------------------------------------
// Demo office: the port of Python demo_payload / _demo_agent.
// ---------------------------------------------------------------------------

function demoAgent(
  now: number,
  aid: string,
  session: string,
  cwd: string,
  status: Agent['status'],
  tool: string,
  task: string,
  opts: { role?: string; subagent_type?: string; start_offset?: number; result?: string; is_session?: boolean; mtime_offset?: number } = {},
): Agent {
  const pid = personaIndex(aid)
  const startOffset = opts.start_offset ?? 60
  return {
    id: aid,
    persona_id: pid,
    emoji: PERSONA_EMOJI[pid] ?? '🤖',
    role: opts.role ?? '',
    subagent_type: opts.subagent_type ?? '',
    status,
    tool: tool || '',
    phase: tool ? 'tool' : 'thinking',
    task,
    task_short: shortTask(task),
    result: status === 'done' ? (opts.result ?? null) : null,
    start_ms: Math.floor(now - startOffset * 1000),
    end_ms: status === 'done' ? Math.floor(now - 2000) : null,
    session: session.slice(0, 8),
    session_full: session,
    cwd,
    project: cwd,
    mtime_ms: Math.floor(now - (opts.mtime_offset ?? 0) * 1000),
    is_session: opts.is_session ?? false,
    closed: false,
    is_workflow: false,
    truncated: false,
  }
}

/**
 * Python demo_payload(phase): a ~12 s scripted loop — phase 3 a newcomer walks
 * in, phases 6-9 the finisher completes (confetti + chime). `int(now) % 12`
 * drives both unless `phase` is given.
 */
export function demoOffice(now: number, phase?: number): Payload {
  const cwd = '/home/dev/acme-web'
  const s1 = 'demo-session-frontend-1111'
  const s2 = 'demo-session-research-2222'
  const ph = typeof phase === 'number' ? ((phase % 12) + 12) % 12 : Math.floor(now / 1000) % 12
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
      'Find all TODO and FIXME comments across the repo and group them by file.', { start_offset: 18 }),
    demoAgent(now, 'demo-mcp-dd', s2, cwd, 'running', 'mcp__github__search_issues',
      "Pull the open issues labeled 'bug' and cluster them by component.",
      { role: 'triage open bugs', subagent_type: 'general-purpose', start_offset: 63 }),
    demoAgent(now, 'demo-build-ee', s1, cwd, 'stale', 'Bash',
      'Run the full test suite and report any failures.', { start_offset: 320 }),
    demoAgent(now, 'demo-writer-ff', s2, cwd, 'done', 'Write',
      'Draft the migration guide for the v2 config format.',
      { role: 'draft the v2 migration guide', subagent_type: 'general-purpose', start_offset: 150,
        result: 'Done. Wrote migration-v2.md: a step-by-step guide covering the renamed keys, the deprecation timeline, and a codemod snippet. Flagged two breaking changes for manual review.' }),
    demoAgent(now, 'demo-finisher-gg', s1, cwd, finishing ? 'done' : 'running', 'StructuredOutput',
      'Summarize the security review findings into a prioritized list.',
      { role: 'summarize the security review', subagent_type: 'code-reviewer', start_offset: 51,
        result: 'Summary: 3 high, 5 medium, 11 low. Top item: the password-reset token is not compared in constant time.' }),
    // the long-running ⏰ agent of the plan's demo (the extension's office had none this old)
    demoAgent(now, 'demo-longrun-ii', s2, cwd, 'running', 'Bash',
      'Run the nightly benchmark matrix across all targets and collect the numbers.',
      { role: 'run the benchmark matrix', subagent_type: 'general-purpose', start_offset: 11 * 60 }),
  ]
  if (walkedIn) {
    agents.push(demoAgent(now, 'demo-newcomer-hh', s2, cwd, 'running', 'Edit',
      'Apply the review fixes to the config loader and re-run the type checker.',
      { role: 'apply the review fixes', subagent_type: 'general-purpose', start_offset: 3 }))
  }
  // the two conversations themselves → each leads its room with the topic as the title
  agents.push(demoAgent(now, 'demo-conv-frontend', s1, cwd, 'running', '',
    'Ship the v2 config migration and clean up the auth middleware.', { start_offset: 380, is_session: true, mtime_offset: 7 }))
  agents.push(demoAgent(now, 'demo-conv-research', s2, cwd, 'running', '',
    'Plan the static-regeneration rollout and triage the bug backlog.', { start_offset: 300, is_session: true, mtime_offset: 14 }))
  assignDistinctPersonas(agents)
  agents.sort((x, y) =>
    (STATUS_ORDER[x.status] ?? 3) - (STATUS_ORDER[y.status] ?? 3) ||
    (y.is_session ? 1 : 0) - (x.is_session ? 1 : 0) ||
    (y.start_ms ?? 0) - (x.start_ms ?? 0))
  return { agents, versions: ['2.1.0'], skipped: 0, oversized: 0, scanned_ms: now, demo: true }
}

/** The office the pane draws: the demo while `view.demo`, else the scanned payload. */
export function effectivePayload(payload: Payload, view: Pick<View, 'demo'>, now: number): Payload {
  return view.demo ? demoOffice(now) : payload
}

// ---------------------------------------------------------------------------
// Module memory (not drawn from; a hot reload only loses a beat, as PAGE's reload does).
// ---------------------------------------------------------------------------

/** PAGE prevStatus: agent id → last status seen, for the finish beat. */
const prevStatus: Record<string, Agent['status']> = {}
/** The ⭐ window as the render draws it (agent id → when it finished); mirrored to view.justFinished. */
let justFinished: Record<string, number> = {}
/** The scan the beat last ran on (`demo:`/`scan:` + scanned_ms): once per payload, never per redraw. */
let lastBeatKey = ''
/** PAGE roomDone, cached from $.store ('roomDone'); null until first read. */
let roomDoneCache: Record<string, boolean> | null = null
/** PAGE lastDing: the storm guard. */
let lastDing = 0

async function loadRoomDone($: EngineInterface): Promise<Record<string, boolean>> {
  if (roomDoneCache !== null) return roomDoneCache
  try {
    const stored = await $.store.get(STORE_ROOM_DONE_KEY)
    const out: Record<string, boolean> = {}
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      for (const [k, v] of Object.entries(stored as Record<string, unknown>)) if (typeof v === 'boolean') out[k] = v
    }
    roomDoneCache = out
  } catch {
    roomDoneCache = {}
  }
  return roomDoneCache
}

async function saveRoomDone($: EngineInterface, value: Record<string, boolean>): Promise<void> {
  roomDoneCache = value
  await $.store.set(STORE_ROOM_DONE_KEY, value).catch(() => undefined)
}

/** Writes prefs through the atom and mirrors them to $.store (they outlive the session). */
async function savePrefs($: EngineInterface, fn: (p: Prefs) => Prefs): Promise<Prefs> {
  const saved = await update($, prefsAtom, fn)
  await $.store.set(STORE_PREFS_KEY, saved).catch(() => undefined)
  return saved
}

/** PAGE setLang(): prefs + the pane's title. */
async function setLang($: EngineInterface, lang: Lang): Promise<void> {
  await savePrefs($, p => ({ ...p, lang }))
  await $.ui.open({ id: PANE_ID, title: paneTitle(lang) }).catch(() => undefined)
}

/** PAGE setDemo(): toggles the demo; "show finished" is forced on by effect, never persisted. */
async function setDemo($: EngineInterface, on: boolean): Promise<void> {
  await update($, viewAtom, v => ({ ...v, demo: on, selected: null, focusIndex: -1 }))
}

/** PAGE ding(): the finish chime, unless muted; two within DING_GAP_MS are one. */
async function ding($: EngineInterface, muted: boolean, now: number): Promise<void> {
  if (muted) return
  if (now - lastDing < DING_GAP_MS) return
  lastDing = now
  await $.audio.play({ asset: DING_ASSET }).catch(() => undefined)
}

/**
 * PAGE updateWS over a whole payload, run from the render hook once per scan:
 * remembers statuses, celebrates the shown agents that just finished (toast +
 * chime now, ⭐ + confetti from `justFinished`), and commits what needs a
 * state write (view.justFinished, a vanished selection, pruned pins / room
 * overrides) through $.clock.after(0) — a render may not write.
 * Returns the ⭐ map to draw from. Never throws (the beat is decoration).
 */
function finishBeat(
  $: EngineInterface,
  office: Payload,
  prefs: Prefs,
  view: View,
  roomDone: Readonly<Record<string, boolean>>,
  now: number,
): Record<string, number> {
  try {
    const key = `${office.demo ? 'demo' : 'scan'}:${office.scanned_ms}`
    // a hot reload emptied the module's map: the stored view still has the stars
    const stars = pruneJustFinished({ ...view.justFinished, ...justFinished }, now)
    if (key === lastBeatKey) {
      justFinished = stars
      return stars
    }
    lastBeatKey = key
    const showDone = view.demo || prefs.showDone
    const seen = officeView(office.agents, view.search, prefs.lang, showDone, roomDone, prefs.pins)
    const shown = new Set(seen.visible.map(a => a.id))
    const finished = detectFinishes(prevStatus, office.agents, shown)
    for (const a of finished) stars[a.id] = now
    justFinished = stars
    if (finished.length > 0) {
      const L = I18N[prefs.lang]
      for (const a of finished) $.ui.toast(`${cardName(a, prefs.lang)} — ${L.finishedToast}`)
      void ding($, prefs.muted, now)
    }
    const liveIds = new Set(office.agents.map(a => a.id))
    const liveRooms = new Set(office.agents.map(a => a.session_full))
    const selectedGone = view.selected !== null && !liveIds.has(view.selected)
    const starsChanged =
      Object.keys(stars).length !== Object.keys(view.justFinished).length ||
      Object.keys(stars).some(id => view.justFinished[id] !== stars[id])
    // PAGE: prune per-room overrides + pins for conversations no longer present
    // (only against a real, non-empty office: an empty scan must not wipe them).
    const pruneRooms = office.agents.length > 0 && !office.demo
    const staleRoomDone = pruneRooms && Object.keys(roomDone).some(s => !liveRooms.has(s))
    const stalePins = pruneRooms && prefs.pins.some(s => !liveRooms.has(s))
    if (selectedGone || starsChanged || staleRoomDone || stalePins) {
      const committed = { ...stars }
      $.clock.after(0, async () => {
        try {
          if (selectedGone || starsChanged) {
            await update($, viewAtom, v => ({ ...v, justFinished: committed, selected: selectedGone ? null : v.selected }))
          }
          if (staleRoomDone) {
            const kept: Record<string, boolean> = {}
            for (const [s, v] of Object.entries(roomDone)) if (liveRooms.has(s)) kept[s] = v
            await saveRoomDone($, kept)
          }
          if (stalePins) await savePrefs($, p => ({ ...p, pins: p.pins.filter(s => liveRooms.has(s)) }))
        } catch {
          // decoration only
        }
      })
    }
    return stars
  } catch {
    return justFinished
  }
}

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

/** Adds the pane's render hook (the beat runs inside it). Called once from register(). */
export function registerUi(on: On): void {
  on('ui.render', { component: 'Pane', requestId: 'agent-theater' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const prefs = await read($, prefsAtom)
    const payload = await read($, payloadAtom)
    const view = await read($, viewAtom)
    const scanError = await read($, scanErrorAtom)
    const live = await read($, liveAtom)
    const roomDone = await loadRoomDone($)
    // the clock is the engine's; a host without one (a bare test) falls back to the module's
    const now = await $.clock.now().catch(() => Date.now())
    const lang = prefs.lang
    const L: Strings = I18N[lang]
    const rtl = dirOf(lang) === 'rtl'
    const row = rtl ? 'row-reverse' : 'row'
    const width = Math.max(20, e.props.bodyColumns || 80)
    const office = effectivePayload(payload, view, now)
    const all = office.agents
    const showDone = view.demo || prefs.showDone
    const q = view.search
    const { rooms, stat, order } = officeView(all, q, lang, showDone, roomDone, prefs.pins)
    const stars = finishBeat($, office, prefs, view, roomDone, now)
    const counts = headerCounts(all)
    const focusIndex = order.length === 0 ? -1 : Math.min(view.focusIndex, order.length - 1)
    const focused = focusIndex >= 0 ? order[focusIndex] : undefined
    const selected = view.selected !== null ? all.find(a => a.id === view.selected) : undefined
    const perRow = Math.max(1, Math.floor((width + 1) / (CARD_W + 1)))
    const innerW = CARD_W - 2

    // --- handlers (closures over $, declared here so `$` never crosses an import) ---
    const toggleShowDone = () => void savePrefs($, p => ({ ...p, showDone: !p.showDone }))
    const toggleMute = () => void savePrefs($, p => ({ ...p, muted: !p.muted }))
    const toggleLang = () => void setLang($, lang === 'he' ? 'en' : 'he')
    const toggleHelp = () => void update($, viewAtom, v => ({ ...v, helpOpen: !v.helpOpen }))
    const toggleDemo = () => void setDemo($, !view.demo)
    const focusSearch = () => void $.ui.focus({ requestId: PANE_ID, key: 'search' }).catch(() => undefined)
    const openAgent = (id: string) => void update($, viewAtom, v => ({ ...v, selected: id, helpOpen: false, focusIndex: order.findIndex(a => a.id === id) }))
    const closeDrawer = () => void update($, viewAtom, v => ({ ...v, selected: null, helpOpen: false }))
    const moveFocus = (d: number) => void update($, viewAtom, v => {
      if (order.length === 0) return { ...v, focusIndex: -1 }
      const cur = v.focusIndex < 0 ? (d > 0 ? -1 : order.length) : v.focusIndex
      return { ...v, focusIndex: Math.max(0, Math.min(order.length - 1, cur + d)) }
    })
    const openFocused = () => { if (focused) openAgent(focused.id) }
    const togglePin = (s: string) => void savePrefs($, p => ({ ...p, pins: p.pins.includes(s) ? p.pins.filter(x => x !== s) : [...p.pins, s] }))
    const toggleRoomDone = async (s: string) => {
      await saveRoomDone($, toggledRoomDone(roomDone, showDone, s))
      await update($, viewAtom, v => ({ ...v })) // redraw: the override lives outside $.state
    }
    const setSearch = (value: string) => void update($, viewAtom, v => ({ ...v, search: value, focusIndex: -1 }))

    // --- header ---
    const countsText = `🟢 ${counts.run} ${L.working}` + (counts.idle ? ` · ⏳ ${counts.idle} ${L.idleN}` : '') + ` · ✅ ${counts.done} ${L.finished}`
    const header = (
      <Box flexDirection={row} justifyContent="space-between" gap={1}>
        <Text bold>{L.appTitle}</Text>
        <Text dimColor>{countsText}</Text>
      </Box>
    )
    const toolbar = (
      <Box flexDirection={row} flexWrap="wrap" gap={1}>
        <Button key="showDone" hotkey="f" plain label={`${prefs.showDone ? '☑' : '☐'} ${L.showDone}`} onPress={toggleShowDone} />
        <Button key="mute" hotkey="m" plain label={prefs.muted ? '🔕' : '🔔'} onPress={toggleMute} />
        <Button key="lang" hotkey="l" plain label={L.switchTo} onPress={toggleLang} />
        <Button key="help" hotkey="h" plain label="?" onPress={toggleHelp} />
        {view.demo
          ? <Button key="demo" hotkey="d" plain label={`🎬 ${L.demoLabel} · ${L.exitDemo}`} onPress={toggleDemo} />
          : <Button key="demo" hotkey="d" plain dimColor label={`🎬 ${L.demoLabel}`} onPress={toggleDemo} />}
        {e.surface !== 'mobile' && <Button key="focusSearch" hotkey="s" plain dimColor label={`🔍 ${L.scSearch}`} onPress={focusSearch} />}
      </Box>
    )
    const search = e.surface !== 'mobile'
      ? (() => {
          const { Input } = $.ui.resolve(e)
          return (
            <Box flexDirection={row}>
              <Input key="search" placeholder={L.searchPlaceholder} value={q} submitLabel={L.scSearch} onInput={setSearch} onSubmit={setSearch} />
            </Box>
          )
        })()
      : null

    // --- help popover (PAGE renderHelp) ---
    const helpRows: Array<[string, string]> = [
      [L.scSearch, 's'], [L.scFinished, 'f'], [L.scMove, 'k / j'], [L.scOpen, 'o · Enter'], [L.scClose, 'x · Esc'],
      [L.scMute, 'm'], [L.scLang, 'l'], [L.scDemo, 'd'], [L.scHelp, 'h'],
    ]
    const help = view.helpOpen && (
      <Box key="help" flexDirection="column" borderStyle="round" paddingX={1}>
        <Box flexDirection={row} justifyContent="space-between">
          <Text bold>{L.helpTitle}</Text>
          <Button key="closeHelp" plain role="dismiss" label="✕" onPress={toggleHelp} />
        </Box>
        {helpRows.map(([what, keys]) => (
          <Box flexDirection={row} justifyContent="space-between">
            <Text>{what}</Text>
            <Text color="cyan">{keys}</Text>
          </Box>
        ))}
        <Text dimColor>{L.keysHint}</Text>
      </Box>
    )

    // --- details drawer (PAGE fillDrawer) ---
    const drawer = selected && (() => {
      const a = selected
      const dur = agentElapsed(a, now, true)
      const stx = a.status === 'running' ? L.dWorking : a.status === 'done' ? L.dDone : L.dStale
      const chips = [stx, a.subagent_type, (a.status === 'done' ? L.dDuration : L.dElapsed) + fmt(dur), a.tool].filter(Boolean)
      return (
        <Box key="drawer" flexDirection="column" borderStyle="double" paddingX={1}>
          <Box flexDirection={row} justifyContent="space-between" gap={1}>
            <Text bold>{`${a.emoji} ${personaName(a.persona_id, lang)}`}{a.role || a.task_short ? <Text dimColor>{`  ${a.role || a.task_short}`}</Text> : null}</Text>
            <Button key="close" hotkey="x" plain role="dismiss" label={`✕ ${L.close}`} onPress={closeDrawer} />
          </Box>
          <Box flexDirection={row} flexWrap="wrap" gap={1}>
            {chips.map(c => <Text key={`chip:${c}`} inverse>{` ${c} `}</Text>)}
          </Box>
          <Text bold>{L.dAction}</Text>
          <Text>{activityLabel(a, lang)}</Text>
          <Text bold>{L.dTask}</Text>
          <Text wrap="wrap">{a.task || L.taskUnavailable}</Text>
          {a.result ? <Text bold>{L.dResult}</Text> : null}
          {a.result ? <Text wrap="wrap">{a.result}</Text> : null}
          {a.result && a.truncated ? <Text dimColor>{`✂ ${L.resultTruncated}`}</Text> : null}
        </Box>
      )
    })()

    // --- one card (PAGE createWS/updateWS) ---
    const card = (a: Agent) => {
      const name = cardName(a, lang)
      const liveA = live[a.id]
      const failed = liveA !== undefined && (liveA.engine_status === 'failed' || liveA.engine_status === 'killed')
      const star = a.status === 'done' && a.id in stars && now - (stars[a.id] ?? 0) < JUST_FINISHED_MS
      const badges = [failed ? '❌' : '', star ? '⭐' : '', isLongRunning(a, now) ? '⏰' : ''].filter(Boolean).join('')
      const sub = a.role ? (a.subagent_type || personaName(a.persona_id, lang)) : a.subagent_type
      const isFocused = focused?.id === a.id
      const isSelected = selected?.id === a.id
      const border = isSelected ? 'double' : isFocused ? 'bold' : 'round'
      const color = a.status === 'running' ? 'green' : a.status === 'stale' ? 'yellow' : undefined
      const bursting = star && now - (stars[a.id] ?? 0) < BURST_MS
      const burst = bursting
        ? (e.surface === 'terminal' || e.surface === 'desktop')
          ? (() => {
              const { Client } = $.ui.resolve(e)
              return <Client key={`confetti:${a.id}`} module="./confetti.tsx" props={{ seed: personaIndex(a.id), width: innerW }} width={innerW} height={1} />
            })()
          : <Text color="yellow">🎉 ✨ 🎊 ⭐</Text>
        : null
      return (
        <Box key={`card:${a.id}`} flexDirection="column" width={CARD_W} borderStyle={border} borderColor={color} borderDimColor={a.status === 'done'} paddingX={1}>
          <Box flexDirection={row} justifyContent="space-between">
            <Button key={`open:${a.id}`} plain label={`${a.emoji} ${name}`} onPress={() => openAgent(a.id)} />
            {badges ? <Text>{badges}</Text> : null}
          </Box>
          {sub ? <Text dimColor wrap="truncate-end">{sub}</Text> : null}
          <Text color={color} dimColor={a.status === 'done'} wrap="truncate-end">{activityLabel(a, lang)}</Text>
          <Box flexDirection={row} justifyContent="space-between">
            <Text key={`timer:${a.id}`} dimColor>{fmt(agentElapsed(a, now))}</Text>
            {a.is_session ? <Text dimColor>💬</Text> : null}
          </Box>
          {burst}
        </Box>
      )
    }

    // --- rooms (PAGE ensureRoom + the room header) ---
    const roomBoxes = rooms.map(s => {
      const st = stat.get(s)
      const title = st?.topic || st?.label || s.slice(0, 8)
      const small = st?.topic ? st.label : (st?.sid ?? s.slice(0, 8))
      const pinOn = prefs.pins.includes(s)
      const showing = roomShowsDone(roomDone, showDone, s)
      const members = order.filter(a => a.session_full === s)
      const chunks: Agent[][] = []
      for (let i = 0; i < members.length; i += perRow) chunks.push(members.slice(i, i + perRow))
      return (
        <Box key={`room:${s}`} flexDirection="column" marginTop={1}>
          <Box flexDirection={row} justifyContent="space-between" gap={1}>
            <Box flexDirection={row} gap={1}>
              <Button key={`pin:${s}`} plain dimColor={!pinOn} label="📌" onPress={() => togglePin(s)} />
              <Text bold wrap="truncate-end">{`💬 ${title}`}</Text>
              <Text dimColor>{small}</Text>
            </Box>
            <Box flexDirection={row} gap={1}>
              <Text>{`🟢 ${st?.running ?? 0}`}</Text>
              {st?.stale ? <Text color="yellow">{`⏳ ${st.stale}`}</Text> : null}
              {st?.done
                ? <Button key={`rdone:${s}`} plain dimColor={!showing} label={`✅${st.done}`} onPress={() => void toggleRoomDone(s)} />
                : null}
            </Box>
          </Box>
          {chunks.map((chunk, i) => (
            <Box key={`row:${s}:${i}`} flexDirection={row} gap={1}>
              {chunk.map(card)}
            </Box>
          ))}
        </Box>
      )
    })

    // --- empty states (PAGE emptyHTML) ---
    const empty = order.length === 0 && (() => {
      const kind = emptyKind(q, all.length, showDone)
      const msg = kind === 'noactive' ? L.emptyNoActive : kind === 'nonewindow' ? L.emptyNoneInWindow : kind === 'nomatch' ? L.emptyNoMatch : L.emptyOffice
      return (
        <Box key="empty" flexDirection="column" alignItems="center" marginTop={1}>
          <Text>🏢</Text>
          <Text bold>{msg}</Text>
          {kind === 'office' ? <Text dimColor wrap="wrap">{L.emptySub}</Text> : null}
          {kind === 'office' ? <Button key="watchDemo" variant="primary" label={L.watchDemo} onPress={() => void setDemo($, true)} /> : null}
        </Box>
      )
    })()

    // --- the arrow-key walk (PAGE moveCardFocus / roving tabstop) ---
    const nav = order.length > 0 && (
      <Box flexDirection={row} gap={1} marginTop={1}>
        <Button key="prev" hotkey="k" plain dimColor label="↑" onPress={() => moveFocus(-1)} />
        <Button key="next" hotkey="j" plain dimColor label="↓" onPress={() => moveFocus(1)} />
        <Button key="openFocused" hotkey="o" plain dimColor label={L.scOpen} onPress={openFocused} />
        {focused ? <Text dimColor wrap="truncate-end">{`${focused.emoji} ${cardName(focused, lang)}`}</Text> : null}
      </Box>
    )

    // --- footer ---
    const footerBits: string[] = []
    if (office.oversized > 0) footerBits.push(L.oversizedN(office.oversized))
    if (scanError !== null && scanError !== '') footerBits.push(scanError)
    const footer = footerBits.length > 0 && <Text dimColor wrap="truncate-end">{footerBits.join(' · ')}</Text>

    return (
      <Box flexDirection="column" width={width}>
        {header}
        {toolbar}
        {search}
        {help}
        {drawer}
        {roomBoxes}
        {empty}
        {nav}
        {footer}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
