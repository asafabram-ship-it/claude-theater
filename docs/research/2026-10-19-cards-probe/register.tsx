import type { BoxProps, Register, RenderChildren, TextProps } from 'claude-code'

// Throwaway probe (19.10), round 8 — the FINAL DESIGN at every width (Asaf on round 7: "the display needs to be fixed when
// the pane is widened and narrowed, and see how else the UI can be improved"). Rounds 1-7 are in the design doc; this
// module keeps round 7's card (frame, rule, column-major table, one-line title) and adds the width behaviour:
//   · ONE reading column: W = min(columns, 100); from 100 cells it is frozen at 100 and centred (root alignItems center),
//     so a 200-cell pane shows the 100-cell drawing with empty margins.
//   · The frame never changes shape with the width: every line is a height-1 Box, every card border + paddingY 1 + title +
//     rule + rows + (blank + more), every overlay a fixed-height card. Width changes three things only:
//     (1) STRUCTURE at clean thresholds — 64 (toolbar + search on one line: chrome 6 → 4 rows), 80 (paddingX 1 → 2,
//         column floors across cards, the settings' shortcuts in two column pairs), 100 (W frozen, the dim task column);
//     (2) LABEL FORMS in the chrome by LINE_FIT: full meter → header words → toolbar words → short meter (header → the
//         search line's far edge) → tiny meter; never a clipped glyph;
//     (3) the TABLE MODE, decided ONCE per render for the whole office from the widest values across ALL rooms, with 2 cells
//         of hysteresis kept in `inst` (dropped the instant it stops fitting, regained only with 2 cells to spare):
//         activity word → model version → names down to 8 → model column → names below 8 (the floor, 24-27 only).
//   · Hierarchy by weight, not colour: working = bold name; waiting = regular name, dim activity; finished = all dim; a ❌
//     row keeps a regular name; the status mark is the one coloured glyph; the finish pulse is the ⭐ alone.
//   · Counts show non-zero statuses only and shrink before the title does; the activity is split into an emoji column and
//     a word column; the drawer has ONE dim status line; the 5h meter never vanishes above 24 cells.
// The probe's own controls: the toolbar Buttons work (finished / sound / settings), the search applies on Enter, and the
// dim `מגירה` Button on the last line cycles the drawer (closed → הינשוף working → המכונאי finished with a result).
const PANE = 'cards-probe'
const TITLE = 'בדיקת כרטיסים'

// ─── the metrics (the office's, copied: the probe imports nothing of the project) ───────────────────────────────────
const FIT = 0.75
const LINE_FIT = 0.83
const EMOJI_CELLS = 2
const NAME_MAX = 24
const NAME_MIN = 8
const NAME_FLOOR = 3
const TASK_MAX = 24
const MODEL_FULL_FROM = 60
const HOTKEYS_FROM = 60
const ONE_LINE_FROM = 64
const WIDE_FROM = 80
const CENTRE_AT = 100
const TITLE_MIN = 16
const RECENT_DONE = 2
const HYSTERESIS = 2
const CARD_BORDER = '#56607a'
const METER_FULL = '⏳ 5h ▰▱▱▱▱▱▱▱▱▱ 6% · 14:30'
const METER_SHORT = '⏳ 5h 6%'
const METER_TINY = '⏳ 6%'
const PLACEHOLDER = '🔍 חיפוש סוכנים'
const PLACEHOLDER_SHORT = '🔍 חיפוש'

type Status = 'running' | 'stale' | 'done'
const DOT: Readonly<Record<Status, string>> = { running: '#3fb950', stale: '#d29922', done: '#8b949e' }

// ─── glyph maths (office-layout's glyphs / textWidth / cut / cutWords, and office-chrome's wrapLines) ───────────────
const EMOJI_RE = /^\p{Extended_Pictographic}/u
const JOIN_RE = /^[\p{M}‍︎️\u{1F3FB}-\u{1F3FF}]$/u
type Glyph = { ch: string; w: number }
function glyphs(text: string): Glyph[] {
  const out: Glyph[] = []
  let joined = false
  for (const cp of text) {
    const last = out[out.length - 1]
    if (last && (joined || JOIN_RE.test(cp))) {
      last.ch += cp
      joined = cp === '‍'
      continue
    }
    out.push({ ch: cp, w: EMOJI_RE.test(cp) ? EMOJI_CELLS : 1 })
    joined = false
  }
  return out
}
function tw(text: string): number {
  let w = 0
  for (const g of glyphs(text)) w += g.w
  return w
}
function cut(s: string, max: number): string {
  if (max < 1) return ''
  const gs = glyphs(s)
  let w = 0
  let n = 0
  while (n < gs.length && w + gs[n]!.w <= max) { w += gs[n]!.w; n++ }
  if (n === gs.length) return s
  while (n > 0 && w + 1 > max) { n--; w -= gs[n]!.w }
  return gs.slice(0, n).map(g => g.ch).join('') + '…'
}
function cutWords(s: string, max: number): string {
  if (tw(s) <= max) return s
  const head = cut(s, Math.max(1, max)).slice(0, -1)
  const next = s.slice(head.length, head.length + 1)
  if (head.endsWith(' ') || next === ' ') return `${head.trimEnd()}…`
  const sp = head.lastIndexOf(' ')
  return `${(sp > max / 2 ? head.slice(0, sp) : head).trimEnd()}…`
}
function wrapLines(text: string, width: number, max: number): string[] {
  const out: string[] = []
  if (width < 1 || max < 1) return out
  const words = text.split(/\s+/).filter(Boolean)
  let line = ''
  let dropped = false
  for (let i = 0; i < words.length; i++) {
    let word = words[i]!
    if (out.length >= max) { dropped = true; break }
    const cand = line ? `${line} ${word}` : word
    if (tw(cand) <= width) { line = cand; continue }
    if (line) { out.push(line); line = '' }
    while (tw(word) > width) {
      if (out.length >= max) { dropped = true; break }
      const chunk = cut(word, width).replace(/…$/, '')
      if (!chunk) break
      out.push(chunk)
      word = word.slice(chunk.length)
    }
    if (out.length >= max) { dropped = dropped || word.length > 0 || i < words.length - 1; break }
    line = word
  }
  if (line) { if (out.length < max) out.push(line); else dropped = true }
  if (dropped && out.length > 0) {
    const last = out[out.length - 1]!
    out[out.length - 1] = tw(last) < width ? `${last}…` : `${cut(last, width - 1).replace(/…$/, '')}…`
  }
  return out
}
function firstGlyph(s: string): string {
  return glyphs(s)[0]?.ch ?? ''
}
function restWord(s: string): string {
  const g = glyphs(s)[0]?.ch ?? ''
  return s.slice(g.length).trim()
}
/** Spaces → no-break spaces: a one-line Text that does not fit is clipped by its height-1 Box instead of wrapping. */
function nb(s: string): string {
  return s.replace(/ /g, ' ')
}
function fitCells(cells: number): number {
  return Math.max(0, Math.floor(cells * FIT))
}
function fitLine(cells: number): number {
  return Math.max(0, Math.floor(cells * LINE_FIT))
}

// ─── fake but realistic data ─────────────────────────────────────────────────────────────────────────────────────────
type Agent = {
  id: string; emoji: string; name: string; model: string; act: string; task: string; status: Status
  star?: true; failed?: true; longRunning?: true
  mins: number; type: string; sub: string; taskLong: string; result?: string; truncated?: true
}
type Room = { id: string; title: string; agents: Agent[] }
const ROOMS: Room[] = [
  { id: 'theater', title: 'תיאטרון הסוכנים', agents: [
    { id: 'owl', emoji: '🦉', name: 'הינשוף', model: 'Opus 5.5', act: '🤔 חושב', task: 'תכנון המעבר לרישום הסטטי', status: 'running', mins: 12, type: 'general-purpose',
      sub: 'מתכנן את המעבר לרישום הסטטי', taskLong: 'לתכנן את המעבר של הרישום הסטטי ואת פריסת קונפיגורציית v2 בשני שלבים, כולל בדיקות על שני המנועים ודוח קצר לאסף' },
    { id: 'doc', emoji: '🩺', name: 'הרופא', model: 'Sonnet 4.5', act: '✏️ עורך', task: 'עריכת office-client לפי הסקירה', status: 'running', mins: 3, type: 'general-purpose', sub: 'עורך את office-client.tsx', taskLong: 'ליישם את הערות הסקירה על office-client.tsx' },
    { id: 'bot', emoji: '🤖', name: 'הרובוט', model: 'Sonnet 4.5', act: '🔌 github', task: 'סקירת ה-PR הפתוח', status: 'running', mins: 7, type: 'general-purpose', sub: 'סוקר את ה-PR', taskLong: 'לסקור את ה-PR הפתוח ולהשאיר הערות' },
    { id: 'wolf', emoji: '🐺', name: 'הזאב', model: 'Haiku 4.5', act: '💤 ממתין', task: 'ממתין לתשובת המשתמש', status: 'stale', mins: 12, type: 'general-purpose', sub: 'ממתין לתשובה', taskLong: 'לשאול את המשתמש על סדר העדיפויות ולהמשיך לפי התשובה' },
    { id: 'mech', emoji: '🔧', name: 'המכונאי', model: 'Opus 5.5', act: '✅ סיים', task: 'תיקון הבדיקות שנפלו', status: 'done', star: true, mins: 9, type: 'general-purpose',
      sub: 'תיקון הבדיקות שנפלו אחרי המיזוג', taskLong: 'לתקן את שלוש הבדיקות שנפלו ב-office-layout.test.ts אחרי המיזוג ולהריץ את כל החבילה מחדש',
      result: 'שלוש הבדיקות תוקנו: הציפייה לרוחב העמודה עודכנה ל-FIT, ובדיקת המגירה הורצה מחדש על שני המנועים. כל 212 הבדיקות עוברות, והלוג המלא נשמר בתיקיית הבדיקות', truncated: true },
    { id: 'painter', emoji: '🎨', name: 'הצייר', model: 'Sonnet 4.5', act: '⛔ נכשל', task: 'ציור הלוגו החדש', status: 'done', failed: true, mins: 4, type: 'general-purpose', sub: 'נכשל בציור הלוגו', taskLong: 'לצייר את הלוגו החדש כ-SVG' },
    { id: 'ant', emoji: '🐜', name: 'הנמלה', model: 'Haiku 4.5', act: '✅ סיים', task: 'איסוף קבצי הבדיקה', status: 'done', mins: 2, type: 'Explore', sub: 'אספה את קבצי הבדיקה', taskLong: 'לאסוף את כל קבצי הבדיקה של המשרד' },
    { id: 'bee', emoji: '🐝', name: 'הדבורה', model: 'Haiku 4.5', act: '✅ סיים', task: 'סיכום הלוג של אתמול', status: 'done', mins: 5, type: 'Explore', sub: 'סיכמה את הלוג', taskLong: 'לסכם את הלוג של אתמול בחמש שורות' },
  ] },
  { id: 'plan', title: 'Plan the static-registry move and the v2 config rollout', agents: [
    { id: 'writer', emoji: '✍️', name: 'הסופר', model: 'Fable 5.1', act: '📖 קורא', task: 'כתיבת התוכנית למעבר', status: 'running', mins: 2, type: 'Plan', sub: 'כותב את התוכנית', taskLong: 'לכתוב את תוכנית המעבר לרישום הסטטי' },
    { id: 'carto', emoji: '🗺️', name: 'הקרטוגרף', model: 'Fable 5.1', act: '✅ סיים', task: 'מיפוי קבצי ה-config', status: 'done', mins: 6, type: 'Explore', sub: 'מיפה את קבצי ה-config', taskLong: 'למפות את כל קבצי ה-config של v1 ו-v2' },
  ] },
  { id: 'test', title: 'בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', agents: [
    { id: 'dolphin', emoji: '🐬', name: 'הדולפין', model: 'Haiku 4.5', act: '🔎 מחפש קוד', task: 'חיפוש שימושי tableFit', status: 'running', mins: 1, type: 'Explore', sub: 'מחפש שימושים', taskLong: 'למצוא את כל השימושים של tableFit' },
    { id: 'detective', emoji: '🕵️', name: 'הבלש', model: 'Haiku 4.5', act: '📖 קורא', task: 'קריאת office-layout.ts', status: 'running', mins: 1, type: 'Explore', sub: 'קורא את office-layout.ts', taskLong: 'לקרוא את office-layout.ts ולסכם את המודל' },
    { id: 'turtle', emoji: '🐢', name: 'הצב', model: 'Sonnet 4.5', act: '🧪 בודק', task: 'הרצת כל חבילת הבדיקות', status: 'running', longRunning: true, mins: 48, type: 'general-purpose', sub: 'מריץ את חבילת הבדיקות', taskLong: 'להריץ את כל חבילת הבדיקות על שני המנועים ולדווח' },
  ] },
]
const ALL: Agent[] = ROOMS.flatMap(r => r.agents)
const HELP: ReadonlyArray<readonly [string, string]> = [
  ['הצג / הסתר שסיימו', 'f'], ['מעבר בין סוכנים', 'k / j'], ['פתיחת פרטים', 'o · Enter'], ['סגירת החלונית', 'x'], ['השתקה / ביטול השתקה', 'm'],
  ['החלפת שפה', 'l'], ['דמו: הפעלה / יציאה', 'd'], ['תנועה: הקפאה / שחרור', 's'], ['הגדרות', 'h'],
]

// ─── the probe's state (what the real office keeps in inst / $.state) ──────────────────────────────────────────────
const inst = { showDone: false, muted: false, settings: false, drawer: 1 as 0 | 1 | 2, query: '', lastRank: null as number | null }
let redraw: () => void = () => {}

// ─── geometry: pure functions of the columns ───────────────────────────────────────────────────────────────────────
type Geo = { columns: number; W: number; px: number; cardFrame: number; inner: number; budget: number; L: number; oneLine: boolean; full: boolean; wide: boolean; centred: boolean; tier: string }
function tierOf(c: number): string {
  if (c < 24) return 'מתחת לרצפה'
  if (c <= 27) return 'A הרצפה'
  if (c <= 37) return 'B צר'
  if (c <= 50) return 'C קומפקטי'
  if (c <= 63) return 'D רגיל'
  if (c <= 79) return 'E רחב'
  if (c <= 99) return 'F מרווח'
  return 'G מרכז'
}
function geometry(columns: number): Geo {
  const W = Math.min(columns, CENTRE_AT)
  const px = W >= WIDE_FROM ? 2 : 1
  const cardFrame = 2 + 2 * px
  const inner = W - cardFrame
  return { columns, W, px, cardFrame, inner, budget: fitCells(inner), L: fitLine(W), oneLine: W >= ONE_LINE_FROM, full: W >= MODEL_FULL_FROM, wide: W >= WIDE_FROM, centred: columns >= CENTRE_AT, tier: tierOf(columns) }
}

// ─── the table mode: ONE for the whole office, from the widest values across ALL rooms, with hysteresis ────────────
type ModelCol = 'full' | 'family' | 'none'
type Mode = { rank: number; word: boolean; model: ModelCol; nameMax: number }
const modeName = (m: Mode): string => `${m.word ? 'word' : 'emoji'}${m.model === 'none' ? '' : `+${m.model}`}${m.nameMax < NAME_MAX ? ` names≤${m.nameMax}` : ''}`
function markOf(a: Agent): string {
  if (a.star) return '⭐'
  if (a.failed) return '❌'
  if (a.longRunning) return '⏰'
  return a.status === 'done' ? '○' : '●'
}
function modelOf(a: Agent, m: ModelCol): string {
  return m === 'none' ? '' : m === 'full' ? a.model : a.model.split(' ')[0] ?? a.model
}
function widest(f: (a: Agent) => string): number {
  let w = 0
  for (const a of ALL) w = Math.max(w, tw(f(a)))
  return w
}
type Need = { status: number; who: number; model: number; actEmoji: number; actWord: number; total: number }
function needOf(word: boolean, model: ModelCol, nameMax: number): Need {
  const status = widest(a => markOf(a)) + 1 + 1          // the mark, the focus marker's cell, the padding cell
  const who = EMOJI_CELLS + 1 + widest(a => cut(a.name, nameMax)) + 1
  const mdl = model === 'none' ? 0 : widest(a => modelOf(a, model)) + 1
  const actEmoji = widest(a => firstGlyph(a.act)) + 1
  const actWord = word ? widest(a => restWord(a.act)) + 1 : 0
  return { status, who, model: mdl, actEmoji, actWord, total: status + who + mdl + actEmoji + actWord }
}
function modeAt(rank: number, budget: number, full: boolean): Mode | null {
  const fam: ModelCol = full ? 'full' : 'family'
  const fits = (m: Mode) => needOf(m.word, m.model, m.nameMax).total <= budget ? m : null
  const shrink = (model: ModelCol, floor: number) => {
    const n = needOf(false, model, NAME_MAX)
    return Math.max(floor, Math.min(NAME_MAX, budget - n.status - n.model - n.actEmoji - (EMOJI_CELLS + 1 + 1)))
  }
  switch (rank) {
    case 0: return fits({ rank, word: true, model: fam, nameMax: NAME_MAX })
    case 1: return fits({ rank, word: false, model: fam, nameMax: NAME_MAX })
    case 2: return fits({ rank, word: false, model: 'family', nameMax: NAME_MAX })
    case 3: return fits({ rank, word: false, model: 'family', nameMax: shrink('family', NAME_MIN) })
    case 4: return fits({ rank, word: false, model: 'none', nameMax: NAME_MAX })
    default: return { rank: 5, word: false, model: 'none', nameMax: shrink('none', NAME_FLOOR) }
  }
}
/** The richest mode that fits: a mode above the last one (regained) must fit with HYSTERESIS cells to spare; the last one or a poorer one, the budget alone. */
function chooseMode(budget: number, full: boolean): Mode {
  const last = inst.lastRank
  for (let r = 0; r < 5; r++) {
    const regain = last !== null && r < last
    const m = modeAt(r, regain ? budget - HYSTERESIS : budget, full)
    if (!m) continue
    inst.lastRank = r
    return regain ? modeAt(r, budget, full) ?? m : m
  }
  inst.lastRank = 5
  return modeAt(5, budget, full)!
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cards-probe', description: 'Open the cards probe pane' })
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })
  on('command.run', { command: 'cards-probe' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'opened' }
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const Input = e.surface !== 'mobile' ? $.ui.resolve(e).Input : null
    redraw = () => { try { $.ui.invalidate('ui.render') } catch { /* nothing draws the pane */ } }
    const columns = e.viewport?.columns ?? 40
    const geo = geometry(columns)
    const mode = chooseMode(geo.budget, geo.full)

    // ── the office view: the search, the rows each card draws, the counts ──
    const q = inst.query.toLowerCase()
    const match = (a: Agent) => !q || a.name.toLowerCase().includes(q) || a.act.toLowerCase().includes(q) || a.task.toLowerCase().includes(q)
    const view = ROOMS.map(room => ({ room, agents: room.agents.filter(match) })).filter(v => v.agents.length > 0)
    const matches = view.reduce((n, v) => n + v.agents.length, 0)
    const working = ALL.filter(a => a.status === 'running').length
    const waiting = ALL.filter(a => a.status === 'stale').length
    const finished = ALL.filter(a => a.status === 'done').length
    const drawerAgent: Agent | null = inst.drawer === 1 ? ALL[0]! : inst.drawer === 2 ? ALL[4]! : null
    const rowsOf = (agents: Agent[]): { shown: Agent[]; more: string } => {
      const live = agents.filter(a => a.status !== 'done')
      const done = agents.filter(a => a.status === 'done')
      if (inst.showDone) return { shown: [...live, ...done], more: done.length > RECENT_DONE ? '▸ הסתר שסיימו' : '' }
      // ⭐ and ❌ never hide behind the more line: they rank first within the recent finished
      const ranked = [...done.filter(a => a.star || a.failed), ...done.filter(a => !a.star && !a.failed)]
      const recent = ranked.slice(0, RECENT_DONE)
      const hidden = done.length - recent.length
      return { shown: [...live, ...recent], more: hidden > 0 ? `▸ עוד ${hidden} שסיימו` : '' }
    }
    /** The room's counts (non-zero statuses only), shrunk — ✅ goes, then ⏳ — until the title keeps TITLE_MIN fit cells. */
    const countsFor = (agents: Agent[]): string => {
      const run = agents.filter(a => a.status === 'running').length
      const stale = agents.filter(a => a.status === 'stale').length
      const done = agents.filter(a => a.status === 'done').length
      const forms = [`🟢${run}${stale ? ` ⏳${stale}` : ''}${done ? ` ✅${done}` : ''}`, `🟢${run}${stale ? ` ⏳${stale}` : ''}`, `🟢${run}`]
      for (const c of forms) if (fitCells(geo.inner - 2 - tw(c) - 2) >= TITLE_MIN) return c
      return forms[2]!
    }
    const titleOf = (title: string, counts: string): string => nb(cutWords(title, Math.max(8, fitLine(geo.inner - 2 - tw(counts) - 2))))

    // ── the chrome's label ladder, by LINE_FIT ──
    const L = geo.L
    const wordsHdr = `🎭 עובדים ${working} · ממתינים ${waiting} · סיימו ${finished}`
    const shortHdr = `🎭 🟢${working} ⏳${waiting} ✅${finished}`
    const header = q ? `🔍 תואמים ${matches}` : tw(wordsHdr) <= L ? wordsHdr : shortHdr
    const fitsHdr = (m: string) => tw(header) + 1 + tw(m) <= L
    let meterHeader: string | null = geo.wide && fitsHdr(METER_FULL) ? METER_FULL : fitsHdr(METER_SHORT) ? METER_SHORT : null
    let meterSearch: string | null = null
    if (meterHeader === null) {
      if (!geo.oneLine && tw(PLACEHOLDER) + 2 + tw(METER_SHORT) <= L) meterSearch = METER_SHORT
      else if (fitsHdr(METER_TINY)) meterHeader = METER_TINY
    }
    const tbWords = [`הצג שסיימו ${inst.showDone ? '☑' : '☐'}`, `צליל ${inst.muted ? '🔕' : '🔔'}`, 'הגדרות ⚙️']
    const tbIcons = [inst.showDone ? '☑' : '☐', inst.muted ? '🔕' : '🔔', '⚙️']
    const tb = tbWords.reduce((n, l, i) => n + (i ? 2 : 0) + tw(l), 0) <= L ? tbWords : tbIcons
    const toolbarCells = Math.ceil(tbWords.reduce((n, l) => n + tw(l), 0) / FIT) + 4
    const inputW = Math.max(12, Math.min(30, geo.W - toolbarCells - 2))
    const fieldCells = geo.oneLine ? inputW : geo.W - (meterSearch ? tw(meterSearch) + 2 : 0)
    const placeholder = fieldCells >= Math.ceil(tw(PLACEHOLDER) / FIT) ? PLACEHOLDER : PLACEHOLDER_SHORT
    const hk = (k: string): { hotkey?: string } => geo.W >= HOTKEYS_FROM ? { hotkey: k } : {}

    // ── the pieces ──
    const line = (children: RenderChildren, extra: BoxProps = {}) => <Box flexDirection="row-reverse" columnGap={1} flexWrap="nowrap" height={1} overflow="hidden" {...extra}>{children}</Box>
    const toggleDone = () => { inst.showDone = !inst.showDone; redraw() }
    const toggleMute = () => { inst.muted = !inst.muted; redraw() }
    const toggleSettings = () => { inst.settings = !inst.settings; if (inst.settings) inst.drawer = 0; redraw() }
    const cycleDrawer = () => { inst.drawer = ((inst.drawer + 1) % 3) as 0 | 1 | 2; if (inst.drawer) inst.settings = false; redraw() }
    const closeDrawer = () => { inst.drawer = 0; redraw() }
    const buttons = [
      <Button plain label={tb[0]!} onPress={toggleDone} {...hk('f')} />,
      <Button plain label={tb[1]!} onPress={toggleMute} {...hk('m')} />,
      <Button plain label={tb[2]!} onPress={toggleSettings} {...hk('h')} />,
    ]
    const field = Input
      ? <Input key="search" placeholder={placeholder} value={inst.query} onSubmit={v => { inst.query = v.trim(); redraw() }} />
      : <Text dimColor>{placeholder}</Text>
    const headerLine = (
      <Box flexDirection="row-reverse" justifyContent="space-between" width="100%" height={1} overflow="hidden" marginBottom={1}>
        <Text bold>{header}</Text>
        {meterHeader !== null && <Text dimColor>{meterHeader}</Text>}
      </Box>
    )
    // the toolbar and the search: two lines (with their blanks) under 64 cells, ONE line from 64
    const chrome = geo.oneLine
      ? [
          <Box flexDirection="row-reverse" justifyContent="space-between" width="100%" height={1} overflow="hidden" marginBottom={1}>
            <Box flexDirection="row-reverse" gap={2} flexShrink={0}>{buttons}</Box>
            <Box width={inputW} flexShrink={0} height={1} overflow="hidden">{field}</Box>
          </Box>,
        ]
      : [
          <Box flexDirection="row-reverse" gap={2} flexWrap="nowrap" height={1} overflow="hidden">{buttons}</Box>,
          <Box flexDirection="row-reverse" columnGap={2} marginTop={1} marginBottom={1} height={1} overflow="hidden">
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">{field}</Box>
            {meterSearch !== null && <Text dimColor>{meterSearch}</Text>}
          </Box>,
        ]

    // the settings popover: a fixed-height card; the shortcuts a column-major key|label table, two pairs from 80 cells
    const pairs: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = geo.wide ? [HELP.slice(0, 5), [...HELP.slice(5), [' ', ' '] as const]] : [HELP]
    const helpRows = 2 + 2 + 1 + 1 + pairs[0]!.length
    const sbWords = ['דמו 🎬', 'תנועה 🎞', '🌐 English']
    const sb = sbWords.reduce((n, l, i) => n + (i ? 1 : 0) + tw(l), 0) <= L ? sbWords : ['🎬', '🎞', 'EN']
    const pair = (rows: ReadonlyArray<readonly [string, string]>) => (
      <Box flexDirection="row-reverse">
        <Box flexDirection="column" alignItems="flex-end" flexShrink={0} paddingLeft={1}>{rows.map(r => <Text>{r[0]}</Text>)}</Box>
        <Box flexDirection="column" alignItems="flex-end" flexShrink={0}>{rows.map(r => <Text dimColor>{r[1]}</Text>)}</Box>
      </Box>
    )
    const settings = (
      <Box key="help" flexDirection="column" borderStyle="round" borderColor={CARD_BORDER} paddingX={geo.px} paddingY={1} height={helpRows} marginBottom={1} width="100%" overflow="hidden">
        {line([<Text bold>הגדרות</Text>, <Button plain role="dismiss" label="✕" onPress={toggleSettings} />], { justifyContent: 'space-between', width: '100%' })}
        {line([<Button plain label={sb[0]!} onPress={() => {}} />, <Button plain label={sb[1]!} onPress={() => {}} />, <Button plain label={sb[2]!} onPress={() => {}} />])}
        <Box flexDirection="row-reverse" columnGap={4} width="100%">{pairs.map(pair)}</Box>
      </Box>
    )

    // the drawer: name + ✕, sub, ONE status line, a blank, the model line, the task (and the result) wrapped at fitCells(inner)
    const drawer = (d: Agent) => {
      const inner = Math.max(1, fitCells(geo.inner))
      const taskMax = geo.W < 34 ? 3 : 4
      const resultMax = geo.W < 34 ? 2 : 3
      const word = d.failed ? 'נכשל' : d.status === 'done' ? 'סיים' : d.status === 'stale' ? 'ממתין' : 'עובד'
      const items: RenderChildren[] = [
        line([
          <Box flexGrow={1} flexShrink={1} minWidth={0} height={1} overflow="hidden" justifyContent="flex-end"><Text bold>{`${d.emoji} ${d.name}`}</Text></Box>,
          <Button plain role="dismiss" hotkey="x" label="✕" onPress={closeDrawer} />,
        ], { justifyContent: 'space-between', width: '100%' }),
        line(<Text dimColor>{cut(d.sub, inner)}</Text>),
        line([<Text color={DOT[d.status]}>{markOf(d)}</Text>, <Text dimColor>{cut(`${word} · ${d.status === 'done' ? 'משך' : 'זמן'} ${d.mins} דק׳ · ${d.type}`, inner - 3)}</Text>]),
        <Box height={1} />,
        line(<Text>{cut(['מודל', '🧠', d.model, '·', 'פעולה', d.act].join(' '), inner)}</Text>),
        line(<Text dimColor>משימה</Text>),
        ...wrapLines(d.taskLong, inner, taskMax).map(t => line(<Text>{t}</Text>)),
      ]
      if (d.result) {
        items.push(line(<Text dimColor>תוצאה</Text>), ...wrapLines(d.result, inner, resultMax).map(t => line(<Text>{t}</Text>)))
        if (d.truncated) items.push(line(<Text dimColor>{cut('✂ התוצאה קוצרה — לפלט המלא פתחו את הטרמינל', inner)}</Text>))
      }
      return (
        <Box key="drawer" flexDirection="column" borderStyle="round" borderColor={CARD_BORDER} paddingX={geo.px} paddingY={1} marginBottom={1} width="100%" height={4 + items.length} overflow="hidden" alignItems="flex-end">
          {items}
        </Box>
      )
    }
    const overlay = inst.settings ? settings : drawerAgent ? drawer(drawerAgent) : null

    // the cards: the table's columns content-sized, aligned across cards from 80 cells by minWidth floors (office-wide widest value by FIT + the padding cell)
    type Row = { a: Agent; mark: string; sel: boolean }
    const floor = (cells: number): number => Math.ceil(cells / FIT) + 1
    const floors: Record<string, number> | null = geo.wide ? {
      status: floor(widest(a => markOf(a)) + 1), who: floor(EMOJI_CELLS + 1 + widest(a => cut(a.name, mode.nameMax))),
      model: floor(widest(a => modelOf(a, mode.model))), actEmoji: floor(widest(a => firstGlyph(a.act))), actWord: floor(widest(a => restWord(a.act))),
    } : null
    const column = (name: string, rows: Row[], pick: (r: Row) => string, style: (r: Row) => TextProps, grow: boolean) => (
      <Box flexDirection="column" alignItems="flex-end" flexShrink={0} flexGrow={grow ? 1 : 0} paddingLeft={1} {...(floors && floors[name] !== undefined ? { minWidth: floors[name] } : {})}>
        {rows.map(r => <Text wrap="truncate" {...style(r)}>{pick(r) || ' '}</Text>)}
      </Box>
    )
    const whoStyle = (r: Row): TextProps => r.a.status === 'running' ? { bold: true } : r.a.status === 'done' && !r.a.failed ? { dimColor: true } : {}
    const table = (rows: Row[]) => (
      <Box flexDirection="row-reverse" width="100%">
        {column('status', rows, r => `${r.sel ? '‹' : ''}${r.mark}`, r => ({ color: DOT[r.a.status] }), false)}
        {column('who', rows, r => nb(`${r.a.emoji} ${cut(r.a.name, mode.nameMax)}`), whoStyle, false)}
        {mode.model !== 'none' && column('model', rows, r => modelOf(r.a, mode.model), () => ({ dimColor: true }), false)}
        {column('actEmoji', rows, r => firstGlyph(r.a.act), r => ({ dimColor: r.a.status === 'done' }), !mode.word && !geo.centred)}
        {mode.word && column('actWord', rows, r => restWord(r.a.act), r => ({ dimColor: r.a.status !== 'running' }), !geo.centred)}
        {geo.centred && column('task', rows, r => cut(r.a.task, TASK_MAX), () => ({ dimColor: true }), true)}
      </Box>
    )
    // round 9 (Asaf 19.10): no rule under the title — it never stretched with the card; a blank line keeps the height
    const rule = <Box height={1} />
    const card = (room: Room, agents: Agent[]) => {
      const counts = countsFor(room.agents)
      const { shown, more } = rowsOf(agents)
      const rows: Row[] = shown.map(a => ({ a, mark: markOf(a), sel: drawerAgent !== null && drawerAgent.id === a.id }))
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={CARD_BORDER} paddingX={geo.px} paddingY={1} marginBottom={1} width="100%" overflow="hidden">
          <Box flexDirection="row-reverse" justifyContent="space-between" width="100%" height={1} paddingX={1} gap={2} overflow="hidden">
            <Box flexGrow={1} flexShrink={1} minWidth={0} height={1} overflow="hidden" justifyContent="flex-end"><Text bold>{titleOf(room.title, counts)}</Text></Box>
            <Box flexShrink={0} height={1}><Text dimColor>{counts}</Text></Box>
          </Box>
          {rule}
          {table(rows)}
          {more !== '' && <Box flexDirection="row-reverse" marginTop={1} paddingX={1} height={1} overflow="hidden"><Text dimColor>{nb(more)}</Text></Box>}
        </Box>
      )
    }
    const empty = (
      <Box flexDirection="column" alignItems="center" width="100%">
        <Text>🏢</Text>
        {wrapLines('אין סוכנים שתואמים לחיפוש', Math.max(1, fitCells(geo.W)), 2).map(t => <Text bold>{t}</Text>)}
      </Box>
    )
    const diag = `(round 9) · columns=${columns} · W=${geo.W} · ${geo.tier} · table=${modeName(mode)}`
    return (
      <Box flexDirection="column" width="100%" alignItems="center">
        <Box key="column" flexDirection="column" width={columns > CENTRE_AT ? CENTRE_AT : '100%'} flexShrink={0}>
          {headerLine}
          {chrome}
          {overlay}
          {view.length === 0 ? empty : view.map(v => card(v.room, v.agents))}
          <Box flexDirection="row-reverse" columnGap={2} height={1} overflow="hidden">
            <Text dimColor>{diag}</Text>
            <Button plain dimColor label="מגירה" onPress={cycleDrawer} />
          </Box>
        </Box>
      </Box>
    )
  })
}
