import subprocess, json, sys, time, importlib.util, xml.etree.ElementTree as ET, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ADB = [str(Path.home() / 'Library/Android/sdk/platform-tools/adb'), '-s', 'QSKFAE95CQEUJZ8L']
PKG = 'space.alliswell.inbox'

def cmd(*args):
    return subprocess.check_output(ADB + list(args), timeout=40)

def save(name, data):
    (ROOT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2))

def ev(js):
    pid = cmd('shell', 'pidof', PKG).decode().split()[0]
    port = cmd('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid).decode().strip()
    try:
        s = importlib.util.spec_from_file_location('dv', str(Path.cwd() / 'scripts/device-verify.py'))
        m = importlib.util.module_from_spec(s)
        s.loader.exec_module(m)
        c = m.Cdp(int(port))
        try:
            return c.evaluate(js)
        finally:
            c.close()
    finally:
        cmd('forward', '--remove', 'tcp:' + port)

def ui(label):
    cmd('shell', 'uiautomator', 'dump', '/sdcard/Download/reminder-verification-ui.xml')
    raw = cmd('exec-out', 'cat', '/sdcard/Download/reminder-verification-ui.xml')
    (ROOT / (label + '.xml')).write_bytes(raw)
    (ROOT / (label + '.png')).write_bytes(cmd('exec-out', 'screencap', '-p'))
    return [{'text': n.get('text'), 'id': n.get('resource-id'), 'bounds': n.get('bounds'), 'desc': n.get('content-desc')} for n in ET.fromstring(raw).iter('node') if n.get('text') or n.get('content-desc')]

if __name__ == '__main__':
    if sys.argv[1] == 'ui':
        print(json.dumps(ui(sys.argv[2]), ensure_ascii=False))
    elif sys.argv[1] == 'eval':
        print(json.dumps(ev(sys.argv[2]), ensure_ascii=False))
