/* Independent P3-C A/B probe. Loads the real production combination without editing product files. */
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

async function scenario(rebind) {
  const boot = await harness.exports.bootCombination();
  const app = boot.app;
  assert.strictEqual(boot.ready, true);

  // Prime the core wrappers exactly as ordinary pre-retry use does.
  const prime = app.makeItem({ title: "prime", status: "waiting", triggerAt: Date.now() + 3600000 });
  app.state.items.push(prime);
  await app.saveAsync();
  assert.strictEqual(app.completeItem(prime.id), true);
  await app.saveAsync();
  const addUnrelated = app.wrapUserOp(id => {
    const stableId = app.takeReplayCreatedId() || id;
    app.state.items.push({ id: stableId, title: id, status: "waiting", rev: 1 });
    return true;
  }, { name: "add-unrelated" });
  assert.strictEqual(addUnrelated("setup-item"), true);
  await app.saveAsync();

  const oldTransaction = app.transaction;
  if (rebind) {
    assert.deepStrictEqual(Array.from(app.bindRuntime()), []);
    const report = await app.loadAsync();
    assert.ok(report.status === "loaded" || report.status === "empty", JSON.stringify(report));
  }
  const newTransaction = app.transaction;

  const target = app.makeItem({ title: "target", status: "waiting", triggerAt: Date.now() + 3600000 });
  app.state.items.push(target);
  await app.saveAsync();

  boot.disk.holdWrites = true;
  const action = app.handleAlarmAction({
    action: "ack", itemId: target.id, itemRev: target.rev, alarmEventId: "independent-p3c-" + rebind
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.strictEqual(newTransaction.inflightDepth(), 1);
  const before = app.state.items.find(item => item.id === target.id).status;
  const conflictResult = app.completeItem(target.id);
  const during = app.state.items.find(item => item.id === target.id).status;
  const unrelatedResult = addUnrelated("unrelated");
  const unrelatedBefore = app.state.items.some(item => item.id === "unrelated");
  const held = boot.disk.held.length;

  boot.disk.holdWrites = false;
  boot.disk.held.splice(0).forEach(finish => finish());
  const actionResult = await action;
  await new Promise(resolve => setTimeout(resolve, 60));

  return {
    rebind, instanceChanged: oldTransaction !== newTransaction,
    depthOldAfterRebind: oldTransaction.inflightDepth(),
    conflictResult, before, during, unrelatedResult, unrelatedBefore,
    held, actionResult,
    finalTarget: app.state.items.find(item => item.id === target.id).status,
    unrelatedAfter: app.state.items.some(item => item.id === "unrelated")
  };
}

(async () => {
  const control = await scenario(false);
  const rebound = await scenario(true);
  assert.strictEqual(control.instanceChanged, false);
  assert.strictEqual(control.conflictResult, false);
  assert.strictEqual(control.before, "waiting");
  assert.strictEqual(control.during, "waiting");
  assert.strictEqual(control.unrelatedBefore, true);
  assert.strictEqual(control.unrelatedAfter, true);
  assert.strictEqual(control.actionResult, true);
  assert.strictEqual(rebound.instanceChanged, true);
  assert.strictEqual(rebound.conflictResult, true);
  assert.strictEqual(rebound.before, "waiting");
  assert.strictEqual(rebound.during, "archived");
  assert.strictEqual(rebound.unrelatedBefore, true);
  assert.strictEqual(rebound.unrelatedAfter, false);
  assert.strictEqual(rebound.actionResult, true);
  console.log(JSON.stringify({ verdict: "P3-C stale wrapper defect reproduced", control, rebound }, null, 2));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
