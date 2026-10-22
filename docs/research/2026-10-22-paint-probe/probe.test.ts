import { expect, test } from 'claude-code/testing'

const PANE = { plugin: 'paint-probe', component: 'Pane', requestId: 'paint-probe', props: { title: 'T', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const

test('round 2: every control is a Button - names, more line, toolbar, pins, drawer rows; the clicks are logged; the pings count', { timeoutMs: 30_000 }, async ($) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Client' }))?.key).toBe('probe')
  await ui.resize({ in: 'probe', columns: 50, rows: 125 })
  expect(await ui.find({ in: 'probe', type: 'Text', text: /סבב 2/ })).toBeDefined()
  for (const key of ['report', 'name0', 'name2', 'more', 'tbDone', 'tbMute', 'tbSet', 'pinA', 'pingA', 'pingB', 'local', 'same', 'control', 'drow0', 'drow23']) {
    expect(await ui.find({ in: 'probe', type: 'Button', key }), key).toBeDefined()
  }
  await ui.press({ in: 'probe', key: 'drow23' })
  expect(await ui.find({ in: 'probe', type: 'Button', key: 'close' }), 'drawer open').toBeDefined()
  expect(await ui.find({ in: 'probe', type: 'Text', text: /שורה 24/ })).toBeDefined()
  await ui.press({ in: 'probe', key: 'bg' })
  await ui.press({ in: 'probe', key: 'close' })
  expect(await ui.find({ in: 'probe', type: 'Button', key: 'close' }), 'drawer closed').toBeUndefined()
  await ui.press({ in: 'probe', key: 'name1' })
  await ui.press({ in: 'probe', key: 'more' })
  await ui.press({ in: 'probe', key: 'pinA' })
  await ui.pointer({ in: 'probe', type: 'down', x: 20, y: 7, button: 'left' })
  await ui.pointer({ in: 'probe', type: 'down', x: 20, y: 26, button: 'left' })
  await ui.key({ in: 'probe', key: 'f' })
  await ui.pointer({ in: 'probe', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ in: 'probe', type: 'Text', text: /לחיצות \(y\): 7 26/ })).toBeDefined()
  expect(await ui.find({ in: 'probe', type: 'Text', text: /שמות 0 1 0 · עוד 1/ })).toBeDefined()
  expect(await ui.find({ in: 'probe', type: 'Text', text: /מקלדת 1/ })).toBeDefined()
  await ui.press({ in: 'probe', key: 'pingA' })
  await ui.press({ in: 'probe', key: 'pingB' })
  await ui.press({ in: 'probe', key: 'report' })
})
