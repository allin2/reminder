const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('/Users/qlyf/Developer/reminder/lib/app-platform.js', 'utf8');

async function run(src) {
  const box = { module: { exports: {} }, self: {}, setTimeout, clearTimeout, Promise, Date };
  vm.runInNewContext(src, box);
  let staleCallback;
  let updateFound;
  let skipWaiting = 0;
  const worker = {
    state: 'installing',
    addEventListener(type, fn) { if (type === 'statechange') staleCallback = fn; },
    removeEventListener() {},
    postMessage(data) { if (data.type === 'SKIP_WAITING') skipWaiting++; }
  };
  const reg = {
    installing: worker,
    addEventListener(type, fn) { if (type === 'updatefound') updateFound = fn; },
    removeEventListener() {}
  };
  const sw = {
    controller: {}, register: () => Promise.resolve(reg),
    addEventListener() {}, removeEventListener() {}
  };
  const app = box.module.exports.createAppPlatform({
    getCapacitor: () => null, getNativeReminders: () => null,
    getServiceWorker: () => sw, getWindow: () => null, getDocument: () => null,
    toast: () => {}, renderPwaStatus: () => {}, onNotificationAction: () => {},
    noteAppVisibility: () => {}, onForeground: () => {}
  });
  app.registerPwa();
  await Promise.resolve();
  updateFound();
  assert.strictEqual(typeof staleCallback, 'function');
  app.unbindAll();
  worker.state = 'installed';
  staleCallback(); // Simulate a callback already queued before removeEventListener.
  return skipWaiting;
}

(async () => {
  const healthy = await run(source);
  const needle = 'workerStateChangeHandler = function() {\n                if (currentEpoch !== swEpoch) return;';
  assert(source.includes(needle));
  const mutant = await run(source.replace(needle, 'workerStateChangeHandler = function() {\n                /* epoch guard omitted */'));
  console.log(JSON.stringify({ healthySkipWaiting: healthy, mutantSkipWaiting: mutant }));
  assert.strictEqual(healthy, 0);
  assert.strictEqual(mutant, 1);
})().catch(error => { console.error(error); process.exitCode = 1; });
