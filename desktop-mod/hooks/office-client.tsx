// The desktop office: ONE surface module draws the whole pane (chrome + rooms)
// from OfficeProps, hit-tests the pointer and posts actions to the hooks.
// No `$` here: everything reaches the hooks through `surface.post`, and the
// hooks reach the module through new props (a redraw, or a `ui.message`
// hook answering `{ props }`). The chrome's pure maths (heights, the drawer's
// lines, the window) are office-chrome.ts, shared with the hooks.
//
// Geometry (spec §2 item 11, Phase 0): the engine scrolls natively over a
// Client as tall as the content (`officeHeight`); `props.offset` is the
// engine's window offset and `props.rows` the pane's body height. The module
// draws the fixed chrome (header, toolbar, search, [footer]), then ONE spacer
// Box for the rows scrolled past, then the help popover | the drawer when one
// is open — at the top of the window (office-chrome.ts overlayInWindow: so it
// opens in view however far the pane is scrolled, the office rows under it
// staying where they were; an overlay as tall as the window stays under the
// fixed chrome, before the spacer) — then only the layout rows the window
// shows (`windowOf`, capped by a byte budget), then nothing: the tree is
// bounded by the window, not by the number of agents. Layout row y is Client
// row chromeRows + y either way, so a hit is `hitAt(layout, x, y - chromeRows)`
// on the full layout — on the rows drawn only: a row the budget left blank,
// the spacer above the window or the overlay over it answers nothing. The
// keyboard walk (j / k) keeps to the tiles drawn: a focus scrolled away is
// left for the first (or last) tile of the window.
//
// Motion (spec §7.4): the layout draws the hover, the hop and the walk-in
// from a decor the module derives from its local state (office-layout.ts
// OfficeDecor), memoised by the props AND the decor; the selection, the
// keyboard focus, the gold pulse under a hop and the status flash are
// background overlays laid on the layout's cells here.
//
// Discipline (spec §7.3-7.4, Phase 0): the frame clock (`surface.every`) runs
// only while an fx is active and is stopped when the last one ends; the render
// never calls `setState` (the one init aside) — what must survive between
// renders without a redraw lives in `state.inst`, a record mutated in place
// (the layout memo, the fx list, the stamps seen, the search text); `setState`
// is called only from events (a tick, a pointer, a key). The search Input
// draws the text typed, not `props.search`, so a publish between keystrokes
// cannot reset it; the `search` post is debounced. The render is wrapped in
// try/catch and draws a short red Text instead of throwing (spec §10). The
// search text is cleaned and capped (cleanSearch) before it is drawn or
// posted; the keyboard focus (j / k) is local and never posted.

import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'

import { CHROME_ROWS, COMPACT_BELOW, HELP, HELP_ROWS, cleanSearch, drawerLines, emptyLines, overlayInWindow, windowOf } from './office-chrome'
import type { DrawerLine } from './office-chrome'
import { NO_DECOR, TILE_H, cut, hitAt, layoutOffice, rowRuns, textWidth, windowRows } from './office-layout'
import type { Cell, Hit, OfficeDecor, OfficeLayout } from './office-layout'
import type { OfficeMessage, OfficeProps } from './office-props'
import { usageLabel, usageShort } from './usage'

/** The brief's contract: the chrome height constant is reachable from the module too (its home is office-chrome.ts). */
export { CHROME_ROWS } from './office-chrome'

export const FX_TICK_MS = 250
export const FX_ENTER_MS = 700
export const FX_DONE_MS = 1000
/** A status change flashes the desk row for this many frames of the fx clock. */
export const FX_STATUS_FRAMES = 2
export const SEARCH_DEBOUNCE_MS = 150
/**
 * The background highlights the module lays over the layout's cells: the selection and the keyboard
 * focus (the head row), the gold pulse under a hop (the head row, alternating by frame) and the status
 * flash (the desk row). The hover and the motion are the layout's (office-layout.ts HOVER_BG, OfficeDecor).
 */
export const FX_BG = {
  focus: '#3b4f8a', selected: '#4a3f8a',
  done: '#8a6a10', doneAlt: '#5a4a10', status: '#4b5563',
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
  /** The layout rows last drawn: [from, from + count). The pointer answers on these alone. */
  win: { from: number; count: number }
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

type Surface = ClientSurface<OfficeState>

function send(surface: Surface, m: OfficeMessage): void {
  surface.post(m)
}

// ---------------------------------------------------------------------------
// the instance
// ---------------------------------------------------------------------------

/** The layout's memo key: the props that shape it and the decor laid on it. */
function layoutKeyOf(p: OfficeProps, d: OfficeDecor): string {
  return JSON.stringify([p.columns, p.rtl, p.selected, p.rooms, d.hover, [...d.hop], [...d.entering]])
}

/**
 * The decor from the local state: the hover, the tiles hopping (a `done` fx) and each walk-in's
 * progress, 0 when its `enter` fx starts → 1 at FX_ENTER_MS (`1 - left / FX_ENTER_MS`).
 */
function decorOf(s: OfficeState): OfficeDecor {
  const hop = new Set<string>()
  const entering = new Map<string, number>()
  for (const f of s.inst.fx) {
    if (f.kind === 'done') hop.add(f.id)
    else if (f.kind === 'enter') entering.set(f.id, 1 - f.left / FX_ENTER_MS)
  }
  return { hover: s.hover, hop, entering }
}

/** The layout memo: computed first, the key assigned last, so a throw never leaves a stale layout under a new key. */
function setLayout(inst: OfficeInst, p: OfficeProps, d: OfficeDecor, key: string): void {
  const layout = layoutOffice(p, d)
  const hitById = new Map<string, Hit>()
  const order: string[] = []
  for (const hit of layout.hits) {
    if (hit.kind !== 'agent') continue
    hitById.set(hit.id, hit)
    order.push(hit.id)
  }
  inst.layout = layout
  inst.hitById = hitById
  inst.order = order
  inst.layoutKey = key
}

function newInst(p: OfficeProps): OfficeInst {
  const inst: OfficeInst = {
    props: p, chrome: 0, layoutKey: '', layout: { rows: [], hits: [] }, hitById: new Map(), order: [], win: { from: 0, count: 0 }, drawerKey: '', drawer: [],
    fx: [], stop: null, seen: null, query: cleanSearch(p.search), propsSearch: p.search, posted: null, debounce: null,
  }
  setLayout(inst, p, NO_DECOR, layoutKeyOf(p, NO_DECOR))
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
      // only the rows drawn answer: not the chrome, not the spacer above the window, not a row past it
      // (the byte budget leaves the rows past `from + count` blank, so `y >= chrome + from + count` is nothing)
      const y = ev.y - inst.chrome
      const hit = y >= inst.win.from && y < inst.win.from + inst.win.count ? hitAt(inst.layout, ev.x, y) : undefined
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
        // the walk keeps to the tiles whose head row is drawn (the window): a focus on a tile scrolled away would show no
        // highlight, and `o` would open a drawer for a tile the person cannot see; past the window's last tile the person
        // scrolls the pane, and a focus left above or below the window restarts from the window's first (or last) tile
        const { from, count } = inst.win
        const order = inst.order.filter(id => {
          const hit = inst.hitById.get(id)
          return hit !== undefined && hit.y >= from && hit.y < from + count
        })
        if (order.length === 0) return
        const d = k === 'j' || k === 'down' ? 1 : -1
        const i = cur.focus ? order.indexOf(cur.focus) : -1
        const n = i < 0 ? (d > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, i + d))
        const id = order[n]!
        if (id === cur.focus) return
        // local only: one post per frame, so a `focus` post could displace a meaningful one (a click's `open`)
        surface.setState({ ...cur, focus: id })
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

/**
 * The highlights laid over the layout's cells: the selection and the keyboard focus (the head row),
 * the gold pulse under a hop (the head row, by frame parity: the ⭐ itself is the layout's) and the
 * status flash (the desk row). The walk-in is motion alone (the layout's), no colour.
 */
function overlays(s: OfficeState, p: OfficeProps): Rect[] {
  const inst = s.inst
  const rects: Rect[] = []
  const head = (id: string | null, bg: string) => {
    const hit = id ? inst.hitById.get(id) : undefined
    if (hit) rects.push({ x: hit.x, w: hit.w, y: hit.y, bg })
  }
  head(p.selected, FX_BG.selected)
  head(s.focus, FX_BG.focus)
  for (const f of inst.fx) {
    const hit = inst.hitById.get(f.id)
    if (!hit) continue
    if (f.kind === 'done') rects.push({ x: hit.x, w: hit.w, y: hit.y, bg: s.frame % 2 === 0 ? FX_BG.done : FX_BG.doneAlt })
    else if (f.kind === 'status') rects.push({ x: hit.x, w: hit.w, y: Math.min(hit.y + 1, hit.y + TILE_H - 1), bg: FX_BG.status })
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

    // --- event fx from the stamps (never on the first props; nothing under `still`): before the layout, which draws them ---
    detectFx(surface, inst, props)

    // --- the layout, memoised by the props that shape it and the decor laid on it (hover, hop, walk-in) ---
    const decor = decorOf(s)
    const key = layoutKeyOf(props, decor)
    if (key !== inst.layoutKey) setLayout(inst, props, decor, key)
    const layout = inst.layout

    // --- the drawer's lines, memoised too (they decide the chrome's height); the key assigned after the lines ---
    const inner = Math.max(1, props.columns - 4)
    if (props.drawer && !props.helpOpen) {
      const dk = JSON.stringify([props.columns, props.lang, props.drawer])
      if (dk !== inst.drawerKey) {
        inst.drawer = drawerLines(props.drawer, props.labels, inner)
        inst.drawerKey = dk
      }
    }
    // (the help | drawer rows: chromeRows' overlayRows, from the memoised lines)
    const overlayRows = props.helpOpen ? HELP_ROWS : props.drawer ? 2 + inst.drawer.length : 0
    inst.chrome = CHROME_ROWS + (props.footer ? 1 : 0) + overlayRows

    // --- the search text: ours unless the hooks changed it from outside (not our own echo); cleaned either way ---
    if (props.search !== inst.propsSearch) {
      const outside = props.search !== inst.posted && props.search !== inst.query
      inst.propsSearch = props.search
      if (outside) {
        inst.query = cleanSearch(props.search)
        if (inst.debounce) { inst.debounce(); inst.debounce = null }
      }
    }

    const L = props.labels
    const lbl = (k: string) => L[k] ?? ''
    const row = props.rtl ? 'row-reverse' : 'row'
    const wide = props.columns >= COMPACT_BELOW
    const hk = (k: string) => (wide ? { hotkey: k } : {})
    const line = (children: RenderElement[], extra: Record<string, unknown> = {}) => Box({ flexDirection: row, columnGap: 1, flexWrap: 'nowrap', height: 1, overflow: 'hidden', ...extra, children })
    const kids: RenderElement[] = []

    // --- header: the counts, the 5-hour meter. The meter is the full label (bar and reset clock, usage.ts) from
    //     COMPACT_BELOW columns when the whole line fits, else the short `⏳ 5h 42%` when that fits (it keeps `5h`:
    //     the idle count is a `⏳` too), else nothing: a meter is drawn whole or not at all, never cut in half (`5h 4…`
    //     reads as 4%) — the same rule as the text cards' header (ui.tsx) ---
    const c = props.counts
    const counts = wide
      ? `🟢 ${c.run} ${lbl('working')}${c.idle ? ` · ⏳ ${c.idle} ${lbl('idleN')}` : ''} · ✅ ${c.done} ${lbl('finished')}`
      : `🟢 ${c.run}${c.idle ? ` · ⏳ ${c.idle}` : ''} · ✅ ${c.done}`
    const head = `🎭 ${counts}`
    const fits = (meter: string) => textWidth(head + meter) <= props.columns
    const full = props.usage ? ` · ${usageLabel(props.usage, props.lang, props.nowMin)}` : ''
    const short = props.usage ? ` · ${usageShort(props.usage)}` : ''
    const meter = props.usage ? (wide && fits(full) ? full : fits(short) ? short : '') : ''
    kids.push(line([Text({ bold: true, wrap: 'truncate', children: [cut(head + meter, props.columns)] })]))

    // --- toolbar: the same keys as today's pane ---
    kids.push(line([
      // (☑ while the finished are shown: the pref, or the demo, which shows them without touching it — the text cards' rule)
      Button({ key: 'showDone', ...hk('f'), plain: true, label: props.prefs.showDone || props.demo ? '☑' : '☐', onPress: () => send(surface, { t: 'showDone' }) }),
      Button({ key: 'mute', ...hk('m'), plain: true, label: props.prefs.muted ? '🔕' : '🔔', onPress: () => send(surface, { t: 'mute' }) }),
      Button({ key: 'lang', ...hk('l'), plain: true, label: props.lang === 'he' ? 'EN' : 'עב', onPress: () => send(surface, { t: 'lang' }) }),
      Button({ key: 'help', ...hk('h'), plain: true, label: '?', onPress: () => send(surface, { t: 'help' }) }),
      Button({ key: 'demo', ...hk('d'), plain: true, label: props.demo ? '🎬 ✕' : '🎬', onPress: () => send(surface, { t: 'demo' }) }),
      Button({ key: 'still', ...hk('s'), plain: true, label: props.prefs.still ? '🖼' : '🎞', onPress: () => send(surface, { t: 'still' }) }),
    ]))

    // --- search: the typed text is the module's; the post waits SEARCH_DEBOUNCE_MS ---
    const placeholder = lbl('searchPlaceholder')
    kids.push(line([Input({
      key: 'search',
      placeholder: cut(`🔍 ${placeholder.endsWith('…') ? placeholder.slice(0, -1) : placeholder}`, props.columns),
      value: inst.query,
      // (cleaned and capped: a paste of a page or of an escape sequence would make the post or the value unmount the office)
      onInput: (v: string) => { inst.query = cleanSearch(v); queueSearch(surface, inst, inst.query, false) },
      onSubmit: (v: string) => { inst.query = cleanSearch(v); queueSearch(surface, inst, inst.query, true) },
    })]))

    // --- footer (scan notes): in the chrome, so it is seen without scrolling to the end ---
    if (props.footer) kids.push(Text({ dimColor: true, wrap: 'truncate', children: [cut(props.footer, props.columns)] }))

    // --- help popover | drawer: fixed heights, so the rows under them never move; pushed further down — at the window's
    //     top, or under the fixed chrome ---
    let overlay: RenderElement | null = null
    if (props.helpOpen) {
      overlay = Box({ key: 'help', flexDirection: 'column', borderStyle: 'round', paddingX: 1, height: HELP_ROWS, overflow: 'hidden', children: [
        line([Text({ bold: true, children: [cut(lbl('helpTitle'), Math.max(1, inner - 3))] }), Button({ key: 'closeHelp', plain: true, label: '✕', onPress: () => send(surface, { t: 'help' }) })], { justifyContent: 'space-between' }),
        ...HELP.map(([k, keys]) => line([Text({ children: [cut(lbl(k), Math.max(1, inner - keys.length - 1))] }), Text({ color: 'cyan', children: [keys] })], { justifyContent: 'space-between' })),
      ] })
    } else if (props.drawer) {
      const items: RenderElement[] = inst.drawer.map(l => {
        // (the row takes the drawer's full width so `space-between` parts the name and the ✕: `alignSelf: 'stretch'` is not a value the desktop's Box takes)
        if (l.kind === 'name') return line([Text({ bold: true, children: [l.text] }), Button({ key: 'close', hotkey: 'x', plain: true, role: 'dismiss', label: `✕ ${lbl('close')}`, onPress: () => send(surface, { t: 'close' }) })], { justifyContent: 'space-between', width: '100%' })
        if (l.kind === 'chips') return line((l.chips ?? []).map(ch => Text({ inverse: true, children: [` ${ch} `] })))
        if (l.kind === 'head') return Text({ bold: true, children: [l.text] })
        if (l.kind === 'dim' || l.kind === 'note') return Text({ dimColor: true, children: [l.text] })
        return Text({ children: [l.text] })
      })
      overlay = Box({ key: 'drawer', flexDirection: 'column', borderStyle: 'double', paddingX: 1, height: 2 + inst.drawer.length, overflow: 'hidden', alignItems: props.rtl ? 'flex-end' : 'flex-start', children: items })
    }

    if (props.empty) {
      // --- the empty office: 🏢, the message, the sub's sentences, the demo Button; no rows, so nothing to click ---
      inst.win = { from: 0, count: 0 }
      if (overlay) kids.push(overlay)
      const e = emptyLines(props)
      kids.push(Box({ key: 'empty', flexDirection: 'column', alignItems: 'center', marginTop: 1, children: [
        Text({ children: ['🏢'] }),
        ...e.msg.map(t => Text({ bold: true, children: [t] })),
        ...e.sub.map(t => Text({ dimColor: true, children: [t] })),
        ...(props.empty.kind === 'office' ? [Button({ key: 'watchDemo', variant: 'primary', label: lbl('watchDemo'), onPress: () => send(surface, { t: 'demo' }) })] : []),
      ] }))
    } else {
      // --- the rooms: a spacer for the rows scrolled past, the help | drawer at the window's top (THE OVERLAY IN VIEW,
      //     office-chrome.ts; one as tall as the window before the spacer, under the fixed chrome), then the window's
      //     rows, one Text per row, a Text per styled run ---
      const body = props.rows > 0 ? props.rows : 30
      const { from, count } = windowOf(inst.chrome, props.offset, body, layout.rows.length, props.columns, overlayRows)
      inst.win = { from, count }
      const atTop = overlayInWindow(overlayRows, body)
      if (overlay && !atTop) kids.push(overlay)
      if (from > 0) kids.push(Box({ height: from }))
      if (overlay && atTop) kids.push(overlay)
      const rects = overlays(s, props)
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
    // nothing of the office is drawn now: the pointer must not hit-test the window of the last good render
    const st = surface.state
    if (st) st.inst.win = { from: 0, count: 0 }
    return Text({ color: 'red', children: [`office: ${err instanceof Error ? err.message : String(err)}`] })
  }
}

export default Office
