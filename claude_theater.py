# -*- coding: utf-8 -*-
"""
Claude Theater - a live, grouped office of your Claude Code subagents.

Reads the per-agent journal files Claude Code writes under
  ~/.claude/projects/<encoded-cwd>/<session-id>/subagents/**/agent-*.jsonl
and serves a small web page. Agents are grouped into a "room" per conversation
(session). Each agent is a compact character: avatar + tiny name + live status +
timer. Click a character to see its full task and full result. Finished agents
are hidden by default (a count stays in the room header).

Run:  python -m claude_theater     (start.cmd does this and opens the browser)
  or: claude-theater                (after pip/pipx install)
Then: http://localhost:7333

Pure stdlib. No pip installs needed to run.
"""
import json
import os
import sys
import glob
import time
import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

__version__ = "0.1.1"

def _default_port():
    """Port from $CLAUDE_THEATER_PORT, else 7333. The --port flag overrides this."""
    try:
        p = int(os.environ.get("CLAUDE_THEATER_PORT") or 7333)
        return p if 0 < p < 65536 else 7333
    except ValueError:
        return 7333


PORT = _default_port()
DEMO = False               # --demo: serve a synthetic office, never read real journals
MAX_AGE_MIN = 180          # only show agents whose file changed in the last N minutes
RUNNING_STALE_SEC = 90     # a "running" agent untouched this long is shown as idle

PROJECTS_DIR = os.path.join(os.path.expanduser("~"), ".claude", "projects")
# Claude Code writes ~/.claude/sessions/<pid>.json when an interactive session
# starts and removes it on exit, so this directory is a live registry of OPEN
# conversations. We use it to make a room vanish the moment its chat is closed,
# instead of lingering for MAX_AGE_MIN. Absent dir => older build that doesn't
# track this => feature disabled (live_session_ids returns None, nothing hidden).
SESSIONS_DIR = os.path.join(os.path.expanduser("~"), ".claude", "sessions")

# Claude Code versions this parser was tested against (major.minor only).
# Any other version seen at runtime raises a non-blocking banner (text built in
# the browser, per the active language).
KNOWN_CC_VERSIONS = ("2.1",)

# Persona emojis, index-aligned with the client-side name tables (PERSONAS_EN /
# PERSONAS_HE in PAGE). The server emits a persona_id; the browser localizes the
# name. Activity labels and the "task unavailable" placeholder are also localized
# client-side -- Python emits only language-neutral data and stable keys.
PERSONA_EMOJI = ["🕵️", "✍️", "🏃", "🔬", "📚", "🧭", "🔭", "🔨",
                 "🪄", "🎯", "🦉", "🦊", "🐝", "🤖", "🐯", "🦅"]


def persona_index(agent_id):
    h = 0
    for ch in (agent_id or ""):
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h % len(PERSONA_EMOJI)


def iso_to_ms(s):
    if not s:
        return None
    try:
        return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None


def read_first_line(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.readline()


def read_tail_lines(path, max_bytes=200_000):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        if size > max_bytes:
            f.seek(size - max_bytes)
            data = f.read()
            nl = data.find(b"\n")
            if nl != -1:
                data = data[nl + 1:]
        else:
            data = f.read()
    return [ln for ln in data.decode("utf-8", errors="replace").split("\n") if ln.strip()]


class Event:
    """A normalized view of ONE raw JSONL line. The rest of the program only
    ever touches Event objects, never raw dicts -- so a Claude Code format
    change is absorbed in parse_agent_event() alone."""
    __slots__ = ("kind", "text", "tool_uses", "stop_reason", "ts_ms", "version", "raw")

    def __init__(self, kind, text, tool_uses, stop_reason, ts_ms, version, raw):
        self.kind = kind              # "user" | "assistant" | other type string | "unknown"
        self.text = text              # concatenated text blocks, "" if none
        self.tool_uses = tool_uses    # list of tool names invoked in this event
        self.stop_reason = stop_reason
        self.ts_ms = ts_ms
        self.version = version        # Claude Code version stamped on the line
        self.raw = raw                # original dict, for first-line meta only


def parse_agent_event(line):
    """The ONLY function that touches raw JSONL. Returns an Event, or None for a
    line we cannot use (blank / not JSON / not an object). Never raises:
    unknown keys are ignored, malformed lines degrade to None (the caller counts
    and skips them) rather than crashing the scan."""
    if not line or not line.strip():
        return None
    try:
        rec = json.loads(line)
    except Exception:
        return None
    if not isinstance(rec, dict):
        return None

    rtype = rec.get("type")
    msg = rec.get("message")
    msg = msg if isinstance(msg, dict) else {}
    content = msg.get("content")

    text_parts, tool_uses = [], []
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            bt = block.get("type")
            if bt == "text":
                t = block.get("text", "")
                if t:
                    text_parts.append(t)
            elif bt == "tool_use":
                tool_uses.append(block.get("name") or "")
    elif isinstance(content, str):
        if content:
            text_parts.append(content)

    return Event(
        kind=rtype if isinstance(rtype, str) and rtype else "unknown",
        text=" ".join(text_parts).strip(),
        tool_uses=[t for t in tool_uses if t],
        stop_reason=msg.get("stop_reason"),
        ts_ms=iso_to_ms(rec.get("timestamp")),
        version=rec.get("version"),
        raw=rec,
    )


def parse_events(lines):
    """Map raw lines -> Events, returning (events, skipped_count, versions_set)."""
    events, skipped, versions = [], 0, set()
    for ln in lines:
        ev = parse_agent_event(ln)
        if ev is None:
            if ln and ln.strip():
                skipped += 1
            continue
        events.append(ev)
        if ev.version:
            versions.add(ev.version)
    return events, skipped, versions


def last_tool_use_name(events):
    for ev in reversed(events):
        if ev.kind == "assistant" and ev.tool_uses:
            return ev.tool_uses[-1]
    return None


# stop_reasons that mean "the model intends to keep going" -> NOT finished.
# Anything else (end_turn, stop, stop_sequence, max_tokens, refusal, or a reason
# a future Claude Code build invents) on a tool-free assistant turn counts as
# done. Using a deny-list this way -- rather than an allow-list of terminal
# reasons -- is what stops an unfamiliar terminal reason from pinning an agent at
# "running" forever.
CONTINUATION_STOP_REASONS = ("tool_use", "pause_turn")
RESULT_CHAR_LIMIT = 4000


def detect_done(events):
    """Returns (is_done, end_ms, result_text, truncated)."""
    last = None
    for ev in reversed(events):
        if ev.kind in ("assistant", "user"):
            last = ev
            break
    if last is None or last.kind != "assistant":
        return False, None, None, False
    has_tool = bool(last.tool_uses)
    done = (not has_tool) and (last.stop_reason is not None) \
        and (last.stop_reason not in CONTINUATION_STOP_REASONS)
    if done:
        full = " ".join(last.text.split())
        truncated = len(full) > RESULT_CHAR_LIMIT
        if truncated:
            full = full[:RESULT_CHAR_LIMIT] + "…"
        return True, last.ts_ms, full, truncated
    return False, None, None, False


def is_workflow_agent(path):
    """A workflow subagent lives under subagents/workflows/wf_*/ (vs a regular
    Task/Agent subagent, a shallow subagents/agent-*.jsonl). Path test only --
    no extra stat -- and tolerant of either slash on Windows."""
    return "/workflows/wf_" in path.replace("\\", "/")


def _workflow_result_text(result_obj):
    """A workflow agent's journal result is usually a structured object (the
    StructuredOutput the workflow schema enforced). Pull a human-readable string:
    a known prose field if present, else compact JSON of the whole object."""
    if isinstance(result_obj, str):
        return result_obj
    if isinstance(result_obj, dict):
        for k in ("notes", "summary", "text", "message", "result", "classification_reason"):
            v = result_obj.get(k)
            if isinstance(v, str) and v.strip():
                return v
        try:
            return json.dumps(result_obj, ensure_ascii=False)
        except Exception:
            return str(result_obj)
    return "" if result_obj is None else str(result_obj)


def workflow_journal_result(agent_path, agent_id):
    """Authoritative done-signal + result for a workflow subagent: its sibling
    journal.jsonl, which records {"type":"result","agentId":..,"result":..} per
    finished agent. We must read it instead of detect_done() because a
    schema-bound workflow agent ends on a StructuredOutput tool_use -- which
    detect_done() reads as 'still running' forever. Keyed by agentId so parallel
    agents with identical prompts never collide. Returns the detect_done shape
    (is_done, end_ms, result_text, truncated); is_done=False when no result yet."""
    journal = os.path.join(os.path.dirname(agent_path), "journal.jsonl")
    if not os.path.isfile(journal):
        return False, None, None, False
    found = None
    try:
        for ln in read_tail_lines(journal):
            # cheap pre-filter before the JSON parse: both tokens must be present
            if '"result"' not in ln or agent_id not in ln:
                continue
            try:
                rec = json.loads(ln)
            except Exception:
                continue
            if rec.get("type") == "result" and rec.get("agentId") == agent_id:
                found = rec   # last result record wins (re-runs supersede)
    except Exception:
        return False, None, None, False
    if found is None:
        return False, None, None, False
    text = " ".join(_workflow_result_text(found.get("result")).split())
    truncated = len(text) > RESULT_CHAR_LIMIT
    if truncated:
        text = text[:RESULT_CHAR_LIMIT] + "…"
    return True, None, text or None, truncated


def major_minor(version):
    parts = (version or "").split(".")
    return ".".join(parts[:2]) if len(parts) >= 2 else (version or "")


def unknown_versions(versions):
    """The major.minor versions seen at runtime that we have NOT tested against.
    The browser turns this list into a localized, non-blocking banner. Blank /
    unparseable stamps are dropped so the banner never shows 'detected ' empty."""
    out = set()
    for v in versions:
        mm = major_minor(v)
        if mm and mm not in KNOWN_CC_VERSIONS:
            out.add(mm)
    return sorted(out)


_NAME_CACHE = {}  # parent_file -> (mtime, {prompt: {description, subagent_type}})
_PROJECT_CACHE = {}  # parent_file -> (mtime, project_cwd)  -- the conversation's real working dir
_SESSION_CACHE = {}  # session_file -> (mtime, (topic, cwd))  -- a top-level conversation's subject + dir


def parent_session_file(agent_path, session_id):
    if not session_id:
        return None
    p = os.path.dirname(agent_path)
    while p and os.path.basename(p) != session_id:
        nxt = os.path.dirname(p)
        if nxt == p:
            return None
        p = nxt
    return p + ".jsonl"


def _norm_prompt(s):
    """Normalize a spawn prompt so a subagent joins to its parent Task call even
    when whitespace differs (a trailing newline, indentation, collapsed runs).
    Used for BOTH sides of the join -- map keys here and lookups in scan_agents --
    so they always normalize identically."""
    return " ".join((s or "").split())


def name_map_for(parent_file):
    if not parent_file or not os.path.isfile(parent_file):
        return {}
    try:
        mtime = os.path.getmtime(parent_file)
    except OSError:
        return {}
    cached = _NAME_CACHE.get(parent_file)
    if cached and cached[0] == mtime:
        return cached[1]
    m = {}
    try:
        with open(parent_file, "r", encoding="utf-8", errors="replace") as f:
            for ln in f:
                if '"type":"tool_use"' not in ln or '"description"' not in ln:
                    continue
                try:
                    rec = json.loads(ln)
                except Exception:
                    continue
                if rec.get("type") != "assistant":
                    continue
                content = rec.get("message", {}).get("content", [])
                if not isinstance(content, list):
                    continue
                for block in content:
                    if (isinstance(block, dict) and block.get("type") == "tool_use"
                            and block.get("name") in ("Task", "Agent")):
                        inp = block.get("input") or {}
                        key = _norm_prompt(inp.get("prompt"))
                        # First spawn wins: re-running the same prompt later must
                        # not overwrite the earlier agent's role with a new one.
                        if key and key not in m:
                            m[key] = {
                                "description": inp.get("description", "") or "",
                                "subagent_type": inp.get("subagent_type", "") or "",
                            }
    except Exception:
        pass
    _NAME_CACHE[parent_file] = (mtime, m)
    return m


def project_cwd_for(parent_file):
    """The parent conversation's real working directory, read from its first event.
    Used as the room label so rooms map to projects the user recognizes (e.g.
    "Downloads", "agent-theater") instead of a deeply-nested subagent cwd."""
    if not parent_file or not os.path.isfile(parent_file):
        return ""
    try:
        mtime = os.path.getmtime(parent_file)
    except OSError:
        return ""
    cached = _PROJECT_CACHE.get(parent_file)
    if cached and cached[0] == mtime:
        return cached[1]
    # The first lines of a session file can be metadata (queue-operation) with no
    # cwd; the working dir appears on the first user/assistant record. Scan a few
    # lines for the first non-empty "cwd".
    cwd = ""
    try:
        with open(parent_file, "r", encoding="utf-8", errors="replace") as f:
            for i, ln in enumerate(f):
                if i > 50:
                    break
                if '"cwd"' not in ln:
                    continue
                try:
                    rec = json.loads(ln)
                except Exception:
                    continue
                c = rec.get("cwd")
                if c:
                    cwd = c
                    break
    except Exception:
        cwd = ""
    _PROJECT_CACHE[parent_file] = (mtime, cwd)
    return cwd


def _first_user_text(rec):
    """The text of a user message record (string content, or the first text block)."""
    msg = rec.get("message", {})
    c = msg.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        for b in c:
            if isinstance(b, dict) and b.get("type") == "text":
                return b.get("text", "") or ""
            if isinstance(b, str):
                return b
    return ""


def session_summary(session_file):
    """A top-level conversation's subject (its first user message) and working dir,
    cached by mtime. The first lines can be metadata; scan a bounded prefix."""
    try:
        mtime = os.path.getmtime(session_file)
    except OSError:
        return ("", "")
    cached = _SESSION_CACHE.get(session_file)
    if cached and cached[0] == mtime:
        return cached[1]
    topic, cwd = "", ""
    try:
        with open(session_file, "r", encoding="utf-8", errors="replace") as f:
            for i, ln in enumerate(f):
                if i > 80:
                    break
                if '"cwd"' not in ln and '"type":"user"' not in ln:
                    continue
                try:
                    rec = json.loads(ln)
                except Exception:
                    continue
                if not cwd:
                    cwd = rec.get("cwd", "") or ""
                if not topic and rec.get("type") == "user":
                    topic = " ".join(_first_user_text(rec).split())
                if topic and cwd:
                    break
    except Exception:
        pass
    res = (topic, cwd)
    _SESSION_CACHE[session_file] = (mtime, res)
    return res


def _pid_alive(pid):
    """Best-effort liveness check for a session-owner process. On any uncertainty
    we assume alive, so a probe failure can never wrongly hide an open chat."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return True
    if pid <= 0:
        return True
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes
            k = ctypes.windll.kernel32
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            STILL_ACTIVE = 259
            h = k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not h:
                return False          # no such process -> closed
            try:
                code = wintypes.DWORD()
                if k.GetExitCodeProcess(h, ctypes.byref(code)):
                    return code.value == STILL_ACTIVE
                return True
            finally:
                k.CloseHandle(h)
        os.kill(pid, 0)
        return True
    except OSError:
        return False
    except Exception:
        return True


# (dir signature) -> tuple of (sessionId, pid). JSON parsing is cached on the
# directory's (name, mtime) signature so it only reruns when a session starts or
# ends; PID liveness is re-checked every scan (cheap) so a crash is noticed fast.
_SESSIONS_CACHE = {"sig": None, "recs": ()}


def live_session_ids(now):
    """sessionIds of Claude Code conversations currently OPEN (process registered
    in ~/.claude/sessions and still alive). Returns None when the registry dir is
    absent -- an older build we can't reason about, so callers leave behavior
    untouched. A returned (possibly empty) set means: trust it, anything not in it
    is a closed chat."""
    if not os.path.isdir(SESSIONS_DIR):
        return None
    try:
        files = sorted(glob.glob(os.path.join(SESSIONS_DIR, "*.json")))
    except Exception:
        return None
    sig = []
    for fp in files:
        try:
            sig.append((fp, os.path.getmtime(fp)))
        except OSError:
            continue
    sig = tuple(sig)
    if sig == _SESSIONS_CACHE["sig"]:
        recs = _SESSIONS_CACHE["recs"]
    else:
        recs = []
        for fp, _ in sig:
            try:
                with open(fp, "r", encoding="utf-8", errors="replace") as f:
                    rec = json.load(f)
            except Exception:
                continue
            sid = rec.get("sessionId")
            if sid:
                recs.append((sid, rec.get("pid")))
        recs = tuple(recs)
        _SESSIONS_CACHE["sig"] = sig
        _SESSIONS_CACHE["recs"] = recs
    return frozenset(sid for sid, pid in recs if _pid_alive(pid))


# Re-enumerating the whole ~/.claude/projects tree (a recursive glob over the
# user's entire Claude Code history) is by far the costliest part of a scan and
# grows with history -- benchmarked at ~90% of a steady-state scan. The set of
# files changes slowly, so cache the path list and rebuild it at most every
# GLOB_TTL_SEC. A new agent/session appears within that window; existing agents'
# status stays live because every cached path is re-stat'd on every scan.
GLOB_TTL_SEC = 6
_GLOB_CACHE = {}   # pattern -> (timestamp, paths)


def _throttled_glob(pattern, now, recursive=False):
    # Keyed by the full pattern (which embeds PROJECTS_DIR) so changing the scan
    # root -- e.g. tests pointing at a temp dir -- can't read another root's paths.
    cached = _GLOB_CACHE.get(pattern)
    if cached and (now - cached[0]) < GLOB_TTL_SEC:
        return cached[1]
    try:
        paths = glob.glob(pattern, recursive=recursive)
    except Exception:
        paths = cached[1] if cached else []
    _GLOB_CACHE[pattern] = (now, paths)
    return paths


def scan_sessions(now, live):
    """Top-level conversations as room-leading entries, so every recent conversation
    shows up (not only those that spawned subagents). Shape matches a subagent entry
    plus is_session=True; start_ms is the last-activity time so the timer reads as
    'active/idle' rather than the (possibly hours-long) full session age.

    `live` is the set of open-conversation ids from live_session_ids() (or None
    when unsupported). A conversation that's no longer live is a CLOSED chat: we
    emit it as 'done' so the room collapses and hides by default (reachable via the
    room's 'show finished' toggle) instead of lingering as 'stale' for MAX_AGE_MIN."""
    entries = []
    paths = _throttled_glob(os.path.join(PROJECTS_DIR, "*", "*.jsonl"), now)
    for path in paths:
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        if (now - mtime) / 60.0 > MAX_AGE_MIN:
            continue
        topic, cwd = session_summary(path)
        uuid = os.path.basename(path)[:-6]
        closed = (live is not None) and (uuid not in live)
        if closed:
            status = "done"
        else:
            status = "running" if (now - mtime) <= RUNNING_STALE_SEC else "stale"
        pid = persona_index(uuid)
        mtime_ms = int(mtime * 1000)
        entries.append({
            "id": uuid, "persona_id": pid, "emoji": PERSONA_EMOJI[pid],
            "role": "", "subagent_type": "",
            "status": status, "tool": "",
            "task": topic, "task_short": short_task(topic), "result": None,
            "start_ms": mtime_ms, "end_ms": mtime_ms if closed else None,
            "session": uuid[:8], "session_full": uuid,
            "cwd": cwd, "project": cwd, "mtime_ms": mtime_ms,
            "is_session": True, "closed": closed,
            "is_workflow": False, "truncated": False,
        })
    return entries


def extract_task(first_ev):
    return first_ev.text if first_ev else ""


def short_task(task):
    task = " ".join(task.split())
    for sep in (". ", "? ", "! ", ": "):
        idx = task.find(sep)
        if 0 < idx < 90:
            return task[:idx + 1].strip()
    return task[:90].strip() + "…" if len(task) > 90 else task


# path -> (mtime, size, agent_dict, is_done, file_versions, file_skipped). The
# expensive part of a scan is read_tail_lines (up to 200 KB) + parse on every
# recent file, every 1.5 s. We cache the parsed result keyed by (mtime, size)
# and only recompute the wall-clock-dependent `status` on a cache hit. Same
# discipline as _NAME_CACHE; the parser stays isolated -- the cache wraps it.
_AGENT_CACHE = {}


def scan_agents():
    now = time.time()
    live = live_session_ids(now)   # open conversations; None = registry unsupported
    pattern = os.path.join(PROJECTS_DIR, "**", "agent-*.jsonl")
    agents = []
    versions = set()
    skipped = 0
    paths = _throttled_glob(pattern, now, recursive=True)
    seen = set()
    for path in paths:
        try:
            stt = os.stat(path)
        except OSError:
            continue
        mtime, size = stt.st_mtime, stt.st_size
        if (now - mtime) / 60.0 > MAX_AGE_MIN:
            continue
        seen.add(path)

        cached = _AGENT_CACHE.get(path)
        if cached and cached[0] == mtime and cached[1] == size:
            _, _, adict, is_done, fvers, fskip = cached
        else:
            try:
                first_line = read_first_line(path)
            except Exception:
                first_line = ""
            if not (first_line and first_line.strip()):
                continue  # file exists but first line not flushed yet -- not malformed
            first_ev = parse_agent_event(first_line)
            if first_ev is None:
                skipped += 1
                continue
            fvers = set()
            if first_ev.version:
                fvers.add(first_ev.version)

            agent_id = first_ev.raw.get("agentId") or os.path.basename(path)[6:-6]
            session = first_ev.raw.get("sessionId", "") or ""
            start_ms = first_ev.ts_ms
            task = extract_task(first_ev)

            try:
                events, n_skip, vers = parse_events(read_tail_lines(path))
            except Exception:
                events, n_skip, vers = [], 0, set()
            fskip = n_skip
            fvers |= vers

            workflow = is_workflow_agent(path)
            tool = last_tool_use_name(events)
            pid = persona_index(agent_id)
            parent = parent_session_file(path, session)
            project = project_cwd_for(parent)
            if workflow:
                # Authoritative status/result is the sibling journal.jsonl; only
                # fall back to the transcript when no result is recorded yet.
                is_done, end_ms, result, truncated = workflow_journal_result(path, agent_id)
                if not is_done:
                    is_done, end_ms, result, truncated = detect_done(events)
                if is_done and end_ms is None:
                    end_ms = int(mtime * 1000)   # journal carries no timestamp
                role, subagent_type = "", "workflow-subagent"
            else:
                is_done, end_ms, result, truncated = detect_done(events)
                # Real name from the parent's Task/Agent spawn call (normalized join).
                info = name_map_for(parent).get(_norm_prompt(task)) if task.strip() else None
                role = info["description"] if info else ""
                subagent_type = info["subagent_type"] if info else ""
            # Language-neutral payload only: the browser localizes persona name,
            # activity label and the placeholder for an agent with no readable task
            # (degrade-not-crash -- it still shows up, just with a generic label).
            # `status` is a placeholder here; it is recomputed below every scan.
            adict = {
                "id": agent_id, "persona_id": pid, "emoji": PERSONA_EMOJI[pid],
                "role": role,
                "subagent_type": subagent_type,
                "status": "running", "tool": tool or "",
                "task": task, "task_short": short_task(task), "result": result,
                "start_ms": start_ms, "end_ms": end_ms,
                "session": session[:8], "session_full": session,
                "cwd": first_ev.raw.get("cwd", ""), "project": project,
                "mtime_ms": int(mtime * 1000), "is_session": False,
                "is_workflow": workflow, "truncated": truncated,
            }
            _AGENT_CACHE[path] = (mtime, size, adict, is_done, fvers, fskip)

        versions |= fvers
        skipped += fskip
        # status tracks wall-clock `now`, so recompute it on every scan (even a cache hit)
        if is_done:
            status = "done"
        elif (now - mtime) > RUNNING_STALE_SEC:
            status = "stale"
        else:
            status = "running"
        a = dict(adict)
        # A subagent whose parent chat has closed shouldn't keep a ghost room
        # alive. Once it's gone idle (stale) and its session is no longer live,
        # collapse it like a finished agent (hidden by default). We only touch
        # stale ones: a still-writing 'running' agent is left visible in case it
        # genuinely outlived its chat, and it collapses on the next idle scan.
        sess_full = a["session_full"]
        a["closed"] = (live is not None) and bool(sess_full) and (sess_full not in live)
        if a["closed"] and status == "stale":
            status = "done"
        a["status"] = status
        # role/subagent_type come from the PARENT session file, not the agent
        # file, so the agent-keyed (mtime,size) cache can't notice the parent
        # gaining its Task block later. Re-resolve every scan (name_map_for is
        # itself mtime-cached on the parent, so this is cheap) and overwrite the
        # copy; the cached adict and the isolated parser stay untouched.
        # Workflow agents have no parent Task call to name them; leave their
        # "workflow-subagent" type untouched and skip the re-resolve.
        _task = _norm_prompt(a["task"])
        if _task and not a.get("is_workflow"):
            _info = name_map_for(parent_session_file(path, a["session_full"])).get(_task)
            if _info:
                a["role"] = _info["description"]
                a["subagent_type"] = _info["subagent_type"]
        agents.append(a)

    # evict entries for files that aged out / vanished so the cache can't grow unbounded
    for gone in [p for p in _AGENT_CACHE if p not in seen]:
        del _AGENT_CACHE[gone]

    # Top-level conversations as room leads, so every recent conversation shows up
    # (not only those that spawned subagents). They share a room with their subagents
    # (same session id). is_session sorts first within a status so the lead shows first.
    agents.extend(scan_sessions(now, live))

    order = {"running": 0, "stale": 1, "done": 2}
    agents.sort(key=lambda a: (order.get(a["status"], 3), -(1 if a.get("is_session") else 0), -(a["start_ms"] or 0)))
    return {
        "agents": agents,
        # "versions" (full set seen) and "skipped" (malformed-line count) are now
        # surfaced by the UI (diagnostics footer + drift banner).
        "versions": sorted(versions),
        "tested_version": KNOWN_CC_VERSIONS[-1],
        "unknown_versions": unknown_versions(versions),
        "skipped": skipped,
    }


# ---------------------------------------------------------------------------
# Demo mode (--demo): a synthetic, populated office for screenshots / the Hero
# GIF and for a "try it instantly" first run. Builds the payload in memory and
# NEVER reads or writes the real ~/.claude/projects journals.
# ---------------------------------------------------------------------------
def _demo_agent(aid, session, cwd, status, tool, task, role="", subagent_type="", start_offset=60,
                result=None, is_session=False, mtime_offset=0):
    now = time.time()
    pid = persona_index(aid)
    return {
        "id": aid, "persona_id": pid, "emoji": PERSONA_EMOJI[pid],
        "role": role, "subagent_type": subagent_type,
        "status": status, "tool": tool or "",
        "task": task, "task_short": short_task(task),
        "result": result if status == "done" else None,
        "start_ms": int((now - start_offset) * 1000),
        "end_ms": int((now - 2) * 1000) if status == "done" else None,
        "session": session[:8], "session_full": session,
        "cwd": cwd, "project": cwd, "mtime_ms": int((now - mtime_offset) * 1000),
        "is_session": is_session,
    }


def demo_payload(phase=None):
    now = time.time()
    cwd = "/home/dev/acme-web"
    s1 = "demo-session-frontend-1111"
    s2 = "demo-session-research-2222"
    # A ~12 s scripted loop so a single short GIF captures every beat in one pass:
    #   phase 3  -> a new agent walks in   (entering animation)
    #   phase 6  -> the finisher completes (confetti + chime)
    # int(now) % 12 drives both; the rest of the office stays steady.
    phase = (phase % 12) if isinstance(phase, int) else int(now) % 12
    finishing = 6 <= phase < 10
    walked_in = phase >= 3
    agents = [
        _demo_agent("demo-research-aa", s2, cwd, "running", "WebSearch",
                    "Research incremental static regeneration approaches and summarize the trade-offs.",
                    role="research the ISR landscape", subagent_type="general-purpose", start_offset=95),
        _demo_agent("demo-reader-bb", s1, cwd, "running", "Read",
                    "Read the auth middleware and map every place the session token is validated.",
                    role="map session-token validation", subagent_type="Explore", start_offset=42),
        _demo_agent("demo-grep-cc", s1, cwd, "running", "Grep",
                    "Find all TODO and FIXME comments across the repo and group them by file.",
                    start_offset=18),
        _demo_agent("demo-mcp-dd", s2, cwd, "running", "mcp__github__search_issues",
                    "Pull the open issues labeled 'bug' and cluster them by component.",
                    role="triage open bugs", subagent_type="general-purpose", start_offset=63),
        _demo_agent("demo-build-ee", s1, cwd, "stale", "Bash",
                    "Run the full test suite and report any failures.", start_offset=320),
        _demo_agent("demo-writer-ff", s2, cwd, "done", "Write",
                    "Draft the migration guide for the v2 config format.",
                    role="draft the v2 migration guide", subagent_type="general-purpose", start_offset=150,
                    result="Done. Wrote migration-v2.md: a step-by-step guide covering the renamed keys, the "
                           "deprecation timeline, and a codemod snippet. Flagged two breaking changes for manual review."),
        _demo_agent("demo-finisher-gg", s1, cwd, "done" if finishing else "running", "StructuredOutput",
                    "Summarize the security review findings into a prioritized list.",
                    role="summarize the security review", subagent_type="code-reviewer", start_offset=51,
                    result="Summary: 3 high, 5 medium, 11 low. Top item: the password-reset token is not "
                           "compared in constant time."),
    ]
    if walked_in:  # appears mid-loop so the browser plays its walk-in animation
        agents.append(_demo_agent("demo-newcomer-hh", s2, cwd, "running", "Edit",
                      "Apply the review fixes to the config loader and re-run the type checker.",
                      role="apply the review fixes", subagent_type="general-purpose", start_offset=3))
    # the two conversations themselves -> each leads its room with the topic as the title
    agents.append(_demo_agent("demo-conv-frontend", s1, cwd, "running", "",
                  "Ship the v2 config migration and clean up the auth middleware.",
                  start_offset=380, is_session=True, mtime_offset=7))
    agents.append(_demo_agent("demo-conv-research", s2, cwd, "running", "",
                  "Plan the static-regeneration rollout and triage the bug backlog.",
                  start_offset=300, is_session=True, mtime_offset=14))
    order = {"running": 0, "stale": 1, "done": 2}
    agents.sort(key=lambda x: (order.get(x["status"], 3), -(1 if x.get("is_session") else 0), -(x["start_ms"] or 0)))
    versions = {"2.1.0"}
    return {
        "agents": agents,
        "versions": sorted(versions),
        "tested_version": KNOWN_CC_VERSIONS[-1],
        "unknown_versions": unknown_versions(versions),
        "skipped": 0,
    }


PAGE = """<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Theater</title>
<script>try{var Q=(location.search.match(/[?&]lang=(he|en)\\b/)||[])[1];
  var L=Q||localStorage.getItem("ct_lang")||"en";if(L!=="en"&&L!=="he")L="en";
  document.documentElement.lang=L; document.documentElement.dir=(L==="he")?"rtl":"ltr";}catch(e){}</script>
<style>
  :root{
    color-scheme:dark;
    /* ---- color tokens (one place to reskin / theme; see ROADMAP) ---- */
    --bg-1:#1a2440; --bg-2:#0b1020; --bg-deep:#070b16;
    --surface:#121a30; --surface-2:#0e1426; --surface-3:#0a0f1e;
    --ink:#e8ecff; --ink-2:#dde4ff; --ink-dim:#aeb8df; --ink-dimmer:#97a2cf;
    --ok:#7ee29a; --ok-bg:#16331f;
    --idle:#e6c07e; --done:#9fb0e6; --done-bg:#262b46;
    --accent:#5b6ee0;
    --line:#20294a; --line-soft:#1b2440; --line-head:#1d2746; --line-drawer:#243056;
    --chip-bg:#1a2138; --chip-line:#2a345c; --chip-ink:#bcc6ee;
    --banner-bg:#3a2d12; --banner-ink:#e6c98a; --banner-line:#5a4a20;
    /* ---- type scale (20 / 15 / 13 / 11.5 / 10.5) ---- */
    --fs-xl:20px; --fs-lg:15px; --fs-md:13px; --fs-sm:11.5px; --fs-xs:10.5px;
    /* ---- radii / focus ring ---- */
    --r-sm:8px; --r-md:10px; --r-lg:14px; --r-pill:999px;
    --ring:0 0 0 2px transparent,0 0 0 4px var(--accent);
  }
  /* Embedded in a VS Code webview, the page IS the webview document, so VS Code
     stamps <body> with vscode-light / vscode-dark / vscode-high-contrast* and
     exposes --vscode-* tokens. Browser (start.cmd) and dark editors keep the
     office's own dark palette via the fallbacks above; a LIGHT or
     high-contrast-light editor remaps the tokens so the office isn't a black box
     in a white IDE. The signature character art keeps its own colors -- only the
     surrounding chrome follows the theme. */
  body.vscode-light, body.vscode-high-contrast-light{
    color-scheme:light;
    --bg-1:#eef1fb; --bg-2:#e6eaf7; --bg-deep:#dde3f2;
    --surface:#ffffff; --surface-2:#f5f7fd; --surface-3:#eef1fb;
    --ink:#1b2240; --ink-2:#27314f; --ink-dim:#4c577a; --ink-dimmer:#5f6a8c;
    --ok:#1f8f4d; --ok-bg:#d7f1df;
    --idle:#9a6b12; --done:#3a4ea8; --done-bg:#dde3f7;
    --accent:#3a4ad6;
    --line:#d4d9ee; --line-soft:#dfe4f3; --line-head:#cfd6ee; --line-drawer:#ccd4ef;
    --chip-bg:#eef1fb; --chip-line:#cfd6ee; --chip-ink:#3a4570;
    --banner-bg:#fdf3d6; --banner-ink:#7a5a12; --banner-line:#e6cf90;
  }
  /* a few prominent chrome colors are hardcoded dark; light-mode overrides */
  body.vscode-light header, body.vscode-high-contrast-light header{ background:rgba(255,255,255,.82); }
  body.vscode-light .c-idle, body.vscode-high-contrast-light .c-idle{ background:#f3e6c8; }
  body.vscode-light .reconnect, body.vscode-high-contrast-light .reconnect{ background:#fbe4e5; color:#9a2a2f; border-bottom-color:#f0c4c6; }
  body.vscode-light #drawer, body.vscode-high-contrast-light #drawer{ background:#fbfcff; }
  body.vscode-light #muteBtn:hover, body.vscode-light #langBtn:hover,
  body.vscode-high-contrast-light #muteBtn:hover, body.vscode-high-contrast-light #langBtn:hover{ background:#e3e8f7; }
  *{ box-sizing:border-box; }
  /* Fill the whole viewport: in a VS Code webview the body background does NOT
     propagate to the canvas the way it does in a browser, so a short office (few
     rooms) used to leave the editor's gray background showing below. min-height
     pins the office's own dark gradient to the full panel height; the html base
     follows the editor background (falls back to our dark in a plain browser). */
  html{ min-height:100%; background:var(--vscode-editor-background,var(--bg-2)); }
  body{ margin:0; min-height:100vh; font-family:"Segoe UI","Arial Hebrew",system-ui,sans-serif; color:var(--ink);
        background:radial-gradient(1100px 500px at 50% -10%,var(--bg-1),var(--bg-2) 60%) var(--bg-2); }
  :focus-visible{ outline:none; box-shadow:var(--ring); border-radius:var(--r-sm); }
  header{ display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:11px 20px;
          border-bottom:1px solid var(--line-head); position:sticky; top:0; z-index:40;
          background:rgba(8,11,22,.85); backdrop-filter:blur(8px); }
  @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){ header{ background:var(--bg-deep); } }
  header h1{ font-size:var(--fs-xl); margin:0; font-weight:800; letter-spacing:.2px; }
  .counts span{ display:inline-block; padding:2px 10px; border-radius:var(--r-pill); margin-inline-start:6px; font-size:var(--fs-sm); }
  .c-run{ background:var(--ok-bg); color:var(--ok); } .c-idle{ background:#33290f; color:var(--idle); } .c-done{ background:var(--done-bg); color:var(--done); }
  .spacer{ flex:1; }
  header label{ font-size:var(--fs-md); color:var(--ink-dim); display:flex; align-items:center; gap:6px; cursor:pointer; }
  .banner{ margin:0; padding:7px 20px; font-size:var(--fs-md); text-align:center;
           background:var(--banner-bg); color:var(--banner-ink); border-bottom:1px solid var(--banner-line); }
  .banner[hidden]{ display:none; }
  .banner a.drift-link{ color:#ffe0a0; }
  .diag{ text-align:center; color:var(--ink-dimmer); font-size:var(--fs-sm); padding:0 18px 30px; }
  .diag[hidden]{ display:none; }
  .reconnect{ margin:0; padding:6px 20px; font-size:var(--fs-md); text-align:center;
              background:#3a1518; color:#f0a9a9; border-bottom:1px solid #5a2024; }
  .reconnect[hidden]{ display:none; }
  #muteBtn{ font-size:var(--fs-md); background:var(--chip-bg); border:1px solid var(--chip-line); color:#cdd6f6;
            border-radius:var(--r-sm); padding:4px 9px; cursor:pointer; line-height:1; }
  #muteBtn:hover{ background:#222a47; }
  .sr-only{ position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .toasts{ position:fixed; bottom:16px; inset-inline-end:16px; z-index:80; display:flex; flex-direction:column; gap:8px; pointer-events:none; }
  .toast{ background:var(--surface); border:1px solid var(--line); border-inline-start:3px solid var(--ok); color:var(--ink);
          border-radius:var(--r-sm); padding:9px 14px; font-size:var(--fs-md); box-shadow:0 8px 24px rgba(0,0,0,.5);
          max-width:280px; opacity:0; transform:translateY(8px); transition:opacity .25s,transform .25s; }
  .toast.show{ opacity:1; transform:translateY(0); }
  #langBtn{ font-size:var(--fs-sm); background:var(--chip-bg); border:1px solid var(--chip-line); color:#cdd6f6;
            border-radius:var(--r-sm); padding:4px 11px; cursor:pointer; }
  #langBtn:hover{ background:#222a47; }
  #search{ font:inherit; font-size:var(--fs-md); background:var(--surface-3); border:1px solid var(--chip-line);
           color:var(--ink); border-radius:var(--r-sm); padding:5px 11px; width:190px; max-width:42vw; }
  #search::placeholder{ color:var(--ink-dimmer); }
  #search:focus-visible{ outline:none; border-color:var(--accent); box-shadow:0 0 0 2px rgba(91,110,224,.3); }

  #app{ padding:16px 18px 60px; display:flex; flex-direction:column; gap:14px; }
  .empty{ text-align:center; color:var(--ink-dimmer); font-size:var(--fs-lg); padding:54px 10px; }
  .empty .e-scene{ font-size:48px; line-height:1; margin-bottom:12px; filter:grayscale(.25); opacity:.65; }
  .empty .e-title{ font-size:var(--fs-lg); color:var(--ink-2); font-weight:700; margin-bottom:6px; }
  .empty .e-sub{ font-size:var(--fs-md); color:var(--ink-dim); margin-bottom:18px; }
  .btn-demo{ font:inherit; font-size:var(--fs-md); font-weight:600; color:#fff; cursor:pointer;
             background:linear-gradient(180deg,#3a4ad6,#2f3cb8); border:1px solid #4a5ae0; border-radius:var(--r-sm);
             padding:9px 18px; box-shadow:0 4px 14px rgba(50,70,220,.35); transition:filter .15s,transform .15s; }
  .btn-demo:hover{ filter:brightness(1.09); transform:translateY(-1px); }
  .demo-chip{ display:inline-flex; align-items:center; gap:8px; font-size:var(--fs-sm); color:#cdd6f6;
              background:rgba(91,110,224,.16); border:1px solid var(--accent); border-radius:var(--r-pill); padding:2px 4px 2px 12px; }
  html[dir="rtl"] .demo-chip{ padding:2px 12px 2px 4px; }
  .demo-chip button{ font:inherit; font-size:var(--fs-sm); background:var(--chip-bg); border:1px solid var(--chip-line);
                     color:#cdd6f6; border-radius:var(--r-pill); padding:2px 10px; cursor:pointer; }
  .demo-chip[hidden]{ display:none; }

  .room{ background:linear-gradient(180deg,var(--surface),var(--surface-2)); border:1px solid var(--line);
         border-inline-start:3px solid var(--room-accent,var(--accent)); border-radius:var(--r-lg); overflow:hidden; }
  .rh{ display:flex; align-items:center; gap:10px; padding:8px 14px; background:rgba(255,255,255,.03);
       border-bottom:1px solid var(--line-soft); font-size:var(--fs-md); }
  .rt{ font-weight:700; color:var(--ink-2); } .rt small{ color:var(--ink-dimmer); font-weight:400; margin-inline-start:6px; }
  .rc{ color:var(--ink-dim); }
  .rc b{ color:var(--ok); } .rc i{ font-style:normal; color:var(--idle); } .rc u{ text-decoration:none; color:var(--done); }
  /* per-conversation "show finished" toggle in the room header */
  .rdone{ font:inherit; background:none; border:1px solid transparent; color:var(--done); cursor:pointer;
          padding:0 5px; border-radius:6px; opacity:.55; }
  .rdone:hover{ background:rgba(255,255,255,.06); opacity:.85; }
  .rdone.on{ opacity:1; border-color:var(--done); background:rgba(28,197,90,.10); }
  .rdone:focus-visible{ outline:2px solid var(--done); outline-offset:1px; }
  /* the conversation itself (room lead) -- marked so it reads apart from its subagents */
  .ws.is-session::before{ content:"💬"; position:absolute; top:-3px; inset-inline-start:-3px; font-size:12px;
          filter:drop-shadow(0 1px 1px rgba(0,0,0,.55)); z-index:2; pointer-events:none; }
  .ws.is-session .name{ color:var(--ink); font-weight:700; }
  .floor{ display:flex; flex-wrap:wrap; gap:4px; padding:13px 12px 16px;
          background:linear-gradient(180deg,transparent 0 60%,rgba(0,0,0,.18)),
                     repeating-linear-gradient(90deg,rgba(255,255,255,.014) 0 42px,transparent 42px 84px); }

  .ws{ position:relative; width:92px; display:flex; flex-direction:column; align-items:center; gap:1px;
       padding:4px 3px 8px; border-radius:var(--r-md); cursor:pointer; transition:background .15s,transform .15s;
       contain:layout; }   /* isolate each card's layout recalc (no 'paint' -> badge/star still overflow) */
  .ws:hover{ background:rgba(255,255,255,.06); transform:translateY(-2px); }
  .ws:focus-visible{ background:rgba(255,255,255,.06); }

  /* ---- animated character sitting at a desk (decorative; aria-hidden) ---- */
  .scene{ position:relative; width:84px; height:68px; }
  .scene::after{ content:""; position:absolute; left:50%; bottom:2px; transform:translateX(-50%);
                 width:56px; height:7px; border-radius:50%; z-index:0;
                 background:radial-gradient(closest-side,rgba(0,0,0,.5),transparent 80%); }  /* contact shadow */
  .chair{ position:absolute; left:50%; bottom:7px; transform:translateX(-50%); width:30px; height:30px; z-index:1;
          border-radius:10px 10px 5px 5px; background:linear-gradient(180deg,#2b3360,#1b2342);
          box-shadow:inset 0 2px 0 rgba(255,255,255,.06), inset 0 -3px 0 rgba(0,0,0,.25); }
  .guy{ position:absolute; left:50%; bottom:14px; transform:translateX(-50%); width:40px; height:44px; z-index:1; }
  .torso{ position:absolute; left:50%; bottom:0; transform:translateX(-50%); width:26px; height:22px;
          border-radius:11px 11px 5px 5px; background:var(--c1,#5566cc);
          box-shadow:inset 0 -4px 5px rgba(0,0,0,.28), inset 0 2px 0 rgba(255,255,255,.12); }
  .head{ position:absolute; left:50%; bottom:16px; transform:translateX(-50%); font-size:25px; line-height:1;
         filter:drop-shadow(0 3px 3px rgba(0,0,0,.4)); transform-origin:50% 90%; }
  .desk{ position:absolute; left:50%; bottom:4px; transform:translateX(-50%); width:64px; height:15px; z-index:2;
         border-radius:4px; background:linear-gradient(180deg,#a5743f,#5f3c1d);
         border-top:1px solid rgba(255,255,255,.16); box-shadow:0 4px 7px rgba(0,0,0,.5); }
  .screen{ position:absolute; left:50%; bottom:19px; transform:translateX(-50%); width:16px; height:12px; z-index:2;
           border-radius:2px; background:#05070f; border:1px solid #1b2440; overflow:hidden; }
  .screen::after{ content:""; position:absolute; left:2px; right:2px; top:3px; height:1px; opacity:0;
                  background:rgba(255,255,255,.85); border-radius:1px; }  /* code-line shimmer */
  .hands{ position:absolute; left:50%; bottom:13px; transform:translateX(-50%); width:42px; height:10px; z-index:3; }
  .hand{ position:absolute; bottom:0; width:8px; height:8px; border-radius:50%; background:#f2c79a;
         box-shadow:0 1px 2px rgba(0,0,0,.4); }
  .hand.l{ left:5px; } .hand.r{ right:5px; }

  .ws.running .head{ animation:hbob 1s ease-in-out infinite; }
  @keyframes hbob{ 0%,100%{transform:translateX(-50%) translateY(0)} 50%{transform:translateX(-50%) translateY(-2px)} }
  .ws.running .hand.l{ animation:tap .3s ease-in-out infinite; }
  .ws.running .hand.r{ animation:tap .3s ease-in-out infinite .15s; }
  @keyframes tap{ 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
  /* running screen glows in the tool-family color (data-fam, set in updateWS); default green. */
  .ws.running .screen{ background:#0c2; box-shadow:0 0 8px #1f8a4d; }
  .ws.running[data-fam="search"] .screen{ background:#16c0dd; box-shadow:0 0 8px #16c0dd; }
  .ws.running[data-fam="write"]  .screen{ background:#e6a92e; box-shadow:0 0 8px #e6a92e; }
  .ws.running[data-fam="read"]   .screen{ background:#5b8def; box-shadow:0 0 8px #5b8def; }
  .ws.running[data-fam="cmd"]    .screen{ background:#1fc25a; box-shadow:0 0 8px #1fc25a; }
  .ws.running[data-fam="agent"]  .screen{ background:#c45bd0; box-shadow:0 0 8px #c45bd0; }
  .ws.running .screen::after{ animation:typeline 1.4s ease-in-out infinite; }
  @keyframes typeline{ 0%{opacity:0; transform:translateX(-40%)} 35%{opacity:.9} 65%{opacity:.4} 100%{opacity:0; transform:translateX(40%)} }
  .ws.done .screen{ background:#0a2f1c; box-shadow:0 0 6px #1c5; }
  /* finished desks keep a faint tint of their tool family so color variety survives */
  .ws.done[data-fam="search"] .screen{ background:#0a3a44; box-shadow:0 0 6px rgba(22,192,221,.55); }
  .ws.done[data-fam="write"]  .screen{ background:#3a2c0c; box-shadow:0 0 6px rgba(230,169,46,.55); }
  .ws.done[data-fam="read"]   .screen{ background:#142544; box-shadow:0 0 6px rgba(91,141,239,.55); }
  .ws.done[data-fam="cmd"]    .screen{ background:#0a2f1c; box-shadow:0 0 6px rgba(31,194,90,.55); }
  .ws.done[data-fam="agent"]  .screen{ background:#331640; box-shadow:0 0 6px rgba(196,91,208,.55); }

  .ws.stale .guy{ filter:grayscale(.6) brightness(.62); }
  .ws.stale .head{ animation:sway 3s ease-in-out infinite; }
  @keyframes sway{ 0%,100%{transform:translateX(-50%) rotate(-7deg)} 50%{transform:translateX(-50%) rotate(7deg)} }

  .ws.justdone .head{ animation:hop .7s cubic-bezier(.2,1.4,.4,1); }
  @keyframes hop{ 0%{transform:translateX(-50%) translateY(0)} 30%{transform:translateX(-50%) translateY(-16px)}
                  100%{transform:translateX(-50%) translateY(0)} }
  .ws.justdone .hands{ animation:cheer .7s ease; }
  @keyframes cheer{ 0%{transform:translateX(-50%) translateY(0)} 40%{transform:translateX(-50%) translateY(-13px)}
                    100%{transform:translateX(-50%) translateY(0)} }
  .name{ font-size:var(--fs-sm); color:var(--ink-2); max-width:84px; overflow:hidden; text-overflow:ellipsis;
         white-space:nowrap; margin-top:3px; }
  .act{ font-size:var(--fs-xs); color:#9db0e6; height:13px; max-width:86px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ws.done .act{ color:#8fc09a; } .ws.stale .act{ color:var(--idle); }
  .timer{ font-size:var(--fs-xs); color:var(--ink-dimmer); direction:ltr; }

  .ws.entering{ animation:walkin .7s ease-out; }
  @keyframes walkin{ 0%{opacity:0; transform:translateX(-66px)} 60%{opacity:1} 100%{opacity:1; transform:translateX(0)} }
  .ws.entering .guy{ animation:step .18s ease-in-out 3; }
  @keyframes step{ 0%,100%{transform:translateX(-50%) translateY(0)} 50%{transform:translateX(-50%) translateY(-3px)} }
  .burst{ position:absolute; inset:0; pointer-events:none; overflow:visible; }
  .confetti{ position:absolute; top:6px; font-size:15px; animation:fall 0.85s ease-out forwards; }
  @keyframes fall{ from{transform:translateY(-6px) scale(.6); opacity:1} to{transform:translateY(70px) rotate(200deg); opacity:0} }

  #backdrop{ position:fixed; inset:0; background:rgba(3,5,12,.55); z-index:60; opacity:0; pointer-events:none; transition:opacity .2s; }
  #backdrop.show{ opacity:1; pointer-events:auto; }
  #drawer{ position:fixed; top:0; right:0; height:100%; width:min(440px,92vw); z-index:70; background:#0f1426;
           border-left:1px solid var(--line-drawer); box-shadow:-12px 0 40px rgba(0,0,0,.5); transform:translateX(105%);
           transition:transform .26s cubic-bezier(.3,.9,.3,1); display:flex; flex-direction:column; }
  #drawer.open{ transform:translateX(0); }
  /* In RTL (Hebrew) the side panel mirrors to the left edge. */
  html[dir="rtl"] #drawer{ right:auto; left:0; border-left:0; border-right:1px solid var(--line-drawer);
                           box-shadow:12px 0 40px rgba(0,0,0,.5); transform:translateX(-105%); }
  html[dir="rtl"] #drawer.open{ transform:translateX(0); }
  .dhead{ display:flex; align-items:center; gap:12px; padding:16px 16px 12px; border-bottom:1px solid var(--line-head); }
  .dhead .av{ font-size:34px; } .dhead .nm{ font-size:16px; font-weight:700; } .dhead .ro{ font-size:var(--fs-md); color:var(--ink-dim); margin-top:2px; }
  #dclose{ margin-inline-start:auto; background:var(--chip-bg); border:1px solid var(--chip-line); color:#cdd6f6; border-radius:var(--r-sm); width:30px; height:30px; cursor:pointer; }
  #dbody{ padding:14px 16px; overflow:auto; }
  #dbody .row{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
  #dbody .chip{ font-size:var(--fs-sm); padding:3px 9px; border-radius:var(--r-pill); background:var(--chip-bg); color:var(--chip-ink); border:1px solid var(--chip-line); }
  #dbody h3{ font-size:var(--fs-sm); text-transform:uppercase; letter-spacing:.6px; color:var(--ink-dimmer); margin:15px 0 6px; }
  #dbody .box{ background:var(--surface-3); border:1px solid var(--line-soft); border-radius:var(--r-md); padding:11px 12px; font-size:var(--fs-md);
               line-height:1.6; color:#d4dcf6; white-space:pre-wrap; max-height:40vh; overflow:auto; }
  #dbody .box[dir]{ text-align:start; }  /* dir=auto picks direction; start-align follows it */

  /* ---- U2: narrow split-pane (the beside-editor panel is often ~half width) ---- */
  @media (max-width:560px){
    header{ padding:9px 12px; gap:9px; }
    #app{ padding:12px 10px 60px; }
    #search{ order:9; width:100%; max-width:none; }   /* search drops to its own full-width row */
    .floor{ padding:11px 8px 14px; }
  }
  @media (max-width:380px){
    header h1{ font-size:var(--fs-lg); }
    .counts span{ margin-inline-start:4px; padding:2px 7px; }
  }

  /* ---- U3: card press feedback + tamed scrollbars in the detail panel ---- */
  .ws:active{ transform:scale(.96); }
  #dbody, #dbody .box{ scrollbar-width:thin; scrollbar-color:var(--chip-line) transparent; }
  #dbody .box::-webkit-scrollbar, #dbody::-webkit-scrollbar{ width:9px; height:9px; }
  #dbody .box::-webkit-scrollbar-thumb, #dbody::-webkit-scrollbar-thumb{ background:var(--chip-line); border-radius:6px; }
  #dbody .box:focus-visible{ outline:none; box-shadow:var(--ring); }
  .trunc{ margin-top:6px; font-size:var(--fs-xs); color:var(--idle); }   /* A4: result-truncated note */

  /* ---- U4: keyboard-shortcut help popover ---- */
  #helpBtn{ font-size:var(--fs-md); background:var(--chip-bg); border:1px solid var(--chip-line); color:#cdd6f6;
            border-radius:var(--r-sm); width:28px; height:26px; cursor:pointer; line-height:1; }
  #helpBtn:hover{ background:#222a47; } body.vscode-light #helpBtn:hover{ background:#e3e8f7; }
  #help{ position:fixed; top:52px; inset-inline-end:16px; z-index:75; width:min(290px,92vw);
         background:var(--surface); border:1px solid var(--line-drawer); border-radius:var(--r-md);
         box-shadow:0 12px 34px rgba(0,0,0,.45); padding:12px 14px; font-size:var(--fs-md); color:var(--ink-2); }
  #help[hidden]{ display:none; }
  #help h3{ margin:0 0 8px; font-size:var(--fs-md); }
  #help .k{ display:flex; justify-content:space-between; gap:14px; padding:3px 0; color:var(--ink-dim); }
  #help kbd{ font-family:inherit; background:var(--chip-bg); border:1px solid var(--chip-line); border-radius:5px;
             padding:1px 7px; color:var(--chip-ink); font-size:var(--fs-sm); }

  /* ---- U5: first-load spinner + lingering "just finished" star ---- */
  .spin{ width:30px; height:30px; margin:0 auto 14px; border-radius:50%;
         border:3px solid var(--line); border-top-color:var(--accent); animation:spin .8s linear infinite; }
  @keyframes spin{ to{ transform:rotate(360deg); } }
  .ws.recent::after{ content:"⭐"; position:absolute; top:-2px; inset-inline-end:-1px; font-size:13px; z-index:3;
         filter:drop-shadow(0 1px 1px rgba(0,0,0,.5)); animation:pop .4s ease; pointer-events:none; }
  @keyframes pop{ 0%{ transform:scale(0); } 70%{ transform:scale(1.35); } 100%{ transform:scale(1); } }

  /* ---- U6: keep the looping/one-shot character motion on the GPU ---- */
  .ws.running .head, .ws.running .hand, .ws.entering, .ws.entering .guy,
  .ws.justdone .head, .ws.justdone .hands{ will-change:transform; }

  /* ---- prefers-reduced-motion: kill looping/one-shot motion, keep state-by-color ---- */
  @media (prefers-reduced-motion: reduce){
    .ws .head, .ws .hand, .ws .screen, .ws .screen::after, .ws .guy, .ws .hands,
    .ws.entering, .ws.entering .guy, .ws.justdone .head, .ws.justdone .hands, .confetti,
    .spin, .ws.recent::after{ animation:none !important; }
    .ws:hover, .ws:active{ transform:none; }
    #drawer, #backdrop, .toast{ transition:none; }
  }
</style>
</head>
<body>
<header>
  <h1 id="h1">🏢 Claude Theater</h1>
  <div class="counts" id="counts"></div>
  <span id="demoChip" class="demo-chip" hidden>▶ <span id="demoChipLbl">Demo</span> <button id="exitDemoBtn" type="button">Exit</button></span>
  <div class="spacer"></div>
  <input id="search" type="search" autocomplete="off" placeholder="Search agents…" aria-label="Search agents">
  <button id="muteBtn" type="button">🔔</button>
  <button id="langBtn" type="button">עברית</button>
  <button id="helpBtn" type="button" aria-haspopup="true" aria-expanded="false">?</button>
  <label><input type="checkbox" id="showDone"> <span id="showDoneLbl">Show finished</span></label>
</header>
<div id="help" role="dialog" aria-labelledby="helpTitle" hidden></div>
<div id="banner" class="banner" hidden></div>
<div id="reconnect" class="reconnect" role="status" hidden></div>
<div id="app"><div class="empty" data-boot="1"></div></div>
<div id="diag" class="diag" hidden></div>

<div id="toasts" class="toasts" aria-hidden="true"></div>
<div id="live" class="sr-only" role="status" aria-live="polite"></div>

<div id="backdrop"></div>
<aside id="drawer" role="dialog" aria-modal="true" aria-labelledby="dnm dro">
  <div class="dhead"><div class="av" id="dav" aria-hidden="true"></div>
    <div><div class="nm" id="dnm" dir="auto"></div><div class="ro" id="dro" dir="auto"></div></div>
    <button id="dclose">✕</button></div>
  <div id="dbody"></div>
</aside>

<script>
const POLL_MS=1500;
const DRIFT_URL="https://github.com/asafabram-ship-it/claude-theater/issues/new?template=format-drift.yml";
// "" in a normal browser (same-origin). The VS Code extension injects an
// absolute http://127.0.0.1:<port> base so the embedded webview can reach the API.
const API_BASE=(typeof window!=="undefined"&&window.__CT_API_BASE__)||"";
const rooms={};   // session_full -> {section, floor, rt, rc}
const els={};     // id -> {root, refs, data, status}
const prevStatus={};
let audioCtx=null, openId=null, openData=null;
let showDone=(function(){ try{ if(/[?&]show=done\\b/.test(location.search)) return true;
  if(/[?&]demo=1(?:&|$)/.test(location.search)) return true;   // demo must show the finish beat
  return localStorage.getItem("ct_showDone")==="1"; }catch(e){ return false; } })();
// per-conversation "show finished" overrides; falls back to the global showDone default
let roomDone=(function(){ try{ return JSON.parse(localStorage.getItem("ct_roomDone")||"{}")||{}; }catch(e){ return {}; } })();
function roomShowsDone(s){ return (s in roomDone) ? !!roomDone[s] : showDone; }
function toggleRoomDone(s){ roomDone[s]=!roomShowsDone(s); try{ localStorage.setItem("ct_roomDone",JSON.stringify(roomDone)); }catch(e){} render(); }
let demoMode=(function(){ try{ return /[?&]demo=1(?:&|$)/.test(location.search); }catch(e){ return false; } })();
let searchQuery="", lastPayload=null, searchT=null, lastDing=0, lastOrderKey="";
let muted=(function(){ try{ return localStorage.getItem("ct_muted")==="1"; }catch(e){ return false; } })();

// ---- i18n: the browser owns every display string in both languages. ----
// To add a language, add an entry here (and personas/tools tables) -- nothing
// in Python needs to change. Persona names are index-aligned with PERSONA_EMOJI.
const PERSONAS_EN=["The Detective","The Writer","The Courier","The Researcher","The Librarian","The Navigator","The Scout","The Builder","The Wizard","The Marksman","The Owl","The Fox","The Bee","The Robot","The Tiger","The Eagle"];
const PERSONAS_HE=["הבלש","הסופר","השליח","החוקר","הספרן","הנווט","הצופה","הבנאי","הקוסם","הצייד","הינשוף","השועל","הדבורה","הרובוט","הנמר","הנשר"];
const TOOLS_EN={WebSearch:"🔍 Searching",WebFetch:"🌐 Reading page",Read:"📖 Reading",Edit:"✏️ Editing",MultiEdit:"✏️ Editing",Write:"✏️ Writing",NotebookEdit:"✏️ Notebook",Bash:"⚙️ Command",PowerShell:"⚙️ Command",BashOutput:"⚙️ Output",KillShell:"⚙️ Command",SlashCommand:"⌨️ Slash command",Grep:"🔎 Searching code",Glob:"🔎 Files",Task:"👥 Subagent",Agent:"👥 Subagent",TodoWrite:"📝 Todos",Skill:"🧩 Skill",ExitPlanMode:"📋 Plan",StructuredOutput:"🧾 Summarizing"};
const TOOLS_HE={WebSearch:"🔍 מחפש",WebFetch:"🌐 קורא דף",Read:"📖 קורא",Edit:"✏️ עורך",MultiEdit:"✏️ עורך",Write:"✏️ כותב",NotebookEdit:"✏️ מחברת",Bash:"⚙️ פקודה",PowerShell:"⚙️ פקודה",BashOutput:"⚙️ פלט",KillShell:"⚙️ פקודה",SlashCommand:"⌨️ פקודת סלאש",Grep:"🔎 מחפש קוד",Glob:"🔎 קבצים",Task:"👥 סוכן",Agent:"👥 סוכן",TodoWrite:"📝 משימות",Skill:"🧩 מיומנות",ExitPlanMode:"📋 תכנון",StructuredOutput:"🧾 מסכם"};
const I18N={
  en:{ appTitle:"🏢 Claude Theater", docTitle:"Claude Theater", showDone:"Show finished", toggleFinished:"Show/hide finished in this conversation", switchTo:"עברית",
       emptyOffice:"The office is empty",
       emptySub:"Start an agent in Claude Code — or see what a busy office looks like:",
       watchDemo:"▶ Watch a live demo", demoLabel:"Demo", exitDemo:"Exit",
       langHint:"Switch language (Hebrew / English)", close:"Close",
       loading:"Loading…", helpTitle:"Keyboard shortcuts", helpHint:"Keyboard shortcuts",
       scSearch:"Search", scFinished:"Show / hide finished", scMove:"Move between agents",
       scOpen:"Open details", scClose:"Close panel",
       resultTruncated:"Result shortened — open the terminal for the full output",
       reconnecting:"⚠ Lost connection to the server — retrying…",
       searchPlaceholder:"Search agents…", emptyNoMatch:"No agents match your search.",
       mute:"Mute chime", unmute:"Unmute chime", finishedToast:"finished",
       skippedN:function(n){ return n+" malformed line"+(n===1?"":"s")+" skipped"; }, reportDrift:"report",
       emptyNoActive:'No active agents. Tick "Show finished" to see history.',
       emptyNoneInWindow:"No agents in the time window.",
       working:"working", idleN:"idle", finished:"finished",
       dWorking:"Working", dDone:"Done", dStale:"Idle",
       dDuration:"Duration ", dElapsed:"Elapsed ",
       dAction:"Activity", dTask:"Task", dResult:"Result",
       taskUnavailable:"working — details unavailable",
       actDone:"✅ Done", actStale:"💤 Idle", actThinking:"🤔 Thinking", actMcp:"🔌 MCP tool",
       personas:PERSONAS_EN, tools:TOOLS_EN,
       banner:function(tv,sv){ return "⚠ Tested up to Claude Code "+tv+" · detected "+sv+" — display may be partial"; } },
  he:{ appTitle:"🏢 משרד הסוכנים", docTitle:"משרד הסוכנים", showDone:"הצג שהושלמו", toggleFinished:"הצג/הסתר שהושלמו בשיחה זו", switchTo:"English",
       emptyOffice:"המשרד ריק",
       emptySub:"הפעילו סוכן ב-Claude Code - או הציצו איך נראה משרד עמוס:",
       watchDemo:"▶ צפו בדמו חי", demoLabel:"דמו", exitDemo:"יציאה",
       langHint:"החלפת שפה (עברית / אנגלית)", close:"סגירה",
       loading:"טוען…", helpTitle:"קיצורי מקלדת", helpHint:"קיצורי מקלדת",
       scSearch:"חיפוש", scFinished:"הצג / הסתר שהושלמו", scMove:"מעבר בין סוכנים",
       scOpen:"פתיחת פרטים", scClose:"סגירת החלונית",
       resultTruncated:"התוצאה קוצרה — לפלט המלא פתחו את הטרמינל",
       reconnecting:"⚠ אבד החיבור לשרת - מנסה שוב…",
       searchPlaceholder:"חיפוש סוכנים…", emptyNoMatch:"אין סוכנים שתואמים לחיפוש.",
       mute:"השתק צליל", unmute:"בטל השתקה", finishedToast:"סיים",
       skippedN:function(n){ return n+" שורות פגומות דולגו"; }, reportDrift:"דווח",
       emptyNoActive:'אין סוכנים פעילים. סמנו "הצג שהושלמו" כדי לראות היסטוריה.',
       emptyNoneInWindow:"אין סוכנים בחלון הזמן.",
       working:"עובדים", idleN:"ממתינים", finished:"סיימו",
       dWorking:"עובד", dDone:"סיים", dStale:"ממתין",
       dDuration:"משך ", dElapsed:"זמן ",
       dAction:"פעולה", dTask:"משימה", dResult:"תוצאה",
       taskUnavailable:"עובד — פרטים לא זמינים",
       actDone:"✅ סיים", actStale:"💤 ממתין", actThinking:"🤔 חושב", actMcp:"🔌 כלי MCP",
       personas:PERSONAS_HE, tools:TOOLS_HE,
       banner:function(tv,sv){ return "⚠ נבדק עד Claude Code "+tv+" · זוהתה גרסה "+sv+" — ייתכן שהתצוגה חלקית"; } }
};
let lang=(function(){ try{ var Q=(location.search.match(/[?&]lang=(he|en)\\b/)||[])[1]; if(Q) return Q;
  var L=localStorage.getItem("ct_lang"); return (L==="he"||L==="en")?L:"en"; }catch(e){ return "en"; } })();
function t(k){ const v=I18N[lang][k]; return (v!==undefined&&v!==null)?v:((I18N.en[k]!==undefined)?I18N.en[k]:k); }
function personaName(a){ const p=I18N[lang].personas; return (a&&typeof a.persona_id==="number"&&p[a.persona_id])||(lang==="he"?"סוכן":"Agent"); }
function mcpServer(tool){ const p=(tool||"").split("__"); return p.length>=3?p[1]:""; }  // mcp__<server>__<tool>
function activityLabel(a){ const L=I18N[lang];
  if(a.status==="done") return L.actDone;
  if(a.status==="stale") return L.actStale;
  if(a.tool&&a.tool.indexOf("mcp__")===0){ const s=mcpServer(a.tool); return s?("🔌 "+s):L.actMcp; }
  return L.tools[a.tool]||L.actThinking; }
function bannerText(tv,sv){ return I18N[lang].banner(tv,sv); }
function applyLang(){ const el=document.documentElement; el.lang=lang; el.dir=(lang==="he")?"rtl":"ltr";
  document.getElementById("h1").textContent=t("appTitle");
  document.getElementById("showDoneLbl").textContent=t("showDone");
  document.getElementById("langBtn").textContent=t("switchTo");
  document.getElementById("demoChipLbl").textContent=t("demoLabel");
  document.getElementById("exitDemoBtn").textContent=t("exitDemo");
  document.getElementById("demoChip").hidden=!demoMode;
  document.getElementById("showDone").checked=showDone;
  document.getElementById("langBtn").title=t("langHint");
  document.getElementById("search").placeholder=t("searchPlaceholder");
  document.getElementById("search").setAttribute("aria-label",t("searchPlaceholder"));
  const mb=document.getElementById("muteBtn"); mb.textContent=muted?"🔕":"🔔";
  mb.title=t(muted?"unmute":"mute"); mb.setAttribute("aria-label",t(muted?"unmute":"mute"));
  document.getElementById("dclose").title=t("close");
  document.getElementById("dclose").setAttribute("aria-label",t("close"));
  const rc=document.getElementById("reconnect"); if(!rc.hidden) rc.textContent=t("reconnecting");
  document.title=t("docTitle");
  document.getElementById("helpBtn").title=t("helpHint");
  document.getElementById("helpBtn").setAttribute("aria-label",t("helpHint"));
  if(!document.getElementById("help").hidden) renderHelp();
  // the boot element shows a spinner until the first poll replaces it (render()
  // removes the .empty node); after that this query finds nothing -- a no-op.
  const boot=document.querySelector('#app .empty[data-boot]'); if(boot) boot.innerHTML=loadingHTML();
  // The drawer is the one surface render() may not refresh (an open 'done' agent
  // can be filtered out of the floor), so re-translate it directly from cached data.
  if(openId&&openData) fillDrawer(openData); }
function setLang(l){ lang=(l==="he")?"he":"en"; try{ localStorage.setItem("ct_lang",lang); }catch(e){}
  try{ const u=new URL(location.href); if(u.searchParams.has("lang")){ u.searchParams.set("lang",lang); history.replaceState(null,"",u.pathname+u.search); } }catch(e){}
  applyLang(); poll(); }

function esc(s){ return (s==null?"":String(s)).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmt(ms){ if(ms==null||ms<0) return "--:--"; const s=Math.floor(ms/1000),m=Math.floor(s/60),x=s%60;
  return String(m).padStart(2,"0")+":"+String(x).padStart(2,"0"); }
function baseName(p){ return (p||"").replace(/[\\\\/]+$/,"").split(/[\\\\/]/).pop()||"—"; }
function roomLabel(a){ return baseName(a.project||a.cwd); }   // the conversation's project, not a nested subagent cwd
const COLORS=["#5b6ee0","#e07a5b","#3fae74","#c45bd0","#e0b84a","#4ab3c4","#d05b7a","#7a86b8"];
function colorFor(id){ let h=0; for(let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0; return COLORS[h%COLORS.length]; }

function ding(){ if(muted) return; const nw=Date.now(); if(nw-lastDing<400) return; lastDing=nw;  // mute + storm guard
  try{ audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
  const t=audioCtx.currentTime;
  [880,1320].forEach((f,i)=>{ const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type="sine"; o.frequency.value=f; o.connect(g); g.connect(audioCtx.destination);
    const s=t+i*0.12; g.gain.setValueAtTime(0.0001,s); g.gain.exponentialRampToValueAtTime(0.25,s+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,s+0.35); o.start(s); o.stop(s+0.4); }); }catch(e){} }

function confetti(root){ const r=root.getBoundingClientRect(); const b=document.createElement("div"); b.className="burst";
  // pinned over the card on <body> (not inside it): the room has overflow:hidden,
  // which used to clip the confetti at the room edge.
  b.style.cssText="position:fixed;z-index:90;left:"+r.left+"px;top:"+r.top+"px;width:"+r.width+"px;height:"+r.height+"px;";
  const em=["🎉","✨","🎊","⭐","✅"];
  for(let i=0;i<10;i++){ const c=document.createElement("div"); c.className="confetti"; c.textContent=em[i%em.length];
    c.style.left=(8+Math.random()*78)+"%"; c.style.animationDelay=(Math.random()*0.15)+"s"; b.appendChild(c); }
  document.body.appendChild(b); setTimeout(()=>b.remove(),1050); }

let announceT=null;
function announce(msg){ const el=document.getElementById("live"); if(!el) return;  // SR-only live region
  el.textContent = el.textContent ? (el.textContent+" · "+msg) : msg;        // append so same-tick finishes aren't lost
  clearTimeout(announceT); announceT=setTimeout(()=>{ el.textContent=""; },4000); }
function toast(msg){ const c=document.getElementById("toasts"); if(!c) return;
  const d=document.createElement("div"); d.className="toast"; d.dir="auto"; d.textContent=msg; c.appendChild(d);
  requestAnimationFrame(()=>d.classList.add("show"));
  setTimeout(()=>{ d.classList.remove("show"); setTimeout(()=>d.remove(),300); },3200); }
function setMuted(m){ muted=m; try{ localStorage.setItem("ct_muted",m?"1":"0"); }catch(e){}
  const b=document.getElementById("muteBtn"); if(!b) return;
  b.textContent=m?"🔕":"🔔"; b.title=t(m?"unmute":"mute"); b.setAttribute("aria-label",t(m?"unmute":"mute")); }

function createWS(a){ const root=document.createElement("div"); root.className="ws "+a.status+(a.is_session?" is-session":"");
  root.style.setProperty("--c1", colorFor(a.id));
  root.tabIndex=0; root.setAttribute("role","button");           // keyboard-reachable card
  root.innerHTML=
    '<div class="scene" aria-hidden="true"><div class="chair"></div>'+
    '<div class="guy"><div class="torso"></div><div class="head"></div></div>'+
    '<div class="desk"></div><i class="screen"></i>'+
    '<div class="hands"><i class="hand l"></i><i class="hand r"></i></div></div>'+
    '<div class="name" dir="auto"></div><div class="act" dir="auto"></div><div class="timer"></div>';
  const refs={ head:root.querySelector(".head"), name:root.querySelector(".name"),
               act:root.querySelector(".act"), timer:root.querySelector(".timer") };
  root.addEventListener("click",()=>openDrawer(a.id));
  root.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openDrawer(a.id); } });
  root.classList.add("entering"); setTimeout(()=>root.classList.remove("entering"),750);
  // status MUST start as a.status (not null): the very next updateWS() runs in the
  // same synchronous render task, and on a status mismatch it rewrites className --
  // which would strip "entering" before the browser ever paints, killing the walk-in.
  // (className already carries status + is-session above, so nothing is lost.)
  return { root, refs, data:a, status:a.status }; }

// Tool -> color family for the monitor glow (and a coarse grouping). Kept in
// sync with the .ws.running[data-fam=...] rules and the TOOLS_* label tables.
function toolFamily(tool){ if(!tool) return "";
  if(tool.indexOf("mcp__")===0) return "agent";
  if(/^(WebSearch|Grep|Glob)$/.test(tool)) return "search";
  if(/^(Read|WebFetch)$/.test(tool)) return "read";
  if(/^(Edit|Write|NotebookEdit|MultiEdit)$/.test(tool)) return "write";
  if(/^(Bash|PowerShell|BashOutput|KillShell)$/.test(tool)) return "cmd";
  if(/^(Task|Agent)$/.test(tool)) return "agent";
  return ""; }

function updateWS(e,a){ e.data=a;
  if(e.status!==a.status) e.root.className="ws "+a.status+(a.is_session?" is-session":"");
  e.root.dataset.fam=toolFamily(a.tool);
  e.refs.head.textContent=a.emoji;
  const nm=a.role||personaName(a); e.refs.name.textContent=nm; e.refs.name.title=nm;
  const actLbl=activityLabel(a); e.refs.act.textContent=actLbl; e.refs.act.title=actLbl;
  e.root.setAttribute("aria-label", nm+" — "+actLbl);
  e.refs.timer.dataset.start=a.start_ms||0; e.refs.timer.dataset.end=a.end_ms||0;
  e.refs.timer.dataset.mtime=a.mtime_ms||0; e.refs.timer.dataset.status=a.status;
  e.refs.timer.dataset.session=a.is_session?"1":"";
  if(prevStatus[a.id] && prevStatus[a.id]!=="done" && a.status==="done"){
    e.root.classList.add("justdone"); confetti(e.root); ding();
    const fmsg=nm+" — "+t("finishedToast"); toast(fmsg); announce(fmsg);  // visual + SR cue, survives a muted tab
    setTimeout(()=>e.root.classList.remove("justdone"),900);
    // keep a ⭐ on the card for 10s so a glance-away user still sees it just finished
    e.root.classList.add("recent"); clearTimeout(e.recentT); e.recentT=setTimeout(()=>e.root.classList.remove("recent"),10000); }
  prevStatus[a.id]=a.status; e.status=a.status;
  if(openId===a.id){ openData=a; fillDrawer(a); } }

function ensureRoom(sess){ let r=rooms[sess]; if(r) return r;
  const section=document.createElement("section"); section.className="room";
  section.style.setProperty("--room-accent", colorFor(sess));  // a stable hue per conversation
  section.setAttribute("role","group");
  // rt: dir=auto so a Hebrew vs English topic each reads correctly (an English
  // task in the RTL page otherwise gets its trailing "." flung to the wrong end).
  // rc: dir=ltr -- it's only emoji + numbers + "·" separators, which scramble
  // (counts looked like "-1 -3") when laid out RTL.
  section.innerHTML='<div class="rh"><span class="rt" dir="auto"></span><span class="spacer"></span><span class="rc" dir="ltr"></span></div><div class="floor"></div>';
  r={ section, floor:section.querySelector(".floor"), rt:section.querySelector(".rt"), rc:section.querySelector(".rc") };
  rooms[sess]=r; return r; }

function emptyHTML(kind){
  // kind: "office" (first run / nothing at all) | "noactive" | "nonewindow" | "nomatch"
  const msg = kind==="noactive" ? t("emptyNoActive") : kind==="nonewindow" ? t("emptyNoneInWindow")
            : kind==="nomatch" ? t("emptyNoMatch") : t("emptyOffice");
  let h='<div class="e-scene" aria-hidden="true">🏢</div><div class="e-title">'+esc(msg)+'</div>';
  if(kind==="office") h+='<div class="e-sub">'+esc(t("emptySub"))+'</div>'
                        +'<button class="btn-demo" type="button">'+esc(t("watchDemo"))+'</button>';
  return h;
}
function loadingHTML(){ return '<div class="spin" aria-hidden="true"></div><div class="e-sub">'+esc(t("loading"))+'</div>'; }
function renderHelp(){ const el=document.getElementById("help");
  const rows=[["scSearch","/"],["scFinished","f"],["scMove","↑ ↓ ← →"],["scOpen","Enter"],["scClose","Esc"]];
  el.innerHTML='<h3 id="helpTitle">'+esc(t("helpTitle"))+'</h3>'+
    rows.map(r=>'<div class="k"><span>'+esc(t(r[0]))+'</span><kbd>'+esc(r[1])+'</kbd></div>').join(''); }
function toggleHelp(show){ const el=document.getElementById("help"), btn=document.getElementById("helpBtn");
  const open=(show===undefined)?el.hidden:show;
  if(open){ renderHelp(); el.hidden=false; } else el.hidden=true;
  btn.setAttribute("aria-expanded",open?"true":"false"); }
function matchesSearch(a,q){ return (
  (a.role||"").toLowerCase().indexOf(q)>=0 ||
  (a.task||"").toLowerCase().indexOf(q)>=0 ||
  (a.tool||"").toLowerCase().indexOf(q)>=0 ||
  personaName(a).toLowerCase().indexOf(q)>=0 ||
  roomLabel(a).toLowerCase().indexOf(q)>=0 ); }
function setDemo(on){ demoMode=on; document.getElementById("demoChip").hidden=!on;
  // The demo's showpiece is the running->done finish beat (confetti+chime), which
  // only fires on a visible card -- so demo mode must show finished agents. On
  // exit, restore the user's saved preference. (Not persisted: a demo shouldn't
  // overwrite the real toggle. prevStatus is empty for fresh cards, so no phantom confetti.)
  const cb=document.getElementById("showDone");
  showDone = on ? true : (function(){ try{ return localStorage.getItem("ct_showDone")==="1"; }catch(e){ return false; } })();
  cb.checked=showDone;
  try{ const u=new URL(location.href); if(on) u.searchParams.set("demo","1"); else u.searchParams.delete("demo");
    history.replaceState(null,"",u.pathname+u.search); }catch(e){}
  poll(); }

function render(payload){
  if(payload) lastPayload=payload;       // cache so search/filter can re-render without a fetch
  const all=(lastPayload&&lastPayload.agents)||[];
  const bn=document.getElementById("banner");
  const uv=(lastPayload&&lastPayload.unknown_versions)||[];
  if(uv.length){ bn.innerHTML=esc(bannerText((lastPayload.tested_version||""),uv.join(", ")))
      +' <a class="drift-link" href="'+DRIFT_URL+'" target="_blank" rel="noopener">'+esc(t("reportDrift"))+'</a>';
    bn.hidden=false; }
  else bn.hidden=true;
  const app=document.getElementById("app");
  const em=app.querySelector(".empty"); if(em) em.remove();

  // per-session stats from ALL agents (so a room can show ✓done even when hidden)
  const stat={};
  for(const a of all){ const s=a.session_full; const v=stat[s]||(stat[s]={running:0,stale:0,done:0,label:roomLabel(a),topic:"",sid:a.session,mtime:0});
    if(v[a.status]!==undefined) v[a.status]++; v.mtime=Math.max(v.mtime,a.mtime_ms||0);
    if(a.is_session && a.task_short) v.topic=a.task_short;   // the conversation's subject -> room title
    if(!v.label) v.label=roomLabel(a); }

  const q=(searchQuery||"").toLowerCase().trim();
  const searched = q ? all.filter(a=>matchesSearch(a,q)) : all;
  // "Show finished" is per-conversation: each room controls its own done visibility
  const visible = searched.filter(a=> a.status!=="done" || roomShowsDone(a.session_full));
  const sess=[...new Set(visible.map(a=>a.session_full))];
  sess.sort((x,y)=>((stat[y].running>0)-(stat[x].running>0))||(stat[y].mtime-stat[x].mtime));

  // drop workers no longer visible
  const need=new Set(visible.map(a=>a.id));
  for(const id in els){ if(!need.has(id)){ els[id].root.remove(); delete els[id]; } }
  // Reconcile prevStatus for EVERY agent (not just visible ones): record the
  // status of hidden/filtered agents so a later toggle can't replay a stale
  // running->done as a fresh finish (confetti/ding/toast), and prune ids that
  // left the payload so the map can't grow unbounded.
  { const live=new Set(all.map(a=>a.id));
    for(const a of all){ if(!need.has(a.id)) prevStatus[a.id]=a.status; }
    for(const id in prevStatus){ if(!live.has(id)) delete prevStatus[id]; } }

  // only re-append sections when the room order actually changed (avoids layout
  // churn + animation interrupts every 1.5 s); only rewrite header strings on change.
  const orderKey=sess.join("|"); const reorder=(orderKey!==lastOrderKey); lastOrderKey=orderKey;
  for(const s of sess){ const r=ensureRoom(s); if(reorder) app.appendChild(r.section);
    const st=stat[s];
    const title=st.topic||st.label;
    const rtHTML='💬 '+esc(title)+' <small>'+esc(st.topic?st.label:st.sid)+'</small>';
    if(r._rt!==rtHTML){ r.rt.innerHTML=rtHTML; r._rt=rtHTML; }
    const showing=roomShowsDone(s);
    const doneBtn=st.done?(' · <button class="rdone'+(showing?' on':'')+'" data-s="'+esc(s)+'" type="button" aria-pressed="'+(showing?'true':'false')+'" title="'+esc(t("toggleFinished"))+'">✅'+st.done+'</button>'):'';
    const rcHTML='🟢 <b>'+st.running+'</b>'+(st.stale?' · <i>⏳'+st.stale+'</i>':'')+doneBtn;
    if(r._rc!==rcHTML){ r.rc.innerHTML=rcHTML; r._rc=rcHTML; }
    for(const a of visible){ if(a.session_full!==s) continue;
      let e=els[a.id]; if(!e){ e=createWS(a); els[a.id]=e; r.floor.appendChild(e.root); }
      else if(e.root.parentElement!==r.floor){ r.floor.appendChild(e.root); }
      updateWS(e,a); } }

  for(const s in rooms){ if(!sess.includes(s)){ rooms[s].section.remove(); delete rooms[s]; } }
  if(!visible.length){ const d=document.createElement("div"); d.className="empty";
    const kind = q ? "nomatch" : (all.length===0 ? "office" : (showDone?"nonewindow":"noactive"));
    d.innerHTML=emptyHTML(kind); app.appendChild(d); }

  const run=all.filter(a=>a.status==="running").length, idle=all.filter(a=>a.status==="stale").length, done=all.filter(a=>a.status==="done").length;
  document.title=(run?("🟢 "+run+" · "):"")+t("docTitle");   // live working-count in the tab/title
  document.getElementById("counts").innerHTML='<span class="c-run">🟢 '+run+' '+t("working")+'</span>'
    +(idle?'<span class="c-idle">⏳ '+idle+' '+t("idleN")+'</span>':'')
    +'<span class="c-done">✅ '+done+' '+t("finished")+'</span>';

  const dg=document.getElementById("diag"); const sk=(lastPayload&&lastPayload.skipped)||0;
  if(sk>0){ dg.textContent=t("skippedN")(sk); dg.hidden=false; } else dg.hidden=true;
}

function fillDrawer(a){ document.getElementById("dav").textContent=a.emoji;
  document.getElementById("dnm").textContent=personaName(a); document.getElementById("dro").textContent=a.role||a.task_short||"";
  const now=Date.now(); const dur=(a.status==="done"&&a.end_ms)?(a.end_ms-a.start_ms):(now-(a.start_ms||now));
  const stx=a.status==="running"?t("dWorking"):a.status==="done"?t("dDone"):t("dStale");
  let h='<div class="row"><span class="chip">'+esc(stx)+'</span>'+
    (a.subagent_type?'<span class="chip" dir="auto">'+esc(a.subagent_type)+'</span>':'')+
    '<span class="chip" dir="auto">'+(a.status==="done"?t("dDuration"):t("dElapsed"))+fmt(dur)+'</span>'+
    (a.tool?'<span class="chip" dir="auto">'+esc(a.tool)+'</span>':'')+'</div>';
  h+='<h3>'+esc(t("dAction"))+'</h3><div class="box">'+esc(activityLabel(a))+'</div>';
  // task & result are journal content (could be English or Hebrew) -> dir=auto so
  // each adapts to its own text instead of being forced LTR (broke Hebrew tasks).
  h+='<h3>'+esc(t("dTask"))+'</h3><div class="box" dir="auto" tabindex="0" role="region" aria-label="'+esc(t("dTask"))+'">'+esc(a.task||t("taskUnavailable"))+'</div>';
  if(a.result) h+='<h3>'+esc(t("dResult"))+'</h3><div class="box" dir="auto" tabindex="0" role="region" aria-label="'+esc(t("dResult"))+'">'+esc(a.result)+'</div>'
    +(a.truncated?'<div class="trunc" dir="auto">✂ '+esc(t("resultTruncated"))+'</div>':'');
  document.getElementById("dbody").innerHTML=h; }
let lastFocused=null;
function openDrawer(id){ const e=els[id]; if(!e) return; lastFocused=document.activeElement;
  openId=id; openData=e.data; fillDrawer(e.data);
  document.getElementById("drawer").classList.add("open"); document.getElementById("backdrop").classList.add("show");
  document.querySelectorAll("header,#app").forEach(el=>{ el.inert=true; el.setAttribute("aria-hidden","true"); });  // take background out of the a11y tree
  // move focus into the dialog -- onto the content (task/result), not the close
  // button, so it reads immediately and Tab walks the panel from the top
  const box=document.querySelector('#dbody .box[tabindex]'); (box||document.getElementById("dclose")).focus(); }
function closeDrawer(){ if(!openId) return; openId=null; openData=null;
  document.getElementById("drawer").classList.remove("open"); document.getElementById("backdrop").classList.remove("show");
  document.querySelectorAll("header,#app").forEach(el=>{ el.inert=false; el.removeAttribute("aria-hidden"); });  // return background to the a11y tree
  if(lastFocused&&lastFocused.focus){ try{ lastFocused.focus(); }catch(_){} } lastFocused=null; }  // restore focus
document.getElementById("dclose").addEventListener("click",closeDrawer);
document.getElementById("backdrop").addEventListener("click",closeDrawer);
// trap Tab within the open drawer (modal dialog behavior)
document.getElementById("drawer").addEventListener("keydown",e=>{ if(e.key!=="Tab"||!openId) return;
  const f=document.getElementById("drawer").querySelectorAll('button,[href],input,[tabindex]:not([tabindex="-1"])');
  if(!f.length) return; const first=f[0], last=f[f.length-1];
  if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); } });
// arrow-key movement across cards (RTL mirrors the horizontal direction)
function moveCardFocus(e){ const cards=[].slice.call(document.querySelectorAll(".ws")); if(!cards.length) return;
  const i=cards.indexOf(document.activeElement);
  if(i<0) return;            // no card focused -> let the browser scroll the page (Tab/click enters the grid)
  e.preventDefault();
  let d=(e.key==="ArrowRight"||e.key==="ArrowDown")?1:-1;
  if((e.key==="ArrowLeft"||e.key==="ArrowRight") && document.documentElement.dir==="rtl") d=-d;
  cards[Math.max(0,Math.min(cards.length-1,i+d))].focus(); }
// global shortcuts: Esc closes; "/" focuses search; "f" toggles finished; arrows move card focus
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){ if(!document.getElementById("help").hidden) toggleHelp(false); else if(openId) closeDrawer(); return; }
  if(openId) return;
  const tag=((document.activeElement&&document.activeElement.tagName)||"").toLowerCase();
  if(tag==="input"||tag==="textarea") return;            // don't hijack typing
  if(e.key==="/"||e.code==="Slash"){ e.preventDefault(); document.getElementById("search").focus(); }
  else if(e.key==="f"||e.key==="F"||e.code==="KeyF"){ const cb=document.getElementById("showDone"); cb.checked=!cb.checked;
    showDone=cb.checked; try{ localStorage.setItem("ct_showDone",showDone?"1":"0"); }catch(_){} render(); }
  else if(e.key.indexOf("Arrow")===0){ moveCardFocus(e); } });
document.getElementById("showDone").addEventListener("change",e=>{ showDone=e.target.checked;
  try{ localStorage.setItem("ct_showDone",showDone?"1":"0"); }catch(_){} render(); });
document.getElementById("langBtn").addEventListener("click",()=>setLang(lang==="en"?"he":"en"));
document.getElementById("app").addEventListener("click",e=>{ if(e.target.closest(".btn-demo")) setDemo(true);
  const rd=e.target.closest(".rdone"); if(rd){ e.stopPropagation(); toggleRoomDone(rd.dataset.s); } });
document.getElementById("exitDemoBtn").addEventListener("click",()=>setDemo(false));
document.getElementById("search").addEventListener("input",e=>{ searchQuery=e.target.value;
  clearTimeout(searchT); searchT=setTimeout(()=>render(),120); });   // client-side filter over the cached payload
document.getElementById("muteBtn").addEventListener("click",()=>setMuted(!muted));
document.getElementById("helpBtn").addEventListener("click",e=>{ e.stopPropagation(); toggleHelp(); });
document.addEventListener("click",e=>{ const h=document.getElementById("help");
  if(!h.hidden && !h.contains(e.target) && e.target.id!=="helpBtn") toggleHelp(false); });

function tickTimers(){ const now=Date.now(); document.querySelectorAll(".timer").forEach(el=>{
  const s=+el.dataset.start,en=+el.dataset.end,mt=+el.dataset.mtime,st=el.dataset.status,sess=el.dataset.session;
  let v;
  if(sess==="1") v=mt?(now-mt):null;                // conversation: time since last activity (active/idle)
  else if(!s){ el.textContent=fmt(null); return; }  // unknown start -> "--:--" instead of blank
  else if(st==="done"&&en) v=en-s;                  // finished: final duration
  else if(st==="stale") v=(mt&&mt>s)?(mt-s):null;   // idle/abandoned: freeze at last activity, not a runaway count to now
  else v=now-s;                                     // running: live
  el.textContent=fmt(v); }); }
// Skip the per-second DOM walk while the panel tab isn't visible (the user is
// looking at their code, not the office) -- times are recomputed when shown.
setInterval(()=>{ if(!document.hidden) tickTimers(); },1000);

let polling=false, failStreak=0;
function setConnected(ok){ const el=document.getElementById("reconnect");
  el.hidden=ok; if(!ok) el.textContent=t("reconnecting"); }
async function poll(){ if(polling) return;          // in-flight guard: never stack scans
  polling=true;
  try{ const ph=(location.search.match(/[?&]phase=(\\d{1,4})\\b/)||[])[1];   // forward a page-level ?phase to freeze a frame (screenshots)
    const q=demoMode?("?demo=1"+(ph?("&phase="+ph):"")):"";
    const r=await fetch(API_BASE+"/api/agents"+q,{cache:"no-store"});
    if(!r.ok) throw new Error("http "+r.status);
    render(await r.json()); failStreak=0; setConnected(true);
  }catch(e){ if(++failStreak>=2) setConnected(false); }   // show the banner only after a couple of misses
  finally{ polling=false; } }
applyLang(); poll();
// Poll only while the panel is visible; resume instantly (and refresh timers)
// when it's shown again. A hidden VS Code webview keeps running with
// retainContextWhenHidden, so without this it would poll every 1.5s forever.
setInterval(()=>{ if(!document.hidden) poll(); },POLL_MS);
document.addEventListener("visibilitychange",()=>{ if(!document.hidden){ poll(); tickTimers(); } });
function unlock(){ try{ audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)(); audioCtx.resume(); }catch(e){} }
window.addEventListener("click",unlock,{once:true}); window.addEventListener("keydown",unlock,{once:true});
</script>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype):
        data = body.encode("utf-8")
        try:
            self._write_response(code, ctype, data)
        except ConnectionError:
            # The client (browser) hung up mid-response -- e.g. it navigated away
            # or cancelled an in-flight poll. There's nothing left to write to;
            # swallow it quietly instead of dumping a traceback (degrade-not-crash).
            pass

    def _write_response(self, code, ctype, data):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        # CORS: allow ONLY a VS Code webview origin to read the API, so the
        # journals stay unreadable to an ordinary web page (the server is
        # loopback-only regardless). The VS Code extension embeds this page in a
        # WebviewPanel and fetches from here.
        origin = self.headers.get("Origin", "")
        if origin.startswith("vscode-webview://"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        # Defense-in-depth: even though every sink is escaped and we bind to
        # loopback, a restrictive CSP keeps a future regression from exfiltrating
        # journal text or loading remote code. 'unsafe-inline' is unavoidable
        # because the single-file design inlines all script/style in PAGE.
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; "
            "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
            "connect-src 'self'; base-uri 'none'; form-action 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        # Identity header: lets the VS Code extension confirm it is talking to the
        # real server (not some other process squatting the port) before it embeds
        # the page in a scripts-enabled webview.
        self.send_header("X-Claude-Theater", __version__)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        # DNS-rebinding guard: a loopback bind + CORS still let a malicious page
        # rebind its own hostname to 127.0.0.1 and read /api/agents *same-origin*
        # (no CORS check applies). Rejecting any non-loopback Host closes that --
        # the rebound request carries the attacker's hostname in Host. An empty
        # Host (HTTP/1.0 local clients) is allowed; browsers always send one.
        host = (urlsplit("//" + self.headers.get("Host", "")).hostname or "").lower()
        if host and host not in ("localhost", "127.0.0.1", "::1"):
            self._send(403, "forbidden", "text/plain; charset=utf-8")
            return
        path = self.path.split("?", 1)[0]   # route on the path; query (?demo=1) is read separately
        if path == "/api/agents":
            try:
                # --demo forces demo for the whole process; ?demo=1 lets the
                # empty-office "Watch a demo" button (and a shareable URL) pull
                # the synthetic office on demand. Both stay read-only and local:
                # demo_payload() never touches the real journals either way.
                _q = parse_qs(urlsplit(self.path).query)
                want_demo = DEMO or _q.get("demo", [""])[0] == "1"
                if want_demo:
                    _ph = _q.get("phase", [""])[0]
                    # bound the length so a huge digit string can't force an O(n^2)
                    # int parse on Python < 3.11 (no int-str conversion limit there)
                    payload = demo_payload(int(_ph) if (_ph.isdigit() and len(_ph) <= 4) else None)
                else:
                    payload = scan_agents()
                body = json.dumps(payload, ensure_ascii=False)
            except Exception as e:
                # Keep detail server-side only; the response can reach a local
                # process or a pasted screenshot, and str(e) may embed the home path.
                print("!! scan error:", repr(e))
                body = json.dumps({"error": "scan failed"})
            self._send(200, body, "application/json; charset=utf-8")
        elif path == "/" or path.startswith("/index"):
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif path == "/favicon.ico":
            # Browsers auto-request this; answer 204 so it isn't a console 404 on every load.
            self._send(204, "", "image/x-icon")
        else:
            self._send(404, "not found", "text/plain; charset=utf-8")


USAGE = """Claude Theater %s - a live office of your Claude Code subagents.

Usage: claude-theater [options]

  --demo         show a synthetic, populated office (reads no real journals)
  --no-browser   do not open the browser on start
  --port N       listen on port N (default %d; or set CLAUDE_THEATER_PORT)
  --version,-V   print version and exit
  --help,-h      show this help and exit

Then open http://localhost:%d
"""


class TheaterServer(ThreadingHTTPServer):
    # On Windows, SO_REUSEADDR lets a second process silently bind a port that's
    # already in use (and the OS load-balances between them) -- so a stray second
    # copy would serve different data with no error. Disabling reuse there makes a
    # duplicate bind fail loudly instead; POSIX keeps it on to avoid TIME_WAIT
    # restart pain.
    allow_reuse_address = (os.name != "nt")


def _arg_port(args):
    """--port N overrides CLAUDE_THEATER_PORT / the default; falls back on bad input."""
    if "--port" in args:
        try:
            v = int(args[args.index("--port") + 1])
            if 0 < v < 65536:
                return v
        except (IndexError, ValueError):
            pass
        print("!! --port needs a number 1-65535; using %d" % PORT, flush=True)
    return PORT


def main():
    global DEMO
    args = sys.argv[1:]
    if "--version" in args or "-V" in args:
        print("claude-theater %s" % __version__)
        return
    if "--help" in args or "-h" in args:
        print(USAGE % (__version__, PORT, PORT))
        return

    DEMO = "--demo" in args
    no_browser = "--no-browser" in args or bool(os.environ.get("CLAUDE_THEATER_NO_BROWSER"))
    port = _arg_port(args)

    if not DEMO:
        has_journals = os.path.isdir(PROJECTS_DIR) and any(
            glob.glob(os.path.join(PROJECTS_DIR, "*", "*.jsonl")))
        if not has_journals:
            print("!! No Claude Code journals found under %s." % PROJECTS_DIR, flush=True)
            print("   Try `claude-theater --demo` for a synthetic office, or start a "
                  "Claude Code session first.", flush=True)

    try:
        srv = TheaterServer(("127.0.0.1", port), Handler)
    except OSError as e:
        print("!! Could not start on 127.0.0.1:%d (%s)." % (port, getattr(e, "strerror", None) or e), flush=True)
        print("   Another copy may already be running. Start it on another port:", flush=True)
        print("   claude-theater --port %d   (or set CLAUDE_THEATER_PORT)" % (port + 1), flush=True)
        sys.exit(1)

    url = "http://localhost:%d" % port
    print("Claude Theater %s%s -> %s   (Ctrl+C to stop)" % (__version__, " [demo]" if DEMO else "", url), flush=True)
    print("Demo mode: synthetic office, no real journals are read." if DEMO else "Watching: " + PROJECTS_DIR, flush=True)
    # Open the browser only after the socket is bound (no first-load race), and
    # so pipx/pip users get the same one-click UX as start.cmd.
    if not no_browser:
        try:
            import webbrowser
            webbrowser.open(url)
        except Exception:
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
