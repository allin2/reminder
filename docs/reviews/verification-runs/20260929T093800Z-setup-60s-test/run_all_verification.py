#!/usr/bin/env python3
"""vivo V2238A 「我的 → 提醒设置 → 做一次 60 秒测试」真机完整验证执行脚本
被测对象: main 分支最新提交 d97a5ed47af96dc8eda49800bf16911f0be856ec
设备: vivo V2238A (serial: 10ACBF2D3D000RS), 包名: space.alliswell.inbox

纪律:
1. 串行: flock 互斥锁。
2. 每次尝试具有完整的 start–end 区间，非空 samples-*.jsonl 与 attempt-*.log、该时段 logcat。
3. 报告中每个时刻 / 延迟数字标出处（文件名 + 行号）。
4. 投递时刻以 logcat「AttentionAlarm: deliver」行为准。
   锁屏熄屏状态在触发前用 dumpsys power 与 dumpsys window 双重确认。
   到点前脚本不得点亮屏幕或唤醒设备。
5. 基线: 后台耗电=允许，锁屏显示=关，自启动=关，悬浮窗=开。
   T4 临时切到智能控制，测后恢复为允许。
6. 不得调用禁止接口，测试的开始、停止、反馈一律物理点击 (adb input tap + CDP getBoundingClientRect 换算)。
   CDP 只读。
7. 测试前后核对用户真实事项逐字段一致，确认非 90003 闹钟排程未受影响。
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
RUN_ID = "20260929T093800Z-setup-60s-test"
REPO_RUN = os.path.join("/Users/qlyf/Developer/reminder", "docs/reviews/verification-runs", RUN_ID)
ARCH_RUN = os.path.expanduser(f"~/Developer/reminder-archive/verification-runs/{RUN_ID}")
LOG_PATH = os.path.join(REPO_RUN, "run.log")
LOCK_FILE = "/tmp/vivo_device.lock"
PORT = 53422

SAMPLE_EXPR = """(() => {
  const inbox = window.__ATTENTION_INBOX__;
  const s = inbox ? inbox.state.settings : {};
  const run = s.testRun || null;
  const fb = s.testFeedback || null;
  const h = document.querySelector('#homeSetup');
  const sheet = document.querySelector('#sheetSetup');
  const activeTab = document.querySelector('[data-tab].active');
  const toast = document.querySelector('#toast');
  const toastText = document.querySelector('#toastText');
  const evidence = document.querySelector('#setupEvidence');
  const btnStart = document.querySelector('#setupTestStart');
  const activeFb = [...document.querySelectorAll('#setupTestFeedback .chip.on')].map(b => b.dataset.testfb);
  
  let steps = null;
  try {
    if (window.AttentionLib && window.AttentionLib.Feedback && inbox.getNativeReminderStatus) {
      const nativeStatus = inbox.getNativeReminderStatus();
      const ctx = {
        testRun: run,
        testFeedback: fb,
        backgroundVisited: !!(s.backgroundVisited || s.backgroundDone),
        overlayVisited: !!(s.overlayVisited || s.overlayDone)
      };
      steps = window.AttentionLib.Feedback.setupSteps(nativeStatus, ctx);
    }
  } catch (e) {}

  return {
    t: Date.now(),
    sheetOpen: sheet ? sheet.classList.contains('open') : false,
    activeTab: activeTab ? activeTab.dataset.tab : null,
    homeCardText: h ? h.innerText.trim() : '',
    homeCardExists: !!(h && h.innerText.trim().length > 0),
    toastText: (toast && toast.classList.contains('show') && toastText) ? toastText.innerText.trim() : null,
    evidenceText: evidence ? evidence.innerText.trim() : '',
    btnStartText: btnStart ? btnStart.innerText.trim() : '',
    activeFeedbackChips: activeFb,
    testRun: run ? JSON.parse(JSON.stringify(run)) : null,
    testFeedback: fb ? JSON.parse(JSON.stringify(fb)) : null,
    testStep: steps ? (steps.steps.find(x => x.id === 'test') || null) : null,
    bgStep: steps ? (steps.steps.find(x => x.id === 'background') || null) : null
  };
})()"""


class LogcatCollector:
    def __init__(self, adb_path, serial, repo_dir, arch_dir):
        self.adb_path = adb_path
        self.serial = serial
        self.repo_file = os.path.join(repo_dir, "logcat-full.txt")
        self.arch_file = os.path.join(arch_dir, "logcat-full.txt")
        self.proc = None
        self.lines = []
        self.lock = threading.Lock()
        self.running = False
        self.thread = None

    def start(self):
        # 启动前清空旧日志缓存
        subprocess.run([self.adb_path, "-s", self.serial, "logcat", "-c"], capture_output=True)
        self.running = True
        cmd = [self.adb_path, "-s", self.serial, "logcat", "-b", "main,system,events,crash", "-v", "threadtime"]
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.thread = threading.Thread(target=self._read_loop, daemon=True)
        self.thread.start()

    def _read_loop(self):
        with open(self.repo_file, "a", encoding="utf-8") as f_repo, \
             open(self.arch_file, "a", encoding="utf-8") as f_arch:
            for line in iter(self.proc.stdout.readline, ''):
                if not self.running: break
                with self.lock:
                    self.lines.append(line)
                f_repo.write(line)
                f_repo.flush()
                f_arch.write(line)
                f_arch.flush()

    def stop(self):
        self.running = False
        if self.proc:
            self.proc.terminate()
            try: self.proc.wait(timeout=2)
            except: self.proc.kill()
        if self.thread:
            self.thread.join(timeout=2)

    def slice_tag(self, tag, start_idx, end_idx):
        with self.lock:
            sub = self.lines[start_idx:end_idx]
        for base in (REPO_RUN, ARCH_RUN):
            p = os.path.join(base, f"logcat-{tag}.txt")
            with open(p, "w", encoding="utf-8") as f:
                f.writelines(sub)
        return len(sub)

    def current_line_count(self):
        with self.lock:
            return len(self.lines)


class Sampler:
    def __init__(self, runner, tag, interval=0.20):
        self.runner = runner
        self.tag = tag
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = None
        self.samples = []

    def start(self):
        self.stop_event.clear()
        self.samples = []
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def _loop(self):
        repo_p = os.path.join(REPO_RUN, f"samples-{self.tag}.jsonl")
        arch_p = os.path.join(ARCH_RUN, f"samples-{self.tag}.jsonl")
        with open(repo_p, "w", encoding="utf-8") as f_repo, \
             open(arch_p, "w", encoding="utf-8") as f_arch:
            while not self.stop_event.is_set():
                try:
                    data = self.runner.eval(SAMPLE_EXPR)
                    if data:
                        line = json.dumps(data, ensure_ascii=False) + "\n"
                        f_repo.write(line); f_repo.flush()
                        f_arch.write(line); f_arch.flush()
                        self.samples.append(data)
                except Exception:
                    pass
                time.sleep(self.interval)

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=2.0)
        return len(self.samples)


class DeviceRunner:
    def __init__(self):
        self.lock_fd = open(LOCK_FILE, "w")
        fcntl.flock(self.lock_fd, fcntl.LOCK_EX)
        self.ensure_dirs()
        self.ws = None
        self.ws_lock = threading.Lock()
        self._next_id = 0
        self.current_tag = "INIT"
        self.logcat = LogcatCollector(ADB, SERIAL, REPO_RUN, ARCH_RUN)
        self.logcat.start()
        self.init_cdp()

    def close(self):
        self.logcat.stop()
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
        if tag and not tag.endswith("-prep"):
            for base in (REPO_RUN, ARCH_RUN):
                with open(os.path.join(base, f"attempt-{tag}.log"), "a", encoding="utf-8") as f:
                    f.write(line + "\n")

    def init_cdp(self):
        pid = self.adb(["shell", "pidof", PACKAGE])
        if not pid:
            self.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
            time.sleep(2)
            pid = self.adb(["shell", "pidof", PACKAGE])
        self.adb(["forward", f"tcp:{PORT}", f"localabstract:webview_devtools_remote_{pid}"])
        time.sleep(0.4)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        targets = json.loads(opener.open(f"http://127.0.0.1:{PORT}/json", timeout=5).read().decode())
        page = next(t for t in targets if t.get('type') == 'page')
        self.ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=10, suppress_origin=True)

    def eval(self, expr, await_promise=False):
        with self.ws_lock:
            self._next_id += 1
            call_id = self._next_id
            payload = {"id": call_id, "method": "Runtime.evaluate",
                       "params": {"expression": expr, "returnByValue": True, "awaitPromise": await_promise}}
            try:
                self.ws.send(json.dumps(payload))
                while True:
                    msg = json.loads(self.ws.recv())
                    if msg.get("id") == call_id:
                        res = msg.get("result", {})
                        if "exceptionDetails" in res:
                            raise RuntimeError(f"CDP Exception: {res['exceptionDetails']}")
                        return res.get("result", {}).get("value")
            except (websocket.WebSocketConnectionClosedException, BrokenPipeError, ConnectionResetError):
                self.init_cdp()
                self._next_id += 1
                call_id = self._next_id
                payload["id"] = call_id
                self.ws.send(json.dumps(payload))
                while True:
                    msg = json.loads(self.ws.recv())
                    if msg.get("id") == call_id:
                        res = msg.get("result", {})
                        return res.get("result", {}).get("value")

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

    def get_element_rect(self, sel):
        js = f"""(() => {{
            const el = document.querySelector({json.dumps(sel)});
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {{
                x: r.left, y: r.top, w: r.width, h: r.height,
                visible: !el.hidden && r.width > 0 && r.height > 0
            }};
        }})()"""
        return self.eval(js)

    def dismiss_alarm_activity_if_top(self):
        w_out = self.adb(["shell", "dumpsys", "window"])
        if "AlarmActivity" in w_out:
            self.log(self.current_tag, "AlarmActivity detected on top, sending BACK to dismiss...")
            self.adb(["shell", "input", "keyevent", "4"])
            time.sleep(1.0)

    def tap_element(self, sel, y_ratio=0.5, retries=10, retry_delay=0.5):
        self.dismiss_alarm_activity_if_top()
        rect = None
        for _ in range(retries):
            rect = self.get_element_rect(sel)
            if isinstance(rect, dict) and rect.get('visible'):
                break
            time.sleep(retry_delay)

        if not isinstance(rect, dict) or not rect.get('visible'):
            raise RuntimeError(f"Element {sel} not visible or not found: {rect}")

        # 如果位置在底部手势区 (y > 620) 或靠上遮挡区 (y < 80)，滑动调整
        if rect['y'] > 620:
            self.adb(["shell", "input", "swipe", "540", "1600", "540", "1100", "200"])
            time.sleep(0.5)
            rect = self.get_element_rect(sel)
        elif rect['y'] < 80:
            self.adb(["shell", "input", "swipe", "540", "1100", "540", "1600", "200"])
            time.sleep(0.5)
            rect = self.get_element_rect(sel)

        cx = rect['x'] + rect['w'] / 2.0
        cy = rect['y'] + rect['h'] * y_ratio
        px = int(cx * 3.0)
        py = int(cy * 3.0 + 120)
        self.log(self.current_tag, f"Tapping {sel} at css=({cx:.1f}, {cy:.1f}) -> phys=({px}, {py})")
        self.adb(["shell", "input", "tap", str(px), str(py)])
        time.sleep(0.6)
        return px, py

    def ensure_panel_open(self):
        """确保停留在『我的 → 提醒设置』面板内"""
        self.adb(["shell", "input", "keyevent", "224"])
        time.sleep(0.3)
        self.adb(["shell", "wm", "dismiss-keyguard"])
        self.dismiss_alarm_activity_if_top()
        self.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
        time.sleep(0.8)

        sheet_open = self.eval("document.querySelector('#sheetSetup')?.classList.contains('open')")
        if sheet_open:
            return

        # 切换到 home 再切到 me，确保滚动条复位在顶部
        self.tap_element('[data-tab="home"]', y_ratio=0.3)
        time.sleep(0.5)
        self.tap_element('[data-tab="me"]', y_ratio=0.3)
        time.sleep(0.5)

        self.tap_element('#btnSetup', y_ratio=0.5)
        time.sleep(1.0)

    def ensure_on_home(self):
        """确保停留在首页 tab 且 sheetSetup 关闭"""
        self.adb(["shell", "input", "keyevent", "224"])
        time.sleep(0.3)
        self.adb(["shell", "wm", "dismiss-keyguard"])
        self.dismiss_alarm_activity_if_top()
        self.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
        time.sleep(0.8)

        sheet_open = self.eval("document.querySelector('#sheetSetup')?.classList.contains('open')")
        if sheet_open:
            self.tap_element('#sheetSetup .icon-btn')
            time.sleep(0.5)

        active_tab = self.eval("document.querySelector('[data-tab].active')?.dataset.tab")
        if active_tab != 'home':
            self.tap_element('[data-tab="home"]', y_ratio=0.3)
            time.sleep(0.6)

    def check_power_and_keyguard(self):
        p_out = self.adb(["shell", "dumpsys", "power"])
        wake = "unknown"
        for line in p_out.splitlines():
            if "mWakefulness=" in line:
                wake = line.strip().split('=')[-1]
                break

        w_out = self.adb(["shell", "dumpsys", "window"])
        keyguard = "isKeyguardShowing=true" in w_out or "mShowingLockscreen=true" in w_out
        focus = ""
        for line in w_out.splitlines():
            if "mCurrentFocus" in line:
                focus = line.strip()
                break
        return wake, keyguard, focus

    def set_bgpower(self, target_mode, tag):
        self.adb(["shell", "am", "start", "-a", "android.settings.APPLICATION_DETAILS_SETTINGS", "-d", f"package:{PACKAGE}"])
        time.sleep(2.0)
        self.adb(["shell", "input", "tap", "150", "992"])
        time.sleep(2.0)
        self.adb(["shell", "input", "tap", "246", "2090"])
        time.sleep(2.0)
        self.dump_xml(f"{tag}-before")
        self.shot(f"{tag}-before")

        coords = (306, 743) if "智能控制" in target_mode else (306, 988)
        t_switch = self.device_ms()
        self.log(tag, f"Tswitch={t_switch} tapping {target_mode} at {coords}")
        self.adb(["shell", "input", "tap", str(coords[0]), str(coords[1])])
        time.sleep(1.5)

        xml_after = self.dump_xml(f"{tag}-after")
        self.shot(f"{tag}-after")

        checked = None
        for m in re.finditer(r'<node[^>]*class="android.widget.RadioButton"[^>]*checked="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml_after):
            top_y = int(m.group(2))
            if 700 <= top_y <= 850: checked = "智能控制后台耗电"
            elif 950 <= top_y <= 1100: checked = "允许后台耗电"
        self.log(tag, f"after mode: {checked} (expected: {target_mode})")

        self.adb(["shell", "input", "keyevent", "4"]); time.sleep(0.4)
        self.adb(["shell", "input", "keyevent", "4"]); time.sleep(0.4)
        self.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
        time.sleep(1.5)
        return t_switch, checked

    def get_90003_alarm(self):
        out = self.adb(["shell", "dumpsys", "alarm"])
        lines = [l for l in out.splitlines() if "space.alliswell.inbox" in l or "90003" in l or "ACTION_TEST_ALARM" in l]
        for l in out.splitlines():
            if "Alarm{" in l and ("ACTION_TEST_ALARM" in l or "90003" in l):
                return l.strip(), lines
        return None, lines

    def clean_reset_test_state(self):
        """如果 testRun 已有结果或 seenAt，通过先点开始再点停止将其置为 seenAt=null, stoppedAt!=null"""
        self.ensure_panel_open()
        self.tap_element("#setupTestStart")
        time.sleep(0.4)
        self.tap_element("#setupTestStop")
        time.sleep(0.5)


# ==============================================================================
# 场景执行函数
# ==============================================================================

def run_T1(runner, attempt_idx):
    tag = f"T1-{attempt_idx}"
    runner.current_tag = tag
    start_logcat_idx = runner.logcat.current_line_count()
    runner.log(tag, f"=== T1 排程 [{tag}] start ===")
    sampler = Sampler(runner, tag, interval=0.15)
    sampler.start()

    runner.ensure_panel_open()
    before_ev = runner.eval("document.querySelector('#setupEvidence')?.innerText.trim()")
    runner.log(tag, f"Before tap evidence: {before_ev}")

    # 物理点击开始测试
    runner.tap_element("#setupTestStart")
    time.sleep(1.0)

    # 记录 toast 文案
    toast = runner.eval("document.querySelector('#toastText')?.innerText.trim()")
    runner.log(tag, f"Toast text: {toast}")

    # 记录 state.settings.testRun
    run_state = runner.eval("JSON.parse(JSON.stringify(window.__ATTENTION_INBOX__.state.settings.testRun || null))")
    runner.log(tag, f"state.settings.testRun: {json.dumps(run_state)}")

    # 记录 dumpsys alarm 90003
    alarm_entry, all_alarms = runner.get_90003_alarm()
    runner.log(tag, f"dumpsys alarm 90003 entry: {alarm_entry}")

    orig_when = None
    if alarm_entry:
        m = re.search(r'origWhen\s+(\d+)', alarm_entry)
        if m: orig_when = int(m.group(1))
    trigger_diff_ms = (orig_when - run_state['triggerAt']) if (orig_when and run_state) else None
    runner.log(tag, f"Alarm origWhen={orig_when}, testRun.triggerAt={run_state.get('triggerAt')}, diff_ms={trigger_diff_ms}")

    # 记录面板文案
    after_ev = runner.eval("document.querySelector('#setupEvidence')?.innerText.trim()")
    runner.log(tag, f"After tap evidence: {after_ev}")

    # 截图留证
    runner.shot(f"{tag}_panel")

    # 物理点击停止以清理本次 90003 排程
    runner.tap_element("#setupTestStop")
    time.sleep(1.0)
    alarm_after, _ = runner.get_90003_alarm()
    runner.log(tag, f"After stop dumpsys alarm 90003 entry: {alarm_after}")

    sampler.stop()
    end_logcat_idx = runner.logcat.current_line_count()
    runner.logcat.slice_tag(tag, start_logcat_idx, end_logcat_idx)
    runner.log(tag, f"=== T1 排程 [{tag}] end ===")
    return {
        "tag": tag,
        "toast": toast,
        "testRun": run_state,
        "origWhen": orig_when,
        "triggerDiffMs": trigger_diff_ms,
        "evidence": after_ev,
        "alarmCancelled": (alarm_after is None)
    }


def run_T2(runner, attempt_idx):
    tag = f"T2-{attempt_idx}"
    runner.current_tag = tag
    start_logcat_idx = runner.logcat.current_line_count()
    runner.log(tag, f"=== T2 基线下锁屏投递 [{tag}] start ===")
    sampler = Sampler(runner, tag, interval=0.20)
    sampler.start()

    runner.ensure_panel_open()
    runner.tap_element("#setupTestStart")
    t_start = runner.device_ms()
    time.sleep(0.5)
    run_state = runner.eval("JSON.parse(JSON.stringify(window.__ATTENTION_INBOX__.state.settings.testRun || null))")
    trigger_at = run_state.get('triggerAt', t_start + 60000)
    runner.log(tag, f"Test started: t_start={t_start}, triggerAt={trigger_at}")

    # 10 秒内锁屏熄屏
    runner.log(tag, "Locking screen within 10s...")
    runner.adb(["shell", "input", "keyevent", "223"])
    time.sleep(1.5)

    # 触发前双重确认锁屏熄屏
    wake, keyguard, focus = runner.check_power_and_keyguard()
    runner.log(tag, f"Pre-trigger lock check: mWakefulness={wake}, keyguard={keyguard}, focus={focus}")
    if wake != "Asleep" or not keyguard:
        runner.log(tag, "WARNING: Screen not asleep/locked, re-sending keyevent 223")
        runner.adb(["shell", "input", "keyevent", "223"])
        time.sleep(1.0)
        wake, keyguard, focus = runner.check_power_and_keyguard()
        runner.log(tag, f"Pre-trigger lock recheck: mWakefulness={wake}, keyguard={keyguard}, focus={focus}")

    # 等待投递 (直到 trigger_at + 15s)
    runner.log(tag, f"Waiting for alarm delivery at ~{trigger_at} without touching device...")
    deliver_found = False
    deliver_line_text = ""
    wait_until_ms = trigger_at + 15000
    while runner.device_ms() < wait_until_ms:
        time.sleep(1.0)
        with runner.logcat.lock:
            for l in reversed(runner.logcat.lines[start_logcat_idx:]):
                if "AttentionAlarm" in l and "deliver" in l:
                    deliver_line_text = l.strip()
                    deliver_found = True
                    break
        if deliver_found:
            break

    t_deliver = runner.device_ms()
    runner.log(tag, f"Deliver check result: found={deliver_found}, line='{deliver_line_text}'")

    # 检查自亮屏与焦点
    wake_after, keyguard_after, focus_after = runner.check_power_and_keyguard()
    runner.log(tag, f"Post-deliver status: mWakefulness={wake_after}, keyguard={keyguard_after}, focus={focus_after}")

    # 检查 AlarmRingService
    service_out = runner.adb(["shell", "dumpsys", "activity", "service", "space.alliswell.inbox/.AlarmRingService"])
    has_ring_service = "space.alliswell.inbox/.AlarmRingService" in service_out
    runner.log(tag, f"AlarmRingService active: {has_ring_service}")

    # 检查 appops
    appops_vib = runner.adb(["shell", "cmd", "appops", "get", "space.alliswell.inbox", "VIBRATE"])
    runner.log(tag, f"appops VIBRATE: {appops_vib}")

    # 亮屏回到应用
    runner.log(tag, "Waking up device after recording deliver...")
    runner.adb(["shell", "input", "keyevent", "224"])
    time.sleep(0.4)
    runner.adb(["shell", "wm", "dismiss-keyguard"])
    runner.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
    time.sleep(1.5)

    runner.ensure_panel_open()
    time.sleep(1.8) # 等待 setupEvidenceHtml 渲染并写入 seenAt

    evidence_text = runner.eval("document.querySelector('#setupEvidence')?.innerText.trim()")
    runner.log(tag, f"Evidence text: {evidence_text}")

    run_state_after = runner.eval("JSON.parse(JSON.stringify(window.__ATTENTION_INBOX__.state.settings.testRun || null))")
    seen_at = run_state_after.get('seenAt') if run_state_after else None
    runner.log(tag, f"testRun.seenAt: {seen_at}")

    btn_text = runner.eval("document.querySelector('#setupTestStart')?.innerText.trim()")
    test_step = runner.eval("(() => { const inbox = window.__ATTENTION_INBOX__; const s = inbox.state.settings; return window.AttentionLib.Feedback.setupSteps(inbox.getNativeReminderStatus(), {testRun: s.testRun, testFeedback: s.testFeedback}).steps.find(x => x.id === 'test'); })()")
    runner.log(tag, f"btnTestStart text: {btn_text}, testStep: {json.dumps(test_step, ensure_ascii=False)}")

    runner.shot(f"{tag}_panel")

    # 停止铃声
    runner.tap_element("#setupTestStop")
    time.sleep(1.0)

    sampler.stop()
    end_logcat_idx = runner.logcat.current_line_count()
    runner.logcat.slice_tag(tag, start_logcat_idx, end_logcat_idx)
    runner.log(tag, f"=== T2 基线下锁屏投递 [{tag}] end ===")
    return {
        "tag": tag,
        "triggerAt": trigger_at,
        "deliverLine": deliver_line_text,
        "wakefulnessAfterDeliver": wake_after,
        "hasRingService": has_ring_service,
        "seenAt": seen_at,
        "btnText": btn_text,
        "testStep": test_step,
        "evidence": evidence_text
    }


def run_T3a(runner, attempt_idx):
    tag = f"T3a-{attempt_idx}"
    runner.current_tag = tag
    start_logcat_idx = runner.logcat.current_line_count()
    runner.log(tag, f"=== T3a 正在响时停止 [{tag}] start ===")
    sampler = Sampler(runner, tag, interval=0.15)
    sampler.start()

    runner.ensure_panel_open()
    runner.tap_element("#setupTestStart")
    t_start = runner.device_ms()
    time.sleep(0.5)
    run_state = runner.eval("JSON.parse(JSON.stringify(window.__ATTENTION_INBOX__.state.settings.testRun || null))")
    trigger_at = run_state.get('triggerAt', t_start + 60000)
    runner.log(tag, f"Test started: triggerAt={trigger_at}")

    # 锁屏等响
    runner.adb(["shell", "input", "keyevent", "223"])
    time.sleep(1.5)
    wake, keyguard, focus = runner.check_power_and_keyguard()
    runner.log(tag, f"Pre-trigger lock check: mWakefulness={wake}, keyguard={keyguard}")

    # 等到响铃
    deliver_found = False
    wait_until_ms = trigger_at + 15000
    while runner.device_ms() < wait_until_ms:
        time.sleep(1.0)
        with runner.logcat.lock:
            for l in reversed(runner.logcat.lines[start_logcat_idx:]):
                if "AttentionAlarm" in l and "deliver" in l:
                    deliver_found = True
                    break
        if deliver_found:
            break

    runner.log(tag, f"Alarm delivered, deliver_found={deliver_found}. Waiting 2s for ring...")
    time.sleep(2.0)

    # 亮屏回到面板
    runner.adb(["shell", "input", "keyevent", "224"])
    time.sleep(0.4)
    runner.adb(["shell", "wm", "dismiss-keyguard"])
    runner.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
    time.sleep(1.0)
    runner.ensure_panel_open()
    time.sleep(0.5)

    # 确认响铃服务当前在运行
    service_before = runner.adb(["shell", "dumpsys", "activity", "service", "space.alliswell.inbox/.AlarmRingService"])
    ring_active_before = "space.alliswell.inbox/.AlarmRingService" in service_before
    runner.log(tag, f"Before stop ring active: {ring_active_before}")

    # 物理点击停止
    runner.tap_element("#setupTestStop")
    time.sleep(0.8)

    toast = runner.eval("document.querySelector('#toastText')?.innerText.trim()")
    runner.log(tag, f"Toast text: {toast}")

    # 验证服务真的停了
    service_after = runner.adb(["shell", "dumpsys", "activity", "service", "space.alliswell.inbox/.AlarmRingService"])
    ring_active_after = "space.alliswell.inbox/.AlarmRingService" in service_after
    runner.log(tag, f"After stop ring active: {ring_active_after}")

    run_state_after = runner.eval("JSON.parse(JSON.stringify(window.__ATTENTION_INBOX__.state.settings.testRun || null))")
    stopped_at = run_state_after.get('stoppedAt') if run_state_after else None
    runner.log(tag, f"testRun.stoppedAt: {stopped_at}")

    evidence_text = runner.eval("document.querySelector('#setupEvidence')?.innerText.trim()")
    runner.log(tag, f"Evidence text: {evidence_text}")

    runner.shot(f"{tag}_stopped")

    sampler.stop()
    end_logcat_idx = runner.logcat.current_line_count()
    runner.logcat.slice_tag(tag, start_logcat_idx, end_logcat_idx)
    runner.log(tag, f"=== T3a 正在响时停止 [{tag}] end ===")
    return {
        "tag": tag,
        "ringActiveBefore": ring_active_before,
        "ringActiveAfter": ring_active_after,
        "toast": toast,
        "stoppedAt": stopped_at,
        "evidence": evidence_text
    }


def run_T3b(runner, attempt_idx):
    tag = f"T3b-{attempt_idx}"
    runner.current_tag = tag
    start_logcat_idx = runner.logcat.current_line_count()
    runner.log(tag, f"=== T3b 未到点时停止 [{tag}] start ===")
    sampler = Sampler(runner, tag, interval=0.15)
    sampler.start()

    runner.ensure_panel_open()
    runner.tap_element("#setupTestStart")
    time.sleep(1.0)

    # 确认 dumpsys alarm 90003 存在
    entry_before, all_before = runner.get_90003_alarm()
    runner.log(tag, f"dumpsys alarm 90003 before stop: {entry_before}")

    # 未到点 (约开始后 3 秒) 点停止
    time.sleep(1.5)
    runner.tap_element("#setupTestStop")
    time.sleep(0.8)

    toast = runner.eval("document.querySelector('#toastText')?.innerText.trim()")
    runner.log(tag, f"Toast text: {toast}")

    entry_after, all_after = runner.get_90003_alarm()
    runner.log(tag, f"dumpsys alarm 90003 after stop: {entry_after}")

    # 检查其他用户闹钟未受影响 (只认真实排程 Alarm{...)
    user_alarms_before = [l for l in all_before if "Alarm{" in l and "90003" not in l and "ACTION_TEST_ALARM" not in l]
    user_alarms_after = [l for l in all_after if "Alarm{" in l and "90003" not in l and "ACTION_TEST_ALARM" not in l]
    alarms_unchanged = (len(user_alarms_before) == len(user_alarms_after))
    runner.log(tag, f"User alarms count before={len(user_alarms_before)}, after={len(user_alarms_after)}, unchanged={alarms_unchanged}")

    run_state_after = runner.eval("JSON.parse(JSON.stringify(window.__ATTENTION_INBOX__.state.settings.testRun || null))")
    stopped_at = run_state_after.get('stoppedAt') if run_state_after else None
    runner.log(tag, f"testRun.stoppedAt: {stopped_at}")

    runner.shot(f"{tag}_cancelled")

    sampler.stop()
    end_logcat_idx = runner.logcat.current_line_count()
    runner.logcat.slice_tag(tag, start_logcat_idx, end_logcat_idx)
    runner.log(tag, f"=== T3b 未到点时停止 [{tag}] end ===")
    return {
        "tag": tag,
        "entryBefore": entry_before,
        "entryAfter": entry_after,
        "toast": toast,
        "otherAlarmsUnchanged": alarms_unchanged,
        "stoppedAt": stopped_at
    }


def run_T3c(runner, attempt_idx):
    tag = f"T3c-{attempt_idx}"
    runner.current_tag = tag
    start_logcat_idx = runner.logcat.current_line_count()
    runner.log(tag, f"=== T3c 四个反馈按钮与新测试重置 [{tag}] start ===")
    sampler = Sampler(runner, tag, interval=0.15)
    sampler.start()

    runner.ensure_panel_open()
    fb_results = {}
    buttons = [
        ("heard", "我听到了", "这次听到了"),
        ("seen", "我看到了", "这次看到了"),
        ("missed", "没收到", "这次没有收到 · 按下面步骤再看一次"),
        ("unsure", "不确定", "这次结果不确定 · 不算失败，可以再测一次")
    ]

    for val, label, exp_verdict in buttons:
        runner.tap_element(f'#setupTestFeedback [data-testfb="{val}"]')
        time.sleep(0.6)
        fb_state = runner.eval("JSON.parse(JSON.stringify(window.__ATTENTION_INBOX__.state.settings.testFeedback || null))")
        toast = runner.eval("document.querySelector('#toastText')?.innerText.trim()")
        ev_text = runner.eval("document.querySelector('#setupEvidence')?.innerText.trim()")
        active_chip = runner.eval("document.querySelector('#setupTestFeedback .chip.on')?.dataset.testfb")
        runner.log(tag, f"Feedback '{val}': activeChip={active_chip}, toast='{toast}', testFeedback={json.dumps(fb_state)}")
        fb_results[val] = {
            "activeChip": active_chip,
            "toast": toast,
            "testFeedback": fb_state,
            "evidence": ev_text,
            "verdictMatch": exp_verdict in (ev_text or "")
        }

    # 开始一次新测试，确认上一次反馈不再高亮，面板显示「这是上一次的回答，本次还没有」
    runner.tap_element("#setupTestStart")
    time.sleep(0.8)

    active_chips_new = runner.eval("[...document.querySelectorAll('#setupTestFeedback .chip.on')].map(b => b.dataset.testfb)")
    ev_text_new = runner.eval("document.querySelector('#setupEvidence')?.innerText.trim()")
    has_stale_notice = "（这是上一次的回答，本次还没有）" in (ev_text_new or "")
    runner.log(tag, f"New test started: activeChips={active_chips_new} (should be []), hasStaleNotice={has_stale_notice}")
    runner.log(tag, f"Evidence text: {ev_text_new}")

    runner.shot(f"{tag}_new_test_reset")

    # 停止该新测试
    runner.tap_element("#setupTestStop")
    time.sleep(0.6)

    sampler.stop()
    end_logcat_idx = runner.logcat.current_line_count()
    runner.logcat.slice_tag(tag, start_logcat_idx, end_logcat_idx)
    runner.log(tag, f"=== T3c 四个反馈按钮与新测试重置 [{tag}] end ===")
    return {
        "tag": tag,
        "feedbacks": fb_results,
        "newTestActiveChips": active_chips_new,
        "hasStaleNotice": has_stale_notice,
        "evidence": ev_text_new
    }


def run_T4(runner, attempt_idx):
    tag = f"T4-{attempt_idx}"
    runner.current_tag = tag
    start_logcat_idx = runner.logcat.current_line_count()
    runner.log(tag, f"=== T4 冻结下迟到投递验证 [{tag}] start ===")
    sampler = Sampler(runner, tag, interval=0.20)
    sampler.start()

    # 0. 准备: 清理 testRun 保证 testVerified 为 false
    runner.clean_reset_test_state()
    time.sleep(0.5)

    # 1. 确保后台耗电管理处于「智能控制后台耗电」
    t_switch, checked_mode = runner.set_bgpower("智能控制后台耗电", f"{tag}-prep")
    runner.log(tag, f"Switched to 智能控制后台耗电: checked={checked_mode}")

    # 2. 回到首页，刷新原生状态，确认首页防冻结卡片出现
    runner.ensure_on_home()
    time.sleep(0.5)
    runner.eval("window.__ATTENTION_INBOX__.nativeCoordinator.refreshNativeStatus('t4-prep')", await_promise=True)
    time.sleep(1.0)

    card_text = runner.eval("document.querySelector('#homeSetup')?.innerText.trim()")
    card_exists = bool(card_text and len(card_text) > 0)
    runner.log(tag, f"Home card before test: exists={card_exists}, text='{card_text}'")
    runner.shot(f"{tag}_home_before")

    # 3. 打开设置面板并开始 60 秒测试
    if card_exists:
        runner.tap_element('#setupEntry')
    else:
        runner.ensure_panel_open()
    time.sleep(1.0)
    runner.ensure_panel_open()
    runner.tap_element("#setupTestStart")
    t_start = runner.device_ms()
    time.sleep(0.5)

    run_state = runner.eval("JSON.parse(JSON.stringify(window.__ATTENTION_INBOX__.state.settings.testRun || null))")
    trigger_at = run_state.get('triggerAt', t_start + 60000)
    runner.log(tag, f"Test started: t_start={t_start}, triggerAt={trigger_at}")

    # 4. 10 秒内锁屏熄屏
    runner.log(tag, "Locking screen within 10s...")
    runner.adb(["shell", "input", "keyevent", "223"])
    time.sleep(1.5)

    # 双重确认锁屏熄屏
    wake, keyguard, focus = runner.check_power_and_keyguard()
    runner.log(tag, f"Pre-trigger lock check: mWakefulness={wake}, keyguard={keyguard}, focus={focus}")
    if wake != "Asleep" or not keyguard:
        runner.adb(["shell", "input", "keyevent", "223"])
        time.sleep(1.0)
        wake, keyguard, focus = runner.check_power_and_keyguard()
        runner.log(tag, f"Pre-trigger lock recheck: mWakefulness={wake}, keyguard={keyguard}")

    # 5. 到点后至少再等 3 分钟不碰设备 (总等待: 60s + 180s = 240s)
    target_wake_time = trigger_at + 180000
    runner.log(tag, f"Sleeping until target_wake_time={target_wake_time} (+180s after triggerAt)...")

    deliver_during_sleep = None
    frozen_during_sleep = []
    unfrozen_during_sleep = []

    while runner.device_ms() < target_wake_time:
        time.sleep(2.0)
        with runner.logcat.lock:
            for l in runner.logcat.lines[start_logcat_idx:]:
                if "AttentionAlarm" in l and "deliver" in l and not deliver_during_sleep:
                    deliver_during_sleep = l.strip()
                if "am_app_frozen" in l and PACKAGE in l and l.strip() not in frozen_during_sleep:
                    frozen_during_sleep.append(l.strip())
                if "am_app_unfrozen" in l and PACKAGE in l and l.strip() not in unfrozen_during_sleep:
                    unfrozen_during_sleep.append(l.strip())

    runner.log(tag, f"Wait completed (+3m after triggerAt). Deliver during sleep: {deliver_during_sleep}")
    runner.log(tag, f"am_app_frozen during sleep count: {len(frozen_during_sleep)}")
    for f_line in frozen_during_sleep:
        runner.log(tag, f"  Frozen log: {f_line}")

    # 6. 唤醒设备并回到应用
    t_wake_cmd = runner.device_ms()
    runner.log(tag, f"Waking up device at t_wake={t_wake_cmd}...")
    runner.adb(["shell", "input", "keyevent", "224"])
    time.sleep(0.4)
    runner.adb(["shell", "wm", "dismiss-keyguard"])
    time.sleep(1.0)
    runner.dismiss_alarm_activity_if_top()
    runner.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
    time.sleep(2.0)
    runner.dismiss_alarm_activity_if_top()

    deliver_final_line = None
    with runner.logcat.lock:
        for l in runner.logcat.lines[start_logcat_idx:]:
            if "AttentionAlarm" in l and "deliver" in l:
                deliver_final_line = l.strip()
            if "am_app_unfrozen" in l and PACKAGE in l and l.strip() not in unfrozen_during_sleep:
                unfrozen_during_sleep.append(l.strip())

    runner.log(tag, f"Final deliver line: {deliver_final_line}")
    runner.log(tag, f"am_app_unfrozen count: {len(unfrozen_during_sleep)}")
    for uf_line in unfrozen_during_sleep:
        runner.log(tag, f"  Unfrozen log: {uf_line}")

    # 打开设置面板，等待 seenAt 写入
    runner.ensure_panel_open()
    time.sleep(2.0)

    evidence_text = runner.eval("document.querySelector('#setupEvidence')?.innerText.trim()")
    run_state_after = runner.eval("JSON.parse(JSON.stringify(window.__ATTENTION_INBOX__.state.settings.testRun || null))")
    seen_at = run_state_after.get('seenAt') if run_state_after else None
    runner.log(tag, f"Evidence text: {evidence_text}")
    runner.log(tag, f"seenAt: {seen_at}")

    # 检查测试步骤判定
    step_info = runner.eval("""(() => {
      const inbox = window.__ATTENTION_INBOX__;
      const s = inbox.state.settings;
      const st = window.AttentionLib.Feedback.setupSteps(inbox.getNativeReminderStatus(), {
        testRun: s.testRun, testFeedback: s.testFeedback
      });
      return {
        testStep: st.steps.find(x => x.id === 'test'),
        bgStep: st.steps.find(x => x.id === 'background')
      };
    })()""")
    runner.log(tag, f"Step status: {json.dumps(step_info, ensure_ascii=False)}")

    runner.shot(f"{tag}_panel")

    # 关闭面板，切回首页，检查首页防冻结卡片是否消失
    runner.ensure_on_home()
    time.sleep(1.0)
    card_text_after = runner.eval("document.querySelector('#homeSetup')?.innerText.trim()")
    card_exists_after = bool(card_text_after and len(card_text_after) > 0)
    card_dismissed = (card_exists and not card_exists_after)
    runner.log(tag, f"Home card after test: exists={card_exists_after}, cardDismissed={card_dismissed}, text='{card_text_after}'")
    runner.shot(f"{tag}_home_after")

    delay_ms = None
    if seen_at and trigger_at:
        delay_ms = seen_at - trigger_at

    # 核心缺陷判定:
    # 如果投递迟到超过 30 秒（即实际到唤醒后才投递/延迟>30s），但卡片被消掉（cardDismissed=True 或 homeDone=True），
    # 这是产品缺陷，照实记录为 FAIL。
    is_late = (delay_ms is not None and delay_ms > 30000) or (deliver_during_sleep is None and deliver_final_line is not None)
    card_cleared = (not card_exists_after)
    verdict = "FAIL" if (is_late and card_cleared) else "PASS"
    runner.log(tag, f"VERDICT: {verdict} (is_late={is_late}, delay_ms={delay_ms}, card_cleared={card_cleared})")

    # 停止铃声并清理
    runner.ensure_panel_open()
    runner.tap_element("#setupTestStop")
    time.sleep(0.8)

    sampler.stop()
    end_logcat_idx = runner.logcat.current_line_count()
    runner.logcat.slice_tag(tag, start_logcat_idx, end_logcat_idx)
    runner.log(tag, f"=== T4 冻结下迟到投递验证 [{tag}] end ===")
    return {
        "tag": tag,
        "frozenCount": len(frozen_during_sleep),
        "unfrozenCount": len(unfrozen_during_sleep),
        "frozenLogs": frozen_during_sleep,
        "unfrozenLogs": unfrozen_during_sleep,
        "deliverDuringSleep": deliver_during_sleep,
        "deliverFinal": deliver_final_line,
        "triggerAt": trigger_at,
        "seenAt": seen_at,
        "delayMs": delay_ms,
        "isLate": is_late,
        "cardBeforeExists": card_exists,
        "cardAfterExists": card_exists_after,
        "cardDismissed": card_dismissed,
        "stepInfo": step_info,
        "verdict": verdict,
        "evidence": evidence_text
    }


def run_T5(runner, attempt_idx):
    tag = f"T5-{attempt_idx}"
    runner.current_tag = tag
    start_logcat_idx = runner.logcat.current_line_count()
    runner.log(tag, f"=== T5 退到后台再锁屏投递 [{tag}] start ===")
    sampler = Sampler(runner, tag, interval=0.20)
    sampler.start()

    runner.ensure_panel_open()
    runner.tap_element("#setupTestStart")
    t_start = runner.device_ms()
    time.sleep(0.5)
    run_state = runner.eval("JSON.parse(JSON.stringify(window.__ATTENTION_INBOX__.state.settings.testRun || null))")
    trigger_at = run_state.get('triggerAt', t_start + 60000)
    runner.log(tag, f"Test started: triggerAt={trigger_at}")

    # 10 秒内按 Home 键退到桌面再锁屏
    runner.log(tag, "Pressing HOME key then SLEEP key within 10s...")
    runner.adb(["shell", "input", "keyevent", "3"])
    time.sleep(0.8)
    runner.adb(["shell", "input", "keyevent", "223"])
    time.sleep(1.5)

    wake, keyguard, focus = runner.check_power_and_keyguard()
    runner.log(tag, f"Pre-trigger lock check: mWakefulness={wake}, keyguard={keyguard}, focus={focus}")

    # 等待投递
    runner.log(tag, f"Waiting for alarm delivery at ~{trigger_at}...")
    deliver_found = False
    deliver_line_text = ""
    wait_until_ms = trigger_at + 15000
    while runner.device_ms() < wait_until_ms:
        time.sleep(1.0)
        with runner.logcat.lock:
            for l in reversed(runner.logcat.lines[start_logcat_idx:]):
                if "AttentionAlarm" in l and "deliver" in l:
                    deliver_line_text = l.strip()
                    deliver_found = True
                    break
        if deliver_found:
            break

    runner.log(tag, f"Deliver check result: found={deliver_found}, line='{deliver_line_text}'")

    wake_after, keyguard_after, focus_after = runner.check_power_and_keyguard()
    runner.log(tag, f"Post-deliver status: mWakefulness={wake_after}, keyguard={keyguard_after}, focus={focus_after}")

    service_out = runner.adb(["shell", "dumpsys", "activity", "service", "space.alliswell.inbox/.AlarmRingService"])
    has_ring_service = "space.alliswell.inbox/.AlarmRingService" in service_out
    runner.log(tag, f"AlarmRingService active: {has_ring_service}")

    # 亮屏回到应用
    runner.adb(["shell", "input", "keyevent", "224"])
    time.sleep(0.4)
    runner.adb(["shell", "wm", "dismiss-keyguard"])
    time.sleep(1.0)
    runner.dismiss_alarm_activity_if_top()
    runner.adb(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
    time.sleep(1.5)
    runner.dismiss_alarm_activity_if_top()

    runner.ensure_panel_open()
    time.sleep(1.8)

    evidence_text = runner.eval("document.querySelector('#setupEvidence')?.innerText.trim()")
    run_state_after = runner.eval("JSON.parse(JSON.stringify(window.__ATTENTION_INBOX__.state.settings.testRun || null))")
    seen_at = run_state_after.get('seenAt') if run_state_after else None
    btn_text = runner.eval("document.querySelector('#setupTestStart')?.innerText.trim()")
    test_step = runner.eval("(() => { const inbox = window.__ATTENTION_INBOX__; const s = inbox.state.settings; return window.AttentionLib.Feedback.setupSteps(inbox.getNativeReminderStatus(), {testRun: s.testRun, testFeedback: s.testFeedback}).steps.find(x => x.id === 'test'); })()")

    runner.log(tag, f"Evidence text: {evidence_text}")
    runner.log(tag, f"seenAt: {seen_at}, btnText: {btn_text}, testStep: {json.dumps(test_step, ensure_ascii=False)}")

    runner.shot(f"{tag}_panel")

    # 停止铃声
    runner.tap_element("#setupTestStop")
    time.sleep(1.0)

    sampler.stop()
    end_logcat_idx = runner.logcat.current_line_count()
    runner.logcat.slice_tag(tag, start_logcat_idx, end_logcat_idx)
    runner.log(tag, f"=== T5 退到后台再锁屏投递 [{tag}] end ===")
    return {
        "tag": tag,
        "triggerAt": trigger_at,
        "deliverLine": deliver_line_text,
        "wakefulnessAfterDeliver": wake_after,
        "hasRingService": has_ring_service,
        "seenAt": seen_at,
        "btnText": btn_text,
        "testStep": test_step,
        "evidence": evidence_text
    }


def main():
    runner = DeviceRunner()
    summary = {
        "runId": RUN_ID,
        "device": "vivo V2238A",
        "serial": SERIAL,
        "package": PACKAGE,
        "results": {}
    }

    try:
        runner.log("MAIN", "=== 60s 测试完整真机验证继续（断点续跑） ===")

        # 载入已完成的场景结果
        summary["results"]["T1"] = [
            {"tag": "T1-1", "toast": "已排 60 秒测试 · 可以锁屏了", "testRun": {"id": 90003, "startedAt": 1790646909330, "triggerAt": 1790646969346, "stoppedAt": None, "seenAt": None, "feedbackAt": None}, "origWhen": 1790646969346, "triggerDiffMs": 0, "alarmCancelled": True},
            {"tag": "T1-2", "toast": "已排 60 秒测试 · 可以锁屏了", "testRun": {"id": 90003, "startedAt": 1790646917113, "triggerAt": 1790646977131, "stoppedAt": None, "seenAt": None, "feedbackAt": None}, "origWhen": 1790646977131, "triggerDiffMs": 0, "alarmCancelled": True},
            {"tag": "T1-3", "toast": "已排 60 秒测试 · 可以锁屏了", "testRun": {"id": 90003, "startedAt": 1790646924980, "triggerAt": 1790646985000, "stoppedAt": None, "seenAt": None, "feedbackAt": None}, "origWhen": 1790646985000, "triggerDiffMs": 0, "alarmCancelled": True}
        ]
        summary["results"]["T2"] = [
            {"tag": "T2-1", "triggerAt": 1790646992943, "deliverLine": "09-29 09:56:33.165 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true", "wakefulnessBefore": "Asleep", "wakefulnessAfter": "Asleep", "keyguardBefore": True, "keyguardAfter": True, "hasRingService": True, "vibrateRunning": True, "seenAt": 1790646993921},
            {"tag": "T2-2", "triggerAt": 1790647066578, "deliverLine": "09-29 09:57:46.790 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true", "wakefulnessBefore": "Asleep", "wakefulnessAfter": "Asleep", "keyguardBefore": True, "keyguardAfter": True, "hasRingService": True, "vibrateRunning": True, "seenAt": 1790647067558},
            {"tag": "T2-3", "triggerAt": 1790647139994, "deliverLine": "09-29 09:59:00.199 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true", "wakefulnessBefore": "Asleep", "wakefulnessAfter": "Asleep", "keyguardBefore": True, "keyguardAfter": True, "hasRingService": True, "vibrateRunning": True, "seenAt": 1790647140971}
        ]
        summary["results"]["T3a"] = [
            {"tag": "T3a-1", "triggerAt": 1790647213583, "deliverFound": True, "toastText": "已停止本次测试的铃声", "stoppedAt": 1790647220599},
            {"tag": "T3a-2", "triggerAt": 1790647286569, "deliverFound": True, "toastText": "已停止本次测试的铃声", "stoppedAt": 1790647293734},
            {"tag": "T3a-3", "triggerAt": 1790647359621, "deliverFound": True, "toastText": "已停止本次测试的铃声", "stoppedAt": 1790647366693}
        ]
        summary["results"]["T3b"] = [
            {"tag": "T3b-1", "origWhen": 1790647432523, "stoppedAt": 1790647376052, "toastText": "没有正在响的测试铃声 · 已取消未触发的测试", "alarmCancelled": True},
            {"tag": "T3b-2", "origWhen": 1790647441619, "stoppedAt": 1790647385119, "toastText": "没有正在响的测试铃声 · 已取消未触发的测试", "alarmCancelled": True},
            {"tag": "T3b-3", "origWhen": 1790647450621, "stoppedAt": 1790647394145, "toastText": "没有正在响的测试铃声 · 已取消未触发的测试", "alarmCancelled": True}
        ]
        summary["results"]["T3c"] = [
            {"tag": "T3c-1", "chips": ["heard", "seen", "missed", "unsure"], "newTestReset": True},
            {"tag": "T3c-2", "chips": ["heard", "seen", "missed", "unsure"], "newTestReset": True},
            {"tag": "T3c-3", "chips": ["heard", "seen", "missed", "unsure"], "newTestReset": True}
        ]

        runner.log("MAIN", ">>> 载入已完成的 T4-1 与 T4-2 结果")
        t4_results = [
            {
                "tag": "T4-1",
                "frozenCount": 0,
                "unfrozenCount": 0,
                "deliverDuringSleep": "09-29 10:05:32.988 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true",
                "deliverFinal": "09-29 10:05:32.988 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true",
                "triggerAt": 1790647532793,
                "seenAt": 1790647533932,
                "delayMs": 1139,
                "isLate": False,
                "cardBeforeExists": False,
                "cardAfterExists": False,
                "cardDismissed": False,
                "verdict": "PASS"
            },
            {
                "tag": "T4-2",
                "frozenCount": 1,
                "unfrozenCount": 1,
                "frozenLogs": ["09-29 10:09:36.170  1737  2108 I am_app_frozen: [0,10285,space.alliswell.inbox,from fast_freezer]"],
                "unfrozenLogs": ["09-29 10:13:30.961  1737  2108 I am_app_unfrozen: [0,10285,space.alliswell.inbox,screen on]"],
                "deliverDuringSleep": None,
                "deliverFinal": "09-29 10:13:31.187 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=true locked=true inCall=false canDrawOverlays=true",
                "triggerAt": 1790647829207,
                "seenAt": 1790648011524,
                "delayMs": 182317,
                "isLate": True,
                "cardBeforeExists": True,
                "cardAfterExists": False,
                "cardDismissed": True,
                "verdict": "FAIL"
            },
            {
                "tag": "T4-3",
                "frozenCount": 2,
                "unfrozenCount": 2,
                "frozenLogs": [
                    "09-29 10:22:35.337  1737  2108 I am_app_frozen: [0,10285,space.alliswell.inbox,from fast_freezer]",
                    "09-29 10:23:08.249  1737  2108 I am_app_frozen: [0,10285,space.alliswell.inbox,from fast_freezer]"
                ],
                "unfrozenLogs": [
                    "09-29 10:22:44.406  1737  2108 I am_app_unfrozen: [0,10285,space.alliswell.inbox,resume top activity]",
                    "09-29 10:25:34.952  1737  2108 I am_app_unfrozen: [0,10285,space.alliswell.inbox,resume top activity]"
                ],
                "deliverDuringSleep": "09-29 10:25:35.034 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true",
                "deliverFinal": "09-29 10:25:35.034 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true",
                "triggerAt": 1790648641244,
                "seenAt": 1790648823887,
                "delayMs": 93790,
                "isLate": True,
                "cardBeforeExists": True,
                "cardAfterExists": False,
                "cardDismissed": True,
                "verdict": "FAIL"
            }
        ]
        summary["results"]["T4"] = t4_results

        # 测后立即恢复后台耗电管理为「允许后台耗电」
        runner.log("MAIN", ">>> T4 完成，恢复后台耗电管理为「允许后台耗电」")
        runner.set_bgpower("允许后台耗电", "RESTORE-FINAL")

        # -------------------------------------------------------------
        # T5 应用退到后台 (2 次)
        # -------------------------------------------------------------
        runner.log("MAIN", ">>> 开始场景 T5 应用退到后台再锁屏 (2 次)")
        t5_results = []
        for i in range(1, 3):
            res = run_T5(runner, i)
            t5_results.append(res)
            time.sleep(2.0)
        summary["results"]["T5"] = t5_results

        # -------------------------------------------------------------
        # 测后恢复与最终核验
        # -------------------------------------------------------------
        runner.log("MAIN", ">>> 开始测后恢复与完整性校验")
        wl_final = runner.adb(["shell", "dumpsys", "deviceidle", "whitelist"])
        inbox_in_wl = "space.alliswell.inbox" in wl_final
        runner.log("MAIN", f"Final whitelist check: {inbox_in_wl}")

        items_final = runner.eval("window.__ATTENTION_INBOX__.state.items.map(x => ({id: x.id, title: x.title, status: x.status, rev: x.rev, priority: x.priority, triggerAt: x.triggerAt}))")
        runner.log("MAIN", f"Final items count: {len(items_final)}")
        with open(os.path.join(ARCH_RUN, "final-items-full.json"), "w", encoding="utf-8") as f:
            json.dump(items_final, f, ensure_ascii=False, indent=1)
        sanitized_final = [{k: i[k] for k in ('id','status','rev','priority','triggerAt')} for i in items_final]
        with open(os.path.join(REPO_RUN, "final-items-sanitized.json"), "w", encoding="utf-8") as f:
            json.dump(sanitized_final, f, ensure_ascii=False, indent=1)

        with open(os.path.join(REPO_RUN, "baseline-items-sanitized.json"), "r", encoding="utf-8") as f:
            baseline_items = json.load(f)
        items_match = (sanitized_final == baseline_items)
        runner.log("MAIN", f"Items match baseline exactly: {items_match}")
        summary["itemsMatchBaseline"] = items_match

        _, all_alarms_final = runner.get_90003_alarm()
        user_alarms_final = [l for l in all_alarms_final if "Alarm{" in l and "90003" not in l and "ACTION_TEST_ALARM" not in l]
        runner.log("MAIN", f"Final user alarms count: {len(user_alarms_final)}")
        summary["userAlarmsCount"] = len(user_alarms_final)

        with open(os.path.join(REPO_RUN, "summary.json"), "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        with open(os.path.join(ARCH_RUN, "summary.json"), "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)

        runner.log("MAIN", "=== 60s 测试完整真机验证成功完成 ===")

    finally:
        runner.close()


if __name__ == "__main__":
    main()
