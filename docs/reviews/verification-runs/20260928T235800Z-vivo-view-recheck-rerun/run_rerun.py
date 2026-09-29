#!/usr/bin/env python3
"""vivo 真机复测重测执行脚本 (PR #10)
硬性纪律：
1. 严格串行：flock 互斥锁保护。
2. 每次尝试具有完整的 start–end 区间，非空 samples-*.jsonl 与 attempt-*.log。
3. 记录每次读取调用的堆栈行号 (566=onResume即时读, 423=1.5s/5s补读, 406=refreshNativeStatus)。
4. 记录 refreshNativeStatus 回写的 origin。
5. 对 S2 / S3 严格按 (a), (b), (c) 归类。
"""
import os, sys, time, json, subprocess, threading, fcntl, re, urllib.request
from datetime import datetime

for k in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy'):
    os.environ.pop(k, None)
os.environ['NO_PROXY'] = '*'; os.environ['no_proxy'] = '*'

import websocket

SERIAL = "10ACBF2D3D000RS"
PACKAGE = "space.alliswell.inbox"
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
RUN_ID = "20260928T235800Z-vivo-view-recheck-rerun"
REPO_RUN = os.path.join("/Users/qlyf/Developer/reminder", "docs/reviews/verification-runs", RUN_ID)
ARCH_RUN = os.path.expanduser(f"~/Developer/reminder-archive/verification-runs/{RUN_ID}")
LOG_PATH = os.path.join(REPO_RUN, "run.log")
LOCK_FILE = "/tmp/vivo_device.lock"
PORT = 53422

SAMPLE_EXPR = """(() => {
  const h = document.querySelector('#homeSetup');
  const s = document.querySelector('#sheetSetup');
  const inbox = window.__ATTENTION_INBOX__;
  const d = inbox && inbox.getNativeReminderStatus ? inbox.getNativeReminderStatus() : null;
  const dm = window.__DIAGNOSE_MONITOR__ ? {
    callCount: window.__DIAGNOSE_MONITOR__.calls.length,
    lastCall: window.__DIAGNOSE_MONITOR__.calls[window.__DIAGNOSE_MONITOR__.calls.length - 1] || null
  } : null;
  const wl = window.__ORIGIN_LOG__ ? window.__ORIGIN_LOG__.slice() : [];
  return {
    t: Date.now(),
    homeEmpty: h ? h.innerHTML.trim() === '' : null,
    homeText: h ? h.textContent.trim().slice(0, 80) : '',
    sheetOpen: s ? s.classList.contains('open') : false,
    ignoring: (d && d.diag) ? d.diag.ignoringBatteryOptimizations : null,
    diagMon: dm,
    originLog: wl,
    rr: window.__RR_MUT__ || { c: 0, last: null }
  };
})()"""

INSTALL_PROBES_JS = """(() => {
  // Bind global getNativeReminderStatus
  if (window.__ATTENTION_INBOX__) {
    window.getNativeReminderStatus = function() {
      return window.__ATTENTION_INBOX__.getNativeReminderStatus ? window.__ATTENTION_INBOX__.getNativeReminderStatus() : null;
    };
  }

  // 1. Diagnose Monitor
  if (!window.__ORIG_BRIDGE_DIAGNOSE__) {
    const bridge = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBridge;
    if (bridge && bridge.diagnose) {
      window.__ORIG_BRIDGE_DIAGNOSE__ = bridge.diagnose.bind(bridge);
    }
  }
  if (!window.__DIAGNOSE_MONITOR__) {
    window.__DIAGNOSE_MONITOR__ = { calls: [] };
  }
  const bridge = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBridge;
  if (bridge && window.__ORIG_BRIDGE_DIAGNOSE__) {
    bridge.diagnose = async function() {
      const startT = Date.now();
      const stack = (new Error()).stack || '';
      try {
        const res = await window.__ORIG_BRIDGE_DIAGNOSE__();
        window.__DIAGNOSE_MONITOR__.calls.push({
          t: startT,
          endT: Date.now(),
          ignoring: res ? res.ignoringBatteryOptimizations : null,
          stack: stack.split(String.fromCharCode(10)).slice(1, 8).join(' | ')
        });
        return res;
      } catch(err) {
        window.__DIAGNOSE_MONITOR__.calls.push({
          t: startT,
          endT: Date.now(),
          err: String(err),
          stack: stack.split(String.fromCharCode(10)).slice(1, 8).join(' | ')
        });
        throw err;
      }
    };
  }

  // 2. MutationObserver for #setupBody
  if (!window.__RR_MUT__) {
    window.__RR_MUT__ = { c: 0, last: null };
    const target = document.querySelector('#setupBody');
    if (target) {
      const obs = new MutationObserver((muts) => {
        window.__RR_MUT__.c += muts.length;
        window.__RR_MUT__.last = Date.now();
      });
      obs.observe(target, { childList: true, subtree: true });
    }
  }

  // 3. Origin probe on nativeCoordinator.refreshNativeStatus
  if (!window.__ORIGIN_LOG__) {
    window.__ORIGIN_LOG__ = [];
  }
  const inbox = window.__ATTENTION_INBOX__;
  if (inbox && inbox.nativeCoordinator && !inbox.nativeCoordinator._origin_probed) {
    inbox.nativeCoordinator._origin_probed = true;
    const origRefresh = inbox.nativeCoordinator.refreshNativeStatus;
    inbox.nativeCoordinator.refreshNativeStatus = function(origin) {
      const beforeDiag = inbox.nativeCoordinator.getNativeReminderStatus() ? inbox.nativeCoordinator.getNativeReminderStatus().diag : null;
      const beforeIgn = beforeDiag ? beforeDiag.ignoringBatteryOptimizations : null;
      const callEntry = {
        t: Date.now(),
        origin: origin,
        beforeIgn: beforeIgn,
        endT: null,
        afterIgn: null,
        changed: null
      };
      window.__ORIGIN_LOG__.push(callEntry);
      const p = origRefresh.apply(this, arguments);
      if (p && typeof p.then === "function") {
        p.then(() => {
          callEntry.endT = Date.now();
          const afterDiag = inbox.nativeCoordinator.getNativeReminderStatus() ? inbox.nativeCoordinator.getNativeReminderStatus().diag : null;
          callEntry.afterIgn = afterDiag ? afterDiag.ignoringBatteryOptimizations : null;
          callEntry.changed = (beforeIgn !== callEntry.afterIgn);
        }).catch(err => {
          callEntry.endT = Date.now();
          callEntry.err = String(err);
        });
      }
      return p;
    };
  }
  return true;
})()"""

def parse_caller(stack):
    m = re.search(r'app-native-coordinator\.js:(\d+)', stack or '')
    if m:
        line = int(m.group(1))
        if line == 566: return f"onResume-immediate (L{line})"
        elif line == 423: return f"resume-recheck (L{line})"
        elif line == 406: return f"refreshNativeStatus (L{line})"
        return f"app-native-coordinator.js:L{line}"
    return "other"

def parse_coord_line(stack):
    m = re.search(r'app-native-coordinator\.js:(\d+)', stack or '')
    return int(m.group(1)) if m else None

class DeviceRunner:
    def __init__(self):
        self.lock_fd = open(LOCK_FILE, "w")
        fcntl.flock(self.lock_fd, fcntl.LOCK_EX)
        self.ensure_dirs()
        self.ws = None
        self.ws_lock = threading.Lock()
        self.init_cdp()

    def close(self):
        if self.ws:
            try: self.ws.close()
            except: pass
        fcntl.flock(self.lock_fd, fcntl.LOCK_UN)
        self.lock_fd.close()

    def ensure_dirs(self):
        for base in (REPO_RUN, ARCH_RUN):
            for d in ("dumpsys", "screenshots", "screenshots-sanitized"):
                os.makedirs(os.path.join(base, d), exist_ok=True)

    def adb(self, args, timeout=25):
        cmd = [ADB, "-s", SERIAL] + args
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout.strip()

    def device_ms(self):
        ms = self.adb(["shell", "date", "+%s%3N"])
        try: return int(ms)
        except: return int(time.time()*1000)

    def log(self, tag, msg):
        ms_i = self.device_ms()
        line = f"[{datetime.fromtimestamp(ms_i/1000.0).strftime('%Y-%m-%d %H:%M:%S')}] [{ms_i}] [{tag}] {msg}"
        print(line, flush=True)
        for p in (LOG_PATH, os.path.join(ARCH_RUN, "run.log")):
            with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")
        # 也写入该 tag 的 attempt log
        if tag and not tag.endswith("-toggle") and not tag.endswith("-prep"):
            with open(os.path.join(REPO_RUN, f"attempt-{tag}.log"), "a", encoding="utf-8") as f:
                f.write(line + "\n")
            with open(os.path.join(ARCH_RUN, f"attempt-{tag}.log"), "a", encoding="utf-8") as f:
                f.write(line + "\n")

    def init_cdp(self):
        pid = self.adb(["shell", "pidof", PACKAGE])
        self.adb(["forward", f"tcp:{PORT}", f"localabstract:webview_devtools_remote_{pid}"])
        time.sleep(0.4)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        targets = json.loads(opener.open(f"http://127.0.0.1:{PORT}/json", timeout=5).read().decode())
        page = next(t for t in targets if t.get('type') == 'page')
        self.ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=10, suppress_origin=True)
        # 注入探针
        self.eval(INSTALL_PROBES_JS)

    def eval(self, expr, await_promise=False):
        with self.ws_lock:
            payload = {"id": 1, "method": "Runtime.evaluate",
                       "params": {"expression": expr, "returnByValue": True, "awaitPromise": await_promise}}
            self.ws.send(json.dumps(payload))
            while True:
                msg = json.loads(self.ws.recv())
                if msg.get("id") == 1:
                    res = msg.get("result", {})
                    if "exceptionDetails" in res:
                        raise RuntimeError(f"CDP Exception: {res['exceptionDetails']}")
                    return res.get("result", {}).get("value")

    def get_ignoring_status(self):
        return self.eval("(() => { const inbox = window.__ATTENTION_INBOX__; const s = (inbox && inbox.getNativeReminderStatus) ? inbox.getNativeReminderStatus() : null; return (s && s.diag) ? s.diag.ignoringBatteryOptimizations : null; })()")

    def shot(self, tag):
        raw = subprocess.run([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"], capture_output=True).stdout
        for base in (REPO_RUN, ARCH_RUN):
            d = "screenshots-sanitized" if base == REPO_RUN else "screenshots"
            with open(os.path.join(base, d, f"{tag}.png"), "wb") as f:
                f.write(raw)

    def dump_xml(self, tag):
        self.adb(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
        xml = self.adb(["shell", "cat", "/sdcard/window_dump.xml"])
        self.adb(["shell", "rm", "/sdcard/window_dump.xml"])
        for base in (REPO_RUN, ARCH_RUN):
            with open(os.path.join(base, "dumpsys", f"{tag}.xml"), "w", encoding="utf-8") as f:
                f.write(xml)
        return xml

    def set_bgpower(self, target_mode, tag):
        """target_mode: '智能控制后台耗电' 或 '允许后台耗电'"""
        self.adb(["shell", "am", "start", "-a", "android.settings.APPLICATION_DETAILS_SETTINGS", "-d", f"package:{PACKAGE}"])
        time.sleep(2.0)
        # 点击 电量
        self.adb(["shell", "input", "tap", "150", "992"])
        time.sleep(2.0)
        # 点击 后台耗电管理
        self.adb(["shell", "input", "tap", "246", "2090"])
        time.sleep(2.0)
        # dump before
        self.dump_xml(f"{tag}-before")
        self.shot(f"{tag}-before")

        # 点击目标选项
        # 智能控制后台耗电: (306, 743)
        # 允许后台耗电: (306, 988)
        coords = (306, 743) if "智能控制" in target_mode else (306, 988)
        t_switch = self.device_ms()
        self.log(tag, f"Tswitch={t_switch} tapping {target_mode} at {coords}")
        self.adb(["shell", "input", "tap", str(coords[0]), str(coords[1])])
        time.sleep(1.5)

        # dump after
        xml_after = self.dump_xml(f"{tag}-after")
        self.shot(f"{tag}-after")

        # 校验模式
        checked = None
        for m in re.finditer(r'<node[^>]*class="android.widget.RadioButton"[^>]*checked="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml_after):
            top_y = int(m.group(2))
            if 700 <= top_y <= 850: checked = "智能控制后台耗电"
            elif 950 <= top_y <= 1100: checked = "允许后台耗电"
        self.log(tag, f"after mode: {checked} (expected: {target_mode})")
        return t_switch

    def back_until_app(self, tag, max_backs=6):
        """按返回键直到回到应用"""
        for i in range(1, max_backs + 1):
            self.adb(["shell", "input", "keyevent", "4"])
            time.sleep(0.35)
            top = self.adb(["shell", "dumpsys", "activity", "activities"])
            resumed = [line for line in top.splitlines() if "topResumedActivity=" in line or "mResumedActivity:" in line]
            if any("space.alliswell.inbox/.MainActivity" in line for line in resumed):
                t_resume = self.device_ms()
                self.log(tag, f"BACK #{i}: app resumed, t_resume={t_resume}")
                return t_resume
        # 若未命中，通过 am start 拉回
        self.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
        t_resume = self.device_ms()
        self.log(tag, f"am start fallback: t_resume={t_resume}")
        return t_resume

    def ensure_baseline_state(self, tag):
        """确保系统设置处于『允许后台耗电』且应用内 ignoring 状态为 true"""
        wl = self.adb(["shell", "dumpsys", "deviceidle", "whitelist"])
        ign = self.get_ignoring_status()
        need_restore = ("space.alliswell.inbox" not in wl) or (ign is not True)
        if need_restore:
            self.log(tag, f"Baseline check: in_wl={'space.alliswell.inbox' in wl}, ignoring={ign}. Restoring 允许后台耗电...")
            self.set_bgpower("允许后台耗电", f"{tag}-prep")
            self.back_until_app(tag)
            time.sleep(2.0)
            self.eval("window.__ATTENTION_INBOX__.nativeCoordinator.refreshNativeStatus('prep')", await_promise=True)
            time.sleep(0.5)
            # 循环确认
            for attempt in range(5):
                wl2 = self.adb(["shell", "dumpsys", "deviceidle", "whitelist"])
                ign2 = self.get_ignoring_status()
                if ("space.alliswell.inbox" in wl2) and (ign2 is True):
                    self.log(tag, "Baseline restored and verified: in_wl=True, ignoring=True")
                    return
                time.sleep(1.0)
                self.eval("window.__ATTENTION_INBOX__.nativeCoordinator.refreshNativeStatus('prep')", await_promise=True)
            self.log(tag, f"Warning: Baseline restore loop completed, in_wl={'space.alliswell.inbox' in wl2}, ignoring={ign2}")
        else:
            self.log(tag, "Baseline verified: in_wl=True, ignoring=True")

class Sampler:
    def __init__(self, runner, tag, interval=0.20):
        self.runner = runner
        self.tag = tag
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = None
        self.samples = []

    def start(self):
        self.samples = []
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run)
        self.thread.daemon = True
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=3.0)
        # 写盘
        for base in (REPO_RUN, ARCH_RUN):
            path = os.path.join(base, f"samples-{self.tag}.jsonl")
            with open(path, "w", encoding="utf-8") as f:
                for s in self.samples:
                    f.write(json.dumps(s, ensure_ascii=False) + "\n")

    def _run(self):
        while not self.stop_event.is_set():
            try:
                data = self.runner.eval(SAMPLE_EXPR)
                if data:
                    self.samples.append(data)
            except Exception as e:
                pass
            time.sleep(self.interval)

def run_s1_attempt(dev, tag):
    dev.log(tag, f"=== S1: 撤销方向 · 回前台 [{tag}] start ===")
    # 1. 确保处于基线「允许后台耗电」且在首页
    dev.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
    time.sleep(1.0)
    dev.eval("document.querySelector('.nav-item[data-tab=\"home\"]').click()")
    time.sleep(0.5)
    dev.ensure_baseline_state(tag)

    pre_ign = dev.get_ignoring_status()
    home_empty = dev.eval("document.querySelector('#homeSetup') ? document.querySelector('#homeSetup').innerHTML.trim() === '' : null")
    dev.log(tag, f"Pre-state: ignoring={pre_ign}, homeEmpty={home_empty}")

    # 2. 进系统设置切到「智能控制」
    t_switch = dev.set_bgpower("智能控制后台耗电", f"{tag}-toggle")

    # 3. 启动采样器，返回应用
    sampler = Sampler(dev, tag, interval=0.20)
    sampler.start()
    t_resume = dev.back_until_app(tag)
    dev.log(tag, f"Tswitch={t_switch}, Tresume={t_resume}")

    # 4. 持续采样 6.5 秒以覆盖即时读、1.5s 补读、5s 补读
    time.sleep(6.5)
    sampler.stop()

    dev.shot(f"{tag}-final")

    # 5. 分析调用与时序
    calls = dev.eval("window.__DIAGNOSE_MONITOR__ ? window.__DIAGNOSE_MONITOR__.calls : []")
    window_calls = [c for c in calls if c["t"] >= t_resume - 300]
    dev.log(tag, f"Total diagnose calls in window: {len(window_calls)}")
    parsed_calls = []
    for i, c in enumerate(window_calls):
        delta = (c["t"] - t_resume) / 1000.0
        caller = parse_caller(c.get("stack"))
        coord_line = parse_coord_line(c.get("stack"))
        dev.log(tag, f"  Call #{i+1}: t={c['t']} (+{delta:.3f}s from resume) caller={caller} coordLine={coord_line} ignoring={c.get('ignoring')}")
        parsed_calls.append({
            "t": c["t"],
            "delta": delta,
            "caller": caller,
            "coordLine": coord_line,
            "ignoring": c.get("ignoring"),
            "stack": c.get("stack")
        })

    # 首页卡片出现时刻
    first_card = None
    for s in sampler.samples:
        if s.get("homeEmpty") is False:
            first_card = s
            break
    card_delta = ((first_card["t"] - t_resume)/1000.0) if first_card else None
    dev.log(tag, f"Home card appearance: t={first_card['t'] if first_card else None} (+{card_delta:.3f}s from resume)" if first_card else "Home card appearance: None")

    dev.log(tag, f"=== S1: 撤销方向 · 回前台 [{tag}] end ===")
    return {
        "t_switch": t_switch,
        "t_resume": t_resume,
        "calls": parsed_calls,
        "first_card": first_card,
        "card_delta": card_delta
    }

def run_s2_attempt(dev, tag, fast_variant=False):
    dev.log(tag, f"=== S2: 撤销方向 · 打开设置面板 [{tag}] start ===")
    # 1. 确保当前是「允许后台耗电」且停留在「我的」
    dev.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
    time.sleep(1.0)
    dev.eval("document.querySelector('.nav-item[data-tab=\"me\"]').click()")
    time.sleep(0.5)
    dev.ensure_baseline_state(tag)
    dev.eval("document.querySelector('.nav-item[data-tab=\"me\"]').click()")
    time.sleep(0.5)

    # 2. 进系统设置切到「智能控制」
    t_switch = dev.set_bgpower("智能控制后台耗电", f"{tag}-toggle")

    # 3. 回到应用，确保停留在「我的」
    t_resume = dev.back_until_app(tag)
    dev.log(tag, f"Tswitch={t_switch}, Tresume={t_resume}")

    if not fast_variant:
        # 标准流程：等待系统收敛（停留 8 秒）
        dev.log(tag, "Waiting 8s on '我的' tab for system lag convergence...")
        time.sleep(8.0)
    else:
        dev.log(tag, "Fast variant: opening #btnSetup immediately after resume without waiting 8s...")
        time.sleep(0.2)

    # 4. 读一次应用内缓存 ignoring 值
    cached_before = dev.get_ignoring_status()
    dev.log(tag, f"Cached ignoring before opening panel: {cached_before}")

    # 5. 准备观察器与采样器
    dev.eval("window.__RR_MUT__.c = 0; window.__ORIGIN_LOG__ = [];")
    mut_before = dev.eval("window.__RR_MUT__.c")
    calls_len_before = dev.eval("window.__DIAGNOSE_MONITOR__ ? window.__DIAGNOSE_MONITOR__.calls.length : 0")

    sampler = Sampler(dev, tag, interval=0.20)
    sampler.start()

    # 6. 打开设置面板
    t_open_action = dev.device_ms()
    dev.log(tag, f"Topen_action={t_open_action}, tapping #btnSetup...")
    dev.eval("document.querySelector('#btnSetup').click()")
    t_open = dev.device_ms()

    # 观察 4 秒
    time.sleep(4.0)
    sampler.stop()

    dev.shot(f"{tag}-final")
    mut_after = dev.eval("window.__RR_MUT__.c")
    mut_diff = mut_after - mut_before
    dev.log(tag, f"MutationObserver count: before={mut_before}, after={mut_after}, diff={mut_diff}")

    # 检查调用与 origin
    calls = dev.eval("window.__DIAGNOSE_MONITOR__ ? window.__DIAGNOSE_MONITOR__.calls : []")
    recent_calls = calls[calls_len_before:]
    dev.log(tag, f"Diagnose calls during setup-open: {len(recent_calls)}")
    parsed_calls = []
    for i, c in enumerate(recent_calls):
        delta = (c["t"] - t_open) / 1000.0
        caller = parse_caller(c.get("stack"))
        coord_line = parse_coord_line(c.get("stack"))
        dev.log(tag, f"  Call #{i+1}: t={c['t']} (+{delta:.3f}s from open) caller={caller} coordLine={coord_line} ignoring={c.get('ignoring')}")
        parsed_calls.append({
            "t": c["t"],
            "delta": delta,
            "caller": caller,
            "coordLine": coord_line,
            "ignoring": c.get("ignoring")
        })

    origin_log = dev.eval("window.__ORIGIN_LOG__ ? window.__ORIGIN_LOG__.slice() : []")
    setup_open_log = [o for o in origin_log if o.get("origin") == "setup-open"]
    dev.log(tag, f"setup-open log entries: {setup_open_log}")

    cached_after = dev.get_ignoring_status()
    dev.log(tag, f"Cached ignoring after setup-open: {cached_after}")

    # 归类判断
    # (a) before==True, after==False, 发生了回写 (changed==True)
    # (b) before==False, after==False, 之前已是新值 (changed==False)
    # (c) after==True, 系统侧滞后超过读取
    category = None
    if cached_before is True and cached_after is False:
        category = "(a) 新入口补读纠正状态并回写"
    elif cached_before is False and cached_after is False:
        category = "(b) 前序读取已拿到新值，新入口值不变不回写"
    elif cached_after is True:
        category = "(c) 系统侧滞后超过读取，读到旧值"
    dev.log(tag, f"Classification: {category}")

    # 关闭设置面板
    dev.eval("document.querySelector('#sheetSetup').classList.remove('open')")
    time.sleep(0.5)

    dev.log(tag, f"=== S2: 撤销方向 · 打开设置面板 [{tag}] end ===")
    return {
        "t_switch": t_switch,
        "t_resume": t_resume,
        "t_open": t_open,
        "cached_before": cached_before,
        "cached_after": cached_after,
        "mut_diff": mut_diff,
        "calls": parsed_calls,
        "setup_open_log": setup_open_log,
        "category": category
    }

def run_s3_attempt(dev, tag, fast_variant=False):
    dev.log(tag, f"=== S3: 撤销方向 · 切回首页 [{tag}] start ===")
    # 1. 确保当前是「允许后台耗电」且停留在「我的」
    dev.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
    time.sleep(1.0)
    dev.eval("document.querySelector('.nav-item[data-tab=\"me\"]').click()")
    time.sleep(0.5)
    dev.ensure_baseline_state(tag)
    dev.eval("document.querySelector('.nav-item[data-tab=\"me\"]').click()")
    time.sleep(0.5)

    # 2. 进系统设置切到「智能控制」
    t_switch = dev.set_bgpower("智能控制后台耗电", f"{tag}-toggle")

    # 3. 回到应用，停留在「我的」页
    t_resume = dev.back_until_app(tag)
    dev.log(tag, f"Tswitch={t_switch}, Tresume={t_resume}")

    if not fast_variant:
        dev.log(tag, "Waiting 12s on '我的' tab (>=10s)...")
        time.sleep(12.0)
    else:
        dev.log(tag, "Fast variant: switching to home tab immediately after resume without waiting 12s...")
        time.sleep(0.2)

    cached_before_tab = dev.get_ignoring_status()
    dev.log(tag, f"Cached ignoring before tapping home tab: {cached_before_tab}")

    # 4. 准备观察器与采样器
    dev.eval("window.__ORIGIN_LOG__ = [];")
    calls_len_before = dev.eval("window.__DIAGNOSE_MONITOR__ ? window.__DIAGNOSE_MONITOR__.calls.length : 0")

    sampler = Sampler(dev, tag, interval=0.20)
    sampler.start()

    # 5. 点首页 tab
    t_tab_action = dev.device_ms()
    dev.log(tag, f"Ttab_action={t_tab_action}, tapping home tab...")
    dev.eval("document.querySelector('.nav-item[data-tab=\"home\"]').click()")
    t_tab = dev.device_ms()

    # 观察 5 秒
    time.sleep(5.0)
    sampler.stop()

    dev.shot(f"{tag}-final")

    # 检查调用与 origin
    calls = dev.eval("window.__DIAGNOSE_MONITOR__ ? window.__DIAGNOSE_MONITOR__.calls : []")
    recent_calls = calls[calls_len_before:]
    dev.log(tag, f"Diagnose calls during tab-home: {len(recent_calls)}")
    parsed_calls = []
    for i, c in enumerate(recent_calls):
        delta = (c["t"] - t_tab) / 1000.0
        caller = parse_caller(c.get("stack"))
        coord_line = parse_coord_line(c.get("stack"))
        dev.log(tag, f"  Call #{i+1}: t={c['t']} (+{delta:.3f}s from tab) caller={caller} coordLine={coord_line} ignoring={c.get('ignoring')}")
        parsed_calls.append({
            "t": c["t"],
            "delta": delta,
            "caller": caller,
            "coordLine": coord_line,
            "ignoring": c.get("ignoring")
        })

    origin_log = dev.eval("window.__ORIGIN_LOG__ ? window.__ORIGIN_LOG__.slice() : []")
    tab_home_log = [o for o in origin_log if o.get("origin") == "tab-home"]
    dev.log(tag, f"tab-home log entries: {tab_home_log}")

    cached_after_tab = dev.get_ignoring_status()
    dev.log(tag, f"Cached ignoring after tab-home: {cached_after_tab}")

    # 检查首页卡片出现
    first_card = None
    for s in sampler.samples:
        if s.get("homeEmpty") is False:
            first_card = s
            break
    card_delta = ((first_card["t"] - t_tab)/1000.0) if first_card else None
    dev.log(tag, f"Home card appearance: t={first_card['t'] if first_card else None} (+{card_delta:.3f}s from tab)" if first_card else "Home card appearance: None")

    # 归类判断
    category = None
    if cached_before_tab is True and cached_after_tab is False:
        category = "(a) 新入口补读纠正状态并回写"
    elif cached_before_tab is False and cached_after_tab is False:
        category = "(b) 前序读取已拿到新值，新入口值不变不回写"
    elif cached_after_tab is True:
        category = "(c) 系统侧滞后超过读取，读到旧值"
    dev.log(tag, f"Classification: {category}")

    dev.log(tag, f"=== S3: 撤销方向 · 切回首页 [{tag}] end ===")
    return {
        "t_switch": t_switch,
        "t_resume": t_resume,
        "t_tab": t_tab,
        "cached_before_tab": cached_before_tab,
        "cached_after_tab": cached_after_tab,
        "calls": parsed_calls,
        "tab_home_log": tab_home_log,
        "first_card": first_card,
        "card_delta": card_delta,
        "category": category
    }

def main():
    dev = DeviceRunner()
    print("DeviceRunner acquired exclusive lock.")
    results = {"S1": [], "S2": [], "S3": []}

    try:
        # S1: 3 次有效尝试
        for i in range(1, 4):
            tag = f"S1-{i}"
            res = run_s1_attempt(dev, tag)
            results["S1"].append(res)
            time.sleep(1.0)

        # S2: 3 次有效尝试
        for i in range(1, 4):
            tag = f"S2-{i}"
            res = run_s2_attempt(dev, tag, fast_variant=False)
            results["S2"].append(res)
            time.sleep(1.0)

        # 检查 S2 是否有 (a)
        s2_has_a = any("(a)" in r["category"] for r in results["S2"])
        if not s2_has_a:
            dev.log("S2-var", "Notice: Standard S2 attempts had no (a), adding fast-open variant S2-v1...")
            res_v = run_s2_attempt(dev, "S2-v1", fast_variant=True)
            results["S2"].append(res_v)

        # S3: 3 次有效尝试
        for i in range(1, 4):
            tag = f"S3-{i}"
            res = run_s3_attempt(dev, tag, fast_variant=False)
            results["S3"].append(res)
            time.sleep(1.0)

        # 检查 S3 是否有 (a)
        s3_has_a = any("(a)" in r["category"] for r in results["S3"])
        if not s3_has_a:
            dev.log("S3-var", "Notice: Standard S3 attempts had no (a), adding fast-tab variant S3-v1...")
            res_v = run_s3_attempt(dev, "S3-v1", fast_variant=True)
            results["S3"].append(res_v)

        # 收尾：恢复到基线「允许后台耗电」
        dev.log("RESTORE", "=== Final restore verification start ===")
        dev.ensure_baseline_state("RESTORE")
        dev.eval("document.querySelector('.nav-item[data-tab=\"home\"]').click()")
        time.sleep(1.0)
        dev.shot("restore_final_home")
        xml = dev.dump_xml("restore_final_status")
        wl = dev.adb(["shell", "dumpsys", "deviceidle", "whitelist"])
        in_wl = "space.alliswell.inbox" in wl
        dev.log("RESTORE", f"Final whitelist has inbox: {in_wl}")
        
        # 11 项业务数据校验
        items_count = dev.eval("window.__ATTENTION_INBOX__.model.getItems().length")
        dev.log("RESTORE", f"Final items count: {items_count} (expected: 11)")
        dev.log("RESTORE", "=== Final restore verification end ===")

        with open(os.path.join(REPO_RUN, "rerun_summary.json"), "w", encoding="utf-8") as f:
            summary = {
                "S1": results["S1"],
                "S2": results["S2"],
                "S3": results["S3"],
                "restore": {
                    "in_wl": in_wl,
                    "items_count": items_count
                }
            }
            json.dump(summary, f, ensure_ascii=False, indent=2)

    finally:
        dev.close()
        print("DeviceRunner released lock.")

if __name__ == "__main__":
    main()
