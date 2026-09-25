#!/usr/bin/env python3
"""只读：从应用信息页进入「查看所有权限」，读自启动/锁屏显示子页状态（只看不点开关）。"""
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
    line = f"[{datetime.fromtimestamp(ms_i/1000.0).strftime('%Y-%m-%d %H:%M:%S')}] [{ms_i}] [RESUME-PERM] {msg}"
    print(line, flush=True)
    for p in (LOG_PATH, os.path.join(ARCH_RUN, "run.log")):
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")

def shot(tag):
    raw = subprocess.run([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"], capture_output=True).stdout
    for base in (REPO_RUN, ARCH_RUN):
        with open(os.path.join(base, "screenshots", f"resume_{tag}.png"), "wb") as f: f.write(raw)

def dump_xml():
    adb(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
    xml = adb(["shell", "cat", "/sdcard/window_dump.xml"])
    adb(["shell", "rm", "/sdcard/window_dump.xml"])
    return xml

def save_dump(tag, xml):
    for base in (REPO_RUN, ARCH_RUN):
        with open(os.path.join(base, "dumpsys", f"resume_{tag}.xml"), "w", encoding="utf-8") as f: f.write(xml)

def find_row(xml, text):
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>', xml):
        if m.group(1) == text or text in m.group(1):
            l, t, r, b = map(int, m.groups()[1:])
            return (l + r) // 2, (t + b) // 2
    return None

def tap(x, y, wait=1.6):
    adb(["shell", "input", "tap", str(x), str(y)])
    time.sleep(wait)

def main():
    log("=== resume: permission subpages read start ===")
    shot("cur_page")
    xml = dump_xml()
    save_dump("cur_page", xml)
    row = find_row(xml, "查看所有权限")
    if row:
        log(f"tapping 查看所有权限 at {row}")
        tap(*row)
    else:
        log("WARN 查看所有权限 not found; trying 权限 card")
        row = find_row(xml, "权限")
        if row: tap(*row)
    xml = dump_xml(); save_dump("perm_list", xml); shot("perm_list")
    log("perm_list texts: " + " | ".join(re.findall(r'text="([^"]+)"', xml)[:30]))

    for sub, tag in (("自启动", "autostart"), ("锁屏显示", "lockscreen")):
        xml = dump_xml(); save_dump(f"perm_before_{tag}", xml)
        row = find_row(xml, sub)
        if not row:
            log(f"WARN {sub} row not found"); continue
        log(f"tapping {sub} at {row}")
        tap(*row)
        time.sleep(0.8)
        xml2 = dump_xml(); save_dump(f"{tag}_detail", xml2); shot(f"{tag}_detail")
        log(f"{tag}_detail texts: " + " | ".join(re.findall(r'text="([^"]+)"', xml2)[:25]))
        adb(["shell", "input", "keyevent", "4"]); time.sleep(1.2)
    log("=== resume: permission subpages read end ===")

if __name__ == "__main__":
    main()
