#!/usr/bin/env python3
"""只读：导航到三个开关页，截图 + uiautomator dump 留证。绝不点击开关本体。"""
import os, time, json, subprocess, re

for k in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy'):
    os.environ.pop(k, None)

SERIAL = "10ACBF2D3D000RS"
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
RUN_ID = "20260926T005700Z-vivo-resume-recheck"
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
        for d in ("screenshots", "dumpsys"):
            os.makedirs(os.path.join(base, d), exist_ok=True)
    raw = subprocess.run([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"], capture_output=True).stdout
    for base in (REPO_RUN, ARCH_RUN):
        with open(os.path.join(base, "screenshots", f"resume_{tag}.png"), "wb") as f: f.write(raw)
    adb(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
    xml = adb(["shell", "cat", "/sdcard/window_dump.xml"])
    adb(["shell", "rm", "/sdcard/window_dump.xml"])
    for base in (REPO_RUN, ARCH_RUN):
        with open(os.path.join(base, "dumpsys", f"resume_{tag}.xml"), "w", encoding="utf-8") as f: f.write(xml)
    return xml

def find_row(xml, text):
    """返回包含 text 的节点中心坐标（取其可点击父区域或自身 bounds）"""
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>', xml):
        if m.group(1) == text:
            l, t, r, b = map(int, m.groups()[1:])
            return (l + r) // 2, (t + b) // 2
    # 部分匹配
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>', xml):
        if text in m.group(1):
            l, t, r, b = map(int, m.groups()[1:])
            return (l + r) // 2, (t + b) // 2
    return None

def tap(x, y, wait=1.5):
    adb(["shell", "input", "tap", str(x), str(y)])
    time.sleep(wait)

def main():
    log("=== resume: read-only switch states start ===")
    # 回到桌面，避免停留在应用
    adb(["shell", "input", "keyevent", "3"]); time.sleep(1)

    # 1) 应用信息页
    adb(["shell", "am", "start", "-a", "android.settings.APPLICATION_DETAILS_SETTINGS", "-d", "package:space.alliswell.inbox"])
    time.sleep(2.5)
    xml = shot_and_dump("appinfo")
    row = find_row(xml, "电量")
    if not row: log("ERROR: 电量 row not found"); return
    log(f"tapping 电量 at {row}")
    tap(*row)

    # 2) 电池页
    xml = shot_and_dump("battery")
    row = find_row(xml, "后台耗电管理")
    if not row:
        log("WARN: 后台耗电管理 not on this page; texts: " + ", ".join(re.findall(r'text="([^"]+)"', xml)[:30]))
        adb(["shell", "input", "keyevent", "4"]); time.sleep(1)
        return
    log(f"tapping 后台耗电管理 at {row}")
    tap(*row)

    # 3) 后台耗电管理列表（安心收件箱行的模式文字）
    xml = shot_and_dump("bgpower_list")
    texts = re.findall(r'text="([^"]+)"', xml)
    idx = [i for i, t in enumerate(texts) if t == "安心收件箱"]
    mode = None
    if idx:
        i = idx[0]
        # 模式文字通常在应用名同行或下一行
        for j in (i, i + 1, i - 1):
            if 0 <= j < len(texts) and texts[j] in ("智能控制", "允许后台耗电", "限制后台耗电", "允许后台高耗电"):
                mode = texts[j]; break
    log(f"background power mode text for 安心收件箱: {mode}")
    # 进安心收件箱的详情页（单选项页），只看不点
    if idx:
        row = find_row(xml, "安心收件箱")
        if row:
            tap(*row)
            time.sleep(1.5)
            xml2 = shot_and_dump("bgpower_detail")
            log("bgpower detail texts: " + " | ".join(re.findall(r'text="([^"]+)"', xml2)[:20]))
            adb(["shell", "input", "keyevent", "4"]); time.sleep(1)
    adb(["shell", "input", "keyevent", "4"]); time.sleep(1)  # 回应用信息

    # 4) 权限页（锁屏显示/自启动/悬浮窗/后台弹出界面）
    xml = shot_and_dump("appinfo2")
    row = find_row(xml, "权限")
    if row:
        log(f"tapping 权限 at {row}")
        tap(*row)
        xml = shot_and_dump("perm")
        # 进自启动子页（只看不点开关）
        row = find_row(xml, "自启动")
        if row:
            log(f"tapping 自启动 entry at {row}")
            tap(*row)
            time.sleep(1.5)
            shot_and_dump("autostart_detail")
            adb(["shell", "input", "keyevent", "4"]); time.sleep(1)
        # 进锁屏显示子页
        xml = shot_and_dump("perm2")
        row = find_row(xml, "锁屏显示")
        if row:
            log(f"tapping 锁屏显示 entry at {row}")
            tap(*row)
            time.sleep(1.5)
            shot_and_dump("lockscreen_detail")
            adb(["shell", "input", "keyevent", "4"]); time.sleep(1)
    log("=== resume: read-only switch states end ===")

if __name__ == "__main__":
    main()
