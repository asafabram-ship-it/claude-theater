// Confetti: the `Client` surface module behind a card that just finished (the
// port of PAGE's confetti() burst). Drawn only on the surfaces that have a
// `Client` (terminal, desktop); the others get a static "🎉✨" line.
//
// A surface module has no `$` and no timers but the surface's own frame
// clock (`surface.every`): it runs a 12-frame burst at 85 ms (≈ PAGE's 0.85 s
// fall; the card drops the Client after BURST_MS = 1050 ms), the glyphs
// rising and spreading across the card's width, then settles on a sparkle
// line. Props are plain data: { seed, width } (seed = the agent id's hash,
// so two cards never burst alike).
//
// OWNER: builder "ui".

import type { ClientModule } from 'claude-code'

type ConfettiProps = { seed: number; width: number }
type ConfettiState = { frame: number }

const GLYPHS = ['🎉', '✨', '🎊', '⭐', '✅'] as const
const FRAMES = 12
const FRAME_MS = 85

/** The burst's one row at `frame` (exported for the module's own reasoning; the engine calls `Confetti`). */
export function confettiLine(seed: number, width: number, frame: number): string {
  const cols = Math.max(4, Math.floor(width))
  const cells: string[] = new Array(cols).fill(' ')
  const n = Math.min(10, Math.max(3, Math.floor(cols / 3)))
  for (let i = 0; i < n; i++) {
    // each piece has its own phase; the burst spreads outward then drifts back
    const spread = frame < FRAMES ? frame : FRAMES
    const base = ((seed >>> 0) * 7 + i * 13) % cols
    const dir = i % 2 === 0 ? 1 : -1
    const pos = (base + dir * Math.floor((spread * (i % 3 + 1)) / 3) + cols * 4) % cols
    const g = GLYPHS[(seed + i + Math.floor(frame / 3)) % GLYPHS.length] ?? '✨'
    if (cells[pos] === ' ') cells[pos] = g
  }
  // an emoji is two cells wide: drop the cell after each so the row stays within width
  let out = ''
  let used = 0
  for (const c of cells) {
    const w = c === ' ' ? 1 : 2
    if (used + w > cols) break
    out += c
    used += w
  }
  return out
}

const Confetti: ClientModule<ConfettiProps, ConfettiState> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    let frame = 0
    const stop = surface.every(FRAME_MS, () => {
      frame += 1
      surface.setState({ frame })
      if (frame >= FRAMES) stop()
    })
    surface.setState({ frame: 0 })
  }
  const frame = surface.state?.frame ?? 0
  const width = typeof props?.width === 'number' ? props.width : surface.columns || 24
  const seed = typeof props?.seed === 'number' ? props.seed : 0
  return Text({ children: confettiLine(seed, width, frame), color: frame < FRAMES ? 'yellow' : undefined, dimColor: frame >= FRAMES })
}

export default Confetti
