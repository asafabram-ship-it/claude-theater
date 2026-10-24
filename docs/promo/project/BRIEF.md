---
workflow: general-video
flow: automation
storyboard: no
message: "Claude Theater turns a wall of agent logs into a live, readable office"
destination: linkedin
aspect: "1:1"
width: 1080
height: 1080
length: 24
language: he
audience: Claude Code users, Israeli tech / legal-tech LinkedIn
voiceover: yes
captions: he
---

## Intent

20-second LinkedIn promo for Claude Theater 0.5.0 (the desktop mod). Hebrew, right-to-left.
Clean, in the Legal Mind logo colours: teal `#31A3AD` / `#1F7A82` on a light ground, no gold, no dark navy.
Ends on Legal Mind only. Nothing the mod does not really do.

## Scenes (voice is the clock)

1. 0-3.2s - full Legal Mind logo, "Claude Theater", "משרד חי לסוכנים של Claude Code".
2. 3.2-7.6s - a Claude Code conversation (drawn, no screenshot available) where Agent blocks pile up
   faster and faster ("קשה לעקוב מי עושה מה"); then the pane opens beside the conversation.
3. 7.6-14.9s - the "🎭 התיאטרון" pane rebuilt from the real screenshots and the mod's code: a teal card per
   conversation, rows (🦊 Opus ⋯ חושב, Haiku ✓ סיים), ★ then ✓ when an agent finishes, the visual 5-hour meter
   (`⏳ 5h ▰▰▰▰▱▱▱▱▱▱ 42%`), a click on a name opens the details drawer with the result, 📌 pin, "© Legal Mind" + mark.
4. 14.9-20.5s - `/plugin marketplace add legalmindcode/claude-theater`, "חינם · קוד פתוח · לא יוצא לרשת",
   the full logo and legalmind.co.il.

## Assets

- Narration: kolbo, ElevenLabs V4, voice "Brian", Hebrew (`assets/narration.mp3`, three long pauses trimmed).
- Music: kolbo Sonilo text-to-music, instrumental, 22s (`assets/music.mp3`).
- Done sound: the mod's own `desktop-mod/sounds/done.wav`.
- Logo: legalmind.co.il `brand/legalmind-logo.webp` (full); pane mark `lm-logo-48.png` (as in the pane's credit line).
- Font: Heebo (OFL), JetBrains Mono (bundled).

## Notes

- Approval gate: one still per scene before the full render.
- Deliverables: `docs/promo/claude-theater-0.5.0-square.mp4`, `docs/promo/post.md`.
