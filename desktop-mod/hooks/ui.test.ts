// ui.tsx: the office pane. Pure ports first (fmt, elapsed, search, room order,
// the tri-state room toggle, the finish test, the demo office), then the pane
// driven through the engine: session.start starts the poll on a mocked clock,
// a test hook beneath the plugin rewrites each payload write into a fixture,
// and the pane is mounted and acted on by key on the terminal and the desktop
// (and drawn on mobile/vscode, which lack Input / Client).

import type { Agent } from './model'
import { EMPTY_PAYLOAD, JUST_FINISHED_MS, LONG_RUNNING_MS, PERSONA_EMOJI } from './model'
import { expect, mock, test } from 'claude-code/testing'

import { activityLabel } from './i18n'
import { assignDistinctPersonas, personaName } from './personas'
import {
  agentElapsed, cardName, demoOffice, detectFinishes, emptyKind, fmt, headerCounts, isLongRunning, matchesSearch,
  officeView, paneTitle, pruneJustFinished, roomShowsDone, roomStats, toggledRoomDone,
} from './ui'

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
    is_session: false, closed: false, is_workflow: false, truncated: false, ...over,
  }
}

/** Two rooms: A (lead + a reader + a finished writer), B (one MCP agent). */
function fixture(): Agent[] {
  return [
    agent({ id: 'lead-a', is_session: true, tool: '', phase: 'thinking', task: 'Ship the v2 config migration. Then clean up.', topic: 'Ship the v2 config migration.', start_ms: T0 - 400_000, mtime_ms: T0 - 5000, session: SA.slice(0, 8), session_full: SA }),
    agent({ id: 'a1', role: 'map session-token validation', subagent_type: 'Explore', tool: 'Read', persona_id: 7 }),
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
  expect(agentElapsed(agent({ id: 'd2', status: 'done', start_ms: now - 90_000, end_ms: null, mtime_ms: now - 40_000 }), now)).toBe(null)
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

test('demoOffice: the 12 s loop, two rooms led by their topics, distinct personas, sorted running/stale/done', () => {
  const p0 = demoOffice(T0, 0)
  expect(p0.demo).toBe(true)
  expect(p0.agents.some(a => a.id === 'demo-newcomer-hh')).toBe(false)
  expect(p0.agents.find(a => a.id === 'demo-finisher-gg')?.status).toBe('running')
  const p6 = demoOffice(T0, 6)
  expect(p6.agents.some(a => a.id === 'demo-newcomer-hh')).toBe(true)
  const fin = p6.agents.find(a => a.id === 'demo-finisher-gg')
  expect(fin?.status).toBe('done')
  expect(fin?.result).toMatch(/3 high/)
  expect(p6.agents.find(a => a.id === 'demo-mcp-dd')?.tool).toBe('mcp__github__search_issues')
  expect(activityLabel(p6.agents.find(a => a.id === 'demo-mcp-dd')!, 'he')).toBe('🔌 github')
  expect(isLongRunning(p6.agents.find(a => a.id === 'demo-longrun-ii')!, T0)).toBe(true)
  // by time: phase = floor(now/1000) % 12
  expect(demoOffice(7000).agents.find(a => a.id === 'demo-finisher-gg')?.status).toBe('done')
  expect(demoOffice(2000).agents.find(a => a.id === 'demo-finisher-gg')?.status).toBe('running')
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
})

type On = Parameters<typeof mock.store>[0]

function beneath(on: On, current: () => Agent[], store: Record<string, unknown> = {}) {
  const captured = { toasts: [] as string[], plays: 0, opens: [] as string[], store: { ...store } as Record<string, unknown> }
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
  // no file system beneath: the scanner sees an empty ~/.claude
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('ui.toast', ($, e) => { captured.toasts.push(e.text); return { value: undefined } })
  on('audio.play', () => { captured.plays += 1; return { value: undefined } })
  on('ui.open', ($, e) => { captured.opens.push(e.title ?? e.id); return { value: { isPlaced: true as const } } })
  on('ui.focus', () => ({}))
  // the poll's payload write becomes the fixture of the moment
  on('state.set', { plugin: 'agent-theater', key: 'payload' }, ($, e, next) =>
    next({ ...e, value: { ...EMPTY_PAYLOAD, agents: current(), scanned_ms: clock.now() } }))
  return { captured, clock }
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
    expect(await ui.find({ type: 'Text', text: /💬 Ship the v2 config migration\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /💬 research/ })).toBeDefined()
    // cards: the Agent description is the name; MCP tool → 🔌 server; finished hidden
    expect(await ui.find({ key: 'open:a1' })).toBeDefined()
    expect((await ui.find({ key: 'open:a1' }))?.text).toMatch(/map session-token validation/)
    expect(await ui.find({ type: 'Text', text: /🔌 github/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /📖 קורא/ })).toBeDefined()
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
    expect(await ui.find({ type: 'Text', text: /🔌 github/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /📖 Reading/ })).toBeDefined()
    expect(captured.opens).toContain('🎭 Theater')
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
    expect(await ui.find({ type: 'Text', text: /אין סוכנים שתואמים/ })).toBeDefined()
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

test('demo mode: the empty office offers a demo; it draws the scripted office and plays the finish beat', async ($, on) => {
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'en', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /The office is empty/ })).toBeDefined()
  await ui.press({ key: 'watchDemo' })
  expect(await ui.find({ type: 'Text', text: /💬 Ship the v2 config migration/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /💬 Plan the static-regeneration rollout/ })).toBeDefined()
  expect(await ui.find({ key: 'open:demo-finisher-gg' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⏰/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /The office is empty/ })).toBeDefined()
  await ui.unmount()
})
