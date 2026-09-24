"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(path.join(root, "lib/app-events.js"), "utf8");
const names = source.match(/const REQUIRED_DEPS = \[([\s\S]*?)\];/)[1]
  .match(/"[^"]+"/g).map(JSON.parse);
const create = require(path.join(root, "lib/app-events.js")).createAppEvents;

function dependencies() {
  return Object.fromEntries(names.map(name => [name, () => {}]));
}

let listeners = 0;
global.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => { listeners++; }
};

// Control: a healthy first bind reaches the document listener.
const control = create(dependencies());
control.bind();
assert.strictEqual(control.isBound(), true);
assert.ok(listeners > 0);
console.log("CONTROL: first bind registers " + listeners + " document listeners");

// A transient failure before listener registration must remain retryable.
listeners = 0;
let setupCalls = 0;
const deps = dependencies();
deps.bindSetupReviewControls = () => {
  setupCalls++;
  if (setupCalls === 1) throw new Error("transient setup bind failure");
};
const instance = create(deps);
assert.throws(() => instance.bind(), /transient setup bind failure/);
instance.bind();
console.log(JSON.stringify({
  case: "retry after transient bind failure",
  bound: instance.isBound(), setupCalls, listeners
}));
assert.strictEqual(setupCalls, 2, "retry must re-enter binding after a failed first attempt");
assert.ok(listeners > 0, "retry must register the remaining document listeners");
