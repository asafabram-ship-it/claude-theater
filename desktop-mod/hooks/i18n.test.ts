// i18n.ts: the model display helper (the string tables are exercised through
// ui.test.ts) and THE HEBREW RULE over every Hebrew string the office Client draws.

import { expect, test } from 'claude-code/testing'

import { I18N, hebrewRuleOk, modelLabel } from './i18n'
import { LABEL_KEYS } from './office-props'

test('hebrewRuleOk: a string without Hebrew passes; one with Hebrew must hold no letter of another script and end with Hebrew or a digit (a trailing mark is drawn before the word, a leading one after it)', () => {
  expect(hebrewRuleOk('Opus 5.5')).toBe(true)
  expect(hebrewRuleOk('⏳ 5h 42% · 14:30')).toBe(true)
  expect(hebrewRuleOk('')).toBe(true)
  expect(hebrewRuleOk('עוד 5 שסיימו')).toBe(true)
  expect(hebrewRuleOk('משך 7 דק׳')).toBe(true)                    // the geresh is Hebrew script
  expect(hebrewRuleOk('משך 7′')).toBe(false)                       // a trailing prime: refused as any trailing mark (the rule stays simple: it does not model W5, which carries a prime with its number — office-layout.test.ts visualRtlReading does)
  expect(hebrewRuleOk('▶ צפו בדמו חי')).toBe(true)                 // a leading mark lands after the words
  expect(hebrewRuleOk('צפו בדמו חי ▶')).toBe(false)                // a trailing one before them
  expect(hebrewRuleOk('4 תמלילים מעל 4MiB דולגו')).toBe(false)   // Latin inside: the scrambled footer of the live check
  expect(hebrewRuleOk('דולגו 4 תמלילים גדולים מדי')).toBe(true)
  expect(hebrewRuleOk('4 תמלילים')).toBe(true)                     // a leading digit joins the left side: "תמלילים 4", never scrambled
  expect(hebrewRuleOk('📖 קורא')).toBe(true)
  expect(hebrewRuleOk('❌ נכשל')).toBe(true)
  expect(hebrewRuleOk('הפעילו סוכן ב-Claude Code')).toBe(false)    // Latin inside
  expect(hebrewRuleOk('אין סוכנים שתואמים לחיפוש.')).toBe(false)   // a trailing period
  expect(hebrewRuleOk('מודל:')).toBe(false)
  expect(hebrewRuleOk('שלום ')).toBe(true)                         // trailing spaces are not marks
})

test('THE HEBREW RULE: every Hebrew string the office Client draws passes it — the labels of the props (LABEL_KEYS), the counted labels, the empty-office messages, the toasts', () => {
  const L = I18N.he
  const bad: string[] = []
  const check = (key: string, s: string) => { if (!hebrewRuleOk(s)) bad.push(`${key}: ${s}`) }
  for (const k of LABEL_KEYS) if (k !== 'searchPlaceholder') check(k, L[k])   // (the placeholder's trailing … is dropped by the Client, which draws it behind the glass)
  for (const k of ['emptyOffice', 'emptySub', 'emptyNoMatch', 'emptyNoActive', 'emptyNoneInWindow', 'finishedToast', 'finishedToastFem', 'srNoMatch', 'srCleared', 'pin', 'unpin', 'roomTitle', 'details', 'helpHint', 'langHint', 'toggleFinished', 'scSearch', 'scPrev', 'scNext', 'mute', 'unmute'] as const) check(k, L[k])
  // the empty-office sub is split at " - " into lines of its own (office-chrome.ts emptyLines): each must pass too
  for (const part of L.emptySub.split(/\s[-—]\s/)) check('emptySub part', part)
  for (const n of [1, 4, 400]) {
    check('oversizedN', L.oversizedN(n))
    check('moreAgentsN', L.moreAgentsN(n))
    check('moreDoneN', L.moreDoneN(n))
    check('srResults', L.srResults(n))
    check('usageToast', L.usageToast(n, '14:30'))
    check('usageToast', L.usageToast(n, ''))
  }
  // the compositions the Client makes of them: the drawer's clock chip, the ✂ note, the model line's labels (no colon)
  check('dDuration chip', `${L.dDuration}7${L.dMinutes}`)
  check('dElapsed chip', `${L.dElapsed}12${L.dMinutes}`)
  check('note', `✂ ${L.resultTruncated}`)
  check('model line', `${L.dAction} 🤔 חושב`)
  // the labelled controls and chips — the toolbar's and the help's (Task 2.8b-3), the drawer's close, the search's glass, the
  // empty office's demo Button, the failed chip: the WORD passes on its own; the icon is laid after it in the string so the
  // reader meets it first (office-layout.ts iconLabel, proven by office-layout.test.ts visualRtlReading) — a trailing icon is
  // the one trailing neutral the rule allows for, because it is meant to be read before the word
  for (const k of ['tbDone', 'tbSound', 'tbSettings', 'demoLabel', 'exitDemo', 'close', 'dFailed'] as const) check(k, L[k])
  check('placeholder word', L.searchPlaceholder.replace(/…$/, ''))
  check('watchDemo word', L.watchDemo.replace(/^\S+\s/, ''))
  expect(L.watchDemo).toMatch(/^▶ /)   // (worded mark-first for the text cards; the office Client re-lays it)
  // the toolbar's words and the settings popover (the cards design, refinement 7): `הצג שסיימו ☐`, `צליל 🔔`, `הגדרות ⚙️`
  expect(L.tbDone).toBe('הצג שסיימו')
  expect(L.tbSound).toBe('צליל')
  expect(L.tbSettings).toBe('הגדרות')
  expect(I18N.en.tbDone).toBe('Show finished')
  expect(I18N.en.tbSound).toBe('Sound')
  expect(I18N.en.tbSettings).toBe('Settings')
  // the popover is titled הגדרות (it hosts the language and demo controls and the shortcuts); the text cards keep their help
  expect(L.settingsTitle).toBe('הגדרות')
  expect(I18N.en.settingsTitle).toBe('Settings')
  expect(L.helpTitle).toBe('עזרה')
  expect(I18N.en.helpTitle).toBe('Help')
  expect(LABEL_KEYS).toContain('settingsTitle')
  expect(LABEL_KEYS).toContain('tbSettings')
  expect(LABEL_KEYS).toContain('scSettings')
  expect(LABEL_KEYS).not.toContain('tbHelp')
  expect(LABEL_KEYS).not.toContain('helpTitle')
  // the agent rows carry no clock (the cards design): the drawer's chip (dMinutes) is the one unit of minutes in the table
  expect('rowMinutes' in L).toBe(false)
  expect('rowMinutes' in I18N.en).toBe(false)
  // the tool table: an emoji leads every entry (an activity cell may draw the emoji alone); the Hebrew after it must pass alone
  for (const [tool, label] of Object.entries(L.tools)) check(`tools.${tool}`, label.replace(/^\S+\s/, ''))
  for (const k of ['actDone', 'actStale', 'actThinking', 'actMcp'] as const) check(k, L[k].replace(/^\S+\s/, ''))
  expect(bad).toEqual([])
  // the English table holds no Hebrew but the language switch label (Hebrew alone: fine)
  expect(hebrewRuleOk(I18N.en.switchTo)).toBe(true)
})

test('THE TOO-LONG CONVERSATIONS NOTE (live check 6: `דולגו 1 תמלילים גדולים מדי` was unclear and ungrammatical): one conversation, or n, too long to show — the Hebrew opening on a Hebrew letter (a leading count would be read last), no Latin, singular and plural agreeing', () => {
  const he = I18N.he.oversizedN
  const en = I18N.en.oversizedN
  expect(he(1)).toBe('שיחה אחת ארוכה מדי ולא מוצגת')
  expect(he(2)).toBe('יש 2 שיחות ארוכות מדי ולא מוצגות')
  expect(he(400)).toBe('יש 400 שיחות ארוכות מדי ולא מוצגות')
  expect(en(1)).toBe('One conversation is too long to show')
  expect(en(2)).toBe('2 conversations are too long to show')
  expect(en(400)).toBe('400 conversations are too long to show')
  for (const n of [1, 2, 3, 11, 400]) {
    expect(he(n), `${n}`).toMatch(/^\p{Script=Hebrew}/u)
    expect(he(n), `${n}`).not.toMatch(/\p{Script=Latin}/u)
    expect(hebrewRuleOk(he(n)), `${n}`).toBe(true)
    expect(he(n), `${n}`).not.toMatch(/תמליל|דולגו/)
  }
})

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

test('officeFailed (decision 27): the first-fault toast says the office fell back to the cards and is tried again by itself, and that /theater reopens it at once; the Hebrew one run', () => {
  expect(I18N.he.officeFailed).toBe('המשרד נפל לכרטיסים; מנסה שוב בעוד רגע (/theater פותח מיד)')
  expect(I18N.en.officeFailed).toBe('The office fell back to cards; trying again in a moment (/theater reopens it now)')
})
