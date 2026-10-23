// Probe hooks: /theater-probe opens the pane; a 2 s timer changes props; ui.scroll is answered
// without next (own offset); ui.message logs; ui.fault logs; SessionMode gets a test label.
import type { EngineInterface, Register } from 'claude-code'

const PANE = 'theater-probe'
const OVERFLOW_ROWS = 20
let seq = 0
let hot = 0
let offset = 0
let contentRows = 10
let faults = 0
let redrawPending = false
let lastRows = 20
let lastColumns = 60

// Log: each line is stamped at call time (ISO time + a monotonic #n), the path is resolved once,
// lines are buffered and flushed at most every 250 ms through one promise chain (so the file's
// order is call order), and the file's text is read once and kept, so a flush is one write.
let logSeq = 0
let logPath: Promise<string> | undefined
let logText: string | undefined
let logPending = ''
let logFlushPending = false
let logTail: Promise<void> = Promise.resolve()

async function resolveLogPath($: EngineInterface): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return `${home}/.claude/theater-probe.log`
}

function log($: EngineInterface, line: string): void {
  logSeq += 1
  logPending += `${new Date().toISOString()} #${logSeq} ${line}\n`
  if (!logPath) logPath = resolveLogPath($)
  if (logFlushPending) return
  logFlushPending = true
  try {
    $.clock.after(250, () => {
      logFlushPending = false
      const batch = logPending
      logPending = ''
      if (!batch) return
      logTail = logTail
        .then(async () => {
          const path = await (logPath ?? resolveLogPath($))
          const old = logText ?? ((await $.fs.exists(path)) ? await $.fs.read(path) : '')
          const text = `${old}${batch}`.slice(-200_000)
          await $.fs.write(path, text)
          logText = text
        })
        .catch(() => undefined)
    })
  } catch {
    logFlushPending = false // probe only
  }
}

function requestRedraw($: EngineInterface): void {
  if (redrawPending) return
  redrawPending = true
  $.clock.after(100, () => {
    redrawPending = false
    log($, `invalidate seq=${seq} hot=${hot} offset=${offset}`)
    $.ui.invalidate('ui.render')
  })
}

let opened = false
let statusSet = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'theater-probe', description: 'Open the Client probe pane', immediate: true })
      .then(() => log($, 'command registered'), err => log($, `command register failed: ${String(err)}`))
    // Fallback opener #2: open the pane on load (hot reload re-runs session.start); the typed
    // slash command carried bidi marks and the band's button did not show.
    if (!opened) {
      await $.ui.open({ id: PANE, title: 'probe' }).then(
        () => { opened = true; log($, 'opened (session.start)') },
        err => log($, `open failed: ${String(err)}`))
    }
    $.clock.every(2000, () => {
      seq += 1
      hot = (hot + 7) % 100
      requestRedraw($)
      // Test 7 fallback (c): the status line — where does the desktop draw $.ui.status?
      if (!statusSet) {
        statusSet = true
        try { $.ui.status('⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30 (status)'); log($, 'status set') } catch (err) { log($, `status failed: ${String(err)}`) }
      }
    })
    return next(e)
  })
  on('command.run', { command: 'theater-probe' }, async $ => {
    await $.ui.open({ id: PANE, title: 'probe' })
    opened = true
    log($,'opened')
    return { text: 'theater-probe: pane opened; log at ~/.claude/theater-probe.log' }
  })
  // Fallback opener #3: a typed prompt that names the probe (bidi marks stripped) opens the pane
  // as an "asked" open (placed at any width) and is dropped before it reaches the model.
  on('prompt.submit', async ($, e, next) => {
    const clean = e.text.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim()
    if (!/^\/?theater-probe$/.test(clean)) return next(e)
    await $.ui.open({ id: PANE, title: 'probe' }).then(
      () => { opened = true; log($, 'opened (prompt)') },
      err => log($, `open failed (prompt): ${String(err)}`))
    return { drop: 'theater-probe: pane opened (log at ~/.claude/theater-probe.log)' }
  })
  // Fallback opener: a band above the prompt with one Button (the typed slash command was not
  // reaching the engine because the input carried bidi marks before the '/').
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (opened) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return Box({ children: [
      Text({ dimColor: true, children: ['theater-probe: '] }),
      Button({ key: 'open-probe', label: 'Open probe pane', onPress: async () => {
        await $.ui.open({ id: PANE, title: 'probe' })
        opened = true
        log($,'opened (button)')
        $.ui.invalidate('ui.render')
      } }),
    ] })
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    log($,`render seq=${seq} offset=${offset} scroll=${e.props.scroll?.offset ?? '-'} cols=${e.props.bodyColumns} rows=${e.props.scroll?.bodyRows ?? '-'}`)
    lastRows = e.props.scroll?.bodyRows ?? 20
    lastColumns = e.props.bodyColumns ?? 60
    if (e.surface === 'desktop' && 'Client' in els) {
      const { Client } = els
      return Box({ flexDirection: 'column', children: [
        // Taller than the body on purpose (test 2): with no overflow the engine never raises ui.scroll.
        Client({ key: 'probe', module: './probe-client.tsx', width: e.props.bodyColumns, height: (e.props.scroll?.bodyRows ?? 20) + OVERFLOW_ROWS,
          props: { seq, offset, hot, rows: e.props.scroll?.bodyRows ?? 20, columns: e.props.bodyColumns ?? 60 } }),
      ] })
    }
    return Text({ children: [`probe (no Client on ${e.surface}) seq=${seq}`] })
  })
  on('ui.scroll', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    // Variant B (test 2, third attempt): let the ENGINE scroll natively over the tall Client.
    // Variant A (own window, `{}` without next) made the desktop jump down and back on every tick.
    log($,`scroll(native) by=${e.by} engine offset=${e.offset} content=${e.contentRows} body=${e.bodyRows}`)
    return next(e)
  })
  on('ui.message', { element: 'probe' }, async ($, e) => {
    const d = e.data as { t?: string; line?: string }
    log($,`message ${d.t ?? '?'} ${d.line ?? ''}`)
    if (d.t === 'press') {
      // answer with new props and NO ui.render: the drawing must change (seq jumps by 100)
      seq += 100
      return { props: { seq, offset, hot, rows: lastRows, columns: lastColumns } }
    }
    return {}
  })
  on('ui.fault', async ($, e, next) => {
    faults += 1
    log($,`FAULT #${faults} phase=${e.phase} reason=${e.reason}`)
    return next(e)
  })
  on('ui.render', { component: 'SessionMode' }, ($, e, next) => {
    log($, `SessionMode render surface=${e.surface} modes=${JSON.stringify(e.props.modes)}`)
    return next({ ...e, props: { ...e.props, modes: ['⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30', ...e.props.modes] } })
  })
  // Test 7 fallback (a): the hint line under the prompt — does the desktop draw a rewritten hint?
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    log($, `PromptHint render surface=${e.surface} hint=${JSON.stringify(e.props.hint)}`)
    return next({ ...e, props: { ...e.props, hint: `⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42% · 14:30 (hint) · ${e.props.hint}` } })
  })
}
