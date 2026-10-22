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
import { CHROME_ROWS_MIN, CHROME_ROWS_SEARCH, COMPACT_BELOW, DEMO_GAP, DEMO_ROWS, DRAWER_FRAME_ROWS, DRAWER_NARROW_BELOW, HELP, HELP_PAIR_ROWS, REFUSED_RE, RESULT_LINES, RESULT_LINES_NARROW, ROW_CHARS, SEARCH_FROM, SEARCH_MAX, TASK_LINES, TASK_LINES_NARROW, WINDOW_ROWS, chromeRows, cleanAgentText, cleanSearch, demoLine, drawerInner, drawerLimits, drawerLines, drawerMax, drawerStatus, fixedRows, helpPairs, helpRows, labelsFit, officeHeight, officeAgents, overlayHeight, overscanOf, searchShown, windowOf } from './office-chrome'
import * as OfficeClient from './office-client'
import Office, { DEMO_FG, INPUT_MAX, INPUT_MIN, OUTBOX_FLUSH_MS, OUTBOX_MAX, PAIRS_GAP, SEARCH_DEBOUNCE_MS, TOOLBAR_GAP, inputWidth } from './office-client'
import type { OfficeState } from './office-client'
import { CARD_BORDER, CENTRE_AT, DOT_FG, FIT, FOCUS_MARK, NBSP, NO_DECOR, ONE_LINE_FROM, PANE_GUTTER, PIN, PIN_OFF, TASK_UNITS, TITLE_GAP, WIDE_FROM, chooseMode, cut, fitCells, fitLine, floorsOf, geometry, nb, officeModel, officeWidest, rowCount, textWidth, trimWindow } from './office-layout'
import type { OfficeAgent, OfficeDrawer, OfficeMessage, OfficeProps, OfficeRoom } from './office-props'
import { usageLabel, usageShort, usageTiny } from './usage'

const LABELS: Record<string, string> = Object.fromEntries(Object.entries(I18N.he).filter((kv): kv is [string, string] => typeof kv[1] === 'string'))
const LABELS_EN: Record<string, string> = Object.fromEntries(Object.entries(I18N.en).filter((kv): kv is [string, string] => typeof kv[1] === 'string'))

/** The pane whose reading column is `W` cells (live check 6: a cell left free at each edge, office-layout.ts PANE_GUTTER): the old tests' widths are the column's. */
const pane = (W: number) => W + PANE_GUTTER

function ag(id: string, over: Partial<OfficeAgent> = {}): OfficeAgent {
  return { id, emoji: '🦉', name: id, status: 'running', act: '📖 קורא', model: 'Opus 5.5', task: `task of ${id}`, failed: false, longRunning: false, star: 0, ...over }
}
function room(id: string, agents: OfficeAgent[], over: Partial<OfficeRoom> = {}): OfficeRoom {
  const n = (s: OfficeAgent['status']) => agents.filter(a => a.status === s).length
  return { id, title: `room ${id}`, small: id, pinned: false, showDone: false, run: n('running'), stale: n('stale'), done: n('done'), agents, moreDone: 0, moreLabel: '', ...over }
}
/** The header counts of `rooms` (the office's agents: what the search field is decided by — office-chrome.ts officeAgents). */
function countsOf(rooms: readonly OfficeRoom[]): OfficeProps['counts'] {
  const all = rooms.flatMap(r => r.agents)
  return { run: all.filter(a => a.status === 'running').length, idle: all.filter(a => a.status === 'stale').length, done: all.filter(a => a.status === 'done').length }
}
/** The props of a test (the header counts those of its rooms unless given). */
function props(over: Partial<OfficeProps> = {}): OfficeProps {
  const rooms = over.rooms ?? [room('A', [ag('lead', { emoji: '💼', act: '🧠 חושב' }), ag('a1')])]
  return {
    v: 1, lang: 'he', rtl: true, columns: 45, rows: 30, offset: 0, nowMin: 100,
    counts: countsOf(rooms), prefs: { showDone: false, muted: true },
    search: '', selected: null, helpOpen: false, demo: false,
    rooms, drawer: null, footer: '', oversized: '', usage: null, empty: null, labels: LABELS, ...over,
  }
}
function drawer(over: Partial<OfficeDrawer> = {}): OfficeDrawer {
  return { id: 'lead', name: '💼 המנהל', model: 'Opus 5.5', act: '🧠 חושב', task: 'map the docs', result: '', truncated: false, elapsedMin: 3, sub: 'map the docs', status: 'running', failed: false, longRunning: false, star: 0, type: 'Explore', ...over }
}
function withAgents(p: OfficeProps, agents: OfficeAgent[]): OfficeProps {
  const rooms = [room('A', agents)]
  return { ...p, rooms, counts: countsOf(rooms) }
}
/** More agents than SEARCH_FROM in one room: the office that draws the search field. */
const many = (n = SEARCH_FROM + 1) => Array.from({ length: n }, (_, i) => ag(`m${i}`))
/**
 * The office of the phase B tests (decision 26) at `columns`: two rooms — A pinned, with two working agents (or `agents` of
 * them: a long office, past WINDOW_ROWS lines), B with two working and five finished behind its more line; a 30-row body.
 */
function propsAt(columns: number, over: { agents?: number } = {}): OfficeProps {
  const a = over.agents ? Array.from({ length: over.agents }, (_, i) => ag(`g${i}`)) : [ag('lead', { emoji: '💼', act: '🧠 חושב' }), ag('a1')]
  const rooms = [room('A', a, { pinned: true }), room('B', [ag('b1'), ag('b2')], { done: 5, moreDone: 5, moreLabel: 'עוד 5 שסיימו' })]
  return props({ columns, rooms, counts: { ...countsOf(rooms), done: 5 } })
}
/** The drawer of the agent `id` of `p`, as the hooks would hand it. */
function drawerFor(p: OfficeProps, id: string): OfficeDrawer {
  const a = p.rooms.flatMap(r => r.agents).find(x => x.id === id)!
  return drawer({ id, name: `${a.emoji} ${a.name}`, model: a.model, act: a.act, task: a.task, sub: a.task })
}

// --- a fake surface: the module's second argument, with every call recorded ---
// (`posts` are the ACTIONS the hooks apply: every post is a batch of the frame's outbox — THE OUTBOX, office-client.tsx — and
// the fake applies each numbered item once per instance, as ui.tsx applyOfficeMessage does; `raw` the posts as sent; `debounces`
// the search's debounce clocks among `timers`)
type Fake = {
  surface: ClientSurface<OfficeState>
  posts: OfficeMessage[]
  raw: unknown[]
  debounces: () => Array<{ ms: number; fn: () => void; stopped: boolean }>
  timers: Array<{ ms: number; fn: () => void; stopped: boolean }>
  setStates: () => number
  pointer: (e: ClientPointerEvent) => void
  key: (e: ClientKeyEvent) => void
  /** Presses the Button keyed `key` in `tree` (its onPress, as the desktop calls it: phase B — every click is a native Button); throws when the tree holds none. */
  press: (tree: unknown, key: string) => void
  tick: () => void
  size: (columns: number, rows: number) => void
}
function fake(columns = 45, rows = 0): Fake {
  const posts: OfficeMessage[] = []
  const raw: unknown[] = []
  const applied = new Map<string, number>()
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
    post(d: unknown) {
      raw.push(d)
      const b = d as { t?: string; i?: string; items?: Array<OfficeMessage & { n: number }> }
      if (b.t !== 'batch') { posts.push(d as OfficeMessage); return }
      for (const { n, ...m } of b.items ?? []) {
        if (n <= (applied.get(b.i ?? '') ?? 0)) continue
        applied.set(b.i ?? '', n)
        posts.push(m as OfficeMessage)
      }
    },
  }
  return {
    surface: surface as unknown as ClientSurface<OfficeState>, posts, raw, timers,
    debounces: () => timers.filter(t => t.ms === SEARCH_DEBOUNCE_MS),
    setStates: () => sets,
    pointer: e => onPointer?.(e), key: e => onKey?.(e),
    press: (tree, key) => {
      const n = nodes(tree).find(x => x.type === 'Button' && x.props.key === key)
      if (!n) throw new Error(`no Button ${key}`)
      ;(n.props.onPress as (e: unknown) => void)({ surface: 'desktop' })
    },
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
/** The reading column of the tree: the root's first child (phase B: the root holds the column and, when one is open, the floating overlay). */
const columnOf = (tree: unknown) => ((tree as Node).children as Node[])[0]!
/** The column's children: the chrome's lines, the spacer, the cards. */
const kidsOf = (tree: unknown) => columnOf(tree).children as Node[]
/** The floating overlay (the drawer or the settings): the root's second child; undefined while neither is open. */
const overlayOf = (tree: unknown): Node | undefined => ((tree as Node).children as Node[])[1]
/** The Box with `key` (a Button may share a key with a Box: the toolbar's `help` opens the Box `help`). */
const byKey = (tree: unknown, key: string, type = 'Box') => nodes(tree).find(n => n.type === type && n.props.key === key)
/** The room cards of the tree: the framed Boxes in the cards' style keyed by their room (`room:<id>`). */
const cards = (tree: unknown) => nodes(tree).filter(n => n.type === 'Box' && n.props.borderStyle === 'round' && n.props.borderColor === CARD_BORDER && String(n.props.key ?? '').startsWith('room:'))
/** What a child of the root is, by its key: a room card (keyed `room:<id>` since live check 7, R14) reads as its frame, `round`. */
const kindOf = (n: Node): unknown => (String(n.props.key ?? '').startsWith('room:') ? 'round' : n.props.key ?? n.props.borderStyle)
/**
 * The parts of a WHOLE card: its title line, the blank line under it (round 9: no rule), its table block (the Box of column
 * Boxes; a column Box around it and the spacers for the rows above / below the window when there are any; a spacer alone when
 * no row is in the window), its more line.
 */
function partsOf(card: Node): { title: Node; blank: Node; table: Node; more: Node | undefined } {
  // (the more line DIRECTLY UNDER THE TITLE when the card has one: live check 7, Q3)
  const kids = card.children as Node[]
  const [title, more, blank, table] = kids.length === 4 ? kids : [kids[0], undefined, kids[1], kids[2]]
  return { title: title!, blank: blank!, table: table!, more }
}
/** The texts of a row as the model lays them in the mode's columns: status · who · [model] · emoji · [word] · [task from CENTRE_AT]. */
function modelRow(p: OfficeProps, roomIndex: number, rowIndex: number): string[] {
  const m = officeModel(p)
  const r = m.rooms[roomIndex]!.rows[rowIndex]!
  return [r.status, r.who, ...(m.mode.model !== 'none' ? [r.model] : []), r.actEmoji, ...(m.mode.word ? [r.actWord] : []), ...(m.geo.centred ? [r.task] : [])]
}
/** The Client row the root's children before the first card add up to (each a Box of explicit height plus its margins). */
function chromeOf(tree: unknown): number {
  let row = 0
  for (const n of kidsOf(tree)) {
    if (cards(tree).includes(n)) return row
    const h = n.props.height
    if (typeof h !== 'number') throw new Error(`no height on ${String(n.props.key ?? n.props.borderStyle)}`)
    row += h + ((n.props.marginTop as number | undefined) ?? 0) + ((n.props.marginBottom as number | undefined) ?? 0)
  }
  return row
}
/** The pin Button of a card's title line (on EVERY card since decision 26: `pin:<room>`, PIN or PIN_OFF). */
const pinOf = (card: Node): Node | undefined => (partsOf(card).title.children as Node[]).find(n => n.type === 'Button' && String(n.props.key ?? '').startsWith('pin:'))
/** The table of a card: the Box of column Boxes, wherever it sits in the card (undefined when no row of it is in the window: a spacer, or nothing). */
const tableOf = (card: Node) => nodes(card).find(n => n.type === 'Box' && n.children.length > 0 && (n.children as Node[]).every(c => c.props.flexDirection === 'column'))
/** The child of a card that holds its table: the table itself, or the column Box of the spacers around it. */
const blockOf = (card: Node) => { const t = tableOf(card); return t && (card.children as Node[]).find(n => nodes(n).includes(t)) }
/** The column Boxes of a card's table (none when the table is a spacer). */
const columnsOf = (card: Node) => (tableOf(card)?.children as Node[] | undefined) ?? []
/** The value cells of a column, one per row of the window (a column holds nothing else): the status column's coloured Texts, every other column's plain Buttons (decision 26). */
const cellsOf = (col: Node) => (col.children as Node[]).filter(n => n.type === 'Text' || n.type === 'Button')
/** A cell's text: the Text's own, or the Button's one Text child's. */
const cellText = (n: Node) => (n.type === 'Text' ? texts(n) : texts((n.children as Node[])[0]))
/** A cell's styled props: the Text's own, or the Button's one Text child's (bold / dim ride the child: what a Button keeps on the desktop). */
const cellStyle = (n: Node) => (n.type === 'Text' ? n.props : (n.children as Node[])[0]!.props)
/** The texts of the window's rows of a card, one array per row: [status, who, model?, act]. */
function rowsOf(card: Node): string[][] {
  const cols = columnsOf(card).map(cellsOf)
  if (cols.length === 0) return []
  return cols[0]!.map((_, i) => cols.map(col => cellText(col[i]!)))
}

// ---------------------------------------------------------------------------
// pure parts
// ---------------------------------------------------------------------------

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

test('fixedRows / searchShown / chromeRows (spec 2026-10-10 §2 item 22, probe round 8): the chrome is four rows — the header and the toolbar with their blank lines — and six with the search on a line of its own, drawn only while the office shows more than SEARCH_FROM agents or a search is active; from ONE_LINE_FROM the search shares the toolbar\'s line (four rows); the settings popover | the drawer card float over it (phase B: overlayHeight — its frame and its lines; chromeRows ignores them), then the footer line, the empty block', () => {
  expect([CHROME_ROWS_MIN, CHROME_ROWS_SEARCH, SEARCH_FROM]).toEqual([4, 6, 12])
  const p = props({ columns: pane(45) })   // (a 45-cell reading column: the drawer's 30 inner cells below)
  expect(officeAgents(p)).toBe(2)
  expect(searchShown(p)).toBe(false)
  expect(fixedRows(p)).toBe(CHROME_ROWS_MIN)
  expect(chromeRows(p)).toBe(CHROME_ROWS_MIN)
  // twelve shown: no field; thirteen: the field (under ONE_LINE_FROM on its own line with a blank over it; from it on the toolbar's)
  const twelve = withAgents(p, many(SEARCH_FROM))
  const thirteen = withAgents(p, many())
  expect(officeAgents(twelve)).toBe(SEARCH_FROM)
  expect(searchShown(twelve)).toBe(false)
  expect(searchShown(thirteen)).toBe(true)
  expect(fixedRows(thirteen)).toBe(CHROME_ROWS_SEARCH)
  expect(fixedRows({ ...thirteen, columns: pane(ONE_LINE_FROM - 1) })).toBe(CHROME_ROWS_SEARCH)
  expect(fixedRows({ ...thirteen, columns: pane(ONE_LINE_FROM) })).toBe(CHROME_ROWS_MIN)
  expect(fixedRows({ ...thirteen, columns: 200 })).toBe(CHROME_ROWS_MIN)
  // the agents counted are the OFFICE's (its header counts: working, waiting, finished), never the rows drawn — live check 7, Q1:
  // a room holding its finished back draws fewer rows, the field stays; the rows drawn alone decide nothing
  expect(officeAgents({ counts: { run: 7, idle: 1, done: 5 } })).toBe(13)
  expect(searchShown({ ...p, counts: { run: 7, idle: 1, done: 5 } })).toBe(true)
  expect(searchShown(props({ rooms: [room('A', many(7), { moreDone: 30, moreLabel: 'עוד 30 שסיימו' })], counts: { run: 7, idle: 0, done: 30 } }))).toBe(true)
  expect(searchShown(props({ rooms: [room('A', many(20))], counts: { run: 12, idle: 0, done: 0 } }))).toBe(false)
  // an active search keeps the field whatever the count (its text would otherwise be lost with the field)
  expect(searchShown({ ...p, search: 'x' })).toBe(true)
  expect(fixedRows({ ...p, search: 'x' })).toBe(CHROME_ROWS_SEARCH)
  expect(searchShown(props({ rooms: [], search: 'zzz' }))).toBe(true)
  // ...and text typed into the field and not yet posted counts as one (the module's `typed`; the hooks pass none)
  expect(searchShown(twelve, 'r')).toBe(true)
  expect(fixedRows(twelve, 'r')).toBe(CHROME_ROWS_SEARCH)
  expect(fixedRows({ ...twelve, columns: pane(ONE_LINE_FROM) }, 'r')).toBe(CHROME_ROWS_MIN)
  expect(fixedRows(twelve, '')).toBe(CHROME_ROWS_MIN)
  expect(chromeRows({ ...p, footer: 'scan: 2 skipped' })).toBe(CHROME_ROWS_MIN + 1)
  expect(chromeRows({ ...thirteen, footer: 'scan: 2 skipped' })).toBe(CHROME_ROWS_SEARCH + 1)
  // the too-long conversations note (live check 6): a row of the settings popover, none of the chrome while it is closed
  expect(helpRows(45, true)).toBe(helpRows(45) + 1)
  expect(helpRows(200, true)).toBe(helpRows(200) + 1)
  expect(chromeRows({ ...p, oversized: 'x' })).toBe(CHROME_ROWS_MIN)
  // (phase B: the overlay floats, so the chrome's rows are the same with a drawer open; the note is a row of the settings alone)
  expect(chromeRows({ ...p, drawer: drawer() })).toBe(CHROME_ROWS_MIN)
  expect(overlayHeight({ ...p, drawer: drawer(), oversized: 'x' })).toBe(overlayHeight({ ...p, drawer: drawer() }))
  // the drawer: the card's frame (border, padding) + name, sub, the status line, a blank line, the model line, the task heading, one task line + the gap
  const inner = drawerInner(p.columns)
  expect(inner).toBe(Math.floor((p.columns - PANE_GUTTER - 4) * 0.75))
  // ... then blank lines to its ONE HEIGHT at the width (live check 7, Q2: drawerMax — a short drawer as tall as the longest)
  const MAX = drawerMax({ task: TASK_LINES, result: RESULT_LINES })
  expect(MAX).toBe(15)
  expect(drawerLines(drawer(), LABELS, inner).length).toBe(MAX)
  expect(drawerLines(drawer(), LABELS, inner).map(l => l.kind)).toEqual(['name', 'dim', 'status', 'blank', 'body', 'head', 'body', ...Array.from({ length: MAX - 7 }, () => 'blank')])
  expect(DRAWER_FRAME_ROWS).toBe(4)
  // the settings' shortcuts in two column pairs from WIDE_FROM: the popover is the first pair's rows tall
  expect(helpRows(45)).toBe(2 + 2 + 1 + 1 + HELP.length)
  expect(helpRows(pane(WIDE_FROM - 1))).toBe(14)   // (eight shortcut rows: no s row since live check 7, Q9)
  expect(helpRows(pane(WIDE_FROM))).toBe(2 + 2 + 1 + 1 + HELP_PAIR_ROWS)
  expect(helpRows(200)).toBe(11)
  expect(helpPairs(false)).toEqual([HELP])
  expect(helpPairs(true).map(pair => pair.length)).toEqual([HELP_PAIR_ROWS, HELP_PAIR_ROWS])
  expect(helpPairs(true).flat().filter(([k]) => k.trim() !== '')).toEqual([...HELP])
  // a long task wraps to at most TASK_LINES lines, the result to RESULT_LINES (+ heading + the ✂ note), every line within the inner width
  const long = drawer({ task: 'word '.repeat(400), result: 'done '.repeat(400), truncated: true, sub: '' })
  expect(drawerLines(long, LABELS, inner).length).toBe(MAX)
  expect(drawerLines(long, LABELS, inner).filter(l => l.kind !== 'blank').length).toBe(4 + TASK_LINES + 1 + RESULT_LINES + 1)   // (no sub here: one blank line pads it)
  for (const line of drawerLines(long, LABELS, inner)) expect(textWidth(line.text)).toBeLessThanOrEqual(inner)
  // THE STATUS LINE (round 8: `● עובד · זמן 12 דק׳ · general-purpose`): the mark (markOf, in the status's colour) then the status
  // word, the clock (the duration once done — a failed or killed agent is done — else the elapsed; none when unknown) and the
  // agent type, a ` · ` apart, the empty parts left out; cut to the inner width less the mark's cells
  expect(drawerLines(drawer({ elapsedMin: 7 }), LABELS, inner)[2]).toEqual({ kind: 'status', text: 'עובד · זמן 7 דק׳ · Explore', mark: '●', color: DOT_FG.running })
  expect(drawerLines(drawer({ elapsedMin: null }), LABELS, inner)[2]?.text).toBe('עובד · Explore')
  expect(drawerLines(drawer({ elapsedMin: null, type: '' }), LABELS, inner)[2]?.text).toBe('עובד')
  expect(drawerLines(drawer({ status: 'stale', elapsedMin: 2 }), LABELS, inner)[2]).toMatchObject({ text: 'ממתין · זמן 2 דק׳ · Explore', mark: '●', color: DOT_FG.stale })
  expect(drawerLines(drawer({ status: 'done', elapsedMin: 3 }), LABELS, inner)[2]).toMatchObject({ text: 'סיים · משך 3 דק׳ · Explore', mark: '○', color: DOT_FG.done })
  expect(drawerLines(drawer({ status: 'done', star: 7, elapsedMin: 3 }), LABELS, inner)[2]?.mark).toBe('⭐')
  expect(drawerLines(drawer({ status: 'done', failed: true, elapsedMin: 3 }), LABELS, inner)[2]).toMatchObject({ text: 'נכשל · משך 3 דק׳ · Explore', mark: '❌', color: DOT_FG.done })
  expect(drawerLines(drawer({ longRunning: true, elapsedMin: 48 }), LABELS, inner)[2]).toMatchObject({ text: 'עובד · זמן 48 דק׳ · Explore', mark: '⏰' })
  expect(drawerLines(drawer({ status: 'done', failed: true, elapsedMin: 3 }), LABELS_EN, drawerInner(70))[2]?.text).toBe('Failed · Duration 3′ · Explore')   // (30 cells: past a 45-column drawer's 27, whole at 70)
  expect(drawerLines(drawer({ status: 'done', failed: true, elapsedMin: 3 }), LABELS_EN, inner)[2]?.text).toBe('Failed · Duration 3′ · Exp…')
  expect(drawerStatus(drawer({ type: 'general-purpose', elapsedMin: 12 }), LABELS, 100)).toBe('עובד · זמן 12 דק׳ · general-purpose')
  expect(drawerStatus(drawer({ type: 'general-purpose', elapsedMin: 12 }), LABELS, 13)).toBe('עובד · זמן 1…')
  expect(drawerLines(drawer(), LABELS, inner)[3]).toEqual({ kind: 'blank', text: '' })
  // the full height = chrome + the cards' lines; the empty office = chrome + its block — or the floating overlay's bottom when
  // that lies lower (THE OVERLAY'S ROOM: a 9-row office under a 19-row drawer; the office's rows do not move)
  expect(officeHeight(p, rowCount(p))).toBe(CHROME_ROWS_MIN + 9)
  expect(officeHeight(thirteen, rowCount(thirteen))).toBe(CHROME_ROWS_SEARCH + 7 + 13)
  const withD = { ...p, selected: 'lead', drawer: drawer() }
  expect(officeHeight(withD, rowCount(withD))).toBe(CHROME_ROWS_MIN + overlayHeight(withD))
  expect(overlayHeight(withD)).toBe(DRAWER_FRAME_ROWS + 15)
  const empty = { ...p, rooms: [], empty: { kind: 'office' as const, msg: LABELS.emptyOffice ?? '', sub: LABELS.emptySub ?? '' } }
  expect(officeHeight(empty, 0)).toBeGreaterThan(CHROME_ROWS_MIN + 2)
  expect(officeHeight({ ...empty, helpOpen: true }, 0)).toBe(CHROME_ROWS_MIN + Math.max(officeHeight(empty, 0) - CHROME_ROWS_MIN, helpRows(p.columns)))
  // THE NO-BREAK SPACE passes the fault guard: no surface refuses it, and the text gate keeps it
  expect(`a${NBSP}b`).not.toMatch(REFUSED_RE)
  expect(cleanAgentText(`a${NBSP}b`)).toBe(`a${NBSP}b`)
  expect(cleanSearch(`a${NBSP}b`)).toBe(`a${NBSP}b`)
})

// ---------------------------------------------------------------------------
// the drawing
// ---------------------------------------------------------------------------

test('render: the chrome (header with the words and a blank line, the toolbar with a blank line under it — no search field for an office of two) then a framed card per room with the title line, a BLANK line and the column-major table of the mode\'s columns; nothing below the window', () => {
  const f = fake(45, 0)
  const p = props()
  const tree = Office(p, f.surface)
  const all = nodes(tree)
  expect(all[0]?.type).toBe('Box')
  // the chrome: the header (one bold Text of the counts, a blank line under it), the toolbar Buttons with today's keys, no search Input (two agents shown)
  const header = byKey(tree, 'header')!
  expect(header).toMatchObject({ type: 'Box', props: { flexDirection: 'row-reverse', justifyContent: 'space-between', height: 1, overflow: 'hidden', marginBottom: 1 } })
  expect(header.children).toHaveLength(1)
  expect((header.children[0] as Node).props.bold).toBe(true)
  expect(texts(header)).toBe('🎭 עובדים 2 · סיימו 0')
  const keys = all.filter(n => n.type === 'Button').map(n => n.props.key)
  // the chrome's three (the demo and the language live in the settings popover), then the card's: the pin on its title and a
  // Button per value cell, column by column (phase B, decision 26: every click a native Button)
  expect(keys.slice(0, 3)).toEqual(['showDone', 'mute', 'help'])
  expect(keys.slice(3)).toEqual(['pin:A', 'agent:lead:who', 'agent:a1:who', 'agent:lead:model', 'agent:a1:model', 'agent:lead:emoji', 'agent:a1:emoji', 'agent:lead:word', 'agent:a1:word'])
  expect(byKey(tree, 'toolbar')).toMatchObject({ props: { flexDirection: 'row-reverse', gap: TOOLBAR_GAP, height: 1, overflow: 'hidden', marginBottom: 1 } })
  expect(byKey(tree, 'searchLine')).toBeUndefined()
  expect(all.find(n => n.type === 'Input')).toBeUndefined()
  // hotkeys only from COMPACT_BELOW columns, today's rule (the desktop draws a key chip per hotkey, which would wrap the toolbar)
  expect(all.filter(n => n.type === 'Button').every(n => n.props.hotkey === undefined)).toBe(true)
  const wide = nodes(Office({ ...p, columns: pane(COMPACT_BELOW) }, fake(pane(COMPACT_BELOW)).surface))
  expect(wide.filter(n => n.type === 'Button' && n.props.hotkey !== undefined).map(n => n.props.hotkey)).toEqual(['f', 'm', 'h'])
  // the root's children: header, toolbar, then the one card — no spacer at the top, nothing after the card; the chrome four rows
  expect(kidsOf(tree).map(kindOf)).toEqual(['header', 'toolbar', 'round'])
  expect(chromeOf(tree)).toBe(CHROME_ROWS_MIN)
  expect(chromeOf(tree)).toBe(chromeRows(p))
  const [card] = cards(tree)
  expect(cards(tree)).toHaveLength(1)
  expect(card).toMatchObject({ props: { flexDirection: 'column', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, paddingY: 1, marginBottom: 1, width: '100%', overflow: 'hidden' } })
  // the title line: the pin Button (PIN_OFF — the monochrome pin of an unpinned room, decision 26: drawn on every card, one
  // width with the colour one, so the title never moves), the title (bold, one line), the counts (dim), the probe's gap of two
  // between them
  const { title, blank, table, more } = partsOf(card!)
  expect(title).toMatchObject({ props: { flexDirection: 'row-reverse', justifyContent: 'space-between', height: 1, paddingX: 1, gap: TITLE_GAP, overflow: 'hidden' } })
  expect(TITLE_GAP).toBe(2)
  expect(title.children).toHaveLength(3)
  const [pin, ttl, counts] = title.children as Node[]
  expect(pin).toBe(pinOf(card!))
  expect(pin).toMatchObject({ type: 'Button', props: { key: 'pin:A', plain: true, label: PIN_OFF } })
  expect(pin!.props.dimColor).toBeUndefined()
  expect(pin!.props.color).toBeUndefined()
  expect(ttl).toMatchObject({ type: 'Box', props: { flexGrow: 1, flexShrink: 1, minWidth: 0, height: 1, overflow: 'hidden', justifyContent: 'flex-end' } })
  expect(ttl!.children).toHaveLength(1)
  expect((ttl!.children[0] as Node).props.bold).toBe(true)
  expect(texts(ttl)).toBe(nb('room A'))
  expect(counts).toMatchObject({ props: { flexShrink: 0, height: 1 } })
  expect(texts(counts)).toBe('🟢2')
  // round 9: NO rule under the title (it never stretched with the card) — a blank line keeps the height
  expect(blank).toEqual({ type: 'Box', props: { height: 1 }, children: [] })
  expect(texts(blank)).toBe('')
  expect(more).toBeUndefined()
  // a pinned room: the colour 📌 on the same Button, the line's shape unchanged (the title never moves)
  const pinned = cards(Office(props({ rooms: [room('A', [ag('lead')], { pinned: true })] }), fake().surface))[0]!
  expect((partsOf(pinned).title.children as Node[]).map(n => n.type)).toEqual(['Button', 'Box', 'Box'])
  expect(pinOf(pinned)).toMatchObject({ type: 'Button', props: { key: 'pin:A', plain: true, label: PIN } })
  expect(pinOf(pinned)!.props.dimColor).toBeUndefined()
  // the table: the mode's rigid column Boxes — at 45 columns the status, the who, the model, the activity's emoji and its word (the
  // last grows) — the padding cell on the column's reading side, ONE Text per row in each — no Box per value, and no plain space
  // in a value (nb: the Text can never wrap), so the row stays one line tall
  expect(table).toMatchObject({ props: { flexDirection: 'row-reverse', width: '100%' } })
  expect(table).toBe(tableOf(card!))   // no spacer: every row is in the window, so the table is the card's third child itself
  const cols = columnsOf(card!)
  expect(cols).toHaveLength(5)
  expect(cols.map(c => c.props.flexGrow)).toEqual([0, 0, 0, 0, 1])
  expect(cols.every(c => c.props.flexShrink === 0 && c.props.flexDirection === 'column' && c.props.alignItems === 'flex-end' && c.props.paddingLeft === 1 && c.props.paddingRight === undefined)).toBe(true)
  // the status column floored at every width (live check 7, R10: the focus marker never widens it); the others from WIDE_FROM
  expect(cols.map(c => c.props.minWidth)).toEqual([officeModel(p).statusMin, undefined, undefined, undefined, undefined])
  for (const [k, col] of cols.entries()) {
    const cells = cellsOf(col)
    expect(cells).toHaveLength(2)
    expect(col.children).toHaveLength(2)   // the two rows' cells and nothing else
    for (const cell of cells) {
      // the status mark a coloured Text; every other cell a plain Button whose ONE Text child never wraps (decision 26)
      expect(cell.type).toBe(k === 0 ? 'Text' : 'Button')
      const t = k === 0 ? cell : (cell.children as Node[])[0]!
      if (k > 0) { expect(cell.props.plain).toBe(true); expect(cell.children).toHaveLength(1) }
      expect(t).toMatchObject({ type: 'Text', props: { wrap: 'truncate' } })
      expect(t.children).toHaveLength(1)
      expect(typeof t.children[0]).toBe('string')
      expect(t.children[0] as string).not.toContain(' ')
    }
  }
  expect(rowsOf(card!)).toEqual([['●', `💼${NBSP}lead`, 'Opus', '🧠', 'חושב'], ['●', `🦉${NBSP}a1`, 'Opus', '📖', 'קורא']])
  expect(rowsOf(card!)).toEqual([modelRow(p, 0, 0), modelRow(p, 0, 1)])
  // colour only on the status column; the who bold (working), the model dim, the activity plain — on the Buttons' Text children
  // (bold and dim are what a Button's child keeps on the desktop); no background anywhere
  const [status, who, model, emoji, word] = cols
  expect(cellsOf(status!).map(c => c.props)).toEqual([{ wrap: 'truncate', color: DOT_FG.running }, { wrap: 'truncate', color: DOT_FG.running }])
  expect(cellsOf(who!).map(cellStyle)).toEqual([{ wrap: 'truncate', bold: true, dimColor: false }, { wrap: 'truncate', bold: true, dimColor: false }])
  expect(cellsOf(model!).every(c => cellStyle(c).dimColor === true && cellStyle(c).color === undefined)).toBe(true)
  expect(cellsOf(emoji!).every(c => cellStyle(c).color === undefined && cellStyle(c).dimColor === false)).toBe(true)
  expect(cellsOf(word!).every(c => cellStyle(c).color === undefined && cellStyle(c).dimColor === false)).toBe(true)
  expect(cols.slice(1).every(col => cellsOf(col).every(c => c.props.color === undefined && c.props.dimColor === undefined && c.props.bold === undefined))).toBe(true)
  expect(nodes(tree).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
  // the footer rides in the chrome (the engine scrolls natively: a line at the content's end would hide until the end), one dim
  // line, cut to the line by LINE_FIT with an ellipsis (its 48 cells to 35 at 45 columns, the column 43; whole at 70)
  const note = 'עוד 400 סוכנים לא מוצגים · scan: env.get refused'
  const t3 = Office({ ...p, footer: note }, fake(45, 0).surface)
  expect(kidsOf(t3).map(kindOf)).toEqual(['header', 'toolbar', 'footer', 'round'])
  expect(chromeOf(t3)).toBe(chromeRows({ ...p, footer: note }))
  expect(textWidth(note)).toBe(48)
  expect(texts(byKey(t3, 'footer'))).toBe(cut(note, geometry(45).L))
  expect(texts(byKey(t3, 'footer'))).toMatch(/…$/)
  expect(textWidth(texts(byKey(t3, 'footer')))).toBeLessThanOrEqual(geometry(45).L)
  expect(texts(byKey(Office({ ...p, columns: 70, footer: note }, fake(70, 0).surface), 'footer'))).toBe(note)
  // LTR: the rows the same, the padding on the right, the columns aligned to the left, the toolbar a row
  const en = Office({ ...p, rtl: false, lang: 'en', labels: LABELS_EN }, fake().surface)
  expect(byKey(en, 'toolbar')).toMatchObject({ props: { flexDirection: 'row' } })
  const enCols = columnsOf(cards(en)[0]!)
  expect(enCols.every(c => c.props.alignItems === 'flex-start' && c.props.paddingRight === 1 && c.props.paddingLeft === undefined)).toBe(true)
  expect(rowsOf(cards(en)[0]!)).toEqual([['●', `💼${NBSP}lead`, 'Opus', '🧠', 'חושב'], ['●', `🦉${NBSP}a1`, 'Opus', '📖', 'קורא']])
})

test('structure: at every width 24..200, both directions, many rooms — a card per room, four (or three) column Boxes, a plain Button with one Text per value (the status mark a Text) and no Box per value, colour only on the status column, no time anywhere in a row, every title one line, a pin Button on every card (PIN on the pinned one, PIN_OFF else), every row\'s cells the same count', { timeoutMs: 30_000 }, () => {
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
        expect(pinOf(card)!.props.label, at).toBe(rooms[i]!.pinned ? PIN : PIN_OFF)
        expect(rooms[i]!.moreLabel ? more?.props.height : more, at).toBe(rooms[i]!.moreLabel ? 1 : undefined)
        const cols = columnsOf(card)
        expect(cols.length, at).toBeGreaterThanOrEqual(3)
        expect(cols.length, at).toBeLessThanOrEqual(6)
        expect(cols.map(c => c.props.flexGrow), at).toEqual([...cols.slice(0, -1).map(() => 0), 1])
        const perCol = cols.map(c => cellsOf(c).length)
        expect(new Set(perCol).size, at).toBe(1)
        expect(perCol[0], at).toBe(rooms[i]!.agents.length)
        cols.forEach((col, k) => {
          expect(col.children, at).toHaveLength(rooms[i]!.agents.length)   // nothing but the rows' cells in a column
          expect(rtl ? col.props.paddingLeft : col.props.paddingRight, at).toBe(1)
          for (const cell of cellsOf(col)) {
            expect(cell.type, at).toBe(k === 0 ? 'Text' : 'Button')
            const t = k === 0 ? cell : (cell.children as Node[])[0]!
            expect(t.type, at).toBe('Text')
            expect(t.props.wrap, at).toBe('truncate')
            expect(t.children, at).toHaveLength(1)
            const v = t.children[0] as string
            expect(typeof v, at).toBe('string')
            expect(v, at).not.toMatch(/⏱|′|min\b|\n/)
            expect(v, at).not.toMatch(REFUSED_RE)
            if (k === 0) expect(typeof cell.props.color, at).toBe('string')
            else { expect(cell.props.plain, at).toBe(true); expect(t.props.color, at).toBeUndefined() }
          }
        })
        // the table is as tall as its rows: no spacer in a window that holds every row, so the table block is the table itself
        expect(table, at).toBe(tableOf(card))
      })
      // the rows read as the model says: the status mark with the badges, `${emoji} ${name}`, the model word (in the mode that has it), the
      // activity's emoji and its word (in the mode that has it), the task from CENTRE_AT
      cs.forEach((card, i) => {
        rowsOf(card).forEach((r, k) => expect(r, `${columns} ${rtl} ${rooms[i]!.id} row ${k}`).toEqual(modelRow(p, i, k)))
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

test('THE OUTBOX (live check 7, R12: one post per frame, a later one replacing an undelivered one): every post is a batch — the instance id and its actions not yet cleared, each numbered once — so a second action in the same frame carries the first; a one-shot clock clears the outbox on the next frame (the next post carries its own action alone); the outbox never holds more than OUTBOX_MAX', () => {
  const f = fake()
  const tree = Office(props(), f.surface)
  const press = (key: string) => (byKey(tree, key, 'Button')!.props.onPress as () => void)()
  press('showDone')
  press('mute')
  expect(f.raw).toHaveLength(2)
  const [first, second] = f.raw as Array<{ t: string; i: string; items: Array<{ t: string; n: number }> }>
  expect(first).toEqual({ t: 'batch', i: f.surface.state!.inst.id, items: [{ t: 'showDone', n: 1 }] })
  expect(second).toEqual({ t: 'batch', i: first!.i, items: [{ t: 'showDone', n: 1 }, { t: 'mute', n: 2 }] })
  expect(first!.i).toMatch(/^[a-z0-9]+$/)
  expect(f.posts).toEqual([{ t: 'showDone' }, { t: 'mute' }])   // each action applied once
  // ONE clock clears it on the next frame (a frame tick of OUTBOX_FLUSH_MS), stopped once it ran
  const flush = f.timers.filter(t => t.ms === OUTBOX_FLUSH_MS)
  expect(flush).toHaveLength(1)
  f.tick()
  expect(flush[0]!.stopped).toBe(true)
  press('help')
  expect(f.raw.at(-1)).toEqual({ t: 'batch', i: first!.i, items: [{ t: 'help', n: 3 }] })
  expect(f.posts).toEqual([{ t: 'showDone' }, { t: 'mute' }, { t: 'help' }])
  // a burst inside one frame keeps the last OUTBOX_MAX actions
  for (let i = 0; i < OUTBOX_MAX + 3; i++) press('mute')
  expect((f.raw.at(-1) as { items: unknown[] }).items).toHaveLength(OUTBOX_MAX)
  expect(f.posts).toHaveLength(3 + OUTBOX_MAX + 3)
  // another instance numbers its own actions under its own id
  const g = fake()
  const t2 = Office(props(), g.surface)
  ;(byKey(t2, 'mute', 'Button')!.props.onPress as () => void)()
  expect((g.raw[0] as { i: string }).i).not.toBe(first!.i)
})

test('THE FINISH IS THE ⭐ ALONE (live check 6: the row\'s tint flashed a near-black band on the light theme): a new ⭐ stamp marks the finisher\'s status column and nothing else — no cell tinted, no clock started, no redraw of the module\'s own; the first props, a status change and a newcomer alike; the module exports no tint', () => {
  expect(Object.keys(OfficeClient)).not.toContain('FX_BG')
  expect(Object.keys(OfficeClient)).not.toContain('FX_DONE_MS')
  expect(Object.keys(OfficeClient)).not.toContain('FX_TICK_MS')
  const f = fake()
  const bg = (t: unknown) => nodes(t).filter(n => n.props.backgroundColor !== undefined)
  // the first props: a star already there is drawn, nothing tinted
  let p = withAgents(props(), [ag('lead'), ag('a1', { status: 'done', star: 5000, act: '✅ סיים' })])
  let tree = Office(p, f.surface)
  expect(rowsOf(cards(tree)[0]!)[1]![0]).toBe('⭐')
  expect(bg(tree)).toEqual([])
  const sets = f.setStates()
  // a new star on lead (it finished): the ⭐ on its status column (the props' badge), and that is all
  p = withAgents(p, [ag('lead', { status: 'done', star: 7000, act: '✅ סיים' }), p.rooms[0]!.agents[1]!])
  tree = Office(p, f.surface)
  expect(rowsOf(cards(tree)[0]!)[0]![0]).toBe('⭐')
  expect(bg(tree)).toEqual([])
  expect(f.timers).toHaveLength(0)
  expect(f.setStates()).toBe(sets)
  // a status change, a newcomer, a star: the same
  p = withAgents(p, [...p.rooms[0]!.agents.map(a => a.id === 'a1' ? { ...a, status: 'stale' as const } : a), ag('n1')])
  tree = Office(p, f.surface)
  p = withAgents(p, p.rooms[0]!.agents.map(a => a.id === 'n1' ? { ...a, status: 'done' as const, star: 9500, act: '✅ סיים' } : a))
  tree = Office({ ...p }, f.surface)
  expect(bg(tree)).toEqual([])
  tree = Office(p, f.surface)
  expect(bg(tree)).toEqual([])
  expect(f.timers).toHaveLength(0)
  expect(f.setStates()).toBe(sets)
})

test('THE TOO-LONG CONVERSATIONS NOTE (live check 6): the note rides the settings popover as its last line, one dim Text cut to the line by LINE_FIT, the popover a row taller (helpRows with the note) so a click on a row under it still opens that row; never the footer, nothing of it with the popover closed', () => {
  const note = I18N.he.oversizedN(1)
  for (const columns of [24, 34, 45, 51, 80, 120, 200]) {
    const f = fake(columns)
    const p = props({ columns, helpOpen: true, oversized: note })
    const tree = Office(p, f.surface)
    const box = byKey(tree, 'help')!
    expect(box.props.height, `${columns}`).toBe(helpRows(columns, true))
    const rows = box.children as Node[]
    expect(rows, `${columns}`).toHaveLength(4)
    expect(rows[3], `${columns}`).toMatchObject({ type: 'Box', props: { height: 1, overflow: 'hidden' } })
    const t = nodes(rows[3]).filter(n => n.type === 'Text')
    expect(t, `${columns}`).toHaveLength(1)
    expect(t[0]!.props.dimColor, `${columns}`).toBe(true)
    expect(texts(t[0]), `${columns}`).toBe(nb(cut(note, fitLine(geometry(columns).inner))))
    expect(textWidth(texts(t[0])), `${columns}`).toBeLessThanOrEqual(fitLine(geometry(columns).inner))
    expect(byKey(tree, 'footer'), `${columns}`).toBeUndefined()
    expect(chromeOf(tree), `${columns}`).toBe(chromeRows(p))
    // the rows under the floating popover keep their Buttons: a press on the first row opens it
    f.press(tree, 'agent:lead:who')
    expect(f.posts, `${columns}`).toEqual([{ t: 'open', id: 'lead' }])
  }
  // at 45 columns the whole note, its spaces no-break (it never wraps out of its one line)
  expect(texts(nodes(byKey(Office(props({ helpOpen: true, oversized: note }), fake().surface), 'help')).filter(n => n.type === 'Text').pop())).toBe(nb(note))
  // English
  const en = Office(props({ columns: 60, lang: 'en', rtl: false, labels: LABELS_EN, helpOpen: true, oversized: I18N.en.oversizedN(2) }), fake(60).surface)
  expect(texts((byKey(en, 'help')!.children as Node[])[3])).toBe(nb('2 conversations are too long to show'))
  // closed: nowhere, and no row of the chrome
  const closed = Office(props({ oversized: note }), fake().surface)
  expect(texts(closed)).not.toContain(nb(note))
  expect(texts(closed)).not.toContain(note)
  expect(chromeOf(closed)).toBe(CHROME_ROWS_MIN)
  // no note: the popover as it was (three children, helpRows tall)
  const none = byKey(Office(props({ helpOpen: true }), fake().surface), 'help')!
  expect(none.children).toHaveLength(3)
  expect(none.props.height).toBe(helpRows(45))
})

test('THE DEMO LINE (live check 5): while the demo runs, the first line under the header says so — `🎬 זו הדגמה - הסוכנים לא אמיתיים` (amber, one no-break value) at the reading edge, the exit Button (`יציאה` / `Exit demo`, posting the demo\'s target (off)) at the other, a blank line under it; the chrome a row taller (DEMO_ROWS), so a click on a row still opens that row; none without the demo', () => {
  expect(DEMO_ROWS).toBe(1)
  const f = fake(51, 0)
  const p = props({ demo: true, columns: 51 })
  const tree = Office(p, f.surface)
  // the order: the header (its blank line now under the demo line), the demo line, the toolbar, the card
  expect(kidsOf(tree).map(kindOf)).toEqual(['header', 'demoLine', 'toolbar', 'round'])
  expect(byKey(tree, 'header')!.props.marginBottom ?? 0).toBe(0)
  const line = byKey(tree, 'demoLine')!
  expect(line).toMatchObject({ type: 'Box', props: { flexDirection: 'row-reverse', justifyContent: 'space-between', width: '100%', height: 1, overflow: 'hidden', marginBottom: 1 } })
  const [note, exit] = line.children as Node[]
  expect(note).toMatchObject({ type: 'Text', props: { color: DEMO_FG } })
  expect(texts(note)).toBe(nb('🎬 זו הדגמה - הסוכנים לא אמיתיים'))
  expect(texts(note)).not.toMatch(/ |-/)                       // no plain space, no hyphen-minus: the line can never break
  expect(texts(note)).not.toMatch(REFUSED_RE)
  expect(hebrewRuleOk(texts(note))).toBe(true)
  expect(exit).toMatchObject({ type: 'Button', props: { key: 'exitDemo', plain: true, label: 'יציאה' } })
  expect(exit!.props.hotkey).toBeUndefined()                     // (d is the settings' demo Button's letter)
  ;(exit!.props.onPress as () => void)()
  expect(f.posts).toEqual([{ t: 'demo', on: false }])   // (the exit's TARGET, never a flip: live check 7, R7)
  // the chrome: a row taller than without the demo, as the hooks size it (chromeRows) and as drawn
  expect(chromeOf(tree)).toBe(CHROME_ROWS_MIN + DEMO_ROWS)
  expect(chromeRows(p)).toBe(CHROME_ROWS_MIN + DEMO_ROWS)
  expect(chromeRows({ ...p, demo: false })).toBe(CHROME_ROWS_MIN)
  expect(fixedRows(withAgents(p, many()))).toBe(CHROME_ROWS_SEARCH + DEMO_ROWS)
  expect(fixedRows({ ...withAgents(p, many()), columns: pane(ONE_LINE_FROM) })).toBe(CHROME_ROWS_MIN + DEMO_ROWS)
  expect(officeHeight(p, rowCount(p))).toBe(officeHeight({ ...p, demo: false }, rowCount(p)) + DEMO_ROWS)
  // every row's cells are Buttons under the taller chrome: a press on each opens that row
  for (const r of officeModel(p).rooms.flatMap(x => x.rows)) {
    f.press(tree, `agent:${r.id}:who`)
    expect(f.posts.at(-1)).toEqual({ t: 'open', id: r.id })
  }
  // the demo line and the header hold no agent Button: the chrome's Buttons are the exit and the toolbar's three
  expect(kidsOf(tree).filter(k => !cards(tree).includes(k)).flatMap(k => nodes(k)).filter(n => n.type === 'Button').map(n => n.props.key)).toEqual(['exitDemo', 'showDone', 'mute', 'help'])
  // English: `🎬 Demo - these agents are not real` and `Exit demo`, read left to right
  const en = Office(props({ demo: true, columns: 80, rtl: false, lang: 'en', labels: LABELS_EN }), fake(80).surface)
  const enLine = byKey(en, 'demoLine')!
  expect(enLine.props.flexDirection).toBe('row')
  expect(texts((enLine.children as Node[])[0])).toBe(nb('🎬 Demo - these agents are not real'))
  expect((enLine.children as Node[])[1]!.props.label).toBe('Exit demo')
  // no demo: no line, the header keeps its blank line
  const plain = Office(props({ columns: 51 }), fake(51).surface)
  expect(byKey(plain, 'demoLine')).toBeUndefined()
  expect(byKey(plain, 'header')!.props.marginBottom).toBe(1)
  // the empty office of a search with no match in the demo: the line stays (the chrome counts it either way)
  const nomatch = props({ demo: true, columns: 80, rooms: [], search: 'zzz', empty: { kind: 'nomatch', msg: LABELS.emptyNoMatch ?? '', sub: '' } })
  expect(kidsOf(Office(nomatch, fake(80).surface)).map(k => k.props.key)).toEqual(['header', 'demoLine', 'toolbar', 'empty'])
  expect(chromeRows(nomatch)).toBe(CHROME_ROWS_MIN + DEMO_ROWS)
})

test('THE DEMO LINE\'s ladder (demoLine): the longest note that fits beside the exit Button by LINE_FIT — the whole sentence, then `הדגמה - לא אמיתיים`, then `זו הדגמה` (EN: `Demo - not real`, `Demo`) — the 🎬 leading, the Button\'s word whenever a note fits beside it, else its ✕; never a cut word; a wider pane never shows a shorter note', () => {
  expect(demoLine(props({ columns: 51 }))).toEqual({ note: '🎬 זו הדגמה - הסוכנים לא אמיתיים', exit: 'יציאה' })
  // Asaf's pane of ~40 columns: the sentence (32 cells + the gap + the Button's 5) is past LINE_FIT's 33 — the middle note
  expect(demoLine(props({ columns: 40 }))).toEqual({ note: '🎬 הדגמה - לא אמיתיים', exit: 'יציאה' })
  expect(demoLine(props({ columns: 24 }))).toEqual({ note: '🎬 זו הדגמה', exit: 'יציאה' })
  expect(demoLine(props({ columns: 80, lang: 'en', rtl: false, labels: LABELS_EN }))).toEqual({ note: '🎬 Demo - these agents are not real', exit: 'Exit demo' })
  expect(demoLine(props({ columns: 40, lang: 'en', rtl: false, labels: LABELS_EN }))).toEqual({ note: '🎬 Demo - not real', exit: 'Exit demo' })
  expect(demoLine(props({ columns: 24, lang: 'en', rtl: false, labels: LABELS_EN }))).toEqual({ note: '🎬 Demo', exit: 'Exit demo' })
  // under the floor the ✕ alone
  expect(demoLine(props({ columns: 12 }))).toEqual({ note: '🎬', exit: '✕' })
  for (const [lang, labels] of [['he', LABELS], ['en', LABELS_EN]] as const) {
    const forms = [labels.demoNote, labels.demoNoteMid, labels.demoNoteShort].map(s => `🎬 ${s}`)
    let last = 0
    for (let columns = 24; columns <= 200; columns++) {
      const d = demoLine(props({ columns, lang, labels }))
      expect(forms, `${lang} ${columns}`).toContain(d.note)
      expect(d.exit, `${lang} ${columns}`).toBe(labels.demoExit)
      expect(textWidth(d.note) + DEMO_GAP + textWidth(d.exit), `${lang} ${columns}`).toBeLessThanOrEqual(geometry(columns).L)
      expect(textWidth(d.note), `${lang} ${columns}`).toBeGreaterThanOrEqual(last)
      last = textWidth(d.note)
      if (lang === 'he') { expect(hebrewRuleOk(d.note)).toBe(true); expect(hebrewRuleOk(d.exit)).toBe(true) }
    }
  }
})

// ---------------------------------------------------------------------------
// phase B (paint probe 22.10, decision 26): every click a native Button, the floating overlay, the window with overscan
// ---------------------------------------------------------------------------

test('clicks (phase B): every control is a plain Button — a row cell opens its agent, the open agent closes, the pin posts and holds the order until the pointer leaves, the more line posts roomDone; no pointer down is read', () => {
  const p = propsAt(50)   // two rooms, the second with 5 finished (a more line), the first pinned
  const f = fake(50, 30)
  let tree = Office(p, f.surface)
  const a = p.rooms[0]!.agents[0]!.id
  for (const cell of ['who', 'model', 'emoji', 'word']) {
    f.press(tree, `agent:${a}:${cell}`)
    expect(f.posts.at(-1)).toEqual({ t: 'open', id: a })
    expect(f.surface.state!.focus).toBe(a)
  }
  // the open agent: its cells close (live check 7, Q2: a close, never a flip in the hooks)
  const open = { ...p, drawer: drawerFor(p, a), selected: a }
  tree = Office(open, f.surface)
  f.press(tree, `agent:${a}:who`)
  expect(f.posts.at(-1)).toEqual({ t: 'close' })
  // the pin: posted, and THE PIN'S PLACE holds the drawn order until a leave; the press makes the Enter the office's again (R14)
  const r2 = p.rooms[1]!.id
  tree = Office(p, f.surface)
  f.surface.state!.inst.typing = true
  f.press(tree, `pin:${r2}`)
  expect(f.posts.at(-1)).toEqual({ t: 'pin', room: r2 })
  expect(f.surface.state!.inst.typing).toBe(false)
  expect(f.surface.state!.inst.frozen).toEqual(p.rooms.map(r => r.id))
  // a second pin press (the first's answer not drawn yet, or the other room's pin): the first order held, not frozen afresh
  const held = f.surface.state!.inst.frozen
  f.press(tree, `pin:${p.rooms[0]!.id}`)
  expect(f.posts.at(-1)).toEqual({ t: 'pin', room: p.rooms[0]!.id })
  expect(f.surface.state!.inst.frozen).toBe(held)
  expect(held).toEqual(p.rooms.map(r => r.id))
  const pinned = { ...p, rooms: [{ ...p.rooms[1]!, pinned: true }, p.rooms[0]!] }
  tree = Office(pinned, f.surface)
  expect(cards(tree).map(c => c.props.key)).toEqual(p.rooms.map(r => `room:${r.id}`))   // the order as drawn before the pin
  expect(pinOf(cards(tree)[1]!)!.props.label).toBe(PIN)                                  // ... the pinned card's colour 📌 at once
  const sets = f.setStates()
  f.pointer({ type: 'leave', x: 0, y: 0 })
  expect(f.surface.state!.inst.frozen).toBeNull()
  expect(f.setStates()).toBe(sets + 1)                                                   // (one redraw releases it)
  f.pointer({ type: 'leave', x: 0, y: 0 })
  expect(f.setStates()).toBe(sets + 1)                                                   // (a leave with nothing held: no setState)
  tree = Office(pinned, f.surface)
  expect(cards(tree).map(c => c.props.key)).toEqual([`room:${r2}`, `room:${p.rooms[0]!.id}`])
  // the more line (its press makes the Enter the office's again too)
  f.surface.state!.inst.typing = true
  f.press(tree, `more:${r2}`)
  expect(f.posts.at(-1)).toEqual({ t: 'roomDone', room: r2 })
  expect(f.surface.state!.inst.typing).toBe(false)
  // a pointer down is nothing: no post, no state
  const n = f.posts.length
  f.pointer({ type: 'down', x: 5, y: 5, button: 'left' })
  f.pointer({ type: 'move', x: 5, y: 6 })
  f.pointer({ type: 'up', x: 5, y: 6, button: 'left' })
  f.pointer({ type: 'enter', x: 5, y: 6 })
  expect(f.posts.length).toBe(n)
  expect(f.setStates()).toBe(sets + 1)
  expect('hoverRoom' in f.surface.state!).toBe(false)
  // every press makes the keyboard's Enter the office's again (R14)
  f.surface.state!.inst.typing = true
  f.press(tree, `agent:${a}:who`)
  expect(f.surface.state!.inst.typing).toBe(false)
})

test('every chrome press makes the Enter the office\'s again (R14): the toolbar\'s three, the settings\' demo, language and close, the drawer\'s close, the demo line\'s exit, the empty office\'s demo — each clears inst.typing and posts its message', () => {
  const p = propsAt(50)
  const f = fake(50, 30)
  const a = p.rooms[0]!.agents[0]!.id
  const trees: Array<[unknown, string, OfficeMessage]> = [
    [Office(p, f.surface), 'showDone', { t: 'showDone' }],
    [Office(p, f.surface), 'mute', { t: 'mute' }],
    [Office(p, f.surface), 'help', { t: 'help' }],
    [Office({ ...p, helpOpen: true }, f.surface), 'demo', { t: 'demo', on: true }],
    [Office({ ...p, helpOpen: true }, f.surface), 'lang', { t: 'lang' }],
    [Office({ ...p, helpOpen: true }, f.surface), 'closeHelp', { t: 'close' }],
    [Office({ ...p, drawer: drawerFor(p, a), selected: a }, f.surface), 'close', { t: 'close' }],
    [Office({ ...p, demo: true }, f.surface), 'exitDemo', { t: 'demo', on: false }],
    [Office({ ...p, rooms: [], empty: { kind: 'office', msg: 'm', sub: '' } }, f.surface), 'watchDemo', { t: 'demo', on: true }],
  ]
  for (const [tree, key, m] of trees) {
    f.surface.state!.inst.typing = true
    f.press(tree, key)
    expect(f.surface.state!.inst.typing, key).toBe(false)
    expect(f.posts.at(-1), key).toEqual(m)
  }
  // ... so an Enter right after any of them opens the focus (none here: no row walked or pressed — no open posted)
  const n = f.posts.length
  f.key({ key: 'return' })
  expect(f.posts).toHaveLength(n)
  f.press(Office(p, f.surface), `agent:${a}:who`)
  f.key({ key: 'return' })
  expect(f.posts.at(-1)).toEqual({ t: 'open', id: a })
})

test('the pin Button is on every title: PIN_OFF (monochrome) for an unpinned room, PIN for a pinned one, both the same width in the line, before the title at the reading edge', () => {
  const p = propsAt(50)
  const tree = Office(p, fake(50, 30).surface)
  expect(cards(tree)).toHaveLength(2)
  for (const card of cards(tree)) {
    const room = p.rooms.find(r => `room:${r.id}` === card.props.key)!
    const pin = pinOf(card)!
    expect(pin.type).toBe('Button')
    expect(pin.props.plain).toBe(true)
    expect(pin.props.label).toBe(room.pinned ? PIN : PIN_OFF)
    expect(pin.props.color).toBeUndefined()
    expect(pin.props.dimColor).toBeUndefined()
    // the title line: pin, title Box, counts Box — in that order whatever the pin's state
    expect((partsOf(card).title.children as Node[]).map(n => n.type)).toEqual(['Button', 'Box', 'Box'])
  }
  expect(textWidth(PIN_OFF)).toBe(textWidth(PIN))
})

test('the more line is a plain Button of regular weight (no colour: a Button draws none) with the room\'s label; a row\'s who / model / emoji / word cells are plain Buttons whose Text child keeps the weights, the status mark a coloured Text', () => {
  const p = propsAt(50)
  const tree = Office(p, fake(50, 30).surface)
  const card = cards(tree)[1]!   // the room with the more line
  const more = partsOf(card).more!
  const b = (more.children as Node[])[0]!
  expect(b.type).toBe('Button')
  expect(b.props.key).toBe(`more:${p.rooms[1]!.id}`)
  expect(b.props.label).toBe(officeModel(p).rooms[1]!.more)
  expect(b.props.color).toBeUndefined()
  expect(b.props.bold).toBeUndefined()
  expect(b.props.dimColor).toBeUndefined()
  expect(partsOf(cards(tree)[0]!).more).toBeUndefined()
  const cols = columnsOf(cards(tree)[0]!)
  const [mark, who] = cols
  expect(cellsOf(mark!).every(n => n.type === 'Text' && typeof n.props.color === 'string')).toBe(true)
  for (const col of cols.slice(1)) for (const cell of cellsOf(col)) {
    expect(cell.type).toBe('Button')
    expect(cell.props.plain).toBe(true)
    expect(String(cell.props.key)).toMatch(/^agent:.+:(who|model|emoji|word|task)$/)
    const t = (cell.children as Node[])[0]!
    expect(t.type).toBe('Text')
    expect(t.props.wrap).toBe('truncate')
    expect(t.props.color).toBeUndefined()
  }
  // a working agent's who is bold, a finished one's dim, as the model weights them
  const m = officeModel(p).rooms[0]!.rows
  cellsOf(who!).forEach((cell, i) => {
    const t = (cell.children as Node[])[0]!
    expect(!!t.props.bold).toBe(m[i]!.bold)
    expect(!!t.props.dimColor).toBe(m[i]!.dim && !m[i]!.failed)
  })
})

test('THE FLOATING OVERLAY: the drawer (or the settings) is an absolute Box from the root at max(offset, chrome) on inverseText, the reading column wide, its one height — and takes no row: the cards sit where they sat without it', () => {
  const p = propsAt(50)
  const f = fake(50, 30)
  const plain = Office({ ...p, offset: 0 }, f.surface)
  const a = p.rooms[0]!.agents[0]!.id
  const d = { ...p, drawer: drawerFor(p, a), selected: a, offset: 0 }
  const tree = Office(d, f.surface)
  const ov = overlayOf(tree)!
  const chrome = chromeRows(d)
  expect(ov.props).toMatchObject({ key: 'drawer', position: 'absolute', top: chrome, left: geometry(50).margin, width: geometry(50).W, backgroundColor: 'inverseText', height: overlayHeight(d) })
  expect(ov.props.marginBottom).toBeUndefined()
  // the root: the column, then the overlay (painted after it — the last child)
  expect((tree as unknown as Node).props).toEqual({ key: 'root', flexDirection: 'column', width: '100%' })
  expect(((tree as unknown as Node).children as Node[]).map(n => n.props.key)).toEqual(['column', 'drawer'])
  expect(byKey(tree, 'spacer')).toEqual(byKey(plain, 'spacer'))
  expect(cards(tree).map(c => c.props.key)).toEqual(cards(plain).map(c => c.props.key))
  expect(chromeOf(tree)).toBe(chromeOf(plain))
  expect(kidsOf(tree).map(kindOf)).toEqual(kidsOf(plain).map(kindOf))
  // scrolled: the overlay rides the window's top
  const scrolled = Office({ ...d, offset: 25, rows: 30 }, f.surface)
  expect(overlayOf(scrolled)!.props.top).toBe(25)
  // the settings: the same Box, keyed help, helpRows tall
  const h = Office({ ...p, helpOpen: true, offset: 40, rows: 30 }, f.surface)
  expect(overlayOf(h)!.props).toMatchObject({ key: 'help', position: 'absolute', top: 40, left: geometry(50).margin, width: geometry(50).W, backgroundColor: 'inverseText', height: helpRows(50, false) })
  expect(overlayOf(h)!.props.marginBottom).toBeUndefined()
  // neither open: no overlay child
  expect(overlayOf(plain)).toBeUndefined()
  expect(((plain as unknown as Node).children as Node[]).map(n => n.props.key)).toEqual(['column'])
  // no fragment anywhere, and no background but the overlay's
  expect(byKey(tree, 'fragment')).toBeUndefined()
  expect(nodes(tree).filter(n => n.props.backgroundColor !== undefined)).toEqual([ov])
  // the empty office: the overlay still floats, at the offset handed
  const e = Office({ ...p, rooms: [], empty: { kind: 'office', msg: 'm', sub: '' }, helpOpen: true, offset: 3 }, f.surface)
  expect(overlayOf(e)!.props).toMatchObject({ key: 'help', top: Math.max(3, chromeRows(p)) })
  expect(f.surface.state!.inst.win).toEqual({ from: 0, count: 0 })
})

test('THE WINDOW WITH OVERSCAN: a short office is drawn whole at every offset; a long one up to a body on each side of the window (capped so the window never passes WINDOW_ROWS lines); the row budget still caps the rows', () => {
  const p = propsAt(50)   // ~20 lines
  const f = fake(50, 20)
  const t0 = Office({ ...p, rows: 20, offset: 0 }, f.surface)
  const t1 = Office({ ...p, rows: 20, offset: 18 }, f.surface)
  expect(f.surface.state!.inst.win).toEqual({ from: 0, count: officeModel(p).lines.length })
  expect(rowsOf(cards(t1)[0]!)).toEqual(rowsOf(cards(t0)[0]!))
  expect(byKey(t1, 'spacer')).toBeUndefined()
  // a long office: 120 agents in one room (> WINDOW_ROWS lines with the frames), a 20-row body scrolled to 50
  const big = propsAt(50, { agents: 120 })
  const len = officeModel(big).lines.length
  expect(len).toBeGreaterThan(WINDOW_ROWS)
  expect(overscanOf(len, 20)).toBe(20)
  Office({ ...big, rows: 20, offset: 50 }, f.surface)
  const w = windowOf(chromeRows(big), 50, 20, len, 20)
  const t = trimWindow(officeModel(big), w.from, w.count, WINDOW_ROWS)
  expect(f.surface.state!.inst.win).toEqual(t)
  expect(t.from).toBe(Math.max(0, 50 - chromeRows(big) - 20))
  expect(t.count).toBe(60)
})

test('THE PRE-EMPTS (live check 7, R14 and J9): every card keyed by its room (`room:<id>`: a line inserted before it never repaints it as another); an Enter that follows typing in the search field is the field\'s (its onSubmit) — onKey opens no drawer for it, while o and an Enter after a click or a walk key still open the focus (spec §6.4); the toolbar\'s words or icons are decided on the WIDEST state of its toggles (☑, 🔕), so a toggle never switches the row between words and icons', () => {
  // keyed cards
  const two = props({ rooms: [room('A', [ag('a1')]), room('B', [ag('b1')])] })
  expect(cards(Office(two, fake().surface)).map(c => c.props.key)).toEqual(['room:A', 'room:B'])
  // Enter after typing in the field
  const f = fake()
  const p = withAgents(props(), many())
  const tree = Office(p, f.surface)
  f.press(tree, 'agent:m0:who')   // a press: the focus on m0, its drawer
  expect(f.posts).toEqual([{ t: 'open', id: 'm0' }])
  const field = nodes(tree).find(n => n.type === 'Input')!
  ;(field.props.onInput as (v: string) => void)('tri')
  expect(f.posts.at(-1)).toEqual({ t: 'search', q: 'tri' })
  const n = f.posts.length
  f.key({ key: 'return' })                                           // the field's Enter, reaching onKey too
  ;(field.props.onSubmit as (v: string) => void)('tri')
  expect(f.posts.slice(n).some(m => m.t === 'open'), 'Enter in the search opened a drawer').toBe(false)
  f.key({ key: 'o' })                                                // o: the focus's drawer, as always
  expect(f.posts.at(-1)).toEqual({ t: 'open', id: 'm0' })
  f.key({ key: 'j' })
  f.key({ key: 'return' })                                           // after a walk key, Enter opens the focus again
  expect(f.posts.at(-1)).toEqual({ t: 'open', id: 'm1' })
  // J9: at a 39-cell column the Hebrew words fit with ☐ (32 cells) but not with ☑ (33 > fitLine(39) = 32): the icons either way
  const labels = (q: OfficeProps) => ['showDone', 'mute', 'help'].map(k => nodes(Office(q, fake(q.columns).surface)).find(x => x.type === 'Button' && x.props.key === k)!.props.label)
  expect(labels(props({ columns: pane(39) }))).toEqual(['☐', '🔕', '⚙️'])
  expect(labels(props({ columns: pane(39), prefs: { showDone: true, muted: true } }))).toEqual(['☑', '🔕', '⚙️'])
  expect(labels(props({ columns: pane(40) }))).toEqual(['הצג שסיימו ☐', 'צליל 🔕', 'הגדרות ⚙️'])
  expect(labels(props({ columns: pane(40), prefs: { showDone: true, muted: false } }))).toEqual(['הצג שסיימו ☑', 'צליל 🔔', 'הגדרות ⚙️'])
})

test('THE STALE OFFSET (live check 7, R13): a press that shortens the office while the pane is scrolled to its end hands the module the old offset until the engine asks again — the module clamps it to the content (offset ≤ chrome + lines - rows), so the window it draws (and the top the overlay rides) is the one the engine shows: no blank rows, the last rows pressable', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ag(`g${i}`))
  // (a long office — past WINDOW_ROWS lines — so the overscan is capped, not the whole office, and the window moves with the offset)
  const tall = props({ rows: 25, rooms: [room('A', rows(140), { moreDone: 30, moreLabel: 'עוד 30 שסיימו' })] })
  const short = props({ rows: 25, rooms: [room('A', rows(110), { moreDone: 30, moreLabel: 'עוד 30 שסיימו' })] })
  const C = chromeRows(short)
  const mShort = officeModel(short)
  const linesTall = officeModel(tall).lines.length
  const linesShort = mShort.lines.length
  expect(linesShort).toBeGreaterThan(WINDOW_ROWS)
  const endTall = C + linesTall - 25          // the engine's offset at the tall office's end
  const endShort = C + linesShort - 25        // ... and the most it can be once the office is short
  expect(endTall).toBeGreaterThan(endShort)
  /** The window the module draws of the short office at `offset`: windowOf with the overscan, trimmed to the row budget. */
  const win = (offset: number) => { const w = windowOf(C, offset, 25, linesShort, overscanOf(linesShort, 25)); return trimWindow(mShort, w.from, w.count, WINDOW_ROWS) }
  expect(win(endTall)).not.toEqual(win(endShort))
  const f = fake(45, 0)
  const t0 = Office({ ...tall, offset: endTall }, f.surface)
  f.press(t0, 'more:A')   // the press that shortens the office (the hooks answer with fewer rows and the same offset)
  expect(f.posts).toEqual([{ t: 'roomDone', room: 'A' }])
  const tree = Office({ ...short, offset: endTall }, f.surface)
  expect(f.surface.state!.inst.win).toEqual(win(endShort))
  // the last row of the office, at the bottom of the viewport the engine shows, is drawn: its cell presses
  const last = mShort.rooms[0]!.rows.at(-1)!
  f.press(tree, `agent:${last.id}:who`)
  expect(f.posts.at(-1)).toEqual({ t: 'open', id: last.id })
  // the overlay rides the clamped offset too (its top is the window's top the engine shows)
  const d = Office({ ...short, offset: endTall, selected: last.id, drawer: drawer({ id: last.id }) }, f.surface)
  expect(overlayOf(d)!.props.top).toBe(endShort)
  // the redraws that follow with the offset still stale (the press's own focus setState, the next {props} answer — until the
  // engine asks again) keep the clamped window: the module remembers the taller content while the offset is stale
  Office({ ...short, offset: endTall }, f.surface)
  expect(f.surface.state!.inst.win).toEqual(win(endShort))
  // the engine asks again with its own clamped offset: drawn as handed (the end of the short office)
  Office({ ...short, offset: endShort }, f.surface)
  expect(f.surface.state!.inst.win).toEqual(win(endShort))
  // an offset inside the content is never touched
  Office({ ...short, offset: 3 }, f.surface)
  expect(f.surface.state!.inst.win).toEqual(win(3))
  expect(win(3)).toEqual({ from: 0, count: 3 - C + 25 + overscanOf(linesShort, 25) })   // (the body under the chrome's lines, and the overscan below)
})

test('window (with overscan): a long office draws the cards the window and its overscan touch whole, their rows only where they lie in it (ONE spacer above and one below the table for the rest, not one per column); the cards above are one spacer; the row budget leaves the lowest rows blank, with no Button for them', () => {
  // 120 agents at 45 columns: one card of 127 lines, its rows on lines 4..123 (a_i on line i + 4); the chrome 6 (the search field)
  const many = withAgents(props(), Array.from({ length: 120 }, (_, i) => ag(`a${i}`)))
  expect(rowCount(many)).toBe(127)
  expect(chromeRows(many)).toBe(CHROME_ROWS_SEARCH)
  // a 10-row body at offset 30: the window lines 24..33 (the offset less the chrome), a body of 10 on each side — 14..43: a10..a39
  const t2 = Office({ ...many, offset: 30, rows: 10 }, fake(45, 0).surface)
  expect(kidsOf(t2).map(kindOf)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  const card = cards(t2)[0]!
  const block = partsOf(card).table
  expect(block).toBe(blockOf(card))
  expect(block).toMatchObject({ props: { flexDirection: 'column', width: '100%' } })
  const [above, tbl, below] = block.children as Node[]
  expect(above).toMatchObject({ type: 'Box', props: { height: 10 } })    // a0..a9 above the overscan
  expect(tbl).toBe(tableOf(card))
  expect(below).toMatchObject({ type: 'Box', props: { height: 80 } })   // a40..a119 below it
  expect(block.children).toHaveLength(3)
  for (const col of columnsOf(card)) {
    expect(cellsOf(col)).toHaveLength(30)
    expect(col.children).toHaveLength(30)   // no spacer inside a column
  }
  expect(rowsOf(card).map(r => r[1])).toEqual(Array.from({ length: 30 }, (_, i) => `🦉${NBSP}a${i + 10}`))
  // two rooms of 60 (A lines 0..66, B 67..133: its title 69, its blank line 70, its rows 71..130), the window past A — A is not
  // drawn: a spacer of its lines stands before B
  const sixty = (k: string) => Array.from({ length: 60 }, (_, i) => ag(`${k}${i}`))
  const two = props({ rooms: [room('A', sixty('a')), room('B', sixty('b'))], offset: 6 + 90, rows: 10 })
  expect(rowCount(two)).toBe(134)
  const t3 = Office(two, fake(45, 0).surface)
  expect(kidsOf(t3).map(kindOf)).toEqual(['header', 'toolbar', 'searchLine', 'spacer', 'round'])
  expect(byKey(t3, 'spacer')!.props.height).toBe(67)   // room A's card: 7 + 60 lines
  expect(cards(t3)).toHaveLength(1)
  expect(rowsOf(cards(t3)[0]!).map(r => r[1])).toEqual(Array.from({ length: 30 }, (_, i) => `🦉${NBSP}b${i + 9}`))   // lines 80..109
  // the overscan reaching A's gap line alone (the window 76..85, from 66): A is drawn for its frame — its rows one spacer — then B
  const t4 = Office({ ...two, offset: 6 + 76, rows: 10 }, fake(45, 0).surface)
  expect(cards(t4)).toHaveLength(2)
  expect(columnsOf(cards(t4)[0]!)).toHaveLength(0)
  expect(partsOf(cards(t4)[0]!).table).toMatchObject({ props: { height: 60 } })
  expect(rowsOf(cards(t4)[1]!)).toHaveLength(25)   // lines 71..95: b0..b24
  // the row budget: a 150-row pane over 200 agents draws WINDOW_ROWS rows and leaves the rest blank; the window says so; a row
  // left blank has no Button, the last drawn one presses
  const crowd = withAgents(props({ rows: 150 }), Array.from({ length: 200 }, (_, i) => ag(`g${i}`)))
  const g = fake(45, 0)
  const t5 = Office(crowd, g.surface)
  expect(rowsOf(cards(t5)[0]!)).toHaveLength(WINDOW_ROWS)
  expect(g.surface.state!.inst.win).toEqual({ from: 0, count: 4 + WINDOW_ROWS })
  expect(() => g.press(t5, `agent:g${WINDOW_ROWS}:who`)).toThrow(/no Button/)
  g.press(t5, `agent:g${WINDOW_ROWS - 1}:who`)
  expect(g.posts).toEqual([{ t: 'open', id: `g${WINDOW_ROWS - 1}` }])
  // the empty office draws no cards: no agent, pin or more Button — the toolbar's three and the demo's
  const h = Office(props({ rooms: [], empty: { kind: 'office', msg: 'm', sub: '' } }), fake().surface)
  expect(nodes(h).filter(n => n.type === 'Button').map(n => n.props.key)).toEqual(['showDone', 'mute', 'help', 'watchDemo'])
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
  for (const [k, t] of [['x', 'close'], ['f', 'showDone'], ['m', 'mute'], ['l', 'lang'], ['h', 'help'], ['d', 'demo']] as const) {
    f.key({ key: k })
    // (d posts the demo's target: on, from an office not in the demo — live check 7, R7)
    expect(f.posts[f.posts.length - 1]).toEqual(t === 'demo' ? { t, on: true } : { t })
  }
  f.key({ key: 'q' })
  f.key({ key: 's' })   // (no motion toggle: live check 7, Q9)
  f.key({ key: 'f', ctrl: true })
  expect(f.posts.length).toBe(8)
  expect(f.posts.some(m => (m as { t: string }).t === 'focus')).toBe(false)
  // a focused agent that leaves the office: the focus is dropped, no stale post
  Office(withAgents(p, [ag('lead')]), f.surface)
  f.key({ key: 'o' })
  expect(f.posts.length).toBe(8)
})

test('keys: j / k keep to the rows drawn (the window with its overscan) — from no focus, j lands on the first row drawn and stops at the last; a focus scrolled out of the drawn rows restarts from the first (j) or last (k) of them; o opens the focus', () => {
  // 120 agents at 45 columns (a long office: the overscan a body, not the whole): g_i on layout line i + 4, the chrome 6. A 13-row
  // window scrolled 25 rows is lines 19..31, drawn with 13 more on each side: 6..44 — g2..g40
  const p = withAgents(props({ rows: 13, offset: 25 }), Array.from({ length: 120 }, (_, i) => ag(`g${i}`)))
  const f = fake(45, 0)
  Office(p, f.surface)
  expect(f.surface.state!.inst.win).toEqual({ from: 6, count: 39 })
  f.key({ key: 'j' })
  expect(f.surface.state!.focus).toBe('g2')
  for (let i = 0; i < 50; i++) f.key({ key: 'j' })
  expect(f.surface.state!.focus).toBe('g40')                 // the last row drawn: the walk stops there
  const tree = Office(p, f.surface)
  expect(rowsOf(cards(tree)[0]!).map(r => r[0]!).filter(s => s.includes(FOCUS_MARK.rtl))).toHaveLength(1)   // ... and its marker is drawn
  f.key({ key: 'k' })
  expect(f.surface.state!.focus).toBe('g39')
  // the person scrolls back to the top: g39 is out of the rows drawn (lines 0..25: the frame, the title, the blank line and
  // g0..g21) — o / Enter open nothing for it (a drawer for a row the person cannot see), the walk restarts from the first row drawn
  Office({ ...p, offset: 6 }, f.surface)
  expect(f.surface.state!.inst.win).toEqual({ from: 0, count: 26 })
  f.key({ key: 'o' })
  f.key({ key: 'return' })
  expect(f.posts).toEqual([])
  f.key({ key: 'j' })
  expect(f.surface.state!.focus).toBe('g0')
  Office(p, f.surface)                                       // and down again: g0 is out; k restarts from the last drawn
  f.key({ key: 'o' })
  expect(f.posts).toEqual([])
  f.key({ key: 'k' })
  expect(f.surface.state!.focus).toBe('g40')
  expect(f.posts).toEqual([])
  f.key({ key: 'o' })
  expect(f.posts).toEqual([{ t: 'open', id: 'g40' }])
})

test('the row budget\'s cut: the cut card is drawn whole in the viewport — its more line under its title (live check 7) a live Button, its blank rows and the cards past the cut without one; the j / k walk and o keep to the rows drawn', () => {
  // 120 agents in A (its more line under its title on line 3, its rows from line 5, its card to line 127) and B after it (its
  // title on line 130): a 150-row pane at the top shows the whole office, the row budget cuts the rows at g<WINDOW_ROWS - 1>; A is
  // drawn whole (its lines past the cut are in the viewport), B is not drawn at all (its top is past the cut)
  const p = props({ rows: 150, rooms: [room('A', Array.from({ length: 120 }, (_, i) => ag(`g${i}`)), { moreDone: 2, moreLabel: 'עוד 2 שסיימו' }), room('B', [ag('b0'), ag('b1')])] })
  const m = officeModel(p)
  expect(m.rooms[0]).toMatchObject({ moreAt: 3, blankAt: 4, height: 128 })
  expect(m.rooms[1]).toMatchObject({ top: 128, titleAt: 130 })
  const f = fake(45, 0)
  const tree = Office(p, f.surface)
  expect(f.surface.state!.inst.win).toEqual({ from: 0, count: 5 + WINDOW_ROWS })   // (the viewport holds the whole office: the budget cuts it)
  expect(rowCount(p)).toBe(137)
  expect(cards(tree)).toHaveLength(1)
  expect(partsOf(cards(tree)[0]!).more).toBeDefined()
  expect(rowsOf(cards(tree)[0]!)).toHaveLength(WINDOW_ROWS)
  f.press(tree, 'more:A')                                               // A's more line, under its title: live
  expect(f.posts).toEqual([{ t: 'roomDone', room: 'A' }])
  // a row the budget left blank (g100, g105), B's pin and b0's row (B is past the cut: not drawn) — no Button for any
  for (const key of ['agent:g100:who', 'agent:g105:who', 'pin:B', 'more:B', 'agent:b0:who']) expect(() => f.press(tree, key), key).toThrow(/no Button/)
  expect(f.posts).toHaveLength(1)
  const last = `g${WINDOW_ROWS - 1}`
  f.press(tree, `agent:${last}:who`)                                    // the last row drawn
  expect(f.posts[1]).toEqual({ t: 'open', id: last })
  // the walk ends at the last row drawn; o opens it, never a blank row
  for (let i = 0; i < 130; i++) f.key({ key: 'j' })
  expect(f.surface.state!.focus).toBe(last)
  f.key({ key: 'o' })
  expect(f.posts[2]).toEqual({ t: 'open', id: last })
  expect(f.posts).toHaveLength(3)
})

test('search: the Input draws the typed text (not props.search) across props updates; the post is debounced; an outside change is adopted', () => {
  const f = fake()
  const p = withAgents(props(), many())   // (thirteen shown: the field is drawn)
  let tree = Office(p, f.surface)
  const input = () => nodes(tree).find(n => n.type === 'Input')!
  expect(input().props.value).toBe('')
  const onInput = input().props.onInput as (v: string) => void
  onInput('a')
  expect(f.posts).toEqual([{ t: 'search', q: 'a' }])   // the first keystroke of a search posts at once (under ONE_LINE_FROM the hooks size the chrome by it)
  expect(f.debounces()).toHaveLength(0)
  onInput('ab')
  onInput('abc')
  expect(f.posts).toHaveLength(1)
  expect(f.debounces()).toHaveLength(2)            // one debounce clock per further keystroke, the earlier one stopped
  expect(f.debounces()[0]!.stopped).toBe(true)
  expect(f.debounces()[1]!.ms).toBe(SEARCH_DEBOUNCE_MS)
  // a publish lands between keystrokes with the old search: the field keeps 'abc'
  tree = Office({ ...p, nowMin: p.nowMin + 1 }, f.surface)
  expect(input().props.value).toBe('abc')
  f.tick()
  expect(f.posts).toEqual([{ t: 'search', q: 'a' }, { t: 'search', q: 'abc' }])
  expect(f.debounces()[1]!.stopped).toBe(true)
  // the echo of our own post keeps the field; so does an echo of an older post while typing went on
  tree = Office({ ...p, search: 'abc' }, f.surface)
  expect(input().props.value).toBe('abc')
  ;(input().props.onInput as (v: string) => void)('abcd')
  tree = Office({ ...p, search: 'abc', nowMin: 5 }, f.surface)
  expect(input().props.value).toBe('abcd')
  f.tick()
  expect(f.posts[2]).toEqual({ t: 'search', q: 'abcd' })
  // Enter posts at once (no debounce left running)
  ;(input().props.onSubmit as (v: string) => void)('abcde')
  expect(f.posts[3]).toEqual({ t: 'search', q: 'abcde' })
  expect(f.debounces().every(t => t.stopped)).toBe(true)
  // an outside change (the hooks cleared the search) is adopted
  tree = Office({ ...p, search: 'abcde' }, f.surface)
  tree = Office({ ...p, search: '' }, f.surface)
  expect(input().props.value).toBe('')
  // the placeholder is the label (without the trailing ellipsis) behind the glass, as the probe writes it (`🔍 חיפוש סוכנים`:
  // the glass leading in both languages)
  expect(input().props.placeholder).toBe('🔍 חיפוש סוכנים')
  expect((nodes(Office({ ...p, rtl: false, lang: 'en', labels: LABELS_EN }, fake().surface)).find(n => n.type === 'Input')!.props as { placeholder: string }).placeholder).toBe('🔍 Search agents')
  // a pane too narrow for the words draws the first word alone, narrower still cuts it (whole glyphs, the ellipsis trailing), the
  // glass whole: never wider than the field holds by FIT
  const narrowPh = (q: Partial<OfficeProps>) => (nodes(Office(withAgents(props(q), many()), fake(q.columns).surface)).find(n => n.type === 'Input')!.props as { placeholder: string }).placeholder
  expect(narrowPh({ columns: pane(24) })).toBe('🔍 חיפוש סוכנים')                                      // 18 cells by FIT hold the 15
  expect(narrowPh({ columns: pane(16) })).toBe('🔍 חיפוש')                                              // 12: the first word
  expect(narrowPh({ columns: pane(16), rtl: false, lang: 'en', labels: LABELS_EN })).toBe('🔍 Search')
  expect(narrowPh({ columns: pane(8) })).toBe('🔍 חי…')                                                // 6: the word cut, the glass whole
  expect(narrowPh({ columns: pane(8), rtl: false, lang: 'en', labels: LABELS_EN })).toBe('🔍 Se…')
  for (const columns of [8, 12, 15, 16, 24, 45, 64, 200]) { expect(textWidth(narrowPh({ columns }))).toBeLessThanOrEqual(Math.max(4, fitCells(geometry(columns).W))); expect(textWidth(narrowPh({ columns, rtl: false, lang: 'en', labels: LABELS_EN }))).toBeLessThanOrEqual(Math.max(4, fitCells(geometry(columns).W))) }
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

test('the field follows the text typed into it (spec 2026-10-10 §2 item 22: an active search is text in the field): with text typed and not yet posted, a poll that drops the office to SEARCH_FROM agents keeps the field — and the six-row chrome under ONE_LINE_FROM — so nothing unmounts under the person\'s fingers; the first keystroke of a search posts at once (the hooks size the chrome by props.search), the next ones wait; cleared and posted, or cleared from outside, the field goes', () => {
  for (const columns of [45, 80]) {
    const at = `${columns}`
    const f = fake(columns)
    const thirteen = withAgents(props({ columns }), many())
    const twelve = withAgents(props({ columns }), many(SEARCH_FROM))
    const rows = columns < ONE_LINE_FROM ? CHROME_ROWS_SEARCH : CHROME_ROWS_MIN
    let tree = Office(thirteen, f.surface)
    const input = () => nodes(tree).find(n => n.type === 'Input')
    const type = (v: string) => (input()!.props.onInput as (v: string) => void)(v)
    expect(input(), at).toBeDefined()
    type('r')
    expect(f.posts, at).toEqual([{ t: 'search', q: 'r' }])   // at once
    type('re')
    type('res')
    expect(f.posts, at).toHaveLength(1)                       // debounced
    // the poll: twelve shown, props.search still '' — the field stays, the chrome as with the field, the module and the pure rule agreeing
    tree = Office(twelve, f.surface)
    expect(input(), at).toBeDefined()
    expect(input()!.props.value, at).toBe('res')
    expect(chromeOf(tree), at).toBe(rows)
    expect(f.surface.state!.inst.chrome, at).toBe(fixedRows(twelve, 'res'))
    expect(searchShown(twelve), at).toBe(false)
    expect(searchShown(twelve, 'res'), at).toBe(true)
    // the debounce lands and the hooks echo 'res': the field as before, in the same place of the tree (the same Input: no remount)
    f.tick()
    expect(f.posts[1], at).toEqual({ t: 'search', q: 'res' })
    tree = Office({ ...twelve, search: 'res' }, f.surface)
    expect(input()!.props.value, at).toBe('res')
    expect(chromeOf(tree), at).toBe(rows)
    // cleared: the post waits (the props still say 'res': the field is drawn); the echo of '' takes it away, with its line
    type('')
    expect(f.posts, at).toHaveLength(2)
    tree = Office({ ...twelve, search: 'res' }, f.surface)
    expect(input(), at).toBeDefined()
    expect(chromeOf(tree), at).toBe(rows)
    f.tick()
    expect(f.posts[2], at).toEqual({ t: 'search', q: '' })
    tree = Office({ ...twelve, search: '' }, f.surface)
    expect(input(), at).toBeUndefined()
    expect(chromeOf(tree), at).toBe(CHROME_ROWS_MIN)
    expect(f.surface.state!.inst.chrome, at).toBe(CHROME_ROWS_MIN)
    // a search cleared from outside (neither our post nor our text) takes the typed text and the field with it
    tree = Office(thirteen, f.surface)
    type('q')
    expect(f.posts[3], at).toEqual({ t: 'search', q: 'q' })
    tree = Office({ ...twelve, search: 'q' }, f.surface)
    expect(input(), at).toBeDefined()
    tree = Office({ ...twelve, search: '' }, f.surface)
    expect(input(), at).toBeUndefined()
    expect(f.surface.state!.inst.query, at).toBe('')
    // the first keystroke of a search posts at once; one after an outside clear too (the text was empty again)
    tree = Office(thirteen, f.surface)
    type('z')
    expect(f.posts[4], at).toEqual({ t: 'search', q: 'z' })
    type('zz')
    expect(f.posts, at).toHaveLength(5)
  }
})

test('THE HYSTERESIS is about the width (office-layout.ts ModeToken): a transient agent whose activity drops the word column at 51 (`🔌 claude-in-chrome`) gives it back the moment it leaves, as a fresh instance draws it; a ⭐ that widens the marks at 44 likewise, and the word is back when its window ends; a content change at a held width releases the hold; while the pane is dragged the two cells of hysteresis hold as before', () => {
  const base = [room('A', [ag('lead', { emoji: '💼', act: '🧠 חושב' }), ag('a1', { name: 'הקרטוגרף', model: 'Sonnet 4.5', act: '✏️ עורך' })])]
  const at = (columns: number, rooms: OfficeRoom[]) => props({ columns: pane(columns), rooms })
  let tree: unknown
  /** The columns of the one card: 5 with the word, 4 without. */
  const cols = () => columnsOf(cards(tree)[0]!).length
  // the transient agent at 51
  const f = fake(pane(51))
  tree = Office(at(51, base), f.surface)
  expect(officeModel(at(51, base)).mode.word).toBe(true)
  expect(cols()).toBe(5)
  const withChrome = [room('A', [...base[0]!.agents, ag('x', { act: '🔌 claude-in-chrome' })])]
  expect(officeModel(at(51, withChrome)).mode.word).toBe(false)
  tree = Office(at(51, withChrome), f.surface)
  expect(cols()).toBe(4)
  tree = Office(at(51, base), f.surface)
  expect(cols()).toBe(5)
  expect(f.surface.state!.inst.lastMode).toEqual(officeModel(at(51, base)).token)
  // the ⭐ at 44: the word's need is 30 cells (the mark 1), the budget fitCells(40) = 30 — a ⭐ (the mark 2) takes the word; its window over, the word is back
  const g = fake(pane(44))
  tree = Office(at(44, base), g.surface)
  expect(officeModel(at(44, base)).mode.word).toBe(true)
  expect(cols()).toBe(5)
  const starred = [room('A', base[0]!.agents.map(a => a.id === 'a1' ? { ...a, status: 'done' as const, act: '✅ סיים', star: 5 } : a))]
  expect(officeModel(at(44, starred)).mode.word).toBe(false)
  tree = Office(at(44, starred), g.surface)
  expect(cols()).toBe(4)
  const unstarred = [room('A', starred[0]!.agents.map(a => ({ ...a, star: 0 })))]
  tree = Office(at(44, unstarred), g.surface)
  expect(cols()).toBe(5)
  // the width: 43 drops the word (need 30 > fitCells(39) = 29), 44..46 hold it dropped (two cells to spare: 47), 47 regains it
  for (const [columns, n] of [[43, 4], [44, 4], [45, 4], [46, 4], [47, 5], [46, 5], [43, 4], [44, 4]] as const) {
    g.size(pane(columns), 0)
    tree = Office(at(columns, unstarred), g.surface)
    expect(cols(), `${columns}`).toBe(n)
  }
  // held at 44 without the word, a poll whose content moved the widest values (a name) draws the fresh mode: the word is back
  const renamed = [room('A', unstarred[0]!.agents.map(a => a.id === 'lead' ? { ...a, name: 'led' } : a))]
  expect(officeModel(at(44, renamed)).mode.word).toBe(true)
  tree = Office(at(44, renamed), g.surface)
  expect(cols()).toBe(5)
  // the same content again at the same width: the same mode (the token holds)
  tree = Office(at(44, renamed), g.surface)
  expect(cols()).toBe(5)
  expect(g.surface.state!.inst.lastMode).toEqual(officeModel(at(44, renamed)).token)
})

test('the settings popover on a narrow pane (the probe\'s): the two Buttons (no motion toggle since live check 7, Q9) in words whenever they fit the line by LINE_FIT of the whole column (`דמו 🎬 · 🌐 English`: 17 cells, from a 21-cell column), else the icons alone; the shortcut labels cut (by LINE_FIT, as the title is) to what the popover\'s inner width leaves after the widest key and the padding cell, so the keys are never clipped — at 32 a cut label beside a whole `o · Enter`, at 45, 51 and 80 nothing cut', () => {
  const table = (tree: unknown, i = 0) => (((byKey(tree, 'help')!.children as Node[])[2]!.children as Node[])[i]!.children as Node[])
  const labelsOf = (tree: unknown, i = 0) => cellsOf(table(tree, i)[0]!).map(n => texts(n))
  const keysOf = (tree: unknown, i = 0) => cellsOf(table(tree, i)[1]!).map(n => texts(n))
  const buttons = (tree: unknown) => ['demo', 'lang'].map(k => nodes(tree).find(n => n.type === 'Button' && n.props.key === k)!.props.label)
  const t32 = Office(props({ columns: pane(32), helpOpen: true }), fake(pane(32)).surface)
  expect(buttons(t32)).toEqual(['דמו 🎬', '🌐 English'])
  expect(nodes(t32).some(n => n.type === 'Button' && n.props.key === 'still')).toBe(false)
  expect(labelsFit(['דמו 🎬', '🌐 English'], 21)).toBe(true)
  expect(labelsFit(['דמו 🎬', '🌐 English'], 20)).toBe(false)
  expect(buttons(Office(props({ columns: pane(20), helpOpen: true }), fake(pane(20)).surface))).toEqual(['🎬', 'EN'])
  // while the demo runs the first is `יציאה ✕ 🎬` (10): the two (21) fit from a 26-cell column — under it the icons, the demo's keeping its ✕
  expect(buttons(Office(props({ columns: pane(25), helpOpen: true, demo: true }), fake(pane(25)).surface))).toEqual(['✕ 🎬', 'EN'])
  expect(buttons(Office(props({ columns: pane(26), helpOpen: true, demo: true }), fake(pane(26)).surface))).toEqual(['יציאה ✕ 🎬', '🌐 English'])
  // the shortcuts at 32: the room fitLine(28) = 23 cells, the keys 9 (`o · Enter`), the padding 1 — the labels 13 at most, cut with an ellipsis; the keys whole
  expect(fitLine(geometry(pane(32)).inner) - textWidth('o · Enter') - 1).toBe(13)
  const labels32 = labelsOf(t32)
  expect(labels32).toHaveLength(HELP.length)
  for (const l of labels32) expect(textWidth(l)).toBeLessThanOrEqual(13)
  expect(labels32[0]).toBe(nb(cut(LABELS.scFinished!, 13)))
  expect(labels32[0]).toMatch(/…$/)
  expect(labels32[3]).toBe(nb(LABELS.scClose!))   // 13 cells: whole
  expect(keysOf(t32)).toEqual(HELP.map(([, k]) => nb(k)))
  for (const l of [...labels32, ...keysOf(t32)]) expect(l).not.toContain(' ')
  // wider: nothing cut — the probe's labels whole (at 80 the two pairs within fitLine(74) - PAIRS_GAP = 57)
  for (const columns of [45, 51, 79, 80, 120]) {
    const t = Office(props({ columns: pane(columns), helpOpen: true }), fake(pane(columns)).surface)
    helpPairs(geometry(pane(columns)).wide).forEach((pair, i) => {
      expect(labelsOf(t, i), `${columns} pair ${i}`).toEqual(pair.map(([k]) => nb(LABELS[k] ?? k)))
      expect(keysOf(t, i), `${columns} pair ${i}`).toEqual(pair.map(([, k]) => nb(k)))
    })
  }
  // English at 32: the longest label (`Show / hide finished`, 20) cut beside the 9-cell key; at 45 whole (fitLine(41) = 34 - 10 = 24)
  const en32 = labelsOf(Office(props({ columns: pane(32), helpOpen: true, lang: 'en', rtl: false, labels: LABELS_EN }), fake(pane(32)).surface))
  expect(en32[0]).toBe(nb(cut(LABELS_EN.scFinished!, 13)))
  expect(labelsOf(Office(props({ columns: pane(45), helpOpen: true, lang: 'en', rtl: false, labels: LABELS_EN }), fake(pane(45)).surface))).toEqual(HELP.map(([k]) => nb(LABELS_EN[k]!)))
})

test('the drawer under DRAWER_NARROW_BELOW columns (the probe\'s): the task wraps to TASK_LINES_NARROW lines and the result to RESULT_LINES_NARROW — one fewer each — so the card is two rows shorter at 32 than at 34; the module\'s drawer and overlayHeight agree, the chrome is the same with or without it', () => {
  expect([TASK_LINES, RESULT_LINES, TASK_LINES_NARROW, RESULT_LINES_NARROW, DRAWER_NARROW_BELOW]).toEqual([4, 3, 3, 2, 34])
  expect(drawerLimits(33)).toEqual({ task: 3, result: 2 })
  expect(drawerLimits(34)).toEqual({ task: 4, result: 3 })
  expect(drawerLimits(200)).toEqual({ task: 4, result: 3 })
  const long = drawer({ task: 'word '.repeat(400), result: 'done '.repeat(400), truncated: true, sub: '' })
  for (const columns of [24, 32, 33, 34, 45, 120]) {
    const p = props({ columns, selected: 'lead', drawer: long })
    const inner = drawerInner(columns)
    const lines = drawerLines(long, LABELS, inner, drawerLimits(columns))
    const { task, result } = drawerLimits(columns)
    expect(lines.length, `${columns}`).toBe(drawerMax({ task, result }))   // (THE DRAWER'S ONE HEIGHT: 5 + task + 1 + result + 1, and the sub's line)
    expect(lines.filter(l => l.kind !== 'blank').length, `${columns}`).toBe(4 + task + 1 + result + 1)
    expect(lines.filter(l => l.kind === 'body').length, `${columns}`).toBe(1 + task + result)
    expect(overlayHeight(p), `${columns}`).toBe(DRAWER_FRAME_ROWS + lines.length)
    const tree = Office(p, fake(columns).surface)
    expect(byKey(tree, 'drawer')!.props.height, `${columns}`).toBe(DRAWER_FRAME_ROWS + lines.length)
    expect(overlayOf(tree), `${columns}`).toBe(byKey(tree, 'drawer'))
    expect(chromeOf(tree), `${columns}`).toBe(chromeRows(p))
    expect(chromeRows(p), `${columns}`).toBe(chromeRows({ ...p, drawer: null, selected: null }))
  }
  expect(overlayHeight(props({ columns: 34, selected: 'lead', drawer: long })) - overlayHeight(props({ columns: 33, selected: 'lead', drawer: long }))).toBe(2)
  // the default limits are the wide ones: drawerLines without them wraps as at 34
  expect(drawerLines(long, LABELS, drawerInner(45)).length).toBe(drawerLines(long, LABELS, drawerInner(45), drawerLimits(45)).length)
})

test('the drawer (a card in the cards\' style), the settings popover and the empty office draw from props and labels; Buttons post; no selection band — the selected row is flagged, not tinted', () => {
  const f = fake(pane(45))
  const p = props({ columns: pane(45), selected: 'lead', drawer: drawer({ result: 'found 3 docs', truncated: true }) })
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
  const inner45 = drawerInner(pane(45))
  expect(inner45).toBe(30)
  expect(t).toMatch(/^מודל 🧠 Opus 5\.5 · פעולה 🧠 ח…$/m)
  expect(t).toMatch(/^✂ התוצאה קוצרה — לפלט המלא פ…$/m)
  for (const l of drawerLines(p.drawer!, LABELS, inner45)) if (l.text) { expect(t).toContain(l.text); expect(textWidth(l.text)).toBeLessThanOrEqual(inner45) }
  // THE STATUS LINE: the mark (coloured) and the dim text as two Texts on one line, a blank line after it
  const statusLine = (box: Node) => (box.children as Node[])[2]!
  const drawerBox = byKey(tree, 'drawer')!
  expect((statusLine(drawerBox).children as Node[]).map(n => [n.type, n.props.color, n.props.dimColor, texts(n)])).toEqual([['Text', DOT_FG.running, undefined, '●'], ['Text', undefined, true, 'עובד · זמן 3 דק׳ · Explore']])
  expect((drawerBox.children as Node[])[3]).toMatchObject({ type: 'Box', props: { height: 1 } })
  expect(texts((drawerBox.children as Node[])[3])).toBe('')
  // (a 70-column drawer: its 46 cells hold the 34 of this line whole; a 45-column one cuts it to 27 with an ellipsis, as the probe's did)
  const failedBox = byKey(Office({ ...p, columns: pane(70), drawer: drawer({ status: 'done', failed: true, elapsedMin: 9, type: 'general-purpose' }) }, fake(pane(70)).surface), 'drawer')!
  expect((statusLine(failedBox).children as Node[]).map(n => texts(n))).toEqual(['❌', 'נכשל · משך 9 דק׳ · general-purpose'])
  expect((statusLine(byKey(Office({ ...p, drawer: drawer({ status: 'done', failed: true, elapsedMin: 9, type: 'general-purpose' }) }, fake().surface), 'drawer')!).children as Node[]).map(n => texts(n))).toEqual(['❌', 'נכשל · משך 9 דק׳ · general…'])
  expect((statusLine(failedBox).children as Node[])[0]!.props.color).toBe(DOT_FG.done)
  const wide = texts(Office({ ...p, columns: pane(70) }, fake(pane(70)).surface))
  expect(wide).toMatch(/^✂ התוצאה קוצרה — לפלט המלא פתחו את הטרמינל$/m)
  expect(wide).toMatch(/^מודל 🧠 Opus 5\.5 · פעולה 🧠 חושב$/m)
  expect(texts(Office({ ...p, drawer: drawer({ model: 'my-long-custom-model-20260101' }) }, fake().surface))).toMatch(/^מודל 🧠 my-long-custom-model-…$/m)
  const box = byKey(tree, 'drawer')!
  // (phase B: the card floats from the root — absolute at the window's top, on the theme's inverseText, the column's margin
  // and width — and takes no row of the flow: no margin under it)
  expect(box).toMatchObject({ props: { key: 'drawer', position: 'absolute', backgroundColor: 'inverseText', left: geometry(pane(45)).margin, width: geometry(pane(45)).W, flexDirection: 'column', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, paddingY: 1, overflow: 'hidden', alignItems: 'flex-end' } })
  expect(box.props.marginBottom).toBeUndefined()
  expect(overlayOf(tree)).toBe(box)
  // every line of the drawer is one row tall by construction; the card has a fixed height (the one height at the width)
  expect((box.children as Node[]).every(l => l.type === 'Box' && l.props.height === 1 && l.props.overflow === 'hidden')).toBe(true)
  expect(box.props.height).toBe(DRAWER_FRAME_ROWS + (box.children as Node[]).length)
  expect(box.props.height).toBe(overlayHeight(p))
  expect(chromeRows(p)).toBe(fixedRows(p))
  const close = nodes(tree).find(n => n.type === 'Button' && n.props.key === 'close')!
  expect(close.props.hotkey).toBe('x')
  // read ✕ THEN the word, as the toolbar's controls: the ✕ trails the Hebrew word in the string (iconLabel), leads the English one
  expect(close.props.label).toBe('סגירה ✕')
  expect((nodes(Office({ ...p, rtl: false, lang: 'en', labels: LABELS_EN }, fake().surface)).find(n => n.type === 'Button' && n.props.key === 'close')!.props as { label: string }).label).toBe('✕ Close')
  ;(close.props.onPress as () => void)()
  expect(f.posts).toEqual([{ t: 'close' }])
  // the selection: no band in the column, no flag in the view model (the open drawer says which agent is selected); the one
  // background in the tree is the floating card's
  expect(nodes(columnOf(tree)).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
  expect(nodes(tree).filter(n => typeof n.props.backgroundColor === 'string')).toEqual([box])
  // the settings popover: titled הגדרות, the rows, the ✕; it wins over the drawer
  tree = Office({ ...p, helpOpen: true }, f.surface)
  const helpBox = byKey(tree, 'help')!
  expect(helpBox).toMatchObject({ props: { key: 'help', position: 'absolute', backgroundColor: 'inverseText', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, paddingY: 1, height: helpRows(45) } })   // (the cards' padding, the drawer's too)
  expect(helpBox.props.marginBottom).toBeUndefined()
  expect(overlayOf(tree)).toBe(helpBox)
  expect(byKey(tree, 'drawer')).toBeUndefined()
  expect(nodes((helpBox.children as Node[])[0]).some(n => n.type === 'Text' && n.props.bold === true && texts(n) === 'הגדרות')).toBe(true)
  expect(texts(tree)).not.toMatch(/עזרה|קיצורי מקלדת/)
  expect(texts(tree)).toContain(nb('k / j'))
  // the close row promises x alone: Escape never reaches a Client (it returns the focus), so the popover does not offer it
  expect(HELP.find(([k]) => k === 'scClose')?.[1]).toBe('x')
  expect(HELP.find(([k]) => k === 'scSettings')?.[1]).toBe('h')
  expect(texts(tree)).not.toMatch(/Esc/)
  expect(texts(tree)).not.toMatch(/found 3 docs/)
  const closeHelp = nodes(tree).find(n => n.type === 'Button' && n.props.key === 'closeHelp')!
  ;(closeHelp.props.onPress as () => void)()
  expect(f.posts[1]).toEqual({ t: 'close' })   // (a close, never a flip — as the drawer's: live check 7, R9)
  expect(closeHelp.props).toMatchObject({ role: 'dismiss', hotkey: 'x', label: 'סגירה ✕' })
  // the toolbar, and the settings' own Buttons (the popover is open here)
  for (const [key, t2] of [['showDone', 'showDone'], ['mute', 'mute'], ['help', 'help'], ['demo', 'demo'], ['lang', 'lang']] as const) {
    const b = nodes(tree).find(n => n.type === 'Button' && n.props.key === key)!
    ;(b.props.onPress as () => void)()
    expect(f.posts[f.posts.length - 1]).toEqual(t2 === 'demo' ? { t: t2, on: true } : { t: t2 })   // (the demo's target: R7)
  }
  // the show-finished box: ☑ while the finished are shown — the pref alone, in the demo too (live check 5: the demo's cast obeys
  // it, where it once forced it on and the box seemed dead); its press flips the pref. (The icon trails the Hebrew word.)
  const doneBox = (q: OfficeProps) => nodes(Office(q, fake().surface)).find(n => n.type === 'Button' && n.props.key === 'showDone')!
  expect(doneBox(props()).props.label).toBe('הצג שסיימו ☐')
  expect(doneBox(props({ prefs: { showDone: true, muted: true } })).props.label).toBe('הצג שסיימו ☑')
  expect(doneBox(props({ demo: true })).props.label).toBe('הצג שסיימו ☐')
  expect(doneBox(props({ demo: true, prefs: { showDone: true, muted: true } })).props.label).toBe('הצג שסיימו ☑')
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
  expect(labelsOf(props({ prefs: { showDone: true, muted: false } }))).toEqual(['הצג שסיימו ☑', 'צליל 🔔', 'הגדרות ⚙️'])
  expect(labelsOf(props({ demo: true }))).toEqual(['הצג שסיימו ☐', 'צליל 🔕', 'הגדרות ⚙️'])   // (the demo obeys the pref: live check 5)
  expect(labelsOf(en({ columns: pane(51) }))).toEqual(['☐ Show finished', '🔕 Sound', '⚙️ Settings'])
  expect(labelsOf(en({ columns: pane(51), prefs: { showDone: true, muted: false } }))).toEqual(['☑ Show finished', '🔔 Sound', '⚙️ Settings'])
  // the words are the labels of i18n (LABEL_KEYS: tbDone, tbSound, tbSettings), each passing THE HEBREW RULE on its own
  for (const k of ['tbDone', 'tbSound', 'tbSettings']) { expect(LABELS[k]).toBeTruthy(); expect(hebrewRuleOk(LABELS[k]!)).toBe(true); expect(LABELS_EN[k]).toBeTruthy() }
  expect(labelsOf(props()).every(l => !REFUSED_RE.test(l))).toBe(true)
  // the words from the width where the three labels in their WIDEST states (☑, a cell wider than ☐: live check 7, J9 — a toggle
  // never switches the row's form) and their two gaps of TOOLBAR_GAP fit the line by LINE_FIT (Hebrew: 33 cells, so from 40
  // columns; English, 39: from 47), the icons alone under it — never a cut word. The probe's 51 columns draw the words.
  const wordsHe = ['הצג שסיימו ☐', 'צליל 🔕', 'הגדרות ⚙️']
  const wordsEn = ['☐ Show finished', '🔕 Sound', '⚙️ Settings']
  const need = (ls: string[]) => ls.reduce((n, l, i) => n + (i ? TOOLBAR_GAP : 0) + textWidth(l.replace('☐', '☑')), 0)
  expect(need(wordsHe)).toBe(33)
  expect(need(wordsEn)).toBe(39)
  expect(labelsOf(props({ columns: pane(51) }))).toEqual(wordsHe)
  for (let columns = 24; columns <= 200; columns++) {
    expect(labelsOf(props({ columns: pane(columns) })), `he ${columns}`).toEqual(fitLine(columns) >= need(wordsHe) ? wordsHe : ['☐', '🔕', '⚙️'])
    expect(labelsOf(en({ columns: pane(columns) })), `en ${columns}`).toEqual(fitLine(columns) >= need(wordsEn) ? wordsEn : ['☐', '🔕', '⚙️'])
  }
  expect(labelsOf(props({ columns: pane(39) }))).toEqual(['☐', '🔕', '⚙️'])
  expect(labelsOf(props({ columns: pane(40) }))).toEqual(wordsHe)
  expect(labelsOf(en({ columns: pane(46) }))).toEqual(['☐', '🔕', '⚙️'])
  expect(labelsOf(en({ columns: pane(47) }))).toEqual(wordsEn)
})

test('settings: the popover holds the demo and language Buttons in words (🎬 דמו / 🌐 English; ✕ יציאה while the demo runs) — no motion toggle (live check 7, Q9: nothing read it) — their hotkeys d / l from COMPACT_BELOW, then the shortcut rows (no s row) and the h row naming the settings; HELP_ROWS counts the Buttons row; closed, no such Button is drawn but d / l still post, s nothing', () => {
  const f = fake()
  const open = (over: Partial<OfficeProps> = {}) => props({ helpOpen: true, ...over })
  let tree = Office(open(), f.surface)
  const btn = (k: string, t: unknown = tree) => nodes(t).find(n => n.type === 'Button' && n.props.key === k)
  expect(btn('demo')?.props.label).toBe('דמו 🎬')
  expect(btn('still')).toBeUndefined()
  expect(btn('lang')?.props.label).toBe('🌐 English')
  // the Buttons row sits right under the title, inside the popover; the hotkeys only when wide (the desktop draws a chip per hotkey)
  const box = byKey(tree, 'help')!
  expect(box.props.height).toBe(helpRows(pane(45)))
  expect(helpRows(pane(45))).toBe(2 + 2 + 1 + 1 + HELP.length)   // the border, the padding line above and below, the title, the Buttons row, the shortcuts (one pair under WIDE_FROM)
  expect(HELP.map(([, keys]) => keys)).not.toContain('s')
  expect(HELP.map(([k]) => k)).not.toContain('scStill')
  expect(HELP.map(([k]) => k)).toContain('scSettings')
  expect(LABELS.scSettings).toBe('הגדרות')
  expect(texts(tree)).not.toMatch(/^s$/m)
  // the popover's children: the title line, the Buttons line, the shortcuts (one column-major pair here: a column of the labels, a column of the dim keys)
  const rows = box.children as Node[]
  expect(rows.length).toBe(3)
  expect(nodes(rows[1]).filter(n => n.type === 'Button').map(n => n.props.key)).toEqual(['demo', 'lang'])
  expect(nodes(rows[0]).filter(n => n.type === 'Button').map(n => n.props.key)).toEqual(['closeHelp'])
  const pairs = rows[2]!.children as Node[]
  expect(pairs).toHaveLength(1)
  expect(rows[2]).toMatchObject({ props: { flexDirection: 'row-reverse', columnGap: PAIRS_GAP, width: '100%' } })
  const [labelsCol, keysCol] = pairs[0]!.children as Node[]
  expect(labelsCol).toMatchObject({ props: { flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0, paddingLeft: 1 } })
  expect(keysCol).toMatchObject({ props: { flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 } })
  expect(cellsOf(labelsCol!).map(n => texts(n))).toEqual(HELP.map(([k]) => nb(LABELS[k]!)))
  expect(cellsOf(keysCol!).map(n => texts(n))).toEqual(HELP.map(([, keys]) => nb(keys)))
  expect(cellsOf(keysCol!).every(n => n.props.dimColor === true && n.props.color === undefined)).toBe(true)
  expect(cellsOf(labelsCol!).every(n => !texts(n).includes(' '))).toBe(true)
  for (const k of ['demo', 'lang']) expect(btn(k)?.props.hotkey).toBeUndefined()
  const wide = Office(open({ columns: pane(COMPACT_BELOW) }), fake(pane(COMPACT_BELOW)).surface)
  expect(['demo', 'lang'].map(k => btn(k, wide)?.props.hotkey)).toEqual(['d', 'l'])
  // their presses post
  for (const [k, t] of [['demo', 'demo'], ['lang', 'lang']] as const) {
    ;(btn(k)!.props.onPress as () => void)()
    expect(f.posts[f.posts.length - 1]).toEqual(t === 'demo' ? { t, on: true } : { t })   // (the demo's target: R7)
  }
  // the states: the demo on → ✕ יציאה with the clapper; English: the icon leads, the language Button names Hebrew
  expect(btn('demo', Office(open({ demo: true }), fake().surface))?.props.label).toBe('יציאה ✕ 🎬')
  const en = Office(open({ rtl: false, lang: 'en', labels: LABELS_EN }), fake().surface)
  expect(['demo', 'lang'].map(k => btn(k, en)?.props.label)).toEqual(['🎬 Demo', '🌐 עברית'])
  expect(btn('demo', Office(open({ rtl: false, lang: 'en', labels: LABELS_EN, demo: true }), fake().surface))?.props.label).toBe('🎬 ✕ Exit')
  // narrow: when the two words do not fit by LINE_FIT, the icons alone — the language as EN / עב
  const narrow = Office(open({ columns: pane(20) }), fake(pane(20)).surface)
  expect(['demo', 'lang'].map(k => btn(k, narrow)?.props.label)).toEqual(['🎬', 'EN'])
  expect(['demo', 'lang'].map(k => btn(k, Office(open({ columns: pane(18), rtl: false, lang: 'en', labels: LABELS_EN }), fake(pane(18)).surface))?.props.label)).toEqual(['🎬', 'עב'])
  // ...and the icons alone keep their states, as the toolbar's ☑ / 🔕 do: the demo running is `🎬 ✕` (the pair reversed for the
  // Hebrew reader, the 🎬 at the right edge as in the worded label)
  expect(['demo', 'lang'].map(k => btn(k, Office(open({ columns: pane(20), demo: true }), fake(pane(20)).surface))?.props.label)).toEqual(['✕ 🎬', 'EN'])
  expect(['demo', 'lang'].map(k => btn(k, Office(open({ columns: pane(18), demo: true, rtl: false, lang: 'en', labels: LABELS_EN }), fake(pane(18)).surface))?.props.label)).toEqual(['🎬 ✕', 'עב'])
  expect(['demo', 'lang'].map(k => btn(k, Office(open({ columns: pane(36) }), fake(pane(36)).surface))?.props.label)).toEqual(['דמו 🎬', '🌐 English'])
  // the popover closed: no demo / lang Button anywhere, and the letters still post; s nothing
  const g = fake()
  tree = Office(props(), g.surface)
  for (const k of ['demo', 'still', 'lang']) expect(btn(k)).toBeUndefined()
  for (const [k, t] of [['d', 'demo'], ['l', 'lang']] as const) {
    g.key({ key: k })
    expect(g.posts[g.posts.length - 1]).toEqual(t === 'demo' ? { t, on: true } : { t })   // (the demo's target: R7)
  }
  g.key({ key: 's' })
  expect(g.posts).toHaveLength(2)
})

// (a few thousand renders: a loaded machine stretches the suite tenfold — the 5 s default timeout would fail it with no code change)
test('header: one bold Text of the counts in words (`🎭 עובדים 2 · סיימו 0`; else the icons, the probe\'s `🎭 🟢2 ✅0`) at the reading edge, the five-hour meter dim at the other — THE LABEL LADDER, what gives way as the pane narrows: the full label (bar and reset clock, from WIDE_FROM, when the whole line fits by LINE_FIT) → the header\'s words → the short form (in the header, else at the search line\'s far edge with the field drawn under ONE_LINE_FROM) → the tiny `⏳ 42%` → nothing; so the words give way to the icons BEFORE the short meter is lost, and the probe\'s office keeps `⏳ 5h 6%` at every width from 28 and `⏳ 6%` from 25', { timeoutMs: 30_000 }, () => {
  const R = new Date(2026, 9, 10, 14, 30).toISOString() // (a local wall-clock time: reads back as 14:30 in any zone)
  const u = { pct: 42.4, resetsAt: R }
  /** The header's two Texts — the counts and the meter ('' when none) — and the search line's meter ('' when none, or no line). */
  const header = (columns: number, over: Partial<OfficeProps> = {}): [string, string, string] => {
    const tree = Office(props({ columns: pane(columns), ...over }), fake(pane(columns)).surface)
    const ts = byKey(tree, 'header')!.children as Node[]
    const sl = byKey(tree, 'searchLine')
    const slm = sl ? (sl.children as Node[]).filter(n => n.type === 'Text') : []
    return [texts(ts[0]), ts[1] ? texts(ts[1]) : '', slm[0] ? texts(slm[0]) : '']
  }
  const full = usageLabel(u, 'he', 100)
  const short = usageShort(u)
  // a wide pane: the full label, the bar included, the clock last
  expect(header(120, { usage: u })).toEqual(['🎭 עובדים 2 · סיימו 0', full, ''])
  expect(full).toContain('⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30')
  expect(header(120, { usage: { pct: 85, resetsAt: R }, lang: 'en', labels: LABELS_EN, rtl: false })).toEqual(['🎭 2 working · 0 finished', '⚠ 5h ▰▰▰▰▰▰▰▰▰▱ 85% · 14:30', ''])
  // no reset time: the label without its clock part
  expect(header(120, { usage: { pct: 42, resetsAt: '' } })[1]).toBe('⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42%')
  // under WIDE_FROM: the short form, no bar, no clock (the probe's round 8: the full meter from 80)
  expect(header(WIDE_FROM - 1, { usage: u })[1]).toBe(short)
  expect(header(WIDE_FROM, { usage: u })[1]).toBe(full)
  expect(header(COMPACT_BELOW, { usage: u })[1]).toBe(short)
  expect(header(45, { usage: { pct: 80, resetsAt: R } })[1]).toBe('⚠ 5h 80%')
  // narrower: the words go to the icons so the short meter keeps its place (21 + 1 + 9 = 31 > 28 = L(34); the icons' 10 + 1 + 9 = 20)
  expect(header(34, { usage: u })).toEqual(['🎭 🟢2 ✅0', short, ''])
  expect(header(34, { usage: null })[0]).toBe('🎭 עובדים 2 · סיימו 0')   // (no meter to keep: the words, which fit alone)
  // crowded counts (the icons 18 cells): the icons with the tiny form (18 + 1 + 9 = 28 > 25 = L(31); 18 + 1 + 6 = 25), then nothing (25 > 24 = L(30))
  expect(usageTiny(u)).toBe('⏳ 42%')
  expect(textWidth('🎭 🟢12 ⏳30 ✅120')).toBe(18)
  expect(header(31, { usage: u, counts: { run: 12, idle: 30, done: 120 } })).toEqual(['🎭 🟢12 ⏳30 ✅120', '⏳ 42%', ''])
  expect(header(30, { usage: u, counts: { run: 12, idle: 30, done: 120 } })).toEqual(['🎭 🟢12 ⏳30 ✅120', '', ''])
  // no reading: no meter at any width, the words whenever they fit alone
  for (const columns of [24, 45, 59, 60, 90, 200]) expect(header(columns, { usage: null })[1]).toBe('')
  expect(header(24, { usage: null })[0]).toBe('🎭 🟢2 ✅0')
  // the probe's header at the probe's width: the words and the short meter both drawn
  expect(header(51, { counts: { run: 4, idle: 1, done: 3 }, usage: { pct: 6, resetsAt: '' } })).toEqual(['🎭 עובדים 4 · ממתינים 1 · סיימו 3', '⏳ 5h 6%', ''])
  // the idle count only when there is one; English the number first; the icons a space apart (the probe's)
  expect(header(120, { counts: { run: 2, idle: 3, done: 12 } })[0]).toBe('🎭 עובדים 2 · ממתינים 3 · סיימו 12')
  expect(header(120, { counts: { run: 2, idle: 3, done: 12 }, lang: 'en', labels: LABELS_EN, rtl: false })[0]).toBe('🎭 2 working · 3 idle · 12 finished')
  expect(header(24, { counts: { run: 2, idle: 3, done: 12 } })[0]).toBe('🎭 🟢2 ⏳3 ✅12')
  // THE PROBE'S OFFICE (its counts' widths — 6/1/5 here: twelve in the office, no search line, decided by the office's agents
  // since live check 7 — usage 6%) dragged from 52 to 24 — the meter whole at every width from 25: `⏳ 5h 6%` beside the words
  // from 51 (33 + 1 + 8 = 42 = L(51)), beside the icons `🎭 🟢6 ⏳1 ✅5` from 28 to 50 (14 + 1 + 8 = 23 = L(28)), `⏳ 6%` at 25..27
  // (20 = L(25)), none at 24 (L 19)
  const probe = { counts: { run: 7, idle: 1, done: 5 }, usage: { pct: 6, resetsAt: '' } }
  const probeWords = '🎭 עובדים 7 · ממתינים 1 · סיימו 5'
  const probeIcons = '🎭 🟢7 ⏳1 ✅5'
  expect([textWidth(probeWords), textWidth(probeIcons)]).toEqual([33, 14])
  const twelveIn = { ...probe, counts: { run: 6, idle: 1, done: 5 } }
  const twelveWords = probeWords.replace('7', '6')
  const twelveIcons = probeIcons.replace('7', '6')
  for (let columns = 24; columns <= 52; columns++) {
    const at = `probe ${columns}`
    const [c, m, s] = header(columns, twelveIn)
    expect(s, at).toBe('')
    if (columns >= 51) expect([c, m], at).toEqual([twelveWords, '⏳ 5h 6%'])
    else if (columns >= 28) expect([c, m], at).toEqual([twelveIcons, '⏳ 5h 6%'])
    else if (columns >= 25) expect([c, m], at).toEqual([twelveIcons, '⏳ 6%'])
    else expect([c, m], at).toEqual([twelveIcons, ''])
  }
  // with the search line (the probe's own thirteen in the office, under ONE_LINE_FROM): the words stay and the short meter rides the
  // search line's far edge where the header has no room for it beside them (40..50: 15 + 2 + 8 = 25 ≤ L); under 40 the words
  // no longer fit alone, so the icons take the short meter in the header as above
  const probeMany = { ...probe, rooms: [room('A', many())] }
  for (let columns = 24; columns <= ONE_LINE_FROM - 1; columns++) {
    const at = `probe + field ${columns}`
    const [c, m, s] = header(columns, probeMany)
    if (columns >= 51) expect([c, m, s], at).toEqual([probeWords, '⏳ 5h 6%', ''])
    else if (columns >= 40) expect([c, m, s], at).toEqual([probeWords, '', '⏳ 5h 6%'])
    else if (columns >= 28) expect([c, m, s], at).toEqual([probeIcons, '⏳ 5h 6%', ''])
    else if (columns >= 25) expect([c, m, s], at).toEqual([probeIcons, '⏳ 6%', ''])
    else expect([c, m, s], at).toEqual([probeIcons, '', ''])
  }
  // counts 12/3/14 with the field (the second scenario of the review): the short meter in the header from 31 to 42, on the
  // search line from 43 (the words fit alone from there), `⏳ 6%` at 27..30
  const twelve = { counts: { run: 12, idle: 3, done: 14 }, usage: { pct: 6, resetsAt: '' }, rooms: [room('A', many())] }
  for (let columns = 27; columns <= 50; columns++) {
    const [, m, s] = header(columns, twelve)
    expect([m, s], `12/3/14 ${columns}`).toEqual(columns >= 43 ? ['', '⏳ 5h 6%'] : columns >= 31 ? ['⏳ 5h 6%', ''] : ['⏳ 6%', ''])
  }
  // every width, several counts, two readings, with and without the field: the counts and the meter fit the line by LINE_FIT,
  // hold no refused character, and the meter is whole or absent (never a `5h` or a percent cut in half); the ladder restated —
  // the richest pair of (counts, meter) that fits: the words with the full (from WIDE_FROM), the short, or the short on the
  // search line; else the icons with one of those; else the words, else the icons, with the tiny; else the counts alone (the
  // words when they fit alone: the icons are the floor — a 24-column pane with three-digit counts clips them, the height-1 Box
  // keeping them one line)
  const countSets = [{ run: 2, idle: 0, done: 0 }, { run: 2, idle: 3, done: 12 }, { run: 12, idle: 30, done: 120 }]
  const readings = [u, { pct: 100, resetsAt: R }]
  const PH = textWidth('🔍 חיפוש סוכנים')
  expect(PH).toBe(15)
  for (const field of [false, true]) {
    for (const counts of countSets) {
      for (const reading of readings) {
        const fullOf = usageLabel(reading, 'he', 100)
        const shortOf = usageShort(reading)
        const tinyOf = usageTiny(reading)
        const wordsOf = `🎭 עובדים ${counts.run}${counts.idle ? ` · ממתינים ${counts.idle}` : ''} · סיימו ${counts.done}`
        const iconsOf = `🎭 🟢${counts.run}${counts.idle ? ` ⏳${counts.idle}` : ''} ✅${counts.done}`
        for (let columns = 24; columns <= 200; columns++) {
          const at = `${JSON.stringify(counts)}, ${reading.pct}%, ${columns} columns${field ? ', the field' : ''}`
          const L = geometry(pane(columns)).L   // (the line is the reading column's: 100 cells at most)
          const [c, m, s] = header(columns, { counts, usage: reading, ...(field ? { search: 'x' } : {}) })
          // (the field: a search active, or the office's agents — its counts — more than SEARCH_FROM: live check 7, Q1)
          const hasField = field || counts.run + counts.idle + counts.done > SEARCH_FROM
          expect(c, at).not.toMatch(REFUSED_RE)
          expect([wordsOf, iconsOf], at).toContain(c)
          expect(['', tinyOf, shortOf, fullOf], at).toContain(m)
          expect(['', shortOf], at).toContain(s)
          expect(m === '' || s === '', at).toBe(true)
          if (m) expect(textWidth(c) + 1 + textWidth(m), at).toBeLessThanOrEqual(L)
          if (s) { expect(hasField && columns < ONE_LINE_FROM, at).toBe(true); expect(textWidth(c), at).toBeLessThanOrEqual(L) }
          if (m === fullOf) expect(columns, `${at}: the bar`).toBeGreaterThanOrEqual(WIDE_FROM)
          if (c === wordsOf) expect(textWidth(c), at).toBeLessThanOrEqual(L)
          const w = (meter: string) => textWidth(wordsOf) + 1 + textWidth(meter) <= L
          const i = (meter: string) => textWidth(iconsOf) + 1 + textWidth(meter) <= L
          const line = hasField && columns < ONE_LINE_FROM && PH + 2 + textWidth(shortOf) <= L
          const expected =
            columns >= WIDE_FROM && w(fullOf) ? [wordsOf, fullOf, '']
            : w(shortOf) ? [wordsOf, shortOf, '']
            : line && textWidth(wordsOf) <= L ? [wordsOf, '', shortOf]
            : columns >= WIDE_FROM && i(fullOf) ? [iconsOf, fullOf, '']
            : i(shortOf) ? [iconsOf, shortOf, '']
            : line ? [iconsOf, '', shortOf]
            : w(tinyOf) ? [wordsOf, tinyOf, '']
            : i(tinyOf) ? [iconsOf, tinyOf, '']
            : [textWidth(wordsOf) <= L ? wordsOf : iconsOf, '', '']
          expect([c, m, s], at).toEqual(expected)
        }
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
  // a throw after a good render drops the drawn window: the keyboard walk finds no row; the pointer's leave — the one event read —
  // is harmless
  const good = Office(props(), f.surface)
  f.press(good, 'agent:lead:who')
  expect(f.posts).toEqual([{ t: 'open', id: 'lead' }])
  Office(broken, f.surface)
  expect(f.surface.state!.inst.win).toEqual({ from: 0, count: 0 })
  f.key({ key: 'j' })
  f.key({ key: 'o' })
  f.pointer({ type: 'leave', x: 0, y: 0 })
  expect(f.posts).toHaveLength(1)
  expect(f.surface.state!.focus).toBe('lead')
  expect('hoverRoom' in f.surface.state!).toBe(false)
})

/** The dearest tasks a row can carry (uncut: the module's own guard, office-layout.ts cutTask, bounds them): a ZWJ family emoji task (eleven code units a glyph), a letter under ninety combining marks, a 24-cell Hebrew task. */
const DEAR_TASKS = ['👨‍👩‍👧‍👦'.repeat(13), 'a' + String.fromCharCode(0x301).repeat(90), 'תכנון המעבר לרישום הסטטי של המשרד כולו']
/** The 200-agent office of the limits sweeps: every status, the badges, a star every seventh, the models cycling, the dearest tasks among them. */
function crowd(): OfficeAgent[] {
  return Array.from({ length: 200 }, (_, i) => ag(`agent-${i}`, { name: `סוכן ${i}`, act: i % 3 ? '📖 קורא' : '✍️ כותב', star: i % 7 === 0 ? 1 : 0, failed: i % 11 === 0, longRunning: i % 5 === 0, status: i % 4 === 0 ? 'done' : 'running', model: ['Opus 5.5', 'Sonnet 4.5', 'Haiku 4.5', 'Fable 5.1', '?'][i % 5]!, ...(i % 13 < 3 ? { task: DEAR_TASKS[i % 13]! } : {}) }))
}

// (a few dozen renders of 200 agents, each serialized and walked: a loaded machine stretches the suite tenfold)
test('limits: 200 agents with the drawer open — in 3 rooms and in 200 rooms — at widths 24..250 and in the tall panes (200 × 80, 200 × 150) stay under 20,000 nodes, 32 deep, 100,000 characters, with no bidi marks; the rows drawn never pass WINDOW_ROWS; a drawn row — focused too — costs under ROW_CHARS; nothing of the column laid on a background (the floating drawer\'s inverseText the tree\'s one)', { timeoutMs: 60_000 }, () => {
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
      for (let i = 0; i < (cols[0]?.length ?? 0); i++) maxRowChars = Math.max(maxRowChars, cols.reduce((n, col) => n + JSON.stringify(col[i]).length, 0))
      // the task column's cells (from CENTRE_AT, the last of six) within TASK_UNITS: the dearest tasks bounded in code units
      if (cols.length === 6) for (const cell of cols[5]!) expect(texts(cell).length).toBeLessThanOrEqual(TASK_UNITS)
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
        // the window keeps its row budget: past it the rows are left blank rather than unmounting the instance (the overscan
        // draws a body on each side of the window: three bodies of rows at most, the budget the cap)
        const drawnRows = cards(tree).reduce((n, c) => n + rowsOf(c).length, 0)
        const m = officeModel(p)
        expect(drawnRows).toBeLessThanOrEqual(WINDOW_ROWS)
        expect(drawnRows).toBeLessThanOrEqual(rows + 2 * overscanOf(m.lines.length, rows))
        const { from, count } = f.surface.state!.inst.win
        expect(drawnRows).toBe(m.lines.slice(from, from + count).filter(l => l.kind === 'row').length)
        if (rooms === three && columns === 200 && offset === 20) expect(drawnRows).toBe(WINDOW_ROWS)   // (80 or 150 rows with their overscan: past the budget)
        rowChars(tree)
        // the dearest rows: the first focused — the tree still under the bound, a row still under ROW_CHARS (the premise of
        // WINDOW_ROWS); and nothing of the office laid on a background (live check 6: no tint, no band, on any theme)
        const st = f.surface.state!
        f.surface.setState({ ...st, focus: m.lines.slice(from, from + count).find(l => l.kind === 'row')?.agent ?? null })
        const lit = Office(p, f.surface)
        const litJson = JSON.stringify(lit)
        maxJson = Math.max(maxJson, litJson.length)
        expect(litJson.length).toBeLessThan(100_000)
        // (the column lays no background; the floating drawer's inverseText is the tree's one)
        expect(nodes(columnOf(lit)).filter(n => n.props.backgroundColor !== undefined)).toEqual([])
        expect(nodes(columnOf(tree)).filter(n => n.props.backgroundColor !== undefined)).toEqual([])
        expect(nodes(tree).filter(n => n.props.backgroundColor !== undefined)).toEqual([overlayOf(tree)])
        rowChars(lit)
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

/** THE RENDER COST's bounds (office-client.tsx): the columns of the mode, six at most (status, who, model, the activity's emoji and word, the task). */
const ROW_TEXTS = 6
/** What a drawn row costs the desktop (decision 26): the status mark's Text, then a plain Button with its one Text child per value column — 2 × ROW_TEXTS - 1 at most (9 under CENTRE_AT, 11 with the task column). */
const ROW_NODES = 2 * ROW_TEXTS - 1
/** A card around its rows: the card, the title line (its Box, the pin Button, the title Box and Text, the counts Box and Text), the blank line (a Box), the table block (a column Box, two spacers, the table), six columns, the more line (Box, Button). */
const CARD_NODES = 1 + 6 + 1 + 4 + 6 + 2
/** The Boxes of a card around its rows: the card, the title line and its two Boxes, the blank line, the block and two spacers, the table, six columns, the more line. */
const CARD_BOXES = 1 + 3 + 1 + 3 + 1 + 6 + 1

test('THE RENDER COST (the regression guard no load can flake): a drawn row costs the desktop the mark\'s Text and a Button-with-Text pair per value column (ROW_NODES at most) and NO Box, a card at most CARD_NODES nodes (CARD_BOXES Boxes) around its rows, the whole tree ROW_NODES × WINDOW_ROWS plus the cards, the chrome and the overlay at the biggest window; and THE ROOM MEMO — a redraw measures only the rooms whose props or width changed, a decor change none', () => {
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
      // a row: the mark's Text, then a Button with one Text per value column, no Box; a column: its rows' cells and nothing else
      for (const col of cols) expect(col.children.length, at).toBe(n)
      for (const [k, col] of cols.entries()) expect((col.children as Node[]).every(c => (k === 0 ? c.type === 'Text' && c.props.wrap === 'truncate' : c.type === 'Button' && c.children.length === 1 && (c.children[0] as Node).type === 'Text' && (c.children[0] as Node).props.wrap === 'truncate')), at).toBe(true)
      const all = nodes(card)
      expect(cols.length, at).toBeLessThanOrEqual(ROW_TEXTS)
      expect(all.filter(x => x.type === 'Box').length, at).toBeLessThanOrEqual(CARD_BOXES)
      expect(all.length, at).toBeLessThanOrEqual(CARD_NODES + n * (2 * cols.length - 1))
      expect(all.filter(x => x.type === 'Text').length, at).toBeLessThanOrEqual(2 + n * cols.length)   // the title, the counts (the pin and the more line are Buttons)
    }
    expect(rowsDrawn, at).toBeLessThanOrEqual(WINDOW_ROWS)
    // the whole tree: the root, the chrome (the header, the toolbar, the search), the floating drawer's lines and the cards
    const ov = overlayOf(tree)
    const chromeNodes = kidsOf(tree).filter(k => !cards(tree).includes(k)).reduce((s, k) => s + nodes(k).length, 0) + (ov ? nodes(ov).length : 0)
    expect(nodes(tree).length, at).toBeLessThanOrEqual(2 + chromeNodes + cards(tree).length * CARD_NODES + rowsDrawn * ROW_NODES)
    expect(chromeNodes, at).toBeLessThan(120)
  }
  // the biggest window: WINDOW_ROWS rows of their cells, three cards, the chrome, the drawer — nothing else
  const f = fake(200, 0)
  const p = props({ columns: 200, rows: 150, offset: 20, rooms: three, selected: 'agent-3', drawer: d })
  const tree = Office(p, f.surface)
  expect(cards(tree).reduce((n, c) => n + rowsOf(c).length, 0)).toBe(WINDOW_ROWS)
  expect(nodes(tree).filter(n => n.type === 'Box').length).toBeLessThan(3 * CARD_BOXES + 60)
  expect(nodes(tree).length).toBeLessThan(WINDOW_ROWS * ROW_NODES + 3 * CARD_NODES + 120)
  // THE ROOM MEMO: the first render measured each room once (the instance's model, then the render's: the same props hit the memo)
  const cache = f.surface.state!.inst.cache
  expect(cache.builds).toBe(3)
  expect([...cache.rooms.keys()]).toEqual(['A', 'B', 'C'])
  // a decor change (the keyboard focus): nothing measured again
  f.surface.setState({ ...f.surface.state!, focus: 'agent-90' })
  Office(p, f.surface)
  expect(cache.builds).toBe(3)
  // a poll's props (a new object, equal JSON): nothing; the clock alone (nowMin), the offset, the drawer: nothing of the rooms
  Office(JSON.parse(JSON.stringify(p)) as OfficeProps, f.surface)
  Office({ ...p, nowMin: p.nowMin + 1, offset: 40, drawer: drawer({ id: 'agent-90' }), selected: 'agent-90' }, f.surface)
  expect(cache.builds).toBe(3)
  // one room's agent changes its activity: that room alone
  const q = { ...p, rooms: three.map(r => r.id === 'B' ? { ...r, agents: r.agents.map(a => a.id === 'agent-90' ? { ...a, act: '🔎 מחפש קוד' } : a) } : r) }
  Office(q, f.surface)
  expect(cache.builds).toBe(4)
  // a resize inside the frozen column (200 → 120: the reading column is 100 cells either way): nothing; out of it (90): every room
  // (the mode and the title cut follow the width)
  Office({ ...q, columns: 120 }, f.surface)
  expect(cache.builds).toBe(4)
  Office({ ...q, columns: 90 }, f.surface)
  expect(cache.builds).toBe(7)
  // a room gone (a search): dropped; back: measured again
  Office({ ...q, columns: 90, rooms: q.rooms.filter(r => r.id !== 'C') }, f.surface)
  expect([...cache.rooms.keys()]).toEqual(['A', 'B'])
  Office({ ...q, columns: 90 }, f.surface)
  expect(cache.builds).toBe(8)
})

// ---------------------------------------------------------------------------
// the width (probe rounds 8-9)
// ---------------------------------------------------------------------------

test('THE LINE COUNTS (probe rounds 8-9): at every width 24..200, narrowing and then widening on ONE instance (the hysteresis riding in it), both directions, with and without the drawer — the chrome\'s rows add up to chromeRows and the first card starts there, every card is its line map (the title, a text-free blank line, a Text per column per row and no Box, the more line under the title), NO Text of a card holds a plain space; the mode changes words and columns and never a line\'s position (the same line shape at a width whichever way it was reached); narrowing draws the fresh mode, widening never a richer one', { timeoutMs: 120_000 }, () => {
  const rooms = [
    room('A', [ag('lead', { emoji: '💼', act: '🧠 חושב' }), ag('a1', { name: 'הקרטוגרף', model: 'Sonnet 4.5', act: '🔎 מחפש קוד' }), ag('d1', { status: 'done', act: '✅ סיים', star: 7 })], { moreDone: 2, moreLabel: 'עוד 2 שסיימו' }),
    room('B', [ag('b1', { status: 'stale', act: '💤 ממתין' }), ag('b2', { failed: true, status: 'done', act: '✅ סיים' }), ag('b3', { longRunning: true })], { title: 'Plan the static-registry move and the v2 config rollout', pinned: true }),
    room('C', many(8).map(a => ({ ...a, name: 'הצב' })), { title: 'בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל' }),
  ]   // (fourteen shown: the search field drawn)
  const w = officeWidest(rooms)
  for (const withDrawer of [false, true]) {
    for (const rtl of [true, false]) {
      const f = fake(200, 0)
      const shapes = new Map<number, string>()
      const ranks: Record<'down' | 'up', number[]> = { down: [], up: [] }
      const sweep = (dir: 'down' | 'up') => {
        for (let i = 0; i <= 176; i++) {
          const columns = dir === 'down' ? 200 - i : 24 + i
          f.size(columns, 0)
          const p = props({ columns, rtl, rooms, rows: 80, ...(withDrawer ? { selected: 'a1', drawer: drawer({ id: 'a1' }) } : {}) })
          // (the model the instance will draw: the mode from the rank it kept — the hysteresis — not the fresh one)
          const before = f.surface.state?.inst.lastMode ?? null
          const m = officeModel(p, NO_DECOR, undefined, before)
          const rowOf = (i: number, k: number) => { const r = m.rooms[i]!.rows[k]!; return [r.status, r.who, ...(m.mode.model !== 'none' ? [r.model] : []), r.actEmoji, ...(m.mode.word ? [r.actWord] : []), ...(m.geo.centred ? [r.task] : [])] }
          const tree = Office(p, f.surface)
          const at = `${dir} ${columns} ${rtl ? 'rtl' : 'ltr'}${withDrawer ? ' drawer' : ''}`
          expect(chromeOf(tree), at).toBe(chromeRows(p))
          expect(f.surface.state!.inst.lastMode, at).toEqual(m.token)
          const cs = cards(tree)
          expect(cs.length, at).toBe(3)
          cs.forEach((card, i) => {
            const { title, blank, more } = partsOf(card)
            expect(title.props.height, at).toBe(1)
            expect(blank, at).toEqual({ type: 'Box', props: { height: 1 }, children: [] })
            const rm = m.rooms[i]!
            expect(rowsOf(card).length, at).toBe(rm.rows.length)
            if (rm.more) { expect(more, at).toMatchObject({ props: { height: 1 } }); expect(more!.props.marginTop, at).toBeUndefined() }
            else expect(more, at).toBeUndefined()
            for (const [k, col] of columnsOf(card).entries()) expect((col.children as Node[]).every(c => c.type === (k === 0 ? 'Text' : 'Button')), at).toBe(true)
            for (const n of nodes(card)) if (n.type === 'Text') expect(texts(n), at).not.toContain(' ')
            rowsOf(card).forEach((r, k) => expect(r, `${at} ${rm.id} row ${k}`).toEqual(rowOf(i, k)))
          })
          // the line shape: the column's props, its children's keys and heights, every card's parts' heights and margins — never the columns
          const root = columnOf(tree)
          const shape = JSON.stringify([
            [root.props.width, root.props.marginLeft],
            kidsOf(tree).map(n => [kindOf(n), n.props.height, n.props.marginTop, n.props.marginBottom]),
            cs.map(c => (c.children as Node[]).map(k => [k.props.height, k.props.marginTop])),
          ])
          if (dir === 'down') shapes.set(columns, shape)
          else expect(shape, at).toBe(shapes.get(columns))
          ranks[dir][columns] = f.surface.state!.inst.lastMode?.rank ?? -1
        }
      }
      sweep('down')
      sweep('up')
      for (let c = 24; c <= 200; c++) {
        expect(ranks.down[c], `${c} ${rtl} ${withDrawer}`).toBe(chooseMode(w, geometry(c), null).rank)
        expect(ranks.up[c]!, `${c} ${rtl} ${withDrawer}`).toBeGreaterThanOrEqual(ranks.down[c]!)
      }
      expect(new Set(ranks.down).size).toBeGreaterThan(2)   // the sweep crossed thresholds
      expect(ranks.up.some((r, c) => r > ranks.down[c]!)).toBe(true)   // ... and the hysteresis held a poorer mode somewhere on the way up
    }
  }
})

test('THE READING COLUMN (probe round 8; live check 6): the root holds the column — the pane less a cell at each edge (PANE_GUTTER: no card border ever touches the pane\'s edge), frozen at 100 cells and centred by a left margin — and the floating overlay, laid at the same margin and width; the card\'s padding 2 and the floors (minWidth per column from the office-wide widest value, aligned across the cards) from WIDE_FROM; the dim task column from CENTRE_AT, growing, with no floor', () => {
  const rooms = [room('A', [ag('lead', { task: 'תכנון המעבר לרישום הסטטי' }), ag('a1', { name: 'הקרטוגרף', model: 'Sonnet 4.5', act: '🔎 מחפש קוד', task: 'x'.repeat(40) })]), room('B', [ag('b1', { status: 'done', act: '✅ סיים', task: '' })])]
  // under WIDE_FROM: the column a cell in from each edge, the cards' padding 1, no floors, no task column
  const narrowTree = Office(props({ columns: 81, rooms }), fake(81).surface)
  expect((narrowTree as unknown as Node).props).toEqual({ key: 'root', flexDirection: 'column', width: '100%' })
  const narrow = columnOf(narrowTree)
  expect(narrow.props).toEqual({ key: 'column', flexDirection: 'column', width: 79, flexShrink: 0, marginLeft: 1 })
  expect(cards(narrow)[0]!.props.paddingX).toBe(1)
  expect(columnsOf(cards(narrow)[0]!).slice(1).every(c => c.props.minWidth === undefined)).toBe(true)   // (the status column's floor at every width: R10)
  expect(typeof columnsOf(cards(narrow)[0]!)[0]!.props.minWidth).toBe('number')
  expect(columnsOf(cards(narrow)[0]!)).toHaveLength(5)
  // from WIDE_FROM: the padding 2, the floors on every column, the same on every card
  const wide = columnOf(Office(props({ columns: 82, rooms }), fake(82).surface))
  expect(wide.props).toEqual({ key: 'column', flexDirection: 'column', width: 80, flexShrink: 0, marginLeft: 1 })
  expect(cards(wide)[0]!.props.paddingX).toBe(2)
  const floors80 = floorsOf(officeWidest(rooms), officeModel(props({ columns: 82, rooms })).mode)
  expect(columnsOf(cards(wide)[0]!).map(c => c.props.minWidth)).toEqual([floors80.status, floors80.who, floors80.model, floors80.actEmoji, floors80.actWord])
  expect(columnsOf(cards(wide)[1]!).map(c => c.props.minWidth)).toEqual(columnsOf(cards(wide)[0]!).map(c => c.props.minWidth))
  // from CENTRE_AT: the frozen column with its margin, the task column (dim, growing, no floor) last
  const f = fake(140, 0)
  const p = props({ columns: 140, rooms })
  const tree = Office(p, f.surface)
  expect(geometry(140).margin).toBe(20)
  expect(columnOf(tree).props).toEqual({ key: 'column', flexDirection: 'column', width: CENTRE_AT, flexShrink: 0, marginLeft: 20 })
  const cols = columnsOf(cards(tree)[0]!)
  expect(cols).toHaveLength(6)
  expect(cols.map(c => c.props.flexGrow)).toEqual([0, 0, 0, 0, 0, 1])
  expect(cols[5]!.props.minWidth).toBeUndefined()
  const floors140 = floorsOf(officeWidest(rooms), officeModel(p).mode)
  expect(cols.slice(0, 5).map(c => c.props.minWidth)).toEqual([floors140.status, floors140.who, floors140.model, floors140.actEmoji, floors140.actWord])
  expect(rowsOf(cards(tree)[0]!)).toEqual([modelRow(p, 0, 0), modelRow(p, 0, 1)])
  expect(rowsOf(cards(tree)[0]!)[0]![5]).toBe(nb('תכנון המעבר לרישום הסטטי'))
  expect(rowsOf(cards(tree)[0]!)[1]![5]).toBe('x'.repeat(23) + '…')
  expect(rowsOf(cards(tree)[1]!)[0]![5]).toBe(NBSP)   // an empty task: the cell's one no-break space
  expect(cellsOf(cols[5]!).every(c => cellStyle(c).dimColor === true && cellStyle(c).color === undefined)).toBe(true)
  // the clicks need no margin: a row's cells and the pin are Buttons wherever the column sits (phase B — the pointer's x is not read)
  f.press(tree, 'agent:lead:task')
  expect(f.posts).toEqual([{ t: 'open', id: 'lead' }])
  f.press(tree, 'pin:A')
  expect(f.posts[1]).toEqual({ t: 'pin', room: 'A' })
  expect('margin' in f.surface.state!.inst).toBe(false)
  // the floating overlay at the column's place: the same margin and width (the engine lays an absolute Box against the root —
  // paint probe 22.10 — so the column's margin is its left)
  const ov = overlayOf(Office({ ...p, selected: 'lead', drawer: drawer() }, f.surface))!
  expect(ov.props).toMatchObject({ position: 'absolute', left: 20, width: CENTRE_AT })
  // the column reaches CENTRE_AT cells at 102 columns (a cell on each side): the task column from there; at 100 and 101 the column
  // is the pane less the gutter, no task column; the odd cell stays on the right
  const at102 = columnOf(Office(props({ columns: 102, rooms }), fake(102).surface))
  expect(at102.props).toEqual({ key: 'column', flexDirection: 'column', width: CENTRE_AT, flexShrink: 0, marginLeft: 1 })
  expect(columnsOf(cards(at102)[0]!)).toHaveLength(6)
  const at100 = columnOf(Office(props({ columns: 100, rooms }), fake(100).surface))
  expect(at100.props).toEqual({ key: 'column', flexDirection: 'column', width: 98, flexShrink: 0, marginLeft: 1 })
  expect(columnsOf(cards(at100)[0]!)).toHaveLength(5)
  expect(columnOf(Office(props({ columns: 101, rooms }), fake(101).surface)).props).toMatchObject({ width: 99, marginLeft: 1 })
  expect(columnOf(Office(props({ columns: 103, rooms }), fake(103).surface)).props).toMatchObject({ width: CENTRE_AT, marginLeft: 1 })
  expect(columnOf(Office(props({ columns: 104, rooms }), fake(104).surface)).props).toMatchObject({ width: CENTRE_AT, marginLeft: 2 })
  // EVERY WIDTH (live check 6: the cards' right border was clipped at the pane's edge): the column at most columns - 2 cells, a cell
  // at least left free on each side — the office, the drawer, the settings, the demo, the empty office alike; the overlay, when
  // one floats, at the column's margin and width, and none otherwise
  for (let columns = 24; columns <= 200; columns++) {
    for (const over of [{}, { selected: 'lead', drawer: drawer() }, { helpOpen: true }, { demo: true }, { rooms: [], empty: { kind: 'office' as const, msg: 'המשרד ריק', sub: '' } }] as Array<Partial<OfficeProps>>) {
      const t = Office(props({ columns, rooms, ...over }), fake(columns).surface)
      const root = columnOf(t)
      const w = root.props.width as number
      const ml = root.props.marginLeft as number
      expect(w, `${columns}`).toBeLessThanOrEqual(columns - 2)
      expect(ml, `${columns}`).toBeGreaterThanOrEqual(1)
      expect(columns - ml - w, `${columns}`).toBeGreaterThanOrEqual(1)
      expect(root.props.flexShrink, `${columns}`).toBe(0)
      const floating = overlayOf(t)
      if (over.drawer || over.helpOpen) expect(floating?.props, `${columns}`).toMatchObject({ position: 'absolute', left: ml, width: w, backgroundColor: 'inverseText' })
      else expect(floating, `${columns}`).toBeUndefined()
    }
  }
})

test('the toolbar and the search (probe round 8): under ONE_LINE_FROM the toolbar line then — with the field drawn — the search on a line of its own with a blank line above and below, the short meter at its far edge when the header had no room for one; from ONE_LINE_FROM the Buttons at the reading edge and the field at the other edge of ONE line, inputWidth cells wide (INPUT_MIN..INPUT_MAX after the toolbar\'s words by FIT); the chrome four rows either way without the field', () => {
  const u = { pct: 42.4, resetsAt: '' }
  const p = withAgents(props({ usage: u }), many())
  // 40 columns, crowded counts (the icons' 24 cells: `🎭 🟢1200 ⏳3000 ✅12000`): no room for the short meter in the header (24 + 1 + 9 > 33),
  // so it rides the search line's far edge (15 + 2 + 9 ≤ 33); the toolbar then has no margin of its own (the search line's blank is the gap)
  const crowded = { run: 1200, idle: 3000, done: 12000 }
  const t40 = Office({ ...p, columns: pane(40), counts: crowded }, fake(pane(40)).surface)
  expect(kidsOf(t40).map(kindOf)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  expect((byKey(t40, 'header')!.children as Node[]).length).toBe(1)
  const sl = byKey(t40, 'searchLine')!
  expect(sl).toMatchObject({ props: { flexDirection: 'row-reverse', columnGap: 2, marginTop: 1, marginBottom: 1, height: 1, overflow: 'hidden' } })
  expect((sl.children as Node[]).map(n => n.type)).toEqual(['Box', 'Text'])
  expect((sl.children as Node[])[0]).toMatchObject({ props: { flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden' } })
  expect(nodes((sl.children as Node[])[0]).find(n => n.type === 'Input')?.props.key).toBe('search')
  expect(texts((sl.children as Node[])[1])).toBe(usageShort(u))
  expect((sl.children as Node[])[1]!.props.dimColor).toBe(true)
  expect(byKey(t40, 'toolbar')!.props.marginBottom).toBeUndefined()
  expect(chromeOf(t40)).toBe(CHROME_ROWS_SEARCH)
  // the header has room for the short meter (the probe's counts): the search line carries none
  const t45 = Office({ ...p, columns: pane(45) }, fake(pane(45)).surface)
  expect(texts(byKey(t45, 'header'))).toContain(usageShort(u))
  expect((byKey(t45, 'searchLine')!.children as Node[]).map(n => n.type)).toEqual(['Box'])
  // no field (an office of two — the field is the office's agents' to decide, never its header's width): the toolbar alone with
  // its blank line as a margin, the short meter in the header beside the icons (the tiny form is the probe ladder's, above)
  const t40b = Office(props({ columns: pane(40), usage: u }), fake(pane(40)).surface)
  expect(kidsOf(t40b).map(kindOf)).toEqual(['header', 'toolbar', 'round'])
  expect(byKey(t40b, 'toolbar')!.props.marginBottom).toBe(1)
  expect(texts(byKey(t40b, 'header'))).toContain(usageShort(u))
  expect(chromeOf(t40b)).toBe(CHROME_ROWS_MIN)
  // from ONE_LINE_FROM: one line — the Buttons Box (gap 2, rigid) and the field Box (inputWidth cells, rigid), space-between; the chrome four rows
  const words = ['הצג שסיימו ☑', 'צליל 🔕', 'הגדרות ⚙️']   // (the field's width from the toolbar's WIDEST words: J9)
  for (const columns of [ONE_LINE_FROM, 70, 79, 80, 99, 100, 140, 200]) {
    const t = Office({ ...p, columns: pane(columns) }, fake(pane(columns)).surface)
    const at = `${columns}`
    expect(kidsOf(t).map(kindOf), at).toEqual(['header', 'toolbar', 'round'])
    const tb = byKey(t, 'toolbar')!
    expect(tb, at).toMatchObject({ props: { flexDirection: 'row-reverse', justifyContent: 'space-between', width: '100%', height: 1, overflow: 'hidden', marginBottom: 1 } })
    const [buttons, field] = tb.children as Node[]
    expect(buttons, at).toMatchObject({ props: { flexDirection: 'row-reverse', gap: TOOLBAR_GAP, flexWrap: 'nowrap', flexShrink: 0 } })
    expect(nodes(buttons).filter(n => n.type === 'Button').map(n => n.props.key), at).toEqual(['showDone', 'mute', 'help'])
    expect(field, at).toMatchObject({ props: { width: inputWidth(geometry(pane(columns)), words), flexShrink: 0, height: 1, overflow: 'hidden' } })
    expect(nodes(field).find(n => n.type === 'Input')?.props.key, at).toBe('search')
    expect(chromeOf(t), at).toBe(CHROME_ROWS_MIN)
    expect(byKey(t, 'searchLine'), at).toBeUndefined()
  }
  // inputWidth: what the column leaves after the toolbar's words by FIT and the gaps, between INPUT_MIN and INPUT_MAX
  const toolbarCells = Math.ceil(words.reduce((n, l) => n + textWidth(l), 0) / FIT) + 2 * TOOLBAR_GAP
  expect(toolbarCells).toBe(43)
  expect(inputWidth(geometry(pane(64)), words)).toBe(Math.max(INPUT_MIN, Math.min(INPUT_MAX, 64 - toolbarCells - 2)))
  expect(inputWidth(geometry(pane(64)), words)).toBe(19)
  expect(inputWidth(geometry(pane(75)), words)).toBe(30)
  expect(inputWidth(geometry(pane(100)), words)).toBe(INPUT_MAX)
  expect(inputWidth(geometry(pane(200)), words)).toBe(INPUT_MAX)
  expect(inputWidth(geometry(pane(24)), words)).toBe(INPUT_MIN)
  expect([INPUT_MIN, INPUT_MAX]).toEqual([12, 30])
  // without the agents for it no field from ONE_LINE_FROM either: the Buttons alone on the line; an active search keeps it with two agents
  expect((byKey(Office(props({ columns: pane(80) }), fake(pane(80)).surface), 'toolbar')!.children as Node[]).length).toBe(1)
  expect(nodes(Office(props({ columns: pane(45), search: 'x' }), fake(pane(45)).surface)).find(n => n.type === 'Input')).toBeDefined()
  expect(nodes(Office(props({ columns: pane(80), search: 'x' }), fake(pane(80)).surface)).find(n => n.type === 'Input')).toBeDefined()
  expect(chromeOf(Office(props({ columns: pane(45), search: 'x' }), fake(pane(45)).surface))).toBe(CHROME_ROWS_SEARCH)
  // the search typed in the field reaches the hooks whatever the line it sits on
  const g = fake(pane(80))
  const one = Office({ ...p, columns: pane(80) }, g.surface)
  ;(nodes(one).find(n => n.type === 'Input')!.props.onSubmit as (v: string) => void)('owl')
  expect(g.posts).toEqual([{ t: 'search', q: 'owl' }])
})

test('the weights in the tree (round 8): working = a bold who; waiting = a regular who and a dim activity word; finished = all dim; a ❌ row keeps a regular who; the model always dim; colour on the status mark alone', () => {
  const p = props({ columns: 51, rooms: [room('A', [ag('run'), ag('wait', { status: 'stale', act: '💤 ממתין' }), ag('fin', { status: 'done', act: '✅ סיים' }), ag('bad', { status: 'done', failed: true, act: '⛔ נכשל' })])] })
  const cols = columnsOf(cards(Office(p, fake(51).surface))[0]!)
  expect(cols).toHaveLength(5)
  const [status, who, model, emoji, word] = cols.map(cellsOf)
  expect(status!.map(c => c.props.color)).toEqual([DOT_FG.running, DOT_FG.stale, DOT_FG.done, DOT_FG.done])
  expect(status!.map(c => texts(c))).toEqual(['●', '●', '○', '❌'])
  // (the weights on the Buttons' Text children: bold and dim are what a Button keeps on the desktop — decision 26)
  expect(who!.map(c => [cellStyle(c).bold, cellStyle(c).dimColor])).toEqual([[true, false], [false, false], [false, true], [false, false]])
  expect(model!.every(c => cellStyle(c).dimColor === true)).toBe(true)
  expect(emoji!.map(c => cellStyle(c).dimColor)).toEqual([false, false, true, true])
  expect(word!.map(c => cellStyle(c).dimColor)).toEqual([false, true, true, true])
  for (const col of [who, model, emoji, word]) expect(col!.every(c => c.type === 'Button' && cellStyle(c).color === undefined && c.props.color === undefined)).toBe(true)
})

test('the settings\' shortcuts from WIDE_FROM: two column pairs side by side (PAIRS_GAP apart), the second padded with a blank row to the first\'s HELP_PAIR_ROWS, the popover helpRows tall; the popover\'s and the drawer\'s padding the cards\' (2 from WIDE_FROM)', () => {
  const t = Office(props({ columns: pane(80), helpOpen: true }), fake(pane(80)).surface)
  const box = byKey(t, 'help')!
  expect(box).toMatchObject({ props: { paddingX: 2, height: helpRows(pane(80)), width: geometry(pane(80)).W, left: geometry(pane(80)).margin } })   // (the floating card: the column's width and margin)
  expect(helpRows(pane(80))).toBe(11)
  expect((box.children as Node[])).toHaveLength(3)
  const pairs = (box.children as Node[])[2]!.children as Node[]
  expect(pairs).toHaveLength(2)
  const labelsOf = (pair: Node) => cellsOf((pair.children as Node[])[0]!).map(n => texts(n))
  const keysOf = (pair: Node) => cellsOf((pair.children as Node[])[1]!).map(n => texts(n))
  expect(labelsOf(pairs[0]!)).toEqual(HELP.slice(0, HELP_PAIR_ROWS).map(([k]) => nb(LABELS[k]!)))
  expect(keysOf(pairs[0]!)).toEqual(HELP.slice(0, HELP_PAIR_ROWS).map(([, k]) => nb(k)))
  // (eight rows since the motion toggle went — live check 7, Q9: the second pair three, padded with two blank rows)
  expect(labelsOf(pairs[1]!)).toEqual([...HELP.slice(HELP_PAIR_ROWS).map(([k]) => nb(LABELS[k]!)), NBSP, NBSP])
  expect(keysOf(pairs[1]!)).toEqual([...HELP.slice(HELP_PAIR_ROWS).map(([, k]) => nb(k)), NBSP, NBSP])
  for (const pair of pairs) for (const col of pair.children as Node[]) for (const cell of cellsOf(col)) expect(texts(cell)).not.toContain(' ')
  expect(byKey(Office(props({ columns: pane(80), selected: 'lead', drawer: drawer() }), fake(pane(80)).surface), 'drawer')!.props.paddingX).toBe(2)
  expect(byKey(Office(props({ columns: pane(79), selected: 'lead', drawer: drawer() }), fake(pane(79)).surface), 'drawer')!.props.paddingX).toBe(1)
})
