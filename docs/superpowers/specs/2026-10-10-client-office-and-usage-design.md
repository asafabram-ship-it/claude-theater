# אפיון: המשרד בדסקטופ על Client + מד מגבלת 5 השעות

תאריך: 2026-10-10 · ענף: `feat/desktop-mod` · מוד: `desktop-mod/` (שם פנימי `agent-theater`) · מנוע: הדסקטופ מריץ 2.1.293
(`C:/Users/asafa/AppData/Roaming/Claude/claude-code/2.1.293/83cb0bd7fed4/claude.exe`; טיפוסים: `plugin-authoring/types/claude-code.d.ts` של אותו בניין, להלן "T").
מחליף את חלק הדסקטופ של `2026-10-07-desktop-mod-design.md`; הטרמינל, הסורק, ההעדפות והפס מעל ההקלדה נשארים כפי שאופיינו שם.

## 1. הבעיה, בקצרה

בדסקטופ כל חדר צויר כ-`<Svg isInteractive>` (מסגרת מבודדת). כל ציור מחדש של החלונית - כל כתיבת `$.state` שהחלונית קוראת, וכל צעד גלילה -
בונה את המסגרות מחדש: הבהוב, לחיצות שנבלעות. ארבעה סבבי תיקון (HANDOFF.md) הורידו את תדירות הציורים אבל לא את ההבהוב עצמו,
כי זו הארכיטקטורה המתועדת: Svg הוא עלה שנשלח כנתון בכל ציור, ושום דבר ב-API לא מבטיח שמסגרת נשמרת (T:12196-12232).
בנוסף המוד מאט את המחשב: קריאה מחדש של קבצי שיחה שלמים (עד 4MiB) כל 1.5 שניות לכל סוכן פעיל (scanner.ts:194-220), הליכה על כל
`~/.claude/projects` כל 6 שניות (scanner.ts:1143-1207), ויומן אבחון שנכתב כל 4 שניות.

## 2. החלטות המשתמש (2026-10-10)

1. אפס הבהוב חשוב יותר מהציורים הווקטוריים: מקובל ציור פשוט יותר (אימוג'י + ריבועי צבע).
2. כל השיחות הפתוחות נשארות (חדר לכל שיחה), עם סריקה חסכונית. השיחה הנוכחית מאירועי המנוע.
3. אנימציה עדינה, רק באירועים (כניסה, סיום, שינוי מצב). לא תנועה רציפה.
4. גישה א': Client אחד לכל החלונית.
5. פיצ'ר נוסף: מד USAGE של מגבלת 5 השעות בשורת הכותרת התחתונה של האפליקציה (השורה עם "Auto … Fable 5.1 · Ultracode"), רצוי בין "Auto" ל-"Fable".
6. הכול באותו ריפו וענף. שלב ראשון תכנון בלבד; הקוד נכתב לפי התוכנית.
7. (10.10, 12:37) TAIL_SWITCH/Seek לקבצי שיחה מעל 256KB (סעיף 8 פריט 2): נדחה - מבוצע כ-Task 1.2b רק אם מדידת Task 1.5 מעל היעד. עד אז קריאת הקובץ כולו (עד 4MiB) נשארת, והפרסור הוא של התוספת בלבד (Task 1.2).
8. (10.10, 12:37) יומן האבחון: מחיקה מלאה מהקוד, בלי דגל DIAG (סעיף 8 פריט 5 תוקן בהתאם).
9. (10.10, 12:37) ה-housekeeping של ה-finish beat (איפוס בחירה של סוכן שנעלם, גיזום נעיצות ו-roomDone של חדרים שנעלמו), שנמחק ב-Task 1.4, חוזר ב-Task 1.4b בענף הפרסום, באותו טיק, ככתיבות נדירות בלבד.
10. (10.10, 14:30) המשימות הטהורות של שלב 2 (Task 2.1 `office-layout.ts`, Task 2.2 `office-props.ts` - בלי Client, שימושיות בכל גרסה של הגישה) רשאיות לרוץ לפני השער של שלב 0; Task 2.3 ואילך (מודול ה-Client והחיווט) נשארות מותנות בבדיקות 1-3 של שלב 0.
11. (10.10, 19:50, אחרי שלב 0 - בדיקות 1-4 עברו) **גלילה בדסקטופ:** המנוע גולל טבעית על פני Client בגובה התוכן המלא; ה-hooks לא חוסמים `ui.scroll` ולא מחזיקים היסט משלהם; ה-Client מצייר חלון לפי היסט המנוע שמועבר ב-props. מחליף את סעיף 6.4; סעיף 6.6 (ערוץ ה-pull) מתבטל. הסיבה: השיטה של 6.4 גרמה בדסקטופ לקפיצה למטה ובחזרה בכל צעד גלגלת (HANDOFF "שלב 0 - תוצאות").
12. (10.10, 19:50) **מד 5 השעות בדסקטופ:** דרך `$.ui.status` (מצויר בשורה התחתונה בין "Auto" ל-"Fable 5.1", עם קידומת שם המוד) + כותרת החלונית + `$.ui.toast` ב-80% וב-95% (פעם אחת לכל חלון). מחליף את מנגנון `SessionMode` בסעיף 9 לדסקטופ (נורה אבל לא מצויר; `PromptHint` לא נורה); `SessionMode` נשאר לטרמינל.

## 3. מטרות ומחוץ להיקף

**מטרות.** בדסקטופ: חלונית משרד שלא מהבהבת בעדכון נתונים ולא בגלילה; לחיצה ישירה על דמות; אנימציה קצרה באירועים; עברית;
כל השיחות; המחשב לא מואט (סריקה חסכונית מדידה); מד 5 שעות בשורת הכותרת התחתונה.
**מחוץ להיקף.** VS Code ומובייל (אין להם Client: נשארים עם כרטיסי הטקסט); אנימציית סרק רציפה; גרסת הדפדפן של פייתון; תמונות וקטוריות.

## 4. עובדות ה-API שעליהן נשענים (מהטיפוסים של 2.1.293)

- **Client נשמר בין ציורים:** "The engine keeps the instance (its local state, its timers) across the plugin's redraws while a `Client` under this key stays in the tree" (ClientProps.key, T:1494-1495). נתונים חדשים "reach the running instance, its state kept" (T:1509-1510).
- **ערוץ דחיפה בלי ציור:** hook של `ui.message` שעונה `{ props }` "hands the posting instance its next props directly, its local state kept, with no `ui.render` run" (T:13946-13948).
- **שעון פריימים, עכבר, מקלדת:** `surface.every` (T:1568-1574), `surface.onPointer` עם תפיסה מ-`down` עד `up` (T:1436-1438), `surface.onKey` אחרי לחיצה (T:1580-1583), `surface.post` (T:1588-1592).
- **מה Client יכול לצייר:** `ClientElements = Omit<Elements['terminal'], 'Client' | 'Raster' | 'Image'>` (T:1399): Box, Text, Button, Input, Select, Link, Code, Markdown. **לא Svg.**
- **גבולות:** עץ עד 20,000 צמתים / 32 עומק / 100,000 תווים, אחרת המופע נסגר (T:1396-1397); קריאה ≤ שנייה (T:1423-1425); props ≤ 100,000 תווים (T:1511); `setState` שלוש פעמים ברצף בלי אירוע = לולאה = סגירה (T:1553-1556); `module` הוא מחרוזת ליטרלית שנקראת מהמקור (T:1336-1341).
- **דסקטופ:** Client בטבלת האלמנטים של הדסקטופ (T:3806); "The desktop carries it as data" (T:9556-9565). הסתייגות בטיפוסים: `UiMessageArgument.surface`: "terminal, or desktop once it has them" (T:13912). שלושה מודים מצליחים בפועל (סעיף 14).
- **גלילה:** `ui.scroll` "Fires before a site's window moves … no `next` (`{}` or `{ deny }`) leaves it undrawn, so a hook drawing its own rows under a header moves them by `e.by` and invalidates" (T:4013-4024). כך עובד המוד המובנה `/diff` (mods/diff/hooks/register.ts:878-897).
- **ציור מחדש:** `$.state.set` מצייר את הקוראים "at the redraw rate" (T:3374-3380); `$.ui.invalidate` עד 10 בשנייה, מאוחדים (T:2341-2343).
- **מגבלת 5 שעות:** `$.session.usage()` → `rateLimits: SessionRateLimit[]` עם `kind: 'five_hour' | 'seven_day' | 'spend_limit'`, `percentUsed` (0-100, ספרה אחת אחרי הנקודה), `resetsAt` (ISO) (T:11635-11656, T:11217-11235). האירוע `session.measure` נורה "after each turn, and when a plan limit's percent used changes" עם `changed: ['rateLimits', …]` (T:4385, SessionMeasureInput). "empty off a subscription or before the first reading".
- **שורת הכותרת התחתונה:** אתר הציור `SessionMode`: "The dim mode labels at the right of the prompt footer (`focus`, `memory paused`), joined by ` & `. One instance. A hook adds a mode by rewriting `modes`, removes one by filtering, or draws its own tree. Raised on the terminal and desktop surfaces only." (T:10127-10138). חלופה: `PromptHint` (שורת הרמז מתחת להקלדה; `tail` לא מצויר בדסקטופ "yet", T:10140-10170).

## 5. ארכיטקטורה

```
desktop-mod/hooks/
  register.tsx      hooks: סורק, סוכנים חיים, העדפות, /theater, פס, ui.message, ui.fault, ui.scroll, session.measure, SessionMode
  ui.tsx            ציור לטרמינל/VS Code/מובייל (כרטיסי טקסט) - כמו היום; לדסקטופ מחזיר צומת Client אחד
  office-client.tsx חדש: מודול המשטח. מצייר את כל החלונית בדסקטופ. בלי `$`.
  office-layout.ts  חדש: פונקציות טהורות משותפות: פריסת חדרים/אריחים לרשת תאים, חלון שורות, מיפוי תא→סוכן, מיזוג ריצות צבע
  office-svg.ts     נשאר ל-VS Code/מובייל (Svg לא-אינטראקטיבי) ולהודעת המשרד הריק שם; לא בשימוש בדסקטופ
  usage.ts          חדש: עיצוב מד 5 השעות (טהור) + בחירת הקריאה מתוך rateLimits
  scanner.ts, live.ts, model.ts, i18n.ts, personas.ts  כמו היום (סורק: סעיף 8)
```

- **בדסקטופ עץ החלונית הוא צומת אחד:** `<Client key="office" module="./office-client.tsx" width={bodyColumns} height={bodyRows} props={officeProps} />`.
  שום Text/Button מסביב. ציור מחדש של החלונית = עדכון props של מופע שנשמר.
- **נפילה חזרה:** hook `ui.fault` (מופע נכשל: `load`/`render`/`run`) מסמן `clientFailed` בזיכרון המודול ומבקש ציור מחדש; החלונית מצוירת ככרטיסי הטקסט של הטרמינל (הקוד הקיים ב-ui.tsx). toast אחד בעברית. לעולם לא חלונית ריקה.
- **זיהוי יכולת:** `'Client' in $.ui.resolve(e)` ו-`e.surface === 'desktop'`; אחרת המסלול הקיים.
- **המפתח `office` קבוע.** החלפת שפה/דמו/העדפה לא מחליפה מפתח (המופע נשאר; props משתנים). מפתח חדש רק אם הפריסה חייבת להתחיל מאפס (לא צפוי).

## 6. זרימת נתונים

### 6.1 מהקבצים ומהמנוע לחלונית

1. `poll` (כל `POLL_MS` = 5000; רק כשהחלונית פתוחה) → `scanAll` חסכוני (סעיף 8) + `LIVE` מאירועי המנוע → `mergeLive` → payload.
2. `renderKey` (קיים) מחליט אם משהו שמוצג השתנה; המנגנונים הקיימים נשארים: מבנה אחרי `SETTLE_MS` = 5000, פעילות אחרי `CALM_MS` = 8000.
3. **פרסום אחד:** כתיבת `payload` ל-`$.state`. שינוי כותרת החלונית (`$.ui.open` עם retitle) וכתיבת `view.justFinished` של ה-finish beat
   מתבצעים באותו מחזור, לפני הכתיבה, כך שיש ציור מחדש אחד ולא שלושה (HANDOFF: "two renders per structure write").
4. ה-hook של `ui.render` לדסקטופ בונה `officeProps` (6.2) ומחזיר את צומת ה-Client. props חדשים נכנסים למופע במקום.

### 6.2 הנתונים ל-Client (`OfficeProps`, JSON בלבד, בלי undefined)

```ts
type OfficeProps = {
  v: 1
  lang: 'he' | 'en'; rtl: boolean
  columns: number; rows: number          // גודל האזור בתאים (גם surface.columns/rows; נשלח לשם חישוב זהה בשני הצדדים)
  offset: number                         // שורת הגלילה הראשונה (hooks מחזיקים; ה-Client מצמיד לגבול)
  nowMin: number                         // הדקה הנוכחית (עדכון דקות בלי שעון בצד ה-Client)
  counts: { run: number; idle: number; done: number }
  prefs: { showDone: boolean; muted: boolean; still: boolean }
  search: string; selected: string | null; helpOpen: boolean; demo: boolean
  rooms: Array<{ id: string; title: string; small: string; pinned: boolean; showDone: boolean;
                 run: number; stale: number; done: number;
                 agents: Array<{ id: string; emoji: string; name: string; status: 'running'|'stale'|'done';
                                 fam: ''|'search'|'read'|'write'|'cmd'|'agent'; act: string; model: string; modelFam: string;
                                 startMin: number | null; isLead: boolean; failed: boolean; star: number; enteredAt: number }> }>
  drawer: null | { id: string; name: string; chips: string[]; model: string; act: string; task: string; result: string; truncated: boolean }
  footer: string                          // oversized / scanError, כבר מעוצב
  usage: null | { pct: number; resetsAt: string }   // מד 5 השעות גם בכותרת החלונית (סעיף 9)
}
```

- `task` ו-`result` נשלחים **רק** בתוך `drawer` (סוכן אחד שנבחר), לעולם לא לכל סוכן. ~100 סוכנים ≈ 25KB, הרחק מ-100,000.
- `star` ו-`enteredAt` הם חותמות זמן (ms) שה-Client גוזר מהן אנימציה חד-פעמית (דפוס cc-buddy: "stamp-based prop diffing").
- בניית ה-props היא פונקציה טהורה `officeProps(payload, prefs, view, ...)` עם בדיקה שאין `undefined` (מופע Client דוחה עץ עם undefined: cc-buddy register.tsx:128-149).

### 6.3 מהחלונית ל-hooks (`surface.post` → `ui.message`)

הודעה: `{ t: 'open', id } | { t: 'close' } | { t: 'pin', room } | { t: 'roomDone', room } | { t: 'showDone' } | { t: 'mute' } | { t: 'lang' } | { t: 'help' } | { t: 'demo' } | { t: 'still' } | { t: 'search', q } | { t: 'focus', id } | { t: 'content', rows }`.
ה-hook של `ui.message` (מסנן `e.element === 'office'`) מעדכן `prefs`/`view`/`$.store` בדיוק כמו ה-handlers של היום ומחזיר `{}`; הנתונים החדשים מגיעים דרך הציור הרגיל.
`content` מדווח את גובה התוכן בשורות (לצורך הצמדת הגלילה) ונשלח רק כשהוא משתנה.

### 6.4 גלילה

- hook `ui.scroll` עם `{ component: 'Pane', requestId: 'agent-theater' }`: אם `e.origin.kind === 'person'`: `offset = clamp(offset + e.by, 0, contentRows - bodyRows)` (contentRows מההודעה `content`), ואז בקשת ציור מחדש דרך **משפך אחד** (6.5). מחזיר `{}` **בלי `next`** - חלון המנוע לא זז לעולם.
  גלילה שמקורה בתוסף אחר או `$.ui.scroll` (origin `plugin`) עוברת ל-`next(e)`.
- ה-Client מצייר רק את השורות `[offset, offset + rows)` מתוך הפריסה המלאה (office-layout.ts), ולכן גודל העץ חסום בגובה החלונית ולא במספר הסוכנים.
- מקלדת בתוך ה-Client (אחרי לחיצה): `j`/`k` פוקוס, `o`/Enter פתיחה, `x` סגירה, `f`/`m`/`l`/`h`/`d`/`s` כמו הכפתורים; PageUp/PageDown/Home/End כפי שהמנוע מספק דרך `ui.scroll`.

### 6.5 מה מצייר מחדש, ומתי

- `payload`, `prefs`, `view` נשארים ב-`$.state`; ה-hook של הדסקטופ קורא אותם, ולכן כל כתיבה שלהם היא ציור מחדש אחד. הכתיבות מוגבלות לשינוי אמיתי (המנגנונים והבדיקות הקיימים: "N סבבים בלי שינוי = 0 כתיבות").
- היסט הגלילה **לא** ב-`$.state` אלא בזיכרון המודול; גלילה מבקשת ציור דרך `requestRedraw($)`: `$.clock.after(REDRAW_LATCH_MS = 100, …)` שמבקש `$.ui.invalidate('ui.render')` פעם אחת, וקריאות בזמן ההמתנה נבלעות (דפוס `/diff` register.ts:200-214). כך 20 צעדי גלגלת בשנייה הם לכל היותר 10 ציורים של props בלבד.
- הודעה שמשנה העדפה/תצוגה כותבת את האטום המתאים (ציור אחד). הודעת `content` לא כותבת דבר.

### 6.6 ערוץ גיבוי (רק אם הבדיקה החיה תראה הבהוב בציור מחדש של צומת יחיד)

ה-Client שולח `{ t: 'pull', seq }` כל 2 שניות על שעון משלו; ה-hook עונה `{ props }` עם ה-props העדכניים. אפס `ui.render`. במצב הזה ה-hooks לא כותבים `payload` ל-`$.state` בדסקטופ בכלל (רק בזיכרון), והגלילה מגיעה דרך אותה תשובה (עד 2 שניות איחור - לא רצוי; לכן זה גיבוי ולא ברירת המחדל).

## 7. המשרד בתוך ה-Client

### 7.1 רשת ופריסה (office-layout.ts, טהור)

- יחידה: תא טקסט של גופן הקוד של האפליקציה. רוחב האזור `surface.columns`, גובה `surface.rows` (ה-props נושאים את אותם מספרים).
- **אריח סוכן:** 14 תאים רוחב × 6 שורות: (1) אימוג'י-ראש ממורכז, מסגרת פוקוס/בחירה בצבע; (2) "שולחן" - 10 תאים של `▀` עם צבע עליון/תחתון
  (חצי-בלוק, שתי פיקסלים אנכיים לתא, כמו glowup pets.ts:119-148), המסך דולק ירוק כש-running, אפור כש-stale, כבוי כש-done; (3) שם (ריצת עברית אחת; חיתוך לרוחב); (4) כדור מודל: Text עם `backgroundColor` לפי משפחה
  (Opus סגול, Sonnet כחול, Haiku ירוק, Fable כתום, לא ידוע אפור) וטקסט "Opus 5.5"; (5) פעולה: אימוג'י + מילה (`activityLabel` הקיים); (6) דקות + תגים ⭐❌⏰ + מספר.
- **חדר:** שורת כותרת (📌/○ · 💬 כותרת · ספירות 🟢⏳✅ · כפתור ✅ לחדר) ואריחים בשורות, `floor((columns - 1) / 15)` לשורה, לפחות 1. חדרים נעוצים ראשונים, אחר כך לפי ריצה ו-mtime (`officeView` הקיים).
- **מעל החדרים:** כותרת (🎭 + ספירות + מד 5 שעות), סרגל (☑ 🔔 EN ? 🎬 🖼), חיפוש (Input), עזרה (אם פתוחה), מגירה (אם פתוחה). הכול בתוך ה-Client, Button/Input של `surface.elements`, עם אותם `hotkey`.
- **פריסה = רשימת שורות** עם מזהה לכל שורה (`header`, `toolbar`, `search`, `room:<id>:head`, `room:<id>:row:<n>`, …) וגובהה; החלון בוחר שורות לפי `offset`. כל אריח רושם מלבן תאים → `hit(x, y)` מחזיר סוכן/כפתור חדר.

### 7.2 בניית העץ

- כל שורת תאים = `<Text key={rowId} wrap="truncate">` אחד שבתוכו `<Text color backgroundColor>` לכל ריצה של תאים זהים (run-length; cc-arcade common.tsx:29-60, idle-art grid.ts:94-102). 100 סוכנים בחלון של 40 שורות ≈ מאות צמתים.
- אין מחרוזות עם תווי כיוון (RLE/PDF נדחים, HANDOFF). טקסט עברי טהור בריצה משלו מוצג נכון; הכדור של המודול באנגלית בריצה משלו. כותרת שיחה מעורבת נשארת מוגבלת (ידוע).
- פריסה מימין לשמאל: סדר האריחים בשורה הפוך כשהשפה עברית, הכותרות מיושרות ימינה (`justifyContent`).
- מגבלת עץ: בדיקה אוטומטית ש-100 סוכנים × כל רוחב 24..200 נשארים מתחת ל-20,000 צמתים ו-100,000 תווים (כולל המגירה).

### 7.3 קלט

- `surface.onPointer`: רק `down` (כפתור שמאלי) → `hit` → `post({t:'open', id})` או פעולת חדר; `move` מעדכן `hover` במצב המקומי (מסגרת לאריח) ללא post; `leave` מנקה. בלי `setState` כשלא השתנה דבר.
- כפתורי הסרגל: `Button` עם `onPress` בתוך המודול → post. Input: `onInput` → post `search` (debounce 150ms במודול).
- `surface.onKey` (אחרי לחיצה באזור): המקשים מסעיף 6.4.

### 7.4 אנימציה (אירועים בלבד)

- מצב מקומי: `{ hover, fx: Array<{id, kind:'enter'|'done'|'status', at}> }`.
- על props חדשים: סוכן עם `enteredAt` שלא נראה קודם → fx `enter` (700ms: הראש "נכנס" משמאל/ימין לאורך 3 תאים); `star` חדש → fx `done` (1000ms: קפיצה של שורה + ⭐ מופיע); שינוי `status` → fx `status` (שני פריימים של המסך).
- `surface.every(250, tick)` מופעל **רק כשיש fx פעיל** ונעצר כש-`fx` ריק (האובייקט שמחזיר `every` נשמר במצב; cc-buddy מפעיל פעם אחת - כאן מפעילים/מכבים לפי צורך, בלי שלושה `setState` ברצף בלי אירוע).
- `prefs.still` מבטל את כל ה-fx (כמו היום).
- הדקות מתעדכנות מ-`nowMin` ב-props (הפרסום כבר מעדכן דקה שלמה), לא משעון מקומי.

### 7.5 מה נשאר בטרמינל/VS Code/מובייל

כרטיסי הטקסט הקיימים, בלי שינוי. VS Code/מובייל: Svg לא-אינטראקטיבי להודעת המשרד הריק בלבד (קיים).

## 8. סריקה חסכונית (שלב 1 - עצמאי מה-Client, נמדד לפני ואחרי)

1. `POLL_MS` 1500 → 5000. סריקה רק כשהחלונית פתוחה (קיים); כשהיא סגורה רק מפת הסוכנים החיים מתיישנת (קיים, בזיכרון).
2. לכל קובץ: `stat` קודם; קריאה רק אם `(mtime, size)` השתנו (קיים חלקית) **ופרסור רק של התוספת**: הסורק שומר לכל קובץ את האורך שנקרא ואת מצב הפרסור (אירועים אחרונים, done, in-flight), וקורא את הקובץ כולו רק כשהוא קטן מ-`TAIL_SWITCH` (256KB); מעל זה קריאת זנב דרך `$.process.run` (PowerShell, קיים) **רק** של הבתים החדשים (`Seek` לאורך הקודם) - פעם ב-5 שניות לכל קובץ שהשתנה, לא יותר.
3. רשימת הפרויקטים (`projects/*`) מתרעננת כל 30 שניות (`GLOB_TTL_SEC` 6 → 30); תיקיית `sessions` כל 5 שניות (זולה).
4. `tasklist` נשאר פעם ב-30 שניות (קיים).
5. יומן האבחון (`agent-theater-diag.log`) **מוסר** מהקוד לגמרי, בלי דגל (הכרעה 8 בסעיף 2, 10.10; בוצע ב-Task 1.3).
6. ה-`retitle` וה-`view` של ה-finish beat מתאחדים לפרסום אחד (6.1); אין `$.ui.open` נפרד.
7. מדידה: Task Manager (CPU של `claude.exe` ושל האפליקציה) 60 שניות עם החלונית פתוחה ועם 5 סוכנים רצים, לפני ואחרי. יעד: ממוצע < 3% CPU כשהמשרד שקט, < 10% כשחמישה סוכנים עובדים.

## 9. מד מגבלת 5 השעות (פיצ'ר 2)

- **מקור:** `session.measure` (hook; `e.rateLimits`, `e.changed` כולל `'rateLimits'`) + קריאה ראשונה `$.session.usage()` ב-`session.start`. נבחרת הרשומה `kind === 'five_hour'`. אם אין (לפני הקריאה הראשונה / חשבון בלי מנוי) - לא מוצג דבר.
- **נשמר** במשתנה מודול `usage5h: { pct, resetsAt } | null`; שינוי → `$.ui.invalidate('ui.render')` (אתרי `SessionMode` והחלונית נקראים מחדש; קריאות מאוחדות).
- **איפה:** hook `ui.render` על `{ component: 'SessionMode' }` (דסקטופ וטרמינל): `next({ ...e, props: { ...e.props, modes: [label, ...e.props.modes] } })`.
  התווית: `⏳ 5h ▰▰▰▱▱▱▱▱▱▱ 42% · 14:30` (10 תאי פס, אחוז שלם, שעת איפוס מקומית HH:MM; מעל 80% התווית מתחילה ב-⚠). באנגלית זהה. בלי צבע (modes הן מחרוזות).
  **מיקום על השורה הוא של האפליקציה**: המשתמש ביקש בין "Auto" ל-"Fable 5.1"; הבדיקה החיה (סעיף 12, פריט 7) תראה איפה הדסקטופ מציב את התווית. אם לא על אותה שורה: (א) `PromptHint` עם `hint` משוכתב (אם מצויר בדסקטופ), (ב) כותרת החלונית. בכל מקרה המד מופיע **גם** בכותרת החלונית (`usage` ב-props) כברירת מחדל.
- **רענון:** אין polling. `session.measure` נורה אחרי כל תור וכשאחוז זז. שעת האיפוס לא משתנה בין קריאות; האחוז מתעדכן רק כשהמנוע מדווח.
- **בדיקות:** `session.measure` עם `five_hour` 42% → `SessionMode.modes[0]` מכיל "42%" ו-"14:30" (לפי אזור זמן של הבדיקה); ללא `five_hour` → modes ללא שינוי; מעל 80% → ⚠; בחלונית: `usage` ב-props.

## 10. שגיאות

- המודול `office-client.tsx` עוטף את הציור ב-try/catch ומחזיר `<Text>` עם הודעה קצרה במקום לזרוק (זריקה = סגירת המופע).
- `ui.fault` → `clientFailed = true` + toast + ציור ככרטיסי טקסט; `/theater` מאפס את הדגל (ניסיון חוזר).
- props: `officeProps` מסיר `undefined` ומגביל אורכים (שם ≤ 24, פעולה ≤ 16, כותרת ≤ 48, task/result במגירה ≤ 4000 כמו היום).
- הסורק: כל כשל קובץ נספר ב-footer, לעולם לא חריגה (קיים).
- `ui.message` עם נתונים לא מוכרים → מתעלם ומחזיר `{}`.

## 11. בדיקות (`claude plugin test`)

- כל 86 הבדיקות הקיימות לטרמינל/סורק/live/i18n נשמרות; הבדיקות שבודקות Svg בדסקטופ מוחלפות.
- **דסקטופ:** `mount` על `desktop` מחזיר צומת `Client` אחד עם `key: 'office'` ו-`module: './office-client.tsx'`; props תקינים (JSON, בלי undefined, `v: 1`); 100 סוכנים → props < 100,000 תווים.
- **office-layout:** פריסה דטרמיניסטית לרוחב 24/45/90/140; `hit` מחזיר את הסוכן הנכון לכל תא של האריח; חלון שורות ל-offset שונים; מיזוג ריצות; גבולות צמתים/תווים ב-100 סוכנים.
- **office-client:** דרך הקיט (`ui.find({ in: 'office', … })`, `ui.advance`): fx `enter` נגמר תוך 700ms ו-`every` נעצר; לחיצה בתא של אריח → post `{t:'open'}`; props זהים → אין `setState`.
- **הודעות:** כל `t` משנה את ה-prefs/view הצפוי ו-`$.store`.
- **גלילה:** `ui.scroll` עם origin `person` → offset משתנה, `next` לא נקרא; origin `plugin` → `next`.
- **ציורים:** N סבבי poll ללא שינוי → 0 כתיבות ו-0 ציורים (קיים); פרסום אחד → ציור אחד (לא שלושה).
- **מד 5 שעות:** סעיף 9.
- **ui.fault:** אחרי fault, mount על desktop מחזיר כרטיסי טקסט.

## 12. שלב 0 - בדיקה חיה (לפני כל כתיבה של המשרד; שעה-שעתיים)

מוד זעיר נפרד (`C:\Users\asafa\.claude\dev-mods\…\theater-probe`, לא בריפו), עם פקודה `/theater-probe` שפותחת חלונית עם Client אחד:
רשת 100 אריחי חצי-בלוק (10×10, אימוג'י + `▀` צבעוני + Text עם backgroundColor), מונה שמתקדם כל 250ms, כפתור אחד, Input אחד,
`onPointer` שרושם `{type,x,y}` לקובץ דרך post→ui.message, hook `ui.scroll` שלא מעביר ל-next ומזיז offset, ו-`ui.fault` שרושם סיבה.
בודקים בעין ובקובץ:

1. עדכון props כל 2 שניות (שינוי צבע של אריח אקראי): המונה לא מתאפס, שום הבהוב.
2. 20 צעדי גלגלת: חלון המנוע לא זז, האזור מצייר את החלון החדש, שום הבהוב.
3. לחיצות מגיעות עם תאים נכונים; `move` מגיע; הכפתור וה-Input בתוך ה-Client עובדים; `onKey` אחרי לחיצה.
4. תשובת `{ props }` ל-post משנה את הציור בלי `ui.render` (קובץ היומן של הבדיקה).
5. איך נראים: רוחב תא, אימוג'י (תא אחד או שניים), `backgroundColor`, `▀` עם שני צבעים, גבול Box, `bold`/`dimColor`, עברית בריצה אחת.
6. CPU של claude.exe והאפליקציה עם המונה רץ ועם 100 אריחים (Task Manager, דקה).
7. `SessionMode`: תווית נוספת - איפה היא מופיעה על שורת הכותרת התחתונה בדסקטופ; האם `PromptHint` מצויר בדסקטופ.

ממשיכים לבנות רק אם 1-3 עוברים. אם 1 נכשל (ציור מחדש של צומת יחיד מהבהב): ערוץ הגיבוי 6.6 נבדק באותו מוד (פריט 4). אם גם הוא נכשל: מסלול ג' (Svg לא-אינטראקטיבי + `settled()` של claude-skins) נכנס לדיון מחדש.

## 13. סיכונים פתוחים

- הסתייגות הטיפוסים לגבי Client בדסקטופ ("once it has them"). ראיה נגדית: glowup, cc-buddy, claude-agentpane מציירים Client בדסקטופ. מוכרע בשלב 0.
- מדדי תאים בדסקטופ (רוחב אימוג'י, קו-גובה) לא ידועים; הפריסה מניחה אימוג'י = 2 תאים ומתקנת לפי שלב 0.
- מגבלת שנייה לקריאה של המודול: פריסה של 100 סוכנים חייבת להיות זולה (ממוזרת לפי חתימת props).
- מיקום תווית `SessionMode` על השורה - של האפליקציה.
- RTL בתוך תאים: עברית טהורה בלבד; כותרות מעורבות מוגבלות.

## 14. אסמכתאות (נקראו בקוד, 2026-10-10)

- Client בדסקטופ בפועל: NovusEdge/glowup (`hooks/client/pet.tsx`, `register.tsx:1181`; גלילה עצמית `:1221-1231`), vmallela0/cc-buddy (`hooks/boards/buddy.tsx`, `register.tsx:644-654`), xuanji86/claude-agentpane (`hooks/live.tsx`, `register.tsx:681-683, 703-717`).
- טכניקות Client בטרמינל: sezaakgun/cc-arcade (`hooks/boards/common.tsx:29-60` ריצות; `doom.tsx:6-9, 292-294` חצי-בלוק; `minesweeper.tsx:45-49` hit-test), davila7 tool-defense, KilimcininKorOglu idle-art (`hooks/scene.tsx`), deonmenezes cc-pokedex.
- גלילה עצמית: anthropics/claude-code `mods/diff/hooks/register.ts:878-897`, משפך ציור `:200-214`.
- הבעיה המתועדת עם Svg: hellosverre/claude-skins `hooks/svg-kit.ts:75-80`; ririversoza/agent-office README:87; ungetLai/claude-code-pixel-office `sync.ts:197-199`.
- מד usage: pixel-office `sync.ts:85-99` (`$.session.usage` כל 5 שניות - אצלנו במקום זה `session.measure`).
- סיכומי המחקר: scratchpad של השיחה (`round1.txt`, `synth.json`, פלט wk6n146ns.output).

## 15. ניקיון אחרי המחקר (משימה בתוכנית)

שיבוטים זמניים למחיקה: `C:\tmp\pixel-office-clone`, `C:\tmp\agent-office-ro`, `C:\tmp\pa-clone`, `C:\tmp\ap-clone-69e31b17`, `C:\tmp\cc-gitdir-69e31b17`, `C:\tmp\ccp-playground-gitdir`, `C:\tmp\ck-stage-69e31b17`, `C:\tmp\idle-art-clone`, ו-`scratchpad\repos*`; לבטל `subst H:` אם נותר.
