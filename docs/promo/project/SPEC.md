GOAL:    a Claude Code user sees the wall of logs become one calm pane, and leaves with the install command.
OUTPUT:  HyperFrames, 1080 x 1080, 30 fps
TIME:    20.5 s x 30 = 615 frames. The voice is the clock (narration starts at 0.2 s).
LOOK:    ground #F3F8F8 flat, no texture. ink #142430 (the logo's dark letters). accent #31A3AD (card frames,
         counts line, one word per shot), deep accent #1F7A82 (command prompt, links). dim #6E7F86 (the meter, as in the pane).
         Heebo 800 for titles (96 px, -2% tracking), Heebo 500 body (40-46 px), JetBrains Mono 26-28 px for code.
         Medium: the real pane, rebuilt at ~1.8x its size (rows 40 px text), white panel, 2 px teal card frames,
         radius 22 px, shadow 0 18px 40px rgba(20,36,48,.10). The terminal is the only dark object (#0F1A20).
OBJECTS: the terminal window (title bar, three dots, mono lines tagged by agent); the pane (header 🎭 התיאטרון,
         counts line, the 5h meter ⏳ 5h ▰▱ 42%, cards with a pin, rows: dot, persona, emoji, model, mark, word);
         the drawer (double frame, chips, מודל / משימה / תוצאה); the cursor; the full Legal Mind logo.
MOTION:  enter power3.out 0.5 s; move power2.inOut 0.5 s (camera pushes); exit power2.in 0.3 s.
         Stagger 3 frames for rows. Marks change on the word that names them.
SHOTS:   0.0-3.2   logo wipes in (clip-path L to R), title rises, tagline. Voice: "Claude Theater: משרד חי..."
         3.2-7.6   terminal fills, lines accelerate to a wall. Captions: c2, c3. Ends folding into a card.
         7.6-14.9  pane enters; meter push-in and fill 42→67%; ★→✓ on הסופר (done.wav); cursor clicks הסופר,
                   drawer opens with the result; 📌. Captions: c4, c5, c6.
         14.9-20.5 command types in, three claims land on their words, logo lands centred at 18.1 s with legalmind.co.il.
BANNED:  dark void ground; glow; purple/blue gradients; glass; everything centred and fading up at once;
         invented UI (only what the mod draws); gold; dark navy fills; logo docked in a corner.
QA:      1.6 s logo legible; 5.5 s wall of logs + caption; 9.0 s meter readable; 11.4 s ✓ on הסופר;
         13.6 s drawer with תוצאה; 16.5 s command whole on one line; 19.5 s logo centred.
