// office-layout.ts: the pure view model of the desktop office. No engine, no
// `$`: the geometry of the reading column, the office-wide table mode and its
// hysteresis, the cards' rows (every cell's text and the flags that weight
// it), the line map (the y of every drawn line) and the text helpers are
// asserted on the data.

import { expect, test } from 'claude-code/testing'

import { I18N, hebrewRuleOk } from './i18n'
import { REFUSED_RE, cleanAgentText } from './office-chrome'
import { ACT_MAX, CARD_LINES, CENTRE_AT, DOT_FG, EMOJI_CELLS, FIT, FOCUS_MARK, HYSTERESIS, LESS_MARK, LINE_FIT, MODEL_FULL_FROM, MORE_LINES, MORE_MARK, NAME_FLOOR, NAME_MAX, NAME_MIN, GLUE, NBBAR, NBHY, NBSLASH, NBSP, NO_DECOR, ONE_LINE_FROM, PANE_GUTTER, TASK_MAX, TASK_UNITS, TITLE_GAP, TITLE_MIN, WIDE_FROM, capUnits, cardLines, chooseMode, countsFor, countsText, cut, cutTask, cutTitle, cutWords, firstGlyph, fitCells, fitLine, floorsOf, geometry, glyphs, iconLabel, latinDominant, markOf, modeAt, modelText, nb, needOf, officeModel, officeWidest, restWord, roomCache, rowCount, textWidth, trimWindow, widestKey, widestName } from './office-layout'
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
    counts: { run: 2, idle: 0, done: 0 }, prefs: { showDone: false, muted: false },
    search: '', selected: null, helpOpen: false, demo: false,
    rooms: [room()],
    drawer: null, footer: '', oversized: '', usage: null, empty: null, labels: {}, ...over,
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

function decor(over: Partial<OfficeDecor> = {}): OfficeDecor {
  return { focus: over.focus ?? null }
}

/** The geometry of a reading column `W` cells wide: the pane `W + PANE_GUTTER` (live check 6: a cell left free at each edge). The probe's widths are the column's. */
const atColumn = (W: number) => geometry(W + PANE_GUTTER)

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

test('cutWords (live check 5): the word cut only while the whole words keep two thirds of the allowed cells — an earlier last space (a long word at the cut) cuts inside the word, the ellipsis trailing', () => {
  const t = 'Plan the static registrymigration rollout'
  // at 26 cells the last space before the cut leaves `Plan the static` (15 cells, under 2/3 of 26): the cut falls inside the word
  expect(cutWords(t, 26)).toBe('Plan the static registrym…')
  expect(cutWords(t, 23)).toBe('Plan the static regist…')    // 15 < 15.3
  // two thirds kept (15 ≥ 14.7): the word cut
  expect(cutWords(t, 22)).toBe('Plan the static…')
  // the cut on a boundary is whole words whatever their share
  expect(cutWords('Plan the static-registry move and the v2 config rollout', 26)).toBe('Plan the static-registry…')
  // a hyphen is no word boundary of the cut (only a space is): the hyphenated word is kept whole or cut inside
  expect(cutWords('Plan the static-registrymigration', 26)).toBe('Plan the static-registrym…')
  // Hebrew alike: `בדיקת תיאטרון` (13 cells) is not two thirds of 21 — inside the word; of 19 it is
  const he = 'בדיקת תיאטרון הסוכניםבשיחהחדשה'
  expect(cutWords(he, 21)).toBe('בדיקת תיאטרון הסוכני…')
  expect(cutWords(he, 19)).toBe('בדיקת תיאטרון…')
  for (let max = 8; max <= 40; max++) {
    const c = cutWords(t, max)
    expect(textWidth(c), `${max}`).toBeLessThanOrEqual(max)
    expect(c.endsWith('…'), `${max}`).toBe(true)
    // whatever the cut, it keeps at least two thirds of the cells (a whole-word cut that would keep fewer is refused)
    expect(3 * textWidth(c.slice(0, -1)), `${max}: ${c}`).toBeGreaterThanOrEqual(2 * max - 3)
  }
})

test('cutTask / capUnits / TASK_UNITS: the row\'s task cut to TASK_MAX cells AND to TASK_UNITS code units, whole glyphs, one ellipsis — a ZWJ family emoji task (eleven units a glyph) is bounded by the units, a Hebrew one by the cells', () => {
  expect(TASK_UNITS).toBe(2 * TASK_MAX)
  const family = '👨‍👩‍👧‍👦'
  expect(family.length).toBe(11)
  expect(textWidth(family)).toBe(EMOJI_CELLS)
  expect(capUnits('abc', 3)).toBe('abc')
  expect(capUnits('abcd', 3)).toBe('ab…')
  expect(capUnits(family.repeat(3), 23)).toBe(`${family}${family}…`)   // 22 units + the ellipsis
  expect(capUnits(family.repeat(3), 22)).toBe(`${family}…`)            // 23 > 22: a whole glyph fewer
  expect(capUnits('', 0)).toBe('')
  // a 24-cell Hebrew task: the cells cut it, the units never do
  const hebrew = 'תכנון המעבר לרישום הסטטי של המשרד'
  expect(cutTask(hebrew)).toBe(cut(hebrew, TASK_MAX))
  expect(cutTask(hebrew).length).toBeLessThanOrEqual(TASK_UNITS)
  // thirteen families: 24 cells hold twelve (132 units) — the units cut it to four (44) and one ellipsis
  const families = cutTask(family.repeat(13))
  expect(families).toBe(`${family.repeat(4)}…`)
  expect(families.length).toBeLessThanOrEqual(TASK_UNITS)
  expect(families.match(/…/g)).toHaveLength(1)
  // a stack of combining marks on one letter (one cell, many units): bounded too, whole glyphs only
  const acute = String.fromCharCode(0x301)
  const stacked = 'a' + acute.repeat(90)
  expect(textWidth(stacked)).toBe(1)
  expect(cutTask(stacked)).toBe('…')
  expect(cutTask('x' + stacked)).toBe('x…')                              // 92 units: the stack goes whole
  expect(cutTask('x' + stacked.slice(0, 40))).toBe('x' + stacked.slice(0, 40))   // 41 units, two cells: kept
  expect(cutTask('xy' + stacked.slice(0, 40)).length).toBeLessThanOrEqual(TASK_UNITS)
  expect(cutTask('')).toBe('')
})

test('widestKey: the identity of the widest values the mode depends on — the same for the same rooms in any order (a pin reorders them), different once a mark, a model, an activity or a name moved them', () => {
  const rooms = probeRooms()
  const key = widestKey(officeWidest(rooms))
  expect(widestKey(officeWidest([...rooms].reverse()))).toBe(key)
  expect(widestKey(officeWidest(rooms.map(r => ({ ...r, pinned: !r.pinned, title: 'x' }))))).toBe(key)
  expect(widestKey(officeWidest(rooms.map(r => ({ ...r, agents: [...r.agents].reverse() }))))).toBe(key)
  // another ⭐ (the probe's office has a ⭐ and a ❌: the mark is two cells either way): the same; no badge at all (the marks one
  // cell): another key, and one ⭐ among the plain marks another again
  expect(widestKey(officeWidest(rooms.map(r => ({ ...r, agents: r.agents.map(a => a.id === 'owl' ? { ...a, star: 9 } : a) }))))).toBe(key)
  const plain = rooms.map(r => ({ ...r, agents: r.agents.map(a => ({ ...a, star: 0, failed: false, longRunning: false })) }))
  expect(widestKey(officeWidest(plain))).not.toBe(key)
  expect(widestKey(officeWidest(plain.map(r => ({ ...r, agents: r.agents.map(a => a.id === 'owl' ? { ...a, star: 9 } : a) }))))).not.toBe(widestKey(officeWidest(plain)))
  // a longer activity word, a longer model, a new name: another key
  expect(widestKey(officeWidest(rooms.map(r => ({ ...r, agents: r.agents.map(a => a.id === 'owl' ? { ...a, act: '🔌 claude-in-chrome' } : a) }))))).not.toBe(key)
  expect(widestKey(officeWidest(rooms.map(r => ({ ...r, agents: r.agents.map(a => a.id === 'owl' ? { ...a, model: 'Sonnet 4.5.1' } : a) }))))).not.toBe(key)
  expect(widestKey(officeWidest(rooms.map(r => ({ ...r, agents: r.agents.map(a => a.id === 'owl' ? { ...a, name: 'The owl of the night' } : a) }))))).not.toBe(key)
  expect(widestKey(officeWidest([]))).toBe(widestKey(officeWidest([])))
})

test('nb / NBSP (round 9): every plain space of a one-line value a no-break space, the width unchanged — a Text drawn from it can never wrap; restWord: an activity\'s word after its emoji', () => {
  expect(NBSP).toBe(' ')
  expect(NBSP.length).toBe(1)
  expect(NBSP.charCodeAt(0)).toBe(0xa0)
  expect(nb('🦉 הינשוף')).toBe(`🦉${NBSP}הינשוף`)
  expect(nb('a b  c')).toBe(`a${NBSP}b${NBSP}${NBSP}c`)
  expect(nb('')).toBe('')
  expect(nb('x')).toBe('x')
  expect(nb('עוד 2 שסיימו ◂')).not.toContain(' ')
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

/**
 * The line-break classes of UAX #14 that nb() handles (SP the space; GL the no-break forms, the combining grapheme joiner
 * among them; BA the breaking hyphens, dashes and spaces, the vertical bar and the maqaf; B2 the em dash; HY the hyphen-minus;
 * SY the slash; ZW the zero-width space; EX the exclamation and question marks; CL the closing brace; IN the ellipsis; CP the
 * closing parenthesis and bracket; PR the plus; NU a digit; AL a letter and the ASCII symbols of that class, the divides sign
 * U+2223 too — an AI character, which LB1 resolves to AL), XX anything else.
 */
type LbClass = 'SP' | 'GL' | 'BA' | 'B2' | 'HY' | 'SY' | 'ZW' | 'EX' | 'CL' | 'IN' | 'CP' | 'PR' | 'NU' | 'AL' | 'XX'
function lbClass(c: string): LbClass {
  if (c === ' ') return 'SP'
  if ([NBSP, '\u{2007}', '\u{202F}', '\u{2011}', '\u{34F}'].includes(c)) return 'GL'
  if (c === '\t' || ['\u{2010}', '\u{2012}', '\u{2013}', '\u{AD}', '|', '\u{5BE}'].includes(c) || /\p{Zs}/u.test(c)) return 'BA'
  if (c === '\u{2014}') return 'B2'
  if (c === '-') return 'HY'
  if (c === '/') return 'SY'
  if (c === '\u{200B}') return 'ZW'
  if (c === '!' || c === '?') return 'EX'
  if (c === '}') return 'CL'
  if (c === '\u{2026}') return 'IN'
  if (c === ')' || c === ']') return 'CP'
  if (c === '+') return 'PR'
  if (/\p{Nd}/u.test(c)) return 'NU'
  if (/\p{L}/u.test(c) || '#&*<=>@^_`~\u{2223}'.includes(c)) return 'AL'
  return 'XX'
}
/**
 * UAX #14's pair rules over those classes (LB7, LB8, LB12, LB12a, LB13, LB17, LB18, LB21, LB22, LB24, LB25, LB30 and the
 * default, LB31, after HY, BA, B2, SY, EX, CL and IN): is there a line-break opportunity between `a` and `b`? (A pair of
 * other classes answers no: not nb's business — two letters, LB23 / LB28, hold.)
 */
function breaksBetween(a: string, b: string): boolean {
  const ca = lbClass(a)
  const cb = lbClass(b)
  if (ca === 'ZW') return true                                       // LB8   ZW ÷
  if (cb === 'SP' || cb === 'ZW') return false                       // LB7   × SP, × ZW
  if (ca === 'GL') return false                                      // LB12  GL ×
  if (cb === 'GL') return ca === 'SP' || ca === 'BA' || ca === 'HY'  // LB12a [^SP BA HY] × GL (SP ÷ GL: LB18)
  if (['SY', 'EX', 'CL', 'CP'].includes(cb)) return false            // LB13  × SY, × EX, × CL, × CP (after a space too)
  if (ca === 'SP') return true                                       // LB18  SP ÷
  if (ca === 'B2' && cb === 'B2') return false                       // LB17  B2 × B2
  if (cb === 'BA' || cb === 'HY') return false                       // LB21  × BA, × HY
  if (cb === 'IN') return false                                      // LB22  × IN
  if (ca === 'HY' || ca === 'SY') return cb !== 'NU'                 // LB25  HY × NU, SY × NU; else a break after
  if (ca === 'BA' || ca === 'B2' || cb === 'B2') return true         // a break after BA and B2, before B2
  if (ca === 'CP' || ca === 'PR') return false                       // LB30  CP × (AL | NU); LB24, LB25  PR × (AL | NU)
  if (ca === 'EX' || ca === 'CL' || ca === 'IN') return cb === 'AL' || cb === 'NU'   // LB31: no rule holds them before a letter or a digit
  return false
}
/** The places in `s` (between its code points) where a line may break among nb's classes. */
function breakOpportunities(s: string): number[] {
  const cps = [...s]
  const out: number[] = []
  for (let i = 0; i + 1 < cps.length; i++) if (breaksBetween(cps[i]!, cps[i + 1]!)) out.push(i)
  return out
}

test('nb (live check 5, pre-check 6): no line-break opportunity left among the spaces, hyphens, dashes, slashes, vertical bars and the marks a line breaks after (! ? } …) of a one-line value (UAX #14) — the no-break hyphen U+2011, the division slash U+2215, the divides sign U+2223, the glue U+034F after a mark, the zero-width space and the soft hyphen gone; a hyphen or a slash before a digit kept (no break there, and a number keeps its bidi run); nothing it writes is a control or a format character, nothing a surface refuses; the width unchanged; idempotent', () => {
  expect(NBHY.codePointAt(0)).toBe(0x2011)
  expect(NBSLASH.codePointAt(0)).toBe(0x2215)
  // the classifier itself: the opportunities a plain value holds
  expect(breakOpportunities('Plan the static-registry')).toEqual([4, 8, 15])
  expect(breakOpportunities('a/b 3-4 20/10 -5')).toEqual([1, 3, 7, 13])
  expect(breakOpportunities(`a${NBSP}-${NBSP}b`)).toEqual([2])          // HY ÷ GL: a spaced hyphen breaks after itself
  expect(breakOpportunities(`a${NBSP}\u{2014}${NBSP}b`)).toEqual([])   // the em dash between no-break spaces holds
  expect(breakOpportunities('a\u{2014}b')).toEqual([0, 1])
  // pre-check 6: the vertical bar (BA) breaks after itself, before a no-break space too; the exclamation and question marks
  // (EX), the closing brace (CL) and the ellipsis (IN) break after themselves before a letter or a digit, never before
  // themselves (not even after a space: LB13, LB22); a closing parenthesis or bracket (CP) and a plus (PR) hold before a
  // letter or a digit; the divides sign is a letter's class (AL); the maqaf (BA) breaks after itself before a Hebrew letter
  // (LB21a holds it only before another letter since Unicode 15.1)
  expect(breakOpportunities(`a|b${NBSP}a${NBSP}|${NBSP}b`)).toEqual([1, 6])
  expect(breakOpportunities(`a!b${NBSP}?id=3${NBSP}{x}y${NBSP}wait\u{2026}then${NBSP}x!1`)).toEqual([1, 4, 12, 19, 26])
  expect(breakOpportunities('a !b ?')).toEqual([2])
  expect(breakOpportunities(`f(x)y${NBSP}[0]1${NBSP}+3${NBSP}+a`)).toEqual([])
  expect(breakOpportunities(`a\u{2223}b${NBSP}\u{5D0}\u{5BE}\u{5D1}`)).toEqual([5])
  // Asaf's screenshot of 20.10: the title broke at its hyphen although its spaces were no-break
  expect(nb('Plan the static-registry move')).toBe(`Plan${NBSP}the${NBSP}static${NBHY}registry${NBSP}move`)
  expect(nb('claude-in-chrome')).toBe(`claude${NBHY}in${NBHY}chrome`)
  expect(nb('src/hooks/ui.tsx')).toBe(`src${NBSLASH}hooks${NBSLASH}ui.tsx`)
  // before a digit a hyphen or a slash is kept: no break there (HY × NU, SY × NU), and `3-4` / `20/10` stay one number run
  expect(nb('20/10 3-4 -5 v-2')).toBe(`20/10${NBSP}3-4${NBSP}-5${NBSP}v-2`)
  // the hyphen U+2010 and the en / figure dashes: a no-break hyphen (between letters, digits or spaces alike), kept at the end
  expect(nb('a\u{2010}b a\u{2013}b 10\u{2012}20 x \u{2013} y z\u{2013}')).toBe(`a${NBHY}b${NBSP}a${NBHY}b${NBSP}10${NBHY}20${NBSP}x${NBSP}${NBHY}${NBSP}y${NBSP}z\u{2013}`)
  // the em dash between letters a no-break hyphen; between no-break spaces it holds and is kept
  expect(nb('a\u{2014}b a \u{2014} b')).toBe(`a${NBHY}b${NBSP}a${NBSP}\u{2014}${NBSP}b`)
  // a slash before a no-break space or at the end holds (SY × GL)
  expect(nb('and / or x/')).toBe(`and${NBSP}/${NBSP}or${NBSP}x/`)
  // every breaking space a no-break one; the zero-width space and the soft hyphen (both Cf, never drawn) removed
  expect(nb('a\tb\u{2003}c\u{3000}d\u{202F}e\u{2007}f')).toBe(`a${NBSP}b${NBSP}c${NBSP}d\u{202F}e\u{2007}f`)
  expect(nb('re\u{AD}use x\u{200B}y')).toBe(`reuse${NBSP}xy`)
  // a Hebrew value: the spaced hyphen of a sentence a no-break hyphen, the Hebrew rule as before
  expect(nb('זו הדגמה - הסוכנים לא אמיתיים')).toBe(`זו${NBSP}הדגמה${NBSP}${NBHY}${NBSP}הסוכנים${NBSP}לא${NBSP}אמיתיים`)
  expect(hebrewRuleOk(nb('זו הדגמה - הסוכנים לא אמיתיים'))).toBe(true)
  // pre-check 6: a vertical bar the divides sign U+2223 (∣: bidi ON, as `|` is; an AL character, so no break on either side)
  // and the maqaf a no-break hyphen — both kept at the end, as the dashes are; an exclamation or a question mark, a closing
  // brace or an ellipsis glued to what follows it by the combining grapheme joiner U+034F (GL: no break before or after it; a
  // nonspacing mark, invisible, no cell) — unless the end, a no-break space or a mark that holds already follows (LB12a, LB13,
  // LB19, LB21, LB22: no glue at `!!`, `?)`, `!'`); a closing parenthesis or bracket and a plus kept (they hold already)
  expect(NBBAR.codePointAt(0)).toBe(0x2223)
  expect(GLUE.codePointAt(0)).toBe(0x34f)
  expect(nb('build | test | ship|')).toBe(`build${NBSP}${NBBAR}${NBSP}test${NBSP}${NBBAR}${NBSP}ship|`)
  expect(nb('תל\u{5BE}אביב א\u{5BE}')).toBe(`תל${NBHY}אביב${NBSP}א\u{5BE}`)
  expect(nb('GET /api/users?id=3')).toBe(`GET${NBSP}${NBSLASH}api${NBSLASH}users?${GLUE}id=3`)
  expect(nb('x!=null wow!! ${dir}s wait\u{2026}then done! ok? end\u{2026}')).toBe(`x!${GLUE}=null${NBSP}wow!!${NBSP}\${dir}${GLUE}s${NBSP}wait\u{2026}${GLUE}then${NBSP}done!${NBSP}ok?${NBSP}end\u{2026}`)
  expect(nb('Ship it!🚀 ok?) "no!"')).toBe(`Ship${NBSP}it!${GLUE}🚀${NBSP}ok?)${NBSP}"no!"`)
  expect(nb('f(x)y [0]1 +3 a+b')).toBe(`f(x)y${NBSP}[0]1${NBSP}+3${NBSP}a+b`)
  expect(hebrewRuleOk(nb('בנייה | בדיקה | שחרור'))).toBe(true)
  expect(hebrewRuleOk(nb('מה קרה?!סיימנו'))).toBe(true)
  const nasty = [
    'Plan the static-registry move and the v2 config rollout', 'src/hooks/office-layout.ts — the cut', 'a \u{2013} b\u{2014}c / d-e',
    'x\u{200B}y\u{AD}z\u{2003}w\t1-2 3/4 -5', 'בדיקת תיאטרון-הסוכנים / שיחה \u{2013} חדשה', '🔌 claude-in-chrome', '👨‍💻 a-b', '--a//b--', '',
    'build | test|ship', 'GET /api/users?id=3&x=1', 'x!=null wow!!a ${dir}s wait\u{2026}then 3!4 }1 !/a ?|b', 'תל\u{5BE}אביב | מה?!כן\u{2026}לא',
    'f(x)y [0]1 +3 a+b ?) "no!"', '|!?}\u{2026}\u{5BE}', 'a|', '!', '\u{2026}\u{2026}x',
  ]
  for (const s of nasty) {
    const v = nb(s)
    expect(breakOpportunities(v), `${s} → ${v}`).toEqual([])
    expect(nb(v), s).toBe(v)                                            // idempotent
    expect(v, s).not.toMatch(REFUSED_RE)
    expect(cleanAgentText(v), s).toBe(v)                                // the poll's text gate leaves it as it is
    // the characters nb writes are no control and no format character (a ZWJ of an emoji sequence is the input's own)
    for (const c of new Set([...v].filter(c => !s.includes(c)))) expect(c, `${s}: U+${c.codePointAt(0)!.toString(16)}`).not.toMatch(/\p{Cc}|\p{Cf}/u)
    expect(textWidth(v), s).toBe(textWidth(s.replace(/[\u{200B}\u{AD}]/gu, '')))
  }
})

test('geometry (probe rounds 8-9; live check 6): ONE reading column — the pane less PANE_GUTTER cells (a cell at each edge: no border ever touches the pane\'s edge — the Client lays out a hair wider than the visible pane, and the cards\' right border was clipped), frozen at CENTRE_AT cells and centred by a left margin; the card\'s padding 2 from WIDE_FROM (the inner width dips by a cell there); the structure flags at their thresholds, measured on the column; the table\'s budget by FIT, the chrome line by LINE_FIT', () => {
  expect([MODEL_FULL_FROM, ONE_LINE_FROM, WIDE_FROM, CENTRE_AT, TITLE_MIN, HYSTERESIS, NAME_MIN, NAME_FLOOR, TASK_MAX, PANE_GUTTER]).toEqual([60, 64, 80, 100, 16, 2, 8, 3, 24, 2])
  expect(geometry(45)).toEqual({ columns: 45, W: 43, px: 1, frame: 4, inner: 39, budget: 29, L: 35, oneLine: false, full: false, wide: false, centred: false, margin: 1 })
  expect(geometry(53)).toMatchObject({ W: 51, px: 1, frame: 4, inner: 47, budget: 35, L: 42 })   // the probe's column: round 6 fit four columns of 32 cells in 47
  expect(geometry(61)).toMatchObject({ full: false })
  expect(geometry(62)).toMatchObject({ full: true, oneLine: false })
  expect(geometry(65)).toMatchObject({ oneLine: false })
  expect(geometry(66)).toMatchObject({ oneLine: true, wide: false })
  expect(geometry(81)).toMatchObject({ px: 1, frame: 4, inner: 75, wide: false })
  expect(geometry(82)).toMatchObject({ W: 80, px: 2, frame: 6, inner: 74, wide: true, centred: false, margin: 1 })
  expect(geometry(100)).toMatchObject({ W: 98, inner: 92, centred: false, margin: 1 })
  expect(geometry(101)).toMatchObject({ W: 99, inner: 93, centred: false, margin: 1 })
  expect(geometry(102)).toMatchObject({ W: 100, inner: 94, budget: 70, L: 83, centred: true, margin: 1 })
  expect(geometry(103)).toMatchObject({ W: 100, margin: 1 })
  expect(geometry(104)).toMatchObject({ W: 100, margin: 2 })
  expect(geometry(200)).toMatchObject({ W: 100, inner: 94, budget: 70, L: 83, oneLine: true, full: true, wide: true, centred: true, margin: 50 })
  for (let c = 24; c <= 200; c++) {
    const g = geometry(c)
    expect(g.W, `${c}`).toBe(Math.min(c - PANE_GUTTER, CENTRE_AT))
    expect(g.frame, `${c}`).toBe(2 + 2 * g.px)
    expect(g.inner, `${c}`).toBe(g.W - g.frame)
    expect(g.budget, `${c}`).toBe(fitCells(g.inner))
    expect(g.L, `${c}`).toBe(fitLine(g.W))
    expect([g.oneLine, g.full, g.wide, g.centred], `${c}`).toEqual([g.W >= ONE_LINE_FROM, g.W >= MODEL_FULL_FROM, g.W >= WIDE_FROM, g.W >= CENTRE_AT])
    // the column centred, a cell at least on each side: the margins differ by a cell at most, the column never at an edge
    expect(g.margin, `${c}`).toBe(Math.floor((c - g.W) / 2))
    expect(g.W, `${c}`).toBeLessThanOrEqual(c - 2)
    expect(g.margin, `${c}`).toBeGreaterThanOrEqual(1)
    expect(c - g.margin - g.W, `${c}`).toBeGreaterThanOrEqual(1)
    expect(c - g.W - 2 * g.margin, `${c}`).toBeLessThanOrEqual(1)
  }
  // a pane narrower than the floor never throws and keeps its numbers sane
  for (const c of [1, 2, 3, 4, 8, 12, 23]) { const g = geometry(c); expect(g.W).toBeGreaterThanOrEqual(0); expect(g.budget).toBeGreaterThanOrEqual(0); expect(g.L).toBeGreaterThanOrEqual(0); expect(g.margin).toBeGreaterThanOrEqual(0) }
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
  expect(countsFor(r, atColumn(51))).toBe(counts)
  expect(countsFor(r, atColumn(45))).toBe(counts)
  expect(countsFor(r, atColumn(45), true)).toBe(counts)
  expect(countsFor(r, atColumn(44), true)).toBe('🟢3 ⏳1')
  expect(countsFor(r, atColumn(40))).toBe('🟢3 ⏳1')
  expect(countsFor(r, atColumn(36))).toBe('🟢3')
  expect(countsFor(r, atColumn(24))).toBe('🟢3')
  expect(countsFor({ run: 0, stale: 0, done: 4 }, atColumn(51))).toBe('🟢0 ✅4')
  expect(countsFor({ run: 2, stale: 0, done: 0 }, atColumn(24))).toBe('🟢2')
  for (let c = 24; c <= 200; c++) {
    const g = geometry(c)
    const cf = countsFor(r, g)
    expect([counts, '🟢3 ⏳1', '🟢3'], `${c}`).toContain(cf)
    // the first form that leaves the title TITLE_MIN cells, else the shortest; a wider pane never shows less
    if (cf !== '🟢3') expect(fitCells(g.inner - 2 - textWidth(cf) - TITLE_GAP), `${c}`).toBeGreaterThanOrEqual(TITLE_MIN)
    if (c > 24) expect(textWidth(cf), `${c}`).toBeGreaterThanOrEqual(textWidth(countsFor(r, geometry(c - 1))) - (c === WIDE_FROM + PANE_GUTTER ? 8 : 0))
  }
  // the probe's gap of two between the title and the counts, the title flush at the reading edge (no pin drawn): 51 columns
  // leave 47 - 2 (the title's padding) - 11 (counts) - 2 (gap) = 32 → 26 cells by LINE_FIT, and the probe's third room reads
  // `בדיקת תיאטרון הסוכנים…` as it did on the desktop (round 9); pinned, the 📌 and its gap take 4 more cells (28 → 23)
  expect(TITLE_GAP).toBe(2)
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', atColumn(51), counts)).toBe('בדיקת תיאטרון הסוכנים…')
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', atColumn(51), counts, true)).toBe('בדיקת תיאטרון הסוכנים…')
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', atColumn(44), counts, true)).toBe('בדיקת תיאטרון…')
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', atColumn(36), counts)).toBe('בדיקת תיאטרון…')
  expect(cutTitle('תיאטרון הסוכנים', atColumn(51), counts)).toBe('תיאטרון הסוכנים')
  expect(cutTitle('abcdefghijklmnopqrstuvwxyz', atColumn(24), counts)).toBe('abcdefg…')   // the floor of 8
  // BOLD LATIN (live check 5): a Latin-dominant title is cut by FIT, a Hebrew one by LINE_FIT — at 44 columns beside `🟢1 ✅1` the
  // line leaves 40 - 2 - 7 - 2 = 29 cells: the Hebrew title takes up to 24 (LINE_FIT), the Latin one up to 21 (FIT)
  expect(latinDominant('Plan the static-registry move')).toBe(true)
  expect(latinDominant('בדיקת תיאטרון הסוכנים')).toBe(false)
  expect(latinDominant('בדיקת Claude Code')).toBe(true)        // ten Latin letters, five Hebrew
  expect(latinDominant('תריץ 4 סוכני משנה ב-CI')).toBe(false)
  expect(latinDominant('42 🎭 ·')).toBe(false)
  expect(cutTitle('Plan the static-registry move and the v2 config rollout', atColumn(44), '🟢1 ✅1')).toBe('Plan the static-regi…')
  expect(cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', atColumn(44), '🟢1 ✅1')).toBe('בדיקת תיאטרון הסוכנים…')
  for (let columns = 24; columns <= 200; columns++) {
    const g = geometry(columns)
    for (const pinned of [false, true]) {
      const room = g.inner - 2 - (pinned ? EMOJI_CELLS + TITLE_GAP : 0) - textWidth('🟢1 ✅1') - TITLE_GAP
      const latin = cutTitle('Plan the static-registry move and the v2 config rollout for the whole office of the agents', g, '🟢1 ✅1', pinned)
      const hebrew = cutTitle('בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל ועוד כמה מילים בסוף', g, '🟢1 ✅1', pinned)
      expect(textWidth(latin), `${columns} ${latin}`).toBeLessThanOrEqual(Math.max(8, fitCells(room)))
      expect(textWidth(hebrew), `${columns} ${hebrew}`).toBeLessThanOrEqual(Math.max(8, fitLine(room)))
    }
  }
  // the sweep: a title one cell longer than the widest room of the sweep (the frozen column, unpinned: 94 - 15 = 79 → 65 cells), so
  // every cut drops something and carries the …; each (columns, pinned) cut once, its width reused for the pinned-vs-unpinned check
  const countsWidth = textWidth(counts)
  const long = 'x'.repeat(fitLine(atColumn(200).inner - 2 - countsWidth - TITLE_GAP) + 1)
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
  // (no pin zone: the pin is a native Button on every title since phase B, and the model maps no pointer — see the officeModel
  // tests: every room's title is cut with the pin's cells reserved)
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
  for (const w of ['הצג שסיימו', 'צליל', 'הגדרות', 'דמו', 'יציאה']) expect(hebrewRuleOk(w)).toBe(true)
})

/** The UBA's European terminators a value could hold (bidi class ET): # $ %, ¢ £ ¤ ¥, °, ±, ‰ ‱ ′ ″ ‴, the currency signs, the minus sign. */
const ET_RE = /^[#-%¢-¥°±‰-‴₠-⃏−]$/u
/**
 * THE READER'S VIEW of a one-line value as the desktop draws it — ONE LEFT-TO-RIGHT PARAGRAPH, no bidi control in it (the
 * desktop refuses them): the UBA's rules for such a line (the old cell grid's visualRtlReading, a1c9731, over a string). A
 * Hebrew letter is R, another script's letter L, a digit EN — a terminator beside a digit joins its number (W5), one alone is
 * a neutral (W6); a number after Hebrew is AN, else L (W2, W7: sos is L) — a stretch of neutrals (a no-break space among
 * them) between two of one direction takes it, else the paragraph's L (N1, N2); the runs of R (with their numbers, level 2)
 * are mirrored in place. `visual` is the glyphs left to right; `reading` what a Hebrew reader meets from the right, token by
 * token: a mirrored stretch back in logical order, any other token (a number, a Latin word, a mark) as it is.
 */
function ltrParagraph(value: string): { visual: string[]; reading: string } {
  const gl = glyphs(value.split(NBSP).join(' ')).map(g => g.ch)
  type T = 'L' | 'R' | 'EN' | 'ET' | 'AN' | 'N'
  const types: T[] = gl.map(ch => (/\p{Script=Hebrew}/u.test(ch) ? 'R' : /^\p{L}/u.test(ch) ? 'L' : /^\p{Nd}$/u.test(ch) ? 'EN' : ET_RE.test(ch) ? 'ET' : 'N'))
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
  return { visual: visual.filter(ch => ch !== ' '), reading: tokens.reverse().join(' ') }
}

test('ltrParagraph models the desktop\'s one LTR paragraph: a trailing icon after Hebrew lands at the right and is read first (the toolbar\'s `הצג שסיימו ☐`), a leading one at the left and is read last; a number inside Hebrew rides inside, a leading one is read after the words', () => {
  expect(ltrParagraph(nb('הצג שסיימו ☐'))).toEqual({ visual: ['ו', 'מ', 'י', 'י', 'ס', 'ש', 'ג', 'צ', 'ה', '☐'], reading: '☐ הצג שסיימו' })
  expect(ltrParagraph(nb('▸ עוד 4 שסיימו')).reading).toBe('עוד 4 שסיימו ▸')
  expect(ltrParagraph(nb('סגירה ✕')).reading).toBe('✕ סגירה')
  expect(ltrParagraph(nb('עוד 12 שסיימו')).reading).toBe('עוד 12 שסיימו')
  expect(ltrParagraph('4 תמלילים').reading).toBe('תמלילים 4')
  expect(ltrParagraph('נוצלו 42% ממכסת 5 השעות').reading).toBe('נוצלו 42% ממכסת 5 השעות')
})

test('THE MORE LINE reads arrow first (live check 7 review): laid through iconLabel, the Hebrew pane\'s `עוד 4 שסיימו ◂` / `הסתר שסיימו ▾`, drawn as one LTR paragraph, read `◂ עוד 4 שסיימו` / `▾ הסתר שסיימו` — the arrow the line\'s RIGHTMOST glyph in both states (its reading edge, where the label is aligned: the arrow stays put as the label\'s width changes, a two-digit count too), the collapsed one pointing the Hebrew reader\'s way (◂, MORE_MARK.rtl, as FOCUS_MARK has its RTL form); the English line unchanged', () => {
  expect(MORE_MARK).toEqual({ rtl: '◂', ltr: '▸' })
  expect(LESS_MARK).toBe('▾')
  const he = I18N.he
  const lineOf = (over: Partial<OfficeRoom>, p: Partial<OfficeProps> = {}) => officeModel(props({ rooms: [room({ moreDone: 4, ...over })], columns: 51 + PANE_GUTTER, ...p })).rooms[0]!.more
  for (const [label, showDone, arrow] of [[he.moreDoneN(4), false, '◂'], [he.moreDoneN(12), false, '◂'], [he.hideDone, true, '▾']] as const) {
    const line = lineOf({ showDone, moreLabel: label })
    expect(line, label).toBe(nb(iconLabel(arrow, label, true)))
    const { visual, reading } = ltrParagraph(line)
    expect(reading, label).toBe(`${arrow} ${label}`)
    expect(visual.at(-1), label).toBe(arrow)
    expect(hebrewRuleOk(label), label).toBe(true)
    expect(line, label).not.toMatch(REFUSED_RE)
  }
  // the English pane: the arrow leads, at the line's left edge (its reading edge there) — ▸ collapsed, ▾ open
  const en = I18N.en
  expect(lineOf({ moreLabel: en.moreDoneN(4) }, { lang: 'en', rtl: false })).toBe(nb(`▸ ${en.moreDoneN(4)}`))
  expect(lineOf({ showDone: true, moreLabel: en.hideDone }, { lang: 'en', rtl: false })).toBe(nb(`▾ ${en.hideDone}`))
  expect(ltrParagraph(lineOf({ moreLabel: en.moreDoneN(4) }, { lang: 'en', rtl: false })).visual[0]).toBe('▸')
  // the arrows are one cell each (the line's width the same in either state's arrow)
  for (const a of ['◂', '▸', '▾']) expect(textWidth(a)).toBe(1)
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
  const rank = (c: number, last: number | null) => chooseMode(w, atColumn(c), last).rank
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
  expect(chooseMode(w, atColumn(60), 0)).toEqual({ rank: 0, word: true, model: 'full', nameMax: NAME_MAX })
  expect(chooseMode(w, atColumn(59), 0)).toEqual({ rank: 0, word: true, model: 'family', nameMax: NAME_MAX })
  for (let c = 24; c <= 200; c++) {
    // narrowing is the fresh choice (no hysteresis holds a mode that stopped fitting); widening is never richer than it
    expect(narrowing[c], `${c}`).toBe(rank(c, null))
    expect(widening[c]!, `${c}`).toBeGreaterThanOrEqual(narrowing[c]!)
    // a mode regained (every rank is a regain from the floor) is the ladder's own at the real budget: its names' cap is not the reduced one's
    const regained = chooseMode(w, atColumn(c), 5)
    expect(regained, `${c}`).toEqual(modeAt(w, regained.rank, atColumn(c).budget, atColumn(c).full))
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
  expect(officeModel(props({ rooms: probeRooms(), columns: 79 + PANE_GUTTER })).floors).toBeNull()
  expect(officeModel(props({ rooms: probeRooms(), columns: 80 + PANE_GUTTER })).floors).toEqual(floorsOf(w, officeModel(props({ rooms: probeRooms(), columns: 80 + PANE_GUTTER })).mode))
  expect(officeModel(props({ rooms: probeRooms(), columns: 200 })).floors).not.toBeNull()
})

test('cardLines / rowCount: a card is CARD_LINES around its rows, MORE_LINES more with the more / hide line; rowCount counts the office without building a row and equals the line map\'s length across shapes, widths and both directions', { timeoutMs: 30_000 }, () => {
  expect(CARD_LINES).toBe(7)
  expect(MORE_LINES).toBe(1)   // (live check 7, Q3: the line directly under the title, no blank line of its own)
  expect(cardLines(2, false)).toBe(9)
  expect(cardLines(2, true)).toBe(10)
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

test('officeModel: the line map of a card — border, pad, title, [the more line DIRECTLY UNDER THE TITLE: live check 7, Q3], a BLANK line (no rule: round 9), a row per agent, pad, border, gap — each line one row tall by construction; the rows carry the probe\'s strings (the activity split into its emoji and its word), no plain space and no time; the more line\'s arrow follows its state', () => {
  const r = room({ title: 'תיאטרון הסוכנים', run: 3, stale: 1, done: 2, moreLabel: 'עוד 2 שסיימו', agents: [
    ag('lead', 0, { name: 'הינשוף', act: '🤔 חושב', task: 'תכנון המעבר לרישום הסטטי' }),
    ag('a1', 1, { name: 'הרופא', model: 'Sonnet 4.5', act: '✏️ עורך' }),
    ag('w', 2, { name: 'הזאב', status: 'stale', act: '💤 ממתין' }),
    ag('m', 3, { name: 'המכונאי', status: 'done', star: 7000, act: '✅ סיים' }),
  ] })
  const p = props({ rooms: [r], columns: 51 + PANE_GUTTER })
  const m = officeModel(p)
  expect(kinds(m.lines)).toEqual(['border', 'pad', 'title', 'more', 'blank', 'row', 'row', 'row', 'row', 'pad', 'border', 'gap'])
  expect(m.lines.every(l => l.room === 'sess-a')).toBe(true)
  expect(m.lines.filter(l => l.kind === 'row').map(l => l.agent)).toEqual(['lead', 'a1', 'w', 'm'])
  expect(m.lines.filter(l => l.kind !== 'row').every(l => l.agent === null)).toBe(true)
  expect(m.geo).toEqual(atColumn(51))
  expect(m.mode).toEqual({ rank: 0, word: true, model: 'family', nameMax: NAME_MAX })   // the probe's width draws the word and the family
  expect(m.floors).toBeNull()
  const room0 = m.rooms[0]!
  expect(room0).toMatchObject({ id: 'sess-a', top: 0, height: 12, titleAt: 2, moreAt: 3, blankAt: 4, title: 'תיאטרון הסוכנים', counts: '🟢3 ⏳1 ✅2', pinned: false, more: nb('עוד 2 שסיימו ◂') })
  expect(room0.rows.map(x => x.y)).toEqual([5, 6, 7, 8])
  // the arrow follows the state: ▾ once the room shows every finished (its line then hides them); read arrow first (iconLabel)
  expect(officeModel(props({ rooms: [{ ...r, showDone: true, moreLabel: 'הסתר שסיימו' }], columns: 51 + PANE_GUTTER })).rooms[0]!.more).toBe(nb('הסתר שסיימו ▾'))
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
  expect(room0.rows.every(x => !x.focus)).toBe(true)
  for (const x of room0.rows) for (const v of [x.status, x.who, x.model, x.actEmoji, x.actWord, x.task]) { expect(v).not.toMatch(/⏱|′|min|\d+ דק/); expect(v).not.toMatch(LONE_SURROGATE); expect(v).not.toContain(' ') }
  expect(officeModel(props({ rooms: [r], columns: 60 + PANE_GUTTER })).rooms[0]!.rows.map(x => x.model)).toEqual(['Opus 5.5', 'Sonnet 4.5', 'Opus 5.5', 'Opus 5.5'])
  // LTR: the status marks the same
  const ltr = officeModel(props({ rooms: [r], columns: 51 + PANE_GUTTER, rtl: false }))
  expect(ltr.rooms[0]!.rows.map(x => x.status)).toEqual(['●', '●', '●', '⭐'])
  // THE FROZEN COLUMN: from CENTRE_AT the column is CENTRE_AT cells wide, centred by its margin
  const wide = officeModel(props({ rooms: [r], columns: 200 }))
  expect(wide.geo.margin).toBe(50)
  // no more label: no more line
  const plain = officeModel(props({ rooms: [room()] }))
  expect(kinds(plain.lines)).toEqual(['border', 'pad', 'title', 'blank', 'row', 'row', 'pad', 'border', 'gap'])
  expect(plain.rooms[0]).toMatchObject({ more: '', moreAt: -1, height: 9 })
  // two rooms: the second card starts after the first's gap; its lines name it
  const two = officeModel(props({ rooms: [room({ id: 'a' }), room({ id: 'b', agents: [ag('b1', 1)], pinned: true })] }))
  expect(two.rooms.map(x => [x.id, x.top, x.height])).toEqual([['a', 0, 9], ['b', 9, 8]])
  expect(two.lines.slice(9).every(l => l.room === 'b')).toBe(true)
  expect(two.rooms[1]!.pinned).toBe(true)
  // the output is deterministic
  expect(JSON.stringify(officeModel(p))).toBe(JSON.stringify(m))
})

test('officeModel: the decor — the focus a marker on the inner side of the status mark pointing in from the reading edge (the mark stays at the edge: no blank cell on the other rows); no hover (the desktop draws none inside a Client: paint probe 22.10), no pulse (live check 6: the ⭐ is the whole finish); nothing of it moves a line; the selection is no decor (the open drawer says which agent is selected)', () => {
  const rooms = [room({ id: 'a' }), room({ id: 'b', agents: [ag('b1', 1)], pinned: true })]
  const p = props({ rooms, selected: 'a1' })
  const base = officeModel(p)
  expect(base.rooms.map(x => x.pinned)).toEqual([false, true])
  expect(JSON.stringify(officeModel({ ...p, selected: null }))).toBe(JSON.stringify(base))
  expect(Object.keys(base.rooms[0]!.rows[0]!).sort()).toEqual(['actEmoji', 'actWord', 'bold', 'color', 'dim', 'failed', 'focus', 'id', 'model', 'status', 'task', 'who', 'y'])
  const focused = officeModel(p, decor({ focus: 'lead' }))
  // RTL: the marker LEADS the string (a Text with no Hebrew is laid left to right, so the mark is the rightmost glyph: at the
  // reading edge, where every other row's mark is); LTR: the marker trails. No row carries a blank for a focus it has not got.
  expect(focused.rooms[0]!.rows[0]).toMatchObject({ focus: true, status: `${FOCUS_MARK.rtl}●` })
  expect(focused.rooms[0]!.rows[1]).toMatchObject({ focus: false, status: '●' })
  expect(focused.rooms[0]!.rows[0]!.status.endsWith('●')).toBe(true)
  expect(officeModel({ ...p, rtl: false }, decor({ focus: 'lead' })).rooms[0]!.rows[0]!.status).toBe(`●${FOCUS_MARK.ltr}`)
  expect(officeModel({ ...p, rtl: false }, decor({ focus: 'lead' })).rooms[0]!.rows[1]!.status).toBe('●')
  expect(FOCUS_MARK).toEqual({ rtl: '‹', ltr: '›' })
  expect(focused.lines).toEqual(base.lines)
  expect(focused.rooms.map(x => [x.top, x.height, x.title, x.counts, x.pinned])).toEqual(base.rooms.map(x => [x.top, x.height, x.title, x.counts, x.pinned]))
  expect(focused.mode).toEqual(base.mode)
  expect(NO_DECOR).toEqual({ focus: null })
})

test('the pin is on every title: a room is pinned or not, the title cut leaves the pin its cells either way, and the decor is the focus alone', () => {
  // B is unpinned, carries every status and a long title. Two widths tell reserving the pin's cells from not reserving them:
  // at a 44-cell column the counts keep their ✅ beside no pin but lose it with the pin's four cells reserved; at a 47-cell
  // one the counts are whole either way and the title is cut a word shorter
  const long = 'בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל'
  for (const columns of [44 + PANE_GUTTER, 47 + PANE_GUTTER]) {
    const p = props({ columns, rooms: [room({ id: 'A', pinned: true, agents: [ag('a1', 1)] }), room({ id: 'B', pinned: false, title: long, run: 3, stale: 1, done: 2, agents: [ag('b1', 1)] })] })
    const m = officeModel(p)
    expect(m.rooms[0]!.pinned).toBe(true)
    expect(m.rooms[1]!.pinned).toBe(false)
    expect('pin' in m.rooms[0]!).toBe(false)
    expect('hits' in m).toBe(false)
    // the title of the unpinned room is cut as the pinned one's: the pin's cells are reserved on every card (decision 26)
    const geo = geometry(p.columns)
    const counts = countsFor(p.rooms[1]!, geo, true)
    expect(m.rooms[1]!.title, `${columns}`).toBe(nb(cutTitle(p.rooms[1]!.title, geo, counts, true)))
    expect(m.rooms[1]!.counts, `${columns}`).toBe(nb(counts))
    // (the fixture tells the two apart: the counts or the title of a pin-less cut would differ)
    const bare = countsFor(p.rooms[1]!, geo, false)
    expect([counts, cutTitle(long, geo, counts, true)], `${columns}`).not.toEqual([bare, cutTitle(long, geo, bare, false)])
    // the decor: the focus marks a row; nothing else is laid from the local state
    const f = officeModel(p, { focus: 'b1' })
    expect(f.rooms[1]!.rows[0]!.focus).toBe(true)
    expect(f.lines).toEqual(m.lines)
  }
})

test('officeModel: the weights (round 8) — working = a bold name; waiting = a regular name; finished = dim; a ❌ row keeps a regular name (flagged `failed`); the badges never go', () => {
  const r = room({ agents: [ag('run', 0), ag('wait', 1, { status: 'stale', act: '💤 ממתין' }), ag('fin', 2, { status: 'done', act: '✅ סיים' }), ag('bad', 3, { status: 'done', failed: true, act: '⛔ נכשל' }), ag('slow', 4, { longRunning: true })] })
  const rows = officeModel(props({ rooms: [r] })).rooms[0]!.rows
  expect(rows.map(x => [x.status, x.bold, x.dim, x.failed])).toEqual([['●', true, false, false], ['●', false, false, false], ['○', false, true, false], ['❌', false, true, true], ['⏰', true, false, false]])
})

// (some 40,000 assertions: 14-18 s alone, 47 s under a full suite at 90% CPU on 20.10 with no code change — the budget is load headroom)
test('officeModel: at every width 24..200, both directions, the office of the probe and a crowd — every one-line value holds no plain space (nb: it can never wrap) and no lone surrogate; the rows of every room follow the ONE office-wide mode (the model column everywhere or nowhere, the word everywhere or nowhere, every name within the cap); a narrow pane cuts the names whole-glyph with an ellipsis; the mode is the fresh choice (no hysteresis handed in)', { timeoutMs: 90_000 }, () => {
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

test('officeModel (live check 5): at every width 24..200, both directions, NO value drawn on one line holds a line-break opportunity among its spaces, hyphens, dashes, slashes, vertical bars and the marks a line breaks after (UAX #14: the title, the counts, the more line, the who, the model, the activity word, the task) — a title, a name, an activity, a model or a task with hyphens, slashes and dashes never breaks onto a second line', { timeoutMs: 30_000 }, () => {
  const rooms = [
    room({ id: 'plan', title: 'Plan the static-registry move and the v2 config rollout', run: 2, done: 1, moreLabel: 'עוד 2 שסיימו', agents: [
      ag('p1', 1, { name: 'Mary-Jane O/Neil', act: '🔌 claude-in-chrome', model: 'Sonnet 4.5-beta', task: 'fix the static-registry/config\u{2014}now' }),
      ag('p2', 2, { name: 'הסופר', act: '🔎 מחפש קוד', model: 'Fable 5.1', task: 'src/hooks/office-layout.ts \u{2013} cut' }),
      ag('p3', 3, { status: 'done', act: '✅ סיים', task: 'א-ב / ג\u{2010}ד 3-4 20/10' }),
    ] }),
    room({ id: 'he', title: 'בדיקת תיאטרון-הסוכנים / שיחה \u{2013} חדשה עם כמה סוכני-משנה', run: 1, agents: [ag('h1', 4, { name: 'זאב-ים', act: '✏️ עורך', task: 'תכנון-המעבר לרישום/הסטטי' })] }),
    // pre-check 6: the vertical bar, the maqaf and the marks a line breaks after (! ? } …)
    room({ id: 'bar', title: 'build|test | ship!now?yes wait\u{2026}then ${dir}s', run: 1, agents: [
      ag('b1', 5, { name: 'תל\u{5BE}אביב|יפו', act: '🔌 a|b!c', model: 'Opus?5', task: 'GET /api/users?id=3 | x!=null }1 wow\u{2026}ok' }),
    ] }),
  ]
  for (let columns = 24; columns <= 200; columns += columns < 70 ? 1 : 5) {
    for (const rtl of [true, false]) {
      const m = officeModel(props({ rooms, columns, rtl }))
      for (const rm of m.rooms) {
        for (const v of [rm.title, rm.counts, rm.more]) expect(breakOpportunities(v), `${columns} ${rtl} ${v}`).toEqual([])
        for (const x of rm.rows) for (const v of [x.who, x.model, x.actWord, x.task]) expect(breakOpportunities(v), `${columns} ${rtl} ${x.id} ${v}`).toEqual([])
      }
    }
  }
  // what they read as: the hyphen a no-break hyphen, the slash the division slash, a digit's hyphen and slash kept
  const wide = officeModel(props({ rooms, columns: 120 }))
  expect(wide.rooms[0]!.rows[0]!.actWord).toBe(`claude${NBHY}in${NBHY}chrome`)
  expect(wide.rooms[0]!.rows[2]!.task).toBe(nb(cutTask('א-ב / ג\u{2010}ד 3-4 20/10')))
  expect(wide.rooms[0]!.rows[2]!.task).toContain('3-4')
  // the bar a divides sign, the maqaf a no-break hyphen, the glue after a mark that a letter or a digit follows
  const bar = wide.rooms.find(r => r.id === 'bar')!
  expect(bar.rows[0]!.task).toBe(nb(cutTask('GET /api/users?id=3 | x!=null }1 wow\u{2026}ok')))
  expect(bar.rows[0]!.task).toContain(`?${GLUE}id=3${NBSP}${NBBAR}`)
  expect(bar.rows[0]!.who).toContain(`תל${NBHY}אביב${NBBAR}יפו`)
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
  const focused = officeModel(p, decor({ focus: 'b1' }), cache)
  expect(cache.builds).toBe(3)
  expect(focused.rooms[1]!.rows[0]!.status).toBe(`${FOCUS_MARK.rtl}●`)
  expect(JSON.stringify(focused)).toBe(JSON.stringify(officeModel(p, decor({ focus: 'b1' }))))
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
  // the hysteresis: at this office's word threshold (need 26: a 39-cell column) a `last` of a poorer mode keeps it — the rooms are
  // rebuilt (their texts follow the mode), and the model equals the uncached one with the same `last`
  const fresh = officeModel({ ...q, columns: 39 + PANE_GUTTER }, NO_DECOR, cache)
  expect(fresh.mode.rank).toBe(0)
  expect(cache.builds).toBe(10)
  const token = { rank: 1, key: widestKey(officeWidest(q.rooms)) }
  const held = officeModel({ ...q, columns: 39 + PANE_GUTTER }, NO_DECOR, cache, token)
  expect(held.mode.rank).toBe(1)
  expect(held.token).toEqual({ rank: 1, key: token.key })
  expect(cache.builds).toBe(13)
  expect(JSON.stringify(held)).toBe(JSON.stringify(officeModel({ ...q, columns: 39 + PANE_GUTTER }, NO_DECOR, undefined, token)))
  // THE TOKEN: a rank kept for other widest values (the content changed) is no hysteresis — the fresh choice, as a new instance's
  expect(officeModel({ ...q, columns: 39 + PANE_GUTTER }, NO_DECOR, cache, { rank: 1, key: 'other' }).mode.rank).toBe(0)
  expect(fresh.token).toEqual({ rank: 0, key: token.key })
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
