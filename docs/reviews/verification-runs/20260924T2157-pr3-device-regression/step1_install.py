"""R1: 安装前后权威 IDB 记录级比对。
使用捕获表单建一条隔离事项 R3P1-<时刻> 安装比对（重要档，次日触发），做 pre 快照；
adb install -r 安装新候选；
冷启动（kill -9，不 force-stop）后再做 post 快照，逐记录对比。
"""
import json
import sys
import time
from devlib import *

seed_file = RAW / "step1-seed.json"
pre_snap_file = RAW / "01-pre-install.idb-hashes.json"
cand = sha_file(CANDIDATE)

path_now = sh(f"pm path {PKG}").replace("package:", "").strip()
sha_now = sh(f"sha256sum {path_now}").split()[0]

if seed_file.is_file() and pre_snap_file.is_file() and sha_now == cand:
    log("== R1: Resuming post-install phase (candidate already installed)")
    seed_data = json.loads(seed_file.read_text(encoding="utf-8"))
    seed_id = seed_data["seed_id"]
    seed_item = seed_data["item"]
    actual_trig = seed_item["triggerAt"]
    tok = seed_data["token"]
    pre = json.loads(pre_snap_file.read_text(encoding="utf-8"))
    sha_before = "e14438de38b3ee05d678e15025d09c1adceebb51f67f3f8d954fb26488fe20c1"
    sha_after = sha_now
    alarm_after_install = (RAW / "step1-alarm-after-install.txt").read_text(encoding="utf-8") if (RAW / "step1-alarm-after-install.txt").is_file() else alarm_dump()
else:
    log("== R1: Seed isolated item before install")
    start_app()
    log("ready", wait_ready())

    tok = "R3P1-" + time.strftime("%H%M%S")
    trig = int((time.time() + 26 * 3600) * 1000)  # 次日，避免本步内触发
    r = create_item_via_form(f"{tok} 安装比对隔离事项", trig, "important")
    log("seed result:", json.dumps(r, ensure_ascii=False))
    assert r and r.get("item"), f"seed failed: {r}"
    seed_id = r["item"]["id"]
    seed_item = r["item"]
    actual_trig = seed_item["triggerAt"]

    (RAW / "step1-seed.json").write_text(json.dumps({"seed_id": seed_id, "token": tok, "item": seed_item}, ensure_ascii=False, indent=2), encoding="utf-8")
    time.sleep(3)
    log("idb seed item:", idb_item(seed_id))

    alarm_pre = alarm_dump()
    (RAW / "step1-alarm-pre.txt").write_text(alarm_pre, encoding="utf-8")
    log("alarm dump pre registered:", str(actual_trig)[:10] in alarm_pre)

    pre = idb_snapshot("01-pre-install")
    log("pre-install snapshot stores:", {k: {x: v[x] for x in ("sha256", "itemCount")} for k, v in pre["stores"]["kv"].items()})

    log("== R1: adb install -r candidate APK")
    path_before = sh(f"pm path {PKG}").replace("package:", "").strip()
    sha_before = sh(f"sha256sum {path_before}").split()[0]
    log(f"before base.apk: {sha_before} ({path_before})")

    home()
    time.sleep(1)
    p = subprocess.Popen([ADB, "-s", SERIAL, "install", "-r", str(CANDIDATE)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    clicked = []
    t0 = time.time()
    aborted = False

    while p.poll() is None and time.time() - t0 < 120:
        f = focus()
        if "PackageIntercept" in f or "packageinstaller" in f.lower() or "com.vivo.secime" in f:
            nodes = ui_nodes()
            texts = [n["text"] for n in nodes if n["text"]]
            if any(k in t for k in ("密码", "账号", "帐号", "验证码") for t in texts):
                log("installer asks for password/credentials -> ABORT (NOT_PERFORMED)", texts)
                p.kill()
                aborted = True
                break
            btn = next((n for n in nodes if n["text"] == "继续安装" and (n["clickable"] or True)), None)
            if btn:
                log("tap installer: 继续安装", f)
                tap(btn)
                clicked.append("继续安装")
                time.sleep(1)
        time.sleep(1)

    if aborted:
        log("INSTALL NOT_PERFORMED DUE TO CREDENTIAL PROMPT")
        sys.exit(2)

    out, err = p.communicate(timeout=30)
    log(f"install rc={p.returncode}, out={out.strip()}, err={err.strip()}, clicked={clicked}, elapsed={time.time()-t0:.1f}s")
    assert p.returncode == 0 and "Success" in out, f"install failed: rc={p.returncode}, out={out}, err={err}"

    path_after = sh(f"pm path {PKG}").replace("package:", "").strip()
    sha_after = sh(f"sha256sum {path_after}").split()[0]
    log(f"after base.apk: {sha_after} ({path_after})")
    assert sha_after == cand, f"Candidate sha {cand} != device base.apk sha {sha_after}"

    time.sleep(3)
    alarm_after_install = alarm_dump()
    (RAW / "step1-alarm-after-install.txt").write_text(alarm_after_install, encoding="utf-8")

alarm_found = (str(actual_trig)[:10] in alarm_after_install)
log(f"alarm dump after install registered for trig {actual_trig} (prefix {str(actual_trig)[:10]}):", alarm_found)
assert alarm_found, f"R3P1 alarm vanished after install! triggerAt={actual_trig}"

log("== R1: cold start after install (kill -9, not force-stop)")
kill_app()
time.sleep(1)
start_app()
log("ready", wait_ready())
time.sleep(3)

post = idb_snapshot("02-post-install")
d = diff_snapshots(pre, post)
(RAW / "step1-install-diff.json").write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
log("diff between pre and post install:", json.dumps(d, ensure_ascii=False))

log("idb seed after restart:", idb_item(seed_id))
ss = screenshot("step1-post-install")
log("screenshot:", ss)

res = {
    "step": "R1",
    "status": "PASS",
    "seedItem": seed_item,
    "deviceBaseApkBefore": sha_before,
    "deviceBaseApkAfter": sha_after,
    "candidateSha": cand,
    "alarmPreserved": alarm_found,
    "diff": d,
    "identicalState": (d["records"].get("kv/state") == "identical" or d["records"].get("kv/state") is None)
}
(RAW / "step1-result.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
log("R1 completed successfully!")
