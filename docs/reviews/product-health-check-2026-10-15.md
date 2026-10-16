# 安心收件箱 · 全面体检与待优化报告

- **日期**: 2026-10-15
- **体检对象**: v1.3 (versionCode 4) Web PWA + Android APK（真机 vivo V2238A / Android 16，USB 在位）
- **体检方式**: 全量测试套件复跑 + 提醒链路代码审计 + UI 交互审计 + 真机锁屏闹钟实测 + 浏览器实测 Web 版 + 滴答清单（TickTick CN v7.6.8）逆向对照
- **总体结论**: **核心承诺兑现度高**——真机锁屏黑屏实测闹钟延迟 15–377ms，全屏弹出 <430ms，「叫得醒」这条命脉是过硬的。主要缺口集中在：**2 个提醒链路可靠性缺陷（P0）**、**到点事项操作闭环盲区**、**状态可见性不足**、**Web 版静默降级**、以及相对成熟产品的**兜底补偿推送**等机制缺失。

---

## 一、实测验证结果（本次体检做了什么）

### 1.1 自动化测试套件：14/15 套通过，约 2864 项断言

| 套件 | 结果 |
|---|---|
| test-unit.js | **Node ≥21 下崩溃**（见 3.4-①），垫片修复后 714 项全过 |
| test-native-reminders.js | 通过 |
| p3a–p3i 模块化测试（9 套） | 通过 |
| test-boot-combination.js | 通过 |
| test-smoke.js | 通过 |
| test-regressions.js | 通过 |
| parse-single-source.js | 通过 |

### 1.2 真机闹钟及时性实测（vivo V2238A，锁屏休眠）✅

通过 App 内置「一键多点后台诊断」排 3 组测试闹钟，排程后立即按电源键锁屏：

| 测试 | 系统计划触发 | 广播实际到达 | 延迟 | 全屏窗口 |
|---|---|---|---|---|
| 10s | 10:21:17.426 | 10:21:17.803 | **+377ms** | 锁屏黑屏走 `fsi+direct` 全屏路径，AlarmActivity +423ms 显示 |
| 60s | 10:22:07.448 | 10:22:07.463 | **+15ms** | 直起路径，+251ms 显示 |
| 120s | 10:23:07.469 | 10:23:07.562 | **+93ms** | 直起路径，+196ms 显示 |

系统侧确认每组均为双保险排程（`ACTION_TEST_ALARM` 广播 + `AlarmRingService` 解冻前台服务），`exactAllowReason=permission`（精确闹钟权限在位）。**「闹钟是否及时」这一核心担忧，在本机当前配置下不成立。**

### 1.3 Web 版浏览器实测 ✅（390×844 视口）

- 空状态引导清晰；「捕获永不失败」真实落地：明确时间→自动解析；模糊时间（抽空给车保养）→归入待整理；乱码输入→不报错不阻断；
- 全程 console 零报错；演示数据入口可用。

---

## 二、确认的问题（按优先级）

### P0 —— 提醒可靠性缺陷（建议立即修）

**① 通知渠道创建竞态，「D59 无声设计」可能被整体绕过（双响铃风险）**
- [SystemBridgePlugin.java:699](../../android/app/src/main/java/space/alliswell/inbox/SystemBridgePlugin.java#L699) 的 `ensureChannel()` 每次排程都会用 `createChannelIfMissing` 创建 `attention-alarm-v4` 渠道，属性为**自带 attention_reminder 铃声（USAGE_ALARM）+ 振动**（:713-724）；
- 而 [AlarmTestReceiver.java:575-588](../../android/app/src/main/java/space/alliswell/inbox/AlarmTestReceiver.java#L575-L588) 对**同一渠道 id** 按 D59 决策刻意建成**无声无振动**（声音由应用自己播）；
- 渠道属性先建先得且不可更改。新装/重装设备若 `ensureChannel` 先跑（它在每次排程前都会执行），渠道将永久带声 → 与 `AlarmRingService` 自播叠加成**两路同时响**，正是 D59 要消灭的场景。
- **修复方向**: 渠道创建只保留一处（单一事实源），另一方删除或改为校验+告警。

**② 台账为 `scheduled` 且时刻已过 → 永久卡死，不再补投**
- [native-reminders.js:370](../../lib/native-reminders.js#L370)（阶梯重提醒槽位）与 [native-reminders.js:441-444](../../lib/native-reminders.js#L441-L444)（死线保护阶段）：记录为 `scheduled` 且 `at <= now` 时「既不重排也不补发，保持待定」；
- 触发场景真实存在：撤销 SCHEDULE_EXACT_ALARM 权限会连带清除已排精确闹钟（ExactAlarmPermissionReceiver 注释自认）、系统强停、关机期间跨过触发点。此时系统已没有这颗闹钟，但台账仍记 `scheduled`，该次提醒**永远静默丢失**，且用户无感知。
- **修复方向**: 对账时若原生侧 pending 列表查无此闹钟，应把台账降级为「丢失」并走补投/「到点未收到」提示路径（诊断页已有 `到点未收到` 文案，缺的是自动闭环）。

### P1 —— 尽快安排

**③ 关机/强停期间错过的闹钟无 UI 闭环**
- [SystemBridgePlugin.java:1006](../../android/app/src/main/java/space/alliswell/inbox/SystemBridgePlugin.java#L1006) 提供 `getMissedAlarms` 台账，但 `lib/`、`index.html`、`app-core.js` **零消费方**（grep 证实）。开机重排时丢弃的过期闹钟只在 50 条环形诊断里，用户永远不知道「刚才有条提醒没响成」。成熟闹钟产品（系统时钟 App）都会在打开时补报「你在 XX 时段错过的闹钟」。

**④ 到点事项操作盲区：不可编辑、不可删除**
- due 卡片只有「稍后 / 我知道了 / 完成」三键（[app-views.js:55-61](../../lib/app-views.js#L55-L61)），due 与 acknowledged 状态的详情页也没有编辑/删除入口（[app-views.js:698-704](../../lib/app-views.js#L698-L704)）。用户发现到点事项内容写错（记错时间地点）时，只能先稍后或先完成再改，违背「处理眼前事不该被流程绑架」的直觉。成熟产品在提醒弹出时均可直接编辑。

**⑤ 重提醒策略常量多处重复，存在漂移**
- 同一套策略在 [native-reminders.js:20-25](../../lib/native-reminders.js#L20-L25)（POLICY）与 [reminder.js:94-98](../../lib/reminder.js#L94-L98)（REALERT）各写一份，语义约定靠注释（「首响是否计入」）维持。本次核实当前两端恰好一致，但这是**人工对齐的巧合而非机制保证**，改间隔/次数时极易只改一处。
- **修复方向**: 抽到 `lib/policy.js` 单一来源，两端 import；测试里加两端常量相等断言。

**⑥ Web/PWA 版静默降级，不告知用户**
- 非原生环境 `app-notices.js:70-71` 直接 return（首页永不提示）；通知权限未授时 `app-alerts.js:99` 静默 no-op。Web 版用户关掉页面=全部提醒停摆，但产品**没有任何一处明说**「Web 版提醒仅在后退到浏览器期间有效」。这是预期管理事故的温床（用户以为装了 PWA 就万事大吉）。PWA 的后台通知本身依赖浏览器进程存活，iOS PWA 上基本不可用——更应明示。

**⑦ 无深色模式**
- 全部颜色 token 浅色写死（[index.html:16-48](../../index.html#L16-L48)），无 `prefers-color-scheme`。**全屏闹钟的核心场景就是深夜**，突然全屏白底高亮非常刺眼；深色模式对闹钟类产品不是美化项而是基础体验。

**⑧ 「重提醒中 / 已稍后」状态不可见**
- 阶梯重提醒（30min×4）进行到第几轮，卡片与详情均无标识；snoozed 与 waiting 混在同一「托管中」列表无区分（[app-views.js:402,449](../../lib/app-views.js#L402)）。用户无法回答「哪些事正在被连环催」「哪些是我自己推迟的」——状态可见性是信任的基础。

**⑨ 测试基建：test-unit.js 在 Node ≥21 崩溃 + npm test 一断全断**
- [test-unit.js:281](../../test-unit.js#L281) `global.navigator = {...}` 在 Node 21+（navigator 变为只读全局）抛 TypeError；当前环境 Node 22.23.1 必崩，`npm test` 用 `&&` 串联 15 个脚本，第一环崩则后面全部不执行——CI/交接同事会误判「整个项目测试挂了」。
- **修复方向**: 改用 `Object.defineProperty(globalThis,'navigator',...)` 或版本探测降级；`npm test` 改为逐套件容错汇总（如 `npm-run-all` 或循环收集退出码）。

### P2 —— 排期优化

**⑩ 相似事项提示形同虚设**: 查重提示 `#similarHint` 藏在默认折叠的「更多选项」容器里（[index.html:1431](../../index.html#L1431)、[app-capture.js:222](../../lib/app-capture.js#L222)），防重复录入的核心价值没有被用户看到。
**⑪ 无截止倒计时**: 界面只有「截止 X月X日」静态 pill（[app-views.js:45](../../lib/app-views.js#L45)），p24/p2 双阶段保护是产品主打卖点，但用户在 UI 上看不到「还剩多久」，保护只在触发那一刻才可感知。
**⑫ 触控目标偏小**: 快捷时间 chips ≈30px（[index.html:518](../../index.html#L518)）、闹钟关闭键 28px、日历翻月键 32px，均低于 44px 惯例——闹钟响起时人在慌乱中按小按钮，误触率会放大。
**⑬ 无障碍缺口**: 9 处开关无 `role="switch"/aria-checked`、toast 无 `aria-live`、弹层无 `role="dialog"` 与焦点管理；键盘遮挡无 `visualViewport` 处理，弹层底部输入框（自定义稍后时间）可能被键盘盖住。
**⑭ 文档与文案过时**: README 文件地图称 styles.css 为 App 样式（实际 App 样式内联于 index.html，styles.css 是文档页样式）；使用说明「点右下角 +」（[index.html:2067](../../index.html#L2067)）与现行底部通栏输入条不符；「稍后 6 档」实为 5 预置+1 自定义。
**⑮ 排程无上限保护**: `buildDesired` 全量排程无截断（[native-reminders.js:330-471](../../lib/native-reminders.js#L330-L471)），逼近 Android 每应用 500 闹钟上限时仅被动记 `reliability:error`，无按优先级裁剪策略。
**⑯ 台账丢失→幽灵闹钟**: `scheduledAlarmIds/Signatures` 存于 settings，清空 localStorage 或跨设备恢复后 prev 为空 → 不撤旧闹钟；原生 `PREFS_SCHEDULES` 残留还会被开机重排（[SystemBridgePlugin.java:549](../../android/app/src/main/java/space/alliswell/inbox/SystemBridgePlugin.java#L549)），已删事项照样响。
**⑰ DND「总沉默」边界未说明**: 系统级全沉默 DND 可同时压掉渠道通知与 USAGE_ALARM 铃声，产品内无对应提示；用户以为「关键事项必然穿透」。

---

## 三、与成熟产品（滴答清单 v7.6.8 逆向 + iOS 提醒事项）的差距清单

> 产品定位差异（不做任务管理、不做四象限）是**刻意的差异化，应当保留**。以下只列「系统工具调用与交互惯例」层面的差距——这些是大厂验证过的用户肌肉记忆。

| # | 成熟产品做法 | 我们现状 | 建议 |
|---|---|---|---|
| 1 | **关闭后补偿推送**：TickTick 所有弹窗出口（含关闭）都触发 `startPushRemindJob` 兜底通知，关掉弹窗 ≠ 消失 | 弹窗出口后无补偿通知；叠加 P0-② 后存在彻底静默丢失的窗口 | **最值得抄的一招**，与「我知道了≠完成」哲学互补，构成第二道防线 |
| 2 | 稍后九宫格：15分/30分/1时/3时/明天/下一小时/自定义/选日期，且**跳过本次周期**（周期任务专属） | 应用内 5 预置+1 自定义；通知栏固定 2 小时 | 增加 15/30 分钟短档与「跳过本次周期」；2 小时对琐事偏重 |
| 3 | 快捷时间 chips **用户可配置**（`quick_date_config` 云同步） | 4 个 chip 写死（今晚/明早/周六/下周一） | 开放配置，最低成本提升高频路径效率 |
| 4 | 到期**聚合弹窗**：一次弹窗挂多条到期内容，单击/双击分手势 | 逐条弹 | 多事项同时到期时减少轰炸感 |
| 5 | 色阶 token 4 档派生（100/36/18/10% alpha）覆盖边框/按压/浅底三态 | 双 token（signal/signal-soft） | 升级 4 档，为深色模式和按压态打底（可一并解决 P1-⑦） |
| 6 | 滑动快捷操作（左右滑自定义动作）、长按多选批量 | 全部缺失 | 至少补列表项右滑=完成、左滑=稍后 |
| 7 | 全局搜索覆盖所有实体；每组视图内有搜索入口 | 仅首页头部一个搜索入口 | 未来/归档/笔记页内补搜索可达性 |
| 8 | 桌面小组件 + 快捷磁贴（android 工程无 AppWidgetProvider/shortcuts） | 无 | 一张「快速记录 1×1」小组件与捕获快捷方式，契合「随手记」定位 |
| 9 | 提醒策略/偏好可配置并随用户档案持久化 | 重提醒间隔写死、chips 写死 | P1-⑤ 单一来源化之后，把间隔/次数开放到设置页 |

---

## 四、明确不建议改的（差异化护城河，保持克制）

- 「未来默认不可见」「首页无即将到来长列表」——这是对 Todo 类焦虑的正确反叛；
- 「我知道了≠完成」语义 + 完成可撤销 + 8 秒新建撤销——误触防护链完整；
- 捕获永不失败 + 待整理兜底 + Review 集中窗口——已实测兑现；
- 差量对账 + 回读校验 + 权限降级三层告知（状态 pill/自检面板/断链横幅）——工程纪律优秀，本次真机 15–377ms 延迟即为佐证；
- 厂商后台设置四家引导 + 60 秒锁屏实测闭环——成熟产品都不做这么细。

---

## 五、建议修复顺序

1. **本周**: P0-① 渠道单一来源、P0-② scheduled+过期补投闭环、P1-⑨ 测试基建（半天）；
2. **下周**: P1-④ 到点事项可编辑/删除、P1-⑧ 重提醒/已稍后状态标识、P1-③ 错过闹钟补报；
3. **随后**: P1-⑦ 深色模式（含 4 档 token 改造）、P1-⑥ Web 版降级明示、P2 状态可见性三件套（倒计时/相似提示前置/触控目标）；
4. **版本 1.5**: 成熟产品差距清单 #1/#2/#3（补偿推送、稍后九宫格、chips 可配置）。

---

## 附：体检方法与证据索引

- 测试复跑: `npm test` 15 套件（Node 22.23.1，test-unit 需 navigator 垫片）；
- 真机: `adb shell dumpsys alarm`（排程证据）+ logcat `AttentionAlarm`（投递路径）+ `SystemBridge.alarmTrace()`（毫秒轨迹）；
- 代码审计: lib/reminder.js、lib/native-reminders.js、lib/app-*.js、android/app/src/main/java/space/alliswell/inbox/*（全部结论带 文件:行号）；
- 浏览器实测: http://localhost:8931/index.html @390×844；
- 对照样本: `docs/handoff/2026-10-15-ticktick-ui-reverse.md`（TickTick CN v7.6.8 逆向笔记）。

---

## 附二：修复记录（2026-10-15，同日）

| 编号 | 状态 | 改动 | 验证 |
|---|---|---|---|
| P0-① 渠道竞态 | ✅ 已修 | 闹钟渠道只由 `AlarmTestReceiver.ensureAlarmChannel()` 一处创建（D59：无声无振动），`SystemBridgePlugin.ensureChannel()` 改为调用它；渠道 id 升到 `attention-alarm-v5`，并退役 v3 **和 v4**（v4 在已装设备上可能已被带声模板污染；同 id 删后重建会恢复旧属性，只能换 id） | test-native-reminders 新增「SystemBridgePlugin 不再用带声模板创建闹钟渠道」断言 |
| P0-② scheduled+过点卡死 | ✅ 已修 | 台账新增 `lost` 态。两路证据把卡死的 `scheduled` 降级为 `lost`：① 原生漏响台账（关机跨点 / 权限恢复时被防群响丢弃，Java 侧现带 `reminderKey`）；② 送达证据通道**读成功**、闹钟载体过点 ≥10 分钟仍无接收回执（强停 / 权限吊销）。`lost` 与 `cancelled` 同走补投路径（24h 窗口内补一条普通通知，不抢全屏）；`lostAt` 在补投重新登记后保留，每个键只补一次，不循环。普通通知载体没有原生接收证据，保持原待定语义 | 新增 16 项断言（含基线、各边界、Java 契约）+ p3e 协调层 `lostAt` 保留断言 |
| P1-③ 错过闹钟无闭环 | ✅ 已修 | `getMissedAlarms` 有了消费方：启动 / 回前台在证据回读后执行 `reconcileLostReminders`，判出丢失即 toast「N 条提醒没能按时响（关机或被系统清理）· 已补发」并触发对账补投 | 同上 |
| P1-⑤ 策略常量重复 | ✅ 已修 | `native-reminders.js` 的 `POLICY` 改为从 `reminder.js` 的 `REALERT` 派生（`total = max(1, max)`），删除手写字面量；Java 侧核实无重复 | 新增「两端档位/次数/间隔一致」「不再手写字面量」断言 |
| P1-⑥ Web 静默降级 | ✅ 已修（最小改动） | 「我的」页 Web 状态行明示「网页版提醒仅在页面开着时有效，关键事项请用 Android App」。首页告知条维持既有红线（非原生 ⇒ 不出声）未改 | — |
| P1-⑨ 测试基建 | ✅ 已修 | test-unit 用 `Object.defineProperty` 覆盖只读 `navigator`；`npm test` 改为 `scripts/run-tests.js` 逐套件运行并汇总，单套失败不再截断后续 | Node 22.23.1 下 15/15 套件通过 |
| P2-⑭ 文案过时 | ✅ 已修 | README 文件地图（styles.css 实为文档页样式）、README「右下角 +」、稍后档位描述（5 预置 + 自定义）、使用说明「点右下角 ＋」 | — |
| P2-⑮ 排程上限 | ✅ 已修 | 对账单次最多排 400 条（低于 Android ~500 上限），按时间最近优先保留，状态带 `truncated`；远期的在下一轮对账自动补上 | 新增 3 项断言 |
| P1-④ / ⑦ / ⑧、P2-⑩⑪⑫⑬⑯⑰ | ⏳ 未动 | 属 UI/交互改造或需要产品取舍（到点事项可编辑、深色模式、状态标识、倒计时、触控/无障碍、幽灵闹钟、DND 说明），建议单独排期 | — |

**仍需真机确认**：渠道 v5 迁移（装新包后 `adb shell dumpsys notification | grep attention-alarm` 应只剩 v5，且无 sound/vibration）与 P0-② 补投（强停后过点 10 分钟再打开 App 应收到补投通知 + toast）。

**环境备注**：Android JVM 单测（`./gradlew testDebugUnitTest`）在本机 JDK 24 下有 3 项因 Mockito inline 无法 mock `Intent`/`UserManager` 失败，属工具链兼容问题，与本次改动无关；`compileDebugJavaWithJavac` 通过。
