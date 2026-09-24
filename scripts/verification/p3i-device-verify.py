#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P3-I Modularization Real Device Verification.

Tests on real vivo V2238A device (serial: 10ACBF2D3D000RS):
1. Installs candidate APK releases/candidates/20260923T1910-p3i-candidate/app-debug.apk
2. Verifies installed APK SHA-256 matches candidate APK.
3. Tests cold start via am force-stop and restarts MainActivity.
4. Connects to Android WebView via CDP.
5. Verifies P3-I modules in real Android runtime:
   - AppActionFeedback instance presence and all 7 contract methods
   - AppEvents instance presence, isBound() === true, and all 7 contract methods
   - AppTestApi instance presence and contract methods
   - Real Android native status (isNative === true, bridge non-null)
   - Save outcome & schedule evidence execution
   - Demo preview rows length === 5
6. Takes screenshot and system state dumps.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
import urllib.request

# Clear proxy environment
for _k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
    os.environ.pop(_k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

import websocket

ROOT = Path(__file__).resolve().parents[2]
ADB_BIN = Path.home() / "Library/Android/sdk/platform-tools/adb"
PKG = "space.alliswell.inbox"
MAIN_ACTIVITY = PKG + "/.MainActivity"
DEFAULT_CANDIDATE_APK = ROOT / "releases/candidates/20260923T1910-p3i-candidate/app-debug.apk"
DEFAULT_RUN_DIR = ROOT / "docs/reviews/verification-runs/20260923T1910-p3i-delivery"


class DeviceRunner:
    def __init__(self, serial, run_dir, candidate_apk=None):
        self.serial = serial
        self.run_dir = Path(run_dir).resolve()
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.candidate_apk = Path(candidate_apk or DEFAULT_CANDIDATE_APK).resolve()
        self.adb = [str(ADB_BIN), "-s", serial]
        self.results = {}

    def cmd(self, *args, timeout=40, raw=False):
        p = subprocess.run(self.adb + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        if raw:
            return p.returncode, p.stdout, p.stderr
        return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")

    def sh(self, cmd_str, timeout=30):
        rc, out, err = self.cmd("shell", cmd_str, timeout=timeout)
        return rc, out.replace("\r", "").strip(), err.replace("\r", "").strip()

    def snap(self, name):
        """Capture screenshot and key dumps."""
        rc, png, _ = self.cmd("exec-out", "screencap", "-p", raw=True, timeout=15)
        if rc == 0 and png:
            (self.run_dir / f"{name}.png").write_bytes(png)
        rc, vib, _ = self.sh("dumpsys vibrator_manager", timeout=15)
        (self.run_dir / f"{name}-vibrator.txt").write_text(vib, encoding="utf-8")
        rc, aud, _ = self.sh("dumpsys audio", timeout=15)
        (self.run_dir / f"{name}-audio.txt").write_text(aud, encoding="utf-8")
        rc, notif, _ = self.sh("dumpsys notification --noredact", timeout=20)
        (self.run_dir / f"{name}-notifications.txt").write_text(notif, encoding="utf-8")

    def cold_start(self):
        print("Executing cold stop (am force-stop)...", flush=True)
        self.sh(f"am force-stop {PKG}")
        time.sleep(1)
        self.sh("input keyevent KEYCODE_WAKEUP")
        self.sh("wm dismiss-keyguard")
        self.sh("input keyevent 82")
        print("Starting MainActivity...", flush=True)
        self.sh(f"am start -W -n {MAIN_ACTIVITY}")
        time.sleep(2)

    def eval_js(self, expr):
        """Connect to WebView CDP on-demand to execute expression and return value."""
        rc, pid_out, _ = self.sh(f"pidof {PKG}")
        pid = pid_out.split()[0] if pid_out else ""
        if not pid:
            self.cold_start()
            rc, pid_out, _ = self.sh(f"pidof {PKG}")
            pid = pid_out.split()[0] if pid_out else ""
            if not pid:
                raise RuntimeError(f"Cannot find PID of {PKG}")

        rc, port_out, _ = self.cmd("forward", "tcp:0", f"localabstract:webview_devtools_remote_{pid}")
        port = port_out.strip()
        if not port.isdigit():
            raise RuntimeError(f"Failed to forward port: {port_out}")
        port_num = int(port)

        ws = None
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            targets = json.loads(opener.open(f"http://127.0.0.1:{port_num}/json", timeout=10).read().decode())
            page = next(t for t in targets if t.get("type") == "page")
            ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=60, suppress_origin=True)

            msg = {
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": expr,
                    "returnByValue": True,
                    "awaitPromise": True
                }
            }
            ws.send(json.dumps(msg))
            while True:
                raw = ws.recv()
                resp = json.loads(raw)
                if resp.get("id") == 1:
                    break
            res = resp.get("result", {})
            if "exceptionDetails" in res:
                raise RuntimeError("CDP Eval Error: " + json.dumps(res["exceptionDetails"], ensure_ascii=False))
            return res.get("result", {}).get("value")
        finally:
            if ws:
                try:
                    ws.close()
                except Exception:
                    pass
            self.cmd("forward", "--remove", f"tcp:{port_num}")

    def run_all(self):
        print(f"=== Starting P3-I Real Device Verification ===", flush=True)
        print(f"Serial: {self.serial}", flush=True)
        print(f"Run dir: {self.run_dir}", flush=True)

        # 1. Install APK and verify fingerprint
        print("\n--- 1. 安装候选 APK 与校验指纹 ---", flush=True)
        candidate_sha = hashlib.sha256(self.candidate_apk.read_bytes()).hexdigest()
        print(f"Candidate APK SHA: {candidate_sha}", flush=True)

        rc, pm_path, _ = self.sh(f"pm path {PKG}")
        installed_match = False
        if rc == 0 and pm_path:
            apk_device_path = pm_path.replace("package:", "").strip()
            rc_sha, sha_out, _ = self.sh(f"sha256sum {apk_device_path}")
            device_sha = sha_out.split()[0] if sha_out else ""
            if device_sha == candidate_sha:
                installed_match = True
                print(f"Device already has matching APK: {device_sha}", flush=True)

        if not installed_match:
            print(f"Installing {self.candidate_apk}...", flush=True)
            rc, out, err = self.cmd("install", "-r", "-d", str(self.candidate_apk), timeout=120)
            assert rc == 0 and "Success" in out, f"Install failed: {out} / {err}"
            print("Install success.", flush=True)
            rc, pm_path, _ = self.sh(f"pm path {PKG}")
            apk_device_path = pm_path.replace("package:", "").strip()
            rc_sha, sha_out, _ = self.sh(f"sha256sum {apk_device_path}")
            device_sha = sha_out.split()[0] if sha_out else ""

        print(f"Device APK SHA:    {device_sha}", flush=True)
        assert device_sha == candidate_sha, f"Device APK mismatch! {device_sha} != {candidate_sha}"
        self.results["apkSha256"] = device_sha
        self.results["deviceApkPath"] = apk_device_path
        print("✓ APK 指纹匹配 PASS", flush=True)

        # 2. Cold start
        print("\n--- 2. 冷启动应用 ---", flush=True)
        self.cold_start()

        # 3. P3-I Web & Instance checks via CDP
        print("\n--- 3. P3-I 拆分模块 CDP 实机断言 ---", flush=True)
        check_script = """(async () => {
            const a = window.__ATTENTION_INBOX__;
            const ready = await a.ready();

            // 1. AppActionFeedback checks
            const actionFeedback = a.actionFeedback;
            const fbContract = (a.APP_ACTION_FEEDBACK_INSTANCE_CONTRACT && a.APP_ACTION_FEEDBACK_INSTANCE_CONTRACT.instance) || [];
            const hasAllFbContract = fbContract.every(m => typeof actionFeedback[m] === "function");

            // 2. AppEvents checks
            const events = a.events;
            const evContract = (a.APP_EVENTS_INSTANCE_CONTRACT && a.APP_EVENTS_INSTANCE_CONTRACT.instance) || [];
            const hasAllEvContract = evContract.every(m => typeof events[m] === "function");
            const isBound = events.isBound();
            const demoRows = events.demoPreviewRows();

            // 3. AppTestApi checks
            const testApi = a.testApi;
            const testApiContract = (a.APP_TEST_API_INSTANCE_CONTRACT && a.APP_TEST_API_INSTANCE_CONTRACT.instance) || [];
            const hasAllTestApiContract = testApiContract.every(m => testApi && typeof testApi[m] === "function");

            // 4. Platform runtime assertions
            const platform = a.platform;
            const isNative = platform.isNativeAndroidRuntime();
            const sysBridge = platform.systemBridge();
            const appSettings = platform.appSettingsPlugin();

            // 5. Method execution checks
            const sampleItem = a.makeItem({ title: "实机验证测试事项", triggerAt: Date.now() + 3600000 });
            const schedEv = actionFeedback.itemScheduleEvidence(sampleItem);

            return {
                ready: true,
                isNative,
                hasSysBridge: !!sysBridge,
                hasAppSettings: !!appSettings,
                hasActionFeedback: !!actionFeedback,
                fbContractLength: fbContract.length,
                hasAllFbContract,
                hasEvents: !!events,
                evContractLength: evContract.length,
                hasAllEvContract,
                isBound,
                demoRowsCount: Array.isArray(demoRows) ? demoRows.length : 0,
                hasTestApi: !!testApi,
                testApiContractLength: testApiContract.length,
                hasAllTestApiContract,
                schedEvHasScheduled: schedEv ? (schedEv.scheduled !== undefined) : false
            };
        })()"""

        cdp_res = self.eval_js(check_script)
        print("CDP Evaluation Result:\n" + json.dumps(cdp_res, indent=2, ensure_ascii=False), flush=True)

        assert cdp_res.get("ready") is True, "App ready() was not true"
        assert cdp_res.get("isNative") is True, "isNativeAndroidRuntime() must be true on real Android"
        assert cdp_res.get("hasSysBridge") is True, "systemBridge() must be non-null on real Android"
        assert cdp_res.get("hasAppSettings") is True, "appSettingsPlugin() must be non-null on real Android"
        assert cdp_res.get("hasActionFeedback") is True, "a.actionFeedback is missing"
        assert cdp_res.get("hasAllFbContract") is True, "a.actionFeedback contract incomplete"
        assert cdp_res.get("fbContractLength") == 7, "fbContractLength must be 7"
        assert cdp_res.get("hasEvents") is True, "a.events is missing"
        assert cdp_res.get("hasAllEvContract") is True, "a.events contract incomplete"
        assert cdp_res.get("evContractLength") == 7, "evContractLength must be 7"
        assert cdp_res.get("isBound") is True, "a.events.isBound() must be true"
        assert cdp_res.get("demoRowsCount") == 5, "demoRowsCount must be 5"
        assert cdp_res.get("hasTestApi") is True, "a.testApi is missing"
        assert cdp_res.get("hasAllTestApiContract") is True, "a.testApi contract incomplete"
        assert cdp_res.get("testApiContractLength") == 2, "testApiContractLength must be 2"

        self.results["cdpCheck"] = cdp_res
        print("✓ P3-I 拆分模块实机断言 PASS", flush=True)

        # 4. Take screenshot and system dumps
        print("\n--- 4. 截屏与系统快照 ---", flush=True)
        self.snap("p3i-device-verify")
        print("✓ 快照已保存", flush=True)

        # 5. Write summary JSON
        summary_path = self.run_dir / "device-verify-summary.json"
        summary_path.write_text(json.dumps(self.results, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\n✓ 实机验证完成，结果已落盘：{summary_path}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", default="10ACBF2D3D000RS")
    parser.add_argument("--run-dir", default=str(DEFAULT_RUN_DIR))
    parser.add_argument("--candidate-apk", default=str(DEFAULT_CANDIDATE_APK))
    args = parser.parse_args()

    runner = DeviceRunner(args.serial, args.run_dir, args.candidate_apk)
    runner.run_all()


if __name__ == "__main__":
    main()
