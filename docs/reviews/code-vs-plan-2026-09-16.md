---
doc: code-review
date: 2026-09-16
scope: 代码实现 vs 项目规划（V0.2 基线 + A-01 + D1–D25 + compose specs）
commit: a2d384b (main) "feat: land D1-D25 interaction decisions into Web and Android"
method: 逐条读码 + 全量跑测 + 交叉核对验收台账
verdict: 方向正确、主体已落地；但存在 3 个 P0 缺陷与 2 处链路级未完成，当前不能判定为「已满足规划」
fix_status: P0-1 / P0-2 / P0-3 / P1-4 / P1-6 已修复；第二轮复核另发现并修掉 3 个既有缺陷（N1–N3）。测试 136 → 194 条全绿
---

# 代码实现 vs 项目规划 · 审查报告

## 0.0 修复状态（2026-09-16 晚补记）

本报告的全部 P0 与两项 P1 已在本轮修复；随后第二轮独立复核又发现 3 个既有缺陷（见 §0.1），
一并修完。测试从 136 条增至 **194 条**（unit 29 / native 69 / smoke 96）全绿：

| # | 缺陷 | 修复 |
|---|---|---|
| **P0-1** | 待整理原生排程从未接线 | `reconcile()` 新增第 4 个参数接收 `{count, settings}`，把 `buildReviewDesired()` 并入同一次对账；`syncNativeRemindersNow()` 传入实际队列 |
| **P0-2** | 全屏闹钟只排不撤 → 幽灵闹钟 | 新增 `reconcileAlarms()`：按台账撤销不再需要的闹钟，`reconciled` 后回写 `settings.scheduledAlarmIds`（带防自激守卫）；`AlarmActivity` 自行重排的闹钟也入账 |
| **P0-3** | 整理会话「稍后 / 跳过本次」不可达 | `renderReviewCard()` 随卡片一起重建这两个出口并在渲染处挂载；`bind()` 里的孤儿绑定移除 |
| **P1-4** | 全屏闹钟无开机恢复 | 新增 `BootRestoreReceiver` + `SystemBridgePlugin` 闹钟落盘/撤销/恢复（Java 仅 javac 语法级通过） |
| **P1-6** | 待整理误用「重要」渠道 | `reviewNotificationFor()` 改回 `CHANNELS.normal`，并顺带补上快捷动作类型 |
| **附带** | `showSystemNotification()` 的 `"Notification" in window` 判断在属性存在但为 `undefined` 时抛错，会打断整轮 tick | 改为真值判断（同源的 `renderPwaStatus()` 由 §0.1 N3 一并修掉） |
| **附带** | D8 偏离：空态里渲染了可点击的完成卡片 | 收回为纯文字一句 |

**P1-5（schema 5 / G01 正交状态建模）未做** —— 属建模变更而非缺陷修复，且规格要求与 G01 合并成一次迁移，
不宜在修复轮里拆做两次。验收台账的覆盖列已按复跑结果回填（✅ 30 / 🟡 17 / ⬜ 41）。

## 0.1 第二轮：独立复核新发现的**既有**缺陷（2026-09-16 晚，修复轮之后）

复核不依赖上一轮的结论，改用**可执行探针**驱动真实状态机（而非读代码推断），
又发现两个**不在本报告首轮清单里**的既有缺陷。两者都不是修复轮引入的。

| # | 缺陷 | 证据 | 修复 |
|---|---|---|---|
| **N1** | **整理会话提醒每分钟重复发**：`reviewSessionKey()` 用「分钟」做粒度 → key 每分钟都变 → `maybeReviewSession()` 里 `lastSessionKey !== key → followupCount = 0` 被反复触发 → `maxFollowups` 永远回不到上限。实测窗口内 6/6 采样时刻全部发通知（期望 ≤2），即 21:30–23:00 会发 **~90 条**；违反 D22（当天最多 3 次）。若配合「稍后」跨出窗口，则因 `snoozedUntil` 永不清空而**无限重复**（实测 6/7 采样触发） | 假时钟探针驱动 `maybeReviewSession`，对照修复前后 | key 改为**窗口粒度** `W:<窗口起点>`，「稍后」独立额度 `S:<时刻>`；`snoozedUntil` 过 1 小时宽限期即清空；旧版分钟 key 自动作废。回归断言见 `test-smoke.js` 3f（已验：修复前 3/5 条失败） |
| **N2** | **「稍后」在原生侧被吞**：`buildReviewDesired()` 完全忽略 `snoozedUntil`，22:50 点「稍后 30 分钟」→ 安卓上 23:20 无任何提醒，直接落到次日 21:30；违反 D20 | 探针输出对照（修复前首条 = 次日 21:30） | `snoozedUntil` 单独占一个槽位；勿扰顺延只作用于锚点，补提醒按固定间隔从锚点后推（否则三条会被各自顺延压成一条被去重） |
| **N3** | `renderPwaStatus()` 与 `showSystemNotification()` 同源的 `"Notification" in window` 写法：属性存在但为 `undefined` 时抛错（Capacitor WebView 下会命中），会打断初始化与整轮 tick | 探针首次运行即崩在该行 | 两处统一改为真值判断 |

**方法论收获（已沉淀为 skill `plan-vs-code-audit`）**：
首轮用"读码 + 检索调用点"找出了三个接线级 P0，但**漏掉了 N1**，因为它不是"没接线"，
而是"接线了但闸门失效"。这类缺陷只有**用假时钟驱动真实状态机**才能暴露——
所以复核必须换手段，不能用同一把尺子量第二遍。

---

## 0. 一句话结论

`a2d384b` 确实把 D1–D25 的**产品语义**落进了代码，方向与决议一致，测试全绿（unit 29 / native 42 / smoke 65）。
但有三处**链路上没有真正跑通**：Android 侧「待整理」的原生排程从未接线、全屏闹钟只排不撤（幽灵闹钟）、
整理会话的「稍后 / 跳过本次」两个出口被渲染覆盖而不可达。叠加 3 处文档与代码互相矛盾、
以及测试里一条**掩盖性断言**，目前**不能判定为"代码满足项目规划"**。

判定：**部分满足（约 70%）**。产品语义层基本达成，可靠性层与原生链路层未达成。

---

## 1. 已落地且经核对成立（与规划一致）

| 决议 | 实现位置 | 核对 |
|---|---|---|
| D5 首页删「即将到来」 | `app-core.js:1376-1378, 3029` | ✅ 首页不再渲染未来列表 |
| D6 待整理常驻弱入口（无数字/无强调色） | `app-core.js:998-1021, 1408-1424` | ✅ 弱/显著两形态齐全，位置在「需要注意」之后 |
| D7「已看到未完成」永远折叠成一行带数量 | `app-core.js:1386-1393` | ✅ 无 ≤3 条阈值 |
| D9/D25 首次走全屏闹钟的路由 | `native-reminders.js:196-201, 233-237, 442-464` | ⚠️ 逻辑在，但见 P0-2 |
| D11 快捷动作 = ACK / 稍后 2h / 完成 | `AlarmActivity.java:104-121`、`app-core.js:2677-2680` | ✅ 通知栏与全屏一致，10 分钟硬编码已删 |
| D12 全屏「关闭」只止响、不写 ACK | `AlarmActivity.java:119-121, 228-234`、`app-core.js:2694-2697` | ✅ 返回键 = 关闭，无记账 |
| D13 只有点 × 才关闭 | `app-core.js:3176-3186, 3823-3825, 3845-3846` | ✅ outside dismiss 已移除 |
| D14 弹条 10 分钟自动收起且不记账 | `app-core.js:3139-3145, 3167-3174` | ✅ 计时器只做展示，不动 `remindCount` |
| D15 极简选择仅在「含时间词却落兜底」时弹 | `app-core.js:2391-2404`、`parse-cn.js:285` | ✅ 判定条件可测 |
| D16 卡片显式展示「系统解析」 | `app-core.js:879-882` | ✅ 兜底时写「未设定时间 · 已用兜底值」 |
| D17 兜底 = 下一个 Review Window 且不进 due | `app-core.js:688-695, 1075-1082, 2361-2370` | ✅ Review 关闭时退次日晚间 20:00 |
| D20 通知点击直达整理会话 | `app-core.js:2655-2670, 3964-3968` | ✅ 原生与深链两路都有 |
| D22 补提醒 60 分钟 × 2 | `app-core.js:666-683` | ✅ 含 45×1 → 60×2 的旧参数升级 |
| D23 归档重开不设 `trigger_at` | `app-core.js:1242-1262` | ✅ 且与基线 AC-18 一致 |
| D24 冷启动进首页 / 分享直达输入 | `app-core.js:3380-3390, 4012-4019` | ✅ 按决议保留基线内部张力，未自行优化 |
| D25 快照赋值 + 编辑重算 + 设置两行文案 | `app-core.js:640-651, 2314-2315, 3709-3727`、`index.html:938-946` | ✅ 规格 S2.3/S2.4/S2.8 逐条命中 |

测试实测（本机复跑）：

```
unit  通过: 29  失败: 0
native 通过: 42  失败: 0
smoke  通过: 65  失败: 0
```

---

## 2. P0 · 必须修（链路没跑通 / 会造成错误行为）

### P0-1 「待整理」的 Android 原生排程从未接线 → 安卓上待整理到点不会响

- `lib/native-reminders.js:278-294` 定义了 `buildReviewDesired()` 并导出（`:586`），
  但**全仓没有任何调用点**——唯一提及是 `app-core.js:774` 的一句注释。
- `reconcile()`（`lib/native-reminders.js:409-476`）只消费 `buildDesired(items, settings)`，
  函数签名里根本没有 review 状态，所以待整理通知进不了 desired。
- `app-core.js:773-776`：原生平台下 `fireReviewNotification()` 直接 `return`（注释说"由 reconcile 排程"）。
  两头都指望对方 → **没有任何一方排程**。

**后果**：Android 上 D19/D22 只落了参数，没落链路。待整理的到点提醒、补提醒全部无效。
直接违反 AC-07 / AC-08 / V0.2 §9.3，验收台账 D9 / D11 / D12 三条失效。
Web（PWA）路径正常，所以问题只会在真机上暴露——而真机验证当前是 `NOT_PERFORMED`。

### P0-2 全屏闹钟只排不撤 → 幽灵闹钟

- `lib/native-reminders.js:442-464`：每次对账都对 alarm 档调 `bridge.scheduleAlarm`，
  **但从未对"不再需要的闹钟"调用 `cancelAlarm`**。
- `SystemBridgePlugin.cancelAlarm`（`:331-348`）与 `AlarmScheduler.cancel`（`:57-66`）都实现了，
  app-core 只在**自检面板**里用过（`app-core.js:2845-2851`，固定 id 90002/90003）。
- 闹钟 id 由 `scheduleKey`（含时刻）哈希而来 → 编辑时间/稍后/重开后 **id 变了，旧闹钟就留下来了**。
- 附加放大：`AlarmActivity.java:124-137` 的「稍后 2 小时」自行用**旧 id** 又排一条 AlarmClock，
  与随后 reconcile 产生的新排程叠加 → 同一事项可能连响两次。

**后果**：删除事项、修改时间、ACK、完成、甚至**关闭通知权限**之后，
已经排下的全屏闹钟照响。违反 AC-11 / §14「删除 → 所有未来调度同时撤销，不得幽灵提醒」、
INV-09「调度可由数据库重建」、`product-logic.md` §6.3「通知权限未授予 → 取消所有已排的原生通知」。

### P0-3 整理会话「稍后 / 跳过本次」两个出口被渲染覆盖 → 用户永远点不到

- `index.html:1488-1491`：`#reviewFoot` 里静态放了 `#reviewSnooze`、`#reviewSkip`。
- `app-core.js:2930-2933`：`bind()` 把监听器绑到**这两个静态节点**上。
- `app-core.js:901-910`：`renderReviewCard()` **每次渲染都把 `#reviewFoot.innerHTML` 整体替换**成
  「删除 / 确认 / 保存修改」→ 两个按钮被移出 DOM，监听器成为孤儿。
- `openReviewSession()`（`app-core.js:840-852`）流程是 `openSheet` → `renderReviewCard`，
  所以会话一打开，两个出口就已经消失。

**后果**：验收 D12（Review 通知可 Snooze / 今天跳过）、D15（稍后五档：30 分钟 / 2 小时 / 今晚 / 明天 / 下一个整理时间）
在 Web 上完全不可达。`snoozeReview()` 只剩原生通知快捷动作一条路（`app-core.js:2664`），
而 `#sheetReviewSnooze`（`index.html:1494-1515`）的五个档位成了没有入口的死 UI。

---

## 3. P1 · 应修（缺口明确，暂未造成错误行为）

| # | 问题 | 证据 |
|---|---|---|
| **P1-4** | **全屏闹钟无开机恢复**。`AndroidManifest.xml` 只有 Capacitor LocalNotifications 的 `MY_PACKAGE_REPLACED` receiver，`AlarmTestReceiver` 没有 `BOOT_COMPLETED`；而 `reconcile` 只在 app 启动 / 回前台时才跑。关键/重要档的「首次」提醒重启后丢失。违反 AC-13。 | `AndroidManifest.xml:48-63` |
| **P1-5** | **schema 仍是 4，未按 `delivery-mode.md` T9 做 schema 5 迁移**（规格要求与 G01 正交状态建模合并）。现用 `normalizeItem` 惰性回填代替（`app-core.js:631-635`）。连带 H1/H2（四维正交状态、`time_source`）完全未落地，验收 H 组 3 条全 ⬜。 | `app-core.js:8`（`SCHEMA = 4`） |
| **P1-6** | **待整理通知用了「重要」渠道**（importance 4），与 README「待整理…只用普通通知」及 D18「按普通事项参与勿扰」相悖。当前是死代码，一旦按 P0-1 接线就会立刻生效。 | `native-reminders.js:262`（`channelId: CHANNELS.important`） |
| **P1-7** | **`reconcile` 的 alarm 与 LocalNotifications 用两套 id 空间但共用一个计数器来源**（`allocateId` 各自独立 `usedIds`），且 alarm 通知与 LocalNotifications 通知落在同一个 `nm.notify(id)` 命名空间，存在潜在覆盖。 | `native-reminders.js:154-162, 254-275` |

---

## 4. 文档 ↔ 代码 不一致（3 处，会误导后续判断）

1. **`docs/acceptance-cases.md` 头部仍是旧状态**：写「⚠️ D1–D25 与 A-01 都还没落地」、
   覆盖总览 8 / 16 / 64。该文档 14:31 写，代码 19:5x 落地，此后未回填。
2. **`docs/compose/spec/delivery-mode.md` 仍写「规格已定，代码未落地」**，T1–T10 全为未勾选 `[ ]`，
   而 T1–T8 实际已实现（T9/T10 未完成）。
3. **`docs/product-logic.md` 自相矛盾**：头部声明「25 项裁决已落地」，
   正文 §7.2（兜底 now+7 天）、§8（首页 5 块含「即将到来」）、§6.3（点击任意区域关闭弹条）、
   §11 的 I1/I5/I9（标「待落地」）仍描述旧行为，§8 末尾还写着「**以上均待落地**」。

---

## 5. 测试可信度（最需要警惕的一节）

1. **`test-smoke.js:169` 是一条掩盖性断言**。`acceptance-cases.md` §13 明确列出这条会与 D17 冲突、
   处置方式是「改测试：断言兜底时间落在下一个窗口起点」。**它没被改，而且还在全绿**：

   ```js
   ok("低置信度默认一周左右", Math.abs((p2.trigger - now.getTime()) - 7 * 86400000) < 3600000);
   ```

   现在它测的是解析器内部的原始兜底值（产品行为已由 `fallbackTriggerAt()` 覆盖），
   名称与语义都已失效。这正是本轮最该做的事被漏掉的痕迹。

2. **smoke 的 3b 节标题写 `D5/D7/D17/D23/D25`，实际只断言了 D17 / D22 / D25 / D15 共 9 条**
   ——**D5 与 D7 一条断言都没有**。而 `README.md:79` 声称「含 D5/D7/D15/D17/D22/D23/D25 落地断言」，不实。

3. **`test-native-reminders.js` 全文 0 次提及 `buildReviewDesired` / `shouldFirstAlarm` / `useAlarm` / `cancelAlarm`**；
   mock 环境只注入了 `LocalNotifications` + `App`（`test-native-reminders.js:63-66`），**没有 SystemBridge**。
   所以 D9/D25 的全屏闹钟主链路在测试里根本不存在 —— 42 条全绿**不能**证明该链路可用。
   P0-1 与 P0-2 正是从这两个测试盲区里漏出去的。

4. 验收台账 88 条中 64 条 ⬜（该数字本身也已过期）。**测试全绿 ≠ 规划已满足**：
   现有 136 条断言主要覆盖解析、生命周期、勿扰、投影计算，对 D 组（待整理 16 条）、
   G 组（首页信息架构 6 条）、I 组（Onboarding 3 条）几乎为零。

---

## 6. 建议修复顺序

按依赖与收益排序，每步都能独立跑绿：

1. **P0-3**（最小改动、收益最高）— 把 `#reviewSnooze` / `#reviewSkip` 移出 `#reviewFoot`，
   或改为事件委托（`#reviewFoot` 上一次委托，不依赖节点存活）。
2. **P0-2**（幽灵闹钟）— `reconcile` 增加 alarm 对账：持久化已排 alarm 的 id 集合，
   取消不在 desired 中的；`AlarmActivity` 的「稍后 2 小时」改走 LocalNotifications 或交由 reconcile 统一重排。
3. **P0-1**（待整理原生链路）— 扩展 `reconcile` 签名接收 review 状态（count + reviewSettings），
   把 `buildReviewDesired()` 并入 desired；顺手按 P1-6 把渠道改回 `normal`。
4. **P1-4**（开机恢复）— 加 `BOOT_COMPLETED` receiver 或首启强制 `reconcile`。
5. **P1-5**（schema 5）— 与 G01 正交状态建模合并做，一次迁移到位。
6. **补测试 + 修断言**：
   - 改 `test-smoke.js:169` 为「兜底落在下一个 Review 窗口起点」；
   - 补 D5 / D7 的渲染断言；
   - `test-native-reminders.js` 的 mock 注入 SystemBridge，补 alarm 首次路由、alarm 撤销、待整理排程三组用例；
   - 回填 `acceptance-cases.md` 的覆盖列与头部状态。
7. **文档回填** — `product-logic.md` 正文、`delivery-mode.md` 的 Report 与 Tasks 复位。

---

## 7. 与「验证边界」相关的一句提醒

`README.md:190` 与 `acceptance-cases.md:219` 都声明：本机无 JDK 17 / Android SDK / 模拟器，
Gradle 编译、APK 生成与安装、Doze、重启、真机通知动作**全部为 `NOT_PERFORMED`**。

这条声明是诚实且应当保留的。但要明确指出：**P0-1、P0-2、P1-4 三条都只会在真机上暴露**，
而它们恰好落在当前测试的唯一盲区里。所以「npm test 全绿」在这三条上不构成任何证据，
不宜在文档里被读成 Android 侧已就绪。
