#!/usr/bin/env python3
"""只读基线采集（vivo-resume-recheck）：应用内 settings / diag / 首页卡片 / 事项 ID 集合。
不改任何状态。完整内容（含事项标题）进归档目录；仓库目录只放脱敏（仅 ID/状态）。
"""
import os, time, json, subprocess, urllib.request

for k in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy'):
    os.environ.pop(k, None)
os.environ['NO_PROXY'] = '*'; os.environ['no_proxy'] = '*'

import websocket

SERIAL = "10ACBF2D3D000RS"
PACKAGE = "space.alliswell.inbox"
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
RUN_ID = "20260926T005700Z-vivo-resume-recheck"
REPO_RUN = os.path.join("/Users/qlyf/Developer/reminder", "docs/reviews/verification-runs", RUN_ID)
ARCH_RUN = os.path.expanduser(f"~/Developer/reminder-archive/verification-runs/{RUN_ID}")
LOG_PATH = os.path.join(REPO_RUN, "run.log")
PORT = 53422

def adb_cmd(args):
    return subprocess.run([ADB, "-s", SERIAL] + args, capture_output=True, text=True).stdout.strip()

def log(msg):
    ms = adb_cmd(["shell", "date", "+%s%3N"])
    from datetime import datetime
    try: ms_i = int(ms)
    except: ms_i = int(time.time()*1000)
    line = f"[{datetime.fromtimestamp(ms_i/1000.0).strftime('%Y-%m-%d %H:%M:%S')}] [{ms_i}] [BASELINE-APP] {msg}"
    print(line, flush=True)
    for p in (LOG_PATH, os.path.join(ARCH_RUN, "run.log")):
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")

def cdp_eval(expr, await_promise=False):
    pid = adb_cmd(["shell", "pidof", PACKAGE])
    subprocess.run([ADB, "-s", SERIAL, "forward", f"tcp:{PORT}", f"localabstract:webview_devtools_remote_{pid}"], capture_output=True)
    time.sleep(0.4)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    targets = json.loads(opener.open(f"http://127.0.0.1:{PORT}/json", timeout=5).read().decode())
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

def shot_execout(tag):
    raw = subprocess.run([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"], capture_output=True).stdout
    ok = raw[:4] == b"\x89PNG"
    for base, d in ((REPO_RUN, "screenshots-sanitized"), (ARCH_RUN, "screenshots")):
        os.makedirs(os.path.join(base, d), exist_ok=True)
        with open(os.path.join(base, d, f"{tag}.png"), "wb") as f: f.write(raw)
    return ok

def main():
    log("=== baseline: app-side read-only start ===")
    log("focus: " + adb_cmd(["shell", "dumpsys window | grep mCurrentFocus"]))

    items = cdp_eval("window.__ATTENTION_INBOX__.state.items.map(x => ({id: x.id, title: x.title, status: x.status, rev: x.rev, priority: x.priority, triggerAt: x.triggerAt}))")
    log(f"items count: {len(items)}")
    with open(os.path.join(ARCH_RUN, "baseline-items-full.json"), "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    sanitized = [{k: i[k] for k in ("id","status","rev","priority","triggerAt")} for i in items]
    with open(os.path.join(REPO_RUN, "baseline-items-sanitized.json"), "w", encoding="utf-8") as f:
        json.dump(sanitized, f, ensure_ascii=False, indent=1)
    log(f"item id set: {json.dumps(sorted([i['id'] for i in items]))}")

    settings = cdp_eval("window.__ATTENTION_INBOX__.state.settings")
    keys = ['setupPromptStarted','setupDismissed','backgroundVisited','overlayVisited','testRun','testFeedback','defaultDeliveryMode']
    subset = {k: settings.get(k) for k in keys}
    log(f"settings subset: {json.dumps(subset, ensure_ascii=False)}")
    with open(os.path.join(REPO_RUN, "baseline-settings.json"), "w", encoding="utf-8") as f:
        json.dump(subset, f, ensure_ascii=False, indent=1)

    diag = cdp_eval("(function(){var s=window.__ATTENTION_INBOX__.nativeState||window.__ATTENTION_INBOX__.state.native||{};return s.diag||s.status&&s.status.diag||null})()")
    log(f"diag: {json.dumps(diag)}")
    with open(os.path.join(REPO_RUN, "baseline-diag.json"), "w", encoding="utf-8") as f:
        json.dump(diag, f, ensure_ascii=False, indent=1)

    home = cdp_eval("(function(){var h=document.querySelector('#homeSetup');return {exists:!!h,isEmpty:h?h.innerHTML.trim()==='':null,text:h?h.textContent.trim().slice(0,120):null}})()")
    sheet = cdp_eval("(function(){var s=document.querySelector('#sheetSetup');return {exists:!!s,open:s?s.classList.contains('open'):null}})()")
    log(f"homeSetup: {json.dumps(home, ensure_ascii=False)}")
    log(f"sheetSetup: {json.dumps(sheet)}")
    with open(os.path.join(REPO_RUN, "baseline-ui.json"), "w", encoding="utf-8") as f:
        json.dump({"homeSetup": home, "sheetSetup": sheet}, f, ensure_ascii=False, indent=1)

    ok = shot_execout("baseline_home")
    log(f"screenshot baseline_home saved png_magic_ok={ok}")
    log("=== baseline: app-side read-only end ===")

if __name__ == "__main__":
    main()
