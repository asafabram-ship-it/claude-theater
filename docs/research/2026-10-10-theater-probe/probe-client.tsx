// Probe surface module: 100 half-block tiles, a counter on its own clock, a Button, an Input,
// pointer logging. No `$` here: everything reaches the hooks through surface.post.
import type { ClientModule, ClientSurface } from 'claude-code'

type Props = { seq: number; offset: number; hot: number; rows: number; columns: number }
type State = { tick: number; last: string; text: string; stop: () => void }

const COLS = 10
const TILE_W = 6
const PAL = ['#7b5cf0', '#2f7fe8', '#1fa876', '#d9872b', '#e6c07e']

// Pointer throttle: `down`/`up`/`enter`/`leave` always post; a `move` posts only when the 250 ms
// tick has advanced since the last post of any kind, so it never displaces a `down` or a `press`
// (surface.post delivers one per frame; a later post in the same frame replaces an undelivered one).
let tickNow = 0
let lastPostTick = -1
let pressTick = -1

const Probe: ClientModule<Props, State> = (props, surface: ClientSurface<State>) => {
  const { Box, Text, Button, Input } = surface.elements
  if (surface.state === undefined) {
    const stop = surface.every(250, () => {
      tickNow += 1
      const s = surface.state
      if (s) surface.setState({ ...s, tick: tickNow })
    })
    surface.onPointer(ev => {
      const s = surface.state
      if (!s) return
      const line = `${ev.type} x=${ev.x} y=${ev.y} ${ev.button ?? ''}`
      if (ev.type === 'move' && tickNow <= lastPostTick) return
      if (ev.type === 'up' && pressTick === tickNow) return // the Button's press already posted this tick
      lastPostTick = tickNow
      surface.post({ t: 'pointer', line })
      if (ev.type === 'down') surface.setState({ ...s, last: line })
    })
    surface.onKey(ev => surface.post({ t: 'key', line: `${ev.key}${ev.ctrl ? ' ctrl' : ''}` }))
    surface.setState({ tick: 0, last: '-', text: '', stop })
  }
  const s = surface.state ?? { tick: 0, last: '-', text: '', stop: () => undefined }
  const rows: ReturnType<typeof Text>[] = []
  for (let r = 0; r < COLS; r++) {
    const kids: Array<ReturnType<typeof Text> | string> = []
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c
      const hot = i === props.hot
      const fg = PAL[(i + props.seq) % PAL.length] ?? '#fff'
      kids.push(Text({ color: hot ? '#ffffff' : fg, ...(hot ? { backgroundColor: '#c62828' } : {}), children: ['🦉', '▀'.repeat(TILE_W - 2)] }))
    }
    rows.push(Text({ wrap: 'truncate', children: kids }))
  }
  const visible = rows.slice(props.offset, props.offset + Math.max(1, props.rows - 4))
  return Box({
    flexDirection: 'column',
    children: [
      Text({ bold: true, children: [`probe tick=${s.tick} seq=${props.seq} offset=${props.offset} size=${surface.columns}x${surface.rows} last=${s.last}`] }),
      Box({ flexDirection: 'row', columnGap: 1, children: [
        Button({ key: 'probe-btn', label: 'Press me', hotkey: 'p', onPress: () => {
          pressTick = tickNow
          lastPostTick = tickNow
          surface.post({ t: 'press' })
        } }),
        Input({
          key: 'probe-in',
          placeholder: 'type here',
          value: s.text,
          onInput: (v: string) => {
            surface.post({ t: 'input', line: v })
            const cur = surface.state
            if (cur) surface.setState({ ...cur, text: v })
          },
          onSubmit: (v: string) => surface.post({ t: 'submit', line: v }),
        }),
      ] }),
      Text({ dimColor: true, children: ['שלום עולם — עברית בריצה אחת'] }),
      ...visible,
    ],
  })
}
export default Probe
