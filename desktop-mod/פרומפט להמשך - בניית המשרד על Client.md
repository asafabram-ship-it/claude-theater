# פרומפט להמשך: בניית המשרד על Client (תיאטרון הסוכנים בדסקטופ)

נשמר: 2026-10-11 06:00 · לשיחה חדשה בלשונית Code · מודל: Fable 5.1 · Ultracode מופעל

---

**הדבק את זה כהודעה הראשונה בשיחה חדשה:**

אתה ממשיך את העבודה על המוד "תיאטרון הסוכנים" (ריפו `C:\Users\asafa\agent-theater`, ענף `feat/desktop-mod`). עבור לתיקייה הזו (change_directory) לפני כל דבר.

**תור ראשון, לפני כל עבודה:**
1. `get_usage` (self). צור CronCreate "usage-guard" כל 20 דקות (דקה לא עגולה) לפי סקיל `save-documents` (סעיף "שומר מכסה").
2. קרא, בסדר הזה: `desktop-mod/HANDOFF.md` (הסעיפים העליונים: "נקודת שמירה 2026-10-11 06:00", "שלב 0 - תוצאות הבדיקה החיה", 15:51 - כולל ה-Carry), `docs/superpowers/specs/2026-10-10-client-office-and-usage-design.md` (סעיפים 2 - כולל פריטים 7-12, 4, 8, 12 חובה), `docs/superpowers/plans/2026-10-10-client-office-and-usage-plan.md` ("Global Constraints" + "Shared interfaces" + ה-Amendment תחת Tasks 2.3/2.4/2.5/3.2/3.4, Task 1.5, Task 1.2b), והלדג'ר `.superpowers/sdd/2026-10-10-client-office-and-usage-plan/progress.md` (לא בגיט; Tasks 0.1, 0.2, 1.1-1.4, 1.4b, 2.1-2.4 כבר `complete` - אל תריץ אותן שוב; אם הלדג'ר חסר, פתח חדש לפי `superpowers:subagent-driven-development` ורשום אותן כ-complete לפי HANDOFF).
3. אם `git status` מראה קבצים לא מקומטים - קמט ודחוף (`docs(mod): checkpoint <תאריך>`, עם השורה `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`).

**איפה אנחנו:** שלב 0 הושלם (בדיקות 1-4 PASS; שינויי תכנון באפיון §2 פריטים 11-12: המנוע גולל טבעית, המד דרך `$.ui.status`). שלב 1 סגור. שלב 2: Tasks 2.1-2.4 בקוד ונסקרו (`office-layout.ts`, `office-props.ts`, `office-chrome.ts`, `office-client.tsx`, `ui.tsx` מחזיר Client אחד בדסקטופ), 127 בדיקות, הכול נדחף (`9e44f9e`). **Task 2.5 נעצר לפני שהתחיל** (אסף יצא) - מתחילים ממנו. Task 1.5 (מדידה) טרם בוצע. המוד הראשי עדיין כבוי.

**המשימה, לפי הסדר (SDD: סוכן טרי לכל משימה, סקירה, סבבי תיקון, מודל Fable):**

**א. Task 2.5** (`register.tsx`: hook `ui.message` עם matcher `{ element: OFFICE_KEY }` לכל סוגי ההודעות חוץ מ-`content`/`pull`, `ui.fault` → `DESKTOP.clientFailed` + toast + invalidate ו-`/theater` מאפס, latch לציור מחדש; **בלי** hook ל-`ui.scroll` ובלי ערוץ pull - לפי ה-Amendment בראש ה-brief). Carry מ-2.4 שחייב להיכנס כאן: להחזיר `'Client' in els` בענף הדסקטופ ב-`ui.tsx`; להחליף את גשר הבדיקות `pressVia` ב-`ui.test.ts` בפוסטים אמיתיים דרך ה-Client; להפוך את `props.search === ''` ב-`office-client.mounted.test.ts` לציפייה האמיתית. ה-brief: `.superpowers/sdd/.../task-2.5-brief.md` (אם חסר: `scripts/task-brief` של הסקיל). טבלת ההודעות וחוזה ה-mount בדוחות 2.3 ו-2.4.

**ב. Task 2.6** (ניקוי: בדיקות ה-SVG של הדסקטופ שמוגנות ב-`SVG_DESKTOP=false`, הפונקציות המתות ב-`office-svg.ts`, `TILE_HOP_MS`, `tileOf`/`roomSvgOf` - הרשימה בדוח 2.4 סעיף 6) ו-**Task 2.7** (ליטוש fx ו-hover; `rowCount` ב-`office-layout.ts` בלי בניית תאים; הגנה ב-`onPointer` על שורות מעבר לתקציב החלון; `office-view.ts` לשבירת המעגל `ui.tsx ⇄ office-props.ts`).

**ג. Task 2.8 - עם אסף מול המסך:** הפעלה מחדש של המוד (`CLAUDE_CODE_PLUGIN_DIRS` ב-`~/.claude/settings.json` - לבקש אישור מפורש), שיחה חדשה, `/theater`, בדיקה בעין לפי "Carry → 2.8" בלדג'ר (מקשים כפולים hotkey+onKey, caret בחיפוש בזמן פרסום, pointer y אחרי גלילה, גובהי Box/spacer, הבהוב). תיקונים → סבבים קטנים.

**ד. Task 1.5** (מדידת CPU, 5 סוכנים, 60 שנ'; אם מעל היעד → Task 1.2b), **שלב 3** (`usage.ts`, `session.measure`, `$.ui.status` + כותרת + toasts; Task 3.4 כבר בוצע), **Task 4.1** (מחיקת השיבוטים ו-`dev-mods/*/theater-probe`, HANDOFF סופי, מיזוג ל-main לפי הכרעת אסף).

**כללים שאסף קבע (אל תשאל שוב):**
- שיחה איתו בעברית פשוטה בלבד. קוד והודעות קומיט באנגלית.
- commit + push ל-`feat/desktop-mod` אחרי כל משימה. בדיקות: `claude plugin validate`, `claude plugin test`, `tsc` - עם המנוע של הדסקטופ (הנתיבים ב-"Global Constraints" בתוכנית), לא `claude` שב-PATH.
- המוד הראשי כבוי עד Task 2.8 (`CLAUDE_CODE_PLUGIN_DIRS` הוסר מ-`~/.claude/settings.json`; מודדים CPU ב-Task 1.5 בהפעלה זמנית בלבד).
- אפס הבהוב חשוב יותר מציור יפה; כל השיחות; אנימציה רק באירועים; Client אחד לכל החלונית; מד 5 השעות גם בשורת הכותרת התחתונה (SessionMode) וגם בכותרת החלונית.
- אל תחזור על המחקר: הסיכומים ב-`docs/research/2026-10-10-mods-research/`. אם צריך לקרוא קוד של מוד שוב - שיבוט חדש לתיקייה קצרה תחת `C:\tmp`, לקריאה בלבד.
- ממצאי "Minor" מהסקירות נרשמים בלדג'ר כ-deferred; ממצא שסותר את התוכנית/האפיון - parked עם המלצה, אסף מכריע (AskUserQuestion עובד לו גם מהטלפון); לא פותחים עליהם סבב.
- לפני כל Workflow או ריצה ארוכה: `get_usage`; ≥75% מחלון 5 השעות → `save-documents` קודם.
- כשאסף מרוחק (Remote Control): הודעות קצרות; עוצרים בנקודות הכרעה (הפעלת המוד, תוצאות שלב 0, שינוי תוכנית).

**תנאי עצירה לשיחה:** כשהמכסה מתקרבת (השומר יודיע) - הפעל `save-documents`, כתוב פרומפט המשך חדש באותו קובץ (השורה הראשונה של הפרומפט הזה מקבלת "בוצע <תאריך>"), ודחוף.

---

## בוצע 2026-10-10 13:15 (ההכרעות + Task 1.4b; Task 0.2 ו-1.5 טרם - עברו לפרומפט שמעל) - הפרומפט הקודם, נשמר 11:09, לתיעוד בלבד

**מה הוא ביקש:** (א) Task 0.2 עם אסף, (ב) שלוש הכרעות (TAIL_SWITCH/Seek, דגל DIAG, housekeeping), (ג) Task 1.5, (ד) שלב 2 אם השער עובר. **מה בוצע:** (ב) כולו - אסף הכריע ב-12:37 מהטלפון, ההכרעות באפיון §2 פריטים 7-9, Task 1.4b נוסף לתוכנית ובוצע (`4bc5b6e`), Task 1.2b נוסף כמותנה. (א), (ג), (ד) נשארו לפרומפט שמעל.
