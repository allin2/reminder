---
doc: code-review-recheck
date: 2026-09-18
round: 2
base: docs/reviews/code-review-2026-09-18.md（第 1 轮）
scope: 复核第 1 轮结论 + 审查第 1 轮之后的工作树改动
method: git diff 比对 + 源码复核 + 解析/周期实测 + 测试套件复跑 + vivo V2238A 真机受控投递
tests: 初次复核 unit 105 / native 194 / smoke 175 / regressions 574 = 1048；解析层修复后 unit 132（1075）；本批 native 201（1082）→ 203，合计 1084，全部通过
verdict: FAIL（未开口高危 2 项 = H-07 + H-08【真机新发现：无通知权限时息屏闹钟完全静默】。高 5 项已修：H-01/H-02/H-03/H-04/N-01；H-05 撤回为误报；H-06 降为中危。本批另修 N-02 / N-03 / N-08 与构建脚本「无代理必失败」缺陷；D45-a 由用户裁决为「遮挡期间继续响」，真机验证 PASS。详见「更正」、§六 与 `docs/reviews/vivo-d45a-device-verification-2026-09-18.md`）
---

# 第 2 轮代码审查 · 复核报告

> 第 1 轮报告落盘后，工作树发生了改动（`app-core.js` +90、`AlarmActivity.java` +38、`SystemBridgePlugin.java` +22、
> `native-reminders.js` ±1、新增 `ActiveAlarmStore.java` / `AlarmStopReceiver.java`、测试 +35）。
> 本轮做三件事：① 复核第 1 轮结论是否仍成立（行号是否漂移）；② 确认哪些已修；③ 审查改动本身是否引入新缺陷。

---

## ⚠️ 更正（2026-09-18 下午，第 1 轮与第 2 轮共有）

取证来源：`scripts/verification/deadline-quiet-probe.js`；裁决见 `docs/decisions/review-round12-fixes-2026-09-18.md` D42。

**H-05 撤回 —— 是误报，不是缺陷。** 本报告曾判定「截止块不校验 status → acknowledged 仍弹截止提醒」。
实际核对后：项目权威门槛是 `app-core.js:1551` 的 `deadlineAt && !deadlinePaused && !isTerminal`，
而 `isTerminal = archived || completed`（`:984`）——**本来就不含 `acknowledged`**；
`lib/reminder.js:76` 明确写着 *「截止保护独立于 ACK / 完成状态（INV-05）：只要未完成且临近截止就该唤醒」*。
投影与权威**逐字相同**，且两侧都委派 `Lib.deadlineStage*`，不存在两侧不一致。
原判定把「重复提醒的 `active` 准入」与「截止保护的准入」混为一谈 —— `active` 只控**重复提醒**（ACK 后不再追加），
截止保护按设计**继续**。实测（同一事项同一时刻）：

```
status=waiting      → 截止 2 条 + 事项 1 条
status=acknowledged → 截止 2 条 + 事项 0 条     ← 设计如此
status=completed    → 0 条
status=archived     → 0 条
```

**H-06 更正 —— 机制成立，但范围与严重度都要改。** 原文「勿扰区事项永久丢弃……既不提醒也不进首页」有两处不准：

1. 丢失范围**比「勿扰区延后」更宽**：`triggerAt=02:00`、对账 `09:00`，**即使不开勿扰**同样 0 条排程。
   准确说法是**投影只排「严格未来」的触发点，任何触发点已过的活跃事项都拿不到原生通知**；
   勿扰延后只是其中最反直觉的一条路径（应用自己把点挪到 07:30，然后又没送到）。
2. **「也不进首页」是错的**：权威会在 `app-core.js:1534-1540` 把它提升为 `due`，首页「待确认」里看得到。
   真实后果是**少一条通知**，不是事项丢失 → **严重度由高降为中**。
   修复需要「单次提醒是否已消费」的台账（照搬截止块的 `at = now + 2000` 会导致每次对账都补投一次），
   属需裁决项，见 D43。

---

## 一、复核总览

> **本表状态已更新至第十三轮（2026-09-18 晚间）**：H-01/02/03 由 D41 修复，H-06 由 D46 修复，
> H-07 由 D47 修复，H-08 由 D48 只落「归因」部分。裁定全文见
> `docs/decisions/review-round12-fixes-2026-09-18.md`。

| 项 | 第 1 轮 | 本轮复核 | 当前状态 | 说明 |
|---|---|---|---|---|
| H-01 「下周X」偏移一周 | 高 | 仍在 | ✅ **已修（D41）** | 「下周三」09-30 → **09-23**（`parse-probe.js` 可复现） |
| H-02 「每月N号」落 +30 天兜底 | 高 | 仍在 | ✅ **已修（D41）** | 「每月15号」10-18 → **10-15**，次期不再漂移 |
| H-03 「下个月N号」丢日期 | 高 | 仍在 | ✅ **已修（D41）** | 「下个月5号」10-01 → **10-05** |
| H-04 API22/23 崩溃 | 高 | ✅ 已修 | ✅ 已修 | `AlarmActivity` 改用 `NotificationManagerCompat` |
| H-05 截止块不校验 status | 高 | ❌ 撤回（误报） | ❌ 撤回 | 权威门槛本就是 `!isTerminal`，投影与权威逐字相同 |
| H-06 触发点已过的事项拿不到通知 | 高→中 | 仍在 | ✅ **已修（D46）** | 新增单次提醒台账 `reminderEvents`（schema 4→5），补投窗口 24h、每轮最多一条 |
| H-07 IDB 降级写入丢失 | 高 | 仍在 | ✅ **已修（D47）** | 待回放快照 + `authoritativeBackendMissing()`；**原报告漏了「IDB 打不开」这条更常见的路径** |
| H-08 无通知权限 + 息屏 = 完全静默 | — | 真机新发现 | ⚠️ **仅归因（D48）** | 台账记录投递时通知可用性 + 自检直说「全屏没有载体」；**闹钟依旧不响**，A/B/C 待裁决 |
| M-01～M-21 | 中 | 仍在（未逐一复验） | 部分已修 | M-01/M-03 已随 D41 修复（标题残留、`X 前` 截止）；M-18 见 N-05 |
| 改动引入的新问题 | — | 新增 高 1 / 中 3 / 低 1 | 4/5 已修 | N-01/N-05（14:15）、N-02/N-03（D45）、N-08（D44）；N-06 未处理 |

**测试基线变化**：1048 → 1075（D41） → 1084（D44/D45） → **1124**（本轮：native 225 / smoke 193），
全部通过。本轮的每条修复都配了「能复现该缺陷」的断言 + 反向验证（回退即红）。

---

## 二、已修复（1 项）

### ✅ H-04 API 22/23 全屏闹钟崩溃 — 已修
- **位置**：`android/app/src/main/java/space/alliswell/inbox/AlarmActivity.java:327`
- **改动**：`nm.areNotificationsEnabled()` → `androidx.core.app.NotificationManagerCompat.from(this).areNotificationsEnabled()`
- **评价**：修复正确。`NotificationManagerCompat` 内部对 API 24 以下走反射兼容，不再抛 `NoSuchMethodError`。
- **遗留**：该文件 `import android.app.NotificationManager;` 仍保留（:4），`nm` 变量现在只用于判空，可清理（低危，无害）。

---

## 三、本轮改动引入的新缺陷

### N-01【高】`ActiveAlarmStore` 只增不减，无 TTL、无上限、无启动清理 — ✅ **已修复（2026-09-18 14:15）**
- **位置**：`android/app/src/main/java/space/alliswell/inbox/ActiveAlarmStore.java:24-36`（写入）、`:51-65`（移除）
- **写入点**：仅 `AlarmTestReceiver.java:113`（每次投递一条）
- **移除点**：仅 3 处 —— `AlarmActivity.java:381`（全屏四出口）、`AlarmStopReceiver.java:13`（通知「停止声振」/滑动删除）、`SystemBridgePlugin.java:547`（Web 面板主动停止）
- **具体表现**：
  1. 闹钟响后**用户既不点通知也不打开 App**（最常见的真实场景）→ 该条记录**永久驻留** SharedPreferences，跨重启保留。
  2. 驻留期间，对账路径 `native-reminders.js:529` 的 `cancelNotification({id, preserveActive:true})` 命中 `ActiveAlarmStore.cancelNotification:45` 的 `preserveActive && contains(...) → return true`，**通知不会被撤销**。该通知带 `FLAG_INSISTENT`（`AlarmTestReceiver.java:226`），会持续循环响铃。
  3. `list()`（`:12-15`）每次调用都全量解析 JSON，`stop()`/`record()` 用 **`commit()` 同步写盘**。对账对每个 id 调用一次 → 记录数 n 时单轮对账产生 **O(n²) 次同步磁盘写**。
- **触发条件**：任何一次「响铃后用户未通过通知/全屏界面/App 面板处理」的投递。
- **业务影响**：**幽灵通知残留 + 持续响铃**；长期运行下 store 膨胀，对账期间同步写盘可能造成 WebView 线程卡顿。
- **修复方向**：为 store 增加 TTL（如投递后 30 分钟或事项窗口结束后自动过期）、条数上限，并在应用启动/对账开始时清理过期项；`preserveActive` 只在 TTL 内生效。

- **实际修复（最小改动，3 处，同一根因链）**：
  1. `ActiveAlarmStore.java`：新增 `MAX_AGE_MS = 6 小时`；`list()` 改为经 `prune()` 返回，自动丢弃过期投递并写回
     （`receivedAt` 缺失时按活跃保留，宁可多留也不误删正在响的）。过期项不再被 `contains()` 命中 →
     对账的 `preserveActive` 不再钉住通知。
  2. `ActiveAlarmStore.stop()`：**台账查不到也要撤通知**。原实现 `if (!contains(...)) return false;`
     把「从台账移除」和「取消通知」耦合，导致残留通知点了停止/关闭也停不掉（FLAG_INSISTENT 持续响）。
     现改为：仅当「有记录但 token 不匹配」（存在更新的投递）时才让路，其余一律 `nm.cancel(id)`，
     并按是否命中台账分别记 `deliveryStopped` / `leftoverCancelled`。
  3. `ActiveAlarmStore.drop()`（新增）+ `AlarmActivity.onNewIntent`：切换到新投递前，若 id 不同则撤掉上一条的通知。
     `drop()` 与 `stop()` 的区别是不回调 `AlarmActivity.stopDelivery()` —— onNewIntent 的语义是「换成 B 继续展示」，
     不能连自己一起 finish。

- **验证**：`bash scripts/android-build.sh debug` → `BUILD SUCCESSFUL in 5s`（134 tasks，24 executed），
  产物 `releases/安心收件箱-debug.apk`（3.8M，14:15）。真机复验脚本见文末「验证步骤」。

### N-02【中】通知被禁用时，界面一旦被遮挡就永久静音 — ✅ **已修复（2026-09-18；D45-a 定为「遮挡期间继续响」）**
- **位置**：`AlarmActivity.java` `onStop`（无条件 `stopAlarmEffects()`）与 `onResume`（只重启时钟，不重启声振）
- **链路**：通知权限关闭时 `notificationOwnsSound()` 返回 false → `restartAlarmEffects()` 由界面自播声音+振动（唯一声音来源）。此时用户按 Home、下拉通知栏、来电 → `onStop` → 声音停止；回到界面 `onResume` **不重启声振**。
- **触发条件**：用户关闭应用通知 + 闹钟界面被任何方式遮挡。
- **业务影响**：**闹钟哑掉**，界面却仍显示，用户以为已处理。
- **实际修复（D45-a / D45-b），含一次方案改判**：
  1. **产品裁决（2026-09-18，用户决定）**：**推翻** `onStop` 的「隐藏即静音」，改为**遮挡期间继续响** ——
     `onStop` 不再调 `stopAlarmEffects()`（仅保留 `clockTicker` 的移除）。理由：走到界面发声这一步，
     前提恰恰是通知发不出去（`notificationOwnsSound()==false`），此时通知栏里**根本没有**那条带停止
     按钮的常驻通知，停声不会「给用户一个安静的选项」，只会让整个闹钟消失。
  2. `onResume` 的 `restartAlarmEffects()` **保留**为幂等兜底 —— 两种方案下都成立，故换向只需改 1 行。
  3. **前提修复**：`startAlarmSound()` 必须幂等。改判后这条更吃紧：既然 `onStop` 不再停声，
     `onResume` 这次调用就**必然**遇到「已在播」；不修它，每次切回界面都会叠一路铃声。
  4. **保留的两道边界**：`onDestroy` 仍调 `stopAlarmEffects()`（响铃不越过界面自身的销毁）+
     `ActiveAlarmStore.MAX_AGE_MS` 给台账设上限。
- **已接受的代价**：静音入口只剩「回到界面点关闭」；遮挡期间振动也继续（`repeat=0` 无限循环）。
- **回退成本**：把 `stopAlarmEffects()` 加回 `onStop` 即可（1 行），`onResume` 无需改动。
- **验证**：2 条源码级断言（剥注释后匹配）+ **字节码级确证**（`javap -c`：`onStop` 中
  `stopAlarmEffects` 出现 0 次、`onDestroy` 中 1 次）；反向验证双向通过。
- **待真机确认（怀疑项，未纳入断言）**：后台（无前台服务）持续播 `USAGE_ALARM`
  是否会被某些 ROM 的省电策略掐断。

### N-03【中】活跃闹钟面板：2 秒轮询无清理，且自动停止逻辑冷启动失效 — ✅ **已修复（2026-09-18，见 D45）**
- **位置**：`app-core.js` 的 `bindNetwork()` 轮询、`applyParsedState()` 的 `committedAlarmItems` 初值
- **具体表现**：
  1. 每 2 秒跨桥调用 `activeAlarmDeliveries()`（原生侧解析整个 JSON）并比对 signature，无注销路径。
  2. `committedAlarmItems` **只在 `writeSnapshot` 里更新**。冷启动后若用户未做任何保存操作，它恒为 `[]` →
     `deliveryHandledByCommittedItem` 对任何 alarm 返回 `false` → **已完成/已归档事项的闹钟不会被自动停止**。
- **业务影响**：冷启动场景下残留响铃需人工干预（第 2 点）；跨桥开销（第 1 点，实测**非现网泄漏**，见下）。
- **实际修复（D45-c / D45-d）**：
  1. 轮询句柄 `activeAlarmPollTimer` 留痕，重绑前先 `clearInterval`。**如实标注**：`bindNetwork` 目前只在
     `init()` 调一次，页面级刷新会自然回收，故这条属**防御性修复**，不是现网泄漏。
  2. `applyParsedState` 末尾重建基线：`committedAlarmItems = JSON.parse(JSON.stringify(state.items))`。
     用**深拷贝**与 `writeSnapshot`（`JSON.parse(json)`）口径一致 —— 该变量的语义是「最后一次**已提交**的快照」，
     `slice()` 的元素共享引用会让后续原地改动渗进「已提交」语义里。
- **未做**：`activeAlarmRefreshBusy` 为真时跳过 `reveal` 滚动定位的问题**保持不动**（属体验细节，
  且改动会引入「滚动被跳过」与「重复滚动」之间的新取舍，不在本次范围）。

### N-04【中】周期/时间表达式残留字符污染标题（范围比第 1 轮 M-01 更广）
- **位置**：`lib/parse-cn.js`（`cleaned` 剥离不彻底）
- **实测**（基准 2026-09-18 周五 14:00，`scripts/verification/parse-probe.js`）：
  | 输入 | 触发时间 | 标题 |
  |---|---|---|
  | `每周一早上9点站会` | 2026/9/21 09:00 ✅ | **「一站会」**（应为「站会」） |
  | `下下周一开会` | 2026/9/28 ✅ | **「下开会」**（应为「开会」） |
  | `明天上午9点前提交` | 2026/9/19 09:00 | **「前提交」**，且**截止未生成** |
  | `12月31日之前提交年报` | 2026/12/31 | **「之前提交年报」**，且**截止未生成** |
  | `明天上午10点半面试` | **10:00**（应为 10:30） | **「半面试」** |
- **业务影响**：首页与通知标题直接显示这些残句，不可读；「X 前/之前」的截止语义同时丢失（与 M-03 同源）。
- **修复方向**：把「数量词+周期单位」「X前/之前」「半」等统一进剥离词表，并让「前/之前」同时产出 `deadline`。

### N-05【低】`onNewIntent` 替换投递时未撤销上一条常驻通知（第 1 轮 M-18）— ✅ **已修复（2026-09-18 14:15，与 N-01 同一处改动）**
- **位置**：原 `AlarmActivity.java:137`（仅 `stopAlarmEffects()`，无 `cancelPostedNotification()`）
- **表现**：A 在响时 B 到达，A 的通知（带 `FLAG_INSISTENT`）仍在通知栏持续响。
- **业务影响**：两条闹钟同时响铃。
- **实际修复**：`onNewIntent` 中在切换前判断 id 是否变化，变化则调 `ActiveAlarmStore.drop(this, currentAlarmId)`
  （撤通知 + 出账，但**不**回调 `stopDelivery`，避免把正在展示 B 的界面一起 finish）。
  用 `drop()` 而非 `cancelPostedNotification()`（即 `stop()`）正是为了这个语义差别。
- **未覆盖的窄口**：若新旧投递 **id 相同、token 不同**，`currentAlarmId != intent.getIntExtra(...)` 为假，
  不触发 `drop()`。该情形下新投递会以同一 id `notify()`，系统按 id 覆盖旧通知，因此不产生双响 —— 已核对无影响。

### N-06【低】「每隔 N 周」未识别为周期
- **实测**：`每隔两周给爸妈打电话` → confidence **low**、无 `repeat` 字段、落到默认 7 天后。
- **修复方向**：补「每隔?\s*(两|二|\d+)\s*周」到周期规则。

---

## 四、第 1 轮结论复核明细（行号校验）

| 编号 | 第 1 轮引用 | 当前实际 | 是否漂移 |
|---|---|---|---|
| H-01 | `lib/parse-cn.js:251-262` | 文件未改，实测复现 | 否 |
| H-02 | `lib/parse-cn.js:169` + `:429-436` | 文件未改，实测复现 | 否 |
| H-03 | `lib/parse-cn.js:281-285` | 文件未改，实测复现 | 否 |
| H-05 | `lib/native-reminders.js:313` | ❌ **撤回**：`:313` `if (item.deadlineAt && !item.deadlinePaused)` 与权威 `app-core.js:1551` 的 `!isTerminal` 等价（`:269` 已排除终态） | — |
| H-06 | `:286` + `:184-191` | `:286` `if (at <= now) continue;`；`effectiveTriggerAt :184-191` | 否（降为中危） |
| H-07 | `app-core.js:798-811` + `:543-554` | `writeSnapshot :543-556`（降级分支 `:552-556`）；`storageReady=false` 在 `:809` | 否（区间内） |

**实测复现证据**（`node scripts/verification/parse-probe.js`）：
```
"提醒我下周三交房租"   → 2026/9/30 10:00   （应 2026/9/23）
"下周三下午3点开会"    → 2026/9/30 15:00   （应 2026/9/23 15:00）
"下个月5号交电费"     → 2026/10/1 10:00   （应 2026/10/5）
"每月15号提醒我"      → 2026/10/18 10:00  → repeat every:"month"（锚点永久漂移到 18 号）
```

---

## 五、本轮核对「无问题」的项

- **所有拉起 `AlarmActivity` 的路径都先 `record` 再启动**：`AlarmTestReceiver.java:113`（record）早于 `:151`（`startActivity`）与 `:212`（`setFullScreenIntent`），两者携带**同一个 trace**；`AlarmScheduler.java:154` 的 Activity 形态只出现在 `cancel()` 内（历史残留清理），不是投递路径。因此新增的 `restartAlarmEffects():304`「`contains` 为假即 `finish()`」**不会误杀正常投递**。
- **token 为 null 时安全**：`ActiveAlarmStore.contains:20` 中 `token == null` 匹配任意，不会因缺 token 导致 `finish()`。
- **新增面板无 XSS**：`app-core.js:5620-5624` 的 `innerHTML` 对 `item.title` / `alarm.title` 均经 `escapeHtml`。
- **新增代码引用的符号全部已定义**：`escapeHtml` / `hasKnownRev` / `isTerminal` / `systemBridge` / `alarmEventSeen` / `handleAlarmAction` / `committedAlarmItems` 各 1 处定义；`index.html:890` 存在 `activeAlarmPanel` 容器。
- **PendingIntent 仍全部 `FLAG_IMMUTABLE`**（`AlarmTestReceiver.java:184`、`AlarmScheduler.java:139`）。

---

## 六、更新后的结论与修复顺序

**结论：PASS_WITH_ACCEPTED_RISK（未开口高危 1 项：H-08 的机制性修复）。** 计数以 2026-09-18 晚间为准：

| 级别 | 未开口 | 已修 / 撤回 |
|---|---|---|
| **高** | **1**：**H-08**（无通知权限 + 息屏 = 完全静默）—— 本轮只落了归因（D48），**闹钟依旧不响** | 已修 7：H-01/02/03（D41）、H-04、N-01、H-06（**D46**）、H-07（**D47**）；撤回 1：H-05（误报） |
| 中 | 第 1 轮 21 − 本批已修项 | 本批已修：N-02 / N-03（D45）、N-04（D41）、N-08（D44）、M-01/M-03（D41） |
| 低 | 第 1 轮 13 + N-06 | 已修 N-05 |

修复顺序（已完成项划掉）：

1. ~~**H-01 / H-02 / H-03 + N-04**（解析层专项 + 双副本一致性守护）~~ ✅ 已完成（D41）
2. ~~**N-01**（`ActiveAlarmStore` 加 TTL / `stop()` 解耦 / 切换投递撤旧通知）~~ ✅ 已完成
3. ~~**N-05**（`onNewIntent` 替换投递未撤旧通知）~~ ✅ 已完成
4. ~~**N-08**（截止补投在同一毫秒补两条通知）~~ ✅ 已完成（D44）
5. ~~**N-02 / N-03**（声振生命周期、面板轮询与冷启动状态）~~ ✅ 已完成（D45）
6. ~~**H-06**（触发点已过的活跃事项拿不到原生通知）~~ ✅ 已完成（**D46**）——
   用户裁定「补投 + 新增单次提醒台账」；台账与 `deadlineEvents` 同构，schema 4 → 5
7. ~~**H-07**（IDB 降级写入一致性）~~ ✅ 已完成（**D47**）——用户裁定「待回放快照」。
   本轮同时**修正了本报告的范围错误**：真机更常见的是「IDB **打不开** → 后端整体降级」，
   那条路径 `storageReady` 仍为 true，本报告原先只写了「读失败」那条
8. 剩余 **M-09 / M-10 / M-20 / N-06**（事务边界、重复实现、验收断言补齐）
9. **H-08** —— 本轮只落可观测性（D48）。真正的修复候选 A（强引导授权）/ B（换投递机制）
   / C（界面提示）**仍待裁决**，见实机报告 §七

**未执行 / 待验证**：Doze、重启恢复、覆盖升级 —— 仍为 `NOT_PERFORMED`。
H-06 的补投窗口（24h，复用 `DEADLINE_GRACE_MS`）与 H-08 的机制性修复都需要真机轮次确认；
本轮**未重打包 APK**，也未做真机复验。
**真机验证（既有，2026-09-18）**：vivo V2238A / Android 16，7 轮受控投递，
D45-a / D45-b / N-01 ✅ PASS；见 `docs/reviews/vivo-d45a-device-verification-2026-09-18.md`。
**本轮编译已通过**：`:app:compileDebugJavaWithJavac` EXIT=0，`javap -p -c` 字节码确证
`notificationsUsable(Context)` 与 `KEY_DELIVERY_NOTIFY_ON` 已进 class；
`npm run sync:www` 后 `www/app-core.js`、`www/lib/native-reminders.js` 与源码 `cmp` 一致。
**测试基线已升至 1124**（unit 132 / native **225** / smoke **193** / regressions 574），全绿；
本轮新增 40 条断言，**D43 / D47 / H-08 三处全部通过反向验证**（回退即红、恢复即绿）。

---

## 七、N-01 修复的验证步骤

### 1) 构建（已执行，通过）
```bash
bash scripts/android-build.sh debug
# 期望：BUILD SUCCESSFUL；产物 releases/安心收件箱-debug.apk
```

### 2) 安装到真机
```bash
"$HOME/Library/Android/sdk/platform-tools/adb" install -r "releases/安心收件箱-debug.apk"
# vivo 锁屏态会被拒（INSTALL_FAILED_ABORTED），需先解锁：
#   adb shell wm dismiss-keyguard
# 再用 input tap 点「已了解风险」+「继续安装」（坐标 540,2100 / 540,2247）
```

### 3) 复现与观察（OPPO PKC130 / ColorOS，或 vivo V2238A）
```bash
# 用既有脚本跑「孤立提醒 / 通知按钮」两条停止入口
/usr/bin/python3 scripts/verification/oppo-hidden-alarm.py --fixed
/usr/bin/python3 scripts/verification/oppo-hidden-alarm.py --fixed --notification

# 停止后应观察到：
adb shell dumpsys notification --noredact | grep -A5 space.alliswell   # 该 id 的通知已消失
adb shell dumpsys vibrator                                              # CurrentVibration 为 null
adb shell run-as space.alliswell.inbox cat \
  /data/data/space.alliswell.inbox/shared_prefs/alarm_trace.xml
# trace 中应出现 deliveryStopped（命中台账）或 leftoverCancelled（台账无记录，仍撤通知）
```

### 4) TTL 生效验证
```bash
adb shell run-as space.alliswell.inbox cat \
  /data/data/space.alliswell.inbox/shared_prefs/active_alarm_deliveries.xml
# 投递后记录存在；6 小时后再读应为空（prune 写回）。
# 不想等 6 小时：把 MAX_AGE_MS 临时改成 60_000 重编一个诊断包验证，验完改回。
```

### 5) 重叠闹钟验证（drop 分支）
相邻设置两条不同 id 的闹钟，第二条到达时：
- 旧 id 的通知应消失（`dumpsys notification` 中只剩新 id）；
- trace 中 `replaced` 之后不应再出现旧 id 的持续响铃记录；
- 界面切到新投递且未被 finish（`wm_dump` 中 AlarmActivity 仍在）。

### 6) 残留风险与待裁决项（需你决定，不由我单方面定）

1. **TTL 取值 6 小时是我给的默认值，属于业务/体验判断，需要你确认。**
   取值权衡：太短会误伤「闹钟响了但用户几小时后才看到通知」的正常场景（记录被清 → `preserveActive` 失效 →
   通知被对账撤掉）；太长则幽灵响铃的**上限**更高。当前 6h 是「宁可多保留」的保守侧。
   若要更激进（如 1h / 30min），改 `ActiveAlarmStore.MAX_AGE_MS` 一处即可。
2. **TTL 只是给幽灵响铃设了上限，不等于消除它。** 真正的静音动作发生在**下一次对账**，
   而对账需要应用进程被拉起 —— 在会冻结进程的 ROM（见 `docs/reviews/android-vivo-freezer-rootcause-20260917.md`）
   上，对账可能根本不运行，此时通知会一直响到系统回收或用户手动处理。
   要彻底消除，需要让投递「自我限时」（例如到达时用 `AlarmManager` 排一个 N 分钟后的自动停止闹钟），
   这属于**新增机制**，超出本次最小改动范围，需要你批准后再做。
3. **`prune()` 在 `list()` 内可能触发一次同步写盘**（仅在确有丢弃时）。`list()` 会被 `contains()` 调用，
   而 `contains()` 在 UI 相关路径上被调用，因此这是第 1 轮 N-01-3 提到的「主线程同步写」问题**范围略有扩大**，
   但已用 `if (dropped)` 条件写限制在「确实过期」时，正常路径无额外写入。

### 判定口径
声振停止是**软件证据**（dumpsys / trace），不是声学测量；`effectsStopped` 也不能单独推断扬声器已停。
未跑完上述 3–5 之前，N-01 的修复状态为「已构建、未真机复验」。
