# P2-E `app-setup.js` 迁出：实施任务与独立验收计划

日期：2026-09-22。前置：P2-D 已由独立 run `20260922T160029-independent-p2d-recheck` 判定 PASS。状态：**待其他 agent 实施；原任务继续担任独立验收方。**

## 1. 本批范围

新增 `lib/app-setup.js`，迁出首次提醒设置入口、设置步骤面板、60 秒测试、测试反馈、投递证据展示及测试停铃。采用 UMD + `createAppSetup(deps)`；模块求值零副作用，状态、持久化、原生排程和平台桥仍由现有所有者提供。

当前开工身份必须重新记录；计划时核心身份：

- HEAD / `origin/main`：`3574824357dc7beb04cbd3e32aa413cd508e8484`
- `app-core.js`：`205638c2adf37779350b36badf96f52b1fbed77034b75dc249a033105da84b79`
- `lib/app-diagnostics.js`：`36f91c1b7612628e6b7fab7c6d99560afd132f72ecc6c3df4622ad5df3c78b54`

工作区仍有大量连续交付源码与证据。禁止 checkout/restore/reset/stash/clean，不覆盖旧 run/APK，不提交、不推送，不安装生产包。

## 2. 迁移清单

以符号为准，当前约在 `app-core.js` 6470–6867：

- `maybePromptAndroidNotify`
- `noteFirstRemindSaved`
- `renderSetupEntry`
- `openSetupSheet`
- `SETUP_TEST_ID`、`SETUP_TEST_TITLE`
- `currentTestRun`、`deliveryBelongsToRun`
- `startSetupTestRun`、`stopSetupTestRun`
- `testFeedbackButtonsHtml`
- `setupEvidenceHtml`
- `setupStepsContext`
- `renderSetupSheetBody`
- `updateSetupEntry`
- `runSetupStep`

`bindSetupReviewControls()` 必须再次拆开：`#btnSetup` 归新实例 `bind()`；review snooze、review settings、开关及保存继续留在 core 的 `bindReviewControls()`，不得丢失或双绑。

core 中现有调用点改走同一 setup 实例：

- `renderHome()` → `appSetup.renderSetupEntry()`
- `renderPwaStatus()` → `appSetup.updateSetupEntry()`
- 原生初始化/启动入口 → `appSetup.maybePromptAndroidNotify()`
- 首次保存真实提醒 → `appSetup.noteFirstRemindSaved(item)`
- 测试 hook 的 start/stop/evidence/context → 当前 setup 实例

不得保留算法体或另一份可变 `testRun` 语义。允许为兼容旧调用保留无算法薄转发，但优先直接调用实例。

## 3. 明确保留在 core

- `state`、`save()`、`renderMe()` 与权威写闸门。
- `NativeReminders` 装配、`nativeReminderStatus` 所有权及 `setNativeReminderStatus()`。
- `systemBridge()`、平台访问器和 P2-D diagnostics 实例。
- `writeIfChanged`、通用 UI、格式化与安全输出的现有唯一实现。
- review 业务、设置和事件绑定。

不改 60 秒、测试 ID `90003`、测试标题、权限申请时机、状态字段、反馈文案语义或停铃安全边界；不开始 content/views/capture/P3，不改 Java/Manifest/schema/SW 设计。

## 4. 工厂与实例合同

建议实例合同至少包含：

```text
bind
maybePromptAndroidNotify
noteFirstRemindSaved
renderSetupEntry
updateSetupEntry
openSetupSheet
startSetupTestRun
stopSetupTestRun
setupEvidenceHtml
setupStepsContext
```

若 core 或测试 hook 还调用其他成员，逐项登记并进入 `APP_SETUP_INSTANCE_CONTRACT`；检查与绑定必须使用同一次工厂实例。

所有外部状态用 live getter/函数注入，至少包括：

- DOM/UI：query/queryAll、openSheet、toast、escapeHtml、fmtTime、writeIfChanged；
- 状态：getState、save、renderMe；
- 原生：当前 NativeReminders API、get/setNativeReminderStatus、systemBridge；
- 诊断：openBackgroundGuide、openSystemSetting、labLog、labCancelAlarms、describeAlarmDelivery；
- 规则：当前 Feedback API（setupSteps、testFeedbackVerdict、TEST_FEEDBACK）。

不得缓存 `state.settings`、`nativeReminderStatus`、Feedback 或 diagnostics 的装配时快照。不得注入整个可写 `ctx`，不得另建保存、排钟或停铃路径。

`bind()` 只绑定静态 `#btnSetup`，且实例内幂等。动态 `#setupEntry` 仍由 `renderSetupEntry()` 在 `writeIfChanged()` 真正改写后绑定一次；相同 HTML 短路时不能叠加监听。

## 5. 必须保持的行为

1. 首启不自动弹技术面板；只有首次保存带真实提醒时间且不是 fallback 的事项后，首页出现可跳过入口。
2. 已完成/已关闭/尚未触发 prompt 时首页入口隐藏；Web 非 Android 环境保持隐藏。
3. Feedback 的步骤、缺失数量、理由、拒绝影响与完成状态保持一致，不能把“打开设置页”冒充“已授权”。
4. 60 秒测试只用独立闹钟，不建事项、不进统计；成功/失败后按钮和面板恢复。
5. `testRun` 在排程成功后才保留；重测使旧反馈失效；证据只认本次开始时间之后且标题属于测试的投递。
6. 停铃只处理测试 ID 和匹配 token；同时取消测试排程。读取失败、没活跃投递、真正停住、停不住四种结论继续分开；未确认不得写 `stoppedAt`。
7. 用户反馈写入本次运行并保存一次；`heard/seen/missed/unsure` 语义继续由 Feedback 唯一来源判定。
8. 证据展示继续区分系统排程、通知权限、测试运行、历史投递与本次投递；读不到不冒充“没有在响/没有投递”。
9. notify/exact/background/overlay 步骤继续调用现有原生与 diagnostics 实例；访问设置成功只记录 visited，不宣称能力已经验证。
10. review 控件和 P2-D 诊断面板仍各绑定一次、行为不退化。

## 6. 装配和加载闭环

- 增加 `AppSetup` 必需命名空间、`createAppSetup` 工厂和实例合同；缺脚本、空工厂、工厂抛错、缺成员均在读库/业务启动前可见失败，且 IDB put、排程、心跳为 0。
- `index.html` 在 `app-core.js` 前加载 `lib/app-setup.js`。
- `sw.js` v18 → v19，并加入预缓存。
- 同步 boot EXPECTED、smoke VM、regressions LIB_SOURCES、`production-scripts.js` 的命名空间和实例双向覆盖。
- `scripts/sync-www.js` 预计无需修改，但必须实测源码 → www → Android assets → APK。

## 7. 测试与反例

### 行为测试

- 直接实例化真实 `lib/app-setup.js`，覆盖第 5 节全部分支；旧 test-regressions 中 stop/evidence/context 用例必须继续驱动真实实例，禁止复制实现或切 app-core 源码。
- 证明模块求值零副作用、live getter 生效、静态 bind 幂等、动态入口监听不重复。
- boot 四类失败：缺脚本、空实例、工厂抛错、缺实例成员；纯 Web 完整脚本正常启动。

### 至少四个可执行变异

1. 删除 `deliveryBelongsToRun` 的开始时刻或测试标题约束：旧业务投递被误算成本次，正式断言必须红。
2. 把停铃读取失败当成空数组：错误文案/stoppedAt 断言必须红。
3. 删除 bind 幂等或 `writeIfChanged` 短路：重复监听计数必须红。
4. 清空实例合同或漏掉生产加载清单：静态/运行时闭合必须红。

每条要有 anchor 命中、健康对照、变异结果和临时副本还原证明。

### 浏览器和回归

新增 `scripts/verification/browser-setup-check.py` 或扩充真实生产页面 harness，至少覆盖：

- 纯 Web setup 入口隐藏且应用 ready；
- 假 Android 保存真实提醒后首页入口出现，点击打开 setup sheet；
- 假桥下步骤推进、60 秒测试排程 ID/延时正确，失败恢复；
- 本次反馈与历史反馈分离；
- 停铃读失败不误报成功，确认无投递与真实停住为正向对照；
- 重复 bind/重复 render 不重复触发。

最终执行：完整 `npm test`、改动 JS `node --check`、`git diff --check`、P2-D diagnostics 浏览器 4/4、导入浏览器 11/11、隔离 debug APK 构建及全部 Web 资源逐字节比对。

真机权限、设置、通知和测试闹钟会产生副作用，实施方不执行；明确记 `NOT_PERFORMED`。

## 8. 交接与独立验收

实施 run：`docs/reviews/verification-runs/<timestamp>-p2e-app-setup-extraction/`，至少包含 README、ownership map、完整 source hashes、原始测试/浏览器/变异日志、APK 资源 JSON、repo start/end 和 NOT_PERFORMED。不得改旧 run。

独立验收将重新核对源码身份、唯一实现、live 依赖、setup/review/diagnostics 绑定所有权，重跑完整自动化与浏览器，并独立重造“旧投递误算本次”“读失败冒充空”“重复监听”“漏合同/清单”反例。

## 9. 可直接交给实施 agent 的指令

> 在 `/Users/qlyf/Developer/reminder` 执行本计划 P2-E。接续当前 dirty 工作区，把首次提醒设置入口、设置步骤、60 秒测试、反馈和证据/停铃完整迁到 `lib/app-setup.js`。保留状态、持久化、NativeReminders、平台桥、diagnostics 和 review 的既有所有权；所有状态以 live getter 注入。拆开 setup/review 绑定，保证静态与动态监听不重复。闭合启动闸门、index/SW v19、测试、浏览器和 APK 资源链，完成四类可执行变异及完整交接。不要 checkout/stash/reset/clean，不覆盖旧证据/APK，不提交推送，不安装生产包或执行真机副作用操作。完成后只报告实施自测，交由原任务独立验收。
