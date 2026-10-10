# פרומפט להמשך: בניית המשרד על Client (תיאטרון הסוכנים בדסקטופ)

נשמר: 2026-10-10 06:12 · לשיחה חדשה בלשונית Code · מודל: Fable 5.1 · Ultracode מופעל

---

**הדבק את זה כהודעה הראשונה בשיחה חדשה:**

אתה ממשיך את העבודה על המוד "תיאטרון הסוכנים" (ריפו `C:\Users\asafa\agent-theater`, ענף `feat/desktop-mod`). עבור לתיקייה הזו (change_directory) לפני כל דבר.

**תור ראשון, לפני כל עבודה:**
1. `get_usage` (self). צור CronCreate "usage-guard" כל 20 דקות (דקה לא עגולה) לפי סקיל `save-documents` (סעיף "שומר מכסה").
2. קרא, בסדר הזה: `desktop-mod/HANDOFF.md` (הסעיף העליון "נקודת שמירה 2026-10-10 06:12"), `docs/superpowers/specs/2026-10-10-client-office-and-usage-design.md` (האפיון המאושר; סעיפים 2, 4, 12 חובה), `docs/superpowers/plans/2026-10-10-client-office-and-usage-plan.md` ("Global Constraints" + "Shared interfaces" + Task 0.2 ואילך), והלדג'ר `.superpowers/sdd/2026-10-10-client-office-and-usage-plan/progress.md` (לא בגיט; אם חסר - פתח חדש לפי `superpowers:subagent-driven-development`, Task 0.1 כבר complete).
3. אם `git status` מראה קבצים לא מקומטים - קמט ודחוף (`docs(mod): checkpoint <תאריך>`, עם השורה `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`).

**איפה אנחנו:** Task 0.1 הושלם - מוד הבדיקה `theater-probe` בנוי, עבר `plugin validate`/`tsc` וסקירה (סבב תיקון אחד). הוא יושב ב-`C:\Users\asafa\.claude\dev-mods\87c79db4-401e-4363-a35f-1c75f8fa5a35\theater-probe\` (תיקיית הטעינה החמה של הסשן הקודם). **Task 0.2 (הבדיקה החיה) טרם בוצע.** אם ב-HANDOFF כבר קיים סעיף "שלב 0 - תוצאות הבדיקה החיה" - דלג ל"ההכרעה" למטה.

**המשימה - Task 0.2 (אסף מול המסך):**
1. טען את ה-probe בסשן הזה: הפעל את הסקיל `plugin-authoring` (הוא מדפיס את תיקיית הטעינה החמה של הסשן, `C:\Users\asafa\.claude\dev-mods\<session-id>\`), העתק לשם את תיקיית `theater-probe` כולה חוץ מ-`.claude-plugin\types` (ארבעה קבצים: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, `hooks/probe-client.tsx`), ובקש מאסף לאשר "Enable for this session" כשהאפליקציה שואלת. המוד נטען בסוף התור. `/theater-probe` פותח את החלונית; היומן: `C:\Users\asafa\.claude\theater-probe.log` (שורת `invalidate seq=…` כל 2 שניות מרגע הטעינה = המוד חי).
2. בקש מאסף, בעברית פשוטה, צעד אחרי צעד, את 7 הבדיקות (אפיון סעיף 12 / תוכנית Task 0.2 שלב 1), עם שני עדכונים מסבב התיקון: **בדיקה 4** = אין שורת `render` ביומן בין `message press` לשורת ה-`invalidate` הבאה; את הכפתור "Press me" לוחצים **בעכבר**, לא במקש `p` (post אחד לפריים). אחרי כל בדיקה קרא את היומן בעצמך (`tail -40`) ואל תסתמך רק על מה שאסף רואה; בבדיקה 5 בקש צילום מסך; בבדיקה 6 את מספרי ה-CPU ממנהל המשימות.
3. רשום את התוצאות ב-`desktop-mod/HANDOFF.md` בסעיף חדש `## שלב 0 - תוצאות הבדיקה החיה (<תאריך>)` (שורה לכל בדיקה, PASS/FAIL, מספרי CPU, רוחב אימוג'י, מיקום תווית SessionMode), ואז קמט ודחוף: `docs(mod): phase 0 probe results`.

**ההכרעה (Task 0.2 שלב 3):** בדיקות 1-3 עוברות → המשך לשלבים 1-2 (Task 1.1 ואילך) עם `superpowers:subagent-driven-development` (סוכן טרי לכל משימה, סקירה בין משימות, מודל Fable). 1 נכשל ו-4 עובר → ערוץ ה-pull (אפיון 6.6; Task 2.5 שלב 7). 1 ו-4 נכשלים → עצור ודווח; הגישה נבחרת מחדש (אפיון, סוף סעיף 12).

**כללים שאסף קבע (אל תשאל שוב):**
- שיחה איתו בעברית פשוטה בלבד. קוד והודעות קומיט באנגלית.
- commit + push ל-`feat/desktop-mod` אחרי כל משימה. בדיקות: `claude plugin validate`, `claude plugin test`, `tsc` - עם המנוע של הדסקטופ (הנתיבים ב-"Global Constraints" בתוכנית), לא `claude` שב-PATH.
- המוד הראשי כבוי עד Task 2.8 (`CLAUDE_CODE_PLUGIN_DIRS` הוסר מ-`~/.claude/settings.json`; מודדים CPU ב-Task 1.5 בהפעלה זמנית בלבד).
- אפס הבהוב חשוב יותר מציור יפה; כל השיחות; אנימציה רק באירועים; Client אחד לכל החלונית; מד 5 השעות גם בשורת הכותרת התחתונה (SessionMode) וגם בכותרת החלונית.
- אל תחזור על המחקר: הסיכומים ב-`docs/research/2026-10-10-mods-research/` (round1.txt, round2.txt, synth.json). אם צריך לקרוא קוד של מוד שוב - שיבוט חדש לתיקייה קצרה תחת `C:\tmp`, לקריאה בלבד.
- ממצאי "Minor" מהסקירות נרשמים בלדג'ר כ-deferred ולא פותחים סבב תיקון; הסקירה הכוללת בסוף הענף מסננת אותם.
- לפני כל Workflow או ריצה ארוכה: `get_usage`; ≥75% מחלון 5 השעות → `save-documents` קודם.

**תנאי עצירה לשיחה:** כשהמכסה מתקרבת (השומר יודיע) - הפעל `save-documents`, כתוב פרומפט המשך חדש באותו קובץ (השורה הראשונה של הפרומפט הזה מקבלת "בוצע <תאריך>"), ודחוף.

---

## בוצע 2026-10-10 06:12 (Task 0.1; המשך בפרומפט שמעל) - הפרומפט הקודם, נשמר 05:34, לתיעוד בלבד

אתה ממשיך את העבודה על המוד "תיאטרון הסוכנים" (ריפו `C:\Users\asafa\agent-theater`, ענף `feat/desktop-mod`). עבור לתיקייה הזו (change_directory) לפני כל דבר.

**תור ראשון, לפני כל עבודה:**
1. `get_usage` (self). צור CronCreate "usage-guard" כל 20 דקות (דקה לא עגולה) לפי סקיל `save-documents` (סעיף "שומר מכסה").
2. קרא, בסדר הזה: `desktop-mod/HANDOFF.md` (הסעיף העליון "נקודת שמירה 2026-10-10 05:34"), `docs/superpowers/specs/2026-10-10-client-office-and-usage-design.md` (האפיון המאושר; סעיפים 2, 4, 12 חובה), `docs/superpowers/plans/2026-10-10-client-office-and-usage-plan.md` (התוכנית; "Global Constraints" + "Shared interfaces" + Phase 0).
3. אם `git status` מראה קבצים לא מקומטים (HANDOFF, הפרומפט הזה, `docs/research/`, שורת סטטוס בתוכנית) - קמט ודחוף: `docs(mod): checkpoint 2026-10-10 — handoff, continuation prompt, research digests`, עם השורה `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

**המשימה:** לבצע את התוכנית משלב 0, עם `superpowers:subagent-driven-development` (סוכן טרי לכל משימה, סקירה בין משימות). **התחל ב-Task 0.1** (המוד הזעיר `theater-probe` ב-`C:\Users\asafa\.claude\dev-mods\theater-probe`, מחוץ לריפו). ב-Task 0.2 אתה צריך את אסף מול המסך: בקש ממנו בעברית פשוטה, צעד אחרי צעד, את 7 הבדיקות, ורשום את התוצאות ב-HANDOFF. **רק אם בדיקות 1-3 עוברות** ממשיכים לשלבים 1-2. אם 1 נכשל ו-4 עובר - Task 2.5 שלב 7 (ערוץ ה-pull). אם 1 ו-4 נכשלים - עצור ודווח; הגישה נבחרת מחדש (אפיון, סעיף 12 סוף).

**כללים שאסף קבע (אל תשאל שוב):**
- שיחה איתו בעברית פשוטה בלבד. קוד והודעות קומיט באנגלית.
- commit + push ל-`feat/desktop-mod` אחרי כל משימה. בדיקות: `claude plugin validate`, `claude plugin test`, `tsc` - עם המנוע של הדסקטופ (הנתיבים ב-"Global Constraints" בתוכנית), לא `claude` שב-PATH.
- המוד כבוי עד Task 2.8 (`CLAUDE_CODE_PLUGIN_DIRS` הוסר מ-`~/.claude/settings.json`; מודדים CPU ב-Task 1.5 בהפעלה זמנית בלבד).
- אפס הבהוב חשוב יותר מציור יפה; כל השיחות; אנימציה רק באירועים; Client אחד לכל החלונית; מד 5 השעות גם בשורת הכותרת התחתונה (SessionMode) וגם בכותרת החלונית.
- אל תחזור על המחקר: הסיכומים ב-`docs/research/2026-10-10-mods-research/` (round1.txt - 12 מודים + תיעוד + ניתוח הקוד שלנו; round2.txt - המודים מהסרטון ורשימת awesome; synth.json - טבלת השוואה והמלצות). הקוד של המודים נמחק/יימחק (Task 4.1); אם צריך לקרוא שוב - שיבוט חדש לתיקייה קצרה תחת `C:\tmp`, לקריאה בלבד.
- לפני כל Workflow או ריצה ארוכה: `get_usage`; ≥75% מחלון 5 השעות → `save-documents` קודם.

**תנאי עצירה לשיחה:** כשהמכסה מתקרבת (השומר יודיע) - הפעל `save-documents`, כתוב פרומפט המשך חדש באותו קובץ (השורה הראשונה של הפרומפט הזה מקבלת "בוצע <תאריך>"), ודחוף.
