/* Independent production-combination alarm-drain probe, isolated in test harness. */
"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"),Module=require("module");
const root=path.resolve(__dirname,"../../../..");
const file=path.join(root,"test-boot-combination.js");
const harness=new Module(file,module);
harness.filename=file;
harness.paths=Module._nodeModulePaths(path.dirname(file));
harness._compile(fs.readFileSync(file,"utf8")+"\nmodule.exports={bootCombination};",file);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const boot=await harness.exports.bootCombination();
  assert.strictEqual(boot.ready,true);
  const app=boot.app;
  const closeItem=app.makeItem({title:"independent-close",status:"due",triggerAt:Date.now()-1000});
  const ackItem=app.makeItem({title:"independent-ack",status:"due",triggerAt:Date.now()-1000});
  app.state.items.push(closeItem,ackItem);
  await app.saveAsync();
  const native=boot.exportOf("AttentionNativeReminders");
  assert.ok(native);
  const queued=[
    {action:"close",itemId:closeItem.id,itemRev:closeItem.rev,alarmEventId:"independent-close-id"},
    {action:"ack",itemId:ackItem.id,itemRev:ackItem.rev,alarmEventId:"independent-ack-id"}
  ];
  let drains=0;
  native.drainAlarmActions=async handler=>{
    drains++;
    while(queued.length) await handler(queued.shift());
    return 2;
  };
  app.state.ui.detailId=null;
  boot.env.fireResume();
  await wait(150);
  assert.strictEqual(drains,1);
  assert.strictEqual(app.state.ui.detailId,null);
  assert.strictEqual(app.alarmEventSeen("independent-ack-id"),true);
  assert.strictEqual(app.state.items.find(x=>x.id===ackItem.id).status,"acknowledged");
  const reboot=await harness.exports.bootCombination({idbValue:boot.disk.idbValue});
  assert.strictEqual(reboot.ready,true);
  assert.strictEqual(reboot.app.alarmEventSeen("independent-ack-id"),true);
  console.log(JSON.stringify({verdict:"PASS",drains,detailId:app.state.ui.detailId,
    ackStatus:"acknowledged",eventSeenAfterReboot:true},null,2));
  process.exit(0); // The production harness intentionally starts repeating app heartbeat timers.
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
