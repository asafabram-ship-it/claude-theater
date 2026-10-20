// Pure view model of the desktop office: no engine, no `$`. The hooks count
// its lines for the Client's height (`rowCount`); the surface module draws it
// (office-client.tsx) and hit-tests the pointer on its line map.
//
// THE CARDS (docs/superpowers/specs/2026-10-19-office-cards-design.md, the
// probe docs/research/2026-10-19-cards-probe/register.tsx, round 9): every
// room is a framed card — a title line (the pin at the reading edge, the
// counts at the other edge), a BLANK line (no rule: it never stretched with
// the card), then the agents as a COLUMN-MAJOR table of rigid columns (status
// mark · who · [model] · activity emoji · [activity word] · [task]), each sized
// by the desktop to its widest value, every value one line tall. The desktop
// draws its Text in a proportional font, so this module never pads by cell
// and never cuts to a cell width: it only decides WHAT each cell says, by a
// conservative estimate of what fits (`fitCells`: the desktop draws letters
// wider than a cell — the probe's round 6 fit four columns at 51 columns).
//
// THE WIDTH (probe rounds 8-9): ONE reading column, `geometry`: the pane up to
// 99 cells, frozen at CENTRE_AT and centred from 100; the card's padding 1 →
// 2 from WIDE_FROM. The frame never changes shape with the width — widening
// or narrowing changes words and columns, never a line's position. The TABLE
// MODE is decided ONCE per render for the whole office from the widest values
// across all its rooms (`officeWidest`), with HYSTERESIS cells kept by the
// caller (the Client's instance, never the props): a mode is dropped the
// instant it stops fitting and regained only with two cells to spare
// (`chooseMode`). The ladder, richest first: the activity word → the model's
// version → the names down to NAME_MIN → the model column → the names to
// NAME_FLOOR. From WIDE_FROM the columns align across the cards by minWidth
// floors (`floorsOf`); from CENTRE_AT a dim task column rides at the end.
//
// THE LINE MAP: every line the Client draws is exactly one row tall by
// construction (a height-1 Box with overflow hidden around each chrome value,
// the card's border and padding, and EVERY ONE-LINE VALUE OF A CARD WITHOUT A
// PLAIN SPACE — `nb` turns its spaces into no-break spaces, so a value a little
// too long is clipped at the edge instead of breaking onto a second line, which
// would shift every line under it: the desktop does not enforce a Text's
// `wrap`), so the y of every line is known here, before anything is drawn:
// the pointer's y maps to a line, a row's hit is the column's whole width,
// the title line keeps the pin zone at the reading edge and the counts zone
// at the other edge. The decor (the hovered head, the keyboard focus, the
// finish pulse) is the module's local state handed in as data, so the model
// stays a pure function of (props, decor, the last mode's rank).
//
// The strings are the probe's (`${emoji} ${name}`, `🤔` then `חושב`, `▸ עוד 2
// שסיימו`, a title cut on a word with a trailing …): the desktop lays a
// Hebrew-first Text right-to-left, so nothing here reorders a string for the
// reader.

import type { OfficeAgent, OfficeProps, OfficeRoom } from './office-props'

export const EMOJI_CELLS = 2
/** The caps of the props' texts (office-props.ts cuts to them): a row's name, its activity, the model word, the row's short task. */
export const NAME_MAX = 24
export const ACT_MAX = 18
export const PILL_MAX = 12
export const TASK_MAX = 24
/** The narrowest a name is cut to before the model column gives way (the probe's ladder: names down to 8, then the column). */
export const NAME_MIN = 8
/** The names' floor once the model column is gone (the probe: the narrowest panes only). */
export const NAME_FLOOR = 3
/** The model's version rides its family word from this many columns (`Opus 5.5`); under it the family alone (`Opus`). */
export const MODEL_FULL_FROM = 60
/** The toolbar and the search share one line from this many columns (the chrome 6 rows → 4 while the search is drawn). */
export const ONE_LINE_FROM = 64
/** From this many columns: the card's padding is 2, the columns align across the cards (floors), the settings' shortcuts in two pairs, the full meter. */
export const WIDE_FROM = 80
/** From this many columns the reading column is frozen at this width and centred. */
export const CENTRE_AT = 100
/** The title keeps at least this many fit cells before the counts shrink. */
export const TITLE_MIN = 16
/** The cells a richer table mode must have to spare before it is regained (none to be dropped). */
export const HYSTERESIS = 2
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
 * 33 cells of counts, a gap and 8 of meter fit the 51 columns whole (round 7, 0.82). So the table, the counts' shrink
 * and the drawer's wrapping — where an overflow clips a value — go by FIT, and the chrome's one-line labels (the
 * header, the toolbar, the search's placeholder) and the title, which fall back to a shorter form or are cut on a
 * word, by LINE_FIT (the probe's header exactly; the title by LINE_FIT since round 9).
 */
export const FIT = 0.75
export const LINE_FIT = 0.83
export function fitCells(cells: number): number {
  return Math.max(0, Math.floor(cells * FIT))
}
export function fitLine(cells: number): number {
  return Math.max(0, Math.floor(cells * LINE_FIT))
}
/**
 * The title line's gap between its children (the probe's `gap={2}`): the title and the counts, and the pin before the title
 * when one is drawn — a pinned room's bright 📌, or the dim one under the pointer; otherwise the title sits flush at the
 * reading edge, as the probe's, and cutTitle counts the pin's cells only for a pinned room (the hover's dim pin rides the
 * fit's slack, so the title does not re-cut under the pointer).
 */
export const TITLE_GAP = 2
/** The lines of a card around its rows: the two borders, the two padding lines, the title, the blank line under it, the gap after the card. */
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
/** The no-break space (U+00A0): a space the desktop never breaks a line on — and no surface refuses (office-chrome.ts REFUSED_RE: it is no control). */
export const NBSP = ' '

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
 * THE ONE-LINE VALUE (round 9): `s` with every plain space a no-break space, so a Text drawn from it can never wrap — a
 * value a little too long for its column is clipped at the card's edge instead of breaking onto a second line (the desktop
 * does not enforce `wrap: 'truncate'`; a wrapped line would shift every line of the line map under it). Every one-line
 * value of a card goes through it: the who, the model, the activity word, the task, the title, the counts, the more line —
 * and the settings' shortcut table (office-client.tsx). The width is the same (a no-break space is one cell).
 */
export function nb(s: string): string {
  return s.replace(/ /g, NBSP)
}

/**
 * The label of a control (or a chip) that reads ICON THEN WORD, as the probe writes it: for the Hebrew reader (`rtl`, a
 * Hebrew word) the icon TRAILS the word in the string (`הצג שסיימו ☐`, `צליל 🔔`, `הגדרות ⚙️` — seen right on the
 * desktop as written); two icons are reversed there (`יציאה ✕ 🎬`), and the icons alone keep that arrangement. Any other
 * word (Latin in either pane, or the English pane's one Hebrew word) takes the icon first. The office Client lays every
 * labelled control through it.
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

/** The first glyph of a text: an activity's emoji, its own column (the word beside it when the table has room). */
export function firstGlyph(text: string): string {
  return glyphs(text)[0]?.ch ?? ''
}

/** The text after its first glyph, trimmed: an activity's word (`חושב` of `🤔 חושב`). */
export function restWord(text: string): string {
  const g = glyphs(text)[0]?.ch ?? ''
  return text.slice(g.length).trim()
}

/** The room's counts as the title line draws them at its far edge: `🟢3 ⏳1 ✅2` (an idle or done count only when there is one). */
export function countsText(room: Pick<OfficeRoom, 'run' | 'stale' | 'done'>): string {
  return `🟢${room.run}${room.stale ? ` ⏳${room.stale}` : ''}${room.done ? ` ✅${room.done}` : ''}`
}

/**
 * The status mark of a row: the badges ride the status column — ⭐ inside the just-finished window, ❌ failed, ⏰ long-running
 * — else ● (running, stale) or ○ (done); its colour the status's. (The drawer's status line carries the same mark.)
 */
export function markOf(a: Pick<OfficeAgent, 'status' | 'star' | 'failed' | 'longRunning'>): string {
  if (a.star) return '⭐'
  if (a.failed) return '❌'
  if (a.longRunning) return '⏰'
  return a.status === 'done' ? '○' : '●'
}

// ---------------------------------------------------------------------------
// the geometry: pure functions of the pane's columns
// ---------------------------------------------------------------------------

/**
 * The reading column at `columns`: its width `W` (the pane, frozen at CENTRE_AT from 100 and centred by `margin` cells on
 * the left), the card's padding `px` (2 from WIDE_FROM), the frame (`2 + 2 px`: a border and the padding on each side),
 * the card's inner width, the table's `budget` (the inner width by FIT), the chrome line's `L` (by LINE_FIT) and the
 * structure flags: `oneLine` (toolbar + search on one line), `full` (the model's version), `wide` (floors, two settings
 * pairs, the full meter), `centred` (the task column, the frozen column).
 */
export type Geo = { columns: number; W: number; px: number; frame: number; inner: number; budget: number; L: number; oneLine: boolean; full: boolean; wide: boolean; centred: boolean; margin: number }

export function geometry(columns: number): Geo {
  const W = Math.min(columns, CENTRE_AT)
  const px = W >= WIDE_FROM ? 2 : 1
  const frame = 2 + 2 * px
  const inner = W - frame
  const centred = columns >= CENTRE_AT
  return { columns, W, px, frame, inner, budget: fitCells(inner), L: fitLine(W), oneLine: W >= ONE_LINE_FROM, full: W >= MODEL_FULL_FROM, wide: W >= WIDE_FROM, centred, margin: centred ? Math.floor((columns - W) / 2) : 0 }
}

/** The pin's zone on the title line, from the reading edge — drawn or not: the border, the padding, the title's own padding, the glyph and its gap. */
export function pinZone(geo: Geo): number {
  return 1 + geo.px + 1 + EMOJI_CELLS + TITLE_GAP
}

/**
 * The counts' zone on the title line (the room's ✅ toggle), from the far edge, in cells: the border and the paddings, then
 * the counts as the desktop draws them — wider than their cells, by FIT — never into the pin zone.
 */
export function countsZone(counts: string, geo: Geo): number {
  return Math.max(1, Math.min(1 + geo.px + 1 + Math.ceil(textWidth(counts) / FIT), geo.W - pinZone(geo)))
}

/** The cells the title line leaves the title: the inner width less the title's own padding, the pin and its gap when pinned, the counts and the gap before them. */
function titleRoom(geo: Geo, counts: string, pinned: boolean): number {
  return geo.inner - 2 - (pinned ? EMOJI_CELLS + TITLE_GAP : 0) - textWidth(counts) - TITLE_GAP
}

/**
 * The room's counts, shrunk before the title is (round 8): the non-zero statuses (`🟢3 ⏳1 ✅2`), then without the ✅, then
 * the 🟢 alone — the first form that leaves the title TITLE_MIN fit cells (by FIT), else the shortest.
 */
export function countsFor(room: Pick<OfficeRoom, 'run' | 'stale' | 'done'>, geo: Geo, pinned = false): string {
  const forms = [countsText(room), countsText({ run: room.run, stale: room.stale, done: 0 }), countsText({ run: room.run, stale: 0, done: 0 })]
  for (const c of forms) if (fitCells(titleRoom(geo, c, pinned)) >= TITLE_MIN) return c
  return forms[2]!
}

/**
 * The title line's text: the room's title cut on a word with a trailing … (the probe's cut) to what the line leaves it
 * beside the counts — and beside the 📌 and its gap when the room is pinned — by LINE_FIT; never under 8 cells.
 */
export function cutTitle(title: string, geo: Geo, counts: string, pinned = false): string {
  return cutWords(title, Math.max(8, fitLine(titleRoom(geo, counts, pinned))))
}

// ---------------------------------------------------------------------------
// the table mode: ONE for the whole office, from the widest values across ALL its rooms
// ---------------------------------------------------------------------------

/** The widest values across the office, in cells (the names kept whole: their width depends on the mode's cap). */
export type Widest = { mark: number; names: string[]; modelFull: number; modelFamily: number; actEmoji: number; actWord: number }

/** The widest values across `rooms`: what the table mode and the column floors are decided from. */
export function officeWidest(rooms: readonly OfficeRoom[]): Widest {
  const w: Widest = { mark: 0, names: [], modelFull: 0, modelFamily: 0, actEmoji: 0, actWord: 0 }
  const seen = new Set<string>()
  for (const room of rooms) {
    for (const a of room.agents) {
      w.mark = Math.max(w.mark, textWidth(markOf(a)))
      if (!seen.has(a.name)) { seen.add(a.name); w.names.push(a.name) }
      w.modelFull = Math.max(w.modelFull, textWidth(modelText(a.model, true)))
      w.modelFamily = Math.max(w.modelFamily, textWidth(modelText(a.model)))
      w.actEmoji = Math.max(w.actEmoji, textWidth(firstGlyph(a.act)))
      w.actWord = Math.max(w.actWord, textWidth(restWord(a.act)))
    }
  }
  return w
}

/** The widest name once every name is cut to `nameMax` cells. */
export function widestName(w: Widest, nameMax: number): number {
  let n = 0
  for (const name of w.names) n = Math.max(n, textWidth(cut(name, nameMax)))
  return n
}

export type ModelCol = 'full' | 'family' | 'none'
/** What the office's tables draw: the activity word (else its emoji alone), the model column (with its version, the family, or none), the names' cap. `rank` is the mode's place on the ladder (0 the richest). */
export type TableMode = { rank: number; word: boolean; model: ModelCol; nameMax: number }
/** The widths a table needs per column at a mode: the widest value plus the padding cell (the status cell carries the focus marker's cell too). */
export type Need = { status: number; who: number; model: number; actEmoji: number; actWord: number; total: number }

export function needOf(w: Widest, word: boolean, model: ModelCol, nameMax: number): Need {
  const status = w.mark + 1 + 1
  const who = EMOJI_CELLS + 1 + widestName(w, nameMax) + 1
  const mdl = model === 'none' ? 0 : (model === 'full' ? w.modelFull : w.modelFamily) + 1
  const actEmoji = w.actEmoji + 1
  const actWord = word ? w.actWord + 1 : 0
  return { status, who, model: mdl, actEmoji, actWord, total: status + who + mdl + actEmoji + actWord }
}

/**
 * THE LADDER: the mode at `rank` when it fits `budget` cells, else null — (0) the word and the model (its version when `full`),
 * (1) the emoji alone, (2) the family word, (3) the names shrunk to what is left, down to NAME_MIN, (4) no model column,
 * (5) the names shrunk to the floor (never null: the office's last resort).
 */
export function modeAt(w: Widest, rank: number, budget: number, full: boolean): TableMode | null {
  const fam: ModelCol = full ? 'full' : 'family'
  const fits = (m: TableMode) => (needOf(w, m.word, m.model, m.nameMax).total <= budget ? m : null)
  const shrink = (model: ModelCol, floor: number) => {
    const n = needOf(w, false, model, NAME_MAX)
    return Math.max(floor, Math.min(NAME_MAX, budget - n.status - n.model - n.actEmoji - (EMOJI_CELLS + 1 + 1)))
  }
  switch (rank) {
    case 0: return fits({ rank, word: true, model: fam, nameMax: NAME_MAX })
    case 1: return fits({ rank, word: false, model: fam, nameMax: NAME_MAX })
    case 2: return fits({ rank, word: false, model: 'family', nameMax: NAME_MAX })
    case 3: return fits({ rank, word: false, model: 'family', nameMax: shrink('family', NAME_MIN) })
    case 4: return fits({ rank, word: false, model: 'none', nameMax: NAME_MAX })
    default: return { rank: 5, word: false, model: 'none', nameMax: shrink('none', NAME_FLOOR) }
  }
}

/**
 * THE HYSTERESIS: the richest mode that fits — a mode above the last one (`last`, the rank kept by the caller between renders;
 * null before the first) must fit with HYSTERESIS cells to spare, the last one or a poorer one the budget alone. So a mode is
 * dropped the instant it stops fitting and regained only with two cells to spare: no flapping at a threshold. A regained mode
 * is the ladder's own at the real budget (its names' cap is not the reduced budget's).
 */
export function chooseMode(w: Widest, geo: Geo, last: number | null): TableMode {
  for (let r = 0; r < 5; r++) {
    const regain = last !== null && r < last
    const m = modeAt(w, r, regain ? geo.budget - HYSTERESIS : geo.budget, geo.full)
    if (!m) continue
    return regain ? modeAt(w, r, geo.budget, geo.full) ?? m : m
  }
  return modeAt(w, 5, geo.budget, geo.full)!
}

/** The minWidth floors of the columns from WIDE_FROM, in cells: the office-wide widest value by FIT plus the padding cell — so the columns align across the cards. (The task column has none: it takes what is left.) */
export type Floors = { status: number; who: number; model: number; actEmoji: number; actWord: number }

export function floorsOf(w: Widest, mode: TableMode): Floors {
  const floor = (cells: number) => Math.ceil(cells / FIT) + 1
  return {
    status: floor(w.mark + 1), who: floor(EMOJI_CELLS + 1 + widestName(w, mode.nameMax)),
    model: floor(mode.model === 'none' ? 0 : mode.model === 'full' ? w.modelFull : w.modelFamily),
    actEmoji: floor(w.actEmoji), actWord: floor(w.actWord),
  }
}

// ---------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------

export type LineKind = 'border' | 'pad' | 'title' | 'blank' | 'row' | 'more' | 'gap'
/** One drawn line of the office (its index is its y): what it is, whose room, and the agent on a row. */
export type Line = { kind: LineKind; room: string; agent: string | null }
/** A hit rectangle in the reading column's cells (x from the column's left edge: the Client takes the centring margin off the pointer). */
export type Hit = { kind: 'agent' | 'pin' | 'roomDone' | 'moreDone'; id: string; x: number; y: number; w: number; h: number }

/** One agent row of a card: the cells' texts (every one without a plain space: `nb`) and the flags that weight them. */
export type RowView = {
  id: string
  /** The line of the row. */
  y: number
  /** The status cell: the mark (markOf: the badge or the dot) alone, with the focus marker on its inner side when focused — the mark sits at the reading edge either way, so the focus never shifts the dots. */
  status: string
  color: string
  who: string
  /** '' when the mode draws no model column. */
  model: string
  actEmoji: string
  /** '' when the mode draws the emoji alone. */
  actWord: string
  /** The task column's text (the row's short task cut to TASK_MAX): drawn from CENTRE_AT. */
  task: string
  /** Working: the who bold. */
  bold: boolean
  /** Finished: the who (unless failed), the emoji and the task dim. (The model is always dim; the word dim unless working.) */
  dim: boolean
  /** ❌: the who keeps a regular weight. */
  failed: boolean
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
  /** The title line's y, the blank line's, the first row's. */
  titleAt: number
  rows: RowView[]
  /** The `▸ עוד N שסיימו` / `▸ הסתר שסיימו` line, '' when the room draws none. */
  more: string
  moreAt: number
}

export type OfficeModel = { rooms: RoomView[]; lines: Line[]; hits: Hit[]; geo: Geo; mode: TableMode; floors: Floors | null }

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
 * on every render (a card per room, a line per agent). The decor, the width and the mode never change it.
 */
export function rowCount(props: OfficeProps): number {
  let n = 0
  for (const room of props.rooms) n += cardLines(room.agents.length, room.moreLabel !== '')
  return n
}

/** A room's card as its props, the geometry and the mode alone decide it — the title cut, the counts, every row's texts — before the decor and the line map. */
type RoomBase = {
  counts: string
  title: string
  rows: Array<{ id: string; mark: string; color: string; who: string; model: string; actEmoji: string; actWord: string; task: string; bold: boolean; dim: boolean; failed: boolean }>
}
/**
 * THE ROOM MEMO: a surface module keeps one across its renders (office-client.tsx), so a redraw rebuilds the base of a room
 * only when that room's props, the width or the mode changed — a poll that changes one room leaves the others' texts as they
 * were, and a decor change (a hover, the focus, a pulse) measures no text at all; the office-wide widest values are kept
 * the same way (`office`), measured again only when a room changed. `builds` counts the bases built, `measures` the
 * office-wide measurements (the tests' guards).
 */
export type RoomCache = { rooms: Map<string, { key: string; base: RoomBase }>; office: { key: string; widest: Widest } | null; builds: number; measures: number }
export function roomCache(): RoomCache {
  return { rooms: new Map(), office: null, builds: 0, measures: 0 }
}

const modeKey = (m: TableMode): string => `${m.word ? 'w' : 'e'}|${m.model}|${m.nameMax}`

function roomBase(room: OfficeRoom, geo: Geo, mode: TableMode, cache: RoomCache | undefined, json: string): RoomBase {
  // (the key is the room's JSON: cheap next to the text measuring it saves, and exact — a props object is new on every render)
  const key = cache ? `${geo.W}\n${modeKey(mode)}\n${json}` : ''
  if (cache) {
    const hit = cache.rooms.get(room.id)
    if (hit && hit.key === key) return hit.base
  }
  const counts = countsFor(room, geo, room.pinned)
  const base: RoomBase = {
    counts: nb(counts), title: nb(cutTitle(room.title, geo, counts, room.pinned)),
    rows: room.agents.map(a => ({
      id: a.id, mark: markOf(a), color: DOT_FG[a.status], who: nb(`${a.emoji} ${cut(a.name, mode.nameMax)}`),
      model: mode.model === 'none' ? '' : nb(modelText(a.model, mode.model === 'full')),
      actEmoji: firstGlyph(a.act), actWord: mode.word ? nb(restWord(a.act)) : '', task: nb(cut(a.task, TASK_MAX)),
      bold: a.status === 'running', dim: a.status === 'done', failed: a.failed,
    })),
  }
  if (cache) {
    cache.rooms.set(room.id, { key, base })
    cache.builds += 1
  }
  return base
}

/**
 * The rooms as cards, the line map and the hit rectangles of the whole office. Card lines, in order: the top border, a
 * padding line, the title (pin · title · counts), the blank line, one line per agent, [a blank line, the more / hide line],
 * a padding line, the bottom border, the gap. A row's hit is the column's whole width; so is the more line's; the title line
 * keeps pinZone cells at the reading edge for the pin and the counts' zone (countsZone) at the other edge for the room's ✅
 * toggle (when the room has finished agents). The decor changes only the pin of the head it hovers, the focus marker and
 * the pulse flags — never a line, never a hit. The table mode is chosen once for the office (chooseMode) from `last`, the
 * rank the caller kept from its previous model (the hysteresis; null on the first). With a `cache` (THE ROOM MEMO), a room
 * whose props, width and mode did not change is not measured again, nor is the office when no room changed.
 */
export function officeModel(props: OfficeProps, decor: OfficeDecor = NO_DECOR, cache?: RoomCache, last: number | null = null): OfficeModel {
  const { rtl } = props
  const geo = geometry(props.columns)
  const jsons = props.rooms.map(r => (cache ? JSON.stringify(r) : ''))
  let widest: Widest
  if (cache) {
    const key = jsons.join('\u0000')
    if (cache.office && cache.office.key === key) widest = cache.office.widest
    else {
      widest = officeWidest(props.rooms)
      cache.office = { key, widest }
      cache.measures += 1
    }
  } else widest = officeWidest(props.rooms)
  const mode = chooseMode(widest, geo, last)
  const floors = geo.wide ? floorsOf(widest, mode) : null
  const rooms: RoomView[] = []
  const lines: Line[] = []
  const hits: Hit[] = []
  const line = (kind: LineKind, room: string, agent: string | null = null) => { lines.push({ kind, room, agent }) }
  const seen = new Set<string>()
  const pz = pinZone(geo)
  props.rooms.forEach((room, i) => {
    seen.add(room.id)
    const top = lines.length
    const base = roomBase(room, geo, mode, cache, jsons[i]!)
    const { counts } = base
    line('border', room.id)
    line('pad', room.id)
    const titleAt = lines.length
    line('title', room.id)
    hits.push({ kind: 'pin', id: room.id, x: rtl ? Math.max(0, geo.W - pz) : 0, y: titleAt, w: pz, h: 1 })
    if (room.done) {
      const cw = countsZone(counts, geo)
      hits.push({ kind: 'roomDone', id: room.id, x: rtl ? 0 : Math.max(0, geo.W - cw), y: titleAt, w: cw, h: 1 })
    }
    line('blank', room.id)
    const rows: RowView[] = []
    for (const r of base.rows) {
      const y = lines.length
      const focus = decor.focus === r.id
      // the mark at the reading edge, the marker on its inner side when focused (a Text with no Hebrew is laid left to right)
      const status = !focus ? r.mark : rtl ? `${FOCUS_MARK.rtl}${r.mark}` : `${r.mark}${FOCUS_MARK.ltr}`
      rows.push({ id: r.id, y, status, color: r.color, who: r.who, model: r.model, actEmoji: r.actEmoji, actWord: r.actWord, task: r.task, bold: r.bold, dim: r.dim, failed: r.failed, focus, pulse: decor.pulse.has(r.id) })
      line('row', room.id, r.id)
      hits.push({ kind: 'agent', id: r.id, x: 0, y, w: geo.W, h: 1 })
    }
    let moreAt = -1
    const more = room.moreLabel ? nb(`${MORE_MARK} ${room.moreLabel}`) : ''
    if (more) {
      line('blank', room.id)
      moreAt = lines.length
      line('more', room.id)
      hits.push({ kind: 'moreDone', id: room.id, x: 0, y: moreAt, w: geo.W, h: 1 })
    }
    line('pad', room.id)
    line('border', room.id)
    line('gap', room.id)
    rooms.push({
      id: room.id, top, height: lines.length - top,
      title: base.title, counts,
      pin: room.pinned ? 'bright' : decor.hoverRoom === room.id ? 'dim' : 'none',
      titleAt, rows, more, moreAt,
    })
  })
  if (cache) for (const id of [...cache.rooms.keys()]) if (!seen.has(id)) cache.rooms.delete(id)
  return { rooms, lines, hits, geo, mode, floors }
}

/** The agent or room control under cell (x, y) of the reading column, if any. */
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
