#!/usr/bin/env python3
"""模拟器上的运行期复验探针（通过 WebView DevTools 协议直读应用内部）。

在真机运行环境里断言启动链真的跑完了 —— 即 Q1 缺陷的复验手段。

修复前：init() 在 app-core.js 的闹钟监听注册处抛
  TypeError: app.addListener(...).catch is not a function
→ ready() 兑现 false，其后的 seed / render / 15 秒心跳 / Service Worker 全部不执行。
修复后应全部为真。
"""
import json
import sys
import time

import websocket

# ① 先取证「真机契约到底是什么」——这是整个缺陷的根
CONTRACT = r"""
JSON.stringify((function () {
  var out = {};
  try { out.platform = Capacitor.getPlatform(); } catch (e) { out.platform = 'ERR:' + e.message; }
  try { out.plugins = Object.keys(Capacitor.Plugins || {}); } catch (e) { out.plugins = 'ERR'; }
  // 本项目没有打包器：WebView 里不存在官方 capacitor.js（那个会返回 Promise）
  try { out.hasPluginHeaders = Array.isArray(Capacitor.PluginHeaders); } catch (e) {}
  try {
    var app = (Capacitor.Plugins || {}).App;
    var r = app.addListener('appStateChange', function () {});
    out.appAddListener = {
      isPromise: !!(r && typeof r.then === 'function'),
      hasCatch: typeof (r && r.catch),
      hasRemove: typeof (r && r.remove),
      ctor: r && r.constructor ? r.constructor.name : String(r),
      keys: r && typeof r === 'object' ? Object.keys(r) : null
    };
    if (r && typeof r.remove === 'function') { try { r.remove(); } catch (e) {} }
  } catch (e) { out.appAddListener = 'THREW: ' + e.message; }
  try {
    var sb = (Capacitor.Plugins || {}).SystemBridge;
    out.systemBridge = sb ? Object.keys(sb) : null;
  } catch (e) { out.systemBridge = 'ERR'; }
  return out;
})())
"""

# ② 核心断言：启动链是否跑完
READY = r"""
new Promise(function (resolve) {
  var hook = (typeof window !== 'undefined' ? window : globalThis).__ATTENTION_INBOX__;
  if (!hook || typeof hook.ready !== 'function') return resolve(JSON.stringify({ error: 'no ready hook' }));
  var t0 = Date.now();
  Promise.resolve(hook.ready()).then(function (v) {
    resolve(JSON.stringify({ ready: v, ms: Date.now() - t0 }));
  }, function (e) {
    resolve(JSON.stringify({ ready: 'REJECTED', err: String(e) }));
  });
})
"""

# ③ 修复点之后才会发生的副作用（每一条都是「init 跑到底」的独立旁证）
SIDE_EFFECTS = r"""
new Promise(function (resolve) {
  var out = { sw: null, idb: null };
  var pending = 2;
  function done() { if (--pending === 0) resolve(JSON.stringify(out)); }
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (rs) {
        out.sw = { count: rs.length, scopes: rs.map(function (r) { return r.scope; }) };
        done();
      }).catch(function (e) { out.sw = 'ERR:' + e; done(); });
    } else { out.sw = 'unsupported'; done(); }
  } catch (e) { out.sw = 'ERR:' + e; done(); }
  try {
    var req = indexedDB.open('attention-inbox');
    req.onerror = function () { out.idb = 'open failed'; done(); };
    req.onsuccess = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains('kv')) { out.idb = 'no kv store'; return done(); }
      var g = db.transaction('kv', 'readonly').objectStore('kv').get('state');
      g.onerror = function () { out.idb = 'get failed'; done(); };
      g.onsuccess = function () {
        var v = g.result;
        if (!v) { out.idb = { stateValue: null }; return done(); }
        out.idb = {
          itemsCount: Array.isArray(v.items) ? v.items.length : null,
          projects: v.projects ? v.projects.length : null,
          settingsKeys: v.settings ? Object.keys(v.settings).length : null
        };
        done();
      };
    };
  } catch (e) { out.idb = 'ERR:' + e; done(); }
})
"""

# ④ 心跳装了没有：requestAnimationFrame 之外，用定时器密度间接判断不可靠，
#    改为直接看应用是否在「已就绪」后仍持续 tick —— 通过 alarmEventSeen 之类的入口不可得，
#    这里改测「渲染产物 + 交互」以确保界面是活的。
INTERACT = r"""
(function () {
  var out = { tabs: [], clicked: null, visibleAfter: null };
  var nodes = Array.from(document.querySelectorAll('button,[role="tab"],[role="button"],a,li,div,span'));
  var texts = {};
  nodes.forEach(function (n) {
    var t = (n.innerText || '').trim();
    if (t && t.length <= 6 && n.children.length <= 1) texts[t] = n;
  });
  out.tabs = Object.keys(texts).slice(0, 12);
  var target = texts['未来'];
  if (target) {
    var hit = target.closest('button,[role="tab"],[role="button"],a,li') || target;
    hit.click();
    out.clicked = '未来';
  }
  return JSON.stringify(out);
})()
"""


class Cdp:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=25, suppress_origin=True)
        self.seq = 300
        self.events = []

    def call(self, method, params=None):
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                return msg
            self.events.append(msg)

    def ev(self, expr):
        r = self.call("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True, "awaitPromise": True})
        res = r.get("result", {})
        if "exceptionDetails" in res:
            return "EVAL_EXCEPTION: " + str(res["exceptionDetails"].get("text"))
        return res.get("result", {}).get("value")

    def drain(self, sec):
        end = time.time() + sec
        while time.time() < end:
            self.ws.settimeout(max(0.3, end - time.time()))
            try:
                self.events.append(json.loads(self.ws.recv()))
            except Exception:
                break


def main():
    c = Cdp(sys.argv[1])
    c.call("Runtime.enable")
    c.call("Log.enable")
    c.drain(3)

    print("===== 1) 真机 addListener 返回契约（缺陷根因的现场证据）=====")
    print(c.ev(CONTRACT))
    print()

    print("===== 2) 核心断言：__ATTENTION_INBOX__.ready() =====")
    print(c.ev(READY))
    print()

    print("===== 3) 修复点之后才会发生的副作用 =====")
    print(c.ev(SIDE_EFFECTS))
    print()

    print("===== 4) 界面可交互 =====")
    print(c.ev(INTERACT))
    c.drain(2)
    print()

    print("===== 5) 全生命周期错误 / 警告 =====")
    errs, initfail = [], []
    for e in c.events:
        m = e.get("method")
        p = e.get("params", {})
        if m == "Runtime.exceptionThrown":
            d = p.get("exceptionDetails", {})
            errs.append("EXCEPTION: " + str(d.get("text")) + " | " +
                        str((d.get("exception") or {}).get("description", ""))[:170])
        elif m == "Log.entryAdded":
            en = p.get("entry", {})
            if en.get("level") in ("error", "warning"):
                errs.append("%s: %s" % (en.get("level").upper(), str(en.get("text"))[:190]))
        elif m == "Runtime.consoleAPICalled":
            vals = [str(a.get("value")) for a in p.get("args", []) if a.get("value") is not None]
            joined = " | ".join(vals)
            if "App init failed" in joined:
                initfail.append(joined[:200])
            if p.get("type") == "error":
                errs.append("CONSOLE.ERROR: " + joined[:200])
    print("App init failed 出现次数:", len(initfail))
    for x in initfail:
        print("  -", x)
    if errs:
        for x in errs[:15]:
            print(" -", x)
    else:
        print("(无异常、无错误级日志)")
    c.ws.close()


if __name__ == "__main__":
    main()
