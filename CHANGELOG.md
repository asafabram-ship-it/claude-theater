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

## [0.1.0] - 2026-06-06

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

[Unreleased]: https://github.com/asafabram-ship-it/claude-theater/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/asafabram-ship-it/claude-theater/releases/tag/v0.1.0
