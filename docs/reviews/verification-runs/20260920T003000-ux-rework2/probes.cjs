// Read-only application-code probes. Uses the existing VM/IndexedDB test harness;
// no real browser data, device state, production source, or existing tests change.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const root = path.resolve(__dirname, '../../../..');
const filename = path.join(root, 'test-regressions.js');
const source = fs.readFileSync(filename, 'utf8');
const hmod = new Module(filename, module);
hmod.filename = filename;
hmod.paths = Module._nodeModulePaths(root);
hmod._compile(source.slice(0, source.indexOf('async function run()')) + '\nmodule.exports={createApp,flush,restartApp};', filename);
const {createApp, flush, restartApp} = hmod.exports;
const evidence = require(path.join(root, 'lib/delivery-evidence.js'));
const native = require(path.join(root, 'lib/native-reminders.js'));
const findings = [];
const record = (id, expected, actual) => findings.push({id, expected, actual});
async function fresh() { const h=createApp(); await h.boot(); return h; }
async function drain(h) { h.disk.hold=false; h.releaseCommits(); await flush(8); await h.app.saveAsync(); }

(async () => {
  {
    const h=await fresh(), a=h.app;
    h.disk.hold=true;
    h.setField('#capText','明天下午3点提醒我取快递');
    const first=a.saveItemFromForm(), second=a.saveItemFromForm();
    await drain(h);
    record('R1-repeat-submit', 'one item; second submit rejected', {first,second,count:a.state.items.length,durableCount:h.persisted().items.length});
  }
  {
    const h=await fresh(), a=h.app;
    h.disk.hold=true;
    h.setField('#capText','明天下午3点提醒我取快递');
    a.saveItemFromForm();
    await flush(2);
    h.setField('#capText','第二条尚未保存的输入');
    await drain(h);
    record('R2-late-save-clears-input','new input preserved',{input:h.fieldOf('#capText')});
  }
  {
    const h=await fresh(), a=h.app;
    const x=a.makeItem({title:'native A',status:'due',triggerAt:Date.now()-1000});
    const y=a.makeItem({title:'undo B',status:'due',triggerAt:Date.now()-1000});
    a.state.items=[x,y]; await a.saveAsync();
    a.completeItem(y.id); await a.saveAsync();
    h.disk.hold=true;
    const pending=a.handleAlarmAction({action:'ack',itemId:x.id,itemRev:x.rev});
    await flush(3);
    const accepted=a.undoLastComplete();
    const immediate=a.state.items.find(i=>i.id===y.id).status;
    await drain(h); await pending; await a.saveAsync();
    const after=a.state.items.find(i=>i.id===y.id).status;
    const restarted=await restartApp(h.disk);
    record('R3-undo-during-native-commit','accepted undo stays undone after native commit and restart',{accepted,immediate,after,restarted:restarted.app.state.items.find(i=>i.id===y.id).status});
  }
  {
    const now=Date.now(), oldBase=now-31*60000;
    const newBase=now-2*60000, oldFollowup=oldBase+30*60000;
    const item={id:'evidence-test',rev:9,triggerAt:newBase,status:'snoozed',reminderEvents:{['0@'+newBase]:{state:'scheduled',at:newBase}}};
    const rows=evidence.normalizeEvidence([{itemId:item.id,reminderKey:'1@'+oldFollowup,plannedAt:oldFollowup,receivedAt:now,itemRev:'1',token:'old-token',carrier:'alarm'}],'native');
    const merged=evidence.mergeEvidence([item],rows,now);
    record('R4-stale-receipt','old revision rejected, current reminder stays pending',{merged,status:evidence.evidenceStatusFor(item,{now,evidenceReadable:true,observable:true}),events:item.reminderEvents});
    const malformed=evidence.normalizeEvidence([{itemId:'missing',reminderKey:'0@123'}],'native');
    record('R4b-incomplete-identity','missing receipt time/carrier/version/token is invalid',malformed);
  }
  {
    const h=await fresh(),a=h.app,at=Date.now()+1500;
    const x=a.makeItem({title:'undo replay',status:'waiting',priority:'normal',triggerAt:at});
    x.triggerAt=at;
    x.reminderEvents={['0@'+at]:{state:'scheduled',at}};
    a.state.items=[x]; a.state.settings.notify=true; a.state.settings.dnd=false;
    await a.saveAsync(); a.completeItem(x.id); await a.saveAsync();
    // Complete before due, use the production cancellation reducer, then let the
    // original trigger pass within the real 8-second undo window.
    a.applyReminderEvents([],Date.now(),[{itemId:x.id,key:'0@'+at,at}]);
    await a.saveAsync();
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,at-Date.now()+80)));
    const accepted=a.undoLastComplete(); await a.saveAsync();
    const desired=native.buildDesired(a.state.items,a.state.settings,Date.now());
    record('R5-undo-replays-past-event','no immediate replay of a past event',{accepted,desired});
  }
  {
    const h=await fresh(),a=h.app;
    const x=a.makeItem({title:'undo failed save',status:'due',triggerAt:Date.now()-1000});
    a.state.items=[x]; await a.saveAsync(); a.completeItem(x.id); await a.saveAsync();
    h.setCommitFailure(true); h.setLocalStorageFailure(true);
    const accepted=a.undoLastComplete(), immediateToast=h.textOf('#toastText');
    await flush(6);
    const durable=h.persistedStatusOf(x.id);
    h.setCommitFailure(false); h.setLocalStorageFailure(false);
    const restarted=await restartApp(h.disk);
    record('R6-undo-save-failure','no success before durable undo; retry remains available',{accepted,immediateToast,durable,restarted:restarted.app.state.items.find(i=>i.id===x.id).status});
  }
  {
    const now=Date.now(), key='0@'+(now-1000);
    const raw={itemId:'java-row',key,at:now-1000,carrier:'alarm',receivedAt:now,itemRev:'2',token:'token-2'};
    global.Capacitor={getPlatform:()=> 'android',Plugins:{SystemBridge:{deliveryEvidence:async()=>({available:true,evidence:[raw],retentionMaxAgeMs:604800000,retentionCapacity:300})}}};
    const bridgeResult=await native.getDeliveryEvidence({});
    const normalized=evidence.normalizeEvidence(bridgeResult.rows,'native');
    const item={id:'java-row',rev:2,triggerAt:now-1000,reminderEvents:{[key]:{state:'scheduled',at:now-1000}}};
    record('R7-real-java-row-contract','Java row survives bridge and is merged',{bridgeResult,normalized,merged:evidence.mergeEvidence([item],normalized,now)});
    global.Capacitor.Plugins.SystemBridge.deliveryEvidence=async()=>({available:false,evidence:[],error:'storage-unavailable'});
    record('R7b-bridge-unavailable','bridge failure remains unavailable',await native.getDeliveryEvidence({}));
    delete global.Capacitor;
  }
  fs.writeFileSync(path.join(__dirname,'probe-results.json'),JSON.stringify(findings,null,2)+'\n');
  console.log(JSON.stringify(findings,null,2));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
