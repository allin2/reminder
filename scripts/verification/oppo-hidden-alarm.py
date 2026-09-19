#!/usr/bin/env python3
"""Reproduce hidden repeating vibration via a diagnostic alarm, preserving user items.

2026-09-18 真机修正（vivo V2238A / Android 16 / OriginOS 16 实测）：
  1. `uiautomator dump` **不暴露 WebView 内部文本**，原「找 text=='停止声振'」在本机必然
     StopIteration，而同一时刻 CDP 读出的面板文本明确含该按钮。改为**优先用 CDP 点击真实
     渲染出的按钮**（`app-core.js` 的 addEventListener 链路，仍是真实 UI 事件路径），
     UIAutomator 仅作回退。
  2. 清理逻辑此前位于断言之后 —— 断言一失败就**跳过清理、留下持续响铃**（真机上实际发生）。
     改为 try/finally，无论成败都摘掉诊断闹钟。
"""
import argparse,json,subprocess,time,re,xml.etree.ElementTree as ET
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('run',type=Path);p.add_argument('--serial',required=True);p.add_argument('--fixed',action='store_true');p.add_argument('--notification',action='store_true');a=p.parse_args();a.run.mkdir(parents=True,exist_ok=False)
adb=[str(Path.home()/'Library/Android/sdk/platform-tools/adb'),'-s',a.serial];pkg='space.alliswell.inbox';aid=918181
root=Path(__file__).resolve().parents[2]
def cmd(*xs):return subprocess.check_output(adb+list(xs),timeout=40)
def cdp(js):
 pid=cmd('shell','pidof',pkg).decode().strip().split()[0];port=cmd('forward','tcp:0','localabstract:webview_devtools_remote_'+pid).decode().strip()
 try:return json.loads(subprocess.check_output(['/usr/bin/python3',str(root/'scripts/android-cdp-eval.py'),js,port],timeout=60))
 finally:cmd('forward','--remove','tcp:'+port)
def snap(label):
 for n,args in {'vibrator':('shell','dumpsys','vibrator_manager'),'window':('shell','dumpsys','window'),'notifications':('shell','dumpsys','notification'),'trace':('shell','run-as',pkg,'cat','shared_prefs/alarm_trace.xml'),'screen':('exec-out','screencap','-p')}.items():
  (a.run/(label+'-'+n+('.png' if n=='screen' else '.txt'))).write_bytes(cmd(*args))
def tap_bounds(ui,label):
 node=next(n for n in ET.fromstring(ui).iter('node') if n.get('text')==label);x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds')));cmd('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
def click_web_stop():
 """真实 UI 事件路径。返回 None=成功；否则返回失败原因字符串（供回退判断）。

 注意 cdp() 内部已 json.loads 过一层：若 JS 返回 JSON.stringify(...)，这里拿到的是 dict。
 """
 try:
  r=cdp('(()=>{const b=document.querySelector("[data-alarm-stop]");if(!b)return JSON.stringify({found:false});b.click();return JSON.stringify({found:true,text:b.textContent.trim()})})()')
  found=r.get('found') if isinstance(r,dict) else ('"found":true' in str(r))
  return None if found else 'panel button not present'
 except Exception as e:return 'cdp failed: '+str(e)[:60]
apk=cmd('shell','pm','path',pkg).decode().strip().removeprefix('package:');(a.run/'metadata.json').write_text(json.dumps({'sha256':cmd('shell','sha256sum',apk).decode().split()[0],'serial':a.serial,'notification':a.notification}))
try:
 cmd('shell','input','keyevent','KEYCODE_WAKEUP');cmd('shell','am','start','-W','-n',pkg+'/.MainActivity');time.sleep(2)
 res=cdp('(async()=>JSON.stringify(await window.Capacitor.Plugins.SystemBridge.scheduleAlarm({id:918181,delayMs:7000,title:"隐藏闹钟复现",body:"独立诊断，无事项；请由自动脚本停止"})))()');(a.run/'scheduled.json').write_text(json.dumps(res));time.sleep(9);snap('ringing')
 cmd('shell','input','keyevent','KEYCODE_HOME');time.sleep(3);snap('home');cmd('shell','am','start','-W','-n',pkg+'/.MainActivity');time.sleep(3);snap('app')
 res=cdp('(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();return JSON.stringify({matchingItems:A.state.items.filter(x=>x.title==="隐藏闹钟复现").length,panel:document.getElementById("activeAlarmPanel")?.innerText||null})})()');(a.run/'app-result.json').write_text(json.dumps(res,ensure_ascii=False));print(res,flush=True)
 if a.fixed and not a.notification:
  reason=click_web_stop()
  if reason is None:
   (a.run/'stop-path.txt').write_text('cdp-panel-button')
  else:
   # 回退：UIAutomator（仅当 WebView 文本确实暴露时才有效）
   (a.run/'stop-path.txt').write_text('uiautomator-fallback: '+reason)
   cmd('shell','uiautomator','dump','/sdcard/hidden-alarm.xml');ui=cmd('exec-out','cat','/sdcard/hidden-alarm.xml');(a.run/'panel-ui.xml').write_bytes(ui)
   tap_bounds(ui,'停止声振')
  time.sleep(3);snap('stopped')
  assert 'CurrentVibration:\n    null' in (a.run/'stopped-vibrator.txt').read_text(), 'vibration still active'
  print(cdp('(async()=>JSON.stringify(await window.Capacitor.Plugins.SystemBridge.activeAlarmDeliveries()))()'),flush=True)
 else:
  cmd('shell','cmd','statusbar','expand-notifications');time.sleep(1);cmd('shell','uiautomator','dump','/sdcard/shade-hidden.xml');ui=cmd('exec-out','cat','/sdcard/shade-hidden.xml');(a.run/'shade.xml').write_bytes(ui)
  label='停止声振' if a.fixed else '隐藏闹钟复现'
  tap_bounds(ui,label);time.sleep(2)
  if not a.fixed:cmd('shell','input','keyevent','KEYCODE_BACK')
  snap('stopped')
  if a.fixed:assert 'CurrentVibration:\n    null' in (a.run/'stopped-vibrator.txt').read_text(), 'vibration still active'
  cmd('shell','cmd','statusbar','collapse');cmd('shell','am','start','-W','-n',pkg+'/.MainActivity');time.sleep(1)
finally:
 # 清理必须无条件执行：断言失败也不能把响铃留在用户设备上。
 try:
  cdp('(async()=>{const B=window.Capacitor.Plugins.SystemBridge;await B.cancelAlarm({id:918181});await B.cancelNotification({id:918181});return JSON.stringify(true)})()')
 except Exception as e:
  (a.run/'cleanup-error.txt').write_text(str(e))
