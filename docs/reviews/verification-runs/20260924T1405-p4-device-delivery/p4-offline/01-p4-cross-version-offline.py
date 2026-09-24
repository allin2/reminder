#!/usr/bin/env python3
"""P4 真实跨版本离线升级验证。
1. 真实旧版 Web 资源：从已冻结旧候选提取的 v40 与 v38。
2. 在同一浏览器 origin、同一持久 profile 中依次证明：
   - 旧版在线首启并完整缓存（记录 controller, registration, cache 名与逐项资源）
   - 断网冷开仍 ready 且隔离 IDB 数据可读（记录数据哈希）
   - 恢复网络发布新版并完成 SW 更新（新 cache 名, 旧 cache 清除）
   - 再断网冷开，运行完整新版资源且原数据未丢。
3. 验证 v40 -> v42 与 v38 (确实缺少 lib/app-notices.js) -> v42。
"""
import hashlib
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

HTTP_PORT = 18890
CDP_PORT = 19235
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

server_state = {
    "version": "v40",
    "offline": False
}

class P4Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if server_state["offline"]:
            self.close_connection = True
            return

        clean = self.path.split("?", 1)[0].lstrip("/")
        ver = server_state["version"]
        if ver == "v40":
            src_dir = V40_DIR
        elif ver == "v38":
            src_dir = V38_DIR
        else:
            src_dir = ROOT

        p = (src_dir / "index.html") if not clean else (src_dir / clean)
        if not p.is_file():
            self.send_error(404, f"File not found: {clean}")
            return

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

def run_test_v40_to_v42():
    print("--- [TEST 1] v40 -> v42 Offline Upgrade in Same Persistent Profile ---")
    server_state["version"] = "v40"
    server_state["offline"] = False
    profile = tempfile.mkdtemp(prefix="p4-v40-to-v42-")

    cdp = CdpSession(CDP_PORT, profile)
    try:
        # Phase 1: Online initial boot with v40
        cdp.evaluate(f"location.href = 'http://127.0.0.1:{HTTP_PORT}/index.html'; true")
        time.sleep(1.5)

        for _ in range(40):
            ready = cdp.evaluate("(async () => !!(window.__ATTENTION_INBOX__ && await window.__ATTENTION_INBOX__.ready()))()")
            has_sw = cdp.evaluate("!!navigator.serviceWorker.controller")
            if ready and has_sw:
                break
            time.sleep(0.2)

        v40_state = cdp.evaluate("""
        (async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            const keys = await caches.keys();
            let assets = [];
            if (keys.length > 0) {
                const c = await caches.open(keys[0]);
                const reqs = await c.keys();
                assets = reqs.map(r => r.url);
            }
            return {
                controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null,
                cacheName: keys[0],
                assetsCount: assets.length,
                swState: reg && reg.active ? reg.active.state : null
            };
        })()
        """)
        print("  [v40 Online]", json.dumps(v40_state))
        assert v40_state["cacheName"] == "attention-inbox-v40", f"Expected v40 cache, got {v40_state['cacheName']}"
        assert v40_state["assetsCount"] == 34, f"Expected 34 assets, got {v40_state['assetsCount']}"

        # Seed isolated test record into IDB
        seed_res = cdp.evaluate("""
        (async () => {
            const A = window.__ATTENTION_INBOX__;
            const it = A.makeItem({
                id: "p4-offline-v40-v42-item",
                title: "P4_V40_UPGRADE_VERIFY",
                note: "Testing offline persistence across v40 -> v42 upgrade",
                priority: "important",
                status: "waiting",
                triggerAt: Date.now() + 3600000,
                isFallbackTrigger: false,
                repeat: null
            });
            A.state.items.push(it);
            await A.saveAsync();
            return { id: it.id, title: it.title, triggerAt: it.triggerAt };
        })()
        """)
        seed_hash = hashlib.sha256(json.dumps(seed_res, sort_keys=True).encode()).hexdigest()
        print(f"  [v40 IDB Seed] record={seed_res['title']}, hash={seed_hash[:16]}...")

        # Phase 2: Disconnect network (offline) and cold reload v40
        print("  [v40 Offline Reload] Going offline and reloading...")
        cdp.set_offline(True)
        cdp.evaluate("location.reload(); true")
        time.sleep(2)

        v40_offline = cdp.evaluate("""
        (async () => {
            const A = window.__ATTENTION_INBOX__;
            const ready = A ? await A.ready() : false;
            const controller = !!navigator.serviceWorker.controller;
            const items = A && A.state && A.state.items ? A.state.items : [];
            const target = items.find(i => i.id === "p4-offline-v40-v42-item");
            return {
                ready, controller,
                foundItem: !!target,
                itemRecord: target ? { id: target.id, title: target.title, triggerAt: target.triggerAt } : null
            };
        })()
        """)
        print("  [v40 Offline Result]", json.dumps(v40_offline))
        assert v40_offline["ready"] is True, "v40 offline reload failed ready check"
        assert v40_offline["controller"] is True, "v40 offline reload lost SW controller"
        assert v40_offline["foundItem"] is True, "v40 offline reload lost IDB item"
        offline_hash = hashlib.sha256(json.dumps(v40_offline["itemRecord"], sort_keys=True).encode()).hexdigest()
        assert offline_hash == seed_hash, "v40 offline item hash mismatch"

        # Phase 3: Reconnect network, release v42, update SW
        print("  [Upgrade to v42] Reconnecting network and updating to v42...")
        server_state["version"] = "new"  # Serves current source (v42 with fix)
        cdp.set_offline(False)

        # Trigger registration update
        update_res = cdp.evaluate("""
        (async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
                await reg.update();
            }
            return true;
        })()
        """)

        # Wait for v42 SW to activate and take over
        for _ in range(50):
            keys = cdp.evaluate("caches.keys()")
            active_script = cdp.evaluate("""
            (async () => {
                const reg = await navigator.serviceWorker.getRegistration();
                return reg && reg.active ? reg.active.state : null;
            })()
            """)
            if "attention-inbox-v42" in keys:
                break
            time.sleep(0.2)

        # Let clients claim and activate complete
        time.sleep(1)
        v42_state = cdp.evaluate("""
        (async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            const keys = await caches.keys();
            let assets = [];
            if (keys.includes("attention-inbox-v42")) {
                const c = await caches.open("attention-inbox-v42");
                const reqs = await c.keys();
                assets = reqs.map(r => r.url);
            }
            return {
                caches: keys,
                assetsCount: assets.length,
                controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null
            };
        })()
        """)
        print("  [v42 Online Result]", json.dumps(v42_state))
        assert "attention-inbox-v42" in v42_state["caches"], "v42 cache not found"
        assert "attention-inbox-v40" not in v42_state["caches"], "old v40 cache was not deleted"
        assert v42_state["assetsCount"] == 34, f"v42 cache expected 34 assets, got {v42_state['assetsCount']}"

        # Phase 4: Disconnect network (offline) and cold reload v42
        print("  [v42 Offline Reload] Going offline and reloading running v42...")
        cdp.set_offline(True)
        cdp.evaluate("location.reload(); true")
        time.sleep(2)

        v42_offline = cdp.evaluate("""
        (async () => {
            const A = window.__ATTENTION_INBOX__;
            const ready = A ? await A.ready() : false;
            const controller = !!navigator.serviceWorker.controller;
            const items = A && A.state && A.state.items ? A.state.items : [];
            const target = items.find(i => i.id === "p4-offline-v40-v42-item");
            const keys = await caches.keys();
            return {
                ready, controller,
                caches: keys,
                foundItem: !!target,
                itemRecord: target ? { id: target.id, title: target.title, triggerAt: target.triggerAt } : null
            };
        })()
        """)
        print("  [v42 Offline Result]", json.dumps(v42_offline))
        assert v42_offline["ready"] is True, "v42 offline reload failed ready check"
        assert v42_offline["controller"] is True, "v42 offline reload lost SW controller"
        assert v42_offline["foundItem"] is True, "v42 offline reload lost original IDB item"
        final_hash = hashlib.sha256(json.dumps(v42_offline["itemRecord"], sort_keys=True).encode()).hexdigest()
        assert final_hash == seed_hash, "Record-level data hash changed across upgrade!"
        print("  => TEST 1 PASS: v40 -> v42 offline upgrade succeeded with 0 data loss!\n")
    finally:
        cdp.close()

def run_test_v38_to_v42():
    print("--- [TEST 2] v38 (Lacking lib/app-notices.js) -> v42 Offline Upgrade ---")
    server_state["version"] = "v38"
    server_state["offline"] = False
    profile = tempfile.mkdtemp(prefix="p4-v38-to-v42-")

    cdp = CdpSession(CDP_PORT, profile)
    try:
        # Phase 1: Online boot with v38
        cdp.evaluate(f"location.href = 'http://127.0.0.1:{HTTP_PORT}/index.html'; true")
        time.sleep(1.5)

        for _ in range(40):
            ready = cdp.evaluate("(async () => !!(window.__ATTENTION_INBOX__ && await window.__ATTENTION_INBOX__.ready()))()")
            has_sw = cdp.evaluate("!!navigator.serviceWorker.controller")
            if ready and has_sw:
                break
            time.sleep(0.2)

        v38_state = cdp.evaluate("""
        (async () => {
            const keys = await caches.keys();
            const hasNotices = typeof window.AttentionLib !== "undefined" && !!window.AttentionLib.AppNotices;
            return { cacheName: keys[0], hasNotices };
        })()
        """)
        print("  [v38 Online]", json.dumps(v38_state))
        assert v38_state["cacheName"] == "attention-inbox-v38"
        assert v38_state["hasNotices"] is False, "v38 must genuinely lack AppNotices"

        # Seed data
        seed_res = cdp.evaluate("""
        (async () => {
            const A = window.__ATTENTION_INBOX__;
            const it = A.makeItem({
                id: "p4-v38-item",
                title: "V38_PERSISTENT_DATA",
                note: "From v38 candidate",
                priority: "normal",
                status: "waiting",
                triggerAt: Date.now() + 7200000,
                isFallbackTrigger: false,
                repeat: null
            });
            A.state.items.push(it);
            await A.saveAsync();
            return { id: it.id, title: it.title };
        })()
        """)
        seed_hash = hashlib.sha256(json.dumps(seed_res, sort_keys=True).encode()).hexdigest()
        print(f"  [v38 IDB Seed] record={seed_res['title']}, hash={seed_hash[:16]}...")

        # Phase 2: Upgrade to v42
        print("  [Upgrade to v42] Switching server to v42 and triggering update...")
        server_state["version"] = "new"
        cdp.evaluate("""
        (async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) await reg.update();
        })()
        """)

        for _ in range(50):
            keys = cdp.evaluate("caches.keys()")
            if "attention-inbox-v42" in keys:
                break
            time.sleep(0.2)

        time.sleep(1)

        # Phase 3: Go offline and reload v42
        print("  [v42 Offline Reload] Going offline and reloading...")
        cdp.set_offline(True)
        cdp.evaluate("location.reload(); true")
        time.sleep(2)

        v42_offline = cdp.evaluate("""
        (async () => {
            const A = window.__ATTENTION_INBOX__;
            const ready = A ? await A.ready() : false;
            const controller = !!navigator.serviceWorker.controller;
            const hasNotices = typeof window.AttentionLib !== "undefined" && !!window.AttentionLib.AppNotices;
            const items = A && A.state && A.state.items ? A.state.items : [];
            const target = items.find(i => i.id === "p4-v38-item");
            return {
                ready, controller, hasNotices,
                foundItem: !!target,
                itemRecord: target ? { id: target.id, title: target.title } : null
            };
        })()
        """)
        print("  [v42 Offline Result]", json.dumps(v42_offline))
        assert v42_offline["ready"] is True, "v42 offline reload failed ready check"
        assert v42_offline["hasNotices"] is True, "v42 must now have new module AppNotices offline!"
        assert v42_offline["foundItem"] is True, "v42 offline reload lost v38 item"
        final_hash = hashlib.sha256(json.dumps(v42_offline["itemRecord"], sort_keys=True).encode()).hexdigest()
        assert final_hash == seed_hash, "Record-level hash mismatch"
        print("  => TEST 2 PASS: v38 -> v42 upgrade succeeded, new module cached, data preserved!\n")
    finally:
        cdp.close()

def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), P4Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"P4 HTTP server started on port {HTTP_PORT}")

    run_test_v40_to_v42()
    run_test_v38_to_v42()

    print("ALL P4 CROSS-VERSION OFFLINE TESTS PASSED!")

if __name__ == "__main__":
    main()
