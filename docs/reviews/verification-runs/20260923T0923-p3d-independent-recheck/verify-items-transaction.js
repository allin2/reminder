/* Independent P3-D probe: real production assembly, rebind, held authoritative write. */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const root = path.resolve(__dirname, "../../../..");
const bootFile = path.join(root, "test-boot-combination.js");
const harness = new Module(bootFile, module);
harness.filename = bootFile;
harness.paths = Module._nodeModulePaths(path.dirname(bootFile));
harness._compile(fs.readFileSync(bootFile, "utf8") + "\nmodule.exports={bootCombination};", bootFile);

async function run() {
  const boot = await harness.exports.bootCombination();
  const app = boot.app;
  assert.strictEqual(boot.ready, true);
  const target = app.makeItem({title:"independent target",status:"waiting",triggerAt:Date.now()+3600000,
    repeat:{mode:"calendar",every:"day"},seriesId:"independent-series"});
  const peer = app.makeItem({title:"independent peer",status:"waiting",triggerAt:Date.now()+7200000});
  app.state.items.push(target,peer);
  await app.saveAsync();
  const oldItemsArray = app.state.items;
  const oldTransaction = app.transaction;
  const oldItemsInstance = app.items;
  assert.deepStrictEqual(Array.from(app.bindRuntime()), []);
  await app.loadAsync();
  assert.notStrictEqual(app.state.items, oldItemsArray);
  assert.notStrictEqual(app.transaction, oldTransaction);
  assert.strictEqual(app.items, oldItemsInstance);

  const liveTarget = app.state.items.find(x=>x.id===target.id);
  const livePeer = app.state.items.find(x=>x.id===peer.id);
  boot.disk.holdWrites = true;
  const action = app.handleAlarmAction({action:"ack",itemId:liveTarget.id,itemRev:liveTarget.rev,
    alarmEventId:"independent-p3d-held"});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.strictEqual(app.inflightDepth(),1);
  const before = JSON.stringify(app.state.items.find(x=>x.id===target.id));
  const calls = {
    ack:()=>app.ackItem(target.id),
    complete:()=>app.completeItem(target.id),
    snooze:()=>app.snoozeItem(target.id,Date.now()+1800000,"elapsed"),
    delete:()=>app.deleteItem(target.id),
    reopen:()=>app.reopenItem(target.id),
    restore:()=>app.restoreItem(target.id),
    resumeDeadlineProtection:()=>app.resumeDeadlineProtection(target.id),
    stopRepeat:()=>app.stopRepeat(target.id)
  };
  const results = {};
  for (const [name,call] of Object.entries(calls)) {
    results[name]=call();
    assert.strictEqual(results[name],false,name+" must reject same-item pending transaction");
  }
  assert.strictEqual(JSON.stringify(app.state.items.find(x=>x.id===target.id)),before);
  const peerResult = app.snoozeItem(peer.id,Date.now()+5400000,"elapsed");
  assert.strictEqual(peerResult,true);
  boot.disk.holdWrites=false;
  boot.disk.held.splice(0).forEach(finish=>finish());
  assert.strictEqual(await action,true);
  await new Promise(resolve=>setTimeout(resolve,60));
  const finalTarget=app.state.items.find(x=>x.id===target.id);
  const finalPeer=app.state.items.find(x=>x.id===peer.id);
  assert.strictEqual(finalTarget.status,"acknowledged");
  assert.strictEqual(finalPeer.status,"snoozed");
  await app.saveAsync();
  const reboot=await harness.exports.bootCombination({idbValue:boot.disk.idbValue});
  assert.strictEqual(reboot.ready,true);
  assert.strictEqual(reboot.app.state.items.find(x=>x.id===target.id).status,"acknowledged");
  assert.strictEqual(reboot.app.state.items.find(x=>x.id===peer.id).status,"snoozed");
  console.log(JSON.stringify({verdict:"PASS",reusedItemsInstance:true,reboundTransaction:true,
    rejected:results,peerResult,finalTarget:finalTarget.status,finalPeer:finalPeer.status,
    rebootTarget:"acknowledged",rebootPeer:"snoozed"},null,2));
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
