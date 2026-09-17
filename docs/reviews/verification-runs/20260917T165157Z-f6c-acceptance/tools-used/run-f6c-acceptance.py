#!/usr/bin/env python3
"""Run screen-off, process-death and 30-minute screen-off trials on a verified F6c.
Requires explicit device-test authorization. Preserves existing items; archives test item.
Usage: python3 scripts/verification/run-f6c-acceptance.py EVIDENCE_ROOT --serial SERIAL
EVIDENCE_ROOT must contain metadata.json and state-before.json from preflight.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('evidence', type=Path)
parser.add_argument('--serial', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
run = args.evidence.resolve()
meta = json.loads((run / 'metadata.json').read_text())
assert meta['serial'] == args.serial
before = json.loads((run / 'state-before.json').read_text())
adb = [str(Path.home() / 'Library/Android/sdk/platform-tools/adb'), '-s', args.serial]
pkg = 'space.alliswell.inbox'
item_id = 'f6c_' + run.name.split('-')[0].lower()


def command(parts):
    return subprocess.check_output(adb + parts, timeout=40)


def cdp(js):
    pid = command(['shell', 'pidof', pkg]).decode().strip().split()[0]
    port = command(['forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid]).decode().strip()
    try:
        return subprocess.check_output(['/usr/bin/python3', str(root / 'scripts/android-cdp-eval.py'), js, port], text=True, timeout=80)
    finally:
        subprocess.run(adb + ['forward', '--remove', 'tcp:' + port], capture_output=True, timeout=10)


def app_foreground():
    command(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
    command(['shell', 'wm', 'dismiss-keyguard'])
    command(['shell', 'am', 'start', '-W', '-n', pkg + '/.MainActivity'])
    time.sleep(2)


def compare_items(state):
    after = {item['id']: item for item in state['items']}
    return [item['id'] for item in before['items'] if after.get(item['id']) != item]


def archive_test(folder):
    # Only after evidence capture: close a visible test alarm using its Done button.
    command(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
    command(['shell', 'uiautomator', 'dump', '/sdcard/f6c-acceptance-window.xml'])
    xml = command(['exec-out', 'cat', '/sdcard/f6c-acceptance-window.xml'])
    (folder / 'cleanup-ui.xml').write_bytes(xml)
    tree = ET.fromstring(xml)
    if any(n.get('text') == 'F6c 验收专用（测试）' for n in tree.iter('node')):
        done = next((n for n in tree.iter('node') if n.get('resource-id') == pkg + ':id/btnDone'), None)
        if done is not None:
            x1, y1, x2, y2 = map(int, re.findall(r'\d+', done.get('bounds')))
            command(['shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2)])
    app_foreground()
    js = '''(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();const it=A.state.items.find(x=>x.id===ID);if(!it)throw Error('missing test item');if(!['archived','completed'].includes(it.status)){await A.completeItem(ID);await A.saveAsync();}await new Promise(r=>setTimeout(r,3000));return JSON.stringify({items:A.state.items,notify:A.state.settings.notify,scheduled:A.state.settings.scheduledAlarmIds})})()'''.replace('ID', json.dumps(item_id))
    state = json.loads(cdp(js))
    (folder / 'state-after.json').write_text(json.dumps(state, ensure_ascii=False, indent=2)+'\n')
    differences = compare_items(state)
    test = next(x for x in state['items'] if x['id'] == item_id)
    schedules = command(['shell', 'run-as', pkg, 'cat', 'shared_prefs/attention_alarm_schedules.xml'])
    (folder / 'schedules-after.xml').write_bytes(schedules)
    result = {'existingItemDifferences': differences, 'testStatus': test['status'], 'testStillScheduled': item_id in schedules.decode(), 'notifyUnchanged': state['notify'] == before['notify']}
    (folder / 'cleanup.json').write_text(json.dumps(result, indent=2)+'\n')
    assert not differences and test['status'] == 'archived' and not result['testStillScheduled'] and result['notifyUnchanged'], result


def summarize(folder, label, cold):
    events = json.loads(ET.parse(folder/'deadline-trace.xml').find("string[@name='events']").text)
    # Use pre-trial source to identify the current token, even if bounded trace rotates.
    baseline = json.loads(ET.parse(folder/(label+'-trace-before.xml')).find("string[@name='events']").text)
    token = [e['token'] for e in baseline if e['stage']=='item' and e['detail']==item_id][-1]
    rows = [e for e in events if e['token']==token]
    scheduled = next(e for e in baseline if e['token']==token and e['stage']=='scheduled')
    target = int(re.search(r'triggerAt=(\d+)', scheduled['detail']).group(1))
    received = next((e['at'] for e in rows if e['stage']=='received'), None)
    visible = next((e['at'] for e in rows if e['stage']=='windowVisible'), None)
    notification = (folder/'deadline-notification.txt').read_text()
    active = bool(re.search(r'^\s*NotificationRecord\([^\n]*pkg=space\.alliswell\.inbox[^\n]* id='+token.split(':')[0]+r'\b', notification, re.M))
    framework = (folder/(label+'-events.txt')).read_text().splitlines()
    starts = [l for l in framework if 'am_proc_start' in l and pkg in l]
    freeze = [l for l in framework if 'am_app_frozen' in l and pkg in l]
    log = (folder/(label+'.log')).read_text()
    capture = json.loads((folder/'deadline-capture.json').read_text())
    captured_ok = all(r['returncode']==0 and r['bytes']>0 for r in capture['captures'])
    conditions = {'captureValid': captured_ok, 'receivedWithin10s': received is not None and 0<=received-target<=10000, 'visibleWithin10s': visible is not None and 0<=visible-target<=10000, 'notificationRecord': active, 'asleepBeforeAlarm': 'Asleep' in log, 'processDiedBeforeAlarm': not cold or ('kill 后进程: []' in log and 'stopped=false' in log), 'systemStartedProcess': not cold or bool(starts)}
    result = {'itemId': item_id, 'token': token, 'targetAt': target, 'receivedLagMs': None if received is None else received-target, 'visibleLagMs': None if visible is None else visible-target, 'machineCriteria': conditions, 'machineCriteriaPass': all(conditions.values()), 'screenshotReview': 'PENDING', 'processStarts': starts, 'freezes': freeze, 'events': rows}
    (folder/'summary.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    return result


apk = command(['shell', 'pm', 'path', pkg]).decode().strip().removeprefix('package:')
assert command(['shell', 'sha256sum', apk]).decode().split()[0] == meta['candidateSha256']
app_foreground()
js = '''(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();if(A.state.items.some(x=>x.id===ID))throw Error('test already exists');const it=A.makeItem({id:ID,title:'F6c 验收专用（测试）',note:'自动验收专用；完成后归档',priority:'important',status:'archived',triggerAt:Date.now()+3600000,isFallbackTrigger:false,repeat:null});A.state.items.push(it);await A.saveAsync();return JSON.stringify(it)})()'''.replace('ID', json.dumps(item_id))
(run/'test-item.json').write_text(cdp(js))
print('Test item created:', item_id, flush=True)
trials = [('screenoff',75,False),('cold',75,True),('standby30m',1830,False)]
for label, lead, cold in trials:
    folder=run/label
    assert not folder.exists(), 'Refusing overwrite'
    env=dict(os.environ,SERIAL=args.serial,ITEM_ID=item_id,LABEL=label,LEAD=str(lead),SCREEN='off',RUN=str(folder))
    script='vivo-selfkill-trial.sh' if cold else 'vivo-alarm-screenoff-trial.sh'
    print('START',label,datetime.now(timezone.utc).isoformat(),flush=True)
    out=(run/(label+'-runner.log')).open('xb')
    test=subprocess.Popen(['bash',str(root/'scripts/verification'/script)],env=env,stdout=out,stderr=subprocess.STDOUT)
    capout=(run/(label+'-capture.log')).open('xb')
    capture=subprocess.Popen(['/usr/bin/python3',str(root/'scripts/verification/capture-alarm-deadline.py'),str(folder),label,'--serial',args.serial],stdout=capout,stderr=subprocess.STDOUT)
    next_sample=time.monotonic()+40
    try:
        while test.poll() is None:
            time.sleep(2)
            if time.monotonic()>=next_sample:
                name='power-'+str(int(time.time()))+'.txt'
                (folder/name).write_bytes(command(['shell','dumpsys','power']))
                next_sample=time.monotonic()+60
        rc=capture.wait(timeout=40)
        if test.returncode or rc:raise RuntimeError(f'{label} collection failed: test={test.returncode},capture={rc}')
        result=summarize(folder,label,cold)
        print('RESULT',label,json.dumps({k:v for k,v in result.items() if k not in ['events','processStarts','freezes']},ensure_ascii=False),flush=True)
        archive_test(folder)
        print('CLEANUP',label,'original items unchanged, test archived',flush=True)
        if not result['machineCriteriaPass']:
            raise RuntimeError('Acceptance failed; stop dependent scenarios for investigation')
    finally:
        for proc in [test,capture]:
            if proc.poll() is None:proc.terminate()
        out.close();capout.close()

command(['shell','input','keyevent','KEYCODE_HOME'])
command(['shell','input','keyevent','KEYCODE_SLEEP'])
(run/'runner-complete.json').write_text(json.dumps({'completedUtc':datetime.now(timezone.utc).isoformat(),'itemId':item_id,'machineCriteriaPass':True,'screenshotReview':'PENDING'},indent=2)+'\n')
print('COMPLETE all machine criteria; screenshots require review',flush=True)
