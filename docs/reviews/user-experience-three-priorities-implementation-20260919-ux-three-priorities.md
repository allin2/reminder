# 安心收件箱：三个优先项实施报告

- 方案依据：`docs/handoff/2026-09-19-user-experience-three-priorities.md`（方案版本 1）
- run-id：`20260919-ux-three-priorities`
- 报告日期：2026-09-19（23:30 CST）
- 实施者：本轮实施 agent。**本文是实施者自测记录，不构成独立验收。**

---

## 0. 结论速览（分开给结论）

| 面 | 结论 | 依据 |
|---|---|---|
| P1 实现覆盖（T01 / T02 / T03 / T04） | **已落地，T02 有一处明确的规格缺口、T04 有证据缺口** | §3 |
| P2 实现覆盖（C01 / C02 / C03） | **已落地** | §3 |
| P3 实现覆盖（A01 / A02 / A03） | **已落地** | §3 |
| Web 交互验收（V01–V04、V13、V16、V17） | **PASS**（59 条断言全绿，含 12 张场景截图） | `docs/reviews/verification-runs/20260919-ux-three-priorities/web/` |
| 行为测试（V05–V15 的主体） | **PASS**（JS 1475 条 + Android 19 条，全绿） | §5 |
| Android 构建 | **PASS**（debug + release 均构建成功、release v1/v2/v3 签名校验通过、APK 内 Web 资源与当前源码逐字节一致、新原生类在 dex 中） | §5、§8 |
| 当前候选真机（身份 / 数据保全 / 原生证据通路） | **PASS**（设备 APK sha256 与候选逐字节一致；既有 36 条事项、2 条笔记、3 个项目原样保留；原生证据通道在真机可用并声明了保留策略） | `.../device/` |
| 各实机场景（V18 / V19 / V20） | **NOT_PERFORMED**（原因、以及为什么本轮改动不会改变这些格的结果，见 §4；同时**明确列出**一个因此未被实测的、由本轮引入的行为） | §4、§9.2 |
| 仍未解决的 OEM 可靠性（冷进程投递黑洞 D70） | **未修，且本轮没有尝试修** | §9.3 |

一句话：**Web 与行为测试层是绿的；真机层只完成了「身份 + 数据保全 + 只读通路」这三件不需要改变设备现场的事；投递场景矩阵整块留空，并且其中一格（收件路径上的证据写入）是我本轮新引入的、真机未实测的行为。**

---

## 1. 身份、环境与保护边界

### 1.1 起点（开工时记录，见 `.../BASELINE.txt`）

- 仓库 `/Users/qlyf/Developer/reminder`，分支 `main`，HEAD `8d1c2617cff3aac5c4450a949c9044b79f63a673`（与交接文档第 19 行一致）。
- **HEAD 不是当前源码的身份**：开工时已有 22 个 tracked 修改 + 大量 untracked（含上一轮提醒机制/冷进程排查的全部实现与证据）。本轮**没有** reset、没有新建 worktree、没有丢弃任何他人修改。
- 开工时 `releases/安心收件箱-debug.apk` 已被上一轮改过（工作区 `186c28b9…`，HEAD 里是 `cb6a9217…`）——这个差异在本轮开工前就存在，不是本轮造成的。

### 1.2 环境

| 项 | 值 |
|---|---|
| 构建 | JDK 17.0.20.1 (Temurin)、Android SDK build-tools 34.0.0、Gradle wrapper（AGP 8.2.1） |
| 设备 | OPPO PKC130，Android 16（API 36），`PKC130_16.0.10.500(CN01)`，serial `QSKFAE95CQEUJZ8L` |
| 设备语言 | zh-CN，24 小时制 |
| 取证浏览器 | 本机 Google Chrome，无头 + CDP（零依赖驱动器） |

### 1.3 保护边界（本轮实际遵守情况）

| 约束 | 遵守情况 |
|---|---|
| 不提交、不推送、不建 PR | ✅ `git status` 无新提交；HEAD 仍为 `8d1c261` |
| 不覆盖既有 APK / 冻结候选 | ✅ 构建前把 `releases/安心收件箱-debug.apk` 备份到 `/tmp/ux3p-apk-backup/`，构建后**按字节还原**（sha256 复核 `186c28b9…`）；`releases/安心收件箱-release.apk` 本轮构建前不存在，构建后已删除恢复原状 |
| 不清空用户数据、不卸载 | ✅ 用 `adb install -r` 覆盖安装，未 uninstall、未 `pm clear`；安装后实测 36 条事项原样 |
| 不改变设备设置 | ✅ 本轮**没有**修改任何系统设置、没有重启设备、没有制造冷进程 |
| 不覆盖既有证据目录 | ✅ 只新增 `docs/reviews/verification-runs/20260919-ux-three-priorities/` |
| 不新增运行时依赖 | ✅ 新增的只有两个 UMD 纯逻辑模块与一个 Java 类；驱动器零依赖（Node 22 自带 fetch/WebSocket） |

两处**非**零副作用，如实记录：

1. 覆盖安装了候选**调试版**到真机（`-r`，保留数据）。这是交接文档 §9.3 明确要求的动作，也是「APK sha256 与被测设备一致」唯一可能的做法。
2. 构建脚本会顺带重写 `releases/安心收件箱-release.apk.idsig`（该文件被 `.gitignore` 忽略、且它原本描述的 release APK 在开工前就已不存在）。为免留下一个描述「已删除 APK」的签名副档，本轮把它删除了。

---

## 2. 交付概览

### 新增文件

| 路径 | 作用 |
|---|---|
| `lib/feedback.js` | UX-T01/T02/A01/C02 的**判定层**：保存/排程两段式反馈、动作语义、识别摘要、首用步骤、测试反馈 |
| `lib/delivery-evidence.js` | UX-T03 的**判定层**：证据归一化/幂等合并/事后核查三态（**没有 `missed`**） |
| `android/.../DeliveryEvidenceStore.java` | UX-T03 的**原生持久台账**：DE 存储、7 天 / 300 行保留、身份不完整拒绝、幂等保留最早回执、绝不抛 |
| `android/app/src/test/java/space/alliswell/inbox/DeliveryEvidenceStoreTest.java` | 10 例行为测试（手写 `ContextWrapper` 替身，不用 Mockito、不碰 `SDK_INT`） |
| `docs/reviews/verification-runs/20260919-ux-three-priorities/**` | 本轮证据（Web 运行 + 真机只读） |
| `docs/reviews/verification-runs/20260919-ux-three-priorities/web/drive.cjs`、`device/probe.cjs` | 可复现的零依赖取证脚本 |

### 修改文件（要点）

| 路径 | 改动 |
|---|---|
| `app-core.js` | 空首页拆容器、首启不 seed、主动演示只读预览、两段式保存反馈、有限撤销、送达证据回流接线、`updateParseHint` 低置信度不再预填兜底时间 |
| `index.html` | 新增 `#homeStart` 兄弟容器 + 其 CSS；**挂载 `lib/feedback.js` 与 `lib/delivery-evidence.js`** |
| `sw.js` | 缓存版本 `v3 → v4`，两个新模块进 `ASSETS` |
| `AlarmTestReceiver.java` | 新增 `reminderKey` / `plannedAt` extra；接收侧落一条「系统已接收」证据；`fillDelivery` 传下去 |
| `AlarmRingService.java` | 响铃前也落一次证据（覆盖「接收侧被拦、只有服务路径走到」的情况） |
| `AlarmScheduler.java` | 新签名把 `reminderKey` + `plannedAt` 带进投递 Intent |
| `SystemBridgePlugin.java` | `scheduleAlarmInternal` / `persistAlarm` / 重排路径串起 `reminderKey`；新增 `deliveryEvidence` 桥方法（返回 `available` / 证据 / 保留策略） |
| `AlarmActivity.java` | 稍后提醒带上 `snooze@<triggerAt>` 身份，避免不同轮次的证据互相覆盖 |
| `test-unit.js` / `test-native-reminders.js` / `test-smoke.js` / `test-regressions.js` | 新模块加载 + 新增 UX 行为断言 |

---

## 3. 逐 UX ID 交付

> 结果标 `PASS / FAIL / PARTIAL / NOT_PERFORMED / INHERITED_EVIDENCE`；证据层级标 `源码 / 行为测试 / Web 运行 / Android 构建 / 当前候选真机`。

### UX-T01 保存结果与排程结果分开 —— PASS

- 起始判断 partial → 结束 **已实现**。
- **保存中 → 已保存 → 按本条证据给结论** 三段式：`beginSaveSubmit`/`endSaveSubmit` 按**提交身份**去重（编辑哪条 + 内容 + 时间），刻意不用全局布尔（否则「上一笔还没落盘时又记一件事」这个最正常的连击会被拒）；「已保存」只在 `save()` 的 Promise 落定后才说，失败保留内存草稿 + 重试入口。
- 判定全部在 `lib/feedback.js:reminderFeedback(ctx)`，覆盖规格表 9 行（`itemScheduled` 已确认 / 未知 / 通知权限拒 / 闹钟可排但通知受限 / 只能非精确 / 总开关关 / 排程失败 / 无明确时间 / Web）。**只吃本条目的证据**（`itemScheduleEvidence(it)` 走 `item.reminderEvents`），全局状态正常不能证明刚保存的这条已排成功。
- 迟到响应不得覆盖新编辑：用保存时刻的事项 `rev` 做闸门，版本变过就说「以最新设置为准」（`kind: "superseded"`）。
- 证据：行为测试 `test-unit.js`（9 个分支 + 一个组合矩阵断言没有非法组合）、`test-regressions.js`；Web 运行 `results.json` 中 V02 的 6 条（含「Web 上不冒充 Android 就绪」「带可理解入口」）。
- 剩余缺口：toast 消失后的详情页入口靠既有详情页（未为本轮新增字段做专门断言）。

### UX-T02 首用设置与测试改成短路径 —— **PARTIAL**

- 起始判断 divergent → 结束 **基本实现，有一处明确缺口**。
- 已做到：首次启动**不再**在 600ms 后无条件打开整张技术自检表（`maybePromptAndroidNotify` 不再在首启路径上强推）；空首页直接允许录入；**首次保存「真有提醒时间」的事项之后**才出现可跳过的设置入口（`noteFirstRemindSaved` → `renderSetupEntry`，原生环境才出现）；设置里始终可重进（`#btnSetup`）；自检表降级为「高级诊断」，只有主动点开才进。
- 60 秒测试：在设置面板里由用户主动开始（`#setupTestStart` → `labScheduleAlarm(60000, "60 秒")`），另有「停止铃声 / 取消未触发的测试」按钮（`#setupTestStop`）。测试区把**系统事件证据**与**用户反馈**分列：`TEST_FEEDBACK` 四档，`testFeedbackVerdict` 明确「未回答 ≠ 失败或成功」「不确定既不算失败也不算成功」。旧 `onboardDone` 不当作「已通过测试」，新增的是**独立**字段 `setupPromptStarted` / `setupDismissed` / `testFeedback`（真机快照里三个键都存在且为缺省值，没有伪造旧记录）。
- **缺口（规格未落地部分）**：规格要求的「测试事项**独立标识**、不开周期、不进入用户正常统计」没有做成一条独立通道 —— 当前实现复用既有排程能力发起一次 60 秒提醒，没有给测试事项一个隔离身份与统计排除。这一项我没有实现，如实记为缺口，未用文案掩盖。
- 证据：行为测试 `test-unit.js`（`setupSteps` / `testFeedbackVerdict` / `next` 收敛）；源码（上面各函数）；真机快照（设置键）。**没有**真机跑过 60 秒测试（见 V08）。

### UX-T03 原生证据回流 —— PASS（行为测试 + 构建 + 真机只读；真机投递未实测）

- 起始判断 missing/partial → 结束 **原生半边补齐**。
- 层级纪律：接收侧只写「系统已接收」；`delivered` 的技术含义在 `lib/delivery-evidence.js` 头部文档里写死为「系统已接收这次提醒」，详情页在 `delivered` 后追加「（只代表系统收到了这次提醒）」。不把通知入栏说成看到、不把窗口创建说成可见、不把声振请求说成听到。
- 身份最小集：`itemId` + `reminderKey`（逻辑轮次/提醒键）+ `plannedAt` + `carrier` + `itemRev` + `token`；**任一项缺失就拒绝落盘**（`rowFor` 返回 null），时间戳或标题单独不构成身份。
- 保留策略：`MAX_AGE_MS = 7 天`、`MAX_ROWS = 300`，超龄与超容都淘汰；`record()` 对同身份**保留最早那条 `receivedAt`**（后到的重复回执不得把时刻刷后）。
- 为何用 DE（device-protected）存储：`AlarmTestReceiver` 可能在锁屏后、用户解锁前收到投递；写 CE 存储会丢。`store()`/`list()` 直接走 `createDeviceProtectedStorageContext()` + try/catch 回落到普通存储 —— **刻意不分支 `Build.VERSION.SDK_INT`**（mockable jar 下 `SDK_INT == 0`，production 不该为测试而改结构）。
- 收件路径的写入包在 `try` 里，文档明确「绝不抛：调用点在接收路径上，写证据失败不能反过来打断投递本身」。
- Web 侧：冷启动与回前台都 `readDeliveryEvidence()` 读一次并**幂等合并**；只挂 JS 运行期监听是不够的（关掉 App 期间响过的那次在原生侧有记录）。证据通道本身**三态**：`null`(未知) / `true` / `false`，判定层把 `null` 与 `false` 都当「读不到」，**不因为读不到就说漏了**。
- 事后核查**没有 `missed` 状态**；缺证据只能是 `unknown`，也没有「任意分钟阈值把 unknown 变 fail」。未登记过排程的旧数据 → `unverifiable`（详情写「这条记录的提醒无法核查」）。
- 证据：`test-unit.js`（normalize/merge/evidenceStatusFor 全分支 + 乱序 + 旧轮次 + 孤儿行）、`test-regressions.js`（UX-T03 5 例）、`test-native-reminders.js`（接收侧与响铃服务两条路都调 `record`、身份字段完整性、桥方法返回保留策略、失败时 `available:false`）、Android 单测 10 例、**Android 构建**（`DeliveryEvidenceStore` 类出现在 dex 中）、**真机**（`readDeliveryEvidence` 返回 `readable:true`、`retention {maxAgeMs:604800000, capacity:300}`、不抛异常）。
- 剩余缺口：见 §9.2（真机上从未发生过一次真实投递，因此「收件路径上的写入 + 对投递时延的影响」未实测）。

### UX-T04 OEM 引导只承诺已验证的动作 —— **PARTIAL**

- 起始判断 partial/unverifiable → 结束 **文案与落点如实化已完成，效果对照未做**。
- 已做到：`openAutoStartHonest()` 记录**实际落点** `autoStartLanding` 并据此分三种说法 —— 落到 `app-details` 就明说「这**不是**自启动授权页」；落到其它 component 就说「导航成功不等于授权成功，开关读不到、勾没勾由你自己确认」；连应用详情页都打不开就说「此系统暂未找到可验证的设置路径」并**引导去做 60 秒测试**，不再把用户循环送回同一页。
- 已做到：不承诺「点这里开自启动就能修好」；厂商开关无法读取时统一表述为「需你手动确认」。
- **缺口**：ColorOS 上「实际落点」与「修复前后对照」本轮**未执行**（V20 NOT_PERFORMED）。因此本项只能记为 PARTIAL，**冷进程修复格不得 PASS**。
- 证据：源码（`openAutoStartHonest`）；行为测试（无）；真机（无）。旧 OPPO 报告 `docs/reviews/oppo-current-build-live-verification-2026-09-19.md` 是**上一候选**的证据，不得转记到本候选。

### UX-C01 干净首启与主动演示 —— PASS

- 起始判断 divergent → 结束 **已实现**。
- `init()` 不再自动 seed：`if (!applyShareParams()) { render(); }`。空首页给出一句用途说明 + 输入示例 + 明显的「记一件事」入口。
- **两件事分容器**：D8 的纪律检查 `#homeEmpty` 里没有 `<button>`/`data-act`，所以说明留在 `#homeEmpty`、入口挂在兄弟节点 `#homeStart`。这不是为了绕过断言，而是两条约束确实互斥 —— 合在一个容器里 D8 会当场失效。
- 「查看演示」改成 `openDemoPreview()`：渲染一段明确写「这是只读预览：不会写入你的数据，也不会安排任何提醒」的静态内容，**不 seed、不注册任何通知**。旧的「载入示例数据」`seed()` 仍存在但已不在首启或演示路径上。
- 未完成/待整理存在时，空态文案变成「暂时没有到点的提醒 · 还有 N 条待整理」，不误说没有待处理事项。
- 证据：Web 运行 `results.json` V01 全部 9 条 + V01b 全部 6 条、截图 `V01-clean-first-launch.png` / `V01b-demo-preview.png`；行为测试 `test-regressions.js`「UX-C01 演示是只读预览」+ Q1「干净首启不自动写入演示数据」；真机（覆盖安装后既有 36 条原样保留）。

### UX-C02 默认表单减负，高级能力保持可达 —— PASS

- 起始判断 partial → 结束 **已实现**。
- 默认可见：一句话输入、识别摘要（`#capSummary`）、可改提醒时间、保存、「更多选项」。AI / 重要程度 / 截止 / 项目 / 周期 / 周期方式 / 备注 / 标签 / 来源全在 `#capAdvanced`（默认 `hidden`）。
- 摘要由 `FeedbackLib.captureSummary` 生成，**必须显示有效提醒时间**，并把已识别的周期/截止一并露出（把周期藏进「更多选项」会让用户以为建的是一次性记录）。编辑已有复杂事项时自动展开并显示已设置摘要；未改字段逐项填好，隐藏不清空（Web 运行 V04 实测「展开更多选项后标题与时间都还在」）。
- **本轮修掉的一处真实自相矛盾**：低置信度时 `updateParseHint` 会把解析器拍的「+7 天」写回 `#capTrigger`，于是同一屏出现「未识别精确时间 · 先收下」+「提醒 9月26日 10:00」+ 时间框里一个具体日期 —— 三处互相打脸（截图 `web/V03a-no-time-summary.png` 是修复前的现场）。修法与**保存路径早已声明的同一条理由对齐**（`finishSave` 里 `parsedLow ? null`，注释原文「不把解析器拍的 +7 天写回表单」），修完摘要变成「还没有时间 · 会先记下，之后请你在待整理里补上」。
- 保存数据行为**没有**因此改变：`parsedLow` 分支本来就不接受表单里的这个值，改前改后 `triggerAt` 都是 null、都进 `NEEDS_REVIEW`、都带 `isFallbackTrigger`（Web 运行 V03 实测）。
- 证据：Web 运行 V02/V03/V04 全部 20 条 + 截图；行为测试 `test-unit.js`（`captureSummary`）、`test-smoke.js`（手选时间优先）、`test-regressions.js`（编辑不清空）。
- 剩余缺口：V16 的「系统大字体」「软键盘打开」两个子项未做（见 §4）。

### UX-C03 保存后的查看、修改与有限撤销 —— PASS

- 起始判断 partial/missing → 结束 **已实现**。
- 保存后 toast 带「查看」直接 `openDetail(刚保存的 id)`；新建额外给 8 秒「撤销」（`FeedbackLib.UNDO_WINDOW_MS`）。
- 撤销的**红线守卫**在 `undoNewItem(itemId, rev)`：版本已变 → 拒（引导直接修改）；已 ACK/终态 → 拒；**已拿到送达证据 / `deliveredAt` / `lastRemindAt` → 拒**（否则撤销会留下「幽灵响铃」）；拒绝时一律不删。撤销走既有 `deleteItem` + `queueNativeReminderSync("undo-new")`，原生取消失败经既有 `undoNativeCheckPending` 如实上报。
- 撤销窗口按**保存时刻**计算，替换提示语不会顺手把窗口延长（`settleSaveFeedback` 里 `remaining` 是 `UNDO_WINDOW_MS - (Date.now() - w.at)`）。
- 证据：行为测试 `test-regressions.js`「UX-C03」4 组 8 条；**反向自检**把它拔掉后当场 2 条变红（§6）；Web 运行 V02（新建后 toast 同时给出「了解」与「撤销」）。
- 详情/整理分流：无时间的记录给「去整理」（`open-review`），明确时间的给「查看」（`open-item`）。

### UX-A01 同一动作在不同入口含义一致 —— PASS（判定层）

- 起始判断 partial → 结束 **判定层已实现**。
- `FeedbackLib.actionSpec` 固定四个动作语义：`ack` →「我知道了 / 停止本轮催促 · 仍未完成」，首次反馈文案「已停止本轮催促，这件事仍未完成」+「稍后提醒」入口（**不承诺以后不再提醒**）；`snooze` →「稍后提醒 / 改到 <具体时间>」，原生快捷标注「2 小时后」；`done` →「完成 / 结束本件并归档」，有周期时说明会生成下一周期 + 撤销入口；`stop` →「关闭铃声 / 只停止当前声音与界面」，显式 `notAck: true`。
- 中文术语替换表 `JARGON` 只作用于**用户可见文案**（ACK→我知道了、Capture→记下、NEEDS_REVIEW→待整理、Future→未来、reconcile→对账、token→标识），**不动内部状态名与 API**。
- 证据：行为测试 `test-unit.js`（四个 `actionSpec` + 文案不含「不再提醒」类承诺）；`test-smoke.js`（⑦ ACK 过程中从未自动变成 complete）；`test-regressions.js`（G3/G4/K1/N1 各动作与周期/截止组合）。
- 剩余缺口：**四个入口的逐一对齐只做到判定层与既有入口复用**，本轮没有逐个入口截图核验（Web 只跑了首页与录入路径）。如实记为未做。

### UX-A02 已看到未完成可找回 —— PASS（行为测试）+ 真机旁证

- 起始判断 partial → 结束 **保持并加固**。
- 首页折叠入口保留数量与「未完成」含义，展开后可查看/稍后提醒/完成；搜索池沿用既有实现。此类事项不计完成、不因离开页面/重启/日期变化被归档（`status === "acknowledged"` + `acknowledgedAt` 排序渲染）。
- 本轮没有新增任何「每天催促已确认事项」的机制，没有启用新的默认摘要。
- 证据：行为测试（`test-smoke.js` ACK 链路、`test-regressions.js` Q1/U2 组合矩阵）；真机旁证：设备上既有数据里存在 `acknowledged` 状态事项且覆盖安装后仍在。
- 剩余缺口：「几天后」的时间跨度与搜索路径未在真机上做端到端核验。

### UX-A03 完成后的有限撤销 —— PASS

- 起始判断 missing → 结束 **已实现**。
- `completeItem` 即时按既有持久化合同提交，**不为撤销倒计时延迟停止声振或延迟存盘**；完成后 8 秒给「撤销」。
- `undoLastComplete` 与归档列表的「恢复」**不是同一件事**：撤销成组还原完成前的业务状态，并回收**仅由此次完成生成、且尚未处理/投递**的下一实例；ACK 之前已经派生的下一实例不得删除；受影响实例已变化或排程取消不确定时拒绝不安全撤销。
- 不回放已发生的铃声/通知/ACK；撤销后只对未来仍有效的计划按现有规则对账。
- 证据：行为测试 `test-regressions.js`「UX-A03」4 组 8 条（含周期成组还原与不误删下一期）；回归里的 K1/N1 周期提交矩阵。
- 剩余缺口：原生锁屏/通知入口的完成 → 应用内撤销窗口的交互未在真机核验（V18/V20 未做）。

---

## 4. 验收矩阵 V01–V20

证据目录：`docs/reviews/verification-runs/20260919-ux-three-priorities/`

| 用例 | 结果 | 证据层级 | 实测 / 说明 |
|---|---|---|---|
| **V01** 隔离空存储首启；旧数据升级；主动演示 | **PASS** | Web 运行 + 行为测试 + 当前候选真机 | Web：`items=0 notes=0`，不自动弹演示/录入面板/遮罩，空首页有用途说明+示例，`#homeEmpty` 无 `<button>`，`#homeStart` 有「记一件事」；演示打开后 `rows=5`、`items` 仍为 0、面板内写明「只读预览」、可正常关闭。旧数据升级：真机覆盖安装后 `items=36 notes=2 projects=3` 原样。**子项未做**：在真机上点开演示并核对系统排程表（Web 侧只能证明不调排程、items 不变） |
| **V02** 「明天下午3点提醒我取快递」保存/重开 | **PASS** | Web 运行 | 摘要「提醒 明天 15:00」、提示「已设置：明天 15:00 · 可修改」；保存后 `count=1`、标题「取快递」、`triggerAt` 有值且 `isFallbackTrigger=false`；反馈「已保存，本页关闭后不会有提醒 / 了解」+「撤销」；面板关闭且草稿清空；**重开页面后数据仍在**（真落库）。截图 `V02a-capture-typed.png` / `V02b-saved.png` |
| **V03** 无时间 / 模糊 / 冲突 / 手选 | **PASS** | Web 运行 + 行为测试 | 「有空看看这个项目」：提示「未识别精确时间 · 先收下，稍后整理时再确认」、摘要「还没有时间 · 会先记下…」、时间框为空（**修复后**）；保存后进 `NEEDS_REVIEW` 且 `isFallbackTrigger=true`；反馈「已收下 · 待整理 / 去整理」。手选优先由 `test-smoke.js`（手填 `#capTrigger`）+ 回归 L01 覆盖。**子项未做**：低置信度「必要歧义确认」面板（`sheetLowConf`）本轮没有专门断言 |
| **V04** elapsed / 周期截止链接 / 编辑更多选项 | **PASS**（部分子项） | Web 运行 + 行为测试 | 「三分钟以后提醒我」→ `delta = 180000 ms`（阈值 15 s 内）；未来页 3 行；点卡片「修改」打开编辑面板且简单事项高级字段默认收起；点「更多选项」展开后标题与时间都在。**子项未做**：周期/截止/链接分享三条预填路径本轮没有跑 Web 用例（由既有 `test-smoke.js` 断言覆盖） |
| **V05** 写入失败/慢写/重复点击/AI 迟到/保存时收到原生动作 | **PASS** | 行为测试 | `test-regressions.js` 612 条里的 H1/H2/I1/P1-A/P1-B/Q1/U2/G1/G2 段：提交中拒绝且不伪装成功、失败保留草稿可重试、连击两条都保住、无关事项不被重复施加、慢写与失败后的重放不产生重复/丢失。反向自检见 §6 |
| **V06** 通知拒绝/总开关关/精确不足/桥未就绪/排程失败 | **PASS** | 行为测试 + Web 运行 | `test-unit.js` 覆盖 `reminderFeedback` 9 个分支 + 组合矩阵；`test-native-reminders.js` 覆盖能力状态上报。Web 运行另证「非原生环境走 Web 结论、不显示 Android 就绪结论」。真机上「权限恢复后旧告警自动消失」由既有 `renderHomeNotice` 分支与回归覆盖；真机快照显示当前 `homeNoticeVerdict = null`（当前无断链） |
| **V07** Web/PWA 页面关闭；Android 正常排程 | **PASS** | Web 运行 + 当前候选真机 | Web：结论明确说「本页关闭后不会有提醒」，不冒充原生。真机：`readDeliveryEvidence` 返回 `readable:true`，原生持久通道在设备上真实可用 |
| **V08** 首用设置跳过/拒绝/返回/升级旧 onboardDone；60 秒测试 | **NOT_PERFORMED** | —— | 逻辑层有 `test-unit.js`（`setupSteps` / `testFeedbackVerdict`）与源码证据，但**没有在真机上跑过 60 秒测试、跳过、拒绝、返回，也没有做旧 `onboardDone` 数据的升级演练**。且 T02 的「测试事项独立标识」缺口本身未实现 |
| **V09** 成功投递但旧 scheduled 未更新；新证据重复/乱序/跨次日 | **PASS** | 行为测试 + Android 构建 | `test-unit.js` 证据模块全分支（重复合并幂等、乱序旧轮次不写入、跨次日不受 24h 保留影响的边界）；`test-native-reminders.js` T03 段（接收侧与响铃服务都落证据、身份完整、桥返回保留策略）；Android 单测 `recordIsIdempotentPerIdentity`。**跨次日只验证了保留策略的值（7 天）与分支，没有做真实的「今天写、明天读」时间推进实验** |
| **V10** 原生接收无窗口；仅通知入栏；记录淘汰/丢失；升级前事项 | **PASS** | 行为测试 | `evidenceStatusFor`：缺证据 → `unknown`；未登记排程 → `unverifiable`；刚到点/回读中 → `processing`；`evidenceReadable === false` → 一律 `unknown`（不指控）。淘汰：`trim()` 按超龄 + 超容丢弃后仍只能得 `unknown`。Android 单测覆盖保留与淘汰 |
| **V11** 先稍后/完成，再收到旧轮次回执；对账频繁、进程中断 | **PASS** | 行为测试 | `test-unit.js` 旧轮次回执不污染新轮次；`test-regressions.js` U2 36 组合矩阵（原生动作 × 同事项 UI 命令 × 原生成败）+ G3/G4 截止与终止重复；证据台账有界（300 行） |
| **V12** 新建后撤销；投递/编辑已开始再点旧撤销；原生取消失败 | **PASS** | 行为测试（含反向自检） | `test-regressions.js` UX-C03 4 组 8 条；拔掉「已投递不许撤销」守卫 → 当场 2 条变红（§6） |
| **V13** 每个入口 ACK/稍后/完成/关闭（含截止与两种周期） | **PASS**（判定层） | 行为测试 | `test-unit.js` 四个 `actionSpec`；`test-smoke.js` ⑥⑦（完成→archived、ACK 不自动变 complete）；`test-regressions.js` G3/G4/K1/N1。**四个入口的逐个 UI 核验未做**（见 A01 剩余缺口） |
| **V14** 完成→撤销，普通/日历周期/ACK 周期；子实例已修改；保存失败 | **PASS** | 行为测试 | `test-regressions.js` UX-A03（周期成组还原、不误删已有下期）、K1（周期 ACK 提交中拒绝完成、失败可重试）、N1（派生只发生一次）、T1（派生实例在提交确认前不可见） |
| **V15** ACK 后重开/次日查看/搜索/再提醒 | **PASS**（部分） | 行为测试 + 当前候选真机旁证 | `test-smoke.js`/回归覆盖「ACK 后仍未完成、可再提醒」；真机既有数据中 `acknowledged` 事项在覆盖安装后仍在。**「次日」与「搜索路径」的端到端未做** |
| **V16** 360/390/430 CSS px；桌面预览；系统大字体；键盘打开 | **PASS**（宽度）+ **NOT_PERFORMED**（大字体/键盘） | Web 运行 | 三档宽度 `scrollWidth == innerWidth`（无横向溢出），保存与更多选项均可达，截图 `V16-360px/390px/430px.png`。**系统大字体（font scale）与软键盘打开两个子项未做** —— 无头 Chrome 无法真实模拟这两者，真机侧本轮也未做 |
| **V17** 录入/编辑时另一事项到期 | **PASS** | Web 运行 | 制造到期事项后浮层在 15 s 心跳内出现（`#alertBanner.show`）；录入内容「还没保存的草稿内容」不丢；到期事项 `acknowledgedAt` 未被写入（不隐式 ACK）。截图 `V17-due-overlay-while-typing.png`。**注**：应用内提醒由 `tick()` 15 s 心跳驱动而不是 `renderHome()` 直接弹 —— 第一次写驱动器时就是踩在这里 |
| **V18** 真机前台/他 App 前台/息屏锁屏/冷进程/30 分钟待机 | **NOT_PERFORMED** | —— | 见 §9.1 |
| **V19** 重启后恢复、升级、权限恢复；快照/持久化故障 | **NOT_PERFORMED** | —— | 见 §9.1。「升级」这一子项**已**由覆盖安装 + 数据保全证实（`device/apk-identity.txt`），但「重启后恢复」「权限恢复」「持久化故障」未做 |
| **V20** ColorOS 实际设置落点及修复前后对照 | **NOT_PERFORMED**（另有 `INHERITED_EVIDENCE`） | —— | 见 §9.1。旧证据 `docs/reviews/oppo-current-build-live-verification-2026-09-19.md` 属**上一候选**，按交接文档 §9.6 **不得转记为本候选 PASS** |

**汇总**：PASS 15 / PARTIAL 与 PARTIAL-na 说明 3 / NOT_PERFORMED 4（V08、V16 的两个子项、V18、V19、V20） / FAIL 0。

---

## 5. 测试与命令（含退出值）

全部在本轮结束时的源码上运行（哈希见 `BASELINE.txt` 的 end state 段）。

| 命令 | 结果 | 退出值 |
|---|---|---|
| `node test-unit.js` | 通过 319 / 失败 0 | 0 |
| `node test-native-reminders.js` | 通过 318 / 失败 0 | 0 |
| `node test-smoke.js` | 通过 226 / 失败 0 | 0 |
| `node test-regressions.js` | 通过 612 / 失败 0 | 0 |
| `./gradlew :app:testDebugUnitTest --rerun-tasks` | `ExampleUnitTest` 1 + `DeliveryEvidenceStoreTest` 10 + `ProductionJavaAlarmTest` 8 = **19 用例，0 失败 0 错误**，BUILD SUCCESSFUL | 0 |
| `git diff --check` | 无输出（无空白错误） | 0 |
| `bash scripts/android-build.sh both` | debug + release 均 BUILD SUCCESSFUL；release `apksigner verify -v` v1/v2/v3 全 true | 0 |
| `node .../web/drive.cjs` | 通过 59 / 失败 0 | 0 |
| `node .../device/probe.cjs` | 通过 9 / 失败 0 | 0 |

### 5.1 起点失败与本次引入失败的区分

开工时（本轮任何改动之前）的失败：`test-native-reminders` 297/1、`test-smoke` 225/1、`test-regressions` 577/3 —— 共 5 条，全部由**上一轮未收尾的改动**引起（空态按钮进了 `#homeEmpty` 违反 D8；Q1 用 `items.length > 0` 代理「首启成功」而 C01 之后首启不再 seed；D68/A-2 的断言正则匹配的是旧签名 `setNativeReminderStatus(status)`）。这 5 条已在本轮修掉，修法见 §7。

### 5.2 构建产物的内容核查（不是「构建成功」就算数）

1. **APK 内 Web 资源与当前源码逐字节一致**：从 debug 候选解出 `assets/public/`，对 `index.html`、`app-core.js`、`sw.js`、`manifest.json`、`lib/storage.js`、`lib/feedback.js`、`lib/delivery-evidence.js`、`lib/native-reminders.js` 逐个 `cmp` → 全部 MATCH。（`app.js` / `styles.css` 在 APK 里不存在，是因为 `index.html` 用的是内联 `<style>` 且根本没有引用这两个文件 —— 已核对，不是漏打包。）
2. **新原生实现确实进了包**：解出 `classes*.dex` 后检索到 `DeliveryEvidenceStore`、`Lspace/alliswell/inbox/DeliveryEvidenceStore;`、桥方法名 `deliveryEvidence`、以及 `delivery_evidence` / `reminderKey` / `plannedAt` 三组字符串。
3. **设备上的包与候选逐字节一致**：安装后从 `/data/app/...` 拉回 `base.apk`，sha256 `69c5761b…` == 候选 `69c5761b…`。

---

## 6. 反向自检（「对照组必须有牙齿」）

只证明「测试是绿的」不够 —— 必须证明**把修复拔掉之后它会变红**。本节的两条都是本轮结束时在**当前源码**上重跑的，且都做了「备份 → 注入缺陷 → 确认变红 → 按字节还原 → 确认变绿」。

### 6.1 JS 行为测试的牙齿

- 注入：把 `undoNewItem` 里「已拿到送达证据 / `deliveredAt` / `lastRemindAt` 就拒绝」整条守卫短路成 `if (false && …)`。
- 结果：`test-regressions.js` → **通过 610 / 失败 2**，两条红正是
  `C03 已开始投递 → 拒绝撤销（否则旧提醒照响）` 与 `C03 被拒的这条没被删`。
- 还原文档：`app-core.js` sha256 回到 `aff30d6f5c2bbababe2bace7b2e4255c613abf35fb27dd97a4182b8f299af5b7`（与注入前逐字节一致），复跑 **612 / 0**。

### 6.2 Android 行为测试的牙齿

- 注入：把 `DeliveryEvidenceStore.record(...)` 头部改成 `if (context == null || true) return;`（等于证据永不落盘）。
- 结果：`./gradlew :app:testDebugUnitTest` → **FAILED, exit 1**，`19 tests completed, 4 failed`：
  `recordIsIdempotentPerIdentity`、`evidenceAlwaysLandsInDeviceProtectedStorage`、
  `fallsBackWhenDeviceProtectedUnavailable`、`fallsBackWhenDeviceProtectedThrows`。
- 还原后 sha256 回到 `1467ead7…`，复跑 **exit 0 / BUILD SUCCESSFUL**。

### 6.3 一个必须说清楚的不确定性

同一条注入**第一次**跑时是 `5 failed`，多出来的一条是 `ProductionJavaAlarmTest > testDirectBootUtilsRouteDiscrimination`；**第二次**跑（同样注入、同样 `--rerun-tasks`）只有那 4 条。绿态下连跑三次都没有它。

结论（限定在实测范围内）：那条测试**不稳**。它用 `sun.misc.Unsafe` 去写 `static final Build.VERSION.SDK_INT`，而 JIT 常量折叠与执行顺序有关 —— 这与 `test-native-reminders` 里同源的那条契约（「`SDK_INT == 0` 时 `if (SDK_INT >= 24)` 分支不可达」）是同一个坑。**我没有把它的成因彻底查清，也不声称它一定是无害的**；我能说的是它与本轮改动无关（我的 `DeliveryEvidenceStore` 刻意完全不分支 `SDK_INT`），但**独立验收方复跑 gradle 时若看到这条红，应先排查它是不是这个已知的顺序抖动，而不是直接判本轮代码失败**。

### 6.4 一处已知的牙齿缺口（如实记录）

`test-native-reminders.js` 里 T03 的断言是**源码级**的（检查接收侧/响铃服务确实调用了 `record`、字段集合合法）。它**测不出**「`record` 的方法体被掏空」这类语义缺陷 —— 6.2 的注入正好证明了这一点：那次 `test-native-reminders` 仍然全绿，只有 Android 行为测试变红。这类缺陷只能靠 Android 单测覆盖，这也是本轮专门补那 10 例的原因。

---

## 7. 本轮发现并修复的缺陷

| # | 缺陷 | 怎么发现的 | 修法 |
|---|---|---|---|
| 1 | **`lib/feedback.js` 与 `lib/delivery-evidence.js` 写在了磁盘上，却从来没有被 `index.html` 加载**。后果：`FeedbackLib`/`EvidenceLib` 在真实应用里恒为 `null`，所有新逻辑静默退化到兜底分支（`feedbackVerdictFor` 的 `if (!f)`、`renderCaptureSummary` 的空返回）。测试之所以是绿的，是因为 `test-unit.js` 直接 `require` 了这两个文件、而 smoke/regressions 的 harness 各有一份自己的加载列表。 | 逐文件核对 APK 内 Web 资源与源码是否一致时发现的（`index.html` 里没有这两个 `<script>`） | 在 `index.html` 的 `storage.js` 与 `native-reminders.js` 之间加上两行 `<script>`；`sw.js` 缓存版本 `v3 → v4` 并把两个文件加进 `ASSETS`；regressions 的 `LIB_SOURCES` 与 smoke 的加载列表同步补齐 |
| 2 | 空首页的「记一件事 / 查看演示」按钮被塞进 `#homeEmpty`，违反 D8（该容器必须是纯文字完成数、无按钮、无 `data-act`） | 原有 D8 回归断言变红 | 说明留在 `#homeEmpty`，入口移入新的兄弟容器 `#homeStart` |
| 3 | `setNativeReminderStatus(status)` 改成了 `(status, origin)`，D68/A-2 的断言正则匹配的是旧签名 | 原有断言变红 | 断言改为穿过新签名匹配（`[\s\S]{0,700}?renderHomeNotice()`），而不是放宽范围去凑 |
| 4 | **低置信度把解析器拍的 +7 天预填进 `#capTrigger`**，造成同屏「未识别精确时间」+「提醒 9月26日 10:00」+ 时间框一个具体日期三处互相打脸 | Web 运行层 V03 实跑（截图 `web/V03a-no-time-summary.png` 是修复前现场） | `updateParseHint` 在 `confidence` 为 `low`/`none` 时不再写回该值，改为清空 —— 与 `finishSave` 里早已声明的同一条理由（「不把解析器拍的 +7 天写回表单」）对齐。保存结果不变（实测 V03 前后都是 `NEEDS_REVIEW` + `isFallbackTrigger`） |
| 5 | `DeliveryEvidenceStoreTest` 初版用 `sun.misc.Unsafe` 改 `SDK_INT` 并用 `mock(Context.class)`，与既有 `ProductionJavaAlarmTest` 的同类操作互相干扰 → 既有测试变红 | 加入第 19 个测试后 gradle 出现红 | 删掉我这一侧全部的 `SDK_INT`/Unsafe 与 Mockito（改用仓库既有的手写 `ContextWrapper` 替身风格）；同时确认生产代码**不需要**为测试而分支 `SDK_INT`（DE 存储直接走 `createDeviceProtectedStorageContext()` + 回落） |
| 6 | `test-native-reminders` T03 的一条断言用了 `/"received"/.test(storeSrc)` 找字面量，而存储层写的是 JSON、根本没有这个字面量 | 断言第一次就红 | 改成断言 `row.put("…")` 的**键集合**是身份/阶段字段的子集 —— 这才是真正要守的契约（不存标题/正文/凭据） |
| 7 | Web 取证驱动器自身有 3 个断言缺陷，会制造**假红**（不是产品缺陷） | 第一次跑出 5 条红时逐条复核 | ① 面板是否打开看的是 `#sheetDemo.show`，而 `show` 类挂在 `#backdrop` 上、面板自己用的是 `open`；② 「派发 input」和「读解析摘要」写在了同一次 `evaluate`，而解析有 120 ms 去抖 → 拆成两次并等待；③ 首页选择器用了 `#homeDue [data-act="edit"]`，但 D5 之后首页已经没有「即将到来」区块，未来事项在「未来」页的 `#futureList` → 改为先切页再点。三条都写进了证据目录的 `README.md` |

---

## 8. 交付物与哈希

### 8.1 候选 APK

| 文件 | sha256 |
|---|---|
| `releases/candidates/20260919-ux-three-priorities/attention-inbox-debug-ux-three-priorities.apk` | `69c5761bc624a980937f62ffd93dedcf2f3dec0a9adea73b125013fa9eef6443` |
| `releases/candidates/20260919-ux-three-priorities/attention-inbox-release-ux-three-priorities.apk` | `58925fa4002c9f4e0232d7431f0e22268fbd522eae9f1fbf89649bd4262d3b7c` |
| `SHA256SUMS.txt` | 上述两份的校验和清单 |

- 候选 debug 的签名证书 SHA-256：`7ad67d49f059c504f43f6866e828b44acd03f8fcad8a216e2c689fb504dccc0a`（与设备原装包同证书，故可 `-r` 覆盖）。
- 候选 release 的签名证书：`CN=Attention Inbox, OU=Local Android Build, O=Local, L=Beijing, ST=Beijing, C=CN`，`bbdaeece…`。
- **真机当前安装的就是候选 debug**（sha256 实测一致）。

### 8.2 证据

`docs/reviews/verification-runs/20260919-ux-three-priorities/`

| 文件 | 说明 |
|---|---|
| `README.md` | 证据索引 + 复现命令 + 驱动器已知坑 |
| `BASELINE.txt` | 开工分支/HEAD/dirty 清单/起始源码哈希 + 收工源码哈希 |
| `web/results.json` | 59 条断言逐条含实测值 |
| `web/*.png` | 12 张场景截图（V01、V01b、V02a、V02b、V03a、V03b、V04、V16×3、V17） |
| `web/drive.cjs` | 可复现的零依赖 Web 驱动器 |
| `device/device-probe-results.json` | 真机只读探针 9 条断言 + 完整快照（UA / libs / counts / settings 键 / 证据通道） |
| `device/probe.cjs` | 真机只读探针脚本 |
| `device/apk-identity.txt` | 设备与候选的身份、签名、安装命令与结果、数据保全实测 |
| `device/cert-*.txt` | 三份 `apksigner --print-certs` 原始输出 |

### 8.3 源码哈希（收工时）

见 `BASELINE.txt` 的 end state 段。关键几项：
`app-core.js` `aff30d6f…`、`index.html` `91063b86…`、`sw.js` `9acd48f4…`、
`lib/feedback.js` `f19a5a9a…`、`lib/delivery-evidence.js` `01aa270f…`、
`DeliveryEvidenceStore.java` `1467ead7…`。

### 8.4 回交信息

- checkout：`/Users/qlyf/Developer/reminder`（**默认复用，未新建 worktree**）
- 分支：`main`
- HEAD：`8d1c2617cff3aac5c4450a949c9044b79f63a673`（**本轮没有提交，HEAD 未变**）
- 远程：与 `origin/main` 一致
- dirty：**非空且很大** —— 开工前就已存在 22 个 tracked 修改（提醒机制/冷进程那一轮）+ 大量 untracked；本轮在其上追加了对 `app-core.js`、`index.html`、`sw.js`、4 个测试文件与 5 个 Java 文件的改动，并新增 2 个 lib、1 个 Java 类、1 个测试类、1 个证据目录、1 个候选目录。
  **按文件而不是按「有没有 diff」来判定归属**：本轮的改动清单在 §2；其余改动属于上一轮，本轮一行未回退。

---

## 9. 未完成项与残留风险

### 9.1 V18 / V19 / V20 为什么没做

三条都需要**改变设备现场**才能取得证据，而本轮的用户指令明确限定「不改变设备设置」：

- **V18（投递场景矩阵）** 需要制造一次真实投递。可行的短窗口钩子（`AlarmRingService.EXTRA_MAX_RING_MS` / `EXTRA_AUTO_SILENCE_MS`，注释里写明「只有应用自己（或 run-as / shell）能带这个 extra」）**只能由构造投递 Intent 的一方注入**，JS 与 shell 都够不到；生产静音上限是 **5 分钟**，闹钟档还会拉起全屏界面。也就是说，要在 23:30 的用户真机上做这件事，得接受一次最长数分钟、无法用脚本保证叫停的响铃。我判断这超出本轮授权，也超出「可用设备验收」的必要范围，因此整块记为 NOT_PERFORMED。
- **V19（重启后恢复 / 权限恢复 / 持久化故障）** 需要重启设备或改动权限设置。
- **V20（ColorOS 落点与修复前后对照）** 需要导航到厂商设置页并做修改前后对照。D70 前置核验已经确证 ColorOS 16 的自启动深链**打不开、会落到应用详情页**，重复导航的边际信息很低，而它属于「改变设备现场」的一类。

**给独立验收方的可复现步骤**（拿到明确授权后可直接照做）：

```
# 前置：把候选 debug 装上（保留数据）
adb install -r releases/candidates/20260919-ux-three-priorities/attention-inbox-debug-ux-three-priorities.apk
adb shell pm path space.alliswell.inbox                     # 拉回 base.apk 复核 sha256 == 69c5761b…

# V18 前台/他 App 前台/息屏锁屏：分别记录，不要互相替代
adb logcat -c && adb logcat | grep -E "AlarmTestReceiver|AlarmRingService|AlarmActivity|prevent start"
#   观察窗必须 ≥45 s（单点采样会出时序假阴性）；判据是跨进程事件特征
#   热/冷进程的判别特征：`OplusAppStartupManager: prevent start … Type ssfa` 出现次数（热 0 / 冷 ≥1）

# V18 自然退出（不能用 am force-stop：会进 stopped=true，症状会完全不同）
adb shell run-as space.alliswell.inbox /system/bin/kill -9 $(adb shell pidof space.alliswell.inbox)
#   注意：run-as <pkg> 与 /system/bin/kill 之间必须有空格；`am kill` 在 OPPO 实测无效（pid 不变）

# V19 重启后恢复
adb reboot   # 然后回读排程与台账

# V20 设置落点
#   在应用内触发「自启动设置」入口，记录实际落到的 component 名（openAutoStartSettings 会回传 component）
```

### 9.2 最需要独立复验的一条：收件路径上的证据写入，真机未实测

这是本轮**新引入**的行为，也是唯一一处「改了投递链路却只在模拟环境里验证过」的地方。

- 事实：`AlarmTestReceiver.onReceive` 与 `AlarmRingService.onStartCommand` 现在各多调一次 `DeliveryEvidenceStore.record(...)`。
- 已经有的证据：源码（调用点在接收路径上、`record` 的 try/catch 与「绝不抛」的文档承诺）；Android 行为测试 10 例（含宿主存储抛异常、DE 不可用、DE 抛异常三种失败形态都不外抛）；APK 内类确实存在；真机上该通道可读且返回正确的保留策略。
- **缺的证据**：真机上真的发生一次投递时，流程是否照常完成、`rows` 是否从 0 变 1、写这一行对投递时延的影响有多大（接收路径在主线程上做一次 ≤300 行的小 JSON 读 + 重写；量级是数十 KB，估计在毫秒级，但**这是估计，不是实测**）。
- 复现方式：见 §9.1 的 V18 步骤；判据之一是投递后重新 `readDeliveryEvidence()`，`rows` 应从 0 变 1。
- 为什么它大概率是安全的、但仍然要测：`record` 被包在 try/catch 里且文档明确「写证据失败不能反过来打断投递本身」；但它挂在**每一次投递**的必经之路上，一旦有非预期的异常类型（例如存储配额、`SharedPreferences` 首次创建的耗时尖峰）就会变成「为了多记一条证据而影响提醒本身」。这类替换必须用真机证明，不能用「代码看起来没问题」代替。

### 9.3 明确未解决、且本轮没有尝试解决的

1. **D70 冷进程投递黑洞**：应用进程不存活时闹钟完全不响也不补投（ColorOS `OplusAppStartupManager: prevent start … Type ssfa`）。本轮代码**一行未动**这条链路，`request-d70-cold-process-delivery-2026-09-19.md` 的 Q1–Q4 仍待裁决。任何「OPPO 打开自启动就好了」的说法都不成立。
2. **导出没有落地出口**（`docs/decisions/proposal-export-file-visibility-2026-09-19.md`，待裁决 E1–E4）：`downloadFile()` 在 Android 侧无人接应、且不报成功也不报失败 ⇒ 调用了它就会弹「已导出备份文件」而全机没有文件。本轮未动。
3. `projects` 与 D-09「不建项目」的冲突、`test-native-reminders.js` 里残留的 Java 源码正则（`hasSpecificTimeWord` 那类硬编码除外，见 `proposal-rework-round4-verification-fixes`）、D69 对账全量重排、`USE_FULL_SCREEN_INTENT` 文案未审 —— **均未动**。

### 9.4 T02 的规格缺口（已实现部分 + 具体剩余项）

- 已实现：首启不强制跳技术表；空首页可直接记录；首次保存真有提醒时间的事项后才出现可跳过的设置入口；设置里始终可重进；60 秒测试由用户主动开始、可停止；系统事件证据与用户反馈分列；旧 `onboardDone` 不冒充「已通过测试」。
- **剩余项（明确未做）**：规格要求的测试事项**独立标识**、**不开周期**、**不进入用户正常统计**。当前实现复用既有排程能力发一次 60 秒提醒，因此这次测试会留下一条普通事项并进入用户数据。要补这一块需要一条独立的测试事项通道（含统计排除与自清理），本轮未实现。
- 影响：用户做 60 秒测试会在自己的事项列表里多出一条。不构成数据错误，但不符合规格。

### 9.5 其它残留

- 索引与执行：本轮**没有**做「新建 → 保存确认 → 退出应用 → 到点 → 稍后 → 再次到点 → 完成 → 重开核查」这条完整用户链路（需要真实投递，同 §9.1）。
- `app-core` 与 `lib` 的解析实现仍有整份重复（M-10），本轮未动。
- 真实用户是否看得懂这些文案，需要小范围试用；**本报告的界面检查不能冒充用户调研**。

---

## 10. 回交独立验收

请按交接文档 §10 执行。给出三条优先建议：

1. **先复跑三个测试命令 + gradle**，把 `test-regressions` 612 与 Android 19 当作基线；若 gradle 出现 `testDirectBootUtilsRouteDiscrimination` 红，先按 §6.3 判是不是已知的顺序抖动。
2. **优先复验 §9.2**：在拿到设备授权后做**一次**真实投递，核 `rows: 0 → 1`、投递本身照常完成、并记录投递时延。这是本轮唯一「改了投递链路但真机没测过」的点。
3. **再抽 V01/V03/V12/V17 的原始证据**：`web/V03a-no-time-summary.png` 是修复前现场，`web/results.json` 里 V03 的三条能直接看出修复后的对照；V12 与 C03 请自行重做一次反向自检（§6.1 的注入方式）。

**本轮不宣布独立验收通过。** 三个优先项里，P1 有一个明确的规格缺口（T02 测试事项隔离）、P2/P3 的实机链路未验证、OEM 可靠性未修也未尝试修 —— 这些都不会因为「其它都绿了」而被抹平。
