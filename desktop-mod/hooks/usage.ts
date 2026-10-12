// The five-hour rate-limit window as the footer label draws it. Pure: no
// imports at all (so a surface module may import it), and no clock of its own —
// `now` is an input and the reset hour is read through the machine's local
// getters. The label is one short line: no newline, no bidi control characters,
// readable after the plugin-name prefix the desktop footer puts in front of it.
export type FiveHour = { pct: number; resetsAt: string }

export function pickFiveHour(limits: ReadonlyArray<{ kind: string; percentUsed: number; resetsAt?: string }>): FiveHour | null {
  const l = limits.find(x => x.kind === 'five_hour')
  return l ? { pct: l.percentUsed, resetsAt: l.resetsAt ?? '' } : null
}

export function usageBar(pct: number, cells = 10): string {
  const on = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)))
  return '▰'.repeat(on) + '▱'.repeat(cells - on)
}

/** `⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30` — the reset hour in the machine's local time; `⚠` from 80%. */
export function usageLabel(u: FiveHour, _lang: 'he' | 'en', _now: number): string {
  const pct = Math.round(u.pct)
  const head = pct >= 80 ? '⚠' : '⏳'
  let when = ''
  if (u.resetsAt) {
    const d = new Date(u.resetsAt)
    if (!Number.isNaN(d.getTime())) when = ` · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${head} 5h ${usageBar(u.pct)} ${pct}%${when}`
}
