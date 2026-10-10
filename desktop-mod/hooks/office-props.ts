// office-props.ts: the data the desktop office Client draws from, as JSON
// (no undefined, no functions). This file is the "Shared interfaces" block of
// the Client office plan: the types and the Client key only. Task 2.2 adds the
// builder (`buildOfficeProps`, `assertJson`, `modelFamily`) beside them.

/** The Client's key and the `ui.message` matcher. */
export const OFFICE_KEY = 'office'

export type OfficeAgent = {
  id: string; emoji: string; name: string
  status: 'running' | 'stale' | 'done'
  fam: '' | 'search' | 'read' | 'write' | 'cmd' | 'agent'   // toolFamily(tool) from office-svg.ts
  act: string                                               // activityLabel(a, lang)
  model: string                                             // modelLabel(a.model) or '?'
  modelFam: 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other'
  startMin: number | null                                   // elapsed minutes (agentElapsed at the minute clock), null = unknown
  isLead: boolean; failed: boolean; longRunning: boolean
  star: number                                              // end_ms of a just-finished agent inside the ⭐ window, else 0
  enteredAt: number                                         // ms the office first saw it (firstSeen), 0 when unknown
}

export type OfficeRoom = {
  id: string; title: string; small: string; pinned: boolean; showDone: boolean
  run: number; stale: number; done: number
  agents: OfficeAgent[]
}

export type OfficeDrawer = { id: string; name: string; chips: string[]; model: string; act: string; task: string; result: string; truncated: boolean }

export type OfficeProps = {
  v: 1
  lang: 'he' | 'en'; rtl: boolean
  columns: number; rows: number
  offset: number
  nowMin: number
  counts: { run: number; idle: number; done: number }
  prefs: { showDone: boolean; muted: boolean; still: boolean }
  search: string; selected: string | null; helpOpen: boolean; demo: boolean
  rooms: OfficeRoom[]
  drawer: OfficeDrawer | null
  footer: string
  usage: { pct: number; resetsAt: string } | null
  empty: { kind: 'office' | 'nomatch' | 'nonewindow' | 'noactive'; msg: string; sub: string } | null
  labels: Record<string, string>                            // the i18n strings the module draws (toolbar, help rows, drawer headings)
}

export type OfficeMessage =
  | { t: 'open'; id: string } | { t: 'close' } | { t: 'pin'; room: string } | { t: 'roomDone'; room: string }
  | { t: 'showDone' } | { t: 'mute' } | { t: 'lang' } | { t: 'help' } | { t: 'demo' } | { t: 'still' }
  | { t: 'search'; q: string } | { t: 'focus'; id: string } | { t: 'content'; rows: number } | { t: 'pull'; seq: number }
