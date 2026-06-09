# Claude Theater — VS Code extension

Watch your Claude Code subagents as a live, animated office, **inside VS Code** —
in a full WebviewPanel where clicks, focus, language toggle, search, and keyboard
nav all work (unlike the built-in Simple Browser, which doesn't forward those).

## Install

The server is **bundled into the extension** — no separate install needed.

- **Prebuilt:** download `claude-theater-<version>.vsix` from the
  [latest release](https://github.com/asafabram-ship-it/claude-theater/releases/latest),
  then run **Extensions: Install from VSIX…** (or `code --install-extension <file>.vsix`).
- **From source:** `cd vscode-extension && npx @vscode/vsce package`, then install the `.vsix`.

## Use

- The bundled server auto-starts in the background when VS Code launches.
- Open the office from the **"📡 Theater"** status-bar button, or the
  Command Palette → **"Claude Theater: Open Theater"**.
- If a server is already running on `127.0.0.1:7333`, it connects to that one
  instead of starting another.

## Settings

- `claudeTheater.port` (default `7333`) — server port.
- `claudeTheater.autoStart` (default `true`) — auto-start the server on launch.
- `claudeTheater.pythonPath` — interpreter for the server (empty = try `python`, `py`, `python3`).
- `claudeTheater.serverScript` — path to `claude_theater.py` (empty = use the bundled copy).

## How it works / privacy

The panel embeds the server's own HTML directly in the webview and fetches data
from `127.0.0.1`. The server only emits CORS headers to a `vscode-webview://`
origin, so the page stays local-only — a web page in a normal browser can't read
your agents. No telemetry, no outbound calls.

## Develop

Open this folder in VS Code and press **F5** (Extension Development Host). The
repo root (one level up) must contain `claude_theater.py` so the auto-start can
resolve `python -m claude_theater`.
