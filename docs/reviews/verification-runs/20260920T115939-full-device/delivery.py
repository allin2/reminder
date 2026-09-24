from device import *
mode=sys.argv[1];d=ROOT/('delivery-'+mode);d.mkdir(exist_ok=False)
def snap(label):
 for name,args in {'screen':('exec-out','screencap','-p'),'trace':('shell','run-as',PKG,'cat','shared_prefs/alarm_trace.xml'),'delivery':('shell','run-as',PKG,'cat','shared_prefs/attention_alarm.xml'),'window':('shell','dumpsys','window'),'alarm':('shell','dumpsys','alarm'),'power':('shell','dumpsys','power'),'notification':('shell','dumpsys','notification')}.items():
  p=subprocess.run(ADB+list(args),capture_output=True,timeout=30);(d/(label+'-'+name+('.png' if name=='screen' else '.txt'))).write_bytes(p.stdout)
item=ev("(async()=>{const A=__ATTENTION_INBOX__;await A.ready();A.closeAllSheets();const it=A.makeItem({id:'verify-"+mode+"-'+Date.now(),title:'实机验证 "+mode+"',priority:'important',triggerAt:Date.now()+25000,status:'waiting',isFallbackTrigger:false});A.state.items.push(it);await A.saveAsync();await new Promise(r=>setTimeout(r,2500));return it})()")
(d/'item.json').write_text(json.dumps(item,ensure_ascii=False,indent=2));snap('scheduled');cmd('shell','input','keyevent','KEYCODE_HOME')
if mode=='other':cmd('shell','am','start','-a','android.settings.SETTINGS')
elif mode=='foreground':cmd('shell','am','start','-W','-n',PKG+'/.MainActivity')
else:cmd('shell','input','keyevent','KEYCODE_SLEEP')
if mode.startswith('cold'):
 pid=cmd('shell','pidof',PKG).decode().strip();cmd('shell','run-as',PKG,'/system/bin/kill','-9',pid);(d/'cold-pid.txt').write_bytes(subprocess.run(ADB+['shell','pidof',PKG],capture_output=True).stdout)
print('ARMED',mode,item['id'],flush=True)
seen=[]
for delay in [3,10,30,60]:
 while time.time()<item['triggerAt']/1000+delay:time.sleep(min(1,max(.01,item['triggerAt']/1000+delay-time.time())))
 snap('due-'+str(delay));raw=(d/('due-'+str(delay)+'-trace.txt')).read_text()
 try:rows=json.loads(ET.fromstring(raw).find("string[@name='events']").text)
 except Exception:rows=[]
 seen.extend(e for e in rows if e not in seen)
 tokens={e['token'] for e in seen if e.get('stage')=='item' and e.get('detail')==item['id']};matched=[e for e in seen if e.get('token') in tokens];visible=any(e.get('stage')=='windowVisible' for e in matched)
 print('OBSERVED',mode,delay,'visible',visible,flush=True)
 if visible:break
(d/'events.json').write_text(json.dumps(matched,ensure_ascii=False,indent=2));(d/'result.json').write_text(json.dumps({'itemId':item['id'],'visible':visible,'received':any(e.get('stage')=='received' for e in matched),'observedSeconds':delay},indent=2))
(d/'logcat.txt').write_bytes(cmd('logcat','-d','-v','epoch','-t','2500'))
cmd('shell','input','keyevent','KEYCODE_WAKEUP');cmd('shell','am','start','-W','-n',PKG+'/.MainActivity');time.sleep(2)
res=ev("(async()=>{const A=__ATTENTION_INBOX__;await A.ready();await A.completeItem("+json.dumps(item['id'])+");await A.saveAsync();const B=Capacitor.Plugins.SystemBridge;const active=await B.activeAlarmDeliveries();for(const x of active.alarms||[])if(x.itemId==="+json.dumps(item['id'])+")await B.stopAlarmDelivery({id:x.id,token:x.token});return {item:A.state.items.find(x=>x.id==="+json.dumps(item['id'])+"),active:await B.activeAlarmDeliveries()}})()")
(d/'completed.json').write_text(json.dumps(res,ensure_ascii=False,indent=2));snap('after-complete');print('DONE',mode,flush=True)
