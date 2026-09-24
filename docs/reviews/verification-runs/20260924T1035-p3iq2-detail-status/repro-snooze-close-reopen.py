#!/usr/bin/env python3
"""U1 修复后的真实 Chrome 反例：点生产「稍后提醒」按钮，面板必须打开且零报错。

改编自独立复验 20260924T0909 的 repro-snooze-entry.py（同一环境参数：
--no-sandbox 等 + no_proxy=* + 一次性 profile + 全新 Chrome 状态），
断言反转：修复后面板必须打开、不得出现 ReferenceError；
并追加两条浏览器级断言：
  R3 重开不沿用旧值（选 chip → 重开 → 自定义输入与 chip 高亮必须已清空）
  R4 正常确认恰好一次（事项 triggerAt 推进到今晚 20:00，面板关闭）
退出码 0 = 全部成立。
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

ROOT = pathlib.Path(__file__).resolve().parents[4]  # 独立 run 根目录
PORT, CDP = 19023, 19024
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
        if not path.is_file():
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
with tempfile.TemporaryDirectory(prefix="u1-snooze-fixed-") as profile:
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
        for _ in range(150):
            state = client.evaluate(
                "location.href + ' | ' + document.readyState + ' | ' + document.scripts.length"
                " + ' | ' + String(typeof window.__ATTENTION_INBOX__)")
            if isinstance(state, str) and state.endswith("object"):
                break
            if _ % 20 == 19:
                print("poll:", state, file=__import__("sys").stderr)
            time.sleep(0.1)
        else:
            raise RuntimeError("__ATTENTION_INBOX__ never appeared, last=" + repr(state))
        time.sleep(0.3)
        result = client.evaluate("""(async () => {
          const app = window.__ATTENTION_INBOX__;
          const ready = await app.ready();
          const now = Date.now();
          app.state.settings.dnd = false;
          app.state.items = [app.makeItem({
            id: 'u1-snooze-probe', title: 'U1 修复复验', status: 'due',
            priority: 'normal', triggerAt: now - 1000, createdAt: now,
            updatedAt: now, rev: 1, tags: []
          })];
          app.renderHome();
          const errors = [];
          window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
          window.addEventListener('error', e => errors.push(String(e.message)));

          const button = document.querySelector('[data-act="snooze"][data-id="u1-snooze-probe"]');
          if (button) button.click();
          await new Promise(r => setTimeout(r, 100));
          const sheetOpen = document.querySelector('#sheetSnooze').classList.contains('open');

          // R3 前半：选中今晚 chip
          const chip = Array.from(document.querySelectorAll('#snoozeChips .chip'))
            .find(c => c.dataset.preset === 'tonight');
          if (chip) chip.click();
          await new Promise(r => setTimeout(r, 50));
          const customAfterChip = (document.querySelector('#snoozeCustom') || {}).value || '';
          const chipOnAfterChip = chip ? chip.classList.contains('on') : false;

          // 独立增强：先通过生产「取消」按钮关闭，再点卡片按钮重开。
          const cancel = document.querySelector('#sheetSnooze [data-close="sheetSnooze"]');
          if (cancel) cancel.click();
          await new Promise(r => setTimeout(r, 50));
          const closedBeforeReopen = !document.querySelector('#sheetSnooze').classList.contains('open');
          if (button) button.click();
          await new Promise(r => setTimeout(r, 100));
          const customAfterReopen = (document.querySelector('#snoozeCustom') || {}).value || '';
          const chipOnAfterReopen = chip ? chip.classList.contains('on') : false;
          const stillOpen = document.querySelector('#sheetSnooze').classList.contains('open');

          // 重开后不选择就按确认：不得推进事项，也不得关闭面板。
          const beforeEmptyConfirm = app.state.items[0].triggerAt;
          const emptyApply = document.querySelector('#btnApplySnooze');
          if (emptyApply) emptyApply.click();
          await new Promise(r => setTimeout(r, 100));
          const emptyConfirmBlocked = app.state.items[0].triggerAt === beforeEmptyConfirm &&
            document.querySelector('#sheetSnooze').classList.contains('open');

          // R4：重选 chip 后确认 → triggerAt 推进到今晚 20:00，面板关闭
          const before = app.state.items[0].triggerAt;
          if (chip) chip.click();
          await new Promise(r => setTimeout(r, 50));
          const apply = document.querySelector('#btnApplySnooze');
          if (apply) apply.click();
          await new Promise(r => setTimeout(r, 150));
          const item = app.state.items[0];
          const sheetClosedAfterApply = !document.querySelector('#sheetSnooze').classList.contains('open');
          const due = new Date(); due.setHours(20, 0, 0, 0);
          if (due.getTime() < Date.now()) due.setDate(due.getDate() + 1);
          const triggerAdvanced = item.triggerAt === due.getTime();
          return { ready, buttonFound: !!button, sheetOpen,
            customAfterChipNonEmpty: customAfterChip !== '', chipOnAfterChip,
            customAfterReopenEmpty: customAfterReopen === '', chipOnAfterReopen, stillOpen,
            closedBeforeReopen, emptyConfirmBlocked,
            sheetClosedAfterApply, triggerAdvanced, errors };
        })()""")
        print(json.dumps(result, ensure_ascii=False))
        if not result or not result.get("ready") or not result.get("buttonFound"):
            raise SystemExit("precondition failed")
        checks = [
            result["sheetOpen"] is True,
            result["customAfterChipNonEmpty"] is True and result["chipOnAfterChip"] is True,
            result["customAfterReopenEmpty"] is True and result["chipOnAfterReopen"] is False and result["stillOpen"] is True and result["closedBeforeReopen"] is True and result["emptyConfirmBlocked"] is True,
            result["sheetClosedAfterApply"] is True and result["triggerAdvanced"] is True,
            not result.get("errors"),
        ]
        if all(checks):
            print("U1_REAL_CHROME=PASS")
            raise SystemExit(0)
        raise SystemExit("U1_REAL_CHROME=FAIL checks=" + json.dumps(checks))
    finally:
        process.terminate()
        try:
            process.wait(timeout=3)
        except Exception:
            pass
        server.shutdown()
