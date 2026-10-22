// ui.tsx: the office pane. Pure ports first (fmt, elapsed, search, room order,
// the tri-state room toggle, the finish test, the demo office), then the pane
// driven through the engine: session.start starts the poll on a mocked clock,
// a test hook beneath the plugin rewrites each payload write into a fixture
// (or, with in-memory files, the scanner's own office is published: the finish
// beat is the poll's, over the SCAN, so a finish is driven from the files),
// and the pane is mounted and acted on by key on the terminal and the desktop
// (and drawn on mobile/vscode, which lack Input / Client).

import type { Agent } from './model'
import { EMPTY_PAYLOAD, JUST_FINISHED_MS, LONG_RUNNING_MS, MAX_AGE_MIN, PERSONA_EMOJI, POLL_MS, RUNNING_STALE_SEC } from './model'
import { expect, test } from 'claude-code/testing'

import { SETTLE_MS, SETTLE_SLACK_MS, cleanOffice } from './register'

import { activityLabel } from './i18n'
import { assignDistinctPersonas, personaName } from './personas'
import { demoPayload } from './scanner'
import {
  CARD_MAX_W, COLS2_FROM, COLS3_FROM, LEAD_MARK, MIN_WIDTH, agentElapsed, cardName, cellWidth, clip, emptyKind, fmt, gridFor,
  headerCounts, isLongRunning, joinParts, matchesSearch, officeView, paneTitle, roomShowsDone, roomStats, toggledRoomDone, workingCount,
  minuteClock, renderKey, starsOf, FINISH_TOAST_MS, RECENT_DONE, TOAST_TITLE_MAX, finishToast, roomTitle,
} from './ui'
import { REFUSED_RE, chromeRows, emptyLines, fixedRows, helpRows, officeHeight, overlayHeight } from './office-chrome'
import { geometry, officeModel, rowCount, type Hit } from './office-layout'
import { OFFICE_KEY, assertJson } from './office-props'
import type { OfficeAgent, OfficeProps } from './office-props'
import { T0, beneath, type MemFiles } from './test-kit'

const SA = 'sess-aaaa-1111-frontend'
const SB = 'sess-bbbb-2222-research'
const PANE = {
  plugin: 'agent-theater', component: 'Pane', requestId: 'agent-theater',
  props: { title: 'T', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
/** The person typing /theater: the pane opened (or raised) and a poll at once. */
const THEATER = { command: 'theater', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

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
  // THE BADGED FIRST (the desktop's recent-done pick, the cards design round 8): among a room's hidden finished, a ❌ one — and a
  // ⭐ one whose id the caller stamps in `starred` — ranks ahead of fresher finishes, so it is never held behind the more line
  const fin = (id: string, secondsAgo: number, over: Partial<Agent> = {}) => agent({ id, status: 'done', end_ms: T0 - secondsAgo * 1000, ...over })
  const crowd = [agent({ id: 'r' }), fin('old', 50), fin('bad', 40, { failed: true }), fin('n1', 3), fin('n2', 2), fin('n3', 1)]
  const plain = officeView(crowd, '', 'he', false, {}, [], 3)
  expect(plain.visible.map(a => a.id)).toEqual(['r', 'bad', 'n2', 'n3'])
  expect(plain.moreDone.get(SA)).toBe(2)
  const starred = officeView(crowd, '', 'he', false, {}, [], 3, new Set(['old']))
  expect(starred.visible.map(a => a.id)).toEqual(['r', 'old', 'bad', 'n3'])
  expect(starred.moreDone.get(SA)).toBe(2)
  // without a recent-done pick (the text cards, the poll) the stamps change nothing
  expect(officeView(crowd, '', 'he', false, {}, [], 0, new Set(['old'])).visible.map(a => a.id)).toEqual(['r'])
  expect(officeView(crowd, '', 'he', true, {}, [], 0, new Set(['old'])).visible.map(a => a.id)).toEqual(['r', 'old', 'bad', 'n1', 'n2', 'n3'])
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

test('starsOf (the finish beat\'s ⭐ stamps): fires once, never on first sight, keeps a live star, drops an expired one, prunes prevStatus to the office', () => {
  const prev: Record<string, Agent['status']> = {}
  const a = agent({ id: 'a' })
  expect(starsOf(prev, [a], {}, T0)).toEqual({}) // first sight: remembered, no star
  expect(prev.a).toBe('running')
  const done = { ...a, status: 'done' as const }
  expect(starsOf(prev, [done], {}, T0 + 1000)).toEqual({ a: T0 + 1000 }) // running → done: ⭐ stamped now
  expect(prev.a).toBe('done')
  expect(starsOf(prev, [done], { a: T0 + 1000 }, T0 + 2000)).toEqual({ a: T0 + 1000 }) // once: the stamp holds
  // the window ends: an expired star is dropped (its agent's too, whether or not it is still in the office)
  expect(starsOf(prev, [done], { a: T0 + 1000, gone: T0 - JUST_FINISHED_MS }, T0 + 1000 + JUST_FINISHED_MS)).toEqual({})
  expect(starsOf(prev, [done], { a: T0 + 1000 }, T0 + 1000 + JUST_FINISHED_MS - 1)).toEqual({ a: T0 + 1000 })
  const prev2: Record<string, Agent['status']> = { a: 'running', gone: 'running' }
  expect(starsOf(prev2, [done], {}, T0)).toEqual({ a: T0 })
  expect(prev2.gone).toBeUndefined() // pruned to the office's ids
  expect(starsOf(prev2, [done], { a: T0 }, T0 + 1)).toEqual({ a: T0 })
})

test('THE FINISH TOAST (live check 5): `✅ <persona> סיים · <room title>` / `✅ <persona> finished · <title>` — the persona\'s name (never the Agent call\'s description), the room\'s title as the office draws it (roomTitle: the topic, else the project, else the session\'s head) cut on a word to TOAST_TITLE_MAX cells; no title, no separator; FINISH_TOAST_MS short', () => {
  expect([FINISH_TOAST_MS, TOAST_TITLE_MAX]).toEqual([1500, 30])
  const a = agent({ id: 'x', persona_id: 0, role: 'summarize the security review' })
  expect(finishToast(a, 'Ship the v2 config migration.', 'he')).toBe('✅ הבלש סיים · Ship the v2 config migration.')
  expect(finishToast(a, 'Ship the v2 config migration.', 'en')).toBe('✅ The Detective finished · Ship the v2 config migration.')
  expect(finishToast(a, 'Plan the static-registry move and the v2 config rollout', 'en')).toBe('✅ The Detective finished · Plan the static-registry move…')
  expect(finishToast(a, 'בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', 'he')).toBe('✅ הבלש סיים · בדיקת תיאטרון הסוכנים בשיחה…')
  expect(finishToast(a, '', 'he')).toBe('✅ הבלש סיים')
  expect(finishToast(a, '   ', 'en')).toBe('✅ The Detective finished')
  // the Hebrew verb agrees with the persona (pre-check 6): הדבורה and הנמלה — the cast's feminine names — סיימה; English has one form
  const bee = agent({ id: 'b', persona_id: 12 })
  expect(finishToast(bee, 'Ship the v2 config migration.', 'he')).toBe('✅ הדבורה סיימה · Ship the v2 config migration.')
  expect(finishToast(agent({ id: 'n', persona_id: 40 }), '', 'he')).toBe('✅ הנמלה סיימה')
  expect(finishToast(bee, '', 'en')).toBe('✅ The Bee finished')
  // the generic name (no persona) is סוכן, masculine
  expect(finishToast(agent({ id: 'g', persona_id: undefined as unknown as number }), '', 'he')).toBe('✅ סוכן סיים')
  // the title as the card draws it: the lead's topic, else the project's folder, else the session id's head
  const stat = roomStats(fixture())
  expect(roomTitle(stat.get(SA), SA)).toBe('Ship the v2 config migration.')
  expect(roomTitle(stat.get(SB), SB)).toBe('research')
  expect(roomTitle(undefined, 'sess-zzzz-9999')).toBe('sess-zzz')
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
  // Python's cast (7 agents + the newcomer + 2 leads, the MCP triager 63 s in, no ⏰ subject) and four earlier finishes in the
  // research room (pre-check 6): it holds RECENT_DONE + 2 finished, each finished at its own time and the writer the latest —
  // so a room that hides its finished holds two of them back, and "show finished" changes what the demo draws
  expect(p6.agents).toHaveLength(14)
  const researchDone = p6.agents.filter(a => a.session_full.endsWith('2222') && a.status === 'done')
  expect(researchDone.map(a => a.id)).toEqual(['demo-writer-ff', 'demo-survey-ii', 'demo-bench-jj', 'demo-dedupe-kk', 'demo-label-ll'])
  expect(researchDone.length).toBe(RECENT_DONE + 2)
  const ends = researchDone.map(a => a.end_ms ?? 0)
  expect([...ends].sort((x, y) => y - x)).toEqual(ends)
  expect(new Set(ends).size).toBe(ends.length)
  for (const a of researchDone) expect(a.result, a.id).toMatch(/\S/)
  const heldBack = officeView(p6.agents, '', 'he', false, {}, [], RECENT_DONE)
  expect(heldBack.moreDone.get('demo-session-research-2222')).toBe(2)
  expect(heldBack.visible.some(a => a.id === 'demo-dedupe-kk' || a.id === 'demo-label-ll')).toBe(false)
  expect(officeView(p6.agents, '', 'he', true, {}, [], RECENT_DONE).visible.filter(a => a.id === 'demo-dedupe-kk' || a.id === 'demo-label-ll')).toHaveLength(2)
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

test('THE TEXT GATE (register.tsx cleanOffice, the poll\'s one pass over the merged office): every agent text field the payload carries is cleaned — task and result keep their line breaks, the one-line fields do not; ids and numbers untouched; a clean office comes back equal; idempotent', () => {
  const ESC = String.fromCharCode(0x1b)
  const BEL = String.fromCharCode(0x07)
  /** `s`, an ANSI colour code around "!", an RLM, a BEL, a line break, `s` again. */
  const dirty = (s: string) => `${s}${ESC}[31m!${ESC}[0m\u200f${BEL}\n${s}`
  const raw = agent({
    id: 'dirty', role: dirty('role'), subagent_type: dirty('type'), tool: dirty('tool'), task: dirty('task'), task_short: dirty('short'),
    result: dirty('result'), topic: dirty('topic'), model: dirty('model'), cwd: dirty('C:/w'), project: dirty('C:/p'), status: 'done', end_ms: T0,
  })
  const office = cleanOffice({ ...EMPTY_PAYLOAD, agents: [raw, ...fixture()], stars: { dirty: T0 }, scanned_ms: T0 })
  // one-line fields: the code gone, the mark gone, the BEL and the line break spaces; task and result keep the line break
  expect(office.agents[0]).toEqual({
    ...raw, role: 'role!  role', subagent_type: 'type!  type', tool: 'tool!  tool', task: 'task! \ntask', task_short: 'short!  short',
    result: 'result! \nresult', topic: 'topic!  topic', model: 'model!  model', cwd: 'C:/w!  C:/w', project: 'C:/p!  C:/p',
  })
  const strings = (x: unknown): string[] => (typeof x === 'string' ? [x] : x !== null && typeof x === 'object' ? Object.values(x).flatMap(strings) : [])
  for (const s of strings(office)) expect(s).not.toMatch(REFUSED_RE)
  // the rest of the payload as it was; a clean office is unchanged (an absent topic stays absent, a null result null)
  expect({ ...office, agents: [] }).toEqual({ ...EMPTY_PAYLOAD, agents: [], stars: { dirty: T0 }, scanned_ms: T0 })
  expect(office.agents.slice(1)).toEqual(fixture())
  expect('topic' in office.agents[2]!).toBe(false)
  expect(office.agents[2]!.result).toBeNull()
  // idempotent (so the flicker guard's key is stable poll after poll), and deterministic
  expect(cleanOffice(office)).toEqual(office)
  expect(cleanOffice({ ...EMPTY_PAYLOAD, agents: [raw], stars: { dirty: T0 }, scanned_ms: T0 }).agents).toEqual([office.agents[0]])
  expect(renderKey(cleanOffice({ ...EMPTY_PAYLOAD, agents: [raw] }), T0)).toBe(renderKey(cleanOffice({ ...EMPTY_PAYLOAD, agents: [{ ...raw }] }), T0))
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

/** The pane's message (empty office, no match): an engine Text on the text surfaces, the office Client's `empty.msg` on the desktop. */
async function messageOf(ui: { find: (q: { type: string; text?: RegExp }) => Promise<{ props: Record<string, unknown> } | undefined> }, surface: string, re: RegExp): Promise<boolean> {
  if (surface !== 'desktop') return (await ui.find({ type: 'Text', text: re })) !== undefined
  const empty = ((await ui.find({ type: 'Client' }))?.props.props as OfficeProps | undefined)?.empty
  return !!empty && re.test(empty.msg)
}

/**
 * DESKTOP (the Client office): a left click inside the office Client on the layout hit `kind`/`id` — a
 * row (`agent`), a room head's pin (`pin`) or its more line under the title (`moreDone`; the ✅ counts are
 * read-only: live check 7, Q6) — where the module draws it:
 * the module hit-tests it and POSTS the message, the plugin's `ui.message` hook (ui.tsx) applies it.
 * (A toolbar Button of the module is pressed by its key: `ui.press({ key })`.)
 */
async function clickIn(ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined>; pointer: (ev: { in?: string; type: 'down' | 'leave'; x: number; y: number; button?: 'left' }) => Promise<void> }, kind: Hit['kind'], id: string): Promise<void> {
  const p = (await ui.find({ type: 'Client' }))?.props.props as OfficeProps
  const hit = officeModel(p).hits.find(h => h.kind === kind && h.id === id)
  expect(hit).toBeDefined()
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: geometry(p.columns).margin + hit!.x + Math.floor(hit!.w / 2), y: chromeRows(p) + hit!.y, button: 'left' })
  // (a pin keeps the cards where they are until the pointer leaves the office: live check 7, Q4)
  if (kind === 'pin') await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
}

/** DESKTOP (the Client office): whether the module lays any background (live check 6: the finish's tint flashed a near-black band on the light theme — the ⭐ is the whole finish). */
async function tintShown(ui: { findAll: (q: { in?: string; type?: string }) => Promise<Array<{ props: Record<string, unknown> }>> }): Promise<boolean> {
  return (await ui.findAll({ in: OFFICE_KEY })).some(n => n.props.backgroundColor !== undefined)
}

/** A quiet office on disk (HOME = C:/Users/test): one open conversation (its lead answering on Fable) with two subagents, one of them on Opus. */
const QHOME = 'C:/Users/test'
const QPROJ = `${QHOME}/.claude/projects/-C-x`
const QSESS = 'sess-quiet-0001'
const Q1 = `${QPROJ}/${QSESS}/subagents/agent-q1.jsonl`
const Q2 = `${QPROJ}/${QSESS}/subagents/agent-q2.jsonl`
const Q3 = `${QPROJ}/${QSESS}/subagents/agent-q3.jsonl`

/** A subagent transcript mid-tool (one prompt, a Grep pending), shaped as quietOffice's q1; `session` is its room. */
function subagentMidTool(id: string, prompt: string, mtimeMs: number, session = QSESS): { text: string; mtimeMs: number } {
  const rec = (o: Record<string, unknown>) => JSON.stringify(o)
  return {
    text: [
      rec({ type: 'user', agentId: id, sessionId: session, timestamp: '2026-06-01T10:00:00.000Z', cwd: 'C:/x', version: '2.1.0', message: { content: prompt } }),
      rec({ type: 'assistant', timestamp: '2026-06-01T10:00:05.000Z', version: '2.1.0', message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'test' } }] } }),
    ].join('\n') + '\n',
    mtimeMs,
  }
}

/** The agent of `path` finishes at `now`: its pending tool returns and it answers with an end_turn (the scanner's done). */
function finishIn(files: MemFiles, path: string, now: number, answer: string): void {
  const f = files.get(path)!
  files.set(path, {
    text: f.text +
      JSON.stringify({ type: 'user', timestamp: '2026-06-01T10:00:08.000Z', version: '2.1.0', message: { content: [{ type: 'tool_result', content: 'ok' }] } }) + '\n' +
      JSON.stringify({ type: 'assistant', timestamp: '2026-06-01T10:00:09.000Z', version: '2.1.0', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: answer }] } }) + '\n',
    mtimeMs: now,
  })
}

/** The transcript at `path` ages out of the office: its mtime falls behind MAX_AGE_MIN (the scanner re-stats every file every scan). */
function ageOut(files: MemFiles, path: string, now: number): void {
  const f = files.get(path)!
  files.set(path, { ...f, mtimeMs: now - (MAX_AGE_MIN + 1) * 60_000 })
}

/** A second open conversation beside quietOffice's: its lead answering, one FINISHED subagent (so the room header draws its ✅ counts: the text cards' toggle, read-only on the desktop). */
const QSESS2 = 'sess-quiet-0002'
const QLEAD2 = `${QPROJ}/${QSESS2}.jsonl`
const R1 = `${QPROJ}/${QSESS2}/subagents/agent-r1.jsonl`
function secondRoom(files: MemFiles, now: number): void {
  const rec = (o: Record<string, unknown>) => JSON.stringify(o)
  files.set(QLEAD2, {
    text: [
      rec({ type: 'user', sessionId: QSESS2, cwd: 'C:/y', timestamp: '2026-06-01T09:30:00.000Z', message: { role: 'user', content: 'Second room. One finished helper.' } }),
      rec({ type: 'assistant', sessionId: QSESS2, timestamp: '2026-06-01T09:30:01.000Z', message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text: 'On it.' }] } }),
    ].join('\n') + '\n',
    mtimeMs: now - 4000,
  })
  files.set(R1, subagentMidTool('r1', 'Lint the repo.', now - 7000, QSESS2))
  finishIn(files, R1, now - 7000, 'Clean.')
  files.set(`${QHOME}/.claude/sessions/8.json`, { text: JSON.stringify({ pid: 8, sessionId: QSESS2 }), mtimeMs: now })
}

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
  files.set(Q2, {
    text: [
      rec({ type: 'user', agentId: 'q2', sessionId: QSESS, timestamp: '2026-06-01T10:00:00.000Z', cwd: 'C:/x', version: '2.1.0', message: { content: 'Run the tests.' } }),
      rec({ type: 'assistant', timestamp: '2026-06-01T10:00:05.000Z', version: '2.1.0', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pytest' } }] } }),
    ].join('\n') + '\n',
    mtimeMs: now - 8000,
  })
  files.set(`${QHOME}/.claude/sessions/7.json`, { text: JSON.stringify({ pid: 7, sessionId: QSESS }), mtimeMs: now })
  return files
}

test('the office draws rooms, cards and counts on every text surface (the footer: THE FOOTER below)', async ($, on) => {
  const agents = fixture()
  const { clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
  // (the text surfaces: the desktop is the office Client, whose props the DESKTOP test below asserts for this office)
  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
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
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
    expect(await ui.find({ key: 'open:a2' })).toBeUndefined()
    expect(await ui.find({ key: 'rdone:' + SA })).toBeDefined()
    if (surface === 'mobile') expect(await ui.find({ key: 'search' })).toBeUndefined()
    else expect(await ui.find({ key: 'search' })).toBeDefined()
    await ui.unmount()
  }
})

// (mounts at three widths through the kit: past the 5 s default under a full suite on a loaded machine with no code change — 5.08 s on
// 20.10 at 90% CPU — the budget is load headroom)
test('the pane fits narrow, medium and wide bodies: cards, keys, the compact header/toolbar and the 🧠 model tag', { timeoutMs: 30_000 }, async ($, on) => {
  const agents = fixture()
  const { clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
  for (const bodyColumns of [40, 70, 140] as const) {
    // (the terminal alone: the desktop is the office Client — its tile grid is office-layout.test.ts's, its props the DESKTOP tests')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns } })
    // every card, room toggle and control is there whatever the width
    for (const key of ['open:lead-a', 'open:a1', 'open:b1', 'rdone:' + SA, 'pin:' + SA, 'pin:' + SB, 'showDone', 'mute', 'lang', 'help', 'demo', 'search', 'prev', 'next', 'openFocused']) {
      expect(await ui.find({ key })).toBeDefined()
    }
    expect(await ui.find({ key: 'open:a2' })).toBeUndefined()
    // the model: a1 runs on claude-opus-5-5 → "🧠 Opus 5.5" on its second line; EVERY card has the
    // line — b1's model is unknown → "🧠 ?" (never a dropped segment)
    expect((await ui.find({ type: 'Text', text: /^🧠 Opus 5\.5$/ }))).toBeDefined()
    // three cards (lead-a, a1, b1), three model segments: the two without a model say "🧠 ?"
    expect(await ui.findAll({ type: 'Text', text: /^🧠 / })).toHaveLength(3)
    expect(await ui.findAll({ type: 'Text', text: /^🧠 \?$/ })).toHaveLength(2)
    // the "·" is its own segment BETWEEN two parts: no Text carries a dangling separator at either end
    expect(await ui.find({ type: 'Text', text: /(^·\s+\S|\S\s+·$)/ })).toBeUndefined()
    // the lead's 💬 rides its name on the card's first line; no lone 💬 anywhere
    expect((await ui.find({ key: 'open:lead-a' }))?.text.startsWith(`${LEAD_MARK} `)).toBe(true)
    expect((await ui.find({ key: 'open:a1' }))?.text.includes(LEAD_MARK)).toBe(false)
    expect(await ui.find({ type: 'Text', text: /^\s*💬\s*$/ })).toBeUndefined()
    // the search is the Input alone: no submit button beside it
    expect(await ui.find({ type: 'Button', text: /^(חיפוש|Search)$/ })).toBeUndefined()
    // room headers keep their beginning; the timer sits on the card's first line
    expect(await ui.find({ type: 'Text', text: /^💬 Ship the v2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /💬 research/ })).toBeDefined()
    // a1 started 30 s before T0; the poll advanced 1.5 s
    expect(await ui.find({ type: 'Text', text: /^00:3\d$/ })).toBeDefined()
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
    expect(cellWidth((await ui.find({ key: 'open:a1' }))?.text ?? '')).toBeLessThanOrEqual(g.cardW - 2 - 6)
    // the drawer shows the model row
    await ui.press({ key: 'open:a1' })
    expect(await ui.find({ type: 'Text', text: /^מודל$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^🧠 Opus 5\.5$/ })).toBeDefined()
    await ui.press({ key: 'close' })
    // b1 carries no model → the drawer's model row still shows, as "🧠 ?" (which model runs an agent is never in doubt)
    await ui.press({ key: 'open:b1' })
    expect(await ui.find({ type: 'Text', text: /^מודל$/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /^🧠 \?$/ })).toHaveLength(3) // two cards + the drawer's row
    await ui.press({ key: 'close' })
    await ui.unmount()
  }
})

// (a mount and a dozen presses, each a redraw: 5.1 s under a full suite on a loaded machine with no code change)
test('presses: show finished, mute, language (RTL→LTR, retitle), pin, room toggle, drawer, search', { timeoutMs: 30_000 }, async ($, on) => {
  const agents = fixture()
  const { captured, clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
  // (the terminal alone: the desktop's presses are the office Client's posts — register.test.ts)
  for (const surface of ['terminal'] as const) {
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
    // a pasted escape sequence: stored with its control characters as spaces (an Input value holding one is refused)
    await ui.input({ key: 'search', text: 'tri\u001b[1mage', kind: 'change' })
    expect((await ui.find({ key: 'search' }))?.props.value).toBe('tri [1mage')
    await ui.input({ key: 'search', text: '', kind: 'change' })
    expect(await ui.find({ key: 'open:a1' })).toBeDefined()
    // help popover
    await ui.press({ key: 'help' })
    expect(await ui.find({ type: 'Text', text: /^עזרה$/ })).toBeDefined()
    await ui.press({ key: 'closeHelp' })
    expect(await ui.find({ type: 'Text', text: /^עזרה$/ })).toBeUndefined()
    await ui.unmount()
  }
})

// (several mounts and polls: a loaded machine stretches it past the 5 s default — it ran 5.1 s under a full suite with no code change)
test('the finish beat (the poll\'s, over the scanned office): a shown agent that turns done gets ⭐, confetti, a toast and the chime (unless muted); a hidden finish is never celebrated', { timeoutMs: 30_000 }, async ($, on) => {
  const files = quietOffice(T0)
  files.set(Q3, subagentMidTool('q3', 'Count the tests.', T0 - 9000)) // a third subagent, for the hidden finish
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'he', muted: false, showDone: true, pins: [] } }, files)
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /⭐/ })).toBeUndefined()
  // q1 finishes; a finish settles: it is published once SETTLE_MS passed since the previous publish (a burst = one redraw)
  finishIn(files, Q1, clock.now(), 'Found 12 TODOs; listed them in TODO.md.')
  await clock.advance(SETTLE_MS)
  const q1 = captured.payload?.agents.find(a => a.id === 'q1')
  expect(q1?.status).toBe('done')
  // THE FINISH TOAST (live check 5): the persona, the word, the room's title; a short stay (the ⭐ stays on the row)
  expect(captured.toasts).toEqual(['✅ הבלש סיים · Quiet office test.']) // q1's persona (הבלש, persona 0), its room's title
  expect(captured.toastTimeouts).toEqual([FINISH_TOAST_MS])
  expect(FINISH_TOAST_MS).toBe(1500)
  expect(captured.plays).toBe(1)
  expect(captured.payload?.stars).toEqual({ q1: clock.now() }) // the ⭐ rides the payload, stamped by the poll's clock
  expect(await ui.find({ type: 'Text', text: /⭐/ })).toBeDefined()
  const burst = await ui.find({ type: 'Client' })
  expect(burst?.key).toBe('confetti:q1')
  await ui.advance(90 * 12 + 10)
  expect((await ui.find({ in: 'confetti:q1', type: 'Text' }))?.text).toMatch(/[🎉✨🎊⭐✅]/)
  // no replay on the next poll; the star outlives the burst and dies after the window
  await clock.advance(POLL_MS)
  expect(captured.plays).toBe(1)
  expect(captured.toasts).toHaveLength(1)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /⭐/ })).toBeDefined()
  await clock.advance(JUST_FINISHED_MS + POLL_MS)
  expect(await ui.find({ type: 'Text', text: /⭐/ })).toBeUndefined()
  expect(captured.payload?.stars).toEqual({})
  // muted: toast but no chime
  await ui.press({ key: 'mute' })
  finishIn(files, Q2, clock.now(), 'All green.')
  await clock.advance(SETTLE_MS)
  expect(captured.toasts).toHaveLength(2)
  expect(captured.toasts[1]).toMatch(/^✅ \S+ סיים · Quiet office test\.$/)
  expect(captured.toastTimeouts).toEqual([FINISH_TOAST_MS, FINISH_TOAST_MS])
  expect(captured.plays).toBe(1)
  const starQ2 = clock.now()
  expect(captured.payload?.stars).toEqual({ q2: starQ2 })
  // a finish in a room that hides its finished keeps its ⭐ (THE RECENT FINISHED: the desktop office draws a room's three
  // most recent) but is neither toasted nor chimed — the beat stays what it was (a finish the room shows by its toggle);
  // the text cards (this terminal) do not draw it
  await ui.press({ key: 'showDone' })
  finishIn(files, Q3, clock.now(), '41 tests.')
  await clock.advance(POLL_MS)
  expect(captured.payload?.agents.find(a => a.id === 'q3')?.status).toBe('done')
  const starQ3 = clock.now()
  expect(captured.payload?.stars).toEqual({ q2: starQ2, q3: starQ3 })
  expect(captured.toasts).toHaveLength(2)
  expect(captured.plays).toBe(1)
  expect(await ui.find({ key: 'open:q3' })).toBeUndefined()
  await ui.press({ key: 'showDone' })
  await clock.advance(POLL_MS)
  expect(captured.toasts).toHaveLength(2)
  expect(captured.payload?.stars).toEqual({ q3: starQ3 }) // q2's window ended; q3's star still inside its own
  await ui.unmount()
})

/** DESKTOP (the Client office): the Client's props as last drawn. */
async function officePropsOf(ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }): Promise<OfficeProps | undefined> {
  return (await ui.find({ type: 'Client' }))?.props.props as OfficeProps | undefined
}

/** DESKTOP (the Client office): the agent's card in the Client's props, by id (undefined when the office does not show it). */
async function cardOf(ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }, id: string): Promise<OfficeAgent | undefined> {
  return (await officePropsOf(ui))?.rooms.flatMap(r => r.agents).find(a => a.id === id)
}

// (The text FALLBACK — `DESKTOP.clientFailed` in model.ts, read by the render — is set only by the plugin's hook on a
// `ui.fault` of the office module (register.tsx); a test file's import of `DESKTOP` is another module instance than
// the plugin bundle's, so a test cannot flip it from outside. register.test.ts drives a real fault of the module:
// no Client, the text cards' `open:a1` back, and `/theater` brings the Client again.)
// (mounts and polls through the kit: past the 5 s default under a full suite on a loaded machine with no code change — the budget is load headroom)
test('DESKTOP: the pane is ONE Client (key office, the literal module, JSON props v1, the engine\'s scroll window, the full content height), no Svg; a republish of the same office hands it the same props; a resize follows the width', { timeoutMs: 30_000 }, async ($, on) => {
  const agents = fixture()
  const { captured, clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 45, scroll: { offset: 4, bodyRows: 25 } } })
  try {
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect(await ui.find({ type: 'Box' })).toBeUndefined()
    const clients = await ui.findAll({ type: 'Client' })
    expect(clients).toHaveLength(1)
    const client = clients[0]!
    expect(client.key).toBe(OFFICE_KEY)
    expect(client.props.module).toBe('hooks/office-client.tsx') // the source's literal is ./office-client.tsx; the engine carries the plugin's path
    expect(client.props.width).toBe(45)
    const p = client.props.props as OfficeProps
    expect(p.v).toBe(1)
    assertJson(p) // plain JSON: no undefined anywhere
    expect(JSON.parse(JSON.stringify(p))).toEqual(p)
    expect(p.columns).toBe(45)
    expect(p.rows).toBe(25)
    expect(p.offset).toBe(4)
    expect(p.lang).toBe('he')
    expect(p.rtl).toBe(true)
    expect(p.usage).toBeNull() // Phase 3 fills the meter
    expect(client.props.height).toBe(officeHeight(p, rowCount(p)))
    // the office as the text cards draw it: room A (its topic) first, B (its project); a1 shown, a2 (finished) among room A's
    // recent finished (THE RECENT FINISHED: the Client's rooms draw up to RECENT_DONE of them, the text cards none); the counts
    expect(p.rooms.map(r => r.title)).toEqual(['Ship the v2 config migration.', 'research'])
    expect(p.rooms.map(r => r.agents.map(a => a.id))).toEqual([['lead-a', 'a1', 'a2'], ['b1']])
    expect(p.rooms[0]).toMatchObject({ moreDone: 0, moreLabel: '' })
    expect(await cardOf(ui, 'a1')).toMatchObject({ name: 'הבנאי', act: '📖 קורא', model: 'Opus 5.5', status: 'running' }) // the row's name is the persona's (persona 7); the role stays in the drawer
    expect(await cardOf(ui, 'b1')).toMatchObject({ act: '🔌 github', model: '?' })
    expect((await cardOf(ui, 'lead-a'))?.status).toBe('running')
    // the slim row: what the cards draw and nothing else (no clock, no tool or model family, no lead flag, no first-seen stamp)
    expect(Object.keys((await cardOf(ui, 'a1'))!).sort()).toEqual(['act', 'emoji', 'failed', 'id', 'longRunning', 'model', 'name', 'star', 'status', 'task'])   // (`task`: the short task, the dim task column from 100 columns)
    expect(p.counts).toEqual({ run: 3, idle: 0, done: 1 })
    expect(p.rooms[0]?.done).toBe(1)
    expect(p.drawer).toBeNull()
    expect(p.empty).toBeNull()
    // a poll that republishes the same office (this fixture rewrites every publish beneath the plugin, so the poll
    // sees a changed state and publishes again — a redraw) hands the module the same props, byte for byte: equal
    // state → equal props, so the module's layout memo holds. (A truly quiet poll redraws nothing: THE FLICKER
    // GUARD below, over the scanner's own office.)
    const writes0 = captured.writes.payload
    await clock.advance(POLL_MS)
    expect(captured.writes.payload).toBe(writes0 + 1)
    expect(JSON.stringify((await ui.find({ type: 'Client' }))?.props.props)).toBe(JSON.stringify(p))
    // a resize: the props follow the width, the height the new layout; a quiet poll after it changes nothing
    await ui.redraw({ ...PANE.props, bodyColumns: 90, scroll: { offset: 0, bodyRows: 25 } })
    const wide = await ui.find({ type: 'Client' })
    const pw = wide?.props.props as OfficeProps
    expect(wide?.props.width).toBe(90)
    expect(pw.columns).toBe(90)
    expect(pw.offset).toBe(0)
    expect(wide?.props.height).toBe(officeHeight(pw, rowCount(pw)))
    await clock.advance(POLL_MS)
    expect(JSON.stringify((await ui.find({ type: 'Client' }))?.props.props)).toBe(JSON.stringify(pw))
    // the plugin's own tree never holds the text toolbar's keys on the desktop: the 🎞/🖼 toggle is the Client's alone
    expect(await ui.find({ key: 'still' })).toBeUndefined()
    expect(await ui.find({ key: 'showDone' })).toBeUndefined()
  } finally {
    await ui.unmount()
  }
})

// (polls and redraws through the kit: past the 5 s default under a full suite on a loaded machine with no code change — 5.07 s on
// 20.10 at 90% CPU — the budget is load headroom)
test('THE FLICKER GUARD: polls with no visible change write NO payload / scanError / view and the desktop pane is NOT redrawn; a visible change or a minute\'s turn publishes ONCE; the terminal keeps ticking', { timeoutMs: 30_000 }, async ($, on) => {
  const files = quietOffice(T0)
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } }, files)
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS) // the first poll scans the files and publishes
  expect(captured.writes.payload).toBe(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 45 } })
  // the pane's render reads `prefs` once per draw; the only other reader is the poll, on a retitle (one read
  // per $.ui.open it makes, captured in `opens`; a finish in the same poll shares it) — so this counts the redraws
  const renders = () => captured.prefsReads - captured.opens.length
  // the office as scanned, in the office Client's props: the lead on Fable (its model read from the conversation's tail), q2 on Opus, q1 unknown
  expect(await cardOf(ui, QSESS)).toMatchObject({ model: 'Fable 5.1' })
  expect(await cardOf(ui, 'q2')).toMatchObject({ model: 'Opus 5.5' })
  expect(await cardOf(ui, 'q1')).toMatchObject({ model: '?', status: 'running', act: '📖 קורא' })
  // (the desktop pane is the one Client: a redraw that changes nothing hands the module the same JSON)
  const propsJson = async () => JSON.stringify((await ui.find({ type: 'Client' }))?.props.props)
  const before = await propsJson()
  const writes0 = { ...captured.writes }
  const desktop0 = renders()
  // FIVE quiet polls (same wall-clock minute: T0 is 20 s past one): nothing drawn changed → nothing written, nothing redrawn
  for (let i = 0; i < 5; i++) await clock.advance(POLL_MS)
  expect(minuteClock(clock.now())).toBe(minuteClock(T0 + POLL_MS))
  expect(captured.writes.payload).toBe(writes0.payload)
  expect(captured.writes.scanError).toBe(writes0.scanError)
  expect(captured.writes.view).toBe(writes0.view)
  expect(captured.fsWrites).toBe(0) // no diagnostics file is written any more
  expect(renders()).toBe(desktop0) // the desktop pane was NOT drawn again
  expect(await propsJson()).toBe(before)
  // THE TICK GUARD: with only the desktop drawing the pane, not even the tick is written (the desktop app
  // redraws the pane on any write of the plugin's) — the idle desktop office sees NO write at all
  expect(captured.writes.tick).toBe(writes0.tick)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 90 } })
  const terminal0 = renders()
  const clockText = async () => (await term.find({ type: 'Text', text: /^\d\d:\d\d$/ }))?.text
  const c0 = await clockText()
  expect(c0).toBeDefined()
  for (let i = 0; i < 3; i++) await clock.advance(POLL_MS)
  expect(renders()).toBeGreaterThanOrEqual(terminal0 + 3)
  expect(await clockText()).not.toBe(c0)
  expect(captured.writes.payload).toBe(writes0.payload)
  // the clocks: the lead's timer counts from its last activity (T0 - 5 s) at MINUTE resolution. Those three
  // polls crossed the office's first minute boundary, which leaves it under a minute ("<1m": nothing drawn
  // moved → NO publish, asserted just above); the boundary after moves it to "1m" (below)
  const leadMtime = T0 - 5000
  const boundary1 = minuteClock(T0) + 60_000
  expect(clock.now()).toBeGreaterThan(boundary1)
  expect(boundary1 - leadMtime).toBeLessThan(60_000)
  // (the rows carry no clock; the props' minute clock is the mount's still — no publish moved it)
  expect(((await ui.find({ type: 'Client' }))?.props.props as OfficeProps).nowMin).toBe(minuteClock(T0 + POLL_MS))
  await term.unmount()
  const desktop1 = renders()
  await clock.advance(POLL_MS)
  expect(renders()).toBe(desktop1)
  // the same payload at the same minute keys the same; scanned_ms is not part of what is drawn
  const sample = { ...EMPTY_PAYLOAD, agents: fixture(), scanned_ms: 1 }
  expect(renderKey(sample, T0)).toBe(renderKey({ ...sample, scanned_ms: 2, versions: ['9.9.9'], skipped: 4 }, T0 + POLL_MS))
  expect(renderKey(sample, T0)).not.toBe(renderKey({ ...sample, agents: sample.agents.map(a => (a.id === 'a1' ? { ...a, tool: 'Write' } : a)) }, T0))
  expect(renderKey(sample, T0)).not.toBe(renderKey(sample, T0 + 60_000))
  // the ⭐ ride the payload: a live star keys differently, an expired one keys as none
  expect(renderKey({ ...sample, stars: { a2: T0 } }, T0)).not.toBe(renderKey(sample, T0))
  expect(renderKey({ ...sample, stars: { a2: T0 - JUST_FINISHED_MS } }, T0)).toBe(renderKey(sample, T0))
  // a VISIBLE change: q1 dispatches Write → exactly one publish, one desktop redraw, the tile recoloured
  const q1 = files.get(Q1)!
  files.set(Q1, {
    text: q1.text + JSON.stringify({ type: 'user', timestamp: '2026-06-01T10:00:06.000Z', version: '2.1.0', message: { content: [{ type: 'tool_result', content: 'ok' }] } }) + '\n' +
      JSON.stringify({ type: 'assistant', timestamp: '2026-06-01T10:00:07.000Z', version: '2.1.0', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'x' } }] } }) + '\n',
    mtimeMs: clock.now(),
  })
  await clock.advance(POLL_MS)
  expect(captured.writes.payload).toBe(writes0.payload + 1)
  expect(renders()).toBe(desktop1 + 1)
  expect(await cardOf(ui, 'q1')).toMatchObject({ status: 'running', act: '✏️ כותב' })
  expect(await propsJson()).not.toBe(before)
  // quiet again: still nothing
  for (let i = 0; i < 3; i++) await clock.advance(POLL_MS)
  expect(captured.writes.payload).toBe(writes0.payload + 1)
  expect(renders()).toBe(desktop1 + 1)
  // RUNNING_STALE_SEC after its last activity the lead falls idle: a visible change (💤, grey) → one publish
  const idleAt = leadMtime + RUNNING_STALE_SEC * 1000
  expect(idleAt).toBeGreaterThan(clock.now())
  await clock.advance(idleAt - clock.now() + POLL_MS)
  expect(captured.writes.payload).toBe(writes0.payload + 2)
  expect(renders()).toBe(desktop1 + 2)
  expect((await cardOf(ui, QSESS))?.status).toBe('stale')
  // the minute boundary after the first one moves the lead's timer to "1m" → ONE publish, ONE redraw, then quiet again
  const boundary2 = boundary1 + 60_000
  expect(boundary2).toBeGreaterThan(clock.now())
  await clock.advance(boundary2 - clock.now() + POLL_MS)
  expect(captured.writes.payload).toBe(writes0.payload + 3)
  expect(renders()).toBe(desktop1 + 3)
  expect(((await ui.find({ type: 'Client' }))?.props.props as OfficeProps).nowMin).toBe(minuteClock(clock.now()))   // the publish moved the props' minute clock
  await clock.advance(POLL_MS)
  await clock.advance(POLL_MS)
  expect(captured.writes.payload).toBe(writes0.payload + 3)
  expect(renders()).toBe(desktop1 + 3)
  // ONE PUBLISH PER POLL: a finish is ONE write that redraws — the ⭐ rides the payload (`stars`), nothing writes
  // `view` (no deferred beat), and the retitle (2 → 1 working) goes out in the same tick BEFORE the write.
  // (A finish is celebrated only on a card the office shows: finished shown first — a press, one redraw.)
  await ui.press({ key: 'showDone' }) // the office Client's toolbar Button: its post → the pref
  const writes1 = { ...captured.writes }
  const opens1 = captured.opens.length
  const desktop2 = renders()
  finishIn(files, Q1, clock.now(), 'Found 12 TODOs; listed them in TODO.md.')
  await clock.advance(POLL_MS)
  expect(captured.writes.view).toBe(writes1.view) // no view write: the star is in the payload
  expect(captured.writes.payload).toBe(writes1.payload + 1) // the one publish
  expect(captured.writes.scanError).toBe(writes1.scanError)
  expect(captured.payload?.stars).toEqual({ q1: clock.now() }) // ⭐ q1, stamped by the poll's clock at the finish
  expect(captured.opens.length).toBe(opens1 + 1)
  expect(captured.opens[captured.opens.length - 1]).toBe('🟢 1 · 🎭 התיאטרון') // retitled: q2 alone works now
  expect(captured.seq.slice(-2)).toEqual(['open', 'payload']) // ... in the same tick, BEFORE the write
  expect(renders()).toBe(desktop2 + 1) // one redraw (the beat's prefs read is the retitle's)
  expect(captured.toasts).toHaveLength(1)
  expect(captured.plays).toBe(1)
  // the tile: ⭐ (the stamp rides the props) on the status column + done — and that is the whole finish: nothing tinted, no
  // clock (live check 6), no redraw of the pane; no confetti Client on the desktop (the office Client is the only one)
  expect(await cardOf(ui, 'q1')).toMatchObject({ status: 'done', star: clock.now() })
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /^⭐$/ })).toBeDefined()
  expect(await tintShown(ui)).toBe(false)
  await ui.advance(2000)
  expect(await tintShown(ui)).toBe(false)
  expect(renders()).toBe(desktop2 + 1)
  expect((await ui.findAll({ type: 'Client' })).map(c => c.key)).toEqual([OFFICE_KEY])
  // quiet: the ⭐ holds inside its window, nothing is written or redrawn
  await clock.advance(POLL_MS)
  expect(captured.writes.payload).toBe(writes1.payload + 1)
  expect(renders()).toBe(desktop2 + 1)
  expect((await cardOf(ui, 'q1'))?.star).toBeGreaterThan(0)
  // a redraw inside the window (the help popover, opened and closed: two view writes, two redraws, no
  // publish) keeps the ⭐ (static), nothing tinted
  await ui.press({ key: 'help' })
  expect((await officePropsOf(ui))?.helpOpen).toBe(true)
  expect((await cardOf(ui, 'q1'))?.star).toBeGreaterThan(0)
  expect(await tintShown(ui)).toBe(false)
  await ui.press({ key: 'help' })
  expect((await officePropsOf(ui))?.helpOpen).toBe(false)
  expect(captured.writes.payload).toBe(writes1.payload + 1)
  expect(captured.writes.view).toBe(writes1.view + 2)
  const views3 = captured.writes.view
  const desktop3 = renders()
  // the window ends: ONE publish drops the star (the stars are pruned in the payload), then quiet again
  await clock.advance(JUST_FINISHED_MS)
  expect(captured.writes.payload).toBe(writes1.payload + 2)
  expect(renders()).toBe(desktop3 + 1)
  expect(captured.payload?.stars).toEqual({})
  expect((await cardOf(ui, 'q1'))?.star).toBe(0)
  expect(captured.writes.view).toBe(views3) // the expiry wrote no view either
  expect(captured.toasts).toHaveLength(1)
  await clock.advance(POLL_MS)
  expect(captured.writes.payload).toBe(writes1.payload + 2)
  expect(renders()).toBe(desktop3 + 1)
  await ui.unmount()
})

// (mounts and polls through the kit: past the 5 s default under a full suite on a loaded machine with no code change — the budget is load headroom)
test('HOUSEKEEPING (the publish branch, same tick as the write): a vanished selection resets view.selected (one view write); a vanished pinned room drops its pin (one prefs write) and its roomDone override (one store write); nothing when nothing vanished; never in the demo or on an empty office', { timeoutMs: 30_000 }, async ($, on) => {
  const files = quietOffice(T0)
  secondRoom(files, T0)
  finishIn(files, Q2, T0 - 7000, 'All green.') // room 1 has a finished agent too (its ✅ counts are drawn)
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } }, files)
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS) // the first poll scans the files and publishes: two rooms, three working (both leads, q1)
  expect(captured.writes.payload).toBe(1)
  expect(captured.opens[captured.opens.length - 1]).toBe('🟢 3 · 🎭 התיאטרון')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // (the desktop pane is the office Client: room 2's head carries its pin as a pointer hit (its ✅ counts read-only), a tile
  // opens the drawer (`props.drawer`) — each a click inside the Client, posted to the plugin's `ui.message` hook)
  expect((await officePropsOf(ui))?.rooms.find(r => r.id === QSESS2)).toMatchObject({ done: 1, pinned: false })
  // (1) the drawer open on q1, then q1's transcript ages out of the office: the next structure publish
  //     resets the selection — ONE extra view write, after the payload write, in the same tick — and the
  //     drawer is closed; no prefs / store write (no room vanished)
  await clickIn(ui, 'agent', 'q1')
  expect((await officePropsOf(ui))?.drawer?.id).toBe('q1')
  expect(captured.view?.selected).toBe('q1')
  const w1 = { ...captured.writes }
  const s1 = { ...captured.storeWrites }
  const reads1 = captured.prefsReads
  ageOut(files, Q1, clock.now())
  await clock.advance(POLL_MS)
  expect(captured.payload?.agents.some(a => a.id === 'q1')).toBe(false)
  expect(captured.writes.payload).toBe(w1.payload + 1)
  expect(captured.writes.view).toBe(w1.view + 1)
  expect(captured.view?.selected).toBeNull()
  expect(captured.writes.prefs).toBe(w1.prefs)
  expect(captured.storeWrites).toEqual(s1)
  expect(captured.seq.slice(-3)).toEqual(['open', 'payload', 'view']) // the retitle (3 → 2 working), the publish, then the reset
  // the redraws, pinned: the retitle's prefs read + ONE draw — the engine coalesces the redraws of one tick,
  // so the payload write and the view write right after it are drawn once (two writes, one redraw)
  expect(captured.prefsReads).toBe(reads1 + 2)
  expect((await officePropsOf(ui))?.drawer).toBeNull()
  // a quiet poll after it: nothing is written (the selection is null, nothing else vanished)
  const w2 = { ...captured.writes }
  const reads2 = captured.prefsReads
  await clock.advance(POLL_MS)
  expect(captured.writes).toEqual(w2)
  expect(captured.storeWrites).toEqual(s1)
  expect(captured.prefsReads).toBe(reads2) // ... and the pane is not redrawn
  // (2) room 2 pinned and its "show finished" overridden, then the whole room ages out: the next structure
  //     publish drops the pin (one prefs write + its store mirror) and the override (one store write), after
  //     the payload write in the same tick; no view write (nothing selected)
  await clickIn(ui, 'pin', QSESS2)
  await ui.post({ t: 'roomDone', room: QSESS2 }, { in: OFFICE_KEY })   // (its finished toggle's post: the room draws no more line)
  expect((await officePropsOf(ui))?.rooms.find(r => r.id === QSESS2)).toMatchObject({ pinned: true, showDone: true })
  expect((captured.store.prefs as { pins: string[] }).pins).toEqual([QSESS2])
  expect(captured.store.roomDone).toEqual({ [QSESS2]: true })
  const w3 = { ...captured.writes }
  const s3 = { ...captured.storeWrites }
  ageOut(files, QLEAD2, clock.now())
  ageOut(files, R1, clock.now())
  await clock.advance(POLL_MS)
  expect(captured.payload?.agents.map(a => a.session_full)).toEqual([QSESS, QSESS])
  expect(captured.writes.payload).toBe(w3.payload + 1)
  expect(captured.writes.prefs).toBe(w3.prefs + 1)
  expect(captured.writes.view).toBe(w3.view)
  expect(captured.storeWrites.prefs).toBe((s3.prefs ?? 0) + 1)
  expect(captured.storeWrites.roomDone).toBe((s3.roomDone ?? 0) + 1)
  expect((captured.store.prefs as { pins: string[] }).pins).toEqual([])
  expect(captured.store.roomDone).toEqual({})
  expect(captured.seq.slice(-5)).toEqual(['open', 'payload', 'prefs', 'store:prefs', 'store:roomDone'])
  // (3) quiet polls afterwards: nothing is written, nothing redrawn (THE FLICKER GUARD holds after a prune)
  const w4 = { ...captured.writes }
  const s4 = { ...captured.storeWrites }
  const reads4 = captured.prefsReads
  for (let i = 0; i < 2; i++) await clock.advance(POLL_MS)
  expect(captured.writes).toEqual(w4)
  expect(captured.storeWrites).toEqual(s4)
  expect(captured.prefsReads).toBe(reads4)
  // the render's own copy of the overrides followed the prune: a toggle on room 1 writes room 1 alone
  // (a stale copy would resurrect room 2's pruned entry)
  await ui.post({ t: 'roomDone', room: QSESS }, { in: OFFICE_KEY })
  expect(captured.store.roomDone).toEqual({ [QSESS]: true })
  // (4) never in the demo, never on an empty office: room 1 pinned, then the demo cast (other rooms) and an
  //     office with no agent at all are published — the pin and the override stay
  await clickIn(ui, 'pin', QSESS)
  expect((captured.store.prefs as { pins: string[] }).pins).toEqual([QSESS])
  const w5 = { ...captured.writes }
  const s5 = { ...captured.storeWrites }
  await ui.key({ in: OFFICE_KEY, key: 'd' })   // (the demo Button lives in the help popover; its letter is the module's)
  await clock.advance(POLL_MS)
  expect(captured.payload?.demo).toBe(true)
  expect((await officePropsOf(ui))?.demo).toBe(true)
  expect(captured.writes.payload).toBeGreaterThan(w5.payload)
  await ui.key({ in: OFFICE_KEY, key: 'd' })
  ageOut(files, `${QPROJ}/${QSESS}.jsonl`, clock.now())
  ageOut(files, Q2, clock.now())
  await clock.advance(POLL_MS)
  expect(captured.payload?.demo).toBe(false)
  expect(captured.payload?.agents).toEqual([])
  expect(captured.writes.prefs).toBe(w5.prefs)
  expect(captured.storeWrites).toEqual(s5)
  expect((captured.store.prefs as { pins: string[] }).pins).toEqual([QSESS])
  expect(captured.store.roomDone).toEqual({ [QSESS]: true })
  await ui.unmount()
})

// (mounts and polls through the kit: past the 5 s default under a full suite on a loaded machine with no code change — the budget is load headroom)
test('a FAILED scan never touches user state: the first scan after a hot reload fails (LAST_GOOD empty) while a subagent of this session is live → the failure publishes the live agent alone, prunes no pin or override, resets no selection', { timeoutMs: 30_000 }, async ($, on) => {
  const files = quietOffice(T0)
  secondRoom(files, T0)
  // what survives a hot reload: the pin and the override of room 2 ($.store), the selection of q1 ($.state,
  // injected below); what does not: the scanner's LAST_GOOD (module memory — empty until a scan succeeds,
  // as a fresh plugin environment's is)
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'he', muted: false, showDone: false, pins: [QSESS2] }, roomDone: { [QSESS2]: true } }, files)
  // the engine beneath starts each subagent and names it
  on('agent.spawn', ($, e) => ({ model: 'haiku', agentId: `live-${e.tool_use_id}` }))
  // the environment is down from the start: every scan FAILS (scanAll → `{ ...LAST_GOOD, error }`, LAST_GOOD empty)
  captured.envDown = true
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
  expect(captured.payload?.agents).toEqual([])
  expect(captured.writes.scanError).toBe(1) // the failure is reported
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  captured.selectedBeneath = 'q1' // the selection $.state kept: q1 of room 1, which no scan has shown since the reload
  const w = { ...captured.writes }
  const s = { ...captured.storeWrites }
  // a subagent of THIS session starts (its spawn auto-opens the pane and polls at once): mergeLive adds it to
  // the empty failed office — a non-empty, real-looking office that is NOT the office
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'Read it.', description: 'desc t1', subagentType: 'Explore', parentModel: 'opus' } as Parameters<typeof $.agent.spawn>[0])
  await clock.advance(POLL_MS)
  expect(captured.writes.payload).toBe(w.payload + 1) // published: the live agent alone, with the scan error standing
  expect(captured.payload?.agents.map(a => a.id)).toEqual(['live-t1'])
  expect(captured.writes.view).toBe(w.view) // the selection (q1, another room) is kept
  expect(captured.writes.prefs).toBe(w.prefs) // the pin of room 2 is kept ...
  expect(captured.storeWrites).toEqual(s) // ... and its override
  expect((captured.store.prefs as { pins: string[] }).pins).toEqual([QSESS2])
  expect(captured.store.roomDone).toEqual({ [QSESS2]: true })
  // the environment is back: the real office returns (nothing vanished) → still no housekeeping write, and the
  // kept selection draws its drawer on q1
  captured.envDown = false
  await clock.advance(POLL_MS)
  expect(captured.payload?.agents.some(a => a.id === 'q1')).toBe(true)
  expect(captured.writes.view).toBe(w.view)
  expect(captured.writes.prefs).toBe(w.prefs)
  expect(captured.storeWrites).toEqual(s)
  expect((await officePropsOf(ui))?.drawer?.id).toBe('q1') // the kept selection draws its drawer (the office Client's)
  await ui.unmount()
})

// (mounts and polls through the kit: past the 5 s default under a full suite on a loaded machine with no code change — the budget is load headroom)
test('THE FOOTER (live check 6): an oversized transcript is the too-long conversations note — in the desktop office\'s settings popover (props.oversized: no chrome row, drawn once the popover opens), in the text cards\' dim footer; the scan error stays in the desktop office\'s footer line (props.footer, one chrome row, drawn by the module) and joins the text cards\' footer', { timeoutMs: 30_000 }, async ($, on) => {
  const files = quietOffice(T0)
  // a subagent transcript over 4 MiB ($.fs.read's limit) whose tail helper fails: skipped and counted (payload.oversized)
  files.set(`${QPROJ}/${QSESS}/subagents/agent-big.jsonl`, { text: '', mtimeMs: T0 - 2000, size: 5 * 1024 * 1024 })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'no helper process in this test', isStdoutTruncated: false, isStderrTruncated: false } }))
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'en', muted: false, showDone: false, pins: [] } }, files)
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
  expect(captured.payload?.oversized).toBe(1)
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 90 } })
  const term = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 90 } })
  const NOTE = 'One conversation is too long to show'
  let p = (await officePropsOf(desk))!
  expect(p.footer).toBe('')
  expect(p.oversized).toBe(NOTE)
  expect(chromeRows(p)).toBe(fixedRows(p))
  expect(await desk.find({ in: OFFICE_KEY, type: 'Text', text: /too long|transcript/ })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /^One conversation is too long to show$/ })).toBeDefined()
  // the settings popover opened: its last line the note (dim), the popover a row taller
  await desk.press({ key: 'help' })
  p = (await officePropsOf(desk))!
  expect(p.helpOpen).toBe(true)
  expect(chromeRows(p)).toBe(fixedRows(p))   // (the popover floats: no chrome row)
  expect(overlayHeight(p)).toBe(helpRows(p.columns, true))
  const noteText = await desk.find({ in: OFFICE_KEY, type: 'Text', text: /One.conversation.is.too.long.to.show/ })
  expect(noteText).toBeDefined()
  expect(noteText!.props.dimColor).toBe(true)
  await desk.press({ key: 'help' })
  expect((await officePropsOf(desk))?.helpOpen).toBe(false)
  // the scan fails: its error is the desktop footer (the last good office stays drawn, its note in the settings) — one line; the
  // text cards' footer joins the two
  captured.envDown = true
  await clock.advance(POLL_MS)
  p = (await officePropsOf(desk))!
  // (the kit's env.get refuses: what the engine says then is the scan error)
  expect(p.footer).toMatch(/env\.get/)
  expect(p.footer).not.toMatch(/too long|transcript/)
  expect(p.oversized).toBe(NOTE)
  expect(chromeRows(p)).toBe(fixedRows(p) + 1)
  expect(await desk.find({ in: OFFICE_KEY, type: 'Text', text: /env\.get/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /^One conversation is too long to show · .*env\.get/ })).toBeDefined()
  // the scan works again: the error leaves the footer
  captured.envDown = false
  await clock.advance(POLL_MS)
  expect((await officePropsOf(desk))?.footer).toBe('')
  expect((await officePropsOf(desk))?.oversized).toBe(NOTE)
  await term.unmount()
  await desk.unmount()
})

// (mounts and polls through the kit: past the 5 s default under a full suite on a loaded machine with no code change — the budget is load headroom)
test('a poll that throws past the scan, poll after poll, reports it ONCE (the stored scanError compared first, as the scan\'s own error is): no write and no redraw per failing poll; the error clears once the poll works again', { timeoutMs: 30_000 }, async ($, on) => {
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } }, quietOffice(T0))
  on('agent.spawn', ($, e) => ({ model: 'haiku', agentId: `live-${e.tool_use_id}` }))
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
  // a subagent of this session: the poll ages the live map from $.agent.list every tick
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'Read it.', description: 'desc t1', subagentType: 'Explore', parentModel: 'opus' } as Parameters<typeof $.agent.spawn>[0])
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const w0 = captured.writes.scanError
  const reads0 = captured.prefsReads
  // every poll now throws after its scan (the engine's agent list comes back as no list): one scanError write, one
  // redraw, however many polls
  captured.agentListBroken = true
  for (let i = 0; i < 3; i++) await clock.advance(POLL_MS)
  expect(captured.writes.scanError).toBe(w0 + 1)
  expect(captured.prefsReads).toBe(reads0 + 1) // the one redraw that draws the error
  expect((await officePropsOf(ui))?.footer).not.toBe('')
  // the poll works again: the error is cleared (one write) and stays cleared
  captured.agentListBroken = false
  for (let i = 0; i < 2; i++) await clock.advance(POLL_MS)
  expect(captured.writes.scanError).toBe(w0 + 2)
  expect((await officePropsOf(ui))?.footer).toBe('')
  await ui.unmount()
})

test('SETTLE_MS holds through a poll\'s jitter: a structure change seen by a poll a hair short of SETTLE_MS after the last publish (a /theater poll SETTLE_MS - 200 ms after it) publishes on that poll; well inside SETTLE_MS it still waits for the next tick', async ($, on) => {
  const files = quietOffice(T0)
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'he', muted: true, showDone: true, pins: [] } }, files)
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.settle() // the first poll (T0) scans and publishes
  // q1 finishes: the tick at T0 + POLL_MS publishes it — the publish the rest is timed from
  finishIn(files, Q1, clock.now(), 'Found 12 TODOs.')
  await clock.advance(POLL_MS)
  const w0 = captured.writes.payload
  expect(w0).toBe(2)
  // q2 finishes, and a poll sees it SETTLE_MS - 200 ms after that publish (a /theater press polls at once; a tick a hair
  // early is the same): inside SETTLE_SLACK_MS, so it publishes now, not a poll later
  expect(SETTLE_SLACK_MS).toBeGreaterThanOrEqual(200)
  await clock.advance(SETTLE_MS - 200)
  finishIn(files, Q2, clock.now(), 'All green.')
  await $.command.run(THEATER)
  await clock.settle()
  expect(captured.writes.payload).toBe(w0 + 1)
  // a newcomer 1 s after that publish waits: a burst inside SETTLE_MS is still one redraw (the tick crossed meanwhile is quiet)
  await clock.advance(1000)
  files.set(Q3, subagentMidTool('q3', 'Count the tests.', clock.now()))
  await $.command.run(THEATER)
  await clock.settle()
  expect(captured.writes.payload).toBe(w0 + 1)
  // ... until the next tick, SETTLE_MS on
  await clock.advance(POLL_MS)
  expect(captured.writes.payload).toBe(w0 + 2)
})

test('THE RETITLE never reopens a closed pane: the person closes the pane while the scan runs, and the publish after it (a working count that moved) makes no $.ui.open; with the pane open again the next publish retitles', async ($, on) => {
  const files = quietOffice(T0)
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'he', muted: true, showDone: false, pins: [] } }, files)
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.settle() // the first poll (T0) scans and publishes
  expect(captured.opens.length).toBe(1) // the first publish retitled the pane with the working count
  const opens0 = captured.opens.length
  const w0 = captured.writes.payload
  // q1 finishes (the working count moves) and the person closes the pane after the poll found it up, while it scans
  finishIn(files, Q1, clock.now(), 'Found 12 TODOs.')
  captured.onScan = () => { captured.paneOpen = false }
  await clock.advance(POLL_MS)
  expect(captured.writes.payload).toBe(w0 + 1) // published ...
  expect(captured.opens.length).toBe(opens0) // ... and no $.ui.open, which would have opened the closed pane again
  // the pane is open again (the person's /theater would retitle it itself; here the engine just lists it): the next
  // publish retitles, the count still owed
  captured.paneOpen = true
  finishIn(files, Q2, clock.now(), 'All green.')
  await clock.advance(POLL_MS)
  expect(captured.writes.payload).toBe(w0 + 2)
  expect(captured.opens.length).toBe(opens0 + 1)
  expect(captured.opens[captured.opens.length - 1]).toMatch(/🎭 התיאטרון$/)
})

// (mounts and polls through the kit: past the 5 s default under a full suite on a loaded machine with no code change — the budget is load headroom)
test('AGENT TEXT reaches every surface clean: an ANSI colour code and an RLM in a transcript\'s prompt and a conversation\'s first line, a BEL in a live spawn\'s description — the terminal cards and the desktop office Client both draw (no refusal, no fault), no drawn text holds a refused character, the Hebrew stays; quiet polls publish nothing', { timeoutMs: 30_000 }, async ($, on) => {
  const ESC = String.fromCharCode(0x1b)
  const BEL = String.fromCharCode(0x07)
  const RLM = String.fromCharCode(0x200f)
  const rec = (o: Record<string, unknown>) => JSON.stringify(o)
  const files = quietOffice(T0)
  // the room's title (its lead's first line) carries a colour code and a mark ...
  files.set(`${QPROJ}/${QSESS}.jsonl`, {
    text: [
      rec({ type: 'user', sessionId: QSESS, cwd: 'C:/x', timestamp: '2026-06-01T09:00:00.000Z', message: { role: 'user', content: `Quiet ${ESC}[1moffice${ESC}[0m${RLM} test. Nothing moves.` } }),
      rec({ type: 'assistant', sessionId: QSESS, timestamp: '2026-06-01T09:00:01.000Z', message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text: 'Watching.' }] } }),
    ].join('\n') + '\n',
    mtimeMs: T0 - 5000,
  })
  // ... and so does a subagent's prompt (pasted from a terminal and a Hebrew editor), over two lines
  files.set(`${QPROJ}/${QSESS}/subagents/agent-qx.jsonl`, subagentMidTool('qx', `Fix the ${ESC}[31mred${ESC}[0m test. ${RLM}בדקו שוב\nואז דווחו`, T0 - 6000))
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } }, files)
  on('agent.spawn', ($, e) => ({ model: 'haiku', agentId: `live-${e.tool_use_id}` }))
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
  // a live subagent of this session whose description rings a bell
  await $.agent.spawn({ tool_use_id: 't1', prompt: `Ping${BEL} the team.\n${ESC}[1mnow${ESC}[0m`, description: `ring${BEL}bell`, subagentType: 'Explore', parentModel: 'opus' } as Parameters<typeof $.agent.spawn>[0])
  await clock.advance(POLL_MS)
  const clean = (s: string | undefined) => s === undefined || !REFUSED_RE.test(s)
  const strings = (x: unknown): string[] => (typeof x === 'string' ? [x] : x !== null && typeof x === 'object' ? Object.values(x).flatMap(strings) : [])
  // TERMINAL: the cards draw (a refused character refuses the whole tree: drawn() would reject)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 90 } })
  await term.drawn()
  expect((await term.find({ key: 'open:live-t1' }))?.text).toMatch(/ring bell/)
  expect(await term.find({ type: 'Text', text: /^💬 Quiet office test\.$/ })).toBeDefined()
  // the drawer: the first sentence (task_short) one line; the task keeps its line break and its Hebrew, loses the code and the mark
  await term.press({ key: 'open:qx' })
  expect(await term.find({ type: 'Text', text: /^Fix the red test\.$/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: 'Fix the red test. בדקו שוב\nואז דווחו' })).toBeDefined()
  for (const el of await term.findAll({})) expect(clean(el.text)).toBe(true)
  // DESKTOP: the office Client draws (no refusal, no fault → no fall back to the cards), its props and its drawing clean
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 90 } })
  await desk.drawn({ in: OFFICE_KEY })
  const p = (await officePropsOf(desk))!
  expect(p).toBeDefined()
  expect(p.drawer?.id).toBe('qx')
  expect(p.drawer?.task).toBe('Fix the red test. בדקו שוב\nואז דווחו')
  expect(p.rooms.find(r => r.id === QSESS)?.title).toBe('Quiet office test.')
  expect(p.rooms.flatMap(r => r.agents).find(a => a.id === 'live-t1')?.name).toBe('העקרב')   // (the row's name is the persona's; the cleaned description is the drawer's)
  for (const s of strings(p)) expect(clean(s)).toBe(true)
  for (const el of await desk.findAll({ in: OFFICE_KEY })) expect(clean(el.text)).toBe(true)
  // the cleaning is deterministic: quiet polls publish nothing and hand the Client the same props (the flicker guard's key holds)
  const w0 = { ...captured.writes }
  const before = JSON.stringify(p)
  for (let i = 0; i < 3; i++) await clock.advance(POLL_MS)
  expect(captured.writes.payload).toBe(w0.payload)
  expect(captured.writes.scanError).toBe(w0.scanError)
  expect(captured.writes.view).toBe(w0.view)
  expect(JSON.stringify(await officePropsOf(desk))).toBe(before)
  await term.unmount()
  await desk.unmount()
})

test('TERMINAL / VSCODE / MOBILE: no SVG tile anywhere; the text cards stay', async ($, on) => {
  const agents = fixture()
  const { clock } = beneath(on, () => agents, { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
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

// (mounts and polls through the kit: past the 5 s default under a full suite on a loaded machine with no code change — the budget is load headroom)
test('demo mode: the empty office offers a demo; it draws the scripted office; its cast obeys "show finished" (live check 5: the demo no longer forces it) and its finishes are never toasted nor chimed (pre-check 6: the demo is silent), shown or not', { timeoutMs: 30_000 }, async ($, on) => {
  const { captured, clock } = beneath(on, () => [], { prefs: { lang: 'en', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
  // (on the terminal: the desktop's "watch a demo" Button is the office Client's, whose post Task 2.5 wires)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await messageOf(ui, 'terminal', /The office is empty/)).toBe(true)
  await ui.press({ key: 'watchDemo' })
  expect(await ui.find({ type: 'Text', text: /💬 Ship the v2 config migration/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /💬 Plan the static-regeneration rollout/ })).toBeDefined()
  expect(await ui.find({ key: 'open:demo-finisher-gg' })).toBeDefined()
  expect((await ui.find({ key: 'demo' }))?.text).toMatch(/Exit/)
  // the demo's finished writer is hidden as any finished agent is while "show finished" is off (the demo once forced it on)
  expect(await ui.find({ key: 'open:demo-writer-ff' })).toBeUndefined()
  // phase 6 of the loop: the finisher completes — its room hides its finished: no toast, no chime, its card gone;
  // the office redraws on the poll (POLL_MS), so walk one poll past the phase edge
  const toPhase6 = 6000 - (clock.now() % 12000) + 12000
  await clock.advance(toPhase6 + SETTLE_MS)
  expect(captured.payload?.agents.find(a => a.id === 'demo-finisher-gg')?.status).toBe('done')
  expect(captured.toasts).toEqual([])
  expect(captured.plays).toBe(0)
  expect(await ui.find({ key: 'open:demo-finisher-gg' })).toBeUndefined()
  expect(await ui.find({ key: 'open:demo-newcomer-hh' })).toBeDefined()
  // "show finished" on: the demo's finished are drawn, and the later loops' finishes are shown (each ⭐ stamped anew after
  // the press) — and still SILENT (pre-check 6): a demo finish is neither toasted nor chimed, shown or not (a real finish
  // keeps both: the finish beat's test). (The finisher finishes every 12 s loop; a finish is celebrated once its last ⭐ left
  // the payload: a poll or a few, a loop or two — the chime came within these 16 polls before the demo went silent.)
  await ui.press({ key: 'showDone' })
  expect(await ui.find({ key: 'open:demo-writer-ff' })).toBeDefined()
  const pressedAt = clock.now()
  const stamps = new Set<number>()
  for (let i = 0; i < 16; i++) {
    await clock.advance(POLL_MS)
    const at = captured.payload?.stars['demo-finisher-gg']
    if (at !== undefined && at > pressedAt) stamps.add(at)
  }
  expect(stamps.size).toBeGreaterThanOrEqual(3)
  expect(captured.toasts).toEqual([])
  expect(captured.plays).toBe(0)
  expect(await ui.find({ key: 'open:demo-finisher-gg' })).toBeDefined()
  // exit restores the real (empty) office AT ONCE, even right after a demo publish: the redraw after the press polls at
  // once (register.tsx's render kick) and that poll publishes the switch whatever SETTLE_MS / CALM_MS say. (The kit keeps
  // a demo publish whole in state, as a live engine does: without the switch publish the demo cast would stay drawn, frozen.)
  const w = captured.writes.payload
  for (let i = 0; i < 30 && captured.writes.payload === w; i++) await clock.advance(1000)
  expect(captured.writes.payload).toBe(w + 1) // a demo publish just landed (under a second ago)
  expect(captured.payload?.demo).toBe(true)
  await ui.press({ key: 'demo' })
  await clock.settle()
  expect(captured.payload?.demo).toBe(false)
  expect(await messageOf(ui, 'terminal', /The office is empty/)).toBe(true)
  expect(await ui.find({ key: 'open:demo-finisher-gg' })).toBeUndefined()
  await ui.unmount()
})

test('DESKTOP RTL: the empty office is the office Client\'s (the direction a flag, the sub split into its own lines by the module); the search placeholder drops its trailing ellipsis; the terminal keeps its Text lines', async ($, on) => {
  beneath(on, () => [], { prefs: { lang: 'he', muted: false, showDone: false, pins: [] } })
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 45 } })
  // no Svg, no engine Text of the plugin's own: the message and its sub ride the Client's props, the module draws them
  const p = await officePropsOf(desk)
  expect(p?.rtl).toBe(true)
  // (the sub names Claude Code in Hebrew letters: THE HEBREW RULE, i18n.ts — no Latin inside a Hebrew Text)
  expect(p?.empty).toEqual({ kind: 'office', msg: 'המשרד ריק', sub: 'הפעילו סוכן בקלוד קוד - או הציצו איך נראה משרד עמוס' })
  // the sub is split at its " - " into its own lines (office-chrome.ts emptyLines, the module's split)
  expect(emptyLines(p!)).toEqual({ msg: ['המשרד ריק'], sub: ['הפעילו סוכן בקלוד קוד', 'או הציצו איך נראה משרד עמוס'] })
  expect(await desk.find({ type: 'Svg' })).toBeUndefined()
  expect(await desk.find({ type: 'Text', text: /Claude Code/ })).toBeUndefined()
  expect(await desk.find({ in: OFFICE_KEY, type: 'Text', text: /^המשרד ריק$/ })).toBeDefined()
  expect(await desk.find({ in: OFFICE_KEY, type: 'Text', text: /^הפעילו סוכן בקלוד קוד$/ })).toBeDefined()
  expect(await desk.find({ in: OFFICE_KEY, type: 'Text', text: /^או הציצו איך נראה משרד עמוס$/ })).toBeDefined()
  expect(await desk.find({ in: OFFICE_KEY, key: 'watchDemo' })).toBeDefined()
  expect(await desk.find({ in: OFFICE_KEY, key: 'search' })).toBeUndefined()   // no search field in an empty office (only above SEARCH_FROM shown agents: spec 2026-10-10 §2 item 22; its placeholder `חיפוש סוכנים 🔍` is office-client.test.ts's)
  await desk.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 90 } })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /^הפעילו סוכן בקלוד קוד - או/ })).toBeDefined()
  expect((await term.find({ key: 'search' }))?.props?.placeholder).toBe('🔍 חיפוש סוכנים…')
  await term.unmount()
})

// (mounts and polls through the kit: past the 5 s default under a full suite on a loaded machine with no code change — the budget is load headroom)
test('DESKTOP 🎞/🖼 GONE (live check 7, Q9: nothing read it): no still Button on the toolbar, in the settings or the text cards; its letter s and an old `still` post write nothing; the stored prefs keep their `still` field', { timeoutMs: 30_000 }, async ($, on) => {
  const { captured, clock } = beneath(on, () => fixture(), { prefs: { lang: 'he', muted: false, showDone: false, pins: [], still: true } })
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 45 } })
  expect(await ui.find({ in: OFFICE_KEY, key: 'still' })).toBeUndefined()
  expect(await ui.find({ key: 'still' })).toBeUndefined()
  expect(Object.keys((await officePropsOf(ui))?.prefs ?? {})).toEqual(['showDone', 'muted'])
  await ui.press({ key: 'help' })
  expect((await officePropsOf(ui))?.helpOpen).toBe(true)
  expect(await ui.find({ in: OFFICE_KEY, key: 'still' })).toBeUndefined()
  await ui.press({ key: 'help' })
  const writes = { ...captured.writes }
  await ui.key({ in: OFFICE_KEY, key: 's' })
  await ui.post({ t: 'still' }, { in: OFFICE_KEY })
  expect(captured.writes).toEqual(writes)
  expect((captured.store.prefs as { still?: boolean }).still).toBe(true)
  await ui.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 90 } })
  expect(await term.find({ key: 'still' })).toBeUndefined()
  await term.unmount()
})
