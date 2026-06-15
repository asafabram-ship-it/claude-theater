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
| 0.1.x          | 2.1.x       |

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/asafabram-ship-it/claude-theater/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/asafabram-ship-it/claude-theater/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/asafabram-ship-it/claude-theater/releases/tag/v0.1.0
