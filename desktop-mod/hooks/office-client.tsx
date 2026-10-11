// The desktop office: ONE surface module draws the whole pane (chrome + rooms)
// from OfficeProps, hit-tests the pointer and posts actions to the hooks.
// No `$` here: everything reaches the hooks through `surface.post`, and the
// hooks reach the module through new props (a redraw, or a `ui.message`
// hook answering `{ props }`).
//
// Geometry (spec §2 item 11, Phase 0): the engine scrolls natively over a
// Client as tall as the content (`officeHeight`); `props.offset` is the
// engine's window offset and `props.rows` the pane's body height. The module
// draws the chrome (header, toolbar, search, [footer], [help | drawer]), then
// ONE spacer Box for the rows scrolled past, then only the layout rows the
// window shows (`windowOf`), then nothing: the tree is bounded by the window,
// not by the number of agents. Pointer rows are Client rows, so a hit is
// `hitAt(layout, x, y - chromeRows)` on the full layout.
//
// Discipline (spec §7.3-7.4, Phase 0): the frame clock (`surface.every`) runs
// only while an fx is active and is stopped when the last one ends; the render
// never calls `setState` (the one init aside) — what must survive between
// renders without a redraw lives in `state.inst`, a record mutated in place
// (the layout memo, the fx list, the stamps seen, the search text); `setState`
// is called only from events (a tick, a pointer, a key). The search Input
// draws the text typed, not `props.search`, so a publish between keystrokes
// cannot reset it; the `search` post is debounced. The render is wrapped in
// try/catch and draws a short red Text instead of throwing (spec §10).

import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'

import { TILE_H, cut, hitAt, layoutOffice, rowRuns, textWidth, windowRows } from './office-layout'
import type { Cell, Hit, OfficeLayout } from './office-layout'
import type { OfficeDrawer, OfficeMessage, OfficeProps } from './office-props'

/** The chrome rows always there: header, toolbar, search. */
export const CHROME_ROWS = 3
export const FX_TICK_MS = 250
export const FX_ENTER_MS = 700
export const FX_DONE_MS = 1000
/** A status change flashes the desk row for this many frames of the fx clock. */
export const FX_STATUS_FRAMES = 2
export const SEARCH_DEBOUNCE_MS = 150
/** Toolbar hotkeys from this width (ui.tsx's COMPACT_BELOW): the desktop draws a key chip per hotkey, which would wrap a narrow toolbar. */
export const HOTKEYS_FROM = 60
/** The drawer's task and result wrap to at most this many lines each (the drawer's height must be exact: the rows under it are hit-tested). */
export const TASK_LINES = 4
export const RESULT_LINES = 3
/** The help rows: a label key and the keys shown beside it (spec §6.4). */
const HELP: ReadonlyArray<readonly [string, string]> = [
  ['scFinished', 'f'], ['scMove', 'k / j'], ['scOpen', 'o · Enter'], ['scClose', 'x · Esc'], ['scMute', 'm'], ['scLang', 'l'], ['scDemo', 'd'], ['scHelp', 'h'],
]
/** The help popover's height: the border, the title row, one row per shortcut. */
export const HELP_ROWS = 2 + 1 + HELP.length
/** The background highlights the module lays over the layout's cells (the layout itself stays pure). */
export const FX_BG = {
  hover: '#2b3350', focus: '#3b4f8a', selected: '#4a3f8a',
  enter: '#1f4d2a', done: '#8a6a10', doneAlt: '#5a4a10', status: '#4b5563',
} as const

/** The letter keys that are the toolbar (spec §6.4). */
const KEY_MESSAGES: Record<string, OfficeMessage> = {
  x: { t: 'close' }, f: { t: 'showDone' }, m: { t: 'mute' }, l: { t: 'lang' }, h: { t: 'help' }, d: { t: 'demo' }, s: { t: 'still' },
}

type FxKind = 'enter' | 'done' | 'status'
type Fx = { id: string; kind: FxKind; left: number }
type Seen = { enter: Record<string, number>; star: Record<string, number>; status: Record<string, string> }

/** What survives between renders without a redraw: mutated in place, never replaced. */
export type OfficeInst = {
  props: OfficeProps
  chrome: number
  layoutKey: string
  layout: OfficeLayout
  hitById: Map<string, Hit>
  order: string[]
  drawerKey: string
  drawer: DrawerLine[]
  fx: Fx[]
  stop: (() => void) | null
  seen: Seen | null
  query: string
  propsSearch: string
  posted: string | null
  debounce: (() => void) | null
}
/** The local state: what a redraw reads (`setState` only from events). */
export type OfficeState = { hover: string | null; focus: string | null; frame: number; inst: OfficeInst }

export type DrawerLine = { kind: 'name' | 'dim' | 'chips' | 'head' | 'body' | 'note'; text: string; chips?: string[] }

type Surface = ClientSurface<OfficeState>

function send(surface: Surface, m: OfficeMessage): void {
  surface.post(m)
}

// ---------------------------------------------------------------------------
// pure parts (exported: the hooks size the Client with them, the tests pin them)
// ---------------------------------------------------------------------------

/**
 * The layout rows the engine's window shows, in layout coordinates: `from` is
 * the first row (the rows above it are one spacer), `count` how many — never
 * more than the content holds, so `windowRows` has nothing to clamp and the
 * rows stay under the pointer.
 */
export function windowOf(chrome: number, offset: number, bodyRows: number, len: number): { from: number; count: number } {
  const from = Math.max(0, offset - chrome)
  const visible = Math.max(0, bodyRows - Math.max(0, chrome - offset))
  return { from, count: Math.max(0, Math.min(visible, len - from)) }
}

/** `s` without a trailing ellipsis (no regex: a surface module spells no `$`, not even as an anchor). */
function trimEllipsis(s: string): string {
  return s.endsWith('…') ? s.slice(0, -1) : s
}

/** `text` broken into at most `max` lines of `width` cells (whole words; a longer word is split), the last one ending in … when lines were dropped. */
export function wrapLines(text: string, width: number, max: number): string[] {
  const out: string[] = []
  if (width < 1 || max < 1) return out
  const words = text.split(/\s+/).filter(Boolean)
  let line = ''
  let dropped = false
  for (let i = 0; i < words.length; i++) {
    let word = words[i]!
    if (out.length >= max) { dropped = true; break }
    const cand = line ? `${line} ${word}` : word
    if (textWidth(cand) <= width) { line = cand; continue }
    if (line) { out.push(line); line = '' }
    while (textWidth(word) > width) {
      if (out.length >= max) { dropped = true; break }
      // the widest prefix within `width` cells, through the layout's own cut (one pass per line, not per code point)
      let chunk = cut(word, width + 1)
      if (chunk === word || textWidth(chunk) > width) chunk = cut(word, width)
      if (chunk.endsWith('…')) chunk = chunk.slice(0, -1)
      if (!chunk) break
      out.push(chunk)
      word = word.slice(chunk.length)
    }
    if (out.length >= max) { dropped = dropped || word.length > 0 || i < words.length - 1; break }
    line = word
  }
  if (line) { if (out.length < max) out.push(line); else dropped = true }
  if (dropped && out.length > 0) {
    const last = out[out.length - 1]!
    out[out.length - 1] = textWidth(last) < width ? `${last}…` : `${trimEllipsis(cut(last, width - 1))}…`
  }
  return out
}

/** The drawer's lines at `inner` cells (its box is `2 + lines.length` rows tall), from the drawer and the labels. */
export function drawerLines(d: OfficeDrawer, L: Record<string, string>, inner: number): DrawerLine[] {
  const lbl = (k: string) => L[k] ?? ''
  const lines: DrawerLine[] = [{ kind: 'name', text: cut(d.name, Math.max(1, inner - 10)) }]
  if (d.sub) lines.push({ kind: 'dim', text: cut(d.sub, inner) })
  const chips = [...d.chips]
  if (d.elapsedMin !== null) chips.push(`${d.chips[0] === lbl('dDone') ? lbl('dDuration') : lbl('dElapsed')}${d.elapsedMin}′`)
  const shown: string[] = []
  let used = 0
  for (const c of chips) {
    const w = textWidth(c) + 2 + (shown.length ? 1 : 0)
    if (used + w > inner) break
    shown.push(c)
    used += w
  }
  lines.push({ kind: 'chips', text: shown.map(c => ` ${c} `).join(' '), chips: shown })
  lines.push({ kind: 'head', text: cut(`${lbl('dModel')}: 🧠 ${d.model} · ${lbl('dAction')}: ${d.act}`, inner) })
  lines.push({ kind: 'head', text: cut(lbl('dTask'), inner) })
  for (const t of wrapLines(d.task || lbl('taskUnavailable'), inner, TASK_LINES)) lines.push({ kind: 'body', text: t })
  if (d.result) {
    lines.push({ kind: 'head', text: cut(lbl('dResult'), inner) })
    for (const t of wrapLines(d.result, inner, RESULT_LINES)) lines.push({ kind: 'body', text: t })
    if (d.truncated) lines.push({ kind: 'note', text: cut(`✂ ${lbl('resultTruncated')}`, inner) })
  }
  return lines
}

/** The empty office's lines: the message, the sub's sentences (split as today's `splitSentence`), each wrapped. */
function emptyLines(p: OfficeProps): { msg: string[]; sub: string[] } {
  if (!p.empty) return { msg: [], sub: [] }
  const w = Math.max(1, p.columns)
  return { msg: wrapLines(p.empty.msg, w, 2), sub: p.empty.sub ? p.empty.sub.split(/\s[-—]\s/).flatMap(s => wrapLines(s, w, 2)) : [] }
}

/** The rows the empty-office block takes (a margin row, 🏢, the lines, the demo Button). */
function emptyRows(p: OfficeProps): number {
  if (!p.empty) return 0
  const e = emptyLines(p)
  return 1 + 1 + e.msg.length + e.sub.length + (p.empty.kind === 'office' ? 1 : 0)
}

/** The rows above the layout: header, toolbar, search, the footer line when there is one, then the help popover or the drawer. */
export function chromeRows(p: OfficeProps): number {
  let n = CHROME_ROWS + (p.footer ? 1 : 0)
  if (p.helpOpen) n += HELP_ROWS
  else if (p.drawer) n += 2 + drawerLines(p.drawer, p.labels, Math.max(1, p.columns - 4)).length
  return n
}

/** The Client's full content height: what the hooks pass as `height` (`layoutRows` = `layoutOffice(p).rows.length`). */
export function officeHeight(p: OfficeProps, layoutRows: number): number {
  return chromeRows(p) + (p.empty ? emptyRows(p) : layoutRows)
}

// ---------------------------------------------------------------------------
// the instance
// ---------------------------------------------------------------------------

function layoutKeyOf(p: OfficeProps): string {
  return JSON.stringify([p.columns, p.rtl, p.selected, p.rooms])
}

function setLayout(inst: OfficeInst, p: OfficeProps, key: string): void {
  inst.layoutKey = key
  inst.layout = layoutOffice(p)
  inst.hitById = new Map()
  inst.order = []
  for (const hit of inst.layout.hits) {
    if (hit.kind !== 'agent') continue
    inst.hitById.set(hit.id, hit)
    inst.order.push(hit.id)
  }
}

function newInst(p: OfficeProps): OfficeInst {
  const inst: OfficeInst = {
    props: p, chrome: 0, layoutKey: '', layout: { rows: [], hits: [] }, hitById: new Map(), order: [], drawerKey: '', drawer: [],
    fx: [], stop: null, seen: null, query: p.search, propsSearch: p.search, posted: null, debounce: null,
  }
  setLayout(inst, p, layoutKeyOf(p))
  return inst
}

/** One frame of the fx clock: the effects age by a tick, the clock stops with the last one, and the drawing is asked for. */
function tick(surface: Surface): void {
  const cur = surface.state
  if (!cur) return
  const inst = cur.inst
  inst.fx = inst.fx.map(f => ({ ...f, left: f.left - FX_TICK_MS })).filter(f => f.left > 0)
  if (inst.fx.length === 0 && inst.stop) {
    inst.stop()
    inst.stop = null
  }
  surface.setState({ ...cur, frame: cur.frame + 1 })
}

/** New fx from the props' stamps (the first props prime the stamps and start nothing); `still` records the stamps and drops every fx. */
function detectFx(surface: Surface, inst: OfficeInst, p: OfficeProps): void {
  const seen = inst.seen
  const next: Seen = { enter: { ...seen?.enter }, star: { ...seen?.star }, status: { ...seen?.status } }
  const fresh: Fx[] = []
  const still = p.prefs.still
  for (const room of p.rooms) {
    for (const a of room.agents) {
      if (seen && !still) {
        if (a.enteredAt && seen.enter[a.id] !== a.enteredAt) fresh.push({ id: a.id, kind: 'enter', left: FX_ENTER_MS })
        if (a.star && seen.star[a.id] !== a.star) fresh.push({ id: a.id, kind: 'done', left: FX_DONE_MS })
        const was = seen.status[a.id]
        if (was !== undefined && was !== a.status) fresh.push({ id: a.id, kind: 'status', left: FX_STATUS_FRAMES * FX_TICK_MS })
      }
      next.enter[a.id] = a.enteredAt
      next.star[a.id] = a.star
      next.status[a.id] = a.status
    }
  }
  inst.seen = next
  if (still) {
    if (inst.fx.length) inst.fx = []
    if (inst.stop) { inst.stop(); inst.stop = null }
    return
  }
  if (fresh.length === 0) return
  inst.fx = [...inst.fx.filter(f => !fresh.some(g => g.id === f.id && g.kind === f.kind)), ...fresh]
  if (!inst.stop) inst.stop = surface.every(FX_TICK_MS, () => tick(surface))
}

/** The typed text, posted after SEARCH_DEBOUNCE_MS of quiet (a one-shot on the frame clock); Enter posts at once. */
function queueSearch(surface: Surface, inst: OfficeInst, q: string, now: boolean): void {
  if (inst.debounce) { inst.debounce(); inst.debounce = null }
  if (now) { postSearch(surface, inst, q); return }
  const stop = surface.every(SEARCH_DEBOUNCE_MS, () => {
    stop()
    inst.debounce = null
    postSearch(surface, inst, q)
  })
  inst.debounce = stop
}

function postSearch(surface: Surface, inst: OfficeInst, q: string): void {
  inst.posted = q
  send(surface, { t: 'search', q })
}

function listen(surface: Surface): void {
  surface.onPointer(ev => {
    try {
      const cur = surface.state
      if (!cur) return
      const inst = cur.inst
      const hit = hitAt(inst.layout, ev.x, ev.y - inst.chrome)
      if (ev.type === 'down') {
        if (ev.button !== 'left' || !hit) return
        if (hit.kind === 'agent') {
          if (cur.focus !== hit.id) surface.setState({ ...cur, focus: hit.id })
          send(surface, { t: 'open', id: hit.id })
        } else if (hit.kind === 'pin') send(surface, { t: 'pin', room: hit.id })
        else send(surface, { t: 'roomDone', room: hit.id })
      } else if (ev.type === 'move' || ev.type === 'leave') {
        const id = ev.type === 'leave' ? null : hit?.kind === 'agent' ? hit.id : null
        if (id !== cur.hover) surface.setState({ ...cur, hover: id })
      }
    } catch {
      // a listener must never throw (the instance would unmount)
    }
  })
  surface.onKey(ev => {
    try {
      const cur = surface.state
      if (!cur || ev.ctrl || ev.meta) return
      const inst = cur.inst
      const k = ev.key
      if (k === 'j' || k === 'down' || k === 'k' || k === 'up') {
        const order = inst.order
        if (order.length === 0) return
        const d = k === 'j' || k === 'down' ? 1 : -1
        const i = cur.focus ? order.indexOf(cur.focus) : -1
        const n = i < 0 ? (d > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, i + d))
        const id = order[n]!
        if (id === cur.focus) return
        surface.setState({ ...cur, focus: id })
        send(surface, { t: 'focus', id })
      } else if (k === 'o' || k === 'return') {
        if (cur.focus && inst.hitById.has(cur.focus)) send(surface, { t: 'open', id: cur.focus })
      } else {
        const m = KEY_MESSAGES[k]
        if (m) send(surface, m)
      }
    } catch {
      // see above
    }
  })
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------

type Rect = { x: number; w: number; y: number; bg: string }

/** The highlights over the layout: selection, keyboard focus, hover (the head row), and the fx (head, name or desk row). */
function decor(s: OfficeState, p: OfficeProps): Rect[] {
  const inst = s.inst
  const rects: Rect[] = []
  const head = (id: string | null, bg: string) => {
    const hit = id ? inst.hitById.get(id) : undefined
    if (hit) rects.push({ x: hit.x, w: hit.w, y: hit.y, bg })
  }
  head(p.selected, FX_BG.selected)
  head(s.focus, FX_BG.focus)
  head(s.hover, FX_BG.hover)
  for (const f of inst.fx) {
    const hit = inst.hitById.get(f.id)
    if (!hit) continue
    if (f.kind === 'enter') rects.push({ x: hit.x, w: hit.w, y: hit.y, bg: FX_BG.enter }, { x: hit.x, w: hit.w, y: hit.y + 2, bg: FX_BG.enter })
    else if (f.kind === 'done') rects.push({ x: hit.x, w: hit.w, y: hit.y, bg: s.frame % 2 === 0 ? FX_BG.done : FX_BG.doneAlt })
    else rects.push({ x: hit.x, w: hit.w, y: Math.min(hit.y + 1, hit.y + TILE_H - 1), bg: FX_BG.status })
  }
  return rects
}

function paint(cells: readonly Cell[], y: number, rects: readonly Rect[]): readonly Cell[] {
  let out: Cell[] | null = null
  for (const r of rects) {
    if (r.y !== y) continue
    if (!out) out = cells.map(c => ({ ...c }))
    for (let x = Math.max(0, r.x); x < Math.min(out.length, r.x + r.w); x++) out[x] = { ...out[x]!, bg: r.bg }
  }
  return out ?? cells
}

const Office: ClientModule<OfficeProps, OfficeState> = (props, surface) => {
  const { Box, Text, Button, Input } = surface.elements
  try {
    // --- the instance: once ---
    let s = surface.state
    if (s === undefined) {
      listen(surface)
      s = { hover: null, focus: null, frame: 0, inst: newInst(props) }
      surface.setState(s)
    }
    const inst = s.inst
    inst.props = props

    // --- the layout, memoised by the props that shape it ---
    const key = layoutKeyOf(props)
    if (key !== inst.layoutKey) setLayout(inst, props, key)
    const layout = inst.layout

    // --- the drawer's lines, memoised too (they decide the chrome's height) ---
    const inner = Math.max(1, props.columns - 4)
    if (props.drawer && !props.helpOpen) {
      const dk = JSON.stringify([props.columns, props.lang, props.drawer])
      if (dk !== inst.drawerKey) { inst.drawerKey = dk; inst.drawer = drawerLines(props.drawer, props.labels, inner) }
    }
    inst.chrome = CHROME_ROWS + (props.footer ? 1 : 0) + (props.helpOpen ? HELP_ROWS : props.drawer ? 2 + inst.drawer.length : 0)

    // --- the search text: ours unless the hooks changed it from outside (not our own echo) ---
    if (props.search !== inst.propsSearch) {
      const outside = props.search !== inst.posted && props.search !== inst.query
      inst.propsSearch = props.search
      if (outside) {
        inst.query = props.search
        if (inst.debounce) { inst.debounce(); inst.debounce = null }
      }
    }

    // --- event fx from the stamps (never on the first props; nothing under `still`) ---
    detectFx(surface, inst, props)

    const L = props.labels
    const lbl = (k: string) => L[k] ?? ''
    const row = props.rtl ? 'row-reverse' : 'row'
    const hk = (k: string) => (props.columns >= HOTKEYS_FROM ? { hotkey: k } : {})
    const line = (children: RenderElement[], extra: Record<string, unknown> = {}) => Box({ flexDirection: row, columnGap: 1, flexWrap: 'nowrap', height: 1, overflow: 'hidden', ...extra, children })
    const kids: RenderElement[] = []

    // --- header: the counts, the 5-hour meter ---
    const c = props.counts
    const wide = props.columns >= HOTKEYS_FROM
    const usage = props.usage ? ` · ${Math.round(props.usage.pct) >= 80 ? '⚠' : '⏳'} 5h ${Math.round(props.usage.pct)}%` : ''
    const counts = wide
      ? `🟢 ${c.run} ${lbl('working')}${c.idle ? ` · ⏳ ${c.idle} ${lbl('idleN')}` : ''} · ✅ ${c.done} ${lbl('finished')}`
      : `🟢 ${c.run}${c.idle ? ` · ⏳ ${c.idle}` : ''} · ✅ ${c.done}`
    kids.push(line([Text({ bold: true, wrap: 'truncate', children: [cut(`🎭 ${counts}${usage}`, props.columns)] })]))

    // --- toolbar: the same keys as today's pane ---
    kids.push(line([
      Button({ key: 'showDone', ...hk('f'), plain: true, label: props.prefs.showDone ? '☑' : '☐', onPress: () => send(surface, { t: 'showDone' }) }),
      Button({ key: 'mute', ...hk('m'), plain: true, label: props.prefs.muted ? '🔕' : '🔔', onPress: () => send(surface, { t: 'mute' }) }),
      Button({ key: 'lang', ...hk('l'), plain: true, label: props.lang === 'he' ? 'EN' : 'עב', onPress: () => send(surface, { t: 'lang' }) }),
      Button({ key: 'help', ...hk('h'), plain: true, label: '?', onPress: () => send(surface, { t: 'help' }) }),
      Button({ key: 'demo', ...hk('d'), plain: true, label: props.demo ? '🎬 ✕' : '🎬', onPress: () => send(surface, { t: 'demo' }) }),
      Button({ key: 'still', ...hk('s'), plain: true, label: props.prefs.still ? '🖼' : '🎞', onPress: () => send(surface, { t: 'still' }) }),
    ]))

    // --- search: the typed text is the module's; the post waits SEARCH_DEBOUNCE_MS ---
    kids.push(line([Input({
      key: 'search',
      placeholder: cut(`🔍 ${trimEllipsis(lbl('searchPlaceholder'))}`, props.columns),
      value: inst.query,
      onInput: (v: string) => { inst.query = v; queueSearch(surface, inst, v, false) },
      onSubmit: (v: string) => { inst.query = v; queueSearch(surface, inst, v, true) },
    })]))

    // --- footer (scan notes): in the chrome, so it is seen without scrolling to the end ---
    if (props.footer) kids.push(Text({ dimColor: true, wrap: 'truncate', children: [cut(props.footer, props.columns)] }))

    // --- help popover | drawer: fixed heights, so the rows under them never move ---
    if (props.helpOpen) {
      kids.push(Box({ key: 'help', flexDirection: 'column', borderStyle: 'round', paddingX: 1, height: HELP_ROWS, overflow: 'hidden', children: [
        line([Text({ bold: true, children: [cut(lbl('helpTitle'), Math.max(1, inner - 3))] }), Button({ key: 'closeHelp', plain: true, label: '✕', onPress: () => send(surface, { t: 'help' }) })], { justifyContent: 'space-between' }),
        ...HELP.map(([k, keys]) => line([Text({ children: [cut(lbl(k), Math.max(1, inner - keys.length - 1))] }), Text({ color: 'cyan', children: [keys] })], { justifyContent: 'space-between' })),
      ] }))
    } else if (props.drawer) {
      const items: RenderElement[] = inst.drawer.map(l => {
        if (l.kind === 'name') return line([Text({ bold: true, children: [l.text] }), Button({ key: 'close', hotkey: 'x', plain: true, role: 'dismiss', label: `✕ ${lbl('close')}`, onPress: () => send(surface, { t: 'close' }) })], { justifyContent: 'space-between', alignSelf: 'stretch' })
        if (l.kind === 'chips') return line((l.chips ?? []).map(ch => Text({ inverse: true, children: [` ${ch} `] })))
        if (l.kind === 'head') return Text({ bold: true, children: [l.text] })
        if (l.kind === 'dim' || l.kind === 'note') return Text({ dimColor: true, children: [l.text] })
        return Text({ children: [l.text] })
      })
      kids.push(Box({ key: 'drawer', flexDirection: 'column', borderStyle: 'double', paddingX: 1, height: 2 + inst.drawer.length, overflow: 'hidden', alignItems: props.rtl ? 'flex-end' : 'flex-start', children: items }))
    }

    if (props.empty) {
      // --- the empty office: 🏢, the message, the sub's sentences, the demo Button ---
      const e = emptyLines(props)
      kids.push(Box({ key: 'empty', flexDirection: 'column', alignItems: 'center', marginTop: 1, children: [
        Text({ children: ['🏢'] }),
        ...e.msg.map(t => Text({ bold: true, children: [t] })),
        ...e.sub.map(t => Text({ dimColor: true, children: [t] })),
        ...(props.empty.kind === 'office' ? [Button({ key: 'watchDemo', variant: 'primary', label: lbl('watchDemo'), onPress: () => send(surface, { t: 'demo' }) })] : []),
      ] }))
    } else {
      // --- the rooms: a spacer for the rows scrolled past, then the window's rows, one Text per row, a Text per styled run ---
      const body = props.rows > 0 ? props.rows : 30
      const { from, count } = windowOf(inst.chrome, props.offset, body, layout.rows.length)
      if (from > 0) kids.push(Box({ height: from }))
      const rects = decor(s, props)
      const rows = windowRows(layout, from, count)
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!
        const runs = rowRuns(paint(r.cells, from + i, rects))
        kids.push(Text({ wrap: 'truncate', children: runs.map(run => {
          if (!run.fg && !run.bg && !run.bold && !run.dim) return run.text
          return Text({ ...(run.fg ? { color: run.fg } : {}), ...(run.bg ? { backgroundColor: run.bg } : {}), ...(run.bold ? { bold: true } : {}), ...(run.dim ? { dimColor: true } : {}), children: [run.text] })
        }) }))
      }
    }
    return Box({ flexDirection: 'column', children: kids })
  } catch (err) {
    return Text({ color: 'red', children: [`office: ${err instanceof Error ? err.message : String(err)}`] })
  }
}

export default Office
