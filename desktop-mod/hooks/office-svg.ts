// office-svg.ts — what is left of the desktop's SVG office. The desktop pane
// is the office Client now (office-client.tsx over office-layout.ts); the SVG
// drawing (room rows, tiles, the message card, their stylesheet) is gone, and
// this file keeps the three pure tokens the hooks still read:
//   UNKNOWN_MODEL_PILL  the model label of an agent whose model is unknown
//                       (ui.tsx's text cards and drawer, office-props.ts)
//   WALK_IN_MS          the walk-in window (ui.tsx walkIns)
//   toolFamily          tool name → colour family (office-props.ts `fam`)
//
// PURE: no `$`, no engine import, no state.

/** PAGE .entering: the walk-in lasts this long (ms); ui.tsx walkIns marks the ids first seen within it. */
export const WALK_IN_MS = 700
/** What the model label says when the model is unknown (the line is never dropped: every card keeps one layout). */
export const UNKNOWN_MODEL_PILL = '?'

/** Tool colour family (PAGE toolFamily): the monitor's glow. */
export type ToolFamily = '' | 'search' | 'read' | 'write' | 'cmd' | 'agent'

/** PAGE toolFamily(): tool name → colour family. */
export function toolFamily(tool: string): ToolFamily {
  if (!tool) return ''
  if (tool.startsWith('mcp__')) return 'agent'
  if (/^(WebSearch|Grep|Glob)$/.test(tool)) return 'search'
  if (/^(Read|WebFetch)$/.test(tool)) return 'read'
  if (/^(Edit|Write|NotebookEdit|MultiEdit)$/.test(tool)) return 'write'
  if (/^(Bash|PowerShell|BashOutput|KillShell)$/.test(tool)) return 'cmd'
  if (/^(Task|Agent)$/.test(tool)) return 'agent'
  return ''
}
