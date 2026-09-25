#!/usr/bin/env python3
"""受控复测脚本：vivo V2238A 锁屏关键事项全屏闹钟验证 (F1 专项)
遵守所有硬性纪律：
- 事项走真实保存流程（表单填值后，展开更多选项、选关键、安心交给系统均物理点击）；
- 严禁调用禁止函数；
- 每一次尝试均写入 run.log，时间戳用设备时间；
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
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
RUN_DIR = os.path.abspath(os.path.dirname(__file__))
ARCHIVE_DIR = os.path.expanduser("~/Developer/reminder-archive/verification-runs/20260925T135000Z-vivo-f1-controlled")
TSV_PATH = "/Users/qlyf/Developer/reminder/docs/reviews/verification-runs/ARCHIVED-RAW-2026-09-25.tsv"

LOG_PATH = os.path.join(RUN_DIR, "run.log")

CDP_PORT = 53420
DPR = 3.0
SCREEN_X = 0
SCREEN_Y = 120  # WebView 状态栏偏移

def adb_cmd(args):
    cmd = [ADB, "-s", SERIAL] + args
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return res.stdout.strip()

def adb_cmd_bytes(args):
    cmd = [ADB, "-s", SERIAL] + args
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return res.stdout

def get_device_time_ms():
    out = adb_cmd(["shell", "date", "+%s%3N"])
    try:
        return int(out)
    except:
        return int(time.time() * 1000)

def get_device_time_str(ms=None):
    if ms is None:
        ms = get_device_time_ms()
    dt = datetime.fromtimestamp(ms / 1000.0)
    return dt.strftime("%Y-%m-%d %H:%M:%S")

def log(msg):
    dev_ms = get_device_time_ms()
    dev_str = get_device_time_str(dev_ms)
    line = f"[{dev_str}] [{dev_ms}] {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
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
    # 保存两份：工作区（按gitignore）和归档区
    raw = adb_cmd_bytes(["shell", "screencap", "-p"])
    raw = raw.replace(b"\r\n", b"\n")
    p1 = os.path.join(RUN_DIR, rel_path)
    os.makedirs(os.path.dirname(p1), exist_ok=True)
    with open(p1, "wb") as f:
        f.write(raw)
    p2 = os.path.join(ARCHIVE_DIR, rel_path)
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

def delete_item_via_api(cdp, item_id):
    cdp.eval(f"window.__ATTENTION_INBOX__.deleteItem({json.dumps(item_id)})")
    time.sleep(1)

def check_alarm_activity_active():
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

    # 若顶层是 AlarmActivity，先按 BACK 关闭
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

    # 隐藏任何未关闭的 banner、浮层与软键盘
    try:
        cdp.eval('document.querySelector("#alertBanner")?.classList.remove("show")')
        cdp.eval('document.querySelector(\'[data-close="sheetItem"]\')?.click()')
        cdp.eval('document.querySelector(\'[data-close="sheetDetail"]\')?.click()')
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

    # 3. 设置 #capText (允许 CDP 给表单填值)
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

    # 4. 计算当前设备时间 + 3 分钟
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

    # 5. blur 当前焦点，收起软键盘
    cdp.eval("document.activeElement?.blur()")
    time.sleep(0.5)

    # 6. 物理点击「更多选项」
    hidden = cdp.eval('document.querySelector("#capAdvanced").hidden')
    if hidden:
        more_rect = cdp.get_rect("#btnCapMore")
        if not more_rect:
            raise RuntimeError("btnCapMore not found")
        mx, my = to_phys(more_rect["cx"], more_rect["cy"])
        log(f"Tapping '更多选项' at physical ({mx}, {my})")
        tap_phys(mx, my)
        time.sleep(0.5)

    # 7. 物理点击「🚨 关键」
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

    # 8. 物理点击「安心交给系统」保存
    save_rect = cdp.get_rect("#btnSaveItem")
    if not save_rect:
        raise RuntimeError("btnSaveItem not found")
    sx, sy = to_phys(save_rect["cx"], save_rect["cy"])
    log(f"Tapping '安心交给系统' at physical ({sx}, {sy})")
    tap_phys(sx, sy)

    # 记下保存时刻 T0
    t0 = get_device_time_ms()
    log(f"T0 recorded: {t0} ({get_device_time_str(t0)})")

    time.sleep(0.5)
    # 只读查询刚刚保存的事项信息
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

def check_alarm_scheduled(item_trigger_at, alarm_text):
    # 查找是否有 origWhen 接近 item_trigger_at 的条目
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
                    # 查找周围几行的组件名
                    context = " ".join(lines[max(0, i-2):min(len(lines), i+8)])
                    for comp in ["AlarmRingService", "AlarmTestReceiver", "TimedNotificationPublisher", "AlarmReceiver"]:
                        if comp in context and comp not in components:
                            components.append(comp)
    if matched:
        return True, f"entries={len(matched)}, comps={components}, sample={matched[0]}"
    return False, None

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
                # bounds="[left,top][right,bottom]"
                m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
                if m:
                    l, t, r, b = map(int, m.groups())
                    return (l + r) // 2, (t + b) // 2
    except Exception as e:
        log(f"UIAutomator parse error: {e}")
    return None

def run_s1_iteration(cdp, run_index):
    title = f"UIRECHECK-F1-S1-{run_index}"
    log(f"========== Starting S1 Run {run_index}: title={title} ==========")
    t0, item = create_critical_item_real_flow(cdp, title)
    item_id = item["id"]
    trigger_at = item["triggerAt"]

    timeline = {
        "scenario": f"S1-{run_index}",
        "title": title,
        "itemId": item_id,
        "t0": t0,
        "triggerAt": trigger_at,
        "alarm_t0_1s": False,
        "alarm_t0_3s": False,
        "alarm_t0_30s": False,
        "lockTime": None,
        "topFocusAtTrigger": None,
        "topActivityAtTrigger": None,
        "wakefulnessAtTrigger": None,
        "alarmActivityPresent": False,
        "finalStatus": None,
        "result": None
    }

    # T0+1s
    sleep_until(t0 + 1000)
    alarm_1s = get_filtered_alarm()
    sched_1s, entry_1s = check_alarm_scheduled(trigger_at, alarm_1s)
    timeline["alarm_t0_1s"] = sched_1s
    log(f"S1-{run_index} T0+1s alarm scheduled: {sched_1s}, entry: {entry_1s}")

    # T0+3s
    sleep_until(t0 + 3000)
    alarm_3s = get_filtered_alarm()
    sched_3s, entry_3s = check_alarm_scheduled(trigger_at, alarm_3s)
    timeline["alarm_t0_3s"] = sched_3s
    log(f"S1-{run_index} T0+3s alarm scheduled: {sched_3s}, entry: {entry_3s}")

    # T0+5s 锁屏
    sleep_until(t0 + 5000)
    log(f"S1-{run_index} Locking screen with KEYCODE_POWER...")
    adb_cmd(["shell", "input", "keyevent", "26"])
    lock_time = get_device_time_ms()
    timeline["lockTime"] = lock_time
    time.sleep(1)
    focus, lock_info = get_window_status()
    wake = get_wakefulness()
    log(f"S1-{run_index} Lock screen confirmed: {lock_info}, wake: {wake}")

    # T0+30s 锁屏后抓 dumpsys alarm
    sleep_until(t0 + 30000)
    alarm_30s = get_filtered_alarm()
    sched_30s, entry_30s = check_alarm_scheduled(trigger_at, alarm_30s)
    timeline["alarm_t0_30s"] = sched_30s
    log(f"S1-{run_index} T0+30s alarm scheduled: {sched_30s}, entry: {entry_30s}")

    # 等待至 triggerAt+10s
    wait_target = trigger_at + 10000
    rem = (wait_target - get_device_time_ms()) / 1000.0
    log(f"S1-{run_index} Sleeping {rem:.1f}s until triggerAt+10s ({get_device_time_str(wait_target)})...")
    sleep_until(wait_target)

    # 到点首次快照 (triggerAt+10s)
    focus_10s, lock_10s = get_window_status()
    top_acts_10s = adb_cmd(["shell", "dumpsys", "activity", "activities"])
    act_lines_10s = [l.strip() for l in top_acts_10s.splitlines() if "topResumed" in l or "AlarmActivity" in l]
    wake_10s = get_wakefulness()
    log(f"S1-{run_index} At trigger+10s snapshot: focus={focus_10s}, wake={wake_10s}, topActivities={act_lines_10s}")
    shot_10s = f"screenshots/S1_{run_index}_at_10s.png"
    capture_screenshot(shot_10s)

    # 持续检测直到 triggerAt+35s 或 AlarmActivity 出现
    alarm_present = "AlarmActivity" in focus_10s or any("AlarmActivity" in l for l in act_lines_10s)
    focus_at = focus_10s
    act_lines = act_lines_10s
    wake_at = wake_10s

    poll_until = trigger_at + 35000
    while not alarm_present and get_device_time_ms() < poll_until:
        time.sleep(2)
        focus_curr, lock_curr = get_window_status()
        acts_curr = adb_cmd(["shell", "dumpsys", "activity", "activities"])
        lines_curr = [l.strip() for l in acts_curr.splitlines() if "topResumed" in l or "AlarmActivity" in l]
        wake_curr = get_wakefulness()
        if "AlarmActivity" in focus_curr or any("AlarmActivity" in l for l in lines_curr):
            alarm_present = True
            focus_at = focus_curr
            act_lines = lines_curr
            wake_at = wake_curr
            log(f"S1-{run_index} AlarmActivity detected at {get_device_time_str()}! focus={focus_at}, wake={wake_at}")
            break

    timeline["topFocusAtTrigger"] = focus_at
    timeline["topActivityAtTrigger"] = "; ".join(act_lines)
    timeline["wakefulnessAtTrigger"] = wake_at
    timeline["alarmActivityPresent"] = alarm_present

    shot_path = f"screenshots/S1_{run_index}_alarm_triggered.png"
    capture_screenshot(shot_path)
    log(f"S1-{run_index} Saved screenshot: {shot_path}")

    # 抓取 logcat 前后 60s
    logcat_out = adb_cmd(["shell", "logcat", "-d", "-v", "time"])
    logcat_filtered = []
    for line in logcat_out.splitlines():
        if any(kw in line for kw in ["space.alliswell.inbox", "AlarmActivity", "AlarmRing", "fullScreen", "FullScreenIntent", "BAL", "Background activity start", "ActivityTaskManager"]):
            logcat_filtered.append(line)
    logcat_path = os.path.join(RUN_DIR, f"logcat/S1_{run_index}_logcat.txt")
    with open(logcat_path, "w", encoding="utf-8") as f:
        f.write("\n".join(logcat_filtered[-500:]))
    log(f"S1-{run_index} Saved filtered logcat to: {logcat_path}")

    if alarm_present:
        log(f"S1-{run_index} AlarmActivity detected! Looking for '我知道了' button...")
        ack_coords = find_ack_button_uiautomator()
        if not ack_coords:
            ack_coords = (540, 1469)
        log(f"S1-{run_index} Tapping '我知道了' at {ack_coords}")
        tap_phys(ack_coords[0], ack_coords[1])
        time.sleep(2)

        # 解锁回主应用核验状态
        ensure_app_awake_and_front(cdp)
        status_after = cdp.eval(f"""
            (() => {{
                const it = window.__ATTENTION_INBOX__.state.items.find(x => x.id === "{item_id}");
                return it ? it.status : null;
            }})()
        """)
        log(f"S1-{run_index} Item status after ack: {status_after}")
        timeline["finalStatus"] = status_after
        if status_after == "acknowledged":
            timeline["result"] = "PASS"
        else:
            timeline["result"] = "WARN"
    else:
        log(f"S1-{run_index} AlarmActivity NOT present after 35s! Direct evidence captured.")
        ensure_app_awake_and_front(cdp)
        status_after = cdp.eval(f"""
            (() => {{
                const it = window.__ATTENTION_INBOX__.state.items.find(x => x.id === "{item_id}");
                return it ? it.status : null;
            }})()
        """)
        timeline["finalStatus"] = status_after
        if not sched_30s:
            timeline["result"] = "FAIL"
        else:
            timeline["result"] = "WARN"

    # 清理测试事项
    log(f"S1-{run_index} Cleaning up test item {item_id}...")
    delete_item_via_api(cdp, item_id)
    time.sleep(1)

    log(f"========== Finished S1 Run {run_index}: Result={timeline['result']} ==========")
    return timeline

def run_s2_iteration(cdp, run_index):
    title = f"UIRECHECK-F1-S2-{run_index}"
    log(f"========== Starting S2 Run {run_index}: title={title} ==========")
    t0, item = create_critical_item_real_flow(cdp, title)
    item_id = item["id"]
    trigger_at = item["triggerAt"]

    timeline = {
        "scenario": f"S2-{run_index}",
        "title": title,
        "itemId": item_id,
        "t0": t0,
        "triggerAt": trigger_at,
        "alarm_t0_1s": "N/A",
        "alarm_t0_3s": "N/A",
        "alarm_t0_5s": False,
        "alarm_t0_30s": False,
        "lockTime": None,
        "topFocusAtTrigger": None,
        "topActivityAtTrigger": None,
        "wakefulnessAtTrigger": None,
        "alarmActivityPresent": False,
        "finalStatus": None,
        "result": None
    }

    # S2: T0 之后 1 秒内立刻按电源键锁屏
    log(f"S2-{run_index} Immediately locking screen within 1s...")
    adb_cmd(["shell", "input", "keyevent", "26"])
    lock_time = get_device_time_ms()
    timeline["lockTime"] = lock_time
    time.sleep(1)
    focus, lock_info = get_window_status()
    wake = get_wakefulness()
    log(f"S2-{run_index} Immediate lock screen confirmed: {lock_info}, wake: {wake}")

    # T0+5s 锁屏后抓 dumpsys alarm
    sleep_until(t0 + 5000)
    alarm_5s = get_filtered_alarm()
    sched_5s, entry_5s = check_alarm_scheduled(trigger_at, alarm_5s)
    timeline["alarm_t0_5s"] = sched_5s
    log(f"S2-{run_index} T0+5s post-lock alarm scheduled: {sched_5s}, entry: {entry_5s}")

    # T0+30s 锁屏后抓 dumpsys alarm
    sleep_until(t0 + 30000)
    alarm_30s = get_filtered_alarm()
    sched_30s, entry_30s = check_alarm_scheduled(trigger_at, alarm_30s)
    timeline["alarm_t0_30s"] = sched_30s
    log(f"S2-{run_index} T0+30s post-lock alarm scheduled: {sched_30s}, entry: {entry_30s}")

    # 等待至 triggerAt+10s
    wait_target = trigger_at + 10000
    rem = (wait_target - get_device_time_ms()) / 1000.0
    log(f"S2-{run_index} Sleeping {rem:.1f}s until triggerAt+10s ({get_device_time_str(wait_target)})...")
    sleep_until(wait_target)

    # 到点首次快照 (triggerAt+10s)
    focus_10s, lock_10s = get_window_status()
    wake_10s = get_wakefulness()
    is_active_10s, act_info_10s = check_alarm_activity_active()
    log(f"S2-{run_index} At trigger+10s snapshot: active={is_active_10s}, focus={focus_10s}, wake={wake_10s}, act={act_info_10s}")
    shot_10s = f"screenshots/S2_{run_index}_at_10s.png"
    capture_screenshot(shot_10s)

    # 持续检测直到 triggerAt+35s 或 AlarmActivity 真正处于激活/顶层
    alarm_present = is_active_10s
    focus_at = focus_10s
    act_lines = [act_info_10s] if act_info_10s else []
    wake_at = wake_10s

    poll_until = trigger_at + 35000
    while not alarm_present and get_device_time_ms() < poll_until:
        time.sleep(2)
        is_active_curr, act_info_curr = check_alarm_activity_active()
        focus_curr, lock_curr = get_window_status()
        wake_curr = get_wakefulness()
        if is_active_curr:
            alarm_present = True
            focus_at = focus_curr
            act_lines = [act_info_curr]
            wake_at = wake_curr
            log(f"S2-{run_index} AlarmActivity detected active at {get_device_time_str()}! focus={focus_at}, wake={wake_at}, act={act_info_curr}")
            break

    timeline["topFocusAtTrigger"] = focus_at
    timeline["topActivityAtTrigger"] = "; ".join(act_lines)
    timeline["wakefulnessAtTrigger"] = wake_at
    timeline["alarmActivityPresent"] = alarm_present

    shot_path = f"screenshots/S2_{run_index}_alarm_triggered.png"
    capture_screenshot(shot_path)
    log(f"S2-{run_index} Saved screenshot: {shot_path}")

    # 抓取 logcat 前后 60s
    logcat_out = adb_cmd(["shell", "logcat", "-d", "-v", "time"])
    logcat_filtered = []
    for line in logcat_out.splitlines():
        if any(kw in line for kw in ["space.alliswell.inbox", "AlarmActivity", "AlarmRing", "fullScreen", "FullScreenIntent", "BAL", "Background activity start", "ActivityTaskManager"]):
            logcat_filtered.append(line)
    logcat_path = os.path.join(RUN_DIR, f"logcat/S2_{run_index}_logcat.txt")
    with open(logcat_path, "w", encoding="utf-8") as f:
        f.write("\n".join(logcat_filtered[-500:]))
    log(f"S2-{run_index} Saved filtered logcat to: {logcat_path}")

    if alarm_present:
        log(f"S2-{run_index} AlarmActivity detected! Looking for '我知道了' button...")
        adb_cmd(["shell", "input", "keyevent", "KEYCODE_WAKEUP"])
        time.sleep(0.3)
        adb_cmd(["shell", "wm", "dismiss-keyguard"])
        time.sleep(0.3)
        ack_coords = find_ack_button_uiautomator()
        if not ack_coords:
            ack_coords = (540, 1469)
        log(f"S2-{run_index} Tapping '我知道了' at {ack_coords}")
        tap_phys(ack_coords[0], ack_coords[1])
        time.sleep(2)

        # 若 AlarmActivity 仍在前台，按 BACK 关掉
        is_still_alarm, _ = check_alarm_activity_active()
        if is_still_alarm:
            adb_cmd(["shell", "input", "keyevent", "KEYCODE_BACK"])
            time.sleep(1)

        ensure_app_awake_and_front(cdp)
        status_after = cdp.eval(f"""
            (() => {{
                const it = window.__ATTENTION_INBOX__.state.items.find(x => x.id === "{item_id}");
                return it ? it.status : null;
            }})()
        """)
        log(f"S2-{run_index} Item status after ack: {status_after}")
        timeline["finalStatus"] = status_after
        if status_after == "acknowledged":
            timeline["result"] = "PASS"
        else:
            timeline["result"] = "WARN"
    else:
        log(f"S2-{run_index} AlarmActivity NOT present after 35s! Direct evidence captured.")
        ensure_app_awake_and_front(cdp)
        status_after = cdp.eval(f"""
            (() => {{
                const it = window.__ATTENTION_INBOX__.state.items.find(x => x.id === "{item_id}");
                return it ? it.status : null;
            }})()
        """)
        timeline["finalStatus"] = status_after
        if not sched_30s:
            timeline["result"] = "FAIL"
        else:
            timeline["result"] = "WARN"

    log(f"S2-{run_index} Cleaning up test item {item_id}...")
    delete_item_via_api(cdp, item_id)
    time.sleep(1)

    log(f"========== Finished S2 Run {run_index}: Result={timeline['result']} ==========")
    return timeline

def run_s3_iteration(cdp):
    title = "UIRECHECK-F1-S3-1"
    log(f"========== Starting S3 (Foreground Control): title={title} ==========")
    t0, item = create_critical_item_real_flow(cdp, title)
    item_id = item["id"]
    trigger_at = item["triggerAt"]

    timeline = {
        "scenario": "S3-1",
        "title": title,
        "itemId": item_id,
        "t0": t0,
        "triggerAt": trigger_at,
        "alarm_t0_1s": "N/A",
        "alarm_t0_3s": "N/A",
        "lockTime": "Not Locked",
        "topFocusAtTrigger": None,
        "topActivityAtTrigger": None,
        "wakefulnessAtTrigger": None,
        "inAppAlertPanelPresent": False,
        "alarmActivityPresent": False,
        "finalStatus": None,
        "result": None
    }

    # S3: 不锁屏，停在首页等待至 triggerAt+10s
    wait_target = trigger_at + 10000
    rem = (wait_target - get_device_time_ms()) / 1000.0
    log(f"S3-1 Sleeping {rem:.1f}s until triggerAt+10s ({get_device_time_str(wait_target)}), staying foreground...")
    sleep_until(wait_target)

    focus_at, lock_at = get_window_status()
    top_acts = adb_cmd(["shell", "dumpsys", "activity", "activities"])
    act_lines = [l.strip() for l in top_acts.splitlines() if "topResumed" in l or "AlarmActivity" in l]
    wake_at = get_wakefulness()

    timeline["topFocusAtTrigger"] = focus_at
    timeline["topActivityAtTrigger"] = "; ".join(act_lines)
    timeline["wakefulnessAtTrigger"] = wake_at

    shot_path = "screenshots/S3_1_foreground_triggered.png"
    capture_screenshot(shot_path)
    log(f"S3-1 Saved screenshot: {shot_path}")

    # 检查是否出现应用内「闹钟待处理」面板或全屏 AlarmActivity
    is_alarm_active, _ = check_alarm_activity_active()
    in_app_banner = cdp.eval('(() => { const b = document.querySelector("#alertBanner"); return b && b.classList.contains("show"); })()')
    in_app_active_panel = cdp.eval('(() => { const p = document.querySelector("#activeAlarmPanel"); return p && !p.hidden; })()')
    in_app_panel = bool(in_app_banner or in_app_active_panel)

    timeline["alarmActivityPresent"] = is_alarm_active
    timeline["inAppAlertPanelPresent"] = in_app_panel

    log(f"S3-1 At trigger+10s: AlarmActivity={is_alarm_active}, inAppAlertPanel={in_app_panel} (banner={in_app_banner}, activePanel={in_app_active_panel}), focus={focus_at}")

    # 查事项状态
    status_after = cdp.eval(f"""
        (() => {{
            const it = window.__ATTENTION_INBOX__.state.items.find(x => x.id === "{item_id}");
            return it ? it.status : null;
        }})()
    """)
    timeline["finalStatus"] = status_after
    timeline["result"] = "PASS" if (in_app_panel or is_alarm_active) else "WARN"

    log(f"S3-1 Cleaning up test item {item_id}...")
    delete_item_via_api(cdp, item_id)
    time.sleep(1)

    log(f"========== Finished S3-1: Result={timeline['result']} ==========")
    return timeline

def sleep_until(target_ms):
    while True:
        now_ms = get_device_time_ms()
        diff = (target_ms - now_ms) / 1000.0
        if diff <= 0:
            break
        if diff > 1.0:
            time.sleep(min(diff - 0.5, 5.0))
        else:
            time.sleep(0.1)

def sha256_file(filepath):
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()

def main():
    log("=================================================================")
    log("Starting Controlled F1 Recheck on vivo V2238A")
    log("Device: 10ACBF2D3D000RS, Package: space.alliswell.inbox")
    log("=================================================================")

    cdp = CDPClient()
    ensure_app_awake_and_front(cdp)

    results = []

    summary_path = os.path.join(RUN_DIR, "results_summary.json")
    if os.path.exists(summary_path):
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                results = json.load(f)
        except:
            results = []

    valid_scenarios = {"S1-1", "S1-2", "S2-1"}
    results = [r for r in results if r.get("scenario") in valid_scenarios]

    def execute_safely(fn, *args):
        try:
            # 前置清理任何可能的测试残留
            items_curr = cdp.eval("window.__ATTENTION_INBOX__.state.items")
            for it in items_curr:
                if "UIRECHECK" in it.get("title", ""):
                    log(f"Pre-run cleaning: {it['id']}")
                    delete_item_via_api(cdp, it['id'])
            time.sleep(1)
            return fn(cdp, *args)
        except Exception as e:
            log(f"Exception during {fn.__name__} {args}: {e}")
            ensure_app_awake_and_front(cdp)
            return {"scenario": str(args), "error": str(e), "result": "FAIL"}

    try:
        log("Temporarily locking rotation to portrait...")
        adb_cmd(["shell", "settings", "put", "system", "accelerometer_rotation", "0"])
        adb_cmd(["shell", "settings", "put", "system", "user_rotation", "0"])

        # S2-2
        log("Starting S2-2 (Immediately lock screen)...")
        res_s2_2 = execute_safely(run_s2_iteration, 2)
        results.append(res_s2_2)
        log("Waiting 30s before S3-1...")
        time.sleep(30)

        # S3-1
        log("Starting S3-1 (Foreground control)...")
        res_s3_1 = execute_safely(run_s3_iteration)
        results.append(res_s3_1)

    finally:
        # 清理与最终校验
        log("========== Final Verification and Cleanup ==========")
        ensure_app_awake_and_front(cdp)

        # 检查是否还有 UIRECHECK 测试事项残留
        final_items = cdp.eval("window.__ATTENTION_INBOX__.state.items")
        dirty = [it for it in final_items if "UIRECHECK" in it.get("title", "")]
        for it in dirty:
            log(f"Cleaning residual test item: {it['id']} {it['title']}")
            delete_item_via_api(cdp, it['id'])
        time.sleep(1)

        final_items = cdp.eval("window.__ATTENTION_INBOX__.state.items")
        log(f"Final items count: {len(final_items)}")

        # 恢复系统旋转设置并落盘
        log("Restoring system rotation settings...")
        adb_cmd(["shell", "settings", "put", "system", "accelerometer_rotation", "1"])
        adb_cmd(["shell", "settings", "put", "system", "user_rotation", "0"])
        time.sleep(0.5)
        rot_after = adb_cmd(["shell", "settings", "get", "system", "accelerometer_rotation"])
        user_rot_after = adb_cmd(["shell", "settings", "get", "system", "user_rotation"])
        restore_txt = f"accelerometer_rotation={rot_after}\nuser_rotation={user_rot_after}\n"
        with open(os.path.join(RUN_DIR, "dumpsys/settings_rotation_restored.txt"), "w", encoding="utf-8") as f:
            f.write(restore_txt)
        log(f"Rotation settings restored: {restore_txt.strip()}")

        # 抓取清理后的 dumpsys alarm 和 notification
        clean_alarm = get_filtered_alarm()
        with open(os.path.join(RUN_DIR, "dumpsys/final_clean_alarm.txt"), "w", encoding="utf-8") as f:
            f.write(clean_alarm)
        clean_notif = adb_cmd(["shell", "dumpsys", "notification", "--noredact"])
        clean_notif_filtered = "\n".join([l for l in clean_notif.splitlines() if PACKAGE in l])
        with open(os.path.join(RUN_DIR, "dumpsys/final_clean_notification.txt"), "w", encoding="utf-8") as f:
            f.write(clean_notif_filtered)

        # 保存结果概要
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        log(f"Results summary written to: {summary_path}")

        cdp.close()

    log("=================================================================")
    log("Controlled F1 Recheck Completed Successfully!")
    log("=================================================================")

if __name__ == "__main__":
    main()
