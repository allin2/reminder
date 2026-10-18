# -*- coding: utf-8 -*-
"""Actual review-list DOM, authoritative IDB, failure/retry and viewport regression.
Fresh browser profile only; no device or existing user data is touched.
REVIEW_RUN_DIR optionally preserves screenshots and structured results.
"""
import base64, http.server, json, os, pathlib, subprocess, tempfile, threading, time, urllib.request, websocket

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(k, None)
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(os.environ.get("REVIEW_RUN_DIR", tempfile.mkdtemp(prefix="review-list-evidence-")))
OUT.mkdir(parents=True, exist_ok=True)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        p = ROOT / (self.path.split("?", 1)[0].lstrip("/") or "index.html")
        if p.name == 'index.html' and os.environ.get('REVIEW_BASELINE_HTML'):
            p = pathlib.Path(os.environ['REVIEW_BASELINE_HTML'])
        if not p.is_file() or p.name == "sw.js": self.send_error(404); return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8' if p.suffix == '.html' else 'application/javascript; charset=utf-8')
        self.end_headers(); self.wfile.write(p.read_bytes())
class C:
    def __init__(self, u): self.w=websocket.create_connection(u,timeout=25); self.i=0
    def call(self, method, params=None):
        self.i+=1; self.w.send(json.dumps({'id':self.i,'method':method,'params':params or {}}))
        while True:
            r=json.loads(self.w.recv())
            if r.get('id')==self.i:
                if 'error' in r: raise RuntimeError(r['error'])
                return r.get('result',{})
    def e(self, js):
        r=self.call('Runtime.evaluate',{'expression':js,'returnByValue':True,'awaitPromise':True})
        if 'exceptionDetails' in r: raise RuntimeError(json.dumps(r['exceptionDetails'],ensure_ascii=False))
        return r.get('result',{}).get('value')
    def shot(self, name):
        (OUT/name).write_bytes(base64.b64decode(self.call('Page.captureScreenshot',{'format':'png'})['data']))
srv=http.server.ThreadingHTTPServer(('127.0.0.1',0),H)
threading.Thread(target=srv.serve_forever,daemon=True).start()
profile=tempfile.mkdtemp(prefix='review-list-chrome-')
p=subprocess.Popen([CHROME,'--headless=new',f'--user-data-dir={profile}','--remote-debugging-port=0','--remote-allow-origins=*','--no-first-run','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    for _ in range(100):
        portfile=pathlib.Path(profile)/'DevToolsActivePort'
        if portfile.exists(): break
        time.sleep(.1)
    port=int(portfile.read_text().splitlines()[0])
    tabs=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
    c=C(next(t for t in tabs if t.get('type')=='page')['webSocketDebuggerUrl'])
    c.call('Page.enable');c.call('Runtime.enable')
    c.call('Page.navigate',{'url':f'http://127.0.0.1:{srv.server_port}/index.html'})
    for _ in range(100):
        if c.e('!!window.__ATTENTION_INBOX__'): break
        time.sleep(.05)
    c.e('''(async()=>{
      window.a=window.__ATTENTION_INBOX__; await a.ready();
      window.q=s=>document.querySelector(s);
      window.check=(v,m)=>{if(!v)throw Error(m)};
      window.until=async f=>{for(let i=0;i<160;i++){if(await f())return;await new Promise(r=>setTimeout(r,25));}throw Error('condition timeout '+f)};
      window.click=s=>{const e=q(s);check(e,'missing '+s);check(!e.disabled,'disabled '+s);e.click()};
      window.item=id=>a.state.items.find(x=>x.id===id);
      window.disk=async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('attention-inbox',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});try{return await new Promise((res,rej)=>{const r=db.transaction('kv','readonly').objectStore('kv').get('state');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}finally{db.close()}};
      a.state.settings.notify=false;
      a.state.items=Array.from({length:22},(_,i)=>a.makeItem({id:'review-ui-'+i,title:i===0?'了解一下 Horolog 的调度设计':'功能体检记录 '+(i+1),note:'仅供隔离体检',sourceApp:'随手记录',createdAt:Date.now()+i,status:'waiting',review_status:'NEEDS_REVIEW',isFallbackTrigger:i%2===0,triggerAt:i%2===0?null:Date.now()+86400123,deadlineAt:i===1?Date.now()+3*86400000:null}));
      await a.saveAsync();a.renderHome();click('#openReview');
      await until(()=>q('#sheetReview').classList.contains('open'));
      check(document.querySelectorAll('.review-row').length===22,'22 list rows');
      return true;
    })()''')
    # D5-ENTRY-COVERED: nearest scrolling must stop above BOTH fixed controls.
    c.e("window.entryBaseline={items:a.state.items,review:JSON.parse(JSON.stringify(a.state.settings.review))};click('[data-close=\"sheetReview\"]');a.state.settings.review.hour=0;a.state.settings.review.minute=0;a.state.settings.review.windowEndHour=0;a.state.settings.review.windowEndMinute=0;a.state.settings.review.snoozedUntil=0;true")
    entry_checks=[]
    for w,h,safe,font in [(360,742,0,16),(360,640,24,16),(390,844,0,20),(768,1024,0,16)]:
        c.call('Emulation.setDeviceMetricsOverride',{'width':w,'height':h,'deviceScaleFactor':1,'mobile':w<500})
        for count in [0,6]:
            c.e(f"document.documentElement.style.setProperty('--safe-b','{safe}px');document.documentElement.style.fontSize='{font}px';a.state.items=entryBaseline.items.concat(Array.from({{length:{count}}},(_,i)=>a.makeItem({{id:'entry-due-'+i,title:'入口滚动验证 '+i,status:'due',review_status:'READY',isFallbackTrigger:false,triggerAt:Date.now()-60000}})));a.renderHome();true")
            time.sleep(.35)
            for selector in ['#openReview'] + (['#homeDue .card:last-child button'] if count else []):
                geo=c.e('''(s=>{q('.main').scrollTop=0;const e=q(s);e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),n=q('.nav').getBoundingClientRect(),f=q('.fab').getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {selector:s,top:r.top,bottom:r.bottom,x,y,navTop:n.top,fabTop:f.top,reachable:e===hit||e.contains(hit),root:document.scrollingElement.scrollTop,shell:q('#app').scrollTop}})('''+json.dumps(selector)+')')
                geo.update(width=w,height=h,safe=safe,font=font,due=count)
                entry_checks.append(geo)
                assert geo['reachable'] and geo['bottom']<=geo['fabTop'] and geo['root']==geo['shell']==0,geo
                if selector=='#openReview':
                    c.call('Input.dispatchMouseEvent',{'type':'mousePressed','x':geo['x'],'y':geo['y'],'button':'left','clickCount':1})
                    c.call('Input.dispatchMouseEvent',{'type':'mouseReleased','x':geo['x'],'y':geo['y'],'button':'left','clickCount':1})
                    assert c.e("q('#sheetReview').classList.contains('open')"),geo
                    c.e("click('[data-close=\"sheetReview\"]');true");time.sleep(.35)
            c.shot(f'entry-{w}-{count}.png')
    c.e("document.documentElement.style.removeProperty('--safe-b');document.documentElement.style.fontSize='';a.state.items=entryBaseline.items;a.state.settings.review=entryBaseline.review;a.renderHome();a.openReviewSession();true")
    sizes=[]
    for w,h in [(360,736),(390,844),(768,1024),(1280,800)]:
        c.call('Emulation.setDeviceMetricsOverride',{'width':w,'height':h,'deviceScaleFactor':1,'mobile':w<500})
        time.sleep(.35)
        geo=c.e('''(()=>{const b=q('#reviewBody').getBoundingClientRect(),f=q('#reviewFoot').getBoundingClientRect(),s=q('#sheetReview').getBoundingClientRect();return {width:innerWidth,height:innerHeight,visible:[...document.querySelectorAll('.review-row')].filter(e=>{const r=e.getBoundingClientRect();return r.top>=b.top-.5&&r.bottom<=b.bottom+.5}).length,listHeight:b.height,footerInside:f.bottom<=s.bottom+1,horizontal:document.documentElement.scrollWidth>innerWidth,root:document.scrollingElement.scrollTop,shell:q('#app').scrollTop}})()''')
        assert geo['visible'] >= (4 if w==360 else 5),geo
        assert geo['footerInside'] and not geo['horizontal'] and geo['root']==geo['shell']==0,geo
        sizes.append(geo);c.shot(f'review-list-{w}.png')
    c.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
    overlap=c.e('''(()=>{const it=a.state.items[0];a.alerts.showAlert(it);const e=q('[data-review-filter="kept"]'),r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);const ok=e===h||e.contains(h);click('[data-close="sheetReview"]');const still=q('#alertBanner').classList.contains('show')&&a.alerts.getAlertItem()?.id===it.id;a.alerts.hideAlert();a.openReviewSession();return {filterReachableWithBanner:ok,bannerPreservedOnClose:still}})()''')
    assert overlap['filterReachableWithBanner'] and overlap['bannerPreservedOnClose'],overlap
    time.sleep(.35)

    c.e("document.documentElement.style.fontSize='20px';true")
    large=c.e("(()=>{const f=q('#reviewFoot').getBoundingClientRect();return {horizontal:document.documentElement.scrollWidth>innerWidth,footerVisible:f.bottom<=innerHeight,rows:document.querySelectorAll('.review-row').length}})()")
    assert not large['horizontal'] and large['footerVisible'],large
    c.shot('review-large-text.png');c.e("document.documentElement.style.fontSize='';true")
    result=c.e('''(async()=>{
      const out=[];
      const filter=v=>click('[data-review-filter="'+v+'"]');
      const primary=id=>click('[data-review-primary="review-ui-'+id+'"]');
      const more=id=>click('[data-review-more="review-ui-'+id+'"]');
      const edit=id=>click('[data-review-edit="review-ui-'+id+'"]');
      const change=(sel,value)=>{q(sel).value=value;q(sel).dispatchEvent(new Event('change',{bubbles:true}))};
      filter('noTime');check(document.querySelectorAll('.review-row').length===11,'no-time filter');filter('pending');
      const originalAt=item('review-ui-1').triggerAt;
      primary(1);q('[data-review-primary="review-ui-1"]').click();await until(()=>!q('[data-review-id="review-ui-1"]'));
      check(item('review-ui-1').review_status==='REVIEWED'&&item('review-ui-1').status==='waiting','review != completion');
      check(!item('review-ui-1').acknowledgedAt&&!item('review-ui-1').completedAt,'no ACK/completion');
      check(item('review-ui-1').triggerAt===originalAt,'seconds unchanged');
      check((await disk()).items.find(x=>x.id==='review-ui-1').review_status==='REVIEWED','authoritative save');
      const undo=q('#toastAction'),ur=undo.getBoundingClientRect(),uh=document.elementFromPoint(ur.x+ur.width/2,ur.y+ur.height/2);check(undo===uh||undo.contains(uh),'undo actually reachable above list');
      click('#toastAction');await until(()=>item('review-ui-1').review_status==='NEEDS_REVIEW');await until(()=>q('[data-review-id="review-ui-1"]'));out.push('confirm_single_commit_undo');
      more(0);click('#reviewKeep');check(item('review-ui-0').review_status==='NEEDS_REVIEW','keep retains status');
      filter('kept');check(document.querySelectorAll('.review-row').length===1,'kept filter');primary(0);filter('pending');check(document.querySelectorAll('.review-row').length===22,'kept restored');out.push('keep_restore_filters');
      edit(0);check(q('#reviewTrigger').value==='','fallback not prefilled');change('#reviewTitle','修改后的功能体检记录');change('#reviewTrigger','2030-01-02T09:00');change('#reviewNote','已编辑备注');
      click('#reviewSave');await until(()=>!q('#sheetReviewEdit').classList.contains('open'));await until(()=>!q('[data-review-id="review-ui-0"]'));
      check(item('review-ui-0').title==='修改后的功能体检记录'&&!item('review-ui-0').isFallbackTrigger,'edit adopts real time');
      check(item('review-ui-0').triggerAt===new Date('2030-01-02T09:00').getTime(),'explicit time');out.push('edit_confirm');
      edit(2);click('#reviewSave');await until(()=>!q('#sheetReviewEdit').classList.contains('open'));
      check(item('review-ui-2').isFallbackTrigger&&item('review-ui-2').triggerAt>Date.now(),'no-time stays fallback');out.push('no_time_confirm');
      edit(3);click('[data-review-time="clear"]');click('#reviewSave');await until(()=>!q('#sheetReviewEdit').classList.contains('open'));
      check(item('review-ui-3').isFallbackTrigger,'clear uses fallback');out.push('explicit_clear');
      // Fault injection is restricted to this isolated browser database.
      edit(4);change('#reviewTitle','失败后保留草稿');const before=JSON.stringify(item('review-ui-4'));const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(){throw Error('review-ui-forced-idb-failure')};
      click('#reviewSave');await until(()=>q('#toastText').textContent.includes('整理未保存'));
      check(q('#sheetReviewEdit').classList.contains('open')&&!q('#reviewSave').disabled,'retryable editor');
      check(q('#reviewTitle').value==='失败后保留草稿'&&JSON.stringify(item('review-ui-4'))===before,'failed save restores item and keeps form');
      check((await disk()).items.find(x=>x.id==='review-ui-4').review_status==='NEEDS_REVIEW','disk unchanged after failure');
      IDBObjectStore.prototype.put=put;click('#reviewSave');await until(()=>!q('#sheetReviewEdit').classList.contains('open'));check(item('review-ui-4').title==='失败后保留草稿','retry persisted');out.push('save_failure_draft_rollback_retry');
      more(5);click('#reviewDelete');click('#reviewDeleteCancel');check(!!item('review-ui-5'),'delete canceled');
      click('#reviewDelete');click('#reviewDeleteConfirm');await until(()=>!q('#sheetReviewActions').classList.contains('open'));
      check(!item('review-ui-5')&&!(await disk()).items.some(x=>x.id==='review-ui-5'),'delete committed');
      click('#toastAction');await until(()=>!!item('review-ui-5'));await until(()=>!!q('[data-review-id="review-ui-5"]'));out.push('delete_confirm_cancel_undo');
      more(6);click('#reviewDelete');IDBObjectStore.prototype.put=function(){throw Error('review-delete-forced-idb-failure')};
      click('#reviewDeleteConfirm');await until(()=>q('#toastText').textContent.includes('删除未保存'));
      check(!!item('review-ui-6')&&q('#sheetReviewActions').classList.contains('open'),'delete failure restores and remains open');
      IDBObjectStore.prototype.put=put;click('[data-review-close="sheetReviewActions"]');out.push('delete_save_failure');
      // Editor revision guard: an independent event changed the item, so a stale form cannot overwrite it.
      edit(7);change('#reviewTitle','过期表单');item('review-ui-7').title='并发事件更新';item('review-ui-7').rev++;click('#reviewSave');
      check(item('review-ui-7').title==='并发事件更新'&&item('review-ui-7').review_status==='NEEDS_REVIEW','stale editor rejected');click('[data-review-close="sheetReviewEdit"]');out.push('stale_editor_guard');
      const list=q('#reviewBody');list.scrollTop=220;const top=list.scrollTop;edit(8);click('[data-review-close="sheetReviewEdit"]');check(list.scrollTop===top,'cancel preserves list position');
      q('#app').scrollTop=500;document.scrollingElement.scrollTop=500;check(q('#app').scrollTop===0&&document.scrollingElement.scrollTop===0,'root remains fixed');out.push('internal_scroll_and_cancel_restore');
      click('#reviewSnooze');click('[data-snooze-review="1800000"]');await until(()=>!q('#sheetReview').classList.contains('open'));check(a.state.settings.review.sessionStatus==='snoozed','session snoozed');
      a.openReviewSession();const remaining=a.needsReviewItems().length;click('#reviewSkip');await until(()=>!q('#sheetReview').classList.contains('open'));check(a.needsReviewItems().length===remaining&&a.state.settings.review.sessionStatus==='skipped','skip preserves queue');
      a.openReviewSession();check(document.querySelectorAll('.review-row').length===remaining,'reenter remaining only');out.push('session_snooze_skip_reenter');
      const previous=JSON.stringify(a.state.settings.review);
      IDBObjectStore.prototype.put=function(){throw Error('review-session-save-failure')};click('#reviewSkip');
      await until(()=>q('#toastText').textContent.includes('整理安排未保存'));
      check(q('#sheetReview').classList.contains('open')&&JSON.stringify(a.state.settings.review)===previous,'failed session save preserves queue and settings');
      IDBObjectStore.prototype.put=put;out.push('session_save_failure');
      primary(17);filter('kept');await until(async()=>(await disk()).items.find(x=>x.id==='review-ui-17').review_status==='REVIEWED');
      filter('pending');await until(()=>!q('[data-review-id="review-ui-17"]'));check(item('review-ui-18').review_status==='NEEDS_REVIEW','filter during commit cannot affect another ID');out.push('filter_during_commit_item_identity');
      await a.saveAsync();return {checks:out,remaining:a.needsReviewItems().length};
    })()''')
    c.e("document.querySelector('#reviewBody').scrollTop=0;document.querySelector('[data-review-edit]').focus({preventScroll:true});document.querySelector('[data-review-edit]').click();true")
    time.sleep(.35);c.shot('review-edit.png')
    # Keyboard Escape closes the actual edit overlay and releases the parent's inert state.
    c.call('Input.dispatchKeyEvent',{'type':'keyDown','key':'Escape','code':'Escape','windowsVirtualKeyCode':27})
    assert c.e("!q('#sheetReviewEdit').classList.contains('open')&&!q('#sheetReview').inert&&!!document.activeElement.dataset.reviewEdit")
    c.e('location.reload();true');time.sleep(.7)
    remaining=c.e('(async()=>{const a=window.__ATTENTION_INBOX__;await a.ready();a.openReviewSession();return {pending:a.needsReviewItems().length,rows:document.querySelectorAll(".review-row").length,reviewed:a.state.items.filter(x=>x.review_status==="REVIEWED").length}})()')
    assert remaining['pending']==result['remaining']==remaining['rows'] and remaining['reviewed']==5,remaining
    c.shot('review-reloaded.png')
    output={'status':'PASS','scope':'actual product DOM in isolated Chrome, not device evidence','entryChecks':entry_checks,'sizes':sizes,'largeText':large,'simultaneousBanner':overlap,'behavior':result,'reload':remaining,'escapeReleasesParent':True}
    (OUT/'browser-review-result.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(output,ensure_ascii=False,indent=2));print('Evidence:',OUT)
except Exception as err:
    (OUT/'browser-review-failure.txt').write_text(str(err),encoding='utf-8')
    try: c.shot('browser-review-failure.png')
    except Exception: pass
    raise
finally:
    p.terminate();p.wait(timeout=15);srv.shutdown()
