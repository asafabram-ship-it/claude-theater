// Pure view model of the desktop office: no engine, no `$`. The hooks count
// its lines for the Client's height (`rowCount`); the surface module draws it
// (office-client.tsx) and windows it on its line map.
//
// THE CARDS (docs/superpowers/specs/2026-10-19-office-cards-design.md, the
// probe docs/research/2026-10-19-cards-probe/register.tsx, round 9): every
// room is a framed card — a title line (the pin Button at the reading edge —
// on EVERY card, pinned or not — the read-only counts at the other edge), under
// it — when the room holds more finished agents than RECENT_DONE — its ONE finished toggle (`עוד 2 שסיימו ◂`
// / `הסתר שסיימו ▾`, read arrow first through iconLabel; live check 7: above
// the rows, it never moves), a BLANK
// line (no rule: it never stretched with the card), then the agents as a
// COLUMN-MAJOR table of rigid columns (status
// mark · who · [model] · activity emoji · [activity word] · [task]), each sized
// by the desktop to its widest value, every value one line tall. The desktop
// draws its Text in a proportional font, so this module never pads by cell
// and never cuts to a cell width: it only decides WHAT each cell says, by a
// conservative estimate of what fits (`fitCells`: the desktop draws letters
// wider than a cell — the probe's round 6 fit four columns at 51 columns).
//
// THE WIDTH (probe rounds 8-9): ONE reading column, `geometry`: the pane less
// PANE_GUTTER cells — a cell at each edge, so no card border ever touches the
// pane's edge (live check 6: the Client lays out a hair wider than the visible
// pane, and the cards' right border was clipped) — frozen at CENTRE_AT cells
// and centred; every width threshold below is measured on that column. The
// card's padding 1 → 2 from WIDE_FROM. The frame never changes shape with the width — widening
// or narrowing changes words and columns, never a line's position. The TABLE
// MODE is decided ONCE per render for the whole office from the widest values
// across all its rooms (`officeWidest`), with HYSTERESIS cells kept by the
// caller (the Client's instance, never the props): a mode is dropped the
// instant it stops fitting and regained only with two cells to spare
// (`chooseMode`) — while the pane is dragged; a change of CONTENT that moves
// the widest values chooses the mode afresh (`ModeToken`). The ladder, richest first: the activity word → the model's
// version → the names down to NAME_MIN → the model column → the names to
// NAME_FLOOR. From WIDE_FROM the columns align across the cards by minWidth
// floors (`floorsOf`); from CENTRE_AT a dim task column rides at the end.
//
// THE LINE MAP: every line the Client draws is exactly one row tall by
// construction (a height-1 Box with overflow hidden around each chrome value,
// the card's border and padding, and EVERY ONE-LINE VALUE OF A CARD WITHOUT A
// PLAIN SPACE — `nb` turns its spaces into no-break spaces, so a value a little
// too long is clipped at the edge instead of breaking onto a second line, which
// would shift every line under it: the desktop does not enforce a Text's
// `wrap`), so the y of every line is known here, before anything is drawn: the
// window (office-client.tsx) cuts the lines it draws from the map and the
// keyboard walk steps along its rows. The pointer is mapped to NOTHING (phase B,
// decision 26): the desktop's pointer y drifts a row per card — a card frame's
// border rows are half a cell (paint probe 22.10) — so every click is a native
// Button: a row, the title's pin, the more line (the counts are read-only: live
// check 7). The decor (the keyboard focus) is the module's local state handed in
// as data, so the model stays a pure function of (props, decor, the last mode's
// rank).
//
// The strings are the probe's (`${emoji} ${name}`, `🤔` then `חושב`, a title
// cut on a word with a trailing …): the desktop lays a Hebrew-first Text
// right-to-left, so nothing here reorders a string for the reader — but a
// labelled control (the more / hide line, `עוד 2 שסיימו ◂`) goes through
// iconLabel, which puts its mark where the reader meets it first.

import type { OfficeAgent, OfficeProps, OfficeRoom } from './office-props'

export const EMOJI_CELLS = 2
/** The caps of the props' texts (office-props.ts cuts to them): a row's name, its activity, the model word, the row's short task. */
export const NAME_MAX = 24
export const ACT_MAX = 18
export const PILL_MAX = 12
export const TASK_MAX = 24
/**
 * The row's task in UTF-16 code units as well (cutTask): a cell cut alone bounds no serialized cost — a ZWJ family emoji is
 * two cells and eleven units, a stack of combining marks one cell and dozens — and the row's cost (office-chrome.ts
 * ROW_CHARS) is the premise of the window's row budget.
 */
export const TASK_UNITS = 2 * TASK_MAX
/** The narrowest a name is cut to before the model column gives way (the probe's ladder: names down to 8, then the column). */
export const NAME_MIN = 8
/** The names' floor once the model column is gone (the probe: the narrowest panes only). */
export const NAME_FLOOR = 3
/** The model's version rides its family word from a reading column this many cells wide (`Opus 5.5`); under it the family alone (`Opus`). */
export const MODEL_FULL_FROM = 60
/** The toolbar and the search share one line from a reading column this many cells wide (the chrome 6 rows → 4 while the search is drawn). */
export const ONE_LINE_FROM = 64
/** From a reading column this many cells wide: the card's padding is 2, the columns align across the cards (floors), the settings' shortcuts in two pairs, the full meter. */
export const WIDE_FROM = 80
/** The reading column is frozen at this many cells (the dim task column from there). */
export const CENTRE_AT = 100
/**
 * The cells of the pane the reading column leaves free: one at each edge (the odd cell of a centred column on the right), so
 * no card border ever touches the pane's edge — live check 6: the Client lays out a hair wider than the visible pane (a
 * rounding, or the scrollbar), and the cards' right border was clipped there.
 */
export const PANE_GUTTER = 2
/** The title keeps at least this many fit cells before the counts shrink. */
export const TITLE_MIN = 16
/** The cells a richer table mode must have to spare before it is regained (none to be dropped). */
export const HYSTERESIS = 2
/** The room head's pin glyph of a pinned room: the colour 📌 (an unpinned room's is PIN_OFF). */
export const PIN = '📌'
/** The unpinned pin on every card's title (decision 26): the same glyph in its TEXT presentation (VS15), which the desktop draws monochrome beside the colour 📌 of a pinned room — `dimColor` does not dim a colour emoji, and no hover reveals anything inside a Client. */
export const PIN_OFF = '📌\uFE0E'
/** The card's frame colour (the probe's). */
export const CARD_BORDER = '#56607a'
/** The status column's colours by status (the probe's dots): green running, amber stale, grey done. */
export const DOT_FG: Readonly<Record<OfficeAgent['status'], string>> = { running: '#3fb950', stale: '#d29922', done: '#8b949e' }
/**
 * THE FIT: the share of a width in cells the desktop can be trusted to draw text into — its letters are wider than the
 * engine's cell (the probe's round 4 clipped `Sonnet` to `nnet` in a 6-cell box). From the probe: four columns of 32
 * cells fit the 47 inner cells of a 51-column pane (round 6, 0.68) while five of 39 cells did not (0.83); the header's
 * 33 cells of counts, a gap and 8 of meter fit the 51 columns whole (round 7, 0.82). So the table, the counts' shrink
 * and the drawer's wrapping — where an overflow clips a value — go by FIT, and the chrome's one-line labels (the
 * header, the toolbar, the search's placeholder) and the title, which fall back to a shorter form or are cut on a
 * word, by LINE_FIT (the probe's header exactly; the title by LINE_FIT since round 9).
 */
export const FIT = 0.75
export const LINE_FIT = 0.83
export function fitCells(cells: number): number {
  return Math.max(0, Math.floor(cells * FIT))
}
export function fitLine(cells: number): number {
  return Math.max(0, Math.floor(cells * LINE_FIT))
}
/**
 * The title line's gap between its children (the probe's `gap={2}`): the title and the counts, and the pin before the title
 * — on every card since decision 26: a pinned room's colour 📌, PIN_OFF on an unpinned one — so the model cuts every title
 * with the pin's cells reserved (cutTitle's `pinned`, which roomBase passes true) and a pin never re-cuts a title.
 */
export const TITLE_GAP = 2
/** The lines of a card around its rows: the two borders, the two padding lines, the title, the blank line under it, the gap after the card. */
export const CARD_LINES = 7
/** The more / hide line: ONE line, directly under the title (live check 7, Q3: under the rows it moved with what it revealed). */
export const MORE_LINES = 1
/**
 * The more / hide line's arrow, following its state: ▸ while the room holds finished back — ◂ in the Hebrew pane, its RTL
 * form pointing the reader's way (as FOCUS_MARK has one) — ▾ while it shows them all. Laid through iconLabel (live check 7
 * review): the Hebrew reader meets it first, at the line's right edge, where the label is aligned — it never moves as the
 * label's width changes.
 */
export const MORE_MARK: Readonly<Record<'rtl' | 'ltr', string>> = { rtl: '◂', ltr: '▸' }
export const LESS_MARK = '▾'
/** The keyboard focus marker beside the status mark, pointing into the row from the reading edge. */
export const FOCUS_MARK: Readonly<Record<'rtl' | 'ltr', string>> = { rtl: '‹', ltr: '›' }

const EMOJI_RE = /^\p{Extended_Pictographic}/u
/** Code points that take no cell of their own: combining marks (Hebrew points among them), the variation selectors, the ZWJ, the skin tones. */
const JOIN_RE = /^[\p{M}‍︎️\u{1F3FB}-\u{1F3FF}]$/u
const ZWJ = '‍'
const ELLIPSIS = '…'
/** A Hebrew-script character (a letter, a point, the geresh). (i18n.ts hebrewRuleOk uses the same class.) */
const HEBREW_RE = /\p{Script=Hebrew}/u
/** The no-break space (U+00A0): a space the desktop never breaks a line on — and no surface refuses (office-chrome.ts REFUSED_RE: it is no control). (Escaped: an invisible literal would survive no formatter.) */
export const NBSP = '\u00A0'

export type Glyph = { ch: string; w: number }

/** `text` as glyphs: a base code point with the marks, selectors and joined code points that ride on it, and its width in cells. */
export function glyphs(text: string): Glyph[] {
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

/** The width of `text` in cells (the terminal metric; the desktop draws wider — see FIT). */
export function textWidth(text: string): number {
  let w = 0
  for (const g of glyphs(text)) w += g.w
  return w
}

/** `s` cut to at most `max` cells, whole glyphs only, with an ellipsis when something was dropped. (office-props.ts's caps, the drawer's wrapping.) */
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

/** `s` cut to at most `max` UTF-16 code units, whole glyphs only, the ellipsis (one unit) trailing when something was dropped. */
export function capUnits(s: string, max: number): string {
  if (s.length <= max) return s
  const gs = glyphs(s)
  let n = gs.length
  let units = s.length
  while (n > 0 && units + 1 > max) { n--; units -= gs[n]!.ch.length }
  return gs.slice(0, n).map(g => g.ch).join('') + ELLIPSIS
}

/** A row's short task as the props carry it and the task column draws it: cut to TASK_MAX cells, then to TASK_UNITS code units. */
export function cutTask(s: string): string {
  return capUnits(cut(s, TASK_MAX), TASK_UNITS)
}

/**
 * `s` cut to at most `max` cells on a word boundary (the probe's title cut), the ellipsis trailing: `Plan the static-registry
 * move…` — while the whole words keep at least two thirds of the `max` cells; when the last space lies earlier than that (a
 * long word at the cut: `Plan the static…` where `Plan the static-registry…` would fit) the cut falls inside the word
 * instead, with the ellipsis (live check 5). A text that fits is returned as it is.
 */
export function cutWords(s: string, max: number): string {
  if (textWidth(s) <= max) return s
  const head = cut(s, Math.max(1, max)).slice(0, -ELLIPSIS.length)
  // the cut fell on a word boundary: the head is whole words
  const next = s.slice(head.length, head.length + 1)
  if (head.endsWith(' ') || next === ' ') return `${head.trimEnd()}${ELLIPSIS}`
  const sp = head.lastIndexOf(' ')
  const words = sp > 0 ? head.slice(0, sp).trimEnd() : ''
  return `${(words !== '' && 3 * textWidth(words) >= 2 * max ? words : head).trimEnd()}${ELLIPSIS}`
}

/** The no-break hyphen (U+2011, line-break class GL): what a hyphen or a dash of a one-line value becomes (nb). Escaped, as NBSP is. */
export const NBHY = '\u{2011}'
/** The division slash (U+2215, line-break class AL): what a slash of a one-line value becomes (nb). Escaped, as NBSP is. */
export const NBSLASH = '\u{2215}'
/**
 * The divides sign (U+2223 ∣: line-break class AI, which UAX #14 LB1 resolves to AL; bidi ON, as `|` is; one cell): what a
 * vertical bar of a one-line value becomes (nb). Not U+01C0 ǀ (a letter: a strong left-to-right character, which would move
 * a Hebrew line's runs and fail THE HEBREW RULE). Escaped, as NBSP is.
 */
export const NBBAR = '\u{2223}'
/**
 * The combining grapheme joiner (U+034F: line-break class GL — no break before it but after a space, a BA or a hyphen, none
 * after it; a nonspacing mark, Mn, so no control and no format character; default-ignorable: never drawn, no cell — glyphs()
 * rides it on the mark before it): the glue nb sets after a mark a line breaks after, which has no no-break look-alike but a
 * letter. Escaped, as NBSP is.
 */
export const GLUE = '\u{34F}'
/** The no-break spaces (U+00A0, U+2007, U+202F: line-break class GL), which no line is broken at. */
const NO_BREAK_SPACES: ReadonlySet<string> = new Set([NBSP, '\u{2007}', '\u{202F}'])
/** The em dash (UAX #14 class B2: a break before and after it, but not beside a no-break space or another em dash). */
const EM_DASH = '\u{2014}'
/** The spaces a line may break at or after (UAX #14 SP and the BA spaces): the tab and every space separator but the no-break ones. */
const BREAK_SPACE_RE = /(?![\u{A0}\u{2007}\u{202F}])[\t\p{Zs}]/gu
/** The invisible break opportunities: the zero-width space (class ZW) and the soft hyphen (BA) — both Cf, never drawn: removed. */
const INVISIBLE_BREAK_RE = /[\u{200B}\u{AD}]/gu
/**
 * The visible marks a line may break after (UAX #14, as the desktop's line breaker applies it), once the spaces are no-break
 * spaces: a hyphen-minus (HY) unless a digit follows (`HY × NU`: `3-4`, `-5` hold, and the number keeps its bidi run), the
 * hyphen U+2010, the figure and en dashes U+2012 / U+2013, the maqaf U+05BE and the vertical bar (BA: even before a no-break
 * space) unless they end the value, the em dash (B2; nb keeps one flanked by no-break spaces, which holds), and a slash (SY)
 * unless a digit, a no-break space or the end follows (`SY × NU`, `SY × GL`).
 */
const BREAK_MARK_RE = /-(?!\p{Nd})|[|\u{5BE}\u{2010}\u{2012}\u{2013}](?!$)|\u{2014}|\/(?![\p{Nd}\u{A0}\u{2007}\u{202F}]|$)/gu
/**
 * The marks a line breaks after before a letter, a digit, an emoji, an opening bracket (UAX #14 LB31: no rule holds them
 * there) — the exclamation and question marks (EX), the closing brace (CL), the ellipsis (IN) — when something follows them
 * but the glue itself, a no-break space or the no-break hyphen (`× GL`), or a mark no line breaks before: a closing, terminal
 * or quote mark (`× EX`, `× CL`, `× CP`, `× IS`, `× IN`, `× QU`), a hyphen-minus or a slash nb kept (`× HY`, `× SY`). Matched
 * after the other rewrites, so a bar or a slash that became a letter's class (NBBAR, NBSLASH) after one is glued to it.
 */
const GLUE_AFTER_RE = /[!?}\u{2026}](?=[^\u{34F}\u{A0}\u{2007}\u{202F}\u{2011}!?)\]}\u{2026},.:;'"\/-])/gu
/** Anything nb rewrites but a plain space (a breaking space other than U+0020, an invisible break, a hyphen, a dash, a slash, a bar, a mark it glues): nb's fast path checks for it. */
const NB_WORK_RE = /[-/|!?}\t\u{AD}\u{5BE}\u{1680}\u{2000}-\u{200B}\u{2010}-\u{2014}\u{2026}\u{205F}\u{3000}]/u

/**
 * THE ONE-LINE VALUE (round 9; live check 5; pre-check 6): `s` with no line-break opportunity left among its spaces,
 * hyphens, dashes, slashes, vertical bars and the marks a line breaks after (`! ? } …`), so a Text drawn from it can never
 * wrap there — a value a little too long for its column is clipped at the card's edge instead of breaking onto a second line
 * (the desktop does not enforce `wrap: 'truncate'`; a wrapped line would shift every line of the line map under it — Asaf's
 * screenshot of 20.10: a title broke at its hyphen, `Plan the static-` over `registry…`, although its spaces were
 * no-break). So: every space a no-break space (U+00A0); a hyphen-minus or a hyphen, a figure or en dash, a maqaf, an em
 * dash between letters a no-break hyphen (U+2011: the same bidi class as the dashes, ON — a hyphen-minus before a digit is
 * kept, as a number range or a sign needs its own class to stay one run in a Hebrew line); a slash before a letter the
 * division slash (U+2215: ON, as `/` is between letters); a vertical bar the divides sign (NBBAR, U+2223: ON, as `|` is;
 * the bar and the maqaf, like the dashes, kept at the end, where nothing breaks); after an exclamation or a question mark, a
 * closing brace or an ellipsis that a letter, a digit or another breaking neighbour follows, the glue (GLUE, U+034F: no
 * break on either side of it; invisible, no cell) — those marks have no no-break look-alike but letters, which would change
 * the bidi runs and fail THE HEBREW RULE; the zero-width space and the soft hyphen removed. A closing parenthesis or bracket
 * and a plus hold before a letter or a digit already (UAX #14 LB30, LB24) and are kept. Not every opportunity of UAX #14 is
 * closed: one before an emoji or an opening bracket after a letter or another mark (`word🎉`, `a.(b`) stays — rare in a
 * title or a task. No character it writes is a control or a format character (office-chrome.ts REFUSED_RE, cleanAgentText:
 * office-layout.test.ts checks both). Every one-line value of a card goes through it: the who, the model, the activity
 * word, the task, the title, the counts, the more line — and the settings' shortcut table and the demo line
 * (office-client.tsx). The width is the same (each replacement one cell, the glue none; only the invisible two leave).
 * Idempotent.
 */
export function nb(s: string): string {
  // the fast path: most values hold nothing but plain spaces to rewrite (a room's rows are rebuilt on every width change)
  if (!NB_WORK_RE.test(s)) return s.replace(/ /g, NBSP)
  const spaced = s.replace(INVISIBLE_BREAK_RE, '').replace(BREAK_SPACE_RE, NBSP)
  const marked = spaced.replace(BREAK_MARK_RE, (m: string, at: number, all: string) => {
    if (m === '/') return NBSLASH
    if (m === '|') return NBBAR
    if (m === EM_DASH) {
      const holds = (c: string | undefined) => c === undefined || c === EM_DASH || NO_BREAK_SPACES.has(c)
      return holds(all[at - 1]) && holds(all[at + 1]) ? m : NBHY
    }
    return NBHY
  })
  return marked.replace(GLUE_AFTER_RE, (m: string) => `${m}${GLUE}`)
}

/**
 * The label of a control (or a chip) that reads ICON THEN WORD, as the probe writes it: for the Hebrew reader (`rtl`, a
 * Hebrew word) the icon TRAILS the word in the string (`הצג שסיימו ☐`, `צליל 🔔`, `הגדרות ⚙️` — seen right on the
 * desktop as written); two icons are reversed there (`יציאה ✕ 🎬`), and the icons alone keep that arrangement. Any other
 * word (Latin in either pane, or the English pane's one Hebrew word) takes the icon first. The office Client lays every
 * labelled control through it, and officeModel the cards' more / hide line (`עוד 2 שסיימו ◂`).
 */
export function iconLabel(icon: string, word: string, rtl: boolean): string {
  if (!icon) return word
  const icons = rtl ? icon.split(' ').reverse().join(' ') : icon
  if (!word) return icons
  if (rtl && HEBREW_RE.test(word)) return `${word} ${icons}`
  return `${icon} ${word}`
}

/** The model's word: the family alone (`Opus`; `?` unknown) or, `full`, the label with its version (`Opus 5.5`, cut to PILL_MAX). */
export function modelText(model: string, full = false): string {
  const label = full ? model : model.split(' ')[0] ?? model
  return cut(label || '?', PILL_MAX)
}

/** The first glyph of a text: an activity's emoji, its own column (the word beside it when the table has room). */
export function firstGlyph(text: string): string {
  return glyphs(text)[0]?.ch ?? ''
}

/** The text after its first glyph, trimmed: an activity's word (`חושב` of `🤔 חושב`). */
export function restWord(text: string): string {
  const g = glyphs(text)[0]?.ch ?? ''
  return text.slice(g.length).trim()
}

/** The room's counts as the title line draws them at its far edge: `🟢3 ⏳1 ✅2` (an idle or done count only when there is one). */
export function countsText(room: Pick<OfficeRoom, 'run' | 'stale' | 'done'>): string {
  return `🟢${room.run}${room.stale ? ` ⏳${room.stale}` : ''}${room.done ? ` ✅${room.done}` : ''}`
}

/**
 * The status mark of a row: the badges ride the status column — ⭐ inside the just-finished window, ❌ failed, ⏰ long-running
 * — else ● (running, stale) or ○ (done); its colour the status's. (The drawer's status line carries the same mark.)
 */
export function markOf(a: Pick<OfficeAgent, 'status' | 'star' | 'failed' | 'longRunning'>): string {
  if (a.star) return '⭐'
  if (a.failed) return '❌'
  if (a.longRunning) return '⏰'
  return a.status === 'done' ? '○' : '●'
}

// ---------------------------------------------------------------------------
// the geometry: pure functions of the pane's columns
// ---------------------------------------------------------------------------

/**
 * The reading column at `columns`: its width `W` (the pane less PANE_GUTTER, frozen at CENTRE_AT, centred by `margin` cells
 * on the left: a cell at least on each side), the card's padding `px` (2 from WIDE_FROM), the frame (`2 + 2 px`: a border
 * and the padding on each side), the card's inner width, the table's `budget` (the inner width by FIT), the chrome line's
 * `L` (by LINE_FIT) and the structure flags, every one measured on `W`: `oneLine` (toolbar + search on one line), `full`
 * (the model's version), `wide` (floors, two settings pairs, the full meter), `centred` (the frozen column: the task column).
 */
export type Geo = { columns: number; W: number; px: number; frame: number; inner: number; budget: number; L: number; oneLine: boolean; full: boolean; wide: boolean; centred: boolean; margin: number }

export function geometry(columns: number): Geo {
  const W = Math.max(0, Math.min(columns - PANE_GUTTER, CENTRE_AT))
  const px = W >= WIDE_FROM ? 2 : 1
  const frame = 2 + 2 * px
  const inner = W - frame
  return { columns, W, px, frame, inner, budget: fitCells(inner), L: fitLine(W), oneLine: W >= ONE_LINE_FROM, full: W >= MODEL_FULL_FROM, wide: W >= WIDE_FROM, centred: W >= CENTRE_AT, margin: Math.max(0, Math.floor((columns - W) / 2)) }
}

/** The cells the title line leaves the title: the inner width less the title's own padding, the pin and its gap when pinned, the counts and the gap before them. */
function titleRoom(geo: Geo, counts: string, pinned: boolean): number {
  return geo.inner - 2 - (pinned ? EMOJI_CELLS + TITLE_GAP : 0) - textWidth(counts) - TITLE_GAP
}

/**
 * The room's counts, shrunk before the title is (round 8): the non-zero statuses (`🟢3 ⏳1 ✅2`), then without the ✅, then
 * the 🟢 alone — the first form that leaves the title TITLE_MIN fit cells (by FIT), else the shortest. `pinned` reserves the
 * pin's cells beside the title (the model passes true: the pin Button is on every card since decision 26); every caller
 * states it — no default, so a test comparing with the drawn counts never takes the pin-less form by accident (phase B final
 * review).
 */
export function countsFor(room: Pick<OfficeRoom, 'run' | 'stale' | 'done'>, geo: Geo, pinned: boolean): string {
  const forms = [countsText(room), countsText({ run: room.run, stale: room.stale, done: 0 }), countsText({ run: room.run, stale: 0, done: 0 })]
  for (const c of forms) if (fitCells(titleRoom(geo, c, pinned)) >= TITLE_MIN) return c
  return forms[2]!
}

/** A Latin letter (latinDominant counts them against the Hebrew ones). */
const LATIN_RE = /\p{Script=Latin}/u

/** Whether `s` holds more Latin letters than Hebrew ones: a Latin-dominant title (cutTitle cuts it by FIT). */
export function latinDominant(s: string): boolean {
  let latin = 0
  let hebrew = 0
  for (const ch of s) {
    if (LATIN_RE.test(ch)) latin++
    else if (HEBREW_RE.test(ch)) hebrew++
  }
  return latin > hebrew
}

/**
 * The title line's text: the room's title cut on a word with a trailing … (the probe's cut; cutWords) to what the line
 * leaves it beside the counts — and beside the pin and its gap when `pinned` (the model passes true for every room: the pin
 * Button is on every card) — by LINE_FIT; a Latin-dominant title by FIT (live check 5: LINE_FIT was calibrated on the header's bold Hebrew, digits and emoji — round 7 — and BOLD LATIN
 * draws wider per cell: measured at 14 px, a bold Latin title takes 4-12% more pixels a cell than the header's text in
 * Segoe UI and 10-18% in Arial (capitals the most), so LINE_FIT's 0.83 is 0.70-0.80 for it there: FIT's 0.75 makes a clip at
 * the edge the exception, as the title broken over two clipped lines in Asaf's screenshot of 20.10 showed it was not); never
 * under 8 cells. (A Hebrew title keeps LINE_FIT: round 9 drew it whole on the desktop.) `pinned` has no default: every
 * caller states it, as countsFor's.
 */
export function cutTitle(title: string, geo: Geo, counts: string, pinned: boolean): string {
  const room = titleRoom(geo, counts, pinned)
  return cutWords(title, Math.max(8, latinDominant(title) ? fitCells(room) : fitLine(room)))
}

// ---------------------------------------------------------------------------
// the table mode: ONE for the whole office, from the widest values across ALL its rooms
// ---------------------------------------------------------------------------

/** The widest values across the office, in cells (the names kept whole: their width depends on the mode's cap). */
export type Widest = { mark: number; names: string[]; modelFull: number; modelFamily: number; actEmoji: number; actWord: number }

/** The widest values across `rooms`: what the table mode and the column floors are decided from. */
export function officeWidest(rooms: readonly OfficeRoom[]): Widest {
  const w: Widest = { mark: 0, names: [], modelFull: 0, modelFamily: 0, actEmoji: 0, actWord: 0 }
  const seen = new Set<string>()
  for (const room of rooms) {
    for (const a of room.agents) {
      w.mark = Math.max(w.mark, textWidth(markOf(a)))
      if (!seen.has(a.name)) { seen.add(a.name); w.names.push(a.name) }
      w.modelFull = Math.max(w.modelFull, textWidth(modelText(a.model, true)))
      w.modelFamily = Math.max(w.modelFamily, textWidth(modelText(a.model)))
      w.actEmoji = Math.max(w.actEmoji, textWidth(firstGlyph(a.act)))
      w.actWord = Math.max(w.actWord, textWidth(restWord(a.act)))
    }
  }
  return w
}

/** The widest name once every name is cut to `nameMax` cells. */
export function widestName(w: Widest, nameMax: number): number {
  let n = 0
  for (const name of w.names) n = Math.max(n, textWidth(cut(name, nameMax)))
  return n
}

export type ModelCol = 'full' | 'family' | 'none'
/** What the office's tables draw: the activity word (else its emoji alone), the model column (with its version, the family, or none), the names' cap. `rank` is the mode's place on the ladder (0 the richest). */
export type TableMode = { rank: number; word: boolean; model: ModelCol; nameMax: number }
/** The widths a table needs per column at a mode: the widest value plus the padding cell (the status cell carries the focus marker's cell too). */
export type Need = { status: number; who: number; model: number; actEmoji: number; actWord: number; total: number }

export function needOf(w: Widest, word: boolean, model: ModelCol, nameMax: number): Need {
  const status = w.mark + 1 + 1
  const who = EMOJI_CELLS + 1 + widestName(w, nameMax) + 1
  const mdl = model === 'none' ? 0 : (model === 'full' ? w.modelFull : w.modelFamily) + 1
  const actEmoji = w.actEmoji + 1
  const actWord = word ? w.actWord + 1 : 0
  return { status, who, model: mdl, actEmoji, actWord, total: status + who + mdl + actEmoji + actWord }
}

/**
 * THE LADDER: the mode at `rank` when it fits `budget` cells, else null — (0) the word and the model (its version when `full`),
 * (1) the emoji alone, (2) the family word, (3) the names shrunk to what is left, down to NAME_MIN, (4) no model column,
 * (5) the names shrunk to the floor (never null: the office's last resort).
 */
export function modeAt(w: Widest, rank: number, budget: number, full: boolean): TableMode | null {
  const fam: ModelCol = full ? 'full' : 'family'
  const fits = (m: TableMode) => (needOf(w, m.word, m.model, m.nameMax).total <= budget ? m : null)
  const shrink = (model: ModelCol, floor: number) => {
    const n = needOf(w, false, model, NAME_MAX)
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

/**
 * THE HYSTERESIS's token: the rank of the table mode last chosen and the widest values it was chosen from (`widestKey`), kept
 * by the caller between renders (the Client's instance), never in the props. The hysteresis is about the WIDTH: a rank kept
 * for the same widest values holds while the pane is dragged; once the content moved the office's widest values (a ⭐ or ❌
 * widened the marks, an agent with a long activity or model came or went, the names changed with the language) the mode is
 * chosen afresh, as a new instance would — a column dropped for a transient agent comes back the moment it leaves.
 */
export type ModeToken = { rank: number; key: string }

/** The identity of the widest values the mode depends on: the widths per column and the set of names (their order is not one). */
export function widestKey(w: Widest): string {
  return [w.mark, w.modelFull, w.modelFamily, w.actEmoji, w.actWord, ...[...w.names].sort()].join('\u0000')
}

/**
 * THE HYSTERESIS: the richest mode that fits — a mode above the last one (`last`, the rank kept by the caller between renders;
 * null before the first) must fit with HYSTERESIS cells to spare, the last one or a poorer one the budget alone. So a mode is
 * dropped the instant it stops fitting and regained only with two cells to spare: no flapping at a threshold. A regained mode
 * is the ladder's own at the real budget (its names' cap is not the reduced budget's).
 */
export function chooseMode(w: Widest, geo: Geo, last: number | null): TableMode {
  for (let r = 0; r < 5; r++) {
    const regain = last !== null && r < last
    const m = modeAt(w, r, regain ? geo.budget - HYSTERESIS : geo.budget, geo.full)
    if (!m) continue
    return regain ? modeAt(w, r, geo.budget, geo.full) ?? m : m
  }
  return modeAt(w, 5, geo.budget, geo.full)!
}

/** The minWidth floors of the columns from WIDE_FROM, in cells: the office-wide widest value by FIT plus the padding cell — so the columns align across the cards. (The task column has none: it takes what is left.) */
export type Floors = { status: number; who: number; model: number; actEmoji: number; actWord: number }

/** The status column's floor: the widest mark and the focus marker's cell by FIT, and the padding cell (floorsOf's, at every width: R10). */
export function statusFloor(w: Widest): number {
  return Math.ceil((w.mark + 1) / FIT) + 1
}

export function floorsOf(w: Widest, mode: TableMode): Floors {
  const floor = (cells: number) => Math.ceil(cells / FIT) + 1
  return {
    status: statusFloor(w), who: floor(EMOJI_CELLS + 1 + widestName(w, mode.nameMax)),
    model: floor(mode.model === 'none' ? 0 : mode.model === 'full' ? w.modelFull : w.modelFamily),
    actEmoji: floor(w.actEmoji), actWord: floor(w.actWord),
  }
}

// ---------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------

export type LineKind = 'border' | 'pad' | 'title' | 'blank' | 'row' | 'more' | 'gap'
/** One drawn line of the office (its index is its y): what it is, whose room, and the agent on a row. */
export type Line = { kind: LineKind; room: string; agent: string | null }

/** One agent row of a card: the cells' texts (every one without a plain space: `nb`) and the flags that weight them. */
export type RowView = {
  id: string
  /** The line of the row. */
  y: number
  /** The status cell: the mark (markOf: the badge or the dot) alone, with the focus marker on its inner side when focused — the mark sits at the reading edge either way, so the focus never shifts the dots. */
  status: string
  color: string
  who: string
  /** '' when the mode draws no model column. */
  model: string
  actEmoji: string
  /** '' when the mode draws the emoji alone. */
  actWord: string
  /** The task column's text (the row's short task cut to TASK_MAX): drawn from CENTRE_AT. */
  task: string
  /** Working: the who bold. */
  bold: boolean
  /** Finished: the who (unless failed), the emoji and the task dim. (The model is always dim; the word dim unless working.) */
  dim: boolean
  /** ❌: the who keeps a regular weight. */
  failed: boolean
  focus: boolean
}

export type RoomView = {
  id: string
  /** The line of the card's top border. */
  top: number
  /** The card's lines, the gap after it included. */
  height: number
  title: string
  counts: string
  /** The room is pinned (prefs.pins): the colour 📌 on its title; else PIN_OFF. The pin Button is drawn on every card. */
  pinned: boolean
  /**
   * The title line's y. (titleAt, blankAt and moreAt are read by no production code since the hit-test by y went — phase B,
   * decision 26 — and are KEPT on purpose: the tests pin the more line's and the blank line's place by them, and they are the
   * line map's shape beside `top` and `height`; not dead.)
   */
  titleAt: number
  /** The blank line's y, over the first row (under the more line when the card has one). Kept for the tests (see titleAt). */
  blankAt: number
  rows: RowView[]
  /** The `עוד N שסיימו ◂` / `הסתר שסיימו ▾` line under the title (`▸ N more finished` in English: iconLabel), '' when the room draws none. */
  more: string
  /** The more line's y. Kept for the tests (see titleAt). */
  moreAt: number
}

/** `token` is what the caller keeps for the next render's hysteresis (the mode's rank and the widest values' key). */
/**
 * `statusMin` is the status column's floor at EVERY width (live check 7, R10: the keyboard focus marker `‹●` a click puts
 * on a row widened the column under WIDE_FROM, nudging the card's columns a frame before the drawer came) — the same floor
 * as `floors.status`.
 */
export type OfficeModel = { rooms: RoomView[]; lines: Line[]; geo: Geo; mode: TableMode; token: ModeToken; floors: Floors | null; statusMin: number }

/**
 * What the surface module lays on the model from its local state, by id:
 *   focus     the keyboard focus: a small marker beside the status mark.
 * (No hover: the desktop draws none inside a Client — paint probe 22.10; no finish pulse: the ⭐ is the whole finish —
 * live check 6, where the row's tint flashed a near-black band on the light theme.)
 */
export type OfficeDecor = { focus: string | null }
export const NO_DECOR: OfficeDecor = { focus: null }

/** The lines a room's card takes: CARD_LINES around its rows, MORE_LINES when it draws the more / hide line. */
export function cardLines(agents: number, more: boolean): number {
  return CARD_LINES + Math.max(0, agents) + (more ? MORE_LINES : 0)
}

/**
 * The number of lines `officeModel(props)` lays out, without building a row: what the hooks need for the Client's height
 * on every render (a card per room, a line per agent). The decor, the width and the mode never change it.
 */
export function rowCount(props: OfficeProps): number {
  let n = 0
  for (const room of props.rooms) n += cardLines(room.agents.length, room.moreLabel !== '')
  return n
}

/** A room's card as its props, the geometry and the mode alone decide it — the title cut, the counts, every row's texts — before the decor and the line map. */
type RoomBase = {
  counts: string
  title: string
  rows: Array<{ id: string; mark: string; color: string; who: string; model: string; actEmoji: string; actWord: string; task: string; bold: boolean; dim: boolean; failed: boolean }>
}
/**
 * THE ROOM MEMO: a surface module keeps one across its renders (office-client.tsx), so a redraw rebuilds the base of a room
 * only when that room's props, the width or the mode changed — a poll that changes one room leaves the others' texts as they
 * were, and a decor change (the focus) measures no text at all; the office-wide widest values are kept
 * the same way (`office`), measured again only when a room changed. `builds` counts the bases built, `measures` the
 * office-wide measurements (the tests' guards).
 */
export type RoomCache = { rooms: Map<string, { key: string; base: RoomBase }>; office: { key: string; widest: Widest; widestKey: string } | null; builds: number; measures: number }
export function roomCache(): RoomCache {
  return { rooms: new Map(), office: null, builds: 0, measures: 0 }
}

const modeKey = (m: TableMode): string => `${m.word ? 'w' : 'e'}|${m.model}|${m.nameMax}`

function roomBase(room: OfficeRoom, geo: Geo, mode: TableMode, cache: RoomCache | undefined, json: string): RoomBase {
  // (the key is the room's JSON: cheap next to the text measuring it saves, and exact — a props object is new on every render)
  const key = cache ? `${geo.W}\n${modeKey(mode)}\n${json}` : ''
  if (cache) {
    const hit = cache.rooms.get(room.id)
    if (hit && hit.key === key) return hit.base
  }
  // the pin's cells are reserved on every title: the pin Button is always drawn (decision 26)
  const counts = countsFor(room, geo, true)
  const base: RoomBase = {
    counts: nb(counts), title: nb(cutTitle(room.title, geo, counts, true)),
    rows: room.agents.map(a => ({
      id: a.id, mark: markOf(a), color: DOT_FG[a.status], who: nb(`${a.emoji} ${cut(a.name, mode.nameMax)}`),
      model: mode.model === 'none' ? '' : nb(modelText(a.model, mode.model === 'full')),
      actEmoji: firstGlyph(a.act), actWord: mode.word ? nb(restWord(a.act)) : '', task: nb(cutTask(a.task)),
      bold: a.status === 'running', dim: a.status === 'done', failed: a.failed,
    })),
  }
  if (cache) {
    cache.rooms.set(room.id, { key, base })
    cache.builds += 1
  }
  return base
}

/**
 * The rooms as cards and the line map of the whole office. Card lines, in order: the top border, a padding line, the
 * title (pin · title · counts — the pin on every card: `pinned` says which glyph), [the more / hide line — DIRECTLY UNDER
 * THE TITLE, live check 7 Q3: it never moves with the rows it reveals], the blank line, one line per agent, a padding line,
 * the bottom border, the gap. The line map is for windowing (office-client.tsx) and the keyboard walk; it carries no
 * pointer geometry — every click is a native Button (phase B, decision 26; the ✅ counts are read-only: Q6 — the more
 * line is the room's one toggle). The decor changes only the focus marker — never a line. The table mode is chosen once for
 * the office (chooseMode) from `last`, the token the caller kept from its previous model (the hysteresis: its rank counts only while the widest values are the ones
 * it was chosen from — ModeToken; null on the first). With a `cache` (THE ROOM MEMO), a room whose props, width and mode did
 * not change is not measured again, nor is the office when no room changed.
 */
export function officeModel(props: OfficeProps, decor: OfficeDecor = NO_DECOR, cache?: RoomCache, last: ModeToken | null = null): OfficeModel {
  const { rtl } = props
  const geo = geometry(props.columns)
  const jsons = props.rooms.map(r => (cache ? JSON.stringify(r) : ''))
  let widest: Widest
  let wkey: string
  if (cache) {
    const key = jsons.join('\u0000')
    if (cache.office && cache.office.key === key) ({ widest, widestKey: wkey } = cache.office)
    else {
      widest = officeWidest(props.rooms)
      wkey = widestKey(widest)
      cache.office = { key, widest, widestKey: wkey }
      cache.measures += 1
    }
  } else {
    widest = officeWidest(props.rooms)
    wkey = widestKey(widest)
  }
  const mode = chooseMode(widest, geo, last !== null && last.key === wkey ? last.rank : null)
  const token: ModeToken = { rank: mode.rank, key: wkey }
  const floors = geo.wide ? floorsOf(widest, mode) : null
  const rooms: RoomView[] = []
  const lines: Line[] = []
  const line = (kind: LineKind, room: string, agent: string | null = null) => { lines.push({ kind, room, agent }) }
  const seen = new Set<string>()
  props.rooms.forEach((room, i) => {
    seen.add(room.id)
    const top = lines.length
    const base = roomBase(room, geo, mode, cache, jsons[i]!)
    const { counts } = base
    line('border', room.id)
    line('pad', room.id)
    const titleAt = lines.length
    line('title', room.id)
    // the room's one finished toggle, under its title: `עוד N שסיימו ◂` while it holds finished back, `הסתר שסיימו ▾` while it
    // shows them all (the props draw it only past RECENT_DONE finished: Q6) — a labelled control, so iconLabel lays it: read
    // arrow first in either pane (`▸ 2 more finished` in English)
    let moreAt = -1
    const arrow = room.showDone ? LESS_MARK : MORE_MARK[rtl ? 'rtl' : 'ltr']
    const more = room.moreLabel ? nb(iconLabel(arrow, room.moreLabel, rtl)) : ''
    if (more) {
      moreAt = lines.length
      line('more', room.id)
    }
    const blankAt = lines.length
    line('blank', room.id)
    const rows: RowView[] = []
    for (const r of base.rows) {
      const y = lines.length
      const focus = decor.focus === r.id
      // the mark at the reading edge, the marker on its inner side when focused (a Text with no Hebrew is laid left to right)
      const status = !focus ? r.mark : rtl ? `${FOCUS_MARK.rtl}${r.mark}` : `${r.mark}${FOCUS_MARK.ltr}`
      rows.push({ id: r.id, y, status, color: r.color, who: r.who, model: r.model, actEmoji: r.actEmoji, actWord: r.actWord, task: r.task, bold: r.bold, dim: r.dim, failed: r.failed, focus })
      line('row', room.id, r.id)
    }
    line('pad', room.id)
    line('border', room.id)
    line('gap', room.id)
    rooms.push({
      id: room.id, top, height: lines.length - top,
      title: base.title, counts,
      pinned: room.pinned,
      titleAt, blankAt, rows, more, moreAt,
    })
  })
  if (cache) for (const id of [...cache.rooms.keys()]) if (!seen.has(id)) cache.rooms.delete(id)
  return { rooms, lines, geo, mode, token, floors, statusMin: statusFloor(widest) }
}

/**
 * The window [from, from + count) of lines, shortened so it holds at most `maxRows` agent rows (the tree's budget):
 * what lies past the last row within the budget is left undrawn.
 */
export function trimWindow(model: OfficeModel, from: number, count: number, maxRows: number): { from: number; count: number } {
  let rows = 0
  const end = Math.min(model.lines.length, from + Math.max(0, count))
  for (let y = Math.max(0, from); y < end; y++) {
    if (model.lines[y]!.kind !== 'row') continue
    rows++
    if (rows > maxRows) return { from, count: y - from }
  }
  return { from, count: Math.max(0, count) }
}
