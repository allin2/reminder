#!/usr/bin/env python3
"""Use a disposable Chrome profile to click the production snooze button."""
import http.server
import json
import os
import pathlib
import subprocess
import tempfile
import threading
import time
import urllib.request

import websocket

ROOT = pathlib.Path(__file__).resolve().parents[4]
PORT, CDP = 19013, 19014
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(key, None)
os.environ["no_proxy"] = "*"
os.environ["NO_PROXY"] = "*"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = ROOT / (self.path.split("?", 1)[0].lstrip("/") or "index.html")
        if not path.is_file() or path.name == "sw.js":
            self.send_error(404)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(path.read_bytes())


class Client:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=20)
        self.next_id = 0

    def evaluate(self, expression):
        self.next_id += 1
        self.ws.send(json.dumps({
            "id": self.next_id,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "awaitPromise": True, "returnByValue": True},
        }))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == self.next_id:
                if message.get("result", {}).get("exceptionDetails"):
                    raise RuntimeError(message["result"]["exceptionDetails"])
                return message.get("result", {}).get("result", {}).get("value")


server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
with tempfile.TemporaryDirectory(prefix="p3ir-snooze-") as profile:
    process = subprocess.Popen([
        CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        f"--user-data-dir={profile}", f"--remote-debugging-port={CDP}",
        "--remote-allow-origins=*", "--no-first-run", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json"))
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError("Chrome CDP did not start")
        client = Client(next(tab for tab in tabs if tab.get("type") == "page")["webSocketDebuggerUrl"])
        client.evaluate(f"location.href='http://127.0.0.1:{PORT}/index.html';true")
        time.sleep(1.2)
        result = client.evaluate("""(async () => {
          const app = window.__ATTENTION_INBOX__;
          const ready = await app.ready();
          const now = Date.now();
          app.state.settings.dnd = false;
          app.state.items = [app.makeItem({
            id: 'p3ir-snooze-probe', title: '稍后入口复验', status: 'due',
            priority: 'normal', triggerAt: now - 1000, createdAt: now,
            updatedAt: now, rev: 1, tags: []
          })];
          app.renderHome();
          const button = document.querySelector('[data-act="snooze"][data-id="p3ir-snooze-probe"]');
          const errors = [];
          window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
          window.addEventListener('error', e => errors.push(String(e.message)));
          if (button) button.click();
          await new Promise(resolve => setTimeout(resolve, 100));
          return { ready, buttonFound: !!button,
            sheetOpen: document.querySelector('#sheetSnooze').classList.contains('open'),
            errors };
        })()""")
        print(json.dumps(result, ensure_ascii=False))
        if not result or not result.get("ready") or not result.get("buttonFound"):
            raise SystemExit("precondition failed")
        if result.get("sheetOpen") or not any("snoozePick is not defined" in e for e in result.get("errors", [])):
            raise SystemExit("expected regression was not reproduced")
    finally:
        process.terminate()
        server.shutdown()
