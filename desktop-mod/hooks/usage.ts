// The five-hour rate-limit window as the footer label draws it. Pure: no
// imports at all (so a surface module may import it), and no clock of its own —
// `now` is an input and the reset hour is read through the machine's local
// getters. The label is one short line: no newline, no bidi control characters,
// readable after the plugin-name prefix the desktop footer puts in front of it.
// `usageShort` is its narrow twin (`⏳ 5h 42%`) for the pane header.
// Beside it, the pure pieces of register.tsx's usage hooks: when a reading is
// new (sameFiveHour), which threshold it reached (usageThreshold), and the toast
// mark kept in $.store (ToastMark, parseToastMark, toastDue).
export type FiveHour = { pct: number; resetsAt: string }

/** The five_hour window of a rate-limit list; null when there is none or its percentage is not a finite number. */
export function pickFiveHour(limits: ReadonlyArray<{ kind: string; percentUsed: number; resetsAt?: string }>): FiveHour | null {
  const l = limits.find(x => x.kind === 'five_hour')
  return l && Number.isFinite(l.percentUsed) ? { pct: l.percentUsed, resetsAt: l.resetsAt ?? '' } : null
}

export function usageBar(pct: number, cells = 10): string {
  const on = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)))
  return '▰'.repeat(on) + '▱'.repeat(cells - on)
}

/** The reset as the machine's local `HH:MM`; '' when there is no reset time or it does not parse. */
export function resetClock(resetsAt: string): string {
  if (!resetsAt) return ''
  const d = new Date(resetsAt)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * `⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30` — the reset hour in the machine's local time; `⚠` from 80%.
 * Everything in it follows the ROUNDED percent (the bar too), so the label is a function of what
 * sameFiveHour compares: 44.6 and 45 draw the same `45%` and the same bar.
 */
export function usageLabel(u: FiveHour, _lang: 'he' | 'en', _now: number): string {
  const pct = Math.round(u.pct)
  const clock = resetClock(u.resetsAt)
  const when = clock ? ` · ${clock}` : ''
  return `${usageHead(pct)} 5h ${usageBar(pct)} ${pct}%${when}`
}

/** The mark before `5h`: `⚠` from a rounded 80%, else `⏳`. */
function usageHead(roundedPct: number): string {
  return roundedPct >= 80 ? '⚠' : '⏳'
}

/**
 * `⏳ 5h 42%` — the label without its bar and clock, for a narrow header (the office's under WIDE_FROM
 * columns, the text cards' counts line). It keeps `5h` so it is never taken for the idle count (`⏳ 2 idle`).
 */
export function usageShort(u: FiveHour): string {
  const pct = Math.round(u.pct)
  return `${usageHead(pct)} 5h ${pct}%`
}

/** `⏳ 42%` — the narrowest form (the office header's last step before the meter would be cut: the probe's `⏳ 6%`, round 8). */
export function usageTiny(u: FiveHour): string {
  const pct = Math.round(u.pct)
  return `${usageHead(pct)} ${pct}%`
}

/**
 * Is `b` the same reading as `a`, as far as anything drawn goes? The rounded
 * percent (the label, its bar and the office header all draw that) and the
 * window (`resetsAt`); null (no five_hour window) equals null only. A move the
 * person cannot see (42 → 42.4) is no change: no line, no redraw.
 */
export function sameFiveHour(a: FiveHour | null, b: FiveHour | null): boolean {
  if (a === null || b === null) return a === b
  return Math.round(a.pct) === Math.round(b.pct) && a.resetsAt === b.resetsAt
}

/** The toast thresholds, by the rounded percent (the label's `⚠` starts at the first). */
export type UsageThreshold = 80 | 95

/** The highest threshold the rounded percent reached; 0 below 80. */
export function usageThreshold(pct: number): UsageThreshold | 0 {
  const p = Math.round(pct)
  return p >= 95 ? 95 : p >= 80 ? 80 : 0
}

/** The last five-hour toast: which window (its `resetsAt`) and which threshold. */
export type ToastMark = { resetsAt: string; at: UsageThreshold }

/** A stored toast mark, checked; anything else is no mark (a bad value never blocks or repeats a toast forever). */
export function parseToastMark(v: unknown): ToastMark | null {
  if (typeof v !== 'object' || v === null) return null
  const m = v as { resetsAt?: unknown; at?: unknown }
  return typeof m.resetsAt === 'string' && (m.at === 80 || m.at === 95) ? { resetsAt: m.resetsAt, at: m.at } : null
}

/** Is a toast due for `at` in the window `resetsAt`, given the last mark? Once per window per threshold, never one lower. */
export function toastDue(mark: ToastMark | null, resetsAt: string, at: UsageThreshold): boolean {
  return mark === null || mark.resetsAt !== resetsAt || mark.at < at
}
