#!/usr/bin/env python3
"""Exercise four actual native alarm buttons; preserve original items and archive tests."""
import argparse,json,subprocess,time,re,hashlib
from pathlib import Path
import xml.etree.ElementTree as ET
p=argparse.ArgumentParser();p.add_argument('evidence',type=Path);p.add_argument('--serial',required=True);p.add_argument('--sha256',required=True);p.add_argument('--screen',choices=['off','foreground'],default='off');p.add_argument('--actions',nargs='+',choices=['close','ack','snooze','done'],default=['close','ack','snooze','done']);a=p.parse_args()
root=Path(__file__).resolve().parents[2];run=a.evidence.resolve();run.mkdir(exist_ok=False)
adb=[str(Path.home()/'Library/Android/sdk/platform-tools/adb'),'-s',a.serial];pkg='space.alliswell.inbox'
def cmd(*args):return subprocess.check_output(adb+list(args),timeout=40)
def cdp(js):
 pid=cmd('shell','pidof',pkg).decode().strip().split()[0];port=cmd('forward','tcp:0','localabstract:webview_devtools_remote_'+pid).decode().strip()
 try:return json.loads(subprocess.check_output(['/usr/bin/python3',str(root/'scripts/android-cdp-eval.py'),js,port],text=True,timeout=60))
 finally:cmd('forward','--remove','tcp:'+port)
def save(path,obj):path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def state():return cdp('(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();return JSON.stringify({items:A.state.items,settings:A.state.settings})})()')
def prefs(name):return cmd('shell','run-as',pkg,'cat','shared_prefs/'+name+'.xml')
def values(xml,key):return json.loads(ET.fromstring(xml).find("string[@name='"+key+"']").text or '[]')
apk=cmd('shell','pm','path',pkg).decode().strip().removeprefix('package:');assert cmd('shell','sha256sum',apk).decode().split()[0]==a.sha256
save(run/'metadata.json',{'serial':a.serial,'candidateSha256':a.sha256,'screen':a.screen,'startedAt':int(time.time()*1000),'sourceScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})
cmd('shell','input','keyevent','KEYCODE_WAKEUP');cmd('shell','wm','dismiss-keyguard');cmd('shell','am','start','-W','-n',pkg+'/.MainActivity');time.sleep(2)
before=state();save(run/'state-before.json',before);results=[]
for action,button in [('close','btnDismiss'),('ack','btnAck'),('snooze','btnSnooze'),('done','btnDone')]:
 if action not in a.actions:continue
 folder=run/action;folder.mkdir();iid='f6c_action_'+action+'_'+str(int(time.time()));title='F6c 按钮测试 '+action
 js='''(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();const it=A.makeItem({id:ID,title:TITLE,note:'功能验收专用',priority:'important',status:'waiting',triggerAt:Date.now()+30000,isFallbackTrigger:false,repeat:null});A.state.items.push(it);await A.saveAsync();await new Promise(r=>setTimeout(r,5000));return JSON.stringify(it)})()'''.replace('ID',json.dumps(iid)).replace('TITLE',json.dumps(title))
 item=cdp(js);save(folder/'item-before.json',item)
 if a.screen=='off':
  cmd('shell','input','keyevent','KEYCODE_HOME');cmd('shell','input','keyevent','KEYCODE_SLEEP')
 print('WAIT',action,a.screen,flush=True)
 until=item['triggerAt']/1000+4
 while time.time()<until:
  if a.screen=='foreground':cmd('shell','input','keyevent','KEYCODE_WAKEUP')
  time.sleep(min(5,max(0,until-time.time())))
 (folder/'before.png').write_bytes(cmd('exec-out','screencap','-p'));xml=prefs('alarm_trace');(folder/'trace-before.xml').write_bytes(xml)
 events=values(xml,'events');token=[e['token'] for e in events if e['stage']=='item' and e['detail']==iid][-1];alarmid=token.split(':')[0]
 cmd('shell','uiautomator','dump','/sdcard/f6c-actions.xml');ui=cmd('exec-out','cat','/sdcard/f6c-actions.xml');(folder/'ui-before.xml').write_bytes(ui);tree=ET.fromstring(ui)
 assert any(n.get('text')==title for n in tree.iter('node')),'wrong alarm title'
 node=next(n for n in tree.iter('node') if n.get('resource-id')==pkg+':id/'+button);x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds')));clicked=int(cmd('shell','date','+%s%3N').decode().strip())
 cmd('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2));time.sleep(5)
 # Read current WebView without launching MainActivity: a launch would hide action-routing faults.
 after=state();save(folder/'state-after-action.json',after);it=next(x for x in after['items'] if x['id']==iid)
 trace=prefs('alarm_trace');(folder/'trace-after.xml').write_bytes(trace);events=values(trace,'events');rows=[e for e in events if e['token']==token]
 schedules=prefs('attention_alarm_schedules');(folder/'schedules-after.xml').write_bytes(schedules);plans=[x for x in values(schedules,'alarms') if x['itemId']==iid]
 pending=cdp('(async()=>JSON.stringify(await window.Capacitor.Plugins.LocalNotifications.getPending()))()');save(folder/'local-pending.json',pending);localplans=[n for n in pending.get('notifications',[]) if n.get('extra',{}).get('itemId')==iid]
 queue=prefs('attention_alarm');(folder/'queue-after.xml').write_bytes(queue)
 notif=cmd('shell','dumpsys','notification','--noredact');(folder/'notification-after.txt').write_bytes(notif);window=cmd('shell','dumpsys','activity','activities');(folder/'activity-after.txt').write_bytes(window);(folder/'after.png').write_bytes(cmd('exec-out','screencap','-p'))
 checks={'nativeAction':any(e['stage']=='userAction' and e['detail']==action for e in rows),'effectsStopped':any(e['stage']=='effectsStopped' and e['at']>=clicked for e in rows),'notificationRemoved':not bool(re.search(r'^\s*NotificationRecord\([^\n]*pkg=space\.alliswell\.inbox[^\n]* id='+alarmid+r'\b',notif.decode(),re.M)),'originalItemsUnchanged':all(next((x for x in after['items'] if x['id']==o['id']),None)==o for o in before['items'])}
 if action=='close':checks.update(statusDue=it['status']=='due',notAcknowledged=not it.get('acknowledgedAt'),triggerUnchanged=it['triggerAt']==item['triggerAt'],futureSchedule=bool(plans or localplans))
 if action=='ack':checks.update(statusAcknowledged=it['status']=='acknowledged',acknowledgedAt=bool(it.get('acknowledgedAt')),notCompleted=not it.get('completedAt'))
 if action=='snooze':checks.update(statusSnoozed=it['status']=='snoozed',twoHourDelay=abs(it['triggerAt']-clicked-7200000)<15000,elapsedBasis=it.get('scheduleBasis')=='elapsed',futureSchedule=bool(plans) and all(x['triggerAt']>=it['triggerAt']-1000 for x in plans))
 if action=='done':checks.update(statusArchived=it['status']=='archived',completedAt=bool(it.get('completedAt')),noSchedule=not plans and not localplans)
 result={'action':action,'itemId':iid,'clickedAt':clicked,'token':token,'checks':checks,'pass':all(checks.values()),'item':it,'plans':plans,'localPlans':localplans};save(folder/'result.json',result);results.append(result);save(run/'results.json',results);print('RESULT',action,json.dumps(checks),flush=True)
 # Cleanup only our item after recording actual action result.
 cdp('''(async()=>{const A=window.__ATTENTION_INBOX__;await A.completeItem(ID);await A.saveAsync();await new Promise(r=>setTimeout(r,2000));return JSON.stringify(true)})()'''.replace('ID',json.dumps(iid)))
 if not result['pass']:raise RuntimeError('Functional failure: '+action)
after=state();save(run/'state-final.json',after);assert all(next((x for x in after['items'] if x['id']==o['id']),None)==o for o in before['items'])
print('COMPLETE',flush=True)
