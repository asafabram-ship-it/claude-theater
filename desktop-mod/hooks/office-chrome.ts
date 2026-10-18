// office-chrome.ts: the pure maths of the desktop office's chrome — the rows
// the surface module draws above the rooms (header, toolbar, search, the
// footer line, the help popover or the drawer), their exact heights, the
// drawer's wrapped lines, and the window of layout rows the engine's scroll
// offset shows; and the ONE definition of the characters the surfaces refuse
// (REFUSED_RE), with the two cleaners built on it: cleanSearch (the search
// text) and cleanAgentText (every agent text the payload carries, cleaned by
// the hooks' poll). Shared by the surface module (office-client.tsx draws with it)
// and the hooks (ui.tsx sizes the Client with `officeHeight`): no `$`, no
// engine, no clock, so both sides import it — the hooks never import the
// surface module itself.

import { cut, textWidth } from './office-layout'
import type { OfficeDrawer, OfficeProps } from './office-props'

/** The chrome rows always there: header, toolbar, search. */
export const CHROME_ROWS = 3
/** Under this many columns the pane draws icons alone and no key-hint chips (ui.tsx's rule; the Client's toolbar puts hotkeys on its Buttons only from here, since the desktop draws a chip per hotkey). */
export const COMPACT_BELOW = 60
/** The drawer's task and result wrap to at most this many lines each (the drawer's height must be exact: the rows under it are hit-tested). */
export const TASK_LINES = 4
export const RESULT_LINES = 3
/**
 * The help rows: a label key and the keys shown beside it (spec §6.4; the still toggle's `s` since Task 2.8b-3). The close
 * row promises `x` alone: Escape never reaches a Client — it hands the keyboard back to the prompt (engine types,
 * ClientKeyEvent) — so the help must not offer it.
 */
export const HELP: ReadonlyArray<readonly [string, string]> = [
  ['scFinished', 'f'], ['scMove', 'k / j'], ['scOpen', 'o · Enter'], ['scClose', 'x'], ['scMute', 'm'], ['scLang', 'l'], ['scDemo', 'd'], ['scStill', 's'], ['scHelp', 'h'],
]
/** The help popover's row of Buttons (demo, motion, language): the rare controls, moved off the toolbar (Task 2.8b-3). */
export const HELP_BUTTON_ROWS = 1
/** The help popover's height: the border, the title row, the Buttons row, one row per shortcut. */
export const HELP_ROWS = 2 + 1 + HELP_BUTTON_ROWS + HELP.length

/** Whether `labels`, a cell apart, fit in `width` cells: the toolbar and the help's Buttons row draw their words only then, else their icons alone. */
export function labelsFit(labels: readonly string[], width: number): boolean {
  return labels.reduce((n, l, i) => n + (i ? 1 : 0) + textWidth(l), 0) <= width
}
/**
 * The window's byte budget. A drawn row serializes to about ROW_CHARS_PER_COLUMN characters per
 * column (measured 2026-10-11: 57,033 for a 200 × 40 window with the drawer open); the Client's
 * whole tree must stay under 100,000 characters or the instance unmounts, so the rows drawn are
 * capped at WINDOW_CHARS — a maximized pane on a large monitor (≈ 250 × 75) leaves its lowest rows
 * blank rather than losing the pane.
 */
export const ROW_CHARS_PER_COLUMN = 7
export const WINDOW_CHARS = 70_000
/** The longest search text, in code points: what the module keeps and posts and the hooks store (a pasted page must not swell a post, the Input's value or the Client's props past their bounds). */
export const SEARCH_MAX = 200
/** C0 and C1 controls (an escape sequence in a paste): the surface refuses an Input value or a Text holding one (a Text takes tab and newline alone). */
const CONTROL_RE = /\p{Cc}/gu
/**
 * The bidi controls (ALM, LRM, RLM, LRE..RLO, LRI..PDI): the desktop refuses them in a Text, and a paste
 * from a Hebrew source often carries them. Named one by one, not \p{Cf}: that class also holds the
 * zero-width joiner of emoji sequences (man + ZWJ + laptop), which must stay.
 */
const BIDI_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g
/**
 * A character a surface refuses in a Text or a Button's label: a bidi control, or a control character
 * other than tab and newline (the two a Text takes). Built from the two sets above — the ONE definition
 * of what the surfaces refuse — for the guards and the tests.
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

/** One drawn line of the drawer: `text` as a string; `parts` when the line is composed of labels and values (drawn as runs, THE HEBREW RULE); `chips` for the chips line. */
export type DrawerLine = { kind: 'name' | 'dim' | 'chips' | 'head' | 'body' | 'note'; text: string; chips?: string[]; parts?: string[] }

/**
 * THE OVERLAY IN VIEW: whether the help popover | the drawer (`overlay` rows, part of the chrome) is drawn at the
 * top of the engine's window rather than under the fixed chrome — whenever it leaves the window a row for the
 * office. Under the native scroll the chrome scrolls away with the content, so a drawer or help opened while the
 * pane is scrolled down would otherwise be drawn above the window: the person would see the grid jump and no
 * drawer. Drawn at the window's top instead, it opens in view and the office rows under it stay where they were
 * (the person's place is kept); scrolled back to the top it sits under the fixed chrome as before. An overlay as
 * tall as the window keeps its place in the chrome, so the person can still scroll through all of it.
 */
export function overlayInWindow(overlay: number, bodyRows: number): boolean {
  return overlay > 0 && overlay < bodyRows
}

/**
 * The layout rows the engine's window shows, in layout coordinates: `from` is
 * the first row (the rows above it are one spacer), `count` how many — never
 * more than the content holds (so `windowRows` has nothing to clamp and the
 * rows stay under the pointer), never more than the byte budget allows.
 * `chrome` is chromeRows (the overlay included) and `overlay` the help | drawer
 * rows inside it: when the overlay is drawn at the window's top
 * (overlayInWindow), the layout continues from the row the window starts at,
 * under the overlay; either way layout row y sits at Client row chrome + y.
 */
export function windowOf(chrome: number, offset: number, bodyRows: number, len: number, columns: number, overlay = 0): { from: number; count: number } {
  const inWindow = overlayInWindow(overlay, bodyRows)
  // the rows above the layout that the window scrolls past before the office starts: the fixed chrome alone when the
  // overlay rides the window's top, the whole chrome otherwise
  const lead = inWindow ? chrome - overlay : chrome
  const from = Math.max(0, offset - lead)
  const visible = Math.max(0, bodyRows - (inWindow ? overlay : 0) - Math.max(0, lead - offset))
  const budget = Math.max(1, Math.floor(WINDOW_CHARS / (ROW_CHARS_PER_COLUMN * Math.max(1, columns))))
  return { from, count: Math.max(0, Math.min(visible, budget, len - from)) }
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

/** The drawer's lines at `inner` cells (its box is `2 + lines.length` rows tall), from the drawer and the labels. */
export function drawerLines(d: OfficeDrawer, L: Record<string, string>, inner: number): DrawerLine[] {
  const lbl = (k: string) => L[k] ?? ''
  const lines: DrawerLine[] = [{ kind: 'name', text: cut(d.name, Math.max(1, inner - 10)) }]
  if (d.sub) lines.push({ kind: 'dim', text: cut(d.sub, inner) })
  const chips = [...d.chips]
  // the label follows the status, as the text cards' does (a failed or killed agent is done: its chip reads ❌, its clock is a duration)
  if (d.elapsedMin !== null) chips.push(`${d.done ? lbl('dDuration') : lbl('dElapsed')}${d.elapsedMin}${lbl('dMinutes')}`)
  const shown: string[] = []
  let used = 0
  for (const c of chips) {
    const w = textWidth(c) + 2 + (shown.length ? 1 : 0)
    if (used + w > inner) break
    shown.push(c)
    used += w
  }
  lines.push({ kind: 'chips', text: shown.map(c => ` ${c} `).join(' '), chips: shown })
  // the model line and the ✂ note are parts (a label, a value, a mark): the Client lays them in reading order as the runs the
  // engine will not swap (office-layout.ts blocksOfParts); no colon after a label — it would be drawn before the Hebrew word
  const model = [lbl('dModel'), '🧠', d.model, '·', lbl('dAction'), d.act]
  lines.push({ kind: 'head', text: cut(model.join(' '), inner), parts: model })
  lines.push({ kind: 'head', text: cut(lbl('dTask'), inner) })
  for (const t of wrapLines(d.task || lbl('taskUnavailable'), inner, TASK_LINES)) lines.push({ kind: 'body', text: t })
  if (d.result) {
    lines.push({ kind: 'head', text: cut(lbl('dResult'), inner) })
    for (const t of wrapLines(d.result, inner, RESULT_LINES)) lines.push({ kind: 'body', text: t })
    if (d.truncated) lines.push({ kind: 'note', text: cut(`✂ ${lbl('resultTruncated')}`, inner), parts: ['✂', lbl('resultTruncated')] })
  }
  return lines
}

/** The empty office's lines: the message, the sub's sentences (split at each " - " / " — "), each wrapped. */
export function emptyLines(p: OfficeProps): { msg: string[]; sub: string[] } {
  if (!p.empty) return { msg: [], sub: [] }
  const w = Math.max(1, p.columns)
  return { msg: wrapLines(p.empty.msg, w, 2), sub: p.empty.sub ? p.empty.sub.split(/\s[-—]\s/).flatMap(s => wrapLines(s, w, 2)) : [] }
}

/** The rows the empty-office block takes (a margin row, 🏢, the lines, the demo Button). */
export function emptyRows(p: OfficeProps): number {
  if (!p.empty) return 0
  const e = emptyLines(p)
  return 1 + 1 + e.msg.length + e.sub.length + (p.empty.kind === 'office' ? 1 : 0)
}

/** The rows above the layout: header, toolbar, search, the footer line when there is one, then the help popover or the drawer. */
export function chromeRows(p: OfficeProps): number {
  return CHROME_ROWS + (p.footer ? 1 : 0) + overlayRows(p)
}

/** The help popover's or the drawer's rows (0 when neither is open): the part of the chrome that may ride the window's top (overlayInWindow). */
export function overlayRows(p: OfficeProps): number {
  if (p.helpOpen) return HELP_ROWS
  if (p.drawer) return 2 + drawerLines(p.drawer, p.labels, Math.max(1, p.columns - 4)).length
  return 0
}

/** The Client's full content height: what the hooks pass as `height` (`layoutRows` = `rowCount(p)`, office-layout.ts: no cell is built for it). */
export function officeHeight(p: OfficeProps, layoutRows: number): number {
  return chromeRows(p) + (p.empty ? emptyRows(p) : layoutRows)
}
