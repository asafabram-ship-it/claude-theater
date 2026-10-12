// UI: draws the 🎭 pane (the office) from $.state and handles its presses /
// typing. The port of PAGE's JS (claude_theater.py) over the engine's
// elements (Box/Text/Button/Input, plus the `confetti.tsx` Client surface
// module for the finish burst on the surfaces that have a frame clock).
//
// OWNER: builder "ui". Contract (register.tsx calls these):
//   registerUi(on)         adds the ui.render hook for the pane and the `ui.message`
//                          hook of its desktop office Client (applyOfficeMessage)
//   paneTitle(lang, run)   the pane's title for $.ui.open
//   workingCount(payload)  PAGE's `run`: open-chat agents working now
//   starsOf(...)           the finish beat's ⭐ stamps (pure; the poll runs it, see below)
//   renderKey(payload, now) the flicker guard's projection of a payload (the poll compares it)
//   officeView, parseRoomDone  what the office shows (the poll celebrates only a shown finish)
//   rememberRoomDone(map)  the render's copy of the overrides, after the poll pruned them in $.store
//
// What it draws (spec "עובר כמו שהוא"), top to bottom — every line budgeted
// from e.props.bodyColumns (gridFor / clip / cellWidth), nothing fixed-width:
//   header   one line: title · "🟢 N working · ⏳ M idle · ✅ K finished" (PAGE
//            #counts); under COMPACT_BELOW columns "🎭 · 🟢N ⏳M ✅K" alone; with a
//            five-hour reading (USAGE) it ends "· ⏳ 5h 42%" when that fits whole
//   toolbar  one row: [f] show finished · [m] 🔔/🔕 · [l] language · [h] help ·
//            [d] demo (+ exit); compact → icons only and no hotkey chips
//   search   an Input (not on mobile, which has none), the 🔍 in its placeholder
//   help     the keyboard-shortcuts popover (PAGE renderHelp) while open
//   drawer   the selected agent (PAGE fillDrawer): chips (status, subagent_type,
//            duration/elapsed, tool), model, activity, task, result, "shortened"
//   DESKTOP  (e.surface === 'desktop') the whole pane is instead ONE `Client`
//            (key OFFICE_KEY, module ./office-client.tsx): the hooks build its JSON
//            props from state (office-props.ts buildOfficeProps — the rooms, the
//            drawer, the counts, the flags, the i18n strings, the usage meter) and
//            size it to its FULL content (office-chrome.ts officeHeight: the
//            chrome rows + office-layout.ts rowCount, the layout's rows counted
//            without building a cell), so the engine scrolls it natively
//            and hands the window back as e.props.scroll (offset → props.offset,
//            bodyRows → props.rows). The module draws the chrome and the text-cell
//            tiles (office-layout.ts), the hover and the fx motion (walk-in, hop),
//            the selection/focus/status highlights, and POSTS
//            what the person did (open / pin / roomDone / the toolbar / search —
//            OfficeMessage) to `ui.message`: the hook below (applyOfficeMessage)
//            applies each post as the text cards' press of the same name does
//            (the shared transitions: one prefs / view atom, the store mirror),
//            and the write redraws the pane with the new props. Equal state →
//            equal props → no redraw. The Client is drawn only where the
//            surface's table has one (`'Client' in els`) and while
//            !DESKTOP.clientFailed; a `ui.fault` of the module (register.tsx)
//            sets the flag and the desktop falls through to the text cards below
//            until /theater tries the Client again.
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
//   the live map: a live agent's every tool.call writes it, and on the desktop
//   every redraw blinks (see renderKey — the flicker guard).
// - Draw with the table of e.surface: `$.ui.resolve(e)`. Width is
//   e.props.bodyColumns (narrower than the viewport when docked).
// - Hebrew default; `dirOf(prefs.lang)` decides the row direction (RTL = row-reverse).
// - Every hook is registered with `.catch(($, e, next) => next(e))`.
//
// The finish beat (PAGE updateWS: prevStatus running→done on a VISIBLE card →
// confetti + ding + toast + ⭐) runs in the POLL (register.tsx), not here: the
// poll stamps the just-finished ids into the payload it publishes
// (`payload.stars`, by starsOf below) and toasts / chimes there, so a finish
// costs the ONE $.state write of the publish and this render only DRAWS
// `office.stars` (the ⭐, the terminal's confetti burst, the desktop tile's
// hop) — it writes nothing. ENGINE FACTS (probed, 2.1.288): a plugin's hooks
// never see its own $.state.set, a render may toast and play audio, a render
// may NOT write state. As in PAGE the beat fires only for an agent the office
// shows (its room shows finished, it matches the search, its chat is open) —
// the poll asks officeView exactly as this render does — which is why demo
// mode forces "show finished" on without persisting it.
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
import { DEFAULT_PREFS, DEFAULT_VIEW, DESKTOP, EMPTY_PAYLOAD, JUST_FINISHED_MS, LONG_RUNNING_MS, PANE_ID, REDRAW_LATCH_MS, STORE_PREFS_KEY, USAGE, personaIndex } from './model'
import type { Agent, Payload, Prefs, TheaterStatus, View } from './model'
import { UNKNOWN_MODEL_PILL, WALK_IN_MS } from './office-svg'
// the pure chrome maths (the Client's full content height, the search text's cap) and the pure layout's row
// count: never the surface module itself (office-client.tsx is reached only through the literal `module` path below)
import { COMPACT_BELOW, cleanSearch, officeHeight } from './office-chrome'
import { rowCount } from './office-layout'
import { OFFICE_KEY, buildOfficeProps } from './office-props'
import { personaName } from './personas'
import { demoPayload } from './scanner'
import { usageShort } from './usage'

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
/** Under this many columns the header, toolbar, room headers and nav draw icons alone, without key-hint chips (the one threshold, office-chrome.ts: the desktop Client's toolbar reads it too). */
export { COMPACT_BELOW } from './office-chrome'
/** Two cards share a row from this width, three from COLS3_FROM. */
export const COLS2_FROM = 72
export const COLS3_FROM = 120
/** A card never grows past this (a lone card in a wide pane stays readable). */
export const CARD_MAX_W = 60
/** PAGE confetti(): the burst is removed after this many ms (the ⭐ outlives it, JUST_FINISHED_MS). */
const BURST_MS = 1050

/**
 * THE TICK GUARD. `tick` (the text surfaces' mm:ss clock) is written by the
 * poll only while a TEXT surface has drawn the pane lately: the desktop app
 * redraws the pane on a write of any value of the plugin, so a per-poll tick
 * with only the desktop open WAS the flicker. Set by the render hook.
 */
let textSurfaceDrawnAt = -Infinity
/** The engine clock's last answer in the render (its fallback when a host has no clock). */
let clockSeen = 0
/** How long a text surface's last draw keeps the tick running (it redraws on every tick, so a live one renews it). */
export const TEXT_SURFACE_TTL_MS = 10_000
/** Should the poll write the tick at `now`? */
export function textSurfaceActive(now: number): boolean {
  return now - textSurfaceDrawnAt < TEXT_SURFACE_TTL_MS
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
 * THE FINISH BEAT's stamps (PAGE updateWS over a whole payload; the poll runs
 * it, register.tsx): the ⭐ map to publish — `prev` (the stars published last)
 * minus the entries older than JUST_FINISHED_MS, plus `now` for every agent
 * whose remembered status was not done and is done now (never on first sight,
 * so a first scan or a reload celebrates nothing). `prevStatus` is the caller's
 * memory, updated for EVERY agent of the payload (hidden ones too, so a later
 * toggle cannot replay a stale running→done) and pruned to the payload's ids.
 * Pure but for that memory; which of the new stamps the office shows (and so
 * celebrates) is the caller's call (officeView).
 */
export function starsOf(prevStatus: Record<string, TheaterStatus>, agents: readonly Agent[], prev: Readonly<Record<string, number>>, now: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, t] of Object.entries(prev)) if (now - t < JUST_FINISHED_MS) out[id] = t
  const live = new Set<string>()
  for (const a of agents) {
    live.add(a.id)
    const before = prevStatus[a.id]
    if (before !== undefined && before !== 'done' && a.status === 'done') out[a.id] = now
    prevStatus[a.id] = a.status
  }
  for (const id of Object.keys(prevStatus)) if (!live.has(id)) delete prevStatus[id]
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

/** DESKTOP: the clock the tiles are timed from — the wall-clock minute, so every tile's minutes (and so the props) move together, once a minute. */
export function minuteClock(now: number): number {
  return Math.floor(now / 60_000) * 60_000
}

/**
 * PAGE .entering (the walk-in): ids first seen within WALK_IN_MS of `now`.
 * `firstSeen` is the caller's memory (agent id → when it first appeared);
 * stamped for every agent of the office and pruned to the office's ids. The
 * desktop render calls it for the stamps alone (`enteredAt` in the Client's
 * props: the module times its own walk-in fx from them).
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

/** The office the pane draws: the demo while `view.demo` (with the ⭐ the poll published for it), else the scanned payload. */
export function effectivePayload(payload: Payload, view: Pick<View, 'demo'>, now: number): Payload {
  return view.demo ? { ...demoPayload(now), stars: payload.stars } : payload
}

/**
 * THE FLICKER GUARD's projection: everything the pane DRAWS of a payload at
 * `now`, as one string — and nothing it does not (scanned_ms, versions,
 * skipped, raw timestamps). Two payloads with the same key draw the same
 * office (the same Client props), so the poll publishes only when the key
 * moved (register.tsx): a $.state.set redraws every reader, and on the
 * desktop every redraw of the pane blinks, so a per-tick write WAS the
 * flicker. Time enters at the resolution it is drawn:
 * the elapsed MINUTE (the desktop tile's timer; the text surfaces tick their
 * mm:ss from the tick atom instead), the ⏰ long-running flag, and the ⭐ ids
 * still inside the JUST_FINISHED window (`payload.stars`, the poll's stamps)
 * — so a star's expiry and a minute's turn still redraw, once.
 */
export function renderKey(payload: Payload, now: number, coarse = false): string {
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
  const alive = Object.entries(payload.stars).filter(([, t]) => now - t < JUST_FINISHED_MS).map(([id]) => id).sort()
  parts.push(alive.join(','))
  return parts.join('\u0002')
}

/** PAGE roomDone as $.store holds it (ct_roomDone): the object of booleans; anything else → {} (a bad value never breaks a draw). */
export function parseRoomDone(stored: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [k, v] of Object.entries(stored as Record<string, unknown>)) if (typeof v === 'boolean') out[k] = v
  }
  return out
}

// ---------------------------------------------------------------------------
// Module memory (not drawn from; a hot reload only loses a walk-in, as PAGE's reload does).
// ---------------------------------------------------------------------------

/** PAGE roomDone, cached from $.store ('roomDone'); null until first read. */
let roomDoneCache: Record<string, boolean> | null = null
/** PAGE .entering: agent id → when it first appeared in the office (the desktop tile's walk-in: `enteredAt` in the Client's props). */
const firstSeen: Record<string, number> = {}

async function loadRoomDone($: EngineInterface): Promise<Record<string, boolean>> {
  if (roomDoneCache !== null) return roomDoneCache
  try {
    roomDoneCache = parseRoomDone(await $.store.get(STORE_ROOM_DONE_KEY))
  } catch {
    roomDoneCache = {}
  }
  return roomDoneCache
}

/**
 * The render's copy of the overrides follows every write of theirs: saveRoomDone's here, and the poll's
 * (register.tsx prunes the rooms no longer present straight in $.store — no `$` crosses the import, so it
 * hands the kept map over instead). A stale copy would write a pruned room back on the next toggle.
 */
export function rememberRoomDone(value: Record<string, boolean>): void {
  roomDoneCache = value
}

async function saveRoomDone($: EngineInterface, value: Record<string, boolean>): Promise<void> {
  rememberRoomDone(value)
  await $.store.set(STORE_ROOM_DONE_KEY, value).catch(() => undefined)
}

/** Writes prefs through the atom and mirrors them to $.store (they outlive the session). */
async function savePrefs($: EngineInterface, fn: (p: Prefs) => Prefs): Promise<Prefs> {
  const saved = await update($, prefsAtom, fn)
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

// ---------------------------------------------------------------------------
// The presses, ONE set of transitions for both doors: the text cards' Button /
// Input closures (the render below) and the desktop office Client's posts
// (applyOfficeMessage). Pure; the `$` plumbing (savePrefs, update, setLang,
// setDemo, saveRoomDone) is this file's, so `$` never crosses an import.
// ---------------------------------------------------------------------------

const flipShowDone = (p: Prefs): Prefs => ({ ...p, showDone: !p.showDone })
const flipMuted = (p: Prefs): Prefs => ({ ...p, muted: !p.muted })
const flipStill = (p: Prefs): Prefs => ({ ...p, still: !p.still })
const flipPin = (room: string) => (p: Prefs): Prefs => ({ ...p, pins: p.pins.includes(room) ? p.pins.filter(x => x !== room) : [...p.pins, room] })
const flipHelp = (v: View): View => ({ ...v, helpOpen: !v.helpOpen })
/** The drawer on `id`; `focusIndex` is the card's place in the text cards' walk (officeView().order). */
const openedOn = (id: string, focusIndex: number) => (v: View): View => ({ ...v, selected: id, helpOpen: false, focusIndex })
const drawerClosed = (v: View): View => ({ ...v, selected: null, helpOpen: false })
/** The search set to `q`, cleaned (office-chrome.ts cleanSearch: SEARCH_MAX code points, the bidi controls removed, every other control character a space — an Input value holding either is refused, the text cards' as the Client's). */
const searchedFor = (q: string) => (v: View): View => ({ ...v, search: cleanSearch(q), focusIndex: -1 })
const otherLang = (lang: Lang): Lang => (lang === 'he' ? 'en' : 'he')

/** THE REDRAW LATCH (model.ts REDRAW_LATCH_MS): true while a redraw is scheduled. */
let redrawPending = false

/**
 * Redraws the pane for a change that is not a $.state write (a room's "show
 * finished" override lives in $.store): one `$.ui.invalidate` REDRAW_LATCH_MS
 * after the first ask, whoever asks meanwhile — a burst of clicks is ONE
 * redraw (on the desktop every redraw of the pane blinks). Never throws.
 */
function requestRedraw($: EngineInterface): void {
  if (redrawPending) return
  try {
    $.clock.after(REDRAW_LATCH_MS, () => {
      redrawPending = false
      try {
        $.ui.invalidate('ui.render')
      } catch {
        // nothing draws the pane
      }
    })
    redrawPending = true
  } catch {
    // no timer: the next state write redraws it
  }
}

/** The text cards' walk order, as the render computes it: an `open` post keeps `view.focusIndex` on the opened card for the text fallback. */
async function officeOrder($: EngineInterface): Promise<Agent[]> {
  const prefs = await read($, prefsAtom)
  const payload = await read($, payloadAtom)
  const view = await read($, viewAtom)
  const roomDone = await loadRoomDone($)
  const now = await $.clock.now().catch(() => payload.scanned_ms)
  const office = effectivePayload(payload, view, now)
  return officeView(office.agents, view.search, prefs.lang, view.demo || prefs.showDone, roomDone, prefs.pins).order
}

/**
 * THE OFFICE'S POSTS (desktop): `e.data` of a `ui.message` from the office
 * Client (office-client.tsx, OfficeMessage) — code's data, validated here,
 * never trusted — applied as the text cards' press of the same name does,
 * through the shared transitions above, ONE atom per message:
 *   showDone / mute / still / pin {room} → prefs (+ the $.store mirror)
 *   lang → prefs (+ mirror) and the pane retitled (setLang)
 *   help / close / open {id} / search {q} / demo → view (search: cleaned and
 *     capped, cleanSearch; only when it differs, so an echo or a repeated Enter
 *     redraws nothing)
 *   roomDone {room} → the $.store override, the pane redrawn by the latch
 * Anything else changes nothing: `focus` (no longer posted — j / k move the
 * module's own keyboard focus, and a post per key could displace a click's
 * `open` in the same frame; mirrored into view.focusIndex it would also redraw
 * — blink — the pane per key), `content` / `pull` (dropped with the native
 * scroll, spec §2 item 11), an unknown `t`, a missing or mistyped field, a
 * non-object.
 */
async function applyOfficeMessage($: EngineInterface, data: unknown): Promise<void> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return
  const m = data as { t?: unknown; id?: unknown; room?: unknown; q?: unknown }
  switch (m.t) {
    case 'showDone':
      await savePrefs($, flipShowDone)
      return
    case 'mute':
      await savePrefs($, flipMuted)
      return
    case 'still':
      await savePrefs($, flipStill)
      return
    case 'pin':
      if (typeof m.room === 'string') await savePrefs($, flipPin(m.room))
      return
    case 'lang':
      await setLang($, otherLang((await read($, prefsAtom)).lang))
      return
    case 'help':
      await update($, viewAtom, flipHelp)
      return
    case 'close':
      await update($, viewAtom, drawerClosed)
      return
    case 'demo':
      await setDemo($, !(await read($, viewAtom)).demo)
      return
    case 'open': {
      if (typeof m.id !== 'string') return
      const id = m.id
      const order = await officeOrder($)
      await update($, viewAtom, openedOn(id, order.findIndex(a => a.id === id)))
      return
    }
    case 'search': {
      if (typeof m.q !== 'string') return
      const q = cleanSearch(m.q) // (by code point: never half a surrogate pair; bidi controls removed, other control characters as spaces)
      if ((await read($, viewAtom)).search !== q) await update($, viewAtom, searchedFor(q))
      return
    }
    case 'roomDone': {
      if (typeof m.room !== 'string') return
      const prefs = await read($, prefsAtom)
      const view = await read($, viewAtom)
      await saveRoomDone($, toggledRoomDone(await loadRoomDone($), view.demo || prefs.showDone, m.room))
      requestRedraw($)
      return
    }
    default:
      return
  }
}

// ---------------------------------------------------------------------------
// Hooks.
// ---------------------------------------------------------------------------

/** Adds the pane's render hook and its office Client's message hook. Called once from register(). */
export function registerUi(on: On): void {
  // The desktop office Client's posts (only this plugin's hooks see them): applied as the text cards' presses
  // (applyOfficeMessage). Core answers `{}` — the module keeps its local state and gets the new props from the
  // redraw the write causes; a post never fails the surface.
  on('ui.message', { element: 'office' }, async ($, e) => { // OFFICE_KEY, as a literal: validate reads a matcher statically
    try {
      await applyOfficeMessage($, e.data)
    } catch {
      // a bad post, or a write refused: the office stays as it was
    }
    return {}
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: 'agent-theater' }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const prefs = await read($, prefsAtom)
    const payload = await read($, payloadAtom)
    const view = await read($, viewAtom)
    const scanError = await read($, scanErrorAtom)
    // the desktop draws the office Client (office-client.tsx); every other surface the text cards
    const desktop = e.surface === 'desktop'
    // the text surfaces subscribe to the poll's tick so their mm:ss advance; the desktop does NOT
    // (its tiles show minutes, and every redraw of it blinks — the tick must never reach it)
    if (!desktop) await read($, tickAtom)
    const roomDone = await loadRoomDone($)
    // the clock is the engine's; a host without one (a bare test) falls back to the last time the clock answered,
    // or the scan's own time (never the runtime's wall clock: the hooks keep the engine's one clock)
    const now = await $.clock.now().then(t => (clockSeen = t)).catch(() => Math.max(clockSeen, payload.scanned_ms))
    if (!desktop) textSurfaceDrawnAt = now
    const lang = prefs.lang
    const L: Strings = I18N[lang]
    const rtl = dirOf(lang) === 'rtl'
    const width = Math.max(MIN_WIDTH, e.props.bodyColumns || 80)
    const office = effectivePayload(payload, view, now)
    const all = office.agents

    // --- DESKTOP: the office is ONE Client. The hooks build its props from state (buildOfficeProps: pure,
    //     plain JSON) and size it to its full content (chrome + layout rows), so the engine scrolls it
    //     natively and hands the window back as e.props.scroll; the module draws the tiles, the chrome and
    //     the fx, and posts what the person did to `ui.message` (applyOfficeMessage above). Nothing is written here.
    //     Equal state → equal props → nothing redraws. Only where the surface's table has a Client (the
    //     capability, not the name: spec §5), and never while DESKTOP.clientFailed (a `ui.fault` of the module,
    //     register.tsx; /theater clears it): then the desktop falls through to the text cards below.
    if (e.surface === 'desktop' && 'Client' in els && !DESKTOP.clientFailed) {
      const { Client } = els
      walkIns(firstSeen, all, now) // the newcomers' stamps (enteredAt): the module's walk-in fx reads them
      const footerBits: string[] = []
      if (office.oversized > 0) footerBits.push(L.oversizedN(office.oversized))
      if (scanError !== null && scanError !== '') footerBits.push(scanError)
      const props = buildOfficeProps({
        payload, prefs, view, roomDone, now, firstSeen, usage: USAGE.fiveHour, footer: footerBits.join(' · '),
        columns: width, rows: e.props.scroll?.bodyRows ?? 30, offset: e.props.scroll?.offset ?? 0,
      })
      const height = officeHeight(props, rowCount(props)) // (the rows counted, no cell built: this runs on every render)
      return <Client key={OFFICE_KEY} module="./office-client.tsx" width={width} height={height} props={props} />
    }

    // desktop (the text fallback) + Hebrew: a column's short lines hug its right edge
    const colAlign = desktop && rtl ? 'flex-end' : undefined
    const row = rtl ? 'row-reverse' : 'row'
    const compact = width < COMPACT_BELOW
    const { perRow, cardW } = gridFor(width)
    const innerW = cardW - 2 // the status mark + its space
    const showDone = view.demo || prefs.showDone
    const q = view.search
    const { rooms, stat, order } = officeView(all, q, lang, showDone, roomDone, prefs.pins)
    // the ⭐ as the poll published them (the finish beat is the poll's; a render only draws)
    const stars = office.stars
    const counts = headerCounts(all)
    const focusIndex = order.length === 0 ? -1 : Math.min(view.focusIndex, order.length - 1)
    const focused = focusIndex >= 0 ? order[focusIndex] : undefined
    const selected = view.selected !== null ? all.find(a => a.id === view.selected) : undefined
    // a narrow pane shows no key-hint chips (the desktop draws one per hotkey: three rows of them at
    // 45 columns); the hotkeys come back with the room, and the help popover lists them either way
    const hk = (k: string) => (compact ? undefined : k)

    // --- handlers (closures over $, declared here so `$` never crosses an import; the transitions are the
    //     ones the desktop Client's posts go through, applyOfficeMessage) ---
    const toggleShowDone = () => void savePrefs($, flipShowDone)
    const toggleMute = () => void savePrefs($, flipMuted)
    const toggleLang = () => void setLang($, otherLang(lang))
    const toggleHelp = () => void update($, viewAtom, flipHelp)
    const toggleDemo = () => void setDemo($, !view.demo)
    const openAgent = (id: string) => void update($, viewAtom, openedOn(id, order.findIndex(a => a.id === id)))
    const closeDrawer = () => void update($, viewAtom, drawerClosed)
    const moveFocus = (d: number) => void update($, viewAtom, v => {
      if (order.length === 0) return { ...v, focusIndex: -1 }
      const cur = v.focusIndex < 0 ? (d > 0 ? -1 : order.length) : v.focusIndex
      return { ...v, focusIndex: Math.max(0, Math.min(order.length - 1, cur + d)) }
    })
    const openFocused = () => { if (focused) openAgent(focused.id) }
    const togglePin = (s: string) => void savePrefs($, flipPin(s))
    const toggleRoomDone = async (s: string) => {
      await saveRoomDone($, toggledRoomDone(roomDone, showDone, s))
      // redraw: the override lives outside $.state (a view write here, at once: a text surface does not blink; the
      // desktop Client's roomDone goes through the redraw latch instead)
      await update($, viewAtom, v => ({ ...v }))
    }
    const setSearch = (value: string) => void update($, viewAtom, searchedFor(value))

    // --- header: one line. Narrow → the counts alone as icons (the tab already says 🎭); wide → title + worded counts ---
    const countsText = compact
      ? `🟢${counts.run}` + (counts.idle ? ` ⏳${counts.idle}` : '') + ` ✅${counts.done}`
      : `🟢 ${counts.run} ${L.working}` + (counts.idle ? ` · ⏳ ${counts.idle} ${L.idleN}` : '') + ` · ✅ ${counts.done} ${L.finished}`
    // the five-hour meter ends the counts (`· ⏳ 5h 42%`, usage.ts) when it fits whole: a percent cut in half is worse than none
    // (the footer line under the prompt carries the full label on this surface)
    const countsBudget = width - (compact ? 3 : cellWidth(L.appTitle) + 1)
    const countsMeter = USAGE.fiveHour ? `${countsText} · ${usageShort(USAGE.fiveHour)}` : countsText
    const header = (
      <Box flexDirection={row} justifyContent="space-between" gap={1}>
        {compact ? <Text bold>🎭</Text> : <Text bold>{L.appTitle}</Text>}
        <Text dimColor>{clip(cellWidth(countsMeter) <= countsBudget ? countsMeter : countsText, countsBudget)}</Text>
      </Box>
    )
    // --- toolbar: one row; icons alone when narrow, worded when there is room ---
    const toolbar = (
      <Box flexDirection={row} flexWrap={compact ? 'nowrap' : 'wrap'} gap={1}>
        <Button key="showDone" hotkey={hk('f')} plain label={compact ? (showDone ? '☑' : '☐') : `${showDone ? '☑' : '☐'} ${L.showDone}`} onPress={toggleShowDone} />
        <Button key="mute" hotkey={hk('m')} plain label={prefs.muted ? '🔕' : '🔔'} onPress={toggleMute} />
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
        ? e.surface === 'terminal' // (the desktop's own celebration is the office Client's hop; its text fallback gets the emoji line)
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
      return (
        <Box key={`room:${s}`} flexDirection="column" marginTop={1}>
          <Box flexDirection={row} justifyContent="space-between" gap={1}>
            <Box flexDirection={row} gap={1}>
              <Button key={`pin:${s}`} plain dimColor={!pinOn} label={pinOn ? '📌' : '○'} onPress={() => togglePin(s)} />
              <Text bold>{titleText}</Text>
              {smallText ? <Text dimColor>{smallText}</Text> : null}
            </Box>
            <Box flexDirection={row} gap={1}>
              <Text>{countBits[0]}</Text>
              {st?.stale ? <Text color="yellow">{`⏳${st.stale}`}</Text> : null}
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
          <Box flexDirection="column" alignItems="center">
            <Text bold wrap="wrap">{msg}</Text>
            {kind === 'office' ? <Text dimColor wrap="wrap">{L.emptySub}</Text> : null}
          </Box>
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
