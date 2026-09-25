#!/usr/bin/env python3
"""vivo 锁屏与系统开关矩阵验证脚本 (Switch Matrix)
严格遵守所有硬性纪律：
- 事项走真实物理保存流（表单输入、更多选项、选关键、安心交给系统均物理点击）；
- 严禁调用禁止函数；
- 锁屏后至 triggerAt+90s 绝对不进行任何唤醒屏幕的操作，仅以 5s 周期进行只读 dumpsys / screencap；
- 每一次尝试均写入 run.log，时间戳用设备时间；
- 完整 logcat 归档，过滤脱敏版本留存仓库；
- 脚本原样归档。
"""

import sys
import os
import time
import json
import subprocess
import urllib.request
import re
import xml.etree.ElementTree as ET
from datetime import datetime

# 清除环境变量代理，防止 127.0.0.1 请求走代理
for k in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'):
    os.environ.pop(k, None)
os.environ['NO_PROXY'] = '*'
os.environ['no_proxy'] = '*'

import websocket

SERIAL = "10ACBF2D3D000RS"
PACKAGE = "space.alliswell.inbox"
APP_UID = "10285"
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
RUN_ID = "20260925T153500Z-vivo-switch-matrix"
REPO_DIR = "/Users/qlyf/Developer/reminder"
REPO_RUN = os.path.join(REPO_DIR, "docs/reviews/verification-runs", RUN_ID)
ARCH_RUN = os.path.expanduser(f"~/Developer/reminder-archive/verification-runs/{RUN_ID}")
TSV_PATH = os.path.join(REPO_DIR, "docs/reviews/verification-runs/ARCHIVED-RAW-2026-09-25.tsv")
LOG_PATH = os.path.join(REPO_RUN, "run.log")

CDP_PORT = 53420
DPR = 3.0
SCREEN_X = 0
SCREEN_Y = 120

def adb_cmd(args):
    cmd = [ADB, "-s", SERIAL] + args
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return res.stdout.strip()

def adb_cmd_bytes(args):
    cmd = [ADB, "-s", SERIAL] + args
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return res.stdout

def get_dev_time_ms():
    out = adb_cmd(["shell", "date", "+%s%3N"])
    try:
        return int(out)
    except:
        return int(time.time() * 1000)

def get_dev_time_str(ms=None):
    if ms is None:
        ms = get_dev_time_ms()
    dt = datetime.fromtimestamp(ms / 1000.0)
    return dt.strftime("%Y-%m-%d %H:%M:%S")

def log(msg):
    dev_ms = get_dev_time_ms()
    dev_str = get_dev_time_str(dev_ms)
    line = f"[{dev_str}] [{dev_ms}] {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    with open(os.path.join(ARCH_RUN, "run.log"), "a", encoding="utf-8") as f:
        f.write(line + "\n")

class CDPClient:
    def __init__(self, port=CDP_PORT):
        self.port = port
        self.ws = None
        self.seq = 0
        self.connect()

    def connect(self):
        pid = adb_cmd(["shell", "pidof", PACKAGE])
        if not pid:
            adb_cmd(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
            time.sleep(2)
            pid = adb_cmd(["shell", "pidof", PACKAGE])
        adb_cmd(["forward", f"tcp:{self.port}", f"localabstract:webview_devtools_remote_{pid}"])
        time.sleep(0.5)

        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        url = f"http://127.0.0.1:{self.port}/json"
        targets = json.loads(opener.open(url, timeout=5).read().decode('utf-8'))
        page = next(t for t in targets if t.get('type') == 'page')
        self.ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)

    def eval(self, expr, await_promise=True):
        self.seq += 1
        payload = {
            "id": self.seq,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expr,
                "returnByValue": True,
                "awaitPromise": await_promise
            }
        }
        self.ws.send(json.dumps(payload))
        while True:
            raw = self.ws.recv()
            msg = json.loads(raw)
            if msg.get("id") == self.seq:
                res = msg.get("result", {})
                if "exceptionDetails" in res:
                    raise RuntimeError(f"CDP Exception: {res['exceptionDetails']}")
                return res.get("result", {}).get("value")

    def get_rect(self, sel):
        js = f"""
        (() => {{
            const el = document.querySelector({json.dumps(sel)});
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {{
                x: r.x, y: r.y, w: r.width, h: r.height,
                cx: r.x + r.width / 2,
                cy: r.y + r.height / 2,
                visible: r.width > 0 && r.height > 0
            }};
        }})()
        """
        return self.eval(js)

    def close(self):
        if self.ws:
            try:
                self.ws.close()
            except:
                pass

def tap_phys(x, y):
    adb_cmd(["shell", "input", "tap", str(int(x)), str(int(y))])

def to_phys(cx, cy):
    px = int(cx * DPR + SCREEN_X)
    py = int(cy * DPR + SCREEN_Y)
    return px, py

def get_wakefulness():
    out = adb_cmd(["shell", "dumpsys", "power"])
    for line in out.splitlines():
        if "mWakefulness=" in line:
            return line.strip()
    return "unknown"

def get_window_status():
    out = adb_cmd(["shell", "dumpsys", "window"])
    focus = ""
    lock = ""
    for line in out.splitlines():
        if "mCurrentFocus" in line:
            focus = line.strip()
        if "isKeyguardShowing" in line or "mDreamingLockscreen" in line or "mShowingLockscreen" in line:
            lock += line.strip() + "; "
    return focus, lock

def capture_screenshot(rel_path):
    # v2 fix: exec-out 不做行转换，PNG 二进制无损（v1 的 \r\n 替换会破坏 PNG）
    raw = adb_cmd_bytes(["exec-out", "screencap", "-p"])
    p1 = os.path.join(REPO_RUN, rel_path)
    os.makedirs(os.path.dirname(p1), exist_ok=True)
    with open(p1, "wb") as f:
        f.write(raw)
    p2 = os.path.join(ARCH_RUN, rel_path)
    os.makedirs(os.path.dirname(p2), exist_ok=True)
    with open(p2, "wb") as f:
        f.write(raw)
    return p1

def get_filtered_alarm():
    out = adb_cmd(["shell", "dumpsys", "alarm"])
    lines = []
    capture = False
    for line in out.splitlines():
        if PACKAGE in line:
            capture = True
            lines.append(line)
        elif capture:
            if line.startswith("    ") or line.startswith("      "):
                lines.append(line)
            else:
                capture = False
    return "\n".join(lines)

def check_alarm_scheduled(item_trigger_at, alarm_text):
    matched = []
    components = []
    lines = alarm_text.splitlines()
    for i, line in enumerate(lines):
        if "origWhen" in line:
            match = re.search(r"origWhen\s+(\d+)", line)
            if match:
                orig = int(match.group(1))
                if abs(orig - item_trigger_at) < 5000:
                    matched.append(line.strip())
                    context = " ".join(lines[max(0, i-2):min(len(lines), i+8)])
                    for comp in ["AlarmRingService", "AlarmTestReceiver", "TimedNotificationPublisher", "AlarmReceiver"]:
                        if comp in context and comp not in components:
                            components.append(comp)
    if matched:
        return True, f"entries={len(matched)}, comps={components}, sample={matched[0]}"
    return False, None

def check_audio_playing():
    out = adb_cmd(["shell", "dumpsys", "audio"])
    for line in out.splitlines():
        if APP_UID in line and ("player" in line or "AudioHardening" in line):
            if "event:started" in line or "state:started" in line:
                return True, line.strip()
    return False, None

def check_alarm_activity_active():
    # v2 fix: 只认当前焦点 / topResumed，不再被 dumpsys 里的历史 wm_* / Hist 行误触发
    focus, _ = get_window_status()
    if "AlarmActivity" in focus:
        return True, focus
    acts = adb_cmd(["shell", "dumpsys", "activity", "activities"])
    for line in acts.splitlines():
        if "topResumedActivity" in line and "AlarmActivity" in line:
            return True, line.strip()
    return False, focus

def ensure_app_awake_and_front(cdp):
    wake = get_wakefulness()
    if "Asleep" in wake or "mShowingDream=true" in adb_cmd(["shell", "dumpsys", "window"]):
        adb_cmd(["shell", "input", "keyevent", "KEYCODE_WAKEUP"])
        time.sleep(0.5)
        adb_cmd(["shell", "wm", "dismiss-keyguard"])
        time.sleep(0.5)

    for _ in range(3):
        is_alarm, info = check_alarm_activity_active()
        if is_alarm:
            log(f"ensure_app_awake_and_front: Dismissing AlarmActivity via KEYCODE_BACK ({info})...")
            adb_cmd(["shell", "input", "keyevent", "KEYCODE_BACK"])
            time.sleep(1)
        else:
            break

    focus, _ = get_window_status()
    if "MainActivity" not in focus:
        adb_cmd(["shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity"])
        time.sleep(1)

    try:
        cdp.eval('document.querySelector("#alertBanner")?.classList.remove("show")')
        cdp.eval('document.querySelector(\'[data-close="sheetItem"]\')?.click()')
        cdp.eval('document.querySelector(\'[data-close="sheetDetail"]\')?.click()')
        cdp.eval('document.querySelector(\'[data-close="sheetSetup"]\')?.click()')
        cdp.eval('document.activeElement?.blur()')
        cdp.eval('window.scrollTo(0, 0)')
    except Exception as e:
        log(f"Warning in cdp clean: {e}")
    time.sleep(0.8)

def create_critical_item_real_flow(cdp, title):
    ensure_app_awake_and_front(cdp)

    # 1. 物理点击 #fab
    is_open = False
    for attempt in range(3):
        fab_rect = cdp.get_rect("#fab")
        if not fab_rect:
            cdp.eval('window.scrollTo(0, 0)')
            time.sleep(0.5)
            fab_rect = cdp.get_rect("#fab")
        if not fab_rect:
            raise RuntimeError("FAB not found on page")
        fx, fy = to_phys(fab_rect["cx"], fab_rect["cy"])
        log(f"Tapping FAB at physical ({fx}, {fy}) (attempt {attempt+1}/3)...")
        tap_phys(fx, fy)
        time.sleep(1.0)
        is_open = cdp.eval('document.querySelector("#sheetItem").classList.contains("open")')
        if is_open:
            break
        log("SheetItem not open, retrying scroll and tap...")
        cdp.eval('window.scrollTo(0, 0)')
        time.sleep(0.5)

    if not is_open:
        raise RuntimeError("Failed to open #sheetItem after 3 attempts")

    # 2. 设置 #capText (允许 CDP 给表单填值)
    log(f"Setting #capText value: {title}")
    cdp.eval(f"""
        (() => {{
            const t = document.querySelector("#capText");
            if (t) {{
                t.value = {json.dumps(title)};
                t.dispatchEvent(new Event("input", {{ bubbles: true }}));
            }}
        }})()
    """)

    # 3. 设置 #capTrigger = 当前设备时间 + 3 分钟
    target_trigger_str = cdp.eval("""
        (() => {
            const now = new Date();
            const addMinutes = now.getSeconds() >= 40 ? 4 : 3;
            const target = new Date(now.getTime() + addMinutes * 60 * 1000);
            const pad = n => String(n).padStart(2, '0');
            return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`;
        })()
    """)
    log(f"Setting #capTrigger value: {target_trigger_str}")
    cdp.eval(f"""
        (() => {{
            const trig = document.querySelector("#capTrigger");
            if (trig) {{
                trig.value = {json.dumps(target_trigger_str)};
                trig.dispatchEvent(new Event("input", {{ bubbles: true }}));
                trig.dispatchEvent(new Event("change", {{ bubbles: true }}));
            }}
        }})()
    """)

    # 4. 收起软键盘
    cdp.eval("document.activeElement?.blur()")
    time.sleep(0.5)

    # 5. 物理点击「更多选项」
    hidden = cdp.eval('document.querySelector("#capAdvanced").hidden')
    if hidden:
        more_rect = cdp.get_rect("#btnCapMore")
        if not more_rect:
            raise RuntimeError("btnCapMore not found")
        mx, my = to_phys(more_rect["cx"], more_rect["cy"])
        log(f"Tapping '更多选项' at physical ({mx}, {my})")
        tap_phys(mx, my)
        time.sleep(0.5)

    # 6. 物理点击「🚨 关键」
    crit_rect = cdp.get_rect("#capPriority .crit")
    if not crit_rect:
        cdp.eval('document.querySelector("#capPriority").scrollIntoView({block: "center"})')
        time.sleep(0.3)
        crit_rect = cdp.get_rect("#capPriority .crit")
    if not crit_rect:
        raise RuntimeError("Critical chip not found")
    cx, cy = to_phys(crit_rect["cx"], crit_rect["cy"])
    log(f"Tapping '🚨 关键' at physical ({cx}, {cy})")
    tap_phys(cx, cy)
    time.sleep(0.4)

    is_crit = cdp.eval('document.querySelector("#capPriority .crit").classList.contains("on")')
    log(f"Critical chip selected: {is_crit}")

    # 7. 物理点击「安心交给系统」保存
    save_rect = cdp.get_rect("#btnSaveItem")
    if not save_rect:
        raise RuntimeError("btnSaveItem not found")
    sx, sy = to_phys(save_rect["cx"], save_rect["cy"])
    log(f"Tapping '安心交给系统' at physical ({sx}, {sy})")
    tap_phys(sx, sy)

    t0 = get_dev_time_ms()
    log(f"T0 recorded: {t0} ({get_dev_time_str(t0)})")

    time.sleep(0.5)
    item_info = cdp.eval(f"""
        (() => {{
            const it = window.__ATTENTION_INBOX__.state.items.find(x => x.title === {json.dumps(title)});
            if (!it) return null;
            return {{
                id: it.id,
                title: it.title,
                status: it.status,
                priority: it.priority,
                triggerAt: it.triggerAt,
                delivery_mode: it.delivery_mode,
                createdAt: it.createdAt
            }};
        }})()
    """)
    log(f"Created item info: {json.dumps(item_info, ensure_ascii=False)}")
    return t0, item_info

def find_ack_button_uiautomator():
    adb_cmd(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
    xml_str = adb_cmd(["shell", "cat", "/sdcard/window_dump.xml"])
    adb_cmd(["shell", "rm", "/sdcard/window_dump.xml"])
    try:
        root = ET.fromstring(xml_str)
        for node in root.iter("node"):
            text = node.attrib.get("text", "")
            res_id = node.attrib.get("resource-id", "")
            if "我知道了" in text or "btnAck" in res_id:
                bounds = node.attrib.get("bounds", "")
                m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
                if m:
                    l, t, r, b = map(int, m.groups())
                    return (l + r) // 2, (t + b) // 2
    except Exception as e:
        log(f"UIAutomator parse error: {e}")
    return None

def run_matrix_trial(config_label, trial_num):
    title = f"SWITCH-{config_label}-{trial_num}"
    log(f"==================================================")
    log(f"Starting Trial: Config {config_label} #{trial_num} (Title: {title})")
    log(f"==================================================")

    cdp = CDPClient()

    # 1. 真实界面新建关键事项
    t0, item = create_critical_item_real_flow(cdp, title)
    item_id = item["id"]
    trigger_at = item["triggerAt"]

    # 2. T0+3s 查 dumpsys alarm 确认排程存在
    time.sleep(2.5)
    alarm_3s = get_filtered_alarm()
    sched_3s, entry_3s = check_alarm_scheduled(trigger_at, alarm_3s)
    log(f"T0+3s Alarm scheduled: {sched_3s}, details: {entry_3s}")

    # 3. 按 HOME 退后台，等 5 秒，再锁屏
    log("Pressing HOME keyevent 3 to background app...")
    adb_cmd(["shell", "input", "keyevent", "3"])
    time.sleep(5)

    # 启动后台 logcat 持续录制 (纪律第 5 条)
    logcat_file_arch = os.path.join(ARCH_RUN, "logcat", f"{title}_full_logcat.txt")
    os.makedirs(os.path.dirname(logcat_file_arch), exist_ok=True)
    logcat_proc = subprocess.Popen([ADB, "-s", SERIAL, "logcat", "-v", "threadtime", "-b", "main,system,events"],
                                   stdout=open(logcat_file_arch, "w", encoding="utf-8"))
    log(f"Started background logcat logging to {logcat_file_arch} (PID={logcat_proc.pid})")

    # 按电源键锁屏
    log("Pressing POWER keyevent 26 to lock screen...")
    adb_cmd(["shell", "input", "keyevent", "26"])
    lock_time = get_dev_time_ms()
    time.sleep(1)

    focus, lock_info = get_window_status()
    wake = get_wakefulness()
    log(f"Lock confirmed: wake={wake}, lock_info={lock_info}")

    # 4. 观察窗口：从锁屏开始到 triggerAt+90s，每 5 秒只读观察 (纪律第 4 条)
    wait_deadline = trigger_at + 90000
    log(f"Entering read-only observation window until triggerAt+90s ({get_dev_time_str(wait_deadline)})...")

    obs_records = []
    delivered_time = None
    woke_spontaneous = False
    alarm_activity_time = None
    audio_playing_detected = False
    trial_summary = {}  # v2 fix: 提前初始化（v1 在定义前引用导致 NameError 中断）
    wake_tap_time = None  # v2 fix: 仅 else 分支定义会 NameError

    while get_dev_time_ms() < wait_deadline:
        now_ms = get_dev_time_ms()
        wake_curr = get_wakefulness()
        focus_curr, lock_curr = get_window_status()
        # v2 fix: 只保留 topResumed / mCurrentFocus 行，排除 wm_* 历史
        acts_curr = adb_cmd(["shell", "dumpsys", "activity", "activities"])
        act_lines = [l.strip() for l in acts_curr.splitlines() if "topResumed" in l]
        audio_playing, audio_line = check_audio_playing()

        shot_name = f"screenshots/{title}_obs_{now_ms}.png"
        capture_screenshot(shot_name)

        if "Awake" in wake_curr and not woke_spontaneous:
            woke_spontaneous = True
            log(f"*** Screen SPONTANEOUSLY woke up at {get_dev_time_str(now_ms)} (wake={wake_curr})! ***")

        if any("AlarmActivity" in l for l in act_lines) or "AlarmActivity" in focus_curr:
            if not alarm_activity_time:
                alarm_activity_time = now_ms
                log(f"*** AlarmActivity detected active at {get_dev_time_str(now_ms)}! focus={focus_curr} ***")
                # v2: AlarmActivity 真活跃才记投递时刻
                if not delivered_time:
                    delivered_time = now_ms

        if audio_playing and not audio_playing_detected:
            audio_playing_detected = True
            log(f"*** Audio playback detected at {get_dev_time_str(now_ms)}: {audio_line} ***")

        obs_records.append({
            "ts": now_ms,
            "wake": wake_curr,
            "focus": focus_curr,
            "act": act_lines,
            "audio": audio_line if audio_playing else None
        })

        time.sleep(5)

    log(f"Observation window ended at {get_dev_time_str()}.")

    # 5. 判定与恢复
    # 先做到点状态截图
    final_shot = f"screenshots/{title}_deadline_90s.png"
    capture_screenshot(final_shot)

    # 停止 logcat 录制
    logcat_proc.terminate()
    try:
        logcat_proc.wait(timeout=3)
    except:
        logcat_proc.kill()
    log(f"Stopped logcat recording. Log saved to {logcat_file_arch}")

    # 读取并脱敏 logcat 存入仓库
    logcat_file_repo = os.path.join(REPO_RUN, "logcat", f"{title}_logcat.txt")
    filter_and_redact_logcat(logcat_file_arch, logcat_file_repo)

    # 检查 logcat 中首次 AttentionAlarm deliver 的时刻
    logcat_ev = extract_logcat_evidence(logcat_file_arch)
    frozen_events = logcat_ev["frozen_lines"]
    deliver_msg = logcat_ev.get("deliver_line"); log(f"Logcat analysis: first deliver={deliver_msg}, frozen_events={frozen_events}")

    # v2: 若窗口内 AlarmActivity 检测漏报，但 logcat 有 deliver 行，则从日志行解析投递时刻
    logcat_deliver_ms = None
    if deliver_msg:
        m = re.search(r"(\d\d-\d\d \d\d:\d\d:\d\d)\.(\d\d\d)", deliver_msg)
        if m:
            from datetime import datetime as _dt
            dev_now = _dt.fromtimestamp(get_dev_time_ms() / 1000.0)
            try:
                parsed = _dt.strptime(f"{dev_now.year}-{m.group(1)}", "%Y-%m-%d %H:%M:%S.%f")
                logcat_deliver_ms = int(parsed.timestamp() * 1000)
                if logcat_deliver_ms > get_dev_time_ms():  # 跨年保护
                    logcat_deliver_ms = None
            except Exception:
                pass
        if delivered_time is None and logcat_deliver_ms is not None:
            delivered_time = logcat_deliver_ms
            log(f"*** Deliver recovered from logcat at {get_dev_time_str(delivered_time)} (AlarmActivity detection missed it) ***")

    trial_summary["logcatEvidence"] = logcat_ev

    was_delivered_in_window = (delivered_time is not None) and (delivered_time <= trigger_at + 90000)

    post_wake_deliver_time = None
    if was_delivered_in_window:
        log(f"Trial SUCCESS in observation window: delivered at {get_dev_time_str(delivered_time)}")
        # 真实点击「我知道了」
        log("Searching for '我知道了' button to acknowledge...")
        ack_coords = find_ack_button_uiautomator()
        if not ack_coords:
            ack_coords = (540, 1469)
        log(f"Tapping '我知道了' at {ack_coords}")
        tap_phys(ack_coords[0], ack_coords[1])
        time.sleep(2)
    else:
        log(f"Trial NOT delivered within window (triggerAt+90s). Waking up device manually to test post-wake delivery...")
        wake_tap_time = get_dev_time_ms()
        adb_cmd(["shell", "input", "keyevent", "KEYCODE_WAKEUP"])
        time.sleep(0.5)
        adb_cmd(["shell", "wm", "dismiss-keyguard"])
        time.sleep(1)

        # 检查唤醒后多久投递
        for _ in range(15):
            time.sleep(1)
            is_active, act_line = check_alarm_activity_active()
            if is_active:
                post_wake_deliver_time = get_dev_time_ms()
                log(f"Post-wake delivered at {get_dev_time_str(post_wake_deliver_time)} (delay={post_wake_deliver_time - wake_tap_time}ms after wakeup)!")
                ack_coords = find_ack_button_uiautomator()
                if ack_coords:
                    tap_phys(ack_coords[0], ack_coords[1])
                    time.sleep(1)
                break

    # 6. 删除测试事项 (纪律第 6 条)
    log(f"Deleting test item {item_id} via API...")
    cdp.close()
    ensure_app_awake_and_front(CDPClient())
    cdp2 = CDPClient()
    cdp2.eval(f"window.__ATTENTION_INBOX__.deleteItem({json.dumps(item_id)})")
    time.sleep(1)
    alarm_after = get_filtered_alarm()
    sched_after, _ = check_alarm_scheduled(trigger_at, alarm_after)
    log(f"Post-trial alarm scheduled check for {item_id}: {sched_after} (should be False)")
    cdp2.close()

    trial_summary.update({
        "title": title,
        "config": config_label,
        "trial": trial_num,
        "itemId": item_id,
        "t0": t0,
        "t0_str": get_dev_time_str(t0),
        "triggerAt": trigger_at,
        "triggerAt_str": get_dev_time_str(trigger_at),
        "lockTime": lock_time,
        "lockTime_str": get_dev_time_str(lock_time),
        "alarmScheduledAtT3s": sched_3s,
        "deliveredTime": delivered_time,
        "deliveredTime_str": get_dev_time_str(delivered_time) if delivered_time else None,
        "deliveryDelayMs": (delivered_time - trigger_at) if delivered_time else None,
        "wokeSpontaneous": woke_spontaneous,
        "alarmActivityPresent": alarm_activity_time is not None,
        "alarmActivityTime": alarm_activity_time,
        "audioPlaying": audio_playing_detected,
        "postWakeDeliverTime": post_wake_deliver_time,
        "postWakeDelayMs": (post_wake_deliver_time - wake_tap_time) if post_wake_deliver_time else None,
        "frozenEvents": frozen_events,
        "result": "PASS" if (was_delivered_in_window and abs((delivered_time or 0) - trigger_at) <= 10000) else "FAIL"
    })

    summary_file = os.path.join(REPO_RUN, "dom_and_state", f"{title}_summary.json")
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump(trial_summary, f, ensure_ascii=False, indent=2)
    with open(os.path.join(ARCH_RUN, "dom_and_state", f"{title}_summary.json"), "w", encoding="utf-8") as f:
        json.dump(trial_summary, f, ensure_ascii=False, indent=2)

    log(f"Trial Summary: {json.dumps(trial_summary, ensure_ascii=False, indent=2)}")
    log(f"==================================================")
    log(f"Finished Trial: {title} Result={trial_summary['result']}")
    log(f"==================================================")
    return trial_summary

def extract_logcat_evidence(logcat_path):
    deliver_line = None
    deliver_line_no = None
    frozen_lines = []
    unfrozen_lines = []
    wake_idle_lines = []
    
    with open(logcat_path, 'r', encoding='utf-8', errors='ignore') as f:
        for idx, line in enumerate(f, 1):
            if ('AttentionAlarm: deliver' in line or 'AttentionAlarm deliver' in line
                    or 'AlarmRingService: deliver' in line) and not deliver_line:
                deliver_line = line.strip()
                deliver_line_no = idx
            if 'am_app_frozen' in line and (PACKAGE in line or APP_UID in line):
                frozen_lines.append((idx, line.strip()))
            if 'am_app_unfrozen' in line and (PACKAGE in line or APP_UID in line):
                unfrozen_lines.append((idx, line.strip()))
            if 'device_idle_wake_from_idle' in line and (PACKAGE in line or 'ACTION_TEST_ALARM' in line or 'AlarmRingService' in line):
                wake_idle_lines.append((idx, line.strip()))
                
    return {
        'deliver_line': deliver_line,
        'deliver_line_no': deliver_line_no,
        'frozen_lines': frozen_lines,
        'unfrozen_lines': unfrozen_lines,
        'wake_idle_lines': wake_idle_lines
    }


def filter_and_redact_logcat(src, dst):
    filtered = []
    with open(src, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if any(k in line for k in [PACKAGE, APP_UID, "AlarmManager", "AlarmActivity", "AlarmRing", "am_app_frozen", "am_app_unfrozen", "device_idle_wake_from_idle", "sysui_fullscreen_notification"]):
                # 脱敏：屏蔽其他应用 ID、mKeys
                line_redacted = re.sub(r"mKey=[^\s]+", "mKey=REDACTED", line)
                filtered.append(line_redacted)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "w", encoding="utf-8") as f:
        f.writelines(filtered)


if __name__ == '__main__':
    cfg = sys.argv[1] if len(sys.argv) > 1 else 'A'
    trial = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    run_matrix_trial(cfg, trial)
