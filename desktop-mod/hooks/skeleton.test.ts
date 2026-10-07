// Skeleton smoke tests: the pane draws on both surfaces, /theater is
// registered, and the live reducers keep their contract. Builders add
// scanner.test.ts (fixtures), live.test.ts and ui.test.ts beside this file.

import { expect, test } from 'claude-code/testing'

import { liveAgentReturned, liveSpawned, liveToolReturned, liveToolStarted } from './live'
import { PERSONA_EMOJI, personaIndex, shortTask } from './model'
import { PERSONAS_EN, PERSONAS_HE } from './personas'

test('the pane draws its header on the terminal and the desktop', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-theater',
      surface,
      component: 'Pane',
      requestId: 'agent-theater',
      props: { title: 'Theater', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /משרד הסוכנים/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/theater opens the pane and answers', async ($, on) => {
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  const { text } = await $.command.run({
    command: 'theater',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(text).toMatch(/התיאטרון|Theater/)
  expect(opened).toContain('agent-theater')
})

test('the cast is 48 wide in every table', async () => {
  expect(PERSONA_EMOJI.length).toBe(48)
  expect(PERSONAS_EN.length).toBe(48)
  expect(PERSONAS_HE.length).toBe(48)
  expect(personaIndex('agent-1')).toBeLessThan(48)
  expect(shortTask('Read the file. Then summarize it.')).toBe('Read the file.')
})

test('live reducers: spawn → tool → thinking → result', async () => {
  const spawn = { agentId: 'a1', tool_use_id: 't1', description: 'reader', subagentType: 'Explore', prompt: 'Read README.md', model: 'haiku' }
  let live = liveSpawned({}, spawn, 1000)
  expect(live.a1?.phase).toBe('thinking')
  live = liveToolStarted(live, 'a1', 'Read', 2000)
  expect(live.a1?.tool).toBe('Read')
  expect(live.a1?.phase).toBe('tool')
  live = liveToolReturned(live, 'a1', 3000)
  expect(live.a1?.phase).toBe('thinking')
  live = liveAgentReturned(live, 't1', 'done reading', false, 4000)
  expect(live.a1?.result).toBe('done reading')
  expect(live.a1?.end_ms).toBe(4000)
})
