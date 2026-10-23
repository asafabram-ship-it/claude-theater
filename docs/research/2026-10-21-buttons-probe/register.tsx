import type { Register } from 'claude-code'

// Throwaway probe (21.10, live check 7): what the desktop does INSIDE A Client — a scoped hover underline on
// column-major cells, a link colour, the toolbar's plain Buttons in and out of a height-1 line, a floating
// (absolute) card over rows (with and without a theme background), a pin revealed by hover, a press while the
// instance re-renders every 50 ms, and the click latency of the two paths (a `ui.message` answering `{ props }`
// vs a redraw through `ui.render`). The module (probe-client.tsx) measures; its `report` post is logged to the
// transcript so the numbers reach the session without being typed.
const PANE = 'buttons-probe'
const TITLE = '🔬 בדיקת כפתורים'

type Pong = { t0: number; via: 'answer' | 'render'; n: number }
let pending: Pong | null = null
let lastPong: Pong | null = null
let renders = 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'buttons-probe', description: 'Open the buttons probe pane' })
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })
  on('command.run', { command: 'buttons-probe' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'opened' }
  })
  on('ui.message', { element: 'probe' }, async ($, e) => {
    const d = e.data as { t?: string; t0?: number; n?: number; text?: string } | null
    if (!d || typeof d !== 'object') return {}
    if (d.t === 'ping' && typeof d.t0 === 'number' && typeof d.n === 'number') {
      // the direct path: the answer IS the next props, no ui.render
      lastPong = { t0: d.t0, via: 'answer', n: d.n }
      return { props: { pong: lastPong, renders } }
    }
    if (d.t === 'pingRender' && typeof d.t0 === 'number' && typeof d.n === 'number') {
      // the redraw path: remember, invalidate, the render hands the props
      pending = { t0: d.t0, via: 'render', n: d.n }
      try { $.ui.invalidate('ui.render') } catch { /* nothing draws the pane */ }
      return {}
    }
    if (d.t === 'report' && typeof d.text === 'string') {
      $.ui.log(`buttons-probe report: ${d.text.slice(0, 4000)}`, { to: 'transcript' })
      return {}
    }
    return {}
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    renders++
    if (pending) { lastPong = pending; pending = null }
    if (!('Client' in els)) {
      const { Text } = els
      return <Text>{'בדיקת הכפתורים רצה רק בדסקטופ'}</Text>
    }
    const { Client } = els
    const width = Math.max(30, e.props.bodyColumns || 50)
    return <Client key="probe" module="./probe-client.tsx" width={width} props={{ pong: lastPong, renders }} />
  })
}
