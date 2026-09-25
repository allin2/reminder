#!/usr/bin/env python3
"""只读现场巡检（续跑 20260925T153500Z-vivo-switch-matrix 前的现场确认）。
不改任何状态：只 CDP 读事项/设置/diag/SW 缓存版本 + dumpsys 截图留存。
"""
import os, sys, time, json, subprocess, urllib.request

for k in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy'):
    os.environ.pop(k, None)
os.environ['NO_PROXY'] = '*'; os.environ['no_proxy'] = '*'

import websocket

SERIAL = "10ACBF2D3D000RS"
PACKAGE = "space.alliswell.inbox"
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
RUN_ID = "20260925T153500Z-vivo-switch-matrix"
REPO_DIR = "/Users/qlyf/Developer/reminder"
REPO_RUN = os.path.join(REPO_DIR, "docs/reviews/verification-runs", RUN_ID)
ARCH_RUN = os.path.expanduser(f"~/Developer/reminder-archive/verification-runs/{RUN_ID}")
LOG_PATH = os.path.join(REPO_RUN, "run.log")
PORT = 53421

def adb_cmd(args):
    return subprocess.run([ADB, "-s", SERIAL] + args, capture_output=True, text=True).stdout.strip()

def log(msg):
    ms = adb_cmd(["shell", "date", "+%s%3N"])
    from datetime import datetime
    try: ms_i = int(ms)
    except: ms_i = int(time.time()*1000)
    line = f"[{datetime.fromtimestamp(ms_i/1000.0).strftime('%Y-%m-%d %H:%M:%S')}] [{ms_i}] [RESUME-INSPECT] {msg}"
    print(line, flush=True)
    for p in (LOG_PATH, os.path.join(ARCH_RUN, "run.log")):
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")

def cdp_eval(expr, port=PORT, await_promise=True):
    pid = adb_cmd(["shell", "pidof", PACKAGE])
    subprocess.run([ADB, "-s", SERIAL, "forward", f"tcp:{port}", f"localabstract:webview_devtools_remote_{pid}"], capture_output=True)
    time.sleep(0.4)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    targets = json.loads(opener.open(f"http://127.0.0.1:{port}/json", timeout=5).read().decode())
    page = next(t for t in targets if t.get('type') == 'page')
    ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)
    payload = {"id": 1, "method": "Runtime.evaluate",
               "params": {"expression": expr, "returnByValue": True, "awaitPromise": await_promise}}
    ws.send(json.dumps(payload))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            ws.close()
            res = msg.get("result", {})
            if "exceptionDetails" in res: raise RuntimeError(f"CDP Exception: {res['exceptionDetails']}")
            return res.get("result", {}).get("value")

ITEM_MAP_JS = """window.__ATTENTION_INBOX__.state.items.map(x => ({
  id: x.id, title: x.title, status: x.status, rev: x.rev, triggerAt: x.triggerAt,
  snoozedAt: x.snoozedAt, snoozeCount: x.snoozeCount, acknowledgedAt: x.acknowledgedAt,
  priority: x.priority, delivery_mode: x.delivery_mode
}))"""

def main():
    log("=== resume: read-only site inspection start ===")
    # 屏幕与焦点
    log("wake: " + adb_cmd(["shell", "dumpsys power | grep 'mWakefulness=' | head -1"]))
    log("focus: " + adb_cmd(["shell", "dumpsys window | grep mCurrentFocus"]))

    items = cdp_eval(ITEM_MAP_JS)
    log(f"items snapshot: {json.dumps(items, ensure_ascii=False)}")
    switch_items = [i for i in items if str(i.get('title','')).startswith('SWITCH-')]
    log(f"leftover SWITCH-* items: {json.dumps(switch_items, ensure_ascii=False)}")

    settings = cdp_eval("window.__ATTENTION_INBOX__.state.settings")
    keys = ['setupPromptStarted','setupDismissed','backgroundVisited','overlayVisited','testRun','testFeedback','defaultDeliveryMode']
    log(f"settings subset: {json.dumps({k: settings.get(k) for k in keys}, ensure_ascii=False)}")

    diag = cdp_eval("window.__ATTENTION_INBOX__.diag ? window.__ATTENTION_INBOX__.diag : (window.__ATTENTION_INBOX__.nativeState && window.__ATTENTION_INBOX__.nativeState.diag) ? window.__ATTENTION_INBOX__.nativeState.diag : null")
    log(f"diag: {json.dumps(diag)}")

    cache_keys = cdp_eval("caches.keys()")
    log(f"cache keys: {json.dumps(cache_keys)}")

    # setupSteps 输出（只读）
    steps = cdp_eval("typeof Feedback!=='undefined' && typeof setupStepsContext!=='undefined' ? Feedback.setupSteps(window.__ATTENTION_INBOX__.nativeState || window.__ATTENTION_INBOX__.state.native, setupStepsContext()) : 'N/A'")
    log(f"setupSteps: {json.dumps(steps, ensure_ascii=False)[:2000]}")

    # 截图留档
    for d in ("screenshots",):
        for base in (REPO_RUN, ARCH_RUN):
            os.makedirs(os.path.join(base, d), exist_ok=True)
    raw = subprocess.run([ADB, "-s", SERIAL, "shell", "screencap", "-p"], capture_output=True).stdout.replace(b"\r\n", b"\n")
    rel = "screenshots/resume_inspect_home.png"
    for base in (REPO_RUN, ARCH_RUN):
        with open(os.path.join(base, rel), "wb") as f: f.write(raw)
    log(f"saved {rel}")
    log("=== resume: read-only site inspection end ===")

if __name__ == '__main__':
    main()
