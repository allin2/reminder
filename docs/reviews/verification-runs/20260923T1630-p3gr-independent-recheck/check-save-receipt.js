"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(path.join(root, "lib/app-alerts.js"), "utf8");
const names = [...source.match(/const REQUIRED_DEPS = \[([\s\S]*?)\];/)[1].matchAll(/"([A-Za-z]+)"/g)]
  .map(match => match[1]);
const { createAppAlerts } = require(path.join(root, "lib/app-alerts.js"));

async function check(label, save, expected) {
  const item = { id: label, title: label, priority: "normal", status: "due", rev: 1 };
  const state = { items: [item], settings: { notify: false }, ui: { tab: "home" } };
  const toasts = [];
  const node = { textContent: "", classList: { add() {}, remove() {}, toggle() {} } };
  const deps = Object.fromEntries(names.map(name => [name, () => {}]));
  Object.assign(deps, {
    getState: () => state,
    query: () => node,
    runUserOp: (fn, args) => fn(...args),
    bumpRev: target => { target.rev += 1; },
    save,
    toast: message => toasts.push(message),
    updateAppBadge: () => {},
    isNativeAndroid: () => false
  });
  const alerts = createAppAlerts(deps);
  alerts.showAlert(item);
  const result = await alerts.dismissAlert();
  assert.strictEqual(result, expected);
  assert.strictEqual(toasts.includes("已关闭提醒 · 事项仍在首页"), expected);
  alerts.clearAlert();
  return { label, result, successToast: toasts.includes("已关闭提醒 · 事项仍在首页"), itemRev: item.rev };
}

(async () => {
  const rows = [];
  rows.push(await check("suppressed-undefined", () => undefined, false));
  rows.push(await check("rejected-promise", () => Promise.reject(new Error("save rejected")), false));
  rows.push(await check("committed-promise", () => Promise.resolve(true), true));
  rows.push(await check("truthy-sync-no-commit", () => true, true));
  rows.push(await check("resolved-false-no-commit", () => Promise.resolve(false), true));
  console.log(JSON.stringify(rows));
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
