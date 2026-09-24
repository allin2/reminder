#!/usr/bin/env python3
"""P2-C-S：**真实浏览器 + 真实文件 input** 下的整库导入格式安全面复验。

独立诊断 `20260922T124205-independent-import-format-audit` 的结论是「只要
`Array.isArray(data.items)` 成立，文件就能覆盖本机数据」。本脚本用真实 Chrome 走
**生产路径**复验修复后的行为：

  · 文件不是伪对象 —— 在页面里 `new File([...])` + `DataTransfer` 塞进 `#importFile`
    并派发真实 `change` 事件，与用户点「导入」后选文件是同一条代码路径
    （`app-core` 的 change 监听 → `backup.importDataFile`）；
  · 副作用不是「产品自己的说法」—— 每个新文档在任何页面脚本之前装 IDB 计量器
    （`indexedDB.open` 次数 + `IDBObjectStore.put/add/delete/clear` 次数），
    导入前后各读一次，比的是**增量**；
  · 「没弹确认框」也不是看文案 —— 直接读 `#sheetConfirm` 的 `open` 类。

用例（每一组都是独立 browser context，互不共享 IDB）：

  control-valid          合法 schema 5 备份 ⇒ 弹确认 → 点确定 ⇒ 事项落库、IDB 有写
  control-cancel         同一份合法备份但点「取消」⇒ 零写入（证明确认框是真闸门）
  legacy-schema2         合法 schema 2 历史备份 ⇒ 同样可恢复（正向兼容面）
  wrong-app              别的应用的备份 ⇒ 不弹确认、不写库、提示「不是本应用的备份」
  future-schema          schema 999 ⇒ 不弹确认、不写库、提示「请先更新应用」
  missing-notes          缺 notes ⇒ 不弹确认、不写库（旧实现会静默清空全部笔记）
  notes-object           notes 错型 ⇒ 不弹确认、不写库
  duplicate-item-id      两个事项同 id ⇒ 不弹确认、不写库
  ai-secret-endpoint     文件里带 AI 密钥 + HTTP endpoint ⇒ 不弹确认、不写库
  unknown-settings-key   settings 未知键 ⇒ 不弹确认、不写库

用法：/usr/bin/python3 scripts/verification/browser-import-format-check.py
      （输出目录用 `IMPORT_CHECK_OUT` 覆盖，默认 /tmp/attention-import-format；
        全部断言满足退出码 0，否则 1）
产出：<输出目录>/browser-import-format.json、.log、chrome.log
"""

import http.server
import json
import os
import pathlib
import subprocess
import threading
import time
import urllib.request

import websocket

# 本机 `~/.zshrc` 设了 HTTPS_PROXY：不摘掉的话 127.0.0.1 的 CDP/HTTP 也会被送去代理，
# 现象是「Chrome 起来了却连不上端口」，极易误判成启动失败。
for _k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(_k, None)
os.environ["no_proxy"] = "*"
os.environ["NO_PROXY"] = "*"

ROOT = pathlib.Path(__file__).resolve().parents[2]
RUN = pathlib.Path(os.environ.get("IMPORT_CHECK_OUT", "/tmp/attention-import-format"))
RUN.mkdir(parents=True, exist_ok=True)

HTTP_PORT = 18781
CDP_PORT = 18782
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        route = self.path.split("?", 1)[0].strip("/").split("/", 1)
        rel = route[1] if len(route) > 1 else "index.html"
        file = ROOT / rel
        if (not file.is_file()) or rel == "sw.js":
            self.send_error(404)
            return
        ctype = ("text/html" if rel.endswith(".html")
                 else "text/javascript" if rel.endswith(".js")
                 else "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(file.read_bytes())


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, origin="http://localhost:%d" % CDP_PORT, timeout=30)
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


# 在任何页面脚本求值之前装好计量器：启动期的 IDB 打开/写入也要记到账上。
IDB_PROBE = """
(() => {
  const m = { opens: 0, puts: 0, names: [], error: null };
  window.__IDB_METER__ = m;
  try {
    const proto = window.IDBFactory && window.IDBFactory.prototype;
    if (proto && typeof proto.open === 'function') {
      const orig = proto.open;
      proto.open = function (name, version) { m.opens++; m.names.push(String(name)); return orig.apply(this, arguments); };
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

METER = "JSON.parse(JSON.stringify(window.__IDB_METER__ || {opens:null,puts:null}))"

BASE_SETTINGS = {
    "notify": True, "dnd": False, "importantRepeat": True,
    "quietStart": "22:00", "quietEnd": "07:00", "dailySummary": False,
    "privacyNotify": True, "defaultDeliveryMode": "notification", "userMode": "beginner",
    "ai": {"enabled": False, "baseUrl": "", "apiKey": "", "model": "m", "autoOnSave": False},
}


def base_payload():
    return {
        "app": "attention-inbox",
        "schema": 5,
        "exportedAt": "2026-09-22T08:00:00.000Z",
        "items": [{"id": "new-item", "title": "新事项", "status": "waiting"}],
        "notes": [{"id": "new-note", "text": "新备注", "createdAt": 2}],
        "projects": [{"id": "new-project", "name": "新项目", "color": "#fff"}],
        "settings": json.loads(json.dumps(BASE_SETTINGS)),
    }


def case(name, payload, expect_confirm, toast_pattern, click_confirm):
    return {"name": name, "payload": payload, "expect_confirm": expect_confirm,
            "toast": toast_pattern, "clickConfirm": click_confirm}


def build_cases():
    cases = []
    cases.append(case("control-valid", base_payload(), True, "导入成功", True))
    cases.append(case("control-cancel", base_payload(), True, None, False))

    legacy = base_payload()
    legacy["schema"] = 2
    legacy["settings"] = {"notify": False, "quietStart": "23:00", "quietEnd": "06:00"}
    legacy["notes"] = [{"id": "old-note", "text": "旧形态备注", "createdAt": 1}]
    cases.append(case("legacy-schema2", legacy, True, "导入成功", True))

    wrong_app = base_payload()
    wrong_app["app"] = "some-other-app"
    cases.append(case("wrong-app", wrong_app, False, "不是「安心收件箱」", False))

    future = base_payload()
    future["schema"] = 999
    cases.append(case("future-schema", future, False, "请先更新应用", False))

    missing_notes = base_payload()
    del missing_notes["notes"]
    cases.append(case("missing-notes", missing_notes, False, "备份格式不正确", False))

    notes_object = base_payload()
    notes_object["notes"] = {"id": "x"}
    cases.append(case("notes-object", notes_object, False, "备份格式不正确", False))

    dup = base_payload()
    dup["items"] = [{"id": "dup", "title": "A"}, {"id": "dup", "title": "B"}]
    cases.append(case("duplicate-item-id", dup, False, "备份格式不正确", False))

    secret = base_payload()
    secret["settings"]["ai"]["apiKey"] = "sk-live-injected"
    secret["settings"]["ai"]["baseUrl"] = "http://evil.invalid/v1"
    cases.append(case("ai-secret-endpoint", secret, False, "备份格式不正确", False))

    unknown = base_payload()
    unknown["settings"]["injected"] = "persist-me"
    cases.append(case("unknown-settings-key", unknown, False, "备份格式不正确", False))

    # B1（独立复验 20260922T134219）：真实设备 payload —— 含带时区 ISO createdAt 的
    # 历史数据。正向：必须进入确认、确认后 IDB put 0→1，并且在新页面（同一 context
    # 内重新导航 = 冷启动路径）读回的 item/note createdAt 必须是毫秒数字。
    device_path = ROOT / "docs/reviews/verification-runs/20260922T134219-independent-p2cs-recheck" / "evidence" / "device-preexisting-backup.json"
    device_payload = json.loads(device_path.read_text(encoding="utf-8"))
    legacy_iso = case("legacy-iso-time", device_payload, True, "导入成功", True)
    legacy_iso["expect_items"] = [i["id"] for i in device_payload["items"]]
    legacy_iso["expect_readback"] = True
    cases.append(legacy_iso)

    return cases


DRIVER = """
(async () => {
  const app = window.__ATTENTION_INBOX__;
  const out = { steps: [] };
  if (!app) return { hook: false };
  const ready = await app.ready();
  out.ready = ready;
  await new Promise(r => setTimeout(r, 200));
  out.itemsBefore = app.state.items.length;
  out.notesBefore = app.state.notes.length;
  out.meterBefore = JSON.parse(JSON.stringify(window.__IDB_METER__ || {}));

  const payload = window.__IMPORT_PAYLOAD__;
  const clickConfirm = !!window.__IMPORT_CLICK__;
  const input = document.querySelector('#importFile');
  if (!input) return { hook: true, err: 'no #importFile' };
  const dt = new DataTransfer();
  dt.items.add(new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  out.steps.push('change-dispatched');
  await new Promise(r => setTimeout(r, 700));

  const sheet = document.querySelector('#sheetConfirm');
  out.confirmOpen = !!sheet && sheet.classList.contains('open');
  out.confirmBody = (document.querySelector('#confirmBody') || {}).textContent || '';
  const toastEl = document.querySelector('#toastText');
  out.toast = toastEl ? toastEl.textContent : '';
  out.pendingState = {
    items: app.state.items.map(i => i.id),
    notes: app.state.notes.length,
    settingsKeys: Object.keys(app.state.settings || {}).sort()
  };
  out.meterAfterReject = JSON.parse(JSON.stringify(window.__IDB_METER__ || {}));

  if (out.confirmOpen && clickConfirm) {
    document.querySelector('#confirmOk').click();
    out.steps.push('clicked-ok');
    await new Promise(r => setTimeout(r, 1200));
  } else if (out.confirmOpen) {
    document.querySelector('#confirmCancel').click();
    out.steps.push('clicked-cancel');
    await new Promise(r => setTimeout(r, 800));
  }

  out.items = app.state.items.map(i => i.id);
  out.itemTitles = app.state.items.map(i => i.title);
  out.createdAtTypes = app.state.items.map(i => typeof i.createdAt);
  out.noteCreatedAtTypes = app.state.notes.map(n => typeof n.createdAt);
  out.notes = app.state.notes.length;
  out.projects = app.state.projects.length;
  out.settingsNotify = !!(app.state.settings && app.state.settings.notify);
  const toast2 = document.querySelector('#toastText');
  out.toastFinal = toast2 ? toast2.textContent : '';
  out.meter = JSON.parse(JSON.stringify(window.__IDB_METER__ || {}));
  const banner = document.getElementById('startup-dependency-failure');
  out.startupPanel = !!banner;
  return out;
})()
"""


# 冷启动读回：同一 browser context 里开一个**全新页面**（新文档、重新 boot、
# 从 IDB 重新加载），核对落库的时间是不是毫秒数字 —— 这是 B1 要求的「迁移不
# 把字符串写回权威状态」的浏览器侧判据。
READBACK = """
(async () => {
  const app = window.__ATTENTION_INBOX__;
  if (!app) return { hook: false };
  await app.ready();
  await new Promise(r => setTimeout(r, 300));
  return {
    items: app.state.items.map(i => ({ id: i.id, createdAtType: typeof i.createdAt })),
    notes: app.state.notes.map(n => ({ id: n.id, createdAtType: typeof n.createdAt }))
  };
})()
"""


def run_case(browser, spec, log):
    ctx = browser.call("Target.createBrowserContext")["browserContextId"]
    tgt = browser.call("Target.createTarget",
                       {"url": "about:blank", "browserContextId": ctx})["targetId"]
    sess = browser.call("Target.attachToTarget", {"targetId": tgt, "flatten": True})["sessionId"]
    browser.call("Runtime.enable", {}, sess)
    browser.call("Page.enable", {}, sess)
    browser.call("Page.addScriptToEvaluateOnNewDocument", {"source": IDB_PROBE}, sess)
    out = {"case": spec["name"]}
    try:
        browser.call("Page.navigate",
                     {"url": "http://127.0.0.1:%d/%s/index.html" % (HTTP_PORT, spec["name"])}, sess)
        time.sleep(1.8)
        # 载荷先塞进页面全局（避免把整段 JSON 拼进表达式），再 await 驱动脚本返回的 Promise。
        browser.evaluate(sess, "window.__IMPORT_PAYLOAD__ = " +
                         json.dumps(spec["payload"], ensure_ascii=False) + ";"
                         "window.__IMPORT_CLICK__ = " +
                         ("true" if spec["clickConfirm"] else "false") + "; true")
        out["observed"] = browser.evaluate(sess, DRIVER)
        if spec.get("expect_readback"):
            # 同一 context 内的新目标 = 新文档冷启动（IDB 持久化、脚本重新初始化）。
            tgt2 = browser.call("Target.createTarget",
                                {"url": "about:blank", "browserContextId": ctx})["targetId"]
            sess2 = browser.call("Target.attachToTarget",
                                 {"targetId": tgt2, "flatten": True})["sessionId"]
            try:
                browser.call("Runtime.enable", {}, sess2)
                browser.call("Page.enable", {}, sess2)
                browser.call("Page.navigate",
                             {"url": "http://127.0.0.1:%d/%s/index.html" % (HTTP_PORT, spec["name"])},
                             sess2)
                time.sleep(2.5)
                out["readback"] = browser.evaluate(sess2, READBACK)
            except Exception as e:  # noqa: BLE001
                out["readback_error"] = str(e)
            finally:
                try:
                    browser.call("Target.closeTarget", {"targetId": tgt2})
                except Exception:
                    pass
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)
    finally:
        try:
            browser.call("Target.disposeBrowserContext", {"browserContextId": ctx})
        except Exception:
            pass
    log.write(json.dumps(out, ensure_ascii=False, default=str) + "\n")
    log.flush()
    print(json.dumps(out, ensure_ascii=False, default=str))
    return out


def judge(spec, observed):
    # 驱动脚本只在「拿不到 app hook」时返回 {hook: false}；正常输出没有 hook 键。
    if not observed or observed.get("hook") is False:
        return ["拿不到测试 hook（页面没起来？）"]
    if not observed.get("ready"):
        return ["app.ready() 不为真"]
    if observed.get("startupPanel"):
        return ["出现启动失败面板"]
    bad = []
    meter_before = (observed.get("meterBefore") or {}).get("puts") or 0
    meter_after = (observed.get("meter") or {}).get("puts") or 0
    puts_delta = meter_after - meter_before
    confirm_open = observed.get("confirmOpen")
    items_after = observed.get("items") or []
    items_before = observed.get("itemsBefore")
    if confirm_open != spec["expect_confirm"]:
        bad.append("确认框期望 %s 实际 %s" % (spec["expect_confirm"], confirm_open))
    if spec["toast"] and spec["toast"] not in (observed.get("toastFinal") or ""):
        bad.append("提示不符：%r 不在 %r" % (spec["toast"], observed.get("toastFinal")))
    if spec["expect_confirm"]:
        if not confirm_open:
            bad.append("没进确认框，后续断言无意义")
        if spec["clickConfirm"]:
            expect_items = spec.get("expect_items", ["new-item"])
            missing = [i for i in expect_items if i not in items_after]
            if missing:
                bad.append("点确定后事项没落库（缺 %r）：%r" % (missing, items_after))
            if puts_delta < 1:
                bad.append("点确定后 IDB 没有任何写操作（计量器没有牙齿）：delta=%d" % puts_delta)
            bad_types = [t for t in (observed.get("createdAtTypes") or []) if t != "number"]
            if bad_types:
                bad.append("导入后 item createdAt 不是毫秒数字：%r" % (observed.get("createdAtTypes"),))
            bad_note_types = [t for t in (observed.get("noteCreatedAtTypes") or []) if t != "number"]
            if bad_note_types:
                bad.append("导入后 note createdAt 不是毫秒数字：%r" % (observed.get("noteCreatedAtTypes"),))
        else:
            if items_after != [] or observed.get("notes") not in (0, None):
                bad.append("点取消后内存被改动：items=%r notes=%r" % (items_after, observed.get("notes")))
            if puts_delta != 0:
                bad.append("点取消后仍写了 IDB：delta=%d" % puts_delta)
    else:
        if items_after != []:
            bad.append("被拒绝的文件改变了内存：%r" % (items_after,))
        if items_before not in (0, None):
            bad.append("对照组前置条件不成立（导入前 items=%r）" % (items_before,))
        if puts_delta != 0:
            bad.append("被拒绝的文件仍写了 IDB：delta=%d" % puts_delta)
        if observed.get("notes") not in (0, None):
            bad.append("被拒绝的文件改了 notes：%r" % (observed.get("notes"),))
    # B1 冷启动读回：新页面从 IDB 重新 boot 后，时间必须是毫秒数字（迁移不回写字符串）。
    if spec.get("expect_readback"):
        rb = observed.get("readback")
        if not rb or rb.get("hook") is False or not rb.get("items"):
            bad.append("冷启动读回失败（拿不到 app 或没有 items）：%r" % (rb,))
        else:
            rb_bad = [it for it in rb["items"] if it["createdAtType"] != "number"]
            rb_ids = sorted(it["id"] for it in rb["items"])
            if rb_bad:
                bad.append("冷启动读回的 item createdAt 不是毫秒数字：%r" % (rb_bad,))
            if rb_ids != sorted(spec.get("expect_items", [])):
                bad.append("冷启动读回的事项清单不符：%r" % (rb_ids,))
            if any(n["createdAtType"] != "number" for n in rb["notes"]):
                bad.append("冷启动读回的 note createdAt 不是毫秒数字：%r" % (rb["notes"],))
    return bad


def main():
    log = open(RUN / "browser-import-format.log", "w")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    chrome_log = open(RUN / "chrome.log", "w")
    proc = subprocess.Popen([
        CHROME, "--headless=new",
        # 沙箱不允许 Chrome 起自己的进程沙箱（chrome.log 里会是
        # "sandbox initialization failed" → "GPU process isn't usable"）。
        # 这是验证脚本，不加载任何真实用户数据。
        "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        "--remote-debugging-port=%d" % CDP_PORT,
        "--remote-allow-origins=http://localhost:%d" % CDP_PORT,
        "--user-data-dir=" + str(RUN / "browser-profile"),
        "--no-first-run", "--no-default-browser-check", "about:blank"
    ], stdout=chrome_log, stderr=chrome_log)

    results = []
    try:
        info = None
        for _ in range(80):
            try:
                info = json.load(urllib.request.urlopen("http://127.0.0.1:%d/json/version" % CDP_PORT))
                break
            except Exception:
                time.sleep(0.1)
        if not info:
            raise RuntimeError("chrome 没起来（见 chrome.log）")
        browser = CDP(info["webSocketDebuggerUrl"])
        for spec in build_cases():
            results.append(run_case(browser, spec, log))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        server.shutdown()
        (RUN / "browser-import-format.json").write_text(
            json.dumps(results, ensure_ascii=False, indent=2, default=str))
        log.close()
        chrome_log.close()

    print("\n=== 汇总 ===")
    failures = []
    for spec, res in zip(build_cases(), results):
        # 读回结果挂在结果顶层（run_case 里第二阶段产出），并进 observed 供 judge 统一判。
        res.setdefault("observed", {})["readback"] = res.get("readback")
        bad = judge(spec, res.get("observed") or {})
        obs = res.get("observed") or {}
        print("%-22s confirm=%-5s puts=%s→%s items=%s  %s"
              % (spec["name"], obs.get("confirmOpen"),
                 (obs.get("meterBefore") or {}).get("puts"),
                 (obs.get("meter") or {}).get("puts"),
                 obs.get("items"), "PASS" if not bad else "FAIL: " + "; ".join(bad)))
        failures += [(spec["name"], b) for b in bad]
    print("\n总计 %d 个用例，%d 项断言不满足" % (len(results), len(failures)))
    for name, b in failures:
        print("  ✗ %s / %s" % (name, b))
    return 1 if failures else 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
