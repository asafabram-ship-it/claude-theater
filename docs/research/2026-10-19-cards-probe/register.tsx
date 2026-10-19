import type { Register } from 'claude-code'

// Throwaway probe (19.10), round 7 (Asaf: no time column — the time lives in the drawer; badges ride the status column). Round 6 (Asaf on round 5: 'הצג שסיימו', '⚙️ הגדרות' instead of help; the time column fell off at 51 cols — tighter cell padding). Round 5 (Asaf on round 4: no dark selection band; the activity column vanished — it must not shrink; a long title wrapped to two lines — one line, cut). Round 4: fixed cell widths clipped the text (the desktop draws its text wider
// than the cell metric). Column-major layout instead: each field is a vertical Box sized by its widest
// value, the columns side by side (row-reverse for RTL) — rows align because every value is one line.
// Variant 2 (Asaf's pick): a framed card, a rule under the title, gaps between columns.
const PANE = 'cards-probe'
type Row = { dot: string; dotColor: string; emoji: string; name: string; model: string; act: string; time: string; dim?: boolean; sel?: boolean }
const ROOMS: { title: string; counts: string; rows: Row[]; more: string }[] = [
  { title: 'תיאטרון הסוכנים', counts: '🟢3 ⏳1 ✅2', more: '▸ עוד 2 שסיימו', rows: [
    { dot: '●', dotColor: '#3fb950', emoji: '🦉', name: 'הינשוף', model: 'Opus', act: '🤔 חושב', time: '⏱️ 3′' },
    { dot: '●', dotColor: '#3fb950', emoji: '🩺', name: 'הרופא', model: 'Sonnet', act: '✏️ עורך', time: '⏱️ 1′' },
    { dot: '●', dotColor: '#3fb950', emoji: '🤖', name: 'הרובוט', model: 'Sonnet', act: '🔌 github', time: '⏱️ 12′' },
    { dot: '●', dotColor: '#d29922', emoji: '🐺', name: 'הזאב', model: 'Haiku', act: '💤 ממתין', time: '⏱️ 40′' },
    { dot: '⭐', dotColor: '#8b949e', emoji: '🔧', name: 'המכונאי', model: 'Opus', act: '✅ סיים', time: '', dim: true },
  ] },
  { title: 'Plan the static-registry move and the v2 config rollout', counts: '🟢1 ✅1', more: '', rows: [
    { dot: '●', dotColor: '#3fb950', emoji: '✍️', name: 'הסופר', model: 'Fable', act: '📖 קורא', time: '⏱️ 2′' },
    { dot: '○', dotColor: '#8b949e', emoji: '🗺️', name: 'הקרטוגרף', model: 'Fable', act: '✅ סיים', time: '', dim: true },
  ] },
  { title: 'בדיקת תיאטרון הסוכנים בשיחה חדשה עם כמה סוכני משנה במקביל', counts: '🟢2', more: '', rows: [
    { dot: '●', dotColor: '#3fb950', emoji: '🐬', name: 'הדולפין', model: 'Haiku', act: '🔎 מחפש קוד', time: '⏱️ <1′' },
    { dot: '●', dotColor: '#3fb950', emoji: '🕵️', name: 'הבלש', model: 'Haiku', act: '📖 קורא', time: '⏱️ 1′' },
  ] },
]
const SEL_BG = '#2a3150'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cards-probe', description: 'Open the cards probe pane' })
    void $.ui.open({ id: PANE, title: 'בדיקת כרטיסים' })
    return next(e)
  })
  on('command.run', { command: 'cards-probe' }, async $ => {
    await $.ui.open({ id: PANE, title: 'בדיקת כרטיסים' })
    return { text: 'opened' }
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const cols = e.viewport?.columns ?? 40
    // one column: every row's value for one field, one line each, aligned to the reading edge
    const column = (rows: Row[], pick: (r: Row) => string, style: (r: Row) => Record<string, unknown>, grow = false) => (
      <Box flexDirection="column" alignItems="flex-end" flexShrink={0} flexGrow={grow ? 1 : 0}>
        {rows.map(r => <Box height={1} paddingLeft={1} width="100%" justifyContent="flex-end" {...(r.sel ? { backgroundColor: SEL_BG } : {})}><Text {...style(r)}>{pick(r) || ' '}</Text></Box>)}
      </Box>
    )
    const table = (rows: Row[]) => (
      <Box flexDirection="row-reverse" width="100%">
        {column(rows, r => r.dot, r => ({ color: r.dotColor }))}
        {column(rows, r => `${r.emoji} ${r.name}`, r => ({ bold: !r.dim, dimColor: r.dim }))}
        {column(rows, r => r.model, () => ({ dimColor: true }))}
        {column(rows, r => r.act, r => ({ dimColor: r.dim }), true)}
      </Box>
    )
    // a one-line title: cut conservatively (the desktop draws letters wider than a cell), whole words, an ellipsis
    const cutTitle = (t: string) => {
      const max = Math.max(8, Math.floor((cols - 18) * 0.7))
      if (t.length <= max) return t
      const head = t.slice(0, max)
      const sp = head.lastIndexOf(' ')
      return `${(sp > max / 2 ? head.slice(0, sp) : head).trimEnd()}…`
    }
    const rule = <Box height={1} overflow="hidden" width="100%"><Text dimColor>{'─'.repeat(Math.max(4, cols))}</Text></Box>
    return (
      <Box flexDirection="column" width="100%">
        <Box flexDirection="row-reverse" justifyContent="space-between" width="100%" marginBottom={1}>
          <Text bold>🎭 עובדים 4 · ממתינים 1 · סיימו 3</Text><Text dimColor>⏳ 5h 6%</Text>
        </Box>
        <Box flexDirection="row-reverse" gap={2}>
          <Button plain label="הצג שסיימו ☐" onPress={() => {}} />
          <Button plain label="צליל 🔔" onPress={() => {}} />
          <Button plain label="הגדרות ⚙️" onPress={() => {}} />
        </Box>
        <Box flexDirection="row-reverse" marginTop={1} marginBottom={1}><Text dimColor>חיפוש סוכנים 🔍</Text></Box>
        {ROOMS.map(room => (
          <Box flexDirection="column" borderStyle="round" borderColor="#56607a" paddingX={1} paddingY={1} marginBottom={1} width="100%">
            <Box flexDirection="row-reverse" justifyContent="space-between" width="100%" height={1} paddingX={1} gap={2}>
              <Box flexShrink={1} minWidth={0} height={1} overflow="hidden" justifyContent="flex-end"><Text bold>{cutTitle(room.title)}</Text></Box>
              <Box flexShrink={0} height={1}><Text dimColor>{room.counts}</Text></Box>
            </Box>
            {rule}
            {table(room.rows)}
            {room.more !== '' && <Box flexDirection="row-reverse" marginTop={1} paddingX={1}><Text dimColor>{room.more}</Text></Box>}
          </Box>
        ))}
        <Text dimColor>columns={String(cols)} (סבב 7: בלי עמודת זמן; ⭐ לסוכן שסיים עכשיו)</Text>
      </Box>
    )
  })
}
