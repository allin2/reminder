---
doc: code-review
date: 2026-09-18
scope: 全仓库（Web 核心层 / 原生投影层 / Android Java / PWA）
method: 只读源码审查 + 既有测试套件复跑 + 解析/周期算法实测
tests: unit 105 / native 193 / smoke 175 / regressions 567 = 1040，全部通过
verdict: FAIL（存在 7 项高危缺陷，其中 3 项已在离线实测中复现）
---

# 代码审查问题报告 · 安心收件箱

> 分级说明：**高** = 会导致「漏提醒 / 错时提醒 / 崩溃 / 数据丢失」且在日常路径上可稳定触发；
> **中** = 特定条件或边界下出错、诊断失真、可维护性风险；**低** = 体验瑕疵、冗余、潜在隐患。
> 每条标注 **[已确认]**（本次已用源码 + 实测复现）或 **[待验]**（需真机 / 特定 ROM 验证）。

---

## 一、总体结论

| 维度 | 结论 |
|---|---|
| 主体功能可用性 | **不合格**。核心链路（捕获 → 解析 → 排程 → 投递 → 动作回流）**架构完整、事务设计（提交闸门 / 隔离草稿 / 事件去重 / 版本校验）质量高**，但**中文时间解析层存在系统性错误**，最高频的「下周X」「每月N号」「下个月N号」三类表达**解析结果错误**，直接把「不错过」变成「准时错过」。 |
| 测试与真实覆盖 | 1040 条断言全绿，但 `docs/acceptance-cases.md` 自陈 88 条验收用例中**仅 30 条有断言、41 条待补**，E（Deadline 分层保护）/ H（状态模型）/ I（Onboarding）三组近乎零覆盖。**测试全绿 ≠ 功能可用**。 |
| 缺陷密度 | 高 7 · 中 21 · 低 13 |
| 建议处置 | 先修 H-01～H-03、H-05、H-06（解析 + 排程对称性），再修 H-04（崩溃）、H-07（降级数据丢失）。 |

---

## 二、高危问题（High）

### H-01 「下周X」全部被算成「下下下周X」——偏移整整一周 **[已确认]**
- **位置**：`lib/parse-cn.js:251-262`（生产实现，index.html:1781 加载，`app-core.js:1670` 转发）
- **代码**：
  ```js
  } else if (/下周([一二三四五六日天])|下星期([一二三四五六日天])/.test(text)) {
      let delta = ((target - day + 7) % 7) || 7;
      delta += 7;                       // ← 多加了一周
  ```
- **实测**（基准 2026-09-18 周五 14:00）：
  | 输入 | 期望 | 实际 |
  |---|---|---|
  | `提醒我下周三交房租` | 2026-09-23 | **2026-09-30** |
  | `下周三下午3点开会` | 2026-09-23 15:00 | **2026-09-30 15:00** |
- **佐证矛盾**：同文件 `下周日` 分支（:244-250）用 `((7-day)%7)+7`，只加一次 7，语义正确。**同一语义两种实现，其中一个必然错。**
- **业务影响**：「下周X」是最高频的相对时间表达之一。系统性晚一周提醒 = 准时错过；若用户依赖它安排 deadline 类事项，保护机制也会连带错位点。
- **修复方向**：`delta += 7` 改为不加，或用 `|| 7` 后的值直接作为「下周」偏移。

### H-02 「每月 N 号」不识别，落到「+30 天」兜底 → 周期锚点永久漂移 **[已确认]**
- **位置**：`lib/parse-cn.js:169`（absDate 正则） + `:429-436`（repeat 兜底）
- **原因**：`absDate` 要求「数字 + 月 + 数字 + 日/号」，「每月15号」没有可解析的月份数字 → 不匹配；`cleaned` 保留「15号」；最终落入 repeat 分支 `applyTime(addDays(base, 30), 10, 0)`。
- **实测**：
  - `每月15号提醒我` → 触发时间 **2026/10/18 10:00**，标题退化为 `15号`
  - 之后 `nextRepeatTrigger` 以 triggerAt 为锚 → **每月 18 号**，永远回不到 15 号
- **业务影响**：用户交出去的是「每月15号交房租」，系统兑现成「每月18号」。且无任何提示（confidence=mid，界面显示"已设置"）。
- **修复方向**：补一条「（每|下个?）?月?\s*(\d{1,2})\s*[号日]」规则；无「月」时取当前/下一月。

### H-03 「下个月 N 号」日期被丢弃，一律算成下月 1 号 **[已确认]**
- **位置**：`lib/parse-cn.js:281-285`
- **代码**：`const d = new Date(now.getFullYear(), now.getMonth() + 1, 1, 10, 0, 0, 0);` —— 硬编码 `1` 号，忽略同句中的「5号」。
- **实测**：`下个月5号交电费` → **2026/10/1 10:00**（应为 10/5）
- **业务影响**：绝对日期丢失，且 confidence=mid 让界面显示"已设置"，用户无从察觉。
- **修复方向**：先尝试 `absDate` 的日部分，命中则覆盖 day。

### H-04 API 22/23 上全屏闹钟 `onCreate` 崩溃 **[已确认·代码级]**
- **位置**：`android/app/src/main/java/space/alliswell/inbox/AlarmActivity.java:302`
- **代码**：`return nm != null && nm.areNotificationsEnabled();` 包在 `catch (Exception ignored)`
- **问题**：`NotificationManager.areNotificationsEnabled()` 是 **API 24** 新增方法；`minSdk = 22`。在 Android 5.1/6.0 上调用抛 `NoSuchMethodError`——**继承自 Error，不是 Exception，catch 兜不住**。
- **自证**：同仓库 `SystemBridgePlugin.java:236-244` 已明确写下这条陷阱并改用 `NotificationManagerCompat`，说明这是**已知坑的遗漏点**，不是新发现。
- **业务影响**：该档设备上全屏闹钟整体起不来（零投递），且崩溃发生在 `onCreate`，无降级路径。
- **修复方向**：改用 `NotificationManagerCompat.from(ctx).areNotificationsEnabled()`。

### H-05 已「我知道了」的事项仍会弹截止提醒（排程对称性断裂）**[已确认]**
- **位置**：`lib/native-reminders.js:269-277` vs `:313`
- **代码**：
  ```js
  const active = item.status === "waiting" || item.status === "snoozed" || item.status === "due";
  if (active && item.triggerAt && !reviewSuppressed) { /* primary 排程 */ }
  ...
  if (item.deadlineAt && !item.deadlinePaused) { /* 截止排程 — 未校验 active/status */ }
  ```
- **表现**：primary 有 `active` 准入，`acknowledged` 不再排；**截止块完全不看 `status`**，于是用户点过「我知道了」后，到 p24 / p2 保护点仍会收到截止提醒。
- **业务影响**：与 INV-05「截止保护独立」的初衷冲突——本意是「未完成就该唤醒」，但 `acknowledged` 恰恰是用户刚表达过"我看到了"的状态，立刻再弹属于**重复打扰**，会侵蚀产品最核心的"不打扰"承诺。
- **修复方向**：截止块纳入与 primary 同源的状态准入（至少排除 `acknowledged`），并把准入条件集中到一处。

### H-06 普通事项触发时刻落在勿扰区 → 永久丢弃、无补偿 **[已确认]**
- **位置**：`lib/native-reminders.js:184-191`（`effectiveTriggerAt`）+ `:286`
- **链路**：`effectiveTriggerAt` 把 normal 事项顺延到 `quietEnd`；若对账时 `now` 已越过 `quietEnd`，则 `at <= now` → `continue` **直接丢弃**；既不入 desired，旧排程又会在本轮被 `stale` 撤销。
- **触发**：normal 事项 triggerAt 在 23:00–07:30 内，且用户在 07:30 之后才打开 App 对账（**最常见的日常场景**）。
- **业务影响**：该事项**永久静默消失**，不提醒、不进首页（status 仍是 waiting，只有打开「未来」才看得到）。
- **修复方向**：`quietEnd` 已过 `now` 时顺延到下一个可用窗口/次日，而不是静默丢弃。

### H-07 IndexedDB 读取失败降级后，写入落错后端 → 改动静默丢失 **[已确认·逻辑推演]**
- **位置**：`app-core.js:798-811`（`loadAsync`）+ `:543-554`（`writeSnapshot`）+ `lib/storage.js:125-140`
- **链路**：
  1. `storage.load()`（IDB）抛错 → `storageReady = false` → 回退 `loadSync()` 读 **localStorage 镜像**
  2. 之后所有 `writeSnapshot` 因 `storageReady=false` **只写 localStorage**，IDB 保持旧值
  3. 下次启动 IDB 恢复 → `load()` 返回 IDB 旧值 → **降级期间的全部改动被覆盖**
- **触发**：IDB 打开/读取失败（隐私模式、存储被清理、WebView 配额异常）。
- **业务影响**：**静默数据丢失**，且用户完全无感（界面照常可点）。这与项目自己的红线「调用成功 ≠ 做对了」直接冲突。
- **修复方向**：降级期间仍尝试写 IDB；或降级时给出明显提示并禁止覆盖（读 IDB 成功时若 localStorage 有更新的 rev/时间戳，提示冲突而非直接以 IDB 为准）。

---

## 三、中危问题（Medium）

| # | 位置 | 表现 | 业务影响 | 状态 |
|---|---|---|---|---|
| M-01 | `lib/parse-cn.js:315-323` | 「10点半」分钟解析失败且「半」污染标题。实测 `明天上午10点半面试` → **10:00**，标题 `半面试` | 提醒时间错 + 标题不可读 | 已确认 |
| M-02 | `lib/parse-cn.js:330-335` | 纯时长输入的标题退化为整句。`四十分钟后提醒我` → 标题 = `四十分钟后提醒我`（时长被剥掉后 `title` 为空，回退 `raw`） | 首页/通知标题变成整句话，不可读 | 已确认 |
| M-03 | `lib/parse-cn.js:160-181, 414-423` | 「截止/到期」关键词**只有同时存在绝对日期**才会转成 `deadline`。`截止到本周五` → 只在今天 15:00 提醒一次，**无 deadline**，标题 `截止到本` | 截止语义丢失，用户以为"已设置截止" | 已确认 |
| M-04 | `lib/repeat.js:80-89` | `every:"month"` 从 1/31 递推 → 2/28 → **3/28 → 4/28**（最小值被固化）。注释写「收敛到该月最后一天」，实现是「收敛后不再回来」；对比 `monthEnd` 分支正确（2/28→3/31） | 「每月31号」变成「每月28号」 | 已确认 |
| M-05 | `lib/native-reminders.js:743-748` | `local.schedule({notifications: missing})` 后直接 `scheduled = missing`，**无回读校验**。抛错已捕获（:749），但「resolve 却未真正落库」不可见 | 静默漏排，状态仍显示"已排程" | 待验 |
| M-06 | `lib/native-reminders.js:323-326` + `app-core.js:3443` | 已排期且投递时刻已过的阶段记为待定；若用户在保护点**之后**才关/开通知总开关，`applyDeadlineEvents` 因 `at > now` 不成立而不会标 `cancelled` → 该阶段**永不补提醒** | 漏一次截止保护 | 待验 |
| M-07 | `lib/native-reminders.js:717-724` | `getPending` 抛错 → `pending = []` → `stale` 为空 → `cancelledDeadlineEvents` 无条目 → 已撤销阶段无法补排 | 漏提醒 | 待验 |
| M-08 | `lib/native-reminders.js:51-55` | Lib 未注入时 `deadlineStagePoints` 只返回 `p24`，**p2 阶段不排** | 降级路径下截止前 2h 保护缺失 | 已确认 |
| M-09 | `app-core.js:5713-5724` | 把**非幂等的对账回调**（`applyDeadlineEvents` / `markDeadlineDelivered` / `refreshNativeScheduleBasis`）纳入用户命令日志重放。`replayUserOps` 遇到返回 `false` 会抛 `transaction-replay-business-rejected` → 整笔闹钟动作事务失败。典型场景：闹钟动作提交在途时 `onDelivered` 到达并被记录，重放时 `markDeadlineDelivered` 因"已 delivered"返回 `false` | 用户在闹钟上点「完成/我知道了」偶发失败、原生事件反复重试 | 已确认 |
| M-10 | `app-core.js:236-457 / 1515-1558` 与 `lib/parse-cn.js`、`lib/repeat.js` | 中文解析、周期递推、静默时段、日期工具**整份重复**且**已分叉**：app-core 内置 `cnInt` 不认识「四十/九十/一百」（`lib` 版支持）。当前靠 `:1670-1673` 覆盖，一旦 lib 未加载即走劣化实现 | 两份规则各自漂移；降级路径行为不一致 | 已确认 |
| M-11 | `app-core.js:5439-5470, 3478-3506` | 原生同步失败时写 `error`（单数），`renderPwaStatus` / `refreshNotifyLab` 读 `errors`（复数）→ 诊断面板显示「未知原因」；且 `setNativeReminderStatus` 用 `Object.assign` 会让上一次的 `errors` 残留造成误报 | 排障时看不到真实原因，反复试错 | 已确认 |
| M-12 | `app-core.js:4523-4534 / 5367-5374` | 整理时间 / 勿扰时段只校验 `^\d{1,2}:\d{2}$`，不校验范围（**99:99 通过**）→ `setHours(99)` 溢出到次日；`quietStart === quietEnd` 时 `inQuietHours` 直接返回 false，勿扰整段失效 | 勿扰/整理窗口静默失效 | 已确认 |
| M-13 | `app-core.js:1930-1932` | `it.url` 直接进 `<a href>`，只做 HTML 转义、**未校验协议**。分享深链 `?url=` 可控 → `javascript:` / `data:` 可执行 | WebView 内脚本注入 | 已确认 |
| M-14 | `app-core.js:2050, 2149-2150` | `new Date("YYYY-MM-DD")` 按 **UTC** 解析；在 UTC-xx 时区 `getMonth()` 会变成上一个月 | 非东八区用户日历显示错月 | 已确认 |
| M-15 | `app-core.js:4843-4848` | 导入数据合并 `settings` 时未清理 `alarmEventLog` / `scheduledAlarmIds`；跨设备导入可能让新事件被判为"已处理"，或残留指向已不存在排程的 id | 幽灵排程 / 动作被吞 | 已确认 |
| M-16 | `app-core.js:1496-1508` vs `:1485-1490` | 截止阶段把 `remindCount` 归零，普通到期设为 ≥1；与 `shouldRealert` 的「首次已计数」约定不一致 | 重要/关键多一次追提醒 | 已确认 |
| M-17 | `android/.../SystemBridgePlugin.java:464-466` | `callItemRev()` 用 `intArg` 把 `itemRev` 先转 int 再转 String，大版本号溢出；`AlarmActivity` 只按**应用级**通知开关决定是否自播，未检查**渠道重要性** | 渠道被单独禁音 → 静默闹钟（不响） | 已确认 |
| M-18 | `android/.../AlarmActivity.java:114-137` | `onNewIntent` 切换投递时只 `stopAlarmEffects()`，**未撤销上一条的 insistent 通知** | 两条闹钟重叠时旧通知持续响/残留 | 待验 |
| M-19 | `android/.../BootRestoreReceiver.java:24` | 主线程同步解析 JSON + 逐条 `schedule`（内含 `commit()` 落盘） | 闹钟多时开机恢复 ANR | 待验 |
| M-20 | `docs/acceptance-cases.md:22-41` | 88 条验收用例 **✅30 / 🟡17 / ⬜41**；E(Deadline)、H(状态模型)、I(Onboarding) 三组近乎零断言 | 1040 条测试全绿但主体功能不可验证 | 已确认 |
| M-21 | `app-core.js:2626-2632` | `confirmDialog` 只判空 `sheet`/`body`，未判空 `titleEl` → 缺元素时 `titleEl.textContent` 抛错 | 确认弹窗崩溃 | 已确认 |

---

## 四、低危问题（Low）

| # | 位置 | 表现 |
|---|---|---|
| L-01 | `sw.js:3-13` | 离线缓存清单缺 `styles.css`、`lib/native-reminders.js`、`icon-192/512.png`；Cache 名 v3 未随资源更新 → 离线样式/图标丢失 |
| L-02 | `sw.js:63` | `notificationclick` 未回传 `tag`，`app-core.js:5514` 的 `data.tag === "review-session"` 永不命中（另一分支已覆盖，暂不致命） |
| L-03 | `app.js`（161 行） | 实为 **PRD 页面**脚本（生命周期图 / TOC），与文件名暗示的主入口不符，且 `index.html` 未引用 |
| L-04 | `app-core.js:4831-4855` | 导入失败提示固定为「文件格式不正确」，`normalizeItem(null)` 抛错也归到同一文案；导入后不重置 `state.ui.reviewQueue/detailId/snoozeId` |
| L-05 | `app-core.js:4820` | `new File(...)` 在不支持的浏览器直接抛错，未 try/catch，导出功能整体失败 |
| L-06 | `app-core.js:2782-2793` | `findSimilarItems` 用 `key.includes(t)`，目标标题为单字时大面积误报 |
| L-07 | `app-core.js:5661/5666/5667` | `init()` 内 `render()` 被调用 2–3 次；`renderHome()` 每 15s 全量重建首页 |
| L-08 | `app-core.js:2572-2596, 2401-2408` | AI `apiKey` 明文写入 `state.settings` 并随每次 `save()` 落盘；`baseUrl` 无协议校验（可填 `http://` 明文传输密钥） |
| L-09 | `app-core.js:2229-2233` 等多处 | `renderMe()` 等渲染函数对 DOM 元素未判空（本次核对 170 个 id 与 `index.html` 完全对齐，但任何一次模板改动即崩溃） |
| L-10 | `app-core.js:2979-2981` | 编辑态下若事项在开表期间被删除，`saveItemFromForm` 会 `editing = null` → 静默**新建**一条而非报错 |
| L-11 | `lib/native-reminders.js:286` vs `:331` | 未来阈值不一致：primary 用 `at <= now` 丢弃，deadline 用 `at > now + 1000` 才排 |
| L-12 | `android/.../AlarmScheduler.java:138-159` | `cancel()` 未对称撤销排程时创建的 `id + 100000` showIntent PendingIntent |
| L-13 | `android/.../AppSettingsPlugin.java:17-78` 与 `SystemBridgePlugin.java:672-833` | 四个设置跳转方法完全重复实现，易漂移 |

---

## 五、已核对「无问题」的项（避免过度报告）

- **DOM 契约**：`app-core.js` 引用的 170 个 id 与 `index.html` 的 188 个 id **完全对齐**；`index.html` 无重复 id、无内联 `on*`、无内联 `<script>`。
- **XSS 主路径**：`escapeHtml` 覆盖标题/备注/标签/项目名；`renderMarkdown` 先转义再解析，链接白名单只放行 `http(s)`。
- **通知 id 冲突**：`hash32`/`allocateId`（`native-reminders.js:193-211`）恒产出 `0..2^31-2` 的正整数并做批内去重，业务 id（含负数测试 id -917xxx）仅作哈希输入，**不会与 Android int 冲突**。
- **PendingIntent 安全**：Android 侧全部 `FLAG_IMMUTABLE`；`AlarmActivity`/`AlarmTestReceiver`/`AlarmRingService` 均 `exported=false`；权限声明与代码调用一致。
- **提交闸门/事务**：`runCommit` + 隔离草稿 + `inflightAlarmActions` + `recentAlarmActions` + 事件台账的设计是本项目最扎实的部分，未见竞态漏洞。
- **vivo 冻结问题**：属已知待裁决项，未作为新缺陷重复报告。

---

## 六、建议修复顺序

1. **H-01 / H-02 / H-03 + M-01 / M-02 / M-03**（解析层，一次性专项修复 + 建解析回归基线）
2. **H-05 / H-06**（排程对称性，直接影响"不错过"承诺）
3. **H-04**（一行修改，消除低端机崩溃）
4. **H-07**（降级写入一致性）
5. **M-09 / M-10 / M-20**（事务边界、重复实现、验收断言补齐）

**未执行 / 待验证**：Gradle 编译、APK 安装、真机投递、Doze、重启恢复、覆盖升级——与 `docs/acceptance-cases.md` 声明一致，仍为 `NOT_PERFORMED`。
