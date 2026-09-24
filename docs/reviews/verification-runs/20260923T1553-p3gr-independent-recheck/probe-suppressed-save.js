"use strict";

// Contract probe only: models an in-flight transaction that suppresses inner saves.
// Exit 1 when the UI reports success without any authoritative commit receipt.
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(path.join(root, "lib/app-alerts.js"), "utf8");
const names = [...source.match(/const REQUIRED_DEPS = \[([\s\S]*?)\];/)[1].matchAll(/"([A-Za-z]+)"/g)]
  .map(match => match[1]);
const deps = Object.fromEntries(names.map(name => [name, () => {}]));
const item = { id: "inflight-probe", title: "probe", priority: "normal", status: "due", rev: 1 };
const state = { items: [item], settings: { notify: false }, ui: { tab: "home" } };
const toasts = [];
let saves = 0;
const node = { textContent: "", classList: { add() {}, remove() {}, toggle() {} } };
Object.assign(deps, {
  getState: () => state,
  query: () => node,
  runUserOp: (fn, args) => fn(...args),
  bumpRev: target => { target.rev += 1; },
  shouldSuppressInnerSave: () => true,
  save: () => { saves += 1; return Promise.resolve(true); },
  toast: message => toasts.push(message),
  updateAppBadge: () => {},
  isNativeAndroid: () => false
});
const alerts = require(path.join(root, "lib/app-alerts.js")).createAppAlerts(deps);
alerts.showAlert(item);
(async () => {
  const result = await alerts.dismissAlert();
  const prematureSuccess = result === true && saves === 0 && toasts.includes("已关闭提醒 · 事项仍在首页");
  console.log(JSON.stringify({ result, saves, toasts, prematureSuccess,
    scope: "forced shouldSuppressInnerSave branch; production reachability not established" }));
  if (prematureSuccess) process.exitCode = 1;
})().finally(() => alerts.clearAlert()).catch(error => {
  console.error(error.stack || error);
  process.exitCode = 2;
});
