// UI: draws the 🎭 pane (the office) from $.state and handles its presses /
// typing. The port of PAGE's JS over the engine's elements (Box/Text/Button/
// Input, plus a `Client` surface module for the animated office later).
//
// OWNER: builder "ui". Contract (register.tsx calls these):
//   registerUi(on)         adds the ui.render / ui.press / ui.input hooks for the pane
//   paneTitle(lang)        the pane's title for $.ui.open
//
// What it draws (spec "עובר כמו שהוא"):
//   header: title + "N עובדים · M ממתינים · K סיימו", lang toggle, mute, show-done,
//           search Input, help (?) button, demo chip
//   rooms:  one per conversation (session_full), pinned rooms first (📌), the lead
//           (is_session) first inside, then agents: emoji + persona name, role +
//           subagent_type, activityLabel(), clock mm:ss, ⏰ when running ≥ LONG_RUNNING_MS,
//           ⭐ when done within JUST_FINISHED_MS (+ confetti via the Client clock), ❌ on failed
//   drawer: the selected agent: task, activity, duration, result, "result truncated"
//   help:   keyboard shortcuts overlay (/, f, ↑↓, Enter, Esc, m, l, d)
//   footer: oversized/skipped counts, scanError dim
//
// Rules:
// - A render hook never writes state; presses/inputs write with update($, ...).
// - Read state with read($, atom) so the pane redraws itself on every $.state.set;
//   atoms are declared in THIS file (validate rule), never imported.
// - Draw with the table of e.surface: `const { Box, Text, Button, Input } = $.ui.resolve(e)`.
//   Width is e.props.bodyColumns (narrower than the viewport when docked).
// - Hebrew default; `dirOf(prefs.lang)` decides the row direction (RTL = row-reverse).
// - Every hook is registered with `.catch(($, e, next) => next(e))`.

import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import { I18N, type Lang } from './i18n'
import { DEFAULT_PREFS, DEFAULT_VIEW, EMPTY_PAYLOAD } from './model'

// $.state atoms (validate: declared as consts in the file that reads them;
// the same keys register.tsx writes — see ../types/index.d.ts).
const payloadAtom = atom({ plugin: 'agent-theater', key: 'payload' } as const, EMPTY_PAYLOAD)
const prefsAtom = atom({ plugin: 'agent-theater', key: 'prefs' } as const, DEFAULT_PREFS)
const viewAtom = atom({ plugin: 'agent-theater', key: 'view' } as const, DEFAULT_VIEW)
const scanErrorAtom = atom({ plugin: 'agent-theater', key: 'scanError' } as const, null)

/** The pane title shown in the tab. */
export function paneTitle(lang: Lang): string {
  return lang === 'he' ? '🎭 התיאטרון' : '🎭 Theater'
}

/** Adds the pane's render/press/input hooks. Called once from register(). */
export function registerUi(on: On): void {
  on('ui.render', { component: 'Pane', requestId: 'agent-theater' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const prefs = await read($, prefsAtom)
    const payload = await read($, payloadAtom)
    const view = await read($, viewAtom)
    const scanError = await read($, scanErrorAtom)
    const L = I18N[prefs.lang]
    const rtl = prefs.lang === 'he'

    const working = payload.agents.filter(a => a.status === 'running').length
    const idle = payload.agents.filter(a => a.status === 'stale').length
    const finished = payload.agents.filter(a => a.status === 'done').length
    const counts = `${working} ${L.working} · ${idle} ${L.idleN} · ${finished} ${L.finished}`

    // STUB: header + counts + empty-office line. The builder replaces the body
    // with rooms, cards, drawer, help and footer.
    return (
      <Box flexDirection="column">
        <Box flexDirection={rtl ? 'row-reverse' : 'row'} justifyContent="space-between">
          <Text bold>{L.appTitle}</Text>
          <Text dimColor>{counts}</Text>
        </Box>
        {payload.agents.length === 0 && <Text dimColor>{view.demo ? L.loading : L.emptyOffice}</Text>}
        {scanError !== null && <Text dimColor>{scanError}</Text>}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // STUB: the builder adds
  //   on('ui.press', { plugin: 'agent-theater', requestId: PANE_ID }, ...)   (or Button onPress closures)
  //   on('ui.input', { plugin: 'agent-theater', requestId: PANE_ID }, ...)   (search box)
}
