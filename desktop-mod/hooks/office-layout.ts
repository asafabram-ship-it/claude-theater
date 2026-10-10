// Pure layout of the office in text cells. No engine, no `$`: both the hooks
// (content height) and the surface module (drawing, hit-testing) call it.
//
// The office is a list of rows of cells, each row with an id the Client uses
// as its Text key; a tile is TILE_W x TILE_H cells; a wide glyph (an emoji)
// takes EMOJI_CELLS. Every row is exactly `columns` wide by construction: the
// desktop does not enforce `wrap: 'truncate'`, so `put` clips and never lets a
// glyph spill past the last column. No clock here: minutes come in the props.

import type { OfficeAgent, OfficeProps } from './office-props'

export const TILE_W = 14
export const TILE_H = 6
export const TILE_GAP = 1
export const EMOJI_CELLS = 2

export type Cell = { ch: string; fg?: string; bg?: string; bold?: true; dim?: true }
export type CellRow = { id: string; cells: Cell[] }
export type Run = { text: string; fg?: string; bg?: string; bold?: true; dim?: true }
export type Hit = { kind: 'agent' | 'pin' | 'roomDone'; id: string; x: number; y: number; w: number; h: number }
export type OfficeLayout = { rows: CellRow[]; hits: Hit[] }

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

/** One agent tile into rows[y..y+TILE_H) at x. */
function tile(rows: CellRow[], y: number, x: number, a: OfficeAgent, index: number, selected: boolean): void {
  const fg = STATUS_FG[a.status]
  const frame = selected ? { fg: '#ffffff', bold: true as const } : {}
  const head = rows[y]!
  put(head, centred(x, TILE_W, a.emoji), a.emoji, frame)
  if (a.isLead) put(head, x, '💬')
  const idx = String(index)
  put(head, x + TILE_W - Math.max(2, width(idx)), idx, { dim: true })
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

/**
 * The rows and hit rectangles of the whole office: per room a head row (pin, title, counts;
 * the pin first, so at the right edge in RTL), then blocks of TILE_H rows of tiles, with one
 * blank row between rooms. Rows ids: `room:<id>:head`, `room:<id>:row:<n>:<k>`, `room:<id>:gap`.
 */
export function layoutOffice(props: OfficeProps): OfficeLayout {
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
    const shown = room.agents.filter(a => a.status !== 'done' || room.showDone)
    for (let i = 0; i < shown.length; i += perRow) {
      const top = rows.length
      for (let k = 0; k < TILE_H; k++) rows.push(blankRow(`room:${room.id}:row:${i / perRow}:${k}`, props.columns))
      shown.slice(i, i + perRow).forEach((a, j) => {
        const x = tileX(i + j, perRow, props.columns, props.rtl)
        tile(rows, top, x, a, i + j + 1, props.selected === a.id)
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
