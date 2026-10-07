// i18n.ts: the model display helper (the string tables are exercised through ui.test.ts).

import { expect, test } from 'claude-code/testing'

import { modelLabel } from './i18n'

test('modelLabel: short human names for the known families', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
  expect(modelLabel('claude-opus-4-1-20250805')).toBe('Opus 4.1')
  expect(modelLabel('claude-3-7-sonnet-20250219')).toBe('3-7-sonnet') // older naming: raw id, prefix and date stripped
})

test('modelLabel: the engine aliases, unknown ids and the empty string', () => {
  expect(modelLabel('opus')).toBe('Opus')
  expect(modelLabel('haiku')).toBe('Haiku')
  expect(modelLabel('claude-nova-6-0')).toBe('nova-6-0') // unknown family: raw id without the prefix
  expect(modelLabel('claude-nova-6-0-20270101')).toBe('nova-6-0') // ...and without the date suffix
  expect(modelLabel('us.anthropic.claude-opus-5-5-v1:0')).toBe('us.anthropic.claude-opus-5-5-v1:0') // not our pattern: untouched
  expect(modelLabel('  ')).toBe('')
  expect(modelLabel('')).toBe('')
})
