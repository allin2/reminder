"""R4 (F3): 收起的面板验证。
1. 依次打开并关闭：设置面板（#btnSetup）、捕获面板（openCapture -> #sheetItem）、演示面板（#sheetDemo）、事项详情（#sheetDetail）。
2. 每次关闭后等 0.5 秒，统计 .sheet 中 getBoundingClientRect().top < innerHeight 且 getComputedStyle().visibility !== "hidden" 的元素。
3. 在首页、未来、笔记、我的 4 个标签页各截一张图，并裁剪放大底部导航栏以下的区域。
4. 通过标准：统计数恒为 0；截图底部没有「演示（只读）」等面板标题；面板打开时可见、可交互。
"""
import json
import time
from PIL import Image
from devlib import *

log("== R4 (F3): Testing collapsed sheets visibility and leak prevention")
start_app()
log("ready", wait_ready())

# Ensure all sheets are closed initially
cdp_eval("__ATTENTION_INBOX__.closeAllSheets ? __ATTENTION_INBOX__.closeAllSheets() : null")
time.sleep(0.5)

CHECK_LEAK_JS = """(() => {
  const sheets = Array.from(document.querySelectorAll('.sheet'));
  const leaking = [];
  const allInfo = [];
  for (const el of sheets) {
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const isLeaking = (rect.top < window.innerHeight) && (cs.visibility !== 'hidden');
    const info = {
      id: el.id,
      top: rect.top,
      innerHeight: window.innerHeight,
      visibility: cs.visibility,
      display: cs.display,
      isOpen: el.classList.contains('open'),
      isLeaking: isLeaking
    };
    allInfo.push(info);
    if (isLeaking) leaking.push(info);
  }
  return {
    totalSheets: sheets.length,
    leakingCount: leaking.length,
    leaking: leaking,
    allSheets: allInfo
  };
})()"""

init_leak = cdp_eval(CHECK_LEAK_JS)
log(f"Initial state: totalSheets={init_leak['totalSheets']}, leakingCount={init_leak['leakingCount']}")
assert init_leak["leakingCount"] == 0, f"Sheets leaking initially: {init_leak['leaking']}"

operations = []

# --- 1. Setup Sheet (#sheetSetup) ---
log("1. Testing Setup sheet (#sheetSetup)")
cdp_eval("document.querySelector('.nav-item[data-tab=\"me\"]').click()")
time.sleep(0.5)
cdp_eval("document.querySelector('#btnSetup').click()")
time.sleep(0.5)
setup_open = cdp_eval("""(() => {
  const el = document.querySelector('#sheetSetup');
  const cs = window.getComputedStyle(el);
  return el.classList.contains('open') && cs.visibility === 'visible';
})()""")
assert setup_open, "Setup sheet failed to open"
log("Setup sheet open & visible: True")

cdp_eval("document.querySelector('[data-close=\"sheetSetup\"]').click()")
time.sleep(0.5)
leak1 = cdp_eval(CHECK_LEAK_JS)
log(f"After closing Setup sheet: leakingCount={leak1['leakingCount']}")
assert leak1["leakingCount"] == 0, f"Leaks found after closing setup sheet: {leak1['leaking']}"
operations.append({"sheet": "sheetSetup", "openConfirmed": setup_open, "leakResult": leak1})

# --- 2. Capture Sheet (#sheetItem) ---
log("2. Testing Capture sheet (#sheetItem)")
cdp_eval("document.querySelector('.nav-item[data-tab=\"home\"]').click()")
time.sleep(0.5)
cdp_eval("__ATTENTION_INBOX__.openCapture()")
time.sleep(0.5)
cap_interactive = cdp_eval("""(() => {
  const el = document.querySelector('#sheetItem');
  const input = document.querySelector('#capText');
  input.focus();
  const cs = window.getComputedStyle(el);
  return {
    isOpen: el.classList.contains('open'),
    isVisible: cs.visibility === 'visible',
    inputFocused: document.activeElement === input
  };
})()""")
assert cap_interactive["isOpen"] and cap_interactive["isVisible"] and cap_interactive["inputFocused"], f"Capture sheet not interactive: {cap_interactive}"
log(f"Capture sheet interactive: {cap_interactive}")

cdp_eval("document.querySelector('[data-close=\"sheetItem\"]').click()")
time.sleep(0.5)
leak2 = cdp_eval(CHECK_LEAK_JS)
log(f"After closing Capture sheet: leakingCount={leak2['leakingCount']}")
assert leak2["leakingCount"] == 0, f"Leaks found after closing capture sheet: {leak2['leaking']}"
operations.append({"sheet": "sheetItem", "interactive": cap_interactive, "leakResult": leak2})

# --- 3. Demo Sheet (#sheetDemo) ---
log("3. Testing Demo sheet (#sheetDemo)")
cdp_eval("__ATTENTION_INBOX__.openDemoPreview()")
time.sleep(0.5)
demo_open = cdp_eval("""(() => {
  const el = document.querySelector('#sheetDemo');
  const cs = window.getComputedStyle(el);
  return el.classList.contains('open') && cs.visibility === 'visible';
})()""")
assert demo_open, "Demo sheet failed to open"
log("Demo sheet open & visible: True")

cdp_eval("document.querySelector('[data-close=\"sheetDemo\"]').click()")
time.sleep(0.5)
leak3 = cdp_eval(CHECK_LEAK_JS)
log(f"After closing Demo sheet: leakingCount={leak3['leakingCount']}")
assert leak3["leakingCount"] == 0, f"Leaks found after closing demo sheet: {leak3['leaking']}"
operations.append({"sheet": "sheetDemo", "openConfirmed": demo_open, "leakResult": leak3})

# --- 4. Detail Sheet (#sheetDetail) ---
log("4. Testing Detail sheet (#sheetDetail)")
seed_data = json.loads((RAW / "step1-seed.json").read_text(encoding="utf-8"))
r3_id = seed_data["seed_id"]
cdp_eval("document.querySelector('.nav-item[data-tab=\"future\"]').click()")
time.sleep(0.5)
detail_opened = cdp_eval(f"""(() => {{
  const card = document.querySelector('.card[data-id=\"{r3_id}\"]');
  if (card) {{ card.click(); return true; }}
  return false;
}})()""")
assert detail_opened, f"Card for {r3_id} not found in future tab"
time.sleep(0.5)

detail_open = cdp_eval("""(() => {
  const el = document.querySelector('#sheetDetail');
  const cs = window.getComputedStyle(el);
  return el.classList.contains('open') && cs.visibility === 'visible';
})()""")
assert detail_open, "Detail sheet failed to open"
log("Detail sheet open & visible: True")

cdp_eval("document.querySelector('[data-close=\"sheetDetail\"]').click()")
time.sleep(0.5)
leak4 = cdp_eval(CHECK_LEAK_JS)
log(f"After closing Detail sheet: leakingCount={leak4['leakingCount']}")
assert leak4["leakingCount"] == 0, f"Leaks found after closing detail sheet: {leak4['leaking']}"
operations.append({"sheet": "sheetDetail", "openConfirmed": detail_open, "leakResult": leak4})

# --- 5. Screenshots across 4 tabs with bottom crop ---
tabs = ["home", "future", "notes", "me"]
tab_results = {}

for tab in tabs:
    log(f"Switching to tab '{tab}'")
    cdp_eval(f"document.querySelector('.nav-item[data-tab=\"{tab}\"]').click()")
    time.sleep(0.5)
    
    # Check leak on tab
    tab_leak = cdp_eval(CHECK_LEAK_JS)
    assert tab_leak["leakingCount"] == 0, f"Leak on tab {tab}: {tab_leak['leaking']}"
    
    # Full screenshot
    ss_path = screenshot(f"step4-tab-{tab}")
    log(f"Screenshot for tab {tab}: {ss_path}")
    
    # Crop bottom navigation bar area (y: 2050 to 2400)
    img = Image.open(ss_path)
    w, h = img.size
    crop_box = (0, int(h * 0.85), w, h)
    cropped = img.crop(crop_box)
    crop_path = RAW / f"step4-tab-{tab}-bottom.png"
    cropped.save(crop_path)
    log(f"Cropped bottom area saved to: {crop_path}")
    
    tab_results[tab] = {
        "leakingCount": tab_leak["leakingCount"],
        "fullScreenshot": str(ss_path),
        "bottomCropScreenshot": str(crop_path)
    }

# Return to home tab
cdp_eval("document.querySelector('.nav-item[data-tab=\"home\"]').click()")
time.sleep(0.5)

result = {
    "step": "R4",
    "status": "PASS",
    "sheetOperations": operations,
    "tabResults": tab_results,
    "allLeakCountsZero": all(op["leakResult"]["leakingCount"] == 0 for op in operations) and all(tr["leakingCount"] == 0 for tr in tab_results.values())
}
(RAW / "step4-r4-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
log("R4 (F3) completed successfully: PASS")
