<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

# 🎭 Claude Theater

**Watch your Claude Code subagents work — a live office for every conversation.**

<!-- Absolute raw URL so the image renders on PyPI too (relative paths don't).
     Update the owner/repo if it differs from asafabram/claude-theater. -->
<img src="https://raw.githubusercontent.com/asafabram/claude-theater/main/docs/screenshot.png" alt="Claude Theater — a live office of Claude Code subagents at work" width="820">

<sub>The demo office (`claude-theater --demo`). A community visualizer **for Claude Code** — not affiliated with Anthropic.</sub>

<!-- TODO: record an animated Hero GIF (< 10 MB, ~10 fps) with ScreenToGif —
     a character walks in, sits, head-bobs + types, then confetti + finish pop —
     and swap the static screenshot above for it. -->

</div>

Try it now, no Claude Code session required — `pipx run claude-theater --demo`
spins up the office above with synthetic agents.

---

Claude Theater reads the per-agent journal files Claude Code writes while your
subagents run, and renders them as a live office: each subagent is a little
character at a desk — avatar, name, what tool it's using right now, and a timer.
Agents are grouped into a **room per conversation**. Click any character to read
its full task and result. When an agent finishes: confetti, a chime, and it
quietly steps off the floor (a count stays in the room header).

The UI is **bilingual** — English by default, Hebrew one click away (the choice
is remembered, and the layout flips to RTL). Adding another language is a single
edit to the `I18N` table in `claude_theater.py`; the server stays language-neutral.

## Quick start

Zero install — run it straight from PyPI with [pipx](https://pipx.pypa.io/):

```bash
pipx run claude-theater
```

Or install it:

```bash
pipx install claude-theater   # or: pip install claude-theater
claude-theater
```

Or run from a clone (pure standard library, nothing to install):

```bash
python -m claude_theater
```

Then open **http://localhost:7333**. On Windows you can also just run
`start.cmd`, which launches the server and opens your browser.

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
