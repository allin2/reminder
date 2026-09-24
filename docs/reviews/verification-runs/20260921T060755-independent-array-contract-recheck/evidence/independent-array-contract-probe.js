"use strict";

const fs = require("fs");
const path = require("path");
const { bootCombination } = require("../../../../../test-boot-combination.js");

const ROOT = path.resolve(__dirname, "../../../../..");
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));
const core = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
const feedback = fs.readFileSync(path.join(ROOT, "lib/feedback.js"), "utf8");

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(label + ": mutation target missing");
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(label + ": mutation target is not unique");
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function writeFixture(name, source) {
  const file = path.join(__dirname, name);
  fs.writeFileSync(file, source);
  return file;
}

function feedbackFixture(name, expression) {
  return writeFixture(name, replaceOnce(
    feedback,
    "\n    TEST_FEEDBACK,",
    "\n    TEST_FEEDBACK: " + expression + ",",
    name
  ));
}

function summarizeProblem(run) {
  const failures = run.app.startupFailure() || [];
  return failures.find(p => p.path === "Feedback.TEST_FEEDBACK") || null;
}

function sideEffects(run) {
  return {
    puts: run.disk.puts,
    schedules: run.env.calls.schedule.length,
    alarmSchedules: run.env.calls.scheduleAlarm.length,
    intervals: run.intervals.slice()
  };
}

function stoppedBeforeEffects(run) {
  const s = sideEffects(run);
  return run.ready === false && s.puts === 0 && s.schedules === 0 &&
    s.alarmSchedules === 0 && s.intervals.indexOf(15000) < 0 && s.intervals.indexOf(2000) < 0;
}

async function bootFeedback(name, expression, coreFile) {
  const overrides = { "lib/feedback.js": feedbackFixture(name, expression) };
  if (coreFile) overrides["app-core.js"] = coreFile;
  return bootCombination({ overrides });
}

async function main() {
  const baselineStatic = prod.runtimeDependencyCoverage(ROOT);
  const baselineRun = await bootCombination();

  const downgradeSource = replaceOnce(
    core,
    '["Feedback.TEST_FEEDBACK", "array",',
    '["Feedback.TEST_FEEDBACK", "object",',
    "static type downgrade"
  );
  const downgradedStatic = prod.runtimeDependencyCoverage(ROOT, { source: downgradeSource });

  const cases = {
    object: await bootFeedback("feedback-array-object.js", "{}"),
    empty: await bootFeedback("feedback-array-empty.js", "[]"),
    missingLabel: await bootFeedback("feedback-array-missing-label.js", '[{ value: "heard" }]'),
    missingValue: await bootFeedback("feedback-array-missing-value.js", '[{ label: "我听到了" }]'),
    primitiveItem: await bootFeedback("feedback-array-primitive-item.js", "[7]"),
    laterMissingLabel: await bootFeedback(
      "feedback-array-later-missing-label.js",
      '[{ value: "heard", label: "我听到了" }, { value: "seen" }]'
    )
  };

  const downgradedCore = writeFixture("app-core-contract-object.js", downgradeSource);
  const downgradeRun = await bootFeedback("feedback-object-for-downgrade.js", "{}", downgradedCore);

  const noShapeSource = replaceOnce(
    core,
    '      ["value", "label"]],',
    "      null],",
    "remove item shape"
  );
  const noShapeCore = writeFixture("app-core-without-item-shape.js", noShapeSource);
  const noShapeRun = await bootFeedback(
    "feedback-missing-label-for-no-shape.js",
    '[{ value: "heard" }]',
    noShapeCore
  );

  const noEmptySource = replaceOnce(
    core,
    '        if (got.length === 0) return { expected: expected, actual: "空数组（清单至少要有一项）" };',
    "        if (false) return null; // independent mutation: disable the non-empty requirement",
    "remove non-empty check"
  );
  const noEmptyCore = writeFixture("app-core-without-nonempty-check.js", noEmptySource);
  const noEmptyRun = await bootFeedback("feedback-empty-for-no-empty-check.js", "[]", noEmptyCore);

  // The implementation explicitly leaves field value types outside this round. Record that boundary
  // independently so the PASS cannot be read as a stronger value-type contract.
  const valueTypeBoundary = await bootFeedback(
    "feedback-wrong-field-value-types.js",
    '[{ value: {}, label: 3 }]'
  );

  const details = {};
  for (const [name, run] of Object.entries(cases)) {
    details[name] = {
      ready: run.ready,
      problem: summarizeProblem(run),
      sideEffects: sideEffects(run)
    };
  }

  const expectedActual = {
    object: /不是数组/,
    empty: /空数组/,
    missingLabel: /array\[0\].*缺少 label/,
    missingValue: /array\[0\].*缺少 value/,
    primitiveItem: /array\[0\].*元素不是对象/,
    laterMissingLabel: /array\[1\].*缺少 label/
  };

  const everyBadShapeBlocked = Object.entries(cases).every(([name, run]) => {
    const p = summarizeProblem(run);
    return stoppedBeforeEffects(run) && p && p.expected === "array<value,label>" &&
      expectedActual[name].test(String(p.actual));
  });

  const staticExits = value => ({
    undeclared: value.undeclared,
    ambiguousAliases: value.ambiguousAliases,
    ambiguousRefs: value.ambiguousRefs,
    problems: value.problems
  });

  const checks = {
    baseline_ready: baselineRun.ready === true && baselineRun.app.startupFailure() === null,
    baseline_static_closed: baselineStatic.undeclared.length === 0 &&
      baselineStatic.ambiguousAliases.length === 0 && baselineStatic.ambiguousRefs.length === 0 &&
      baselineStatic.problems.length === 0,
    declaration_is_array: baselineStatic.declaredTypeOf["Feedback.TEST_FEEDBACK"] === "array" &&
      baselineStatic.declaredTypeOf["Feedback.UNDO_WINDOW_MS"] === "number",
    type_whitelist_supports_array: prod.CONTRACT_TYPES.indexOf("array") >= 0 &&
      baselineStatic.declaredTypes.every(t => prod.CONTRACT_TYPES.indexOf(t) >= 0),
    bad_shapes_fail_before_effects: everyBadShapeBlocked,
    static_downgrade_remains_closed: downgradedStatic.declaredTypeOf["Feedback.TEST_FEEDBACK"] === "object" &&
      downgradedStatic.undeclared.length === 0 && downgradedStatic.ambiguousAliases.length === 0 &&
      downgradedStatic.ambiguousRefs.length === 0 && downgradedStatic.problems.length === 0,
    array_check_has_teeth: downgradeRun.ready === true && downgradeRun.app.startupFailure() === null,
    item_shape_check_has_teeth: noShapeRun.ready === true && noShapeRun.app.startupFailure() === null,
    nonempty_check_has_teeth: noEmptyRun.ready === true && noEmptyRun.app.startupFailure() === null,
    documented_value_type_boundary_confirmed: valueTypeBoundary.ready === true &&
      valueTypeBoundary.app.startupFailure() === null,
    cache_version_raised: /const CACHE = "attention-inbox-v10";/.test(
      fs.readFileSync(path.join(ROOT, "sw.js"), "utf8")
    )
  };

  const output = {
    checks,
    baseline: {
      ready: baselineRun.ready,
      static: staticExits(baselineStatic),
      testFeedbackType: baselineStatic.declaredTypeOf["Feedback.TEST_FEEDBACK"],
      undoType: baselineStatic.declaredTypeOf["Feedback.UNDO_WINDOW_MS"],
      declaredTypes: baselineStatic.declaredTypes,
      contractTypes: prod.CONTRACT_TYPES
    },
    badShapes: details,
    staticBoundary: {
      downgradedType: downgradedStatic.declaredTypeOf["Feedback.TEST_FEEDBACK"],
      exits: staticExits(downgradedStatic)
    },
    mutationControls: {
      typeDowngrade: { ready: downgradeRun.ready, failure: downgradeRun.app.startupFailure() },
      itemShapeRemoved: { ready: noShapeRun.ready, failure: noShapeRun.app.startupFailure() },
      nonemptyRemoved: { ready: noEmptyRun.ready, failure: noEmptyRun.app.startupFailure() }
    },
    documentedBoundary: {
      wrongFieldValueTypes: {
        ready: valueTypeBoundary.ready,
        failure: valueTypeBoundary.app.startupFailure()
      }
    }
  };

  console.log(JSON.stringify(output, null, 2));
  if (Object.values(checks).some(v => !v)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
