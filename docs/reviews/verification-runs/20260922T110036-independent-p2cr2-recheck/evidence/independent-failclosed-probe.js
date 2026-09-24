"use strict";

const { bootCombination, wait } = require("../../../../../test-boot-combination.js");

const authoritative = () => ({
  schema: 5,
  items: [
    { id: "mirror-old", title: "旧镜像事项", status: "waiting", dismissedUntil: null },
    { id: "idb-new", title: "权威新增事项", status: "waiting", dismissedUntil: null }
  ],
  notes: [], projects: [], settings: { notify: false, dnd: false }
});

const staleMirror = () => ({
  schema: 5,
  items: [{ id: "mirror-old", title: "旧镜像事项", status: "waiting", dismissedUntil: null }],
  notes: [], projects: [], settings: { notify: false, dnd: false }
});

const ids = value => ((value && value.items) || []).map(item => item.id);
const carry = harness => Object.fromEntries(
  Object.keys(harness.localStorageKeys()).map(key => [key, harness.localStorage.getItem(key)])
);

async function runCase(name, fault, expectedReason) {
  const first = await bootCombination(Object.assign({
    idbValue: authoritative(), seedState: staleMirror()
  }, fault));
  await wait(20);

  let saveError = null;
  try {
    await first.app.saveAsync();
  } catch (error) {
    saveError = error && (error.code || error.message || String(error));
  }
  const entries = carry(first);
  const second = await bootCombination({ idbValue: authoritative(), seedLocalEntries: entries });
  await wait(20);

  const a1 = first.app.stateAuthority();
  const a2 = second.app.stateAuthority();
  const checks = {
    failedClosed:
      first.ready === false && a1.status === "failed" &&
      a1.report.reason === expectedReason && a1.writesAllowed === false,
    noBusinessStartup:
      !first.intervals.includes(15000) && first.disk.puts === 0,
    explicitSaveBlocked:
      saveError === "state-authority-blocked" && a1.blockedWriteCount === 1,
    noPendingReplay:
      entries["attention-inbox-v2-pending-replay"] === undefined,
    mirrorOnlyReadOnly:
      ids(first.app.state).join(",") === "mirror-old" && a1.recoveryPanel === true,
    nextBootPreservedAuthority:
      second.ready === true && a2.status === "loaded" &&
      a2.report.reason === "authoritative" &&
      ids(second.app.state).join(",") === "mirror-old,idb-new" &&
      ids(second.disk.idbValue).join(",") === "mirror-old,idb-new"
  };
  return {
    name, checks, pass: Object.values(checks).every(Boolean), saveError,
    first: { authority: a1, memoryIds: ids(first.app.state), idbIds: ids(first.disk.idbValue),
      puts: first.disk.puts, intervals: first.intervals, localKeys: first.localStorageKeys() },
    second: { authority: a2, memoryIds: ids(second.app.state), idbIds: ids(second.disk.idbValue),
      puts: second.disk.puts, intervals: second.intervals, localKeys: second.localStorageKeys() }
  };
}

(async () => {
  const cases = [
    await runCase("idb-get-failure", { idbGetFails: true }, "mirror-recovered-unconfirmed-authority"),
    await runCase("idb-open-failure", { idbOpenFails: true }, "degraded-mirror-unconfirmed-authority")
  ];
  const output = { verdict: cases.every(item => item.pass) ? "PASS" : "FAIL", cases };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  if (output.verdict !== "PASS") process.exitCode = 1;
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(2);
});
