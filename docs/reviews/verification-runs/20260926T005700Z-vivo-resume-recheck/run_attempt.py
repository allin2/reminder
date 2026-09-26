#!/usr/bin/env python3
"""vivo-resume-recheck 场景执行器（R1/R2/R3 各一次调用 = 一次尝试）。

只读钩子原则：WebView 内只做纯读采样与用户级点击（Input.dispatchTouchEvent）；
不写任何应用状态。所有时刻用设备时间（Date.now() 与 `date +%s%3N` 同源）。

用法：python run_attempt.py R1 a
产物（run 目录）：
  samples-<S>-<T>.jsonl   250ms 采样
  attempt-<S>-<T>.log     本尝试时间线
  screenshots-sanitized/ 与归档目录 screenshots/ 的关键截图
  dumpsys/ 的 uiautomator dump
"""
import os, sys, time, json, subprocess, re, threading, urllib.request

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
REPO_RUNLOG = os.path.join(REPO_RUN, "run.log")
PORT = 53423

SCEN = sys.argv[1] if len(sys.argv) > 1 else "R1"
TAG = sys.argv[2] if len(sys.argv) > 2 else "a"
ATTEMPT = f"{SCEN}-{TAG}"

SAMPLE_EXPR = """(function(){
  var h=document.querySelector('#homeSetup');
  var s=document.querySelector('#sheetSetup');
  var b=document.querySelector('#setupBody');
  var bgDone=null;
  if(b){var steps=b.querySelectorAll('.setup-step');
    for(var i=0;i<steps.length;i++){var hh=steps[i].querySelector('h4');
      if(hh&&hh.textContent.indexOf('允许完全后台运行')>=0){bgDone=steps[i].classList.contains('done');break}}}
  var st=window.__ATTENTION_INBOX__.getNativeReminderStatus();
  return {t:Date.now(),
    homeEmpty:h?h.innerHTML.trim()==='':null,
    homeText:h?(h.textContent||'').trim().slice(0,60):null,
    sheetOpen:s?s.classList.contains('open'):null,
    bgDone:bgDone,
    ignoring:(st&&st.diag)?st.diag.ignoringBatteryOptimizations:null,
    rr:(window.__RR_MUT__?{c:window.__RR_MUT__.count,last:window.__RR_MUT__.ts.length?window.__RR_MUT__.ts[window.__RR_MUT__.ts.length-1]:null}:null)};
})()"""

INSTALL_OBSERVER_JS = """(function(){
  if (window.__RR_MUT__) return 'already';
  var b=document.querySelector('#setupBody');
  if(!b) return 'nobody';
  window.__RR_MUT__={count:0,ts:[]};
  new MutationObserver(function(ms){window.__RR_MUT__.count+=ms.length;window.__RR_MUT__.ts.push(Date.now())})
    .observe(b,{childList:true,subtree:true});
  return 'installed';
})()"""

class CDP:
    def __init__(self):
        pid = self.adb(["shell", "pidof", PACKAGE])
        subprocess.run([ADB, "-s", SERIAL, "forward", f"tcp:{PORT}", f"localabstract:webview_devtools_remote_{pid}"], capture_output=True)
        time.sleep(0.5)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        targets = json.loads(opener.open(f"http://127.0.0.1:{PORT}/json", timeout=8).read().decode())
        page = next(t for t in targets if t.get('type') == 'page')
        self.ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)
        self.seq = 0
        self.lock = threading.Lock()
    def adb(self, args):
        return subprocess.run([ADB, "-s", SERIAL] + args, capture_output=True, text=True).stdout.strip()
    def eval(self, expr, await_promise=False):
        with self.lock:
            self.seq += 1
            i = self.seq
            self.ws.send(json.dumps({"id": i, "method": "Runtime.evaluate",
                                     "params": {"expression": expr, "returnByValue": True, "awaitPromise": await_promise}}))
            while True:
                m = json.loads(self.ws.recv())
                if m.get("id") == i:
                    res = m.get("result", {})
                    if "exceptionDetails" in res:
                        raise RuntimeError(f"CDP Exception: {json.dumps(res['exceptionDetails'])[:300]}")
                    return res.get("result", {}).get("value")
    def rect(self, selector):
        v = self.eval(f"""(function(){{var e=document.querySelector({json.dumps(selector)});if(!e)return null;
          var r=e.getBoundingClientRect();return {{x:r.left,y:r.top,w:r.width,h:r.height}};}})()""")
        return v
    def tap_selector(self, selector, wait=0.8):
        r = self.rect(selector)
        if not r or r["w"] <= 0:
            raise RuntimeError(f"element not found or zero rect: {selector}")
        x = r["x"] + r["w"]/2; y = r["y"] + r["h"]/2
        self.tap_xy(x, y)
        time.sleep(wait)
        return (x, y)
    def tap_xy(self, x, y):
        for typ, params in (("touchStart", {"touchPoints": [{"x": x, "y": y}]}),
                            ("touchEnd", {"touchPoints": []})):
            self.seq += 1
            self.ws.send(json.dumps({"id": self.seq, "method": "Input.dispatchTouchEvent",
                                     "params": {"type": typ, **params}}))
            while True:
                m = json.loads(self.ws.recv())
                if m.get("id") == self.seq: break

cdp = None
sampler_stop = threading.Event()
sample_count = [0]

def device_ms():
    out = subprocess.run([ADB, "-s", SERIAL, "shell", "date", "+%s%3N"], capture_output=True, text=True).stdout.strip()
    return int(out)

def log(msg):
    ms = device_ms()
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [{ms}] [ATTEMPT {ATTEMPT}] {msg}"
    print(line, flush=True)
    for p in (REPO_RUNLOG, os.path.join(ARCH_RUN, "run.log"), os.path.join(REPO_RUN, f"attempt-{ATTEMPT}.log")):
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")

def shot(tag):
    raw = subprocess.run([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"], capture_output=True).stdout
    ok = raw[:4] == b"\x89PNG"
    for base, d in ((REPO_RUN, "screenshots-sanitized"), (ARCH_RUN, "screenshots")):
        os.makedirs(os.path.join(base, d), exist_ok=True)
        with open(os.path.join(base, d, f"{ATTEMPT}-{tag}.png"), "wb") as f: f.write(raw)
    log(f"screenshot {tag} png_ok={ok}")
    return ok

def uidump(tag):
    cdp.adb(["shell", "uiautomator", "dump", "/sdcard/ud.xml"])
    xml = cdp.adb(["shell", "cat", "/sdcard/ud.xml"]); cdp.adb(["shell", "rm", "/sdcard/ud.xml"])
    for base, d in ((REPO_RUN, "dumpsys"), (ARCH_RUN, "dumpsys")):
        os.makedirs(os.path.join(base, d), exist_ok=True)
        with open(os.path.join(base, d, f"{ATTEMPT}-{tag}.xml"), "w", encoding="utf-8") as f: f.write(xml)
    return xml

def row_xy(xml, text):
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        if m.group(1) == text:
            l, t, r, b = map(int, m.groups()[1:]); return (l+r)//2, (t+b)//2
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        if text in m.group(1):
            l, t, r, b = map(int, m.groups()[1:]); return (l+r)//2, (t+b)//2
    return None

def tap_text(xml, text, wait=1.5):
    p = row_xy(xml, text)
    if not p: return None
    cdp.adb(["shell", "input", "tap", str(p[0]), str(p[1])])
    time.sleep(wait)
    return p

def checked_radio_row(xml):
    titles = []
    for name in ("智能控制后台耗电", "允许后台耗电"):
        m = re.search(r'<node[^>]*text="' + name + r'"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
        if m:
            l, t, r, b = map(int, m.groups()); titles.append((name, t, b))
    best = None
    for m in re.finditer(r'<node[^>]*class="android\.widget\.RadioButton"[^>]*checked="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        l, t, r, b = map(int, m.groups()); cy = (t+b)//2
        for name, tt, tb in titles:
            if tt - 60 <= cy <= tb + 60: best = name
    return best

def resumed_activity():
    out = subprocess.run([ADB, "-s", SERIAL, "shell", "dumpsys", "activity", "activities"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if "mResumedActivity" in line or "topResumedActivity" in line:
            return line.strip()[:150]
    return None

def start_sampler():
    f = open(os.path.join(REPO_RUN, f"samples-{ATTEMPT}.jsonl"), "a", encoding="utf-8")
    def loop():
        while not sampler_stop.is_set():
            try:
                v = cdp.eval(SAMPLE_EXPR)
                if v is not None:
                    f.write(json.dumps(v, ensure_ascii=False) + "\n"); f.flush()
                    sample_count[0] += 1
            except Exception as e:
                f.write(json.dumps({"err": str(e)[:120], "t": time.time()*1000}) + "\n"); f.flush()
            time.sleep(0.25)
        f.close()
    t = threading.Thread(target=loop, daemon=True); t.start()
    return t

def wait_until(pred, timeout, poll=0.3, desc=""):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            v = cdp.eval(SAMPLE_EXPR)
            if v is not None and pred(v): return v
        except Exception: pass
        time.sleep(poll)
    return None

def nav_to_bgpower_detail_from_landing():
    """从应用打开的落地页出发，导航到含「允许后台耗电」单选项的页面。"""
    for attempt_i in range(8):
        time.sleep(1.2)
        xml = uidump(f"landing-{attempt_i}")
        log(f"landing step {attempt_i}: mResumed={resumed_activity()}")
        if checked_radio_row(xml) is not None and row_xy(xml, "允许后台耗电"):
            log("reached radio options page")
            return
        p = row_xy(xml, "安心收件箱")
        if p:
            log(f"tapping 安心收件箱 at {p}")
            cdp.adb(["shell", "input", "tap", str(p[0]), str(p[1])]); time.sleep(2)
        else:
            log("no 安心收件箱 row; stopping navigation")

def clickable_container_center(xml, text):
    """找包含 text 的最小 clickable 节点，返回其中心（最近任务卡片用）。"""
    m = re.search(r'<node[^>]*text="' + text + r'"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
    if not m: return None
    tl, tt, tr, tb = map(int, m.groups())
    best = None; best_area = None
    for nm in re.finditer(r'<node[^>]*clickable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        l, t, r, b = map(int, nm.groups())
        if l <= tl and t <= tt and r >= tr and b >= tb:
            area = (r - l) * (b - t)
            # 最近任务卡片：点卡片快照主体（最大的包含容器）；小的标题栏点击无效
            if best is None or area > best_area:
                best = ((l + r) // 2, (t + b) // 2); best_area = area
    return best

def back_until_app(max_backs=4):
    """按 BACK 直到 topResumed 回到 MainActivity；若设置栈走完仍不在应用，
    回桌面再拉起应用（vivo 设置为独立任务栈，BACK 不跨任务，如实记录）。
    返回 (t_resume_ms, 方式描述)。"""
    for i in range(max_backs):
        cdp.adb(["shell", "input", "keyevent", "4"])
        t0 = time.time()
        while time.time() - t0 < 4:
            ra = resumed_activity() or ""
            if "MainActivity" in ra:
                t_resume = device_ms()
                log(f"BACK #{i+1}: app resumed, t_resume={t_resume}, {ra[:110]}")
                return t_resume, f"back x{i+1}"
            if "launcher" in ra.lower() or "bbk" in ra.lower():
                log(f"BACK #{i+1}: reached launcher, going home→relaunch")
                cdp.adb(["shell", "input", "keyevent", "3"]); time.sleep(1.5)
                break
            time.sleep(0.3)
        else:
            log(f"BACK #{i+1}: not app yet, mResumed={(resumed_activity() or '')[:110]}")
    # 兜底：桌面重拉
    cdp.adb(["shell", "input", "keyevent", "3"]); time.sleep(1.5)
    cdp.adb(["shell", "am", "start", "-n", f"{PACKAGE}/{PACKAGE}.MainActivity"])
    t0 = time.time()
    while time.time() - t0 < 6:
        ra = resumed_activity() or ""
        if "MainActivity" in ra:
            t_resume = device_ms()
            log(f"relaunched from home, t_resume={t_resume}, {ra[:110]}")
            return t_resume, "home+relaunch"
        time.sleep(0.3)
    return None, "failed"

def analyze(samples_path, t_resume_ms):
    rows = []
    with open(samples_path, encoding="utf-8") as f:
        for line in f:
            try: rows.append(json.loads(line))
            except Exception: pass
    rows = [r for r in rows if "t" in r]
    after = [r for r in rows if r["t"] >= t_resume_ms - 60]
    first = after[0] if after else None
    t_ignoring_true = next((r["t"] for r in after if r.get("ignoring") is True and any(x.get("ignoring") is not True for x in after if x["t"] < r["t"])), None)
    # 简化：ignoring 首次为 true 的时刻（相对 Tresume）
    first_true = next((r for r in after if r.get("ignoring") is True), None)
    first_bgdone = next((r for r in after if r.get("bgDone") is True), None)
    first_homegone = next((r for r in after if r.get("homeEmpty") is True), None)
    out = {
        "t_resume": t_resume_ms,
        "first_sample_after_resume": first,
        "ignoring_first_true": first_true["t"] if first_true else None,
        "ignoring_delay_ms": (first_true["t"] - t_resume_ms) if first_true else None,
        "bgDone_first_true": first_bgdone["t"] if first_bgdone else None,
        "bgDone_delay_ms": (first_bgdone["t"] - t_resume_ms) if first_bgdone else None,
        "homeEmpty_first_true_after_resume": first_homegone["t"] if first_homegone else None,
    }
    return out

def main():
    global sampler_stop
    log(f"=== attempt {ATTEMPT} start ===")
    log("mResumed: " + str(resumed_activity()))
    cdp_conn = CDP(); globals()["cdp"] = cdp_conn
    pre = cdp_conn.eval(SAMPLE_EXPR)
    log(f"pre: {json.dumps(pre, ensure_ascii=False)}")
    if SCEN in ("R1", "R2"):
        if pre.get("homeEmpty") is not False:
            log("FATAL: 防冻结卡片不在首页（homeEmpty != False），前置条件不满足"); sys.exit(2)
    sampler_stop.clear()
    start_sampler()
    log("sampler started (250ms)")
    if SCEN == "R1":
        r = cdp_conn.rect("#setupEntry")
        if not r: log("FATAL: #setupEntry 不存在"); sys.exit(2)
        log(f"tapping home card #setupEntry")
        cdp_conn.tap_selector("#setupEntry", wait=1.2)
        v = wait_until(lambda s: s.get("sheetOpen") is True, 5)
        if not v: log("FATAL: sheet did not open"); sys.exit(2)
        log("sheet opened")
    elif SCEN == "R2":
        # 切到「我的」页再打开设置面板
        els = cdp_conn.eval("""(function(){var out=[];document.querySelectorAll('.nav-item').forEach(function(el){
            var r=el.getBoundingClientRect();out.push({text:(el.textContent||'').trim(),x:r.left+r.width/2,y:r.top+r.height/2})});return out})()""")
        me = next(e for e in els if e["text"] == "我的")
        cdp_conn.tap_xy(me["x"], me["y"]); time.sleep(1.2)
        log("switched to 我的 tab")
        r = cdp_conn.rect("#btnSetup")
        if not r: log("FATAL: #btnSetup not found on 我的 page"); sys.exit(2)
        cdp_conn.tap_selector("#btnSetup", wait=1.2)
        v = wait_until(lambda s: s.get("sheetOpen") is True, 5)
        if not v: log("FATAL: sheet did not open (R2)"); sys.exit(2)
        log("sheet opened from 我的")

    if SCEN in ("R1", "R2"):
        # 打开系统设置（面板保持开着）；先装被动重绘观察器
        obs = cdp_conn.eval(INSTALL_OBSERVER_JS)
        log(f"mutation observer: {obs}")
        log("tapping background step chip")
        cdp_conn.tap_selector('[data-setup-step="background"]', wait=2.5)
        log(f"after chip tap: mResumed={resumed_activity()}")
        shot("landing")
        nav_to_bgpower_detail_from_landing()
        xml = uidump("before-toggle")
        before = checked_radio_row(xml)
        log(f"before toggle checked={before}")
        p = row_xy(xml, "允许后台耗电")
        if not p: log("FATAL: 允许后台耗电 row not found"); sys.exit(2)
        t_switch = device_ms()
        log(f"Tswitch={t_switch} tapping 允许后台耗电 at {p}")
        cdp.adb(["shell", "input", "tap", str(p[0]), str(p[1])]); time.sleep(2)
        xml = uidump("after-toggle")
        after = checked_radio_row(xml)
        log(f"after toggle checked={after}")
        shot("after-toggle")
        if after != "允许后台耗电": log("FATAL: toggle did not take effect"); sys.exit(3)
        # 返回应用（BACK 走完设置栈；必要时经桌面重拉）
        t_resume, how = back_until_app()
        log(f"return-to-app method: {how}")
        if not t_resume: log("FATAL: did not return to app"); sys.exit(2)
    else:  # R3 对照
        cdp.adb(["shell", "input", "keyevent", "3"]); time.sleep(1.5)  # home
        log("pressed HOME")
        cdp.adb(["shell", "am", "start", "-a", "android.settings.APPLICATION_DETAILS_SETTINGS", "-d", "package:space.alliswell.inbox"]); time.sleep(2.5)
        xml = uidump("r3-appinfo")
        p = row_xy(xml, "电量")
        if not p: log("FATAL: 电量 not found"); sys.exit(2)
        cdp.adb(["shell", "input", "tap", str(p[0]), str(p[1])]); time.sleep(2)
        xml = uidump("r3-battery")
        p = row_xy(xml, "后台耗电管理")
        if not p: log("FATAL: 后台耗电管理 not found"); sys.exit(2)
        cdp.adb(["shell", "input", "tap", str(p[0]), str(p[1])]); time.sleep(2)
        xml = uidump("r3-list")
        p = row_xy(xml, "安心收件箱")
        if not p: log("FATAL: 安心收件箱 not found"); sys.exit(2)
        cdp.adb(["shell", "input", "tap", str(p[0]), str(p[1])]); time.sleep(2)
        xml = uidump("r3-detail")
        p = row_xy(xml, "允许后台耗电")
        if not p: log("FATAL: 允许后台耗电 not found"); sys.exit(2)
        t_switch = device_ms()
        log(f"Tswitch={t_switch} tapping 允许后台耗电 at {p}")
        cdp.adb(["shell", "input", "tap", str(p[0]), str(p[1])]); time.sleep(2)
        xml = uidump("r3-after-toggle")
        log(f"after toggle checked={checked_radio_row(xml)}")
        # 从最近任务切回
        cdp.adb(["shell", "input", "keyevent", "187"]); time.sleep(2)
        xml = uidump("r3-recents")
        p = clickable_container_center(xml, "安心收件箱")
        if not p: log("FATAL: recents card not found"); sys.exit(2)
        log(f"tapping recents card container at {p}")
        cdp.adb(["shell", "input", "tap", str(p[0]), str(p[1])])
        t0 = time.time(); t_resume = None
        while time.time() - t0 < 6:
            ra = resumed_activity() or ""
            if "MainActivity" in ra:
                t_resume = device_ms()
                log(f"app resumed via recents, t_resume={t_resume}, {ra[:110]}")
                break
            time.sleep(0.3)
        if not t_resume: log("FATAL: recents did not return to app"); sys.exit(2)

    # 观察 15 秒（采样线程全程运行）
    log(f"observation window 15s starts, t_resume={t_resume}")
    t0 = time.time()
    while time.time() - t0 < 15: time.sleep(1)
    log("observation window end")

    sampler_stop.set(); time.sleep(0.6)
    res = analyze(os.path.join(REPO_RUN, f"samples-{ATTEMPT}.jsonl"), t_resume)
    log("analysis: " + json.dumps(res, ensure_ascii=False))
    # 关面板看首页卡片（R1/R2）
    if SCEN in ("R1", "R2"):
        try: cdp_conn.tap_selector('#sheetSetup [data-close="sheetSetup"]', wait=1.0)
        except Exception as e: log(f"close sheet failed: {e}")
        final = cdp_conn.eval(SAMPLE_EXPR)
        log(f"final after closing sheet: {json.dumps(final, ensure_ascii=False)}")
        shot("final-home")
    else:
        final = cdp_conn.eval(SAMPLE_EXPR)
        log(f"final home: {json.dumps(final, ensure_ascii=False)}")
        shot("final-home")
    log(f"=== attempt {ATTEMPT} end ===")

if __name__ == "__main__":
    try:
        main()
    finally:
        sampler_stop.set()
