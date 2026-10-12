// usage.ts: the five-hour usage meter as one short footer line. Pure — the
// window is picked from a limits list, the bar and the label are asserted on
// strings. The reset time is the machine's local HH:MM, so every expectation
// that names a clock time is built from local getters or from a local-time
// Date, never from a hard-coded UTC hour: the suite passes in any time zone.

import { expect, test } from 'claude-code/testing'

import { pickFiveHour, usageBar, usageLabel } from './usage'

test('pickFiveHour takes the five_hour window only', () => {
  expect(pickFiveHour([])).toBeNull()
  expect(pickFiveHour([{ kind: 'seven_day', percentUsed: 10 }])).toBeNull()
  expect(pickFiveHour([{ kind: 'seven_day', percentUsed: 10 }, { kind: 'five_hour', percentUsed: 42.4, resetsAt: '2026-10-10T11:30:00Z' }])).toEqual({ pct: 42.4, resetsAt: '2026-10-10T11:30:00Z' })
  expect(pickFiveHour([{ kind: 'five_hour', percentUsed: 7 }])).toEqual({ pct: 7, resetsAt: '' })
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
