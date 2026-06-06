<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

# 🎭 Claude Theater

**Watch your Claude Code subagents work — a live office for every conversation.**

<!-- HERO GIF GOES HERE (top of README, < 10 MB, ~10 fps).
     Record the full loop with ScreenToGif: a character walks in, sits at a
     desk, head bobs + hands type, then confetti + finish pop. Replace the
     placeholder line below with:  ![Claude Theater](docs/hero.gif)          -->

<img src="docs/hero.gif" alt="Claude Theater — animated office of Claude Code subagents" width="720">

<sub>A community visualizer **for Claude Code**. Not affiliated with Anthropic.</sub>

</div>

---

Claude Theater reads the per-agent journal files Claude Code writes while your
subagents run, and renders them as a live office: each subagent is a little
character at a desk — avatar, name, what tool it's using right now, and a timer.
Agents are grouped into a **room per conversation**. Click any character to read
its full task and result. When an agent finishes: confetti, a chime, and it
quietly steps off the floor (a count stays in the room header).

The UI is **bilingual** — English by default, Hebrew one click away (the choice
is remembered, and the layout flips to RTL). Adding another language is a single
edit to the `I18N` table in `theater.py`; the server stays language-neutral.

## Quick start

No installs, pure Python standard library.

```bash
python theater.py
```

Then open **http://localhost:7333**. On Windows you can just run `start.cmd`,
which launches the server and opens your browser.

> Requires Python 3.9+ and a Claude Code install that writes journals under
> `~/.claude/projects/`.

## How it works

- Polls `~/.claude/projects/**/subagents/agent-*.jsonl` (the journals Claude
  Code already writes — Claude Theater never starts or controls agents).
- A single adapter, `parse_agent_event(line) -> Event`, is the **only** code
  that touches the raw journal format. Everything else consumes the stable
  `Event`, so a Claude Code format change is absorbed in one place.
- **Degrades, never crashes:** corrupt lines are skipped (and counted), unknown
  keys are ignored, and an agent missing fields still shows up instead of
  vanishing.
- A non-blocking **version banner** appears when a journal comes from a Claude
  Code version this build hasn't been tested against — output may be partial,
  but the office keeps running.

## Privacy

Your journals contain real conversation content, so Claude Theater is built to
keep them on your machine:

- Binds to **`127.0.0.1` only** — never reachable from the network.
- **Never transmits** anything anywhere. No telemetry, no remote calls.
- The committed `fixtures/` are 100% synthetic — no real prompts or results.

## Development

```bash
python -m unittest discover -s tests   # golden parser tests, zero dependencies
```

The tests run synthetic journal fixtures through the adapter and fail loudly if
the format drifts. Contributing a journal sample from a new Claude Code build is
the most valuable contribution — **scrub every prompt and result first.**

## Compatibility

Tested against Claude Code **2.1.x**. Newer builds will trigger the version
banner; please open a *format-drift report* with a scrubbed sample so we can add
a fixture and an adapter case.

## License

[MIT](LICENSE) © 2026 Asaf Abramzon. "Claude" is a trademark of Anthropic;
this is an independent, community project for Claude Code.
