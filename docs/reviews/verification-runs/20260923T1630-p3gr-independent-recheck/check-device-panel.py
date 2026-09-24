#!/usr/bin/env python3
"""Independent screen-coordinate alarm-panel check on the installed candidate."""
import importlib.util
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
RUN = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("device_verify", ROOT / "scripts/verification/p3g-device-verify.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
runner = mod.DeviceRunner("10ACBF2D3D000RS", str(RUN))
item_id = "independent_p3gr_panel_" + str(int(time.time()))

def evaluate(source):
    return json.loads(runner.eval_js(source.replace("__ITEM_ID__", json.dumps(item_id))))

def panel_geometry():
    return evaluate("""(async()=>{
      const A=window.__ATTENTION_INBOX__;
      await A.alerts.refreshActiveAlarmPanel(true);
      const panel=document.getElementById('activeAlarmPanel');
      const button=panel&&panel.querySelector('[data-alarm-done]');
      if(button) button.scrollIntoView({block:'center'});
      await new Promise(r=>setTimeout(r,300));
      const rect=button&&button.getBoundingClientRect();
      const x=rect&&(rect.left+rect.right)/2;
      const y=rect&&(rect.top+rect.bottom)/2;
      const hit=rect&&document.elementFromPoint(x,y);
      return JSON.stringify({hidden:panel?panel.hidden:null,cardText:panel?panel.innerText:null,
        buttonRect:rect?{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom}:null,
        x,y,hitTag:hit&&hit.tagName,hitAlarmDone:!!(hit&&hit.closest('[data-alarm-done]')),
        viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
        bannerVisible:!!document.querySelector('#alertBanner.show')});
    })()""")

def webview_screen_origin():
    runner.sh("uiautomator dump /sdcard/p3gr-window.xml")
    rc, raw, _ = runner.sh("cat /sdcard/p3gr-window.xml")
    assert rc == 0
    (RUN / "device-ui.xml").write_text(raw, encoding="utf-8")
    root = ET.fromstring(raw)
    node = next(n for n in root.iter("node") if n.attrib.get("class") == "android.webkit.WebView")
    match = re.match(r"\[(\d+),(\d+)\]", node.attrib["bounds"])
    assert match
    return int(match.group(1)), int(match.group(2))

def cleanup():
    try:
        print("cleanup", evaluate("""(async()=>{
          const A=window.__ATTENTION_INBOX__;
          A.state.items=A.state.items.filter(x=>x.id!==__ITEM_ID__);
          await A.saveAsync();
          const bridge=window.Capacitor.Plugins.SystemBridge;
          const r=await bridge.activeAlarmDeliveries();
          for(const a of r.alarms||[]) if(a.itemId===__ITEM_ID__) await bridge.stopAlarmDelivery({id:a.id,token:a.token});
          return JSON.stringify({items:A.state.items.length,remaining:(await bridge.activeAlarmDeliveries()).alarms.length});
        })()"""), flush=True)
    except Exception as error:
        print("cleanup-error", repr(error), file=sys.stderr, flush=True)

try:
    runner.ensure_foreground()
    baseline=evaluate("""(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();
      const r=await window.Capacitor.Plugins.SystemBridge.activeAlarmDeliveries();
      return JSON.stringify({items:A.state.items.length,alarms:(r.alarms||[]).length,
        notify:A.state.settings.notify});})()""")
    print("baseline",baseline,flush=True)
    assert baseline["items"]==0 and baseline["alarms"]==0, "device baseline is not isolated"
    scheduled=evaluate("""(async()=>{const A=window.__ATTENTION_INBOX__;
      A.state.settings.notify=true;
      const item=A.makeItem({id:__ITEM_ID__,title:'P3GR 独立面板触控',priority:'critical',
        triggerAt:Date.now()+20000,status:'waiting',isFallbackTrigger:false});
      A.state.items.push(item);await A.saveAsync();
      await new Promise(r=>setTimeout(r,1800));
      return JSON.stringify({id:item.id,triggerAt:item.triggerAt});})()""")
    print("scheduled",scheduled,flush=True)
    runner.sh("input keyevent KEYCODE_HOME")
    time.sleep(max(0,scheduled["triggerAt"]/1000+4-time.time()))
    runner.snap("independent-alarm-triggered")
    runner.ensure_foreground()
    geometry=panel_geometry()
    print("geometry-before",geometry,flush=True)
    runner.snap("independent-panel-before")
    if not geometry["hitAlarmDone"]:
        # Remove only the visual banner, leaving item revision and alarm token untouched.
        evaluate("""(async()=>{window.__ATTENTION_INBOX__.alerts.hideAlert();return JSON.stringify({hidden:true});})()""")
        geometry=panel_geometry()
        print("geometry-after-visual-hide",geometry,flush=True)
        runner.snap("independent-panel-exposed")
    assert geometry["hitAlarmDone"], "panel button cannot receive a screen-coordinate tap"
    assert 0<=geometry["x"]<geometry["viewport"]["width"]
    assert 0<=geometry["y"]<geometry["viewport"]["height"]
    origin_x, origin_y = webview_screen_origin()
    tap_x = int(origin_x + geometry["x"] * geometry["viewport"]["dpr"])
    tap_y = int(origin_y + geometry["y"] * geometry["viewport"]["dpr"])
    print("screen-tap", {"x": tap_x, "y": tap_y, "webviewOrigin": [origin_x, origin_y]}, flush=True)
    rc, _, err = runner.sh(f"input tap {tap_x} {tap_y}")
    assert rc == 0, err
    time.sleep(3)
    outcome=evaluate("""(async()=>{const A=window.__ATTENTION_INBOX__;
      const r=await window.Capacitor.Plugins.SystemBridge.activeAlarmDeliveries();
      const item=A.state.items.find(x=>x.id===__ITEM_ID__);
      return JSON.stringify({status:item&&item.status,remaining:(r.alarms||[]).filter(a=>a.itemId===__ITEM_ID__).length,
        panelHidden:document.getElementById('activeAlarmPanel').hidden});})()""")
    print("outcome",outcome,flush=True)
    runner.snap("independent-panel-after-tap")
    assert outcome["status"] in ("archived","completed") and outcome["remaining"]==0
finally:
    runner.ensure_foreground()
    cleanup()
