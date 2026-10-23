import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'

// The buttons probe's surface module (see register.tsx): seven numbered sections Asaf walks through, and a report
// post at the end. Everything it measures lives in `inst` (mutated in place); `setState` only from events and timers.

type Pong = { t0: number; via: 'answer' | 'render'; n: number }
type P = { pong: Pong | null; renders: number }
type Inst = {
  moves: number; enters: number; leaves: number; downs: number; lastDownAt: number
  presses: Record<string, number>; pressLat: number[]
  fast: boolean; stopFast: (() => void) | null; fastTicks: number; fastPresses: number
  floatA: boolean; floatB: boolean
  pingN: number; sent: Record<number, number>; lastPongN: number
  answer: number[]; render: number[]
  calls: number
}
type S = { inst: Inst; n: number }

const CARD_BORDER = '#56607a'
const now = (): number => (typeof Date !== 'undefined' ? Date.now() : 0)
const last = (xs: number[], k: number): string => (xs.length === 0 ? '-' : xs.slice(-k).join(' '))

function bump(surface: ClientSurface<S>): void {
  const s = surface.state
  if (s) surface.setState({ inst: s.inst, n: s.n + 1 })
}

const Probe: ClientModule<P, S> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  let s = surface.state
  if (s === undefined) {
    const inst: Inst = {
      moves: 0, enters: 0, leaves: 0, downs: 0, lastDownAt: 0, presses: {}, pressLat: [],
      fast: false, stopFast: null, fastTicks: 0, fastPresses: 0, floatA: false, floatB: false,
      pingN: 0, sent: {}, lastPongN: -1, answer: [], render: [], calls: 0,
    }
    s = { inst, n: 0 }
    surface.setState(s)
    surface.onPointer(ev => {
      try {
        const cur = surface.state
        if (!cur) return
        const i = cur.inst
        if (ev.type === 'move' && !ev.button) i.moves++
        else if (ev.type === 'enter') i.enters++
        else if (ev.type === 'leave') i.leaves++
        else if (ev.type === 'down') { i.downs++; i.lastDownAt = now() }
      } catch {
        // a listener never throws
      }
    })
    // the counters on screen refresh once a second (a tick, not a loop)
    surface.every(1000, () => bump(surface))
  }
  const inst = s.inst
  inst.calls++

  // props arrival: the time from the post to this call, by path
  const pong = props?.pong
  if (pong && pong.n !== inst.lastPongN) {
    inst.lastPongN = pong.n
    const t0 = inst.sent[pong.n]
    if (t0 !== undefined) (pong.via === 'answer' ? inst.answer : inst.render).push(now() - t0)
  }

  const row = 'row-reverse'
  const line = (children: RenderElement[], extra: Record<string, unknown> = {}): RenderElement =>
    Box({ flexDirection: row, columnGap: 1, flexWrap: 'nowrap', height: 1, overflow: 'hidden', ...extra, children })
  const head = (t: string): RenderElement => Box({ marginTop: 1, flexDirection: row, height: 1, overflow: 'hidden', children: [Text({ bold: true, children: [t] })] })
  const dim = (t: string): RenderElement => line([Text({ dimColor: true, children: [t] })])
  const press = (key: string) => () => {
    inst.presses[key] = (inst.presses[key] ?? 0) + 1
    // (only a down that reached the module in the last 3 s: a native Button's down may never reach onPointer)
    if (inst.lastDownAt > 0 && now() - inst.lastDownAt < 3000) inst.pressLat.push(now() - inst.lastDownAt)
    inst.lastDownAt = 0
    bump(surface)
  }
  const pressCount = Object.values(inst.presses).reduce((n, v) => n + v, 0)
  const kids: RenderElement[] = []

  kids.push(line([Text({ bold: true, children: ['🔬 בדיקת כפתורים'] })]))
  kids.push(dim('עבור על כל סעיף ותגיד לי מה ראית'))
  kids.push(dim(`עכבר: תנועות ${inst.moves} · כניסות ${inst.enters} · לחיצות ${inst.downs}`))

  // 1. a scoped underline on a column-major row (every cell of row i joins scope r-i)
  kids.push(head('1. קו תחתון כשהעכבר עובר על שורה'))
  const rows = [
    ['●', 'הינשוף', 'Opus', '🤔', 'חושב'],
    ['●', 'הרופא', 'Sonnet', '✏️', 'כותב'],
    ['○', 'הזאב', 'Sonnet', '✅', 'סיים'],
  ]
  const col = (c: number, dimmed: (r: number) => boolean, bold: (r: number) => boolean) => Box({
    flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0, paddingLeft: 1,
    children: rows.map((r, i) => Text({ bold: bold(i), dimColor: dimmed(i), hover: { scope: `p-row-${i}`, underline: true }, children: [r[c]!] })),
  })
  kids.push(Box({ borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, flexDirection: 'column', children: [
    Box({ flexDirection: row, children: [
      col(0, () => false, () => false),
      col(1, i => i === 2, i => i < 2),
      col(2, () => true, () => false),
      col(3, i => i === 2, () => false),
      col(4, i => i !== 0 && i === 2, () => false),
    ] }),
  ] }))

  // 2. the link colour candidates for the more line
  kids.push(head('2. איזה צבע נראה כמו קישור?'))
  const colours: Array<[string, Record<string, unknown>]> = [
    ['א', { color: 'suggestion' }], ['ב', { color: 'ide' }], ['ג', { color: 'permission' }], ['ד', { dimColor: true }],
  ]
  for (const [letter, style] of colours) {
    kids.push(line([Text({ ...style, hover: { scope: `p-more-${letter}`, underline: true }, children: [`${letter}. ▸ עוד 3 שסיימו`] })]))
  }

  // 3. the toolbar's plain Buttons: in a height-1 line (today), unconstrained, with a hover underline, and non-plain
  kids.push(head('3. איך נראים הכפתורים?'))
  const tb = (tag: string, extra: Record<string, unknown> = {}) => [
    Button({ key: `${tag}-done`, plain: true, label: '☐ הצג שסיימו', onPress: press(`${tag}-done`), ...(extra.hover ? { hover: { scope: `${tag}-done`, underline: true } } : {}) }),
    Button({ key: `${tag}-mute`, plain: true, label: '🔔 צליל', onPress: press(`${tag}-mute`), ...(extra.hover ? { hover: { scope: `${tag}-mute`, underline: true } } : {}) }),
    Button({ key: `${tag}-set`, plain: true, label: '⚙️ הגדרות', onPress: press(`${tag}-set`), ...(extra.hover ? { hover: { scope: `${tag}-set`, underline: true } } : {}) }),
  ]
  kids.push(dim('א. כמו היום (בשורה צרה):'))
  kids.push(Box({ flexDirection: row, gap: 2, flexWrap: 'nowrap', height: 1, overflow: 'hidden', children: tb('a') }))
  kids.push(dim('ב. אותם כפתורים בלי שורה צרה:'))
  kids.push(Box({ flexDirection: row, gap: 2, flexWrap: 'nowrap', children: tb('b') }))
  kids.push(dim('ג. עם קו תחתון כשהעכבר עובר:'))
  kids.push(Box({ flexDirection: row, gap: 2, flexWrap: 'nowrap', children: tb('c', { hover: true }) }))
  kids.push(dim('ד. כפתור רגיל וכפתור ראשי:'))
  kids.push(Box({ flexDirection: row, gap: 2, flexWrap: 'nowrap', children: [
    Button({ key: 'd-plain-no', label: '⚙️ הגדרות', onPress: press('d-plain-no') }),
    Button({ key: 'd-primary', variant: 'primary', label: '☐ הצג שסיימו', onPress: press('d-primary') }),
  ] }))
  kids.push(dim(`לחיצות שנספרו: ${pressCount} · מלחיצה עד פעולה: ${last(inst.pressLat, 3)} ms`))

  // 4. a floating (absolute) card over rows: transparent, and on the theme's background ('inverseText')
  kids.push(head('4. כרטיס צף מעל שורות'))
  kids.push(Box({ flexDirection: row, gap: 2, flexWrap: 'nowrap', children: [
    Button({ key: 'floatA', plain: true, label: inst.floatA ? 'סגור את א' : 'א. פתח כרטיס צף', onPress: () => { inst.floatA = !inst.floatA; inst.floatB = false; bump(surface) } }),
    Button({ key: 'floatB', plain: true, label: inst.floatB ? 'סגור את ב' : 'ב. פתח עם רקע', onPress: () => { inst.floatB = !inst.floatB; inst.floatA = false; bump(surface) } }),
  ] }))
  const under = [1, 2, 3, 4, 5].map(i => line([Text({ children: [`שורה ${i} של כרטיס שמתחת`] })]))
  const floating = inst.floatA || inst.floatB
    ? [Box({
        position: 'absolute', top: 0, left: 0, width: '100%', height: 4, borderStyle: 'round', borderColor: CARD_BORDER,
        paddingX: 1, flexDirection: 'column', ...(inst.floatB ? { backgroundColor: 'inverseText' } : {}),
        children: [
          line([Text({ bold: true, children: ['כרטיס צף'] }), Button({ key: 'floatClose', plain: true, ...(inst.floatB ? { role: 'dismiss' } : {}), label: '✕ סגור', onPress: () => { inst.floatA = false; inst.floatB = false; bump(surface) } })], { justifyContent: 'space-between', width: '100%' }),
          dim('שום דבר מתחת לא אמור לזוז'),
        ],
      })]
    : []
  kids.push(Box({ key: 'floatArea', flexDirection: 'column', children: [...under, ...floating] }))

  // 5. a pin revealed by hovering the title (an absolute Box, display none until hovered)
  kids.push(head('5. נעץ שמופיע כשהעכבר על הכותרת'))
  kids.push(Box({ borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, flexDirection: 'column', children: [
    Box({ key: 'pinTitle', flexDirection: row, justifyContent: 'space-between', width: '100%', height: 1, children: [
      Text({ bold: true, children: ['    שיחת בדיקה'] }),
      Text({ dimColor: true, children: ['🟢4 ✅5'] }),
      Box({ position: 'absolute', top: 0, right: 0, display: 'none', hover: { display: 'flex' }, children: [Text({ dimColor: true, children: ['📌'] })] }),
    ] }),
  ] }))

  // 6. a press while the instance re-renders every 50 ms
  kids.push(head('6. לחיצה בזמן שהחלון מצייר את עצמו מחדש'))
  kids.push(Box({ flexDirection: row, gap: 2, flexWrap: 'nowrap', children: [
    Button({ key: 'fast', plain: true, label: inst.fast ? 'עצור ציור מהיר' : 'א. הפעל ציור מהיר', onPress: () => {
      inst.fast = !inst.fast
      if (inst.fast) inst.stopFast = surface.every(50, () => { inst.fastTicks++; bump(surface) })
      else if (inst.stopFast) { inst.stopFast(); inst.stopFast = null }
      bump(surface)
    } }),
    Button({ key: 'fastHit', plain: true, label: 'ב. לחץ עליי 10 פעמים', onPress: () => { inst.fastPresses++; bump(surface) } }),
    Button({ key: 'fastZero', plain: true, label: 'אפס', onPress: () => { inst.fastPresses = 0; bump(surface) } }),
  ] }))
  kids.push(dim(`נספרו: ${inst.fastPresses}`))

  // 7. the latency of the two paths, post to props in this module
  kids.push(head('7. מהירות תגובה'))
  const ping = (t: 'ping' | 'pingRender') => () => {
    const n = ++inst.pingN
    inst.sent[n] = now()
    surface.post({ t, t0: inst.sent[n]!, n })
  }
  kids.push(Box({ flexDirection: row, gap: 2, flexWrap: 'nowrap', children: [
    Button({ key: 'pingA', plain: true, label: 'א. תשובה ישירה', onPress: ping('ping') }),
    Button({ key: 'pingB', plain: true, label: 'ב. דרך ציור מחדש', onPress: ping('pingRender') }),
  ] }))
  kids.push(dim(`א: ${last(inst.answer, 5)} ms`))
  kids.push(dim(`ב: ${last(inst.render, 5)} ms`))

  // the report: one post the hooks log to the transcript
  kids.push(Box({ marginTop: 1, flexDirection: row, children: [
    Button({ key: 'report', variant: 'primary', label: 'בסוף: שלח תוצאות', onPress: () => {
      const r = {
        moves: inst.moves, enters: inst.enters, leaves: inst.leaves, downs: inst.downs, presses: inst.presses,
        pressLat: inst.pressLat.slice(-20), fastTicks: inst.fastTicks, fastPresses: inst.fastPresses,
        answer: inst.answer.slice(-20), render: inst.render.slice(-20), calls: inst.calls, hookRenders: props?.renders ?? -1,
        cols: surface.columns, rows: surface.rows,
      }
      surface.post({ t: 'report', text: JSON.stringify(r) })
    } }),
  ] }))

  return Box({ flexDirection: 'column', width: '100%', paddingX: 1, children: kids })
}

export default Probe
