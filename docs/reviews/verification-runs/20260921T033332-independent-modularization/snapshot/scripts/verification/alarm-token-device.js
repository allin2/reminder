// Isolated native bridge test. Abort if a user delivery is already active.
(async () => {
  const B = window.Capacitor.Plugins.SystemBridge;
  const id = 1900190903, itemId = 'n4-token-isolation';
  const pause = ms => new Promise(r => setTimeout(r, ms));
  if (((await B.activeAlarmDeliveries()).alarms || []).length) throw new Error('Active deliveries exist; untouched');
  const delivered = async token => {
    for (let i = 0; i < 15; i++) {
      const rows = (await B.activeAlarmDeliveries()).alarms || [];
      if (rows.some(r => r.id === id && r.token === token)) return;
      await pause(1000);
    }
    throw new Error('Delivery timeout: ' + token);
  };
  let first, second;
  try {
    first = await B.scheduleAlarm({ id, itemId, title: 'Token 隔离验收 A', delayMs: 2000 });
    await delivered(first.trace);
    second = await B.scheduleAlarm({ id, itemId, title: 'Token 隔离验收 B', delayMs: 2000 });
    await delivered(second.trace);
    const oldStop = await B.stopAlarmDelivery({ id, token: first.trace });
    const afterOld = await B.activeAlarmDeliveries();
    const currentSurvives = (afterOld.alarms || []).some(r => r.id === id && r.token === second.trace);
    const currentStop = await B.stopAlarmDelivery({ id, token: second.trace });
    const afterStop = await B.activeAlarmDeliveries();
    return JSON.stringify({ first, second, oldStop, currentSurvives, currentStop,
      cleaned: !(afterStop.alarms || []).some(r => r.id === id),
      pass: oldStop.stopped === false && currentSurvives && currentStop.stopped === true && !(afterStop.alarms || []).some(r => r.id === id) });
  } finally {
    for (const r of (await B.activeAlarmDeliveries()).alarms || []) {
      if (r.id === id && r.itemId === itemId) await B.stopAlarmDelivery({ id, token: r.token });
    }
    await B.cancelAlarm({ id });
  }
})()
