// Scanner tests: the pure ports against the golden fixtures (../../fixtures),
// and scanAll against an in-memory ~/.claude laid out like Claude Code's:
//   ~/.claude/projects/<enc>/<session>.jsonl                      the conversation
//   ~/.claude/projects/<enc>/<session>/subagents/agent-*.jsonl    its subagents
//   ~/.claude/projects/<enc>/<session>/subagents/workflows/wf_x/  a workflow (+ journal.jsonl)
//   ~/.claude/sessions/<pid>.json                                 the open-chat registry
// The fixture texts are embedded verbatim (a test's `$` has no file reads and the
// mod may be junctioned from anywhere); keep them in step with the files.

import { expect, test } from 'claude-code/testing'

import { FS_READ_LIMIT, GLOB_TTL_SEC, MAX_AGE_MIN, POLL_MS, RESULT_CHAR_LIMIT, RUNNING_STALE_SEC } from './model'
import {
  computeInFlight,
  computePhase,
  computeStatus,
  demoPayload,
  detectDone,
  isWorkflowAgent,
  lastModel,
  lastToolUseName,
  liveSessionIds,
  nameMapFor,
  noticeEndsAgent,
  normPrompt,
  NOTICE_SLACK_MS,
  parentSessionFile,
  parseAgentEvent,
  parseEvents,
  parseLastModel,
  parseSessionSummary,
  parseTaskNotifications,
  projectCwdFor,
  resetScannerCaches,
  resolvePersonas,
  scanAll,
  sessionSummary,
  stripInjectedBlocks,
  tailLines,
  taskNotificationsFor,
  unknownVersions,
  workflowJournalResult,
  type ScanIo,
} from './scanner'
import type { Agent } from './model'

// ---------------------------------------------------------------------------
// Fixtures (verbatim copies of fixtures/cc-2.1/*.jsonl and cc-future/*.jsonl)
// ---------------------------------------------------------------------------

const FIXTURES: Record<string, string> = {
  'cc-2.1/running.jsonl': [
    '{"type":"user","agentId":"fixture-run-0001","sessionId":"sess-aaaa-1111","timestamp":"2026-06-01T10:00:00.000Z","cwd":"/home/dev/demo-project","version":"2.1.0","message":{"content":"Find all TODO comments in the repo and summarize them."}}',
    '{"type":"attachment","timestamp":"2026-06-01T10:00:00.500Z","version":"2.1.0"}',
    '{"type":"assistant","timestamp":"2026-06-01T10:00:02.000Z","version":"2.1.0","message":{"content":[{"type":"text","text":"I\'ll search the codebase for TODO markers."}]}}',
    '{"type":"assistant","timestamp":"2026-06-01T10:00:03.000Z","version":"2.1.0","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"TODO"}}]}}',
    '{"type":"user","timestamp":"2026-06-01T10:00:04.000Z","version":"2.1.0","message":{"content":[{"type":"tool_result","content":"12 matches"}]}}',
    '{"type":"assistant","timestamp":"2026-06-01T10:00:05.000Z","version":"2.1.0","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"src/app.py"}}]}}',
    '',
  ].join('\n'),
  'cc-2.1/done.jsonl': [
    '{"type":"user","agentId":"fixture-done-0002","sessionId":"sess-aaaa-1111","timestamp":"2026-06-01T11:00:00.000Z","cwd":"/home/dev/demo-project","version":"2.1.0","message":{"content":"Count the lines of Python in src/."}}',
    '{"type":"assistant","timestamp":"2026-06-01T11:00:01.000Z","version":"2.1.0","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"wc -l"}}]}}',
    '{"type":"user","timestamp":"2026-06-01T11:00:02.000Z","version":"2.1.0","message":{"content":[{"type":"tool_result","content":"1240 total"}]}}',
    '{"type":"assistant","timestamp":"2026-06-01T11:00:03.000Z","version":"2.1.0","message":{"content":[{"type":"text","text":"There are 1240 lines of Python across 18 files in src/."}],"stop_reason":"end_turn"}}',
    '',
  ].join('\n'),
  'cc-2.1/malformed.jsonl': [
    '{"type":"user","agentId":"fixture-bad-0003","sessionId":"sess-bbbb-2222","timestamp":"2026-06-01T12:00:00.000Z","cwd":"/home/dev/demo-project","version":"2.1.0","message":{"content":"Run the test suite and report results."}}',
    'this line is not json at all and must be skipped',
    '{"type":"assistant","timestamp":"2026-06-01T12:00:01.000Z","version":"2.1.0","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"pytest"}}]}}',
    '{"truncated json line with no closing brace',
    '{"type":"user","timestamp":"2026-06-01T12:00:02.000Z","version":"2.1.0","message":{"content":[{"type":"tool_result","content":"42 passed"}]}}',
    '{"type":"assistant","timestamp":"2026-06-01T12:00:03.000Z","version":"2.1.0","message":{"content":[{"type":"text","text":"All 42 tests passed."}],"stop_reason":"end_turn"}}',
    '',
  ].join('\n'),
  'cc-2.1/missing_fields.jsonl': [
    '{"type":"user","sessionId":"sess-cccc-3333","timestamp":"2026-06-01T13:00:00.000Z","cwd":"/home/dev/demo-project","version":"2.1.0","message":{"content":""}}',
    '{"type":"assistant","timestamp":"2026-06-01T13:00:01.000Z","version":"2.1.0","message":{"content":[{"type":"tool_use","name":"Read"}]}}',
    '',
  ].join('\n'),
  'cc-future/unknown_version.jsonl': [
    '{"type":"user","agentId":"fixture-ver-0004","sessionId":"sess-dddd-4444","timestamp":"2026-06-01T14:00:00.000Z","cwd":"/home/dev/demo-project","version":"3.5.0","message":{"content":"A task recorded by an untested future Claude Code build."}}',
    '{"type":"assistant","timestamp":"2026-06-01T14:00:01.000Z","version":"3.5.0","message":{"content":[{"type":"text","text":"Finished."}],"stop_reason":"end_turn"}}',
    '',
  ].join('\n'),
}

const lines = (name: string): string[] => (FIXTURES[name] ?? '').split('\n').filter(l => l.trim() !== '')

// ---------------------------------------------------------------------------
// In-memory ScanIo (same contracts as $.fs: read rejects missing / oversized,
// list rejects a missing dir, stat rejects a missing path)
// ---------------------------------------------------------------------------

type MemFile = { text: string; mtimeMs: number; size?: number }

class MemFs {
  files = new Map<string, MemFile>()
  dirs = new Set<string>()
  reads: string[] = []
  lists: string[] = []

  put(path: string, text: string, mtimeMs: number, size?: number): void {
    this.files.set(path, { text, mtimeMs, size })
    let d = path
    for (;;) {
      const i = d.lastIndexOf('/')
      if (i <= 0) break
      d = d.slice(0, i)
      this.dirs.add(d)
    }
  }

  io(extra: Partial<ScanIo> = {}): ScanIo {
    const sizeOf = (f: MemFile) => f.size ?? f.text.length
    return {
      read: async path => {
        this.reads.push(path)
        const f = this.files.get(path)
        if (!f) throw new Error(`ENOENT: ${path}`)
        if (sizeOf(f) > FS_READ_LIMIT) throw new Error(`file over 4 MiB: ${path}`)
        return f.text
      },
      list: async dir => {
        this.lists.push(dir)
        if (!this.dirs.has(dir)) throw new Error(`ENOENT: ${dir}`)
        const out = []
        const seenDirs = new Set<string>()
        for (const [p, f] of this.files) {
          if (!p.startsWith(dir + '/')) continue
          const rest = p.slice(dir.length + 1)
          const slash = rest.indexOf('/')
          if (slash < 0) out.push({ name: rest, kind: 'file' as const, size: sizeOf(f), mtimeMs: f.mtimeMs, isLink: false })
          else seenDirs.add(rest.slice(0, slash))
        }
        for (const d of this.dirs) {
          if (d.startsWith(dir + '/') && !d.slice(dir.length + 1).includes('/')) seenDirs.add(d.slice(dir.length + 1))
        }
        for (const name of seenDirs) out.push({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
        return out
      },
      stat: async path => {
        const f = this.files.get(path)
        if (f) return { kind: 'file' as const, size: sizeOf(f), mtimeMs: f.mtimeMs, isLink: false }
        if (this.dirs.has(path)) return { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }
        throw new Error(`ENOENT: ${path}`)
      },
      exists: async path => this.files.has(path) || this.dirs.has(path),
      home: async () => '/home/u',
      ...extra,
    }
  }
}

const NOW = Date.parse('2026-06-01T15:00:00.000Z')
const MIN = 60_000
/** The listing TTL in ms: a scan this long after a listing (or a throttled tail read) sees the directory afresh. */
const TTL = GLOB_TTL_SEC * 1000
const HOME = '/home/u'
const PROJ = `${HOME}/.claude/projects/-home-dev-demo-project`

/** A parent conversation transcript: a queue-operation line first (no cwd), then the user, then Agent spawns. */
function parentTranscript(sessionId: string, topic: string, spawns: Array<{ prompt: string; description: string; subagent_type: string }>): string {
  const out = [
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', sessionId }),
    JSON.stringify({ type: 'user', sessionId, cwd: '/home/dev/demo-project', timestamp: '2026-06-01T09:00:00.000Z', message: { role: 'user', content: topic } }),
  ]
  for (const s of spawns) {
    out.push(JSON.stringify({
      type: 'assistant', sessionId, cwd: '/home/dev/demo-project', timestamp: '2026-06-01T09:00:01.000Z',
      message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'tool_use', name: 'Agent', input: { description: s.description, subagent_type: s.subagent_type, prompt: s.prompt } }] },
    }))
  }
  return out.join('\n') + '\n'
}

/** The office of the scan tests: two open chats, one closed, a workflow agent, an oversized transcript. */
function office(): MemFs {
  const fs = new MemFs()
  // conversation A (open): the running and the done fixtures + a workflow agent
  fs.put(`${PROJ}/sess-aaaa-1111.jsonl`, parentTranscript('sess-aaaa-1111', 'Clean up the TODO backlog.\nThen report.', [
    { prompt: 'Find all TODO comments in the repo and summarize them.\n', description: 'todo hunter', subagent_type: 'Explore' },
    { prompt: '  Count the lines of Python in src/.  ', description: 'line counter', subagent_type: 'general-purpose' },
  ]), NOW - 1 * MIN)
  fs.put(`${PROJ}/sess-aaaa-1111/subagents/agent-fixture-run-0001.jsonl`, FIXTURES['cc-2.1/running.jsonl']!, NOW - 10_000)
  fs.put(`${PROJ}/sess-aaaa-1111/subagents/agent-fixture-done-0002.jsonl`, FIXTURES['cc-2.1/done.jsonl']!, NOW - 2 * MIN)
  fs.put(`${PROJ}/sess-aaaa-1111/subagents/workflows/wf_0001/agent-fixture-wf-0005.jsonl`,
    FIXTURES['cc-2.1/running.jsonl']!.replace('fixture-run-0001', 'fixture-wf-0005').replace('Find all TODO comments in the repo and summarize them.', 'Review the PR.'),
    NOW - 30_000)
  fs.put(`${PROJ}/sess-aaaa-1111/subagents/workflows/wf_0001/journal.jsonl`, [
    JSON.stringify({ type: 'started', agentId: 'fixture-wf-0005', label: 'review' }),
    JSON.stringify({ type: 'result', agentId: 'other-agent', result: 'not ours' }),
    JSON.stringify({ type: 'result', agentId: 'fixture-wf-0005', result: { lens: 'review', notes: 'Reviewed: two nits, no blockers.' } }),
    '',
  ].join('\n'), NOW - 20_000)
  // conversation B (closed: not in the registry): the malformed fixture, idle 5 min
  fs.put(`${PROJ}/sess-bbbb-2222.jsonl`, parentTranscript('sess-bbbb-2222', 'Run the tests.', []), NOW - 5 * MIN)
  fs.put(`${PROJ}/sess-bbbb-2222/subagents/agent-fixture-bad-0003.jsonl`, FIXTURES['cc-2.1/malformed.jsonl']!, NOW - 5 * MIN)
  // conversation C (open): the missing-fields fixture, mid-tool, silent 3 min
  fs.put(`${PROJ}/sess-cccc-3333.jsonl`, parentTranscript('sess-cccc-3333', 'Read things.', []), NOW - 3 * MIN)
  fs.put(`${PROJ}/sess-cccc-3333/subagents/agent-nofields-0006.jsonl`, FIXTURES['cc-2.1/missing_fields.jsonl']!, NOW - 3 * MIN)
  // conversation D (open): the future-version fixture + an OVERSIZED transcript
  fs.put(`${PROJ}/sess-dddd-4444.jsonl`, parentTranscript('sess-dddd-4444', 'Future build.', []), NOW - 1 * MIN)
  fs.put(`${PROJ}/sess-dddd-4444/subagents/agent-fixture-ver-0004.jsonl`, FIXTURES['cc-future/unknown_version.jsonl']!, NOW - 1 * MIN)
  fs.put(`${PROJ}/sess-dddd-4444/subagents/agent-huge-0007.jsonl`, FIXTURES['cc-2.1/running.jsonl']!.replace('fixture-run-0001', 'huge-0007').replace('sess-aaaa-1111', 'sess-dddd-4444'), NOW - 1 * MIN, FS_READ_LIMIT + 1)
  // an agent that aged out, and a conversation that aged out
  fs.put(`${PROJ}/sess-aaaa-1111/subagents/agent-old-0008.jsonl`, FIXTURES['cc-2.1/done.jsonl']!, NOW - (MAX_AGE_MIN + 5) * MIN)
  fs.put(`${PROJ}/sess-eeee-5555.jsonl`, parentTranscript('sess-eeee-5555', 'Ancient.', []), NOW - (MAX_AGE_MIN + 5) * MIN)
  // the open-chat registry: A, C and D are open; B is not
  fs.put(`${HOME}/.claude/sessions/101.json`, JSON.stringify({ pid: 101, sessionId: 'sess-aaaa-1111' }), NOW)
  fs.put(`${HOME}/.claude/sessions/102.json`, JSON.stringify({ pid: 102, sessionId: 'sess-cccc-3333' }), NOW)
  fs.put(`${HOME}/.claude/sessions/103.json`, JSON.stringify({ pid: 103, sessionId: 'sess-dddd-4444' }), NOW)
  fs.put(`${HOME}/.claude/sessions/104.json`, '{not json', NOW)
  return fs
}

const byId = (agents: Agent[], id: string): Agent => {
  const a = agents.find(x => x.id === id)
  if (!a) throw new Error(`agent ${id} missing from ${agents.map(x => x.id).join(',')}`)
  return a
}

// ---------------------------------------------------------------------------
// Pure ports on the fixtures
// ---------------------------------------------------------------------------

test('fixtures: running — mid-tool, not done, phase tool, last tool Read', async () => {
  const { events, skipped, versions } = parseEvents(lines('cc-2.1/running.jsonl'))
  expect(events).toHaveLength(6)
  expect(skipped).toBe(0)
  expect(versions).toEqual(['2.1.0'])
  expect(events[1]?.kind).toBe('attachment')
  expect(detectDone(events).isDone).toBe(false)
  expect(computeInFlight(events)).toBe(true)
  expect(computePhase(events)).toBe('tool')
  expect(lastToolUseName(events)).toBe('Read')
  const first = parseAgentEvent(lines('cc-2.1/running.jsonl')[0] ?? '')
  expect(first?.raw.agentId).toBe('fixture-run-0001')
  expect(first?.text).toBe('Find all TODO comments in the repo and summarize them.')
  expect(first?.tsMs).toBe(Date.parse('2026-06-01T10:00:00.000Z'))
})

test('fixtures: done — final text + stop_reason end_turn', async () => {
  const { events } = parseEvents(lines('cc-2.1/done.jsonl'))
  const done = detectDone(events)
  expect(done.isDone).toBe(true)
  expect(done.result).toBe('There are 1240 lines of Python across 18 files in src/.')
  expect(done.endMs).toBe(Date.parse('2026-06-01T11:00:03.000Z'))
  expect(done.truncated).toBe(false)
  expect(computeInFlight(events)).toBe(false)
  expect(computePhase(events)).toBe('thinking')
  expect(lastToolUseName(events)).toBe('Bash')
})

test('fixtures: malformed — 2 corrupt lines skipped, done still detected', async () => {
  const { events, skipped } = parseEvents(lines('cc-2.1/malformed.jsonl'))
  expect(skipped).toBe(2)
  expect(events).toHaveLength(4)
  expect(detectDone(events).result).toBe('All 42 tests passed.')
  expect(parseAgentEvent('this line is not json at all and must be skipped')).toBeNull()
  expect(parseAgentEvent('')).toBeNull()
  expect(parseAgentEvent('[1,2]')).toBeNull()
  expect(parseAgentEvent('{"message":{"content":"x"}}')?.kind).toBe('unknown')
})

test('fixtures: missing fields — empty task, no agentId, still an event', async () => {
  const { events } = parseEvents(lines('cc-2.1/missing_fields.jsonl'))
  expect(events[0]?.text).toBe('')
  expect(events[0]?.raw.agentId).toBeUndefined()
  expect(computePhase(events)).toBe('tool')
  expect(lastToolUseName(events)).toBe('Read')
})

test('fixtures: unknown version — banner input, done anyway', async () => {
  const { events, versions } = parseEvents(lines('cc-future/unknown_version.jsonl'))
  expect(versions).toEqual(['3.5.0'])
  expect(unknownVersions(versions)).toEqual(['3.5'])
  expect(unknownVersions(['2.1.288', '2.1.0'])).toEqual([])
  expect(unknownVersions(['', 'x'])).toEqual(['x'])
  expect(detectDone(events).result).toBe('Finished.')
})

test('detectDone: the deny-list — tool_use/pause_turn continue, anything else ends', async () => {
  const mk = (stop: string | null, tool = false) => parseAgentEvent(JSON.stringify({
    type: 'assistant', message: { content: tool ? [{ type: 'tool_use', name: 'Read' }] : [{ type: 'text', text: 'x '.repeat(3000) }], ...(stop === null ? {} : { stop_reason: stop }) },
  }))!
  expect(detectDone([mk('tool_use')]).isDone).toBe(false)
  expect(detectDone([mk('pause_turn')]).isDone).toBe(false)
  expect(detectDone([mk(null)]).isDone).toBe(false)
  expect(detectDone([mk(null)]).idle).toBe(true) // a final-looking answer without a stop_reason: done once idle
  expect(detectDone([mk('tool_use')]).idle).toBe(false)
  expect(detectDone([mk('end_turn', true)]).isDone).toBe(false)
  expect(detectDone([mk('end_turn', true)]).idle).toBe(false)
  expect(detectDone([mk('some_future_reason')]).isDone).toBe(true)
  expect(detectDone([mk('max_tokens')]).isDone).toBe(true)
  const big = detectDone([mk('end_turn')])
  expect(big.truncated).toBe(true)
  expect(big.result?.length).toBe(RESULT_CHAR_LIMIT + 1)
  expect(big.result?.endsWith('…')).toBe(true)
  // a trailing non-message record (system/summary) is skipped when looking for the last turn
  const sys = parseAgentEvent('{"type":"system","message":{"content":"bye"}}')!
  expect(detectDone([mk('end_turn'), sys]).isDone).toBe(true)
  expect(detectDone([]).isDone).toBe(false)
})

// The 2.1.288 shapes seen in real journals (~/.claude/projects/**/subagents/agent-*.jsonl):
// every content block is its own record, stop_reason is null on most of them, and a
// background subagent ends by CALLING SubagentHandback, then a user tool_result closes the file.
const REC = (type: string, content: unknown, ts: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type, timestamp: ts, version: '2.1.288', message: { role: type, content, stop_reason: null }, ...extra })
const HANDBACK_LINES = [
  REC('user', 'Review the two CSS fixes and report.', '2026-06-01T09:28:01.000Z', { agentId: 'fixture-hb-0009', sessionId: 'sess-aaaa-1111', cwd: '/home/dev/demo-project' }),
  REC('assistant', [{ type: 'thinking', thinking: 'hmm' }], '2026-06-01T09:28:05.000Z'),
  REC('assistant', [{ type: 'tool_use', name: 'Bash', input: { command: 'git diff' } }], '2026-06-01T09:28:06.000Z'),
  REC('user', [{ type: 'tool_result', content: 'diff --git …' }], '2026-06-01T09:28:08.000Z'),
  REC('assistant', [{ type: 'tool_use', name: 'SubagentHandback', input: { message: '### Spec Compliance\n\n- A. Lobby hint: ✅ additive rule.' } }], '2026-06-01T09:30:47.805Z'),
  REC('user', [{ type: 'tool_result', content: [{ type: 'text', text: '{"success":true,"message":"Report delivered to your caller."}' }] }], '2026-06-01T09:30:48.769Z'),
]
const IDLE_FINAL_LINES = [
  REC('user', 'Count the Python lines.', '2026-06-01T11:00:00.000Z', { agentId: 'fixture-idle-0011', sessionId: 'sess-aaaa-1111', cwd: '/home/dev/demo-project' }),
  REC('assistant', [{ type: 'tool_use', name: 'Bash', input: { command: 'wc -l' } }], '2026-06-01T11:00:01.000Z'),
  REC('user', [{ type: 'tool_result', content: '1240 total' }], '2026-06-01T11:00:02.000Z'),
  REC('assistant', [{ type: 'text', text: 'There are 1240 lines of Python in src/.' }], '2026-06-01T11:00:03.000Z'),
]

test('detectDone (2.1.288 journals): a hand-back tool call ends the agent with its input as the result; a tool_result after it keeps it done; a resume reopens it', async () => {
  const { events } = parseEvents(HANDBACK_LINES)
  const done = detectDone(events)
  expect(done.isDone).toBe(true)
  expect(done.idle).toBe(false)
  expect(done.result).toBe('### Spec Compliance - A. Lobby hint: ✅ additive rule.')
  expect(done.endMs).toBe(Date.parse('2026-06-01T09:30:48.769Z')) // the tool_result's time closes the file
  expect(lastToolUseName(events)).toBe('SubagentHandback')
  // the tool_result not flushed yet: done already, at the call's time
  const beforeResult = detectDone(events.slice(0, -1))
  expect(beforeResult.isDone).toBe(true)
  expect(beforeResult.endMs).toBe(Date.parse('2026-06-01T09:30:47.805Z'))
  // StructuredOutput (a workflow subagent's hand-back): the structured input, as prose
  const so = parseEvents([...HANDBACK_LINES.slice(0, 4),
    REC('assistant', [{ type: 'tool_use', name: 'StructuredOutput', input: { lens: 'review', summary: 'Two nits, no blockers.' } }], '2026-06-01T09:31:00.000Z')]).events
  expect(detectDone(so)).toMatchObject({ isDone: true, result: 'Two nits, no blockers.' })
  // a regular tool's tool_result as the last record is NOT done (mid-tool)
  expect(detectDone(events.slice(0, 4)).isDone).toBe(false)
  expect(detectDone(events.slice(0, 4)).idle).toBe(false)
  // the parent resumed the agent (SendMessage): a user prompt after the hand-back → live again
  const resumed = parseEvents([...HANDBACK_LINES, REC('user', 'Also check the footer.', '2026-06-01T09:40:00.000Z')]).events
  expect(detectDone(resumed).isDone).toBe(false)
  // a trailing thinking-only record with no stop_reason is mid-generation, not an answer
  const thinking = parseEvents([...IDLE_FINAL_LINES.slice(0, 3), REC('assistant', [{ type: 'thinking', thinking: '…' }], '2026-06-01T11:00:03.000Z')]).events
  expect(detectDone(thinking)).toMatchObject({ isDone: false, idle: false })
  // a final text with no stop_reason: `idle` with the text as the result
  const idle = detectDone(parseEvents(IDLE_FINAL_LINES).events)
  expect(idle).toMatchObject({ isDone: false, idle: true, result: 'There are 1240 lines of Python in src/.' })
})

test('parseTaskNotifications / noticeEndsAgent: the parent records a subagent\'s end as a <task-notification>', async () => {
  const notice = (id: string, status: string, ts: string, type = 'queue-operation') => JSON.stringify({
    type, operation: 'enqueue', timestamp: ts, sessionId: 'sess-aaaa-1111',
    content: `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n<status>${status}</status>\n<summary>Agent "x" finished</summary>\n</task-notification>`,
  })
  const text = [
    notice('fixture-note-0010', 'completed', '2026-06-01T12:00:00.000Z'),
    JSON.stringify({ type: 'attachment', timestamp: '2026-06-01T12:00:00.001Z', attachment: { type: 'queued_command', prompt: '<task-notification>\n<task-id>fixture-note-0010</task-id>\n<status>completed</status>\n</task-notification>' } }),
    notice('fixture-note-0010', 'completed', '2026-06-01T12:05:00.000Z'), // notifies again after a resume: the latest wins
    notice('agent-failed', 'failed', '2026-06-01T12:01:00.000Z'),
    notice('agent-running', 'running', '2026-06-01T12:02:00.000Z'), // not terminal
    '{"type":"user","message":{"content":"<task-notification> typed by a person, no task-id"}}',
    'not json <task-notification><task-id>x</task-id><status>completed</status>',
  ].join('\n')
  const m = parseTaskNotifications(text)
  expect(m.get('fixture-note-0010')).toBe(Date.parse('2026-06-01T12:05:00.000Z'))
  expect(m.get('agent-failed')).toBe(Date.parse('2026-06-01T12:01:00.000Z'))
  expect(m.has('agent-running')).toBe(false)
  expect(m.get('x')).toBeNull() // a line that is not JSON still names the task; undated
  expect(m.size).toBe(3)
  // the notice may land a few hundred ms BEFORE the agent's own last flush (seen: 230 ms)
  const t = Date.parse('2026-06-01T12:05:00.000Z')
  expect(noticeEndsAgent(t, t + 300)).toBe(true)
  expect(noticeEndsAgent(t, t - 5000)).toBe(true)
  expect(noticeEndsAgent(t, t + NOTICE_SLACK_MS + 1)).toBe(false) // the agent wrote again long after: resumed
  expect(noticeEndsAgent(null, t)).toBe(true)
  expect(noticeEndsAgent(undefined, t)).toBe(false)
})

test('stripInjectedBlocks / parseSessionSummary: the topic is what the person typed, never a <system-reminder> or a command echo', async () => {
  expect(stripInjectedBlocks('<system-reminder>\nThe user started this session without a folder…\n</system-reminder>')).toBe('')
  expect(stripInjectedBlocks('Fix the login bug <system-reminder>hidden</system-reminder> please')).toBe('Fix the login bug  please')
  expect(stripInjectedBlocks('<command-name>/auto-mode-setup</command-name>\n<command-message>setup</command-message>\n<command-args></command-args>')).toBe('')
  expect(stripInjectedBlocks('<local-command-caveat>Caveat: generated by the user while running a local command</local-command-caveat>')).toBe('')
  expect(stripInjectedBlocks('<local-command-stdout>{ "a": 1 }')).toBe('') // an unclosed known injection
  expect(stripInjectedBlocks('<task-notification>\n<task-id>a1</task-id>\n</task-notification>')).toBe('')
  expect(stripInjectedBlocks('<system-reminder>x</system-reminder>\n\nחפש את הקטלוג סקילים')).toBe('חפש את הקטלוג סקילים')
  expect(stripInjectedBlocks('<div> is broken in the footer')).toBe('<div> is broken in the footer') // a person's own text starting with a tag
  expect(stripInjectedBlocks('<b>bold</b> is not rendered')).toBe('is not rendered') // (a paired leading tag is dropped; the rest stays)
  expect(stripInjectedBlocks('')).toBe('')
  // the real shape (2.1.288): the first user record's blocks are [<system-reminder…>, the typed text]
  const text = [
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
    JSON.stringify({ type: 'user', cwd: '/home/dev/x', message: { role: 'user', content: [
      { type: 'text', text: '<system-reminder>\nThe user started this session without choosing a project folder…\n</system-reminder>' },
      { type: 'text', text: 'חפש את הקטלוג\nסקילים שבניתי' },
    ] } }),
  ].join('\n')
  expect(parseSessionSummary(text)).toEqual({ topic: 'חפש את הקטלוג סקילים שבניתי', cwd: '/home/dev/x' })
  // a record of injections alone is skipped for the NEXT user record (an isMeta command echo too)
  const later = [
    JSON.stringify({ type: 'user', cwd: '/home/dev/x', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>only</system-reminder>' }] } }),
    JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-stdout>ok</local-command-stdout>' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'Ship the v2 config migration.' } }),
  ].join('\n')
  expect(parseSessionSummary(later)).toEqual({ topic: 'Ship the v2 config migration.', cwd: '/home/dev/x' })
  expect(parseSessionSummary(JSON.stringify({ type: 'user', cwd: '/c', message: { content: '<system-reminder>a</system-reminder>' } }))).toEqual({ topic: '', cwd: '/c' })
})

test('scanAll (2.1.288 journals): a hand-back ends an agent at once; a parent task-notification ends one whose file ends in a tool_result; a final text without stop_reason ends once idle; a resumed agent is live again', async () => {
  resetScannerCaches()
  const fs = new MemFs()
  const sid = 'sess-aaaa-1111'
  const notice = (id: string, ts: string) => JSON.stringify({
    type: 'queue-operation', operation: 'enqueue', timestamp: ts, sessionId: sid,
    content: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n</task-notification>`,
  })
  const noteMs = NOW - 3 * MIN
  const parent = parentTranscript(sid, 'Ship it.', [
    { prompt: 'Review the two CSS fixes and report.', description: 'css reviewer', subagent_type: 'general-purpose' },
    { prompt: 'Run the type checker.', description: 'type checker', subagent_type: '' },
  ]) + [notice('fixture-note-0010', new Date(noteMs).toISOString()), notice('fixture-resumed-0012', new Date(noteMs).toISOString()), ''].join('\n')
  fs.put(`${PROJ}/${sid}.jsonl`, parent, NOW - 10_000)
  // ends by SubagentHandback + its tool_result (stop_reason null throughout), silent 2 s: done NOW, not "idle"
  fs.put(`${PROJ}/${sid}/subagents/agent-fixture-hb-0009.jsonl`, HANDBACK_LINES.join('\n') + '\n', NOW - 2000)
  // ends in a regular tool_result (the engine ended it; its notification is in the parent, 300 ms before the flush)
  const noteLines = [
    REC('user', 'Run the type checker.', '2026-06-01T12:00:00.000Z', { agentId: 'fixture-note-0010', sessionId: sid, cwd: '/home/dev/demo-project' }),
    REC('assistant', [{ type: 'tool_use', name: 'Bash', input: { command: 'tsc' } }], '2026-06-01T12:00:01.000Z'),
    REC('user', [{ type: 'tool_result', content: 'ok' }], '2026-06-01T12:00:02.000Z'),
  ]
  fs.put(`${PROJ}/${sid}/subagents/agent-fixture-note-0010.jsonl`, noteLines.join('\n') + '\n', noteMs + 300)
  // a final text with no stop_reason: silent 2 s → still running (a tool_use may follow); silent > RUNNING_STALE_SEC → done
  fs.put(`${PROJ}/${sid}/subagents/agent-fixture-idle-0011.jsonl`, IDLE_FINAL_LINES.join('\n') + '\n', NOW - 2000)
  // notified done 3 min ago, but the parent resumed it and it wrote again 5 s ago (mid-tool): live
  fs.put(`${PROJ}/${sid}/subagents/agent-fixture-resumed-0012.jsonl`,
    noteLines.map(l => l.replace('fixture-note-0010', 'fixture-resumed-0012')).join('\n') + '\n', NOW - 5000)
  fs.put(`${HOME}/.claude/sessions/101.json`, JSON.stringify({ pid: 101, sessionId: sid }), NOW)
  const io = fs.io()

  const p = await scanAll(io, NOW)
  expect(p.error).toBeUndefined()
  const hb = byId(p.agents, 'fixture-hb-0009')
  expect(hb.status).toBe('done')
  expect(hb.result).toBe('### Spec Compliance - A. Lobby hint: ✅ additive rule.')
  expect(hb.end_ms).toBe(Date.parse('2026-06-01T09:30:48.769Z'))
  expect(hb.role).toBe('css reviewer')
  expect(hb.tool).toBe('SubagentHandback')
  const note = byId(p.agents, 'fixture-note-0010')
  expect(note.status).toBe('done') // the parent's word, 300 ms before the agent's last flush
  expect(note.end_ms).toBe(noteMs)
  expect(note.role).toBe('type checker')
  expect(note.subagent_type).toBe('')
  const idle = byId(p.agents, 'fixture-idle-0011')
  expect(idle.status).toBe('running')
  expect(idle.result).toBe('There are 1240 lines of Python in src/.') // the answer is already there for the drawer
  const resumed = byId(p.agents, 'fixture-resumed-0012')
  expect(resumed.status).toBe('running')
  expect(resumed.end_ms).toBeNull()
  expect(await taskNotificationsFor(io, `${PROJ}/${sid}.jsonl`)).toEqual(new Map([['fixture-note-0010', noteMs], ['fixture-resumed-0012', noteMs]]))

  // 2 minutes on: the idle-final agent collapses to done (where it used to read "idle" for ever); the others keep their state
  const later = await scanAll(io, NOW + 2 * MIN)
  expect(byId(later.agents, 'fixture-idle-0011').status).toBe('done')
  expect(byId(later.agents, 'fixture-idle-0011').end_ms).toBe(Date.parse('2026-06-01T11:00:03.000Z'))
  expect(byId(later.agents, 'fixture-hb-0009').status).toBe('done')
  expect(byId(later.agents, 'fixture-note-0010').status).toBe('done')
  expect(byId(later.agents, 'fixture-resumed-0012').status).toBe('running') // mid-tool, open, silent 2 min < IN_FLIGHT_MAX_SEC: Python's rule unchanged

  // a notification that lands later for the resumed agent ends it (same task-id notifies again)
  fs.put(`${PROJ}/${sid}.jsonl`, parent + notice('fixture-resumed-0012', new Date(NOW + 2 * MIN + 1000).toISOString()) + '\n', NOW + 2 * MIN + 1000)
  expect(byId((await scanAll(io, NOW + 2 * MIN + 2000)).agents, 'fixture-resumed-0012').status).toBe('done')
})

test('computeStatus: the ordered decision (seconds)', async () => {
  const now = 10_000
  // 1. done wins
  expect(computeStatus(now, now - 1, true, true, false)).toBe('done')
  // 2. closed + idle collapses to done, even mid-tool
  expect(computeStatus(now, now - RUNNING_STALE_SEC - 1, false, true, true)).toBe('done')
  // closed but not yet idle: still running
  expect(computeStatus(now, now - 5, false, false, true)).toBe('running')
  // 3. in flight, open, within the ceiling → running past the stale window
  expect(computeStatus(now, now - 600, false, true, false)).toBe('running')
  // past the ceiling → stale (never pinned forever)
  expect(computeStatus(now, now - 1201, false, true, false)).toBe('stale')
  // 4. at rest
  expect(computeStatus(now, now - 91, false, false, false)).toBe('stale')
  expect(computeStatus(now, now - 90, false, false, false)).toBe('running')
})

test('isWorkflowAgent: the path alone, either slash (Python verbatim: no stat)', async () => {
  expect(isWorkflowAgent('/h/.claude/projects/p/S1/subagents/workflows/wf_1/agent-x.jsonl')).toBe(true)
  expect(isWorkflowAgent('C:\\u\\.claude\\projects\\p\\S1\\subagents\\workflows\\wf_1\\agent-x.jsonl')).toBe(true)
  expect(isWorkflowAgent('/h/.claude/projects/p/S1/subagents/agent-x.jsonl')).toBe(false)
  // a regular subagent beside a journal.jsonl is NOT a workflow agent (its role comes from the parent's Agent call)
  resetScannerCaches()
  const fs = office()
  fs.put(`${PROJ}/sess-aaaa-1111/subagents/journal.jsonl`, '{"type":"result","agentId":"fixture-run-0001","result":"nope"}\n', NOW)
  const run = byId((await scanAll(fs.io(), NOW)).agents, 'fixture-run-0001')
  expect(run.is_workflow).toBe(false)
  expect(run.role).toBe('todo hunter')
  expect(run.status).toBe('running')
})

test('scanAll: negative entries — a corrupt or unflushed transcript is not re-read every tick; an oversized head runs once', async () => {
  resetScannerCaches()
  const fs = office()
  fs.put(`${PROJ}/sess-aaaa-1111/subagents/agent-corrupt-0010.jsonl`, 'not json\n{"type":"assistant"}\n', NOW - 5000)
  fs.put(`${PROJ}/sess-aaaa-1111/subagents/agent-blank-0011.jsonl`, '\n', NOW - 5000)
  const io = fs.io()
  const p1 = await scanAll(io, NOW)
  expect(p1.skipped).toBe(3) // the malformed fixture's 2 + the corrupt first line
  expect(p1.agents.map(a => a.id)).not.toContain('corrupt-0010')
  const reads = fs.reads.length
  const p2 = await scanAll(io, NOW + POLL_MS)
  expect(p2.skipped).toBe(3) // still counted, from the negative entry
  expect(fs.reads.slice(reads).filter(r => r.includes('corrupt'))).toEqual([]) // never re-parsed until the file changes
  expect(fs.reads.slice(reads).filter(r => r.includes('blank'))).toEqual([]) // the unflushed one waits for the listing TTL
  // after GLOB_TTL_SEC the unflushed file is tried again (its flush may not move the key); the corrupt one is not
  await scanAll(io, NOW + TTL + 1000)
  expect(fs.reads.slice(reads).filter(r => r.includes('blank')).length).toBe(1)
  expect(fs.reads.slice(reads).filter(r => r.includes('corrupt'))).toEqual([])
  // a growing OVERSIZED transcript: its first line is read through `head` once, its tail at most every GLOB_TTL_SEC
  resetScannerCaches()
  const fs2 = office()
  let heads = 0
  let tails = 0
  const io2 = fs2.io({
    head: async (path, n) => { heads += 1; return fs2.files.get(path)!.text.split('\n').slice(0, n).join('\n') },
    tail: async (path, bytes) => { tails += 1; return fs2.files.get(path)!.text.slice(-bytes) },
  })
  const hugePath = `${PROJ}/sess-dddd-4444/subagents/agent-huge-0007.jsonl`
  await scanAll(io2, NOW)
  expect(heads).toBe(1)
  expect(tails).toBe(1)
  fs2.put(hugePath, fs2.files.get(hugePath)!.text, NOW + 1000, FS_READ_LIMIT + 2) // grew: new (mtime,size)
  await scanAll(io2, NOW + POLL_MS)
  expect(tails).toBe(1) // reused within GLOB_TTL_SEC
  fs2.put(hugePath, fs2.files.get(hugePath)!.text, NOW + TTL + 500, FS_READ_LIMIT + 3)
  await scanAll(io2, NOW + TTL + 1000)
  expect(tails).toBe(2)
  expect(heads).toBe(1) // the first line never changes
})

test('normPrompt / parentSessionFile / tailLines', async () => {
  expect(normPrompt('  a\n\tb   c \n')).toBe('a b c')
  expect(normPrompt('')).toBe('')
  expect(parentSessionFile('/h/.claude/projects/p/S1/subagents/agent-x.jsonl', 'S1')).toBe('/h/.claude/projects/p/S1.jsonl')
  expect(parentSessionFile('/h/.claude/projects/p/S1/subagents/workflows/wf_1/agent-x.jsonl', 'S1')).toBe('/h/.claude/projects/p/S1.jsonl')
  expect(parentSessionFile('C:\\u\\.claude\\projects\\p\\S1\\subagents\\agent-x.jsonl', 'S1')).toBe('C:/u/.claude/projects/p/S1.jsonl')
  expect(parentSessionFile('/h/.claude/projects/p/S1/subagents/agent-x.jsonl', 'S9')).toBeNull()
  expect(parentSessionFile('/h/x/agent-x.jsonl', '')).toBeNull()
  const text = 'first-partial\nsecond\n\nthird\n'
  expect(tailLines(text)).toEqual(['first-partial', 'second', 'third'])
  expect(tailLines(text, 14)).toEqual(['third']) // the first tail line is dropped as possibly partial (Python)
})

// ---------------------------------------------------------------------------
// Async ports on the in-memory office
// ---------------------------------------------------------------------------

test('nameMapFor / projectCwdFor / sessionSummary read the parent conversation', async () => {
  resetScannerCaches()
  const fs = office()
  const io = fs.io()
  const parent = `${PROJ}/sess-aaaa-1111.jsonl`
  const names = await nameMapFor(io, parent)
  expect(names.get('Find all TODO comments in the repo and summarize them.')).toEqual({ description: 'todo hunter', subagent_type: 'Explore' })
  expect(names.get('Count the lines of Python in src/.')?.description).toBe('line counter')
  expect(await projectCwdFor(io, parent)).toBe('/home/dev/demo-project')
  expect(await sessionSummary(io, parent)).toEqual({ topic: 'Clean up the TODO backlog. Then report.', cwd: '/home/dev/demo-project' })
  expect(await nameMapFor(io, null)).toEqual(new Map())
  expect(await projectCwdFor(io, `${PROJ}/nope.jsonl`)).toBe('')
  expect(await sessionSummary(io, `${PROJ}/nope.jsonl`)).toEqual({ topic: '', cwd: '' })
  // mtime cache: a second call does not re-read
  const before = fs.reads.length
  await nameMapFor(io, parent)
  await projectCwdFor(io, parent)
  expect(fs.reads.length).toBe(before)
})

test('workflowJournalResult: last result record for this agent wins; none → not done', async () => {
  resetScannerCaches()
  const io = office().io()
  const agentPath = `${PROJ}/sess-aaaa-1111/subagents/workflows/wf_0001/agent-fixture-wf-0005.jsonl`
  const r = await workflowJournalResult(io, agentPath, 'fixture-wf-0005')
  expect(r.isDone).toBe(true)
  expect(r.result).toBe('Reviewed: two nits, no blockers.')
  expect(r.endMs).toBeNull()
  expect((await workflowJournalResult(io, agentPath, 'unknown')).isDone).toBe(false)
  expect((await workflowJournalResult(io, `${PROJ}/sess-aaaa-1111/subagents/agent-fixture-run-0001.jsonl`, 'fixture-run-0001')).isDone).toBe(false)
})

test('liveSessionIds: the registry, a bad record skipped, null without the dir, pidAlive honoured', async () => {
  resetScannerCaches()
  const fs = office()
  const live = await liveSessionIds(fs.io(), HOME, NOW / 1000)
  expect(live).toEqual(new Set(['sess-aaaa-1111', 'sess-cccc-3333', 'sess-dddd-4444']))
  const dead = await liveSessionIds(fs.io({ pidAlive: async pid => pid !== 102 }), HOME, NOW / 1000)
  expect(dead?.has('sess-cccc-3333')).toBe(false)
  expect(dead?.has('sess-aaaa-1111')).toBe(true)
  const none = new MemFs()
  none.put(`${HOME}/.claude/projects/x/s.jsonl`, '', NOW)
  expect(await liveSessionIds(none.io(), HOME, NOW / 1000)).toBeNull()
})

test('resolvePersonas: distinct within a room, stable across scans, pruned', async () => {
  resetScannerCaches()
  const mk = (id: string, room: string, start: number, lead = false): Agent => ({
    id, persona_id: 7, emoji: '', role: '', subagent_type: '', status: 'running', tool: '', phase: 'thinking',
    task: '', task_short: '', result: null, start_ms: start, end_ms: null, session: room.slice(0, 8), session_full: room,
    cwd: '', project: '', mtime_ms: start, is_session: lead, closed: false, is_workflow: false, truncated: false, model: '',
  })
  const a = mk('a', 'r1', 100)
  const b = mk('b', 'r1', 200)
  const c = mk('c', 'r2', 300)
  resolvePersonas([a, b, c])
  expect(a.persona_id).toBe(7)
  expect(b.persona_id).toBe(8) // probed past the taken slot
  expect(c.persona_id).toBe(7) // another room: no conflict
  expect(a.emoji).not.toBe(b.emoji)
  // an earlier-started newcomer (d) must not displace b from its remembered seat
  const d = mk('d', 'r1', 50)
  d.persona_id = 8
  const b2 = mk('b', 'r1', 200)
  resolvePersonas([d, b2])
  expect(b2.persona_id).toBe(8)
  expect(d.persona_id).toBe(9)
  // the lead sorts first and keeps its base when free
  const lead = mk('lead', 'r3', 999, true)
  const e = mk('e', 'r3', 1)
  resolvePersonas([e, lead])
  expect(lead.persona_id).toBe(7)
  expect(e.persona_id).toBe(8)
})

// ---------------------------------------------------------------------------
// scanAll over the in-memory office
// ---------------------------------------------------------------------------

test('scanAll: the office — statuses, phases, names, results, leads, closed rooms, eviction', async () => {
  resetScannerCaches()
  const fs = office()
  const io = fs.io()
  const p = await scanAll(io, NOW)
  expect(p.error).toBeUndefined()
  expect(p.demo).toBe(false)
  expect(p.scanned_ms).toBe(NOW)
  expect(p.versions).toEqual(['2.1.0', '3.5.0'])
  expect(p.skipped).toBe(2) // the malformed fixture
  expect(p.oversized).toBe(1) // agent-huge-0007 (> 4 MiB, no tail closure)
  const ids = p.agents.map(a => a.id)
  expect(ids).not.toContain('old-0008')
  expect(ids).not.toContain('huge-0007')
  expect(ids).not.toContain('sess-eeee-5555')

  const run = byId(p.agents, 'fixture-run-0001')
  expect(run.status).toBe('running')
  expect(run.phase).toBe('tool')
  expect(run.tool).toBe('Read')
  expect(run.role).toBe('todo hunter')
  expect(run.subagent_type).toBe('Explore')
  expect(run.task_short).toBe('Find all TODO comments in the repo and summarize them.')
  expect(run.session).toBe('sess-aaa')
  expect(run.session_full).toBe('sess-aaaa-1111')
  expect(run.cwd).toBe('/home/dev/demo-project')
  expect(run.project).toBe('/home/dev/demo-project')
  expect(run.start_ms).toBe(Date.parse('2026-06-01T10:00:00.000Z'))
  expect(run.end_ms).toBeNull()
  expect(run.result).toBeNull()
  expect(run.closed).toBe(false)
  expect(run.is_workflow).toBe(false)
  expect(run.is_session).toBe(false)
  expect(run.mtime_ms).toBe(NOW - 10_000)

  const done = byId(p.agents, 'fixture-done-0002')
  expect(done.status).toBe('done')
  expect(done.role).toBe('line counter') // joined through normPrompt despite the padded prompt
  expect(done.result).toBe('There are 1240 lines of Python across 18 files in src/.')
  expect(done.end_ms).toBe(Date.parse('2026-06-01T11:00:03.000Z'))

  const wf = byId(p.agents, 'fixture-wf-0005')
  expect(wf.is_workflow).toBe(true)
  expect(wf.subagent_type).toBe('workflow-subagent')
  expect(wf.role).toBe('')
  expect(wf.status).toBe('done') // the journal's result wins over the mid-tool transcript
  expect(wf.result).toBe('Reviewed: two nits, no blockers.')
  expect(wf.end_ms).toBe(NOW - 30_000) // the journal carries no timestamp → file mtime

  const bad = byId(p.agents, 'fixture-bad-0003')
  expect(bad.closed).toBe(true) // sess-bbbb-2222 is not in the registry
  expect(bad.status).toBe('done')

  const nofields = byId(p.agents, 'nofields-0006') // id from the file name
  expect(nofields.task).toBe('')
  expect(nofields.task_short).toBe('')
  expect(nofields.role).toBe('')
  expect(nofields.status).toBe('running') // mid-tool, open, silent 3 min < IN_FLIGHT_MAX_SEC
  expect(nofields.phase).toBe('tool')

  const ver = byId(p.agents, 'fixture-ver-0004')
  expect(ver.status).toBe('done')

  // leads: one per recent conversation, topic from the first user message
  const leadA = byId(p.agents, 'sess-aaaa-1111')
  expect(leadA.is_session).toBe(true)
  expect(leadA.topic).toBe('Clean up the TODO backlog. Then report.')
  expect(leadA.task_short).toBe('Clean up the TODO backlog.')
  expect(leadA.project).toBe('/home/dev/demo-project')
  expect(leadA.status).toBe('running')
  expect(leadA.start_ms).toBe(NOW - 1 * MIN)
  expect(leadA.tool).toBe('')
  const leadB = byId(p.agents, 'sess-bbbb-2222')
  expect(leadB.closed).toBe(true)
  expect(leadB.status).toBe('done')
  expect(leadB.end_ms).toBe(NOW - 5 * MIN)
  const leadC = byId(p.agents, 'sess-cccc-3333')
  expect(leadC.status).toBe('stale') // open, idle 3 min

  // sort: running → stale → done; the lead first within a status; newest first
  const order = p.agents.map(a => `${a.status}:${a.is_session ? 'L' : 'a'}`)
  const statuses = p.agents.map(a => a.status)
  expect(statuses.indexOf('stale')).toBeGreaterThan(statuses.lastIndexOf('running'))
  expect(statuses.indexOf('done')).toBeGreaterThan(statuses.lastIndexOf('stale'))
  expect(order[0]).toBe('running:L')
  const running = p.agents.filter(a => a.status === 'running' && !a.is_session)
  for (let i = 1; i < running.length; i++) expect(running[i - 1]!.start_ms ?? 0).toBeGreaterThanOrEqual(running[i]!.start_ms ?? 0)

  // personas: distinct within room A
  const roomA = p.agents.filter(a => a.session_full === 'sess-aaaa-1111')
  expect(new Set(roomA.map(a => a.persona_id)).size).toBe(roomA.length)
})

test('scanAll: cache hits re-read nothing, status tracks the clock, journal re-read until done', async () => {
  resetScannerCaches()
  const fs = office()
  const io = fs.io()
  const first = await scanAll(io, NOW)
  const reads = fs.reads.length
  const lists = fs.lists.length
  const second = await scanAll(io, NOW + POLL_MS)
  expect(fs.lists.slice(lists)).toEqual([`${HOME}/.claude/sessions`]) // projects listing throttled (GLOB_TTL_SEC); the registry is listed every scan
  expect(fs.reads.slice(reads)).toEqual([]) // every agent/parent/journal/registry read is cached
  expect(byId(second.agents, 'fixture-run-0001').persona_id).toBe(byId(first.agents, 'fixture-run-0001').persona_id)
  // 2 minutes later the running agent (mid-tool, open) is still running; the open lead went idle
  const later = await scanAll(io, NOW + 2 * MIN)
  expect(byId(later.agents, 'fixture-run-0001').status).toBe('running')
  expect(byId(later.agents, 'sess-aaaa-1111').status).toBe('stale')
  // a workflow agent without a journal result stays running and its journal is re-read when it changes
  resetScannerCaches()
  const fs2 = office()
  fs2.put(`${PROJ}/sess-aaaa-1111/subagents/workflows/wf_0001/journal.jsonl`, '{"type":"started","agentId":"fixture-wf-0005"}\n', NOW - 20_000)
  const io2 = fs2.io()
  expect(byId((await scanAll(io2, NOW)).agents, 'fixture-wf-0005').status).toBe('running')
  fs2.put(`${PROJ}/sess-aaaa-1111/subagents/workflows/wf_0001/journal.jsonl`,
    '{"type":"result","agentId":"fixture-wf-0005","result":"all good"}\n', NOW + 5000)
  const wf = byId((await scanAll(io2, NOW + TTL + 1000)).agents, 'fixture-wf-0005')
  expect(wf.status).toBe('done')
  expect(wf.result).toBe('all good')
  expect(wf.end_ms).toBe(NOW - 30_000)
})

test('scanAll: a new agent shows up after the listing TTL; a vanished one leaves', async () => {
  resetScannerCaches()
  const fs = office()
  const io = fs.io()
  await scanAll(io, NOW)
  fs.put(`${PROJ}/sess-aaaa-1111/subagents/agent-new-0009.jsonl`, FIXTURES['cc-2.1/running.jsonl']!.replace('fixture-run-0001', 'new-0009'), NOW + 1000)
  expect((await scanAll(io, NOW + 2000)).agents.map(a => a.id)).not.toContain('new-0009')
  expect((await scanAll(io, NOW + TTL + 1000)).agents.map(a => a.id)).toContain('new-0009')
  fs.files.delete(`${PROJ}/sess-aaaa-1111/subagents/agent-new-0009.jsonl`)
  expect((await scanAll(io, NOW + TTL + 2000)).agents.map(a => a.id)).not.toContain('new-0009')
})

test('scanAll: >4 MiB degrades — skipped and counted, or read through the optional closures', async () => {
  resetScannerCaches()
  const fs = office()
  // an oversized PARENT: its subagents lose their names and project, its lead its topic; all still drawn
  fs.put(`${PROJ}/sess-aaaa-1111.jsonl`, fs.files.get(`${PROJ}/sess-aaaa-1111.jsonl`)!.text, NOW - MIN, FS_READ_LIMIT + 1)
  const p = await scanAll(fs.io(), NOW)
  expect(p.error).toBeUndefined()
  expect(p.oversized).toBe(2)
  expect(byId(p.agents, 'fixture-run-0001').role).toBe('')
  expect(byId(p.agents, 'fixture-run-0001').project).toBe('')
  expect(byId(p.agents, 'sess-aaaa-1111').topic).toBe('')
  expect(byId(p.agents, 'sess-aaaa-1111').status).toBe('running')
  // with head/tail closures nothing is oversized
  resetScannerCaches()
  const io = fs.io({
    head: async (path, n) => fs.files.get(path)!.text.split('\n').slice(0, n).join('\n'),
    tail: async (path, bytes) => fs.files.get(path)!.text.slice(-bytes),
  })
  const q = await scanAll(io, NOW)
  expect(fs.reads.filter(r => r.includes('huge') || r.includes('sess-aaaa-1111.jsonl'))).toEqual([])
  expect(q.oversized).toBe(1) // only the parent's name map still needs the whole file
  expect(byId(q.agents, 'fixture-run-0001').role).toBe('')  // the name map needs the whole file: still unknown
  expect(byId(q.agents, 'fixture-run-0001').project).toBe('/home/dev/demo-project')
  expect(byId(q.agents, 'sess-aaaa-1111').topic).toBe('Clean up the TODO backlog. Then report.')
  const huge = byId(q.agents, 'huge-0007')
  expect(huge.status).toBe('running')
  expect(huge.tool).toBe('Read')
})

test('scanAll: never throws — no home, no projects dir, a listing that fails', async () => {
  resetScannerCaches()
  const empty = new MemFs()
  const noHome = await scanAll(empty.io({ home: async () => undefined }), NOW)
  expect(noHome.agents).toEqual([])
  expect(noHome.error).toMatch(/HOME/)
  const noProjects = await scanAll(empty.io(), NOW)
  expect(noProjects.agents).toEqual([])
  expect(noProjects.error).toBeUndefined()
  const broken = office().io({ list: async () => { throw new Error('boom') } })
  const b = await scanAll(broken, NOW)
  expect(b.agents).toEqual([])
  expect(b.error).toBeUndefined()
  const exploding = office().io({ home: async () => { throw new Error('env exploded') } })
  const e = await scanAll(exploding, NOW)
  expect(e.error).toBe('env exploded')
})

test('demoPayload: the synthetic office, phased', async () => {
  resetScannerCaches()
  const early = demoPayload(NOW, 0)
  expect(early.demo).toBe(true)
  expect(early.versions).toEqual(['2.1.0'])
  expect(early.agents.map(a => a.id)).not.toContain('demo-newcomer-hh')
  expect(byId(early.agents, 'demo-finisher-gg').status).toBe('running')
  const late = demoPayload(NOW, 7)
  expect(late.agents.map(a => a.id)).toContain('demo-newcomer-hh')
  const fin = byId(late.agents, 'demo-finisher-gg')
  expect(fin.status).toBe('done')
  expect(fin.end_ms).toBe(NOW - 2000)
  expect(fin.result).toMatch(/3 high/)
  expect(byId(late.agents, 'demo-build-ee').status).toBe('stale')
  expect(byId(late.agents, 'demo-mcp-dd').tool).toBe('mcp__github__search_issues')
  expect(NOW - (byId(late.agents, 'demo-mcp-dd').start_ms ?? NOW)).toBe(63_000) // Python's offset, verbatim
  expect(late.agents).toHaveLength(10) // 7 + the newcomer + 2 leads: Python's cast, nothing added
  const leads = late.agents.filter(a => a.is_session)
  expect(leads).toHaveLength(2)
  expect(leads[0]?.topic).toBeDefined()
  expect(late.agents[0]?.is_session).toBe(true)
  for (const room of ['demo-session-frontend-1111', 'demo-session-research-2222']) {
    const members = late.agents.filter(a => a.session_full === room)
    expect(new Set(members.map(a => a.persona_id)).size).toBe(members.length)
  }
  expect(demoPayload(NOW).agents.length).toBeGreaterThanOrEqual(9)
})

// ---------------------------------------------------------------------------
// model: the latest assistant record's message.model
// ---------------------------------------------------------------------------

/** A transcript whose assistant records name their model (the real engine stamps every assistant record). */
function modelTranscript(agentId: string, sessionId: string, models: string[], done = false): string {
  const out = [
    JSON.stringify({ type: 'user', agentId, sessionId, timestamp: '2026-06-01T14:50:00.000Z', cwd: '/home/dev/demo-project', version: '2.1.0', message: { content: `Task of ${agentId}.` } }),
  ]
  models.forEach((model, i) => {
    out.push(JSON.stringify({ type: 'assistant', timestamp: `2026-06-01T14:50:0${i + 1}.000Z`, version: '2.1.0', message: { model, content: [{ type: 'tool_use', name: 'Read', input: {} }] } }))
    out.push(JSON.stringify({ type: 'user', timestamp: `2026-06-01T14:50:0${i + 1}.500Z`, version: '2.1.0', message: { content: [{ type: 'tool_result', content: 'ok' }] } }))
  })
  if (done) out.push(JSON.stringify({ type: 'assistant', timestamp: '2026-06-01T14:50:09.000Z', version: '2.1.0', message: { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' } }))
  return out.join('\n') + '\n'
}

test('model: parseAgentEvent reads message.model; lastModel takes the latest assistant record that names one', async () => {
  const ev = parseAgentEvent('{"type":"assistant","message":{"model":" claude-opus-5-5 ","content":[]}}')!
  expect(ev.model).toBe('claude-opus-5-5')
  expect(parseAgentEvent('{"type":"assistant","message":{"model":42,"content":[]}}')?.model).toBe('')
  expect(parseAgentEvent('{"type":"user","message":{"content":"x"}}')?.model).toBe('')
  // the fixtures carry no model: "" (never undefined)
  for (const ev2 of parseEvents(lines('cc-2.1/running.jsonl')).events) expect(ev2.model).toBe('')
  expect(lastModel(parseEvents(lines('cc-2.1/done.jsonl')).events)).toBe('')
  // a switch mid-run: the latest wins; a trailing assistant record WITHOUT a model does not erase it
  const { events } = parseEvents(modelTranscript('m1', 's', ['claude-haiku-4-5-20251001', 'claude-opus-5-5'], true).split('\n'))
  expect(lastModel(events)).toBe('claude-opus-5-5')
  // a user record naming a model (never happens) is ignored
  const odd = parseAgentEvent('{"type":"user","message":{"model":"claude-x","content":"x"}}')!
  expect(lastModel([...events, odd])).toBe('claude-opus-5-5')
  expect(lastModel([])).toBe('')
  // the raw-text variant used for the lead
  expect(parseLastModel(modelTranscript('m1', 's', ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5']))).toBe('claude-sonnet-5-5')
  expect(parseLastModel('not json\n{"type":"assistant","message":{"model":"claude-fable-5-1"}}\n{broken "model" "assistant"\n')).toBe('claude-fable-5-1')
  expect(parseLastModel('')).toBe('')
})

test("scanAll: every agent carries `model` — '' when the transcript names none, the latest one otherwise; the lead takes its conversation's", async () => {
  resetScannerCaches()
  const fs = office()
  fs.put(`${PROJ}/sess-aaaa-1111/subagents/agent-model-0012.jsonl`, modelTranscript('model-0012', 'sess-aaaa-1111', ['claude-haiku-4-5-20251001', 'claude-opus-5-5']), NOW - 5000)
  fs.put(`${PROJ}/sess-cccc-3333/subagents/agent-model-0013.jsonl`, modelTranscript('model-0013', 'sess-cccc-3333', ['claude-sonnet-5-5'], true), NOW - 5000)
  // room C's conversation spawned nothing through Agent (its name map is never wanted), but its
  // own assistant turns name a model: the lead's model comes from sessionSummary's head read
  const parentC = `${PROJ}/sess-cccc-3333.jsonl`
  fs.put(parentC, fs.files.get(parentC)!.text + JSON.stringify({ type: 'assistant', sessionId: 'sess-cccc-3333', message: { model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'reading' }] } }) + '\n', NOW - 3 * MIN)
  const io = fs.io()
  const p = await scanAll(io, NOW)
  for (const a of p.agents) expect(typeof a.model).toBe('string')
  expect(byId(p.agents, 'fixture-run-0001').model).toBe('') // the fixture names no model
  expect(byId(p.agents, 'model-0012').model).toBe('claude-opus-5-5') // the latest assistant record wins
  expect(byId(p.agents, 'model-0013').model).toBe('claude-sonnet-5-5')
  expect(byId(p.agents, 'model-0013').status).toBe('done')
  // leads: room A's Agent spawns (parentTranscript) are assistant records naming claude-fable-5-1,
  // read whole for the name map; room C through the summary's head read; room B has no
  // assistant record at all → ''
  expect(byId(p.agents, 'sess-aaaa-1111').model).toBe('claude-fable-5-1')
  expect(byId(p.agents, 'sess-cccc-3333').model).toBe('claude-haiku-4-5-20251001')
  expect(byId(p.agents, 'sess-bbbb-2222').model).toBe('')
  // cache hit: the model survives without a re-read
  const reads = fs.reads.length
  const q = await scanAll(io, NOW + POLL_MS)
  expect(fs.reads.slice(reads)).toEqual([])
  expect(byId(q.agents, 'model-0012').model).toBe('claude-opus-5-5')
  expect(byId(q.agents, 'sess-aaaa-1111').model).toBe('claude-fable-5-1')
  // the conversation switches model: a changed parent (re-read for its name map anyway) updates the lead
  const parent = `${PROJ}/sess-aaaa-1111.jsonl`
  fs.put(parent, fs.files.get(parent)!.text + JSON.stringify({ type: 'assistant', sessionId: 'sess-aaaa-1111', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'switched' }] } }) + '\n', NOW + 2000)
  expect(byId((await scanAll(io, NOW + 3000)).agents, 'sess-aaaa-1111').model).toBe('claude-opus-5-5')
  // an oversized parent: no whole read → the lead's model stays unknown, never a crash
  resetScannerCaches()
  const fs2 = office()
  fs2.put(parent, fs2.files.get(parent)!.text, NOW - MIN, FS_READ_LIMIT + 1)
  const o = await scanAll(fs2.io(), NOW)
  expect(o.error).toBeUndefined()
  expect(byId(o.agents, 'sess-aaaa-1111').model).toBe('')
})

test("the lead's model is read RELIABLY from the session file's tail: a conversation without subagents gets it when its file grows, one read, throttled, oversized through io.tail", async () => {
  resetScannerCaches()
  const fs = office()
  const f = `${PROJ}/sess-ffff-6666.jsonl`
  // a lonely open chat: no Agent spawns (no name map wanted), no assistant record yet
  fs.put(f, parentTranscript('sess-ffff-6666', 'Lonely chat.', []), NOW - 2 * MIN)
  fs.put(`${HOME}/.claude/sessions/105.json`, JSON.stringify({ pid: 105, sessionId: 'sess-ffff-6666' }), NOW)
  const io = fs.io()
  expect(byId((await scanAll(io, NOW)).agents, 'sess-ffff-6666').model).toBe('')
  // the model answers: an assistant record naming it lands in the file (topic/cwd are settled, so no
  // other read wants the file) → the next scan reads its TAIL once and the lead carries the model
  const answer = (model: string) => JSON.stringify({ type: 'assistant', sessionId: 'sess-ffff-6666', message: { model, content: [{ type: 'text', text: 'hi' }] } }) + '\n'
  fs.put(f, fs.files.get(f)!.text + answer('claude-opus-5-5'), NOW + 2000)
  const reads = fs.reads.length
  expect(byId((await scanAll(io, NOW + 3000)).agents, 'sess-ffff-6666').model).toBe('claude-opus-5-5')
  expect(fs.reads.slice(reads)).toEqual([f])
  // unchanged file: no read at all
  expect(byId((await scanAll(io, NOW + 4500)).agents, 'sess-ffff-6666').model).toBe('claude-opus-5-5')
  expect(fs.reads.slice(reads)).toEqual([f])
  // a chatty lead is not re-read every tick: a switch within GLOB_TTL_SEC of the last tail read waits for it
  fs.put(f, fs.files.get(f)!.text + answer('claude-sonnet-5-5'), NOW + 5000)
  expect(byId((await scanAll(io, NOW + 6000)).agents, 'sess-ffff-6666').model).toBe('claude-opus-5-5')
  expect(fs.reads.slice(reads)).toEqual([f])
  expect(byId((await scanAll(io, NOW + 4000 + TTL)).agents, 'sess-ffff-6666').model).toBe('claude-sonnet-5-5') // the tail was read at NOW + 3000
  expect(fs.reads.slice(reads)).toEqual([f, f])
  // every lead of the office carries a string model; the ones whose files name none stay ''
  for (const a of (await scanAll(io, NOW + 4000 + TTL)).agents.filter(x => x.is_session)) expect(typeof a.model).toBe('string')
  // an OVERSIZED conversation: no whole read possible → the tail closure finds the model; without it ''
  resetScannerCaches()
  const fs2 = office()
  fs2.put(f, parentTranscript('sess-ffff-6666', 'Huge chat.', []) + answer('claude-fable-5-1'), NOW - MIN, FS_READ_LIMIT + 1)
  fs2.put(`${HOME}/.claude/sessions/105.json`, JSON.stringify({ pid: 105, sessionId: 'sess-ffff-6666' }), NOW)
  const tails: string[] = []
  const withTail = fs2.io({ tail: async (path, bytes) => { tails.push(path); return fs2.files.get(path)!.text.slice(-bytes) } })
  expect(byId((await scanAll(withTail, NOW)).agents, 'sess-ffff-6666').model).toBe('claude-fable-5-1')
  expect(tails).toEqual([f])
  resetScannerCaches()
  expect(byId((await scanAll(fs2.io(), NOW)).agents, 'sess-ffff-6666').model).toBe('')
})

test('demoPayload: every demo agent names a plausible model', async () => {
  const p = demoPayload(NOW, 7)
  for (const a of p.agents) expect(a.model).toMatch(/^claude-(opus|sonnet|haiku|fable)-\d/)
  expect(byId(p.agents, 'demo-reader-bb').model).toBe('claude-haiku-4-5-20251001')
  expect(byId(p.agents, 'demo-conv-frontend').model).toBe('claude-fable-5-1')
  expect(new Set(p.agents.map(a => a.model)).size).toBeGreaterThanOrEqual(3)
})

test('phase 1 cadence: the poll is 5 s and listings are reused for 30 s', () => {
  expect(POLL_MS).toBe(5000)
  expect(GLOB_TTL_SEC).toBe(30)
})
