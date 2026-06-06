# Contributing to Claude Theater

Thanks for helping! The single most valuable contribution is a **journal sample
from a Claude Code version we haven't tested** — that's what keeps the parser
honest as the format evolves.

## #1 contribution: a format-drift report

If you see the yellow banner ("Tested up to Claude Code X · detected Y") or an
agent renders oddly, please:

1. Find a recent `agent-*.jsonl` under
   `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/`.
2. **Scrub it.** These files contain real conversation content. Replace every
   task/prompt and every result/text with synthetic placeholder text. Keep the
   structure (the `type`, `message.content` block shapes, `tool_use` names,
   `stop_reason`, `version`) — that's all the parser cares about.
3. Drop it under `fixtures/cc-<major.minor>/` and open a PR (or attach it to an
   issue). Mention the exact `claude --version`.

A scrubbed fixture + the version string is enough for us to add an adapter case.
**Never commit unscrubbed journal content.**

## Adding a language

The UI is bilingual (English/Hebrew) and the server is language-neutral. To add
a language, edit the `I18N` table (and the `PERSONAS_*` / `TOOLS_*` tables) in
`claude_theater.py` — one file, no Python logic changes. Keep the key set
identical across languages (the tests and `t()` fallback assume parity).

## Dev setup

Pure standard library — nothing to install to run or test:

```bash
python -m claude_theater                 # run it
python -m unittest discover -s tests -v  # golden parser + contract tests
```

Optional, matching CI:

```bash
pipx run ruff check .     # lint (real bugs only: pyflakes + syntax)
pipx run build            # build sdist + wheel
pipx run twine check dist/*
```

## Ground rules

- **Privacy first.** Keep everything local; never add telemetry or outbound
  calls. The server binds `127.0.0.1` only.
- **No runtime dependencies.** The tool stays single-file stdlib.
- **Keep the parser isolated.** `parse_agent_event(line) -> Event` is the only
  code that touches raw JSONL; everything else consumes the stable `Event`.
- Add or update a fixture + test when you change parsing or the emitted payload.
