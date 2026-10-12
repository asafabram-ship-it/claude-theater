// office-svg.ts: the pure tokens left of the desktop's SVG office — the tool
// family each card is coloured by (office-props.ts `fam`). The SVG drawing and
// its tests went with Task 2.6 (the desktop pane is the office Client).

import { expect, test } from 'claude-code/testing'

import { toolFamily } from './office-svg'

test('tool families colour the monitor: search / read / write / cmd / agent (MCP too), unknown none', () => {
  expect(toolFamily('Grep')).toBe('search')
  expect(toolFamily('WebFetch')).toBe('read')
  expect(toolFamily('MultiEdit')).toBe('write')
  expect(toolFamily('PowerShell')).toBe('cmd')
  expect(toolFamily('Agent')).toBe('agent')
  expect(toolFamily('mcp__github__search_issues')).toBe('agent')
  expect(toolFamily('Skill')).toBe('')
  expect(toolFamily('')).toBe('')
})
