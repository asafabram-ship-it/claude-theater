# -*- coding: utf-8 -*-
"""Cross-OS install smoke test.

Run AFTER installing the package (`pip install .` / the built wheel) to prove
the importable module actually serves: it starts the real Handler on an
ephemeral port, fetches `/` and `/api/agents`, and asserts HTTP 200. Pure
stdlib, no browser, no fixed port -- safe on CI runners.

    python tests/smoke_serve.py

Named `smoke_serve.py` (not `test_*.py`) so `unittest discover` does NOT pick it
up -- it must run explicitly, never as part of the headless unit suite.
"""
import http.client
import sys
import threading
from http.server import ThreadingHTTPServer

import claude_theater as ct


def main():
    assert callable(ct.main), "console-script entry claude_theater:main must be callable"
    srv = ThreadingHTTPServer(("127.0.0.1", 0), ct.Handler)  # port 0 = ephemeral
    port = srv.server_address[1]
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        for path in ("/", "/api/agents"):
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            conn.request("GET", path)
            resp = conn.getresponse()
            resp.read()
            conn.close()
            assert resp.status == 200, "%s -> HTTP %s" % (path, resp.status)
    finally:
        srv.shutdown()
    print("smoke OK: claude_theater %s served / and /api/agents on port %d" % (ct.__version__, port))


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print("SMOKE FAILED:", e)
        sys.exit(1)
