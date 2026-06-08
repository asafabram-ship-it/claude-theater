// Claude Theater — VS Code extension.
// Runs the local theater server in the background (auto-start on launch, toggleable
// from a status-bar button) and opens the office inside a WebviewPanel (a full
// interactive webview, unlike Simple Browser): the server's HTML is embedded
// directly so clicks / focus / keyboard all work. Data is fetched by the webview
// from 127.0.0.1; the server returns CORS headers only to a vscode-webview:// origin
// and an identity header we verify, so the journals never leak to a web page.
const vscode = require("vscode");
const http = require("http");
const cp = require("child_process");
const path = require("path");
const fs = require("fs");

function cfg() {
  const c = vscode.workspace.getConfiguration("claudeTheater");
  // VS Code does NOT enforce the declared "type":"number" at read time, so a
  // workspace settings.json could supply a non-numeric port that we later
  // interpolate into a URL and the CSP. Coerce to a valid port or fall back.
  const rawPort = Number(c.get("port", 7333));
  const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 7333;
  return {
    port,
    autoStart: c.get("autoStart", true),
    pythonPath: (c.get("pythonPath", "") || "").trim(),
    serverScript: (c.get("serverScript", "") || "").trim(),
  };
}
const base = (port) => `http://127.0.0.1:${port}`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(port, p, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(base(port) + p, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs || 2000, () => req.destroy(new Error("timeout")));
  });
}

async function isUp(port) {
  try {
    const r = await httpGet(port, "/", 1500);
    // Require our identity header, so we never embed the page of some other
    // process that happens to be squatting the port into a scripts-enabled webview.
    return r.status === 200 && !!r.headers["x-claude-theater"];
  } catch (_) {
    return false;
  }
}

let spawnedProc = null;   // set only when WE started the server, so we only stop ours
let statusItem = null;

// Find a claude_theater.py we can run. Order: explicit config, the copy bundled in
// the .vsix (works standalone, no pip needed), then a source checkout next to the
// extension (F5/dev). Returns null to fall back to `python -m claude_theater` (pip).
function resolveServerScript(context, configured) {
  const candidates = [];
  if (configured) candidates.push(configured);
  candidates.push(path.join(context.extensionPath, "claude_theater.py"));
  candidates.push(path.join(context.extensionPath, "..", "claude_theater.py"));
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch (_) {}
  }
  return null;
}

async function startServer(context, port, pythonPath, serverScript) {
  const script = resolveServerScript(context, serverScript);
  const args = script ? [script, "--no-browser"] : ["-m", "claude_theater", "--no-browser"];
  const cwd = script ? path.dirname(script) : path.resolve(context.extensionPath, "..");
  const exes = pythonPath ? [pythonPath] : ["python", "py", "python3"];
  for (const exe of exes) {
    try {
      const proc = cp.spawn(exe, args, {
        cwd,
        env: { ...process.env, CLAUDE_THEATER_NO_BROWSER: "1" },
        windowsHide: true,
      });
      let died = false;
      proc.on("error", () => (died = true));
      for (let i = 0; i < 24 && !died; i++) {
        await delay(300);
        if (await isUp(port)) { spawnedProc = proc; return true; }
      }
      if (!died) { try { proc.kill(); } catch (_) {} }
    } catch (_) {
      // try the next interpreter
    }
  }
  return false;
}

function stopServer() {
  if (spawnedProc) {
    try { spawnedProc.kill(); } catch (_) {}
    spawnedProc = null;
  }
}

async function ensureRunning(context) {
  const { port, pythonPath, serverScript } = cfg();
  if (await isUp(port)) return true;
  return startServer(context, port, pythonPath, serverScript);
}

// ---- status bar ----
async function refreshStatus() {
  if (!statusItem) return;
  const { port, autoStart } = cfg();
  const up = await isUp(port);
  if (!autoStart) {
    statusItem.text = "$(circle-slash) Theater";
    statusItem.tooltip = "Claude Theater auto-start is off — click for options";
  } else if (up) {
    statusItem.text = "$(broadcast) Theater";
    statusItem.tooltip = "Claude Theater is running — click to open or for options";
  } else {
    statusItem.text = "$(debug-disconnect) Theater";
    statusItem.tooltip = "Claude Theater server is not running — click for options";
  }
  statusItem.show();
}

async function showMenu(context) {
  const { autoStart } = cfg();
  const items = [
    { label: "$(window) Open Theater", action: "open" },
    autoStart
      ? { label: "$(circle-slash) Disable auto-start", action: "disable" }
      : { label: "$(check) Enable auto-start", action: "enable" },
    { label: "$(refresh) Restart server", action: "restart" },
  ];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Claude Theater" });
  if (!pick) return;
  const conf = vscode.workspace.getConfiguration("claudeTheater");
  if (pick.action === "open") {
    await openTheater(context);
  } else if (pick.action === "disable") {
    await conf.update("autoStart", false, vscode.ConfigurationTarget.Global);
    stopServer();
    vscode.window.showInformationMessage("Claude Theater: auto-start disabled.");
  } else if (pick.action === "enable") {
    await conf.update("autoStart", true, vscode.ConfigurationTarget.Global);
    await ensureRunning(context);
    vscode.window.showInformationMessage("Claude Theater: auto-start enabled.");
  } else if (pick.action === "restart") {
    stopServer();
    await delay(300);
    await ensureRunning(context);
  }
  await refreshStatus();
}

function buildWebviewHtml(pageHtml, port) {
  const b = base(port);
  // Strict CSP: only our local server, inline CSS/JS (the page is our own trusted
  // single-file UI), data: images, and connect-src to the local API.
  const csp =
    `default-src 'none'; img-src ${b} data:; style-src 'unsafe-inline'; ` +
    `script-src 'unsafe-inline'; connect-src ${b} http://localhost:${port}; font-src ${b};`;
  const inject =
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<script>window.__CT_API_BASE__=${JSON.stringify(b)};</script>`;
  // place right after <head> so __CT_API_BASE__ exists before the page's own scripts run
  if (/<head[^>]*>/i.test(pageHtml)) {
    return pageHtml.replace(/<head[^>]*>/i, (m) => m + inject);
  }
  return inject + pageHtml;
}

async function openTheater(context) {
  const { port } = cfg();

  let up = await isUp(port);
  if (!up) {
    up = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Claude Theater: starting server…" },
      () => ensureRunning(context)
    );
  }
  if (!up) {
    const pick = await vscode.window.showErrorMessage(
      `Claude Theater server isn't running on port ${port}. Install Python, or set claudeTheater.serverScript / pythonPath.`,
      "Retry"
    );
    if (pick === "Retry") return openTheater(context);
    return;
  }

  let page;
  try {
    page = (await httpGet(port, "/", 3000)).body;
  } catch (e) {
    vscode.window.showErrorMessage("Claude Theater: failed to load the page from the server.");
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "claudeTheater",
    "Claude Theater",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = buildWebviewHtml(page, port);
  await refreshStatus();
}

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = "claudeTheater.menu";
  statusItem.text = "$(broadcast) Theater";
  statusItem.show();
  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand("claudeTheater.open", () => openTheater(context)),
    vscode.commands.registerCommand("claudeTheater.menu", () => showMenu(context))
  );

  // Auto-start the server in the background (the user chose: run quietly, open on demand).
  (async () => {
    if (cfg().autoStart) await ensureRunning(context);
    await refreshStatus();
  })();

  // keep the status icon honest if the server stops/starts outside the extension
  const iv = setInterval(refreshStatus, 8000);
  context.subscriptions.push({ dispose: () => clearInterval(iv) });
}

function deactivate() {
  stopServer();
}

module.exports = { activate, deactivate };
