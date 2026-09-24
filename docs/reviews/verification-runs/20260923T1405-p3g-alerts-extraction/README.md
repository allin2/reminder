# P3-G 实施自测报告：提醒与活动闹钟（Alerts）模块化拆分

> **实施方声明**：本文档为实施方自测交接记录，并非独立验收结论。全部自测结论均表述为“实施方自测通过”，最终结果待独立复验方复核断定。

---

## 1. 任务背景与工作区保护

- **任务目标**：将 `app-core.js` 中的 Web 提醒弹条、到期 tick、活动原生闹钟面板及其轮询完整迁至唯一实现 `lib/app-alerts.js`；保持现有用户行为、持久化和原生事务语义；严格不顺带实施 P3-H 入口收尾或 P4 离线升级验收。
- **工作区基线**：
  - Git HEAD: `3574824357dc7beb04cbd3e32aa413cd508e8484`（分支 `main`）
  - 严格不执行任何破坏性 git 操作（无 `checkout`、`reset`、`stash`、`clean`、`commit`、`push`）
  - 保留所有既有未提交改动与历史复验目录，无覆盖、无删除
- **历史候选保护**：
  - 严格保护前序候选：`releases/candidates/20260923T1135-p3f-candidate/app-debug.apk`
  - 现场实测 SHA-256：`f61e1849e3e2c3de4c7b40421a40ae19e07042a472c2992b39a2b4ed6b2aa379`（完全一致，未被触碰）
  - 本轮全新候选写入唯一隔离路径：`releases/candidates/20260923T1405-p3g-candidate/app-debug.apk`
  - 实测 SHA-256：`bc87fe0530330ab3011af2b3254b784fcc94a429ac34c470dca6b6f15b7f2783`

---

## 2. 变更内容清单

### 2.1 模块创建：`lib/app-alerts.js`
- **定位**：Web 提醒弹条、到期 tick、活动原生闹钟面板及其轮询唯一权威实现。
- **模块规范**：UMD 工厂，通过 `createAppAlerts(deps)` 装配。求值与工厂创建期 **0 IO、0 状态变更、0 全局事件监听、0 原生桥调用**。
- **依赖校验**：严格校验 **29** 项必需依赖函数与访问器（缺少任一项立即抛出具名异常）：
  `getState`, `save`, `bumpRev`, `runUserOp`, `committedItemById`, `systemBridge`, `handleAlarmAction`, `alarmEventSeen`, `promoteDue`, `maybeReviewSession`, `priorityRank`, `shouldRealert`, `markReminded`, `hasKnownRev`, `isTerminal`, `toast`, `escapeHtml`, `updateAppBadge`, `renderHome`, `renderStats`, `query`, `queryAll`, `ackItem`, `completeItem`, `openSnoozeSheet`, `snoozeItem`, `openDetail`, `openReviewSession`, `isNativeAndroid`。
  另外支持可选依赖 `now` 与 `shouldSuppressInnerSave`。
- **契约闭合**：实现并导出 17 个实例方法：
  `showAlert`, `hideAlert`, `dismissAlert`, `applyAlertDismissal`, `shouldSkipAlert`, `showSystemNotification`, `tick`, `getAlertItem`, `clearAlert`, `bindAlertControls`, `handleNotificationAction`, `deliveryHandledByCommittedItem`, `completeActiveAlarm`, `refreshActiveAlarmPanel`, `startPolling`, `stopPolling`, `onVisibilityChange`。
- **关键设计保障与复验问题修复**：
  - **动态 state 读取**：所有方法通过 `deps.getState()` 获取活值，不闭包捕获旧 items 或 settings 引用；
  - **按钮绑定幂等性修复**：针对独立复验反馈的重复绑定导致多个关闭监听器的缺陷，在模块内维护 `alertControlsBound` 布尔门禁，多次调用 `bindAlertControls()` 仅注册一次事件监听；
  - **关闭保存失败与事务抑制修复**：
    - `dismissAlert()` 采用异步等待持久化；
    - 在执行 `deps.save()` 之前判断 `deps.shouldSuppressInnerSave()`，若处于事务内（抑制保存）则视为正常成功；
    - 若 `deps.save()` Promise 拒绝或抛出异常，不再向用户虚报成功（不展示提示条，方法返回 `false`）；仅当持久化成功或保存被合法抑制时才收起弹条、展示“已关闭提醒 · 事项仍在首页”并返回 `true`；
  - **“×” 30 分钟抑制且不改变状态**：`dismissAlert()` 调用 `deps.runUserOp(applyAlertDismissal, [id, now + 30m])`，写入内存 `dismissedAlerts[id] = now` 与事项 `dismissedUntil`，事项状态保持 `due`（不标记 ACK 或已完成）；
  - **10 分钟自动收起纯展示、零记账**：10 分钟自动隐藏仅操作界面 DOM，不写入 `dismissedAlerts`，不消耗提醒预算，不修改事项；
  - **活动原生闹钟面板与事务安全**：“停止声振”仅调用 `bridge.stopAlarmDelivery`，不修改事项状态；“完成事项”必须先经由 `handleAlarmAction` 提交落库，若落库失败或未确认，严禁关停声振；
  - **定时器单所有权与幂等管理**：`startPolling()` 启动前主动调用 `stopPolling()`，清理旧句柄，避免多重注册导致定时器泄漏；测试夹具与沙箱 timer 均支持 `unref` 及显式 `clearAlert()`，避免进程悬挂。

### 2.2 核心文件瘦身与接入：`app-core.js`
- 移除 core 中内联的 alertItem、dismissedAlerts、alertAutoHideTimer、activeAlarmPollTimer、tickTimer 状态及内联实现；
- 增加 `AppAlerts` 依赖声明与 `APP_ALERTS_INSTANCE_CONTRACT`（17 个实例成员）；
- `collectRuntimeBindings()` 中执行 `AppAlerts` 启动闸门校验与实例装配，注入包含 `shouldSuppressInnerSave: () => shouldSuppressInnerSave()` 在内的完整依赖；
- 保留所有向后兼容薄委托函数，全部直达 `appAlerts.<method>()`；
- `bindEvents()` 中委托 `appAlerts.bindAlertControls()`；
- `registerPwa()` 中 SW `notification-action` 委托 `appAlerts.handleNotificationAction(data)`；
- `bindNetwork()` 中 visibilitychange 委托 `appAlerts.onVisibilityChange()`；
- `init()` 中启动轮询与初始 tick 委托 `appAlerts.startPolling(); appAlerts.tick();`；
- 在 `__ATTENTION_INBOX__` 导出 `clearAlert`、`get alerts()` 与 `APP_ALERTS_INSTANCE_CONTRACT`。

### 2.3 生产清单与缓存契约
- **`index.html`**：在 `lib/app-review.js` 之后引入 `<script src="lib/app-alerts.js"></script>`。
- **`sw.js`**：
  - 缓存版本从 `attention-inbox-v32` 推进至 `attention-inbox-v33`；
  - `ASSETS` 静态资源清单增补 `"./lib/app-alerts.js"`。
- **`scripts/verification/production-scripts.js`**：
  - 导出 `alertsInstanceCoverage`，与 `APP_ALERTS_INSTANCE_CONTRACT` 双向闭合对齐。

### 2.4 测试套件与线索补充
- **`test-smoke.js`**：沙箱 VM 环境同步加载并运行 `lib/app-alerts.js`，3g 断言适配 `libAppAlerts`。
- **`test-regressions.js`**：`LIB_SOURCES` 增补 `"lib/app-alerts.js"`。
- **`test-native-reminders.js`**：N-03 面板轮询句柄检查适配 `lib/app-alerts.js`。
- **`test-boot-combination.js`**：
  - `EXPECTED_INDEX_SCRIPTS` 增补 `"lib/app-alerts.js"`；
  - 增补 `alertsInstanceCoverage` 双向闭合测试及契约/转发缺失的反向变异测试；
  - 增补 `assertAlertsBootFailure`（缺脚本、空命名空间、工厂抛错、缺 17 项契约成员共 20 项启动失败路径）；
  - 增补正向 `AppAlerts` 生产链装配与方法可用性断言。
- **`package.json`**：`"test"` 脚本增补 `node scripts/verification/p3g-alerts-tests.js`。
- **`scripts/verification/p3g-alerts-tests.js`**：
  - 包含 10 组健康测试（含重复绑定幂等性测试 6b、保存失败返回 false 且不提示测试 4b、事务抑制测试 4c 等）；
  - 包含 4 项临时源变异测试（30m 抑制篡改、自动收起错误记账、闹钟完成保存失败绕过、重复轮询定时器泄漏），全部变红捕获；
  - 沙箱 timer 挂载 `.unref()` 并在各用例后调用 `clearAlert()`，确保进程在毫秒级正常退出。
- **`scripts/verification/browser-alerts-check.py`**：
  - 无头 Chrome 真实环境：注入 mock `SystemBridge` 验证活动闹钟面板渲染及停止声振交互；
  - 逐项断言布尔条件，并在遇到任何错误时明确返回非零退出码退出。

---

## 3. 验证结果汇总（实施方自测）

### 3.1 独立复验反例脚本执行（`repro-alerts-gaps.js`）
```
{"case":"repeat-bind","listenerCount":1,"toastCount":1,"expected":1,"duplicateBinding":false}
{"case":"save-rejected","result":false,"toasts":[],"falseSuccess":false}
EXIT CODE: 0
```

### 3.2 单元与变异测试（`p3g-alerts-tests.js`）
```
healthy checks passed
dismissSuppressionMutant: 30m suppression duration modified: mutation detected
autohideAccountingMutant: auto-hide records to dismissedAlerts: mutation detected
activeAlarmDoneSaveFailMutant: stopAlarmDelivery called even when handleAlarmAction fails: mutation detected
timerLeakOnDuplicateStartMutant: startPolling does not call stopPolling: mutation detected
lib/app-alerts.js before/after SHA-256 match: 142746c1e0d26953d05853e993b2010222175ce3ec804e0f0e2329a2d82a9270
```

### 3.3 组合启动测试（`test-boot-combination.js`）
```
========== 生产组合启动测试结果 ==========
通过: 890  失败: 0
全部通过。
```

### 3.4 原生提醒测试（`test-native-reminders.js`）
```
========== native reminder results ==========
通过: 324  失败: 0
全部通过。
```

### 3.5 全量 `npm test` 套件
完整日志归档于同目录 [`p3g-npm-test.log`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1405-p3g-alerts-extraction/p3g-npm-test.log)。
- `test-unit.js`: 通过 642 项，失败 0 项
- `test-native-reminders.js`: 通过 324 项，失败 0 项
- `scripts/verification/p3a-model-tests.js`: PASS
- `scripts/verification/p3b-persistence-tests.js`: PASS
- `scripts/verification/p3c-transaction-tests.js`: PASS
- `scripts/verification/p3d-items-tests.js`: PASS
- `scripts/verification/p3e-coordinator-tests.js`: PASS
- `scripts/verification/p3f-review-tests.js`: PASS
- `scripts/verification/p3g-alerts-tests.js`: PASS (10 healthy + 4 mutants)
- `test-boot-combination.js`: 通过 890 项，失败 0 项
- `test-smoke.js`: 通过 266 项，失败 0 项
- `test-regressions.js`: 通过 730 项，失败 0 项
- `scripts/verification/parse-single-source.js`: 通过 160 项，失败 0 项
**累计通过全部测试（计分项 3012 项 + 全部专项测试与变异测试），失败：0 项**。

### 3.6 浏览器真实 DOM 行为（`browser-alerts-check.py`）
```json
{"ready": true, "hasAlerts": true, "hasAllContract": true, "contractLength": 17, "bannerShown": true, "bannerCrit": true, "titleText": "🚨 关键提醒", "bodyText": "重要火警演习 · 请在十分钟内疏散", "bannerClosed": true, "skippedNow": true, "panelExists": true, "panelVisible": true, "panelRenderedCard": true, "alarmDeliveryStopped": true}
All browser alerts checks PASSED
```

---

## 4. 34 项五层 Web 资源哈希核对

核验范围涵盖 34 个 Web 资源（27 个 `lib/` 脚本 + 7 个根目录文件）：
- `source`（根目录）
- `www`（Capacitor 导出）
- `android-assets`（Android 主工程静态资源）
- `intermediate`（Gradle 编译产物合并目录）
- `apk`（新生成候选包内部资源）

核验脚本：[`verify-resources.py`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1405-p3g-alerts-extraction/verify-resources.py)
核验结果：
```
source-resource-count=34
mismatch-count=0
apk-sha256=bc87fe0530330ab3011af2b3254b784fcc94a429ac34c470dca6b6f15b7f2783
```
- 资源总数：**34** 项
- 五层不匹配（mismatch）：**0** 项
- 缺失（missing）：**0** 项
- 逐文件比对清单参见同目录 [`resource-hashes.tsv`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1405-p3g-alerts-extraction/resource-hashes.tsv)。

---

## 5. 核心文件 SHA-256 汇总

详细见同目录 [`source-hashes.txt`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1405-p3g-alerts-extraction/source-hashes.txt)。

| 文件路径 | 现场 SHA-256 | 说明 |
| --- | --- | --- |
| `app-core.js` | `8b7ea24032bf187befdb7fb7f85df89c65306346fde4f58f911eecb83a047bac` | P3-G 瘦身后核心装配脚本 |
| `lib/app-alerts.js` | `142746c1e0d26953d05853e993b2010222175ce3ec804e0f0e2329a2d82a9270` | 本轮新抽取提醒与活动闹钟 UMD 模块 |
| `sw.js` | `ec78a1840ebd1f49ee7459ea34cd8ce7564cce4cd146f65822808dcc65f625fe` | 升级至 `v33` 并包含 `lib/app-alerts.js` |
| `index.html` | `15e575822ad4c7f0834553ea43fb7c593a46e544b0082f83d4cecd16c9b6ac4e` | 引入 `lib/app-alerts.js` |
| `releases/candidates/20260923T1135-p3f-candidate/app-debug.apk` | `f61e1849e3e2c3de4c7b40421a40ae19e07042a472c2992b39a2b4ed6b2aa379` | 历史前序候选（受保护，未触碰） |
| `releases/candidates/20260923T1405-p3g-candidate/app-debug.apk` | `bc87fe0530330ab3011af2b3254b784fcc94a429ac34c470dca6b6f15b7f2783` | 本轮全新生成的候选 APK |

---

## 6. 未执行项与不适用声明（NOT_PERFORMED）

- **真机声振响铃实测（NOT_PERFORMED）**：物理硬件声振依赖真实移动设备，在无头沙箱与自动化测试套件中已通过 Android APK 构建、Bridge 桩交互、无头 Chrome 以及单元测试全面验证。
- **真实跨版本离线缓存升级验收（NOT_PERFORMED）**：离线缓存全量迁移属 P4 验收范围；本轮已将 SW cache 版本升级至 `attention-inbox-v33` 并将 `./lib/app-alerts.js` 纳入预缓存资源清单，严格遵循非目标边界，不提前声明离线升级验收。
