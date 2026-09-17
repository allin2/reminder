#!/usr/bin/env python3
"""Read-only ADB snapshot after a trial's target time; never wakes the screen.

Usage: python3 capture-alarm-deadline.py RUN LABEL --serial SERIAL
Start alongside vivo-alarm-screenoff-trial.sh. Output uses deadline-* names.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('run', type=Path)
parser.add_argument('label')
parser.add_argument('--serial', required=True)
parser.add_argument('--after-seconds', type=int, default=8)
args = parser.parse_args()
adb = [os.environ.get('ADB_BIN', str(Path.home() / 'Library/Android/sdk/platform-tools/adb')), '-s', args.serial]
log = args.run / (args.label + '.log')
limit = time.monotonic() + 90
while True:
    content = log.read_text() if log.exists() else ''
    match = re.search(r'设置结果: (.*)', content)
    if match:
        target = json.loads(match.group(1))['triggerAt']
        break
    if time.monotonic() > limit:
        raise SystemExit('No target time in trial log within 90 seconds')
    time.sleep(1)
delay = max(0, (target + args.after_seconds * 1000) / 1000 - time.time())
print('Snapshot in %.1f seconds' % delay, flush=True)
time.sleep(delay)
commands = {
    'deadline-screen.png': ['exec-out', 'screencap', '-p'],
    'deadline-window.txt': ['shell', 'dumpsys', 'window'],
    'deadline-notification.txt': ['shell', 'dumpsys', 'notification', '--noredact'],
    'deadline-trace.xml': ['shell', 'run-as', 'space.alliswell.inbox', 'cat', 'shared_prefs/alarm_trace.xml'],
    'deadline-delivery.xml': ['shell', 'run-as', 'space.alliswell.inbox', 'cat', 'shared_prefs/attention_alarm.xml'],
}
# Refuse reuse before collecting anything.
if any((args.run / name).exists() for name in commands) or (args.run / 'deadline-capture.json').exists():
    raise SystemExit('Deadline evidence already exists; refusing overwrite')
records = []
for name, command in commands.items():
    started = int(time.time() * 1000)
    result = subprocess.run(adb + command, capture_output=True, timeout=30)
    (args.run / name).write_bytes(result.stdout)
    records.append({'file': name, 'startedAt': started, 'returncode': result.returncode, 'bytes': len(result.stdout), 'stderr': result.stderr.decode(errors='replace')})
    print(name, result.returncode, len(result.stdout), flush=True)
(args.run / 'deadline-capture.json').write_text(json.dumps({'serial': args.serial, 'targetAt': target, 'afterSeconds': args.after_seconds, 'captures': records}, indent=2) + '\n')
if any(r['returncode'] or not r['bytes'] for r in records):
    raise SystemExit('Incomplete capture; inspect deadline-capture.json')
