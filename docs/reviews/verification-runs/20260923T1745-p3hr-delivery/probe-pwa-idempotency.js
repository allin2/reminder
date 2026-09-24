const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('/Users/qlyf/Developer/reminder/lib/app-platform.js', 'utf8');
const box = { module: { exports: {} }, self: {}, setTimeout, clearTimeout, Promise, Date };
vm.runInNewContext(source, box);
const { createAppPlatform } = box.module.exports;
const counts = { register: 0, updatefound: 0, message: 0, controllerchange: 0 };
const reg = { waiting: null, installing: null, addEventListener(type) { if (type === 'updatefound') counts.updatefound++; } };
const sw = {
  register() { counts.register++; return Promise.resolve(reg); },
  addEventListener(type) { counts[type]++; },
  removeEventListener() {}
};
const app = createAppPlatform({
  getCapacitor: () => null, getNativeReminders: () => null,
  getServiceWorker: () => sw, getWindow: () => null, getDocument: () => null,
  toast: () => {}, renderPwaStatus: () => {}, onNotificationAction: () => {},
  noteAppVisibility: () => {}, onForeground: () => {}
});
(async () => {
  app.registerPwa();
  app.registerPwa();
  await Promise.resolve();
  console.log(JSON.stringify(counts));
  if (counts.register !== 1 || counts.updatefound !== 1 || counts.message !== 1 || counts.controllerchange !== 1) {
    process.exitCode = 1;
  }
})();
