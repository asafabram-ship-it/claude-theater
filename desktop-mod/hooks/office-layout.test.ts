// office-layout.ts: the pure cell layout of the desktop office. No engine, no
// `$`: the rows of cells with their ids, one row per agent in both directions,
// the hit rectangles, THE HEBREW RULE's runs, run merging and the row window
// are asserted on the data.

import { expect, test } from 'claude-code/testing'

import { hebrewRuleOk } from './i18n'
import { ACT_MAX, EMOJI_CELLS, HOVER_BG, MODEL_FG, MODEL_FULL_FROM, NAME_MAX, NO_DECOR, ROW_MARGIN, WALK_CELLS, blankRow, blocksOfParts, cut, ellipsisFirst, firstGlyph, hitAt, iconLabel, layoutOffice, lineRow, modelText, place, put, rowCount, rowRuns, segments, tailText, textWidth, walkShift, windowRows } from './office-layout'
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
/** A decor with the given hop ids, walk-in progresses, hover and hovered room head. */
function decor(over: { hover?: string | null; hoverRoom?: string | null; hop?: string[]; entering?: Array<[string, number]> } = {}): OfficeDecor {
  return { hover: over.hover ?? null, hoverRoom: over.hoverRoom ?? null, hop: new Set(over.hop ?? []), entering: new Map(over.entering ?? []) }
}
type StyledCells = Cells & { cells: ReadonlyArray<{ ch: string; fg?: string; bg?: string; bold?: true; dim?: true; brk?: true }> }
const HEB = /\p{Script=Hebrew}/u
const OTHER_LETTER = /(?!\p{Script=Hebrew})\p{L}/u
const DIGIT = /\p{Nd}/u
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
 * with no letter of another script between them would come out swapped; and a digit after a Hebrew letter (in cell order) with
 * no other-script letter between them stays right-to-left and glues to that block, wherever its run is. True when neither
 * happens on the row (a digit inside the Hebrew run itself is the run's own, in logical order).
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
    } else if (DIGIT.test(c.ch)) {
      if (seenHebrew && boundary && !parted) return false
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
  expect(mergeSafe(rtl)).toBe(true)   // (the LTR line is the English header's shape with Hebrew words: not a line the Client draws)
  for (const row of [ltr, rtl]) for (const run of hebrewRuns(row)) expect(hebrewRuleOk(run)).toBe(true)
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

test('the room head: the pin (📌 pinned, a dim 📌 under the pointer, else blank — never ○), title and counts, LTR flush right and RTL flush left; the ✅ button covers the counts; the title is a Hebrew run of its own', () => {
  const r = room({ pinned: true, run: 2, stale: 1, done: 3 })
  const counts = '🟢2 ⏳1 ✅3'                                  // 11 cells: three wide glyphs, eight narrow
  const ltr = layoutOffice(props({ rtl: false, rooms: [r] }))
  const lh = ltr.rows[0]!
  expect(lh.cells[0]?.ch).toBe('📌')
  expect(lh.cells[1]?.ch).toBe('')
  expect(lh.cells[2]?.ch).toBe(' ')
  // LTR: the counts right after the pin, the title after them (a Hebrew title before the counts would take their digits into
  // its mirrored block — THE HEBREW RULE (5)); the ✅ button over the counts
  expect(seg(lh, 3, 14)).toBe(counts)
  expect(lh.cells[3]?.ch).toBe('🟢')
  expect(lh.cells[13]?.ch).toBe('3')
  expect(lh.cells[14]?.ch).toBe(' ')
  expect(seg(lh, 15, 15 + 13)).toBe('תקרא את המסמך')
  expect(ltr.hits.find(hit => hit.kind === 'roomDone')).toEqual({ kind: 'roomDone', id: 'sess-a', x: 3, y: 0, w: 11, h: 1 })
  expect(hitAt(ltr, 13, 0)?.kind).toBe('roomDone')
  expect(hitAt(ltr, 14, 0)).toBeUndefined()
  expect(hitAt(ltr, 2, 0)).toBeUndefined()
  expect(mergeSafe(lh)).toBe(true)
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
  // no ✅ button without done agents; an unpinned room draws NO pin glyph (no ○): its cells stay blank, the pin hit stays
  // where it is; stale and done counts only when non-zero
  const plain = layoutOffice(props({ rtl: false }))
  expect(plain.hits.some(hit => hit.kind === 'roomDone')).toBe(false)
  expect(plain.rows[0]?.cells[0]?.ch).toBe(' ')
  expect(text(plain.rows[0]!).startsWith('   🟢2 ')).toBe(true)
  expect(text(plain.rows[0]!)).not.toContain('○')
  expect(text(plain.rows[0]!)).not.toContain('📌')
  expect(hitAt(plain, 0, 0)).toEqual({ kind: 'pin', id: 'sess-a', x: 0, y: 0, w: EMOJI_CELLS, h: 1 })
  expect(text(plain.rows[0]!)).not.toContain('⏳')
  // the pointer over the head (decor.hoverRoom): a dim 📌 at the pin cell, the title where it was; a pinned room's 📌 stays bright
  const hovLtr = layoutOffice(props({ rtl: false }), decor({ hoverRoom: 'sess-a' }))
  expect(hovLtr.rows[0]?.cells[0]).toEqual({ ch: '📌', dim: true, brk: true })
  expect(text(hovLtr.rows[0]!).startsWith('📌 🟢2 ')).toBe(true)
  expect(seg(hovLtr.rows[0]!, 7, 7 + 13)).toBe('תקרא את המסמך')
  expect(seg(plain.rows[0]!, 7, 7 + 13)).toBe('תקרא את המסמך')
  expect(hovLtr.hits).toEqual(plain.hits)
  const hovRtl = layoutOffice(props(), decor({ hoverRoom: 'sess-a' }))
  expect(hovRtl.rows[0]?.cells[43]).toEqual({ ch: '📌', dim: true, brk: true })
  expect(hovRtl.rows[0]?.cells[44]?.ch).toBe('')
  expect(text(layoutOffice(props()).rows[0]!).endsWith('תקרא את המסמך   ')).toBe(true)
  expect(text(hovRtl.rows[0]!).endsWith('תקרא את המסמך 📌')).toBe(true)
  expect(rowRuns(hovRtl.rows[0]!.cells).find(x => x.text === '📌')).toEqual({ text: '📌', dim: true })
  expect(rowRuns(rh.cells).find(x => x.text === '📌')).toEqual({ text: '📌' })
  expect(layoutOffice(props({ rooms: [r] }), decor({ hoverRoom: 'sess-a' })).rows[0]?.cells[43]).toEqual({ ch: '📌', brk: true })
  // another room's hover draws nothing here
  expect(layoutOffice(props({ rtl: false }), decor({ hoverRoom: 'other' }))).toEqual(plain)
  for (const lay of [plain, hovLtr, hovRtl]) for (const row of lay.rows) { expect(wellFormed(row)).toBe(true); expect(mergeSafe(row)).toBe(true) }
  // the title is one run (a single Hebrew string, bold, starting with a Hebrew letter), never split by the renderer
  const titleRun = rowRuns(lh.cells).find(r => r.text.includes('תקרא'))
  expect(titleRun).toEqual({ text: 'תקרא את המסמך', bold: true })
  // a title with a Latin word inside is split into runs at the Latin alone (the engine parts Hebrew blocks across it), the
  // leading digit riding inside its Hebrew run in logical order; in both directions
  const mixed = layoutOffice(props({ rooms: [room({ title: '4 קבצים של Claude Code לבדיקה' })] })).rows[0]!
  expect(rowRuns(mixed.cells).filter(r => r.bold).map(r => r.text)).toEqual(['לבדיקה', 'Claude Code', '4 קבצים של'])
  expect(mergeSafe(mixed)).toBe(true)
  for (const run of hebrewRuns(mixed)) expect(hebrewRuleOk(run)).toBe(true)
  const mixedLtr = layoutOffice(props({ rtl: false, rooms: [room({ title: '4 קבצים של Claude Code לבדיקה', done: 3 })] })).rows[0]!
  expect(rowRuns(mixedLtr.cells).filter(r => r.bold).map(r => r.text)).toEqual(['4 קבצים של', 'Claude Code', 'לבדיקה'])
  expect(text(mixedLtr).startsWith('   🟢2 ✅3 4 קבצים של')).toBe(true)
  expect(mergeSafe(mixedLtr)).toBe(true)
  // ellipsisFirst, the Client's helper for its plain Texts
  expect(ellipsisFirst('שם ארוך…')).toBe('…שם ארוך')
  expect(ellipsisFirst('Reviewer…')).toBe('Reviewer…')
  expect(ellipsisFirst('שם ארוך')).toBe('שם ארוך')
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

test('the agent row (LTR): margin, emoji, the persona name (bold, status colour), the model word (its family colour, no pill), the activity whole, the badges and the time at the room\'s tail field; a finished row is dim with its ✅ alone; the fields line up down the room', () => {
  const lead = ag('lead', 0, { name: 'מנהל', model: 'Opus 5.5', act: '📖 קורא', startMin: 12, failed: true, star: 1_700_000, longRunning: true })
  const other = ag('a1', 1, { emoji: '🐢', name: 'שם ארוך מאוד שנחתך בוודאות', model: 'Sonnet 5.5', modelFam: 'sonnet', act: '✍️ כותב קובץ ארוך', startMin: 0, status: 'stale' })
  const done = ag('a2', 2, { name: 'גמור', model: '?', modelFam: 'other', act: '✅ סיים', startMin: null, status: 'done' })
  const r = room({ showDone: true, agents: [lead, other, done] })
  // 72 columns: the fields whole (4 + 24 + 1 + 10 + 1 + 17 = 57), the model with its version (from MODEL_FULL_FROM), the tail
  // field (9) GAP_MAX past the activity
  const lay = layoutOffice(props({ rtl: false, columns: 72, rooms: [r], selected: 'lead' }))
  expect(lay.rows.map(x => x.id)).toEqual(['room:sess-a:head', 'room:sess-a:a:0', 'room:sess-a:a:1', 'room:sess-a:a:2'])
  const [, r0, r1, r2] = lay.rows
  // the name field is the room's widest name (24 cells: the long name cut), the model field its widest (`Sonnet 5.5`), the act its widest (17)
  expect(seg(r0!, 0, 4)).toBe(' 🦉 ')
  expect(seg(r0!, 4, 4 + 24).trimEnd()).toBe('מנהל')
  expect(seg(r1!, 4, 4 + 24)).toBe('שם ארוך מאוד שנחתך בווד…')
  expect(seg(r2!, 4, 4 + 24).trimEnd()).toBe('גמור')
  expect(seg(r0!, 29, 29 + 10)).toBe('Opus 5.5  ')
  expect(seg(r1!, 29, 29 + 10)).toBe('Sonnet 5.5')
  expect(seg(r2!, 29, 29 + 10)).toBe('?         ')
  expect(seg(r0!, 40, 40 + 17).trimEnd()).toBe('📖 קורא')
  expect(seg(r1!, 40, 40 + 17)).toBe('✍️ כותב קובץ ארוך')
  expect(seg(r2!, 40, 40 + 17).trimEnd()).toBe('✅')   // a finished agent: its ✅ alone, never the word
  // the tail: badges then the time at the far end (the room's widest tail is `❌⭐⏰ ⏱️ 12′` = 13 cells, right-aligned in its
  // field) — but THE HEBREW RULE (5): the lead's row ends in a Hebrew activity with nothing Latin after it, so in LTR the
  // time would glue to it; the badges stay, the time goes. (An English activity, the LTR case, keeps it: below.)
  expect(seg(r0!, 59, 72).trimStart()).toBe('❌⭐⏰')
  expect(seg(r1!, 58, 72).trim()).toBe('')
  expect(seg(r2!, 58, 72).trim()).toBe('')
  const english = layoutOffice(props({ rtl: false, columns: 72, rooms: [room({ showDone: true, agents: [{ ...lead, act: '📖 Reading' }, { ...other, act: '✍️ Writing' }] })] }))
  expect(text(english.rows[1]!).trimEnd().endsWith('❌⭐⏰ ⏱️ 12′')).toBe(true)
  expect(text(english.rows[2]!).trimEnd().endsWith('⏱️ <1′')).toBe(true)
  const primeAt = (row: Cells) => row.cells.findIndex(c => c.ch === '′')
  expect(primeAt(english.rows[1]!)).toBe(primeAt(english.rows[2]!))   // the minutes aligned down the room
  expect(primeAt(english.rows[1]!)).toBeGreaterThan(60)
  expect(english.rows.every(mergeSafe)).toBe(true)
  // styles: the selected emoji white and bold; the name bold in the status colour; the model word in its family colour with no
  // background; a finished row dim throughout; the tail dim
  expect(r0!.cells[1]).toEqual({ ch: '🦉', fg: '#ffffff', bold: true, brk: true })
  expect(r1!.cells[1]).toEqual({ ch: '🐢', brk: true })
  const runs = (row: { cells: readonly { ch: string; fg?: string; bg?: string; bold?: true; dim?: true; brk?: true }[] }) => rowRuns(row.cells)
  expect(runs(r0!).find(x => x.text === 'מנהל')).toEqual({ text: 'מנהל', fg: '#7ee29a', bold: true })
  expect(runs(r1!).find(x => x.text.endsWith('…') && x.bold)).toEqual({ text: 'שם ארוך מאוד שנחתך בווד…', fg: '#e6c07e', bold: true })
  expect(runs(r0!).find(x => x.text === 'Opus 5.5')).toEqual({ text: 'Opus 5.5', fg: MODEL_FG.opus })
  expect(runs(r1!).find(x => x.text === 'Sonnet 5.5')).toEqual({ text: 'Sonnet 5.5', fg: MODEL_FG.sonnet })
  expect(runs(r2!).find(x => x.text === '?')).toEqual({ text: '?', fg: MODEL_FG.other, dim: true })
  expect(runs(r2!).find(x => x.text === 'גמור')).toEqual({ text: 'גמור', fg: '#9fb0e6', bold: true, dim: true })
  expect(runs(r2!).find(x => x.text === '✅')).toEqual({ text: '✅', fg: '#9fb0e6', dim: true })
  expect(runs(r0!).find(x => x.text === 'קורא')).toEqual({ text: 'קורא', fg: '#7ee29a' })
  expect(runs(r0!).find(x => x.text === '📖')).toEqual({ text: '📖', fg: '#7ee29a' })
  expect(runs(r0!).find(x => x.text === '❌⭐⏰')).toEqual({ text: '❌⭐⏰', dim: true })
  expect(lay.rows.every(row => row.cells.every(c => c.bg === undefined))).toBe(true)
  expect(runs(r2!).find(x => x.text === 'סיים')).toBeUndefined()
  // THE HEBREW RULE (3): a Hebrew activity beside a Hebrew name with no Latin between them (`?` model, no model) is its emoji alone;
  // the word is drawn once the model word has Latin in it, or the name has no Hebrew — in both directions
  for (const rtl of [true, false]) {
    const running = { ...done, status: 'running' as const, act: '📖 קורא' }
    const unparted = layoutOffice(props({ rtl, columns: 72, rooms: [room({ agents: [running] })] })).rows[1]!
    expect(text(unparted)).toContain('📖')
    expect(text(unparted)).not.toContain('קורא')
    expect(mergeSafe(unparted)).toBe(true)
    const latinModel = layoutOffice(props({ rtl, columns: 72, rooms: [room({ agents: [{ ...running, model: 'nova-6-0' }] })] })).rows[1]!
    expect(rowRuns(latinModel.cells).find(x => x.text === 'קורא')).toEqual({ text: 'קורא', fg: '#7ee29a' })
    expect(mergeSafe(latinModel)).toBe(true)
    const latinName = layoutOffice(props({ rtl, columns: 72, rooms: [room({ agents: [{ ...running, name: 'Reviewer' }] })] })).rows[1]!
    expect(rowRuns(latinName.cells).find(x => x.text === 'קורא')).toBeDefined()
    expect(mergeSafe(latinName)).toBe(true)
    // THE HEBREW RULE (5): in LTR the minutes after a Hebrew name with nothing Latin between them would glue to it — the row keeps
    // the badges and drops the minutes; a Latin model word or an English activity parts them; RTL draws them (the tail comes first)
    const glued = layoutOffice(props({ rtl, columns: 72, rooms: [room({ agents: [{ ...running, model: '?', act: '✅ סיים', startMin: 12, failed: true }] })] })).rows[1]!
    expect(text(glued).includes('12′')).toBe(rtl)
    expect(text(glued)).toContain('❌')
    expect(mergeSafe(glued)).toBe(true)
    const partedModel = layoutOffice(props({ rtl, columns: 72, rooms: [room({ agents: [{ ...running, model: 'nova-6-0', act: '✅ Done', startMin: 12 }] })] })).rows[1]!
    expect(text(partedModel)).toContain('12′')
    const partedAct = layoutOffice(props({ rtl, columns: 72, rooms: [room({ agents: [{ ...running, model: '?', act: '📖 Reading', startMin: 12 }] })] })).rows[1]!
    expect(text(partedAct)).toContain('12′')
    expect(mergeSafe(partedAct)).toBe(true)
    const latinNameTail = layoutOffice(props({ rtl, columns: 72, rooms: [room({ agents: [{ ...running, name: 'Reviewer', model: '?', act: '', startMin: 12 }] })] })).rows[1]!
    expect(text(latinNameTail)).toContain('12′')
  }
  for (const row of lay.rows) {
    expect(row.cells).toHaveLength(72)
    expect(wellFormed(row)).toBe(true)
    expect(mergeSafe(row)).toBe(true)
    for (const run of hebrewRuns(row)) expect(runOk(run, false)).toBe(true)
  }
  // modelText, firstGlyph and tailText, the row's pieces
  expect(modelText('Opus 5.5', true)).toBe('Opus 5.5')
  expect(modelText('Opus 5.5')).toBe('Opus')
  expect(modelText('?')).toBe('?')
  expect(modelText('')).toBe('?')
  expect(modelText('x'.repeat(40), true)).toBe(`${'x'.repeat(11)}…`)
  expect(modelText('nova-6-0')).toBe('nova-6-0')
  expect(firstGlyph('✍️ כותב')).toBe('✍️')
  expect(firstGlyph('')).toBe('')
  expect(tailText(lead, false, 'he')).toBe('❌⭐⏰ ⏱️ 12′')
  expect(tailText(lead, false, 'en')).toBe('❌⭐⏰ ⏱️ 12 min')
  expect(tailText(lead, true, 'he')).toBe('12′ ⏱️ ❌⭐⏰')
  expect(tailText(lead, true, 'he', false)).toBe('❌⭐⏰')
  expect(tailText(other, true, 'he')).toBe('<1′ ⏱️')
  expect(tailText(done, true, 'he')).toBe('')
  expect(tailText({ ...done, startMin: 12 }, true, 'he')).toBe('')   // a finished agent: never a time
  expect(MODEL_FULL_FROM).toBe(60)
})

test('the agent row (RTL): the same row mirrored — the emoji at the right edge, the name to its left, the model word, then the activity (its emoji first), the time at the left edge (its clock nearest the content: read first); the version only from MODEL_FULL_FROM columns', () => {
  const cast = [ag('lead', 0, { name: 'המנהל', act: '🤔 חושב', startMin: 1 }), ag('a1', 1, { emoji: '🦆', name: 'הברווז', act: '🤔 חושב', startMin: 7, status: 'stale' })]
  // 34 columns: the family word alone (`Opus`), every field whole, the time GAP_MAX past the activity
  const lay = layoutOffice(props({ rtl: true, columns: 34, rooms: [room({ agents: cast })] }))
  const [, r0, r1] = lay.rows
  expect(text(r0!)).toBe('   1′ ⏱️   חושב 🤔 Opus  המנהל 🦉 ')
  expect(text(r1!)).toBe('   7′ ⏱️   חושב 🤔 Opus הברווז 🦆 ')
  expect(rowRuns(r0!.cells).map(x => x.text)).toEqual(['   ', '1′ ⏱️', '   ', 'חושב', ' ', '🤔', ' ', 'Opus', '  ', 'המנהל', ' ', '🦉 '])
  expect(rowRuns(r0!.cells).find(x => x.text === 'Opus')).toEqual({ text: 'Opus', fg: MODEL_FG.opus })
  expect(rowRuns(r0!.cells).find(x => x.text === '1′ ⏱️')).toEqual({ text: '1′ ⏱️', dim: true })
  expect(r0!.cells[31]?.ch).toBe('🦉')
  expect(r1!.cells[31]?.ch).toBe('🦆')
  expect(r0!.cells[3]?.ch).toBe('1')
  expect(r1!.cells[3]?.ch).toBe('7')
  // 29 columns: the content (4 + 6 + 1 + 4 + 1 + 7 = 23) and the tail field (5) fill the row: the time at the left edge
  const tight = layoutOffice(props({ rtl: true, columns: 29, rooms: [room({ agents: cast })] })).rows[1]!
  expect(text(tight)).toBe('1′ ⏱️ חושב 🤔 Opus  המנהל 🦉 ')
  // 26..28 columns: the time has no room beside the activity word — it goes whole, the word stays (the room has no badges: an empty tail field)
  const noTime = layoutOffice(props({ rtl: true, columns: 26, rooms: [room({ agents: cast })] })).rows[1]!
  expect(text(noTime)).toBe('   חושב 🤔 Opus  המנהל 🦉 ')
  expect(text(layoutOffice(props({ rtl: true, columns: 28, rooms: [room({ agents: cast })] })).rows[1]!)).toBe('     חושב 🤔 Opus  המנהל 🦉 ')
  // 60 columns: the model with its version, the content at the right edge, the left of the row blank
  const wide = layoutOffice(props({ rtl: true, columns: 60, rooms: [room({ agents: cast })] })).rows[1]!
  expect(text(wide).trimStart()).toBe('1′ ⏱️   חושב 🤔 Opus 5.5  המנהל 🦉 ')
  expect(text(wide).length).toBe(60)
  for (const row of [r0!, r1!, tight, noTime, wide]) { expect(mergeSafe(row)).toBe(true); expect(wellFormed(row)).toBe(true) }
})

/** The UBA's European terminators a row could hold (bidi class ET): # $ %, ¢ £ ¤ ¥, °, ±, ‰ ‱ ′ ″ ‴, the currency signs (₪ €), the minus sign. */
const ET = /^[#-%¢-¥°±‰-‴₠-⃏−]$/u
/**
 * THE READER'S VIEW of a row drawn as one LTR paragraph, by the bidi rules mergeSafe models: a Hebrew glyph is R, another
 * script's letter L, a terminator next to a digit joins its number (W5: `12′`, `42%` — the prime rides with the minutes;
 * one with no number beside it is a neutral), a digit takes the strong type before it (sos is L: AN after R through
 * neutrals, else L), a stretch of neutrals between two of one direction takes it (a number after Hebrew counts as R), else
 * the paragraph's L; the runs of R (with their numbers) are then mirrored in place. The visual row is read from the right,
 * token by token: a token holding Hebrew back in logical order (it was mirrored), any other (a number, a Latin word, an
 * emoji) as it is. The string a Hebrew reader sees, in reading order, a space between tokens. (Checked against python-bidi
 * 0.6.7 — the unicode-bidi crate — on every pinned reading below.)
 */
function visualRtlReading(row: Cells): string {
  const gl = row.cells.map(c => c.ch).filter(ch => ch !== '')
  type T = 'L' | 'R' | 'EN' | 'ET' | 'AN' | 'N'
  const types: T[] = gl.map(ch => (HEB.test(ch) ? 'R' : OTHER_LETTER.test(ch) ? 'L' : DIGIT.test(ch) ? 'EN' : ET.test(ch) ? 'ET' : 'N'))
  // W5: a run of terminators adjacent to a European number becomes part of it; W6: one left alone is a neutral
  for (let i = 0; i < types.length; i++) {
    if (types[i] !== 'ET') continue
    let j = i
    while (j < types.length && types[j] === 'ET') j++
    const en = (i > 0 && types[i - 1] === 'EN') || (j < types.length && types[j] === 'EN')
    for (let k = i; k < j; k++) types[k] = en ? 'EN' : 'N'
    i = j - 1
  }
  let strong: 'L' | 'R' = 'L'
  for (let i = 0; i < types.length; i++) {
    const t = types[i]!
    if (t === 'R' || t === 'L') strong = t
    else if (t === 'EN') types[i] = strong === 'R' ? 'AN' : 'L'
  }
  const dir = (t: T) => (t === 'R' || t === 'AN' ? 'R' : 'L')
  const levels = types.map(t => (t === 'AN' ? 2 : t === 'R' ? 1 : 0))
  for (let i = 0; i < types.length; i++) {
    if (types[i] !== 'N') continue
    let j = i
    while (j < types.length && types[j] === 'N') j++
    const lv = (i > 0 ? dir(types[i - 1]!) : 'L') === 'R' && (j < types.length ? dir(types[j]!) : 'L') === 'R' ? 1 : 0
    for (let k = i; k < j; k++) levels[k] = lv
    i = j - 1
  }
  const visual = [...gl]
  for (const min of [2, 1]) {
    let i = 0
    while (i < visual.length) {
      if (levels[i]! < min) { i++; continue }
      let j = i
      while (j < visual.length && levels[j]! >= min) j++
      visual.splice(i, 0, ...visual.splice(i, j - i).reverse())
      levels.splice(i, 0, ...levels.splice(i, j - i).reverse())
      i = j
    }
  }
  // the tokens: a mirrored stretch (level ≥ 1, its inner spaces with it) read back to logical order (the whole reversed, then
  // its numbers reversed again); the rest split at spaces. The reader takes them from the right.
  const tokens: string[] = []
  let i = 0
  while (i < visual.length) {
    if (levels[i]! >= 1) {
      let j = i
      while (j < visual.length && levels[j]! >= 1) j++
      const back = visual.slice(i, j).reverse()
      const lv = levels.slice(i, j).reverse()
      for (let k = 0; k < back.length; k++) {
        if (lv[k]! < 2) continue
        let m = k
        while (m < back.length && lv[m]! >= 2) m++
        back.splice(k, 0, ...back.splice(k, m - k).reverse())
        k = m - 1
      }
      tokens.push(back.join('').replace(/ +/g, ' ').trim())
      i = j
    } else if (visual[i] === ' ') i++
    else {
      let j = i
      while (j < visual.length && levels[j]! < 1 && visual[j] !== ' ') j++
      tokens.push(visual.slice(i, j).join(''))
      i = j
    }
  }
  return tokens.reverse().join(' ')
}

test('visualRtlReading models the engine: a leading digit reads after the word, a digit after Hebrew rides inside, a Latin word parts two Hebrew words, a clock before a number at the row\'s left edge reads clock then number, a terminator rides with its number (W5)', () => {
  const rowOf = (s: string) => { const row = blankRow('r', 40); put(row, 0, s); return row }
  expect(visualRtlReading(rowOf('4 תמלילים'))).toBe('תמלילים 4')
  expect(visualRtlReading(rowOf('עוד 5 שסיימו'))).toBe('עוד 5 שסיימו')
  expect(visualRtlReading(rowOf('לבדיקה Code 4 קבצים של'))).toBe('קבצים של 4 Code לבדיקה')   // the head's blocks (cell order): the leading digit after its words, the Latin word parting the blocks
  // the Hebrew row's time field at the row's left edge: the number follows sos (L), so it and its prime stay left-to-right — the reader, from the right, meets the clock then `3′`
  expect(visualRtlReading(rowOf('3′ ⏱️ ❌⭐'))).toBe('❌⭐ ⏱️ 3′')
  expect(visualRtlReading(rowOf('⏱️ 3 דק׳'))).toBe('דק׳ 3 ⏱️')           // the unit after the number (logical order) lands BEFORE it for the reader: why the Hebrew row uses the prime
  expect(visualRtlReading(rowOf('דק׳ 3 ⏱️'))).toBe('⏱️ דק׳ 3')           // ...and laid the other way the number glues to the unit and is mirrored with it
  // W5: a terminator beside a number is part of it — LTR's glue mirrors a number after Hebrew with the word, and the prime
  // (or the %) rides with the number, never left behind at the edge (python-bidi: '12′   בשוח', 'תסכממ 42% ולצונ')
  expect(visualRtlReading(rowOf('חושב   12′'))).toBe('חושב 12′')
  expect(visualRtlReading(rowOf('משך 7′'))).toBe('משך 7′')
  expect(visualRtlReading(rowOf('נוצלו 42% ממכסת 5 השעות'))).toBe('נוצלו 42% ממכסת 5 השעות')
  expect(visualRtlReading(rowOf('עזרה %'))).toBe('% עזרה')               // a terminator with no number beside it is a plain neutral: trailing, it lands at the right edge
})

test('iconLabel: a labelled control reads icon-then-word — for the Hebrew reader the icon TRAILS the word in logical order (a trailing neutral lands at the paragraph\'s right, where the reader starts); a leading icon would read after the word; any other word takes the icon first', () => {
  const rowOf = (s: string) => { const row = blankRow('r', 40); put(row, 0, s); return row }
  // the toolbar's three, the help's three, in Hebrew: the word first in the string, the icon after it — and the reader sees the icon first
  expect(iconLabel('☐', 'שסיימו', true)).toBe('שסיימו ☐')
  expect(visualRtlReading(rowOf(iconLabel('☐', 'שסיימו', true)))).toBe('☐ שסיימו')
  expect(visualRtlReading(rowOf(iconLabel('☑', 'שסיימו', true)))).toBe('☑ שסיימו')
  expect(visualRtlReading(rowOf(iconLabel('🔔', 'צליל', true)))).toBe('🔔 צליל')
  expect(visualRtlReading(rowOf(iconLabel('🔕', 'צליל', true)))).toBe('🔕 צליל')
  expect(visualRtlReading(rowOf(iconLabel('?', 'עזרה', true)))).toBe('? עזרה')
  expect(visualRtlReading(rowOf(iconLabel('🎬', 'דמו', true)))).toBe('🎬 דמו')
  expect(visualRtlReading(rowOf(iconLabel('🎞', 'תנועה', true)))).toBe('🎞 תנועה')
  expect(visualRtlReading(rowOf(iconLabel('🖼', 'תנועה', true)))).toBe('🖼 תנועה')
  // two icons: the reader meets trailing neutrals in reverse, so they are reversed in the string
  expect(iconLabel('🎬 ✕', 'יציאה', true)).toBe('יציאה ✕ 🎬')
  expect(visualRtlReading(rowOf(iconLabel('🎬 ✕', 'יציאה', true)))).toBe('🎬 ✕ יציאה')
  // ...and the icons alone (the narrow form, the word dropped) keep that arrangement for the Hebrew reader: the pair is
  // reversed in the string, the 🎬 at the right edge as in the worded label; a single icon is itself
  expect(iconLabel('🎬 ✕', '', true)).toBe('✕ 🎬')
  expect(visualRtlReading(rowOf(iconLabel('🎬 ✕', '', true)))).toBe('🎬 ✕')
  expect(iconLabel('🎬 ✕', '', false)).toBe('🎬 ✕')
  expect(iconLabel('🎬', '', true)).toBe('🎬')
  // every other label the office words with a mark reads icon-then-word the same way: the drawer's close, the glass of the
  // search, the empty office's demo Button, the failed chip (the same derivation as the toolbar's)
  expect(visualRtlReading(rowOf(iconLabel('✕', 'סגירה', true)))).toBe('✕ סגירה')
  expect(visualRtlReading(rowOf(iconLabel('🔍', 'חיפוש סוכנים', true)))).toBe('🔍 חיפוש סוכנים')
  expect(visualRtlReading(rowOf(iconLabel('▶', 'צפו בדמו חי', true)))).toBe('▶ צפו בדמו חי')
  expect(visualRtlReading(rowOf(iconLabel('❌', 'נכשל', true)))).toBe('❌ נכשל')
  // a cut word carries its ellipsis first (ellipsisFirst), the icon still trailing: the reader meets the glass, the word, then the …
  // (a leading neutral lands at the left of the mirrored block — after the word — as a token of its own; python-bidi: '…כוס שופיח 🔍')
  expect(cut('חיפוש סוכנים', 10)).toBe('חיפוש סוכ…')
  expect(visualRtlReading(rowOf(iconLabel('🔍', ellipsisFirst(cut('חיפוש סוכנים', 10)), true)))).toBe('🔍 חיפוש סוכ …')
  expect(visualRtlReading(rowOf(iconLabel('🔍', cut('חיפוש סוכנים', 10), true)))).toBe('🔍 … חיפוש סוכ')   // ...without ellipsisFirst the … would be met before the word
  // why: the leading icon of the text cards' rule (`✕ סגירה`) lands at the left — AFTER the word for the reader
  expect(visualRtlReading(rowOf('☐ שסיימו'))).toBe('שסיימו ☐')
  expect(visualRtlReading(rowOf('🎬 ✕ יציאה'))).toBe('יציאה ✕ 🎬')
  expect(visualRtlReading(rowOf('✕ סגירה'))).toBe('סגירה ✕')
  expect(visualRtlReading(rowOf('🔍 חיפוש סוכנים'))).toBe('חיפוש סוכנים 🔍')
  expect(visualRtlReading(rowOf('▶ צפו בדמו חי'))).toBe('צפו בדמו חי ▶')
  // a Latin word in the Hebrew pane (`🌐 English`) is read left to right: the icon leads; so is every word in the English pane,
  // the one Hebrew word among them too (`🌐 עברית`: an English reader scans left to right)
  expect(iconLabel('🌐', 'English', true)).toBe('🌐 English')
  expect(iconLabel('☐', 'Finished', false)).toBe('☐ Finished')
  expect(iconLabel('🎬 ✕', 'Exit', false)).toBe('🎬 ✕ Exit')
  expect(iconLabel('🌐', 'עברית', false)).toBe('🌐 עברית')
  // the word alone obeys THE HEBREW RULE (i18n.test.ts walks the labels); the label holds one Hebrew run, so a row of it is merge-safe
  for (const w of ['שסיימו', 'צליל', 'עזרה', 'דמו', 'תנועה', 'יציאה']) { expect(hebrewRuleOk(w)).toBe(true); expect(mergeSafe(rowOf(iconLabel('☐', w, true)))).toBe(true) }
  expect(iconLabel('', 'שסיימו', true)).toBe('שסיימו')
  expect(iconLabel('☐', '', true)).toBe('☐')
})

test('the time field: a working agent\'s row ends in a labelled clock the reader reads as clock then number — `⏱️ 3′` in Hebrew (from the right), `⏱️ 3 min` in English — a finished agent carries its badges alone; the field is drawn whole or dropped, before the activity word', () => {
  const cast = [
    ag('lead', 0, { name: 'המנהל', act: '🤔 חושב', startMin: 3 }),
    ag('a1', 1, { emoji: '🦆', name: 'הברווז', act: '📖 קורא', startMin: 0, status: 'stale' }),
    ag('a2', 2, { name: 'גמור', act: '✅ סיים', startMin: 12, status: 'done', star: 1, failed: true, longRunning: true }),
  ]
  // (a) RTL, 40 columns: the reader sees the row from the right — the emoji, the name, the model, the activity, then the clock and the minutes
  const lay = layoutOffice(props({ rtl: true, columns: 40, rooms: [room({ showDone: true, agents: cast })] }))
  const [, r0, r1, r2] = lay.rows
  expect(visualRtlReading(r0!)).toBe('🦉 המנהל Opus 🤔 חושב ⏱️ 3′')
  expect(visualRtlReading(r1!)).toBe('🦆 הברווז Opus 📖 קורא ⏱️ <1′')
  // (b) a finished agent: its badges, no clock, no digit anywhere on the row
  expect(visualRtlReading(r2!)).toBe('🦉 גמור Opus ✅ ❌⭐⏰')
  expect(text(r2!)).not.toContain('⏱')
  expect(text(r2!)).not.toMatch(DIGIT)
  for (const row of [r0!, r1!, r2!]) { expect(row.cells).toHaveLength(40); expect(mergeSafe(row)).toBe(true); expect(wellFormed(row)).toBe(true); for (const run of hebrewRuns(row)) expect(runOk(run, true)).toBe(true) }
  // (c) English, LTR: `⏱️ 3 min` at the row's end, after the badges
  const enCast = cast.map((a, i) => ({ ...a, name: ['Manager', 'Duck', 'Done'][i]!, act: ['🤔 Thinking', '📖 Reading', '✅ Done'][i]! }))
  const en = layoutOffice(props({ lang: 'en', rtl: false, columns: 40, rooms: [room({ showDone: true, agents: enCast })] }))
  expect(text(en.rows[1]!).trimEnd().endsWith('⏱️ 3 min')).toBe(true)
  expect(text(en.rows[2]!).trimEnd().endsWith('⏱️ <1 min')).toBe(true)
  expect(text(en.rows[3]!).trimEnd().endsWith('❌⭐⏰')).toBe(true)
  expect(text(en.rows[3]!)).not.toContain('⏱')
  expect(text(en.rows[3]!)).not.toMatch(DIGIT)
  expect(en.rows.every(row => row.cells.length === 40 && wellFormed(row))).toBe(true)
  // tailText: the badges and the time, the time outermost (first in RTL, last in LTR), a space between the two
  expect(tailText(cast[2]!, true, 'he')).toBe('❌⭐⏰')
  expect(tailText(cast[2]!, false, 'en')).toBe('❌⭐⏰')
  expect(tailText({ ...cast[0]!, failed: true }, true, 'he')).toBe('3′ ⏱️ ❌')
  expect(tailText({ ...cast[0]!, failed: true }, false, 'en')).toBe('❌ ⏱️ 3 min')
  expect(tailText(cast[0]!, true, 'he')).toBe('3′ ⏱️')
  expect(tailText(cast[1]!, false, 'en')).toBe('⏱️ <1 min')
  expect(tailText({ ...cast[0]!, startMin: null }, true, 'he')).toBe('')
  // (d) at every width 24..200 the field is drawn whole or not at all, and it goes before the activity word: with the clock
  // drawn the word is whole, unless the word would not fit even without the clock (then the clock may use the room the emoji leaves)
  for (const [lang, rtl, lead, other] of [
    ['he', true, ag('lead', 1, { name: 'שם בינוני', model: 'Sonnet 5.5', modelFam: 'sonnet', act: '✍️ כותב קובץ ארוך', startMin: 12, failed: true }), ag('a1', 1, { name: 'קצר', act: '📖 קורא', startMin: 3 })],
    ['en', false, ag('lead', 1, { name: 'Medium name', model: 'Sonnet 5.5', modelFam: 'sonnet', act: '✍️ Writing a file', startMin: 12, failed: true }), ag('a1', 1, { name: 'Short', act: '📖 Reading', startMin: 3 })],
  ] as const) {
    const r = room({ agents: [lead, other] })
    const need = ROW_MARGIN + EMOJI_CELLS + 1 + textWidth(lead.name) + 1 + textWidth('Sonnet') + 1 + textWidth(lead.act)
    const timeOnly = rtl ? '12′ ⏱️' : '⏱️ 12′'
    const full = tailText(lead, rtl, lang)
    const bare = '❌'
    const wordFrom = need + 1 + textWidth(bare)      // the word whole without the clock from this width
    const allFrom = need + 1 + textWidth(full)       // everything whole from this width
    expect(full).toBe(rtl ? '12′ ⏱️ ❌' : '❌ ⏱️ 12 min')
    for (let columns = 24; columns <= 200; columns++) {
      const row = layoutOffice(props({ lang, rtl, columns, rooms: [r] })).rows[1]!
      const t = text(row)
      const clock = t.includes('⏱')
      const word = t.includes(lang === 'he' ? 'כותב קובץ ארוך' : 'Writing a file')
      const at = `${lang} ${columns}`
      if (clock) expect(t, at).toContain(lang === 'he' ? timeOnly : '⏱️ 12 min')   // whole, never cut
      expect(t, at).not.toContain('…⏱')
      if (clock) expect(word || columns < wordFrom, at).toBe(true)
      if (columns >= allFrom) { expect(clock, at).toBe(true); expect(word, at).toBe(true) }
      if (columns >= wordFrom && columns < allFrom) { expect(word, at).toBe(true); expect(clock, at).toBe(false) }
      expect(mergeSafe(row), at).toBe(true)
      expect(wellFormed(row), at).toBe(true)
    }
  }
})

test('widths: at every width 24..200 the row shrinks in order — the time away whole, the activity to its emoji alone (never a cut word), the name to NAME_MIN, the activity away, the name to a glyph, the model away, the time back once the shrunk row leaves it room; the version only from MODEL_FULL_FROM; wider panes cap the gap before the tail', () => {
  const cast = (model: string, modelFam: OfficeAgent['modelFam']) => room({ agents: [ag('lead', 1, { name: 'שם בינוני', model, modelFam, act: '✍️ כותב קובץ ארוך', startMin: 12, failed: true }), ag('a1', 1, { name: 'קצר', act: '📖 קורא', startMin: 3 })] })
  const sonnet = cast('Sonnet 5.5', 'sonnet')
  const opus = cast('Opus 5.5', 'opus')
  const have = (columns: number, rtl: boolean, r = sonnet) => {
    const row = layoutOffice(props({ columns, rtl, rooms: [r] })).rows[1]!
    const runs = rowRuns(row.cells).map(x => x.text)
    const pill = runs.find(x => /^(Sonnet|Opus)/.test(x)) ?? ''
    return { row, runs, pill, word: runs.some(x => /^כותב קובץ ארוך$/.test(x)), emoji: runs.some(x => x === '✍️'), name: runs.find(x => /^…?שם/.test(x)) ?? '', time: runs.some(x => x.includes('⏱')) }
  }
  for (const rtl of [true, false]) {
    // roomy: every field whole, the model with its version, the tail GAP_MAX past the activity, the rest blank
    const wide = have(120, rtl)
    expect(wide.pill).toBe('Sonnet 5.5')
    expect(wide.word).toBe(true)
    expect(wide.emoji).toBe(true)
    expect(wide.name).toBe('שם בינוני')
    expect(wide.time).toBe(rtl)   // (LTR under this fixture's Hebrew activity: THE HEBREW RULE (5) drops the time on the row)
    expect(text(wide.row).trim()).toBe(text(have(200, rtl).row).trim())
    expect(text(wide.row).trim().length).toBeLessThan(80)
    expect(have(60, rtl).pill).toBe('Sonnet 5.5')
    // 59: the family word alone, the activity whole, the time (48 and up); 47..41: the word whole, the time gone (it goes first);
    // 40..33: the activity's emoji alone and the time back in the room the word left; 32..26: the emoji, no time; 25, 24: the name cut
    expect(have(59, rtl).pill).toBe('Sonnet')
    expect(have(59, rtl).word).toBe(true)
    expect(have(48, rtl).word).toBe(true)
    expect(have(48, rtl).time).toBe(rtl)
    expect(have(47, rtl).word).toBe(true)
    expect(have(47, rtl).time).toBe(false)
    expect(have(41, rtl).word).toBe(true)
    expect(have(41, rtl).name).toBe('שם בינוני')
    expect(have(40, rtl).word).toBe(false)
    expect(have(40, rtl).emoji).toBe(true)
    expect(have(40, rtl).time).toBe(true)
    expect(have(40, rtl).name).toBe('שם בינוני')
    expect(have(33, rtl).time).toBe(true)
    expect(have(32, rtl).time).toBe(false)
    expect(have(32, rtl).emoji).toBe(true)
    expect(have(26, rtl).emoji).toBe(true)
    expect(have(26, rtl).name).toBe('שם בינוני')
    expect(have(25, rtl).emoji).toBe(true)
    expect(have(25, rtl).name).toBe(rtl ? '…שם בינו' : 'שם בינו…')
    expect(have(25, rtl).pill).toBe('Sonnet')
    expect(have(24, rtl).emoji).toBe(true)
    expect(have(24, rtl).name).toBe(rtl ? '…שם בינ' : 'שם בינ…')
    expect(have(24, rtl, opus).pill).toBe('Opus')
  }
  // the whole sweep: exact width, whole glyphs, the model word whole or none, the activity whole or its emoji (never a cut word), the
  // time whole or none, nothing the engine would merge
  for (let columns = 24; columns <= 200; columns++) {
    for (const rtl of [true, false]) {
      for (const r of [sonnet, opus]) {
        const { row, runs } = have(columns, rtl, r)
        expect(row.cells, `${columns}`).toHaveLength(columns)
        expect(wellFormed(row), `${columns}`).toBe(true)
        expect(runs.filter(x => /Sonnet|Opus|S…|O…/.test(x)).every(x => ['Sonnet 5.5', 'Sonnet', 'Opus 5.5', 'Opus'].includes(x)), `${columns}: ${runs.join('|')}`).toBe(true)
        expect(runs.some(x => /כ/.test(x) && x !== 'כותב קובץ ארוך'), `${columns}: ${runs.join('|')}`).toBe(false)
        // (the time whole — one dim run with the badge — or none; from 48 columns always, but in LTR under a drawn Hebrew activity
        // — this fixture's, never the English UI's — THE HEBREW RULE (5) drops it on the row)
        if (runs.some(x => x.includes('⏱'))) expect(runs.some(x => x === (rtl ? '12′ ⏱️ ❌' : '❌ ⏱️ 12′')), `${columns}: ${runs.join('|')}`).toBe(true)
        if (columns >= 48 && (rtl || !runs.some(x => /כ/.test(x)))) expect(runs.some(x => x.includes('12′')), `${columns}`).toBe(true)
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
  expect(cut('✍️ כותב קובץ ארוך', ACT_MAX)).toBe('✍️ כותב קובץ ארוך')   // (17 cells: whole under ACT_MAX)
  expect(cut('🔎 Searching code and more', ACT_MAX)).toBe('🔎 Searching code…')
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
  expect(layoutOffice(ltr, decor({ hover: 'ghost', hoverRoom: 'ghost', hop: ['ghost'], entering: [['ghost', 0]] }))).toEqual(plain)
})

test('decor: a narrow row leaves the emoji less room — the hop and the walk-in stop before the pill, never over it', () => {
  const r = room({ agents: [ag('x', 1, { name: 'א', startMin: 100, failed: true, longRunning: true })] })
  for (const rtl of [true, false]) {
    for (const columns of [24, 26, 28, 36]) {
      const p = props({ rtl, columns, rooms: [r] })
      const plain = layoutOffice(p).rows[1]!
      const lay = layoutOffice(p, decor({ hop: ['x'], entering: [['x', 0]] })).rows[1]!
      expect(wellFormed(lay)).toBe(true)
      expect(lay.cells).toHaveLength(columns)
      expect(text(lay)).toContain('⭐🦉')
      // the model word and the tail sit in the cells they sat in
      const col = (r: Cells, ch: string) => r.cells.findIndex(c => c.ch === ch)
      expect(col(lay, 'O')).toBe(col(plain, 'O'))
      expect(col(lay, '′')).toBe(col(plain, '′'))
      expect(col(lay, '⏰')).toBe(col(plain, '⏰'))
      expect(col(lay, '⏰')).toBeGreaterThanOrEqual(0)
      // (the time `100′ ⏱️` needs 31 columns beside the activity word; LTR under a cut Hebrew activity drops it: THE HEBREW RULE (5))
      expect(col(lay, '′') >= 0).toBe(rtl && columns >= 31)
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
