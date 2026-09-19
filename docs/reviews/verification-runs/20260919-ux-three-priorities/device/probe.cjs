#!/usr/bin/env node
/*
 * UX 三项优先项 —— 真机（Android WebView）只读取证探针（零依赖）
 *
 * 只读：不点击、不创建事项、不触发提醒、不改任何设置。
 * 目的只有一个 —— 在**真实设备上**回答三件事：
 *   1. 设备跑的确实是本次候选（由外层 adb 拉包 sha256 证明）；
 *   2. 用户既有数据在覆盖安装后原样还在（不因本次改动丢/改）；
 *   3. 本次新增的两块纯逻辑模块与原生证据回流通路在 WebView 里真的可用
 *      （`lib/*.js` 曾经有过「写了但没被 index.html 加载」的先例，Web 层要断言，
 *        真机层也要断言，两边缺一不可）。
 *
 * 用法： node probe.cjs <outDir> [cdpPort]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const OUT = process.argv[2] || __dirname;
const PORT = Number(process.argv[3] || 9223);

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? "  \u2713 " : "  \u2717 ") + name + (detail === undefined ? "" : " \u2014 " + detail));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class Session {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.waiting = new Map();
    ws.addEventListener("message", ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Session(ws)));
      ws.addEventListener("error", () => reject(new Error("WebSocket 失败")));
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.waiting.has(id)) { this.waiting.delete(id); reject(new Error("CDP 超时 " + method)); } }, 20000);
    });
  }
  async evaluate(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async function(){ ${expr} })()`,
      awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) throw new Error("WebView 内异常：" + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const listRes = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await listRes.json();
  const pages = targets.filter(t => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pages.length) throw new Error("没有可用的 WebView page target：" + JSON.stringify(targets.map(t => t.type + " " + t.url)));
  const target = pages[0];
  console.log("WebView target: " + target.url);

  const s = await Session.connect(target.webSocketDebuggerUrl);
  await s.send("Runtime.enable");
  await sleep(500);

  const snap = await s.evaluate(`
    const app = window.__ATTENTION_INBOX__;
    if (!app) return { hook: false };
    await app.ready();
    const lib = window.AttentionLib || {};
    const items = (app.state.items || []);
    return {
      hook: true,
      userAgent: navigator.userAgent,
      url: location.href,
      origin: location.origin,
      capacitorNative: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
      pluginAvailable: !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBridge),
      libs: { feedback: !!lib.Feedback, evidence: !!lib.DeliveryEvidence, storage: !!lib.Storage, native: !!lib.NativeReminders },
      counts: { items: items.length, notes: (app.state.notes || []).length, projects: (app.state.projects || []).length },
      titles: items.map(x => x.title).slice(0, 40),
      statuses: items.map(x => x.status + "/" + (x.review_status || "-")).slice(0, 40),
      schema: app.state.schema,
      settingsKeys: Object.keys(app.state.settings || {}).sort(),
      notify: !!(app.state.settings && app.state.settings.notify),
      // 只读：不点击、不弹窗，只问判定层「现在会怎么说」
      homeNotice: (() => { try { return app.homeNoticeVerdict(); } catch (e) { return "ERR " + e.message; } })(),
      homeNoticeText: (document.querySelector("#homeNotice") || {}).textContent || "",
      evidenceReadableBefore: app.deliveryEvidenceReadable ? app.deliveryEvidenceReadable() : "n/a"
    };
  `);

  check("真机测试钩子存在且 ready 解析完成", snap.hook === true);
  check("运行在 Capacitor 原生容器内", snap.capacitorNative === true, "ua=" + String(snap.userAgent).slice(0, 80));
  check("SystemBridge 插件可解析", snap.pluginAvailable === true);
  check("本次新增的两块纯逻辑模块在 WebView 内已加载",
    snap.libs.feedback === true && snap.libs.evidence === true, JSON.stringify(snap.libs));
  check("用户既有数据仍在（覆盖安装未清空/未丢失）",
    snap.counts.items > 0 || snap.counts.notes > 0, JSON.stringify(snap.counts));
  console.log("    既有事项标题：" + JSON.stringify(snap.titles));

  // 原生送达证据通路（UX-T03 的原生半边）—— 只读调用，不写任何东西
  const ev = await s.evaluate(`
    const app = window.__ATTENTION_INBOX__;
    let res = null, err = null;
    try { res = await app.readDeliveryEvidence("device-probe"); } catch (e) { err = String(e && e.message || e); }
    const state = app.deliveryEvidenceState || null;
    const items = app.state.items || [];
    const withEvents = items.filter(x => x.reminderEvents && Object.keys(x.reminderEvents).length);
    const sample = withEvents[0] || items[0] || null;
    let row = "";
    try { row = sample ? app.detailReminderStatusRow(sample) : ""; } catch (e) { row = "ERR " + (e && e.message); }
    return { merged: res, err: err, readable: app.deliveryEvidenceReadable ? app.deliveryEvidenceReadable() : "n/a",
             state: state, evidenceItems: withEvents.length, sampleTitle: sample && sample.title, row: row };
  `);
  check("真机上读原生送达证据不抛异常", ev.err === null, ev.err || "ok");
  check("真机上证据通道报告可用（原生持久台账存在）", ev.readable === true,
    "readable=" + ev.readable + " state=" + JSON.stringify(ev.state));
  check("原生侧声明了保留策略（跨次日可关联的前提）",
    !!(ev.state && ev.state.retention), JSON.stringify(ev.state && ev.state.retention));
  check("详情「提醒结果」不指控漏提醒（红线）",
    typeof ev.row === "string" && !/漏|未送达|提醒失败/.test(ev.row),
    String(ev.row).replace(/<[^>]*>/g, " ").trim());

  fs.writeFileSync(path.join(OUT, "device-probe-results.json"), JSON.stringify({
    ranAt: new Date().toISOString(),
    cdpPort: PORT,
    webviewUrl: target.url,
    snapshot: snap,
    deliveryEvidence: ev,
    checks
  }, null, 2));

  const pass = checks.filter(c => c.pass).length;
  console.log(`\n==== 真机只读探针：通过 ${pass} / 失败 ${checks.length - pass} ====`);
  if (checks.some(c => !c.pass)) process.exitCode = 2;
  try { s.ws.close(); } catch (e) {}
}

main().catch(err => { console.error(err && err.stack ? err.stack : err); process.exit(1); });
