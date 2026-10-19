// office-layout.ts: the pure view model of the desktop office. No engine, no
// `$`: the cards' rows (the four cells' texts and flags), the line map (the y
// of every drawn line), the hit rectangles and the text helpers are asserted
// on the data.

import { expect, test } from 'claude-code/testing'

import { hebrewRuleOk } from './i18n'
import { ACT_MAX, CARD_FRAME, CARD_LINES, DOT_FG, EMOJI_CELLS, FIT, FOCUS_MARK, LINE_FIT, MODEL_FULL_FROM, MORE_LINES, NAME_MAX, NAME_MIN, NO_DECOR, PIN_ZONE, TITLE_GAP, cardLines, countsText, countsZone, cut, cutTitle, cutWords, firstGlyph, fitCells, fitLine, glyphs, hitAt, iconLabel, markOf, modelText, officeModel, roomCache, rowCount, tableFit, tableFitAt, textWidth, trimWindow } from './office-layout'
import type { Line, OfficeDecor } from './office-layout'
import type { OfficeAgent, OfficeProps, OfficeRoom } from './office-props'

function ag(id: string, i: number, over: Partial<OfficeAgent> = {}): OfficeAgent {
  return { id, emoji: '🦉', name: `סוכן ${i}`, status: 'running', act: '📖 קורא', model: 'Opus 5.5', failed: false, longRunning: false, star: 0, ...over }
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

function decor(over: Partial<{ hoverRoom: string | null; focus: string | null; pulse: string[] }> = {}): OfficeDecor {
  return { hoverRoom: over.hoverRoom ?? null, focus: over.focus ?? null, pulse: new Set(over.pulse ?? []) }
}

const LONE_SURROGATE = /\p{Cs}/u
const kinds = (lines: readonly Line[]) => lines.map(l => l.kind)

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

test('fitCells / FIT: the share of a width the desktop draws text into (letters wider than a cell); cutTitle leaves the pin and the counts their cells and never cuts under 8', () => {
  expect(FIT).toBe(0.75)
  expect(LINE_FIT).toBe(0.83)
  expect(fitCells(47)).toBe(35)   // the probe's round 6: four columns of 32 cells fit the 47 inner cells of a 51-column pane, five of 39 did not
  expect(fitCells(10)).toBe(7)
  expect(fitCells(0)).toBe(0)
  expect(fitCells(-5)).toBe(0)
  expect(fitLine(51)).toBe(42)    // the probe's round 7: the header's 33 cells of counts, a gap and 8 of meter fit 51 columns
  expect(fitLine(0)).toBe(0)
  const counts = '🟢3 ⏳1 ✅2'
  // the probe's gap of two between the title and the counts, the title flush at the reading edge (no pin drawn): 51 columns
  // leave 51 - 4 (frame) - 2 (the title's padding) - 11 (counts) - 2 (gap) = 32 → 24 cells, and the probe's third room reads
  // `בדיקת תיאטרון הסוכנים…` as it did on the desktop (round 7); pinned, the 📌 and its gap take 4 more cells (28 → 21, one short
  // of that title's third word with the ellipsis' cell: a word shorter — the pinned title has less room, never a clipped one);
  // the pin zone counts the pin whether drawn or not
  expect(TITLE_GAP).toBe(2)
  expect(PIN_ZONE).toBe(7)
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', 51, counts)).toBe('בדיקת תיאטרון הסוכנים…')
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', 51, counts, true)).toBe('בדיקת תיאטרון…')
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', 56, counts, true)).toBe('בדיקת תיאטרון הסוכנים…')
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', 40, counts)).toBe('בדיקת תיאטרון…')
  expect(cutTitle('תיאטרון הסוכנים', 51, counts)).toBe('תיאטרון הסוכנים')
  expect(cutTitle('abcdefghijklmnopqrstuvwxyz', 24, counts)).toBe('abcdefg…')   // the floor of 8
  for (let columns = 24; columns <= 200; columns++) {
    for (const pinned of [false, true]) {
      const t = cutTitle('x'.repeat(300), columns, counts, pinned)
      expect(textWidth(t), `${columns}: ${t}`).toBeLessThanOrEqual(Math.max(8, fitCells(columns - CARD_FRAME - 2 - (pinned ? EMOJI_CELLS + TITLE_GAP : 0) - textWidth(counts) - TITLE_GAP)))
      expect(t.endsWith('…'), `${columns}: ${t}`).toBe(true)
    }
    // a pinned title is never longer than the unpinned one
    expect(textWidth(cutTitle('x'.repeat(300), columns, counts, true))).toBeLessThanOrEqual(textWidth(cutTitle('x'.repeat(300), columns, counts)))
  }
  // the counts' zone (the room's ✅ toggle), from the far edge: the border and the paddings, then the counts as the desktop draws
  // them — wider than their cells, by FIT (11 cells → 15) — never into the pin zone
  expect(countsZone(counts, 51)).toBe(3 + Math.ceil(11 / FIT))
  expect(countsZone(counts, 51)).toBe(18)
  expect(countsZone('🟢2', 51)).toBe(3 + Math.ceil(3 / FIT))
  expect(countsZone(counts, 20)).toBe(20 - PIN_ZONE)
  expect(countsZone(counts, 8)).toBe(1)
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

test('tableFit: the four columns whole when their widest values (a padding cell each, the focus cell on the status) fit the card\'s inner width by FIT; else THE DROP ORDER — the activity word goes (its emoji stays) and the names shrink to NAME_MIN, then the model\'s version, last the model column — never a clipped value, never the model before the activity word', () => {
  const r = room({ agents: [ag('lead', 0, { name: 'המנהל', act: '🤔 חושב' }), ag('a1', 1, { name: 'הרופא', model: 'Sonnet 4.5', act: '🔎 מחפש קוד' })] })
  // the need: status 1 + 1 + 1, who 2 + 1 + 5 + 1, model `Sonnet` 6 + 1 (the version only from MODEL_FULL_FROM), act 2 + 1 + 8 + 1 = 3 + 9 + 7 + 12 = 31 cells
  const need = 31
  const widest = (columns: number) => fitCells(columns - CARD_FRAME)
  for (let columns = 24; columns <= 200; columns++) {
    const fit = tableFit(r, columns)
    const full = columns >= MODEL_FULL_FROM
    const needAt = need + (full ? 'Sonnet 4.5'.length - 'Sonnet'.length : 0)
    if (widest(columns) >= needAt) expect(fit, `${columns}`).toEqual({ actWord: true, showModel: true, modelFull: full, nameMax: NAME_MAX })
    else {
      expect(fit.actWord, `${columns}`).toBe(false)
      // with the emoji alone the row needs 3 + 9 + 7 + 3 = 22 cells (short names: nameMax never bites); the model column stays while that fits
      const emojiNeed = 22 + (full ? 4 : 0)
      expect(fit.showModel, `${columns}`).toBe(widest(columns) >= emojiNeed)
      expect(fit.nameMax).toBeGreaterThanOrEqual(NAME_MIN)
      expect(fit.nameMax).toBeLessThanOrEqual(NAME_MAX)
    }
  }
  expect(tableFit(r, 51)).toEqual({ actWord: true, showModel: true, modelFull: false, nameMax: NAME_MAX })   // the probe's width (round 6 fit four columns)
  expect(tableFit(r, 45).actWord).toBe(false)                                               // 41 inner → 30 < 31: the word goes
  expect(tableFit(r, 24)).toMatchObject({ actWord: false, showModel: false })               // 20 inner → 15 < 22: the model goes too
  // long names shrink before the model goes: a 24-cell name at 60 columns (56 inner → 42 cells): status 3 + who 28 + model 9 (`Opus 5.5`) + act 8 = 48 → the name cut to 42 - 3 - 9 - 3 - 1 - 2 - 1 = 23
  const long = room({ agents: [ag('x', 1, { name: 'א'.repeat(24), act: '📖 קורא' })] })
  expect(tableFit(long, 60)).toEqual({ actWord: false, showModel: true, modelFull: true, nameMax: 23 })
  expect(tableFit(long, 120)).toEqual({ actWord: true, showModel: true, modelFull: true, nameMax: NAME_MAX })
  // a room of only-emoji names (2 cells each) keeps the four columns at the probe's width
  expect(tableFit(room({ agents: [ag('o', 1, { name: '🦉🦉🦉', act: '🦉🦉' })] }), 51)).toEqual({ actWord: true, showModel: true, modelFull: false, nameMax: NAME_MAX })
  // THE DROP ORDER at a given inner width (tableFitAt, the version riding): whole → the word goes → the version goes → the model
  // column goes; with today's caps a pane wide enough for the version (MODEL_FULL_FROM) always fits the emoji table, so the
  // version step is pinned here at the inner widths that would need it
  const two = room({ agents: [ag('x', 1, { name: 'א'.repeat(24), model: 'Sonnet 4.5', act: '🔎 מחפש קוד' }), ag('y', 2, { name: 'ב'.repeat(24), model: 'Opus 5.5', act: '✏️ עורך' })] })
  // the whole need: status 3 + who 28 + model `Sonnet 4.5` 11 + act `🔎 מחפש קוד` 2 + 1 + 8 + 1 = 12 → 54; the emoji table at NAME_MIN: 3 + 10 + 11 + 3 = 27; the family: 3 + 10 + 7 + 3 = 23
  expect(tableFitAt(two, 54, true)).toEqual({ actWord: true, showModel: true, modelFull: true, nameMax: NAME_MAX })
  expect(tableFitAt(two, 53, true)).toEqual({ actWord: false, showModel: true, modelFull: true, nameMax: NAME_MAX })   // the word first; the names whole while they fit (3 + 28 + 11 + 3 = 45)
  expect(tableFitAt(two, 44, true)).toEqual({ actWord: false, showModel: true, modelFull: true, nameMax: 44 - 3 - 11 - 3 - 1 - 2 - 1 })   // ... then shrink to what is left
  expect(tableFitAt(two, 27, true)).toEqual({ actWord: false, showModel: true, modelFull: true, nameMax: NAME_MIN })
  expect(tableFitAt(two, 26, true)).toEqual({ actWord: false, showModel: true, modelFull: false, nameMax: 9 })   // then the version: the four cells it frees go back to the names (26 - 3 - 7 - 3 = 13 → 9)
  expect(tableFitAt(two, 23, true)).toEqual({ actWord: false, showModel: true, modelFull: false, nameMax: NAME_MIN })
  expect(tableFitAt(two, 22, true)).toEqual({ actWord: false, showModel: false, modelFull: false, nameMax: 12 })  // last the column: its cells go to the names (22 - 3 - 3 = 16 → 12)
  // the same under the family rule (no version to shed): the word, then the column
  expect(tableFitAt(two, 23, false)).toEqual({ actWord: false, showModel: true, modelFull: false, nameMax: NAME_MIN })
  expect(tableFitAt(two, 22, false)).toEqual({ actWord: false, showModel: false, modelFull: false, nameMax: 12 })
  // at every inner width the model column never goes while the activity word stays, and a narrower width never draws more than a wider one
  let prev = tableFitAt(two, 200, true)
  for (let inner = 199; inner >= 0; inner--) {
    const fit = tableFitAt(two, inner, true)
    expect(fit.actWord && !fit.showModel, `${inner}: the model gone while the word stays`).toBe(false)
    expect(Number(fit.actWord) * 4 + Number(fit.showModel) * 2 + Number(fit.modelFull), `${inner}`).toBeLessThanOrEqual(Number(prev.actWord) * 4 + Number(prev.showModel) * 2 + Number(prev.modelFull))
    // the names never widen as the pane narrows — except at a step of the order, whose freed cells go to them
    if (fit.showModel === prev.showModel && fit.modelFull === prev.modelFull) expect(fit.nameMax, `${inner}`).toBeLessThanOrEqual(prev.nameMax)
    prev = fit
  }
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
    Array.from({ length: 200 }, (_, i) => room({ id: `r${i}`, agents: [ag(`x${i}`, 1)] })),
    [room({ agents: Array.from({ length: 200 }, (_, i) => ag(`y${i}`, i)), moreLabel: 'הסתר שסיימו', done: 100 })],
  ]
  for (const rooms of shapes) {
    for (const columns of [24, 31, 45, 60, 90, 200]) {
      for (const rtl of [true, false]) {
        const p = props({ rooms, columns, rtl })
        expect(rowCount(p), `${rooms.length} rooms at ${columns}`).toBe(officeModel(p).lines.length)
      }
    }
  }
  expect(rowCount(props({ rooms: [] }))).toBe(0)
})

test('officeModel: the line map of a card — border, pad, title, rule, a row per agent, [blank, more], pad, border, gap — each line one row tall by construction; the rows carry the probe\'s strings and no time; the hits: a row and the more line whole width, the pin zone at the reading edge of the title, the counts zone (by FIT) at the other edge', () => {
  const r = room({ title: 'תיאטרון הסוכנים', run: 3, stale: 1, done: 2, moreLabel: 'עוד 2 שסיימו', agents: [
    ag('lead', 0, { name: 'הינשוף', act: '🤔 חושב' }),
    ag('a1', 1, { name: 'הרופא', model: 'Sonnet 4.5', act: '✏️ עורך' }),
    ag('w', 2, { name: 'הזאב', status: 'stale', act: '💤 ממתין' }),
    ag('m', 3, { name: 'המכונאי', status: 'done', star: 7000, act: '✅ סיים' }),
  ] })
  const p = props({ rooms: [r], columns: 51 })
  const m = officeModel(p)
  expect(kinds(m.lines)).toEqual(['border', 'pad', 'title', 'rule', 'row', 'row', 'row', 'row', 'blank', 'more', 'pad', 'border', 'gap'])
  expect(m.lines.every(l => l.room === 'sess-a')).toBe(true)
  expect(m.lines.filter(l => l.kind === 'row').map(l => l.agent)).toEqual(['lead', 'a1', 'w', 'm'])
  expect(m.lines.filter(l => l.kind !== 'row').every(l => l.agent === null)).toBe(true)
  const room0 = m.rooms[0]!
  expect(room0).toMatchObject({ id: 'sess-a', top: 0, height: 13, titleAt: 2, moreAt: 9, title: 'תיאטרון הסוכנים', counts: '🟢3 ⏳1 ✅2', pin: 'none', more: '▸ עוד 2 שסיימו', actWord: true, showModel: true })
  expect(room0.rows.map(x => x.y)).toEqual([4, 5, 6, 7])
  // the rows: the status mark alone (the ⭐ badge for the just-finished one; no blank for the focus — the mark sits at the
  // reading edge), `${emoji} ${name}`, the family word (the version from MODEL_FULL_FROM), the activity whole — and nothing of
  // the minutes anywhere
  expect(room0.rows.map(x => [x.status, x.who, x.model, x.act])).toEqual([
    ['●', '🦉 הינשוף', 'Opus', '🤔 חושב'],
    ['●', '🦉 הרופא', 'Sonnet', '✏️ עורך'],
    ['●', '🦉 הזאב', 'Opus', '💤 ממתין'],
    ['⭐', '🦉 המכונאי', 'Opus', '✅ סיים'],
  ])
  expect(room0.rows.map(x => x.color)).toEqual([DOT_FG.running, DOT_FG.running, DOT_FG.stale, DOT_FG.done])
  expect(room0.rows.map(x => x.dim)).toEqual([false, false, false, true])
  expect(room0.rows.every(x => !x.focus && !x.pulse)).toBe(true)
  for (const x of room0.rows) for (const v of [x.status, x.who, x.model, x.act]) { expect(v).not.toMatch(/⏱|′|min|\d+ דק/); expect(v).not.toMatch(LONE_SURROGATE) }
  expect(officeModel(props({ rooms: [r], columns: 60 })).rooms[0]!.rows.map(x => x.model)).toEqual(['Opus 5.5', 'Sonnet 4.5', 'Opus 5.5', 'Opus 5.5'])
  // the hits (RTL): the pin zone at the right edge of the title line, the counts zone at the left edge, a row and the more line the whole width
  expect(m.hits).toEqual([
    { kind: 'pin', id: 'sess-a', x: 51 - PIN_ZONE, y: 2, w: PIN_ZONE, h: 1 },
    { kind: 'roomDone', id: 'sess-a', x: 0, y: 2, w: countsZone('🟢3 ⏳1 ✅2', 51), h: 1 },
    { kind: 'agent', id: 'lead', x: 0, y: 4, w: 51, h: 1 },
    { kind: 'agent', id: 'a1', x: 0, y: 5, w: 51, h: 1 },
    { kind: 'agent', id: 'w', x: 0, y: 6, w: 51, h: 1 },
    { kind: 'agent', id: 'm', x: 0, y: 7, w: 51, h: 1 },
    { kind: 'moreDone', id: 'sess-a', x: 0, y: 9, w: 51, h: 1 },
  ])
  expect(hitAt(m, 50, 2)?.kind).toBe('pin')
  expect(hitAt(m, 3, 2)?.kind).toBe('roomDone')
  expect(hitAt(m, countsZone('🟢3 ⏳1 ✅2', 51) - 1, 2)?.kind).toBe('roomDone')   // the zone's last cell: the counts as the desktop draws them, wider than their cells
  expect(hitAt(m, countsZone('🟢3 ⏳1 ✅2', 51), 2)).toBeUndefined()
  expect(hitAt(m, 25, 2)).toBeUndefined()        // the title itself is no control
  expect(hitAt(m, 25, 3)).toBeUndefined()        // the rule
  expect(hitAt(m, 0, 4)?.id).toBe('lead')
  expect(hitAt(m, 50, 7)?.id).toBe('m')
  expect(hitAt(m, 25, 8)).toBeUndefined()        // the blank line over the more line
  expect(hitAt(m, 25, 9)?.kind).toBe('moreDone')
  expect(hitAt(m, 25, 12)).toBeUndefined()       // the gap
  expect(hitAt(m, 25, 13)).toBeUndefined()       // past the office
  // LTR: the pin zone at the left edge, the counts at the right; the rows the same
  const ltr = officeModel(props({ rooms: [r], columns: 51, rtl: false }))
  expect(ltr.hits[0]).toEqual({ kind: 'pin', id: 'sess-a', x: 0, y: 2, w: PIN_ZONE, h: 1 })
  expect(ltr.hits[1]).toEqual({ kind: 'roomDone', id: 'sess-a', x: 51 - countsZone('🟢3 ⏳1 ✅2', 51), y: 2, w: countsZone('🟢3 ⏳1 ✅2', 51), h: 1 })
  expect(ltr.rooms[0]!.rows.map(x => x.status)).toEqual(['●', '●', '●', '⭐'])
  // no finished agents: no counts hit; no more label: no more line, no blank
  const plain = officeModel(props({ rooms: [room()] }))
  expect(plain.hits.map(h => h.kind)).toEqual(['pin', 'agent', 'agent'])
  expect(kinds(plain.lines)).toEqual(['border', 'pad', 'title', 'rule', 'row', 'row', 'pad', 'border', 'gap'])
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
  expect(Object.keys(base.rooms[0]!.rows[0]!).sort()).toEqual(['act', 'color', 'dim', 'focus', 'id', 'model', 'pulse', 'status', 'who', 'y'])
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
  }
  expect(NO_DECOR).toEqual({ hoverRoom: null, focus: null, pulse: new Set() })
})

test('officeModel: a narrow pane — the activity cells keep their emoji alone, the names are cut whole-glyph with an ellipsis, the model column is dropped last; a wide one draws everything; the badges never go', { timeoutMs: 30_000 }, () => {
  const r = room({ agents: [ag('lead', 0, { name: 'הינשוף', act: '🤔 חושב', failed: true }), ag('a1', 1, { name: 'א'.repeat(24), act: '🔎 מחפש קוד', longRunning: true })] })
  const narrow = officeModel(props({ rooms: [r], columns: 30 })).rooms[0]!
  expect(narrow.actWord).toBe(false)
  expect(narrow.rows.map(x => x.act)).toEqual(['🤔', '🔎'])
  expect(narrow.rows.map(x => x.status)).toEqual(['❌', '⏰'])
  expect(narrow.rows[1]!.who.endsWith('…')).toBe(true)
  expect(textWidth(narrow.rows[1]!.who)).toBeLessThan(EMOJI_CELLS + 1 + 24)
  const wide = officeModel(props({ rooms: [r], columns: 120 })).rooms[0]!
  expect(wide).toMatchObject({ actWord: true, showModel: true })
  expect(wide.rows.map(x => [x.who, x.act])).toEqual([['🦉 הינשוף', '🤔 חושב'], [`🦉 ${'א'.repeat(24)}`, '🔎 מחפש קוד']])
  // at every width, both directions: every cell text is whole (no lone surrogate), a row's who starts with its emoji, the act is the
  // label or its emoji, and the cells carry no clock
  for (let columns = 24; columns <= 200; columns += columns < 60 ? 2 : 8) {
    for (const rtl of [true, false]) {
      const m = officeModel(props({ rooms: [r, ...tenByTen().slice(0, 3)], columns, rtl }))
      for (const rm of m.rooms) {
        for (const x of rm.rows) {
          for (const v of [x.status, x.who, x.model, x.act]) { expect(v).not.toMatch(LONE_SURROGATE); expect(v).not.toMatch(/⏱|′/) }
          expect(x.who.startsWith('🦉 ')).toBe(true)
          expect(x.act === '' || x.act === firstGlyph(x.act) || rm.actWord).toBe(true)
        }
        expect(textWidth(rm.title)).toBeGreaterThan(0)
      }
    }
  }
})

test('trimWindow: the window keeps at most `maxRows` agent rows — the lines past the last row within the budget are dropped; a window inside the budget is returned as it is; count 0 and an empty office tolerated', () => {
  const m = officeModel(props({ rooms: [room({ agents: Array.from({ length: 50 }, (_, i) => ag(`a${i}`, i)) })] }))
  expect(m.lines.length).toBe(57)
  expect(trimWindow(m, 0, 57, 100)).toEqual({ from: 0, count: 57 })
  expect(trimWindow(m, 0, 57, 10)).toEqual({ from: 0, count: 4 + 10 })   // border, pad, title, rule, then ten rows
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

test('THE ROOM MEMO (roomCache): officeModel with a cache builds a room\'s base once per (props, width) — a redraw with the same rooms builds nothing, one room changed builds that room alone, a width change builds every room, the decor builds nothing; a room gone is dropped from the cache; the model is the same with and without the cache', () => {
  const rooms = [room({ id: 'a' }), room({ id: 'b', agents: [ag('b1', 1), ag('b2', 2)], pinned: true, done: 1, moreLabel: 'עוד 1 שסיימו' }), room({ id: 'c', agents: [ag('c1', 1)] })]
  const p = props({ rooms, columns: 51 })
  const cache = roomCache()
  const m1 = officeModel(p, NO_DECOR, cache)
  expect(cache.builds).toBe(3)
  expect(cache.rooms.size).toBe(3)
  expect(JSON.stringify(m1)).toBe(JSON.stringify(officeModel(p)))
  // the same props (a new object of equal JSON, as a poll hands them): nothing built
  officeModel(JSON.parse(JSON.stringify(p)) as OfficeProps, NO_DECOR, cache)
  expect(cache.builds).toBe(3)
  // the decor: nothing built, and the model is the decorated one
  const hovered = officeModel(p, decor({ hoverRoom: 'a', focus: 'b1', pulse: ['c1'] }), cache)
  expect(cache.builds).toBe(3)
  expect(hovered.rooms[0]!.pin).toBe('dim')
  expect(hovered.rooms[1]!.rows[0]!.status).toBe(`${FOCUS_MARK.rtl}●`)
  expect(hovered.rooms[2]!.rows[0]!.pulse).toBe(true)
  expect(JSON.stringify(hovered)).toBe(JSON.stringify(officeModel(p, decor({ hoverRoom: 'a', focus: 'b1', pulse: ['c1'] }))))
  // one room changed (an agent's activity): that room alone
  const q = { ...p, rooms: rooms.map(r => r.id === 'b' ? { ...r, agents: r.agents.map(a => a.id === 'b2' ? { ...a, act: '✏️ עורך' } : a) } : r) }
  const m2 = officeModel(q, NO_DECOR, cache)
  expect(cache.builds).toBe(4)
  expect(m2.rooms[1]!.rows[1]!.act).toBe('✏️ עורך')
  expect(JSON.stringify(m2)).toBe(JSON.stringify(officeModel(q)))
  // the width: every room again (the fit and the title cut depend on it)
  const m3 = officeModel({ ...q, columns: 30 }, NO_DECOR, cache)
  expect(cache.builds).toBe(7)
  expect(JSON.stringify(m3)).toBe(JSON.stringify(officeModel({ ...q, columns: 30 })))
  // the direction alone: nothing built (the base is the same; the status strings are laid per render)
  officeModel({ ...q, columns: 30, rtl: false }, NO_DECOR, cache)
  expect(cache.builds).toBe(7)
  // a room gone: dropped from the cache; back again: built again
  officeModel({ ...q, columns: 30, rooms: q.rooms.slice(0, 2) }, NO_DECOR, cache)
  expect(cache.builds).toBe(7)
  expect([...cache.rooms.keys()]).toEqual(['a', 'b'])
  officeModel({ ...q, columns: 30 }, NO_DECOR, cache)
  expect(cache.builds).toBe(8)
  // the pin state is part of the room's props: a pin builds that room (its title cut moves with the 📌)
  officeModel({ ...q, columns: 30, rooms: q.rooms.map(r => r.id === 'a' ? { ...r, pinned: true } : r) }, NO_DECOR, cache)
  expect(cache.builds).toBe(9)
})
