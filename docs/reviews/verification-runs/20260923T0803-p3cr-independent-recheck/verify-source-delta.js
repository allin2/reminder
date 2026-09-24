"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(path.join(root, "app-core.js"), "utf8");
const oldWrapper = `  function wrapUserOp(fn, options) {
    let cached = null;
    return function () {
      if (!cached && appTransaction) {
        cached = appTransaction.wrapUserOp(fn, options);
      }
      if (cached) return cached.apply(null, arguments);
      return runUserOp(fn, Array.prototype.slice.call(arguments), options);
    };
  }`;
const oldSource = source.replace(/ {2}function wrapUserOp\(fn, options\) \{[\s\S]*?\n {2}\}/, oldWrapper);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
assert.notStrictEqual(oldSource, source);
assert.strictEqual(hash(source), "e7459c98b082c1ef03e8ecc1298b286bb9952cebe4cd90889d516c0221f17d05");
assert.strictEqual(hash(oldSource), "0a5ae42b518021a95a4a6d2c8dccd4cbf0f4c3feac00a2c2c7dea1d36c2a7c89");
console.log(JSON.stringify({ currentCore: hash(source), oldCoreReconstructedInMemory: hash(oldSource),
  onlyCoreChange: "wrapUserOp instance-keyed cache" }, null, 2));
