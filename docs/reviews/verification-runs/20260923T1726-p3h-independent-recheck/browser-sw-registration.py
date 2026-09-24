#!/usr/bin/env python3
"""Independent real-Chrome service-worker registration check for P3-H."""
import functools
import http.server
import json
import pathlib
import subprocess
import tempfile
import threading
import time
import urllib.request
import websocket

ROOT = pathlib.Path('/Users/qlyf/Developer/reminder')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

with tempfile.TemporaryDirectory(prefix='p3h-sw-') as profile:
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    chrome = subprocess.Popen([CHROME, '--headless=new', '--no-first-run',
        '--no-proxy-server', '--remote-allow-origins=*',
        f'--user-data-dir={profile}', '--remote-debugging-port=18999', 'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    socket = None
    try:
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen('http://127.0.0.1:18999/json', timeout=1))
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError('Chrome CDP unavailable')
        page = next(t for t in tabs if t.get('type') == 'page')
        socket = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=15)
        request_id = 0
        def evaluate(expression):
            global request_id
            request_id += 1
            socket.send(json.dumps({'id': request_id, 'method': 'Runtime.evaluate',
                'params': {'expression': expression, 'awaitPromise': True, 'returnByValue': True}}))
            while True:
                response = json.loads(socket.recv())
                if response.get('id') == request_id:
                    if 'exceptionDetails' in response.get('result', {}):
                        raise RuntimeError(json.dumps(response['result']['exceptionDetails']))
                    return response.get('result', {}).get('result', {}).get('value')
        evaluate(f"location.href='http://127.0.0.1:{port}/index.html';true")
        time.sleep(1.5)
        result = evaluate("""(async () => {
          const app = window.__ATTENTION_INBOX__;
          if (!app || !(await app.ready())) return {ready:false};
          const sw = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise(resolve => setTimeout(() => resolve(null), 7000))
          ]);
          const reg = await navigator.serviceWorker.getRegistration();
          const platformReg = app.platform.getSwRegistration();
          const names = await caches.keys();
          const hit = await caches.match('./lib/app-platform.js');
          return {ready:true, registered:!!reg, platformRegMatches:platformReg===reg,
            active:!!(sw && sw.active), cacheNames:names, platformCached:!!hit};
        })()""")
        print(json.dumps(result, ensure_ascii=False))
        assert result['ready'] and result['registered'] and result['platformRegMatches']
        assert result['active'] and result['platformCached']
        assert 'attention-inbox-v35' in result['cacheNames']
    finally:
        if socket:
            socket.close()
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except subprocess.TimeoutExpired:
            chrome.kill()
        server.shutdown()
