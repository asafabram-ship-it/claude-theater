// office-svg.ts: the desktop office tiles. Pure: no engine, no surface — the
// SVG source is asserted as a string (escaping, RTL, sizes, every status and
// badge, the model tag, light/dark style, the room grid and the size cap).

import type { Agent } from './model'
import { PERSONA_EMOJI } from './model'
import { expect, test } from 'claude-code/testing'

import {
  ALT_CHAR_CAP, FS_META, FS_NAME, FS_TIMER, MAX_TILES_PER_ROOM_SVG, ROOM_COLS, ROOM_HEAD_H, ROOM_PAD, SVG_SOURCE_LIMIT, TILE_GAP, TILE_H, TILE_W,
  agentTileSvg, escapeXml, fitText, fitsSvgLimit, fmtClock, fmtMinutes, officeStyle, roomSvg, roomWidth, textPx, tileAlt, tileClasses, tileTitle, tileX, toolFamily,
  type TileDecor,
} from './office-svg'

const T0 = 1_700_000_000_000
const S = 'sess-aaaa-1111-frontend'

function agent(over: Partial<Agent> & { id: string }): Agent {
  const task = over.task ?? `Task of ${over.id}. More words.`
  return {
    persona_id: 3, emoji: PERSONA_EMOJI[3] ?? '', role: '', subagent_type: '', status: 'running', tool: 'Read', phase: 'tool',
    task, task_short: task.split('. ')[0] + '.', result: null, start_ms: T0 - 30_000, end_ms: null,
    session: S.slice(0, 8), session_full: S, cwd: '/home/dev/acme-web', project: '/home/dev/acme-web', mtime_ms: T0 - 1000,
    is_session: false, closed: false, is_workflow: false, truncated: false, model: '', ...over,
  }
}

test('escapeXml: the five XML specials and forbidden control characters', () => {
  expect(escapeXml(`a<b>&"c'\u0001d`)).toBe('a&lt;b&gt;&amp;&quot;c&apos;d')
  expect(escapeXml('')).toBe('')
  expect(escapeXml('שלום')).toBe('שלום')
})

test('a tile escapes every text it draws: role, task, tool-less activity, emoji, id', () => {
  const a = agent({ id: 'x<y>&"z\'', role: '<script>alert("x")</script> & co', task: 'Bad <task> & "quotes"', emoji: '<🤖>' })
  const { source } = agentTileSvg(a, {}, { lang: 'en' })
  expect(source.includes('<script>')).toBe(false)
  expect(source.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co')).toBe(true)
  expect(source.includes('<task>')).toBe(false)
  expect(source.includes('data-id="x&lt;y&gt;&amp;&quot;z&apos;"')).toBe(true)
  expect(source.includes('&lt;🤖&gt;')).toBe(true)
  // well-formed enough: every <text> closes, the document closes
  expect((source.match(/<text\b/g) ?? []).length).toBe((source.match(/<\/text>/g) ?? []).length)
  expect(source.endsWith('</svg>')).toBe(true)
})

test('RTL: Hebrew tiles carry xml:lang="he", direction="rtl" on the root and the texts; the timer stays ltr; English is ltr', () => {
  const a = agent({ id: 'h1', role: 'סקירת אבטחה', model: 'claude-opus-5-5' })
  const he = agentTileSvg(a, { elapsedMs: 61_000 }, { lang: 'he' }).source
  expect(he.includes('xml:lang="he"')).toBe(true)
  expect(he.includes('direction="rtl"')).toBe(true)
  expect(he.includes('class="name" x="44" y="82" text-anchor="middle" direction="rtl" unicode-bidi="embed">סקירת אבטחה<')).toBe(true)
  expect(he.includes('class="act" x="44" y="94" text-anchor="middle" direction="rtl"')).toBe(true)
  expect(he.includes('class="timer" x="44" y="116" text-anchor="middle" direction="ltr" unicode-bidi="embed">1 דק׳<')).toBe(true)
  expect(he.includes('📖 קורא')).toBe(true) // activityLabel in Hebrew
  // the walk-in flips with the direction
  expect(officeStyle(true).includes('translateX(66px)')).toBe(true)
  expect(officeStyle(false).includes('translateX(-66px)')).toBe(true)
  const en = agentTileSvg(a, {}, { lang: 'en' }).source
  expect(en.includes('xml:lang="en"')).toBe(true)
  expect(en.includes('direction="rtl"')).toBe(false)
  expect(en.includes('📖 Reading')).toBe(true)
})

test('small type: the stylesheet pins the name, meta and timer sizes and the fonts', () => {
  const css = officeStyle(false)
  expect(css.includes(`.name{font-size:${FS_NAME}px`)).toBe(true)
  expect(css.includes(`.act{font-size:${FS_META}px`)).toBe(true)
  expect(css.includes(`.model{font-size:${FS_META}px`)).toBe(true)
  expect(css.includes(`.timer{font-size:${FS_TIMER}px`)).toBe(true)
  expect(FS_NAME <= 12 && FS_NAME >= 11).toBe(true)
  expect(FS_META <= 11 && FS_META >= 10).toBe(true)
  expect(css.includes('"Segoe UI","Arial Hebrew"')).toBe(true)
})

test('light and dark: dark tokens by default, light under prefers-color-scheme, motion off under reduced-motion', () => {
  const css = officeStyle(false)
  expect(css.includes('@media (prefers-color-scheme: light)')).toBe(true)
  expect(css.includes('--ink:#e8ecff')).toBe(true) // dark
  expect(css.includes('--ink:#1b2240')).toBe(true) // light
  expect(css.includes('@media (prefers-reduced-motion: reduce)')).toBe(true)
  // the style is inside every SVG
  expect(agentTileSvg(agent({ id: 'a' }), {}, { lang: 'en' }).source.includes('<style>')).toBe(true)
})

test('every status is drawn with its class and animation hooks', () => {
  const running = agentTileSvg(agent({ id: 'r', status: 'running' }), {}, { lang: 'en' }).source
  expect(running.includes('class="ws running fam-read"')).toBe(true)
  expect(running.includes('.running .head{animation:hbob')).toBe(true)
  expect(running.includes('.running .hand.l{animation:tap')).toBe(true)
  expect(running.includes('.running .line{animation:typeline')).toBe(true)
  const stale = agentTileSvg(agent({ id: 's', status: 'stale' }), {}, { lang: 'en' }).source
  expect(stale.includes('class="ws stale fam-read"')).toBe(true)
  expect(stale.includes('.stale .guy{filter:grayscale')).toBe(true)
  expect(stale.includes('💤 Idle')).toBe(true)
  const done = agentTileSvg(agent({ id: 'd', status: 'done', tool: 'Write' }), {}, { lang: 'en' }).source
  expect(done.includes('class="ws done fam-write"')).toBe(true)
  expect(done.includes('.done .guy,.done .desk,.done .desk2,.done .chair{opacity:.55}')).toBe(true) // dim
  expect(done.includes('✅ Done')).toBe(true)
})

test('badges: ⭐ just finished (hop + pop), ⏰ long-running in the timer, ❌ failed, 💬 lead; none when undecorated', () => {
  const plain = agentTileSvg(agent({ id: 'p' }), { elapsedMs: 5000 }, { lang: 'en' }).source
  expect(plain.includes('⭐')).toBe(false)
  expect(plain.includes('⏰')).toBe(false)
  expect(plain.includes('❌')).toBe(false)
  expect(plain.includes('💬')).toBe(false)
  expect(plain.includes('>&lt;1m<')).toBe(true) // minute resolution: no seconds anywhere
  expect(plain.includes('00:05')).toBe(false)

  // the ⭐ badge stays for the window; the hop + pop play only with the one-shot `justdone`
  const star = agentTileSvg(agent({ id: 'st', status: 'done' }), { star: true, justdone: true, elapsedMs: 90_000 }, { lang: 'en' }).source
  expect(star.includes('class="badge star"')).toBe(true)
  expect(star.includes('⭐')).toBe(true)
  expect(star.includes(' recent justdone')).toBe(true)
  expect(star.includes('.justdone .head{animation:hop')).toBe(true)
  expect(star.includes('.justdone .star{animation:pop')).toBe(true)
  const starLater = agentTileSvg(agent({ id: 'st', status: 'done' }), { star: true, elapsedMs: 90_000 }, { lang: 'en' }).source
  expect(starLater.includes('⭐')).toBe(true)
  expect(starLater.includes(' recent')).toBe(true)
  expect(/class="ws[^"]*justdone/.test(starLater)).toBe(false) // (the stylesheet still names the class)

  const long = agentTileSvg(agent({ id: 'lg' }), { longRunning: true, elapsedMs: 11 * 60_000 }, { lang: 'en' }).source
  expect(long.includes('>⏰ 11m<')).toBe(true)
  expect(long.includes(' longrun')).toBe(true)
  expect(long.includes('.longrun .timer{fill:var(--idle)')).toBe(true)

  const failed = agentTileSvg(agent({ id: 'f', status: 'done' }), { failed: true, star: true }, { lang: 'en' }).source
  expect(failed.includes('❌')).toBe(true)
  expect(failed.includes('class="badge star"')).toBe(false) // ❌ takes the corner
  expect(failed.includes(' failed')).toBe(true)

  const lead = agentTileSvg(agent({ id: 'l', is_session: true, tool: '', phase: 'thinking' }), {}, { lang: 'he' }).source
  expect(lead.includes('💬')).toBe(true)
  expect(lead.includes(' is-session')).toBe(true)
  expect(lead.includes('🤔 חושב')).toBe(true)
  // RTL puts the lead's 💬 at the right (start) edge, the ⭐ at the left (end) edge
  expect(lead.includes(`x="${TILE_W - 10}" y="13" text-anchor="middle">💬`)).toBe(true)
  const starHe = agentTileSvg(agent({ id: 'sh', status: 'done' }), { star: true }, { lang: 'he' }).source
  expect(starHe.includes('x="10" y="13" text-anchor="middle" style="transform-box:fill-box;transform-origin:center">⭐')).toBe(true)

  const sel = agentTileSvg(agent({ id: 'se' }), { selected: true, focused: true, entering: true }, { lang: 'en' }).source
  expect(sel.includes(' selected')).toBe(true)
  expect(sel.includes(' focused')).toBe(true)
  expect(sel.includes(' entering')).toBe(true)
  expect(sel.includes('.entering{animation:walkin')).toBe(true)
})

test('the model tag: 🧠 + modelLabel on its own line, timer below it; no line and a higher timer without a model', () => {
  const withModel = agentTileSvg(agent({ id: 'm', model: 'claude-haiku-4-5-20251001' }), { elapsedMs: 0 }, { lang: 'en' }).source
  expect(withModel.includes('class="model"')).toBe(true)
  expect(withModel.includes('🧠 Haiku 4.5')).toBe(true)
  expect(withModel.includes('class="timer" x="44" y="116"')).toBe(true)
  const noModel = agentTileSvg(agent({ id: 'n', model: '' }), { elapsedMs: 0 }, { lang: 'en' }).source
  expect(noModel.includes('class="model"')).toBe(false)
  expect(noModel.includes('class="timer" x="44" y="105"')).toBe(true)
  const hidden = agentTileSvg(agent({ id: 'h', model: 'claude-opus-5-5' }), {}, { lang: 'en', showModel: false }).source
  expect(hidden.includes('🧠')).toBe(false)
  // the alt names it too
  expect(tileAlt(agent({ id: 'm', model: 'claude-opus-5-5' }), { star: true }, { lang: 'en' })).toBe('🔬 The Researcher · 📖 Reading · 🧠 Opus 5.5 · ⭐')
  expect(tileAlt(agent({ id: 'm', model: 'claude-opus-5-5' }), { elapsedMs: 150_000, index: 2 }, { lang: 'en' })).toBe('2. 🔬 The Researcher · 📖 Reading · 2m · 🧠 Opus 5.5')
  // the tooltip carries the full details: number + name, task_short, activity · model · elapsed
  expect(tileTitle(agent({ id: 'm', role: 'map tokens', model: 'claude-opus-5-5' }), { elapsedMs: 150_000, index: 2, longRunning: true }, { lang: 'en' }))
    .toBe('2. 🔬 map tokens\nTask of m.\n📖 Reading · 🧠 Opus 5.5 · 2m · ⏰')
  const titled = agentTileSvg(agent({ id: 'm', role: 'map tokens', task: 'Audit <everything> & more. Then stop.' }), { index: 3 }, { lang: 'en' }).source
  expect(titled.includes('<title>3. 🔬 map tokens\nAudit &lt;everything&gt; &amp; more.\n📖 Reading</title>')).toBe(true)
  expect(titled.includes('class="numt" x="10" y="13" text-anchor="middle" direction="ltr">3<')).toBe(true)
  // RTL: the number badge sits at the start (right) corner, the lead's 💬 beside it
  const heLead = agentTileSvg(agent({ id: 'l', is_session: true }), { index: 1 }, { lang: 'he' }).source
  expect(heLead.includes(`class="numt" x="${TILE_W - 10}"`)).toBe(true)
  expect(heLead.includes(`x="${TILE_W - 24}" y="13" text-anchor="middle">💬`)).toBe(true)
})

test('tool families colour the monitor: search / read / write / cmd / agent (MCP too), unknown none', () => {
  expect(toolFamily('Grep')).toBe('search')
  expect(toolFamily('WebFetch')).toBe('read')
  expect(toolFamily('MultiEdit')).toBe('write')
  expect(toolFamily('PowerShell')).toBe('cmd')
  expect(toolFamily('Agent')).toBe('agent')
  expect(toolFamily('mcp__github__search_issues')).toBe('agent')
  expect(toolFamily('Skill')).toBe('')
  expect(toolFamily('')).toBe('')
  expect(tileClasses({ status: 'running', tool: 'Bash', is_session: false }, {})).toBe('ws running fam-cmd')
  expect(tileClasses({ status: 'done', tool: '', is_session: true }, { star: true, failed: true })).toBe('ws done is-session recent failed')
  expect(tileClasses({ status: 'done', tool: '', is_session: false }, { star: true, justdone: true })).toBe('ws done recent justdone')
  const css = officeStyle(false)
  for (const fam of ['search', 'write', 'read', 'cmd', 'agent']) expect(css.includes(`.running.fam-${fam} .screen{fill:`)).toBe(true)
})

test('names and labels are cut from their end to the tile width; the clock formats like PAGE fmt', () => {
  const long = 'draft the v2 migration guide for the whole platform and its forty plugins'
  const fitted = fitText(long, TILE_W - 8, FS_NAME)
  expect(fitted.endsWith('…')).toBe(true)
  expect(fitted.length < long.length).toBe(true)
  expect(textPx(fitted, FS_NAME) <= TILE_W - 8).toBe(true)
  expect(fitText('short', 200, FS_NAME)).toBe('short')
  const src = agentTileSvg(agent({ id: 'lg', role: long }), {}, { lang: 'en' }).source
  expect(src.includes(escapeXml(fitted))).toBe(true)
  expect(fmtClock(null)).toBe('--:--')
  expect(fmtClock(-1)).toBe('--:--')
  expect(fmtClock(61_000)).toBe('01:01')
  expect(fmtClock(3_599_000)).toBe('59:59')
  // the tiles' timer: minutes only, so the source changes at most once a minute
  expect(fmtMinutes(null, 'en')).toBe('')
  expect(fmtMinutes(-5, 'en')).toBe('<1m')
  expect(fmtMinutes(59_999, 'en')).toBe('<1m')
  expect(fmtMinutes(60_000, 'en')).toBe('1m')
  expect(fmtMinutes(3_599_000, 'en')).toBe('59m')
  expect(fmtMinutes(65 * 60_000, 'en')).toBe('1h 5m')
  expect(fmtMinutes(30_000, 'he')).toBe('<1 דק׳')
  expect(fmtMinutes(180_000, 'he')).toBe('3 דק׳')
  expect(fmtMinutes(125 * 60_000, 'he')).toBe('2 ש׳ 5 דק׳')
})

test('a tile reports its size and fits the Svg limit by a wide margin', () => {
  const out = agentTileSvg(agent({ id: 'z', role: 'x'.repeat(500), task: 'y'.repeat(2000), model: 'claude-opus-5-5' }), { star: true, longRunning: true, selected: true }, { lang: 'he' })
  expect(out.width).toBe(TILE_W)
  expect(out.height).toBe(TILE_H)
  expect(out.source.length < 7000).toBe(true) // the style (~4.5 KB) + one tile; long fields are capped (ALT_CHAR_CAP) in title/alt
  expect(out.source.includes('x'.repeat(200))).toBe(false)
  expect(out.alt.includes('x'.repeat(ALT_CHAR_CAP) + '…')).toBe(true)
  expect(fitsSvgLimit(out.source)).toBe(true)
  expect(out.source.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 122" width="88" height="122"')).toBe(true)
  expect(out.alt.length > 0).toBe(true)
})

test('the room grid is fixed: ROOM_COLS per row by default, the viewBox width follows, RTL mirrors the columns', () => {
  expect(ROOM_COLS).toBe(3)
  expect(roomWidth(3)).toBe(3 * TILE_W + 2 * TILE_GAP + 2 * ROOM_PAD)
  expect(roomWidth(1)).toBe(TILE_W + 2 * ROOM_PAD)
  expect(tileX(0, 3, false)).toBe(ROOM_PAD)
  expect(tileX(1, 3, false)).toBe(ROOM_PAD + TILE_W + TILE_GAP)
  expect(tileX(0, 3, true)).toBe(ROOM_PAD + 2 * (TILE_W + TILE_GAP)) // the first tile at the right edge
  expect(tileX(2, 3, true)).toBe(ROOM_PAD)
})

test('roomSvg: viewBox only (no width/height — it scales to the slot), header, a fixed grid, RTL fills from the right, numbered tiles, decors by id, under the limit even for a huge room', () => {
  const agents = [
    agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking', task: 'Ship the v2 config migration. Then clean up.' }),
    agent({ id: 'a1', role: 'map session-token validation', model: 'claude-opus-5-5' }),
    agent({ id: 'a2', role: 'draft the guide', status: 'done', tool: 'Write' }),
    agent({ id: 'a3', role: 'fourth', tool: 'Grep' }),
  ]
  const decors = new Map([['a2', { star: true, elapsedMs: 120_000 }], ['a1', { elapsedMs: 30_000 }]])
  const en = roomSvg(agents, decors, { lang: 'en', title: 'Ship the v2 config migration.', small: 'acme-web' })
  const W = roomWidth(3)
  expect(en.width).toBe(W)
  expect(en.height).toBe(ROOM_HEAD_H + ROOM_PAD + 2 * TILE_H + TILE_GAP + ROOM_PAD) // 4 tiles → two rows of 3
  expect(en.source.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${en.height}" preserveAspectRatio="xMidYMin meet" xml:lang="en"`)).toBe(true)
  expect(/<svg [^>]*\bwidth=/.test(en.source)).toBe(false)
  expect(/<svg [^>]*\bheight=/.test(en.source)).toBe(false)
  expect(en.source.includes('class="room-title" x="8" y="14" text-anchor="start"')).toBe(true)
  expect(en.source.includes('💬 Ship the v2 config migration.')).toBe(true)
  expect(en.source.includes('>acme-web<')).toBe(true)
  expect(en.source.includes('data-id="lead"')).toBe(true)
  expect(en.source.includes('>2m<')).toBe(true) // a2's decor
  expect(en.source.includes('>&lt;1m<')).toBe(true) // a1's decor
  expect(en.source.includes('class="badge star"')).toBe(true)
  // numbered 1..N in display order (the badge matches the open Button under the SVG)
  for (let i = 0; i < 4; i++) expect(en.source.includes(`text-anchor="middle" direction="ltr">${i + 1}</text>`)).toBe(true)
  expect(en.alt.startsWith('💬 Ship the v2 config migration. | 1. ')).toBe(true)
  // the lead (first) sits at the left in LTR, the fourth starts the second row...
  const y0 = ROOM_HEAD_H + ROOM_PAD
  expect(en.source.includes(`translate(${tileX(0, 3, false)} ${y0})" data-id="lead"`)).toBe(true)
  expect(en.source.includes(`translate(${tileX(0, 3, false)} ${y0 + TILE_H + TILE_GAP})" data-id="a3"`)).toBe(true)
  // ...and at the right in RTL
  const he = roomSvg(agents, {}, { lang: 'he', title: 'שליחת גרסה 2' })
  expect(he.source.includes(`translate(${tileX(0, 3, true)} ${y0})" data-id="lead"`)).toBe(true)
  expect(he.source.includes(`class="room-title" x="${W - 8}" y="14" text-anchor="end" direction="rtl"`)).toBe(true)
  expect(he.source.includes('xml:lang="he"')).toBe(true)
  // the title is cut from its END by px, keeping its beginning
  const longTitle = roomSvg(agents, {}, { lang: 'en', title: 'Session without choosing a project and a very long rest of the sentence that cannot fit' })
  expect(longTitle.source.includes('💬 Session without')).toBe(true)
  expect(longTitle.source.includes('cannot fit<')).toBe(false)
  expect(/room-title[^>]*>[^<]*…</.test(longTitle.source)).toBe(true)
  // no title: no header row
  expect(roomSvg(agents, {}, { lang: 'en' }).height).toBe(ROOM_PAD + 2 * TILE_H + TILE_GAP + ROOM_PAD)
  // more columns on request
  expect(roomSvg(agents, {}, { lang: 'en', cols: 4 }).width).toBe(roomWidth(4))
  expect(roomSvg(agents, {}, { lang: 'en', cols: 4 }).height).toBe(ROOM_PAD + TILE_H + ROOM_PAD)
  // a record of decors works like the map
  expect(roomSvg(agents, { a1: { elapsedMs: 59 * 60_000 } }, { lang: 'en' }).source.includes('>59m<')).toBe(true)
  // huge: capped, "+N" drawn, under the limit
  const many: Agent[] = []
  for (let i = 0; i < MAX_TILES_PER_ROOM_SVG + 25; i++) many.push(agent({ id: `m${i}`, role: `agent number ${i} with a long role name`, model: 'claude-sonnet-5-5', task: 'z'.repeat(300) }))
  const big = roomSvg(many, {}, { lang: 'he', title: 'כותרת' })
  expect(fitsSvgLimit(big.source)).toBe(true)
  expect(big.source.length <= SVG_SOURCE_LIMIT).toBe(true)
  expect(big.source.includes('>+25<')).toBe(true)
  expect((big.source.match(/data-id="m/g) ?? []).length).toBe(MAX_TILES_PER_ROOM_SVG)
})

test('STABLE SOURCE: two renders 1.5 s apart are byte-identical for a running agent; a phase / tool change, a new badge or a selection changes it', () => {
  const agents = [agent({ id: 'lead', is_session: true, tool: '', phase: 'thinking' }), agent({ id: 'a1', role: 'map tokens', model: 'claude-opus-5-5' })]
  const at = (ms: number, over: Partial<Agent> = {}, d: TileDecor = {}) =>
    roomSvg(agents.map(a => (a.id === 'a1' ? { ...a, ...over } : a)), { lead: { elapsedMs: 5000 }, a1: { elapsedMs: ms, ...d } }, { lang: 'he', title: 'שליחת גרסה 2', small: 'acme-web' })
  const t1 = at(30_000)
  const t2 = at(31_500)
  expect(t2.source).toBe(t1.source)
  expect(t2.alt).toBe(t1.alt)
  // a whole minute later the timer line changes — once
  expect(at(90_000).source).not.toBe(t1.source)
  expect(at(91_500).source).toBe(at(90_000).source)
  // visible changes: the tool family, the phase, a ⭐, the selection, the walk-in
  expect(at(31_500, { tool: 'Write' }).source).not.toBe(t1.source)
  expect(at(31_500, { phase: 'thinking', tool: '' }).source).not.toBe(t1.source)
  expect(at(31_500, { status: 'done' }, { star: true }).source).not.toBe(t1.source)
  expect(at(31_500, {}, { selected: true }).source).not.toBe(t1.source)
  expect(at(31_500, {}, { entering: true }).source).not.toBe(t1.source)
})
