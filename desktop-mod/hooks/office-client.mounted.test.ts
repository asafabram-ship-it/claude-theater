// office-client.tsx MOUNTED through the kit on the desktop: ui.tsx's desktop
// branch (Task 2.4) returns the Client from the literal path, so the engine
// lists the module among the plugin's surface modules and draws it. The
// fake-surface cases of office-client.test.ts cover the module alone; these
// read what the mounted module shows — the chrome and the cards, the keyboard
// focus a press or `j` lands on a row (its marker), the search Input keeping
// its text across a publish, a finisher's row (the ★ alone: no tint, no
// clock), THE WINDOW WITH OVERSCAN and THE FLOATING OVERLAY — and the effects
// of its posts through the plugin's own `ui.message` hook (ui.tsx);
// register.test.ts covers every message kind, office-controls.test.ts every
// control.
//
// THE CLICKS THROUGH THE BUTTONS (phase B, decision 26): every click in the
// office is a native plain Button — a row's cells keyed `agent:<id>:<col>`,
// the pin `pin:<room>`, the more line `more:<room>` — so these tests press a
// row by its key as the desktop does; the pointer is read for its `leave`
// alone (a down anywhere is nothing). The settings | drawer is one absolute
// Box, the root's last child after the reading column, at max(offset,
// chromeRows) on the theme's inverseText: it takes no row of the flow, so the
// cards under it never move, and the Client's height reaches its bottom only
// on an office shorter than it (office-chrome.ts officeHeight).

import { expect, test } from 'claude-code/testing'

import { PERSONA_EMOJI, POLL_MS } from './model'
import type { Agent } from './model'
import { CHROME_ROWS_SEARCH, WINDOW_ROWS, chromeRows, emptyRows, fixedRows, helpRows, officeHeight, overlayHeight, overscanOf, windowOf } from './office-chrome'
import { SEARCH_DEBOUNCE_MS } from './office-client'
import { CARD_BORDER, CREDIT, CREDIT_URL, FOCUS_MARK, geometry, nb, officeModel, rowCount } from './office-layout'
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

/** Whether a node the module drew carries a backgroundColor (`bg`, or any): the office lays none (live check 6: the finish's tint flashed a near-black band on the light theme) — but THE FLOATING OVERLAY's (below). */
async function withBg(ui: Finder, bg?: string): Promise<boolean> {
  return (await ui.findAll({ in: OFFICE_KEY })).some(n => !isOverlayProps(n.props) && (bg === undefined ? n.props.backgroundColor !== undefined : n.props.backgroundColor === bg))
}
/** THE FLOATING OVERLAY's props: the settings | drawer, absolute on the theme's inverseText (decision 26) — the one background the office lays. */
const isOverlayProps = (p: Record<string, unknown>) => (p.key === 'help' || p.key === 'drawer') && p.position === 'absolute' && p.backgroundColor === 'inverseText'

const elements = (n: Drawn | undefined): Drawn[] => (n?.children ?? []).filter((k): k is Drawn => typeof k !== 'string')
/** The module's drawn tree: the root Box — the reading column, then the floating overlay while one is open. */
async function rootOf(ui: Finder): Promise<Drawn> {
  return (await ui.drawn({ in: OFFICE_KEY })) as Drawn
}
/** The reading column's children: the chrome lines, then the spacer and the window's cards. */
async function kidsOf(ui: Finder): Promise<Drawn[]> {
  const column = elements(await rootOf(ui)).find(k => propsOf(k).key === 'column')
  expect(column, 'the column Box').toBeDefined()
  return elements(column)
}
/** THE FLOATING OVERLAY: the root's second (last) child, keyed help | drawer; undefined when neither is open. */
async function overlayOf(ui: Finder): Promise<Drawn | undefined> {
  const kids = elements(await rootOf(ui))
  expect(kids.length).toBeLessThanOrEqual(2)
  if (kids[1]) expect(isOverlayProps(propsOf(kids[1])), 'the root\'s second child is the overlay').toBe(true)
  return kids[1]
}
/** The column's children by kind: their keys, a card as `round`. */
async function kindsOf(ui: Finder): Promise<unknown[]> {
  return (await kidsOf(ui)).map(k => (String(propsOf(k).key ?? '').startsWith('room:') ? 'round' : propsOf(k).key ?? propsOf(k).borderStyle))
}

function textOf(n: Drawn | string): string {
  return typeof n === 'string' ? n : (n.children ?? []).map(textOf).join('')
}
/** The room cards of the drawn tree: the framed Boxes in the cards' style keyed `room:<id>`, every one whole (phase B: no fragment). */
async function cardsOf(ui: Finder): Promise<Drawn[]> {
  return (await kidsOf(ui)).filter(k => k.type === 'Box' && propsOf(k).borderStyle === 'round' && propsOf(k).borderColor === CARD_BORDER && String(propsOf(k).key ?? '').startsWith('room:'))
}
const nodesOf = (n: Drawn | string): Drawn[] => (typeof n === 'string' ? [] : [n, ...(n.children ?? []).flatMap(nodesOf)])
/** The table of a card: the Box of column Boxes, wherever it sits in the card (undefined when no row of it is drawn). */
function tableOf(card: Drawn): Drawn | undefined {
  return nodesOf(card).find(n => n.type === 'Box' && (n.children ?? []).length > 0 && (n.children ?? []).every(c => typeof c !== 'string' && propsOf(c).flexDirection === 'column'))
}
/** The texts of a card's drawn rows: one array per row — [status, who, model?, act] — the drawn rows only (a column holds one cell per row and nothing else: the mark a Text, each value a Button with its one Text). */
function rowsOf(card: Drawn): string[][] {
  const table = tableOf(card)
  if (!table) return []
  const cols = elements(table).map(col => elements(col).filter(c => c.type === 'Text' || c.type === 'Button'))
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
/** The layout line of an agent's row (the model's: office-layout.ts RowView.y). */
function rowY(p: OfficeProps, id: string): number {
  const row = officeModel(p).rooms.flatMap(r => r.rows).find(r => r.id === id)
  expect(row, id).toBeDefined()
  return row!.y
}
/** A row's press as the desktop does it: its who cell's Button, by key (phase B: any of the row's value cells opens it). */
const pressRow = (ui: { press: (t: { key: string }) => Promise<unknown> }, id: string) => ui.press({ key: `agent:${id}:who` })

test('DESKTOP (2.4): the pane is one Client; it draws the chrome and a card per room with the agent rows; a press on a row focuses it and opens its drawer (the floating overlay, the one background); a pointer down anywhere is nothing; a newcomer gets a row; a finisher\'s row turns done with nothing tinted and no clock of the module\'s own (the ⭐ stamp is the poll\'s: ui.test.ts)', { timeoutMs: 30_000 }, async ($, on) => {
  let agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', persona_id: 7 })]
  const { clock } = beneath(on, () => agents, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const client = await ui.find({ type: 'Client' })
  expect(client?.key).toBe(OFFICE_KEY)
  expect(client?.props.module).toBe('hooks/office-client.tsx')   // the source's literal is ./office-client.tsx; the engine carries the plugin's path
  // the plugin's own tree: the Client, then THE CREDIT LINE under it (ui.tsx: the page cannot draw a Link inside a Client, paint
  // probe round 6) — the column Box and the credit's line its only Boxes
  expect((await ui.findAll({ type: 'Box' })).map(b => b.key ?? null)).toEqual([null, 'credit'])
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
  // THE CREDIT LINE (decision 27a): the desktop draws its Link in the PANE's tree, under the Client (no refusal, no fault: the
  // Client drew above) — never inside the Client, whose tree the page cannot draw with a Link in it (paint probe round 6)
  expect(await ui.find({ in: OFFICE_KEY, type: 'Link' }), 'no Link inside the Client').toBeUndefined()
  const link = await ui.find({ type: 'Link' })
  expect(link?.props.href, 'the credit\'s link').toBe(CREDIT_URL)
  expect(link?.props.label, 'the credit\'s link').toBe(nb(CREDIT))   // (the whole credit is the Link: `© Legal Mind`, no-break)
  expect(await ui.find({ type: 'Text', text: nb(CREDIT) }), 'no credit Text beside the Link').toBeUndefined()
  expect((await kindsOf(ui)).at(-1)).toBe('round')   // the module's column ends with its last card
  // one card, its rows the two agents: the status mark, `${emoji} ${name}`, the model word, the activity whole
  const cards = await cardsOf(ui)
  expect(cards).toHaveLength(1)
  expect(rowsOf(cards[0]!)).toEqual([['●', whoOf(p0, 'lead'), 'Opus', '⋯', 'חושב'], ['●', whoOf(p0, 'a1'), 'Opus', '▤', 'קורא']])   // (decision 29's glyphs)
  expect(await focused(ui, p0)).toEqual([])
  // the lead is the first row of the card (layout line 4), its value cells its Buttons; two agents shown: the chrome four rows (no search field)
  expect(fixedRows(p0)).toBe(4)
  expect(rowY(p0, 'lead')).toBe(4)
  await pressRow(ui, 'lead')
  // the press gave the row the keyboard focus (its marker) and posted `open`: the hook opened its drawer, floating over the office
  const pOpen = await officeProps(ui)
  expect(pOpen.selected).toBe('lead')
  expect(pOpen.drawer?.id).toBe('lead')
  expect(await focused(ui, pOpen)).toEqual([whoOf(pOpen, 'lead')])
  expect(await overlayOf(ui)).toMatchObject({ type: 'Box', props: { key: 'drawer', position: 'absolute', backgroundColor: 'inverseText' } })
  expect(await withBg(ui, '#2a3150')).toBe(false)   // no selection band
  // a pointer down anywhere is nothing (every click is a Button's press; the module reads the pointer for its leave alone):
  // the focus stays, nothing is posted
  await ui.pointer({ in: OFFICE_KEY, type: 'down', x: 5, y: fixedRows(p0) + rowY(p0, 'a1'), button: 'left' })
  expect(await focused(ui, pOpen)).toEqual([whoOf(pOpen, 'lead')])
  expect((await officeProps(ui)).selected).toBe('lead')
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
  expect(await withBg(ui)).toBe(false)
  expect(await focused(ui, p1)).toEqual([whoOf(p1, 'lead')])      // the focus survived the publish
  // a finisher: its row turns ○ and `✓ סיים`, dim; nothing is tinted and no clock runs — the ★ stamp is the poll's, stamped off
  // the scanner's own office (this harness rewrites the publish): ui.test.ts's finish test covers it
  agents = agents.map(a => (a.id === 'a1' ? { ...a, status: 'done' as const, end_ms: clock.now(), result: 'Done.' } : a))
  await clock.advance(POLL_MS)
  const p2 = await officeProps(ui)
  expect(p2.rooms[0]?.agents.find(a => a.id === 'a1')).toMatchObject({ status: 'done', star: 0 })
  const doneRow = rowsOf((await cardsOf(ui))[0]!).find(r => r[1] === whoOf(p2, 'a1'))
  expect(doneRow).toEqual(['○', whoOf(p2, 'a1'), 'Opus', '✓', 'סיים'])
  expect(await withBg(ui)).toBe(false)
  await ui.advance(3000)   // no clock: nothing happens
  expect(await withBg(ui)).toBe(false)
  expect(rowsOf((await cardsOf(ui))[0]!).find(r => r[1] === whoOf(p2, 'a1'))).toEqual(doneRow)
  await ui.unmount()
})

test('DESKTOP (2.4): the engine scrolls natively — the Client is full height (officeHeight: the chrome and the cards\' lines, or the floating overlay\'s bottom on an office shorter than it) and the engine\'s offset reaches it as props.offset', { timeoutMs: 30_000 }, async ($, on) => {
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
  expect(client?.props.height).toBe(officeHeight(p0, rowCount(p0)))
  expect(client?.props.height).toBe(chromeRows(p0) + rowCount(p0))   // (no overlay open; THE CREDIT LINE is the hooks', under the Client)
  expect(client?.props.height as number).toBeGreaterThan(20)        // taller than the body: the engine shows a scrollbar
  await ui.redraw({ ...PANE.props, scroll: { offset: 3, bodyRows: 20 } })
  const after = await ui.find({ type: 'Client' })
  expect((after?.props.props as OfficeProps).offset).toBe(3)
  expect(after?.props.height).toBe(client?.props.height)            // the content did not change: neither did the height
  // a drawer, then the settings: they float — the office is taller than either, so the height is the content's, as closed
  await pressRow(ui, 'a4')
  const pd = (await ui.find({ type: 'Client' }))?.props.props as OfficeProps
  expect(pd.drawer?.id).toBe('a4')
  expect(rowCount(pd)).toBeGreaterThan(overlayHeight(pd))
  expect((await ui.find({ type: 'Client' }))?.props.height).toBe(officeHeight(pd, rowCount(pd)))
  expect((await ui.find({ type: 'Client' }))?.props.height).toBe(client?.props.height)
  await ui.press({ key: 'help' })
  const ph = (await ui.find({ type: 'Client' }))?.props.props as OfficeProps
  expect(ph.helpOpen).toBe(true)
  expect((await ui.find({ type: 'Client' }))?.props.height).toBe(client?.props.height)
  // THE OVERLAY'S ROOM: an office shorter than the open settings (a search nobody matches: the no-match block) — the Client
  // reaches the popover's bottom, so the desktop never clips it at the Client's edge
  await ui.input({ key: 'search', text: 'zzz', kind: 'submit' })
  const pe = (await ui.find({ type: 'Client' }))?.props.props as OfficeProps
  expect([pe.empty?.kind, pe.helpOpen]).toEqual(['nomatch', true])
  expect(overlayHeight(pe)).toBe(helpRows(45))
  expect(emptyRows(pe)).toBeLessThan(overlayHeight(pe))
  expect((await ui.find({ type: 'Client' }))?.props.height).toBe(officeHeight(pe, rowCount(pe)))
  expect((await ui.find({ type: 'Client' }))?.props.height).toBe(chromeRows(pe) + overlayHeight(pe))
  // closed, the no-match block alone
  await ui.press({ key: 'closeHelp' })
  const pc = (await ui.find({ type: 'Client' }))?.props.props as OfficeProps
  expect((await ui.find({ type: 'Client' }))?.props.height).toBe(chromeRows(pc) + emptyRows(pc))
  await ui.unmount()
})

test('DESKTOP (2.4): keys walk the rows drawn (the marker moves) — a short office is drawn whole, so the walk reaches the rows past the viewport too; the search Input (drawn: thirteen agents shown) keeps its text across a publish and the debounce; a newcomer\'s row appears without a fault', { timeoutMs: 30_000 }, async ($, on) => {
  // thirteen agents at 45 columns (more than SEARCH_FROM: the search field is drawn, on its own line): lead, a1, a2, a3 on layout
  // lines 4..7, z1..z9 on 8..16
  const Z = Array.from({ length: 9 }, (_, i) => `z${i + 1}`)
  let agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', persona_id: 7 }), agent({ id: 'a2', persona_id: 8 }), agent({ id: 'a3', persona_id: 9 }), ...Z.map((id, i) => agent({ id, persona_id: 20 + i }))]
  const { clock } = beneath(on, () => agents, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  // (a 14-row body: the viewport shows the chrome and the first rows alone — but THE WINDOW WITH OVERSCAN draws an office of at
  // most WINDOW_ROWS lines whole, and the walk keeps to the rows drawn: a focus off the screen is a scroll away)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 14 } } })
  await ui.resize({ in: OFFICE_KEY, columns: 45, rows: 14 })
  const p0 = await officeProps(ui)
  expect(['lead', 'a1', 'a2', 'a3'].map(id => rowY(p0, id))).toEqual([4, 5, 6, 7])
  expect(fixedRows(p0) + rowY(p0, 'z9')).toBeGreaterThanOrEqual(14)   // z9 lies past the viewport ...
  expect(await drawnWho(ui)).toEqual(['lead', 'a1', 'a2', 'a3', ...Z].map(id => whoOf(p0, id)))   // ... and is drawn
  // k from no focus starts IN VIEW (phase B final review): the last row above the viewport's bottom — a3 (Client row 13 of the
  // 14), not z9, the last row drawn, which lies past the viewport
  expect(fixedRows(p0) + rowY(p0, 'a3')).toBeLessThan(14)
  await ui.key({ in: OFFICE_KEY, key: 'k' })
  expect(await focused(ui, p0)).toEqual([whoOf(p0, 'a3')])
  // a press gives the Client the focus (on the lead); `j` walks it row by row
  await pressRow(ui, 'lead')
  const pSel = await officeProps(ui)                        // the press's `open` opened the lead's drawer (floating: no chrome row)
  expect(pSel.selected).toBe('lead')
  expect(await focused(ui, pSel)).toEqual([whoOf(pSel, 'lead')])
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await focused(ui, pSel)).toEqual([whoOf(pSel, 'a2')])
  await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await focused(ui, pSel)).toEqual([whoOf(pSel, 'a3')])
  for (let i = 0; i < Z.length; i++) await ui.key({ in: OFFICE_KEY, key: 'j' })
  expect(await focused(ui, pSel)).toEqual([whoOf(pSel, 'z9')])   // past the viewport: drawn, so walked to
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
  expect(await focused(ui, p0)).toEqual([whoOf(p0, 'a1')])  // a1's row (the focus stays)
  // typing while a publish lands (a1 moves to Write): the first keystroke of a search posts at once (under ONE_LINE_FROM the
  // hooks size the chrome by it), the next waits — and the field keeps 'ab' through the redraw and the debounce
  await ui.input({ key: 'search', text: 'a', kind: 'change' })
  expect((await officeProps(ui)).search).toBe('a')          // at once ('a' is in a1's role: its row stays)
  await ui.input({ key: 'search', text: 'ab', kind: 'change' })
  agents = agents.map(a => (a.id === 'a1' ? { ...a, tool: 'Write' } : a))
  await clock.advance(POLL_MS * 2)
  expect((await officeProps(ui)).rooms[0]?.agents.find(a => a.id === 'a1')?.act).toBe('✎ כותב')   // the publish redrew the Client
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
  expect((await officeProps(ui)).rooms[0]?.agents.find(a => a.id === 'a2')?.act).toBe('⌕ מחפש קוד')
  expect((await ui.find({ in: OFFICE_KEY, type: 'Input', key: 'search' }))?.props.value).toBe('')
  // a newcomer: n1 is the fourteenth row (layout line 17); no fault, no loop, no tint
  agents = [...agents, agent({ id: 'n1', persona_id: 5 })]
  await clock.advance(POLL_MS * 4)
  const p1 = await officeProps(ui)
  expect(rowY(p1, 'n1')).toBe(17)
  expect(await drawnWho(ui)).toEqual(['lead', 'a1', 'a2', 'a3', ...Z, 'n1'].map(id => whoOf(p1, id)))
  await ui.advance(2000)
  expect(await drawnWho(ui)).toEqual(['lead', 'a1', 'a2', 'a3', ...Z, 'n1'].map(id => whoOf(p1, id)))
  expect(await withBg(ui)).toBe(false)
  await ui.unmount()
})

// (a mount, a scroll and presses through the kit: past the 5 s default under a full suite on a loaded machine with no code change — the budget is load headroom)
test('DESKTOP (2.4): THE WINDOW WITH OVERSCAN — a long office (past WINDOW_ROWS lines): the card drawn whole with its rows windowed by line, the body\'s lines and up to a body on each side (overscanOf), one spacer above and one below the table for the rest; a press on a drawn row opens it; a row outside the window draws no Button', { timeoutMs: 30_000 }, async ($, on) => {
  const many = Array.from({ length: 100 }, (_, i) => agent({ id: `a${i}` }))
  const { clock } = beneath(on, () => many, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, scroll: { offset: 40, bodyRows: 10 } } })
  const p = await officeProps(ui)
  expect(p.offset).toBe(40)
  expect(p.rows).toBe(10)
  const chrome = chromeRows(p)
  expect(chrome).toBe(CHROME_ROWS_SEARCH)   // (a hundred agents: the search field on its own line)
  const len = rowCount(p)
  expect(len).toBeGreaterThan(WINDOW_ROWS)  // a long office: windowed
  // the window the offset names (layout lines 34..43) and a body on each side: lines 24..53 (the cap leaves 10 at a 10-row body)
  const over = overscanOf(len, 10)
  expect(over).toBe(10)
  expect(windowOf(chrome, 40, 10, len, over)).toEqual({ from: 24, count: 30 })
  // the one card starts at line 0: no spacer before it; its rows in the window (lines 24..53 → a20..a49), the rest spacered
  expect(await kindsOf(ui)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  const card = (await cardsOf(ui))[0]!
  expect(rowsOf(card).map(r => r[1])).toEqual(Array.from({ length: 30 }, (_, i) => whoOf(p, `a${i + 20}`)))
  expect(rowY(p, 'a20')).toBe(24)
  // the table block: a column Box of the spacer for a0..a19 (above the window), the table, the spacer for a50..a99 — no spacer inside a column
  const [, , block] = elements(card)
  expect(propsOf(block)).toMatchObject({ flexDirection: 'column' })
  const [above, table, below] = elements(block)
  expect(above).toMatchObject({ type: 'Box', props: { height: 20 } })
  expect(table).toBe(tableOf(card))
  expect(below).toMatchObject({ type: 'Box', props: { height: 50 } })
  const [marks, ...values] = elements(table)
  expect(elements(marks).every(c => c.type === 'Text')).toBe(true)
  for (const col of values) expect(elements(col).every(c => c.type === 'Button' && elements(c).length === 1 && elements(c)[0]!.type === 'Text')).toBe(true)
  // a press on a30's row (in the window): its drawer opens, the focus on it; closed again
  await pressRow(ui, 'a30')
  const pd = await officeProps(ui)
  expect(pd.selected).toBe('a30')                                 // the press's `open` reached the hooks: a30's drawer
  // THE FLOATING OVERLAY over a WINDOWED office (phase B final review): the drawer at the engine's offset (40 — the window's
  // top, past the chrome), the column's margin and width, overlayHeight tall, on inverseText; the column under it as it was —
  // the same kinds, the block's spacers (20 above, 50 below) and the rows drawn (a20..a49) unchanged: the overlay takes no row
  const ov = await overlayOf(ui)
  expect(propsOf(ov)).toMatchObject({ key: 'drawer', position: 'absolute', top: 40, left: geometry(pd.columns).margin, width: geometry(pd.columns).W, height: overlayHeight(pd), backgroundColor: 'inverseText' })
  expect(overlayHeight(pd)).toBeGreaterThan(0)
  expect(await kindsOf(ui)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  const cardD = (await cardsOf(ui))[0]!
  const [, , blockD] = elements(cardD)
  const [aboveD, tableD, belowD] = elements(blockD)
  expect(aboveD).toMatchObject({ type: 'Box', props: { height: 20 } })
  expect(tableD).toBe(tableOf(cardD))
  expect(belowD).toMatchObject({ type: 'Box', props: { height: 50 } })
  expect(rowsOf(cardD).map(r => r[1])).toEqual(rowsOf(card).map(r => r[1]))
  await ui.press({ key: 'close' })
  expect((await officeProps(ui)).drawer).toBeNull()
  expect(await focused(ui, p)).toEqual([whoOf(p, 'a30')])
  // the rows outside the window (a19 above, a50 below) are spacer lines: no Button to press
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'agent:a19:who' })).toBeUndefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'agent:a50:who' })).toBeUndefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'agent:a20:who' })).toBeDefined()
  expect(await ui.find({ in: OFFICE_KEY, type: 'Button', key: 'agent:a49:who' })).toBeDefined()
  // no row hover: a move over a row tints nothing and changes no props
  const before = JSON.stringify(await officeProps(ui))
  await ui.pointer({ in: OFFICE_KEY, type: 'move', x: 30, y: chrome + rowY(p, 'a35') })
  expect(await withBg(ui)).toBe(false)
  expect(JSON.stringify(await officeProps(ui))).toBe(before)
  await ui.pointer({ in: OFFICE_KEY, type: 'leave', x: 0, y: 0 })
  await ui.unmount()
})

test('DESKTOP: a drawer or the settings opened while the pane is scrolled opens IN VIEW — THE FLOATING OVERLAY at the engine\'s offset (absolute on the root, at the column\'s margin and width, on inverseText, overlayHeight rows tall), the cards under it unmoved (no spacer, no fragment: a short office is drawn whole, the clicked row drawn and focused); at an offset inside the chrome, under the chrome; closed, the column is as before', { timeoutMs: 30_000 }, async ($, on) => {
  // 60 agents at 30 columns: one card of 67 lines (rows 4..63, the gap 66) — at most WINDOW_ROWS: drawn whole at any offset; a
  // 25-row window scrolled 40 rows down
  const many = Array.from({ length: 60 }, (_, i) => agent({ id: `a${i}` }))
  const { clock } = beneath(on, () => many, PREFS())
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  await clock.advance(POLL_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 30, scroll: { offset: 40, bodyRows: 25 } } })
  const p0 = await officeProps(ui)
  const geo = geometry(30)
  expect(p0.offset).toBe(40)
  expect(rowCount(p0)).toBe(67)
  expect(rowCount(p0)).toBeLessThanOrEqual(WINDOW_ROWS)
  expect(await kindsOf(ui)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  const before = rowsOf((await cardsOf(ui))[0]!)
  expect(before.map(r => r[1])).toEqual(Array.from({ length: 60 }, (_, i) => whoOf(p0, `a${i}`)))
  expect(await overlayOf(ui)).toBeUndefined()
  // a press on a36 (its row is layout line 40, inside the viewport)
  expect(rowY(p0, 'a36')).toBe(40)
  await pressRow(ui, 'a36')
  const p1 = await officeProps(ui)
  expect(p1.drawer?.id).toBe('a36')
  expect(p1.offset).toBe(40)                                         // nothing scrolled: the engine's window stays
  expect(chromeRows(p1)).toBe(CHROME_ROWS_SEARCH)                    // the drawer floats: no chrome row
  // the module's tree: the column as before (the chrome, the card whole — no spacer, no fragment), then THE DRAWER at Client row
  // 40 — the engine's offset, so it opens in the viewport's first rows
  expect(await kindsOf(ui)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  const drawer = await overlayOf(ui)
  expect(drawer).toMatchObject({ type: 'Box', props: { key: 'drawer', position: 'absolute', top: p1.offset, left: geo.margin, width: geo.W, height: overlayHeight(p1), backgroundColor: 'inverseText', borderStyle: 'round', borderColor: CARD_BORDER } })
  expect(propsOf(drawer).marginBottom).toBeUndefined()
  expect(textOf(drawer!)).toMatch(/משימה/)        // the drawer's task heading
  const open = rowsOf((await cardsOf(ui))[0]!)
  expect(open.map(r => r.slice(1))).toEqual(before.map(r => r.slice(1)))   // every row under it as it was (the focus marker aside)
  expect(await focused(ui, p1)).toEqual([whoOf(p1, 'a36')])          // the press's focus on its row
  // another row's press: its drawer replaces a36's at the same place, the focus moves there
  await pressRow(ui, 'a30')
  const p1b = await officeProps(ui)
  expect(p1b.drawer?.id).toBe('a30')
  expect(propsOf(await overlayOf(ui)).top).toBe(40)
  expect(await focused(ui, p1b)).toEqual([whoOf(p1b, 'a30')])
  // the settings (h) take the same place; h again closes them
  await ui.key({ in: OFFICE_KEY, key: 'h' })
  const p2 = await officeProps(ui)
  expect(p2.helpOpen).toBe(true)
  const help = await overlayOf(ui)
  expect(help).toMatchObject({ type: 'Box', props: { key: 'help', position: 'absolute', top: 40, left: geo.margin, width: geo.W, height: overlayHeight(p2), backgroundColor: 'inverseText' } })
  expect(overlayHeight(p2)).toBe(helpRows(30))
  expect(textOf(help!)).toContain(nb('k / j'))
  expect(textOf(help!)).toMatch(/הגדרות/)
  expect(await kindsOf(ui)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  await ui.key({ in: OFFICE_KEY, key: 'h' })
  // the drawer open again (a30's), the pane scrolled back into the chrome: the overlay under the fixed chrome, never over it
  await pressRow(ui, 'a30')
  await ui.redraw({ ...PANE.props, bodyColumns: 30, scroll: { offset: 2, bodyRows: 25 } })
  const p3 = await officeProps(ui)
  expect([p3.offset, p3.drawer?.id]).toEqual([2, 'a30'])
  expect(propsOf(await overlayOf(ui)).top).toBe(chromeRows(p3))
  // x closes it: no overlay, the column as before, the focus on a30's row
  await ui.key({ in: OFFICE_KEY, key: 'x' })
  const p4 = await officeProps(ui)
  expect(p4.drawer).toBeNull()
  expect(await overlayOf(ui)).toBeUndefined()
  expect(await kindsOf(ui)).toEqual(['header', 'toolbar', 'searchLine', 'round'])
  expect(rowsOf((await cardsOf(ui))[0]!).map(r => r.slice(1))).toEqual(before.map(r => r.slice(1)))
  expect(await focused(ui, p4)).toEqual([whoOf(p4, 'a30')])
  await ui.unmount()
})
