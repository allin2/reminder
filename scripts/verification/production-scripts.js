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
 * `app-core.js` 里代表「模块命名空间 / 模块别名」的局部名，以及它们**归属的声明路径前缀**。
 *
 * 覆盖判定要按 `<路径前缀>.<成员>` 逐符号对齐，所以必须知道两件事：
 *   ① 哪些局部名是模块别名（`Lib` / `DatePrimitives` / `NativeReminders` / …）；
 *   ② 每个别名对应声明表里的哪个路径前缀 —— `FeedbackLib.actionSpec` 真正依赖的是
 *      `AttentionLib.Feedback.actionSpec`，而声明表按 `Feedback.actionSpec` 书写。
 *
 * 漏加一行的后果不是报错，而是**这个模块的引用完全不被闭合判定覆盖** ——
 * 与「忘了进声明表」是同一种漏洞。独立复验 F02 点名的盲区就在这里：
 * `FeedbackLib` / `EvidenceLib` / `NativeReminders` / `appUi` / `f` 从前一个都没被扫到，
 * 于是 `undeclared = []` 只能说明「已列出的那几个命名空间闭合」，不能说明依赖真的闭合。
 */
const NAMESPACE_PATHS = {
  Lib: "",                       // `Lib.x` ⇒ 声明表里的 `x`
  DatePrimitives: "DatePrimitives",
  UiFormat: "UiFormat",
  AppUi: "AppUi",
  // P2-A：AI 能力命名空间。漏加这一行的后果与漏加 `AppUi` 完全相同 ——
  // app-core 里每一处 `AppAi.xxx` 都会**退出闭合判定**，于是声明表里写没写都一样，
  // `undeclared` 恒为空。那正是独立复验 F02 指出的盲区形态，不能重演。
  AppAi: "AppAi",
  AppBackup: "AppBackup",
  // P2-D：诊断命名空间。漏加则 app-core 里每处 `AppDiagnostics.xxx` 都退出闭合判定。
  AppDiagnostics: "AppDiagnostics",
  AppSetup: "AppSetup",
  AppContent: "AppContent",
  AppCapture: "AppCapture",
  AppViews: "AppViews",
  AppModel: "AppModel",
  AppPersistence: "AppPersistence",
  AppTransaction: "AppTransaction",
  AppItems: "AppItems",
  AppNativeCoordinator: "AppNativeCoordinator",
  AppReview: "AppReview",
  AppAlerts: "AppAlerts",
  AppPlatform: "AppPlatform",
  // P3-I-R：告知命名空间。漏加则 app-core 里每处 `AppNotices.xxx` 都退出闭合判定。
  AppNotices: "AppNotices",
  AppActionFeedback: "AppActionFeedback",
  AppEvents: "AppEvents",
  AppTestApi: "AppTestApi",
  NativeReminders: "NativeReminders",
  FeedbackLib: "Feedback",
  EvidenceLib: "DeliveryEvidence"
};
const NAMESPACE_LOCALS = Object.keys(NAMESPACE_PATHS);

/**
 * 局部**别名**推导：`const feedbackApi = FeedbackLib;` ⇒ `feedbackApi` 也按 `Feedback` 前缀算。
 *
 * 为什么需要：app-core 里有多处 `const feedbackApi = FeedbackLib;`，随后用
 * `feedbackApi.setupSteps(...)`。不做归一，这些引用就落在扫描之外 —— 而它们恰恰是
 * F02 举的反例（「`App init failed: f.setupSteps is not a function`」）。
 *
 * ⚠️ **歧义即失败**（第三轮改制）：同一个短名同时被赋成「某个已知命名空间」和
 * 「别的东西」时，静态扫描**无法**证明归属。早期做法是「放弃归因，只报告」，
 * 结果是这类引用整体退出闭合判定 —— 独立复验 F02 的反例正是从这里穿过去的：
 * 把真实的 `f.setupSteps` 换成未声明成员，闭合检查仍返回 `undeclared = []`。
 *
 * 现在改成 fail closed（见 `runtimeDependencyCoverage` 的 `problems`）：
 *   · 产品源码**不允许**存在歧义短别名 —— `app-core.js` 已消除 `f` 的多重含义
 *     （反馈模块统一 `feedbackApi`、上传文件改名 `selectedFile`、`saveFeedback()`
 *     的返回值改名 `feedbackResult`）；
 *   · 认不出来的引用一律进 `problems`，矩阵判定**失败**，而不是「有意忽略」。
 * 这是刻意的：扫不出来的东西不能算已证明闭合。
 */
function collectNamespaceAliases(code) {
  const resolved = {};
  const assignedOther = new Set();
  const nsAlt = NAMESPACE_LOCALS.map(function (n) { return n.replace(/\$/g, "\\$"); }).join("|");
  const re = new RegExp("(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*([^;\\n]+);", "g");
  let m;
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    const rhs = m[2].trim();
    if (new RegExp("^(" + nsAlt + ")$").test(rhs)) {
      if (NAMESPACE_PATHS[name] === undefined) resolved[name] = rhs;
    } else if (NAMESPACE_PATHS[name] === undefined) {
      assignedOther.add(name);
    }
  }
  const ambiguous = new Set();
  Object.keys(resolved).forEach(function (name) {
    if (assignedOther.has(name)) { ambiguous.add(name); delete resolved[name]; }
  });
  return { resolved: resolved, ambiguous: Array.from(ambiguous).sort() };
}

/**
 * 「这一行是不是**成员级**存在性守卫」：`if (Ns.m)` / `Ns.m &&` / `!Ns.m` / `Ns.m ?`
 * / `if (Ns && Ns.m)`（同一行里既短路了命名空间、也检查了成员）。
 *
 * 守卫本身就是「这个成员是可选的」的书面写法 —— 带守卫的引用不该进必需表，
 * 否则一加声明，可选能力反而变成启动前提（纯 Web 会被误拦）。反过来，**没有守卫**
 * 的直接调用必须被声明覆盖，否则执行到那一刻就是 TypeError。
 *
 * ⚠️ **根对象守卫不是成员守卫**（第四轮，独立复验 F02-R2 的阻断点）：
 * `Ns ? Ns.m()` / `Ns && Ns.m()` 只证明**模块对象**在，不证明 `m` 在。
 * 而扫描范围内的每个命名空间根（`DatePrimitives` / `UiFormat` / `AppUi` /
 * `Feedback` / `DeliveryEvidence` / `NativeReminders` / `AttentionLib`）
 * **本身就是必需声明** —— 启动闸门已经保证它存在，那个 `?` / `&&` 永远走真分支，
 * 成员缺失时照样 `undefined(...)`。
 *
 * 早期把这类形态当成员守卫豁免，独立复验就在真实调用
 * `feedbackApi ? feedbackApi.setupSteps(...)` 上把成员换成未声明名字，
 * 结果仍是 `undeclared=[] problems=[]`（反例见 run `20260921T050350` 的
 * independent-guard-probe.log）。所以这里**只认检查成员本身的形态**；
 * 根对象兜底要么是无效防御（根已被闸门保证），要么该改成显式的成员检查。
 */
function isGuardedRef(line, ref) {
  const esc = ref.replace(/\$/g, "\\$");
  if (!(new RegExp("\\b" + esc + "\\b").test(line))) return false;
  return new RegExp("if\\s*\\([^)]*\\b" + esc + "\\b").test(line) ||
    new RegExp("\\b" + esc + "\\b\\s*(&&|\\|\\||\\?)").test(line) ||
    new RegExp("!\\s*" + esc + "\\b").test(line);
}

/**
 * 从**独立模块全局**读的命名空间：它们的「自身」不由 `AttentionLib` 承载，
 * 所以不参与「命名空间自身也算一条声明」的判定（存在性由对应根的那条声明保证）。
 */
const STANDALONE_ROOT_NAMESPACES = ["NativeReminders"];

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
 *
 * ⚠️ **fail closed（第三轮改制）**：返回的 `problems` 是**唯一**的判定出口，
 * 三样东西都进去 —— `undeclared`、`ambiguousAliases`、`ambiguousRefs`。
 * 「只报告歧义但仍视为闭合」被明确禁止：扫描器证明不了归属时，矩阵就是**没闭合**。
 * 保留 `undeclared` / `ambiguousAliases` / `ambiguousRefs` 三个原始字段，供诊断定位。
 *
 * ⚠️ **根对象守卫不算成员守卫（第四轮改制，独立复验 F02-R2）**：
 * `Ns ? Ns.m()` / `Ns && Ns.m()` 只证明命名空间根本身在，而每个根本身就是必需声明
 * ⇒ 这种形态下的 `m` 必须进声明表，不能进 `guardedRefs`。判定逻辑见 `isGuardedRef`；
 * 永久反例（真实 `feedbackApi ? feedbackApi.setupSteps(...)` 位置换未声明成员）留在
 * `test-boot-combination.js` 与 `parse-single-source.js` 的静态段。
 */
function runtimeDependencyCoverage(root, options) {
  const raw = (options && typeof options.source === "string")
    ? options.source
    : fs.readFileSync(path.join(root, "app-core.js"), "utf8");
  const code = stripComments(raw);

  const refs = new Map();
  /** 带**成员级**存在性守卫的引用：**允许**不在必需表里（它们是刻意的可选能力），单独报出供过目。
   * 注意：只短路了命名空间根（`Ns ? Ns.m()`）**不算**成员守卫 —— 根本身是必需声明，
   * 那种兜底要么无效、要么该显式检查成员（见 `isGuardedRef` 的说明）。 */
  const guardedRefs = new Map();
  /** 归因不了的别名引用（同名变量在别处指向别的东西）：**进 problems**，不再只报告。 */
  const ambiguousRefs = new Map();
  const aliasInfo = collectNamespaceAliases(code);
  const aliases = aliasInfo.resolved;
  const locals = NAMESPACE_LOCALS.concat(Object.keys(aliases)).concat(aliasInfo.ambiguous);
  const nsAlternation = locals
    .map(function (n) { return n.replace(/\$/g, "\\$"); })
    .sort(function (a, b) { return b.length - a.length; })   // 长的先匹配，避免 DatePrimitives 被 Date 之类截断
    .join("|");
  code.split("\n").forEach((line, i) => {
    const re = new RegExp("\\b(" + nsAlternation + ")\\.([A-Za-z_$][\\w$]*)", "g");
    let m;
    while ((m = re.exec(line)) !== null) {
      const local = m[1];
      const member = m[2];
      let prefix = null;
      if (NAMESPACE_PATHS[local] !== undefined) prefix = NAMESPACE_PATHS[local];
      else if (aliases[local] !== undefined) prefix = NAMESPACE_PATHS[aliases[local]];
      else if (aliasInfo.ambiguous.indexOf(local) >= 0) {
        const key0 = local + "." + member;
        if (!ambiguousRefs.has(key0)) ambiguousRefs.set(key0, []);
        ambiguousRefs.get(key0).push(i + 1);
        continue;
      }
      if (prefix === null) continue;
      // `Lib` 本身是模块注册表、`NativeReminders` 是独立模块全局 —— 两者都不是
      // `AttentionLib` 上的命名空间，所以「它自身也要声明」这条对它们不适用
      // （存在性由 `AttentionNativeReminders` 那条声明保证）。
      if (prefix !== "" && STANDALONE_ROOT_NAMESPACES.indexOf(prefix) < 0) {
        if (!refs.has(prefix)) refs.set(prefix, []);
        refs.get(prefix).push(i + 1);
      }
      const key = prefix === "" ? member : prefix + "." + member;
      const bucket = isGuardedRef(line, local + "." + member) ? guardedRefs : refs;
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key).push(i + 1);
    }
  });

  // 声明表按源码形状读取：["<path>", "<type>", ...]
  const declared = new Map();
  // 类型取值与运行时闸门一致：`typeof` 的名字（function / object / number / string /
  // boolean）外加 `array`（由 `Array.isArray` 判定）。白名单**必须**与闸门同源 ——
  // 若这里漏了一种类型，那一条声明会从 `declared` 里消失、引用变成 `undeclared`，
  // 于是「写对了、却报未声明」；反过来若这里多认了一种闸门不懂的类型，才是真漏洞
  // （第五轮 F02-R3 前，`array` 就还没进这张表）。
  const reTable = /\[\s*"([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)"\s*,\s*"(function|object|number|string|boolean|array)"/g;
  let t;
  while ((t = reTable.exec(raw)) !== null) {
    if (!declared.has(t[1])) declared.set(t[1], t[2]);
  }

  const undeclared = [];
  refs.forEach((lines, key) => {
    if (!declared.has(key)) undeclared.push({ path: key, lines: lines });
  });
  undeclared.sort((a, b) => (a.path < b.path ? -1 : 1));

  /**
   * **统一判定出口**：矩阵是否闭合，只看这个数组是不是空的。
   *
   * 三类问题，任何一类都算「没闭合」：
   *   · `undeclared-dependency` —— 真实引用但声明表里没有（执行到那一刻就 TypeError）；
   *   · `ambiguous-alias`      —— 同名局部变量既被赋成命名空间、又被赋成别的东西，
   *                              扫描器**无法**证明 `X.member` 到底属于谁；
   *   · `ambiguous-ref`        —— 落到上述别名上的具体引用，同样证不了归属。
   *
   * 后两类的意义：它们不是「已知安全」，而是「**未知**」。早先把它们归入
   * 「只报告、不判错」，等于让一条无法证明的路径冒充已证明的闭合 ——
   * 独立复验 F02 的反例就是从那里穿过去的。闭合检查必须 fail closed。
   */
  const problems = [];
  undeclared.forEach(u => problems.push(
    "undeclared-dependency:" + u.path + "（app-core.js:" + u.lines.join(",") + "）"));
  aliasInfo.ambiguous.forEach(a => problems.push(
    "ambiguous-alias:" + a + "（同一名字既被赋成已知命名空间、又被赋成别的东西）"));
  Array.from(ambiguousRefs.keys()).sort().forEach(k => problems.push(
    "ambiguous-ref:" + k + "（归属不可证明）"));

  /** 声明表里出现的类型取值（去重排序）—— 「写错类型」要能被**直接判缺少匹配**，
   *  而不是悄悄退化成「这条声明不存在」。 */
  const declaredTypes = Array.from(new Set(declared.values())).sort();
  const declaredTypeOf = {};
  Array.from(declared.entries()).sort().forEach(e => { declaredTypeOf[e[0]] = e[1]; });

  return {
    refs: Array.from(refs.keys()).sort(),
    declared: Array.from(declared.keys()).sort(),
    /** 路径 → 声明的类型（`array` 表示由 `Array.isArray` 判定的数组契约）。 */
    declaredTypeOf: declaredTypeOf,
    declaredTypes: declaredTypes,
    undeclared: undeclared,
    /** 带**成员级**守卫的引用（可选能力）：不进必需表不算错，但必须**可见**。
     *  根对象守卫（`Ns ? Ns.m()`）不算 —— 见 `isGuardedRef`。 */
    guardedRefs: Array.from(guardedRefs.keys()).sort(),
    /** 归因不了的别名引用（同名变量在别处另有含义）：**进 problems**，不再只报告。 */
    ambiguousRefs: Array.from(ambiguousRefs.keys()).sort(),
    /** 推导出来的局部别名（`feedbackApi` ⇒ `FeedbackLib`）—— 让人能核对归一没错。 */
    aliases: aliases,
    /** 同名变量既有「= 命名空间」又有「= 别的东西」⇒ 放弃归因 ⇒ **判定失败**。 */
    ambiguousAliases: aliasInfo.ambiguous,
    /** 唯一判定出口：`problems.length === 0` 才算闭合。 */
    problems: problems,
    /** 声明了但谁也没引用 —— 不算错，只是冗余，单独报出来供人工过目。 */
    unusedDeclarations: Array.from(declared.keys()).filter(k => !refs.has(k) && !guardedRefs.has(k)).sort()
  };
}

/**
 * 展示能力**实例 API** 的闭合检查（F02）。
 *
 * `appUi.$` 这类引用不是模块导出 —— 它们是 `createUi()` **返回对象**上的方法，
 * 所以不该进依赖声明表；但它们必须被检查。独立复验 F02 的反例
 * （`AppUi.createUi = () => ({})`）正是「工厂在、实例是空壳」：静态闭合判定与
 * `typeof createUi === "function"` 两样都看不出来，而页面会点不动、主体空白。
 *
 * **双向**判定：
 *   · 源码里用到的每个 `appUi.<成员>` 都必须在 `APP_UI_INSTANCE_CONTRACT` 里（否则闸门不检查它）；
 *   · 契约里的每一项也必须真的被用到（否则契约是句空话）。
 */
function instanceContractMembers(raw, contractName) {
  const declared = new Set();
  const internalOnly = new Set();
  const block = new RegExp("const\\s+" + contractName + "\\s*=\\s*\\{[\\s\\S]*?\\n  \\};").exec(raw);
  if (block) {
    const inst = /instance\s*:\s*\[([\s\S]*?)\]/.exec(block[0]);
    if (inst) {
      (inst[1].match(/"[A-Za-z_$][\w$]*"/g) || []).forEach(s => declared.add(s.replace(/"/g, "")));
    }
    const internal = /internalOnly\s*:\s*\[([\s\S]*?)\]/.exec(block[0]);
    if (internal) {
      (internal[1].match(/"[A-Za-z_$][\w$]*"/g) || []).forEach(s => internalOnly.add(s.replace(/"/g, "")));
    }
  }
  return { declared: declared, internalOnly: internalOnly };
}

/**
 * 工厂**实例 API** 的闭合检查（通用实现）。
 *
 * `factoryInstanceCoverage` 的两个调用方（`appUi` / `ai`）共用同一段判定 —— 判定逻辑
 * 只有一份，才不会出现「展示层查得严、AI 层查得松」这种分叉。
 *
 * `internalOnly`：契约里**只被模块内部消费**的成员（`chat` 被 `parseCapture` 调、
 * `systemPrompt` 被 `chat` 调…）。它们不在 `app-core` 里出现，但空壳实例少了它们
 * 一样会坏：点了「AI 理解」→ `runOnCapture` → `polishCapture` → `chat` 才 TypeError。
 * 所以必须留在 `instance` 里，同时单独登记为「内部消费」，
 * 免得把 `unusedInContract` 这条反向判据逼成一句空话。
 */
function factoryInstanceCoverage(root, options, spec) {
  const primaryRaw = (options && typeof options.source === "string")
    ? options.source
    : fs.readFileSync(path.join(root, "app-core.js"), "utf8");
  const sourcePaths = spec.sourcePaths || [];
  const extraRaw = sourcePaths.map(file => {
    if (options && options.sources && typeof options.sources[file] === "string") return options.sources[file];
    return fs.readFileSync(path.join(root, file), "utf8");
  });
  const raw = primaryRaw + (extraRaw.length ? "\n" + extraRaw.join("\n") : "");
  const code = stripComments(raw);

  const used = new Set();
  /**
   * 前一个字符**不能**是标识符字符、`$`、`.` 或 `-`。
   *
   * 只用 `\b` 会串味：`settings.ai.enabled` 会当成「用了 `ai.enabled`」，
   * `"lib/app-ai.js"` 会当成「用了 `ai.js`」（`-` 也算词边界）。结果是把**别的**成员
   * 算进 `used`，于是 `missingInContract` 报出一堆不存在的问题、真正漏掉的反而被淹没。
   */
  const re = new RegExp("(^|[^A-Za-z0-9_$.-])" + spec.local + "\\.([A-Za-z_$][\\w$]*)", "g");
  code.split("\n").forEach(line => {
    let m;
    while ((m = re.exec(line)) !== null) used.add(m[2]);
  });

  const contract = instanceContractMembers(raw, spec.contractName);

  const usedList = Array.from(used).sort();
  const declaredList = Array.from(contract.declared).sort();
  return {
    local: spec.local,
    contract: spec.contractName,
    used: usedList,
    declared: declaredList,
    internalOnly: Array.from(contract.internalOnly).sort(),
    missingInContract: usedList.filter(u => !contract.declared.has(u)),
    unusedInContract: declaredList.filter(d => !used.has(d) && !contract.internalOnly.has(d))
  };
}

function uiInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appUi", contractName: "APP_UI_INSTANCE_CONTRACT" });
}

/** P2-A：AI 实例 API 的闭合检查（同 `appUi` 那一条，判定逻辑共用）。 */
function aiInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "ai", contractName: "APP_AI_INSTANCE_CONTRACT", sourcePaths: ["lib/app-capture.js"] });
}

/** P2-C：备份实例 API 的闭合检查（同 `appUi` / `ai`，判定逻辑共用）。 */
function backupInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "backup", contractName: "APP_BACKUP_INSTANCE_CONTRACT" });
}

/** P2-D：诊断实例 API 的闭合检查（同 `appUi` / `ai` / `backup`，判定逻辑共用）。 */
function diagnosticsInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "diagnostics", contractName: "APP_DIAGNOSTICS_INSTANCE_CONTRACT" });
}

/** P2-E：设置实例 API 的闭合检查。 */
function setupInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appSetup", contractName: "APP_SETUP_INSTANCE_CONTRACT" });
}

/** P2-F1：内容实例 API 的双向闭合。 */
function contentInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appContent", contractName: "APP_CONTENT_INSTANCE_CONTRACT" });
}

/** P2-G1：capture 表单实例的双向闭合。 */
function captureInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appCapture", contractName: "APP_CAPTURE_INSTANCE_CONTRACT" });
}

/** P2-F2：展示实例 API 的双向闭合。 */
function viewsInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appViews", contractName: "APP_VIEWS_INSTANCE_CONTRACT" });
}

/** P3-A：事项模型实例 API 的双向闭合。 */
function modelInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appModel", contractName: "APP_MODEL_INSTANCE_CONTRACT" });
}

/** P3-B：持久化实例 API 的双向闭合。 */
function persistenceInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appPersistence", contractName: "APP_PERSISTENCE_INSTANCE_CONTRACT" });
}

/** P3-C：事务实例 API 的双向闭合。 */
function transactionInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appTransaction", contractName: "APP_TRANSACTION_INSTANCE_CONTRACT" });
}

/** P3-D：事项业务与周期实例 API 的双向闭合。 */
function itemInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appItems", contractName: "APP_ITEMS_INSTANCE_CONTRACT" });
}

/** P3-E：原生协调实例 API 的双向闭合。 */
function coordinatorInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appNativeCoordinator", contractName: "APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT" });
}

/** P3-F：待整理实例 API 的双向闭合。 */
function reviewInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appReview", contractName: "APP_REVIEW_INSTANCE_CONTRACT" });
}

/** P3-G：提醒与活动闹钟实例 API 的双向闭合。 */
function alertsInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appAlerts", contractName: "APP_ALERTS_INSTANCE_CONTRACT" });
}

/** P3-H：平台适配与 PWA 生命周期实例 API 的双向闭合。 */
function platformInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appPlatform", contractName: "APP_PLATFORM_INSTANCE_CONTRACT" });
}

/**
 * P3-I-R：告知实例（首页告知条 + 启动轻摘要）的双向闭合。
 *
 * 这三项都是**函数**，静态 `typeof` 只证明工厂存在，不证明实例上有它们 ——
 * 空壳实例上 `renderHomeNotice` 是 `undefined`，于是首页断链告警静默消失，
 * 而界面看起来完全正常（这正是 H-08 的形态）。所以成员名必须与契约逐项对齐。
 */
function noticesInstanceCoverage(root, options) {
  return factoryInstanceCoverage(root, options,
    { local: "appNotices", contractName: "APP_NOTICES_INSTANCE_CONTRACT" });
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
 * 为什么要它：`test-smoke.js` 与 `test-regressions.js` 从前都**没有**把
 * `lib/native-reminders.js` 放进沙箱（regressions 只在宿主 `require` 它做专项测试）。
 * 于是这两套里 `AttentionNativeReminders` 恒为 `undefined`，app-core 走 `|| {}` 兜底
 * 而**一切照常变绿** —— 独立复验 F01 证明：那条「有意的缺席」就是缺陷的藏身处。
 *
 * 现在两套都加载完整生产清单（F01 修复的一部分）。本函数仍是**读取**口：
 * 把「加载了什么」变成可断言的事实 —— 谁增删了这些列表，调用方的断言就会变红。
 *
 * 提取方式是各自源码里**唯一的**加载语法，不是全文搜 `lib/*.js` 字面量 ——
 * 后者会把注释与断言文案里的提及一起数进来。
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

/**
 * 依赖声明表允许的类型取值（= 读表正则 + 运行时闸门支持的集合）。
 *
 * 两者必须同源。这里少了任何一种 ⇒ 写对的声明会从 `declared` 里消失，引用变成
 * `undeclared`（响，但提示错方向）；这里多认一种、而闸门不认 ⇒ 是静默放行，
 * 第五轮 F02-R3 之前正是这种状态（`Feedback.TEST_FEEDBACK` 的 `array` 契约）。
 */
const CONTRACT_TYPES = ["array", "boolean", "function", "number", "object", "string"];

module.exports = {
  CONTRACT_TYPES: CONTRACT_TYPES,
  SCRIPT_SHAPE: SCRIPT_SHAPE,
  LOAD_TIME_DEPENDENCIES: LOAD_TIME_DEPENDENCIES,
  NAMESPACE_PATHS: NAMESPACE_PATHS,
  runtimeDependencyCoverage: runtimeDependencyCoverage,
  uiInstanceCoverage: uiInstanceCoverage,
  aiInstanceCoverage: aiInstanceCoverage,
  backupInstanceCoverage: backupInstanceCoverage,
  diagnosticsInstanceCoverage: diagnosticsInstanceCoverage,
  setupInstanceCoverage: setupInstanceCoverage,
  contentInstanceCoverage: contentInstanceCoverage,
  captureInstanceCoverage: captureInstanceCoverage,
  viewsInstanceCoverage: viewsInstanceCoverage,
  modelInstanceCoverage: modelInstanceCoverage,
  persistenceInstanceCoverage: persistenceInstanceCoverage,
  transactionInstanceCoverage: transactionInstanceCoverage,
  itemInstanceCoverage: itemInstanceCoverage,
  coordinatorInstanceCoverage: coordinatorInstanceCoverage,
  reviewInstanceCoverage: reviewInstanceCoverage,
  alertsInstanceCoverage: alertsInstanceCoverage,
  platformInstanceCoverage: platformInstanceCoverage,
  noticesInstanceCoverage: noticesInstanceCoverage,
  factoryInstanceCoverage: factoryInstanceCoverage,
  stripComments: stripComments,
  readIndexScripts: readIndexScripts,
  readSwAssets: readSwAssets,
  inspectList: inspectList,
  coverageProblems: coverageProblems,
  precacheProblems: precacheProblems,
  packagingProblems: packagingProblems,
  readHarnessLoadSets: readHarnessLoadSets
};
