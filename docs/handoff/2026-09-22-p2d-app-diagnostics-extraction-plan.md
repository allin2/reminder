# P2-D `app-diagnostics.js` 迁出：实施任务与独立验收计划

日期：2026-09-22。状态：**待其他 agent 实施；本文作者保留独立验收角色，不参与实现。**

本轮只授权执行 **P2-D：把通知实验室、投递判读、闹钟 trace 与系统设置诊断迁出 `app-core.js`**。完成并经独立复验后，再单独开启 P2-E。不得把后续 setup、content/views、capture/form 或 P3 事务与持久化一起塞进本批次。

## 1. 当前基线与现场保护

实施开始前必须重新记录当前值；下表只绑定本文生成时的工作区身份，不能代替开工基线。

| 项目 | 2026-09-22 计划时实测 |
| --- | --- |
| 仓库 | `/Users/qlyf/Developer/reminder` |
| 分支 / HEAD / `origin/main` | `main` / `3574824357dc7beb04cbd3e32aa413cd508e8484` / 同一 SHA |
| 工作区 | 大量已修改与未跟踪源码、证据、脚本和 APK；这些是连续交付现场，不得清理或覆盖 |
| `app-core.js` | 8,996 行，428,089 字节；SHA-256 `c7e0e09fd4bdb4235c4a653cb07232ddb26d54adc04625ca18b5e84de7a47cda` |
| 最近独立基线 | `20260922T142800-independent-p2cs-b1-android-recheck`；自动化 2,462/0，Chrome 导入 11/11 |

硬性保护：

- 禁止 `git checkout`、`git restore`、`git reset`、`git stash`、`git clean`；不得覆盖已有 verification run、APK、设备证据或未跟踪源码。
- 先保存 `git status --short`、HEAD、受影响文件 SHA-256 和基线测试日志；后续数字若变化，以开工实测为准并解释差异。
- 不提交、不推送、不创建 PR；只改本批次明确涉及的文件。
- `app-core.js` 由一个实施 agent 独占修改；不要让另一个 agent 同时切割该文件。
- 不安装或覆盖生产包 `space.alliswell.inbox`，不清设备数据，不操作真实用户事项。

## 2. 本批目标与成功条件

新增 `lib/app-diagnostics.js`，采用现有 UMD + `createAppDiagnostics(deps)` 模式。诊断规则、渲染和动作在该模块中只有一份实现；`app-core.js` 只负责依赖装配、调用实例和保留本轮尚未迁出的 setup/review 绑定。

本批通过必须同时满足：

1. `describeAlarmDelivery`、通知实验室渲染、trace、测试闹钟动作与系统设置诊断由 `lib/app-diagnostics.js` 唯一实现。
2. 模块求值时零副作用：不注册监听、不启动计时器、不访问 state、不调用桥、不写存储。
3. 实例通过活依赖读取当前 state、原生状态和桥；不得捕获装配时快照。
4. `bind()` 只绑定诊断 UI，且重复调用不会重复绑定按钮或 `visibilitychange`。
5. setup/review 控件仍由 core 的独立绑定函数负责，每项恰好绑定一次。
6. AppDiagnostics 命名空间、工厂和实例成员进入现有启动闸门；缺脚本、空工厂、工厂抛错或缺实例成员时，必须在读库和业务启动前可见失败，且无存储、排钟、心跳副作用。
7. `index.html`、Service Worker、所有测试加载清单、生产脚本校验、Android 打包资源链同步闭合。
8. 行为测试、反向变异、真实生产脚本浏览器检查、完整 `npm test` 与本地打包资源比对全部有可复算证据。

文件变小和测试总数增加只作结果记录，不是通过条件。

## 3. 所有权边界

### 3.1 必须迁入 `lib/app-diagnostics.js`

以下为本文生成时的近似行号，实施时以符号为准：

| 当前符号 | 当前约行号 | 迁移要求 |
| --- | ---: | --- |
| `diagnoseSystemBridge` | 6006 | 诊断桥能力与权限快照 |
| `setPill`、`labLog` | 6019、6025 | 仅服务诊断面板的 UI 辅助 |
| `describeAlarmDelivery` | 6044 | 保持纯函数语义和现有测试出口 |
| `renderBackgroundVerdict` | 6139 | 通过 getter 读当前设置、原生状态和待处理通知 |
| `refreshNotifyLab` | 6223 | 诊断刷新总入口 |
| `refreshAlarmTrace`、`labTraceTest` | 6319、6391 | trace 读取、分组、显示和测试排程 |
| `labShowNow`、`labScheduleAlarm`、`labCancelAlarms` | 6406、6428、6461 | 通知/测试闹钟动作与错误恢复 |
| `labRequestNotify` | 6484 | 显式用户操作后才改设置并走现有唯一 `save()` |
| `openBackgroundGuide`、`openSystemSetting` | 6509、6561 | 设置导航、busy 与如实反馈 |
| `autoStartLanding`、`openAutoStartHonest` | 6595、6597 | 作为实例内状态和动作迁移 |
| `bindNotifyLab` 的诊断部分 | 6633–6695 | 改为实例 `bind()`；只拥有诊断按钮及一个可见性监听 |

外部现有调用必须改为同一实例：`refreshNotifyLab()`、`labLog()`、`labCancelAlarms()`、`describeAlarmDelivery()`。`__ATTENTION_INBOX__.describeAlarmDelivery` 可保留兼容测试入口，但必须转发到已装配实例，不能保留算法体。

### 3.2 本轮明确保留在 `app-core.js`

- `systemBridge()`、`isNativeAndroidRuntime()`、`waitForNativeBridge()`、`appSettingsPlugin()`：它们被诊断之外的 setup、active alarm、启动和复核流程共用，后续归 `app-platform`；本轮以函数依赖注入。
- `bindNotifyLab()` 现有的 `#btnSetup` 绑定，以及 `[data-snooze-review]`、`#btnReviewSettings`、`#swReviewEnabled`、`#btnSaveReviewSchedule` 等 review 绑定。应从原函数明确拆成 core 侧具名绑定函数，不能随诊断模块搬走或丢失。
- setup 流程本身及其 `labLog()` / `labCancelAlarms({quiet:true})` 调用；只把调用改到诊断实例。
- 状态所有权、`save()`、`renderMe()`、原生同步、排程算法和权限策略。

### 3.3 禁止顺带处理

- 不改诊断文案含义、按钮、权限申请时机、闹钟 ID、测试延时、设置落点或通知策略。
- 不改 Java、Manifest、Capacitor 插件、schema、存储后端、事务或 Service Worker 设计。
- 不抽 `app-platform`、`app-setup`、`app-review`；不开始 P3。
- 不为了消除循环依赖注入整个可写 `ctx`，不建立第二条保存或原生同步路径。

## 4. 模块合同与装配要求

沿用 `lib/app-ai.js` / `lib/app-backup.js` 的 UMD 形式：浏览器导出 `AttentionLib.AppDiagnostics`，Node 导出模块对象；公开工厂为 `createAppDiagnostics(deps)`。模块不得读取 `AttentionLib`、不得反向导入 `app-core.js`。

建议按实际消费收敛依赖，至少包含下列类别；每个会随重试或状态更新变化的依赖都以函数或 getter 注入：

- DOM/UI：`query`、`queryAll`、`openSheet`、`toast`、`fmtTime`、当前 document/可见性监听能力；
- 活状态：`getState`、`save`、`renderMe`；
- 平台：`systemBridge`、`appSettingsPlugin`、Capacitor/LocalNotifications 的当前访问器；
- 原生状态：`getNativeReminderStatus`、`setNativeReminderStatus`；
- 已有命令：通知权限请求、精确闹钟设置、`buildDesired`、原生重排/对账。

不得缓存 `state.settings`、`state.items`、`nativeReminderStatus` 或 bridge 实例的旧值。`refreshAlarmTrace()` 和 `renderBackgroundVerdict()` 每次执行时都读取当前值。

实例合同应明确列出 core 真正需要的成员，并进入 `APP_DIAGNOSTICS_INSTANCE_CONTRACT`。建议最小公开成员：

```text
bind
refreshNotifyLab
labLog
labCancelAlarms
describeAlarmDelivery
```

若测试或 core 需要额外成员，逐项登记用途；不得导出整个内部对象逃避合同。实例创建、合同检查和 core 绑定必须来自同一次工厂调用，不能检查 A 实例却运行 B 实例。

`bind()` 要有实例内幂等闸门。诊断面板按钮、`#labResync` 和 `visibilitychange` 各绑定一次；第二次调用不得让刷新、排程、取消或日志执行两遍。模块求值阶段不得设置这个闸门或绑定任何东西。

## 5. 实施步骤

### D0：冻结基线

1. 记录 repo/HEAD/dirty、相关源码哈希、当前生产脚本顺序。
2. 运行完整 `npm test`；保存原始输出和退出码。
3. 生成“旧符号 → 新模块成员 → core 调用点 → 测试”搬移表，特别标出 setup/review 混合绑定。

出口：基线可复算；历史 2,462 仅作对照，不能直接继承为本轮 PASS。

### D1：先建模块与行为测试

1. 新建 UMD 模块；先迁纯函数 `describeAlarmDelivery`，复用现有独立期望值。
2. 迁渲染/动作/设置导航；用活依赖和实例内 `autoStartLanding`。
3. 补模块求值零副作用测试、依赖缺失报错和实例 API 合同测试。

出口：模块可在 Node/VM 单独实例化，且没有 app-core 源码切片。

### D2：拆绑定并接回生产实例

1. 从 `bindNotifyLab()` 中只抽诊断绑定为 `diagnostics.bind()`。
2. core 留下明确的 setup/review 绑定函数，保持原启动顺序和单次绑定。
3. 所有 core/setup/test hook 调用改走 `diagnostics` 实例；删除旧实现体和旧可变状态。
4. 在 `collectRuntimeBindings()` / 当前等价装配路径中加入 AppDiagnostics 命名空间、工厂及实例成员检查。

出口：core 无诊断算法副本，setup/review 无孤立控件或重复监听。

### D3：闭合加载与生产清单

同步更新：

- `index.html`：在 `app-core.js` 前加载 `lib/app-diagnostics.js`；
- `sw.js`：资源列表加入新脚本，缓存名 v17 → v18；
- `test-boot-combination.js` 的 `EXPECTED_INDEX_SCRIPTS`；
- `test-smoke.js` 的 VM 加载；
- `test-regressions.js` 的 `LIB_SOURCES`；
- `scripts/verification/production-scripts.js`：加入 AppDiagnostics 命名空间与实例覆盖，复用已有双向闭合检查；
- Android/www 同步与 APK `assets/public` 资源清单。

`scripts/sync-www.js` 当前会复制 `lib/*.js`，预计不需改代码，但必须实测新文件确实进入 www 和 APK。新模块不能仅存在源码目录。

### D4：反例、浏览器与打包自测

按第 6 节完成目标测试、四类变异、生产页面浏览器检查、全量测试和资源逐字节比对。变异只在临时副本运行，工作区源码必须按 SHA 还原。

### D5：交接

建立新 run：

`docs/reviews/verification-runs/<timestamp>-p2d-app-diagnostics-extraction/`

不得改写任何旧 run。交接内容见第 7 节。

## 6. 实施方必须自证的验收矩阵

### D-A 行为保持

1. `describeAlarmDelivery` 保留现有全部分支：无尝试、已可见/`shownAt`、通知关闭、native/activity/none/unknown carrier、通话中解锁、投递时 FSI/overlay 快照优先、`exactAtDelivery=false`、`notificationPosted` 与用户可见性的区别。
2. `renderBackgroundVerdict` 覆盖：原生未初始化、用户通知关闭、系统权限拒绝、reconcile 错误、`getPending` 缺失/抛错、pending=0 且 desired>0、两者均 0、pending>0 但上次投递不可见。
3. `refreshNotifyLab`：桥不可用时如实显示且不写状态；桥可用时渲染权限、投递和 trace；系统权限已授予不能静默把用户的 `settings.notify` 改成 true。
4. `labRequestNotify` 只有明确点击后才改设置，恰好保存一次，然后渲染并刷新。
5. 设置导航保持 busy 防重入，成功/失败都恢复按钮；unsupported、应用详情、实际组件、unknown 落点文案真实；只打开设置不能宣称权限已开启。
6. 测试动作覆盖立即通知、10 秒/60 秒闹钟的成功/失败/按钮恢复；取消 ID 必须保持 `90002`、`90003`、`-917010`、`-917060`、`-917120`，并保留 `{ok,error}` 返回语义。
7. trace 覆盖分组与格式、桥缺失和读取异常。

### D-B 绑定与集成

1. 每个诊断按钮只绑定一次；只注册一个 visibility 监听；第二次 `bind()` 不增加调用次数。
2. setup 和 review 控件仍能各执行一次；不能因拆分失去绑定，也不能由 core 与新模块双绑。
3. setup 的测试排钟、停止/取消和投递描述调用真实 diagnostics 实例。
4. `__ATTENTION_INBOX__.describeAlarmDelivery` 与模块实例是同一路径，测试不得保留第二份算法。

### D-C 启动闸门

分别构造：缺 `lib/app-diagnostics.js`、工厂空壳、工厂抛错、实例缺一个合同成员。每种都要求：

- `ready=false`；可见失败面板逐项点名 AppDiagnostics；
- IDB open/put 为 0；不排通知/闹钟；不启动业务心跳；
- 完整脚本但无 Capacitor 的纯 Web 环境仍能启动，打开诊断时才显示平台不可用。

### D-D 唯一实现与反向变异

静态检查必须证明：旧诊断实现体不在 `app-core.js`，其他模块也没有复制；新模块不反向读取 core；模块求值副作用为零。

至少四个正式测试在对应变异下变红：

1. 摘掉 `describeAlarmDelivery` 的 carrier 或投递快照优先级；
2. 摘掉 `bind()` 幂等闸门，证明重复按钮/visibility 监听能被抓住；
3. 从实例合同删一个实际使用成员，证明双向覆盖检查会失败；
4. 从任一生产加载清单漏掉 `lib/app-diagnostics.js`，证明加载链闭合检查会失败。

### D-E 真实生产脚本浏览器检查

新增 `scripts/verification/browser-diagnostics-check.py`，或在现有真实生产页面 harness 中加入等价用例。不得复制诊断算法。至少检查：

- Web/无桥：应用正常 ready，打开诊断显示 unavailable，不崩溃、不写状态；
- 完整假桥：权限、pending、上次投递、后台 verdict 和 trace 与注入值一致；
- 重复打开/前后台恢复：一次事件只触发一次刷新；
- 设置导航失败：busy UI 恢复，可再次点击，日志如实显示失败。

保存结构化 JSON、原始控制台和退出码。

### D-F 全量与产物

- `npm test` 退出 0；记录六套各自数字，不能只报总数；
- `node --check lib/app-diagnostics.js app-core.js`，以及所有改动 JS；
- `git diff --check`；
- 重跑此前与共享加载链相关的 Chrome import 11/11，证明新增脚本未破坏备份导入；
- 在隔离输出构建 APK，逐文件比对源码 → www → Android assets → APK。此前为 22 个 Web 资源；新增运行脚本后应按实际清单重新计数，预计 23，不能硬编码旧数；
- 不覆盖 `releases/` 既有候选，不安装生产包。

真 Android 的“刷新诊断”可在后续独立验收中用隔离包只读核验。申请权限、打开系统设置、发送通知、排测试闹钟会产生设备副作用，实施方本批不执行；如未另获授权，明确记 `NOT_PERFORMED`，不能用浏览器假桥写成真机 PASS。

## 7. 实施交接包

run 目录至少包含：

- `README.md`：开工/收尾 HEAD、dirty、源码哈希、变更范围、命令、退出码、结论；
- `ownership-map.md`：符号搬移、公开合同、live getter、保留 core 符号、setup/review 绑定归属；
- `source-hashes.txt`：所有改动、新增及生产加载清单文件；
- 基线/最终 `npm test` 原始日志，各目标套件日志；
- 四个变异的变异内容、原始红灯、退出码与还原后 SHA；
- 浏览器 JSON/日志；
- APK 路径与 SHA、构建命令、逐资源比对清单；
- `not-performed.md`：只列真实未执行项和原因；继承旧证据必须标 `INHERITED_EVIDENCE`。

最终交接回复必须给出 run、`lib/app-diagnostics.js` 和关键测试脚本的可打开路径，并明确“实施方自测，不是独立 PASS”。

## 8. 独立验收安排

本文作者收到交接后按下列顺序复验，不以实施报告代替观察：

1. 锁定工作区源码身份，确认未覆盖旧证据，核对 diff 只在 P2-D 范围。
2. 审查依赖方向、活绑定、绑定幂等、setup/review 所有权和旧实现清除情况。
3. 重跑目标测试、完整 `npm test`、生产加载闭合和模块求值副作用探针。
4. 独立重造至少四个反例：投递快照优先、重复绑定、缺实例成员、漏生产脚本。
5. 独立运行真实生产页面浏览器用例与 import 11/11 回归。
6. 独立构建候选并逐字节核对运行资源。若当时设备与授权允许，仅对隔离包做只读诊断刷新；有副作用的权限/设置/通知/闹钟操作单独列明授权和结果。

判定：

- **PASS**：源码唯一实现、启动闸门、绑定、浏览器、全量测试和产物链全部闭合；允许把未授权的真机副作用用例单列 `NOT_PERFORMED`，但不得冒充目标设备行为已验。
- **FAIL / FIX_REQUIRED**：存在双实现、旧函数体/可变状态残留、setup/review 绑定丢失或重复、模块求值有副作用、缺模块仍可进入业务启动、生产清单漏项，或任何行为反例回归。
- **NOT_PERFORMED**：只用于客观未执行的证据层级，不能覆盖源码或自动化阻断项。

P2-D 独立通过后才排下一批：P2-E `app-setup` → P2-F `app-content` / `app-views` → P2-G `app-capture`；各批单独实施、单独验收。P2 全部闭合后再进入 P3 的模型、持久化、事务、事项和原生协调。

## 9. 可直接交给实施 agent 的指令

> 在 `/Users/qlyf/Developer/reminder` 执行本文 P2-D。先冻结当前 dirty 工作区和测试基线，只把通知实验室、投递判读、trace 与系统设置诊断迁到 `lib/app-diagnostics.js`。保留 core 的共享平台访问器与 setup/review 绑定，使用 live getter 注入，禁止双实现、反向依赖和模块求值副作用。闭合启动闸门、生产加载、SW、测试及 Android 资源链；完成行为测试、四类变异、真实生产脚本浏览器检查、完整回归和隔离构建，产出新的 verification run。不要 checkout/stash/reset/clean，不覆盖旧证据或 APK，不提交、不推送，不安装生产包。最终交付仍是实施方自测，交由原任务独立验收。

