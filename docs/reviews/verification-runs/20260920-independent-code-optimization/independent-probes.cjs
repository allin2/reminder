'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),Module=require('module');
const ROOT=process.argv[2];if(!ROOT)throw Error('Pass isolated source root');
const boot=require(path.join(ROOT,'test-boot-combination.js'));
const results=[];const wait=ms=>new Promise(r=>setTimeout(r,ms));
function record(name,pass,detail){results.push({name,pass,detail})}
async function until(fn,label){for(let i=0;i<150;i++){if(fn())return;await wait(10)}throw Error('timeout '+label)}
(async()=>{
 // Source-independent outcome assertions on real application functions; harness only supplies peripherals.
 for(const label of ['current','pre-edit']){
  const overrides=label==='pre-edit'?{'app-core.js':'docs/reviews/verification-runs/20260920T1706-code-optimization/pre-edit/app-core.js'}:undefined;
  const h=await boot.bootCombination({overrides});const a=h.app;
  a.state.items=[a.makeItem({id:'tags',title:'tags',status:'acknowledged',triggerAt:Date.now()+86400000,tags:['work,home']})];a.state.ui.activeExpanded=true;a.renderHome();
  const oldHtml=h.node('#homeActive').innerHTML;a.state.items[0].tags=['work','home'];a.renderHome();
  const newHtml=h.node('#homeActive').innerHTML;
  record('tags refresh '+label,newHtml!==oldHtml && newHtml.includes('#work</span>')&&newHtml.includes('#home</span>'),{before:oldHtml.match(/<span class="pill tag">.*?<\/span>/g),after:newHtml.match(/<span class="pill tag">.*?<\/span>/g)});
 }
 const h=await boot.bootCombination(); const a=h.app;
 a.state.settings.notify=true;a.state.settings.dnd=false;
 const bridge=h.env.capacitor.Plugins.SystemBridge;const orig=bridge.scheduleAlarm;
 let release,entered=false; const gate=new Promise(r=>release=r); let hold=true;
 bridge.scheduleAlarm=async arg=>{if(hold){hold=false;entered=true;await gate}return orig(arg)};
 const it=a.makeItem({id:'race',title:'race',priority:'important',delivery_mode:'alarm',triggerAt:Date.now()+3600000,status:'waiting'});a.state.items=[it];await a.saveAsync();
 await until(()=>entered,'first schedule');const newAt=Date.now()+7200000;
 const snoozeResult=a.snoozeItem('race',newAt);await a.saveAsync();release();
 await until(()=>h.env.calls.scheduleAlarm.length>=2,'compensating schedule');await wait(300);
 const expected=h.exportOf('AttentionNativeReminders').buildDesired(a.state.items,a.state.settings,Date.now()).filter(n=>n.extra.useAlarm).map(n=>n.id).sort();
 record('in-flight reschedule converges',JSON.stringify(expected)===JSON.stringify(a.state.settings.scheduledAlarmIds)&&a.state.items[0].status==='snoozed',{snoozeResult,expected,actual:a.state.settings.scheduledAlarmIds,metrics:a.nativeSyncStats(),alarms:h.env.calls.scheduleAlarm.map(c=>({id:c.id,delayMs:c.delayMs,itemRev:c.itemRev})),cancel:h.env.calls.cancelAlarm,persistedStatus:h.disk.idbValue.items[0].status});
 const restart=await boot.bootCombination({seedState:h.disk.idbValue});record('reschedule survives restart',restart.app.state.items[0].status==='snoozed'&&restart.app.state.items[0].triggerAt===a.state.items[0].triggerAt,{status:restart.app.state.items[0].status});
 // FIFO snapshot timing: second write must observe state when it reaches the gate.
 const q=await boot.bootCombination();q.app.state.items=[q.app.makeItem({id:'fifo',title:'A',triggerAt:Date.now()+86400000})];await q.app.saveAsync({deferNativeSync:true});q.disk.holdWrites=true;
 const p1=q.app.saveAsync({deferNativeSync:true});await until(()=>q.disk.held.length===1,'held one');
 const p2=q.app.saveAsync({deferNativeSync:true});q.app.state.items[0].title='B';q.disk.releaseWrites();await p1;await until(()=>q.disk.held.length===1,'held two');
 const first=q.disk.idbValue.items[0].title;q.disk.releaseWrites();await p2;const second=q.disk.idbValue.items[0].title;
 record('FIFO snapshot at execution time',first==='A'&&second==='B',{first,second});

 for(const action of ['completeItem','deleteItem']){
  const x=await boot.bootCombination();const a=x.app;a.state.settings.notify=true;a.state.settings.dnd=false;
  const b=x.env.capacitor.Plugins.SystemBridge;const original=b.scheduleAlarm;
  let release,started=false,once=true;const held=new Promise(r=>release=r);
  b.scheduleAlarm=async v=>{if(once){once=false;started=true;await held}return original(v)};
  a.state.items=[a.makeItem({id:'race-'+action,title:action,priority:'important',status:'waiting',triggerAt:Date.now()+3600000})];await a.saveAsync();await until(()=>started,action+' started');
  a[action]('race-'+action);await a.saveAsync();release();await until(()=>x.env.calls.cancelAlarm.length>0,action+' cancelled');await wait(200);
  const terminal=action==='deleteItem'?a.state.items.length===0:a.state.items[0].status==='archived';
  record('in-flight '+action+' cancels old plan',terminal && a.state.settings.scheduledAlarmIds.length===0,{state:a.state.items.map(it=>it.status),ids:a.state.settings.scheduledAlarmIds,cancels:x.env.calls.cancelAlarm,metrics:a.nativeSyncStats()});
  const reboot=await boot.bootCombination({seedState:x.disk.idbValue});record(action+' persists restart',action==='deleteItem'?reboot.app.state.items.length===0:reboot.app.state.items[0].status==='archived',{state:reboot.app.state.items.map(it=>it.status)});
 }
 // Cancel failure retains old ID for a later retry, rather than forgetting it.
 {
  const x=await boot.bootCombination();const a=x.app;a.state.settings.notify=true;a.state.settings.dnd=false;
  a.state.items=[a.makeItem({id:'cancel-fail',title:'cancel-fail',priority:'important',triggerAt:Date.now()+3600000})];await a.saveAsync();await until(()=>x.env.calls.scheduleAlarm.length>0,'initial alarm');await wait(100);
  const oldId=a.state.settings.scheduledAlarmIds[0],b=x.env.capacitor.Plugins.SystemBridge,original=b.cancelAlarm;let reject=true,attempts=0;
  b.cancelAlarm=async v=>{attempts++;if(reject)throw Error('injected cancel failure');return original(v)};
  a.deleteItem('cancel-fail');await until(()=>attempts>0,'cancel failure');await wait(100);const retained=a.state.settings.scheduledAlarmIds.includes(oldId);
  reject=false;await a.saveAsync();await until(()=>x.env.calls.cancelAlarm.length>0,'cancel retry');await wait(100);
  record('cancel failure retry retains then clears ID',retained && a.state.settings.scheduledAlarmIds.length===0,{retained,ids:a.state.settings.scheduledAlarmIds,attempts});
 }
 // Force only the storage backend to memory; application code remains the delivery bytes.
 {
  const file=path.join(__dirname,'storage-memory-fixture.js');
  fs.writeFileSync(file,fs.readFileSync(path.join(ROOT,'lib/storage.js'),'utf8').replace('let forceMemory = !!opts.forceMemory;','let forceMemory = true; // independent fixture'));
  const x=await boot.bootCombination({overrides:{'lib/storage.js':file}});const a=x.app;
  a.state.items=[a.makeItem({id:'mem',title:'persisted',status:'waiting',rev:1,triggerAt:Date.now()+86400000})];await a.saveAsync({deferNativeSync:true});
  a.state.items[0].title='unsaved';a.state.items[0].status='archived';
  x.env.calls.activeAlarms=[{id:990,itemId:'mem',itemRev:1,token:'mem:1'}];x.fireDocumentEvent('visibilitychange');await wait(30);const stopped=x.env.calls.stopAlarmDelivery.length;
  await a.loadAsync();record('memory backend snapshot isolated after load',a.state.items[0].title==='persisted'&&a.state.items[0].status==='waiting'&&stopped===0,{title:a.state.items[0].title,status:a.state.items[0].status,stopped});
 }

 // Runtime proof of the older regression harness injection, without running its suite.
 let src=fs.readFileSync(path.join(ROOT,'test-regressions.js'),'utf8').split('async function run() {')[0];src=src.replace('    app,\n    disk,','    app,\n    nativeInjected:sandbox.AttentionNativeReminders,\n    disk,');src+='\nmodule.exports={createApp};';
 const m=new Module(path.join(ROOT,'__independent-regression-probe.cjs'));m.filename=path.join(ROOT,'__independent-regression-probe.cjs');m.paths=Module._nodeModulePaths(ROOT);m._compile(src,m.filename);
 const reg=m.exports.createApp();await reg.boot();record('regression native actually injected',typeof reg.nativeInjected.reconcile==='function'&&typeof reg.nativeInjected.onAlarmAction==='function',{reconcile:typeof reg.nativeInjected.reconcile,onAlarmAction:typeof reg.nativeInjected.onAlarmAction,isNativeAndroid:reg.nativeInjected.isNativeAndroid()});
 console.log(JSON.stringify({node:process.version,results},null,2));process.exit(results.some(r=>!r.pass)?1:0);
})().catch(e=>{console.error(e.stack);console.log(JSON.stringify({results},null,2));process.exit(1)});
