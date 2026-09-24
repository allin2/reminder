const fs=require('fs'), Module=require('module'), path=require('path');
const ROOT=path.resolve(process.argv[2] || path.join(__dirname,'../../../..'));
let harness=fs.readFileSync(path.join(ROOT,'test-regressions.js'),'utf8').split('async function run() {')[0];
harness=harness.replace('    app,\n    disk,','    app,\n    auditNodes: nodes,\n    disk,');
harness+=`\nAPP_SOURCE.code=APP_SOURCE.code.replace('  const KEY =', '  const auditCounts = {home:0,promote:0};\\n  const KEY =').replace('  function renderHome() {','  function renderHome() { auditCounts.home++;').replace('  function promoteDue(now) {','  function promoteDue(now) { auditCounts.promote++;').replace('globalThis.__ATTENTION_INBOX__ = {','globalThis.__ATTENTION_INBOX__ = { audit: {counts:auditCounts, metrics:()=>JSON.parse(JSON.stringify(nativeSyncMetrics)), native:NativeReminders, renderItemCard},');\nmodule.exports={createApp,flush,native,installCapacitor};`;
const m=new Module(path.join(ROOT,'__readonly_audit.cjs'));m.filename=path.join(ROOT,'__readonly_audit.cjs');m.paths=Module._nodeModulePaths(ROOT);m._compile(harness,m.filename);
const {createApp,flush,native}=m.exports;
const out={node:process.version,remarks:'Mock DOM/IDB, live product source plus in-memory observation hooks; no product edits or device execution.'};
(async()=>{
 const h=createApp();const app=await h.boot();
 out.boot={...app.audit.counts,nativeInjected:typeof app.audit.native.reconcile,isNativeAndroid:app.audit.native.isNativeAndroid()};
 let before=app.audit.metrics().totalRequests; await app.save({deferNativeSync:true});
 out.deferOption={passed:true,extraSyncRequests:app.audit.metrics().totalRequests-before};
 const soon=Date.now()+86400000;
 app.state.items=Array.from({length:1000},(_,i)=>app.makeItem({id:'audit-'+i,title:'审查合成事项 '+i,status:'acknowledged',triggerAt:soon,acknowledgedAt:Date.now(),review_status:'READY'}));
 app.state.ui.activeExpanded=false;app.renderHome();
 const html=h.auditNodes.get('#homeActive').innerHTML;
 out.collapsedActive={items:1000,hiddenMarkup:html.includes('id="activeList" hidden'),articleCount:(html.match(/<article/g)||[]).length,htmlUtf8Bytes:Buffer.byteLength(html)};
 out.ledger=[];
 for(const n of [100,500,2000]){
  app.state.items=Array.from({length:n},(_,i)=>app.makeItem({id:'ledger-'+i,title:'合成事项',triggerAt:soon,status:'waiting'}));
  let visits=0; const a=app.state.items; a.find=function(fn){return Array.prototype.find.call(this,(v,i)=>{visits++;return fn(v,i,this)})};
  const start=performance.now();const changed=app.applyDeadlineEvents([],Date.now(),[]);
  out.ledger.push({items:n,emptyDeadlineLedger:true,findPredicateVisits:visits,changed,elapsedMs:+(performance.now()-start).toFixed(3)});
 }
 const urlItem=app.makeItem({id:'url-audit',title:'测试',url:'javascript:alert(1)'});
 out.unsafeUrl={preservedInAnchor:app.audit.renderItemCard(urlItem,'future').includes('href="javascript:alert(1)"')};
 const injected=app.makeItem({id:'x" data-audit="yes',title:'ID 测试'});
 out.importedId={survivesNormalization:injected.id,attributeBreakout:app.audit.renderItemCard(injected,'future').includes('data-id="x" data-audit="yes"')};
 out.storage=[];
 for(const mode of ['idb','no-idb','idb-open-fails']){
  let src=harness;
  if(mode==='idb-open-fails')src=src.replace('req.result = fakeDb; if (req.onsuccess) req.onsuccess();','req.error = new Error("audit open fail"); if (req.onerror) req.onerror();');
  const mm=new Module(path.join(ROOT,'__readonly_storage_audit.cjs'));mm.filename=path.join(ROOT,'__readonly_storage_audit.cjs');mm.paths=m.paths;mm._compile(src,mm.filename);
  const hh=mm.exports.createApp({noIdb:mode==='no-idb'});const aa=await hh.boot();
  aa.state.items=[aa.makeItem({id:'storage',title:'合成测试',triggerAt:soon})];await aa.saveAsync();
  out.storage.push({mode,keys:Array.from(hh.disk.ls.keys()),idbPuts:hh.disk.puts.length});
 }
 native._resetForTests();
 const cap=m.exports.installCapacitor();
 try {
  const items=[app.makeItem({id:'diff-probe',title:'差量排程核验',status:'waiting',triggerAt:Date.now()+86400000,delivery_mode:'alarm',priority:'normal'})];
  const settings={notify:true,dnd:false};const now=Date.now();
  const first=await native.reconcile(items,settings,now);
  settings.scheduledAlarmIds=first.scheduledAlarmIds;settings.scheduledAlarmSignatures=first.scheduledAlarmSignatures;
  const firstCount=cap.calls.scheduleAlarm.length;
  await native.reconcile(items,settings,now);
  out.nativeDiff={firstRoundScheduleCalls:firstCount,secondUnchangedRoundExtraCalls:cap.calls.scheduleAlarm.length-firstCount};
 }finally{cap.cleanup()}
 out.sourceSha256=Object.fromEntries(['app-core.js','lib/storage.js','lib/native-reminders.js','index.html','test-smoke.js','test-regressions.js'].map(f=>[f,require('crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex')]));
 // Print only; do not overwrite the frozen baseline.
 console.log(JSON.stringify(out,null,2));process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
