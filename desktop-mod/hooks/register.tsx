// Claude Theater — hooks module entry. Wiring only; the work lives in
//   scanner.ts  (files → payload)      live.ts (this session's agents from events)
//   ui.tsx      (the pane)             i18n.ts / personas.ts (strings, cast)
//   model.ts    (types, constants, $.state atoms)
//
// OWNER: architect. Builders touch this file only to swap a stub call for
// the real one (same names), so three builders never edit the same lines.
//
// ENGINE RULE (claude plugin validate): `$` is never passed to a function
// imported from another file. Helpers that take `$` are declared HERE
// (openPane, poll, loadPrefs, scanIo, ensurePolling); imported modules get
// closures (scanIo) or register their own hooks (registerUi).
//
// Lifecycle:
//   session.start   load prefs from $.store, remember the session id, register
//                   /theater, start the poll timer ($.clock.every POLL_MS).
//                   Each step is its own try: a failing $.command.register
//                   (nothing answers it in a test harness, or a name clash)
//                   never stops the office from scanning.
//   poll            while the pane is up: scanAll(scanIo($)) → liveAged
//                   ($.agent.list()) → mergeLive → $.state payload ONLY IF what
//                   the pane draws changed (renderKey: the flicker guard — a
//                   state write redraws the pane and a redraw re-creates the
//                   desktop's Svg frames), scanError only on change, `tick`
//                   every poll (read by the text surfaces alone, for their
//                   mm:ss). ONE PUBLISH PER POLL (spec §6.1): the ⭐/chime
//                   "finish beat" (PAGE updateWS) runs HERE, in the poll —
//                   starsOf (ui.tsx) stamps the ids just finished into the
//                   payload it publishes (`stars`) and the toast + chime fire
//                   for the ones the office shows — and the "🟢 N · " working
//                   count in the pane title (PAGE's document.title, only when N
//                   changes) goes out in the same tick BEFORE the write, so a
//                   finish is the one $.state write of the publish (no deferred
//                   `view` write; a plugin never sees its own state.set). The
//                   old beat's housekeeping follows the write in the same tick,
//                   only when something vanished: a selection whose agent left
//                   the office → view.selected null; the pins / roomDone
//                   overrides of rooms no longer present pruned (against a
//                   real, non-empty office only — never the demo's cast).
//                   While the pane is closed (never opened, or closed by the
//                   person) the files are NOT scanned — PAGE polled only while
//                   the panel was visible — only the live map is aged so the
//                   engine's statuses keep landing; openPane polls at once.
//                   In demo mode the payload is scanner's demoPayload — the one
//                   demo cast (ui.tsx draws demoPayload(now) on every redraw so
//                   the demo clock advances between polls).
//   reload safety   a hot reload runs `register` again in a fresh environment and
//                   drops the old one's timers, while session.start fires once
//                   per session. So the timer lives in module scope and
//                   ensurePolling($) (re)starts it lazily from every hook that
//                   has a `$` — session.start, /theater, agent.spawn, tool.call
//                   — and from the pane's next redraw (a render hook of this
//                   file ahead of ui.tsx's, through $.clock.after(0): a render
//                   may not write state).
//   poll guards     one poll at a time (a helper process may take seconds; an
//                   overlapping tick would race the caches) and a publish never
//                   rolls the office back to an older scan.
//
// Files over 4 MiB ($.fs.read's limit): scanIo hands the scanner three optional
// closures built over $.process.run — head(path, lines), tail(path, bytes) and
// pidAlive(pid) — PowerShell on Windows (%OS% = Windows_NT), head/tail/ps
// elsewhere. Any failure (no $.process on this surface, a timeout, a missing
// executable) rejects and the scanner degrades exactly as without the closure:
// the oversized transcript is skipped and counted in payload.oversized, an
// oversized parent yields role ""/project ""/topic "", and every registered
// session is trusted as open. pidAlive reads ONE process listing (tasklist /
// ps) cached PID_TTL_MS at module level, so a scan every 5 s (POLL_MS) spawns
// one process per 30 s however many chats are open.
//   agent.spawn     after next: liveSpawned; first subagent of the session →
//                   $.ui.open once (auto-open).
//   tool.call       in a live agent's loop: liveToolStarted / liveToolReturned;
//                   the main loop's Agent (or Task, the older alias) call:
//                   liveAgentReturned (its result).
//   command.run     /theater → $.ui.open (always, asked by the person).
// Every hook: wrapped in try/catch AND `.catch` so the office never blocks Claude.
// An event is hooked at most ONCE without a matcher per module (validate rule),
// which is why the agent.spawn and tool.call hooks are here and live.ts is pure.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { I18N } from './i18n'
import { liveAgentReturned, liveAged, liveSpawned, liveToolReturned, liveToolStarted, mergeLive, type LiveMap } from './live'
import { COMMAND, DEFAULT_PREFS, DEFAULT_VIEW, EMPTY_PAYLOAD, PANE_ID, POLL_MS, STORE_PREFS_KEY, type Payload, type Prefs, type TheaterStatus } from './model'
import { demoPayload, scanAll, type ScanIo } from './scanner'
import { STORE_ROOM_DONE_KEY, cardName, officeView, paneTitle, parseRoomDone, registerUi, rememberRoomDone, renderKey, starsOf, textSurfaceActive, workingCount } from './ui'

// $.state atoms (validate: declared as consts in the file that reads them).
const payloadAtom = atom({ plugin: 'agent-theater', key: 'payload' } as const, EMPTY_PAYLOAD)
const sessionIdAtom = atom({ plugin: 'agent-theater', key: 'sessionId' } as const, '')
const prefsAtom = atom({ plugin: 'agent-theater', key: 'prefs' } as const, DEFAULT_PREFS)
const viewAtom = atom({ plugin: 'agent-theater', key: 'view' } as const, DEFAULT_VIEW)
const paneOpenedAtom = atom({ plugin: 'agent-theater', key: 'paneOpened' } as const, false)
const scanErrorAtom = atom({ plugin: 'agent-theater', key: 'scanError' } as const, null)
const tickAtom = atom({ plugin: 'agent-theater', key: 'tick' } as const, 0)

/** Is the office pane open (and the one shown) on some surface? One cheap round trip; false when unanswerable. */
async function paneIsUp($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE_ID && p.isShown !== false)
  } catch {
    return false
  }
}

/** Opens (or raises) the pane with the current language's title, then fills it at once. Never rejects. */
export async function openPane($: EngineInterface): Promise<void> {
  try {
    const prefs = await read($, prefsAtom)
    const payload = await read($, payloadAtom)
    await $.ui.open({ id: PANE_ID, title: paneTitle(prefs.lang, workingCount(payload)) })
    await update($, paneOpenedAtom, () => true)
  } catch {
    // no surface draws yet (an SDK / -p run), or a hook refused: the next spawn / /theater tries again
  }
  void poll($)
}

/** How long one helper process (head/tail/the pid listing) may run before the scanner degrades instead. */
const PROCESS_TIMEOUT_MS = 10_000
/** The process listing is reused this long (Python re-checked every scan with a free os.kill(pid, 0)). */
const PID_TTL_MS = 30_000

/** Asked once per environment: %OS% = Windows_NT decides PowerShell/tasklist vs head/tail/ps. */
let WIN: Promise<boolean> | undefined
/** The one process listing, cached PID_TTL_MS (a failed listing is cached too, so a broken helper is not retried every tick). */
let PID_LIST: { at: number; pids: Promise<Set<number>> } | undefined

/** True on Windows (%OS% = Windows_NT); memoised per environment. */
function isWindows($: EngineInterface): Promise<boolean> {
  if (!WIN) {
    // $.env.get takes a literal name (validate lists the variables a module reads).
    WIN = $.env.get('OS').then(v => v === 'Windows_NT', () => false)
  }
  return WIN
}

/** A PowerShell single-quoted literal (the only escape is a doubled quote). */
function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * PowerShell argv for one script: UTF-8 on stdout so Hebrew topics survive the
 * pipe, and ANY error → exit 1 (so `run` rejects and the scanner degrades,
 * instead of reading an empty stdout as an empty file).
 */
function psArgv(script: string): string[] {
  const wrapped =
    `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ` +
    `try { ${script} } catch { [Console]::Error.WriteLine($_); exit 1 }`
  return ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', wrapped]
}

/** `tasklist /NH /FO CSV` ("name","pid",...) or `ps -axo pid=` (one pid per line) → the live pids. */
export function parsePidListing(stdout: string): Set<number> {
  const out = new Set<number>()
  for (const line of stdout.split('\n')) {
    const m = /^"[^"]*","(\d+)"/.exec(line.trim()) ?? /^(\d+)$/.exec(line.trim())
    if (m) out.add(Number(m[1]))
  }
  return out
}

/** Runs argv through `$.process.run`, resolves stdout, rejects on a non-zero exit (the scanner then degrades). */
async function runProcess($: EngineInterface, argv: readonly string[]): Promise<string> {
  const r = await $.process.run(argv, { timeoutMs: PROCESS_TIMEOUT_MS })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `exit ${r.exitCode}`)
  return r.stdout
}

/** The pids alive now: ONE listing per PID_TTL_MS for the whole office (every registered chat shares it). */
function livePids($: EngineInterface, now: number): Promise<Set<number>> {
  if (PID_LIST && now - PID_LIST.at < PID_TTL_MS) return PID_LIST.pids
  const pids = isWindows($).then(win =>
    runProcess($, win ? ['tasklist', '/NH', '/FO', 'CSV'] : ['ps', '-axo', 'pid=']).then(parsePidListing))
  pids.catch(() => undefined) // each pidAlive caller observes the rejection itself (→ "alive"); never unhandled here
  PID_LIST = { at: now, pids }
  return pids
}

/** The scanner's file-system closures over `$` (declared here: `$` never crosses an import). */
function scanIo($: EngineInterface): ScanIo {
  return {
    read: path => $.fs.read(path),
    list: path => $.fs.list(path),
    stat: path => $.fs.stat(path),
    exists: path => $.fs.exists(path),
    home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')),
    // Files over FS_READ_LIMIT: the first `lines` lines ...
    head: async (path, lines) => {
      const n = Math.max(1, Math.floor(lines))
      return (await isWindows($))
        ? runProcess($, psArgv(`Get-Content -LiteralPath ${psQuote(path)} -TotalCount ${n} -Encoding UTF8 | ForEach-Object { [Console]::Out.WriteLine($_) }`))
        : runProcess($, ['head', '-n', String(n), path])
    },
    // ... and the last `bytes` bytes (the scanner drops the partial first line itself).
    tail: async (path, bytes) => {
      const n = Math.max(1, Math.floor(bytes))
      if (!(await isWindows($))) return runProcess($, ['tail', '-c', String(n), path])
      const script =
        `$s=[System.IO.File]::OpenRead(${psQuote(path)}); try { ` +
        `$n=[int][Math]::Min($s.Length, ${n}); [void]$s.Seek(-$n, [System.IO.SeekOrigin]::End); ` +
        `$b=New-Object byte[] $n; $r=$s.Read($b, 0, $n); ` +
        `[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b, 0, $r)) } finally { if ($s) { $s.Dispose() } }`
      return runProcess($, psArgv(script))
    },
    // Is the process that registered a ~/.claude/sessions record still alive? (rejects → the scanner trusts the record)
    pidAlive: async pid => (await livePids($, await $.clock.now())).has(pid),
  }
}

/**
 * THIS SESSION'S LIVE AGENTS, in module memory - NOT $.state. Every subagent
 * tool call starts and returns here (several a second with a few agents), and
 * on the desktop ANY $.state write of the plugin redraws its pane, which
 * blinks and swallows presses. A hot reload loses the map; the file scan still
 * shows those agents (only their sub-second phase is the live map's).
 */
let LIVE: LiveMap = {}
/** The band's working count last drawn (the band redraws only when it moves). */
let lastBandCount = 0
/** Running agents of the live map (the band's count). */
function liveWorking(): number {
  return Object.values(LIVE).filter(a => a.engine_status === 'running').length
}

/** The poll in progress, if any (a tick that finds one running is skipped). */
let polling = false
/** The working count last written into the pane title (PAGE's document.title); undefined until the first poll. */
let lastRun: number | undefined
/** renderKey of the payload last published, at its publish time; undefined until the first publish (and after a hot reload: one publish). */
let lastKey: string | undefined
/** The coarse renderKey last published, and when (the CALM GUARD). */
let lastCoarse: string | undefined
let lastPublishAt = -Infinity
/** Activity-only changes (tool / phase / the minute) reach the pane at most this often. */
export const CALM_MS = 8_000
/** Even an arrival or a finish waits this long after the previous publish, so a burst of them is ONE redraw. */
export const SETTLE_MS = 5_000

// The finish beat's memory (PAGE updateWS; a hot reload only loses a beat, as PAGE's reload does).
/** PAGE prevStatus: agent id → last status seen (starsOf keeps it). */
const prevStatus: Record<string, TheaterStatus> = {}
/** The ⭐ map the last poll computed, published or not (a publish held back by SETTLE_MS must not lose a star). */
let pendingStars: Record<string, number> = {}
/** PAGE ding(): two chimes within this many ms are one (storm guard). */
const DING_GAP_MS = 400
/** The finish chime, the plugin's own file. */
const DING_ASSET = 'sounds/done.wav'
/** PAGE lastDing: the storm guard. */
let lastDing = 0

/** PAGE ding(): the finish chime, unless muted; two within DING_GAP_MS are one. Never rejects. */
async function ding($: EngineInterface, muted: boolean, now: number): Promise<void> {
  if (muted) return
  if (now - lastDing < DING_GAP_MS) return
  lastDing = now
  await $.audio.play({ asset: DING_ASSET }).catch(() => undefined)
}

/**
 * One poll. Pane up: scan the files (or the demo cast), age + merge this
 * session's live agents, publish, retitle. Pane down: only age the live map
 * (the engine's statuses must keep landing; no file is touched). Never
 * throws; never runs twice at once.
 */
export async function poll($: EngineInterface): Promise<void> {
  if (polling) return
  polling = true
  try {
    const now = await $.clock.now()
    const up = await paneIsUp($)
    const view = await read($, viewAtom)
    const sessionId = await read($, sessionIdAtom)
    let scanned: (Payload & { error?: string }) | undefined
    if (up) scanned = view.demo ? demoPayload(now) : await scanAll(scanIo($), now)
    // Age the live map (after the scan's awaits: a tool.call that landed meanwhile is kept)
    if (Object.keys(LIVE).length > 0) {
      const listed = await $.agent.list().catch(() => [])
      LIVE = liveAged(LIVE, listed, now)
    }
    const aged = LIVE
    // the band above the prompt shows the working count while the pane is closed: redraw it only when that count moves
    const band = up ? 0 : liveWorking()
    if (band !== lastBandCount) {
      lastBandCount = band
      try {
        $.ui.invalidate('ui.render')
      } catch {
        // the band catches up on its next draw
      }
    }
    if (!scanned) return
    const { error, ...payload } = scanned
    const merged = mergeLive(payload, aged, sessionId, now)
    // THE FINISH BEAT (PAGE updateWS), here in the poll — not in the render — so a finish is the ONE
    // write below: the ⭐ ids ride the payload (`stars`: starsOf stamps the finishes just seen `now` and
    // drops the expired), the toast + chime fire now. Only an agent the office SHOWS is celebrated (its
    // room shows finished, it matches the search, its chat is open — officeView, as the pane draws it);
    // a hidden finish is remembered (prevStatus) and never celebrated later. The toast and the chime fire
    // at detection, while the drawn ⭐ follows the publish — which SETTLE_MS may hold for up to one poll —
    // so the sound can precede the star by up to SETTLE_MS. `prefs` is read only on a finish or a retitle
    // (the pane's render reads it once per draw; the tests count redraws by it).
    const published = await read($, payloadAtom)
    // (a hot reload emptied the module's maps: the published payload still has the stars; a publish held
    // back by SETTLE_MS left them in pendingStars)
    const prevStars = { ...published.stars, ...pendingStars }
    const stars = starsOf(prevStatus, merged.agents, prevStars, now)
    const fresh = Object.keys(stars).filter(id => !(id in prevStars))
    let prefs: Prefs | undefined
    if (fresh.length > 0) {
      prefs = await read($, prefsAtom)
      const roomDone = parseRoomDone(await $.store.get(STORE_ROOM_DONE_KEY).catch(() => undefined))
      const shown = new Set(officeView(merged.agents, view.search, prefs.lang, view.demo || prefs.showDone, roomDone, prefs.pins).visible.map(a => a.id))
      const L = I18N[prefs.lang]
      let celebrated = false
      for (const id of fresh) {
        const a = merged.agents.find(x => x.id === id)
        if (a === undefined || !shown.has(id)) {
          delete stars[id]
          continue
        }
        $.ui.toast(`${cardName(a, prefs.lang)} — ${L.finishedToast}`)
        celebrated = true
      }
      if (celebrated) void ding($, prefs.muted, now)
    }
    pendingStars = stars
    const office: Payload = { ...merged, stars }
    // THE FLICKER GUARD. Every $.state.set redraws the pane, and a redraw
    // re-creates the desktop's interactive Svg frames (their animations restart:
    // the flicker), so the office is published ONLY when what it draws changed:
    // renderKey (ui.tsx) projects a payload at `now` onto what is drawn —
    // minute-resolution clocks, the ⭐ ids still inside their window (`stars`),
    // never scanned_ms or raw timestamps. The text surfaces' mm:ss tick from
    // `tick` instead, which the desktop never reads.
    const key = renderKey(office, now)
    // THE CALM GUARD: on the desktop EVERY redraw of the pane blinks (even a pane of plain Text), so
    // the moment-to-moment activity (tool / phase, the minute) is batched: published at most once
    // per CALM_MS. What matters at once (an agent arriving, finishing, failing, a ⭐) is in the
    // coarse key and publishes once SETTLE_MS has passed since the previous publish (a burst = one redraw).
    const coarse = renderKey(office, now, true)
    const since = now - lastPublishAt
    const due = (coarse !== lastCoarse && since >= SETTLE_MS) || since >= CALM_MS
    // (the second test, held to the same SETTLE_MS: what is IN state differs in substance — a reload, a hook beneath)
    if ((key !== lastKey && due) || ((lastCoarse === undefined || since >= SETTLE_MS) && renderKey(published, now, true) !== coarse)) {
      // THE RETITLE first, in the same tick (spec §6.1): the title follows what the pane is about to show
      // (PAGE: document.title = (run ? "🟢 N · " : "") + docTitle), and the engine coalesces the redraws of
      // one tick, so the $.ui.open and the write below are ONE redraw — and the title never changes between
      // two calm publishes. An open id is retitled in place (never a second instance); no `focus`.
      const run = workingCount(office)
      if (run !== lastRun) {
        lastRun = run
        prefs ??= await read($, prefsAtom)
        await $.ui.open({ id: PANE_ID, title: paneTitle(prefs.lang, run) }).catch(() => undefined)
      }
      // Never roll the office back: a slower, older scan loses to a newer publish.
      await update($, payloadAtom, cur => (cur.scanned_ms > office.scanned_ms ? cur : office))
      lastKey = key
      lastCoarse = coarse
      lastPublishAt = now
      // THE HOUSEKEEPING of the old deferred beat (PAGE updateWS), in the same tick as the write, as rare extra
      // writes only when something actually vanished — a quiet poll never reaches a write here, and a FAILED
      // scan never touches user state (scanAll republishes LAST_GOOD — empty after a hot reload — and mergeLive
      // adds this session's live agents even to that: a non-empty office that is NOT the office; `error` gates):
      // - the selection: `view.selected` is "null when closed" (types/index.d.ts), so a selected agent that left
      //   the office resets it (one `view` write; the drawer is already gone, it draws only a present agent);
      // - the pins and the per-room overrides (prefs.pins, $.store 'roomDone') of rooms no longer present —
      //   only when a published room vanished (or on the first publish: pins kept from an earlier session;
      //   never on a mere arrival), and only against a REAL, NON-EMPTY office: the demo's cast and an empty
      //   scan must not wipe them. Each prunes only what changed (one `prefs` write + its store mirror, one
      //   store write) — PAGE's rule, restored.
      const liveIds = new Set(office.agents.map(a => a.id))
      if (error === undefined && view.selected !== null && !liveIds.has(view.selected)) {
        const gone = view.selected
        await update($, viewAtom, v => (v.selected === gone ? { ...v, selected: null } : v))
      }
      const liveRooms = new Set(office.agents.map(a => a.session_full))
      const prevRooms = new Set(published.agents.map(a => a.session_full))
      const roomsChanged = prevRooms.size === 0 || [...prevRooms].some(s => !liveRooms.has(s))
      if (roomsChanged && error === undefined && office.agents.length > 0 && !office.demo) {
        prefs ??= await read($, prefsAtom)
        if (prefs.pins.some(s => !liveRooms.has(s))) {
          const saved = await update($, prefsAtom, p => ({ ...p, pins: p.pins.filter(s => liveRooms.has(s)) }))
          await $.store.set(STORE_PREFS_KEY, saved).catch(() => undefined)
        }
        const roomDone = parseRoomDone(await $.store.get(STORE_ROOM_DONE_KEY).catch(() => undefined))
        if (Object.keys(roomDone).some(s => !liveRooms.has(s))) {
          const kept: Record<string, boolean> = {}
          for (const [s, v] of Object.entries(roomDone)) if (liveRooms.has(s)) kept[s] = v
          await $.store.set(STORE_ROOM_DONE_KEY, kept).catch(() => undefined)
          rememberRoomDone(kept)
        }
      }
    }
    const curError = await read($, scanErrorAtom)
    if ((error ?? null) !== curError) {
      await update($, scanErrorAtom, () => error ?? null)
    }
    // the tick only while a text surface draws the pane (the TICK GUARD, ui.tsx): on the desktop
    // any write of ours redraws the pane, so an idle desktop office must see no write at all
    if (textSurfaceActive(now)) {
      await update($, tickAtom, () => now)
    }
  } catch (err) {
    await update($, scanErrorAtom, () => (err instanceof Error ? err.message : String(err))).catch(() => undefined)
  } finally {
    polling = false
  }
}

/** The poll timer of this environment (a hot reload drops it with the environment; ensurePolling restarts it). */
let ticker: Timer | undefined

/**
 * Starts the poll timer unless this environment already runs one; `restart`
 * (session.start) replaces whatever runs, so a new session never polls on a
 * stale `$`. Never throws.
 */
function ensurePolling($: EngineInterface, restart = false): void {
  try {
    if (ticker && !restart) return
    ticker?.cancel()
    ticker = $.clock.every(POLL_MS, () => void poll($))
    void poll($)
  } catch {
    // never block the caller
  }
}

/** Prefs from $.store, defaults filled in; a bad value falls back to the default. */
async function loadPrefs($: EngineInterface): Promise<Prefs> {
  try {
    const stored = (await $.store.get(STORE_PREFS_KEY)) as Partial<Prefs> | undefined
    return {
      lang: stored?.lang === 'en' ? 'en' : DEFAULT_PREFS.lang,
      muted: stored?.muted === true,
      showDone: stored?.showDone === true,
      still: stored?.still === true,
      pins: Array.isArray(stored?.pins) ? stored.pins.filter(p => typeof p === 'string') : [],
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Four independent steps, each in its own try: none may block the session,
    // and none may stop the ones after it (a /theater that cannot be registered
    // must still leave a scanning office behind).
    let prefs: Prefs = DEFAULT_PREFS
    try {
      prefs = await loadPrefs($)
      await update($, prefsAtom, () => prefs)
    } catch {
      // defaults stay
    }
    try {
      const sessionId = await $.session.id().catch(() => '')
      await update($, sessionIdAtom, () => sessionId)
    } catch {
      // live agents then land in a sessionless room until the id is known
    }
    try {
      await $.command.register({
        name: COMMAND,
        description: prefs.lang === 'he' ? 'פותח את 🎭 התיאטרון — משרד הסוכנים החי' : 'Open 🎭 Claude Theater, the live office of your subagents',
        immediate: true,
      })
    } catch {
      // the pane still auto-opens on the first subagent
    }
    ensurePolling($, true)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'theater' }, async $ => {
    try {
      ensurePolling($)
      await openPane($)
      const prefs = await read($, prefsAtom)
      return { text: prefs.lang === 'he' ? 'התיאטרון נפתח.' : 'Theater pane opened.' }
    } catch (err) {
      return { text: `agent-theater: ${err instanceof Error ? err.message : String(err)}` }
    }
  }).catch(($, e, next) => next(e))

  // A subagent started: record it (after next, when agentId/model are known)
  // and auto-open the pane on the FIRST subagent of the session (spec "פתיחה").
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    try {
      ensurePolling($)
      const agentId = ran.agentId
      if (agentId !== undefined) {
        const now = await $.clock.now()
        const spawn = {
          agentId,
          tool_use_id: e.tool_use_id,
          description: e.description,
          subagentType: e.subagentType,
          prompt: e.prompt,
          model: ran.model ?? e.model ?? '',
        }
        LIVE = liveSpawned(LIVE, spawn, now)
        const opened = await read($, paneOpenedAtom)
        if (!opened) void openPane($)
      }
    } catch {
      // never block the spawn
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Tool calls: inside a live agent's loop they drive its phase/tool; the main
  // loop's Agent call (Task: the older alias, as Python name_map_for joins on
  // both) carries the subagent's result when it returns.
  on('tool.call', async ($, e, next) => {
    ensurePolling($)
    const agentId = e.agentId
    if (agentId !== undefined) {
      try {
        const now = await $.clock.now()
        LIVE = liveToolStarted(LIVE, agentId, String(e.tool), now)
      } catch {
        // ignore
      }
      const ran = await next(e)
      try {
        const now = await $.clock.now()
        LIVE = liveToolReturned(LIVE, agentId, now)
      } catch {
        // ignore
      }
      return ran
    }
    const tool = String(e.tool)
    if (tool === 'Agent' || tool === 'Task') {
      const ran = await next(e)
      try {
        const now = await $.clock.now()
        const text = ran.deny !== undefined ? ran.deny : ran.text
        LIVE = liveAgentReturned(LIVE, e.tool_use_id, text, ran.deny !== undefined || ran.isError === true, now)
      } catch {
        // ignore
      }
      return ran
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The render kick: a pane that is already up after a hot reload ($.ui.panes()
  // lists it; the engine's record outlives the module) resumes polling on its
  // first redraw. A hook of our own on the pane's render, ahead of ui.tsx's in
  // the chain, schedules ensurePolling through $.clock.after(0) — outside the
  // render, so poll's state writes are allowed — and passes the draw on with
  // next(e). (`$` may not be handed to a callback across files: validate rule.)
  on('ui.render', { component: 'Pane', requestId: 'agent-theater' }, ($, e, next) => {
    try {
      $.clock.after(0, () => ensurePolling($))
    } catch {
      // the hooks with a `$` kick the poll too
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The band above the prompt: a way back into the office without a slash
  // command. Shown only while this conversation has subagents working and the
  // pane is not on screen; pressing it opens (or raises) the pane. The count is
  // the live map's (engine events), since the file scan rests while the pane is
  // closed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey) return next(e)
      const working = liveWorking()
      if (working === 0 || (await paneIsUp($))) return next(e)
      const prefs = await read($, prefsAtom)
      const label = prefs.lang === 'he'
        ? `🎭 התיאטרון · ${working} ${working === 1 ? 'עובד' : 'עובדים'} — לחצו לפתיחה`
        : `🎭 Theater · ${working} working — press to open`
      const { Box, Button } = $.ui.resolve(e)
      return (
        <Box>
          <Button key="open-theater" label={label} onPress={() => openPane($)} />
        </Box>
      )
    } catch {
      return next(e)
    }
  }).catch(($, e, next) => next(e))

  registerUi(on)
}
