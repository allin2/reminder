#!/usr/bin/env node
/*
 * **DOM 层搬移不改行为**的对照脚本（P2-b：`lib/app-ui.js`）。
 *
 * 问题：把 `$` / `$$` / 弹层 / `toast` / `confirmDialog` / `safeExternalHref` 搬进
 * `lib/app-ui.js` 时，「行为没变」这句话怎么证？这几支不像 `fmtTime` 那样是纯函数 ——
 * 它们的作用是**改动 DOM 与会话状态**（backdrop、`.open` 类、按钮的 `onclick`、
 * 定时器、Promise 的解析值）。所以比对对象必须是「一串调用之后，DOM 和定时器变成了什么样」。
 *
 * 做法：
 *   · oracle = `git show HEAD:app-core.js` 里**搬移前**的原实现（本仓库尚未提交 P2 改动，
 *     HEAD 就是搬移前原文，不是我另写的副本）；
 *   · 两边都在**同一套假 DOM + 假定时器**上、按**同一串步骤**驱动；
 *   · 每一步之后对全部节点拍一次快照（类集合 / textContent / hidden / 是否挂了 onclick），
 *     并把「挂起中的定时器延时」一并记入；逐步逐字段比对。
 *
 * 为什么把假 DOM 装在 `global` 上而不是传参：oracle 与新实现在这一点上必须同构 ——
 * 两者都**在调用时才**解析 `document` / `setTimeout` / `window` / `URL` 这些自由变量。
 * 换成传参就等于替其中一边改了求值方式，比出来的「一致」没有意义。
 *
 * 覆盖的降级分支：`safeExternalHref` 在没有 `URL` 构造器时的保守字形分支（已登记降级），
 * 以及 `confirmDialog` 在 `#sheetConfirm` 缺失时落到 `window.confirm` 的兜底。
 *
 * 有牙齿：把新实现里任意一处改一个字符（少删一个类、时长 2400 改成 2500、`hidden` 不置回），
 * 必须报出差异。
 *
 * 用法：node scripts/verification/ui-dom-parity.js
 * 退出码：0 = 逐步逐字段一致；1 = 存在差异或脚本自身没有分辨力。
 */
"use strict";

const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");

/* ================================================================== *
 * 一、假 DOM
 * ================================================================== */

/**
 * `document.querySelector` 只认 `#id`，`querySelectorAll` 只认 `.sheet` / `.sheet.open`。
 * 这正是被测代码实际用到的全部选择器（多一个都算我没核对过）。
 */
function createFakeDom(options) {
  const omit = (options && options.omit) || [];
  const byId = Object.create(null);
  const sheets = [];

  function makeNode(id, opts) {
    const set = new Set((opts && opts.classes) || []);
    const n = {
      id: id,
      textContent: "",
      hidden: false,
      onclick: null,
      classList: {
        add: function (c) { set.add(c); },
        remove: function (c) { set.delete(c); },
        contains: function (c) { return set.has(c); }
      },
      _set: set
    };
    if (omit.indexOf(id) < 0) byId[id] = n;
    if (opts && opts.sheet) sheets.push(n);
    return n;
  }

  // 与 index.html 对应的节点。多注册一个 sheetDetail，是为了让「关掉一层后 backdrop
  // 该不该撤」这条口径能被真的走到（只有一层时永远分不出对错）。
  makeNode("backdrop");
  makeNode("toast");
  makeNode("toastText");
  makeNode("toastAction");
  makeNode("toastAction2");
  makeNode("sheetCapture", { sheet: true });
  makeNode("sheetDetail", { sheet: true });
  makeNode("sheetConfirm", { sheet: true });
  makeNode("confirmBody");
  makeNode("confirmTitle");
  makeNode("confirmOk");
  makeNode("confirmCancel");
  makeNode("confirmClose");

  const document = {
    querySelector: function (sel) {
      if (sel.charAt(0) === "#") return byId[sel.slice(1)] || null;
      return null;
    },
    querySelectorAll: function (sel) {
      if (sel === ".sheet") return sheets.slice();
      if (sel === ".sheet.open") {
        return sheets.filter(function (s) { return s._set.has("open"); });
      }
      return [];
    }
  };

  return { document: document, byId: byId, sheets: sheets };
}

/** 全部节点的可观测状态。只记「有没有挂 onclick」，不记函数体（函数体不是行为契约）。 */
function snapshotDom(dom) {
  const out = {};
  Object.keys(dom.byId).sort().forEach(function (id) {
    const n = dom.byId[id];
    out[id] = {
      text: n.textContent,
      hidden: n.hidden,
      onclick: typeof n.onclick === "function" ? "set" : String(n.onclick),
      classes: Array.from(n._set).sort()
    };
  });
  return out;
}

/* ================================================================== *
 * 二、假定时器（否则「时长」这条根本比不了，只能等真实 2.4 秒）
 * ================================================================== */

function installFakeTimers() {
  const saved = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  const scheduled = [];
  let seq = 0;
  global.setTimeout = function (fn, delay) {
    seq += 1;
    scheduled.push({ id: seq, fn: fn, delay: delay });
    return seq;
  };
  global.clearTimeout = function (id) {
    for (let i = 0; i < scheduled.length; i++) {
      if (scheduled[i].id === id) { scheduled.splice(i, 1); return; }
    }
  };
  return {
    delays: function () { return scheduled.map(function (s) { return s.delay; }); },
    fireFirst: function () {
      const t = scheduled.shift();
      if (!t) throw new Error("没有挂起中的定时器可触发");
      t.fn();
    },
    restore: function () {
      global.setTimeout = saved.setTimeout;
      global.clearTimeout = saved.clearTimeout;
    }
  };
}

/* ================================================================== *
 * 三、oracle：从 HEAD 切出搬移前的实现
 * ================================================================== */

const headCore = execFileSync("git", ["show", "HEAD:app-core.js"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();

/** 按行累计大括号深度切出 `  function name(` 的完整定义（同 ui-format-parity.js）。 */
function sliceFunction(src, header) {
  const lines = src.split("\n");
  const start = lines.findIndex(function (l) { return l.indexOf("  " + header) === 0; });
  if (start < 0) throw new Error("HEAD 里找不到函数定义：" + header);
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    for (let k = 0; k < l.length; k++) {
      if (l[k] === "{") depth++;
      else if (l[k] === "}") depth--;
    }
    if (depth <= 0) return lines.slice(start, i + 1).join("\n");
  }
  throw new Error("函数体未闭合：" + header);
}

/** 取 HEAD 里唯一匹配某前缀的那一行（`$` / `$$` / `toastTimer` 是单行声明）。 */
function headLine(src, needle) {
  const hits = src.split("\n").filter(function (l) { return l.indexOf(needle) === 0; });
  if (hits.length !== 1) throw new Error("HEAD 里 " + JSON.stringify(needle) + " 命中 " + hits.length + " 行");
  return hits[0];
}

const ORACLE_SRC = [
  headLine(headCore, "  const $ = "),
  headLine(headCore, "  const $$ = "),
  sliceFunction(headCore, "function openSheet(id)"),
  sliceFunction(headCore, "function closeSheet(id)"),
  sliceFunction(headCore, "function closeAllSheets()"),
  sliceFunction(headCore, "function confirmDialog(message, title)"),
  headLine(headCore, "  let toastTimer = null;"),
  sliceFunction(headCore, "function toast(msg, actionLabel, onAction, second, opts)"),
  sliceFunction(headCore, "function hideToast()"),
  sliceFunction(headCore, "function safeExternalHref(raw)")
].join("\n");

/**
 * 造一份 oracle 实例。`suppressUserFeedback` 在 HEAD 里是 IIFE 内的 `let`，
 * 这里补一份同名的可变绑定 + 取值入口，使两边能被同一串步骤驱动。
 */
function makeOracle() {
  const body = ORACLE_SRC + "\n" +
    "  let suppressUserFeedback = false;\n" +
    "  return {\n" +
    "    label: 'HEAD',\n" +
    "    $: $, $$: $$,\n" +
    "    openSheet: openSheet, closeSheet: closeSheet, closeAllSheets: closeAllSheets,\n" +
    "    confirmDialog: confirmDialog, toast: toast, hideToast: hideToast,\n" +
    "    safeExternalHref: safeExternalHref,\n" +
    "    setSuppressed: function (v) { suppressUserFeedback = !!v; }\n" +
    "  };\n";
  return new Function(body)();
}

/* ================================================================== *
 * 四、新实现
 * ================================================================== */

const appUi = require(path.join(ROOT, "lib/app-ui.js"));

function makeNew() {
  const box = { suppressed: false };
  const inst = appUi.createUi({ isFeedbackSuppressed: function () { return box.suppressed; } });
  return {
    label: "app-ui",
    $: inst.$, $$: inst.$$,
    openSheet: inst.openSheet, closeSheet: inst.closeSheet, closeAllSheets: inst.closeAllSheets,
    confirmDialog: inst.confirmDialog, toast: inst.toast, hideToast: inst.hideToast,
    safeExternalHref: appUi.safeExternalHref,
    setSuppressed: function (v) { box.suppressed = !!v; }
  };
}

/* ================================================================== *
 * 五、输入矩阵
 * ================================================================== */

const URL_MATRIX = [
  null, undefined, "", "   ", 0,
  "https://example.com/a?b=1#c",
  "http://example.com",
  "HTTPS://EXAMPLE.COM",
  "  https://example.com/x  ",
  "javascript:alert(1)",
  " jAvAsCrIpT:alert(1)",
  "java\nscript:alert(1)",
  "ja\tvascript:alert(1)",
  "data:text/html;base64,PHNjcmlwdD4=",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "ftp://example.com/x",
  "//example.com/x",
  "example.com/x",
  "https://",
  "https://a b",
  "https://例子.测试/路径?q=1",
  "https://user:pass@example.com:8443/p",
  "https://[::1]:8080/x",
  "https://example.com/\u0000x",
  "https://example.com/x\u007f",
  "http://example.com/" + "a".repeat(300)
];

/* ================================================================== *
 * 六、场景：同一串步骤驱动两边
 * ================================================================== */

const SCENARIOS = [
  {
    name: "弹层：逐层开关与 backdrop 的撤销口径",
    async steps(api, rec) {
      api.openSheet("sheetCapture");        rec("开 capture");
      api.openSheet("sheetDetail");         rec("再开 detail");
      api.closeSheet("sheetCapture");       rec("关 capture（detail 还开着 ⇒ backdrop 该留）");
      api.closeSheet("sheetDetail");        rec("关 detail（没有开着的 ⇒ backdrop 该撤）");
      api.openSheet("sheetCapture");        rec("再开 capture");
      api.closeAllSheets();                 rec("closeAllSheets");
    }
  },
  {
    name: "弹层：不存在的 id（两边应同样失败）",
    async steps(api, rec) {
      try {
        api.openSheet("sheetNope");
        rec("开不存在的弹层 — 未抛错");
      } catch (error) {
        rec("开不存在的弹层 — 抛错：" + (error && error.message));
      }
    }
  },
  {
    name: "toast：无动作",
    async steps(api, rec) {
      api.toast("保存失败 · 修改仍保留在本机内存");
      rec("toast 无动作");
      api.hideToast();
      rec("手动 hideToast");
    }
  },
  {
    name: "toast：一个动作，并点它",
    async steps(api, rec, ctx) {
      let acted = 0;
      api.toast("已删除", "撤销", function () { acted += 1; });
      rec("toast 带一个动作");
      const btn = ctx.dom.byId["toastAction"];
      btn.onclick();
      rec("点了动作（acted=" + acted + "）");
    }
  },
  {
    name: "toast：一个动作但不点",
    async steps(api, rec, ctx) {
      api.toast("已删除", "撤销", function () {});
      rec("toast 带一个动作");
      ctx.timers.fireFirst();
      rec("定时器到点");
    }
  },
  {
    name: "toast：第二个动作，并点它",
    async steps(api, rec, ctx) {
      let a = 0, b = 0;
      api.toast("已完成", "查看", function () { a += 1; }, { label: "撤销", onClick: function () { b += 1; } });
      rec("toast 带两个动作");
      ctx.dom.byId["toastAction2"].onclick();
      rec("点了第二个动作（a=" + a + " b=" + b + "）");
    }
  },
  {
    name: "toast：second 形状不合法（无 label）",
    async steps(api, rec) {
      api.toast("x", null, null, { onClick: function () {} });
      rec("second 无 label");
      api.toast("y", null, null, null);
      rec("second 为 null");
    }
  },
  {
    name: "toast：连续两次（前一个定时器必须被撤）",
    async steps(api, rec, ctx) {
      api.toast("第一条");
      rec("第一次（挂起 " + JSON.stringify(ctx.timers.delays()) + "）");
      api.toast("第二条");
      rec("第二次（挂起 " + JSON.stringify(ctx.timers.delays()) + "）");
      ctx.timers.fireFirst();
      rec("定时器到点");
    }
  },
  {
    name: "toast：时长口径（默认 / 有动作 / 显式指定）",
    async steps(api, rec, ctx) {
      api.toast("a");
      rec("无动作 ⇒ " + JSON.stringify(ctx.timers.delays()));
      api.toast("b", "动作");
      rec("有动作 ⇒ " + JSON.stringify(ctx.timers.delays()));
      api.toast("c", null, null, null, { durationMs: 777 });
      rec("显式 777 ⇒ " + JSON.stringify(ctx.timers.delays()));
      api.toast("d", null, null, null, { durationMs: 0 });
      rec("显式 0 ⇒ " + JSON.stringify(ctx.timers.delays()));
    }
  },
  {
    name: "toast：重放期抑制（M1）",
    async steps(api, rec) {
      api.setSuppressed(true);
      api.toast("重放期不该弹出来", "撤销", function () {});
      rec("抑制中调用 toast");
      api.setSuppressed(false);
      api.toast("恢复正常");
      rec("解除抑制后");
    }
  },
  {
    name: "确认框：三个出口",
    async steps(api, rec, ctx) {
      const p1 = api.confirmDialog("确定删除？", "删除");
      rec("弹出（未决）");
      ctx.dom.byId["confirmOk"].onclick();
      rec("点确定 ⇒ " + JSON.stringify(await p1));

      const p2 = api.confirmDialog("确定删除？");
      ctx.dom.byId["confirmCancel"].onclick();
      rec("点取消 ⇒ " + JSON.stringify(await p2));

      const p3 = api.confirmDialog();
      ctx.dom.byId["confirmClose"].onclick();
      rec("点关闭 ⇒ " + JSON.stringify(await p3));
    }
  },
  {
    name: "确认框：点完之后 onclick 必须被清干净",
    async steps(api, rec, ctx) {
      const p = api.confirmDialog("再弹一次", "标题");
      ctx.dom.byId["confirmOk"].onclick();
      await p;
      rec("已解析");
      const p2 = api.confirmDialog("第三次");
      rec("再弹一次（三个出口应重新挂上）");
      ctx.dom.byId["confirmCancel"].onclick();
      await p2;
      rec("再次解析");
    }
  },
  {
    name: "确认框：兜底路径（没有 #sheetConfirm 时用 window.confirm）",
    dom: { omit: ["sheetConfirm"] },
    window: { confirm: function () { return false; } },
    async steps(api, rec) {
      rec("window.confirm 返回 false ⇒ " + JSON.stringify(await api.confirmDialog("危险操作")));
    }
  },
  {
    name: "确认框：兜底路径里 window.confirm 抛错",
    dom: { omit: ["sheetConfirm"] },
    window: { confirm: function () { throw new Error("blocked"); } },
    async steps(api, rec) {
      rec("window.confirm 抛错 ⇒ " + JSON.stringify(await api.confirmDialog("危险操作")));
    }
  },
  {
    name: "外链白名单：危险与合法 URL 矩阵",
    async steps(api, rec) {
      const out = URL_MATRIX.map(function (u) {
        return JSON.stringify(u) + " => " + JSON.stringify(api.safeExternalHref(u));
      });
      rec("矩阵（" + out.length + " 项）\n" + out.join("\n"));
    }
  },
  {
    name: "外链白名单：没有 URL 构造器时的保守分支（已登记降级）",
    urlAvailable: false,
    async steps(api, rec) {
      const out = URL_MATRIX.map(function (u) {
        return JSON.stringify(u) + " => " + JSON.stringify(api.safeExternalHref(u));
      });
      rec("矩阵（" + out.length + " 项）\n" + out.join("\n"));
    }
  }
];

/* ================================================================== *
 * 七、驱动器
 * ================================================================== */

/** 跑一个场景的一侧，返回逐步轨迹（可 JSON 化，便于逐字段比对）。 */
async function runSide(makeImpl, scenario) {
  const dom = createFakeDom(scenario.dom);
  const timers = installFakeTimers();
  const savedGlobals = {
    document: Object.prototype.hasOwnProperty.call(global, "document") ? global.document : undefined,
    hadDocument: Object.prototype.hasOwnProperty.call(global, "document"),
    window: Object.prototype.hasOwnProperty.call(global, "window") ? global.window : undefined,
    hadWindow: Object.prototype.hasOwnProperty.call(global, "window"),
    URL: global.URL
  };
  const trace = [];
  const ctx = { dom: dom, timers: timers };
  const rec = function (label) {
    trace.push({
      label: label,
      dom: snapshotDom(dom),
      timers: timers.delays()
    });
  };
  let api = null;
  try {
    global.document = dom.document;
    if (scenario.window) global.window = scenario.window;
    else delete global.window;
    if (scenario.urlAvailable === false) {
      Object.defineProperty(global, "URL", { value: undefined, configurable: true, writable: true });
    } else {
      Object.defineProperty(global, "URL", { value: savedGlobals.URL, configurable: true, writable: true });
    }

    api = makeImpl();
    await scenario.steps(api, rec, ctx);
  } catch (error) {
    trace.push({ label: "【未捕获异常】", error: String(error && error.message ? error.message : error) });
  } finally {
    if (savedGlobals.hadWindow) global.window = savedGlobals.window; else delete global.window;
    if (savedGlobals.hadDocument) global.document = savedGlobals.document; else delete global.document;
    Object.defineProperty(global, "URL", { value: savedGlobals.URL, configurable: true, writable: true });
    timers.restore();
  }
  return trace;
}

/* ================================================================== *
 * 八、比对
 * ================================================================== */

let checked = 0;
const diffs = [];

function cmp(label, oracleVal, newVal) {
  checked += 1;
  if (oracleVal !== newVal) diffs.push({ label: label, oracle: oracleVal, next: newVal });
}

(async function main() {
  for (const scenario of SCENARIOS) {
    const a = await runSide(makeOracle, scenario);
    const b = await runSide(makeNew, scenario);

    if (a.length !== b.length) {
      cmp(scenario.name + " / 步骤数", a.length, b.length);
      continue;
    }
    for (let i = 0; i < a.length; i++) {
      const tag = scenario.name + " / 步骤 " + i + "「" + a[i].label + "」";
      cmp(tag + " 步骤标签", a[i].label, b[i].label);
      if (a[i].error || b[i].error) {
        cmp(tag + " 异常", a[i].error || null, b[i].error || null);
        continue;
      }
      cmp(tag + " 挂起定时器", JSON.stringify(a[i].timers), JSON.stringify(b[i].timers));
      const ids = Object.keys(a[i].dom).sort();
      cmp(tag + " 节点集合", JSON.stringify(ids), JSON.stringify(Object.keys(b[i].dom).sort()));
      ids.forEach(function (id) {
        cmp(tag + " #" + id, JSON.stringify(a[i].dom[id]), JSON.stringify(b[i].dom[id]));
      });
    }
  }

  /* ---------- 反向对照：脚本自身必须有分辨力 ---------- */
  {
    // ① 篡改**被测对象**：把新实现的默认时长从 2400 改成 2500。
    //    「挂起定时器的延时」是被快照的字段之一，所以必须被报出来。
    const realAppUi = require(path.join(ROOT, "lib/app-ui.js"));
    const tamperedFactory = function () {
      const box = { suppressed: false };
      const inst = realAppUi.createUi({ isFeedbackSuppressed: function () { return box.suppressed; } });
      const origToast = inst.toast;
      const wrapped = function (msg, actionLabel, onAction, second, opts) {
        const patched = Object.assign({}, opts || {});
        if (patched.durationMs == null) patched.durationMs = 2500;
        return origToast(msg, actionLabel, onAction, second, patched);
      };
      return {
        label: "tampered",
        $: inst.$, $$: inst.$$,
        openSheet: inst.openSheet, closeSheet: inst.closeSheet, closeAllSheets: inst.closeAllSheets,
        confirmDialog: inst.confirmDialog, toast: wrapped, hideToast: inst.hideToast,
        safeExternalHref: realAppUi.safeExternalHref,
        setSuppressed: function (v) { box.suppressed = !!v; }
      };
    };
    const durationScenario = SCENARIOS.filter(function (s) { return s.name.indexOf("时长口径") >= 0; })[0];
    const clean = await runSide(makeNew, durationScenario);
    const dirty = await runSide(tamperedFactory, durationScenario);
    const tamperDetected = JSON.stringify(clean) !== JSON.stringify(dirty);

    // ② 篡改**oracle 侧的证据**没有意义（oracle 是只读来源），所以第二条自检改为
    //    「同一实现跑两遍必须得到同一轨迹」—— 否则上面那些「一致」可能只是随机噪声。
    const repeat = await runSide(makeNew, durationScenario);
    const stable = JSON.stringify(clean) === JSON.stringify(repeat);

    console.log("反向对照：把新实现的默认时长改成 2500 ⇒ 能被报出差异 = " + tamperDetected);
    console.log("自检：同一实现连跑两遍轨迹一致 = " + stable);
    if (!tamperDetected || !stable) {
      console.log("\n结果：对照脚本没有分辨力（FAIL）");
      process.exit(1);
    }
  }

  /* ---------- 轨迹非空自检：否则「两边都什么都没做」也会 PASS ---------- */
  {
    const cases = [
      { scenario: "弹层：逐层开关与 backdrop 的撤销口径", step: 0, node: "sheetCapture", has: "open", want: true },
      { scenario: "弹层：逐层开关与 backdrop 的撤销口径", step: 0, node: "backdrop", has: "show", want: true },
      { scenario: "弹层：逐层开关与 backdrop 的撤销口径", step: 2, node: "backdrop", has: "show", want: true, note: "还有一层开着，backdrop 必须留着" },
      { scenario: "弹层：逐层开关与 backdrop 的撤销口径", step: 3, node: "backdrop", has: "show", want: false, note: "没有开着的层，backdrop 必须撤" },
      { scenario: "弹层：逐层开关与 backdrop 的撤销口径", step: 5, node: "sheetCapture", has: "open", want: false, note: "closeAllSheets" },
      { scenario: "toast：无动作", step: 0, node: "toast", has: "show", want: true },
      { scenario: "toast：无动作", step: 1, node: "toast", has: "show", want: false },
      { scenario: "toast：一个动作但不点", step: 1, node: "toast", has: "show", want: false, note: "定时器到点后必须收起" }
    ];
    let bad = 0;
    for (const c of cases) {
      const sc = SCENARIOS.filter(function (s) { return s.name === c.scenario; })[0];
      const trace = await runSide(makeOracle, sc);
      const step = trace[c.step];
      const got = (step.dom[c.node].classes.indexOf(c.has) >= 0);
      if (got !== c.want) {
        bad += 1;
        console.log("  ✗ 非空自检失败：" + c.scenario + " 步骤" + c.step + " #" + c.node +
          " " + (c.want ? "应含" : "不应含") + " ." + c.has + "，实际 " + JSON.stringify(step.dom[c.node].classes));
      }
    }
    // 再确认「有真实内容」：至少有一条步骤里出现过非空 classList / textContent。
    const allTraces = [];
    for (const sc of SCENARIOS) allTraces.push(await runSide(makeOracle, sc));
    const nonEmpty = allTraces.some(function (tr) {
      return tr.some(function (st) {
        if (st.error) return false;
        return Object.keys(st.dom).some(function (id) {
          return st.dom[id].classes.length > 0 || String(st.dom[id].text).length > 0;
        });
      });
    });
    const hasTimers = allTraces.some(function (tr) {
      return tr.some(function (st) { return st.timers.length > 0; });
    });
    console.log("自检：轨迹里出现过非空 DOM 状态 = " + nonEmpty + "，出现过挂起定时器 = " + hasTimers);
    if (bad || !nonEmpty || !hasTimers) {
      console.log("\n结果：对照脚本的轨迹是空的 / 与预期不符（FAIL）");
      process.exit(1);
    }
  }

  console.log("");
  console.log("场景数：" + SCENARIOS.length + "，比对字段项：" + checked);
  if (!diffs.length) {
    console.log("结果：DOM 层搬移前后逐步逐字段一致（PASS）");
    process.exit(0);
  }
  console.log("发现 " + diffs.length + " 处差异（前 10 条）：");
  diffs.slice(0, 10).forEach(function (d) {
    console.log("  ✗ " + d.label);
    console.log("      oracle = " + d.oracle);
    console.log("      next   = " + d.next);
  });
  console.log("\n结果：搬移改变了行为（FAIL）");
  process.exit(1);
})();
