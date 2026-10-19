// I18N: the Hebrew/English strings and the tool → activity label tables,
// ported from PAGE (claude_theater.py). Hebrew is the default (RTL).
//
// OWNER: builder "ui". The server-only strings of PAGE (reconnecting, version
// banner, skipped-lines/report) are dropped per the spec ("יורד").
//
// THE HEBREW RULE (Asaf's live check, 2026-10-17; the bidi algorithm as the
// desktop runs it, review of Task 2.8a): the desktop draws every Text as an LTR
// paragraph and refuses bidi controls. The engine mirrors a stretch of Hebrew
// (with the digits and neutrals inside it) in place, so a string that holds
// Hebrew reads right only when it holds NO letter of another script (a Latin
// word would split it into blocks laid left to right, backwards for the
// reader) and does not END with a neutral mark (a trailing `.`, `:`, `…` or
// `▶` lands at the paragraph's right = before the word; a LEADING one lands
// at the left = after the word, so `▶ צפו בדמו חי` reads "צפו בדמו חי ▶" —
// which is why the office Client lays a labelled control the other way round,
// office-layout.ts iconLabel). Digits anywhere after the first word ride
// inside (`עוד 5 שסיימו`), a terminator beside a number with them (`42%`, UBA
// W5); a leading digit joins the left side and reads after the word
// (`4 תמלילים` reads "תמלילים 4" — acceptable, never scrambled). Every Hebrew
// string the office Client draws (office-props.ts LABEL_KEYS and the counted
// labels) is worded to the rule — `hebrewRuleOk` below checks it, i18n.test.ts
// walks the set — never patched with control marks. office-layout.ts lays what
// shares a row by it.

import type { Agent } from './model'
import { mcpServer } from './model'
import { PERSONAS_EN, PERSONAS_HE } from './personas'

export type Lang = 'he' | 'en'

export const TOOLS_EN: Readonly<Record<string, string>> = {
  WebSearch: '🔍 Searching', WebFetch: '🌐 Reading page', Read: '📖 Reading', Edit: '✏️ Editing', MultiEdit: '✏️ Editing',
  Write: '✏️ Writing', NotebookEdit: '✏️ Notebook', Bash: '⚙️ Command', PowerShell: '⚙️ Command', BashOutput: '⚙️ Output',
  KillShell: '⚙️ Command', SlashCommand: '⌨️ Slash command', Grep: '🔎 Searching code', Glob: '🔎 Files', Task: '👥 Subagent',
  Agent: '👥 Subagent', TodoWrite: '📝 Todos', Skill: '🧩 Skill', ExitPlanMode: '📋 Plan', StructuredOutput: '🧾 Summarizing',
}

export const TOOLS_HE: Readonly<Record<string, string>> = {
  WebSearch: '🔍 מחפש', WebFetch: '🌐 קורא דף', Read: '📖 קורא', Edit: '✏️ עורך', MultiEdit: '✏️ עורך',
  Write: '✏️ כותב', NotebookEdit: '✏️ מחברת', Bash: '⚙️ פקודה', PowerShell: '⚙️ פקודה', BashOutput: '⚙️ פלט',
  KillShell: '⚙️ פקודה', SlashCommand: '⌨️ פקודת סלאש', Grep: '🔎 מחפש קוד', Glob: '🔎 קבצים', Task: '👥 סוכן',
  Agent: '👥 סוכן', TodoWrite: '📝 משימות', Skill: '🧩 מיומנות', ExitPlanMode: '📋 תכנון', StructuredOutput: '🧾 מסכם',
}

/** The string table of one language. Function-valued entries take a count. */
export type Strings = {
  appTitle: string; showDone: string; toggleFinished: string; switchTo: string
  emptyOffice: string; emptySub: string; watchDemo: string; demoLabel: string; exitDemo: string
  langHint: string; close: string; loading: string; helpTitle: string; helpHint: string
  scSearch: string; scFinished: string; scMove: string; scOpen: string; scClose: string
  scMute: string; scLang: string; scDemo: string; scStill: string; scHelp: string; scPrev: string; scNext: string
  /**
   * The office toolbar's words (the cards design, refinement 7): `הצג שסיימו ☐`, `צליל 🔔`, `הגדרות ⚙️` — the word alone
   * here, the icon laid by the Client (office-layout.ts iconLabel: after a Hebrew word in the string, before any other).
   */
  tbDone: string; tbSound: string; tbSettings: string
  /** The settings popover's title (the office Client's; the text cards keep helpTitle) and its row in the shortcuts. */
  settingsTitle: string; scSettings: string
  /** The settings popover's motion toggle word (🎞 motion on, 🖼 frozen); the demo and language Buttons use demoLabel / exitDemo and switchTo. */
  hbMotion: string
  resultTruncated: string; searchPlaceholder: string; emptyNoMatch: string
  mute: string; unmute: string; finishedToast: string; officeFailed: string
  /** The five-hour usage toast (80% / 95%): the rounded percent and the reset's local HH:MM ('' when unknown). One line. */
  usageToast: (pct: number, reset: string) => string
  srResults: (n: number) => string; srNoMatch: string; srCleared: string; pin: string; unpin: string
  emptyNoActive: string; emptyNoneInWindow: string
  working: string; idleN: string; finished: string
  dWorking: string; dDone: string; dStale: string; dFailed: string; dDuration: string; dElapsed: string
  /** What follows the minutes on the drawer's clock chip: `7′` in English, `7 דק׳` in Hebrew (a Hebrew geresh: the chip ends right-to-left, never with a neutral). An agent row's clock field has its own unit, office-layout.ts ROW_MINUTES (the layout's, not a string of this table). */
  dMinutes: string
  dAction: string; dTask: string; dResult: string; dModel: string; taskUnavailable: string
  actDone: string; actStale: string; actThinking: string; actMcp: string
  oversizedN: (n: number) => string
  /** The desktop footer's count of the agents over the props cap (office-props.ts MAX_PROPS_AGENTS): `+N …` in English, the count inside the Hebrew. */
  moreAgentsN: (n: number) => string
  /** The office's row under a room that hides its finished: how many more finished agents it holds (a click shows them all). */
  moreDoneN: (n: number) => string
  /** The same row once the room shows every finished agent (a click hides them again). */
  hideDone: string
  roomTitle: string; details: string; keysHint: string
  personas: readonly string[]; tools: Readonly<Record<string, string>>
}

export const I18N: Readonly<Record<Lang, Strings>> = {
  en: {
    appTitle: '🏢 Claude Theater', showDone: 'Show finished', toggleFinished: 'Show/hide finished in this conversation', switchTo: 'עברית',
    emptyOffice: 'The office is empty',
    emptySub: 'Start an agent in Claude Code — or see what a busy office looks like:',
    watchDemo: '▶ Watch a live demo', demoLabel: 'Demo', exitDemo: 'Exit',
    langHint: 'Switch language (Hebrew / English)', close: 'Close',
    loading: 'Loading…', helpTitle: 'Help', helpHint: 'Keyboard shortcuts',
    scSearch: 'Search', scFinished: 'Show / hide finished', scMove: 'Move between agents',
    scOpen: 'Open details', scClose: 'Close panel',
    scMute: 'Mute / unmute chime', scLang: 'Switch language', scDemo: 'Demo on / off', scStill: 'Freeze / release the motion', scHelp: 'This help',
    scPrev: 'Previous agent', scNext: 'Next agent',
    tbDone: 'Show finished', tbSound: 'Sound', tbSettings: 'Settings', settingsTitle: 'Settings', scSettings: 'Settings', hbMotion: 'Motion',
    resultTruncated: 'Result shortened — open the terminal for the full output',
    searchPlaceholder: 'Search agents…', emptyNoMatch: 'No agents match your search.',
    mute: 'Mute chime', unmute: 'Unmute chime', finishedToast: 'finished',
    officeFailed: 'the office could not be drawn; showing the cards (/theater to retry)',
    usageToast: (pct, reset) => `5-hour limit: ${pct}%${reset ? ` · resets ${reset}` : ''}`,
    srResults: n => `${n} agent${n === 1 ? '' : 's'} match`, srNoMatch: 'No agents match', srCleared: 'Search cleared',
    pin: 'Pin to top', unpin: 'Unpin',
    emptyNoActive: 'No active agents. Tick "Show finished" to see history.',
    emptyNoneInWindow: 'No agents in the time window.',
    working: 'working', idleN: 'idle', finished: 'finished',
    dWorking: 'Working', dDone: 'Done', dStale: 'Idle', dFailed: 'Failed',
    dDuration: 'Duration ', dElapsed: 'Elapsed ', dMinutes: '′',
    dAction: 'Activity', dTask: 'Task', dResult: 'Result', dModel: 'Model',
    taskUnavailable: 'working — details unavailable',
    actDone: '✅ Done', actStale: '💤 Idle', actThinking: '🤔 Thinking', actMcp: '🔌 MCP tool',
    oversizedN: n => `${n} transcript${n === 1 ? '' : 's'} over 4 MiB skipped`,
    moreAgentsN: n => `+${n} more agent${n === 1 ? '' : 's'} not shown`,
    moreDoneN: n => `${n} more finished`, hideDone: 'Hide finished',
    roomTitle: 'Conversation', details: 'Details', keysHint: 'focus the pane (ctrl+x tab) for the hotkeys',
    personas: PERSONAS_EN, tools: TOOLS_EN,
  },
  he: {
    appTitle: '🏢 משרד הסוכנים', showDone: 'הצג שהושלמו', toggleFinished: 'הצג/הסתר שהושלמו בשיחה זו', switchTo: 'English',
    emptyOffice: 'המשרד ריק',
    emptySub: 'הפעילו סוכן בקלוד קוד - או הציצו איך נראה משרד עמוס',
    watchDemo: '▶ צפו בדמו חי', demoLabel: 'דמו', exitDemo: 'יציאה',
    langHint: 'החלפת שפה - עברית או אנגלית', close: 'סגירה',
    loading: 'טוען…', helpTitle: 'עזרה', helpHint: 'קיצורי מקלדת',
    scSearch: 'חיפוש', scFinished: 'הצג / הסתר שהושלמו', scMove: 'מעבר בין סוכנים',
    scOpen: 'פתיחת פרטים', scClose: 'סגירת החלונית',
    scMute: 'השתקה / ביטול השתקה', scLang: 'החלפת שפה', scDemo: 'דמו: הפעלה / יציאה', scStill: 'תנועה: הקפאה / שחרור', scHelp: 'העזרה הזו',
    scPrev: 'הסוכן הקודם', scNext: 'הסוכן הבא',
    tbDone: 'הצג שסיימו', tbSound: 'צליל', tbSettings: 'הגדרות', settingsTitle: 'הגדרות', scSettings: 'הגדרות', hbMotion: 'תנועה',
    resultTruncated: 'התוצאה קוצרה — לפלט המלא פתחו את הטרמינל',
    searchPlaceholder: 'חיפוש סוכנים…', emptyNoMatch: 'אין סוכנים שתואמים לחיפוש',
    mute: 'השתק צליל', unmute: 'בטל השתקה', finishedToast: 'סיים',
    officeFailed: 'לא ניתן היה לצייר את המשרד; מוצגים כרטיסים (/theater לניסיון נוסף)',
    usageToast: (pct, reset) => `נוצלו ${pct}% ממכסת 5 השעות${reset ? ` · איפוס ${reset}` : ''}`,
    srResults: n => `נמצאו ${n} סוכנים תואמים`, srNoMatch: 'אין סוכנים תואמים', srCleared: 'החיפוש נוקה',
    pin: 'נעץ למעלה', unpin: 'בטל נעיצה',
    emptyNoActive: 'אין סוכנים פעילים. סמנו "הצג שהושלמו" כדי לראות היסטוריה',
    emptyNoneInWindow: 'אין סוכנים בחלון הזמן',
    working: 'עובדים', idleN: 'ממתינים', finished: 'סיימו',
    dWorking: 'עובד', dDone: 'סיים', dStale: 'ממתין', dFailed: 'נכשל',
    dDuration: 'משך ', dElapsed: 'זמן ', dMinutes: ' דק׳',
    dAction: 'פעולה', dTask: 'משימה', dResult: 'תוצאה', dModel: 'מודל',
    taskUnavailable: 'עובד — פרטים לא זמינים',
    actDone: '✅ סיים', actStale: '💤 ממתין', actThinking: '🤔 חושב', actMcp: '🔌 כלי מחובר',
    oversizedN: n => `דולגו ${n} תמלילים גדולים מדי`,
    moreAgentsN: n => `עוד ${n} סוכנים לא מוצגים`,
    moreDoneN: n => `עוד ${n} שסיימו`, hideDone: 'הסתר שסיימו',
    roomTitle: 'שיחה', details: 'פרטים', keysHint: 'למקשי הקיצור מקדו את החלונית (ctrl+x tab)',
    personas: PERSONAS_HE, tools: TOOLS_HE,
  },
}

/** PAGE t(): the string for `key` in `lang`, falling back to English. */
export function t<K extends keyof Strings>(lang: Lang, key: K): Strings[K] {
  return I18N[lang][key] ?? I18N.en[key]
}

/**
 * PAGE activityLabel(): done → ✅, stale → 💤, phase thinking → 🤔,
 * mcp__<server>__x → "🔌 <server>", else the tool table, else 🤔.
 */
export function activityLabel(a: Pick<Agent, 'status' | 'phase' | 'tool'>, lang: Lang): string {
  const L = I18N[lang]
  if (a.status === 'done') return L.actDone
  if (a.status === 'stale') return L.actStale
  if (a.phase === 'thinking') return L.actThinking
  if (a.tool && a.tool.startsWith('mcp__')) {
    const s = mcpServer(a.tool)
    return s ? `🔌 ${s}` : L.actMcp
  }
  return L.tools[a.tool] ?? L.actThinking
}

/** Model families the label names (lower-case id token → display name). */
const MODEL_FAMILIES: Readonly<Record<string, string>> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' }

/** The family colour token of a model id: 'opus' | 'sonnet' | 'haiku' | 'fable', or 'other' (an unknown family, or ""). */
export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other'
export function modelFamily(model: string): ModelFamily {
  const m = /^(?:claude-)?([a-z]+)/i.exec((model ?? '').trim())
  const fam = (m?.[1] ?? '').toLowerCase()
  return fam === 'opus' || fam === 'sonnet' || fam === 'haiku' || fam === 'fable' ? fam : 'other'
}

/**
 * A short human name for a model id: "claude-opus-5-5" → "Opus 5.5",
 * "claude-haiku-4-5-20251001" → "Haiku 4.5", "claude-fable-5-1" → "Fable 5.1",
 * "claude-sonnet-4-20250514" → "Sonnet 4". Any other id → the raw id without
 * the "claude-" prefix and a trailing date suffix (-YYYYMMDD). "" stays "".
 * Also accepts the engine's bare aliases ("opus", "haiku" → "Opus", "Haiku").
 */
export function modelLabel(model: string): string {
  const raw = (model ?? '').trim()
  if (!raw) return ''
  const id = raw.replace(/^claude-/i, '').replace(/-\d{8}$/, '')
  const m = /^([a-z]+)(?:-(\d+(?:-\d+)*))?$/i.exec(id)
  if (m) {
    const family = MODEL_FAMILIES[(m[1] ?? '').toLowerCase()]
    if (family) {
      const version = (m[2] ?? '').replace(/-/g, '.')
      return version ? `${family} ${version}` : family
    }
  }
  return id
}

/** A Hebrew-script character; a letter of any other script (strong left-to-right). The same classes as office-layout.ts's. */
const HEBREW_RE = /\p{Script=Hebrew}/u
const OTHER_LETTER_RE = /(?!\p{Script=Hebrew})\p{L}/u
const DIGIT_RE = /\p{Nd}/u

/**
 * THE HEBREW RULE on one string drawn as one Text: true when it holds no Hebrew at all, or when no
 * letter of another script is in it and its last glyph (spaces aside) is Hebrew or a digit — a
 * trailing mark would be drawn before the word. A leading mark, emoji or digit is fine (it lands
 * after the word). The i18n strings are worded to pass it whole; office-layout.ts lays a row by it.
 */
export function hebrewRuleOk(s: string): boolean {
  if (!HEBREW_RE.test(s)) return true
  if (OTHER_LETTER_RE.test(s)) return false
  const last = [...s.trimEnd()].pop() ?? ''
  return HEBREW_RE.test(last) || DIGIT_RE.test(last)
}

/** Text direction for a language. */
export function dirOf(lang: Lang): 'rtl' | 'ltr' {
  return lang === 'he' ? 'rtl' : 'ltr'
}
