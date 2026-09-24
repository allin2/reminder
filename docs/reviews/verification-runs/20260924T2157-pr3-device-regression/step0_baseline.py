"""PR3 真机回归：测试前基线记录。
记录用户现有事项数量与 ID 集合、setupPromptStarted 初始值、当前 base.apk 哈希、包闹钟基线，以及 00-baseline 快照。
"""
import json
import sys
from devlib import *

log("== STEP 0: Baseline recording before touching anything")
start_app()
log("ready", wait_ready())

# Check baseline items
user_items = cdp_eval("(()=>{const items=__ATTENTION_INBOX__.state.items||[]; return items.map(x=>({id:x.id, status:x.status, priority:x.priority, triggerAt:x.triggerAt||null, hasR3: /^R3/.test(x.title)}));})()")
r3_items_existing = [x for x in user_items if x["hasR3"]]
if r3_items_existing:
    log("WARNING: Found leftover R3 items before test start:", r3_items_existing)

setupPromptStarted_before = cdp_eval("!!(__ATTENTION_INBOX__.state.settings && __ATTENTION_INBOX__.state.settings.setupPromptStarted)")
log(f"Baseline user item count: {len(user_items)}, setupPromptStarted: {setupPromptStarted_before}")

# Base APK hash on device
base_path = sh(f"pm path {PKG}").replace("package:", "").strip()
device_base_apk_sha = sh(f"sha256sum {base_path}").split()[0]
cand_sha = sha_file(CANDIDATE)
log(f"Device base.apk: {device_base_apk_sha} ({base_path})")
log(f"Candidate APK:   {cand_sha} ({CANDIDATE})")

# Dumpsys alarm baseline
alarms_baseline = alarm_dump()
(RAW / "step0-alarms-baseline.txt").write_text(alarms_baseline, encoding="utf-8")

# Take baseline snapshot
snap = idb_snapshot("00-baseline")
log("00-baseline snapshot taken. Stores:", list(snap["stores"].keys()))

baseline_data = {
    "gitHead": "98fef249c55c49a9ff5b6fdd1bc5b8d861f7a99c",
    "deviceSerial": SERIAL,
    "deviceBaseApkBefore": device_base_apk_sha,
    "candidateApk": cand_sha,
    "userItemCount": len(user_items),
    "userItemIds": [x["id"] for x in user_items],
    "setupPromptStartedBefore": setupPromptStarted_before,
    "alarmDumpLines": len(alarms_baseline.splitlines())
}
(RAW / "step0-baseline.json").write_text(json.dumps(baseline_data, ensure_ascii=False, indent=2), encoding="utf-8")
log("Baseline recorded successfully to step0-baseline.json")
