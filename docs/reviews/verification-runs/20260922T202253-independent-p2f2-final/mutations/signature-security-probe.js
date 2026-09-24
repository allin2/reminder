#!/usr/bin/env node
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const ROOT = path.resolve(__dirname, "../../../../..");
const { bootCombination } = require(path.join(ROOT, "test-boot-combination.js"));
const sourceFile = path.join(ROOT, "lib/app-views.js");
const source = fs.readFileSync(sourceFile, "utf8");
const sha = data => crypto.createHash("sha256").update(data).digest("hex");
const before = sha(source);
const projectAnchor = "state.projects.map(p => [p.id, p.name, p.color])";
const urlAnchor = "const safeUrl = safeExternalHref(it.url);";
if (!source.includes(projectAnchor) || !source.includes(urlAnchor)) throw new Error("mutation anchor missing");
const noProject = path.join(__dirname, "app-views.no-project-signature.js");
const noUrlGuard = path.join(__dirname, "app-views.no-url-guard.js");
fs.writeFileSync(noProject, source.replace(projectAnchor, "state.projects.map(p => [p.id, p.color])"));
fs.writeFileSync(noUrlGuard, source.replace(urlAnchor, "const safeUrl = it.url;"));

async function projectExercise(override) {
  const h = await bootCombination(override ? { overrides: { "lib/app-views.js": override } } : {});
  if (!h.ready) throw new Error("boot failed");
  const now = Date.now();
  h.app.state.projects = [{ id: "p", name: "Initial", color: "#1b6b4a" }];
  h.app.state.items.push({ id: "project-probe", title: "card", status: "due", priority: "critical",
    projectId: "p", triggerAt: now - 1000, createdAt: now - 2000, rev: 1, tags: [] });
  h.app.renderHome();
  const first = h.app.homeRenderStats().builds;
  h.app.state.projects[0].name = "Renamed";
  h.app.renderHome();
  return { buildsBeforeRename: first, buildsAfterRename: h.app.homeRenderStats().builds,
    domShowsRenamed: h.node("#homeDue").innerHTML.includes("Renamed") };
}

async function urlExercise(override) {
  const h = await bootCombination(override ? { overrides: { "lib/app-views.js": override } } : {});
  if (!h.ready) throw new Error("boot failed");
  const card = h.app.views.renderItemCard({ id: "bad", title: "bad URL", status: "waiting",
    priority: "normal", url: "javascript:alert(1)", tags: [] }, "future");
  return { unsafeAnchor: /<a[^>]*href="javascript:/i.test(card), plainText: /linkish-plain/.test(card) };
}

(async () => {
  const projectHealthy = await projectExercise(), projectMutant = await projectExercise(noProject);
  const urlHealthy = await urlExercise(), urlMutant = await urlExercise(noUrlGuard);
  const after = sha(fs.readFileSync(sourceFile));
  const report = { sourceBefore: before, sourceAfter: after, anchorsFound: true,
    project: { healthy: projectHealthy, mutant: projectMutant,
      red: projectHealthy.buildsAfterRename > projectHealthy.buildsBeforeRename && projectHealthy.domShowsRenamed &&
        projectMutant.buildsAfterRename === projectMutant.buildsBeforeRename && !projectMutant.domShowsRenamed },
    unsafeUrl: { healthy: urlHealthy, mutant: urlMutant,
      red: !urlHealthy.unsafeAnchor && urlHealthy.plainText && urlMutant.unsafeAnchor } };
  report.red = before === after && report.project.red && report.unsafeUrl.red;
  fs.writeFileSync(path.join(__dirname, "signature-security-probe.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (!report.red) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
