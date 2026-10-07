// office-svg.ts — the animated office for the DESKTOP surface, drawn as SVG.
//
// WHY: on the desktop the engine's Text/Button elements render at the app's
// font size, which the mod cannot change, so the text layout of ui.tsx looks
// crowded there. The remote surfaces (desktop, vscode, mobile) have an `Svg`
// element whose markup the mod controls entirely: fonts of 10–12 px, CSS
// keyframe animations, light/dark via prefers-color-scheme. This module draws
// the VS Code extension's office (claude_theater.py PAGE: a character bobbing
// at a desk, a glowing monitor in the tool-family colour, ⭐ just finished, ⏰
// long-running, dim finished, grayscale idle) — one SVG per ROOM (roomSvg), a
// fixed grid of ROOM_COLS tiles per row that scales to the pane's width.
//
// PURE: no `$`, no engine import, no state. Every string is XML-escaped here.
//
// ---------------------------------------------------------------------------
// API FINDINGS (claude-code.d.ts 2.1.288, grep SvgProps / BoxProps / Elements)
// ---------------------------------------------------------------------------
// - Elements['desktop'] = Box, Text, Button, Input, Select, Svg, Link, Code,
//   Markdown, Client. `vscode` and `mobile` have Svg too; `terminal` has none
//   (Raster/Image instead), so the text layout stays the terminal's.
// - SvgProps: { source (≤ 131072 chars), alt (required), width?, height? (CSS
//   px), isInteractive? }. width "absent, the box takes the markup's own width
//   up to the slot"; height "absent, the markup's own height at the drawn
//   width" — so a room SVG with a viewBox and NO width/height (markup or props)
//   scales to the slot: fonts shrink with a narrow pane. `isInteractive: true`
//   draws the SVG in a script-less sandboxed frame where CSS :hover, CSS/SMIL
//   animation and <title> tooltips work; absent, it is drawn as an image (static
//   — the animations freeze). Scripts and on* attributes are stripped either way.
// - Svg is a LEAF: "a press other plugins should see goes on an enclosing
//   Button" — but Button is ALSO a leaf (label or one string child, no element
//   children), and BoxProps has NO onPress (only `key` → hover scope, `hover`
//   style overrides). So an Svg itself cannot be pressed; the pressable things
//   are Buttons drawn next to it: ui.tsx draws one small numbered Button per
//   tile under the room SVG, and the tile carries the same number as a badge.
//
// ---------------------------------------------------------------------------
// STABILITY (the flicker fix)
// ---------------------------------------------------------------------------
// The interactive frame RELOADS whenever `source` changes, restarting every
// animation — so a source that changed on each 1.5 s poll (a mm:ss timer)
// flickered. Rule: a room's source is byte-identical between polls unless
// something VISIBLE changed. Hence:
// - no seconds anywhere: elapsed time is drawn at MINUTE resolution
//   (fmtMinutes: "<1m" / "3m" / "1h 5m", Hebrew "3 דק׳"); ui.tsx quantizes the
//   clock it passes to the wall-clock minute, so a room reloads at most once a
//   minute for its timers;
// - one-shot classes (`entering` walk-in, `justdone` hop + ⭐ pop) are passed
//   only on the poll that triggers them; the ⭐ badge itself stays (static)
//   for the JUST_FINISHED window;
// - everything else in the markup is a function of status / tool family / name
//   / model / badges / selection / focus / the tile's index.
//
// Everything else of the pane (header, toolbar, search, help, drawer, room
// header line, nav, footer) stays the engine's elements on every surface.

import type { Agent, TheaterStatus } from './model'
import { activityLabel, modelLabel, type Lang } from './i18n'
import { personaName } from './personas'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SvgProps.source hard limit (claude-code.d.ts). */
export const SVG_SOURCE_LIMIT = 131072
/** One agent tile, viewBox units (CSS px at scale 1). */
export const TILE_W = 88
export const TILE_H = 122
/** Gap between tiles in a room SVG. */
export const TILE_GAP = 4
/** Padding around the room's grid. */
export const ROOM_PAD = 4
/** Room SVG header height (the room title row), px; 0 without a title. */
export const ROOM_HEAD_H = 20
/** Tiles per row of a room SVG by default (the grid is fixed, the SVG scales). */
export const ROOM_COLS = 3
/** PAGE .entering: the walk-in lasts this long (ms); ui.tsx passes `entering` while within it. */
export const WALK_IN_MS = 700
/** Generous per-tile source estimate, so a room SVG is capped under the limit. */
export const TILE_SOURCE_ESTIMATE = 3000
/** The most tiles one roomSvg draws (the rest are counted in a "+N" label). */
export const MAX_TILES_PER_ROOM_SVG = Math.floor((SVG_SOURCE_LIMIT - 12000) / TILE_SOURCE_ESTIMATE)

/** Type scale (PAGE --fs-sm / --fs-xs, a touch smaller for the tile). */
export const FS_NAME = 11.5
export const FS_META = 10.5
export const FS_TIMER = 10
export const FS_HEAD = 24
export const FS_NUM = 9

/** Tool colour family (PAGE toolFamily): the monitor's glow. */
export type ToolFamily = '' | 'search' | 'read' | 'write' | 'cmd' | 'agent'

/** Per-agent decoration ui.tsx computes (it owns the clock and the live map); every field optional. */
export type TileDecor = {
  /** The card's clock, ms (drawn at minute resolution; quantize it for a stable source); null/undefined → no timer. */
  elapsedMs?: number | null
  /** ⭐ badge within JUST_FINISHED_MS (static; the hop + pop need `justdone`). */
  star?: boolean
  /** One-shot: the finish poll — hop + ⭐ pop animations. */
  justdone?: boolean
  /** ⏰ a live agent over LONG_RUNNING_MS. */
  longRunning?: boolean
  /** ❌ the live map says failed/killed. */
  failed?: boolean
  /** The drawer is open on this agent (accent frame). */
  selected?: boolean
  /** The arrow-key focus is here (dashed frame). */
  focused?: boolean
  /** One-shot: PAGE .entering, play the walk-in. */
  entering?: boolean
  /** The tile's number badge (1-based), matching the open Button under the room SVG. */
  index?: number
}

export type TileOpts = {
  lang: Lang
  /** The card's name (PAGE: role, else the persona). Defaults to that rule. */
  name?: string
  /** Draw the model tag line (default true). */
  showModel?: boolean
}

export type SvgOut = { source: string; width: number; height: number; alt: string }

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** XML-escapes text for an attribute or a text node and drops the characters XML 1.0 forbids. */
export function escapeXml(s: string): string {
  return (s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** PAGE toolFamily(): tool name → colour family. */
export function toolFamily(tool: string): ToolFamily {
  if (!tool) return ''
  if (tool.startsWith('mcp__')) return 'agent'
  if (/^(WebSearch|Grep|Glob)$/.test(tool)) return 'search'
  if (/^(Read|WebFetch)$/.test(tool)) return 'read'
  if (/^(Edit|Write|NotebookEdit|MultiEdit)$/.test(tool)) return 'write'
  if (/^(Bash|PowerShell|BashOutput|KillShell)$/.test(tool)) return 'cmd'
  if (/^(Task|Agent)$/.test(tool)) return 'agent'
  return ''
}

/** PAGE fmt(): mm:ss, "--:--" for null/negative (kept for callers that want seconds; the tiles never draw it). */
export function fmtClock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0 || !Number.isFinite(ms)) return '--:--'
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Elapsed time at MINUTE resolution — the tile's timer, so the source changes
 * at most once a minute: "<1m", "3m", "1h 5m" (Hebrew "<1 דק׳", "3 דק׳",
 * "1 ש׳ 5 דק׳"); "" for null / unknown.
 */
export function fmtMinutes(ms: number | null | undefined, lang: Lang): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return ''
  const he = lang === 'he'
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 1) return he ? '<1 דק׳' : '<1m'
  if (m < 60) return he ? `${m} דק׳` : `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return he ? `${h} ש׳ ${r} דק׳` : `${h}h ${r}m`
}

/**
 * Approximate advance of a string in px at `fontSize`: an emoji / wide glyph
 * ≈ 1.15 em, a combining mark / VS / ZWJ 0, a Hebrew letter ≈ 0.5 em, a Latin
 * glyph ≈ 0.55 em. Enough to budget a tile's line.
 */
export function textPx(s: string, fontSize: number): number {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0xfe0f || cp === 0xfe0e || cp === 0x200d || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x591 && cp <= 0x5c7)) continue
    if (cp > 0xffff || (cp >= 0x2300 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff)) w += 1.15
    else if (cp >= 0x5d0 && cp <= 0x5ea) w += 0.5
    else if (cp === 0x20 || cp === 0x2e || cp === 0x3a || cp === 0x2c) w += 0.3
    else w += 0.55
  }
  return w * fontSize
}

/** The most characters a tooltip / alt carries of one field (the tile's texts are fitted by px instead). */
export const ALT_CHAR_CAP = 120

/** Cuts `s` to ALT_CHAR_CAP characters (by code point), ending in "…" when cut. */
export function capChars(s: string, max = ALT_CHAR_CAP): string {
  const chars = [...(s ?? '')]
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() + '…' : s ?? ''
}

/** Cuts `s` from its END to fit `maxPx` at `fontSize`, ending in "…" when cut. */
export function fitText(s: string, maxPx: number, fontSize: number): string {
  if (textPx(s, fontSize) <= maxPx) return s
  const ell = textPx('…', fontSize)
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = textPx(ch, fontSize)
    if (used + w > maxPx - ell) break
    out += ch
    used += w
  }
  return out.trimEnd() + '…'
}

/** The viewBox width of a room SVG with `cols` tiles per row. */
export function roomWidth(cols: number): number {
  const c = Math.max(1, Math.floor(cols))
  return c * TILE_W + (c - 1) * TILE_GAP + 2 * ROOM_PAD
}

/** The x origin of column `col` (0-based from the START edge; RTL mirrors it) in a room of `cols`. */
export function tileX(col: number, cols: number, rtl: boolean): number {
  const c = rtl ? cols - 1 - col : col
  return ROOM_PAD + c * (TILE_W + TILE_GAP)
}

/** The classes of a tile's root group (PAGE .ws classes + data-fam as a class). */
export function tileClasses(a: Pick<Agent, 'status' | 'tool' | 'is_session'>, d: TileDecor): string {
  const fam = toolFamily(a.tool)
  const cls = ['ws', a.status]
  if (fam) cls.push(`fam-${fam}`)
  if (a.is_session) cls.push('is-session')
  if (d.star) cls.push('recent')
  if (d.justdone) cls.push('justdone')
  if (d.longRunning) cls.push('longrun')
  if (d.failed) cls.push('failed')
  if (d.selected) cls.push('selected')
  if (d.focused) cls.push('focused')
  if (d.entering) cls.push('entering')
  return cls.join(' ')
}

// ---------------------------------------------------------------------------
// The stylesheet (one copy per SVG; ~3.5 KB)
// ---------------------------------------------------------------------------

/**
 * The office's CSS: PAGE's tokens (dark default, light under
 * prefers-color-scheme: light), the character, the status classes and the
 * keyframes. `rtl` flips the walk-in direction (PAGE --walkin-x).
 */
export function officeStyle(rtl: boolean): string {
  const walk = rtl ? '66px' : '-66px'
  return `
:root{--bg:#121a30;--bg2:#0e1426;--ink:#e8ecff;--ink2:#dde4ff;--dim:#aeb8df;--dimmer:#97a2cf;--ok:#7ee29a;--idle:#e6c07e;--done:#9fb0e6;--accent:#5b6ee0;--act:#9db0e6;--actdone:#8fc09a;--hover:rgba(255,255,255,.06);--chair:#2b3360;--chair2:#1b2342;--torso:#5566cc;--shadow:rgba(0,0,0,.5);--num:#2b3360;--numt:#e8ecff}
@media (prefers-color-scheme: light){:root{--bg:#ffffff;--bg2:#f5f7fd;--ink:#1b2240;--ink2:#27314f;--dim:#4c577a;--dimmer:#5f6a8c;--ok:#1f8f4d;--idle:#9a6b12;--done:#3a4ea8;--accent:#3a4ad6;--act:#3a4ea8;--actdone:#1f8f4d;--hover:rgba(0,0,0,.05);--chair:#6b74a8;--chair2:#4d567f;--torso:#5566cc;--shadow:rgba(0,0,0,.28);--num:#dfe4f7;--numt:#1b2240}}
svg{font-family:"Segoe UI","Arial Hebrew",system-ui,sans-serif}
.bg{fill:transparent;rx:10}
.ws:hover .bg{fill:var(--hover)}
.ws.selected .frame{stroke:var(--accent);stroke-width:1.5}
.ws.focused .frame{stroke:var(--accent);stroke-dasharray:3 2}
.frame{fill:none;stroke:transparent;rx:10}
.shadow{fill:var(--shadow)}
.chair{fill:var(--chair)}
.torso{fill:var(--torso)}
.desk{fill:#a5743f}.desk2{fill:#5f3c1d}
.hand{fill:#f2c79a}
.screen{fill:#05070f;stroke:#1b2440;stroke-width:1}
.line{fill:#fff;opacity:0}
.head{font-size:${FS_HEAD}px;transform-box:fill-box;transform-origin:50% 90%}
.name{font-size:${FS_NAME}px;fill:var(--ink2);font-weight:600}
.is-session .name{fill:var(--ink);font-weight:700}
.act{font-size:${FS_META}px;fill:var(--act)}
.model{font-size:${FS_META}px;fill:var(--dimmer)}
.timer{font-size:${FS_TIMER}px;fill:var(--dimmer)}
.badge{font-size:12px}
.num{fill:var(--num);stroke:var(--accent);stroke-width:.75}
.numt{font-size:${FS_NUM}px;fill:var(--numt);font-weight:700}
.ws.selected .num{fill:var(--accent)}.ws.selected .numt{fill:#fff}
.done .act{fill:var(--actdone)}.stale .act{fill:var(--idle)}
.longrun .timer{fill:var(--idle);font-weight:600}
.running .head{animation:hbob 1s ease-in-out infinite}
@keyframes hbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
.running .hand.l{animation:tap .3s ease-in-out infinite}
.running .hand.r{animation:tap .3s ease-in-out infinite .15s}
@keyframes tap{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.running .screen{fill:#0c2;filter:drop-shadow(0 0 4px #1f8a4d)}
.running.fam-search .screen{fill:#16c0dd;filter:drop-shadow(0 0 4px #16c0dd)}
.running.fam-write .screen{fill:#e6a92e;filter:drop-shadow(0 0 4px #e6a92e)}
.running.fam-read .screen{fill:#5b8def;filter:drop-shadow(0 0 4px #5b8def)}
.running.fam-cmd .screen{fill:#1fc25a;filter:drop-shadow(0 0 4px #1fc25a)}
.running.fam-agent .screen{fill:#c45bd0;filter:drop-shadow(0 0 4px #c45bd0)}
.running .line{animation:typeline 1.4s ease-in-out infinite}
@keyframes typeline{0%{opacity:0;transform:translateX(-4px)}35%{opacity:.9}65%{opacity:.4}100%{opacity:0;transform:translateX(4px)}}
.done .screen{fill:#0a2f1c}
.done.fam-search .screen{fill:#0a3a44}.done.fam-write .screen{fill:#3a2c0c}.done.fam-read .screen{fill:#142544}.done.fam-agent .screen{fill:#331640}
.done .guy,.done .desk,.done .desk2,.done .chair{opacity:.55}
.done .name{fill:var(--dim)}
.stale .guy{filter:grayscale(.6) brightness(.72)}
.stale .head{animation:sway 3s ease-in-out infinite}
@keyframes sway{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}
.justdone .head{animation:hop .7s cubic-bezier(.2,1.4,.4,1)}
@keyframes hop{0%{transform:translateY(0)}30%{transform:translateY(-16px)}100%{transform:translateY(0)}}
.justdone .hands{animation:cheer .7s ease}
@keyframes cheer{0%{transform:translateY(0)}40%{transform:translateY(-13px)}100%{transform:translateY(0)}}
.justdone .star{animation:pop .4s ease}
@keyframes pop{0%{transform:scale(0)}70%{transform:scale(1.35)}100%{transform:scale(1)}}
.entering{animation:walkin .7s ease-out}
@keyframes walkin{0%{opacity:0;transform:translateX(${walk})}60%{opacity:1}100%{opacity:1;transform:translateX(0)}}
.entering .guy{animation:step .18s ease-in-out 3}
@keyframes step{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.failed .screen{fill:#7a1d22}
.room-title{font-size:${FS_NAME}px;fill:var(--ink2);font-weight:700}
.room-small{font-size:${FS_META}px;fill:var(--dimmer)}
@media (prefers-reduced-motion: reduce){.head,.hand,.line,.guy,.hands,.star,.entering{animation:none !important}}
`.trim()
}

// ---------------------------------------------------------------------------
// One agent: the character at the desk + four small text lines
// ---------------------------------------------------------------------------

/** The `alt` of a tile: what the drawing says, in `lang` (minute-resolution time: stable between polls). */
export function tileAlt(a: Agent, d: TileDecor, opts: TileOpts): string {
  const name = capChars(opts.name ?? (a.role || personaName(a.persona_id, opts.lang)))
  const bits = [`${d.index ? `${d.index}. ` : ''}${a.emoji} ${name}`, activityLabel(a, opts.lang)]
  const el = fmtMinutes(d.elapsedMs, opts.lang)
  if (el) bits.push(el)
  const model = opts.showModel === false ? '' : modelLabel(a.model)
  if (model) bits.push(`🧠 ${model}`)
  if (d.star) bits.push('⭐')
  if (d.longRunning) bits.push('⏰')
  if (d.failed) bits.push('❌')
  if (a.is_session) bits.push('💬')
  return bits.join(' · ')
}

/**
 * The tile's <title> (the hover tooltip): the full details the drawing
 * abbreviates — number + name, task_short, activity · 🧠 model · elapsed.
 */
export function tileTitle(a: Agent, d: TileDecor, opts: TileOpts): string {
  const name = capChars(opts.name ?? (a.role || personaName(a.persona_id, opts.lang)))
  const model = opts.showModel === false ? '' : modelLabel(a.model)
  const el = fmtMinutes(d.elapsedMs, opts.lang)
  const line3 = [activityLabel(a, opts.lang), model ? `🧠 ${model}` : '', el, d.longRunning ? '⏰' : '', d.failed ? '❌' : '', d.star ? '⭐' : ''].filter(Boolean).join(' · ')
  return [`${d.index ? `${d.index}. ` : ''}${a.emoji} ${name}`, capChars(a.task_short), line3].filter(Boolean).join('\n')
}

/**
 * The inner markup of one tile at origin (0,0), TILE_W × TILE_H: a `<g>` with
 * the status classes. Shared by agentTileSvg (one per SVG) and roomSvg (many).
 */
export function tileGroup(a: Agent, d: TileDecor, opts: TileOpts, x = 0, y = 0): string {
  const lang = opts.lang
  const rtl = lang === 'he'
  const dir = rtl ? 'rtl' : 'ltr'
  const cx = TILE_W / 2
  const name = opts.name ?? (a.role || personaName(a.persona_id, lang))
  const activity = activityLabel(a, lang)
  const model = opts.showModel === false ? '' : modelLabel(a.model)
  const el = fmtMinutes(d.elapsedMs, lang)
  const timer = el ? (d.longRunning ? '⏰ ' : '') + el : d.longRunning ? '⏰' : ''
  const maxPx = TILE_W - 8
  const nameT = escapeXml(fitText(name, maxPx, FS_NAME))
  const actT = escapeXml(fitText(activity, maxPx, FS_META))
  const modelT = model ? escapeXml(fitText(`🧠 ${model}`, maxPx, FS_META)) : ''
  const title = escapeXml(tileTitle(a, d, opts))
  const cls = tileClasses(a, d)
  // corner badges: start corner the number badge then 💬 (lead); end corner ⭐ / ❌ (inset-inline-end flips under RTL)
  const startX = rtl ? TILE_W - 10 : 10
  const start2X = rtl ? TILE_W - 24 : 24
  const endX = rtl ? 10 : TILE_W - 10
  const badges: string[] = []
  if (d.index) {
    badges.push(`<circle class="num" cx="${startX}" cy="10" r="6.5"/>`)
    badges.push(`<text class="numt" x="${startX}" y="13" text-anchor="middle" direction="ltr">${d.index}</text>`)
  }
  if (a.is_session) badges.push(`<text class="badge" x="${d.index ? start2X : startX}" y="13" text-anchor="middle">💬</text>`)
  if (d.failed) badges.push(`<text class="badge" x="${endX}" y="13" text-anchor="middle">❌</text>`)
  else if (d.star) badges.push(`<text class="badge star" x="${endX}" y="13" text-anchor="middle" style="transform-box:fill-box;transform-origin:center">⭐</text>`)
  const emoji = escapeXml(a.emoji || '🤖')
  // scene: y 6..70. shadow → chair → guy (torso, head) → desk → screen → hands
  const scene = [
    `<ellipse class="shadow" cx="${cx}" cy="68" rx="28" ry="3.5"/>`,
    `<rect class="chair" x="${cx - 15}" y="36" width="30" height="30" rx="8"/>`,
    `<g class="guy">`,
    `<rect class="torso" x="${cx - 13}" y="40" width="26" height="22" rx="10"/>`,
    `<text class="head" x="${cx}" y="42" text-anchor="middle">${emoji}</text>`,
    `</g>`,
    `<rect class="desk2" x="${cx - 32}" y="58" width="64" height="12" rx="3"/>`,
    `<rect class="desk" x="${cx - 32}" y="56" width="64" height="4" rx="2"/>`,
    `<rect class="screen" x="${cx - 8}" y="45" width="16" height="12" rx="2"/>`,
    `<rect class="line" x="${cx - 6}" y="48" width="12" height="1"/>`,
    `<g class="hands">`,
    `<circle class="hand l" cx="${cx - 16}" cy="56" r="4"/>`,
    `<circle class="hand r" cx="${cx + 16}" cy="56" r="4"/>`,
    `</g>`,
  ].join('')
  const text = [
    `<text class="name" x="${cx}" y="82" text-anchor="middle" direction="${dir}" unicode-bidi="embed">${nameT}</text>`,
    `<text class="act" x="${cx}" y="94" text-anchor="middle" direction="${dir}" unicode-bidi="embed">${actT}</text>`,
    modelT ? `<text class="model" x="${cx}" y="105" text-anchor="middle" direction="${dir}" unicode-bidi="embed">${modelT}</text>` : '',
    timer ? `<text class="timer" x="${cx}" y="${modelT ? 116 : 105}" text-anchor="middle" direction="ltr" unicode-bidi="embed">${escapeXml(timer)}</text>` : '',
  ].join('')
  return (
    `<g class="${cls}" transform="translate(${x} ${y})" data-id="${escapeXml(a.id)}">` +
    `<title>${title}</title>` +
    `<rect class="bg" x="0" y="0" width="${TILE_W}" height="${TILE_H}"/>` +
    `<rect class="frame" x="0.75" y="0.75" width="${TILE_W - 1.5}" height="${TILE_H - 1.5}"/>` +
    scene + badges.join('') + text +
    `</g>`
  )
}

/**
 * The SVG document's opening tag (xml:lang, direction) and the shared style.
 * `fixed` writes width/height attributes (a single tile drawn at its own
 * size); without them the markup has only a viewBox and scales to the slot.
 */
function svgOpen(width: number, height: number, lang: Lang, label: string, fixed: boolean): string {
  const rtl = lang === 'he'
  const size = fixed ? `width="${width}" height="${height}" ` : 'preserveAspectRatio="xMidYMin meet" '
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ${size}` +
    `xml:lang="${lang}" lang="${lang}" direction="${rtl ? 'rtl' : 'ltr'}" role="img" aria-label="${escapeXml(label)}">` +
    `<style>${officeStyle(rtl)}</style>`
  )
}

/** One agent as a small animated tile (TILE_W × TILE_H) at its own size. */
export function agentTileSvg(a: Agent, d: TileDecor, opts: TileOpts): SvgOut {
  const alt = tileAlt(a, d, opts)
  const source = svgOpen(TILE_W, TILE_H, opts.lang, alt, true) + tileGroup(a, d, opts) + '</svg>'
  return { source, width: TILE_W, height: TILE_H, alt }
}

// ---------------------------------------------------------------------------
// A whole room in one SVG
// ---------------------------------------------------------------------------

export type RoomOpts = TileOpts & {
  /** The room title (topic or project), drawn at the start edge; "" draws no header. */
  title?: string
  /** A small label at the far edge of the header (project / session id). */
  small?: string
  /** Per-agent names; defaults to PAGE's rule (role, else persona). */
  nameOf?: (a: Agent) => string
  /** Tiles per row (default ROOM_COLS); the viewBox width follows, the SVG scales to the slot. */
  cols?: number
}

/**
 * All of a room's agents laid in a fixed grid of `cols` per row (the first
 * tile at the START edge: the right under RTL), header row included, numbered
 * 1..N (decor.index when the caller gives none). The root has a viewBox and no
 * width/height, so an `<Svg>` without width/height props scales it to the
 * slot. Over MAX_TILES_PER_ROOM_SVG agents the rest are a "+N" label, so the
 * source stays under SVG_SOURCE_LIMIT. `width`/`height` are the viewBox's.
 */
export function roomSvg(agents: readonly Agent[], decors: ReadonlyMap<string, TileDecor> | Record<string, TileDecor>, opts: RoomOpts): SvgOut {
  const lang = opts.lang
  const rtl = lang === 'he'
  const cols = Math.max(1, Math.floor(opts.cols ?? ROOM_COLS))
  const width = roomWidth(cols)
  const shown = agents.slice(0, MAX_TILES_PER_ROOM_SVG)
  const extra = agents.length - shown.length
  const rows = Math.max(1, Math.ceil((shown.length + (extra > 0 ? 1 : 0)) / cols))
  const headH = opts.title ? ROOM_HEAD_H : 0
  const height = headH + ROOM_PAD + rows * TILE_H + (rows - 1) * TILE_GAP + ROOM_PAD
  const decorOf = (id: string, i: number): TileDecor => {
    const d = (decors instanceof Map ? decors.get(id) : (decors as Record<string, TileDecor>)[id]) ?? {}
    return d.index ? d : { ...d, index: i + 1 }
  }
  const parts: string[] = []
  if (opts.title) {
    const tx = rtl ? width - 8 : 8
    const anchor = rtl ? 'end' : 'start'
    const smallT = opts.small ? fitText(opts.small, width * 0.3, FS_META) : ''
    const smallPx = smallT ? textPx(smallT, FS_META) + 8 : 0
    const titleT = escapeXml(fitText(`💬 ${opts.title}`, width - 16 - smallPx, FS_NAME))
    parts.push(`<text class="room-title" x="${tx}" y="14" text-anchor="${anchor}" direction="${rtl ? 'rtl' : 'ltr'}" unicode-bidi="embed">${titleT}</text>`)
    if (smallT) {
      const sx = rtl ? 8 : width - 8
      parts.push(`<text class="room-small" x="${sx}" y="14" text-anchor="${rtl ? 'start' : 'end'}" direction="ltr">${escapeXml(smallT)}</text>`)
    }
  }
  const tileOpts = (a: Agent): TileOpts => ({ lang, name: opts.nameOf ? opts.nameOf(a) : undefined, showModel: opts.showModel })
  shown.forEach((a, i) => {
    const x = tileX(i % cols, cols, rtl)
    const y = headH + ROOM_PAD + Math.floor(i / cols) * (TILE_H + TILE_GAP)
    parts.push(tileGroup(a, decorOf(a.id, i), tileOpts(a), x, y))
  })
  if (extra > 0) {
    const i = shown.length
    const x = tileX(i % cols, cols, rtl) + TILE_W / 2
    const y = headH + ROOM_PAD + Math.floor(i / cols) * (TILE_H + TILE_GAP) + TILE_H / 2
    parts.push(`<text class="name" x="${x}" y="${y}" text-anchor="middle" direction="ltr">+${extra}</text>`)
  }
  const alt = [opts.title ? `💬 ${opts.title}` : '', ...shown.map((a, i) => tileAlt(a, decorOf(a.id, i), tileOpts(a)))]
    .filter(Boolean).join(' | ')
  const source = svgOpen(width, height, lang, alt, false) + parts.join('') + '</svg>'
  return { source, width, height, alt }
}

/** True when a source fits SvgProps.source. */
export function fitsSvgLimit(source: string): boolean {
  return source.length <= SVG_SOURCE_LIMIT
}

/** The status → colour token name used by the stylesheet (for a caller that wants to match chrome). */
export function statusColor(status: TheaterStatus): string {
  return status === 'running' ? 'var(--ok)' : status === 'stale' ? 'var(--idle)' : 'var(--done)'
}
