// Pure view model of the desktop office: no engine, no `$`. The hooks count
// its lines for the Client's height (`rowCount`); the surface module draws it
// (office-client.tsx) and hit-tests the pointer on its line map.
//
// THE CARDS (docs/superpowers/specs/2026-10-19-office-cards-design.md, the
// probe docs/research/2026-10-19-cards-probe/register.tsx): every room is a
// framed card — a title line (the pin at the reading edge, the counts at the
// other edge), a rule, then the agents as a COLUMN-MAJOR table: four rigid
// columns (status mark, who, model, activity), each sized by the desktop to
// its widest value, every value one line tall. The desktop draws its Text in
// a proportional font, so this module never pads by cell and never cuts to a
// cell width: it only decides WHAT each cell says (the activity word or its
// emoji alone, the name cut) by a conservative estimate of what fits
// (`fitCells`: the desktop draws letters wider than a cell — the probe's
// round 6 fit four columns at 51 columns).
//
// THE LINE MAP: every line the Client draws is exactly one row tall by
// construction (a height-1 Box with overflow hidden around each value, the
// card's border and padding), so the y of every line is known here, before
// anything is drawn: the pointer's y maps to a line, a row's hit is its whole
// width, the title line keeps the pin zone at the reading edge and the counts
// zone at the other edge. The decor (the hovered head, the keyboard focus,
// the finish pulse) is the module's local state handed in as data, so the
// model stays a pure function of (props, decor).
//
// The strings are the probe's (`${emoji} ${name}`, `🤔 חושב`, `▸ עוד 2 שסיימו`,
// a title cut on a word with a trailing …): the desktop lays a Hebrew-first
// Text right-to-left, so nothing here reorders a string for the reader.

import type { OfficeAgent, OfficeProps, OfficeRoom } from './office-props'

export const EMOJI_CELLS = 2
/** The caps of the props' texts (office-props.ts cuts to them): a row's name, its activity, the model word. */
export const NAME_MAX = 24
export const ACT_MAX = 18
export const PILL_MAX = 12
/** The narrowest a name is cut to before the model column gives way. */
export const NAME_MIN = 6
/** The model's version rides its family word from this many columns (`Opus 5.5`); under it the family alone (`Opus`). */
export const MODEL_FULL_FROM = 60
/** The room head's pin glyph: drawn bright when the room is pinned, dim under the pointer, not at all otherwise (no ○). */
export const PIN = '📌'
/** The card's frame colour (the probe's). */
export const CARD_BORDER = '#56607a'
/** The status column's colours by status (the probe's dots): green running, amber stale, grey done. */
export const DOT_FG: Readonly<Record<OfficeAgent['status'], string>> = { running: '#3fb950', stale: '#d29922', done: '#8b949e' }
/**
 * THE FIT: the share of a width in cells the desktop can be trusted to draw text into — its letters are wider than the
 * engine's cell (the probe's round 4 clipped `Sonnet` to `nnet` in a 6-cell box). From the probe: four columns of 32
 * cells fit the 47 inner cells of a 51-column pane (round 6, 0.68) while five of 39 cells did not (0.83); the header's
 * 33 cells of counts, a gap and 8 of meter fit the 51 columns whole (round 7, 0.82). So the table, the title cut and
 * the drawer's wrapping — where an overflow clips a value — go by FIT, and the chrome's one-line labels (the header,
 * the toolbar, the search's placeholder), which fall back to a shorter form, by LINE_FIT (the probe's header exactly).
 */
export const FIT = 0.75
export const LINE_FIT = 0.83
export function fitCells(cells: number): number {
  return Math.max(0, Math.floor(cells * FIT))
}
export function fitLine(cells: number): number {
  return Math.max(0, Math.floor(cells * LINE_FIT))
}
/** The card's frame in cells: a border and a padding cell on each side (the inner width is `columns - CARD_FRAME`). */
export const CARD_FRAME = 4
/** The pin's zone on the title line, from the reading edge: border, padding, the title's padding, the glyph and its gap. */
export const PIN_ZONE = 6
/** The lines of a card around its rows: the two borders, the two padding lines, the title, the rule, the gap after the card. */
export const CARD_LINES = 7
/** The more / hide line and the blank line over it. */
export const MORE_LINES = 2
export const MORE_MARK = '▸'
/** The keyboard focus marker beside the status mark, pointing into the row from the reading edge. */
export const FOCUS_MARK: Readonly<Record<'rtl' | 'ltr', string>> = { rtl: '‹', ltr: '›' }

const EMOJI_RE = /^\p{Extended_Pictographic}/u
/** Code points that take no cell of their own: combining marks (Hebrew points among them), the variation selectors, the ZWJ, the skin tones. */
const JOIN_RE = /^[\p{M}‍︎️\u{1F3FB}-\u{1F3FF}]$/u
const ZWJ = '‍'
const ELLIPSIS = '…'
/** A Hebrew-script character (a letter, a point, the geresh). (i18n.ts hebrewRuleOk uses the same class.) */
const HEBREW_RE = /\p{Script=Hebrew}/u

export type Glyph = { ch: string; w: number }

/** `text` as glyphs: a base code point with the marks, selectors and joined code points that ride on it, and its width in cells. */
export function glyphs(text: string): Glyph[] {
  const out: Glyph[] = []
  let joined = false            // the previous code point was a ZWJ: the next one rides on the same glyph
  for (const cp of text) {
    const last = out[out.length - 1]
    if (last && (joined || JOIN_RE.test(cp))) {
      last.ch += cp
      joined = cp === ZWJ
      continue
    }
    out.push({ ch: cp, w: EMOJI_RE.test(cp) ? EMOJI_CELLS : 1 })
    joined = false
  }
  return out
}

/** The width of `text` in cells (the terminal metric; the desktop draws wider — see FIT). */
export function textWidth(text: string): number {
  let w = 0
  for (const g of glyphs(text)) w += g.w
  return w
}

/** `s` cut to at most `max` cells, whole glyphs only, with an ellipsis when something was dropped. (office-props.ts's caps, the drawer's wrapping.) */
export function cut(s: string, max: number): string {
  if (max < 1) return ''
  const gs = glyphs(s)
  let w = 0
  let n = 0
  while (n < gs.length && w + gs[n]!.w <= max) { w += gs[n]!.w; n++ }
  if (n === gs.length) return s
  while (n > 0 && w + 1 > max) { n--; w -= gs[n]!.w }
  return gs.slice(0, n).map(g => g.ch).join('') + ELLIPSIS
}

/**
 * `s` cut to at most `max` cells on a word boundary when one lies past the middle (the probe's title cut), the ellipsis
 * trailing: `Plan the static-registry move…`. A text that fits is returned as it is.
 */
export function cutWords(s: string, max: number): string {
  if (textWidth(s) <= max) return s
  const head = cut(s, Math.max(1, max)).slice(0, -ELLIPSIS.length)
  // the cut fell on a word boundary: the head is whole words
  const next = s.slice(head.length, head.length + 1)
  if (head.endsWith(' ') || next === ' ') return `${head.trimEnd()}${ELLIPSIS}`
  const sp = head.lastIndexOf(' ')
  return `${(sp > max / 2 ? head.slice(0, sp) : head).trimEnd()}${ELLIPSIS}`
}

/**
 * The label of a control (or a chip) that reads ICON THEN WORD, as the probe writes it: for the Hebrew reader (`rtl`, a
 * Hebrew word) the icon TRAILS the word in the string (`הצג שסיימו ☐`, `צליל 🔔`, `הגדרות ⚙️` — seen right on the
 * desktop as written); two icons are reversed there (`יציאה ✕ 🎬`), and the icons alone keep that arrangement. Any other
 * word (Latin in either pane, or the English pane's one Hebrew word) takes the icon first. The office Client lays every
 * labelled control and chip through it; office-props.ts the drawer's failed chip.
 */
export function iconLabel(icon: string, word: string, rtl: boolean): string {
  if (!icon) return word
  const icons = rtl ? icon.split(' ').reverse().join(' ') : icon
  if (!word) return icons
  if (rtl && HEBREW_RE.test(word)) return `${word} ${icons}`
  return `${icon} ${word}`
}

/** The model's word: the family alone (`Opus`; `?` unknown) or, `full`, the label with its version (`Opus 5.5`, cut to PILL_MAX). */
export function modelText(model: string, full = false): string {
  const label = full ? model : model.split(' ')[0] ?? model
  return cut(label || '?', PILL_MAX)
}

/** The first glyph of a text: an activity's emoji, drawn alone when the word has no room. */
export function firstGlyph(text: string): string {
  return glyphs(text)[0]?.ch ?? ''
}

/** The room's counts as the title line draws them at its far edge: `🟢3 ⏳1 ✅2` (an idle or done count only when there is one). */
export function countsText(room: Pick<OfficeRoom, 'run' | 'stale' | 'done'>): string {
  return `🟢${room.run}${room.stale ? ` ⏳${room.stale}` : ''}${room.done ? ` ✅${room.done}` : ''}`
}

/**
 * The status mark of a row: the badges ride the status column — ⭐ inside the just-finished window, ❌ failed, ⏰ long-running
 * — else ● (running, stale) or ○ (done); its colour the status's.
 */
export function markOf(a: Pick<OfficeAgent, 'status' | 'star' | 'failed' | 'longRunning'>): string {
  if (a.star) return '⭐'
  if (a.failed) return '❌'
  if (a.longRunning) return '⏰'
  return a.status === 'done' ? '○' : '●'
}

// ---------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------

export type LineKind = 'border' | 'pad' | 'title' | 'rule' | 'row' | 'blank' | 'more' | 'gap'
/** One drawn line of the office (its index is its y): what it is, whose room, and the agent on a row. */
export type Line = { kind: LineKind; room: string; agent: string | null }
export type Hit = { kind: 'agent' | 'pin' | 'roomDone' | 'moreDone'; id: string; x: number; y: number; w: number; h: number }

/** One agent row of a card: the four cells' texts and the flags that style them. */
export type RowView = {
  id: string
  /** The line of the row. */
  y: number
  /** The status cell: the mark, with the focus marker or its blank (the column's width never moves with the focus). */
  status: string
  mark: string
  color: string
  who: string
  model: string
  act: string
  /** A finished agent: its who and activity dim, the who not bold. */
  dim: boolean
  selected: boolean
  focus: boolean
  /** A `done` fx is running on it: the module tints the row's cells by frame parity. */
  pulse: boolean
}

export type RoomView = {
  id: string
  /** The line of the card's top border. */
  top: number
  /** The card's lines, the gap after it included. */
  height: number
  title: string
  counts: string
  pin: 'bright' | 'dim' | 'none'
  /** The title line's y, the rule's, the first row's. */
  titleAt: number
  rows: RowView[]
  /** The `▸ עוד N שסיימו` / `▸ הסתר שסיימו` line, '' when the room draws none. */
  more: string
  moreAt: number
  /** The activity cells carry their word (else the emoji alone), the model column is drawn: the table fits the pane by FIT. */
  actWord: boolean
  showModel: boolean
}

export type OfficeModel = { rooms: RoomView[]; lines: Line[]; hits: Hit[] }

/**
 * What the surface module lays on the model from its local state, by id:
 *   hoverRoom the room whose title line is under the pointer: a dim 📌 at the pin of an unpinned room (a pinned one draws its 📌 anyway);
 *   focus     the keyboard focus: a small marker beside the status mark;
 *   pulse     the agents whose `done` fx runs: their rows tinted by frame parity.
 */
export type OfficeDecor = { hoverRoom: string | null; focus: string | null; pulse: ReadonlySet<string> }
export const NO_DECOR: OfficeDecor = { hoverRoom: null, focus: null, pulse: new Set() }

/** The lines a room's card takes: CARD_LINES around its rows, MORE_LINES when it draws the more / hide line. */
export function cardLines(agents: number, more: boolean): number {
  return CARD_LINES + Math.max(0, agents) + (more ? MORE_LINES : 0)
}

/**
 * The number of lines `officeModel(props)` lays out, without building a row: what the hooks need for the Client's height
 * on every render (a card per room, a line per agent). The decor and the width never change it.
 */
export function rowCount(props: OfficeProps): number {
  let n = 0
  for (const room of props.rooms) n += cardLines(room.agents.length, room.moreLabel !== '')
  return n
}

/**
 * The title line's text: the room's title cut on a word with a trailing … (the probe's cut) to what the line leaves it
 * beside the pin and the counts, by FIT; never under 8 cells.
 */
export function cutTitle(title: string, columns: number, counts: string): string {
  const room = columns - CARD_FRAME - 2 - (EMOJI_CELLS + 1) - textWidth(counts) - 1
  return cutWords(title, Math.max(8, fitCells(room)))
}

/** The widths a room's table needs per column: the widest value plus the padding cell (the desktop sizes the columns by them). */
type Need = { status: number; who: number; model: number; actWord: number; actEmoji: number }

function needOf(room: OfficeRoom, nameMax: number, full: boolean): Need {
  const n: Need = { status: 0, who: 0, model: 0, actWord: 0, actEmoji: 0 }
  for (const a of room.agents) {
    n.status = Math.max(n.status, textWidth(markOf(a)))
    n.who = Math.max(n.who, EMOJI_CELLS + 1 + textWidth(cut(a.name, nameMax)))
    n.model = Math.max(n.model, textWidth(modelText(a.model, full)))
    n.actWord = Math.max(n.actWord, textWidth(a.act))
    n.actEmoji = Math.max(n.actEmoji, textWidth(firstGlyph(a.act)))
  }
  // the status cell carries the focus marker's cell too; every cell a padding cell
  return { status: n.status + 1 + 1, who: n.who + 1, model: n.model + 1, actWord: n.actWord + 1, actEmoji: n.actEmoji + 1 }
}

/** What a room's table draws at `columns`: the activity word or the emoji alone, the model column or not, the names' cap. */
export function tableFit(room: OfficeRoom, columns: number): { actWord: boolean; showModel: boolean; nameMax: number } {
  const inner = fitCells(columns - CARD_FRAME)
  const full = columns >= MODEL_FULL_FROM
  const whole = needOf(room, NAME_MAX, full)
  if (whole.status + whole.who + whole.model + whole.actWord <= inner) return { actWord: true, showModel: true, nameMax: NAME_MAX }
  // (1) the activity to its emoji; (2) the names down to NAME_MIN; (3) the model column away
  const clampName = (budget: number) => Math.max(NAME_MIN, Math.min(NAME_MAX, budget - 1 - EMOJI_CELLS - 1))
  const nameMax = clampName(inner - whole.status - whole.model - whole.actEmoji)
  const cut1 = needOf(room, nameMax, full)
  if (cut1.status + cut1.who + cut1.model + cut1.actEmoji <= inner) return { actWord: false, showModel: true, nameMax }
  return { actWord: false, showModel: false, nameMax: clampName(inner - whole.status - whole.actEmoji) }
}

/**
 * The rooms as cards, the line map and the hit rectangles of the whole office. Card lines, in order: the top border, a
 * padding line, the title (pin · title · counts), the rule, one line per agent, [a blank line, the more / hide line], a
 * padding line, the bottom border, the gap. A row's hit is its whole width; so is the more line's; the title line keeps
 * PIN_ZONE cells at the reading edge for the pin and the counts' cells at the other edge for the room's ✅ toggle (when
 * the room has finished agents). The decor changes only the pin of the head it hovers, the focus marker and the pulse
 * flags — never a line, never a hit.
 */
export function officeModel(props: OfficeProps, decor: OfficeDecor = NO_DECOR): OfficeModel {
  const { columns, rtl } = props
  const rooms: RoomView[] = []
  const lines: Line[] = []
  const hits: Hit[] = []
  const line = (kind: LineKind, room: string, agent: string | null = null) => { lines.push({ kind, room, agent }) }
  for (const room of props.rooms) {
    const top = lines.length
    const counts = countsText(room)
    const fit = tableFit(room, columns)
    const full = columns >= MODEL_FULL_FROM
    line('border', room.id)
    line('pad', room.id)
    const titleAt = lines.length
    line('title', room.id)
    hits.push({ kind: 'pin', id: room.id, x: rtl ? Math.max(0, columns - PIN_ZONE) : 0, y: titleAt, w: PIN_ZONE, h: 1 })
    if (room.done) {
      const cw = Math.max(1, Math.min(textWidth(counts) + 3, columns - PIN_ZONE))
      hits.push({ kind: 'roomDone', id: room.id, x: rtl ? 0 : Math.max(0, columns - cw), y: titleAt, w: cw, h: 1 })
    }
    line('rule', room.id)
    const rows: RowView[] = []
    for (const a of room.agents) {
      const y = lines.length
      const mark = markOf(a)
      const focus = decor.focus === a.id
      const marker = focus ? FOCUS_MARK[rtl ? 'rtl' : 'ltr'] : ' '
      rows.push({
        id: a.id, y, mark, color: DOT_FG[a.status],
        status: rtl ? `${mark}${marker}` : `${marker}${mark}`,
        who: `${a.emoji} ${cut(a.name, fit.nameMax)}`,
        model: modelText(a.model, full),
        act: fit.actWord ? a.act : firstGlyph(a.act),
        dim: a.status === 'done', selected: props.selected === a.id, focus, pulse: decor.pulse.has(a.id),
      })
      line('row', room.id, a.id)
      hits.push({ kind: 'agent', id: a.id, x: 0, y, w: columns, h: 1 })
    }
    let moreAt = -1
    const more = room.moreLabel ? `${MORE_MARK} ${room.moreLabel}` : ''
    if (more) {
      line('blank', room.id)
      moreAt = lines.length
      line('more', room.id)
      hits.push({ kind: 'moreDone', id: room.id, x: 0, y: moreAt, w: columns, h: 1 })
    }
    line('pad', room.id)
    line('border', room.id)
    line('gap', room.id)
    rooms.push({
      id: room.id, top, height: lines.length - top,
      title: cutTitle(room.title, columns, counts), counts,
      pin: room.pinned ? 'bright' : decor.hoverRoom === room.id ? 'dim' : 'none',
      titleAt, rows, more, moreAt, actWord: fit.actWord, showModel: fit.showModel,
    })
  }
  return { rooms, lines, hits }
}

/** The agent or room control under cell (x, y) of the whole office, if any. */
export function hitAt(model: OfficeModel, x: number, y: number): Hit | undefined {
  return model.hits.find(hit => x >= hit.x && x < hit.x + hit.w && y >= hit.y && y < hit.y + hit.h)
}

/**
 * The window [from, from + count) of lines, shortened so it holds at most `maxRows` agent rows (the tree's budget):
 * what lies past the last row within the budget is left undrawn.
 */
export function trimWindow(model: OfficeModel, from: number, count: number, maxRows: number): { from: number; count: number } {
  let rows = 0
  const end = Math.min(model.lines.length, from + Math.max(0, count))
  for (let y = Math.max(0, from); y < end; y++) {
    if (model.lines[y]!.kind !== 'row') continue
    rows++
    if (rows > maxRows) return { from, count: y - from }
  }
  return { from, count: Math.max(0, count) }
}
