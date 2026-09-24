#!/usr/bin/env python3
"""P4 故障注入与反向变异红灯验证。
覆盖场景：
1. 故障注入 1：新脚本下载失败（从确实缺少 lib/app-notices.js 的 v38 升级时注入 500）
   -> 新 SW 安装失败并回滚删除残缺缓存，旧 v38 SW 继续服务，离线启动仍 ready=true。
2. 故障注入 2：预缓存部分资源失败（从 v40 升级时 lib/app-views.js 注入 500）
   -> 新 SW 安装失败并回滚删除残缺缓存，旧 v40 SW 继续服务，离线启动仍 ready=true 且 hasAppViews=true。
3. 故障注入 3：更新中断（预缓存期间连接中断 BrokenPipe）
   -> 新 SW 中止安装，旧 v40 SW 与完整旧缓存继续服务，离线冷开正常。
4. 反向变异对照（拔掉修复必变红，MUTANT_RED=1）：
   -> 还原原 sw.js 吞错行为 (.catch(() => null))，在相同故障下复现“残缺 SW 强行激活、删除旧缓存、离线启动失败 (ready=false, hasAppViews=false)”。
"""
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

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(k, None)

ROOT = pathlib.Path(__file__).resolve().parents[5]
RUN_DIR = pathlib.Path(__file__).resolve().parent
FIXTURES_DIR = RUN_DIR / "fixtures"
V40_DIR = FIXTURES_DIR / "v40"
V38_DIR = FIXTURES_DIR / "v38"

HTTP_PORT = 18891
CDP_PORT = 19236
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

server_state = {
    "version": "v40",
    "offline": False,
    "fail_asset": None,
    "abort_asset": None,
    "use_buggy_sw": False
}

class FaultInjectionHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if server_state["offline"]:
            self.close_connection = True
            return

        clean = self.path.split("?", 1)[0].lstrip("/")
        
        # Inject fault for target asset
        if server_state.get("fail_asset") and clean == server_state["fail_asset"]:
            print(f"  [SERVER INJECT] 500 Error for {clean}")
            self.send_error(500, f"Injected 500 error for {clean}")
            return

        if server_state.get("abort_asset") and clean == server_state["abort_asset"]:
            print(f"  [SERVER INJECT] Connection Abort for {clean}")
            self.close_connection = True
            return

        # Choose source directory or dynamic SW
        if clean == "sw.js" and server_state.get("use_buggy_sw"):
            # Provide the buggy sw.js (old behavior: .catch(() => null))
            raw = (ROOT / "sw.js").read_text(encoding="utf-8")
            buggy_install = """self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS).catch(() => null))
      .then(() => self.skipWaiting())
  );
});"""
            import re
            fixed_sw = re.sub(r"self\.addEventListener\(\"install\",[\s\S]*?\}\);\n", buggy_install + "\n", raw)
            content = fixed_sw.encode("utf-8")
        elif server_state["version"] == "v40":
            p = (V40_DIR / "index.html") if not clean else (V40_DIR / clean)
            content = p.read_bytes()
        elif server_state["version"] == "v38":
            p = (V38_DIR / "index.html") if not clean else (V38_DIR / clean)
            content = p.read_bytes()
        else:
            p = (ROOT / "index.html") if not clean else (ROOT / clean)
            content = p.read_bytes()

        self.send_response(200)
        if clean.endswith(".js") or clean == "sw.js":
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
        elif clean.endswith(".html") or not clean:
            self.send_header("Content-Type", "text/html; charset=utf-8")
        elif clean.endswith(".json"):
            self.send_header("Content-Type", "application/json; charset=utf-8")
        elif clean.endswith(".svg"):
            self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Service-Worker-Allowed", "/")
        self.end_headers()
        self.wfile.write(content)

class CdpSession:
    def __init__(self, port, profile):
        self.port = port
        self.profile = profile
        self.proc = subprocess.Popen([
            CHROME, "--headless=new", "--no-sandbox", "--disable-gpu",
            f"--user-data-dir={profile}", f"--remote-debugging-port={port}",
            "--remote-allow-origins=*", "about:blank"
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.ws = None
        self.msg_id = 0
        self._connect()

    def _connect(self):
        tabs = None
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json"))
                break
            except Exception:
                time.sleep(0.1)
        if not tabs:
            raise RuntimeError("Cannot connect to Chrome CDP")
        page_tab = next(t for t in tabs if t.get("type") == "page")
        self.ws = websocket.create_connection(page_tab["webSocketDebuggerUrl"], timeout=20)
        self.send("Network.enable")

    def send(self, method, params=None):
        self.msg_id += 1
        self.ws.send(json.dumps({"id": self.msg_id, "method": method, "params": params or {}}))
        while True:
            resp = json.loads(self.ws.recv())
            if resp.get("id") == self.msg_id:
                if resp.get("result", {}).get("exceptionDetails"):
                    raise RuntimeError(resp["result"]["exceptionDetails"])
                return resp.get("result", {})

    def evaluate(self, expr):
        res = self.send("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True})
        return res.get("result", {}).get("value")

    def set_offline(self, offline):
        server_state["offline"] = offline
        self.send("Network.emulateNetworkConditions", {
            "offline": offline,
            "latency": 0,
            "downloadThroughput": -1,
            "uploadThroughput": -1
        })

    def close(self):
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass
        self.proc.terminate()
        try:
            self.proc.wait(timeout=3)
        except Exception:
            self.proc.kill()

def test_fault_new_script_download_failure():
    print("--- [FAULT 1] New Script Download Failure (v38 -> v42, lib/app-notices.js 500) ---")
    server_state["version"] = "v38"
    server_state["offline"] = False
    server_state["fail_asset"] = None
    server_state["abort_asset"] = None
    server_state["use_buggy_sw"] = False
    profile = tempfile.mkdtemp(prefix="p4-fault1-")

    cdp = CdpSession(CDP_PORT, profile)
    try:
        # Initial boot with v38
        cdp.evaluate(f"location.href = 'http://127.0.0.1:{HTTP_PORT}/index.html'; true")
        time.sleep(1.5)
        for _ in range(40):
            ready = cdp.evaluate("(async () => !!(window.__ATTENTION_INBOX__ && await window.__ATTENTION_INBOX__.ready()))()")
            has_sw = cdp.evaluate("!!navigator.serviceWorker.controller")
            if ready and has_sw:
                break
            time.sleep(0.2)

        # Upgrade to v42 BUT lib/app-notices.js fails with 500!
        server_state["version"] = "new"
        server_state["fail_asset"] = "lib/app-notices.js"
        print("  Injecting 500 failure on new module lib/app-notices.js...")
        cdp.evaluate("""
        (async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
                try { await reg.update(); } catch(e) {}
            }
        })()
        """)
        time.sleep(3)

        # Check SW state with fix: v42 install must have failed, v38 cache preserved!
        status = cdp.evaluate("""
        (async () => {
            const keys = await caches.keys();
            const reg = await navigator.serviceWorker.getRegistration();
            return {
                caches: keys,
                activeWorker: reg && reg.active ? reg.active.scriptURL : null,
                waitingWorker: reg && reg.waiting ? reg.waiting.scriptURL : null
            };
        })()
        """)
        print("  Status after failed upgrade:", json.dumps(status))
        assert "attention-inbox-v38" in status["caches"], "v38 cache must be preserved!"
        assert "attention-inbox-v42" not in status["caches"], "incomplete v42 cache must be rolled back!"

        # Now disconnect network and reload offline
        print("  Disconnecting network and reloading offline...")
        cdp.set_offline(True)
        cdp.evaluate("location.reload(); true")
        time.sleep(2)

        offline_status = cdp.evaluate("""
        (async () => {
            const A = window.__ATTENTION_INBOX__;
            const ready = A ? await A.ready() : false;
            const controller = !!navigator.serviceWorker.controller;
            return { ready, controller };
        })()
        """)
        print("  Offline reload result:", json.dumps(offline_status))
        assert offline_status["ready"] is True, "Offline reload must succeed on healthy old v38!"
        assert offline_status["controller"] is True, "SW controller must remain active!"
        print("  => FAULT 1 PASS: New script failure cleanly handled, fallback to intact old SW!\n")
    finally:
        cdp.close()

def test_fault_partial_precache_failure():
    print("--- [FAULT 2] Partial Pre-cache Failure (v40 -> v42, lib/app-views.js 500) ---")
    server_state["version"] = "v40"
    server_state["offline"] = False
    server_state["fail_asset"] = None
    server_state["abort_asset"] = None
    server_state["use_buggy_sw"] = False
    profile = tempfile.mkdtemp(prefix="p4-fault2-")

    cdp = CdpSession(CDP_PORT, profile)
    try:
        # Initial boot with v40
        cdp.evaluate(f"location.href = 'http://127.0.0.1:{HTTP_PORT}/index.html'; true")
        time.sleep(1.5)
        for _ in range(40):
            ready = cdp.evaluate("(async () => !!(window.__ATTENTION_INBOX__ && await window.__ATTENTION_INBOX__.ready()))()")
            has_sw = cdp.evaluate("!!navigator.serviceWorker.controller")
            if ready and has_sw:
                break
            time.sleep(0.2)

        # Upgrade to v42 BUT lib/app-views.js fails with 500!
        server_state["version"] = "new"
        server_state["fail_asset"] = "lib/app-views.js"
        print("  Injecting 500 failure on lib/app-views.js during pre-caching...")
        cdp.evaluate("""
        (async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
                try { await reg.update(); } catch(e) {}
            }
        })()
        """)
        time.sleep(3)

        status = cdp.evaluate("""
        (async () => {
            const keys = await caches.keys();
            return { caches: keys };
        })()
        """)
        print("  Status after failed upgrade:", json.dumps(status))
        assert "attention-inbox-v40" in status["caches"], "v40 cache must be preserved!"
        assert "attention-inbox-v42" not in status["caches"], "incomplete v42 cache must be deleted!"

        # Now disconnect network and reload offline
        print("  Disconnecting network and reloading offline...")
        cdp.set_offline(True)
        cdp.evaluate("location.reload(); true")
        time.sleep(2)

        offline_status = cdp.evaluate("""
        (async () => {
            const A = window.__ATTENTION_INBOX__;
            const ready = A ? await A.ready() : false;
            const controller = !!navigator.serviceWorker.controller;
            const hasAppViews = typeof window.AttentionLib !== "undefined" && !!window.AttentionLib.AppViews;
            return { ready, controller, hasAppViews };
        })()
        """)
        print("  Offline reload result:", json.dumps(offline_status))
        assert offline_status["ready"] is True, "Offline reload must succeed on healthy old v40!"
        assert offline_status["hasAppViews"] is True, "AppViews must be present from v40 cache!"
        print("  => FAULT 2 PASS: Partial pre-cache failure cleanly aborted, old version intact!\n")
    finally:
        cdp.close()

def test_fault_update_interrupted():
    print("--- [FAULT 3] Update Interrupted (Connection Abort during Pre-caching) ---")
    server_state["version"] = "v40"
    server_state["offline"] = False
    server_state["fail_asset"] = None
    server_state["abort_asset"] = None
    server_state["use_buggy_sw"] = False
    profile = tempfile.mkdtemp(prefix="p4-fault3-")

    cdp = CdpSession(CDP_PORT, profile)
    try:
        # Initial boot with v40
        cdp.evaluate(f"location.href = 'http://127.0.0.1:{HTTP_PORT}/index.html'; true")
        time.sleep(1.5)
        for _ in range(40):
            ready = cdp.evaluate("(async () => !!(window.__ATTENTION_INBOX__ && await window.__ATTENTION_INBOX__.ready()))()")
            has_sw = cdp.evaluate("!!navigator.serviceWorker.controller")
            if ready and has_sw:
                break
            time.sleep(0.2)

        # Upgrade to v42 BUT connection aborts when fetching lib/app-native-coordinator.js
        server_state["version"] = "new"
        server_state["abort_asset"] = "lib/app-native-coordinator.js"
        print("  Injecting abrupt connection drop on lib/app-native-coordinator.js...")
        cdp.evaluate("""
        (async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
                try { await reg.update(); } catch(e) {}
            }
        })()
        """)
        time.sleep(3)

        status = cdp.evaluate("""
        (async () => {
            const keys = await caches.keys();
            return { caches: keys };
        })()
        """)
        print("  Status after aborted upgrade:", json.dumps(status))
        assert "attention-inbox-v40" in status["caches"], "v40 cache must be preserved!"
        assert "attention-inbox-v42" not in status["caches"], "incomplete v42 cache must be deleted!"

        # Disconnect network and reload offline
        print("  Disconnecting network and reloading offline...")
        cdp.set_offline(True)
        cdp.evaluate("location.reload(); true")
        time.sleep(2)

        offline_status = cdp.evaluate("""
        (async () => {
            const A = window.__ATTENTION_INBOX__;
            const ready = A ? await A.ready() : false;
            const controller = !!navigator.serviceWorker.controller;
            return { ready, controller };
        })()
        """)
        print("  Offline reload result:", json.dumps(offline_status))
        assert offline_status["ready"] is True, "Offline reload must succeed on healthy old v40!"
        print("  => FAULT 3 PASS: Update interruption safely discarded incomplete cache!\n")
    finally:
        cdp.close()

def test_mutant_red_without_fix():
    print("--- [COUNTEREXAMPLE / MUTANT RED] Same Fault Scenario on UNFIXED sw.js ---")
    print("  Demonstrating that pulling the fix causes test failure (拔掉修复必变红)")
    server_state["version"] = "v40"
    server_state["offline"] = False
    server_state["fail_asset"] = None
    server_state["abort_asset"] = None
    server_state["use_buggy_sw"] = True  # Uses buggy sw.js with .catch(() => null)
    profile = tempfile.mkdtemp(prefix="p4-mutant-red-")

    cdp = CdpSession(CDP_PORT, profile)
    try:
        # Initial boot with v40
        cdp.evaluate(f"location.href = 'http://127.0.0.1:{HTTP_PORT}/index.html'; true")
        time.sleep(1.5)
        for _ in range(40):
            ready = cdp.evaluate("(async () => !!(window.__ATTENTION_INBOX__ && await window.__ATTENTION_INBOX__.ready()))()")
            has_sw = cdp.evaluate("!!navigator.serviceWorker.controller")
            if ready and has_sw:
                break
            time.sleep(0.2)

        # Upgrade to buggy sw.js with fault on lib/app-views.js
        server_state["version"] = "new"
        server_state["fail_asset"] = "lib/app-views.js"
        print("  Upgrading with UNFIXED SW while lib/app-views.js returns 500...")
        cdp.evaluate("""
        (async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
                try { await reg.update(); } catch(e) {}
            }
        })()
        """)
        time.sleep(3)

        # With buggy SW: it swallowed 500, skipWaiting, activated, and DELETED v40 cache!
        status = cdp.evaluate("""
        (async () => {
            const keys = await caches.keys();
            return { caches: keys };
        })()
        """)
        print("  [BUGGY SW] Caches after failed update:", json.dumps(status))

        # Disconnect network and reload offline
        print("  Disconnecting network and reloading offline...")
        cdp.set_offline(True)
        cdp.evaluate("location.reload(); true")
        time.sleep(2)

        offline_status = cdp.evaluate("""
        (async () => {
            const A = window.__ATTENTION_INBOX__;
            const ready = A ? await A.ready() : false;
            const hasAppViews = typeof window.AttentionLib !== "undefined" && !!window.AttentionLib.AppViews;
            return { ready, hasAppViews };
        })()
        """)
        print("  [BUGGY SW] Offline reload result:", json.dumps(offline_status))

        # Assert that the bug manifests! (拔掉修复必变红)
        assert offline_status["hasAppViews"] is False, "MUTANT RED VERIFIED: Buggy SW activated incomplete cache missing AppViews!"
        assert offline_status["ready"] is False, "MUTANT RED VERIFIED: Offline boot failed (ready=false) under buggy SW!"
        print("  => MUTANT RED PROOF SUCCEEDED: Without the fix, the app completely breaks offline (ready=false, hasAppViews=false)!\n")
    finally:
        cdp.close()

def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), FaultInjectionHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"Fault Injection HTTP server started on port {HTTP_PORT}")

    test_fault_new_script_download_failure()
    test_fault_partial_precache_failure()
    test_fault_update_interrupted()
    test_mutant_red_without_fix()

    print("ALL P4 FAULT INJECTION & MUTANT RED TESTS PASSED!")

if __name__ == "__main__":
    main()
