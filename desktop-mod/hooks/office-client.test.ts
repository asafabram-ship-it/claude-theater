// office-client.tsx: the desktop office as one Client surface module, driven
// DIRECTLY with a fake surface (the module is a pure function of props and
// surface): the chrome, the cards' structure, the window maths, the timer
// discipline, the pointer and key handlers, the search Input, the limits
// sweep, the error wrapper — exact and fast. Mounting it through the kit needs
// the plugin's own hooks to build the Client from a literal path, so the
// mounted tests ride in office-client.mounted.test.ts and office-controls.test.ts.

import type { ClientKeyEvent, ClientPointerEvent, ClientSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { I18N, hebrewRuleOk } from './i18n'
import { CHROME_ROWS, COMPACT_BELOW, DRAWER_FRAME_ROWS, HELP, HELP_ROWS, OVERLAY_GAP, REFUSED_RE, RESULT_LINES, ROW_CHARS, SEARCH_MAX, TASK_LINES, WINDOW_ROWS, chromeRows, cleanAgentText, cleanSearch, drawerInner, drawerLines, officeHeight, overlayInWindow, overlayRows, windowOf } from './office-chrome'
import Office, { FX_BG, FX_DONE_MS, FX_TICK_MS, SEARCH_DEBOUNCE_MS, TOOLBAR_GAP } from './office-client'
import type { OfficeState } from './office-client'
import { CARD_BORDER, DOT_FG, FOCUS_MARK, PIN, TITLE_GAP, cut, fitLine, officeModel, rowCount, textWidth } from './office-layout'
import type { Hit } from './office-layout'
import type { OfficeAgent, OfficeDrawer, OfficeMessage, OfficeProps, OfficeRoom } from './office-props'
import { usageLabel, usageShort } from './usage'

const LABELS: Record<string, string> = Object.fromEntries(Object.entries(I18N.he).filter((kv): kv is [string, string] => typeof kv[1] === 'string'))
const LABELS_EN: Record<string, string> = Object.fromEntries(Object.entries(I18N.en).filter((kv): kv is [string, string] => typeof kv[1] === 'string'))

function ag(id: string, over: Partial<OfficeAgent> = {}): OfficeAgent {
  return { id, emoji: '🦉', name: id, status: 'running', act: '📖 קורא', model: 'Opus 5.5', failed: false, longRunning: false, star: 0, ...over }
}
function room(id: string, agents: OfficeAgent[], over: Partial<OfficeRoom> = {}): OfficeRoom {
  const n = (s: OfficeAgent['status']) => agents.filter(a => a.status === s).length
  return { id, title: `room ${id}`, small: id, pinned: false, showDone: false, run: n('running'), stale: n('stale'), done: n('done'), agents, moreDone: 0, moreLabel: '', ...over }
}
function props(over: Partial<OfficeProps> = {}): OfficeProps {
  return {
    v: 1, lang: 'he', rtl: true, columns: 45, rows: 30, offset: 0, nowMin: 100,
    counts: { run: 2, idle: 0, done: 0 }, prefs: { showDone: false, muted: true, still: false },
    search: '', selected: null, helpOpen: false, demo: false,
    rooms: [room('A', [ag('lead', { emoji: '💼', act: '🧠 חושב' }), ag('a1')])],
    drawer: null, footer: '', usage: null, empty: null, labels: LABELS, ...over,
  }
}
function drawer(over: Partial<OfficeDrawer> = {}): OfficeDrawer {
  return { id: 'lead', name: '💼 המנהל', chips: ['עובד', 'Explore'], model: 'Opus 5.5', act: '🧠 חושב', task: 'map the docs', result: '', truncated: false, elapsedMin: 3, sub: 'map the docs', done: false, ...over }
}
function withAgents(p: OfficeProps, agents: OfficeAgent[]): OfficeProps {
  return { ...p, rooms: [room('A', agents)] }
}

// --- a fake surface: the module's second argument, with every call recorded ---
type Fake = {
  surface: ClientSurface<OfficeState>
  posts: OfficeMessage[]
  timers: Array<{ ms: number; fn: () => void; stopped: boolean }>
  setStates: () => number
  pointer: (e: ClientPointerEvent) => void
  key: (e: ClientKeyEvent) => void
  tick: () => void
  size: (columns: number, rows: number) => void
}
function fake(columns = 45, rows = 0): Fake {
  const posts: OfficeMessage[] = []
  const timers: Fake['timers'] = []
  let onPointer: ((e: ClientPointerEvent) => void) | undefined
  let onKey: ((e: ClientKeyEvent) => void) | undefined
  let sets = 0
  const el = (type: string) => (p: Record<string, unknown>) => {
    const { children, ...rest } = p
    return { type, props: rest, children: children === undefined ? [] : Array.isArray(children) ? children : [children] }
  }
  const surface = {
    elements: { Box: el('Box'), Text: el('Text'), Button: el('Button'), Input: el('Input'), Select: el('Select'), Link: el('Link'), Code: el('Code'), Markdown: el('Markdown') },
    state: undefined as OfficeState | undefined,
    setState(next: OfficeState) { surface.state = next; sets += 1 },
    columns, rows,
    every(ms: number, fn: () => void) { const t = { ms, fn, stopped: false }; timers.push(t); return () => { t.stopped = true } },
    onPointer(fn: (e: ClientPointerEvent) => void) { onPointer = fn; return () => { onPointer = undefined } },
    onKey(fn: (e: ClientKeyEvent) => void) { onKey = fn; return () => { onKey = undefined } },
    post(d: unknown) { posts.push(d as OfficeMessage) },
  }
  return {
    surface: surface as unknown as ClientSurface<OfficeState>, posts, timers,
    setStates: () => sets,
    pointer: e => onPointer?.(e), key: e => onKey?.(e),
    tick: () => { for (const t of [...timers]) if (!t.stopped) t.fn() },
    size: (c, r) => { surface.columns = c; surface.rows = r },
  }
}
type Node = { type: string; props: Record<string, unknown>; children: unknown[] }
function nodes(n: unknown): Node[] {
  if (typeof n !== 'object' || n === null) return []
  const node = n as Node
  return [node, ...(Array.isArray(node.children) ? node.children : []).flatMap(nodes)]
}
function depth(n: unknown): number {
  if (typeof n !== 'object' || n === null) return 0
  const kids = (n as Node).children
  return 1 + (Array.isArray(kids) && kids.length > 0 ? Math.max(...kids.map(depth)) : 0)
}
/** Every string of the tree in document order, one node's strings joined as drawn, nodes separated by a newline. */
function texts(tree: unknown): string {
  if (typeof tree === 'string') return tree
  if (typeof tree !== 'object' || tree === null) return ''
  const kids = (tree as Node).children
  if (!Array.isArray(kids)) return ''
  let out = ''
  for (const k of kids) out += typeof k === 'string' ? k : `\n${texts(k)}\n`
  return out.replace(/\n{2,}/g, '\n').replace(/^\n|\n$/g, '')
}
function withBg(tree: unknown, bg: string): Node[] {
  return nodes(tree).filter(n => n.props.backgroundColor === bg)
}
const kidsOf = (tree: unknown) => (tree as Node).children as Node[]
/** The Box with `key` (a Button may share a key with a Box: the toolbar's `help` opens the Box `help`). */
const byKey = (tree: unknown, key: string, type = 'Box') => nodes(tree).find(n => n.type === type && n.props.key === key)
/** The room cards of the tree: the framed Boxes in the cards' style that are neither the drawer nor the settings popover, and the frameless FRAGMENT of the window's first card under an overlay (THE OVERLAY IN VIEW). */
const cards = (tree: unknown) => nodes(tree).filter(n => n.type === 'Box' && ((n.props.borderStyle === 'round' && n.props.borderColor === CARD_BORDER && n.props.key === undefined) || n.props.key === 'fragment'))
/**
 * The parts of a WHOLE card: its title line, its rule, its table block (the Box of column Boxes; a column Box around it and the
 * spacers for the rows above / below the window when there are any; a spacer alone when no row is in the window), its more line.
 */
function partsOf(card: Node): { title: Node; rule: Node; table: Node; more: Node | undefined } {
  const [title, rule, table, more] = card.children as Node[]
  return { title: title!, rule: rule!, table: table!, more }
}
/** The title's pin Text of a card's title line: drawn only when the room is pinned or its head hovered (undefined otherwise: the title is then the line's first child). */
const pinOf = (card: Node): Node | undefined => (partsOf(card).title.children as Node[]).find(n => n.type === 'Text')
/** The table of a card or a fragment: the Box of column Boxes, wherever it sits in the card (undefined when no row of it is in the window: a spacer, or nothing). */
const tableOf = (card: Node) => nodes(card).find(n => n.type === 'Box' && n.children.length > 0 && (n.children as Node[]).every(c => c.props.flexDirection === 'column'))
/** The child of a card or a fragment that holds its table: the table itself, or the column Box of the spacers around it. */
const blockOf = (card: Node) => { const t = tableOf(card); return t && (card.children as Node[]).find(n => nodes(n).includes(t)) }
/** The column Boxes of a card's table (none when the table is a spacer). */
const columnsOf = (card: Node) => (tableOf(card)?.children as Node[] | undefined) ?? []
/**
 * The Client row a root child with `key` starts at: the rows of the root's children before it (each a Box of explicit height
 * plus its margins — the chrome's lines, the spacer and the overlays all say their height; a card does not, and lies after them).
 */
function clientRowOf(tree: unknown, key: string): number {
  let row = 0
  for (const n of kidsOf(tree)) {
    if (n.props.key === key) return row
    const h = n.props.height
    if (typeof h !== 'number') throw new Error(`no height on ${String(n.props.key ?? n.props.borderStyle)} before ${key}`)
    row += h + ((n.props.marginTop as number | undefined) ?? 0) + ((n.props.marginBottom as number | undefined) ?? 0)
  }
  throw new Error(`no ${key} in the tree`)
}
/** The value cells of a column: its Texts, one per row of the window (a column holds nothing else). */
const cellsOf = (col: Node) => (col.children as Node[]).filter(n => n.type === 'Text')
/** The texts of the window's rows of a card, one array per row: [status, who, model?, act]. */
function rowsOf(card: Node): string[][] {
  const cols = columnsOf(card).map(cellsOf)
  if (cols.length === 0) return []
  return cols[0]!.map((_, i) => cols.map(col => texts(col[i])))
}

// ---------------------------------------------------------------------------
// pure parts
// ---------------------------------------------------------------------------

test('windowOf: the lines the engine shows, in layout coordinates, never shifted by a clamp; the chrome is six rows', () => {
  expect(CHROME_ROWS).toBe(6)
  // offset inside the chrome: the first (rows - (chrome - offset)) layout lines
  expect(windowOf(6, 0, 30, 100)).toEqual({ from: 0, count: 24 })
  expect(windowOf(6, 2, 30, 100)).toEqual({ from: 0, count: 26 })
  // offset past the chrome: a full window from offset - chrome
  expect(windowOf(6, 6, 30, 100)).toEqual({ from: 0, count: 30 })
  expect(windowOf(6, 10, 30, 100)).toEqual({ from: 4, count: 30 })
  // near the end: the count shrinks, `from` stays (no clamp shifting the lines under the pointer)
  expect(windowOf(6, 90, 30, 100)).toEqual({ from: 84, count: 16 })
  expect(windowOf(6, 200, 30, 100)).toEqual({ from: 194, count: 0 })
  // short content, tall window
  expect(windowOf(6, 0, 30, 5)).toEqual({ from: 0, count: 5 })
  expect(windowOf(6, 0, 0, 5)).toEqual({ from: 0, count: 0 })
  // no byte budget here: the row budget (WINDOW_ROWS) is the module's cut on the line map
  expect(windowOf(6, 6, 200, 500)).toEqual({ from: 0, count: 200 })
  expect(WINDOW_ROWS).toBe(100)
  expect(ROW_CHARS).toBe(800)
})

test('THE OVERLAY IN VIEW (windowOf with the settings | drawer rows): an overlay that leaves the window a row rides its top — the layout continues from the line the window starts at, under it; at the top it sits under the fixed chrome as before; one as tall as the window stays in the chrome', () => {
  // 6 fixed rows + an 11-row overlay (chrome 17), a 25-row window over 100 layout lines
  expect(overlayInWindow(11, 25)).toBe(true)
  expect(overlayInWindow(0, 25)).toBe(false)
  expect(overlayInWindow(25, 25)).toBe(false)
  // scrolled 40 rows: the overlay takes the window's first 11 rows, the layout goes on from line 34 (40 - 6) under it —
  // the same first line as with no overlay at all (the person's place kept), 11 rows fewer of it
  expect(windowOf(17, 40, 25, 100, 11)).toEqual({ from: 34, count: 14 })
  expect(windowOf(6, 40, 25, 100)).toEqual({ from: 34, count: 25 })
  // at the top (or inside the fixed chrome) the two placements are the same window
  expect(windowOf(17, 0, 25, 100, 11)).toEqual(windowOf(17, 0, 25, 100))
  expect(windowOf(17, 5, 25, 100, 11)).toEqual(windowOf(17, 5, 25, 100))
  expect(windowOf(17, 6, 25, 100, 11)).toEqual({ from: 0, count: 14 })
  // just past the fixed chrome: the overlay is still whole at the top, the layout from line 1
  expect(windowOf(17, 7, 25, 100, 11)).toEqual({ from: 1, count: 14 })
  // the end: the Client is 17 + 100 rows tall, so the last offset is 92 — the last layout line is the window's last
  expect(windowOf(17, 92, 25, 100, 11)).toEqual({ from: 86, count: 14 })
  // an overlay as tall as the window (or taller) keeps its place in the chrome: today's window, scrolled through as content
  expect(windowOf(31, 40, 25, 100, 25)).toEqual(windowOf(31, 40, 25, 100))
  expect(windowOf(31, 40, 25, 100, 25)).toEqual({ from: 9, count: 25 })
})

test('cleanSearch: the search text cut to SEARCH_MAX code points (never half an emoji) and freed of control characters (the surface refuses an Input value holding one)', () => {
  expect(SEARCH_MAX).toBe(200)
  expect(cleanSearch('triage')).toBe('triage')
  expect(cleanSearch('x'.repeat(100_010))).toBe('x'.repeat(SEARCH_MAX))
  expect(Array.from(cleanSearch('🔍'.repeat(SEARCH_MAX + 50)))).toEqual(Array.from('🔍'.repeat(SEARCH_MAX)))
  expect(cleanSearch('a\u0007b\u001b[31mc\nd\te\u0000f\u007fg\u0085h')).toBe('a b [31mc d e f g h')
  // the bidi controls are removed (the desktop refuses them in a Text; a mark in a query would never match a name);
  // Hebrew, emoji, a ZWJ sequence and a variation selector are kept as typed
  expect(cleanSearch('עברית ‏ok')).toBe('עברית ok')
  expect(cleanSearch('‫שלום‬ ⁧x⁩ ‎A؜B‪C‭D‮E⁦F⁨G')).toBe('שלום x ABCDEFG')
  expect(cleanSearch('👨‍💻 ✏️ 🦉 קוד')).toBe('👨‍💻 ✏️ 🦉 קוד')
  expect(cleanSearch('‏'.repeat(5000) + 'x'.repeat(300))).toBe('x'.repeat(SEARCH_MAX))   // marks do not eat the cap
  expect(cleanSearch(cleanSearch('🔍'.repeat(300) + '\u0007'))).toBe(cleanSearch('🔍'.repeat(300) + '\u0007'))
})

test('cleanAgentText: agent text as every surface takes it — an escape sequence removed whole, any other control a space, the bidi controls removed; tab and newline kept only in a multi-line field; Hebrew, emoji, ZWJ and VS16 kept; idempotent', () => {
  const ESC = String.fromCharCode(0x1b)
  const BEL = String.fromCharCode(0x07)
  // an ANSI colour code leaves nothing behind (not "[31m"): CSI whole, the C1 CSI too, an OSC 8 hyperlink's wrapper
  expect(cleanAgentText(`${ESC}[31mred${ESC}[0m`)).toBe('red')
  expect(cleanAgentText(`a${ESC}[1;38;5;196mb${ESC}[0m c${ESC}[2K${ESC}[?25h`)).toBe('ab c')
  expect(cleanAgentText(`${String.fromCharCode(0x9b)}31mx`)).toBe('x')
  expect(cleanAgentText(`see ${ESC}]8;;https://x.test/a${BEL}link${ESC}]8;;${ESC}\\ here`)).toBe('see link here')
  // any other control is a space: BEL, NUL, DEL, a C1 NEL, a lone ESC, an unfinished sequence
  expect(cleanAgentText(`a${BEL}b${String.fromCharCode(0)}c${String.fromCharCode(0x7f)}d${String.fromCharCode(0x85)}e${ESC}f ${ESC}[3`)).toBe('a b c d e f  [3')
  // the bidi controls (ALM, LRM, RLM, LRE..RLO, LRI..PDI) are removed: the desktop refuses them in a Text
  expect(cleanAgentText('‫שלום‬ ⁧x⁩ ‎A؜B‪C‭D‮E⁦F⁨G‏H')).toBe('שלום x ABCDEFGH')
  // a single-line field (a name, a label, a title): line breaks and tabs are spaces, CRLF one space
  expect(cleanAgentText('one\r\ntwo\nthree\tfour\rfive')).toBe('one two three four five')
  // a multi-line field (task, result): newline and tab kept (the engine's two allowed controls), CRLF and CR a newline
  expect(cleanAgentText('one\r\ntwo\nthree\tfour\rfive', true)).toBe('one\ntwo\nthree\tfour\nfive')
  expect(cleanAgentText(`${ESC}[32mok${ESC}[0m\n${BEL}‏דוח`, true)).toBe('ok\n דוח')
  // what must stay: Hebrew, emoji, a ZWJ sequence, a variation selector, a skin tone
  expect(cleanAgentText('👨‍💻 ✏️ 🦉 קוד 👍🏽')).toBe('👨‍💻 ✏️ 🦉 קוד 👍🏽')
  expect(cleanAgentText('')).toBe('')
  // idempotent, and nothing a surface refuses is left (REFUSED_RE: the shared set — bidi, any control but tab / newline)
  const dirty = [`${ESC}[31mred${ESC}[0m`, `x${ESC}${ESC}[[31m`, `${ESC}${'‏'}[31m`, 'a\r\n\r\nb\u0000\t', `${ESC}]0;title`, '؜⁦⁩', '👨‍💻 קוד']
  for (const s of dirty) {
    for (const multiline of [false, true]) {
      const once = cleanAgentText(s, multiline)
      expect(cleanAgentText(once, multiline)).toBe(once)
      expect(once).not.toMatch(REFUSED_RE)
      if (!multiline) expect(once).not.toMatch(/[\n\t]/)
    }
  }
  expect(`a${BEL}`).toMatch(REFUSED_RE)
  expect('a؜').toMatch(REFUSED_RE)
  expect('a\nb\tc 👨‍💻 ✏️').not.toMatch(REFUSED_RE)
})

test('chromeRows / officeHeight: the six chrome rows; then the settings popover | the drawer card (its frame, its lines, the gap under it), the footer line, the empty block', () => {
  const p = props()
  expect(chromeRows(p)).toBe(CHROME_ROWS)
  expect(chromeRows({ ...p, footer: 'scan: 2 skipped' })).toBe(CHROME_ROWS + 1)
  expect(chromeRows({ ...p, helpOpen: true })).toBe(CHROME_ROWS + HELP_ROWS + OVERLAY_GAP)
  // the drawer: the card's frame (border, padding) + name, sub, chips, model · action, task heading, one task line + the gap
  const inner = drawerInner(p.columns)
  expect(inner).toBe(Math.floor((p.columns - 4) * 0.75))
  expect(drawerLines(drawer(), LABELS, inner).length).toBe(6)
  expect(chromeRows({ ...p, drawer: drawer() })).toBe(CHROME_ROWS + DRAWER_FRAME_ROWS + 6 + OVERLAY_GAP)
  expect(DRAWER_FRAME_ROWS).toBe(4)
  expect(OVERLAY_GAP).toBe(1)
  // the settings win over the drawer when both are open (as today: a popover)
  expect(chromeRows({ ...p, helpOpen: true, drawer: drawer() })).toBe(CHROME_ROWS + HELP_ROWS + OVERLAY_GAP)
  // a long task wraps to at most TASK_LINES lines, the result to RESULT_LINES (+ heading + the ✂ note), every line within the inner width
  const long = drawer({ task: 'word '.repeat(400), result: 'done '.repeat(400), truncated: true, sub: '' })
  expect(drawerLines(long, LABELS, inner).length).toBe(4 + TASK_LINES + 1 + RESULT_LINES + 1)
  for (const line of drawerLines(long, LABELS, inner)) expect(textWidth(line.text)).toBeLessThanOrEqual(inner)
  // the elapsed minutes ride on the chips line (whole minutes: the ruling of Task 2.2)
  expect(drawerLines(drawer({ elapsedMin: 7 }), LABELS, inner)[2]?.text).toMatch(/זמן 7/)
  expect(drawerLines(drawer({ elapsedMin: null }), LABELS, inner)[2]?.text).not.toMatch(/זמן/)
  // the label follows the status, as the text cards' does: done → the duration, a failed (or killed) agent too — its chip reads ❌
  // (three chips need 32 cells: the probe's 51 columns leave the drawer 35; a 45-column pane's 30 drop the clock chip whole)
  const wide = drawerInner(51)
  expect(wide).toBe(35)
  expect(drawerLines(drawer({ chips: ['סיים'], done: true, elapsedMin: 3 }), LABELS, inner)[2]?.text).toMatch(/משך 3/)
  const failed = drawerLines(drawer({ chips: ['❌ נכשל', 'Explore'], done: true, elapsedMin: 3 }), LABELS, wide)[2]?.text
  expect(failed).toMatch(/משך 3/)
  expect(failed).not.toMatch(/זמן/)
  expect(drawerLines(drawer({ chips: ['❌ נכשל', 'Explore'], done: true, elapsedMin: 3 }), LABELS, inner)[2]?.text).toBe(' ❌ נכשל   Explore ')
  expect(drawerLines(drawer({ chips: ['❌ Failed'], done: true, elapsedMin: 3 }), LABELS_EN, inner)[2]?.text).toMatch(/Duration 3/)
  // the full height = chrome + the cards' lines; the empty office = chrome + its block
  expect(officeHeight(p, rowCount(p))).toBe(CHROME_ROWS + 9)
  const empty = { ...p, rooms: [], empty: { kind: 'office' as const, msg: LABELS.emptyOffice ?? '', sub: LABELS.emptySub ?? '' } }
  expect(officeHeight(empty, 0)).toBeGreaterThan(CHROME_ROWS + 2)
})

// ---------------------------------------------------------------------------
// the drawing
// ---------------------------------------------------------------------------

test('render: the chrome (header with the words and a blank line, the toolbar, the search with a blank line above and below) then a framed card per room with the title line, the rule and the column-major table; nothing below the window', () => {
  const f = fake(45, 0)
  const p = props()
  const tree = Office(p, f.surface)
  const all = nodes(tree)
  expect(all[0]?.type).toBe('Box')
  // the chrome: the header (one bold Text of the counts, a blank line under it), the toolbar Buttons with today's keys, the search Input
  const header = byKey(tree, 'header')!
  expect(header).toMatchObject({ type: 'Box', props: { flexDirection: 'row-reverse', justifyContent: 'space-between', height: 1, overflow: 'hidden', marginBottom: 1 } })
  expect(header.children).toHaveLength(1)
  expect((header.children[0] as Node).props.bold).toBe(true)
  expect(texts(header)).toBe('🎭 עובדים 2 · סיימו 0')
  const keys = all.filter(n => n.type === 'Button').map(n => n.props.key)
  expect(keys).toEqual(['showDone', 'mute', 'help'])   // (demo, still and the language live in the settings popover)
  expect(byKey(tree, 'toolbar')).toMatchObject({ props: { flexDirection: 'row-reverse', gap: TOOLBAR_GAP, height: 1, overflow: 'hidden' } })
  expect(byKey(tree, 'searchLine')).toMatchObject({ props: { marginTop: 1, marginBottom: 1, height: 1 } })
  expect(all.find(n => n.type === 'Input')?.props.key).toBe('search')
  // hotkeys only from COMPACT_BELOW columns, today's rule (the desktop draws a key chip per hotkey, which would wrap the toolbar)
  expect(all.filter(n => n.type === 'Button').every(n => n.props.hotkey === undefined)).toBe(true)
  const wide = nodes(Office({ ...p, columns: COMPACT_BELOW }, fake(COMPACT_BELOW).surface))
  expect(wide.filter(n => n.type === 'Button').map(n => n.props.hotkey)).toEqual(['f', 'm', 'h'])
  // the root's children: header, toolbar, search, then the one card — no spacer at the top, nothing after the card
  expect(kidsOf(tree).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  const [card] = cards(tree)
  expect(cards(tree)).toHaveLength(1)
  expect(card).toMatchObject({ props: { flexDirection: 'column', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, paddingY: 1, marginBottom: 1, width: '100%', overflow: 'hidden' } })
  // the title line: NO pin cell (unpinned, not hovered: the title sits flush at the reading edge, as the probe's), the title
  // (bold, one line), the counts (dim, never shrunk), the probe's gap of two between them
  const { title, rule, table, more } = partsOf(card!)
  expect(title).toMatchObject({ props: { flexDirection: 'row-reverse', justifyContent: 'space-between', height: 1, paddingX: 1, gap: TITLE_GAP, overflow: 'hidden' } })
  expect(TITLE_GAP).toBe(2)
  expect(title.children).toHaveLength(2)
  expect(pinOf(card!)).toBeUndefined()
  const [ttl, counts] = title.children as Node[]
  expect(ttl).toMatchObject({ type: 'Box', props: { flexGrow: 1, flexShrink: 1, minWidth: 0, height: 1, overflow: 'hidden', justifyContent: 'flex-end' } })
  expect(ttl!.children).toHaveLength(1)
  expect((ttl!.children[0] as Node).props.bold).toBe(true)
  expect(texts(ttl)).toBe('room A')
  expect(counts).toMatchObject({ props: { flexShrink: 0, height: 1 } })
  expect(texts(counts)).toBe('🟢2')
  expect(rule).toMatchObject({ props: { height: 1, overflow: 'hidden' } })
  expect(texts(rule)).toBe('─'.repeat(45))
  expect(more).toBeUndefined()
  // a pinned room: its bright 📌 is the title line's first child (a Text), the title after it — the line shifts by the pin and its gap
  const pinned = cards(Office(props({ rooms: [room('A', [ag('lead')], { pinned: true })] }), fake().surface))[0]!
  expect((partsOf(pinned).title.children as Node[]).map(n => n.type)).toEqual(['Text', 'Box', 'Box'])
  expect(pinOf(pinned)).toMatchObject({ type: 'Text', props: {} })
  expect(texts(pinOf(pinned))).toBe(PIN)
  expect(pinOf(pinned)!.props.dimColor).toBeUndefined()
  // the table: four rigid column Boxes (the activity column grows), the padding cell on the column's reading side, ONE Text per
  // row in each — no Box per value: the Text never wraps (`wrap: 'truncate'`), so the row stays one line tall
  expect(table).toMatchObject({ props: { flexDirection: 'row-reverse', width: '100%' } })
  expect(table).toBe(tableOf(card!))   // no spacer: every row is in the window, so the table is the card's third child itself
  const cols = columnsOf(card!)
  expect(cols).toHaveLength(4)
  expect(cols.map(c => c.props.flexGrow)).toEqual([0, 0, 0, 1])
  expect(cols.every(c => c.props.flexShrink === 0 && c.props.flexDirection === 'column' && c.props.alignItems === 'flex-end' && c.props.paddingLeft === 1 && c.props.paddingRight === undefined)).toBe(true)
  for (const col of cols) {
    const cells = cellsOf(col)
    expect(cells).toHaveLength(2)
    expect(col.children).toHaveLength(2)   // the two rows' Texts and nothing else
    for (const cell of cells) {
      expect(cell).toMatchObject({ type: 'Text', props: { wrap: 'truncate' } })
      expect(cell.children).toHaveLength(1)
      expect(typeof cell.children[0]).toBe('string')
    }
  }
  expect(rowsOf(card!)).toEqual([['●', '💼 lead', 'Opus', '🧠 חושב'], ['●', '🦉 a1', 'Opus', '📖 קורא']])
  // colour only on the status column; the who bold, the model dim, the activity plain; no background anywhere
  const [status, who, model, act] = cols
  expect(cellsOf(status!).map(c => c.props)).toEqual([{ wrap: 'truncate', color: DOT_FG.running }, { wrap: 'truncate', color: DOT_FG.running }])
  expect(cellsOf(who!).map(c => c.props)).toEqual([{ wrap: 'truncate', bold: true, dimColor: false }, { wrap: 'truncate', bold: true, dimColor: false }])
  expect(cellsOf(model!).every(c => c.props.dimColor === true && c.props.color === undefined)).toBe(true)
  expect(cellsOf(act!).every(c => c.props.color === undefined)).toBe(true)
  expect(nodes(tree).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
  // the footer rides in the chrome (the engine scrolls natively: a line at the content's end would hide until the end), one dim
  // line, cut to the line by LINE_FIT with an ellipsis (its 44 cells to 37 at 45 columns; whole at 70)
  const note = 'scan: 1 skipped · דולגו 4 תמלילים גדולים מדי'
  const t3 = Office({ ...p, footer: note }, fake(45, 0).surface)
  expect(kidsOf(t3).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'footer', 'round'])
  expect(textWidth(note)).toBe(44)
  expect(texts(byKey(t3, 'footer'))).toBe(cut(note, fitLine(45)))
  expect(texts(byKey(t3, 'footer'))).toMatch(/…$/)
  expect(textWidth(texts(byKey(t3, 'footer')))).toBeLessThanOrEqual(fitLine(45))
  expect(texts(byKey(Office({ ...p, columns: 70, footer: note }, fake(70, 0).surface), 'footer'))).toBe(note)
  // LTR: the rows the same, the padding on the right, the columns aligned to the left, the toolbar a row
  const en = Office({ ...p, rtl: false, lang: 'en', labels: LABELS_EN }, fake().surface)
  expect(byKey(en, 'toolbar')).toMatchObject({ props: { flexDirection: 'row' } })
  const enCols = columnsOf(cards(en)[0]!)
  expect(enCols.every(c => c.props.alignItems === 'flex-start' && c.props.paddingRight === 1 && c.props.paddingLeft === undefined)).toBe(true)
  expect(rowsOf(cards(en)[0]!)).toEqual([['●', '💼 lead', 'Opus', '🧠 חושב'], ['●', '🦉 a1', 'Opus', '📖 קורא']])
})

test('structure: at every width 24..200, both directions, many rooms — a card per room, four (or three) column Boxes, one Text per value and no Box per value, colour only on the status column, no time anywhere in a row, every title one line, a pin Text only on the pinned card, every row\'s cells the same count', { timeoutMs: 30_000 }, () => {
  const rooms = [
    room('A', [ag('lead', { emoji: '💼', act: '🧠 חושב' }), ag('a1', { name: 'הקרטוגרף', model: 'Sonnet 4.5', act: '🔎 מחפש קוד' }), ag('d1', { status: 'done', act: '✅ סיים', star: 7 })], { moreDone: 2, moreLabel: 'עוד 2 שסיימו' }),
    room('B', [ag('b1', { status: 'stale', act: '💤 ממתין' }), ag('b2', { failed: true, status: 'done', act: '✅ סיים' }), ag('b3', { longRunning: true })], { title: 'Plan the static-registry move and the v2 config rollout', pinned: true }),
    room('C', [ag('c1', { name: 'א'.repeat(24), act: '📖 קורא' })], { title: 'בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל' }),
  ]
  for (let columns = 24; columns <= 200; columns += columns < 70 ? 1 : 5) {
    for (const rtl of [true, false]) {
      const p = props({ columns, rtl, rooms, rows: 60 })
      const tree = Office(p, fake(columns, 0).surface)
      const cs = cards(tree)
      expect(cs, `${columns} ${rtl}`).toHaveLength(3)
      cs.forEach((card, i) => {
        const at = `${columns} ${rtl} room ${rooms[i]!.id}`
        const { title, table, more } = partsOf(card)
        expect(title.props.height, at).toBe(1)
        const ttl = (title.children as Node[]).find(n => n.type === 'Box' && n.props.overflow === 'hidden')!
        expect(ttl, at).toBeDefined()
        expect(texts(ttl), at).not.toContain('\n')
        expect(rooms[i]!.pinned ? texts(pinOf(card)) : pinOf(card), at).toBe(rooms[i]!.pinned ? PIN : undefined)
        expect(rooms[i]!.moreLabel ? more?.props.height : more, at).toBe(rooms[i]!.moreLabel ? 1 : undefined)
        const cols = columnsOf(card)
        expect([3, 4], at).toContain(cols.length)
        expect(cols.map(c => c.props.flexGrow), at).toEqual([...cols.slice(0, -1).map(() => 0), 1])
        const perCol = cols.map(c => cellsOf(c).length)
        expect(new Set(perCol).size, at).toBe(1)
        expect(perCol[0], at).toBe(rooms[i]!.agents.length)
        cols.forEach((col, k) => {
          expect(col.children, at).toHaveLength(rooms[i]!.agents.length)   // nothing but the rows' Texts in a column
          expect(rtl ? col.props.paddingLeft : col.props.paddingRight, at).toBe(1)
          for (const cell of cellsOf(col)) {
            expect(cell.type, at).toBe('Text')
            expect(cell.props.wrap, at).toBe('truncate')
            expect(cell.children, at).toHaveLength(1)
            const v = cell.children[0] as string
            expect(typeof v, at).toBe('string')
            expect(v, at).not.toMatch(/⏱|′|min\b|\n/)
            expect(v, at).not.toMatch(REFUSED_RE)
            if (k === 0) expect(typeof cell.props.color, at).toBe('string')
            else expect(cell.props.color, at).toBeUndefined()
          }
        })
        // the table is as tall as its rows: no spacer in a window that holds every row, so the table block is the table itself
        expect(table, at).toBe(tableOf(card))
      })
      // the rows read as the model says: the status mark with the badges, `${emoji} ${name}`, the model word, the activity or its emoji
      const m = officeModel(p)
      cs.forEach((card, i) => {
        const rows = rowsOf(card)
        const rm = m.rooms[i]!
        rows.forEach((r, k) => {
          const x = rm.rows[k]!
          expect(r, `${columns} ${rtl} ${rm.id} row ${k}`).toEqual(rm.showModel ? [x.status, x.who, x.model, x.act] : [x.status, x.who, x.act])
        })
      })
    }
  }
})

test('render: equal props draw with no setState and no timer; a redraw with the same state hands the same strings', () => {
  const f = fake()
  const p = props()
  const first = JSON.stringify(Office(p, f.surface))
  expect(f.setStates()).toBe(1)            // the one init of the local state
  Office(p, f.surface)
  Office({ ...p }, f.surface)
  expect(JSON.stringify(Office({ ...p, nowMin: p.nowMin + 1 }, f.surface))).toBe(first)
  expect(f.setStates()).toBe(1)
  expect(f.timers).toHaveLength(0)
  expect(f.posts).toHaveLength(0)
})

test('fx: a new ⭐ stamp pulses the finisher\'s row — the four cells tinted, alternating by frame — for FX_DONE_MS on the fx clock, which then stops; the first props prime the stamps; still disables it; no other fx tints anything', () => {
  const f = fake()
  // the first props prime the stamps: no pulse for a star already there
  let p = withAgents(props(), [ag('lead'), ag('a1', { status: 'done', star: 5000, act: '✅ סיים' })])
  let tree = Office(p, f.surface)
  Office(p, f.surface)
  expect(f.timers).toHaveLength(0)
  expect(withBg(tree, FX_BG.done).length + withBg(tree, FX_BG.doneAlt).length).toBe(0)
  const pulse = (t: unknown) => withBg(t, FX_BG.done).length + withBg(t, FX_BG.doneAlt).length
  // a new star on lead (it finished): its row's four cells carry the tint, the clock starts
  p = withAgents(p, [ag('lead', { status: 'done', star: 7000, act: '✅ סיים' }), p.rooms[0]!.agents[1]!])
  tree = Office(p, f.surface)
  expect(pulse(tree)).toBe(4)
  expect(withBg(tree, FX_BG.done).every(n => n.type === 'Text' && n.props.wrap === 'truncate')).toBe(true)   // the tint rides the row's four Texts (no cell Box)
  expect(rowsOf(cards(tree)[0]!)[0]![0]).toBe('⭐')   // the ⭐ badge is the props': on the status column
  expect(f.timers).toHaveLength(1)
  expect(f.timers[0]!.ms).toBe(FX_TICK_MS)
  const sets = f.setStates()
  // the same props again: nothing new starts
  Office(p, f.surface)
  expect(f.timers).toHaveLength(1)
  // each tick alternates the tint; the clock stops after FX_DONE_MS
  const steps = Math.ceil(FX_DONE_MS / FX_TICK_MS)
  let last = withBg(tree, FX_BG.done).length > 0 ? FX_BG.done : FX_BG.doneAlt
  for (let i = 1; i < steps; i++) {
    f.tick()
    tree = Office(p, f.surface)
    const now = withBg(tree, FX_BG.done).length > 0 ? FX_BG.done : FX_BG.doneAlt
    expect(now).not.toBe(last)
    last = now
    expect(pulse(tree)).toBe(4)
    expect(f.timers[0]!.stopped).toBe(false)
  }
  f.tick()
  expect(f.timers[0]!.stopped).toBe(true)
  expect(f.setStates()).toBe(sets + steps)   // one redraw per tick, none besides
  tree = Office(p, f.surface)
  expect(pulse(tree)).toBe(0)
  expect(rowsOf(cards(tree)[0]!)[0]![0]).toBe('⭐')   // (the badge stays while the stamp is alive: the props')
  // a status change alone, or a newcomer, tints nothing and starts no clock
  p = withAgents(p, [...p.rooms[0]!.agents.map(a => a.id === 'a1' ? { ...a, status: 'stale' as const } : a), ag('n1')])
  tree = Office(p, f.surface)
  expect(f.timers).toHaveLength(1)
  expect(nodes(tree).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
  // still: a new stamp starts nothing, and a running pulse is dropped
  p = withAgents(p, p.rooms[0]!.agents.map(a => a.id === 'n1' ? { ...a, status: 'done' as const, star: 9500, act: '✅ סיים' } : a))
  tree = Office({ ...p, prefs: { ...p.prefs, still: true } }, f.surface)
  expect(f.timers).toHaveLength(1)
  expect(pulse(tree)).toBe(0)
  // and back from still, the stamps seen under still start nothing either
  Office(p, f.surface)
  expect(f.timers).toHaveLength(1)
})

test('pointer: down → hit → one post (open on a row, pin at the reading edge of the title, roomDone on the counts, the more line too); move over a title → the dim 📌 without a post; the chrome and the frame lines are dead', () => {
  const f = fake()
  const p = props({ rooms: [room('A', [ag('lead'), ag('a1'), ag('d1', { status: 'done' })], { moreDone: 2, moreLabel: 'עוד 2 שסיימו' })] })
  Office(p, f.surface)
  const C = chromeRows(p)
  const m = officeModel(p)
  const y = (kind: Hit['kind'], id: string) => m.hits.find(h => h.kind === kind && h.id === id)!.y
  // the lead's row: anywhere across it
  f.pointer({ type: 'down', x: p.columns - 3, y: C + y('agent', 'lead'), button: 'left' })
  expect(f.posts).toEqual([{ t: 'open', id: 'lead' }])
  f.pointer({ type: 'up', x: p.columns - 3, y: C + y('agent', 'lead'), button: 'left' })
  // the second row, at its far end
  f.pointer({ type: 'down', x: 0, y: C + y('agent', 'a1'), button: 'left' })
  expect(f.posts[1]).toEqual({ t: 'open', id: 'a1' })
  // the pin zone at the right edge of the title line; the counts (with ✅) at the left edge; the title between them is nothing
  f.pointer({ type: 'down', x: p.columns - 1, y: C + y('pin', 'A'), button: 'left' })
  expect(f.posts[2]).toEqual({ t: 'pin', room: 'A' })
  f.pointer({ type: 'down', x: 1, y: C + y('roomDone', 'A'), button: 'left' })
  expect(f.posts[3]).toEqual({ t: 'roomDone', room: 'A' })
  f.pointer({ type: 'down', x: 22, y: C + y('pin', 'A'), button: 'left' })
  expect(f.posts).toHaveLength(4)
  // the "more finished" line posts the room's toggle too
  f.pointer({ type: 'down', x: 20, y: C + y('moreDone', 'A'), button: 'left' })
  expect(f.posts[4]).toEqual({ t: 'roomDone', room: 'A' })
  // the chrome, the card's border and padding lines, the rule, the blank line, the gap and the rows past the office post nothing; nor does a right click
  for (const yy of [0, 1, 5, C, C + 1, C + 3, C + 7, C + 9, C + 10, C + 11, C + 12]) f.pointer({ type: 'down', x: 5, y: yy, button: 'left' })
  f.pointer({ type: 'down', x: 5, y: C + y('agent', 'lead'), button: 'right' })
  expect(f.posts.length).toBe(5)
  // the head hover: a move over the title line → setState with hoverRoom, the card draws a dim 📌; a second move there changes nothing
  const sets = f.setStates()
  f.pointer({ type: 'move', x: 20, y: C + y('pin', 'A') })
  expect(f.surface.state!.hoverRoom).toBe('A')
  expect(f.setStates()).toBe(sets + 1)
  f.pointer({ type: 'move', x: 30, y: C + y('pin', 'A') })
  expect(f.setStates()).toBe(sets + 1)
  let tree = Office(p, f.surface)
  const pinOfTree = (t: unknown) => pinOf(cards(t)[0]!)
  expect(texts(pinOfTree(tree))).toBe(PIN)
  expect(pinOfTree(tree)!.props.dimColor).toBe(true)
  expect((partsOf(cards(tree)[0]!).title.children as Node[]).map(n => n.type)).toEqual(['Text', 'Box', 'Box'])   // the dim 📌 before the title: the title shifts
  // over a row: the head hover ends (no row hover: no band, no setState for the row)
  f.pointer({ type: 'move', x: 7, y: C + y('agent', 'lead') })
  expect(f.surface.state!.hoverRoom).toBe(null)
  expect(f.setStates()).toBe(sets + 2)
  f.pointer({ type: 'move', x: 30, y: C + y('agent', 'a1') })
  expect(f.setStates()).toBe(sets + 2)
  tree = Office(p, f.surface)
  expect(pinOfTree(tree)).toBeUndefined()   // no pin cell at all: the title flush at the reading edge again
  expect((partsOf(cards(tree)[0]!).title.children as Node[]).map(n => n.type)).toEqual(['Box', 'Box'])
  expect(nodes(tree).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
  f.pointer({ type: 'leave', x: 0, y: 0 })
  f.pointer({ type: 'leave', x: 0, y: 0 })
  expect(f.setStates()).toBe(sets + 2)
  expect(f.posts.length).toBe(5)   // no post for any move/leave
  // a click on a row also takes the keyboard focus there: the marker on the inner side of its status mark (the mark itself at the edge)
  expect(f.surface.state!.focus).toBe('a1')
  tree = Office(p, f.surface)
  expect(rowsOf(cards(tree)[0]!).map(r => r[0])).toEqual(['●', `${FOCUS_MARK.rtl}●`, '○'])
  // a pinned room's head: its 📌 bright, hovered or not, no hoverRoom (no setState); its pin zone still unpins
  const q = props({ rooms: [room('B', [ag('b1')], { pinned: true })] })
  const g = fake()
  Office(q, g.surface)
  const Cq = chromeRows(q)
  expect(texts(pinOfTree(Office(q, g.surface)))).toBe(PIN)
  const setsQ = g.setStates()
  g.pointer({ type: 'move', x: 20, y: Cq + 2 })
  expect(g.surface.state!.hoverRoom).toBeNull()
  expect(g.setStates()).toBe(setsQ)
  expect(pinOfTree(Office(q, g.surface))!.props.dimColor).toBeUndefined()
  g.pointer({ type: 'down', x: q.columns - 1, y: Cq + 2, button: 'left' })
  expect(g.posts).toEqual([{ t: 'pin', room: 'B' }])
  // a pin click clears the head hover with it (the rooms reorder: a dim 📌 must not ride the room to its new card)
  f.pointer({ type: 'move', x: 20, y: C + y('pin', 'A') })
  expect(f.surface.state!.hoverRoom).toBe('A')
  f.pointer({ type: 'down', x: p.columns - 1, y: C + y('pin', 'A'), button: 'left' })
  expect(f.surface.state!.hoverRoom).toBeNull()
  expect(f.posts[f.posts.length - 1]).toEqual({ t: 'pin', room: 'A' })
})

test('window: the cards the window touches are drawn whole, their rows only where they lie in the window (ONE spacer above and one below the table for the rest, not one per column); the cards above are one spacer; only the window\'s lines answer the pointer; the row budget leaves the lowest rows blank', () => {
  // 30 agents at 45 columns: one card of 37 lines, its rows on lines 4..33
  const many = withAgents(props(), Array.from({ length: 30 }, (_, i) => ag(`a${i}`)))
  expect(rowCount(many)).toBe(37)
  const t2 = Office({ ...many, offset: 12, rows: 10 }, fake(45, 0).surface)
  // the window: lines 6..15 (offset 12 - the chrome's 6): rows a2..a11; the card starts at line 0, so no spacer before it
  expect(kidsOf(t2).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  const card = cards(t2)[0]!
  const block = partsOf(card).table
  expect(block).toBe(blockOf(card))
  expect(block).toMatchObject({ props: { flexDirection: 'column', width: '100%' } })
  const [above, tbl, below] = block.children as Node[]
  expect(above).toMatchObject({ type: 'Box', props: { height: 2 } })    // a0, a1 above the window
  expect(tbl).toBe(tableOf(card))
  expect(below).toMatchObject({ type: 'Box', props: { height: 18 } })   // a12..a29 below it
  expect(block.children).toHaveLength(3)
  for (const col of columnsOf(card)) {
    expect(cellsOf(col)).toHaveLength(10)
    expect(col.children).toHaveLength(10)   // no spacer inside a column
  }
  expect(rowsOf(card).map(r => r[1])).toEqual(Array.from({ length: 10 }, (_, i) => `🦉 a${i + 2}`))
  // two rooms, the window past the first: the first card is not drawn — a spacer of its lines stands before the second
  const two = props({ rooms: [room('A', Array.from({ length: 10 }, (_, i) => ag(`a${i}`))), room('B', Array.from({ length: 10 }, (_, i) => ag(`b${i}`)))], offset: 6 + 20, rows: 10 })
  const t3 = Office(two, fake(45, 0).surface)
  expect(kidsOf(t3).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'spacer', 'round'])
  expect(byKey(t3, 'spacer')!.props.height).toBe(17)   // room A's card: 7 + 10 lines
  expect(cards(t3)).toHaveLength(1)
  expect(rowsOf(cards(t3)[0]!).map(r => r[1])).toEqual(Array.from({ length: 9 }, (_, i) => `🦉 b${i}`))   // lines 20..29: B's title at 19, rule 20, rows 21..29
  // a window on the gap between the cards draws both (the first for its frame alone: its rows are a spacer)
  const t4 = Office({ ...two, offset: 6 + 14, rows: 10 }, fake(45, 0).surface)
  expect(cards(t4)).toHaveLength(2)
  expect(columnsOf(cards(t4)[0]!)).toHaveLength(0)
  expect(partsOf(cards(t4)[0]!).table).toMatchObject({ props: { height: 10 } })
  expect(rowsOf(cards(t4)[1]!)).toHaveLength(3)   // lines 14..23: B's rows at 21, 22, 23
  // only the window's lines answer: a click on a row above the window (in the spacer) or on one past it hits nothing
  const f = fake(45, 0)
  Office({ ...two, offset: 6 + 20, rows: 10 }, f.surface)
  expect(f.surface.state!.inst.win).toEqual({ from: 20, count: 10 })
  const C = chromeRows(two)
  f.pointer({ type: 'down', x: 5, y: C + 4, button: 'left' })        // a0's row: in the spacer
  f.pointer({ type: 'down', x: 5, y: C + 30, button: 'left' })       // b9's row: past the window
  f.pointer({ type: 'move', x: 5, y: C + 19 })                       // B's title: above the window → no head hover
  expect(f.posts).toEqual([])
  expect(f.surface.state!.hoverRoom).toBeNull()
  f.pointer({ type: 'down', x: 5, y: C + 21, button: 'left' })       // b0's row: the window's second line
  expect(f.posts).toEqual([{ t: 'open', id: 'b0' }])
  // the row budget: a 150-row pane over 200 agents draws WINDOW_ROWS rows and leaves the rest blank; the window says so
  const crowd = withAgents(props({ rows: 150 }), Array.from({ length: 200 }, (_, i) => ag(`g${i}`)))
  const g = fake(45, 0)
  const t5 = Office(crowd, g.surface)
  expect(rowsOf(cards(t5)[0]!)).toHaveLength(WINDOW_ROWS)
  expect(g.surface.state!.inst.win).toEqual({ from: 0, count: 4 + WINDOW_ROWS })
  g.pointer({ type: 'down', x: 5, y: 6 + 4 + WINDOW_ROWS, button: 'left' })   // the first row left blank
  expect(g.posts).toEqual([])
  g.pointer({ type: 'down', x: 5, y: 6 + 4 + WINDOW_ROWS - 1, button: 'left' })
  expect(g.posts).toEqual([{ t: 'open', id: `g${WINDOW_ROWS - 1}` }])
  // the empty office draws no cards: nothing answers
  const h = fake()
  Office(props({ rooms: [], empty: { kind: 'office', msg: 'm', sub: '' } }), h.surface)
  h.pointer({ type: 'down', x: 2, y: C + 1, button: 'left' })
  expect(h.posts).toHaveLength(0)
})

test('THE OVERLAY IN VIEW (render): a drawer or the settings opened while the pane is scrolled is drawn AT THE WINDOW\'S TOP — Client row `offset` — after a spacer of the lines above the window; the card the window cuts through continues under it from the window\'s first line as a frameless fragment (no lines above the window drawn), the cards under it where they were; a click on the overlay hits no row, the rows under it answer; an overlay as tall as the window stays under the fixed chrome', () => {
  // 60 agents at 45 columns: 67 layout lines (rows on 4..63, the bottom padding 64, the bottom border 65, the gap 66); a 25-row
  // window scrolled 40 rows down shows lines from 34
  const crowd = withAgents(props({ rows: 25, offset: 40 }), Array.from({ length: 60 }, (_, i) => ag(`g${i}`)))
  expect(rowCount(crowd)).toBe(67)
  // no overlay: the card from its top (line 0: no spacer), rows g30.. (line 34) in the window, 30 rows spacered above — the
  // lines above the window lie above the viewport, which the engine's native scroll hides
  const plain = Office(crowd, fake(45, 0).surface)
  expect(kidsOf(plain).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  expect(rowsOf(cards(plain)[0]!)[0]![1]).toBe('🦉 g30')
  // the drawer opens (a click on g43): a spacer of the 34 lines above the window, then the drawer — at Client row 6 + 34 = 40,
  // the engine's offset: the viewport's first rows — then the card from line 34 as a FRAGMENT: no frame (the frame's cells as
  // padding), no spacer for the rows above the window, the window's rows as cells and the rest a spacer, the bottom padding line,
  // the frame's bottom as a rule, the gap as its margin; its height exact, so line y stays at Client row C + y
  const p = { ...crowd, selected: 'g43', drawer: drawer({ id: 'g43' }) }
  const C = chromeRows(p)
  const H = overlayRows(p)
  expect(C).toBe(CHROME_ROWS + H)
  const f = fake(45, 0)
  const tree = Office(p, f.surface)
  expect(kidsOf(tree).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'spacer', 'drawer', 'fragment'])
  expect(byKey(tree, 'spacer')!.props.height).toBe(34)
  expect(clientRowOf(tree, 'drawer')).toBe(p.offset)
  expect(byKey(tree, 'drawer')).toMatchObject({ props: { borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, paddingY: 1, marginBottom: OVERLAY_GAP, height: H - OVERLAY_GAP, overflow: 'hidden' } })
  expect(texts(byKey(tree, 'drawer'))).toMatch(/המנהל/)
  expect(f.surface.state!.inst.win).toEqual({ from: 34, count: 25 - H })
  const frag = byKey(tree, 'fragment')!
  expect(cards(tree)).toEqual([frag])
  expect(frag).toMatchObject({ props: { flexDirection: 'column', paddingX: 2, marginBottom: 1, width: '100%', height: 66 - 34, overflow: 'hidden' } })
  expect(frag.props.borderStyle).toBeUndefined()
  expect(clientRowOf(tree, 'fragment')).toBe(C + 34)
  expect(rowsOf(frag)[0]![1]).toBe('🦉 g30')
  expect(rowsOf(frag)).toHaveLength(25 - H)
  for (const col of columnsOf(frag)) {
    expect(cellsOf(col)).toHaveLength(25 - H)
    expect(col.children).toHaveLength(25 - H)
  }
  const fl = frag.children as Node[]
  expect(fl).toHaveLength(3)                                                    // the table block, the bottom padding line, the frame's bottom
  expect(fl[0]).toBe(blockOf(frag))
  expect((fl[0]!.children as Node[])[0]).toBe(tableOf(frag))                   // no spacer above: those rows are not in the fragment
  expect((fl[0]!.children as Node[])[1]).toMatchObject({ type: 'Box', props: { height: 30 - (25 - H) } })   // g30.. past the window: one spacer under the table
  expect(fl[0]!.children).toHaveLength(2)
  expect(fl[1]).toMatchObject({ type: 'Box', props: { height: 1 } })
  expect(fl[2]).toMatchObject({ type: 'Box', props: { height: 1, overflow: 'hidden' } })
  expect(texts(fl[2])).toBe('─'.repeat(45))
  // the pointer: the drawer's rows (offset..offset + H - 1, its gap included) and the drawer's old place under the chrome (the
  // spacer's rows now) answer nothing; the first row under the drawer — Client row offset + H = C + 34 — opens g30
  for (let yy = p.offset; yy < p.offset + H; yy++) f.pointer({ type: 'down', x: 5, y: yy, button: 'left' })
  for (let yy = CHROME_ROWS; yy < CHROME_ROWS + H; yy++) f.pointer({ type: 'down', x: 5, y: yy, button: 'left' })
  expect(f.posts).toEqual([])
  expect(C + 34).toBe(p.offset + H)
  f.pointer({ type: 'down', x: 5, y: p.offset + H, button: 'left' })
  expect(f.posts).toEqual([{ t: 'open', id: 'g30' }])
  f.pointer({ type: 'down', x: 5, y: p.offset + 25 - 1, button: 'left' })     // the viewport's last row: g43's (line 34 + 13)
  expect(f.posts[1]).toEqual({ t: 'open', id: `g${30 + 25 - H - 1}` })
  // two rooms — A lines 0..36, B 37..73 (its title 39, its rule 40, its rows 41..70, its gap 73) — the window from line 40 (B's
  // rule): the spacer is 40 lines (A whole, B's border, padding and title), the drawer at the offset, B's fragment from its rule
  const two = props({ rows: 25, offset: 6 + 40, rooms: [room('A', Array.from({ length: 30 }, (_, i) => ag(`a${i}`))), room('B', Array.from({ length: 30 }, (_, i) => ag(`b${i}`)))], selected: 'b5', drawer: drawer({ id: 'b5' }) })
  const H2 = overlayRows(two)
  const C2 = chromeRows(two)
  const t2 = Office(two, fake(45, 0).surface)
  expect(kidsOf(t2).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'spacer', 'drawer', 'fragment'])
  expect(byKey(t2, 'spacer')!.props.height).toBe(40)
  expect(clientRowOf(t2, 'drawer')).toBe(two.offset)
  const f2 = byKey(t2, 'fragment')!
  expect((f2.children as Node[]).map(n => texts(n).startsWith('─') ? 'rule' : n === blockOf(f2) ? 'table' : `h${n.props.height}`)).toEqual(['rule', 'table', 'h1', 'rule'])
  expect(f2.props.height).toBe(73 - 40)
  expect(rowsOf(f2)).toHaveLength(25 - H2 - 1)
  expect(rowsOf(f2)[0]![1]).toBe('🦉 b0')
  // the window's top at B's title (line 39): the fragment opens with the title line — its pin zone and head hover answer, as in a
  // whole card; at B's padding line (38) a blank line leads; at B's top (37) B is a whole card after a spacer of A's lines
  const g = fake(45, 0)
  const atTitle = Office({ ...two, offset: 6 + 39 }, g.surface)
  const f3 = byKey(atTitle, 'fragment')!
  expect((f3.children as Node[]).length).toBe(5)
  expect(texts((f3.children as Node[])[0])).toMatch(/room B/)
  g.pointer({ type: 'move', x: 20, y: C2 + 39 })
  expect(g.surface.state!.hoverRoom).toBe('B')
  expect(texts(((byKey(Office({ ...two, offset: 6 + 39 }, g.surface), 'fragment')!.children as Node[])[0]!.children as Node[])[0])).toBe(PIN)
  g.pointer({ type: 'down', x: 44, y: C2 + 39, button: 'left' })
  expect(g.posts).toEqual([{ t: 'pin', room: 'B' }])
  g.pointer({ type: 'down', x: 5, y: C2 + 41, button: 'left' })
  expect(g.posts[1]).toEqual({ t: 'open', id: 'b0' })
  const atPad = byKey(Office({ ...two, offset: 6 + 38 }, fake(45, 0).surface), 'fragment')!
  expect((atPad.children as Node[]).length).toBe(6)
  expect((atPad.children as Node[])[0]).toMatchObject({ type: 'Box', props: { height: 1 } })
  expect(atPad.props.height).toBe(73 - 38)
  const edge = Office({ ...two, offset: 6 + 37 }, fake(45, 0).surface)
  expect(kidsOf(edge).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'spacer', 'drawer', 'round'])
  expect(byKey(edge, 'spacer')!.props.height).toBe(37)
  expect(clientRowOf(edge, 'drawer')).toBe(6 + 37)
  expect(rowsOf(cards(edge)[0]!)).toHaveLength(25 - H2 - 4)
  // every window top through B: the drawer at the offset, the fragment (or the whole card at B's top) right under it at C + from,
  // its height the lines from `from` to B's bottom border (the gap its margin; the gap alone a one-row spacer), the rows drawn the
  // window's row lines
  const mB = officeModel(two)
  for (let from = 37; from <= 73; from++) {
    const q = { ...two, offset: 6 + from }
    const fq = fake(45, 0)
    const tq = Office(q, fq.surface)
    const at = `from ${from}`
    expect(clientRowOf(tq, 'drawer'), at).toBe(q.offset)
    const { count } = fq.surface.state!.inst.win
    expect(fq.surface.state!.inst.win.from, at).toBe(from)
    const cs = cards(tq)
    if (from === 37) expect(cs[0]!.props.key, at).toBeUndefined()
    else {
      expect(cs[0]!.props.key, at).toBe('fragment')
      expect(clientRowOf(tq, 'fragment'), at).toBe(C2 + from)
      if (from < 73) expect(cs[0]!.props, at).toMatchObject({ height: 73 - from, marginBottom: 1 })
      else expect(cs[0]!.props, at).toEqual({ key: 'fragment', height: 1 })
    }
    expect(cs.reduce((n, c) => n + rowsOf(c).length, 0), at).toBe(mB.lines.slice(from, from + count).filter(l => l.kind === 'row').length)
  }
  // the settings likewise (they win over the drawer)
  const ph = { ...p, helpOpen: true }
  const help = Office(ph, fake(45, 0).surface)
  expect(kidsOf(help).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'spacer', 'help', 'fragment'])
  expect(clientRowOf(help, 'help')).toBe(ph.offset)
  expect(byKey(help, 'help')).toMatchObject({ props: { height: HELP_ROWS, marginBottom: OVERLAY_GAP } })
  expect(texts(byKey(help, 'help'))).toMatch(/^הגדרות$/m)
  expect(rowsOf(cards(help)[0]!)).toHaveLength(25 - overlayRows(ph))
  // at the top the drawer sits under the fixed chrome, the cards from line 0 — whole, no fragment
  const top = Office({ ...p, offset: 0 }, fake(45, 0).surface)
  expect(kidsOf(top).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'drawer', 'round'])
  expect(rowsOf(cards(top)[0]!)[0]![1]).toBe('🦉 g0')
  // a window no taller than the drawer: the drawer keeps its place in the chrome, scrolled as content — the window (lines 29..39,
  // offset 46 less the whole chrome of 17) cuts through A's card, so A is drawn from its top with no spacer, then B
  const sf = fake(45, 0)
  const short = Office({ ...two, rows: H2 }, sf.surface)
  expect(kidsOf(short).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'drawer', 'round', 'round'])
  expect(sf.surface.state!.inst.win).toEqual({ from: 29, count: H2 })
  expect(rowsOf(cards(short)[0]!).map(r => r[1])).toEqual(['🦉 a25', '🦉 a26', '🦉 a27', '🦉 a28', '🦉 a29'])
  expect(rowsOf(cards(short)[1]!)).toHaveLength(0)
  // the overlay keeps its place at the top too: scrolled 20 rows further, a spacer stands for A's card
  const further = Office({ ...two, rows: H2, offset: 46 + 20 }, fake(45, 0).surface)
  expect(kidsOf(further).map(n => n.props.key ?? n.props.borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'drawer', 'spacer', 'round'])
  expect(byKey(further, 'spacer')!.props.height).toBe(37)
})

test('keys after a click: j/k walk the rows with no post (the keyboard focus is the module\'s own, a marker beside the status mark), o/Enter open, x closes, f/m/l/h/d/s are the toolbar', () => {
  const f = fake()
  const p = props({ rooms: [room('A', [ag('lead'), ag('a1')]), room('B', [ag('b1')])] })
  Office(p, f.surface)
  f.key({ key: 'j' })
  expect(f.surface.state!.focus).toBe('lead')
  f.key({ key: 'j' })
  f.key({ key: 'down' })
  expect(f.surface.state!.focus).toBe('b1')
  f.key({ key: 'j' })                       // clamps at the last
  expect(f.surface.state!.focus).toBe('b1')
  expect(f.posts).toEqual([])               // one post per frame: a focus post could displace a click's open
  const tree = Office(p, f.surface)
  expect(rowsOf(cards(tree)[1]!)[0]![0]).toBe(`${FOCUS_MARK.rtl}●`)
  expect(rowsOf(cards(tree)[0]!).map(r => r[0])).toEqual(['●', '●'])
  expect(nodes(tree).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)   // no focus band
  f.key({ key: 'k' })
  expect(f.surface.state!.focus).toBe('a1')
  f.key({ key: 'up' })
  expect(f.surface.state!.focus).toBe('lead')
  f.key({ key: 'down' })
  expect(f.posts).toEqual([])
  f.key({ key: 'return' })
  expect(f.posts[0]).toEqual({ t: 'open', id: 'a1' })
  f.key({ key: 'o' })
  expect(f.posts[1]).toEqual({ t: 'open', id: 'a1' })
  for (const [k, t] of [['x', 'close'], ['f', 'showDone'], ['m', 'mute'], ['l', 'lang'], ['h', 'help'], ['d', 'demo'], ['s', 'still']] as const) {
    f.key({ key: k })
    expect(f.posts[f.posts.length - 1]).toEqual({ t })
  }
  f.key({ key: 'q' })
  f.key({ key: 'f', ctrl: true })
  expect(f.posts.length).toBe(9)
  expect(f.posts.some(m => (m as { t: string }).t === 'focus')).toBe(false)
  // a focused agent that leaves the office: the focus is dropped, no stale post
  Office(withAgents(p, [ag('lead')]), f.surface)
  f.key({ key: 'o' })
  expect(f.posts.length).toBe(9)
})

test('keys: j / k keep to the rows drawn — from no focus, j lands on the window\'s first row and stops at its last; a focus scrolled out of the window restarts from the window\'s first (j) or last (k) row; o opens the focus', () => {
  // 30 agents at 45 columns: g_i on layout line i + 4. A 13-row window scrolled 25 rows: lines 19..31 — g15..g27
  const p = withAgents(props({ rows: 13, offset: 25 }), Array.from({ length: 30 }, (_, i) => ag(`g${i}`)))
  const f = fake(45, 0)
  Office(p, f.surface)
  expect(f.surface.state!.inst.win).toEqual({ from: 19, count: 13 })
  f.key({ key: 'j' })
  expect(f.surface.state!.focus).toBe('g15')
  for (let i = 0; i < 14; i++) f.key({ key: 'j' })
  expect(f.surface.state!.focus).toBe('g27')                 // the window's last row: the walk stops there
  const tree = Office(p, f.surface)
  expect(rowsOf(cards(tree)[0]!).map(r => r[0]!).filter(s => s.includes(FOCUS_MARK.rtl))).toHaveLength(1)   // ... and its marker is drawn
  f.key({ key: 'k' })
  expect(f.surface.state!.focus).toBe('g26')
  // the person scrolls back to the top: g26 is out of the window (lines 0..12: the frame, the title, the rule and g0..g8) — o / Enter
  // open nothing for it (a drawer for a row the person cannot see), the walk restarts from the window's first row
  Office({ ...p, offset: 6 }, f.surface)
  f.key({ key: 'o' })
  f.key({ key: 'return' })
  expect(f.posts).toEqual([])
  f.key({ key: 'j' })
  expect(f.surface.state!.focus).toBe('g0')
  Office(p, f.surface)                                       // and down again: g0 is out; k restarts from the window's last
  f.key({ key: 'o' })
  expect(f.posts).toEqual([])
  f.key({ key: 'k' })
  expect(f.surface.state!.focus).toBe('g27')
  expect(f.posts).toEqual([])
  f.key({ key: 'o' })
  expect(f.posts).toEqual([{ t: 'open', id: 'g27' }])
})

test('the row budget\'s cut: the lines of the cut card drawn past it in the viewport (its more line, its frame) are live, its blank rows and the cards past the cut are dead; the j / k walk and o keep to the rows drawn', () => {
  // 120 agents in A (its more line on line 125, its card to line 128) and B after it (its title on line 131): a 150-row pane at the
  // top shows lines 0..143, the row budget cuts the rows at g99 (line 103); A is drawn whole (its lines past the cut are in the
  // viewport), B is not drawn at all (its top is past the cut)
  const p = props({ rows: 150, rooms: [room('A', Array.from({ length: 120 }, (_, i) => ag(`g${i}`)), { moreDone: 2, moreLabel: 'עוד 2 שסיימו' }), room('B', [ag('b0'), ag('b1')])] })
  const m = officeModel(p)
  expect(m.rooms[0]).toMatchObject({ moreAt: 125, height: 129 })
  expect(m.rooms[1]).toMatchObject({ top: 129, titleAt: 131 })
  const f = fake(45, 0)
  const tree = Office(p, f.surface)
  expect(f.surface.state!.inst.win).toEqual({ from: 0, count: 4 + WINDOW_ROWS })
  expect(f.surface.state!.inst.view).toBe(rowCount(p))   // the viewport (144 lines) holds the whole office (138): every line of it is in view
  expect(rowCount(p)).toBe(138)
  expect(cards(tree)).toHaveLength(1)
  expect(partsOf(cards(tree)[0]!).more).toBeDefined()
  expect(rowsOf(cards(tree)[0]!)).toHaveLength(WINDOW_ROWS)
  const C = chromeRows(p)
  f.pointer({ type: 'down', x: 20, y: C + 125, button: 'left' })        // A's more line, drawn past the cut: live
  expect(f.posts).toEqual([{ t: 'roomDone', room: 'A' }])
  f.pointer({ type: 'down', x: 5, y: C + 110, button: 'left' })         // g106's row: left blank by the budget — dead
  f.pointer({ type: 'down', x: 5, y: C + 4 + WINDOW_ROWS, button: 'left' })
  f.pointer({ type: 'down', x: 44, y: C + 131, button: 'left' })        // B's pin zone: B is not drawn — dead
  f.pointer({ type: 'down', x: 5, y: C + 133, button: 'left' })         // b0's row: not drawn
  f.pointer({ type: 'down', x: 5, y: C + 127, button: 'left' })         // A's bottom border: no control
  expect(f.posts).toHaveLength(1)
  f.pointer({ type: 'move', x: 20, y: C + 131 })                         // B's title: no head hover (nothing drawn there)
  expect(f.surface.state!.hoverRoom).toBeNull()
  f.pointer({ type: 'move', x: 20, y: C + 2 })                           // A's title: in the window
  expect(f.surface.state!.hoverRoom).toBe('A')
  f.pointer({ type: 'down', x: 5, y: C + 103, button: 'left' })         // the last row drawn
  expect(f.posts[1]).toEqual({ t: 'open', id: 'g99' })
  // the walk ends at the last row drawn; o opens it, never a blank row
  for (let i = 0; i < 130; i++) f.key({ key: 'j' })
  expect(f.surface.state!.focus).toBe('g99')
  f.key({ key: 'o' })
  expect(f.posts[2]).toEqual({ t: 'open', id: 'g99' })
  expect(f.posts).toHaveLength(3)
})

test('search: the Input draws the typed text (not props.search) across props updates; the post is debounced; an outside change is adopted', () => {
  const f = fake()
  const p = props()
  let tree = Office(p, f.surface)
  const input = () => nodes(tree).find(n => n.type === 'Input')!
  expect(input().props.value).toBe('')
  const onInput = input().props.onInput as (v: string) => void
  onInput('a')
  onInput('ab')
  expect(f.posts).toHaveLength(0)
  expect(f.timers).toHaveLength(2)                 // one debounce clock per keystroke, the earlier one stopped
  expect(f.timers[0]!.stopped).toBe(true)
  expect(f.timers[1]!.ms).toBe(SEARCH_DEBOUNCE_MS)
  // a publish lands between keystrokes with the old search: the field keeps 'ab'
  tree = Office({ ...p, nowMin: p.nowMin + 1 }, f.surface)
  expect(input().props.value).toBe('ab')
  f.tick()
  expect(f.posts).toEqual([{ t: 'search', q: 'ab' }])
  expect(f.timers[1]!.stopped).toBe(true)
  // the echo of our own post keeps the field; so does an echo of an older post while typing went on
  tree = Office({ ...p, search: 'ab' }, f.surface)
  expect(input().props.value).toBe('ab')
  ;(input().props.onInput as (v: string) => void)('abc')
  tree = Office({ ...p, search: 'ab', nowMin: 5 }, f.surface)
  expect(input().props.value).toBe('abc')
  f.tick()
  expect(f.posts[1]).toEqual({ t: 'search', q: 'abc' })
  // Enter posts at once (no debounce left running)
  ;(input().props.onSubmit as (v: string) => void)('abcd')
  expect(f.posts[2]).toEqual({ t: 'search', q: 'abcd' })
  expect(f.timers.every(t => t.stopped)).toBe(true)
  // an outside change (the hooks cleared the search) is adopted
  tree = Office({ ...p, search: 'abcd' }, f.surface)
  tree = Office({ ...p, search: '' }, f.surface)
  expect(input().props.value).toBe('')
  // the placeholder is the label (without the trailing ellipsis) with the glass, as the probe writes it: the glass trails the
  // Hebrew word in the string (office-layout.ts iconLabel), leads the English one
  expect(input().props.placeholder).toBe('חיפוש סוכנים 🔍')
  expect((nodes(Office({ ...p, rtl: false, lang: 'en', labels: LABELS_EN }, fake().surface)).find(n => n.type === 'Input')!.props as { placeholder: string }).placeholder).toBe('🔍 Search agents')
  // a pane too narrow for the word cuts it (whole glyphs, the ellipsis trailing), the glass whole: never wider than the line by LINE_FIT
  const narrowPh = (q: Partial<OfficeProps>) => (nodes(Office(props(q), fake(q.columns).surface)).find(n => n.type === 'Input')!.props as { placeholder: string }).placeholder
  expect(narrowPh({ columns: 12 })).toBe('חיפוש… 🔍')
  expect(narrowPh({ columns: 12, rtl: false, lang: 'en', labels: LABELS_EN })).toBe('🔍 Searc…')
  for (const columns of [8, 12, 15, 16, 45]) { expect(textWidth(narrowPh({ columns }))).toBeLessThanOrEqual(Math.max(4, fitLine(columns))); expect(textWidth(narrowPh({ columns, rtl: false, lang: 'en', labels: LABELS_EN }))).toBeLessThanOrEqual(Math.max(4, fitLine(columns))) }
  // a pasted page: the field and the post keep SEARCH_MAX code points (never half an emoji) — a post over the surface's
  // bound would throw in the handler, and the Input's value would swell the tree past its bound (either unmounts the office)
  ;(input().props.onSubmit as (v: string) => void)('🔍'.repeat(SEARCH_MAX + 50))
  expect(f.posts[f.posts.length - 1]).toEqual({ t: 'search', q: '🔍'.repeat(SEARCH_MAX) })
  tree = Office({ ...p, search: '' }, f.surface)
  expect(input().props.value).toBe('🔍'.repeat(SEARCH_MAX))
  ;(input().props.onInput as (v: string) => void)('x'.repeat(100_010))
  tree = Office({ ...p, search: '🔍'.repeat(SEARCH_MAX) }, f.surface)
  expect(input().props.value).toBe('x'.repeat(SEARCH_MAX))
  f.tick()
  expect(f.posts[f.posts.length - 1]).toEqual({ t: 'search', q: 'x'.repeat(SEARCH_MAX) })
  // control characters (an escape sequence in a paste) become spaces: the surface refuses an Input value holding one
  ;(input().props.onSubmit as (v: string) => void)('red\u001b[31m\u0007bug')
  expect(f.posts[f.posts.length - 1]).toEqual({ t: 'search', q: 'red [31m bug' })
  tree = Office({ ...p, search: 'red [31m bug' }, f.surface)
  expect(input().props.value).toBe('red [31m bug')
  // a paste from a Hebrew source carries bidi marks: removed from the field and the post
  ;(input().props.onSubmit as (v: string) => void)('‫בדיקה‬‏')
  expect(f.posts[f.posts.length - 1]).toEqual({ t: 'search', q: 'בדיקה' })
  tree = Office({ ...p, search: 'בדיקה' }, f.surface)
  expect(input().props.value).toBe('בדיקה')
  // an outside value is cleaned too (the hooks clean what they store; the module never draws one it would be refused for)
  tree = Office({ ...p, search: 'a\u0000b' }, f.surface)
  expect(input().props.value).toBe('a b')
})

test('the drawer (a card in the cards\' style), the settings popover and the empty office draw from props and labels; Buttons post; no selection band — the selected row is flagged, not tinted', () => {
  const f = fake()
  const p = props({ selected: 'lead', drawer: drawer({ result: 'found 3 docs', truncated: true }) })
  let tree = Office(p, f.surface)
  const t = texts(tree)
  // the name line (the persona with its emoji, one bold Text), the chips, the headings; a composed line (the model line, the ✂
  // note) is ONE Text of its parts a space apart, drawn as drawerLines cut it to the inner width — at 45 columns (30 cells) the
  // model line loses the activity's word and the note its end, each to an ellipsis (the height-1 Box would chop them at the edge
  // without one); at 70 columns (49 cells) both are whole; a long model id is cut the same way
  expect(t).toMatch(/^💼 המנהל$/m)
  expect(t).toMatch(/^משימה$/m)
  expect(t).toMatch(/map the docs/)
  expect(t).toMatch(/^תוצאה$/m)
  expect(t).toMatch(/found 3 docs/)
  expect(t).toMatch(/ זמן 3 דק׳ /)
  const inner45 = drawerInner(45)
  expect(inner45).toBe(30)
  expect(t).toMatch(/^מודל 🧠 Opus 5\.5 · פעולה 🧠 ח…$/m)
  expect(t).toMatch(/^✂ התוצאה קוצרה — לפלט המלא פ…$/m)
  for (const l of drawerLines(p.drawer!, LABELS, inner45)) if (l.kind !== 'chips') { expect(t).toContain(l.text); expect(textWidth(l.text)).toBeLessThanOrEqual(inner45) }
  const wide = texts(Office({ ...p, columns: 70 }, fake(70).surface))
  expect(wide).toMatch(/^✂ התוצאה קוצרה — לפלט המלא פתחו את הטרמינל$/m)
  expect(wide).toMatch(/^מודל 🧠 Opus 5\.5 · פעולה 🧠 חושב$/m)
  expect(texts(Office({ ...p, drawer: drawer({ model: 'my-long-custom-model-20260101' }) }, fake().surface))).toMatch(/^מודל 🧠 my-long-custom-model-…$/m)
  const box = byKey(tree, 'drawer')!
  expect(box).toMatchObject({ props: { flexDirection: 'column', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, paddingY: 1, marginBottom: OVERLAY_GAP, width: '100%', overflow: 'hidden', alignItems: 'flex-end' } })
  // every line of the drawer is one row tall by construction; the card has a fixed height so the cards below never move
  expect((box.children as Node[]).every(l => l.type === 'Box' && l.props.height === 1 && l.props.overflow === 'hidden')).toBe(true)
  expect(box.props.height).toBe(DRAWER_FRAME_ROWS + (box.children as Node[]).length)
  expect(box.props.height).toBe(chromeRows(p) - CHROME_ROWS - OVERLAY_GAP)
  const close = nodes(tree).find(n => n.type === 'Button' && n.props.key === 'close')!
  expect(close.props.hotkey).toBe('x')
  // read ✕ THEN the word, as the toolbar's controls: the ✕ trails the Hebrew word in the string (iconLabel), leads the English one
  expect(close.props.label).toBe('סגירה ✕')
  expect((nodes(Office({ ...p, rtl: false, lang: 'en', labels: LABELS_EN }, fake().surface)).find(n => n.type === 'Button' && n.props.key === 'close')!.props as { label: string }).label).toBe('✕ Close')
  ;(close.props.onPress as () => void)()
  expect(f.posts).toEqual([{ t: 'close' }])
  // the selection: no band in the tree, no flag in the view model (the open drawer says which agent is selected)
  expect(nodes(tree).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
  // the settings popover: titled הגדרות, the rows, the ✕; it wins over the drawer
  tree = Office({ ...p, helpOpen: true }, f.surface)
  const helpBox = byKey(tree, 'help')!
  expect(helpBox).toMatchObject({ props: { borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, paddingY: 1, height: HELP_ROWS, marginBottom: OVERLAY_GAP } })   // (the cards' padding, the drawer's too)
  expect(nodes((helpBox.children as Node[])[0]).some(n => n.type === 'Text' && n.props.bold === true && texts(n) === 'הגדרות')).toBe(true)
  expect(texts(tree)).not.toMatch(/עזרה|קיצורי מקלדת/)
  expect(texts(tree)).toMatch(/k \/ j/)
  // the close row promises x alone: Escape never reaches a Client (it returns the focus), so the popover does not offer it
  expect(HELP.find(([k]) => k === 'scClose')?.[1]).toBe('x')
  expect(HELP.find(([k]) => k === 'scSettings')?.[1]).toBe('h')
  expect(texts(tree)).not.toMatch(/Esc/)
  expect(texts(tree)).not.toMatch(/found 3 docs/)
  const closeHelp = nodes(tree).find(n => n.type === 'Button' && n.props.key === 'closeHelp')!
  ;(closeHelp.props.onPress as () => void)()
  expect(f.posts[1]).toEqual({ t: 'help' })
  // the toolbar, and the settings' own Buttons (the popover is open here)
  for (const [key, t2] of [['showDone', 'showDone'], ['mute', 'mute'], ['help', 'help'], ['demo', 'demo'], ['still', 'still'], ['lang', 'lang']] as const) {
    const b = nodes(tree).find(n => n.type === 'Button' && n.props.key === key)!
    ;(b.props.onPress as () => void)()
    expect(f.posts[f.posts.length - 1]).toEqual({ t: t2 })
  }
  // the show-finished box: ☑ while the finished are shown — the pref, or the demo (which shows them without touching the
  // pref: the text cards' rule); its press still flips the pref alone. (The icon trails the Hebrew word: the probe's label.)
  const doneBox = (q: OfficeProps) => nodes(Office(q, fake().surface)).find(n => n.type === 'Button' && n.props.key === 'showDone')!
  expect(doneBox(props()).props.label).toBe('הצג שסיימו ☐')
  expect(doneBox(props({ prefs: { showDone: true, muted: true, still: false } })).props.label).toBe('הצג שסיימו ☑')
  expect(doneBox(props({ demo: true })).props.label).toBe('הצג שסיימו ☑')
  const g = fake()
  ;(nodes(Office(props({ demo: true }), g.surface)).find(n => n.type === 'Button' && n.props.key === 'showDone')!.props.onPress as () => void)()
  expect(g.posts).toEqual([{ t: 'showDone' }])
  // the empty office: the message, the sub lines, the demo Button; no cards
  const empty = props({ rooms: [], counts: { run: 0, idle: 0, done: 0 }, empty: { kind: 'office', msg: LABELS.emptyOffice ?? '', sub: LABELS.emptySub ?? '' } })
  tree = Office(empty, fake().surface)
  expect(texts(tree)).toMatch(/המשרד ריק/)
  expect(cards(tree)).toHaveLength(0)
  expect(nodes(tree).find(n => n.type === 'Button' && n.props.key === 'watchDemo')).toBeDefined()
  // its label reads ▶ THEN the words for either reader: i18n words it mark-first (the text cards' form), the Client re-lays it (iconLabel)
  expect(nodes(tree).find(n => n.type === 'Button' && n.props.key === 'watchDemo')?.props.label).toBe('צפו בדמו חי ▶')
  const emptyEn = { ...empty, rtl: false, lang: 'en', labels: LABELS_EN, empty: { kind: 'office', msg: LABELS_EN.emptyOffice ?? '', sub: LABELS_EN.emptySub ?? '' } } as OfficeProps
  expect(nodes(Office(emptyEn, fake().surface)).find(n => n.type === 'Button' && n.props.key === 'watchDemo')?.props.label).toBe('▶ Watch a live demo')
  const nomatch = props({ rooms: [], empty: { kind: 'nomatch', msg: LABELS.emptyNoMatch ?? '', sub: '' } })
  expect(nodes(Office(nomatch, fake().surface)).find(n => n.type === 'Button' && n.props.key === 'watchDemo')).toBeUndefined()
  // the header: the usage meter when given, dim at the other edge
  const withMeter = Office({ ...p, usage: { pct: 42.4, resetsAt: '2026-10-10T14:30:00Z' } }, fake().surface)
  expect(texts(byKey(withMeter, 'header'))).toMatch(/⏳ 5h 42%/)
  expect((byKey(withMeter, 'header')!.children as Node[])[1]!.props.dimColor).toBe(true)
  expect(texts(Office({ ...p, usage: { pct: 85, resetsAt: '' } }, fake().surface))).toMatch(/⚠ 5h 85%/)
})

test('toolbar: three plain Buttons in words — הצג שסיימו ☐ / צליל 🔔 / הגדרות ⚙️, EN ☐ Show finished / 🔔 Sound / ⚙️ Settings — each as the probe writes it (the icon trails a Hebrew word: office-layout.ts iconLabel); the state in the icon (☑, 🔕); the words whenever the three fit the line by LINE_FIT, else the icons alone', () => {
  const TB = ['showDone', 'mute', 'help']
  const labelsOf = (q: OfficeProps) => nodes(Office(q, fake(q.columns).surface)).filter(n => n.type === 'Button' && TB.includes(n.props.key as string)).map(n => n.props.label as string)
  const en = (over: Partial<OfficeProps> = {}) => props({ rtl: false, lang: 'en', labels: LABELS_EN, ...over })
  // (props() is muted; the chime on → 🔔)
  expect(labelsOf(props())).toEqual(['הצג שסיימו ☐', 'צליל 🔕', 'הגדרות ⚙️'])
  expect(labelsOf(props({ prefs: { showDone: true, muted: false, still: false } }))).toEqual(['הצג שסיימו ☑', 'צליל 🔔', 'הגדרות ⚙️'])
  expect(labelsOf(props({ demo: true }))).toEqual(['הצג שסיימו ☑', 'צליל 🔕', 'הגדרות ⚙️'])
  expect(labelsOf(en({ columns: 51 }))).toEqual(['☐ Show finished', '🔕 Sound', '⚙️ Settings'])
  expect(labelsOf(en({ columns: 51, prefs: { showDone: true, muted: false, still: false } }))).toEqual(['☑ Show finished', '🔔 Sound', '⚙️ Settings'])
  // the words are the labels of i18n (LABEL_KEYS: tbDone, tbSound, tbSettings), each passing THE HEBREW RULE on its own
  for (const k of ['tbDone', 'tbSound', 'tbSettings']) { expect(LABELS[k]).toBeTruthy(); expect(hebrewRuleOk(LABELS[k]!)).toBe(true); expect(LABELS_EN[k]).toBeTruthy() }
  expect(labelsOf(props()).every(l => !REFUSED_RE.test(l))).toBe(true)
  // the words from the width where the three labels and their two gaps of TOOLBAR_GAP fit the line by LINE_FIT (Hebrew: 32 cells,
  // so from 39 columns; English, 38: from 46), the icons alone under it — never a cut word. The probe's 51 columns draw the words.
  const wordsHe = ['הצג שסיימו ☐', 'צליל 🔕', 'הגדרות ⚙️']
  const wordsEn = ['☐ Show finished', '🔕 Sound', '⚙️ Settings']
  const need = (ls: string[]) => ls.reduce((n, l, i) => n + (i ? TOOLBAR_GAP : 0) + textWidth(l), 0)
  expect(need(wordsHe)).toBe(32)
  expect(need(wordsEn)).toBe(38)
  expect(labelsOf(props({ columns: 51 }))).toEqual(wordsHe)
  for (let columns = 24; columns <= 200; columns++) {
    expect(labelsOf(props({ columns })), `he ${columns}`).toEqual(fitLine(columns) >= need(wordsHe) ? wordsHe : ['☐', '🔕', '⚙️'])
    expect(labelsOf(en({ columns })), `en ${columns}`).toEqual(fitLine(columns) >= need(wordsEn) ? wordsEn : ['☐', '🔕', '⚙️'])
  }
  expect(labelsOf(props({ columns: 38 }))).toEqual(['☐', '🔕', '⚙️'])
  expect(labelsOf(props({ columns: 39 }))).toEqual(wordsHe)
  expect(labelsOf(en({ columns: 45 }))).toEqual(['☐', '🔕', '⚙️'])
  expect(labelsOf(en({ columns: 46 }))).toEqual(wordsEn)
})

test('settings: the popover holds the demo, motion and language Buttons in words (🎬 דמו / 🎞 תנועה / 🌐 English; ✕ יציאה and 🖼 for the states), their hotkeys d / s / l from COMPACT_BELOW, then the shortcut rows with an s row and the h row naming the settings; HELP_ROWS counts the Buttons row; closed, no such Button is drawn but d / s / l still post', () => {
  const f = fake()
  const open = (over: Partial<OfficeProps> = {}) => props({ helpOpen: true, ...over })
  let tree = Office(open(), f.surface)
  const btn = (k: string, t: unknown = tree) => nodes(t).find(n => n.type === 'Button' && n.props.key === k)
  expect(btn('demo')?.props.label).toBe('דמו 🎬')
  expect(btn('still')?.props.label).toBe('תנועה 🎞')
  expect(btn('lang')?.props.label).toBe('🌐 English')
  // the Buttons row sits right under the title, inside the popover; the hotkeys only when wide (the desktop draws a chip per hotkey)
  const box = byKey(tree, 'help')!
  expect(box.props.height).toBe(HELP_ROWS)
  expect(HELP_ROWS).toBe(2 + 2 + 1 + 1 + HELP.length)   // the border, the padding line above and below, the title, the Buttons row, the shortcuts
  expect(HELP.map(([, keys]) => keys)).toContain('s')
  expect(HELP.map(([k]) => k)).toContain('scStill')
  expect(HELP.map(([k]) => k)).toContain('scSettings')
  expect(LABELS.scStill).toBeTruthy()
  expect(LABELS.scSettings).toBe('הגדרות')
  expect(texts(tree)).toMatch(/^s$/m)
  const rows = box.children as Node[]
  expect(rows.length).toBe(1 + 1 + HELP.length)
  expect(nodes(rows[1]).filter(n => n.type === 'Button').map(n => n.props.key)).toEqual(['demo', 'still', 'lang'])
  expect(nodes(rows[0]).filter(n => n.type === 'Button').map(n => n.props.key)).toEqual(['closeHelp'])
  for (const k of ['demo', 'still', 'lang']) expect(btn(k)?.props.hotkey).toBeUndefined()
  const wide = Office(open({ columns: COMPACT_BELOW }), fake(COMPACT_BELOW).surface)
  expect(['demo', 'still', 'lang'].map(k => btn(k, wide)?.props.hotkey)).toEqual(['d', 's', 'l'])
  // their presses post
  for (const [k, t] of [['demo', 'demo'], ['still', 'still'], ['lang', 'lang']] as const) {
    ;(btn(k)!.props.onPress as () => void)()
    expect(f.posts[f.posts.length - 1]).toEqual({ t })
  }
  // the states: the demo on → ✕ יציאה with the clapper; the motion frozen → 🖼; English: the icon leads, the language Button names Hebrew
  expect(btn('demo', Office(open({ demo: true }), fake().surface))?.props.label).toBe('יציאה ✕ 🎬')
  expect(btn('still', Office(open({ prefs: { showDone: false, muted: true, still: true } }), fake().surface))?.props.label).toBe('תנועה 🖼')
  const en = Office(open({ rtl: false, lang: 'en', labels: LABELS_EN }), fake().surface)
  expect(['demo', 'still', 'lang'].map(k => btn(k, en)?.props.label)).toEqual(['🎬 Demo', '🎞 Motion', '🌐 עברית'])
  expect(btn('demo', Office(open({ rtl: false, lang: 'en', labels: LABELS_EN, demo: true }), fake().surface))?.props.label).toBe('🎬 ✕ Exit')
  // narrow: when the three words do not fit the popover's inner width by LINE_FIT, the icons alone — the language as EN / עב
  const narrow = Office(open({ columns: 28 }), fake(28).surface)
  expect(['demo', 'still', 'lang'].map(k => btn(k, narrow)?.props.label)).toEqual(['🎬', '🎞', 'EN'])
  expect(['demo', 'still', 'lang'].map(k => btn(k, Office(open({ columns: 28, rtl: false, lang: 'en', labels: LABELS_EN }), fake(28).surface))?.props.label)).toEqual(['🎬', '🎞', 'עב'])
  // ...and the icons alone keep their states, as the toolbar's ☑ / 🔕 do: the demo running is `🎬 ✕` (the pair reversed for the
  // Hebrew reader, the 🎬 at the right edge as in the worded label), the motion frozen 🖼
  expect(['demo', 'still', 'lang'].map(k => btn(k, Office(open({ columns: 28, demo: true, prefs: { showDone: false, muted: true, still: true } }), fake(28).surface))?.props.label)).toEqual(['✕ 🎬', '🖼', 'EN'])
  expect(['demo', 'still', 'lang'].map(k => btn(k, Office(open({ columns: 28, demo: true, rtl: false, lang: 'en', labels: LABELS_EN }), fake(28).surface))?.props.label)).toEqual(['🎬 ✕', '🎞', 'עב'])
  expect(['demo', 'still', 'lang'].map(k => btn(k, Office(open({ columns: 36 }), fake(36).surface))?.props.label)).toEqual(['דמו 🎬', 'תנועה 🎞', '🌐 English'])
  // the popover closed: no demo / still / lang Button anywhere, and the letters still post
  const g = fake()
  tree = Office(props(), g.surface)
  for (const k of ['demo', 'still', 'lang']) expect(btn(k)).toBeUndefined()
  for (const [k, t] of [['d', 'demo'], ['s', 'still'], ['l', 'lang']] as const) {
    g.key({ key: k })
    expect(g.posts[g.posts.length - 1]).toEqual({ t })
  }
  expect(g.posts).toHaveLength(3)
})

// (a few thousand renders: a loaded machine stretches the suite tenfold — the 5 s default timeout would fail it with no code change)
test('header: one bold Text of the counts in words (`🎭 עובדים 2 · סיימו 0`) at the reading edge, the five-hour meter dim at the other — the full label (bar and reset clock) where the whole line fits by LINE_FIT from COMPACT_BELOW columns, else the short form, else nothing; the words give way to the icons on a narrow pane', { timeoutMs: 30_000 }, () => {
  const R = new Date(2026, 9, 10, 14, 30).toISOString() // (a local wall-clock time: reads back as 14:30 in any zone)
  const u = { pct: 42.4, resetsAt: R }
  /** The header's two Texts: the counts and the meter ('' when none). */
  const header = (columns: number, over: Partial<OfficeProps> = {}): [string, string] => {
    const h = byKey(Office(props({ columns, ...over }), fake(columns).surface), 'header')!
    const ts = h.children as Node[]
    return [texts(ts[0]), ts[1] ? texts(ts[1]) : '']
  }
  const full = usageLabel(u, 'he', 100)
  const short = usageShort(u)
  // a wide pane: the full label, the bar included, the clock last
  expect(header(120, { usage: u })).toEqual(['🎭 עובדים 2 · סיימו 0', full])
  expect(full).toContain('⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30')
  expect(header(120, { usage: { pct: 85, resetsAt: R }, lang: 'en', labels: LABELS_EN, rtl: false })).toEqual(['🎭 2 working · 0 finished', '⚠ 5h ▰▰▰▰▰▰▰▰▰▱ 85% · 14:30'])
  // no reset time: the label without its clock part
  expect(header(120, { usage: { pct: 42, resetsAt: '' } })[1]).toBe('⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42%')
  // narrow (under COMPACT_BELOW): the short form, no bar, no clock
  expect(header(COMPACT_BELOW - 1, { usage: u })[1]).toBe(short)
  expect(header(45, { usage: { pct: 80, resetsAt: R } })[1]).toBe('⚠ 5h 80%')
  // no reading: no meter at any width
  for (const columns of [24, 45, 59, 60, 90, 200]) expect(header(columns, { usage: null })[1]).toBe('')
  // the probe's header at the probe's width: the words and the short meter both drawn
  expect(header(51, { counts: { run: 4, idle: 1, done: 3 }, usage: { pct: 6, resetsAt: '' } })).toEqual(['🎭 עובדים 4 · ממתינים 1 · סיימו 3', '⏳ 5h 6%'])
  // the idle count only when there is one; English the number first
  expect(header(120, { counts: { run: 2, idle: 3, done: 12 } })[0]).toBe('🎭 עובדים 2 · ממתינים 3 · סיימו 12')
  expect(header(120, { counts: { run: 2, idle: 3, done: 12 }, lang: 'en', labels: LABELS_EN, rtl: false })[0]).toBe('🎭 2 working · 3 idle · 12 finished')
  // every width, several counts and two readings: the counts and the meter fit the line by LINE_FIT, hold no refused character,
  // and the meter is whole or absent — the full label only from COMPACT_BELOW and only when the whole line fits, else the short
  // form when that fits, else nothing (never a `5h` or a percent cut in half); the words give way to the icons when they alone
  // would not fit
  const countSets = [{ run: 2, idle: 0, done: 0 }, { run: 2, idle: 3, done: 12 }, { run: 12, idle: 30, done: 120 }]
  const readings = [u, { pct: 100, resetsAt: R }]
  for (const counts of countSets) {
    for (const reading of readings) {
      const fullOf = usageLabel(reading, 'he', 100)
      const shortOf = usageShort(reading)
      for (let columns = 24; columns <= 200; columns++) {
        const at = `${JSON.stringify(counts)}, ${reading.pct}%, ${columns} columns`
        const [c, m] = header(columns, { counts, usage: reading })
        expect(c, at).not.toMatch(REFUSED_RE)
        expect(['', shortOf, fullOf], at).toContain(m)
        // a meter only when the whole line fits; the words only when they fit alone (the icons form is the floor: a 24-column
        // pane with three-digit counts clips it — the height-1 Box keeps it one line)
        if (m) expect(textWidth(c) + 1 + textWidth(m), at).toBeLessThanOrEqual(fitLine(columns))
        if (m === fullOf) expect(columns, `${at}: the bar`).toBeGreaterThanOrEqual(COMPACT_BELOW)
        const words = c.includes('עובדים')
        if (words) expect(textWidth(c), at).toBeLessThanOrEqual(fitLine(columns))
        const icons = `🎭 🟢${counts.run}${counts.idle ? ` · ⏳${counts.idle}` : ''} · ✅${counts.done}`
        if (!words) expect(c, at).toBe(icons)
        // the words whenever they alone fit: a wider pane never loses them
        if (textWidth(`🎭 עובדים ${counts.run}${counts.idle ? ` · ממתינים ${counts.idle}` : ''} · סיימו ${counts.done}`) <= fitLine(columns)) expect(words, at).toBe(true)
      }
    }
  }
})

test('never throws: a broken props object draws a short red Text', () => {
  const f = fake()
  const broken = { ...props(), rooms: null } as unknown as OfficeProps
  const tree = Office(broken, f.surface) as unknown as Node
  expect(tree.type).toBe('Text')
  expect(tree.props.color).toBe('red')
  expect(texts(tree)).toMatch(/^office: /)
  // and the next good props draw the office again
  expect(texts(Office(props(), f.surface))).toMatch(/^🎭 /m)
  // a throw after a good render drops the drawn window: the pointer hits nothing the office no longer draws
  const C = chromeRows(props())
  f.pointer({ type: 'down', x: 5, y: C + 4, button: 'left' })
  expect(f.posts).toEqual([{ t: 'open', id: 'lead' }])
  Office(broken, f.surface)
  expect(f.surface.state!.inst.win).toEqual({ from: 0, count: 0 })
  f.pointer({ type: 'down', x: 5, y: C + 4, button: 'left' })
  f.pointer({ type: 'move', x: 5, y: C + 2 })
  expect(f.posts).toHaveLength(1)
  expect(f.surface.state!.hoverRoom).toBeNull()
})

/** The 200-agent office of the limits sweeps: every status, the badges, a star every seventh, the models cycling. */
function crowd(): OfficeAgent[] {
  return Array.from({ length: 200 }, (_, i) => ag(`agent-${i}`, { name: `סוכן ${i}`, act: i % 3 ? '📖 קורא' : '✍️ כותב', star: i % 7 === 0 ? 1 : 0, failed: i % 11 === 0, longRunning: i % 5 === 0, status: i % 4 === 0 ? 'done' : 'running', model: ['Opus 5.5', 'Sonnet 4.5', 'Haiku 4.5', 'Fable 5.1', '?'][i % 5]! }))
}

// (a few dozen renders of 200 agents, each serialized and walked: a loaded machine stretches the suite tenfold)
test('limits: 200 agents with the drawer open — in 3 rooms and in 200 rooms — at widths 24..250 and in the tall panes (200 × 80, 200 × 150) stay under 20,000 nodes, 32 deep, 100,000 characters, with no bidi marks; the rows drawn never pass WINDOW_ROWS; a drawn row — pulsing and focused too — costs under ROW_CHARS', { timeoutMs: 60_000 }, () => {
  const agents = crowd()
  const three = [room('A', agents.slice(0, 80), { moreDone: 3, moreLabel: 'עוד 3 שסיימו' }), room('B', agents.slice(80, 140)), room('C', agents.slice(140))]
  const twoHundred = agents.map((a, i) => room(`R${i}`, [a], { title: `שיחה ${i} על משהו ארוך למדי ${'x'.repeat(30)}` }))
  const d = drawer({ task: 'x'.repeat(4000), result: 'y'.repeat(4000), truncated: true })
  let maxJson = 0
  let maxRowChars = 0
  /** The cost of a drawn row: the cells of one row across the columns, serialized (the first rows of each card: the rows are alike). */
  const rowChars = (tree: unknown) => {
    for (const c of cards(tree)) {
      const cols = columnsOf(c).map(cellsOf)
      for (let i = 0; i < Math.min(3, cols[0]?.length ?? 0); i++) maxRowChars = Math.max(maxRowChars, cols.reduce((n, col) => n + JSON.stringify(col[i]).length, 0))
    }
  }
  const sizes = [[24, 40], [45, 40], [120, 40], [200, 80], [200, 150]] as const
  for (const rooms of [three, twoHundred]) {
    // (200 rooms of one agent: the narrowest and the tallest pane — every card frame drawn, few rows; the three rooms at every size)
    for (const [columns, rows] of rooms === three ? sizes : [sizes[1], sizes[4]]) {
      for (const offset of rooms === three ? [0, 20] : [0, 500]) {
        const f = fake(columns, 0)
        const p = props({ columns, rows, offset, rooms, selected: 'agent-3', drawer: d, helpOpen: false, usage: { pct: 88.8, resetsAt: new Date(2026, 9, 10, 23, 59).toISOString() } })
        const tree = Office(p, f.surface)
        const all = nodes(tree)
        expect(all.length).toBeLessThan(20_000)
        expect(depth(tree)).toBeLessThanOrEqual(32)
        const json = JSON.stringify(tree)
        maxJson = Math.max(maxJson, json.length)
        expect(json.length).toBeLessThan(100_000)
        expect(json).not.toMatch(REFUSED_RE) // (the shared set, office-chrome.ts: the bidi controls, ALM included)
        expect(f.setStates()).toBe(1)
        // the window keeps its row budget: past it the rows are left blank rather than unmounting the instance
        const drawnRows = cards(tree).reduce((n, c) => n + rowsOf(c).length, 0)
        expect(drawnRows).toBeLessThanOrEqual(WINDOW_ROWS)
        expect(drawnRows).toBeLessThanOrEqual(rows)
        const m = officeModel(p)
        const { from, count } = f.surface.state!.inst.win
        expect(drawnRows).toBe(m.lines.slice(from, from + count).filter(l => l.kind === 'row').length)
        if (rooms === three && columns === 200 && rows === 80 && offset === 20) expect(drawnRows).toBe(80 - overlayRows(p))
        if (rooms === three && columns === 200 && rows === 150 && offset === 20) expect(drawnRows).toBe(WINDOW_ROWS)
        rowChars(tree)
        // the dearest rows: every drawn row pulsing (a finish pulse on each: the fx list) and the first focused — the tree still under
        // the bound, a row still under ROW_CHARS (the premise of WINDOW_ROWS)
        const st = f.surface.state!
        st.inst.fx = m.lines.slice(from, from + count).filter(l => l.kind === 'row').map(l => ({ id: l.agent!, left: 1000 }))
        f.surface.setState({ ...st, focus: m.lines.slice(from, from + count).find(l => l.kind === 'row')?.agent ?? null })
        const lit = Office(p, f.surface)
        const litJson = JSON.stringify(lit)
        maxJson = Math.max(maxJson, litJson.length)
        expect(litJson.length).toBeLessThan(100_000)
        expect(nodes(lit).filter(n => n.props.backgroundColor !== undefined).length).toBe(cards(lit).reduce((n, c) => n + rowsOf(c).length * columnsOf(c).length, 0))
        rowChars(lit)
        st.inst.fx = []
      }
    }
  }
  expect(maxRowChars).toBeLessThan(ROW_CHARS)
  // widths in between, one window each, every eighth column up to 250
  for (let columns = 24; columns <= 250; columns += 8) {
    const f = fake(columns, 0)
    const tree = Office(props({ columns, rows: 40, offset: 7, rooms: three, selected: 'agent-3', drawer: d }), f.surface)
    const json = JSON.stringify(tree)
    expect(json.length).toBeLessThan(100_000)
    expect(nodes(tree).length).toBeLessThan(20_000)
  }
  // a regression guard under the bound: the widest window with the drawer open
  expect(maxJson).toBeLessThan(90_000)
})

/** THE RENDER COST's bounds (office-client.tsx): what the desktop lays out per row and per card. */
const ROW_TEXTS = 4
/** A card around its rows: the card, the title line (its Box, the pin Text, the title Box and Text, the counts Box and Text), the rule (Box, Text), the table block (a column Box, two spacers, the table), four columns, the more line (Box, Text). */
const CARD_NODES = 1 + 6 + 2 + 4 + 4 + 2
/** The Boxes of a card around its rows: the card, the title line and its two Boxes, the rule, the block and two spacers, the table, four columns, the more line. */
const CARD_BOXES = 1 + 3 + 1 + 3 + 1 + 4 + 1

test('THE RENDER COST (the regression guard no load can flake): a drawn row costs the desktop ROW_TEXTS Texts and NO Box, a card at most CARD_NODES nodes (CARD_BOXES Boxes) around its rows, the whole tree ROW_TEXTS × WINDOW_ROWS plus the cards and the chrome at the biggest window; and THE ROOM MEMO — a redraw measures only the rooms whose props or width changed, a decor change none', () => {
  const agents = crowd()
  const three = [room('A', agents.slice(0, 80), { moreDone: 3, moreLabel: 'עוד 3 שסיימו', pinned: true }), room('B', agents.slice(80, 140)), room('C', agents.slice(140))]
  const d = drawer({ task: 'x'.repeat(600), result: 'y'.repeat(300), truncated: true })
  for (const [columns, rows, offset] of [[51, 40, 0], [120, 40, 0], [120, 80, 30], [200, 150, 20], [24, 40, 0]] as const) {
    const f = fake(columns, 0)
    const p = props({ columns, rows, offset, rooms: three, selected: 'agent-3', drawer: d })
    const tree = Office(p, f.surface)
    const at = `${columns} × ${rows} @ ${offset}`
    let rowsDrawn = 0
    for (const card of cards(tree)) {
      const cols = columnsOf(card)
      const n = rowsOf(card).length
      rowsDrawn += n
      // a row: one Text per column, no Box; a column: its rows' Texts and nothing else
      for (const col of cols) expect(col.children.length, at).toBe(n)
      for (const col of cols) expect((col.children as Node[]).every(c => c.type === 'Text' && c.props.wrap === 'truncate'), at).toBe(true)
      const all = nodes(card)
      expect(all.filter(x => x.type === 'Box').length, at).toBeLessThanOrEqual(CARD_BOXES)
      expect(all.length, at).toBeLessThanOrEqual(CARD_NODES + n * ROW_TEXTS)
      expect(all.filter(x => x.type === 'Text').length, at).toBeLessThanOrEqual(5 + n * ROW_TEXTS)   // the pin, the title, the counts, the rule, the more line
    }
    expect(rowsDrawn, at).toBeLessThanOrEqual(WINDOW_ROWS)
    // the whole tree: the chrome (the header, the toolbar, the search, the drawer's lines) and the cards
    const chromeNodes = kidsOf(tree).filter(k => !cards(tree).includes(k)).reduce((s, k) => s + nodes(k).length, 0)
    expect(nodes(tree).length, at).toBeLessThanOrEqual(1 + chromeNodes + cards(tree).length * CARD_NODES + rowsDrawn * ROW_TEXTS)
    expect(chromeNodes, at).toBeLessThan(120)
  }
  // the biggest window: WINDOW_ROWS rows of four Texts, three cards, the chrome — nothing else
  const f = fake(200, 0)
  const p = props({ columns: 200, rows: 150, offset: 20, rooms: three, selected: 'agent-3', drawer: d })
  const tree = Office(p, f.surface)
  expect(cards(tree).reduce((n, c) => n + rowsOf(c).length, 0)).toBe(WINDOW_ROWS)
  expect(nodes(tree).filter(n => n.type === 'Box').length).toBeLessThan(3 * CARD_BOXES + 60)
  expect(nodes(tree).length).toBeLessThan(WINDOW_ROWS * ROW_TEXTS + 3 * CARD_NODES + 120)
  // THE ROOM MEMO: the first render measured each room once (the instance's model, then the render's: the same props hit the memo)
  const cache = f.surface.state!.inst.cache
  expect(cache.builds).toBe(3)
  expect([...cache.rooms.keys()]).toEqual(['A', 'B', 'C'])
  // a decor change (the head hover, the focus, a pulse frame): nothing measured again
  f.surface.setState({ ...f.surface.state!, hoverRoom: 'B', focus: 'agent-90' })
  Office(p, f.surface)
  expect(cache.builds).toBe(3)
  f.surface.state!.inst.fx = [{ id: 'agent-85', left: 1000 }]
  Office(p, f.surface)
  expect(cache.builds).toBe(3)
  f.surface.state!.inst.fx = []
  // a poll's props (a new object, equal JSON): nothing; the clock alone (nowMin), the offset, the drawer: nothing of the rooms
  Office(JSON.parse(JSON.stringify(p)) as OfficeProps, f.surface)
  Office({ ...p, nowMin: p.nowMin + 1, offset: 40, drawer: drawer({ id: 'agent-90' }), selected: 'agent-90' }, f.surface)
  expect(cache.builds).toBe(3)
  // one room's agent changes its activity: that room alone
  const q = { ...p, rooms: three.map(r => r.id === 'B' ? { ...r, agents: r.agents.map(a => a.id === 'agent-90' ? { ...a, act: '🔎 מחפש קוד' } : a) } : r) }
  Office(q, f.surface)
  expect(cache.builds).toBe(4)
  // a resize: every room (the fit and the title cut follow the width)
  Office({ ...q, columns: 120 }, f.surface)
  expect(cache.builds).toBe(7)
  // a room gone (a search): dropped; back: measured again
  Office({ ...q, columns: 120, rooms: q.rooms.filter(r => r.id !== 'C') }, f.surface)
  expect([...cache.rooms.keys()]).toEqual(['A', 'B'])
  Office({ ...q, columns: 120 }, f.surface)
  expect(cache.builds).toBe(8)
})
