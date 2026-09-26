#!/usr/bin/env python3
"""切换 vivo「后台耗电管理」为指定模式（智能控制 / 允许后台耗电）。
用法：python set_bgpower.py "智能控制后台耗电" <tag>
改前、改后各截图 + uiautomator dump 留证；写 run.log（两份）。
"""
import os, time, json, subprocess, re, sys

ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
S = "10ACBF2D3D000RS"
RUN_ID = "20260926T005700Z-vivo-resume-recheck"
REPO_RUN = os.path.join("/Users/qlyf/Developer/reminder", "docs/reviews/verification-runs", RUN_ID)
ARCH_RUN = os.path.expanduser(f"~/Developer/reminder-archive/verification-runs/{RUN_ID}")
LOG_PATH = os.path.join(REPO_RUN, "run.log")

def adb(a, timeout=25):
    return subprocess.run([ADB, "-s", S] + a, capture_output=True, text=True, timeout=timeout).stdout.strip()

def log(msg):
    ms = adb(["shell", "date", "+%s%3N"])
    from datetime import datetime
    try: ms_i = int(ms)
    except: ms_i = int(time.time()*1000)
    line = f"[{datetime.fromtimestamp(ms_i/1000.0).strftime('%Y-%m-%d %H:%M:%S')}] [{ms_i}] [BGPOWER] {msg}"
    print(line, flush=True)
    for p in (LOG_PATH, os.path.join(ARCH_RUN, "run.log")):
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")

def shot_dump(tag):
    raw = subprocess.run([ADB, "-s", S, "exec-out", "screencap", "-p"], capture_output=True).stdout
    ok = raw[:4] == b"\x89PNG"
    for base, d in ((REPO_RUN, "screenshots-sanitized"), (ARCH_RUN, "screenshots")):
        os.makedirs(os.path.join(base, d), exist_ok=True)
        with open(os.path.join(base, d, f"{tag}.png"), "wb") as f: f.write(raw)
    adb(["shell", "uiautomator", "dump", "/sdcard/ud.xml"])
    xml = adb(["shell", "cat", "/sdcard/ud.xml"]); adb(["shell", "rm", "/sdcard/ud.xml"])
    for base, d in ((REPO_RUN, "dumpsys"), (ARCH_RUN, "dumpsys")):
        os.makedirs(os.path.join(base, d), exist_ok=True)
        with open(os.path.join(base, d, f"{tag}.xml"), "w", encoding="utf-8") as f: f.write(xml)
    return ok, xml

def row(xml, text):
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        if m.group(1) == text:
            l, t, r, b = map(int, m.groups()[1:]); return (l+r)//2, (t+b)//2
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        if text in m.group(1):
            l, t, r, b = map(int, m.groups()[1:]); return (l+r)//2, (t+b)//2
    return None

def checked_mode(xml):
    """返回当前选中的模式名：找 checked=true 的 RadioButton，按 y 坐标匹配最近的选项标题行。"""
    titles = []
    for name in ("智能控制后台耗电", "允许后台耗电"):
        m = re.search(r'<node[^>]*text="' + name + r'"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
        if m:
            l, t, r, b = map(int, m.groups()); titles.append((name, t, b))
    best = None
    for m in re.finditer(r'<node[^>]*class="android\.widget\.RadioButton"[^>]*checked="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        l, t, r, b = map(int, m.groups()); cy = (t+b)//2
        for name, tt, tb in titles:
            if tt - 60 <= cy <= tb + 60:
                best = name
    return best

def navigate_to_detail():
    adb(["shell", "am", "start", "-a", "android.settings.APPLICATION_DETAILS_SETTINGS", "-d", "package:space.alliswell.inbox"])
    time.sleep(2.5)
    _, xml = shot_dump("nav_appinfo")
    p = row(xml, "电量")
    if not p: log("ERROR: 电量 row not found"); sys.exit(2)
    adb(["shell", "input", "tap", str(p[0]), str(p[1])]); time.sleep(2)
    _, xml = shot_dump("nav_battery")
    p = row(xml, "后台耗电管理")
    if not p: log("ERROR: 后台耗电管理 row not found"); sys.exit(2)
    adb(["shell", "input", "tap", str(p[0]), str(p[1])]); time.sleep(2)
    _, xml = shot_dump("nav_bgpower_list")
    p = row(xml, "安心收件箱")
    if not p: log("ERROR: 安心收件箱 row not found in bgpower list"); sys.exit(2)
    adb(["shell", "input", "tap", str(p[0]), str(p[1])]); time.sleep(2)

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "智能控制后台耗电"
    tag = sys.argv[2] if len(sys.argv) > 2 else "set"
    log(f"=== set bgpower target={target} tag={tag} start ===")
    navigate_to_detail()
    ok, xml = shot_dump(f"{tag}_before")
    before = checked_mode(xml)
    log(f"before mode(checked radio): {before} png_ok={ok}")
    if before == target:
        log("already at target, no tap")
    else:
        p = row(xml, target)
        if not p: log(f"ERROR: target row {target} not found"); sys.exit(2)
        log(f"tapping target row at {p}")
        adb(["shell", "input", "tap", str(p[0]), str(p[1])]); time.sleep(2)
        ok, xml = shot_dump(f"{tag}_after")
        after = checked_mode(xml)
        log(f"after mode(checked radio): {after} png_ok={ok}")
        if after != target:
            log("ERROR: switch did not take effect"); sys.exit(3)
    # 白名单第二见证
    wl = adb(["shell", "dumpsys deviceidle whitelist | grep alliswell"])
    log(f"deviceidle whitelist entry: {wl!r}")
    log(f"=== set bgpower target={target} tag={tag} end ===")

if __name__ == "__main__":
    main()
