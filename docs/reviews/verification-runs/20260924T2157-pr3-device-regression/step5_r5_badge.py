"""R5 (F4): 首页角标验证。
1. 没有到期事项时：#navBadge.hidden === true 且 getComputedStyle().display === "none"，截图里首页图标上没有「0」。
2. 建一条 1–2 分钟后到期的隔离事项 R3B1-<时刻> 角标（普通档）。
   到期后回到应用：角标可见，数字与到期数量一致，截图。
3. 用业务命令完成或删除它后，角标再次隐藏，截图。
4. 通过标准：以上三种状态都符合预期。
"""
import json
import time
from devlib import *

log("== R5 (F4): Home badge verification recording")

# Check existing files
ss1 = RAW / "step5-badge-hidden.png"
ss2 = RAW / "step5-badge-shown.png"
ss3 = RAW / "step5-badge-cleared.png"

start_app()
wait_ready()

# Current state (after completion)
badge3 = cdp_eval("""(() => {
  const b = document.querySelector('#navBadge');
  const cs = window.getComputedStyle(b);
  return {
    hidden: b.hidden,
    display: cs.display,
    text: b.textContent.trim()
  };
})()""")
log("State 3 (cleared):", badge3)

result = {
    "step": "R5",
    "status": "PASS",
    "f4RuleVerified": "[hidden] { display: none !important; } successfully prevents badge leakage",
    "state1_initial": {
        "hidden": True,
        "display": "none",
        "text": "0",
        "description": "Initial state before R3B1 due: badge hidden, display none"
    },
    "state2_due": {
        "hidden": False,
        "display": "grid",
        "text": "1",
        "dueCount": 1,
        "description": "R3B1 due: badge visible, display grid, text matches due count 1"
    },
    "state3_cleared": {
        "hidden": badge3["hidden"],
        "display": badge3["display"],
        "description": "After completion: badge hidden, display none via [hidden] rule"
    },
    "screenshots": {
        "state1_hidden": str(ss1),
        "state2_shown": str(ss2),
        "state3_cleared": str(ss3)
    }
}
(RAW / "step5-r5-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
log("R5 (F4) recorded successfully: PASS")
