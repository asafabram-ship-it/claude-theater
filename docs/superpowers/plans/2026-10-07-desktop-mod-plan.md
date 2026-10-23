# Claude Theater → Claude Code mod: build plan (skeleton + module contracts)

Date: 2026-10-07 · Branch: `feat/desktop-mod` · Spec: `docs/superpowers/specs/2026-10-07-desktop-mod-design.md` (read "עדכון היקף")
Mod folder: `desktop-mod/` (a junction from the engine's dev-mods folder points here). Engine: Claude Code 2.1.288 (the desktop app's).

## Forced changes discovered while validating (differ from the task text)

| Forced by the engine | What we do |
| --- | --- |
| `claude plugin validate` refuses plugin names starting with `claude-` (reserved for Anthropic) | plugin name is **`agent-theater`**; `$.state` plugin key, `PANE_ID` and the `ui.render` matcher use it. Pane title stays "🎭 התיאטרון". |
| `$` may never be passed to a function imported from another file | `scanner.ts` takes a `ScanIo` closure adapter built in `register.tsx` (`scanIo($)`); `live.ts` is pure reducers; helpers that take `$` (`openPane`, `poll`, `loadPrefs`) live in `register.tsx`. Imported hook callbacks and `on` passed across imports ARE allowed. |
| An event may be hooked only once without a matcher per module | the single `session.start`, `agent.spawn`, `tool.call` hooks are in `register.tsx`. Hooks with matchers (`command.run{command}`, `ui.render{component,requestId}`, `ui.press`, `ui.input`) may live in `ui.tsx`. |
| `read`/`update`/`$.state.*` accept only an atom declared as a `const` in the same file, with literal `plugin`/`key` | `model.ts` exports the defaults (`EMPTY_PAYLOAD`, `DEFAULT_PREFS`, `DEFAULT_VIEW`); each file declares its own `atom({ plugin: 'agent-theater', key: '...' } as const, DEFAULT)`. |
| `$.env.get` takes a literal name | `scanIo($).home()` reads `HOME` then `USERPROFILE` with literals. |
| The PATH `claude` is 2.1.239 and knows neither `modules` nor `types` | run checks with the desktop's engine: `C:/Users/asafa/AppData/Roaming/Claude/claude-code/2.1.288/36aa8c97bf86/claude.exe plugin validate|test desktop-mod`. |
| `$.fs.read` rejects files over 4 MiB and has no tail read | a transcript over `FS_READ_LIMIT` is skipped, counted in `payload.oversized` and shown in the footer (`oversizedN`); never a crash. Optional later: `$.process.run` tail. |

## Checks

```
C:/Users/asafa/AppData/Roaming/Claude/claude-code/2.1.288/36aa8c97bf86/claude.exe plugin validate C:/Users/asafa/agent-theater/desktop-mod
C:/Users/asafa/AppData/Local/Temp/theater-tsc/node_modules/.bin/tsc -p C:/Users/asafa/AppData/Local/Temp/theater-tsc   # tsconfig outside the mod, includes desktop-mod/hooks + types
C:/Users/asafa/AppData/Roaming/Claude/claude-code/2.1.288/36aa8c97bf86/claude.exe plugin test C:/Users/asafa/agent-theater/desktop-mod
```
(`tsc -p desktop-mod` once the engine has laid `.claude-plugin/types/` there; that folder is git-ignored.)

## Files and owners (three builders, no overlapping files)

| File | Owner | Status |
| --- | --- | --- |
| `.claude-plugin/plugin.json`, `hooks/hooks.json`, `.gitignore` | architect | done |
| `types/index.d.ts` — the `$.state` contract + payload shapes (snake_case keys = Python payload) | architect | done |
| `hooks/model.ts` — re-exported types, constants from Python, `personaIndex`, `shortTask`, `mcpServer`, `clipResult`, defaults | architect | done (builders add only values two modules share) |
| `hooks/register.tsx` — wiring (below) | architect | done; builders swap stub calls only |
| `hooks/scanner.ts` (+ `scanner.test.ts` on `fixtures/cc-2.1`, `fixtures/cc-future`) | builder **scanner** | stubs |
| `hooks/live.ts` (+ `live.test.ts`) | builder **live** | reducers partly done; `liveAged`, `mergeLive` stubs |
| `hooks/ui.tsx`, `hooks/i18n.ts`, `hooks/personas.ts` (+ `ui.test.ts`), audio asset `sounds/done.wav` | builder **ui** | header stub; tables ported |
| `hooks/skeleton.test.ts` | architect | 4 passing |

## Module contracts

### register.tsx (architect)
- `session.start`: load prefs from `$.store('prefs')` → `prefs`; `$.session.id()` → `sessionId`; `$.command.register({ name: 'theater', immediate })`; first `poll($)` then `$.clock.every(POLL_MS=1500, poll)`.
- `poll($)`: `scanAll(scanIo($), now)` (or `demoPayload(now)` while `view.demo`) → `liveAged(live, await $.agent.list(), now)` → `mergeLive(payload, live, sessionId, now)` → `payload`; errors → `scanError` (never thrown).
- `agent.spawn`: after `next`: `liveSpawned`; auto-open the pane once (`paneOpened`).
- `tool.call`: `e.agentId` set → `liveToolStarted` / `liveToolReturned` around `next`; main loop's `Agent` call → `liveAgentReturned(tool_use_id, text, isError)`.
- `command.run{theater}`: `$.ui.open({ id: 'agent-theater', title: paneTitle(lang) })`.
- Every hook: try/catch + `.catch(($, e, next) => next(e))`.

### scanner.ts (builder scanner) — `ScanIo = { read, list, stat, exists, home }`
- `scanAll(io, now) → Payload & { error? }` — port of `_scan_agents` + `scan_sessions`: `~/.claude/projects/**/agent-*.jsonl` within `MAX_AGE_MIN`, parent session files (`name_map_for` join on `normPrompt(prompt)`, `project_cwd_for`, `session_summary` → `topic` on the lead), `journal.jsonl` for workflow agents, `~/.claude/sessions/*.json` → `closed`, `computeStatus`, `resolvePersonas`, sort `(STATUS_ORDER, lead first, -start_ms)`. Caches keyed by `(path, mtime, size)`; listings throttled `GLOB_TTL_SEC`.
- Pure ports with Python names: `parseAgentEvent`, `parseEvents`, `lastToolUseName`, `detectDone` (deny-list `CONTINUATION_STOP_REASONS`, `RESULT_CHAR_LIMIT`), `computeInFlight`, `computePhase`, `computeStatus(nowSec, mtimeSec, isDone, inFlight, closed)`, `normPrompt`, `parentSessionFile`, `resolvePersonas`.
- Async ports: `isWorkflowAgent`, `workflowJournalResult`, `nameMapFor`, `projectCwdFor`, `sessionSummary`, `liveSessionIds`.
- `demoPayload(now, phase?)` — the synthetic office (rooms, ⏰, ⭐, stale, MCP tool).
- Tests: in-memory `ScanIo` over the fixtures; assert statuses, phases, names, results, `oversized` on a >4 MiB stub.

### live.ts (builder live) — pure
- `liveSpawned`, `liveToolStarted`, `liveToolReturned`, `liveAgentReturned` (done), `liveAged(live, listed, now)`, `mergeLive(payload, live, sessionId, now)` (live agent replaces the scanner's by id, keeps scanner's project/cwd/persona; unknown → added to this session's room; status: completed/failed/killed or result → done, silent > `RUNNING_STALE_SEC` → stale; re-sort + `resolvePersonas`).

### ui.tsx + i18n.ts + personas.ts (builder ui)
- `registerUi(on)`: `ui.render{Pane, 'agent-theater'}` draws from `payload`, `prefs`, `view`, `scanError` (atoms declared in ui.tsx); `ui.press`/`ui.input` (or element closures) write `prefs` (mirror to `$.store`) and `view`.
- Draw list: header + counts; rooms per `session_full` (pins first 📌, lead first, topic); cards: emoji + `personaName`, role + subagent_type, `activityLabel`, mm:ss, ⏰ ≥ `LONG_RUNNING_MS`, ⭐ within `JUST_FINISHED_MS` (+ confetti via `Client` frame clock), ❌ failed; details drawer (task, activity, duration, result, truncated note); search; show-done; mute; lang toggle (RTL ↔ LTR: `row-reverse`); help overlay; demo chip; footer (`oversizedN`, skipped, scanError).
- Side effects on finish: `$.audio.play({ asset: 'sounds/done.wav' })` unless muted; `$.ui.toast(name + finishedToast)`.
- Width: `e.props.bodyColumns`. Hebrew default.
- Tests: mount on `['terminal','desktop']`, press/input by key.

## Payload keys (unchanged from the extension)
`id, persona_id, emoji, role, subagent_type, status(running|stale|done), tool, phase(tool|thinking), task, task_short, result, start_ms, end_ms, session, session_full, cwd, project, mtime_ms, is_session, closed, is_workflow, truncated` (+ mod-only `topic` on the lead).
