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

// Small standalone page shown in the side panel while the local server is still
// coming up (or if Python is missing). Stays inside the strict-CSP webview.
function waitingHtml(port) {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">` +
    `<style>body{font-family:'Segoe UI',system-ui,sans-serif;color:#9aa4cc;background:#0b1020;` +
    `display:flex;flex-direction:column;align-items:center;justify-content:center;` +
    `min-height:100vh;margin:0;text-align:center;padding:0 18px}` +
    `h2{font-size:15px;margin:0 0 6px;color:#e8ecff}p{font-size:12px;margin:0 0 16px;line-height:1.5}` +
    `button{background:#3651e8;color:#fff;border:0;border-radius:6px;padding:8px 16px;font-size:12px;cursor:pointer}</style>` +
    `</head><body>` +
    `<div style="font-size:40px;margin-bottom:8px">🎭</div>` +
    `<h2>Claude Theater</h2>` +
    `<p>The server isn't running on port ${port} yet.<br>Make sure Python is installed, then retry.</p>` +
    `<button id="retry">Retry</button>` +
    `<script>const v=acquireVsCodeApi();document.getElementById('retry').onclick=function(){v.postMessage({type:'retry'})};</script>` +
    `</body></html>`
  );
}

// The office now lives as a docked WebviewView (a side panel that sits beside the
// editor — the user can drag it to the secondary/right side bar), not an editor tab.
class TheaterViewProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
    this._errored = false;
  }
  async resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((m) => {
      if (m && m.type === "retry") this.render();
    });
    // If the server only came up after we showed the waiting page, re-render once
    // the panel is revealed again instead of leaving the user stuck on "Retry".
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this._errored) this.render();
    });
    await this.render();
  }
  async render() {
    const webviewView = this.view;
    if (!webviewView) return;
    const { port } = cfg();

    let up = await isUp(port);
    if (!up) up = await ensureRunning(this.context);
    if (!up) {
      this._errored = true;
      webviewView.webview.html = waitingHtml(port);
      return;
    }

    let page;
    try {
      page = (await httpGet(port, "/", 3000)).body;
    } catch (e) {
      this._errored = true;
      webviewView.webview.html = waitingHtml(port);
      return;
    }
    this._errored = false;
    webviewView.webview.html = buildWebviewHtml(page, port);
    await refreshStatus();
  }
}

let theaterProvider = null;

// Reveal the side panel (focus its view), starting the server first if needed.
async function openTheater(context) {
  await ensureRunning(context);
  // `<viewId>.focus` is auto-registered by VS Code for contributed views; this
  // opens the container and triggers resolveWebviewView → render on first use.
  try {
    await vscode.commands.executeCommand("claudeTheater.view.focus");
  } catch (_) {}
  if (theaterProvider) await theaterProvider.render();
}

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = "claudeTheater.menu";
  statusItem.text = "$(broadcast) Theater";
  statusItem.show();
  theaterProvider = new TheaterViewProvider(context);
  context.subscriptions.push(
    statusItem,
    vscode.window.registerWebviewViewProvider("claudeTheater.view", theaterProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
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
