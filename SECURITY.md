# Security Policy

Claude Theater is a local-only visualizer. Its security posture is part of the
product, so this policy doubles as a short statement of how it protects you.

## Security & privacy posture

- **Local-only.** The server binds to `127.0.0.1` (loopback) — it is never
  exposed on your network.
- **Read-only.** It reads the journal files Claude Code already writes; it never
  modifies them and never starts, stops, or talks to your agents.
- **Nothing leaves your machine.** No telemetry, no analytics, no outbound
  network calls. Your conversations and code stay on your computer.
- **No third-party runtime dependencies.** A single standard-library Python file
  — a minimal supply-chain surface, easy to audit end to end.
- **Hardened endpoints.** Requests are checked against a loopback `Host`
  allowlist (DNS-rebinding protection), responses carry a strict
  `Content-Security-Policy` and `X-Content-Type-Options: nosniff`, and the API
  returns CORS headers only to a `vscode-webview://` origin plus an identity
  header — so an ordinary web page cannot read your journals.

## Supported versions

This is a `0.x` project; only the latest published version is supported.
Please reproduce on the latest release before reporting.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

1. Preferred: GitHub **private vulnerability reporting** — the
   *Security → Report a vulnerability* button on this repository.
2. Alternatively, email the maintainer at `asafabram@gmail.com` with the subject
   `claude-theater security`.

Please include reproduction steps, the affected version, and your OS / Python
version. I aim to acknowledge reports within a few days. Thank you for helping
keep the project safe.
