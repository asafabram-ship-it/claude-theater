# -*- coding: utf-8 -*-
"""Golden tests for the Claude Theater parser.

Every fixture under fixtures/ is run through the ONE adapter
(parse_agent_event) and the Event-consuming helpers. These tests fail loudly
when the Claude Code journal format drifts -- which is exactly the early
warning we want before users hit a silent breakage.

Run:  python -m unittest discover -s tests      (no dependencies)
  or: pytest tests/
"""
import os
import sys
import glob
import json
import time
import shutil
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import claude_theater as theater  # noqa: E402

FIX = os.path.join(ROOT, "fixtures")

# The frozen client<->server contract. The browser indexes agents by exactly
# these keys (persona_id, tool, status, task...) and the payload by these.
# A rename or an accidental re-add of a legacy field must fail loudly here.
AGENT_KEYS = {
    "id", "persona_id", "emoji", "role", "subagent_type", "status", "tool",
    "task", "task_short", "result", "start_ms", "end_ms", "session",
    "session_full", "cwd", "project", "mtime_ms", "is_session", "closed",
    "is_workflow", "truncated",
}
PAYLOAD_KEYS = {"agents", "versions", "tested_version", "unknown_versions", "skipped"}
LEGACY_FIELDS = ("name", "activity", "banner")  # removed in the bilingual refactor


def load_lines(rel):
    with open(os.path.join(FIX, rel), encoding="utf-8") as f:
        return [ln for ln in f.read().split("\n") if ln.strip()]


class ParserBasics(unittest.TestCase):
    def test_garbage_lines_degrade_to_none(self):
        for bad in ("", "   ", "{not json", '{"truncated', "[1,2,3]", "null", "42", "plain text"):
            self.assertIsNone(theater.parse_agent_event(bad), repr(bad))

    def test_unknown_keys_do_not_crash(self):
        ev = theater.parse_agent_event('{"type":"weird","foo":1,"bar":[2,3]}')
        self.assertIsNotNone(ev)
        self.assertEqual(ev.kind, "weird")
        self.assertEqual(ev.text, "")
        self.assertEqual(ev.tool_uses, [])

    def test_string_content_becomes_text(self):
        ev = theater.parse_agent_event('{"type":"user","message":{"content":"hello"}}')
        self.assertEqual(ev.kind, "user")
        self.assertEqual(ev.text, "hello")


class RunningFixture(unittest.TestCase):
    def setUp(self):
        self.events, self.skipped, self.versions = theater.parse_events(load_lines("cc-2.1/running.jsonl"))

    def test_no_lines_skipped(self):
        self.assertEqual(self.skipped, 0)

    def test_not_done_while_last_event_is_a_tool_use(self):
        done, end_ms, result, truncated = theater.detect_done(self.events)
        self.assertFalse(done)
        self.assertIsNone(result)
        self.assertFalse(truncated)

    def test_last_tool_use_is_read(self):
        self.assertEqual(theater.last_tool_use_name(self.events), "Read")

    def test_task_extracted_from_first_event(self):
        task = theater.extract_task(self.events[0])
        self.assertIn("TODO", task)

    def test_version_collected(self):
        self.assertEqual(self.versions, {"2.1.0"})


class DoneFixture(unittest.TestCase):
    def setUp(self):
        self.events, self.skipped, _ = theater.parse_events(load_lines("cc-2.1/done.jsonl"))

    def test_done_detected_with_result_and_timestamp(self):
        done, end_ms, result, truncated = theater.detect_done(self.events)
        self.assertTrue(done)
        self.assertIsNotNone(end_ms)
        self.assertIn("1240", result)


class MalformedFixture(unittest.TestCase):
    """Corrupt lines are counted and skipped; the agent is still understood."""

    def setUp(self):
        self.events, self.skipped, _ = theater.parse_events(load_lines("cc-2.1/malformed.jsonl"))

    def test_two_corrupt_lines_skipped(self):
        self.assertEqual(self.skipped, 2)

    def test_done_still_detected_despite_corruption(self):
        done, _, result, _ = theater.detect_done(self.events)
        self.assertTrue(done)
        self.assertIn("42 tests passed", result)


class MissingFieldsFixture(unittest.TestCase):
    """degrade-not-crash: no agentId and an empty task must not make the agent vanish."""

    def setUp(self):
        self.lines = load_lines("cc-2.1/missing_fields.jsonl")
        self.first = theater.parse_agent_event(self.lines[0])

    def test_first_event_parses(self):
        self.assertIsNotNone(self.first)

    def test_empty_task_extracted_as_blank(self):
        self.assertEqual(theater.extract_task(self.first), "")

    def test_missing_agent_id_is_absent_not_fatal(self):
        self.assertIsNone(self.first.raw.get("agentId"))


class VersionBanner(unittest.TestCase):
    def test_known_version_no_unknowns(self):
        self.assertEqual(theater.unknown_versions({"2.1.0", "2.1.158"}), [])

    def test_unknown_version_reported(self):
        _, _, versions = theater.parse_events(load_lines("cc-future/unknown_version.jsonl"))
        self.assertTrue(versions)
        self.assertEqual(theater.unknown_versions(versions), ["3.5"])

    def test_major_minor_grouping(self):
        self.assertEqual(theater.major_minor("2.1.158"), "2.1")
        self.assertEqual(theater.major_minor("3.5.0"), "3.5")

    def test_major_minor_edge_strings(self):
        self.assertEqual(theater.major_minor("2"), "2")
        self.assertEqual(theater.major_minor("2.1.158.3"), "2.1")
        self.assertEqual(theater.major_minor(""), "")
        self.assertEqual(theater.major_minor(None), "")

    def test_unknown_versions_drops_blanks(self):
        # blank / None stamps must never reach the banner as "detected "
        self.assertEqual(theater.unknown_versions({"", None}), [])
        self.assertEqual(theater.unknown_versions({"2.1.0", "2.1.158"}), [])
        self.assertEqual(theater.unknown_versions({"3.5.0", None, ""}), ["3.5"])


class PersonaContract(unittest.TestCase):
    """The client blindly indexes PERSONAS_EN/HE[persona_id]; persona_id must
    stay an int in 0..len(PERSONA_EMOJI)-1 and be deterministic."""

    def test_emoji_table_is_sixteen(self):
        self.assertEqual(len(theater.PERSONA_EMOJI), 16)

    def test_index_in_bounds_and_deterministic(self):
        for aid in ["", "agent-x", "a" * 1000, "סוכן-עברי", "deadbeef00001", None]:
            i = theater.persona_index(aid)
            self.assertIsInstance(i, int)
            self.assertTrue(0 <= i < len(theater.PERSONA_EMOJI), repr(aid))
            self.assertEqual(i, theater.persona_index(aid))  # stable


class ScanContract(unittest.TestCase):
    """scan_agents() is now the client<->server contract surface. Run it against
    a temp projects dir with a fresh fixture and freeze the emitted key sets."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        sub = os.path.join(self.tmp, "proj", "sess-xyz", "subagents")
        os.makedirs(sub)
        shutil.copy(os.path.join(FIX, "cc-2.1", "running.jsonl"),
                    os.path.join(sub, "agent-deadbeef00001.jsonl"))
        self._orig = theater.PROJECTS_DIR
        theater.PROJECTS_DIR = self.tmp
        # Point the live-session registry at a non-existent path so the scan is
        # hermetic (live_session_ids -> None: "closed" is always False) and never
        # reflects the developer's real open chats.
        self._orig_sess = theater.SESSIONS_DIR
        theater.SESSIONS_DIR = os.path.join(self.tmp, "no-such-sessions")
        theater._GLOB_CACHE.clear()   # don't reuse another root's throttled glob

    def tearDown(self):
        theater.PROJECTS_DIR = self._orig
        theater.SESSIONS_DIR = self._orig_sess
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_payload_key_set(self):
        self.assertEqual(set(theater.scan_agents().keys()), PAYLOAD_KEYS)

    def test_agent_key_set_is_frozen(self):
        agents = theater.scan_agents()["agents"]
        self.assertTrue(agents, "fixture should produce one agent")
        self.assertEqual(set(agents[0].keys()), AGENT_KEYS)

    def test_no_legacy_fields(self):
        agent = theater.scan_agents()["agents"][0]
        for dead in LEGACY_FIELDS:
            self.assertNotIn(dead, agent, "legacy field %r must not return" % dead)

    def test_persona_id_is_indexable(self):
        agent = theater.scan_agents()["agents"][0]
        self.assertIsInstance(agent["persona_id"], int)
        self.assertTrue(0 <= agent["persona_id"] < len(theater.PERSONA_EMOJI))


class AllFixturesRobust(unittest.TestCase):
    """Sweep every fixture: parsing must never raise, and the first usable
    record must carry a Claude Code version. New samples from a drifted format
    that this parser cannot read will trip these assertions."""

    def fixture_files(self):
        return glob.glob(os.path.join(FIX, "**", "*.jsonl"), recursive=True)

    def test_at_least_a_few_fixtures_present(self):
        self.assertGreaterEqual(len(self.fixture_files()), 5)

    def test_no_fixture_crashes_the_parser(self):
        for path in self.fixture_files():
            with open(path, encoding="utf-8") as f:
                lines = [ln for ln in f.read().split("\n") if ln.strip()]
            events, skipped, versions = theater.parse_events(lines)
            self.assertTrue(events, "no usable events in %s" % os.path.basename(path))
            self.assertTrue(versions, "no version stamp in %s" % os.path.basename(path))


def _assistant(text="", tools=(), stop_reason="end_turn", ts_ms=1000):
    return theater.Event(kind="assistant", text=text, tool_uses=list(tools),
                         stop_reason=stop_reason, ts_ms=ts_ms, version="2.1.0", raw={})


class StatusDetection(unittest.TestCase):
    """detect_done uses a deny-list of continuation stop_reasons, so a tool-free
    final turn with ANY other (even unknown) reason is 'done' -- the fix for
    agents stuck 'running' on an unfamiliar terminal reason."""

    def test_unknown_terminal_reason_counts_as_done(self):
        done, _, result, _ = theater.detect_done([_assistant("all set", stop_reason="some_future_reason")])
        self.assertTrue(done)
        self.assertEqual(result, "all set")

    def test_refusal_counts_as_done(self):
        done, _, _, _ = theater.detect_done([_assistant("cannot help", stop_reason="refusal")])
        self.assertTrue(done)

    def test_pause_turn_is_not_done(self):
        done, _, _, _ = theater.detect_done([_assistant("thinking", stop_reason="pause_turn")])
        self.assertFalse(done)

    def test_tool_use_turn_is_not_done(self):
        done, _, _, _ = theater.detect_done([_assistant("", tools=["Read"], stop_reason="tool_use")])
        self.assertFalse(done)

    def test_none_stop_reason_is_not_done(self):
        done, _, _, _ = theater.detect_done([_assistant("partial", stop_reason=None)])
        self.assertFalse(done)

    def test_long_result_is_flagged_truncated(self):
        done, _, result, truncated = theater.detect_done([_assistant("x" * 5000)])
        self.assertTrue(done)
        self.assertTrue(truncated)
        self.assertTrue(result.endswith("…"))
        self.assertLessEqual(len(result), theater.RESULT_CHAR_LIMIT + 1)


class WorkflowAgents(unittest.TestCase):
    """Workflow subagents end on a StructuredOutput tool_use, so their status and
    result come from the sibling journal.jsonl (keyed by agentId), not detect_done."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.wf = os.path.join(self.tmp, "subagents", "workflows", "wf_abc123")
        os.makedirs(self.wf)
        self.agent_id = "a239d8fced401e581"
        self.agent_path = os.path.join(self.wf, "agent-%s.jsonl" % self.agent_id)
        with open(os.path.join(self.wf, "journal.jsonl"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "started", "key": "v2:abc", "agentId": self.agent_id}) + "\n")
            f.write(json.dumps({"type": "result", "key": "v2:abc", "agentId": "other000000",
                                "result": {"notes": "not mine"}}) + "\n")
            f.write(json.dumps({"type": "result", "key": "v2:abc", "agentId": self.agent_id,
                                "result": {"doc_id": "02", "notes": "תקציר התוצאה",
                                           "word_count": 1148}}) + "\n")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_detects_workflow_path(self):
        self.assertTrue(theater.is_workflow_agent(self.agent_path))
        self.assertFalse(theater.is_workflow_agent(os.path.join(self.tmp, "subagents", "agent-x.jsonl")))

    def test_journal_result_keyed_by_agent_id(self):
        done, end_ms, result, truncated = theater.workflow_journal_result(self.agent_path, self.agent_id)
        self.assertTrue(done)
        self.assertEqual(result, "תקציר התוצאה")   # the matching agent's notes, not "not mine"
        self.assertFalse(truncated)

    def test_no_result_record_means_not_done(self):
        done, _, result, _ = theater.workflow_journal_result(self.agent_path, "no-such-agent")
        self.assertFalse(done)
        self.assertIsNone(result)

    def test_structured_result_without_prose_falls_back_to_json(self):
        wf2 = os.path.join(self.tmp, "subagents", "workflows", "wf_def456")
        os.makedirs(wf2)
        with open(os.path.join(wf2, "journal.jsonl"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "result", "agentId": "z", "result": {"ok": True, "n": 3}}) + "\n")
        done, _, result, _ = theater.workflow_journal_result(os.path.join(wf2, "agent-z.jsonl"), "z")
        self.assertTrue(done)
        self.assertIn("\"ok\"", result)


class GlobThrottle(unittest.TestCase):
    """The recursive journal-tree glob is the dominant scan cost, so it's cached
    per pattern and only re-run after GLOB_TTL_SEC."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        theater._GLOB_CACHE.clear()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        theater._GLOB_CACHE.clear()

    def test_result_is_cached_within_ttl_then_refreshes(self):
        pat = os.path.join(self.tmp, "*.txt")
        open(os.path.join(self.tmp, "a.txt"), "w").close()
        now = 1000.0
        self.assertEqual(len(theater._throttled_glob(pat, now)), 1)
        open(os.path.join(self.tmp, "b.txt"), "w").close()
        # within the TTL the new file is NOT seen (stale cache returned)
        self.assertEqual(len(theater._throttled_glob(pat, now + 1)), 1)
        # after the TTL it re-globs and picks the new file up
        self.assertEqual(len(theater._throttled_glob(pat, now + theater.GLOB_TTL_SEC + 1)), 2)

    def test_distinct_patterns_do_not_share_cache(self):
        other = tempfile.mkdtemp()
        try:
            open(os.path.join(self.tmp, "a.txt"), "w").close()
            now = 2000.0
            theater._throttled_glob(os.path.join(self.tmp, "*.txt"), now)
            # a different root must glob fresh, not reuse the first root's paths
            self.assertEqual(theater._throttled_glob(os.path.join(other, "*.txt"), now), [])
        finally:
            shutil.rmtree(other, ignore_errors=True)


class ClosedSessionRooms(unittest.TestCase):
    """A conversation whose chat is closed (no longer in the live-session registry)
    must collapse to 'done' so its room hides by default, instead of lingering as a
    'stale' room for MAX_AGE_MIN. When the registry is unavailable (None), behavior
    is unchanged."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.proj = os.path.join(self.tmp, "proj")
        os.makedirs(self.proj)
        self.uuid = "11111111-2222-3333-4444-555555555555"
        path = os.path.join(self.proj, self.uuid + ".jsonl")
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "user", "cwd": "C:/work",
                                "message": {"role": "user", "content": "hello there"}}) + "\n")
        self._orig = theater.PROJECTS_DIR
        theater.PROJECTS_DIR = self.tmp
        theater._GLOB_CACHE.clear()   # don't reuse another root's throttled glob

    def tearDown(self):
        theater.PROJECTS_DIR = self._orig
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _lead(self, live):
        rooms = theater.scan_sessions(time.time(), live)
        self.assertEqual(len(rooms), 1)
        return rooms[0]

    def test_live_session_is_visible(self):
        lead = self._lead(frozenset([self.uuid]))
        self.assertFalse(lead["closed"])
        self.assertIn(lead["status"], ("running", "stale"))

    def test_closed_session_collapses_to_done(self):
        lead = self._lead(frozenset())          # registry present, uuid absent => closed
        self.assertTrue(lead["closed"])
        self.assertEqual(lead["status"], "done")
        self.assertIsNotNone(lead["end_ms"])

    def test_registry_unavailable_leaves_behavior_unchanged(self):
        lead = self._lead(None)                 # older build: never hide
        self.assertFalse(lead["closed"])
        self.assertIn(lead["status"], ("running", "stale"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
