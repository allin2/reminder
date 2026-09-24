"""R3 补强：运行中把原生状态临时置回初始占位 unknown，经 onStatusChange 重绘后首页卡片应为空；
再恢复 granted，卡片应重新出现。最后杀进程冷启动，恢复真实状态（不写业务数据）。"""
from devlib import *
start_app(); wait_ready()
cdp_eval("__ATTENTION_INBOX__.closeAllSheets(); document.querySelector('[data-tab=home]').click(); true"); time.sleep(1)
before = cdp_eval("document.querySelector('#homeSetup').innerText")
after_unknown = cdp_eval("(async()=>{const A=__ATTENTION_INBOX__;A.setNativeReminderStatus({notifications:'unknown'});await new Promise(r=>setTimeout(r,300));return document.querySelector('#homeSetup').innerText})()")
after_granted = cdp_eval("(async()=>{const A=__ATTENTION_INBOX__;A.setNativeReminderStatus({notifications:'granted'});await new Promise(r=>setTimeout(r,300));return document.querySelector('#homeSetup').innerText})()")
res = {"before": before, "afterUnknown": after_unknown, "afterGranted": after_granted,
       "pass": bool(before) and after_unknown == "" and "还差" in (after_granted or "") and "允许发通知" not in (after_granted or "")}
log("R3 forced", json.dumps(res, ensure_ascii=False))
home(); p0 = pid(); adb("shell", "run-as", PKG, "kill", "-9", p0); time.sleep(1.5); start_app(); wait_ready(); time.sleep(2)
res["restoredNotifications"] = cdp_eval("__ATTENTION_INBOX__.getNativeReminderStatus().notifications")
log("restored status", res["restoredNotifications"])
json.dump(res, open(RAW / "r3-forced.json", "w"), ensure_ascii=False, indent=1)
