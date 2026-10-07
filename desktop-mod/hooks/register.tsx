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
// (openPane, poll, loadPrefs, scanIo); imported modules get closures
// (scanIo) or register their own hooks (registerLive / registerUi).
//
// Lifecycle:
//   session.start   load prefs from $.store, remember the session id, register
//                   /theater, start the poll timer ($.clock.every POLL_MS).
//   poll            scanAll(scanIo($)) → liveAged($.agent.list()) → mergeLive →
//                   $.state payload; ⭐/chime bookkeeping is the ui builder's
//                   (compares the previous payload's done set).
//   agent.spawn     after next: liveSpawned; first subagent of the session →
//                   $.ui.open once (auto-open).
//   tool.call       in a live agent's loop: liveToolStarted / liveToolReturned;
//                   the main loop's Agent call: liveAgentReturned (its result).
//   command.run     /theater → $.ui.open (always, asked by the person).
// Every hook: wrapped in try/catch AND `.catch` so the office never blocks Claude.
// An event is hooked at most ONCE without a matcher per module (validate rule),
// which is why the agent.spawn and tool.call hooks are here and live.ts is pure.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { liveAgentReturned, liveAged, liveSpawned, liveToolReturned, liveToolStarted, mergeLive } from './live'
import { COMMAND, DEFAULT_PREFS, DEFAULT_VIEW, EMPTY_PAYLOAD, PANE_ID, POLL_MS, STORE_PREFS_KEY, type Prefs } from './model'
import { demoPayload, scanAll, type ScanIo } from './scanner'
import { paneTitle, registerUi } from './ui'

// $.state atoms (validate: declared as consts in the file that reads them).
const payloadAtom = atom({ plugin: 'agent-theater', key: 'payload' } as const, EMPTY_PAYLOAD)
const liveAtom = atom({ plugin: 'agent-theater', key: 'live' } as const, {})
const sessionIdAtom = atom({ plugin: 'agent-theater', key: 'sessionId' } as const, '')
const prefsAtom = atom({ plugin: 'agent-theater', key: 'prefs' } as const, DEFAULT_PREFS)
const viewAtom = atom({ plugin: 'agent-theater', key: 'view' } as const, DEFAULT_VIEW)
const paneOpenedAtom = atom({ plugin: 'agent-theater', key: 'paneOpened' } as const, false)
const scanErrorAtom = atom({ plugin: 'agent-theater', key: 'scanError' } as const, null)

/** Opens (or raises) the pane with the current language's title. */
export async function openPane($: EngineInterface): Promise<void> {
  const prefs = await read($, prefsAtom)
  await $.ui.open({ id: PANE_ID, title: paneTitle(prefs.lang) })
  await update($, paneOpenedAtom, () => true)
}

/** The scanner's file-system closures over `$` (declared here: `$` never crosses an import). */
function scanIo($: EngineInterface): ScanIo {
  return {
    read: path => $.fs.read(path),
    list: path => $.fs.list(path),
    stat: path => $.fs.stat(path),
    exists: path => $.fs.exists(path),
    // $.env.get takes a literal name (validate lists the variables a module reads).
    home: async () => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')),
  }
}

/** One poll: scan the files, merge this session's live agents, publish. Never throws. */
export async function poll($: EngineInterface): Promise<void> {
  try {
    const now = await $.clock.now()
    const view = await read($, viewAtom)
    const live = await read($, liveAtom)
    const sessionId = await read($, sessionIdAtom)
    const scanned = view.demo ? demoPayload(now) : await scanAll(scanIo($), now)
    const { error, ...payload } = scanned as typeof scanned & { error?: string }
    let aged = live
    if (Object.keys(live).length > 0) {
      const listed = await $.agent.list().catch(() => [])
      aged = liveAged(live, listed, now)
      if (aged !== live) await update($, liveAtom, () => aged)
    }
    const merged = mergeLive(payload, aged, sessionId, now)
    await update($, payloadAtom, () => merged)
    await update($, scanErrorAtom, () => error ?? null)
  } catch (err) {
    await update($, scanErrorAtom, () => (err instanceof Error ? err.message : String(err))).catch(() => undefined)
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
      pins: Array.isArray(stored?.pins) ? stored.pins.filter(p => typeof p === 'string') : [],
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const prefs = await loadPrefs($)
      await update($, prefsAtom, () => prefs)
      const sessionId = await $.session.id().catch(() => '')
      await update($, sessionIdAtom, () => sessionId)
      await $.command.register({
        name: COMMAND,
        description: prefs.lang === 'he' ? 'פותח את 🎭 התיאטרון — משרד הסוכנים החי' : 'Open 🎭 Claude Theater, the live office of your subagents',
        immediate: true,
      })
      void poll($)
      $.clock.every(POLL_MS, () => void poll($))
    } catch {
      // never block the session
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'theater' }, async $ => {
    try {
      await openPane($)
      const prefs = await read($, prefsAtom)
      return { text: prefs.lang === 'he' ? 'התיאטרון נפתח.' : 'Theater pane opened.' }
    } catch (err) {
      return { text: `agent-theater: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  // A subagent started: record it (after next, when agentId/model are known)
  // and auto-open the pane on the FIRST subagent of the session (spec "פתיחה").
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    try {
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
        await update($, liveAtom, live => liveSpawned(live, spawn, now))
        const opened = await read($, paneOpenedAtom)
        if (!opened) void openPane($)
      }
    } catch {
      // never block the spawn
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Tool calls: inside a live agent's loop they drive its phase/tool; the main
  // loop's Agent call carries the subagent's result when it returns.
  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      try {
        const now = await $.clock.now()
        await update($, liveAtom, live => liveToolStarted(live, agentId, String(e.tool), now))
      } catch {
        // ignore
      }
      const ran = await next(e)
      try {
        const now = await $.clock.now()
        await update($, liveAtom, live => liveToolReturned(live, agentId, now))
      } catch {
        // ignore
      }
      return ran
    }
    if (String(e.tool) === 'Agent') {
      const ran = await next(e)
      try {
        const now = await $.clock.now()
        const text = ran.deny !== undefined ? ran.deny : ran.text
        await update($, liveAtom, live => liveAgentReturned(live, e.tool_use_id, text, ran.deny !== undefined || ran.isError === true, now))
      } catch {
        // ignore
      }
      return ran
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  registerUi(on)
}
