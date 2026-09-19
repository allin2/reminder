// Read-only probe of actual JS payload and actual Java parser; no device writes.
// Requires JDK 17, found via /usr/libexec/java_home or TASK_JAVA_HOME.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '../..');
process.env.TZ = 'Asia/Shanghai';
const core = fs.readFileSync(path.join(root, 'app-core.js'), 'utf8');
const start = core.indexOf('  function toLocalInput(ts)');
const end = core.indexOf('  function parseLocalInput', start);
if (start < 0 || end < start) throw new Error('toLocalInput extraction failed');
const localInput = new Function('pad', core.slice(start, end) + '\nreturn toLocalInput;')(
  n => String(n).padStart(2, '0'));
const tests = fs.readFileSync(path.join(root, 'test-native-reminders.js'), 'utf8').split('async function run()')[0];
const h = new Function('require', '__dirname', tests + '\nreturn {native,createEnvironment,item};')(
  createRequire(path.join(root, 'test-native-reminders.js')), root);
(async () => {
  await h.native._resetForTests();
  const env = h.createEnvironment();
  const trigger = Date.parse('2030-09-20T00:00:00Z');
  const value = localInput(trigger);
  await h.native.reconcile([h.item('audit-minute-format', 'critical', trigger,
    {scheduleBasis: 'wall-clock', localTrigger: value})], {notify: true}, trigger - 3600000);
  const payload = env.alarms.scheduleAlarm[0];
  console.log('FORM_TO_BRIDGE', JSON.stringify({localTrigger: payload.localTrigger, length: payload.localTrigger.length}));
  const java = fs.readFileSync(path.join(root, 'android/app/src/main/java/space/alliswell/inbox/SystemBridgePlugin.java'), 'utf8');
  const from = java.indexOf('  static long parseLocalTriggerInCurrentZone(');
  const to = java.indexOf('  static synchronized void recordMissedAlarm', from);
  if (from < 0 || to < from) throw new Error('Java method extraction failed');
  const program = 'import java.util.*;\nimport java.time.*;\n' + java.slice(from, to) +
    '\nTimeZone.setDefault(TimeZone.getTimeZone("Asia/Tokyo"));\n' +
    'long original = Instant.parse("2030-09-20T00:00:00Z").toEpochMilli();\n' +
    'System.out.println("ACTUAL="+Instant.ofEpochMilli(parseLocalTriggerInCurrentZone(' + JSON.stringify(payload.localTrigger) + ',original)));\n' +
    'System.out.println("EXPECTED=2030-09-19T23:00:00Z");\n/exit\n';
  const javaHome = process.env.TASK_JAVA_HOME || cp.execFileSync('/usr/libexec/java_home', ['-v', '17'], {encoding: 'utf8'}).trim();
  console.log(cp.execFileSync(path.join(javaHome, 'bin/jshell'), ['--feedback', 'concise'], {input: program, encoding: 'utf8'}));
  await h.native._resetForTests();
  delete global.Capacitor;
})().catch(error => { console.error(error); process.exitCode = 1; });
