// Read-only Node probes: actual JS production functions with mocked platform I/O.
// Run from any directory. Does not invoke adb or change application data.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '../..');
const harnessSource = fs.readFileSync(path.join(root, 'test-native-reminders.js'), 'utf8').split('async function run()')[0];
const h = new Function('require', '__dirname', harnessSource + '\nreturn {native,createEnvironment,item};')(
  createRequire(path.join(root, 'test-native-reminders.js')), root);

(async () => {
  const { native, createEnvironment, item } = h;
  const now = Date.now();
  const a = item('independent-audit', 'critical', now + 3600000, {scheduleBasis: 'elapsed', localTrigger: null});
  await native._resetForTests();
  const env = createEnvironment();
  const first = await native.reconcile([a], {notify: true}, now);
  console.log('TIME_BASIS', JSON.stringify({expected: 'elapsed', actual: env.alarms.scheduleAlarm[0].scheduleBasis,
    localTrigger: env.alarms.scheduleAlarm[0].localTrigger}));

  const saved = {notify: true, scheduledAlarmIds: first.scheduledAlarmIds,
    scheduledAlarmSignatures: first.scheduledAlarmSignatures};
  await native._resetForTests();
  const cold = createEnvironment();
  await native.reconcile([a], saved, now);
  console.log('COLD_REBUILD', JSON.stringify({expectedScheduleCalls: 1, actual: cold.alarms.scheduleAlarm.length}));

  await native._resetForTests();
  const race = createEnvironment();
  let release, entered;
  const gate = new Promise(r => { release = r; });
  const entry = new Promise(r => { entered = r; });
  const original = global.Capacitor.Plugins.SystemBridge.scheduleAlarm;
  global.Capacitor.Plugins.SystemBridge.scheduleAlarm = async value => {
    entered(); await gate; return original(value);
  };
  const source = fs.readFileSync(path.join(root, 'app-core.js'), 'utf8');
  const start = source.indexOf('  async function syncNativeRemindersNow()');
  const end = source.indexOf('\n  /**', start);
  if (start < 0 || end < start) throw new Error('Production function extraction failed');
  // Use the unmodified production sync function; isolate UI and persistence effects.
  const ctx = vm.createContext({NativeReminders: native, Date, JSON, Array, nativeReady: true,
    nativeReminderStatus: {}, nativeSyncInFlight: false, nativeSyncPending: false, nativeSyncVersion: 0,
    nativeSyncMetrics: {runs: 0, deduped: 0},
    state: {items: [a], settings: {notify: true, scheduledAlarmIds: [], scheduledAlarmSignatures: {}}},
    needsReviewItems: () => [], ensureReviewSettings: () => ({}), setNativeReminderStatus: () => {},
    applyDeadlineEvents: () => {}, applyReminderEvents: () => {},
    sameIdSet: (x, y) => JSON.stringify(x) === JSON.stringify(y),
    save: () => { ctx.nativeSyncVersion++; }});
  vm.runInContext(source.slice(start, end), ctx);
  const running = ctx.syncNativeRemindersNow();
  await entry;
  ctx.state.items = [];
  ctx.nativeSyncVersion++;
  release();
  await running;
  console.log('INFLIGHT_DELETE', JSON.stringify({runs: ctx.nativeSyncMetrics.runs,
    items: ctx.state.items.length, ledger: ctx.state.settings.scheduledAlarmIds,
    schedules: race.alarms.scheduleAlarm.length, expectedCancels: 1, actualCancels: race.alarms.cancelAlarm.length}));
  await native._resetForTests();
  delete global.Capacitor;
})().catch(error => { console.error(error); process.exitCode = 1; });
