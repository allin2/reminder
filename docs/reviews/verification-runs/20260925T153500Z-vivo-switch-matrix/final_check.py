#!/usr/bin/env python3
"""收尾核查：diag 回读、setupSteps、homeCard、事项基线、无残留。只读。"""
import os, time, json, subprocess, urllib.request

for k in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy'):
    os.environ.pop(k, None)
os.environ['NO_PROXY'] = '*'; os.environ['no_proxy'] = '*'
import websocket

SERIAL = "10ACBF2D3D000RS"
PACKAGE = "space.alliswell.inbox"
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
RUN_ID = "20260925T153500Z-vivo-switch-matrix"
REPO_RUN = os.path.join("/Users/qlyf/Developer/reminder", "docs/reviews/verification-runs", RUN_ID)
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
    line = f"[{datetime.fromtimestamp(ms_i/1000.0).strftime('%Y-%m-%d %H:%M:%S')}] [{ms_i}] [FINAL-CHECK] {msg}"
    print(line, flush=True)
    for p in (LOG_PATH, os.path.join(ARCH_RUN, "run.log")):
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")

def cdp_eval(expr):
    # 真机坑：进程活着 ≠ devtools 可达（后台冻结后 /json 超时）—— 必须先 am start 拉前台
    adb_cmd(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
    time.sleep(2)
    pid = adb_cmd(["shell", "pidof", PACKAGE])
    if not pid:
        raise RuntimeError("app process not running after am start")
    subprocess.run([ADB, "-s", SERIAL, "forward", f"tcp:{PORT}", f"localabstract:webview_devtools_remote_{adb_cmd(['shell','pidof',PACKAGE])}"], capture_output=True)
    time.sleep(0.4)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    targets = json.loads(opener.open(f"http://127.0.0.1:{PORT}/json", timeout=5).read().decode())
    page = next(t for t in targets if t.get('type') == 'page')
    ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)
    ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
        "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            ws.close(); break
    res = msg.get("result", {})
    if "exceptionDetails" in res: raise RuntimeError(str(res["exceptionDetails"]))
    return res.get("result", {}).get("value")

ITEM_MAP_JS = """window.__ATTENTION_INBOX__.state.items.map(x => ({
  id: x.id, title: x.title, status: x.status, rev: x.rev, triggerAt: x.triggerAt,
  snoozedAt: x.snoozedAt, snoozeCount: x.snoozeCount, acknowledgedAt: x.acknowledgedAt
}))"""

def main():
    log("=== final integrity check start ===")
    val = cdp_eval("""(async () => {
      const I = window.__ATTENTION_INBOX__;
      const F = window.AttentionLib && window.AttentionLib.Feedback;
      const native = (typeof I.getNativeReminderStatus === 'function') ? I.getNativeReminderStatus() : null;
      const steps = F ? F.setupSteps(native, I.setupStepsContext()) : null;
      const el = document.querySelector('#homeSetup');
      return { native, steps, homeCard: el ? el.innerHTML : '' };
    })()""")
    nat = val.get("native") or {}
    diag = nat.get("diag") or {}
    log(f"diag.ignoringBatteryOptimizations={diag.get('ignoringBatteryOptimizations')} canDrawOverlays={diag.get('canDrawOverlays')} canUseFullScreenIntent={diag.get('canUseFullScreenIntent')}")
    steps = val.get("steps") or {}
    bg = next((s for s in steps.get("steps", []) if s.get("id") == "background"), None)
    log(f"setupSteps.background={json.dumps(bg, ensure_ascii=False)} next={json.dumps(steps.get('next'), ensure_ascii=False)}")
    log(f"homeCard={json.dumps(val.get('homeCard'), ensure_ascii=False)[:400]}")
    items = cdp_eval(ITEM_MAP_JS)
    log(f"items snapshot: {json.dumps(items, ensure_ascii=False)}")
    log(f"SWITCH leftovers: {[i['id'] for i in items if str(i.get('title','')).startswith('SWITCH-')]}")
    log("=== final integrity check end (dumpsys alarm/notification 由外部采集) ===")

if __name__ == "__main__":
    main()
