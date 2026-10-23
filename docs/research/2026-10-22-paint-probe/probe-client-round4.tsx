import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'

// The paint probe's surface module (see register.tsx), round 4: STATIC — one screenshot at rest answers everything, no
// click or hover needed (Asaf: "do it all yourself"; the desktop pane cannot be driven from here, so the probe shows
// every state side by side). Round 3 found: an absolute Box is placed against the ROOT, not its parent (the swatches
// drawn in a mid-pane Box landed at the pane's top); a plain Button's Text child keeps bold and dim but LOSES its colour
// (the status marks and the link-coloured more line drew black); `inverseText` is the background that hides the rows
// and follows the theme (ב); the dim 📌 looked as bright as the bright one. So this round shows: (A) the pin's states
// and the unpinned alternatives, as Buttons and as Texts; (B) which Text styles survive inside a plain Button;
// (C) the more line's candidates; (D) the row in its final form (the mark a coloured Text, the rest Buttons);
// (E) a static overlay with the ב background over two cards.

type P = { pong: { n: number; via: string } | null; offset: number; body: number; theme: string; height: number; scrolls: number; scrollOffset: number; contentRows: number; renders: number }
type Inst = { calls: number; props: P | null; dirty: boolean; lastPost: number; presses: Record<string, number> }
type S = { inst: Inst; n: number }

const CARD_BORDER = '#56607a'
const LINK = 'suggestion'
const now = (): number => (typeof Date !== 'undefined' ? Date.now() : 0)

function bump(surface: ClientSurface<S>): void {
  const s = surface.state
  if (s) surface.setState({ inst: s.inst, n: s.n + 1 })
}

const Probe: ClientModule<P, S> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  let s = surface.state
  if (s === undefined) {
    const inst: Inst = { calls: 0, props: null, dirty: false, lastPost: 0, presses: {} }
    s = { inst, n: 0 }
    surface.setState(s)
    surface.every(3000, () => {
      const cur = surface.state
      if (!cur || !cur.inst.dirty || now() - cur.inst.lastPost < 1500) return
      cur.inst.dirty = false
      cur.inst.lastPost = now()
      surface.post({ t: 'report', text: JSON.stringify({ round: 4, calls: cur.inst.calls, presses: cur.inst.presses, cols: surface.columns, rows: surface.rows, offset: props.offset }) })
    })
  }
  const inst = s.inst
  inst.calls++
  inst.props = props

  const row = 'row-reverse'
  const kids: RenderElement[] = []
  const line = (children: RenderElement[], extra: Record<string, unknown> = {}): RenderElement =>
    Box({ flexDirection: row, columnGap: 2, flexWrap: 'nowrap', height: 1, overflow: 'hidden', ...extra, children })
  const blank = () => kids.push(Box({ height: 1 }))
  const head = (t: string) => kids.push(line([Text({ bold: true, children: [t] })]))
  const dim = (t: string) => kids.push(line([Text({ dimColor: true, children: [t] })]))
  const press = (key: string) => () => { inst.presses[key] = (inst.presses[key] ?? 0) + 1; inst.dirty = true; bump(surface) }
  /** A plain Button whose label is a styled Text child. */
  const bt = (key: string, text: string, style: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    Button({ key, plain: true, onPress: press(key), ...extra, children: [Text({ ...style, children: [text] })] })
  const tx = (text: string, style: Record<string, unknown> = {}) => Text({ ...style, children: [text] })

  kids.push(line([tx('🔬 בדיקת ציור - סבב 4 (צילום אחד, בלי ללחוץ)', { bold: true })]))
  blank()

  // --- A. the pin: dim vs bright, as a Button and as a Text; the unpinned alternatives ---
  head('א. נעץ: עמום מול בהיר (כפתור | טקסט), וחלופות לנעץ לא נעוץ')
  kids.push(line([tx('1'), bt('pinDim', '📌', { dimColor: true }), bt('pinOn', '📌', {}), tx('|', { dimColor: true }), tx('📌', { dimColor: true }), tx('📌')]))
  kids.push(line([tx('2'), bt('p2a', '📌︎', { dimColor: true }), bt('p2b', '📌', {}), tx('|', { dimColor: true }), tx('📌︎', { dimColor: true }), tx('📌')]))
  kids.push(line([tx('3'), bt('p3a', '🖈', { dimColor: true }), bt('p3b', '📌', {}), tx('|', { dimColor: true }), tx('🖈', { dimColor: true }), tx('📌')]))
  kids.push(line([tx('4'), bt('p4a', '⊹', { dimColor: true }), bt('p4b', '📌', {}), tx('|', { dimColor: true }), tx('⊹', { dimColor: true }), tx('📌')]))
  kids.push(line([tx('5'), bt('p5a', '○', { dimColor: true }), bt('p5b', '📌', {}), tx('|', { dimColor: true }), tx('○', { dimColor: true }), tx('📌')]))
  dim('בכל שורה: משמאל לקו - כפתורים, מימין - טקסט; הראשון "לא נעוץ", השני "נעוץ"')
  blank()

  // --- B. which Text styles survive inside a plain Button (left: in a Button; right: the same Text alone) ---
  head('ב. עיצוב בתוך כפתור (שמאל) מול טקסט רגיל (ימין)')
  const styles: Array<[string, string, Record<string, unknown>]> = [
    ['מודגש', 'bold', { bold: true }], ['עמום', 'dim', { dimColor: true }], ['קו תחתון', 'underline', { underline: true }],
    ['נטוי', 'italic', { italic: true }], ['צבע קישור', 'link', { color: LINK }], ['ירוק', 'green', { color: 'success' }], ['אדום', 'red', { color: 'error' }],
  ]
  for (const [label, key, style] of styles) kids.push(line([tx(label, { dimColor: true }), bt(`st-${key}`, `כפתור ${label}`, style), tx('|', { dimColor: true }), tx(`טקסט ${label}`, style)]))
  blank()

  // --- C. the more line's candidates ---
  head('ג. שורת "עוד 3 שסיימו" - איזו נראית לחיצה?')
  kids.push(line([tx('1', { dimColor: true }), bt('m1', 'עוד 3 שסיימו ◂', { underline: true })]))
  kids.push(line([tx('2', { dimColor: true }), bt('m2', 'עוד 3 שסיימו ◂', {})]))
  kids.push(line([tx('3', { dimColor: true }), bt('m3', 'עוד 3 שסיימו ◂', { dimColor: true })]))
  kids.push(line([tx('4', { dimColor: true }), bt('m4', 'עוד 3 שסיימו ◂', { bold: true })]))
  kids.push(line([tx('5', { dimColor: true }), tx('עוד 3 שסיימו ◂', { color: LINK }), tx('(טקסט, לא כפתור - להשוואה)', { dimColor: true })]))
  blank()

  // --- D. the row's final form: the mark a coloured Text, the other cells plain Buttons with styled children ---
  head('ד. שורות: הסימן טקסט צבעוני, השאר כפתורים')
  const rows = [['●', 'success', '🦉 הינשוף', 'Opus', '🤔', 'חושב', true, false], ['●', 'warning', '🩺 הרופאה', 'Sonnet', '✏️', 'כותבת', false, false], ['○', 'inactive', '🐺 הזאב', 'Sonnet', '✅', 'סיים', false, true]] as const
  const col = (pick: (r: typeof rows[number], i: number) => RenderElement) => Box({ flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0, paddingLeft: 1, children: rows.map(pick) })
  kids.push(Box({ borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, flexDirection: 'column', children: [
    Box({ flexDirection: row, justifyContent: 'space-between', width: '100%', height: 1, paddingX: 1, gap: 2, children: [
      Box({ flexDirection: row, gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0, height: 1, overflow: 'hidden', children: [bt('pinD', '📌', { dimColor: true }), tx('שיחת בדיקה - הכותרת', { bold: true })] }),
      Box({ flexShrink: 0, height: 1, children: [tx('🟢2 ✅1', { dimColor: true })] }),
    ] }),
    Box({ height: 1 }),
    Box({ flexDirection: row, children: [
      col((r, i) => tx(r[0], { color: r[1] })),
      col((r, i) => bt(`d-name${i}`, r[2], { bold: r[6], dimColor: r[7] })),
      col((r, i) => bt(`d-model${i}`, r[3], { dimColor: true })),
      col((r, i) => bt(`d-emoji${i}`, r[4], { dimColor: r[7] })),
      col((r, i) => bt(`d-word${i}`, r[5], { dimColor: !r[6] })),
    ] }),
    line([bt('d-more', 'עוד 3 שסיימו ◂', { underline: true })]),
  ] }))
  blank()

  // --- E. a static overlay (ב: inverseText) over two cards — root-relative `top`, so it lands a little below its row ---
  head('ה. מגירה צפה עם רקע ב מעל שני כרטיסים')
  const cardTop = kids.length + 1
  for (let k = 0; k < 2; k++) {
    kids.push(Box({ key: `dcard${k}`, flexDirection: 'column', borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, marginBottom: 1, width: '100%', children: [
      line([tx(`כרטיס ${k + 1}`, { bold: true })]),
      ...[0, 1, 2, 3].map(r => line([bt(`drow${k}${r}`, `🦉 סוכן ${k * 4 + r + 1} · שורה ${k * 4 + r + 1}`, {})])),
    ] }))
  }
  const overlay = Box({
    key: 'drawer', position: 'absolute', top: cardTop + 2, left: 1, right: 1, height: 8, flexDirection: 'column',
    borderStyle: 'round', borderColor: CARD_BORDER, paddingX: 1, backgroundColor: 'inverseText',
    children: [
      line([tx('🦉 הינשוף · המגירה', { bold: true }), Button({ key: 'close', plain: true, role: 'dismiss', label: 'סגירה ✕', onPress: press('close') })], { justifyContent: 'space-between', width: '100%' }),
      line([tx('● עובד · זמן 4 דק׳ · Explore', { dimColor: true })]),
      Box({ height: 1 }),
      line([tx('המשימה: לבדוק שהרקע מסתיר את השורות שמתחת')]),
      line([tx('והטקסט נקרא כמו בכרטיסים')]),
      line([tx('(הסגירה לא עובדת בסבב הזה - זה צילום סטטי)', { dimColor: true })]),
    ],
  })

  return Box({ key: 'root', flexDirection: 'column', width: '100%', height: props.height, paddingX: 1, children: [...kids, overlay] })
}

export default Probe
