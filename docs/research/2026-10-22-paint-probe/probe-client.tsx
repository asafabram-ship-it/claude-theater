import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'

// The paint probe's surface module (see register.tsx), round 2. The first round's log said the pointer's y drifts
// upward with depth (a click on layout row 81 arrived as y 72; a floating Box at `top: 42` was painted at flow row
// ~47): the desktop lays some elements shorter than the engine's cell — the frames' border rows, most likely, drawn as
// a CSS border and not as a cell row — while the pointer, the scroll offset and an absolute `top` count the engine's
// cells. So this round (1) CALIBRATES: four labelled rows separated by a stack of frames, a stack of blank Boxes and a
// stack of Button rows, the received y of each click shown in the header; (2) drives every click through NATIVE
// Buttons (a row's name, the more line, the toolbar, the pin) whose hits the desktop takes from its own layout, never
// from the module's y; (3) keeps the hover underline, the hover pin, the speed paths and the floating drawer (at
// `top: offset`, the engine's cells — where the window's top is).

type Pong = { n: number; via: 'answer' | 'render' }
type P = { pong: Pong | null; offset: number; body: number; theme: string; height: number; scrolls: number; scrollOffset: number; contentRows: number; renders: number }
type Click = { x: number; y: number; offset: number }
type Inst = {
  calls: number; enters: number; leaves: number; moves: number; downs: number
  clicks: Click[]
  fButton: number; fKey: number
  names: number[]; more: number; toolbar: number
  pinA: boolean; pinB: boolean
  drawer: number | null; bg: number; drawerTop: number
  pingN: number; sent: Record<number, number>; lastPong: number; answer: number[]; render: number[]
  localAt: number; local: number[]
  winBase: number; same: number[]; control: number[]
  dirty: boolean; lastPost: number; props: P | null
}
type S = { inst: Inst; n: number }

const CARD_BORDER = '#56607a'
const LINK = 'suggestion'
const DRAWER_H = 10
const now = (): number => (typeof Date !== 'undefined' ? Date.now() : 0)
const last = (xs: number[], k = 5): string => (xs.length === 0 ? '-' : xs.slice(-k).join(' '))
const NAMES = ['🦉 הינשוף', '🩺 הרופאה', '🐺 הזאב', '🦊 השועל', '🐢 הצב', '🦅 הנשר']

function bump(surface: ClientSurface<S>): void {
  const s = surface.state
  if (s) surface.setState({ inst: s.inst, n: s.n + 1 })
}

function post(surface: ClientSurface<S>, inst: Inst, data: Record<string, string | number>): void {
  inst.lastPost = now()
  surface.post(data)
}

function report(surface: ClientSurface<S>, inst: Inst, props: P): void {
  inst.dirty = false
  const r = {
    calls: inst.calls, enters: inst.enters, leaves: inst.leaves, moves: inst.moves, downs: inst.downs, clicks: inst.clicks.slice(-8),
    fButton: inst.fButton, fKey: inst.fKey, names: inst.names, more: inst.more, toolbar: inst.toolbar, pinA: inst.pinA, pinB: inst.pinB,
    drawer: inst.drawer, bg: inst.bg, answer: inst.answer.slice(-20), render: inst.render.slice(-20), local: inst.local.slice(-20),
    same: inst.same.slice(-10), control: inst.control.slice(-10),
    cols: surface.columns, rows: surface.rows, offset: props.offset, body: props.body, theme: props.theme,
    scrolls: props.scrolls, scrollOffset: props.scrollOffset, contentRows: props.contentRows, renders: props.renders,
  }
  post(surface, inst, { t: 'report', text: JSON.stringify(r) })
}

/** A one-shot on the frame clock. */
function after(surface: ClientSurface<S>, ms: number, fn: () => void): void {
  const stop = surface.every(ms, () => { stop(); fn() })
}

const Probe: ClientModule<P, S> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  let s = surface.state
  if (s === undefined) {
    const inst: Inst = {
      calls: 0, enters: 0, leaves: 0, moves: 0, downs: 0, clicks: [], fButton: 0, fKey: 0, names: [0, 0, 0], more: 0, toolbar: 0,
      pinA: false, pinB: false, drawer: null, bg: 0, drawerTop: 0, pingN: 0, sent: {}, lastPong: -1, answer: [], render: [],
      localAt: 0, local: [], winBase: 0, same: [], control: [], dirty: false, lastPost: 0, props: null,
    }
    s = { inst, n: 0 }
    surface.setState(s)
    surface.onPointer(ev => {
      try {
        const cur = surface.state
        if (!cur) return
        const i = cur.inst
        i.dirty = true
        if (ev.type === 'move' && !ev.button) { i.moves++; return }
        if (ev.type === 'enter') { i.enters++; bump(surface); return }
        if (ev.type === 'leave') { i.leaves++; bump(surface); return }
        if (ev.type !== 'down' || ev.button !== 'left') return
        // every down is logged with the engine's y and the render offset then (THE CALIBRATION); nothing is hit by y
        i.downs++
        i.clicks.push({ x: ev.x, y: ev.y, offset: i.props?.offset ?? -1 })
        if (i.clicks.length > 8) i.clicks.splice(0, i.clicks.length - 8)
        bump(surface)
      } catch {
        // a listener never throws
      }
    })
    surface.onKey(ev => {
      try {
        const cur = surface.state
        if (!cur || ev.key !== 'f') return
        cur.inst.fKey++
        cur.inst.dirty = true
        bump(surface)
      } catch {
        // see above
      }
    })
    // the report reaches the log by itself: every 3 s while something changed and no post went in the last 1.5 s
    surface.every(3000, () => {
      const cur = surface.state
      if (cur && cur.inst.props && cur.inst.dirty && now() - cur.inst.lastPost > 1500) report(surface, cur.inst, cur.inst.props)
    })
  }
  const inst = s.inst
  inst.calls++
  inst.props = props

  // props arrival: the time from the post to this call, by path; a local setState's time to this call
  const pong = props?.pong
  if (pong && pong.n !== inst.lastPong) {
    inst.lastPong = pong.n
    const t0 = inst.sent[pong.n]
    if (t0 !== undefined) { (pong.via === 'answer' ? inst.answer : inst.render).push(now() - t0); inst.dirty = true }
  }
  if (inst.localAt > 0) { inst.local.push(now() - inst.localAt); inst.localAt = 0; inst.dirty = true }

  const row = 'row-reverse'
  const kids: RenderElement[] = []
  let y = 0
  const push = (el: RenderElement, h: number) => { kids.push(el); y += h }
  const line = (children: RenderElement[], extra: Record<string, unknown> = {}): RenderElement =>
    Box({ flexDirection: row, columnGap: 1, flexWrap: 'nowrap', height: 1, overflow: 'hidden', ...extra, children })
  const blank = () => push(Box({ height: 1 }), 1)
  const head = (t: string) => push(line([Text({ bold: true, children: [t] })]), 1)
  const dim = (t: string) => push(line([Text({ dimColor: true, children: [t] })]), 1)
  const plain = (key: string, label: string, onPress: () => void, extra: Record<string, unknown> = {}) =>
    Button({ key, plain: true, label, onPress, ...extra })
  const touch = (fn: () => void) => () => { fn(); inst.dirty = true; bump(surface) }

  // --- the header: what the pointer and the keys did; the clicks' engine rows ---
  push(line([
    Text({ bold: true, children: ['🔬 בדיקת ציור - סבב 2'] }),
    plain('report', 'שלח תוצאות 📤', () => report(surface, inst, props)),
  ], { justifyContent: 'space-between', width: '100%' }), 1)                                // y 0
  dim(`עכבר: כניסות ${inst.enters} · יציאות ${inst.leaves} · לחיצות ${inst.downs} · קריאות ${inst.calls}`)
  dim(`מקש f: כפתור ${inst.fButton} · מקלדת ${inst.fKey}`)
  dim(`לחיצות (y): ${inst.clicks.length === 0 ? '-' : inst.clicks.map(c => c.y).join(' ')}`)
  dim(`גלילה: ציור ${props.offset} · אירועים ${props.scrolls} · אחרון ${props.scrollOffset} · ציורים ${props.renders}`)   // y 4
  blank()                                                                                   // y 5

  // --- 1. THE CALIBRATION: four rows to click, each after a stack of one kind — the header's y list tells which kind
  //     the desktop lays shorter than a cell ---
  head('1. לחץ על א, ב, ג, ד לפי הסדר')                                                     // y 6
  push(line([Text({ color: 'warning', children: [`א. לחץ כאן (שורה ${y})`] })]), 1)          // y 7
  for (let k = 0; k < 6; k++) push(Box({ borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, children: [line([Text({ dimColor: true, children: [`מסגרת ${k + 1}`] })])] }), 3)   // y 8..25
  push(line([Text({ color: 'warning', children: [`ב. לחץ כאן (שורה ${y})`] })]), 1)          // y 26
  for (let k = 0; k < 6; k++) push(Box({ height: 1 }), 1)                                   // y 27..32
  push(line([Text({ color: 'warning', children: [`ג. לחץ כאן (שורה ${y})`] })]), 1)          // y 33
  for (let k = 0; k < 6; k++) push(line([plain(`stack${k}`, `כפתור ${k + 1}`, () => bump(surface))]), 1)   // y 34..39
  push(line([Text({ color: 'warning', children: [`ד. לחץ כאן (שורה ${y})`] })]), 1)          // y 40
  blank()

  // --- 2. rows whose NAME is a plain Button (the click the desktop takes by its own layout), a scoped underline across the
  //     row's cells, the more line and the toolbar as Buttons ---
  head('2. לחץ על שמות, על "עוד 3 שסיימו" ועל הכפתורים')                                      // y 42
  const rows = [['●', 0, 'Opus', '🤔', 'חושב'], ['●', 1, 'Sonnet', '✏️', 'כותבת'], ['○', 2, 'Sonnet', '✅', 'סיים']] as const
  const col = (pick: (r: typeof rows[number], i: number) => RenderElement) => Box({ flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0, paddingLeft: 1, children: rows.map(pick) })
  push(Box({ borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, flexDirection: 'column', children: [
    Box({ flexDirection: row, children: [
      col((r, i) => Text({ color: i === 2 ? 'inactive' : 'success', hover: { scope: `p-row-${i}`, underline: true }, children: [r[0]] })),
      col((r, i) => plain(`name${i}`, NAMES[r[1]]!, touch(() => { inst.names[i] = (inst.names[i] ?? 0) + 1 }), { hover: { scope: `p-row-${i}`, underline: true }, ...(i === 2 ? { dimColor: true } : {}) })),
      col((r, i) => Text({ dimColor: true, hover: { scope: `p-row-${i}`, underline: true }, children: [r[2]] })),
      col((r, i) => Text({ dimColor: i === 2, hover: { scope: `p-row-${i}`, underline: true }, children: [r[3]] })),
      col((r, i) => Text({ dimColor: i !== 0, hover: { scope: `p-row-${i}`, underline: true }, children: [r[4]] })),
    ] }),
    line([plain('more', 'עוד 3 שסיימו ◂', touch(() => { inst.more++ }), { hover: { scope: 'p-more', underline: true } })]),
  ] }), 6)                                                                                  // y 43..48
  push(Box({ flexDirection: row, gap: 2, flexWrap: 'nowrap', height: 1, overflow: 'hidden', children: [
    Button({ key: 'tbDone', hotkey: 'f', plain: true, label: 'הצג שסיימו ☐', hover: { scope: 'tb-done', underline: true }, onPress: touch(() => { inst.fButton++ }) }),
    Button({ key: 'tbMute', plain: true, label: 'צליל 🔔', hover: { scope: 'tb-mute', underline: true }, onPress: touch(() => { inst.toolbar++ }) }),
    Button({ key: 'tbSet', plain: true, label: 'הגדרות ⚙️', hover: { scope: 'tb-set', underline: true }, onPress: touch(() => { inst.toolbar++ }) }),
  ] }), 1)                                                                                  // y 49
  dim(`נספרו: שמות ${inst.names.join(' ')} · עוד ${inst.more} · כפתורים ${inst.toolbar}`)
  // THE ARROW (decision 24, to show Asaf): the four placements of the more line's arrow, and the open state's
  push(line([Text({ color: LINK, children: ['1. עוד 3 שסיימו ◂'] }), Text({ color: LINK, children: ['2. ◂ עוד 3 שסיימו'] })]), 1)
  push(line([Text({ color: LINK, children: ['3. עוד 3 שסיימו ▸'] }), Text({ color: LINK, children: ['4. ▸ עוד 3 שסיימו'] })]), 1)
  push(line([Text({ color: LINK, children: ['5. הסתר שסיימו ▾'] }), Text({ color: LINK, children: ['6. ▾ הסתר שסיימו'] })]), 1)
  blank()

  // --- 3. a hover 📌 that never moves the title — A beside the title (hover on the whole title line), B on the frame
  //     (hover on the pin's own cells); the 📌 is a Button: a press pins it (bright, same place) ---
  head('3. נעץ - הכותרת לא זזה')                                                           // y 52
  const pin = (key: string, on: boolean, flip: () => void) => plain(key, '📌', touch(flip), on ? {} : { dimColor: true })
  const card = (key: string, title: string, sub: string, extra: RenderElement[], titleExtra: RenderElement[]) => Box({
    key, flexDirection: 'column', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, paddingY: 1, marginBottom: 1, width: '100%', children: [
      Box({ key: `${key}-title`, flexDirection: row, justifyContent: 'space-between', width: '100%', height: 1, paddingX: 1, gap: 2, children: [
        Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, height: 1, overflow: 'hidden', justifyContent: 'flex-end', children: [Text({ bold: true, children: [title] })] }),
        Box({ flexShrink: 0, height: 1, children: [Text({ dimColor: true, children: ['🟢2 ✅1'] })] }),
        ...titleExtra,
      ] }),
      Box({ height: 1 }),
      line([Text({ dimColor: true, children: [sub] })]),
      ...extra,
    ],
  })
  const pinA = Box({ position: 'absolute', top: 0, right: -1, display: inst.pinA ? 'flex' : 'none', ...(inst.pinA ? {} : { hover: { display: 'flex' } }), children: [pin('pinA', inst.pinA, () => { inst.pinA = !inst.pinA })] })
  push(card('cardA', 'שיחה א - נעץ ליד הכותרת', 'עבור על הכותרת ולחץ על הנעץ', [], [pinA]), 8)   // y 53..60
  const pinB = Box({ key: 'pinZoneB', position: 'absolute', top: -1, right: 2, width: 2, height: 1, children: [
    inst.pinB ? pin('pinB', true, () => { inst.pinB = false }) : Box({ display: 'none', hover: { display: 'flex' }, children: [pin('pinB', false, () => { inst.pinB = true })] }),
  ] })
  push(card('cardB', 'שיחה ב - נעץ על המסגרת', 'עבור על המסגרת מעל הכותרת', [pinB], []), 8)    // y 61..68

  // --- 4. the speed of the paths, and the equal-props redraw ---
  head('4. מהירות')                                                                         // y 69
  const ping = (t: 'ping' | 'pingRender') => () => {
    const n = ++inst.pingN
    inst.sent[n] = now()
    post(surface, inst, { t, n })
  }
  const windowOf = (kind: 'same' | 'control') => () => {
    inst.winBase = inst.calls
    if (kind === 'same') post(surface, inst, { t: 'same' })
    after(surface, 1000, () => { (kind === 'same' ? inst.same : inst.control).push(inst.calls - inst.winBase); inst.dirty = true; bump(surface) })
  }
  push(Box({ flexDirection: row, gap: 2, flexWrap: 'nowrap', height: 1, overflow: 'hidden', children: [
    plain('pingA', 'א. תשובה', ping('ping')),
    plain('pingB', 'ב. ציור', ping('pingRender')),
    plain('local', 'ה. מקומי', () => { inst.localAt = now(); bump(surface) }),
  ] }), 1)                                                                                  // y 70
  push(Box({ flexDirection: row, gap: 2, flexWrap: 'nowrap', height: 1, overflow: 'hidden', children: [
    plain('same', 'ג. אותם נתונים', windowOf('same')),
    plain('control', 'ד. בקרה', windowOf('control')),
  ] }), 1)                                                                                  // y 71
  dim(`א. תשובה ישירה: ${last(inst.answer)} ms`)
  dim(`ב. ציור מחדש: ${last(inst.render)} ms`)
  dim(`ה. מקומי: ${last(inst.local)} ms`)
  dim(`ג. קריאות: ${last(inst.same)} · בקרה ${last(inst.control)}`)                         // y 75
  blank()

  // --- 5. the floating drawer: tall cards (the pane scrolls), a row's Button opens it at the window's top ---
  head('5. מגירה צפה - לחץ על שורה')                                                       // y 77
  dim('גלול למטה ולחץ שוב: המגירה בראש החלון')
  blank()                                                                                   // y 79
  for (let k = 0; k < 4; k++) {
    const lines: RenderElement[] = []
    for (let r = 0; r < 6; r++) {
      const idx = k * 6 + r
      lines.push(line([plain(`drow${idx}`, `${NAMES[r]} · שורה ${idx + 1}`, touch(() => { inst.drawer = inst.drawer === idx ? null : idx }), { hover: { scope: `d-row-${idx}`, underline: true } })]))
    }
    push(Box({ key: `dcard${k}`, flexDirection: 'column', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, marginBottom: 1, width: '100%', children: [
      line([Text({ bold: true, children: [`כרטיס ${k + 1}`] })]),
      ...lines,
    ] }), 10)                                                                               // y 80 + 10k
  }
  blank()
  blank()                                                                                   // y 120, 121

  // the drawer: absolute in the root at the window's top (the engine's cells, as the offset is), over the cards; its
  // background variant (the engine's `theme` row is the terminal's — the log said dark on a light pane — so a raw colour
  // is a guess either way; the theme key is the one background that follows the pane)
  const bgs: Array<[string, string | null]> = [
    ['א. בלי רקע', null],
    ['ב. inverseText', 'inverseText'],
    ['ג. בהיר קבוע', '#faf9f5'],
    ['ד. כהה קבוע', '#262624'],
  ]
  const [bgName, bg] = bgs[inst.bg % bgs.length]!
  const overlay: RenderElement[] = []
  if (inst.drawer !== null) {
    const idx = inst.drawer
    inst.drawerTop = props.offset
    overlay.push(Box({
      key: 'drawer', position: 'absolute', top: inst.drawerTop, left: 1, right: 1, height: DRAWER_H, flexDirection: 'column',
      borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, ...(bg ? { backgroundColor: bg } : {}),
      children: [
        line([
          Text({ bold: true, children: [`${NAMES[idx % 6]} · שורה ${idx + 1}`] }),
          Button({ key: 'close', plain: true, role: 'dismiss', label: 'סגירה ✕', onPress: touch(() => { inst.drawer = null }) }),
        ], { justifyContent: 'space-between', width: '100%' }),
        line([Text({ dimColor: true, children: ['● עובד · זמן 4 דק׳ · Explore'] })]),
        Box({ height: 1 }),
        line([plain('bg', `רקע: ${bgName}`, touch(() => { inst.bg++ }))]),
        Box({ height: 1 }),
        line([Text({ children: ['שום דבר מתחת לא אמור לזוז'] })]),
        line([Text({ children: ['לחיצה על שורה מתחת למגירה לא עושה כלום'] })]),
        line([Text({ dimColor: true, children: [`ציור ${props.offset} · אירועים ${props.scrolls} · אחרון ${props.scrollOffset}`] })]),
      ],
    }))
  }

  return Box({ key: 'root', flexDirection: 'column', width: '100%', height: props.height, paddingX: 1, children: [...kids, ...overlay] })
}

export default Probe
