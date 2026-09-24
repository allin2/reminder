/* 生产脚本组合的**唯一读取口**（O1）。
 *
 * 为什么必须有它：本仓库没有打包器，`index.html` 里的 `<script>` 顺序就是生产加载顺序，
 * 而同一份清单被**四处**手工照抄 —— `index.html`、`sw.js` 的 `ASSETS`、
 * `test-smoke.js` 的加载列表、`test-regressions.js` 的 `LIB_SOURCES`（外加打包复制链
 * `scripts/sync-www.js`）。漏一处的后果不是报错，而是**静默降级**：
 * `app-core.js` 取模块用的是 `AttentionXxx || {}`，于是「没加载」和「加载了一个空对象」
 * 在它眼里完全一样，测试照旧全绿。
 *
 * 所以「期望集合」一律从 `index.html` **推导**，不在这里硬编码第二份副本；
 * 本文件只负责解析 + 判定，供各 harness 与证据脚本共用。
 *
 * 纯读取，不写任何文件。
 */
"use strict";

const fs = require("fs");
const path = require("path");

/** 合法的运行时脚本形状：`app-core.js` 或 `lib/<name>.js`。未知形状必须报错，不能放过。 */
const SCRIPT_SHAPE = /^(app-core\.js|lib\/[A-Za-z0-9._-]+\.js)$/;

/**
 * **加载期依赖**：这些模块在**被求值的那一刻**就把另一个模块的函数抓进了自己的闭包常量，
 * 之后不会再重读。它们的顺序错了不会抛错 —— 只会静默退化成兜底实现。
 *
 * `lib/native-reminders.js` 顶部写的是
 *     const Lib = (function () { if (root.AttentionLib && root.AttentionLib.deadlineStageKey) return root.AttentionLib; ... })();
 * 而 `deadlineStageKey` / `deadlineStagePoints` / `DEADLINE_LEAD_MS` 都定义在
 * `lib/reminder.js`（lib/reminder.js:95/110/70）。反过来加载 ⇒ `Lib` 为 null ⇒
 * 截止保护只剩一个 p24 阶段（兜底 `deadlineStagePoints` 只返回一个点），
 * 界面与日志都正常，只是**少了一段时间的保护提醒**。
 */
const LOAD_TIME_DEPENDENCIES = [
  {
    script: "lib/parse-cn.js",
    requires: ["lib/date-utils.js"],
    why: "它在求值时就把 AttentionLib.DatePrimitives 抓进闭包常量 P（拿不到直接抛「缺日历原语」）"
  },
  {
    script: "lib/repeat.js",
    requires: ["lib/date-utils.js"],
    why: "同上：求值时抓 AttentionLib.DatePrimitives，拿不到直接抛错而不是退回另一套日历算法"
  },
  {
    script: "lib/ui-format.js",
    requires: ["lib/date-utils.js"],
    why: "同上：求值时抓 AttentionLib.DatePrimitives（sameDay / addDays）做「今天/明天/昨天」判定"
  },
  {
    script: "lib/native-reminders.js",
    requires: ["lib/reminder.js"],
    why: "它在求值时就把 AttentionLib.deadlineStageKey/deadlineStagePoints/inQuietHours/quietEnd " +
      "抓进闭包常量 Lib，而那些标识符定义在 lib/reminder.js"
  }
];

/**
 * `app-core.js` 里代表「模块命名空间」的局部常量。
 *
 * 覆盖判定要按 `<命名空间>.<成员>` 逐符号对齐，所以必须知道有哪些命名空间。
 * 新增一个命名空间模块（如 `AttentionLib.UiFormat`）时**在这里加一行** ——
 * 忘了加的后果是这个模块的引用完全不被闭合判定覆盖，与「忘了进声明表」是同一种漏洞。
 */
const NAMESPACE_LOCALS = ["Lib", "DatePrimitives", "UiFormat", "AppUi"];

/**
 * 去掉注释，但保留换行与列位置（等长空白替换）。
 *
 * 为什么需要：`app-core.js` 里有大量**注释中的** `Lib.parseChineseTime` 这类引用示例。
 * 不剥掉就会把「文档里提到的符号」误当成「代码依赖的符号」，于是覆盖判定被注释养肥、
 * 真的漏声明反而看不出来。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/**
 * **运行时依赖矩阵闭合检查**（P1）。
 *
 * 三个集合必须对得上：
 *   · `refs`     —— `app-core.js` 里**真实引用**的 `Lib.x` / `DatePrimitives.x`（剥掉注释）；
 *   · `declared` —— 启动闸门的声明表 `REQUIRED_RUNTIME_EXPORTS` 里的路径；
 *   · `undeclared` —— refs 里有、声明表里没有的（**必须为空**）。
 *
 * 为什么这条比「启动正常」更有价值：闸门只保护它**列出来**的东西。有人新写一行
 * `Lib.somethingNew(...)` 却忘了进表，闸门就看不见它 —— 运行到那一行才 TypeError，
 * 或者更糟：写成 `Lib.x ? … : 兜底` 于是静默降级。闭包由这条检查守住。
 *
 * 反向对照必须有牙齿：往 app-core 里塞一个未声明的 `Lib.newThing`，`undeclared` 必须变红。
 * 为此 `options.source` 允许传入**替换用的 app-core 源码** —— 否则反向对照只能靠改仓库文件，
 * 那既脏又不可重放。
 */
function runtimeDependencyCoverage(root, options) {
  const raw = (options && typeof options.source === "string")
    ? options.source
    : fs.readFileSync(path.join(root, "app-core.js"), "utf8");
  const code = stripComments(raw);

  const refs = new Map();
  const nsAlternation = NAMESPACE_LOCALS
    .map(function (n) { return n.replace(/\$/g, "\\$"); })
    .sort(function (a, b) { return b.length - a.length; })   // 长的先匹配，避免 DatePrimitives 被 Date 之类截断
    .join("|");
  code.split("\n").forEach((line, i) => {
    const re = new RegExp("\\b(" + nsAlternation + ")\\.([A-Za-z_$][\\w$]*)", "g");
    let m;
    while ((m = re.exec(line)) !== null) {
      const ns = m[1];
      const member = m[2];
      // `Lib` 本身是模块注册表，不是「一个模块」，要求它进声明表没有意义 —— 跳过。
      // 其余命名空间（`DatePrimitives` / `UiFormat`）**自身**也算一条：闸门要检查它存在。
      if (ns !== "Lib") {
        if (!refs.has(ns)) refs.set(ns, []);
        refs.get(ns).push(i + 1);
      }
      const key = ns === "Lib" ? member : ns + "." + member;
      if (!refs.has(key)) refs.set(key, []);
      refs.get(key).push(i + 1);
    }
  });

  // 声明表按源码形状读取：["<path>", "<type>", ...]
  const declared = new Map();
  const reTable = /\[\s*"([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)"\s*,\s*"(function|object)"/g;
  let t;
  while ((t = reTable.exec(raw)) !== null) {
    if (!declared.has(t[1])) declared.set(t[1], t[2]);
  }

  const undeclared = [];
  refs.forEach((lines, key) => {
    if (!declared.has(key)) undeclared.push({ path: key, lines: lines });
  });
  undeclared.sort((a, b) => (a.path < b.path ? -1 : 1));

  return {
    refs: Array.from(refs.keys()).sort(),
    declared: Array.from(declared.keys()).sort(),
    undeclared: undeclared,
    /** 声明了但谁也没引用 —— 不算错，只是冗余，单独报出来供人工过目。 */
    unusedDeclarations: Array.from(declared.keys()).filter(k => !refs.has(k)).sort()
  };
}

function readIndexScripts(root) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1].replace(/^\.\//, ""));
  }
  return out;
}

/** 从 `sw.js` 的 `ASSETS` 里读出预缓存清单（同样是从源码推导，不硬编码）。 */
function readSwAssets(root) {
  const src = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const block = /const\s+ASSETS\s*=\s*\[([\s\S]*?)\]/.exec(src);
  if (!block) return null;
  const out = [];
  const re = /["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(block[1])) !== null) out.push(m[1].replace(/^\.\//, ""));
  return out;
}

/**
 * 对一份脚本清单做全部结构性判定。返回问题数组（空数组 = 通过）。
 * 判定的是「这份清单本身合不合法」，因此反例清单也会走到这里并**必须**被报出来。
 */
function inspectList(root, scripts) {
  const problems = [];
  if (!Array.isArray(scripts) || !scripts.length) return ["empty-script-list"];

  const seen = new Set();
  scripts.forEach((src, index) => {
    if (!SCRIPT_SHAPE.test(src)) {
      problems.push("unknown-script:" + src + "（只允许 app-core.js 与 lib/*.js）");
      return;
    }
    if (seen.has(src)) problems.push("duplicate-script:" + src);
    seen.add(src);
    const file = path.join(root, src);
    if (!fs.existsSync(file)) {
      problems.push("missing-file:" + src);
      return;
    }
    if (!fs.statSync(file).isFile()) problems.push("not-a-file:" + src);
  });

  const appIndex = scripts.indexOf("app-core.js");
  if (appIndex < 0) problems.push("missing-app-core");
  else if (appIndex !== scripts.length - 1) {
    problems.push("app-core-not-last:index=" + appIndex + "/" + (scripts.length - 1) +
      "（app-core 在 IIFE 开头就取 AttentionLib / AttentionNativeReminders，必须最后加载）");
  }
  scripts.forEach((src, index) => {
    if (src === "app-core.js") return;
    if (appIndex >= 0 && index > appIndex) problems.push("lib-after-app-core:" + src);
  });

  LOAD_TIME_DEPENDENCIES.forEach(dep => {
    const at = scripts.indexOf(dep.script);
    if (at < 0) return; // 缺席由 harness 覆盖判定负责，不在这里重复报
    dep.requires.forEach(req => {
      const reqAt = scripts.indexOf(req);
      if (reqAt < 0) {
        problems.push("missing-load-time-dependency:" + dep.script + " -> " + req);
      } else if (reqAt > at) {
        problems.push("load-order:" + dep.script + " 在 " + req + " 之前（" + dep.why + "）");
      }
    });
  });

  return problems;
}

/**
 * 某套 harness 对生产脚本的**覆盖判定**。
 *
 * 规则：`index.html` 里的每一支脚本，本 harness 必须能明确交代它的去向 ——
 *   · 真的加载了同一个文件（`loaded`）；或
 *   · 用**声明的注入**替代（`injections[script]`，必须写明为什么、以及是否真在沙箱里生效）；或
 *   · **声明的有意缺席**（`dropped[script]`，必须写明由哪套 harness 覆盖它）。
 * 没有交代的一律报错 —— 那正是「四件套漏一处、测试静默降级」的形态。
 *
 * `why` 为空视为没交代（强制写清理由，而不是靠一个空对象糊过去）。
 */
function coverageProblems(options) {
  const root = options.root;
  const loaded = new Set(options.loaded || []);
  const injections = options.injections || {};
  const dropped = options.dropped || {};
  const problems = [];
  const indexScripts = readIndexScripts(root);

  indexScripts.forEach(src => {
    if (loaded.has(src)) return;
    const inj = injections[src];
    if (inj && typeof inj.why === "string" && inj.why.trim()) return;
    const drop = dropped[src];
    if (drop && typeof drop.why === "string" && drop.why.trim()) return;
    problems.push("unaccounted-production-script:" + src +
      "（本 harness 既没加载它，也没声明替代注入或有意的缺席；" +
      "app-core 的 `|| {}` 兜底会让这个缺口静默通过）");
  });

  // 声明的注入必须在沙箱里**真的**存在，而且不是空实现 —— 否则「声明」会变成一句空话。
  Object.keys(injections).forEach(src => {
    const probe = injections[src].probe;
    if (typeof probe !== "function") return;
    const verdict = probe();
    if (verdict !== true) {
      problems.push("declared-injection-not-effective:" + src +
        "（" + String(injections[src].why || "") + "；实测 = " + String(verdict) + "）");
    }
  });

  return { problems: problems, indexScripts: indexScripts, problemsOfList: inspectList(root, indexScripts) };
}

/** `sw.js` 预缓存清单 vs `index.html`：脚本必须逐条覆盖，且清单里不能有磁盘上不存在的条目。 */
function precacheProblems(root) {
  const assets = readSwAssets(root);
  if (!assets) return ["sw-assets-unreadable"];
  const set = new Set(assets);
  const problems = [];
  readIndexScripts(root).forEach(src => {
    if (!set.has(src)) {
      problems.push("not-precached:" + src +
        "（全新安装 + 第一次就没网 ⇒ caches.match 未命中，脚本回落成 HTML，桥静默缺失）");
    }
  });
  assets.forEach(a => {
    if (!a || a === "." || a.endsWith("/")) return;
    if (!fs.existsSync(path.join(root, a))) problems.push("precache-missing-file:" + a);
  });
  return problems;
}

/** 打包复制链：`scripts/sync-www.js` 必须会把每支运行时脚本复制进 `www/`。 */
function packagingProblems(root) {
  const src = fs.readFileSync(path.join(root, "scripts/sync-www.js"), "utf8");
  const filesBlock = /const\s+FILES\s*=\s*\[([\s\S]*?)\]/.exec(src);
  const dirsBlock = /const\s+DIRS\s*=\s*\[([\s\S]*?)\]/.exec(src);
  const files = filesBlock ? (filesBlock[1].match(/["']([^"']+)["']/g) || []).map(s => s.replace(/["']/g, "")) : [];
  const dirs = dirsBlock ? (dirsBlock[1].match(/["']([^"']+)["']/g) || []).map(s => s.replace(/["']/g, "")) : [];
  const problems = [];
  readIndexScripts(root).forEach(script => {
    if (files.indexOf(script) >= 0) return;
    const dir = script.split("/")[0];
    if (script.indexOf("/") >= 0 && dirs.indexOf(dir) >= 0) return; // 整个目录被复制
    problems.push("not-packaged:" + script);
  });
  return problems;
}

/**
 * **各 harness 实际加载了哪些生产脚本** —— 从 harness 源码里推导，不在这里再抄一份清单。
 *
 * 为什么要它：`test-smoke.js` 与 `test-regressions.js` 都**没有**把 `lib/native-reminders.js`
 * 放进沙箱（regressions 是直接 `require` 那一支做专项测试的）。于是这两套里
 * `AttentionNativeReminders` 恒为 `undefined`，app-core 走 `|| {}` 兜底而**一切照常变绿**——
 * 这就是「四件套漏一处、静默降级」的形态。
 *
 * 本函数只做**读取**，不改动那两套 harness（方案 §4 O1：保留有效的专项替身）。
 * 把它们「加载了什么」变成可断言的事实，缺口就不再是隐形的：
 * 只要有人增删了这些列表，调用方的声明断言就会变红，必须重新交代。
 *
 * 提取方式是各自源码里**唯一的**加载语法，不是全文搜 `lib/*.js` 字面量 ——
 * 后者会把注释与断言文案里的提及一起数进来（smoke 里就有一句注释提到 native-reminders）。
 */
function readHarnessLoadSets(root) {
  const out = {};

  // test-smoke.js：`vm.runInContext(<src>, sandbox, { filename: "<name>" })`
  const smokeSrc = fs.readFileSync(path.join(root, "test-smoke.js"), "utf8");
  const smoke = [];
  const reSmoke = /runInContext\([^,]+,\s*sandbox\s*,\s*\{\s*filename:\s*["']([^"']+)["']/g;
  let m;
  while ((m = reSmoke.exec(smokeSrc)) !== null) smoke.push(m[1]);
  out["test-smoke.js"] = smoke;

  // test-regressions.js：`LIB_SOURCES` 数组 + `APP_SOURCE` 的 name
  const regSrc = fs.readFileSync(path.join(root, "test-regressions.js"), "utf8");
  const reg = [];
  const block = /const\s+LIB_SOURCES\s*=\s*\[([\s\S]*?)\]/.exec(regSrc);
  if (block) {
    const re = /["']([^"']+)["']/g;
    let m2;
    while ((m2 = re.exec(block[1])) !== null) reg.push(m2[1]);
  }
  const appName = /const\s+APP_SOURCE\s*=\s*\{\s*name:\s*["']([^"']+)["']/.exec(regSrc);
  if (appName) reg.push(appName[1]);
  out["test-regressions.js"] = reg;

  return out;
}

module.exports = {
  SCRIPT_SHAPE: SCRIPT_SHAPE,
  LOAD_TIME_DEPENDENCIES: LOAD_TIME_DEPENDENCIES,
  runtimeDependencyCoverage: runtimeDependencyCoverage,
  stripComments: stripComments,
  readIndexScripts: readIndexScripts,
  readSwAssets: readSwAssets,
  inspectList: inspectList,
  coverageProblems: coverageProblems,
  precacheProblems: precacheProblems,
  packagingProblems: packagingProblems,
  readHarnessLoadSets: readHarnessLoadSets
};
