"use strict";

// Independent acceptance probe. Exit 1 while either P3-G behavior is broken.
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(path.join(root, "lib/app-alerts.js"), "utf8");
const api = require(path.join(root, "lib/app-alerts.js"));
const required = [...source.match(/const REQUIRED_DEPS = \[([\s\S]*?)\];/)[1].matchAll(/"([A-Za-z]+)"/g)]
  .map(match => match[1]);

function fixture(save) {
  const listeners = Object.create(null);
  const messages = [];
  const item = { id: "p3g-probe", title: "probe", priority: "normal", status: "due", rev: 1 };
  const state = { items: [item], settings: { notify: false }, ui: { tab: "home" } };
  const nodes = Object.create(null);
  const query = selector => nodes[selector] ||= {
    textContent: "",
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { (listeners[selector + ":" + type] ||= []).push(fn); }
  };
  const deps = Object.fromEntries(required.map(name => [name, () => {}]));
  Object.assign(deps, {
    getState: () => state,
    query,
    runUserOp: (fn, args) => fn(...args),
    bumpRev: target => { target.rev += 1; },
    save,
    toast: message => messages.push(message),
    updateAppBadge: () => {},
    isNativeAndroid: () => false
  });
  return { alerts: api.createAppAlerts(deps), listeners, messages, item };
}

(async () => {
  const binding = fixture(() => Promise.resolve(true));
  binding.alerts.bindAlertControls();
  binding.alerts.bindAlertControls();
  const closeListeners = binding.listeners["#alertClose:click"] || [];
  closeListeners.forEach(fn => fn({ stopPropagation() {} }));
  const duplicateBinding = closeListeners.length !== 1 || binding.messages.length !== 1;
  console.log(JSON.stringify({ case: "repeat-bind", listenerCount: closeListeners.length,
    toastCount: binding.messages.length, expected: 1, duplicateBinding }));

  const failedSave = fixture(() => {
    const pending = Promise.reject(new Error("IDB denied"));
    pending.catch(() => {});
    return pending;
  });
  failedSave.alerts.showAlert(failedSave.item);
  let result;
  try { result = await failedSave.alerts.dismissAlert(); }
  catch (error) { result = "rejected:" + error.message; }
  failedSave.alerts.hideAlert();
  const falseSuccess = result === true || failedSave.messages.includes("已关闭提醒 · 事项仍在首页");
  console.log(JSON.stringify({ case: "save-rejected", result,
    toasts: failedSave.messages, falseSuccess }));
  if (duplicateBinding || falseSuccess) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 2; });
