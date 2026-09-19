#!/usr/bin/env python3
"""Normal item alarm delivery in background/lockscreen/cold process; save before opening app."""
import argparse,json,subprocess,time,re,xml.etree.ElementTree as ET
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('run',type=Path);p.add_argument('--serial',required=True);p.add_argument('--mode',choices=['off','other','cold'],required=True);p.add_argument('--lead',type=int,default=75);p.add_argument('--panel-done',action='store_true');a=p.parse_args();a.run.mkdir(parents=True,exist_ok=False)
adb=[str(Path.home()/'Library/Android/sdk/platform-tools/adb'),'-s',a.serial];pkg='space.alliswell.inbox';root=Path(__file__).resolve().parents[2]
def cmd(*xs):return subprocess.check_output(adb+list(xs),timeout=40)
def cdp(js):
 pid=cmd('shell','pidof',pkg).decode().strip().split()[0];port=cmd('forward','tcp:0','localabstract:webview_devtools_remote_'+pid).decode().strip()
 try:return json.loads(subprocess.check_output(['/usr/bin/python3',str(root/'scripts/android-cdp-eval.py'),js,port],timeout=60))
 finally:cmd('forward','--remove','tcp:'+port)
def save(n,x):(a.run/n).write_text(json.dumps(x,ensure_ascii=False,indent=2))
def snap(label):
 for n,args in {'vibrator':('shell','dumpsys','vibrator_manager'),'window':('shell','dumpsys','window'),'alarm':('shell','dumpsys','alarm'),'notifications':('shell','dumpsys','notification'),'events':('logcat','-b','events','-d','-v','epoch'),'trace':('shell','run-as',pkg,'cat','shared_prefs/alarm_trace.xml'),'screen':('exec-out','screencap','-p')}.items():
  (a.run/(label+'-'+n+('.png' if n=='screen' else '.txt'))).write_bytes(cmd(*args))
apk=cmd('shell','pm','path',pkg).decode().strip().removeprefix('package:');save('metadata.json',{'sha256':cmd('shell','sha256sum',apk).decode().split()[0],'serial':a.serial,'mode':a.mode,'lead':a.lead})
cmd('shell','input','keyevent','KEYCODE_WAKEUP');cmd('shell','am','start','-W','-n',pkg+'/.MainActivity');time.sleep(2)
iid='matrix_'+a.mode+'_'+str(int(time.time()));js='''(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();const it=A.makeItem({id:ID,title:TITLE,priority:'important',triggerAt:Date.now()+LEAD*1000,status:'waiting',isFallbackTrigger:false});A.state.items.push(it);await A.saveAsync();await new Promise(r=>setTimeout(r,2500));return JSON.stringify(it)})()'''.replace('ID',json.dumps(iid)).replace('TITLE',json.dumps('后台验收 '+a.mode)).replace('LEAD',str(a.lead));it=cdp(js);save('item.json',it);snap('scheduled')
cmd('shell','input','keyevent','KEYCODE_HOME')
if a.mode=='other':cmd('shell','am','start','-a','android.settings.SETTINGS')
else:cmd('shell','input','keyevent','KEYCODE_SLEEP')
if a.mode=='cold':
 pid=cmd('shell','pidof',pkg).decode().strip();cmd('shell','run-as',pkg,'/system/bin/kill','-9',pid);time.sleep(1)
 r=subprocess.run(adb+['shell','pidof',pkg],capture_output=True);save('cold-pid.json',{'before':pid,'after':r.stdout.decode().strip()});assert not r.stdout.strip(),'not a cold process'
print('WAIT',a.mode,a.lead,flush=True)
while time.time()<it['triggerAt']/1000+7:
 if a.mode=='other':cmd('shell','input','keyevent','KEYCODE_WAKEUP')
 time.sleep(min(5,max(0,it['triggerAt']/1000+7-time.time())))
snap('due');events=json.loads(ET.parse(a.run/'due-trace.txt').find("string[@name='events']").text);tokens={e['token'] for e in events if e['stage']=='item' and e['detail']==iid};rows=[e for e in events if e['token'] in tokens];received=[e for e in rows if e['stage']=='received'];visible=[e for e in rows if e['stage']=='windowVisible'];save('delivery-result.json',{'itemId':iid,'received':bool(received),'visible':bool(visible),'lagMs':received[-1]['at']-it['triggerAt'] if received else None,'rows':rows});print('DELIVERY',bool(received),bool(visible),flush=True)
if visible and not a.panel_done:
 cmd('shell','uiautomator','dump','/sdcard/matrix-ui.xml');ui=cmd('exec-out','cat','/sdcard/matrix-ui.xml');(a.run/'ui.xml').write_bytes(ui);tree=ET.fromstring(ui)
 node=next((x for x in tree.iter('node') if x.get('resource-id')==pkg+':id/btnDismiss'),None)
 if node is not None:
  x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds')));cmd('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2));time.sleep(2);snap('closed')
cmd('shell','input','keyevent','KEYCODE_WAKEUP');cmd('shell','am','start','-W','-n',pkg+'/.MainActivity');time.sleep(2)
if a.panel_done:
 cmd('shell','input','keyevent','KEYCODE_HOME');cmd('shell','am','start','-W','-n',pkg+'/.MainActivity');time.sleep(3);snap('panel')
 cmd('shell','uiautomator','dump','/sdcard/matrix-panel.xml');ui=cmd('exec-out','cat','/sdcard/matrix-panel.xml');(a.run/'panel.xml').write_bytes(ui)
 node=next(n for n in ET.fromstring(ui).iter('node') if n.get('text')=='完成事项');x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds')));cmd('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2));time.sleep(4);snap('panel-stopped')
 result=cdp('(async()=>{const A=window.__ATTENTION_INBOX__;return JSON.stringify({item:A.state.items.find(x=>x.id===ID),active:await window.Capacitor.Plugins.SystemBridge.activeAlarmDeliveries()})})()'.replace('ID',json.dumps(iid)));save('panel-result.json',result)
 assert result['item']['status']=='archived' and not any(x.get('itemId')==iid for x in result['active']['alarms'])
 assert 'CurrentVibration:\n    null' in (a.run/'panel-stopped-vibrator.txt').read_text()
# Archive only the test item. No original user items are edited.
res=cdp('''(async()=>{const A=window.__ATTENTION_INBOX__;await A.completeItem(ID);await A.saveAsync();const B=window.Capacitor.Plugins.SystemBridge;const r=await B.activeAlarmDeliveries();for(const alarm of r.alarms||[])if(alarm.itemId===ID)await B.stopAlarmDelivery({id:alarm.id,token:alarm.token});return JSON.stringify(A.state.items.find(x=>x.id===ID))})()'''.replace('ID',json.dumps(iid)));save('cleaned-item.json',res);snap('cleaned');print('COMPLETE',flush=True)
