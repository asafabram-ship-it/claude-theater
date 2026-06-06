# Fixtures — golden journal samples

Each `*.jsonl` file mimics one Claude Code per-agent journal
(`~/.claude/projects/<cwd>/<session>/subagents/agent-*.jsonl`), organized by
the Claude Code version family it represents.

**All content here is 100% synthetic** — invented tasks, fake agent ids and
session ids, placeholder paths. No real conversation content is ever committed.
When you contribute a sample from a new Claude Code build, scrub every prompt
and result first (see `CONTRIBUTING.md`).

| folder        | file                  | what it exercises                                  |
|---------------|-----------------------|----------------------------------------------------|
| `cc-2.1/`     | `running.jsonl`       | live agent — last event is a `tool_use` (not done) |
| `cc-2.1/`     | `done.jsonl`          | finished agent — final text + `stop_reason`        |
| `cc-2.1/`     | `malformed.jsonl`     | 2 corrupt lines skipped, done still detected        |
| `cc-2.1/`     | `missing_fields.jsonl`| no `agentId`, empty task → degrade, not vanish     |
| `cc-future/`  | `unknown_version.jsonl`| version outside KNOWN_CC_VERSIONS → banner        |

`tests/test_parser.py` runs every fixture through `parse_agent_event` and the
Event-consuming helpers, and fails loudly if the format drifts.
