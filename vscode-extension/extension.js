// Claude Theater — VS Code extension.
// Opens the theater inside a WebviewPanel (a full interactive webview, unlike
// Simple Browser): the HTML is served by the local claude_theater.py process,
// embedded directly so clicks / focus / keyboard all work. Data is fetched by
// the webview from 127.0.0.1; the server only returns CORS headers to a
// vscode-webview:// origin, so the journals never become readable to a web page.
const vscode = require("vscode");
const http = require("http");
const cp = require("child_process");
const path = require("path");

function cfg() {
  const c = vscode.workspace.getConfiguration("claudeTheater");
  // VS Code does NOT enforce the declared "type":"number" at read time, so a
  // workspace settings.json could supply a non-numeric port that we later
  // interpolate into a URL and the CSP. Coerce to a valid port or fall back.
  const rawPort = Number(c.get("port", 7333));
  const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 7333;
  return {
    port,
    autoStart: c.get("autoStartServer", true),
    pythonPath: (c.get("pythonPath", "") || "").trim(),
  };
}
const base = (port) => `http://127.0.0.1:${port}`;

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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let spawnedProc = null; // only set when WE started the server, so we only stop ours

async function startServer(context, port, pythonPath) {
  // run from the repo root (parent of this extension) so `python -m claude_theater`
  // resolves the module from a source checkout; for a pip/pipx install it resolves anyway.
  const repoRoot = path.resolve(context.extensionPath, "..");
  const candidates = pythonPath ? [pythonPath] : ["python", "py", "python3"];
  for (const exe of candidates) {
    try {
      const proc = cp.spawn(exe, ["-m", "claude_theater", "--no-browser"], {
        cwd: repoRoot,
        env: { ...process.env, CLAUDE_THEATER_NO_BROWSER: "1" },
        windowsHide: true,
      });
      let died = false;
      proc.on("error", () => (died = true));
      // give it a moment to bind, then poll
      for (let i = 0; i < 24 && !died; i++) {
        await delay(300);
        if (await isUp(port)) {
          spawnedProc = proc;
          return true;
        }
      }
      if (!died) {
        try { proc.kill(); } catch (_) {}
      }
    } catch (_) {
      // try next candidate
    }
  }
  return false;
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
  const { port, autoStart, pythonPath } = cfg();

  let up = await isUp(port);
  if (!up && autoStart) {
    up = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Claude Theater: starting server…" },
      () => startServer(context, port, pythonPath)
    );
  }
  if (!up) {
    const pick = await vscode.window.showErrorMessage(
      `Claude Theater server isn't running on port ${port}. Start it with \`python -m claude_theater\`.`,
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
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeTheater.open", () => openTheater(context))
  );
}

function deactivate() {
  if (spawnedProc) {
    try { spawnedProc.kill(); } catch (_) {}
    spawnedProc = null;
  }
}

module.exports = { activate, deactivate };
