# Office Pane UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop office pane self-explanatory: a readable time field for working agents only, real conversation titles, labelled toolbar buttons with the rare ones in help, a hover pin, and a test proving every control works.

**Architecture:** Pure layout changes in `office-layout.ts` (row tail, room head), title precedence in `scanner.ts`, toolbar/help in `office-client.tsx` + `office-chrome.ts`, labels in `i18n.ts`; one new kit test file exercising every control. No change to the publish path in `register.tsx` or the Client update path.

**Tech Stack:** TypeScript Claude Code mod (hooks + surface module), engine test kit (`claude plugin test`).

**Spec:** `docs/superpowers/specs/2026-10-17-office-ui-polish-design.md`. Base: `f067c7b` on `feat/desktop-mod`.

## Global Constraints

- No flicker: do not change register.tsx's publish/poll logic or the Client's update path.
- JSON props < 100,000 chars; rows exactly `columns` cells at every width 24..200, RTL and LTR; whole glyphs only (`glyphs`/`cut`).
- No control or bidi characters in any Text (`REFUSED_RE`); every drawn Hebrew label satisfies `hebrewRuleOk`; every row/line passes `mergeSafe` (office-layout.test.ts).
- Hebrew text must READ correctly under the UBA of one LTR paragraph per row: derive the cell order, do not assume.
- Verify on both engines: `E293=$(ls -d /c/Users/asafa/AppData/Roaming/Claude/claude-code/2.1.293/*/claude.exe)`, `E295=/c/Users/asafa/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe`; `"$E" plugin validate C:/Users/asafa/agent-theater/desktop-mod`, `"$E" plugin test C:/Users/asafa/agent-theater/desktop-mod`; tsc `C:/Users/asafa/AppData/Local/Temp/theater-tsc/node_modules/.bin/tsc -p C:/Users/asafa/AppData/Local/Temp/theater-tsc`.
- Commit per task (English, `feat(mod): …`/`fix(mod): …`, last line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`), push to `origin feat/desktop-mod`.
- Report per task: `.superpowers/sdd/2026-10-10-client-office-and-usage-plan/task-2.8b-<n>-report.md` with commits, test counts on both engines, deviations, ASCII mocks (Hebrew, 32 and 60 columns) from a layout dump.

---

### Task 1: Time field for working agents only

**Files:**
- Modify: `desktop-mod/hooks/office-layout.ts` (`tailText` ~327, `roomFields` ~352-380, `agentRow` ~401-440)
- Modify: `desktop-mod/hooks/i18n.ts` (a minutes unit label per language)
- Test: `desktop-mod/hooks/office-layout.test.ts`

**Interfaces:**
- Produces: `tailText(a, rtl, lang)` returning the badges plus, for `status !== 'done'` with `startMin !== null`, the time text: HE `⏱ 3 דק׳` / `⏱ <1 דק׳` read right-to-left as clock, number, unit; EN `⏱ 3 min` / `⏱ <1 min`. Done agents: badges only (⭐ ❌ ⏰), no time.

- [ ] **Step 1: Write failing tests** in office-layout.test.ts: (a) a running agent's row at 40 cols RTL contains the time field cells in an order that, under the UBA model already used by `mergeSafe`, reads `⏱`, `3`, `דק׳` from the right — add a helper `visualRtlReading(row)` that applies the UBA rules used in mergeSafe (R blocks mirrored, EN after R joins the block, leading neutrals/digits at sos → L) and returns the string a Hebrew reader sees; assert it contains `⏱ 3 דק׳` and that the activity and name still read correctly; (b) a done agent's row has no `⏱` and no digit except in badges; (c) EN LTR row shows `⏱ 3 min`; (d) at 24..200 cols the field is dropped whole when it does not fit and never cut; the field shrinks (is dropped) before the activity word.
- [ ] **Step 2: Run** `"$E295" plugin test C:/Users/asafa/agent-theater/desktop-mod` — expect the new tests to fail.
- [ ] **Step 3: Implement** in `tailText`/`roomFields`/`agentRow`: compute the time text per agent; choose the cell order (e.g. the Hebrew unit + number as one logical run starting with a Hebrew word if needed, e.g. `דק׳` cannot start a block that must show the number first — derive; if `⏱ 3 דק׳` cannot read right without control marks, use the reading-correct alternative `⏱ 3′` HE / `⏱ 3m` EN and say so in the report). Update `roomFields` shrink order: time field away first (whole), then the existing order.
- [ ] **Step 4: Run** tests on both engines + validate + tsc — all pass.
- [ ] **Step 5: Commit** `feat(mod): office rows — a labelled clock for working agents, none for the finished`, push, write the report.

### Task 2: Real conversation titles

**Files:**
- Modify: `desktop-mod/hooks/scanner.ts` (`stripInjectedBlocks` ~961, `firstUserText` ~984, the title assignment of a session)
- Test: `desktop-mod/hooks/scanner.test.ts`

**Interfaces:**
- Produces: the session title used by `OfficeRoom.title` with precedence: (a) the LAST `{"type":"custom-title","customTitle":string}` record in the transcript (also accept `{"type":"ai-title", …}`/`summary`-style title records if real transcripts contain them — grep `~/.claude/projects/*/*.jsonl` and list what exists in the report); (b) the first user message that is not a slash command (`/^\s*\/[\w:-]+/` after `stripInjectedBlocks`), not a pasted block, not an injected tag; (c) the folder name as today.

- [ ] **Step 1: Failing tests** in scanner.test.ts: transcript with `custom-title` → that title (the last one wins, also when it appears after many messages and is read through the incremental/tail parse path); transcript whose first user message is `/theater` and second is `תריץ 4 סוכני משנה` and no custom-title → `תריץ 4 סוכני משנה`; RLE-prefixed `/theater` (`\u202B/theater`) is also skipped; only slash commands → folder name.
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement**: record the latest title record per transcript in the cached per-file events (the incremental parse keeps it across appends; a file reset re-reads it); skip slash commands in `firstUserText`'s caller; clean the title with `cleanAgentText` where other agent text is cleaned (register.tsx's `cleanOffice` already covers `topic`/`project` — confirm which field carries the room title and that it is cleaned).
- [ ] **Step 4: Run** both engines + validate + tsc.
- [ ] **Step 5: Commit** `feat(mod): rooms take the conversation's own title, never a slash command`, push, report.

### Task 3: Labelled toolbar, rare controls in help, hover pin

**Files:**
- Modify: `desktop-mod/hooks/office-client.tsx` (toolbar ~405-416, help popover ~433-442, pointer/hover handling for the room head)
- Modify: `desktop-mod/hooks/office-chrome.ts` (help rows ~23, `chromeRows`/overlay heights if the help grows)
- Modify: `desktop-mod/hooks/office-layout.ts` (room head ~487: no `○`; `📌` when pinned; dim `📌` when `decor.hoverRoom === room.id`)
- Modify: `desktop-mod/hooks/i18n.ts` (labels `tbDone` שסיימו/Finished, `tbSound` צליל/Sound, `tbHelp` עזרה/Help, help buttons for demo/still/language)
- Test: `desktop-mod/hooks/office-client.test.ts`, `office-layout.test.ts`, `i18n.test.ts`

**Interfaces:**
- Consumes: `OfficeDecor` (office-layout.ts) — add `hoverRoom: string | null` (NO_DECOR: null).
- Produces: toolbar buttons with keys `showDone`, `mute`, `help` (labels icon+word, reading icon-then-word for the reader in both languages); help popover buttons with keys `demo`, `still`, `lang`; hotkeys f, m, h, d, s, l unchanged; pin hit unchanged in position.

- [ ] **Step 1: Failing tests**: toolbar has exactly 3 buttons with words and passes `hebrewRuleOk`/mergeSafe; help popover shows demo/still/lang buttons that post `demo`/`still`/`lang`; hotkeys d/s/l still post with help closed; room head has no `○`; pinned head shows `📌`; with `decor.hoverRoom` set, an unpinned head shows `📌` (dim) at the pin cell; hovering a head (pointer move over the head row) sets hoverRoom and redraws; click on the pin cell posts `pin`. Rows still exactly `columns` wide; help height change reflected in `chromeRows`/`officeHeight` (existing tests).
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement.** In narrow panes (< COMPACT_BELOW) the toolbar may drop the words to icons only if the three icon+word buttons do not fit on one line — prefer words; say what width they start at.
- [ ] **Step 4: Run** both engines + validate + tsc.
- [ ] **Step 5: Commit** `feat(mod): office toolbar in words, demo/still/language in help, pin on hover`, push, report.

### Task 4: Every control proven

**Files:**
- Create: `desktop-mod/hooks/office-controls.test.ts`
- Modify (only if a test reveals a bug): the file owning the bug.

**Interfaces:**
- Consumes: Tasks 1-3's keys and messages; `hooks/test-kit.ts`; the mounted Client test patterns in `office-client.mounted.test.ts`.

- [ ] **Step 1: Write the test file**: one test per control, driving the real path (mounted Client post → `ui.message` → `applyOfficeMessage` → state/prefs/store → next props) where the kit allows, else the fake surface + `applyOfficeMessage`: ☐ showDone (props.prefs.showDone flips, done agents appear), 🔔 mute (prefs.muted flips, label 🔕), ? help (helpOpen), demo (props.demo, rooms from the demo cast), still (prefs.still), language (lang he↔en, rtl flips), 📌 pin (prefs.pins; room order changes), room counts click (roomDone override; finished shown), `עוד N שסיימו`/`הסתר שסיימו` row (same), row click (selected + drawer), drawer ✕ (closed), search typing (search filters rooms) and clearing, keys j/k (focus moves among drawn rows), o (opens focused), x (closes), hotkeys f/m/h/d/s/l.
- [ ] **Step 2: Run** on both engines. Any failure = a real bug: fix it in the owning file with a minimal change, keep the test.
- [ ] **Step 3: Write Asaf's by-eye checklist** in the report (each control, what he should see).
- [ ] **Step 4: Commit** `test(mod): every office control exercised end to end`, push, report.
