# app-core.js 职责与状态所有权盘点表 (P3-I)

## 一、概述
本表对 `app-core.js` 原有 234 个顶层函数、77 个可变状态变量以及 51 处事件监听器进行逐项分类与职责梳理，作为 P3-I 拆分与迁出的基线依据。

---

## 二、状态变量盘点 (77 项)

| 符号 | 类型 | 原读写方 | 生命周期 | P3-I 处置 | 唯一所有者 / 迁出理由 |
| :--- | :---: | :--- | :--- | :---: | :--- |
| `SCHEMA` | let | `bindRuntime` 写, `init` 读 | 启动期配置 | 保留 | app-core (schema 契约) |
| `AppUi`, `appUi` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (UI 模块实例句柄) |
| `AppAi`, `ai` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (AI 模块实例句柄) |
| `AppBackup`, `backup` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (备份模块实例句柄) |
| `AppDiagnostics`, `diagnostics` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (诊断模块实例句柄) |
| `AppSetup`, `appSetup` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (引导模块实例句柄) |
| `AppContent`, `appContent` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (内容模块实例句柄) |
| `AppViews`, `appViews` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (视图模块实例句柄) |
| `AppCapture`, `appCapture` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (捕获模块实例句柄) |
| `AppModel`, `appModel` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (模型模块实例句柄) |
| `AppPersistence`, `appPersistence` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (持久化模块实例句柄) |
| `AppTransaction`, `appTransaction` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (事务模块实例句柄) |
| `AppItems`, `appItems` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (事项模块实例句柄) |
| `AppNativeCoordinator`, `appNativeCoordinator` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (原生协调模块实例句柄) |
| `AppReview`, `appReview` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (整理模块实例句柄) |
| `AppAlerts`, `appAlerts` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (提醒弹条模块实例句柄) |
| `AppPlatform`, `appPlatform` | let | `bindRuntime` 写, 业务调用读 | 模块级单例 | 保留 | app-core (平台模块实例句柄) |
| `openSheet`, `closeSheet`, `closeAllSheets`, `confirmDialog`, `toast`, `hideToast`, `safeExternalHref` (7项) | let | `bindRuntime` 从 `appUi` 赋值, 业务读 | 装配期绑定 | 保留 | app-core (解构自 AppUi，供启动与装配注入) |
| `FeedbackLib`, `EvidenceLib`, `DatePrimitives`, `UiFormat`, `NativeReminders` (5项) | let | `bindRuntime` 从全局 `AttentionLib` 赋值 | 装配期绑定 | 保留 | app-core (依赖注入源头) |
| `startOfDay` ~ `hasSpecificTimeWord` (17项) | let | `bindRuntime` 赋值, 业务读 | 装配期绑定 | 保留 | app-core (日期/解析原语快捷句柄) |
| `schemaMigrationNeeded` | let | `loadAsync` 写, `init` 读并重置 | 启动流程状态 | 保留 | app-core (存储版本迁移状态) |
| `nativeReady`, `nativeSyncTimer`, `nativeInitPromise`, `nativeReminderStatus` (4项) | let | 原生状态回调写, 视图/排程读 | 运行时状态 | 保留 | app-core (原生环境感知与协同) |
| `restoreRetryInFlight`, `stateRecoveryPanelShown` (2项) | let | `renderStateRecovery`/`retryRestore` 读写 | 故障恢复期 | 保留 | app-core (恢复面板状态) |
| `PROJECT_COLORS`, `state` (2项) | let | 全局读写，`loadAsync` 整体替换 | 应用生存期 | 保留 | app-core (应用核心状态，只通过受控 getState() 对外暴露) |
| `undoNativeCheckPending` | let | `undoNewItem` 写, `onStatusChange` 消费 | 运行时状态 | 保留 | app-core (撤销后原生状态校验标志) |
| `feedbackWaiters` | let | `announceSaveOutcome` 追加, `settleSaveFeedback` 消费清空 | 运行时队列 | **迁出** | `lib/app-action-feedback.js` (保存结果排程回执队列) |
| `globalErrorHandlerInstalled` | let | `installGlobalErrorHandler` 读写 | 单例标志 | 保留 | app-core (全局未捕获异常监听幂等锁) |
| `readyPromise`, `lastStartupFailure`, `initStarted` (3项) | let | `startApp` 读写 | 启动期状态 | 保留 | app-core (启动生命周期与门禁状态) |

---

## 三、顶层主要函数职责与归属划分

| 函数群 / 主要符号 | 原行号 | 职责描述 | 调用方 | P3-I 处置 | 最终归属与理由 |
| :--- | :---: | :--- | :--- | :---: | :--- |
| `readPath`, `runtimeRoots`, `readRuntimePath`, `describeGot`, `describeTypeMismatch`, `missingItemShape` | 589–742 | 依赖路径解析、类型与形状匹配报错机制 | `collectRuntimeBindings` | **保留** | `app-core.js` (依赖门禁诊断基础) |
| `aiRuntimeDeps`, `backupRuntimeDeps`, ..., `platformRuntimeDeps` (10项) | 743–1021 | 组装各个子模块创建时所需的注入依赖对象 | `collectRuntimeBindings` | **保留** | `app-core.js` (实例组装依赖注入线) |
| `collectRuntimeBindings`, `assertRuntimeDependencies`, `bindRuntime`, `renderStartupFailure` | 1022–1783 | 依赖校验门禁核心、实例装配与启动失败提示 DOM | `startApp`, `retryRestore` | **保留** | `app-core.js` (核心启动与装配责任) |
| `describeLoadFailure`, `renderStateRecovery`, `removeStateRecoveryPanel`, `retryRestore` | 1784–1935 | 存储加载失败判定、恢复提示面板与重试流 | `loadAsync`, UI 按钮 | **保留** | `app-core.js` (恢复失败兜底) |
| `itemScheduleEvidence`, `feedbackNativeSnapshot`, `feedbackItemSnapshot`, `feedbackVerdictFor`, `runFeedbackAction`, `announceSaveOutcome`, `settleSaveFeedback` | 2730–2940 | 保存结果与原生排程证据的两段式判定反馈控制器 | `appCapture`, `appNativeCoordinator` | **迁出** | `lib/app-action-feedback.js` (独立保存反馈控制器) |
| `bind()` (含 42 处 DOM 交互与事件委托) | 3499–3896 | 整个界面导航、表单、详情卡片委托、弹层、设置等监听器装配 | `startBusinessStartup` | **迁出** | `lib/app-events.js` (UI 事件绑定控制器，单次绑定防翻倍) |
| `applyShareParams()` | 3479–3496 | Web Share API target / 搜索参数分享解析 | `startBusinessStartup` | **迁出** | `lib/app-events.js` (路由与分享入参编排) |
| `handleQueryActions()` | 3930–3956 | URL query 动作（action=snooze/done）执行与清理 | `startBusinessStartup` | **迁出** | `lib/app-events.js` (深链动作路由) |
| `demoPreviewRows()`, `openDemoPreview()`, `seed()` | 3347–3478 | 演示数据生成、只读示例预览与测试重置数据生成 | `#btnSeed`, `test-boot-combination.js` | **迁出** | `lib/app-events.js` (或演示控制器，与事件统一装配) |
| `installGlobalErrorHandler()` | 3961–4014 | 捕获 window.onerror / unhandledrejection 并弹 toast | `startBusinessStartup` | **保留** | `app-core.js` (入口层全局兜底) |
| `startBusinessStartup()`, `startApp()` | 4015–4153 | 初始化时序编排、恢复、排程启动与心跳定时器 | `DOMContentLoaded` | **保留** | `app-core.js` (应用唯一生命周期中枢) |
| `__ATTENTION_INBOX__` (及 globalThis.seedAttentionInbox) | 4182–4568 | 庞大的测试与自动化诊断开放接口对象构建 | 全量测试集、真机 CDP | **迁出** | `lib/app-test-api.js` (专用测试接口装配模块，同源动态映射实例) |
| 历史前瞻转发函数 (`ackItem`, `completeItem`, `openDetail` 等 ~120 项) | 1936–3346 | 拆分过程中遗留在 core 的过渡性单行包装转发 | `bind`, `__ATTENTION_INBOX__` | **清理/归一** | 大部分由新模块直接通过注入依赖或实例调用，core 仅保留入口必需薄转发 |

---

## 四、事件监听器分布与防翻倍归宿 (51 处)

- **启动故障面板 (2 处)**：`renderStartupFailure` 内 retry / reload，仅在启动失败渲染时挂载；
- **状态恢复面板 (2 处)**：`renderStateRecovery` 内 retry / reload，仅在权威恢复失败时挂载；
- **全局异常拦截 (2 处)**：`installGlobalErrorHandler` 内 error / unhandledrejection，受 `globalErrorHandlerInstalled` 布尔锁保护，只绑一次；
- **启动触发 (1 处)**：`DOMContentLoaded`，只在 loading 时挂载一次；
- **通知条动作 (1 处)**：`renderHomeNotice` 内 notice action 按钮；
- **用户交互监听 (42 处)**：原 `bind()` 内全部 DOM 与 document 委托，全部收敛至 `lib/app-events.js`，受模块私有 `bound` 标志严格防翻倍保护。
