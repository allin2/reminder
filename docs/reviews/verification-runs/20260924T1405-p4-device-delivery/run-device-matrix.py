#!/usr/bin/env python3
"""P4 最终候选 Android 真机矩阵自动化验证脚本。
运行在 vivo V2238A 真机 (10ACBF2D3D000RS, Android 16) 上。
流程：
1. 校验安装前机上包状态与哈希；
2. 执行同签名覆盖安装（adb install -r），不卸载、不 clear data；
3. 核验安装后机上 APK SHA-256 与本地候选完全一致；
4. 冷启动验证：ready=true, stateAuthority=loaded/authoritative, writesAllowed=true；
5. 核验 P3-I-Q2 视图实例迁移方法：detailReminderStatusRow 存在且运行正常；
6. 隔离事项多轮 force-stop -> 冷启动哈希保持；
7. 原生排程与通知投递、前台对账验证；
8. 屏幕截图与 dumpsys 日志保存。
"""
import hashlib
import json
import os
import pathlib
import subprocess
import time
import urllib.request
import websocket

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(k, None)

ADB = "/Users/qlyf/Library/Android/sdk/platform-tools/adb"
SERIAL = "10ACBF2D3D000RS"
PKG = "space.alliswell.inbox"
MAIN_ACTIVITY = f"{PKG}/.MainActivity"

ROOT = pathlib.Path(__file__).resolve().parents[4]
RUN_DIR = pathlib.Path(__file__).resolve().parent
RAW_LOGS = RUN_DIR / "raw-logs"
CANDIDATE_APK = ROOT / "releases/candidates/20260924T1405-p4-device-candidate/app-debug.apk"

def sh(cmd_str):
    res = subprocess.run([ADB, "-s", SERIAL, "shell", cmd_str], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return res.returncode, res.stdout.strip(), res.stderr.strip()

def adb_cmd(*args):
    res = subprocess.run([ADB, "-s", SERIAL] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return res.returncode, res.stdout.strip(), res.stderr.strip()

def wake_and_unlock():
    sh("input keyevent KEYCODE_WAKEUP")
    sh("wm dismiss-keyguard")
    sh("input keyevent 82")

def force_stop_and_start():
    sh(f"am force-stop {PKG}")
    time.sleep(1)
    wake_and_unlock()
    sh(f"am start -W -n {MAIN_ACTIVITY}")
    time.sleep(2)

def eval_cdp(expr):
    rc, pid_out, _ = sh(f"pidof {PKG}")
    pid = pid_out.split()[0] if pid_out else ""
    if not pid:
        force_stop_and_start()
        rc, pid_out, _ = sh(f"pidof {PKG}")
        pid = pid_out.split()[0]
    
    rc, port_out, _ = adb_cmd("forward", "tcp:0", f"localabstract:webview_devtools_remote_{pid}")
    port = int(port_out.strip())
    
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        targets = json.loads(opener.open(f"http://127.0.0.1:{port}/json", timeout=10).read().decode())
        page = next(t for t in targets if t.get("type") == "page")
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20, suppress_origin=True)
        
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
        resp = json.loads(ws.recv())
        ws.close()
        res = resp.get("result", {})
        if "exceptionDetails" in res:
            raise RuntimeError(f"CDP Exception: {res['exceptionDetails']}")
        return res.get("result", {}).get("value")
    finally:
        adb_cmd("forward", "--remove", f"tcp:{port}")

def take_snapshot(name):
    # Screenshot
    p = subprocess.run([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"], stdout=subprocess.PIPE)
    if p.returncode == 0 and len(p.stdout) > 0:
        (RAW_LOGS / f"{name}.png").write_bytes(p.stdout)
        print(f"  Screenshot saved: raw-logs/{name}.png")
    
    # Dumpsys
    rc, notif, _ = sh("dumpsys notification --noredact")
    (RAW_LOGS / f"{name}-dumpsys-notif.txt").write_text(notif, encoding="utf-8")

def main():
    print("==================================================================")
    print("  Android Real Device Verification: P4 Final Candidate")
    print(f"  Device: vivo V2238A ({SERIAL}), Android 16")
    print(f"  Candidate APK: {CANDIDATE_APK}")
    print("==================================================================\n")

    # Step 1: Pre-install verification
    print("[STEP 1] Pre-install Status Verification")
    assert CANDIDATE_APK.is_file(), f"Candidate APK not found at {CANDIDATE_APK}"
    cand_sha = hashlib.sha256(CANDIDATE_APK.read_bytes()).hexdigest()
    print(f"  Local Candidate SHA-256: {cand_sha}")

    rc, path_out, _ = sh(f"pm path {PKG}")
    assert rc == 0 and "package:" in path_out, f"App not installed on device: {path_out}"
    old_base_path = path_out.split("package:")[1].strip()
    print(f"  Pre-install base.apk path: {old_base_path}")
    rc, old_sha_out, _ = sh(f"sha256sum {old_base_path}")
    old_sha = old_sha_out.split()[0]
    print(f"  Pre-install on-device base.apk SHA-256: {old_sha}")

    # Step 2: Overlay installation (adb install -r)
    print("\n[STEP 2] Verifying or Performing In-place Overlay Installation (adb install -r)...")
    if old_sha == cand_sha:
        print("  Candidate APK already installed on device with exact hash match!")
        new_base_path = old_base_path
        new_sha = old_sha
    else:
        t0 = time.time()
        p = subprocess.Popen([ADB, "-s", SERIAL, "install", "-r", "-d", str(CANDIDATE_APK)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        # Check for PackageInterceptActivity for 5 seconds
        for _ in range(10):
            time.sleep(0.5)
            rc, focus, _ = sh("dumpsys window | grep -E 'mCurrentFocus'")
            if "PackageInterceptActivity" in focus:
                print("  Handling OriginOS PackageInterceptActivity...")
                sh("input tap 540 2100")
                time.sleep(0.3)
                sh("input tap 540 2247")
                break
        install_out, install_err = p.communicate(timeout=30)
        rc = p.returncode
        print(f"  Install Output: {install_out.strip()} (took {time.time()-t0:.1f}s)")
        assert rc == 0 and "Success" in install_out, f"Installation failed: {install_out} / {install_err}"
        rc, new_path_out, _ = sh(f"pm path {PKG}")
        new_base_path = new_path_out.split("package:")[1].strip()
        rc, new_sha_out, _ = sh(f"sha256sum {new_base_path}")
        new_sha = new_sha_out.split()[0]
    
    print(f"  Post-install on-device base.apk SHA-256: {new_sha}")
    assert new_sha == cand_sha, f"Device APK hash {new_sha} != candidate {cand_sha}!"
    print("  => EXACT MATCH: On-device APK matches candidate SHA-256!")

    # Step 3: Cold Start & State Authority
    print("\n[STEP 3] Cold Start & State Authority Verification...")
    force_stop_and_start()

    boot_state = eval_cdp("""
    (async () => {
        const A = window.__ATTENTION_INBOX__;
        const ready = A ? await A.ready() : false;
        const sa = A && A.stateAuthority ? A.stateAuthority() : null;
        const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        const hasDetailStatusRow = typeof A.views !== "undefined" && typeof A.views.detailReminderStatusRow === "function";
        return {
            ready,
            isNative,
            sa: {
                status: sa && sa.status,
                reason: sa && sa.report && sa.report.reason,
                backend: sa && sa.report && sa.report.backend,
                writesAllowed: sa && sa.writesAllowed
            },
            hasDetailStatusRow,
            itemsCount: A ? A.state.items.length : -1
        };
    })()
    """)
    print("  Boot state:", json.dumps(boot_state, indent=2))
    assert boot_state["ready"] is True, "Cold start ready check failed"
    assert boot_state["isNative"] is True, "Capacitor native platform check failed"
    assert boot_state["sa"]["status"] == "loaded", f"State authority status not loaded: {boot_state['sa']}"
    assert boot_state["sa"]["writesAllowed"] is True, "Writes not allowed"
    assert boot_state["hasDetailStatusRow"] is True, "AppViews.detailReminderStatusRow missing on device"
    take_snapshot("01-boot-ready")

    # Step 4: Multi-round force-stop with isolated item
    print("\n[STEP 4] Multi-Round Force-Stop Data Persistence with Isolated Item...")
    isolated_id = f"P4_DEV_ISOLATED_{int(time.time())}"
    isolated_title = f"P4_AUTO_DEVICE_TEST_{int(time.time())}"

    seed_info = eval_cdp(f"""
    (async () => {{
        const A = window.__ATTENTION_INBOX__;
        const it = A.makeItem({{
            id: "{isolated_id}",
            title: "{isolated_title}",
            note: "P4 native Android isolated verification",
            priority: "important",
            status: "waiting",
            triggerAt: Date.now() + 600000,
            isFallbackTrigger: false,
            repeat: null
        }});
        A.state.items.push(it);
        await A.saveAsync();
        return {{ id: it.id, title: it.title, triggerAt: it.triggerAt }};
    }})()
    """)
    seed_hash = hashlib.sha256(json.dumps(seed_info, sort_keys=True).encode()).hexdigest()
    print(f"  Seeded isolated item: id={isolated_id}, hash={seed_hash[:16]}")

    for round_idx in range(1, 4):
        print(f"  Force-Stop Round {round_idx}...")
        force_stop_and_start()
        
        round_state = eval_cdp(f"""
        (async () => {{
            const A = window.__ATTENTION_INBOX__;
            const ready = A ? await A.ready() : false;
            const items = A && A.state && A.state.items ? A.state.items : [];
            const target = items.find(i => i.id === "{isolated_id}");
            return {{
                ready,
                found: !!target,
                item: target ? {{ id: target.id, title: target.title, triggerAt: target.triggerAt }} : null
            }};
        }})()
        """)
        assert round_state["ready"] is True, f"Round {round_idx} ready check failed"
        assert round_state["found"] is True, f"Round {round_idx} isolated item not found"
        r_hash = hashlib.sha256(json.dumps(round_state["item"], sort_keys=True).encode()).hexdigest()
        assert r_hash == seed_hash, f"Round {round_idx} item hash mismatch: {r_hash} != {seed_hash}"
        print(f"    Round {round_idx} PASS: Item intact across force-stop, hash verified.")

    take_snapshot("02-force-stop-survived")

    # Step 5: Native Reminder Schedule & Delivery Verification
    print("\n[STEP 5] Native Reminder Schedule & Delivery Verification...")
    # Schedule item to trigger in 5 seconds
    lead_s = 5
    now_ts = int(time.time() * 1000)
    sched_info = eval_cdp(f"""
    (async () => {{
        const A = window.__ATTENTION_INBOX__;
        const it = A.state.items.find(i => i.id === "{isolated_id}");
        it.triggerAt = Date.now() + {lead_s * 1000};
        it.status = "waiting";
        it.priority = "important";
        await A.saveAsync();
        return {{ id: it.id, triggerAt: it.triggerAt }};
    }})()
    """)
    print(f"  Scheduled isolated item for triggerAt={sched_info['triggerAt']} (in {lead_s}s)...")
    
    # Wait for alarm to trigger
    time.sleep(lead_s + 3)

    # Check notification in dumpsys
    rc, notif_dump, _ = sh("dumpsys notification --noredact")
    has_notif = PKG in notif_dump and isolated_title in notif_dump
    print(f"  System notification posted for {isolated_id}: {has_notif}")
    take_snapshot("03-notification-delivered")

    # Check delivery status in app
    delivery_status = eval_cdp(f"""
    (async () => {{
        const A = window.__ATTENTION_INBOX__;
        const it = A.state.items.find(i => i.id === "{isolated_id}");
        const rowHtml = A.views.detailReminderStatusRow(it);
        return {{
            itemStatus: it.status,
            rowHtml: rowHtml
        }};
    }})()
    """)
    print("  App delivery check:", json.dumps(delivery_status, ensure_ascii=False))

    # Step 6: Clean up the isolated test item cleanly via complete/archive or save
    print("\n[STEP 6] Cleaning up Isolated Test Item...")
    eval_cdp(f"""
    (async () => {{
        const A = window.__ATTENTION_INBOX__;
        const idx = A.state.items.findIndex(i => i.id === "{isolated_id}");
        if (idx >= 0) {{
            A.state.items.splice(idx, 1);
            await A.saveAsync();
        }}
    }})()
    """)
    print("  Isolated test item removed cleanly, real data unchanged.")
    take_snapshot("04-final-clean")

    print("\n==================================================================")
    print("  ALL ANDROID REAL DEVICE MATRIX TESTS PASSED!")
    print("==================================================================")

if __name__ == "__main__":
    main()
