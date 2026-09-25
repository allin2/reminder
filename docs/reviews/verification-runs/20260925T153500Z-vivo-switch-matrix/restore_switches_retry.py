#!/usr/bin/env python3
"""重试：点开关本体（x=904）恢复 自启动/锁屏显示 → 关。每步前后截图对比验证。"""
import os, time, re, subprocess

SERIAL = "10ACBF2D3D000RS"
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
RUN_ID = "20260925T153500Z-vivo-switch-matrix"
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
    line = f"[{datetime.fromtimestamp(ms_i/1000.0).strftime('%Y-%m-%d %H:%M:%S')}] [{ms_i}] [RESTORE2] {msg}"
    print(line, flush=True)
    for p in (LOG_PATH, os.path.join(ARCH_RUN, "run.log")):
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")

def shot(tag):
    raw = subprocess.run([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"], capture_output=True).stdout
    paths = []
    for base in (REPO_RUN, ARCH_RUN):
        p = os.path.join(base, "screenshots", f"restore2_{tag}.png")
        with open(p, "wb") as f: f.write(raw)
        paths.append(p)
    return paths[0]

def dump_xml():
    adb(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
    xml = adb(["shell", "cat", "/sdcard/window_dump.xml"])
    adb(["shell", "rm", "/sdcard/window_dump.xml"])
    return xml

def row_bounds(xml, text):
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>', xml):
        if m.group(1) == text or text in m.group(1):
            l, t, r, b = map(int, m.groups()[1:])
            return (l, t, r, b)
    return None

def main():
    # 确保在权限页
    xml = dump_xml()
    if "自启动" not in xml:
        log("not on perm page, navigating...")
        adb(["shell", "input", "keyevent", "4"]); time.sleep(1)
        xml = dump_xml()
        b = row_bounds(xml, "查看所有权限")
        if b:
            adb(["shell", "input", "tap", str((b[0]+b[2])//2), str((b[1]+b[3])//2)]); time.sleep(1.6)
            xml = dump_xml()
    for name in ("自启动", "锁屏显示"):
        xml = dump_xml()
        b = row_bounds(xml, name)
        if not b:
            log(f"WARN {name} not found"); continue
        y = (b[1] + b[3]) // 2
        before = shot(f"{name}_pre2")
        log(f"tapping {name} SWITCH at (904,{y})")
        adb(["shell", "input", "tap", "904", str(y)])
        time.sleep(1.6)
        after = shot(f"{name}_post2")
        import hashlib
        h1 = hashlib.sha256(open(before,'rb').read()).hexdigest()
        h2 = hashlib.sha256(open(after,'rb').read()).hexdigest()
        log(f"{name}: before={h1[:12]} after={h2[:12]} changed={h1!=h2}（视觉核对 restore2_{name}_post2.png）")
    log("done")

if __name__ == "__main__":
    main()
