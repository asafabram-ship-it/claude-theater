# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

SemVer policy for this tool:

- **PATCH** — parser fixes / new Claude Code build adapters.
- **MINOR** — new format adapters, themes, languages, dashboard additions.
- **MAJOR** — breaking changes to the dashboard or the emitted API shape.

## Tested against Claude Code

| Claude Theater | Claude Code |
| -------------- | ----------- |
| 0.4.x          | 2.1.x       |
| 0.3.x          | 2.1.x       |
| 0.1.x          | 2.1.x       |

## [Unreleased]

## [0.4.0] - 2026-07-19

### Added

- **Working vs thinking, at a glance.** Each character now shows the tool verb only
  while a tool is actually pending; once the tool returns and the model is reasoning,
  the label reads "Thinking" instead of freezing on a stale "Reading". Derived from the
  transcript tail, no extra I/O.
- **Long-running spotlight.** A genuinely long-running (≥10 min) live agent is flagged
  with a clock marker and a warmer timer, so a 25-minute worker no longer looks
  identical to a 20-second one in a crowded office.
- **Pin conversations.** A 📌 on any room header keeps that conversation at the top of
  the office no matter what else ticks; the choice persists.
- **A wider cast.** The persona roster grew from 16 to 48 distinct workers, and
  co-located agents in one room are now guaranteed different avatars (stable across
  scans), so a busy room stops showing duplicates.

### Fixed

- **A working subagent is no longer shown as idle.** Status was derived from file
  mtime alone, so an agent silent while running a long tool (a build, a large fetch, a
  long thinking turn) flipped to "idle" after 90s. State now comes from the transcript
  tail (a dispatched-but-unreturned tool, or a tool result awaiting the model) and a
  live mid-tool agent stays "working", bounded so a crashed one is never pinned forever.
- **Finished workflow subagents no longer stick on "running".** Their done-signal lives
  in a sibling journal the scan cache did not re-read; it is now refreshed every scan.
- **Header counts match the floor**, the **language toggle re-translates the whole
  office immediately** (not only after the next poll), the **open drawer keeps keyboard
  focus and scroll** across refreshes and updates even when its agent is filtered off
  the floor, a **scan failure surfaces the reconnect banner** instead of a blank office,
  and a **non-string version stamp** can no longer blank the office.
- **Concurrency-safe scan** (a lock prevents two viewers from racing the shared caches),
  and the parent/project/session caches are now evicted so they cannot grow unbounded.
- **Readability and RTL**: activity labels, the version-drift link, hover/focus feedback
  and high-contrast themes are legible in light and high-contrast editors; the walk-in
  animation and the keyboard-help arrow legend read correctly under RTL.
- **Accessibility**: roving tabindex (the office is one Tab stop), focus management for
  the help popover, an assertive reconnect alert, and screen-reader announcements for
  search results.

### Changed

- **Durable settings in the VS Code panel.** Mute / language / show-finished / per-room
  and pin choices are mirrored through the extension's storage, so they survive closing
  and reopening the Theater tab (the browser/CLI keeps using localStorage).
- **The connecting/waiting page is localized** and follows the Hebrew setting.

## [0.3.1] - 2026-06-18

### Fixed

- **Closed conversations no longer reappear under "Show finished".** A chat you closed
  (its process is gone, so it's flagged `closed`) is meant to leave the office. It was
  hidden by default, but ticking "Show finished" — whose job is to reveal finished
  *agents* inside *open* conversations — was also resurrecting the dismissed chats as
  "finished" rooms. The visible-filter now drops any `closed` entry outright, so a
  closed conversation stays gone regardless of the toggle, and the finished counter no
  longer counts it. (Detection was already correct; this is purely the display rule.)
- **Text is readable in a light editor theme.** The detail panel's body text
  (Action / Task / Result) and close button, the help button, and the header's
  mute-chime and language buttons were hardcoded to a light ink that stayed light when
  the office followed a VS Code *light* theme — light-on-light, unreadable (the header
  buttons were near-invisible). They now use the theme tokens (`--ink` / `--chip-ink`),
  so the text is dark on light and unchanged on dark.
- **Office now fills the whole VS Code panel.** A short office (only a few rooms) used
  to leave a large blank/gray strip below it in the editor tab, because a webview
  doesn't propagate the `<body>` background to the canvas the way a browser does. The
  body is now pinned to `min-height:100vh` and the `html` base follows
  `--vscode-editor-background` (falling back to the office's own dark in a plain
  browser), so the dark office fills the panel regardless of how many rooms are open.

### Changed

- VS Code extension 0.3.1: bundles the fixes above (it ships its own copy of the
  server), so the in-editor office gets the closed-chat, light-theme, and
  fill-the-panel fixes too.

## [0.3.0] - 2026-06-17

### Fixed

- **Closed conversations no longer linger in the office.** A chat used to keep its
  room on the floor for up to `MAX_AGE_MIN` (3 h) after you closed it, because the
  only signal was the journal file's mtime. The scanner now reads Claude Code's
  live-session registry (`~/.claude/sessions/<pid>.json`, written on start and
  removed on exit, cross-checked against PID liveness) and treats any conversation
  that's no longer open as **closed**: its room collapses to "finished" and hides
  by default the moment the chat is closed. Subagents orphaned by a closed chat
  collapse the same way once idle. Builds without the registry directory fall back
  to the previous behavior unchanged. Adds a `closed` boolean to each payload entry.
- **Workflow subagents now show correct status and results.** A workflow agent ends
  on a `StructuredOutput` tool call, so the regular done-detection read it as "still
  running" forever. The scanner now recognizes `subagents/workflows/wf_*/` agents and
  pulls their authoritative status + result from the sibling `journal.jsonl` (keyed
  by `agentId`), falling back to the transcript when no result is recorded yet.
- **Finished agents are no longer missed when the model ends on an unfamiliar reason.**
  Done-detection switched to a deny-list of continuation `stop_reason`s (`tool_use`,
  `pause_turn`); any other tool-free final turn — including `refusal` or a reason a
  future Claude Code build invents — now counts as done.
- **Real agent names join more reliably.** The subagent↔parent-`Task` match now
  normalizes whitespace on both sides and keeps the first spawn for a repeated prompt,
  so trivial formatting differences no longer drop an agent's role.

### Fixed (RTL)

- **Hebrew (RTL) rendering glitches.** Verified against real headless-browser renders:
  (1) room count clusters mixing emoji + numbers + "·" separators reordered and looked
  like negative numbers ("-1 -3") — the counts span is now `dir="ltr"` (it's only
  emoji/digits); (2) English topics/tasks/results shown in the RTL page had their
  trailing punctuation flung to the wrong end (e.g. ".bug backlog") — room titles, the
  drawer name/role, card name/activity and the truncated-result note are now `dir="auto"`
  so each run reads in its own direction. (Confetti/star/help-popover were already
  RTL-correct.)

### Performance

- **Much lower idle CPU.** Two fixes to what was a steady ~25% of a core while the
  panel was open: (1) the recursive glob over the entire `~/.claude/projects` history
  — ~90% of each scan and growing with history — is now cached and rebuilt at most
  every `GLOB_TTL_SEC` (6s) instead of every 1.5s poll, cutting per-scan cost ~2.6×
  (existing agents stay live; only first-appearance of a new agent waits up to 6s);
  (2) the client now **stops polling and the per-second timer when the panel tab
  isn't visible** (`document.hidden`) and resumes instantly when shown — a retained
  VS Code webview otherwise polls forever in the background. Plus `contain:layout` on
  cards to scope layout recalc. Memory was already fine (~17 MB).

### Added

- **UI/UX pass:** light/high-contrast VS Code theme sync (the office follows the
  editor theme instead of always being dark), a narrow split-pane layout, a `?`
  keyboard-shortcut help popover, a first-load spinner, a lingering "⭐ just
  finished" marker, a live working-count in the tab title, GPU-friendly animations,
  confetti that no longer clips at the room edge, focus moved to the detail content
  on open, and a note when a long result is shortened. New payload fields:
  `is_workflow`, `truncated`.
- VS Code extension 0.2.2: Marketplace listing metadata (theater-masks icon,
  gallery banner, bugs/homepage links) and a manual `publish-extension.yml`
  workflow that packages the `.vsix` and publishes it with a `VSCE_PAT` secret.

### Changed

- VS Code extension 0.2.3: the office now opens as a **docked side panel**
  (`WebviewView` in its own activity-bar container) instead of taking over an
  editor tab — drag it to the secondary/right side bar to watch the agents move
  beside your code. Adds a waiting/Retry page while the local server starts.
- VS Code extension 0.2.4: a one-time tip (with an "open the right side bar"
  action) the first time the office is opened, nudging users to drag it to the
  Secondary Side Bar — VS Code can't default a view there without a Marketplace-
  blocked proposed API, so the right-side placement stays a one-time drag.
  README documents the side-panel + drag-to-right flow.
- VS Code extension 0.2.5: the panel now **opens automatically on startup**
  (`claudeTheater.openOnStartup`, default on). It's easy to turn off — an eye
  button in the panel's title bar, a toggle in the status-bar menu, an action on
  the first-run tip, or the setting — so users are never stuck with it.
- VS Code extension 0.2.6: the office now opens **in the editor area beside your
  file** (a split editor tab, where Markdown/code open) instead of the side bar —
  so it sits next to what you're working on and closes with the tab's own X. This
  placement *can* be the default for everyone (no proposed API needed, unlike the
  secondary side bar). Drops the side-bar view container; keeps open-on-startup
  and all the ways to turn it off.

## [0.1.1] - 2026-06-09

### Added

- Animated hero (`docs/hero.gif`) in the README — the office in motion.
- `--port N` flag and `CLAUDE_THEATER_PORT` environment variable to choose the
  listen port.

### Changed

- README: lead with the "why" and a "safe by design" note, pull the security
  hardening into Privacy, collapse the auto-start hooks, and give a precise VS
  Code extension install path (prebuilt `.vsix` on Releases, or build from source).

### Fixed

- On Windows, a second instance no longer silently double-binds the port
  (`allow_reuse_address` is off there); a duplicate now fails with a clear
  message suggesting `--port`.
- The startup banner is flushed, so it shows even when stdout is piped.
- Real (non-demo) mode with no journals now prints a hint to try `--demo`.

## [0.1.0] - 2026-06-08

### Added

- Initial release: a single-file, pure-stdlib web app that visualizes Claude
  Code subagents as a live office (one room per conversation), served on
  `127.0.0.1:7333`.
- Isolated parser `parse_agent_event(line) -> Event` — the only code that
  touches the raw journal format — with degrade-not-crash handling.
- Non-blocking version banner when journals come from an untested Claude Code
  version.
- Bilingual UI: English by default, Hebrew toggle (persisted, RTL-aware).
- `--demo` mode: a synthetic, populated office (no real journals read) for a
  zero-setup first run and for capturing screenshots / the Hero GIF.
- `--version`, `--help`, `--no-browser` flags; the app opens the browser itself
  once the port is bound.
- Packaging for PyPI/pipx (`claude-theater` / `python -m claude_theater`) and
  CI across Windows/macOS/Linux × Python 3.9–3.13.
- VS Code extension (versioned independently, shipped as a `.vsix` on the GitHub
  release): the office in an interactive WebviewPanel, with background auto-start
  and a status-bar toggle.

[Unreleased]: https://github.com/asafabram-ship-it/claude-theater/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/asafabram-ship-it/claude-theater/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/asafabram-ship-it/claude-theater/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/asafabram-ship-it/claude-theater/compare/v0.1.1...v0.3.0
[0.1.1]: https://github.com/asafabram-ship-it/claude-theater/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/asafabram-ship-it/claude-theater/releases/tag/v0.1.0
