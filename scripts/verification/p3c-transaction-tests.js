/* P3-C direct transaction behavior and source mutation checks.
 * Uses the loaded source in temporary context, never rewriting the product file.
 */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const targetPath = path.join(ROOT, "lib/app-transaction.js");
const source = fs.readFileSync(targetPath, "utf8");
const hashBefore = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");

function load(src) {
  const box = { module: { exports: {} }, self: {} };
  vm.runInNewContext(src, box, { filename: "lib/app-transaction.js" });
  return box.module.exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fixture(api, options) {
  options = options || {};
  let state = {
    schema: 5,
    items: [
      { id: "it-1", title: "Task 1", rev: 1, status: "waiting", seriesId: "s-1", repeat: null }
    ],
    notes: [],
    projects: [],
    settings: { alarmEventLog: {} }
  };
  let syncCount = 0;
  let renderCount = 0;
  const toasts = [];
  const writtenSnapshots = [];
  let writeDefer = null;

  const deps = {
    getItems: () => state.items,
    setItems: v => { state.items = v; },
    getNotes: () => state.notes,
    setNotes: v => { state.notes = v; },
    getProjects: () => state.projects,
    setProjects: v => { state.projects = v; },
    getSettings: () => state.settings,
    setSettings: v => { state.settings = v; },
    currentPayload: () => JSON.parse(JSON.stringify(state)),
    runCommit: async (job) => job(),
    writeSnapshot: async (snapshot, opts) => {
      writtenSnapshots.push({ snapshot: JSON.parse(JSON.stringify(snapshot)), opts: opts });
      if (options.failWrite) throw new Error("write-failed");
      if (writeDefer) await writeDefer.promise;
    },
    isTerminal: it => (it && (it.status === "archived" || it.status === "deleted")),
    hasKnownRev: rev => Number.isFinite(Number(rev)) && Number(rev) > 0,
    ackItem: (itemId) => {
      const it = state.items.find(x => x && x.id === itemId);
      if (it) it.status = "acknowledged";
    },
    snoozeItem: (itemId, until) => {
      const it = state.items.find(x => x && x.id === itemId);
      if (it) { it.status = "snoozed"; it.triggerAt = until; }
    },
    completeItem: itemId => {
      const it = state.items.find(x => x && x.id === itemId);
      if (it) it.status = "archived";
    },
    queueNativeReminderSync: () => { syncCount++; },
    render: () => { renderCount++; },
    toast: msg => { toasts.push(msg); },
    openDetail: () => {},
    hideAlert: () => {},
    fmtTime: ts => String(ts)
  };

  const app = api.createAppTransaction(deps);
  return {
    app: app,
    deps: deps,
    state: () => state,
    setState: s => { state = s; },
    toasts: toasts,
    writtenSnapshots: writtenSnapshots,
    getSyncCount: () => syncCount,
    getRenderCount: () => renderCount,
    setWriteDefer: d => { writeDefer = d; }
  };
}

async function healthy(api) {
  // 1. Invariant 1 (No early visibility) & Invariant 3 (Persistence ordering) & Invariant 8 (Publish behavior)
  {
    const f = fixture(api);
    const d = deferred();
    f.setWriteDefer(d);

    const actionPromise = f.app.handleAlarmAction({
      action: "done",
      itemId: "it-1",
      itemRev: 1,
      alarmEventId: "ev-100"
    });

    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(f.app.inflightDepth(), 1, "inflightDepth must be 1 while action is in flight");
    assert.strictEqual(f.state().items[0].status, "waiting", "live state must remain untouched before authoritative save settles");
    assert.strictEqual(f.getSyncCount(), 0, "native sync must not be queued before authoritative save settles");
    assert.strictEqual(f.writtenSnapshots.length, 1, "writeSnapshot must be called exactly once");
    assert.strictEqual(f.writtenSnapshots[0].snapshot.items[0].status, "archived", "written snapshot must contain updated item");

    d.resolve();
    const result = await actionPromise;
    assert.strictEqual(result, true, "action must succeed");
    assert.strictEqual(f.app.inflightDepth(), 0, "inflightDepth must drop back to 0");
    assert.strictEqual(f.state().items[0].status, "archived", "live state must be updated upon authoritative success");
    assert.strictEqual(f.getSyncCount(), 1, "native sync must be queued upon success");
    assert.strictEqual(f.app.alarmEventSeen("ev-100"), true, "alarm event must be remembered upon success");
  }

  // 2. Invariant 2 (Same event, same Promise & failure releases)
  {
    const f = fixture(api);
    const d = deferred();
    f.setWriteDefer(d);

    const p1 = f.app.handleAlarmAction({ action: "done", itemId: "it-1", itemRev: 1, alarmEventId: "ev-same" });
    const p2 = f.app.handleAlarmAction({ action: "done", itemId: "it-1", itemRev: 1, alarmEventId: "ev-same" });

    assert.strictEqual(p1, p2, "concurrent deliveries of same alarmEventId must share the same Promise");

    d.reject(new Error("disk-full"));
    let err1 = null;
    let err2 = null;
    try { await p1; } catch (e) { err1 = e; }
    try { await p2; } catch (e) { err2 = e; }
    assert.ok(err1 && err1.message === "disk-full", "p1 must reject with disk error");
    assert.ok(err2 && err2.message === "disk-full", "p2 must reject with disk error");

    f.setWriteDefer(null);
    let retried = false;
    try {
      await f.app.handleAlarmAction({ action: "done", itemId: "it-1", itemRev: 1, alarmEventId: "ev-same" });
      retried = true;
    } catch (_) {}
    assert.strictEqual(retried, true, "retry must be accepted after previous attempt failed");
  }

  // 3. Invariant 4 (Conflict domain: item/series conflict check)
  {
    const f = fixture(api);
    const d = deferred();
    f.setWriteDefer(d);

    const actionPromise = f.app.handleAlarmAction({ action: "done", itemId: "it-1", itemRev: 1, alarmEventId: "ev-conflict" });
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(f.app.itemConflictsWithActiveAction({ id: "it-1" }), true);
    assert.strictEqual(f.app.itemConflictsWithActiveAction({ id: "other", seriesId: "s-1" }), true);
    assert.strictEqual(f.app.itemConflictsWithActiveAction({ id: "other", seriesId: "s-other" }), false);

    let userOpExecuted = false;
    const opResult = f.app.runUserOp(() => {
      userOpExecuted = true;
    }, [{ id: "it-1" }], { userFacing: true });

    assert.strictEqual(opResult, false, "conflicting user operation must return false");
    assert.strictEqual(userOpExecuted, false, "conflicting user operation callback must not be executed");
    assert.ok(f.toasts.indexOf("这条事项正在保存 · 请稍后重试") >= 0, "must toast conflict rejection message");

    d.resolve();
    await actionPromise;
  }

  // 4. Invariant 5 (Replay fidelity) & Invariant 6 (Inner-save suppression)
  {
    const f = fixture(api);
    const d = deferred();
    f.setWriteDefer(d);

    let innerSaveSuppressedDuringReducer = false;
    const originalComplete = f.deps.completeItem;
    f.deps.completeItem = (id) => {
      innerSaveSuppressedDuringReducer = f.app.shouldSuppressInnerSave();
      originalComplete(id);
    };

    const actionPromise = f.app.handleAlarmAction({ action: "done", itemId: "it-1", itemRev: 1, alarmEventId: "ev-replay" });
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(innerSaveSuppressedDuringReducer, true, "shouldSuppressInnerSave must be true during action reducer");
    assert.strictEqual(f.app.shouldSuppressInnerSave(), false, "shouldSuppressInnerSave must not be true while waiting for async save");

    let replayed = false;
    const queuedOp = f.app.runUserOp((newItem) => {
      replayed = true;
      const createdId = f.app.takeReplayCreatedId() || newItem.id;
      newItem.id = createdId;
      f.state().items.push(newItem);
      return true;
    }, [{ id: "unrelated-it", title: "Unrelated Item" }], { userFacing: true, name: "create-unrelated" });

    assert.strictEqual(queuedOp, true, "unrelated user op must be accepted");

    d.resolve();
    await actionPromise;

    const finalItems = f.state().items;
    assert.strictEqual(finalItems.some(x => x.id === "it-1" && x.status === "archived"), true, "it-1 must be archived");
    assert.strictEqual(finalItems.some(x => x.id === "unrelated-it" && x.title === "Unrelated Item"), true, "unrelated op must be replayed into state");
    assert.strictEqual(replayed, true, "unrelated op callback must have executed");
  }

  // 5. Invariant 7 (Replay failure compensation write)
  {
    const f = fixture(api);
    const d = deferred();
    f.setWriteDefer(d);

    const actionPromise = f.app.handleAlarmAction({ action: "done", itemId: "it-1", itemRev: 1, alarmEventId: "ev-comp" });
    await Promise.resolve();
    await Promise.resolve();

    let attempts = 0;
    f.app.runUserOp(() => {
      attempts++;
      if (attempts > 1) {
        return false;
      }
    }, [], { userFacing: true, name: "failing-op" });

    d.resolve();

    let replayErr = null;
    try {
      await actionPromise;
    } catch (e) {
      replayErr = e;
    }

    assert.ok(replayErr, "actionPromise must reject on replay failure");
    assert.ok(replayErr.message.indexOf("transaction-replay-business-rejected") >= 0, "error must indicate replay rejection");
    assert.strictEqual(f.writtenSnapshots.length, 2, "compensation writeSnapshot must be performed on replay failure");
  }

  // 6. Invariant 5 (Stable created-ID remainder fail-closed)
  {
    const f = fixture(api);
    const d = deferred();
    f.setWriteDefer(d);

    const actionPromise = f.app.handleAlarmAction({ action: "done", itemId: "it-1", itemRev: 1, alarmEventId: "ev-remainder" });
    await Promise.resolve();
    await Promise.resolve();

    let runCount = 0;
    f.app.runUserOp(() => {
      runCount++;
      if (runCount === 1) {
        f.state().items.push({ id: "id-allocated", title: "Alloc" });
      }
    }, [], { userFacing: true, name: "unused-created-id-op" });

    d.resolve();

    let remainderErr = null;
    try {
      await actionPromise;
    } catch (e) {
      remainderErr = e;
    }

    assert.ok(remainderErr, "must reject when replay leaves unconsumed created IDs");
    assert.ok(remainderErr.message.indexOf("transaction-replay-unused-created-id") >= 0,
      "error must indicate unused created ID fail-closed remainder");
  }

  return "healthy direct behavior: PASS";
}

async function mutant(name, transform) {
  const mutated = transform(source);
  assert.notStrictEqual(mutated, source, "mutation transformation must modify the code: " + name);
  const api = load(mutated);
  let failed = false;
  try {
    await healthy(api);
  } catch (_) {
    failed = true;
  }
  assert.strictEqual(failed, true, name + " did not fail healthy behavior");
  return name + ": mutation detected";
}

(async () => {
  const out = [await healthy(load(source))];

  // 1. draft reducer operating on live state
  out.push(await mutant("draft reducer operating on live state", s => {
    return s.replace("withDraftState(draft, () => {", "(() => {");
  }));

  // 2. writeSnapshot no longer awaited
  out.push(await mutant("writeSnapshot no longer awaited", s => {
    return s.replace("await deps.writeSnapshot(draft, { deferNativeSync: true });",
      "deps.writeSnapshot(draft, { deferNativeSync: true });");
  }));

  // 3. draft published before authoritative success
  out.push(await mutant("draft published before authoritative success", s => {
    return s.replace("await deps.writeSnapshot(draft, { deferNativeSync: true });",
      "publishActionDraft(draft); await deps.writeSnapshot(draft, { deferNativeSync: true });");
  }));

  // 4. same-event in-flight Promise reuse removed
  out.push(await mutant("same-event in-flight Promise reuse removed", s => {
    return s.replace("if (inflight) return inflight;", "if (false) return inflight;");
  }));

  // 5. item/series conflict check removed
  out.push(await mutant("item/series conflict check removed", s => {
    return s.replace("function itemConflictsWithActiveAction(item) {",
      "function itemConflictsWithActiveAction(item) { return false;");
  }));

  // 6. unrelated command replay removed or performed on the wrong state
  out.push(await mutant("unrelated command replay removed or performed on the wrong state", s => {
    return s.replace("withDraftState(draft, () => replayUserOps(userOps));",
      "// withDraftState(draft, () => replayUserOps(userOps));");
  }));

  // 7. stable created-ID consumption/fail-closed remainder removed
  out.push(await mutant("stable created-ID consumption/fail-closed remainder removed", s => {
    return s.replace("if (replayCreatedIds.length) {",
      "if (false && replayCreatedIds.length) {");
  }));

  // 8. inner-save suppression removed
  out.push(await mutant("inner-save suppression removed", s => {
    return s.replace("function shouldSuppressInnerSave() {",
      "function shouldSuppressInnerSave() { return false;");
  }));

  // 9. replay-failure compensation write removed
  out.push(await mutant("replay-failure compensation write removed", s => {
    return s.replace("await deps.writeSnapshot(deps.currentPayload(), { deferNativeSync: true });",
      "// await deps.writeSnapshot(deps.currentPayload(), { deferNativeSync: true });");
  }));

  const hashAfter = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");
  assert.strictEqual(hashBefore, hashAfter, "lib/app-transaction.js must be byte-for-byte identical before and after mutations");

  out.push("lib/app-transaction.js before/after SHA-256 match: " + hashBefore);
  console.log(out.join("\n"));
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
