// office-layout.ts: the pure cell layout of the desktop office. No engine, no
// `$`: the rows of cells with their ids, one row per agent in both directions,
// the hit rectangles, THE HEBREW RULE's runs, run merging and the row window
// are asserted on the data.

import { expect, test } from 'claude-code/testing'

import { hebrewRuleOk } from './i18n'
import { ACT_MAX, EMOJI_CELLS, HOVER_BG, NAME_MAX, NO_DECOR, ROW_MARGIN, WALK_CELLS, blankRow, blocksOfParts, cut, hitAt, layoutOffice, lineRow, pillText, place, put, rowCount, rowRuns, segments, tailText, walkShift, windowRows } from './office-layout'
import type { OfficeDecor } from './office-layout'
import type { OfficeAgent, OfficeProps, OfficeRoom } from './office-props'

function ag(id: string, i: number, over: Partial<OfficeAgent> = {}): OfficeAgent {
  return { id, emoji: '🦉', name: `סוכן ${i}`, status: 'running', fam: 'read', act: '📖 קורא', model: 'Opus 5.5', modelFam: 'opus', startMin: 3, isLead: i === 0, failed: false, longRunning: false, star: 0, enteredAt: 0, ...over }
}

function room(over: Partial<OfficeRoom> = {}): OfficeRoom {
  return { id: 'sess-a', title: 'תקרא את המסמך', small: 'acme', pinned: false, showDone: false, run: 2, stale: 0, done: 0, agents: [ag('lead', 0), ag('a1', 1)], moreDone: 0, moreLabel: '', ...over }
}

function props(over: Partial<OfficeProps> = {}): OfficeProps {
  return {
    v: 1, lang: 'he', rtl: true, columns: 45, rows: 30, offset: 0, nowMin: 0,
    counts: { run: 2, idle: 0, done: 0 }, prefs: { showDone: false, muted: false, still: false },
    search: '', selected: null, helpOpen: false, demo: false,
    rooms: [room()],
    drawer: null, footer: '', usage: null, empty: null, labels: {}, ...over,
  }
}

/** Ten rooms of ten agents: the limits fixture of the plan (spec §7.2). */
function tenByTen(): OfficeRoom[] {
  return Array.from({ length: 10 }, (_, r) => room({
    id: `s${r}`, title: `חדר ${r}`, small: '', showDone: true, run: 10,
    agents: Array.from({ length: 10 }, (_, i) => ag(`a${r}-${i}`, i, { isLead: false, startMin: 1 })),
  }))
}

type Cells = { cells: ReadonlyArray<{ ch: string }> }
const text = (row: Cells): string => row.cells.map(c => c.ch).join('')
/** The glyphs of cells [from, to): the right way to read a span (a string slice drifts after a BMP wide glyph such as ⏳). */
const seg = (row: Cells, from: number, to: number): string => row.cells.slice(from, to).map(c => c.ch).join('')
const LONE_SURROGATE = /^[\uD800-\uDFFF]$/
const WIDE = /^\p{Extended_Pictographic}/u
/** Every wide glyph keeps its empty second cell and every empty cell follows a wide glyph: the row draws exactly as wide as its cells. */
function wellFormed(row: Cells): boolean {
  return row.cells.every((c, i) => c.ch === ' ' || (WIDE.test(c.ch) ? row.cells[i + 1]?.ch === '' : c.ch !== '' || (i > 0 && WIDE.test(row.cells[i - 1]!.ch))))
}
/** A decor with the given hop ids, walk-in progresses and hover. */
function decor(over: { hover?: string | null; hop?: string[]; entering?: Array<[string, number]> } = {}): OfficeDecor {
  return { hover: over.hover ?? null, hop: new Set(over.hop ?? []), entering: new Map(over.entering ?? []) }
}
type StyledCells = Cells & { cells: ReadonlyArray<{ ch: string; fg?: string; bg?: string; bold?: true; dim?: true; brk?: true }> }
const HEB = /\p{Script=Hebrew}/u
const OTHER_LETTER = /(?!\p{Script=Hebrew})\p{L}/u
/** The runs of a row that hold a Hebrew letter. */
const hebrewRuns = (row: StyledCells) => rowRuns(row.cells).map(r => r.text).filter(t => HEB.test(t))
/**
 * THE HEBREW RULE on one drawn run: no letter of another script in a Hebrew run (both directions); in RTL the run must not end
 * with a mark either (hebrewRuleOk) — in LTR a trailing ellipsis is read after the word, as it should be.
 */
const runOk = (run: string, rtl: boolean) => (rtl ? hebrewRuleOk(run) : !OTHER_LETTER.test(run))
/**
 * THE MERGE MODEL: a row is one LTR paragraph, and the bidi algorithm takes two stretches of Hebrew with nothing but neutrals
 * (spaces, digits, emoji, punctuation) between them as ONE block and mirrors it whole — so two Hebrew-holding runs laid by cell
 * with no letter of another script between them would come out swapped. True when no such pair exists on the row.
 */
function mergeSafe(row: StyledCells): boolean {
  let seenHebrew = false   // a Hebrew letter was drawn before
  let boundary = false     // a run boundary was crossed since the last Hebrew letter
  let parted = false       // a letter of another script was drawn since the last Hebrew letter
  let style = ''
  for (const c of row.cells) {
    const key = `${c.fg}|${c.bg}|${c.bold}|${c.dim}`
    if (c.brk || key !== style) { boundary = true; style = key }
    if (HEB.test(c.ch)) {
      if (seenHebrew && boundary && !parted) return false
      seenHebrew = true
      boundary = false
      parted = false
    } else if (OTHER_LETTER.test(c.ch)) parted = true
  }
  return true
}

test('cells: put clips to the row and an emoji takes EMOJI_CELLS; a brk marks the first glyph', () => {
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
  // brk: the first drawn glyph starts a run of its own, even with the style of the cell before
  const r4 = blankRow('r4', 6)
  put(r4, 0, 'ab', { fg: '#f00' })
  put(r4, 2, 'cd', { fg: '#f00' }, true)
  expect(r4.cells[2]).toEqual({ ch: 'c', fg: '#f00', brk: true })
  expect(r4.cells[3]).toEqual({ ch: 'd', fg: '#f00' })
  expect(rowRuns(r4.cells).map(r => r.text)).toEqual(['ab', 'cd', '  '])
  put(r4, -1, 'xy', {}, true)                // skipped cells carry no brk: the first drawn glyph does
  expect(r4.cells[0]).toEqual({ ch: 'y', brk: true })
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
  // a selector-bearing emoji, a pointed name and a selector-bearing activity are laid whole on the row
  const lay = layoutOffice(props({ rtl: false, rooms: [room({ agents: [ag('v', 1, { emoji: '🕵️', act: '✏️ עורך', name: 'שָׁלוֹם' })] })] }))
  const r1 = lay.rows[1]!
  expect(seg(r1, 0, 4)).toBe(' 🕵️ ')
  expect(rowRuns(r1.cells).map(r => r.text)).toContain('שָׁלוֹם')
  expect(rowRuns(r1.cells).map(r => r.text)).toContain('✏️')
  expect(rowRuns(r1.cells).map(r => r.text)).toContain('עורך')
  expect(wellFormed(r1)).toBe(true)
})

test('THE HEBREW RULE: segments splits a text into runs by script — a Hebrew run holds no other script\'s letter, digits ride inside (a run of digits before it too), a leading emoji is a run of its own, the spaces between runs are gaps', () => {
  const texts = (s: string) => segments(s).map(x => [x.gap, x.text])
  expect(texts('📖 קורא')).toEqual([[0, '📖'], [1, 'קורא']])
  expect(texts('עוד 5 שסיימו')).toEqual([[0, 'עוד 5 שסיימו']])
  expect(texts('4 תמלילים מעל 4MiB דולגו')).toEqual([[0, '4 תמלילים מעל 4'], [0, 'MiB'], [1, 'דולגו']])
  expect(texts('4 קבצים של Claude Code לבדיקה')).toEqual([[0, '4 קבצים של'], [1, 'Claude Code'], [1, 'לבדיקה']])
  expect(texts('…שם')).toEqual([[0, '…'], [0, 'שם']])   // (a mark before the word stays its own run: a digit would join)
  expect(texts('שם Reviewer')).toEqual([[0, 'שם'], [1, 'Reviewer']])
  expect(texts('שם - Reviewer')).toEqual([[0, 'שם -'], [1, 'Reviewer']])
  expect(texts('Opus 5.5')).toEqual([[0, 'Opus 5.5']])
  expect(texts('⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30')).toEqual([[0, '⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30']])   // no Hebrew: one run, whatever it starts with
  expect(texts('🔌 github')).toEqual([[0, '🔌 github']])
  expect(texts('🔌 גיטהאב')).toEqual([[0, '🔌'], [1, 'גיטהאב']])
  expect(texts('  🟢2 ⏳1  ')).toEqual([[2, '🟢2 ⏳1']])
  expect(texts('')).toEqual([])
  expect(texts('   ')).toEqual([])
  expect(texts('שם ארוך…')).toEqual([[0, 'שם ארוך…']])
  // no Hebrew run holds another script's letter, whatever the text; two Hebrew runs are always parted by a Latin one
  for (const s of ['📖 קורא', '4 תמלילים מעל 4MiB דולגו', 'שם Reviewer', 'abc דף 12 x', '12 דף', 'דף — Claude Code — דף', 'שם - 4 - שם']) {
    const segs = segments(s)
    for (const x of segs) expect(OTHER_LETTER.test(x.text) && HEB.test(x.text), `${s} → ${x.text}`).toBe(false)
    let heAt = -1
    segs.forEach((x, i) => {
      if (!HEB.test(x.text)) return
      if (heAt >= 0) expect(segs.slice(heAt + 1, i).some(y => OTHER_LETTER.test(y.text)), `${s}: "${segs[heAt]!.text}" | "${x.text}"`).toBe(true)
      heAt = i
    })
  }
})

test('place: the runs of a text in reading order — from the left in LTR, from the right in RTL — each a run of its own, cut to the field', () => {
  const ltr = blankRow('l', 12)
  place(ltr, 1, 10, '📖 קורא', { fg: '#0f0' }, false)
  expect(text(ltr)).toBe(' 📖 קורא    ')
  expect(rowRuns(ltr.cells)).toEqual([{ text: ' ' }, { text: '📖', fg: '#0f0' }, { text: ' ' }, { text: 'קורא', fg: '#0f0' }, { text: '    ' }])
  const rtl = blankRow('r', 12)
  place(rtl, 1, 10, '📖 קורא', { fg: '#0f0' }, true)
  expect(text(rtl)).toBe('    קורא 📖 ')             // the emoji at the field's right edge, the word to its left
  expect(rowRuns(rtl.cells)).toEqual([{ text: '    ' }, { text: 'קורא', fg: '#0f0' }, { text: ' ' }, { text: '📖', fg: '#0f0' }, { text: ' ' }])
  // a leading digit stays with its Hebrew run, in logical order (the engine would mirror two runs as one and swap them)
  const d = blankRow('d', 14)
  place(d, 0, 14, '4 תמלילים', {}, true)
  expect(text(d)).toBe('     4 תמלילים')
  expect(rowRuns(d.cells).map(r => r.text)).toEqual(['     ', '4 תמלילים'])
  // cut to the field, whole glyphs, the ellipsis on the last run — at its logical START in RTL when the run is Hebrew (a leading
  // mark is drawn after the mirrored word); a field off the row draws nothing
  const c = blankRow('c', 8)
  place(c, 0, 8, '🦉 שם ארוך מאוד', { bold: true }, false)
  expect(text(c)).toBe('🦉 שם א…')
  expect(wellFormed(c)).toBe(true)
  const e = blankRow('e', 8)
  place(e, 0, 8, '🦉 שם ארוך מאוד', { bold: true }, true)
  expect(text(e)).toBe('…שם א 🦉')
  expect(rowRuns(e.cells).map(r => r.text)).toEqual(['…שם א', ' ', '🦉'])
  const l = blankRow('l', 8)
  place(l, 0, 8, 'Reviewer name', {}, true)
  expect(text(l)).toBe('Reviewe…')   // a Latin run keeps its ellipsis at its end
  const n = blankRow('n', 8)
  place(n, -1, 4, 'abc', {}, true)
  place(n, 8, 4, 'abc', {}, false)
  place(n, 2, 0, 'abc', {}, false)
  expect(text(n)).toBe('        ')
})

test('lineRow / blocksOfParts: the Hebrew parts that nothing Latin separates are ONE run in logical order (the count after its word inside it), the rest laid by cell in reading order; what does not fit is cut', () => {
  const P = (...texts: string[]) => texts.map(text => ({ text, bold: true as const }))
  const parts = P('🎭', '🟢', 'עובדים', '2', '·', '⏳', 'ממתינים', '1', '·', '✅', 'סיימו', '6', '·', '⏳ 5h 42%')
  expect(blocksOfParts(parts).map(b => [b.gap, b.text])).toEqual([[0, '🎭'], [1, '🟢'], [1, 'עובדים 2 · ⏳ ממתינים 1 · ✅ סיימו 6'], [1, '·'], [1, '⏳ 5h 42%']])
  const ltr = lineRow('h', 60, parts, false)
  expect(text(ltr).trimEnd()).toBe('🎭 🟢 עובדים 2 · ⏳ ממתינים 1 · ✅ סיימו 6 · ⏳ 5h 42%')
  const rtl = lineRow('h', 60, parts, true)
  expect(text(rtl).trimStart()).toBe('⏳ 5h 42% · עובדים 2 · ⏳ ממתינים 1 · ✅ סיימו 6 🟢 🎭')
  expect(rowRuns(rtl.cells).filter(r => r.bold).map(r => r.text)).toEqual(['⏳ 5h 42%', '·', 'עובדים 2 · ⏳ ממתינים 1 · ✅ סיימו 6', '🟢', '🎭'])
  for (const row of [ltr, rtl]) { expect(mergeSafe(row)).toBe(true); for (const run of hebrewRuns(row)) expect(hebrewRuleOk(run)).toBe(true) }
  // the drawer's model line: the Latin value parts the two labels; the activity's emoji rides inside its Hebrew block
  const model = P('מודל', '🧠', 'Opus 5.5', '·', 'פעולה', '🤔', 'חושב')
  expect(blocksOfParts(model).map(b => b.text)).toEqual(['מודל', '🧠', 'Opus 5.5', '·', 'פעולה 🤔 חושב'])
  expect(text(lineRow('m', 36, model, true)).trimStart()).toBe('פעולה 🤔 חושב · Opus 5.5 🧠 מודל')
  expect(mergeSafe(lineRow('m', 36, model, true))).toBe(true)
  // a Hebrew note, a dot, an English note: two runs parted by the dot, which is laid by cell between them
  const notes = [{ text: 'עוד 400 סוכנים לא מוצגים', dim: true as const }, { text: '·', dim: true as const }, { text: 'דולגו 4 תמלילים גדולים מדי', dim: true as const }, { text: '·', dim: true as const }, { text: 'env.get failed', dim: true as const }]
  expect(blocksOfParts(notes).map(b => b.text)).toEqual(['עוד 400 סוכנים לא מוצגים · דולגו 4 תמלילים גדולים מדי', '·', 'env.get failed'])
  expect(mergeSafe(lineRow('f', 80, notes, true))).toBe(true)
  // no Hebrew at all (the narrow header): every part its own run
  expect(blocksOfParts(P('🎭', '🟢', '2', '·', '✅', '6')).map(b => b.text)).toEqual(['🎭', '🟢', '2', '·', '✅', '6'])
  // a trailing digit part joins the block, a trailing mark does not
  expect(blocksOfParts(P('סיימו', '6', '·')).map(b => b.text)).toEqual(['סיימו 6', '·'])
  // narrow: the blocks that fit, the next one cut, nothing after it; in RTL the cut block's ellipsis leads it
  const narrow = lineRow('h', 14, parts, false)
  expect(text(narrow)).toBe('🎭 🟢 עובדים …')
  expect(narrow.cells).toHaveLength(14)
  expect(text(lineRow('h', 14, parts, true))).toBe('…עובדים  🟢 🎭')
  expect(lineRow('h', 0, parts, true).cells).toHaveLength(0)
  expect(text(lineRow('e', 5, [], true))).toBe('     ')
  expect(blocksOfParts([])).toEqual([])
})

test('layoutOffice: a room head row, then one row per agent; an agent hit covers its whole row, the pin its glyph', () => {
  const lay = layoutOffice(props())
  expect(lay.rows.map(r => r.id)).toEqual(['room:sess-a:head', 'room:sess-a:a:0', 'room:sess-a:a:1'])
  const lead = lay.hits.find(hit => hit.kind === 'agent' && hit.id === 'lead')
  expect(lead).toEqual({ kind: 'agent', id: 'lead', x: 0, y: 1, w: 45, h: 1 })
  for (let x = 0; x < 45; x++) expect(hitAt(lay, x, 1)?.id).toBe('lead')
  expect(hitAt(lay, 3, 2)?.id).toBe('a1')
  expect(hitAt(lay, 3, 3)).toBeUndefined()
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
  expect(ltr.hits.find(hit => hit.id === 'a1')).toEqual({ kind: 'agent', id: 'a1', x: 0, y: 2, w: 45, h: 1 })
})

test('rowRuns merges neighbours with the same style and keeps a brk apart; windowRows slices by offset', () => {
  const row = blankRow('r', 8)
  put(row, 0, 'aa', { fg: '#f00' })
  put(row, 2, 'bb', { fg: '#f00' })
  put(row, 4, 'cc')
  const runs = rowRuns(row.cells)
  expect(runs.map(r => r.text)).toEqual(['aabb', 'cc  '])
  expect(runs[0]?.fg).toBe('#f00')
  const lay = layoutOffice(props())
  expect(windowRows(lay, 1, 2).map(r => r.id)).toEqual(lay.rows.slice(1, 3).map(r => r.id))
  // a run carries only the flags that are set (no `dim: undefined` and no `brk` reach the tree); a wide glyph's two cells are one run
  const r3 = blankRow('r3', 9)
  put(r3, 0, 'aa', { fg: '#f00' })
  put(r3, 2, 'bb', { fg: '#f00' }, true)
  put(r3, 4, 'cc')
  put(r3, 6, 'd', { bold: true })
  put(r3, 7, '🦉', { bg: '#000', dim: true })
  const r2 = rowRuns(r3.cells)
  expect(r2).toEqual([{ text: 'aa', fg: '#f00' }, { text: 'bb', fg: '#f00' }, { text: 'cc' }, { text: 'd', bold: true }, { text: '🦉', bg: '#000', dim: true }])
  expect(Object.keys(r2[2] ?? {})).toEqual(['text'])
  expect(rowRuns([])).toEqual([])
})

test('windowRows: clamps the offset to the content, never returns more than count, tolerates count 0', () => {
  const five = room({ agents: Array.from({ length: 5 }, (_, i) => ag(`x${i}`, i)) })
  const lay = layoutOffice(props({ rooms: [five, { ...five, id: 'sess-b' }] }))   // 1 + 5 + gap + 1 + 5 = 13 rows
  expect(lay.rows).toHaveLength(13)
  expect(windowRows(lay, 0, 5).map(r => r.id)).toEqual(lay.rows.slice(0, 5).map(r => r.id))
  expect(windowRows(lay, 10, 5).map(r => r.id)).toEqual(lay.rows.slice(8, 13).map(r => r.id))   // past the end: the last full window
  expect(windowRows(lay, 99, 5)).toHaveLength(5)
  expect(windowRows(lay, -3, 5).map(r => r.id)).toEqual(lay.rows.slice(0, 5).map(r => r.id))
  expect(windowRows(lay, 3, 100)).toHaveLength(13)                                                  // count beyond the content: everything, from 0
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

/** The sweep's widths: every one from 24 to 60 (the docked panes), then every 4th to 200. */
function sweepWidths(): number[] {
  const out: number[] = []
  for (let c = 24; c <= 60; c++) out.push(c)
  for (let c = 64; c <= 200; c += 4) out.push(c)
  return out
}

/** A cast with every kind of text the rows carry: names of several widths, the activities of the table, every model family, every badge, unknown minutes. */
function mixedCast(n: number, prefix: string): OfficeAgent[] {
  const names = ['א', 'סוכן', 'שם ארוך מאוד שנחתך בוודאות', 'map session-token valid…', 'Reviewer', 'בודק Reviewer', '🦉🦉🦉🦉🦉🦉🦉🦉🦉🦉']
  const acts = ['📖 קורא', '✍️ כותב קובץ ארוך', '🔌 github', '🤔 חושב', '✅ סיים', '💤 ממתין', '🧾 מסכם']
  const models = [['Opus 5.5', 'opus'], ['Sonnet 5.5', 'sonnet'], ['Haiku 4.5', 'haiku'], ['Fable 5.1', 'fable'], ['?', 'other'], ['nova-6-0', 'other'], ['x'.repeat(40), 'other']] as const
  return Array.from({ length: n }, (_, i) => ag(`${prefix}${i}`, i, {
    name: names[i % names.length]!, act: acts[i % acts.length]!, model: models[i % models.length]![0], modelFam: models[i % models.length]![1],
    status: i % 7 === 4 ? 'done' : i % 7 === 5 ? 'stale' : 'running', isLead: i === 0,
    startMin: i % 5 === 0 ? null : i % 5 === 1 ? 0 : i * 37, failed: i % 3 === 0, star: i % 4 === 0 ? 1 : 0, longRunning: i % 6 === 0,
    emoji: i % 3 === 0 ? '👨‍💻' : i % 3 === 1 ? '🕵️' : '🦉',
  }))
}

// (CPU-bound: ~100 layouts of 100 agents; keeps the limits test's budget, see office-client.test.ts)
test('sweep: 100 agents at widths 24..200 (every one to 60, then every 4th), both directions — every row is exactly `columns` cells, whole glyphs, one hit per agent row, no two hits overlap, every Hebrew run obeys the rule; a 40-row window is under the tree limits', { timeoutMs: 30_000 }, () => {
  const rooms = [...tenByTen().slice(0, 5), ...Array.from({ length: 5 }, (_, r) => room({ id: `m${r}`, title: `חדר ${r}`, showDone: true, done: 2, moreDone: 0, moreLabel: r % 2 ? 'הסתר שסיימו' : '', agents: mixedCast(10, `m${r}-`) }))]
  const bad: string[] = []
  for (const columns of sweepWidths()) {
    for (const rtl of [true, false]) {
      const lay = layoutOffice(props({ columns, rtl, rooms }))
      const at = `${columns}${rtl ? ' rtl' : ''}`
      if (lay.rows.length !== 10 * (1 + 10) + 9 + 2) bad.push(`${at}: ${lay.rows.length} rows`)
      for (let y = 0; y < lay.rows.length; y++) {
        const row = lay.rows[y]!
        if (row.cells.length !== columns) bad.push(`${at}: row ${y} has ${row.cells.length} cells`)
        if (!wellFormed(row)) bad.push(`${at}: row ${y} breaks a wide glyph: ${text(row)}`)
        if (row.cells.some(c => LONE_SURROGATE.test(c.ch))) bad.push(`${at}: row ${y} holds a lone surrogate`)
        for (const run of hebrewRuns(row)) if (!runOk(run, rtl)) bad.push(`${at}: row ${y} run "${run}" breaks THE HEBREW RULE`)
        if (!mergeSafe(row)) bad.push(`${at}: row ${y} lays two Hebrew runs the engine would merge: ${text(row)}`)
      }
      const agents = lay.hits.filter(hit => hit.kind === 'agent')
      if (agents.length !== 100) bad.push(`${at}: ${agents.length} agent hits`)
      if (!lay.hits.every(hit => hit.x >= 0 && hit.w > 0 && hit.x + hit.w <= columns && hit.y >= 0 && hit.h === 1 && hit.y + hit.h <= lay.rows.length)) bad.push(`${at}: a hit leaves the layout`)
      if (!agents.every(hit => hit.x === 0 && hit.w === columns)) bad.push(`${at}: an agent hit is not its whole row`)
      // no two hit rectangles overlap: every cell resolves to at most one agent or button
      for (let i = 0; i < lay.hits.length; i++) for (let j = i + 1; j < lay.hits.length; j++) {
        const a = lay.hits[i]!, b = lay.hits[j]!
        if (a.y === b.y && a.x < b.x + b.w && b.x < a.x + a.w) bad.push(`${at}: hits ${a.kind}:${a.id} and ${b.kind}:${b.id} overlap`)
      }
      // the window the Client draws: 40 rows, from the top and from the middle
      for (const offset of [0, Math.floor(lay.rows.length / 2)]) {
        const win = windowRows(lay, offset, 40)
        const runsPerRow = win.map(r => rowRuns(r.cells))
        const nodes = runsPerRow.reduce((n, runs) => n + 1 + runs.length, 0)
        if (nodes >= 20_000) bad.push(`${at}: ${nodes} nodes`)
        if (JSON.stringify(runsPerRow).length >= 100_000) bad.push(`${at}: the window serializes too large`)
      }
    }
  }
  expect(bad).toEqual([])
})

test('the room head: pin glyph, title and counts, LTR flush right and RTL flush left; the ✅ button covers the counts; the title is a Hebrew run of its own', () => {
  const r = room({ pinned: true, run: 2, stale: 1, done: 3 })
  const counts = '🟢2 ⏳1 ✅3'                                  // 11 cells: three wide glyphs, eight narrow
  const ltr = layoutOffice(props({ rtl: false, rooms: [r] }))
  const lh = ltr.rows[0]!
  expect(lh.cells[0]?.ch).toBe('📌')
  expect(lh.cells[1]?.ch).toBe('')
  expect(lh.cells[2]?.ch).toBe(' ')
  expect(seg(lh, 3, 3 + 13)).toBe('תקרא את המסמך')
  expect(seg(lh, 34, 45)).toBe(counts)
  expect(lh.cells[44]?.ch).toBe('3')                               // the last digit is drawn, not clipped
  expect(lh.cells[34]?.ch).toBe('🟢')
  expect(lh.cells[33]?.ch).toBe(' ')
  expect(ltr.hits.find(hit => hit.kind === 'roomDone')).toEqual({ kind: 'roomDone', id: 'sess-a', x: 34, y: 0, w: 11, h: 1 })
  expect(hitAt(ltr, 44, 0)?.kind).toBe('roomDone')
  expect(hitAt(ltr, 33, 0)).toBeUndefined()
  const rtl = layoutOffice(props({ rtl: true, rooms: [r] }))
  const rh = rtl.rows[0]!
  expect(seg(rh, 0, 11)).toBe(counts)
  expect(rh.cells[11]?.ch).toBe(' ')
  expect(rh.cells[43]?.ch).toBe('📌')
  expect(rh.cells[44]?.ch).toBe('')
  expect(rh.cells[42]?.ch).toBe(' ')
  expect(seg(rh, 42 - 13, 42)).toBe('תקרא את המסמך')                 // flush against the pin: the title's first glyph at the reading edge
  expect(rtl.hits.find(hit => hit.kind === 'roomDone')).toEqual({ kind: 'roomDone', id: 'sess-a', x: 0, y: 0, w: 11, h: 1 })
  expect(hitAt(rtl, 10, 0)?.kind).toBe('roomDone')
  expect(hitAt(rtl, 11, 0)).toBeUndefined()
  // no ✅ button without done agents; the unpinned glyph; stale and done counts only when non-zero
  const plain = layoutOffice(props({ rtl: false }))
  expect(plain.hits.some(hit => hit.kind === 'roomDone')).toBe(false)
  expect(plain.rows[0]?.cells[0]?.ch).toBe('○')
  expect(text(plain.rows[0]!).trimEnd().endsWith('🟢2')).toBe(true)
  expect(text(plain.rows[0]!)).not.toContain('⏳')
  // the title is one run (a single Hebrew string, bold, starting with a Hebrew letter), never split by the renderer
  const titleRun = rowRuns(lh.cells).find(r => r.text.includes('תקרא'))
  expect(titleRun).toEqual({ text: 'תקרא את המסמך', bold: true })
  // a title with a Latin word inside is split into runs at the Latin alone (the engine parts Hebrew blocks across it), the
  // leading digit riding inside its Hebrew run in logical order; in both directions
  const mixed = layoutOffice(props({ rooms: [room({ title: '4 קבצים של Claude Code לבדיקה' })] })).rows[0]!
  expect(rowRuns(mixed.cells).filter(r => r.bold).map(r => r.text)).toEqual(['לבדיקה', 'Claude Code', '4 קבצים של'])
  expect(mergeSafe(mixed)).toBe(true)
  for (const run of hebrewRuns(mixed)) expect(hebrewRuleOk(run)).toBe(true)
  const mixedLtr = layoutOffice(props({ rtl: false, rooms: [room({ title: '4 קבצים של Claude Code לבדיקה' })] })).rows[0]!
  expect(rowRuns(mixedLtr.cells).filter(r => r.bold).map(r => r.text)).toEqual(['4 קבצים של', 'Claude Code', 'לבדיקה'])
  expect(mergeSafe(mixedLtr)).toBe(true)
  // a cut Hebrew title: the ellipsis leads the run in RTL (drawn after the word), ends it in LTR
  const cutRtl = layoutOffice(props({ columns: 24, rooms: [room({ title: 'כותרת ארוכה מאוד שנחתכת' })] })).rows[0]!
  expect(rowRuns(cutRtl.cells).find(r => r.bold)?.text.startsWith('…')).toBe(true)
  const cutLtr = layoutOffice(props({ columns: 24, rtl: false, rooms: [room({ title: 'כותרת ארוכה מאוד שנחתכת' })] })).rows[0]!
  expect(rowRuns(cutLtr.cells).find(r => r.bold)?.text.endsWith('…')).toBe(true)
  // a long title is cut with an ellipsis before the counts, in both directions
  const long = { ...r, title: 'כותרת ארוכה מאוד שלא נכנסת בשורה אחת של ארבעים וחמישה תאים בכלל' }
  for (const dir of [true, false]) {
    const head = layoutOffice(props({ rtl: dir, rooms: [long] })).rows[0]!
    expect(head.cells).toHaveLength(45)
    expect(text(head)).toContain('…')
    expect(text(head)).toContain(counts)
    expect(text(head)).toContain('📌')
  }
})

test('the agent row (LTR): margin, emoji, name (bold, status colour), the model pill, the activity (dim once done), the minutes and badges at the room\'s tail field; the fields line up down the room', () => {
  const lead = ag('lead', 0, { name: 'מנהל', model: 'Opus 5.5', act: '📖 קורא', startMin: 12, failed: true, star: 1_700_000, longRunning: true })
  const other = ag('a1', 1, { emoji: '🐢', name: 'שם ארוך מאוד שנחתך בוודאות', model: 'Sonnet 5.5', modelFam: 'sonnet', act: '✍️ כותב קובץ ארוך', startMin: 0, status: 'stale' })
  const done = ag('a2', 2, { name: 'גמור', model: '?', modelFam: 'other', act: '✅ סיים', startMin: null, status: 'done' })
  const r = room({ showDone: true, agents: [lead, other, done] })
  // 72 columns: the fields whole (4 + 24 + 1 + 12 + 1 + 16 = 58), the tail field (11) at the far end
  const lay = layoutOffice(props({ rtl: false, columns: 72, rooms: [r], selected: 'lead' }))
  expect(lay.rows.map(x => x.id)).toEqual(['room:sess-a:head', 'room:sess-a:a:0', 'room:sess-a:a:1', 'room:sess-a:a:2'])
  const [, r0, r1, r2] = lay.rows
  // the name field is the room's widest name (24 cells: the long name cut), the pill its widest (` Sonnet 5.5 `), the act its widest (16)
  expect(seg(r0!, 0, 4)).toBe(' 🦉 ')
  expect(seg(r0!, 4, 4 + 24).trimEnd()).toBe('מנהל')
  expect(seg(r1!, 4, 4 + 24)).toBe('שם ארוך מאוד שנחתך בווד…')
  expect(seg(r2!, 4, 4 + 24).trimEnd()).toBe('גמור')
  expect(seg(r0!, 29, 29 + 12)).toBe(' Opus 5.5   ')
  expect(seg(r1!, 29, 29 + 12)).toBe(' Sonnet 5.5 ')
  expect(seg(r2!, 29, 29 + 12)).toBe(' ?          ')
  expect(seg(r0!, 42, 42 + 16).trimEnd()).toBe('📖 קורא')
  expect(seg(r1!, 42, 42 + 16)).toBe('✍️ כותב קובץ אר…')
  expect(seg(r2!, 42, 42 + 16).trim()).toBe('')   // THE HEBREW RULE (3): a Hebrew activity beside a Hebrew name behind a ` ? ` pill (no Latin between) is not drawn
  // the tail: badges then the minutes at the far end (the room's widest tail is `❌⭐⏰💬12′` = 11 cells, right-aligned in its field)
  expect(seg(r0!, 61, 72).trimStart()).toBe('❌⭐⏰💬12′')
  expect(seg(r1!, 61, 72).trimStart()).toBe('<1′')
  expect(seg(r2!, 58, 72).trim()).toBe('')
  expect(r0!.cells[71]?.ch).toBe('′')
  expect(r1!.cells[71]?.ch).toBe('′')
  // styles: the selected emoji white and bold; the name bold in the status colour; the pill on the family colour; the act dim once done; the tail dim
  expect(r0!.cells[1]).toEqual({ ch: '🦉', fg: '#ffffff', bold: true, brk: true })
  expect(r1!.cells[1]).toEqual({ ch: '🐢', brk: true })
  const runs = (row: { cells: readonly { ch: string; fg?: string; bg?: string; bold?: true; dim?: true; brk?: true }[] }) => rowRuns(row.cells)
  expect(runs(r0!).find(x => x.text === 'מנהל')).toEqual({ text: 'מנהל', fg: '#7ee29a', bold: true })
  expect(runs(r1!).find(x => x.text.endsWith('…') && x.bold)).toEqual({ text: 'שם ארוך מאוד שנחתך בווד…', fg: '#e6c07e', bold: true })
  expect(runs(r0!).find(x => x.text === ' Opus 5.5 ')).toEqual({ text: ' Opus 5.5 ', fg: '#ffffff', bg: '#7b5cf0' })
  expect(runs(r1!).find(x => x.text === ' Sonnet 5.5 ')?.bg).toBe('#2f7fe8')
  expect(runs(r2!).find(x => x.text === ' ? ')).toEqual({ text: ' ? ', fg: '#e8ecff', bg: '#3a4470' })
  expect(runs(r0!).find(x => x.text === 'קורא')).toEqual({ text: 'קורא', fg: '#7ee29a' })
  expect(runs(r0!).find(x => x.text === '📖')).toEqual({ text: '📖', fg: '#7ee29a' })
  expect(runs(r2!).find(x => x.text === 'סיים')).toBeUndefined()
  // ... it is drawn once the pill has Latin in it, or the name has no Hebrew, in both directions
  for (const rtl of [true, false]) {
    const latinPill = layoutOffice(props({ rtl, columns: 72, rooms: [room({ agents: [{ ...done, model: 'nova-6-0' }] })] })).rows[1]!
    expect(rowRuns(latinPill.cells).find(x => x.text === 'סיים')).toEqual({ text: 'סיים', fg: '#9fb0e6', dim: true })
    expect(mergeSafe(latinPill)).toBe(true)
    const latinName = layoutOffice(props({ rtl, columns: 72, rooms: [room({ agents: [{ ...done, name: 'Reviewer' }] })] })).rows[1]!
    expect(rowRuns(latinName.cells).find(x => x.text === 'סיים')).toBeDefined()
    expect(mergeSafe(latinName)).toBe(true)
    const noPill = layoutOffice(props({ rtl, columns: 24, rooms: [room({ agents: [{ ...done, name: 'שם ארוך מאוד שנחתך', act: '✅ סיים', startMin: 100, failed: true, longRunning: true }] })] })).rows[1]!
    expect(text(noPill)).not.toContain('סיים')
    expect(mergeSafe(noPill)).toBe(true)
  }
  expect(runs(r0!).find(x => x.text === '❌⭐⏰💬12′')).toEqual({ text: '❌⭐⏰💬12′', dim: true })
  for (const row of lay.rows) {
    expect(row.cells).toHaveLength(72)
    expect(wellFormed(row)).toBe(true)
    expect(mergeSafe(row)).toBe(true)
    for (const run of hebrewRuns(row)) expect(runOk(run, false)).toBe(true)
  }
  // pillText and tailText, the row's pieces
  expect(pillText('Opus 5.5')).toBe(' Opus 5.5 ')
  expect(pillText('Opus 5.5', true)).toBe(' Opus ')
  expect(pillText('?', true)).toBe(' ? ')
  expect(pillText('')).toBe(' ? ')
  expect(pillText('x'.repeat(40))).toBe(` ${'x'.repeat(11)}… `)
  expect(tailText(lead, false)).toBe('❌⭐⏰💬12′')
  expect(tailText(lead, true)).toBe('12′❌⭐⏰💬')
  expect(tailText(other, true)).toBe('<1′')
  expect(tailText(done, true)).toBe('')
})

test('the agent row (RTL): the same row mirrored — the emoji at the right edge, the name to its left, the pill, then the activity (its emoji first), the minutes at the left edge; a roomy pane keeps the minutes GAP_MAX past the activity', () => {
  const cast = [ag('lead', 0, { name: 'המנהל', act: '🤔 חושב', startMin: 1 }), ag('a1', 1, { emoji: '🦆', name: 'הברווז', act: '🤔 חושב', startMin: 7, status: 'stale' })]
  // 34 columns: the content (4 + 6 + 1 + 10 + 1 + 7 = 29) and the tail field (4) fill the row: the minutes at the left edge
  const lay = layoutOffice(props({ rtl: true, columns: 34, rooms: [room({ agents: cast })] }))
  const [, r0, r1] = lay.rows
  expect(text(r0!)).toBe('1′💬 חושב 🤔  Opus 5.5   המנהל 🦉 ')
  expect(text(r1!)).toBe('7′   חושב 🤔  Opus 5.5  הברווז 🦆 ')
  expect(rowRuns(r0!.cells).map(x => x.text)).toEqual(['1′💬', ' ', 'חושב', ' ', '🤔', ' ', ' Opus 5.5 ', '  ', 'המנהל', ' ', '🦉 '])
  // the minutes field is the room's widest tail (`1′💬`, 4 cells), at the edge: 7′ sits at x 0 too; the emoji at the right edge
  expect(r1!.cells[0]?.ch).toBe('7')
  expect(r0!.cells[0]?.ch).toBe('1')
  expect(r0!.cells[31]?.ch).toBe('🦉')
  expect(r1!.cells[31]?.ch).toBe('🦆')
  // 60 columns: the same content at the right edge, the minutes two cells past the activity, the left of the row blank
  const wide = layoutOffice(props({ rtl: true, columns: 60, rooms: [room({ agents: cast })] })).rows[1]!
  expect(text(wide)).toBe(' '.repeat(24) + '1′💬   חושב 🤔  Opus 5.5   המנהל 🦉 ')
})

test('widths: at every width 24..200 the row shrinks in order — the activity to ACT_KEEP, the name to NAME_MIN, the pill to its family, the activity away, the name to a glyph, the pill away — never cutting a glyph; the name field never takes what a kept activity needs; wider panes cap the gap before the minutes', () => {
  const cast = (model: string, modelFam: OfficeAgent['modelFam']) => room({ agents: [ag('lead', 1, { name: 'שם בינוני', model, modelFam, act: '✍️ כותב קובץ ארוך', startMin: 12, failed: true }), ag('a1', 1, { name: 'קצר', act: '📖 קורא', startMin: 3 })] })
  const sonnet = cast('Sonnet 5.5', 'sonnet')
  const opus = cast('Opus 5.5', 'opus')
  const have = (columns: number, rtl: boolean, r = sonnet) => {
    const row = layoutOffice(props({ columns, rtl, rooms: [r] })).rows[1]!
    const runs = rowRuns(row.cells).map(x => x.text)
    const pill = runs.find(x => /^ (Sonnet|Opus)/.test(x)) ?? ''
    const act = runs.find(x => /כותב|^…כו|^…כ$/.test(x)) ?? ''
    return { row, runs, pill, act, name: runs.find(x => /^…?שם/.test(x)) ?? '' }
  }
  for (const rtl of [true, false]) {
    // roomy: every field whole, the minutes GAP_MAX past the activity, the rest blank (the gap does not grow with the pane)
    const wide = have(120, rtl)
    expect(wide.pill).toBe(' Sonnet 5.5 ')
    expect(wide.act).toBe(rtl ? '…כותב קובץ אר' : 'כותב קובץ אר…')   // (17 cells: cut to ACT_MAX)
    expect(wide.name).toBe('שם בינוני')
    expect(text(wide.row).trim()).toBe(text(have(200, rtl).row).trim())
    expect(text(wide.row).trim().length).toBeLessThan(70)
    // 45: the activity cut, the rest whole; 40: the activity at ACT_KEEP (8 cells), the name cut; 36: the name at NAME_MIN and the pill
    // short, the activity still there; 32 with Opus: the activity whole-ish behind the short pill; 28: the activity gone; 24: the name cut
    expect(have(45, rtl).act.includes('…')).toBe(true)
    expect(have(45, rtl).name).toBe('שם בינוני')
    expect(have(45, rtl).pill).toBe(' Sonnet 5.5 ')
    expect(have(40, rtl).act).toBe(rtl ? '…כותב' : 'כותב…')
    expect(have(40, rtl).name.length).toBeLessThan(9)
    expect(have(40, rtl).pill).toBe(' Sonnet 5.5 ')
    expect(have(36, rtl).pill).toBe(' Sonnet ')
    expect(have(36, rtl).act).toBe(rtl ? '…כותב' : 'כותב…')
    expect(have(36, rtl).name).toBe(rtl ? '…שם בי' : 'שם בי…')
    expect(have(32, rtl, opus).pill).toBe(' Opus ')
    expect(have(32, rtl, opus).act).toBe(rtl ? '…כותב' : 'כותב…')
    expect(have(28, rtl).pill).toBe(' Sonnet ')
    expect(have(28, rtl).act).toBe('')
    expect(have(24, rtl).pill).toBe(' Sonnet ')
    expect(have(24, rtl).name).toBe(rtl ? '…שם ב' : 'שם ב…')
    expect(have(24, rtl, opus).name).toBe(rtl ? '…שם בי' : 'שם בי…')
  }
  // the whole sweep: exact width, whole glyphs, the pill never half (either text or none), the minutes always drawn, nothing the engine would merge
  for (let columns = 24; columns <= 200; columns++) {
    for (const rtl of [true, false]) {
      for (const r of [sonnet, opus]) {
        const { row, runs } = have(columns, rtl, r)
        expect(row.cells, `${columns}`).toHaveLength(columns)
        expect(wellFormed(row), `${columns}`).toBe(true)
        expect(runs.filter(x => /Sonnet|Opus|S…|O…/.test(x)).every(x => [' Sonnet 5.5 ', ' Sonnet ', ' Opus 5.5 ', ' Opus '].includes(x)), `${columns}: ${runs.join('|')}`).toBe(true)
        expect(runs.some(x => x.includes('12′')), `${columns}`).toBe(true)
        expect(mergeSafe(row), `${columns}`).toBe(true)
      }
    }
  }
})

test('cutting at a wide glyph never leaves half an emoji; names of only emoji fit the row', () => {
  const owl = ag('o', 1, { name: '🦉'.repeat(10), act: '🦉'.repeat(9), model: '🦉'.repeat(8) })
  const r = room({ title: '🦉'.repeat(30), agents: [owl] })
  for (const columns of [24, 31, 45, 90]) {
    for (const rtl of [true, false]) {
      const lay = layoutOffice(props({ columns, rtl, rooms: [r] }))
      expect(lay.rows.every(x => x.cells.length === columns)).toBe(true)
      expect(lay.rows.every(x => x.cells.every(c => !LONE_SURROGATE.test(c.ch)))).toBe(true)
      expect(lay.rows.every(wellFormed)).toBe(true)
      if (columns < 64) expect(text(lay.rows[0]!)).toContain('…')   // (at 90 the 60-cell title fits whole)
      expect(text(lay.rows[1]!)).toContain('🦉🦉')
    }
  }
  expect(cut('🦉'.repeat(15), NAME_MAX)).toBe('🦉'.repeat(11) + '…')
  expect(cut('✍️ כותב קובץ ארוך', ACT_MAX)).toBe('✍️ כותב קובץ אר…')
})

test('rooms: a blank gap row only between rooms; the "more / hide finished" row under a room that has one, its hit the whole row; the output is deterministic', () => {
  const a = room({ id: 'ra', agents: [ag('lead', 0), ag('d', 2, { status: 'done' })], done: 6, moreDone: 5, moreLabel: 'עוד 5 שסיימו' })
  const b = room({ id: 'rb', showDone: true, done: 1, agents: [ag('d', 2, { status: 'done' })], moreLabel: 'הסתר שסיימו' })
  const lay = layoutOffice(props({ rooms: [a, b] }))
  expect(lay.rows.map(r => r.id)).toEqual(['room:ra:head', 'room:ra:a:0', 'room:ra:a:1', 'room:ra:more', 'room:ra:gap', 'room:rb:head', 'room:rb:a:0', 'room:rb:more'])
  expect(lay.hits.map(hit => `${hit.kind}:${hit.id}@${hit.y}`)).toEqual(['pin:ra@0', 'roomDone:ra@0', 'agent:lead@1', 'agent:d@2', 'moreDone:ra@3', 'pin:rb@5', 'roomDone:rb@5', 'agent:d@6', 'moreDone:rb@7'])
  expect(lay.hits.find(hit => hit.kind === 'moreDone')).toEqual({ kind: 'moreDone', id: 'ra', x: 0, y: 3, w: 45, h: 1 })
  expect(text(lay.rows[4]!)).toBe(' '.repeat(45))
  // the more row: ▸ (dim) at the reading edge, then the label in the finished colour — a Hebrew run starting with its letter
  const more = lay.rows[3]!
  expect(text(more)).toBe(' '.repeat(45 - 15) + 'עוד 5 שסיימו ▸ ')
  expect(rowRuns(more.cells).filter(r => r.fg || r.dim)).toEqual([{ text: 'עוד 5 שסיימו', fg: '#9fb0e6' }, { text: '▸', dim: true }])
  expect(text(lay.rows[7]!).trim()).toBe('הסתר שסיימו ▸')
  const ltr = layoutOffice(props({ rooms: [a], rtl: false }))
  expect(text(ltr.rows[3]!)).toBe(' ▸ עוד 5 שסיימו' + ' '.repeat(45 - 15))
  expect(hitAt(ltr, 40, 3)?.kind).toBe('moreDone')
  // without a label there is no row (the room shows every finished agent, or has none)
  expect(layoutOffice(props({ rooms: [room({ agents: [ag('d', 2, { status: 'done' })], showDone: true })] })).rows.map(r => r.id)).toEqual(['room:sess-a:head', 'room:sess-a:a:0'])
  // a room whose agents are all held back is a head and the more row
  const held = layoutOffice(props({ rooms: [{ ...a, agents: [] }] }))
  expect(held.rows.map(r => r.id)).toEqual(['room:ra:head', 'room:ra:more'])
  expect(held.hits.map(hit => hit.kind)).toEqual(['pin', 'roomDone', 'moreDone'])
  expect(JSON.stringify(layoutOffice(props({ rooms: [a, b] })))).toBe(JSON.stringify(lay))
  expect(layoutOffice(props({ rooms: [] }))).toEqual({ rows: [], hits: [] })
})

test('decor: the walk-in shifts the emoji and the name round((1 - p) × WALK_CELLS) cells inside from the reading edge; the hop draws ⭐ beside the emoji; the hover lays HOVER_BG across the row', () => {
  expect([walkShift(0), walkShift(1 / 3), walkShift(0.5), walkShift(0.9), walkShift(1)]).toEqual([WALK_CELLS, 2, 2, 0, 0])
  expect([walkShift(-1), walkShift(2), walkShift(Number.NaN)]).toEqual([WALK_CELLS, 0, 0])   // out of range: clamped; nonsense: home
  const ltr = props({ rtl: false, columns: 40 })
  const rtl = props({ rtl: true, columns: 40 })
  const row = (p: OfficeProps, d: OfficeDecor, y: number) => text(layoutOffice(p, d).rows[y]!)
  // at home: no decor, and a walk-in that has arrived (p = 1)
  const home = row(ltr, NO_DECOR, 2)
  expect(home.startsWith(' 🦉 סוכן 1')).toBe(true)
  expect(row(ltr, decor({ entering: [['a1', 1]] }), 2)).toBe(home)
  // LTR: the emoji starts 3 cells in and walks to the edge (3 → 2 → 0); the name follows it, cut by as much; the pill does not move
  const pillAt = (p: OfficeProps, d: OfficeDecor) => layoutOffice(p, d).rows[2]!.cells.findIndex(c => c.ch === 'O')
  expect(row(ltr, decor({ entering: [['a1', 0]] }), 2).startsWith('    🦉 סו… ')).toBe(true)
  expect(row(ltr, decor({ entering: [['a1', 0.5]] }), 2).startsWith('   🦉 סוכ… ')).toBe(true)
  expect(pillAt(ltr, decor({ entering: [['a1', 0]] }))).toBe(pillAt(ltr, NO_DECOR))
  // RTL: from the right edge inward
  const rhome = row(rtl, NO_DECOR, 2)
  expect(rhome.endsWith('סוכן 1 🦉 ')).toBe(true)
  expect(row(rtl, decor({ entering: [['a1', 0]] }), 2).endsWith(' …סו 🦉    ')).toBe(true)   // (the ellipsis leads a cut Hebrew run in RTL)
  expect(row(rtl, decor({ entering: [['a1', 0.5]] }), 2).endsWith(' …סוכ 🦉   ')).toBe(true)
  expect(pillAt(rtl, decor({ entering: [['a1', 0]] }))).toBe(pillAt(rtl, NO_DECOR))
  // the hop: ⭐ before the emoji, the name giving it two cells
  expect(row(ltr, decor({ hop: ['a1'] }), 2).startsWith(' ⭐🦉 סוכ… ')).toBe(true)
  expect(row(rtl, decor({ hop: ['a1'] }), 2).endsWith(' …סוכ ⭐🦉 ')).toBe(true)
  // both at once: the walk-in carries the ⭐ along, the name down to its ellipsis
  expect(row(ltr, decor({ hop: ['a1'], entering: [['a1', 0]] }), 2).startsWith('    ⭐🦉 … ')).toBe(true)
  // only the decorated row changes; the other rows and the hits are the plain layout's
  const plain = layoutOffice(ltr)
  const moved = layoutOffice(ltr, decor({ hop: ['a1'], entering: [['lead', 0]] }))
  expect(moved.hits).toEqual(plain.hits)
  expect(moved.rows.map(r => r.id)).toEqual(plain.rows.map(r => r.id))
  expect(moved.rows[0]).toEqual(plain.rows[0])
  expect(moved.rows[1]).not.toEqual(plain.rows[1])
  expect(moved.rows[2]).not.toEqual(plain.rows[2])
  // hover: HOVER_BG across the whole row only; the emoji stays home; a selected emoji keeps its frame
  const hov = layoutOffice({ ...ltr, selected: 'a1' }, decor({ hover: 'a1' }))
  expect(hov.rows[2]!.cells.every(c => c.bg === HOVER_BG)).toBe(true)
  expect(hov.rows.filter(r => r.cells.some(c => c.bg === HOVER_BG))).toHaveLength(1)
  expect(text(hov.rows[2]!)).toBe(home)
  expect(hov.rows[2]!.cells[1]).toEqual({ ch: '🦉', fg: '#ffffff', bold: true, bg: HOVER_BG, brk: true })
  expect(rowRuns(hov.rows[2]!.cells).every(r => r.bg === HOVER_BG)).toBe(true)
  // an id the office does not hold decorates nothing
  expect(layoutOffice(ltr, decor({ hover: 'ghost', hop: ['ghost'], entering: [['ghost', 0]] }))).toEqual(plain)
})

test('decor: a narrow row leaves the emoji less room — the hop and the walk-in stop before the pill, never over it', () => {
  const r = room({ agents: [ag('x', 1, { name: 'א', startMin: 100, failed: true, longRunning: true })] })
  for (const rtl of [true, false]) {
    for (const columns of [24, 26, 28]) {
      const p = props({ rtl, columns, rooms: [r] })
      const plain = layoutOffice(p).rows[1]!
      const lay = layoutOffice(p, decor({ hop: ['x'], entering: [['x', 0]] })).rows[1]!
      expect(wellFormed(lay)).toBe(true)
      expect(lay.cells).toHaveLength(columns)
      expect(text(lay)).toContain('⭐🦉')
      // the pill (or what is left of it) and the tail sit in the cells they sat in
      const col = (r: Cells, ch: string) => r.cells.findIndex(c => c.ch === ch)
      expect(col(lay, 'O')).toBe(col(plain, 'O'))
      expect(col(lay, '′')).toBe(col(plain, '′'))
      expect(col(lay, '′')).toBeGreaterThanOrEqual(0)
    }
  }
})

/** A small office for the decor sweep: two rooms, the lead first, done agents shown in the second, three kinds of emoji. */
function smallOffice(): OfficeRoom[] {
  const a = Array.from({ length: 7 }, (_, i) => ag(`a${i}`, i, { emoji: i % 2 ? '🦉' : '🕵️' }))
  const b = Array.from({ length: 5 }, (_, i) => ag(`b${i}`, i + 1, { status: i % 2 ? 'done' : 'running', emoji: '👨‍💻' }))
  return [room({ id: 'ra', agents: a }), room({ id: 'rb', showDone: true, agents: b, moreLabel: 'הסתר שסיימו' })]
}

test('decor sweep: at the sweep widths 24..200, both directions, every walk-in step, hops and a hover — each row is exactly `columns` cells, every wide glyph keeps its pair, the hits never move, only the decorated agent\'s row changes', { timeoutMs: 30_000 }, () => {
  const rooms = smallOffice()
  const ids = rooms.flatMap(r => r.agents.map(a => a.id))
  const bad: string[] = []
  for (const columns of sweepWidths()) {
    for (const rtl of [true, false]) {
      const p = props({ columns, rtl, rooms })
      const plain = layoutOffice(p)
      const plainHits = JSON.stringify(plain.hits)
      const plainText = plain.rows.map(text)
      for (const progress of [0, 0.4, 0.75]) {   // walkShift 3, 2, 1 (at 1 the emoji is home: the plain layout)
        const hop = ids.filter((_, i) => i % 3 === 0)
        const d = decor({ hover: ids[columns % ids.length]!, hop, entering: ids.map((id): [string, number] => [id, progress]) })
        const lay = layoutOffice(p, d)
        const at = `${columns}${rtl ? ' rtl' : ''} p=${progress}`
        if (lay.rows.length !== plain.rows.length || JSON.stringify(lay.hits) !== plainHits) bad.push(`${at}: rows or hits moved`)
        for (let y = 0; y < lay.rows.length; y++) {
          const row = lay.rows[y]!
          if (row.cells.length !== columns) bad.push(`${at}: row ${y} has ${row.cells.length} cells`)
          if (text(row) === plainText[y]) continue
          if (!wellFormed(row)) bad.push(`${at}: row ${y} breaks a wide glyph`)
          if (!lay.hits.some(r => r.kind === 'agent' && r.y === y)) bad.push(`${at}: row ${y} changed but is no agent's`)
          for (const run of hebrewRuns(row)) if (!runOk(run, rtl)) bad.push(`${at}: row ${y} run "${run}" breaks THE HEBREW RULE`)
          if (!mergeSafe(row)) bad.push(`${at}: row ${y} lays two Hebrew runs the engine would merge`)
        }
      }
    }
  }
  expect(bad).toEqual([])
})

test('rowCount: the number of layout rows without building a cell — equal to layoutOffice(...).rows.length across room shapes and widths 24..200', { timeoutMs: 30_000 }, () => {
  const sizes = [0, 1, 2, 3, 4, 5, 8, 13, 14, 27]
  const rooms: OfficeRoom[] = sizes.map((n, r) => room({
    id: `r${r}`, showDone: r % 2 === 0, moreDone: r % 3, moreLabel: r % 3 ? `עוד ${r % 3} שסיימו` : r % 2 === 0 && n > 3 ? 'הסתר שסיימו' : '',
    agents: Array.from({ length: n }, (_, i) => ag(`r${r}-${i}`, i, { status: i % 4 === 3 ? 'done' : i % 5 === 4 ? 'stale' : 'running' })),
  }))
  const held: OfficeRoom = room({ id: 'gone', agents: [], moreDone: 2, moreLabel: 'עוד 2 שסיימו' })
  const shapes = [[], [rooms[1]!], rooms, [held], [held, ...rooms], [...rooms, held]]
  const bad: string[] = []
  for (const columns of [24, 31, 45, 60, 100, 200]) {
    shapes.forEach((shape, k) => {
      const p = props({ columns, rooms: shape, rtl: columns % 2 === 0 })
      const n = layoutOffice(p).rows.length
      if (rowCount(p) !== n) bad.push(`${columns} shape ${k}: ${rowCount(p)} ≠ ${n}`)
    })
  }
  expect(bad).toEqual([])
  for (const columns of [24, 31, 45, 200]) {
    const p = props({ columns, rooms: tenByTen() })
    expect(rowCount(p)).toBe(layoutOffice(p).rows.length)
    expect(rowCount(p)).toBe(10 * 11 + 9)
  }
  expect(rowCount(props({ rooms: [] }))).toBe(0)
  expect(rowCount(props())).toBe(3)
  expect(ROW_MARGIN).toBe(1)
})
