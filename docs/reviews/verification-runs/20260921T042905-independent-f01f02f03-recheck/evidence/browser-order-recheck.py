#!/usr/bin/env python3
"""Independent F03 browser counterexample: parse-cn loads after app-core."""

import http.server
import json
import os
import pathlib
import subprocess
import threading
import time
import urllib.request

import websocket

for key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(key, None)
os.environ["NO_PROXY"] = "*"

ROOT = pathlib.Path(__file__).resolve().parents[5]
OUT = pathlib.Path(__file__).resolve().parent
HTTP_PORT = 18781
CDP_PORT = 18782
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        rel = self.path.split("?", 1)[0].lstrip("/") or "index.html"
        file = ROOT / rel
        if not file.is_file() or rel == "sw.js":
            self.send_error(404)
            return
        data = file.read_bytes()
        if rel == "index.html":
            parser = b'<script src="lib/parse-cn.js"></script>'
            core = b'<script src="app-core.js"></script>'
            data = data.replace(parser, b"").replace(core, core + parser)
        self.send_response(200)
        self.send_header("Content-Type", "text/html" if rel.endswith(".html") else "text/javascript")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, origin=f"http://localhost:{CDP_PORT}", timeout=20)
        self.counter = 0

    def call(self, method, params=None, session=None):
        self.counter += 1
        msg = {"id": self.counter, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        self.ws.send(json.dumps(msg))
        while True:
            result = json.loads(self.ws.recv())
            if result.get("id") == self.counter:
                if "error" in result:
                    raise RuntimeError(result["error"])
                return result.get("result", {})

    def eval(self, session, source):
        result = self.call("Runtime.evaluate", {
            "expression": source,
            "awaitPromise": True,
            "returnByValue": True,
        }, session)
        if "exceptionDetails" in result:
            return {"exception": result["exceptionDetails"].get("text")}
        return result.get("result", {}).get("value")


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    chrome_log = open(OUT / "browser-order-chrome.log", "w")
    profile = OUT / "browser-order-profile"
    proc = subprocess.Popen([
        CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        f"--remote-debugging-port={CDP_PORT}",
        f"--remote-allow-origins=http://localhost:{CDP_PORT}",
        f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check", "about:blank",
    ], stdout=chrome_log, stderr=chrome_log)
    try:
        info = None
        for _ in range(80):
            try:
                info = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/version"))
                break
            except Exception:
                time.sleep(0.1)
        if not info:
            raise RuntimeError("Chrome did not start")
        browser = CDP(info["webSocketDebuggerUrl"])
        ctx = browser.call("Target.createBrowserContext")["browserContextId"]
        target = browser.call("Target.createTarget", {"url": "about:blank", "browserContextId": ctx})["targetId"]
        session = browser.call("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
        browser.call("Runtime.enable", {}, session)
        browser.call("Page.enable", {}, session)
        browser.call("Page.addScriptToEvaluateOnNewDocument", {"source": """
          window.__ORDER_AUDIT__ = { errors: [], intervals: [] };
          addEventListener('error', e => __ORDER_AUDIT__.errors.push(String(e.message || e.error)));
          const oldError = console.error;
          console.error = (...args) => { __ORDER_AUDIT__.errors.push(args.map(String).join(' ')); oldError(...args); };
          const oldSetInterval = setInterval;
          setInterval = (fn, ms, ...args) => { __ORDER_AUDIT__.intervals.push(ms); return oldSetInterval(fn, ms, ...args); };
          Object.defineProperty(navigator, 'serviceWorker', { value: undefined });
        """}, session)
        browser.call("Page.navigate", {"url": f"http://127.0.0.1:{HTTP_PORT}/index.html"}, session)
        time.sleep(1.5)
        initial = browser.eval(session, """
          (async () => ({
            ready: await __ATTENTION_INBOX__.ready(),
            failure: __ATTENTION_INBOX__.startupFailure(),
            bindings: __ATTENTION_INBOX__.runtimeBindings(),
            intervals: __ORDER_AUDIT__.intervals,
            errors: __ORDER_AUDIT__.errors
          }))()
        """)
        saved = browser.eval(session, """
          (async () => {
            document.querySelector('#fab').click();
            const input = document.querySelector('#capText');
            input.value = '三分钟后提醒我顺序复验';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('#btnSaveItem').click();
            await new Promise(r => setTimeout(r, 900));
            return { items: __ATTENTION_INBOX__.state.items.map(x => ({ id: x.id, title: x.title })), errors: __ORDER_AUDIT__.errors };
          })()
        """)
        browser.call("Page.reload", {}, session)
        time.sleep(1.5)
        reloaded = browser.eval(session, """
          (async () => { await __ATTENTION_INBOX__.ready(); return {
            items: __ATTENTION_INBOX__.state.items.map(x => ({ id: x.id, title: x.title })),
            bindings: __ATTENTION_INBOX__.runtimeBindings(), errors: __ORDER_AUDIT__.errors
          }; })()
        """)
        checks = {
            "ready": initial.get("ready") is True,
            "no_startup_failure": initial.get("failure") is None,
            "binding_current": (initial.get("bindings") or {}).get("parseChineseTime") == "current",
            "single_heartbeat": (initial.get("intervals") or []).count(15000) == 1,
            "saved": len(saved.get("items") or []) == 1,
            "reloaded": len(reloaded.get("items") or []) == 1,
            "no_errors": not (saved.get("errors") or reloaded.get("errors")),
        }
        result = {"browser": info.get("Browser"), "initial": initial, "saved": saved, "reloaded": reloaded, "checks": checks}
        (OUT / "browser-order-recheck.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if not all(checks.values()) else 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        server.shutdown()
        chrome_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
