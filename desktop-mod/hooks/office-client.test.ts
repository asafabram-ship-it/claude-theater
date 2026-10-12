// office-client.tsx: the desktop office as one Client surface module, driven
// DIRECTLY with a fake surface (the module is a pure function of props and
// surface): the chrome, the window maths, the timer discipline, the pointer and
// key handlers, the search Input, the limits sweep, the error wrapper — exact
// and fast. Mounting it through the kit needs the plugin's own hooks to build
// the Client from a literal path (the engine reads surface modules off the
// hooks module; an inline test plugin is copied to a temp folder and cannot
// reach this file), so the mounted tests ride with Task 2.4 in ui.test.ts.

import type { ClientKeyEvent, ClientPointerEvent, ClientSurface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { I18N } from './i18n'
import { CHROME_ROWS, COMPACT_BELOW, HELP_ROWS, REFUSED_RE, RESULT_LINES, ROW_CHARS_PER_COLUMN, SEARCH_MAX, TASK_LINES, WINDOW_CHARS, chromeRows, cleanAgentText, cleanSearch, drawerLines, officeHeight, windowOf } from './office-chrome'
import Office, { FX_BG, FX_DONE_MS, FX_ENTER_MS, FX_STATUS_FRAMES, FX_TICK_MS, SEARCH_DEBOUNCE_MS } from './office-client'
import type { OfficeState } from './office-client'
import { HOVER_BG, NO_DECOR, TILE_H, TILE_W, layoutOffice, walkShift } from './office-layout'
import type { OfficeDecor } from './office-layout'
import type { OfficeAgent, OfficeDrawer, OfficeMessage, OfficeProps, OfficeRoom } from './office-props'

const LABELS: Record<string, string> = Object.fromEntries(Object.entries(I18N.he).filter((kv): kv is [string, string] => typeof kv[1] === 'string'))
const LABELS_EN: Record<string, string> = Object.fromEntries(Object.entries(I18N.en).filter((kv): kv is [string, string] => typeof kv[1] === 'string'))

function ag(id: string, over: Partial<OfficeAgent> = {}): OfficeAgent {
  return { id, emoji: '🦉', name: id, status: 'running', fam: 'read', act: '📖 קורא', model: 'Opus 5.5', modelFam: 'opus', startMin: 3, isLead: false, failed: false, longRunning: false, star: 0, enteredAt: 0, ...over }
}
function room(id: string, agents: OfficeAgent[], over: Partial<OfficeRoom> = {}): OfficeRoom {
  const n = (s: OfficeAgent['status']) => agents.filter(a => a.status === s).length
  return { id, title: `room ${id}`, small: id, pinned: false, showDone: false, run: n('running'), stale: n('stale'), done: n('done'), agents, ...over }
}
function props(over: Partial<OfficeProps> = {}): OfficeProps {
  return {
    v: 1, lang: 'he', rtl: true, columns: 45, rows: 30, offset: 0, nowMin: 100,
    counts: { run: 2, idle: 0, done: 0 }, prefs: { showDone: false, muted: true, still: false },
    search: '', selected: null, helpOpen: false, demo: false,
    rooms: [room('A', [ag('lead', { isLead: true, emoji: '💼', act: '🧠 חושב' }), ag('a1')])],
    drawer: null, footer: '', usage: null, empty: null, labels: LABELS, ...over,
  }
}
function drawer(over: Partial<OfficeDrawer> = {}): OfficeDrawer {
  return { id: 'lead', name: '💼 המנהל', chips: ['עובד', 'Explore'], model: 'Opus 5.5', act: '🧠 חושב', task: 'map the docs', result: '', truncated: false, elapsedMin: 3, sub: 'map the docs', ...over }
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

// ---------------------------------------------------------------------------
// pure parts
// ---------------------------------------------------------------------------

test('windowOf: the rows the engine shows, in layout coordinates, never shifted by a clamp', () => {
  // offset inside the chrome: the first (rows - (chrome - offset)) layout rows
  expect(windowOf(3, 0, 30, 100, 45)).toEqual({ from: 0, count: 27 })
  expect(windowOf(3, 2, 30, 100, 45)).toEqual({ from: 0, count: 29 })
  // offset past the chrome: a full window from offset - chrome
  expect(windowOf(3, 3, 30, 100, 45)).toEqual({ from: 0, count: 30 })
  expect(windowOf(3, 10, 30, 100, 45)).toEqual({ from: 7, count: 30 })
  // near the end: the count shrinks, `from` stays (no clamp shifting the rows under the pointer)
  expect(windowOf(3, 90, 30, 100, 45)).toEqual({ from: 87, count: 13 })
  expect(windowOf(3, 200, 30, 100, 45)).toEqual({ from: 197, count: 0 })
  // short content, tall window
  expect(windowOf(3, 0, 30, 5, 45)).toEqual({ from: 0, count: 5 })
  expect(windowOf(3, 0, 0, 5, 45)).toEqual({ from: 0, count: 0 })
  // the byte budget: a wide window draws at most WINDOW_CHARS / (ROW_CHARS_PER_COLUMN × columns) rows, the rest stays blank
  expect(windowOf(3, 3, 80, 500, 200)).toEqual({ from: 0, count: Math.floor(WINDOW_CHARS / (ROW_CHARS_PER_COLUMN * 200)) })
  expect(windowOf(3, 3, 80, 500, 200).count).toBe(50)
  expect(windowOf(3, 3, 80, 500, 250).count).toBe(40)
  expect(windowOf(3, 3, 80, 500, 45).count).toBe(80)
})

test('cleanSearch: the search text cut to SEARCH_MAX code points (never half an emoji) and freed of control characters (the surface refuses an Input value holding one)', () => {
  expect(SEARCH_MAX).toBe(200)
  expect(cleanSearch('triage')).toBe('triage')
  expect(cleanSearch('x'.repeat(100_010))).toBe('x'.repeat(SEARCH_MAX))
  expect(Array.from(cleanSearch('🔍'.repeat(SEARCH_MAX + 50)))).toEqual(Array.from('🔍'.repeat(SEARCH_MAX)))
  expect(cleanSearch('a\u0007b\u001b[31mc\nd\te\u0000f\u007fg\u0085h')).toBe('a b [31mc d e f g h')
  // the bidi controls are removed (the desktop refuses them in a Text; a mark in a query would never match a name);
  // Hebrew, emoji, a ZWJ sequence and a variation selector are kept as typed
  expect(cleanSearch('עברית \u200fok')).toBe('עברית ok')
  expect(cleanSearch('\u202bשלום\u202c \u2067x\u2069 \u200eA\u061cB\u202aC\u202dD\u202eE\u2066F\u2068G')).toBe('שלום x ABCDEFG')
  expect(cleanSearch('👨\u200d💻 ✏\ufe0f 🦉 קוד')).toBe('👨\u200d💻 ✏\ufe0f 🦉 קוד')
  expect(cleanSearch('\u200f'.repeat(5000) + 'x'.repeat(300))).toBe('x'.repeat(SEARCH_MAX))   // marks do not eat the cap
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
  expect(cleanAgentText('\u202bשלום\u202c \u2067x\u2069 \u200eA\u061cB\u202aC\u202dD\u202eE\u2066F\u2068G\u200fH')).toBe('שלום x ABCDEFGH')
  // a single-line field (a name, a label, a title): line breaks and tabs are spaces, CRLF one space
  expect(cleanAgentText('one\r\ntwo\nthree\tfour\rfive')).toBe('one two three four five')
  // a multi-line field (task, result): newline and tab kept (the engine's two allowed controls), CRLF and CR a newline
  expect(cleanAgentText('one\r\ntwo\nthree\tfour\rfive', true)).toBe('one\ntwo\nthree\tfour\nfive')
  expect(cleanAgentText(`${ESC}[32mok${ESC}[0m\n${BEL}\u200fדוח`, true)).toBe('ok\n דוח')
  // what must stay: Hebrew, emoji, a ZWJ sequence, a variation selector, a skin tone
  expect(cleanAgentText('👨\u200d💻 ✏\ufe0f 🦉 קוד 👍🏽')).toBe('👨\u200d💻 ✏\ufe0f 🦉 קוד 👍🏽')
  expect(cleanAgentText('')).toBe('')
  // idempotent, and nothing a surface refuses is left (REFUSED_RE: the shared set — bidi, any control but tab / newline)
  const dirty = [`${ESC}[31mred${ESC}[0m`, `x${ESC}${ESC}[[31m`, `${ESC}${'\u200f'}[31m`, 'a\r\n\r\nb\u0000\t', `${ESC}]0;title`, '\u061c\u2066\u2069', '👨\u200d💻 קוד']
  for (const s of dirty) {
    for (const multiline of [false, true]) {
      const once = cleanAgentText(s, multiline)
      expect(cleanAgentText(once, multiline)).toBe(once)
      expect(once).not.toMatch(REFUSED_RE)
      if (!multiline) expect(once).not.toMatch(/[\n\t]/)
    }
  }
  expect(`a${BEL}`).toMatch(REFUSED_RE)
  expect('a\u061c').toMatch(REFUSED_RE)
  expect('a\nb\tc 👨\u200d💻 ✏\ufe0f').not.toMatch(REFUSED_RE)
})

test('chromeRows / officeHeight: header, toolbar, search; then help | drawer, the footer line, the empty block', () => {
  const p = props()
  expect(chromeRows(p)).toBe(CHROME_ROWS)
  expect(chromeRows({ ...p, footer: 'scan: 2 skipped' })).toBe(CHROME_ROWS + 1)
  expect(chromeRows({ ...p, helpOpen: true })).toBe(CHROME_ROWS + HELP_ROWS)
  // the drawer: border 2 + name, sub, chips, model · action, task heading, one task line
  const inner = p.columns - 4
  expect(drawerLines(drawer(), LABELS, inner).length).toBe(6)
  expect(chromeRows({ ...p, drawer: drawer() })).toBe(CHROME_ROWS + 2 + 6)
  // help wins over the drawer when both are open (as today: help is a popover)
  expect(chromeRows({ ...p, helpOpen: true, drawer: drawer() })).toBe(CHROME_ROWS + HELP_ROWS)
  // a long task wraps to at most TASK_LINES lines, the result to RESULT_LINES (+ heading + the ✂ note)
  const long = drawer({ task: 'word '.repeat(400), result: 'done '.repeat(400), truncated: true, sub: '' })
  expect(drawerLines(long, LABELS, inner).length).toBe(4 + TASK_LINES + 1 + RESULT_LINES + 1)
  for (const line of drawerLines(long, LABELS, inner)) expect(line.text.length).toBeLessThanOrEqual(inner)
  // the elapsed minutes ride on the chips line (whole minutes: the ruling of Task 2.2)
  expect(drawerLines(drawer({ elapsedMin: 7 }), LABELS, inner)[2]?.text).toMatch(/זמן 7/)
  expect(drawerLines(drawer({ elapsedMin: null }), LABELS, inner)[2]?.text).not.toMatch(/זמן/)
  // the full height = chrome + the layout's rows; the empty office = chrome + its block
  const layout = layoutOffice(p)
  expect(officeHeight(p, layout.rows.length)).toBe(CHROME_ROWS + layout.rows.length)
  const empty = { ...p, rooms: [], empty: { kind: 'office' as const, msg: LABELS.emptyOffice ?? '', sub: LABELS.emptySub ?? '' } }
  expect(officeHeight(empty, 0)).toBeGreaterThan(CHROME_ROWS + 2)
})

test('render: the chrome, the windowed rows as run-merged Texts, blank space above the window, nothing below', () => {
  const f = fake(45, 0)
  const p = props()
  const tree = Office(p, f.surface)
  const all = nodes(tree)
  expect(all[0]?.type).toBe('Box')
  // header with the counts, toolbar Buttons with today's keys, the search Input
  expect(texts(tree)).toMatch(/🟢 2/)
  const keys = all.filter(n => n.type === 'Button').map(n => n.props.key)
  expect(keys).toEqual(['showDone', 'mute', 'lang', 'help', 'demo', 'still'])
  expect(all.find(n => n.type === 'Input')?.props.key).toBe('search')
  // hotkeys only from COMPACT_BELOW columns, today's rule (the desktop draws a key chip per hotkey, which would wrap the toolbar)
  expect(all.filter(n => n.type === 'Button').every(n => n.props.hotkey === undefined)).toBe(true)
  const wide = nodes(Office({ ...p, columns: COMPACT_BELOW }, fake(COMPACT_BELOW).surface))
  expect(wide.filter(n => n.type === 'Button').map(n => n.props.hotkey)).toEqual(['f', 'm', 'l', 'h', 'd', 's'])
  // the room head and the tiles are rows of the layout, one Text per row with a Text per run
  const layout = layoutOffice(p)
  const rowTexts = all[0]!.children.slice(CHROME_ROWS) as Node[]
  expect(rowTexts.length).toBe(layout.rows.length)   // 30 body rows ≥ the 7 rows of one room
  expect(texts(rowTexts[0])).toMatch(/💬 room A/)
  expect(texts(rowTexts[1])).toMatch(/💼/)
  expect(withBg(rowTexts[4], '#7b5cf0').length).toBe(2)   // two Opus pills on the model row
  // a window further down: a spacer Box of `from` rows, then the rows, then nothing
  const many = withAgents(p, Array.from({ length: 12 }, (_, i) => ag(`a${i}`)))
  const L2 = layoutOffice(many)
  const t2 = Office({ ...many, offset: 12, rows: 10 }, fake(45, 0).surface) as unknown as Node
  const kids = t2.children as Node[]
  const spacer = kids[CHROME_ROWS]!
  expect(spacer.type).toBe('Box')
  expect(spacer.props.height).toBe(12 - CHROME_ROWS)
  expect(kids.length - CHROME_ROWS - 1).toBe(10)
  expect(texts(kids[CHROME_ROWS + 1]).replace(/\n/g, '')).toBe(L2.rows[12 - CHROME_ROWS]!.cells.map(c => c.ch).join(''))
  // the footer rides in the chrome (the engine scrolls natively: a line at the content's end would hide until the end)
  const t3 = Office({ ...p, footer: 'scan: 1 skipped' }, fake(45, 0).surface) as unknown as Node
  expect(texts(t3.children[CHROME_ROWS])).toBe('scan: 1 skipped')
  // RTL: the room head's pin sits at the right edge, the toolbar is row-reverse
  expect(all[0]!.children[1]).toMatchObject({ type: 'Box', props: { flexDirection: 'row-reverse' } })
  expect(nodes(Office({ ...p, rtl: false, lang: 'en', labels: LABELS_EN }, fake().surface))[0]!.children[1]).toMatchObject({ props: { flexDirection: 'row' } })
})

test('render: equal props draw with no setState and no timer; the layout is memoised by its signature', () => {
  const f = fake()
  const p = props()
  Office(p, f.surface)
  expect(f.setStates()).toBe(1)            // the one init of the local state
  Office(p, f.surface)
  Office({ ...p }, f.surface)
  Office({ ...p, nowMin: p.nowMin + 1 }, f.surface)
  expect(f.setStates()).toBe(1)
  expect(f.timers).toHaveLength(0)
  expect(f.posts).toHaveLength(0)
  // the memo: same signature → the same layout object is drawn from
  const s = f.surface.state!
  const before = s.inst.layout
  Office({ ...p, nowMin: p.nowMin + 2, footer: 'x' }, f.surface)
  expect(f.surface.state!.inst.layout).toBe(before)
  Office({ ...p, columns: 60 }, f.surface)
  expect(f.surface.state!.inst.layout).not.toBe(before)
  // ... and by the decor: a hover laid out once, the same hover drawn from the memo, a cleared hover laid out again
  const wide = f.surface.state!.inst.layout
  Office({ ...p, columns: 60 }, f.surface)
  expect(f.surface.state!.inst.layout).toBe(wide)
  f.surface.setState({ ...f.surface.state!, hover: 'a1' })
  Office({ ...p, columns: 60 }, f.surface)
  const hovered = f.surface.state!.inst.layout
  expect(hovered).not.toBe(wide)
  expect(hovered).toEqual(layoutOffice({ ...p, columns: 60 }, { hover: 'a1', hop: new Set(), entering: new Map() }))
  Office({ ...p, columns: 60 }, f.surface)
  expect(f.surface.state!.inst.layout).toBe(hovered)
  f.surface.setState({ ...f.surface.state!, hover: null })
  Office({ ...p, columns: 60 }, f.surface)
  expect(f.surface.state!.inst.layout).toEqual(layoutOffice({ ...p, columns: 60 }))
})

test('fx: a newcomer walks in (its head 3 → 2 → 1 cells off home from the reading start), a finisher hops with a ⭐ over the gold pulse, a status flashes the desk; the clock runs only while an fx does; still disables them', () => {
  const f = fake()
  // the first props prime the stamps: no fx for the agents already there, even with enteredAt set
  let p = withAgents(props(), [ag('lead', { enteredAt: 1000 }), ag('a1', { enteredAt: 2000 })])
  Office(p, f.surface)
  Office(p, f.surface)
  expect(f.timers).toHaveLength(0)
  /** The drawn head row of the first tile block (layout row 1), as its cells' glyphs. */
  const headRow = (t: unknown) => texts((t as Node).children[CHROME_ROWS + 1]).replace(/\n/g, '')
  const walk = (progress: number): OfficeDecor => ({ hover: null, hop: new Set(), entering: new Map([['n1', progress]]) })
  const laid = (q: OfficeProps, d: OfficeDecor) => layoutOffice(q, d).rows[1]!.cells.map(c => c.ch).join('')
  // a newcomer with a stamp → enter fx: n1 is the third tile, RTL → x 1, the leftmost (nothing wide before it on the row,
  // so its head's cell is its index in the string); home is x + 6; it starts WALK_CELLS to the right (RTL reads from the right)
  p = withAgents(p, [...p.rooms[0]!.agents, ag('n1', { enteredAt: 5000 })])
  const home = 1 + 6
  let tree = Office(p, f.surface)
  expect(headRow(tree).indexOf('🦉')).toBe(home + 3)
  expect(headRow(tree)).toBe(laid(p, walk(0)))
  expect(f.timers).toHaveLength(1)
  expect(f.timers[0]!.ms).toBe(FX_TICK_MS)
  // motion, no colour overlay: the only backgrounds drawn are the layout's own (the Opus pills, the desks, the screens)
  expect(nodes(tree).some(n => typeof n.props.backgroundColor === 'string' && !['#7b5cf0', '#3a2a1a', '#111827'].includes(n.props.backgroundColor))).toBe(false)
  // the same props again: nothing new starts, the head does not move without a tick
  Office(p, f.surface)
  tree = Office({ ...p }, f.surface)
  expect(f.timers).toHaveLength(1)
  expect(headRow(tree).indexOf('🦉')).toBe(home + 3)
  const sets = f.setStates()
  // each tick of the fx clock walks it a cell: progress 1 - left / FX_ENTER_MS → walkShift 2, then 1
  const steps = Math.ceil(FX_ENTER_MS / FX_TICK_MS)
  for (let i = 1; i < steps; i++) {
    f.tick()
    tree = Office(p, f.surface)
    const progress = 1 - (FX_ENTER_MS - i * FX_TICK_MS) / FX_ENTER_MS
    expect(headRow(tree).indexOf('🦉')).toBe(home + walkShift(progress))
    expect(headRow(tree)).toBe(laid(p, walk(progress)))
    expect(f.timers[0]!.stopped).toBe(false)
  }
  expect([1, 2].map(i => walkShift(1 - (FX_ENTER_MS - i * FX_TICK_MS) / FX_ENTER_MS))).toEqual([2, 1])
  f.tick()
  expect(f.timers[0]!.stopped).toBe(true)
  expect(f.setStates()).toBe(sets + steps)   // one redraw per tick, none besides
  tree = Office(p, f.surface)
  expect(headRow(tree).indexOf('🦉')).toBe(home)
  expect(headRow(tree)).toBe(laid(p, NO_DECOR))
  // a star → done fx (FX_DONE_MS): ⭐ beside a1's head on its own row, the head row pulsing done/doneAlt by frame parity;
  // the same agent's running → done is also a status flash (FX_STATUS_FRAMES on the desk row), which ends first
  p = withAgents(p, p.rooms[0]!.agents.map(a => a.id === 'a1' ? { ...a, status: 'done' as const, star: 7000 } : a))
  const shown = { ...p, rooms: [{ ...p.rooms[0]!, showDone: true }] }
  const pulse = (t: unknown) => withBg(t, FX_BG.done).length + withBg(t, FX_BG.doneAlt).length
  tree = Office(shown, f.surface)
  expect(headRow(tree)).toContain('⭐🦉')
  expect(headRow(tree)).toBe(laid(shown, { hover: null, hop: new Set(['a1']), entering: new Map() }))
  expect(pulse(tree)).toBeGreaterThan(0)
  expect(withBg(tree, FX_BG.status).length).toBeGreaterThan(0)
  expect(f.timers).toHaveLength(2)
  for (let i = 0; i < FX_STATUS_FRAMES; i++) f.tick()
  expect(f.timers[1]!.stopped).toBe(false)         // the status flash is over, the hop still runs the clock
  tree = Office(shown, f.surface)
  expect(withBg(tree, FX_BG.status)).toHaveLength(0)
  expect(headRow(tree)).toContain('⭐🦉')
  expect(pulse(tree)).toBeGreaterThan(0)
  // the hop does not change between ticks: its layout is drawn from the memo (only the pulse overlay alternates)
  const hopLayout = f.surface.state!.inst.layout
  f.tick()
  Office(shown, f.surface)
  expect(f.surface.state!.inst.layout).toBe(hopLayout)
  for (let i = 0; i < Math.ceil(FX_DONE_MS / FX_TICK_MS) - FX_STATUS_FRAMES - 1; i++) f.tick()
  expect(f.timers[1]!.stopped).toBe(true)
  tree = Office(shown, f.surface)
  expect(headRow(tree)).not.toContain('⭐')
  expect(pulse(tree)).toBe(0)
  // a status change → FX_STATUS_FRAMES frames of the desk row (the head does not move)
  p = withAgents(p, p.rooms[0]!.agents.map(a => a.id === 'lead' ? { ...a, status: 'stale' as const } : a))
  tree = Office(p, f.surface)
  expect(withBg(tree, FX_BG.status).length).toBeGreaterThan(0)
  expect(headRow(tree)).toBe(laid(p, NO_DECOR))
  expect(f.timers).toHaveLength(3)
  for (let i = 0; i < FX_STATUS_FRAMES; i++) f.tick()
  expect(f.timers[2]!.stopped).toBe(true)
  // still: a newcomer starts nothing, and a running fx is dropped
  p = withAgents(p, [...p.rooms[0]!.agents, ag('n2', { enteredAt: 9000 })])
  const still = { ...p, prefs: { ...p.prefs, still: true } }
  tree = Office(still, f.surface)
  expect(f.timers).toHaveLength(3)
  expect(f.surface.state!.inst.layout).toEqual(layoutOffice(still))
  // and back from still, the stamps seen under still start nothing either
  Office(p, f.surface)
  expect(f.timers).toHaveLength(3)
})

test('pointer: down → hit → one post (open / pin / roomDone); move → hover highlight without a post; leave clears; the chrome is dead', () => {
  const f = fake()
  const p = props({ rooms: [room('A', [ag('lead', { isLead: true }), ag('a1'), ag('d1', { status: 'done' })])] })
  Office(p, f.surface)
  const C = chromeRows(p)
  // the lead's tile: RTL → the first tile is at the right edge, one row under the head
  f.pointer({ type: 'down', x: p.columns - TILE_W + 2, y: C + 1 + 2, button: 'left' })
  expect(f.posts).toEqual([{ t: 'open', id: 'lead' }])
  f.pointer({ type: 'up', x: p.columns - TILE_W + 2, y: C + 1 + 2, button: 'left' })
  // the second tile
  f.pointer({ type: 'down', x: p.columns - 2 * (TILE_W + 1) + 3, y: C + 1 + TILE_H - 1, button: 'left' })
  expect(f.posts[1]).toEqual({ t: 'open', id: 'a1' })
  // the pin at the right edge of the head row; the counts (with ✅) at the left edge
  f.pointer({ type: 'down', x: p.columns - 1, y: C, button: 'left' })
  expect(f.posts[2]).toEqual({ t: 'pin', room: 'A' })
  f.pointer({ type: 'down', x: 1, y: C, button: 'left' })
  expect(f.posts[3]).toEqual({ t: 'roomDone', room: 'A' })
  // the chrome, the empty third slot (d1 is hidden) and the rows past the tiles post nothing; nor does a right click
  f.pointer({ type: 'down', x: 5, y: 0, button: 'left' })
  f.pointer({ type: 'down', x: 5, y: C + 1, button: 'left' })
  f.pointer({ type: 'down', x: p.columns - TILE_W + 2, y: C + 1 + TILE_H + 5, button: 'left' })
  f.pointer({ type: 'down', x: p.columns - TILE_W + 2, y: C + 1 + 2, button: 'right' })
  expect(f.posts.length).toBe(4)
  // hover: a move over the lead → setState with hover, the layout lays HOVER_BG on its head row; a second move there changes nothing
  const sets = f.setStates()
  f.pointer({ type: 'move', x: p.columns - TILE_W + 2, y: C + 1 + 1 })
  expect(f.surface.state!.hover).toBe('lead')
  expect(f.setStates()).toBe(sets + 1)
  f.pointer({ type: 'move', x: p.columns - TILE_W + 3, y: C + 1 + 1 })
  expect(f.setStates()).toBe(sets + 1)
  const tree = Office(p, f.surface)
  expect(withBg(tree, HOVER_BG).length).toBeGreaterThan(0)
  f.pointer({ type: 'leave', x: 0, y: 0 })
  expect(f.surface.state!.hover).toBe(null)
  f.pointer({ type: 'leave', x: 0, y: 0 })
  expect(f.setStates()).toBe(sets + 2)
  expect(f.posts.length).toBe(4)   // no post for any move/leave
  // a click on a tile also takes the keyboard focus there
  expect(f.surface.state!.focus).toBe('a1')
})

test('pointer: only the drawn window answers — a click or a hover on a row the byte budget left blank, or in the spacer above the window, hits nothing', () => {
  // three rooms of 40 at 200 columns (13 tiles a row): 77 layout rows; an 80-row pane draws the first 50 (WINDOW_CHARS)
  const crowd = Array.from({ length: 120 }, (_, i) => ag(`g${i}`))
  const p = props({ columns: 200, rows: 80, offset: 0, rooms: [room('A', crowd.slice(0, 40)), room('B', crowd.slice(40, 80)), room('C', crowd.slice(80))] })
  const f = fake(200, 0)
  Office(p, f.surface)
  const lay = layoutOffice(p)
  const C = chromeRows(p)
  const { from, count } = windowOf(C, p.offset, p.rows, lay.rows.length, p.columns)
  expect([from, count]).toEqual([0, 50])
  expect(lay.rows.length).toBe(77)
  // room B's last block (layout rows 45..50) straddles the window's end: its rows 45..49 are drawn, row 50 is not
  const straddle = lay.hits.find(r => r.kind === 'agent' && r.y === 45)!
  const past = lay.hits.find(r => r.kind === 'agent' && r.y > from + count)!
  f.pointer({ type: 'down', x: past.x + 2, y: C + past.y + 1, button: 'left' })
  f.pointer({ type: 'down', x: straddle.x + 2, y: C + from + count, button: 'left' })   // y = chrome + from + count: the first row not drawn
  expect(f.posts).toEqual([])
  f.pointer({ type: 'move', x: past.x + 2, y: C + past.y + 1 })
  expect(f.surface.state!.hover).toBeNull()
  // the last drawn row still answers
  f.pointer({ type: 'down', x: straddle.x + 2, y: C + from + count - 1, button: 'left' })
  expect(f.posts).toEqual([{ t: 'open', id: straddle.id }])
  f.pointer({ type: 'move', x: straddle.x + 2, y: C + from + count - 1 })
  expect(f.surface.state!.hover).toBe(straddle.id)
  // scrolled 20 rows down: the rows above the window are one blank spacer; a click there (a stale offset) hits nothing
  Office({ ...p, offset: 20 }, f.surface)
  const w2 = windowOf(C, 20, p.rows, lay.rows.length, p.columns)
  expect(w2.from).toBe(20 - C)
  const above = lay.hits.find(r => r.kind === 'agent')!
  f.pointer({ type: 'down', x: above.x + 2, y: C + above.y + 1, button: 'left' })
  expect(f.posts).toHaveLength(1)
  f.pointer({ type: 'move', x: above.x + 2, y: C + above.y + 1 })
  expect(f.surface.state!.hover).toBeNull()
  const first = lay.hits.find(r => r.kind === 'agent' && r.y <= w2.from && r.y + r.h > w2.from)!
  f.pointer({ type: 'down', x: first.x + 2, y: C + w2.from, button: 'left' })
  expect(f.posts[1]).toEqual({ t: 'open', id: first.id })
  // the empty office draws no rows: nothing answers
  Office(props({ rooms: [], empty: { kind: 'office', msg: 'm', sub: '' } }), f.surface)
  f.pointer({ type: 'down', x: 2, y: C + 1, button: 'left' })
  expect(f.posts).toHaveLength(2)
})

test('keys after a click: j/k walk the tiles with no post (the keyboard focus is the module\'s own), o/Enter open, x closes, f/m/l/h/d/s are the toolbar', () => {
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
  expect(withBg(tree, FX_BG.focus).length).toBeGreaterThan(0)
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
  // the placeholder is the label (without the trailing ellipsis), prefixed by the glass
  expect(input().props.placeholder).toBe('🔍 חיפוש סוכנים')
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
  ;(input().props.onSubmit as (v: string) => void)('\u202bבדיקה\u202c\u200f')
  expect(f.posts[f.posts.length - 1]).toEqual({ t: 'search', q: 'בדיקה' })
  tree = Office({ ...p, search: 'בדיקה' }, f.surface)
  expect(input().props.value).toBe('בדיקה')
  // an outside value is cleaned too (the hooks clean what they store; the module never draws one it would be refused for)
  tree = Office({ ...p, search: 'a\u0000b' }, f.surface)
  expect(input().props.value).toBe('a b')
})

test('the drawer, the help and the empty office draw from props and labels; Buttons post; the selected tile is highlighted', () => {
  const f = fake()
  const p = props({ selected: 'lead', drawer: drawer({ result: 'found 3 docs', truncated: true }) })
  let tree = Office(p, f.surface)
  const t = texts(tree)
  expect(t).toMatch(/💼 המנהל/)
  expect(t).toMatch(/משימה/)
  expect(t).toMatch(/map the docs/)
  expect(t).toMatch(/תוצאה/)
  expect(t).toMatch(/found 3 docs/)
  expect(t).toMatch(/✂/)
  expect(t).toMatch(/🧠 Opus 5\.5/)
  const close = nodes(tree).find(n => n.type === 'Button' && n.props.key === 'close')!
  expect(close.props.hotkey).toBe('x')
  ;(close.props.onPress as () => void)()
  expect(f.posts).toEqual([{ t: 'close' }])
  expect(withBg(tree, FX_BG.selected).length).toBeGreaterThan(0)
  // the drawer Box has a fixed height so the rows below never move
  const box = nodes(tree).find(n => n.type === 'Box' && n.props.key === 'drawer')!
  expect(box.props.height).toBe(chromeRows(p) - CHROME_ROWS)
  // help: the title, the eight rows, the ✕; the help wins over the drawer
  tree = Office({ ...p, helpOpen: true }, f.surface)
  expect(texts(tree)).toMatch(/קיצורי מקלדת/)
  expect(texts(tree)).toMatch(/k \/ j/)
  expect(texts(tree)).not.toMatch(/found 3 docs/)
  const closeHelp = nodes(tree).find(n => n.type === 'Button' && n.props.key === 'closeHelp')!
  ;(closeHelp.props.onPress as () => void)()
  expect(f.posts[1]).toEqual({ t: 'help' })
  // the toolbar
  for (const [key, t2] of [['showDone', 'showDone'], ['mute', 'mute'], ['lang', 'lang'], ['help', 'help'], ['demo', 'demo'], ['still', 'still']] as const) {
    const b = nodes(tree).find(n => n.type === 'Button' && n.props.key === key)!
    ;(b.props.onPress as () => void)()
    expect(f.posts[f.posts.length - 1]).toEqual({ t: t2 })
  }
  // the empty office: the message, the sub lines, the demo Button; no rows
  const empty = props({ rooms: [], counts: { run: 0, idle: 0, done: 0 }, empty: { kind: 'office', msg: LABELS.emptyOffice ?? '', sub: LABELS.emptySub ?? '' } })
  tree = Office(empty, fake().surface)
  expect(texts(tree)).toMatch(/המשרד ריק/)
  expect(nodes(tree).find(n => n.type === 'Button' && n.props.key === 'watchDemo')).toBeDefined()
  const nomatch = props({ rooms: [], empty: { kind: 'nomatch', msg: LABELS.emptyNoMatch ?? '', sub: '' } })
  expect(nodes(Office(nomatch, fake().surface)).find(n => n.type === 'Button' && n.props.key === 'watchDemo')).toBeUndefined()
  // the header: the usage meter when given
  expect(texts(Office({ ...p, usage: { pct: 42.4, resetsAt: '2026-10-10T14:30:00Z' } }, fake().surface))).toMatch(/⏳ 5h 42%/)
  expect(texts(Office({ ...p, usage: { pct: 85, resetsAt: '' } }, fake().surface))).toMatch(/⚠ 5h 85%/)
})

test('never throws: a broken props object draws a short red Text', () => {
  const f = fake()
  const broken = { ...props(), rooms: null } as unknown as OfficeProps
  const tree = Office(broken, f.surface) as unknown as Node
  expect(tree.type).toBe('Text')
  expect(tree.props.color).toBe('red')
  expect(texts(tree)).toMatch(/^office: /)
  // and the next good props draw the office again
  expect(texts(Office(props(), f.surface))).toMatch(/🟢 2/)
  // a throw after a good render drops the drawn window: the pointer hits nothing the office no longer draws
  const C = chromeRows(props())
  f.pointer({ type: 'down', x: props().columns - TILE_W + 2, y: C + 1 + 2, button: 'left' })
  expect(f.posts).toEqual([{ t: 'open', id: 'lead' }])
  Office(broken, f.surface)
  expect(f.surface.state!.inst.win).toEqual({ from: 0, count: 0 })
  f.pointer({ type: 'down', x: props().columns - TILE_W + 2, y: C + 1 + 2, button: 'left' })
  f.pointer({ type: 'move', x: props().columns - TILE_W + 2, y: C + 1 + 2 })
  expect(f.posts).toHaveLength(1)
  expect(f.surface.state!.hover).toBeNull()
})

test('limits: 100 agents with the drawer open at every width 24..200 stay under 20,000 nodes, 32 deep, 100,000 characters, with no bidi marks', { timeoutMs: 30_000 }, () => {
  const agents = Array.from({ length: 100 }, (_, i) => ag(`agent-${i}`, { name: `סוכן ${i}`, act: i % 3 ? '📖 קורא' : '✍️ כותב', star: i % 7 === 0 ? 1 : 0, failed: i % 11 === 0, longRunning: i % 5 === 0, modelFam: (['opus', 'sonnet', 'haiku', 'fable', 'other'] as const)[i % 5]! }))
  const rooms = [room('A', agents.slice(0, 40)), room('B', agents.slice(40, 70)), room('C', agents.slice(70))]
  const d = drawer({ task: 'x'.repeat(4000), result: 'y'.repeat(4000), truncated: true })
  /** Each size's first render on a fresh instance: the init, the layout and the tree, no memo. */
  const cold: number[] = []
  let maxJson = 0
  // 40-row windows at ten widths, then the tall + wide panes a maximized window reaches (200 \u00d7 80, 250 \u00d7 80)
  const sizes = [[24, 40], [25, 40], [31, 40], [45, 40], [60, 40], [72, 40], [100, 40], [120, 40], [160, 40], [200, 40], [200, 80], [250, 80]] as const
  for (const [columns, rows] of sizes) {
    for (const offset of [0, 20]) {
      const f = fake(columns, 0)
      const p = props({ columns, rows, offset, rooms, selected: 'agent-3', drawer: d, helpOpen: false })
      const t0 = performance.now()
      const tree = Office(p, f.surface)
      cold.push(performance.now() - t0)
      const all = nodes(tree)
      expect(all.length).toBeLessThan(20_000)
      expect(depth(tree)).toBeLessThanOrEqual(32)
      const json = JSON.stringify(tree)
      maxJson = Math.max(maxJson, json.length)
      expect(json.length).toBeLessThan(100_000)
      expect(json).not.toMatch(REFUSED_RE) // (the shared set, office-chrome.ts: the bidi controls, ALM included)
      expect(f.setStates()).toBe(1)
      // the window keeps its byte budget: past it the rows are left blank rather than unmounting the instance
      const chrome = chromeRows(p)
      const from = Math.max(0, offset - chrome)
      const chromeElements = 3 + (p.footer ? 1 : 0) + 1   // header, toolbar, search, the drawer Box
      const drawnRows = (tree as unknown as Node).children.length - chromeElements - (from > 0 ? 1 : 0)
      expect(drawnRows).toBe(windowOf(chrome, offset, rows, layoutOffice(p).rows.length, columns).count)
      expect(drawnRows).toBeLessThanOrEqual(Math.floor(WINDOW_CHARS / (ROW_CHARS_PER_COLUMN * columns)))
      if (columns === 200 && rows === 80) expect(drawnRows).toBe(50)
    }
  }
  // widths in between, one window each, every fourth column (the per-column sweep is Task 2.1's; here the tree)
  for (let columns = 24; columns <= 200; columns += 4) {
    const f = fake(columns, 0)
    const tree = Office(props({ columns, rows: 40, offset: 7, rooms, selected: 'agent-3', drawer: d }), f.surface)
    const json = JSON.stringify(tree)
    expect(json.length).toBeLessThan(100_000)
    expect(nodes(tree).length).toBeLessThan(20_000)
  }
  // THE RENDER'S COST against the engine's budget (a second per call on the drawing thread). Measured in isolation on
  // 2026-10-12, 200 x 80 with 100 agents and the drawer open, 20 runs each, on engines 2.1.293 and 2.1.295: a cold
  // render (fresh instance) median 28-31 ms, max 44-57 ms; a hover relayout median 4 ms, max 9-12 ms. A single call
  // timed here also counts what this test process does not control (a full suite's parallel files on a loaded machine
  // stalled one render past 1 s while the median stayed in tens of ms), so the guards are the MEDIANS, an order of
  // magnitude above the measures and far under the budget; the single slowest cold render only has to stay clear of
  // a pathological cost (three budgets).
  const median = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
  expect(median(cold)).toBeLessThan(250)
  expect(Math.max(...cold)).toBeLessThan(3000)
  // warm: a hover moving between two tiles changes the decor, so each render lays the whole office out again
  const hf = fake(200, 0)
  const hp = props({ columns: 200, rows: 80, rooms, selected: 'agent-3', drawer: d })
  Office(hp, hf.surface)
  const hover: number[] = []
  for (let i = 0; i < 20; i++) {
    hf.surface.setState({ ...hf.surface.state!, hover: i % 2 ? 'agent-1' : 'agent-2' })
    const t0 = performance.now()
    Office(hp, hf.surface)
    hover.push(performance.now() - t0)
  }
  expect(hf.surface.state!.inst.layout).toEqual(layoutOffice(hp, { hover: 'agent-1', hop: new Set(), entering: new Map() }))
  expect(median(hover)).toBeLessThan(100)
  // the widest 40-row window with the drawer open serialized to 57,033 characters on 2026-10-11; with the byte budget a
  // 200 × 80 or 250 × 80 pane draws WINDOW_CHARS of rows plus the chrome and the drawer: a regression guard under the bound
  expect(maxJson).toBeLessThan(80_000)
})
