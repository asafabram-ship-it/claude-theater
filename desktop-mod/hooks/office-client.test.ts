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
import { CHROME_ROWS, COMPACT_BELOW, HELP_ROWS, RESULT_LINES, ROW_CHARS_PER_COLUMN, TASK_LINES, WINDOW_CHARS, chromeRows, drawerLines, officeHeight, windowOf } from './office-chrome'
import Office, { FX_BG, FX_DONE_MS, FX_ENTER_MS, FX_STATUS_FRAMES, FX_TICK_MS, SEARCH_DEBOUNCE_MS } from './office-client'
import type { OfficeState } from './office-client'
import { TILE_H, TILE_W, layoutOffice } from './office-layout'
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
})

test('fx: enter / done / status start the frame clock only while active and stop it when the last ends; still disables them', () => {
  const f = fake()
  // the first props prime the stamps: no fx for the agents already there, even with enteredAt set
  let p = withAgents(props(), [ag('lead', { enteredAt: 1000 }), ag('a1', { enteredAt: 2000 })])
  Office(p, f.surface)
  Office(p, f.surface)
  expect(f.timers).toHaveLength(0)
  // a newcomer with a stamp → enter fx: the head row of its tile wears FX_BG.enter, the clock runs
  p = withAgents(p, [...p.rooms[0]!.agents, ag('n1', { enteredAt: 5000 })])
  let tree = Office(p, f.surface)
  expect(withBg(tree, FX_BG.enter).length).toBeGreaterThan(0)
  expect(f.timers).toHaveLength(1)
  expect(f.timers[0]!.ms).toBe(FX_TICK_MS)
  // the same props again: nothing new starts
  Office(p, f.surface)
  Office({ ...p }, f.surface)
  expect(f.timers).toHaveLength(1)
  const sets = f.setStates()
  for (let i = 0; i < Math.ceil(FX_ENTER_MS / FX_TICK_MS) - 1; i++) f.tick()
  expect(f.timers[0]!.stopped).toBe(false)
  f.tick()
  expect(f.timers[0]!.stopped).toBe(true)
  expect(f.setStates()).toBe(sets + Math.ceil(FX_ENTER_MS / FX_TICK_MS))   // one redraw per tick, none besides
  tree = Office(p, f.surface)
  expect(withBg(tree, FX_BG.enter)).toHaveLength(0)
  // a star → done fx (FX_DONE_MS, the head row pulses done/doneAlt by frame parity), a new clock; the same agent's
  // running → done is also a status flash (FX_STATUS_FRAMES on the desk row), which ends first while the hop goes on
  p = withAgents(p, p.rooms[0]!.agents.map(a => a.id === 'a1' ? { ...a, status: 'done' as const, star: 7000 } : a))
  const shown = { ...p, rooms: [{ ...p.rooms[0]!, showDone: true }] }
  tree = Office(shown, f.surface)
  const hop = (t: unknown) => withBg(t, FX_BG.done).length + withBg(t, FX_BG.doneAlt).length
  expect(hop(tree)).toBeGreaterThan(0)
  expect(withBg(tree, FX_BG.status).length).toBeGreaterThan(0)
  expect(f.timers).toHaveLength(2)
  for (let i = 0; i < FX_STATUS_FRAMES; i++) f.tick()
  expect(f.timers[1]!.stopped).toBe(false)         // the status flash is over, the hop still runs the clock
  tree = Office(shown, f.surface)
  expect(withBg(tree, FX_BG.status)).toHaveLength(0)
  expect(hop(tree)).toBeGreaterThan(0)
  for (let i = 0; i < Math.ceil(FX_DONE_MS / FX_TICK_MS) - FX_STATUS_FRAMES; i++) f.tick()
  expect(f.timers[1]!.stopped).toBe(true)
  tree = Office(shown, f.surface)
  expect(hop(tree)).toBe(0)
  // a status change → FX_STATUS_FRAMES frames of the desk row
  p = withAgents(p, p.rooms[0]!.agents.map(a => a.id === 'lead' ? { ...a, status: 'stale' as const } : a))
  tree = Office(p, f.surface)
  expect(withBg(tree, FX_BG.status).length).toBeGreaterThan(0)
  expect(f.timers).toHaveLength(3)
  for (let i = 0; i < FX_STATUS_FRAMES; i++) f.tick()
  expect(f.timers[2]!.stopped).toBe(true)
  // still: a newcomer starts nothing, and a running fx is dropped
  p = withAgents(p, [...p.rooms[0]!.agents, ag('n2', { enteredAt: 9000 })])
  tree = Office({ ...p, prefs: { ...p.prefs, still: true } }, f.surface)
  expect(f.timers).toHaveLength(3)
  expect(withBg(tree, FX_BG.enter)).toHaveLength(0)
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
  // hover: a move over the lead → setState with hover, the head row wears FX_BG.hover; a second move there changes nothing
  const sets = f.setStates()
  f.pointer({ type: 'move', x: p.columns - TILE_W + 2, y: C + 1 + 1 })
  expect(f.surface.state!.hover).toBe('lead')
  expect(f.setStates()).toBe(sets + 1)
  f.pointer({ type: 'move', x: p.columns - TILE_W + 3, y: C + 1 + 1 })
  expect(f.setStates()).toBe(sets + 1)
  const tree = Office(p, f.surface)
  expect(withBg(tree, FX_BG.hover).length).toBeGreaterThan(0)
  f.pointer({ type: 'leave', x: 0, y: 0 })
  expect(f.surface.state!.hover).toBe(null)
  f.pointer({ type: 'leave', x: 0, y: 0 })
  expect(f.setStates()).toBe(sets + 2)
  expect(f.posts.length).toBe(4)   // no post for any move/leave
  // a click on a tile also takes the keyboard focus there
  expect(f.surface.state!.focus).toBe('a1')
})

test('keys after a click: j/k walk the tiles and post focus, o/Enter open, x closes, f/m/l/h/d/s are the toolbar', () => {
  const f = fake()
  const p = props({ rooms: [room('A', [ag('lead'), ag('a1')]), room('B', [ag('b1')])] })
  Office(p, f.surface)
  f.key({ key: 'j' })
  expect(f.posts).toEqual([{ t: 'focus', id: 'lead' }])
  f.key({ key: 'j' })
  f.key({ key: 'down' })
  expect(f.posts[2]).toEqual({ t: 'focus', id: 'b1' })
  f.key({ key: 'j' })                       // clamps at the last
  expect(f.posts.length).toBe(3)
  expect(f.surface.state!.focus).toBe('b1')
  const tree = Office(p, f.surface)
  expect(withBg(tree, FX_BG.focus).length).toBeGreaterThan(0)
  f.key({ key: 'k' })
  expect(f.posts[3]).toEqual({ t: 'focus', id: 'a1' })
  f.key({ key: 'return' })
  expect(f.posts[4]).toEqual({ t: 'open', id: 'a1' })
  f.key({ key: 'o' })
  expect(f.posts[5]).toEqual({ t: 'open', id: 'a1' })
  for (const [k, t] of [['x', 'close'], ['f', 'showDone'], ['m', 'mute'], ['l', 'lang'], ['h', 'help'], ['d', 'demo'], ['s', 'still']] as const) {
    f.key({ key: k })
    expect(f.posts[f.posts.length - 1]).toEqual({ t })
  }
  f.key({ key: 'q' })
  f.key({ key: 'f', ctrl: true })
  expect(f.posts.length).toBe(13)
  // a focused agent that leaves the office: the focus is dropped, no stale post
  Office(withAgents(p, [ag('lead')]), f.surface)
  f.key({ key: 'o' })
  expect(f.posts.length).toBe(13)
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
})

test('limits: 100 agents with the drawer open at every width 24..200 stay under 20,000 nodes, 32 deep, 100,000 characters, with no bidi marks', { timeoutMs: 30_000 }, () => {
  const agents = Array.from({ length: 100 }, (_, i) => ag(`agent-${i}`, { name: `סוכן ${i}`, act: i % 3 ? '📖 קורא' : '✍️ כותב', star: i % 7 === 0 ? 1 : 0, failed: i % 11 === 0, longRunning: i % 5 === 0, modelFam: (['opus', 'sonnet', 'haiku', 'fable', 'other'] as const)[i % 5]! }))
  const rooms = [room('A', agents.slice(0, 40)), room('B', agents.slice(40, 70)), room('C', agents.slice(70))]
  const d = drawer({ task: 'x'.repeat(4000), result: 'y'.repeat(4000), truncated: true })
  let slowest = 0
  let maxJson = 0
  // 40-row windows at ten widths, then the tall + wide panes a maximized window reaches (200 \u00d7 80, 250 \u00d7 80)
  const sizes = [[24, 40], [25, 40], [31, 40], [45, 40], [60, 40], [72, 40], [100, 40], [120, 40], [160, 40], [200, 40], [200, 80], [250, 80]] as const
  for (const [columns, rows] of sizes) {
    for (const offset of [0, 20]) {
      const f = fake(columns, 0)
      const p = props({ columns, rows, offset, rooms, selected: 'agent-3', drawer: d, helpOpen: false })
      const t0 = Date.now()
      const tree = Office(p, f.surface)
      slowest = Math.max(slowest, Date.now() - t0)
      const all = nodes(tree)
      expect(all.length).toBeLessThan(20_000)
      expect(depth(tree)).toBeLessThanOrEqual(32)
      const json = JSON.stringify(tree)
      maxJson = Math.max(maxJson, json.length)
      expect(json.length).toBeLessThan(100_000)
      expect(json).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/)
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
  expect(slowest).toBeLessThan(1000)
  // the widest 40-row window with the drawer open serialized to 57,033 characters on 2026-10-11; with the byte budget a
  // 200 × 80 or 250 × 80 pane draws WINDOW_CHARS of rows plus the chrome and the drawer: a regression guard under the bound
  expect(maxJson).toBeLessThan(80_000)
})
