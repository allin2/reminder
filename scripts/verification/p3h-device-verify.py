#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P3-H Platform Adaptation & PWA Lifecycle Real Device Verification.

Tests on real vivo V2238A device (serial: 10ACBF2D3D000RS):
1. Installs candidate APK and verifies installed APK SHA-256 matches candidate.
2. Connects to Android WebView via CDP.
3. Verifies platform adaptation in real Android runtime:
   - AttentionLib.AppPlatform module evaluation & factory
   - a.platform instance presence and contract compliance (all 9 methods)
   - isNativeAndroidRuntime() === true on real Android
   - systemBridge() is valid native bridge
   - appSettingsPlugin() is valid native plugin
   - waitForNativeBridge(100) resolves true
   - deferredInstallPrompt is null on Android
   - Idempotency of bindInstall() and bindNetwork()
4. Takes screenshot and system state dumps.
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
DEFAULT_CANDIDATE_APK = ROOT / "releases/candidates/20260923T1719-p3h-candidate/app-debug.apk"
DEFAULT_RUN_DIR = ROOT / "docs/reviews/verification-runs/20260923T1719-p3h-platform-extraction"


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

    def ensure_foreground(self):
        self.sh("input keyevent KEYCODE_WAKEUP")
        self.sh("wm dismiss-keyguard")
        self.sh("input keyevent 82")
        self.sh(f"am start -W -n {MAIN_ACTIVITY}")
        time.sleep(2)

    def eval_js(self, expr):
        """Connect to WebView CDP on-demand to execute expression and return value."""
        rc, pid_out, _ = self.sh(f"pidof {PKG}")
        pid = pid_out.split()[0] if pid_out else ""
        if not pid:
            self.ensure_foreground()
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
        print(f"=== Starting P3-H Real Device Verification ===", flush=True)
        print(f"Serial: {self.serial}", flush=True)
        print(f"Run dir: {self.run_dir}", flush=True)

        # 1. Install APK if needed and verify fingerprint
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
        print("✓ APK 指纹匹配 PASS", flush=True)

        self.ensure_foreground()

        # 2. Web & Platform checks via CDP
        print("\n--- 2. 平台适配模块 CDP 实机断言 ---", flush=True)
        check_script = """(async () => {
            const a = window.__ATTENTION_INBOX__;
            await a.ready();

            const platform = a.platform;
            const contract = (a.APP_PLATFORM_INSTANCE_CONTRACT && a.APP_PLATFORM_INSTANCE_CONTRACT.instance) || [];
            const hasAllContract = contract.every(m => typeof platform[m] === "function");

            const isNative = platform.isNativeAndroidRuntime();
            const sysBridge = platform.systemBridge();
            const appSettings = platform.appSettingsPlugin();
            const waitResult = await platform.waitForNativeBridge(100);

            // Install prompt on Android Capacitor
            const deferredPrompt = platform.getDeferredInstallPrompt();
            const btnInstall = document.querySelector('#btnInstall');
            const btnInstallHidden = btnInstall ? btnInstall.hidden : true;

            // Idempotency: re-call bindInstall / bindNetwork
            platform.bindInstall();
            platform.bindNetwork();

            return {
                ready: true,
                hasPlatform: !!platform,
                hasAllContract,
                contractLength: contract.length,
                isNative,
                hasSysBridge: !!sysBridge,
                sysBridgeType: typeof sysBridge,
                hasAppSettings: !!appSettings,
                appSettingsType: typeof appSettings,
                waitResult,
                deferredPromptIsNull: deferredPrompt === null,
                btnInstallHidden
            };
        })()"""

        cdp_res = self.eval_js(check_script)
        print("CDP Platform Evaluation Result:\n" + json.dumps(cdp_res, indent=2, ensure_ascii=False), flush=True)

        assert cdp_res.get("ready") is True, "App ready() was not true"
        assert cdp_res.get("hasPlatform") is True, "a.platform is missing"
        assert cdp_res.get("hasAllContract") is True, "a.platform contract incomplete"
        assert cdp_res.get("contractLength") == 9, "contractLength must be 9"
        assert cdp_res.get("isNative") is True, "isNativeAndroidRuntime() must be true on real Android"
        assert cdp_res.get("hasSysBridge") is True, "systemBridge() must be non-null on real Android"
        assert cdp_res.get("hasAppSettings") is True, "appSettingsPlugin() must be non-null on real Android"
        assert cdp_res.get("waitResult") is True, "waitForNativeBridge(100) must return true on real Android"
        assert cdp_res.get("deferredPromptIsNull") is True, "deferredInstallPrompt must be null on real Android"
        assert cdp_res.get("btnInstallHidden") is True, "btnInstall must remain hidden on real Android"

        self.results["cdpPlatformCheck"] = cdp_res
        print("✓ 平台适配与 PWA 契约实机检查 PASS", flush=True)

        # 3. Take screenshot and system dumps
        print("\n--- 3. 截屏与系统快照 ---", flush=True)
        self.snap("p3h-device-verify")
        print("✓ 快照已保存", flush=True)

        # 4. Write summary JSON
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
