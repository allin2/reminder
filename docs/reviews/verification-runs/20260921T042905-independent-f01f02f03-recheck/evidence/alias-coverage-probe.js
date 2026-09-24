"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../../../../..");
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));
const source = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");

// Use an existing real FeedbackLib alias site. The replacement is a required
// member call guarded only by the module object (`f ? ...`), so the member
// itself is not optional and must be declared by the startup gate.
const viaAmbiguousF = source.replace(
  "f ? f.setupSteps(nativeReminderStatus, setupStepsContext()) : null",
  "f ? f.independentUndeclaredMember(nativeReminderStatus, setupStepsContext()) : null"
);
if (viaAmbiguousF === source) throw new Error("f alias mutation did not apply");

// Control: the same missing member through the unambiguous namespace alias.
const viaDirectAlias = source.replace(
  "FeedbackLib.saveFeedback(\"failed\")",
  "FeedbackLib.independentUndeclaredMember(\"failed\")"
);
if (viaDirectAlias === source) throw new Error("direct alias mutation did not apply");

const baseline = prod.runtimeDependencyCoverage(ROOT);
const ambiguous = prod.runtimeDependencyCoverage(ROOT, { source: viaAmbiguousF });
const control = prod.runtimeDependencyCoverage(ROOT, { source: viaDirectAlias });
const result = {
  baseline: {
    undeclared: baseline.undeclared,
    ambiguousAliases: baseline.ambiguousAliases,
    ambiguousRefs: baseline.ambiguousRefs,
    aliases: baseline.aliases
  },
  ambiguousFMutation: {
    undeclared: ambiguous.undeclared,
    ambiguousRefs: ambiguous.ambiguousRefs.filter(x => x.includes("independentUndeclaredMember"))
  },
  directAliasControl: {
    undeclared: control.undeclared.filter(x => x.path.includes("independentUndeclaredMember"))
  },
  blindSpotReproduced:
    ambiguous.undeclared.length === 0 &&
    ambiguous.ambiguousRefs.includes("f.independentUndeclaredMember") &&
    control.undeclared.some(x => x.path === "Feedback.independentUndeclaredMember")
};

console.log(JSON.stringify(result, null, 2));
if (!result.blindSpotReproduced) process.exit(1);
