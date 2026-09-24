const assert = require('assert');
const { createAppPlatform } = require('/Users/qlyf/Developer/reminder/lib/app-platform.js');

function platform(sw) {
  return createAppPlatform({
    getCapacitor: () => null, getNativeReminders: () => null,
    getServiceWorker: () => sw, getWindow: () => null, getDocument: () => null,
    toast: () => {}, renderPwaStatus: () => {}, onNotificationAction: () => {},
    noteAppVisibility: () => {}, onForeground: () => {}
  });
}

(async () => {
  const counts = { register: 0, updatefound: 0, message: 0, controllerchange: 0 };
  const reg = { addEventListener(type) { counts[type]++; } };
  let resolveFirst;
  const pending = new Promise(resolve => { resolveFirst = resolve; });
  const sw = {
    register() { counts.register++; return pending; },
    addEventListener(type) { counts[type]++; }, removeEventListener() {}
  };
  const app = platform(sw);
  app.registerPwa(); app.registerPwa();
  assert.strictEqual(counts.register, 1);
  resolveFirst(reg);
  await pending;
  await Promise.resolve();
  app.registerPwa(); app.registerPwa();
  assert.deepStrictEqual(counts, { register: 1, updatefound: 1, message: 1, controllerchange: 1 });

  let attempts = 0;
  const success = { addEventListener() {} };
  const retry = platform({
    register() { attempts++; return attempts === 1 ? Promise.reject(new Error('reject')) : Promise.resolve(success); },
    addEventListener() {}, removeEventListener() {}
  });
  retry.registerPwa();
  await new Promise(resolve => setImmediate(resolve));
  retry.registerPwa();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(attempts, 2);
  assert.strictEqual(retry.getSwRegistration(), success);

  console.log(JSON.stringify({ counts, retryAttempts: attempts, retrySucceeded: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
