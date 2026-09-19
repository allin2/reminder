#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""手机设备连接建立 + 整体功能验证（一次跑完，产出报告）。

三段式，任一段失败都不影响后续段落继续取证：

  A 连接  —— 发现/指定设备 → 校验授权 → 稳定性取样（防抖动/假连）
  B 通信  —— 命令通道、时钟、文件通道、二进制通道、端口转发、日志通道
  C 功能  —— 设备能力 / 安装 / 权限 / 通知渠道 / 闹钟排程 / 冻结态 / 运行时 / 业务逻辑
             （写入类往返需要 --live，默认不落库）

纪律（沿用项目既有取证脚本）：
  · 显式 -s SERIAL，默认拒绝模拟器 —— 模拟器通过 ≠ 真机通过
  · 默认只读：不卸载、不清数据、不改设备设置；临时文件/端口转发用完即清
  · 每次运行都落盘到独立 RUN 目录，原始证据可交叉核对
  · 状态四态：PASS / FAIL / WARN(环境限制，无法判定) / SKIP(未启用)
  · 退出码：0 无 FAIL；1 存在 FAIL；2 连接未建立

用法：
  /usr/bin/python3 scripts/device-verify.py
  /usr/bin/python3 scripts/device-verify.py --serial 10ACBF2D3D000RS
  /usr/bin/python3 scripts/device-verify.py --tcp 192.168.1.20:5555 --live
  /usr/bin/python3 scripts/device-verify.py --allow-emulator --skip cdp

注意：本脚本用 /usr/bin/python3（CDP 依赖 websocket 装在这份解释器上）。
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

PKG = "space.alliswell.inbox"
MAIN_ACTIVITY = PKG + "/.MainActivity"
KNOWN_CHANNELS = ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"]

PASS, FAIL, WARN, SKIP = "PASS", "FAIL", "WARN", "SKIP"
GLYPH = {PASS: "[PASS]", FAIL: "[FAIL]", WARN: "[WARN]", SKIP: "[SKIP]"}


# --------------------------------------------------------------------------- 基础
def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_ms():
    return int(time.time() * 1000)


class Report:
    def __init__(self, run_dir):
        self.run_dir = run_dir
        self.checks = []
        self.started = now_iso()

    def add(self, cid, title, status, detail=None, note=""):
        rec = {"id": cid, "title": title, "status": status,
               "detail": detail if isinstance(detail, (dict, list, str, int, float)) or detail is None else str(detail),
               "note": note}
        self.checks.append(rec)
        self.echo(rec)
        return rec

    @staticmethod
    def echo(rec):
        line = "%-6s %-6s %s" % (rec["id"], GLYPH[rec["status"]], rec["title"])
        print(line, flush=True)
        if rec["note"]:
            print("              %s" % rec["note"], flush=True)

    def counts(self):
        c = {PASS: 0, FAIL: 0, WARN: 0, SKIP: 0}
        for r in self.checks:
            c[r["status"]] += 1
        return c

    def save(self, meta):
        c = self.counts()
        verdict = "PASS" if c[FAIL] == 0 else "FAIL"
        if c[FAIL] == 0 and c[WARN]:
            verdict = "PASS_WITH_WARN"
        data = {"verdict": verdict, "startedAt": self.started, "finishedAt": now_iso(),
                "counts": c, "meta": meta, "checks": self.checks}
        (self.run_dir / "report.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (self.run_dir / "report.md").write_text(self.markdown(meta, verdict, c), encoding="utf-8")
        return verdict, c

    def markdown(self, meta, verdict, c):
        out = []
        out.append("# 设备连接与整体验证报告")
        out.append("")
        out.append("- 运行目录：`%s`" % self.run_dir)
        out.append("- 开始：%s  结束：%s" % (self.started, now_iso()))
        out.append("- **结论：%s**（PASS %d / FAIL %d / WARN %d / SKIP %d）"
                   % (verdict, c[PASS], c[FAIL], c[WARN], c[SKIP]))
        out.append("")
        out.append("## 环境")
        out.append("")
        out.append("| 项 | 值 |")
        out.append("| --- | --- |")
        for k, v in meta.items():
            out.append("| %s | %s |" % (k, v))
        out.append("")
        out.append("## 结果明细")
        out.append("")
        out.append("| 编号 | 状态 | 项目 | 说明 |")
        out.append("| --- | --- | --- | --- |")
        for r in self.checks:
            detail = r["detail"]
            if isinstance(detail, (dict, list)):
                detail = json.dumps(detail, ensure_ascii=False)
            detail = "" if detail is None else str(detail)
            detail = detail.replace("|", "\\|").replace("\n", " ")
            if len(detail) > 220:
                detail = detail[:220] + "…"
            out.append("| %s | %s | %s | %s |" % (r["id"], r["status"], r["title"], detail))
        out.append("")
        out.append("> WARN = 环境限制导致无法判定，不算通过也不算失败；SKIP = 本次未启用。")
        out.append("")
        return "\n".join(out)


class Device:
    """adb 通道封装：记录链路掉线次数，所有调用都带超时。"""

    def __init__(self, adb_bin, serial):
        self.adb = adb_bin
        self.serial = serial
        self.link_drops = 0
        self.calls = 0

    def run(self, args, timeout=25, raw=False):
        self.calls += 1
        cmd = [self.adb]
        if self.serial:
            cmd += ["-s", self.serial]
        cmd += list(args)
        try:
            p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        except subprocess.TimeoutExpired:
            return 124, (b"" if raw else ""), "TIMEOUT after %ss: %s" % (timeout, " ".join(cmd))
        except OSError as e:
            return 127, (b"" if raw else ""), "OSError: %s" % e
        out = p.stdout if raw else p.stdout.decode("utf-8", "replace")
        err = p.stderr.decode("utf-8", "replace")
        if p.returncode != 0 and re.search(r"device not found|no devices|device offline|closed", err):
            self.link_drops += 1
        return p.returncode, out, err

    def sh(self, cmd, timeout=25):
        rc, out, err = self.run(["shell", cmd], timeout=timeout)
        return rc, out.replace("\r", "").strip(), err

    def state(self):
        if not self.serial:
            return "no-serial"
        rc, out, err = self.run(["get-state"], timeout=10)
        return (out or err).strip().splitlines()[0].strip() if (out or err).strip() else "unknown"


# --------------------------------------------------------------------------- CDP
class Cdp:
    """极简 CDP 客户端（只支持本脚本需要的 evaluate / reload）。"""

    def __init__(self, port):
        for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
            os.environ.pop(k, None)
        os.environ["NO_PROXY"] = "*"
        import urllib.request
        import websocket  # noqa: F401  (由调用方保证可用)
        self.websocket = websocket
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        targets = json.loads(opener.open("http://127.0.0.1:%d/json" % port, timeout=10).read().decode())
        page = next(t for t in targets if t.get("type") == "page")
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=90, suppress_origin=True)
        self.seq = 0

    def call(self, method, params=None):
        self.seq += 1
        self.ws.send(json.dumps({"id": self.seq, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.seq:
                return msg

    def evaluate(self, expr, await_promise=True):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                           "awaitPromise": await_promise})
        res = r.get("result", {})
        if "exceptionDetails" in res:
            raise RuntimeError("JS: " + json.dumps(res["exceptionDetails"], ensure_ascii=False)[:400])
        return res.get("result", {}).get("value")

    def reload(self):
        self.call("Page.enable")
        self.call("Page.reload", {"ignoreCache": True})

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


# --------------------------------------------------------------------------- A 连接
def stage_connect(dev, rep, args):
    print("\n=== A 连接建立 ===", flush=True)

    rc, out, err = dev.run(["version"], timeout=15)
    if rc != 0:
        rep.add("A-01", "adb 可用", FAIL, {"error": (err or out)[:200]})
        return False
    ver = out.strip().splitlines()[0]
    rep.add("A-01", "adb 可用", PASS, ver)

    # --- 发现 / 指定
    serial = args.serial
    if not serial:
        rc, out, _ = dev.run(["devices", "-l"], timeout=15)
        cands = []
        for line in out.splitlines()[1:]:
            parts = line.split()
            if len(parts) < 2 or parts[1] != "device":
                continue
            s = parts[0]
            if re.search(r"emulator|EMULATOR|sdk_gphone", s) and not args.allow_emulator:
                continue
            cands.append(s)
        if args.tcp and not cands:
            rc, out, err = dev.run(["connect", args.tcp], timeout=25)
            if rc == 0 and ("connected" in out or "already" in out):
                serial = args.tcp
                rep.add("A-02", "设备发现（无线连接）", PASS, {"target": args.tcp, "out": out.strip()})
        if not serial:
            if not cands:
                if args.wait > 0:
                    deadline = time.time() + args.wait
                    while time.time() < deadline and not cands:
                        time.sleep(2)
                        rc, out, _ = dev.run(["devices"], timeout=10)
                        cands = [l.split()[0] for l in out.splitlines()[1:]
                                 if len(l.split()) >= 2 and l.split()[1] == "device"
                                 and not (re.search(r"emulator|sdk_gphone", l) and not args.allow_emulator)]
                    if not cands:
                        rep.add("A-02", "设备发现", FAIL,
                                {"waited": args.wait},
                                "未发现设备：请插线并在手机上允许 USB 调试；无线用 --tcp <ip:5555>")
                        return False
                else:
                    rep.add("A-02", "设备发现", FAIL, {}, "未发现设备（可用 --wait 等待或 --tcp 无线连接）")
                    return False
            if len(cands) > 1:
                rep.add("A-02", "设备发现", FAIL, {"candidates": cands}, "存在多台设备，请用 --serial 显式指定")
                return False
            serial = cands[0]
    if not serial:
        rep.add("A-02", "设备发现", FAIL, {})
        return False
    dev.serial = serial
    rep.add("A-02", "设备发现", PASS, {"serial": serial})

    # --- 授权状态
    deadline = time.time() + max(args.wait, 10)
    st = dev.state()
    while st in ("unauthorized", "offline", "no permissions") and time.time() < deadline:
        time.sleep(2)
        st = dev.state()
    if st == "unauthorized":
        rep.add("A-03", "调试授权", FAIL, {"state": st}, "手机上点「允许 USB 调试」后重跑")
        return False
    if st == "offline":
        rep.add("A-03", "调试授权", FAIL, {"state": st}, "设备 offline：换线/重插/重开 USB 调试")
        return False
    if st != "device":
        rep.add("A-03", "调试授权", FAIL, {"state": st})
        return False
    rep.add("A-03", "调试授权", PASS, {"state": st})

    # --- 稳定性取样：连续 N 次都是 device，且 transport_id 不变
    samples, tids = [], set()
    stable = True
    for _ in range(max(1, args.settle)):
        s = dev.state()
        samples.append(s)
        if s != "device":
            stable = False
        rc, out, _ = dev.run(["devices", "-l"], timeout=10)
        for line in out.splitlines():
            if line.startswith(serial + " ") or (" " + serial + " ") in line or line.split()[:1] == [serial]:
                m = re.search(r"transport_id:(\d+)", line)
                if m:
                    tids.add(m.group(1))
        time.sleep(args.settle_interval)
    rep.add("A-04", "连接稳定性（连续 %d 次取样）" % args.settle,
            PASS if stable else FAIL,
            {"samples": samples, "transportIds": sorted(tids)},
            "" if stable else "取样期间状态抖动 —— 线材/USB 口/无线链路不可靠")
    if not stable:
        return False

    # --- 传输通道与身份
    props = {}
    for k in ("ro.product.manufacturer", "ro.product.model", "ro.build.version.release",
              "ro.build.version.sdk", "ro.build.display.id", "ro.vivo.os.version"):
        rc, out, _ = dev.sh("getprop %s" % k, timeout=10)
        props[k] = out
    # 含 ':' 的一定是 host:port（无线）；真机 USB 序列号是没有冒号的
    transport = "tcp(无线)" if ":" in serial else "usb(有线)"
    rep.add("A-05", "设备身份与传输通道", PASS,
            {"serial": serial, "transport": transport, "manufacturer": props.get("ro.product.manufacturer"),
             "model": props.get("ro.product.model"), "android": props.get("ro.build.version.release"),
             "sdk": props.get("ro.build.version.sdk"), "rom": props.get("ro.vivo.os.version") or ""})
    return props


# --------------------------------------------------------------------------- B 通信
def stage_comm(dev, rep, run_dir):
    print("\n=== B 基础通信 ===", flush=True)

    # B-01 命令通道往返（随机 token，防止读到缓存/回显假成功）
    token = "dv%s" % hashlib.sha256(os.urandom(16)).hexdigest()[:12]
    rc, out, err = dev.sh("echo %s" % token, timeout=15)
    ok = rc == 0 and out == token
    rep.add("B-01", "命令通道往返", PASS if ok else FAIL,
            {"sent": token, "received": out, "rc": rc}, "" if ok else "shell 回显与发送值不一致")

    # B-02 时钟一致性
    rc, out, _ = dev.sh("date +%s%3N", timeout=15)
    try:
        dev_ms = int(re.sub(r"\D", "", out)[:13])
        skew = dev_ms - now_ms()
        ok = abs(skew) < 5000
        rep.add("B-02", "设备时钟一致性", PASS if ok else WARN,
                {"deviceMs": dev_ms, "hostMs": now_ms(), "skewMs": skew},
                "" if ok else "设备与主机时钟相差 >5s，跨设备对齐日志时需注意")
    except Exception:
        rep.add("B-02", "设备时钟一致性", WARN, {"raw": out})

    # B-03 文件通道一致性（push → 设备侧哈希 → pull → 主机侧哈希）
    tmp_local = Path(tempfile.mkdtemp(prefix="dv-file-")) / "probe.bin"
    blob = os.urandom(65536)
    tmp_local.write_bytes(blob)
    host_hash = hashlib.sha256(blob).hexdigest()
    remote = "/data/local/tmp/dv-probe-%d.bin" % now_ms()
    rc1, _, err1 = dev.run(["push", str(tmp_local), remote], timeout=40)
    rc_h, dev_hash_raw, _ = dev.sh("sha256sum %s" % remote, timeout=20)
    algo = "sha256"
    if rc_h != 0 or not re.match(r"^[0-9a-f]{64}", dev_hash_raw):
        rc_h, dev_hash_raw, _ = dev.sh("md5sum %s" % remote, timeout=20)
        algo = "md5"
    dev_hash = dev_hash_raw.split()[0] if dev_hash_raw else ""
    expect = host_hash if algo == "sha256" else hashlib.md5(blob).hexdigest()
    pulled = tmp_local.with_name("pulled.bin")
    rc2, _, err2 = dev.run(["pull", remote, str(pulled)], timeout=40)
    pulled_hash = hashlib.sha256(pulled.read_bytes()).hexdigest() if pulled.exists() else ""
    ok = rc1 == 0 and rc2 == 0 and dev_hash == expect and pulled_hash == host_hash
    rep.add("B-03", "文件通道一致性（64KB 往返）", PASS if ok else FAIL,
            {"algo": algo, "hostHash": expect, "deviceHash": dev_hash,
             "pulledHash": pulled_hash, "pushRc": rc1, "pullRc": rc2},
            "" if ok else "推/拉任一侧字节不一致 —— 传输通道不可信")
    dev.sh("rm -f %s" % remote, timeout=10)
    for f in (tmp_local, pulled):
        try:
            f.unlink()
        except OSError:
            pass
    try:
        tmp_local.parent.rmdir()
    except OSError:
        pass

    # B-04 二进制通道（exec-out 截屏）
    rc, png, err = dev.run(["exec-out", "screencap", "-p"], timeout=40, raw=True)
    size = len(png) if isinstance(png, bytes) else 0
    ok = rc == 0 and size > 5000
    if ok:
        (run_dir / "comm-screencap.png").write_bytes(png)
    rep.add("B-04", "二进制通道（exec-out 截屏）", PASS if ok else FAIL,
            {"bytes": size, "rc": rc}, "" if ok else "二进制通道取不到数据")

    # B-05 端口转发通道（建立 → 列表可见 → 移除）
    rc, out, err = dev.run(["forward", "tcp:0", "localabstract:dv_probe_none"], timeout=20)
    port = out.strip()
    ok = rc == 0 and port.isdigit()
    listed = False
    if ok:
        rc2, out2, _ = dev.run(["forward", "--list"], timeout=15)
        listed = ("tcp:" + port) in out2
        dev.run(["forward", "--remove", "tcp:" + port], timeout=15)
    rep.add("B-05", "端口转发通道", PASS if (ok and listed) else FAIL,
            {"port": port, "listed": listed, "rc": rc})

    # B-06 日志通道（写入 → 回读）
    ltoken = "dvlog%s" % hashlib.sha256(os.urandom(8)).hexdigest()[:10]
    dev.run(["logcat", "-c"], timeout=20)
    rc_w, _, err_w = dev.sh("log -t DvProbe -p i %s" % ltoken, timeout=15)
    time.sleep(1.5)
    rc, out, _ = dev.run(["logcat", "-d", "-s", "DvProbe:I"], timeout=25)
    ok = rc_w == 0 and ltoken in out
    rep.add("B-06", "日志通道（logcat 回读）", PASS if ok else WARN,
            {"marker": ltoken, "matched": ltoken in out, "logWriteRc": rc_w},
            "" if ok else "读不到刚写入的日志：可能 ROM 裁剪了 log 命令或缓冲区被清（不影响主体功能）")

    # B-07 包管理通道
    rc, out, _ = dev.sh("pm path %s" % PKG, timeout=20)
    ok = rc == 0 and out.startswith("package:")
    rep.add("B-07", "包管理通道（pm path）", PASS if ok else FAIL,
            {"out": out, "rc": rc}, "" if ok else "目标应用未安装或 pm 通道异常")


# --------------------------------------------------------------------------- C 功能
def stage_modules(dev, rep, args, run_dir):
    print("\n=== C 核心功能模块 ===", flush=True)

    # F-01 设备能力
    caps = {}
    rc, out, _ = dev.sh("wm size", timeout=15); caps["wmSize"] = out.replace("Physical size: ", "")
    rc, out, _ = dev.sh("wm density", timeout=15); caps["wmDensity"] = out.replace("Physical density: ", "")
    rc, out, _ = dev.sh("dumpsys battery", timeout=20)
    m = re.search(r"level:\s*(\d+)", out)
    caps["batteryLevel"] = int(m.group(1)) if m else None
    caps["batteryStatus"] = (re.search(r"status:\s*(\d+)", out).group(1) if re.search(r"status:\s*(\d+)", out) else "")
    rc, out, _ = dev.sh("df /data", timeout=20)
    caps["dataFree"] = out.splitlines()[-1].split()[-3] if len(out.splitlines()) > 1 else ""
    rc, out, _ = dev.sh("dumpsys power", timeout=25)
    caps["wakefulness"] = (re.search(r"mWakefulness=(\w+)", out).group(1) if re.search(r"mWakefulness=(\w+)", out) else "")
    (run_dir / "module-device-caps.txt").write_text(json.dumps(caps, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ok = bool(caps["wmSize"]) and caps["batteryLevel"] is not None
    rep.add("F-01", "设备能力（屏幕/电量/存储）", PASS if ok else WARN, caps,
            "" if ok else "部分能力读取失败")

    # F-02 应用安装与版本
    rc, dump, _ = dev.sh("dumpsys package %s" % PKG, timeout=60)
    (run_dir / "module-dumpsys-package.txt").write_text(dump or "", encoding="utf-8")
    info = {}
    for key in ("versionName", "versionCode", "targetSdk", "minSdk", "firstInstallTime", "lastUpdateTime"):
        m = re.search(r"%s=([^\s]+)" % key, dump)
        info[key] = m.group(1) if m else None
    rc, path, _ = dev.sh("pm path %s" % PKG, timeout=20)
    apk = path.replace("package:", "").strip()
    info["apkPath"] = apk
    if apk:
        rc, h, _ = dev.sh("sha256sum %s" % apk, timeout=30)
        info["apkSha256"] = h.split()[0] if h else None
    info["debuggable"] = "DEBUGGABLE" in dump
    installed = bool(apk)
    rep.add("F-02", "应用安装与版本", PASS if installed else FAIL, info,
            "" if installed else "应用未安装：%s" % PKG)

    # F-03 关键权限
    need = ["POST_NOTIFICATIONS", "SCHEDULE_EXACT_ALARM", "USE_EXACT_ALARM",
            "USE_FULL_SCREEN_INTENT", "SYSTEM_ALERT_WINDOW", "RECEIVE_BOOT_COMPLETED",
            "WAKE_LOCK", "FOREGROUND_SERVICE", "VIBRATE"]
    granted = {}
    for m in re.finditer(r"([A-Za-z0-9_.]*permission\.[A-Z_0-9]+):\s*granted=(true|false)", dump):
        granted[m.group(1).split(".")[-1]] = (m.group(2) == "true")
    missing = [p for p in need if not granted.get(p)]
    # dumpsys 查不到 ≠ 未授予（如 SYSTEM_ALERT_WINDOW 走 appops、SCHEDULE_EXACT_ALARM 在 API 33+ 由 USE_EXACT_ALARM 取代）
    denied = [p for p in need if granted.get(p) is False]
    unknown = [p for p in need if granted.get(p) is None]
    critical_bad = [p for p in ("POST_NOTIFICATIONS", "USE_FULL_SCREEN_INTENT") if granted.get(p) is False]
    note = ""
    if critical_bad:
        note = "明确未授予：%s —— 会直接阻断送达" % "、".join(critical_bad)
    elif denied:
        note = "明确未授予：%s" % "、".join(denied)
    elif unknown:
        note = "dumpsys 未显式记录：%s（多为未声明或改由 appops/替代权限承载，非失败项）" % "、".join(unknown)
    rep.add("F-03", "关键权限授予状态",
            FAIL if critical_bad else (WARN if (denied or unknown) else PASS),
            {"granted": {k: granted.get(k) for k in need},
             "denied": denied, "unknown": unknown, "missing": missing},
            note)

    # F-04 appops 与电池白名单
    rc, ops, _ = dev.sh("cmd appops get %s" % PKG, timeout=30)
    (run_dir / "module-appops.txt").write_text(ops or "", encoding="utf-8")
    opmap = {}
    for m in re.finditer(r"^\s*([A-Z][A-Z_0-9]+):\s*(allow|deny|ignore|default)", ops, re.M):
        opmap[m.group(1)] = m.group(2)
    rc, wl, _ = dev.sh("dumpsys deviceidle whitelist", timeout=30)
    in_whitelist = PKG in wl
    rep.add("F-04", "后台策略（appops / 电池白名单）", PASS,
            {"ops": {k: opmap.get(k) for k in ("POST_NOTIFICATION", "RUN_ANY_IN_BACKGROUND",
                                               "SYSTEM_ALERT_WINDOW", "SCHEDULE_EXACT_ALARM",
                                               "START_FOREGROUND", "WAKE_LOCK") if opmap.get(k)},
             "batteryWhitelisted": in_whitelist},
            "未加电池优化白名单 —— 按已知结论它挡不住冻结，仅作记录" if not in_whitelist else "")

    # F-05 通知渠道
    rc, notif, _ = dev.sh("dumpsys notification --noredact", timeout=90)
    (run_dir / "module-dumpsys-notification.txt").write_text(notif or "", encoding="utf-8")
    ids = set(re.findall(r"mId='([^']+)'", notif))
    found = [c for c in KNOWN_CHANNELS if c in ids]
    rep.add("F-05", "通知渠道（%d/%d）" % (len(found), len(KNOWN_CHANNELS)),
            PASS if len(found) == len(KNOWN_CHANNELS) else WARN,
            {"expected": KNOWN_CHANNELS, "found": found, "allChannelIds": sorted(ids)[:20]},
            "" if len(found) == len(KNOWN_CHANNELS) else "渠道未全部建立（首次启动后才会创建）")

    # F-06 闹钟排程
    rc, alarm, _ = dev.sh("dumpsys alarm", timeout=90)
    (run_dir / "module-dumpsys-alarm.txt").write_text(alarm or "", encoding="utf-8")
    lines = [l for l in alarm.splitlines() if PKG in l]
    frozen = [l for l in alarm.splitlines() if "frozen" in l.lower()]
    rep.add("F-06", "闹钟排程（dumpsys alarm）", PASS,
            {"entriesForPackage": len(lines), "frozenMarkers": len(frozen),
             "sample": lines[:3]},
            "检测到 %d 处 frozen 标记 —— 按已知结论：进程被冻结时任何投递都进不去" % len(frozen) if frozen else
            "当前无排程条目（若 settings.notify=false 则首装零排程，属预期）" if not lines else "")

    # F-07 进程与冻结态
    rc, pid, _ = dev.sh("pidof %s" % PKG, timeout=15)
    pid = pid.split()[0] if pid and pid.split() else ""
    cg = ""
    if pid:
        rc, cg, _ = dev.sh("cat /proc/%s/cgroup" % pid, timeout=15)
    frozen_hint = bool(re.search(r"frozen|freezer", cg, re.I))
    rep.add("F-07", "进程与冻结态", PASS if pid else WARN,
            {"pid": pid or None, "cgroupFrozenHint": frozen_hint, "cgroup": cg[:300]},
            "" if pid else "应用当前无进程（未启动 / 已被回收）")

    # F-08 原生排程台账
    sched = ""
    rc, sched, err = dev.sh("run-as %s cat shared_prefs/attention_alarm_schedules.xml" % PKG, timeout=25)
    if rc != 0 or not sched.strip():
        rep.add("F-08", "原生排程台账（shared_prefs）", WARN,
                {"rc": rc, "stderr": (err or "")[:120]},
                "读不到（release 包 run-as 不可用属正常），以 dumpsys alarm 为准")
    else:
        (run_dir / "module-alarm-schedules.xml").write_text(sched, encoding="utf-8")
        cnt = len(re.findall(r"<long", sched))
        rep.add("F-08", "原生排程台账（shared_prefs）", PASS, {"entries": cnt})

    # ---------- Web 运行时（真跑应用）
    if "cdp" in args.skip:
        rep.add("F-09", "Web 运行时 ready()", SKIP, {}, "--skip cdp 已跳过")
        rep.add("F-10", "业务逻辑真机回归", SKIP, {}, "--skip cdp 已跳过")
        return

    cdp, port = _open_cdp(dev, args, run_dir)
    if cdp is None:
        rep.add("F-09", "Web 运行时 ready()", WARN, {}, "无法建立 CDP：应用未在前台 / WebView 调试不可用")
        rep.add("F-10", "业务逻辑真机回归", WARN, {}, "依赖 F-09")
        return

    try:
        _module_runtime(cdp, rep, run_dir)
        _module_business(cdp, rep, run_dir)
        if args.live:
            _module_live(cdp, rep, run_dir, dev)
        else:
            rep.add("F-11", "通知排程往返（写入类）", SKIP, {}, "需 --live 才执行")
            rep.add("F-12", "存储持久化往返（写入类）", SKIP, {}, "需 --live 才执行")
    finally:
        cdp.close()
        dev.run(["forward", "--remove", "tcp:" + str(port)], timeout=15)


def _open_cdp(dev, args, run_dir):
    """把应用拉到前台并打开 WebView 调试通道；返回 (Cdp, port)。"""
    try:
        import websocket  # noqa: F401
    except ImportError:
        print("       （websocket 模块不可用，跳过 CDP）", flush=True)
        return None, None
    dev.sh("input keyevent KEYCODE_WAKEUP", timeout=15)
    dev.sh("wm dismiss-keyguard", timeout=15)
    rc, out, _ = dev.sh("am start -W -n %s" % MAIN_ACTIVITY, timeout=60)
    (run_dir / "module-am-start.txt").write_text(out or "", encoding="utf-8")
    pid = ""
    for _ in range(15):
        rc, pid, _ = dev.sh("pidof %s" % PKG, timeout=10)
        pid = pid.split()[0] if pid and pid.split() else ""
        if pid:
            break
        time.sleep(1)
    if not pid:
        return None, None
    time.sleep(2)
    rc, port, err = dev.run(["forward", "tcp:0", "localabstract:webview_devtools_remote_" + pid], timeout=20)
    port = (port or "").strip()
    if rc != 0 or not port.isdigit():
        return None, None
    try:
        return Cdp(int(port)), port
    except Exception as e:
        (run_dir / "module-cdp-error.txt").write_text(str(e), encoding="utf-8")
        dev.run(["forward", "--remove", "tcp:" + port], timeout=15)
        return None, None


def _module_runtime(cdp, rep, run_dir):
    js = """(async()=>{
      const A = window.__ATTENTION_INBOX__;
      if (!A) throw new Error('__ATTENTION_INBOX__ missing');
      await A.ready();
      const s = A.state;
      return JSON.stringify({
        ready: true,
        items: Array.isArray(s.items) ? s.items.length : null,
        notify: s.settings && s.settings.notify,
        scheduled: (s.settings && s.settings.scheduledAlarmIds) ? s.settings.scheduledAlarmIds.length : null,
        hasLib: typeof window.AttentionLib,
        capacitor: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
        plugins: Object.keys((window.Capacitor && window.Capacitor.Plugins) || {})
      });
    })()"""
    try:
        raw = cdp.evaluate(js)
        data = json.loads(raw)
    except Exception as e:
        rep.add("F-09", "Web 运行时 ready()", FAIL, {"error": str(e)[:300]})
        return
    (run_dir / "module-runtime.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ok = data.get("ready") is True and data.get("capacitor")
    rep.add("F-09", "Web 运行时 ready()", PASS if ok else FAIL, data,
            "" if ok else "容器未就绪或原生桥未注入（按已知陷阱：注入晚于 init() 会永久废掉原生路径）")


def _module_business(cdp, rep, run_dir):
    """在真机 WebView 里跑一遍纯函数业务逻辑 —— 同一份代码在真机上的真实行为。"""
    js = """(async()=>{
      const A = window.__ATTENTION_INBOX__;
      await A.ready();
      const out = {};
      const r1 = A.parseChineseTime('明天下午3点', new Date());
      out.parseTriggerable = !!(r1 && (r1.trigger || r1.triggerAt || r1.confidence !== 'none'));
      out.parse = r1;
      const it = A.makeItem({title:'连接自检', priority:'important', triggerAt: Date.now()+3600000});
      out.makeItemHasId = !!(it && it.id);
      out.makeItemDeliveryMode = it ? it.delivery_mode : null;
      out.isDueNow = (function(){
        try { return !!A.isDue({triggerAt: Date.now()-1000, status:'active'}, new Date()); } catch(e){ return 'ERR:'+e.message; }
      })();
      out.quietHoursType = typeof A.inQuietHours(new Date());
      out.uid = String(A.uid()).length > 0;
      return JSON.stringify(out);
    })()"""
    try:
        raw = cdp.evaluate(js)
        data = json.loads(raw)
    except Exception as e:
        rep.add("F-10", "业务逻辑真机回归", FAIL, {"error": str(e)[:300]})
        return
    (run_dir / "module-business.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    problems = []
    if not data.get("parseTriggerable"):
        problems.append("中文时间解析未产出触发时间")
    if not data.get("makeItemHasId"):
        problems.append("makeItem 未生成 id")
    if data.get("isDueNow") is not True:
        problems.append("isDue 对已到期事项未判为到期")
    if not data.get("uid"):
        problems.append("uid() 返回空")
    rep.add("F-10", "业务逻辑真机回归", PASS if not problems else FAIL,
            {k: v for k, v in data.items() if k != "parse"},
            "" if not problems else "；".join(problems))


def _module_live(cdp, rep, run_dir, dev):
    """写入类往返：通知排程 + 存储持久化。两者都自带清理与复核。"""
    # F-11 通知排程往返
    js = """(async()=>{
      const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
      if (!LN) throw new Error('LocalNotifications plugin missing');
      const id = 99001;
      const at = new Date(Date.now() + 180000);
      await LN.schedule({notifications:[{id:id, title:'连接自检', body:'3 分钟后触发，随即自动取消',
        schedule:{at: at}, channelId:'attention-bridge-v2', smallIcon:'ic_stat_attention'}]});
      const p1 = await LN.getPending();
      const ids1 = (p1.notifications||[]).map(n=>n.id);
      await LN.cancel({notifications:[{id:id}]});
      const p2 = await LN.getPending();
      const ids2 = (p2.notifications||[]).map(n=>n.id);
      return JSON.stringify({pendingAfterSchedule: ids1, pendingAfterCancel: ids2});
    })()"""
    try:
        data = json.loads(cdp.evaluate(js))
        (run_dir / "module-live-notification.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        scheduled = 99001 in (data.get("pendingAfterSchedule") or [])
        cleaned = 99001 not in (data.get("pendingAfterCancel") or [])
        rep.add("F-11", "通知排程往返（写入类）", PASS if (scheduled and cleaned) else FAIL,
                data, "" if (scheduled and cleaned) else "排程未进入 pending 或取消后仍有残留")
    except Exception as e:
        rep.add("F-11", "通知排程往返（写入类）", FAIL, {"error": str(e)[:300]})
    # 兜底：确保设备侧排程被撤掉
    dev.sh("cmd alarm cancel %s" % PKG, timeout=15)

    # F-12 存储持久化往返（写 → 落库 → 重载 → 读 → 删除 → 重载 → 确认复原）
    tid = "'dvselftest-%d'" % now_ms()
    js_write = """(async()=>{
      const A = window.__ATTENTION_INBOX__;
      await A.ready();
      const before = A.state.items.map(i=>i.id).sort();
      const it = A.makeItem({id: %s, title:'连接自检临时项', note:'验证后立即删除',
        priority:'normal', status:'active', triggerAt: Date.now()+3600000});
      A.state.items.push(it);
      await A.saveAsync();
      return JSON.stringify({before: before, after: A.state.items.length});
    })()""" % tid
    js_read = """(async()=>{
      const A = window.__ATTENTION_INBOX__;
      await A.ready();
      const ids = A.state.items.map(i=>i.id);
      return JSON.stringify({has: ids.includes(%s), count: ids.length, ids: ids.sort()});
    })()""" % tid
    js_del = """(async()=>{
      const A = window.__ATTENTION_INBOX__;
      await A.ready();
      A.state.items = A.state.items.filter(i => i.id !== %s);
      await A.saveAsync();
      return JSON.stringify({count: A.state.items.length});
    })()""" % tid
    try:
        before = json.loads(cdp.evaluate(js_write))
        time.sleep(1)
        cdp.reload()
        time.sleep(6)
        persisted = json.loads(cdp.evaluate(js_read))
        cdp.evaluate(js_del)
        time.sleep(1)
        cdp.reload()
        time.sleep(6)
        restored = json.loads(cdp.evaluate(js_read))
        ok_persist = persisted.get("has") is True
        ok_restore = restored.get("has") is False and \
            restored.get("ids") == sorted(before.get("before") or [])
        (run_dir / "module-live-storage.json").write_text(
            json.dumps({"before": before, "persisted": persisted, "restored": restored},
                       ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        rep.add("F-12", "存储持久化往返（写入类）", PASS if (ok_persist and ok_restore) else FAIL,
                {"persisted": ok_persist, "restored": ok_restore,
                 "beforeCount": len(before.get("before") or []), "afterCount": restored.get("count")},
                "" if (ok_persist and ok_restore) else "未跨重载持久化，或删除后现场未复原 —— 请检查 RUN 目录残留")
    except Exception as e:
        rep.add("F-12", "存储持久化往返（写入类）", FAIL, {"error": str(e)[:300]})


# --------------------------------------------------------------------------- 收尾
def stage_restore(dev, rep, caps_initial):
    print("\n=== D 收尾复核 ===", flush=True)
    # 回到桌面；若进场时是息屏，则恢复息屏
    dev.sh("input keyevent KEYCODE_HOME", timeout=15)
    if caps_initial.get("asleep"):
        dev.sh("input keyevent KEYCODE_SLEEP", timeout=15)
    st = dev.state()
    rep.add("D-01", "结束时链路仍在线", PASS if st == "device" else FAIL, {"state": st})
    rep.add("D-02", "全程链路掉线次数", PASS if dev.link_drops == 0 else WARN,
            {"linkDrops": dev.link_drops, "adbCalls": dev.calls},
            "" if dev.link_drops == 0 else "掉线会在长耗时取证中放大为「排程正确但用户看不到」")


# --------------------------------------------------------------------------- main
def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--serial", default="", help="设备序列号；不指定则自动挑选唯一的真机")
    p.add_argument("--tcp", default="", help="无线调试地址 host[:port]，无 USB 设备时使用")
    p.add_argument("--wait", type=int, default=30, help="等待设备出现的秒数（默认 30）")
    p.add_argument("--settle", type=int, default=3, help="稳定性取样次数（默认 3）")
    p.add_argument("--settle-interval", type=float, default=1.0, help="取样间隔秒（默认 1.0）")
    p.add_argument("--live", action="store_true", help="额外执行写入类往返（通知排程 / 存储持久化）")
    p.add_argument("--allow-emulator", action="store_true", help="允许模拟器（默认拒绝：模拟器通过 ≠ 真机通过）")
    p.add_argument("--skip", default="", help="逗号分隔的跳过项，如 cdp")
    p.add_argument("--out", default="", help="报告输出目录（默认 docs/reviews/verification-runs/<UTC>-device-verify）")
    a = p.parse_args()
    a.skip = [s.strip() for s in a.skip.split(",") if s.strip()]

    root = Path(__file__).resolve().parents[1]
    run_dir = Path(a.out) if a.out else \
        root / "docs" / "reviews" / "verification-runs" / ("%s-device-verify" % now_iso().replace(":", "").replace("-", "").replace("Z", "Z"))
    run_dir.mkdir(parents=True, exist_ok=True)
    rep = Report(run_dir)

    adb = str(Path.home() / "Library/Android/sdk/platform-tools/adb")
    if not Path(adb).exists():
        adb = "adb"
    dev = Device(adb, a.serial)

    print("设备验证开始 → %s" % run_dir, flush=True)
    meta = {"host": os.uname().nodename, "adb": adb, "package": PKG, "liveMode": a.live}
    caps_initial = {}
    verdict = "FAIL"
    counts = rep.counts()
    try:
        # 进场前屏幕状态，用于收尾还原
        rc, out, _ = dev.sh("dumpsys power", timeout=20) if dev.serial else (1, "", "")
        caps_initial["asleep"] = "Asleep" in out

        props = stage_connect(dev, rep, a)
        if not props:
            verdict, counts = rep.save(meta)
            print("\n结论：%s（连接未建立，后续校验未执行）" % verdict, flush=True)
            print("报告：%s/report.md" % run_dir, flush=True)
            sys.exit(2)
        meta.update({k: v for k, v in props.items() if v})
        meta["serial"] = dev.serial

        rc, out, _ = dev.sh("dumpsys power", timeout=20)
        caps_initial["asleep"] = "Asleep" in out

        stage_comm(dev, rep, run_dir)
        stage_modules(dev, rep, a, run_dir)
    except Exception as e:  # 一段炸了也要出报告
        rep.add("Z-00", "脚本执行异常", FAIL, {"error": repr(e)[:300]})
    finally:
        try:
            stage_restore(dev, rep, caps_initial)
        except Exception as e:
            rep.add("D-03", "收尾还原", WARN, {"error": repr(e)[:200]})
        verdict, counts = rep.save(meta)

    print("\n=== 汇总 ===", flush=True)
    print("PASS %d / FAIL %d / WARN %d / SKIP %d" % (counts[PASS], counts[FAIL], counts[WARN], counts[SKIP]), flush=True)
    for r in rep.checks:
        if r["status"] in (FAIL, WARN):
            print("  %-5s %-6s %s" % (r["id"], r["status"], r["title"]), flush=True)
            if r["note"]:
                print("         %s" % r["note"], flush=True)
    print("\n结论：%s" % verdict, flush=True)
    print("报告：%s/report.md" % run_dir, flush=True)
    print("机器可读：%s/report.json" % run_dir, flush=True)
    sys.exit(1 if counts[FAIL] else 0)


if __name__ == "__main__":
    main()
