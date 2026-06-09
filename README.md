<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

# 🎭 Claude Theater

**Watch your Claude Code conversations and subagents work — a live office, in real time.**

[![CI](https://github.com/asafabram-ship-it/claude-theater/actions/workflows/ci.yml/badge.svg)](https://github.com/asafabram-ship-it/claude-theater/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/claude-theater.svg)](https://pypi.org/project/claude-theater/)
[![Python](https://img.shields.io/pypi/pyversions/claude-theater.svg)](https://pypi.org/project/claude-theater/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

<!-- Absolute raw URL so the image renders on PyPI too (relative paths don't). -->
<img src="https://raw.githubusercontent.com/asafabram-ship-it/claude-theater/main/docs/hero.gif" alt="Claude Theater — a live office of Claude Code subagents at work: agents walk in, type, and finish with confetti" width="820">

<sub>The demo office (`claude-theater --demo`): conversations and subagents at work, each agent walks in, sits, head-bobs while it types, then confetti on finish. A community visualizer **for Claude Code** — not affiliated with Anthropic.</sub>

</div>

Try it now, no Claude Code session required — `pipx run claude-theater --demo`
spins up the office above with synthetic agents.

**Why?** When you fan out a handful of subagents, the terminal becomes a wall of
interleaved JSON. Claude Theater turns it into a glance — who's working, who's
stuck, who just finished — without reading a single log line.

**Safe by design:** it runs entirely on your machine. Binds to `127.0.0.1`, sends
nothing anywhere (no telemetry), only *reads* the journals, and the whole thing is
one auditable standard-library file with zero dependencies. ([more](#privacy))

---

Claude Theater reads the journals Claude Code writes for your conversations and
the subagents they spawn, and renders them as a live office: **every conversation
is a room** (titled by its subject), and inside it the conversation itself plus
each subagent is a little character at a desk — avatar, name, the tool it's using
right now, and a timer. Click any character to read its full task and result.
When an agent finishes: confetti, a chime, and it quietly steps off the floor —
and each room has its own **show-finished** toggle, so you control the history
per conversation.

The UI is **bilingual** — English by default, Hebrew one click away (the choice
is remembered, and the layout flips to RTL). Adding another language is a single
edit to the `I18N` table in `claude_theater.py`; the server stays language-neutral.

## Quick start

Zero install — run it straight from PyPI with [pipx](https://pipx.pypa.io/):

```bash
pipx run claude-theater          # watches your real Claude Code sessions
pipx run claude-theater --demo   # a synthetic, populated office — no sessions needed
```

New here? Start with `--demo` to look around before pointing it at your own work.

Or install it:

```bash
pipx install claude-theater   # or: pip install claude-theater
claude-theater                # add --demo for the synthetic office
```

Or run from a clone (pure standard library, nothing to install):

```bash
python -m claude_theater
```

Then open **http://localhost:7333**. The server opens your browser for you — pass
`--no-browser` to skip that (handy on a headless box or inside an editor panel).
On Windows, from a clone, you can also just run `start.cmd`.

> Requires Python 3.9+. The non-demo mode reads the journals a Claude Code
> install writes under `~/.claude/projects/`; `--demo` needs nothing but Python.

## VS Code extension

Prefer it inside your editor? The `vscode-extension/` folder packages Claude
Theater as a VS Code extension: it starts the server in the background (toggle it
from a status-bar button) and opens the office in an interactive panel — no
separate terminal. The server is bundled into the extension, so it works without
a separate install, and it auto-starts when VS Code launches.

**Install the prebuilt `.vsix`** (easiest) — download
`claude-theater-<version>.vsix` from the
[latest release](https://github.com/asafabram-ship-it/claude-theater/releases/latest),
then in VS Code run **Extensions: Install from VSIX…**, or from a terminal:

```bash
code --install-extension claude-theater-<version>.vsix
```

**Or build it from source** (needs Node.js):

```bash
git clone https://github.com/asafabram-ship-it/claude-theater
cd claude-theater/vscode-extension
npx @vscode/vsce package        # produces claude-theater-<version>.vsix
code --install-extension claude-theater-*.vsix
```

## Auto-start with Claude Code

The VS Code extension already starts the server on launch. If you use the CLI,
the recommended one-time setup is a `SessionStart` hook in your
`~/.claude/settings.json`, so the office comes up by itself whenever you begin a
Claude Code session. Each user adds it once. (Heads-up: this leaves an
unauthenticated loopback endpoint running in the background — see [Privacy](#privacy).)

<details>
<summary><b>macOS / Linux / Git Bash</b></summary>

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command",
        "command": "curl -sf http://127.0.0.1:7333/ -o /dev/null || (claude-theater --no-browser &)" } ] }
    ]
  }
}
```

</details>

<details>
<summary><b>Windows (PowerShell)</b></summary>

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command",
        "command": "powershell -NoProfile -Command \"if(-not(Get-NetTCPConnection -LocalPort 7333 -State Listen -ErrorAction SilentlyContinue)){Start-Process -WindowStyle Hidden -FilePath claude-theater -ArgumentList '--no-browser'}\"" } ] }
    ]
  }
}
```

</details>

Both check the port first, so they stay idempotent. (Requires `claude-theater`
on your `PATH`, e.g. via `pipx install claude-theater`.)

## How it works

- Polls the journals Claude Code already writes — both the session files (your
  conversations) and `**/subagents/agent-*.jsonl` (the subagents they spawn).
  Claude Theater only reads them; it never starts or controls agents.
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

- Binds to **`127.0.0.1` only** — never reachable from the network, with a
  loopback `Host` allowlist that blocks DNS-rebinding.
- **Never transmits** anything anywhere. No telemetry, no remote calls.
- **Read-only** — it opens journals to read, never to write.
- A strict `Content-Security-Policy` and `X-Content-Type-Options: nosniff`, and
  cross-origin headers sent **only** to a `vscode-webview://` origin, so an
  ordinary web page can't read your agents.
- The committed `fixtures/` are 100% synthetic — no real prompts or results.

The local endpoint is **unauthenticated**: any process running as you on this
machine can read it — the same trust boundary as the journal files themselves.
The auto-start hook above leaves that endpoint up in the background.

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
