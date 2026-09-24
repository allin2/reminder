"use strict";

const fs = require("fs");
const path = require("path");
const { bootCombination } = require("../../../../../test-boot-combination.js");
const ROOT = path.resolve(__dirname, "../../../../..");
const OUT = __dirname;

function write(name, content) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, content);
  return file;
}

function paths(run) {
  const p = run.app && run.app.startupFailure();
  return Array.isArray(p) ? p.map(x => x.path) : [];
}

async function main() {
  const core = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
  const feedback = fs.readFileSync(path.join(ROOT, "lib/feedback.js"), "utf8");
  const native = fs.readFileSync(path.join(ROOT, "lib/native-reminders.js"), "utf8");
  const indexScripts = require(path.join(ROOT, "scripts/verification/production-scripts.js"))
    .readIndexScripts(ROOT);

  const feedbackNull = write("feedback-null.js", feedback + "\nAttentionLib.Feedback = null;\n");
  const baselineNull = await bootCombination({ overrides: { "lib/feedback.js": feedbackNull } });

  const m1 = core.replace(
    "if (got === null || typeof got !== want)",
    "if (typeof got !== want)"
  );
  if (m1 === core) throw new Error("M1 patch did not apply");
  const m1Run = await bootCombination({
    overrides: {
      "app-core.js": write("m1-app-core.js", m1),
      "lib/feedback.js": feedbackNull
    }
  });

  const missingNativeScripts = indexScripts.filter(x => x !== "lib/native-reminders.js");
  const baselineNative = await bootCombination({ scripts: missingNativeScripts });
  const m2 = core.replace(
    "const want = REQUIRED_RUNTIME_EXPORTS[i][1];",
    "if (/^(AttentionNativeReminders|NativeReminders\\.)/.test(path0)) continue;\n      const want = REQUIRED_RUNTIME_EXPORTS[i][1];"
  );
  if (m2 === core) throw new Error("M2 patch did not apply");
  const m2Run = await bootCombination({
    scripts: missingNativeScripts,
    overrides: { "app-core.js": write("m2-app-core.js", m2) }
  });

  const brokenNative = native.replace("\n    reconcile,", "\n    reconcile: undefined,");
  if (brokenNative === native) throw new Error("native patch did not apply");
  const brokenNativeFile = write("native-missing-reconcile.js", brokenNative);
  const baselineReconcile = await bootCombination({
    overrides: { "lib/native-reminders.js": brokenNativeFile }
  });
  const m3 = core.replace(
    "const want = REQUIRED_RUNTIME_EXPORTS[i][1];",
    "if (path0 === 'NativeReminders.reconcile') continue;\n      const want = REQUIRED_RUNTIME_EXPORTS[i][1];"
  );
  if (m3 === core) throw new Error("M3 patch did not apply");
  const m3Run = await bootCombination({
    overrides: {
      "app-core.js": write("m3-app-core.js", m3),
      "lib/native-reminders.js": brokenNativeFile
    }
  });

  const checks = {
    baseline_null_names_root: paths(baselineNull).includes("Feedback"),
    m1_removes_root_diagnostic: !paths(m1Run).includes("Feedback"),
    baseline_missing_native_names_root: paths(baselineNative).includes("AttentionNativeReminders"),
    m2_removes_native_diagnostics: paths(m2Run).filter(x => x === "AttentionNativeReminders" || x.startsWith("NativeReminders.")).length === 0,
    baseline_missing_reconcile_names_member: paths(baselineReconcile).includes("NativeReminders.reconcile"),
    m3_removes_reconcile_diagnostic: !paths(m3Run).includes("NativeReminders.reconcile")
  };
  const result = {
    checks,
    observations: {
      baselineNull: { ready: baselineNull.ready, paths: paths(baselineNull) },
      m1: { ready: m1Run.ready, paths: paths(m1Run) },
      baselineNative: { ready: baselineNative.ready, puts: baselineNative.disk.puts, paths: paths(baselineNative) },
      m2: { ready: m2Run.ready, puts: m2Run.disk.puts, paths: paths(m2Run), errors: m2Run.consoleErrors },
      baselineReconcile: { ready: baselineReconcile.ready, paths: paths(baselineReconcile) },
      m3: { ready: m3Run.ready, paths: paths(m3Run), errors: m3Run.consoleErrors }
    }
  };
  console.log(JSON.stringify(result, null, 2));
  if (Object.values(checks).some(v => !v)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
