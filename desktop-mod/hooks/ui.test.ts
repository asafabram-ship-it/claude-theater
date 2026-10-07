// ui.tsx: the office pane. Pure ports first (fmt, elapsed, search, room order,
// the tri-state room toggle, the finish test, the demo office), then the pane
// driven through the engine: session.start starts the poll on a mocked clock,
// a test hook beneath the plugin rewrites each payload write into a fixture,
// and the pane is mounted and acted on by key on the terminal and the desktop
// (and drawn on mobile/vscode, which lack Input / Client).

import type { Agent } from './model'
import { EMPTY_PAYLOAD, JUST_FINISHED_MS, LONG_RUNNING_MS, PERSONA_EMOJI, RUNNING_STALE_SEC } from './model'
import { expect, mock, test } from 'claude-code/testing'

import { activityLabel } from './i18n'
import { assignDistinctPersonas, personaName } from './personas'
import { demoPayload } from './scanner'
import {
  CARD_MAX_W, COLS2_FROM, COLS3_FROM, LEAD_MARK, MIN_WIDTH, agentElapsed, cardName, cellWidth, clip, detectFinishes, emptyKind, fmt, gridFor,
  headerCounts, isLongRunning, joinParts, matchesSearch, officeView, paneTitle, pruneJustFinished, roomShowsDone, roomStats, toggledRoomDone, workingCount,
  TILE_MAX_PER_ROW, minuteClock, renderKey, roomCols, tilesPerRow,
  splitSentence,
} from './ui'
import { ROOM_COLS, ROW_H, ROW_H_TITLED, roomWidth } from './office-svg'

const T0 = 1_700_000_000_000
const SA = 'sess-aaaa-1111-frontend'
const SB = 'sess-bbbb-2222-research'
const PANE = {
  plugin: 'agent-theater', component: 'Pane', requestId: 'agent-theater',
  props: { title: 'T', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

function agent(over: Partial<Agent> & { id: string }): Agent {
  const task = over.task ?? `Task of ${over.id}. More words.`
  return {
    persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: '', subagent_type: '', status: 'running', tool: 'Read', phase: 'tool',
    task, task_short: task.split('. ')[0] + '.', result: null, start_ms: T0 - 30_000, end_ms: null,
    session: SA.slice(0, 8), session_full: SA, cwd: '/home/dev/acme-web', project: '/home/dev/acme-web', mtime_ms: T0 - 1000,
    is_session: false, closed: false, is_workflow: false, truncated: false, model: '', ...over,
  }
}

/** Two rooms: A (lead + a reader + a finished writer), B (one MCP agent). */
function fixture(): Agent[] {
  return [
    agent({ id: 'lead-a', is_session: true, tool: '', phase: 'thinking', task: 'Ship the v2 config migration. Then clean up.', topic: 'Ship the v2 config migration.', start_ms: T0 - 400_000, mtime_ms: T0 - 5000, session: SA.slice(0, 8), session_full: SA }),
    agent({ id: 'a1', role: 'map session-token validation', subagent_type: 'Explore', tool: 'Read', persona_id: 7, model: 'claude-opus-5-5' }),
    agent({ id: 'b1', role: 'triage open bugs', subagent_type: 'general-purpose', tool: 'mcp__github__search_issues', session: SB.slice(0, 8), session_full: SB, project: '/home/dev/research', cwd: '/home/dev/research', mtime_ms: T0 - 20_000, persona_id: 9 }),
    agent({ id: 'a2', role: 'draft the v2 migration guide', subagent_type: 'general-purpose', status: 'done', tool: 'Write', end_ms: T0 - 2000, result: 'Done. Wrote migration-v2.md.', truncated: true, persona_id: 11 }),
  ]
}

test('fmt and the clocks: lead since activity, done final, stale frozen, running live, unknown start', () => {
  expect(fmt(null)).toBe('--:--')
  expect(fmt(-5)).toBe('--:--')
  expect(fmt(61_000)).toBe('01:01')
  const now = T0
  expect(agentElapsed(agent({ id: 'r', start_ms: now - 90_000 }), now)).toBe(90_000)
  expect(agentElapsed(agent({ id: 'd', status: 'done', start_ms: now - 90_000, end_ms: now - 30_000 }), now)).toBe(60_000)
  // PAGE tickTimers: done without end_ms falls through to the live count on the card (the drawer uses last activity)
  expect(agentElapsed(agent({ id: 'd2', status: 'done', start_ms: now - 90_000, end_ms: null, mtime_ms: now - 40_000 }), now)).toBe(90_000)
  expect(agentElapsed(agent({ id: 'd2', status: 'done', start_ms: now - 90_000, end_ms: null, mtime_ms: now - 40_000 }), now, true)).toBe(50_000)
  expect(agentElapsed(agent({ id: 's', status: 'stale', start_ms: now - 90_000, mtime_ms: now - 70_000 }), now)).toBe(20_000)
  expect(agentElapsed(agent({ id: 's2', status: 'stale', start_ms: now - 90_000, mtime_ms: now - 95_000 }), now)).toBe(null)
  expect(agentElapsed(agent({ id: 'l', is_session: true, mtime_ms: now - 7000 }), now)).toBe(7000)
  expect(agentElapsed(agent({ id: 'u', start_ms: null }), now)).toBe(null)
  expect(isLongRunning(agent({ id: 'x', start_ms: now - LONG_RUNNING_MS - 1 }), now)).toBe(true)
  expect(isLongRunning(agent({ id: 'x', start_ms: now - LONG_RUNNING_MS + 1000 }), now)).toBe(false)
  expect(isLongRunning(agent({ id: 'x', is_session: true, start_ms: now - LONG_RUNNING_MS * 2, mtime_ms: now - LONG_RUNNING_MS * 2 }), now)).toBe(false)
})

test('search matches role, task, tool, persona name (per language) and room label', () => {
  const a = agent({ id: 'a', role: 'Triage Bugs', task: 'Pull issues', tool: 'mcp__github__search_issues', persona_id: 0, project: '/x/Acme-Web' })
  expect(matchesSearch(a, 'triage', 'en')).toBe(true)
  expect(matchesSearch(a, 'issues', 'en')).toBe(true)
  expect(matchesSearch(a, 'github', 'en')).toBe(true)
  expect(matchesSearch(a, 'detective', 'en')).toBe(true)
  expect(matchesSearch(a, 'הבלש', 'he')).toBe(true)
  expect(matchesSearch(a, 'הבלש', 'en')).toBe(false)
  expect(matchesSearch(a, 'acme-web', 'en')).toBe(true)
  expect(matchesSearch(a, 'nothing-here', 'en')).toBe(false)
})

test('officeView: closed chats leave, finished hide per room, pinned rooms first, then running rooms, then by activity', () => {
  const all = fixture()
  all.push(agent({ id: 'c1', status: 'running', session_full: 'sess-cccc', session: 'sess-ccc', closed: true, project: '/c' }))
  const st = roomStats(all)
  expect(st.get(SA)).toMatchObject({ running: 2, done: 1, topic: 'Ship the v2 config migration.', label: 'acme-web' })
  expect(st.get(SB)).toMatchObject({ running: 1, label: 'research' })
  let v = officeView(all, '', 'en', false, {}, [])
  expect(v.rooms).toEqual([SA, SB])
  expect(v.visible.map(a => a.id)).toEqual(['lead-a', 'a1', 'b1'])
  // pinned B comes first
  v = officeView(all, '', 'en', false, {}, [SB])
  expect(v.rooms).toEqual([SB, SA])
  expect(v.order.map(a => a.id)).toEqual(['b1', 'lead-a', 'a1'])
  // a room override shows its finished
  v = officeView(all, '', 'en', false, { [SA]: true }, [])
  expect(v.visible.map(a => a.id)).toContain('a2')
  // the global toggle with a room opt-out
  v = officeView(all, '', 'en', true, { [SA]: false }, [])
  expect(v.visible.map(a => a.id)).not.toContain('a2')
  // search narrows rooms
  v = officeView(all, 'triage', 'en', true, {}, [])
  expect(v.rooms).toEqual([SB])
  expect(emptyKind('zzz', 5, false)).toBe('nomatch')
  expect(emptyKind('', 0, false)).toBe('office')
  expect(emptyKind('', 5, false)).toBe('noactive')
  expect(emptyKind('', 5, true)).toBe('nonewindow')
  expect(headerCounts(all)).toEqual({ run: 3, idle: 0, done: 1 })
})

test('room "show finished" is tri-state: an override equal to the global toggle is dropped', () => {
  expect(roomShowsDone({}, false, SA)).toBe(false)
  let rd = toggledRoomDone({}, false, SA)
  expect(rd).toEqual({ [SA]: true })
  expect(roomShowsDone(rd, false, SA)).toBe(true)
  rd = toggledRoomDone(rd, false, SA)
  expect(rd).toEqual({})
  rd = toggledRoomDone({}, true, SA)
  expect(rd).toEqual({ [SA]: false })
})

test('detectFinishes fires once, only for a shown card, never on first sight, and prunes', () => {
  const prev: Record<string, Agent['status']> = {}
  const a = agent({ id: 'a' })
  expect(detectFinishes(prev, [a], new Set(['a']))).toEqual([])
  const done = { ...a, status: 'done' as const }
  expect(detectFinishes(prev, [done], new Set()).map(x => x.id)).toEqual([])   // hidden: no beat, but remembered
  expect(prev.a).toBe('done')
  const prev2: Record<string, Agent['status']> = { a: 'running', gone: 'running' }
  expect(detectFinishes(prev2, [done], new Set(['a'])).map(x => x.id)).toEqual(['a'])
  expect(prev2.gone).toBeUndefined()
  expect(detectFinishes(prev2, [done], new Set(['a']))).toEqual([])
  expect(pruneJustFinished({ a: T0, b: T0 - JUST_FINISHED_MS - 1 }, T0 + 1)).toEqual({ a: T0 })
})

test('the demo cast (scanner.demoPayload, the one the pane draws): the 12 s loop, two rooms led by their topics, distinct personas, sorted running/stale/done', () => {
  const p0 = demoPayload(T0, 0)
  expect(p0.demo).toBe(true)
  expect(p0.agents.some(a => a.id === 'demo-newcomer-hh')).toBe(false)
  expect(p0.agents.find(a => a.id === 'demo-finisher-gg')?.status).toBe('running')
  const p6 = demoPayload(T0, 6)
  expect(p6.agents.some(a => a.id === 'demo-newcomer-hh')).toBe(true)
  const fin = p6.agents.find(a => a.id === 'demo-finisher-gg')
  expect(fin?.status).toBe('done')
  expect(fin?.result).toMatch(/3 high/)
  expect(p6.agents.find(a => a.id === 'demo-mcp-dd')?.tool).toBe('mcp__github__search_issues')
  expect(activityLabel(p6.agents.find(a => a.id === 'demo-mcp-dd')!, 'he')).toBe('🔌 github')
  // Python's cast verbatim: 7 agents + the newcomer + 2 leads, the MCP triager 63 s in, no ⏰ subject
  expect(p6.agents).toHaveLength(10)
  expect(T0 - (p6.agents.find(a => a.id === 'demo-mcp-dd')?.start_ms ?? 0)).toBe(63_000)
  expect(p6.agents.some(a => isLongRunning(a, T0))).toBe(false)
  // by time: phase = floor(now/1000) % 12
  expect(demoPayload(7000).agents.find(a => a.id === 'demo-finisher-gg')?.status).toBe('done')
  expect(demoPayload(2000).agents.find(a => a.id === 'demo-finisher-gg')?.status).toBe('running')
  // the leads first within running, newest first after
  expect(p6.agents[0]?.is_session).toBe(true)
  expect(p6.agents[1]?.is_session).toBe(true)
  const statuses = p6.agents.map(a => a.status)
  expect(statuses.indexOf('stale')).toBeGreaterThan(statuses.lastIndexOf('running'))
  expect(statuses.indexOf('done')).toBeGreaterThan(statuses.lastIndexOf('stale'))
  // personas distinct per room
  for (const room of [p6.agents.filter(a => a.session_full.endsWith('1111')), p6.agents.filter(a => a.session_full.endsWith('2222'))]) {
    const ids = room.map(a => a.persona_id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of room) expect(a.emoji).toBe(PERSONA_EMOJI[a.persona_id])
  }
  const seated = assignDistinctPersonas([agent({ id: 'x', persona_id: 5 }), agent({ id: 'y', persona_id: 5 })])
  expect(seated.map(a => a.persona_id).sort()).toEqual([5, 6])
  expect(cardName(agent({ id: 'n', role: '', persona_id: 0 }), 'he')).toBe(personaName(0, 'he'))
  expect(paneTitle('he')).toBe('🎭 התיאטרון')
  // PAGE document.title: the live working-count of open chats
  const all = fixture()
  expect(workingCount({ agents: all })).toBe(3)
  expect(workingCount({ agents: [...all, agent({ id: 'closed', closed: true })] })).toBe(3)
  expect(paneTitle('en', 3)).toBe('🟢 3 · 🎭 Theater')
  expect(paneTitle('he', 0)).toBe('🎭 התיאטרון')
})

test('joinParts: a "·" only between two non-empty parts, never dangling', () => {
  expect(joinParts(['📖 קורא', 'Explore', '🧠 Opus 5.5'])).toEqual(['📖 קורא', '·', 'Explore', '·', '🧠 Opus 5.5'])
  expect(joinParts(['📖 קורא', '', '🧠 Opus 5.5'])).toEqual(['📖 קורא', '·', '🧠 Opus 5.5']) // empty subagent_type leaves no trace
  expect(joinParts(['📖 קורא', '', ''])).toEqual(['📖 קורא'])
  expect(joinParts(['', 'x', ''])).toEqual(['x'])
  expect(joinParts([])).toEqual([])
})

test('layout budget: cell widths, end-clipping with an ellipsis, the card grid per bodyColumns', () => {
  expect(cellWidth('abc')).toBe(3)
  expect(cellWidth('שלום')).toBe(4)
  expect(cellWidth('🟢 3')).toBe(4)
  expect(cellWidth('✍️')).toBe(2) // the variation selector takes no cell
  expect(clip('Session without choosing a project', 40)).toBe('Session without choosing a project')
  // the START stays, the END is cut (an RTL row must never lose an English title's beginning)
  expect(clip('Session without choosing a project', 12)).toBe('Session wit…')
  expect(cellWidth(clip('🕵️ map session-token validation', 10))).toBeLessThanOrEqual(10)
  expect(clip('x', 0)).toBe('')
  expect(clip('abc', 1)).toBe('…')
  // 1 / 2 / 3 cards per row; cards fill the row (1-cell gutter) and never exceed the body
  for (const w of [24, 40, 45, 59, 60, 71, 72, 90, 119, 120, 140, 200]) {
    const g = gridFor(w)
    expect(g.perRow).toBe(w >= COLS3_FROM ? 3 : w >= COLS2_FROM ? 2 : 1)
    expect(g.cardW * g.perRow + (g.perRow - 1)).toBeLessThanOrEqual(Math.max(MIN_WIDTH, w))
    expect(g.cardW).toBeLessThanOrEqual(CARD_MAX_W)
    expect(g.cardW).toBeGreaterThanOrEqual(20)
  }
  expect(gridFor(40).cardW).toBe(40)
  expect(gridFor(90).cardW).toBe(44)
  expect(gridFor(140).cardW).toBe(46)
})

type On = Parameters<typeof mock.store>[0]

/** The pane's message (empty office, no match): an engine Text on the text surfaces, a line of the message SVG on the desktop. */
async function messageOf(ui: { find: (q: { type: string; text?: RegExp }) => Promise<{ props: Record<string, unknown> } | undefined> }, surface: string, re: RegExp): Promise<boolean> {
  if (surface !== 'desktop') return (await ui.find({ type: 'Text', text: re })) !== undefined
  const svg = await ui.find({ type: 'Svg' })
  return svg !== undefined && re.test(String(svg.props.source))
}

/** An in-memory ~/.claude for `beneath`: path → text + mtime (sizes are the text's length). */
type MemFiles = Map<string, { text: string; mtimeMs: number }>

function beneath(on: On, current: () => Agent[], store: Record<string, unknown> = {}, files?: MemFiles) {
  const captured = {
    toasts: [] as string[], plays: 0, opens: [] as string[], store: { ...store } as Record<string, unknown>,
    /** $.state writes seen beneath the plugin, by key (the flicker guard's budget). */
    writes: { payload: 0, scanError: 0, view: 0, tick: 0 },
    /** $.state reads of `prefs` seen beneath the plugin: the pane's render reads it once per draw (the poll only on a retitle), so it counts the redraws. */
    prefsReads: 0,
  }
  const clock = mock.clock(on, { now: T0 })
  // an in-memory store the test can read back (mock.store would hook store.set
  // itself, and an event may be hooked only once per module)
  on('store.get', ($, e) => ({ value: captured.store[e.key] }))
  on('store.set', ($, e) => { captured.store[e.key] = e.value; return { value: undefined } })
  on('store.delete', ($, e) => { delete captured.store[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(captured.store) }))
  mock.env(on, { HOME: 'C:/Users/test', USERPROFILE: 'C:/Users/test' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'test-session' }))
  // nothing beneath the plugins answers command.register: without this the plugin's
  // session.start would abort before starting the poll
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('agent.list', () => ({ value: [] }))
  // the file system beneath: an empty ~/.claude, or the in-memory `files` (then the scanner's own payload is published, unrewritten)
  const dirsOf = () => {
    const dirs = new Set<string>()
    for (const p of files?.keys() ?? []) {
      let d = p
      for (;;) {
        const i = d.lastIndexOf('/')
        if (i <= 0) break
        d = d.slice(0, i)
        dirs.add(d)
      }
    }
    return dirs
  }
  // (the engine hands a hook the path in the platform's separators: back to "/")
  const norm = (p: string) => p.split("\\").join("/")
  on('fs.exists', ($, e) => ({ value: files !== undefined && (files.has(norm(e.path)) || dirsOf().has(norm(e.path))) }))
  on('fs.list', ($, e) => {
    if (!files) return { value: [] }
    const dir = norm(e.path)
    if (!dirsOf().has(dir)) throw new Error(`ENOENT: ${dir}`)
    const out: Array<{ name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }> = []
    const sub = new Set<string>()
    for (const [p, f] of files) {
      if (!p.startsWith(dir + '/')) continue
      const rest = p.slice(dir.length + 1)
      const slash = rest.indexOf('/')
      if (slash < 0) out.push({ name: rest, kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })
      else sub.add(rest.slice(0, slash))
    }
    for (const d of sub) out.push({ name: d, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
    return { value: out }
  })
  on('fs.stat', ($, e) => {
    const f = files?.get(norm(e.path))
    if (f) return { value: { kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } }
    if (files && dirsOf().has(norm(e.path))) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('fs.read', ($, e) => {
    const f = files?.get(norm(e.path))
    if (!f) throw new Error(`ENOENT: ${e.path}`)
    return { value: f.text }
  })
  on('ui.toast', ($, e) => { captured.toasts.push(e.text); return { value: undefined } })
  on('audio.play', () => { captured.plays += 1; return { value: undefined } })
  on('ui.open', ($, e) => { captured.opens.push(e.title ?? e.id); return { value: { isPlaced: true as const } } })
  // the pane is up: the poll scans only while $.ui.panes() lists it shown (PAGE polled only while visible)
  on('ui.panes', () => ({ value: [{ id: 'agent-theater', title: 'T', isShown: true, isFocused: false, isPlaced: true }] }))
  on('ui.focus', () => ({}))
  // the poll's payload write becomes the fixture of the moment (unless the scanner reads `files`: then it is counted and kept)
  on('state.set', { plugin: 'agent-theater', key: 'payload' }, ($, e, next) => {
    captured.writes.payload += 1
    return files ? next(e) : next({ ...e, value: { ...EMPTY_PAYLOAD, agents: current(), scanned_ms: clock.now() } })
  })
  on('state.get', { plugin: 'agent-theater', key: 'prefs' }, ($, e, next) => { captured.prefsReads += 1; return next(e) })
  on('state.set', { plugin: 'agent-theater', key: 'scanError' }, ($, e, next) => { captured.writes.scanError += 1; return next(e) })
  on('state.set', { plugin: 'agent-theater', key: 'view' }, ($, e, next) => { captured.writes.view += 1; return next(e) })
  on('state.set', { plugin: 'agent-theater', key: 'tick' }, ($, e, next) => { captured.writes.tick += 1; return next(e) })
  return { captured, clock }
}

/** A quiet office on disk (HOME = C:/Users/test): one open conversation (its lead answering on Fable) with two subagents, one of them on Opus. */
const QHOME = 'C:/Users/test'
const QPROJ = `${QHOME}/.claude/projects/-C-x`
const QSESS = 'sess-quiet-0001'
const Q1 = `${QPROJ}/${QSESS}/subagents/agent-q1.jsonl`
function quietOffice(now: number): MemFiles {
  const rec = (o: Record<string, unknown>) => JSON.stringify(o)
  const files: MemFiles = new Map()
  files.set(`${QPROJ}/${QSESS}.jsonl`, {
    text: [
      rec({ type: 'user', sessionId: QSESS, cwd: 'C:/x', timestamp: '2026-06-01T09:00:00.000Z', message: { role: 'user', content: 'Quiet office test. Nothing moves.' } }),
      rec({ type: 'assistant', sessionId: QSESS, timestamp: '2026-06-01T09:00:01.000Z', message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text: 'Watching.' }] } }),
    ].join('\n') + '\n',
    mtimeMs: now - 5000,
  })
  // q1: mid-tool (Read), no model named
  files.set(Q1, {
    text: [
      rec({ type: 'user', agentId: 'q1', sessionId: QSESS, timestamp: '2026-06-01T10:00:00.000Z', cwd: 'C:/x', version: '2.1.0', message: { content: 'Find all TODO comments.' } }),
      rec({ type: 'assistant', timestamp: '2026-06-01T10:00:03.000Z', version: '2.1.0', message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'TODO' } }] } }),
      rec({ type: 'user', timestamp: '2026-06-01T10:00:04.000Z', version: '2.1.0', message: { content: [{ type: 'tool_result', content: '12 matches' }] } }),
      rec({ type: 'assistant', timestamp: '2026-06-01T10:00:05.000Z', version: '2.1.0', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/app.py' } }] } }),
    ].join('\n') + '\n',
    mtimeMs: now - 10_000,
  })
  // q2: mid-tool (Bash) on Opus
  files.set(`${QPROJ}/${QSESS}/subagents/agent-q2.jsonl`, {
    text: [
      rec({ type: 'user', agentId: 'q2', sessionId: QSESS, timestamp: '2026-06-01T10:00:00.000Z', cwd: 'C:/x', version: '2.1.0', message: { content: 'Run the tests.' } }),
      rec({ type: 'assistant', timestamp: '2026-06-01T10:00:05.000Z', version: '2.1.0', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pytest' } }] } }),
    ].join('\n') + '\n',
    mtimeMs: now - 8000,
  })
  files.set(`${QHOME}/.claude/sessions/7.json`, { text: JSON.stringify({ pid: 7, sessionId: QSESS }), mtimeMs: now })
  return files
}

/** A mounted drawing's finder (what `$.ui.mount` answers), structurally. */
type Mounted = { findAll: (q: { type?: string }) => Promise<Array<{ props: Record<string, unknown> }>> }

/**
 * DESKTOP: a card's texts live inside its ROOM's SVG (one per room); the room SVG whose markup
 * carries `data-id="<id>"`, and the tile's own `<g>` markup cut out of it.
 */
async function tileOf(ui: Mounted, id: string): Promise<{ source: string; tile: string; alt: string; isInteractive: unknown; width: unknown; height: unknown } | undefined> {
  const t = (await ui.findAll({ type: 'Svg' })).find(x => String(x.props.source).includes(`data-id="${id}"`))
  if (!t) return undefined
  const source = String(t.props.source)
  const start = source.lastIndexOf('<g class="ws', source.indexOf(`data-id="${id}"`))
  const end = source.indexOf('<g class="ws', start + 1)
  const tile = source.slice(start, end < 0 ? source.lastIndexOf('</svg>') : end)
  return { source, tile, alt: String(t.props.alt), isInteractive: t.props.isInteractive, width: t.props.width, height: t.props.height }
}

/** DESKTOP: the room SVG of session `s` (the one whose alt starts with its title). */
async function roomSvgOf(ui: Mounted, titleStart: string): Promise<{ source: string; alt: string } | undefined> {
  const t = (await ui.findAll({ type: 'Svg' })).find(x => String(x.props.alt).startsWith(titleStart))
  return t ? { source: String(t.props.source), alt: String(t.props.alt) } : undefined
}

test('the office draws rooms, cards, counts and the footer on every surface', async ($, on) => {
  let agents = fixture()
  const { clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /משרד הסוכנים/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /🟢 3 עובדים/ }))?.text).toMatch(/✅ 1 סיימו/)
    // rooms: A leads with its topic, B with its project; A first (newer activity)
    if (surface === 'desktop') {
      // the desktop's room title is drawn inside the room SVG (no engine Text with 💬 anywhere)
      expect((await roomSvgOf(ui, '💬 Ship the v2 config migration.'))?.source).toMatch(/class="room-title"[^>]*>💬 Ship the v2 config migration\.</)
      expect((await roomSvgOf(ui, '💬 research'))?.source).toMatch(/class="room-title"[^>]*>💬 research</)
      expect(await ui.find({ type: 'Text', text: /💬/ })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Text', text: /💬 Ship the v2 config migration\./ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /💬 research/ })).toBeDefined()
    }
    // cards: the Agent description is the name; MCP tool → 🔌 server; finished hidden
    expect(await ui.find({ key: 'open:a1' })).toBeDefined()
    if (surface === 'desktop') {
      // the desktop's card is a tile of its room's SVG: its texts are in the markup / alt, the Button its number
      expect((await tileOf(ui, 'a1'))?.alt).toMatch(/map session-token validation/)
      expect((await tileOf(ui, 'a1'))?.alt).toMatch(/📖 קורא/)
      expect((await tileOf(ui, 'b1'))?.alt).toMatch(/🔌 github/)
      expect(await tileOf(ui, 'a2')).toBeUndefined()
    } else {
      expect((await ui.find({ key: 'open:a1' }))?.text).toMatch(/map session-token validation/)
      expect(await ui.find({ type: 'Text', text: /🔌 github/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /📖 קורא/ })).toBeDefined()
      expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
    }
    expect(await ui.find({ key: 'open:a2' })).toBeUndefined()
    expect(await ui.find({ key: 'rdone:' + SA })).toBeDefined()
    if (surface === 'mobile') expect(await ui.find({ key: 'search' })).toBeUndefined()
    else expect(await ui.find({ key: 'search' })).toBeDefined()
    await ui.unmount()
  }
  // the scan error and the oversized count reach the footer
  agents = fixture()
  await clock.advance(1500)
})

test('the pane fits narrow, medium and wide bodies: cards, keys, the compact header/toolbar and the 🧠 model tag', async ($, on) => {
  const agents = fixture()
  const { clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  for (const bodyColumns of [40, 70, 140] as const) {
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns } })
      // every card, room toggle and control is there whatever the width
      for (const key of ['open:lead-a', 'open:a1', 'open:b1', 'rdone:' + SA, 'pin:' + SA, 'pin:' + SB, 'showDone', 'mute', 'lang', 'help', 'demo', 'search', 'prev', 'next', 'openFocused']) {
        expect(await ui.find({ key })).toBeDefined()
      }
      expect(await ui.find({ key: 'open:a2' })).toBeUndefined()
      // the model: a1 runs on claude-opus-5-5 → "🧠 Opus 5.5" on its second line; EVERY card has the
      // line — b1's model is unknown → "🧠 ?" (never a dropped segment)
      if (surface === 'desktop') {
        // the tile draws the model PILL (its tooltip/alt name it); no engine Text carries the tag
        expect((await tileOf(ui, 'a1'))?.tile).toMatch(/class="pill m-opus"/)
        expect((await tileOf(ui, 'a1'))?.tile).toMatch(/class="pillt m-opus"[^>]*>Opus 5\.5</)
        expect((await tileOf(ui, 'b1'))?.tile).toMatch(/class="pill m-other"/)
        expect((await tileOf(ui, 'b1'))?.tile).toMatch(/class="pillt m-other"[^>]*>\?</)
        expect((await tileOf(ui, 'b1'))?.alt).toMatch(/🧠 \?/)
        expect(await ui.find({ type: 'Text', text: /🧠/ })).toBeUndefined()
      } else {
        expect((await ui.find({ type: 'Text', text: /^🧠 Opus 5\.5$/ }))).toBeDefined()
        // three cards (lead-a, a1, b1), three model segments: the two without a model say "🧠 ?"
        expect(await ui.findAll({ type: 'Text', text: /^🧠 / })).toHaveLength(3)
        expect(await ui.findAll({ type: 'Text', text: /^🧠 \?$/ })).toHaveLength(2)
      }
      // the "·" is its own segment BETWEEN two parts: no Text carries a dangling separator at either end
      expect(await ui.find({ type: 'Text', text: /(^·\s+\S|\S\s+·$)/ })).toBeUndefined()
      // the lead's 💬 rides its name on the card's first line; no lone 💬 anywhere
      if (surface === 'desktop') {
        expect((await tileOf(ui, 'lead-a'))?.tile).toMatch(/ is-session[" ]/)
        expect((await tileOf(ui, 'lead-a'))?.tile.includes(LEAD_MARK)).toBe(true)
        expect((await tileOf(ui, 'a1'))?.tile.includes(LEAD_MARK)).toBe(false)
      } else {
        expect((await ui.find({ key: 'open:lead-a' }))?.text.startsWith(`${LEAD_MARK} `)).toBe(true)
        expect((await ui.find({ key: 'open:a1' }))?.text.includes(LEAD_MARK)).toBe(false)
      }
      expect(await ui.find({ type: 'Text', text: /^\s*💬\s*$/ })).toBeUndefined()
      // the search is the Input alone: no submit button beside it
      expect(await ui.find({ type: 'Button', text: /^(חיפוש|Search)$/ })).toBeUndefined()
      // room headers keep their beginning; the timer sits on the card's first line
      if (surface === 'desktop') {
        expect((await roomSvgOf(ui, '💬 Ship the v2'))?.source).toMatch(/class="room-title"[^>]*>💬 Ship the v2/)
        expect((await roomSvgOf(ui, '💬 research'))?.source).toMatch(/class="room-title"[^>]*>💬 research</)
        // the engine's header line holds 📌 and the counts alone: no Text with a 💬, so nothing to wrap or strand
        expect(await ui.find({ type: 'Text', text: /💬/ })).toBeUndefined()
      } else {
        expect(await ui.find({ type: 'Text', text: /^💬 Ship the v2/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /💬 research/ })).toBeDefined()
      }
      // a1 started 30 s before T0; the poll advanced 1.5 s — the desktop tile says it in minutes (no seconds: a stable source)
      if (surface === 'desktop') {
        expect((await tileOf(ui, 'a1'))?.tile).toMatch(/class="timer"[^>]*>&lt;1 דק׳</)
        expect((await tileOf(ui, 'a1'))?.source.includes('00:3')).toBe(false)
      } else expect(await ui.find({ type: 'Text', text: /^00:3\d$/ })).toBeDefined()
      if (bodyColumns < 60) {
        // compact: icon-only header and toolbar, no worded counts, no key-hint chips
        expect(await ui.find({ type: 'Text', text: /🟢3 ✅1/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /עובדים/ })).toBeUndefined()
        expect((await ui.find({ key: 'showDone' }))?.text).toBe('☐')
        expect((await ui.find({ key: 'lang' }))?.text).toBe('EN')
        expect((await ui.find({ key: 'demo' }))?.text).toBe('🎬')
      } else {
        expect(await ui.find({ type: 'Text', text: /משרד הסוכנים/ })).toBeDefined()
        expect((await ui.find({ type: 'Text', text: /🟢 3 עובדים/ }))?.text).toMatch(/✅ 1 סיימו/)
        expect((await ui.find({ key: 'showDone' }))?.text).toMatch(/הצג שהושלמו/)
      }
      // the name label is clipped to the card, never wider than it
      const g = gridFor(bodyColumns)
      if (surface === 'desktop') expect((await ui.find({ key: 'open:a1' }))?.text).toMatch(/^2 /) // the lead is 1, a1 is 2 in room A
      else expect(cellWidth((await ui.find({ key: 'open:a1' }))?.text ?? '')).toBeLessThanOrEqual(g.cardW - 2 - 6)
      // the drawer shows the model row
      await ui.press({ key: 'open:a1' })
      expect(await ui.find({ type: 'Text', text: /^מודל$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^🧠 Opus 5\.5$/ })).toBeDefined()
      await ui.press({ key: 'close' })
      // b1 carries no model → the drawer's model row still shows, as "🧠 ?" (which model runs an agent is never in doubt)
      await ui.press({ key: 'open:b1' })
      expect(await ui.find({ type: 'Text', text: /^מודל$/ })).toBeDefined()
      if (surface === 'desktop') expect(await ui.findAll({ type: 'Text', text: /^🧠 \?$/ })).toHaveLength(1) // the drawer's row alone (tiles carry pills)
      else expect(await ui.findAll({ type: 'Text', text: /^🧠 \?$/ })).toHaveLength(3) // two cards + the drawer's row
      await ui.press({ key: 'close' })
      await ui.unmount()
    }
  }
})

test('presses: show finished, mute, language (RTL→LTR, retitle), pin, room toggle, drawer, search', async ($, on) => {
  const agents = fixture()
  const { captured, clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // show finished → a2 appears, mirrored to the store
    await ui.press({ key: 'showDone' })
    expect(await ui.find({ key: 'open:a2' })).toBeDefined()
    expect((captured.store.prefs as { showDone: boolean }).showDone).toBe(true)
    await ui.press({ key: 'showDone' })
    expect(await ui.find({ key: 'open:a2' })).toBeUndefined()
    // the room's own ✅ toggle shows its finished without the global flag
    await ui.press({ key: 'rdone:' + SA })
    expect(await ui.find({ key: 'open:a2' })).toBeDefined()
    expect((captured.store.roomDone as Record<string, boolean>)[SA]).toBe(true)
    await ui.press({ key: 'rdone:' + SA })
    expect(await ui.find({ key: 'open:a2' })).toBeUndefined()
    // mute
    expect((await ui.find({ key: 'mute' }))?.text).toBe('🔔')
    await ui.press({ key: 'mute' })
    expect((await ui.find({ key: 'mute' }))?.text).toBe('🔕')
    expect((captured.store.prefs as { muted: boolean }).muted).toBe(true)
    await ui.press({ key: 'mute' })
    // language: English strings, the pane retitled
    await ui.press({ key: 'lang' })
    expect(await ui.find({ type: 'Text', text: /Claude Theater/ })).toBeDefined()
    if (surface === 'desktop') {
      expect((await tileOf(ui, 'b1'))?.alt).toMatch(/🔌 github/)
      expect((await tileOf(ui, 'a1'))?.alt).toMatch(/📖 Reading/)
      expect((await tileOf(ui, 'a1'))?.source).toMatch(/xml:lang="en"/)
    } else {
      expect(await ui.find({ type: 'Text', text: /🔌 github/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /📖 Reading/ })).toBeDefined()
    }
    expect(captured.opens).toContain('🟢 3 · 🎭 Theater') // retitled with the working count (3 running)
    expect((captured.store.prefs as { lang: string }).lang).toBe('en')
    await ui.press({ key: 'lang' })
    expect(await ui.find({ type: 'Text', text: /משרד הסוכנים/ })).toBeDefined()
    // pin B → B's room comes first in the walk
    await ui.press({ key: 'pin:' + SB })
    expect((captured.store.prefs as { pins: string[] }).pins).toEqual([SB])
    await ui.press({ key: 'next' })
    expect((await ui.find({ key: 'openFocused' }))).toBeDefined()
    await ui.press({ key: 'openFocused' })
    expect(await ui.find({ key: 'close' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Task of b1\. More words\./ })).toBeDefined()
    await ui.press({ key: 'close' })
    expect(await ui.find({ key: 'close' })).toBeUndefined()
    await ui.press({ key: 'pin:' + SB })
    // the drawer from a card: chips, activity, task, result + the truncation note (a2 is done → via the room toggle)
    await ui.press({ key: 'rdone:' + SA })
    await ui.press({ key: 'open:a2' })
    expect(await ui.find({ type: 'Text', text: /סיים/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Done\. Wrote migration-v2\.md\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /התוצאה קוצרה/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /general-purpose/ })).toBeDefined()
    await ui.press({ key: 'close' })
    await ui.press({ key: 'rdone:' + SA })
    // search narrows the office; no match → the empty line
    await ui.input({ key: 'search', text: 'triage', kind: 'change' })
    expect(await ui.find({ key: 'open:b1' })).toBeDefined()
    expect(await ui.find({ key: 'open:a1' })).toBeUndefined()
    await ui.input({ key: 'search', text: 'zzz-nothing' })
    expect(await messageOf(ui, surface, /אין סוכנים שתואמים/)).toBe(true)
    await ui.input({ key: 'search', text: '', kind: 'change' })
    expect(await ui.find({ key: 'open:a1' })).toBeDefined()
    // help popover
    await ui.press({ key: 'help' })
    expect(await ui.find({ type: 'Text', text: /קיצורי מקלדת/ })).toBeDefined()
    await ui.press({ key: 'closeHelp' })
    expect(await ui.find({ type: 'Text', text: /קיצורי מקלדת/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the finish beat: a shown agent that turns done gets ⭐, confetti, a toast and the chime (unless muted)', async ($, on) => {
  let agents = fixture()
  const { captured, clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: true, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /⭐/ })).toBeUndefined()
  // a1 finishes
  agents = fixture().map(a => (a.id === 'a1' ? { ...a, status: 'done' as const, end_ms: clock.now(), result: 'mapped 4 places' } : a))
  await clock.advance(1500)
  expect(captured.toasts).toEqual(['map session-token validation — סיים'])
  expect(captured.plays).toBe(1)
  expect(await ui.find({ type: 'Text', text: /⭐/ })).toBeDefined()
  const burst = await ui.find({ type: 'Client' })
  expect(burst?.key).toBe('confetti:a1')
  await ui.advance(90 * 12 + 10)
  expect((await ui.find({ in: 'confetti:a1', type: 'Text' }))?.text).toMatch(/[🎉✨🎊⭐✅]/)
  // no replay on the next poll; the star outlives the burst and dies after the window
  await clock.advance(1500)
  expect(captured.plays).toBe(1)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /⭐/ })).toBeDefined()
  await clock.advance(JUST_FINISHED_MS + 1500)
  expect(await ui.find({ type: 'Text', text: /⭐/ })).toBeUndefined()
  // muted: toast but no chime
  await ui.press({ key: 'mute' })
  agents = agents.map(a => (a.id === 'b1' ? { ...a, status: 'done' as const, end_ms: clock.now(), result: 'triaged' } : a))
  await clock.advance(1500)
  expect(captured.toasts.length).toBe(2)
  expect(captured.plays).toBe(1)
  // a hidden finish (room hides its finished) is remembered, never celebrated later
  await ui.press({ key: 'showDone' })
  agents = agents.map(a => (a.id === 'lead-a' ? { ...a, status: 'done' as const, end_ms: clock.now() } : a))
  await clock.advance(1500)
  await ui.press({ key: 'showDone' })
  await clock.advance(1500)
  expect(captured.toasts.length).toBe(2)
  await ui.unmount()
})

test('DESKTOP: each room is scalable interactive SVG rows with numbered tiles and a row of numbered open Buttons; a newcomer walks in; the finish is the tile\'s own (no confetti Client)', async ($, on) => {
  let agents = fixture().map(a => (a.id === 'lead-a' ? { ...a, model: 'claude-fable-5-1' } : a))
  const { captured, clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 45 } })
  // two rooms of one row each → two SVGs, each interactive, with a viewBox and its intrinsic size in the MARKUP
  // (the host sizes the box from it: the markup's own height at the drawn width) and NO width/height PROPS
  // (the box takes the slot's width, so the drawing scales with the pane)
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs).toHaveLength(2)
  for (const sv of svgs) {
    expect(sv.props.isInteractive).toBe(true)
    expect(sv.props.width).toBeUndefined()
    expect(sv.props.height).toBeUndefined()
    const src = String(sv.props.source)
    expect(src.length).toBeLessThan(131072)
    expect(/^<svg [^>]*viewBox="0 0 (\d+) (\d+)" width="\1" height="\2" style="width:100%;height:100%"/.test(src)).toBe(true)
    expect(src).toMatch(/xml:lang="he"/)
    expect(src).toMatch(/direction="rtl"/)
    expect(src).toMatch(/prefers-color-scheme: light/)
    expect(String(sv.props.alt).length).toBeGreaterThan(0)
  }
  // every room of a render shares ONE column count (and so one viewBox width): 3 at ~45 columns, stepping up at breakpoints
  expect(new Set(svgs.map(sv => /viewBox="0 0 (\d+) /.exec(String(sv.props.source))?.[1])).size).toBe(1)
  expect(roomCols(45)).toBe(ROOM_COLS)
  expect(roomCols(24)).toBe(ROOM_COLS)
  expect(roomCols(89)).toBe(3)
  expect(roomCols(90)).toBe(4)
  expect(roomCols(130)).toBe(5)
  expect(roomCols(140)).toBe(5)
  expect(roomCols(170)).toBe(6)
  expect(roomCols(250)).toBe(TILE_MAX_PER_ROW)
  expect(roomCols(400)).toBe(TILE_MAX_PER_ROW)
  expect(tilesPerRow(45)).toBe(3)
  expect((await roomSvgOf(ui, '💬 Ship the v2'))?.source).toMatch(new RegExp(`viewBox="0 0 ${roomWidth(3)} ${ROW_H_TITLED}"`))
  // every tile has exactly one MODEL PILL: the lead's (Fable, read from its conversation), a1's (Opus), b1's ("?")
  expect((await tileOf(ui, 'lead-a'))?.tile).toMatch(/class="pillt m-fable"[^>]*>Fable 5\.1</)
  expect((await tileOf(ui, 'a1'))?.tile).toMatch(/class="pillt m-opus"[^>]*>Opus 5\.5</)
  expect((await tileOf(ui, 'b1'))?.tile).toMatch(/class="pillt m-other"[^>]*>\?</)
  for (const sv of svgs) {
    const src = String(sv.props.source)
    expect((src.match(/class="pill /g) ?? []).length).toBe((src.match(/<g class="ws /g) ?? []).length)
  }
  // the numbers row is tight: no gap between the small dim Buttons
  expect((await ui.find({ key: 'opens:' + SA }))?.props?.gap).toBe(0)
  // numbered tiles ↔ numbered Buttons: room A = lead-a (1), a1 (2); room B = b1 (1). No tile:<id> Boxes any more.
  for (const [id, n] of [['lead-a', '1'], ['a1', '2'], ['b1', '1']] as const) {
    const t = await tileOf(ui, id)
    expect(t).toBeDefined()
    expect(t?.tile).toMatch(new RegExp(`class="numt"[^>]*>${n}</text>`))
    expect((await ui.find({ key: `open:${id}` }))?.text).toMatch(new RegExp(`^${n} `))
    expect(await ui.find({ key: `tile:${id}` })).toBeUndefined()
  }
  // the tile carries what the text card carried: status, activity, timer (minutes), model, the lead's 💬 — and a full tooltip
  expect((await tileOf(ui, 'a1'))?.tile).toMatch(/class="ws running fam-read/)
  expect((await tileOf(ui, 'a1'))?.tile).toMatch(/<title>2\. \S+ map session-token validation\nTask of a1\.\n📖 קורא · 🧠 Opus 5\.5 · &lt;1 דק׳<\/title>/)
  expect((await tileOf(ui, 'lead-a'))?.tile).toMatch(/<title>1\. [^\n]*\n[^\n]*\n[^\n]*🧠 Fable 5\.1/)
  expect((await tileOf(ui, 'a1'))?.alt).toMatch(/📖 קורא/)
  expect((await tileOf(ui, 'b1'))?.tile).toMatch(/fam-agent/)
  expect((await tileOf(ui, 'lead-a'))?.tile).toMatch(/ is-session/)
  expect((await tileOf(ui, 'lead-a'))?.tile.includes(LEAD_MARK)).toBe(true)
  // STABLE: the next poll (1.5 s later, same wall-clock minute) redraws the very same sources — no frame reload, no flicker
  const before = (await ui.findAll({ type: 'Svg' })).map(x => String(x.props.source))
  expect(before.some(src => src.includes(' entering'))).toBe(true) // first sight: the whole cast walked in
  await clock.advance(1500)
  const settled = (await ui.findAll({ type: 'Svg' })).map(x => String(x.props.source))
  expect(settled.some(src => src.includes(' entering'))).toBe(false) // one-shot: gone on the next poll
  await clock.advance(1500)
  const again = (await ui.findAll({ type: 'Svg' })).map(x => String(x.props.source))
  expect(again).toEqual(settled)
  expect(minuteClock(clock.now())).toBe(minuteClock(clock.now() - 3000))
  // a phase change (a1 moves from Read to Write) changes room A's source and leaves room B's alone
  agents = fixture().map(a => (a.id === 'a1' ? { ...a, tool: 'Write' } : a))
  await clock.advance(1500)
  const changed = (await ui.findAll({ type: 'Svg' })).map(x => String(x.props.source))
  expect(changed[0]).not.toBe(again[0])
  expect(changed[1]).toBe(again[1])
  expect((await tileOf(ui, 'a1'))?.tile).toMatch(/class="ws running fam-write/)
  // the Button opens the drawer exactly as the text card's did; the selection lights the tile (a visible change)
  await ui.press({ key: 'open:a1' })
  expect(await ui.find({ key: 'close' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^🧠 Opus 5\.5$/ })).toBeDefined()
  expect((await tileOf(ui, 'a1'))?.tile).toMatch(/ selected/)
  await ui.press({ key: 'close' })
  expect((await tileOf(ui, 'a1'))?.tile.includes(' selected')).toBe(false)
  // a newcomer walks in on the poll that first shows it (one-shot), and has sat down by the next; it gets the next number
  agents = [...agents, agent({ id: 'newbie', role: 'index the docs', tool: 'Grep', persona_id: 5 })]
  await clock.advance(1500)
  expect((await tileOf(ui, 'newbie'))?.tile).toMatch(/ entering/)
  expect((await tileOf(ui, 'a1'))?.tile.includes(' entering')).toBe(false)
  expect((await ui.find({ key: 'open:newbie' }))?.text).toMatch(/^3 /)
  await clock.advance(1500)
  expect((await tileOf(ui, 'newbie'))?.tile.includes(' entering')).toBe(false)
  // a finish: toast + chime as before, ⭐ + hop (one-shot) in the tile, and NO confetti Client on the desktop
  agents = agents.map(a => (a.id === 'a1' ? { ...a, status: 'done' as const, end_ms: clock.now(), result: 'mapped 4 places' } : a))
  await ui.press({ key: 'showDone' })
  await clock.advance(1500)
  expect(captured.toasts).toEqual(['map session-token validation — סיים'])
  expect(captured.plays).toBe(1)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await tileOf(ui, 'a1'))?.tile).toMatch(/ recent justdone/)
  expect((await tileOf(ui, 'a1'))?.tile).toMatch(/⭐/)
  expect((await tileOf(ui, 'a1'))?.tile).toMatch(/class="ws done/)
  // the next poll keeps the ⭐ (static) and drops the one-shot hop
  await clock.advance(1500)
  expect((await tileOf(ui, 'a1'))?.tile).toMatch(/⭐/)
  expect((await tileOf(ui, 'a1'))?.tile.includes('justdone')).toBe(false)
  await clock.advance(JUST_FINISHED_MS + 1500)
  expect((await tileOf(ui, 'a1'))?.tile.includes('⭐')).toBe(false)
  await ui.unmount()
})

test('THE FLICKER GUARD: polls with no visible change write NO payload / scanError / view and the desktop pane is NOT redrawn; a visible change or a minute\'s turn publishes ONCE; the terminal keeps ticking', async ($, on) => {
  const files = quietOffice(T0)
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } }, files)
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1500) // the first poll scans the files and publishes
  expect(captured.writes.payload).toBe(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 45 } })
  // the pane's render reads `prefs` once per draw; the only other reader is the poll's retitle (one read per
  // $.ui.open it makes, captured in `opens`) — so this counts the redraws
  const renders = () => captured.prefsReads - captured.opens.length
  // the office as scanned: the lead on Fable (its model read from the conversation's tail), q2 on Opus, q1 unknown
  expect((await tileOf(ui, QSESS))?.tile).toMatch(/class="pillt m-fable"[^>]*>Fable 5\.1</)
  expect((await tileOf(ui, 'q2'))?.tile).toMatch(/class="pillt m-opus"[^>]*>Opus 5\.5</)
  expect((await tileOf(ui, 'q1'))?.tile).toMatch(/class="pillt m-other"[^>]*>\?</)
  expect((await tileOf(ui, 'q1'))?.tile).toMatch(/class="ws running fam-read/)
  const before = (await ui.findAll({ type: 'Svg' })).map(x => String(x.props.source))
  const writes0 = { ...captured.writes }
  const desktop0 = renders()
  // FIVE quiet polls (same wall-clock minute: T0 is 20 s past one): nothing drawn changed → nothing written, nothing redrawn
  for (let i = 0; i < 5; i++) await clock.advance(1500)
  expect(minuteClock(clock.now())).toBe(minuteClock(T0 + 1500))
  expect(captured.writes.payload).toBe(writes0.payload)
  expect(captured.writes.scanError).toBe(writes0.scanError)
  expect(captured.writes.view).toBe(writes0.view)
  expect(renders()).toBe(desktop0) // the desktop pane was NOT drawn again
  expect((await ui.findAll({ type: 'Svg' })).map(x => String(x.props.source))).toEqual(before)
  // THE TICK GUARD: with only the desktop drawing the pane, not even the tick is written (the desktop app
  // redraws the pane on any write of the plugin's) — the idle desktop office sees NO write at all
  expect(captured.writes.tick).toBe(writes0.tick)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 90 } })
  const terminal0 = renders()
  const clockText = async () => (await term.find({ type: 'Text', text: /^\d\d:\d\d$/ }))?.text
  const c0 = await clockText()
  expect(c0).toBeDefined()
  for (let i = 0; i < 3; i++) await clock.advance(1500)
  expect(renders()).toBeGreaterThanOrEqual(terminal0 + 3)
  expect(await clockText()).not.toBe(c0)
  expect(captured.writes.payload).toBe(writes0.payload)
  await term.unmount()
  const desktop1 = renders()
  await clock.advance(1500)
  expect(renders()).toBe(desktop1)
  // the same payload at the same minute keys the same; scanned_ms is not part of what is drawn
  const sample = { ...EMPTY_PAYLOAD, agents: fixture(), scanned_ms: 1 }
  expect(renderKey(sample, T0)).toBe(renderKey({ ...sample, scanned_ms: 2, versions: ['9.9.9'], skipped: 4 }, T0 + 1500))
  expect(renderKey(sample, T0)).not.toBe(renderKey({ ...sample, agents: sample.agents.map(a => (a.id === 'a1' ? { ...a, tool: 'Write' } : a)) }, T0))
  expect(renderKey(sample, T0)).not.toBe(renderKey(sample, T0 + 60_000))
  expect(renderKey(sample, T0, { a2: T0 })).not.toBe(renderKey(sample, T0, {}))
  // a VISIBLE change: q1 dispatches Write → exactly one publish, one desktop redraw, the tile recoloured
  const q1 = files.get(Q1)!
  files.set(Q1, {
    text: q1.text + JSON.stringify({ type: 'user', timestamp: '2026-06-01T10:00:06.000Z', version: '2.1.0', message: { content: [{ type: 'tool_result', content: 'ok' }] } }) + '\n' +
      JSON.stringify({ type: 'assistant', timestamp: '2026-06-01T10:00:07.000Z', version: '2.1.0', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'x' } }] } }) + '\n',
    mtimeMs: clock.now(),
  })
  await clock.advance(1500)
  expect(captured.writes.payload).toBe(writes0.payload + 1)
  expect(renders()).toBe(desktop1 + 1)
  expect((await tileOf(ui, 'q1'))?.tile).toMatch(/class="ws running fam-write/)
  // quiet again: still nothing
  for (let i = 0; i < 3; i++) await clock.advance(1500)
  expect(captured.writes.payload).toBe(writes0.payload + 1)
  expect(renders()).toBe(desktop1 + 1)
  // the clocks: the lead's timer counts from its last activity (T0 - 5 s) at MINUTE resolution. The first
  // minute boundary leaves it under a minute ("<1m": nothing drawn moved → NO publish); the one after
  // moves it to "1m" → ONE publish, ONE redraw, then quiet again
  const leadMtime = T0 - 5000
  expect((await tileOf(ui, QSESS))?.tile).toMatch(/class="timer"[^>]*>&lt;1 דק׳</)
  const boundary1 = minuteClock(clock.now()) + 60_000
  await clock.advance(boundary1 - clock.now() + 1500)
  expect(boundary1 - leadMtime).toBeLessThan(60_000)
  expect(captured.writes.payload).toBe(writes0.payload + 1)
  expect(renders()).toBe(desktop1 + 1)
  // RUNNING_STALE_SEC after its last activity the lead falls idle: a visible change (💤, grey) → one publish
  const idleAt = leadMtime + RUNNING_STALE_SEC * 1000
  expect(idleAt).toBeGreaterThan(clock.now())
  await clock.advance(idleAt - clock.now() + 1500)
  expect(captured.writes.payload).toBe(writes0.payload + 2)
  expect(renders()).toBe(desktop1 + 2)
  expect((await tileOf(ui, QSESS))?.tile).toMatch(/class="ws stale/)
  const boundary2 = boundary1 + 60_000
  expect(boundary2).toBeGreaterThan(clock.now())
  await clock.advance(boundary2 - clock.now() + 1500)
  expect(captured.writes.payload).toBe(writes0.payload + 3)
  expect(renders()).toBe(desktop1 + 3)
  expect((await tileOf(ui, QSESS))?.tile).toMatch(/class="timer"[^>]*>1 דק׳</)
  await clock.advance(1500)
  await clock.advance(1500)
  expect(captured.writes.payload).toBe(writes0.payload + 3)
  expect(renders()).toBe(desktop1 + 3)
  await ui.unmount()
})

test('RESIZE: the rows scale with the pane — one column count for every room, stepping 3 → 4 → 5 → 6 at 45 / 90 / 140 / 200 columns; a resize redraws, a quiet poll after it does not', async ($, on) => {
  // room A: the lead + four subagents (so 3 columns need two rows), room B: one
  const agents = [
    ...fixture().filter(a => a.id !== 'a2'),
    agent({ id: 'a3', role: 'write the changelog', tool: 'Write', persona_id: 12 }),
    agent({ id: 'a4', role: 'run the suite', tool: 'Bash', persona_id: 13 }),
    agent({ id: 'a5', role: 'grep the logs', tool: 'Grep', persona_id: 14 }),
  ]
  const { clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 45 } })
  const widthsOf = async () => (await ui.findAll({ type: 'Svg' })).map(x => Number(/viewBox="0 0 (\d+) (\d+)"/.exec(String(x.props.source))?.[1]))
  const heightsOf = async () => (await ui.findAll({ type: 'Svg' })).map(x => Number(/viewBox="0 0 (\d+) (\d+)"/.exec(String(x.props.source))?.[2]))
  await clock.advance(1500) // the cast has walked in (the one-shot `entering` is gone)
  for (const [bodyColumns, cols, svgCount] of [[45, 3, 3], [90, 4, 3], [140, 5, 2], [200, 6, 2]] as const) {
    await ui.redraw({ ...PANE.props, bodyColumns })
    expect(roomCols(bodyColumns)).toBe(cols)
    const widths = await widthsOf()
    expect(widths).toHaveLength(svgCount) // room A: two rows under 5 columns, one from 5; room B: one row
    expect(new Set(widths).size).toBe(1) // IDENTICAL across rooms and rows
    expect(widths[0]).toBe(roomWidth(cols))
    const heights = await heightsOf()
    // every row hugs its tiles: the titled first row of each room, a bare row for the overflow
    for (const h of heights) expect([ROW_H, ROW_H_TITLED].includes(h)).toBe(true)
    expect(heights.filter(h => h === ROW_H_TITLED)).toHaveLength(2) // two rooms, two titles
    // the numbered Buttons stay one per agent whatever the grid
    for (const id of ['lead-a', 'a1', 'a3', 'a4', 'a5', 'b1']) expect(await ui.find({ key: `open:${id}` })).toBeDefined()
    // a quiet poll after the resize draws the very same sources (no change → no reload)
    const after = (await ui.findAll({ type: 'Svg' })).map(x => String(x.props.source))
    await clock.advance(1500)
    expect((await ui.findAll({ type: 'Svg' })).map(x => String(x.props.source))).toEqual(after)
  }
  await ui.unmount()
})

test('TERMINAL / VSCODE / MOBILE: no SVG tile anywhere; the text cards stay', async ($, on) => {
  const agents = fixture()
  const { clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
    expect(await ui.find({ key: 'tile:a1' })).toBeUndefined()
    expect((await ui.find({ key: 'open:a1' }))?.text).toMatch(/map session-token validation/)
    expect(await ui.find({ type: 'Text', text: /📖 קורא/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^00:3\d$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('demo mode: the empty office offers a demo; it draws the scripted office and plays the finish beat', async ($, on) => {
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'en', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await messageOf(ui, 'desktop', /The office is empty/)).toBe(true)
  await ui.press({ key: 'watchDemo' })
  // (the desktop's room titles live in the room SVGs, never in an engine Text)
  expect(await roomSvgOf(ui, '💬 Ship the v2 config migration')).toBeDefined()
  expect(await roomSvgOf(ui, '💬 Plan the static-regeneration rollout')).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /💬/ })).toBeUndefined()
  expect(await ui.find({ key: 'open:demo-finisher-gg' })).toBeDefined()
  expect((await ui.find({ key: 'demo' }))?.text).toMatch(/Exit/)
  // phase 6 of the loop: the finisher completes on a visible card (demo forces "show finished");
  // the office redraws on the poll (POLL_MS), so walk one poll past the phase edge
  const toPhase6 = 6000 - (clock.now() % 12000) + 12000
  await clock.advance(toPhase6 + 1500)
  expect(captured.toasts.some(t => t.startsWith('summarize the security review'))).toBe(true)
  expect(captured.plays).toBeGreaterThanOrEqual(1)
  expect(await ui.find({ key: 'open:demo-newcomer-hh' })).toBeDefined()
  // exit restores the real (empty) office
  await ui.press({ key: 'demo' })
  expect(await messageOf(ui, 'desktop', /The office is empty/)).toBe(true)
  await ui.unmount()
})

test('DESKTOP RTL: the empty office is an RTL SVG message (the desktop Text cannot be set right-to-left); the search placeholder drops its trailing ellipsis; the terminal keeps its Text lines', async ($, on) => {
  expect(splitSentence('הפעילו סוכן ב-Claude Code - או הציצו איך נראה משרד עמוס:')).toEqual(['הפעילו סוכן ב-Claude Code', 'או הציצו איך נראה משרד עמוס:'])
  beneath(on, () => [], { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 45 } })
  const src = String((await desk.find({ type: 'Svg' }))?.props?.source)
  expect(src).toMatch(/<text class="room-title"[^>]*text-anchor="middle" direction="rtl"[^>]*>המשרד ריק<\/text>/)
  expect(src).toMatch(/direction="rtl"[^>]*>הפעילו סוכן ב-Claude Code<\/text>/)
  expect(src).toMatch(/direction="rtl"[^>]*>או הציצו איך נראה משרד עמוס:<\/text>/)
  expect(await desk.find({ type: 'Text', text: /Claude Code/ })).toBeUndefined()
  expect(await desk.find({ key: 'watchDemo' })).toBeDefined()
  expect((await desk.find({ key: 'search' }))?.props?.placeholder).toBe('🔍 חיפוש סוכנים')
  await desk.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 90 } })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /^הפעילו סוכן ב-Claude Code - או/ })).toBeDefined()
  expect((await term.find({ key: 'search' }))?.props?.placeholder).toBe('🔍 חיפוש סוכנים…')
  await term.unmount()
})
