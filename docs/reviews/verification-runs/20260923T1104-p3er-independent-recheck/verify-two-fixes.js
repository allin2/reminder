/* Independent P3-E-R probe. Loads real source in memory; never edits product files. */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(path.join(root, "lib/app-native-coordinator.js"), "utf8");

function load(src) {
  const box = {module:{exports:{}},self:{},setTimeout,clearTimeout,console};
  vm.runInNewContext(src,box,{filename:"lib/app-native-coordinator.js"});
  return box.module.exports;
}
function fixture(api, route) {
  const seen={direct:[],notification:[],runs:0,secondSnapshot:null,drift:false};
  let hooks, coordinator;
  const items=[{id:"old",status:"waiting"}];
  const native={
    isNativeAndroid:()=>true,
    initialize:async h=>{hooks=h;return {native:true,reliability:"ok"};},
    reconcile:async snapshot=>{
      seen.runs++;
      if(seen.drift){
        seen.drift=false;
        items.push({id:"new",status:"waiting"});
        coordinator.bumpNativeSyncVersion();
      }
      if(seen.runs===3) seen.secondSnapshot=snapshot.map(x=>x.id).join(",");
      return {native:true,reliability:"ok",scheduledAlarmIds:[]};
    },
    drainAlarmActions:async handler=>{
      await handler({action:"close",itemId:"old",itemRev:1,alarmEventId:"evt-close"});
      await handler({action:"ack",itemId:"old",itemRev:1,alarmEventId:"evt-ack"});
      return 2;
    },
    migrateItem:()=>false
  };
  const deps={
    getItems:()=>items,getSettings:()=>({scheduledAlarmIds:[]}),
    authoritativeWritesAllowed:()=>true,save:()=>Promise.resolve(true),
    runUserOp:(fn,args)=>fn(...args),getNativeReminders:()=>native,getEvidenceLib:()=>null,
    onStatusChange:()=>{},onNotificationAction:e=>seen.notification.push(e),
    needsReviewCount:()=>0,ensureReviewSettings:()=>({}),promoteDue:()=>false,
    refreshActiveAlarmPanel:async()=>{},renderMe:()=>{},getCapacitor:()=>({platform:"android"})
  };
  if(route) deps.handleAlarmAction=e=>seen.direct.push(e);
  coordinator=api.createAppNativeCoordinator(deps);
  return {seen,coordinator,getHooks:()=>hooks};
}

async function runOne(src){
  const api=load(src);
  const f=fixture(api,true);
  await f.coordinator.initializeNativeReminders();
  await f.getHooks().onResume();
  const direct=f.seen.direct.map(x=>x.alarmEventId);
  const notification=f.seen.notification.length;
  f.seen.drift=true;
  const before=f.seen.runs;
  await f.coordinator.syncNativeRemindersNow();
  return {direct,notification,driftRuns:f.seen.runs-before,secondSnapshot:f.seen.secondSnapshot};
}

(async()=>{
  const api=load(source);
  assert.throws(()=>fixture(api,false),/缺少依赖：handleAlarmAction/);
  const healthy=await runOne(source);
  assert.deepStrictEqual(healthy.direct,["evt-close","evt-ack"]);
  assert.strictEqual(healthy.notification,0);
  assert.strictEqual(healthy.driftRuns,2);
  assert.strictEqual(healthy.secondSnapshot,"old,new");

  const wrongRoute=source.replace("await nr.drainAlarmActions(deps.handleAlarmAction);",
    "await nr.drainAlarmActions(deps.onNotificationAction);");
  assert.notStrictEqual(wrongRoute,source);
  const routeMutant=await runOne(wrongRoute);
  assert.strictEqual(routeMutant.direct.length,0);
  assert.strictEqual(routeMutant.notification,2);

  const wrongDrift=source.replace(
    "            if (!nativeSyncPending) {\n              break;\n            }\n          }",
    "          }\n          if (!nativeSyncPending) {\n            break;\n          }");
  assert.notStrictEqual(wrongDrift,source);
  const driftMutant=await runOne(wrongDrift);
  assert.strictEqual(driftMutant.driftRuns,1);
  console.log(JSON.stringify({verdict:"PASS",healthy,routeMutant,driftMutant},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
