---
doc: requirements-clarification
created: 2026-09-16
scope: 本地 main (c040ed9) 与 origin/main (dafd7ed) 代码对齐
status: resolved
resolution: 2026-09-16 两项决议已结清 ——
  ① 以远程为准（本地 main 已 reset 到 dafd7ed，差距 0/0）；
  ② 全部冲突项已裁决，见 docs/decisions/interaction-logic-2026-09-16.md
---

# 安心收件箱 · 需求澄清

> 目的：在读完全部本地与远程代码后，把「这个程序到底要做什么」写清楚，并把代码里已经
> 偏离/超越产品文档的地方单独列出来，交给你裁决。本文不是新的需求，是对现有需求的收敛。
>
> **本文已完成使命**：所列 C1–C9 与 I1–I9 全部结清，裁决记录见
> [`docs/decisions/interaction-logic-2026-09-16.md`](./decisions/interaction-logic-2026-09-16.md)。
> 代码现状描述见 [`docs/product-logic.md`](./product-logic.md)。

---

## 0. 一句话定义

**本地优先的注意力唤醒与未来事项托管系统。**

用户把「未来某时需要重新关注」的事情交给系统托管，系统在合适的时间把它重新交还到用户
注意力里，并确认用户**真的看到了**。它管的是「何时重新进入注意力」，不是「任务怎么执行」。

> 少记挂，不错过 / Remember less. Miss nothing.

需求唯一来源：`prd.html`（Attention Inbox PRD V0.1，37 节）。

---

## 1. 仓库事实（先对齐事实，再谈需求）

| 项 | 值 |
|---|---|
| 远程 | `https://github.com/allin2/reminder.git` |
| 本地 `main` | ~~`c040ed9`，9 个提交的完整历史~~ → **已同步为 `dafd7ed`** |
| `origin/main` | `dafd7ed`，**单个根提交**（`git rev-list --count` = 1） |
| 关系 | 远程是一次 **force-push 抹平历史**：reflog 记录 `c040ed9 -> dafd7ed (forced update)` |
| 内容对比 | 远程是本地内容的**超集**，本地无内容丢失。除 `gradlew.bat`(92/92 换行)、`lib/native-reminders.js`(87/34 改写) 外，其余均为纯新增 |
| worktree | `.worktrees/android-capacitor` 仍指向 `c040ed9`（未同步，作为旧线保留） |

**结论**：远程只保留了最终快照，丢掉了逐提交可追溯性；两条线的差异是「远程多了一整块 Android
全屏闹钟 + 延迟澄清工作」。

### 已裁决（2026-09-16）

以远程为准。本地 `main` 已 `git reset --hard origin/main` 至 `dafd7ed`，`rev-list --left-right --count`
得到 `0 0`。旧 9 提交未丢失，保留在两处：

- 标签 `archive/local-main-20260916-c040ed9`
- 分支 `android-capacitor`（`c040ed9`）

**推论**：C1 / C2 的结论是「**保留远程行为**」，因此要修订的是**产品文档**而不是回退代码 ——
`README.md:148`、`docs/compose/spec/android-native-reminders.md` 的 ANR-07，以及 PRD 的
P3 / §17。这三处目前仍写着与代码相反的话。

---

## 2. 产品需求（规范性摘要）

### 2.1 五条不可违背的产品原则

| # | 原则 | 含义 | 红线 |
|---|---|---|---|
| P1 | Attention ≠ Task | 只管「何时重新进入注意力」 | 不得演化为 Todoist/TickTick |
| P2 | Acknowledged ≠ Completed | 「我知道了」≠「我完成了」 | 只有主动「完成」才归档 |
| P3 | **Future 默认不可见** | 未来事项存在也不提前消耗注意力 | 未来事项默认不上首页 |
| P4 | 通知送达 ≠ 用户看到 | 发送/显示/解锁/点击/打开都不算看到 | 只有主动「我知道了」才算 ACK |
| P5 | 低交互优先 | 管理注意力的工具不能成为新的负担 | 提高操作成本的默认不加 |

### 2.2 需求条目与实现状态

| ID | 需求 | 实现位置 | 状态 |
|---|---|---|---|
| R1 | Capture ≤ 5 秒：一句话 + 自动保存，默认无需二次确认 | `app-core.js` 录入链路 | 已实现 |
| R2 | 时间解析三档：高→直接存；中→存并展示；低→极简选择 | `lib/parse-cn.js` | 本地已实现；**远程改了行为，见 C3** |
| R3 | 状态机 CAPTURED→WAITING→DELIVERED→(OPENED)→ACKNOWLEDGED↔SNOOZED→COMPLETED→ARCHIVED | `app-core.js` + `test-smoke.js` 主路径 | 已实现（ACK 不自动完成有单测守护） |
| R4 | 首页只有两视觉：「现在需要注意」+ 弱化「已看到未完成 · N」 | `index.html#view-home` | 本地符合；**远程加了三、四视觉，见 C1** |
| R5 | Future 默认不占首页，但可主动查看 | `view-future` 托管中 / 月历 | 已实现 |
| R6 | 提醒三档：普通（1 次）/ 重要（30min×4）/ 关键（15min×8） | `lib/reminder.js` + `lib/native-reminders.js` | 已实现并有单测 |
| R7 | Deadline Protection：已 ACK 未完成，临近截止可再次唤醒 | 解析 + 状态机 | 已实现 |
| R8 | 周期提醒：日历基准 / ACK 基准两种 | `lib/repeat.js` | 已实现（含月底、第 N 个星期 X） |
| R9 | 勿扰与场景过滤（睡眠/会议延后，重要仍提醒，关键不受影响） | `lib/reminder.js` + settings | 已实现 |
| R10 | Local-first：离线全链路可用，不强制账号 | `lib/storage.js`（IDB + localStorage 回退） | 已实现 |
| R11 | 可靠性：杀进程 / 重启 / 更新 / 时区 / 权限撤销 / Snooze 重排 / DB 异常 | Capacitor 官方插件 + 对账层 | Web/原生已实现，**真机未验证** |
| R12 | Badge = 当前需要确认的注意力数（不是总数） | `setBadge(dueList.length)` | 已实现 |
| R13 | AI 隐形：只做理解，不对话不推荐；BYOK，失败回退本地解析 | 设置页 + 回退链路 | 已实现 |
| R14 | 硬约束：核心提醒不得因 App 未运行而失效 | Android `AlarmManager` 排程 | 架构已满足，**真机未验证** |

### 2.3 MVP 边界

- **必须**：手机 App、Local-first、极速 Capture、时间解析、Now/Future/已看到未完成/Archive、
  普通/重要提醒、ACK/Snooze/Complete、Deadline Protection、周期提醒、Share Sheet、上下文保存、
  搜索、基础勿扰、Badge、重启恢复、基础真机可靠性测试。
- **不做**：云同步/账号/多设备/桌面端/浏览器扩展（Phase 2）；事件触发（Phase 3）；
  Project/子任务/看板/甘特/四象限/自动优先级/完整日历；AI 判断「该做什么」；效率评分/打卡。

### 2.4 需求判断标准（后续任何新增都要过这三问）

1. 是否帮助用户更放心地忘记未来？
2. 是否降低 Attention Management 的操作成本？
3. 是否让产品更像 Todo App？（是 → 默认拒绝）

---

## 3. 本地代码实现盘点

| 文件 | 行数 | 职责 |
|---|---|---|
| `index.html` | 1408 | App UI + 样式（含全部 sheet 面板） |
| `app-core.js` | 3106 | 核心编排：状态、生命周期、渲染、事件 |
| `lib/parse-cn.js` | — | 中文自然语言时间解析（UMD） |
| `lib/repeat.js` | — | 周期规则 |
| `lib/reminder.js` | — | 勿扰 / 柔性窗口 / 有限重提醒策略 |
| `lib/storage.js` | — | IndexedDB + localStorage 回退与迁移 |
| `lib/native-reminders.js` | — | Android 原生通知投影与对账 |
| `sw.js` / `manifest.json` | — | PWA 离线壳层与安装 |
| `test-unit.js` / `test-native-reminders.js` / `test-smoke.js` | — | 29 / 42 / 55 项 |
| `prd.html` + `styles.css` + `app.js` | 1171 | 产品需求文档页（附属） |
| `docs/compose/spec/` | 4 篇 | 特性规格（均为 delivered） |

**本地验证基线（2026-09-16 实测）**：`npm test` → unit **29/29**、native mock **42/42**、smoke **55/55**，全绿。

**架构约束**：无打包器，多 `<script>` 顺序加载，纯逻辑在 `lib/*` 用 UMD 包装（浏览器挂
`window.AttentionLib`，Node 可 `require`），`app-core.js` 只做 UI/状态编排。

---

## 4. 远程新增（`dafd7ed`）隐含的新需求

远程多出的这块，实质上引入了 6 项产品文档里没有的需求：

| # | 新需求 | 证据 |
|---|---|---|
| N1 | **全屏闹钟**：`setAlarmClock` + 全屏 `AlarmActivity`（循环响铃 + 波形震动 + 亮屏 + 时钟走秒），通知同时带 `setFullScreenIntent` | `SystemBridgePlugin.scheduleAlarm/scheduleAt`、`AlarmTestReceiver`、`AlarmActivity` |
| N2 | **延迟澄清（Deferred Clarification）**：录入一律成功；模糊/无时间/低置信度的事项标记 `NEEDS_REVIEW`，不打断当下 | `detectNeedsReview`、`isVagueContent`、`VAGUE_RE` |
| N3 | **每日批量整理会话**：默认 21:30–23:00，卡片式逐条「确认 / 保存修改 / 删除」，45 分钟跟催 1 次 | `settings.review.*`、`openReviewSession`、`maybeReviewSession` |
| N4 | **首页「即将到来」**：未来 7 天未完成事项按时间排序，最多 6 条 | `showUpcomingOnHome`、`#homeUpcoming` |
| N5 | **提醒能力自检（Notify Lab）**：首次启动自动弹出，诊断权限/精确闹钟/电池白名单，含「立即通知」「10 秒后全屏闹钟」「1 分钟后闹钟」实测按钮 | `maybePromptAndroidNotify`、`refreshNotifyLab`、`sheetNotifyLab` |
| N6 | **随包分发 debug APK**：`releases/安心收件箱-debug.apk`（4.24 MB），`.gitignore` 用 `!releases/*.apk` 放行 | `git ls-tree origin/main` |

数据库 schema 从 3 升到 4（新增 `review_status`、`reviewed_at`、`sourceTitle`、`sourceApp`、
`settings.review`、`settings.onboardDone`），并对老数据自动补 `review_status = "READY"`。

---

## 5. 冲突与缺口（需要裁决）

### C1 🔴 首页展示未来事项 —— 违反 P3 与 §17

`showUpcomingOnHome()` 在首页渲染「未来 7 天未完成事项」。
PRD P3「Future 默认不可见」、§17「首页不显示：所有未来事项」。这是**硬冲突**。

> 二选一：回退该区块，或正式修订 PRD P3 / §17（若修订，需回答 §2.4 三问，尤其第三问）。

### C2 🔴 全屏通知 —— 违反 ANR-07 与 README 明文

`AlarmTestReceiver` 使用 `setFullScreenIntent`，`AlarmActivity` 全屏亮屏响铃。
而 `docs/compose/spec/android-native-reminders.md` ANR-07 与 `README.md:148` 都明写
「**不使用全屏通知**」、「不设置全屏 Intent」。文档与代码互相打脸。

> 若确认要全屏，必须同时：更新 ANR-07 与 README；确认 PRD §13.3「闹钟级提醒属增强能力、
> 不得成为 MVP 硬性依赖」是否被突破。当前实现里**所有**测试闹钟都全屏，未做「关键事项专用」限定。

### C3 🟠 低置信度不再确认 —— 改变 §10 既定行为

PRD §10：低置信度「要求用户进行一次极简选择」。
远程把 `openLowConfSheet` 分支改成直接 `finishSave`，改为事后批量整理。

> 这是**用延迟换即时**的产品取舍，方向与 P5 一致，但需你确认是否正式修订 §10。
> 注意副作用：无时间输入的模糊事项被兜底为 `now + 7 天`，用户可能并不知道自己设了什么。

### C4 🟠 三处 Snooze 时长不一致

| 入口 | 时长 | 来源 |
|---|---|---|
| 全屏闹钟「稍后」 | **10 分钟** | `AlarmActivity` 硬编码 |
| 通知动作「2 小时后」 | **2 小时** | `lib/native-reminders.js` ACTION_TYPE |
| PRD §14 | 30min / 2h / 今晚 / 明天 / 自定义 | `prd.html` |

> 需统一。全屏界面还缺「完成」与「我知道了」，`onBackPressed` 被置空导致用户无法返回。

### C5 🟠 远程特性零文档，README 已失真

`docs/compose/spec/` 的交付惯例要求每个特性有 spec。远程这块（N1–N6）**没有任何 spec 文件**，
且 `README.md` 未同步：仍写「不使用全屏通知」「本次环境未产出 APK」，而仓库里已经躺着 4.24 MB 的
APK、代码里已经在用全屏意图。

### C6 🟡 通道 id 改为 `-v2`，老渠道不复用

`attention-normal` → `attention-normal-v2`（三档全部）。老用户设备上已存在的旧渠道不会被复用，
会出现两套渠道、旧渠道残留原设置。需决定是否补迁移/清理逻辑。

### C7 🟡 二进制 APK 入库

`.gitignore` 原本 `*.apk` 全忽略，远程用 `!releases/*.apk` 放行。4.24 MB 二进制会永久留在
git 历史里，且 debug APK 签名不可用于发布。

### C8 🟡 权限合规风险

新增 `USE_EXACT_ALARM` 与 `USE_FULL_SCREEN_INTENT`。这两个在 Google Play 上属**受限权限**，
仅允许「核心功能即闹钟/日历」或「来电」类应用使用，审核时需说明用途。一个「注意力收件箱」
申请它们有被拒风险。PRD §33 也未把上架纳入 MVP。

### C9 🟡 历史抹平

远程单根提交导致逐提交追溯、bisect、按特性回滚全部失效，与 `docs/compose/spec/` 里
`commits: xxxxxxx..yyyyyyy` 的记录方式不再兼容。

---

## 6. 决策状态（全部结清）

| # | 问题 | 结论 | 对应决议 |
|---|---|---|---|
| 1 | 以哪条线为主线 | ✅ 远程 `dafd7ed`，本地已同步 | — |
| 2 | C1 首页「即将到来」保留还是回退 | ✅ **回退** —— 首页不出现任何未来列表 | D5 |
| 3 | C2 全屏闹钟的适用范围 | ✅ **仅「关键」档，且仅首次**；待整理退回普通通知 | D9 · D19 |
| 4 | C3 延迟澄清是否取代 §10 即时确认 | ✅ **正式取代**，§10 已改写 | D15 |
| 5 | C4 Snooze 三处不一致 | ✅ 快捷入口固定 2 小时；主动入口给六个选项 | D11 |
| 6 | C5 远程特性无 spec | ✅ 已补两份：`android-fullscreen-alarm` · `deferred-clarification` | — |
| 7 | C6 旧渠道 `-v2` 迁移 | ✅ 登记为工程遗留 E5，不在本轮改 | E5 |
| 8 | C7 debug APK 是否继续入库 | ✅ 保留在 `releases/`，README 标明只可侧载 | — |
| 9 | C8 受限权限的商店合规 | ✅ 仅记录风险，不在本轮解决（§33 未把上架纳入 MVP） | — |
| 10 | C9 历史抹平 | ✅ 已用标签 `archive/local-main-20260916-c040ed9` 保留旧线 | — |
| 11 | I1–I9 实现遗留 | ✅ I1/I5/I9 已裁决；其余登记为 E1–E4 | D13 · D11 · E1–E4 |

同步动作只改了 git 引用，**本轮也只改文档，未改动任何代码内容**。
代码落地按决策清单 §八的顺序单独开一轮。
