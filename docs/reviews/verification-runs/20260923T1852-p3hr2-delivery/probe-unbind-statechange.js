const { createAppPlatform } = require('/Users/qlyf/Developer/reminder/lib/app-platform.js');
const listeners = { reg: [], worker: [] };
let skipWaiting = 0;
const worker = {
  state: 'installing',
  addEventListener(type, fn) { if (type === 'statechange') listeners.worker.push(fn); },
  removeEventListener(type, fn) { if (type === 'statechange') listeners.worker = listeners.worker.filter(f => f !== fn); },
  postMessage(data) { if (data.type === 'SKIP_WAITING') skipWaiting++; }
};
const reg = {
  waiting: null, installing: worker,
  addEventListener(type, fn) { if (type === 'updatefound') listeners.reg.push(fn); },
  removeEventListener(type, fn) { if (type === 'updatefound') listeners.reg = listeners.reg.filter(f => f !== fn); }
};
const sw = {
  controller: {}, register: () => Promise.resolve(reg),
  addEventListener() {}, removeEventListener() {}
};
const app = createAppPlatform({
  getCapacitor: () => null, getNativeReminders: () => null,
  getServiceWorker: () => sw, getWindow: () => null, getDocument: () => null,
  toast: () => {}, renderPwaStatus: () => {}, onNotificationAction: () => {},
  noteAppVisibility: () => {}, onForeground: () => {}
});
(async () => {
  app.registerPwa();
  await Promise.resolve();
  listeners.reg.slice().forEach(fn => fn());
  const before = { reg: listeners.reg.length, worker: listeners.worker.length, skipWaiting };
  app.unbindAll();
  worker.state = 'installed';
  listeners.worker.slice().forEach(fn => fn());
  const after = { reg: listeners.reg.length, worker: listeners.worker.length, skipWaiting };
  console.log(JSON.stringify({before, after}));
  if (after.skipWaiting !== before.skipWaiting) process.exitCode = 2;
})();
