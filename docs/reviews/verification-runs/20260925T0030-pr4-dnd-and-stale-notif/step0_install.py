"""PR4 阶段 0：基线记录与候选包安装。
1. 记录安装前设备上 base.apk 哈希、用户现有事项 ID 集合及全部设置（尤其 dnd/quietStart/quietEnd/review）；
2. 取 00-pre-install IDB 快照；
3. adb install -r 安装 PR4 候选包；
4. 确认安装后 base.apk 等于候选包哈希；
5. kill -9 后冷启动，取 01-post-install 快照，对比并确认用户事项 100% 相同。
"""
import json
import sys
import time
from devlib import *

log("== STEP 0: Baseline recording before install")
start_app()
log("ready", wait_ready())

# Check baseline items
user_items = cdp_eval("(()=>{const items=__ATTENTION_INBOX__.state.items||[]; return items.map(x=>({id:x.id, title:x.title, status:x.status, priority:x.priority, triggerAt:x.triggerAt||null, hasRFX: /RFX/.test(x.title)}));})()")
rfx_leftover = [x for x in user_items if x["hasRFX"]]
if rfx_leftover:
    log("WARNING: Found leftover RFX items before test start:", rfx_leftover)

settings_before = cdp_eval("""(() => {
  const s = __ATTENTION_INBOX__.state.settings || {};
  return {
    dnd: s.dnd,
    quietStart: s.quietStart,
    quietEnd: s.quietEnd,
    review: JSON.parse(JSON.stringify(s.review || {})),
    setupPromptStarted: s.setupPromptStarted
  };
})()""")
log(f"Baseline settings: {json.dumps(settings_before, ensure_ascii=False)}")
log(f"Baseline user item count: {len(user_items)}")

# Base APK hash before
base_path_before = sh(f"pm path {PKG}").replace("package:", "").strip()
sha_before = sh(f"sha256sum {base_path_before}").split()[0]
cand_sha = sha_file(CANDIDATE)
log(f"Device base.apk before: {sha_before} ({base_path_before})")
log(f"Candidate APK:          {cand_sha} ({CANDIDATE})")

# Take pre-install snapshot
pre_snap = idb_snapshot("00-pre-install")
log("00-pre-install snapshot taken. Stores:", list(pre_snap["stores"].keys()))

baseline_info = {
    "gitBranch": "fix/remove-stale-delivered-notifications",
    "gitHead": "c8f4f8f2cb4a05642d7a2d96e7633d4bb1d76baf",
    "deviceSerial": SERIAL,
    "deviceBaseApkBefore": sha_before,
    "candidateApk": cand_sha,
    "userItemCount": len(user_items),
    "userItemIds": [x["id"] for x in user_items],
    "settingsBefore": settings_before
}
(RAW / "step0-baseline.json").write_text(json.dumps(baseline_info, ensure_ascii=False, indent=2), encoding="utf-8")

log("== Installing PR4 candidate APK (-r)")
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
            log("installer asks for credentials -> ABORT (NOT_PERFORMED)", texts)
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

base_path_after = sh(f"pm path {PKG}").replace("package:", "").strip()
sha_after = sh(f"sha256sum {base_path_after}").split()[0]
log(f"Device base.apk after:  {sha_after} ({base_path_after})")
assert sha_after == cand_sha, f"Device base.apk sha {sha_after} != candidate sha {cand_sha}"

log("== Cold start after install (kill -9, not force-stop)")
kill_app()
time.sleep(1)
start_app()
log("ready", wait_ready())
time.sleep(3)

post_snap = idb_snapshot("01-post-install")
diff_res = diff_snapshots(pre_snap, post_snap)
(RAW / "step0-install-diff.json").write_text(json.dumps(diff_res, ensure_ascii=False, indent=2), encoding="utf-8")
log("Install diff:", json.dumps(diff_res, ensure_ascii=False))

# Verify items identical
a_state = raw_state("00-pre-install")["kv/state"]
b_state = raw_state("01-post-install")["kv/state"]
items_before = [x["id"] for x in a_state.get("items", [])]
items_after = [x["id"] for x in b_state.get("items", [])]
log(f"Items before: {items_before}, Items after: {items_after}")
assert items_before == items_after, f"Items mismatch after install: {items_before} vs {items_after}"

ss = screenshot("step0-post-install")
log("Post-install screenshot:", ss)
log("STEP 0 completed successfully: PASS")
