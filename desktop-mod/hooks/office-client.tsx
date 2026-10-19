// The desktop office: ONE surface module draws the whole pane (chrome + the
// room cards) from OfficeProps, hit-tests the pointer and posts actions to the
// hooks. No `$` here: everything reaches the hooks through `surface.post`, and
// the hooks reach the module through new props (a redraw, or a `ui.message`
// hook answering `{ props }`). The chrome's pure maths (heights, the drawer's
// lines, the window) are office-chrome.ts, shared with the hooks; the view
// model and the line map are office-layout.ts.
//
// THE CARDS (docs/superpowers/specs/2026-10-19-office-cards-design.md; the
// approved probe docs/research/2026-10-19-cards-probe/register.tsx, round 7):
// the header line (bold counts at the reading edge, the dim 5h meter at the
// other), the toolbar (`הצג שסיימו ☐` · `צליל 🔔` · `הגדרות ⚙️`, gap 2), the
// search with a blank line above and below, then a framed card per room: the
// title line (the pin at the reading edge, the counts at the other edge, the
// title between them cut on a word), a dim rule, and the agents as a
// COLUMN-MAJOR table — four rigid column Boxes (status mark · who · model ·
// activity; the activity column grows), every value in a height-1 Box with
// one padding cell on the reading side, so rows align across the desktop's
// proportional font and no wrap can change a row's height. No selection band:
// the open drawer says which agent is selected; the keyboard focus is a small
// marker beside the status mark; the finish pulse a subtle tint on the row's
// cells, and ⭐ ❌ ⏰ ride the status column (office-layout.ts markOf). The
// drawer is a card in the same style; the settings popover (titled הגדרות)
// holds the demo, motion and language Buttons and the shortcuts.
//
// Geometry (spec §2 item 11, Phase 0): the engine scrolls natively over a
// Client as tall as the content (`officeHeight`); `props.offset` is the
// engine's window offset and `props.rows` the pane's body height. The module
// draws the fixed chrome, then ONE spacer Box for the lines above the window's
// first card, then only the cards the window touches: every card drawn whole
// (its frame, title, rule, more line), its agent rows only where they lie in
// the window (office-layout.ts trimWindow caps them at WINDOW_ROWS), a spacer
// Box in each column standing in for the rows above and below — the lines
// above the window lie above the viewport, which the native scroll hides. The
// settings | drawer: under the fixed chrome while the pane is at the top or
// the overlay is as tall as the window; else (office-chrome.ts
// overlayInWindow) AT THE WINDOW'S TOP — after a spacer of every line above
// the window, at Client row `offset`, so it opens in view however far the pane
// is scrolled and the cards under it stay where they were — and the card the
// window's top cuts through goes on under it from the window's first line as
// a frameless FRAGMENT (its lines from there to its bottom, the frame's bottom
// a rule, nothing of it above the window). Layout line y is Client row
// chromeRows + y either way, so a hit is `hitAt(model, x, y - chromeRows)` on
// the line map — on the window's lines only: a line past it, a row the budget
// left blank or the spacer above answers nothing. The keyboard walk (j / k)
// keeps to the agent rows drawn.
//
// Discipline (spec §7.3-7.4, Phase 0): the frame clock (`surface.every`) runs
// only while a finish pulse is active and is stopped when the last one ends;
// the render never calls `setState` (the one init aside) — what must survive
// between renders without a redraw lives in `state.inst`, a record mutated in
// place (the model, the fx list, the stamps seen, the search text); `setState`
// is called only from events (a tick, a pointer, a key). The search Input
// draws the text typed, not `props.search`, so a publish between keystrokes
// cannot reset it; the `search` post is debounced. The render is wrapped in
// try/catch and draws a short red Text instead of throwing (spec §10). The
// search text is cleaned and capped (cleanSearch) before it is drawn or
// posted; the keyboard focus (j / k) is local and never posted.
//
// The strings are drawn as the probe writes them (the desktop lays a
// Hebrew-first Text right-to-left): a labelled control reads icon-then-word
// through office-layout.ts iconLabel (the toolbar's three, the settings'
// three, the drawer's close, the glass of the search, the empty office's demo
// Button, the hooks' failed chip); a composed line (the header's counts, the
// drawer's model line and note) is one Text.

import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'

import { CHROME_ROWS, COMPACT_BELOW, DRAWER_FRAME_ROWS, HELP, HELP_ROWS, OVERLAY_GAP, WINDOW_ROWS, cleanSearch, drawerInner, drawerLines, emptyLines, labelsFit, overlayInWindow, windowOf } from './office-chrome'
import type { DrawerLine } from './office-chrome'
import { CARD_BORDER, CARD_FRAME, EMOJI_CELLS, NO_DECOR, PIN, TITLE_GAP, cut, fitLine, hitAt, iconLabel, officeModel, textWidth, trimWindow } from './office-layout'
import type { Hit, OfficeDecor, OfficeModel, RoomView, RowView } from './office-layout'
import type { OfficeMessage, OfficeProps } from './office-props'
import { usageLabel, usageShort } from './usage'

/** The brief's contract: the chrome height constant is reachable from the module too (its home is office-chrome.ts). */
export { CHROME_ROWS } from './office-chrome'

export const FX_TICK_MS = 250
export const FX_DONE_MS = 1000
export const SEARCH_DEBOUNCE_MS = 150
/** The finish pulse: the tint on the row's four cells, alternating by frame (the ⭐ itself is the props' badge). The one colour the module lays on a row. */
export const FX_BG = { done: '#3a3620', doneAlt: '#2d2a1c' } as const
/** The toolbar's gap between its Buttons (the probe's). */
export const TOOLBAR_GAP = 2

/** The letter keys (spec §6.4): the toolbar's f / m / h, the settings' d / s / l (its Buttons' letters, live with the popover closed too) and the drawer's x. */
const KEY_MESSAGES: Record<string, OfficeMessage> = {
  x: { t: 'close' }, f: { t: 'showDone' }, m: { t: 'mute' }, l: { t: 'lang' }, h: { t: 'help' }, d: { t: 'demo' }, s: { t: 'still' },
}

type Fx = { id: string; left: number }

/** What survives between renders without a redraw: mutated in place, never replaced. */
export type OfficeInst = {
  props: OfficeProps
  chrome: number
  model: OfficeModel
  /** Agent id → the line of its row. */
  rowAt: Map<string, number>
  /** The agent ids in line order. */
  order: string[]
  /** Line y → the UNPINNED room whose title line it is: the head hover. A pinned head draws its 📌 anyway, so the pointer over it sets no hoverRoom — no setState, no redraw for a change nothing would show. */
  titleAt: Map<number, string>
  /** The layout lines last drawn: [from, from + count). The pointer answers on these alone. */
  win: { from: number; count: number }
  drawerKey: string
  drawer: DrawerLine[]
  fx: Fx[]
  stop: (() => void) | null
  /** The ⭐ stamps seen per agent (null before the first props): a new stamp starts a finish pulse. */
  seen: Record<string, number> | null
  query: string
  propsSearch: string
  posted: string | null
  debounce: (() => void) | null
}
/** The local state: what a redraw reads (`setState` only from events). `hoverRoom` is the room whose title line is under the pointer. */
export type OfficeState = { hoverRoom: string | null; focus: string | null; frame: number; inst: OfficeInst }

type Surface = ClientSurface<OfficeState>

function send(surface: Surface, m: OfficeMessage): void {
  surface.post(m)
}

// ---------------------------------------------------------------------------
// the instance
// ---------------------------------------------------------------------------

/** The decor from the local state: the hovered head, the keyboard focus, the agents whose finish pulse runs. */
function decorOf(s: OfficeState): OfficeDecor {
  return { hoverRoom: s.hoverRoom, focus: s.focus, pulse: new Set(s.inst.fx.map(f => f.id)) }
}

/** The model of the props under the decor, and the indexes the events read from it (the rows' lines, their order, the unpinned heads). */
function setModel(inst: OfficeInst, p: OfficeProps, d: OfficeDecor): void {
  const model = officeModel(p, d)
  const rowAt = new Map<string, number>()
  const order: string[] = []
  const titleAt = new Map<number, string>()
  const pinned = new Set(p.rooms.filter(r => r.pinned).map(r => r.id))
  for (const room of model.rooms) {
    if (!pinned.has(room.id)) titleAt.set(room.titleAt, room.id)
    for (const row of room.rows) {
      rowAt.set(row.id, row.y)
      order.push(row.id)
    }
  }
  inst.model = model
  inst.rowAt = rowAt
  inst.order = order
  inst.titleAt = titleAt
}

function newInst(p: OfficeProps): OfficeInst {
  const inst: OfficeInst = {
    props: p, chrome: 0, model: { rooms: [], lines: [], hits: [] }, rowAt: new Map(), order: [], titleAt: new Map(), win: { from: 0, count: 0 }, drawerKey: '', drawer: [],
    fx: [], stop: null, seen: null, query: cleanSearch(p.search), propsSearch: p.search, posted: null, debounce: null,
  }
  setModel(inst, p, NO_DECOR)
  return inst
}

/** One frame of the fx clock: the pulses age by a tick, the clock stops with the last one, and the drawing is asked for. */
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

/** New pulses from the props' ⭐ stamps (the first props prime the stamps and start nothing); `still` records the stamps and drops every fx. */
function detectFx(surface: Surface, inst: OfficeInst, p: OfficeProps): void {
  const seen = inst.seen
  const next: Record<string, number> = { ...seen }
  const fresh: Fx[] = []
  const still = p.prefs.still
  for (const room of p.rooms) {
    for (const a of room.agents) {
      if (seen && !still && a.star && seen[a.id] !== a.star) fresh.push({ id: a.id, left: FX_DONE_MS })
      next[a.id] = a.star
    }
  }
  inst.seen = next
  if (still) {
    if (inst.fx.length) inst.fx = []
    if (inst.stop) { inst.stop(); inst.stop = null }
    return
  }
  if (fresh.length === 0) return
  inst.fx = [...inst.fx.filter(f => !fresh.some(g => g.id === f.id)), ...fresh]
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
      // only the window's lines answer: not the chrome, not the spacer above the window, not a line past it
      // (the row budget leaves the rows past `from + count` blank, so `y >= chrome + from + count` is nothing)
      const y = ev.y - inst.chrome
      const drawn = y >= inst.win.from && y < inst.win.from + inst.win.count
      const hit: Hit | undefined = drawn ? hitAt(inst.model, ev.x, y) : undefined
      if (ev.type === 'down') {
        if (ev.button !== 'left' || !hit) return
        if (hit.kind === 'agent') {
          if (cur.focus !== hit.id) surface.setState({ ...cur, focus: hit.id })
          send(surface, { t: 'open', id: hit.id })
        } else if (hit.kind === 'pin') {
          // the click reorders the rooms (the pinned first): the head hover goes with it, so a dim 📌 cannot ride the room to its
          // new card — the next move sets it on whatever head is then under the pointer
          if (cur.hoverRoom !== null) surface.setState({ ...cur, hoverRoom: null })
          send(surface, { t: 'pin', room: hit.id })
        } else send(surface, { t: 'roomDone', room: hit.id })   // the title's ✅ counts and the "more / hide finished" line: the room's toggle
      } else if (ev.type === 'move' || ev.type === 'leave') {
        // the unpinned room whose title line is under the pointer (its dim 📌): one setState when it changes
        const room = ev.type === 'leave' || !drawn ? null : inst.titleAt.get(y) ?? null
        if (room !== cur.hoverRoom) surface.setState({ ...cur, hoverRoom: room })
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
        // the walk keeps to the agent rows drawn (the window): a focus on a row scrolled away would show no marker,
        // and `o` would open a drawer for a row the person cannot see; past the window's last row the person scrolls
        // the pane, and a focus left above or below the window restarts from the window's first (or last) row
        const { from, count } = inst.win
        const order = inst.order.filter(id => {
          const y = inst.rowAt.get(id)
          return y !== undefined && y >= from && y < from + count
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
        if (cur.focus && inst.rowAt.has(cur.focus)) send(surface, { t: 'open', id: cur.focus })
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

const Office: ClientModule<OfficeProps, OfficeState> = (props, surface) => {
  const { Box, Text, Button, Input } = surface.elements
  try {
    // --- the instance: once ---
    let s = surface.state
    if (s === undefined) {
      listen(surface)
      s = { hoverRoom: null, focus: null, frame: 0, inst: newInst(props) }
      surface.setState(s)
    }
    const inst = s.inst
    inst.props = props

    // --- the finish pulses from the ⭐ stamps (never on the first props; nothing under `still`): before the model, which flags them ---
    detectFx(surface, inst, props)

    // --- the model: the cards, the line map, the hits (cheap: no cell is built, so no memo) ---
    setModel(inst, props, decorOf(s))
    const model = inst.model

    // --- the drawer's lines, memoised (they decide the chrome's height); the key assigned after the lines ---
    const inner = drawerInner(props.columns)
    if (props.drawer && !props.helpOpen) {
      const dk = JSON.stringify([props.columns, props.lang, props.drawer])
      if (dk !== inst.drawerKey) {
        inst.drawer = drawerLines(props.drawer, props.labels, inner)
        inst.drawerKey = dk
      }
    }
    // (the settings | drawer rows: chromeRows' overlayRows, from the memoised lines, the gap under the overlay included)
    const overlayRows = props.helpOpen ? HELP_ROWS + OVERLAY_GAP : props.drawer ? DRAWER_FRAME_ROWS + inst.drawer.length + OVERLAY_GAP : 0
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
    const rtl = props.rtl
    const row = rtl ? 'row-reverse' : 'row'
    /** The reading edge of a Box's content: the right in RTL, the left in LTR. */
    const edge = rtl ? 'flex-end' : 'flex-start'
    const wide = props.columns >= COMPACT_BELOW
    const hk = (k: string) => (wide ? { hotkey: k } : {})
    /** One line of the chrome or the overlay: a row of children, exactly one row tall. */
    const line = (children: RenderElement[], extra: Record<string, unknown> = {}) => Box({ flexDirection: row, columnGap: 1, flexWrap: 'nowrap', height: 1, overflow: 'hidden', ...extra, children })
    const kids: RenderElement[] = []

    // --- header: `🎭 עובדים 4 · ממתינים 1 · סיימו 3` (bold) at the reading edge, the 5-hour meter dim at the other edge; a
    //     blank line under it (the probe's). The words whenever they fit the line by LINE_FIT, else the icons with the
    //     counts (`🎭 🟢2 · ⏳1 · ✅3`); the meter is the full label (bar and reset clock, usage.ts) from COMPACT_BELOW
    //     columns when the whole line fits, else the short `⏳ 5h 42%` when that fits, else nothing: a meter is drawn whole
    //     or not at all, never cut in half (`5h 4…` reads as 4%) ---
    const c = props.counts
    const fit = fitLine(props.columns)
    const part = (icon: string, n: number, label: string, words: boolean): string => (words ? (rtl ? `${label} ${n}` : `${n} ${label}`) : `${icon}${n}`)
    const countsOf = (words: boolean) => `🎭 ${[part('🟢', c.run, lbl('working'), words), ...(c.idle ? [part('⏳', c.idle, lbl('idleN'), words)] : []), part('✅', c.done, lbl('finished'), words)].join(' · ')}`
    const counts = textWidth(countsOf(true)) <= fit ? countsOf(true) : countsOf(false)
    const fits = (meter: string) => textWidth(counts) + 1 + textWidth(meter) <= fit
    const full = props.usage ? usageLabel(props.usage, props.lang, props.nowMin) : ''
    const short = props.usage ? usageShort(props.usage) : ''
    const meter = props.usage ? (wide && fits(full) ? full : fits(short) ? short : '') : ''
    kids.push(Box({ key: 'header', flexDirection: row, justifyContent: 'space-between', width: '100%', height: 1, overflow: 'hidden', marginBottom: 1, children: [
      Text({ bold: true, children: [counts] }),
      ...(meter ? [Text({ dimColor: true, children: [meter] })] : []),
    ] }))

    // --- toolbar: three plain Buttons in words (the probe's: `הצג שסיימו ☐` · `צליל 🔔` · `הגדרות ⚙️`, gap 2) — the state in the
    //     icon, the word from i18n (tbDone, tbSound, tbSettings); the words whenever the three fit the line by LINE_FIT, else
    //     the icons alone (never a cut word) ---
    // (☑ while the finished are shown: the pref, or the demo, which shows them without touching it — the text cards' rule)
    const icons = [props.prefs.showDone || props.demo ? '☑' : '☐', props.prefs.muted ? '🔕' : '🔔', '⚙️']
    const worded = icons.map((icon, i) => iconLabel(icon, lbl(['tbDone', 'tbSound', 'tbSettings'][i]!), rtl))
    const tb = labelsFit(worded, props.columns, TOOLBAR_GAP) ? worded : icons
    kids.push(Box({ key: 'toolbar', flexDirection: row, gap: TOOLBAR_GAP, flexWrap: 'nowrap', height: 1, overflow: 'hidden', children: [
      Button({ key: 'showDone', ...hk('f'), plain: true, label: tb[0]!, onPress: () => send(surface, { t: 'showDone' }) }),
      Button({ key: 'mute', ...hk('m'), plain: true, label: tb[1]!, onPress: () => send(surface, { t: 'mute' }) }),
      Button({ key: 'help', ...hk('h'), plain: true, label: tb[2]!, onPress: () => send(surface, { t: 'help' }) }),
    ] }))

    // --- search: a blank line above and below (the probe's); the typed text is the module's; the post waits SEARCH_DEBOUNCE_MS.
    //     (The glass rides the word through iconLabel; the word cut to what the line leaves beside it, by LINE_FIT.) ---
    const placeholder = lbl('searchPlaceholder').replace(/…$/, '')
    kids.push(Box({ key: 'searchLine', flexDirection: row, marginTop: 1, marginBottom: 1, height: 1, overflow: 'hidden', children: [Input({
      key: 'search',
      placeholder: iconLabel('🔍', cut(placeholder, Math.max(1, fit - 3)), rtl),
      value: inst.query,
      // (cleaned and capped: a paste of a page or of an escape sequence would make the post or the value unmount the office)
      onInput: (v: string) => { inst.query = cleanSearch(v); queueSearch(surface, inst, inst.query, false) },
      onSubmit: (v: string) => { inst.query = cleanSearch(v); queueSearch(surface, inst, inst.query, true) },
    })] }))

    // --- footer (the props cap's `+N`, the scan notes): in the chrome, so it is seen without scrolling to the end; one dim line,
    //     cut to the line by LINE_FIT with an ellipsis (the height-1 Box would chop it at the edge without one) ---
    if (props.footer) kids.push(Box({ key: 'footer', flexDirection: row, height: 1, overflow: 'hidden', children: [Text({ dimColor: true, children: [cut(props.footer, Math.max(1, fit))] })] }))

    // --- settings popover | drawer: fixed heights, so the cards under them never move; pushed further down — at the window's
    //     top (THE OVERLAY IN VIEW, below), or under the fixed chrome ---
    let overlay: RenderElement | null = null
    if (props.helpOpen) {
      // the rare controls as labelled Buttons under the title (HELP_BUTTON_ROWS): the demo (✕ and the exit word while it runs), the
      // motion toggle (🎞 running, 🖼 frozen), the language (the other language's name) — their words when the three fit the
      // popover's inner width, else the icons alone (the language as EN / עב); their letters d / s / l are KEY_MESSAGES' either way
      const hIcons = [props.demo ? '🎬 ✕' : '🎬', props.prefs.still ? '🖼' : '🎞', '🌐']
      const hWords = [props.demo ? lbl('exitDemo') : lbl('demoLabel'), lbl('hbMotion'), lbl('switchTo')]
      const hWorded = hIcons.map((icon, i) => iconLabel(icon, hWords[i]!, rtl))
      // (the icons alone keep their states, as the toolbar's ☑ / 🔕 do: `🎬 ✕` while the demo runs — the pair reversed for the Hebrew
      // reader as in the worded label, iconLabel — 🖼 while frozen)
      const hb = labelsFit(hWorded, props.columns - 4) ? hWorded : [iconLabel(hIcons[0]!, '', rtl), hIcons[1]!, props.lang === 'he' ? 'EN' : 'עב']
      overlay = Box({ key: 'help', flexDirection: 'column', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, height: HELP_ROWS, marginBottom: OVERLAY_GAP, overflow: 'hidden', children: [
        line([Text({ bold: true, children: [cut(lbl('settingsTitle'), Math.max(1, inner - 3))] }), Button({ key: 'closeHelp', plain: true, label: '✕', onPress: () => send(surface, { t: 'help' }) })], { justifyContent: 'space-between' }),
        line([
          Button({ key: 'demo', ...hk('d'), plain: true, label: hb[0]!, onPress: () => send(surface, { t: 'demo' }) }),
          Button({ key: 'still', ...hk('s'), plain: true, label: hb[1]!, onPress: () => send(surface, { t: 'still' }) }),
          Button({ key: 'lang', ...hk('l'), plain: true, label: hb[2]!, onPress: () => send(surface, { t: 'lang' }) }),
        ]),
        ...HELP.map(([k, keys]) => line([Text({ children: [cut(lbl(k), Math.max(1, inner - keys.length - 1))] }), Text({ color: 'cyan', children: [keys] })], { justifyContent: 'space-between' })),
      ] })
    } else if (props.drawer) {
      // the drawer as a card in the cards' style: every line in a height-1 Box, so the rows under it never move
      const items: RenderElement[] = inst.drawer.map((l, i) => {
        // the name line: the persona (bold) at the reading edge, the close Button (read ✕ THEN the word: iconLabel) at the other
        if (l.kind === 'name') return line([
          Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, height: 1, overflow: 'hidden', justifyContent: edge, children: [Text({ bold: true, children: [l.text] })] }),
          Button({ key: 'close', hotkey: 'x', plain: true, role: 'dismiss', label: iconLabel('✕', lbl('close'), rtl), onPress: () => send(surface, { t: 'close' }) }),
        ], { justifyContent: 'space-between', width: '100%' })
        if (l.kind === 'chips') return line((l.chips ?? []).map(ch => Text({ inverse: true, children: [` ${ch} `] })))
        // every other line one Text of the text drawerLines cut or wrapped to the inner width (a composed line — the model line,
        // the ✂ note — included: its ellipsis is drawn, where the height-1 Box would chop an overflow without one)
        if (l.kind === 'head') return line([Text({ bold: true, children: [l.text] })], { key: `d${i}` })
        if (l.kind === 'dim' || l.kind === 'note') return line([Text({ dimColor: true, children: [l.text] })], { key: `d${i}` })
        return line([Text({ children: [l.text] })], { key: `d${i}` })
      })
      overlay = Box({ key: 'drawer', flexDirection: 'column', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, paddingY: 1, marginBottom: OVERLAY_GAP, width: '100%', height: DRAWER_FRAME_ROWS + inst.drawer.length, overflow: 'hidden', alignItems: edge, children: items })
    }

    if (props.empty) {
      // --- the empty office: 🏢, the message, the sub's sentences, the demo Button; no cards, so nothing to click ---
      inst.win = { from: 0, count: 0 }
      if (overlay) kids.push(overlay)
      const e = emptyLines(props)
      kids.push(Box({ key: 'empty', flexDirection: 'column', alignItems: 'center', children: [
        Text({ children: ['🏢'] }),
        ...e.msg.map(t => Text({ bold: true, children: [t] })),
        ...e.sub.map(t => Text({ dimColor: true, children: [t] })),
        ...(props.empty.kind === 'office' ? [Button({ key: 'watchDemo', variant: 'primary', label: iconLabel('▶', lbl('watchDemo').replace(/^▶ /, ''), rtl), onPress: () => send(surface, { t: 'demo' }) })] : []),
      ] }))
    } else {
      // --- the cards: the settings | drawer, a spacer, then every card the window touches, its rows windowed by line. THE
      //     OVERLAY IN VIEW (office-chrome.ts overlayInWindow): an overlay that leaves the window a row rides the window's top —
      //     after a spacer of every line above the window, at Client row `offset` — and the card the window's top cuts through
      //     goes on under it from the window's first line as a frameless FRAGMENT (its lines above `from` cannot be drawn before
      //     the overlay: they would push it above the viewport). One as tall as the window stays under the fixed chrome, before
      //     a spacer of the cards above the first drawn one, which is drawn whole: its lines above the window lie above the
      //     viewport. (A window past the content — an offset the engine never hands a Client of this height — draws its spacer
      //     alone.) ---
      const body = props.rows > 0 ? props.rows : 30
      const w0 = windowOf(inst.chrome, props.offset, body, model.lines.length, overlayRows)
      const { from, count } = trimWindow(model, w0.from, w0.count, WINDOW_ROWS)
      inst.win = { from, count }
      const hi = from + count
      const drawn = count > 0 ? model.rooms.filter(r => r.top < hi && r.top + r.height > from) : []
      const atTop = overlay !== null && overlayInWindow(overlayRows, body)
      const fragmentFirst = atTop && drawn.length > 0 && from > drawn[0]!.top
      const spacer = fragmentFirst || drawn.length === 0 ? from : drawn[0]!.top
      if (overlay && !atTop) kids.push(overlay)
      if (spacer > 0) kids.push(Box({ key: 'spacer', height: spacer }))
      if (overlay && atTop) kids.push(overlay)
      const pulseBg = s.frame % 2 === 0 ? FX_BG.done : FX_BG.doneAlt
      /** One value of the table: a height-1 Box with its padding cell on the reading side, one Text (the row's tint on the Box). */
      const cell = (text: string, style: Record<string, unknown>, r: RowView) => Box({ height: 1, ...(rtl ? { paddingLeft: 1 } : { paddingRight: 1 }), width: '100%', justifyContent: edge, ...(r.pulse ? { backgroundColor: pulseBg } : {}), children: [Text({ ...style, children: [text || ' '] })] })
      /** One column of the table: the window's rows one cell each, aligned to the reading edge, a spacer for the rows above and below. */
      const column = (rows: readonly RowView[], above: number, below: number, pick: (r: RowView) => string, style: (r: RowView) => Record<string, unknown>, grow: boolean) => Box({
        flexDirection: 'column', alignItems: edge, flexShrink: 0, flexGrow: grow ? 1 : 0, children: [
          ...(above > 0 ? [Box({ height: above })] : []),
          ...rows.map(r => cell(pick(r), style(r), r)),
          ...(below > 0 ? [Box({ height: below })] : []),
        ],
      })
      /**
       * The title line: the pin (bright pinned, dim under the pointer, a blank cell otherwise, so the title never moves), the title
       * cut on a word, the counts (the room's ✅ toggle) at the far edge; the gap the probe's (office-layout.ts TITLE_GAP: PIN_ZONE
       * and cutTitle count it).
       */
      const titleLine = (room: RoomView): RenderElement => Box({ flexDirection: row, justifyContent: 'space-between', width: '100%', height: 1, paddingX: 1, gap: TITLE_GAP, overflow: 'hidden', children: [
        Box({ flexShrink: 0, height: 1, width: EMOJI_CELLS, children: [room.pin === 'none' ? Text({ children: [' '] }) : Text({ ...(room.pin === 'dim' ? { dimColor: true } : {}), children: [PIN] })] }),
        Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, height: 1, overflow: 'hidden', justifyContent: edge, children: [Text({ bold: true, children: [room.title] })] }),
        Box({ flexShrink: 0, height: 1, children: [Text({ dimColor: true, children: [room.counts] })] }),
      ] })
      /** The dim rule under the title (the frame's bottom too, in a fragment): one line, cut by its Box. */
      const rule = (): RenderElement => Box({ height: 1, overflow: 'hidden', width: '100%', children: [Text({ dimColor: true, children: ['─'.repeat(Math.max(4, props.columns))] })] })
      /** The `▸ עוד N שסיימו` / `▸ הסתר שסיימו` line, the blank line over it as its margin (none in a fragment that starts on the line itself). */
      const moreLine = (room: RoomView, blank: boolean): RenderElement => Box({ flexDirection: row, ...(blank ? { marginTop: 1 } : {}), paddingX: 1, height: 1, overflow: 'hidden', children: [Text({ dimColor: true, children: [room.more] })] })
      /**
       * The table of a card: the window's rows as cells, a spacer per column for the rows below the window and for the `above`
       * ones (the rows above the window in a whole card; none in a fragment, which starts at the window); no row in the window:
       * one spacer of the rows it stands for.
       */
      const table = (room: RoomView, above: number): RenderElement => {
        const rows = room.rows.filter(r => r.y >= from && r.y < hi)
        const below = room.rows.filter(r => r.y >= hi).length
        if (rows.length === 0) return Box({ height: above + below })
        return Box({ flexDirection: row, width: '100%', children: [
          column(rows, above, below, r => r.status, r => ({ color: r.color }), false),
          column(rows, above, below, r => r.who, r => ({ bold: !r.dim, dimColor: r.dim }), false),
          ...(room.showModel ? [column(rows, above, below, r => r.model, () => ({ dimColor: true }), false)] : []),
          column(rows, above, below, r => r.act, r => ({ dimColor: r.dim }), true),
        ] })
      }
      /** A whole card: the frame, the title line, the rule, the table (every row of the room a cell or a spacer line), the more line. */
      const card = (room: RoomView): RenderElement => Box({ flexDirection: 'column', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, paddingY: 1, marginBottom: 1, width: '100%', overflow: 'hidden', children: [
        titleLine(room),
        rule(),
        table(room, room.rows.filter(r => r.y < from).length),
        ...(room.more ? [moreLine(room, true)] : []),
      ] })
      /**
       * The window's first card drawn from line `from` inside it (under an overlay at the window's top): a frameless column Box with
       * the frame's cells as padding, holding the card's lines from `from` on — the top padding line, the title, the rule, the rows
       * (none above `from`), the more line with its blank, the bottom padding line, the frame's bottom as a rule — each only when
       * `from` lies at or before it, the gap after the card as its margin; its height exact, so every line y sits at Client row
       * chrome + y as in a whole card. From the gap line alone, a one-row spacer.
       */
      const fragment = (room: RoomView): RenderElement => {
        const end = room.top + room.height - 1          // the gap line
        if (from >= end) return Box({ key: 'fragment', height: 1 })
        const lines: RenderElement[] = []
        if (from <= room.top + 1) lines.push(Box({ height: 1 }))
        if (from <= room.titleAt) lines.push(titleLine(room))
        if (from <= room.titleAt + 1) lines.push(rule())
        if (room.rows.some(r => r.y >= from)) lines.push(table(room, 0))
        if (room.more && from <= room.moreAt) lines.push(moreLine(room, from < room.moreAt))
        if (from <= end - 2) lines.push(Box({ height: 1 }))
        lines.push(rule())
        return Box({ key: 'fragment', flexDirection: 'column', paddingX: CARD_FRAME / 2, marginBottom: 1, width: '100%', height: end - from, overflow: 'hidden', children: lines })
      }
      drawn.forEach((room, i) => kids.push(fragmentFirst && i === 0 ? fragment(room) : card(room)))
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
