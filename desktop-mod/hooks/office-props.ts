// office-props.ts: the data the desktop office Client draws from, as JSON
// (no undefined, no functions). The types and the Client key are the "Shared
// interfaces" block of the Client office plan; `buildOfficeProps` is the pure
// builder from the mod's state (the payload with its ⭐ stamps, prefs, view,
// the room overrides, the walk-in memory, the usage meter, the geometry and
// the clock — `now` is an input, never Date.now()). Hooks-side only: it
// imports the office's pure helpers from ui.tsx; the surface module imports
// just ./office-layout and these types.
//
// Guarantees the Client contract needs (spec §6.2, §10): plain JSON (assertJson
// throws on the first `undefined`, naming its path); `task`/`result` only in
// the drawer (one selected agent), never per agent; every text capped (name
// 24, act 16, room title and the drawer's name / subtitle 48, task/result
// 4000 — whole glyphs, through the layout's `cut`); ~100 agents ≈ 25 KB, far
// under the 100,000-character props bound — and never past it: at most
// MAX_PROPS_AGENTS agents ride the props (the rest counted in the footer,
// `+N`), and props measured over PROPS_BUDGET shed the drawer's long text,
// then more agents.

import { I18N, activityLabel, dirOf, modelFamily, modelLabel } from './i18n'
import { JUST_FINISHED_MS, RESULT_CHAR_LIMIT } from './model'
import type { Payload, Prefs, View } from './model'
import { ACT_MAX, NAME_MAX, cut } from './office-layout'
import { UNKNOWN_MODEL_PILL, toolFamily } from './office-svg'
import { personaName } from './personas'
import { RECENT_DONE, agentElapsed, cardName, effectivePayload, emptyKind, headerCounts, isLongRunning, minuteClock, officeView, roomShowsDone } from './ui'

/** The family colour token of a model id (i18n.ts): office-layout.ts colours the model pill by it (MODEL_BG). */
export { modelFamily } from './i18n'

/** The Client's key and the `ui.message` matcher. */
export const OFFICE_KEY = 'office'

export type OfficeAgent = {
  id: string; emoji: string; name: string
  status: 'running' | 'stale' | 'done'
  fam: '' | 'search' | 'read' | 'write' | 'cmd' | 'agent'   // toolFamily(tool) from office-svg.ts
  act: string                                               // activityLabel(a, lang)
  model: string                                             // modelLabel(a.model) or '?'
  modelFam: 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other'
  startMin: number | null                                   // elapsed minutes (agentElapsed at the minute clock), null = unknown
  isLead: boolean; failed: boolean; longRunning: boolean
  star: number                                              // detection stamp (the poll's clock) of a just-finished agent inside the ⭐ window, else 0
  enteredAt: number                                         // ms the office first saw it (firstSeen), 0 when unknown
}

export type OfficeRoom = {
  id: string; title: string; small: string; pinned: boolean; showDone: boolean
  run: number; stale: number; done: number
  /** The agents the room draws, in the office's order: the working and waiting, and the finished it shows (all of them, or the RECENT_DONE most recent — ui.tsx officeView). */
  agents: OfficeAgent[]
  /** The finished agents (of the search) the room holds past the ones it draws: 0 when it shows them all. */
  moreDone: number
  /** The row under the agents: i18n moreDoneN while finished are held back, hideDone while the room shows them all, '' when there is no such row. */
  moreLabel: string
}

export type OfficeDrawer = {
  id: string; name: string; chips: string[]; model: string; act: string; task: string; result: string; truncated: boolean
  elapsedMin: number | null                                 // whole minutes of agentElapsed(sel, nowMin, true): the duration when done, else the elapsed; null = unknown
  sub: string                                               // the dim subtitle under the name, as today: role || task_short (≤ 48)
  done: boolean                                             // status 'done' (a failed or killed agent too): the clock is labelled Duration, else Elapsed
}

export type OfficeProps = {
  v: 1
  lang: 'he' | 'en'; rtl: boolean
  columns: number; rows: number
  offset: number
  nowMin: number
  counts: { run: number; idle: number; done: number }
  prefs: { showDone: boolean; muted: boolean; still: boolean }
  search: string; selected: string | null; helpOpen: boolean; demo: boolean
  rooms: OfficeRoom[]
  drawer: OfficeDrawer | null
  footer: string
  usage: { pct: number; resetsAt: string } | null
  empty: { kind: 'office' | 'nomatch' | 'nonewindow' | 'noactive'; msg: string; sub: string } | null
  labels: Record<string, string>                            // the i18n strings the module draws (toolbar, help rows, drawer headings)
}

export type OfficeMessage =
  | { t: 'open'; id: string } | { t: 'close' } | { t: 'pin'; room: string } | { t: 'roomDone'; room: string }
  | { t: 'showDone' } | { t: 'mute' } | { t: 'lang' } | { t: 'help' } | { t: 'demo' } | { t: 'still' }
  | { t: 'search'; q: string } | { t: 'content'; rows: number } | { t: 'pull'; seq: number }

/** What the builder reads: the office's state at `now` (ms), and the pane's geometry. */
export type OfficePropsInput = {
  payload: Payload
  prefs: Prefs
  view: View
  /** The per-room "show finished" overrides (parseRoomDone). */
  roomDone: Readonly<Record<string, boolean>>
  /** The first drawn layout row (the scroll); clamped to ≥ 0. */
  offset: number
  columns: number
  rows: number
  now: number
  usage: { pct: number; resetsAt: string } | null
  /** Agent id → when the office first saw it (ui.tsx walkIns' memory); an unknown id draws `enteredAt: 0`. */
  firstSeen: Readonly<Record<string, number>>
  footer?: string
}

/** The caps of spec §10: a card's name and its activity (office-layout.ts NAME_MAX / ACT_MAX), a room's title, the drawer's task / result (RESULT_CHAR_LIMIT, as the scanner cuts today). */
const TITLE_MAX = 48
const TEXT_MAX = RESULT_CHAR_LIMIT

/** The Client's props bound (ClientProps: at most 100,000 characters serialized): over it the whole update is refused. */
export const PROPS_MAX_CHARS = 100_000
/** What buildOfficeProps keeps the serialized props under: the bound less a margin. */
export const PROPS_BUDGET = 90_000
/**
 * THE PROPS CAP: the most agents the props carry. One costs about 250 characters (more with a long id, or a room of
 * its own), so this many sit near half the budget. Past it the agents are dropped — the finished first, then from
 * the end of the office's own order (pinned rooms, rooms with a running agent, the latest activity) — a room left
 * with none is left out, and the footer counts them (`+N`, i18n moreAgentsN). Reached only with "show finished" on
 * and hundreds of agents inside MAX_AGE_MIN; the header's counts stay the whole office's.
 */
export const MAX_PROPS_AGENTS = 200
/** The drawer's task and result when the props still pass PROPS_BUDGET: cut to this many cells first, before more agents go. */
export const DRAWER_TEXT_TIGHT = 600

/** A clock value in whole minutes (≥ 0); `null` when the clock is unknown. */
const wholeMinutes = (el: number | null): number | null => el === null ? null : Math.max(0, Math.floor(el / 60_000))

/** The i18n strings the Client draws (toolbar, help rows, drawer headings, the empty office); every Hebrew one is worded to THE HEBREW RULE (i18n.ts hebrewRuleOk, checked by i18n.test.ts). */
export const LABEL_KEYS = ['showDone', 'switchTo', 'demoLabel', 'exitDemo', 'close', 'helpTitle', 'scFinished', 'scMove', 'scOpen', 'scClose', 'scMute', 'scLang', 'scDemo', 'scHelp', 'searchPlaceholder', 'working', 'idleN', 'finished', 'dWorking', 'dDone', 'dStale', 'dFailed', 'dDuration', 'dElapsed', 'dAction', 'dTask', 'dResult', 'dModel', 'taskUnavailable', 'resultTruncated', 'watchDemo', 'hideDone'] as const

/**
 * Throws `undefined at <path>` for the first `undefined` anywhere in `v`
 * (nested arrays and objects walked; `null` is fine): a Client instance
 * refuses a tree with `undefined`, and JSON.stringify would silently drop it.
 */
export function assertJson(v: unknown, path = ''): void {
  if (v === undefined) throw new Error(`undefined at ${path || '<root>'}`)
  if (Array.isArray(v)) v.forEach((x, i) => assertJson(x, `${path}${path ? '.' : ''}${i}`))
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertJson(x, `${path}${path ? '.' : ''}${k}`)
}

/**
 * The props of one render: the office (officeView's rooms in display order,
 * each with its cards), the drawer of the selected agent (null when nothing
 * is selected or the selection is gone), the header counts, the empty-office
 * kind, the flags the toolbar shows and the strings it draws. Pure — the
 * same inputs give the same JSON; a card's clock is `agentElapsed` at the
 * wall-clock minute, so every row ticks (and the props change) once a
 * minute, together.
 */
export function buildOfficeProps(input: OfficePropsInput): OfficeProps {
  const { prefs, view, roomDone, now } = input
  const lang = prefs.lang
  const L = I18N[lang]
  const office = effectivePayload(input.payload, view, now)
  const showDone = view.demo || prefs.showDone
  const { rooms, stat, order, moreDone } = officeView(office.agents, view.search, lang, showDone, roomDone, prefs.pins, RECENT_DONE)
  const nowMin = minuteClock(now)
  const stars = office.stars
  const cards = new Map<number, OfficeAgent>()
  /** The card of `order[i]` (memoised: a rebuild under the budget maps no agent twice). */
  const toAgent = (i: number): OfficeAgent => {
    const known = cards.get(i)
    if (known) return known
    const a = order[i]!
    const el = agentElapsed(a, nowMin)
    const starAt = stars[a.id]
    const card: OfficeAgent = {
      id: a.id, emoji: a.emoji, name: cut(cardName(a, lang), NAME_MAX), status: a.status, fam: toolFamily(a.tool),
      act: cut(activityLabel(a, lang), ACT_MAX), model: modelLabel(a.model) || UNKNOWN_MODEL_PILL, modelFam: modelFamily(a.model),
      startMin: wholeMinutes(el),
      isLead: a.is_session, failed: a.failed === true, longRunning: isLongRunning(a, now),
      star: a.status === 'done' && starAt !== undefined && now - starAt < JUST_FINISHED_MS ? starAt : 0,
      enteredAt: input.firstSeen[a.id] ?? 0,
    }
    cards.set(i, card)
    return card
  }
  // THE PROPS CAP's ranking: the cards still working or waiting first, then the finished — each in the office's order
  const ranked = order.map((_, i) => i).sort((x, y) => (order[x]!.status === 'done' ? 1 : 0) - (order[y]!.status === 'done' ? 1 : 0) || x - y)
  const sel = view.selected !== null ? office.agents.find(a => a.id === view.selected) : undefined
  const kind = order.length === 0 ? emptyKind(view.search, office.agents.length, showDone) : null
  const labels: Record<string, string> = {}
  for (const k of LABEL_KEYS) labels[k] = L[k]
  /** The props with at most `cap` agents and the drawer's task / result cut to `textMax` cells. */
  const build = (cap: number, textMax: number): OfficeProps => {
    const kept = new Set(ranked.slice(0, cap))
    const dropped = order.length - kept.size
    const outRooms: OfficeRoom[] = []
    for (const s of rooms) {
      const agents: OfficeAgent[] = []
      order.forEach((a, i) => { if (a.session_full === s && kept.has(i)) agents.push(toAgent(i)) })
      if (agents.length === 0) continue // every agent of the room went over the cap: the footer counts them
      const st = stat.get(s)
      const shows = roomShowsDone(roomDone, showDone, s)
      const more = moreDone.get(s) ?? 0
      outRooms.push({
        id: s, title: cut(st?.topic || st?.label || s.slice(0, 8), TITLE_MAX), small: st?.topic ? st.label : (st?.sid ?? s.slice(0, 8)),
        pinned: prefs.pins.includes(s), showDone: shows,
        run: st?.running ?? 0, stale: st?.stale ?? 0, done: st?.done ?? 0,
        agents, moreDone: more,
        // the row under the agents: "N more finished" while the room holds some back, "Hide finished" once it shows them all
        moreLabel: more > 0 ? L.moreDoneN(more) : shows && agents.some(a => a.status === 'done') ? L.hideDone : '',
      })
    }
    const drawer: OfficeDrawer | null = sel ? {
      // as today's drawer (ui.tsx fillDrawer): the persona on the name line, role || task_short underneath — never the role twice
      id: sel.id, name: cut(`${sel.emoji} ${personaName(sel.persona_id, lang)}`, TITLE_MAX), sub: cut(sel.role || sel.task_short, TITLE_MAX),
      // (the ❌ leads the word: a leading mark is drawn after a Hebrew word, a trailing one before it — THE HEBREW RULE, i18n.ts)
      chips: [sel.failed ? `❌ ${L.dFailed}` : sel.status === 'running' ? L.dWorking : sel.status === 'done' ? L.dDone : L.dStale, sel.subagent_type].filter(Boolean),
      model: modelLabel(sel.model) || UNKNOWN_MODEL_PILL, act: activityLabel(sel, lang),
      elapsedMin: wholeMinutes(agentElapsed(sel, nowMin, true)),
      task: cut(sel.task || L.taskUnavailable, textMax), result: cut(sel.result ?? '', textMax), truncated: sel.truncated,
      done: sel.status === 'done',
    } : null
    // the count of the agents over the cap leads the footer (short, so a narrow pane still shows it), then the scan notes
    const footer = [dropped > 0 ? L.moreAgentsN(dropped) : '', input.footer ?? ''].filter(Boolean).join(' · ')
    return {
      v: 1, lang, rtl: dirOf(lang) === 'rtl', columns: input.columns, rows: input.rows, offset: Math.max(0, input.offset), nowMin,
      counts: headerCounts(office.agents),
      prefs: { showDone: prefs.showDone, muted: prefs.muted, still: prefs.still === true },
      search: view.search, selected: view.selected, helpOpen: view.helpOpen, demo: view.demo,
      rooms: outRooms, drawer, footer, usage: input.usage,
      empty: kind === null ? null : { kind, msg: kind === 'noactive' ? L.emptyNoActive : kind === 'nonewindow' ? L.emptyNoneInWindow : kind === 'nomatch' ? L.emptyNoMatch : L.emptyOffice, sub: kind === 'office' ? L.emptySub : '' },
      labels,
    }
  }
  // THE PROPS BUDGET: props past ClientProps' bound lose the whole update, so they are measured and degraded until they
  // fit — the drawer's long text first, then fewer agents (each pass at least one fewer, so it ends)
  let cap = MAX_PROPS_AGENTS
  let textMax = TEXT_MAX
  let props = build(cap, textMax)
  let size = JSON.stringify(props).length
  if (size > PROPS_BUDGET && sel) {
    textMax = DRAWER_TEXT_TIGHT
    props = build(cap, textMax)
    size = JSON.stringify(props).length
  }
  while (size > PROPS_BUDGET && cap > 0) {
    cap = Math.max(0, Math.min(Math.min(cap, order.length) - 1, Math.floor((cap * PROPS_BUDGET * 0.9) / size)))
    props = build(cap, textMax)
    size = JSON.stringify(props).length
  }
  assertJson(props)
  return props
}
