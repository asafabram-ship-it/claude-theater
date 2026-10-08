// UI: draws the 🎭 pane (the office) from $.state and handles its presses /
// typing. The port of PAGE's JS (claude_theater.py) over the engine's
// elements (Box/Text/Button/Input, plus the `confetti.tsx` Client surface
// module for the finish burst on the surfaces that have a frame clock).
//
// OWNER: builder "ui". Contract (register.tsx calls these):
//   registerUi(on)         adds the ui.render hook for the pane; the finish beat
//                          (⭐ + chime + toast) runs inside it, see below
//   paneTitle(lang, run)   the pane's title for $.ui.open
//   workingCount(payload)  PAGE's `run`: open-chat agents working now
//
// What it draws (spec "עובר כמו שהוא"), top to bottom — every line budgeted
// from e.props.bodyColumns (gridFor / clip / cellWidth), nothing fixed-width:
//   header   one line: title · "🟢 N working · ⏳ M idle · ✅ K finished" (PAGE
//            #counts); under COMPACT_BELOW columns "🎭 · 🟢N ⏳M ✅K" alone
//   toolbar  one row: [f] show finished · [m] 🔔/🔕 · [l] language · [h] help ·
//            [d] demo (+ exit); compact → icons only and no hotkey chips
//   search   an Input (not on mobile, which has none), the 🔍 in its placeholder
//   help     the keyboard-shortcuts popover (PAGE renderHelp) while open
//   drawer   the selected agent (PAGE fillDrawer): chips (status, subagent_type,
//            duration/elapsed, tool), model, activity, task, result, "shortened"
//   DESKTOP  (e.surface === 'desktop') each ROOM is instead animated SVG ROWS from
//            office-svg.ts (roomRowSvgs: the title on the first row + roomCols()
//            tiles per row, the SAME count for every room of the render — a
//            character at a desk, 10–12 px texts, light/dark, walk-in / bob / hop /
//            ⭐ pop) scaled through their viewBox to the pane's width (bigger tiles
//            in a wider pane; the count steps up only at breakpoints). The Svg is a
//            leaf and Box has no onPress, so under the rows sits one tight row of
//            small numbered Buttons 'open:<id>' (label "1", "2", …)
//            matching the number badge on each tile; the tile's <title> tooltip
//            carries the full details. The engine's room header line keeps only
//            📌 and the counts (the title is in the SVG: no wrapping, no lone 💬).
//            STABLE SOURCE: the SVG markup is identical between polls unless
//            something visible changed (the frame reloads — and every animation
//            restarts — on each source change): elapsed time at minute resolution
//            from a clock quantized to the wall-clock minute, the one-shot classes
//            (entering, justdone) only on the poll that triggers them.
//   rooms    one per conversation (session_full): pinned first 📌, then rooms with
//            a running agent, then by last activity (PAGE's sort). Room header,
//            one line: 📌/○ · 💬 topic-or-project (clipped from its end) · small
//            label/sid when it fits · 🟢N · ⏳N · ✅N (toggles that room's "show
//            finished"). Cards fill the row: 1 per row under COLS2_FROM, 2 to
//            COLS3_FROM, 3 past it. A card is two lines, no frame:
//              ● 💬 emoji name ⭐⏰❌              mm:ss   (💬 on the lead's name only)
//                activity · 🧠 model · subagent_type     (a "·" only between two parts;
//                                                         the model ALWAYS, "🧠 ?" when unknown)
//            the name a plain Button (Enter/click opens the drawer); ● is the
//            status colour (▸ focused, ◉ selected), ⏰ ≥ LONG_RUNNING_MS, ⭐
//            within JUST_FINISHED_MS, ❌ failed/killed (from the live map).
//   nav      [k] previous · [j] next · [o] open · [x] close — the arrow-key walk
//   empty    office (with "▶ watch a demo") / no-active / none-in-window / no-match
//   footer   oversized transcripts, scanError, dim
//
// Rules:
// - A render hook never writes state; presses/inputs write with update($, ...)
//   from Button/Input closures declared in this file (so `$` never crosses an
//   import — validate rule).
// - Read state with read($, atom) so the pane redraws on every $.state.set;
//   atoms are declared in THIS file (validate rule), never imported. The pane
//   reads payload / prefs / view / scanError (+ tick off the desktop) and NOT
//   the live map: a live agent's every tool.call writes it, and a redraw
//   reloads the desktop's Svg frames (see renderKey — the flicker guard).
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
// Demo mode (PAGE ?demo=1): `view.demo` → the pane draws scanner's
// demoPayload(now), the ONE port of Python demo_payload (the poll publishes the
// same cast): a 12 s scripted loop (phase 3: a newcomer walks in, phases 6-9:
// the finisher completes → the beat). The poll keeps writing `payload` every
// POLL_MS, so the office redraws and the clock advances.
//
// Pane title (PAGE document.title): "🟢 N · " + the app title while N agents
// work — paneTitle(lang, run); the poll retitles when N changes, setLang on a
// language switch.
//
// Reload: register.tsx hooks the same render ahead of this one and kicks its
// ensurePolling through `$.clock.after(0, …)` (never inside the draw) so a pane
// that stayed up over a hot reload resumes its poll on the first redraw.
//
// Per-room "show finished" overrides (PAGE roomDone, tri-state): kept in
// $.store under 'roomDone' (the prefs contract has only the global flag) and
// cached in this module; a room that comes to match the global toggle drops
// its override. Pins live in prefs.pins.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { I18N, activityLabel, dirOf, modelLabel, type Lang, type Strings } from './i18n'
import { DEFAULT_PREFS, DEFAULT_VIEW, EMPTY_PAYLOAD, JUST_FINISHED_MS, LONG_RUNNING_MS, PANE_ID, STORE_PREFS_KEY, personaIndex } from './model'
import type { Agent, Payload, Prefs, View } from './model'
import { ROOM_COLS, UNKNOWN_MODEL_PILL, WALK_IN_MS, messageSvg, roomRowSvgs, type TileDecor } from './office-svg'
import { personaName } from './personas'
import { demoPayload } from './scanner'

// $.state atoms (validate: declared as consts in the file that reads them;
// the same keys register.tsx writes — see ../types/index.d.ts).
const payloadAtom = atom({ plugin: 'agent-theater', key: 'payload' } as const, EMPTY_PAYLOAD)
const prefsAtom = atom({ plugin: 'agent-theater', key: 'prefs' } as const, DEFAULT_PREFS)
const viewAtom = atom({ plugin: 'agent-theater', key: 'view' } as const, DEFAULT_VIEW)
const scanErrorAtom = atom({ plugin: 'agent-theater', key: 'scanError' } as const, null)
/** The poll's clock: read ONLY on the text surfaces (their mm:ss tick with it); the desktop never subscribes, so a tick reloads no frame. */
const tickAtom = atom({ plugin: 'agent-theater', key: 'tick' } as const, 0)

/** $.store key of the per-room "show finished" overrides (PAGE ct_roomDone). */
export const STORE_ROOM_DONE_KEY = 'roomDone'
/** The narrowest body the pane lays out for (a narrower bodyColumns is drawn as this and scrolls). */
export const MIN_WIDTH = 24
/** Under this many columns the header, toolbar, room headers and nav draw icons alone, without key-hint chips. */
export const COMPACT_BELOW = 60
/** Two cards share a row from this width, three from COLS3_FROM. */
export const COLS2_FROM = 72
export const COLS3_FROM = 120
/** A card never grows past this (a lone card in a wide pane stays readable). */
export const CARD_MAX_W = 60
/** PAGE ding(): two chimes within this many ms are one (storm guard). */
const DING_GAP_MS = 400
/** The finish chime, the plugin's own file. */
const DING_ASSET = 'sounds/done.wav'
/** PAGE confetti(): the burst is removed after this many ms (the ⭐ outlives it, JUST_FINISHED_MS). */
const BURST_MS = 1050
/**
 * DESKTOP: the office is drawn as scalable SVG rows (office-svg.ts) that fill
 * the pane's width, so the tiles GROW with the pane. The tiles per row step
 * up only at breakpoints (bodyColumns): ROOM_COLS (3) under COLS_STEP_FROM +
 * COLS_STEP, then one more every COLS_STEP columns — 4 from 90, 5 from 130,
 * 6 from 170, 7 from 210, TILE_MAX_PER_ROW (8) from 250. Just under a
 * breakpoint a tile is about twice its size at 45 columns; just past one it
 * is still larger than at 45 (90/372 > 45/284 viewBox units per column), so
 * a wider pane means bigger tiles first and more tiles second. One count for
 * every room of a render (roomCols(width) once).
 */
export const COLS_STEP_FROM = 50
export const COLS_STEP = 40
/** The widest desktop row (a very wide pane stays an office, not a strip). */
export const TILE_MAX_PER_ROW = 8
/** The finish poll's hop + ⭐ pop: `justdone` is passed while the star is younger than this (under POLL_MS: one poll). */
export const TILE_HOP_MS = 1000

/** A long sentence split at its " - " / " — " so each part is its own short line (the desktop empty state). */
export function splitSentence(s: string): string[] {
  return s.split(/\s[-—]\s/).map(x => x.trim()).filter(Boolean)
}

/**
 * THE TICK GUARD. `tick` (the text surfaces' mm:ss clock) is written by the
 * poll only while a TEXT surface has drawn the pane lately: the desktop app
 * redraws the pane on a write of any value of the plugin, so a per-poll tick
 * with only the desktop open WAS the flicker. Set by the render hook.
 */
let textSurfaceDrawnAt = -Infinity
/** How long a text surface's last draw keeps the tick running (it redraws on every tick, so a live one renews it). */
export const TEXT_SURFACE_TTL_MS = 10_000
/** Should the poll write the tick at `now`? */
export function textSurfaceActive(now: number): boolean {
  return now - textSurfaceDrawnAt < TEXT_SURFACE_TTL_MS
}

/** DIAGNOSTICS (register.tsx flushDiag): the last lines, oldest first. */
const DIAG: string[] = []
const DIAG_MAX = 400
let diagDirty = false
/** Records one diagnostic line, stamped mm:ss.mmm. */
export function diagLine(now: number, line: string): void {
  const d = new Date(now)
  const ts = `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
  DIAG.push(`${ts} ${line}`)
  if (DIAG.length > DIAG_MAX) DIAG.splice(0, DIAG.length - DIAG_MAX)
  diagDirty = true
}
/** The whole log when a line was added since the last call, else "". */
export function takeDiag(): string {
  if (!diagDirty) return ''
  diagDirty = false
  return DIAG.join('\n') + '\n'
}

/** The pane title shown in the tab: PAGE document.title = (run ? "🟢 N · " : "") + docTitle. */
export function paneTitle(lang: Lang, run = 0): string {
  const base = lang === 'he' ? '🎭 התיאטרון' : '🎭 Theater'
  return (run > 0 ? `🟢 ${run} · ` : '') + base
}

/** PAGE render()'s `run`: agents of open chats working right now (the live working-count of the title). */
export function workingCount(payload: Pick<Payload, 'agents'>): number {
  return payload.agents.filter(a => a.status === 'running' && !a.closed).length
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
 * null; the card, as PAGE's `st==="done"&&en` branch, falls through to the
 * live count when end_ms is null — a closed chat's collapsed subagent keeps
 * counting, exactly as the extension did); stale → frozen at last activity;
 * running → live.
 */
export function agentElapsed(a: Agent, now: number, forDrawer = false): number | null {
  const s = a.start_ms ?? 0
  const en = a.end_ms ?? 0
  const mt = a.mtime_ms ?? 0
  if (a.is_session) return mt ? now - mt : null
  if (!s) return null
  if (a.status === 'done') return forDrawer ? (en || mt || now) - s : en ? en - s : now - s
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
    if (a.is_session && a.task_short) v.topic = a.task_short // PAGE: the lead's task_short (first sentence / 90 chars)
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

/** The lead's chat marker: on the lead card's FIRST line only (before the avatar), never elsewhere, never alone. */
export const LEAD_MARK = '💬'

/**
 * The card's second line as segments: the non-empty parts with a lone "·"
 * between each pair — so the separator exists only BETWEEN two texts and
 * never dangles at either end (an empty subagent_type or model leaves no
 * trace), whichever way the row is laid out (RTL rows reverse the segments).
 */
export function joinParts(parts: readonly string[]): string[] {
  const out: string[] = []
  for (const p of parts) {
    if (!p) continue
    if (out.length > 0) out.push('·')
    out.push(p)
  }
  return out
}

/**
 * Cells a string takes on a terminal row: an emoji / wide glyph 2, a combining
 * mark, variation selector or ZWJ 0, anything else (Hebrew included) 1. An
 * approximation good enough to budget a line.
 */
export function cellWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0xfe0f || cp === 0xfe0e || cp === 0x200d || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x591 && cp <= 0x5c7)) continue
    w += cp > 0xffff || (cp >= 0x2300 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff) || (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ? 2 : 1
  }
  return w
}

/**
 * Cuts `s` to at most `max` cells, ending in "…" when something was dropped.
 * The cut is always at the string's END (the beginning stays), whatever the
 * row's direction: the engine's visual truncation in an RTL row cuts an
 * English title's start off, so the pane never relies on it for a label.
 */
export function clip(s: string, max: number): string {
  if (max <= 0) return ''
  if (cellWidth(s) <= max) return s
  if (max === 1) return '…'
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = cellWidth(ch)
    if (used + w > max - 1) break
    out += ch
    used += w
  }
  return out.trimEnd() + '…'
}

/**
 * The card grid for a body of `width` cells: one card per row under
 * COLS2_FROM, two to COLS3_FROM, three past it; cards share the row evenly
 * (a 1-cell gutter between) and never grow past CARD_MAX_W.
 */
export function gridFor(width: number): { perRow: number; cardW: number } {
  const w = Math.max(MIN_WIDTH, width)
  const perRow = w >= COLS3_FROM ? 3 : w >= COLS2_FROM ? 2 : 1
  const cardW = Math.min(CARD_MAX_W, Math.floor((w - (perRow - 1)) / perRow))
  return { perRow, cardW }
}

/** DESKTOP: tiles per row for a body of `width` columns — ROOM_COLS, +1 per COLS_STEP columns past COLS_STEP_FROM, at most TILE_MAX_PER_ROW. */
export function roomCols(width: number): number {
  const w = Math.max(MIN_WIDTH, width)
  return Math.max(ROOM_COLS, Math.min(TILE_MAX_PER_ROW, ROOM_COLS + Math.floor(Math.max(0, w - COLS_STEP_FROM) / COLS_STEP)))
}

/** The same count (every room of a render shares it). */
export const tilesPerRow = roomCols

/** DESKTOP: the clock the tiles are timed from — the wall-clock minute, so every room's timers tick (and its SVG reloads) together, once a minute. */
export function minuteClock(now: number): number {
  return Math.floor(now / 60_000) * 60_000
}

/**
 * PAGE .entering (the walk-in): ids first seen within WALK_IN_MS of `now`.
 * `firstSeen` is the caller's memory (agent id → when it first appeared);
 * stamped for every agent of the office and pruned to the office's ids.
 */
export function walkIns(firstSeen: Record<string, number>, all: readonly Agent[], now: number): Set<string> {
  const entering = new Set<string>()
  const live = new Set<string>()
  for (const a of all) {
    live.add(a.id)
    const t = firstSeen[a.id]
    if (t === undefined) firstSeen[a.id] = now
    if (now - (firstSeen[a.id] ?? now) < WALK_IN_MS) entering.add(a.id)
  }
  for (const id of Object.keys(firstSeen)) if (!live.has(id)) delete firstSeen[id]
  return entering
}

/** The office the pane draws: the demo while `view.demo`, else the scanned payload. */
export function effectivePayload(payload: Payload, view: Pick<View, 'demo'>, now: number): Payload {
  return view.demo ? demoPayload(now) : payload
}

/**
 * THE FLICKER GUARD's projection: everything the pane DRAWS of a payload at
 * `now`, as one string — and nothing it does not (scanned_ms, versions,
 * skipped, raw timestamps). Two payloads with the same key draw the same
 * office, so the poll publishes only when the key moved (register.tsx): a
 * $.state.set redraws every reader, a redraw of the pane re-creates the
 * desktop's interactive Svg frames (restarting their animations), so a
 * per-tick write WAS the flicker. Time enters at the resolution it is drawn:
 * the elapsed MINUTE (the desktop tile's timer; the text surfaces tick their
 * mm:ss from the tick atom instead), the ⏰ long-running flag, and the ⭐ ids
 * still inside the JUST_FINISHED window (`stars`: the beat's
 * view.justFinished) — so a star's expiry and a minute's turn still redraw,
 * once.
 */
export function renderKey(payload: Payload, now: number, stars: Readonly<Record<string, number>> = {}, coarse = false): string {
  const parts: string[] = [payload.demo ? 'D' : 'S', String(payload.oversized)]
  for (const a of payload.agents) {
    const el = agentElapsed(a, minuteClock(now))
    // coarse (the CALM key): who is in the office and whether live/done/failed (working ⇄ waiting ⏳ flaps), not what each one is doing
    // this second (tool / phase) nor the minute on its clock
    parts.push([
      a.id, a.persona_id, a.emoji, a.role, a.subagent_type, coarse && a.status === 'stale' ? 'running' : a.status, coarse ? '' : a.tool, coarse ? '' : a.phase, a.task_short, a.task, a.result ?? '\u0000',
      a.session, a.session_full, a.cwd, a.project, a.is_session ? 1 : 0, a.closed ? 1 : 0, a.is_workflow ? 1 : 0, a.truncated ? 1 : 0,
      a.model, a.topic ?? '', a.failed ? 1 : 0,
      coarse ? '' : el === null ? 'x' : Math.max(0, Math.floor(el / 60_000)), isLongRunning(a, now) ? 1 : 0,
    ].join('\u0001'))
  }
  const alive = Object.entries(stars).filter(([, t]) => now - t < JUST_FINISHED_MS).map(([id]) => id).sort()
  parts.push(alive.join(','))
  return parts.join('\u0002')
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
/** PAGE .entering: agent id → when it first appeared in the office (the desktop tile's walk-in). */
const firstSeen: Record<string, number> = {}

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
  diagLine(Date.now(), `write prefs showDone=${saved.showDone} lang=${saved.lang} pins=${saved.pins.length}`)
  await $.store.set(STORE_PREFS_KEY, saved).catch(() => undefined)
  return saved
}

/** PAGE setLang(): prefs + the pane's title (with the working count, as the poll keeps it). */
async function setLang($: EngineInterface, lang: Lang): Promise<void> {
  await savePrefs($, p => ({ ...p, lang }))
  const payload = await read($, payloadAtom)
  await $.ui.open({ id: PANE_ID, title: paneTitle(lang, workingCount(payload)) }).catch(() => undefined)
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
            diagLine(now, `write view (stars=${Object.keys(committed).length} selectedGone=${selectedGone})`)
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
    // the desktop draws SVG tiles (office-svg.ts) in a scalable grid; every other surface the text cards
    const desktop = e.surface === 'desktop'
    // the text surfaces subscribe to the poll's tick so their mm:ss advance; the desktop does NOT
    // (its tiles show minutes, and a redraw reloads its frames — the tick must never reach it)
    if (!desktop) await read($, tickAtom)
    const roomDone = await loadRoomDone($)
    // the clock is the engine's; a host without one (a bare test) falls back to the module's
    const now = await $.clock.now().catch(() => Date.now())
    if (!desktop) textSurfaceDrawnAt = now
    const lang = prefs.lang
    const L: Strings = I18N[lang]
    const rtl = dirOf(lang) === 'rtl'
    // desktop + Hebrew: a column's short lines hug its right edge
    const colAlign = desktop && rtl ? 'flex-end' : undefined
    const row = rtl ? 'row-reverse' : 'row'
    const width = Math.max(MIN_WIDTH, e.props.bodyColumns || 80)
    const compact = width < COMPACT_BELOW
    const { perRow, cardW } = gridFor(width)
    const cols = roomCols(width) // ONE count for every room of this render
    const innerW = cardW - 2 // the status mark + its space
    const office = effectivePayload(payload, view, now)
    const all = office.agents
    const showDone = view.demo || prefs.showDone
    const q = view.search
    const { rooms, stat, order } = officeView(all, q, lang, showDone, roomDone, prefs.pins)
    diagLine(now, `render pane surface=${e.surface} cols=${e.props.bodyColumns} scroll=${e.props.scroll?.offset ?? '-'} payload=${payload.scanned_ms} demo=${view.demo} sel=${view.selected ?? '-'} showDone=${prefs.showDone} roomOverrides=${Object.keys(roomDone).length} shown=${order.length}/${all.length}`)
    const stars = finishBeat($, office, prefs, view, roomDone, now)
    const entering = desktop ? walkIns(firstSeen, all, now) : new Set<string>()
    const counts = headerCounts(all)
    const focusIndex = order.length === 0 ? -1 : Math.min(view.focusIndex, order.length - 1)
    const focused = focusIndex >= 0 ? order[focusIndex] : undefined
    const selected = view.selected !== null ? all.find(a => a.id === view.selected) : undefined
    // a narrow pane shows no key-hint chips (the desktop draws one per hotkey: three rows of them at
    // 45 columns); the hotkeys come back with the room, and the help popover lists them either way
    const hk = (k: string) => (compact ? undefined : k)

    // --- handlers (closures over $, declared here so `$` never crosses an import) ---
    const toggleShowDone = () => {
      diagLine(now, 'press showDone')
      void savePrefs($, p => ({ ...p, showDone: !p.showDone }))
    }
    const toggleMute = () => void savePrefs($, p => ({ ...p, muted: !p.muted }))
    const toggleStill = () => void savePrefs($, p => ({ ...p, still: !p.still }))
    const toggleLang = () => void setLang($, lang === 'he' ? 'en' : 'he')
    const toggleHelp = () => void update($, viewAtom, v => ({ ...v, helpOpen: !v.helpOpen }))
    const toggleDemo = () => void setDemo($, !view.demo)
    const openAgent = (id: string) => diagLine(now, `press open ${id}`) ?? void update($, viewAtom, v => ({ ...v, selected: id, helpOpen: false, focusIndex: order.findIndex(a => a.id === id) }))
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

    // --- header: one line. Narrow → the counts alone as icons (the tab already says 🎭); wide → title + worded counts ---
    const countsText = compact
      ? `🟢${counts.run}` + (counts.idle ? ` ⏳${counts.idle}` : '') + ` ✅${counts.done}`
      : `🟢 ${counts.run} ${L.working}` + (counts.idle ? ` · ⏳ ${counts.idle} ${L.idleN}` : '') + ` · ✅ ${counts.done} ${L.finished}`
    const header = (
      <Box flexDirection={row} justifyContent="space-between" gap={1}>
        {compact ? <Text bold>🎭</Text> : <Text bold>{L.appTitle}</Text>}
        <Text dimColor>{clip(countsText, width - (compact ? 3 : cellWidth(L.appTitle) + 1))}</Text>
      </Box>
    )
    // --- toolbar: one row; icons alone when narrow, worded when there is room ---
    const toolbar = (
      <Box flexDirection={row} flexWrap={compact ? 'nowrap' : 'wrap'} gap={1}>
        <Button key="showDone" hotkey={hk('f')} plain label={compact ? (showDone ? '☑' : '☐') : `${showDone ? '☑' : '☐'} ${L.showDone}`} onPress={toggleShowDone} />
        <Button key="mute" hotkey={hk('m')} plain label={prefs.muted ? '🔕' : '🔔'} onPress={toggleMute} />
        {desktop ? <Button key="still" hotkey={hk('s')} plain label={prefs.still ? '🖼' : '🎞'} onPress={toggleStill} /> : null}
        <Button key="lang" hotkey={hk('l')} plain label={compact ? (lang === 'he' ? 'EN' : 'עב') : L.switchTo} onPress={toggleLang} />
        <Button key="help" hotkey={hk('h')} plain label="?" onPress={toggleHelp} />
        {view.demo
          ? <Button key="demo" hotkey={hk('d')} plain label={compact ? '🎬 ✕' : `🎬 ${L.demoLabel} · ${L.exitDemo}`} onPress={toggleDemo} />
          : <Button key="demo" hotkey={hk('d')} plain dimColor label={compact ? '🎬' : `🎬 ${L.demoLabel}`} onPress={toggleDemo} />}
      </Box>
    )
    // --- search: the Input alone (the 🔍 lives in its placeholder; no label, no submit
    //     button: a `submitLabel` is drawn as a button beside the field on the desktop, and the
    //     search already applies on every keystroke through onInput) ---
    const search = e.surface !== 'mobile'
      ? (() => {
          const { Input } = $.ui.resolve(e)
          return (
            <Box flexDirection={row}>
              <Input key="search" placeholder={`🔍 ${desktop && rtl ? L.searchPlaceholder.replace(/…$/, '') : L.searchPlaceholder}`} value={q} onInput={setSearch} onSubmit={setSearch} />
            </Box>
          )
        })()
      : null

    // --- help popover (PAGE renderHelp) ---
    // (no 's' row: the search is the Input itself now — Tab reaches it; the jump button was a duplicate)
    const helpRows: Array<[string, string]> = [
      [L.scFinished, 'f'], [L.scMove, 'k / j'], [L.scOpen, 'o · Enter'], [L.scClose, 'x · Esc'],
      [L.scMute, 'm'], [L.scLang, 'l'], [L.scDemo, 'd'], [L.scHelp, 'h'],
    ]
    const help = view.helpOpen && (
      <Box key="help" flexDirection="column" alignItems={colAlign} borderStyle="round" paddingX={1}>
        <Box flexDirection={row} justifyContent="space-between">
          <Text bold>{L.helpTitle}</Text>
          <Button key="closeHelp" plain role="dismiss" label="✕" onPress={toggleHelp} />
        </Box>
        {helpRows.map(([what, keys]) => (
          <Box flexDirection={row} justifyContent="space-between" gap={1}>
            <Text>{clip(what, width - 14)}</Text>
            <Text color="cyan">{keys}</Text>
          </Box>
        ))}
        <Text dimColor wrap="wrap">{L.keysHint}</Text>
      </Box>
    )

    // --- details drawer (PAGE fillDrawer) ---
    const drawer = selected && (() => {
      const a = selected
      const dur = agentElapsed(a, now, true)
      // ❌ failed/killed: live.ts merged the engine's status into the payload (the pane never reads the live map)
      const failed = a.failed === true
      const stx = failed ? `❌ ${L.dFailed}` : a.status === 'running' ? L.dWorking : a.status === 'done' ? L.dDone : L.dStale
      const chips = [stx, a.subagent_type, (a.status === 'done' ? L.dDuration : L.dElapsed) + fmt(dur), a.tool].filter(Boolean)
      const model = modelLabel(a.model) || UNKNOWN_MODEL_PILL // the row is always there ("?" when unknown)
      const inner = width - 4
      return (
        <Box key="drawer" flexDirection="column" alignItems={colAlign} borderStyle="double" paddingX={1}>
          <Box flexDirection={row} justifyContent="space-between" gap={1}>
            <Text bold>{clip(`${a.emoji} ${personaName(a.persona_id, lang)}`, inner - 10)}</Text>
            <Button key="close" hotkey="x" plain role="dismiss" label={compact ? '✕' : `✕ ${L.close}`} onPress={closeDrawer} />
          </Box>
          {a.role || a.task_short ? <Text dimColor>{clip(a.role || a.task_short, inner)}</Text> : null}
          <Box flexDirection={row} flexWrap="wrap" gap={1}>
            {chips.map(c => <Text key={`chip:${c}`} inverse>{` ${clip(c, inner - 2)} `}</Text>)}
          </Box>
          <Text bold>{L.dModel}</Text>
          <Text key="model">{`🧠 ${model}`}</Text>
          <Text bold>{L.dAction}</Text>
          <Text>{activityLabel(a, lang)}</Text>
          <Text bold>{L.dTask}</Text>
          <Text wrap="wrap">{a.task || L.taskUnavailable}</Text>
          {a.result ? <Text bold>{L.dResult}</Text> : null}
          {a.result ? <Text wrap="wrap">{a.result}</Text> : null}
          {a.result && a.truncated ? <Text dimColor wrap="wrap">{`✂ ${L.resultTruncated}`}</Text> : null}
        </Box>
      )
    })()

    // --- one card (PAGE createWS/updateWS): two lines, the row's full width, no frame ---
    //   ● 💬 emoji name ⭐⏰❌         mm:ss      (💬 on the lead only)
    //     activity · 🧠 model · type   (the model always: "🧠 ?" when unknown)
    const card = (a: Agent) => {
      const name = cardName(a, lang)
      const failed = a.failed === true
      const star = a.status === 'done' && a.id in stars && now - (stars[a.id] ?? 0) < JUST_FINISHED_MS
      const badges = [failed ? '❌' : '', star ? '⭐' : '', isLongRunning(a, now) ? '⏰' : ''].filter(Boolean).join('')
      const sub = a.role ? (a.subagent_type || personaName(a.persona_id, lang)) : a.subagent_type
      // the model is ALWAYS on line 2, right after the activity ("🧠 ?" when unknown): which model runs each agent is never in doubt
      const modelTag = `🧠 ${modelLabel(a.model) || UNKNOWN_MODEL_PILL}`
      const isFocused = focused?.id === a.id
      const isSelected = selected?.id === a.id
      const color = a.status === 'running' ? 'green' : a.status === 'stale' ? 'yellow' : undefined
      const done = a.status === 'done'
      const mark = isSelected ? '◉' : isFocused ? '▸' : '●'
      const timer = fmt(agentElapsed(a, now))
      // the lead's 💬 rides its name on the first line (never a glyph of its own anywhere)
      const nameLabel = clip(`${a.is_session ? `${LEAD_MARK} ` : ''}${a.emoji} ${name}`, innerW - cellWidth(timer) - 1 - (badges ? cellWidth(badges) + 1 : 0))
      const activity = activityLabel(a, lang)
      const subBudget = innerW - cellWidth(activity) - cellWidth(modelTag) - 3 - 3
      const subText = sub && subBudget >= 4 ? clip(sub, subBudget) : ''
      // line 2: activity · 🧠 model · type — the non-empty parts, a "·" only BETWEEN two of them (never a dangling separator)
      const line2 = joinParts([activity, modelTag, subText])
      const bursting = star && now - (stars[a.id] ?? 0) < BURST_MS
      const burst = bursting
        ? e.surface === 'terminal' // (the desktop never reaches here: its room SVG's hop + ⭐ pop are the celebration)
          ? (() => {
              const { Client } = $.ui.resolve(e)
              return <Client key={`confetti:${a.id}`} module="./confetti.tsx" props={{ seed: personaIndex(a.id), width: innerW }} width={innerW} height={1} />
            })()
          : <Text color="yellow">🎉 ✨ 🎊 ⭐</Text>
        : null
      return (
        <Box key={`card:${a.id}`} flexDirection="column" width={cardW}>
          <Box flexDirection={row} justifyContent="space-between" gap={1}>
            <Box flexDirection={row} gap={1}>
              <Text color={color} dimColor={done && !isSelected && !isFocused} bold={isFocused || isSelected} inverse={isSelected}>{mark}</Text>
              <Button key={`open:${a.id}`} plain label={nameLabel} onPress={() => openAgent(a.id)} />
              {badges ? <Text>{badges}</Text> : null}
            </Box>
            <Text key={`timer:${a.id}`} dimColor>{timer}</Text>
          </Box>
          <Box flexDirection={row} gap={1}>
            <Text>{' '}</Text>
            {line2.map((seg, i) =>
              i === 0
                ? <Text key={`act:${a.id}`} color={color} dimColor={done}>{seg}</Text>
                : seg === modelTag && modelTag
                  ? <Text key={`model:${a.id}`} dimColor>{seg}</Text>
                  : <Text key={`l2:${a.id}:${i}`} dimColor>{seg}</Text>)}
          </Box>
          {burst}
        </Box>
      )
    }

    // --- DESKTOP: a room as scalable SVG ROWS (same viewBox width for every room, so every tile is the
    //     same size) + ONE tight row of small numbered open Buttons (see the header). The tiles' decor
    //     is built from a minute-quantized clock and one-shot flags, so a source is byte-identical
    //     between polls unless something visible changed — and the poll does not redraw the pane at
    //     all unless renderKey moved (register.tsx), so the frames reload only on a visible change
    //     (or a resize: the width picks the columns).
    const nowMin = minuteClock(now)
    const desktopRoom = (s: string, members: readonly Agent[], title: string, small: string) => {
      if (e.surface !== 'desktop') return null // (narrows the element table to the desktop's, which has Svg)
      const { Svg } = $.ui.resolve(e)
      const decors = new Map<string, TileDecor>()
      members.forEach((a, i) => {
        const failed = a.failed === true
        const starAt = stars[a.id]
        const star = a.status === 'done' && starAt !== undefined && now - starAt < JUST_FINISHED_MS
        decors.set(a.id, {
          index: i + 1,
          elapsedMs: agentElapsed(a, nowMin),
          star, justdone: star && now - (starAt ?? 0) < TILE_HOP_MS,
          longRunning: isLongRunning(a, now), failed,
          selected: selected?.id === a.id, focused: focused?.id === a.id, entering: entering.has(a.id),
        })
      })
      const rowsSvg = roomRowSvgs(members, decors, { lang, title, small, cols, nameOf: a => cardName(a, lang) })
      // no width/height props: the box takes the slot's width and the markup's own height at it (the
      // markup carries its intrinsic size), so the rows scale with the pane and hug their tiles
      return [
        ...rowsSvg.map((r, i) => <Svg key={`roomsvg:${s}:${i}`} source={r.source} alt={r.alt} isInteractive={prefs.still ? undefined : true} />),
        <Box key={`opens:${s}`} flexDirection={row} flexWrap="wrap" gap={0}>
          {members.map((a, i) => {
            const lit = selected?.id === a.id || focused?.id === a.id
            return <Button key={`open:${a.id}`} variant={lit ? "primary" : undefined} label={`${i + 1} ${a.emoji}`} onPress={() => openAgent(a.id)} />
          })}
        </Box>,
      ]
    }

    // --- rooms (PAGE ensureRoom + the room header): one line each ---
    const roomBoxes = rooms.map(s => {
      const st = stat.get(s)
      const title = st?.topic || st?.label || s.slice(0, 8)
      const small = st?.topic ? st.label : (st?.sid ?? s.slice(0, 8))
      const pinOn = prefs.pins.includes(s)
      const showing = roomShowsDone(roomDone, showDone, s)
      const members = order.filter(a => a.session_full === s)
      const chunks: Agent[][] = []
      for (let i = 0; i < members.length; i += perRow) chunks.push(members.slice(i, i + perRow))
      const countBits = [`🟢${st?.running ?? 0}`, st?.stale ? `⏳${st.stale}` : '', st?.done ? `✅${st.done}` : ''].filter(Boolean)
      const countsW = countBits.reduce((n, b) => n + cellWidth(b) + 1, 0)
      // the title is cut by cell count from its own end (never the engine's visual truncation,
      // which in an RTL row cuts an English title's beginning off)
      const titleBudget = width - 3 - countsW - 2
      const titleText = clip(`💬 ${title}`, titleBudget)
      const smallText = !compact && titleBudget - cellWidth(titleText) > cellWidth(small) + 4 ? small : ''
      // the desktop's header line holds only 📌 and the counts: the title is drawn in the room SVG
      // (fitted by px from its end, RTL-correct), so the line never wraps or strands a 💬
      // the desktop packs its rooms (the SVG row has its own padding; the numbers row separates them)
      return (
        <Box key={`room:${s}`} flexDirection="column" marginTop={desktop ? 0 : 1}>
          <Box flexDirection={row} justifyContent="space-between" gap={1}>
            <Box flexDirection={row} gap={1}>
              <Button key={`pin:${s}`} plain dimColor={!pinOn} label={pinOn ? '📌' : '○'} onPress={() => togglePin(s)} />
              {desktop ? null : <Text bold>{titleText}</Text>}
              {!desktop && smallText ? <Text dimColor>{smallText}</Text> : null}
            </Box>
            <Box flexDirection={row} gap={1}>
              <Text>{countBits[0]}</Text>
              {st?.stale ? <Text color="yellow">{`⏳${st.stale}`}</Text> : null}
              {st?.done
                ? <Button key={`rdone:${s}`} plain dimColor={!showing} label={`✅${st.done}`} onPress={() => void toggleRoomDone(s)} />
                : null}
            </Box>
          </Box>
          {desktop
            ? desktopRoom(s, members, title, small)
            : chunks.map((chunk, i) => (
              <Box key={`row:${s}:${i}`} flexDirection={row} gap={1}>
                {chunk.map(card)}
              </Box>
            ))}
        </Box>
      )
    })

    // --- DESKTOP: a message as SVG text. The desktop lays every Text out left-to-right and refuses the
    //     bidi marks that would fix it, so a Hebrew line holding Latin ("ב-Claude Code") or ending in
    //     ":" came out scrambled; an SVG <text direction="rtl"> is ordered (and centered) correctly ---
    const desktopMessage = (title: string, lines: readonly string[]) => {
      if (e.surface !== 'desktop') return null
      const { Svg } = $.ui.resolve(e)
      const m = messageSvg(title, lines, lang)
      return <Svg source={m.source} alt={m.alt} />
    }

    // --- empty states (PAGE emptyHTML) ---
    const empty = order.length === 0 && (() => {
      const kind = emptyKind(q, all.length, showDone)
      const msg = kind === 'noactive' ? L.emptyNoActive : kind === 'nonewindow' ? L.emptyNoneInWindow : kind === 'nomatch' ? L.emptyNoMatch : L.emptyOffice
      return (
        <Box key="empty" flexDirection="column" alignItems="center" marginTop={1}>
          <Text>🏢</Text>
          {desktopMessage(msg, kind === 'office' ? splitSentence(L.emptySub) : []) ?? (
            <Box flexDirection="column" alignItems="center">
              <Text bold wrap="wrap">{msg}</Text>
              {kind === 'office' ? <Text dimColor wrap="wrap">{L.emptySub}</Text> : null}
            </Box>
          )}
          {kind === 'office' ? <Button key="watchDemo" variant="primary" label={L.watchDemo} onPress={() => void setDemo($, true)} /> : null}
        </Box>
      )
    })()

    // --- the arrow-key walk (PAGE moveCardFocus / roving tabstop) ---
    const nav = order.length > 0 && (
      <Box flexDirection={row} gap={1} marginTop={1}>
        <Button key="prev" hotkey={hk('k')} plain dimColor label="↑" onPress={() => moveFocus(-1)} />
        <Button key="next" hotkey={hk('j')} plain dimColor label="↓" onPress={() => moveFocus(1)} />
        <Button key="openFocused" hotkey={hk('o')} plain dimColor label={compact ? '↵' : L.scOpen} onPress={openFocused} />
        {focused ? <Text dimColor>{clip(`${focused.emoji} ${cardName(focused, lang)}`, width - (compact ? 12 : cellWidth(L.scOpen) + 14))}</Text> : null}
      </Box>
    )

    // --- footer ---
    const footerBits: string[] = []
    if (office.oversized > 0) footerBits.push(L.oversizedN(office.oversized))
    if (scanError !== null && scanError !== '') footerBits.push(scanError)
    const footer = footerBits.length > 0 && <Text dimColor>{clip(footerBits.join(' · '), width)}</Text>

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
