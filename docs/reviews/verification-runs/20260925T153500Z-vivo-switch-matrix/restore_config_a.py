#!/usr/bin/env python3
"""收尾：把三个开关恢复到步骤 0 原值（用户已同意，2026-09-26 00:30 run.log 记录）。
目标：后台耗电→智能控制；锁屏显示→关；自启动→关。每步前后截图+dump 留证。
"""
import os, time, re, subprocess, json, urllib.request

for k in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy'):
    os.environ.pop(k, None)
os.environ['NO_PROXY'] = '*'; os.environ['no_proxy'] = '*'

SERIAL = "10ACBF2D3D000RS"
PACKAGE = "space.alliswell.inbox"
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
RUN_ID = "20260925T153500Z-vivo-switch-matrix"
REPO_RUN = os.path.join("/Users/qlyf/Developer/reminder", "docs/reviews/verification-runs", RUN_ID)
ARCH_RUN = os.path.expanduser(f"~/Developer/reminder-archive/verification-runs/{RUN_ID}")
LOG_PATH = os.path.join(REPO_RUN, "run.log")
PORT = 53421

def adb(args, timeout=20):
    return subprocess.run([ADB, "-s", SERIAL] + args, capture_output=True, text=True, timeout=timeout).stdout.strip()

def log(msg):
    ms = adb(["shell", "date", "+%s%3N"])
    from datetime import datetime
    try: ms_i = int(ms)
    except: ms_i = int(time.time()*1000)
    line = f"[{datetime.fromtimestamp(ms_i/1000.0).strftime('%Y-%m-%d %H:%M:%S')}] [{ms_i}] [RESTORE] {msg}"
    print(line, flush=True)
    for p in (LOG_PATH, os.path.join(ARCH_RUN, "run.log")):
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")

def shot(tag):
    raw = subprocess.run([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"], capture_output=True).stdout
    for base in (REPO_RUN, ARCH_RUN):
        with open(os.path.join(base, "screenshots", f"restore_{tag}.png"), "wb") as f: f.write(raw)

def dump_xml():
    adb(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
    xml = adb(["shell", "cat", "/sdcard/window_dump.xml"])
    adb(["shell", "rm", "/sdcard/window_dump.xml"])
    return xml

def save_dump(tag, xml):
    for base in (REPO_RUN, ARCH_RUN):
        with open(os.path.join(base, "dumpsys", f"restore_{tag}.xml"), "w", encoding="utf-8") as f: f.write(xml)

def row_bounds(xml, text):
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>', xml):
        if m.group(1) == text or text in m.group(1):
            l, t, r, b = map(int, m.groups()[1:])
            return (l, t, r, b)
    return None

def tap(x, y, wait=1.6):
    adb(["shell", "input", "tap", str(x), str(y)])
    time.sleep(wait)

def main():
    log("=== restore config A start（用户已同意：后台耗电→智能控制；锁屏显示→关；自启动→关）===")
    adb(["shell", "input", "keyevent", "3"]); time.sleep(1)
    adb(["shell", "am", "start", "-a", "android.settings.APPLICATION_DETAILS_SETTINGS", "-d", f"package:{PACKAGE}"])
    time.sleep(2.5)

    # ---- 权限页：自启动、锁屏显示 ----
    xml = dump_xml()
    row = row_bounds(xml, "查看所有权限") or row_bounds(xml, "权限")
    if row:
        tap((row[0]+row[2])//2, (row[1]+row[3])//2)
    xml = dump_xml(); save_dump("perm_before", xml); shot("perm_before")

    for name in ("自启动", "锁屏显示"):
        xml = dump_xml()
        b = row_bounds(xml, name)
        if not b:
            log(f"WARN {name} row not found, skip"); continue
        sw_x = b[2] - 170  # 开关控件在行右侧
        sw_y = (b[1] + b[3]) // 2
        log(f"tapping {name} switch at ({sw_x},{sw_y})（同意的恢复操作）")
        shot(f"{name}_before")
        tap(sw_x, sw_y)
        xml2 = dump_xml(); save_dump(f"{name}_after", xml2); shot(f"{name}_after")
        log(f"{name} toggled; verify visually in restore_{name}_after.png")

    # ---- 后台耗电 → 智能控制 ----
    adb(["shell", "input", "keyevent", "4"]); time.sleep(1.2)  # 回应用信息
    xml = dump_xml()
    row = row_bounds(xml, "电量")
    if row:
        tap((row[0]+row[2])//2, (row[1]+row[3])//2)
    time.sleep(1)
    xml = dump_xml()
    row = row_bounds(xml, "后台耗电管理")
    if row:
        tap((row[0]+row[2])//2, (row[1]+row[3])//2)
    time.sleep(1.2)
    xml = dump_xml(); save_dump("bgpower_list_before", xml); shot("bgpower_list_before")
    row = row_bounds(xml, PACKAGE) or row_bounds(xml, "安心收件箱")
    if row:
        tap((row[0]+row[2])//2, (row[1]+row[3])//2)
        time.sleep(1.5)
        xml = dump_xml(); save_dump("bgpower_detail_before", xml); shot("bgpower_detail_before")
        b = row_bounds(xml, "智能控制后台耗电")
        if b:
            log(f"tapping 智能控制后台耗电 radio at ({(b[0]+b[2])//2},{(b[1]+b[3])//2})（同意的恢复操作）")
            tap((b[0]+b[2])//2, (b[1]+b[3])//2)
            time.sleep(1.2)
            xml2 = dump_xml(); save_dump("bgpower_detail_after", xml2); shot("bgpower_detail_after")
            log("后台耗电 restored; verify visually in restore_bgpower_detail_after.png")
        else:
            log("WARN 智能控制后台耗电 option not found")
        adb(["shell", "input", "keyevent", "4"]); time.sleep(0.8)
    adb(["shell", "input", "keyevent", "4"]); time.sleep(0.8)
    adb(["shell", "input", "keyevent", "4"]); time.sleep(0.8)
    log("=== restore config A end ===")

if __name__ == "__main__":
    main()
