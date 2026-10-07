// I18N: the Hebrew/English strings and the tool → activity label tables,
// ported from PAGE (claude_theater.py). Hebrew is the default (RTL).
//
// OWNER: builder "ui". The server-only strings of PAGE (reconnecting, version
// banner, skipped-lines/report) are dropped per the spec ("יורד").

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
  resultTruncated: string; searchPlaceholder: string; emptyNoMatch: string
  mute: string; unmute: string; finishedToast: string
  srResults: (n: number) => string; srNoMatch: string; srCleared: string; pin: string; unpin: string
  emptyNoActive: string; emptyNoneInWindow: string
  working: string; idleN: string; finished: string
  dWorking: string; dDone: string; dStale: string; dDuration: string; dElapsed: string
  dAction: string; dTask: string; dResult: string; taskUnavailable: string
  actDone: string; actStale: string; actThinking: string; actMcp: string
  oversizedN: (n: number) => string
  personas: readonly string[]; tools: Readonly<Record<string, string>>
}

export const I18N: Readonly<Record<Lang, Strings>> = {
  en: {
    appTitle: '🏢 Claude Theater', showDone: 'Show finished', toggleFinished: 'Show/hide finished in this conversation', switchTo: 'עברית',
    emptyOffice: 'The office is empty',
    emptySub: 'Start an agent in Claude Code — or see what a busy office looks like:',
    watchDemo: '▶ Watch a live demo', demoLabel: 'Demo', exitDemo: 'Exit',
    langHint: 'Switch language (Hebrew / English)', close: 'Close',
    loading: 'Loading…', helpTitle: 'Keyboard shortcuts', helpHint: 'Keyboard shortcuts',
    scSearch: 'Search', scFinished: 'Show / hide finished', scMove: 'Move between agents',
    scOpen: 'Open details', scClose: 'Close panel',
    resultTruncated: 'Result shortened — open the terminal for the full output',
    searchPlaceholder: 'Search agents…', emptyNoMatch: 'No agents match your search.',
    mute: 'Mute chime', unmute: 'Unmute chime', finishedToast: 'finished',
    srResults: n => `${n} agent${n === 1 ? '' : 's'} match`, srNoMatch: 'No agents match', srCleared: 'Search cleared',
    pin: 'Pin to top', unpin: 'Unpin',
    emptyNoActive: 'No active agents. Tick "Show finished" to see history.',
    emptyNoneInWindow: 'No agents in the time window.',
    working: 'working', idleN: 'idle', finished: 'finished',
    dWorking: 'Working', dDone: 'Done', dStale: 'Idle',
    dDuration: 'Duration ', dElapsed: 'Elapsed ',
    dAction: 'Activity', dTask: 'Task', dResult: 'Result',
    taskUnavailable: 'working — details unavailable',
    actDone: '✅ Done', actStale: '💤 Idle', actThinking: '🤔 Thinking', actMcp: '🔌 MCP tool',
    oversizedN: n => `${n} transcript${n === 1 ? '' : 's'} over 4 MiB skipped`,
    personas: PERSONAS_EN, tools: TOOLS_EN,
  },
  he: {
    appTitle: '🏢 משרד הסוכנים', showDone: 'הצג שהושלמו', toggleFinished: 'הצג/הסתר שהושלמו בשיחה זו', switchTo: 'English',
    emptyOffice: 'המשרד ריק',
    emptySub: 'הפעילו סוכן ב-Claude Code - או הציצו איך נראה משרד עמוס:',
    watchDemo: '▶ צפו בדמו חי', demoLabel: 'דמו', exitDemo: 'יציאה',
    langHint: 'החלפת שפה (עברית / אנגלית)', close: 'סגירה',
    loading: 'טוען…', helpTitle: 'קיצורי מקלדת', helpHint: 'קיצורי מקלדת',
    scSearch: 'חיפוש', scFinished: 'הצג / הסתר שהושלמו', scMove: 'מעבר בין סוכנים',
    scOpen: 'פתיחת פרטים', scClose: 'סגירת החלונית',
    resultTruncated: 'התוצאה קוצרה — לפלט המלא פתחו את הטרמינל',
    searchPlaceholder: 'חיפוש סוכנים…', emptyNoMatch: 'אין סוכנים שתואמים לחיפוש.',
    mute: 'השתק צליל', unmute: 'בטל השתקה', finishedToast: 'סיים',
    srResults: n => `${n} סוכנים תואמים`, srNoMatch: 'אין סוכנים תואמים', srCleared: 'החיפוש נוקה',
    pin: 'נעץ למעלה', unpin: 'בטל נעיצה',
    emptyNoActive: 'אין סוכנים פעילים. סמנו "הצג שהושלמו" כדי לראות היסטוריה.',
    emptyNoneInWindow: 'אין סוכנים בחלון הזמן.',
    working: 'עובדים', idleN: 'ממתינים', finished: 'סיימו',
    dWorking: 'עובד', dDone: 'סיים', dStale: 'ממתין',
    dDuration: 'משך ', dElapsed: 'זמן ',
    dAction: 'פעולה', dTask: 'משימה', dResult: 'תוצאה',
    taskUnavailable: 'עובד — פרטים לא זמינים',
    actDone: '✅ סיים', actStale: '💤 ממתין', actThinking: '🤔 חושב', actMcp: '🔌 כלי MCP',
    oversizedN: n => `${n} תמלילים מעל 4MiB דולגו`,
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

/** Text direction for a language. */
export function dirOf(lang: Lang): 'rtl' | 'ltr' {
  return lang === 'he' ? 'rtl' : 'ltr'
}
