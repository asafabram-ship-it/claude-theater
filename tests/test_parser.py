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
    "session_full", "cwd", "project", "mtime_ms", "is_session",
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
        done, end_ms, result = theater.detect_done(self.events)
        self.assertFalse(done)
        self.assertIsNone(result)

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
        done, end_ms, result = theater.detect_done(self.events)
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
        done, _, result = theater.detect_done(self.events)
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

    def tearDown(self):
        theater.PROJECTS_DIR = self._orig
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
