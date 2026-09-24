#!/usr/bin/env python3
"""P2-E 真实生产页 setup 冒烟：纯 Web ready/入口隐藏 + AppSetup 假桥实例行为。"""
import http.server, json, os, pathlib, subprocess, tempfile, threading, time, urllib.request, websocket
for k in ("http_proxy","https_proxy","HTTP_PROXY","HTTPS_PROXY","all_proxy","ALL_PROXY"): os.environ.pop(k,None)
os.environ["NO_PROXY"]="*"
ROOT=pathlib.Path(__file__).resolve().parents[2]; OUT=pathlib.Path(os.environ.get("SETUP_CHECK_OUT","/tmp/attention-setup")); OUT.mkdir(parents=True,exist_ok=True)
PORT,CDP=18981,18982; CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
class H(http.server.BaseHTTPRequestHandler):
  def log_message(self,*a): pass
  def do_GET(self):
    rel=self.path.split("?",1)[0].lstrip("/") or "index.html"; p=ROOT/rel
    if rel=="sw.js" or not p.is_file(): self.send_error(404); return
    self.send_response(200); self.send_header("Content-Type","text/html" if rel.endswith(".html") else "text/javascript"); self.send_header("Cache-Control","no-store"); self.end_headers(); self.wfile.write(p.read_bytes())
class C:
  def __init__(self,u): self.w=websocket.create_connection(u,timeout=20); self.i=0
  def e(self,x):
    self.i+=1; self.w.send(json.dumps({"id":self.i,"method":"Runtime.evaluate","params":{"expression":x,"awaitPromise":True,"returnByValue":True}}))
    while 1:
      r=json.loads(self.w.recv())
      if r.get("id")==self.i: return r.get("result",{}).get("result",{}).get("value")
def main():
  srv=http.server.ThreadingHTTPServer(("127.0.0.1",PORT),H); threading.Thread(target=srv.serve_forever,daemon=True).start(); prof=tempfile.mkdtemp(prefix="setup-")
  p=subprocess.Popen([CHROME,"--headless=new",f"--user-data-dir={prof}",f"--remote-debugging-port={CDP}","--remote-allow-origins=*","--no-first-run","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); out={"cases":[],"failures":[]}
  try:
    for _ in range(100):
      try: tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json")); break
      except Exception: time.sleep(.1)
    tab=next(t for t in tabs if t.get("type")=="page"); c=C(tab["webSocketDebuggerUrl"]); c.e("location.href='http://127.0.0.1:%d/index.html'; true"%PORT); time.sleep(1.5)
    pure=c.e("(async()=>({ready:await window.__ATTENTION_INBOX__.ready(),hidden:document.querySelector('#btnSetup').hidden}))()"); out["cases"].append({"name":"pure-web","value":pure});
    if not pure or pure.get("ready") is not True or pure.get("hidden") is not True: out["failures"].append("pure-web")
    fake=c.e("""(async()=>{
      const S=AttentionLib.AppSetup.createAppSetup, n={}, events={}, toasts=[], schedules=[], stops=[];
      const node=id=>({id,textContent:'',innerHTML:'',hidden:id==='btnSetup',style:{},dataset:{},classList:{contains:()=>false},addEventListener:(name,fn)=>{(events[id]||(events[id]=[])).push({name,fn})}});
      const q=s=>{const id=s.replace('#',''); if(!n[id]) n[id]=node(id); return n[id]};
      let saves=0, opens=0, native={isNativeAndroid:()=>true}, status={notifications:'granted',notificationsGranted:true,scheduledAlarmIds:[],exactAlarm:'granted'};
      let bridge={scheduleAlarm:async x=>{schedules.push(x);return {triggerAt:Date.now()+x.delayMs,mode:'alarmClock'}},activeAlarmDeliveries:async()=>({alarms:[]}),stopAlarmDelivery:async x=>{stops.push(x);return {stopped:true}},lastAlarmDelivery:async()=>null};
      const st={settings:{notify:true,setupPromptStarted:false},items:[]};
      const feedback={TEST_FEEDBACK:[{value:'heard',label:'我听到了'},{value:'missed',label:'没收到'}],testFeedbackVerdict:v=>v?{text:v}:null,setupSteps:(_s,ctx)=>({steps:[{id:'background',title:'后台',why:'why',denyImpact:'impact',done:!!ctx.backgroundVisited},{id:'test',title:'测试',why:'why',denyImpact:'impact',done:false}],next:{id:'background'}})};
      const d={query:q,queryAll:()=>[],openSheet:()=>{opens++},toast:(...x)=>toasts.push(x),escapeHtml:x=>String(x),fmtTime:x=>String(x),writeIfChanged:(e,h)=>{const changed=e.innerHTML!==h;e.innerHTML=h;return changed},getState:()=>st,save:()=>{saves++},renderMe(){},systemBridge:()=>bridge,getNativeReminders:()=>native,getNativeReminderStatus:()=>status,setNativeReminderStatus:x=>{status=x},getFeedback:()=>feedback,labLog(){},labCancelAlarms:async()=>({ok:true}),describeAlarmDelivery:x=>x.title,openBackgroundGuide:async()=>true,openSystemSetting:async()=>true,isNativeAndroidRuntime:()=>true};
      const x=S(d); x.noteFirstRemindSaved({triggerAt:Date.now()+60000}); x.renderSetupEntry(); x.renderSetupEntry();
      const entry=(events.setupEntry||[]), entryFn=entry[0]&&entry[0].fn; if(entryFn)entryFn();
      x.bind();x.bind(); const staticBind=(events.btnSetup||[]).length===1;
      await x.runSetupStep('background'); const stepMoved=st.settings.backgroundVisited===true;
      const started=await x.startSetupTestRun(), first=st.settings.testRun;
      bridge={scheduleAlarm:async()=>{throw new Error('schedule failed')},activeAlarmDeliveries:async()=>({alarms:[]}),stopAlarmDelivery:async()=>({stopped:true}),lastAlarmDelivery:async()=>null};
      const failed=await x.startSetupTestRun(); const failedRecovered=failed===false&&st.settings.testRun===first;
      first.startedAt=5000; first.seenAt=null; bridge={lastAlarmDelivery:async()=>({at:4000,title:'安心收件箱闹钟测试'})}; const old=await x.setupEvidenceHtml();
      bridge={lastAlarmDelivery:async()=>({at:6000,title:'业务提醒'})}; const wrong=await x.setupEvidenceHtml();
      bridge={lastAlarmDelivery:async()=>({at:6000,title:'安心收件箱闹钟测试'}),scheduleAlarm:async x=>({triggerAt:Date.now()+x.delayMs})}; const current=await x.setupEvidenceHtml();
      st.settings.testFeedback={value:'heard',at:1}; await x.startSetupTestRun(); const feedbackIsolated=!/chip on/.test(x.testFeedbackButtonsHtml());
      const run=st.settings.testRun; bridge={activeAlarmDeliveries:async()=>{throw new Error('read failed')},stopAlarmDelivery:async()=>({stopped:false})}; await x.stopSetupTestRun(); const readFailed=!run.stoppedAt&&/读不到铃声状态/.test(toasts[toasts.length-1][0]);
      bridge={activeAlarmDeliveries:async()=>({alarms:[]}),stopAlarmDelivery:async()=>({stopped:true})}; await x.stopSetupTestRun(); const emptyConfirmed=!!run.stoppedAt;
      run.stoppedAt=null; bridge={activeAlarmDeliveries:async()=>({alarms:[{id:90003,token:'this-run',receivedAt:run.startedAt+1}]}),stopAlarmDelivery:async x=>{stops.push(x);return {stopped:true}}}; const trulyStopped=await x.stopSetupTestRun();
      return {entryAfterRealSave:(events.setupEntry||[]).length===1,entryNoDuplicate:(events.setupEntry||[]).length===1,opened:opens===1,staticBind,stepMoved,started:started===true,schedule60:schedules.length===1&&schedules[0].id===90003&&schedules[0].delayMs===60000,failedRecovered,oldIgnored:/还没有记录/.test(old),wrongIgnored:/还没有记录/.test(wrong),currentSeen:!!first.seenAt&&/本次测试投递/.test(current),feedbackIsolated,readFailed,emptyConfirmed,trulyStopped:trulyStopped===1&&!!run.stoppedAt&&stops.some(x=>x.token==='this-run'),saves};
    })()""")
    out["cases"].append({"name":"fake-android-full-setup","value":fake});
    required=("entryAfterRealSave","entryNoDuplicate","opened","staticBind","stepMoved","started","schedule60","failedRecovered","oldIgnored","wrongIgnored","currentSeen","feedbackIsolated","readFailed","emptyConfirmed","trulyStopped")
    if not fake or not all(fake.get(k) is True for k in required): out["failures"].append("fake-android-full-setup")
  finally:
    (OUT/"browser-setup.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n"); p.terminate(); srv.shutdown()
  print(json.dumps(out,ensure_ascii=False)); return 1 if out["failures"] else 0
if __name__=="__main__": raise SystemExit(main())
