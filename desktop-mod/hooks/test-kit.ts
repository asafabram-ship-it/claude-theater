// test-kit.ts — TEST ONLY: the hooks the kit tests install BENEATH the plugin
// (ui.test.ts, register.test.ts, office-client.mounted.test.ts). Imported by
// *.test.ts files alone, never by register.tsx's module graph, so validate and
// the plugin's bundle never reach it.
//
// `beneath(on, current, store, files)` answers what the engine would: a mocked
// clock from T0, an in-memory $.store, the environment, an empty ~/.claude (or
// the in-memory `files`), the pane shown — and rewrites every `payload` publish
// into the fixture of the moment, `current()` (unless `files` is given: then
// the scanner reads them and its own payload is published; a demo publish is
// never rewritten either: state holds the demo cast, as on a live engine). It
// counts what the plugin writes, reads back and calls, in `captured`, and
// holds the next write of a key on request (`captured.hold`: a slow store, so
// a test can make two office posts' hooks overlap).

import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

import { DEFAULT_VIEW, EMPTY_PAYLOAD } from './model'
import type { Agent, Payload, View } from './model'

/** The tests' wall clock: `beneath` starts its mocked clock here, and the fixtures date their agents from it. */
export const T0 = 1_700_000_000_000

/** An in-memory ~/.claude for `beneath`: path → text + mtime (the size is the text's length unless `size` says otherwise: an oversized transcript). */
export type MemFiles = Map<string, { text: string; mtimeMs: number; size?: number }>

/** The $.state writes of the plugin, by key: the five the flicker guard budgets always present, any other key once written. */
export type Writes = { payload: number; scanError: number; view: number; tick: number; prefs: number } & Record<string, number>

export function beneath(on: On, current: () => Agent[], store: Record<string, unknown> = {}, files?: MemFiles) {
  const captured = {
    toasts: [] as string[],
    /** The `timeoutMs` each toast asked for, in the toasts' order (undefined: the engine's default). */
    toastTimeouts: [] as Array<number | undefined>,
    plays: 0, opens: [] as string[], store: { ...store } as Record<string, unknown>,
    /** $.state writes seen beneath the plugin, by key (the flicker guard's budget; one atom per message). */
    writes: { payload: 0, scanError: 0, view: 0, tick: 0, prefs: 0 } as Writes,
    /** $.store writes seen beneath the plugin, by key (the housekeeping's budget: the prefs mirror, roomDone). */
    storeWrites: {} as Record<string, number>,
    /** $.fs.write calls seen beneath the plugin: none is expected (the diagnostics log is gone). */
    fsWrites: 0,
    /** $.state reads of `prefs` seen beneath the plugin: the pane's render reads it once per draw (the poll only on a retitle, a finish or a pins prune — the last through `update`), so it counts the redraws. */
    prefsReads: 0,
    /** The `payload` the plugin last read back from $.state (a state.get tap): what the pane draws, ⭐ stars included. */
    payload: undefined as Payload | undefined,
    /** The `view` the plugin last WROTE (a state.set tap). */
    view: undefined as View | undefined,
    /** The order of the plugin's calls that redraw: 'open' (a retitle), 'payload' / 'view' / 'prefs' (a $.state write) — and 'store:<key>' (a $.store write, which redraws nothing). */
    seq: [] as string[],
    /** True → every $.env.get beneath rejects, so the scan FAILS (resolveHome is the one io call inside scanAll's try without a catch of its own). */
    envDown: false,
    /** Non-null → every `view` the plugin reads carries this `selected` (what $.state kept over a hot reload, which this harness cannot replay). */
    selectedBeneath: null as string | null,
    /** False → $.ui.panes lists no pane: the person closed it. */
    paneOpen: true,
    /** Non-null → run once at the next scan's first step (its $.env.get of HOME): what the person does while a scan runs. */
    onScan: null as (() => void) | null,
    /** True → $.agent.list answers no list at all: the poll's ageing of the live map (a step past the scan, the poll's alone) throws. */
    agentListBroken: false,
    /**
     * ONE-SHOT HOLDS: the plugin's next write of a key waits beneath for its promise — `<key>` a $.store write, `state:<key>` a
     * $.state write — then lands (a slow store, a loaded host: what makes two office posts' hooks overlap). `seq` records
     * `held:<key>` when it waits.
     */
    hold: {} as Record<string, Promise<void>>,
  }
  /** The hold on `key`, taken (one-shot): its promise, or undefined (the write lands at once, as before). */
  const held = (key: string): Promise<void> | undefined => {
    const h = captured.hold[key]
    if (!h) return undefined
    delete captured.hold[key]
    captured.seq.push('held:' + key)
    return h
  }
  const clock = mock.clock(on, { now: T0 })
  // an in-memory store the test can read back (mock.store would hook store.set
  // itself, and an event may be hooked only once per module)
  on('store.get', ($, e) => ({ value: captured.store[e.key] }))
  on('store.set', ($, e) => {
    const land = () => {
      captured.store[e.key] = e.value
      captured.storeWrites[e.key] = (captured.storeWrites[e.key] ?? 0) + 1
      captured.seq.push('store:' + e.key)
      return { value: undefined }
    }
    const h = held(e.key)
    return h ? h.then(land) : land()
  })
  on('store.delete', ($, e) => { delete captured.store[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(captured.store) }))
  // the environment beneath (what mock.env would hook), with a failure switch for the failed-scan test
  const env: Record<string, string> = { HOME: 'C:/Users/test', USERPROFILE: 'C:/Users/test' }
  on('env.get', ($, e) => {
    if (e.name === 'HOME' && captured.onScan) {
      const during = captured.onScan
      captured.onScan = null
      during()
    }
    if (captured.envDown) throw new Error('env down')
    return { value: env[e.name] }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'test-session' }))
  // nothing beneath the plugins answers command.register: without this the plugin's
  // session.start would abort before starting the poll
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  // (a hook that throws is skipped, so a broken answer is how a test makes a step of the poll throw)
  on('agent.list', () => ({ value: captured.agentListBroken ? (null as unknown as []) : [] }))
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
      if (slash < 0) out.push({ name: rest, kind: 'file', size: f.size ?? f.text.length, mtimeMs: f.mtimeMs, isLink: false })
      else sub.add(rest.slice(0, slash))
    }
    for (const d of sub) out.push({ name: d, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
    return { value: out }
  })
  on('fs.stat', ($, e) => {
    const f = files?.get(norm(e.path))
    if (f) return { value: { kind: 'file' as const, size: f.size ?? f.text.length, mtimeMs: f.mtimeMs, isLink: false } }
    if (files && dirsOf().has(norm(e.path))) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('fs.read', ($, e) => {
    const f = files?.get(norm(e.path))
    if (!f) throw new Error(`ENOENT: ${e.path}`)
    return { value: f.text }
  })
  on('fs.write', ($, e, next) => { captured.fsWrites += 1; return next(e) })
  on('ui.toast', ($, e) => { captured.toasts.push(e.text); captured.toastTimeouts.push(e.timeoutMs); return { value: undefined } })
  on('audio.play', () => { captured.plays += 1; return { value: undefined } })
  on('ui.open', ($, e) => { captured.opens.push(e.title ?? e.id); captured.seq.push('open'); return { value: { isPlaced: true as const } } })
  // the pane is up: the poll scans only while $.ui.panes() lists it shown (PAGE polled only while visible); `paneOpen` false: closed
  on('ui.panes', () => ({ value: captured.paneOpen ? [{ id: 'agent-theater', title: 'T', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.focus', () => ({}))
  // the poll's payload write becomes the fixture of the moment (unless the scanner reads `files`: then it is kept; and a
  // demo publish is kept whole, so leaving the demo is drawn from the demo cast state really holds)
  // (the ⭐ stars the poll stamped ride the payload: the rewrite keeps them)
  on('state.set', { plugin: 'agent-theater', key: 'payload' }, ($, e, next) =>
    files || (e.value as Payload).demo ? next(e) : next({ ...e, value: { ...EMPTY_PAYLOAD, agents: current(), scanned_ms: clock.now(), stars: (e.value as Payload).stars } }))
  // every $.state write of the plugin, counted by key; the ones that redraw the pane are sequenced
  on('state.set', { plugin: 'agent-theater' }, ($, e, next) => {
    const land = () => {
      captured.writes[e.key] = (captured.writes[e.key] ?? 0) + 1
      if (e.key === 'view') captured.view = e.value as View
      if (e.key === 'payload' || e.key === 'view' || e.key === 'prefs') captured.seq.push(e.key)
      return next(e)
    }
    const h = held('state:' + e.key)
    return h ? h.then(land) : land()
  })
  on('state.get', { plugin: 'agent-theater', key: 'payload' }, async ($, e, next) => {
    const got = await next(e)
    captured.payload = (got as { value?: { value?: Payload } }).value?.value
    return got
  })
  on('state.get', { plugin: 'agent-theater', key: 'prefs' }, ($, e, next) => { captured.prefsReads += 1; return next(e) })
  on('state.get', { plugin: 'agent-theater', key: 'view' }, async ($, e, next) => {
    const got = await next(e)
    const sel = captured.selectedBeneath
    if (sel === null) return got
    // (never written yet → `value` is undefined beneath and the plugin applies the atom's default: lay the selection over it)
    const g = got as { value: { value: View | undefined; version: number } }
    return { ...g, value: { ...g.value, value: { ...DEFAULT_VIEW, ...g.value.value, selected: sel } } } as typeof got
  })
  return { captured, clock }
}
