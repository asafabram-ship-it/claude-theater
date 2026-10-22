// The desktop office: ONE surface module draws the whole pane (chrome + the
// room cards) from OfficeProps and posts the person's actions to the hooks —
// every click a native Button's press (phase B). No `$` here: everything
// reaches the hooks through `surface.post`, and the hooks reach the module
// through new props (a redraw, or a `ui.message` hook answering `{ props }`).
// The chrome's pure maths (heights, the drawer's lines, the window) are
// office-chrome.ts, shared with the hooks; the view model, the geometry, the
// table mode and the line map are office-layout.ts.
//
// THE CARDS (docs/superpowers/specs/2026-10-19-office-cards-design.md; the
// approved probe docs/research/2026-10-19-cards-probe/register.tsx, round 9;
// phase B: its "Paint probe" and "Phase B, decided" sections — decision 26 of
// the client-office spec): the header line (bold counts at the reading edge,
// the dim 5h meter at the other), the toolbar (`הצג שסיימו ☐` · `צליל 🔔` ·
// `הגדרות ⚙️`, gap 2) — the search field beside it on the same line from
// ONE_LINE_FROM columns, under it on a line of its own below that, and only
// while the office holds more than SEARCH_FROM agents or a search is active —
// then a framed card per room: the title line (THE PIN: a plain Button on
// EVERY title — the colour 📌 of a pinned room, the monochrome 📌︎ (PIN_OFF,
// VS15) otherwise, one width either way, so the title never moves and nothing
// is revealed on hover: none draws inside a Client on the desktop — then the
// title flush at the reading edge, the read-only counts at the other edge, the
// title cut on a word), under it the room's ONE finished toggle (`עוד 2 שסיימו
// ◂` / `הסתר שסיימו ▾`, the arrow at the string's end — office-layout.ts
// MORE_MARK, iconLabel — only past RECENT_DONE finished: live check 7, Q3 + Q6;
// a plain Button of regular weight), a BLANK line (no rule), and the agents as
// a COLUMN-MAJOR table — rigid column Boxes (status mark · who · [model] ·
// activity emoji · [activity word] · [task]), the padding cell on the column's
// reading side, every value ONE line with no plain space in it
// (office-layout.ts nb: a value a little too long is clipped at the card's
// edge, never wrapped onto a second line — the desktop does not enforce
// `wrap: 'truncate'`), so rows align across the desktop's proportional font and
// no wrap can change a row's height. The status mark is a coloured Text; every
// other value is a plain Button whose one Text child carries the row's weights
// — inside a Button the desktop keeps bold and dim alone (colour, underline
// and italic are lost there: paint probe 22.10), and a native Button hits right
// at any depth, where a y hit-test did not — so a row costs the desktop the
// mark's Text and a Button-with-Text pair per value column, and no Box (THE
// RENDER COST: office-client.test.ts guards the node count per row and per
// card). THE WIDTH (probe rounds 8-9, office-layout.ts geometry): one reading
// column, the pane less a cell at each edge (PANE_GUTTER, live check 6: the
// Client lays out a hair wider than the visible pane, and the cards' right
// border was clipped) up to a frozen 100-cell column, centred by a left
// margin; the TABLE MODE decided once per render for the whole
// office with two cells of hysteresis while the pane is dragged — the last
// mode's token (its rank and the widest values it was chosen from) lives in
// the instance (`inst.lastMode`), never in the props; a change of content
// that moves the widest values chooses the mode afresh (office-layout.ts
// ModeToken) — and the columns aligned across the cards by minWidth floors
// from WIDE_FROM; the dim task column from CENTRE_AT. THE LABEL LADDER of the
// chrome, by LINE_FIT — what gives way as the pane narrows, in order: the full
// meter (from WIDE_FROM) → the header's words → the toolbar's words → the
// short meter (in the header, else at the search line's far edge) → the tiny
// meter → no meter (under 25 cells); so the header's words go before the
// short meter does, and a meter is drawn whole or not at all. Hierarchy by
// weight, not colour: working = a bold
// name; waiting = a regular name, a dim activity word; finished = all dim; a ❌
// row keeps a regular name; the status mark is the one coloured glyph. No
// selection band: the open drawer says which agent is selected; the keyboard
// focus is a small marker on the inner side of the status mark (the mark stays
// at the reading edge); ⭐ ❌ ⏰ ride the status column (office-layout.ts
// markOf) — the ⭐ is the whole finish: no tint on the row (live check 6: the
// tint flashed a near-black band on the light theme), so the module lays no
// background on anything of the column (the floating overlay's is the theme's,
// below). The drawer is a card
// in the same style with ONE dim status line (`● עובד · זמן 12 דק׳ · Explore`)
// and a blank line before its content; the settings popover (titled הגדרות)
// holds the demo and language Buttons (no motion toggle: nothing read it — live
// check 7, Q9) and the shortcuts as a
// column-major label | key table, two pairs side by side from WIDE_FROM — and,
// while the scan skips a transcript too long to read, THE TOO-LONG
// CONVERSATIONS NOTE as its last line (live check 6: once the footer's
// `דולגו 1 תמלילים גדולים מדי`, unclear on the main screen).
// While the demo runs, THE DEMO LINE (live check 5) is the first line under
// the header — `🎬 זו הדגמה - הסוכנים לא אמיתיים` and its exit Button — so the
// demo's cast is never taken for the office (the chrome a row taller:
// office-chrome.ts DEMO_ROWS).
//
// Geometry (spec §2 item 11, Phase 0; phase B, decision 26): the engine
// scrolls natively over a Client as tall as the content (`officeHeight`);
// `props.offset` is the engine's window offset — clamped to the content (live
// check 7: a press that shortened the office hands the old offset until the
// engine asks again, and every redraw until then keeps the clamp) — and
// `props.rows` the pane's body height. THE WINDOW WITH OVERSCAN: on the desktop
// a card frame's border rows are half a cell (paint probe 22.10: six frames
// above a row put the engine's y, the scroll offset and an absolute Box's top
// about six rows off the drawn lines), so a window computed from the offset
// starts about a card too early or too late; the module therefore draws every
// line while the office has at most WINDOW_ROWS lines, and otherwise up to a
// body of lines on each side of the window the offset names, capped so the
// window never passes WINDOW_ROWS lines (office-chrome.ts overscanOf, windowOf:
// the drift is about a line per card above the window, so sixteen lines on a
// 39-row body cover sixteen cards; the serialized tree stays under the
// engine's bound) — the drift can never leave a blank row in view — and the
// row budget (office-layout.ts trimWindow, WINDOW_ROWS) still caps the agent
// rows. The module draws the fixed chrome, then ONE spacer Box for the
// lines above the first card drawn, then only the cards the window touches:
// every card drawn whole (its frame, title, more line, blank line), its agent
// rows only where they lie in the window, a spacer Box in each table standing
// in for the rows above and below — the lines above the window lie above the
// viewport, which the native scroll hides. THE FLOATING OVERLAY: the settings |
// drawer is ONE absolute Box from the root — `position: 'absolute'` at
// `top: max(offset, chrome)` (the engine lays an absolute Box against the root
// in its own cells, as the offset is: it sits at the visible window's top
// however far the pane is scrolled, under the fixed chrome at the top), at the
// reading column's margin and width, on `backgroundColor: 'inverseText'` (the
// theme's: it hides the rows under it on the light and the dark pane alike,
// where a raw colour tinted the light one), its fixed height per width — so it
// takes no row of the flow (chromeRows no longer counts it, officeHeight
// shrank by it) and nothing under it moves when it opens; painted after the
// column, as the root's last child. The keyboard walk (j / k) keeps to the
// agent rows drawn, and `o` opens the focus only while its row is among them.
//
// The clicks (phase B, decision 26 — live check 7's "the buttons are not
// smooth" was the y drift above): every click is a native plain Button — the
// row's cells (who, model, emoji, word, task: a press opens the agent's drawer,
// or closes it when it is the open one — a close, never a flip in the hooks),
// the pin on every title, the more line, the closes (`role: 'dismiss'`), the
// toolbar's and the settings' — so nothing is hit-tested by y and the pointer's
// x is never read; the pointer is read for ONE thing, its `leave` (it reaches
// the module without a Button): a pin press keeps the cards in the order drawn
// until the pointer leaves the office (THE PIN'S PLACE, `inst.frozen`: the
// colour 📌 at once, the card to the top then — never a jump under the
// pointer); no hover of any kind draws inside a Client on the desktop, so none
// is kept. The demo's switches post their target; an Enter that follows typing
// in the search is the field's (`inst.typing`), o and an Enter after a press
// or a walk key open the focus.
//
// Discipline (spec §7.3-7.4, Phase 0): no clock runs but the search's debounce
// and THE OUTBOX's clearing (`surface.every`, one-shots started from events:
// every post is a batch of the frame's actions, each numbered once — live check
// 7, R12); the render never calls `setState` (the one
// init aside) — what must survive between renders without a redraw lives in
// `state.inst`, a record mutated in place (the model, the mode's rank, the
// search text); `setState` is called only from events (a press, a key, the
// pointer's leave). The
// search Input draws the text typed, not `props.search`, so a publish between
// keystrokes cannot reset it; the `search` post is debounced. The render is
// wrapped in try/catch and draws a short red Text instead of throwing (spec
// §10). The search text is cleaned and capped (cleanSearch) before it is drawn
// or posted; the keyboard focus (j / k) is local and never posted. The field
// is drawn while the office holds more than SEARCH_FROM agents (its counts,
// whatever the finished toggles show: live check 7) or a search is active — text in the field (office-chrome.ts searchShown: `props.search`, or
// the text typed and not yet posted, `inst.query`), so a poll that drops the
// count mid-word never unmounts the field under the person's fingers; the
// first keystroke of a search posts at once, since under ONE_LINE_FROM the
// hooks size the chrome by `props.search`.
//
// The strings are drawn as the probe writes them (the desktop lays a
// Hebrew-first Text right-to-left): a labelled control reads icon-then-word
// through office-layout.ts iconLabel (the toolbar's three, the settings'
// three, the drawer's close, the empty office's demo Button, the cards' more /
// hide line — officeModel lays that one); the search's
// placeholder is the probe's `🔍 חיפוש סוכנים` (the glass leading); a composed
// line (the header's counts, the drawer's status and model lines and note) is
// one Text.

import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'

import { COMPACT_BELOW, DRAWER_FRAME_ROWS, WINDOW_ROWS, cleanSearch, demoLine, drawerInner, drawerLimits, drawerLines, drawerPad, emptyLines, fixedRows, helpPairs, helpRows, labelsFit, overscanOf, searchShown, windowOf } from './office-chrome'
import type { DrawerLine } from './office-chrome'
import { CARD_BORDER, FIT, NBSP, NO_DECOR, PIN, PIN_OFF, TITLE_GAP, cut, fitCells, fitLine, geometry, iconLabel, nb, officeModel, roomCache, textWidth, trimWindow } from './office-layout'
import type { Floors, Geo, ModeToken, OfficeDecor, OfficeModel, RoomCache, RoomView, RowView } from './office-layout'
import type { OfficeBatch, OfficeItem, OfficeMessage, OfficeProps } from './office-props'
import { usageLabel, usageShort, usageTiny } from './usage'

export const SEARCH_DEBOUNCE_MS = 150
/**
 * THE OUTBOX (live check 7, R12): the engine delivers one post per frame — a later post in the same frame replaces an
 * undelivered one, so two clicks a few ms apart (or a click and the search's debounce) lost the first. Every post is
 * therefore a batch, `{ t: 'batch', i, items }`: the instance's id and the actions of the outbox, each numbered once, so a
 * later post carries the earlier actions too and the hooks apply each number once (ui.tsx applyOfficeMessage). A one-shot
 * clock clears the outbox on the next frame (OUTBOX_FLUSH_MS); it never holds more than OUTBOX_MAX actions.
 */
export const OUTBOX_FLUSH_MS = 1
export const OUTBOX_MAX = 8
/** The toolbar's gap between its Buttons (the probe's). */
export const TOOLBAR_GAP = 2
/** The search field on the toolbar's line (from ONE_LINE_FROM): its width in cells, between these, after the toolbar's cells. */
export const INPUT_MIN = 12
export const INPUT_MAX = 30
/** The gap between the two settings pairs (from WIDE_FROM). */
export const PAIRS_GAP = 4
/** The demo line's note colour: amber, so the demo is never taken for the office (the status column's waiting amber, DOT_FG.stale). */
export const DEMO_FG = '#d29922'

/** The letter keys (spec §6.4): the toolbar's f / m / h, the settings' l (its Button's letter, live with the popover closed too) and the drawer's x; `d` — the demo, to its target — is onKey's own; no `s` (the motion toggle is gone: live check 7, Q9). */
const KEY_MESSAGES: Record<string, OfficeMessage> = {
  x: { t: 'close' }, f: { t: 'showDone' }, m: { t: 'mute' }, l: { t: 'lang' }, h: { t: 'help' },
}

/** What survives between renders without a redraw: mutated in place, never replaced. */
export type OfficeInst = {
  props: OfficeProps
  /** The fixed chrome's rows (fixedRows and the footer): the Client row the layout's line 0 starts at. The overlay floats and takes none. */
  chrome: number
  model: OfficeModel
  /** THE HYSTERESIS: the table mode last chosen — its rank and the widest values it was chosen from (office-layout.ts ModeToken), null before the first model. Never in the props. */
  lastMode: ModeToken | null
  /** Agent id → the line of its row. */
  rowAt: Map<string, number>
  /** The agent ids in line order. */
  order: string[]
  /** The window last drawn: [from, from + count) — the lines whose agent rows are drawn (the overscan included, the row budget's cut applied): what the keyboard walk keeps to. */
  win: { from: number; count: number }
  /** THE ROOM MEMO (office-layout.ts roomCache): a room's texts are measured again only when its props, the width or the mode changed. */
  cache: RoomCache
  /**
   * THE PIN'S PLACE (live check 7, Q4): the rooms' order as drawn when a pin was pressed, kept until the pointer leaves the
   * office — the pinned card shows its colour 📌 at once but moves to the top only then, so a second press on the same Button
   * is the same pin (it once jumped to the top under the pointer, and the cell became another card's row). Null: the props' order.
   */
  frozen: string[] | null
  drawerKey: string
  drawer: DrawerLine[]
  query: string
  propsSearch: string
  posted: string | null
  debounce: (() => void) | null
  /** The Client rows of the content last drawn under an offset of its own (chrome and layout lines) — kept, the taller, while the offset handed is stale: what tells a stale offset (THE STALE OFFSET, R13). */
  height: number
  /** Text was typed into the search field since the last press or walk key: an Enter onKey sees then is the field's (R14). */
  typing: boolean
  /** THE OUTBOX: this instance's id (the hooks number its actions apart from another instance's), the last number given, the actions not yet cleared, the clock that clears them. */
  id: string
  seq: number
  outbox: OfficeItem[]
  flush: (() => void) | null
}
/** The local state: what a redraw reads (`setState` only from events). `focus` is the keyboard focus (j / k): the one decor the model lays. */
export type OfficeState = { focus: string | null; inst: OfficeInst }

type Surface = ClientSurface<OfficeState>

/** Posts `m` through THE OUTBOX: numbered, added to the frame's actions, the whole outbox posted (a later post in the same frame carries this one); the outbox cleared on the next frame. */
function send(surface: Surface, inst: OfficeInst, m: OfficeMessage): void {
  inst.seq += 1
  inst.outbox.push({ ...m, n: inst.seq })
  if (inst.outbox.length > OUTBOX_MAX) inst.outbox.splice(0, inst.outbox.length - OUTBOX_MAX)
  const batch: OfficeBatch = { t: 'batch', i: inst.id, items: [...inst.outbox] }
  surface.post(batch)
  if (inst.flush) return
  const stop = surface.every(OUTBOX_FLUSH_MS, () => {
    stop()
    inst.flush = null
    inst.outbox = []
  })
  inst.flush = stop
}

// --- the presses: every click in the office is a native plain Button's (phase B, decision 26); each makes the keyboard's Enter the
//     office's again (R14: an Enter after a press opens the focus, not the search field) ---

/** A row cell's press: the agent's drawer opens — or closes when it is the open one (live check 7, Q2: a close, never a flip in the hooks); the keyboard focus follows the press; an Enter after it is the office's again (R14). */
function pressAgent(surface: Surface, id: string): void {
  const cur = surface.state
  if (!cur) return
  const inst = cur.inst
  inst.typing = false
  if (cur.focus !== id) surface.setState({ ...cur, focus: id })
  send(surface, inst, inst.props.drawer?.id === id ? { t: 'close' } : { t: 'open', id })
}
/** The pin Button's press: THE PIN'S PLACE (Q4) — the rooms keep the order drawn now until the pointer leaves the office (the pinned card moves to the top then, never under the pointer); the answer's props draw the colour 📌 on the same Button, one width with the monochrome one: no reflow. */
function pressPin(surface: Surface, room: string): void {
  const cur = surface.state
  if (!cur) return
  const inst = cur.inst
  inst.typing = false
  inst.frozen ??= inst.model.rooms.map(r => r.id)
  send(surface, inst, { t: 'pin', room })
}
/** The more / hide line's press: the room's one finished toggle (Q3, Q6). */
function pressMore(surface: Surface, room: string): void {
  const cur = surface.state
  if (!cur) return
  cur.inst.typing = false
  send(surface, cur.inst, { t: 'roomDone', room })
}

// ---------------------------------------------------------------------------
// the instance
// ---------------------------------------------------------------------------

/**
 * THE PIN'S PLACE (live check 7, Q4): the props with their rooms in `order` (the order drawn when a pin was pressed) — a room
 * not in it after those, in the props' order; one no longer in the props dropped. Null: the props as they are.
 */
export function inOrder(p: OfficeProps, order: readonly string[] | null): OfficeProps {
  if (!order) return p
  const at = new Map(order.map((id, i) => [id, i]))
  const key = (id: string, i: number) => at.get(id) ?? order.length + i
  const rooms = p.rooms.map((r, i) => ({ r, k: key(r.id, i) })).sort((a, b) => a.k - b.k).map(x => x.r)
  return rooms.every((r, i) => r === p.rooms[i]) ? p : { ...p, rooms }
}

/** The decor from the local state: the keyboard focus (no hover: the desktop draws none inside a Client — paint probe 22.10). */
function decorOf(s: OfficeState): OfficeDecor {
  return { focus: s.focus }
}

/** The model of the props under the decor (the table mode from the last one's token: the hysteresis), and the indexes the keys read from it (the rows' lines, their order). */
function setModel(inst: OfficeInst, p: OfficeProps, d: OfficeDecor): void {
  const model = officeModel(p, d, inst.cache, inst.lastMode)
  inst.lastMode = model.token
  const rowAt = new Map<string, number>()
  const order: string[] = []
  for (const room of model.rooms) {
    for (const row of room.rows) {
      rowAt.set(row.id, row.y)
      order.push(row.id)
    }
  }
  inst.model = model
  inst.rowAt = rowAt
  inst.order = order
}

function newInst(p: OfficeProps): OfficeInst {
  const inst: OfficeInst = {
    props: p, chrome: 0, model: { rooms: [], lines: [], geo: geometry(p.columns), mode: { rank: 0, word: true, model: 'family', nameMax: 0 }, token: { rank: 0, key: '' }, floors: null, statusMin: 0 }, lastMode: null, frozen: null,
    rowAt: new Map(), order: [], win: { from: 0, count: 0 }, cache: roomCache(), drawerKey: '', drawer: [],
    query: cleanSearch(p.search), propsSearch: p.search, posted: null, debounce: null, typing: false, height: 0,
    id: Math.random().toString(36).slice(2, 10) || 'office', seq: 0, outbox: [], flush: null,
  }
  setModel(inst, p, NO_DECOR)
  return inst
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
  send(surface, inst, { t: 'search', q })
}

function listen(surface: Surface): void {
  surface.onPointer(ev => {
    try {
      // every click is a native Button's press (phase B, decision 26: the engine's y drifts a row per card against the drawn
      // rows); the pointer is read for one thing — its LEAVE releases THE PIN'S PLACE, so a pinned card moves to the top
      // only once the pointer is out of the office
      if (ev.type !== 'leave') return
      const cur = surface.state
      if (!cur || cur.inst.frozen === null) return
      cur.inst.frozen = null
      surface.setState({ ...cur })
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
        inst.typing = false   // (a walk key never reaches onKey while the field has the keys: the Enter is the office's again)
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
      } else if (k === 'd') {
        // the demo's switch to its target (live check 7, R7: never a flip — a double press lands where the person aimed)
        send(surface, inst, { t: 'demo', on: !inst.props.demo })
      } else if (k === 'o' || (k === 'return' && !inst.typing)) {
        // (spec §6.4: o and Enter open the focus — but an Enter right after typing in the search field is the field's, its
        // onSubmit: it never reopens the drawer of a row clicked before the search, live check 7 R14)
        // only a focus whose row is drawn (in the window): one scrolled away would open a drawer for a row the person cannot see
        const y = cur.focus ? inst.rowAt.get(cur.focus) : undefined
        if (cur.focus && y !== undefined && y >= inst.win.from && y < inst.win.from + inst.win.count) send(surface, inst, { t: 'open', id: cur.focus })
      } else {
        const m = KEY_MESSAGES[k]
        if (m) send(surface, inst, m)
      }
    } catch {
      // see above
    }
  })
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------

/** The search field's width on the toolbar's line: what the column leaves after the toolbar's words (by FIT, the gaps included), between INPUT_MIN and INPUT_MAX. */
export function inputWidth(geo: Geo, toolbarWords: readonly string[]): number {
  const toolbarCells = Math.ceil(toolbarWords.reduce((n, l) => n + textWidth(l), 0) / FIT) + 2 * TOOLBAR_GAP
  return Math.max(INPUT_MIN, Math.min(INPUT_MAX, geo.W - toolbarCells - 2))
}

const Office: ClientModule<OfficeProps, OfficeState> = (props, surface) => {
  const { Box, Text, Button, Input } = surface.elements
  try {
    // --- the instance: once ---
    let s = surface.state
    if (s === undefined) {
      listen(surface)
      s = { focus: null, inst: newInst(props) }
      surface.setState(s)
    }
    const inst = s.inst
    inst.props = props

    // --- the model: the geometry, the office's table mode (from the last rank: the hysteresis), the cards, the line map ---
    // (the rooms in THE PIN'S PLACE while a pin press holds them: the props' order once the pointer left)
    setModel(inst, inOrder(props, inst.frozen), decorOf(s))
    const model = inst.model
    const geo = model.geo
    const mode = model.mode
    const floors: Floors | null = model.floors

    // --- the drawer's lines, memoised (they decide the overlay's height); the key assigned after the lines ---
    const inner = drawerInner(props.columns)
    if (props.drawer && !props.helpOpen) {
      // (padded as the hooks' overlayHeight pads it: drawerMax, or what a short pane leaves it — drawerPad)
      const limits = drawerLimits(props.columns)
      const pad = drawerPad(limits, props.rows)
      const dk = JSON.stringify([props.columns, props.lang, pad, props.drawer])
      if (dk !== inst.drawerKey) {
        inst.drawer = drawerLines(props.drawer, props.labels, inner, limits, pad)
        inst.drawerKey = dk
      }
    }

    // --- the search text: ours unless the hooks changed it from outside (not our own echo); cleaned either way ---
    if (props.search !== inst.propsSearch) {
      const outside = props.search !== inst.posted && props.search !== inst.query
      inst.propsSearch = props.search
      if (outside) {
        inst.query = cleanSearch(props.search)
        if (inst.debounce) { inst.debounce(); inst.debounce = null }
      }
    }
    // (the chrome: the fixed rows and the footer — the settings | drawer float and take none (chromeRows); the search field by
    // the props AND the text typed into it — a poll between keystrokes never takes the field away)
    const note = props.oversized ?? ''
    const helpH = helpRows(props.columns, note !== '')
    const search = searchShown(props, inst.query)
    inst.chrome = fixedRows(props, inst.query) + (props.footer ? 1 : 0)

    const L = props.labels
    const lbl = (k: string) => L[k] ?? ''
    const rtl = props.rtl
    const row = rtl ? 'row-reverse' : 'row'
    /** The reading edge of a Box's content: the right in RTL, the left in LTR. */
    const edge = rtl ? 'flex-end' : 'flex-start'
    const hotkeys = geo.W >= COMPACT_BELOW
    const hk = (k: string) => (hotkeys ? { hotkey: k } : {})
    /** The padding cell on the reading side of a column (the probe's cell padding, once per column). */
    const padEdge = rtl ? { paddingLeft: 1 } : { paddingRight: 1 }
    /** One line of the chrome or the overlay: a row of children, exactly one row tall. */
    const line = (children: RenderElement[], extra: Record<string, unknown> = {}) => Box({ flexDirection: row, columnGap: 1, flexWrap: 'nowrap', height: 1, overflow: 'hidden', ...extra, children })
    const kids: RenderElement[] = []

    // --- THE LABEL LADDER (by LINE_FIT, the line's L cells) — what gives way as the pane narrows, in order: the full meter (bar and
    //     reset clock, usage.ts; from WIDE_FROM) → the header's words (`🎭 עובדים 4 · ממתינים 1 · סיימו 3`, else the icons with the
    //     counts, the probe's `🎭 🟢4 ⏳1 ✅3`) → the toolbar's words (below) → the short meter `⏳ 5h 42%` (in the header; under
    //     ONE_LINE_FROM with the field drawn, at the search line's far edge when it fits beside the placeholder) → the tiny `⏳ 42%`
    //     → no meter. So the meter keeps its place before the words do: the richest pair of (counts, meter) that fits — the words
    //     with the full, the short, or the short on the search line; else the icons with one of those; else the words, else the
    //     icons, with the tiny; else the counts alone. A meter is drawn whole or not at all, never cut in half (`5h 4…` reads as 4%) ---
    const c = props.counts
    const fit = geo.L
    const part = (icon: string, n: number, label: string, words: boolean): string => (words ? (rtl ? `${label} ${n}` : `${n} ${label}`) : `${icon}${n}`)
    const countsOf = (words: boolean) => `🎭 ${[part('🟢', c.run, lbl('working'), words), ...(c.idle ? [part('⏳', c.idle, lbl('idleN'), words)] : []), part('✅', c.done, lbl('finished'), words)].join(words ? ' · ' : ' ')}`
    const wordsHdr = countsOf(true)
    const iconsHdr = countsOf(false)
    const fits = (counts: string, meter: string) => textWidth(counts) + (meter ? 1 + textWidth(meter) : 0) <= fit
    const full = props.usage ? usageLabel(props.usage, props.lang, props.nowMin) : ''
    const short = props.usage ? usageShort(props.usage) : ''
    const tiny = props.usage ? usageTiny(props.usage) : ''
    // the placeholder's forms (the probe's `🔍 חיפוש סוכנים`, the glass leading): the label's words (without the trailing ellipsis),
    // or its first word alone
    const phWord = lbl('searchPlaceholder').replace(/…$/, '')
    const phFull = `🔍 ${phWord}`
    const phShort = `🔍 ${phWord.split(' ')[0] ?? phWord}`
    /** Whether the search line (under ONE_LINE_FROM, with the field drawn) has room for the short meter at its far edge beside the placeholder. */
    const searchLineRoom = search && !geo.oneLine && textWidth(phFull) + 2 + textWidth(short) <= fit
    /** The meter beside `counts` as [in the header, on the search line]: the full form from WIDE_FROM, else the short, in the header; else the short on the search line; null when the counts leave it no room. */
    const place = (counts: string): [string, string] | null =>
      geo.wide && fits(counts, full) ? [full, ''] : fits(counts, short) ? [short, ''] : searchLineRoom && fits(counts, '') ? ['', short] : null
    let counts = fits(wordsHdr, '') ? wordsHdr : iconsHdr
    let meterHeader = ''
    let meterSearch = ''
    if (props.usage) {
      const withWords = place(wordsHdr)
      const withIcons = withWords ?? place(iconsHdr)
      if (withWords) { counts = wordsHdr; [meterHeader, meterSearch] = withWords }
      else if (withIcons) { counts = iconsHdr; [meterHeader, meterSearch] = withIcons }
      else if (fits(wordsHdr, tiny)) { counts = wordsHdr; meterHeader = tiny }
      else if (fits(iconsHdr, tiny)) { counts = iconsHdr; meterHeader = tiny }
    }
    // (while the demo runs the header's blank line moves under the demo line: the demo line is the first under the header)
    kids.push(Box({ key: 'header', flexDirection: row, justifyContent: 'space-between', width: '100%', height: 1, overflow: 'hidden', marginBottom: props.demo ? 0 : 1, children: [
      Text({ bold: true, children: [counts] }),
      ...(meterHeader ? [Text({ dimColor: true, children: [meterHeader] })] : []),
    ] }))

    // --- THE DEMO LINE (live check 5: Asaf watched the demo without knowing it): while the demo runs, the first line under the
    //     header says so — the note (`🎬 זו הדגמה - הסוכנים לא אמיתיים`, amber, one no-break value) at the reading edge, the exit
    //     Button (`יציאה`, the demo toggle's post) at the other, a blank line under them; the longest note that fits beside the
    //     Button by LINE_FIT (office-chrome.ts demoLine). The chrome counts it (fixedRows: DEMO_ROWS), so the window's lines stay
    //     exact. No hotkey: `d` is the settings' demo Button's, live with the popover closed too (KEY_MESSAGES) ---
    if (props.demo) {
      const d = demoLine(props)
      kids.push(Box({ key: 'demoLine', flexDirection: row, justifyContent: 'space-between', width: '100%', height: 1, overflow: 'hidden', marginBottom: 1, children: [
        Text({ color: DEMO_FG, children: [nb(d.note)] }),
        Button({ key: 'exitDemo', plain: true, label: d.exit, onPress: () => send(surface, inst, { t: 'demo', on: false }) }),
      ] }))
    }

    // --- toolbar: three plain Buttons in words (the probe's: `הצג שסיימו ☐` · `צליל 🔔` · `הגדרות ⚙️`, gap 2) — the state in the
    //     icon, the word from i18n (tbDone, tbSound, tbSettings); the words whenever the three fit the line by LINE_FIT, else
    //     the icons alone (never a cut word) ---
    // (☑ while the finished are shown: the pref — the demo's cast obeys it as the office does, live check 5)
    const icons = [props.prefs.showDone ? '☑' : '☐', props.prefs.muted ? '🔕' : '🔔', '⚙️']
    const words = ['tbDone', 'tbSound', 'tbSettings'].map(lbl)
    const worded = icons.map((icon, i) => iconLabel(icon, words[i]!, rtl))
    // (the words or the icons decided on the WIDEST state of each toggle — ☑ is a cell wider than ☐ — so a toggle never switches
    // the row between words and icons: live check 7, J9; the field's width too)
    const widest = ['☑', '🔕', '⚙️'].map((icon, i) => iconLabel(icon, words[i]!, rtl))
    const tb = labelsFit(widest, geo.W, TOOLBAR_GAP) ? worded : icons
    const buttons = [
      Button({ key: 'showDone', ...hk('f'), plain: true, label: tb[0]!, onPress: () => send(surface, inst, { t: 'showDone' }) }),
      Button({ key: 'mute', ...hk('m'), plain: true, label: tb[1]!, onPress: () => send(surface, inst, { t: 'mute' }) }),
      Button({ key: 'help', ...hk('h'), plain: true, label: tb[2]!, onPress: () => send(surface, inst, { t: 'help' }) }),
    ]
    // --- search (only while the office holds more than SEARCH_FROM agents, or a search is active — in the props or typed): the
    //     typed text is the module's; the post waits SEARCH_DEBOUNCE_MS, except the first keystroke of a search, posted at once
    //     (under ONE_LINE_FROM the hooks size the chrome by `props.search`: the field's own line must reach them with the text).
    //     The placeholder: the words when the field holds them by FIT, else the first word, else that word cut (never wider than
    //     the field). On the toolbar's line from ONE_LINE_FROM (the Buttons at the reading edge, the field INPUT_MIN..INPUT_MAX
    //     cells at the other), else on a line of its own with a blank line above and below (the probe's), the short meter at
    //     its far edge when the header had no room for one ---
    const inputW = inputWidth(geo, widest)
    const fieldCells = geo.oneLine ? inputW : geo.W - (meterSearch ? textWidth(meterSearch) + 2 : 0)
    const phRoom = fitCells(fieldCells)
    const placeholder = phRoom >= textWidth(phFull) ? phFull : phRoom >= textWidth(phShort) ? phShort : `🔍 ${cut(phWord.split(' ')[0] ?? phWord, Math.max(1, phRoom - 3))}`
    const field = () => Input({
      key: 'search',
      placeholder,
      value: inst.query,
      // (cleaned and capped: a paste of a page or of an escape sequence would make the post or the value unmount the office)
      // (inst.typing: an Enter onKey sees after typing here is the field's, never an open — live check 7, R14)
      onInput: (v: string) => { const was = inst.query; inst.typing = true; inst.query = cleanSearch(v); queueSearch(surface, inst, inst.query, was === '' && inst.query !== '') },
      onSubmit: (v: string) => { inst.typing = true; inst.query = cleanSearch(v); queueSearch(surface, inst, inst.query, true) },
    })
    if (geo.oneLine) {
      kids.push(Box({ key: 'toolbar', flexDirection: row, justifyContent: 'space-between', width: '100%', height: 1, overflow: 'hidden', marginBottom: 1, children: [
        Box({ flexDirection: row, gap: TOOLBAR_GAP, flexWrap: 'nowrap', flexShrink: 0, children: buttons }),
        ...(search ? [Box({ width: inputW, flexShrink: 0, height: 1, overflow: 'hidden', children: [field()] })] : []),
      ] }))
    } else {
      kids.push(Box({ key: 'toolbar', flexDirection: row, gap: TOOLBAR_GAP, flexWrap: 'nowrap', height: 1, overflow: 'hidden', ...(search ? {} : { marginBottom: 1 }), children: buttons }))
      if (search) kids.push(Box({ key: 'searchLine', flexDirection: row, columnGap: 2, marginTop: 1, marginBottom: 1, height: 1, overflow: 'hidden', children: [
        Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden', children: [field()] }),
        ...(meterSearch ? [Text({ dimColor: true, children: [meterSearch] })] : []),
      ] }))
    }

    // --- footer (the props cap's `+N`, the scan error — not the too-long conversations: the settings' note): in the chrome, so it
    //     is seen without scrolling to the end; one dim line, cut to the line by LINE_FIT with an ellipsis (the height-1 Box would
    //     chop it at the edge without one) ---
    if (props.footer) kids.push(Box({ key: 'footer', flexDirection: row, height: 1, overflow: 'hidden', children: [Text({ dimColor: true, children: [cut(props.footer, Math.max(1, fit))] })] }))

    // --- settings popover | drawer: THE FLOATING OVERLAY — built here, laid after the cards (it needs the clamped offset) as ONE
    //     absolute Box from the root at max(offset, chrome), the column's margin and width, on the theme's inverseText (paint
    //     probe 22.10: it hides the rows under it on either theme; a raw colour tinted the light pane), its fixed height per width
    //     (decision 26) — it takes no row of the flow, so the cards under it never move; `overlay` is the Box at a `top` ---
    const floatBox = (key: string, height: number, children: RenderElement[], extra: Record<string, unknown>) => (top: number): RenderElement =>
      Box({ key, position: 'absolute', top, left: geo.margin, width: geo.W, height, backgroundColor: 'inverseText', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: geo.px, paddingY: 1, flexDirection: 'column', overflow: 'hidden', ...extra, children })
    let overlay: ((top: number) => RenderElement) | null = null
    if (props.helpOpen) {
      // the rare controls as labelled Buttons under the title (HELP_BUTTON_ROWS): the demo (✕ and the exit word while it runs) and
      // the language (the other language's name) — the motion toggle is gone (live check 7, Q9: nothing read it) — their words when
      // the two fit the line by LINE_FIT (the probe's L: the whole column, gap 1), else the icons alone (the language as EN / עב);
      // their letters d / l are onKey's either way
      const hIcons = [props.demo ? '🎬 ✕' : '🎬', '🌐']
      const hWords = [props.demo ? lbl('exitDemo') : lbl('demoLabel'), lbl('switchTo')]
      const hWorded = hIcons.map((icon, i) => iconLabel(icon, hWords[i]!, rtl))
      // (the icons alone keep their states, as the toolbar's ☑ / 🔕 do: `🎬 ✕` while the demo runs — the pair reversed for the Hebrew
      // reader as in the worded label, iconLabel)
      // (decided on the demo Button's WIDEST state, `✕ יציאה 🎬`: the demo's switch never switches the row's form — J9)
      const hWidest = [iconLabel('🎬 ✕', lbl('exitDemo'), rtl), hWorded[1]!]
      const hb = labelsFit(hWidest, geo.W) ? hWorded : [iconLabel(hIcons[0]!, '', rtl), props.lang === 'he' ? 'EN' : 'עב']
      // the shortcuts as a column-major table (the probe's): a column of the labels and a column of the dim keys, each a one-line
      // Text with no plain space (nb: a wrapped row would push the rows under it out of the popover's fixed height); two pairs side
      // by side from WIDE_FROM, the second padded to the first's rows. The labels are cut (by LINE_FIT, as the title is) to what
      // the popover's inner width leaves the pairs after their widest keys and padding cells, so the keys are never clipped
      const pairs = helpPairs(geo.wide)
      const keysW = pairs.map(rows => Math.max(...rows.map(([, keys]) => textWidth(keys))))
      const labelsW = pairs.map(rows => Math.max(...rows.map(([k]) => textWidth(lbl(k) || k))))
      const pairsRoom = fitLine(geo.inner) - (pairs.length - 1) * PAIRS_GAP
      const pairsNeed = (cap: number) => pairs.reduce((n, _, i) => n + Math.min(labelsW[i]!, cap) + 1 + keysW[i]!, 0)
      let labelMax = Math.max(...labelsW)
      while (labelMax > 4 && pairsNeed(labelMax) > pairsRoom) labelMax--
      const pair = (rows: ReadonlyArray<readonly [string, string]>): RenderElement => Box({ flexDirection: row, children: [
        Box({ flexDirection: 'column', alignItems: edge, flexShrink: 0, ...padEdge, children: rows.map(([k]) => Text({ children: [nb(cut(lbl(k) || k, labelMax))] })) }),
        Box({ flexDirection: 'column', alignItems: edge, flexShrink: 0, children: rows.map(([, keys]) => Text({ dimColor: true, children: [nb(keys)] })) }),
      ] })
      overlay = floatBox('help', helpH, [
        // (its close as the drawer's — live check 7, R9: the native close role, the ✕ then the word, x; a close, never a flip)
        line([Text({ bold: true, children: [cut(lbl('settingsTitle'), Math.max(1, inner - 10))] }), Button({ key: 'closeHelp', hotkey: 'x', plain: true, role: 'dismiss', label: iconLabel('✕', lbl('close'), rtl), onPress: () => send(surface, inst, { t: 'close' }) })], { justifyContent: 'space-between', width: '100%' }),
        line([
          Button({ key: 'demo', ...hk('d'), plain: true, label: hb[0]!, onPress: () => send(surface, inst, { t: 'demo', on: !props.demo }) }),
          Button({ key: 'lang', ...hk('l'), plain: true, label: hb[1]!, onPress: () => send(surface, inst, { t: 'lang' }) }),
        ]),
        Box({ flexDirection: row, columnGap: PAIRS_GAP, width: '100%', children: pairs.map(pair) }),
        // THE TOO-LONG CONVERSATIONS NOTE (live check 6): one dim line under the shortcuts, cut to the popover's inner width by
        // LINE_FIT, its spaces no-break (it never wraps out of its row: helpRows counts it)
        ...(note ? [line([Text({ dimColor: true, children: [nb(cut(note, Math.max(1, fitLine(geo.inner))))] })], { key: 'oversized' })] : []),
      ], {})
    } else if (props.drawer) {
      // the drawer as a card in the cards' style: every line in a height-1 Box, so the rows under it never move; ONE height at a
      // width whoever it shows (office-chrome.ts drawerMax: its lines padded with blank lines — live check 7, Q2; on a pane too
      // short for that to fit the window, padded to what does — drawerPad)
      const items: RenderElement[] = inst.drawer.map((l, i) => {
        // the name line: the persona (bold) at the reading edge, the close Button (read ✕ THEN the word: iconLabel) at the other
        if (l.kind === 'name') return line([
          Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, height: 1, overflow: 'hidden', justifyContent: edge, children: [Text({ bold: true, children: [l.text] })] }),
          Button({ key: 'close', hotkey: 'x', plain: true, role: 'dismiss', label: iconLabel('✕', lbl('close'), rtl), onPress: () => send(surface, inst, { t: 'close' }) }),
        ], { justifyContent: 'space-between', width: '100%' })
        // ONE status line: the mark in the status's colour, then the dim text (`עובד · זמן 12 דק׳ · Explore`); then the blank line
        if (l.kind === 'status') return line([Text({ color: l.color, children: [l.mark ?? ''] }), Text({ dimColor: true, children: [l.text] })], { key: `d${i}` })
        if (l.kind === 'blank') return Box({ key: `d${i}`, height: 1, overflow: 'hidden' })
        // every other line one Text of the text drawerLines cut or wrapped to the inner width (a composed line — the model line,
        // the ✂ note — included: its ellipsis is drawn, where the height-1 Box would chop an overflow without one); the headings
        // and the sub dim, the model line and the task's and result's lines plain
        if (l.kind === 'head' || l.kind === 'dim' || l.kind === 'note') return line([Text({ dimColor: true, children: [l.text] })], { key: `d${i}` })
        return line([Text({ children: [l.text] })], { key: `d${i}` })
      })
      overlay = floatBox('drawer', DRAWER_FRAME_ROWS + inst.drawer.length, items, { alignItems: edge })
    }

    /** The offset the overlay rides: the props' — clamped to the content once the cards are laid (THE STALE OFFSET, below). */
    let offset = props.offset
    if (props.empty) {
      // --- the empty office: 🏢, the message, the sub's sentences, the demo Button; no cards, so no row to press; the overlay (if
      //     any) still floats, at the offset handed ---
      inst.win = { from: 0, count: 0 }
      const e = emptyLines(props)
      kids.push(Box({ key: 'empty', flexDirection: 'column', alignItems: 'center', children: [
        Text({ children: ['🏢'] }),
        ...e.msg.map(t => Text({ bold: true, children: [t] })),
        ...e.sub.map(t => Text({ dimColor: true, children: [t] })),
        ...(props.empty.kind === 'office' ? [Button({ key: 'watchDemo', variant: 'primary', label: iconLabel('▶', lbl('watchDemo').replace(/^▶ /, ''), rtl), onPress: () => send(surface, inst, { t: 'demo', on: true }) })] : []),
      ] }))
    } else {
      // --- the cards: a spacer, then every card the window (with its overscan) touches, its rows windowed by line. A window past
      //     the content (an offset the engine never hands a Client of this height: windowOf clamps its `from` to the content) draws
      //     its spacer alone ---
      const body = props.rows > 0 ? props.rows : 30
      // THE STALE OFFSET (live check 7, R13): a press that shortened the office (a "hide finished") hands the module the offset
      // the engine had before it — past the new end until the engine asks again; clamped to the content, the window drawn (and
      // the top the overlay rides) is the one the engine shows once it clamps its own (no blank rows meanwhile). Stale = one the
      // taller content the module drew before allowed; an offset no content of it ever allowed is no engine's, and is drawn as
      // handed. The taller height is kept WHILE the offset stays stale — the redraws that follow with it (the press's own focus
      // setState, the next {props} answer) clamp alike — and dropped once the engine hands an offset of the content
      const height = inst.chrome + model.lines.length
      const stale = props.offset > height - body && props.offset <= Math.max(height, inst.height) - body
      offset = stale ? Math.max(0, height - body) : props.offset
      inst.height = stale ? inst.height : height
      // THE WINDOW WITH OVERSCAN (decision 26): the lines the offset names, drawn with up to a body of lines on each side — every
      // line while the office has at most WINDOW_ROWS lines, else capped so the window never passes WINDOW_ROWS lines (overscanOf:
      // the tree must stay under the engine's 100,000 characters) — so the desktop's half-cell frame rows, which put the engine's
      // offset about a row per card off the drawn lines, never leave a blank row in view; the row budget still caps the agent rows
      // drawn (trimWindow), and what it leaves blank has no Button
      const over = overscanOf(model.lines.length, body)
      const w0 = windowOf(inst.chrome, offset, body, model.lines.length, over)
      const { from, count } = trimWindow(model, w0.from, w0.count, WINDOW_ROWS)
      inst.win = { from, count }
      const hi = from + count
      const drawn = count > 0 ? model.rooms.filter(r => r.top < hi && r.top + r.height > from) : []
      const spacer = drawn.length === 0 ? from : drawn[0]!.top
      if (spacer > 0) kids.push(Box({ key: 'spacer', height: spacer }))
      /**
       * One value of the table: a plain Button keyed by the agent and the column (`agent:<id>:<col>` — a press opens the agent's
       * drawer, or closes it when it is the open one), its Text child ONE line that never wraps (no plain space in it; an empty
       * value a no-break space: the row stays one line tall) in the row's weights — bold and dim are what a Button's child keeps
       * on the desktop (paint probe 22.10: colour, underline and italic are lost there), and a native Button hits right at any
       * depth, where the y hit-test drifted a row per card (decision 26). On no background.
       */
      const cell = (id: string, col: string, text: string, style: Record<string, unknown>): RenderElement =>
        Button({ key: `agent:${id}:${col}`, plain: true, onPress: () => pressAgent(surface, id), children: [Text({ wrap: 'truncate', ...style, children: [text || NBSP] })] })
      /** The status mark: a coloured Text — a Button would lose its colour; the mark is not a click target (the row's other cells are). */
      const mark = (r: RowView): RenderElement => Text({ wrap: 'truncate', color: r.color, children: [r.status || NBSP] })
      /**
       * One column of the table: the window's rows one cell each (`pick`), aligned to the reading edge, the padding cell on the
       * column's reading side (the probe's cell padding, once per column); from WIDE_FROM its minWidth floor (the office-wide
       * widest value by FIT), so the columns align across the cards — the task column takes what is left and has none.
       */
      const column = (name: keyof Floors | 'task', rows: readonly RowView[], pick: (r: RowView) => RenderElement, grow: boolean) => Box({
        flexDirection: 'column', alignItems: edge, flexShrink: 0, flexGrow: grow ? 1 : 0, ...padEdge, ...(name === 'status' ? { minWidth: model.statusMin } : floors && name !== 'task' ? { minWidth: floors[name] } : {}),
        children: rows.map(pick),
      })
      /**
       * The title line: THE PIN (decision 26) — a plain Button on every card, the colour 📌 of a pinned room, the monochrome PIN_OFF
       * otherwise (no hover exists on the desktop, and dim does not dim a colour emoji); one width either way, so the title never
       * moves (the model reserves the pin's cells on every title: office-layout.ts cutTitle) — then the title cut on a word, the
       * dim counts at the far edge — read-only (live check 7, Q6: the more line under the title is the room's one toggle); the gap
       * the probe's (TITLE_GAP).
       */
      const titleLine = (room: RoomView): RenderElement => Box({ flexDirection: row, justifyContent: 'space-between', width: '100%', height: 1, paddingX: 1, gap: TITLE_GAP, overflow: 'hidden', children: [
        Button({ key: `pin:${room.id}`, plain: true, label: room.pinned ? PIN : PIN_OFF, onPress: () => pressPin(surface, room.id) }),
        Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, height: 1, overflow: 'hidden', justifyContent: edge, children: [Text({ bold: true, children: [room.title] })] }),
        Box({ flexShrink: 0, height: 1, children: [Text({ dimColor: true, children: [room.counts] })] }),
      ] })
      /** The blank line under the title (round 9: no rule — it never stretched with the card; the title's emphasis is its bold and this line). */
      const blank = (): RenderElement => Box({ height: 1 })
      /**
       * The `עוד N שסיימו ◂` / `הסתר שסיימו ▾` line (the arrow at the string's end: office-layout.ts MORE_MARK, iconLabel), directly
       * under the title (live check 7, Q3: it never moves with the rows it reveals): a plain Button of regular weight — a Button
       * draws no colour on the desktop (decision 26: Q7's link colour is withdrawn); the arrow is the cue that it is a control.
       */
      const moreLine = (room: RoomView): RenderElement => Box({ flexDirection: row, paddingX: 1, height: 1, overflow: 'hidden', children: [Button({ key: `more:${room.id}`, plain: true, label: room.more, onPress: () => pressMore(surface, room.id) })] })
      /**
       * The table of a card: the window's rows as cells in the column Boxes the mode draws — the status mark, the who, the model
       * (unless the mode dropped it), the activity's emoji, its word (when the mode has it), the dim task from CENTRE_AT (the last
       * column grows) — the rows above and below the window ONE spacer each, around the table in a column Box; no row in the
       * window: one spacer of the rows it stands for. The weights: working = a bold who; finished = a dim who (unless ❌), emoji
       * and task; the model always dim; the word dim unless working.
       */
      const table = (room: RoomView): RenderElement => {
        const rows = room.rows.filter(r => r.y >= from && r.y < hi)
        const above = room.rows.filter(r => r.y < from).length
        const below = room.rows.filter(r => r.y >= hi).length
        if (rows.length === 0) return Box({ height: above + below })
        const tbl = Box({ flexDirection: row, width: '100%', children: [
          column('status', rows, r => mark(r), false),
          column('who', rows, r => cell(r.id, 'who', r.who, { bold: r.bold, dimColor: r.dim && !r.failed }), false),
          ...(mode.model !== 'none' ? [column('model', rows, r => cell(r.id, 'model', r.model, { dimColor: true }), false)] : []),
          column('actEmoji', rows, r => cell(r.id, 'emoji', r.actEmoji, { dimColor: r.dim }), !mode.word && !geo.centred),
          ...(mode.word ? [column('actWord', rows, r => cell(r.id, 'word', r.actWord, { dimColor: !r.bold }), !geo.centred)] : []),
          ...(geo.centred ? [column('task', rows, r => cell(r.id, 'task', r.task, { dimColor: true }), true)] : []),
        ] })
        if (above === 0 && below === 0) return tbl
        return Box({ flexDirection: 'column', width: '100%', children: [...(above > 0 ? [Box({ height: above })] : []), tbl, ...(below > 0 ? [Box({ height: below })] : [])] })
      }
      /** A whole card, keyed by its room (live check 7, R14: a line inserted before it never repaints it as another): the frame, the title line, the more line under it, the blank line, the table (every row of the room a cell or a spacer line). */
      const card = (room: RoomView): RenderElement => Box({ key: `room:${room.id}`, flexDirection: 'column', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: geo.px, paddingY: 1, marginBottom: 1, width: '100%', overflow: 'hidden', children: [
        titleLine(room),
        ...(room.more ? [moreLine(room)] : []),
        blank(),
        table(room),
      ] })
      drawn.forEach(room => kids.push(card(room)))
    }
    // THE READING COLUMN: geo.W cells — the pane less a cell at each edge (PANE_GUTTER: no card border ever touches the pane's
    // edge, live check 6), frozen at CENTRE_AT — centred by a left margin (an explicit margin, not alignItems: the floating
    // overlay is laid against the root at the same margin). The root: the column, then THE FLOATING OVERLAY at max(offset, chrome)
    // — the clamped offset: the window's top the engine shows, never above the fixed chrome — painted last, so it covers the rows
    return Box({ key: 'root', flexDirection: 'column', width: '100%', children: [
      Box({ key: 'column', flexDirection: 'column', width: geo.W, flexShrink: 0, marginLeft: geo.margin, children: kids }),
      ...(overlay ? [overlay(Math.max(offset, inst.chrome))] : []),
    ] })
  } catch (err) {
    // nothing of the office is drawn now: the keyboard walk must not open a row of the last good render
    const st = surface.state
    if (st) st.inst.win = { from: 0, count: 0 }
    return Text({ color: 'red', children: [`office: ${err instanceof Error ? err.message : String(err)}`] })
  }
}

export default Office
