<!-- Thanks for contributing to Claude Theater! Keep it short. -->

## What & why

<!-- What does this change, and why? Link any related issue (e.g. Closes #12). -->

## Checklist

- [ ] `python -m unittest discover -s tests` passes
- [ ] `ruff check .` is clean
- [ ] If this touches the journal parser (`parse_agent_event`) or the data the UI
      reads, I considered Claude Code **format drift** and added/updated a fixture
      under `fixtures/` if needed
- [ ] If this adds or changes any UI string, both `en` and `he` entries in the
      `I18N` table are updated (parity)
- [ ] No new third-party runtime dependencies (the server stays single-file,
      standard-library only)
