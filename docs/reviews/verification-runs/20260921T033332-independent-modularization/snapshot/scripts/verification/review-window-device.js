// Execute through android-cdp-eval.py in the installed WebView. No user settings/items are changed.
(async () => {
  const N = window.AttentionNativeReminders;
  const L = window.Capacitor.Plugins.LocalNotifications;
  const now = new Date(2030, 0, 15, 20, 0).getTime();
  const rs = { enabled: true, hour: 21, minute: 30, windowEndHour: 23,
    windowEndMinute: 0, followupMs: 3600000, maxFollowups: 2 };
  const times = list => list.map(n => n.schedule.at.getHours() + ':' + n.schedule.at.getMinutes()).join(',');
  const base = N.buildReviewDesired(6, rs, now, { notify: true, dnd: false });
  const checks = {
    defaultWindow: times(base) === '21:30,22:30',
    quietEndExcluded: N.buildReviewDesired(6, rs, now, { dnd: true, quietStart: '20:00', quietEnd: '23:00' }).length === 0,
    longWindow: times(N.buildReviewDesired(6, { ...rs, hour: 20, minute: 0 }, now - 3600000, {})) === '20:0,21:0,22:0',
    crossMidnight: times(N.buildReviewDesired(6, { ...rs, hour: 23, windowEndHour: 2 }, new Date(2030, 0, 16, 0, 10).getTime(), {})) === '0:30,1:30',
    explicitSnooze: N.buildReviewDesired(6, { ...rs, snoozedUntil: new Date(2030, 0, 15, 23, 20).getTime() }, now, {}).some(n => n.schedule.at.getHours() === 23 && n.schedule.at.getMinutes() === 20)
  };
  if (!Object.values(checks).every(Boolean)) throw new Error(JSON.stringify(checks));
  const ids = [1900190901, 1900190902];
  const before = (await L.getPending()).notifications || [];
  if (before.some(n => ids.includes(n.id))) throw new Error('Test ID collision; no changes made');
  let pending;
  try {
    await L.schedule({ notifications: base.map((n, i) => ({ ...n, id: ids[i], title: 'N4 排程验收', body: '隔离测试，随即撤销' })) });
    pending = ((await L.getPending()).notifications || []).filter(n => ids.includes(n.id));
    checks.nativePending = pending.length === 2 && pending.every(n =>
      new Date(n.schedule.at).getTime() === base[ids.indexOf(n.id)].schedule.at.getTime());
  } finally {
    await L.cancel({ notifications: ids.map(id => ({ id })) });
  }
  checks.cleaned = !((await L.getPending()).notifications || []).some(n => ids.includes(n.id));
  return JSON.stringify({ checks, pending, pass: Object.values(checks).every(Boolean) });
})()
