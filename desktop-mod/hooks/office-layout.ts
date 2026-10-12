// Pure layout of the office in text cells. No engine, no `$`: both the hooks
// (content height) and the surface module (drawing, hit-testing) call it.
//
// The office is a list of rows of cells, each row with an id the Client uses
// as its Text key; a tile is TILE_W x TILE_H cells; a wide glyph (an emoji)
// takes EMOJI_CELLS. Every row is exactly `columns` wide by construction: the
// desktop does not enforce `wrap: 'truncate'`, so `put` clips and never lets a
// glyph spill past the last column. No clock here: minutes come in the props.
//
// The decor (the hover, the hop, the walk-in) is the surface module's local
// state handed in as plain data: the layout stays a pure function of
// (props, decor), so the module memoises it by both and the hooks, which only
// need the height, count the rows without building a cell (`rowCount`).

import type { OfficeAgent, OfficeProps, OfficeRoom } from './office-props'

export const TILE_W = 14
export const TILE_H = 6
export const TILE_GAP = 1
export const EMOJI_CELLS = 2

export type Cell = { ch: string; fg?: string; bg?: string; bold?: true; dim?: true }
export type CellRow = { id: string; cells: Cell[] }
export type Run = { text: string; fg?: string; bg?: string; bold?: true; dim?: true }
export type Hit = { kind: 'agent' | 'pin' | 'roomDone'; id: string; x: number; y: number; w: number; h: number }
export type OfficeLayout = { rows: CellRow[]; hits: Hit[] }

/**
 * What the surface module lays on the tiles from its local state (spec §7.4), by agent id:
 *   hover    the tile under the pointer: HOVER_BG across its head row;
 *   hop      a `done` fx: ⭐ beside the head, on the tile's own head row (the row above
 *            is the room head or another tile's, so the head cannot leave its row);
 *   entering an `enter` fx and its progress 0 → 1: the head walks in from the reading
 *            start (the left in LTR, the right in RTL), `walkShift(p)` cells off home.
 */
export type OfficeDecor = { hover: string | null; hop: ReadonlySet<string>; entering: ReadonlyMap<string, number> }
export const NO_DECOR: OfficeDecor = { hover: null, hop: new Set(), entering: new Map() }
/** The hover highlight: a background bar across the tile's head row (a coloured "frame" around a colour emoji does not show). */
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
const DESK = '#8b5a2b'
const SCREEN: Record<OfficeAgent['status'], string> = { running: '#39d353', stale: '#6b7280', done: '#1f2937' }
const EMOJI_RE = /^\p{Extended_Pictographic}/u
/** Code points that take no cell of their own: combining marks (Hebrew points among them), the variation selectors, the ZWJ, the skin tones. */
const JOIN_RE = /^[\p{M}\u200D\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]$/u
const ZWJ = '\u200D'
const ELLIPSIS = '…'

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
 * the end is not drawn at all, so the row never spills past its last column.
 */
export function put(row: CellRow, x: number, text: string, style: Omit<Cell, 'ch'> = {}): void {
  let i = x
  for (const g of glyphs(text)) {
    if (i + g.w > row.cells.length) break
    if (i >= 0) row.cells[i] = { ch: g.ch, ...style }
    for (let k = 1; k < g.w; k++) if (i + k >= 0) row.cells[i + k] = { ch: '', ...style }
    i += g.w
  }
}

export function tilesPerRow(columns: number): number {
  return Math.max(1, Math.floor((columns + TILE_GAP) / (TILE_W + TILE_GAP)))
}

export function tileX(i: number, perRow: number, columns: number, rtl: boolean): number {
  const col = i % Math.max(1, perRow)
  return rtl ? columns - TILE_W - col * (TILE_W + TILE_GAP) : col * (TILE_W + TILE_GAP)
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

/** The cell at which `text` starts when centred in `w` cells from `x`. */
function centred(x: number, w: number, text: string): number {
  return x + Math.max(0, Math.floor((w - width(text)) / 2))
}

/**
 * One agent tile into rows[y..y+TILE_H) at x. The head row: the 💬 of the lead at the tile's
 * start, the head (with the hop's ⭐) centred and shifted by the walk-in, the index at the end;
 * the head is clamped between the two, so it never covers them and never leaves the tile.
 */
function tile(rows: CellRow[], y: number, x: number, a: OfficeAgent, index: number, selected: boolean, rtl: boolean, decor: OfficeDecor): void {
  const fg = STATUS_FG[a.status]
  const frame = selected ? { fg: '#ffffff', bold: true as const } : {}
  const head = rows[y]!
  const idx = String(index)
  const idxAt = x + TILE_W - Math.max(2, width(idx))
  const glyph = decor.hop.has(a.id) ? `${HOP_STAR}${a.emoji}` : a.emoji
  const p = decor.entering.get(a.id)
  const shift = p === undefined ? 0 : (rtl ? 1 : -1) * walkShift(p)
  const lo = x + (a.isLead ? EMOJI_CELLS : 0)
  const hi = idxAt - width(glyph)
  put(head, Math.max(lo, Math.min(hi, centred(x, TILE_W, glyph) + shift)), glyph, frame)
  if (a.isLead) put(head, x, '💬')
  put(head, idxAt, idx, { dim: true })
  if (decor.hover === a.id) {
    for (let i = Math.max(0, x); i < Math.min(head.cells.length, x + TILE_W); i++) head.cells[i] = { ...head.cells[i]!, bg: HOVER_BG }
  }
  const desk = rows[y + 1]!
  put(desk, x + 2, '▀'.repeat(TILE_W - 4), { fg: DESK, bg: '#3a2a1a' })
  put(desk, x + 6, '▀▀', { fg: SCREEN[a.status], bg: '#111827' })
  const name = cut(a.name, TILE_W)
  put(rows[y + 2]!, centred(x, TILE_W, name), name, { fg, bold: true })
  const pill = ` ${cut(a.model, TILE_W - 2)} `
  put(rows[y + 3]!, centred(x, TILE_W, pill), pill, { fg: a.modelFam === 'other' ? '#e8ecff' : '#ffffff', bg: MODEL_BG[a.modelFam] })
  const act = cut(a.act, TILE_W)
  put(rows[y + 4]!, centred(x, TILE_W, act), act, a.status === 'done' ? { fg, dim: true } : { fg })
  const badges = `${a.failed ? '❌' : ''}${a.star ? '⭐' : ''}${a.longRunning ? '⏰' : ''}`
  const mins = a.startMin === null ? '' : a.startMin < 1 ? '<1' : String(a.startMin)
  const line = cut(`${mins}${badges}`, TILE_W)
  put(rows[y + 5]!, centred(x, TILE_W, line), line, { dim: true })
}

/** Whether a room draws an agent: a finished one only while the room shows the finished. */
function drawn(room: OfficeRoom, a: OfficeAgent): boolean {
  return a.status !== 'done' || room.showDone
}

/**
 * The number of rows `layoutOffice(props)` lays out, without building a cell: what the hooks
 * need for the Client's height on every render (a head per room, TILE_H rows per row of tiles,
 * a gap between rooms). The decor never changes it.
 */
export function rowCount(props: OfficeProps): number {
  const perRow = tilesPerRow(props.columns)
  let n = 0
  for (let r = 0; r < props.rooms.length; r++) {
    const room = props.rooms[r]!
    let shown = 0
    for (const a of room.agents) if (drawn(room, a)) shown++
    n += (r > 0 ? 1 : 0) + 1 + Math.ceil(shown / perRow) * TILE_H
  }
  return n
}

/**
 * The rows and hit rectangles of the whole office: per room a head row (pin, title, counts;
 * the pin first, so at the right edge in RTL), then blocks of TILE_H rows of tiles, with one
 * blank row between rooms. Rows ids: `room:<id>:head`, `room:<id>:row:<n>:<k>`, `room:<id>:gap`.
 * The decor changes only the head rows of the tiles it names; never a hit, never a row's width.
 */
export function layoutOffice(props: OfficeProps, decor: OfficeDecor = NO_DECOR): OfficeLayout {
  const rows: CellRow[] = []
  const hits: Hit[] = []
  const perRow = tilesPerRow(props.columns)
  for (let r = 0; r < props.rooms.length; r++) {
    const room = props.rooms[r]!
    if (r > 0) rows.push(blankRow(`room:${props.rooms[r - 1]!.id}:gap`, props.columns))
    const head = blankRow(`room:${room.id}:head`, props.columns)
    const counts = `🟢${room.run}${room.stale ? ` ⏳${room.stale}` : ''}${room.done ? ` ✅${room.done}` : ''}`
    const cw = Math.min(width(counts), props.columns)
    const pin = room.pinned ? '📌' : '○'
    const title = cut(`💬 ${room.title}`, props.columns - EMOJI_CELLS - 1 - cw - 1)
    const y = rows.length
    if (props.rtl) {
      const px = Math.max(0, props.columns - EMOJI_CELLS)
      put(head, px, pin)
      put(head, px - 1 - width(title), title, { bold: true })
      put(head, 0, counts)
      hits.push({ kind: 'pin', id: room.id, x: px, y, w: EMOJI_CELLS, h: 1 })
      if (room.done) hits.push({ kind: 'roomDone', id: room.id, x: 0, y, w: cw, h: 1 })
    } else {
      const cx = props.columns - cw
      put(head, 0, pin)
      put(head, EMOJI_CELLS + 1, title, { bold: true })
      put(head, cx, counts)
      hits.push({ kind: 'pin', id: room.id, x: 0, y, w: EMOJI_CELLS, h: 1 })
      if (room.done) hits.push({ kind: 'roomDone', id: room.id, x: cx, y, w: cw, h: 1 })
    }
    rows.push(head)
    const shown = room.agents.filter(a => drawn(room, a))
    for (let i = 0; i < shown.length; i += perRow) {
      const top = rows.length
      for (let k = 0; k < TILE_H; k++) rows.push(blankRow(`room:${room.id}:row:${i / perRow}:${k}`, props.columns))
      shown.slice(i, i + perRow).forEach((a, j) => {
        const x = tileX(i + j, perRow, props.columns, props.rtl)
        tile(rows, top, x, a, i + j + 1, props.selected === a.id, props.rtl, decor)
        hits.push({ kind: 'agent', id: a.id, x, y: top, w: TILE_W, h: TILE_H })
      })
    }
  }
  return { rows, hits }
}

/** Neighbouring cells with the same style merged into one run (the Client draws one Text per run). */
export function rowRuns(cells: readonly Cell[]): Run[] {
  const runs: Run[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.fg === c.fg && last.bg === c.bg && last.bold === c.bold && last.dim === c.dim) last.text += c.ch
    else runs.push({ text: c.ch, ...(c.fg ? { fg: c.fg } : {}), ...(c.bg ? { bg: c.bg } : {}), ...(c.bold ? { bold: true } : {}), ...(c.dim ? { dim: true } : {}) })
  }
  return runs
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
