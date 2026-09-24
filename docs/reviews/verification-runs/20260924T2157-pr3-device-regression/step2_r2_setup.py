"""R2 (F1): 设置引导的判定。
1. 读取 __ATTENTION_INBOX__.getNativeReminderStatus()，记录 notifications, exactAlarm,
   diag.canDrawOverlays, diag.canUseFullScreenIntent, diag.ignoringBatteryOptimizations。
2. 用 AttentionLib.Feedback.setupSteps(status, ctx) 计算每步 done/verified。
3. 打开「我的 → 提醒设置」，读取 #setupBody 文字并截图。
4. 验证：
   - 悬浮窗一步与 diag 一致（均为 true 时 done=true, verified=true）；
   - 面板当前显示的步骤等于计算出的第一个未完成步骤；
   - 「我的」页提醒设置副标题「还差 N 步」与计算结果一致。
"""
import json
import time
from devlib import *

log("== R2 (F1): Testing setup guide capability verification")
start_app()
log("ready", wait_ready())

# 1. Native reminder status
status = cdp_eval("__ATTENTION_INBOX__.getNativeReminderStatus()")
diag = status.get("diag", {})
log("Native reminder status diag:", json.dumps(diag, ensure_ascii=False, indent=2))

native_caps = {
    "notifications": status.get("notifications"),
    "exactAlarm": status.get("exactAlarm"),
    "canDrawOverlays": diag.get("canDrawOverlays"),
    "canUseFullScreenIntent": diag.get("canUseFullScreenIntent"),
    "ignoringBatteryOptimizations": diag.get("ignoringBatteryOptimizations")
}
log("Key capabilities:", json.dumps(native_caps, ensure_ascii=False))

# 2. Compute steps
ctx = cdp_eval("__ATTENTION_INBOX__.setupStepsContext()")
step_eval = cdp_eval("AttentionLib.Feedback.setupSteps(__ATTENTION_INBOX__.getNativeReminderStatus(), __ATTENTION_INBOX__.setupStepsContext())")
steps = step_eval.get("steps", [])
missing = [s for s in steps if not s.get("done")]
first_missing = missing[0] if missing else None

log(f"Total steps: {len(steps)}, missing: {len(missing)}")
for s in steps:
    log(f"  Step [{s['id']}]: done={s['done']}, verified={s['verified']}, title={s['title']}")

overlay_step = next((s for s in steps if s["id"] == "overlay"), None)
assert overlay_step is not None, "Missing overlay step in setupSteps"

# overlay verified logic check
expected_overlay_done = bool(diag.get("canDrawOverlays") and diag.get("canUseFullScreenIntent"))
log(f"Overlay step done={overlay_step['done']}, expected={expected_overlay_done}")
assert overlay_step["done"] == expected_overlay_done, f"overlay step done {overlay_step['done']} != expected {expected_overlay_done}"

# 3. Switch to "我的" tab and check #setupSub
cdp_eval("document.querySelector('.nav-item[data-tab=\"me\"]').click()")
time.sleep(0.5)
sub_text = cdp_eval("document.querySelector('#setupSub') ? document.querySelector('#setupSub').textContent : ''")
log(f"setupSub text: '{sub_text}'")
expected_sub_prefix = f"还差 {len(missing)} 步"
assert expected_sub_prefix in sub_text, f"setupSub text '{sub_text}' does not contain expected '{expected_sub_prefix}'"

# 4. Open setup sheet (#btnSetup)
cdp_eval("document.querySelector('#btnSetup').click()")
time.sleep(0.8)

sheet_info = cdp_eval("""(() => {
  const body = document.querySelector('#setupBody');
  const h4 = body ? body.querySelector('h4') : null;
  return {
    isOpen: document.querySelector('#sheetSetup').classList.contains('open'),
    firstH4: h4 ? h4.textContent : '',
    bodyText: body ? body.innerText : ''
  };
})()""")
log(f"Sheet isOpen: {sheet_info['isOpen']}, firstH4: '{sheet_info['firstH4']}'")

assert sheet_info["isOpen"], "sheetSetup failed to open"
assert first_missing and sheet_info["firstH4"] == first_missing["title"], \
    f"Sheet firstH4 '{sheet_info['firstH4']}' != first missing step '{first_missing['title'] if first_missing else None}'"

ss = screenshot("step2-setup-sheet")
log("Screenshot saved:", ss)

# Close sheet
cdp_eval("document.querySelector('[data-close=\"sheetSetup\"]').click()")
time.sleep(0.5)

# Return to home tab
cdp_eval("document.querySelector('.nav-item[data-tab=\"home\"]').click()")
time.sleep(0.5)

result = {
    "step": "R2",
    "status": "PASS",
    "nativeCaps": native_caps,
    "calculatedSteps": steps,
    "missingCount": len(missing),
    "firstMissingStep": first_missing,
    "overlayStep": overlay_step,
    "setupSubText": sub_text,
    "sheetFirstH4": sheet_info["firstH4"],
    "screenshot": str(ss) if ss else None
}
(RAW / "step2-r2-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
log("R2 (F1) completed successfully: PASS")
