"""独立复验 R2（F1 引导判定）与 R3（F2 冷启动卡片）。只读 + 杀进程冷启动，不写业务数据。"""
from devlib import *
res = {}
start_app(); log("== R2 ready", wait_ready())
r2 = cdp_eval("""(()=>{const A=__ATTENTION_INBOX__;const s=A.getNativeReminderStatus();const st=AttentionLib.Feedback.setupSteps(s,A.setupStepsContext());
 return {status:{notifications:s.notifications,exactAlarm:s.exactAlarm,diag:{o:s.diag&&s.diag.canDrawOverlays,f:s.diag&&s.diag.canUseFullScreenIntent,b:s.diag&&s.diag.ignoringBatteryOptimizations}},
 steps:st.steps.map(x=>[x.id,x.done,x.verified]), next:st.next&&st.next.id, missing:st.steps.filter(x=>!x.done).length}})()""")
log("R2 computed", json.dumps(r2, ensure_ascii=False))
cdp_eval("__ATTENTION_INBOX__.closeAllSheets(); document.querySelector('[data-tab=me]').click(); true"); time.sleep(1.2)
r2["setupSub"] = cdp_eval("(document.querySelector('#setupSub')||{}).textContent")
cdp_eval("document.querySelector('#btnSetup').click(); true"); time.sleep(1.5)
r2["sheetFirstStep"] = cdp_eval("(()=>{const h=document.querySelector('#setupBody h4');return h&&h.textContent})()")
r2["sheetHasOverlayPrompt"] = cdp_eval("/允许锁屏弹窗与悬浮窗/.test((document.querySelector('#setupBody h4')||{}).textContent||'')")
if "MainActivity" in focus(): screenshot("r2-setup-sheet")
log("R2 ui", json.dumps({k: r2[k] for k in ("setupSub", "sheetFirstStep", "sheetHasOverlayPrompt")}, ensure_ascii=False))
exp_first = {"background": "允许完全后台运行", "overlay": "允许锁屏弹窗", "test": "60 秒测试", "notify": "允许发通知", "exact": "允许精确提醒"}[r2["next"]]
r2["pass"] = (r2["status"]["diag"]["o"] is True and r2["status"]["diag"]["f"] is True and ["overlay", True, True] in r2["steps"]
              and exp_first in (r2["sheetFirstStep"] or "") and f"还差 {r2['missing']} 步" in (r2["setupSub"] or ""))
res["R2"] = r2; log("R2 PASS" if r2["pass"] else "R2 FAIL")
cdp_eval("__ATTENTION_INBOX__.closeAllSheets(); document.querySelector('[data-tab=home]').click(); true")

log("== R3 cold start sampling")
rounds = []
SAMPLE = "(()=>{const A=window.__ATTENTION_INBOX__;const h=document.querySelector('#homeSetup');const s=A&&A.getNativeReminderStatus?A.getNativeReminderStatus():null;return [Date.now(),s?s.notifications:null,h?h.innerText:null]})()"
for rnd in range(3):
    home(); p0 = pid(); adb("shell", "run-as", PKG, "kill", "-9", p0); time.sleep(1.5)
    sh(f"am start -n {MAIN}")
    samples = []; t0 = time.time()
    # 持续短连 CDP 采样（每次 evaluate 约 50–150ms）
    while time.time() - t0 < 10:
        try: samples.append(cdp_eval(SAMPLE, timeout=5))
        except Exception: pass
    unknown = [s for s in samples if s and s[1] == "unknown"]
    bad_unknown = [s for s in unknown if s[2]]
    notify_prompt = [s for s in samples if s and s[2] and "允许发通知" in s[2]]
    final = next((s for s in reversed(samples) if s), None)
    r = {"samples": len(samples), "unknownSamples": len(unknown), "cardShownWhileUnknown": len(bad_unknown), "notifyPromptSamples": len(notify_prompt), "final": final}
    rounds.append(r); log("R3 round", rnd + 1, json.dumps(r, ensure_ascii=False))
if "MainActivity" in focus(): screenshot("r3-home-card")
ok3 = all(r["cardShownWhileUnknown"] == 0 and r["notifyPromptSamples"] == 0 and r["final"] and r["final"][1] == "granted"
          and f"还差 {r2['missing']} 步" in (r["final"][2] or "") for r in rounds)
res["R3"] = {"rounds": rounds, "pass": ok3, "sawUnknownAtLeastOnce": any(r["unknownSamples"] for r in rounds)}
log("R3 PASS" if ok3 else "R3 FAIL", "sawUnknown:", res["R3"]["sawUnknownAtLeastOnce"])
json.dump(res, open(RAW / "r2-r3.json", "w"), ensure_ascii=False, indent=1)
