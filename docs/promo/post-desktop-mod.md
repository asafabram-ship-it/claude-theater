# LinkedIn post - Claude Theater comes to the Claude desktop app (new mod)

Attach: `claude-theater-0.5.0-square.mp4`.

---

## עברית

לפני כמה חודשים שיתפתי כאן את Claude Theater, תוסף ל-VS Code שמראה בזמן אמת מה עושים הסוכנים של Claude Code: משרד חי, חדר לכל שיחה ודמות לכל סוכן.

היום הוא עושה את הצעד הבא: **מוד חדש לאפליקציית Claude עצמה**, בלשונית Code. בלי VS Code ובלי חלון נפרד. החלונית יושבת ליד השיחה.

מה רואים בה:
🎭 כרטיס לכל שיחה פתוחה, ובו שורה לכל סוכן: מי חושב, מי ממתין ומי סיים
★ סימון וצליל ברגע שסוכן מסיים
⏳ מגבלת 5 השעות, בזמן אמת, מול העיניים
📌 הצמדת שיחות, ולחיצה על שם פותחת את המשימה ואת התוצאה

כמו קודם: חינם, קוד פתוח, רץ רק על המחשב שלך ושום דבר לא יוצא לרשת. עברית ואנגלית.

התקנה באפליקציה: ‏+ ליד תיבת ההודעה ← Plugins ← Add marketplace ← ‎`legalmindcode/claude-theater`‎ ← Add plugin ← ‎`agent-theater`‎

או בסשן טרמינל:
```
/plugin marketplace add legalmindcode/claude-theater
/plugin install agent-theater@claude-theater
```

המוד בנוי על ממשק ה-function hooks של Claude Code, שעדיין בגישה מוקדמת (נדרשת גרסה 2.1.304 ומעלה). אם משהו נשבר אחרי עדכון, אשמח לשמוע.

https://github.com/legalmindcode/claude-theater

#ClaudeCode #AI #LegalTech #OpenSource

---

## English

A few months ago I shared Claude Theater here: a VS Code extension that shows what your Claude Code agents are doing in real time, as a live office with a room per conversation and a character per agent.

Today it takes the next step: **a new mod for the Claude desktop app itself**, in the Code tab. No VS Code, no separate window. The pane sits right beside the conversation.

What it shows:
🎭 A card per open conversation, a row per agent: who's thinking, who's waiting, who's done
★ A mark and a sound the moment an agent finishes
⏳ Your 5-hour usage limit, live, in plain view
📌 Pin conversations; click a name to see its task and result

Same as before: free, open source, runs only on your machine and sends nothing anywhere. Hebrew and English.

Install in the app: + next to the prompt box → Plugins → Add marketplace → `legalmindcode/claude-theater` → Add plugin → `agent-theater`

Or in a terminal session:
```
/plugin marketplace add legalmindcode/claude-theater
/plugin install agent-theater@claude-theater
```

The mod is built on Claude Code's function-hooks API, still in early access (Claude Code 2.1.304 or newer). If an update breaks it, I'd love to hear.

https://github.com/legalmindcode/claude-theater

#ClaudeCode #AI #LegalTech #OpenSource
