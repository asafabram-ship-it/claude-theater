// office-client.tsx MOUNTED through the kit on the desktop: ui.tsx's desktop
// branch (Task 2.4) returns the Client from the literal path, so the engine
// lists the module among the plugin's surface modules and draws it. The
// fake-surface cases of office-client.test.ts cover the module alone; these
// read what the mounted module shows — the chrome and the cards, the keyboard
// focus a click or `j` lands on a row (its marker), the search Input keeping
// its text across a publish, a finisher's row (the ⭐ alone: no tint, no
// clock), the window and THE OVERLAY IN VIEW — and the effects of
// its posts through the plugin's own `ui.message` hook (ui.tsx); register.test.ts
// covers every message kind, office-controls.test.ts every control.

import { expect, test } from 'claude-code/testing'

import { PERSONA_EMOJI, POLL_MS } from './model'
import type { Agent } from './model'
import { CHROME_ROWS_SEARCH, chromeRows, fixedRows, windowOf } from './office-chrome'
import { SEARCH_DEBOUNCE_MS } from './office-client'
import { CARD_BORDER, FOCUS_MARK, nb, officeModel, rowCount } from './office-layout'
import { OFFICE_KEY } from './office-props'
import type { OfficeProps } from './office-props'
import { personaName } from './personas'
import { T0, beneath } from './test-kit'

const PANE = { plugin: 'agent-theater', component: 'Pane', requestId: 'agent-theater', props: { title: 'T', isFocused: true, bodyColumns: 45, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const
function agent(over: Partial<Agent> & { id: string }): Agent {
  return { persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: 'map the docs', subagent_type: 'Explore', status: 'running', tool: 'Read', phase: 'tool', task: 't', task_short: 't', result: null, start_ms: T0 - 30_000, end_ms: null, session: 'sess-a', session_full: 'sess-aaaa', cwd: '/w', project: '/w', mtime_ms: T0 - 1000, is_session: false, closed: false, is_workflow: false, truncated: false, model: 'claude-opus-5-5', ...over }
}

/** The $.store the mounted cases start from: Hebrew, muted, finished hidden, no pins. */
const PREFS = () => ({ prefs: { lang: 'he', muted: true, showDone: false, pins: [] } })

type Found = { props: Record<string, unknown> }
/** A node of the kit's drawn tree (a Text without props carries no `props` field at all). */
type Drawn = { type: string; props?: Record<string, unknown>; children?: Array<Drawn | string> }
const propsOf = (n: Drawn | undefined): Record<string, unknown> => n?.props ?? {}
type Finder = {
  find: (q: { type?: string; key?: string; text?: RegExp; in?: string }) => Promise<Found | undefined>
  findAll: (q: { type?: string; in?: string }) => Promise<Found[]>
  drawn: (scope?: { in?: string }) => Promise<unknown>
}

/** The office Client's props as last drawn. */
async function officeProps(ui: Finder): Promise<OfficeProps> {
  const c = await ui.find({ type: 'Client' })
  expect(c).toBeDefined()
  return c!.props.props as OfficeProps
}

/** Whether a node the module drew carries a backgroundColor (`bg`, or any): the office lays none (live check 6: the finish's tint flashed a near-black band on the light theme). */
async function withBg(ui: Finder, bg?: string): Promise<boolean> {
  return (await ui.findAll({ in: OFFICE_KEY })).some(n => (bg === undefined ? n.props.backgroundColor !== undefined : n.props.backgroundColor === bg))
}

/** The module's drawn tree: its children (the chrome lines, the settings | drawer, then the spacer and the window's cards). */
async function kidsOf(ui: Finder): Promise<Drawn[]> {
  return ((await ui.drawn({ in: OFFICE_KEY })) as Drawn).children?.filter((k): k is Drawn => typeof k !== 'string') ?? []
}

function textOf(n: Drawn | string): string {
  return typeof n === 'string' ? n : (n.children ?? []).map(textOf).join('')
}
/** The settings popover | the drawer: the module's keyed framed Boxes. */
const isOverlay = (k: Drawn) => k.type === 'Box' && propsOf(k).borderStyle !== undefined && propsOf(k).key !== undefined
/** The room cards of the drawn tree: the framed Boxes in the cards' style without a key, and the frameless fragment of the window's first card under an overlay (THE OVERLAY IN VIEW). */
async function cardsOf(ui: Finder): Promise<Drawn[]> {
  return (await kidsOf(ui)).filter(k => k.type === 'Box' && ((propsOf(k).borderStyle === 'round' && propsOf(k).borderColor === CARD_BORDER && propsOf(k).key === undefined) || propsOf(k).key === 'fragment'))
}
const nodesOf = (n: Drawn | string): Drawn[] => (typeof n === 'string' ? [] : [n, ...(n.children ?? []).flatMap(nodesOf)])
/** The table of a card or of the fragment: the Box of column Boxes, wherever it sits in the card (undefined when no row of it is in the window). */
function tableOf(card: Drawn): Drawn | undefined {
  return nodesOf(card).find(n => n.type === 'Box' && (n.children ?? []).length > 0 && (n.children ?? []).every(c => typeof c !== 'string' && propsOf(c).flexDirection === 'column'))
}
/** The texts of a card's drawn rows: one array per row — [status, who, model?, act] — the window's rows only (a column holds one Text per row and nothing else). */
function rowsOf(card: Drawn): string[][] {
  const table = tableOf(card)
  if (!table) return []
  const cols = (table.children as Drawn[]).map(col => (col.children as Drawn[]).filter(c => typeof c !== 'string' && c.type === 'Text'))
  return cols[0]!.map((_, i) => cols.map(col => textOf(col[i]!)))
}
/** The names (the who cells) of every row drawn, across the cards. */
async function drawnWho(ui: Finder): Promise<string[]> {
  return (await cardsOf(ui)).flatMap(c => rowsOf(c).map(r => r[1]!))
}
/** The agents whose drawn row carries the keyboard focus marker (by the who cell's name, as the row reads it). */
async function focused(ui: Finder, p: OfficeProps): Promise<string[]> {
  const mark = p.rtl ? FOCUS_MARK.rtl : FOCUS_MARK.ltr
  return (await cardsOf(ui)).flatMap(c => rowsOf(c).filter(r => r[0]!.includes(mark)).map(r => r[1]!))
}
/** The who cell of an agent, as the model says the row reads. */
function whoOf(p: OfficeProps, id: string): string {
  const row = officeModel(p).rooms.flatMap(r => r.rows).find(r => r.id === id)
  expect(row, id).toBeDefined()
  return row!.who
}
/** The layout line of an agent's row. */
function lineOf(p: OfficeProps, id: string): number {
  const hit = officeModel(p).hits.find(h => h.kind === 'agent' && h.id === id)
  expect(hit, id).toBeDefined()
  return hit!.y
}

test('DESKTOP (2.4): the pane is one Client; it draws the chrome and a card per room with the agent rows; a click on a row focuses it; a newcomer gets a row; a finisher\'s row turns done with nothing tinted and no clock of the module\'s own (the ⭐ stamp is the poll\'s: ui.test.ts)', { timeoutMs: 30_000 }, async ($, on) => {
  let agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', persona_id: 7 })]
  const { clock } = beneath(on, () => agents, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const client = await ui.find({ type: 'Client' })
  expect(client?.key).toBe(OFFICE_KEY)
  expect(client?.props.module).toBe('hooks/office-client.tsx')   // the source's literal is ./office-client.tsx; the engine carries the plugin's path
  expect(await ui.find({ type: 'Box' })).toBeUndefined()          // nothing but the Client in the plugin's own tree
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  const p0 = await officeProps(ui)
  expect(p0.v).toBe(1)
  expect(p0.rooms.map(r => r.agents.map(a => a.id))).toEqual([['lead', 'a1']])
  await ui.resize({ in: OFFICE_KEY, columns: 45, rows: 30 })
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /^🎭 עובדים 2 · סיימו 0$/ }), 'the header').toBeDefined()   // one Text of the counts
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'showDone' }), 'showDone').toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'mute' }), 'mute').toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'help' }), 'settings').toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'still' }), 'still: in the settings popover, not the toolbar').toBeUndefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }), 'search: only above SEARCH_FROM shown agents (spec 2026-10-10 §2 item 22)').toBeUndefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Text', text: /^Opus$/ }), 'the model word').toBeDefined()   // the model's family word (the version from 60 columns)
  // one card, its rows the two agents: the status mark, `${emoji} ${name}`, the model word, the activity whole
  const cards = await cardsOf(ui)
  expect(cards).toHaveLength(1)
  expect(rowsOf(cards[0]!)).toEqual([['●', whoOf(p0, 'lead'), 'Opus', '🤔', 'חושב'], ['●', whoOf(p0, 'a1'), 'Opus', '📖', 'קורא']])
  expect(await focused(ui, p0)).toEqual([])
  // the lead is the first row of the card (layout line 4), the whole row its hit; two agents shown: the chrome four rows (no search field)
  const x = 5
  expect(fixedRows(p0)).toBe(4)
  const y = fixedRows(p0) + lineOf(p0, 'lead')
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x, y, button: 'left' })
  // the click gave the row the keyboard focus (its marker) and posted `open`: the hook opened its drawer
  const pOpen = await officeProps(ui)
  expect(pOpen.selected).toBe('lead')
  expect(pOpen.drawer?.id).toBe('lead')
  expect(await focused(ui, pOpen)).toEqual([whoOf(pOpen, 'lead')])
  expect(await withBg(ui, '#2a3150')).toBe(false)   // no selection band
  // the chrome is dead: a click on the toolbar row moves no focus
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 2, y: 2, button: 'left' })
  expect(await focused(ui, pOpen)).toEqual([whoOf(pOpen, 'lead')])
  // toolbar: ☐ pressed by key → its post flips the pref → the next props carry it
  expect(pOpen.prefs.showDone).toBe(false)
  await ui.press({ key: 'showDone' })
  expect((await officeProps(ui)).prefs.showDone).toBe(true)
  // a newcomer gets a row (no walk-in: nothing moves, nothing is tinted); its persona name whole, the role in the drawer alone
  agents = [...agents, agent({ id: 'n1', persona_id: 5, role: 'index the docs' })]
  await clock.advance(POLL_MS * 4)   // SETTLE
  const p1 = await officeProps(ui)
  expect(p1.rooms[0]?.agents.map(a => a.id)).toEqual(['lead', 'a1', 'n1'])
  expect(await drawnWho(ui)).toEqual([whoOf(p1, 'lead'), whoOf(p1, 'a1'), whoOf(p1, 'n1')])
  expect(whoOf(p1, 'n1')).toBe(nb(`${PERSONA_EMOJI[3]} ${personaName(5, 'he')}`))   // (the payload's emoji, the persona's name, a no-break space between: nb)
  expect((await ui.findAll({ in: OFFICE_KEY, type: 'Box' })).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
  expect(await focused(ui, p1)).toEqual([whoOf(p1, 'lead')])      // the focus survived the publish
  // a finisher: its row turns ○ and `✅ סיים`, dim; nothing is tinted and no clock runs — the ⭐ stamp is the poll's, stamped off
  // the scanner's own office (this harness rewrites the publish): ui.test.ts's finish test covers it
  agents = agents.map(a => (a.id === 'a1' ? { ...a, status: 'done' as const, end_ms: clock.now(), result: 'Done.' } : a))
  await clock.advance(POLL_MS)
  const p2 = await officeProps(ui)
  expect(p2.rooms[0]?.agents.find(a => a.id === 'a1')).toMatchObject({ status: 'done', star: 0 })
  const doneRow = rowsOf((await cardsOf(ui))[0]!).find(r => r[1] === whoOf(p2, 'a1'))
  expect(doneRow).toEqual(['○', whoOf(p2, 'a1'), 'Opus', '✅', 'סיים'])
  expect(await withBg(ui)).toBe(false)
  await ui.advance(3000)   // no clock: nothing happens
  expect(await withBg(ui)).toBe(false)
  expect(rowsOf((await cardsOf(ui))[0]!).find(r => r[1] === whoOf(p2, 'a1'))).toEqual(doneRow)
  await ui.unmount()
})

test('DESKTOP (2.4): the engine scrolls natively — the Client is full height (the chrome and the cards\' lines) and the engine\'s offset reaches it as props.offset', { timeoutMs: 30_000 }, async ($, on) => {
  const many = Array.from({ length: 30 }, (_, i) => agent({ id: `a${i}`, session_full: `s${i % 3}`, session: `s${i % 3}` }))
  const { clock } = beneath(on, () => many, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 20 } } })
  const client = await ui.find({ type: 'Client' })
  const p0 = client?.props.props as OfficeProps
  expect(p0.offset).toBe(0)
  expect(p0.rows).toBe(20)
  expect(p0.columns).toBe(45)
  expect(client?.props.width).toBe(45)
  expect(client?.props.height).toBe(chromeRows(p0) + rowCount(p0))
  expect(client?.props.height as number).toBeGreaterThan(20)        // taller than the body: the engine shows a scrollbar
  await ui.redraw({ ...PANE.props, scroll: { offset: 3, bodyRows: 20 } })
  const after = await ui.find({ type: 'Client' })
  expect((after?.props.props as OfficeProps).offset).toBe(3)
  expect(after?.props.height).toBe(client?.props.height)            // the content did not change: neither did the height
  await ui.unmount()
})

test('DESKTOP (2.4): keys walk the rows (the marker moves); the search Input (drawn: thirteen agents shown) keeps its text across a publish and the debounce; a newcomer\'s row appears without a fault', { timeoutMs: 30_000 }, async ($, on) => {
  // thirteen agents at 45 columns (more than SEARCH_FROM: the search field is drawn, on its own line): lead, a1, a2, a3 on layout
  // lines 4..7, z1..z9 on 8..16
  const Z = Array.from({ length: 9 }, (_, i) => `z${i + 1}`)
  let agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', persona_id: 7 }), agent({ id: 'a2', persona_id: 8 }), agent({ id: 'a3', persona_id: 9 }), ...Z.map((id, i) => agent({ id, persona_id: 20 + i }))]
  const { clock } = beneath(on, () => agents, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  // (a 60-row body: the window holds every row under the open drawer — the walk keeps to the rows drawn)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 60 } } })
  await ui.resize({ in: OFFICE_KEY, columns: 45, rows: 60 })
  const p0 = await officeProps(ui)
  expect(['lead', 'a1', 'a2', 'a3'].map(id => lineOf(p0, id))).toEqual([4, 5, 6, 7])
  // a click gives the Client the focus (on the lead); `j` walks it row by row
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 5, y: fixedRows(p0) + 4, button: 'left' })
  const pSel = await officeProps(ui)                        // the click's `open` opened the lead's drawer (the chrome grew)
  expect(pSel.selected).toBe('lead')
  expect(await focused(ui, pSel)).toEqual([whoOf(pSel, 'lead')])
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await focused(ui, pSel)).toEqual([whoOf(pSel, 'a2')])
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await focused(ui, pSel)).toEqual([whoOf(pSel, 'a3')])
  for (let i = 0; i < Z.length; i++) await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await focused(ui, pSel)).toEqual([whoOf(pSel, 'z9')])
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await focused(ui, pSel)).toEqual([whoOf(pSel, 'z9')])   // clamped at the last row
  for (let i = 0; i < Z.length + 1; i++) await ui.key({ in: OFFICE_KEY, key: 'k' })
  expect(await focused(ui, pSel)).toEqual([whoOf(pSel, 'a2')])
  expect((await officeProps(ui)).selected).toBe('lead')     // j / k post nothing (the focus is the module's own): the drawer stays
  await ui.key({ in: OFFICE_KEY, key: 'f' })                // the toolbar's showDone: a post, the pref flips
  expect((await officeProps(ui)).prefs.showDone).toBe(true)
  await ui.key({ in: OFFICE_KEY, key: 'up' })               // focus a1 (up from a2) ...
  await ui.key({ in: OFFICE_KEY, key: 'return' })           // ... and open it: its drawer replaces the lead's
  expect((await officeProps(ui)).drawer?.id).toBe('a1')
  await ui.key({ in: OFFICE_KEY, key: 'x' })                // x closes it
  expect((await officeProps(ui)).drawer).toBeNull()
  expect(await focused(ui, p0)).toEqual([whoOf(p0, 'a1')])  // a1's row (no drawer: the chrome is p0's again)
  // typing while a publish lands (a1 moves to Write): the first keystroke of a search posts at once (under ONE_LINE_FROM the
  // hooks size the chrome by it), the next waits — and the field keeps 'ab' through the redraw and the debounce
  await ui.input({ key: 'search', text: 'a', kind: 'change' })
  expect((await officeProps(ui)).search).toBe('a')          // at once ('a' is in a1's role: its row stays)
  await ui.input({ key: 'search', text: 'ab', kind: 'change' })
  agents = agents.map(a => (a.id === 'a1' ? { ...a, tool: 'Write' } : a))
  await clock.advance(POLL_MS * 2)
  expect((await officeProps(ui)).rooms[0]?.agents.find(a => a.id === 'a1')?.act).toBe('✏️ כותב')   // the publish redrew the Client
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('ab')
  expect((await officeProps(ui)).search).toBe('a')          // not yet: the module waits SEARCH_DEBOUNCE_MS of quiet
  await ui.advance(SEARCH_DEBOUNCE_MS)                      // the search post goes out: the hook writes view.search, the pane redraws
  expect((await officeProps(ui)).search).toBe('ab')
  expect((await officeProps(ui)).empty?.kind).toBe('nomatch') // nobody matches "ab"
  await ui.advance(SEARCH_DEBOUNCE_MS * 4)
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('ab') // the echo keeps the typed text
  // Enter with an empty field: the module posts at once and keeps '' as its text; the hook clears view.search
  await ui.input({ key: 'search', text: '', kind: 'submit' })
  expect((await officeProps(ui)).search).toBe('')
  agents = agents.map(a => (a.id === 'a2' ? { ...a, tool: 'Grep' } : a))
  await clock.advance(POLL_MS * 2)
  expect((await officeProps(ui)).rooms[0]?.agents.find(a => a.id === 'a2')?.act).toBe('🔎 מחפש קוד')
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('')
  // a newcomer: n1 is the fourteenth row (layout line 17); no fault, no loop, no tint
  agents = [...agents, agent({ id: 'n1', persona_id: 5 })]
  await clock.advance(POLL_MS * 4)
  const p1 = await officeProps(ui)
  expect(lineOf(p1, 'n1')).toBe(17)
  expect(await drawnWho(ui)).toEqual(['lead', 'a1', 'a2', 'a3', ...Z, 'n1'].map(id => whoOf(p1, id)))
  await ui.advance(2000)
  expect(await drawnWho(ui)).toEqual(['lead', 'a1', 'a2', 'a3', ...Z, 'n1'].map(id => whoOf(p1, id)))
  expect((await ui.findAll({ in: OFFICE_KEY, type: 'Box' })).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
  await ui.unmount()
})

// (a mount, a scroll and clicks through the kit: past the 5 s default under a full suite on a loaded machine with no code change — the budget is load headroom)
test('DESKTOP (2.4): the window — the card drawn whole with its rows windowed by line (one spacer above and one below the table for the rest), a click in full-layout coordinates', { timeoutMs: 30_000 }, async ($, on) => {
  const many = Array.from({ length: 40 }, (_, i) => agent({ id: `a${i}` }))
  const { clock } = beneath(on, () => many, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, scroll: { offset: 12, bodyRows: 10 } } })
  const p = await officeProps(ui)
  expect(p.offset).toBe(12)
  expect(p.rows).toBe(10)
  const chrome = chromeRows(p)
  expect(chrome).toBe(CHROME_ROWS_SEARCH)   // (forty agents: the search field on its own line)
  const { from, count } = windowOf(chrome, 12, 10, rowCount(p))
  expect(from).toBe(12 - chrome)
  expect(count).toBe(10)
  // the one card starts at line 0: no spacer before it; its rows in the window (lines 6..15 → a2..a11), the rest spacered
  const kids = await kidsOf(ui)
  expect(kids.map(k => propsOf(k).key ?? propsOf(k).borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  const card = (await cardsOf(ui))[0]!
  expect(rowsOf(card).map(r => r[1])).toEqual(Array.from({ length: 10 }, (_, i) => whoOf(p, `a${i + 2}`)))
  // the table block: a column Box of the spacer for a0, a1 (above the window), the table, the spacer for a12..a39 — no spacer inside a column
  const [, , block] = (card.children as Array<Drawn | string>).filter((k): k is Drawn => typeof k !== 'string')
  expect(propsOf(block)).toMatchObject({ flexDirection: 'column' })
  const [above, table, below] = (block!.children as Array<Drawn | string>).filter((k): k is Drawn => typeof k !== 'string')
  expect(above).toMatchObject({ type: 'Box', props: { height: 2 } })
  expect(table).toBe(tableOf(card))
  expect(below).toMatchObject({ type: 'Box', props: { height: 28 } })
  for (const col of table!.children as Drawn[]) expect((col.children as Drawn[]).every(c => c.type === 'Text')).toBe(true)
  // a12's row is layout line 16: just past the window; a9's (line 13) is inside: the click lands on it
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 5, y: chrome + 13, button: 'left' })
  expect((await officeProps(ui)).selected).toBe('a9')          // the click's `open` reached the hooks: a9's drawer
  await ui.press({ key: 'close' })                              // closed again: the chrome is the window's six lines
  expect((await officeProps(ui)).drawer).toBeNull()
  expect(await focused(ui, p)).toEqual([whoOf(p, 'a9')])
  // a click on a row above the window (a0's line 4, spacered) opens nothing; neither does one past it (a12's line 16)
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 5, y: chrome + 4, button: 'left' })
  expect((await officeProps(ui)).selected).toBeNull()
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 5, y: chrome + 16, button: 'left' })
  expect((await officeProps(ui)).selected).toBeNull()
  // no row hover: a move over a row tints nothing and changes no props
  await ui.pointer({ in: OFFICE_KEY, type: 'move', x: 30, y: chrome + 14 })
  expect((await ui.findAll({ in: OFFICE_KEY, type: 'Box' })).some(n => typeof n.props.backgroundColor === 'string')).toBe(false)
  await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
  await ui.unmount()
})

test('DESKTOP: a drawer or the settings opened while the pane is scrolled opens IN VIEW — at the engine\'s offset, after a spacer of the lines above the window, the card continuing under it from the window\'s first line as a frameless fragment (the clicked row still drawn, focused; the rows under the overlay answer at their Client rows); closed, the window is as before', { timeoutMs: 30_000 }, async ($, on) => {
  // 60 agents at 30 columns: one card of 67 lines (rows 4..63, the gap 66); a 25-row window scrolled 40 rows down shows lines from 34
  const many = Array.from({ length: 60 }, (_, i) => agent({ id: `a${i}` }))
  const { clock } = beneath(on, () => many, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 30, scroll: { offset: 40, bodyRows: 25 } } })
  const p0 = await officeProps(ui)
  expect(p0.offset).toBe(40)
  expect(rowCount(p0)).toBe(67)
  const before = rowsOf((await cardsOf(ui))[0]!)
  expect(before[0]![1]).toBe(whoOf(p0, 'a30'))   // line 34
  expect(before).toHaveLength(25)
  // a click on a36 (its row is layout line 40, the window's seventh line)
  expect(lineOf(p0, 'a36')).toBe(40)
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 5, y: chromeRows(p0) + 40, button: 'left' })
  const p1 = await officeProps(ui)
  expect(p1.drawer?.id).toBe('a36')
  expect(p1.offset).toBe(40)                                         // nothing scrolled: the engine's window stays
  const H = chromeRows(p1) - CHROME_ROWS_SEARCH
  // the module's tree: the fixed chrome, a spacer of the 34 lines above the window, the DRAWER at Client row 6 + 34 = 40 — the
  // engine's offset, so it opens in the viewport's first rows — then the card's FRAGMENT from line 34: no frame, no rows above
  // the window, its rows from a30 (the same layout line 34), the clicked row drawn and focused
  const kids = await kidsOf(ui)
  expect(kids.map(k => propsOf(k).key ?? propsOf(k).borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'spacer', 'drawer', 'fragment'])
  expect(propsOf(kids[3]).height).toBe(34)
  expect(CHROME_ROWS_SEARCH + 34).toBe(p1.offset)
  expect(kids[4]).toMatchObject({ type: 'Box', props: { key: 'drawer', borderStyle: 'round', borderColor: CARD_BORDER, height: H - 1, marginBottom: 1 } })
  expect(textOf(kids[4]!)).toMatch(/משימה/)        // the drawer's task heading
  expect(propsOf(kids[5]).borderStyle).toBeUndefined()
  expect(propsOf(kids[5])).toMatchObject({ paddingX: 2, height: 66 - 34, marginBottom: 1 })
  const open = rowsOf((await cardsOf(ui))[0]!)
  expect(open[0]![1]).toBe(whoOf(p1, 'a30'))
  expect(open.map(r => r[1])).toContain(whoOf(p1, 'a36'))
  expect(await focused(ui, p1)).toEqual([whoOf(p1, 'a36')])          // the click's focus on its row
  expect(open.length).toBe(25 - H)                                   // the window less the drawer's rows
  // the pointer: a drawer row (the viewport's first H) opens nothing; the first row under the drawer — the viewport's row H,
  // Client row chromeRows + 34 — is a30's: its drawer replaces a36's and the focus moves there
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 5, y: p1.offset + 1, button: 'left' })
  expect((await officeProps(ui)).drawer?.id).toBe('a36')
  expect(chromeRows(p1) + 34).toBe(p1.offset + H)
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 5, y: p1.offset + H, button: 'left' })
  const p1b = await officeProps(ui)
  expect(p1b.drawer?.id).toBe('a30')
  expect(chromeRows(p1b)).toBe(chromeRows(p1))
  expect(await focused(ui, p1b)).toEqual([whoOf(p1b, 'a30')])
  // the settings (h) take the same place; h again closes them, x the drawer: the window is as before, the card whole again
  await ui.key({ in: OFFICE_KEY, key: 'h' })
  const p2 = await officeProps(ui)
  expect(p2.helpOpen).toBe(true)
  const help = await kidsOf(ui)
  expect(help.map(k => propsOf(k).key ?? propsOf(k).borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'spacer', 'help', 'fragment'])
  expect(propsOf(help[3]).height).toBe(34)
  expect(textOf(help[4]!)).toContain(nb('k / j'))
  expect(textOf(help[4]!)).toMatch(/הגדרות/)
  expect(rowsOf((await cardsOf(ui))[0]!)).toHaveLength(25 - (chromeRows(p2) - CHROME_ROWS_SEARCH))
  await ui.key({ in: OFFICE_KEY, key: 'h' })
  await ui.key({ in: OFFICE_KEY, key: 'x' })
  const p3 = await officeProps(ui)
  expect(p3.drawer).toBeNull()
  const closed = await kidsOf(ui)
  expect(closed.some(isOverlay)).toBe(false)
  expect(closed.map(k => propsOf(k).key ?? propsOf(k).borderStyle)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  expect(rowsOf((await cardsOf(ui))[0]!).map(r => r.slice(1))).toEqual(before.map(r => r.slice(1)))   // (the focus marker stays on a30's row)
  expect(await focused(ui, p3)).toEqual([whoOf(p3, 'a30')])
  await ui.unmount()
})
