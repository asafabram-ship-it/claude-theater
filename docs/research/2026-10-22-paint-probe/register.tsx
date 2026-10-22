import type { Register } from 'claude-code'

// Throwaway probe (22.10, live check 8): what the desktop paints INSIDE a Client for the office's phase B — a scoped
// hover underline on column-major rows, the more line and the toolbar; a hover 📌 that never moves the title (two
// placements); a drawer FLOATING over the cards at the window's top (position absolute; four backgrounds); whether a
// button-less pointer leave reaches the module; whether the desktop calls the module again on EQUAL props; the click
// latency of the paths (a `ui.message` answering `{ props }`, a redraw through `ui.render`, a local setState); and
// whether one press of f reaches both a Button's hotkey and onKey. The module (probe-client.tsx) measures; its
// `report` posts are written to LOG so the numbers reach the session without being typed.
const PANE = 'paint-probe'
const TITLE = '🔬 בדיקת ציור'
const LOG = 'C:/Users/asafa/.claude/paint-probe.log'
/** The Client's rows: the module draws exactly this many (probe-client.tsx HEIGHT), so the pane scrolls natively. */
const HEIGHT = 58

type Pong = { n: number; via: 'answer' | 'render' }
let pending: Pong | null = null
let pong: Pong | null = null
let theme = ''
let offset = 0
let body = 30
/** What the ui.scroll hook saw last: its events, the offset it asked for, the tree's rows — against the offset ui.render was handed. */
let scrolls = 0
let scrollOffset = -1
let contentRows = -1
let renders = 0
let lines: string[] = []
let writing: Promise<void> = Promise.resolve()

const propsNow = () => ({ pong, offset, body, theme, height: HEIGHT, scrolls, scrollOffset, contentRows, renders })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'paint-probe', description: 'Open the phase-B paint probe pane' })
    try {
      const row = (await $.config.list()).find(r => r.key === 'theme')
      theme = typeof row?.value === 'string' ? row.value : ''
    } catch {
      // no theme row: the raw background variant guesses light
    }
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })
  on('command.run', { command: 'paint-probe' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'opened' }
  })
  on('ui.message', { element: 'probe' }, async ($, e) => {
    const d = e.data as { t?: string; n?: number; text?: string } | null
    if (!d || typeof d !== 'object') return {}
    if (d.t === 'ping' && typeof d.n === 'number') {
      // the direct path: the answer IS the next props, no ui.render
      pong = { n: d.n, via: 'answer' }
      return { props: propsNow() }
    }
    if (d.t === 'pingRender' && typeof d.n === 'number') {
      // the redraw path: remember, invalidate, the render hands the props
      pending = { n: d.n, via: 'render' }
      try { $.ui.invalidate('ui.render') } catch { /* nothing draws the pane */ }
      return {}
    }
    if (d.t === 'same') {
      // a redraw whose props equal the last ones: does the desktop call the module again?
      try { $.ui.invalidate('ui.render') } catch { /* nothing draws the pane */ }
      return {}
    }
    if (d.t === 'report' && typeof d.text === 'string') {
      const t = await $.clock.now().catch(() => 0)
      lines.push(`${new Date(t).toISOString()} ${d.text.slice(0, 6000)}`)
      lines = lines.slice(-300)
      const text = lines.join('\n') + '\n'
      writing = writing.then(() => $.fs.write(LOG, text)).catch(() => undefined)
      await writing
      return {}
    }
    return {}
  })
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // recorded only (never answered or moved): does ui.render follow each step with the new offset?
    scrolls++
    scrollOffset = e.offset
    contentRows = e.contentRows
    return next(e)
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    renders++
    if (pending) { pong = pending; pending = null }
    if (!('Client' in els)) {
      const { Text } = els
      return <Text>{'בדיקת הציור רצה רק בדסקטופ'}</Text>
    }
    const { Client } = els
    offset = e.props.scroll?.offset ?? 0
    body = e.props.scroll?.bodyRows ?? 30
    const width = Math.max(30, e.props.bodyColumns || 50)
    return <Client key="probe" module="./probe-client.tsx" width={width} height={HEIGHT} props={propsNow()} />
  })
}
