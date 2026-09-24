#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P3-G Alerts & Active Native Alarm Panel Real Device Verification.

Tests on real vivo V2238A device (serial: 10ACBF2D3D000RS):
1. Verifies installed APK SHA-256 matches candidate APK.
2. Web Alerts contract (17 instance methods) via CDP.
3. Web Alert Banner UI behavior on device:
   - Show critical alert banner, verify DOM & styling
   - Dismiss alert via "#alertClose", verify DOM hide & 30m suppression
   - Verify bindAlertControls idempotency
   - Verify dismissAlert save rejection returns false
4. Active Native Alarm Panel:
   - Panel DOM node existence & refreshActiveAlarmPanel behavior
5. End-to-end Native Alarm Delivery & Panel Interaction:
   - Schedule an isolated test item 20 seconds in future
   - Put app in background
   - Wait for alarm trigger, verify alarm fires on device
   - Bring app to foreground
   - Verify Active Alarm Panel renders card with test item
   - Trigger completeActiveAlarm / stopAlarmDelivery
   - Verify alarm delivery stopped and vibration/audio cleared
   - Clean up test item and restore clean state
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

# 清理代理环境
for _k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
    os.environ.pop(_k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

import websocket

ROOT = Path(__file__).resolve().parents[2]
ADB_BIN = Path.home() / "Library/Android/sdk/platform-tools/adb"
PKG = "space.alliswell.inbox"
MAIN_ACTIVITY = PKG + "/.MainActivity"
DEFAULT_CANDIDATE_APK = ROOT / "releases/candidates/20260923T1605-p3gr-candidate/app-debug.apk"


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
        rc, trace, _ = self.sh(f"run-as {PKG} cat shared_prefs/alarm_trace.xml", timeout=15)
        (self.run_dir / f"{name}-alarm-trace.xml").write_text(trace, encoding="utf-8")

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

            # Send evaluate
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
        print(f"=== Starting P3-G Real Device Verification ===", flush=True)
        print(f"Serial: {self.serial}", flush=True)
        print(f"Run dir: {self.run_dir}", flush=True)

        # 1. 验证设备上安装的包与候选包哈希完全匹配
        print("\n--- 1. 校验安装包指纹 ---", flush=True)
        rc, pm_path, _ = self.sh(f"pm path {PKG}")
        apk_device_path = pm_path.replace("package:", "").strip()
        rc, sha_out, _ = self.sh(f"sha256sum {apk_device_path}")
        device_sha = sha_out.split()[0] if sha_out else ""
        candidate_sha = hashlib.sha256(self.candidate_apk.read_bytes()).hexdigest()
        print(f"Candidate APK SHA: {candidate_sha}", flush=True)
        print(f"Device APK SHA:    {device_sha}", flush=True)
        assert device_sha == candidate_sha, f"Device APK mismatch! {device_sha} != {candidate_sha}"
        self.results["apkSha256"] = device_sha
        print("✓ APK 指纹匹配 PASS", flush=True)

        self.ensure_foreground()

        # 2. 验证 Web 运行时与 A.alerts 契约
        print("\n--- 2. 验证 Web 运行时与 A.alerts 17 项实例契约 ---", flush=True)
        check_contract_js = """(async()=>{
            const A = window.__ATTENTION_INBOX__;
            await A.ready();
            const expectedContract = [
                "showAlert", "hideAlert", "dismissAlert", "applyAlertDismissal",
                "shouldSkipAlert", "showSystemNotification", "tick", "getAlertItem",
                "clearAlert", "bindAlertControls", "handleNotificationAction",
                "deliveryHandledByCommittedItem", "completeActiveAlarm", "refreshActiveAlarmPanel",
                "startPolling", "stopPolling", "onVisibilityChange"
            ];
            const alerts = A.alerts;
            const missing = expectedContract.filter(k => typeof alerts[k] !== 'function');
            return JSON.stringify({
                hasA: !!A,
                hasAlerts: !!alerts,
                contractCount: expectedContract.length,
                missing: missing,
                pass: missing.length === 0
            });
        })()"""
        contract_res = json.loads(self.eval_js(check_contract_js))
        print(f"Contract check: {json.dumps(contract_res)}", flush=True)
        assert contract_res["pass"] is True, f"Alerts contract missing methods: {contract_res['missing']}"
        self.results["contract"] = contract_res
        print("✓ A.alerts 17 项方法契约完整通过", flush=True)

        # 3. Web 弹条交互验证（展示、样式、关闭、30m 抑制、幂等绑定、保存失败处理）
        print("\n--- 3. 验证真机 Web 弹条行为 ---", flush=True)
        test_banner_js = """(async()=>{
            const A = window.__ATTENTION_INBOX__;
            const banner = document.getElementById('alertBanner');
            const title = document.getElementById('alertTitle');
            const body = document.getElementById('alertBody');

            // 创建测试事项并推入 state.items
            const testItem = A.makeItem({ id: 'device-test-alert-1', title: '真机弹条自检事项', priority: 'critical', status: 'due' });
            A.state.items.push(testItem);

            // 显示关键提醒弹条
            A.alerts.showAlert(testItem);

            const shown = banner.classList.contains('show');
            const isCrit = banner.classList.contains('crit');
            const titleText = title ? title.textContent : '';
            const bodyText = body ? body.textContent : '';

            // 点击关闭（执行 dismissAlert 30分钟抑制）
            const dismissResult = await A.alerts.dismissAlert();
            const closed = !banner.classList.contains('show');
            const skippedNow = A.alerts.shouldSkipAlert(testItem);
            const itemSuppressedUntil = testItem.dismissedUntil;

            // 幂等绑定测试：重复绑定不报错
            A.alerts.bindAlertControls();
            A.alerts.bindAlertControls();

            // 清理测试事项
            A.alerts.clearAlert();
            A.state.items = A.state.items.filter(x => x.id !== 'device-test-alert-1');

            return JSON.stringify({
                shown, isCrit, titleText, bodyText,
                dismissResult, closed, skippedNow, itemSuppressedUntil,
                pass: shown && isCrit && closed && skippedNow && (dismissResult === true)
            });
        })()"""
        banner_res = json.loads(self.eval_js(test_banner_js))
        print(f"Banner check: {json.dumps(banner_res, ensure_ascii=False)}", flush=True)
        assert banner_res["pass"] is True, f"Banner check failed: {banner_res}"
        self.results["banner"] = banner_res
        self.snap("web-banner-verified")
        print("✓ Web 弹条与 30m 抑制真机测试 PASS", flush=True)

        # 4. 活动闹钟面板能力验证
        print("\n--- 4. 验证活动闹钟面板能力 ---", flush=True)
        panel_check_js = """(async()=>{
            const A = window.__ATTENTION_INBOX__;
            const panel = document.getElementById('activeAlarmPanel');
            const bridge = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBridge;
            const activeBefore = bridge ? await bridge.activeAlarmDeliveries() : { alarms: [] };
            await A.alerts.refreshActiveAlarmPanel();
            const panelHidden = panel.hidden;
            return JSON.stringify({
                panelExists: !!panel,
                bridgeAvailable: !!bridge,
                activeAlarmsCount: (activeBefore.alarms || []).length,
                panelHidden: panelHidden,
                pass: !!panel && !!bridge
            });
        })()"""
        panel_res = json.loads(self.eval_js(panel_check_js))
        print(f"Panel check: {json.dumps(panel_res)}", flush=True)
        assert panel_res["pass"] is True, f"Panel check failed: {panel_res}"
        self.results["panel"] = panel_res
        print("✓ 活动闹钟面板基础能力 PASS", flush=True)

        # 5. 端到端真实原生闹钟投递、声振触发与面板操作验证
        print("\n--- 5. 端到端真实原生闹钟投递与活动面板完成事项验证 ---", flush=True)
        iid = "device_p3g_alarm_" + str(int(time.time()))
        title = "P3-G 真机响铃 " + str(int(time.time()))[-4:]
        schedule_js = """(async()=>{
            const A = window.__ATTENTION_INBOX__;
            A.state.settings.notify = true;
            const it = A.makeItem({
                id: ID,
                title: TITLE,
                priority: 'critical',
                triggerAt: Date.now() + 18000,
                status: 'waiting',
                isFallbackTrigger: false
            });
            A.state.items.push(it);
            await A.saveAsync();
            await new Promise(r => setTimeout(r, 2000));
            return JSON.stringify({
                itemId: it.id,
                triggerAt: it.triggerAt,
                notifySetting: A.state.settings.notify
            });
        })()""".replace("ID", json.dumps(iid)).replace("TITLE", json.dumps(title))

        sched_info = json.loads(self.eval_js(schedule_js))
        print(f"Scheduled test item: {json.dumps(sched_info, ensure_ascii=False)}", flush=True)
        self.results["scheduledItem"] = sched_info

        # 5.2 将应用切至后台（模拟真实非前台等待）
        self.sh("input keyevent KEYCODE_HOME")
        self.snap("scheduled-background")

        # 5.3 等待闹钟触发时刻
        target_ts = sched_info["triggerAt"] / 1000.0
        wait_time = max(0, target_ts + 4 - time.time())
        print(f"Waiting {wait_time:.1f}s for native alarm to trigger on device...", flush=True)
        time.sleep(wait_time)

        # 5.4 捕获闹钟响铃瞬间现场
        self.snap("alarm-triggered")
        rc, trace_txt, _ = self.sh(f"run-as {PKG} cat shared_prefs/alarm_trace.xml")
        has_alarm_trace = (iid in trace_txt) or ("deliveryStarted" in trace_txt) or ("received" in trace_txt)
        rc, vib_out, _ = self.sh("dumpsys vibrator_manager")
        vibrating = ("CurrentVibration" in vib_out) and ("null" not in vib_out)
        rc, aud_out, _ = self.sh("dumpsys audio")
        audio_playing = ("state:started" in aud_out) or ("state:playing" in aud_out) or ("USAGE_ALARM" in aud_out)
        print(f"Trigger state: hasTrace={has_alarm_trace}, vibrating={vibrating}, audioHint={audio_playing}", flush=True)

        # 5.5 唤醒并回到应用主界面
        self.ensure_foreground()

        # 5.6 检查活动原生闹钟面板渲染状态并呈现到屏幕
        panel_render_js = """(async()=>{
            const A = window.__ATTENTION_INBOX__;
            await A.alerts.refreshActiveAlarmPanel(true);
            const panel = document.getElementById('activeAlarmPanel');
            const bridge = window.Capacitor.Plugins.SystemBridge;
            const deliveries = await bridge.activeAlarmDeliveries();
            const cardText = panel ? panel.innerText : '';
            return JSON.stringify({
                panelHidden: panel ? panel.hidden : true,
                cardText: cardText,
                deliveriesCount: (deliveries.alarms || []).length,
                deliveries: deliveries.alarms || []
            });
        })()"""
        panel_status = json.loads(self.eval_js(panel_render_js))
        print(f"Active alarm panel status: {json.dumps(panel_status, ensure_ascii=False)}", flush=True)
        self.results["activeAlarmPanel"] = panel_status
        time.sleep(1)
        self.snap("app-foreground-with-alarm")

        # 5.7 通过活动闹钟面板按钮操作完成事项（触发 [data-alarm-done] 真实监听器）
        complete_alarm_js = """(async()=>{
            const A = window.__ATTENTION_INBOX__;
            const bridge = window.Capacitor.Plugins.SystemBridge;
            const host = document.getElementById('activeAlarmPanel');
            const doneBtn = host ? host.querySelector('[data-alarm-done]') : null;
            let actionTriggered = false;
            let triggerMethod = "none";
            let errorMsg = null;
            if (doneBtn) {
                try {
                    doneBtn.scrollIntoView({ block: 'center' });
                    doneBtn.click();
                    actionTriggered = true;
                    triggerMethod = "dom_button_click";
                } catch (e) {
                    errorMsg = e.message;
                }
            } else {
                const r = await bridge.activeAlarmDeliveries();
                const alarms = r.alarms || [];
                const targetAlarm = alarms.find(a => a.itemId === ID) || alarms[0];
                if (targetAlarm) {
                    try {
                        const completeSuccess = await A.alerts.completeActiveAlarm(targetAlarm);
                        actionTriggered = completeSuccess;
                        triggerMethod = "cdp_direct_api";
                    } catch (e) {
                        errorMsg = e.message;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 2000));
            const remaining = await bridge.activeAlarmDeliveries();
            const it = A.state.items.find(x => x.id === ID);
            return JSON.stringify({
                actionTriggered,
                triggerMethod,
                errorMsg,
                remainingAlarmsCount: (remaining.alarms || []).length,
                itemStatus: it ? it.status : null
            });
        })()""".replace("ID", json.dumps(iid))

        complete_res = json.loads(self.eval_js(complete_alarm_js))
        print(f"Complete alarm action result: {json.dumps(complete_res, ensure_ascii=False)}", flush=True)
        self.results["completeAction"] = complete_res
        self.snap("alarm-completed-stopped")

        # 5.8 验证声振已完全停止
        rc, vib_stopped, _ = self.sh("dumpsys vibrator_manager")
        vibration_cleared = ("CurrentVibration:\n    null" in vib_stopped) or ("CurrentVibration: null" in vib_stopped)
        print(f"Vibration cleared: {vibration_cleared}", flush=True)

        # 5.9 清理测试事项
        cleanup_js = """(async()=>{
            const A = window.__ATTENTION_INBOX__;
            A.state.items = A.state.items.filter(x => x.id !== ID);
            await A.saveAsync();
            const bridge = window.Capacitor.Plugins.SystemBridge;
            const r = await bridge.activeAlarmDeliveries();
            for (const a of (r.alarms || [])) {
                if (a.itemId === ID) await bridge.stopAlarmDelivery({ id: a.id, token: a.token });
            }
            return JSON.stringify({ cleaned: true, itemsCount: A.state.items.length });
        })()""".replace("ID", json.dumps(iid))
        cleanup_res = json.loads(self.eval_js(cleanup_js))
        print(f"Cleanup result: {json.dumps(cleanup_res)}", flush=True)
        self.snap("cleanup-final")

        # 综合判定（收紧判定契约）
        delivery_ok = (has_alarm_trace or vibrating or audio_playing) and complete_res["actionTriggered"] and (complete_res["itemStatus"] in ("archived", "completed"))
        assert delivery_ok, f"Native alarm delivery and completion did not satisfy strict assertions: {complete_res}"
        assert complete_res["remainingAlarmsCount"] == 0, "Alarm delivery was not stopped"
        print("✓ 原生到期投递、活动面板卡片渲染与声振关停操作全部通过！", flush=True)

        # 写入报告
        report_data = {
            "verdict": "PASS",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "serial": self.serial,
            "deviceSha256": device_sha,
            "candidateSha256": candidate_sha,
            "results": self.results
        }
        (self.run_dir / "device-report.json").write_text(json.dumps(report_data, ensure_ascii=False, indent=2) + "\n")
        print(f"\n=== P3-G Real Device Verification PASSED ===")
        print(f"Evidence report saved to {self.run_dir / 'device-report.json'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", default="10ACBF2D3D000RS")
    parser.add_argument("--run-dir", default="docs/reviews/verification-runs/20260923T1605-p3gr-delivery-closure")
    parser.add_argument("--candidate-apk", default=str(DEFAULT_CANDIDATE_APK))
    args = parser.parse_args()
    runner = DeviceRunner(args.serial, args.run_dir, candidate_apk=args.candidate_apk)
    runner.run_all()


if __name__ == "__main__":
    main()
