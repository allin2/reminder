#!/usr/bin/env python3
"""Disposable production-page reminder settings behavior and persistence check; no user profile or persistent data."""
import http.server,json,os,pathlib,subprocess,tempfile,threading,time,urllib.request,websocket
for k in ("http_proxy","https_proxy","HTTP_PROXY","HTTPS_PROXY","all_proxy","ALL_PROXY"): os.environ.pop(k,None)
ROOT=pathlib.Path(__file__).resolve().parents[2]; PORT,CDP=19013,19014; CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
class H(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a): pass
 def do_GET(self):
  p=ROOT/(self.path.split("?",1)[0].lstrip("/") or "index.html")
  if not p.is_file() or p.name=="sw.js": self.send_error(404); return
  self.send_response(200);self.end_headers();self.wfile.write(p.read_bytes())
class C:
 def __init__(s,u): s.w=websocket.create_connection(u,timeout=20);s.i=0
 def e(s,x):
  s.i+=1;s.w.send(json.dumps({"id":s.i,"method":"Runtime.evaluate","params":{"expression":x,"awaitPromise":True,"returnByValue":True}}))
  while 1:
   r=json.loads(s.w.recv())
   if r.get("id")==s.i:return r.get("result",{}).get("result",{}).get("value")
srv=http.server.ThreadingHTTPServer(("127.0.0.1",PORT),H);threading.Thread(target=srv.serve_forever,daemon=True).start()
p=subprocess.Popen([CHROME,"--headless=new",f"--user-data-dir={tempfile.mkdtemp(prefix='reminder-settings-')}",f"--remote-debugging-port={CDP}","--remote-allow-origins=*","--no-first-run","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 for _ in range(100):
  try: tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json"));break
  except Exception: time.sleep(.1)
 c=C(next(t for t in tabs if t.get("type")=="page")["webSocketDebuggerUrl"]);c.e(f"location.href='http://127.0.0.1:{PORT}/index.html';true");time.sleep(1.2)

 c.i+=1;c.w.send(json.dumps({'id':c.i,'method':'Emulation.setDeviceMetricsOverride','params':{'width':360,'height':800,'deviceScaleFactor':1,'mobile':True}}))
 while json.loads(c.w.recv()).get('id')!=c.i:pass
 script=r"""(async()=>{
 const a=window.__ATTENTION_INBOX__, q=s=>document.querySelector(s), sleep=ms=>new Promise(r=>setTimeout(r,ms));
 if(!await a.ready()) throw Error('not ready');
 q('[data-tab="me"]').click(); q('#btnAlarmDuration').click();await sleep(350);
 const defaultDuration=q('#alarmDurationMinutes').value==='5';
 q('#alarmDurationMinutes').value='0';q('#btnSaveAlarmDuration').click();await sleep(80);
 const invalid=a.state.settings.alarmDurationMinutes===5 && !q('#btnSaveAlarmDuration').disabled;
 q('#alarmDurationMinutes').value='2';q('#btnSaveAlarmDuration').click();await sleep(180);
 const duration=a.state.settings.alarmDurationMinutes===2 && /2 分钟/.test(q('#alarmDurationSub').textContent);
 q('#btnAlarmDuration').click();await sleep(350);q('#alarmDurationMinutes').value='3';
 const storedSave=a.storage.save; a.storage.save=async()=>{throw Error('injected settings write failure');};
 q('#btnSaveAlarmDuration').click();await sleep(160);
 const failure=a.state.settings.alarmDurationMinutes===2 && !q('#btnSaveAlarmDuration').disabled && /保存失败/.test(document.body.textContent);
 a.storage.save=storedSave;q('#alarmDurationMinutes').value='2';q('#btnSaveAlarmDuration').click();await sleep(120);
 q('#btnQuiet').click();await sleep(350);q('#quietStart').value='23:00';q('#quietEnd').value='07:30';q('#quietNotifyAt').value='02:00';q('#btnSaveQuiet').click();await sleep(80);
 const invalidTime=a.state.settings.quietNotifyAt==='';
 q('#quietNotifyAt').value='09:15';q('#btnSaveQuiet').click();await sleep(180);
 const quiet=a.state.settings.quietNotifyAt==='09:15' && /09:15/.test(q('#dndSub').textContent);
 const stamp=Date.now(),night=new Date(stamp);night.setHours(23,30,0,0);
 const next=new Date(night);next.setDate(next.getDate()+1);next.setHours(8,0,0,0);
 const due=new Date(next);due.setHours(9,15,0,0);
 const row=a.makeItem({id:'settings-test',title:'隔离勿扰测试',triggerAt:+night,priority:'normal'});
 a.state.items=[row];a.state.settings.dnd=true;
 const realNow=Date.now;let held,promoted;
 try {
  Date.now=()=>+next;a.promoteDue(+next);a.renderHome();
  held=row.status==='waiting' && row.triggerAt===+night && !a.isDue(row) && !q('#homeDue [data-id="settings-test"]');
  Date.now=()=>+due;a.promoteDue(+due);a.renderHome();
  promoted=row.status==='due' && row.triggerAt===+night && a.isDue(row);
 } finally {Date.now=realNow;}
 // 持久化仅保留设置；不留下测试事项，关闭后重开核对权威读回。
 a.state.items=[];await a.saveAsync();
 return {defaultDuration,invalid,duration,failure,invalidTime,quiet,held,promoted,overflow:document.documentElement.scrollWidth<=innerWidth};
 })()"""
 out=c.e(script)
 print(json.dumps(out,ensure_ascii=False))
 if not out or not all(out.values()):raise SystemExit(1)
 c.e("location.reload();true");time.sleep(1.2)
 persisted=c.e("(async()=>{const a=window.__ATTENTION_INBOX__;await a.ready();return a.state.settings.alarmDurationMinutes===2 && a.state.settings.quietNotifyAt==='09:15' && a.state.items.length===0;})()")
 print(json.dumps({'persisted_after_reload':persisted}))
 if not persisted:raise SystemExit(1)
 c.e("document.querySelector('[data-tab=me]').click();document.querySelector('#btnQuiet').click();true");time.sleep(.4)
 # 固定手机视口，保存所修改设置面板，供人工视觉检查。
 c.i+=1;c.w.send(json.dumps({'id':c.i,'method':'Emulation.setDeviceMetricsOverride','params':{'width':360,'height':800,'deviceScaleFactor':1,'mobile':True}}))
 while json.loads(c.w.recv()).get('id')!=c.i:pass
 c.i+=1;c.w.send(json.dumps({'id':c.i,'method':'Page.captureScreenshot','params':{'format':'png'}}))
 while True:
  r=json.loads(c.w.recv())
  if r.get('id')==c.i:
   import base64
   pathlib.Path('/tmp/reminder-settings-quiet.png').write_bytes(base64.b64decode(r['result']['data']));break

 c.e("document.querySelector('[data-close=sheetQuiet]').click();true");time.sleep(.4)
 c.e("document.querySelector('#btnAlarmDuration').click();true");time.sleep(.4)
 print(json.dumps(c.e("({height:innerHeight,width:innerWidth,scroll:scrollY,visual:{height:visualViewport.height,top:visualViewport.offsetTop,scale:visualViewport.scale},sheet:JSON.stringify(document.querySelector('#sheetAlarmDuration').getBoundingClientRect()),active:document.activeElement.id})")))
 c.i+=1;c.w.send(json.dumps({'id':c.i,'method':'Page.captureScreenshot','params':{'format':'png'}}))
 while True:
  r=json.loads(c.w.recv())
  if r.get('id')==c.i:
   pathlib.Path('/tmp/reminder-settings-duration.png').write_bytes(base64.b64decode(r['result']['data']));break

finally:p.terminate();srv.shutdown()
