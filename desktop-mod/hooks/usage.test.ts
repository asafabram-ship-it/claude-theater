// usage.ts: the five-hour usage meter as one short footer line. Pure — the
// window is picked from a limits list, the bar and the label are asserted on
// strings. The reset time is the machine's local HH:MM, so every expectation
// that names a clock time is built from local getters or from a local-time
// Date, never from a hard-coded UTC hour: the suite passes in any time zone.
// Then the hooks that drive it (register.tsx, Task 3.2): session.measure and
// the first reading at session.start put the label on the plugin's status line
// ($.ui.status), hand the reading to the office header and toast at 80 / 95
// once per window, driven through the engine with the kit beneath. Last, the pane header (Task 3.3): the
// desktop office Client's first line and the text cards' counts line draw the same reading.

import type { On, SessionRateLimit, UsageUnit } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'

import { PERSONA_EMOJI, POLL_MS } from './model'
import type { Agent } from './model'
import { OFFICE_KEY, type OfficeProps } from './office-props'
import { T0, beneath } from './test-kit'
import { parseToastMark, pickFiveHour, resetClock, sameFiveHour, toastDue, usageBar, usageLabel, usageShort, usageThreshold } from './usage'

test('pickFiveHour takes the five_hour window only', () => {
  expect(pickFiveHour([])).toBeNull()
  expect(pickFiveHour([{ kind: 'seven_day', percentUsed: 10 }])).toBeNull()
  expect(pickFiveHour([{ kind: 'seven_day', percentUsed: 10 }, { kind: 'five_hour', percentUsed: 42.4, resetsAt: '2026-10-10T11:30:00Z' }])).toEqual({ pct: 42.4, resetsAt: '2026-10-10T11:30:00Z' })
  expect(pickFiveHour([{ kind: 'five_hour', percentUsed: 7 }])).toEqual({ pct: 7, resetsAt: '' })
  // a percentage that is not a finite number is no reading (never a `NaN%` label)
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(pickFiveHour([{ kind: 'five_hour', percentUsed: bad }])).toBeNull()
})

test('usageBar: 10 cells, rounded', () => {
  expect(usageBar(0)).toBe('▱▱▱▱▱▱▱▱▱▱')
  expect(usageBar(42)).toBe('▰▰▰▰▱▱▱▱▱▱')
  expect(usageBar(100)).toBe('▰▰▰▰▰▰▰▰▰▰')
  expect(usageBar(120)).toBe('▰▰▰▰▰▰▰▰▰▰')
})

test('usageBar: clamps below zero, rounds to the nearest cell, honours the cell count', () => {
  expect(usageBar(-5)).toBe('▱▱▱▱▱▱▱▱▱▱')
  expect(usageBar(4.9)).toBe('▱▱▱▱▱▱▱▱▱▱')
  expect(usageBar(5)).toBe('▰▱▱▱▱▱▱▱▱▱')
  expect(usageBar(50, 4)).toBe('▰▰▱▱')
})

test('usageLabel: percent, local reset time, ⚠ from 80%', () => {
  const u = { pct: 42.4, resetsAt: '2026-10-10T11:30:00Z' }
  const label = usageLabel(u, 'he', Date.UTC(2026, 9, 10, 9, 0))
  expect(label.startsWith('⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · ')).toBe(true)
  expect(label).toMatch(/\d\d:\d\d$/)
  expect(usageLabel({ pct: 81, resetsAt: '' }, 'en', 0)).toBe('⚠ 5h ▰▰▰▰▰▰▰▰▱▱ 81%')
})

test('usageLabel: the reset hour is the machine local HH:MM, zero-padded', () => {
  // Same instant, read back through the local getters: right in any time zone.
  const iso = '2026-10-10T11:30:00Z'
  const d = new Date(iso)
  const local = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  expect(usageLabel({ pct: 42.4, resetsAt: iso }, 'en', 0)).toBe(`⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · ${local}`)
  // A reset built at a local wall-clock time reads back as exactly that time.
  expect(usageLabel({ pct: 10, resetsAt: new Date(2026, 9, 10, 14, 30).toISOString() }, 'en', 0)).toBe('⏳ 5h ▰▱▱▱▱▱▱▱▱▱ 10% · 14:30')
  expect(usageLabel({ pct: 10, resetsAt: new Date(2026, 9, 10, 9, 5).toISOString() }, 'he', 0)).toBe('⏳ 5h ▰▱▱▱▱▱▱▱▱▱ 10% · 09:05')
})

test('usageLabel: ⚠ switches on at 80 after rounding, not before', () => {
  expect(usageLabel({ pct: 79.4, resetsAt: '' }, 'en', 0)).toBe('⏳ 5h ▰▰▰▰▰▰▰▰▱▱ 79%')
  expect(usageLabel({ pct: 79.6, resetsAt: '' }, 'en', 0)).toBe('⚠ 5h ▰▰▰▰▰▰▰▰▱▱ 80%')
  expect(usageLabel({ pct: 80, resetsAt: '' }, 'he', 0)).toBe('⚠ 5h ▰▰▰▰▰▰▰▰▱▱ 80%')
  expect(usageLabel({ pct: 0, resetsAt: '' }, 'he', 0)).toBe('⏳ 5h ▱▱▱▱▱▱▱▱▱▱ 0%')
})

test('usageLabel: an empty or unparsable reset time leaves the label without the clock part', () => {
  expect(usageLabel({ pct: 30, resetsAt: '' }, 'en', 0)).toBe('⏳ 5h ▰▰▰▱▱▱▱▱▱▱ 30%')
  expect(usageLabel({ pct: 30, resetsAt: 'soon' }, 'en', 0)).toBe('⏳ 5h ▰▰▰▱▱▱▱▱▱▱ 30%')
})

test('usageLabel: one short line — no newline, no bidi controls, same text in both languages', () => {
  const u = { pct: 88.8, resetsAt: new Date(2026, 9, 10, 23, 59).toISOString() }
  const he = usageLabel(u, 'he', 0)
  const en = usageLabel(u, 'en', 0)
  expect(he).toBe(en)
  expect(he).not.toMatch(/[\r\n\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/)
  expect(he.length).toBeLessThanOrEqual(32)
})

test('usageShort: the label without the bar and the clock — `⏳ 5h 42%`, ⚠ from 80 on the rounded percent', () => {
  const R = '2026-10-10T11:30:00Z'
  expect(usageShort({ pct: 42.4, resetsAt: R })).toBe('⏳ 5h 42%')
  expect(usageShort({ pct: 42.4, resetsAt: '' })).toBe('⏳ 5h 42%')
  expect(usageShort({ pct: 79.4, resetsAt: R })).toBe('⏳ 5h 79%')
  expect(usageShort({ pct: 79.6, resetsAt: R })).toBe('⚠ 5h 80%')
  expect(usageShort({ pct: 0, resetsAt: R })).toBe('⏳ 5h 0%')
  // the full label starts with it (head, `5h`), then the bar, then the same percent
  for (const pct of [0, 12.5, 42.4, 79.6, 100]) {
    const u = { pct, resetsAt: R }
    const short = usageShort(u)
    expect(usageLabel(u, 'en', 0).startsWith(short.slice(0, 4))).toBe(true)
    expect(usageLabel(u, 'en', 0)).toContain(short.slice(5))
  }
  expect(usageShort({ pct: 88.8, resetsAt: R })).not.toMatch(/[\r\n\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/)
})

// --- The pure pieces the hooks use: the comparison, the thresholds, the toast mark, the reset clock.

test('sameFiveHour: what is drawn — the rounded percent and the window; null equals null only', () => {
  const R = '2026-10-10T11:30:00Z'
  expect(sameFiveHour(null, null)).toBe(true)
  expect(sameFiveHour(null, { pct: 0, resetsAt: R })).toBe(false)
  expect(sameFiveHour({ pct: 0, resetsAt: R }, null)).toBe(false)
  expect(sameFiveHour({ pct: 42, resetsAt: R }, { pct: 42.4, resetsAt: R })).toBe(true)
  expect(sameFiveHour({ pct: 42.4, resetsAt: R }, { pct: 41.6, resetsAt: R })).toBe(true)
  expect(sameFiveHour({ pct: 42, resetsAt: R }, { pct: 42.5, resetsAt: R })).toBe(false)
  expect(sameFiveHour({ pct: 42, resetsAt: R }, { pct: 43, resetsAt: R })).toBe(false)
  expect(sameFiveHour({ pct: 42, resetsAt: R }, { pct: 42, resetsAt: '2026-10-10T16:30:00Z' })).toBe(false)
  // ... because the label is a function of exactly that: the same rounded percent draws the same bar too
  expect(usageLabel({ pct: 44.6, resetsAt: R }, 'he', 0)).toBe(usageLabel({ pct: 45, resetsAt: R }, 'he', 0))
  expect(usageLabel({ pct: 44.6, resetsAt: '' }, 'en', 0)).toBe('⏳ 5h ▰▰▰▰▰▱▱▱▱▱ 45%')
})

test('usageThreshold: 95, 80 or 0 on the rounded percent', () => {
  expect(usageThreshold(0)).toBe(0)
  expect(usageThreshold(79.4)).toBe(0)
  expect(usageThreshold(79.5)).toBe(80)
  expect(usageThreshold(94.4)).toBe(80)
  expect(usageThreshold(94.5)).toBe(95)
  expect(usageThreshold(100)).toBe(95)
})

test('toastDue / parseToastMark: once per window and threshold; a bad stored value is no mark', () => {
  const R = '2026-10-10T11:30:00Z'
  expect(toastDue(null, R, 80)).toBe(true)
  expect(toastDue({ resetsAt: R, at: 80 }, R, 80)).toBe(false)
  expect(toastDue({ resetsAt: R, at: 80 }, R, 95)).toBe(true)
  expect(toastDue({ resetsAt: R, at: 95 }, R, 80)).toBe(false)
  expect(toastDue({ resetsAt: R, at: 95 }, '2026-10-10T16:30:00Z', 80)).toBe(true)
  expect(parseToastMark({ resetsAt: R, at: 95 })).toEqual({ resetsAt: R, at: 95 })
  for (const bad of [undefined, null, 'x', 80, [], {}, { resetsAt: R }, { resetsAt: 1, at: 80 }, { resetsAt: R, at: 50 }]) expect(parseToastMark(bad)).toBeNull()
})

test('resetClock: the local HH:MM of the reset, empty when there is none', () => {
  expect(resetClock(new Date(2026, 9, 10, 9, 5).toISOString())).toBe('09:05')
  expect(resetClock('')).toBe('')
  expect(resetClock('soon')).toBe('')
})

// --- The hooks (register.tsx): session.measure, the first reading at session.start, the footer line
// ($.ui.status), the toasts at 80 / 95. Driven through the engine with the kit beneath (test-kit.ts: the
// mocked clock, the in-memory $.store, the toasts); usageBeneath adds what the kit does not answer:
// $.session.usage (the reading session.start asks for) and taps on $.ui.status and $.ui.invalidate. Each
// test gets a fresh plugin environment: what the hooks keep in module memory (USAGE, the last line, the last
// toast) starts empty in every test (a probe on 2.1.295: three tests in a row with the same reading each set
// the line, redrew and toasted again). Within ONE test that memory is shared: a second $.session.start there is
// the same environment, not a new conversation or a reload (only the $.store mark carries a window across
// environments, which the tests seed). The tests still use a window of their own each (resetsAt: 13:20 /
// 09:00 / 14:30, 19:30, 23:45 / 11:15, 16:15 / 10:10 / 08:50 and none / 12:40) and end on a reading without a
// five_hour window, which costs nothing and reads plainly.

const START = { cwd: 'C:/x', surface: 'desktop', isInteractive: true } as const
const CONTEXT = { tokens: 1, window: 200_000, percent: 0 }
const PANE = {
  plugin: 'agent-theater', component: 'Pane', requestId: 'agent-theater', surface: 'desktop',
  props: { title: 'T', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const prefs = (lang: 'he' | 'en') => ({ prefs: { lang, muted: false, showDone: false, pins: [] } })

/** A local wall-clock time on 2026-10-10 as ISO: it reads back as exactly HH:MM in any time zone. */
const local = (h: number, m: number) => new Date(2026, 9, 10, h, m).toISOString()

/** A five_hour reading (beside a seven_day window, which the meter ignores). */
const limits = (pct: number, resetsAt: string): SessionRateLimit[] =>
  [{ kind: 'seven_day', percentUsed: 12, resetsAt: '2026-10-15T00:00:00Z' }, { kind: 'five_hour', percentUsed: pct, resetsAt }]

/** The engine measuring the session: a rate-limit window moved (or `changed` says what did). */
const measure = ($: Engine, rateLimits: SessionRateLimit[], changed: UsageUnit[] = ['rateLimits']) =>
  $.session.measure({ context: CONTEXT, rateLimits, changed })

/**
 * Beneath the plugin: the engine's echo of session.measure (core answers `{ changed }`; nothing in the kit does),
 * $.session.usage answering `seen.usage` (or failing), and the status lines and redraw requests recorded.
 */
function usageBeneath(on: On) {
  const seen = { usage: [] as SessionRateLimit[], usageFails: false, statuses: [] as Array<string | undefined>, invalidates: 0 }
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => {
    if (seen.usageFails) throw new Error('no usage here')
    return { value: { startedAt: 0, context: CONTEXT, rateLimits: seen.usage } }
  })
  on('ui.status', ($, e) => { seen.statuses.push(e.text); return { value: undefined } })
  on('ui.invalidate', ($, e, next) => { seen.invalidates += 1; return next(e) })
  return seen
}

/** The usage meter the desktop office Client was handed on its last draw. */
async function usageProp(ui: { find: (q: { type: string }) => Promise<{ key: string | undefined; props: Record<string, unknown> } | undefined> }): Promise<OfficeProps['usage']> {
  const c = await ui.find({ type: 'Client' })
  expect(c?.key).toBe(OFFICE_KEY)
  return (c!.props.props as OfficeProps).usage
}

test('session.measure: the footer line ($.ui.status) is the five-hour label, and the pane is redrawn once with the meter', async ($, on) => {
  const { clock } = beneath(on, () => [], prefs('he'))
  const seen = usageBeneath(on)
  await $.session.start(START)
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount(PANE)
  const R = local(13, 20)
  const s0 = seen.statuses.length
  const i0 = seen.invalidates
  await measure($, limits(42, R))
  expect(seen.statuses.slice(s0)).toEqual(['⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 13:20'])
  expect(seen.statuses.at(-1)).toBe(usageLabel({ pct: 42, resetsAt: R }, 'he', 0))
  expect(seen.invalidates - i0).toBe(1)
  expect(await usageProp(ui)).toEqual({ pct: 42, resetsAt: R })
  // the window moved: a new line, a new redraw (⚠ from 80)
  await measure($, limits(80.4, R))
  expect(seen.statuses.at(-1)).toBe('⚠ 5h ▰▰▰▰▰▰▰▰▱▱ 80% · 13:20')
  expect(seen.invalidates - i0).toBe(2)
  expect(await usageProp(ui)).toEqual({ pct: 80.4, resetsAt: R })
  await measure($, []) // (leave no reading behind)
  expect(await usageProp(ui)).toBeNull()
  await ui.unmount()
})

test('no five_hour window (an API key, no subscription, before the first reading): the line is cleared, never stale, and nothing toasts', async ($, on) => {
  const { captured } = beneath(on, () => [], prefs('he'))
  const seen = usageBeneath(on)
  await $.session.start(START)
  const R = local(9, 0)
  await measure($, limits(90, R))
  expect(seen.statuses.at(-1)).toBe('⚠ 5h ▰▰▰▰▰▰▰▰▰▱ 90% · 09:00')
  const t0 = captured.toasts.length
  expect(t0).toBeGreaterThan(0) // (90%: this window's 80 toast)
  // the five_hour window left the reading (the seven_day one stays): the line is cleared, one redraw, no toast
  const i0 = seen.invalidates
  await measure($, [{ kind: 'seven_day', percentUsed: 97, resetsAt: R }])
  expect(seen.statuses.at(-1)).toBeUndefined()
  expect(seen.invalidates - i0).toBe(1)
  // still none: nothing more is said
  const s1 = seen.statuses.length
  await measure($, [])
  expect(seen.statuses.length).toBe(s1)
  expect(seen.invalidates - i0).toBe(1)
  // a new conversation whose first reading has no five_hour window, after one that showed a label: cleared at session.start
  await measure($, limits(30, R))
  expect(seen.statuses.at(-1)).toBe('⏳ 5h ▰▰▰▱▱▱▱▱▱▱ 30% · 09:00')
  seen.usage = []
  await $.session.start(START)
  expect(seen.statuses.at(-1)).toBeUndefined()
  // ... and when the reading itself fails
  await measure($, limits(30, R))
  seen.usageFails = true
  await $.session.start(START)
  expect(seen.statuses.at(-1)).toBeUndefined()
  expect(captured.toasts.length).toBe(t0)
  expect(seen.statuses.every(s => s === undefined || !/[\r\n\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/.test(s))).toBe(true)
})

test('toasts: once per window when the rounded percent reaches 80, once more at 95; a new window starts over ($.store usageToast)', async ($, on) => {
  const { captured } = beneath(on, () => [], prefs('he'))
  usageBeneath(on)
  await $.session.start(START)
  const R1 = local(14, 30)
  await measure($, limits(79, R1))
  await measure($, limits(79.4, R1))
  expect(captured.toasts).toEqual([])
  await measure($, limits(81, R1))
  expect(captured.toasts).toEqual(['נוצלו 81% ממכסת 5 השעות · איפוס 14:30'])
  expect(captured.store.usageToast).toEqual({ resetsAt: R1, at: 80 })
  await measure($, limits(85, R1))
  await measure($, limits(79, R1)) // (a dip and back: still this window's 80)
  await measure($, limits(88, R1))
  expect(captured.toasts).toHaveLength(1)
  await measure($, limits(96, R1))
  expect(captured.toasts).toEqual(['נוצלו 81% ממכסת 5 השעות · איפוס 14:30', 'נוצלו 96% ממכסת 5 השעות · איפוס 14:30'])
  expect(captured.store.usageToast).toEqual({ resetsAt: R1, at: 95 })
  await measure($, limits(99, R1))
  await measure($, limits(100, R1))
  expect(captured.toasts).toHaveLength(2)
  expect(captured.storeWrites.usageToast).toBe(2)
  // the window reset: a new resetsAt starts the count over
  const R2 = local(19, 30)
  await measure($, limits(3, R2))
  expect(captured.toasts).toHaveLength(2)
  await measure($, limits(82, R2))
  expect(captured.toasts.at(-1)).toBe('נוצלו 82% ממכסת 5 השעות · איפוס 19:30')
  expect(captured.toasts).toHaveLength(3)
  // a jump straight past 95 in a fresh window is ONE toast, the 95 one
  const R3 = local(23, 45)
  await measure($, limits(97, R3))
  expect(captured.toasts.at(-1)).toBe('נוצלו 97% ממכסת 5 השעות · איפוס 23:45')
  expect(captured.toasts).toHaveLength(4)
  await measure($, limits(98, R3))
  expect(captured.toasts).toHaveLength(4)
  await measure($, [])
})

test('the first reading at session.start (a new conversation, or a reload of the module: session.start fires on every fresh load): the line at once; a toast only when this window was never toasted', async ($, on) => {
  // another conversation already toasted the 80 of window R1 (the $.store mark outlives it)
  const R1 = local(11, 15)
  const { captured } = beneath(on, () => [], { ...prefs('en'), usageToast: { resetsAt: R1, at: 80 } })
  const seen = usageBeneath(on)
  seen.usage = limits(85, R1)
  await $.session.start(START)
  expect(seen.statuses.at(-1)).toBe('⚠ 5h ▰▰▰▰▰▰▰▰▰▱ 85% · 11:15')
  expect(captured.toasts).toEqual([])
  // ... its 95 was not: that one toasts, in English as the prefs say
  await measure($, limits(95, R1))
  expect(captured.toasts).toEqual(['5-hour limit: 95% · resets 11:15'])
  // session.start again in the same window: no toast again (in this test's one environment the 95 mark in module memory
  // answers before $.store is read; a fresh environment reading the stored mark is the case above, at 80)
  seen.usage = limits(96, R1)
  await $.session.start(START)
  expect(captured.toasts).toHaveLength(1)
  // a window never toasted: the first reading toasts once, even at start
  const R2 = local(16, 15)
  seen.usage = limits(83, R2)
  await $.session.start(START)
  expect(captured.toasts).toEqual(['5-hour limit: 95% · resets 11:15', '5-hour limit: 83% · resets 16:15'])
  expect(captured.store.usageToast).toEqual({ resetsAt: R2, at: 80 })
  await $.session.start(START)
  await measure($, limits(83, R2))
  expect(captured.toasts).toHaveLength(2)
  await measure($, [])
})

test('a reading that draws the same does nothing, whatever the measurement says changed: no line, no redraw, no store, no state; a new rounded percent is one redraw and one line', async ($, on) => {
  const { captured, clock } = beneath(on, () => [], prefs('he'))
  const seen = usageBeneath(on)
  await $.session.start(START)
  await clock.advance(POLL_MS) // (session.start's own poll settles first: its first publish retitles, a prefs read of its own)
  const R = local(10, 10)
  await measure($, limits(42, R))
  const s0 = seen.statuses.length
  const i0 = seen.invalidates
  const w0 = JSON.stringify(captured.writes)
  const sw0 = JSON.stringify(captured.storeWrites)
  const p0 = captured.prefsReads
  // the same reading; moves the person cannot see (42.4, 41.6: still 42%); the seven_day window moving;
  // measurements of the context or the cost alone
  await measure($, limits(42, R))
  await measure($, limits(42.4, R), ['context'])
  await measure($, limits(41.6, R), ['rateLimits', 'context'])
  await measure($, [{ kind: 'seven_day', percentUsed: 13, resetsAt: '2026-10-15T00:00:00Z' }, { kind: 'five_hour', percentUsed: 42.2, resetsAt: R }])
  await measure($, limits(42, R), ['cost'])
  expect(seen.statuses.length, 'status calls').toBe(s0)
  expect(seen.invalidates, 'redraw requests').toBe(i0)
  expect(JSON.stringify(captured.writes), '$.state writes').toBe(w0)
  expect(JSON.stringify(captured.storeWrites), '$.store writes').toBe(sw0)
  expect(captured.prefsReads, 'prefs reads').toBe(p0)
  // a new rounded percent is read whatever `changed` names: one redraw, one line
  await measure($, limits(43, R), ['context'])
  expect(seen.invalidates, 'redraw requests').toBe(i0 + 1)
  expect(seen.statuses.slice(s0)).toEqual(['⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 43% · 10:10'])
  await measure($, [])
})

test('a window reported without a reset time is never toasted (no store read or write) — the ⚠ label still warns — and a window with one toasts as usual', async ($, on) => {
  let markReads = 0
  // (beneath the plugin, above the kit's in-memory store: the reads of the toast mark)
  on('store.get', { key: 'usageToast' }, ($, e, next) => { markReads += 1; return next(e) })
  const { captured } = beneath(on, () => [], prefs('he'))
  const seen = usageBeneath(on)
  await $.session.start(START)
  const noReset = (pct: number): SessionRateLimit[] => [{ kind: 'five_hour', percentUsed: pct }]
  await measure($, noReset(85))
  expect(seen.statuses.at(-1)).toBe('⚠ 5h ▰▰▰▰▰▰▰▰▰▱ 85%')
  await measure($, noReset(97))
  expect(seen.statuses.at(-1)).toBe('⚠ 5h ▰▰▰▰▰▰▰▰▰▰ 97%')
  expect(captured.toasts).toEqual([])
  expect(markReads).toBe(0)
  expect(captured.storeWrites.usageToast).toBeUndefined()
  expect(captured.store.usageToast).toBeUndefined()
  // a window with a reset time: its 80 toasts (nothing was ever keyed '')
  const R = local(8, 50)
  await measure($, limits(85, R))
  expect(captured.toasts).toEqual(['נוצלו 85% ממכסת 5 השעות · איפוס 08:50'])
  expect(markReads).toBe(1)
  expect(captured.store.usageToast).toEqual({ resetsAt: R, at: 80 })
  await measure($, [])
})

test('SessionMode: the plugin adds no label there — the terminal and the desktop both draw $.ui.status, one label per surface', async ($, on) => {
  beneath(on, () => [], prefs('he'))
  const seen = usageBeneath(on)
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: [e.props.modes.join(' & ')] })
  })
  await $.session.start(START)
  await measure($, limits(42, local(12, 40)))
  expect(seen.statuses.at(-1)).toBe('⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 12:40')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-theater', component: 'SessionMode', requestId: 'session-mode', surface, props: { modes: ['focus'] } })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('focus')
    await ui.unmount()
  }
  await measure($, [])
})

// --- The pane header (Task 3.3): the desktop office Client's first line and the text surfaces' card header
// draw the reading the hooks keep (USAGE). The Client rides the kit mounted (the engine draws the module off
// the literal path in ui.tsx); a surface other than the desktop gets the text cards.

/** What the header helpers need of a mounted pane (structural: the kit's own type is generic over the surface and component). */
type Mounted = { find: (q: { type: string; text?: RegExp; in?: string }) => Promise<{ text?: string } | undefined>; findAll: (q: { type: string; in?: string }) => Promise<Array<{ text?: string }>> }

/**
 * The office header line the desktop Client drew: the Text (a Text per run, THE HEBREW RULE) holding the 🎭 — the
 * longest one, the line itself rather than its 🎭 run — with its blank cells trimmed. Hebrew (RTL): the parts run from
 * the right edge, so in cell order the meter comes first and the 🎭 last.
 */
async function officeHeader(ui: Mounted): Promise<string> {
  const lines = (await ui.findAll({ in: OFFICE_KEY, type: 'Text' })).map(t => t.text ?? '').filter(t => t.includes('🎭'))
  return lines.sort((a, b) => b.length - a.length)[0]?.trim() ?? ''
}

/** The text-card header's counts line (`🟢 0 … · ✅ 0 …`, or `🟢0 ✅0` when narrow). */
async function cardHeader(ui: Mounted): Promise<string> {
  return (await ui.find({ type: 'Text', text: /^🟢/ }))?.text ?? ''
}

/** Any Text on the pane that names the five-hour window. */
async function names5h(ui: Mounted) {
  return ui.find({ type: 'Text', text: /5h/ })
}

const NO_BIDI = /[\r\n\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/

test('desktop header: the Client gets the reading; a wide pane draws the full label, a narrow one the short form, ⚠ from 80, nothing without a reading', async ($, on) => {
  const { clock } = beneath(on, () => [], prefs('he'))
  usageBeneath(on)
  await $.session.start(START)
  await clock.advance(POLL_MS)
  const R = local(15, 45)
  const wide = await $.ui.mount(PANE) // bodyColumns 90
  expect(await officeHeader(wide)).toMatch(/ 0 🟢 🎭$/)
  expect(await officeHeader(wide)).not.toContain('5h')
  await measure($, limits(42, R))
  expect((await usageProp(wide))?.pct).toBe(42)
  const label = usageLabel({ pct: 42, resetsAt: R }, 'he', 0)
  expect(label).toBe('⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 15:45')
  expect((await officeHeader(wide)).slice(0, label.length + 3)).toBe(`${label} · `)
  await measure($, limits(85, R))
  expect(await officeHeader(wide)).toMatch(/^⚠ 5h ▰▰▰▰▰▰▰▰▰▱ 85% · 15:45 · /)
  expect(await officeHeader(wide)).not.toMatch(NO_BIDI)
  await measure($, [])
  expect(await officeHeader(wide)).not.toContain('5h')
  await wide.unmount()
  // narrow (under COMPACT_BELOW = 60): the short form, no bar, no clock
  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 45 } })
  expect(await officeHeader(narrow)).not.toContain('5h')
  await measure($, limits(42, R))
  expect((await usageProp(narrow))?.pct).toBe(42)
  expect(await officeHeader(narrow)).toMatch(/^⏳ 5h 42% · /)
  expect(await officeHeader(narrow)).not.toContain('▰')
  await measure($, limits(97, R))
  expect(await officeHeader(narrow)).toMatch(/^⚠ 5h 97% · /)
  await measure($, [])
  expect(await officeHeader(narrow)).not.toContain('5h')
  await narrow.unmount()
})

test('terminal header: the card header ends with the short meter (wide and narrow), ⚠ from 80, nothing without a reading', async ($, on) => {
  const { clock } = beneath(on, () => [], prefs('he'))
  usageBeneath(on)
  await $.session.start({ ...START, surface: 'terminal' })
  await clock.advance(POLL_MS)
  const R = local(17, 5)
  const TERMINAL = { ...PANE, surface: 'terminal' } as const
  const wide = await $.ui.mount(TERMINAL) // bodyColumns 90
  expect(await cardHeader(wide)).toMatch(/^🟢 0 /)
  expect(await names5h(wide)).toBeUndefined()
  await measure($, limits(42, R))
  expect(await cardHeader(wide)).toMatch(/^🟢 0 .* · ⏳ 5h 42%$/)
  await measure($, limits(85, R))
  expect(await cardHeader(wide)).toMatch(/ · ⚠ 5h 85%$/)
  expect(await cardHeader(wide)).not.toMatch(NO_BIDI)
  await measure($, [])
  expect(await names5h(wide)).toBeUndefined()
  expect(await cardHeader(wide)).not.toContain('5h')
  await wide.unmount()
  const narrow = await $.ui.mount({ ...TERMINAL, props: { ...PANE.props, bodyColumns: 45 } })
  expect(await cardHeader(narrow)).toMatch(/^🟢0 /)
  expect(await names5h(narrow)).toBeUndefined()
  await measure($, limits(42, R))
  expect(await cardHeader(narrow)).toMatch(/^🟢0 .* · ⏳ 5h 42%$/)
  await measure($, limits(91, R))
  expect(await cardHeader(narrow)).toMatch(/ · ⚠ 5h 91%$/)
  await measure($, [])
  expect(await names5h(narrow)).toBeUndefined()
  await narrow.unmount()
})

/** One agent for the card header's counts (running, stale = the idle count, or done); the rest is the scanner's usual shape. */
function agent(id: string, status: Agent['status']): Agent {
  return {
    id, persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: '', subagent_type: '', status, tool: 'Read', phase: 'tool',
    task: `Task of ${id}.`, task_short: `Task of ${id}.`, result: null, start_ms: T0 - 30_000, end_ms: status === 'done' ? T0 - 2000 : null,
    session: 'sess-aaa', session_full: 'sess-aaaa', cwd: '/w', project: '/w', mtime_ms: T0 - 1000,
    is_session: false, closed: false, is_workflow: false, truncated: false, model: '',
  }
}

test('terminal header: the meter is drawn whole or not at all — a narrow pane whose counts leave no room for it shows the counts alone', async ($, on) => {
  const { clock } = beneath(on, () => [agent('r1', 'running'), agent('s1', 'stale'), agent('d1', 'done')], prefs('he'))
  usageBeneath(on)
  await $.session.start({ ...START, surface: 'terminal' })
  await clock.advance(POLL_MS)
  const TERMINAL = { ...PANE, surface: 'terminal' } as const
  // 24 columns (the narrowest the pane lays out for): the compact counts are 11 cells, the meter would make 23 of the 21 there are
  const tight = await $.ui.mount({ ...TERMINAL, props: { ...PANE.props, bodyColumns: 24 } })
  expect(await cardHeader(tight)).toBe('🟢1 ⏳1 ✅1')
  await measure($, limits(42, local(21, 10)))
  expect(await cardHeader(tight)).toBe('🟢1 ⏳1 ✅1') // (no `· ⏳ 5…`, no `5h`: the percent is never cut in half)
  expect(await names5h(tight)).toBeUndefined()
  await tight.unmount()
  // room for it (a wider pane, same reading): the idle `⏳1` and the meter's `⏳ 5h 42%` are both there, told apart by `5h`
  const roomy = await $.ui.mount({ ...TERMINAL, props: { ...PANE.props, bodyColumns: 45 } })
  expect(await cardHeader(roomy)).toBe('🟢1 ⏳1 ✅1 · ⏳ 5h 42%')
  await measure($, [])
  expect(await cardHeader(roomy)).toBe('🟢1 ⏳1 ✅1')
  await roomy.unmount()
})
