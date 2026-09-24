#!/usr/bin/env python3
"""F01–F03 修复后的**真实浏览器**复验。

独立复验方此前用真实 Chrome 复现了三个缺口（缺native仍可存不排程 / null与空壳被放行 /
补载后重试仍调旧绑定）。本脚本用**同样的手段**（headless Chrome + CDP、隔离 browser
context、本地 18771/18772 端口、不加载 Service Worker、不连接任何真实用户数据）
复跑**修复后**的关键路径：

  A control          完整脚本 ⇒ ready=true；中文输入 → 保存 → 重启后仍在
  B missing-parser   lib/parse-cn.js 先 404 ⇒ 失败面板；**补载后点「重试」** ⇒ 可用且落库
  C missing-native   lib/native-reminders.js 404 ⇒ ready=false 且面板点名（F01）
  D feedback-member  删掉 Feedback.setupSteps ⇒ ready=false 且点名该成员（F02）
  E feedback-null    Feedback=null ⇒ ready=false 且点名（F02）
  F shell-ui         createUi 返回空壳 ⇒ ready=false 且点名实例 API（F02）
  G feedback-array-object  TEST_FEEDBACK={} ⇒ ready=false 且点名数组契约（F02-R3）
  H feedback-array-item    TEST_FEEDBACK 元素缺 label ⇒ 同样在启动前失败（F02-R3）

注意：普通 Chrome 里 `window.Capacitor` 本来就不存在 —— 所以**每一个用例都是纯 Web**。
「脚本齐全的纯 Web 要正常」由 A 覆盖，「缺一支必需 JS 模块要失败」由 C 覆盖，
两者是同一次运行里的对照。

每个新文档在**任何页面脚本之前**装上 `indexedDB` 计量器（`open` 次数 + 写操作次数）：
F01/F02 的关键不是面板写了什么，而是**副作用有没有发生**。control 的写操作必须 ≥1
（证明计量器有牙齿，否则故障用例里的 0 是恒真断言）。

用法：/usr/bin/python3 scripts/verification/browser-recovery-check.py
      （输出目录用环境变量 `BROWSER_CHECK_OUT` 覆盖，默认 /tmp/attention-browser-recovery；
        没有失败时退出码 0，有断言不满足时退出码 1）
产出：<输出目录>/browser-recovery.json、browser-recovery.log、chrome.log
"""

import base64
import json
import os
import pathlib
import subprocess
import threading
import time
import urllib.request
import http.server

import websocket

# ⚠️ 本机 `~/.zshrc` 设了 `HTTPS_PROXY=http://127.0.0.1:7892`。若把代理环境变量留给
# `urllib` / `websocket-client`，它们会把 `http://127.0.0.1:18772`（Chrome 的 CDP 端口）
# 也送去代理 —— 现象是「Chrome 明明起来了却探测不到端口」，极容易误判成 Chrome 启动失败。
for _k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(_k, None)
os.environ["no_proxy"] = "*"
os.environ["NO_PROXY"] = "*"

ROOT = pathlib.Path(__file__).resolve().parents[2]
# 产物（含 Chrome profile）默认落在 /tmp：它是临时数据，不该污染仓库。
RUN = pathlib.Path(os.environ.get("BROWSER_CHECK_OUT", "/tmp/attention-browser-recovery"))
RUN.mkdir(parents=True, exist_ok=True)

HTTP_PORT = 18771
CDP_PORT = 18772
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# 每次导航要挡掉的文件（用例可改）。None = 全放行。
STATE = {"block": None}

PATCHES = {
    "missing-native": ("lib/native-reminders.js", None),      # 始终 404
    "feedback-member": ("lib/feedback.js", "delete AttentionLib.Feedback.setupSteps;"),
    "feedback-null": ("lib/feedback.js", "AttentionLib.Feedback = null;"),
    "shell-ui": ("lib/app-ui.js", "AttentionLib.AppUi.createUi = () => ({});"),
    # F02-R3：`Feedback.TEST_FEEDBACK` 是**数组契约**（真实消费者直接 `.map(x => x.value…)`）。
    # 只按 object 校验时，`{}` / 缺字段清单会让应用宣告就绪，进到那一屏才抛
    # `list.map is not a function`（第四次独立复验的阻断形态）。
    "feedback-array-object": ("lib/feedback.js", "AttentionLib.Feedback.TEST_FEEDBACK = {};"),
    "feedback-array-item": ("lib/feedback.js",
                            'AttentionLib.Feedback.TEST_FEEDBACK = [{ value: "heard" }];'),
    # P2-A：AI 能力已整体迁出为 lib/app-ai.js。它的缺件形态是**静默**的
    # （界面照常、只有 AI 按钮点了没反应），所以闸门必须拦 —— 浏览器层复证一次。
    "shell-ai": ("lib/app-ai.js", "AttentionLib.AppAi.createAppAi = () => ({});"),
    # P2-C：备份能力已整体迁出为 lib/app-backup.js。缺件形态与 AI 同类且更危险：
    # 「导出」点了没反应，用户会以为备份好了 —— 浏览器层复证闸门拦得住。
    "shell-backup": ("lib/app-backup.js", "AttentionLib.AppBackup.createAppBackup = () => ({});"),
}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        route = self.path.split("?", 1)[0].strip("/").split("/", 1)
        case = route[0]
        rel = route[1] if len(route) > 1 else "index.html"
        file = ROOT / rel
        if (not file.is_file()) or rel == "sw.js":
            self.send_error(404)
            return
        blocked = STATE["block"]
        if blocked and rel == blocked:
            self.send_error(404)
            return
        patch_target, patch_code = PATCHES.get(case, (None, None))
        data = file.read_bytes()
        if patch_target == rel and patch_code:
            data += ("\n" + patch_code).encode()
        ctype = ("text/html" if rel.endswith(".html")
                 else "text/javascript" if rel.endswith(".js")
                 else "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, origin="http://localhost:%d" % CDP_PORT, timeout=20)
        self.i = 0

    def call(self, method, params=None, session_id=None):
        self.i += 1
        msg = {"id": self.i, "method": method, "params": params or {}}
        if session_id:
            msg["sessionId"] = session_id
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.i:
                if "error" in r:
                    raise RuntimeError(r["error"])
                return r.get("result", {})

    def evaluate(self, session_id, expression):
        r = self.call("Runtime.evaluate", {
            "expression": expression, "awaitPromise": True, "returnByValue": True
        }, session_id)
        if "exceptionDetails" in r:
            return {"exception": str(r["exceptionDetails"].get("text"))}
        return r.get("result", {}).get("value")


READY = """
(async () => {
  const app = window.__ATTENTION_INBOX__;
  if (!app) return { hook: false };
  const ready = await app.ready();
  return {
    hook: true,
    ready: ready,
    failure: app.startupFailure(),
    panel: !!document.getElementById('startup-dependency-failure'),
    panelText: (document.getElementById('startup-dependency-failure') || {}).textContent || '',
    bindings: app.runtimeBindings ? app.runtimeBindings() : null
  };
})()
"""

CAPTURE_AND_SAVE = """
(async () => {
  const app = window.__ATTENTION_INBOX__;
  let err = null;
  try {
    app.openCapture();
    const t = document.querySelector('#capText');
    if (!t) return { err: 'no #capText' };
    t.value = '三分钟后提醒我独立验收';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    app.saveItemFromForm();
  } catch (e) { err = String((e && e.message) || e); }
  await new Promise(r => setTimeout(r, 900));
  return {
    err: err,
    items: app.state.items.length,
    titles: app.state.items.map(i => i.title),
    parse: typeof app.parseChineseTime
  };
})()
"""

RELOAD_COUNT = """
(async () => {
  const app = window.__ATTENTION_INBOX__;
  if (!app) return { hook: false };
  await app.ready();
  await new Promise(r => setTimeout(r, 300));
  return { items: app.state.items.length, titles: app.state.items.map(i => i.title) };
})()
"""

RETRY_AFTER_LOAD = """
(async () => {
  const s = document.createElement('script');
  s.src = 'lib/parse-cn.js';
  const loaded = await new Promise(res => {
    s.onload = () => res(true); s.onerror = () => res(false);
    document.head.appendChild(s);
  });
  const app = window.__ATTENTION_INBOX__;
  const ok = await app.startApp();
  return { scriptLoaded: loaded, ready: ok, bindings: app.runtimeBindings() };
})()
"""

# 独立复验的 F01/F02 表格里，关键行是「**事项真的落库了**，却一条都不排」和
# 「ready=false 但**已经打开 IDB**」。只读面板文字证明不了「副作用没发生」——
# 面板文案里那句「本次未加载数据、未做迁移」是**产品自己的说法**，不是证据。
# 所以这里在每个新文档里先装一个计量器：`indexedDB.open` 次数 + `IDBObjectStore.put/add/delete/clear`
# 次数。control 用例的 put 必须 ≥1（证明计量器有牙齿），故障用例必须是 0。
IDB_PROBE = """
(() => {
  const m = { opens: 0, puts: 0, names: [], error: null };
  window.__IDB_METER__ = m;
  try {
    const proto = window.IDBFactory && window.IDBFactory.prototype;
    if (proto && typeof proto.open === 'function') {
      const orig = proto.open;
      proto.open = function (name, version) {
        m.opens++; m.names.push(String(name));
        return orig.apply(this, arguments);
      };
    }
    const store = window.IDBObjectStore && window.IDBObjectStore.prototype;
    if (store) {
      ['put', 'add', 'delete', 'clear'].forEach(function (k) {
        const orig = store[k];
        if (typeof orig !== 'function') return;
        store[k] = function () { m.puts++; return orig.apply(this, arguments); };
      });
    }
  } catch (e) { m.error = String((e && e.message) || e); }
  return true;
})()
"""

IDB_METER = """
(() => {
  const m = window.__IDB_METER__;
  if (!m) return { opens: null, puts: null, error: 'meter missing' };
  return { opens: m.opens, puts: m.puts, names: m.names, error: m.error };
})()
"""


def main():
    log = open(RUN / "browser-recovery.log", "w")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    chrome_log = open(RUN / "chrome.log", "w")
    profile = RUN / "browser-profile"
    proc = subprocess.Popen([
        CHROME, "--headless=new",
        # 本机沙箱会挡住 Chrome 自己的进程沙箱（`sandbox initialization failed`），
        # 表现为「Network service crashed → GPU process isn't usable. Goodbye.」。
        # 这里是**验证脚本**，只用来说服自己「浏览器里的行为与预期一致」，
        # 不加载任何真实用户数据，所以关掉渲染进程沙箱是合适的。
        "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        "--remote-debugging-port=%d" % CDP_PORT,
        "--remote-allow-origins=http://localhost:%d" % CDP_PORT,
        "--user-data-dir=" + str(profile),
        "--no-first-run", "--no-default-browser-check", "about:blank"
    ], stdout=chrome_log, stderr=chrome_log)

    results = []
    info = None
    try:
        for _ in range(80):
            try:
                info = json.load(urllib.request.urlopen("http://127.0.0.1:%d/json/version" % CDP_PORT))
                break
            except Exception:
                time.sleep(0.1)
        if not info:
            raise RuntimeError("chrome 没起来")
        browser = CDP(info["webSocketDebuggerUrl"])

        def run_case(case, steps):
            ctx = browser.call("Target.createBrowserContext")["browserContextId"]
            tgt = browser.call("Target.createTarget",
                               {"url": "about:blank", "browserContextId": ctx})["targetId"]
            sess = browser.call("Target.attachToTarget", {"targetId": tgt, "flatten": True})["sessionId"]
            browser.call("Runtime.enable", {}, sess)
            browser.call("Page.enable", {}, sess)
            # 计量器必须在**任何页面脚本求值之前**装好，否则会漏掉启动期的 IDB 打开。
            browser.call("Page.addScriptToEvaluateOnNewDocument", {"source": IDB_PROBE}, sess)
            out = {"case": case}
            try:
                for name, fn in steps:
                    out[name] = fn(sess)
            except Exception as e:  # noqa: BLE001
                out["error"] = str(e)
            finally:
                try:
                    browser.call("Target.disposeBrowserContext", {"browserContextId": ctx})
                except Exception:
                    pass
            results.append(out)
            log.write(json.dumps(out, ensure_ascii=False, default=str) + "\n")
            log.flush()
            print(json.dumps(out, ensure_ascii=False, default=str))

        def nav(case):
            def step(sess):
                STATE["block"] = None
                browser.call("Page.navigate",
                             {"url": "http://127.0.0.1:%d/%s/index.html" % (HTTP_PORT, case)}, sess)
                time.sleep(1.4)
                return True
            return ("navigate", step)

        def ev(expr):
            return lambda sess: browser.evaluate(sess, expr)

        # A：完整脚本。普通 Chrome = 纯 Web（没有 Capacitor 桥）。
        run_case("control", [nav("control"), ("ready", ev(READY)),
                             ("save", ev(CAPTURE_AND_SAVE)),
                             ("sideEffects", ev(IDB_METER)),
                             ("reload", lambda sess: (browser.call("Page.reload", {}, sess),
                                                      time.sleep(1.6), True)[2]),
                             ("afterReload", ev(RELOAD_COUNT))])

        # B：先挡掉解析器 ⇒ 失败；补载后点重试 ⇒ 必须真的可用。
        def nav_blocked(sess):
            STATE["block"] = "lib/parse-cn.js"
            browser.call("Page.navigate",
                         {"url": "http://127.0.0.1:%d/missing-parser/index.html" % HTTP_PORT}, sess)
            time.sleep(1.4)
            return True

        def unblock(sess):
            STATE["block"] = None
            return True

        run_case("missing-parser", [("navigateBlocked", nav_blocked),
                                    ("readyBefore", ev(READY)),
                                    ("sideEffects", ev(IDB_METER)),
                                    ("unblock", unblock),
                                    ("retry", ev(RETRY_AFTER_LOAD)),
                                    ("save", ev(CAPTURE_AND_SAVE)),
                                    ("sideEffectsAfterRetry", ev(IDB_METER))])

        # C：缺 lib/native-reminders.js ⇒ 必须失败（F01）。
        def nav_missing_native(sess):
            STATE["block"] = "lib/native-reminders.js"
            browser.call("Page.navigate",
                         {"url": "http://127.0.0.1:%d/missing-native/index.html" % HTTP_PORT}, sess)
            time.sleep(1.4)
            return True

        run_case("missing-native", [("navigate", nav_missing_native), ("ready", ev(READY)),
                                    ("sideEffects", ev(IDB_METER))])

        # D/E/F：模块在、但成员/对象/实例不完整（F02）。
        # G/H：`Feedback.TEST_FEEDBACK` 形状不对（F02-R3 —— 数组契约不是 `object` 能顶的）。
        # I：P2-A —— AI 工厂空壳；J：P2-C —— 备份工厂空壳（静默缺件的浏览器层复证）。
        for case in ("feedback-member", "feedback-null", "shell-ui",
                     "feedback-array-object", "feedback-array-item",
                     "shell-ai", "shell-backup"):
            run_case(case, [nav(case), ("ready", ev(READY)), ("sideEffects", ev(IDB_METER))])

        # J：P2-A —— 整支 lib/app-ai.js 404；K：P2-C —— 整支 lib/app-backup.js 404
        # ⇒ 闸门必须点名对应能力系且失败前零副作用。
        def nav_blocked_script(script, case):
            def step(sess):
                STATE["block"] = script
                browser.call("Page.navigate",
                             {"url": "http://127.0.0.1:%d/%s/index.html" % (HTTP_PORT, case)}, sess)
                time.sleep(1.4)
                return True
            return step

        run_case("missing-app-ai", [("navigate", nav_blocked_script("lib/app-ai.js", "missing-app-ai")),
                                    ("ready", ev(READY)), ("sideEffects", ev(IDB_METER))])
        run_case("missing-app-backup", [("navigate", nav_blocked_script("lib/app-backup.js", "missing-app-backup")),
                                        ("ready", ev(READY)), ("sideEffects", ev(IDB_METER))])

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        server.shutdown()
        (RUN / "browser-recovery.json").write_text(
            json.dumps(results, ensure_ascii=False, indent=2, default=str))
        log.close()
        chrome_log.close()

    print("\n=== 汇总 ===")
    failures = []
    for r in results:
        case = r["case"]
        ready = (r.get("ready") or {}).get("ready")
        ready_before = (r.get("readyBefore") or {})
        save = r.get("save") or {}
        se = r.get("sideEffects") or {}
        se_after = r.get("sideEffectsAfterRetry") or {}
        after = r.get("afterReload") or {}
        checks = []
        if case == "control":
            checks = [
                ("ready=true", ready is True),
                ("保存后事项=1", save.get("items") == 1),
                ("重启后仍在", after.get("items") == 1),
                # 计量器有牙齿：正常路径必须真的写了库，否则下面那些 0 毫无意义
                ("写入库≥1（计量器有牙齿）", (se.get("puts") or 0) >= 1),
            ]
        elif case == "missing-parser":
            checks = [
                ("补载前 ready=false", ready_before.get("ready") is False),
                ("补载前有失败面板", ready_before.get("panel") is True),
                ("补载前不写库", (se.get("puts") or 0) == 0),
                ("重试后 ready=true", (r.get("retry") or {}).get("ready") is True),
                ("重试后绑定是当前解析器",
                 ((r.get("retry") or {}).get("bindings") or {}).get("parseChineseTime") == "current"),
                ("重试后能保存", save.get("items") == 1),
                ("重试后确实写库", (se_after.get("puts") or 0) >= 1),
            ]
        elif case in ("feedback-array-object", "feedback-array-item"):
            failure = (r.get("ready") or {}).get("failure") or []
            hit = [p for p in failure if p.get("path") == "Feedback.TEST_FEEDBACK"]
            checks = [
                ("ready=false", ready is False),
                ("有可见失败面板", (r.get("ready") or {}).get("panel") is True),
                ("失败前不写库", (se.get("puts") or 0) == 0),
                ("失败前不开库", (se.get("opens") or 0) == 0),
                # 关键：点名的必须是**数组契约**，不是笼统的 object
                ("点名 Feedback.TEST_FEEDBACK 且期望是数组", len(hit) == 1
                 and str(hit[0].get("expected", "")).startswith("array")),
            ]
        elif case in ("shell-ai", "missing-app-ai", "shell-backup", "missing-app-backup"):
            failure = (r.get("ready") or {}).get("failure") or []
            prefix = "AppAi" if case in ("shell-ai", "missing-app-ai") else "AppBackup"
            checks = [
                ("ready=false", ready is False),
                ("有可见失败面板", (r.get("ready") or {}).get("panel") is True),
                ("失败前不写库", (se.get("puts") or 0) == 0),
                ("失败前不开库", (se.get("opens") or 0) == 0),
                # 缺该能力不连带报一片：失败清单必须全是本能力系的
                ("失败清单点名 " + prefix + " 系", len(failure) >= 1
                 and all(str(p.get("path", "")).startswith(prefix) for p in failure)),
            ]
        else:
            checks = [
                ("ready=false", ready is False),
                ("有可见失败面板", (r.get("ready") or {}).get("panel") is True),
                ("失败前不写库", (se.get("puts") or 0) == 0),
                ("失败前不开库", (se.get("opens") or 0) == 0),
            ]
        bad = [n for n, good in checks if not good]
        failures += [(case, n) for n in bad]
        print("%-18s ready=%-5s opens=%-3s puts=%-3s  %s"
              % (case, ready, se.get("opens"), se.get("puts"),
                 "PASS" if not bad else "FAIL: " + "; ".join(bad)))
    print("\n总计 %d 个用例，%d 项断言不满足" % (len(results), len(failures)))
    for case, name in failures:
        print("  ✗ %s / %s" % (case, name))
    return 1 if failures else 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
