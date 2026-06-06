# -*- coding: utf-8 -*-
"""
Claude Theater - a live, grouped office of your Claude Code subagents.

Reads the per-agent journal files Claude Code writes under
  ~/.claude/projects/<encoded-cwd>/<session-id>/subagents/**/agent-*.jsonl
and serves a small web page. Agents are grouped into a "room" per conversation
(session). Each agent is a compact character: avatar + tiny name + live status +
timer. Click a character to see its full task and full result. Finished agents
are hidden by default (a count stays in the room header).

Run:  python theater.py     (start.cmd does this and opens the browser)
Then: http://localhost:7333

Pure stdlib. No pip installs.
"""
import json
import os
import glob
import time
import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 7333
MAX_AGE_MIN = 180          # only show agents whose file changed in the last N minutes
RUNNING_STALE_SEC = 90     # a "running" agent untouched this long is shown as idle

PROJECTS_DIR = os.path.join(os.path.expanduser("~"), ".claude", "projects")

# Claude Code versions this parser was tested against (major.minor only).
# Any other version seen at runtime raises a non-blocking banner.
KNOWN_CC_VERSIONS = ("2.1",)
# Shown when an agent's first record carries no usable task description.
UNKNOWN_TASK = "עובד — פרטים לא זמינים"

PERSONAS = [
    ("הבלש", "🕵️"), ("הסופר", "✍️"), ("השליח", "🏃"), ("החוקר", "🔬"),
    ("הספרן", "📚"), ("הנווט", "🧭"), ("הצופה", "🔭"), ("הבנאי", "🔨"),
    ("הקוסם", "🪄"), ("הצייד", "🎯"), ("הינשוף", "🦉"), ("השועל", "🦊"),
    ("הדבורה", "🐝"), ("הרובוט", "🤖"), ("הנמר", "🐯"), ("הנשר", "🦅"),
]

TOOL_ACTIVITY = {
    "WebSearch": "🔍 מחפש", "WebFetch": "🌐 קורא דף", "Read": "📖 קורא",
    "Edit": "✏️ עורך", "Write": "✏️ כותב", "NotebookEdit": "✏️ מחברת",
    "Bash": "⚙️ פקודה", "PowerShell": "⚙️ פקודה", "Grep": "🔎 מחפש קוד",
    "Glob": "🔎 קבצים", "Task": "👥 סוכן", "Agent": "👥 סוכן",
    "TodoWrite": "📝 משימות", "Skill": "🧩 מיומנות", "StructuredOutput": "🧾 מסכם",
}
DEFAULT_ACTIVITY = "🤔 חושב"
DONE_ACTIVITY = "✅ סיים"
STALE_ACTIVITY = "💤 ממתין"


def persona_for(agent_id):
    h = 0
    for ch in agent_id:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return PERSONAS[h % len(PERSONAS)]


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


def detect_done(events):
    last = None
    for ev in reversed(events):
        if ev.kind in ("assistant", "user"):
            last = ev
            break
    if last is None or last.kind != "assistant":
        return False, None, None
    has_tool = bool(last.tool_uses)
    done = (not has_tool) and (last.stop_reason in ("end_turn", "stop", "stop_sequence", "max_tokens"))
    if done:
        full = " ".join(last.text.split())
        if len(full) > 4000:
            full = full[:4000] + "…"
        return True, last.ts_ms, full
    return False, None, None


def major_minor(version):
    parts = (version or "").split(".")
    return ".".join(parts[:2]) if len(parts) >= 2 else (version or "")


def version_banner(versions):
    """Non-blocking banner text when a version outside KNOWN_CC_VERSIONS appears."""
    unknown = sorted({major_minor(v) for v in versions if major_minor(v) not in KNOWN_CC_VERSIONS})
    if not unknown:
        return None
    return ("נבדק עד Claude Code %s · זוהתה גרסה %s — ייתכן שהתצוגה חלקית"
            % (KNOWN_CC_VERSIONS[-1], ", ".join(unknown)))


_NAME_CACHE = {}  # parent_file -> (mtime, {prompt: {description, subagent_type}})


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
                        prompt = inp.get("prompt")
                        if prompt:
                            m[prompt.strip()] = {
                                "description": inp.get("description", "") or "",
                                "subagent_type": inp.get("subagent_type", "") or "",
                            }
    except Exception:
        pass
    _NAME_CACHE[parent_file] = (mtime, m)
    return m


def extract_task(first_ev):
    return first_ev.text if first_ev else ""


def short_task(task):
    task = " ".join(task.split())
    for sep in (". ", "? ", "! ", ": "):
        idx = task.find(sep)
        if 0 < idx < 90:
            return task[:idx + 1].strip()
    return task[:90].strip() + "…" if len(task) > 90 else task


def scan_agents():
    now = time.time()
    pattern = os.path.join(PROJECTS_DIR, "**", "agent-*.jsonl")
    agents = []
    versions = set()
    skipped = 0
    try:
        paths = glob.glob(pattern, recursive=True)
    except Exception:
        paths = []
    for path in paths:
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        if (now - mtime) / 60.0 > MAX_AGE_MIN:
            continue

        try:
            first_ev = parse_agent_event(read_first_line(path))
        except Exception:
            first_ev = None
        if first_ev is None:
            skipped += 1
            continue
        if first_ev.version:
            versions.add(first_ev.version)

        agent_id = first_ev.raw.get("agentId") or os.path.basename(path)[6:-6]
        session = first_ev.raw.get("sessionId", "") or ""
        start_ms = first_ev.ts_ms
        task = extract_task(first_ev)

        try:
            events, n_skip, vers = parse_events(read_tail_lines(path))
        except Exception:
            events, n_skip, vers = [], 0, set()
        skipped += n_skip
        versions |= vers

        is_done, end_ms, result = detect_done(events)
        tool = last_tool_use_name(events)

        if is_done:
            status, activity = "done", DONE_ACTIVITY
        elif (now - mtime) > RUNNING_STALE_SEC:
            status, activity = "stale", STALE_ACTIVITY
        else:
            status, activity = "running", TOOL_ACTIVITY.get(tool, DEFAULT_ACTIVITY)

        name, emoji = persona_for(agent_id)
        info = name_map_for(parent_session_file(path, session)).get(task.strip()) if task.strip() else None
        # degrade-not-crash: an agent with no readable task still shows up.
        task_disp = task if task.strip() else UNKNOWN_TASK
        agents.append({
            "id": agent_id, "name": name, "emoji": emoji,
            "role": info["description"] if info else "",
            "subagent_type": info["subagent_type"] if info else "",
            "status": status, "activity": activity, "tool": tool or "",
            "task": task_disp, "task_short": short_task(task_disp), "result": result,
            "start_ms": start_ms, "end_ms": end_ms,
            "session": session[:8], "session_full": session,
            "cwd": first_ev.raw.get("cwd", ""), "mtime_ms": int(mtime * 1000),
        })

    order = {"running": 0, "stale": 1, "done": 2}
    agents.sort(key=lambda a: (order.get(a["status"], 3), -(a["start_ms"] or 0)))
    return {
        "agents": agents,
        "versions": sorted(versions),
        "banner": version_banner(versions),
        "skipped": skipped,
    }


PAGE = """<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>משרד הסוכנים</title>
<style>
  :root{ color-scheme:dark; }
  *{ box-sizing:border-box; }
  body{ margin:0; font-family:"Segoe UI","Arial Hebrew",system-ui,sans-serif; color:#e8ecff;
        background:radial-gradient(1100px 500px at 50% -10%,#1a2440,#0b1020 60%); }
  header{ display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:11px 20px;
          border-bottom:1px solid #1d2746; position:sticky; top:0; z-index:40;
          background:rgba(8,11,22,.85); backdrop-filter:blur(8px); }
  header h1{ font-size:17px; margin:0; }
  .counts span{ display:inline-block; padding:2px 10px; border-radius:999px; margin-left:6px; font-size:12px; }
  .c-run{ background:#16331f; color:#7ee29a; } .c-done{ background:#262b46; color:#9fb0e6; }
  .spacer{ flex:1; }
  header label{ font-size:12.5px; color:#a8b2da; display:flex; align-items:center; gap:6px; cursor:pointer; }
  .banner{ margin:0; padding:7px 20px; font-size:12.5px; text-align:center;
           background:#3a2d12; color:#e6c98a; border-bottom:1px solid #5a4a20; }
  .banner[hidden]{ display:none; }

  #app{ padding:16px 18px 60px; display:flex; flex-direction:column; gap:14px; }
  .empty{ text-align:center; color:#6b78a8; font-size:15px; padding:60px 10px; }

  .room{ background:linear-gradient(180deg,#121a30,#0e1426); border:1px solid #20294a; border-radius:14px; overflow:hidden; }
  .rh{ display:flex; align-items:center; gap:10px; padding:8px 14px; background:rgba(255,255,255,.03);
       border-bottom:1px solid #1b2440; font-size:12.5px; }
  .rt{ font-weight:700; color:#e2e8ff; } .rt small{ color:#7886b6; font-weight:400; margin-right:6px; }
  .rc{ color:#9aa6d4; display:flex; gap:9px; }
  .rc b{ color:#7ee29a; } .rc i{ font-style:normal; color:#e0c07e; } .rc u{ text-decoration:none; color:#8f9ccb; }
  .floor{ display:flex; flex-wrap:wrap; gap:4px; padding:13px 12px 16px;
          background:linear-gradient(180deg,transparent 0 60%,rgba(0,0,0,.18)),
                     repeating-linear-gradient(90deg,rgba(255,255,255,.014) 0 42px,transparent 42px 84px); }

  .ws{ position:relative; width:92px; display:flex; flex-direction:column; align-items:center; gap:1px;
       padding:4px 3px 8px; border-radius:10px; cursor:pointer; transition:background .15s,transform .15s; }
  .ws:hover{ background:rgba(255,255,255,.06); transform:translateY(-2px); }

  /* ---- animated character sitting at a desk ---- */
  .scene{ position:relative; width:84px; height:66px; }
  .guy{ position:absolute; left:50%; bottom:14px; transform:translateX(-50%); width:40px; height:44px; z-index:1; }
  .torso{ position:absolute; left:50%; bottom:0; transform:translateX(-50%); width:26px; height:22px;
          border-radius:11px 11px 5px 5px; background:var(--c1,#5566cc); box-shadow:inset 0 -3px 0 rgba(0,0,0,.18); }
  .head{ position:absolute; left:50%; bottom:16px; transform:translateX(-50%); font-size:25px; line-height:1;
         filter:drop-shadow(0 3px 3px rgba(0,0,0,.4)); transform-origin:50% 90%; }
  .desk{ position:absolute; left:50%; bottom:4px; transform:translateX(-50%); width:64px; height:15px; z-index:2;
         border-radius:4px; background:linear-gradient(180deg,#9a6739,#5f3c1d); box-shadow:0 4px 6px rgba(0,0,0,.45); }
  .screen{ position:absolute; left:50%; bottom:19px; transform:translateX(-50%); width:15px; height:11px; z-index:2;
           border-radius:1px; background:#05070f; border:1px solid #1b2440; }
  .hands{ position:absolute; left:50%; bottom:13px; transform:translateX(-50%); width:42px; height:10px; z-index:3; }
  .hand{ position:absolute; bottom:0; width:8px; height:8px; border-radius:50%; background:#f2c79a;
         box-shadow:0 1px 2px rgba(0,0,0,.4); }
  .hand.l{ left:5px; } .hand.r{ right:5px; }

  .ws.running .head{ animation:hbob 1s ease-in-out infinite; }
  @keyframes hbob{ 0%,100%{transform:translateX(-50%) translateY(0)} 50%{transform:translateX(-50%) translateY(-2px)} }
  .ws.running .hand.l{ animation:tap .3s ease-in-out infinite; }
  .ws.running .hand.r{ animation:tap .3s ease-in-out infinite .15s; }
  @keyframes tap{ 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
  .ws.running .screen{ background:#0c2; box-shadow:0 0 7px #1f8a4d; animation:blink 1s steps(2) infinite; }
  @keyframes blink{ 50%{opacity:.5} }
  .ws.done .screen{ background:#0a2f1c; box-shadow:0 0 6px #1c5; }

  .ws.stale .guy{ filter:grayscale(.6) brightness(.62); }
  .ws.stale .head{ animation:sway 3s ease-in-out infinite; }
  @keyframes sway{ 0%,100%{transform:translateX(-50%) rotate(-7deg)} 50%{transform:translateX(-50%) rotate(7deg)} }

  .ws.justdone .head{ animation:hop .7s cubic-bezier(.2,1.4,.4,1); }
  @keyframes hop{ 0%{transform:translateX(-50%) translateY(0)} 30%{transform:translateX(-50%) translateY(-16px)}
                  100%{transform:translateX(-50%) translateY(0)} }
  .ws.justdone .hands{ animation:cheer .7s ease; }
  @keyframes cheer{ 0%{transform:translateX(-50%) translateY(0)} 40%{transform:translateX(-50%) translateY(-13px)}
                    100%{transform:translateX(-50%) translateY(0)} }
  .name{ font-size:11px; color:#dde4ff; max-width:84px; overflow:hidden; text-overflow:ellipsis;
         white-space:nowrap; margin-top:3px; }
  .act{ font-size:10px; color:#8fa2dd; height:13px; max-width:86px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ws.done .act{ color:#86b58f; } .ws.stale .act{ color:#c9a86a; }
  .timer{ font-size:9.5px; color:#8893bd; direction:ltr; }

  .ws.entering{ animation:walkin .7s ease-out; }
  @keyframes walkin{ 0%{opacity:0; transform:translateX(-66px)} 60%{opacity:1} 100%{opacity:1; transform:translateX(0)} }
  .ws.entering .guy{ animation:step .18s ease-in-out 3; }
  @keyframes step{ 0%,100%{transform:translateX(-50%) translateY(0)} 50%{transform:translateX(-50%) translateY(-3px)} }
  .burst{ position:absolute; inset:0; pointer-events:none; overflow:visible; }
  .confetti{ position:absolute; top:6px; font-size:15px; animation:fall 1.1s ease-out forwards; }
  @keyframes fall{ from{transform:translateY(-6px) scale(.6); opacity:1} to{transform:translateY(70px) rotate(200deg); opacity:0} }

  #backdrop{ position:fixed; inset:0; background:rgba(3,5,12,.55); z-index:60; opacity:0; pointer-events:none; transition:opacity .2s; }
  #backdrop.show{ opacity:1; pointer-events:auto; }
  #drawer{ position:fixed; top:0; right:0; height:100%; width:min(440px,92vw); z-index:70; background:#0f1426;
           border-left:1px solid #243056; box-shadow:-12px 0 40px rgba(0,0,0,.5); transform:translateX(105%);
           transition:transform .26s cubic-bezier(.3,.9,.3,1); display:flex; flex-direction:column; }
  #drawer.open{ transform:translateX(0); }
  .dhead{ display:flex; align-items:center; gap:12px; padding:16px 16px 12px; border-bottom:1px solid #1d2746; }
  .dhead .av{ font-size:34px; } .dhead .nm{ font-size:17px; font-weight:700; } .dhead .ro{ font-size:12px; color:#9aa6d4; margin-top:2px; }
  #dclose{ margin-right:auto; background:#1a2138; border:1px solid #2a345c; color:#cdd6f6; border-radius:8px; width:30px; height:30px; cursor:pointer; }
  #dbody{ padding:14px 16px; overflow:auto; }
  #dbody .row{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
  #dbody .chip{ font-size:11px; padding:3px 9px; border-radius:999px; background:#1a2138; color:#aeb9e6; border:1px solid #283156; }
  #dbody h3{ font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:#7886b6; margin:15px 0 6px; }
  #dbody .box{ background:#0a0f1e; border:1px solid #1b2440; border-radius:10px; padding:11px 12px; font-size:13px;
               line-height:1.6; color:#d4dcf6; white-space:pre-wrap; max-height:40vh; overflow:auto; }
  #dbody .box.ltr{ direction:ltr; text-align:left; }
</style>
</head>
<body>
<header>
  <h1>🏢 משרד הסוכנים</h1>
  <div class="counts" id="counts"></div>
  <div class="spacer"></div>
  <label><input type="checkbox" id="showDone"> הצג שהושלמו</label>
</header>
<div id="banner" class="banner" hidden></div>
<div id="app"><div class="empty">המשרד ריק… הפעילו סוכן ב-Claude Code. 🚪</div></div>

<div id="backdrop"></div>
<aside id="drawer">
  <div class="dhead"><div class="av" id="dav"></div>
    <div><div class="nm" id="dnm"></div><div class="ro" id="dro"></div></div>
    <button id="dclose">✕</button></div>
  <div id="dbody"></div>
</aside>

<script>
const POLL_MS=1500;
const rooms={};   // session_full -> {section, floor, rt, rc}
const els={};     // id -> {root, refs, data, status}
const prevStatus={};
let audioCtx=null, showDone=false, openId=null;

function esc(s){ return (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function fmt(ms){ if(ms==null||ms<0) return "--:--"; const s=Math.floor(ms/1000),m=Math.floor(s/60),x=s%60;
  return String(m).padStart(2,"0")+":"+String(x).padStart(2,"0"); }
function baseName(p){ return (p||"").replace(/[\\\\/]+$/,"").split(/[\\\\/]/).pop()||"—"; }
function roomLabel(a){ return baseName(a.cwd); }
const COLORS=["#5b6ee0","#e07a5b","#3fae74","#c45bd0","#e0b84a","#4ab3c4","#d05b7a","#7a86b8"];
function colorFor(id){ let h=0; for(let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0; return COLORS[h%COLORS.length]; }

function ding(){ try{ audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
  const t=audioCtx.currentTime;
  [880,1320].forEach((f,i)=>{ const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type="sine"; o.frequency.value=f; o.connect(g); g.connect(audioCtx.destination);
    const s=t+i*0.12; g.gain.setValueAtTime(0.0001,s); g.gain.exponentialRampToValueAtTime(0.25,s+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,s+0.35); o.start(s); o.stop(s+0.4); }); }catch(e){} }

function confetti(root){ const b=document.createElement("div"); b.className="burst";
  const em=["🎉","✨","🎊","⭐","✅"];
  for(let i=0;i<10;i++){ const c=document.createElement("div"); c.className="confetti"; c.textContent=em[i%em.length];
    c.style.left=(8+Math.random()*78)+"%"; c.style.animationDelay=(Math.random()*0.3)+"s"; b.appendChild(c); }
  root.appendChild(b); setTimeout(()=>b.remove(),1400); }

function createWS(a){ const root=document.createElement("div"); root.className="ws "+a.status;
  root.style.setProperty("--c1", colorFor(a.id));
  root.innerHTML=
    '<div class="scene"><div class="guy"><div class="torso"></div><div class="head"></div></div>'+
    '<div class="desk"></div><i class="screen"></i>'+
    '<div class="hands"><i class="hand l"></i><i class="hand r"></i></div></div>'+
    '<div class="name"></div><div class="act"></div><div class="timer"></div>';
  const refs={ head:root.querySelector(".head"), name:root.querySelector(".name"),
               act:root.querySelector(".act"), timer:root.querySelector(".timer") };
  root.addEventListener("click",()=>openDrawer(a.id));
  root.classList.add("entering"); setTimeout(()=>root.classList.remove("entering"),750);
  return { root, refs, data:a, status:null }; }

function updateWS(e,a){ e.data=a;
  if(e.status!==a.status) e.root.className="ws "+a.status;
  e.refs.head.textContent=a.emoji;
  e.refs.name.textContent=a.role||a.name; e.refs.name.title=a.role||a.name;
  e.refs.act.textContent=a.activity;
  e.refs.timer.dataset.start=a.start_ms||0; e.refs.timer.dataset.end=a.end_ms||0; e.refs.timer.dataset.status=a.status;
  if(prevStatus[a.id] && prevStatus[a.id]!=="done" && a.status==="done"){
    e.root.classList.add("justdone"); confetti(e.root); ding(); setTimeout(()=>e.root.classList.remove("justdone"),900); }
  prevStatus[a.id]=a.status; e.status=a.status;
  if(openId===a.id) fillDrawer(a); }

function ensureRoom(sess){ let r=rooms[sess]; if(r) return r;
  const section=document.createElement("section"); section.className="room";
  section.innerHTML='<div class="rh"><span class="rt"></span><span class="spacer"></span><span class="rc"></span></div><div class="floor"></div>';
  r={ section, floor:section.querySelector(".floor"), rt:section.querySelector(".rt"), rc:section.querySelector(".rc") };
  rooms[sess]=r; return r; }

function render(payload){
  const all=(payload&&payload.agents)||[];
  const bn=document.getElementById("banner");
  if(payload&&payload.banner){ bn.textContent="⚠ "+payload.banner; bn.hidden=false; }
  else bn.hidden=true;
  const app=document.getElementById("app");
  const em=app.querySelector(".empty"); if(em) em.remove();

  // per-session stats from ALL agents (so the header can show ✓done even when hidden)
  const stat={};
  for(const a of all){ const s=a.session_full; const v=stat[s]||(stat[s]={run:0,stale:0,done:0,label:roomLabel(a),sid:a.session,mtime:0});
    v[a.status]++; v.mtime=Math.max(v.mtime,a.mtime_ms||0); }

  const visible = showDone ? all : all.filter(a=>a.status!=="done");
  const sess=[...new Set(visible.map(a=>a.session_full))];
  sess.sort((x,y)=>((stat[y].run>0)-(stat[x].run>0))||(stat[y].mtime-stat[x].mtime));

  // drop workers no longer visible
  const need=new Set(visible.map(a=>a.id));
  for(const id in els){ if(!need.has(id)){ els[id].root.remove(); delete els[id]; } }

  for(const s of sess){ const r=ensureRoom(s); app.appendChild(r.section);
    const st=stat[s];
    r.rt.innerHTML='💬 '+esc(st.label)+' <small>'+esc(st.sid)+'</small>';
    r.rc.innerHTML='🟢 <b>'+st.run+'</b>'+(st.stale?' · <i>⏳'+st.stale+'</i>':'')+(st.done?' · <u>✓'+st.done+'</u>':'');
    for(const a of visible){ if(a.session_full!==s) continue;
      let e=els[a.id]; if(!e){ e=createWS(a); els[a.id]=e; r.floor.appendChild(e.root); }
      else if(e.root.parentElement!==r.floor){ r.floor.appendChild(e.root); }
      updateWS(e,a); } }

  for(const s in rooms){ if(!sess.includes(s)){ rooms[s].section.remove(); delete rooms[s]; } }
  if(!visible.length){ const d=document.createElement("div"); d.className="empty";
    d.textContent=showDone?"אין סוכנים בחלון הזמן.":"אין סוכנים פעילים. סמנו \\"הצג שהושלמו\\" כדי לראות היסטוריה."; app.appendChild(d); }

  const run=all.filter(a=>a.status==="running").length, done=all.filter(a=>a.status==="done").length;
  document.getElementById("counts").innerHTML='<span class="c-run">🟢 '+run+' עובדים</span><span class="c-done">✅ '+done+' סיימו</span>';
}

function fillDrawer(a){ document.getElementById("dav").textContent=a.emoji;
  document.getElementById("dnm").textContent=a.name; document.getElementById("dro").textContent=a.role||a.task_short||"";
  const now=Date.now(); const dur=(a.status==="done"&&a.end_ms)?(a.end_ms-a.start_ms):(now-(a.start_ms||now));
  const stx=a.status==="running"?"עובד":a.status==="done"?"סיים":"ממתין";
  let h='<div class="row"><span class="chip">'+esc(stx)+'</span>'+
    (a.subagent_type?'<span class="chip">'+esc(a.subagent_type)+'</span>':'')+
    '<span class="chip">'+(a.status==="done"?"משך ":"זמן ")+fmt(dur)+'</span>'+
    (a.tool?'<span class="chip">'+esc(a.tool)+'</span>':'')+'</div>';
  h+='<h3>פעולה</h3><div class="box">'+esc(a.activity)+'</div>';
  h+='<h3>משימה</h3><div class="box ltr">'+esc(a.task||"(אין)")+'</div>';
  if(a.result) h+='<h3>תוצאה</h3><div class="box ltr">'+esc(a.result)+'</div>';
  document.getElementById("dbody").innerHTML=h; }
function openDrawer(id){ const e=els[id]; if(!e) return; openId=id; fillDrawer(e.data);
  document.getElementById("drawer").classList.add("open"); document.getElementById("backdrop").classList.add("show"); }
function closeDrawer(){ openId=null; document.getElementById("drawer").classList.remove("open"); document.getElementById("backdrop").classList.remove("show"); }
document.getElementById("dclose").addEventListener("click",closeDrawer);
document.getElementById("backdrop").addEventListener("click",closeDrawer);
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeDrawer(); });
document.getElementById("showDone").addEventListener("change",e=>{ showDone=e.target.checked; poll(); });

setInterval(()=>{ const now=Date.now(); document.querySelectorAll(".timer").forEach(el=>{
  const s=+el.dataset.start,en=+el.dataset.end,st=el.dataset.status; if(!s) return;
  el.textContent=fmt((st==="done"&&en)?(en-s):(now-s)); }); },1000);

async function poll(){ try{ const r=await fetch("/api/agents",{cache:"no-store"}); render(await r.json()); }catch(e){} }
poll(); setInterval(poll,POLL_MS);
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
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/agents"):
            try:
                body = json.dumps(scan_agents(), ensure_ascii=False)
            except Exception as e:
                body = json.dumps({"error": str(e)})
            self._send(200, body, "application/json; charset=utf-8")
        elif self.path == "/" or self.path.startswith("/index"):
            self._send(200, PAGE, "text/html; charset=utf-8")
        else:
            self._send(404, "not found", "text/plain; charset=utf-8")


def main():
    if not os.path.isdir(PROJECTS_DIR):
        print("!! projects dir not found:", PROJECTS_DIR)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Claude Theater -> http://localhost:%d   (Ctrl+C to stop)" % PORT)
    print("Watching:", PROJECTS_DIR)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\\nbye")


if __name__ == "__main__":
    main()
