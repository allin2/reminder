"use strict";

const fs = require("fs");
const path = require("path");
const { bootCombination } = require("../../../../../test-boot-combination.js");
const ROOT = path.resolve(__dirname, "../../../../..");
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));
const core = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
const feedback = fs.readFileSync(path.join(ROOT, "lib/feedback.js"), "utf8");

function replaceOrThrow(source, from, to, name) {
  const changed = source.replace(from, to);
  if (changed === source) throw new Error(name + " mutation did not apply");
  return changed;
}

function coverage(source) {
  const c = prod.runtimeDependencyCoverage(ROOT, { source });
  return {
    undeclared: c.undeclared,
    guardedRefs: c.guardedRefs.filter(x => x.includes("independent")),
    ambiguousAliases: c.ambiguousAliases,
    ambiguousRefs: c.ambiguousRefs,
    problems: c.problems,
    declared: c.declared.filter(x => x === "Feedback.TEST_FEEDBACK" || x === "Feedback.UNDO_WINDOW_MS")
  };
}

async function main() {
  const baseline = prod.runtimeDependencyCoverage(ROOT);

  const guardedAliasSource = replaceOrThrow(
    core,
    "feedbackApi.setupSteps(nativeReminderStatus, setupStepsContext())",
    "feedbackApi.independentGuardedMember(nativeReminderStatus, setupStepsContext())",
    "guarded alias"
  );
  const guardedAlias = coverage(guardedAliasSource);

  const guardedNamespaceSource = replaceOrThrow(
    core,
    'FeedbackLib ? FeedbackLib.actionSpec("ack") : null',
    'FeedbackLib ? FeedbackLib.independentGuardedMember("ack") : null',
    "guarded namespace"
  );
  const guardedNamespace = coverage(guardedNamespaceSource);

  const trueMemberGuardSource = core.replace(
    "  function uid() {",
    "  function uid() {\n    if (FeedbackLib.independentOptionalMember) FeedbackLib.independentOptionalMember();"
  );
  if (trueMemberGuardSource === core) throw new Error("member guard mutation did not apply");
  const trueMemberGuard = coverage(trueMemberGuardSource);

  const brokenConstants = feedback
    .replace("\n    UNDO_WINDOW_MS,", "\n    UNDO_WINDOW_MS: undefined,")
    .replace("\n    TEST_FEEDBACK,", "\n    TEST_FEEDBACK: undefined,");
  if (brokenConstants === feedback) throw new Error("missing constants mutation did not apply");
  const brokenConstantsFile = path.join(__dirname, "feedback-missing-required-constants.js");
  fs.writeFileSync(brokenConstantsFile, brokenConstants);
  const missingRun = await bootCombination({ overrides: { "lib/feedback.js": brokenConstantsFile } });
  const missingPaths = (missingRun.app.startupFailure() || []).map(x => x.path);

  const wrongUndo = replaceOrThrow(
    feedback,
    "\n    UNDO_WINDOW_MS,",
    '\n    UNDO_WINDOW_MS: "8000",',
    "wrong undo type"
  );
  const wrongUndoFile = path.join(__dirname, "feedback-wrong-undo-type.js");
  fs.writeFileSync(wrongUndoFile, wrongUndo);
  const wrongUndoRun = await bootCombination({ overrides: { "lib/feedback.js": wrongUndoFile } });
  const wrongUndoProblems = wrongUndoRun.app.startupFailure() || [];

  // TEST_FEEDBACK is consumed with `.map()`. `{}` has typeof "object", so this
  // checks whether the declared contract validates the actual array shape.
  const objectInsteadOfArray = replaceOrThrow(
    feedback,
    "\n    TEST_FEEDBACK,",
    "\n    TEST_FEEDBACK: {},",
    "TEST_FEEDBACK object shape"
  );
  const objectFeedbackFile = path.join(__dirname, "feedback-test-feedback-object.js");
  fs.writeFileSync(objectFeedbackFile, objectInsteadOfArray);
  const exposedCore = replaceOrThrow(
    core,
    "      renderMarkdown,\n      uid,",
    "      renderMarkdown,\n      testFeedbackButtonsHtml,\n      uid,",
    "test hook exposure"
  );
  const exposedCoreFile = path.join(__dirname, "app-core-expose-feedback-buttons.js");
  fs.writeFileSync(exposedCoreFile, exposedCore);
  const objectRun = await bootCombination({ overrides: {
    "lib/feedback.js": objectFeedbackFile,
    "app-core.js": exposedCoreFile
  } });
  let objectCall = { threw: false, message: null };
  try {
    objectRun.app.testFeedbackButtonsHtml();
  } catch (error) {
    objectCall = { threw: true, message: String(error && error.message || error) };
  }

  const checks = {
    baseline_closed: baseline.undeclared.length === 0 && baseline.ambiguousAliases.length === 0 &&
      baseline.ambiguousRefs.length === 0 && baseline.problems.length === 0,
    guarded_alias_detected: guardedAlias.undeclared.some(x => x.path === "Feedback.independentGuardedMember") &&
      guardedAlias.problems.length > 0 && !guardedAlias.guardedRefs.includes("Feedback.independentGuardedMember"),
    guarded_namespace_detected: guardedNamespace.undeclared.some(x => x.path === "Feedback.independentGuardedMember") &&
      guardedNamespace.problems.length > 0 && !guardedNamespace.guardedRefs.includes("Feedback.independentGuardedMember"),
    member_guard_preserved: trueMemberGuard.undeclared.length === 0 && trueMemberGuard.problems.length === 0 &&
      trueMemberGuard.guardedRefs.includes("Feedback.independentOptionalMember"),
    declarations_visible: baseline.declared.includes("Feedback.TEST_FEEDBACK") &&
      baseline.declared.includes("Feedback.UNDO_WINDOW_MS"),
    missing_constants_blocked: missingRun.ready === false && missingRun.disk.puts === 0 &&
      missingRun.intervals.indexOf(15000) < 0 &&
      missingPaths.includes("Feedback.TEST_FEEDBACK") && missingPaths.includes("Feedback.UNDO_WINDOW_MS"),
    wrong_undo_type_blocked: wrongUndoRun.ready === false && wrongUndoProblems.some(p =>
      p.path === "Feedback.UNDO_WINDOW_MS" && p.expected === "number" && p.actual === "string"),
    test_feedback_object_wrongly_passes_gate: objectRun.ready === true && objectRun.app.startupFailure() === null,
    test_feedback_object_breaks_real_consumer: objectCall.threw && /map is not a function/.test(objectCall.message)
  };

  console.log(JSON.stringify({
    checks,
    baseline: {
      declaredConstants: baseline.declared.filter(x => x.startsWith("Feedback.")),
      undeclared: baseline.undeclared,
      ambiguousAliases: baseline.ambiguousAliases,
      ambiguousRefs: baseline.ambiguousRefs,
      problems: baseline.problems
    },
    guardCases: { guardedAlias, guardedNamespace, trueMemberGuard },
    runtimeConstants: {
      missing: { ready: missingRun.ready, puts: missingRun.disk.puts, intervals: missingRun.intervals, paths: missingPaths },
      wrongUndo: { ready: wrongUndoRun.ready, problems: wrongUndoProblems },
      testFeedbackObject: {
        ready: objectRun.ready,
        startupFailure: objectRun.app.startupFailure(),
        call: objectCall
      }
    }
  }, null, 2));
  if (Object.values(checks).some(v => !v)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
