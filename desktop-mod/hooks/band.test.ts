// The band above the prompt: a way into the office without a slash command.

import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'agent-theater', component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

test('the band shows only while this conversation has working subagents and the pane is closed', async ($, on) => {
  let paneShown = false
  mock.clock(on, { now: 1_000_000 })
  const opened: string[] = []
  on('ui.open', ($, e) => { opened.push(e.id); return { value: { isPlaced: true as const } } })
  // the engine's own band beneath: nothing of its own to show
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'engine-band' }) as RenderElement
  })
  on('ui.panes', () => ({ value: paneShown ? [{ id: 'agent-theater', title: 'T', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  // the engine starts each subagent beneath: its id is the tool_use_id here
  on('agent.spawn', ($, e) => ({ model: 'haiku', agentId: `ag-${e.tool_use_id}` }))

  // nothing spawned yet: no band
  const empty = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await empty.find({ key: 'open-theater' })).toBeUndefined()
  await empty.unmount()

  // two subagents start (the live map is the module's memory, filled by agent.spawn: no $.state write)
  for (const id of ['t1', 't2']) {
    await $.agent.spawn({ tool_use_id: id, prompt: 'Read it.', description: `desc ${id}`, subagentType: 'Explore', parentModel: 'opus' } as Parameters<typeof $.agent.spawn>[0])
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    paneShown = false
    let ui = await $.ui.mount({ ...BAND, surface })
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
