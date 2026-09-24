const assert = require('assert');
const { createAppPlatform } = require('/Users/qlyf/Developer/reminder/lib/app-platform.js');
let renders = 0;
let actions = 0;
let messageHandler;
const sw = {
  register: () => Promise.reject(new Error('registration rejected')),
  addEventListener: (type, fn) => { if (type === 'message') messageHandler = fn; }
};
const app = createAppPlatform({
  getCapacitor: () => null, getNativeReminders: () => null,
  getServiceWorker: () => sw, getWindow: () => null, getDocument: () => null,
  toast: () => {}, renderPwaStatus: () => { renders++; },
  onNotificationAction: () => { actions++; },
  noteAppVisibility: () => {}, onForeground: () => {}
});
app.registerPwa();
setImmediate(() => {
  assert.strictEqual(renders, 1);
  assert.strictEqual(app.getSwRegistration(), null);
  messageHandler({data:{type:'notification-action',action:'done'}});
  assert.strictEqual(actions, 1);
  console.log(JSON.stringify({renders,registration:null,actions}));
});
