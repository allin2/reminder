#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { bootCombination } = require(path.resolve(__dirname, "../../../../test-boot-combination.js"));
const root = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(path.join(root, "app-core.js"), "utf8");
const target = "evidenceStatusFor: (it, ctx) => (EvidenceLib ? EvidenceLib.evidenceStatusFor(it, ctx) : null),";
if (source.split(target).length !== 2) throw new Error("expected one wiring anchor");
const mutant = source.replace(target, "");
const mutantFile = path.join(__dirname, "mutant-app-core-missing-evidenceStatusFor.js");
fs.writeFileSync(mutantFile, mutant);

(async () => {
  const healthy = await bootCombination();
  const bad = await bootCombination({ overrides: { "app-core.js": mutantFile } });
  const problems = bad.app.startupFailure();
  const summary = {
    controlReady: healthy.ready,
    mutantReady: bad.ready,
    problems,
    puts: bad.disk.puts,
    schedules: bad.env.calls.scheduleAlarm.length,
    businessHeartbeat: bad.intervals.includes(15000)
  };
  console.log(JSON.stringify(summary, null, 2));
  if (healthy.ready !== true || bad.ready !== false ||
      !problems.some(p => p.path === "AppViews.createAppViews()" && /evidenceStatusFor/.test(p.actual || "")) ||
      bad.disk.puts !== 0 || bad.env.calls.scheduleAlarm.length !== 0 || bad.intervals.includes(15000)) {
    throw new Error("exact missing dependency did not fail closed");
  }
  console.log("EXACT_MISSING_DEP_FAIL_CLOSED=PASS");
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
