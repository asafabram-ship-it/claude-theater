// office-chrome.ts: the pure chrome maths of the desktop office, read without mounting the surface module (the module's own
// tests ride in office-client.test.ts and the mounted ones beside it). Phase B (decision 26): the settings popover and the
// drawer FLOAT over the cards as an absolute overlay, so they take no row in the Client's flow — chromeRows is the fixed rows
// and the footer line alone, the overlay has its own height (overlayHeight), and the window of layout lines the module draws
// carries an overscan (overscanOf) against the desktop's scroll drift. Builders: the smallest OfficeProps the maths reads.

import { describe, expect, test } from 'claude-code/testing'

import { I18N } from './i18n'
import { DRAWER_FRAME_ROWS, ROW_CHARS, WINDOW_ROWS, chromeRows, drawerInner, drawerLimits, drawerLines, drawerMax, drawerPad, fixedRows, helpRows, officeHeight, overlayHeight, overscanOf, windowOf } from './office-chrome'
import { rowCount } from './office-layout'
import type { OfficeAgent, OfficeDrawer, OfficeProps, OfficeRoom } from './office-props'

const LABELS: Record<string, string> = Object.fromEntries(Object.entries(I18N.he).filter((kv): kv is [string, string] => typeof kv[1] === 'string'))

function ag(id: string, over: Partial<OfficeAgent> = {}): OfficeAgent {
  return { id, emoji: '🦉', name: id, status: 'running', act: '📖 קורא', model: 'Opus 5.5', task: `task of ${id}`, failed: false, longRunning: false, star: 0, ...over }
}
function room(id: string, agents: OfficeAgent[]): OfficeRoom {
  const n = (s: OfficeAgent['status']) => agents.filter(a => a.status === s).length
  return { id, title: `room ${id}`, small: id, pinned: false, showDone: false, run: n('running'), stale: n('stale'), done: n('done'), agents, moreDone: 0, moreLabel: '' }
}
/** An OfficeProps at `columns`: one room of two agents, a 30-row body, nothing open. */
function propsAt(columns: number): OfficeProps {
  const rooms = [room('A', [ag('lead', { emoji: '💼', act: '🧠 חושב' }), ag('a1')])]
  const all = rooms.flatMap(r => r.agents)
  return {
    v: 1, lang: 'he', rtl: true, columns, rows: 30, offset: 0, nowMin: 100,
    counts: { run: all.filter(a => a.status === 'running').length, idle: 0, done: 0 }, prefs: { showDone: false, muted: true },
    search: '', selected: null, helpOpen: false, demo: false,
    rooms, drawer: null, footer: '', oversized: '', usage: null, empty: null, labels: LABELS,
  }
}
function drawer(over: Partial<OfficeDrawer> = {}): OfficeDrawer {
  return { id: 'lead', name: '💼 המנהל', model: 'Opus 5.5', act: '🧠 חושב', task: 'map the docs', result: '', truncated: false, elapsedMin: 3, sub: 'map the docs', status: 'running', failed: false, longRunning: false, star: 0, type: 'Explore', ...over }
}
/** `p` with the drawer of its first agent open. */
const withDrawer = (p: OfficeProps, over: Partial<OfficeDrawer> = {}): OfficeProps => ({ ...p, selected: 'lead', drawer: drawer(over) })
/** `p` with the settings popover open. */
const withHelp = (p: OfficeProps): OfficeProps => ({ ...p, helpOpen: true })

describe('the chrome (phase B: the overlay floats, so it takes no rows)', () => {
  test('chromeRows is the fixed rows and the footer, with or without an overlay; officeHeight does not grow when a drawer or the settings open', () => {
    const p = propsAt(50)
    expect(chromeRows(p)).toBe(fixedRows(p) + (p.footer ? 1 : 0))
    const d = withDrawer(p)
    expect(chromeRows(d)).toBe(chromeRows(p))
    expect(officeHeight(d, rowCount(d))).toBe(officeHeight(p, rowCount(p)))
    const h = withHelp(p)
    expect(chromeRows(h)).toBe(chromeRows(p))
    expect(officeHeight(h, rowCount(h))).toBe(officeHeight(p, rowCount(p)))
  })
  test('overlayHeight: the settings popover rows, the drawer card rows padded to its one height, 0 with neither', () => {
    const p = propsAt(50)
    expect(overlayHeight(p)).toBe(0)
    expect(overlayHeight(withHelp(p))).toBe(helpRows(50, false))
    const d = withDrawer({ ...p, rows: 60 })
    const limits = drawerLimits(50)
    expect(overlayHeight(d)).toBe(DRAWER_FRAME_ROWS + drawerMax(limits))
    // a short pane: padded to what the body holds whole, never below the drawer's own lines
    const short = withDrawer({ ...p, rows: 12 })
    expect(overlayHeight(short)).toBe(DRAWER_FRAME_ROWS + drawerLines(short.drawer!, short.labels, drawerInner(50), limits, drawerPad(limits, 12)).length)
    expect(drawerPad(limits, 12)).toBe(Math.min(drawerMax(limits), 12 - DRAWER_FRAME_ROWS))
    expect(drawerPad(limits, 0)).toBe(drawerMax(limits))
  })
  test('overlayHeight, the rest of its rules: the too-long conversations note is a row of the settings alone, the settings win over the drawer, a narrow pane takes one line fewer each of the task and the result, a long drawer keeps its own lines on a short pane', () => {
    const p = propsAt(50)
    // the note (live check 6): a row of the settings popover, none of an overlay that is closed
    expect(helpRows(50, true)).toBe(helpRows(50) + 1)
    expect(overlayHeight(withHelp({ ...p, oversized: 'x' }))).toBe(helpRows(50, true))
    expect(overlayHeight({ ...p, oversized: 'x' })).toBe(0)
    // the settings win over the drawer when both are open (a popover)
    expect(overlayHeight({ ...withHelp(p), drawer: drawer() })).toBe(helpRows(50))
    // the drawer's limits by the width (drawerLimits): 34 columns hold two lines more than 33
    const long = { task: 'word '.repeat(400), result: 'done '.repeat(400), truncated: true }
    for (const columns of [24, 32, 33, 34, 45, 120]) {
      expect(overlayHeight(withDrawer({ ...propsAt(columns), rows: 60 }, long)), `${columns}`).toBe(DRAWER_FRAME_ROWS + drawerMax(drawerLimits(columns)))
    }
    expect(overlayHeight(withDrawer({ ...propsAt(34), rows: 60 }, long)) - overlayHeight(withDrawer({ ...propsAt(33), rows: 60 }, long))).toBe(2)
    // a body tall enough (19 rows and more at 50 columns): ONE height at the width, whoever the drawer shows (live check 7, Q2)
    for (const rows of [19, 21, 30, 60]) expect(overlayHeight(withDrawer({ ...propsAt(50), rows })), `${rows}`).toBe(overlayHeight(withDrawer({ ...propsAt(50), rows }, long)))
    // a short pane: the pad shrinks, never below the drawer's own lines — a long drawer is as tall as on a tall pane
    for (const [columns, rows] of [[45, 18], [45, 13], [32, 16], [120, 14]] as const) {
      const d = withDrawer({ ...propsAt(columns), rows }, long)
      expect(overlayHeight(d), `${columns} × ${rows}`).toBe(DRAWER_FRAME_ROWS + drawerLines(d.drawer!, d.labels, drawerInner(columns), drawerLimits(columns)).length)
      expect(overlayHeight(d), `${columns} × ${rows}`).toBe(overlayHeight({ ...d, rows: 60 }))
    }
  })
  test('windowOf with overscan: every line of a short office, a body on each side of a long one, never past the content', () => {
    expect(overscanOf(40, 30)).toBe(40)
    expect(overscanOf(WINDOW_ROWS, 30)).toBe(WINDOW_ROWS)
    expect(overscanOf(WINDOW_ROWS + 1, 30)).toBe(30)
    // at the top of a 40-line office under a 6-row chrome on a 30-row body: the whole office
    expect(windowOf(6, 0, 30, 40, overscanOf(40, 30))).toEqual({ from: 0, count: 40 })
    // a 400-line office scrolled to 106: the window's top is layout line 100; a body before and after it
    expect(windowOf(6, 106, 30, 400, 30)).toEqual({ from: 70, count: 90 })
    // near the end: cut at the content
    expect(windowOf(6, 380, 30, 400, 30)).toEqual({ from: 344, count: 56 })
    // no overscan: the body's lines alone
    expect(windowOf(6, 106, 30, 400)).toEqual({ from: 100, count: 30 })
    // an offset past the content: nothing, and `from` never past the content (the module's spacer is `from` rows)
    expect(windowOf(6, 500, 30, 400, 30)).toEqual({ from: 400, count: 0 })
    // an empty office
    expect(windowOf(6, 500, 30, 0, 30)).toEqual({ from: 0, count: 0 })
  })
  test('windowOf without overscan: the lines the engine shows, in layout coordinates, never shifted by a clamp (a six-row chrome here)', () => {
    // offset inside the chrome: the first (rows - (chrome - offset)) layout lines
    expect(windowOf(6, 0, 30, 100)).toEqual({ from: 0, count: 24 })
    expect(windowOf(6, 2, 30, 100)).toEqual({ from: 0, count: 26 })
    // offset past the chrome: a full window from offset - chrome
    expect(windowOf(6, 6, 30, 100)).toEqual({ from: 0, count: 30 })
    expect(windowOf(6, 10, 30, 100)).toEqual({ from: 4, count: 30 })
    // near the end: the count shrinks, `from` stays (no clamp shifting the lines under the pointer); past the content `from` stops at it
    expect(windowOf(6, 90, 30, 100)).toEqual({ from: 84, count: 16 })
    expect(windowOf(6, 200, 30, 100)).toEqual({ from: 100, count: 0 })
    // short content, tall window
    expect(windowOf(6, 0, 30, 5)).toEqual({ from: 0, count: 5 })
    expect(windowOf(6, 0, 0, 5)).toEqual({ from: 0, count: 0 })
    // no byte budget here: the row budget (WINDOW_ROWS) is the module's cut on the line map
    expect(windowOf(6, 6, 200, 500)).toEqual({ from: 0, count: 200 })
    expect(WINDOW_ROWS).toBe(100)
    expect(ROW_CHARS).toBe(800)
  })
})
