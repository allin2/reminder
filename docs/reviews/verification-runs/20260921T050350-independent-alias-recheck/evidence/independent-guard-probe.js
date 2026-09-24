"use strict";

const fs = require("fs");
const path = require("path");
const { bootCombination } = require("../../../../../test-boot-combination.js");
const ROOT = path.resolve(__dirname, "../../../../..");
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));
const core = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");

function coverage(source) {
  const c = prod.runtimeDependencyCoverage(ROOT, { source });
  return {
    undeclared: c.undeclared,
    guardedRefs: c.guardedRefs.filter(x => x.includes("independent")),
    ambiguousAliases: c.ambiguousAliases,
    ambiguousRefs: c.ambiguousRefs,
    problems: c.problems
  };
}

function replaceOrThrow(source, from, to, label) {
  const changed = source.replace(from, to);
  if (changed === source) throw new Error(label + " mutation did not apply");
  return changed;
}

async function main() {
  const baseline = prod.runtimeDependencyCoverage(ROOT);

  // Controls matching the implementation's MUT-A/B/C.
  const uniqueAlias = coverage(core.replace(
    "  function uid() {",
    "  function uid() {\n    const independentAlias = FeedbackLib;\n    independentAlias.independentDirectMember();"
  ));
  const directNamespace = coverage(core.replace(
    "  function uid() {",
    "  function uid() {\n    FeedbackLib.independentDirectMember();"
  ));
  const ambiguousSource = core
    .replace("  function uid() {",
      "  function uid() {\n    const independentCollision = FeedbackLib;\n    independentCollision.independentMember();")
    .replace("  function startApp() {",
      "  function startApp() {\n    const independentCollision = nativeReminderStatus;");
  const ambiguous = coverage(ambiguousSource);

  // Counterexample using the real production call shape. Guarding only the
  // required module object does not prove that this member is optional.
  const guardedAliasSource = replaceOrThrow(
    core,
    "feedbackApi.setupSteps(nativeReminderStatus, setupStepsContext())",
    "feedbackApi.independentGuardedMember(nativeReminderStatus, setupStepsContext())",
    "guarded alias"
  );
  const guardedAlias = coverage(guardedAliasSource);

  // Same semantic shape through the namespace directly.
  const guardedNamespace = coverage(core.replace(
    "  function uid() {",
    "  function uid() {\n    const value = FeedbackLib ? FeedbackLib.independentGuardedMember() : null;"
  ));

  // Confirm the two newly declared real members are enforced at runtime.
  const feedback = fs.readFileSync(path.join(ROOT, "lib/feedback.js"), "utf8");
  const captureBroken = replaceOrThrow(feedback, "\n    captureSummary,", "\n    captureSummary: undefined,", "captureSummary");
  const reminderBroken = replaceOrThrow(feedback, "\n    reminderFeedback,", "\n    reminderFeedback: undefined,", "reminderFeedback");
  const captureFile = path.join(__dirname, "feedback-missing-capture-summary.js");
  const reminderFile = path.join(__dirname, "feedback-missing-reminder-feedback.js");
  fs.writeFileSync(captureFile, captureBroken);
  fs.writeFileSync(reminderFile, reminderBroken);
  const captureBoot = await bootCombination({ overrides: { "lib/feedback.js": captureFile } });
  const reminderBoot = await bootCombination({ overrides: { "lib/feedback.js": reminderFile } });
  const capturePaths = (captureBoot.app.startupFailure() || []).map(x => x.path);
  const reminderPaths = (reminderBoot.app.startupFailure() || []).map(x => x.path);

  const checks = {
    baseline_closed: baseline.undeclared.length === 0 && baseline.ambiguousAliases.length === 0 &&
      baseline.ambiguousRefs.length === 0 && baseline.problems.length === 0,
    unique_alias_detected: uniqueAlias.undeclared.some(x => x.path === "Feedback.independentDirectMember") &&
      uniqueAlias.problems.length > 0,
    direct_namespace_detected: directNamespace.undeclared.some(x => x.path === "Feedback.independentDirectMember") &&
      directNamespace.problems.length > 0,
    ambiguity_fails_closed: ambiguous.ambiguousAliases.includes("independentCollision") &&
      ambiguous.problems.length > 0,
    guarded_alias_blind_spot_reproduced: guardedAlias.undeclared.length === 0 &&
      guardedAlias.problems.length === 0 &&
      guardedAlias.guardedRefs.includes("Feedback.independentGuardedMember"),
    guarded_namespace_blind_spot_reproduced: guardedNamespace.undeclared.length === 0 &&
      guardedNamespace.problems.length === 0 &&
      guardedNamespace.guardedRefs.includes("Feedback.independentGuardedMember"),
    capture_summary_runtime_gate: captureBoot.ready === false &&
      capturePaths.includes("Feedback.captureSummary") && captureBoot.disk.puts === 0,
    reminder_feedback_runtime_gate: reminderBoot.ready === false &&
      reminderPaths.includes("Feedback.reminderFeedback") && reminderBoot.disk.puts === 0
  };

  const result = {
    checks,
    baseline: {
      aliases: baseline.aliases,
      undeclared: baseline.undeclared,
      ambiguousAliases: baseline.ambiguousAliases,
      ambiguousRefs: baseline.ambiguousRefs,
      problems: baseline.problems
    },
    controls: { uniqueAlias, directNamespace, ambiguous },
    counterexamples: { guardedAlias, guardedNamespace },
    runtimeMembers: {
      captureSummary: { ready: captureBoot.ready, puts: captureBoot.disk.puts, paths: capturePaths },
      reminderFeedback: { ready: reminderBoot.ready, puts: reminderBoot.disk.puts, paths: reminderPaths }
    }
  };
  console.log(JSON.stringify(result, null, 2));
  if (Object.values(checks).some(v => !v)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
