#!/usr/bin/env python3
"""只读：导航到三个开关页，截图 + uiautomator dump 留证。绝不点击开关本体。"""
import os, time, json, subprocess, re

for k in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy'):
    os.environ.pop(k, None)

SERIAL = "10ACBF2D3D000RS"
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
RUN_ID = "20260928T235800Z-vivo-view-recheck-rerun"
REPO_RUN = os.path.join("/Users/qlyf/Developer/reminder", "docs/reviews/verification-runs", RUN_ID)
ARCH_RUN = os.path.expanduser(f"~/Developer/reminder-archive/verification-runs/{RUN_ID}")
LOG_PATH = os.path.join(REPO_RUN, "run.log")

def adb(args, timeout=20):
    return subprocess.run([ADB, "-s", SERIAL] + args, capture_output=True, text=True, timeout=timeout).stdout.strip()

def log(msg):
    ms = adb(["shell", "date", "+%s%3N"])
    from datetime import datetime
    try: ms_i = int(ms)
    except: ms_i = int(time.time()*1000)
    line = f"[{datetime.fromtimestamp(ms_i/1000.0).strftime('%Y-%m-%d %H:%M:%S')}] [{ms_i}] [BASELINE-SWITCHES] {msg}"
    print(line, flush=True)
    for p in (LOG_PATH, os.path.join(ARCH_RUN, "run.log")):
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")

def shot_and_dump(tag):
    for base in (REPO_RUN, ARCH_RUN):
        for d in ("screenshots", "screenshots-sanitized", "dumpsys"):
            os.makedirs(os.path.join(base, d), exist_ok=True)
    raw = subprocess.run([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"], capture_output=True).stdout
    for base in (REPO_RUN, ARCH_RUN):
        for d in ("screenshots", "screenshots-sanitized"):
            with open(os.path.join(base, d, f"{tag}.png"), "wb") as f: f.write(raw)
    adb(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
    xml = adb(["shell", "cat", "/sdcard/window_dump.xml"])
    adb(["shell", "rm", "/sdcard/window_dump.xml"])
    for base in (REPO_RUN, ARCH_RUN):
        with open(os.path.join(base, "dumpsys", f"{tag}.xml"), "w", encoding="utf-8") as f: f.write(xml)
    return xml

def tap(x, y, wait=1.5):
    adb(["shell", "input", "tap", str(x), str(y)])
    time.sleep(wait)

def main():
    log("=== read-only switch states start ===")
    adb(["shell", "input", "keyevent", "3"]); time.sleep(1)

    # 1) 应用信息页
    adb(["shell", "am", "start", "-a", "android.settings.APPLICATION_DETAILS_SETTINGS", "-d", "package:space.alliswell.inbox"])
    time.sleep(2.5)
    xml = shot_and_dump("baseline_appinfo")

    # 2) 点击 电量
    log("tapping 电量 at (150, 992)")
    tap(150, 992)
    xml = shot_and_dump("baseline_battery")

    # 3) 点击 后台耗电管理
    log("tapping 后台耗电管理 at (246, 2090)")
    tap(246, 2090)
    xml = shot_and_dump("baseline_bgpower_detail")
    
    # 判定单选
    checked_mode = None
    if 'text="允许后台耗电"' in xml and 'checked="true" bounds="[912,992][966,1046]"' in xml:
        checked_mode = "允许后台耗电"
    elif 'text="智能控制后台耗电"' in xml and 'checked="true" bounds="[912,758][966,812]"' in xml:
        checked_mode = "智能控制后台耗电"
    log(f"bgpower detail checked radio: {checked_mode}")

    # 返回应用信息页
    adb(["shell", "input", "keyevent", "4"]); time.sleep(0.5)
    adb(["shell", "input", "keyevent", "4"]); time.sleep(0.5)

    # 4) 查看所有权限
    log("tapping 查看所有权限 at (540, 1605)")
    tap(540, 1605)
    xml = shot_and_dump("baseline_allperm")

    # 检查自启动、锁屏显示、悬浮窗
    autostart_off = ('text="自启动"' in xml and 'checked="false" bounds="[852,472][990,610]"' in xml)
    lockscreen_off = ('text="锁屏显示"' in xml and 'checked="false" bounds="[852,1111][990,1249]"' in xml)
    overlay_on = ('text="悬浮窗"' in xml and 'checked="true" bounds="[852,823][990,961]"' in xml)
    log(f"switches check: autostart_off={autostart_off}, lockscreen_off={lockscreen_off}, overlay_on={overlay_on}")

    # 返回桌面
    adb(["shell", "input", "keyevent", "4"]); time.sleep(0.5)
    adb(["shell", "input", "keyevent", "4"]); time.sleep(0.5)

    # deviceidle whitelist
    wl = adb(["shell", "dumpsys", "deviceidle", "whitelist"])
    for base in (REPO_RUN, ARCH_RUN):
        with open(os.path.join(base, "dumpsys", "deviceidle_whitelist.txt"), "w", encoding="utf-8") as f:
            f.write(wl)
    log(f"deviceidle whitelist has inbox: {'space.alliswell.inbox' in wl}")
    log("=== read-only switch states end ===")

if __name__ == "__main__":
    main()
