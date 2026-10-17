// Pure layout of the office in text cells. No engine, no `$`: both the hooks
// (content height) and the surface module (drawing, hit-testing) call it.
//
// The office is a list of rows of cells, each row with an id the Client uses
// as its Text key: a room is a head row, ONE ROW PER AGENT (a compact list, as
// a chat list: Asaf's decision of 2026-10-17 after the live check), and a row
// "N more finished" / "Hide finished" when the room holds finished agents past
// the ones it draws. A wide glyph (an emoji) takes EMOJI_CELLS. Every row is
// exactly `columns` wide by construction: the desktop does not enforce
// `wrap: 'truncate'`, so `put` clips and never lets a glyph spill past the last
// column. No clock here: minutes come in the props (a working agent's time field, `tailText`).
//
// THE HEBREW RULE (i18n.ts): the desktop draws a whole row as ONE Text = one
// LTR paragraph, whatever the runs inside it, and the bidi algorithm then
// takes every stretch of Hebrew that is separated only by neutrals (spaces,
// digits, emoji, punctuation) as ONE right-to-left block and mirrors it in
// place — so two Hebrew pieces laid by cell with nothing but neutrals between
// them come out swapped. The layout therefore (1) writes Hebrew that shares a
// row with nothing Latin between it as ONE run in logical order and leaves the
// mirroring to the engine; (2) lays pieces by cell only where a strong Latin
// run (the model pill) or the row's edge separates them (`segments`,
// `blocksOfParts`, `layBlocks`); (3) never draws a Hebrew activity on a row
// whose name is Hebrew unless a Latin pill sits between them; (4) puts a cut
// Hebrew run's ellipsis at its logical start in RTL (a leading neutral lands
// to the LEFT of the mirrored block = after the word for the reader; a
// trailing one before it). `rowRuns` keeps runs apart (`Cell.brk`): the
// Client draws one Text per run, the paragraph is still the whole row.
//
// The decor (the hover, the hop, the walk-in) is the surface module's local
// state handed in as plain data: the layout stays a pure function of
// (props, decor), so the module memoises it by both and the hooks, which only
// need the height, count the rows without building a cell (`rowCount`).

import type { OfficeAgent, OfficeProps, OfficeRoom } from './office-props'

export const EMOJI_CELLS = 2
/** The blank cell at the reading edge of an agent row, before its emoji. */
export const ROW_MARGIN = 1
/** The caps of the props' texts (office-props.ts cuts to them): a card's name, its activity, the model pill's text. */
export const NAME_MAX = 24
export const ACT_MAX = 18   // (the widest activity label whole: `🔎 Searching code` is 17 cells — a row draws an activity whole or as its emoji alone)
export const PILL_MAX = 12
/** A name narrower than this gives way: the pill shortens to its family before the name shrinks further. */
const NAME_MIN = 6
/** The model's version rides its family word from this many columns (`Opus 5.5`); under it the family alone (`Opus`). */
export const MODEL_FULL_FROM = 60
/**
 * The widest gap between a row's last field and its minutes: the tail field sits at the far end while
 * that leaves at most 2 × GAP_MAX + 1 blank cells, else GAP_MAX past the content (wider panes leave
 * the rest of the row blank; the minutes stay aligned per room either way).
 */
const GAP_MAX = 2
const MORE_MARK = '▸'

export type Cell = { ch: string; fg?: string; bg?: string; bold?: true; dim?: true; brk?: true }
export type CellRow = { id: string; cells: Cell[] }
export type Run = { text: string; fg?: string; bg?: string; bold?: true; dim?: true }
export type Hit = { kind: 'agent' | 'pin' | 'roomDone' | 'moreDone'; id: string; x: number; y: number; w: number; h: number }
export type OfficeLayout = { rows: CellRow[]; hits: Hit[] }

/**
 * What the surface module lays on the rows from its local state (spec §7.4), by agent id:
 *   hover    the row under the pointer: HOVER_BG across the whole row;
 *   hop      a `done` fx: ⭐ beside the emoji, the name giving way to it;
 *   entering an `enter` fx and its progress 0 → 1: the emoji and the name walk to the reading
 *            edge from `walkShift(p)` cells inside the row (the name cut by as much).
 */
export type OfficeDecor = { hover: string | null; hop: ReadonlySet<string>; entering: ReadonlyMap<string, number> }
export const NO_DECOR: OfficeDecor = { hover: null, hop: new Set(), entering: new Map() }
/** The hover highlight: a background across the row (a coloured "frame" around a colour emoji does not show). */
export const HOVER_BG = '#2b3350'
/** How far off home a walk-in starts, in cells. */
export const WALK_CELLS = 3
const HOP_STAR = '⭐'

/** The walk-in's distance from home at progress `p` (0 → 1): round((1 - p) × WALK_CELLS); out of range clamped, nonsense home. */
export function walkShift(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.round((1 - Math.max(0, Math.min(1, p))) * WALK_CELLS)
}

/** The model word's colour by family (coloured text, no background — Asaf's cleanup, 2026-10-17). */
export const MODEL_FG: Record<OfficeAgent['modelFam'], string> = { opus: '#a78bfa', sonnet: '#60a5fa', haiku: '#34d399', fable: '#fbbf24', other: '#8b93a8' }
export const STATUS_FG: Record<OfficeAgent['status'], string> = { running: '#7ee29a', stale: '#e6c07e', done: '#9fb0e6' }
const EMOJI_RE = /^\p{Extended_Pictographic}/u
/** Code points that take no cell of their own: combining marks (Hebrew points among them), the variation selectors, the ZWJ, the skin tones. */
const JOIN_RE = /^[\p{M}‍︎️\u{1F3FB}-\u{1F3FF}]$/u
const ZWJ = '‍'
const ELLIPSIS = '…'
/** A Hebrew-script character (a letter, a point, the geresh): the bidi algorithm's right-to-left text. (i18n.ts hebrewRuleOk uses the same classes.) */
const HEBREW_RE = /\p{Script=Hebrew}/u
/** A letter of another script (Latin, Greek, Cyrillic, CJK…): strong left-to-right — it parts two Hebrew blocks, and never rides inside one. */
const LETTER_RE = /(?!\p{Script=Hebrew})\p{L}/u
const DIGIT_RE = /\p{Nd}/u

type Glyph = { ch: string; w: number }

/** `text` as glyphs: a base code point with the marks, selectors and joined code points that ride on it, and its width in cells. */
function glyphs(text: string): Glyph[] {
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

/** The width of `text` in cells. */
function width(text: string): number {
  let w = 0
  for (const g of glyphs(text)) w += g.w
  return w
}

/** The width of `text` in cells, for the surface module's own line wrapping (the chrome's drawer and empty-office text). */
export function textWidth(text: string): number {
  return width(text)
}

export function blankRow(id: string, columns: number): CellRow {
  return { id, cells: Array.from({ length: Math.max(0, columns) }, () => ({ ch: ' ' })) }
}

/**
 * Writes `text` from cell `x`, clipping at the row's end; a wide glyph fills EMOJI_CELLS (its
 * second cell stays ''). Cells before 0 are skipped; a wide glyph that does not fit whole at
 * the end is not drawn at all, so the row never spills past its last column. `brk` marks the
 * first glyph as the start of a run of its own (rowRuns never merges it into the cell before).
 */
export function put(row: CellRow, x: number, text: string, style: Omit<Cell, 'ch' | 'brk'> = {}, brk = false): void {
  let i = x
  let first = brk
  for (const g of glyphs(text)) {
    if (i + g.w > row.cells.length) break
    if (i >= 0) row.cells[i] = { ch: g.ch, ...style, ...(first ? { brk: true as const } : {}) }
    for (let k = 1; k < g.w; k++) if (i + k >= 0) row.cells[i + k] = { ch: '', ...style }
    if (i >= 0) first = false
    i += g.w
  }
}

/** `s` cut to at most `max` cells, whole glyphs only, with an ellipsis when something was dropped. (Exported for office-props.ts's caps.) */
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

/** One run laid by cell: its text (logical order), its width, the blank cells before it, its style. */
type Block = { text: string; w: number; gap: number; style: Omit<Cell, 'ch' | 'brk'> }

/**
 * `text` as the runs the bidi algorithm lets the layout place by cell, in logical order: a Hebrew
 * run (a Hebrew letter first, then anything but another script's letter — digits and punctuation
 * ride inside; a run of digits right before it, such as a title's leading `4`, rides inside too, so
 * the two are never two blocks the engine would merge and swap), a run of another script's letters
 * (with its digits and neutrals), or a run of neutrals alone (a leading emoji, which the engine
 * leaves where it is laid). A new run starts at a Hebrew letter after a run without, and at another
 * script's letter inside a Hebrew run. The spaces between two runs are `gap` cells drawn blank
 * before the run (never inside a run, so a Hebrew run never starts with a space).
 */
export function segments(text: string): Array<{ text: string; w: number; gap: number }> {
  const out: Array<{ text: string; w: number; gap: number; he: boolean; neutral: boolean }> = []
  let cur: { text: string; w: number; he: boolean; neutral: boolean } | null = null
  let spaces = 0
  let gap = 0
  const close = () => {
    if (!cur) return
    const last = out[out.length - 1]
    // a run of neutrals holding a digit, right before a Hebrew run: one run (`4 קבצים`), in logical order
    if (last && last.neutral && DIGIT_RE.test(last.text) && cur.he) {
      last.text += ' '.repeat(gap) + cur.text
      last.w += gap + cur.w
      last.he = true
      last.neutral = false
    } else out.push({ ...cur, gap })
    cur = null
  }
  for (const g of glyphs(text)) {
    if (g.ch === ' ') { spaces++; continue }
    const he = HEBREW_RE.test(g.ch)
    const letter = he || LETTER_RE.test(g.ch)
    const fresh = !cur || (he && !cur.he) || (!he && cur.he && letter)
    if (fresh) {
      close()
      gap = spaces
      cur = { text: g.ch, w: g.w, he, neutral: !letter }
    } else {
      cur!.text += ' '.repeat(spaces) + g.ch
      cur!.w += spaces + g.w
      if (letter) cur!.neutral = false
    }
    spaces = 0
  }
  close()
  return out.map(s => ({ text: s.text, w: s.w, gap: s.gap }))
}

/**
 * Lays `blocks` into the field [x, x + w) in reading order — from the left in LTR, from the right in
 * RTL (the first block at the field's reading edge) — each a run of its own. A block's text keeps its
 * logical order: the engine mirrors a Hebrew block in place. In RTL a Hebrew block's trailing ellipsis
 * moves to its start (a leading neutral lands at the left of the mirrored block: after the word for
 * the reader). A field off the row is not drawn; what runs past it is clipped by `put`.
 */
function layBlocks(row: CellRow, x: number, w: number, blocks: readonly Block[], rtl: boolean): void {
  if (w < 1 || x < 0 || x >= row.cells.length) return
  let r = 0
  for (const b of blocks) {
    r += b.gap
    put(row, rtl ? x + w - r - b.w : x + r, rtl ? ellipsisFirst(b.text) : b.text, b.style, true)
    r += b.w
  }
}

/**
 * A cut Hebrew text with its ellipsis moved to its start — for an RTL Text: a leading neutral lands at
 * the left of the mirrored block, after the word for the reader; a trailing one before it. A text without
 * Hebrew, or not ending in an ellipsis, is returned as it is. (The Client applies it to its plain Texts.)
 */
export function ellipsisFirst(text: string): string {
  return text.endsWith(ELLIPSIS) && HEBREW_RE.test(text) ? ELLIPSIS + text.slice(0, -ELLIPSIS.length) : text
}

/**
 * Writes one text into the field [x, x + w): cut to the field (whole glyphs), then its runs
 * (`segments`) laid by cell in reading order (`layBlocks`). A Hebrew name, a title, an activity.
 */
export function place(row: CellRow, x: number, w: number, text: string, style: Omit<Cell, 'ch' | 'brk'>, rtl: boolean): void {
  layBlocks(row, x, w, segments(cut(text, w)).map(s => ({ ...s, style })), rtl)
}

/** A piece of a chrome line (office-client.tsx): its text and style. */
export type Part = { text: string; fg?: string; bg?: string; bold?: true; dim?: true }

/**
 * The parts of a chrome line as the runs the engine will not swap: from a part holding Hebrew to the
 * last Hebrew part before one with another script's letter — the neutral parts between them and the
 * digit parts right after (`סיימו 6`) — is ONE run in logical order, a space apart, in the first
 * part's style (the engine mirrors the whole block; a count after its word stays with it); every
 * other part is a run of its own, laid by cell. (Exported for the tests.)
 */
export function blocksOfParts(parts: readonly Part[]): Block[] {
  const out: Block[] = []
  const he = parts.map(p => HEBREW_RE.test(p.text))
  const lt = parts.map(p => LETTER_RE.test(p.text))
  const digits = parts.map(p => /^\p{Nd}+$/u.test(p.text))
  let i = 0
  while (i < parts.length) {
    const { text, ...style } = parts[i]!
    let last = i
    if (he[i]) {
      for (let k = i + 1; k < parts.length && !lt[k]; k++) if (he[k]) last = k
      while (last + 1 < parts.length && digits[last + 1]) last++
    }
    const joined = parts.slice(i, last + 1).map(p => p.text).join(' ')
    out.push({ text: joined, w: width(joined), gap: out.length ? 1 : 0, style })
    i = last + 1
  }
  return out
}

/**
 * One line of the chrome as a cell row: the parts laid in reading order a space apart (from the
 * right in RTL) as the runs of `blocksOfParts`; what does not fit is cut with an ellipsis (the last
 * block that fits in part, the rest dropped). The Client draws it as it draws a layout row, one Text
 * per run.
 */
export function lineRow(id: string, columns: number, parts: readonly Part[], rtl: boolean): CellRow {
  const row = blankRow(id, columns)
  const blocks: Block[] = []
  let r = 0
  for (const b of blocksOfParts(parts)) {
    const room = columns - r - b.gap
    if (room < 1) break
    if (b.w > room) {
      const text = cut(b.text, room)
      blocks.push({ ...b, text, w: width(text) })
      break
    }
    blocks.push(b)
    r += b.gap + b.w
  }
  layBlocks(row, 0, columns, blocks, rtl)
  return row
}

/** Neighbouring cells with the same style merged into one run (the Client draws one Text per run); a `brk` cell starts a run. */
export function rowRuns(cells: readonly Cell[]): Run[] {
  const runs: Run[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && !c.brk && last.fg === c.fg && last.bg === c.bg && last.bold === c.bold && last.dim === c.dim) last.text += c.ch
    else runs.push({ text: c.ch, ...(c.fg ? { fg: c.fg } : {}), ...(c.bg ? { bg: c.bg } : {}), ...(c.bold ? { bold: true } : {}), ...(c.dim ? { dim: true } : {}) })
  }
  return runs
}

/** The model's word: the family alone (`Opus`; `?` unknown) or, `full`, the label with its version (`Opus 5.5`, cut to PILL_MAX). */
export function modelText(model: string, full = false): string {
  const label = full ? model : model.split(' ')[0] ?? model
  return cut(label || '?', PILL_MAX)
}

/** The first glyph of a text: an activity's emoji, drawn alone when the word has no room (or a finished agent's ✅). */
export function firstGlyph(text: string): string {
  return glyphs(text)[0]?.ch ?? ''
}

/** The clock of a working agent's time field (with its emoji presentation selector: U+23F1 alone is a text-style glyph). */
export const CLOCK = '⏱️'
/**
 * What follows the minutes in a row's time field, per language: ` min` in English (`⏱️ 3 min`); the prime in Hebrew
 * (`⏱️ 3′`, read from the right as the clock then the number). Not `דק׳`: under THE HEBREW RULE (one LTR paragraph, no
 * control marks) a Hebrew unit can never land after its number for the reader — laid after the number in cells, the
 * engine leaves the number at the left (`⏱️ 3 דק׳` reads "דק׳ 3 ⏱️"); laid before it, the number glues to the unit and
 * is mirrored with it ("⏱️ דק׳ 3"). The number always lands at the unit's left, whichever way the cells go: derived
 * from the bidi rules the tests model (office-layout.test.ts visualRtlReading). (i18n.ts rowMinutes carries the same.)
 */
export const ROW_MINUTES: Readonly<Record<OfficeProps['lang'], string>> = { en: ' min', he: '′' }

/**
 * The time of a working agent (`status` not `done`, minutes known): `⏱️ 3 min` / `⏱️ <1 min` in English, `⏱️ 3′` /
 * `⏱️ <1′` in Hebrew — in cell order the clock first in LTR, LAST in RTL (`3′ ⏱️`: the reader, from the right, sees the
 * clock then the number; the number at the row's left edge, after nothing Hebrew, stays left-to-right). A finished
 * agent has no time on its row (its duration is the drawer's); unknown minutes none either.
 */
export function timeText(a: OfficeAgent, rtl: boolean, lang: OfficeProps['lang']): string {
  if (a.status === 'done' || a.startMin === null) return ''
  const n = `${a.startMin < 1 ? '<1' : a.startMin}${ROW_MINUTES[lang]}`
  return rtl ? `${n} ${CLOCK}` : `${CLOCK} ${n}`
}

/**
 * The row's end: the badges ❌⭐⏰ and, `withTime` (the room's field has room for it), the time (`timeText`), the time
 * outermost in both directions, a space between the two — in cell order `❌⭐⏰ ⏱️ 7 min` in LTR (the time at the right
 * edge), `7′ ⏱️ ❌⭐⏰` in RTL (the time at the left edge). A finished agent: its badges alone. (The lead carries no
 * mark on its row: Asaf's cleanup.)
 */
export function tailText(a: OfficeAgent, rtl: boolean, lang: OfficeProps['lang'], withTime = true): string {
  const badges = `${a.failed ? '❌' : ''}${a.star ? '⭐' : ''}${a.longRunning ? '⏰' : ''}`
  const time = withTime ? timeText(a, rtl, lang) : ''
  const gap = badges && time ? ' ' : ''
  return rtl ? `${time}${gap}${badges}` : `${badges}${gap}${time}`
}

/** The widths a room's rows share (so names, models, activities and minutes line up down the room), resolved for `columns`; `time`: the tail field holds the time. */
type Fields = { name: number; pill: 'full' | 'short' | 'none'; pillW: number; act: number; tail: number; tailAt: number; time: boolean }

/** The cells before a row's name: the margin, the emoji, a space. */
const HEAD = ROW_MARGIN + EMOJI_CELLS + 1

/** What a row draws of its activity: the label whole, its emoji alone, or nothing (a finished agent's is its ✅ alone). */
function actText(a: OfficeAgent, cells: number, wordAllowed: boolean): string {
  const whole = a.status === 'done' ? firstGlyph(a.act) : a.act
  if (cells >= width(whole) && (wordAllowed || whole === firstGlyph(a.act))) return whole
  const emoji = firstGlyph(a.act)
  return cells >= width(emoji) && !/\p{L}/u.test(emoji) ? emoji : ''
}

/**
 * The fields of a room's rows at `columns`: each the widest of the room (capped) — the name field
 * never past what the model word and an activity emoji leave it — then shrunk until every row fits,
 * in this order: (0) the time away, whole (an agent's time field is drawn whole or not at all, and
 * gives way before the activity word), (1) the activity to its emoji alone (an activity is drawn
 * whole or as its emoji, never cut mid-word), (2) the name down to NAME_MIN, (3) the activity away,
 * (4) the name to a glyph, (5) the model away — then the time back when the shrunk fields leave it
 * room (the word did not fit even without it). The model word carries its version only from
 * MODEL_FULL_FROM columns and when every field, the time with them, still fits. The tail keeps a
 * field of the room's widest tail at the far end, or GAP_MAX past the last field when the pane is
 * wider than the content (the rest of the row stays blank: no gap grows with the pane).
 */
function roomFields(room: OfficeRoom, columns: number, rtl: boolean, lang: OfficeProps['lang']): Fields {
  let name0 = 0
  let full = 0
  let short = 0
  let act0 = 0
  let tailFull = 0   // the widest tail with the time
  let tailBare = 0   // the widest tail of badges alone
  for (const a of room.agents) {
    name0 = Math.max(name0, Math.min(NAME_MAX, width(a.name)))
    full = Math.max(full, width(modelText(a.model, true)))
    short = Math.max(short, width(modelText(a.model)))
    act0 = Math.max(act0, Math.min(ACT_MAX, width(a.status === 'done' ? firstGlyph(a.act) : a.act)))
    tailFull = Math.max(tailFull, width(tailText(a, rtl, lang)))
    tailBare = Math.max(tailBare, width(tailText(a, rtl, lang, false)))
  }
  const need = (n: number, p: number, a: number) => n + (p > 0 ? 1 + p : 0) + (a > 0 ? 1 + a : 0)
  const budgetOf = (t: number) => columns - HEAD - (t > 0 ? 1 + t : 0)
  const hasTime = room.agents.some(a => timeText(a, rtl, lang) !== '')   // a working agent with known minutes in the room
  let time = hasTime
  let tail = tailFull
  let budget = budgetOf(tail)
  const cap = () => Math.min(name0, Math.max(NAME_MIN, budget - short - 1 - EMOJI_CELLS - 1))
  let name = cap()
  let act = act0
  let pill: Fields['pill'] = columns >= MODEL_FULL_FROM && need(name, full, act) <= budget ? 'full' : 'short'
  let pillW = pill === 'full' ? full : short
  const over = () => need(name, pillW, act) > budget
  if (over() && time) { time = false; tail = tailBare; budget = budgetOf(tail); name = cap() }                   // (0)
  if (over()) act = Math.min(act0, EMOJI_CELLS)                                                           // (1)
  if (over()) name = Math.max(Math.min(NAME_MIN, name0), Math.min(name, budget - 1 - pillW - 1 - act))   // (2)
  if (over()) act = 0                                                                                     // (3)
  if (over()) name = Math.max(0, Math.min(name0, budget - 1 - pillW))                                     // (4)
  if (name < 1 || over()) { pill = 'none'; pillW = 0; name = Math.max(0, Math.min(name0, budget)) }      // (5)
  if (hasTime && !time && need(name, pillW, act) <= budgetOf(tailFull)) { time = true; tail = tailFull }   // the time back
  const content = HEAD + need(name, pillW, act)
  // the tail field: at the far end while that leaves at most 2 × GAP_MAX + 1 blank cells, else GAP_MAX past the content
  const far = columns - tail
  const tailAt = far - content - 1 <= 2 * GAP_MAX ? Math.max(content, far) : content + 1 + GAP_MAX
  return { name, pill, pillW, act, tail, tailAt, time }
}

/** The cell `x` of a field of `w` cells at reading offset `r` (0 at the reading edge). */
function at(r: number, w: number, columns: number, rtl: boolean): number {
  return rtl ? columns - r - w : r
}

/**
 * One agent row: in reading order the margin, the emoji (⭐ before it during the hop; both shifted
 * inside by the walk-in), the name (bold, status colour; it gives way to the decor), the model word
 * (its family colour), the activity (status colour), then the badges and the time (dim) at the room's
 * tail field. A finished agent's row is dim, its activity its ✅ alone. The hover lays HOVER_BG across
 * the whole row. The decor moves nothing but this row's own cells.
 */
function agentRow(row: CellRow, a: OfficeAgent, f: Fields, columns: number, selected: boolean, rtl: boolean, lang: OfficeProps['lang'], decor: OfficeDecor): void {
  const fg = STATUS_FG[a.status]
  const dimmed = a.status === 'done' ? { dim: true as const } : {}
  const glyph = decor.hop.has(a.id) ? `${HOP_STAR}${a.emoji}` : a.emoji
  const gw = width(glyph)
  const p = decor.entering.get(a.id)
  // the emoji may walk as far as the name field lets it: it never covers the pill (nor the tail, which follows the name)
  const shift = Math.max(0, Math.min(p === undefined ? 0 : walkShift(p), f.name + HEAD - ROW_MARGIN - gw))
  const extra = shift + gw - EMOJI_CELLS
  put(row, at(ROW_MARGIN + shift, gw, columns, rtl), glyph, selected ? { fg: '#ffffff', bold: true } : {}, true)
  const nameDrawn = f.name - extra > 0 ? cut(a.name, f.name - extra) : ''
  if (nameDrawn) place(row, at(HEAD + extra, f.name - extra, columns, rtl), f.name - extra, a.name, { fg, bold: true, ...dimmed }, rtl)
  let r = HEAD + f.name
  let parted = false   // a Latin model word between the name and the activity: the engine keeps two Hebrew words apart only across it
  const pill = f.pill === 'none' ? '' : modelText(a.model, f.pill === 'full')
  if (pill) {
    put(row, at(r + 1, width(pill), columns, rtl), pill, { fg: MODEL_FG[a.modelFam], ...dimmed }, true)
    parted = LETTER_RE.test(pill)
    r += 1 + f.pillW
  }
  let act = ''
  if (f.act > 0) {
    // THE HEBREW RULE (3): a Hebrew activity beside a Hebrew name with no Latin between them would be mirrored with it as one
    // block (`?` model, or none): the row draws the activity's emoji alone then — as it does when the word has no room
    act = actText(a, f.act, !(HEBREW_RE.test(a.act) && HEBREW_RE.test(a.name) && !parted))
    if (act) place(row, at(r + 1, f.act, columns, rtl), f.act, act, { fg, ...dimmed }, rtl)
    r += 1 + f.act
  }
  // THE HEBREW RULE (5), LTR only: digits after a Hebrew block with nothing Latin between them join it (the engine keeps a
  // number after Hebrew right-to-left, through any neutrals), so the time would be mirrored next to the name — the row
  // keeps its badges and drops the time then (a Latin pill or an English activity parts them; in RTL the tail comes first)
  let tail = tailText(a, rtl, lang, f.time)
  if (!rtl && DIGIT_RE.test(tail) && hebrewUnparted(nameDrawn, pill, act)) tail = tailText(a, rtl, lang, false)
  const tw = width(tail)
  if (tw > 0) put(row, at(f.tailAt + f.tail - tw, tw, columns, rtl), tail, { dim: true }, true)
  if (decor.hover === a.id) for (let i = 0; i < row.cells.length; i++) row.cells[i] = { ...row.cells[i]!, bg: HOVER_BG }
}

/** Whether the row's last drawn Hebrew letter (in its name, its pill or its activity, as cut) has no letter of another script drawn after it. */
function hebrewUnparted(...drawn: string[]): boolean {
  let hebrew = false
  let parted = false
  for (const s of drawn) {
    const last = [...s.matchAll(/\p{Script=Hebrew}/gu)].pop()
    if (last) { hebrew = true; parted = LETTER_RE.test(s.slice(last.index)) } else if (LETTER_RE.test(s)) parted = true
  }
  return hebrew && !parted
}

/** Whether a room draws the "more / hide finished" row under its agents. */
function moreRow(room: OfficeRoom): boolean {
  return room.moreLabel !== ''
}

/**
 * The number of rows `layoutOffice(props)` lays out, without building a cell: what the hooks
 * need for the Client's height on every render (a head per room, a row per agent, the "more /
 * hide finished" row, a gap between rooms). The decor and the width never change it.
 */
export function rowCount(props: OfficeProps): number {
  let n = 0
  for (let r = 0; r < props.rooms.length; r++) {
    const room = props.rooms[r]!
    n += (r > 0 ? 1 : 0) + 1 + room.agents.length + (moreRow(room) ? 1 : 0)
  }
  return n
}

/**
 * The rows and hit rectangles of the whole office: per room a head row (pin, title, counts;
 * the pin first, so at the right edge in RTL), a row per agent (the props carry the agents the
 * room shows), the "more / hide finished" row when the room has one, and one blank row between
 * rooms. Row ids: `room:<id>:head`, `room:<id>:a:<n>`, `room:<id>:more`, `room:<id>:gap`. An
 * agent's hit is its whole row; so is the more row's. The decor changes only the cells of the
 * agent rows it names; never a hit, never a row's width.
 */
export function layoutOffice(props: OfficeProps, decor: OfficeDecor = NO_DECOR): OfficeLayout {
  const rows: CellRow[] = []
  const hits: Hit[] = []
  const { columns, rtl, lang } = props
  for (let r = 0; r < props.rooms.length; r++) {
    const room = props.rooms[r]!
    if (r > 0) rows.push(blankRow(`room:${props.rooms[r - 1]!.id}:gap`, columns))
    const head = blankRow(`room:${room.id}:head`, columns)
    const counts = `🟢${room.run}${room.stale ? ` ⏳${room.stale}` : ''}${room.done ? ` ✅${room.done}` : ''}`
    const cw = Math.min(width(counts), columns)
    const pin = room.pinned ? '📌' : '○'
    const titleW = columns - EMOJI_CELLS - 1 - cw - 1
    const y = rows.length
    const px = at(0, EMOJI_CELLS, columns, rtl)
    put(head, px, pin, {}, true)
    // RTL: the pin at the right edge, the title against it, the counts at the left edge. LTR: the pin, the counts, THEN the
    // title (a Hebrew title before the counts would take their digits into its mirrored block: THE HEBREW RULE (5))
    const cx = rtl ? 0 : EMOJI_CELLS + 1
    place(head, rtl ? at(EMOJI_CELLS + 1, titleW, columns, rtl) : cx + cw + 1, titleW, room.title, { bold: true }, rtl)
    put(head, cx, counts, {}, true)
    hits.push({ kind: 'pin', id: room.id, x: Math.max(0, px), y, w: EMOJI_CELLS, h: 1 })
    if (room.done) hits.push({ kind: 'roomDone', id: room.id, x: cx, y, w: cw, h: 1 })
    rows.push(head)
    const fields = roomFields(room, columns, rtl, lang)
    room.agents.forEach((a, i) => {
      const row = blankRow(`room:${room.id}:a:${i}`, columns)
      agentRow(row, a, fields, columns, props.selected === a.id, rtl, lang, decor)
      hits.push({ kind: 'agent', id: a.id, x: 0, y: rows.length, w: columns, h: 1 })
      rows.push(row)
    })
    if (moreRow(room)) {
      const row = blankRow(`room:${room.id}:more`, columns)
      put(row, at(ROW_MARGIN, 1, columns, rtl), MORE_MARK, { dim: true }, true)
      const lw = columns - ROW_MARGIN - 2
      place(row, at(ROW_MARGIN + 2, lw, columns, rtl), lw, room.moreLabel, { fg: STATUS_FG.done }, rtl)
      hits.push({ kind: 'moreDone', id: room.id, x: 0, y: rows.length, w: columns, h: 1 })
      rows.push(row)
    }
  }
  return { rows, hits }
}

/** The agent or room button under cell (x, y) of the unwindowed layout, if any. */
export function hitAt(layout: OfficeLayout, x: number, y: number): Hit | undefined {
  return layout.hits.find(hit => x >= hit.x && x < hit.x + hit.w && y >= hit.y && y < hit.y + hit.h)
}

/** Rows [offset, offset + count), the offset clamped so the window stays inside the content. */
export function windowRows(layout: OfficeLayout, offset: number, count: number): CellRow[] {
  const from = Math.max(0, Math.min(offset, Math.max(0, layout.rows.length - count)))
  return layout.rows.slice(from, from + Math.max(0, count))
}
