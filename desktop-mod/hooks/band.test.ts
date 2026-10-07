// The band above the prompt: a way into the office without a slash command.

import type { RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'agent-theater', component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

function liveAgent(id: string, engine_status: string) {
  return {
    id, description: `desc ${id}`, subagent_type: 'Explore', model: 'haiku', task: 'Read it.',
    engine_status, phase: 'thinking', tool: '', start_ms: 0, last_ms: 0, end_ms: null,
    result: null, truncated: false, tool_use_id: `t-${id}`,
  }
}

test('the band shows only while this conversation has working subagents and the pane is closed', async ($, on) => {
  let live: Record<string, unknown> = {}
  let paneShown = false
  let version = 0
  const opened: string[] = []
  on('ui.open', ($, e) => { opened.push(e.id); return { value: { isPlaced: true as const } } })
  // the engine's own band beneath: nothing of its own to show
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'engine-band' }) as RenderElement
  })
  on('ui.panes', () => ({ value: paneShown ? [{ id: 'agent-theater', title: 'T', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('state.get', { plugin: 'agent-theater', key: 'live' }, () => ({ value: { value: live, version: ++version } }))

  for (const surface of ['terminal', 'desktop'] as const) {
    live = {}
    paneShown = false
    let ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'open-theater' })).toBeUndefined()
    await ui.unmount()

    live = { a1: liveAgent('a1', 'running'), a2: liveAgent('a2', 'running'), a3: liveAgent('a3', 'completed') }
    ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ key: 'open-theater' }))?.text).toMatch(/🎭 התיאטרון · 2 עובדים/)
    await ui.press({ key: 'open-theater' })
    expect(opened.at(-1)).toBe('agent-theater')
    await ui.unmount()

    paneShown = true
    ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'open-theater' })).toBeUndefined()
    await ui.unmount()
  }
})
