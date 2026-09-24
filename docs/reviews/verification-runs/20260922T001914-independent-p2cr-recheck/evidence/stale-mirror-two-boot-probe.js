"use strict";

const { bootCombination, wait } = require("../../../../../test-boot-combination.js");

function authoritativeState() {
  return {
    schema: 5,
    items: [
      { id: "mirror-old", title: "旧镜像事项", status: "waiting", dismissedUntil: null },
      { id: "idb-new", title: "仅权威库存在事项", status: "waiting", dismissedUntil: null }
    ],
    notes: [],
    projects: [],
    settings: { notify: false, dnd: false }
  };
}

function staleMirrorState() {
  return {
    schema: 5,
    items: [
      { id: "mirror-old", title: "旧镜像事项", status: "waiting", dismissedUntil: null }
    ],
    notes: [],
    projects: [],
    settings: { notify: false, dnd: false }
  };
}

function carryEntries(harness) {
  const out = {};
  Object.keys(harness.localStorageKeys()).forEach(key => {
    out[key] = harness.localStorage.getItem(key);
  });
  return out;
}

function itemIds(value) {
  return value && Array.isArray(value.items) ? value.items.map(item => item.id) : [];
}

function snapshot(harness) {
  return {
    ready: harness.ready,
    authority: harness.app.stateAuthority(),
    memoryIds: itemIds(harness.app.state),
    idbIds: itemIds(harness.disk.idbValue),
    puts: harness.disk.puts,
    intervals: harness.intervals.slice(),
    localKeys: harness.localStorageKeys()
  };
}

async function runCase(name, firstOptions, expectedReason) {
  const first = await bootCombination(Object.assign({
    idbValue: authoritativeState(),
    seedState: staleMirrorState()
  }, firstOptions));
  await wait(30);

  // 即使另行修掉启动期 migrateItem() 的恒 true，这里也模拟一次正常用户保存。
  // 当前代码把旧镜像提升为 writesAllowed=true，所以这笔保存会被当作成功，并留下
  // 下次健康启动要优先回放的凭据；核心漏洞因此不依赖启动期迁移误写。
  let explicitSaveError = null;
  try {
    await first.app.saveAsync();
  } catch (error) {
    explicitSaveError = error && (error.code || error.message || String(error));
  }
  await wait(10);

  const carry = carryEntries(first);
  const second = await bootCombination({
    idbValue: authoritativeState(),
    seedLocalEntries: carry
  });
  await wait(30);

  const firstAuthority = first.app.stateAuthority();
  const secondAuthority = second.app.stateAuthority();
  const pendingKey = "attention-inbox-v2-pending-replay";
  const checks = {
    firstStartedFromStaleMirror:
      first.ready === true &&
      firstAuthority.status === "loaded" &&
      firstAuthority.report.reason === expectedReason &&
      firstAuthority.writesAllowed === true &&
      itemIds(first.app.state).join(",") === "mirror-old" &&
      itemIds(first.disk.idbValue).join(",") === "mirror-old,idb-new" &&
      first.intervals.includes(15000),
    firstLeftPendingReplay:
      explicitSaveError == null &&
      typeof carry[pendingKey] === "string" && carry[pendingKey].length > 0,
    secondOverwroteAuthoritativeIdb:
      second.ready === true &&
      secondAuthority.report.reason === "pending-replay" &&
      itemIds(second.disk.idbValue).join(",") === "mirror-old" &&
      second.disk.puts > 0
  };

  return {
    name,
    expectedReason,
    checks,
    reproduced: Object.values(checks).every(Boolean),
    explicitSaveError,
    first: snapshot(first),
    second: snapshot(second)
  };
}

(async () => {
  const cases = [
    await runCase("idb-get-failure", { idbGetFails: true }, "mirror-recovered"),
    await runCase("idb-open-failure", { idbOpenFails: true }, "degraded-mirror")
  ];
  const result = {
    verdict: cases.every(entry => entry.reproduced)
      ? "BLOCKER_REPRODUCED"
      : "PROBE_DID_NOT_REPRODUCE",
    claim:
      "一次权威读取故障会把旧镜像提升为可写 loaded；启动期提交留下待回放快照，下一次健康启动会用它覆盖更新的 IndexedDB。",
    cases
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.verdict !== "BLOCKER_REPRODUCED") process.exitCode = 1;
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(2);
});
