# 安心收件箱 · 第三轮全面体检总报告（汇总）

- **执行窗口**: 2026-10-15 ~ 2026-10-16
- **体检对象**: 工作区未提交版本（`git rev-parse HEAD` = `f79b1a7396c6f5493e43a27ec88e960f8b620ac3`，未提交文件 38–52 个；含首轮 8 项修复 + P1-④/⑧ UI 改造 + 台账新增 `lost` 态 + 渠道 v4→v5）
- **体检方式**: **9 条非真机检查线**（T1/T2/T3/T4/T6/T7/T8-Web/T9/T10）+ **真实浏览器 CDP 复核**（独立 headless Chrome，390×844 移动视口）+ **vivo V2238A / Android 16 真机**（设备 `10ACBF2D3D000RS`；T5 投递/可靠性/重启 + T8 真机 WebView）
- **判定依据**: [V0.2 基线](../baseline/Attention_Inbox_V0.2_产品需求与业务规格基线.md) + [修订附录](../baseline/V0.2-amendments.md)（附录优先）+ [已冻结决策 D-xx](../decisions/) + [全场景验收案例 A1–J*](../acceptance-cases.md)
- **前序报告**: [首轮](product-health-check-2026-10-15.md) · [第二轮](product-health-check-r2-2026-10-15.md)
- **各线报告**: health-T1 / T2 / T3 / T4 / T6 / T7 / T8-web / T9 / T10 / **T5-device**（均 2026-10-15）· **T5-reboot**（2026-10-16），见 `docs/reviews/`

## 覆盖说明

| 检查线 | 计划/执行 | 覆盖情况 |
|---|---|---|
| T1 自动化+工程健康 | 6/6 | 全执行（无真机）：`npm test` 15/15、变异抽查 5 处、`assembleDebug`、`lintDebug`、依赖、版本号 |
| T2 捕获与时间解析 | 17/15 | 跳过 A10/A11（需浏览器）；A3/A8/A9/HC-T2-3/HC-T2-5 由 T8-Web 补测；70 条语料矩阵、极端输入 |
| T3 生命周期与动作语义 | 18/18 | 全执行（Node harness + 代码证据）；3 项标「需真机/浏览器复核」 |
| T4 提醒链路代码审计 | 9/9 | 全执行（纯代码层）；渠道实测已由 T5 完成（✅），Doze 实测未做（需撤销精确权限） |
| T6 待整理引擎 | 20/20 | 全部 **Web 模拟**；HC-T6-1 真机投递 1 次未执行 |
| T7 截止保护 | 10/10 | 全部 **Web 模拟**（受控时钟） |
| T8-Web UI/交互/无障碍 | 10/10 | 真实浏览器 390×844；真机 WebView 部分已由 T5 线执行（HC-T3-4 Android 计数仍未复核） |
| T9 Web/PWA | 5/5 | 静态/Node 结论；HC-T9-2 离线 / T9-3 通知三态 / T9-4 SW 更新由 T8-Web 真实浏览器补测 |
| T10 数据/备份/一致性 | 17/17 | Node 纯函数验证；端到端往返、DOM 渲染待复核；F3 重启恢复已由 HC-T5-4 部分覆盖（✅），改时区/清数据类未做 |
| 浏览器 CDP 复核 | 10/10 | 与 T8-Web 同线；全程 `Runtime.exceptionThrown`=0、`Log(error)`=0 |
| **T5 真机投递与可靠性** | **14/5** | HC-T5-0/1/2/3/4 全部执行且 **✅ 通过**（T5-4 已获用户同意 reboot）；T5-5…13 未执行（需用户系统设置操作/改时间/破坏性同意），见「未覆盖项」 |
| T8 真机 WebView 部分 | 6/6 | 由 T5 线执行：HC-T8-1 ⚠️ 结构复现（可见症状未复现）、T8-2 ✅、T8-3 ❌、T8-5 部分 ❌；T8-4/T8-6 引用 web 报告 |

> 本报告只汇总、去重、排序，**不修改任何产品代码**。

---

## 结论摘要

首轮两项 P0（渠道竞态、scheduled 卡死→lost 补投）**代码已修 + 测试带牙齿 + 真机闭环已验证**（HC-T5-0：v5 渠道无声无振动、v4 已删、v3 不存在；HC-T5-3：强停后补投仅一次；HC-T5-4：重启后原时刻精确重排、息屏锁屏 +962ms 投递）——但 `lost` 台账改动**仍未提交**。本轮 P0 共 2 条：① A-1 窄屏面板撑高（浏览器实测 1680px；真机 **结构复现** 1476 vs 视口 742，但 capture+软键盘 / detail 两流程**未见可见上移**，T5 建议按真机重估严重度）；② B-2 非精确闹钟误判丢失→重复提醒（**代码级、条件触发**；本测试机有精确权限，真机未触发）。P1 共 11 条（解析 5 条、AC-05 入口缺失、计数偏少、A-8 不止响、跨版本导入、无深色模式——真机亦实测 FAIL）；P2 共 26 条（新增：versionCode 未升致真机安装弹「相同版本」确认框）。真机剩余未覆盖项集中在权限开关/改时间/清数据类，见「未覆盖项」。

---

## 一、本轮发现（按严重度排序）

> 去重规则：同一问题在多线出现只保留一条，合并全部证据。下方 P2 条目括号内标注了被合并的来源。

### P0

#### P0-① 窄屏下收起态底部面板把文档撑高到 1680px，应用可被程序化滚动整体上移
- **违反条款**: 第二轮 P0「面板带走页面位置」；移动端整屏上移/底部留白/导航被顶到中部
- **复现步骤**: 390×844 打开页面 → 打开「记录/详情/稍后/确认」任一面板再关闭 → 读 `document.documentElement.scrollHeight`；另试 `window.scrollTo(0,323)`。
- **期望 vs 实际**: 期望 `scrollHeight`=视口 844、`scrollY`=0；实际 **`scrollHeight` 恒为 1680**（基线态、开、关后均 1680）。`window.scrollTo(0,323)` 实测 `scrollY=323`（`body{overflow:hidden}` 挡不住程序化滚动）。
- **证据**:
  - 8 个/18 个收起态 `.sheet` 为 `position:absolute; bottom:0; transform:translateY(110%)`，最高面板 760px（`top=920/bottom=1680`），**不打开面板文档即 1680**；
  - `#app` 仅在 `@media (min-width:480px)` 有 `overflow:hidden`，窄屏缺失（`index.html:67`）；
  - 反证：页面内临时把所有 `.sheet` 设 `display:none` → `scrollHeight` 立即回 844；
  - 截图 `docs/reviews/health-evidence-2026-10-15/T8/t8-1-06-forced-shift-simulated.png`（模拟 `scrollY=323` 后的上移/留白/导航居中），原始值 `results.json`；
  - **真机 WebView（vivo V2238A，360×742 CSS px，dpr=3）**：`scrollHeight=1476`（≈2× 视口）、`#app overflow=visible`、`body overflow=hidden`、`window.scrollTo(0,323)` 生效（`after=323`）；键盘弹起时 `ih=433`/`sh=861` 同为 ~2× → **结构复现**；但 capture+软键盘、detail 两条流程下 `#app top=0`、`scrollY=0`，**未见可见「整体上移」**（`docs/reviews/health-evidence-2026-10-15/T5/t8-device-new-package.json`、`t8-dev-01/02/03-*.png`；旧包首连时另观测到 `scrollY=693`）。
- **影响面**: **所有窄屏用户（含 Android WebView）**；19 个 `.sheet` 全员命中，程序化滚动通道在真机同样存在。
- **真机复核结论**: 结构撑高 + 可程序化滚动在真机确证；「可见上移」桌面模拟复现、真机两流程未复现 → T5 建议按真机重估严重度。本汇总**维持 P0**（根因与修复方向不变，触发面收窄为「任何 scroll-into-view/程序化滚动发生即整屏位移」）。
- **建议修复**: `#app { overflow:hidden }` 挪到基础样式（所有宽度），收起态 `.sheet` 改 `display:none`（或 `inert`）；面板关闭时补一次 `window.scrollTo(0,0)`。**验证**: 390 视口「打开→关闭」后 `scrollHeight` 恒 844。

#### P0-② 非精确闹钟下「无接收证据 ≥10 分钟」误判丢失 → 补投与原闹钟重复响（=第二轮 B-2）
- **违反条款**: INV-10（不得漏，但亦不得制造重复打扰）；任务书 §5 P0 例「响两次」。（T4 报告定级 P0-①；完整复现依赖真机 Doze，**当前为代码级结论**，且触发需三条件同时成立、概率低，若按现实概率亦可视为 P1。）
- **复现步骤（代码层可复现，真机注入未做）**: ① 建关键/重要档事项，系统**未授予精确闹钟**（Android 14+ 新装默认拒）；② 排程降级 `am.set(RTC_WAKEUP)`，mode=`inexactNoPermission`；③ 设备 Doze 深睡，`am.set` 被推迟到维护窗口（延迟可远超 10 分钟）；④ 到点 ≥10 分钟无证据，用户打开 App 触发 `reconcileLostReminders`；⑤ 判 `lost` 补投普通通知（`now+2000`）；⑥ 原 `am.set` 稍后触发 → **同一触发点响两次**。
- **期望 vs 实际**: 期望 10 分钟阈值只在精确闹钟（`setAlarmClock`）下成立；实际**不区分排程模式**（单一常量 `LOST_NO_EVIDENCE_AFTER_MS = 10*60*1000`），`shouldFirstAlarm` 只对普通档把关。
- **证据**: `lib/native-reminders.js:183,221,229,231`；`lib/app-native-coordinator.js:611,624`；`AlarmScheduler.java:98,112-115,149-157,229-233`（注释明说无权限时解冻器在冻结态被挂起）；测试 `test-native-reminders.js:2401-2460`。
- **影响面**: 无精确闹钟权限 + 关键/重要档用户；表现为「一次提醒迟到又被补一条」。
- **真机状态**: 本测试机**已授予精确闹钟权限**（HC-T5-1..4 全程 `flags=3` 精确唤醒），触发条件 (a) 不成立 → **真机未触发**；HC-T5-2/4 每次投递仅一条 `ringStarted`、无双投，未见重复提醒实例。结论仍为代码级，维持 P0（条件触发、后果为「响两次」）。
- **建议修复**: 按 `canScheduleExactAlarms` 分流阈值（精确=10min，非精确=数小时或禁用该判据，仅保留「漏响台账」确定性信号）；补投时同时撤掉该键对应原生闹钟。**验证**: 增加「inexact 模式不凭无证据判丢失」断言。

### P1

#### P1-① 周期短语里的「周X」被「本周X」分支劫持，首次触发日期/时刻错误
- **违反条款**: INV-10、§6.1
- **复现**: `parseChineseTime("每周一9点开站会", 2026-09-15 09:00)` → `trigger=2026-09-21 10:00`（9 点丢失）；`now=09-14 10:00` → `trigger=09-14 11:00`（当天说→当天+1h）；`title="9点开站会"`（时刻残留）。
- **期望 vs 实际**: 应为下一个周一 **09:00**；实测 10:00，周一当天说给出「今天 11:00」。
- **证据**: `lib/parse-cn.js:282-295`（`(这|本)?周X` 分支在**未清理 text** 上先于 :342 命中）；`parse-cn.js:219` `clock2` 数字类含「一」，把「一9」吃成一个 token→`hour=null`。对照组 #70（带空格「每周一 9点」正确）。
- **影响面**: 所有含星期词的周期录入。**建议**: 有 `repeat` 时首期一律走 repeat 分支；`clock2` 匹配前先抠除已识别片段。

#### P1-② 截止表述「N号前」只给日不给月时，凭空编出「7 天后」的错误截止
- **违反条款**: INV-10、§10
- **复现**: `parseChineseTime("30号前交材料", 09-14)` → `deadline=2026-09-21 23:59`、`trigger=09-21 10:00`、`conf=low`。
- **期望 vs 实际**: 应锚到 **9/30**；实际「30号」整段丢失→落 fallback(+7天)→`parse-cn.js:368-370` 用 `endOfDay(trigger)` 补一个**错误截止**。
- **证据**: `lib/parse-cn.js:193-205`（`absDate` 必须「月…日」才命中）；`lib/app-capture.js:564` 在 low 时**照样落库** `parsed.deadline`。
- **影响面**: 最常见「30号/月底前交」截止；错误截止让 p24/p2 保护打在错误日期。**建议**: `absDate` 增补「裸 N 号」；或低置信时不产出 deadline。

#### P1-③ 周期「每月最后一个周五」退化为「每月」，锚点漂到当月 18 号
- **违反条款**: §11、HC-T2-1
- **复现**: `parseChineseTime("每月最后一个周五盘点", 09-14)` → `repeat={every:"month"}`、`trigger=09-18`；`nextRepeatTrigger`→`10-18`。
- **期望 vs 实际**: 应 `every="nthWeekday", nth=-1, dow=5`，首次 9/25。
- **证据**: `lib/parse-cn.js:143-150` 的 nthWeekday 正则不接受「最后」→落 `:160` 每月分支；`lib/repeat.js:114` 与 `date-utils.js:58-70` **已支持 nth=-1**（能力在下游、解析器产不出）。
- **影响面**: 所有「每月最后一个 X」。**建议**: 正则增补「最后」→`nth=-1`。

#### P1-④ 裸钟点缺时段（「三点半」）被当成凌晨，落到次日 03:30
- **违反条款**: INV-10
- **复现**: `parseChineseTime("三点半开会", 09-14 10:00)` → `trigger=2026-09-15 03:30`、`conf=mid`（不触发 Review）。
- **期望 vs 实际**: 口语通常指 **15:30**；实测次日凌晨 03:30。
- **证据**: `lib/parse-cn.js:216-228` 无 12/24 消歧，`:227` 只在有「下午/晚上」时 +12。
- **影响面**: 所有不带时段的下午钟点（3~6 点段最危险）。**建议**: 无时段且 `hour<12` 且结果早于 now 时优先 +12；或对 1–6 点裸钟点降级为待整理。

#### P1-⑤ 「三点一刻」被解析为 15:01，标题残留「刻」
- **违反条款**: INV-10
- **复现**: `parseChineseTime("下午三点一刻开会", 09-14)` → `trigger=2026-09-14 15:01`、`title="刻开会"`。
- **期望 vs 实际**: 应 15:15。
- **证据**: `lib/parse-cn.js:219` 分钟组把「一」当分钟数（`cnInt("一")=1`），「刻」既不入 `cleaned` 也不清理。
- **影响面**: 中文「X点一刻/X点三刻」。**建议**: 分钟组识别「一刻/三刻/半」→15/45。

#### P1-⑥ 「从提醒点『待整理』」在提醒里没有入口，AC-05 未落地（B3）
- **违反条款**: AC-05、基线 §7「待整理 | 从提醒入口点击时同时视为 ACK；进入 NEEDS_REVIEW；不创建重复 Item」
- **复现**: 任一事项到点 → 看应用内横幅/系统通知的可用动作。
- **期望 vs 实际**: 期望有「待整理」动作（点击后 `status→acknowledged`、`review_status→NEEDS_REVIEW`）；实际提醒只有 我知道了/稍后/完成；「待整理」只存在于**独立 review 通知**（`managedKind:"review-session"`），且整理确认**不写 ACK**（INV-08）。
- **证据**: `lib/app-alerts.js:160-164`（通知动作）、`:282-300`（横幅按钮）；`test-smoke.js:936-954`。
- **影响面**: 所有收到到点提醒的用户；「先收下晚点再整理」路径不存在。**建议**: 提醒动作集加入 `review`（复用 `reviewConfirm` 入口）或明确裁决 AC-05 降级并记录。

#### P1-⑦ A-8 删除/编辑/ACK 不撤「正在响铃的那一次」
- **违反条款**: AC-11（删除→所有未来调度撤销，不得幽灵提醒）的字面覆盖下，**正在投递**那次不在撤销范围
- **证据**: `AlarmScheduler.java:248-269` `cancel` 只撤 3 类 PendingIntent，不碰 `AlarmRingService`/`ActiveAlarmStore`；`SystemBridgePlugin.java:1289-1304`；对账 `cancelNotification({preserveActive:true})`（`native-reminders.js:776`、`SystemBridgePlugin.java:1125-1126`）**刻意保留**正在响的投递；`app-items.js:330-346` 只 `queueNativeReminderSync("delete")` 撤未来排程。
- **期望 vs 实际**: 期望删除即止响；实际继续响到用户「停止声振」或 `AUTO_SILENCE_MS` 自动静音。
- **影响面**: 删除/修改正在响的事项时。**有兜底**（活动闹钟面板停止、完成、自动静音），故非幽灵闹钟而是体验瑕疵。**建议**: 删除/编辑正在响的 id 时额外触发一次「停止投递」；验证 HC-T5-8（真机）——**本轮真机未执行，未新增复现，代码仍在**。

#### P1-⑧ A-2 Android 上重提醒计数偏少
- **违反条款**: 状态可见性（P1-⑧ 新功能初衷）
- **证据**: `app-views.js:32` `realertProgress` 读 `it.remindCount`；该值只在**前台 tick** 递增（`app-alerts.js:249 markReminded`）；Android 后台追提醒由 LocalNotifications 送达、**不回写** `remindCount`。
- **期望 vs 实际**: 期望「第 N/M 次」与真实次数一致；实际被连环催 3 次仍显示「第 1/4 次」。
- **影响面**: Android 重要/关键档用户。**建议**: 取 `max(remindCount, 当前轮 reminderEvents 中已过点的键数)`。**真机复核（HC-T5-7/HC-T3-4）本轮未执行**；旁证：HC-T5-4 重启用例中首页「重提醒中（第 1/4 次）」与 `reminderEvents` 3 条 scheduled 对应、`remindCount=1` 与首响一致（`hc-t5-4-home-after.png`），未见矛盾但也未覆盖「后台追提醒多轮」场景。

#### P1-⑨ B-3 普通通知载体无接收证据，强停后仍可能静默丢失（遗留）
- **违反条款**: INV-09 / 补投语义一致性
- **证据**: `markLostReminders` 只认 attempt 0 闹钟载体（`native-reminders.js:229`）；普通通知无原生接收证据 → `scheduled` 过点按规则不补投（`:471`）。
- **期望 vs 实际**: 期望普通档强停后也能告知/补投；实际静默停在「待定」（第二轮的遗留项）。
- **影响面**: 普通档事项在强停/关机场景。**建议**: 给通知载体补接收回执，或产品上显式接受该限制并记录。

#### P1-⑩ 跨版本导入的失败提示不友好，且拒收机制与预期不符（T10-2）
- **违反条款**: INV-09 兼容面；提示文案可用性
- **复现（Node）**: `oldBackup.validateBackupPayload(payloadWithLost, 5)` → `ok:false, code="unknown-key", path="items[0].reminderEvents[\"x@lost\"].lostAt"`。
- **期望 vs 实际**: 期望提示指向「版本差异/请先升级应用」；实际走通用兜底 `导入失败：备份格式不正确（items[0].reminderEvents["x@lost"].lostAt）`（内部字段路径），且拒绝触发点是**新增键 `lostAt`**（不是任务书预期的「旧版只认 4 种 state」）。
- **证据**: `lib/app-backup.js:153-155`（工作区版新增 `lostAt/lostReason`/`lost`）、`:772-783`（`importFailureMessage`）；HEAD 提交版 `REMINDER_EVENT_STATES` 仅 4 项。旧备份→新版方向实测兼容。
- **影响面**: 新版备份导入旧版/未升级客户端的用户（单方向）。**建议**: `importFailureMessage` 增「疑似版本差异」分支；发布前确认 `lost` 改动已提交。

#### P1-⑪ 无深色模式，夜间整屏亮色（首轮 P1-⑦）
- **违反条款**: T8-Web HC-T8-3（夜间可用性）
- **证据**: `setEmulatedMedia{prefers-color-scheme:dark}` 下 `body`/`#app` 背景仍 `rgb(244,243,239)`、文字 `rgb(20,24,29)`；样式表 268 条规则中 `prefers-color-scheme` **命中 0**；截图 `t8-3-01-dark-home.png`。**真机亦 FAIL**：设备深色态下 `prefersDark=true` 而 `bodyBg=rgb(244,243,239)`（`health-evidence-2026-10-15/T5/t8-device-new-package.json`）。
- **影响面**: OLED 夜间/睡前使用刺眼（全屏闹钟本身已深色 `#111829`，问题在 App 主界面与 Web 应用内横幅）。
- **注**: 首轮 P1-⑦ 与 T8-Web P1-② 均定 P1（与本汇总线索的 P2 归并不同，以各线报告为准）。

### P2（体验瑕疵/一致性/可维护性）

| 编号 | 一句话标题 | 违反条款 | 复现 / 期望 vs 实际 | 证据 | 影响面 |
|---|---|---|---|---|---|
| P2-① | 无截止倒计时（合并：T7 HC-T7-3 ❌ / 首轮 P2-⑪） | 首轮 P2-⑪；HC-T7-3 | 截止临近只有静态「截止 X月X日」；期望「还剩多久」 | `lib/app-views.js:89,178`；`lib/app-views.js` 无「还剩/剩余/倒计时」 | 所有含 deadline 用户 |
| P2-② | 触控目标 <44px（合并：T8 HC-T8-4 / 首轮 P2-⑫ / 二轮 A-7） | 移动可达性 HC-T8-4 | 390 宽可见按钮 25 个，<44px **11 个**：修改/删除 50×36、开关轨道 46×28、分段项 157×40 | `buttons-measured.json`；`t8-4-01-me-buttons.png` | 慌乱中误触（含全屏闹钟） |
| P2-③ | 关键控件缺 ARIA 语义（合并：T8 HC-T8-5 / 首轮 P2-⑬） | HC-T8-5 | 8 个开关全无 `role=switch`/`aria-checked`；`#toast` 无 `aria-live`；18 个面板无 `role=dialog` | 实测（面板焦点管理 ✅）；**真机同样 `toastAriaLive=null`、`role=dialog`=0**（`T5/t8-device-new-package.json`） | 屏幕阅读器用户（TalkBack 无法播报保存结果） |
| P2-④ | 未来页残留内部术语（合并：T8 P2-⑤ / 二轮 A-3） | 面向用户文案 | 可见「Future 默认不占据首页。默认隐藏 ≠ 不允许查看。」 | `t8-6-01-future-terms.png`；`future-innerText.txt` | 所有用户 |
| P2-⑤ | 「相似提醒」仍默认折叠在「更多选项」内（合并：T2 P2-① + T8 P2-⑥ / 首轮 P2-⑩） | AC-16 / §13 | 默认 `#capAdvanced hidden`，`#similarHint` 有内容却被折叠；展开后才可见 | `index.html:1383/1446`、`app-capture.js:222`；`t2-4-01/02-similar.png` | 重复录入用户 |
| P2-⑥ | 低置信选择框自然输入命中率≈0（合并：T2 P2-② + T8 P2-⑦） | D15 | 20 条自然口语 `(low ∧ 具体时间词)` 命中 **0**；仅构造输入（`每月5日后付款`等）可弹 | `t2-lowconf-candidates.json`、`t2-3-01-lowconf.png` | 「含具体时间词但解析失败」用户；分支活着但极少弹（T2 原判「疑似死分支」经浏览器复核降为「极低频」） |
| P2-⑦ | 拒绝通知权限后不引导站点设置（合并：T9 P2-① + T8 P2-⑧） | INV-06 体验面 | 已拒绝态再点开关 → toast「通知权限未授予，将使用应用内提醒」，无「去站点设置允许」引导 | `lib/app-events.js:616-621`；`t9-3-01-notify-denied.png` | 先点过「阻止」的 Web 用户 |
| P2-⑧ | Web 首页无「关页不提醒」常驻告知（合并：T9 P2-② + T8 HC-T9-1 首页） | §473 / INV-06 | 纯 Web 首页 `#homeNotice=""`；只有保存 toast 与「我的」两处提到 | `lib/app-notices.js:71`（非原生 `return null`）、`:122-133` | Web 新用户第一屏 |
| P2-⑨ | 幽灵闹钟：清台账后已删事项照样响（首轮 P2-⑯） | INV-09；严格按 §5「删了还响」属 P0 类，因触发路径罕见历史定级 P2 | JS 对账只撤 `settings.scheduledAlarmIds`，原生 `PREFS_SCHEDULES` 另有持久计划；清 localStorage/换设备时 `prev=[]`→不撤任何原生闹钟，重启 `restorePersistedAlarms` 还可能重新武装 | `lib/native-reminders.js:740-779`；`SystemBridgePlugin.persistAlarm/restorePersistedAlarms` | 清数据/跨设备恢复用户；**真机复核待做**（需 `pm clear`/卸载同意；注：HC-T5-4 观察到重启恢复对**过期残留**排程正确判 `alarmExpiredMissed` 不响，属相邻路径的正确行为，不覆盖本项） |
| P2-⑩ | IndexedDB 不可用时降级「有时不告知」 | INV-06 / §305 持久化面 | 无 IDB 但有 localStorage → `status:"loaded", reason:"authoritative"`，无任何降级提示 | `lib/app-persistence.js:47,153,159-160`；`/tmp/t10-check.js` G 段 | 禁用 IDB 的浏览器/隐私模式 |
| P2-⑪ | 既无 IDB 又无 localStorage（memory 后端）静默运行，刷新即丢（接近 P0/P1） | INV-09 / §305 | 环境无 `indexedDB`+`localStorage` → `backend="memory"`、`writesAllowed:true`、无提示 | `lib/storage.js:119`；`/tmp/t10-check.js` G 段 Case C | storage 被完全禁用的极少数环境，后果为静默数据丢失 |
| P2-⑫ | 缺 `original_capture` 字段（A12） | §5.1、§13、A12 | `normalizeItem` 无该字段，全仓库 grep 零命中 | `lib/app-model.js:35-57` | 改过内容后无法回溯原文 |
| P2-⑬ | 优先级词「很重要/紧急/必须」不识别、正文残留（A-4） | 与 §1.3/D-01 一致（不自动升级），仅标题噪声 | #66/67/68 → 标题保留「重要：」「紧急！」；`priority` 未变 | 语料矩阵；grep 无识别代码 | 自然口语用户 |
| P2-⑭ | 无日期的节日/硬截止词不产出时间 | INV-01（保守正确） | 中秋/国庆/元旦/春节→`low`；「报名结束前」硬词但无日期→deadline 恒空 | 语料矩阵 #24-28、#43 | 覆盖面缺口（保守行为） |
| P2-⑮ | 标题/输入噪声 | 文案 | 残留「本/早上/明年」；「请」被停用词误删致「提交申」；无效输入未拒（13月5日、32号、25:30）；「礼拜五」不识别 | 语料矩阵 #6/16/18/37 等 | 录入标题质量 |
| P2-⑯ | 底层动作守卫只做一半（仅 UI 门控跨状态/终态调用） | INV-03/§7 守卫一致性 | 直接调 `reopen(archived)`→snoozed、`restore(waiting)`→waiting、`stopRepeat(非周期项)`→archived | `lib/app-items.js:401,432,726` | 普通用户不可达；后续新增调用面时有绕过风险 |
| P2-⑰ | 「提前 N 天」未优先于默认 p24/p2（两者叠加） | §10:391 | `parseChineseTime` 无 lead 字段透传；默认 p24/p2 无条件生效 | `lib/native-reminders.js:93,531`；探针 E5 | 显式「提前 N 天」用户；方向与 INV-10 一致 |
| P2-⑱ | 截止逾期>24h 无 `DEADLINE_PASSED` 风险状态与「已逾期」标识 | §10:397、验收 E6 | 逾期>24h → `deadlineStage` 返 `null`、保护**静默停止**；卡片仍显示「截止 X月X日」 | `grep DEADLINE_PASSED lib/` 无命中；`lib/reminder.js:104`；探针 E6 | 含 deadline 到期未完成用户（**推测**：export-format 的 deadline_status 是否同一概念未逐字比对） |
| P2-⑲ | 第二处闹钟排程实现未先查精确权限 | 可维护性 | `SystemBridgePlugin.scheduleAlarmInternal` 直接 `am.setAlarmClock` 并吞异常，未预检 `canScheduleExactAlarms` | `SystemBridgePlugin.java:1198-1220` vs `AlarmScheduler.java:98,113` | 功能等价；轨迹台账少一条、两端重复维护 |
| P2-⑳ | 36 组合矩阵未覆盖新增台账态 | 可维护性 | 矩阵维度不含 `lost`/`suppressed` | `test-regressions.js:2212-2222` | 并发矩阵不与新增态联合验证 |
| P2-㉑ | 400 上限存在「过点仍在册被裁掉」边界 | INV-09/INV-10 | 无永久饥饿；仅在 >400 条临近且被裁项触发点已过时按规则不补投 | `lib/native-reminders.js:1127-1130` | 需 >400 条临近提醒才触发 |
| P2-㉒ | lint 门禁仍为红（10 Error/55 Warning） | 工程门禁（§4 已知） | `./gradlew lintDebug`→`BUILD FAILED`；**实测 10 条（非二轮记录的 11 条）**，逐条复核均误报或刻意 | `lint-results-debug.txt`；`SystemBridgePlugin.java:709-727`、`DeliveryEvidenceStore.java:109`、`AlarmActivity.java:217/606` | 全体开发者/CI；淹没未来真实告警 |
| P2-㉓ | versionCode 未随「渠道 v5+台账新增 lost」升级（仍为 4） | 发布一致性 | `build.gradle:10` `versionCode 4`/`versionName "1.3"` 不变 | `android/app/build.gradle:10-11`；`AlarmTestReceiver.java:40`；`native-reminders.js:181` | 侧载无法区分新版本；与含 `lost` 备份向前兼容问题叠加 |
| P2-㉔ | targetSdk 34→36 前瞻回归：预测性返回不再走 `onBackPressed` | 前瞻（**推测**，未实机） | targetSdk ≥35 时系统改走 `OnBackInvokedCallback`，全屏「关闭」出口 `onBackPressed` 失效 | `AlarmActivity.java:605-609`（全工程唯一覆盖） | 未来升级 targetSdk 时；当前 34 未触发 |
| P2-㉕ | acceptance-cases.md 覆盖列自 2026-09-16 起未再基线化 | 文档一致性 | §3–§12 为 9-16 口径，§15–§17 新增回归与 `lost`/提醒设置改动未回写 | `acceptance-cases.md:7` | 交接/验收可能误判覆盖缺口 |
| P2-㉖ | versionCode 未升致真机安装弹「相同版本」确认框（真机实测；与 P2-㉓ 同源） | 发布一致性 | `adb install -r` debug 包（versionCode 4 / versionName 1.3）覆盖已装同版本包时，vivo 弹「已安装相同版本 1.3」对话框，需用户手动点「重新安装」才 `Success`；前两次尝试还因锁屏被拒 `INSTALL_FAILED_ABORTED` | `docs/reviews/health-evidence-2026-10-15/T5/install-attempt.log`；health-T5-device 装包过程 | 分发/侧载用户；把 P2-㉓ 从推断变成现实可见问题 |

### T6 / T7 / T9 通过或低风险项（未列入上表）

- **T6 线 20/20 通过**（D1–D16 + HC-T6-1..4，均 Web 模拟）：INV-02、INV-08、AC-06–09 无违反，**无新增缺陷**。
- **T7 线**：HC-T7-1（AC-10）、HC-T7-2（N-08）、E2、E7 ✅；E3（缺 3 天/1 天保护点）属§10.1「数值可参数化」的**刻意取舍，不算缺陷**。
- **T9 线**：HC-T9-1（P0）✅；离线/通知三态/SW 更新经 T8-Web 真实浏览器复核 ✅。
- **T4 附注**：首轮并行执行 6 套件时 `test-native-reminders` 曾 356/3，随后 8 次复跑均 359/0——**无法复现，不作缺陷上报**，建议关注时序依赖。

---

## 二、§4 已知问题逐条状态

| 来源 | 编号 | 问题 | 本轮状态 | 依据/证据 |
|---|---|---|---|---|
| 首轮 | P0-① | 渠道被带声模板抢先创建→双响 | **代码已修 + 有测试 + ✅ 真机已验证闭环（HC-T5-0）** | 渠道只由 `AlarmTestReceiver.ensureAlarmChannel` 按 D59 建并删 v3/v4（`AlarmTestReceiver.java:40,58`）；通用模板只建 `attention-bridge-v2`（`SystemBridgePlugin.java:64,698-705`）；`test-native-reminders.js:685-687` 断言 v5 通过。**真机实测**：新包排程触发后 v5 `mSound=null`/`mVibrationEnabled=false`、v4 `mDeleted=true`、v3 不存在（`T5/hc-t5-0-new-package-channels.txt`）；注意渠道**惰性创建**，仅启动 App 不建 v5，须经排程（`scheduleAlarmInternal→ensureChannel()`）触发 |
| 首轮 | P0-② | `scheduled`+已过点永久卡死 | **代码已修 + 有测试 + ✅ 真机已验证闭环（HC-T5-3/HC-T5-4）；⚠️ `lost` 改动仍未提交** | `lost` 态 + 补投（`native-reminders.js:181-183,193-235,478-481`）；`lostAt` 保存保证只判一次（`coordinator:252-256`）；T1 变异 M3/M5 证明有牙齿。**真机实测**：强停后重开 `catchUp` 仅 1 次、身份=原触发点（`T5/hc-t5-3-result.txt`）；重启后原时刻精确重排、息屏锁屏 +962ms 单次单路投递（`T5/hc-t5-4-*`）。**T10 复核**：HEAD 提交版无 `lost`，工作区才有 → 未提交 |
| 首轮 | P1-⑦ | 无深色模式 | **仍存在（真机亦 FAIL）** | T8-Web P1-②；样式表 0 条 `prefers-color-scheme`；真机深色态 `prefersDark=true` 而 `bodyBg=rgb(244,243,239)`（`T5/t8-device-new-package.json`） |
| 首轮 | P2-⑩ | 相似提示折叠 | **仍存在** | T8-Web P2-⑥（合并 T2 P2-①） |
| 首轮 | P2-⑪ | 无倒计时 | **仍存在** | T7 HC-T7-3 ❌ |
| 首轮 | P2-⑫ | 触控目标偏小 | **仍存在**（11 个 <44px） | T8-Web HC-T8-4 |
| 首轮 | P2-⑬ | 无障碍缺口 | **仍存在（真机同样 FAIL）** | T8-Web HC-T8-5（面板焦点管理 ✅ 一项）；真机 `#toast` 无 `aria-live`、`role=dialog`=0（`T5/t8-device-new-package.json`） |
| 首轮 | P2-⑯ | 幽灵闹钟 | **仍存在** | T10 HC-T10-3 复核确认；真机端到端复核未做（需 `pm clear`/卸载同意）。旁注：HC-T5-4 重启恢复对过期残留排程正确判 `alarmExpiredMissed` 不响不补，属相邻路径正确行为，不覆盖本项 |
| 首轮 | P2-⑰ | DND「总沉默」边界未说明 | **未验证**（机制代码层 ✅，产品内文案未复核） | T4 HC-T4-6（机制：普通延后/重要关键穿透/Review 服从勿扰 ✅） |
| 二轮 | A-1 | 窄屏面板上移/下半屏空白 | **仍存在**（=本轮 P0-①；真机**结构复现**、可见上移两流程未复现） | T8-Web：`scrollHeight` 恒 1680；`#app` 窄屏无 `overflow:hidden`；真机 360×742 下 `sh=1476`、`overflow=visible`、`scrollTo` 生效（`T5/t8-device-new-package.json`） |
| 二轮 | A-2 | Android 重提醒计数偏少 | **仍存在**（真机计数链 HC-T5-7/HC-T3-4 本轮未执行） | T3 复核：后台追提醒不回写 `remindCount`；HC-T5-4 旁证 `remindCount=1` 与首响一致、未见矛盾但未覆盖多轮追提醒（`T5/hc-t5-4-home-after.png`） |
| 二轮 | A-3 | 内部术语外露 | **仍存在** | T8-Web P2-⑤ |
| 二轮 | A-4 | 「很重要」不识别 | **仍存在** | T2 P2-④ |
| 二轮 | A-5 | 记录面板时间信息重复 | **未验证**（本轮无任何线复核） | — |
| 二轮 | A-6 | 删除确认按钮非危险色 | **未验证**（本轮无任何线复核配色） | — |
| 二轮 | A-7 | 次级「修改/删除」按钮 36px | **仍存在**（T8 量得 50×36 <44px） | T8-Web HC-T8-4 |
| 二轮 | A-8 | 删除正在响铃事项不止响 | **仍存在**（有兜底；真机 HC-T5-8 未执行，未新增复现） | T4 P1-①（=`P1-⑦`） |
| 二轮 | B-2 | 非精确闹钟「无证据判丢失」误判→重复提醒 | **仍存在**（=本轮 P0-②；T4 定级 P0-①；本测试机有精确权限，真机未触发） | T4：`native-reminders.js:183,221,229,231`；HC-T5-1..4 全程 `flags=3`、每次仅一条 `ringStarted` 无双投 |
| 二轮 | B-3 | 普通通知载体无接收证据，强停后仍可能静默丢失 | **遗留/仍存在** | T4 §4 |
| 二轮 | lint | 11 个 Error（核实均为误报/刻意），门禁红 | **仍存在；实测为 10 条（非 11 条）** | T1：`lint-results-debug.txt`（10 errors/55 warnings） |
| 二轮 | 上线清单⑷ | 升 versionCode 4→5 | **未做**（真机安装已实测弹「已安装相同版本 1.3」确认框，见 P2-㉖） | T1 P2-T1-2：`build.gradle:10` 仍为 4；`T5/install-attempt.log` |

---

## 三、真机结果（T5 投递/可靠性/重启 + T8 真机 WebView）

> 设备：vivo V2238A（`10ACBF2D3D000RS`）· Android 16（API 36）· 无锁屏密码（用户确认）。被测包：debug 包 versionCode=4 / versionName=1.3（含渠道 v5 与 `lost` 改动的工作区构建）。证据目录 `docs/reviews/health-evidence-2026-10-15/T5/`（24 件）。线报告：`health-T5-device-2026-10-15.md`、`health-T5-reboot-2026-10-16.md`。**全程未修改产品代码、未 git 提交。**

### 装包过程（如实记录）

- 前两次 `adb install -r` 因锁屏被系统拒 `INSTALL_FAILED_ABORTED`；用户确认设备无锁屏密码后，主机侧 `adb shell input keyevent KEYCODE_WAKEUP` + `wm dismiss-keyguard` 解锁再装。
- vivo 弹出「**已安装相同版本 1.3**」确认对话框（因 versionCode 未升），用户点「重新安装」后返回 `Success`；`lastUpdateTime` 刷新为 2026-10-16 14:25:45，versionCode 仍为 4 → 已收录 P2-㉖。证据：`T5/install-attempt.log`、`T5/device-info.txt`。

### T5 主用例结果（计划 14 → 执行 5，全部 ✅ PASS）

| ID | 用例 | 结果 | 关键实测值与证据 |
|---|---|---|---|
| HC-T5-0 | 新包渠道只剩 v5 无声无振、v3/v4 已删 | ✅ | 渠道**惰性创建**（仅 `AlarmTestReceiver.ensureAlarmChannel`，唯一入口 `SystemBridgePlugin.scheduleAlarmInternal→ensureChannel()`，`AlarmTestReceiver.java:572`、`SystemBridgePlugin.java:1152/698-706`）——只启动 App 不建 v5；broadcast 不通（receiver `exported=false`），改用 WebView CDP 调 `startAlarmTraceTest` 排程触发：v5 `mSound=null`/`mVibrationEnabled=false`/`mDeleted=false`，v4 `mDeleted=true`（软删除记录属 Android 正常行为），v3 不存在 → **首轮 P0-① 真机闭环**（`hc-t5-0-new-package-channels.txt`） |
| HC-T5-1 | 到点延迟 <1s | ✅ | 亮屏 10s/60s/120s 三点：**16/141/198 ms**；**息屏+锁屏首响 285 ms**（走系统全屏意图 `fsi+direct`）（`hc-t5-1-alarm-trace.json`、`hc-t5-1-screenoff.txt`） |
| HC-T5-2 | 单路响铃不双响 | ✅ | 每次投递仅一条 `ringStarted`，声音只来自 AlarmRingService（v5 渠道静音），未复现双响（`hc-t5-2-single-ring.txt`） |
| HC-T5-3 | 强停后补投只补一次 | ✅ | `am force-stop`→过点 >10min 再打开：`catchUp` 仅 **1 次**、身份仍为原触发点 `0@1792132870000`、`remindCount=1`，首页出现告知横幅 → **首轮 P0-② 补投语义真机闭环**（`hc-t5-3-setup.txt`、`hc-t5-3-result.txt`、`t5-3-home-after-redelivery.png`） |
| HC-T5-4 | 重启后恢复/补投（⚠️已获用户同意 reboot） | ✅ | 重启前排程 now+7min；`adb reboot` 15:04:47→`sys.boot_completed` 15:05:39（**约 52s**）；进程 15:05:57 由 **LOCKED_BOOT_COMPLETED** 广播拉起（`LocalNotificationRestoreReceiver`），15:06:14-15 以**原触发时刻 flags=3** 精确重排（无需打开 App），随后进程被正常回收、闹钟留在 AlarmManager；**息屏+锁屏**到点 15:11:22.429 `path=fsi+direct fullScreen=true` 投递，`Displayed .AlarmActivity +670ms`——plannedAt→received **+962ms**、计划到全屏可见约 **2.75s**；token 恰 3 事件、无 `ringDuplicateStart`、`state=delivered`、`remindCount=1`（**单次单路**）→ **首轮 P0-② 重启恢复真机闭环**。附注：昨日过期残留排程被正确判 `alarmExpiredMissed` 不响不补（相邻路径正确行为，不覆盖 P2-⑨ 幽灵闹钟场景）；开机 0–35s 窄窗口未覆盖（`hc-t5-4-setup.txt`、`hc-t5-4-boot-restore.txt`、`hc-t5-4-alarm-after-boot.txt`、`hc-t5-4-delivery.txt`、`hc-t5-4-trace.json`、`hc-t5-4-readback.json`、`hc-t5-4-lockscreen-delivery.png`、`hc-t5-4-home-after.png`） |

### T8 真机 WebView 结果（6 项）

| ID | 用例 | 结果 | 关键实测值与证据 |
|---|---|---|---|
| HC-T8-1 | 窄屏整页上移（真机） | ⚠️ **结构复现 / 可见症状未复现** | 360×742 CSS px（dpr=3）：`scrollHeight=1476`（≈2× 视口）、`#app overflow=visible`、`window.scrollTo(0,323)` 生效；键盘弹起 `ih=433`/`sh=861` 同为 ~2×。但 capture+软键盘、detail 两条流程下 `#app top=0`、`scrollY=0`，**未见可见上移**（旧包首连时另观测 `scrollY=693`）。T5 建议以真机为准重估严重度，本汇总维持 P0 并收窄触发面（`t8-device-new-package.json`、`t8-dev-01/02/03-*.png`） |
| HC-T8-2 | 软键盘遮挡（真机 `input tap` 唤键盘） | ✅ | 面板/输入框完整可见（`t8-dev-02-keyboard-up.png`） |
| HC-T8-3 | 深色模式（真机） | ❌ FAIL | 设备深色态 `prefersDark=true` 而 `bodyBg=rgb(244,243,239)`（=P1-⑪） |
| HC-T8-4 | 触控目标（真机） | ⏭ 引用 web 报告 | 见 P2-② |
| HC-T8-5 | 无障碍（真机） | ⚠️ 部分 FAIL | `#toast` 无 `aria-live`、`role=dialog`=0（=P2-③） |
| HC-T8-6 | 文案（真机） | ⏭ 引用 web 报告 | 见 P2-④ |

### 未覆盖项（剩余真机待办，多为破坏性/需用户系统设置操作）

| 来源 | 用例 | 前置/需同意 |
|---|---|---|
| T5 | HC-T5-5 撤销→重授精确闹钟权限（降级如实显示 D67+自动重排）；HC-T5-6 关闭通知权限告知条；HC-T5-10 系统勿扰穿透（P2-⑰）；HC-T5-13 vivo 电量后台开关矩阵 | 用户在系统设置手动操作 |
| T5 | HC-T5-7 重提醒链两轮计数一致（验证 P1-⑧/A-2）；HC-T5-8 删除正在响事项止响（验证 P1-⑦/A-8）；HC-T5-9 全屏四出口 D12；HC-T5-12 通话中到点让位 | 装新包（已装），无破坏性 |
| T5 | HC-T5-11 改时区/系统时间重算与「已错过浮出」 | ⚠️同意改时间/时区 |
| T4 | B-2 Doze 实际延迟确认（**关精确权限**+深睡）——P0-② 触发条件 (a) 的真机验证仍缺 | 用户撤销权限 |
| T10 | HC-T10-3 幽灵闹钟端到端（排闹钟→JS 删除→清 localStorage→过点是否仍响）；F4 改时区重算 | ⚠️同意 `pm clear` |
| T6/T7 | HC-T6-1 真机投递一次；HC-T7-1 p24/p2 真机复测 | 装新包 |
| T5 附 | 开机后 0–35s 窄窗口内到点的恢复路径（HC-T5-4 未覆盖） | 需卡重启时机 |

---

## 四、修复顺序建议（结合严重度与改动成本）

1. **立即（P0，低成本高收益）**
   - **HC-T8-1 / P0-①**：`#app{overflow:hidden}` 移出 `@media(min-width:480px)` 至基础样式（1 行 CSS）+ 收起态 `.sheet` 改 `display:none`；面板关闭补 `scrollTo(0,0)`。真机已确证结构撑高与程序化滚动通道（可见上移仅桌面模拟复现），修复方向不变、改动最小。
   - **B-2 / P0-②**：`LOST_NO_EVIDENCE_AFTER_MS` 按 `canScheduleExactAlarms` 分流；补投时同时撤销该键原生闹钟。防「响两次」。（真机侧因本测试机有精确权限未触发，Doze 确认列入「未覆盖项」。）
2. **紧接着（P1，高价值/中低成本）**
   - **T2 五条解析**（P1-①②③④⑤）：周期分支与首期分支互斥、正则增补「最后/一刻/三刻/半」、裸钟点 +12 消歧、低置信不落 deadline——集中一次改 `lib/parse-cn.js` + `app-capture.js`，附语料断言。
   - **P1-⑧ A-2 计数**：取 `max(remindCount, 本轮已过点键数)`（复用台账）。
   - **P1-⑥ AC-05 待整理入口**：提醒动作集加 `review`（复用 `reviewConfirm`）。
   - **P1-⑩ 跨版本导入提示**：`importFailureMessage` 增「疑似版本差异」分支。
   - **P1-⑪ 深色模式**：全站 `prefers-color-scheme` + 4 档 token。
3. **随后（P1 遗留）**：**P1-⑦ A-8** 删除/编辑正在响→触发停止投递；**P1-⑨ B-3** 通知载体补回执或显式接受限制。
4. **P2 成批清理**：lint 清零（10 条，一次性 `@RequiresApi`/`SDK_INT`/`OnBackPressedCallback`/`View.VISIBLE`）→ versionCode 4→5 → 触控/无障碍/倒计时/相似提示前置/内部术语 → 幽灵闹钟（P2-⑨）→ DND 说明（P2-⑰）。
5. **发布前必做**：**提交 `lost` 台账改动**（当前仍未提交——真机验证所用为工作区构建，改动不落库则线上无此修复）；升 versionCode 4→5（真机安装已实测弹「已安装相同版本 1.3」确认框，P2-㉖ 佐证其必要性）。**真机核心回归已完成**：HC-T5-0..4 全过、首轮两项 P0 真机闭环，无需再整批重跑；剩余仅「三、未覆盖项」表中的权限开关/改时间时区/`pm clear`/卸载类破坏性用例与 HC-T5-7..9/12、T4 Doze、T6/T7 各一次，另行安排。

---

## 五、推测 vs 有证据的结论

**有证据的结论（可复现/已实测）**
- HC-T8-1 **结构部分**（`scrollHeight`=1680、`scrollTo` 生效、`.sheet` 撑高）：T8-Web 真实浏览器实测 + 截图；**真机 WebView 亦结构复现**（360×742 下 `sh=1476`、`overflow=visible`、`scrollTo` 生效，`T5/t8-device-new-package.json`）。
- **真机实测（T5，vivo V2238A / Android 16）**：HC-T5-0 渠道 v5 无声无振/v4 已删/v3 不存在；HC-T5-1 延迟 16/141/198ms、息屏锁屏 285ms；HC-T5-2 单路 `ringStarted`；HC-T5-3 `catchUp` 仅 1 次；HC-T5-4 重启后原时刻 flags=3 精确重排、+962ms 投递、单次单路；装包弹「相同版本」框（`T5/install-attempt.log`）。首轮 P0-①/② 闭环属此类。
- T2 五条解析错误、`npm test` 15/15 与断言数、lint 10 条、importFailure 实测拒收、幽灵闹钟机理、A-8 撤销范围、B-2 判据单一阈值。

**推测（须标注、未获真机/端到端确证）**
- **B-2** 的真机 Doze 延迟时长与触发频率（代码级结论；本测试机**有精确权限**、真机未触发，Doze 实测需撤销权限后另做——见「未覆盖项」）。
- **P0-① 的「可见整体上移」**：桌面模拟复现（`t8-1-06-forced-shift-simulated.png`）、真机 capture+键盘/detail 两流程**未复现**；触发面按真机收窄为「任何程序化滚动发生即整屏位移」。
- **P2-㉔ targetSdk 前瞻回归**（未实机升级验证）。
- **P2-⑱** `export-format` 的 `deadline_status` 是否即 §10 所指 `DEADLINE_PASSED`（未逐字比对）。
- **P2-⑥** 低置信弹层「自然命中率≈0」基于 20 条样本（实测 0 命中，样本有限）。
- T6 **D5**「通知直达会话」仅代码路径、无 DOM 点击单测。
- T1「第二轮『冒烟 942』实为 `test-boot-combination` 的 942」——T1 标为推测。
- **P2-⑨ 幽灵闹钟**真机端到端未做（需 `pm clear`/卸载同意）；机理为代码级确证。

**不列为缺陷的刻意取舍（§1.3）**
- 未来事项默认隐藏、首页无「即将到来」列表；不替用户判优先级；不做任务管理/番茄钟/统计；
- 「我知道了≠完成」、完成可撤销、新建 8 秒撤销；全屏「关闭」只止响不表态（D12/D58）；
- 关机期间错过的闹钟不集中补响（记漏响台账告知）；
- T7 E3「缺 3 天/1 天保护点」= §10.1 明示「数值可参数化」的取舍。
- 亦可能属取舍但需产品书面确认者：**P2-⑰（显式提前 N 天叠加而非覆盖默认保护）**。

---

## 附：证据索引

- 各线报告：`docs/reviews/health-T1..T10-*.md`（均 2026-10-15）+ **`health-T5-device-2026-10-15.md`** + **`health-T5-reboot-2026-10-16.md`**
- 浏览器实测证据目录：`docs/reviews/health-evidence-2026-10-15/T8/`（含 `t8-1-06-forced-shift-simulated.png`、`t8-3-01-dark-home.png`、`t8-4-01-me-buttons.png`、`t8-6-01-future-terms.png`、`t2-3-01-lowconf.png`、`t2-4-*.png`、`buttons-measured.json`、`t2-lowconf-candidates.json`）
- **真机证据目录**：`docs/reviews/health-evidence-2026-10-15/T5/`（24 件：`device-info.txt`、`install-attempt.log`、`hc-t5-0-new/old-package-channels.txt`、`hc-t5-1-alarm-trace.json`、`hc-t5-1-screenoff.txt`、`hc-t5-2-single-ring.txt`、`hc-t5-3-setup/result.txt`、`t5-3-home-after-redelivery.png`、`hc-t5-4-setup/boot-restore/alarm-after-boot/delivery.txt`、`hc-t5-4-trace/readback.json`、`hc-t5-4-lockscreen-delivery.png`、`hc-t5-4-home-after.png`、`t8-device-new-package.json`、`t8-device-cdp.json`、`t8-dev-01/02/03-*.png`）
- 关键代码位置：`index.html:67`、`lib/parse-cn.js:143-150,193-205,216-228,282-295`、`lib/app-capture.js:222,564,619-622`、`lib/app-alerts.js:160-164,249,282-300`、`lib/native-reminders.js:79,86,181-235,448-518,740-779,1127-1130`、`lib/app-native-coordinator.js:252-256,611,624`、`lib/app-persistence.js:47,153-160`、`lib/storage.js:119`、`android/.../AlarmScheduler.java:98,112-115,149-157,229-233,248-269`、`SystemBridgePlugin.java:64,698-728,1198-1220,1289-1304`、`AlarmTestReceiver.java:40,58`、`android/app/build.gradle:10-11`
- 复现命令：`node /tmp/t10-check.js`（T10）、`node /tmp/health-t6t7-probe.js`（T6/T7）、`npm test`、`cd android && ./gradlew assembleDebug lintDebug`；浏览器脚本 `/tmp/health-t8/*.mjs`（未入库）
