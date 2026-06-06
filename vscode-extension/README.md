# Claude Theater — VS Code extension

Watch your Claude Code subagents as a live, animated office, **inside VS Code** —
in a full WebviewPanel where clicks, focus, language toggle, search, and keyboard
nav all work (unlike the built-in Simple Browser, which doesn't forward those).

## Use

1. Have the theater server available — either `pip install claude-theater`, or run
   from a source checkout of the repo.
2. In VS Code: **Command Palette → "Claude Theater: Open Theater"**.

If the server isn't already running on `127.0.0.1:7333`, the extension starts it
for you with `python -m claude_theater --no-browser` (configurable). It connects
to a server you already started without touching it.

## Settings

- `claudeTheater.port` (default `7333`) — server port.
- `claudeTheater.autoStartServer` (default `true`) — auto-start if not running.
- `claudeTheater.pythonPath` — interpreter for auto-start (empty = try `python`, `py`, `python3`).

## How it works / privacy

The panel embeds the server's own HTML directly in the webview and fetches data
from `127.0.0.1`. The server only emits CORS headers to a `vscode-webview://`
origin, so the page stays local-only — a web page in a normal browser can't read
your agents. No telemetry, no outbound calls.

## Develop

Open this folder in VS Code and press **F5** (Extension Development Host). The
repo root (one level up) must contain `claude_theater.py` so the auto-start can
resolve `python -m claude_theater`.
