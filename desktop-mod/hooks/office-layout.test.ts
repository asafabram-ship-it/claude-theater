// office-layout.ts: the pure view model of the desktop office. No engine, no
// `$`: the geometry of the reading column, the office-wide table mode and its
// hysteresis, the cards' rows (every cell's text and the flags that weight
// it), the line map (the y of every drawn line), the hit rectangles and the
// text helpers are asserted on the data.

import { expect, test } from 'claude-code/testing'

import { hebrewRuleOk } from './i18n'
import { ACT_MAX, CARD_LINES, CENTRE_AT, DOT_FG, EMOJI_CELLS, FIT, FOCUS_MARK, HYSTERESIS, LINE_FIT, MODEL_FULL_FROM, MORE_LINES, NAME_FLOOR, NAME_MAX, NAME_MIN, NBSP, NO_DECOR, ONE_LINE_FROM, TASK_MAX, TITLE_GAP, TITLE_MIN, WIDE_FROM, cardLines, chooseMode, countsFor, countsText, countsZone, cut, cutTitle, cutWords, firstGlyph, fitCells, fitLine, floorsOf, geometry, glyphs, hitAt, iconLabel, markOf, modeAt, modelText, nb, needOf, officeModel, officeWidest, pinZone, restWord, roomCache, rowCount, textWidth, trimWindow, widestName } from './office-layout'
import type { Line, OfficeDecor, OfficeModel, TableMode } from './office-layout'
import type { OfficeAgent, OfficeProps, OfficeRoom } from './office-props'

function ag(id: string, i: number, over: Partial<OfficeAgent> = {}): OfficeAgent {
  return { id, emoji: '🦉', name: `סוכן ${i}`, status: 'running', act: '📖 קורא', model: 'Opus 5.5', task: `משימה ${i}`, failed: false, longRunning: false, star: 0, ...over }
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
    agents: Array.from({ length: 10 }, (_, i) => ag(`a${r}-${i}`, i)),
  }))
}

/**
 * The probe's office (round 9, the widest values of its three rooms): a ⭐ mark, an 8-cell name (הקרטוגרף), `Sonnet 4.5`, the
 * activity `🔎 מחפש קוד` — so the ladder's thresholds are the ones Asaf saw: the word from 51 (regained at 54), the model
 * column from 39 (regained at 42), the version from MODEL_FULL_FROM.
 */
function probeRooms(): OfficeRoom[] {
  return [
    room({ id: 'theater', title: 'תיאטרון הסוכנים', run: 3, stale: 1, done: 4, agents: [
      ag('owl', 0, { name: 'הינשוף', act: '🤔 חושב' }), ag('doc', 1, { name: 'הרופא', model: 'Sonnet 4.5', act: '✏️ עורך' }),
      ag('wolf', 2, { name: 'הזאב', model: 'Haiku 4.5', status: 'stale', act: '💤 ממתין' }), ag('mech', 3, { name: 'המכונאי', status: 'done', star: 7, act: '✅ סיים' }),
      ag('painter', 4, { name: 'הצייר', model: 'Sonnet 4.5', status: 'done', failed: true, act: '⛔ נכשל' }),
    ] }),
    room({ id: 'plan', title: 'Plan the static-registry move and the v2 config rollout', run: 1, done: 1, agents: [ag('writer', 5, { name: 'הסופר', model: 'Fable 5.1' }), ag('carto', 6, { name: 'הקרטוגרף', model: 'Fable 5.1', status: 'done', act: '✅ סיים' })] }),
    room({ id: 'test', title: 'בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', run: 3, agents: [ag('dolphin', 7, { name: 'הדולפין', model: 'Haiku 4.5', act: '🔎 מחפש קוד' }), ag('turtle', 8, { name: 'הצב', model: 'Sonnet 4.5', longRunning: true, act: '🧪 בודק' })] }),
  ]
}

function decor(over: Partial<{ hoverRoom: string | null; focus: string | null; pulse: string[] }> = {}): OfficeDecor {
  return { hoverRoom: over.hoverRoom ?? null, focus: over.focus ?? null, pulse: new Set(over.pulse ?? []) }
}

const LONE_SURROGATE = /\p{Cs}/u
const kinds = (lines: readonly Line[]) => lines.map(l => l.kind)
/** The texts of a row as the Client lays them in the mode's columns: status · who · [model] · emoji · [word] · [task from CENTRE_AT]. */
const cellsOf = (m: OfficeModel, r: { status: string; who: string; model: string; actEmoji: string; actWord: string; task: string }): string[] =>
  [r.status, r.who, ...(m.mode.model !== 'none' ? [r.model] : []), r.actEmoji, ...(m.mode.word ? [r.actWord] : []), ...(m.geo.centred ? [r.task] : [])]

test('glyphs / textWidth: an emoji takes EMOJI_CELLS; a variation selector, a ZWJ sequence, a skin tone and Hebrew points stay with their glyph (zero width)', () => {
  expect(glyphs('🦉x').map(g => [g.ch, g.w])).toEqual([['🦉', 2], ['x', 1]])
  expect(glyphs('✏️x').map(g => g.ch)).toEqual(['✏️', 'x'])                 // U+270F + U+FE0F: one 2-cell glyph
  expect(glyphs('👨‍💻y').map(g => g.ch)).toEqual(['👨‍💻', 'y'])             // man + ZWJ + laptop: one glyph
  expect(glyphs('👍🏽z').map(g => [g.ch, g.w])).toEqual([['👍🏽', 2], ['z', 1]])
  expect(glyphs('שָׁל').map(g => g.ch)).toEqual(['שָׁ', 'ל'])                 // shin + qamats + shin dot, then lamed
  expect(textWidth('🦉 הינשוף')).toBe(2 + 1 + 6)
  expect(textWidth('🟢3 ⏳1 ✅2')).toBe(3 + 1 + 3 + 1 + 3)
  expect(textWidth('')).toBe(0)
})

test('cut: at most `max` cells, whole glyphs, an ellipsis when something was dropped; never half an emoji', () => {
  expect(cut('abcdef', 10)).toBe('abcdef')
  expect(cut('abcdef', 4)).toBe('abc…')
  expect(cut('abcdef', 0)).toBe('')
  expect(cut('🦉'.repeat(15), NAME_MAX)).toBe('🦉'.repeat(11) + '…')
  expect(cut('✍️ כותב קובץ ארוך', ACT_MAX)).toBe('✍️ כותב קובץ ארוך')   // (17 cells: whole under ACT_MAX)
  expect(cut('🔎 Searching code and more', ACT_MAX)).toBe('🔎 Searching code…')
  for (const n of [1, 2, 3, 5, 8]) expect(cut('🦉🦉🦉🦉', n)).not.toMatch(LONE_SURROGATE)
})

test('cutWords (the probe\'s title cut): a title that fits is whole; a longer one is cut on a word past the middle, the ellipsis trailing; a title of one long word is cut mid-word', () => {
  expect(cutWords('Plan the static-registry move and the v2 config rollout', 60)).toBe('Plan the static-registry move and the v2 config rollout')
  expect(cutWords('Plan the static-registry move and the v2 config rollout', 23)).toBe('Plan the static-regist…')   // (the one space lies before the middle: cut mid-word, a cell kept for the …)
  expect(cutWords('Plan the static-registry move and the v2 config rollout', 30)).toBe('Plan the static-registry move…')
  expect(cutWords('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', 23)).toBe('בדיקת תיאטרון הסוכנים…')
  expect(cutWords('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefghi…')
  expect(cutWords('ab cdefghijklmnopqrstuvwxyz', 10)).toBe('ab cdefgh…')   // the one space lies before the middle: cut mid-word
  // the ellipsis trails: the desktop lays a Hebrew-first Text right-to-left, so a trailing … is read last, as the probe showed
  expect(cutWords('תקרא את המסמך הארוך מאוד', 12).endsWith('…')).toBe(true)
  expect(cutWords('תקרא את המסמך הארוך מאוד', 12).startsWith('…')).toBe(false)
})

test('nb / NBSP (round 9): every plain space of a one-line value a no-break space, the width unchanged — a Text drawn from it can never wrap; restWord: an activity\'s word after its emoji', () => {
  expect(NBSP).toBe(' ')
  expect(nb('🦉 הינשוף')).toBe(`🦉${NBSP}הינשוף`)
  expect(nb('a b  c')).toBe(`a${NBSP}b${NBSP}${NBSP}c`)
  expect(nb('')).toBe('')
  expect(nb('x')).toBe('x')
  expect(nb('▸ עוד 2 שסיימו')).not.toContain(' ')
  expect(textWidth(nb('🟢3 ⏳1 ✅2'))).toBe(textWidth('🟢3 ⏳1 ✅2'))
  expect(nb(nb('a b'))).toBe(nb('a b'))
  // THE HEBREW RULE holds on the no-break form as on the plain one (trimEnd drops a no-break space as it drops a space)
  expect(hebrewRuleOk(nb('עוד 2 שסיימו'))).toBe(true)
  expect(restWord('🤔 חושב')).toBe('חושב')
  expect(restWord('🔎 מחפש קוד')).toBe('מחפש קוד')
  expect(restWord('✏️ עורך')).toBe('עורך')
  expect(restWord('🔎')).toBe('')
  expect(restWord('')).toBe('')
})

test('geometry (probe rounds 8-9): ONE reading column — the pane up to 99 cells, frozen at CENTRE_AT and centred by a left margin from 100; the card\'s padding 2 from WIDE_FROM (the inner width dips by a cell there); the structure flags at their thresholds; the table\'s budget by FIT, the chrome line by LINE_FIT', () => {
  expect([MODEL_FULL_FROM, ONE_LINE_FROM, WIDE_FROM, CENTRE_AT, TITLE_MIN, HYSTERESIS, NAME_MIN, NAME_FLOOR, TASK_MAX]).toEqual([60, 64, 80, 100, 16, 2, 8, 3, 24])
  expect(geometry(45)).toEqual({ columns: 45, W: 45, px: 1, frame: 4, inner: 41, budget: 30, L: 37, oneLine: false, full: false, wide: false, centred: false, margin: 0 })
  expect(geometry(51)).toMatchObject({ W: 51, px: 1, frame: 4, inner: 47, budget: 35, L: 42 })   // the probe's width: round 6 fit four columns of 32 cells in 47
  expect(geometry(59)).toMatchObject({ full: false })
  expect(geometry(60)).toMatchObject({ full: true, oneLine: false })
  expect(geometry(63)).toMatchObject({ oneLine: false })
  expect(geometry(64)).toMatchObject({ oneLine: true, wide: false })
  expect(geometry(79)).toMatchObject({ px: 1, frame: 4, inner: 75, wide: false })
  expect(geometry(80)).toMatchObject({ px: 2, frame: 6, inner: 74, wide: true, centred: false, margin: 0 })
  expect(geometry(99)).toMatchObject({ W: 99, inner: 93, centred: false, margin: 0 })
  expect(geometry(100)).toMatchObject({ W: 100, inner: 94, budget: 70, L: 83, centred: true, margin: 0 })
  expect(geometry(101)).toMatchObject({ W: 100, margin: 0 })
  expect(geometry(102)).toMatchObject({ W: 100, margin: 1 })
  expect(geometry(200)).toMatchObject({ W: 100, inner: 94, budget: 70, L: 83, oneLine: true, full: true, wide: true, centred: true, margin: 50 })
  for (let c = 24; c <= 200; c++) {
    const g = geometry(c)
    expect(g.W, `${c}`).toBe(Math.min(c, CENTRE_AT))
    expect(g.frame, `${c}`).toBe(2 + 2 * g.px)
    expect(g.inner, `${c}`).toBe(g.W - g.frame)
    expect(g.budget, `${c}`).toBe(fitCells(g.inner))
    expect(g.L, `${c}`).toBe(fitLine(g.W))
    expect([g.oneLine, g.full, g.wide, g.centred], `${c}`).toEqual([g.W >= ONE_LINE_FROM, g.W >= MODEL_FULL_FROM, g.W >= WIDE_FROM, c >= CENTRE_AT])
    // the column centred: the margins differ by a cell at most, the column inside the pane
    expect(g.margin, `${c}`).toBe(c >= CENTRE_AT ? Math.floor((c - CENTRE_AT) / 2) : 0)
    expect(g.margin + g.W, `${c}`).toBeLessThanOrEqual(c)
    expect(c - g.W - 2 * g.margin, `${c}`).toBeLessThanOrEqual(1)
  }
  // a pane narrower than the floor never throws and keeps its numbers sane
  for (const c of [1, 4, 8, 12, 23]) { const g = geometry(c); expect(g.budget).toBeGreaterThanOrEqual(0); expect(g.L).toBeGreaterThanOrEqual(0) }
})

test('fitCells / FIT: the share of a width the desktop draws text into (letters wider than a cell); countsFor shrinks the counts (✅ goes, then ⏳) before the title keeps under TITLE_MIN fit cells; cutTitle cuts by LINE_FIT beside the counts (and the 📌 when pinned), never under 8', () => {
  expect(FIT).toBe(0.75)
  expect(LINE_FIT).toBe(0.83)
  expect(fitCells(47)).toBe(35)   // the probe's round 6: four columns of 32 cells fit the 47 inner cells of a 51-column pane, five of 39 did not
  expect(fitCells(10)).toBe(7)
  expect(fitCells(0)).toBe(0)
  expect(fitCells(-5)).toBe(0)
  expect(fitLine(51)).toBe(42)    // the probe's round 7: the header's 33 cells of counts, a gap and 8 of meter fit 51 columns
  expect(fitLine(0)).toBe(0)
  const r = { run: 3, stale: 1, done: 2 }
  const counts = '🟢3 ⏳1 ✅2'
  // the counts whole while the title keeps TITLE_MIN cells by FIT: 45 columns leave 41 - 2 - 11 - 2 = 26 → 19; at 40, 36 - 15 = 21 →
  // 15: the ✅ goes (36 - 11 = 25 → 18); at 36, 32 - 11 = 21 → 15: the ⏳ too (32 - 7 = 25 → 18); pinned, four cells fewer
  expect(countsFor(r, geometry(51))).toBe(counts)
  expect(countsFor(r, geometry(45))).toBe(counts)
  expect(countsFor(r, geometry(45), true)).toBe(counts)
  expect(countsFor(r, geometry(44), true)).toBe('🟢3 ⏳1')
  expect(countsFor(r, geometry(40))).toBe('🟢3 ⏳1')
  expect(countsFor(r, geometry(36))).toBe('🟢3')
  expect(countsFor(r, geometry(24))).toBe('🟢3')
  expect(countsFor({ run: 0, stale: 0, done: 4 }, geometry(51))).toBe('🟢0 ✅4')
  expect(countsFor({ run: 2, stale: 0, done: 0 }, geometry(24))).toBe('🟢2')
  for (let c = 24; c <= 200; c++) {
    const g = geometry(c)
    const cf = countsFor(r, g)
    expect([counts, '🟢3 ⏳1', '🟢3'], `${c}`).toContain(cf)
    // the first form that leaves the title TITLE_MIN cells, else the shortest; a wider pane never shows less
    if (cf !== '🟢3') expect(fitCells(g.inner - 2 - textWidth(cf) - TITLE_GAP), `${c}`).toBeGreaterThanOrEqual(TITLE_MIN)
    if (c > 24) expect(textWidth(cf), `${c}`).toBeGreaterThanOrEqual(textWidth(countsFor(r, geometry(c - 1))) - (c === WIDE_FROM ? 8 : 0))
  }
  // the probe's gap of two between the title and the counts, the title flush at the reading edge (no pin drawn): 51 columns
  // leave 47 - 2 (the title's padding) - 11 (counts) - 2 (gap) = 32 → 26 cells by LINE_FIT, and the probe's third room reads
  // `בדיקת תיאטרון הסוכנים…` as it did on the desktop (round 9); pinned, the 📌 and its gap take 4 more cells (28 → 23)
  expect(TITLE_GAP).toBe(2)
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', geometry(51), counts)).toBe('בדיקת תיאטרון הסוכנים…')
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', geometry(51), counts, true)).toBe('בדיקת תיאטרון הסוכנים…')
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', geometry(44), counts, true)).toBe('בדיקת תיאטרון…')
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', geometry(36), counts)).toBe('בדיקת תיאטרון…')
  expect(cutTitle('תיאטרון הסוכנים', geometry(51), counts)).toBe('תיאטרון הסוכנים')
  expect(cutTitle('abcdefghijklmnopqrstuvwxyz', geometry(24), counts)).toBe('abcdefg…')   // the floor of 8
  // the sweep: a title one cell longer than the widest room of the sweep (the frozen column, unpinned: 94 - 15 = 79 → 65 cells), so
  // every cut drops something and carries the …; each (columns, pinned) cut once, its width reused for the pinned-vs-unpinned check
  const countsWidth = textWidth(counts)
  const long = 'x'.repeat(fitLine(geometry(200).inner - 2 - countsWidth - TITLE_GAP) + 1)
  for (let columns = 24; columns <= 200; columns++) {
    const g = geometry(columns)
    const widths = [false, true].map(pinned => {
      const t = cutTitle(long, g, counts, pinned)
      const w = textWidth(t)
      expect(w, `${columns}${pinned ? ' pinned' : ''}: ${t}`).toBeLessThanOrEqual(Math.max(8, fitLine(g.inner - 2 - (pinned ? EMOJI_CELLS + TITLE_GAP : 0) - countsWidth - TITLE_GAP)))
      expect(t.endsWith('…'), `${columns}${pinned ? ' pinned' : ''}: ${t}`).toBe(true)
      return w
    })
    // a pinned title is never longer than the unpinned one
    expect(widths[1], `${columns}`).toBeLessThanOrEqual(widths[0]!)
  }
  // the pin zone (drawn or not): the border, the padding, the title's own padding, the glyph and its gap — a cell more from WIDE_FROM
  expect(pinZone(geometry(51))).toBe(7)
  expect(pinZone(geometry(80))).toBe(8)
  // the counts' zone (the room's ✅ toggle), from the far edge: the border and the paddings, then the counts as the desktop draws
  // them — wider than their cells, by FIT (11 cells → 15) — never into the pin zone
  expect(countsZone(counts, geometry(51))).toBe(3 + Math.ceil(11 / FIT))
  expect(countsZone(counts, geometry(51))).toBe(18)
  expect(countsZone(counts, geometry(80))).toBe(19)
  expect(countsZone('🟢2', geometry(51))).toBe(3 + Math.ceil(3 / FIT))
  expect(countsZone(counts, geometry(20))).toBe(20 - pinZone(geometry(20)))
  expect(countsZone(counts, geometry(8))).toBe(1)
})

test('iconLabel: a labelled control reads icon-then-word as the probe writes it — the icon TRAILS a Hebrew word in the string (`הצג שסיימו ☐`, `צליל 🔔`, `הגדרות ⚙️`), two icons reversed, the icons alone keeping that arrangement; any other word takes the icon first', () => {
  expect(iconLabel('☐', 'הצג שסיימו', true)).toBe('הצג שסיימו ☐')
  expect(iconLabel('☑', 'הצג שסיימו', true)).toBe('הצג שסיימו ☑')
  expect(iconLabel('🔔', 'צליל', true)).toBe('צליל 🔔')
  expect(iconLabel('⚙️', 'הגדרות', true)).toBe('הגדרות ⚙️')
  expect(iconLabel('🎬', 'דמו', true)).toBe('דמו 🎬')
  expect(iconLabel('🎬 ✕', 'יציאה', true)).toBe('יציאה ✕ 🎬')
  expect(iconLabel('🎬 ✕', '', true)).toBe('✕ 🎬')
  expect(iconLabel('🎬 ✕', '', false)).toBe('🎬 ✕')
  expect(iconLabel('🎬', '', true)).toBe('🎬')
  expect(iconLabel('✕', 'סגירה', true)).toBe('סגירה ✕')
  expect(iconLabel('🔍', 'חיפוש סוכנים', true)).toBe('חיפוש סוכנים 🔍')
  expect(iconLabel('▶', 'צפו בדמו חי', true)).toBe('צפו בדמו חי ▶')
  expect(iconLabel('❌', 'נכשל', true)).toBe('נכשל ❌')
  expect(iconLabel('🌐', 'English', true)).toBe('🌐 English')
  expect(iconLabel('☐', 'Show finished', false)).toBe('☐ Show finished')
  expect(iconLabel('🎬 ✕', 'Exit', false)).toBe('🎬 ✕ Exit')
  expect(iconLabel('🌐', 'עברית', false)).toBe('🌐 עברית')
  expect(iconLabel('', 'שסיימו', true)).toBe('שסיימו')
  expect(iconLabel('☐', '', true)).toBe('☐')
  // the word alone obeys THE HEBREW RULE (i18n.test.ts walks the labels)
  for (const w of ['הצג שסיימו', 'צליל', 'הגדרות', 'דמו', 'תנועה', 'יציאה']) expect(hebrewRuleOk(w)).toBe(true)
})

test('modelText / firstGlyph / countsText / markOf: the family word (the version only when `full`), an activity\'s emoji, the room\'s counts, the status mark with its badges', () => {
  expect(modelText('Opus 5.5')).toBe('Opus')
  expect(modelText('Opus 5.5', true)).toBe('Opus 5.5')
  expect(modelText('')).toBe('?')
  expect(modelText('x'.repeat(30), true)).toBe('x'.repeat(11) + '…')
  expect(firstGlyph('📖 קורא')).toBe('📖')
  expect(firstGlyph('✏️ עורך')).toBe('✏️')
  expect(firstGlyph('')).toBe('')
  expect(countsText({ run: 3, stale: 1, done: 2 })).toBe('🟢3 ⏳1 ✅2')
  expect(countsText({ run: 1, stale: 0, done: 0 })).toBe('🟢1')
  expect(countsText({ run: 0, stale: 0, done: 4 })).toBe('🟢0 ✅4')
  // the badges ride the status column, ⭐ first, then ❌, then ⏰; else ● for a working or waiting agent, ○ for a finished one
  const a = ag('a', 1)
  expect(markOf(a)).toBe('●')
  expect(markOf({ ...a, status: 'stale' })).toBe('●')
  expect(markOf({ ...a, status: 'done' })).toBe('○')
  expect(markOf({ ...a, status: 'done', star: 7 })).toBe('⭐')
  expect(markOf({ ...a, status: 'done', failed: true })).toBe('❌')
  expect(markOf({ ...a, longRunning: true })).toBe('⏰')
  expect(markOf({ ...a, status: 'done', star: 7, failed: true, longRunning: true })).toBe('⭐')
  expect(markOf({ ...a, failed: true, longRunning: true })).toBe('❌')
})

test('THE TABLE MODE (probe rounds 8-9): ONE mode for the whole office from the widest values across ALL its rooms — the need per column (a padding cell each, the focus cell on the status), THE LADDER richest first (the word → the version → names to NAME_MIN → the model column → names to the floor), the probe\'s thresholds at the probe\'s widths', () => {
  const w = officeWidest(probeRooms())
  // the widest values: the ⭐ / ❌ / ⏰ marks (2 cells), the names (the 8-cell הקרטוגרף among them), `Sonnet 4.5` / `Sonnet`, the emoji, `מחפש קוד`
  expect(w).toMatchObject({ mark: 2, modelFull: 10, modelFamily: 6, actEmoji: 2, actWord: 8 })
  expect(widestName(w, NAME_MAX)).toBe(8)
  expect(widestName(w, 5)).toBe(5)
  expect(widestName(w, NAME_MIN)).toBe(8)
  expect(w.names).toContain('הקרטוגרף')
  // the need: status 2 + 1 + 1, who 2 + 1 + 8 + 1, the model and the activity's two columns, a padding cell each
  expect(needOf(w, true, 'family', NAME_MAX)).toEqual({ status: 4, who: 12, model: 7, actEmoji: 3, actWord: 9, total: 35 })
  expect(needOf(w, true, 'full', NAME_MAX)).toEqual({ status: 4, who: 12, model: 11, actEmoji: 3, actWord: 9, total: 39 })
  expect(needOf(w, false, 'family', NAME_MAX).total).toBe(26)
  expect(needOf(w, false, 'none', NAME_MAX).total).toBe(19)
  expect(needOf(w, false, 'none', 5).total).toBe(16)
  // the ladder at a budget, the version riding (`full`): the richest rank that fits
  const at = (budget: number, full: boolean): TableMode | null => { for (let r = 0; r < 5; r++) { const m = modeAt(w, r, budget, full); if (m) return m } return modeAt(w, 5, budget, full) }
  expect(at(35, false)).toEqual({ rank: 0, word: true, model: 'family', nameMax: NAME_MAX })
  expect(at(34, false)).toEqual({ rank: 1, word: false, model: 'family', nameMax: NAME_MAX })
  expect(at(26, false)).toEqual({ rank: 1, word: false, model: 'family', nameMax: NAME_MAX })
  expect(at(25, false)).toEqual({ rank: 4, word: false, model: 'none', nameMax: NAME_MAX })       // the names cannot shrink under NAME_MIN to keep the column: it goes
  expect(at(19, false)).toEqual({ rank: 4, word: false, model: 'none', nameMax: NAME_MAX })
  expect(at(18, false)).toEqual({ rank: 5, word: false, model: 'none', nameMax: 7 })              // 18 - 4 - 3 - 4 = 7
  expect(at(10, false)).toEqual({ rank: 5, word: false, model: 'none', nameMax: NAME_FLOOR })
  expect(at(0, false)).toEqual({ rank: 5, word: false, model: 'none', nameMax: NAME_FLOOR })
  expect(at(39, true)).toEqual({ rank: 0, word: true, model: 'full', nameMax: NAME_MAX })
  expect(at(38, true)).toEqual({ rank: 1, word: false, model: 'full', nameMax: NAME_MAX })         // the word first (the version stays)
  expect(at(30, true)).toEqual({ rank: 1, word: false, model: 'full', nameMax: NAME_MAX })
  expect(at(29, true)).toEqual({ rank: 2, word: false, model: 'family', nameMax: NAME_MAX })       // then the version
  expect(at(26, true)).toEqual({ rank: 2, word: false, model: 'family', nameMax: NAME_MAX })
  expect(at(25, true)).toEqual({ rank: 4, word: false, model: 'none', nameMax: NAME_MAX })
  // long names shrink (rank 3) before the model column goes: a 24-cell name — status 4 + who 28 + family `Sonnet` 7 + emoji 3 = 42
  const long = officeWidest([room({ agents: [ag('x', 1, { name: 'א'.repeat(24), model: 'Sonnet 4.5', act: '🔎 מחפש קוד', star: 7, status: 'done' })] })])
  expect(modeAt(long, 1, 41, false)).toBeNull()
  expect(modeAt(long, 3, 41, false)).toEqual({ rank: 3, word: false, model: 'family', nameMax: 23 })   // 41 - 4 - 7 - 3 - 4
  expect(modeAt(long, 3, 26, false)).toEqual({ rank: 3, word: false, model: 'family', nameMax: NAME_MIN })
  expect(modeAt(long, 3, 25, false)).toBeNull()
  expect(modeAt(long, 4, 25, false)).toBeNull()                                                       // no model: 4 + 28 + 3 = 35
  expect(modeAt(long, 5, 25, false)).toEqual({ rank: 5, word: false, model: 'none', nameMax: 14 })    // 25 - 4 - 3 - 4
  // at every budget, both version rules: a rank that fits needs no more than the budget; the ranks are ordered — a narrower budget
  // never draws a richer mode — and the names never widen as the budget narrows but at a step of the ladder
  for (const full of [false, true]) {
    let prev = at(200, full)!
    for (let budget = 199; budget >= 0; budget--) {
      const m = at(budget, full)!
      if (m.rank < 5) expect(needOf(w, m.word, m.model, m.nameMax).total, `${budget} ${full}`).toBeLessThanOrEqual(budget)
      expect(m.rank, `${budget} ${full}`).toBeGreaterThanOrEqual(prev.rank)
      expect(m.word && m.model === 'none', `${budget} ${full}: the model gone while the word stays`).toBe(false)
      if (m.rank === prev.rank) expect(m.nameMax, `${budget} ${full}`).toBeLessThanOrEqual(prev.nameMax)
      expect(m.nameMax).toBeGreaterThanOrEqual(NAME_FLOOR)
      expect(m.nameMax).toBeLessThanOrEqual(NAME_MAX)
      prev = m
    }
  }
  // an empty office: the richest mode, nothing to fit
  expect(chooseMode(officeWidest([]), geometry(24), null)).toMatchObject({ rank: 0, word: true, model: 'family', nameMax: NAME_MAX })
})

test('THE HYSTERESIS (chooseMode): narrowing, a mode is dropped the instant it stops fitting — the fresh choice at every width; widening, it is regained only with HYSTERESIS cells to spare — the probe\'s office drops the word at 50 and regains it at 54, drops the model column at 38 and regains it at 42; across every threshold the widening lags the narrowing by two columns at least and catches up within three', () => {
  const w = officeWidest(probeRooms())
  const rank = (c: number, last: number | null) => chooseMode(w, geometry(c), last).rank
  // narrowing from the widest: the rank at every width, each from the last
  const narrowing: number[] = []
  let last: number | null = null
  for (let c = 200; c >= 24; c--) { narrowing[c] = rank(c, last); last = narrowing[c]! }
  // widening from the narrowest
  const widening: number[] = []
  last = null
  for (let c = 24; c <= 200; c++) { widening[c] = rank(c, last); last = widening[c]! }
  // the probe's thresholds: the word at 51 / 54 (need 35: inner 47 → 35; with two to spare 37 → inner 50), the model column at 39 / 42 (need 26 → 35; 28 → 38)
  expect(narrowing[51]).toBe(0)
  expect(narrowing[50]).toBe(1)
  expect(narrowing[39]).toBe(1)
  expect(narrowing[38]).toBe(4)
  expect(widening[53]).toBe(1)
  expect(widening[54]).toBe(0)
  expect(widening[41]).toBe(4)
  expect(widening[42]).toBe(1)
  // the version from MODEL_FULL_FROM, a plain threshold: the word still fits with it at 60 (need 39 ≤ 42), both ways
  expect(chooseMode(w, geometry(60), 0)).toEqual({ rank: 0, word: true, model: 'full', nameMax: NAME_MAX })
  expect(chooseMode(w, geometry(59), 0)).toEqual({ rank: 0, word: true, model: 'family', nameMax: NAME_MAX })
  for (let c = 24; c <= 200; c++) {
    // narrowing is the fresh choice (no hysteresis holds a mode that stopped fitting); widening is never richer than it
    expect(narrowing[c], `${c}`).toBe(rank(c, null))
    expect(widening[c]!, `${c}`).toBeGreaterThanOrEqual(narrowing[c]!)
    // a mode regained (every rank is a regain from the floor) is the ladder's own at the real budget: its names' cap is not the reduced one's
    const regained = chooseMode(w, geometry(c), 5)
    expect(regained, `${c}`).toEqual(modeAt(w, regained.rank, geometry(c).budget, geometry(c).full))
    // (the inner width dips by a cell at WIDE_FROM, where the padding grows: the ranks are monotonic away from it)
    if (c > 24 && (c < WIDE_FROM - 1 || c > WIDE_FROM + 3)) {
      expect(narrowing[c]!, `${c}`).toBeLessThanOrEqual(narrowing[c - 1]!)
      expect(widening[c]!, `${c}`).toBeLessThanOrEqual(widening[c - 1]!)
    }
  }
  // every threshold t where narrowing drops a mode at t - 1: widening still shows the poorer mode at t and t + 1, and has the
  // richer one back by t + 3 (three columns are at least two cells by FIT)
  let thresholds = 0
  for (let t = 25; t <= 196; t++) {
    if (narrowing[t]! >= narrowing[t - 1]! || (t >= WIDE_FROM - 1 && t <= WIDE_FROM + 3)) continue
    thresholds++
    expect(widening[t], `threshold ${t}`).toBe(narrowing[t - 1])
    expect(widening[t + 1], `threshold ${t}`).toBe(narrowing[t - 1])
    expect(widening[t + 3]!, `threshold ${t}`).toBeLessThanOrEqual(narrowing[t]!)
  }
  expect(thresholds).toBeGreaterThanOrEqual(3)
  // a sweep back and forth across one threshold flaps nowhere: 50 → 51 keeps the emoji, 50 → 54 → 50 → 48 drops and regains once
  expect([rank(51, null), rank(50, 0), rank(51, 1), rank(53, 1), rank(54, 1), rank(50, 0)]).toEqual([0, 1, 1, 1, 0, 1])
  // the mode changes nothing of a card's shape: the line counts are the geometry's and the rooms' alone (rowCount, below)
  expect(rowCount(props({ rooms: probeRooms(), columns: 24 }))).toBe(rowCount(props({ rooms: probeRooms(), columns: 200 })))
})

test('floorsOf (from WIDE_FROM): the minWidth floor of each column — the office-wide widest value by FIT plus the padding cell — so the columns align across the cards', () => {
  const w = officeWidest(probeRooms())
  const mode: TableMode = { rank: 0, word: true, model: 'full', nameMax: NAME_MAX }
  expect(floorsOf(w, mode)).toEqual({ status: Math.ceil(3 / FIT) + 1, who: Math.ceil(11 / FIT) + 1, model: Math.ceil(10 / FIT) + 1, actEmoji: Math.ceil(2 / FIT) + 1, actWord: Math.ceil(8 / FIT) + 1 })
  expect(floorsOf(w, { ...mode, model: 'family' }).model).toBe(Math.ceil(6 / FIT) + 1)
  expect(floorsOf(w, { ...mode, model: 'none' }).model).toBe(1)
  expect(floorsOf(w, { ...mode, nameMax: 5 }).who).toBe(Math.ceil(8 / FIT) + 1)
  // the model builds them only from WIDE_FROM
  expect(officeModel(props({ rooms: probeRooms(), columns: 79 })).floors).toBeNull()
  expect(officeModel(props({ rooms: probeRooms(), columns: 80 })).floors).toEqual(floorsOf(w, officeModel(props({ rooms: probeRooms(), columns: 80 })).mode))
  expect(officeModel(props({ rooms: probeRooms(), columns: 200 })).floors).not.toBeNull()
})

test('cardLines / rowCount: a card is CARD_LINES around its rows, MORE_LINES more with the more / hide line; rowCount counts the office without building a row and equals the line map\'s length across shapes, widths and both directions', { timeoutMs: 30_000 }, () => {
  expect(CARD_LINES).toBe(7)
  expect(MORE_LINES).toBe(2)
  expect(cardLines(2, false)).toBe(9)
  expect(cardLines(2, true)).toBe(11)
  expect(cardLines(0, false)).toBe(7)
  const shapes: OfficeRoom[][] = [
    [room()],
    [room({ moreLabel: 'עוד 5 שסיימו', done: 6 })],
    [room({ id: 'a' }), room({ id: 'b', agents: [ag('b1', 1)] })],
    tenByTen(),
    probeRooms(),
    Array.from({ length: 200 }, (_, i) => room({ id: `r${i}`, agents: [ag(`x${i}`, 1)] })),
    [room({ agents: Array.from({ length: 200 }, (_, i) => ag(`y${i}`, i)), moreLabel: 'הסתר שסיימו', done: 100 })],
  ]
  for (const rooms of shapes) {
    for (const columns of [24, 31, 45, 60, 64, 80, 90, 100, 200]) {
      for (const rtl of [true, false]) {
        const p = props({ rooms, columns, rtl })
        expect(rowCount(p), `${rooms.length} rooms at ${columns}`).toBe(officeModel(p).lines.length)
      }
    }
  }
  expect(rowCount(props({ rooms: [] }))).toBe(0)
})

test('officeModel: the line map of a card — border, pad, title, a BLANK line (no rule: round 9), a row per agent, [blank, more], pad, border, gap — each line one row tall by construction; the rows carry the probe\'s strings (the activity split into its emoji and its word), no plain space and no time; the hits: a row and the more line the column\'s width, the pin zone at the reading edge of the title, the counts zone (by FIT) at the other edge', () => {
  const r = room({ title: 'תיאטרון הסוכנים', run: 3, stale: 1, done: 2, moreLabel: 'עוד 2 שסיימו', agents: [
    ag('lead', 0, { name: 'הינשוף', act: '🤔 חושב', task: 'תכנון המעבר לרישום הסטטי' }),
    ag('a1', 1, { name: 'הרופא', model: 'Sonnet 4.5', act: '✏️ עורך' }),
    ag('w', 2, { name: 'הזאב', status: 'stale', act: '💤 ממתין' }),
    ag('m', 3, { name: 'המכונאי', status: 'done', star: 7000, act: '✅ סיים' }),
  ] })
  const p = props({ rooms: [r], columns: 51 })
  const m = officeModel(p)
  expect(kinds(m.lines)).toEqual(['border', 'pad', 'title', 'blank', 'row', 'row', 'row', 'row', 'blank', 'more', 'pad', 'border', 'gap'])
  expect(m.lines.every(l => l.room === 'sess-a')).toBe(true)
  expect(m.lines.filter(l => l.kind === 'row').map(l => l.agent)).toEqual(['lead', 'a1', 'w', 'm'])
  expect(m.lines.filter(l => l.kind !== 'row').every(l => l.agent === null)).toBe(true)
  expect(m.geo).toEqual(geometry(51))
  expect(m.mode).toEqual({ rank: 0, word: true, model: 'family', nameMax: NAME_MAX })   // the probe's width draws the word and the family
  expect(m.floors).toBeNull()
  const room0 = m.rooms[0]!
  expect(room0).toMatchObject({ id: 'sess-a', top: 0, height: 13, titleAt: 2, moreAt: 9, title: 'תיאטרון הסוכנים', counts: '🟢3 ⏳1 ✅2', pin: 'none', more: nb('▸ עוד 2 שסיימו') })
  expect(room0.rows.map(x => x.y)).toEqual([4, 5, 6, 7])
  // the rows: the status mark alone (the ⭐ badge for the just-finished one; no blank for the focus — the mark sits at the
  // reading edge), `${emoji} ${name}` with a no-break space, the family word (the version from MODEL_FULL_FROM), the activity's
  // emoji and its word apart, the short task (drawn from CENTRE_AT) — and nothing of the minutes anywhere
  expect(room0.rows.map(x => [x.status, x.who, x.model, x.actEmoji, x.actWord, x.task])).toEqual([
    ['●', nb('🦉 הינשוף'), 'Opus', '🤔', 'חושב', nb('תכנון המעבר לרישום הסטטי')],
    ['●', nb('🦉 הרופא'), 'Sonnet', '✏️', 'עורך', nb('משימה 1')],
    ['●', nb('🦉 הזאב'), 'Opus', '💤', 'ממתין', nb('משימה 2')],
    ['⭐', nb('🦉 המכונאי'), 'Opus', '✅', 'סיים', nb('משימה 3')],
  ])
  expect(room0.rows.map(x => x.color)).toEqual([DOT_FG.running, DOT_FG.running, DOT_FG.stale, DOT_FG.done])
  // the weights: working = bold; waiting = regular; finished = dim; nothing failed here
  expect(room0.rows.map(x => [x.bold, x.dim, x.failed])).toEqual([[true, false, false], [true, false, false], [false, false, false], [false, true, false]])
  expect(room0.rows.every(x => !x.focus && !x.pulse)).toBe(true)
  for (const x of room0.rows) for (const v of [x.status, x.who, x.model, x.actEmoji, x.actWord, x.task]) { expect(v).not.toMatch(/⏱|′|min|\d+ דק/); expect(v).not.toMatch(LONE_SURROGATE); expect(v).not.toContain(' ') }
  expect(officeModel(props({ rooms: [r], columns: 60 })).rooms[0]!.rows.map(x => x.model)).toEqual(['Opus 5.5', 'Sonnet 4.5', 'Opus 5.5', 'Opus 5.5'])
  // the hits (RTL): the pin zone at the right edge of the title line, the counts zone at the left edge, a row and the more line the whole width
  const pz = pinZone(geometry(51))
  const cz = countsZone('🟢3 ⏳1 ✅2', geometry(51))
  expect(m.hits).toEqual([
    { kind: 'pin', id: 'sess-a', x: 51 - pz, y: 2, w: pz, h: 1 },
    { kind: 'roomDone', id: 'sess-a', x: 0, y: 2, w: cz, h: 1 },
    { kind: 'agent', id: 'lead', x: 0, y: 4, w: 51, h: 1 },
    { kind: 'agent', id: 'a1', x: 0, y: 5, w: 51, h: 1 },
    { kind: 'agent', id: 'w', x: 0, y: 6, w: 51, h: 1 },
    { kind: 'agent', id: 'm', x: 0, y: 7, w: 51, h: 1 },
    { kind: 'moreDone', id: 'sess-a', x: 0, y: 9, w: 51, h: 1 },
  ])
  expect(hitAt(m, 50, 2)?.kind).toBe('pin')
  expect(hitAt(m, 3, 2)?.kind).toBe('roomDone')
  expect(hitAt(m, cz - 1, 2)?.kind).toBe('roomDone')   // the zone's last cell: the counts as the desktop draws them, wider than their cells
  expect(hitAt(m, cz, 2)).toBeUndefined()
  expect(hitAt(m, 25, 2)).toBeUndefined()        // the title itself is no control
  expect(hitAt(m, 25, 3)).toBeUndefined()        // the blank line
  expect(hitAt(m, 0, 4)?.id).toBe('lead')
  expect(hitAt(m, 50, 7)?.id).toBe('m')
  expect(hitAt(m, 25, 8)).toBeUndefined()        // the blank line over the more line
  expect(hitAt(m, 25, 9)?.kind).toBe('moreDone')
  expect(hitAt(m, 25, 12)).toBeUndefined()       // the gap
  expect(hitAt(m, 25, 13)).toBeUndefined()       // past the office
  // LTR: the pin zone at the left edge, the counts at the right; the rows the same
  const ltr = officeModel(props({ rooms: [r], columns: 51, rtl: false }))
  expect(ltr.hits[0]).toEqual({ kind: 'pin', id: 'sess-a', x: 0, y: 2, w: pz, h: 1 })
  expect(ltr.hits[1]).toEqual({ kind: 'roomDone', id: 'sess-a', x: 51 - cz, y: 2, w: cz, h: 1 })
  expect(ltr.rooms[0]!.rows.map(x => x.status)).toEqual(['●', '●', '●', '⭐'])
  // THE FROZEN COLUMN: from CENTRE_AT the hits are the column's cells (x from the column's left edge, w its width), never the pane's
  const wide = officeModel(props({ rooms: [r], columns: 200 }))
  expect(wide.geo.margin).toBe(50)
  expect(wide.hits.find(h => h.kind === 'agent')).toMatchObject({ x: 0, w: 100 })
  expect(wide.hits.find(h => h.kind === 'pin')).toMatchObject({ x: 100 - pinZone(geometry(200)), w: pinZone(geometry(200)) })
  expect(hitAt(wide, 99, 4)?.id).toBe('lead')
  expect(hitAt(wide, 100, 4)).toBeUndefined()
  // no finished agents: no counts hit; no more label: no more line, no blank
  const plain = officeModel(props({ rooms: [room()] }))
  expect(plain.hits.map(h => h.kind)).toEqual(['pin', 'agent', 'agent'])
  expect(kinds(plain.lines)).toEqual(['border', 'pad', 'title', 'blank', 'row', 'row', 'pad', 'border', 'gap'])
  expect(plain.rooms[0]).toMatchObject({ more: '', moreAt: -1, height: 9 })
  // two rooms: the second card starts after the first's gap; its lines name it
  const two = officeModel(props({ rooms: [room({ id: 'a' }), room({ id: 'b', agents: [ag('b1', 1)], pinned: true })] }))
  expect(two.rooms.map(x => [x.id, x.top, x.height])).toEqual([['a', 0, 9], ['b', 9, 8]])
  expect(two.lines.slice(9).every(l => l.room === 'b')).toBe(true)
  expect(two.rooms[1]!.pin).toBe('bright')
  expect(two.hits.find(h => h.kind === 'pin' && h.id === 'b')?.y).toBe(11)
  // the output is deterministic
  expect(JSON.stringify(officeModel(p))).toBe(JSON.stringify(m))
})

test('officeModel: the decor — a hovered unpinned head draws a dim 📌 (a pinned one bright, hovered or not), the focus a marker on the inner side of the status mark pointing in from the reading edge (the mark stays at the edge: no blank cell on the other rows), a pulse flags its row; nothing of it moves a line or a hit; the selection is no decor (the open drawer says which agent is selected)', () => {
  const rooms = [room({ id: 'a' }), room({ id: 'b', agents: [ag('b1', 1)], pinned: true })]
  const p = props({ rooms, selected: 'a1' })
  const base = officeModel(p)
  expect(base.rooms.map(x => x.pin)).toEqual(['none', 'bright'])
  expect(JSON.stringify(officeModel({ ...p, selected: null }))).toBe(JSON.stringify(base))
  expect(Object.keys(base.rooms[0]!.rows[0]!).sort()).toEqual(['actEmoji', 'actWord', 'bold', 'color', 'dim', 'failed', 'focus', 'id', 'model', 'pulse', 'status', 'task', 'who', 'y'])
  const hovered = officeModel(p, decor({ hoverRoom: 'a' }))
  expect(hovered.rooms[0]!.pin).toBe('dim')
  expect(officeModel(p, decor({ hoverRoom: 'b' })).rooms[1]!.pin).toBe('bright')
  const focused = officeModel(p, decor({ focus: 'lead' }))
  // RTL: the marker LEADS the string (a Text with no Hebrew is laid left to right, so the mark is the rightmost glyph: at the
  // reading edge, where every other row's mark is); LTR: the marker trails. No row carries a blank for a focus it has not got.
  expect(focused.rooms[0]!.rows[0]).toMatchObject({ focus: true, status: `${FOCUS_MARK.rtl}●` })
  expect(focused.rooms[0]!.rows[1]).toMatchObject({ focus: false, status: '●' })
  expect(focused.rooms[0]!.rows[0]!.status.endsWith('●')).toBe(true)
  expect(officeModel({ ...p, rtl: false }, decor({ focus: 'lead' })).rooms[0]!.rows[0]!.status).toBe(`●${FOCUS_MARK.ltr}`)
  expect(officeModel({ ...p, rtl: false }, decor({ focus: 'lead' })).rooms[0]!.rows[1]!.status).toBe('●')
  expect(FOCUS_MARK).toEqual({ rtl: '‹', ltr: '›' })
  const pulsing = officeModel(p, decor({ pulse: ['b1'] }))
  expect(pulsing.rooms[1]!.rows[0]!.pulse).toBe(true)
  expect(pulsing.rooms[0]!.rows.every(x => !x.pulse)).toBe(true)
  for (const m of [hovered, focused, pulsing]) {
    expect(m.lines).toEqual(base.lines)
    expect(m.hits).toEqual(base.hits)
    expect(m.rooms.map(x => [x.top, x.height, x.title, x.counts])).toEqual(base.rooms.map(x => [x.top, x.height, x.title, x.counts]))
    expect(m.mode).toEqual(base.mode)
  }
  expect(NO_DECOR).toEqual({ hoverRoom: null, focus: null, pulse: new Set() })
})

test('officeModel: the weights (round 8) — working = a bold name; waiting = a regular name; finished = dim; a ❌ row keeps a regular name (flagged `failed`); the badges never go', () => {
  const r = room({ agents: [ag('run', 0), ag('wait', 1, { status: 'stale', act: '💤 ממתין' }), ag('fin', 2, { status: 'done', act: '✅ סיים' }), ag('bad', 3, { status: 'done', failed: true, act: '⛔ נכשל' }), ag('slow', 4, { longRunning: true })] })
  const rows = officeModel(props({ rooms: [r] })).rooms[0]!.rows
  expect(rows.map(x => [x.status, x.bold, x.dim, x.failed])).toEqual([['●', true, false, false], ['●', false, false, false], ['○', false, true, false], ['❌', false, true, true], ['⏰', true, false, false]])
})

test('officeModel: at every width 24..200, both directions, the office of the probe and a crowd — every one-line value holds no plain space (nb: it can never wrap) and no lone surrogate; the rows of every room follow the ONE office-wide mode (the model column everywhere or nowhere, the word everywhere or nowhere, every name within the cap); a narrow pane cuts the names whole-glyph with an ellipsis; the mode is the fresh choice (no hysteresis handed in)', { timeoutMs: 30_000 }, () => {
  const r = room({ id: 'x', agents: [ag('lead', 0, { name: 'הינשוף', act: '🤔 חושב', failed: true, status: 'done' }), ag('a1', 1, { name: 'א'.repeat(24), act: '🔎 מחפש קוד', longRunning: true })] })
  const narrow = officeModel(props({ rooms: [r], columns: 30 })).rooms[0]!
  expect(narrow.rows.map(x => x.actEmoji)).toEqual(['🤔', '🔎'])
  expect(narrow.rows.map(x => x.actWord)).toEqual(['', ''])
  expect(narrow.rows.map(x => x.model)).toEqual(['', ''])
  expect(narrow.rows.map(x => x.status)).toEqual(['❌', '⏰'])
  expect(narrow.rows[1]!.who.endsWith('…')).toBe(true)
  expect(textWidth(narrow.rows[1]!.who)).toBeLessThan(EMOJI_CELLS + 1 + 24)
  const wide = officeModel(props({ rooms: [r], columns: 120 })).rooms[0]!
  expect(wide.rows.map(x => [x.who, x.model, x.actEmoji, x.actWord])).toEqual([[nb('🦉 הינשוף'), nb('Opus 5.5'), '🤔', 'חושב'], [nb(`🦉 ${'א'.repeat(24)}`), nb('Opus 5.5'), '🔎', nb('מחפש קוד')]])
  for (const rooms of [[r, ...probeRooms()], tenByTen()]) {
    for (let columns = 24; columns <= 200; columns += columns < 70 ? 1 : 5) {
      for (const rtl of [true, false]) {
        const p = props({ rooms, columns, rtl })
        const m = officeModel(p)
        expect(m.mode).toEqual(chooseMode(officeWidest(rooms), geometry(columns), null))
        for (const rm of m.rooms) {
          for (const v of [rm.title, rm.counts, rm.more]) { expect(v, `${columns} ${rtl}`).not.toContain(' '); expect(v).not.toMatch(LONE_SURROGATE) }
          expect(textWidth(rm.title)).toBeGreaterThan(0)
          for (const x of rm.rows) {
            for (const v of [x.status, x.who, x.model, x.actEmoji, x.actWord, x.task]) { expect(v, `${columns} ${rtl} ${x.id}`).not.toContain(' '); expect(v).not.toMatch(LONE_SURROGATE); expect(v).not.toMatch(/⏱|′/) }
            expect(x.who.startsWith(`🦉${NBSP}`)).toBe(true)
            expect(x.model === '', `${columns}`).toBe(m.mode.model === 'none')
            if (m.mode.word) expect(x.actWord, `${columns}`).not.toBe('')
            else expect(x.actWord, `${columns}`).toBe('')
            expect(textWidth(x.who), `${columns}`).toBeLessThanOrEqual(EMOJI_CELLS + 1 + m.mode.nameMax)
            expect(textWidth(x.task)).toBeLessThanOrEqual(TASK_MAX)
            expect(cellsOf(m, x).length).toBeGreaterThanOrEqual(3)
          }
        }
      }
    }
  }
})

test('trimWindow: the window keeps at most `maxRows` agent rows — the lines past the last row within the budget are dropped; a window inside the budget is returned as it is; count 0 and an empty office tolerated', () => {
  const m = officeModel(props({ rooms: [room({ agents: Array.from({ length: 50 }, (_, i) => ag(`a${i}`, i)) })] }))
  expect(m.lines.length).toBe(57)
  expect(trimWindow(m, 0, 57, 100)).toEqual({ from: 0, count: 57 })
  expect(trimWindow(m, 0, 57, 10)).toEqual({ from: 0, count: 4 + 10 })   // border, pad, title, blank, then ten rows
  expect(trimWindow(m, 4, 53, 10)).toEqual({ from: 4, count: 10 })
  expect(trimWindow(m, 10, 40, 5)).toEqual({ from: 10, count: 5 })
  expect(trimWindow(m, 50, 7, 100)).toEqual({ from: 50, count: 7 })
  expect(trimWindow(m, 0, 0, 10)).toEqual({ from: 0, count: 0 })
  expect(trimWindow(m, 0, 999, 100)).toEqual({ from: 0, count: 999 })      // (the caller clamps the count to the content: windowOf)
  expect(trimWindow(officeModel(props({ rooms: [] })), 0, 10, 5)).toEqual({ from: 0, count: 10 })
})

test('bounds: 200 agents in one room and in 200 rooms, at 45 and 200 columns — the model is built fast and its JSON stays small', () => {
  for (const rooms of [[room({ agents: Array.from({ length: 200 }, (_, i) => ag(`a${i}`, i)) })], Array.from({ length: 200 }, (_, i) => room({ id: `r${i}`, agents: [ag(`x${i}`, i)] }))]) {
    for (const columns of [45, 200]) {
      const t0 = performance.now()
      const m = officeModel(props({ rooms, columns }))
      const ms = performance.now() - t0
      expect(ms).toBeLessThan(200)
      expect(JSON.stringify(m).length).toBeLessThan(200_000)
      expect(m.hits.filter(h => h.kind === 'agent')).toHaveLength(200)
      expect(m.lines.filter(l => l.kind === 'row')).toHaveLength(200)
    }
  }
})

test('THE ROOM MEMO (roomCache): officeModel with a cache builds a room\'s base once per (props, width, mode) — a redraw with the same rooms builds nothing, one room changed builds that room alone (and measures the office once), a width change builds every room, the decor builds nothing; a room gone is dropped from the cache; the model is the same with and without the cache; the hysteresis rides the caller\'s `last`, never the cache', () => {
  const rooms = [room({ id: 'a' }), room({ id: 'b', agents: [ag('b1', 1), ag('b2', 2)], pinned: true, done: 1, moreLabel: 'עוד 1 שסיימו' }), room({ id: 'c', agents: [ag('c1', 1)] })]
  const p = props({ rooms, columns: 51 })
  const cache = roomCache()
  const m1 = officeModel(p, NO_DECOR, cache)
  expect(cache.builds).toBe(3)
  expect(cache.measures).toBe(1)
  expect(cache.rooms.size).toBe(3)
  expect(JSON.stringify(m1)).toBe(JSON.stringify(officeModel(p)))
  // the same props (a new object of equal JSON, as a poll hands them): nothing built, nothing measured
  officeModel(JSON.parse(JSON.stringify(p)) as OfficeProps, NO_DECOR, cache)
  expect(cache.builds).toBe(3)
  expect(cache.measures).toBe(1)
  // the decor: nothing built, and the model is the decorated one
  const hovered = officeModel(p, decor({ hoverRoom: 'a', focus: 'b1', pulse: ['c1'] }), cache)
  expect(cache.builds).toBe(3)
  expect(hovered.rooms[0]!.pin).toBe('dim')
  expect(hovered.rooms[1]!.rows[0]!.status).toBe(`${FOCUS_MARK.rtl}●`)
  expect(hovered.rooms[2]!.rows[0]!.pulse).toBe(true)
  expect(JSON.stringify(hovered)).toBe(JSON.stringify(officeModel(p, decor({ hoverRoom: 'a', focus: 'b1', pulse: ['c1'] }))))
  // one room changed (an agent's activity): that room alone; the office measured once more
  const q = { ...p, rooms: rooms.map(r => r.id === 'b' ? { ...r, agents: r.agents.map(a => a.id === 'b2' ? { ...a, act: '✏️ עורך' } : a) } : r) }
  const m2 = officeModel(q, NO_DECOR, cache)
  expect(cache.builds).toBe(4)
  expect(cache.measures).toBe(2)
  expect(m2.rooms[1]!.rows[1]!.actWord).toBe('עורך')
  expect(JSON.stringify(m2)).toBe(JSON.stringify(officeModel(q)))
  // the width: every room again (the mode and the title cut depend on it); the office not measured (its rooms did not change)
  const m3 = officeModel({ ...q, columns: 30 }, NO_DECOR, cache)
  expect(cache.builds).toBe(7)
  expect(cache.measures).toBe(2)
  expect(JSON.stringify(m3)).toBe(JSON.stringify(officeModel({ ...q, columns: 30 })))
  // the direction alone: nothing built (the base is the same; the status strings are laid per render)
  officeModel({ ...q, columns: 30, rtl: false }, NO_DECOR, cache)
  expect(cache.builds).toBe(7)
  // the hysteresis: at this office's word threshold (need 26: 39 columns) a `last` of a poorer mode keeps it — the rooms are
  // rebuilt (their texts follow the mode), and the model equals the uncached one with the same `last`
  const fresh = officeModel({ ...q, columns: 39 }, NO_DECOR, cache)
  expect(fresh.mode.rank).toBe(0)
  expect(cache.builds).toBe(10)
  const held = officeModel({ ...q, columns: 39 }, NO_DECOR, cache, 1)
  expect(held.mode.rank).toBe(1)
  expect(cache.builds).toBe(13)
  expect(JSON.stringify(held)).toBe(JSON.stringify(officeModel({ ...q, columns: 39 }, NO_DECOR, undefined, 1)))
  // a room gone: dropped from the cache; back again: built again
  officeModel({ ...q, columns: 30, rooms: q.rooms.slice(0, 2) }, NO_DECOR, cache)
  expect([...cache.rooms.keys()]).toEqual(['a', 'b'])
  const built = cache.builds
  officeModel({ ...q, columns: 30 }, NO_DECOR, cache)
  expect(cache.builds).toBe(built + 1)
  // the pin state is part of the room's props: a pin builds that room (its title cut moves with the 📌)
  officeModel({ ...q, columns: 30, rooms: q.rooms.map(r => r.id === 'a' ? { ...r, pinned: true } : r) }, NO_DECOR, cache)
  expect(cache.builds).toBe(built + 2)
})
