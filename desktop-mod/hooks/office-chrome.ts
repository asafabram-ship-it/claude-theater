// office-chrome.ts: the pure maths of the desktop office's chrome — the rows
// the surface module draws above the rooms (header, toolbar, search, the
// footer line, the help popover or the drawer), their exact heights, the
// drawer's wrapped lines, and the window of layout rows the engine's scroll
// offset shows. Shared by the surface module (office-client.tsx draws with it)
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
/** The help rows: a label key and the keys shown beside it (spec §6.4). */
export const HELP: ReadonlyArray<readonly [string, string]> = [
  ['scFinished', 'f'], ['scMove', 'k / j'], ['scOpen', 'o · Enter'], ['scClose', 'x · Esc'], ['scMute', 'm'], ['scLang', 'l'], ['scDemo', 'd'], ['scHelp', 'h'],
]
/** The help popover's height: the border, the title row, one row per shortcut. */
export const HELP_ROWS = 2 + 1 + HELP.length
/**
 * The window's byte budget. A drawn row serializes to about ROW_CHARS_PER_COLUMN characters per
 * column (measured 2026-10-11: 57,033 for a 200 × 40 window with the drawer open); the Client's
 * whole tree must stay under 100,000 characters or the instance unmounts, so the rows drawn are
 * capped at WINDOW_CHARS — a maximized pane on a large monitor (≈ 250 × 75) leaves its lowest rows
 * blank rather than losing the pane.
 */
export const ROW_CHARS_PER_COLUMN = 7
export const WINDOW_CHARS = 70_000

export type DrawerLine = { kind: 'name' | 'dim' | 'chips' | 'head' | 'body' | 'note'; text: string; chips?: string[] }

/**
 * The layout rows the engine's window shows, in layout coordinates: `from` is
 * the first row (the rows above it are one spacer), `count` how many — never
 * more than the content holds (so `windowRows` has nothing to clamp and the
 * rows stay under the pointer), never more than the byte budget allows.
 */
export function windowOf(chrome: number, offset: number, bodyRows: number, len: number, columns: number): { from: number; count: number } {
  const from = Math.max(0, offset - chrome)
  const visible = Math.max(0, bodyRows - Math.max(0, chrome - offset))
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
  if (d.elapsedMin !== null) chips.push(`${d.chips[0] === lbl('dDone') ? lbl('dDuration') : lbl('dElapsed')}${d.elapsedMin}′`)
  const shown: string[] = []
  let used = 0
  for (const c of chips) {
    const w = textWidth(c) + 2 + (shown.length ? 1 : 0)
    if (used + w > inner) break
    shown.push(c)
    used += w
  }
  lines.push({ kind: 'chips', text: shown.map(c => ` ${c} `).join(' '), chips: shown })
  lines.push({ kind: 'head', text: cut(`${lbl('dModel')}: 🧠 ${d.model} · ${lbl('dAction')}: ${d.act}`, inner) })
  lines.push({ kind: 'head', text: cut(lbl('dTask'), inner) })
  for (const t of wrapLines(d.task || lbl('taskUnavailable'), inner, TASK_LINES)) lines.push({ kind: 'body', text: t })
  if (d.result) {
    lines.push({ kind: 'head', text: cut(lbl('dResult'), inner) })
    for (const t of wrapLines(d.result, inner, RESULT_LINES)) lines.push({ kind: 'body', text: t })
    if (d.truncated) lines.push({ kind: 'note', text: cut(`✂ ${lbl('resultTruncated')}`, inner) })
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
  let n = CHROME_ROWS + (p.footer ? 1 : 0)
  if (p.helpOpen) n += HELP_ROWS
  else if (p.drawer) n += 2 + drawerLines(p.drawer, p.labels, Math.max(1, p.columns - 4)).length
  return n
}

/** The Client's full content height: what the hooks pass as `height` (`layoutRows` = `layoutOffice(p).rows.length`). */
export function officeHeight(p: OfficeProps, layoutRows: number): number {
  return chromeRows(p) + (p.empty ? emptyRows(p) : layoutRows)
}
