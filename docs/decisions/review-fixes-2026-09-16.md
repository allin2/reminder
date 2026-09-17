# 审查修复轮决策（2026-09-16）

范围：落实 `docs/reviews/business-logic-2026-09-16.md`（L01–L08）与
`docs/reviews/android-prepackage-2026-09-16.md`（R1–R8）。

其中两条规则**审查报告明确要求先收敛再实施**，不能由实现层自己选一边。本文档记录裁决结果与依据。
编号承接 `interaction-logic-2026-09-16.md` 的 D1–D25。

---

## D26 · Review 补提醒：勿扰是硬约束，「三次」是上限而不是必须发满

| # | 决议 | 依据 |
|---|---|---|
| **D26** | Review 补提醒**逐档参与勿扰**（此前只有锚点顺延，补提醒直接加间隔，会穿透勿扰）。<br>某一档若**因勿扰顺延后已越过本次窗口结束时间**，则**当日不再单独补发**，留给下一个 Review Window。<br>即：默认参数下（窗口 21:30–23:00、间隔 60 分钟、最多 2 次补提醒，勿扰 23:00–07:30）当天实际发 **2 次**（21:30 / 22:30），第三档顺延到次日 07:30 已越窗 → 不单独发。 | V0.2 §9.3「Review Reminder 必须受勿扰/睡眠规则约束」与「达到上限后**滚入下一个 Review Window**」两条同时成立；D18 也要求待整理按普通事项参与勿扰。<br>不能在「勿扰」与「发满三次」之间二选一 —— 穿透勿扰会让勿扰设置失信，而为保证第三次去推迟勿扰等于擅自改已定参数。取「上限」语义后两条规定都满足。<br>**D22 的参数（60 分钟 × 2 次）保持不变**，因此 D22 原文「正好铺满 21:30–23:00」这句算术在默认勿扰下不成立 —— 这是报告的 L07/待裁决项，本次按本条裁决，不调参数。 |

**实现位置**：`lib/native-reminders.js` → `buildReviewSlots()`。
**验收**：`test-native-reminders.js` 的「L07 补提醒不穿透勿扰」「L07 次数是上限而非必须发满」。

> 附带修正（同一处）：`buildReviewSlots` 同时修掉 R4 —— 窗口起点一过就把整场槽位挪到明天，
> 会撤销当晚尚未到时的补提醒。现在按「稳定会话日期」生成完整槽位后再过滤已过去的，
> 且槽位身份使用会话内编号而不是过滤后的数组下标（前面槽位过去不会让后面的换身份 → 被对账撤销重排）。

---

## D27 · 恢复归档：默认暂停截止保护，但必须显式可见且可一键恢复

| # | 决议 | 依据 |
|---|---|---|
| **D27** | 归档事项重新打开（D23）时**同时暂停该条的截止保护**（新增 `item.deadlinePaused`），<br>并在卡片与详情页**明确展示**「截止保护已暂停」，提供**独立的「恢复截止保护」动作**。<br>用户显式恢复后，从当前所处阶段重新按正常策略提醒。 | D23 / V0.2 §19 AC-18 禁止的是「**自动**产生提醒」。截止保护同样是自动提醒，原实现会在恢复后由原生投影补一条「两秒后」的截止提醒 —— 与「已恢复 · 不会自动提醒」这句承诺直接冲突。<br>但 INV-05 要求截止保护不被普通状态静默覆盖，所以不能默默把 `deadlineAt` 清掉。<br>取「暂停 + 显式展示 + 一键恢复」：承诺兑现、风险不隐藏、回路由用户掌握。 |

**实现位置**：`app-core.js` → `restoreItem()` / `resumeDeadlineProtection()` / `renderItemCard()` / `openDetail()`；
`lib/native-reminders.js` → `buildDesired()`（跳过 `deadlinePaused`）；`app-core.js` → `promoteDue()`。
**验收**：`test-smoke.js` 的「D23 重开默认暂停截止保护」「D23 暂停期间不因截止被拉回 due」「D23 显式恢复后保护重新生效」。

---

## 本轮同时收敛的其他实现规则（不需要裁决，仅记录）

1. **待整理抑制条件收窄为「只有兜底时间」**（L01 / R5）
   `suppressed = Review 开启 && item.isFallbackTrigger`。
   不再按 `review_status === NEEDS_REVIEW` 整体屏蔽 ——
   用户手选或解析出的真实时间继续生效（Review 只管内容质量）；Review 关闭后一律按普通事项排程
   （V0.2 §9.2「关闭后已有 Trigger 仍正常工作」）。截止保护永远不被待整理阻断（INV-05、V0.2 line 395）。

2. **截止保护分两阶段**：`p24`（截止前 24 小时）与 `p2`（截止前 2 小时，含逾期 24 小时内）。
   身份 = `阶段@截止时间`，消费后不再重复唤醒；改截止时间即换身份。原生投影同样按此身份排程，
   于是「反复对账生成新提醒」「ACK 后立刻变回 due」同时消失。

3. **时间来源优先级固定**：用户明确选择 > 有效解析 > 兜底。
   低置信度解析出的时间**不算**有效解析（因此仍走兜底）；用户动过时间输入框才算「明确选择」。

4. **通知事件携带数据版本**（`item.rev`）。版本对不上时拒绝执行 ack / snooze / done，
   避免「编辑时间后点旧通知」覆盖新状态；`tap` 仅打开详情，放行。

5. **终态保护**：已完成 / 已归档事项不接受 ack / snooze / done；同一事件 5 秒内重复投递只生效一次。

6. **周期语义分开**：`calendar` 锚定原定日期（由完成推进），`ack` 锚定 ACK 时刻（由确认推进）；
   月份推进一律从目标月份首日定位（`setMonth` 在 29/30/31 日会溢出）。另补「停止重复」二级操作。

7. **稍后开启新一轮**：重置 `remindCount` / `lastRemindAt` / `lastAlertShownAt`，
   使前台与原生投影（`attempt` 从 0 重排）使用同一份轮次状态。

8. **全屏闹钟动作改用 FIFO 队列**（替代单槽位 `lastAction`/`lastItemId`），
   避免连续写入互相覆盖；`AlarmActivity` 的四个出口都会撤销已投递的通知（R8）。
   > **2026-09-16 第二轮修正（V09）**：最初实现仍是「读取即删除」，只能解决**写入覆盖**，
   > 不能解决「已取出、JS 尚未落库就崩溃」。现改为**读取不删 + 事件 id + JS 处理成功后
   > `ackAlarmAction` 确认删除**，并且一次排空积压（最多 20 条）而不是每次只取一条。

---

---

## 第二轮（复核报告 V01–V09，2026-09-16 同日）

`docs/reviews/repair-verification-2026-09-16.md` 指出第一轮遗留 9 项，本轮全部处理：

| 编号 | 根因 | 处理 |
|---|---|---|
| **V01** | `onCreate` 抽出 `bindIntent()` 后忘了调用起响，只有 `onNewIntent` 会响 | `onCreate` 末尾补 `restartAlarmEffects()` |
| **V02** | `itemRev` 一路写 String、在 Activity 用 `getIntExtra` 读 → 恒为 0；`persistAlarm` / 开机恢复 / 稍后重排都没带版本 | 全链路统一 String；`AlarmScheduler.schedule` 与 `persistAlarm` 增加 rev 重载；另外 JS 侧把「版本缺失/0」视为**未知**（不拒绝），避免整条链路丢版本时所有通知按钮集体失效 |
| **V03** | 只排 deadline-24h 一个点，且没有原生送达消费记录 | `deadlineStagePoints()` 按阶段（p24 / p2）各自预排；新增 `deadlineNotifiedKey/At`，`reconcile` 回传 `deadlineEvents` 由 app-core 落库；已排且投递时刻已过 → 视为送达，不再重排 |
| **V04** | ACK 周期就地改 `triggerAt`，把「本次实例」和「下一期」混成一条；月末按时间戳比较导致原地打转 | ACK 改为 `spawnNextInstance()` 新建实例；monthEnd / nthWeekday 改为按「日」比较；`stopRepeat` 按 V0.2 §417 **终止规则并归档** |
| **V05** | editing 分支没有 `bumpRev`；scheduleKey 不含版本 | 编辑保存 `bumpRev` + 改期重置轮次；scheduleKey 纳入 `rev` |
| **V06** | 前台（`promoteDue` 直接 return）、首页（只看 `isDue`）、原生（看 `NEEDS_REVIEW`）三套兜底判定 | 抑制只作用于普通提醒、不阻断截止保护；新增 `isAttentionDue()` 供首页与语义统一；原生判定去掉 `review_status` |
| **V07** | `buildReviewDesired` 完全不读 `skippedUntil` | 跳过期内直接返回空数组，对账随即撤销当晚排程 |
| **V08** | `errors` 只进字段，`reliability` 仍来自权限 | 出现 `schedule:` 失败即置 `reliability = "error"`（界面原本就有「异常」分支） |
| **V09** | 队列取出即删，不具备崩溃恢复 | 见上表第 8 条的修正 |

**测试基线**：unit 29 / native 98 / smoke 137（共 264）。

## 仍未在本轮完成

- Gradle 编译、APK 安装、锁屏/休眠/进程回收/重启与真机交互：本机无 JDK 17 / Android SDK / 模拟器，**NOT_PERFORMED**。
  Java 改动只做了 `javac` 语法级检查（无语法错误；其余错误均为缺 Android/Capacitor 依赖）。
- R2 的多闹钟界面保留策略虽已显式化（展示最新到达的一条，A 仍可在首页处理），但**未在真机验证**。
- `docs/scenarios.html` 的 K / L 两组展示提案仍待确认，其决策编号顺延为 **D28 / D29**（原预计 D26 / D27 已由本文档占用）。
