/* 安心收件箱 — Local-first attention hub
 * 原则：Attention ≠ Task · Acknowledged ≠ Completed · Future 默认不可见
 */
(function () {
  "use strict";

  const KEY = "attention-inbox-v2";
  // D43：schema 5 = 事项新增 `reminderEvents`（单次提醒台账，与 deadlineEvents 同构）。
  // 旧记录缺这个字段时由 normalizeItem 补 `{}`；`schemaMigrationNeeded` 触发一次重写落库。
  const SCHEMA = 5;
  const Lib = (typeof AttentionLib !== "undefined" && AttentionLib) || {};

  /* ---------- 运行时依赖：**唯一装配入口**（P1 / 独立复验 F01–F03） ---------- */

  /**
   * 这一段只做一件事：**在业务启动之前，把「模块在不在」变成一次可枚举的检查，
   * 并且把检查通过的那批值当场绑到下面的局部名上。**
   *
   * 为什么检查与绑定必须在同一处（F03）：从前这些名字是在 IIFE 顶部用 `const`
   * 从 `AttentionLib` 抓一次就固定下来的，而闸门读的是**实时** `Lib` —— 两者可以
   * 不是同一个函数，于是出现「启动成功、能输入、保存报错」：
   *   · 首次缺 `lib/parse-cn.js` ⇒ 闸门失败；用户补上脚本后点「重试」⇒ 闸门这次看到
   *     完整的 `Lib` 于是放行，而 `parseChineseTime` 仍是 `undefined`；
   *   · `index.html` 把 `parse-cn.js` 排在 `app-core.js` 之后 ⇒ 本文件求值时抓不到，
   *     闸门却在 `DOMContentLoaded` 之后才跑、那时 `Lib` 已完整 ⇒ 同样放行、同样不可用。
   * 现在**校验与装配共用同一批依赖**：`bindRuntime()` 检查的就是它即将绑定的那个值。
   *
   * 绑定一律用 `let`（不是 `const`）—— 这正是为了让「重试」能**重建**它们。
   * 失败时**不覆盖**既有绑定：应用要么带着一套完好的依赖跑，要么停在失败面板上。
   *
   * `isFeedbackSuppressed` 必须按**取值函数**注入：装配发生在业务启动之前，那一刻
   * `suppressUserFeedback` 必然是 `false`；按值传会把整段重放期的抑制逻辑钉死成
   * 「永不抑制」，等于把 M1 的重复提示问题放回来。
   */
  let AppUi = null;
  let appUi = {};
  // P2-A：AI 能力（`lib/app-ai.js`）。命名空间与实例**分开**绑定，理由同 `AppUi`：
  // 重试时必须整套换新，而 `ai == null` 时「AI 理解」按钮会静默没反应 —— 那是本轮
  // 反例要拦的第二种形态，所以实例也要进装配契约（见 `APP_AI_INSTANCE_CONTRACT`）。
  let AppAi = {};
  let ai = null;
  // P2-C：数据备份（`lib/app-backup.js`）。同一条规矩：命名空间与实例分开绑定，
  // 实例进装配契约（见 `APP_BACKUP_INSTANCE_CONTRACT`）—— 备份按钮绑到 `undefined`
  // 上是「点了没反应」的静默形态，必须由闸门在开门前拦下。
  let AppBackup = {};
  let backup = null;
  // P2-D：通知实验室 / 投递判读 / 闹钟 trace / 系统设置诊断（`lib/app-diagnostics.js`）。
  // 命名空间与实例分开绑定：缺脚本要能点名 AppDiagnostics；空壳实例要能点名合同成员。
  let AppDiagnostics = {};
  let diagnostics = null;
  let AppSetup = {};
  let appSetup = null;
  // P2-F1：笔记、项目与搜索由 `lib/app-content.js` 的同一实例承接。
  let AppContent = {};
  let appContent = null;
  // P2-F2：展示实例与内容实例同样按「命名空间 + 已验证实例」分开绑定。
  let AppViews = {};
  let appViews = null;
  let $ = null;
  let $$ = null;
  let openSheet = null;
  let closeSheet = null;
  let closeAllSheets = null;
  let confirmDialog = null;
  let toast = null;
  let hideToast = null;
  // UX-T01/T02/A01/A03：反馈与动作语义的纯逻辑层（判定全在 lib，编排只在这里）
  let FeedbackLib = null;
  // UX-T03：原生送达证据的合并与事后核查判定
  let EvidenceLib = null;
  let storage = null;
  // 命名空间（lib/date-utils.js / lib/ui-format.js）
  let DatePrimitives = {};
  let UiFormat = {};
  // 扁平导出（lib/repeat.js / lib/parse-cn.js / lib/reminder.js 的命名空间成员）
  let NativeReminders = {};
  let safeExternalHref = null;
  let startOfDay = null;
  let endOfDay = null;
  let addDays = null;
  let sameDay = null;
  let nextWeekend = null;
  let applyClock = null;
  let lastDayOfMonth = null;
  let nthWeekdayInMonth = null;
  let weekdayOfNextWeek = null;
  let dayOfMonthIn = null;
  let nextDayOfMonth = null;
  let nextRepeatTrigger = null;
  let repeatLabel = null;
  let nextRepeatPreview = null;
  let parseChineseTime = null;
  let cnInt = null;
  let hasSpecificTimeWord = null;
  let storageReady = false;
  /**
   * **权威状态三态**（P2-C-R）。
   *
   * 旧实现把「权威后端读到空」「打开/读取/解析/回放失败后镜像也拿不到」**折叠成同一个
   * `false`**，而 `init()` 又不看这个返回值照样往下走 —— 于是「没有确认恢复成功」
   * 和「确认从未有数据」在下游完全无法区分，两者都会开放保存、原生对账与业务心跳。
   * 真机上的表现就是：界面照常可用、内存里是一份空收件箱、而它随时可能被写成新的权威快照。
   *
   * 现在把这件事显式命名，`loaded` / `empty` 才代表「权威状态已确认」：
   *   · `loaded` —— 读到并**应用**了权威状态（IDB，或权威读失败后由镜像恢复）；
   *   · `empty`  —— 权威后端**成功读取**且确认从未存在状态（镜像也确认为空）；
   *   · `failed` —— 打开 / 读取 / 解析 / 回放 / 镜像恢复失败 ⇒ **写闸门关闭**，
   *     不写权威存储、不排通知、不启业务心跳，显示可见的恢复面板等重试。
   */
  const LOAD_LOADED = "loaded";
  const LOAD_EMPTY = "empty";
  const LOAD_FAILED = "failed";
  /** 恢复之前一律视为**未确认**（不等于 failed：加载进行中不该被当成故障）。 */
  const LOAD_UNCONFIRMED = "unconfirmed";
  let stateAuthority = LOAD_UNCONFIRMED;
  /** 最近一次恢复尝试的判定（`init()` / 恢复面板 / 测试与真机探针读它）。 */
  let lastLoadReport = null;
  let loadAttempts = 0;
  /** 被写闸门拦下的提交次数（`failed` 期间必须恒为 0 次真实落库 + 可见的拦截计数）。 */
  let blockedWriteCount = 0;
  let schemaMigrationNeeded = false;
  let nativeReady = false;
  let nativeSyncTimer = null;
  // Q6：原生初始化的 in-flight promise。
  // 保证「同一时刻只有一次初始化在跑」，同时**允许失败后重试**
  // （跑完置回 null，下一次请求会再试一遍）。
  let nativeInitPromise = null;
  // L01 / L05：时间来源必须可区分 —— 「用户手选」不能被解析器或系统兜底悄悄覆盖
  let triggerUserPicked = false;
  let reviewTriggerUserPicked = false;
  /**
   * 事项表单的**会话序号**（R-F03）。
   *
   * 每次 `resetItemSheet()`（新建 / 编辑 / 保存后复位）自增。异步回来的结果靠它回答
   * 「现在这张表单还是不是当初提交的那一张」—— 只看内容签名不够：用户关掉重开后
   * 可能又输入了一模一样的内容，那是**另一张**表单，旧结果无权回填或清空它。
   */
  let itemFormSession = 0;
  let nativeReminderStatus = {
    native: false,
    notifications: "unknown",
    exactAlarm: "unknown",
    reliability: "web"
  };

  /* ---------- 装配依赖闸门（P1：启动前唯一收口） ---------- */

  /**
   * **必需的运行时导出**（声明表）。
   *
   * 为什么必须有这张表：拆分之后，「某个 `lib/*.js` 没加载 / 顺序错 / 文件损坏」的后果
   * 只是 `AttentionLib` 上少几个键。而 app-core 里到处是 `Lib.xxx`、`FeedbackLib ? … : null`
   * 这类写法 —— 缺件**不抛错**，只会静默换一套规则继续跑：界面照常可点、数据永不落库。
   * 四套业务 harness 也照绿，因为它们在沙箱里注入的是自己那份模块。
   *
   * 所以唯一能拦住它的位置是「业务启动之前」：把必需项写成可枚举的声明，
   * 逐项检查存在性与类型，缺任何一项就**明确失败**并停在原地。
   *
   * 刻意**只排除** `Capacitor`：那是原生 WebView 注入的平台桥，纯 Web 里本来就不存在，
   * 缺席是**正常状态**而不是装配错误。`AttentionNativeReminders` **不在**排除之列 ——
   * 它是我们自己发的 JS 模块（见下面 F01 那一段）。
   *
   * 每项格式：`[路径, 期望类型, 缺了会怎样]`（第 4 列可选，见下）。第三项会原样出现在
   * 失败面板上，让用户看到的不是「undefined is not a function」而是「哪一支脚本没起来、后果是什么」。
   *
   * **期望类型**分两类：
   *   · `typeof` 的名字 —— `function` / `object` / `number` / `string` / `boolean`；
   *   · `array` —— 由 `Array.isArray` 判定。**不能**用 `object` 顶替：`typeof [] === "object"`，
   *     而真实消费者常常直接 `.map(...)`。只按 `object` 校验时，导出变成 `{}` 的应用会
   *     宣告就绪，进到那一屏才抛 `list.map is not a function` —— 第四次独立复验 F02-R3
   *     的阻断形态（run `20260921T052806`）。
   *
   * **第 4 列（可选）元素形状**：数组每个元素必须具备的属性名清单。容器对不等于元素对 ——
   * 元素是 `{}` 时照样界面少一排按钮，仍然是静默降级。声明了元素形状的数组还不允许为空。
   */
  const REQUIRED_RUNTIME_EXPORTS = [
    ["DatePrimitives", "object",
      "lib/date-utils.js 未加载（或不在其它 lib 之前）——日历原语唯一来源，解析与周期推进都靠它"],
    ["DatePrimitives.startOfDay", "function", "lib/date-utils.js 导出被破坏"],
    ["DatePrimitives.endOfDay", "function", "lib/date-utils.js 导出被破坏"],
    ["DatePrimitives.addDays", "function", "lib/date-utils.js 导出被破坏"],
    ["DatePrimitives.sameDay", "function", "lib/date-utils.js 导出被破坏"],
    ["DatePrimitives.nextWeekend", "function", "lib/date-utils.js 导出被破坏"],
    ["DatePrimitives.applyClock", "function", "lib/date-utils.js 导出被破坏"],
    ["DatePrimitives.lastDayOfMonth", "function", "lib/date-utils.js 导出被破坏"],
    ["DatePrimitives.nthWeekdayInMonth", "function", "lib/date-utils.js 导出被破坏"],
    ["DatePrimitives.weekdayOfNextWeek", "function", "lib/date-utils.js 导出被破坏"],
    ["DatePrimitives.dayOfMonthIn", "function", "lib/date-utils.js 导出被破坏"],
    ["DatePrimitives.nextDayOfMonth", "function", "lib/date-utils.js 导出被破坏"],
    ["DatePrimitives.nthWeekdayOfNextMonthByInstant", "function",
      "首期候选语义（按具体时刻比较）缺失 —— 与周期推进的「按日比较」不能混用"],
    ["DatePrimitives.nthWeekdayOfNextMonthByDay", "function",
      "周期推进语义（按日比较）缺失 —— 拿首期候选那支顶上会让周期原地打转"],
    ["UiFormat", "object",
      "lib/ui-format.js 未加载（或在 lib/date-utils.js 之前）—— 所有时间/转义/Markdown 显示都会退化"],
    ["UiFormat.pad", "function", "lib/ui-format.js 导出被破坏（补零）"],
    ["UiFormat.uid", "function", "lib/ui-format.js 导出被破坏（事项 id 生成）"],
    ["UiFormat.escapeHtml", "function", "lib/ui-format.js 导出被破坏（文本转义）"],
    ["UiFormat.escapeAttr", "function", "lib/ui-format.js 导出被破坏（属性转义）"],
    ["UiFormat.fmtTime", "function", "lib/ui-format.js 导出被破坏（时间显示）"],
    ["UiFormat.fmtDate", "function", "lib/ui-format.js 导出被破坏（日期显示）"],
    ["UiFormat.relDue", "function", "lib/ui-format.js 导出被破坏（相对到期显示）"],
    ["UiFormat.dayLabel", "function", "lib/ui-format.js 导出被破坏（归档日标签）"],
    ["UiFormat.toLocalInput", "function", "lib/ui-format.js 导出被破坏（时间输入框回填）"],
    ["UiFormat.parseLocalInput", "function", "lib/ui-format.js 导出被破坏（时间输入框取值）"],
    ["UiFormat.renderMarkdown", "function", "lib/ui-format.js 导出被破坏（Markdown 渲染）"],
    ["AppUi", "object",
      "lib/app-ui.js 未加载 —— DOM 查询/弹层/toast/确认框全部失效：界面看似能渲染，但点不动、也没有任何反馈"],
    ["AppUi.createUi", "function", "lib/app-ui.js 导出被破坏（展示能力装配入口）"],
    ["AppUi.safeExternalHref", "function",
      "lib/app-ui.js 导出被破坏 —— 外链协议白名单失效：`javascript:` / `data:` 这类用户数据可能被渲染成可点 href"],
    /* --- P2-A：`lib/app-ai.js` 是 AI 能力的唯一实现 ---
     *
     * 缺它的后果不是「AI 不可用」这么笼统，而是三处具体的静默：
     *   · 「AI 理解 / 润色」按钮点了**没反应**（`runOnCapture` 不存在，监听器绑不上）；
     *   · 「我的 → AI 智能理解」那一行小字永远是「未开启」，而用户其实配过；
     *   · 保存时的自动增强整段跳过 —— 事项照常存，只是不再有 AI 补的时间。**不报错**。
     * 所以和 `AppUi` 一样，命名空间 + 工厂 + **实例契约**三层都要在开门前核对。
     */
    ["AppAi", "object",
      "lib/app-ai.js 未加载 —— AI 理解/润色与 AI 设置页整体失效：" +
      "按钮点了没反应、「我的」页那行小字恒为「未开启」、保存时不再自动补时间，且不报错"],
    ["AppAi.createAppAi", "function", "lib/app-ai.js 导出被破坏（AI 能力装配入口）"],
    ["AppAi.normalizeAiResult", "function",
      "lib/app-ai.js 导出被破坏 —— AI 结果归一失效：" +
      "模型返回的周期与优先级会**原样**进事务（越权优先级会绕过重要档的渠道规则）"],
    ["AppAi.extractJsonObject", "function",
      "lib/app-ai.js 导出被破坏 —— 模型回复里的 JSON 剥不出来，AI 结果整体被当成失败回退本地解析"],
    ["AppBackup", "object",
      "lib/app-backup.js 未加载 —— 数据备份整体失效：「导出」与「导入」按钮点了没反应，" +
      "且没有任何报错 —— 用户会以为备份好了，其实什么都没发生"],
    ["AppBackup.createAppBackup", "function", "lib/app-backup.js 导出被破坏（备份能力装配入口）"],
    /* --- P2-D：`lib/app-diagnostics.js` 是诊断能力的唯一实现 ---
     *
     * 缺它的后果不是「诊断不可用」这么笼统，而是三处具体的静默：
     *   · 通知实验室与 setup 的投递判读走空路径（转发时 TypeError 或 no-op）；
     *   · setup 停止测试时取消闹钟、写日志失去唯一入口；
     *   · `__ATTENTION_INBOX__.describeAlarmDelivery` 不再指向同一实例。
     * 所以命名空间 + 工厂 + 实例契约三层都要在开门前核对。
     */
    ["AppDiagnostics", "object",
      "lib/app-diagnostics.js 未加载 —— 通知实验室、投递判读、闹钟 trace 与系统设置诊断整体失效：" +
      "诊断面板点不开或点了没反应，setup 的测试日志与取消闹钟也失去入口"],
    ["AppDiagnostics.createAppDiagnostics", "function",
      "lib/app-diagnostics.js 导出被破坏（诊断能力装配入口）"],
    ["AppSetup", "object", "lib/app-setup.js 未加载 —— 首次提醒设置与 60 秒测试整体失效"],
    ["AppSetup.createAppSetup", "function", "lib/app-setup.js 导出被破坏（设置能力装配入口）"],
    ["AppContent", "object", "lib/app-content.js 未加载 —— 笔记、项目与搜索入口整体失效"],
    ["AppContent.createAppContent", "function", "lib/app-content.js 导出被破坏（内容能力装配入口）"],
    ["AppViews", "object", "lib/app-views.js 未加载 —— 首页、未来、笔记、我的和详情展示整体失效"],
    ["AppViews.createAppViews", "function", "lib/app-views.js 导出被破坏（展示能力装配入口）"],
    ["parseChineseTime", "function",
      "lib/parse-cn.js 未加载 —— 中文时间解析唯一来源，缺了「明天 9 点」这类输入将全部解析不出时间"],
    ["cnInt", "function", "lib/parse-cn.js 导出被破坏（中文数字）"],
    ["hasSpecificTimeWord", "function", "lib/parse-cn.js 导出被破坏（是否含明确时间词）"],
    ["nextRepeatTrigger", "function",
      "lib/repeat.js 未加载 —— 周期推进唯一来源，缺了所有重复事项的下一轮都将算不出来"],
    ["repeatLabel", "function", "lib/repeat.js 导出被破坏（周期文案）"],
    ["nextRepeatPreview", "function", "lib/repeat.js 导出被破坏（预演时刻）"],
    ["createStorage", "function",
      "lib/storage.js 未加载 —— 持久化后端建不起来，读写的都是内存副本，重启即丢"],
    ["hasIdb", "function",
      "lib/storage.js 导出被破坏 —— 无法判断当前是否跑在降级后端上，降级期保护会静默失效"],
    ["deadlineStageKey", "function",
      "lib/reminder.js 未加载 —— 截止保护阶段身份丢失（p24 / p2 判定会静默换标准）"],
    ["deadlineStagePoints", "function",
      "lib/reminder.js 未加载 —— 截止保护只排得出一个点（丢掉 p2 档）"],
    // ↑ `deadlineStagePoints` 的直接消费者是 `lib/native-reminders.js`（且被它当作
    //   「AttentionLib 是不是真货」的判据之一），app-core 自己不调它。
    //   仍在这里声明，是因为它和 `deadlineStageKey` 同属 `lib/reminder.js`：
    //   该模块缺席时两者一起没，分列两条只是把「后果」写到最贴切的位置。
    //   `runtimeDependencyCoverage()` 会把它报成 unusedDeclarations —— 那是**已知的**
    //   冗余，不是漏洞（闭合判定只看 `problems`，冗余不进 problems）。
    ["inQuietHours", "function", "lib/reminder.js 导出被破坏（免打扰时段判定）"],
    ["quietEnd", "function", "lib/reminder.js 导出被破坏（免打扰结束时刻）"],
    ["applyWindowTrigger", "function",
      "lib/reminder.js 导出被破坏 —— 柔性窗口不再生效：带 windowStart/End 的事项会按硬时刻触发"],
    ["shouldRealert", "function",
      "lib/reminder.js 导出被破坏 —— 重要事项的重复提醒会**整体不再触发**（判定被静默转成 false）"],
    ["markReminded", "function",
      "lib/reminder.js 导出被破坏 —— 重复提醒台账不落，下一拍会把同一事项再当「未提醒」重新弹"],
    ["Feedback", "object",
      "lib/feedback.js 未加载（或整个模块是 null）—— 动作语义与撤销窗口缺失，撤销会退化成兜底时长"],
    ["Feedback.actionSpec", "function", "lib/feedback.js 导出被破坏（动作语义）"],
    ["Feedback.setupSteps", "function",
      "lib/feedback.js 导出被破坏 —— 「提醒还没准备好」的设置向导会整块消失（不报错，只是少几步）"],
    ["Feedback.testFeedbackVerdict", "function", "lib/feedback.js 导出被破坏（测试反馈判定）"],
    ["Feedback.saveFeedback", "function", "lib/feedback.js 导出被破坏（反馈落库）"],
    /* --- 下面两条是**别名改制后才浮出来**的真实依赖（2026-09-21 第三轮）---
     *
     * 它们一直是必需的：`keepDraftForRetry` 要 `saveFeedback`、`feedbackVerdictFor`
     * 与 `finishFeedbackWait` 要 `reminderFeedback`、`renderCaptureSummary` 要
     * `captureSummary`。但在 `const f = FeedbackLib` 的时代，扫描器因为 `f` 另有含义
     * 把**全部** `f.*` 丢进「只报告、不判错」的桶里，于是这两条既没进 refs、也没进声明表 ——
     * 矩阵看起来是闭合的，实际漏了两条真依赖。
     * 消除短别名 + 扫描器遇到歧义即失败之后，它们立刻以 `undeclared` 现形。
     */
    ["Feedback.captureSummary", "function",
      "lib/feedback.js 导出被破坏 —— 新建页的「这一条会怎么提醒你」摘要会消失（不报错，只是不显示）"],
    ["Feedback.reminderFeedback", "function",
      "lib/feedback.js 导出被破坏 —— 保存后的结论行整块失效：只剩兜底的「尚未确认」"],
    /* --- 下面两条是**根对象守卫改制后才浮出来**的真实依赖（2026-09-21 第四轮）---
     *
     * `FeedbackLib ? FeedbackLib.TEST_FEEDBACK : [...]` 与
     * `(FeedbackLib && FeedbackLib.UNDO_WINDOW_MS) || 8000` 里的 `?` / `&&`
     * 只证明**模块对象**在，不证明成员在 —— 而 `Feedback` 根本身就是上面的必需声明，
     * 闸门已经保证它存在，所以那两个短路永远走真分支，成员缺失时静默走兜底
     * （撤销窗口退回 8000、测试反馈清单退回硬编码数组），界面上看不出来。
     *
     * 扫描器曾把「根对象守卫」当成「成员守卫」豁免，于是只换成员名就能绕过矩阵
     * —— 独立复验 F02-R2 的反例正是这么穿过去的（`undeclared=[] problems=[]`）。
     * 现在只有**检查成员本身**的形态才算守卫，这两条随之以 `undeclared` 现形。
     */
    /* 这两个成员是**清单常量**，`typeof` 分辨不了形状：
     * `TEST_FEEDBACK` 的真实消费者 `testFeedbackButtonsHtml()` 直接
     * `list.map(x => … x.value … x.label …)`，所以契约写的是「每项带 value/label 的非空数组」；
     * 只写 `object` 时，`{}` 会让应用宣告就绪、进到向导那一屏才崩。`UNDO_WINDOW_MS`
     * 同理 —— 写成字符串时 `(FeedbackLib && x) || 8000` 会把一串字符赋给减数补间。 */
    ["Feedback.TEST_FEEDBACK", "array",
      "lib/feedback.js 导出被破坏 —— 测试反馈清单静默退回硬编码数组，与真实动作语义脱节；" +
      "形状不对（缺 value/label 或不是数组）时该界面直接崩",
      ["value", "label"]],
    ["Feedback.UNDO_WINDOW_MS", "number",
      "lib/feedback.js 导出被破坏 —— 完成态撤销窗口静默退回 8000，与库里配置的时长不一致"],
    ["DeliveryEvidence", "object",
      "lib/delivery-evidence.js 未加载（或整个模块是 null）—— 送达证据无法合并，「提醒结果」这一行会消失"],
    ["DeliveryEvidence.mergeEvidence", "function", "lib/delivery-evidence.js 导出被破坏（证据合并）"],
    ["DeliveryEvidence.normalizeEvidence", "function",
      "lib/delivery-evidence.js 导出被破坏 —— 原生回读的证据一行都归一不了（调用点才发现 TypeError）"],
    ["DeliveryEvidence.evidenceStatusFor", "function", "lib/delivery-evidence.js 导出被破坏（证据状态判定）"],
    ["DeliveryEvidence.entryRoundBase", "function",
      "lib/delivery-evidence.js 导出被破坏 —— 轮次身份会静默退回「本条自己的时刻」，三态台账就对不上轮了"],

    /* --- F01：`lib/native-reminders.js` 是**必需的 JS 模块**，不是可选的平台桥 ---
     *
     * 从前它与 `Capacitor` 一起被排除在闸门之外，理由是「原生桥是旁路能力，纯 Web
     * 里本来就不存在」。这条理由只对 `Capacitor`（由原生 WebView 注入）成立：
     * `lib/native-reminders.js` 是**我们自己发的**一支脚本，`index.html` 里始终加载，
     * 而且在任何平台都会往全局写上 `AttentionNativeReminders`（UMD 无条件导出）。
     * 于是「Android 上它没起来」不会被任何东西拦住 —— 事项照存照改、一条提醒都不排，
     * 而失败面板也不出现（独立复验 F01 的实测形态）。
     */
    ["AttentionNativeReminders", "object",
      "lib/native-reminders.js 未加载 —— Android 上通知与闹钟排程整体失效：" +
      "事项能存能改，但一条提醒都不会响（这不是「纯 Web 的正常降级」）"],
    ["NativeReminders.isNativeAndroid", "function",
      "lib/native-reminders.js 导出被破坏 —— 平台判定没了，原生初始化会**静默**跳过（整场会话一次对账都不跑）"],
    ["NativeReminders.initialize", "function", "lib/native-reminders.js 导出被破坏（原生初始化入口）"],
    ["NativeReminders.reconcile", "function", "lib/native-reminders.js 导出被破坏（对账入口）"],
    ["NativeReminders.buildDesired", "function", "lib/native-reminders.js 导出被破坏（期望计划构建）"],
    ["NativeReminders.migrateItem", "function", "lib/native-reminders.js 导出被破坏（原生时间字段迁移）"],
    ["NativeReminders.onAlarmAction", "function", "lib/native-reminders.js 导出被破坏（全屏闹钟动作监听）"],
    ["NativeReminders.drainAlarmActions", "function", "lib/native-reminders.js 导出被破坏（动作排空）"],
    ["NativeReminders.getPermissionState", "function", "lib/native-reminders.js 导出被破坏（权限状态）"],
    ["NativeReminders.requestNotificationPermission", "function", "lib/native-reminders.js 导出被破坏（通知权限申请）"],
    ["NativeReminders.openExactAlarmSettings", "function", "lib/native-reminders.js 导出被破坏（精确闹钟设置入口）"],
    ["NativeReminders.getDeliveryEvidence", "function", "lib/native-reminders.js 导出被破坏（送达证据回读）"],
    ["NativeReminders.systemBridge", "function", "lib/native-reminders.js 导出被破坏（系统桥入口）"],
    ["NativeReminders.suppressPastReminderReplay", "function",
      "lib/native-reminders.js 导出被破坏 —— 过去的提醒会被当成新触发重放一遍"],

    /* --- F02：`AttentionLib` 本身也必须存在 ---
     * 逐成员检查在「整个 AttentionLib 缺席」时当然也会报，但那条报错长在某个具体成员上，
     * 读起来像「某一支坏了」。这一条把它说清楚：是**一支都没起来**。
     */
    ["AttentionLib", "object",
      "lib/*.js 一支都没加载（或 `index.html` 的脚本清单被破坏）—— 解析/周期/存储全部缺失"]
  ];

  /**
   * `AppUi` 的**工厂实例契约**（F02 的第 4 项）。
   *
   * 「`createUi` 是函数」不足以说明展示能力装好了：`createUi: () => ({})` 同样通过，
   * 而后果是 `$` / `toast` 全是 `undefined` —— 界面渲染得出来、点下去什么都不发生，
   * 且**旧实现照样放行**（独立复验实测：ready=false、无失败面板、页面主体空白）。
   * 所以这里连「工厂返回的实例上有没有那几个 API」一起检查。
   *
   * 探测用的实例是**真的那个**（同一个 deps、同一个对象），不另造一个再丢掉 ——
   * 否则「检查过的」与「用的」又不是同一份了。
   */
  const APP_UI_INSTANCE_CONTRACT = {
    factory: "AppUi.createUi",
    instance: ["$", "$$", "openSheet", "closeSheet", "closeAllSheets",
      "confirmDialog", "toast", "hideToast"],
    instanceWhy: "lib/app-ui.js 的 createUi 返回的实例缺少展示 API —— " +
      "界面看似能渲染，但点不动、也没有任何反馈",
    factoryThrowWhy: "lib/app-ui.js 的 createUi 抛了异常 —— 展示能力装不上，" +
      "界面点不动、也没有反馈"
  };

  /**
   * `AppAi` 的**工厂实例契约**（P2-A，同 `APP_UI_INSTANCE_CONTRACT` 的写法）。
   *
   * `createAppAi: () => ({})` 同样能通过「工厂是函数」这一条，而后果是所有 AI 入口
   * 变成**绑不上的监听器**：`$("#btnAiParse").addEventListener(..., () => ai.runOnCapture("parse"))`
   * 里 `ai.runOnCapture` 是 `undefined`，点击时才报 TypeError —— 静态闭合、`typeof`
   * 检查、甚至启动本身全都看不出来。所以实例上的每个 API 都在这里点名。
   *
   * `isBusy` 也在契约里：它是「在途请求闸门」唯一的可观测出口，测试要能断言
   * 「第二次点击被挡住」，而这条断言在空壳实例上会变成假绿（busy 永远是假）。
   */
  const APP_AI_INSTANCE_CONTRACT = {
    factory: "AppAi.createAppAi",
    instance: ["config", "ready", "nowIso", "systemPrompt", "chat",
      "parseCapture", "polishCapture", "testConnection",
      "applyToForm", "mergedDraft", "isBusy", "runOnCapture",
      "openAiSheet", "saveAiSettings", "renderAiSub"],
    /**
     * 只被**模块内部**消费的成员（`chat` → `parseCapture` / `polishCapture`、
     * `systemPrompt` → `chat`、`nowIso` → `systemPrompt`）。
     *
     * 它们不在本文件里出现，但空壳实例少了它们一样会坏：点「AI 理解」要到
     * `runOnCapture → polishCapture → chat` 才 TypeError —— 启动与静态检查都看不见。
     * 所以留在 `instance` 里，同时单独登记为「内部消费」，
     * 免得把 `unusedInContract`（契约里每一项都得真被用到）这条反向判据逼成空话。
     */
    internalOnly: ["chat", "nowIso", "polishCapture", "systemPrompt"],
    instanceWhy: "lib/app-ai.js 的 createAppAi 返回的实例缺少 AI API —— " +
      "「AI 理解」按钮点了没反应、保存时不再自动补时间，且不报错",
    factoryThrowWhy: "lib/app-ai.js 的 createAppAi 抛了异常 —— AI 能力装不上，" +
      "相关按钮点了没反应，也不会提示去配置"
  };

  /**
   * 备份实例契约（P2-C）。四个成员全是**用户可直接触发的入口**：
   *   · `exportData` —— `#btnExport` 的监听目标；
   *   · `importDataFile` —— `#importFile` change 的处理者；
   *   · `noteExportAppVisibility` —— blur/focus/visibilitychange 驱动的宽限闸门；
   *   · `buildLegacyBackupPayload` —— 测试 hook 取真实快照的入口。
   * 空壳实例上四个都是 `undefined`：监听器绑到 `undefined` 上点击才 TypeError，
   * 而备份是「低频但要命」的操作 —— 用户以为备份好了，其实什么都没发生。
   * 所以和 AI 一样，实例的每个 API 都要在开门前点名。
   */
  const APP_BACKUP_INSTANCE_CONTRACT = {
    factory: "AppBackup.createAppBackup",
    instance: ["exportData", "importDataFile", "noteExportAppVisibility",
      "buildLegacyBackupPayload"],
    instanceWhy: "lib/app-backup.js 的 createAppBackup 返回的实例缺少备份 API —— " +
      "「导出 / 导入」按钮点了没反应，且不报错",
    factoryThrowWhy: "lib/app-backup.js 的 createAppBackup 抛了异常 —— 备份能力装不上，" +
      "导出与导入都不会有任何反馈"
  };

  /**
   * 诊断实例契约（P2-D）。core 真正调用的成员逐项点名；空壳实例上这些全是
   * `undefined`：setup 的取消/日志与诊断面板转发会在运行期才炸，而启动与静态
   * `typeof` 都看不出来。`openSystemSetting` / `openBackgroundGuide` 由 setup 与
   * 「我的」页设置入口直接调用，同样必须进合同。
   */
  const APP_DIAGNOSTICS_INSTANCE_CONTRACT = {
    factory: "AppDiagnostics.createAppDiagnostics",
    instance: ["bind", "refreshNotifyLab", "labLog", "labCancelAlarms",
      "describeAlarmDelivery", "openSystemSetting", "openBackgroundGuide"],
    instanceWhy: "lib/app-diagnostics.js 的 createAppDiagnostics 返回的实例缺少诊断 API —— " +
      "诊断面板与 setup 的投递判读/取消闹钟会静默失效",
    factoryThrowWhy: "lib/app-diagnostics.js 的 createAppDiagnostics 抛了异常 —— 诊断能力装不上，" +
      "面板与 setup 相关动作都没有反馈"
  };
  const APP_SETUP_INSTANCE_CONTRACT = {
    factory: "AppSetup.createAppSetup",
    instance: ["bind", "maybePromptAndroidNotify", "noteFirstRemindSaved", "renderSetupEntry",
      "updateSetupEntry", "openSetupSheet", "startSetupTestRun", "stopSetupTestRun",
      "setupEvidenceHtml", "setupStepsContext", "renderSetupSheetBody", "runSetupStep"],
    instanceWhy: "lib/app-setup.js 的 createAppSetup 返回的实例缺少设置 API —— 首次提醒设置与测试反馈会静默失效",
    factoryThrowWhy: "lib/app-setup.js 的 createAppSetup 抛了异常 —— 设置向导无法装配"
  };
  const APP_CONTENT_INSTANCE_CONTRACT = {
    factory: "AppContent.createAppContent",
    instance: ["bind", "openNote", "saveNote", "doSearch", "renderProjectsSheet", "addProject", "deleteProject"],
    instanceWhy: "lib/app-content.js 的 createAppContent 返回的实例缺少内容 API —— 笔记、项目或搜索入口会静默失效",
    factoryThrowWhy: "lib/app-content.js 的 createAppContent 抛了异常 —— 笔记、项目与搜索能力无法装配"
  };
  const APP_VIEWS_INSTANCE_CONTRACT = {
    factory: "AppViews.createAppViews",
    instance: ["priorityRank", "actionButton", "renderItemCard", "openDetail", "setBadge",
      "renderHome", "renderCalendar", "renderArchiveList", "renderFuture", "renderNotes",
      "renderStats", "syncUserMode", "renderMe", "renderPwaStatus", "render",
      "refreshProjectSelects", "projectById", "homeRenderStats", "resetHomeRenderStats"],
    instanceWhy: "lib/app-views.js 的 createAppViews 返回的实例缺少展示 API —— 页面会局部空白或详情点了没反应",
    factoryThrowWhy: "lib/app-views.js 的 createAppViews 抛了异常 —— 展示能力无法装配"
  };

  /** 按 `a.b.c` 取路径；任一段缺失返回 undefined。 */
  function readPath(obj, dotted) {
    return String(dotted).split(".").reduce(function (o, k) {
      return (o == null ? undefined : o[k]);
    }, obj);
  }

  /** 运行时依赖根：**每次读取都取当前值** —— 脚本可能正是上次失败之后才补上的。 */
  function runtimeRoots() {
    return {
      AttentionLib: (typeof AttentionLib !== "undefined" && AttentionLib) || null,
      AttentionNativeReminders:
        (typeof AttentionNativeReminders !== "undefined" && AttentionNativeReminders) || null
    };
  }

  /**
   * 路径首段的**根前缀**表：前两行是模块全局名，第三行是 app-core 里给
   * `AttentionNativeReminders` 用的局部名（声明表与绑定表都按局部名书写，
   * 因为它们读起来才是「哪一支模块」）。
   */
  const RUNTIME_ROOT_PREFIX = {
    AttentionLib: "AttentionLib",
    AttentionNativeReminders: "AttentionNativeReminders",
    NativeReminders: "AttentionNativeReminders"
  };

  function readRuntimePath(roots, dotted) {
    const parts = String(dotted).split(".");
    const rootName = RUNTIME_ROOT_PREFIX[parts[0]];
    let base = roots.AttentionLib;
    if (rootName) {
      base = roots[rootName];
      parts.shift();
    }
    return parts.reduce(function (o, k) {
      return o == null ? undefined : o[k];
    }, base);
  }

  /** `null` 与 `undefined` 必须分开报：前者是「取到了但不可用」，后者是「压根没有」。 */
  function describeGot(got) {
    if (got === null) return "null";
    if (got === undefined) return "undefined";
    return typeof got;
  }

  /**
   * 「声明表里的路径」→「局部绑定名」的对照。
   *
   * 绑定**只能**取这张表里的路径，而这张表的每个路径都必须在 `REQUIRED_RUNTIME_EXPORTS`
   * 里声明过（`test-boot-combination.js` 对此有断言）—— 于是「闸门检查过的」与
   * 「业务真正用的」是同一批值，不可能出现「绑了一个从没检查过的导出」。
   */
  const RUNTIME_BINDING_PATHS = [
    ["AttentionNativeReminders", "NativeReminders"],
    ["AppUi", "AppUi"],
    ["AppAi", "AppAi"],
    ["AppBackup", "AppBackup"],
    ["AppDiagnostics", "AppDiagnostics"],
    ["AppSetup", "AppSetup"],
    ["AppContent", "AppContent"],
    ["AppViews", "AppViews"],
    ["Feedback", "FeedbackLib"],
    ["DeliveryEvidence", "EvidenceLib"],
    ["DatePrimitives", "DatePrimitives"],
    ["UiFormat", "UiFormat"],
    ["createStorage", "createStorageFactory"],
    ["AppUi.safeExternalHref", "safeExternalHref"],
    ["DatePrimitives.startOfDay", "startOfDay"],
    ["DatePrimitives.endOfDay", "endOfDay"],
    ["DatePrimitives.addDays", "addDays"],
    ["DatePrimitives.sameDay", "sameDay"],
    ["DatePrimitives.nextWeekend", "nextWeekend"],
    ["DatePrimitives.applyClock", "applyClock"],
    ["DatePrimitives.lastDayOfMonth", "lastDayOfMonth"],
    ["DatePrimitives.nthWeekdayInMonth", "nthWeekdayInMonth"],
    ["DatePrimitives.weekdayOfNextWeek", "weekdayOfNextWeek"],
    ["DatePrimitives.dayOfMonthIn", "dayOfMonthIn"],
    ["DatePrimitives.nextDayOfMonth", "nextDayOfMonth"],
    ["nextRepeatTrigger", "nextRepeatTrigger"],
    ["repeatLabel", "repeatLabel"],
    ["nextRepeatPreview", "nextRepeatPreview"],
    ["parseChineseTime", "parseChineseTime"],
    ["cnInt", "cnInt"],
    ["hasSpecificTimeWord", "hasSpecificTimeWord"]
  ];

  /**
   * **类型契约判定**：通过返回 `null`，不满足返回 `{ expected, actual }`。
   *
   * `null` 必须**单独**判：`typeof null === "object"`，否则「模块成了 null」会被当成
   * 一个合格的 object 放行（F02 原缺陷）。`undefined` 同样单独判，因为报出来的
   * 「压根没这一项」比「类型不对」让人一眼看懂。
   *
   * `array` 用 `Array.isArray` —— 见声明表头那段说明：`typeof [] === "object"`，
   * `typeof` 分辨不出数组与对象。
   */
  function describeTypeMismatch(got, want, itemShape) {
    const expected = want + (itemShape ? "<" + itemShape.join(",") + ">" : "");
    if (got === null) return { expected: expected, actual: "null" };
    if (got === undefined) return { expected: expected, actual: "undefined" };
    if (want === "array") {
      if (!Array.isArray(got)) return { expected: expected, actual: describeGot(got) + "（不是数组）" };
      if (itemShape) {
        // 空清单也是一种坏形状：消费者拿到 `[]` 会**什么都不渲染**且不报错 ——
        // 同属「界面看着正常、功能已经没了」那一类缺陷，所以不能只对非空数组查元素。
        if (got.length === 0) return { expected: expected, actual: "空数组（清单至少要有一项）" };
        for (let i = 0; i < got.length; i++) {
          const missing = missingItemShape(got[i], itemShape);
          if (missing) return { expected: expected, actual: "array[" + i + "] " + missing };
        }
      }
      return null;
    }
    if (typeof got !== want) return { expected: expected, actual: typeof got };
    return null;
  }

  /** 元素形状核对：缺什么就**逐个点出来**（不是笼统报个类型），没问题返回 `null`。 */
  function missingItemShape(item, itemShape) {
    if (item === null || item === undefined || typeof item !== "object") {
      return "元素不是对象（" + describeGot(item) + "）";
    }
    const missing = itemShape.filter(function (k) { return item[k] === undefined; });
    return missing.length ? "缺少 " + missing.join(" / ") : null;
  }

  /**
   * `createAppAi(deps)` 的依赖表（P2-A）。
   *
   * **每一项都是函数，没有一个是值** —— 理由与 `AppUi` 那条 `isFeedbackSuppressed`
   * 相同，但覆盖面更大：`parseChineseTime` / `repeatLabel` / `pad` / `toLocalInput` /
   * `fmtTime` / `fmtDate` 全部是「重试时可重建」的 `let` 绑定（F03），`$` / `$$` /
   * `openSheet` / `closeSheet` / `toast` 来自 `createUi()` 的实例。按值传进去，
   * 就等于在 AI 这条链上把「补载脚本后点重试」再堵死一次：闸门放行了，而 AI 仍跑在
   * 上一份（可能是 `null`）的绑定上。
   *
   * 刻意**不给**的东西：
   *   · `state` 本身 —— 只给 `getSettings()` / `setAiConfig()`。模块不需要知道事项、
   *     事务或持久化长什么样；
   *   · `itemFormSession` / `formUntouched()` —— 表单会话身份属于捕获表单，
   *     模块只提供纯快照合并 `mergedDraft()`，往哪儿合由入口按身份决定（R-F03）；
   *   · `submitToken` / `beginSaveSubmit()` —— 提交身份属于事务层，
   *     AI 只是「占用同一个身份」，不能再发明第二个。
   */
  function aiRuntimeDeps() {
    return {
      getSettings: () => state.settings,
      setAiConfig: (next) => { state.settings.ai = next; },
      query: (sel, scope) => $(sel, scope),
      queryAll: (sel, scope) => $$(sel, scope),
      pad: (n) => pad(n),
      toLocalInput: (ts) => toLocalInput(ts),
      fmtTime: (ts) => fmtTime(ts),
      fmtDate: (ts) => fmtDate(ts),
      repeatLabel: (r) => repeatLabel(r),
      parseChineseTime: (text) => parseChineseTime(text),
      updateRepeatPreview: () => updateRepeatPreview(),
      toast: (msg, label, onAction, second, opts) => toast(msg, label, onAction, second, opts),
      openSheet: (id) => openSheet(id),
      closeSheet: (id) => closeSheet(id),
      renderMe: () => renderMe(),
      save: () => save(),
      /**
       * 「没配置就带用户去配置」里的 `state.ui.tab = "me"` 是**视图所有权**，
       * 不能搬进模块 —— 模块不该知道「我的」这个 tab 叫什么。
       * 这里只把「跳过去 + 打开设置弹层」这一件事交给入口编排。
       */
      onMissingConfig: () => {
        state.ui.tab = "me";
        renderMe();
        ai.openAiSheet();
      }
    };
  }

  /**
   * `createAppBackup(deps)` 的依赖表（P2-C）。同一条铁律：**每一项都是函数**。
   *
   * 刻意**不给**的东西：
   *   · `state` 的写权 —— 模块只经 `getState()` 拿活引用做「导入覆盖」这一件事，
   *     覆盖的形状校验（`normalizeItem`）由注入方提供，模块不能自造第二条解析规则；
   *   · 持久化的第二条路 —— 导入覆盖后走**注入的 `save()`**，与表单/撤销同一条
   *     持久化命令。为导入另起 `saveAsync` 直写等于造出两个提交所有者；
   *   · `inflightActionDepth` 的写权 —— 只给只读取值器；那是事务层的所有权。
   */
  function backupRuntimeDeps() {
    return {
      getSchema: () => SCHEMA,
      getState: () => state,
      normalizeItem: (item) => normalizeItem(item),
      save: () => save(),
      render: () => render(),
      toast: (msg) => toast(msg),
      confirmDialog: (msg, title) => confirmDialog(msg, title),
      query: (sel) => $(sel),
      isNativeAndroidRuntime: () => isNativeAndroidRuntime(),
      systemBridge: () => systemBridge(),
      getInflightActionDepth: () => inflightActionDepth
    };
  }

  /**
   * `createAppDiagnostics(deps)` 的依赖表（P2-D）。每一项都是**函数** ——
   * `state` / `nativeReminderStatus` 会被加载与对账替换，`systemBridge` / `$`
   * 跟着重试重建的绑定走（F03）。
   *
   * 刻意**不给**的东西：
   *   · 平台访问器本体 —— `systemBridge` / `appSettingsPlugin` / `isNativeAndroidRuntime`
   *     留在 core（setup、active alarm、启动与复核共用），只注入函数；
   *   · 第二条持久化 —— 模块只经注入的 `save()` 写，且仅在 `labRequestNotify`
   *     的显式用户操作后；
   *   · 可写 `ctx` —— 为消循环依赖整包注入会把事务与原生同步一并交出去。
   */
  function diagnosticsRuntimeDeps() {
    return {
      query: (sel) => $(sel),
      queryAll: (sel) => $$(sel),
      openSheet: (id) => openSheet(id),
      toast: (msg) => toast(msg),
      fmtTime: (ts) => fmtTime(ts),
      getState: () => state,
      save: () => save(),
      renderMe: () => renderMe(),
      systemBridge: () => systemBridge(),
      appSettingsPlugin: () => appSettingsPlugin(),
      getNativeReminderStatus: () => nativeReminderStatus,
      setNativeReminderStatus: (s) => setNativeReminderStatus(s),
      requestNativeNotificationPermission: () => NativeReminders.requestNotificationPermission(),
      openExactAlarmSettings: () => NativeReminders.openExactAlarmSettings(),
      buildDesired: (items, settings, lead) => NativeReminders.buildDesired(items, settings, lead),
      syncNativeRemindersNow: (opts) => syncNativeRemindersNow(opts),
      getCapacitor: () => window.Capacitor,
      getDocument: () => document
    };
  }

  function setupRuntimeDeps() {
    return {
      query: (sel) => $(sel), queryAll: (sel) => $$(sel),
      openSheet: (id) => openSheet(id), toast: (msg, action, fn) => toast(msg, action, fn),
      escapeHtml: (s) => escapeHtml(s), fmtTime: (ts) => fmtTime(ts),
      writeIfChanged: (el, html) => writeIfChanged(el, html),
      getState: () => state, save: () => save(), renderMe: () => renderMe(),
      systemBridge: () => systemBridge(), getNativeReminders: () => NativeReminders,
      getNativeReminderStatus: () => nativeReminderStatus,
      setNativeReminderStatus: (s) => setNativeReminderStatus(s),
      getFeedback: () => FeedbackLib, labLog: (msg) => labLog(msg),
      labCancelAlarms: (opts) => labCancelAlarms(opts),
      describeAlarmDelivery: (d) => describeAlarmDelivery(d),
      openBackgroundGuide: (k) => openBackgroundGuide(k), openSystemSetting: (k) => openSystemSetting(k),
      isNativeAndroidRuntime: () => isNativeAndroidRuntime()
    };
  }

  /** P2-F1：内容模块只拿 live getter 与具名命令，不接触 core 的事务实现细节。 */
  function contentRuntimeDeps() {
    return {
      query: (sel) => $(sel), queryAll: (sel) => $$(sel), getDocument: () => document,
      openSheet: (id) => openSheet(id), closeSheet: (id) => closeSheet(id), toast: (msg) => toast(msg),
      confirmDialog: (msg, title) => confirmDialog(msg, title),
      escapeHtml: (s) => escapeHtml(s), escapeAttr: (s) => escapeAttr(s), renderMarkdown: (s) => renderMarkdown(s),
      getState: () => state, save: () => save(), render: () => render(),
      renderItemCard: (item, mode) => renderItemCard(item, mode), refreshProjectSelects: () => refreshProjectSelects(),
      uid: () => uid(), getProjectColors: () => PROJECT_COLORS,
      itemConflictsWithActiveAction: (item) => itemConflictsWithActiveAction(item),
      rejectPendingItemCommand: () => rejectPendingItemCommand(),
      // 事项 projectId/rev 仍由 core 的 user-operation 事务域清理，content 绝不复制循环。
      removeProjectFromItems: (id) => runUserOp(applyProjectRemovalToItems, [id])
    };
  }

  /**
   * P2-F2：展示层没有 state/save/事务写权。这里每项都是具名的 live callback；
   * factory 只可渲染或查询，业务推进仍由 core 的 renderHome 编排。
   */
  function viewsRuntimeDeps() {
    return {
      query: (sel, scope) => $(sel, scope), queryAll: (sel, scope) => $$(sel, scope), getState: () => state,
      openSheet: (id) => openSheet(id), openCapture: (prefill) => openCapture(prefill), openDemoPreview: () => openDemoPreview(),
      isAttentionDue: (it, now) => isAttentionDue(it, now), needsReviewItems: () => needsReviewItems(),
      renderReviewEntry: () => renderReviewEntry(), inReviewHighlight: () => inReviewHighlight(),
      renderAiSub: () => ai.renderAiSub(), ensureReviewSettings: () => ensureReviewSettings(),
      updateSetupEntry: () => updateSetupEntry(),
      detailReminderStatusRow: (it) => detailReminderStatusRow(it), isTerminal: (it) => isTerminal(it),
      updateAppBadge: (n) => updateAppBadge(n), fmtTime: (ts) => fmtTime(ts), fmtDate: (ts) => fmtDate(ts),
      relDue: (ts) => relDue(ts), repeatLabel: (r) => repeatLabel(r), dayLabel: (ts) => dayLabel(ts),
      escapeHtml: (v) => escapeHtml(v), escapeAttr: (v) => escapeAttr(v), safeExternalHref: (u) => safeExternalHref(u),
      sameDay: (a, b) => sameDay(a, b), startOfDay: (d) => startOfDay(d), pad2: (n) => pad2(n),
      getNativeReminderStatus: () => nativeReminderStatus,
      getNativeReminders: () => NativeReminders, getSwReg: () => null, isNativeAndroidRuntime: () => isNativeAndroidRuntime()
    };
  }

  /**
   * **检查 + 取值**（同一次操作）。
   *
   * 返回 `{ problems, bindings }`：`problems` 非空时 `bindings` 为 `null`，
   * 且此时**什么实例都没建**（不调 `createUi` / `createAppAi`、不建 storage）——
   * 失败路径必须停在「什么都没发生」，否则会出现「半套依赖已经生效」的界面。
   */
  function collectRuntimeBindings() {
    const problems = [];
    const roots = runtimeRoots();

    for (let i = 0; i < REQUIRED_RUNTIME_EXPORTS.length; i++) {
      const path0 = REQUIRED_RUNTIME_EXPORTS[i][0];
      const want = REQUIRED_RUNTIME_EXPORTS[i][1];
      const why = REQUIRED_RUNTIME_EXPORTS[i][2];
      const itemShape = REQUIRED_RUNTIME_EXPORTS[i][3] || null;
      const got = readRuntimePath(roots, path0);
      const mismatch = describeTypeMismatch(got, want, itemShape);
      if (mismatch) {
        problems.push({ path: path0, expected: mismatch.expected, actual: mismatch.actual, why: why });
      }
    }
    if (problems.length) return { problems: problems, bindings: null };

    // 工厂实例契约（F02）：工厂是函数还不够 —— 它得真的装出那几个 API，
    // 而且这里装出来的实例就是业务要用的**同一个**（不另造一个丢掉）。
    let instance = null;
    const factory = readRuntimePath(roots, APP_UI_INSTANCE_CONTRACT.factory);
    try {
      instance = factory({ isFeedbackSuppressed: () => suppressUserFeedback });
    } catch (error) {
      problems.push({
        path: APP_UI_INSTANCE_CONTRACT.factory + "()",
        expected: "instance",
        actual: "threw:" + (error && error.message ? error.message : String(error)),
        why: APP_UI_INSTANCE_CONTRACT.factoryThrowWhy
      });
      return { problems: problems, bindings: null };
    }
    APP_UI_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (instance == null || typeof instance[name] !== "function") {
        problems.push({
          path: "AppUi." + name,
          expected: "function",
          actual: instance == null ? describeGot(instance) : describeGot(instance[name]),
          why: APP_UI_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // AI 能力（P2-A）：与上面同一条规矩 —— 工厂是函数还不够，装出来的实例就是业务要用的
    // 同一个（不另造一个丢掉）。缺 `runOnCapture` 这类成员时，按钮监听器会绑到
    // `undefined` 上，点击才 TypeError，而启动与静态闭合都看不出来。
    let aiInstance = null;
    const aiFactory = readRuntimePath(roots, APP_AI_INSTANCE_CONTRACT.factory);
    try {
      aiInstance = aiFactory(aiRuntimeDeps());
    } catch (error) {
      problems.push({
        path: APP_AI_INSTANCE_CONTRACT.factory + "()",
        expected: "instance",
        actual: "threw:" + (error && error.message ? error.message : String(error)),
        why: APP_AI_INSTANCE_CONTRACT.factoryThrowWhy
      });
      return { problems: problems, bindings: null };
    }
    APP_AI_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (aiInstance == null || typeof aiInstance[name] !== "function") {
        problems.push({
          path: "AppAi." + name,
          expected: "function",
          actual: aiInstance == null ? describeGot(aiInstance) : describeGot(aiInstance[name]),
          why: APP_AI_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // 备份能力（P2-C）：同一套「工厂存在 ≠ 装上了」的实例核对。备份是低频但要命的
    // 操作 —— 实例空壳时「导出」按钮点了没反应，用户会以为备份好了而实际上
    // 什么都没发生；这种静默只有装配闸门能拦。
    let backupInstance = null;
    const backupFactory = readRuntimePath(roots, APP_BACKUP_INSTANCE_CONTRACT.factory);
    try {
      backupInstance = backupFactory(backupRuntimeDeps());
    } catch (error) {
      problems.push({
        path: APP_BACKUP_INSTANCE_CONTRACT.factory + "()",
        expected: "instance",
        actual: "threw:" + (error && error.message ? error.message : String(error)),
        why: APP_BACKUP_INSTANCE_CONTRACT.factoryThrowWhy
      });
      return { problems: problems, bindings: null };
    }
    APP_BACKUP_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (backupInstance == null || typeof backupInstance[name] !== "function") {
        problems.push({
          path: "AppBackup." + name,
          expected: "function",
          actual: backupInstance == null ? describeGot(backupInstance) : describeGot(backupInstance[name]),
          why: APP_BACKUP_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // 诊断能力（P2-D）：同一套「工厂存在 ≠ 装上了」的实例核对。诊断空壳时
    // setup 的取消/日志与面板转发会在运行期才坏，启动链完全看不出来。
    let diagnosticsInstance = null;
    const diagnosticsFactory = readRuntimePath(roots, APP_DIAGNOSTICS_INSTANCE_CONTRACT.factory);
    try {
      diagnosticsInstance = diagnosticsFactory(diagnosticsRuntimeDeps());
    } catch (error) {
      problems.push({
        path: APP_DIAGNOSTICS_INSTANCE_CONTRACT.factory + "()",
        expected: "instance",
        actual: "threw:" + (error && error.message ? error.message : String(error)),
        why: APP_DIAGNOSTICS_INSTANCE_CONTRACT.factoryThrowWhy
      });
      return { problems: problems, bindings: null };
    }
    APP_DIAGNOSTICS_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (diagnosticsInstance == null || typeof diagnosticsInstance[name] !== "function") {
        problems.push({
          path: "AppDiagnostics." + name,
          expected: "function",
          actual: diagnosticsInstance == null ? describeGot(diagnosticsInstance) : describeGot(diagnosticsInstance[name]),
          why: APP_DIAGNOSTICS_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    let setupInstance = null;
    const setupFactory = readRuntimePath(roots, APP_SETUP_INSTANCE_CONTRACT.factory);
    try { setupInstance = setupFactory(setupRuntimeDeps()); }
    catch (error) {
      problems.push({ path: APP_SETUP_INSTANCE_CONTRACT.factory + "()", expected: "instance",
        actual: "threw:" + (error && error.message ? error.message : String(error)),
        why: APP_SETUP_INSTANCE_CONTRACT.factoryThrowWhy });
      return { problems: problems, bindings: null };
    }
    APP_SETUP_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (setupInstance == null || typeof setupInstance[name] !== "function") {
        problems.push({ path: "AppSetup." + name, expected: "function",
          actual: setupInstance == null ? describeGot(setupInstance) : describeGot(setupInstance[name]),
          why: APP_SETUP_INSTANCE_CONTRACT.instanceWhy });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    let contentInstance = null;
    const contentFactory = readRuntimePath(roots, APP_CONTENT_INSTANCE_CONTRACT.factory);
    try { contentInstance = contentFactory(contentRuntimeDeps()); }
    catch (error) {
      problems.push({ path: APP_CONTENT_INSTANCE_CONTRACT.factory + "()", expected: "instance",
        actual: "threw:" + (error && error.message ? error.message : String(error)),
        why: APP_CONTENT_INSTANCE_CONTRACT.factoryThrowWhy });
      return { problems: problems, bindings: null };
    }
    APP_CONTENT_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (contentInstance == null || typeof contentInstance[name] !== "function") {
        problems.push({ path: "AppContent." + name, expected: "function",
          actual: contentInstance == null ? describeGot(contentInstance) : describeGot(contentInstance[name]),
          why: APP_CONTENT_INSTANCE_CONTRACT.instanceWhy });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    let viewsInstance = null;
    const viewsFactory = readRuntimePath(roots, APP_VIEWS_INSTANCE_CONTRACT.factory);
    try { viewsInstance = viewsFactory(viewsRuntimeDeps()); }
    catch (error) {
      problems.push({ path: APP_VIEWS_INSTANCE_CONTRACT.factory + "()", expected: "instance",
        actual: "threw:" + (error && error.message ? error.message : String(error)),
        why: APP_VIEWS_INSTANCE_CONTRACT.factoryThrowWhy });
      return { problems: problems, bindings: null };
    }
    APP_VIEWS_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (viewsInstance == null || typeof viewsInstance[name] !== "function") {
        problems.push({ path: "AppViews." + name, expected: "function",
          actual: viewsInstance == null ? describeGot(viewsInstance) : describeGot(viewsInstance[name]),
          why: APP_VIEWS_INSTANCE_CONTRACT.instanceWhy });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // 走到这里说明每一项都核对过了 —— 下面绑的就是刚才核对过的那批值。
    const bindings = {
      appUi: instance, ai: aiInstance, backup: backupInstance,
      diagnostics: diagnosticsInstance, setup: setupInstance, content: contentInstance, views: viewsInstance
    };
    for (let i = 0; i < RUNTIME_BINDING_PATHS.length; i++) {
      bindings[RUNTIME_BINDING_PATHS[i][1]] = readRuntimePath(roots, RUNTIME_BINDING_PATHS[i][0]);
    }
    return { problems: [], bindings: bindings };
  }

  /**
   * 逐项核对必需导出，返回**问题清单**（空数组 = 装配完好）。
   *
   * 与 `bindRuntime()` **共用同一套检查**（同一个 `collectRuntimeBindings`）——
   * 「闸门说没问题」与「业务真的能用」因此是同一件事。只读：不提交任何绑定。
   */
  function assertRuntimeDependencies() {
    return collectRuntimeBindings().problems;
  }

  /**
   * **装配**：检查通过之后，把这些绑定一次性写上。
   *
   * 返回问题清单。失败时**不动**既有绑定 —— 重试要么整套换新，要么维持原样，
   * 不会把正在跑的那套依赖换成半份。
   */
  function bindRuntime() {
    const result = collectRuntimeBindings();
    if (result.problems.length) return result.problems;
    const b = result.bindings;
    NativeReminders = b.NativeReminders;
    AppUi = b.AppUi;
    appUi = b.appUi;
    AppAi = b.AppAi;
    ai = b.ai;
    AppBackup = b.AppBackup;
    backup = b.backup;
    AppDiagnostics = b.AppDiagnostics;
    diagnostics = b.diagnostics;
    AppSetup = b.AppSetup;
    appSetup = b.setup;
    AppContent = b.AppContent;
    appContent = b.content;
    AppViews = b.AppViews;
    appViews = b.views;
    $ = appUi.$;
    $$ = appUi.$$;
    openSheet = appUi.openSheet;
    closeSheet = appUi.closeSheet;
    closeAllSheets = appUi.closeAllSheets;
    confirmDialog = appUi.confirmDialog;
    toast = appUi.toast;
    hideToast = appUi.hideToast;
    FeedbackLib = b.FeedbackLib;
    EvidenceLib = b.EvidenceLib;
    DatePrimitives = b.DatePrimitives;
    UiFormat = b.UiFormat;
    safeExternalHref = b.safeExternalHref;
    startOfDay = b.startOfDay;
    endOfDay = b.endOfDay;
    addDays = b.addDays;
    sameDay = b.sameDay;
    nextWeekend = b.nextWeekend;
    applyClock = b.applyClock;
    lastDayOfMonth = b.lastDayOfMonth;
    nthWeekdayInMonth = b.nthWeekdayInMonth;
    weekdayOfNextWeek = b.weekdayOfNextWeek;
    dayOfMonthIn = b.dayOfMonthIn;
    nextDayOfMonth = b.nextDayOfMonth;
    nextRepeatTrigger = b.nextRepeatTrigger;
    repeatLabel = b.repeatLabel;
    nextRepeatPreview = b.nextRepeatPreview;
    parseChineseTime = b.parseChineseTime;
    cnInt = b.cnInt;
    hasSpecificTimeWord = b.hasSpecificTimeWord;
    // storage 放在最后：它会开 IndexedDB（有副作用），必须在所有检查都过之后才建 ——
    // 「装配失败但库已经开了一半」比干脆不开更麻烦。
    storage = typeof b.createStorageFactory === "function"
      ? b.createStorageFactory({ lsKey: KEY })
      : null;
    return [];
  }

  /**
   * 可见的启动失败面板。
   *
   * 契约：**不能只 console.error 之后留下一个可编辑但不落库的界面** —— 那个界面最坏：
   * 用户照常输入、照常点保存，而写入永远不会到磁盘。所以这里必须
   *   · 抢占首页容器，让「能点但没用」的界面不被呈现；
   *   · 用**纯文本 + 两个按钮**（重试 / 重新加载），不放任何可编辑控件；
   *   · 写明「哪一支没起来」与「后果」，而不是抛一个 TypeError 给用户。
   */
  function renderStartupFailure(problems) {
    const marker = "startup-dependency-failure";
    // 宿主选取：真实浏览器里 `getElementById` 恒在，但测试沙箱可能只提供 `querySelector`。
    // 这里按可用性逐个退，而不是假定某一个存在 —— 否则「渲染失败面板」本身会抛错，
    // 于是失败面板什么都不显示，又退回「安静地留下一个能点但没用」的界面。
    let host = null;
    if (typeof document.getElementById === "function") {
      host = document.getElementById("main") || document.getElementById("homeEmpty");
    }
    if (!host && typeof document.querySelector === "function") {
      host = document.querySelector("#main") || document.querySelector("#homeEmpty");
    }
    if (!host) host = document.body;
    if (!host) return;
    if (typeof document.getElementById === "function") {
      const existing = document.getElementById(marker);
      if (existing && existing.parentNode && typeof existing.parentNode.removeChild === "function") {
        existing.parentNode.removeChild(existing);
      }
    }

    const box = document.createElement("section");
    box.id = marker;
    box.setAttribute("data-startup-failure", "1");
    box.style.cssText = "margin:16px;padding:14px 16px;border:1px solid #d9b8b8;" +
      "border-radius:10px;background:#fdf4f4;color:#5b2b2b;font-size:14px;line-height:1.6;";
    // 只有「关键档」才渲染：一条标题、一条原因、两条去路。不铺问题清单的全部细节，
    // 但保留第一条与条数，让用户至少能说清「哪一支没起来」。
    const head = document.createElement("p");
    head.style.cssText = "margin:0 0 8px;font-weight:600;";
    head.textContent = "应用没能启动：依赖的脚本没有就位（" + problems.length + " 项）";
    box.appendChild(head);

    const cause = document.createElement("p");
    cause.style.cssText = "margin:0 0 6px;";
    cause.textContent = "首要原因：" + problems[0].path + " 期望是 " + problems[0].expected +
      "，实际是 " + problems[0].actual + "。";
    box.appendChild(cause);

    const detail = document.createElement("p");
    detail.style.cssText = "margin:0 0 10px;color:#7a4a4a;";
    detail.textContent = problems[0].why;
    box.appendChild(detail);

    const hint = document.createElement("p");
    hint.style.cssText = "margin:0 0 10px;color:#7a4a4a;";
    // 关键安全性说明：停在原地是为了**不让你以为已经保存了**。
    hint.textContent = "为免出现「能输入但存不下来」的界面，本次未加载数据、未做迁移、未安排提醒、未启动后台心跳。";
    box.appendChild(hint);

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.id = "startupRetry";
    retry.textContent = "重试";
    retry.style.cssText = "padding:6px 14px;border:1px solid #a87676;border-radius:8px;" +
      "background:#fff;color:#5b2b2b;cursor:pointer;";
    retry.addEventListener("click", function () {
      if (box.parentNode) box.parentNode.removeChild(box);
      startApp();
    });
    const reload = document.createElement("button");
    reload.type = "button";
    reload.id = "startupReload";
    reload.textContent = "重新加载";
    reload.style.cssText = "padding:6px 14px;border:1px solid #a87676;border-radius:8px;" +
      "background:#fff;color:#5b2b2b;cursor:pointer;";
    reload.addEventListener("click", function () {
      try { location.reload(); } catch (error) {}
    });
    row.appendChild(retry);
    row.appendChild(reload);
    box.appendChild(row);

    host.insertBefore(box, host.firstChild);
  }

  /** 恢复面板重试的在途守卫（同一时刻只允许一次重试）。 */
  let restoreRetryInFlight = false;
  /**
   * 恢复面板当前是否**挂在页面上**。
   *
   * 刻意用标志而不是「DOM 里查得到那个 id 吗」：`getElementById` 在某些宿主/测试替身里
   * 永远返回节点（按需创建），于是「面板还在不在」会变成一个恒真读数。
   */
  let stateRecoveryPanelShown = false;

  /** 给用户看的失败归类（技术原因仍原样留在 `lastLoadReport.reason`）。 */
  function describeLoadFailure(report) {
    const reason = report && report.reason ? String(report.reason) : "";
    if (reason.indexOf("mirror") === 0 || reason.indexOf("authoritative-read-failed") === 0) {
      return "本机数据库这次读不出来";
    }
    if (reason === "authoritative-value-not-object") return "本机数据库里的内容不是一份可用的数据";
    if (reason === "pending-replay-failed") return "上一次没写完的改动没能接回来";
    if (reason === "authoritative-empty-with-residual-evidence") {
      return "数据库读到的内容与镜像对不上";
    }
    return "本机数据的权威状态没能确认";
  }

  /**
   * P2-C-R：**可见的恢复面板**（`failed` 时的唯一界面）。
   *
   * 契约与装配失败面板（`renderStartupFailure`）一致，理由也一样：
   * **不能只 console.error 之后留下一个可编辑但不落库的界面** —— 那个界面最坏：
   * 用户照常输入、照常点保存，而写入已经被写闸门拦下。
   * 所以这里同样抢占容器、只用纯文本 + 两个按钮（不放任何可编辑控件）。
   *
   * 额外一条：面板必须**说清没有写任何东西**。用户此刻最该知道的是
   * 「你的旧数据没有被这次启动覆盖」。
   */
  function renderStateRecovery(report) {
    const marker = "state-authority-recovery";
    let host = null;
    if (typeof document.getElementById === "function") {
      host = document.getElementById("main") || document.getElementById("homeEmpty");
    }
    if (!host && typeof document.querySelector === "function") {
      host = document.querySelector("#main") || document.querySelector("#homeEmpty");
    }
    if (!host) host = document.body;
    if (!host) return;
    removeStateRecoveryPanel();

    const box = document.createElement("section");
    box.id = marker;
    box.setAttribute("data-state-authority-failure", "1");
    box.style.cssText = "margin:16px;padding:14px 16px;border:1px solid #d9b8b8;" +
      "border-radius:10px;background:#fdf4f4;color:#5b2b2b;font-size:14px;line-height:1.6;";

    const head = document.createElement("p");
    head.style.cssText = "margin:0 0 8px;font-weight:600;";
    head.textContent = "数据没有恢复成功，应用暂未启动";
    box.appendChild(head);

    const cause = document.createElement("p");
    cause.style.cssText = "margin:0 0 6px;";
    cause.textContent = describeLoadFailure(report) + "（第 " + report.attempt + " 次尝试）。";
    box.appendChild(cause);

    const detail = document.createElement("p");
    detail.style.cssText = "margin:0 0 10px;color:#7a4a4a;";
    detail.textContent = "原因：" + (report.reason || "unknown") +
      (report.detail ? " · " + report.detail : "");
    box.appendChild(detail);

    const hint = document.createElement("p");
    hint.style.cssText = "margin:0 0 10px;color:#7a4a4a;";
    hint.textContent = "为免覆盖本机已有数据，这次没有写入任何内容，也没有安排提醒或启动后台心跳。" +
      "本机旧数据仍在原处，重试成功后照常进入应用。";
    box.appendChild(hint);

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.id = "stateRecoveryRetry";
    retry.textContent = "重试恢复";
    retry.style.cssText = "padding:6px 14px;border:1px solid #a87676;border-radius:8px;" +
      "background:#fff;color:#5b2b2b;cursor:pointer;";
    retry.addEventListener("click", function () { retryRestore(); });
    const reload = document.createElement("button");
    reload.type = "button";
    reload.id = "stateRecoveryReload";
    reload.textContent = "重新加载";
    reload.style.cssText = "padding:6px 14px;border:1px solid #a87676;border-radius:8px;" +
      "background:#fff;color:#5b2b2b;cursor:pointer;";
    reload.addEventListener("click", function () {
      try { location.reload(); } catch (error) {}
    });
    row.appendChild(retry);
    row.appendChild(reload);
    box.appendChild(row);

    host.insertBefore(box, host.firstChild);
    stateRecoveryPanelShown = true;
  }

  function removeStateRecoveryPanel() {
    stateRecoveryPanelShown = false;
    try {
      if (typeof document.getElementById !== "function") return;
      const existing = document.getElementById("state-authority-recovery");
      if (existing && existing.parentNode && typeof existing.parentNode.removeChild === "function") {
        existing.parentNode.removeChild(existing);
      }
    } catch (error) {}
  }

  /**
   * 「重试恢复」：**先让权威后端重新可试**，再重跑一次恢复 + 启动。
   *
   * 为什么必须 `storage.reopen()`：`lib/storage.js` 的 `ensure()` 一旦选定 backend
   * 就不再回头，所以「打开 IndexedDB 失败」之后的重试只会再读一次 localStorage ——
   * 权威后端永远不会被重新尝试，面板就成了一个点不动的按钮。
   *
   * 重跑走 `startApp()`（它会重新过装配闸门并把 `initStarted` 放回可重入状态），
   * 因此**不**需要另起一套启动路径；`initStarted` 的双重启动保护由 `startApp()` 自己维持。
   */
  function retryRestore() {
    if (restoreRetryInFlight) return;
    restoreRetryInFlight = true;
    let running = null;
    try {
      if (storage && typeof storage.reopen === "function") storage.reopen();
      running = startApp();
    } catch (error) {
      console.error("State recovery retry failed:", error && error.message ? error.message : error);
      running = null;
    }
    Promise.resolve(running).then(
      function () { restoreRetryInFlight = false; },
      function () { restoreRetryInFlight = false; }
    );
  }

  /* ---------- utils ---------- */

  /**
   * 日历原语：**唯一来源 `lib/date-utils.js`**。
   *
   * 走**命名空间**（`AttentionLib.DatePrimitives`）而不是扁平 `AttentionLib.startOfDay` ——
   * 后者是 UMD `Object.assign` 合并出来的，parse-cn / repeat 都往里写过同名键，
   * 「哪一份在跑」由 `<script>` 顺序决定，而顺序错了不抛错。
   * 拿不到由 `assertRuntimeDependencies()` 在启动前拦下并给出可读失败。
   */
  // `DatePrimitives` 的绑定由 `bindRuntime()` 写入（见文件顶部「运行时依赖：唯一装配入口」）。

  /* ---------- UI 纯格式化：唯一来源 lib/ui-format.js ---------- */

  /**
   * 命名空间挂载（同 `DatePrimitives`），不取扁平导出。
   * 这里的每一个都是**纯函数**（输入 → 字符串），不碰 DOM、不读 `state`：
   * 它们此前和几千行编排逻辑挤在同一个 IIFE 里，导致「时间怎么显示」这种事
   * 也得先把整个 app-core 跑起来才能验。
   * 取不到 = 装配错误，由 `assertRuntimeDependencies()` 在启动前拦下。
   */
  // `UiFormat` 的绑定同样由 `bindRuntime()` 写入（见文件顶部）。

  function uid() {
    return UiFormat.uid();
  }
  function pad(n) { return UiFormat.pad(n); }
  // 兼容别名：同一来源的委托，不另存算法体
  // startOfDay / endOfDay / addDays / sameDay / nextWeekend 的绑定由 `bindRuntime()` 写入。
  function fmtTime(ts) {
    return UiFormat.fmtTime(ts);
  }
  function fmtDate(ts) {
    return UiFormat.fmtDate(ts);
  }
  function relDue(ts) {
    return UiFormat.relDue(ts);
  }
  // `nextWeekend` 的绑定由 `bindRuntime()` 写入（同上）。
  function escapeHtml(s) {
    return UiFormat.escapeHtml(s);
  }

  /**
   * O3：**属性上下文**转义 —— 唯一来源 `lib/ui-format.js`。
   *
   * 字符集与 `escapeHtml` 相同（`& < > " '` 已覆盖能在属性里闭合引号的每一个字符），
   * 但语义不同、也必须分开命名：`escapeHtml` 是给**文本节点**用的，这里是给
   * `attr="…"` 用的。事项 id 未必由内部 `uid()` 生成 —— 导入数据里可以带任意字符串，
   * 直接拼进 `data-id="…"` 就能闭合引号、往标签里塞新属性。
   * 分开命名是为了让「改转义字符集」的人一眼看到属性侧也是消费者，不会只改一边。
   */
  function escapeAttr(v) {
    return UiFormat.escapeAttr(v);
  }

  /**
   * O3：可点击外部链接的**协议白名单** —— 唯一来源 `lib/app-ui.js`。
   *
   * 只放行「解析后协议是 `http:` / `https:`」的串，其余一律返回 `null`，
   * 由调用方降级成转义后的**纯文本**（原始数据照旧保留在 `it.url` 里，不静默删除）。
   *
   * 为什么不能用 `startsWith("http")` 或 `escapeHtml` 代替（完整理由随实现写在
   * `lib/app-ui.js` 的同名函数上，不在这里复制一份）：判定必须落在 **URL 解析结果**上，
   * 而不是字形上 —— 解析器会先剔除 TAB / LF / CR，于是 `"java\nscript:alert(1)"` 的
   * 真实协议是 `javascript:`，只看字面前缀根本拦不到。
   *
   * 无 `URL` 构造器时的保守字形分支也一并搬走，因此**没有第二份**可放行路径；
   * 该降级已登记（触发条件 / 唯一实现 / 失败反馈 / 覆盖用例见 `lib/app-ui.js`）。
   */
  // `safeExternalHref` 的绑定由 `bindRuntime()` 写入（它取自 `AppUi`，与上面同一来源）。

  /* 时间输入的本地串转换与归档日标签 —— 唯一来源 lib/ui-format.js */

  /** `<input type="datetime-local">` 的本地串（不含秒）。 */
  function toLocalInput(ts) {
    return UiFormat.toLocalInput(ts);
  }
  /** `datetime-local` 串 → 时间戳；解析不出返回 `null`（**不兜底成「现在」**）。 */
  function parseLocalInput(v) {
    return UiFormat.parseLocalInput(v);
  }
  /**
   * 归档/列表用的「日」标签。
   *
   * 与 `fmtDate` **刻意不合并**（不是遗漏）：空值语义（`"更早"` vs `""`）、有无「明天」
   * 分支、跨年是否回完整年月日，三处都不同。合并任何一条都是显示行为变更，须单独立项。
   */
  function dayLabel(ts) {
    return UiFormat.dayLabel(ts);
  }
  /* ---------- 日历 / 周期：全部委托给唯一来源，本文件不再持有算法体 ---------- */

  // lib/date-utils.js（命名空间）与 lib/repeat.js 的这批绑定同样由 `bindRuntime()` 写入 ——
  // 这里刻意**不留**「求值时抓一次」的副本：那正是 F03 的成因（重试之后业务仍跑在旧函数上）。

  /**
   * L03：下一周期时刻 —— 唯一来源 `lib/repeat.js`。
   *
   * 本文件此前自带一份逐字副本，靠文件中的「Lib 有就覆盖」块换掉；那套做法让
   * 「哪一份在跑」取决于脚本顺序与覆盖块是否被执行，而副本已经分叉（M-10）。
   * 现在直接取模块导出：取不到就是装配错误，由 `bindRuntime()` 在业务启动之前拦下。
   * 绑定本身也不再是 `const` —— 「重试」时必须能换成补载进来的那一份（F03）。
   */
  // lib/repeat.js
  /* Minimal markdown renderer —— 唯一来源 lib/ui-format.js */
  function renderMarkdown(src) {
    return UiFormat.renderMarkdown(src);
  }

  /* ---------- Chinese NL parser：唯一来源 lib/parse-cn.js ---------- */

  /**
   * 解析器与中文数字**唯一实现在 `lib/parse-cn.js`**。
   *
   * 本文件此前自带一整份副本（CN_NUM / cnInt / parseChineseTime），名义上只作「Lib 缺失时兜底」，
   * 再由文件末尾的 `if (Lib.parseChineseTime) parseChineseTime = Lib.parseChineseTime;` 覆盖回去。
   * 但两份**已经分叉**，所以「兜底」并不是同一套规则，而是悄悄换一套：
   *   · cnInt 副本只认「三十/二十/十」前缀；lib 还认「二零二三」式逐位与「百/千」段位单位。
   *   · parseChineseTime 副本缺全角数字归一（normalizeTimeText）与时长复合表达（extractDuration），
   *     返回对象也没有 scheduleBasis 字段（elapsed / wall-clock 的判据就压在那里）。
   * 现在只保留唯一来源；取不到 = 装配错误，由 bindRuntime() 在业务启动之前拦下，
   * 而且绑定是「重试时可重建」的（F03）——补载脚本后点重试，业务真的跑在新函数上。
   */

  /* ---------- state ---------- */
  const PROJECT_COLORS = ["#1b6b4a", "#3d5a80", "#9a6b12", "#8f3a3a", "#5b4b8a", "#2f6f7a"];

  let state = {
    schema: SCHEMA,
    items: [],
    notes: [],
    projects: [],
    settings: {
      notify: false,
      notifyPrompted: false,
      userMode: "beginner",
      onboardDone: false,
      dnd: true,
      importantRepeat: true,
      quietStart: "23:00",
      quietEnd: "07:30",
      dailySummary: false,
      privacyNotify: false,
      lastSummaryAt: 0,
      // D25 / A-01：未标记事项的默认投递方式（录入时快照）
      defaultDeliveryMode: "notification",
      review: {
        enabled: true,
        hour: 21,
        minute: 30,
        windowEndHour: 23,
        windowEndMinute: 0,
        // D22：60 分钟 × 2 次
        followupMs: 60 * 60 * 1000,
        maxFollowups: 2,
        lastNotifiedAt: 0,
        followupCount: 0,
        snoozedUntil: 0,
        skippedUntil: 0,
        sessionStatus: "idle",
        lastSessionKey: ""
      },
      ai: {
        enabled: false,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
        autoOnSave: false
      }
    },
    ui: {
      tab: "home",
      futureSeg: "waiting",
      futureFilter: "all",
      notesFilter: "all",
      calMonth: null,
      calSelected: null,
      snoozeId: null,
      detailId: null,
      editItemId: null,
      editNoteId: null,
      notePin: false,
      projectColor: PROJECT_COLORS[0],
      reviewIndex: 0,
      reviewQueue: [],
      activeExpanded: false
    }
  };

  function currentPayload() {
    return {
      schema: SCHEMA,
      items: state.items,
      notes: state.notes,
      projects: state.projects,
      settings: state.settings
    };
  }

  /**
   * 把整个状态写一份快照到权威后端。**不加闸门**，只做「取快照 + 写」这一件事。
   *
   *  · **H2 权威后端**：能用 IndexedDB 就以它为准（storage.save 内部把 localStorage 当镜像
   *    尽力写），没有可用后端时才由 localStorage 拍板。判定只看**权威后端**的提交结果 ——
   *    镜像写失败不能把已经提交的事务说成没提交，否则内存回滚、磁盘却留着新数据。
   *  · **H1 独立快照**：一次提交只序列化一次，再解析出**独立副本**交给后端。
   *    IndexedDB 的 `put` 发生在 microtask 之后，直接传活对象会让期间的内存改动混进
   *    这次提交的内容，让「这笔到底写了什么」不可预测。
   *  · **O5 同一份独立快照给两个消费者**：后端写入与 `committedAlarmItems` 读的是
   *    **同一次解析出来的那一份**，正常路径因此少一次全量 `JSON.parse`。
   *    它们本来就是同一个语义对象（「这次提交了什么」），此前各解析一份纯属重复；
   *    共享的是**已冻结的独立副本**，不是活对象，H1 不受影响。
   */
  async function writeSnapshot(payload, options) {
    // P2-C-R **写闸门**：唯一收口。
    //
    // 权威状态没有确认恢复成功（`failed` 或仍在 `unconfirmed`）时，**一笔都不许写**：
    // 既不能落权威后端，也不能落镜像 + 待回放凭据 —— 后者会在下一次启动时被
    // `replayPendingSnapshot()` 写进健康的 IDB，把旧数据换成这份空快照。
    // 抛错而不是静默返回，是为了让调用方**无法**把这次提交当成成功。
    if (!authoritativeWritesAllowed()) {
      blockedWriteCount += 1;
      const blocked = new Error("state-authority-" + stateAuthority);
      blocked.code = "state-authority-blocked";
      throw blocked;
    }
    const json = JSON.stringify(payload || currentPayload());
    // O5：唯一的一次全量解析 —— 结果既交给后端，也作为「已提交快照」发布。
    // 绝不能用 `payload || currentPayload()` 本身：那是活对象（items 就是 state.items）。
    const snapshot = JSON.parse(json);
    if (storage && storageReady) {
      await storage.save(snapshot); // 权威提交：失败即本次提交失败
      // H-07：这次写入**没有落进权威后端** —— IDB 本来可用（hasIdb 为真），
      // 但本次会话只降级落在 localStorage 镜像上。必须留待回放凭据，否则下次
      // IDB 恢复正常时 loadAsync 会读到 IDB 里的旧值，这段改动静默消失。
      //
      // 只在「本该用 IDB 却只落了镜像」时留凭据：设备**根本没有** IndexedDB 时
      // backend 恒为 local，IDB 不可能是权威，留凭据只会让每次启动都做一次无效重放。
      if (authoritativeBackendMissing()) markPendingReplay(json);
      // 只在**权威提交成功之后**才发布已提交快照（上面 await 抛错到不了这里）。
      committedAlarmItems = snapshot.items || [];
      if (!(options && options.deferNativeSync)) {
        bumpNativeSyncVersion();
        queueNativeReminderSync("save");
      }
      return true;
    }
    // 没有可用存储后端：localStorage 就是权威
    localStorage.setItem(KEY, json);
    // H-07：降级期的写入**必须留一份待回放凭据**。否则 IDB 一旦恢复，
    // loadAsync 会从 IDB 的旧值加载，这期间用户改的东西静默消失。
    markPendingReplay(json);
    committedAlarmItems = snapshot.items || [];
    if (!(options && options.deferNativeSync)) {
      bumpNativeSyncVersion();
      queueNativeReminderSync("save");
    }
    return true;
  }

  /**
   * P2-C-R：权威状态**已确认**（`loaded` / `empty`）才允许写。
   *
   * `unconfirmed`（恢复尝试还没结束）同样算关闭：读库期间的任何写入都发生在
   * 「还不知道权威里有什么」的窗口里，风险与 `failed` 完全相同。
   */
  function authoritativeWritesAllowed() {
    return stateAuthority === LOAD_LOADED || stateAuthority === LOAD_EMPTY;
  }

  /**
   * H-07：IndexedDB 可用、但**这一次没有用它**（本会话降级到了 localStorage 镜像）。
   *
   * `lib/storage.js` 的 `ensure()` 在 `openDb()` 失败时会整体切到 `backend = "local"`，
   * 此后所有写入都只落镜像 —— `storageReady` 仍然是 true，这条路径**不会**走上面的
   * 降级分支，所以必须单独识别，否则「IDB 打不开」这一最常见形态恰好漏掉。
   */
  function authoritativeBackendMissing() {
    try {
      return Lib.hasIdb() && storage.backend !== "idb";
    } catch (error) {
      return false;
    }
  }

  /**
   * P2-C-R 独立复验（2026-09-22）补的第一个判据：**这台设备到底有没有权威后端**。
   *
   * `authoritativeBackendMissing()` 只看 `storage.backend` 是不是 `idb`，覆盖不到
   * 「backend 确实已经选成 idb，但这一次 `get` 抛错了」的形态 —— 那条路径是从
   * `storage.load()` 内部抛出来的，`ensure()` 早已把 backend 置好。
   * 判断粒度的差别就是灾难与否：前者只对一半场景收口，漏掉的那一半（get 失败）
   * 恰好是**镜像有值**时最容易发生的。
   */
  function idbIsAvailable() {
    try {
      return !!Lib.hasIdb();
    } catch (error) {
      return false;
    }
  }

  /**
   * H-07 / D47：降级期写入的「待回放快照」。
   *
   * 降到 localStorage 之后**照旧立即落盘**（用户可见行为不变：写入仍然成功），
   * 但同时把这一份完整状态留在独立键里 —— IDB 恢复时由 `replayPendingSnapshot`
   * 写回权威后端，降级期间的改动不再丢失。
   */
  const PENDING_REPLAY_KEY = KEY + "-pending-replay";

  /** 当前内存状态是不是**只从镜像**来的（权威这一轮没有确认成功）。 */
  function stateCameFromMirror() {
    const reason = lastLoadReport && lastLoadReport.reason ? String(lastLoadReport.reason) : "";
    return reason === "mirror-recovered" ||
      reason === "mirror-recovered-unconfirmed-authority" ||
      reason === "degraded-mirror" ||
      reason === "degraded-mirror-unconfirmed-authority";
  }

  function markPendingReplay(json) {
    // P2-C-R 独立复验（2026-09-22）：待回放凭据**只能代表权威状态的降级写入**。
    //
    // 写闸门（`writeSnapshot` 首行）已经拦住了绝大多数路径，但凭据是「下一次启动会
    // 无条件覆盖权威」的授权书 —— 生成点自己也必须认得来源。镜像兜底出来的状态留凭据，
    // 等于把「这次读不到」改写成「下次一定会覆盖」，正是被复现的那条链。
    if (!authoritativeWritesAllowed() || stateCameFromMirror()) {
      console.error(
        "pending replay refused: state is not authority-confirmed",
        lastLoadReport ? lastLoadReport.reason : null
      );
      return;
    }
    try {
      localStorage.setItem(PENDING_REPLAY_KEY, JSON.stringify({ at: Date.now(), json: json }));
    } catch (error) {
      // 配额不足时**不能**影响主写入路径（localStorage 此刻就是权威，已经写成功了），
      // 但必须留下可见痕迹：这一份改动将无法自动回放到 IDB。
      console.error(
        "pending replay snapshot failed (degraded write will not be replayed):",
        error && error.message ? error.message : error
      );
    }
  }

  function readPendingReplay() {
    try {
      const raw = localStorage.getItem(PENDING_REPLAY_KEY);
      if (!raw) return null;
      const pending = JSON.parse(raw);
      return pending && typeof pending.json === "string" ? pending : null;
    } catch (error) {
      return null;
    }
  }

  function clearPendingReplay() {
    try { localStorage.removeItem(PENDING_REPLAY_KEY); } catch (error) {}
  }

  /** 上一次 `replayPendingSnapshot()` 是否**应用失败**（`null` = 没有失败）。 */
  let lastReplayFailure = null;

  /**
   * **提交闸门**：同一时刻只有一笔权威提交在跑，轮到谁谁才取快照。
   * 原生动作的校验、草稿变更、提交与发布整体在闸门内；普通保存排在它的结果之后，
   * 失败不会锁死后续提交，成功前也不会把未确认动作混入其它快照。
   */
  let commitChain = Promise.resolve();

  /**
   * O2：闸门只负责**串行与放行**，作业参数由调用方显式给出。
   *
   * 旧实现是 `commitChain.then(job, job)` —— `job` 会被当作 `then` 的处理器调用，
   * 参数是**前一笔的兑现值**（恒为 `undefined`），调用方给的选项原地丢失。
   * `save({ deferNativeSync: true })` 因此长期形同虚设：选项传不进 `writeSnapshot`，
   * 「只确认投影结果」的那次保存照旧请求下一轮原生对账。
   *
   * **快照仍然在轮到本笔时才取**：`writeSnapshot` 收到的 payload 依旧是 `undefined`，
   * `currentPayload()` 在作业体内、也就是闸门轮到它执行的那一刻才求值。
   * 这里只是把「作业 + 它的参数」一起入队，不提前冻结任何状态。
   */
  function runCommit(job, args) {
    const invoke = () => job.apply(null, args || []);
    // 前一笔不论成败都要放行下一笔，否则一次失败会永久卡住后续所有保存
    const next = commitChain.then(invoke, invoke);
    commitChain = next.then(() => {}, () => {});
    return next;
  }

  /**
   * F2 / I1：返回**真实的持久化 Promise**（过闸门）。
   *
   * 原生动作队列必须在数据真正落库之后才确认删除，所以不能再「发起了 save 就当已保存」——
   * 那样 handler 一返回原生就把事件删了，此时 IndexedDB 事务可能还没提交，崩溃即丢操作。
   */
  async function saveAsync(options) {
    // 位置参数与 `writeSnapshot(payload, options)` 对齐：payload 留空 = 轮到本笔时取当前状态
    return runCommit(writeSnapshot, [undefined, options]);
  }

  /**
   * H1：**只**抑制「动作同步变更体内部」的重复保存。
   *
   * `ackItem` / `completeItem` / `snoozeItem` 内部各自会 `save()`。当草稿 reducer 复用它们时，
   * 必须抑制内部保存，由事务出口一次提交完整草稿。
   *
   * 这个标记**只在同步变更体内为真**，所以丢弃是安全的：那个窗口是同步的，
   * 期间任何改动都在内存里，会被事务出口的快照一并提交。
   * 而提交期间的其它保存（用户点了完成 / 稍后 / 新建）**绝不能吞掉** ——
   * 它们会各自排进闸门，在前一笔定成败之后按当时的状态取快照。
   * （此前的计数器跨越 await 持续为正，会把这类保存静默丢弃。）
   */
  let suppressInnerSave = false;

  /**
   * O2：`options` 必须能一路走到 `writeSnapshot` 的位置参数上。
   *
   * 只有 `deferNativeSync: true` 一种语义：**这次保存只确认已知的排程投影结果**，
   * 不需要因为落库而再请求一次原生对账。它**不**影响持久化本身 —— 提交、镜像、
   * pending 回放、失败重试全部照旧；丢的只是由此触发的下一轮对账。
   */
  function save(options) {
    if (suppressInnerSave) return;
    const pending = saveAsync(options);
    pending.catch(error => {
      // P2-C-R：被写闸门拦下与「写库失败」是两件事，文案不能混 ——
      // 前者要告诉用户「数据还没恢复，所以一个字都没写」，而不是「下次会重试」。
      if (error && error.code === "state-authority-blocked") {
        toast("数据尚未恢复 · 已阻止写入，请先重试恢复");
      } else {
        toast("保存失败 · 修改仍保留在本机内存，下一次保存会重试");
      }
      console.error("State save failed:", error && error.message ? error.message : error);
    });
    return pending;
  }

  /* ---------- 统一事务：提交在途期的「后续状态命令」日志 ---------- */

  /**
   * 原生动作在不可见草稿上执行；提交尚未定成败时，UI 继续显示最后确认状态。
   * 同一事项或同一周期的用户命令在这个窗口内明确拒绝，避免它在旧状态上显示成功、
   * 却因新状态的业务前置条件变化而在重放时失效。无关事项的状态命令仍按顺序记录：
   * 提交成功后重放到草稿再发布，提交失败则可见状态本来就只含这些无关命令。
   */
  let inflightActionDepth = 0; // > 0 表示有动作的提交尚未定成败
  let pendingUserOps = [];     // 窗口期内接受的状态命令（按发生顺序）
  let suppressUserFeedback = false; // 重放期间不再重复弹提示
  let replayCreatedIds = null; // 当前命令重放时可复用的稳定业务 id
  let activeActionScope = null; // 尚未定成败的原生动作事务域（事项或整个周期）
  let applyingActionDraft = false;

  function itemConflictsWithActiveAction(item) {
    if (!item || !activeActionScope) return false;
    if (item.id === activeActionScope.itemId) return true;
    if (activeActionScope.seriesId && item.seriesId === activeActionScope.seriesId) return true;
    return item.repeatParentId === activeActionScope.itemId;
  }

  function isItemActionPending(id) {
    const item = state.items.find(x => x.id === id);
    return itemConflictsWithActiveAction(item);
  }

  function rejectPendingItemCommand() {
    toast("这条事项正在保存 · 请稍后重试");
    return false;
  }

  function commandConflicts(args, options) {
    if (!activeActionScope || !options || !options.userFacing) return false;
    if (options.globalConflict) return true;
    let id;
    if (typeof options.scopeId === "function") {
      // 命令的目标不是参数里的第一个对象（例如撤销：参数是一份「撤销记录」快照，
      // 里面才有 itemId）。没有这条通路，撤销会**静默绕过**同域冲突检查。
      try { id = options.scopeId.apply(null, args); } catch (error) { id = null; }
    } else {
      const index = options.itemArg == null ? 0 : options.itemArg;
      const arg = args[index];
      id = arg && typeof arg === "object" ? (arg.id || arg.__itemRef) : arg;
    }
    const item = state.items.find(x => x.id === id);
    return itemConflictsWithActiveAction(item);
  }

  /**
   * 执行一次状态命令并（若原生草稿正在提交）记进日志。
   *
   * 不在窗口期时零额外开销：直接调用，不做任何扫描。
   * 记录时保存的 `fn` 是**原始函数**：重放不会再次经过这里，也就不会被重复记录。
   *
   * 记录自足化参数，以及这次命令新建实例的稳定 id / 父实例身份。
   */
  function runUserOp(fn, args, options) {
    if (!applyingActionDraft && commandConflicts(args, options)) return rejectPendingItemCommand();
    if (inflightActionDepth <= 0) return fn.apply(null, args);
    const beforeIds = new Set(state.items.map(x => x.id));
    // 参数在**调用之前**自足化：此刻「参数是否指向现有事项」的判断才准
    // （新建时传入的字段包还没进 state.items，必须按值快照存，不能记成引用）
    const recorded = args.map(recordArg);
    const result = fn.apply(null, args);
    // false 是业务拒绝（缺对象、终态保护、幂等无效果），不是已接受命令。
    if (result === false) return false;
    const createdItems = state.items.filter(x => !beforeIds.has(x.id));
    const created = createdItems.map(x => x.id);
    const createdRecords = createdItems.map(x => ({
      id: x.id,
      repeatParentId: x.repeatParentId || null
    }));
    pendingUserOps.push({
      fn: fn,
      name: (options && options.name) || fn.name || "command",
      args: recorded,
      created: created,
      createdRecords: createdRecords
    });
    return result;
  }

  function takeReplayCreatedId() {
    if (!replayCreatedIds || !replayCreatedIds.length) return null;
    return replayCreatedIds.shift();
  }

  /**
   * 日志里的参数必须是**自足的值**，不能留发布草稿后可能被替换掉的对象引用。
   *
   * 发布草稿时事项对象可能重建（id 不变，对象引用变化）。
   * 若日志里存的是当初那个对象的引用，后续编辑就会写到已经离开 `state.items` 的旧对象上，
   * 用户保存的内容静默丢失。
   *  · 指向**现有事项**的参数 → 记成 id 引用，重放时按 id 重新解析；
   *  · 其它对象参数 → 存一份值快照（深拷贝），不受后续改动影响。
   */
  function recordArg(a) {
    if (!a || typeof a !== "object") return a;
    if (state.items.indexOf(a) >= 0) return { __itemRef: a.id };
    try {
      return JSON.parse(JSON.stringify(a));
    } catch (error) {
      return a;
    }
  }

  function resolveArg(a) {
    if (a && typeof a === "object" && a.__itemRef) {
      return state.items.find(x => x.id === a.__itemRef) || null;
    }
    return a;
  }

  function wrapUserOp(fn, options) {
    return function () {
      return runUserOp(fn, Array.prototype.slice.call(arguments), options);
    };
  }

  /**
   * 按原顺序把窗口期命令施加到已提交草稿。
   * 参数按 id 重新解析；任何无法解析、执行抛错或未消费的创建 id 都是事务错误，必须上抛，
   * 不能吞掉后继续并伪装成成功。派生 id 在创建时直接注入，不再靠「按数组顺序事后改 id」。
   */
  function replayUserOps(ops) {
    if (!ops || !ops.length) return 0;
    const prevSave = suppressInnerSave;
    const prevFeedback = suppressUserFeedback;
    suppressInnerSave = true;
    suppressUserFeedback = true;
    try {
      ops.forEach(op => {
        const specs = op.args || [];
        const args = [];
        for (let i = 0; i < specs.length; i++) {
          const value = resolveArg(specs[i]);
          if (value === null && specs[i] && specs[i].__itemRef) {
            throw new Error("transaction-replay-missing-item:" + specs[i].__itemRef);
          }
          args.push(value);
        }
        replayCreatedIds = (op.created || []).slice();
        // 若动作草稿已经建立了同一父实例的周期投影，采用用户命令首次执行时的稳定 id。
        // 这是按明确 parent identity 合并，不按数组顺序或触发时间猜测。
        (op.createdRecords || []).forEach(record => {
          if (!record || !record.repeatParentId) return;
          const existing = state.items.find(x => x.repeatParentId === record.repeatParentId);
          if (!existing || existing.id === record.id || state.items.some(x => x.id === record.id)) return;
          existing.id = record.id;
          const index = replayCreatedIds.indexOf(record.id);
          if (index >= 0) replayCreatedIds.splice(index, 1);
        });
        const applied = op.fn.apply(null, args);
        if (applied === false) {
          throw new Error("transaction-replay-business-rejected:" + (op.name || op.fn.name || "command"));
        }
        if (replayCreatedIds.length) {
          throw new Error("transaction-replay-unused-created-id:" + replayCreatedIds[0]);
        }
        replayCreatedIds = null;
      });
    } finally {
      replayCreatedIds = null;
      suppressUserFeedback = prevFeedback;
      suppressInnerSave = prevSave;
    }
    return ops.length;
  }

  function applyParsedState(parsed) {
    schemaMigrationNeeded = parsed.schema !== SCHEMA || (Array.isArray(parsed.items) && parsed.items.some(it =>
      !it || !it.scheduleBasis || it.dismissedUntil === undefined || it.reminderEvents === undefined
    ));
    state.items = Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : [];
    state.notes = Array.isArray(parsed.notes) ? parsed.notes : [];
    state.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    state.settings = Object.assign(state.settings, parsed.settings || {});
    if (state.settings.userMode !== "normal" && state.settings.userMode !== "beginner") {
      state.settings.userMode = "beginner";
    }
    syncUserMode();
    if (!state.settings.ai || typeof state.settings.ai !== "object") {
      state.settings.ai = {
        enabled: false,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
        autoOnSave: false
      };
    } else {
      state.settings.ai = Object.assign({
        enabled: false,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
        autoOnSave: false
      }, state.settings.ai);
    }
    ensureReviewSettings();
    state.items.forEach(it => {
      if (!it.review_status) it.review_status = "READY";
    });
    // N-03：冷启动基线。`committedAlarmItems` 此前**只在 `writeSnapshot` 里赋值**，
    // 于是「刚启动、还没提交过任何事务」时它恒为 `[]`；原生投递面板拿它当对照，
    // 找不到任何项 → 本该被自动忽略的旧投递会一直挂在面板上等用户手动处理。
    // 加载完成时，「最后一次已提交的快照」就等于刚读到的权威状态，这里补齐基线。
    // 用深拷贝与 `writeSnapshot` 口径一致：快照必须是独立副本，不被后续内存改动污染。
    committedAlarmItems = JSON.parse(JSON.stringify(state.items));
  }

  /**
   * H-07 / D47：IDB 恢复后把降级期的改动**重放**回权威后端。
   *
   * 返回 true = 已用待回放快照作为权威状态（调用方不要再拿可能更旧的 IDB 值覆盖）。
   *
   * **为什么「重放最后一份」就等于「按序重放」**：整个状态是一份**完整快照**、
   * 写入语义是 last-write-wins（既有契约），而降级期间本机唯一的写入方就是这条路径，
   * 所以中间态没有任何独立价值 —— 保留全部中间快照只会先撞爆 localStorage 配额。
   * 与 D39/D40 的「回滚 + 按序重放」不冲突：那里重放的是**用户命令**，这里重放的是**终态**。
   */
  async function replayPendingSnapshot() {
    lastReplayFailure = null;
    const pending = readPendingReplay();
    if (!pending) return false;
    let payload = null;
    try {
      payload = JSON.parse(pending.json);
    } catch (error) {
      clearPendingReplay();
      return false;
    }
    if (!payload || typeof payload !== "object") {
      clearPendingReplay();
      return false;
    }
    try {
      applyParsedState(payload);
    } catch (error) {
      // P2-C-R：这份快照**没能**被应用（内存可能已被改了一半）。调用方必须把它
      // 判成 `failed`，而不是「没有快照」—— 后者会让下游把半个状态当成权威。
      lastReplayFailure = error;
      return false;
    }
    try {
      await storage.save(payload);
      clearPendingReplay();
    } catch (error) {
      // 写回失败：内存已经是较新的状态，**保留**待回放快照留给下次启动再试 —— 绝不丢。
      console.error(
        "pending replay writeback failed (kept for next launch):",
        error && error.message ? error.message : error
      );
    }
    return true;
  }

  /**
   * 一次恢复尝试的判定结果（**三态**）。
   *
   * `writesAllowed` 是唯一的写闸门读数：只有 `loaded` / `empty` 为真。
   * `mirror` 记下镜像字节数（真机探针要用它核对「这轮到底有没有镜像」）。
   */
  function publishLoadReport(status, reason, attempt, at, detail) {
    stateAuthority = status;
    lastLoadReport = {
      status: status,
      reason: reason,
      detail: detail ? String((detail && detail.message) || detail) : null,
      attempt: attempt,
      at: at,
      backend: storage ? storage.backend : null,
      mirrorBytes: mirrorBytes(),
      writesAllowed: status !== LOAD_FAILED
    };
    return lastLoadReport;
  }

  /** 镜像键的原始字节数（`null` = 没有镜像键）；只读，不改任何东西。 */
  function mirrorBytes() {
    try {
      if (typeof localStorage === "undefined" || localStorage == null) return null;
      const raw = localStorage.getItem(KEY);
      return raw == null ? null : String(raw).length;
    } catch (error) {
      return null;
    }
  }

  /**
   * 权威状态读取的**唯一入口**（P2-C-R：返回三态判定，不再返回布尔）。
   *
   * 旧实现把四种完全不同的处境折叠成同一个 `false`，而 `init()` 又不看返回值：
   *   · 权威读到空（真首启）；
   *   · 打开/读取/解析失败且镜像也没东西；
   *   · 读到了值但回放时抛错；
   * 于是「没有确认恢复成功」与「确认从未有数据」在下游**无法区分** ——
   * 两者都会开放保存、原生对账与业务心跳，内存里那份空收件箱随时可能变成新的权威快照。
   *
   * 判定规则（每条都保留原因，供恢复面板与真机探针读取）：
   *   · 读到并应用成功                                  ⇒ `loaded`
   *   · 待回放快照被采用（H-07）                        ⇒ `loaded`
   *   · 权威**成功读取**到空，且镜像与待回放都没有残留   ⇒ `empty`
   *   · 其余一切（打开/读取/解析/回放失败、读到空但仍有残留证据、
   *     镜像恢复不了数据）                              ⇒ `failed` ⇒ 写闸门关闭
   */
  async function loadAsync() {
    loadAttempts += 1;
    const attempt = loadAttempts;
    const at = Date.now();
    let authoritativeError = null;

    if (storage) {
      try {
        const parsed = await storage.load();
        storageReady = true;
        // H-07：先把降级期攒下的改动重放回权威后端，并以它作为权威状态；
        // 否则「降级期间改过的东西」会被这里读到的旧值静默覆盖。
        //
        // 只有**真的换回了 IDB** 才重放：仍跑在镜像上时重放会白白清掉凭据，
        // 下一次 IDB 恢复就再也拿不回这段改动（这一条是本轮真机/探测器实测暴露的盲区）。
        if (storage.backend === "idb" && await replayPendingSnapshot()) {
          return publishLoadReport(LOAD_LOADED, "pending-replay", attempt, at);
        }
        // 回放**失败**（应用那份快照时抛错）不是「没有快照」：内存可能已经被改了一半，
        // 这时既不能宣布首启、也不能开放保存。
        if (lastReplayFailure) {
          return publishLoadReport(LOAD_FAILED, "pending-replay-failed", attempt, at, lastReplayFailure);
        }
        if (parsed == null) {
          // 权威后端**本该可用却没用上**（`openDb()` 失败 ⇒ 后端整体降级为 local）：
          // 这时的「空」来自镜像，不是权威 —— 不能据此宣布首启。
          // 漏掉这一条的后果很具体：本次启动会照常开放保存 ⇒ 那次提交走
          // `markPendingReplay`（`authoritativeBackendMissing()` 恰好为真），
          // 下一次启动 IDB 恢复正常时，这份**空快照**经 `replayPendingSnapshot()`
          // 写回权威 —— 「读不到」就此变成「覆盖掉」。
          if (authoritativeBackendMissing()) {
            return publishLoadReport(LOAD_FAILED, "authoritative-backend-degraded", attempt, at);
          }
          // 「权威读到空」只有在**别处也没有半点残留**时才等于「从未有过数据」：
          // `storage.load()` 已经尝试过把镜像迁移进 IDB，走到这里说明镜像不可解析
          // （或被清空但键还在）／待回放快照还在 —— 那是「读到空」，不是「真的空」。
          if (mirrorBytes() != null || readPendingReplay() != null) {
            return publishLoadReport(LOAD_FAILED, "authoritative-empty-with-residual-evidence", attempt, at);
          }
          return publishLoadReport(LOAD_EMPTY, "authoritative-empty", attempt, at);
        }
        if (typeof parsed !== "object" || Array.isArray(parsed)) {
          // 值读出来了但不是可以回放的状态对象（例如被别的东西写脏了）。
          return publishLoadReport(LOAD_FAILED, "authoritative-value-not-object", attempt, at);
        }
        applyParsedState(parsed);
        // ⚠️ 本轮是否真的读到权威，和「这次有没有用到 IDB 后端」是两件事：
        // 设备**本来就有** IndexedDB 时，只要这次没用上它，`parsed` 就是镜像里的内容
        // （`ensure()` 已在 `openDb()` 失败时把后端整体降为 local），它比 IDB 里的那份
        // **旧**，不是权威 —— 把它当 loaded 会立刻开放写入：本次会话留下的待回放凭据，
        // 会在下一次健康启动里被优先回放，把更新的权威数据覆盖掉。
        // 独立复验的「双启动反例」（IDB 两条 / 镜像一条）逐条复现了这条链，故此处必须 fail closed。
        //
        // 设备**根本没有** IndexedDB 时不一样：localStorage 本身就是权威
        // （`lib/storage.js` 的后端契约），这时照旧判 loaded，不允许顺手降级用户的可用性。
        if (authoritativeBackendMissing()) {
          return publishLoadReport(
            LOAD_FAILED, "degraded-mirror-unconfirmed-authority", attempt, at
          );
        }
        // 降级路径（IDB 本该可用但只落了镜像）与真正的权威读要分开记：
        // 两者都算 `loaded`（H-07 的待回放凭据会兜住差异），但真机排查时
        // 「这一次到底是从哪读的」是第一个要看的事实。
        return publishLoadReport(LOAD_LOADED, "authoritative", attempt, at);
      } catch (error) {
        // 打开 / 读取 / 解析（都由 `storage.load()` 内部完成）失败：权威后端这次
        // **没有**给出可用的值。记下原因，然后走唯一允许的降级来源 —— 镜像。
        storageReady = false;
        authoritativeError = error;
      }
    }

    const mirror = recoverFromMirror();
    if (mirror.status === LOAD_LOADED) {
      // ⚠️ 镜像**不是**权威：它只在「IDB 还是空的」时代表上一次落盘的样子。
      // 设备有 IDB 而这次读不到它 ⇒ 我们**不知道**权威里有没有更新的数据，此时把镜像
      // 提升为可写 loaded，等于允许用一份可能过期的快照去覆盖权威：
      //   本次启动开放保存 → 降级写入留下待回放凭据 → 下次健康启动优先回放 → 覆盖 IDB。
      // 这是独立复验用「IDB 两条 / 镜像一条」复现出的完整链，故 fail closed：
      // 内存里可以留下镜像内容供**只读查看**（什么都没写出去），但不判 loaded、不开写闸门。
      if (idbIsAvailable()) {
        return publishLoadReport(
          LOAD_FAILED, "mirror-recovered-unconfirmed-authority", attempt, at, authoritativeError
        );
      }
      // 环境根本没有 IndexedDB ⇒ localStorage 就是权威（`lib/storage.js` 后端契约），
      // 这时镜像恢复 = 权威恢复，照旧判 loaded。
      return publishLoadReport(LOAD_LOADED, "mirror-recovered", attempt, at, authoritativeError);
    }
    // ⚠️ 这里刻意**不**把「镜像也没有值」判成 `empty`。
    // 权威读失败本身就意味着「我们不知道权威里有什么」，此时宣布首启等于把
    // 「读不到」当成「不存在」—— 那正是本轮要封的那个窗口（空快照覆盖旧数据）。
    // 只有权威**成功读取**到空才算首启（见上面的 `authoritative-empty`）。
    return publishLoadReport(
      LOAD_FAILED,
      "authoritative-read-failed:" + mirror.reason,
      attempt,
      at,
      authoritativeError || mirror.error
    );
  }

  /**
   * 权威读失败时**唯一**允许的降级来源：localStorage 镜像。
   *
   * 与 `loadSync()` 的区别就在**不折叠**：读不到 / 解析不了 / 应用不了各自有名字，
   * 调用方据此决定「是不是可以宣布首启」（答案永远是「不可以」）。
   */
  function recoverFromMirror() {
    let raw = null;
    try {
      if (typeof localStorage === "undefined" || localStorage == null) {
        return { status: LOAD_FAILED, reason: "mirror-unavailable" };
      }
      raw = localStorage.getItem(KEY);
    } catch (error) {
      return { status: LOAD_FAILED, reason: "mirror-unreadable", error: error };
    }
    if (raw == null) return { status: LOAD_EMPTY, reason: "mirror-absent" };
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { status: LOAD_FAILED, reason: "mirror-unparsable", error: error };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: LOAD_FAILED, reason: "mirror-not-object" };
    }
    try {
      applyParsedState(parsed);
    } catch (error) {
      return { status: LOAD_FAILED, reason: "mirror-apply-failed", error: error };
    }
    return { status: LOAD_LOADED, reason: "mirror-recovered" };
  }

  function loadSync() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      applyParsedState(JSON.parse(raw));
      return true;
    } catch (e) {
      return false;
    }
  }

  function load() {
    return loadSync();
  }

  function normalizeItem(it) {
    const item = {
      id: it.id || uid(),
      title: it.title || "未命名",
      note: it.note || "",
      tags: Array.isArray(it.tags) ? it.tags : [],
      url: it.url || "",
      projectId: it.projectId || "",
      priority: it.priority || "normal",
      status: it.status || "waiting",
      triggerAt: it.triggerAt || null,
      windowStart: it.windowStart || null,
      windowEnd: it.windowEnd || null,
      deadlineAt: it.deadlineAt || null,
      repeat: it.repeat || null,
      createdAt: it.createdAt || Date.now(),
      acknowledgedAt: it.acknowledgedAt || null,
      completedAt: it.completedAt || null,
      snoozeCount: it.snoozeCount || 0,
      deliveredAt: it.deliveredAt || null,
      remindCount: it.remindCount || 0,
      lastRemindAt: it.lastRemindAt || null,
      lastAlertShownAt: it.lastAlertShownAt || null,
      scheduleBasis: it.scheduleBasis || null,
      localTrigger: it.localTrigger || null,
      snoozedAt: it.snoozedAt || null,
      snoozeDelayMs: it.snoozeDelayMs == null ? null : it.snoozeDelayMs,
      dismissedUntil: it.dismissedUntil || null,
      review_status: it.review_status || "READY",
      reviewed_at: it.reviewed_at || null,
      sourceTitle: it.sourceTitle || "",
      sourceApp: it.sourceApp || "",
      delivery_mode: it.delivery_mode || null,
      isFallbackTrigger: !!it.isFallbackTrigger,
      // L02：截止保护的阶段消费状态（key = 阶段 + 截止时间）
      deadlineStageKey: it.deadlineStageKey || null,
      // F1：按阶段记账的截止事件表 { "p24@<deadline>": { at, state } }
      // state: "scheduled" 已排期 / "delivered" 已送达（不再重排）
      deadlineEvents: it.deadlineEvents && typeof it.deadlineEvents === "object"
        ? it.deadlineEvents : {},
      // D43：按触发点记账的单次提醒台账 { "<attempt>@<原定触发点>": { at, state } }
      // state: "scheduled" 已排期 / "delivered" 已送达 / "cancelled" 排程被撤销
      // 与 deadlineEvents 同构；补投的准入全靠它，缺了就会每次对账重复补一条。
      reminderEvents: it.reminderEvents && typeof it.reminderEvents === "object"
        ? it.reminderEvents : {},
      // D23：归档重开暂停截止保护时置位，需用户显式恢复
      deadlinePaused: !!it.deadlinePaused,
      // L03：ACK 周期已推进过的标记，避免完成时再生成一条下期
      ackAdvancedAt: it.ackAdvancedAt || null,
      // L04：数据版本 —— 通知事件据此识别「已被改写的旧通知」
      rev: it.rev == null ? 1 : Number(it.rev),
      // F3：周期系列身份 —— 「停止重复」要能找到同系列的未来实例
      seriesId: it.seriesId || (it.repeat && it.repeat.every ? "s_" + uid() : null),
      // 稳定的周期依赖身份：同一父实例至多派生一个下一期，不能靠时刻或数组位置猜。
      repeatParentId: it.repeatParentId || null
    };
    if (!item.delivery_mode) {
      item.delivery_mode = (item.priority === "important" || item.priority === "critical")
        ? "alarm"
        : (state.settings.defaultDeliveryMode || "notification");
    }
    if (NativeReminders.migrateItem) NativeReminders.migrateItem(item);
    return item;
  }

  /** D25 赋值快照：有标记→alarm；未标记→当前全局默认 */
  function resolveDeliveryMode(priority) {
    if (priority === "important" || priority === "critical") return "alarm";
    return state.settings.defaultDeliveryMode === "alarm" ? "alarm" : "notification";
  }

  function makeItem(o) {
    if (o && o.delivery_mode == null && o.priority) {
      o = Object.assign({}, o, { delivery_mode: resolveDeliveryMode(o.priority) });
    }
    return normalizeItem(o);
  }



  /**
   * L04：任何会改变「时间 / 状态」的写入都推进版本号。
   * 通知事件携带投递时的版本，回来时对不上就说明它是「已经过期的旧通知」，
   * 不得再覆盖新状态、也不得再推进一次周期。
   */
  function bumpRev(it) {
    if (!it) return;
    it.rev = (Number(it.rev) || 0) + 1;
  }

  /**
   * 截止保护的阶段身份（L02 / INV-05）。
   *
   * **唯一实现在 `lib/reminder.js`**。这里不再保留「Lib 缺失时按 24h/2h 自己算一份」的兜底 ——
   * 那份兜底与规范实现是**两套边界常量**，一旦生效，界面上看不出任何差异，只是阶段判定
   * 悄悄换了标准（与 native-reminders 里「只排 p24、丢掉 p2」是同一类静默降级）。
   */
  function deadlineStageKeyOf(deadlineAt, now) {
    return Lib.deadlineStageKey(deadlineAt, now);
  }

  /** 已完成 / 已归档是终态：只允许通过明确的恢复动作重开（L04） */
  function isTerminal(it) {
    return !!it && (it.status === "archived" || it.status === "completed");
  }

  /**
   * L04：事件里的数据版本是否「可知」。
   * 缺失 / 0 / 非数字都当作未知 —— 这时不做版本校验，
   * 避免整条原生链路丢版本后所有通知按钮集体失效（V02）。
   */
  function hasKnownRev(rev) {
    if (rev == null || rev === "") return false;
    const n = Number(rev);
    return Number.isFinite(n) && n > 0;
  }

  /**
   * L01 / R5 / D17：只有「系统兜底时间」的记录不发事项提醒。
   *  · 用户手选或解析出的真实时间照常生效（Review 只管内容质量）；
   *  · Review 关闭后一律按普通事项正常提醒（V0.2 §9.2）。
   */
  function isFallbackSuppressed(it) {
    return !!it && !!it.isFallbackTrigger && ensureReviewSettings().enabled;
  }

  /**
   * V06：首页「需要注意」的判定，与原生投影共用同一套兜底语义。
   *
   * 三处判断此前各不相同（前台一律抑制、首页只看 isDue、原生只看 NEEDS_REVIEW），
   * 于是出现「已过期的兜底记录出现在需要注意」而「确认后的兜底记录原生又排正式提醒」。
   * 兜底记录只有一种方式进入需要注意：**被截止保护拉起**（那时 status 才会变成 due）。
   */
  function isAttentionDue(it, now) {
    if (!it || isTerminal(it)) return false;
    if (isFallbackSuppressed(it)) return it.status === "due";
    return isDue(it, now) || it.status === "due";
  }

  /* ---------- Deferred Clarification / 延迟澄清 ---------- */
  function ensureReviewSettings() {
    if (!state.settings.review) {
      state.settings.review = {
        enabled: true,
        hour: 21,
        minute: 30,
        windowEndHour: 23,
        windowEndMinute: 0,
        // D22：60 分钟 × 2 次补提醒（当天最多 3 次）
        followupMs: 60 * 60 * 1000,
        maxFollowups: 2,
        lastNotifiedAt: 0,
        followupCount: 0,
        snoozedUntil: 0,
        skippedUntil: 0,
        sessionStatus: "idle",
        lastSessionKey: ""
      };
    } else {
      // 升级旧参数：45min×1 → 60min×2
      if (state.settings.review.followupMs == null || state.settings.review.followupMs === 45 * 60 * 1000) {
        state.settings.review.followupMs = 60 * 60 * 1000;
      }
      if (state.settings.review.maxFollowups == null || state.settings.review.maxFollowups === 1) {
        state.settings.review.maxFollowups = 2;
      }
      // 迁移：旧的 lastSessionKey 按分钟编码（无 "W:" / "S:" 前缀），会绕过 maxFollowups，直接作废
      const lsk = state.settings.review.lastSessionKey;
      if (lsk && lsk.indexOf("W:") !== 0 && lsk.indexOf("S:") !== 0) {
        state.settings.review.lastSessionKey = "";
        state.settings.review.followupCount = 0;
      }
    }
    return state.settings.review;
  }

  /** D17：兜底 = 下一个 Review Window；Review 关闭时退次日晚间 20:00 */
  function fallbackTriggerAt() {
    const rs = ensureReviewSettings();
    if (rs.enabled) return nextReviewWindowStart();
    const d = addDays(new Date(), 1);
    d.setHours(20, 0, 0, 0);
    return d.getTime();
  }

  const VAGUE_RE = /^(这个|那个|它|something)?\s*(以后|后面|之后|过阵子|回头|有空|有时间)?\s*(看看|看一下|关注|处理|研究|了解)?\s*$/;

  function isVagueContent(title, note, url) {
    const t = String(title || "").trim();
    const n = String(note || "").trim();
    if (!t && !n && !url) return true;
    if (url && t.length < 3 && !n) return true;
    if (t.length <= 6 && VAGUE_RE.test(t)) return true;
    if (/^(这个|那个)?(以后|后面|过阵子|回头).{0,6}(看看|看一下)?$/.test(t)) return true;
    if (/^(看看这个|看一下|研究一下|了解一下)$/.test(t)) return true;
    return false;
  }

  function detectNeedsReview(opts) {
    const title = opts.title || "";
    const note = opts.note || "";
    const url = opts.url || "";
    const triggerAt = opts.triggerAt || null;
    const confidence = opts.confidence || "none";
    const userKeep = !!opts.userKeep;

    if (userKeep) return true;
    if (!triggerAt) return true;
    if (confidence === "low" || confidence === "none") return true;
    if (isVagueContent(title, note, url)) return true;
    if (url && !title && !note) return true;
    return false;
  }

  function needsReviewItems() {
    return state.items.filter(it =>
      it &&
      it.review_status === "NEEDS_REVIEW" &&
      it.status !== "archived" &&
      it.status !== "completed"
    );
  }

  /**
   * 整理会话的「本次」标识。**必须按窗口取，不能按分钟取**。
   *
   * 按分钟取会让 key 每分钟都变，配合 maybeReviewSession 里
   * `lastSessionKey !== key → followupCount = 0` 的重置逻辑，
   * followupCount 永远回不到上限 → maxFollowups 失效 → 窗口内每分钟发一条（D22 被绕过）。
   */
  function reviewSessionKey(d, rs) {
    const st = rs || ensureReviewSettings();
    const start = new Date(d);
    start.setHours(st.hour != null ? st.hour : 21, st.minute != null ? st.minute : 30, 0, 0);
    // now 早于今天的窗口起点 → 归属上一个已开始的窗口
    if (start.getTime() > d.getTime()) start.setDate(start.getDate() - 1);
    return "W:" + start.getFullYear() + "-" + (start.getMonth() + 1) + "-" + start.getDate() +
      "T" + pad(start.getHours()) + ":" + pad(start.getMinutes());
  }

  function nextReviewWindowStart(from) {
    const rs = ensureReviewSettings();
    const base = from || new Date();
    const start = new Date(base);
    start.setHours(rs.hour != null ? rs.hour : 21, rs.minute != null ? rs.minute : 30, 0, 0);
    if (start.getTime() <= base.getTime()) start.setDate(start.getDate() + 1);
    return start.getTime();
  }

  function inReviewWindow(now) {
    const rs = ensureReviewSettings();
    if (!rs.enabled) return false;
    const d = new Date(now || Date.now());
    const cur = d.getHours() * 60 + d.getMinutes();
    const start = (rs.hour != null ? rs.hour : 21) * 60 + (rs.minute != null ? rs.minute : 30);
    const end = (rs.windowEndHour != null ? rs.windowEndHour : 23) * 60 +
      (rs.windowEndMinute != null ? rs.windowEndMinute : 0);
    if (start === end) return false;
    if (start < end) return cur >= start && cur < end;
    return cur >= start || cur < end;
  }

  async function fireReviewNotification(count) {
    if (!state.settings.notify) return;
    const title = "待整理";
    const body = "有 " + count + " 条随手记录待整理 · 预计只需几分钟";
    // D19：走 LocalNotifications / Web 通知，不再用全屏闹钟
    const bridge = systemBridge();
    if (NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid()) {
      // 原生侧由 reconcile/buildReviewDesired 排程；此处仅在应用内 toast
      return;
    }
    if (bridge && bridge.showNotification) {
      try {
        await bridge.showNotification({ title, body, id: 91001 });
        return;
      } catch (e) {}
    }
    showSystemNotification({
      title,
      body,
      tag: "review-session",
      requireInteraction: true,
      data: { itemId: "review-session" }
    });
  }

  function maybeReviewSession(now) {
    now = now || Date.now();
    const rs = ensureReviewSettings();
    if (!rs.enabled) return;
    const queue = needsReviewItems();
    if (!queue.length) {
      rs.sessionStatus = "idle";
      return;
    }
    const snoozeAt = rs.snoozedUntil && inQuietHours(new Date(rs.snoozedUntil))
      ? quietEnd(new Date(rs.snoozedUntil)) : Number(rs.snoozedUntil) || 0;
    if (snoozeAt && now < snoozeAt) return;
    if (rs.skippedUntil && now < rs.skippedUntil) return;
    // D20：宽限期（snoozedUntil 后 1 小时）一过即失效。
    // 否则 snoozeDue 永远为真，会一直顶掉后续窗口的提醒额度。
    if (snoozeAt && now >= snoozeAt + 3600000) rs.snoozedUntil = 0;
    if (inQuietHours(new Date(now))) return;
    if (!inReviewWindow(now) && !(rs.snoozedUntil && now >= rs.snoozedUntil)) {
      // allow snoozed follow-up outside window briefly handled above
      if (!rs.snoozedUntil) return;
    }

    const windowOpen = inReviewWindow(now);
    const snoozeDue = rs.snoozedUntil && now >= rs.snoozedUntil;
    if (!windowOpen && !snoozeDue) return;

    // 一次「稍后」拥有独立额度（用户主动要求到点再提一次）；
    // 窗口内其余提醒共享同一个窗口额度，由 maxFollowups + followupMs 共同约束。
    // 注：稍后额度的后续补充会撞上 1 小时宽限期上界，因此一次「稍后」实际只提一次。
    const key = snoozeDue ? "S:" + Number(rs.snoozedUntil) : reviewSessionKey(new Date(now), rs);

    const maxFollowups = rs.maxFollowups != null ? rs.maxFollowups : 2;
    const maxNotifications = snoozeDue ? 1 : 1 + maxFollowups;
    if (rs.lastSessionKey === key && rs.followupCount >= maxNotifications) {
      // already fully notified for this window
      return;
    }

    let shouldNotify = false;
    if (rs.lastSessionKey !== key) {
      rs.lastSessionKey = key;
      rs.followupCount = 0;
      rs.sessionStatus = "due";
      shouldNotify = true;
    } else if (rs.followupCount < maxNotifications &&
      now - (rs.lastNotifiedAt || 0) >= (rs.followupMs || 60 * 60 * 1000)) {
      shouldNotify = true;
    }

    if (shouldNotify) {
      rs.followupCount += 1;
      rs.lastNotifiedAt = now;
      rs.sessionStatus = "delivered";
      save();
      fireReviewNotification(queue.length);
      toast("有 " + queue.length + " 条随手记录待整理", "开始整理", () => openReviewSession());
    }
  }

  function openReviewSession() {
    const queue = needsReviewItems().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (!queue.length) {
      toast("没有待整理事项");
      return;
    }
    state.ui.reviewQueue = queue.map(it => it.id);
    state.ui.reviewIndex = 0;
    ensureReviewSettings().sessionStatus = "started";
    save();
    openSheet("sheetReview");
    renderReviewCard();
  }

  function currentReviewItem() {
    const id = state.ui.reviewQueue[state.ui.reviewIndex];
    return state.items.find(x => x.id === id) || null;
  }

  function renderReviewCard() {
    const total = state.ui.reviewQueue.length;
    const idx = state.ui.reviewIndex;
    const progress = $("#reviewProgress");
    const body = $("#reviewBody");
    // 每张卡片是独立的一次「采用/不采用时间」判断，不能继承上一条的选择
    reviewTriggerUserPicked = false;
    if (!body) return;
    if (idx >= total) {
      if (progress) progress.textContent = "全部处理完成";
      body.innerHTML = '<div class="empty"><div class="empty-mark">✓</div><h3>整理完成</h3><p>已确认的记录已进入正常提醒流程。</p></div>';
      const foot = $("#reviewFoot");
      if (foot) foot.innerHTML = '<button class="btn primary" data-close="sheetReview">完成</button>';
      return;
    }
    const it = currentReviewItem();
    if (!it) {
      state.ui.reviewIndex += 1;
      renderReviewCard();
      return;
    }
    if (progress) progress.textContent = (idx + 1) + " / " + total;
    // D16：显式展示系统解析结果；无时间时必须写「未设定时间」
    // L05：兜底值本身不是「已定时间」，说清楚确认后会顺延到下一个整理窗口
    const parsedHint = it.isFallbackTrigger
      ? "未设定时间 · 确认后顺延到下一个整理窗口（" + fmtTime(fallbackTriggerAt()) + "）"
      : (!it.triggerAt
        ? "未设定时间"
        : fmtTime(it.triggerAt) + (it.deadlineAt ? " · 截止 " + fmtDate(it.deadlineAt) : ""));
    const sourceBits = [];
    if (it.sourceTitle) sourceBits.push(escapeHtml(it.sourceTitle));
    if (it.url) sourceBits.push(escapeHtml(it.url));
    if (it.sourceApp) sourceBits.push(escapeHtml(it.sourceApp));
    sourceBits.push("记录于 " + fmtTime(it.createdAt));

    body.innerHTML =
      '<div class="detail-title">' + escapeHtml(it.title || "未命名") + "</div>" +
      (it.note ? '<p style="color:var(--muted);font-size:0.9rem;margin-bottom:10px;white-space:pre-wrap">' + escapeHtml(it.note) + "</p>" : "") +
      '<dl class="detail-rows">' +
      '<div class="detail-row"><dt>原始记录</dt><dd>' + escapeHtml(it.title || "") + "</dd></div>" +
      '<div class="detail-row"><dt>系统解析</dt><dd>' + escapeHtml(parsedHint) + "</dd></div>" +
      (sourceBits.length ? '<div class="detail-row"><dt>来源</dt><dd>' + sourceBits.join("<br>") + "</dd></div>" : "") +
      "</dl>" +
      '<div class="field"><label for="reviewTitle">标题</label><input id="reviewTitle" type="text" value="' + escapeHtml(it.title || "") + '" /></div>' +
      // L05：兜底记录不再把兜底值预填进输入框 —— 预填会让「确认」看起来像采用了那个时间
      '<div class="field"><label for="reviewTrigger">提醒时间</label><input id="reviewTrigger" type="datetime-local" value="' +
      (it.isFallbackTrigger ? "" : toLocalInput(it.triggerAt)) + '"' +
      (it.isFallbackTrigger ? ' placeholder="未设定 · 不选则顺延到下一个整理窗口"' : "") + " /></div>" +
      '<div class="field"><label for="reviewNote">备注（可选）</label><input id="reviewNote" type="text" value="' + escapeHtml(it.note || "") + '" placeholder="例如：主要想看它的调度机制" /></div>';

    // L05：只有用户真的手动改过提醒时间，才算「明确采用这个时间」
    const trigInput = $("#reviewTrigger");
    if (trigInput && trigInput.addEventListener) {
      trigInput.addEventListener("change", () => { reviewTriggerUserPicked = true; });
    }

    // P0-3：「稍后 / 跳过本次」必须随每次渲染重建 —— 整块替换 innerHTML 会把静态节点连监听器一起丢掉
    const foot = $("#reviewFoot");
    if (foot) {
      foot.innerHTML =
        '<button class="btn secondary" id="reviewSnooze">稍后</button>' +
        '<button class="btn secondary" id="reviewSkip">跳过本次</button>' +
        '<button class="btn secondary" id="reviewKeep">留着待整理</button>' +
        '<button class="btn secondary" id="reviewDelete">删除</button>' +
        '<button class="btn secondary" id="reviewConfirm">确认</button>' +
        '<button class="btn primary" id="reviewSave">保存修改</button>';
      $("#reviewSnooze").onclick = () => openSheet("sheetReviewSnooze");
      $("#reviewSkip").onclick = skipReviewThisTime;
      // L05：逐条保留并前进 —— 「稍后 / 跳过本次」管的是整场会话，不是单条
      $("#reviewKeep").onclick = reviewKeepCurrent;
      $("#reviewDelete").onclick = reviewDelete;
      $("#reviewConfirm").onclick = reviewConfirm;
      $("#reviewSave").onclick = reviewSaveEdit;
    }
  }

  /**
   * L05：确认 ≠ 采用系统兜底时间。三种来源分开处理 ——
   *  · 用户在卡片里明确改过时间 → 采用，并解除兜底标记；
   *  · 记录本来就有真实时间 → 保留；
   *  · 只有兜底值（或时间已过期）→ 顺延到下一个整理窗口，**不生成立即到期提醒**。
   */
  function resolveReviewTrigger(it) {
    const input = $("#reviewTrigger");
    const typed = input ? parseLocalInput(input.value) : null;
    if (reviewTriggerUserPicked && typed) return { triggerAt: typed, keepFallback: false };
    if (it.isFallbackTrigger) return { triggerAt: fallbackTriggerAt(), keepFallback: true };
    if (it.triggerAt) return { triggerAt: it.triggerAt, keepFallback: false };
    return { triggerAt: fallbackTriggerAt(), keepFallback: true };
  }

  function markReviewDone(item, extra) {
    if (!item) return false;
    item.review_status = "REVIEWED";
    item.reviewed_at = Date.now();
    if (extra && extra.triggerAt != null) {
      item.triggerAt = extra.triggerAt;
      item.scheduleBasis = "wall-clock";
      item.localTrigger = toLocalInput(extra.triggerAt);
      if (item.triggerAt > Date.now() && (item.status === "due" || item.status === "acknowledged")) {
        item.status = "waiting";
      }
    }
    // 只有「用户明确采用了一个时间」才解除兜底标记（L01）
    if (!(extra && extra.keepFallback)) item.isFallbackTrigger = false;
    if (extra && extra.title != null) item.title = extra.title;
    if (extra && extra.note != null) item.note = extra.note;
    bumpRev(item);
    return true;
  }

  function reviewConfirm() {
    const it = currentReviewItem();
    if (!it) return;
    const resolved = resolveReviewTrigger(it);
    if (markReviewDone(it, { triggerAt: resolved.triggerAt, keepFallback: resolved.keepFallback }) === false) return;
    save();
    state.ui.reviewIndex += 1;
    queueNativeReminderSync();
    renderReviewCard();
    render();
  }

  function reviewSaveEdit() {
    const it = currentReviewItem();
    if (!it) return;
    const title = ($("#reviewTitle") && $("#reviewTitle").value.trim()) || it.title;
    const resolved = resolveReviewTrigger(it);
    const note = $("#reviewNote") ? $("#reviewNote").value.trim() : it.note;
    if (markReviewDone(it, {
      title,
      triggerAt: resolved.triggerAt,
      keepFallback: resolved.keepFallback,
      note
    }) === false) return;
    save();
    state.ui.reviewIndex += 1;
    queueNativeReminderSync();
    renderReviewCard();
    render();
  }

  /**
   * L05 / V0.2 §9.4「中途退出：逐条即时持久化，下次只继续剩余项」。
   * 「稍后 / 跳过本次」管的是整场会话，不能拿来处理「这一条我还想不清」——
   * 于是需要一个逐条的「留着待整理」出口：本条留在队列里，先处理下一条。
   */
  function reviewKeepCurrent() {
    const it = currentReviewItem();
    if (!it) return;
    state.ui.reviewIndex += 1;
    renderReviewCard();
    toast("已保留这条 · 下次整理再处理");
  }

  function reviewDelete() {
    const it = currentReviewItem();
    if (!it) return;
    if (deleteItem(it.id) === false) return;
    state.ui.reviewIndex += 1;
    renderReviewCard();
  }

  function snoozeReview(ms, label) {
    const rs = ensureReviewSettings();
    rs.snoozedUntil = Date.now() + ms;
    rs.sessionStatus = "snoozed";
    save();
    closeSheet("sheetReview");
    toast("待整理稍后提醒 · " + label);
    // D19：普通通知，不走全屏闹钟
    fireReviewNotification(needsReviewItems().length);
    queueNativeReminderSync();
  }

  function skipReviewThisTime() {
    const rs = ensureReviewSettings();
    rs.skippedUntil = nextReviewWindowStart();
    rs.sessionStatus = "skipped";
    save();
    closeSheet("sheetReview");
    toast("已跳过本次 · 下个整理时间再见");
  }

  /** D6/D20：窗口 ∪ 宽限期内显著，平时弱形态；无待整理时不渲染 */
  function inReviewHighlight(now) {
    now = now || Date.now();
    const rs = ensureReviewSettings();
    if (inReviewWindow(now)) return true;
    if (rs.snoozedUntil && now >= rs.snoozedUntil && now < rs.snoozedUntil + 3600000) return true;
    return false;
  }

  /**
   * A-2 / D68（2026-09-19）：后台提醒链路断了，**首页**必须直说。
   *
   * 依据（基线既有条款，非新增需求）：
   *   · §473「通知权限关闭 → 首页明确告知『无法保证提醒』；恢复权限后自动 Reconcile」
   *   · AC-14「不得继续伪装正常」
   *   · §305「关键能力不得偷偷降级而不告知」
   *
   * 此前这条只落在「我的」页（renderPwaStatus）与自检面板（renderBackgroundVerdict），
   * 而用户天天看的是**首页** —— 于是「关掉 App 就不响」在首页一个字都看不出来，
   * 界面照常平静。这正是 H-08 能长期存活的原因：缺陷是静默的，界面在撒谎。
   *
   * 纯函数：只吃 (status, settings, native)，输出 null 或一条文案，便于行为级断言。
   *
   * 红线：**只在能确证断链时出声**。`notifications === "unknown"` 是「还没问过」，
   * 不是「没有」；冷启动时桥晚到几秒，此时弹警告就是拿新误报换旧误报。
   * 故一切「未定」状态一律返回 null。
   *
   * 范围边界（刻意）：`exactAlarm === "denied"` 不进首页 —— 它只让**到达时刻**可能被推迟，
   * 不产生「关掉 App 就没有提醒」这类硬断链，且已在「我的」页如实标注「时间可能延迟」。
   * 首页只在「你会有提醒」这个承诺被打破时开口。
   */
  function homeNoticeVerdict(status, settings, native) {
    if (!native) return null;
    const s = status || {};
    // ① 用户自己关了总开关 —— 与「系统权限没给」是两件事，必须分开说（Q6 既有结论）。
    //    放最前：此时把他引去授权，他授完权仍然不响（开关还是关的），是反复授权却始终不响的老路。
    if (!(settings && settings.notify)) {
      return {
        kind: "switch",
        title: "后台提醒已关闭",
        text: "关掉 App 后不会有任何提醒。到「我的 → 本地通知」把它打开。"
      };
    }
    // ② 系统通知权限没给 —— H-08 的根因落点，也是唯一「用户能自己修好」的断链
    //
    // 文案纪律（D59 的直接教训）：**不得把「响了但没亮屏」反着报成「完全静默」**。
    // D59 之后声音与振动归 AlarmRingService（mediaPlayback 前台服务，不需要通知权限），
    // 所以「闹钟不响」是错的；真正丢的是**通知**与**屏幕**（setFullScreenIntent 是
    // Notification 的属性，通知发不出去系统就不会替我们全屏）。
    // 也刻意不说成「只剩铃声」——深冻结态的 ROM 连服务都起不来，那时什么都没有。
    if (s.notifications === "denied") {
      return {
        kind: "permission",
        title: "无法保证提醒",
        text: "系统通知权限未授予：关掉 App 后不会有通知，屏幕也不会亮 —— 可能只剩铃声与振动。点这里去授权。"
      };
    }
    // ③ 原生桥始终没就绪（等满 10s 仍不可用）—— 整条原生链路静默消失
    if (s.notifications === "unavailable" || s.bridgeNotReady) {
      return {
        kind: "bridge",
        title: "无法保证提醒",
        text: "提醒能力未就绪：请完全退出后重开应用，再做一次提醒自检。"
      };
    }
    // ④ 对账失败 —— 排程没落进系统
    if (s.reliability === "error") {
      return {
        kind: "error",
        title: "无法保证提醒",
        text: "提醒同步失败，排程可能没落进系统。请打开提醒自检重新排程。"
      };
    }
    return null;
  }

  /**
   * A-2：把 verdict 渲染到首页顶部。断链消失时**主动清空** ——
   * 否则权限恢复后这句警告会一直挂着，变成新的「界面在撒谎」。
   */
  /**
   * O6（首页局部更新）：内容与上一次**逐字节相同**时就不动这个容器。
   *
   * 为什么不能只看「渲染函数被调用了几次」：首页告知条（`#homeNotice`）与设置入口
   * （`#homeSetup`）在一次启动里会被各调用多次（原生状态漏斗 `setNativeReminderStatus`
   * 每读一次权限就调一次），而其中多数次的结论**完全一样**。每次都给同一个容器
   * `innerHTML = ...` 会整块重建 DOM：焦点、滚动位置和按钮忙碌态都会被打断，
   * 代价还随容器体量增长。
   *
   * 只对**单一写入者**的容器使用（`#homeNotice` / `#homeSetup`）：一旦有第二处代码
   * 绕过本函数直接写同一个节点，缓存就会失真并开始吞掉必要的更新 —— 所以这里刻意
   * 逐个容器手工接入，不做全局拦截。
   *
   * 跳过写入时事件监听也不重绑：内容相同 ⇒ 判定对象（kind/title/text）相同 ⇒
   * 旧闭包的行为与新闭包一致。
   */
  const lastWrittenHtml = new WeakMap();
  function writeIfChanged(host, html) {
    const next = String(html == null ? "" : html);
    if (lastWrittenHtml.get(host) === next) return false;
    lastWrittenHtml.set(host, next);
    host.innerHTML = next;
    return true;
  }

  function renderHomeNotice() {
    const host = $("#homeNotice");
    if (!host) return;
    const v = homeNoticeVerdict(nativeReminderStatus, state.settings, isNativeAndroidRuntime());
    if (!v) {
      writeIfChanged(host, "");
      return;
    }
    const html =
      '<button class="soft-entry notice-entry" id="homeNoticeBtn" data-notice-kind="' + v.kind + '">' +
      '<span><span class="notice-title">' + escapeHtml(v.title) + "</span><br>" +
      '<span style="font-size:0.78rem;color:var(--muted)">' + escapeHtml(v.text) + "</span></span>" +
      '<span style="color:var(--muted)">›</span></button>';
    // 内容没变 ⇒ DOM 不重建，监听也保持原样（旧闭包读的是同一个 v，行为一致）。
    if (!writeIfChanged(host, html)) return;
    const btn = $("#homeNoticeBtn");
    if (btn) {
      btn.addEventListener("click", () => {
        // 总开关的修法在「我的」页；权限/桥/对账的修法在自检面板（那里有「1. 申请通知权限」）
        if (v.kind === "switch") {
          state.ui.tab = "me";
          render();
          return;
        }
        openSheet("sheetNotifyLab");
        refreshNotifyLab();
      });
    }
  }

  function renderReviewEntry() {
    const host = $("#homeReview");
    if (!host) return;
    const n = needsReviewItems().length;
    if (!n) {
      writeIfChanged(host, "");
      return;
    }
    const strong = inReviewHighlight();
    let html;
    if (strong) {
      // 显著：提到最前，带数字
      html = '<button class="soft-entry strong-entry" id="openReview" style="margin-bottom:10px;border-color:var(--attention);background:var(--attention-bg)">' +
        '<span><strong style="color:#7a540e">待整理 · ' + n + "</strong><br><span class=\"review-sub\" style=\"font-size:0.78rem;color:#8a6a17\">信息尚未二次确认，不是逾期任务</span></span>" +
        "<span>整理 ›</span></button>";
    } else {
      // 弱形态：无数字、无强调色
      html = '<button class="soft-entry" id="openReview" style="margin-bottom:10px;opacity:.75">' +
        '<span><strong style="font-weight:500;color:var(--muted)">待整理</strong><br>' +
        '<span class=\"review-sub\" style=\"font-size:0.78rem;color:var(--muted)\">信息尚未二次确认，不是逾期任务</span></span>' +
        "<span style=\"color:var(--muted)\">›</span></button>";
    }
    // O6：这个入口在**每一拍** renderHome 都会被调用一次（包括被签名短路的那一拍），
    // 但内容只在数量 / 高亮窗口变化时才变 —— 单写入者容器，内容相同就不重建。
    if (!writeIfChanged(host, html)) return;
    const btn = $("#openReview");
    if (btn) btn.addEventListener("click", () => openReviewSession());
  }

  function scheduleNextReviewAlarm() {
    const rs = ensureReviewSettings();
    if (!rs.enabled) return;
    const count = needsReviewItems().length;
    if (!count) return;
    if (!state.settings.notify) return;
    // D19：原生侧由 reconcile 预排 LocalNotifications；Web 侧依赖 tick
    queueNativeReminderSync();
  }

  /* ---------- lifecycle ---------- */
  function isDue(item, now) {
    now = now || Date.now();
    if (item.status === "completed" || item.status === "archived" || item.status === "acknowledged") return false;
    if (item.status === "due") return true;
    if (!item.triggerAt) return false;
    return item.triggerAt <= now;
  }

  /**
   * 勿扰规则**唯一实现在 `lib/reminder.js`**（`inQuietHours` / `quietEnd` / `parseHHMM`）。
   *
   * 本文件此前是「`Lib.*` 有就调用，没有就走内联副本」——内联副本是第二套算法，
   * 于是「Lib 没加载」这件事不会浮出水面，只是**换一套规则继续跑**。
   * 现在不再有副本：规则模块属于必需依赖，缺失在启动前就被拦下。
   * 这里只保留**读取当前设置**这一层适配（不参与任何算法）。
   */
  function inQuietHours(d) {
    return Lib.inQuietHours(d, state.settings);
  }

  function quietEnd(d) {
    return Lib.quietEnd(d, state.settings);
  }

  function promoteDue(now) {
    // 隔离草稿尚未提交时，可见 state 仍是最后确认状态；自动推进下一拍即可重算。
    if (inflightActionDepth > 0) return false;
    now = now || Date.now();
    let changed = false;
    state.items.forEach(it => {
      // D17：Review 开启时，只有「系统兜底时间」的记录不因其兜底时间进 due；
      // 有真实时间的待整理记录照常提醒，Review 关闭时兜底记录也退为普通事项。
      // V06：抑制只作用于**普通提醒**，绝不能连截止保护一起跳过（INV-05）。
      const fallbackSuppressed = isFallbackSuppressed(it);
      if (!fallbackSuppressed && (it.status === "waiting" || it.status === "snoozed")) {
        // 柔性窗口：仅对 waiting 生效，避免覆盖用户 snooze
        if (it.status === "waiting" && (it.windowStart || it.windowEnd)) {
          const winTs = Lib.applyWindowTrigger(it, now);
          if (winTs && winTs !== it.triggerAt) { it.triggerAt = winTs; changed = true; }
        }
        if (it.triggerAt && it.triggerAt <= now) {
          if (it.priority === "normal" && inQuietHours(new Date(now))) {
            const end = quietEnd(new Date(now));
            if (it.triggerAt < end) { it.triggerAt = end; changed = true; }
            return;
          }
          it.status = "due";
          it.deliveredAt = now;
          it.remindCount = Math.max(1, it.remindCount || 0);
          it.lastRemindAt = now;
          it.lastAlertShownAt = null;
          changed = true;
        }
      }
      // L02 / INV-05：截止保护**分阶段**，每个阶段有稳定身份与消费状态。
      // ACK 结束当前阶段的事件，只有到下一个保护点才会再次唤醒 ——
      // 否则「临近截止时点我知道了」会在下一次 render 里立刻变回 due，确认按钮形同虚设。
      if (it.deadlineAt && !it.deadlinePaused && !isTerminal(it)) {
        const stageKey = deadlineStageKeyOf(it.deadlineAt, now);
        if (stageKey && it.deadlineStageKey !== stageKey) {
          it.deadlineStageKey = stageKey;
          it.status = "due";
          it.deliveredAt = now;
          it.remindCount = 0;
          it.lastRemindAt = now;
          it.lastAlertShownAt = null;
          it.dismissedUntil = null;
          bumpRev(it);
          changed = true;
        }
      }
    });
    if (changed) save();
  }

  /* nextRepeatTrigger 见文件顶部的别名声明（唯一来源 lib/repeat.js） */

  /**
   * F3：保证周期事项有稳定的系列身份。
   * 「停止重复」必须能找到 ACK 生成的未来实例 —— 否则它会带着 repeat 继续提醒、
   * 继续派生周期，界面却提示「周期已终止并归档」。
   */
  function ensureSeriesId(it) {
    if (!it) return null;
    if (!it.repeat || !it.repeat.every) return it.seriesId || null;
    if (!it.seriesId) it.seriesId = "s_" + uid();
    return it.seriesId;
  }

  function seriesMembers(seriesId, exceptId, sourceItem) {
    if (seriesId) {
      return state.items.filter(x =>
        x && x.id !== exceptId && x.seriesId === seriesId && !isTerminal(x));
    }
    if (sourceItem && sourceItem.repeat && sourceItem.repeat.every) {
      return state.items.filter(x =>
        x && x.id !== exceptId && !isTerminal(x) &&
        x.title === sourceItem.title &&
        x.projectId === sourceItem.projectId &&
        x.repeat && x.repeat.every === sourceItem.repeat.every);
    }
    return [];
  }

  /**
   * G4：该实例是否「尚未开始」—— 规则派生出来、用户还**从未接触过**。
   *
   * 停止重复时要区分两类同系列事项：
   *  · 未开始的未来实例：只是规则的投影，随规则一起归档（不写 completedAt）；
   *  · 已经交付/确认过的历史实例：用户真的处理过，必须原样保留业务状态。
   * 判据用生命周期证据（确认时间 / 送达时间 / 稍后时间）而不是时钟 ——
   * 「时刻已过」不代表用户已经看过（红线：通知送达 ≠ 用户看到）。
   */
  function isUnstartedInstance(it) {
    if (!it || isTerminal(it)) return false;
    if (it.acknowledgedAt || it.deliveredAt || it.snoozedAt) return false;
    return it.status === "waiting";
  }

  /**
   * L03：生成周期的下一条实例 —— 「完成本次实例」，原记录不被改写。
   * 返回新事项，未生成时返回 null。
   */
  function spawnNextInstance(it, fromTs) {
    const nextTrigger = nextRepeatTrigger(it, fromTs);
    if (!nextTrigger) return null;
    const preferredId = takeReplayCreatedId();
    const existing = state.items.find(x => x.repeatParentId === it.id);
    if (existing) {
      if (preferredId && existing.id !== preferredId && !state.items.some(x => x.id === preferredId)) {
        existing.id = preferredId;
      }
      return existing;
    }
    const next = makeItem({
      id: preferredId || uid(),
      title: it.title,
      note: it.note,
      tags: it.tags.slice(),
      url: it.url,
      projectId: it.projectId,
      priority: it.priority,
      status: "waiting",
      repeat: it.repeat,
      seriesId: ensureSeriesId(it),
      repeatParentId: it.id,
      triggerAt: nextTrigger,
      scheduleBasis: "wall-clock",
      localTrigger: toLocalInput(nextTrigger),
      deadlineAt: null,
      // 下一周期继承投递方式快照（有标记仍为 alarm）
      delivery_mode: resolveDeliveryMode(it.priority)
    });
    state.items.push(next);
    return next;
  }

  /**
   * 我知道了 —— 只表示「看到了」，不等于完成（红线：Acknowledged ≠ Completed）。
   *
   * L03：周期分两种语义，必须分开兑现承诺
   *  · `mode: "ack"`   「ACK 后计时」→ 由**确认**推进到下一周期
   *  · `mode: "calendar"`「日历规则」→ 由**完成**推进，ACK 不改变原定日期
   * V04：ACK 推进必须**新建实例**。就地把 triggerAt 改到下一期会把「本次实例」与
   *      「下一期」混成同一条记录 —— 随后完成本次实例时，下一期会被一起归档（活跃实例归零）。
   * L04：终态保护 —— 已完成 / 已归档的事项不接受旧通知的 ACK。
   */
  /** UX-A01：稍后面板的唯一入口 —— 卡片、详情、弹条、首次 ACK 的反馈都走这里。 */
  function openSnoozeSheet(id) {
    if (isItemActionPending(id)) { rejectPendingItemCommand(); return false; }
    state.ui.snoozeId = id;
    snoozePick = null;
    snoozeBasis = "elapsed";
    if ($("#snoozeCustom")) $("#snoozeCustom").value = "";
    $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));
    closeSheet("sheetDetail");
    openSheet("sheetSnooze");
    return true;
  }

  function ackItem(id, silent) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    if (isTerminal(it)) return false;
    const now = Date.now();
    it.status = "acknowledged";
    it.acknowledgedAt = now;
    it.lastRemindAt = null;
    it.dismissedUntil = null;
    if (it.repeat && it.repeat.every && it.repeat.mode === "ack") {
      if (spawnNextInstance(it, now)) it.ackAdvancedAt = now;
    }
    bumpRev(it);
    save();
    if (!silent) {
      // UX-A01：第一次点「我知道了」时用**非阻塞**反馈说清后果，并就地给出「稍后提醒」入口。
      // 文案纪律：不得承诺「以后不再提醒」—— 截止保护与 ACK 型周期都会再回来。
      const first = !state.settings.ackExplained;
      if (first) {
        state.settings.ackExplained = true;
        save();
      }
      const spec = FeedbackLib ? FeedbackLib.actionSpec("ack") : null;
      if (first) {
        toast(
          (spec && spec.firstTimeText) || "已停止本轮催促，这件事仍未完成",
          (spec && spec.firstTimeAction) || "稍后提醒",
          () => openSnoozeSheet(id)
        );
      } else {
        toast((spec && spec.sub) || "已停止本轮催促 · 仍未完成");
      }
    }
    render();
    return true;
  }

  /**
   * 完成 —— 归档当前实例。
   *
   * L03：`calendar` 周期从这里推进，且锚定**原定日期**而不是完成时刻
   *      （否则「每月 1 日」会因为晚几天完成而漂成每月 5 日）。
   *      `ack` 周期已经由 ACK 推进过，不再重复生成下期。
   * L04：终态保护 —— 同一条完成事件重复投递时只能推进一次周期。
   */
  /**
   * 归档一条事项时，周期是否需要顺延到下一期。
   *
   * `calendar` 由**完成**推进；`ack` 由**确认**推进 —— 已经由 ACK 推进过（`ackAdvancedAt`）
   * 就不再重复推进（V04：否则活跃实例归零）。
   *
   * K1：这条规则有两个调用方 —— 用户点「完成」，以及原生草稿提交成功后重放该命令。
   * 必须共用一处实现，否则两边的判断会各自漂移。
   */
  function advanceSeriesOnArchive(it) {
    if (!it || !it.repeat || !it.repeat.every) return null;
    const ackBased = it.repeat.mode === "ack";
    if (ackBased && it.ackAdvancedAt) return null;
    return spawnNextInstance(it, ackBased ? (it.acknowledgedAt || Date.now()) : null);
  }

  /**
   * UX-A03：完成后的**有限撤销**。
   *
   * 与「归档恢复」是两件事，两者语义不同：
   *  · 这里的撤销：短时（8 秒）、只覆盖**本次完成**、要成组还原周期派生；
   *  · 归档恢复（`restoreItem`）：不清时间、不自动提醒、暂停截止保护。
   * 把「恢复」冒充成「撤销」会静默改掉提醒与截止保护的语义，所以刻意分开。
   */
  let lastCompleteUndo = null;
  const COMPLETE_UNDO_MS = (FeedbackLib && FeedbackLib.UNDO_WINDOW_MS) || 8000;
  /**
   * UX-A03：撤销之后必须确认「系统里的旧排程真的被撤掉了」。
   *
   * 「我点了撤销就没事了」是错的 —— 原生撤销失败时旧提醒仍在系统里，
   * 到点照样会响。所以这里挂一个一次性检查：**不假装撤销干净**，
   * 失败就提示旧提醒可能仍存在并给出重试入口。
   */
  let undoNativeCheckPending = false;

  /**
   * 撤销完成的**实际写入**——参数自足，因此可以进命令日志、被重放到随后发布的权威草稿。
   *
   * 只还原业务字段与本次完成派生的下一期；**不回放**已发生的铃声/通知/ACK/投递证据。
   * R5：同时把「本次完成期间被取消、且已跨过原定时刻」的提醒键标成 suppressed，
   * 否则对账会按「已被撤销 ⇒ 补一条」立刻补响用户刚刚取消掉的那一次。
   */
  function applyCompleteUndo(command) {
    if (!command || !command.itemId) return false;
    const it = state.items.find(x => x.id === command.itemId);
    if (!it) return false;
    Object.assign(it, command.prev);
    if (command.reclaim && command.reclaim.length) {
      const drop = new Set(command.reclaim);
      state.items = state.items.filter(x => !drop.has(x.id));
    }
    if (NativeReminders.suppressPastReminderReplay) {
      NativeReminders.suppressPastReminderReplay(it, Date.now());
    }
    bumpRev(it);
    render();
    return true;
  }

  /**
   * 持久化失败时把**可见状态退回撤销之前**。
   *
   * 界面与磁盘必须说同一件事：留下一个「已撤销」的界面、而磁盘上仍是 archived，
   * 就是这一轮被打回的形态（用户重启后又看到它回到已归档）。所以失败不是「算了」，
   * 而是回滚 + 明确的重试入口。
   */
  function revertCompleteUndo(command) {
    const snap = command && command.before;
    if (!snap) return false;
    const it = state.items.find(x => x.id === command.itemId);
    if (it && snap.item) {
      Object.keys(it).forEach(k => { if (!(k in snap.item)) delete it[k]; });
      Object.keys(snap.item).forEach(k => { it[k] = snap.item[k]; });
    }
    (snap.removed || []).slice().sort((a, b) => a.index - b.index).forEach(entry => {
      if (!entry || !entry.item) return;
      if (state.items.some(x => x.id === entry.item.id)) return;
      const at = Math.max(0, Math.min(entry.index, state.items.length));
      state.items.splice(at, 0, entry.item);
    });
    render();
    return true;
  }

  /**
   * UX-A03 / 独立验收 F04：撤销「完成」是**统一事务里的一条受控命令**。
   *
   * 以前它直接改共享 state 再 `save()`，绕过统一命令日志，于是：
   *  · 原生动作提交在途时撤销，会被随后发布的权威草稿整体覆盖 ——
   *    界面说撤销成功，提交结束或重启后它又回到「已归档」（独立验收 R3）；
   *  · 提示在**落库之前**就发出去了，写失败时用户已经被告知「已撤销完成」（R6）。
   *
   * 现在：
   *  · 走 `runUserOp` —— 同域（同一条事项 / 同一周期）在途时明确拒绝，
   *    无关事项则记进日志、在原生草稿发布之后按序重放；
   *  · 成功反馈等**持久化确认**；失败则回滚可见状态并保留重试入口。
   */
  function undoLastComplete() {
    const u = lastCompleteUndo;
    if (!u) return false;
    const it = state.items.find(x => x.id === u.itemId);
    if (!it) { lastCompleteUndo = null; return false; }
    // 过期：只失效撤销入口，不影响已经正常完成的这条
    if (Date.now() - u.at > COMPLETE_UNDO_MS) {
      lastCompleteUndo = null;
      toast("撤销时间已过 · 可在「未来 → 已归档」里恢复");
      return false;
    }
    // 本次完成之后又被改过 / 已经不是刚完成的状态 ⇒ 拒绝不安全撤销
    if (Number(it.rev) !== Number(u.rev)) {
      toast("这条之后又被改过 · 可在归档里恢复");
      return false;
    }
    if (it.status !== "archived") {
      toast("这条状态已经变了 · 可在归档里恢复");
      return false;
    }
    // 完成之后到来的投递证据 ⇒ 说明已经进入投递，撤销会制造幽灵响铃
    const events = it.reminderEvents && typeof it.reminderEvents === "object" ? it.reminderEvents : {};
    const deliveredAfter = Object.keys(events).some(k => {
      const ev = events[k];
      return ev && ev.state === "delivered" && Number(ev.receivedAt || ev.at || 0) >= u.at;
    });
    if (deliveredAfter) {
      toast("这条已经开始提醒 · 可在归档里恢复");
      return false;
    }
    // 周期派生的下一期：只回收**本次完成生成的、且尚未被处理/投递**的
    const reclaim = [];
    for (const sp of u.spawned) {
      const x = state.items.find(y => y.id === sp.id);
      if (!x) continue;
      if (x.repeatParentId !== it.id) continue; // 不是这条派生的，绝不删
      const untouched = Number(x.rev) === Number(sp.rev) &&
        x.status === "waiting" &&
        !x.acknowledgedAt && !x.deliveredAt && !x.lastRemindAt && !x.remindCount &&
        !x.ackAdvancedAt && !x.completedAt;
      if (!untouched) {
        toast("下一期已经开始处理 · 不能安全撤销，请到归档里逐条处理");
        return false;
      }
      reclaim.push(x.id);
    }
    // 命令只携带**自足的值**：重放时按 itemId 在当时的草稿里重新解析，
    // 不保留任何可能已被替换掉的旧对象引用。
    const command = {
      itemId: u.itemId,
      rev: u.rev,
      at: u.at,
      prev: JSON.parse(JSON.stringify(u.prev)),
      reclaim: reclaim.slice(),
      // 仅用于「写失败回滚」，不参与重放（重放路径不会走到回滚）
      before: {
        item: JSON.parse(JSON.stringify(it)),
        removed: reclaim.map(id => {
          const index = state.items.findIndex(y => y.id === id);
          return { index: index, item: index >= 0 ? JSON.parse(JSON.stringify(state.items[index])) : null };
        })
      }
    };
    const applied = runUserOp(applyCompleteUndo, [command], {
      userFacing: true,
      // 目标 id 藏在参数里（参数是一份撤销记录），必须显式告诉冲突检查
      scopeId: (c) => c && c.itemId,
      name: "undoComplete"
    });
    if (applied === false) return false;
    lastCompleteUndo = null;
    const pending = save();
    pending.then(() => {
      toast("已撤销完成 · 这条仍在「未完成」里");
      // 只对未来仍有效的计划按现有规则对账；不因撤销立刻补响已经过去的那次
      undoNativeCheckPending = true;
      queueNativeReminderSync("undo-complete");
    }).catch(() => {
      // 没写进去就不算撤销过：退回原状 + 明确的重试入口
      revertCompleteUndo(command);
      lastCompleteUndo = u;
      toast("撤销还没写进本机存储 · 请重试", "重试", () => undoLastComplete());
    });
    return true;
  }

  function completeItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    if (isTerminal(it)) return false;
    const prev = {
      status: it.status,
      completedAt: it.completedAt || null,
      dismissedUntil: it.dismissedUntil == null ? null : it.dismissedUntil,
      acknowledgedAt: it.acknowledgedAt == null ? null : it.acknowledgedAt,
      ackAdvancedAt: it.ackAdvancedAt == null ? null : it.ackAdvancedAt,
      lastRemindAt: it.lastRemindAt == null ? null : it.lastRemindAt
    };
    const beforeIds = new Set(state.items.map(x => x.id));
    it.status = "archived";
    it.completedAt = Date.now();
    it.dismissedUntil = null;
    advanceSeriesOnArchive(it);
    bumpRev(it);
    // 只有**应用内**的完成才提供短时撤销。原生锁屏/通知里的完成不强行拉起主应用，
    // 也不在次日重开时补发一个撤销窗口（UX-A03）。
    if (!suppressUserFeedback) {
      const spawned = state.items
        .filter(x => !beforeIds.has(x.id))
        .map(x => ({ id: x.id, rev: x.rev }));
      lastCompleteUndo = {
        itemId: it.id,
        rev: it.rev,
        at: Date.now(),
        prev: prev,
        spawned: spawned
      };
    }
    save();
    const spec = FeedbackLib ? FeedbackLib.actionSpec("done", { hasRepeat: !!(it.repeat && it.repeat.every) }) : null;
    const msg = (spec && spec.undoText) || (it.repeat ? "已完成 · 下一周期已生成" : "已完成并归档");
    if (suppressUserFeedback) {
      // 原生路径：没有提示，也就不提供撤销入口
    } else if (lastCompleteUndo) {
      toast(msg, "前往归档", () => { state.ui.tab = "future"; state.ui.futureSeg = "archive"; render(); },
        { label: "撤销", onClick: undoLastComplete }, { durationMs: COMPLETE_UNDO_MS });
    } else {
      toast(msg);
    }
    render();
    return true;
  }

  /**
   * 稍后 —— 进入新一轮。
   *
   * L04：终态保护；已完成的事项不接受旧通知的「稍后」。
   * L08：稍后开启新一轮时重置追提醒预算与轮次状态，让前台与应用后台使用同一份轮次。
   *      否则旧计数会跟着新时间走，用户点完稍后反而更早静音
   *      （原生投影从 attempt=0 重排，前台却按旧上限判断）。
   */
  function snoozeItem(id, when, basis) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    if (isTerminal(it)) return false;
    const snoozedAt = Date.now();
    it.status = "snoozed";
    it.triggerAt = when;
    it.scheduleBasis = basis === "wall-clock" ? "wall-clock" : "elapsed";
    it.localTrigger = it.scheduleBasis === "wall-clock" ? toLocalInput(when) : null;
    it.snoozedAt = it.scheduleBasis === "elapsed" ? snoozedAt : null;
    it.snoozeDelayMs = it.scheduleBasis === "elapsed" ? Math.max(0, when - snoozedAt) : null;
    it.dismissedUntil = null;
    it.snoozeCount = (it.snoozeCount || 0) + 1;
    it.remindCount = 0;
    it.lastRemindAt = null;
    it.lastAlertShownAt = null;
    it.deliveredAt = null;
    bumpRev(it);
    save();
    toast("已改到 " + fmtTime(when));
    render();
    return true;
  }

  function deleteItem(id) {
    if (!state.items.some(x => x.id === id)) return false;
    state.items = state.items.filter(x => x.id !== id);
    save();
    toast("已删除");
    render();
    return true;
  }

  function reopenItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    const snoozedAt = Date.now();
    it.status = "snoozed";
    it.triggerAt = snoozedAt + 2 * 3600000;
    it.scheduleBasis = "elapsed";
    it.localTrigger = null;
    it.snoozedAt = snoozedAt;
    it.snoozeDelayMs = 2 * 3600000;
    it.dismissedUntil = null;
    // 「再提醒」同样开启新一轮，与 snoozeItem 保持同一份轮次语义
    it.remindCount = 0;
    it.lastRemindAt = null;
    it.lastAlertShownAt = null;
    it.deliveredAt = null;
    bumpRev(it);
    save();
    toast("将在 2 小时后再次提醒");
    render();
    return true;
  }

  /**
   * D23：归档重开不设 trigger_at（不自动提醒），可选给一次极简时间选择。
   *
   * 承诺一致性：重开时同时**暂停截止保护**。截止保护同样是「自动提醒」，
   * 而原实现会让原生投影在恢复后立刻补一条截止提醒，与「不会自动提醒」直接冲突。
   * 暂停是显式可见的，用户可以在卡片/详情里一键恢复。
   */
  function restoreItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    it.status = "waiting";
    it.completedAt = null;
    it.triggerAt = null;
    it.scheduleBasis = null;
    it.localTrigger = null;
    it.snoozedAt = null;
    it.snoozeDelayMs = null;
    it.dismissedUntil = null;
    it.remindCount = 0;
    it.lastRemindAt = null;
    it.lastAlertShownAt = null;
    it.deliveredAt = null;
    it.deadlinePaused = true;
    bumpRev(it);
    save();
    toast("已恢复 · 不会自动提醒", "设置时间", () => {
      state.ui.snoozeId = it.id;
      openSheet("sheetSnooze");
    });
    render();
    return true;
  }

  /** D23 例外必须由用户显式解除：恢复归档时被暂停的截止保护 */
  function resumeDeadlineProtection(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    it.deadlinePaused = false;
    it.deadlineStageKey = null;
    // 一并清掉暂停前的原生排期记录，否则恢复后会被判成「已送达」而不再排程
    it.deadlineEvents = {};
    bumpRev(it);
    save();
    toast(it.deadlineAt ? "截止保护已恢复 · 截止 " + fmtTime(it.deadlineAt) : "截止保护已恢复");
    render();
    return true;
  }

  /**
   * L03 / V0.2 §417：停止重复 = **终止整个周期规则并归档当前实例**。
   *
   * F3：终止的是**整个系列**。
   * G4：但「终止规则」与「归档实例」是两件事，必须分开 ——
   *  1. 整个系列（含历史实例）一律摘掉 `repeat`，从此不再派生、不再按周期提醒；
   *  2. 用户明确操作的那一条归档（这是「归档当前实例」的语义）；
   *  3. 同系列里**尚未开始**的未来实例随规则一起归档，不写 `completedAt`
   *     （它们从未被用户处理过，不应计入「今天已完成 N 件」）；
   *  4. 已经确认/交付过的历史实例**保留业务状态** —— 之前把 `acknowledged` 的
   *     上一条也一并归档且 `completedAt=null`，它会从待处理列表里凭空消失。
   */
  function stopRepeat(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    const seriesId = it.seriesId || null;
    const members = seriesMembers(seriesId, id, it);
    // 1) 先终止规则：历史与未来实例都不再属于这个周期
    const all = [it].concat(members);
    all.forEach(m => {
      m.repeat = null;
      m.ackAdvancedAt = null;
      m.dismissedUntil = null;
    });
    // 2) 归档当前实例
    if (!isTerminal(it)) {
      it.status = "archived";
      it.completedAt = Date.now();
    }
    // 3) 只归档「尚未开始」的未来实例；4) 已确认/已交付的历史保留业务状态
    const archived = [];
    members.forEach(m => {
      if (!isUnstartedInstance(m)) return;
      m.status = "archived";
      m.completedAt = null; // 未真正完成，只随规则终止
      archived.push(m);
    });
    all.forEach(m => bumpRev(m));
    save();
    queueNativeReminderSync();
    toast(archived.length
      ? "已停止重复 · 周期已终止并归档（含 " + archived.length + " 个未开始的未来实例）"
      : "已停止重复 · 周期已终止并归档");
    render();
    return true;
  }

  /* ---------- item card ---------- */


  /**
   * UX-A01：动作按钮 = 名称 + 短副说明。
   *
   * 四个动作在首页卡片、详情、弹条、Android 闹钟与通知快捷动作里含义必须一致；
   * `data-act` 是行为契约，副说明只是给人看的，不参与任何判断。
   */




  /* ---------- views ---------- */


  function updateAppBadge(forced) {
    const n = forced != null
      ? forced
      : state.items.filter(it => it.status === "due").length;
    if (navigator.setAppBadge) {
      if (n > 0) navigator.setAppBadge(n).catch(() => {});
      else navigator.clearAppBadge().catch(() => {});
    }
  }

  /**
   * O6：首页**卡片容器**的渲染签名。
   *
   * 为什么不是「把整个 state stringify 一下当签名」：那本身就是一次全量深遍历 + 字符串
   * 复制，热点只是从 innerHTML 挪到签名上，还顺手让「哪些字段真的会影响这一屏」变得不可读。
   * 这里只收集**卡片与入口真正读到的那些值**，逐项对应 renderItemCard / 空态模板：
   *
   *  · 折叠状态、待整理数量、今日完成数、用户模式（决定 `#homeStart` 有没有新手指南）；
   *  · 项目表的 id/名称/颜色（卡片上的项目药丸，改项目名也要跟着变）；
   *  · 每个需要注意的事项：id、优先级、项目、**已格式化的时间文案**（`relDue` 是相对时间，
   *    跨分钟就会变，所以直接把它算出来的文字放进来，比按 rev 判断可靠）、截止日期文案、
   *    截止保护暂停标记、周期文案、标签、标题、备注、链接；
   *  · 折叠时**只放数量**，不放卡片内容 —— 折叠态本来就不生成这些卡片，
   *    放进来只会让每一拍无谓地重建。
   *
   * 刻意**不**用 `rev`：改标题也会推进 rev，机械按 rev 失效会在「什么都没显示变化」时重建，
   * 而 rev 不动的 `lastAlertShownAt` / 时间文案变化又会被漏掉。
   */








  /** P2-F2：核心显式完成业务推进；展示实例只渲染首页 DOM。 */
  function renderHome() {
    /* mutation: promoteDue removed */
    renderSetupEntry();
    renderHomeNotice();
    return appViews.renderHome();
  }













  function setUserMode(mode) {
    state.settings.userMode = mode === "normal" ? "normal" : "beginner";
    save();
    syncUserMode();
    render();
    if (state.ui.tab === "me") renderMe();
    toast(state.settings.userMode === "normal"
      ? "已切换为正常模式（精简小字）"
      : "已切换为初学者模式（显示释义小字）");
  }









  /* P2-F2：业务调用点只经同一个已验证的 views 实例转发。 */
  function projectById(id) { return appViews.projectById(id); }
  function priorityRank(p) { return appViews.priorityRank(p); }
  function actionButton(act, id, cls, label, sub) { return appViews.actionButton(act, id, cls, label, sub); }
  function renderItemCard(it, mode) { return appViews.renderItemCard(it, mode); }
  function openDetail(id) { return appViews.openDetail(id); }
  function setBadge(n) { return appViews.setBadge(n); }
  function renderCalendar() { return appViews.renderCalendar(); }
  function renderArchiveList() { return appViews.renderArchiveList(); }
  function renderFuture() { promoteDue(); return appViews.renderFuture(); }
  function renderNotes() { return appViews.renderNotes(); }
  function renderStats() { return appViews.renderStats(); }
  function syncUserMode() { return appViews.syncUserMode(); }
  function renderMe() { return appViews.renderMe(); }
  function renderPwaStatus() { return appViews.renderPwaStatus(); }
  function render() {
    if (state.ui.tab === "home") { promoteDue(); renderSetupEntry(); renderHomeNotice(); }
    else if (state.ui.tab === "future") promoteDue();
    return appViews.render();
  }
  function refreshProjectSelects() { return appViews.refreshProjectSelects(); }

  /* ---------- AI：唯一来源 lib/app-ai.js（P2-A 已整体迁出） ---------- */

  /**
   * AI 请求、结果归一、设置页与表单合并的**唯一实现在 `lib/app-ai.js`**
   * （由文件顶部的 `createAppAi` 装配绑定 —— 见 `bindRuntime()` 里那一处）。
   *
   * 这里刻意**不留实现体、也不留转发壳**：留壳就等于同时存在两个可调用入口，
   * 而「改了模块、忘了改壳」是静默分叉最舒服的温床。调用点一律写 `ai.xxx()`；
   * `ai == null`（装配失败）时应用停在失败面板上，根本走不到这些按钮。
   *
   * 仍然**留在入口**的三件事 —— 它们不是 AI 逻辑，搬走会让所有权错位：
   *   · `submitToken` / `beginSaveSubmit()` —— 提交身份属于事务层，
   *     AI 只是「占用同一个身份」（`ai:<时间戳>` 那个重复提交的 bug 就是另起身份来的）；
   *   · `itemFormSession` / `formUntouched()` —— 表单会话身份属于捕获表单，
   *     「迟到结果能不能回填」由它裁决，模块只提供纯快照合并 `ai.mergedDraft()`（R-F03）；
   *   · `#btnAiTest` 的「临时换上表单里的配置再测」 —— 那是设置页交互。
   *
   * 对应测试：`test-boot-combination.js` 里「抽掉 lib/app-ai.js」的反例与
   * `APP_AI_INSTANCE_CONTRACT` 的双向闭合；AI 请求/归一/合并的行为断言走 `test-regressions.js`。
   */
  /* ---------- sheets / toast / confirm：唯一来源 lib/app-ui.js ---------- */

  /**
   * 弹层与提示的**唯一实现**在 lib/app-ui.js（由文件顶部的 createUi 装配绑定）。
   *
   * 这里只留一条说明，是因为这几支最容易被人「就近补一个」：它们的调用点散布在
   * 视图、表单、备份、原生回调各处，看上去像本文件自己的小工具。实际情况相反 ——
   * 它们是唯一一处「有状态的展示会话」（toastTimer、确认框的 cleanup、backdrop 的
   * 引用计数式关闭），第二份实现会让「关掉哪一层、什么时候撤掉 backdrop」出现两套口径。
   *
   * 由此往上，本文件不再持有任何 DOM 展示动作的定义；`$` / `$$` 也来自同一处。
   */

  /* ---------- UX-T01：保存结果与排程结果分开 ---------- */

  /**
   * 「保存中有反馈」与「避免重复提交」是同一件事的两面：
   * 按钮一处既反馈去重。
   *
   * 刻意按**提交身份**（编辑哪条 + 内容 + 时间）去重，而不是一个全局布尔：
   * 全局布尔会把「前一笔还没落盘时又记一件事」也一起拒掉 —— 而那恰恰是
   * 用户最正常的连击（本仓的 P1-A2「连续新建两条都不得丢」就是这个场景）。
   */
  let saveSubmitsInFlight = new Set();

  function beginSaveSubmit(token) {
    saveSubmitsInFlight.add(token || "anonymous");
    setSaveButtonRunning(true);
  }

  function endSaveSubmit(token) {
    saveSubmitsInFlight.delete(token || "anonymous");
    if (!saveSubmitsInFlight.size) setSaveButtonRunning(false);
  }

  function setSaveButtonRunning(running) {
    const btn = $("#btnSaveItem");
    if (!btn) return;
    if (running) {
      if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent || "保存";
      btn.disabled = true;
      btn.textContent = "保存中…";
    } else {
      btn.disabled = false;
      if (btn.dataset.idleLabel) btn.textContent = btn.dataset.idleLabel;
      btn.dataset.idleLabel = "";
    }
  }

  /**
   * 「失败保留草稿」—— 只在内存里留一份表单快照。
   *
   * 刻意不写进 localStorage/IDB：草稿是**本次会话的**恢复手段，
   * 落库会与「权威快照」争抢同一个写入通道（H-07 的教训）。
   */
  function snapshotItemForm() {
    const val = (sel) => ($(sel) ? $(sel).value : "");
    const on = $$("#capPriority .chip.on")[0];
    const picked = !!(triggerUserPicked || lowConfUserPicked);
    const triggerVal = val("#capTrigger");
    let triggerAction = "untouched";
    if (picked) {
      triggerAction = triggerVal ? "changed" : "cleared";
    }
    return {
      text: val("#capText"),
      note: val("#capNote"),
      tags: val("#capTags"),
      url: val("#capUrl"),
      trigger: triggerVal,
      triggerAction: triggerAction,
      deadline: val("#capDeadline"),
      project: val("#capProject"),
      repeat: val("#capRepeat"),
      repeatMode: val("#capRepeatMode"),
      nth: val("#capNth"),
      weekday: val("#capWeekday"),
      priority: on ? on.dataset.p : "normal",
      advanced: $("#capAdvanced") ? !$("#capAdvanced").hidden : false,
      editItemId: state.ui.editItemId,
      triggerPicked: triggerUserPicked,
      lowConfPicked: lowConfUserPicked
    };
  }

  /**
   * F03：一次提交属于**哪一份草稿**。
   *
   * 持久化回调必须能回答「现在表单里还是不是刚才提交的那一份」——
   * 否则慢写入期间用户继续输入的内容会被旧请求的结果清掉（独立验收 R2）。
   *
   * 时间框只在**用户自己选过**时才算数：解析器与兜底会自己往它里面写值，
   * 把它无条件算进来，会让「解析器刚补完时间」被误判成「用户改了草稿」，
   * 于是面板不再关闭、草稿不再复位。编辑时若显式清空或改期，也以 triggerAction 区分。
   */
  function formDraftSignature(snap) {
    if (!snap) return "";
    const picked = !!(snap.triggerPicked || snap.lowConfPicked);
    const triggerPart = picked
      ? (snap.triggerAction ? snap.triggerAction + ":" : "") + (snap.trigger || "")
      : (snap.editItemId ? "untouched" : "");
    return [
      snap.editItemId || "new",
      snap.text, snap.note, snap.tags, snap.url, snap.deadline, snap.project,
      snap.repeat, snap.repeatMode, snap.nth, snap.weekday, snap.priority,
      triggerPart
    ].join("\u0001");
  }

  function restoreItemForm(snap) {
    if (!snap) return;
    const set = (sel, v) => { if ($(sel)) $(sel).value = v == null ? "" : v; };
    set("#capText", snap.text);
    set("#capNote", snap.note);
    set("#capTags", snap.tags);
    set("#capUrl", snap.url);
    set("#capTrigger", snap.trigger);
    set("#capDeadline", snap.deadline);
    set("#capProject", snap.project);
    set("#capRepeat", snap.repeat);
    set("#capRepeatMode", snap.repeatMode);
    set("#capNth", snap.nth);
    set("#capWeekday", snap.weekday);
    $$("#capPriority .chip").forEach(c => c.classList.toggle("on", c.dataset.p === snap.priority));
    state.ui.editItemId = snap.editItemId || null;
    triggerUserPicked = !!snap.triggerPicked;
    lowConfUserPicked = !!snap.lowConfPicked;
    if (snap.editItemId) {
      $("#sheetItemTitle").textContent = "编辑事项";
      $("#btnSaveItem").textContent = "保存修改";
    }
    const adv = $("#capAdvanced");
    if (adv) adv.hidden = !snap.advanced;
  }

  /** 按钮身份标签：编辑哪条 + 内容 + 时间。同一身份重入才算重复提交。 */
  function saveSubmitToken(session, editItemId, text, triggerValue) {
    // 同一会话内的双击/回车仍然去重；关闭后重新打开即使内容完全相同，也是一份
    // 独立的用户意图，不能被上一会话的在途提交挡住（Y3）。
    return String(session) + "|" + (editItemId || "new") + "|" + (text || "") + "|" + (triggerValue || "");
  }

  /**
   * F03：保存失败时的收尾 —— **只在该收的时候**才把旧草稿放回表单。
   *
   * 独立验收 R2 的形态：写入还没落地时用户继续输入，失败回调把旧草稿恢复上去，
   * 用户新写的内容就没了。所以先判断「表单里还是不是刚才提交的那一份」：
   *  · 是 → 照旧恢复（等价于原行为，用户没在往下写）；
   *  · 否 → 一个字符都不碰，改成给一个**显式**的找回入口。
   */
  function settleFailedDraft(draft, signature, session) {
    if (itemFormSession === session && formDraftSignature(snapshotItemForm()) === signature) {
      keepDraftForRetry(draft);
      return;
    }
    toast("上一条没保存成功 · 你正在写的内容没被动过", "找回上一条", () => keepDraftForRetry(draft));
  }

  /**
   * 「失败保留草稿和重试入口」—— 把输入原样放回表单并重开面板。
   *
   * 不复用任何成功文案：失败路径上说「已保存」会直接违反 UX-T01 的第一条。
   */
  function keepDraftForRetry(draft) {
    restoreItemForm(draft);
    openSheet("sheetItem");
    const feedbackResult = FeedbackLib
      ? FeedbackLib.saveFeedback("failed")
      : { text: "未能保存 · 内容还在，可重试", actionLabel: "重试" };
    toast(feedbackResult.text, feedbackResult.actionLabel, () => {
      restoreItemForm(draft);
      saveItemFromForm();
    });
  }

  /**
   * 本条事项的**排程证据** —— 只吃这一条的证据，不看全局。
   *
   * D70 前置核验的教训：全局 `reliability: "exact"` 完全不能证明刚保存的这一条已排成功。
   * 反过来也不许用「scheduled 且已过期」推断漏提醒 —— 本函数只回答
   * 「有没有**本轮**的 scheduled/delivered 回执」，从不产出负面结论。
   */
  function itemScheduleEvidence(it) {
    if (!it) return null;
    const events = it.reminderEvents && typeof it.reminderEvents === "object" ? it.reminderEvents : null;
    if (!events) return null;
    const base = Number(it.triggerAt) || 0;
    // R-F06：范围过滤之外还要核对**轮次身份** —— 旧轮遗留的键可能原定时刻晚于新起点，
    // 只看范围会把它当成「本轮已排/已送达」，于是刚保存的新周期冒充「系统已接收」。
    const keys = Object.keys(events).filter(k => {
      const at = Number(String(k).split("@")[1]);
      if (!Number.isFinite(at)) return false;
      if (!base) return true;
      if (at < base) return false;
      const round = EvidenceLib && EvidenceLib.entryRoundBase
        ? EvidenceLib.entryRoundBase(it, events[k], k) : base;
      return Number(round) === base;
    });
    if (!keys.length) return null;
    let scheduled = false;
    let delivered = false;
    keys.forEach(k => {
      const s = events[k] && events[k].state;
      if (s === "delivered") delivered = true;
      else if (s === "scheduled") scheduled = true;
    });
    if (delivered) return "delivered";
    if (scheduled) return "scheduled";
    return null;
  }

  /** 喂给判定层的原生侧事实（只读，不改任何状态）。 */
  function feedbackNativeSnapshot() {
    const s = nativeReminderStatus || {};
    return {
      isNative: isNativeAndroidRuntime(),
      bridgeReady: !!nativeReady,
      notifySwitch: !!(state.settings && state.settings.notify),
      notifications: s.notifications || "unknown",
      exactAlarm: s.exactAlarm || "unknown",
      reliability: s.reliability || "unknown",
      capabilities: s.capabilities || null,
      alarmCount: s.alarmCount || 0,
      alarmScheduled: s.alarmScheduled || 0
    };
  }

  function feedbackItemSnapshot(it) {
    if (!it) return null;
    return {
      id: it.id,
      hasTrigger: !!it.triggerAt,
      isFallbackTrigger: !!it.isFallbackTrigger,
      priority: it.priority,
      deliveryMode: it.delivery_mode,
      repeat: it.repeat || null,
      deadlineAt: it.deadlineAt || null,
      triggerAt: it.triggerAt || null
    };
  }

  /**
   * 保存/排程反馈的最终判定。
   *
   * 迟到响应不得覆盖新编辑的结果 —— 用**保存时刻的事项版本**做闸门：
   * 版本已经变过，就说「这条之后又被改过，以最新设置为准」，不再替旧版本下结论。
   */
  function feedbackVerdictFor(it, waiter) {
    const feedbackApi = FeedbackLib;
    if (waiter && waiter.rev != null && it && it.rev != null && it.rev !== waiter.rev) {
      return {
        kind: "superseded",
        text: "已保存 · 这条之后又被改过，以最新设置为准",
        actionLabel: "查看",
        actionKind: "open-item",
        tone: "info"
      };
    }
    const evidence = itemScheduleEvidence(it);
    const ctx = {
      persistence: waiter && waiter.persistence ? waiter.persistence : "confirmed",
      item: feedbackItemSnapshot(it),
      native: feedbackNativeSnapshot(),
      itemScheduled: evidence === "scheduled" || evidence === "delivered" ? true : null
    };
    if (!feedbackApi) {
      // lib 未加载时的兜底：宁可说「尚未确认」，也不冒充已安排
      return { kind: "unknown", text: "已保存，提醒安排尚未确认", actionLabel: "查看状态", actionKind: "open-status", tone: "info" };
    }
    return feedbackApi.reminderFeedback(ctx);
  }

  function runFeedbackAction(kind, it, waiter) {
    if (kind === "retry-save") {
      if (waiter && waiter.draft) {
        restoreItemForm(waiter.draft);
        openSheet("sheetItem");
      }
      return;
    }
    if (kind === "open-review") { openReviewSession(); return; }
    if (kind === "open-settings") {
      openSheet("sheetNotifyLab");
      refreshNotifyLab();
      return;
    }
    if (kind === "open-status") {
      if (it) openDetail(it.id);
      else { openSheet("sheetNotifyLab"); refreshNotifyLab(); }
      return;
    }
    if (kind === "explain-web") {
      if (it) openDetail(it.id);
      return;
    }
    if (kind === "retry-schedule") { queueNativeReminderSync("save-feedback-retry"); return; }
    if (kind === "open-item" && it) { openDetail(it.id); return; }
    if (it) { openDetail(it.id); return; }
  }

  /**
   * 保存结果与排程结果的**两段式**反馈。
   *
   * 第一段只说「保存成功了、提醒还在安排」；排程结论必须等本条目的真实回执
   * （`scheduled` / `delivered`）到手才说 —— 持久化确认 ≠ 排程成功。
   */
  let feedbackWaiters = [];
  const FEEDBACK_WAIT_MS = 30 * 1000;

  /**
   * UX-C03：新建成功后的**有限撤销**。
   *
   * 只针对本次创建、当前版本未被后续操作改变、且未开始投递的事项。
   * 过期/已变化一律拒绝并引导去修改 —— 用整份旧快照覆盖当前数据会造成丢改动。
   */
  function undoNewItem(itemId, rev) {
    const it = state.items.find(x => x.id === itemId);
    if (!it) return false;
    if (Number(it.rev) !== Number(rev)) {
      toast("这条之后又被改过 · 请直接修改");
      return false;
    }
    if (isTerminal(it) || it.acknowledgedAt) {
      toast("这条已经开始处理 · 请直接修改");
      return false;
    }
    const events = it.reminderEvents && typeof it.reminderEvents === "object" ? it.reminderEvents : {};
    const delivered = Object.keys(events).some(k => events[k] && events[k].state === "delivered");
    if (delivered || it.deliveredAt || it.lastRemindAt) {
      toast("这条已经开始提醒 · 请直接修改");
      return false;
    }
    // deleteItem 本身已由 wrapUserOp 包过：它已经负责「提交中拒绝」与命令日志，
    // 这里再套一层 runUserOp 会把同一条命令记两次。
    const applied = deleteItem(itemId);
    if (applied === false) return false;
    // 原生那边由接下来的对账撤销；失败会经 undoNativeCheckPending 如实说出来
    undoNativeCheckPending = true;
    queueNativeReminderSync("undo-new");
    toast("已撤销这条记录");
    return true;
  }

  /**
   * 保存结果的**唯一**反馈出口（F08）。
   *
   * 纪律：一次保存只发一条带动作的提示。此前「没有明确时间」的记录会在这一条之后
   * 又被 `toast("已收下 · 待整理", …)` 覆盖一次（那条不带撤销），用户看到的是
   * 「待整理 / 去整理」，而**撤销入口刚生成就被顶掉**。
   * 现在 `needs` 语义由本函数统一表达：文案与主动作说「待整理」，次动作仍是本次撤销。
   */
  function announceSaveOutcome(itemId, waiter) {
    const it = state.items.find(x => x.id === itemId);
    waiter = waiter || {};
    waiter.itemId = itemId;
    waiter.rev = it && it.rev != null ? it.rev : null;
    waiter.at = Date.now();
    waiter.draft = waiter.draft || null;
    waiter.needs = !!waiter.needs;
    feedbackWaiters = feedbackWaiters.filter(w => Date.now() - w.at < FEEDBACK_WAIT_MS);
    feedbackWaiters.push(waiter);
    // 排程结论未知时**不**借用全局状态：先把「已保存」这半句说实
    const feedbackApi = FeedbackLib;
    const pending = feedbackApi
      ? feedbackApi.reminderFeedback({ persistence: "confirmed", item: feedbackItemSnapshot(it), native: feedbackNativeSnapshot(), itemScheduled: null })
      : { text: "已保存，提醒安排尚未确认" };
    // UX-C03：新建与编辑都给「查看」定位入口；**只有新建**给 8 秒撤销
    const undoSecond = (!waiter.editing && waiter.allowUndo !== false && it)
      ? { label: "撤销", onClick: () => undoNewItem(itemId, waiter.rev) }
      : null;
    const undoCtx = undoSecond
      ? { durationMs: (FeedbackLib && FeedbackLib.UNDO_WINDOW_MS) || 8000 }
      : null;
    // F08：待整理语义以**同一个出口**表达，不再另发一条把撤销顶掉
    const decorate = (v) => {
      if (!waiter.needs) return v;
      const text = /待整理/.test(v.text) ? v.text : v.text + " · 待整理";
      return Object.assign({}, v, { text: text, actionLabel: "去整理", actionKind: "open-review" });
    };
    const first = decorate({ text: "已保存 · 正在安排提醒", actionLabel: "查看", actionKind: "open-item" });
    toast(first.text, first.actionLabel, () => { if (it) openDetail(itemId); }, undoSecond, undoCtx);
    // 桥不可用时不会再有下一轮对账：立刻按当前事实给出可行动的结论
    if (!nativeReady || !NativeReminders.reconcile) {
      feedbackWaiters = feedbackWaiters.filter(w => w !== waiter);
      const cur = state.items.find(x => x.id === itemId);
      const v = decorate(feedbackVerdictFor(cur, waiter));
      toast(v.text, v.actionLabel, () => runFeedbackAction(v.actionKind, cur, waiter), undoSecond, undoCtx);
      return;
    }
    // 本条走的是「没有明确时间」这类不需要排程结论的分支时，直接给结论
    if (pending.kind === "no-time" || pending.kind === "web" || pending.kind === "switch-off") {
      feedbackWaiters = feedbackWaiters.filter(w => w !== waiter);
      const cur = state.items.find(x => x.id === itemId);
      const v = decorate(pending);
      toast(v.text, v.actionLabel,
        () => runFeedbackAction(v.actionKind, cur, waiter), undoSecond, undoCtx);
    }
  }

  /** 一轮对账落定后，把等待中的保存反馈按**本条目的**结果更新。 */
  function settleSaveFeedback() {
    if (!feedbackWaiters.length) return;
    const waiters = feedbackWaiters.splice(0, feedbackWaiters.length);
    waiters.forEach(w => {
      const it = state.items.find(x => x.id === w.itemId);
      if (!it) return; // 事项已被删除/归档：不替它报结论
      const v = feedbackVerdictFor(it, w);
      // UX-C03：撤销窗口按**保存时刻**算，替换提示语不能顺手把它延长
      const remaining = Math.max(0, ((FeedbackLib && FeedbackLib.UNDO_WINDOW_MS) || 8000) - (Date.now() - w.at));
      const undoSecond = (!w.editing && w.allowUndo !== false && remaining > 0)
        ? { label: "撤销", onClick: () => undoNewItem(it.id, w.rev) }
        : null;
      toast(v.text, v.actionLabel, () => runFeedbackAction(v.actionKind, it, w),
        undoSecond, undoSecond ? { durationMs: remaining } : null);
    });
  }

  /* ---------- UX-T01 结束 ---------- */

  /* ---------- item sheet (capture / edit) ---------- */
  function resetItemSheet() {
    state.ui.editItemId = null;
    state.ui.pendingLowConf = null;
    // R-F03：换一张表单 = 换一个会话身份，之前提交的异步结果不再属于这张表单
    itemFormSession++;
    // L01：换一张表单就是新的一次判断，不能继承上一条的手选状态
    triggerUserPicked = false;
    lowConfUserPicked = false;
    $("#sheetItemTitle").textContent = "安心记下";
    $("#capText").value = "";
    $("#capNote").value = "";
    $("#capTags").value = "";
    $("#capUrl").value = "";
    $("#capTrigger").value = "";
    $("#capDeadline").value = "";
    $("#capProject").value = "";
    $("#capRepeat").value = "";
    $("#capRepeatMode").value = "calendar";
    $("#capNth").value = "1";
    $("#capWeekday").value = "1";
    $("#nthWeekdayRow").hidden = true;
    $("#similarHint").hidden = true;
    $("#similarHint").innerHTML = "";
    $("#repeatPreview").textContent = "";
    $("#repeatPreview").classList.add("muted");
    $$("#capPriority .chip").forEach(c => c.classList.toggle("on", c.dataset.p === "normal"));
    $("#capHint").textContent = "输入内容后自动解析时间";
    $("#capHint").classList.add("muted");
    $("#btnSaveItem").textContent = "安心交给系统";
    // UX-T01：新一张表单没有在途提交，按钮标签退回默认（不继承上一条的「保存中…」）
    $("#btnSaveItem").dataset.idleLabel = "";
    $("#btnSaveItem").disabled = false;
    // UX-C02：新建默认收起「更多选项」
    if ($("#capAdvanced")) $("#capAdvanced").hidden = true;
    if ($("#btnCapMore")) {
      $("#btnCapMore").textContent = "更多选项";
      $("#btnCapMore").setAttribute("aria-expanded", "false");
    }
    if ($("#capSummary")) $("#capSummary").innerHTML = "";
  }

  function openCapture(prefill) {
    resetItemSheet();
    refreshProjectSelects();
    if (prefill) {
      if (prefill.title) $("#capText").value = prefill.title;
      if (prefill.url) $("#capUrl").value = prefill.url;
      if (prefill.note) $("#capNote").value = prefill.note;
      updateParseHint();
    }
    openSheet("sheetItem");
    setTimeout(() => $("#capText").focus(), 280);
  }

  function openEditItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    resetItemSheet();
    refreshProjectSelects();
    state.ui.editItemId = id;
    $("#sheetItemTitle").textContent = "编辑事项";
    $("#btnSaveItem").textContent = "保存修改";
    $("#capText").value = it.title;
    $("#capNote").value = it.note || "";
    $("#capTags").value = (it.tags || []).join(" ");
    $("#capUrl").value = it.url || "";
    $("#capTrigger").value = toLocalInput(it.triggerAt);
    $("#capDeadline").value = toLocalInput(it.deadlineAt);
    $("#capProject").value = it.projectId || "";
    const every = it.repeat && it.repeat.every ? it.repeat.every : "";
    $("#capRepeat").value = every;
    $("#capRepeatMode").value = it.repeat && it.repeat.mode ? it.repeat.mode : "calendar";
    $("#nthWeekdayRow").hidden = every !== "nthWeekday";
    if (every === "nthWeekday") {
      $("#capNth").value = String(it.repeat.nth || 1);
      $("#capWeekday").value = String(it.repeat.dow != null ? it.repeat.dow : 1);
    }
    updateRepeatPreview();
    $$("#capPriority .chip").forEach(c => c.classList.toggle("on", c.dataset.p === it.priority));
    // UX-C02：编辑已有复杂事项时展开「更多选项」，并显示已设置内容摘要；
    // 未改动的字段完整保留（表单值已逐项填好，隐藏 ≠ 清空）。
    const complex = !!(it.repeat && it.repeat.every) || !!it.deadlineAt ||
      !!it.projectId || (it.priority && it.priority !== "normal") ||
      !!it.note || !!it.url || !!(it.tags && it.tags.length);
    if ($("#capAdvanced")) $("#capAdvanced").hidden = !complex;
    if ($("#btnCapMore")) {
      $("#btnCapMore").textContent = complex ? "收起更多选项" : "更多选项";
      $("#btnCapMore").setAttribute("aria-expanded", complex ? "true" : "false");
    }
    renderCaptureSummary();
    $("#capHint").textContent = "可直接修改时间与字段，不必重新解析";
    $("#capHint").classList.remove("muted");
    openSheet("sheetItem");
  }

  /**
   * 周期设置。传 `src`（`snapshotItemForm()` 的冻结快照）时只读快照，
   * 不读当前表单 —— R-F03 要求「落库内容只来自提交时冻结的那一份」。
   */
  function formRepeat(src) {
    const read = (sel, key) => (src ? String(src[key] == null ? "" : src[key]) : $(sel).value);
    const every = read("#capRepeat", "repeat");
    if (!every) return null;
    const mode = read("#capRepeatMode", "repeatMode") || "calendar";
    if (every === "nthWeekday") {
      return {
        every,
        mode,
        nth: parseInt(read("#capNth", "nth"), 10) || 1,
        dow: parseInt(read("#capWeekday", "weekday"), 10)
      };
    }
    return { every, mode };
  }

  function updateRepeatPreview() {
    const every = $("#capRepeat").value;
    $("#nthWeekdayRow").hidden = every !== "nthWeekday";
    const box = $("#repeatPreview");
    if (!every) {
      box.textContent = "";
      box.classList.add("muted");
      return;
    }
    const rep = formRepeat();
    const from = parseLocalInput($("#capTrigger").value) || Date.now();
    const list = nextRepeatPreview(rep, from, 5);
    box.textContent = "下次 5 次：" + list.map(t => fmtDate(t)).join("、");
    box.classList.remove("muted");
  }

  function normalizeText(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]/gu, "");
  }

  function findSimilarItems(title) {
    const key = normalizeText(title);
    if (key.length < 2) return [];
    return state.items.filter(it => {
      if (it.status === "archived" || it.status === "completed") return false;
      const t = normalizeText(it.title);
      if (!t) return false;
      if (t === key || t.includes(key) || key.includes(t)) return true;
      // token overlap
      const a = new Set(key.split(""));
      const b = new Set(t.split(""));
      let hit = 0;
      a.forEach(ch => { if (b.has(ch)) hit++; });
      return key.length >= 4 && hit / Math.min(a.size, b.size) > 0.72;
    }).slice(0, 3);
  }

  function renderSimilarHint(title) {
    const box = $("#similarHint");
    if (!box) return;
    const list = findSimilarItems(title);
    if (!list.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = '<div class="similar-box">可能已有类似提醒（不会自动合并）' +
      list.map(it => '<button type="button" data-open-similar="' + it.id + '">· ' +
        escapeHtml(it.title) + "</button>").join("") +
      "</div>";
  }

  /* low-confidence confirm — D15 保留能力，按「必要」条件触发 */
  function openLowConfSheet(defaultTs, rawText) {
    state.ui.pendingLowConf = defaultTs || fallbackTriggerAt();
    state.ui.pendingLowConfRaw = rawText || "";
    const custom = $("#lowConfCustom");
    if (custom) custom.value = toLocalInput(state.ui.pendingLowConf);
    const hint = $("#lowConfHint");
    if (hint) hint.textContent = "当前：" + fmtTime(state.ui.pendingLowConf);
    $$("#lowConfChips .chip").forEach(c => c.classList.remove("on"));
    openSheet("sheetLowConf");
  }

  let similarTimer = null;
  let pendingFinishSave = null;
  let lowConfUserPicked = false;

  function finishSaveAfterLowConf(ts) {
    if (ts) $("#capTrigger").value = toLocalInput(ts);
    lowConfUserPicked = true;
    if (pendingFinishSave) {
      const fn = pendingFinishSave;
      pendingFinishSave = null;
      fn(null);
    }
  }

  function setLowConfPick(ts, chipEl) {
    state.ui.pendingLowConf = ts;
    $("#lowConfCustom").value = toLocalInput(ts);
    $("#lowConfHint").textContent = "当前：" + fmtTime(ts);
    $$("#lowConfChips .chip").forEach(c => c.classList.remove("on"));
    if (chipEl) chipEl.classList.add("on");
  }

  /* daily summary */
  function maybeDailySummary() {
    if (!state.settings.dailySummary) return;
    const last = state.settings.lastSummaryAt || 0;
    if (Date.now() - last < 20 * 3600000) return;
    const today = startOfDay(new Date()).getTime();
    const added = state.items.filter(it => it.createdAt >= today).length;
    const important = state.items.filter(it =>
      it.createdAt >= today && (it.priority === "important" || it.priority === "critical")
    ).length;
    if (added >= 3 || important > 0) {
      state.settings.lastSummaryAt = Date.now();
      save();
      const msg = "今天新增 " + added + " 条未来关注" + (important ? "，其中 " + important + " 条重要" : "");
      toast(msg);
      showSystemNotification({
        title: "安心收件箱 · 今日摘要",
        body: msg,
        tag: "daily-summary",
        requireInteraction: false
      });
    } else {
      state.settings.lastSummaryAt = Date.now();
      save();
    }
  }

  function updateParseHint() {
    const text = $("#capText").value.trim();
    if (state.ui.editItemId) return;
    if (!text) {
      $("#capHint").textContent = "输入内容后自动解析时间";
      $("#capHint").classList.add("muted");
      if (!triggerUserPicked) {
        $("#capTrigger").value = "";
      }
      $("#capDeadline").value = "";
      return;
    }
    const p = parseChineseTime(text);
    // D17：低置信度是「没识别出精确时间」，不是「识别出一个约等于的时间」。
    // 把解析器拍的 +7 天写回表单，会让同一屏出现两句互相打脸的话 ——
    // 提示说「未识别精确时间」，摘要却说「提醒 9月26日 10:00」，时间框里也躺着一个具体日期。
    // 保存路径早就按同一条理由拒收它了（见 finishSave 的 parsedLow），这里只是让表单跟上。
    const lowConf = p.confidence === "low" || p.confidence === "none";
    // L01：用户手选的时间优先 —— 继续输入正文不得把它覆盖掉
    const picked = triggerUserPicked ? parseLocalInput($("#capTrigger").value) : null;
    if (!picked) $("#capTrigger").value = lowConf ? "" : toLocalInput(p.trigger);
    $("#capDeadline").value = toLocalInput(p.deadline);
    if (p.repeat) {
      $("#capRepeat").value = p.repeat.every;
      $("#capRepeatMode").value = p.repeat.mode;
      if (p.repeat.every === "nthWeekday") {
        $("#capNth").value = String(p.repeat.nth || 1);
        $("#capWeekday").value = String(p.repeat.dow != null ? p.repeat.dow : 1);
      }
    }
    let msg;
    if (picked) {
      msg = "已保留你选择的时间：" + fmtTime(picked) + " · 可修改";
    } else if (p.confidence === "high" || p.confidence === "mid") {
      msg = "已设置：" + fmtTime(p.trigger);
      if (p.deadline) msg += " · 截止 " + fmtDate(p.deadline);
      if (p.repeat) msg += " · " + repeatLabel(p.repeat);
      msg += " · 可修改";
    } else {
      // D17/D15：低置信度不再拍一个「一周后」，而是静默收下并在当晚整理时澄清
      msg = "未识别精确时间 · 先收下，稍后整理时再确认";
    }
    $("#capHint").textContent = msg;
    $("#capHint").classList.remove("muted");
    renderCaptureSummary();
  }

  /**
   * UX-C02：识别摘要。
   *
   * 必须显示**有效提醒时间**，以及已识别的周期/截止这类会影响行为的信息 ——
   * 把周期藏进「更多选项」会让用户以为建的是一次性记录，实际每两周回来一次。
   * 摘要只读表单的**当前值**，所以「清除或手选时间后摘要同步更新」是天然成立的。
   */
  function renderCaptureSummary() {
    const host = $("#capSummary");
    if (!host) return;
    const feedbackApi = FeedbackLib;
    if (!feedbackApi) { host.textContent = ""; return; }
    const hasContent = !!state.ui.editItemId ||
      ($("#capText") && $("#capText").value.trim());
    if (!hasContent) { host.textContent = ""; host.className = "cap-summary"; return; }
    const rep = formRepeat();
    const chip = $$("#capPriority .chip.on")[0];
    const pv = chip ? chip.dataset.p : "normal";
    const s = feedbackApi.captureSummary({
      triggerAt: parseLocalInput($("#capTrigger").value),
      repeatText: rep
        ? repeatLabel(rep) + (rep.mode === "ack" ? " · 从我点过「我知道了」重新计时" : "")
        : "",
      deadlineAt: parseLocalInput($("#capDeadline").value),
      priorityLabel: pv === "critical" ? "关键（用闹钟提醒）" : pv === "important" ? "重要（用闹钟提醒）" : ""
    });
    host.className = "cap-summary" + (s.empty ? " is-empty" : "");
    host.textContent = s.text;
  }

  /**
   * M1：编辑保存对事项造成的字段改动。
   *
   * 抽成独立函数是为了让「动作提交在途期间发生的编辑」也能进日志、被重放 ——
   * `saveItemFromForm` 本身要读表单，而重放时表单早已关闭，不能直接重放它。
   * 这里接收的是**取值完成的字段快照**，所以重放结果与当时完全一致。
   */
  function applyItemEdit(it, values) {
    if (!it) return false;
    const prevTrigger = it.triggerAt;
    it.title = values.title;
    it.note = values.note;
    it.tags = values.tags;
    it.url = values.url;
    it.projectId = values.projectId;
    it.priority = values.priority;
    // D25 编辑重算快照
    it.delivery_mode = resolveDeliveryMode(values.priority);
    it.triggerAt = values.triggerAt;
    it.scheduleBasis = values.scheduleBasis === "elapsed" ? "elapsed" : "wall-clock";
    it.localTrigger = it.scheduleBasis === "wall-clock" ? toLocalInput(values.triggerAt) : null;
    it.deadlineAt = values.deadlineAt;
    it.repeat = values.repeat;
    if (values.triggerAt !== prevTrigger) {
      // L08：改期等于开启新一轮 —— 轮次与预算一并重置（与 snoozeItem 同一语义）
      it.remindCount = 0;
      it.lastRemindAt = null;
      it.lastAlertShownAt = null;
      it.deliveredAt = null;
      it.snoozedAt = null;
      it.snoozeDelayMs = null;
      it.dismissedUntil = null;
    } else {
      it.snoozedAt = values.snoozedAt !== undefined ? values.snoozedAt : it.snoozedAt;
      it.snoozeDelayMs = values.snoozeDelayMs !== undefined ? values.snoozeDelayMs : it.snoozeDelayMs;
      it.dismissedUntil = values.dismissedUntil !== undefined ? values.dismissedUntil : it.dismissedUntil;
    }
    if (values.triggerAt && values.triggerAt !== prevTrigger && values.triggerAt > Date.now() && (it.status === "due" || it.status === "acknowledged")) {
      it.status = "waiting";
    }
    // V05：编辑保存必须推进版本，否则旧通知的事件版本与当前一致，仍会覆盖新安排
    bumpRev(it);
    return true;
  }

  /**
   * P1-A：**新建**一条事项的实际写入。
   *
   * 抽成参数自足的纯写入（稳定 id + 已解析字段快照），它才能进入命令日志并可靠重放。
   * id 由调用方给定 —— 重放沿用同一个 id，后续针对它的编辑/删除/稍后都能命中。
   * 幂等：同 id 已存在时直接返回，不会插入第二条。
   */
  function applyNewItem(id, fields) {
    const replayId = takeReplayCreatedId();
    if (replayId) id = replayId;
    if (!id) return false;
    if (state.items.some(x => x.id === id)) return false;
    state.items.push(normalizeItem(Object.assign({}, fields, { id: id })));
    return true;
  }

  function saveItemFromForm() {
    const rawPrefetch = $("#capText") ? $("#capText").value.trim() : "";
    // UX-T01：**同一身份的**重复提交在这里被挡住（不去动事务与命令序列）
    //
    // F02：身份必须与下面**真正登记在途提交时用的那一个逐字相同**。此前这里算的是
    // `new|<文本>|<时间>`，登记时却写 `new:<新ID>`（编辑 `edit:<ID>:<时间>`、
    // AI `ai:<时间>`）—— 两边永远对不上，于是「连续回车 / 双击」会真的落两条一样的事项。
    // 身份用**表单内容**而不是新生成的 id：id 每次都不同，也就永远去不了重。
    const submitToken = saveSubmitToken(itemFormSession, state.ui.editItemId, rawPrefetch, $("#capTrigger") ? $("#capTrigger").value : "");
    if (saveSubmitsInFlight.has(submitToken)) {
      toast("正在保存 · 请稍候");
      return false;
    }
    const raw = rawPrefetch;
    if (!raw && !state.ui.editItemId) {
      $("#capText").focus();
      toast("先写一句话吧");
      return;
    }

    const editing = state.ui.editItemId
      ? state.items.find(x => x.id === state.ui.editItemId)
      : null;

    /**
     * R-F03：**提交时冻结**这份草稿 + 它所属的表单会话。
     *
     * AI 是异步的，而人在 AI 窗口里会继续往下写。回来的结果只允许两种走向：
     *   · 落库内容 —— 一律取自这份冻结快照（AI 结果只补它没给出的字段）；
     *   · 回填/清空 UI —— 只有「还是同一张表单、且一个字都没改过」时才允许。
     * 之前这里是先 `applyAiToForm`（无条件覆盖表单）再读**当前**表单去保存，
     * 于是慢响应回来时：用户第二份草稿被清空，而且第一份的**备注**取到了第二份的值。
     */
    const frozenDraft = snapshotItemForm();
    const frozenSig = formDraftSignature(frozenDraft);
    const frozenSession = itemFormSession;
    /** 表单是否还是当初提交的那一张、且内容未被改动 */
    const formUntouched = () =>
      itemFormSession === frozenSession && formDraftSignature(snapshotItemForm()) === frozenSig;

    /**
     * @param parsed 已解析结果（null = 走本地解析）
     * @param opts.resuming 本次调用是**同一个在途提交的续跑**（AI 理解完之后接着提交）——
     *        续跑不再重新登记身份，否则它会把自己挡在门外。
     * @param opts.source 冻结草稿（R-F03）。给了就只读它，不读当前表单；
     *        不给（低置信度面板续跑）才读当前表单 —— 那是同一次交互内的显式手选。
     */
    const finishSave = (parsed, opts) => {
      const resuming = !!(opts && opts.resuming);
      const src = (opts && opts.source) || snapshotItemForm();
      // F02：按钮 disabled 挡不住输入框的 Enter 监听，真正的闸门只能在这里 ——
      // 同一个身份第二次进来必须被拒，否则一次保存会落两条。
      if (!resuming && saveSubmitsInFlight.has(submitToken)) {
        toast("正在保存 · 请稍候");
        return false;
      }
      if (!resuming) beginSaveSubmit(submitToken);
      let title = raw;
      if (parsed) {
        title = parsed.title || raw || (editing ? editing.title : "未命名事项");
      } else if (!editing) {
        const local = parseChineseTime(raw);
        parsed = local;
        title = local.title || raw;
      } else {
        title = raw || (editing ? editing.title : "未命名事项");
      }

      const extraTags = String(src.tags == null ? "" : src.tags).trim().split(/\s+/).filter(Boolean);
      const parsedTags = (!editing && parsed) ? (parsed.tags || []) : [];
      const tags = Array.from(new Set(parsedTags.concat(extraTags)));
      const priority = src.priority || "normal";

      const formTrigger = parseLocalInput(src.trigger);
      let triggerAt;
      let scheduleBasis;
      let snoozedAt = editing ? editing.snoozedAt : null;
      let snoozeDelayMs = editing ? editing.snoozeDelayMs : null;

      if (editing) {
        const triggerAction = src.triggerAction || (src.triggerPicked ? (src.trigger ? "changed" : "cleared") : "untouched");
        const initialFormTrigger = toLocalInput(editing.triggerAt);
        const formTriggerMatchesInitial = (src.trigger || "") === initialFormTrigger;

        if (triggerAction === "cleared" || (!src.trigger && editing.triggerAt != null && src.triggerPicked)) {
          // 显式清空时间
          triggerAt = null;
          scheduleBasis = "wall-clock";
          snoozedAt = null;
          snoozeDelayMs = null;
        } else if (triggerAction === "changed" || (!formTriggerMatchesInitial && src.trigger)) {
          // 显式选择新时间 / 改期
          triggerAt = formTrigger;
          scheduleBasis = "wall-clock";
          snoozedAt = null;
          snoozeDelayMs = null;
        } else if (!src.trigger && editing.triggerAt == null) {
          // 本身无时间且保持为空
          triggerAt = null;
          scheduleBasis = "wall-clock";
          snoozedAt = null;
          snoozeDelayMs = null;
        } else {
          // 未动：保留原提醒时间与时间基准（包括稍后产生的 elapsed 提醒元数据）
          triggerAt = editing.triggerAt;
          scheduleBasis = editing.scheduleBasis || "wall-clock";
          snoozedAt = editing.snoozedAt;
          snoozeDelayMs = editing.snoozeDelayMs;
        }
      } else {
        // L01：时间来源优先级固定为「用户明确选择 > 有效解析 > 兜底」
        //  · explicitTime  = 用户手选（时间输入框 / 低置信度极简选择）
        //  · parsedTrigger = 解析器给出的真实时间（低置信度时不算「真实时间」）
        //  · formTrigger   = 表单当前值，可能是解析器写进去的，因此排在解析结果之后
        const parsedTrigger = parsed ? (parsed.trigger || parsed.triggerAt) : null;
        const userPicked = !!(src.triggerPicked || src.lowConfPicked);
        const explicitTime = userPicked ? formTrigger : null;
        const parsedLow = !!(parsed && (parsed.confidence === "low" || parsed.confidence === "none"));
        triggerAt = explicitTime || (parsedLow ? null : (parsedTrigger || formTrigger)) || null;
        scheduleBasis = !userPicked && !parsedLow && parsed && parsed.scheduleBasis === "elapsed"
          ? "elapsed" : "wall-clock";
      }

      const deadlineAt = parseLocalInput(src.deadline) || (!editing && parsed ? parsed.deadline || parsed.deadlineAt : null);
      const repeat = formRepeat(src) || (!editing && parsed && parsed.repeat
        ? (parsed.repeat.every === "nthWeekday"
            ? { every: "nthWeekday", mode: parsed.repeat.mode || "calendar", nth: parsed.repeat.nth || 1, dow: parsed.repeat.dow != null ? parsed.repeat.dow : 1 }
            : parsed.repeat)
        : null);

      if (editing) {
        // 编辑保存记录在案：原生草稿提交成功后按原值重放。
        // R-F03：draft 也用冻结快照 —— 它决定「表单能否关闭/复位」与失败重试恢复的内容。
        const draft = src;
        const draftSig = formDraftSignature(draft);
        const applied = runUserOp(applyItemEdit, [editing, {
          title: title,
          note: String(src.note == null ? "" : src.note).trim(),
          tags: tags,
          url: String(src.url == null ? "" : src.url).trim(),
          projectId: src.project || "",
          priority: priority,
          triggerAt: triggerAt,
          scheduleBasis: scheduleBasis,
          snoozedAt: snoozedAt,
          snoozeDelayMs: snoozeDelayMs,
          deadlineAt: deadlineAt,
          repeat: repeat
        }], { userFacing: true, itemArg: 0, name: "editItem" });
        if (applied === false) { endSaveSubmit(submitToken); return false; }
        const editId = editing.id;
        const pendingEdit = save();
        // UX-T01：权威持久化确认之前，不显示「已保存」，也不清掉输入
        pendingEdit.then(() => {
          endSaveSubmit(submitToken);
          // F03：只有草稿还是刚才提交的那一份时才关闭并复位表单
          if (itemFormSession === frozenSession && formDraftSignature(snapshotItemForm()) === draftSig) {
            closeSheet("sheetItem");
            closeSheet("sheetDetail");
            resetItemSheet();
          }
          render();
          announceSaveOutcome(editId, { editing: true, draft: draft, persistence: "confirmed" });
          queueNativeReminderSync("save-edit");
        }).catch(() => {
          endSaveSubmit(submitToken);
          settleFailedDraft(draft, draftSig, frozenSession);
        });
        return true;
      }

      const item = makeItem({
        title,
        note: String(src.note == null ? "" : src.note).trim(),
        tags,
        url: String(src.url == null ? "" : src.url).trim(),
        projectId: src.project || "",
        priority,
        status: "waiting",
        triggerAt,
        scheduleBasis,
        localTrigger: scheduleBasis === "wall-clock" ? toLocalInput(triggerAt) : null,
        deadlineAt,
        windowStart: parsed && parsed.window ? parsed.window.start : null,
        windowEnd: parsed && parsed.window ? parsed.window.end : null,
        repeat,
        review_status: "READY",
        delivery_mode: resolveDeliveryMode(priority)
      });
      const needs = detectNeedsReview({
        title: item.title,
        note: item.note,
        url: item.url,
        triggerAt: item.triggerAt,
        confidence: parsed ? parsed.confidence : "none"
      });
      if (needs) {
        item.review_status = "NEEDS_REVIEW";
        // D17 / L01：**只有**「用户明确时间、解析真实时间都没有」时才落到兜底值。
        // 用户手选的时间被解析器或兜底覆盖，是这一轮最典型的「动作已明确、系统却按另一种含义执行」。
        if (!item.triggerAt) {
          item.triggerAt = fallbackTriggerAt();
          item.scheduleBasis = "wall-clock";
          item.localTrigger = toLocalInput(item.triggerAt);
          item.isFallbackTrigger = true;
        }
      }
      // 新建也走命令日志（稳定 id + 已解析字段快照），草稿发布后沿用同一业务身份。
      // R-F03：与编辑路径同理，draft 用冻结快照。
      const draft = src;
      const draftSig = formDraftSignature(draft);
      runUserOp(applyNewItem, [item.id, item]);
      const newId = item.id;
      const pendingNew = save();
      pendingNew.then(() => {
        endSaveSubmit(submitToken);
        if (itemFormSession === frozenSession && formDraftSignature(snapshotItemForm()) === draftSig) {
          closeSheet("sheetItem");
          resetItemSheet();
          state.ui.tab = "home";
        }
        render();
        // F08：**唯一的**反馈出口。「待整理」与「撤销」必须在同一条提示里 ——
        // 以前这里随后又发一条不带撤销的 toast，把刚生成的撤销入口当场覆盖掉，
        // 于是「无时间的记录」永远拿不到撤销（独立验收只对有明确时间的记录出现撤销）。
        announceSaveOutcome(newId, { editing: false, draft: draft, persistence: "confirmed", needs: needs });
        // UX-T02：第一次保存了「真有提醒时间」的事项之后，才给出可跳过的设置入口
        noteFirstRemindSaved(item);
        queueNativeReminderSync("save-new");
        // UX-C03：新建成功后的定位入口在反馈里（「查看」直接打开这条详情）
      }).catch(() => {
        endSaveSubmit(submitToken);
        // 未落库 ⇒ 不能留下一条「看起来已保存」的事项，也不能丢掉用户输入
        state.items = state.items.filter(x => x.id !== newId);
        settleFailedDraft(draft, draftSig, frozenSession);
      });
      return true;
    };

    // Capture always succeeds — low confidence becomes NEEDS_REVIEW, not a blocker
    // D15：仅当「含具体时间词却落到兜底」时才打断（极简选择）；其余静默收下
    if (!editing) {
      lowConfUserPicked = false;
      const localP = parseChineseTime(raw);
      const low = localP.confidence === "low" || localP.confidence === "none";
      if (low && hasSpecificTimeWord(raw)) {
        pendingFinishSave = finishSave;
        // F02：这一步只是「先问时间」，并不是在途提交 —— 必须把身份放开，
        // 否则用户一旦取消这个面板，同一份内容就再也不能提交了。
        // 确认（或改选）之后 finishSave 会重新登记同一身份并正常走完。
        endSaveSubmit(submitToken);
        openLowConfSheet(fallbackTriggerAt(), raw);
        return;
      }
      if (low) {
        // 不把解析器拍的 +7 天写回表单——兜底由 D17 统一处理
        return finishSave(localP);
      }
    }

    // AI auto-enhance on save (optional)
    //
    // UX-T01：AI 是**本地回退**而不是前提 —— 它失败时走的是 `finishSave(null)`（本地解析），
    // 所以这一段只负责「保存中有反馈 + 不重复提交」，不再自己占着按钮状态不还。
    if (!editing && ai.ready() && ai.config().autoOnSave && raw) {
      const btn = $("#btnSaveItem");
      // F02：AI 在途期间占用的必须是**同一个提交身份**（以前是 `ai:<时间戳>`，
      // 于是「AI 还没回来又按一次回车」既不命中按钮闸门、也不命中待提交集合，
      // 两次 AI 结果各自提交一份一模一样的事项）。
      beginSaveSubmit(submitToken);
      if (btn) btn.textContent = "AI 理解中…";
      // R-F03：AI 结果**只**允许落进「还是当初那张表单」的界面；
      // 落库内容一律来自提交时冻结的 `frozenDraft`（AI 结果合并在它的副本上）。
      const frozenText = String(frozenDraft.text == null ? "" : frozenDraft.text).trim();
      ai.parseCapture(raw)
        .then(r => {
          // `ai.mergedDraft()` 是**纯快照合并**：不碰当前表单、不碰 DOM。
          // 「合到哪儿」由入口按 `formUntouched()` 决定 —— 那道闸门不能搬进模块，
          // 否则模块就得自己认识 `itemFormSession`（R-F03 的迟到响应保护）。
          const merged = ai.mergedDraft(frozenDraft, r);
          if (formUntouched()) ai.applyToForm(r, "AI 理解");
          finishSave({
            title: String(merged.text == null ? "" : merged.text).trim() || frozenText || r.title,
            trigger: parseLocalInput(merged.trigger),
            deadline: parseLocalInput(merged.deadline),
            tags: String(merged.tags == null ? "" : merged.tags).trim().split(/\s+/).filter(Boolean),
            window: null,
            repeat: formRepeat(merged),
            confidence: "high"
          }, { resuming: true, source: merged });
        })
        .catch(() => {
          // AI 失败回退本地解析：不吞掉用户输入，也不因此判保存失败。
          // R-F03：同样走冻结快照，不许把 AI 窗口里新写的内容当成这次提交的内容。
          finishSave(null, { resuming: true, source: frozenDraft });
        });
      return;
    }

    return finishSave(null);
  }

  /* ---------- detail ---------- */


  /* ---------- P2-F1 content forwarding: implementation is lib/app-content.js ---------- */
  function openNote(id) { return appContent.openNote(id); }
  function saveNote() { return appContent.saveNote(); }
  function doSearch(q) { return appContent.doSearch(q); }
  function renderProjectsSheet() { return appContent.renderProjectsSheet(); }
  function addProject() { return appContent.addProject(); }
  function deleteProject(id) { return appContent.deleteProject(id); }

  function applyProjectRemovalToItems(id) {
    state.items.forEach(it => {
      if (it.projectId !== id) return;
      it.projectId = "";
      bumpRev(it);
    });
    return true;
  }

  /* ---------- notifications ---------- */
  let alertItem = null;
  const dismissedAlerts = Object.create(null);

  /**
   * 原生状态的**唯一漏斗**。
   *
   * `origin` 刻意是显式参数而不是「有没有某个字段」的推断：
   * 只有**真正跑完一轮对账**（reconcile）才允许结清保存反馈 ——
   * 权限刷新（onResume / 从系统设置切回）只是重读权限，它没有重排任何东西，
   * 拿它当「排程结论已定」会让刚保存的事项被过早宣布为「尚未确认」。
   */
  function setNativeReminderStatus(status, origin) {
    nativeReminderStatus = Object.assign({}, nativeReminderStatus, status || {});
    if (state.ui.tab === "me") renderPwaStatus();
    // A-2 / D68：首页告知条吃同一份状态，且**不看当前在哪个 tab** ——
    // #homeNotice 始终在 DOM 里，提前写好比等用户切回首页时再算更稳。
    // onResume（从系统设置切回）经 getPermissionState → 这里，
    // 于是「恢复权限后警告自动消失 / 撤销后自动出现」都无需另建通路（基线 §473 后半句）。
    renderHomeNotice();
    if (origin === "reconcile") {
      // UX-A03：撤销之后的这一轮对账若失败，必须说出来 —— 旧提醒可能还在系统里
      if (undoNativeCheckPending) {
        undoNativeCheckPending = false;
        if (nativeReminderStatus.reliability === "error") {
          toast("撤销已生效，但系统里的旧提醒可能还没取消 · 点这里重试", "重试",
            () => { undoNativeCheckPending = true; queueNativeReminderSync("undo-retry"); });
        }
      }
      // 微任务里结算：applyReminderEvents 与本函数在同一个同步块内，
      // 提前结算会读到**上一轮**的事件台账（反馈就会晚一拍甚至报错）。
      const pending = feedbackWaiters.slice();
      if (pending.length) {
        Promise.resolve().then(() => settleSaveFeedback());
      }
    }
  }

  function refreshNativeScheduleBasis() {
    if (!NativeReminders.migrateItem) return false;
    let changed = false;
    state.items.forEach(it => {
      if (NativeReminders.migrateItem(it)) changed = true;
    });
    if (changed) save();
    return changed;
  }

  function sameIdSet(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /**
   * O4：**调用内**的 id → 事项 索引。
   *
   * 语义与 `list.find(x => x.id === id)` 逐字一致：**先出现者胜**。
   * 这正是不能用 `new Map(list.map(it => [it.id, it]))` 的原因 —— Map 构造会被后出现者覆盖，
   * 数据里一旦有重复 id，查找结果会从「首项」静默变成「末项」，行为跟着变。
   *
   * 只在单次调用内使用，绝不做跨入口维护的全局缓存：全局缓存一旦漏了某个修改入口，
   * 缺陷形态是「改了某条事项后对账仍然按旧对象算」，比多扫一遍数组危险得多。
   */
  function indexItemsById(list) {
    const map = new Map();
    (list || []).forEach(it => {
      if (!it) return;
      if (map.has(it.id)) return; // 首项胜
      map.set(it.id, it);
    });
    return map;
  }

  /**
   * F1 / G3：把对账回传的截止事件按**阶段**写回事项的事件表。
   *
   * 关键约束：只有状态真的变化时才 save。此前两个阶段共用一个槽位，
   * 每轮都在 p24 / p2 之间来回覆盖 → changed 永远为真 → 持续写库并触发下一轮对账。
   *
   * 三种状态，语义必须分开（G3）：
   *  · `scheduled` 已请求系统投递、还没有证据 → 保持待定，**不因为时刻过了就算送达**；
   *  · `delivered` 有**真实送达证据**（`markDeadlineDelivered`，来自系统回调）；
   *  · `cancelled` 排程被成功撤销（`cancelledEvents`，来自原生本轮真正取消的排程）
   *    → 重新开启通知后允许补提醒。
   *
   * 之前「当前计划不含某阶段」时仅凭 `at <= now` 就改写为 `delivered`：
   * 排程后关掉通知、或撤销成功，越过原计划时刻再开启，这条**已被取消**的记录会被
   * 当成已送达，`buildDesired` 随后直接排除该阶段 —— 用户永远收不到这次保护提醒。
   *
   * @param {Array} events 本轮计划中的截止事件（已排程）
   * @param {number} now
   * @param {Array} cancelledEvents 本轮被原生确认撤销的截止排程（可选）
   */
  function applyDeadlineEvents(events, now, cancelledEvents, options) {
    const planned = new Map();
    (events || []).forEach(ev => {
      if (!ev || !ev.itemId || !ev.stageKey) return;
      if (!planned.has(ev.itemId)) planned.set(ev.itemId, new Map());
      planned.get(ev.itemId).set(ev.stageKey, Number(ev.at));
    });
    // G3：本轮原生**确认撤销**的排程，按事项分组
    const cancelledKeys = new Map();
    (cancelledEvents || []).forEach(ev => {
      if (!ev || !ev.itemId || !ev.stageKey) return;
      if (!cancelledKeys.has(ev.itemId)) cancelledKeys.set(ev.itemId, new Set());
      cancelledKeys.get(ev.itemId).add(ev.stageKey);
    });
    let changed = false;
    const targetItemIds = new Set(planned.keys());
    cancelledKeys.forEach((_v, itemId) => targetItemIds.add(itemId));
    state.items.forEach(it => {
      if (it && it.deadlineEvents && typeof it.deadlineEvents === "object") {
        targetItemIds.add(it.id);
      }
    });
    // O4：调用内建一次索引。原先 `targetItemIds.forEach(id => state.items.find(...))`
    // 是 O(目标数 × n)。索引按**先出现者胜**建，与 `Array.find` 的首项匹配语义逐字一致
    // （重复 id 时不会像 `new Map(items.map(...))` 那样被末项覆盖）。
    // 本函数在遍历期间只写 `it.deadlineEvents`，不改动 state.items 成员，索引全程有效。
    const byId = indexItemsById(state.items);
    targetItemIds.forEach(itemId => {
      const it = byId.get(itemId);
      if (!it) return;
      const stages = planned.get(itemId) || new Map();
      const cancelled = cancelledKeys.get(itemId) || null;
      const dl = Number(it.deadlineAt) || 0;
      const prev = it.deadlineEvents && typeof it.deadlineEvents === "object" ? it.deadlineEvents : {};
      const next = {};
      const keep = (key, value) => { next[key] = value; };
      // 1) 本轮计划中的阶段：以原生回传的**实际排程时刻**为准
      stages.forEach((at, stageKey) => {
        if (!dl || String(stageKey).indexOf("@" + dl) < 0) return; // 只保留属于当前截止时间的阶段
        const old = prev[stageKey];
        // 已送达是终态：真实送达证据不能被后续对账抹掉
        if (old && typeof old === "object" && old.state === "delivered") { keep(stageKey, old); return; }
        keep(stageKey, { at: at, state: "scheduled" });
      });
      // 2) 保留当前截止时间下已有的历史记录
      Object.keys(prev).forEach(stageKey => {
        if (next[stageKey]) return;
        if (!dl || String(stageKey).indexOf("@" + dl) < 0) return;
        const old = prev[stageKey];
        if (!old || typeof old !== "object") return;
        if (old.state === "delivered" || old.state === "cancelled") { keep(stageKey, old); return; }
        const at = Number(old.at) || 0;
        // 只有「原生确认撤销」且撤销发生在**投递时刻之前**才算撤销：
        // 若已越过投递时刻，无法判定是否已经送达，保持待定（不补发、也不谎报送达）
        if (at > now && cancelled && cancelled.has(stageKey)) {
          keep(stageKey, { at: at, state: "cancelled" });
          return;
        }
        keep(stageKey, old);
      });
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        if (Object.keys(next).length > 0) {
          it.deadlineEvents = next;
        } else {
          delete it.deadlineEvents;
        }
        changed = true;
      }
    });
    // O2：`options.deferNativeSync` 只由**原生对账内部的回写**传入 —— 那时写进去的就是
    // 刚刚算出来的投影结果本身，再请求一轮对账没有新信息，只会自激。
    // 其它调用方（导入、迁移、事件回调）不给选项，照常请求同步。
    if (changed) save(options);
    return changed;
  }

  /**
   * D43：单次提醒台账 —— 与 `applyDeadlineEvents` **同构**，只是键从「阶段@截止时刻」
   * 换成「尝试序号@原定触发点」。
   *
   * 为什么要这一层：投影只排**严格未来**的触发点，于是「触发点已过、事项仍活跃」的提醒
   * 拿不到原生通知（用户少一条提醒）；而补投必须能回答「这个触发点是否已经消费过」，
   * 否则每次对账都会再补一次。三态语义与截止台账逐字对齐（见 applyDeadlineEvents 注释）。
   *
   * 键里带的是**原定触发点**而不是补投时刻：身份必须跨对账稳定，否则每轮都换一个身份
   * → 撤销/重排循环（这正是 R6 注释警告过的形态）。
   *
   * 每个条目另带 **`roundBase`**（R-F06）：登记它时事项的触发起点，也就是「这属于哪一轮」。
   * 键只能证明「我们承诺过这个时刻」，证明不了「它属于当前这一轮」——「稍后提醒」把时间
   * 往后推之后，旧轮的追提醒键照样落在新轮的时间范围里，于是旧回执会把新轮抬成
   * 「系统已接收」。有 `roundBase` 才分得开。旧条目没有这个字段时保持不可验证；
   * 只有当前原生对账再次明确登记同一个键，才为它补上可证明的本轮身份。
   */
  function applyReminderEvents(events, now, cancelledEvents, options) {
    const planned = new Map();
    (events || []).forEach(ev => {
      if (!ev || !ev.itemId || !ev.key) return;
      if (!planned.has(ev.itemId)) planned.set(ev.itemId, new Map());
      planned.get(ev.itemId).set(ev.key, Number(ev.at));
    });
    const cancelledKeys = new Map();
    (cancelledEvents || []).forEach(ev => {
      if (!ev || !ev.itemId || !ev.key) return;
      if (!cancelledKeys.has(ev.itemId)) cancelledKeys.set(ev.itemId, new Set());
      cancelledKeys.get(ev.itemId).add(ev.key);
    });
    let changed = false;
    const targetItemIds = new Set(planned.keys());
    cancelledKeys.forEach((_value, itemId) => targetItemIds.add(itemId));
    state.items.forEach(it => {
      if (it && it.reminderEvents && typeof it.reminderEvents === "object" &&
        Object.keys(it.reminderEvents).length > 0) targetItemIds.add(it.id);
    });
    // O4：同 applyDeadlineEvents —— 调用内索引，首项胜；遍历期间不改动 state.items 成员。
    const byId = indexItemsById(state.items);
    targetItemIds.forEach(itemId => {
      const it = byId.get(itemId);
      if (!it) return;
      const keys = planned.get(itemId) || new Map();
      const cancelled = cancelledKeys.get(itemId) || null;
      const base = Number(it.triggerAt) || 0;
      const prev = it.reminderEvents && typeof it.reminderEvents === "object" ? it.reminderEvents : {};
      const next = {};
      const keep = (key, value) => { next[key] = value; };
      // 1) 本轮计划中的触发点：以原生回传的**实际排程时刻**为准（补投时那是 now+2s）
      keys.forEach((at, key) => {
        if (!base || !reminderKeyInTriggerRange(key, base)) return;
        const old = prev[key];
        // 已送达是终态：真实送达证据不能被后续对账抹掉；
        // suppressed 同样保留 —— 那是用户撤销「完成」时确认过不要这一次（R5）
        if (old && typeof old === "object" &&
          (old.state === "delivered" || old.state === "suppressed")) {
          // 当前原生对账再次登记了同一个键，才足以把升级前缺身份的终态锚到本轮；
          // 已有明确身份一律原样保留，不能把历史轮次改写成当前轮。
          keep(key, old.roundBase == null
            ? Object.assign({}, old, { roundBase: base })
            : old);
          return;
        }
        // 原生这一轮真的排了它 ⇒ 它就是当前轮的键，轮次身份跟着刷新
        keep(key, { at: at, state: "scheduled", roundBase: base });
      });
      // 2) 保留当前触发起点下的已有记录
      Object.keys(prev).forEach(key => {
        if (next[key]) return;
        if (!base || !reminderKeyInTriggerRange(key, base)) return;
        const old = prev[key];
        if (!old || typeof old !== "object") return;
        // 保留历史条目时必须**连同它原来的轮次身份一起**保留：
        // 丢掉 roundBase 会让旧轮的键看起来像当前轮（R-F06 就是这么漏过去的）
        const roundField = (old.roundBase != null && Number.isFinite(Number(old.roundBase)))
          ? { roundBase: Number(old.roundBase) } : {};
        if (old.state === "delivered" || old.state === "cancelled" ||
          old.state === "suppressed") { keep(key, old); return; }
        const at = Number(old.at) || 0;
        // 只有「原生确认撤销」且撤销发生在**投递时刻之前**才算撤销：
        // 越过投递时刻后无法判定是否已经送达，保持待定（不补发、也不谎报送达）
        if (at > now && cancelled && cancelled.has(key)) {
          keep(key, Object.assign({ at: at, state: "cancelled" }, roundField));
          return;
        }
        keep(key, old);
      });
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        if (Object.keys(next).length > 0) {
          it.reminderEvents = next;
        } else {
          delete it.reminderEvents;
        }
        changed = true;
      }
    });
    // O2：同 applyDeadlineEvents —— 仅原生对账内部的投影结果回写才 defer。
    if (changed) save(options);
    return changed;
  }

  /**
   * D43：只保留属于**当前触发起点**的记录（`>= triggerAt`）。
   *
   * 与截止台账按 `@<deadlineAt>` 过滤同一思路：用户把触发时间往后改了，旧承诺的消费记录
   * 就该作废；保留它们只会让台账无限增长并让「已排期」永久钉住新触发点。
   * 用 `>=` 而不是 `===`：勿扰顺延会让首期触发点晚于 `triggerAt`（见 effectiveTriggerAt）。
   */
  function reminderKeyInTriggerRange(key, triggerAt) {
    const at = Number(String(key).split("@")[1]);
    return Number.isFinite(at) && at >= triggerAt;
  }

  /** F1：系统送达回调 —— 真实的送达证据，直接标记 delivered */
  function markDeadlineDelivered(event) {
    if (!event || !event.itemId || !event.stageKey) return false;
    const it = state.items.find(x => x.id === event.itemId);
    if (!it) return false;
    if (!it.deadlineEvents || typeof it.deadlineEvents !== "object") it.deadlineEvents = {};
    const old = it.deadlineEvents[event.stageKey];
    if (old && old.state === "delivered") return false;
    it.deadlineEvents[event.stageKey] = {
      at: old && Number(old.at) ? Number(old.at) : Date.now(),
      state: "delivered"
    };
    save();
    return true;
  }

  let nativeSyncInFlight = false;
  let nativeSyncPending = false;
  let nativeSyncVersion = 0;
  let nativeSyncMetrics = {
    totalRequests: 0,
    bySource: {},
    runs: 0,
    deduped: 0,
    /** P2-C-R：因权威状态未确认而被拦下的原生对账次数（`failed` 期间必须为 0 次真实排程）。 */
    blockedByAuthority: 0
  };

  function bumpNativeSyncVersion() {
    nativeSyncVersion++;
  }

  async function syncNativeRemindersNow() {
    const options = arguments[0];
    if (!nativeReady || !NativeReminders.reconcile) return nativeReminderStatus;
    if (nativeSyncInFlight) {
      nativeSyncPending = true;
      nativeSyncMetrics.deduped++;
      return nativeReminderStatus;
    }
    nativeSyncInFlight = true;
    try {
      while (true) {
        nativeSyncPending = false;
        const capturedVersion = nativeSyncVersion;
        // 阶段 C：读取不可变的已提交快照
        const snapshotItems = JSON.parse(JSON.stringify(state.items || []));
        const snapshotSettings = JSON.parse(JSON.stringify(state.settings || {}));
        const review = {
          count: needsReviewItems().length,
          settings: ensureReviewSettings()
        };
        nativeSyncMetrics.runs++;
        const status = await NativeReminders.reconcile(snapshotItems, snapshotSettings, Date.now(), review, options);
        setNativeReminderStatus(status, "reconcile");

        // 阶段 C 返工（F2）：平台已成功执行的副作用必须独立跟踪并补偿。
        // 无论对账期间业务版本是否漂移，底层真实排下的闹钟台账（scheduledAlarmIds / scheduledAlarmSignatures）
        // 都必须同步到 state.settings 中，以便后续对账能够感知并撤销在途被删除或改期事项的旧排程，杜绝幽灵闹钟。
        const idsChanged = status && Array.isArray(status.scheduledAlarmIds) &&
          !sameIdSet(state.settings.scheduledAlarmIds, status.scheduledAlarmIds);
        const sigsChanged = status && status.scheduledAlarmSignatures &&
          JSON.stringify(state.settings.scheduledAlarmSignatures || {}) !== JSON.stringify(status.scheduledAlarmSignatures || {});
        if (idsChanged) state.settings.scheduledAlarmIds = status.scheduledAlarmIds;
        if (sigsChanged) state.settings.scheduledAlarmSignatures = status.scheduledAlarmSignatures;

        // 业务消费记录仅在版本未漂移时才写回，旧轮结果绝不覆盖新业务状态
        if (capturedVersion === nativeSyncVersion) {
          // O2：这一段的保存都是**确认刚才这一轮投影结果**，不是新的业务变更 ——
          // 事件台账写回与下面的结果记账都必须 `deferNativeSync`，否则
          // save → queue → reconcile 会自激成「一次业务变更 = 至少两轮对账」。
          // 台账状态本身会在**下一次**真实对账（用户保存 / 回前台 / 权限变化）时被读取，
          // 不丢语义；被推迟的只是由本次记账凭空触发的那一轮。
          const ledgerOptions = { deferNativeSync: true };
          if (status && Array.isArray(status.deadlineEvents)) {
            applyDeadlineEvents(status.deadlineEvents, Date.now(), status.cancelledDeadlineEvents, ledgerOptions);
          }
          if (status && Array.isArray(status.reminderEvents)) {
            applyReminderEvents(status.reminderEvents, Date.now(), status.cancelledReminderEvents, ledgerOptions);
          }
          if (idsChanged || sigsChanged) {
            // 纯结果记账使用 deferNativeSync，避免 save → queue → reconcile 自激死循环
            save(ledgerOptions);
          }
          if (!nativeSyncPending) {
            break;
          }
        }
      }
      return nativeReminderStatus;
    } catch (error) {
      const status = { reliability: "error", error: error && error.message ? error.message : String(error) };
      setNativeReminderStatus(status);
      return status;
    } finally {
      nativeSyncInFlight = false;
    }
  }

  /**
   * Q6：确保原生提醒链路就绪 —— 幂等、可重试、不阻塞。
   *
   * **这是「关掉 App 就不响」的根治点。**
   *
   * Capacitor 的 `window.Capacitor` 由原生 WebView 注入，而 index.html **不加载
   * capacitor.js**；`init()` 又在 DOMContentLoaded 就跑。二者之间存在稳定的时间差：
   * 实测本机模拟器上，init() 执行时 window.Capacitor 还是 undefined，
   * 六秒后才 7 个插件齐全。
   *
   * 旧实现在这个时间差上**永久放弃**（开头一句 `if (!isNativeAndroid()) return`，
   * 且 nativeReady 再也没机会变 true）。由于 queueNativeReminderSync 的首行守卫是
   * `if (!nativeReady) return`，整场会话的**每一次对账都被丢掉** —— 一条排程都不落。
   * 而 tick() 的应用内提醒不依赖原生，于是现象精确地表现为：
   * 「打开 App 有提醒，关掉 App 什么都不响」。
   *
   * 现在：桥晚到就等，等不到就留可见记录，之后任何一次同步请求都会**再试一遍**。
   */
  function ensureNativeReminders() {
    if (nativeReady) return Promise.resolve(true);
    if (nativeInitPromise) return nativeInitPromise;
    nativeInitPromise = initializeNativeReminders()
      .then(() => !!nativeReady)
      .catch(error => {
        console.error("Native reminders init failed:",
          error && error.message ? error.message : error);
        return false;
      })
      .then(ok => {
        nativeInitPromise = null; // 允许下一次重试
        return ok;
      });
    return nativeInitPromise;
  }

  function queueNativeReminderSync(source) {
    source = source || "default";
    // P2-C-R：权威状态未确认时**不排任何通知**。
    //
    // 启动链在 `failed` 时已经整段跳过，这里是第二道闸：拦住绕过启动链的调用
    // （迟到的异步回调、旁路入口），否则「不排通知」只靠调用顺序成立。
    if (stateAuthority === LOAD_FAILED) {
      nativeSyncMetrics.blockedByAuthority++;
      return;
    }
    nativeSyncMetrics.totalRequests++;
    nativeSyncMetrics.bySource[source] = (nativeSyncMetrics.bySource[source] || 0) + 1;
    if (!NativeReminders.reconcile) return;
    if (!nativeReady) {
      // Q6：桥可能只是晚到 —— 不要丢弃这次请求。
      // 补做初始化；成功后自己会再同步一次（下面的递归调用）。
      ensureNativeReminders().then(ok => { if (ok) queueNativeReminderSync(source); });
      return;
    }
    if (nativeSyncInFlight) {
      nativeSyncPending = true;
      nativeSyncMetrics.deduped++;
      return;
    }
    if (nativeSyncTimer) {
      clearTimeout(nativeSyncTimer);
      nativeSyncMetrics.deduped++;
    }
    nativeSyncTimer = setTimeout(() => {
      nativeSyncTimer = null;
      syncNativeRemindersNow();
    }, 80);
  }

  async function handleNativeNotificationAction(event) {
    if (!event) return;
    // D20：待整理通知点击直达整理会话
    if (event.itemId === "review-session" || event.managedKind === "review-session") {
      // L06 / V0.2 §9.3：动作语义 = 开始整理 / 稍后 30 分钟 / 今天跳过，
      // 通知上的标签与这里执行的效果必须一一对应。
      if (event.action === "review_snooze") {
        snoozeReview(30 * 60 * 1000, "30 分钟");
        return;
      }
      if (event.action === "review_skip") {
        skipReviewThisTime();
        return;
      }
      // review_start / tap / 旧版本动作（ack、done）一律进入会话
      openReviewSession();
      return;
    }
    if (!event.itemId) return;
    const id = event.itemId;
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    // L04 / F5：改状态的动作必须有**可知且匹配**的版本。
    // 版本未知时只允许打开详情 —— 把「未知」当有效匹配会让旧通知覆盖改期后的当前状态。
    if (event.action !== "tap") {
      if (!hasKnownRev(event.itemRev) || Number(it.rev || 0) !== Number(event.itemRev)) {
        toast(event.itemRev == null || event.itemRev === ""
          ? "无法确认这条提醒是否为最新 · 请在应用内处理"
          : "这条提醒已过期 · 未作改动");
        return;
      }
    }
    if (event.action === "ack") {
      hideAlert();
    } else if (event.action === "snooze") {
      hideAlert();
    } else if (event.action === "done") {
      hideAlert();
    } else {
      openDetail(id);
      return;
    }
    const notificationId = event.notification && event.notification.id != null
      ? String(event.notification.id) : "unknown";
    // 通知栏与全屏闹钟共用同一隔离/持久化/事件幂等边界。
    return handleAlarmAction({
      action: event.action,
      itemId: id,
      itemRev: event.itemRev,
      alarmEventId: notificationId === "unknown"
        ? ""
        : "notification:" + notificationId + ":" + event.action + ":" + event.itemRev
    });
  }

  /** L04：同一事件重复投递的短窗口去重（系统重发 / 冷启动重复消费） */
  const recentAlarmActions = Object.create(null);
  const ALARM_ACTION_DEDUP_MS = 5000;

  /**
   * F2：已处理过的原生事件 id（持久化）。
   * 崩溃重放时靠它跳过**已经落库**的操作；与 5 秒内存去重互补 ——
   * 内存去重只防系统重发，事件 id 才防「已提交却被重放」。
   */
  const ALARM_EVENT_LOG_LIMIT = 50;
  /**
   * 单调递增的记账时刻。
   *
   * 事件 id 可能来自原生（数字型字符串），而 JS 对象对「整数型键」会按数值升序排列，
   * 不再保持插入顺序；同时整套动作可能在**同一毫秒**内完成。
   * 若直接按 `Date.now()` 排序裁剪，刚写入的那条可能被排进「最旧」的一批而被立刻删掉 ——
   * 于是崩溃重放保护失效，同一个事件会被处理两次（重复 ACK / 重复派生下一期）。
   */
  let alarmEventClock = 0;
  function alarmEventSeen(id) {
    if (!id) return false;
    const log = state.settings.alarmEventLog;
    return !!(log && typeof log === "object" && log[id]);
  }
  function rememberAlarmEvent(id) {
    if (!id) return;
    if (!state.settings.alarmEventLog || typeof state.settings.alarmEventLog !== "object") {
      state.settings.alarmEventLog = {};
    }
    const log = state.settings.alarmEventLog;
    const stamp = Math.max(Date.now(), alarmEventClock + 1);
    alarmEventClock = stamp;
    log[id] = stamp;
    const keys = Object.keys(log);
    if (keys.length > ALARM_EVENT_LOG_LIMIT) {
      keys.sort((a, b) => log[a] - log[b]);
      keys.slice(0, keys.length - ALARM_EVENT_LOG_LIMIT).forEach(k => { delete log[k]; });
    }
  }

  /* ---------- 原生动作的隔离草稿事务 ---------- */

  function clonePayload(payload) {
    return JSON.parse(JSON.stringify(payload || currentPayload()));
  }

  /** 在一个不可见草稿上同步执行 reducer；JS 单线程保证引用切换不会被其它事件打断。 */
  function withDraftState(draft, job) {
    const live = {
      items: state.items,
      notes: state.notes,
      projects: state.projects,
      settings: state.settings
    };
    state.items = draft.items;
    state.notes = draft.notes;
    state.projects = draft.projects;
    state.settings = draft.settings;
    try {
      return job();
    } finally {
      // reducer 可能用 filter/导入等方式替换数组引用，必须把新引用收回草稿。
      draft.items = state.items;
      draft.notes = state.notes;
      draft.projects = state.projects;
      draft.settings = state.settings;
      state.items = live.items;
      state.notes = live.notes;
      state.projects = live.projects;
      state.settings = live.settings;
    }
  }

  /**
   * 事务成功后才发布草稿。动作只拥有 items 与 alarmEventLog；其它 settings/notes/projects
   * 继续使用可见状态，避免覆盖提交等待期间的无关设置写入。
   */
  function publishActionDraft(draft) {
    const liveById = new Map(state.items.map(item => [item.id, item]));
    state.items = draft.items.map(committed => {
      const live = liveById.get(committed.id);
      if (!live) return committed;
      Object.keys(live).forEach(key => {
        if (!(key in committed)) delete live[key];
      });
      Object.keys(committed).forEach(key => { live[key] = committed[key]; });
      return live;
    });
    state.settings.alarmEventLog = JSON.parse(JSON.stringify(draft.settings.alarmEventLog || {}));
  }

  /**
   * G1：**提交中**的闹钟事件（事件 id → 提交 Promise）。
   *
   * 之前同一个事件被并发消费时，第二个调用看到内存里的「已见过」标记就立刻返回成功，
   * 调用方（原生队列 drain）据此确认删除原生事件 —— 而此时第一次提交还在路上。
   * 提交一旦失败，这条动作就永久丢了。现在改为复用同一个提交 Promise：
   * 只有**真的落库完成**才算处理过，失败则两个调用一起失败、原生事件保留待重试。
   */
  const inflightAlarmActions = new Map();

  /**
   * 全屏闹钟四动作（D11/D12）：ack / snooze / done / close（close 不写 ACK）。
   * L04：终态保护（已完成事项不接受旧动作）+ 版本校验 + 事件去重，
   *      同一条完成事件最多推进一次周期。
   * G1：同一事件并发消费必须落到**同一次提交**上。
   * 返回持久化 Promise：调用方（原生队列的 drain）**必须**等它完成再确认删除事件。
   */
  async function handleAlarmAction(data) {
    const action = data && (data.action || data.actionId);
    const itemId = data && (data.itemId || data.item_id);
    if (!action) return;
    if (action === "close") {
      hideAlert();
      return;
    }
    if (!itemId) return;
    const eventId = data && data.alarmEventId ? String(data.alarmEventId) : "";
    if (eventId) {
      // 顺序有意为之：**先看提交中，再看已落库**。
      // 台账条目是与状态变更同一次写入的，所以在提交落地之前它已经在内存里了；
      // 若先查台账，并发到达的第二个调用会被这个内存标记骗成「已处理过」而立刻返回成功。
      const inflight = inflightAlarmActions.get(eventId);
      if (inflight) return inflight;      // 提交中：复用同一次提交
      if (alarmEventSeen(eventId)) return; // 已落库：幂等重放，直接跳过
    }
    const running = performAlarmAction(data, action, itemId, eventId);
    if (eventId) {
      inflightAlarmActions.set(eventId, running);
      const release = () => {
        if (inflightAlarmActions.get(eventId) === running) inflightAlarmActions.delete(eventId);
      };
      running.then(release, release); // 失败也要释放，否则该事件永远无法重试
    }
    return running;
  }

  /** 整笔原生动作是一个闸门任务；权威提交成功前，草稿不发布到可见 state。 */
  async function performAlarmAction(data, action, itemId, eventId) {
    // 注意：这里**没有**任何先于队列的状态变更 —— 全部在闸门任务内完成
    return runCommit(() => applyAlarmAction(data, action, itemId, eventId));
  }

  async function applyAlarmAction(data, action, itemId, eventId) {
    const it = state.items.find(x => x.id === itemId);
    if (!it) return;
    const terminal = isTerminal(it);
    if (!terminal && (!hasKnownRev(data.itemRev) || Number(it.rev || 0) !== Number(data.itemRev))) {
      toast(data.itemRev == null || data.itemRev === ""
        ? "无法确认这条提醒是否为最新 · 请在应用内处理"
        : "这条提醒已过期 · 未作改动");
      openDetail(itemId);
      return;
    }
    const now = Date.now();
    Object.keys(recentAlarmActions).forEach(k => {
      if (now - recentAlarmActions[k] > ALARM_ACTION_DEDUP_MS) delete recentAlarmActions[k];
    });
    const key = itemId + "|" + action;
    if (recentAlarmActions[key] && now - recentAlarmActions[key] < ALARM_ACTION_DEDUP_MS) {
      return;
    }

    const previousScope = activeActionScope;
    activeActionScope = { itemId: it.id, seriesId: it.seriesId || null };
    try {
    // 草稿从「轮到本动作时的已确认可见状态」复制；动作 reducer 不碰共享 state。
    const draft = clonePayload(currentPayload());
    const prevSave = suppressInnerSave;
    const prevFeedback = suppressUserFeedback;
    const prevApplyingDraft = applyingActionDraft;
    suppressInnerSave = true;
    suppressUserFeedback = true;
    applyingActionDraft = true;
    try {
      withDraftState(draft, () => {
        if (eventId) rememberAlarmEvent(eventId);
        if (terminal) return;
        if (action === "ack") ackItem(itemId, true);
        else if (action === "snooze") snoozeItem(itemId, Date.now() + 2 * 3600000);
        else if (action === "done") completeItem(itemId);
      });
    } finally {
      applyingActionDraft = prevApplyingDraft;
      suppressUserFeedback = prevFeedback;
      suppressInnerSave = prevSave;
      // reducer 内部可能调用 render；在让出事件循环前恢复最后确认状态的 DOM。
      render();
    }

    let userOps = [];
    pendingUserOps = [];
    inflightActionDepth++;
    try {
      // IndexedDB 是唯一权威；提交前不发布草稿，也不按未提交草稿对账原生排程。
      await writeSnapshot(draft, { deferNativeSync: true });
    } catch (error) {
      delete recentAlarmActions[key];
      throw error;
    } finally {
      inflightActionDepth--;
      userOps = pendingUserOps;
      pendingUserOps = [];
    }

    // 提交等待期间的命令原先作用在最后确认状态上；现在按原顺序重放到已提交草稿。
    // 重放失败不是可忽略分支：用可见状态做补偿写并向外报错，原生事件不提前确认。
    try {
      withDraftState(draft, () => replayUserOps(userOps));
    } catch (replayError) {
      try {
        await writeSnapshot(currentPayload(), { deferNativeSync: true });
      } catch (compensationError) {
        replayError.compensationError = compensationError;
      }
      delete recentAlarmActions[key];
      throw replayError;
    }

    publishActionDraft(draft);
    recentAlarmActions[key] = now;
    queueNativeReminderSync();
    render();
    if (terminal) toast("该事项已完成 · 本次提醒已忽略");
    else if (action === "ack") toast("已确认看到 · 仍保持未完成");
    else if (action === "snooze") {
      const committed = state.items.find(x => x.id === itemId);
      toast(committed ? "已改到 " + fmtTime(committed.triggerAt) : "提醒操作已保存 · 后续删除也已保留");
    }
    else if (action === "done") toast(it.repeat ? "已完成 · 下一周期已生成" : "已完成并归档");
    return true;
    } finally {
      activeActionScope = previousScope;
    }
  }

  function systemBridge() {
    if (NativeReminders.systemBridge) return NativeReminders.systemBridge();
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBridge
      ? window.Capacitor.Plugins.SystemBridge
      : null;
  }

  /**
   * Q6：当前跑在安卓原生容器里（**不看插件是否已注册**）。
   *
   * 修的是既有缺陷：本函数此前被 3 处调用（精确闹钟 / 通知设置 / 电池优化三个跳转入口）
   * 却**从未定义** —— 点下去直接 ReferenceError，而被点到的只是设置跳转，
   * 现场看起来就是「点了没反应」。判断只看平台，恰好就是那三处需要的语义。
   */
  function isNativeAndroidRuntime() {
    const cap = window.Capacitor;
    if (!cap) return false;
    const platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : cap.platform;
    return platform === "android";
  }

  /**
   * Q6：等原生桥就绪，最多等 timeoutMs。
   *
   * index.html **不加载 capacitor.js** —— window.Capacitor 完全由原生 WebView 注入，
   * 注入完成的时刻不由我们控制。init() 若跑在注入之前，isNativeAndroid() 会返回 false，
   * 而 initializeNativeReminders 开头那句 `if (!isNativeAndroid()) return` 是**静默**的：
   * nativeReady 永远为 false，queueNativeReminderSync 的守卫随即让整场会话一次对账都不跑。
   * 表现就是「打开 App 有应用内提醒（tick 不依赖原生），关掉后一条排程都没有」。
   */
  function waitForNativeBridge(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 3000);
    return new Promise(resolve => {
      (function check() {
        if (NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid()) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(check, 50);
      })();
    });
  }

  function appSettingsPlugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppSettings
      ? window.Capacitor.Plugins.AppSettings
      : null;
  }

  /* ---------- 诊断能力：唯一来源 lib/app-diagnostics.js（P2-D 已迁出） ----------
   *
   * 通知实验室渲染、投递判读、闹钟 trace、测试闹钟动作与系统设置导航的
   * **唯一实现在 `lib/app-diagnostics.js`**（由 `bindRuntime()` 里那一处
   * `createAppDiagnostics` 装配绑定）。下面这些只是**转发到同一实例**的薄壳：
   * core 仍要调用它们（setup 流程、「我的」页设置入口、首页告知条、hook），
   * 但不再保留第二份算法体。
   *
   * setup / review 控件的绑定拆到 `bindSetupReviewControls()` —— 不随诊断模块搬走。
   * 对应测试：`test-boot-combination.js` 的「抽掉 lib/app-diagnostics.js」反例、
   * 空壳实例反例与 `APP_DIAGNOSTICS_INSTANCE_CONTRACT` 双向闭合；
   * `describeAlarmDelivery` 行为断言走 `test-smoke.js`（经 hook 转发同一实例）。
   */

  function refreshNotifyLab() {
    return diagnostics ? diagnostics.refreshNotifyLab() : Promise.resolve(null);
  }

  function labLog(msg) {
    if (diagnostics) diagnostics.labLog(msg);
  }

  function labCancelAlarms(opts) {
    if (!diagnostics) return Promise.resolve({ ok: false, error: "diagnostics missing" });
    return diagnostics.labCancelAlarms(opts);
  }

  function describeAlarmDelivery(d) {
    if (!diagnostics) return { text: "还没有投递记录", label: "—", ok: false, warn: true };
    return diagnostics.describeAlarmDelivery(d);
  }

  function openSystemSetting(kind) {
    if (!diagnostics) return Promise.resolve(false);
    return diagnostics.openSystemSetting(kind);
  }

  function openBackgroundGuide(kind) {
    if (!diagnostics) return Promise.resolve(false);
    return diagnostics.openBackgroundGuide(kind);
  }

  /**
   * setup / review 控件绑定（P2-D 从原 `bindNotifyLab()` 拆出，**留在 core**）。
   * 诊断按钮与 visibilitychange 已迁到 `diagnostics.bind()`；此处每项仍只绑一次。
   */
  function bindSetupReviewControls() {
    if (appSetup) appSetup.bind();

    // P0-3：reviewSnooze / reviewSkip 不再在此绑定 —— 它们随 renderReviewCard() 重建，改由渲染处逐次挂载

    $$("[data-snooze-review]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.snoozeReview;
        let ms = 7200000;
        let label = "2 小时后";
        if (v === "1800000") { ms = 1800000; label = "30 分钟后"; }
        else if (v === "7200000") { ms = 7200000; label = "2 小时后"; }
        else if (v === "tonight") {
          const d = new Date();
          d.setHours(22, 30, 0, 0);
          if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
          ms = d.getTime() - Date.now();
          label = "今晚稍后";
        } else if (v === "tomorrow") {
          const d = new Date();
          d.setDate(d.getDate() + 1);
          d.setHours(ensureReviewSettings().hour || 21, ensureReviewSettings().minute || 30, 0, 0);
          ms = d.getTime() - Date.now();
          label = "明天";
        } else if (v === "next") {
          ms = nextReviewWindowStart() - Date.now();
          label = "下一个整理时间";
        }
        if (ms < 60000) ms = 60000;
        closeSheet("sheetReviewSnooze");
        snoozeReview(ms, label);
      });
    });

    const btnReviewSettings = $("#btnReviewSettings");
    if (btnReviewSettings) {
      btnReviewSettings.addEventListener("click", () => {
        const rs = ensureReviewSettings();
        const sw = $("#swReviewEnabled");
        if (sw) sw.classList.toggle("on", !!rs.enabled);
        const start = $("#reviewStart");
        const end = $("#reviewEnd");
        if (start) start.value = pad2(rs.hour || 21) + ":" + pad2(rs.minute || 30);
        if (end) end.value = pad2(rs.windowEndHour != null ? rs.windowEndHour : 23) + ":" + pad2(rs.windowEndMinute || 0);
        openSheet("sheetReviewSchedule");
      });
    }
    const swReviewEnabled = $("#swReviewEnabled");
    if (swReviewEnabled) {
      swReviewEnabled.addEventListener("click", () => {
        swReviewEnabled.classList.toggle("on");
      });
    }
    const btnSaveReviewSchedule = $("#btnSaveReviewSchedule");
    if (btnSaveReviewSchedule) {
      btnSaveReviewSchedule.addEventListener("click", () => {
        const rs = ensureReviewSettings();
        rs.enabled = $("#swReviewEnabled") ? $("#swReviewEnabled").classList.contains("on") : true;
        const start = ($("#reviewStart") && $("#reviewStart").value) || "21:30";
        const end = ($("#reviewEnd") && $("#reviewEnd").value) || "23:00";
        const sm = start.match(/^(\d{1,2}):(\d{2})$/);
        const em = end.match(/^(\d{1,2}):(\d{2})$/);
        if (sm) { rs.hour = parseInt(sm[1], 10); rs.minute = parseInt(sm[2], 10); }
        if (em) { rs.windowEndHour = parseInt(em[1], 10); rs.windowEndMinute = parseInt(em[2], 10); }
        rs.lastSessionKey = "";
        rs.followupCount = 0;
        rs.snoozedUntil = 0;
        rs.skippedUntil = 0;
        save();
        closeSheet("sheetReviewSchedule");
        renderMe();
        scheduleNextReviewAlarm();
        toast("待整理时间已保存");
      });
    }
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function renderUpcomingRow(it) {
    const d = new Date(it.triggerAt);
    const day = dayLabel(it.triggerAt);
    const time = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    const pills = [];
    if (it.priority === "important") pills.push('<span class="pill warn">☆ 重要</span>');
    if (it.priority === "critical") pills.push('<span class="pill crit">🚨 关键</span>');
    if (it.deadlineAt) pills.push('<span class="pill warn">有截止</span>');
    if (it.repeat && it.repeat.every) pills.push('<span class="pill future">周期</span>');
    return '<div class="upcoming-item" data-act="edit" data-id="' + escapeAttr(it.id) + '">' +
      '<div class="upcoming-when"><b>' + escapeHtml(time) + "</b>" + escapeHtml(day) + "</div>" +
      '<div class="upcoming-body">' +
      '<div class="upcoming-title">' + escapeHtml(it.title || "未命名事项") + "</div>" +
      '<div class="upcoming-meta">' + pills.join("") +
      '<span class="pill future">' + escapeHtml(relDue(it.triggerAt)) + "</span>" +
      "</div></div></div>";
  }

  // D5：首页「即将到来」区块已删除（未来只在「未来」页查看）

  /* ---------- UX-T03：原生送达证据的回读 ---------- */

  /**
   * 证据通道的可用性。
   *
   * 三态：`null` = 还不知道（还没读过 / 桥不支持）；`true` = 读成功；`false` = 读失败。
   * 判定层必须把 null/false 都当成**读不到**，而不是「没有证据就是漏了」——
   * 这正是 D70 前置核验里那条近 100% 误报的来源。
   */
  const deliveryEvidenceState = { readable: null, lastReadAt: 0, rows: 0, reason: "", retention: null };
  let deliveryEvidenceInFlight = false;

  function deliveryEvidenceReadable() {
    return deliveryEvidenceState.readable;
  }

  /**
   * 读一次原生**持久**证据并幂等合并。
   *
   * 为什么冷启动与回前台都要读：只挂 JS 运行期监听的话，
   * 「关掉 App 期间响过的那一次」永远没有证据 —— 而它在原生侧其实是有记录的
   * （`ActiveAlarmStore` 在真实送达时落盘）。诊断环形日志不能当证据源：它只有 150 条，
   * 会被高频事件挤掉。
   */
  async function readDeliveryEvidence(source) {
    if (deliveryEvidenceInFlight) return false;
    if (!NativeReminders.getDeliveryEvidence) {
      deliveryEvidenceState.readable = false;
      deliveryEvidenceState.reason = "module-unsupported";
      return false;
    }
    deliveryEvidenceInFlight = true;
    try {
      if (!nativeReady) {
        const ok = await ensureNativeReminders();
        if (!ok) {
          deliveryEvidenceState.readable = false;
          deliveryEvidenceState.reason = "bridge-not-ready";
          return false;
        }
      }
      const res = await NativeReminders.getDeliveryEvidence({ since: 0 });
      deliveryEvidenceState.readable = !!(res && res.available);
      deliveryEvidenceState.reason = (res && res.reason) || "";
      deliveryEvidenceState.retention = (res && res.retention) || null;
      deliveryEvidenceState.lastReadAt = Date.now();
      if (!res || !res.available) return false;
      deliveryEvidenceState.rows = Array.isArray(res.rows) ? res.rows.length : 0;
      return applyNativeDeliveryEvidence(res.rows);
    } catch (error) {
      deliveryEvidenceState.readable = false;
      deliveryEvidenceState.reason = error && error.message ? error.message : String(error);
      return false;
    } finally {
      deliveryEvidenceInFlight = false;
    }
  }

  /**
   * 参数自足的合并写入：事项由参数给定（重放时按 id 重新解析），因此可以进命令日志。
   * 不在这里 `save()` —— 出口统一提交一次。
   */
  function mergeEvidenceInto(it, evidences, at) {
    if (!it || !EvidenceLib) return false;
    const res = EvidenceLib.mergeEvidence([it], evidences, at);
    return res.changed === true;
  }

  /**
   * 把一批原生回执并进事项台账。
   *
   * 独立验收 F04：这里以前**直接写 `state.items`** —— 统一事务之外的第三个旁路。
   * 原生动作提交在途时，合并结果会被随后发布的权威草稿覆盖（界面显示已接收，
   * 提交结束后又变回 scheduled）。现在按事项逐条走 `runUserOp` 的命令日志，
   * 于是它在窗口期内既不会丢，也不会覆盖别人。
   */
  function applyNativeDeliveryEvidence(rows) {
    if (!EvidenceLib || !Array.isArray(rows) || !rows.length) return false;
    const normalized = EvidenceLib.normalizeEvidence(rows, "native");
    const byItem = new Map();
    normalized.forEach(ev => {
      if (!ev || ev.valid !== true || !ev.itemId) return;
      if (!byItem.has(ev.itemId)) byItem.set(ev.itemId, []);
      byItem.get(ev.itemId).push(ev);
    });
    if (!byItem.size) return false;
    const at = Date.now();
    let changed = false;
    // O4：调用内索引一次，替代「每个有证据的事项各扫一遍 state.items」。
    // `mergeEvidenceInto` 只写事项自己的证据字段，不改动 state.items 成员，索引全程有效。
    const byId = indexItemsById(state.items);
    byItem.forEach((evidences, itemId) => {
      const it = byId.get(itemId);
      if (!it) return;
      if (runUserOp(mergeEvidenceInto, [it, evidences, at], {
        userFacing: false,
        itemArg: 0,
        name: "mergeDeliveryEvidence"
      }) === true) changed = true;
    });
    if (!changed) return false;
    save();
    return true;
  }

  /** UX-T03：通知通道的**实时**送达回调（进程活着时）；冷启动那批走 readDeliveryEvidence。 */
  function applyReminderDelivered(ev) {
    if (!ev) return false;
    return applyNativeDeliveryEvidence([{
      itemId: ev.itemId,
      reminderKey: ev.reminderKey,
      itemRev: ev.itemRev,
      carrier: ev.carrier || "notification",
      receivedAt: ev.receivedAt || Date.now()
    }]);
  }

  /**
   * UX-T03：详情页的「提醒结果」一行。
   *
   * 展示纪律：
   *  · 只有**已到点且拿到证据**才说结论，且只说到「系统已接收」这一层；
   *  · 缺证据一律「本次提醒结果尚未确认」，绝不说「确定漏提醒」；
   *  · 本版本没登记过排程的（旧数据 / 未覆盖载体）直接说明无法核查。
   */
  function detailReminderStatusRow(it) {
    if (!EvidenceLib) return "";
    const st = EvidenceLib.evidenceStatusFor(it, {
      now: Date.now(),
      evidenceReadable: deliveryEvidenceReadable(),
      observable: itemScheduleEvidence(it) !== null
    });
    const suffix = st.state === "delivered" ? "（只代表系统收到了这次提醒）" : "";
    return '<div class="detail-row"><dt>提醒结果</dt><dd>' +
      escapeHtml(st.text) + escapeHtml(suffix) + "</dd></div>";
  }

  async function initializeNativeReminders() {
    // 非安卓容器（浏览器 / PWA）：原生能力本就不适用，直接返回。
    // 绝不能走下面的「桥未就绪」分支 —— 否则 Web 版会看到一句吓人的误报。
    if (!isNativeAndroidRuntime()) return;
    if (!NativeReminders.isNativeAndroid || !NativeReminders.isNativeAndroid()) {
      // Q6：这里以前是一句**静默 return** —— 整条原生链路就此消失，而界面毫无异样
      // （按钮照常可点、应用内提醒照常弹），现象因此只能被描述成「关掉 App 就不响」。
      // 现在：等桥就绪（注入时机不受我们控制，实测有数秒级时间差）；
      // 确实等不到就留下一条界面上看得见的失败记录，而且之后仍可重试。
      const bridged = await waitForNativeBridge(10000);
      if (!bridged) {
        setNativeReminderStatus({
          native: false,
          notifications: "unavailable",
          exactAlarm: "unavailable",
          reliability: "error",
          bridgeNotReady: true
        });
        return;
      }
    }
    try {
      const status = await NativeReminders.initialize({
        onAction: handleNativeNotificationAction,
        // F1：系统确实送达时的回调，用于记录真实送达而不是靠时刻推断
        onDelivered: markDeadlineDelivered,
        // UX-T03：**普通提醒**（primary / realert）的送达回调。此前只认截止事件，
        // 于是「已响过的提醒也停在 scheduled」成了系统性事实。
        onReminderDelivered: applyReminderDelivered,
        onStatusChange: setNativeReminderStatus,
        onResume: async () => {
          try {
            if (NativeReminders.getPermissionState) {
              const status = await NativeReminders.getPermissionState();
              setNativeReminderStatus(status);
              // R1：系统权限状态与「用户主动开关」是两件事。
              // 恢复前台只刷新能力信息，绝不替用户把他亲手关掉的通知开关再打开 ——
              // 否则「关闭通知」这个动作会在下一次切回应用时被静默撤销。
              renderMe();
            }
          } catch (error) {}
          // 消费全屏闹钟动作（V09：排空队列，处理成功并落库后才确认删除）
          try {
            if (NativeReminders.drainAlarmActions) {
              await NativeReminders.drainAlarmActions(handleAlarmAction);
            }
          } catch (error) {}
          // UX-T03：回前台时补读一次原生持久证据（关掉 App 期间响过的那批只能这样拿到）
          try { await readDeliveryEvidence("resume"); } catch (error) {}
          refreshNativeScheduleBasis();
          await refreshActiveAlarmPanel(true);
          promoteDue();
          queueNativeReminderSync();
        }
      });
      nativeReady = true;
      setNativeReminderStatus(status);
      await refreshActiveAlarmPanel(true);
      refreshNativeScheduleBasis();
      await syncNativeRemindersNow({ forceRebuild: true });
      // UX-T03：冷启动也补读一次 —— 这是「次日重开仍能关联」的那条路
      try { await readDeliveryEvidence("init"); } catch (error) {}
    } catch (error) {
      nativeReady = true;
      setNativeReminderStatus({
        native: true,
        reliability: "error",
        error: error && error.message ? error.message : String(error)
      });
    }
  }

  /* ---------- P2-E：首次提醒设置与 60 秒测试由 AppSetup 唯一实现 ---------- */
  function maybePromptAndroidNotify() { if (appSetup) return appSetup.maybePromptAndroidNotify(); }
  function noteFirstRemindSaved(it) { if (appSetup) return appSetup.noteFirstRemindSaved(it); }
  function renderSetupEntry() { if (appSetup) return appSetup.renderSetupEntry(); }
  function updateSetupEntry() { if (appSetup) return appSetup.updateSetupEntry(); }
  function openSetupSheet() { if (appSetup) return appSetup.openSetupSheet(); }
  function startSetupTestRun() { return appSetup ? appSetup.startSetupTestRun() : Promise.resolve(false); }
  function stopSetupTestRun() { return appSetup ? appSetup.stopSetupTestRun() : Promise.resolve(0); }
  function setupEvidenceHtml() { return appSetup ? appSetup.setupEvidenceHtml() : Promise.resolve(""); }
  function setupStepsContext() { return appSetup ? appSetup.setupStepsContext() : {}; }
  function renderSetupSheetBody() { if (appSetup) return appSetup.renderSetupSheetBody(); }
  function runSetupStep(stepId) { return appSetup ? appSetup.runSetupStep(stepId) : Promise.resolve(); }

  function shouldSkipAlert(it) {
    const until = it.dismissedUntil || 0;
    if (until > Date.now()) return true;
    const at = dismissedAlerts[it.id];
    if (!at) return false;
    return Date.now() - at < 30 * 60 * 1000;
  }

  function showSystemNotification(opts) {
    if (!state.settings.notify) return;
    if (NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid()) return;
    // 用真值判断而非 `in`：属性存在但为 undefined 时（部分壳/旧浏览器）会直接抛错，
    // 而本函数在 tick → showAlert 的主链路上，抛错会打断整轮提醒。
    const N = typeof window !== "undefined" ? window.Notification : null;
    if (!N || N.permission !== "granted") return;
    const privacy = !!state.settings.privacyNotify;
    const payload = {
      title: privacy ? "安心收件箱提醒" : (opts.title || "安心收件箱提醒"),
      body: privacy ? "有一条事项需要你确认" : (opts.body || ""),
      tag: opts.tag || "attention",
      requireInteraction: !!opts.requireInteraction,
      data: opts.data || {},
      actions: opts.actions || []
    };
    // Prefer SW (supports actions on many browsers)
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "SHOW_NOTIFICATION",
        notification: payload
      });
      return;
    }
    try {
      new Notification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        requireInteraction: payload.requireInteraction,
        data: payload.data
      });
    } catch (e) {}
  }

  let alertAutoHideTimer = null;

  function showAlert(it) {
    alertItem = it;
    $("#alertTitle").textContent =
      it.priority === "critical" ? "🚨 关键提醒" :
      it.priority === "important" ? "☆ 重要提醒" : "提醒";
    $("#alertBody").textContent = it.title + (it.note ? " · " + it.note : "");
    const b = $("#alertBanner");
    b.classList.toggle("crit", it.priority === "critical");
    b.classList.add("show");
    // D14：挂 10 分钟自动收起（纯展示，不记账、不消耗提醒预算）
    if (alertAutoHideTimer) clearTimeout(alertAutoHideTimer);
    alertAutoHideTimer = setTimeout(() => {
      if (alertItem && alertItem.id === it.id) {
        hideAlert();
      }
    }, 10 * 60 * 1000);
    showSystemNotification({
      title: it.priority === "critical" ? "🚨 关键事项" :
             it.priority === "important" ? "☆ 重要事项" : "安心收件箱提醒",
      body: it.title,
      tag: "item-" + it.id,
      requireInteraction: it.priority !== "normal",
      data: { itemId: it.id },
      actions: [
        { action: "ack", title: "我知道了" },
        { action: "snooze", title: "稍后 2 小时" },
        { action: "done", title: "完成" }
      ]
    });
    if (navigator.vibrate && it.priority !== "normal") {
      try {
        navigator.vibrate(it.priority === "critical" ? [80, 40, 80, 40, 120] : [60, 40, 60]);
      } catch (e) {}
    }
    updateAppBadge();
  }

  function hideAlert() {
    if (alertAutoHideTimer) {
      clearTimeout(alertAutoHideTimer);
      alertAutoHideTimer = null;
    }
    $("#alertBanner").classList.remove("show");
    alertItem = null;
  }

  /** D13：只有点 × 才算关闭（消耗 30 分钟抑制） */
  function dismissAlert() {
    if (alertItem) {
      const now = Date.now();
      const applied = runUserOp(
        applyAlertDismissal,
        [alertItem.id, now + 30 * 60 * 1000],
        { userFacing: true, itemArg: 0, name: "dismissAlert" }
      );
      if (applied === false) return false;
      dismissedAlerts[alertItem.id] = now;
      save();
    }
    hideAlert();
    toast("已关闭提醒 · 事项仍在首页");
    return true;
  }

  function applyAlertDismissal(itemId, until) {
    const item = state.items.find(x => x.id === itemId);
    if (!item) return false;
    item.dismissedUntil = until;
    bumpRev(item);
    return true;
  }

  function tick() {
    promoteDue();
    maybeReviewSession();
    const now = Date.now();
    const candidates = state.items.filter(it => {
      if (it.status !== "due") return false;
      if (shouldSkipAlert(it)) return false;
      if (!it.lastAlertShownAt) return true;
      return Lib.shouldRealert(it, now, {
        importantRepeat: state.settings.importantRepeat !== false,
        dismissedAt: dismissedAlerts[it.id] || null
      });
    });
    if (!alertItem && candidates.length) {
      candidates.sort((a, b) => {
        const pr = priorityRank(a.priority) - priorityRank(b.priority);
        if (pr !== 0) return pr;
        return (a.triggerAt || 0) - (b.triggerAt || 0);
      });
      const next = candidates[0];
      if (next.lastAlertShownAt) Lib.markReminded(next, now);
      next.lastAlertShownAt = now;
      save();
      showAlert(next);
    }
    if (state.ui.tab === "home") renderHome();
    else if (state.ui.tab === "me") renderStats();
  }

  /* ---------- 数据备份：唯一来源 lib/app-backup.js（P2-C 已整体迁出） ---------- */

  /**
   * 导出（原生 saveDocument / Web 分享 / `<a download>` 三条通路）、导入覆盖、
   * 以及原生导出「结果未返回」的宽限闸门 —— **唯一实现在 `lib/app-backup.js`**
   * （由 `bindRuntime()` 里那一处 `createAppBackup` 装配绑定）。
   *
   * 这里刻意**不留实现体、也不留转发壳**：调用点一律写 `backup.xxx()`；
   * `backup == null`（装配失败）时应用停在失败面板上，根本走不到这些按钮。
   *
   * 导入覆盖用的持久化命令由装配注入（`backupRuntimeDeps().save`）—— 与表单/
   * 撤销走**同一条**持久化边界，不存在第二条写库路径。
   *
   * 已知缺口（逐字保留，未修复）：Web 回退通路的 `<a download>` 在 Android 上
   * 没有落地出口（「导出没有落地出口」待裁决 E1–E4）—— 修它属产品决策，先过裁决。
   *
   * 对应测试：`test-boot-combination.js` 的「抽掉 lib/app-backup.js」反例、
   * 空壳实例反例与 `APP_BACKUP_INSTANCE_CONTRACT` 双向闭合；
   * 导出三通路/宽限闸门/密钥排除的行为断言走 `test-smoke.js`。
   */

  /* ---------- seed ---------- */
  /* ---------- UX-C01：演示是只读预览，不是「载入示例数据」 ---------- */

  /**
   * 演示内容（固定模板，与用户数据无关）。
   *
   * 刻意不叫「示例数据」：它不会进入 `state.items/notes/projects`，
   * 不会被排程，也不会出现在统计里 —— 演示一旦能覆盖用户状态，
   * 它就从「帮助理解」变成了「数据风险」。
   */
  function demoPreviewRows() {
    return [
      { title: "看看 Horolog 的调度设计", when: "本周六 10:00", tag: "普通 · 阅读", note: "写一句话就行，到点我会把这条推到你面前。" },
      { title: "报名截止，提前确认材料", when: "明天 09:00 · 截止还有 5 天", tag: "重要 · 有截止", note: "标为「重要」或「关键」的事项用闹钟提醒：声音更大，锁屏时会亮屏。" },
      { title: "交房租", when: "每月 1 日 09:00", tag: "每 1 个月 · 按日历", note: "周期事项点「完成」后会自动生成下一期。" },
      { title: "给爸妈打电话", when: "下周六 10:00", tag: "每两周 · 从我点过「我知道了」重新计时", note: "周期有两种计时方式；选错会让你以为它忘了提醒。" },
      { title: "有空看看这个项目", when: "还没定时间", tag: "会先收下 · 待整理", note: "没写时间的记录不会被拒绝，也不会冒充已经安排好了提醒。" }
    ];
  }

  function openDemoPreview() {
    const host = $("#demoBody");
    if (host) {
      host.innerHTML =
        '<p class="demo-note">这是只读预览：不会写入你的数据，也不会安排任何提醒。</p>' +
        demoPreviewRows().map(r =>
          '<div class="demo-item">' +
          '<div class="demo-title">' + escapeHtml(r.title) + "</div>" +
          '<div class="demo-when">' + escapeHtml(r.when) + " · " + escapeHtml(r.tag) + "</div>" +
          '<p style="font-size:0.82rem;color:var(--muted);margin-top:6px;line-height:1.5">' + escapeHtml(r.note) + "</p>" +
          "</div>").join("");
    }
    openSheet("sheetDemo");
  }

  function seed() {
    if (inflightActionDepth > 0) {
      toast("提醒操作正在保存 · 请稍后再载入示例数据");
      return false;
    }
    const now = new Date();
    state.projects = [
      { id: "p_work", name: "工作", color: "#1b6b4a" },
      { id: "p_read", name: "阅读", color: "#3d5a80" },
      { id: "p_life", name: "生活", color: "#9a6b12" }
    ];
    state.items = [
      makeItem({
        title: "看看 Horolog 的调度设计",
        note: "GitHub 上那个开源调度库，重点看它的 cron 与重试策略",
        tags: ["阅读", "工程"],
        url: "https://github.com/search?q=horolog",
        projectId: "p_read",
        priority: "normal",
        status: "due",
        triggerAt: Date.now() - 5 * 60000
      }),
      makeItem({
        title: "报名截止，提前确认材料",
        note: "需要成绩单扫描件 + 证件照",
        tags: ["行政"],
        projectId: "p_work",
        priority: "important",
        status: "waiting",
        triggerAt: applyClock(addDays(now, 1), Date.now()),
        deadlineAt: endOfDay(addDays(now, 5)).getTime()
      }),
      makeItem({
        title: "交房租",
        projectId: "p_life",
        priority: "normal",
        status: "waiting",
        triggerAt: applyClock(addDays(now, 3), Date.now()),
        repeat: { mode: "calendar", every: "month" }
      }),
      makeItem({
        title: "给爸妈打电话",
        projectId: "p_life",
        priority: "important",
        status: "waiting",
        triggerAt: nextWeekend(now),
        repeat: { mode: "ack", every: "biweek" }
      }),
      makeItem({
        title: "看看那篇注意力管理文章",
        note: "分享进来的，周末有空再读",
        tags: ["阅读"],
        url: "https://example.com/attention",
        projectId: "p_read",
        priority: "normal",
        status: "waiting",
        triggerAt: nextWeekend(now)
      }),
      makeItem({
        title: "续费域名",
        note: "已经确认过了，还没操作",
        projectId: "p_work",
        priority: "normal",
        status: "acknowledged",
        triggerAt: Date.now() - 86400000,
        acknowledgedAt: Date.now() - 3600000
      }),
      makeItem({
        title: "买猫粮",
        projectId: "p_life",
        priority: "normal",
        status: "archived",
        triggerAt: Date.now() - 7200000,
        completedAt: Date.now() - 3600000
      })
    ];
    state.notes = [
      {
        id: uid(),
        title: "注意力原则",
        body: "## 核心原则\n\n- Acknowledge ≠ Complete\n- Future 默认不占据首页\n- 通知送达 ≠ 用户看到\n\n> 放心忘记，而不是帮记住更多事情。",
        pinned: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: uid(),
        title: "周末阅读清单",
        body: "1. Horolog 调度设计\n2. 本地优先架构文章\n3. RFC 5545 重复规则\n\n`本地优先` = 无网也能完成核心流程。",
        projectId: "p_read",
        createdAt: Date.now(),
        updatedAt: Date.now() - 86400000
      }
    ];
    state.settings = Object.assign(state.settings, { notify: false, dnd: true, importantRepeat: true });
    save();
    state.ui.tab = "home";
    render();
    toast("示例数据已载入");
  }

  /* ---------- share / deep link ---------- */
  function applyShareParams() {
    const params = new URLSearchParams(location.search);
    const text = params.get("text") || params.get("title") || "";
    const url = params.get("url") || params.get("link") || "";
    const body = params.get("body") || "";
    if (!text && !url && !body) return false;
    const title = text || (url ? url : body.slice(0, 40));
    openCapture({
      title,
      url: url || (/^https?:\/\//.test(body) ? body : ""),
      note: body && body !== url ? body : ""
    });
    // clean query so refresh doesn't reopen
    try {
      history.replaceState(null, "", location.pathname);
    } catch (e) {}
    return true;
  }

  /* ---------- events ---------- */
  function bind() {
    // 诊断面板（按钮 + visibilitychange）由实例幂等绑定；setup/review 留在 core。
    if (diagnostics) diagnostics.bind();
    if (appContent) appContent.bind();
    bindSetupReviewControls();
    $$(".nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        state.ui.tab = btn.dataset.tab;
        render();
      });
    });

    $("#fab").addEventListener("click", () => openCapture());

    $("#backdrop").addEventListener("click", closeAllSheets);
    $$("[data-close]").forEach(b => {
      b.addEventListener("click", () => closeSheet(b.dataset.close));
    });

    let parseTimer = null;
    $("#capText").addEventListener("input", () => {
      clearTimeout(parseTimer);
      parseTimer = setTimeout(updateParseHint, 120);
    });
    $$("#capPriority .chip").forEach(c => {
      c.addEventListener("click", () => {
        $$("#capPriority .chip").forEach(x => x.classList.remove("on"));
        c.classList.add("on");
        renderCaptureSummary();
      });
    });
    $("#btnSaveItem").addEventListener("click", saveItemFromForm);
    $("#capText").addEventListener("keydown", e => {
      if (e.key === "Enter") saveItemFromForm();
    });
    $("#capText").addEventListener("blur", () => {
      renderSimilarHint($("#capText").value.trim());
    });
    $("#capText").addEventListener("input", () => {
      clearTimeout(similarTimer);
      similarTimer = setTimeout(() => renderSimilarHint($("#capText").value.trim()), 400);
    });
    $("#capRepeat").addEventListener("change", () => { updateRepeatPreview(); renderCaptureSummary(); });
    $("#capRepeatMode").addEventListener("change", () => { updateRepeatPreview(); renderCaptureSummary(); });
    $("#capNth").addEventListener("change", () => { updateRepeatPreview(); renderCaptureSummary(); });
    $("#capWeekday").addEventListener("change", () => { updateRepeatPreview(); renderCaptureSummary(); });
    $("#capTrigger").addEventListener("change", () => {
      // L01：只有用户真的动过这个字段，才算「明确选择的时间」
      triggerUserPicked = true;
      updateRepeatPreview();
      renderCaptureSummary();
    });
    // UX-C02：清除手选时间后摘要必须同步更新（否则摘要会一直显示一个已经作废的时间）
    $("#capTrigger").addEventListener("input", () => {
      triggerUserPicked = true;
      renderCaptureSummary();
    });
    $("#capDeadline").addEventListener("change", renderCaptureSummary);
    $("#capDeadline").addEventListener("input", renderCaptureSummary);
    // UX-C02：「更多选项」默认收起，编辑复杂事项时才自动展开
    $("#btnCapMore").addEventListener("click", () => {
      const adv = $("#capAdvanced");
      const el = $("#btnCapMore");
      if (!adv || !el) return;
      const open = adv.hidden;
      adv.hidden = !open;
      el.textContent = open ? "收起更多选项" : "更多选项";
      el.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", e => {
      const sim = e.target.closest("[data-open-similar]");
      if (sim) {
        openDetail(sim.dataset.openSimilar);
        return;
      }
    }, true);

    // low confidence
    $$("#lowConfChips .chip").forEach(c => {
      c.addEventListener("click", () => {
        const now = new Date();
        if (c.dataset.days) {
          setLowConfPick(Date.now() + parseInt(c.dataset.days, 10) * 86400000, c);
        } else if (c.dataset.preset === "weekend") {
          setLowConfPick(nextWeekend(now), c);
        }
      });
    });
    $("#lowConfCustom").addEventListener("change", () => {
      const ts = parseLocalInput($("#lowConfCustom").value);
      if (ts) setLowConfPick(ts, null);
    });
    $("#btnLowConfOk").addEventListener("click", () => {
      const ts = state.ui.pendingLowConf || parseLocalInput($("#lowConfCustom").value);
      if (ts) $("#capTrigger").value = toLocalInput(ts);
      closeSheet("sheetLowConf");
      finishSaveAfterLowConf(ts);
    });

    document.addEventListener("click", async (e) => {
      const actBtn = e.target.closest("[data-act]");
      if (actBtn) {
        const id = actBtn.dataset.id;
        const act = actBtn.dataset.act;
        if (act === "ack") {
          if (ackItem(id) !== false) { closeSheet("sheetDetail"); hideAlert(); }
        }
        else if (act === "done") {
          if (completeItem(id) !== false) { closeSheet("sheetDetail"); hideAlert(); }
        }
        else if (act === "snooze") {
          openSnoozeSheet(id);
        }
        else if (act === "reopen") { if (reopenItem(id) !== false) closeSheet("sheetDetail"); }
        else if (act === "delete") {
          const okDel = await confirmDialog("确定删除这条事项？", "删除");
          if (okDel) {
            if (deleteItem(id) !== false) {
              closeSheet("sheetDetail");
              hideAlert();
            }
          }
        }
        else if (act === "restore") { if (restoreItem(id) !== false) closeSheet("sheetDetail"); }
        // L03：停止重复（保留当前这条，只结束规则）
        else if (act === "stopRepeat") { if (stopRepeat(id) !== false) closeSheet("sheetDetail"); }
        // D23：显式恢复被暂停的截止保护
        else if (act === "resumeDeadline") { if (resumeDeadlineProtection(id) !== false) closeSheet("sheetDetail"); }
        else if (act === "open") openDetail(id);
        else if (act === "edit") openEditItem(id);
        return;
      }

      const calNav = e.target.closest("[data-cal]");
      if (calNav) {
        const kind = calNav.dataset.cal;
        const cur = state.ui.calMonth ? new Date(state.ui.calMonth) : new Date();
        if (kind === "prev") cur.setMonth(cur.getMonth() - 1);
        else if (kind === "next") cur.setMonth(cur.getMonth() + 1);
        else {
          const t = new Date();
          state.ui.calMonth = t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-01";
          state.ui.calSelected = null;
          renderFuture();
          return;
        }
        state.ui.calMonth = cur.getFullYear() + "-" + pad(cur.getMonth() + 1) + "-01";
        state.ui.calSelected = null;
        renderFuture();
        return;
      }
      const calDay = e.target.closest("[data-cal-day]");
      if (calDay) {
        const day = parseInt(calDay.dataset.calDay, 10);
        state.ui.calSelected = state.ui.calSelected === day ? null : day;
        renderFuture();
        return;
      }
      if (e.target.closest("#clearCalSel")) {
        state.ui.calSelected = null;
        renderFuture();
        return;
      }

      const card = e.target.closest(".card[data-id]");
      if (card && !e.target.closest("a") && !e.target.closest("button")) {
        openDetail(card.dataset.id);
        return;
      }

      if (e.target.closest("#toggleActive")) {
        state.ui.activeExpanded = !state.ui.activeExpanded;
        renderHome();
        return;
      }
    });

    $$("#futureSeg .seg-item").forEach(b => {
      b.addEventListener("click", () => {
        state.ui.futureSeg = b.dataset.seg;
        state.ui.calSelected = null;
        render();
      });
    });
    $$("#futureFilters .chip").forEach(c => {
      c.addEventListener("click", () => {
        state.ui.futureFilter = c.dataset.filter;
        render();
      });
    });
    $$("#notesFilters .chip").forEach(c => {
      c.addEventListener("click", () => {
        state.ui.notesFilter = c.dataset.nfilter;
        render();
      });
    });

    let snoozePick = null;
    let snoozeBasis = "elapsed";
    $$("#snoozeChips .chip").forEach(c => {
      c.addEventListener("click", () => {
        $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));
        c.classList.add("on");
        const now = new Date();
        if (c.dataset.min) {
          snoozeBasis = "elapsed";
          snoozePick = Date.now() + parseInt(c.dataset.min, 10) * 60000;
        }
        else if (c.dataset.preset === "tonight") {
          snoozeBasis = "wall-clock";
          const d = new Date(); d.setHours(20, 0, 0, 0);
          if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
          snoozePick = d.getTime();
        } else if (c.dataset.preset === "tomorrow") {
          snoozeBasis = "wall-clock";
          const d = addDays(now, 1); d.setHours(9, 0, 0, 0);
          snoozePick = d.getTime();
        } else if (c.dataset.preset === "weekend") {
          snoozeBasis = "wall-clock";
          snoozePick = nextWeekend(now);
        }
        $("#snoozeCustom").value = toLocalInput(snoozePick);
      });
    });
    $("#snoozeCustom").addEventListener("change", () => {
      const v = $("#snoozeCustom").value;
      if (v) {
        snoozePick = parseLocalInput(v);
        snoozeBasis = "wall-clock";
      }
      $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));
    });
    $("#btnApplySnooze").addEventListener("click", () => {
      const id = state.ui.snoozeId;
      let when = snoozePick;
      if (!when && $("#snoozeCustom").value) {
        when = parseLocalInput($("#snoozeCustom").value);
        snoozeBasis = "wall-clock";
      }
      if (!when) { toast("请选择时间"); return; }
      if (snoozeItem(id, when, snoozeBasis) === false) return;
      closeSheet("sheetSnooze");
      hideAlert();
      snoozePick = null;
      snoozeBasis = "elapsed";
      $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));
      $("#snoozeCustom").value = "";
    });

    $("#swNotify").addEventListener("click", async () => {
      if (!state.settings.notify) {
        if (NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid()) {
          const status = await NativeReminders.requestNotificationPermission();
          setNativeReminderStatus(status);
          state.settings.notify = status.notifications === "granted";
          state.settings.notifyPrompted = true;
          toast(state.settings.notify ? "已开启 Android 原生通知" : "通知权限未授予，将使用应用内提醒");
          if (state.settings.notify) queueNativeReminderSync();
        } else if (isNativeAndroidRuntime()) {
          // Q6：安卓上**绝不允许**走下面的 Web 通知分支。
          // WebView 的 Notification.requestPermission() 会返回 granted（Capacitor 的
          // WebChromeClient 默认放行），于是开关显示「已开启」，而系统通知权限根本没授予 ——
          // reconcile 的 enabled 仍是 false，一条排程都不落，界面上却完全看不出来。
          // 宁可明确拒绝，也不给一个假的「开着」。
          state.settings.notify = false;
          state.settings.notifyPrompted = true;
          // 桥往往只是慢一点而不是不在，再给它一点时间
          const bridged = await waitForNativeBridge(1500);
          if (bridged) {
            const status = await NativeReminders.requestNotificationPermission();
            setNativeReminderStatus(status);
            state.settings.notify = status.notifications === "granted";
            toast(state.settings.notify
              ? "已开启 Android 原生通知"
              : "通知权限未授予，请到系统设置手动允许");
            if (state.settings.notify) queueNativeReminderSync();
          } else {
            toast("原生通知桥未就绪，请完全退出后重开应用再试");
          }
        } else if (typeof window !== "undefined" && window.Notification &&
          typeof window.Notification.requestPermission === "function") {
          const perm = await window.Notification.requestPermission();
          state.settings.notify = perm === "granted";
          toast(perm === "granted" ? "已开启本地通知" : "通知权限未授予，将使用应用内提醒");
        } else {
          toast("当前环境不支持系统通知，将使用应用内提醒");
          state.settings.notify = false;
        }
      } else {
        state.settings.notify = false;
        toast("已关闭本地通知");
      }
      save(); renderMe();
    });
    $("#btnExactAlarm").addEventListener("click", async () => {
      if (!isNativeAndroidRuntime()) return;
      await openSystemSetting("exact");
      try {
        const status = await NativeReminders.getPermissionState();
        setNativeReminderStatus(status);
        queueNativeReminderSync();
        renderMe();
      } catch (error) {}
    });
    const btnNotifySettings = $("#btnNotifySettings");
    if (btnNotifySettings) {
      btnNotifySettings.addEventListener("click", async () => {
        if (!isNativeAndroidRuntime()) return;
        await openSystemSetting("notify");
      });
    }
    const btnBatterySettings = $("#btnBatterySettings");
    if (btnBatterySettings) {
      btnBatterySettings.addEventListener("click", async () => {
        if (!isNativeAndroidRuntime()) return;
        await openSystemSetting("battery");
      });
    }
    $("#swDnd").addEventListener("click", () => {
      state.settings.dnd = !state.settings.dnd; save(); renderMe();
    });
    $("#swImp").addEventListener("click", () => {
      state.settings.importantRepeat = !state.settings.importantRepeat; save(); renderMe();
    });
    // 使用模式切换（初学者模式 / 正常模式）
    $$("#userModeSeg .seg-item").forEach(btn => {
      btn.addEventListener("click", () => {
        setUserMode(btn.dataset.mode);
      });
    });
    const btnUserGuide = $("#btnUserGuide");
    if (btnUserGuide) {
      btnUserGuide.addEventListener("click", () => openSheet("sheetGuide"));
    }
    const btnSwitchToNormal = $("#btnSwitchToNormalFromGuide");
    if (btnSwitchToNormal) {
      btnSwitchToNormal.addEventListener("click", () => {
        closeSheet("sheetGuide");
        setUserMode("normal");
      });
    }
    // D25：默认提醒方式（只影响之后录入）
    $$("#deliveryModeSeg .seg-item").forEach(btn => {
      btn.addEventListener("click", () => {
        state.settings.defaultDeliveryMode = btn.dataset.mode === "alarm" ? "alarm" : "notification";
        save();
        renderMe();
        queueNativeReminderSync();
        toast(state.settings.defaultDeliveryMode === "alarm"
          ? "默认提醒方式：闹钟（仅影响之后录入）"
          : "默认提醒方式：系统通知（仅影响之后录入）");
      });
    });
    $("#swSummary").addEventListener("click", () => {
      state.settings.dailySummary = !state.settings.dailySummary;
      if (state.settings.dailySummary) state.settings.lastSummaryAt = 0;
      save(); renderMe();
      toast(state.settings.dailySummary ? "轻量摘要已开启" : "轻量摘要已关闭");
    });
    $("#swPrivacy").addEventListener("click", () => {
      state.settings.privacyNotify = !state.settings.privacyNotify;
      save(); renderMe();
      toast(state.settings.privacyNotify ? "锁屏隐私已开启" : "锁屏隐私已关闭");
    });

    $("#btnQuiet").addEventListener("click", () => {
      $("#quietStart").value = state.settings.quietStart || "23:00";
      $("#quietEnd").value = state.settings.quietEnd || "07:30";
      openSheet("sheetQuiet");
    });
    $("#btnSaveQuiet").addEventListener("click", () => {
      state.settings.quietStart = $("#quietStart").value || "23:00";
      state.settings.quietEnd = $("#quietEnd").value || "07:30";
      save();
      closeSheet("sheetQuiet");
      renderMe();
      toast("勿扰时段已更新");
    });

    // AI —— 一律写成 `() => ai.xxx()`，**不**直接传 `ai.xxx`：
    // 后者在绑定那一刻就把函数值取走了，重试重建实例之后这些按钮还指着旧的那一份。
    $("#btnAi").addEventListener("click", () => ai.openAiSheet());
    $("#swAi").addEventListener("click", () => {
      $("#swAi").classList.toggle("on");
    });
    $$("#aiAutoChips .chip").forEach(ch => {
      ch.addEventListener("click", () => {
        $$("#aiAutoChips .chip").forEach(x => x.classList.remove("on"));
        ch.classList.add("on");
      });
    });
    $("#btnSaveAi").addEventListener("click", () => ai.saveAiSettings());
    $("#btnAiTest").addEventListener("click", async () => {
      // apply current form values temporarily for test
      const prev = state.settings.ai;
      state.settings.ai = {
        enabled: $("#swAi").classList.contains("on"),
        baseUrl: ($("#aiBaseUrl").value || "").trim().replace(/\/+$/, ""),
        apiKey: ($("#aiApiKey").value || "").trim(),
        model: ($("#aiModel").value || "").trim(),
        autoOnSave: ($$("#aiAutoChips .chip.on")[0] || {}).dataset?.auto === "on"
      };
      const btn = $("#btnAiTest");
      btn.disabled = true;
      btn.textContent = "测试中…";
      try {
        await ai.testConnection();
        toast("连接成功");
      } catch (e) {
        toast("连接失败：" + (e && e.message ? e.message : "未知错误"));
      } finally {
        state.settings.ai = prev;
        btn.disabled = false;
        btn.textContent = "测试连接";
      }
    });
    $("#btnAiParse").addEventListener("click", () => ai.runOnCapture("parse"));
    $("#btnAiPolish").addEventListener("click", () => ai.runOnCapture("polish"));

    $("#btnExport").addEventListener("click", () => backup.exportData());
    $("#btnImport").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", e => {
      const selectedFile = e.target.files && e.target.files[0];
      if (selectedFile) backup.importDataFile(selectedFile);
      e.target.value = "";
    });
    // UX-C01：「载入示例数据」这个会覆盖用户状态的入口已移除。
    // 现在它只是**只读预览**：不写 state、不 save、不排任何原生或 Web 通知、不改统计。
    $("#btnSeed").addEventListener("click", () => {
      try {
        openDemoPreview();
      } catch (e) {
        console.error(e);
        toast("打开演示失败：" + (e && e.message ? e.message : "未知错误"));
      }
    });
    $("#btnClear").addEventListener("click", async () => {
      const ok = await confirmDialog("确定清空本机全部事项、笔记与项目？", "清空数据");
      if (!ok) return;
      if (inflightActionDepth > 0) {
        toast("提醒操作正在保存 · 请稍后再清空数据");
        return;
      }
      state.items = []; state.notes = []; state.projects = [];
      save(); render(); toast("已清空");
    });
    $("#btnPrd").addEventListener("click", () => { location.href = "prd.html"; });

    $("#alertClose").addEventListener("click", e => {
      e.stopPropagation();
      dismissAlert();
    });
    $("#alertAck").addEventListener("click", () => {
      if (!alertItem) return;
      if (ackItem(alertItem.id, true) === false) return;
      toast("已确认看到");
      hideAlert();
    });
    $("#alertDone").addEventListener("click", () => {
      if (!alertItem || completeItem(alertItem.id) === false) return;
      hideAlert();
    });
    $("#alertSnooze").addEventListener("click", () => {
      if (!alertItem) return;
      if (isItemActionPending(alertItem.id)) { rejectPendingItemCommand(); return; }
      state.ui.snoozeId = alertItem.id;
      snoozePick = null;
      snoozeBasis = "elapsed";
      $("#snoozeCustom").value = "";
      $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));
      hideAlert();
      openSheet("sheetSnooze");
    });
    // D13：只有点 × 才关闭；点击页面其他区域不关闭（不再绑定 outside dismiss）
    // 已移除：$("#app") click → dismissAlert
  }

  /* ---------- init ---------- */
  let deferredInstallPrompt = null;

  function registerPwa() {
    if (NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid()) {
      renderPwaStatus();
      return;
    }
    const sw = navigator && navigator.serviceWorker;
    if (!sw || typeof sw.register !== "function") {
      renderPwaStatus();
      return;
    }
    sw.register("sw.js").then((reg) => {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      if (reg && reg.addEventListener) {
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (nw) {
            nw.addEventListener("statechange", () => {
              if (nw.state === "installed" && sw.controller) {
                nw.postMessage({ type: "SKIP_WAITING" });
              }
            });
          }
        });
      }
      renderPwaStatus();
    }).catch(() => {
      renderPwaStatus();
    });

    if (typeof sw.addEventListener === "function") {
      sw.addEventListener("controllerchange", () => {
        // new SW took over; keep UI as-is to avoid reload loops
      });
      sw.addEventListener("message", (event) => {
        const data = event.data || {};
        if (data.type !== "notification-action") return;
        const id = data.itemId;
        if (id === "review-session" || data.tag === "review-session") {
          openReviewSession();
          return;
        }
        if (!id) return;
        if (data.action === "ack") {
          if (ackItem(id, true) === false) return;
          toast("已从通知确认看到");
          hideAlert();
        } else if (data.action === "done") {
          if (completeItem(id) === false) return;
          hideAlert();
        } else if (data.action === "snooze") {
          // D11：快捷稍后固定 2 小时
          if (snoozeItem(id, Date.now() + 2 * 3600000) === false) return;
          hideAlert();
        } else {
          openDetail(id);
        }
      });
    }
  }

  function bindInstall() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      const btn = $("#btnInstall");
      if (btn) btn.hidden = false;
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      const btn = $("#btnInstall");
      if (btn) btn.hidden = true;
      toast("已安装到主屏幕");
    });
    const btn = $("#btnInstall");
    if (btn) {
      btn.addEventListener("click", async () => {
        if (!deferredInstallPrompt) {
          toast("当前浏览器不支持直接安装，可使用「添加到主屏幕」");
          return;
        }
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        btn.hidden = true;
      });
    }
  }

  // Native deliveries can outlive their window, or have no item (diagnostic/removed item).
  let committedAlarmItems = [];
  function deliveryHandledByCommittedItem(alarm, item) {
    if (!item) return false;
    if (isTerminal(item)) return true;
    // ACK/snooze only ends an older delivery; a new deadline alert with the current
    // revision is independent and must remain actionable.
    return (item.status === "acknowledged" || item.status === "snoozed") &&
      hasKnownRev(alarm.itemRev) && Number(item.rev) > Number(alarm.itemRev);
  }
  async function completeActiveAlarm(alarm) {
    const bridge = systemBridge();
    const eventId = "active:" + alarm.token + ":done";
    const completed = await handleAlarmAction({ action: "done", itemId: alarm.itemId,
      itemRev: alarm.itemRev, alarmEventId: eventId });
    if (!completed && !alarmEventSeen(eventId)) throw new Error("提醒已变更，请在事项详情中确认；仍可停止声振");
    await bridge.stopAlarmDelivery({ id: alarm.id, token: alarm.token });
    return true;
  }
  let activeAlarmRefreshBusy = false;
  let activeAlarmPanelSignature = "";
  async function refreshActiveAlarmPanel(reveal) {
    const host = $("#activeAlarmPanel");
    const bridge = systemBridge();
    if (!host || !bridge || !bridge.activeAlarmDeliveries || activeAlarmRefreshBusy) return;
    activeAlarmRefreshBusy = true;
    try {
      const result = await bridge.activeAlarmDeliveries();
      const rows = [];
      for (const alarm of result.alarms || []) {
        const item = state.items.find(it => it.id === alarm.itemId);
        // Current committed item state wins over an old delivery; never change it from a stale alarm.
        const committedItem = committedAlarmItems.find(it => it.id === alarm.itemId);
        if (deliveryHandledByCommittedItem(alarm, committedItem)) {
          await bridge.stopAlarmDelivery({ id: alarm.id, token: alarm.token });
          continue;
        }
        const canComplete = item && hasKnownRev(alarm.itemRev) && Number(item.rev) === Number(alarm.itemRev);
        rows.push({ alarm, item, canComplete });
      }
      const signature = JSON.stringify(rows.map(({alarm,item}) => [alarm, item && item.title, item && item.rev]));
      if (signature === activeAlarmPanelSignature) {
        if (reveal && rows.length) host.scrollIntoView({ block: "start" });
        return;
      }
      activeAlarmPanelSignature = signature;
      host.hidden = rows.length === 0;
      host.innerHTML = rows.map(({alarm,item,canComplete}, index) =>
        '<div class="card" style="margin-bottom:12px;padding:16px;border:2px solid var(--accent)">' +
        '<strong>闹钟待处理</strong><p>' + escapeHtml(item ? item.title : alarm.title || "闹钟提醒") + '</p>' +
        '<p style="color:var(--muted)">' + escapeHtml(item ? "全屏未显示时，也可以在这里处理。" :
          "测试提醒或原事项已不存在，仍可停止声振。") + '</p>' +
        '<button class="btn" data-alarm-stop="' + index + '">停止声振</button> ' +
        (canComplete ? '<button class="btn" data-alarm-done="' + index + '">完成事项</button>' : '') + '</div>'
      ).join("");
      if (reveal && rows.length) host.scrollIntoView({ block: "start" });
      host.querySelectorAll("[data-alarm-stop], [data-alarm-done]").forEach(button => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          const done = button.hasAttribute("data-alarm-done");
          const row = rows[Number(button.getAttribute(done ? "data-alarm-done" : "data-alarm-stop"))];
          try {
            if (done) {
              // Persist completion first; a failed save must remain visible and retryable.
              await completeActiveAlarm(row.alarm);
            } else {
              await bridge.stopAlarmDelivery({ id: row.alarm.id, token: row.alarm.token });
            }
            activeAlarmPanelSignature = "";
            toast(done ? "已完成并停止声振" : "已停止本次声振，事项状态未改变");
            await refreshActiveAlarmPanel();
          } catch (error) { toast(error.message || "操作失败，请重试"); }
          finally { button.disabled = false; }
        });
      });
    } catch (error) {
      // Keep existing stop controls on a transient bridge failure.
    } finally { activeAlarmRefreshBusy = false; }
  }

  // N-03：轮询句柄必须留痕。`bindNetwork` 目前只在 `init()` 里调一次，
  // 但重复初始化（热重载、将来多实例挂载）会静默堆出多个 2 秒定时器且无人能清 —— 先清后建。
  let activeAlarmPollTimer = null;
  function bindNetwork() {
    if (activeAlarmPollTimer != null) clearInterval(activeAlarmPollTimer);
    activeAlarmPollTimer = setInterval(() => {
      if (document.visibilityState === "visible") refreshActiveAlarmPanel();
    }, 2000);
    window.addEventListener("online", renderPwaStatus);
    window.addEventListener("offline", renderPwaStatus);
    window.addEventListener("blur", () => backup.noteExportAppVisibility(false));
    window.addEventListener("focus", () => backup.noteExportAppVisibility(true));
    document.addEventListener("visibilitychange", () => {
      backup.noteExportAppVisibility(document.visibilityState === "visible");
      if (document.visibilityState === "visible") {
        // Q6：切回前台是补做原生初始化的天然时机。
        // 冷启动时若桥还没注入（存在稳定时间差），这里的 ensure 会再试一遍并把排程补上。
        if (!nativeReady) queueNativeReminderSync();
        promoteDue();
        refreshActiveAlarmPanel(true);
        tick();
      }
    });
  }

  function handleQueryActions() {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    if (tab === "future" || tab === "notes" || tab === "me" || tab === "home") {
      state.ui.tab = tab;
      if (tab === "future") state.ui.futureSeg = "waiting";
    }
    const action = params.get("action");
    if (action === "capture") {
      setTimeout(() => openCapture(), 200);
    }
    // D20：通知/深链直达整理会话
    if (action === "review" || params.get("itemId") === "review-session") {
      state.ui.tab = "home";
      setTimeout(() => openReviewSession(), 250);
    }
    // 全屏闹钟动作回传
    const alarmAction = params.get("alarmAction");
    if (alarmAction) {
      handleAlarmAction({
        action: alarmAction,
        itemId: params.get("alarmItem") || params.get("alarmItemId"),
        itemRev: params.get("alarmItemRev") || params.get("itemRev")
      });
      try { history.replaceState(null, "", location.pathname); } catch (e) {}
    }
  }

  /** 全局错误监听只装一次（恢复面板重试会再进 `init()`）。 */
  let globalErrorHandlerInstalled = false;

  function installGlobalErrorHandler() {
    if (globalErrorHandlerInstalled) return;
    globalErrorHandlerInstalled = true;
    window.addEventListener("error", (e) => {
      console.error("App error:", e && e.message, e && e.error);
      try {
        const host = document.getElementById("homeEmpty") || document.getElementById("main");
        if (host && !host.dataset.errShown) {
          host.dataset.errShown = "1";
          const div = document.createElement("div");
          div.className = "hint-bar";
          div.style.color = "#8f3a3a";
          div.style.background = "#f6e8e8";
          div.textContent = "脚本出错：" + (e && e.message ? e.message : "unknown");
          host.insertBefore(div, host.firstChild);
        }
      } catch (err) {}
    });
  }

  /**
   * P2-C-R：**恢复闸门**。
   *
   * `init()` 拆成两半，分界线就是这次恢复尝试的判定：
   *   · `loaded` / `empty` ⇒ 权威状态已确认，进入 `startBusinessStartup()`；
   *   · `failed`           ⇒ **到此为止**：不 bind（没有任何业务入口可点）、
   *     不做 schema 迁移 save、不 `ensureNativeReminders()`（不排钟、不建渠道）、
   *     不 `scheduleNextReviewAlarm()`、不起 15 秒心跳、不 tick、不更新角标。
   *     取而代之的是一个**可见的恢复面板**（重试 / 重新加载），重试成功后才走正常启动。
   *
   * 为什么整段跳过而不是「只关掉写库」：这些旁路会**读**一份我们并不信任的状态
   * 去对外产生事实 —— 排钟会把空收件箱的排程对账给原生、心跳会把空状态推进业务
   * （`promoteDue` / 截止对账），那些事实在数据恢复后会变成脏排程与脏台账。
   */
  async function init() {
    installGlobalErrorHandler();

    const report = await loadAsync();
    if (report.status === LOAD_FAILED) {
      try {
        renderStateRecovery(report);
      } catch (error) {
        console.error(
          "Failed to render state recovery panel:",
          error && error.message ? error.message : error
        );
      }
      return;
    }
    removeStateRecoveryPanel();
    startBusinessStartup();
  }

  /** `init()` 的后半段：只有权威状态确认之后才跑的**全部**业务启动。 */
  function startBusinessStartup() {
    syncUserMode();
    bind();
    if (schemaMigrationNeeded) {
      schemaMigrationNeeded = false;
      save();
    }
    // Q6：原生初始化**不挡在启动链上**（幂等、可重试、内部已兜错）。
    // 它内部要跨桥通信（注册动作类型 / 挂监听 / 建通知渠道 / 首次对账），
    // 任何一步慢或抛错都会把下面的 seed / render / 15 秒心跳一起拖住 ——
    // 而 V1 已经证明这类中断是静默的：界面照常可点，数据永不落库。
    ensureNativeReminders();
    // D11/D12：监听全屏闹钟动作
    //
    // Q1：这里**必须**兜住异常。监听注册是「旁路能力」而不是启动前提，
    // 一旦它抛错就会顺次打断下面整条启动链（seed / render / 15 秒心跳 / 角标），
    // 而表现只是「界面照常可点、数据永不落库」—— 极难发现。
    // 兜住之后最坏结果退化为「全屏闹钟动作不被监听」，其余功能照常。
    if (NativeReminders.onAlarmAction) {
      try {
        NativeReminders.onAlarmAction(handleAlarmAction);
      } catch (error) {
        console.error(
          "Alarm action listener registration failed:",
          error && error.message ? error.message : error
        );
      }
    }
    // 兼容深链：?alarmAction=&alarmItem=
    maybePromptAndroidNotify();
    maybeReviewSession();
    scheduleNextReviewAlarm();
    registerPwa();
    bindInstall();
    bindNetwork();

    // O7：**路由先确定，再渲染一次。**
    //
    // 原顺序是「分支里 render() → 一串旁路装配 → handleQueryActions() → render()」，
    // 加上末尾 tick() 内部的 renderHome，干净冷启动最多做 3 次首页 DOM 构建，
    // 而后两次的输入完全相同（query 路由只改 state.ui，不改任何渲染输入）。
    //
    // 现在：`applyShareParams` / `handleQueryActions` 先把 tab、整理会话、深链动作、
    // 分享预填确定下来，然后只渲染一次。其余语义逐条保留：
    //  · 干净首启仍然不 seed（UX-C01，本段代码从未 seed 过，只把「不再自动 seed」写实）；
    //  · 分享入口照旧捕获（返回 true 时把 tab 拉回 home，与旧逻辑一致）；
    //  · 通知 / 深链 / 整理入口照常触发（它们各自渲染自己的面板）；
    //  · 后台桥异步初始化不受影响（ensureNativeReminders 在上面，本来就不挡启动链）。
    // 末尾 `tick()` 仍然执行，负责业务推进与**立即处理已到期事项**，不靠删它省渲染次数；
    // 它内部的 renderHome 在输入未变时由 O6 的签名短路兜成空操作。
    const shared = applyShareParams();
    if (shared) state.ui.tab = "home";
    handleQueryActions();
    render();
    maybeDailySummary();
    setInterval(tick, 15000);
    tick();
    updateAppBadge();
  }

  /**
   * G5：**初始化完成信号**。
   *
   * 冷启动的 init() 是异步的：`loadAsync()` 恢复持久化状态时，`applyParsedState`
   * 会**整体替换** `state.items` / `state.settings`（并重建全部事项对象）。
   * 任何在它完成之前对 `state` 的写入都会被这次恢复覆盖 —— 写入者手里的引用
   * 也随之变成「不在库里的孤儿对象」。
   *
   * 所以「脚本已加载」≠「应用已就绪」。测试与调试代码必须先 `await ready()` 再准备状态。
   */
  let readyPromise = null;

  /**
   * 最近一次装配闸门的判定结果（`null` = 装配完好）。
   *
   * 失败面板是给用户看的，测试不该只靠「DOM 里多了一个节点」来判断闸门有没有生效 ——
   * 那测的是渲染，不是判定。所以把判定本身留在这里，`ready() === false` 与该字段
   * 一起构成「启动被明确拒绝」的两个可断言事实。
   */
  let lastStartupFailure = null;

  /**
   * 成功启动只发生一次（F03 的「重试不得重复注册监听 / 计时器」）。
   *
   * 首次失败时 `init()` 一行都没跑，所以重试要重跑它 —— 那时本标志仍是 `false`；
   * 而一旦 `init()` 真的跑起来过（无论成败），再点重试就**不能**再跑一遍：
   * 那会多装一份 15 秒心跳、一套 document/window 事件监听，以及一轮原生对账。
   */
  let initStarted = false;

  function startApp() {
    // P1：**装配闸门在业务启动之前**，而且闸门**本身就是装配**（独立复验 F03）——
    // 校验过的值当场被绑上去，「闸门读的是新 `Lib`、业务跑的是旧函数」这一窗口被消除。
    //
    // 顺序上必须早于 `init()` 的全部内容 —— 一旦进了 init，就会依次发生
    // loadAsync（读库并整体替换 state）、schema 迁移的 save()、ensureNativeReminders
    // （排钟 / 建通知渠道）、`setInterval(tick, 15000)`。缺模块时这些都会带着
    // 「半套规则」跑起来，而且不报错。
    const depProblems = bindRuntime();
    lastStartupFailure = depProblems.length ? depProblems : null;
    if (depProblems.length) {
      console.error("Startup dependency check failed:", depProblems);
      try {
        renderStartupFailure(depProblems);
      } catch (error) {
        console.error("Failed to render startup failure:", error && error.message ? error.message : error);
      }
      // ready 必须**明确失败**（false），而不是挂起或假装成功。
      readyPromise = Promise.resolve(false);
      return readyPromise;
    }
    if (initStarted) {
      // 已经起来过的应用不再重起一遍（见 initStarted 的说明）。
      readyPromise = Promise.resolve(true);
      return readyPromise;
    }
    initStarted = true;
    // 同步启动，保持与之前一致的启动时机；只把结果包成一个总是兑现的 Promise
    const running = init();
    readyPromise = running.then(() => {
      // P2-C-R：恢复闸门拒绝启动（权威状态未确认）时，`ready` 必须**明确失败**，
      // 与装配闸门失败同一语义 —— 「脚本加载了」不等于「应用就绪」，
      // 更不能让测试/调试代码拿到 true 之后往一份未确认的状态里写东西。
      // 同时把 `initStarted` 放回可重入状态，让恢复面板的「重试恢复」能再跑一遍。
      if (lastLoadReport && lastLoadReport.status === LOAD_FAILED) {
        initStarted = false;
        return false;
      }
      return true;
    }, err => {
      console.error("App init failed:", err && err.message ? err.message : err);
      // 启动链中途失败 ⇒ 允许「重试」再跑一次（否则会卡在既没起来、又不许重试的状态）。
      initStarted = false;
      return false;
    });
    return readyPromise;
  }

  /* ---------- 给可重放状态命令装上统一日志 ---------- */

  /**
   * 单个事项上、用户能直接触发的**业务操作**在这里统一包一层。
   *
   * 这些入口只改事项状态，参数是**自足的值**（id / 时间戳 / 字段快照）。
   * 同事务域的入口在提交未决时拒绝；不相关事项的入口可按原顺序重放。
   *
   * 刻意**不包**：
   *  · `promoteDue` / 渲染 —— 自动推进在提交窗口延后，下一拍会自己重算；展示不写状态；
   *  · `saveItemFromForm` —— 它要读表单，重放时表单已关；改为在内部单独记录
   *    `applyItemEdit`（见该函数）。
   *
   * `markReviewDone(item, extra)` 一并包上：它是**参数自足的纯字段写入**（不碰别的状态），
   * 整理确认、截止对账、真实送达回调和原生时间迁移也写同一 items 状态，因此同样纳入。
   */
  const itemCommand = { userFacing: true, itemArg: 0 };
  ackItem = wrapUserOp(ackItem, Object.assign({ name: "ackItem" }, itemCommand));
  snoozeItem = wrapUserOp(snoozeItem, Object.assign({ name: "snoozeItem" }, itemCommand));
  completeItem = wrapUserOp(completeItem, Object.assign({ name: "completeItem" }, itemCommand));
  reopenItem = wrapUserOp(reopenItem, Object.assign({ name: "reopenItem" }, itemCommand));
  restoreItem = wrapUserOp(restoreItem, Object.assign({ name: "restoreItem" }, itemCommand));
  resumeDeadlineProtection = wrapUserOp(resumeDeadlineProtection, Object.assign({ name: "resumeDeadlineProtection" }, itemCommand));
  deleteItem = wrapUserOp(deleteItem, Object.assign({ name: "deleteItem" }, itemCommand));
  stopRepeat = wrapUserOp(stopRepeat, Object.assign({ name: "stopRepeat" }, itemCommand));
  markReviewDone = wrapUserOp(markReviewDone, Object.assign({ name: "markReviewDone" }, itemCommand));
  applyDeadlineEvents = wrapUserOp(applyDeadlineEvents);
  markDeadlineDelivered = wrapUserOp(markDeadlineDelivered);
  refreshNativeScheduleBasis = wrapUserOp(refreshNativeScheduleBasis);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { startApp(); });
  } else {
    startApp();
  }

  // Dev/test hook — no user-facing effect
  //
  // ⚠️ 这些是**装配出来的绑定**（`let`，重试时会整体换新），所以必须按**取值器**导出：
  // 写成简写属性（`parseChineseTime,`）拿到的是「钩子构造那一刻」的旧值，
  // 于是「补载脚本后点重试，业务真的能用了吗」在测试里永远测不出来 —— 而那正是 F03。
  if (typeof globalThis !== "undefined") {
    globalThis.__ATTENTION_INBOX__ = {
      get parseChineseTime() { return parseChineseTime; },
      makeItem,
      get nextRepeatTrigger() { return nextRepeatTrigger; },
      // 同名函数两种语义必须**显式命名**（见 lib/date-utils.js）：
      // 首期候选按具体时刻比较，周期推进按「日」比较，合并就会让周期原地打转。
      get nthWeekdayOfNextMonthByInstant() { return DatePrimitives.nthWeekdayOfNextMonthByInstant; },
      get nthWeekdayOfNextMonthByDay() { return DatePrimitives.nthWeekdayOfNextMonthByDay; },
      get nthWeekdayInMonth() { return nthWeekdayInMonth; },
      get lastDayOfMonth() { return lastDayOfMonth; },
      get repeatLabel() { return repeatLabel; },
      findSimilarItems,
      isDue,
      inQuietHours,
      quietEnd,
      promoteDue,
      ackItem,
      completeItem,
      snoozeItem,
      reopenItem,
      restoreItem,
      deleteItem,
      seed,
      get hasSpecificTimeWord() { return hasSpecificTimeWord; },
      fallbackTriggerAt,
      resolveDeliveryMode,
      ensureReviewSettings,
      inReviewHighlight,
      // 渲染 / 会话 / 弹条 —— 供测试直接断言行为，无用户可见副作用
      renderHome,
      // O6：首页卡片容器的渲染计数。「折叠 1000 条不生成隐藏卡片」「无显示变化的一拍
      // 不替换卡片节点」这两句结论必须能被**计数**证明，而不是只读源码推断。
      homeRenderStats: () => Object.assign({}, appViews.homeRenderStats()),
      resetHomeRenderStats: () => appViews.resetHomeRenderStats(),
      // O2：原生同步的计数台账（同步请求数 / 实际对账轮数 / 去重合并数）——
      // 「内部记账不再自激下一轮对账」要能在**真实 app 编排链**上数出来。
      nativeSyncStats: () => ({
        totalRequests: nativeSyncMetrics.totalRequests,
        runs: nativeSyncMetrics.runs,
        deduped: nativeSyncMetrics.deduped,
        bySource: Object.assign({}, nativeSyncMetrics.bySource)
      }),
      resetNativeSyncStats: () => {
        nativeSyncMetrics.totalRequests = 0;
        nativeSyncMetrics.runs = 0;
        nativeSyncMetrics.deduped = 0;
        nativeSyncMetrics.bySource = {};
      },
      renderReviewEntry,
      renderReviewCard,
      openReviewSession,
      maybeReviewSession,
      needsReviewItems,
      detectNeedsReview,
      // L05：整理会话出口与时间来源判断
      reviewConfirm,
      reviewSaveEdit,
      reviewKeepCurrent,
      resolveReviewTrigger,
      markReviewDone,
      markReviewTriggerPicked: (v) => { reviewTriggerUserPicked = !!v; },
      // L03 / D23：规则级二级操作与截止保护恢复
      stopRepeat,
      resumeDeadlineProtection,
      // F1：截止事件按阶段记账
      applyDeadlineEvents,
      markDeadlineDelivered,
      // D43：单次提醒台账（与截止台账同构）
      applyReminderEvents,
      // H-07：IDB 恢复后重放降级期的改动
      replayPendingSnapshot,
      showAlert,
      hideAlert,
      dismissAlert,
      // H-08：投递归因（自检面板的结论由它产生，必须能被行为级断言）
      describeAlarmDelivery,
      // A-2 / D68：首页告知条的判定与渲染（纯逻辑 + DOM，都要能被行为级断言）
      homeNoticeVerdict,
      renderHomeNotice,
      // A-2：原生状态的唯一漏斗 —— 「权限恢复后警告自动消失」这句话就是经它成立的，
      // 所以断言必须穿过它，而不是绕过它去直接摆状态
      setNativeReminderStatus,
      handleAlarmAction,
      completeActiveAlarm,
      deliveryHandledByCommittedItem,
      alarmEventSeen,
      // G5：初始化完成信号（loadAsync/applyParsedState 已不再改动 state）
      ready: () => readyPromise || Promise.resolve(true),
      handleNativeNotificationAction,
      saveItemFromForm,
      // UX-C01：演示必须是**只读预览**（老入口是「载入示例数据」，能覆盖用户状态）
      openDemoPreview,
      demoPreviewRows,
      // UX-C03 / A03：有限撤销 —— 幽灵响铃的红线就压在这两个函数上，
      // 所以必须能被行为级断言（否则只能退回源码字符串，D48 的教训）
      undoNewItem,
      undoLastComplete,
      // UX-T02 / F07：60 秒测试的**本次运行**语义（停铃、证据绑定、完成与重测状态）
      startSetupTestRun,
      stopSetupTestRun,
      setupEvidenceHtml,
      setupStepsContext,
      // UX-T03：原生送达证据的回流接线（幂等合并 + 详情页「提醒结果」结论）
      readDeliveryEvidence,
      applyNativeDeliveryEvidence,
      applyReminderDelivered,
      detailReminderStatusRow,
      // R-F06：保存反馈用的「本条排程证据」也要能被行为级断言 ——
      // 它同样只许认**当前轮**，否则旧轮的 delivered 会让刚排好的新周期冒充「已安排好」。
      itemScheduleEvidence,
      deliveryEvidenceReadable,
      deliveryEvidenceState,
      markTriggerPicked: (v) => { triggerUserPicked = !!v; },
      // R-F03：表单会话身份必须能被行为级断言 —— 「关掉重开」= 另一张表单，
      // 内容碰巧一样也不行。所以要能从测试里真的开/关那张表单。
      openCapture,
      openEditItem,
      resetItemSheet,
      closeAllSheets,
      get formSession() { return itemFormSession; },
      clearAlert: () => { alertItem = null; },
      get state() { return state; },
      setUserMode,
      syncUserMode,
      save,
      // 真实的持久化 Promise：测试要断言「落库之后」的状态就必须等它
      saveAsync,
      load,
      // H-07：降级恢复的取证入口（探测器需要在不重启页面的情况下重放一次）
      loadAsync,
      // P2-C：备份实例同样取**当前绑定**（取值器，不是装配那一刻的快照）——
      // 「补载脚本后点重试」这条链上测到的必须是新实例，否则宽限闸门/在途状态
      // 还挂在旧实例上，测试会给出假结论。
      get exportData() { return backup.exportData; },
      get buildLegacyBackupPayload() { return backup.buildLegacyBackupPayload; },
      get noteExportAppVisibility() { return backup.noteExportAppVisibility; },
      // P2-A：AI 的纯函数与实例都取自**当前绑定**（取值器，不是装配那一刻的快照）——
      // 否则「重试之后」这条链上测到的还是旧实例。
      get normalizeAiResult() { return AppAi.normalizeAiResult; },
      get extractJson() { return AppAi.extractJsonObject; },
      get ai() { return ai; },
      // 在途请求闸门的**可观测出口**：测试要能断言「第二次点击被挡住」。
      // 在空壳实例上这条恒为 false —— 所以 `isBusy` 也在实例契约里。
      get aiBusy() { return ai ? ai.isBusy() : null; },
      renderMarkdown,
      uid,
      // 同上：都是装配绑定，按取值器导出才反映「重试之后」的那一份。
      get startOfDay() { return startOfDay; },
      get addDays() { return addDays; },
      get sameDay() { return sameDay; },
      get applyClock() { return applyClock; },
      get storage() { return storage; },
      // P1：装配闸门本身可被直接驱动 —— 只有这样才能构造「缺模块」的反例。
      // 光测「正常组合能起来」证明不了闸门有效：闸门的作用对象恰恰是坏组合。
      assertRuntimeDependencies,
      renderStartupFailure,
      REQUIRED_RUNTIME_EXPORTS,
      // F02/F03：装配的两半都要能被单独驱动 ——
      //  `collectRuntimeBindings` 看「检查与取值」；`bindRuntime` 看「真的绑上了」；
      //  `startApp` 让「补载脚本后点重试」这条路上能被实测。
      collectRuntimeBindings,
      bindRuntime,
      RUNTIME_BINDING_PATHS,
      APP_UI_INSTANCE_CONTRACT,
      APP_AI_INSTANCE_CONTRACT,
      APP_BACKUP_INSTANCE_CONTRACT,
      APP_DIAGNOSTICS_INSTANCE_CONTRACT,
      APP_VIEWS_INSTANCE_CONTRACT,
      startApp,
      // P2-D：诊断实例取**当前绑定**（取值器）—— 与 backup/AI 同一条 F03 规矩。
      get diagnostics() { return diagnostics; },
      get setup() { return appSetup; },
      get content() { return appContent; },
      get views() { return appViews; },
      get viewsSurface() {
        if (!appViews) return { missing: true };
        return {
          hasHome: typeof appViews.renderHome === "function",
          hasCard: typeof appViews.renderItemCard === "function",
          hasDetail: typeof appViews.openDetail === "function",
          hasFuture: typeof appViews.renderFuture === "function",
          hasMe: typeof appViews.renderMe === "function"
        };
      },
      get contentSurface() {
        if (!appContent) return { missing: true };
        return { hasBind: typeof appContent.bind === "function", hasNotes: typeof appContent.openNote === "function",
          hasSearch: typeof appContent.doSearch === "function", hasProjects: typeof appContent.deleteProject === "function" };
      },
      get setupSurface() {
        if (!appSetup) return { missing: true };
        return { hasBind: typeof appSetup.bind === "function", hasPrompt: typeof appSetup.maybePromptAndroidNotify === "function",
          hasTest: typeof appSetup.startSetupTestRun === "function", hasStop: typeof appSetup.stopSetupTestRun === "function",
          hasEvidence: typeof appSetup.setupEvidenceHtml === "function" };
      },
      diagnosticsSurface: () => {
        if (!diagnostics) return { missing: true };
        return {
          hasBind: typeof diagnostics.bind === "function",
          hasRefresh: typeof diagnostics.refreshNotifyLab === "function",
          hasLabLog: typeof diagnostics.labLog === "function",
          hasCancel: typeof diagnostics.labCancelAlarms === "function",
          hasDescribe: typeof diagnostics.describeAlarmDelivery === "function",
          hasOpenSystem: typeof diagnostics.openSystemSetting === "function",
          hasOpenGuide: typeof diagnostics.openBackgroundGuide === "function"
        };
      },
      // 绑定结果的**可观测快照**：断言对象是「绑定到的东西是不是现在这一份」，
      // 不是「曾经绑过一次」（F03 的判据）。
      runtimeBindings: () => ({
        parseChineseTime: typeof parseChineseTime === "function"
          ? (Lib.parseChineseTime === parseChineseTime ? "current" : "stale")
          : "missing",
        nextRepeatTrigger: typeof nextRepeatTrigger === "function"
          ? (Lib.nextRepeatTrigger === nextRepeatTrigger ? "current" : "stale")
          : "missing",
        cnInt: typeof cnInt === "function"
          ? (Lib.cnInt === cnInt ? "current" : "stale")
          : "missing",
        hasQuery: typeof $ === "function",
        // 「有没有被换成 null / 空壳」与「是不是当前那一份」是**两件事**：
        // 前者证明「失败不覆盖」，后者证明「成功即同源」。
        feedback: !!(FeedbackLib && typeof FeedbackLib === "object"),
        feedbackIsCurrent: FeedbackLib === Lib.Feedback,
        evidence: !!(EvidenceLib && typeof EvidenceLib === "object"),
        evidenceIsCurrent: EvidenceLib === Lib.DeliveryEvidence,
        native: !!(NativeReminders && typeof NativeReminders === "object"),
        nativeIsCurrent: NativeReminders ===
          (typeof AttentionNativeReminders !== "undefined" && AttentionNativeReminders)
      }),
      startupFailure: () => (lastStartupFailure ? lastStartupFailure.slice() : null),
      /**
       * P2-C-R：**权威状态恢复**的三个可断言事实。
       *
       * 测试与真机探针都不该靠「DOM 里多了个节点」判断恢复闸门有没有生效 ——
       * 那测的是渲染，不是判定。这里给出判定本身：
       *   · `status` —— `loaded` / `empty` / `failed` / `unconfirmed`；
       *   · `blockedWriteCount` —— 被写闸门拦下的提交次数；
       *   · `nativeBlocked` —— 因未确认而被拦下的原生对账次数。
       */
      stateAuthority: () => ({
        status: stateAuthority,
        report: lastLoadReport ? Object.assign({}, lastLoadReport) : null,
        attempts: loadAttempts,
        blockedWriteCount: blockedWriteCount,
        nativeBlocked: nativeSyncMetrics.blockedByAuthority,
        writesAllowed: authoritativeWritesAllowed(),
        mirrorBytes: mirrorBytes(),
        recoveryPanel: stateRecoveryPanelShown
      }),
      retryRestore,
      // P2-b：展示能力的接线证明。断言对象是**调用结果**而不是「绑定是否存在」——
      // `typeof $ === "function"` 才能说明 AppUi 真的装上了；只看 `appUi` 是不是空对象
      // 会漏掉「模块在、但 createUi 返回了空壳」。
      uiSurface: () => ({
        hasQuery: typeof $ === "function",
        hasQueryAll: typeof $$ === "function",
        hasSheet: typeof openSheet === "function",
        hasCloseSheet: typeof closeSheet === "function",
        hasCloseAllSheets: typeof closeAllSheets === "function",
        hasConfirm: typeof confirmDialog === "function",
        hasToast: typeof toast === "function",
        hasHideToast: typeof hideToast === "function",
        hasSafeHref: typeof safeExternalHref === "function",
        // 三档协议判定的实测结果（相对断言容易写成恒真，这里取真实返回值）。
        hrefHttps: safeExternalHref ? safeExternalHref("https://example.com/x") : "MISSING",
        hrefJs: safeExternalHref ? safeExternalHref("javascript:alert(1)") : "MISSING",
        hrefTab: safeExternalHref ? safeExternalHref("ja\tvascript:alert(1)") : "MISSING"
      }),
      /**
       * P2-A：AI 能力的接线证明。判据同样是**调用结果**，不是「绑定在不在」——
       * `typeof ai === "object"` 在空壳实例上也成立，而后果是所有 AI 入口点了没反应。
       *
       * 这里全部取真实返回值（含一次真的 `normalizeAiResult` 与一次真的 `mergedDraft`），
       * 让「模块在、但行为不对」也能被测出来。
       */
      aiSurface: () => {
        if (!ai || !AppAi) return { missing: true };
        const base = { text: "orig", tags: "home", note: "", trigger: "", deadline: "" };
        const merged = ai.mergedDraft(base, {
          title: "ai-title",
          triggerAt: Date.UTC(2026, 8, 21, 2, 0, 0),
          tags: ["work", "home"],
          note: "ai-note",
          priority: "important",
          repeat: { every: "week", mode: "ack" }
        });
        return {
          hasConfig: typeof ai.config === "function",
          config: ai.config(),
          ready: ai.ready(),
          nowIso: ai.nowIso(),
          promptHasClock: ai.systemPrompt().indexOf("当前本地时间 ISO") >= 0,
          isBusy: ai.isBusy(),
          // 合并结果是**新对象**：`mergedDraft` 不能改动提交时冻结的那份草稿
          mergedTitle: merged.text,
          mergedPriority: merged.priority,
          mergedRepeatEvery: merged.repeat,
          mergedTags: merged.tags,
          mergedNote: merged.note,
          baseUntouched: base.text === "orig" && base.tags === "home" && base.note === "",
          // 归一：模型自创的优先级必须被收窄，不能绕过重要档的渠道规则
          normalizePriority: AppAi.normalizeAiResult({ priority: "super-urgent" }, "").priority,
          normalizeRepeat: AppAi.normalizeAiResult({ repeat: { every: "yearly" } }, "").repeat,
          extract: JSON.stringify(AppAi.extractJsonObject("```json\n{\"a\":1}\n```"))
        };
      }
    };
    // Console helper for manual recovery in preview
    globalThis.seedAttentionInbox = seed;
  }
})();
