# single-source.md —— 重复规则逐项关闭证明

来源基线：`app-core.js` @ HEAD `3574824357dc7beb04cbd3e32aa413cd508e8484`，
SHA-256 `c959eec75a60d68ca279e89707eefccf0fce5b6ddb852ad9f16e7197b530cf06`，8,559 行 / 387,384 字节。

本文件是 P1「规则收敛」的工作清单与关闭证明。**每关闭一项，把「状态」改成 CLOSED 并附上判据命令。**

## 1. 重复规则表（P0 冻结）

| # | 规则 | 当前重复点 | 语义是否一致 | 唯一来源（目标） | 状态 |
| --- | --- | --- | --- | --- | --- |
| D-01 | 中文数字 `cnInt` | core L344–352；`lib/parse-cn.js` L94–115 | **不一致** —— core 只认 `三十/二十/十` 前缀，lib 还认「二零二三」式逐位与 `百/千` 段位单位 | `lib/parse-cn.js` | OPEN |
| D-02 | 中文时间解析 `parseChineseTime` | core L354–591（整份副本，无 `normalizeTimeText`/`extractDuration`）；`lib/parse-cn.js` L153–419 | **不一致** —— core 副本缺全角数字归一与时长复合表达 | `lib/parse-cn.js` | OPEN |
| D-03 | `hasSpecificTimeWord` | core L1311–1314 兜底正则 `/明天\|后天\|下周\|下周\|月底\|今晚/`；`lib/parse-cn.js` L422–428 | **不一致** —— 兜底正则漏「今天/周末/下个月/每月N号/N天后」等，且 `下周` 重复书写 | `lib/parse-cn.js` | OPEN |
| D-04 | `nextRepeatTrigger` | core L1948–1991；`lib/repeat.js` L65–114 | 一致（core 为逐字副本） | `lib/repeat.js` | OPEN |
| D-05 | `repeatLabel` | core L261–270；`lib/repeat.js` L116–125 | 一致 | `lib/repeat.js` | OPEN |
| D-06 | `nextRepeatPreview` | core L272–283；`lib/repeat.js` L127–138 | 一致 | `lib/repeat.js` | OPEN |
| D-07 | `applyClock` | core L188–195；`lib/repeat.js` L12–19 | 一致 | `lib/date-utils.js` | OPEN |
| D-08 | `lastDayOfMonth` | core L197–199；`lib/repeat.js` L20–22；`lib/parse-cn.js` L24–26 | 一致（三份） | `lib/date-utils.js` | OPEN |
| D-09 | `nthWeekdayInMonth` | core L202–214；`lib/repeat.js` L23–35；`lib/parse-cn.js` L27–39 | 一致（三份） | `lib/date-utils.js` | OPEN |
| D-10 | `nthWeekdayOfNextMonth` | core L216–231；`lib/parse-cn.js` L40–53；`lib/repeat.js` L36–51 | **不一致，且必须保持不一致** —— parse-cn 按**具体时刻**比较（`d.getTime() <= base.getTime()`），repeat 按**日**比较（防周期原地打转）。见 §2 | 共享原语 `date-utils`，两个显式命名消费者 | OPEN |
| D-11 | `weekdayOfNextWeek` / `dayOfMonthIn` / `nextDayOfMonth` | core L240–259；`lib/parse-cn.js` L62–86 | 一致 | `lib/date-utils.js` | OPEN |
| D-12 | `parseHHMM` / `inQuietHours` / `quietEnd` | core L1863–1895（`Lib.*` 优先 + 内联副本兜底）；`lib/native-reminders.js` L223–251；`lib/reminder.js` L11–42 | **不一致** —— native 的 `parseHHMM` 返回 `{hour, minute}`，lib/reminder 返回 `{h, m}`；core 兜底副本用 `Lib` 缺失时的另一套 | `lib/reminder.js`（形状差异走无算法适配器） | OPEN |
| D-13 | `deadlineStageKey` / `deadlineStagePoints` | `lib/native-reminders.js` L60–70（`deadlineStagePoints` 兜底**只排 p24，丢掉 p2**）；`lib/reminder.js` L110–113 / L95–102 | **不一致** —— 缺 `lib/reminder.js` 时 p2 阶段**永远不预排** | `lib/reminder.js` | OPEN |
| D-14 | `startOfDay` / `endOfDay` / `addDays` / `sameDay` / `nextWeekend` | core L53–57 / L92–100；`lib/parse-cn.js` L11–22；`lib/repeat.js` L11（`addDays`） | 一致（多份） | `lib/date-utils.js` | OPEN |
| D-15 | 运行时函数覆盖块 | core L2133–2137 `if (Lib.X) X = Lib.X;`（只覆盖 4 个符号，`cnInt`/`hasSpecificTimeWord`/`inQuietHours`/`quietEnd` **不在其中**，靠各自的 `if (Lib.X) return Lib.X(...)` 内联分流） | 装配期副作用 | 删除，改为显式依赖验证 | OPEN |
| D-16 | `Feedback` / `DeliveryEvidence` 缺失时的备用文案与空操作 | core L16/L18 `(Lib.Feedback \|\| null)`、`(Lib.DeliveryEvidence \|\| null)` 及散布的 `if (!EvidenceLib)` 分支 | 已加载的生产模块应视为**必需依赖** | 装配期硬校验 + 保留「设备没有可读证据」真实状态 | OPEN |

## 2. D-10：日期语义差异（禁止按同名合并）

两份 `nthWeekdayOfNextMonth` 的**唯一**差别在比较基准：

```
parse-cn.js L45   if (d.getTime() <= base.getTime())            // 具体时刻比较
repeat.js   L43   if (dayStartOf(d).getTime() <= dayStartOf(base).getTime())   // 按「日」比较
```

**为什么不能统一**：repeat.js 的注释（V04）写明必须按「日」比较，否则原期是 `1/31 09:00` 时，
`1/31 10:00 > 1/31 09:00` 被判为「仍是未来」，最后 `applyClock` 又换回 `09:00`，
返回与原期**完全相同**的时间 → 周期原地打转。

**收敛方案**：`lib/date-utils.js` 只提供**共同原语** `nthWeekdayInMonth(year, month, nth, dow)`
（两者逐字相同）。两个消费者显式命名并各自保留比较策略：

- `nthWeekdayOfNextMonthByInstant(from, nth, dow, hour, minute)` —— 首期候选（parse-cn 语义）
- `nthWeekdayOfNextMonthByDay(from, nth, dow, hour, minute)` —— 周期推进（repeat 语义）

`lib/parse-cn.js` 与 `lib/repeat.js` 各自导出原名 `nthWeekdayOfNextMonth` 指向自己那一支，
**不改变任何现有行为**；`app-core.js` 删除副本。

## 3. 兼容适配器（允许存在，但不得含算法）

| 适配器 | 位置 | 允许做的事 | 禁止做的事 |
| --- | --- | --- | --- |
| `native.parseHHMM` | `lib/native-reminders.js` | 调 `reminder.parseHHMM` 后把 `{h,m}` 映射成 `{hour,minute}` | 不得再含正则与解析逻辑 |
| `core.deadlineStageKeyOf` | `lib/app-model.js` | 转发 `reminder.deadlineStageKey` | 不得含阶段边界常量 |

## 4. 保留的降级（必须登记，不得删除）

| 降级 | 触发条件 | 唯一实现 | 失败反馈 | 覆盖用例 |
| --- | --- | --- | --- | --- |
| Web 无 Capacitor | `isNativeAndroidRuntime()` 为假 | `lib/native-reminders.js` 的 `isNativeAndroid` | 静默降级为 Web 通知/弹条 | `test-smoke.js` §10 |
| 无 IDB / IDB 打不开 | `storage.backend !== "idb"` | `lib/storage.js` | localStorage 权威 + 降级横幅 | `test-regressions.js` H2 / H-07 |
| 通知权限被拒 | `notifications === "denied"` | `lib/native-reminders.js` | 首页硬告知条 | `test-native-reminders.js` H-08 |
| 原生桥延迟/失败 | 插件未注入 / `initialize` 抛错 | `lib/native-reminders.js` + `app-platform` | 保留重试入口，不谎报已排 | `test-native-reminders.js` Q6 |
| 设备没有可读证据 | `getDeliveryEvidence` 缺失/抛错 | `lib/delivery-evidence.js` | 「读不到」而非「没送达」 | `test-regressions.js` UX-T03 |
| 浏览器分享 / Android SAF | 手势取消、写盘失败 | `lib/app-backup.js` | `isShareCancellation` 区分取消与失败 | `test-smoke.js` §12 |
| 无 `URL` 构造器 | 老 WebView | `lib/app-ui.js` 的 `safeExternalHref` | 保守拒绝 | `test-boot-combination.js` E |
