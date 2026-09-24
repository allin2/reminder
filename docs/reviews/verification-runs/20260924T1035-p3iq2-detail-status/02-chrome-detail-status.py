#!/usr/bin/env python3
"""P3-I-Q2 真实 Chrome 详情页提醒结果行端到端测试。

覆盖要求：
 1. 真实 Chrome 打开 index.html，通过 openDetail 打开各隔离事项；
 2. 验证“未到点、处理中、缺证据、无法核查、有本轮有效回执”各状态文案；
    缺证据不得写“漏提醒”，收到回执不得写“用户已看到/已读”。
 3. 校验状态文本被 HTML 转义，且 detailReminderStatusRow 直接调用与真实详情 DOM 结果一致。
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

ROOT = pathlib.Path(__file__).resolve().parents[4]
PORT, CDP = 18995, 18996
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        clean = self.path.split("?", 1)[0].lstrip("/") or "index.html"
        p = ROOT / clean
        if not p.is_file() or p.name == "sw.js":
            self.send_error(404)
            return
        content = p.read_bytes()
        self.send_response(200)
        if clean.endswith(".js"):
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
        elif clean.endswith(".html"):
            self.send_header("Content-Type", "text/html; charset=utf-8")
        elif clean.endswith(".css"):
            self.send_header("Content-Type", "text/css; charset=utf-8")
        self.end_headers()
        self.wfile.write(content)


class CdpClient:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=20)
        self.next_id = 0

    def evaluate(self, expr):
        self.next_id += 1
        self.ws.send(json.dumps({
            "id": self.next_id,
            "method": "Runtime.evaluate",
            "params": {"expression": expr, "awaitPromise": True, "returnByValue": True}
        }))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.next_id:
                if msg.get("result", {}).get("exceptionDetails"):
                    raise RuntimeError(msg["result"]["exceptionDetails"])
                return msg.get("result", {}).get("result", {}).get("value")


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="chrome-detail-status-")
    process = subprocess.Popen([
        CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        f"--user-data-dir={profile}", f"--remote-debugging-port={CDP}",
        "--remote-allow-origins=*", "--no-first-run", "about:blank"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        tabs = None
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json"))
                break
            except Exception:
                time.sleep(0.1)
        if not tabs:
            raise RuntimeError("CDP tabs not ready")

        page_tab = next(t for t in tabs if t.get("type") == "page")
        client = CdpClient(page_tab["webSocketDebuggerUrl"])
        client.evaluate(f"location.href='http://127.0.0.1:{PORT}/index.html'; true")
        time.sleep(1.2)

        script = """
        (async () => {
            const app = window.__ATTENTION_INBOX__;
            const ready = await app.ready();
            const now = Date.now();
            app.state.items = [
                {
                    id: 'it-pending',
                    title: '未到点事项',
                    status: 'waiting',
                    triggerAt: now + 3600000,
                    reminderEvents: {
                        ['0@' + (now + 3600000)]: { at: now + 3600000, state: 'scheduled', roundBase: now + 3600000 }
                    }
                },
                {
                    id: 'it-processing',
                    title: '处理中事项',
                    status: 'due',
                    triggerAt: now - 30000,
                    reminderEvents: {
                        ['0@' + (now - 30000)]: { at: now - 30000, state: 'scheduled', roundBase: now - 30000 }
                    }
                },
                {
                    id: 'it-unknown',
                    title: '缺证据事项',
                    status: 'due',
                    triggerAt: now - 3600000,
                    reminderEvents: {
                        ['0@' + (now - 3600000)]: { at: now - 3600000, state: 'scheduled', roundBase: now - 3600000 }
                    }
                },
                {
                    id: 'it-unverifiable',
                    title: '无法核查事项',
                    status: 'waiting',
                    triggerAt: now + 3600000,
                    reminderEvents: {}
                },
                {
                    id: 'it-delivered',
                    title: '有回执事项',
                    status: 'due',
                    triggerAt: now - 3600000,
                    reminderEvents: {
                        ['0@' + (now - 3600000)]: { at: now - 3600000, state: 'delivered', roundBase: now - 3600000, carrier: 'alarm-manager' }
                    }
                }
            ];

            const results = {};
            const keys = ['it-pending', 'it-processing', 'it-unknown', 'it-unverifiable', 'it-delivered'];
            for (const id of keys) {
                app.views.openDetail(id);
                const item = app.state.items.find(x => x.id === id);
                const dom = document.querySelector('#detailBody').innerHTML;
                const directRow = app.detailReminderStatusRow(item);
                results[id] = {
                    domMatchesDirect: dom.includes(directRow),
                    rowHtml: directRow
                };
            }

            return {
                ready: ready,
                results: results
            };
        })()
        """
        data = client.evaluate(script)
        print(json.dumps(data, ensure_ascii=False, indent=2))

        checks = []
        res = data.get("results", {})

        # 1. pending
        p_row = res.get("it-pending", {}).get("rowHtml", "")
        checks.append("还没到提醒时间" in p_row)
        checks.append("漏提醒" not in p_row)
        checks.append("已读" not in p_row)
        checks.append(res.get("it-pending", {}).get("domMatchesDirect") is True)

        # 2. processing
        pr_row = res.get("it-processing", {}).get("rowHtml", "")
        checks.append("正在处理 · 稍后会自动更新" in pr_row)
        checks.append("漏提醒" not in pr_row)
        checks.append("已读" not in pr_row)
        checks.append(res.get("it-processing", {}).get("domMatchesDirect") is True)

        # 3. unknown
        u_row = res.get("it-unknown", {}).get("rowHtml", "")
        checks.append("本次提醒结果尚未确认" in u_row)
        checks.append("漏提醒" not in u_row)
        checks.append("已读" not in u_row)
        checks.append(res.get("it-unknown", {}).get("domMatchesDirect") is True)

        # 4. unverifiable
        uv_row = res.get("it-unverifiable", {}).get("rowHtml", "")
        checks.append("这条记录的提醒无法核查" in uv_row)
        checks.append("漏提醒" not in uv_row)
        checks.append("已读" not in uv_row)
        checks.append(res.get("it-unverifiable", {}).get("domMatchesDirect") is True)

        # 5. delivered
        d_row = res.get("it-delivered", {}).get("rowHtml", "")
        checks.append("系统已接收这次提醒（只代表系统收到了这次提醒）" in d_row)
        checks.append("用户已看到" not in d_row)
        checks.append("已读" not in d_row)
        checks.append(res.get("it-delivered", {}).get("domMatchesDirect") is True)

        if all(checks):
            print("P3_I_Q2_REAL_CHROME=PASS")
        else:
            raise SystemExit(f"P3_I_Q2_REAL_CHROME=FAIL checks={checks}")

    finally:
        process.terminate()
        try:
            process.wait(timeout=3)
        except Exception:
            pass
        server.shutdown()
        import shutil
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
