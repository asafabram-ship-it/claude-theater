# Roadmap

Directional, not a promise. Issues and PRs welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md). The guiding constraints don't change:
**local-only, zero runtime dependencies, single-file stdlib, degrade-not-crash.**

## Now — 0.1.x

- Single-file, pure-stdlib web app; one room per conversation.
- Isolated parser with degrade-not-crash and a version banner.
- Bilingual UI (English / Hebrew), instant toggle, RTL-aware.
- `--demo` office for screenshots and a zero-setup first run.
- PyPI / pipx packaging; CI across Windows/macOS/Linux × Python 3.9–3.13.

## Next

- **Claude Code version adapters** as the format evolves — driven by
  community format-drift reports (the #1 contribution).
- **VS Code extension**: reuse the existing HTML/JS inside a `WebviewPanel`
  (also mirrored to Open VSX for VSCodium / Cursor).
- **npx** entry point for the Node-native crowd.
- **More languages** — each is a single edit to the `I18N` table.
- Labels for **tools** beyond the current set (broader MCP coverage).

## Ideas (v2, unscheduled)

- Native finish notifications (e.g. Windows toast via an optional, lazy import).
- Themes / skins.
- Friendly room labels derived from the conversation title instead of the cwd.
- Per-agent timing stats (durations, tool histograms).

## Non-goals

- No telemetry, no network calls, nothing that leaves `127.0.0.1`.
- No required runtime dependencies.
- No control over agents — Claude Theater only *watches* the journals Claude
  Code already writes.
