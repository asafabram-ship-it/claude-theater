// office-chrome.ts: the pure maths of the desktop office's chrome — the rows
// the surface module draws above the cards (the header and the toolbar with
// their blank lines; the search on the toolbar's line from ONE_LINE_FROM
// columns, else on a line of its own with a blank line above it — and only
// while the office holds more than SEARCH_FROM agents or a search is active;
// the footer line; the settings popover or the drawer), their exact heights
// (the search counted on the agents IN the office, never the ones shown: live
// check 7), the drawer's wrapped lines and its one status line, padded to one
// height at a width (drawerMax; drawerPad on a pane too short for it to ride the
// window's top), and the window of layout
// lines the engine's scroll offset shows; and the ONE definition of the characters the surfaces refuse
// (REFUSED_RE), with the two cleaners built on it: cleanSearch (the search
// text) and cleanAgentText (every agent text the payload carries, cleaned by
// the hooks' poll). Shared by the surface module (office-client.tsx draws with it)
// and the hooks (ui.tsx sizes the Client with `officeHeight`): no `$`, no
// engine, no clock, so both sides import it — the hooks never import the
// surface module itself.

import { DOT_FG, cut, fitCells, fitLine, geometry, markOf, textWidth } from './office-layout'
import type { OfficeDrawer, OfficeProps } from './office-props'

/**
 * The chrome rows always there, by the width (the probe's rounds 8-9): the header and a blank line, the toolbar and a blank
 * line — 4 rows — and, under ONE_LINE_FROM columns while the search field is drawn, the search line with a blank line above
 * it: 6. From ONE_LINE_FROM the search shares the toolbar's line. (`fixedRows`; the demo line, the overlay and the footer
 * come on top.)
 */
export const CHROME_ROWS_MIN = 4
export const CHROME_ROWS_SEARCH = 6
/** The search field is drawn only while the office holds more than this many agents (spec 2026-10-10 §2 items 22 and 24) — or while a search is active. */
export const SEARCH_FROM = 12
/** Under this many columns the pane draws no key-hint chips (ui.tsx's rule; the Client's toolbar puts hotkeys on its Buttons only from here, since the desktop draws a chip per hotkey). */
export const COMPACT_BELOW = 60
/** The drawer's task and result wrap to at most this many lines each (the drawer's height must be exact: the rows under it are hit-tested); under DRAWER_NARROW_BELOW columns one line fewer each (the probe's: a pane that narrow is short too). */
export const TASK_LINES = 4
export const RESULT_LINES = 3
export const TASK_LINES_NARROW = 3
export const RESULT_LINES_NARROW = 2
export const DRAWER_NARROW_BELOW = 34
export type DrawerLimits = { task: number; result: number }
/** The drawer's line limits at `columns`. */
export function drawerLimits(columns: number): DrawerLimits {
  return columns < DRAWER_NARROW_BELOW ? { task: TASK_LINES_NARROW, result: RESULT_LINES_NARROW } : { task: TASK_LINES, result: RESULT_LINES }
}
/**
 * The help rows: a label key and the keys shown beside it (spec §6.4; no `s`: the motion toggle is gone — live check 7, Q9). The close
 * row promises `x` alone: Escape never reaches a Client — it hands the keyboard back to the prompt (engine types,
 * ClientKeyEvent) — so the help must not offer it.
 */
export const HELP: ReadonlyArray<readonly [string, string]> = [
  ['scFinished', 'f'], ['scMove', 'k / j'], ['scOpen', 'o · Enter'], ['scClose', 'x'], ['scMute', 'm'], ['scLang', 'l'], ['scDemo', 'd'], ['scSettings', 'h'],
]
/** The settings popover's row of Buttons (demo, language): the rare controls, moved off the toolbar (Task 2.8b-3; the motion toggle gone since live check 7). */
export const HELP_BUTTON_ROWS = 1
/** The rows of the first pair when the shortcuts are drawn in two column pairs (from WIDE_FROM: the probe's). */
export const HELP_PAIR_ROWS = 5
/**
 * The shortcut rows as the settings popover lays them: one column-major table (label | key) under WIDE_FROM; from it two
 * pairs side by side, the second padded with a blank row to the first's height (so the popover's height is the first
 * pair's rows either way).
 */
export function helpPairs(wide: boolean): ReadonlyArray<ReadonlyArray<readonly [string, string]>> {
  if (!wide) return [HELP]
  const second: Array<readonly [string, string]> = [...HELP.slice(HELP_PAIR_ROWS)]
  while (second.length < HELP_PAIR_ROWS) second.push([' ', ' '] as const)
  return [HELP.slice(0, HELP_PAIR_ROWS), second]
}
/**
 * The settings popover's height at `columns`: the border, the padding line above and below (the cards' paddingY), the title
 * row, the Buttons row, the shortcut rows (one pair's from WIDE_FROM) — and, with `note`, THE TOO-LONG CONVERSATIONS NOTE's
 * one line under them (props.oversized, live check 6).
 */
export function helpRows(columns: number, note = false): number {
  return 2 + 2 + 1 + HELP_BUTTON_ROWS + helpPairs(geometry(columns).wide)[0]!.length + (note ? 1 : 0)
}
/** The blank line under the settings popover | the drawer, before the first card (the cards' own gap). */
export const OVERLAY_GAP = 1
/** The drawer card's frame: its border and its padding line, top and bottom (the cards' style). */
export const DRAWER_FRAME_ROWS = 4

/**
 * The agents IN THE OFFICE: its header counts — working, waiting and finished, every open chat's — whatever the finished
 * toggles show (live check 7, Q1: counted on the agents SHOWN, a "show finished" click took the office over SEARCH_FROM or
 * back under it, adding or removing the search line above every card — the cards jumped two rows under the pointer).
 */
export function officeAgents(p: Pick<OfficeProps, 'counts'>): number {
  return p.counts.run + p.counts.idle + p.counts.done
}

/**
 * Whether the search field is drawn: more than SEARCH_FROM agents in the office (officeAgents: a click never adds or removes
 * it, only a scan does — spec 2026-10-10 §2 item 24), or a search active — text in the field (item 22): `p.search` as the
 * hooks hold it, or `typed`, the text the Client's field holds before its post lands (the module passes its own; the hooks,
 * which size the Client by the props alone, pass nothing — so the module posts the first keystroke of a search at once, and
 * the two agree a redraw later). The field stays whatever the count then. The hooks' officeHeight and the module's
 * fixedRows both ask it, so they agree.
 */
export function searchShown(p: Pick<OfficeProps, 'counts' | 'search'>, typed = ''): boolean {
  return officeAgents(p) > SEARCH_FROM || p.search !== '' || typed !== ''
}

/**
 * THE DEMO LINE (live check 5: Asaf watched the demo's agents without knowing they were the demo's): while the demo runs
 * (`p.demo`) the chrome holds one more line, the first under the header — the note (`🎬 זו הדגמה - הסוכנים לא אמיתיים`) and
 * its exit Button — the header's blank line moving under it. Counted here, so the hooks' height and the module's line map agree.
 */
export const DEMO_ROWS = 1
/** The cells kept between the demo line's note and its exit Button when the ladder measures them (the line's own gap, with a cell to spare). */
export const DEMO_GAP = 2

/**
 * The demo line's texts at `p.columns`: the longest note (i18n demoNote, demoNoteMid, demoNoteShort, the 🎬 leading — the
 * header's way: a Hebrew-first Text is laid right to left, so the 🎬 is read first) that fits beside the exit Button's word
 * by LINE_FIT (the chrome's ladder: never a cut word), else beside its ✕ alone, else the 🎬 alone with the ✕.
 */
export function demoLine(p: Pick<OfficeProps, 'labels' | 'columns'>): { note: string; exit: string } {
  const L = geometry(p.columns).L
  const notes = [p.labels.demoNote, p.labels.demoNoteMid, p.labels.demoNoteShort].filter((n): n is string => !!n).map(n => `🎬 ${n}`)
  for (const exit of [p.labels.demoExit ?? '', '✕']) {
    if (!exit) continue
    const note = notes.find(n => textWidth(n) + DEMO_GAP + textWidth(exit) <= L)
    if (note !== undefined) return { note, exit }
  }
  return { note: '🎬', exit: '✕' }
}

/** The chrome rows always there at this width and office: 4, or 6 with the search on its own line (under ONE_LINE_FROM) — and DEMO_ROWS more while the demo runs. */
export function fixedRows(p: Pick<OfficeProps, 'counts' | 'search' | 'columns' | 'demo'>, typed = ''): number {
  return (searchShown(p, typed) && !geometry(p.columns).oneLine ? CHROME_ROWS_SEARCH : CHROME_ROWS_MIN) + (p.demo ? DEMO_ROWS : 0)
}

/** Whether `labels`, `gap` cells apart, fit in `width` cells by LINE_FIT (the desktop draws letters wider than a cell): the toolbar and the settings' Buttons row draw their words only then, else their icons alone. */
export function labelsFit(labels: readonly string[], width: number, gap = 1): boolean {
  return labels.reduce((n, l, i) => n + (i ? gap : 0) + textWidth(l), 0) <= fitLine(width)
}
/**
 * The window's budget. The Client's whole tree must stay under 100,000 characters serialized or the
 * instance unmounts; a drawn agent row (a Text per column, six at most, no Box) serializes to under
 * ROW_CHARS characters whatever the width — the dearest row, pulsing and focused with the widest texts
 * the props allow in the six columns of the frozen column (the task bounded in code units too,
 * office-layout.ts TASK_UNITS: a cell cut alone lets a ZWJ family emoji task cost 816), measured 716
 * on the fake surface with a Hebrew task (2026-10-20; 488 for the four Texts of the fix wave of
 * 2026-10-19), so ROW_CHARS keeps a margin over it — and
 * the rows drawn in one window are capped at WINDOW_ROWS: a pane taller than that leaves its lowest rows
 * blank rather than losing the pane. (The chrome, the drawer and the card frames of a window cost about
 * 10,000 more: office-client.test.ts's limits sweep guards the whole tree, the pulsing rows included.)
 */
export const WINDOW_CHARS = 80_000
export const ROW_CHARS = 800
export const WINDOW_ROWS = Math.floor(WINDOW_CHARS / ROW_CHARS)
/** The longest search text, in code points: what the module keeps and posts and the hooks store (a pasted page must not swell a post, the Input's value or the Client's props past their bounds). */
export const SEARCH_MAX = 200
/** C0 and C1 controls (an escape sequence in a paste): the surface refuses an Input value or a Text holding one (a Text takes tab and newline alone). */
const CONTROL_RE = /\p{Cc}/gu
/**
 * The bidi controls (ALM, LRM, RLM, LRE..RLO, LRI..PDI): the desktop refuses them in a Text, and a paste
 * from a Hebrew source often carries them. Named one by one, not \p{Cf}: that class also holds the
 * zero-width joiner of emoji sequences (man + ZWJ + laptop), which must stay. Written as escapes: the raw
 * controls would reorder this line in an editor and survive no formatter (the class would collapse to `[-]`).
 */
const BIDI_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g
/**
 * A character a surface refuses in a Text or a Button's label: a bidi control, or a control character
 * other than tab and newline (the two a Text takes). Built from the two sets above — the ONE definition
 * of what the surfaces refuse — for the guards and the tests. (A no-break space, U+00A0, is a space
 * separator, not a control: the one-line values of the cards ride it — office-layout.ts nb.)
 */
export const REFUSED_RE = new RegExp(`${BIDI_RE.source}|(?![\\t\\n])${CONTROL_RE.source}`, 'u')
/**
 * A terminal escape sequence, removed whole so an ANSI colour code leaves nothing behind (not "[31m"):
 * a CSI (ESC [ or the C1 CSI, then parameter, intermediate and final bytes) or an OSC (ESC ] up to BEL or
 * ESC \ — a hyperlink's wrapper; bounded, so an unfinished one costs one short look ahead).
 */
const ESCAPE_SEQ_RE = /(?:\x1b\[|\x9b)[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]{0,2048}(?:\x07|\x1b\\)/u
/** One pass over agent text: an escape sequence, a line break (CRLF as one), a bidi control, any other control. */
const AGENT_TEXT_RE = new RegExp(`${ESCAPE_SEQ_RE.source}|\\r\\n?|${BIDI_RE.source}|${CONTROL_RE.source}`, 'gu')
/** One of AGENT_TEXT_RE's single-character matches is a bidi control (removed) rather than a control (a space). */
const BIDI_ONE_RE = new RegExp(`^(?:${BIDI_RE.source})$`)

/**
 * Agent text (a transcript's prompt or answer, a spawn's description, a tool or model name, a path, a scan
 * error) as every surface takes it, in ONE regex pass: an escape sequence removed whole, a bidi control
 * removed, every other control character a space; tab and newline kept only when `multiline` (a field drawn
 * over several lines: task, result), CR and CRLF then a newline — otherwise a line break or a tab is a space.
 * Hebrew, emoji, ZWJ sequences, variation selectors are kept. Idempotent: what it returns holds no ESC, no CR,
 * no bidi control and no control at all but (when `multiline`) tab and newline, which it keeps as they are.
 * The hooks clean the office once per poll (register.tsx cleanOffice); the surface module never needs it.
 */
export function cleanAgentText(s: string, multiline = false): string {
  return s.replace(AGENT_TEXT_RE, m => {
    if (m === '\n' || m === '\t') return multiline ? m : ' '
    if (m[0] === '\r') return multiline ? '\n' : ' '
    return m.length > 1 || BIDI_ONE_RE.test(m) ? '' : ' '
  })
}

/**
 * The search text as the office keeps it: the bidi controls removed, every other control character
 * a space, then the first SEARCH_MAX code points (never half a surrogate pair). Idempotent. The
 * surface module cleans what is typed before drawing or posting it; the hooks clean what they store
 * (ui.tsx).
 */
export function cleanSearch(q: string): string {
  // (the marks go first: they shorten the text. Then the first SEARCH_MAX code points lie within the first
  // 2 × SEARCH_MAX code units, so the rest of a pasted page is never split into code points)
  return Array.from(q.replace(BIDI_RE, '').slice(0, 2 * SEARCH_MAX).replace(CONTROL_RE, ' ')).slice(0, SEARCH_MAX).join('')
}

/**
 * One drawn line of the drawer: `text` as the Client draws it — one Text, cut or wrapped to the inner width (the model line
 * and the ✂ note are composed strings, the desktop laying a Hebrew-first Text right-to-left); the `status` line carries the
 * status `mark` (markOf, in `color`) before its dim text; `blank` is the empty line between the identity and the content;
 * `head` a dim heading (משימה, תוצאה), `body` a plain line (the model line, the task's and the result's lines).
 */
export type DrawerLine = { kind: 'name' | 'dim' | 'status' | 'blank' | 'head' | 'body' | 'note'; text: string; mark?: string; color?: string }

/**
 * THE OVERLAY IN VIEW: whether the settings popover | the drawer (`overlay` rows, part of the chrome) is drawn at
 * the top of the engine's window rather than under the fixed chrome — whenever it leaves the window a row for the
 * office. Under the native scroll the chrome scrolls away with the content, so a drawer opened while the pane is
 * scrolled down would otherwise be drawn above the window: the person would see the cards jump and no drawer.
 * Drawn at the window's top instead — after a spacer of every layout line above the window, at Client row
 * `offset` — it opens in view and the cards under it stay where they were (the person's place is kept; the card
 * the window's top cuts through goes on under the overlay from the window's first line as a frameless fragment:
 * office-client.tsx); scrolled back to the top it sits under the fixed chrome as before. An overlay as tall as the
 * window keeps its place in the chrome, so the person can still scroll through all of it.
 */
export function overlayInWindow(overlay: number, bodyRows: number): boolean {
  return overlay > 0 && overlay < bodyRows
}

/**
 * The layout lines the engine's window shows, in layout coordinates: `from` is
 * the first line (the cards above it are one spacer; a card the window cuts is
 * drawn from its own top, its rows above `from` left blank), `count` how many —
 * never more than the content holds. `chrome` is chromeRows (the overlay
 * included) and `overlay` the settings | drawer rows inside it: when the overlay
 * is drawn at the window's top (overlayInWindow), the layout continues from the
 * line the window starts at, under the overlay; either way layout line y sits at
 * Client row chrome + y. (The row budget, WINDOW_ROWS, is the module's cut on
 * the line map: office-layout.ts trimWindow.)
 */
export function windowOf(chrome: number, offset: number, bodyRows: number, len: number, overlay = 0): { from: number; count: number } {
  const inWindow = overlayInWindow(overlay, bodyRows)
  // the rows above the layout that the window scrolls past before the office starts: the fixed chrome alone when the
  // overlay rides the window's top, the whole chrome otherwise
  const lead = inWindow ? chrome - overlay : chrome
  const from = Math.max(0, offset - lead)
  const visible = Math.max(0, bodyRows - (inWindow ? overlay : 0) - Math.max(0, lead - offset))
  return { from, count: Math.max(0, Math.min(visible, len - from)) }
}

/** The cells the drawer's lines are wrapped to: the card's inner width (border and padding off, at this width's geometry) by FIT, so a line drawn wider than a cell still fits its height-1 Box. */
export function drawerInner(columns: number): number {
  return Math.max(1, fitCells(geometry(columns).inner))
}

/** `s` without a trailing ellipsis (what `cut` appends when it drops glyphs). */
function trimEllipsis(s: string): string {
  return s.endsWith('…') ? s.slice(0, -1) : s
}

/** `text` broken into at most `max` lines of `width` cells (whole words; a longer word is split), the last one ending in … when lines were dropped. */
export function wrapLines(text: string, width: number, max: number): string[] {
  const out: string[] = []
  if (width < 1 || max < 1) return out
  const words = text.split(/\s+/).filter(Boolean)
  let line = ''
  let dropped = false
  for (let i = 0; i < words.length; i++) {
    let word = words[i]!
    if (out.length >= max) { dropped = true; break }
    const cand = line ? `${line} ${word}` : word
    if (textWidth(cand) <= width) { line = cand; continue }
    if (line) { out.push(line); line = '' }
    while (textWidth(word) > width) {
      if (out.length >= max) { dropped = true; break }
      // the widest prefix within `width` cells, through the layout's own cut (one pass per line, not per code point)
      let chunk = cut(word, width + 1)
      if (chunk === word || textWidth(chunk) > width) chunk = cut(word, width)
      chunk = trimEllipsis(chunk)
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
    out[out.length - 1] = textWidth(last) < width ? `${last}…` : `${trimEllipsis(cut(last, width - 1))}…`
  }
  return out
}

/**
 * The drawer's ONE status line (the probe's round 8: `● עובד · זמן 12 דק׳ · general-purpose`): the status word (❌ נכשל
 * for a failed agent), the clock (the duration once done — a failed or killed agent is done — else the elapsed time; none
 * when unknown) and the agent type, a ` · ` apart, the empty parts left out; cut to `max` cells. (The mark is the
 * Client's own Text before it: office-layout.ts markOf.)
 */
export function drawerStatus(d: OfficeDrawer, L: Record<string, string>, max: number): string {
  const lbl = (k: string) => L[k] ?? ''
  const done = d.status === 'done'
  const word = d.failed ? lbl('dFailed') : done ? lbl('dDone') : d.status === 'stale' ? lbl('dStale') : lbl('dWorking')
  const clock = d.elapsedMin !== null ? `${done ? lbl('dDuration') : lbl('dElapsed')}${d.elapsedMin}${lbl('dMinutes')}` : ''
  return cut([word, clock, d.type].filter(Boolean).join(' · '), max)
}

/**
 * THE DRAWER'S ONE HEIGHT (live check 7, Q2): the most lines a drawer takes at these limits — the name, the sub, the status
 * line, the blank line, the model line, the task's heading and its `limits.task` lines, the result's heading and its
 * `limits.result` lines, the ✂ note — what every drawer is padded to, so browsing the agents (a result or none, a long task
 * or a short one) or an agent finishing never changes its height and the cards under it never hop.
 */
export function drawerMax(limits: DrawerLimits): number {
  return 8 + limits.task + limits.result
}

/**
 * THE DRAWER'S PAD: the lines a drawer is padded to on a pane of `bodyRows` — drawerMax (THE DRAWER'S ONE HEIGHT), but on a
 * pane too short for that whole card to ride the window's top (THE OVERLAY IN VIEW: the card, its gap and a row of the office
 * — 20 body rows or fewer from DRAWER_NARROW_BELOW columns) only as many as still leave the window that row (live check 7
 * review: padded to the most, a short drawer opened while scrolled was drawn in the chrome above the window — the cards
 * jumped and no drawer was in view). drawerLines pads, never cuts: a drawer with more lines of its own keeps them. Rows
 * unknown (0): drawerMax. Phase B's floating overlay lifts the limit.
 */
export function drawerPad(limits: DrawerLimits, bodyRows: number): number {
  const most = drawerMax(limits)
  return bodyRows > 0 ? Math.min(most, bodyRows - 1 - DRAWER_FRAME_ROWS - OVERLAY_GAP) : most
}

/** The drawer's lines at `inner` cells (its card is `DRAWER_FRAME_ROWS + lines.length` rows tall), from the drawer and the labels: the name, the sub, the status line, a blank line, then the content — the task and the result wrapped to `limits` lines (drawerLimits: one fewer each under DRAWER_NARROW_BELOW) — then blank lines to `pad` (THE DRAWER'S ONE HEIGHT, drawerMax; drawerPad on a short pane). */
export function drawerLines(d: OfficeDrawer, L: Record<string, string>, inner: number, limits: DrawerLimits = { task: TASK_LINES, result: RESULT_LINES }, pad = drawerMax(limits)): DrawerLine[] {
  const lbl = (k: string) => L[k] ?? ''
  const lines: DrawerLine[] = [{ kind: 'name', text: cut(d.name, Math.max(1, inner - 10)) }]
  if (d.sub) lines.push({ kind: 'dim', text: cut(d.sub, inner) })
  // the status line: the mark (the badge or the dot, in the status's colour) then the dim text, a gap cell between
  lines.push({ kind: 'status', text: drawerStatus(d, L, Math.max(1, inner - 3)), mark: markOf(d), color: DOT_FG[d.status] })
  lines.push({ kind: 'blank', text: '' })
  // the model line and the ✂ note are one string each (a label, a value, a mark, a space apart), drawn as one Text the way the
  // probe writes its lines; no colon after a label — it would be drawn before the Hebrew word
  lines.push({ kind: 'body', text: cut([lbl('dModel'), '🧠', d.model, '·', lbl('dAction'), d.act].join(' '), inner) })
  lines.push({ kind: 'head', text: cut(lbl('dTask'), inner) })
  for (const t of wrapLines(d.task || lbl('taskUnavailable'), inner, limits.task)) lines.push({ kind: 'body', text: t })
  if (d.result) {
    lines.push({ kind: 'head', text: cut(lbl('dResult'), inner) })
    for (const t of wrapLines(d.result, inner, limits.result)) lines.push({ kind: 'body', text: t })
    if (d.truncated) lines.push({ kind: 'note', text: cut(`✂ ${lbl('resultTruncated')}`, inner) })
  }
  while (lines.length < pad) lines.push({ kind: 'blank', text: '' })
  return lines
}

/** The empty office's lines: the message, the sub's sentences (split at each " - " / " — "), each wrapped by FIT to the reading column. */
export function emptyLines(p: OfficeProps): { msg: string[]; sub: string[] } {
  if (!p.empty) return { msg: [], sub: [] }
  const w = Math.max(1, fitCells(geometry(p.columns).W))
  return { msg: wrapLines(p.empty.msg, w, 2), sub: p.empty.sub ? p.empty.sub.split(/\s[-—]\s/).flatMap(s => wrapLines(s, w, 2)) : [] }
}

/** The rows the empty-office block takes (🏢, the lines, the demo Button; the blank line over it is the toolbar's or the search's). */
export function emptyRows(p: OfficeProps): number {
  if (!p.empty) return 0
  const e = emptyLines(p)
  return 1 + e.msg.length + e.sub.length + (p.empty.kind === 'office' ? 1 : 0)
}

/** The rows above the layout: the chrome's fixed rows (fixedRows: four, or six with the search on its own line), the footer line when there is one, then the settings popover or the drawer. */
export function chromeRows(p: OfficeProps): number {
  return fixedRows(p) + (p.footer ? 1 : 0) + overlayRows(p)
}

/** The settings popover's or the drawer's rows, their gap included (0 when neither is open): the part of the chrome that may ride the window's top (overlayInWindow). */
export function overlayRows(p: OfficeProps): number {
  if (p.helpOpen) return helpRows(p.columns, !!p.oversized) + OVERLAY_GAP
  if (p.drawer) {
    const limits = drawerLimits(p.columns)
    return DRAWER_FRAME_ROWS + drawerLines(p.drawer, p.labels, drawerInner(p.columns), limits, drawerPad(limits, p.rows)).length + OVERLAY_GAP
  }
  return 0
}

/** The Client's full content height: what the hooks pass as `height` (`layoutRows` = `rowCount(p)`, office-layout.ts: no row is built for it). */
export function officeHeight(p: OfficeProps, layoutRows: number): number {
  return chromeRows(p) + (p.empty ? emptyRows(p) : layoutRows)
}
