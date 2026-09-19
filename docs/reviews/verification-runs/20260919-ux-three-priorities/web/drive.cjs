#!/usr/bin/env node
/*
 * UX 三项优先项 —— Web 运行层取证驱动器（零依赖）
 *
 * 为什么不用现成框架：本机没有 puppeteer/playwright 的浏览器，装一套要数百 MB
 * 且会拉一个与 agent-browser 不匹配的 Chromium 版本。Chrome 已经在本机，
 * 而 Node 22 自带 fetch 与 WebSocket —— 直接用 CDP 就够了。
 *
 * 用法： node drive.cjs <outDir>
 * 产出： 每个场景一张 PNG + 一份 results.json（含每条断言的**实测值**）
 *
 * 三条纪律（都是被咬过的）：
 *  1. 面板是否打开要看 `.sheet` 自己的 `open` 类 —— `show` 类挂在 `#backdrop` 上，
 *     看错类名会把「已打开」读成「没打开」。
 *  2. 「派发 input 事件」与「读解析结果」必须是两次 evaluate —— 解析有 120 ms 去抖，
 *     同一次 evaluate 里读到的永远是上一帧的空值。
 *  3. 断言要认**当前运行环境**的合同：Web 上正确的结论与 Android 上不同
 *     （UX-T02：Web 不得显示 Android 才有的就绪结论），不能拿 Android 的期望去判 Web。
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const REPO = path.resolve(__dirname, "../../../../..");
const HTTP_PORT = 8899;
const CDP_PORT = 9333;
const OUT = process.argv[2] || __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? "  \u2713 " : "  \u2717 ") + name + (detail === undefined ? "" : " \u2014 " + detail));
}

/* --------------------------- 静态服务器 --------------------------- */
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const full = path.join(REPO, rel);
    if (!full.startsWith(REPO) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(r => server.listen(HTTP_PORT, "127.0.0.1", () => r(server)));
}

/* --------------------------- CDP 客户端 --------------------------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function launchChrome() {
  const dir = fs.mkdtempSync("/tmp/ux-chrome-");
  const proc = spawn(CHROME, [
    "--headless=new",
    // 本机沙箱不允许 Chrome 建立它自己的沙箱：不带 --no-sandbox 时
    // 表现为「GPU process isn't usable. Goodbye.」+ CDP 握手超时，
    // 而不是任何一条能看懂的权限报错。
    "--no-sandbox", "--disable-setuid-sandbox",
    "--remote-debugging-port=" + CDP_PORT,
    "--user-data-dir=" + dir,
    "--no-first-run", "--no-default-browser-check",
    "--disable-gpu", "--disable-software-rasterizer",
    "--hide-scrollbars", "--mute-audio",
    "--window-size=430,932",
    "about:blank"
  ], { stdio: "ignore", detached: false });

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) return { proc, dir };
    } catch (e) {}
    await sleep(250);
  }
  throw new Error("Chrome 调试端口没起来");
}

async function newTarget(url) {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!r.ok) throw new Error("建标签页失败 " + r.status);
  return r.json();
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    this.events = new Map();
    ws.addEventListener("message", ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        const list = this.events.get(msg.method) || [];
        list.forEach(fn => fn(msg.params));
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Session(ws)));
      ws.addEventListener("error", e => reject(new Error("WebSocket 失败")));
    });
  }
  on(method, fn) {
    const list = this.events.get(method) || [];
    list.push(fn);
    this.events.set(method, list);
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
      // 必须包成 async function：有场景要 `await app.ready()`，
      // 而非 async 的函数体里写 await 会直接是语法错误。
      expression: `(async function(){ ${expr} })()`,
      awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) throw new Error("页面内异常：" + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
  /** 派发 + 等去抖落定，再读。返回**读到的这一帧**。 */
  async evalSettle(dispatchExpr, readExpr, settleMs) {
    await this.evaluate(dispatchExpr);
    await sleep(settleMs || 350);
    return this.evaluate(readExpr);
  }
  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.data, "base64"));
  }
  async reload() {
    await this.send("Page.reload", { ignoreCache: true });
    await sleep(1400);
  }
  async setWidth(w, h) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: w, height: h || 932, deviceScaleFactor: 2, mobile: true
    });
    await sleep(250);
  }
}

/* --------------------------- 场景 --------------------------- */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const chrome = await launchChrome();
  let session;
  try {
    const target = await newTarget(`http://127.0.0.1:${HTTP_PORT}/index.html`);
    session = await Session.connect(target.webSocketDebuggerUrl);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await session.send("Console.enable").catch(() => {});
    const consoleErrors = [];
    session.on("Runtime.consoleAPICalled", p => {
      if (p.type === "error") consoleErrors.push((p.args || []).map(a => a.value || a.description || "").join(" "));
    });
    session.on("Runtime.exceptionThrown", p => {
      consoleErrors.push("EXCEPTION " + (p.exceptionDetails && p.exceptionDetails.text));
    });

    await sleep(1800); // 首启
    const boot = await session.evaluate(`
      const app = window.__ATTENTION_INBOX__;
      if (!app) return { hook: false };
      await app.ready();
      return { hook: true, libs: { feedback: !!(window.AttentionLib && window.AttentionLib.Feedback),
                                   evidence: !!(window.AttentionLib && window.AttentionLib.DeliveryEvidence) },
               native: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) };
    `);
    check("V00 测试钩子与新增纯逻辑模块已加载", boot.hook === true && boot.libs.feedback === true && boot.libs.evidence === true,
      JSON.stringify(boot));
    check("V00 运行环境是 Web（非原生）", boot.native === false, "native=" + boot.native);

    /* ---------------- V01 干净首启 ---------------- */
    const v01 = await session.evaluate(`
      const app = window.__ATTENTION_INBOX__;
      const q = s => document.querySelector(s);
      const open = s => !!(q(s) && q(s).classList.contains("open"));
      return {
        items: app.state.items.length,
        notes: (app.state.notes || []).length,
        demoSheetOpen: open("#sheetDemo"),
        itemSheetOpen: open("#sheetItem"),
        backdropShown: !!(q("#backdrop") && q("#backdrop").classList.contains("show")),
        homeEmptyHtml: q("#homeEmpty").innerHTML,
        homeStartText: q("#homeStart").textContent.trim(),
        lsKeys: Object.keys(localStorage)
      };
    `);
    check("V01 干净首启不写入任何事项", v01.items === 0 && v01.notes === 0, "items=" + v01.items + " notes=" + v01.notes);
    check("V01 首启不自动弹演示（sheetDemo 未打开）", v01.demoSheetOpen === false);
    check("V01 首启不自动弹录入面板", v01.itemSheetOpen === false);
    check("V01 首启不弹遮罩", v01.backdropShown === false);
    check("V01 空首页有用途说明 + 输入示例", /把要记的事丢进来/.test(v01.homeEmptyHtml) && /明天下午3点提醒我取快递/.test(v01.homeEmptyHtml));
    check("V01 空态容器里没有按钮（D8：完成数是纯文字）", !/<button/.test(v01.homeEmptyHtml) && !/data-act/.test(v01.homeEmptyHtml));
    check("V01 空首页有「记一件事」主动入口", /记一件事/.test(v01.homeStartText), v01.homeStartText);
    await session.shot("V01-clean-first-launch");

    /* ---------------- V01b 演示只读 ---------------- */
    const v01b = await session.evalSettle(
      `document.querySelector("#emptyDemo").click(); return true;`,
      `
        const app = window.__ATTENTION_INBOX__;
        const q = s => document.querySelector(s);
        return {
          demoOpen: !!(q("#sheetDemo") && q("#sheetDemo").classList.contains("open")),
          rows: document.querySelectorAll("#demoBody .demo-item").length,
          bodyText: q("#demoBody").textContent.trim(),
          items: app.state.items.length,
          notes: (app.state.notes || []).length,
          projects: (app.state.projects || []).length,
          hasWriteHint: /只读预览/.test(q("#demoBody").textContent)
        };
      `, 400);
    await session.shot("V01b-demo-preview");
    check("V01b 演示是主动入口且打开面板", v01b.demoOpen === true);
    check("V01b 演示有内容", v01b.rows >= 3, "rows=" + v01b.rows);
    check("V01b 演示零写入（items 仍为 0）", v01b.items === 0, "items=" + v01b.items);
    check("V01b 演示明确写出「只读预览」", v01b.hasWriteHint === true);
    check("V01b 演示文本只渲染在面板里，没进用户数据", v01b.bodyText.length > 50 && v01b.items === 0 && v01b.notes === 0);

    // 走真实关闭路径（面板自己的「知道了」），顺便验证 data-close 接线
    await session.evalSettle(
      `document.querySelector('#sheetDemo [data-close]').click(); return true;`,
      `const q = s => document.querySelector(s);
       return { demoOpen: !!(q("#sheetDemo") && q("#sheetDemo").classList.contains("open")),
                backdropShown: !!(q("#backdrop") && q("#backdrop").classList.contains("show")) };`,
      300);
    const v01c = await session.evaluate(`
      const q = s => document.querySelector(s);
      return { demoOpen: !!(q("#sheetDemo") && q("#sheetDemo").classList.contains("open")),
               backdropShown: !!(q("#backdrop") && q("#backdrop").classList.contains("show")) };
    `);
    check("V01b 演示面板可正常关闭", v01c.demoOpen === false && v01c.backdropShown === false, JSON.stringify(v01c));

    /* ---------------- V02 中文录入（空态入口） ---------------- */
    const v02 = await session.evalSettle(
      `document.querySelector("#emptyCapture").click(); return true;`,
      `const q = s => document.querySelector(s);
       return { open: !!(q("#sheetItem") && q("#sheetItem").classList.contains("open")),
                advancedHidden: q("#capAdvanced").hidden,
                saveLabel: q("#btnSaveItem").textContent.trim() };`,
      350);
    check("V02 空首页「记一件事」打开录入面板（UX-C01/T02 短路径）", v02.open === true);
    check("V02 默认表单简洁（更多选项收起）", v02.advancedHidden === true);

    const v02summary = await session.evalSettle(
      `const t = document.querySelector("#capText");
       t.value = "明天下午3点提醒我取快递";
       t.dispatchEvent(new Event("input", { bubbles: true }));
       return true;`,
      `const q = s => document.querySelector(s);
       return { summary: q("#capSummary").textContent.trim(),
                hint: q("#capHint").textContent.trim(),
                triggerField: q("#capTrigger").value };`,
      450);
    await session.shot("V02a-capture-typed");
    check("V02 解析摘要给出具体提醒时间", /提醒/.test(v02summary.summary) && /15:00/.test(v02summary.summary), v02summary.summary);
    check("V02 摘要显示的是有效提醒时间（与提示一致）", /已设置/.test(v02summary.hint) && /15:00/.test(v02summary.hint), v02summary.hint);

    await session.evaluate(`document.querySelector("#btnSaveItem").click(); return true;`);
    await sleep(1600);
    const v02c = await session.evaluate(`
      const app = window.__ATTENTION_INBOX__;
      const q = s => document.querySelector(s);
      const it = app.state.items[0] || null;
      return {
        count: app.state.items.length,
        title: it && it.title,
        triggerAt: it && it.triggerAt,
        hasTrigger: !!(it && it.triggerAt),
        isFallbackTrigger: !!(it && it.isFallbackTrigger),
        reviewStatus: it && it.review_status,
        toast: q("#toastText").textContent,
        toastVisible: q("#toast").classList.contains("show"),
        toastAction: q("#toastAction").hidden ? "" : q("#toastAction").textContent,
        toastAction2: q("#toastAction2").hidden ? "" : q("#toastAction2").textContent,
        sheetOpen: q("#sheetItem").classList.contains("open"),
        editorValue: q("#capText").value
      };
    `);
    await session.shot("V02b-saved");
    check("V02 保存后确实落了一条", v02c.count === 1, "count=" + v02c.count);
    check("V02 标题只留内容主体「取快递」（时间词移进结构化字段，不是丢掉）",
      v02c.title === "取快递" && v02c.hasTrigger === true, v02c.title + " / triggerAt=" + v02c.triggerAt);
    check("V02 解析出明确提醒时间", v02c.hasTrigger === true && v02c.isFallbackTrigger === false, "triggerAt=" + v02c.triggerAt);
    check("V02 保存后给出反馈", v02c.toast.length > 0 && v02c.toastVisible === true, v02c.toast);
    check("V02 Web 上按 Web 结论反馈（不冒充 Android 就绪）",
      /本页关闭后不会有提醒/.test(v02c.toast) && !/已安排闹钟|闹钟已排|计划.*提醒/.test(v02c.toast),
      v02c.toast + " / " + v02c.toastAction);
    check("V02 Web 结论带可理解的入口（了解），不给 Android 才有的「查看状态」", v02c.toastAction === "了解", v02c.toastAction);
    check("V02 新建给出有限撤销入口", v02c.toastAction2 === "撤销", v02c.toastAction2);
    check("V02 保存后录入面板关闭且草稿清空", v02c.sheetOpen === false && v02c.editorValue === "", JSON.stringify({ open: v02c.sheetOpen, v: v02c.editorValue }));

    // 持久化核查：重开页面
    await session.reload();
    const v02d = await session.evaluate(`
      const app = window.__ATTENTION_INBOX__;
      await app.ready();
      return { count: app.state.items.length, title: app.state.items[0] && app.state.items[0].title };
    `);
    check("V02 重开后数据仍在（真落库，不是只改了内存）", v02d.count === 1 && v02d.title === v02c.title, "count=" + v02d.count);

    /* ---------------- V03 无时间 ---------------- */
    const v03 = await session.evalSettle(
      `document.querySelector("#fab").click(); return true;`,
      `const q = s => document.querySelector(s);
       return { open: !!(q("#sheetItem") && q("#sheetItem").classList.contains("open")),
                advancedHidden: q("#capAdvanced").hidden };`,
      350);
    check("V03 常驻入口 #fab 可打开录入面板", v03.open === true);
    check("V03 无时间场景默认表单同样简洁", v03.advancedHidden === true);

    const v03summary = await session.evalSettle(
      `const t = document.querySelector("#capText");
       t.value = "有空看看这个项目";
       t.dispatchEvent(new Event("input", { bubbles: true }));
       return true;`,
      `const q = s => document.querySelector(s);
       return { summary: q("#capSummary").textContent.trim(),
                hint: q("#capHint").textContent.trim(),
                triggerField: q("#capTrigger").value };`,
      450);
    await session.shot("V03a-no-time-summary");
    check("V03 低置信度提示如实说「未识别精确时间」", /未识别|先收下/.test(v03summary.hint), v03summary.hint);
    // 这条曾经是红的：提示说「未识别精确时间」，摘要却显示「提醒 9月26日 10:00」、
    // 时间框里也躺着一个具体日期 —— 三处同时自相矛盾。根因是解析器拍的 +7 天被写回了表单。
    const v03contradiction = /提醒/.test(v03summary.summary) && /未识别/.test(v03summary.hint);
    check("V03 摘要不与提示自相矛盾（提示未识别时摘要不显示提醒时间）", v03contradiction === false,
      JSON.stringify(v03summary));
    check("V03 低置信度不把兜底时间预填进时间框", v03summary.triggerField === "",
      "triggerField=" + JSON.stringify(v03summary.triggerField));
    check("V03 摘要如实说明「还没有时间 · 先记下」", /还没有时间|先记下/.test(v03summary.summary), v03summary.summary);

    await session.evaluate(`document.querySelector("#btnSaveItem").click(); return true;`);
    await sleep(1600);
    const v03c = await session.evaluate(`
      const app = window.__ATTENTION_INBOX__;
      const q = s => document.querySelector(s);
      const it = app.state.items.find(x => x.title === "有空看看这个项目");
      return { added: !!it, reviewStatus: it && it.review_status, isFallbackTrigger: !!(it && it.isFallbackTrigger),
               toast: q("#toastText").textContent,
               toastAction: q("#toastAction").hidden ? "" : q("#toastAction").textContent,
               homeEmpty: q("#homeEmpty").textContent.trim(), homeStart: q("#homeStart").textContent.trim() };
    `);
    await session.shot("V03b-no-time-saved");
    check("V03 无时间记录被收下（不被拒绝）", v03c.added === true);
    check("V03 无时间记录进待整理", v03c.reviewStatus === "NEEDS_REVIEW", String(v03c.reviewStatus));
    check("V03 兜底时间被标记为兜底（不当成事项承诺）", v03c.isFallbackTrigger === true, "isFallback=" + v03c.isFallbackTrigger);
    check("V03 保存反馈不承诺已安排提醒", !/计划.*提醒|已安排/.test(v03c.toast), v03c.toast + " / " + v03c.toastAction);
    check("V03 有待整理时不误说「把要记的事丢进来」", !/把要记的事丢进来/.test(v03c.homeEmpty) || /待整理/.test(v03c.homeEmpty), v03c.homeEmpty);

    /* ---------------- V04 elapsed / 更多选项 ---------------- */
    const v04 = await session.evalSettle(
      `document.querySelector("#fab").click();
       const t = document.querySelector("#capText");
       t.value = "三分钟以后提醒我";
       t.dispatchEvent(new Event("input", { bubbles: true }));
       return true;`,
      `const q = s => document.querySelector(s);
       return { summary: q("#capSummary").textContent.trim(), hint: q("#capHint").textContent.trim() };`,
      400);
    const v04c = await session.evaluate(`
      const app = window.__ATTENTION_INBOX__;
      const before = Date.now();
      document.querySelector("#btnSaveItem").click();
      return { before: before };
    `);
    await sleep(1600);
    const v04s = await session.evaluate(`
      const app = window.__ATTENTION_INBOX__;
      const it = app.state.items.find(x => x.title === "三分钟以后提醒我");
      return { found: !!it, triggerAt: it && it.triggerAt, now: Date.now() };
    `);
    check("V04 elapsed 记录被收下", v04s.found === true, v04s.found ? "triggerAt=" + v04s.triggerAt : "未找到");
    if (v04s.found) {
      const delta = v04s.triggerAt - v04c.before;
      check("V04 elapsed 落在 3 分钟附近（不漂移）", Math.abs(delta - 180000) < 15000, "delta=" + delta + " ms");
    }
    // 更多选项：走真实的卡片「修改」入口
    // 注意：首页只有「需要注意 / 已看到未完成」两种卡片，未来事项在「未来」页
    // （D5 已把首页「即将到来」删掉）—— 所以必须先切到未来页，否则选择器一个都命中不了。
    const v04d = await session.evalSettle(
      `const nav = document.querySelector('.nav-item[data-tab="future"]');
       if (nav) nav.click();
       return true;`,
      `const q = s => document.querySelector(s);
       const card = q('#futureList [data-act="edit"]');
       return { cardFound: !!card, listRows: document.querySelectorAll("#futureList .card").length };`,
      450);
    check("V04 未来页能列出待办事项", v04d.listRows >= 2, "rows=" + v04d.listRows);

    const v04e = await session.evalSettle(
      `const card = document.querySelector('#futureList [data-act="edit"]');
       if (card) card.click();
       return true;`,
      `const q = s => document.querySelector(s);
       return { opened: !!(q("#sheetItem") && q("#sheetItem").classList.contains("open")),
                advancedHidden: q("#capAdvanced").hidden,
                text: q("#capText").value };`,
      400);
    check("V04 卡片「修改」打开编辑面板", v04e.opened === true);
    check("V04 简单事项编辑时高级字段默认收起", v04e.advancedHidden === true, "text=" + v04e.text);

    const v04f = await session.evalSettle(
      `document.querySelector("#btnCapMore").click(); return true;`,
      `const q = s => document.querySelector(s);
       return { advancedHidden: q("#capAdvanced").hidden,
                moreLabel: q("#btnCapMore").textContent.trim(),
                text: q("#capText").value,
                triggerField: q("#capTrigger").value,
                summary: q("#capSummary").textContent.trim() };`,
      400);
    await session.shot("V04-more-options");
    check("V04 「更多选项」可展开高级字段", v04f.advancedHidden === false, "moreLabel=" + v04f.moreLabel);
    check("V04 展开更多选项不影响已填内容（标题与时间都还在）",
      (v04f.text || "").length > 0 && (v04f.triggerField || "").length > 0, v04f.text + " / " + v04f.triggerField);

    /* ---------------- V16 窄屏可达 ---------------- */
    const widths = [360, 390, 430];
    for (const w of widths) {
      await session.setWidth(w, 932);
      await sleep(300);
      const m = await session.evaluate(`
        const q = s => document.querySelector(s);
        return {
          scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
          saveVisible: !!(q("#btnSaveItem") && q("#btnSaveItem").offsetParent !== null),
          moreVisible: !!(q("#btnCapMore") && q("#btnCapMore").offsetParent !== null)
        };
      `);
      check("V16 " + w + "px 无横向溢出", m.scrollW <= m.innerW + 1, "scrollW=" + m.scrollW + " innerW=" + m.innerW);
      check("V16 " + w + "px 保存/更多选项可达", m.saveVisible === true && m.moreVisible === true);
      await session.shot("V16-" + w + "px");
    }
    await session.setWidth(430, 932);

    /* ---------------- V17 到期浮层不遮关键操作 / 不隐式 ACK ---------------- */
    const v17 = await session.evaluate(`
      const app = window.__ATTENTION_INBOX__;
      document.querySelector("#fab").click();
      const t = document.querySelector("#capText");
      t.value = "还没保存的草稿内容";
      t.dispatchEvent(new Event("input", { bubbles: true }));
      const due = app.makeItem({ title: "到点的事", status: "due", triggerAt: Date.now() - 1000 });
      app.state.items.push(due);
      app.renderHome();
      return { textBefore: t.value, status: due.status };
    `);
    // 应用内提醒由 15 s 心跳驱动（tick），不是 renderHome 直接弹 —— 必须等它
    let v17seen = false;
    for (let i = 0; i < 80; i++) {
      v17seen = await session.evaluate(`return document.querySelector("#alertBanner").classList.contains("show");`);
      if (v17seen) break;
      await sleep(250);
    }
    await session.shot("V17-due-overlay-while-typing");
    const v17b = await session.evaluate(`
      const app = window.__ATTENTION_INBOX__;
      const due = app.state.items.find(x => x.title === "到点的事");
      return { textAfter: document.querySelector("#capText").value,
               acknowledged: !!(due && due.acknowledgedAt),
               status: due && due.status,
               bannerShown: document.querySelector("#alertBanner").classList.contains("show") };
    `);
    check("V17 到期浮层确实出现（15 s 心跳内）", v17seen === true);
    check("V17 到期浮层不丢录入内容", v17b.textAfter === v17.textBefore, "before=" + v17.textBefore + " after=" + v17b.textAfter);
    check("V17 到期不隐式 ACK（未被标记已确认）", v17b.acknowledged === false, "status=" + v17b.status);

    /* ---------------- V13 送达证据回流（Web 无原生 ⇒ 必须诚实） ---------------- */
    const v13 = await session.evaluate(`
      const app = window.__ATTENTION_INBOX__;
      let readable = null, err = null;
      try { readable = await app.readDeliveryEvidence(); } catch (e) { err = String(e && e.message || e); }
      const it = app.state.items.find(x => x.title === "明天下午3点提醒我取快递") || app.state.items[0] || null;
      let row = null;
      try { row = it ? app.detailReminderStatusRow(it) : null; } catch (e) { row = "ERR " + (e && e.message); }
      return { readable: readable, err: err,
               evidenceState: app.deliveryEvidenceState || null,
               readableFlag: app.deliveryEvidenceReadable ? app.deliveryEvidenceReadable() : null,
               row: row };
    `);
    check("V13 Web 上读送达证据不抛异常", v13.err === null, v13.err || "ok");
    check("V13 Web 上如实报告「无原生证据」而不是编造已送达",
      v13.readable === null || v13.readable === undefined || v13.readable.available === false ||
      (v13.readableFlag === false),
      JSON.stringify(v13.readable) + " readableFlag=" + v13.readableFlag);
    check("V13 详情「提醒结果」不指控漏提醒（红线：缺证据只能是未确认）",
      typeof v13.row === "string" && !/漏|未送达|提醒失败/.test(v13.row),
      String(v13.row).replace(/<[^>]*>/g, " ").trim());

    /* ---------------- 控制台无异常 ---------------- */
    check("全程浏览器控制台无异常", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));

    const pass = results.filter(r => r.pass).length;
    const fail = results.length - pass;
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({
      ranAt: new Date().toISOString(),
      repo: REPO,
      consoleErrors,
      passed: pass,
      failed: fail,
      results
    }, null, 2));
    console.log(`\n==== Web 运行层：通过 ${pass} / 失败 ${fail} ====`);
  } finally {
    try { if (session) session.ws.close(); } catch (e) {}
    try { chrome.proc.kill("SIGKILL"); } catch (e) {}
    try { server.close(); } catch (e) {}
  }
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
