/* 安心收件箱 — Local-first attention hub
 * 原则：Attention ≠ Task · Acknowledged ≠ Completed · Future 默认不可见
 */
(function () {
  "use strict";

  const KEY = "attention-inbox-v2";
  // D43：schema 5 = 事项新增 `reminderEvents`（单次提醒台账，与 deadlineEvents 同构）。
  // 旧记录缺这个字段时由 normalizeItem 补 `{}`；`schemaMigrationNeeded` 触发一次重写落库。
  let SCHEMA = null;
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
  // P2-G1：capture 表单展示与会话身份由唯一实例承接；提交事务仍在 core。
  let AppCapture = {};
  let appCapture = null;
  let AppModel = {};
  let appModel = null;
  let AppPersistence = {};
  let appPersistence = null;
  let AppTransaction = {};
  let appTransaction = null;
  let AppItems = {};
  let appItems = null;
  let AppNativeCoordinator = {};
  let appNativeCoordinator = null;
  let AppReview = {};
  let appReview = null;
  let AppAlerts = {};
  let appAlerts = null;
  let AppPlatform = {};
  let appPlatform = null;
  // P3-I-R：首页告知条与启动轻摘要的**唯一实现**（判定 + 单写入者渲染）。
  let AppNotices = {};
  let appNotices = null;
  let AppActionFeedback = {};
  let appActionFeedback = null;
  let AppEvents = {};
  let appEvents = null;
  let AppTestApi = {};
  let appTestApi = null;
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
  let schemaMigrationNeeded = false;
  let nativeReady = false;
  let nativeSyncTimer = null;
  // Q6：原生初始化的 in-flight promise。
  // 保证「同一时刻只有一次初始化在跑」，同时**允许失败后重试**
  // （跑完置回 null，下一次请求会再试一遍）。
  let nativeInitPromise = null;
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
    ["AppCapture", "object", "lib/app-capture.js 未加载 —— 新建/编辑表单与会话保护整体失效"],
    ["AppCapture.createAppCapture", "function", "lib/app-capture.js 导出被破坏（表单能力装配入口）"],
    ["AppModel", "object", "lib/app-model.js 未加载 —— 事项模型与初始状态无法装配"],
    ["AppModel.createAppModel", "function", "lib/app-model.js 导出被破坏（模型能力装配入口）"],
    ["AppPersistence", "object", "lib/app-persistence.js 未加载 —— 权威恢复与保存闸门无法装配"],
    ["AppPersistence.createAppPersistence", "function", "lib/app-persistence.js 导出被破坏（持久化能力装配入口）"],
    ["AppTransaction", "object", "lib/app-transaction.js 未加载 —— 事务协调器无法装配"],
    ["AppTransaction.createAppTransaction", "function", "lib/app-transaction.js 导出被破坏（事务能力装配入口）"],
    ["AppItems", "object", "lib/app-items.js 未加载 —— 事项命令与周期推进无法装配"],
    ["AppItems.createAppItems", "function", "lib/app-items.js 导出被破坏（事项业务能力装配入口）"],
    ["AppNativeCoordinator", "object", "lib/app-native-coordinator.js 未加载 —— 原生提醒协调器无法装配"],
    ["AppNativeCoordinator.createAppNativeCoordinator", "function", "lib/app-native-coordinator.js 导出被破坏（原生协调能力装配入口）"],
    ["AppReview", "object", "lib/app-review.js 未加载 —— 待整理会话、窗口规则与卡片整体失效"],
    ["AppReview.createAppReview", "function", "lib/app-review.js 导出被破坏（待整理能力装配入口）"],
    ["AppAlerts", "object", "lib/app-alerts.js 未加载 —— Web 提醒弹条、到期 tick 与活动闹钟面板整体失效"],
    ["AppAlerts.createAppAlerts", "function", "lib/app-alerts.js 导出被破坏（提醒能力装配入口）"],
    ["AppPlatform", "object", "lib/app-platform.js 未加载 —— 平台适配与 PWA 生命周期整体失效"],
    ["AppPlatform.createAppPlatform", "function", "lib/app-platform.js 导出被破坏（平台能力装配入口）"],
    /* --- P3-I-R：`lib/app-notices.js` 是「首页告知条 + 启动轻摘要」的唯一实现 ---
     *
     * 缺它的后果不是「少一条提示」，而是**界面重新开始撒谎**：
     *   · 关掉 App 就不响、系统通知权限没给、原生桥没就绪、对账失败 —— 这四种断链
     *     在首页一个字都不会出现，界面照常平静（这正是 H-08 能长期存活的原因）；
     *   · 「今天新增了几条」的轻量摘要整段消失，且不报错。
     * 所以命名空间 + 工厂 + 实例契约三层都要在开门前核对。
     */
    ["AppNotices", "object",
      "lib/app-notices.js 未加载 —— 首页断链告知与今日摘要整体失效：" +
      "「关掉 App 就不响」这类断链在首页一个字都不显示，界面照常平静；且不报错"],
    ["AppNotices.createAppNotices", "function", "lib/app-notices.js 导出被破坏（告知能力装配入口）"],
    ["AppActionFeedback", "object", "lib/app-action-feedback.js 未加载 —— 保存结果与排程反馈整体失效"],
    ["AppActionFeedback.createAppActionFeedback", "function", "lib/app-action-feedback.js 导出被破坏（反馈控制器装配入口）"],
    ["AppEvents", "object", "lib/app-events.js 未加载 —— 事件路由与深链绑定整体失效"],
    ["AppEvents.createAppEvents", "function", "lib/app-events.js 导出被破坏（事件绑定控制器装配入口）"],
    ["AppTestApi", "object", "lib/app-test-api.js 未加载 —— 测试接口组装模块整体失效"],
    ["AppTestApi.createAppTestApi", "function", "lib/app-test-api.js 导出被破坏（测试接口组装入口）"],
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
  const APP_CAPTURE_INSTANCE_CONTRACT = {
    factory: "AppCapture.createAppCapture",
    instance: ["bind", "session", "markTriggerPicked", "snapshotItemForm", "formDraftSignature", "restoreItemForm", "resetItemSheet", "openCapture", "openEditItem", "formRepeat", "updateRepeatPreview", "findSimilarItems", "renderSimilarHint", "updateParseHint", "renderCaptureSummary", "saveItemFromForm", "openLowConfSheet", "finishSaveAfterLowConf", "setLowConfPick", "beginSaveSubmit", "endSaveSubmit", "setSaveButtonRunning"],
    instanceWhy: "lib/app-capture.js 的 createAppCapture 返回的实例缺少表单 API —— 新建/编辑或会话保护会静默失效",
    factoryThrowWhy: "lib/app-capture.js 的 createAppCapture 抛了异常 —— 表单能力无法装配"
  };
  const APP_VIEWS_INSTANCE_CONTRACT = {
    factory: "AppViews.createAppViews",
    instance: ["priorityRank", "actionButton", "renderItemCard", "openDetail", "setBadge",
      "renderHome", "renderCalendar", "renderArchiveList", "renderFuture", "renderNotes",
      "renderStats", "syncUserMode", "renderMe", "renderPwaStatus", "render",
      "refreshProjectSelects", "projectById", "detailReminderStatusRow", "homeRenderStats", "resetHomeRenderStats"],
    instanceWhy: "lib/app-views.js 的 createAppViews 返回的实例缺少展示 API —— 页面会局部空白或详情点了没反应",
    factoryThrowWhy: "lib/app-views.js 的 createAppViews 抛了异常 —— 展示能力无法装配"
  };
  const APP_MODEL_INSTANCE_CONTRACT = {
    factory: "AppModel.createAppModel",
    instance: ["SCHEMA", "PROJECT_COLORS", "createInitialState", "normalizeItem", "makeItem",
      "resolveDeliveryMode", "bumpRev", "isTerminal", "hasKnownRev", "isDue"],
    instanceWhy: "lib/app-model.js 的 createAppModel 返回的实例缺少模型 API —— 事项默认值或版本判定无法保证",
    factoryThrowWhy: "lib/app-model.js 的 createAppModel 抛了异常 —— 事项模型无法装配"
  };
  const APP_PERSISTENCE_INSTANCE_CONTRACT = {
    factory: "AppPersistence.createAppPersistence",
    instance: ["currentPayload", "writeSnapshot", "runCommit", "saveAsync", "save", "loadAsync", "loadSync", "load",
      "replayPendingSnapshot", "authoritativeWritesAllowed", "authoritySnapshot", "reopen", "committedItemById", "getStorage"],
    instanceWhy: "lib/app-persistence.js 的 createAppPersistence 返回的实例缺少恢复或提交 API —— 数据权威状态无法保证",
    factoryThrowWhy: "lib/app-persistence.js 的 createAppPersistence 抛了异常 —— 持久化能力无法装配"
  };
  const APP_TRANSACTION_INSTANCE_CONTRACT = {
    factory: "AppTransaction.createAppTransaction",
    instance: ["runUserOp", "wrapUserOp", "itemConflictsWithActiveAction", "isItemActionPending",
      "rejectPendingItemCommand", "takeReplayCreatedId", "handleAlarmAction", "alarmEventSeen",
      "inflightDepth", "isFeedbackSuppressed", "shouldSuppressInnerSave"],
    instanceWhy: "lib/app-transaction.js 的 createAppTransaction 返回的实例缺少事务 API —— 操作冲突或原生动作一致性无法保证",
    factoryThrowWhy: "lib/app-transaction.js 的 createAppTransaction 抛了异常 —— 事务协调能力无法装配"
  };
  const APP_ITEMS_INSTANCE_CONTRACT = {
    factory: "AppItems.createAppItems",
    instance: ["promoteDue", "ensureSeriesId", "seriesMembers", "isUnstartedInstance", "spawnNextInstance",
      "advanceSeriesOnArchive", "ackItem", "completeItem", "snoozeItem", "deleteItem",
      "reopenItem", "restoreItem", "resumeDeadlineProtection", "stopRepeat", "applyItemEdit",
      "applyNewItem", "applyProjectRemovalToItems", "applyCompleteUndo", "revertCompleteUndo",
      "undoLastComplete", "undoNewItem", "lastCompleteUndo"],
    instanceWhy: "lib/app-items.js 的 createAppItems 返回的实例缺少事项 API —— 事项状态与周期流转无法保证",
    factoryThrowWhy: "lib/app-items.js 的 createAppItems 抛了异常 —— 事项业务能力无法装配"
  };
  const APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT = {
    factory: "AppNativeCoordinator.createAppNativeCoordinator",
    instance: [
      "refreshNativeScheduleBasis", "applyDeadlineEvents", "applyReminderEvents",
      "markDeadlineDelivered", "applyReminderDelivered", "syncNativeRemindersNow",
      "ensureNativeReminders", "queueNativeReminderSync", "readDeliveryEvidence",
      "applyNativeDeliveryEvidence", "initializeNativeReminders", "getNativeReminderStatus",
      "setNativeReminderStatus", "isNativeReady", "getNativeSyncMetrics",
      "getNativeSyncVersion", "bumpNativeSyncVersion", "deliveryEvidenceReadable",
      "getDeliveryEvidenceState", "isNativeAndroidRuntime", "waitForNativeBridge"
    ],
    instanceWhy: "lib/app-native-coordinator.js 的 createAppNativeCoordinator 返回的实例缺少原生协调 API —— 原生同步、事件台账或通道状态无法保证",
    factoryThrowWhy: "lib/app-native-coordinator.js 的 createAppNativeCoordinator 抛了异常 —— 原生提醒协调能力无法装配"
  };
  const APP_REVIEW_INSTANCE_CONTRACT = {
    factory: "AppReview.createAppReview",
    instance: [
      "ensureReviewSettings", "fallbackTriggerAt", "reviewSessionKey", "nextReviewWindowStart",
      "inReviewWindow", "inReviewHighlight", "isVagueContent", "detectNeedsReview",
      "needsReviewItems", "fireReviewNotification", "maybeReviewSession", "openReviewSession",
      "currentReviewItem", "scheduleNextReviewAlarm", "renderReviewCard", "resolveReviewTrigger",
      "markReviewDone", "reviewConfirm", "reviewSaveEdit", "reviewKeepCurrent",
      "reviewDelete", "snoozeReview", "skipReviewThisTime", "renderReviewEntry",
      "bindReviewControls", "markReviewTriggerPicked", "isFallbackSuppressed"
    ],
    instanceWhy: "lib/app-review.js 的 createAppReview 返回的实例缺少待整理 API —— 会话流转、窗口判定或卡片交互无法保证",
    factoryThrowWhy: "lib/app-review.js 的 createAppReview 抛了异常 —— 待整理能力无法装配"
  };
  const APP_ALERTS_INSTANCE_CONTRACT = {
    factory: "AppAlerts.createAppAlerts",
    instance: [
      "showAlert", "hideAlert", "dismissAlert", "applyAlertDismissal",
      "shouldSkipAlert", "showSystemNotification", "tick", "getAlertItem",
      "clearAlert", "bindAlertControls", "handleNotificationAction",
      "deliveryHandledByCommittedItem", "completeActiveAlarm", "refreshActiveAlarmPanel",
      "startPolling", "stopPolling", "onVisibilityChange"
    ],
    instanceWhy: "lib/app-alerts.js 的 createAppAlerts 返回的实例缺少提醒 API —— 提醒弹条、到期推进或活动闹钟无法保证",
    factoryThrowWhy: "lib/app-alerts.js 的 createAppAlerts 抛了异常 —— 提醒能力无法装配"
  };
  const APP_PLATFORM_INSTANCE_CONTRACT = {
    factory: "AppPlatform.createAppPlatform",
    instance: [
      "systemBridge", "appSettingsPlugin", "isNativeAndroidRuntime", "waitForNativeBridge",
      "getDeferredInstallPrompt", "promptInstall", "bindInstall", "bindNetwork", "registerPwa",
      "updateAppBadge"
    ],
    instanceWhy: "lib/app-platform.js 的 createAppPlatform 返回的实例缺少平台适配 API —— 原生桥访问、PWA 注册或生命周期监听无法保证",
    factoryThrowWhy: "lib/app-platform.js 的 createAppPlatform 抛了异常 —— 平台适配能力无法装配"
  };
  /**
   * 告知实例契约（P3-I-R）。core 真正调用的成员逐项点名；空壳实例上这些全是
   * `undefined`：首页断链告警与今日摘要会在运行期静默消失，启动与静态 `typeof`
   * 都看不出来 —— 而「界面不撒谎」正是这几条存在的理由。
   */
  const APP_NOTICES_INSTANCE_CONTRACT = {
    factory: "AppNotices.createAppNotices",
    instance: ["homeNoticeVerdict", "renderHomeNotice", "maybeDailySummary"],
    instanceWhy: "lib/app-notices.js 的 createAppNotices 返回的实例缺少告知 API —— 首页断链告警与今日摘要会静默消失",
    factoryThrowWhy: "lib/app-notices.js 的 createAppNotices 抛了异常 —— 告知能力无法装配"
  };
  const APP_ACTION_FEEDBACK_INSTANCE_CONTRACT = {
    factory: "AppActionFeedback.createAppActionFeedback",
    instance: [
      "announceSaveOutcome", "settleSaveFeedback", "itemScheduleEvidence",
      "feedbackNativeSnapshot", "feedbackItemSnapshot", "feedbackVerdictFor",
      "runFeedbackAction"
    ],
    instanceWhy: "lib/app-action-feedback.js 的 createAppActionFeedback 返回的实例缺少反馈 API —— 保存结果与排程反馈无法保证",
    factoryThrowWhy: "lib/app-action-feedback.js 的 createAppActionFeedback 抛了异常 —— 反馈能力无法装配"
  };
  const APP_EVENTS_INSTANCE_CONTRACT = {
    factory: "AppEvents.createAppEvents",
    instance: [
      "bind", "isBound", "openSnoozeSheet", "applyShareParams", "handleQueryActions",
      "demoPreviewRows", "openDemoPreview", "seed"
    ],
    instanceWhy: "lib/app-events.js 的 createAppEvents 返回的实例缺少事件路由 API —— 事件绑定、深链、稍后面板或演示无法保证",
    factoryThrowWhy: "lib/app-events.js 的 createAppEvents 抛了异常 —— 事件与路由能力无法装配"
  };
  const APP_TEST_API_INSTANCE_CONTRACT = {
    factory: "AppTestApi.createAppTestApi",
    instance: [
      "assembleTestApi", "getTestApi"
    ],
    instanceWhy: "lib/app-test-api.js 的 createAppTestApi 返回的实例缺少测试接口 API —— 测试钩子无法装配",
    factoryThrowWhy: "lib/app-test-api.js 的 createAppTestApi 抛了异常 —— 测试接口无法装配"
  };

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
    ["AppCapture", "AppCapture"],
    ["AppViews", "AppViews"],
    ["AppModel", "AppModel"],
    ["AppPersistence", "AppPersistence"],
    ["AppTransaction", "AppTransaction"],
    ["AppItems", "AppItems"],
    ["AppNativeCoordinator", "AppNativeCoordinator"],
    ["AppReview", "AppReview"],
    ["AppAlerts", "AppAlerts"],
    ["AppPlatform", "AppPlatform"],
    ["AppNotices", "AppNotices"],
    ["AppActionFeedback", "AppActionFeedback"],
    ["AppEvents", "AppEvents"],
    ["AppTestApi", "AppTestApi"],
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
      getInflightActionDepth: () => inflightDepth()
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
      getNativeReminderStatus: () => getNativeReminderStatus(),
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
      getNativeReminderStatus: () => getNativeReminderStatus(),
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

  /** P2-G2：capture 只拿具名窄命令；事务原语与权威持久化仍归 core。 */
  function captureRuntimeDeps() {
    return {
      query: (sel) => $(sel), queryAll: (sel) => $$(sel), getDocument: () => document,
      getState: () => state,
      openSheet: (id) => openSheet(id), refreshProjectSelects: () => refreshProjectSelects(),
      openDetail: (id) => openDetail(id),
      toLocalInput: (ts) => toLocalInput(ts), parseLocalInput: (value) => parseLocalInput(value),
      parseChineseTime: (text) => parseChineseTime(text), nextRepeatPreview: (rep, from, count) => nextRepeatPreview(rep, from, count),
      fmtDate: (ts) => fmtDate(ts), fmtTime: (ts) => fmtTime(ts), repeatLabel: (rep) => repeatLabel(rep),
      getFeedback: () => FeedbackLib, escapeHtml: (value) => escapeHtml(value), escapeAttr: (value) => escapeAttr(value),
      setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id),
      fallbackTriggerAt: () => fallbackTriggerAt(), hasSpecificTimeWord: (text) => hasSpecificTimeWord(text),
      makeItem: (fields) => makeItem(fields), resolveDeliveryMode: (p) => resolveDeliveryMode(p),
      detectNeedsReview: (x) => detectNeedsReview(x),
      runEditCommand: (it, values) => runUserOp(applyItemEdit, [it, values], { userFacing: true, itemArg: 0, name: "editItem" }),
      runNewCommand: (item) => runUserOp(applyNewItem, [item.id, item]),
      rollbackNewItem: (id) => { state.items = state.items.filter(x => x.id !== id); },
      save: () => save(), render: () => render(), closeSheet: (id) => closeSheet(id),
      announceSaveOutcome: (id, opts) => announceSaveOutcome(id, opts),
      noteFirstRemindSaved: (item) => noteFirstRemindSaved(item),
      queueNativeReminderSync: (reason) => queueNativeReminderSync(reason),
      toast: (msg, label, fn, second, opts) => toast(msg, label, fn, second, opts),
      getAi: () => ai
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
      isTerminal: (it) => isTerminal(it),
      updateAppBadge: (n) => updateAppBadge(n), fmtTime: (ts) => fmtTime(ts), fmtDate: (ts) => fmtDate(ts),
      relDue: (ts) => relDue(ts), repeatLabel: (r) => repeatLabel(r), dayLabel: (ts) => dayLabel(ts),
      escapeHtml: (v) => escapeHtml(v), escapeAttr: (v) => escapeAttr(v), safeExternalHref: (u) => safeExternalHref(u),
      sameDay: (a, b) => sameDay(a, b), startOfDay: (d) => startOfDay(d), pad2: (n) => pad2(n),
      getNativeReminderStatus: () => getNativeReminderStatus(),
      getNativeReminders: () => NativeReminders, getSwReg: () => null, isNativeAndroidRuntime: () => isNativeAndroidRuntime(),
      evidenceStatusFor: (it, ctx) => (EvidenceLib ? EvidenceLib.evidenceStatusFor(it, ctx) : null),
      deliveryEvidenceReadable: () => deliveryEvidenceReadable(),
      itemScheduleEvidence: (it) => itemScheduleEvidence(it)
    };
  }

  function reviewRuntimeDeps() {
    return {
      getState: () => state,
      getItems: () => state.items,
      getSettings: () => state.settings,
      save: (opts) => save(opts),
      render: () => render(),
      renderMe: () => renderMe(),
      toast: (msg, label, fn, second, opts) => toast(msg, label, fn, second, opts),
      openSheet: (id) => openSheet(id),
      closeSheet: (id) => closeSheet(id),
      fmtTime: (ts) => fmtTime(ts),
      fmtDate: (ts) => fmtDate(ts),
      toLocalInput: (ts) => toLocalInput(ts),
      parseLocalInput: (val) => parseLocalInput(val),
      escapeHtml: (str) => escapeHtml(str),
      deleteItem: (id) => deleteItem(id),
      bumpRev: (it) => bumpRev(it),
      wrapUserOp: (fn, opts) => wrapUserOp(fn, opts),
      queueNativeReminderSync: (reason) => queueNativeReminderSync(reason),
      inQuietHours: (d) => inQuietHours(d),
      quietEnd: (d) => quietEnd(d),
      addDays: (d, n) => addDays(d, n),
      systemBridge: () => systemBridge(),
      showSystemNotification: (opts) => showSystemNotification(opts),
      isNativeAndroid: () => (NativeReminders && typeof NativeReminders.isNativeAndroid === "function" ? NativeReminders.isNativeAndroid() : false),
      writeIfChanged: (el, html) => writeIfChanged(el, html),
      query: (sel, scope) => $(sel, scope),
      queryAll: (sel, scope) => $$(sel, scope),
      getInitialReviewSettings: () => (appModel ? appModel.createInitialState().settings.review : null)
    };
  }

  function alertsRuntimeDeps() {
    return {
      getState: () => state,
      save: (opts) => save(opts),
      bumpRev: (it) => bumpRev(it),
      runUserOp: (fn, args, opts) => runUserOp(fn, args, opts),
      committedItemById: (id) => (appPersistence ? appPersistence.committedItemById(id) : null),
      systemBridge: () => systemBridge(),
      handleAlarmAction: (data) => handleAlarmAction(data),
      alarmEventSeen: (id) => alarmEventSeen(id),
      promoteDue: () => promoteDue(),
      maybeReviewSession: () => maybeReviewSession(),
      priorityRank: (p) => priorityRank(p),
      shouldRealert: (it, now, opts) => Lib.shouldRealert(it, now, opts),
      markReminded: (it, now) => Lib.markReminded(it, now),
      hasKnownRev: (rev) => hasKnownRev(rev),
      isTerminal: (it) => isTerminal(it),
      toast: (msg, label, fn, second, opts) => toast(msg, label, fn, second, opts),
      escapeHtml: (str) => escapeHtml(str),
      updateAppBadge: () => updateAppBadge(),
      renderHome: () => renderHome(),
      renderStats: () => renderStats(),
      query: (sel, scope) => $(sel, scope),
      queryAll: (sel, scope) => $$(sel, scope),
      ackItem: (id, silent) => ackItem(id, silent),
      completeItem: (id) => completeItem(id),
      openSnoozeSheet: (id) => openSnoozeSheet(id),
      snoozeItem: (id, ts) => snoozeItem(id, ts),
      openDetail: (id) => openDetail(id),
      openReviewSession: () => openReviewSession(),
      isNativeAndroid: () => (NativeReminders && typeof NativeReminders.isNativeAndroid === "function" ? NativeReminders.isNativeAndroid() : false),
      shouldSuppressInnerSave: () => shouldSuppressInnerSave()
    };
  }

  function platformRuntimeDeps() {
    return {
      getCapacitor: () => (typeof window !== "undefined" ? window.Capacitor : null),
      getNativeReminders: () => NativeReminders,
      getServiceWorker: () => (typeof navigator !== "undefined" ? navigator.serviceWorker : null),
      getWindow: () => (typeof window !== "undefined" ? window : null),
      getDocument: () => (typeof document !== "undefined" ? document : null),
      getState: () => state,
      query: (sel) => $(sel),
      toast: function () { return toast.apply(null, arguments); },
      renderPwaStatus: () => renderPwaStatus(),
      onNotificationAction: (data) => {
        if (appAlerts) appAlerts.handleNotificationAction(data);
      },
      noteAppVisibility: (visible) => {
        if (backup && typeof backup.noteExportAppVisibility === "function") {
          backup.noteExportAppVisibility(visible);
        }
      },
      onForeground: () => {
        if (!nativeReady) queueNativeReminderSync();
        promoteDue();
        if (appAlerts) appAlerts.onVisibilityChange();
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id)
    };
  }

  /**
   * P3-I-R：告知实例（首页告知条 + 启动轻摘要）的注入依赖。
   *
   * 依赖清单刻意保持「取值/动作」两件事，不把 `state` 直接交出去：
   *   · `getStatus` 取的是**当前**原生状态快照（每次调用都重新读，不能钉死）；
   *   · `getState` 给的是应用状态本身（判定设置与事项计数都要读它）；
   *   · `writeIfChanged` 是**共享的单写入者写入器**（`#homeNotice` / `#homeSetup` /
   *     `#homeReview` 三处共用），所以它留在入口作为唯一实现，由这里注入 —— 不是
   *     搬进新模块再注入回去，那只是把同一份共享依赖换个存放位置。
   */
  function noticesRuntimeDeps() {
    return {
      getStatus: () => nativeReminderStatus,
      getState: () => state,
      isNativeAndroidRuntime: () => isNativeAndroidRuntime(),
      query: (sel) => $(sel),
      escapeHtml: (s) => escapeHtml(s),
      writeIfChanged: (el, html) => writeIfChanged(el, html),
      openSheet: (id) => openSheet(id),
      refreshNotifyLab: () => refreshNotifyLab(),
      render: () => render(),
      save: () => save(),
      toast: (msg, label, fn, second, opts) => toast(msg, label, fn, second, opts),
      showSystemNotification: (opts) => showSystemNotification(opts),
      startOfDay: (d) => startOfDay(d)
    };
  }

  function feedbackActionSpec(kind, opts) {
    const feedbackApi = FeedbackLib;
    return feedbackApi ? feedbackApi.actionSpec(kind, opts) : null;
  }

  function actionFeedbackRuntimeDeps() {
    return {
      getState: () => state,
      getNativeReminderStatus: () => nativeReminderStatus,
      isNativeReady: () => !!nativeReady,
      isNativeAndroidRuntime: () => isNativeAndroidRuntime(),
      getFeedbackLib: () => FeedbackLib,
      getEvidenceLib: () => EvidenceLib,
      getNativeReminders: () => NativeReminders,
      toast: function () { return toast.apply(null, arguments); },
      undoNewItem: (id, rev) => undoNewItem(id, rev),
      openDetail: (id) => openDetail(id),
      openSheet: (name) => openSheet(name),
      openReviewSession: () => openReviewSession(),
      refreshNotifyLab: () => refreshNotifyLab(),
      restoreItemForm: (draft) => restoreItemForm(draft),
      queueNativeReminderSync: (src) => queueNativeReminderSync(src)
    };
  }

  function eventsRuntimeDeps() {
    return {
      getState: () => state,
      render: () => render(),
      renderHome: () => renderHome(),
      renderFuture: () => renderFuture(),
      renderMe: () => renderMe(),
      openCapture: (opts) => openCapture(opts),
      closeSheet: (name) => closeSheet(name),
      closeAllSheets: () => closeAllSheets(),
      openSheet: (name) => openSheet(name),
      openDetail: (id) => openDetail(id),
      openEditItem: (id) => openEditItem(id),
      save: (opts) => save(opts),
      saveItemFromForm: () => saveItemFromForm(),
      setLowConfPick: (ts, el) => setLowConfPick(ts, el),
      finishSaveAfterLowConf: (ts) => finishSaveAfterLowConf(ts),
      confirmDialog: (msg, title) => confirmDialog(msg, title),
      toast: function () { return toast.apply(null, arguments); },
      inflightDepth: () => inflightDepth(),
      ackItem: (id) => ackItem(id),
      snoozeItem: (id, when, basis) => snoozeItem(id, when, basis),
      completeItem: (id) => completeItem(id),
      deleteItem: (id) => deleteItem(id),
      reopenItem: (id) => reopenItem(id),
      restoreItem: (id) => restoreItem(id),
      stopRepeat: (id) => stopRepeat(id),
      resumeDeadlineProtection: (id) => resumeDeadlineProtection(id),
      isItemActionPending: (id) => isItemActionPending(id),
      rejectPendingItemCommand: () => rejectPendingItemCommand(),
      setUserMode: (mode) => setUserMode(mode),
      setNativeReminderStatus: (status) => setNativeReminderStatus(status),
      queueNativeReminderSync: (src) => queueNativeReminderSync(src),
      isNativeAndroidRuntime: () => isNativeAndroidRuntime(),
      waitForNativeBridge: (ms) => waitForNativeBridge(ms),
      openSystemSetting: (kind) => openSystemSetting(kind),
      openReviewSession: () => openReviewSession(),
      handleAlarmAction: (data) => handleAlarmAction(data),
      getDiagnostics: () => diagnostics,
      getAppContent: () => appContent,
      getAppCapture: () => appCapture,
      getAppAlerts: () => appAlerts,
      getAi: () => ai,
      getBackup: () => backup,
      getAppModel: () => appModel,
      runAiOnCapture: (mode) => runAiOnCapture(mode),
      saveAiSettings: () => saveAiSettings(),
      testAiConnection: () => testAiConnection(),
      exportData: () => exportData(),
      importDataFile: (file) => importDataFile(file),
      bindDiagnostics: () => bindDiagnostics(),
      bindAppContent: () => bindAppContent(),
      bindSetupReviewControls: () => bindSetupReviewControls(),
      toLocalInput: (ts) => toLocalInput(ts),
      parseLocalInput: (val) => parseLocalInput(val),
      nextWeekend: (d) => nextWeekend(d),
      addDays: (d, n) => addDays(d, n),
      applyClock: (d, t) => applyClock(d, t),
      endOfDay: (d) => endOfDay(d),
      pad: (n) => pad(n),
      uid: () => uid(),
      escapeHtml: (s) => escapeHtml(s),
      hideAlert: () => hideAlert(),
      makeItem: (opts) => makeItem(opts),
      getNativeReminders: () => NativeReminders
    };
  }

  function testApiRuntimeDeps() {
    return {
      getState: () => state,
      get state() { return state || Object.freeze({ items: [] }); },
      get items() { return (state && state.items) || []; },
      getDeliveryEvidenceState: (it) => getDeliveryEvidenceState(it),
      getNativeSyncMetrics: () => getNativeSyncMetrics(),
      markReviewTriggerPicked: (v) => markReviewTriggerPicked(v),
      bindAlertControls: () => bindAlertControls(),
      clearAlert: () => clearAlert(),
      getAppItems: () => appItems,
      getAppTransaction: () => appTransaction,
      getAppNativeCoordinator: () => appNativeCoordinator,
      getAppPlatform: () => appPlatform,
      getAppAlerts: () => appAlerts,
      getAppViews: () => appViews,
      getAppReview: () => appReview,
      getAppContent: () => appContent,
      getAppCapture: () => appCapture,
      getAppSetup: () => appSetup,
      getDiagnostics: () => diagnostics,
      getAppActionFeedback: () => appActionFeedback,
      getAppEvents: () => appEvents,
      getAppNotices: () => appNotices,
      getAppTestApi: () => appTestApi,
      getAppPersistence: () => appPersistence,
      getAi: () => ai,
      getBackup: () => backup,
      getParseChineseTime: () => parseChineseTime,
      getNextRepeatTrigger: () => nextRepeatTrigger,
      getDatePrimitives: () => DatePrimitives,
      getNthWeekdayInMonth: () => nthWeekdayInMonth,
      getLastDayOfMonth: () => lastDayOfMonth,
      getRepeatLabel: () => repeatLabel,
      getHasSpecificTimeWord: () => hasSpecificTimeWord,
      getStartOfDay: () => startOfDay,
      getAddDays: () => addDays,
      getSameDay: () => sameDay,
      getApplyClock: () => applyClock,
      makeItem: (opts) => makeItem(opts),
      findSimilarItems: (title, id) => findSimilarItems(title, id),
      isDue: (it) => isDue(it),
      inQuietHours: (d, s, e) => inQuietHours(d, s, e),
      quietEnd: (d, s, e) => quietEnd(d, s, e),
      promoteDue: function () { return promoteDue.apply(null, arguments); },
      ackItem: (id) => ackItem(id),
      completeItem: (id) => completeItem(id),
      snoozeItem: (id, when, basis) => snoozeItem(id, when, basis),
      reopenItem: (id) => reopenItem(id),
      restoreItem: (id) => restoreItem(id),
      deleteItem: (id) => deleteItem(id),
      seed: (which) => seed(which),
      fallbackTriggerAt: (it, created) => fallbackTriggerAt(it, created),
      resolveDeliveryMode: (it) => resolveDeliveryMode(it),
      ensureReviewSettings: (s) => ensureReviewSettings(s),
      inReviewHighlight: (it, now) => inReviewHighlight(it, now),
      renderHome: function () { return renderHome.apply(null, arguments); },
      renderReviewEntry: function () { return renderReviewEntry.apply(null, arguments); },
      renderReviewCard: function () { return renderReviewCard.apply(null, arguments); },
      openReviewSession: function () { return openReviewSession.apply(null, arguments); },
      maybeReviewSession: function () { return maybeReviewSession.apply(null, arguments); },
      needsReviewItems: function () { return needsReviewItems.apply(null, arguments); },
      detectNeedsReview: (it) => detectNeedsReview(it),
      reviewConfirm: (it, opts) => reviewConfirm(it, opts),
      reviewSaveEdit: (it, form) => reviewSaveEdit(it, form),
      reviewKeepCurrent: (it) => reviewKeepCurrent(it),
      resolveReviewTrigger: (it, mode) => resolveReviewTrigger(it, mode),
      markReviewDone: (it, extra) => markReviewDone(it, extra),
      stopRepeat: (id) => stopRepeat(id),
      resumeDeadlineProtection: (id) => resumeDeadlineProtection(id),
      applyDeadlineEvents: function () { return applyDeadlineEvents.apply(null, arguments); },
      markDeadlineDelivered: function () { return markDeadlineDelivered.apply(null, arguments); },
      applyReminderEvents: function () { return applyReminderEvents.apply(null, arguments); },
      buildLegacyBackupPayload: () => buildLegacyBackupPayload(),
      getStorage: () => getPersistenceStorage(),
      replayPendingSnapshot: () => replayPendingSnapshot(),
      showAlert: (it) => showAlert(it),
      hideAlert: () => hideAlert(),
      dismissAlert: () => dismissAlert(),
      describeAlarmDelivery: (it) => describeAlarmDelivery(it),
      homeNoticeVerdict,
      renderHomeNotice,
      setNativeReminderStatus: (status) => setNativeReminderStatus(status),
      handleAlarmAction: (data) => handleAlarmAction(data),
      completeActiveAlarm: (alarm) => completeActiveAlarm(alarm),
      deliveryHandledByCommittedItem: (alarm, item) => deliveryHandledByCommittedItem(alarm, item),
      alarmEventSeen: (id) => alarmEventSeen(id),
      getNativeReminderStatus: () => getNativeReminderStatus(),
      getNativeSyncVersion: () => getNativeSyncVersion(),
      refreshNativeScheduleBasis: (it) => refreshNativeScheduleBasis(it),
      syncNativeRemindersNow: (src) => syncNativeRemindersNow(src),
      queueNativeReminderSync: (src) => queueNativeReminderSync(src),
      runUserOp: (name, op, args, opts) => runUserOp(name, op, args, opts),
      wrapUserOp: (fn, opts) => wrapUserOp(fn, opts),
      itemConflictsWithActiveAction: (it) => itemConflictsWithActiveAction(it),
      isItemActionPending: (id) => isItemActionPending(id),
      rejectPendingItemCommand: () => rejectPendingItemCommand(),
      takeReplayCreatedId: (oldId) => takeReplayCreatedId(oldId),
      inflightDepth: () => inflightDepth(),
      isFeedbackSuppressed: () => isFeedbackSuppressed(),
      shouldSuppressInnerSave: () => shouldSuppressInnerSave(),
      ready: () => readyPromise || Promise.resolve(true),
      handleNativeNotificationAction: (evt) => handleNativeNotificationAction(evt),
      saveItemFromForm: () => saveItemFromForm(),
      openDemoPreview: () => openDemoPreview(),
      demoPreviewRows: () => demoPreviewRows(),
      undoNewItem: (id, rev) => undoNewItem(id, rev),
      undoLastComplete: () => undoLastComplete(),
      lastCompleteUndo: () => lastCompleteUndo(),
      startSetupTestRun: () => startSetupTestRun(),
      stopSetupTestRun: () => stopSetupTestRun(),
      setupEvidenceHtml: (s) => setupEvidenceHtml(s),
      setupStepsContext: () => setupStepsContext(),
      readDeliveryEvidence: (it) => readDeliveryEvidence(it),
      applyNativeDeliveryEvidence: (it, ev) => applyNativeDeliveryEvidence(it, ev),
      applyReminderDelivered: (it, k) => applyReminderDelivered(it, k),
      detailReminderStatusRow: (it) => detailReminderStatusRow(it),
      itemScheduleEvidence: (it) => itemScheduleEvidence(it),
      deliveryEvidenceReadable: (it) => deliveryEvidenceReadable(it),
      openCapture: (opts) => openCapture(opts),
      openEditItem: (id) => openEditItem(id),
      resetItemSheet: () => resetItemSheet(),
      closeAllSheets: () => closeAllSheets(),
      setUserMode: (mode) => setUserMode(mode),
      syncUserMode: () => syncUserMode(),
      save: (opts) => save(opts),
      saveAsync: (opts) => saveAsync(opts),
      load: () => load(),
      loadAsync: () => loadAsync(),
      renderMarkdown: (s) => renderMarkdown(s),
      uid: () => uid(),
      assertRuntimeDependencies: (roots) => assertRuntimeDependencies(roots),
      renderStartupFailure: (problems) => renderStartupFailure(problems),
      REQUIRED_RUNTIME_EXPORTS: REQUIRED_RUNTIME_EXPORTS,
      collectRuntimeBindings: () => collectRuntimeBindings(),
      bindRuntime: () => bindRuntime(),
      RUNTIME_BINDING_PATHS: RUNTIME_BINDING_PATHS,
      APP_UI_INSTANCE_CONTRACT: APP_UI_INSTANCE_CONTRACT,
      APP_AI_INSTANCE_CONTRACT: APP_AI_INSTANCE_CONTRACT,
      APP_BACKUP_INSTANCE_CONTRACT: APP_BACKUP_INSTANCE_CONTRACT,
      APP_DIAGNOSTICS_INSTANCE_CONTRACT: APP_DIAGNOSTICS_INSTANCE_CONTRACT,
      APP_CAPTURE_INSTANCE_CONTRACT: APP_CAPTURE_INSTANCE_CONTRACT,
      APP_VIEWS_INSTANCE_CONTRACT: APP_VIEWS_INSTANCE_CONTRACT,
      APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT: APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT,
      APP_REVIEW_INSTANCE_CONTRACT: APP_REVIEW_INSTANCE_CONTRACT,
      APP_ALERTS_INSTANCE_CONTRACT: APP_ALERTS_INSTANCE_CONTRACT,
      APP_PLATFORM_INSTANCE_CONTRACT: APP_PLATFORM_INSTANCE_CONTRACT,
      APP_ACTION_FEEDBACK_INSTANCE_CONTRACT: APP_ACTION_FEEDBACK_INSTANCE_CONTRACT,
      APP_EVENTS_INSTANCE_CONTRACT: APP_EVENTS_INSTANCE_CONTRACT,
      APP_NOTICES_INSTANCE_CONTRACT: APP_NOTICES_INSTANCE_CONTRACT,
      APP_TEST_API_INSTANCE_CONTRACT: APP_TEST_API_INSTANCE_CONTRACT,
      startApp: () => startApp(),
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
        feedback: !!(FeedbackLib && typeof FeedbackLib === "object"),
        feedbackIsCurrent: FeedbackLib === Lib.Feedback,
        evidence: !!(EvidenceLib && typeof EvidenceLib === "object"),
        evidenceIsCurrent: EvidenceLib === Lib.DeliveryEvidence,
        native: !!(NativeReminders && typeof NativeReminders === "object"),
        nativeIsCurrent: NativeReminders ===
          (typeof AttentionNativeReminders !== "undefined" && AttentionNativeReminders)
      }),
      startupFailure: () => (lastStartupFailure ? lastStartupFailure.slice() : null),
      isStateRecoveryPanelShown: () => stateRecoveryPanelShown,
      retryRestore: () => retryRestore(),
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
        hrefHttps: safeExternalHref ? safeExternalHref("https://example.com/x") : "MISSING",
        hrefJs: safeExternalHref ? safeExternalHref("javascript:alert(1)") : "MISSING",
        hrefTab: safeExternalHref ? safeExternalHref("ja\tvascript:alert(1)") : "MISSING"
      }),
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
          mergedTitle: merged.text,
          mergedPriority: merged.priority,
          mergedRepeatEvery: merged.repeat,
          mergedTags: merged.tags,
          mergedNote: merged.note,
          baseUntouched: base.text === "orig" && base.tags === "home" && base.note === "",
          normalizePriority: AppAi.normalizeAiResult({ priority: "super-urgent" }, "").priority,
          normalizeRepeat: AppAi.normalizeAiResult({ repeat: { every: "yearly" } }, "").repeat,
          extract: JSON.stringify(AppAi.extractJsonObject("```json\n{\"a\":1}\n```"))
        };
      }
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
      instance = factory({ isFeedbackSuppressed: () => (appTransaction ? appTransaction.isFeedbackSuppressed() : false) });
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

    let captureInstance = null;
    const captureFactory = readRuntimePath(roots, APP_CAPTURE_INSTANCE_CONTRACT.factory);
    try { captureInstance = captureFactory(captureRuntimeDeps()); }
    catch (error) {
      problems.push({ path: APP_CAPTURE_INSTANCE_CONTRACT.factory + "()", expected: "instance",
        actual: "threw:" + (error && error.message ? error.message : String(error)),
        why: APP_CAPTURE_INSTANCE_CONTRACT.factoryThrowWhy });
      return { problems: problems, bindings: null };
    }
    APP_CAPTURE_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (captureInstance == null || typeof captureInstance[name] !== "function") {
        problems.push({ path: "AppCapture." + name, expected: "function",
          actual: captureInstance == null ? describeGot(captureInstance) : describeGot(captureInstance[name]),
          why: APP_CAPTURE_INSTANCE_CONTRACT.instanceWhy });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-A：模型实例在同一闸门中创建并验证；工厂求值只接收 live callbacks，不能读取尚未建立的 state。
    let modelInstance = null;
    const modelFactory = readRuntimePath(roots, APP_MODEL_INSTANCE_CONTRACT.factory);
    try {
      modelInstance = modelFactory({
        uid: () => readRuntimePath(roots, "UiFormat.uid")(),
        now: () => Date.now(),
        getDefaultDeliveryMode: () => state && state.settings
          ? state.settings.defaultDeliveryMode : "notification",
        migrateNativeItem: item => {
          const migrate = readRuntimePath(roots, "AttentionNativeReminders.migrateItem");
          return migrate(item);
        }
      });
    } catch (error) {
      problems.push({ path: APP_MODEL_INSTANCE_CONTRACT.factory + "()", expected: "instance",
        actual: "threw:" + (error && error.message ? error.message : String(error)),
        why: APP_MODEL_INSTANCE_CONTRACT.factoryThrowWhy });
      return { problems: problems, bindings: null };
    }
    APP_MODEL_INSTANCE_CONTRACT.instance.forEach(function (name) {
      const expected = name === "SCHEMA" ? "number" : (name === "PROJECT_COLORS" ? "array" : "function");
      const got = modelInstance == null ? undefined : modelInstance[name];
      if (name === "SCHEMA" ? typeof got !== "number" : name === "PROJECT_COLORS" ? !Array.isArray(got) : typeof got !== "function") {
        problems.push({ path: "AppModel." + name, expected: expected,
          actual: modelInstance == null ? describeGot(modelInstance) : describeGot(got),
          why: APP_MODEL_INSTANCE_CONTRACT.instanceWhy });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-B：持久化实例与模型一起在装配闸门中创建；此处不调用 getStorage，故检查失败不打开数据库。
    let persistenceInstance = null;
    const persistenceFactory = readRuntimePath(roots, APP_PERSISTENCE_INSTANCE_CONTRACT.factory);
    try {
      persistenceInstance = appPersistence;
      if (!persistenceInstance) {
      let persistenceStorage = null;
      persistenceInstance = persistenceFactory({
        key: KEY,
        getSchema: () => SCHEMA,
        getItems: () => state.items,
        getNotes: () => state.notes,
        getProjects: () => state.projects,
        getSettings: () => state.settings,
        applyRecoveredState: applyParsedState,
        getStorage: () => {
          if (!persistenceStorage) persistenceStorage = readRuntimePath(roots, "createStorage")({ lsKey: KEY });
          return persistenceStorage;
        },
        hasIdb: () => readRuntimePath(roots, "hasIdb")(),
        readLocal: key => localStorage.getItem(key),
        writeLocal: (key, value) => localStorage.setItem(key, value),
        removeLocal: key => localStorage.removeItem(key),
        now: () => Date.now(),
        onCommitted: options => {
          if (!(options && options.deferNativeSync)) {
            bumpNativeSyncVersion();
            queueNativeReminderSync("save");
          }
        },
        onSaveFailure: error => {
          if (error && error.code === "state-authority-blocked") toast("数据尚未恢复 · 已阻止写入，请先重试恢复");
          else toast("保存失败 · 修改仍保留在本机内存，下一次保存会重试");
          console.error("State save failed:", error && error.message ? error.message : error);
        }
      });
      }
    } catch (error) {
      problems.push({ path: APP_PERSISTENCE_INSTANCE_CONTRACT.factory + "()", expected: "instance",
        actual: "threw:" + (error && error.message ? error.message : String(error)),
        why: APP_PERSISTENCE_INSTANCE_CONTRACT.factoryThrowWhy });
      return { problems: problems, bindings: null };
    }
    APP_PERSISTENCE_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (persistenceInstance == null || typeof persistenceInstance[name] !== "function") {
        problems.push({ path: "AppPersistence." + name, expected: "function",
          actual: persistenceInstance == null ? describeGot(persistenceInstance) : describeGot(persistenceInstance[name]),
          why: APP_PERSISTENCE_INSTANCE_CONTRACT.instanceWhy });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-C：事务协调实例在持久化实例之后装配，检查失败不产生任何副作用。
    let transactionInstance = null;
    const transactionFactory = readRuntimePath(roots, APP_TRANSACTION_INSTANCE_CONTRACT.factory);
    try {
      transactionInstance = transactionFactory({
        getItems: () => state.items,
        setItems: items => { state.items = items; },
        getNotes: () => state.notes,
        setNotes: notes => { state.notes = notes; },
        getProjects: () => state.projects,
        setProjects: projects => { state.projects = projects; },
        getSettings: () => state.settings,
        setSettings: settings => { state.settings = settings; },
        currentPayload: () => (appPersistence ? appPersistence.currentPayload() : (persistenceInstance ? persistenceInstance.currentPayload() : currentPayload())),
        runCommit: (job, args) => (appPersistence ? appPersistence.runCommit(job, args) : persistenceInstance.runCommit(job, args)),
        writeSnapshot: (snapshot, options) => (appPersistence ? appPersistence.writeSnapshot(snapshot, options) : persistenceInstance.writeSnapshot(snapshot, options)),
        isTerminal: it => isTerminal(it),
        hasKnownRev: rev => hasKnownRev(rev),
        ackItem: (itemId, silent) => ackItem(itemId, silent),
        snoozeItem: (itemId, until) => snoozeItem(itemId, until),
        completeItem: itemId => completeItem(itemId),
        queueNativeReminderSync: () => queueNativeReminderSync(),
        render: () => render(),
        toast: function () { return toast.apply(null, arguments); },
        openDetail: itemId => openDetail(itemId),
        hideAlert: () => hideAlert(),
        fmtTime: ts => fmtTime(ts)
      });
    } catch (error) {
      problems.push({ path: APP_TRANSACTION_INSTANCE_CONTRACT.factory + "()", expected: "instance",
        actual: "threw:" + (error && error.message ? error.message : String(error)),
        why: APP_TRANSACTION_INSTANCE_CONTRACT.factoryThrowWhy });
      return { problems: problems, bindings: null };
    }
    APP_TRANSACTION_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (transactionInstance == null || typeof transactionInstance[name] !== "function") {
        problems.push({ path: "AppTransaction." + name, expected: "function",
          actual: transactionInstance == null ? describeGot(transactionInstance) : describeGot(transactionInstance[name]),
          why: APP_TRANSACTION_INSTANCE_CONTRACT.instanceWhy });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-D：事项业务与周期推进实例在事务实例之后装配，检查失败不产生任何副作用。
    let itemsInstance = null;
    const itemsFactory = readRuntimePath(roots, APP_ITEMS_INSTANCE_CONTRACT.factory);
    if (appItems != null && AppItems != null && itemsFactory === AppItems.createAppItems) {
      itemsInstance = appItems;
    } else {
      try {
        itemsInstance = itemsFactory({
          getItems: () => state.items,
          setItems: items => { state.items = items; },
          getSettings: () => state.settings,
          save: () => save(),
          render: () => render(),
          toast: function () { return toast.apply(null, arguments); },
          fmtTime: ts => fmtTime(ts),
          toLocalInput: ts => toLocalInput(ts),
          uid: () => uid(),
          bumpRev: it => bumpRev(it),
          isTerminal: it => isTerminal(it),
          normalizeItem: it => normalizeItem(it),
          makeItem: fields => makeItem(fields),
          resolveDeliveryMode: p => resolveDeliveryMode(p),
          nextRepeatTrigger: (it, fromTs) => nextRepeatTrigger(it, fromTs),
          takeReplayCreatedId: () => takeReplayCreatedId(),
          isFeedbackSuppressed: () => isFeedbackSuppressed(),
          inflightDepth: () => inflightDepth(),
          runUserOp: function () {
            return runUserOp.apply(null, arguments);
          },
          wrapUserOp: function (fn, opts) { return wrapUserOp(fn, opts); },
          openSnoozeSheet: id => openSnoozeSheet(id),
          openRestoreSnooze: id => { state.ui.snoozeId = id; openSheet("sheetSnooze"); },
          goToArchive: () => { state.ui.tab = "future"; state.ui.futureSeg = "archive"; render(); },
          markUndoNativeCheckPending: () => { undoNativeCheckPending = true; },
          queueNativeReminderSync: reason => queueNativeReminderSync(reason),
          isFallbackSuppressed: it => isFallbackSuppressed(it),
          inQuietHours: d => inQuietHours(d),
          quietEnd: d => quietEnd(d),
          deadlineStageKeyOf: (deadlineAt, now) => deadlineStageKeyOf(deadlineAt, now),
          applyWindowTrigger: (it, now) => Lib.applyWindowTrigger(it, now),
          actionSpec: (kind, opts) => {
            const spec = FeedbackLib ? FeedbackLib.actionSpec("ack") : null;
            return kind === "ack" ? spec : feedbackActionSpec(kind, opts);
          },
          getUndoWindowMs: () => ((FeedbackLib && FeedbackLib.UNDO_WINDOW_MS) || 8000),
          suppressPastReminderReplay: (it, now) => (NativeReminders && NativeReminders.suppressPastReminderReplay ? NativeReminders.suppressPastReminderReplay(it, now) : null)
        });
      } catch (error) {
        problems.push({
          path: APP_ITEMS_INSTANCE_CONTRACT.factory + "()",
          expected: "instance",
          actual: "threw:" + (error && error.message ? error.message : String(error)),
          why: APP_ITEMS_INSTANCE_CONTRACT.factoryThrowWhy
        });
        return { problems: problems, bindings: null };
      }
    }
    APP_ITEMS_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (itemsInstance == null || typeof itemsInstance[name] !== "function") {
        problems.push({
          path: "AppItems." + name,
          expected: "function",
          actual: itemsInstance == null ? describeGot(itemsInstance) : describeGot(itemsInstance[name]),
          why: APP_ITEMS_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-E：原生提醒协调与事件台账在事项实例之后装配，检查失败不产生任何副作用。
    let coordinatorInstance = null;
    const coordinatorFactory = readRuntimePath(roots, APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT.factory);
    if (appNativeCoordinator != null && AppNativeCoordinator != null && coordinatorFactory === AppNativeCoordinator.createAppNativeCoordinator) {
      coordinatorInstance = appNativeCoordinator;
    } else {
      try {
        coordinatorInstance = coordinatorFactory({
          getItems: () => state.items,
          getSettings: () => state.settings,
          authoritativeWritesAllowed: () => authoritativeWritesAllowed(),
          save: opts => save(opts),
          runUserOp: function () {
            return runUserOp.apply(null, arguments);
          },
          getNativeReminders: () => NativeReminders,
          getEvidenceLib: () => EvidenceLib,
          onStatusChange: (status, origin) => {
            nativeReminderStatus = status;
            nativeReady = appNativeCoordinator ? appNativeCoordinator.isNativeReady() : (status && status.native !== undefined ? status.native : false);
            if (state && state.ui && state.ui.tab === "me") renderPwaStatus();
            renderHomeNotice();
            // 设置入口依赖原生能力状态：状态读回或变化后重绘（未读回前入口不渲染）
            if (state && state.ui && state.ui.tab === "home") renderSetupEntry();
            if (origin === "reconcile") {
              if (undoNativeCheckPending) {
                undoNativeCheckPending = false;
                if (nativeReminderStatus.reliability === "error") {
                  toast("撤销已生效，但系统里的旧提醒可能还没取消 · 点这里重试", "重试",
                    () => { undoNativeCheckPending = true; queueNativeReminderSync("undo-retry"); });
                }
              }
              if (appActionFeedback && typeof appActionFeedback.getFeedbackWaiters === "function" && appActionFeedback.getFeedbackWaiters().length) {
                Promise.resolve().then(() => {
                  if (appActionFeedback && typeof appActionFeedback.settleSaveFeedback === "function") {
                    appActionFeedback.settleSaveFeedback();
                  }
                });
              }
            }
            try {
              if (appViews && appViews.updateSetupEntry) appViews.updateSetupEntry();
            } catch (_) {}
            try {
              if (appDiagnostics && appDiagnostics.refreshNotifyLab) appDiagnostics.refreshNotifyLab();
            } catch (_) {}
          },
          onNotificationAction: (action, notif) => handleNativeNotificationAction(action, notif),
          handleAlarmAction: (event) => handleAlarmAction(event),
          needsReviewCount: () => needsReviewItems().length,
          ensureReviewSettings: () => ensureReviewSettings(),
          promoteDue: () => promoteDue(),
          refreshActiveAlarmPanel: force => refreshActiveAlarmPanel(force),
          renderMe: () => renderMe(),
          isNativeAndroidRuntime: () => isNativeAndroidRuntime(),
          waitForNativeBridge: (timeoutMs) => waitForNativeBridge(timeoutMs),
          getCapacitor: () => (typeof window !== "undefined" ? window.Capacitor : null),
          setTimeout: (fn, ms) => setTimeout(fn, ms),
          clearTimeout: id => clearTimeout(id)
        });
      } catch (error) {
        problems.push({
          path: APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT.factory + "()",
          expected: "instance",
          actual: "threw:" + (error && error.message ? error.message : String(error)),
          why: APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT.factoryThrowWhy
        });
        return { problems: problems, bindings: null };
      }
    }
    APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (coordinatorInstance == null || typeof coordinatorInstance[name] !== "function") {
        problems.push({
          path: "AppNativeCoordinator." + name,
          expected: "function",
          actual: coordinatorInstance == null ? describeGot(coordinatorInstance) : describeGot(coordinatorInstance[name]),
          why: APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-F：待整理会话与窗口规则在原生协调器之后装配，检查失败不产生任何副作用。
    let reviewInstance = null;
    const reviewFactory = readRuntimePath(roots, APP_REVIEW_INSTANCE_CONTRACT.factory);
    if (appReview != null && AppReview != null && reviewFactory === AppReview.createAppReview) {
      reviewInstance = appReview;
    } else {
      try {
        reviewInstance = reviewFactory(reviewRuntimeDeps());
      } catch (error) {
        problems.push({
          path: APP_REVIEW_INSTANCE_CONTRACT.factory + "()",
          expected: "instance",
          actual: "threw:" + (error && error.message ? error.message : String(error)),
          why: APP_REVIEW_INSTANCE_CONTRACT.factoryThrowWhy
        });
        return { problems: problems, bindings: null };
      }
    }
    APP_REVIEW_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (reviewInstance == null || typeof reviewInstance[name] !== "function") {
        problems.push({
          path: "AppReview." + name,
          expected: "function",
          actual: reviewInstance == null ? describeGot(reviewInstance) : describeGot(reviewInstance[name]),
          why: APP_REVIEW_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-G：Web 提醒与活动闹钟面板在待整理之后装配，检查失败不产生任何副作用。
    let alertsInstance = null;
    const alertsFactory = readRuntimePath(roots, APP_ALERTS_INSTANCE_CONTRACT.factory);
    if (appAlerts != null && AppAlerts != null && alertsFactory === AppAlerts.createAppAlerts) {
      alertsInstance = appAlerts;
    } else {
      try {
        alertsInstance = alertsFactory(alertsRuntimeDeps());
      } catch (error) {
        problems.push({
          path: APP_ALERTS_INSTANCE_CONTRACT.factory + "()",
          expected: "instance",
          actual: "threw:" + (error && error.message ? error.message : String(error)),
          why: APP_ALERTS_INSTANCE_CONTRACT.factoryThrowWhy
        });
        return { problems: problems, bindings: null };
      }
    }
    APP_ALERTS_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (alertsInstance == null || typeof alertsInstance[name] !== "function") {
        problems.push({
          path: "AppAlerts." + name,
          expected: "function",
          actual: alertsInstance == null ? describeGot(alertsInstance) : describeGot(alertsInstance[name]),
          why: APP_ALERTS_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-H：平台适配与 PWA 生命周期在提醒实例之后装配，检查失败不产生任何副作用。
    let platformInstance = null;
    const platformFactory = readRuntimePath(roots, APP_PLATFORM_INSTANCE_CONTRACT.factory);
    if (appPlatform != null && AppPlatform != null && platformFactory === AppPlatform.createAppPlatform) {
      platformInstance = appPlatform;
    } else {
      try {
        platformInstance = platformFactory(platformRuntimeDeps());
      } catch (error) {
        problems.push({
          path: APP_PLATFORM_INSTANCE_CONTRACT.factory + "()",
          expected: "instance",
          actual: "threw:" + (error && error.message ? error.message : String(error)),
          why: APP_PLATFORM_INSTANCE_CONTRACT.factoryThrowWhy
        });
        return { problems: problems, bindings: null };
      }
    }
    APP_PLATFORM_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (platformInstance == null || typeof platformInstance[name] !== "function") {
        problems.push({
          path: "AppPlatform." + name,
          expected: "function",
          actual: platformInstance == null ? describeGot(platformInstance) : describeGot(platformInstance[name]),
          why: APP_PLATFORM_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-I-R：首页告知与启动轻摘要在平台实例之后装配，检查失败不产生任何副作用。
    let noticesInstance = null;
    const noticesFactory = readRuntimePath(roots, APP_NOTICES_INSTANCE_CONTRACT.factory);
    if (appNotices != null && AppNotices != null && noticesFactory === AppNotices.createAppNotices) {
      noticesInstance = appNotices;
    } else {
      try {
        noticesInstance = noticesFactory(noticesRuntimeDeps());
      } catch (error) {
        problems.push({
          path: APP_NOTICES_INSTANCE_CONTRACT.factory + "()",
          expected: "instance",
          actual: "threw:" + (error && error.message ? error.message : String(error)),
          why: APP_NOTICES_INSTANCE_CONTRACT.factoryThrowWhy
        });
        return { problems: problems, bindings: null };
      }
    }
    APP_NOTICES_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (noticesInstance == null || typeof noticesInstance[name] !== "function") {
        problems.push({
          path: "AppNotices." + name,
          expected: "function",
          actual: noticesInstance == null ? describeGot(noticesInstance) : describeGot(noticesInstance[name]),
          why: APP_NOTICES_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-I: 保存与排程反馈控制器
    let actionFeedbackInstance = null;
    const actionFeedbackFactory = readRuntimePath(roots, APP_ACTION_FEEDBACK_INSTANCE_CONTRACT.factory);
    if (appActionFeedback != null && AppActionFeedback != null && actionFeedbackFactory === AppActionFeedback.createAppActionFeedback) {
      actionFeedbackInstance = appActionFeedback;
    } else {
      try {
        actionFeedbackInstance = actionFeedbackFactory(actionFeedbackRuntimeDeps());
      } catch (error) {
        problems.push({
          path: APP_ACTION_FEEDBACK_INSTANCE_CONTRACT.factory + "()",
          expected: "instance",
          actual: "threw:" + (error && error.message ? error.message : String(error)),
          why: APP_ACTION_FEEDBACK_INSTANCE_CONTRACT.factoryThrowWhy
        });
        return { problems: problems, bindings: null };
      }
    }
    APP_ACTION_FEEDBACK_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (actionFeedbackInstance == null || typeof actionFeedbackInstance[name] !== "function") {
        problems.push({
          path: "AppActionFeedback." + name,
          expected: "function",
          actual: actionFeedbackInstance == null ? describeGot(actionFeedbackInstance) : describeGot(actionFeedbackInstance[name]),
          why: APP_ACTION_FEEDBACK_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-I: 事件与路由绑定控制器
    let eventsInstance = null;
    const eventsFactory = readRuntimePath(roots, APP_EVENTS_INSTANCE_CONTRACT.factory);
    if (appEvents != null && AppEvents != null && eventsFactory === AppEvents.createAppEvents) {
      eventsInstance = appEvents;
    } else {
      try {
        eventsInstance = eventsFactory(eventsRuntimeDeps());
      } catch (error) {
        problems.push({
          path: APP_EVENTS_INSTANCE_CONTRACT.factory + "()",
          expected: "instance",
          actual: "threw:" + (error && error.message ? error.message : String(error)),
          why: APP_EVENTS_INSTANCE_CONTRACT.factoryThrowWhy
        });
        return { problems: problems, bindings: null };
      }
    }
    APP_EVENTS_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (eventsInstance == null || typeof eventsInstance[name] !== "function") {
        problems.push({
          path: "AppEvents." + name,
          expected: "function",
          actual: eventsInstance == null ? describeGot(eventsInstance) : describeGot(eventsInstance[name]),
          why: APP_EVENTS_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // P3-I: 测试接口组装控制器
    let testApiInstance = null;
    const testApiFactory = readRuntimePath(roots, APP_TEST_API_INSTANCE_CONTRACT.factory);
    if (appTestApi != null && AppTestApi != null && testApiFactory === AppTestApi.createAppTestApi) {
      testApiInstance = appTestApi;
    } else {
      try {
        testApiInstance = testApiFactory(testApiRuntimeDeps());
      } catch (error) {
        problems.push({
          path: APP_TEST_API_INSTANCE_CONTRACT.factory + "()",
          expected: "instance",
          actual: "threw:" + (error && error.message ? error.message : String(error)),
          why: APP_TEST_API_INSTANCE_CONTRACT.factoryThrowWhy
        });
        return { problems: problems, bindings: null };
      }
    }
    APP_TEST_API_INSTANCE_CONTRACT.instance.forEach(function (name) {
      if (testApiInstance == null || typeof testApiInstance[name] !== "function") {
        problems.push({
          path: "AppTestApi." + name,
          expected: "function",
          actual: testApiInstance == null ? describeGot(testApiInstance) : describeGot(testApiInstance[name]),
          why: APP_TEST_API_INSTANCE_CONTRACT.instanceWhy
        });
      }
    });
    if (problems.length) return { problems: problems, bindings: null };

    // 走到这里说明每一项都核对过了 —— 下面绑的就是刚才核对过的那批值。
    const bindings = {
      appUi: instance, ai: aiInstance, backup: backupInstance,
      diagnostics: diagnosticsInstance, setup: setupInstance, content: contentInstance, views: viewsInstance, capture: captureInstance,
      model: modelInstance, persistence: persistenceInstance, transaction: transactionInstance, items: itemsInstance,
      coordinator: coordinatorInstance, review: reviewInstance, alerts: alertsInstance, platform: platformInstance,
      notices: noticesInstance,
      actionFeedback: actionFeedbackInstance, events: eventsInstance, testApi: testApiInstance
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
    AppCapture = b.AppCapture;
    appCapture = b.capture;
    AppModel = b.AppModel;
    appModel = b.model;
    AppPersistence = b.AppPersistence;
    appPersistence = b.persistence;
    AppTransaction = b.AppTransaction;
    appTransaction = b.transaction;
    AppItems = b.AppItems;
    appItems = b.items;
    AppNativeCoordinator = b.AppNativeCoordinator;
    appNativeCoordinator = b.coordinator;
    AppReview = b.AppReview;
    appReview = b.review;
    AppAlerts = b.AppAlerts;
    appAlerts = b.alerts;
    AppPlatform = b.AppPlatform;
    appPlatform = b.platform;
    AppNotices = b.AppNotices;
    appNotices = b.notices;
    AppActionFeedback = b.AppActionFeedback;
    appActionFeedback = b.actionFeedback;
    AppEvents = b.AppEvents;
    appEvents = b.events;
    AppTestApi = b.AppTestApi;
    appTestApi = b.testApi;
    SCHEMA = appModel.SCHEMA;
    PROJECT_COLORS = appModel.PROJECT_COLORS;
    // 模型验证通过后才建立可写 state；缺模型时 bindRuntime 已提前返回，业务启动不会拿到半套状态。
    state = appModel.createInitialState();
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
    if (appTestApi && typeof appTestApi.assembleTestApi === "function") {
      appTestApi.assembleTestApi();
    }
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
      if (appPersistence) appPersistence.reopen();
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
  let PROJECT_COLORS = null;
  let state = null;

  function currentPayload() {
    return appPersistence.currentPayload();
  }

  /* Persistence entrypoints are compatibility forwards to the one appPersistence instance. */
  function writeSnapshot(payload, options) {
    return appPersistence.writeSnapshot(payload, options);
  }

  function getPersistenceStorage() {
    return appPersistence ? appPersistence.getStorage() : null;
  }

  /**
   * P2-C-R：权威状态**已确认**（`loaded` / `empty`）才允许写。
   *
   * `unconfirmed`（恢复尝试还没结束）同样算关闭：读库期间的任何写入都发生在
   * 「还不知道权威里有什么」的窗口里，风险与 `failed` 完全相同。
   */
  function authoritativeWritesAllowed() { return !!(appPersistence && appPersistence.authoritativeWritesAllowed()); }
  function runCommit(job, args) { return appPersistence.runCommit(job, args); }
  function saveAsync(options) { return appPersistence.saveAsync(options); }

  /* D41 事务协调器已整体迁出至 lib/app-transaction.js（P3-C）。此处保留保存抑制薄守卫。 */
  function save(options) {
    if (shouldSuppressInnerSave()) return;
    return appPersistence.save(options);
  }

  /* ---------- 统一事务：兼容薄转发至 appTransaction 实例 ---------- */

  function itemConflictsWithActiveAction(item) {
    return appTransaction.itemConflictsWithActiveAction(item);
  }

  function isItemActionPending(id) {
    return appTransaction.isItemActionPending(id);
  }

  function rejectPendingItemCommand() {
    return appTransaction.rejectPendingItemCommand();
  }

  function runUserOp(fn, args, options) {
    return appTransaction.runUserOp(fn, args, options);
  }

  function wrapUserOp(fn, options) {
    let cachedInstance = null;
    let cached = null;
    return function () {
      if (cachedInstance !== appTransaction) {
        cachedInstance = appTransaction;
        cached = appTransaction ? appTransaction.wrapUserOp(fn, options) : null;
      }
      if (cached) return cached.apply(null, arguments);
      return runUserOp(fn, Array.prototype.slice.call(arguments), options);
    };
  }

  function takeReplayCreatedId() {
    return appTransaction.takeReplayCreatedId();
  }

  function inflightDepth() {
    return appTransaction.inflightDepth();
  }

  function isFeedbackSuppressed() {
    return appTransaction ? appTransaction.isFeedbackSuppressed() : false;
  }

  function shouldSuppressInnerSave() {
    return appTransaction ? appTransaction.shouldSuppressInnerSave() : false;
  }

  /* Core owns live state normalization only; appPersistence establishes its committed baseline after recovery. */
  function applyParsedState(parsed) {
    const modelDefaults = appModel.createInitialState();
    const modelAiDefaults = modelDefaults.settings.ai;
    schemaMigrationNeeded = parsed.schema !== SCHEMA || (Array.isArray(parsed.items) && parsed.items.some(it =>
      !it || !it.scheduleBasis || it.dismissedUntil === undefined || it.reminderEvents === undefined
    ));
    state.items = Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : [];
    state.notes = Array.isArray(parsed.notes) ? parsed.notes : [];
    state.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    state.settings = Object.assign(modelDefaults.settings, parsed.settings || {});
    if (state.settings.userMode !== "normal" && state.settings.userMode !== "beginner") state.settings.userMode = "beginner";
    syncUserMode();
    if (!state.settings.ai || typeof state.settings.ai !== "object") state.settings.ai = modelAiDefaults;
    else state.settings.ai = Object.assign(modelAiDefaults, state.settings.ai);
    ensureReviewSettings();
    state.items.forEach(it => { if (!it.review_status) it.review_status = "READY"; });
    return state.items;
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
  function replayPendingSnapshot() { return appPersistence.replayPendingSnapshot(); }
  function loadAsync() { return appPersistence.loadAsync(); }
  function loadSync() { return appPersistence.loadSync(); }
  function load() { return appPersistence.load(); }
  function mirrorBytes() { return appPersistence ? appPersistence.authoritySnapshot().mirrorBytes : null; }

  function normalizeItem(it) {
    return appModel.normalizeItem(it);
  }

  /** D25 赋值快照：有标记→alarm；未标记→当前全局默认 */
  function resolveDeliveryMode(priority) {
    return appModel.resolveDeliveryMode(priority);
  }

  function makeItem(o) {
    return appModel.makeItem(o);
  }



  /**
   * L04：任何会改变「时间 / 状态」的写入都推进版本号。
   * 通知事件携带投递时的版本，回来时对不上就说明它是「已经过期的旧通知」，
   * 不得再覆盖新状态、也不得再推进一次周期。
   */
  function bumpRev(it) {
    return appModel.bumpRev(it);
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
    return appModel.isTerminal(it);
  }

  /**
   * L04：事件里的数据版本是否「可知」。
   * 缺失 / 0 / 非数字都当作未知 —— 这时不做版本校验，
   * 避免整条原生链路丢版本后所有通知按钮集体失效（V02）。
   */
  function hasKnownRev(rev) {
    return appModel.hasKnownRev(rev);
  }

  /**
   * L01 / R5 / D17：只有「系统兜底时间」的记录不发事项提醒。
   *  · 用户手选或解析出的真实时间照常生效（Review 只管内容质量）；
   *  · Review 关闭后一律按普通事项正常提醒（V0.2 §9.2）。
   */
  function isFallbackSuppressed(it) {
    return appReview.isFallbackSuppressed(it);
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

  /* ---------- Deferred Clarification / 延迟澄清（唯一实现迁至 lib/app-review.js） ---------- */
  function ensureReviewSettings() {
    return appReview.ensureReviewSettings();
  }

  function fallbackTriggerAt() {
    return appReview.fallbackTriggerAt();
  }

  function isVagueContent(title, note, url) {
    return appReview.isVagueContent(title, note, url);
  }

  function detectNeedsReview(opts) {
    return appReview.detectNeedsReview(opts);
  }

  function needsReviewItems() {
    return appReview.needsReviewItems();
  }

  function reviewSessionKey(d, rs) {
    return appReview.reviewSessionKey(d, rs);
  }

  function nextReviewWindowStart(from) {
    return appReview.nextReviewWindowStart(from);
  }

  function inReviewWindow(now) {
    return appReview.inReviewWindow(now);
  }

  function fireReviewNotification(count) {
    return appReview.fireReviewNotification(count);
  }

  function maybeReviewSession(now) {
    return appReview.maybeReviewSession(now);
  }

  function openReviewSession() {
    return appReview.openReviewSession();
  }

  function currentReviewItem() {
    return appReview.currentReviewItem();
  }

  function renderReviewCard() {
    return appReview.renderReviewCard();
  }

  /**
   * L05：确认 ≠ 采用系统兜底时间。三种来源分开处理 ——
   *  · 用户在卡片里明确改过时间 → 采用，并解除兜底标记；
   *  · 记录本来就有真实时间 → 保留；
   *  · 只有兜底值（或时间已过期）→ 顺延到下一个整理窗口，**不生成立即到期提醒**。
   */
  function resolveReviewTrigger(it) {
    return appReview.resolveReviewTrigger(it);
  }

  function markReviewDone(item, extra) {
    return appReview.markReviewDone(item, extra);
  }

  function reviewConfirm() {
    return appReview.reviewConfirm();
  }

  function reviewSaveEdit() {
    return appReview.reviewSaveEdit();
  }

  function reviewKeepCurrent() {
    return appReview.reviewKeepCurrent();
  }

  function reviewDelete() {
    return appReview.reviewDelete();
  }

  function snoozeReview(ms, label) {
    return appReview.snoozeReview(ms, label);
  }

  function skipReviewThisTime() {
    return appReview.skipReviewThisTime();
  }

  function inReviewHighlight(now) {
    return appReview.inReviewHighlight(now);
  }

  /**
   * A-2 / D68：后台提醒链路断了，**首页**必须直说。
   *
   * **实现已迁出**（P3-I-R）到 `lib/app-notices.js`：四档判定（总开关 / 系统通知权限 /
   * 原生桥未就绪 / 对账失败）与全部文案纪律的唯一实现在那里；这里只保留入口必需的
   * 薄转发 —— 测试接口（`__ATTENTION_INBOX__.homeNoticeVerdict`）与静态覆盖矩阵仍按
   * 这个名字取用，但**不再有第二份判定体**。
   *
   * 迁出理由：它是「具体业务算法」（四档分流 + 文案红线），不是装配、也不是生命周期。
   * 判定搬走之后，「只在能确证断链时出声」这条纪律只剩一处可以被改坏。
   */
  function homeNoticeVerdict(status, settings, native) {
    return appNotices ? appNotices.homeNoticeVerdict(status, settings, native) : null;
  }

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

  /**
   * A-2：把 verdict 渲染到首页顶部。
   *
   * **实现已迁出**（P3-I-R）到 `lib/app-notices.js` 的 `renderHomeNotice()`：
   * 判定分流、文案与 `#homeNotice` 的单写入者渲染在同一处，入口只留薄转发。
   */
  function renderHomeNotice() {
    return appNotices ? appNotices.renderHomeNotice() : null;
  }

  function renderReviewEntry() {
    return appReview.renderReviewEntry();
  }

  function scheduleNextReviewAlarm() {
    return appReview.scheduleNextReviewAlarm();
  }

  /* ---------- lifecycle ---------- */
  /**
   * 「这条事项现在算不算到期」——**实现**在 `lib/app-model.js`（事项模型层，纯谓词）。
   * 入口只做薄转发：`isAttentionDue`、提示条与测试接口都按这个名字取用。
   */
  function isDue(item, now) {
    return appModel ? appModel.isDue(item, now) : false;
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
    return appItems.promoteDue(now);
  }

  function ensureSeriesId(it) {
    return appItems.ensureSeriesId(it);
  }

  function seriesMembers(seriesId, exceptId, sourceItem) {
    return appItems.seriesMembers(seriesId, exceptId, sourceItem);
  }

  function isUnstartedInstance(it) {
    return appItems.isUnstartedInstance(it);
  }

  function spawnNextInstance(it, fromTs) {
    return appItems.spawnNextInstance(it, fromTs);
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
  /** UX-A01：稍后面板的唯一入口 —— 卡片、详情、弹条、首次 ACK 的反馈都走这里。
   * U1 修复（P3-I-R 独立复验 20260924）：面板打开与选时状态（snoozePick/snoozeBasis）
   * 由 app-events 实例持有；事务待办闸门以具名依赖注入。入口仅保留薄转发。 */
  function openSnoozeSheet(id) {
    return appEvents.openSnoozeSheet(id);
  }

  function ackItem(id, silent) {
    return appItems.ackItem(id, silent);
  }

  function advanceSeriesOnArchive(it) {
    return appItems.advanceSeriesOnArchive(it);
  }

  function lastCompleteUndo() {
    return appItems.lastCompleteUndo();
  }
  let undoNativeCheckPending = false;

  function applyCompleteUndo(command) {
    return appItems.applyCompleteUndo(command);
  }

  function revertCompleteUndo(command) {
    return appItems.revertCompleteUndo(command);
  }

  function undoLastComplete() {
    return appItems.undoLastComplete();
  }

  function completeItem(id) {
    return appItems.completeItem(id);
  }

  function snoozeItem(id, when, basis) {
    return appItems.snoozeItem(id, when, basis);
  }

  function deleteItem(id) {
    return appItems.deleteItem(id);
  }

  function reopenItem(id) {
    return appItems.reopenItem(id);
  }

  function restoreItem(id) {
    return appItems.restoreItem(id);
  }

  function resumeDeadlineProtection(id) {
    return appItems.resumeDeadlineProtection(id);
  }

  function stopRepeat(id) {
    return appItems.stopRepeat(id);
  }

  /* ---------- item card ---------- */


  /**
   * UX-A01：动作按钮 = 名称 + 短副说明。
   *
   * 四个动作在首页卡片、详情、弹条、Android 闹钟与通知快捷动作里含义必须一致；
   * `data-act` 是行为契约，副说明只是给人看的，不参与任何判断。
   */




  /* ---------- views ---------- */


  /**
   * 应用角标 —— **实现**在 `lib/app-platform.js`（宿主能力：PWA Badging API）。
   * 「不传就数到期条数」这条计数语义随实现一起搬走，入口不再保留第二份。
   */
  function updateAppBadge(forced) {
    return appPlatform ? appPlatform.updateAppBadge(forced) : null;
  }

  /** P2-F2：核心显式完成业务推进；展示实例只渲染首页 DOM。 */
  function renderHome() {
    promoteDue();
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
  function renderPwaStatus() {
    if (globalThis.__ATTENTION_INBOX__ && typeof globalThis.__ATTENTION_INBOX__.renderPwaStatus === "function" && globalThis.__ATTENTION_INBOX__.renderPwaStatus !== renderPwaStatus) {
      return globalThis.__ATTENTION_INBOX__.renderPwaStatus();
    }
    return appViews ? appViews.renderPwaStatus() : null;
  }
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

  function runAiOnCapture(mode) {
    if (ai) return ai.runOnCapture(mode);
  }

  function saveAiSettings() {
    if (ai) return ai.saveAiSettings();
  }

  function testAiConnection() {
    if (ai) return ai.testConnection();
  }

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
  // G2 提交编排由 app-capture 唯一持有；core 只转发会话快照。
  function formSession() { return appCapture.session(); }
  function snapshotItemForm() { return appCapture.snapshotItemForm(); }
  function formDraftSignature(snap) { return appCapture.formDraftSignature(snap); }
  function restoreItemForm(snap) { return appCapture.restoreItemForm(snap); }
  /* ---------- UX-T01：保存结果与排程反馈（唯一来源 lib/app-action-feedback.js，P3-I） ---------- */
  function itemScheduleEvidence(it) {
    if (appActionFeedback) return appActionFeedback.itemScheduleEvidence(it);
    return null;
  }
  function feedbackNativeSnapshot() {
    if (appActionFeedback) return appActionFeedback.feedbackNativeSnapshot();
    return {};
  }
  function feedbackItemSnapshot(it) {
    if (appActionFeedback) return appActionFeedback.feedbackItemSnapshot(it);
    return null;
  }
  function feedbackVerdictFor(it, waiter) {
    if (appActionFeedback) return appActionFeedback.feedbackVerdictFor(it, waiter);
    return null;
  }
  function runFeedbackAction(kind, it, waiter) {
    if (appActionFeedback) return appActionFeedback.runFeedbackAction(kind, it, waiter);
  }
  function undoNewItem(itemId, rev) {
    return appItems.undoNewItem(itemId, rev);
  }
  function announceSaveOutcome(itemId, waiter) {
    if (appActionFeedback) return appActionFeedback.announceSaveOutcome(itemId, waiter);
  }
  function settleSaveFeedback() {
    if (appActionFeedback) return appActionFeedback.settleSaveFeedback();
  }
  /* ---------- UX-T01 结束 ---------- */

  /* ---------- item sheet (capture / edit) ---------- */
  // P2-G1：所有表单 DOM、提示与会话状态都在 capture；下面仅为 G2/入口转发。
  function resetItemSheet() { return appCapture.resetItemSheet(); }
  function openCapture(prefill) { return appCapture.openCapture(prefill); }
  function openEditItem(id) { return appCapture.openEditItem(id); }
  function formRepeat(src) { return appCapture.formRepeat(src); }
  function updateRepeatPreview() { return appCapture.updateRepeatPreview(); }
  function findSimilarItems(title) { return appCapture.findSimilarItems(title); }
  function renderSimilarHint(title) { return appCapture.renderSimilarHint(title); }

  function applyItemEdit(it, values) {
    return appItems.applyItemEdit(it, values);
  }

  function applyNewItem(id, fields) {
    return appItems.applyNewItem(id, fields);
  }

  /**
   * 每日轻量摘要（每 20 小时至多一次）——**实现**在 `lib/app-notices.js`。
   * 计数、文案与「是否值得出声」的判定只此一份；入口只在启动链上调用它。
   */
  function maybeDailySummary() {
    return appNotices ? appNotices.maybeDailySummary() : null;
  }

  /* low-confidence confirm / submit forwarding: implementation is lib/app-capture.js */
  function openLowConfSheet(defaultTs, rawText) { return appCapture.openLowConfSheet(defaultTs, rawText); }
  function finishSaveAfterLowConf(ts) { return appCapture.finishSaveAfterLowConf(ts); }
  function setLowConfPick(ts, chipEl) { return appCapture.setLowConfPick(ts, chipEl); }
  function saveItemFromForm() { return appCapture.saveItemFromForm(); }

  /* ---------- detail ---------- */


  /* ---------- P2-F1 content forwarding: implementation is lib/app-content.js ---------- */
  function openNote(id) { return appContent.openNote(id); }
  function saveNote() { return appContent.saveNote(); }
  function doSearch(q) { return appContent.doSearch(q); }
  function renderProjectsSheet() { return appContent.renderProjectsSheet(); }
  function addProject() { return appContent.addProject(); }
  function deleteProject(id) { return appContent.deleteProject(id); }
  function bindAppContent() { if (appContent) return appContent.bind(); }

  function applyProjectRemovalToItems(id) {
    return appItems.applyProjectRemovalToItems(id);
  }

  /* ---------- notifications ---------- */

  /**
   * 原生状态的**唯一漏斗**。
   *
   * `origin` 刻意是显式参数而不是「有没有某个字段」的推断：
   * 只有**真正跑完一轮对账**（reconcile）才允许结清保存反馈 ——
   * 权限刷新（onResume / 从系统设置切回）只是重读权限，它没有重排任何东西，
   * 拿它当「排程结论已定」会让刚保存的事项被过早宣布为「尚未确认」。
   */
  function setNativeReminderStatus(status, origin) {
    if (appNativeCoordinator) {
      return appNativeCoordinator.setNativeReminderStatus(status, origin);
    }
    nativeReminderStatus = Object.assign({}, nativeReminderStatus, status || {});
    if (state && state.ui && state.ui.tab === "me") renderPwaStatus();
    renderHomeNotice();
  }

  function refreshNativeScheduleBasis() {
    return appNativeCoordinator.refreshNativeScheduleBasis();
  }

  function applyDeadlineEvents(events, now, cancelledEvents, options) {
    return appNativeCoordinator.applyDeadlineEvents(events, now, cancelledEvents, options);
  }

  function applyReminderEvents(events, now, cancelledEvents, options) {
    return appNativeCoordinator.applyReminderEvents(events, now, cancelledEvents, options);
  }

  function markDeadlineDelivered(event) {
    return appNativeCoordinator.markDeadlineDelivered(event);
  }

  function getNativeReminderStatus() {
    return appNativeCoordinator ? appNativeCoordinator.getNativeReminderStatus() : Object.assign({}, nativeReminderStatus);
  }

  function getNativeSyncVersion() {
    return appNativeCoordinator ? appNativeCoordinator.getNativeSyncVersion() : 0;
  }

  function bumpNativeSyncVersion() {
    return appNativeCoordinator ? appNativeCoordinator.bumpNativeSyncVersion() : 0;
  }

  function syncNativeRemindersNow(options) {
    return appNativeCoordinator ? appNativeCoordinator.syncNativeRemindersNow(options) : Promise.resolve(nativeReminderStatus);
  }

  function ensureNativeReminders() {
    return appNativeCoordinator ? appNativeCoordinator.ensureNativeReminders() : Promise.resolve(false);
  }

  function queueNativeReminderSync(source) {
    if (appNativeCoordinator) return appNativeCoordinator.queueNativeReminderSync(source);
  }

  async function handleNativeNotificationAction(event) {
    if (!event) return;
    // D20：待整理通知点击直达整理会话
    if (event.itemId === "review-session" || event.managedKind === "review-session") {
      // L06 / V0.2 §9.3：动作语义 = 开始整理 / 稍后 30 分钟 / 今天跳过，
      // 通知上的标签与这里执行的效果必须一一对应。
      if (event.action === "review_snooze") {
        await snoozeReview(30 * 60 * 1000, "30 分钟");
        return;
      }
      if (event.action === "review_skip") {
        await skipReviewThisTime();
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

  /* ---------- 原生动作事务协调：唯一来源 lib/app-transaction.js（P3-C 已迁出） ---------- */

  function alarmEventSeen(id) {
    return appTransaction.alarmEventSeen(id);
  }

  function handleAlarmAction(data) {
    return appTransaction.handleAlarmAction(data);
  }

  /* ---------- 平台适配与生命周期：唯一来源 lib/app-platform.js（P3-H 已迁出） ---------- */
  function systemBridge() {
    return appPlatform ? appPlatform.systemBridge() : null;
  }

  /**
   * Q6：当前跑在安卓原生容器里（**不看插件是否已注册**）。
   */
  function isNativeAndroidRuntime() {
    if (appPlatform) return appPlatform.isNativeAndroidRuntime();
    if (appNativeCoordinator) return appNativeCoordinator.isNativeAndroidRuntime();
    return false;
  }

  function waitForNativeBridge(timeoutMs) {
    if (appPlatform) return appPlatform.waitForNativeBridge(timeoutMs);
    return appNativeCoordinator ? appNativeCoordinator.waitForNativeBridge(timeoutMs) : Promise.resolve(false);
  }

  function appSettingsPlugin() {
    return appPlatform ? appPlatform.appSettingsPlugin() : null;
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

  function bindDiagnostics() {
    if (diagnostics) return diagnostics.bind();
  }

  function bindReviewControls() {
    return appReview.bindReviewControls();
  }

  function markReviewTriggerPicked(v) {
    if (appReview) return appReview.markReviewTriggerPicked(v);
  }

  /**
   * setup / review 控件绑定（P2-D 从原 `bindNotifyLab()` 拆出，Review 迁入 `lib/app-review.js`）。
   */
  function bindSetupReviewControls() {
    if (appSetup) appSetup.bind();
    bindReviewControls();
  }


  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function deliveryEvidenceReadable() {
    return appNativeCoordinator ? appNativeCoordinator.deliveryEvidenceReadable() : null;
  }

  function getDeliveryEvidenceState(it) {
    return appNativeCoordinator ? appNativeCoordinator.getDeliveryEvidenceState(it) : null;
  }

  function getNativeSyncMetrics() {
    return appNativeCoordinator ? appNativeCoordinator.getNativeSyncMetrics() : null;
  }

  function readDeliveryEvidence(source) {
    return appNativeCoordinator ? appNativeCoordinator.readDeliveryEvidence(source) : Promise.resolve(false);
  }

  function applyNativeDeliveryEvidence(rows) {
    return appNativeCoordinator ? appNativeCoordinator.applyNativeDeliveryEvidence(rows) : false;
  }

  function applyReminderDelivered(ev) {
    return appNativeCoordinator ? appNativeCoordinator.applyReminderDelivered(ev) : false;
  }

  /**
   * UX-T03：详情页「提醒结果」一行 —— 唯一实现归 lib/app-views.js，入口仅保留薄转发。
   */
  function detailReminderStatusRow(it) {
    return appViews ? appViews.detailReminderStatusRow(it) : "";
  }

  async function initializeNativeReminders() {
    return appNativeCoordinator ? appNativeCoordinator.initializeNativeReminders() : Promise.resolve();
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

  /* ---------- Web 提醒与到期 tick：唯一来源 lib/app-alerts.js（P3-G 已迁出） ---------- */
  function shouldSkipAlert(it) {
    return appAlerts ? appAlerts.shouldSkipAlert(it) : false;
  }

  function showSystemNotification(opts) {
    if (appAlerts) return appAlerts.showSystemNotification(opts);
  }

  function showAlert(it) {
    if (appAlerts) return appAlerts.showAlert(it);
  }

  function hideAlert() {
    if (appAlerts) return appAlerts.hideAlert();
  }

  function dismissAlert() {
    return appAlerts ? appAlerts.dismissAlert() : false;
  }

  function applyAlertDismissal(itemId, until) {
    return appAlerts ? appAlerts.applyAlertDismissal(itemId, until) : false;
  }

  function tick() {
    if (appAlerts) return appAlerts.tick();
  }

  function getAlertItem() {
    return appAlerts ? appAlerts.getAlertItem() : null;
  }

  function stopPolling() {
    if (appAlerts) appAlerts.stopPolling();
  }

  function clearAlert() {
    if (appAlerts) return appAlerts.clearAlert();
  }

  function bindAlertControls() {
    if (appAlerts) return appAlerts.bindAlertControls();
  }

  function exportData() {
    if (backup) return backup.exportData();
  }

  function importDataFile(file) {
    if (backup) return backup.importDataFile(file);
  }

  function buildLegacyBackupPayload() {
    return backup ? backup.buildLegacyBackupPayload() : null;
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
  /* ---------- 演示与示例数据（唯一来源 lib/app-events.js，P3-I） ---------- */
  function demoPreviewRows() {
    if (appEvents) return appEvents.demoPreviewRows();
    return [];
  }
  function openDemoPreview() {
    if (appEvents) return appEvents.openDemoPreview();
  }
  function seed(which) {
    if (appEvents) return appEvents.seed(which);
    return false;
  }

  /* ---------- 事件与路由绑定（唯一来源 lib/app-events.js，P3-I） ---------- */
  function applyShareParams() {
    if (appEvents) return appEvents.applyShareParams();
    return false;
  }
  function bind() {
    if (appEvents) return appEvents.bind();
    const bd = typeof $ === "function" ? $("#backdrop") : null;
    if (bd && typeof closeAllSheets === "function") bd.addEventListener("click", closeAllSheets);
  }

  /* ---------- init / 平台生命周期：唯一来源 lib/app-platform.js（P3-H 已迁出） ---------- */
  function getDeferredInstallPrompt() {
    return appPlatform ? appPlatform.getDeferredInstallPrompt() : null;
  }

  function registerPwa() {
    if (appPlatform) appPlatform.registerPwa();
  }

  function bindInstall() {
    if (appPlatform) appPlatform.bindInstall();
  }

  /* ---------- 活动原生闹钟面板：唯一来源 lib/app-alerts.js（P3-G 已迁出） ---------- */
  function deliveryHandledByCommittedItem(alarm, item) {
    return appAlerts ? appAlerts.deliveryHandledByCommittedItem(alarm, item) : false;
  }

  function completeActiveAlarm(alarm) {
    if (!appAlerts) return Promise.resolve(false);
    return appAlerts.completeActiveAlarm(alarm);
  }

  function refreshActiveAlarmPanel(reveal) {
    if (appAlerts) return appAlerts.refreshActiveAlarmPanel(reveal);
    return Promise.resolve();
  }

  function bindNetwork() {
    if (appPlatform) appPlatform.bindNetwork();
  }

  function handleQueryActions() {
    if (appEvents) return appEvents.handleQueryActions();
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
    if (appAlerts) {
      appAlerts.startPolling();
      appAlerts.tick();
    }
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
      if (appPersistence && appPersistence.authoritySnapshot().status === LOAD_FAILED) {
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
   * `markReviewDone(item, extra)` 已在 `lib/app-review.js` 内部通过 `deps.wrapUserOp` 包装；
   * 截止对账、真实送达回调和原生时间迁移也写同一 items 状态，在此处包装。
   */
  const itemCommand = { userFacing: true, itemArg: 0 };
  applyDeadlineEvents = wrapUserOp(applyDeadlineEvents);
  markDeadlineDelivered = wrapUserOp(markDeadlineDelivered);
  refreshNativeScheduleBasis = wrapUserOp(refreshNativeScheduleBasis);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { startApp(); });
  } else {
    startApp();
  }

  // Dev/test hook — 唯一组装由 lib/app-test-api.js 负责（P3-I）
  const testApiLib = (AppTestApi && typeof AppTestApi.createAppTestApi === "function")
    ? AppTestApi
    : ((typeof AttentionLib !== "undefined" && AttentionLib && AttentionLib.AppTestApi) || null);
  if (!appTestApi && testApiLib && typeof testApiLib.createAppTestApi === "function") {
    try {
      appTestApi = testApiLib.createAppTestApi(testApiRuntimeDeps());
    } catch (_) {}
  }
  if (appTestApi && typeof appTestApi.assembleTestApi === "function") {
    appTestApi.assembleTestApi();
  } else if (typeof globalThis !== "undefined" && !globalThis.__ATTENTION_INBOX__) {
    const fallbackDeps = testApiRuntimeDeps();
    globalThis.__ATTENTION_INBOX__ = fallbackDeps;
    globalThis.seedAttentionInbox = fallbackDeps.seed;
  }
})();
