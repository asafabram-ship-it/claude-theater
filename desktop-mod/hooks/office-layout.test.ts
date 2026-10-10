// office-layout.ts: the pure cell layout of the desktop office. No engine, no
// `$`: the rows of cells with their ids, tile placement in both directions,
// the hit rectangles, run merging and the row window are asserted on the data.

import { expect, test } from 'claude-code/testing'

import { EMOJI_CELLS, TILE_GAP, TILE_H, TILE_W, blankRow, hitAt, layoutOffice, put, rowRuns, tileX, tilesPerRow, windowRows } from './office-layout'
import type { OfficeAgent, OfficeProps, OfficeRoom } from './office-props'

function ag(id: string, i: number, over: Partial<OfficeAgent> = {}): OfficeAgent {
  return { id, emoji: '🦉', name: `סוכן ${i}`, status: 'running', fam: 'read', act: '📖 קורא', model: 'Opus 5.5', modelFam: 'opus', startMin: 3, isLead: i === 0, failed: false, longRunning: false, star: 0, enteredAt: 0, ...over }
}

function props(over: Partial<OfficeProps> = {}): OfficeProps {
  return {
    v: 1, lang: 'he', rtl: true, columns: 45, rows: 30, offset: 0, nowMin: 0,
    counts: { run: 2, idle: 0, done: 0 }, prefs: { showDone: false, muted: false, still: false },
    search: '', selected: null, helpOpen: false, demo: false,
    rooms: [{ id: 'sess-a', title: 'תקרא את המסמך', small: 'acme', pinned: false, showDone: false, run: 2, stale: 0, done: 0, agents: [ag('lead', 0), ag('a1', 1)] }],
    drawer: null, footer: '', usage: null, empty: null, labels: {}, ...over,
  }
}

/** Ten rooms of ten agents: the limits fixture of the plan (spec §7.2). */
function tenByTen(): OfficeRoom[] {
  return Array.from({ length: 10 }, (_, r) => ({
    id: `s${r}`, title: `חדר ${r}`, small: '', pinned: false, showDone: true, run: 10, stale: 0, done: 0,
    agents: Array.from({ length: 10 }, (_, i) => ({ id: `a${r}-${i}`, emoji: '🦉', name: `סוכן ${i}`, status: 'running' as const, fam: 'read' as const, act: '📖 קורא', model: 'Opus 5.5', modelFam: 'opus' as const, startMin: 1, isLead: false, failed: false, longRunning: false, star: 0, enteredAt: 0 })),
  }))
}

type Cells = { cells: ReadonlyArray<{ ch: string }> }
const text = (row: Cells): string => row.cells.map(c => c.ch).join('')
/** The glyphs of cells [from, to): the right way to read a span (a string slice drifts after a BMP wide glyph such as ⏳). */
const seg = (row: Cells, from: number, to: number): string => row.cells.slice(from, to).map(c => c.ch).join('')
const LONE_SURROGATE = /^[\uD800-\uDFFF]$/

test('cells: put clips to the row and an emoji takes EMOJI_CELLS', () => {
  const row = blankRow('r', 6)
  put(row, 4, 'abc')
  expect(row.cells.map(c => c.ch).join('')).toBe('    ab')
  const r2 = blankRow('r2', 6)
  put(r2, 0, '🦉x', { fg: '#fff' })
  expect(r2.cells[0]?.ch).toBe('🦉')
  expect(r2.cells[EMOJI_CELLS]?.ch).toBe('x')
  expect(r2.cells[1]?.ch).toBe('')            // the emoji's second cell is empty, not a space
  expect(r2.cells[1]?.fg).toBe('#fff')        // ...and carries the emoji's style so the run stays one
  expect(r2.cells).toHaveLength(6)
  const r3 = blankRow('r3', 3)
  put(r3, -1, 'xyz')                          // a negative start skips what falls before the row
  expect(text(r3)).toBe('yz ')
  put(r3, 2, '🦉')                            // a wide glyph that does not fit whole is not drawn: the row never spills past its last column
  expect(r3.cells).toHaveLength(3)
  expect(r3.cells[2]?.ch).toBe(' ')
  put(r3, 1, '🦉q')                           // ...and it fits when its two cells do; what follows is clipped
  expect(text(r3)).toBe('y🦉')
  expect(r3.cells[2]?.ch).toBe('')
  expect(blankRow('e', 0).cells).toHaveLength(0)
  expect(blankRow('n', -4).cells).toHaveLength(0)
})

test('cells: a variation selector, a ZWJ sequence, a skin tone and Hebrew points stay with their glyph (zero width)', () => {
  const row = blankRow('r', 12)
  put(row, 0, '✏️x', { fg: '#0f0' })                      // U+270F + U+FE0F: one 2-cell glyph, then x
  expect(row.cells[0]?.ch).toBe('✏️')
  expect(row.cells[1]?.ch).toBe('')
  expect(row.cells[2]?.ch).toBe('x')
  put(row, 3, '👨‍💻y')                                   // man + ZWJ + laptop: one 2-cell glyph
  expect(row.cells[3]?.ch).toBe('👨‍💻')
  expect(row.cells[4]?.ch).toBe('')
  expect(row.cells[5]?.ch).toBe('y')
  put(row, 6, '👍🏽z')                                     // thumbs up + medium skin tone
  expect(row.cells[6]?.ch).toBe('👍🏽')
  expect(row.cells[8]?.ch).toBe('z')
  put(row, 9, 'שָׁל')                                     // shin + qamats + shin dot, then lamed: two cells
  expect(row.cells[9]?.ch).toBe('שָׁ')
  expect(row.cells[10]?.ch).toBe('ל')
  expect(row.cells[11]?.ch).toBe(' ')
  expect(rowRuns(row.cells).map(r => r.text)).toEqual(['✏️x', '👨‍💻y👍🏽zשָׁל '])
  expect(row.cells.every(c => !LONE_SURROGATE.test(c.ch))).toBe(true)
  // a selector-bearing head is centred like a plain one, and the tile keeps it whole
  const lay = layoutOffice(props({ rtl: false, rooms: [{ ...props().rooms[0]!, agents: [ag('v', 1, { emoji: '🕵️', act: '✏️ עורך', name: 'שָׁלוֹם' })] }] }))
  expect(seg(lay.rows[1]!, 0, TILE_W)).toBe('      🕵️    1 ')
  expect(seg(lay.rows[3]!, 0, TILE_W).trim()).toBe('שָׁלוֹם')
  expect(seg(lay.rows[5]!, 0, TILE_W).trim()).toBe('✏️ עורך')
})

test('tiles per row and x positions, LTR and RTL', () => {
  expect(tilesPerRow(45)).toBe(3)
  expect(tilesPerRow(14)).toBe(1)
  expect(tileX(0, 3, 45, false)).toBe(0)
  expect(tileX(1, 3, 45, false)).toBe(TILE_W + 1)
  expect(tileX(0, 3, 45, true)).toBe(45 - TILE_W)
  // the narrow docked pane (31 columns) and the floor of the sweep (24) both hold a tile
  expect(tilesPerRow(31)).toBe(2)
  expect(tilesPerRow(24)).toBe(1)
  expect(tilesPerRow(0)).toBe(1)
  expect(tilesPerRow(200)).toBe(13)
  // the last RTL tile of a full row still starts inside the row; the next index wraps to the first column
  expect(tileX(2, 3, 45, true)).toBe(1)
  expect(tileX(3, 3, 45, true)).toBe(45 - TILE_W)
  expect(tileX(3, 3, 45, false)).toBe(0)
  expect(tileX(1, 2, 31, true)).toBe(31 - TILE_W - (TILE_W + TILE_GAP))
})

test('layoutOffice: a room head row, then tile rows; hits cover every tile cell and the pin', () => {
  const lay = layoutOffice(props())
  expect(lay.rows[0]?.id).toBe('room:sess-a:head')
  expect(lay.rows).toHaveLength(1 + TILE_H)
  const lead = lay.hits.find(hit => hit.kind === 'agent' && hit.id === 'lead')
  expect(lead).toBeDefined()
  expect(hitAt(lay, (lead?.x ?? 0) + 2, (lead?.y ?? 0) + 2)?.id).toBe('lead')
  // RTL: the pin is the first thing of the head, at the right edge (spec §7.1 head order); the counts sit at 0
  expect(hitAt(lay, 45 - EMOJI_CELLS, 0)?.kind).toBe('pin')
  expect(hitAt(lay, 44, 0)?.id).toBe('sess-a')
  expect(hitAt(lay, 0, 0)).toBeUndefined()
  expect(hitAt(lay, 200, 200)).toBeUndefined()
  // LTR: the pin is at (0, 0)
  const ltr = layoutOffice(props({ rtl: false }))
  expect(hitAt(ltr, 0, 0)?.kind).toBe('pin')
  expect(hitAt(ltr, 1, 0)?.kind).toBe('pin')
  expect(hitAt(ltr, 2, 0)).toBeUndefined()
  // every cell of the lead tile resolves to the lead, and the cell past each edge does not
  expect(lead).toEqual({ kind: 'agent', id: 'lead', x: 45 - TILE_W, y: 1, w: TILE_W, h: TILE_H })
  for (let y = 1; y < 1 + TILE_H; y++) for (let x = 45 - TILE_W; x < 45; x++) expect(hitAt(lay, x, y)?.id).toBe('lead')
  expect(hitAt(lay, 45 - TILE_W - TILE_GAP, 3)).toBeUndefined()           // the gap column belongs to nobody
  expect(hitAt(lay, 45 - TILE_W - TILE_GAP - 1, 3)?.id).toBe('a1')       // one further is the second tile
  expect(hitAt(lay, 45 - TILE_W, 1 + TILE_H)).toBeUndefined()
  expect(hitAt(lay, 45 - TILE_W, 0)).toBeUndefined()
  // the second tile sits to the LEFT of the lead in RTL, to the right in LTR
  const a1 = lay.hits.find(hit => hit.id === 'a1')
  expect(a1?.x).toBe(45 - TILE_W - (TILE_W + TILE_GAP))
  expect(ltr.hits.find(hit => hit.id === 'a1')?.x).toBe(TILE_W + TILE_GAP)
  expect(ltr.hits.find(hit => hit.id === 'lead')?.x).toBe(0)
})

test('rowRuns merges neighbours with the same style; windowRows slices by offset', () => {
  const row = blankRow('r', 8)
  put(row, 0, 'aa', { fg: '#f00' })
  put(row, 2, 'bb', { fg: '#f00' })
  put(row, 4, 'cc')
  const runs = rowRuns(row.cells)
  expect(runs.map(r => r.text)).toEqual(['aabb', 'cc  '])
  expect(runs[0]?.fg).toBe('#f00')
  const lay = layoutOffice(props())
  expect(windowRows(lay, 2, 3).map(r => r.id)).toEqual(lay.rows.slice(2, 5).map(r => r.id))
  // a run carries only the flags that are set (no `dim: undefined` keys reach the tree); a wide glyph's two cells are one run
  const r3 = blankRow('r3', 9)
  put(r3, 0, 'aa', { fg: '#f00' })
  put(r3, 2, 'bb', { fg: '#f00' })
  put(r3, 4, 'cc')
  put(r3, 6, 'd', { bold: true })
  put(r3, 7, '🦉', { bg: '#000', dim: true })
  const r2 = rowRuns(r3.cells)
  expect(r2).toEqual([{ text: 'aabb', fg: '#f00' }, { text: 'cc' }, { text: 'd', bold: true }, { text: '🦉', bg: '#000', dim: true }])
  expect(Object.keys(r2[1] ?? {})).toEqual(['text'])
  expect(rowRuns([])).toEqual([])
})

test('windowRows: clamps the offset to the content, never returns more than count, tolerates count 0', () => {
  const lay = layoutOffice(props({ rooms: [...props().rooms, { ...props().rooms[0]!, id: 'sess-b' }] }))   // 1 + 6 + gap + 1 + 6 = 15 rows
  expect(lay.rows).toHaveLength(15)
  expect(windowRows(lay, 0, 5).map(r => r.id)).toEqual(lay.rows.slice(0, 5).map(r => r.id))
  expect(windowRows(lay, 12, 5).map(r => r.id)).toEqual(lay.rows.slice(10, 15).map(r => r.id))   // past the end: the last full window
  expect(windowRows(lay, 99, 5)).toHaveLength(5)
  expect(windowRows(lay, -3, 5).map(r => r.id)).toEqual(lay.rows.slice(0, 5).map(r => r.id))
  expect(windowRows(lay, 3, 100)).toHaveLength(15)                                                  // count beyond the content: everything, from 0
  expect(windowRows(lay, 3, 0)).toEqual([])
  expect(windowRows({ rows: [], hits: [] }, 2, 3)).toEqual([])
})

test('bounds: 100 agents in 10 rooms at 45 and 200 columns stay small', () => {
  const rooms = tenByTen()
  for (const columns of [45, 200]) {
    const lay = layoutOffice(props({ columns, rooms }))
    const runs = lay.rows.reduce((n, r) => n + rowRuns(r.cells).length, 0)
    expect(runs).toBeLessThan(6000)               // well under 20,000 nodes even unwindowed
    expect(JSON.stringify(lay.rows.map(r => rowRuns(r.cells))).length).toBeLessThan(300_000)
  }
})

test('sweep: 100 agents at every width 24..200 — rows fit the columns, hits stay inside, a 40-row window is under the tree limits', () => {
  const rooms = tenByTen()
  for (let columns = 24; columns <= 200; columns++) {
    for (const rtl of [true, false]) {
      const lay = layoutOffice(props({ columns, rtl, rooms }))
      const perRow = tilesPerRow(columns)
      expect(lay.rows).toHaveLength(10 * (1 + TILE_H * Math.ceil(10 / perRow)) + 9)
      expect(lay.rows.every(r => r.cells.length === columns)).toBe(true)
      expect(lay.rows.every(r => r.cells.every(c => !LONE_SURROGATE.test(c.ch)))).toBe(true)
      expect(lay.hits.filter(hit => hit.kind === 'agent')).toHaveLength(100)
      expect(lay.hits.every(hit => hit.x >= 0 && hit.w > 0 && hit.x + hit.w <= columns && hit.y >= 0 && hit.h > 0 && hit.y + hit.h <= lay.rows.length)).toBe(true)
      // no two hit rectangles overlap: every cell resolves to at most one agent or button
      const tiles = lay.hits.filter(hit => hit.kind === 'agent')
      for (let i = 1; i < tiles.length; i++) {
        const a = tiles[i - 1]!, b = tiles[i]!
        expect(a.y === b.y ? Math.abs(a.x - b.x) >= TILE_W + TILE_GAP : Math.abs(a.y - b.y) >= TILE_H).toBe(true)
      }
      // the window the Client draws: 40 rows, from the top and from the middle
      for (const offset of [0, Math.floor(lay.rows.length / 2)]) {
        const win = windowRows(lay, offset, 40)
        const runsPerRow = win.map(r => rowRuns(r.cells))
        const nodes = runsPerRow.reduce((n, runs) => n + 1 + runs.length, 0)
        expect(nodes).toBeLessThan(20_000)
        expect(JSON.stringify(runsPerRow).length).toBeLessThan(100_000)
      }
    }
  }
})

test('the room head: pin glyph, title and counts, LTR flush right and RTL flush left; the ✅ button covers the counts', () => {
  const room = { ...props().rooms[0]!, pinned: true, run: 2, stale: 1, done: 3 }
  const counts = '🟢2 ⏳1 ✅3'                                  // 11 cells: three wide glyphs, eight narrow
  const ltr = layoutOffice(props({ rtl: false, rooms: [room] }))
  const lh = ltr.rows[0]!
  expect(lh.cells[0]?.ch).toBe('📌')
  expect(lh.cells[1]?.ch).toBe('')
  expect(lh.cells[2]?.ch).toBe(' ')
  expect(lh.cells[3]?.ch).toBe('💬')
  expect(seg(lh, 34, 45)).toBe(counts)
  expect(lh.cells[44]?.ch).toBe('3')                               // the last digit is drawn, not clipped
  expect(lh.cells[34]?.ch).toBe('🟢')
  expect(lh.cells[33]?.ch).toBe(' ')
  expect(text(lh)).toContain('💬 תקרא את המסמך')
  expect(ltr.hits.find(hit => hit.kind === 'roomDone')).toEqual({ kind: 'roomDone', id: 'sess-a', x: 34, y: 0, w: 11, h: 1 })
  expect(hitAt(ltr, 44, 0)?.kind).toBe('roomDone')
  expect(hitAt(ltr, 33, 0)).toBeUndefined()
  const rtl = layoutOffice(props({ rtl: true, rooms: [room] }))
  const rh = rtl.rows[0]!
  expect(seg(rh, 0, 11)).toBe(counts)
  expect(rh.cells[11]?.ch).toBe(' ')
  expect(rh.cells[43]?.ch).toBe('📌')
  expect(rh.cells[44]?.ch).toBe('')
  expect(rh.cells[42]?.ch).toBe(' ')
  expect(text(rh)).toContain('💬 תקרא את המסמך')
  expect(rtl.hits.find(hit => hit.kind === 'roomDone')).toEqual({ kind: 'roomDone', id: 'sess-a', x: 0, y: 0, w: 11, h: 1 })
  expect(hitAt(rtl, 10, 0)?.kind).toBe('roomDone')
  expect(hitAt(rtl, 11, 0)).toBeUndefined()
  // no ✅ button without done agents; the unpinned glyph; stale and done counts only when non-zero
  const plain = layoutOffice(props({ rtl: false }))
  expect(plain.hits.some(hit => hit.kind === 'roomDone')).toBe(false)
  expect(plain.rows[0]?.cells[0]?.ch).toBe('○')
  expect(text(plain.rows[0]!).trimEnd().endsWith('🟢2')).toBe(true)
  expect(text(plain.rows[0]!)).not.toContain('⏳')
  // the title is one run (a single Hebrew string, bold), never split by the renderer
  const titleRun = rowRuns(lh.cells).find(r => r.text.includes('תקרא'))
  expect(titleRun?.text).toBe('💬 תקרא את המסמך')
  expect(titleRun?.bold).toBe(true)
  // a long title is cut with an ellipsis before the counts, in both directions
  const long = { ...room, title: 'כותרת ארוכה מאוד שלא נכנסת בשורה אחת של ארבעים וחמישה תאים בכלל' }
  for (const dir of [true, false]) {
    const head = layoutOffice(props({ rtl: dir, rooms: [long] })).rows[0]!
    expect(head.cells).toHaveLength(45)
    expect(text(head)).toContain('…')
    expect(text(head)).toContain(counts)
    expect(text(head)).toContain(dir ? '📌' : '📌 💬')
  }
})

test('the tile: six rows at the tile x, name/model/activity cut to the width, badges and minutes, selection frame', () => {
  const lead = ag('lead', 0, { name: 'מנהל', model: 'Opus 5.5', act: '📖 קורא', startMin: 12, failed: true, star: 1_700_000, longRunning: true })
  const other = ag('a1', 1, { emoji: '🐢', name: 'שם ארוך מאוד שנחתך בוודאות', model: 'Sonnet 5.5', modelFam: 'sonnet', act: '✍️ כותב קובץ ארוך', startMin: 0, status: 'stale' })
  const done = ag('a2', 2, { name: 'גמור', model: '?', modelFam: 'other', act: '✅ סיים', startMin: null, status: 'done' })
  const room = { ...props().rooms[0]!, showDone: true, agents: [lead, other, done] }
  const lay = layoutOffice(props({ rtl: false, columns: 45, rooms: [room], selected: 'lead' }))
  expect(lay.rows.map(r => r.id)).toEqual(['room:sess-a:head', ...Array.from({ length: TILE_H }, (_, k) => `room:sess-a:row:0:${k}`)])
  const [, head, desk, name, pill, act, mins] = lay.rows
  // row 1: 💬 for the lead at the tile's start, the head centred, the index at the end; the selection frame is white and bold
  expect(seg(head!, 0, TILE_W)).toBe('💬    🦉    1 ')
  expect(head!.cells[6]?.fg).toBe('#ffffff')
  expect(head!.cells[6]?.bold).toBe(true)
  expect(head!.cells[12]?.dim).toBe(true)
  expect(seg(head!, TILE_W + TILE_GAP, 2 * TILE_W + TILE_GAP)).toBe('      🐢    2 ')   // not the lead: no 💬; not selected: no frame
  expect(head!.cells[TILE_W + TILE_GAP + 6]?.fg).toBeUndefined()
  // row 2: ten half-blocks of desk, the two middle ones the screen: lit when running, grey when stale, off when done
  expect(seg(desk!, 0, TILE_W)).toBe('  ▀▀▀▀▀▀▀▀▀▀  ')
  expect(desk!.cells[2]?.fg).toBe('#8b5a2b')
  expect(desk!.cells[6]?.fg).toBe('#39d353')
  expect(desk!.cells[7]?.fg).toBe('#39d353')
  expect(desk!.cells[8]?.fg).toBe('#8b5a2b')
  expect(desk!.cells[TILE_W + TILE_GAP + 6]?.fg).toBe('#6b7280')
  expect(desk!.cells[2 * (TILE_W + TILE_GAP) + 6]?.fg).toBe('#1f2937')
  expect(desk!.cells[TILE_W]?.ch).toBe(' ')                       // the gap column stays blank
  // row 3: the name, one bold run in the status colour, cut to the tile with an ellipsis
  expect(seg(name!, 0, TILE_W).trim()).toBe('מנהל')
  const nameRuns = rowRuns(name!.cells)
  expect(nameRuns.find(r => r.text === 'מנהל')).toEqual({ text: 'מנהל', fg: '#7ee29a', bold: true })
  const cutName = nameRuns.find(r => r.text.endsWith('…'))
  expect(cutName?.text).toBe('שם ארוך מאוד …')
  expect(cutName?.fg).toBe('#e6c07e')
  expect(seg(name!, TILE_W, TILE_W + 1)).toBe(' ')
  // row 4: the model pill: white on the family colour; unknown model on the grey with the light ink
  const pillRuns = rowRuns(pill!.cells)
  expect(pillRuns.find(r => r.text === ' Opus 5.5 ')).toEqual({ text: ' Opus 5.5 ', fg: '#ffffff', bg: '#7b5cf0' })
  expect(pillRuns.find(r => r.text === ' Sonnet 5.5 ')?.bg).toBe('#2f7fe8')
  expect(pillRuns.find(r => r.text === ' ? ')).toEqual({ text: ' ? ', fg: '#e8ecff', bg: '#3a4470' })
  // row 5: the activity in the status colour, dim once done, cut to the tile
  const actRuns = rowRuns(act!.cells)
  expect(actRuns.find(r => r.text === '📖 קורא')).toEqual({ text: '📖 קורא', fg: '#7ee29a' })
  expect(actRuns.find(r => r.text === '✅ סיים')).toEqual({ text: '✅ סיים', fg: '#9fb0e6', dim: true })
  expect(actRuns.find(r => r.text.startsWith('✍️'))?.text.endsWith('…')).toBe(true)
  // row 6: minutes then badges ❌⭐⏰; '<1' under a minute; nothing but badges when unknown
  expect(seg(mins!, 0, TILE_W).trim()).toBe('12❌⭐⏰')
  expect(seg(mins!, TILE_W + TILE_GAP, 2 * TILE_W + TILE_GAP).trim()).toBe('<1')
  expect(seg(mins!, 2 * (TILE_W + TILE_GAP), 3 * TILE_W + 2 * TILE_GAP).trim()).toBe('')
  expect(mins!.cells[5]?.dim).toBe(true)
  // every tile row is exactly the width; nothing bleeds into the gap column
  for (const r of lay.rows.slice(1)) {
    expect(r.cells).toHaveLength(45)
    expect(r.cells[TILE_W]?.ch).toBe(' ')
    expect(r.cells[2 * TILE_W + TILE_GAP]?.ch).toBe(' ')
  }
})

test('cutting at a wide glyph never leaves half an emoji; names of only emoji fit the tile', () => {
  const owl = ag('o', 1, { name: '🦉'.repeat(10), act: '🦉'.repeat(9), model: '🦉'.repeat(8) })
  const room = { ...props().rooms[0]!, title: '🦉'.repeat(30), agents: [owl] }
  for (const columns of [24, 31, 45]) {
    for (const rtl of [true, false]) {
      const lay = layoutOffice(props({ columns, rtl, rooms: [room] }))
      expect(lay.rows.every(r => r.cells.length === columns)).toBe(true)
      expect(lay.rows.every(r => r.cells.every(c => !LONE_SURROGATE.test(c.ch)))).toBe(true)
      const name = lay.rows[3]!
      expect(text(name)).toContain('🦉🦉🦉🦉🦉🦉…')              // 6 owls (12 cells) + the ellipsis = 13 ≤ TILE_W
      expect(text(name)).not.toContain('🦉🦉🦉🦉🦉🦉🦉🦉')
      expect(text(lay.rows[0]!)).toContain('…')
    }
  }
})

test('rooms: done agents hidden unless the room shows them; a blank gap row only between rooms; the output is deterministic', () => {
  const done = ag('d', 2, { status: 'done' })
  const a = { ...props().rooms[0]!, id: 'ra', agents: [ag('lead', 0), done] }
  const b = { ...props().rooms[0]!, id: 'rb', showDone: true, agents: [done] }
  const lay = layoutOffice(props({ rooms: [a, b] }))
  expect(lay.rows.map(r => r.id)).toEqual([
    'room:ra:head', 'room:ra:row:0:0', 'room:ra:row:0:1', 'room:ra:row:0:2', 'room:ra:row:0:3', 'room:ra:row:0:4', 'room:ra:row:0:5',
    'room:ra:gap',
    'room:rb:head', 'room:rb:row:0:0', 'room:rb:row:0:1', 'room:rb:row:0:2', 'room:rb:row:0:3', 'room:rb:row:0:4', 'room:rb:row:0:5',
  ])
  expect(lay.hits.filter(hit => hit.kind === 'agent').map(hit => `${hit.id}@${hit.y}`)).toEqual(['lead@1', 'd@9'])
  expect(text(lay.rows[7]!)).toBe(' '.repeat(45))
  // a room whose agents are all hidden is a head alone
  const empty = layoutOffice(props({ rooms: [{ ...a, agents: [done] }] }))
  expect(empty.rows.map(r => r.id)).toEqual(['room:ra:head'])
  expect(empty.hits.map(hit => hit.kind)).toEqual(['pin'])
  // a second tile row starts a new block of six, with the index continuing
  const four = { ...a, agents: [ag('x0', 0), ag('x1', 1), ag('x2', 2), ag('x3', 3)] }
  const wrapped = layoutOffice(props({ rooms: [four], rtl: false }))
  expect(wrapped.rows).toHaveLength(1 + 2 * TILE_H)
  expect(wrapped.rows[1 + TILE_H]?.id).toBe('room:ra:row:1:0')
  expect(wrapped.hits.find(hit => hit.id === 'x3')).toEqual({ kind: 'agent', id: 'x3', x: 0, y: 1 + TILE_H, w: TILE_W, h: TILE_H })
  expect(seg(wrapped.rows[1 + TILE_H]!, 0, TILE_W)).toBe('      🦉    4 ')
  expect(JSON.stringify(layoutOffice(props({ rooms: [a, b] })))).toBe(JSON.stringify(lay))
  expect(layoutOffice(props({ rooms: [] }))).toEqual({ rows: [], hits: [] })
})
