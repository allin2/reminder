import base64,json,pathlib,subprocess,threading,time,urllib.request,http.server,websocket
RUN=pathlib.Path(__file__).resolve().parent
ROOT=RUN/'snapshot'
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  route=self.path.split('?',1)[0].strip('/').split('/',1)
  case=route[0]; rel=route[1] if len(route)>1 else 'index.html'
  file=ROOT/rel
  if not file.is_file() or rel=='sw.js' or (case=='missing-parser' and rel=='lib/parse-cn.js'):
   self.send_error(404);return
  data=file.read_bytes()
  if case=='parser-after-core' and rel=='index.html':
   data=data.replace(b'<script src="lib/parse-cn.js"></script>',b'').replace(b'<script src="app-core.js"></script>',b'<script src="app-core.js"></script><script src="lib/parse-cn.js"></script>')
  patches={('feedback-member','lib/feedback.js'):'delete AttentionLib.Feedback.setupSteps;',('feedback-null','lib/feedback.js'):'AttentionLib.Feedback=null;',('incomplete-ui','lib/app-ui.js'):'AttentionLib.AppUi.createUi=()=>({});'}
  if (case,rel) in patches:data+=('\n'+patches[case,rel]).encode()
  self.send_response(200);self.send_header('Content-Type','text/html' if rel.endswith('.html') else 'text/javascript' if rel.endswith('.js') else 'application/octet-stream');self.end_headers();self.wfile.write(data)
class CDP:
 def __init__(self,url):self.ws=websocket.create_connection(url,origin='http://localhost:18762',timeout=10);self.i=0
 def call(self,method,params=None):
  self.i+=1;self.ws.send(json.dumps({'id':self.i,'method':method,'params':params or {}}))
  while True:
   r=json.loads(self.ws.recv())
   if r.get('id')==self.i:
    if 'error' in r:raise RuntimeError(r['error'])
    return r.get('result',{})
 def evaluate(self,expression):
  r=self.call('Runtime.evaluate',{'expression':expression,'awaitPromise':True,'returnByValue':True})
  if 'exceptionDetails' in r:return {'exception':r['exceptionDetails']}
  return r.get('result',{}).get('value')
server=http.server.ThreadingHTTPServer(('127.0.0.1',18761),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
log=open(RUN/'chrome.log','a')
proc=subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','--headless=new','--remote-debugging-port=18762','--remote-allow-origins=http://localhost:18762','--user-data-dir='+str(RUN/'browser-profile'),'--no-first-run','--no-default-browser-check','about:blank'],stdout=log,stderr=log)
results=[]
try:
 for _ in range(60):
  try: info=json.load(urllib.request.urlopen('http://127.0.0.1:18762/json/version'));break
  except Exception:time.sleep(.1)
 browser=CDP(info['webSocketDebuggerUrl'])
 for case in ['parser-after-core']:
  ctx=browser.call('Target.createBrowserContext')['browserContextId']
  target=browser.call('Target.createTarget',{'url':'about:blank','browserContextId':ctx})['targetId']
  tabs=json.load(urllib.request.urlopen('http://127.0.0.1:18762/json/list')); tab=next(t for t in tabs if t['id']==target); c=CDP(tab['webSocketDebuggerUrl'])
  c.call('Page.enable');c.call('Runtime.enable');c.call('Emulation.setDeviceMetricsOverride',{'width':420,'height':850,'deviceScaleFactor':1,'mobile':True})
  c.call('Page.addScriptToEvaluateOnNewDocument',{'source':"window.__audit={errors:[],opens:0,puts:0,intervals:[]};addEventListener('error',e=>__audit.errors.push(e.message));const ce=console.error;console.error=(...x)=>{__audit.errors.push(x.map(String).join(' '));ce(...x)};const op=indexedDB.open.bind(indexedDB);indexedDB.open=(...x)=>{__audit.opens++;return op(...x)};const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...x){__audit.puts++;return put.apply(this,x)};const si=setInterval;setInterval=(fn,ms,...x)=>{__audit.intervals.push(ms);return si(fn,ms,...x)};Object.defineProperty(navigator,'serviceWorker',{value:undefined});"})
  c.call('Page.navigate',{'url':'http://127.0.0.1:18761/'+case+'/index.html'});time.sleep(.6)
  expression="(async()=>({ready:await window.__ATTENTION_INBOX__?.ready(),failure:window.__ATTENTION_INBOX__?.startupFailure(),panel:!!document.querySelector('#startup-dependency-failure'),panelText:document.querySelector('#startup-dependency-failure')?.innerText,visibleInputs:[...document.querySelectorAll('input,textarea')].filter(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0).map(e=>e.id),audit:__audit}))()"
  row={'case':case,'initial':c.evaluate(expression)}
  (RUN/(case+'-initial.png')).write_bytes(base64.b64decode(c.call('Page.captureScreenshot',{'format':'png'})['data']))
  if case=='parser-after-core':
   row['capture']=c.evaluate("(()=>{document.querySelector('#fab').click();let t=document.querySelector('#capText');t.value='三分钟后提醒我独立验收';t.dispatchEvent(new Event('input',{bubbles:true}));return {open:document.querySelector('#sheetItem').classList.contains('open'),value:t.value}})()")
   time.sleep(.5)
   row['saveClick']=c.evaluate("(()=>{document.querySelector('#btnSaveItem').click();return true})()")
   time.sleep(.5)
   row['saved']=c.evaluate("(async()=>{await __ATTENTION_INBOX__.saveAsync();return {items:__ATTENTION_INBOX__.state.items.map(x=>({id:x.id,title:x.title,status:x.status,scheduleBasis:x.scheduleBasis})),audit:__audit}})()")
   c.call('Page.reload');time.sleep(.5)
   row['reloaded']=c.evaluate("(async()=>{await __ATTENTION_INBOX__.ready();return {items:__ATTENTION_INBOX__.state.items.map(x=>({id:x.id,title:x.title,status:x.status,scheduleBasis:x.scheduleBasis})),audit:__audit}})()")
  if case=='missing-parser':
   row['loadReplacement']=c.evaluate("new Promise(resolve=>{let s=document.createElement('script');s.src='/control/lib/parse-cn.js';s.onload=()=>resolve(true);document.body.append(s)})")
   row['retryClick']=c.evaluate("(()=>{document.querySelector('#startupRetry').click();return true})()")
   time.sleep(.3);row['afterRetry']=c.evaluate(expression)
   row['captureAfterRetry']=c.evaluate("(()=>{document.querySelector('#fab').click();let t=document.querySelector('#capText');t.value='三分钟后提醒我独立验收';t.dispatchEvent(new Event('input',{bubbles:true}));return {parseType:typeof __ATTENTION_INBOX__.parseChineseTime,liveLibParseType:typeof AttentionLib.parseChineseTime}})()")
   time.sleep(.5);row['afterInput']=c.evaluate(expression)
  img=c.call('Page.captureScreenshot',{'format':'png'})['data'];(RUN/(case+'-v2.png')).write_bytes(base64.b64decode(img))
  results.append(row);c.ws.close();browser.call('Target.disposeBrowserContext',{'browserContextId':ctx})
 (RUN/'browser-order.json').write_text(json.dumps({'browser':info['Browser'],'results':results},ensure_ascii=False,indent=2))
 print(json.dumps(results,ensure_ascii=False,indent=2))
finally:
 server.shutdown();proc.terminate();proc.wait(timeout=10);log.close()
