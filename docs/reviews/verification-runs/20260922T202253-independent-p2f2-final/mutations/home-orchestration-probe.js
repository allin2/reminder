#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.resolve(__dirname, "../../../../..");
const { bootCombination } = require(path.join(ROOT, "test-boot-combination.js"));
const sourceFile = path.join(ROOT, "app-core.js");
const mutantFile = path.join(__dirname, "app-core.no-home-promote.js");
const source = fs.readFileSync(sourceFile, "utf8");
const before = crypto.createHash("sha256").update(source).digest("hex");
const anchor = "  function renderHome() {\n    promoteDue();\n    renderSetupEntry();";
if (!source.includes(anchor)) throw new Error("renderHome promoteDue anchor missing");
const mutant = source.replace(anchor, "  function renderHome() {\n    /* mutation: promoteDue removed */\n    renderSetupEntry();");
fs.writeFileSync(mutantFile, mutant);

async function exercise(options) {
  const h = await bootCombination(options);
  if (!h.ready) throw new Error("boot failed: " + JSON.stringify(h.app && h.app.startupFailure()));
  const now = Date.now();
  const item = { id: "home-orchestration-probe", title: "due after renderHome", status: "waiting",
    priority: "critical", triggerAt: now - 1000, createdAt: now - 2000, updatedAt: now - 2000,
    rev: 1, tags: [] };
  h.app.state.items.push(item);
  h.app.renderHome();
  return { status: item.status, dueInDom: /due after renderHome/.test(h.node("#homeDue").innerHTML),
    puts: h.disk.puts };
}

(async () => {
  const healthy = await exercise({});
  const changed = await exercise({ overrides: { "app-core.js": mutantFile } });
  const after = crypto.createHash("sha256").update(fs.readFileSync(sourceFile)).digest("hex");
  const report = { anchorFound: true, healthy, mutant: changed, sourceBefore: before, sourceAfter: after,
    red: healthy.status === "due" && healthy.dueInDom && changed.status === "waiting" &&
      before === after };
  fs.writeFileSync(path.join(__dirname, "home-orchestration-probe.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (!report.red) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
