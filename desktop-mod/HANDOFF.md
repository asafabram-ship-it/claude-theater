# HANDOFF — תיאטרון הסוכנים כמוד לאפליקציית הדסקטופ

עודכן: 2026-10-07 (ערב) · ענף: `feat/desktop-mod` · ריפו: `C:\Users\asafa\agent-theater` (GitHub: asafabram-ship-it/claude-theater)

## מה זה
פורט של תוסף Claude Theater (VS Code 0.4.0) למוד של Claude Code: חלונית "🎭 התיאטרון" בלשונית Code של הדסקטופ,
שמציגה את סוכני המשנה של **כל השיחות הפתוחות** (חדר לכל שיחה). המטרה: זהות לתוסף, בשינויים מחייבים בלבד.

## החלטות משתמש
- זהות מלאה לתוסף VS Code; **כל השיחות**; השיחה הנוכחית מאירועי המנוע, האחרות מקבצי היומן.
- פתיחה: אוטומטית בסוכן הראשון + `/theater` + פס מעל תיבת ההקלדה (כשיש סוכנים עובדים והחלונית סגורה).
- לכל סוכן מוצג **המודל** (🧠).
- הכול **מסונכרן לגיט כל הזמן** (commit + push אחרי כל שלב).
- שיחה עם המשתמש: **עברית בלבד**, פשוטה.
- עבודה דרך סוכני משנה / workflow עם **Fable** (model: 'fable').

## איפה הקוד ואיך הוא נטען
- קוד: `desktop-mod/` (plugin.json, hooks/*.ts(x), types/index.d.ts, בדיקות `hooks/*.test.ts`).
- שם המוד: `agent-theater` (המנוע דוחה שמות שמתחילים ב-`claude-`).
- טעינה בכל שיחה: `~/.claude/settings.json` → `env.CLAUDE_CODE_PLUGIN_DIRS = C:\Users\asafa\agent-theater\desktop-mod`
  (גיבוי: `settings.json.bak-2026-10-07`). שינוי בקוד נכנס בשיחה **חדשה**. התיקייה קיימת רק כשהענף feat/desktop-mod נבחר.
- מבנה: `register.tsx` (חיווט, poll כל 1.5 שנ', סריקת קבצים רק כשהחלונית פתוחה), `scanner.ts` (פורט הסורק מפייתון),
  `live.ts` (סוכני השיחה הנוכחית מאירועי המנוע), `ui.tsx` (החלונית), `office-svg.ts` (ציור SVG של המשרד לדסקטופ),
  `i18n.ts`/`personas.ts` (עברית/אנגלית, 48 דמויות, `modelLabel`).

## בדיקות
- מנוע: `C:/Users/asafa/AppData/Roaming/Claude/claude-code/2.1.28*/*/claude.exe` (ה-`claude` שב-PATH ישן מדי למודים).
  - `<engine> plugin validate C:/Users/asafa/agent-theater/desktop-mod`
  - `<engine> plugin test C:/Users/asafa/agent-theater/desktop-mod` (אחרון: 78 עוברות)
- טייפצ'ק: `C:/Users/asafa/AppData/Local/Temp/theater-tsc/node_modules/.bin/tsc -p C:/Users/asafa/AppData/Local/Temp/theater-tsc`
- גיט: push עובד רק כ-`asafabram-ship-it` (credential.helper מקומי לריפו כבר מוגדר).

## מצב נוכחי (מה עובד)
- המוד נטען בכל שיחה חדשה; החלונית, חדרים, מצבים, מודל, חיפוש, עברית/אנגלית, דמו, צליל, פס פתיחה.
- זיהוי סיום תוקן (SubagentHandback / stop_reason ריק / task-notification מהשיחה האם).
- שמות שיחות מדלגים על `<system-reminder>` וכו'.
- בדסקטופ: כל חדר = SVG אחד מונפש (דמויות ליד שולחנות, כתב קטן), מספרים + כפתורי מספר לפתיחת פרטים, tooltip במעבר עכבר.
  טרמינל/VS Code/מובייל: כרטיסי טקסט.
- גודל גופן של טקסט רגיל בדסקטופ **לא ניתן לשליטה** — לכן SVG.

## פתוח (מה המשתמש ראה בצילום האחרון)
סוכן Fable רץ עכשיו על התיקונים האלה (לא מחויב עדיין לגיט — לבדוק `git status` ולהשלים):
1. **עדיין מהבהב** — חשד: poll כותב את ה-payload בכל tick (scanned_ms/mtime) → כל החלונית מצוירת מחדש → ה-iframe של ה-SVG נטען מחדש. תיקון: לכתוב רק כשמשהו מוצג השתנה.
2. **קנה מידה לא אחיד** בין חדרים (חדר עם 2 סוכנים גדול פי 2) — אותו מספר עמודות לכל החדרים.
3. **שמות שיחות חתוכים מההתחלה** ב-SVG (RTL) — לחתוך מהסוף.
4. **מודל חסר לשיחה עצמה (lead)** — לקרוא מזנב קובץ השיחה.
5. סדר: שורת המספרים מתחת לחדר קומפקטית, פחות רווח ריק.

## אחרי זה
- המשתמש בודק בשיחה חדשה עם `/theater` ושולח צילום מסך; ממשיכים לכוונן לפי הצילום.
- כשיציב: למזג את feat/desktop-mod ל-main (אז הטעינה לא תלויה בענף), ולעדכן README/CHANGELOG.
- מסמכים: אפיון `docs/superpowers/specs/2026-10-07-desktop-mod-design.md`, תוכנית `docs/superpowers/plans/2026-10-07-desktop-mod-plan.md`.
