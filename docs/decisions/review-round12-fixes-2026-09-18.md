# 第十二轮复核修复决策（2026-09-18）

范围：落实 `docs/reviews/code-review-2026-09-18.md`（第 1 轮）与 `docs/reviews/code-review-2026-09-18-recheck.md`
（第 2 轮）中的**解析层**一批（H-01 / H-02 / H-03 / N-04），并更正两条误判（H-05 撤回、H-06 更正）。

编号承接 `interaction-logic-2026-09-16.md` 的 D1–D25、`review-fixes-2026-09-16.md` 的 D26–D27、
`review-round3-fixes-2026-09-17.md` 的 D30–D31、`review-round4-fixes-2026-09-17.md` 的 D32–D33、
`review-round5-fixes-2026-09-17.md` 的 D34、`review-round6-fixes-2026-09-17.md` 的 D35、
`review-round7-fixes-2026-09-17.md` 的 D36、`review-round8-fixes-2026-09-17.md` 的 D37、
`review-round9-fixes-2026-09-17.md` 的 D38、`review-round10-fixes-2026-09-17.md` 的 D39、
`review-round11-fixes-2026-09-17.md` 的 D40。

---

## D41 · 解析层：日历锚点算错 + 标题残留（H-01 / H-02 / H-03 / N-04）

| # | 决议 | 依据 |
|---|---|---|
| **D41-a** | 「下周X」「下下周X」统一为**下一个 / 下下个日历周（周一为首日）里的那个星期几**，合并原先语义相同却实现不一致的「下周日」与「下周X」两个分支。 | **H-01**：原「下周X」先算最近的那个星期 X 再无条件 `delta += 7`，「下周三」（基准周五）算成 **09-30**（应 09-23）；而「下周日」分支只加一次 7 天。**同一语义两套实现**，以本函数为准。 |
| **D41-b** | 「每月N号」的 N 必须留下，触发时刻取 **N 号的下一次出现**；该月没有这一天时收敛到月末。 | **H-02**：原实现只剥掉「每月」，号数被丢给 `absDate`（该正则要求「月」字，`每月15号` 不匹配）→ 落 `+30 天` 兜底 → **10-18**（应 10-15），此后每月锚在 18 号，**永久漂移**。 |
| **D41-c** | 「下个月N号」取**次月的 N 号**（无号数时才默认 1 号）；「下个月底」取**次月末**而不是本月末。 | **H-03**：原实现硬编码 `1 号`，`下个月5号` → **10-01**（应 10-05）。「下个月底」因「月底」分支排在前面而落到**本月底**，整整早一个月。 |
| **D41-d** | 时间连接词必须**跟着它的量词一起剥离**：`每周X` 的星期字、`下（下）周X` 的「下」、`这/本周X` 的「本」；`半` 作为分钟表达（`10点半` = 10:30）。 | **N-04**：实测标题被污染成「一站会」「下开会」「前提交」「半面试」，且 `10点半` 被算成 `10:00`。根因是正则只吃掉词头，留下孤立字符。 |
| **D41-e** | 「X 前 / 之前 / 以前」产出**截止**：有明确时刻（`9点前`）精确到那一刻，只有日期/模糊时刻则取当天末尾。**只对这类连接词生效**，不按 `hasDeadlineKw` 一律放宽。 | **N-04 / M-03**：此前只认「截止 / 到期」等硬词，`9点前`、`之前` 既丢截止又污染标题。**不放宽的理由**：硬关键词里的「最后一天」会命中`每月最后一天交房租`这类**周期**表达，给它加截止等于每个周期多一轮截止保护提醒 —— 净增打扰，与「降低 Future 查看频率」的取舍相反。 |

**为什么重写「下周X」而不是只删掉 `delta += 7`**：只删那一行，「下周三」修对了，但「下周日」会变成**本周日**
（`(0-5+7)%7 = 2`）。两个分支必须共用一套「日历周」定义，否则只是把一个不一致换成另一个。

**为什么「每月N号」不能只改触发时刻**：周期引擎 `lib/repeat.js` 的 `month` 推进以**原定日期**为锚
（`base.getDate()`）。只把首期改对、不把号数留进 `triggerAt`，次期仍会从错误日期顺延 —— 所以必须同时修
首期锚点（D41-b）与周期推进（`repeat.js` 无需改动，它本来就按 `triggerAt` 的日推）。

**口径统一**：`dayOfMonthIn` 收敛到月末，与 `lib/repeat.js:87` 既有的 `Math.min(base.getDate(), 月末日)` 一致，
避免「解析层不收敛、周期层收敛」两套标准。

---

## D41-附 · 双副本一致性守护（对应 M-10）

`app-core.js` 里有一份**整份复制**的 `parseChineseTime`，仅在 `lib/*.js` 未加载时兜底
（`app-core.js` 的覆盖块：`if (Lib.parseChineseTime) parseChineseTime = Lib.parseChineseTime`）。
本次两处**同步修改**，并新增 `scripts/verification/parse-parity.js`：

- 把兜底副本从源码里按花括号配平切出来（该区段是纯函数、无 DOM 依赖），与 lib 跑同一组 35 条语料，逐字段比对；
- 差异必须显式登记，否则退出码 1；
- 登记在案的能力差只有一类：兜底副本**没有 `extractDuration`**，时长类表达（`3天后`）它会落到日期分支
  （10:00 / mid），而 lib 走时长路径（保留当前时刻 / high）。

**这不是消除重复，只是让分叉不再静默。** 彻底消除重复（删掉 `app-core.js` 的副本）属于**改兜底契约**的架构决策，
见下方待裁决项。

---

## D42 · 更正两条上一轮的结论

| # | 结论 | 依据 |
|---|---|---|
| **D42-a** | **H-05 撤回（误报）。** 「截止块不校验 status → acknowledged 仍弹截止提醒」**不是缺陷**。 | 项目权威门槛是 `app-core.js:1551` 的 `deadlineAt && !deadlinePaused && !isTerminal`，而 `isTerminal = archived \|\| completed`（`:984`）—— **本来就不含 `acknowledged`**。`lib/reminder.js:76` 写明设计意图：*「截止保护独立于 ACK / 完成状态（INV-05）：只要未完成且临近截止就该唤醒」*。投影（`native-reminders.js:313`）与权威**逐字相同**，两者都委派 `Lib.deadlineStage*`，不存在两侧不一致。第 2 轮报告里「primary 有 active 准入、截止块没有 → 不对称」的说法，混淆了「重复提醒」与「截止保护」两件事：`active` 只控**重复提醒**（ACK 后停止追加提醒），截止保护按设计**继续**。 |
| **D42-b** | **H-06 更正：机制成立，但表述与严重度都要改。** | 实测（`scripts/verification/deadline-quiet-probe.js`）：① 丢失范围**比「勿扰区延后」更宽** —— `triggerAt=02:00`、对账 `09:00`，**即使不开勿扰**同样 0 条排程。准确说法是：**投影只排「严格未来」的触发点，任何触发点已过的活跃事项都拿不到原生通知**；勿扰延后只是「应用自己把点挪到 07:30、然后又没送到」这条最反直觉的路径。② 第 1 轮写的「既不提醒也不进首页」**是错的**：权威会在 `app-core.js:1534-1540` 把它提升为 `due`，**首页「待确认」里看得到**。真实后果是「少一条通知」，不是「事项丢失」→ **降为 中危**。 |

---

## N-08 · 新发现（本轮取证副产物）→ **已于同日修复，见 D44**

**截止保护补提醒会同时补两条。** 当截止时刻已过、且该阶段的台账里没有任何记录时，
`native-reminders.js:327-330` 对 `deadlineStagePoints` 返回的 **p24 与 p2 两个点各自**执行
`at = now + 2000` —— 两个阶段的 `schedule.at` 落在**同一毫秒**，两条通知同时弹出
（实测：`14:00:02` p24、`14:00:02` p2，id 不同）。

- **触发条件**：应用长时间未运行，期间跨过了截止时刻；下次对账时 `deadlineTs` 仍落在
  `DEADLINE_GRACE_MS`（逾期 24h）窗口内且台账为空。
- **影响**：同一事项同一时刻两条内容一致的通知，属噪声（与「降低打扰」取舍相反）；不丢信息。
- **修复方向（一句话）**：补提醒时只补**最新**的一个阶段（`points` 里 `at` 最大的那个）。
- **为什么这条路不需要先裁决**：全文见 D44。要点：去重不改动任何阶段的**时刻定义**，也不改
  `deadlineEvents[stageKey]` 的三态语义 —— 它只回答「同一时刻要不要弹两条」，
  而「同一事项同一毫秒两条内容一致的通知」在任何产品取舍下都是噪声。
  真正需要裁决的是 **H-06**（要不要给 `primary` 也补投），与 N-08 是两件事。

---

## D44 · 截止补投去重（N-08）

| # | 决议 | 依据 |
|---|---|---|
| **D44-a** | `buildDesired` 的截止补投先**收集**所有「保护点已过且无需等待」的阶段，循环结束后**只产出其中一条**。 | 原实现让 p24 与 p2 各自 `at = now + 2000`，同一事项同一毫秒两条通知。 |
| **D44-b** | 全部过期时保留**最接近截止**的阶段（`p2`）；只剩更早的阶段过期（截止还有 2h 以上）时补那一个。 | `p2` 是最终保护点（`DEADLINE_FINAL_MS`），「马上就要截止」的表达最准确。实现为 `catchups.find(p => p.id === "p2") \|\| catchups[catchups.length - 1]`。 |

**边界（不做的事）**：不改 `deadlineStagePoints` 的时刻定义；不改 `deadlineEvents[stageKey]` 三态语义；
不改「每个阶段独立预排」的既有行为（未过期的阶段照旧各排一条）。
只回答「同一时刻要不要弹两条」—— 答案在任何产品取舍下都是否。

**验证**（反向验证已执行）：
- `scripts/verification/deadline-quiet-probe.js` C 组：修复前 `14:00:02` 出现 **p24 + p2 两条**，修复后**只剩 p2**；
- 把 `catchups.push(point); return;` 临时改回 `at = now + 2000;` → 断言 2 条变红、probe 退回两条；恢复后全绿。

---

## D45 · 声振生命周期与冷启动基线（N-02 / N-03）

| # | 决议 | 依据 |
|---|---|---|
| **D45-a** | **产品裁决（2026-09-18）：遮挡期间继续响。** `onStop` **不再**调 `stopAlarmEffects()`（仅保留 `clockTicker` 的移除）；`onResume` 的 `restartAlarmEffects()` 保留为幂等兜底。 | **N-02**：`onStop` 无条件 `stopAlarmEffects()`，此前**没有任何恢复路径** → 通知权限被禁（界面是唯一声源）时，按 Home 再切回来闹钟永久哑。**改判理由**：「隐藏即静音」只在声音另有载体（通知）时才成立；而走到界面发声这一步，前提恰恰是通知发不出去（`notificationOwnsSound()==false`）—— 此时界面是唯一声源**且**通知栏里根本没有那条带停止按钮的常驻通知，停声等于整个闹钟消失。见下方「D45-a 取舍」。 |
| **D45-b** | `startAlarmSound()` 必须**幂等**：已在播直接复用，存在但已停才 `releasePlayer()` 重建。 | **D45-a 的必要前提**（改判后更吃紧）：`playAlarm` 无条件 `new MediaPlayer()` 并**直接覆盖字段**，旧 player 仍在 looping 却已失去引用（停不掉也释放不掉）。既然 `onStop` 不再停声，`onResume` 这次调用就**必然**遇到「已在播」—— 没有幂等守卫，每次切回界面都会叠一路铃声。 |
| **D45-c** | 面板轮询句柄留痕（`activeAlarmPollTimer`），重绑前先 `clearInterval`。 | **N-03**：`setInterval` 无句柄。当前 `bindNetwork` 只在 `init()` 调一次（页面级刷新会自然回收），属**防御性**修复而非现网泄漏 —— 如实标注，不夸大。 |
| **D45-d** | `applyParsedState` 重建 `committedAlarmItems` 基线（深拷贝，与 `writeSnapshot` 口径一致）。 | **N-03**：该变量此前**只在 `writeSnapshot` 里赋值** → 「刚启动、还没提交过事务」时恒为 `[]`，面板找不到对照项，本该被自动忽略的旧投递一直挂着等用户手动处理。 |

**为什么用深拷贝而不是 `slice()`**：`committedAlarmItems` 的语义是「最后一次**已提交**的快照」。
`slice()` 只复制数组、元素仍共享引用，后续内存中的原地改动会渗进「已提交」的语义里；
`writeSnapshot` 用的是 `JSON.parse(json)`（独立副本），这里与之保持一致。

### D45-a 取舍：为什么推翻「隐藏即静音」

**只在这一种情况下有差别**：`notificationOwnsSound() == false`（用户关掉了通知权限）。

| | 谁发声 | 界面被遮挡时 |
|---|---|---|
| 有通知权限（绝大多数） | 通知渠道音 + `FLAG_INSISTENT`，**系统**循环播放 | 照旧响，与界面死活无关 |
| 无通知权限 | `AlarmActivity` 自己播（`USAGE_ALARM` + `playAlarm` looping） | 界面是**唯一**声源 |

第二行才是争议所在。旧决策（*A hidden Activity must never hold an independent repeating
vibration*）的顾虑是真实的：看不见的界面在后台响，用户找不到静音入口。但走到这条路径时，
**通知栏里本来就没有那条带停止按钮的常驻通知**（`AlarmStopReceiver` 依赖它）——
停声不会「给用户一个安静的选项」，只会让整个闹钟从此消失。

**接受的两项代价**：
1. 静音入口只剩「回到界面点关闭」——通知栏那条停止按钮在本场景下不存在。
2. 遮挡期间振动也继续（`vibrate(pattern, 0)`，无限循环）。这符合闹钟语义，但确实比有通知时更“缠人”。

**保留的两道边界**：
1. `onDestroy` 仍调 `stopAlarmEffects()` —— 响铃不越过界面自身的销毁，避免真正的幽灵响铃。
2. `ActiveAlarmStore.MAX_AGE_MS`（6h）给台账设上限，间接限制对账时 `preserveActive` 的豁免范围。

**回退成本**：把 `stopAlarmEffects()` 加回 `onStop` 即可。`onResume` 的 `restartAlarmEffects()`
在两种方案下都成立（幂等），无需改动 —— 换向是 1 行的事。

**验证**：2 条源码级断言 + **字节码级确证**（`javap -c` 显示 `onStop` 中
`stopAlarmEffects` 调用数为 0、`onDestroy` 中为 1）。反向验证：把 `onStop` 改回旧决策 → 断言红；
删掉 `onDestroy` 那次调用 → 另一条断言红。

**为什么必须剥注释后匹配**：本轮 `onStop` 的注释里正解释着「`onDestroy` 仍调 `stopAlarmEffects()`」。
不剥注释，这段说明本身就会被判成「onStop 停了声」—— 断言守护的是可执行代码，不是文档。

**验证**：6 条源码级断言（N-02 / N-03 四条 + D45-a 两条），反向验证通过（回退修复即对应断言变红，恢复后全绿）。

---

## 附带修复 · 构建脚本在「无代理」环境下必然失败

`scripts/android-build.sh:74` 原为 `./gradlew "${GRADLE_ARGS[@]}" "$task"`。
`GRADLE_ARGS` 只在设了 `HTTPS_PROXY` 时才有元素；而 macOS 自带 `/bin/bash` 是 **3.2**，
**4.4 之前不允许在 `set -u` 下展开空数组** → 报 `GRADLE_ARGS[@]: unbound variable` 并终止。

即「本地没配代理」这一最常见情况下**构建必然失败**，与业务代码无关，纯脚本缺陷（本次踩到）。
改为显式分支 `if [ ${#GRADLE_ARGS[@]} -gt 0 ]`，不依赖 bash 版本，也不给 gradlew 传空参数。

> 另记一条环境坑（非项目缺陷）：`npx cap sync android` 的删除步骤会撞上**沙箱批量删除护栏**
> （`count:50 / threshold:50`），报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`。
> 首次运行已成功同步 www 资产，故验证 Java 编译可直接 `cd android && ./gradlew assembleDebug`。

---

## 下一步计划

### 批次 2 · 排程对称性（H-06 / N-08）—— **被两处裁决阻塞，请先给口径**

- **功能**：让「触发点已过但事项仍活跃」与「截止补提醒」这两种补投行为有确定语义，且不产生重复通知。
- **范围边界**：只动 `lib/native-reminders.js` 的 `buildDesired` / 台账读写；
  **不动** `lib/repeat.js`、不动 `deadlineEvents` 三态语义、不动截止保护的时刻点定义。
- **预期产出**：`D43` 裁决 + `buildDesired` 的补投规则 + 回归断言（含「同事项同一时刻不得产出两条通知」）。
- **阻塞项**：
  1. **H-06 需要「单次提醒是否已消费」的台账。** 投影侧没有这个状态，只有
     `settings.scheduledAlarmIds` 这种「id 仍然有效」的集合。**照搬截止块的 `at = now + 2000` 会让每次对账
     都补一次**（身份稳定 → 同一 id 反复 notify；或身份不稳定 → 撤销/重排循环，正是 R6 注释警告的形态）。
     → 可选项见下。
  2. **N-08 是产品语义**（要不要合并阶段），按基线 §22 先裁决。

**H-06 的可选方向**（按代价从低到高）：

| 方向 | 做法 | 代价 / 风险 |
|---|---|---|
| **A. 保持现状，只让丢失可见** | 不补投；在 `buildDesired` 里把「因触发点已过而未排程」按 `itemId + 触发点` 记一条 trace，自检面板如实显示 | 最小改动、零产品行为变化；用户仍然收不到那一条通知 |
| **B. 引入单次提醒台账** | 为 `primary` 每个 `(itemId, rev, 触发点)` 记 `scheduled/delivered`，已消费的不再补投 | 真正修好；需要新增持久化字段 + schema 迁移 + D32/D41 口径确认（与 `deadlineEvents` 对称） |
| **C. 复用截止台账** | 把 primary 也纳入 `deadlineEvents` 式的三态记账 | 会让「截止台账」变成「提醒台账」，语义扩张，不建议 |

**推荐 B**，理由：它与既有 `deadlineEvents` 三态台账**结构对称**，是本项目已经验证过一遍的模式；
A 只是把问题变可见，不解决「少一条通知」。B 需要你确认「新增持久化字段」是否在本次授权范围内。

### 批次 3 · 声振生命周期与面板（N-02 / N-03）—— **已落地**（见 D45）

- **功能**：① 通知权限关闭时（界面是唯一声源）界面被遮挡期间必须**继续响铃**；② 活跃闹钟面板的
  轮询要能被注销；③ `committedAlarmItems` 冷启动要有正确初值。
- **范围边界**：只动 `AlarmActivity` 的 `onStop` / `onResume` / `startAlarmSound`，与 `app-core.js`
  面板那 ~90 行；不改 `notificationOwnsSound()` 的判定口径（那是 F2 的结论，已有真机取证）。
- **裁决结果（2026-09-18，用户决定）**：**推翻** `onStop` 的「界面隐藏即静音」，改为**遮挡期间继续响**。
  实现 = 删掉 `onStop` 里的 `stopAlarmEffects()`（仅保留 `clockTicker` 移除），`onResume` 的
  `restartAlarmEffects()` 保留为幂等兜底。完整取舍、代价、边界与回退成本见上方「D45-a 取舍」。
  → 反向选择（静音 + 可见恢复）的实现成本同样是 1 行，随时可换回。
- **验证方式**：模拟器可验「遮挡后是否仍在响」；真机需关掉通知权限后复验（真机复验**未执行**）。
  已知待真机确认项：后台（无前台服务）持续播 `USAGE_ALARM` 是否会被某些 ROM 的省电策略掐断 ——
  属**需真机验证的怀疑项**，未纳入本次断言。

### 批次 4 · 存储降级一致性（H-07）—— **需要契约裁决**

- **功能**：IDB 读失败降级到 localStorage 镜像后，写入只落镜像；IDB 恢复后从旧值加载 →
  **降级期间的改动静默消失**。
- **范围边界**：只动 `app-core.js` 的 `writeSnapshot` / `loadAsync` 降级分支；不改 IDB 为真源的设定。
- **可选方向**：① 降级期写入进**待回放队列**，IDB 恢复后按序重放（与 D39/D40 回滚+重放同一套思路）；
  ② 降级期**拒绝写入**并把 `storageReady=false` 变成用户可见错误；③ 恢复时以镜像覆盖 IDB（风险最高，可能回退他人改动）。
- **推荐 ①**，与项目既有「回滚 + 按序重放」一致。需你确认降级期的写入是否允许**排队延迟落库**。

### 约束（四个批次共同）

- 基线 §22：**冲突先停下报告，不自行优化产品逻辑**。批次 2、4 各有 1 项待裁决。
- 一切改动必须保持 `docs/baseline/` 只读；`decided ≠ delivered`，落地后回改对应 spec。
- 测试基线当前 **1084**（unit 132 / native 203 / smoke 175 / regressions 574，脚本相加）；
  任何批次改完必须全绿，且**新增断言要能复现被修的缺陷**（否则等于没修）。
- 网络/权限约束：真机验证需要解锁 + vivo/OPPO 后台白名单；`adb install` 在锁屏态会被拒。
- 本批次已完成的部分：`bash scripts/android-build.sh debug` 成功（**含 Java 改动**，并经
  `--rerun-tasks` 强制重编译 + `javap -c` 字节码确证）；`scripts/verification/parse-probe.js`、
  `parse-parity.js`、`deadline-quiet-probe.js` 三个取证脚本可复现。

---

# 第十三轮：批次 2 / 4 与 H-08 归因（同日晚间，用户逐项裁定）

用户在 grilling 前沿上给出四项裁定，本轮按裁定落地。**裁定原文**见下方每条的「用户裁定」。

| 编号 | 缺陷 | 用户裁定 | 落地 |
|---|---|---|---|
| **D46** | H-06（少一条通知） | 补投 **+ 新增台账** | ✅ 已落地 |
| **D47** | H-07（降级静默丢失） | **待回放快照** | ✅ 已落地 |
| **D48** | H-08（无通知权限息屏静默） | 只落 **D**（台账 + 自检归因） | ✅ 已落地 |
| — | `ActiveAlarmStore.MAX_AGE_MS` | **保持 6h** | 无需改动（登记为已裁定） |

---

## D46 · 补投语义与单次提醒台账（H-06 / D43）

**用户裁定**：补投，并授权新增持久化字段与 schema 迁移。

### 机制

投影 `buildDesired` 只排**严格未来**的触发点（`lib/native-reminders.js` 的 `if (at <= now)`），
于是「触发点已过、事项仍活跃」的提醒永远拿不到原生通知。补投必须能回答
**「这个触发点是否已经消费过」**，否则每轮对账都会再补一次。

台账与 `deadlineEvents` **结构对称**：

| | 截止台账（既有） | 提醒台账（D46 新增） |
|---|---|---|
| 键 | `"<阶段>@<deadlineAt>"` | `"<attempt>@<原定触发点>"` |
| 状态 | `scheduled` / `delivered` / `cancelled` | 同 |
| 身份取法 | 保护点时刻（稳定） | 原定触发点（稳定） |
| 回传 | `status.deadlineEvents` / `cancelledDeadlineEvents` | `status.reminderEvents` / `cancelledReminderEvents` |

准入口径（逐条与截止块对齐）：

- 已 `delivered` → 不再打扰（终态）；
- 已 `scheduled` 且投递时刻已过 → **待定**，既不重排也不补发（无法判定是否送达）；
- 无记录 / 已 `cancelled` → 触发点已过即补一条；
- 同一事项本轮**最多补一条**，取**最后一次**尝试（与 D44-b 同一取舍）。

### 本轮新增的三条边界（**须显式登记**，均由实现者给出、用户裁定未逐条覆盖）

1. **补投窗口 = `DEADLINE_GRACE_MS`（24h）**，复用截止保护的既有常量。
   理由：一个三天前错过的普通事项在半夜补一条通知是净打扰，而事项本身早已被
   `app-core.js` 提升为 `due` 进首页「待确认」（H-06 的真实后果只是「少一条通知」）。
   代价：与截止保护共用取值，改一处会同时影响两者（回退 = 删掉那个条件）。
2. **补投不走全屏闹钟**（不设 `extra.useAlarm`）。理由：历史决策「全屏闹钟只给关键档且仅首次」，
   错过一次提醒再抢屏是把迟到变成打扰。代价：关键档的补投只是一条普通通知。
3. **`dismissedUntil` 未到不补投**。理由：该字段的语义就是「在此之前别打扰」，
   补投不得打断用户明确做出的这个承诺。

### 已知限制（不夸大）

闹钟通道（关键/重要档的 `attempt 0`）走 `SystemBridge.cancelAlarm`，**只回传撤销条数、
没有逐条的 key**，因此这类排程被撤销时台账仍停在 `scheduled`。
方向是**保守**的（不会重复补投，可能少补一次），与截止块「无法判定是否送达就不重发」一致。
普通档（占绝大多数）走 LocalNotifications，逐条撤销可回传，无此限制。

### 覆盖到的一条真实盲区

`acceptedIds` 原本只统计 LocalNotifications 通道。关键/重要档的首次提醒走**闹钟通道**，
若只用它判「是否已排」，这些提醒会被记成「从未排过」→ 到点后重复补投。
因此提醒台账的准入集合额外并入 `alarmState.ids`，并用 `available !== false` 严格把关
（桥不可用时 `reconcileAlarms` 原样回传旧台账，那种情况不能当「已排」）。

### 验证

- 断言 16 条（`test-native-reminders.js`「D43 单次提醒补投台账」）：
  补投落点/身份、三态、窗口边界、身份稳定、多尝试只补一条、不走闹钟、`dismissedUntil`、
  未过期路径不受影响、回传、端到端幂等、闹钟通道计入、撤销回传。
- 断言 5 条（`test-smoke.js`「10. D43 提醒台账与 H-07 降级恢复」）：落库侧三态与剪枝。
- **反向验证**：把 `missed.push(...)` 关掉 → D43-a / D43-d / D43-e 变红。

---

## D47 · 存储降级不丢改动（H-07）

**用户裁定**：待回放快照（降级期写入照旧立即落盘，另存最新快照，IDB 恢复后重放）。

### 关键发现：原先的排查漏掉了**最常见**的那条路径

复核报告写的是「IDB **读失败** → `storageReady=false` → 写入只落镜像」。真机上更常见的是
**IDB 打不开**：`lib/storage.js` 的 `ensure()` 里 `openDb()` 失败会**整体切到 `backend="local"`**，
此后所有写入都只落镜像 —— 而这条路上 **`storageReady` 仍然是 `true`**，
根本不走 `writeSnapshot` 的降级分支。

**只覆盖「读抛错」那条路，等于没修。** 本轮因此引入 `authoritativeBackendMissing()`：
`Lib.hasIdb()` 为真（设备有 IndexedDB）但 `storage.backend !== "idb"` —— 即「本该用权威后端、
这次却只落了镜像」。设备**根本没有** IndexedDB 时（`backend` 恒为 `local`）不留凭据，
避免每次启动都做一次无效重放。

### 机制

- `PENDING_REPLAY_KEY = KEY + "-pending-replay"`：与权威键**分离**，不污染镜像；
- `markPendingReplay(json)`：降级写入时另存整份快照；写失败（配额）**不影响主写入路径**
  （localStorage 此刻就是权威、已写成功），但打 `console.error` 留痕；
- `replayPendingSnapshot()`：读凭据 → `applyParsedState` → 写回 IDB → 清凭据；
  写回失败则**保留**凭据（内存已是较新状态），下次启动再试；
- `loadAsync()`：**只有 `storage.backend === "idb"` 才重放**。仍在镜像上跑时重放会白白清掉
  凭据，等 IDB 真恢复就再也拿不回来 —— 这条门控就是探测器第一版跑出来的。

**为什么「重放最后一份」等于「按序重放」**：整个状态是一份**完整快照**、写入语义是
last-write-wins（既有契约），而降级期间本机唯一的写入方就是这条路径，中间态没有独立价值。
与 D39/D40 的「回滚 + 按序重放」不冲突：那里重放的是**用户命令**，这里重放的是**终态**。

### 验证

- `scripts/verification/storage-degrade-probe.js`（新，8 条）：假 IndexedDB 两阶段复现 ——
  ① 降级期写入是否留凭据；② IDB 恢复后是否采用该凭据并写回、清凭据；
  ③ **对照**：手动删掉凭据 → 新改动丢失（缺陷复现，证明 ② 不是巧合）。
- 断言 8 条（`test-smoke.js` 同节）：落库侧行为 + 三条源码级契约（接线在位 / 先重放后回落 / 门控）。
- **反向验证**：把 `authoritativeBackendMissing()` 改成恒假 → ① ② 变红、③ 仍复现
  （状态只剩 IDB 里的旧事项）。

---

## D48 · H-08 归因：无通知权限 = 全屏闹钟没有载体

**用户裁定**：只落 **D（台账 + 自检暴露）**，A（强引导授权）/ B（换机制）/ C（界面提示）本轮不做。

### 已确证的机制（真机 2026-09-18）

`setFullScreenIntent` 是 **Notification 的属性**（`AlarmTestReceiver.java` 的 `fsiPath` 分支）。
Android 13+ 未授予 `POST_NOTIFICATIONS` 时 `nm.notify()` 是**静默空操作** → 全屏意图没有载体、
系统不会替我们展示，同时失去 `NOTIFICATION_SERVICE` 的 BAL 豁免 → 直起也被静默拦下。
7 轮受控投递：无权限 + 息屏 **0/4**、有权限息屏 **2/2**，断点每次都在 `created` 之前。

### 落地

| 位置 | 内容 |
|---|---|
| `AlarmTestReceiver` | `KEY_DELIVERY_NOTIFY_ON`；`notificationsUsable()`（用 **NotificationManagerCompat**，避开 API 24 才有的 `NotificationManager.areNotificationsEnabled()` → minSdk 22 上的 `NoSuchMethodError`，与 H-04 同一坑）；无权限时先记 trace `fullScreenCarrierMissing` |
| `SystemBridgePlugin.lastAlarmDelivery` | 回传 `notifyEnabledAtDelivery`，**默认 true**（老 APK 写的记录没有这个键，不能凭空变成「无通知权限」） |
| `app-core.describeAlarmDelivery` | 新增归因分支，排在通用归因**之前**；用严格 `=== false` 判定 |

归因文案：「投递时系统通知是关闭的 · 全屏闹钟没有载体（系统不会展示）」，标签「无通知权限」。
这一条必须压过「缺全屏通知权限 / 权限齐备但系统没展示」——它同时解释「看不到界面」与
「听不到声音」（此时声音只能靠界面自播），是本项目此前**误诊过**的那一类结论。

**记录投递当时的值而不是现在的值**：事后权限可能已被改动，用「现在」解释「当时」正是
把「后台启动被拦」误诊成「缺全屏通知权限」的同一类错误。

### 验证

- 断言 6 条（`test-native-reminders.js`）：Java 源码级静态断言 + 键名一致性。
- 断言 5 条（`test-smoke.js`「11. H-08 投递归因」）：**行为级** —— 无权限 / 与「缺全屏通知权限」
  同时命中 / 老记录（无该键）/ 权限齐备 / 界面已显示。
- 字节码确证：`javap -p -c` 显示 `notificationsUsable(Context)` 与
  `KEY_DELIVERY_NOTIFY_ON` 存在，且方法体内 `NotificationManagerCompat.areNotificationsEnabled()`。
- **反向验证**：把归因分支改成恒假 → 前两条行为断言变红，未受影响的第三条（老记录）
  与「界面已显示」保持绿 —— 说明没有越界改变既有结论。

**仍未解决**：无通知权限 + 息屏时**用户依旧收不到闹钟**。本轮只把断点说出来，
真正的修复（强引导授权 / 换投递机制）需要另一次裁决与真机轮次。

---

## 本轮验证汇总

| 项 | 结果 |
|---|---|
| 测试基线 | 1084 → **1124** 全绿（unit 132 / native **225** / smoke **193** / regressions 574） |
| 新增断言 | native +22、smoke +18（每条修复都有能复现缺陷的断言） |
| 反向验证 | D43 / D47 / H-08 三处均「回退即红、恢复即绿」 |
| 取证脚本 | 新增 `scripts/verification/storage-degrade-probe.js`（8/8） |
| Java | `:app:compileDebugJavaWithJavac` 通过；`javap` 字节码确证新增字段与方法 |
| www 资产 | `npm run sync:www` 已同步；`www/` 与 `android/app/src/main/assets/public/` 两份均与源码 `cmp` 一致（`cap sync` 仍会撞沙箱批量删除护栏，故 assets 用定向复制同步） |
| 未执行 | 真机复验（H-07/H-08 需真机或至少模拟器）；APK 未重打包 |

> ⚠️ **并行会话**：本轮执行期间另一会话正在做「导入/导出」特性（`lib/import-*.js`、`lib/export-format.js`、
> `docs/decisions/import-export-ruling-2026-09-18.md`、D49+ 编号）。该会话只碰了 `test-unit.js` 一个本轮
> 范围内的文件（mtime 15:49:51）——`test-regressions.js`（02:42:45）与 `index.html`（02:29:45）
> 的修改时间都早于该会话动手，**未与本轮范围产生任何交集**，此处原记录有误，据实修正。
>
> `test-unit.js` 在 15:46 时确实处于**半成品**状态（`ReferenceError: ex_buildForRoundTrip is not defined`），
> 故本轮「全绿」口径不含该文件（`git show HEAD:test-unit.js` 跑基线 105/0，全绿）。
> **该待办已于 2026-09-18 15:50 关闭**：对方收尾后工作树版本 `node test-unit.js` = **249 通过 / 0 失败**，
> 四套合计 **1241 / 0**，本轮新增的 22 条 native 与 18 条 smoke 断言仍全部通过。
