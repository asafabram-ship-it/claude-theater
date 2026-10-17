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
// column. No clock here: minutes come in the props.
//
// THE HEBREW RULE (i18n.ts): the desktop draws a Text as an LTR paragraph, so
// a run holding Hebrew reads right only when it starts with a Hebrew letter and
// holds no Latin letter. `place` writes every text as RUNS by script — a Hebrew
// run, a Latin run, a neutral run (an emoji, a digit) — each placed by cell
// position in reading order (from the right in RTL), and `rowRuns` keeps them
// apart (`Cell.brk`), so the Client draws one Text per run and the engine
// never sees a Hebrew word behind a digit or beside a Latin one.
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
export const ACT_MAX = 16
export const PILL_MAX = 12
/** A name narrower than this gives way: the pill shortens to its family before the name shrinks further. */
const NAME_MIN = 6
/** The activity needs this many cells to be worth drawing (an emoji and an ellipsis), else the row drops it. */
const ACT_MIN = 3
/** The widest gap between a row's last field and its minutes (wider panes leave the rest blank, the minutes aligned per room). */
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

export const MODEL_BG: Record<OfficeAgent['modelFam'], string> = { opus: '#7b5cf0', sonnet: '#2f7fe8', haiku: '#1fa876', fable: '#d9872b', other: '#3a4470' }
export const STATUS_FG: Record<OfficeAgent['status'], string> = { running: '#7ee29a', stale: '#e6c07e', done: '#9fb0e6' }
const EMOJI_RE = /^\p{Extended_Pictographic}/u
/** Code points that take no cell of their own: combining marks (Hebrew points among them), the variation selectors, the ZWJ, the skin tones. */
const JOIN_RE = /^[\p{M}‍︎️\u{1F3FB}-\u{1F3FF}]$/u
const ZWJ = '‍'
const ELLIPSIS = '…'
const HEBREW_RE = /^\p{Script=Hebrew}/u
/** A strong left-to-right letter that is not Hebrew (Latin, Greek, Cyrillic, CJK…): its own run, never inside a Hebrew one. */
const LETTER_RE = /^\p{L}/u

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

type Segment = { text: string; w: number; gap: number }

/**
 * `text` as the runs THE HEBREW RULE allows, in logical order: a Hebrew run (a Hebrew letter first,
 * then anything but another script's letter — digits and punctuation ride inside) or a run without
 * Hebrew (Latin with its digits and neutrals, or neutrals alone: a leading emoji, a leading digit —
 * an LTR paragraph draws these right whatever they start with). A new run starts at a Hebrew letter
 * after a run without, and at another script's letter inside a Hebrew run. The spaces between two
 * runs are `gap` cells drawn blank before the run (never inside a run, so a Hebrew run never starts
 * with a space).
 */
export function segments(text: string): Segment[] {
  const out: Segment[] = []
  let cur: { text: string; w: number; he: boolean } | null = null
  let spaces = 0
  let gap = 0
  const close = () => {
    if (!cur) return
    out.push({ text: cur.text, w: cur.w, gap })
    cur = null
  }
  for (const g of glyphs(text)) {
    if (g.ch === ' ') { spaces++; continue }
    const he = HEBREW_RE.test(g.ch)
    const fresh = !cur || (he && !cur.he) || (!he && cur.he && LETTER_RE.test(g.ch))
    if (fresh) {
      close()
      gap = spaces
      cur = { text: g.ch, w: g.w, he }
    } else {
      cur!.text += ' '.repeat(spaces) + g.ch
      cur!.w += spaces + g.w
    }
    spaces = 0
  }
  close()
  return out
}

/**
 * Writes `text` into the field [x, x + w) as its runs (`segments`), each a run of its own, laid in
 * reading order: from the left in LTR, from the right in RTL (the first run at the field's reading
 * edge; a run's text keeps its own glyph order, the engine draws a Hebrew run right to left by
 * itself). Cut to the field first, whole glyphs. A field off the row is not drawn.
 */
export function place(row: CellRow, x: number, w: number, text: string, style: Omit<Cell, 'ch' | 'brk'>, rtl: boolean): void {
  if (w < 1 || x < 0 || x >= row.cells.length) return
  let r = 0
  for (const s of segments(cut(text, w))) {
    r += s.gap
    put(row, rtl ? x + w - r - s.w : x + r, s.text, style, true)
    r += s.w
  }
}

/** A piece of a chrome line (office-client.tsx): its text and style. */
export type Part = { text: string; fg?: string; bg?: string; bold?: true; dim?: true }

/**
 * One line of the chrome as a cell row: the parts laid in reading order a space apart (from the
 * right in RTL), each in its own runs (`place`), the last one that does not fit cut with an
 * ellipsis and the rest dropped. The Client draws it as it draws a layout row, one Text per run.
 */
export function lineRow(id: string, columns: number, parts: readonly Part[], rtl: boolean): CellRow {
  const row = blankRow(id, columns)
  let r = 0
  for (const p of parts) {
    const { text, ...style } = p
    const w = Math.min(width(text), columns - r)
    if (w < 1) break
    place(row, at(r, w, columns, rtl), w, text, style, rtl)
    r += w + 1
  }
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

/** The model pill's text: ` Opus 5.5 ` (the label cut to PILL_MAX); `short`: the family alone, ` Opus ` (an unknown label stays whole). */
export function pillText(model: string, short = false): string {
  const label = short ? model.split(' ')[0] ?? model : model
  return ` ${cut(label || '?', PILL_MAX)} `
}

/**
 * The row's end: the minutes (`7′`, `<1′`, nothing when unknown) and the badges ❌⭐⏰ (💬 marks the
 * lead), the minutes outermost in both directions — in cell order `❌⭐⏰7′` in LTR (the minutes at the
 * right edge), `7′❌⭐⏰` in RTL (the minutes at the left edge).
 */
export function tailText(a: OfficeAgent, rtl: boolean): string {
  const badges = `${a.failed ? '❌' : ''}${a.star ? '⭐' : ''}${a.longRunning ? '⏰' : ''}${a.isLead ? '💬' : ''}`
  const mins = a.startMin === null ? '' : a.startMin < 1 ? '<1′' : `${a.startMin}′`
  return rtl ? `${mins}${badges}` : `${badges}${mins}`
}

/** The widths a room's rows share (so names, pills, activities and minutes line up down the room), resolved for `columns`. */
type Fields = { name: number; pill: 'full' | 'short' | 'none'; pillW: number; act: number; tail: number; tailAt: number }

/** The cells before a row's name: the margin, the emoji, a space. */
const HEAD = ROW_MARGIN + EMOJI_CELLS + 1

/**
 * The fields of a room's rows at `columns`: each the widest of the room (capped), then shrunk until
 * every row fits — the activity first (to nothing under ACT_MIN), then the name down to NAME_MIN,
 * then the pill to its family, then the name to a glyph, then the pill away. The minutes keep a
 * field of the room's widest tail at the far end, or GAP_MAX past the last field when the pane is
 * wider than the content (the rest of the row stays blank: no gap grows with the pane).
 */
function roomFields(room: OfficeRoom, columns: number, rtl: boolean): Fields {
  let name = 0
  let full = 0
  let short = 0
  let act = 0
  let tail = 0
  for (const a of room.agents) {
    name = Math.max(name, Math.min(NAME_MAX, width(a.name)))
    full = Math.max(full, width(pillText(a.model)))
    short = Math.max(short, width(pillText(a.model, true)))
    act = Math.max(act, Math.min(ACT_MAX, width(a.act)))
    tail = Math.max(tail, width(tailText(a, rtl)))
  }
  const budget = columns - HEAD - (tail > 0 ? 1 + tail : 0)
  const need = (n: number, p: number, a: number) => n + (p > 0 ? 1 + p : 0) + (a > 0 ? 1 + a : 0)
  const name0 = name
  let pill: Fields['pill'] = 'full'
  let pillW = full
  if (need(name, pillW, act) > budget) {
    // the activity gives way first: cut, then dropped
    act = budget - name - 1 - pillW - 1
    if (act < ACT_MIN) act = 0
    if (need(name, pillW, act) > budget) {
      // then the name, down to NAME_MIN; then the pill to its family (the name regaining what it can); then the pill away
      name = budget - 1 - pillW
      if (name < NAME_MIN) {
        pill = 'short'
        pillW = short
        name = Math.min(name0, budget - 1 - pillW)
        if (name < 1) {
          pill = 'none'
          pillW = 0
          name = Math.min(name0, budget)
        }
      }
      if (name < 0) name = 0
    }
  }
  const content = HEAD + need(name, pillW, act)
  // the tail field: at the far end while the pane is near the content's width, else GAP_MAX past the content
  const far = columns - tail
  const tailAt = far - content - 1 <= 2 * GAP_MAX ? Math.max(content, far) : content + 1 + GAP_MAX
  return { name, pill, pillW, act, tail, tailAt }
}

/** The cell `x` of a field of `w` cells at reading offset `r` (0 at the reading edge). */
function at(r: number, w: number, columns: number, rtl: boolean): number {
  return rtl ? columns - r - w : r
}

/**
 * One agent row: in reading order the margin, the emoji (⭐ before it during the hop; both shifted
 * inside by the walk-in), the name (bold, status colour; it gives way to the decor), the model pill
 * (on the family colour), the activity (status colour, dim once done), then the minutes and badges
 * (dim) at the room's tail field. The lead's mark 💬 rides with the badges. The hover lays HOVER_BG
 * across the whole row. The decor moves nothing but this row's own cells.
 */
function agentRow(row: CellRow, a: OfficeAgent, f: Fields, columns: number, selected: boolean, rtl: boolean, decor: OfficeDecor): void {
  const fg = STATUS_FG[a.status]
  const glyph = decor.hop.has(a.id) ? `${HOP_STAR}${a.emoji}` : a.emoji
  const gw = width(glyph)
  const p = decor.entering.get(a.id)
  // the emoji may walk as far as the name field lets it: it never covers the pill (nor the tail, which follows the name)
  const shift = Math.max(0, Math.min(p === undefined ? 0 : walkShift(p), f.name + HEAD - ROW_MARGIN - gw))
  const extra = shift + gw - EMOJI_CELLS
  put(row, at(ROW_MARGIN + shift, gw, columns, rtl), glyph, selected ? { fg: '#ffffff', bold: true } : {}, true)
  if (f.name - extra > 0) place(row, at(HEAD + extra, f.name - extra, columns, rtl), f.name - extra, a.name, { fg, bold: true }, rtl)
  let r = HEAD + f.name
  if (f.pill !== 'none') {
    const pill = pillText(a.model, f.pill === 'short')
    put(row, at(r + 1, width(pill), columns, rtl), pill, { fg: a.modelFam === 'other' ? '#e8ecff' : '#ffffff', bg: MODEL_BG[a.modelFam] }, true)
    r += 1 + f.pillW
  }
  if (f.act > 0) {
    place(row, at(r + 1, f.act, columns, rtl), f.act, a.act, a.status === 'done' ? { fg, dim: true } : { fg }, rtl)
    r += 1 + f.act
  }
  const tail = tailText(a, rtl)
  const tw = width(tail)
  if (tw > 0) put(row, at(f.tailAt + f.tail - tw, tw, columns, rtl), tail, { dim: true }, true)
  if (decor.hover === a.id) for (let i = 0; i < row.cells.length; i++) row.cells[i] = { ...row.cells[i]!, bg: HOVER_BG }
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
  const { columns, rtl } = props
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
    place(head, at(EMOJI_CELLS + 1, titleW, columns, rtl), titleW, room.title, { bold: true }, rtl)
    const cx = rtl ? 0 : columns - cw
    put(head, cx, counts, {}, true)
    hits.push({ kind: 'pin', id: room.id, x: Math.max(0, px), y, w: EMOJI_CELLS, h: 1 })
    if (room.done) hits.push({ kind: 'roomDone', id: room.id, x: cx, y, w: cw, h: 1 })
    rows.push(head)
    const fields = roomFields(room, columns, rtl)
    room.agents.forEach((a, i) => {
      const row = blankRow(`room:${room.id}:a:${i}`, columns)
      agentRow(row, a, fields, columns, props.selected === a.id, rtl, decor)
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
