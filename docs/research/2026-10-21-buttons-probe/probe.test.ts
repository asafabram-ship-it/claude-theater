import { expect, test } from 'claude-code/testing'

const PANE = { plugin: 'buttons-probe', component: 'Pane', requestId: 'buttons-probe', props: { title: 'T', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const

test('the probe mounts on the desktop, every section draws, the floats open, both pings come back', { timeoutMs: 30_000 }, async ($) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Client' }))?.key).toBe('probe')
  await ui.resize({ in: 'probe', columns: 50, rows: 60 })
  expect(await ui.find({ in: 'probe', type: 'Text', text: /בדיקת כפתורים/ })).toBeDefined()
  for (const key of ['a-done', 'b-mute', 'c-set', 'd-primary', 'floatA', 'floatB', 'fast', 'fastHit', 'pingA', 'pingB', 'report']) {
    expect(await ui.find({ in: 'probe', type: 'Button', key }), key).toBeDefined()
  }
  await ui.press({ in: 'probe', key: 'floatA' })
  expect(await ui.find({ in: 'probe', type: 'Button', key: 'floatClose' }), 'float A open').toBeDefined()
  await ui.press({ in: 'probe', key: 'floatB' })
  expect(await ui.find({ in: 'probe', type: 'Button', key: 'floatClose' }), 'float B open').toBeDefined()
  await ui.press({ in: 'probe', key: 'pingA' })
  await ui.press({ in: 'probe', key: 'pingB' })
  await ui.press({ in: 'probe', key: 'fast' })
  await ui.press({ in: 'probe', key: 'fastHit' })
  await ui.press({ in: 'probe', key: 'fast' })
  await ui.press({ in: 'probe', key: 'report' })
  expect(await ui.find({ in: 'probe', type: 'Text', text: /^נספרו: 1$/ })).toBeDefined()
})
