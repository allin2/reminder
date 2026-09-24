# P3-I-R · F2 入口职责逐项归属说明

> 针对独立复验 F2「入口瘦身未收口」的逐条回应。
>
> **2026-09-24 补交**：本文原先写着「所有数字均可由本 run 的脚本复算」，但 §5 只留了一个
> 指向**并不存在**的脚本的占位符 —— 那句话当时是假的。现已补交 `compose-stats.js` 与
> `compose-partition.json`（原始输出 `raw-logs/20-compose-stats.log`），并把复算结果与
> 正文的数字逐项对账，见 **§5**。对账过程中查出**三处需要修正的地方**（§5.2 边界假象、
> §5.3 D/E 成员放错、§4 E-9 漏项），已就地改正并保留原值说明，不回写历史。
>
> 结论预告：§2/§3 的**每一组数字全部复现**（A 22/1389、B 9/295、C 175/429、D 11/31、
> E 37/233、合计 254/2377），因此不是数字造假；修正的是**口径本身**的两处瑕疵，以及
> §4 的一处漏项。

## 0. 先撤回一句过度声明

上一轮 `20260923T1910-p3i-delivery/README.md` 第 47 行写：

> 「`app-core.js` 彻底摆脱具体业务、算法及 DOM 渲染实现」

**这句不成立，予以撤回。** 复验方指出的 `homeNoticeVerdict` / `renderHomeNotice` / `maybeDailySummary`
当时确实还在入口，是有判定分支、有文案、有 DOM 写入的完整实现体，不是转发。

修正后的表述：

> 入口已不持有**可独立归属**的业务判定与渲染实现（首页告知判定 / 首页告知渲染 / 每日摘要 /
> 到期判定 / 角标计数已迁出），但仍持有三类它**必须**持有的东西：① 模块装配与契约校验；
> ② 冷启动闸门与失败呈现；③ 跨模块编排（37 个函数 / 233 行代码，最大单个 47 行）。

---

## 1. 本轮实际迁出了什么（单一来源证明）

| 行为 | 迁出前 | 迁出后归属 | 入口残留 |
|---|---|---|---|
| 首页告知**判定**（4 条分支） | `app-core.js` `homeNoticeVerdict` | `lib/app-notices.js` `homeNoticeVerdict` | 4 行转发 `L2871` |
| 首页告知**渲染**（含 `#homeNotice` DOM 写入） | `app-core.js` `renderHomeNotice` | `lib/app-notices.js` `renderHomeNotice` | 3 行转发 `L2906` |
| 每日摘要 `maybeDailySummary` | `app-core.js` | `lib/app-notices.js` `maybeDailySummary` | 3 行转发 `L3260` |
| 到期判定 `isDue` | `app-core.js` | `lib/app-model.js` `isDue`（纯谓词，吃 `deps.now()`） | 3 行转发 `L2923` |
| 应用角标 `updateAppBadge`（含"不传就数到期条数"的计数语义） | `app-core.js` | `lib/app-platform.js` `updateAppBadge` | 3 行转发 `L3059` |
| 死代码 `readPath` / `renderUpcomingRow` | `app-core.js` | 已删除（全仓零引用） | — |
| 悬挂孤儿注释（O6 首页签名，函数早已迁出，注释留在入口） | `app-core.js` | 已删除（26 行） | — |

新模块 `lib/app-notices.js`：**201 行 / 9,300 字节**，
SHA-256 `2befd9c599ed14cca6b668ccefba51f5c9817624bbd4d6eb54e600c5fc89bca3`
（此值为修复 README §零 所述时钟缺陷**之后**的最终值；出包、五层闭合、日志均以此为准）。
它已按「六处 + 一张表」注册：`index.html` `<script>`、`sw.js` ASSETS + 缓存版本 `attention-inbox-v39`、
`test-smoke.js` 加载列表、`test-regressions.js` `LIB_SOURCES`、`test-boot-combination.js`
`EXPECTED_INDEX_SCRIPTS`、`production-scripts.js` `NAMESPACE_PATHS` + `APP_NOTICES_INSTANCE_CONTRACT`。

## 2. 体量变化（可复算）

| 指标 | P3-I 交付 | P3-I-R（本轮） | 差值 |
|---|---|---|---|
| `app-core.js` 行数 | 3,971 | **3,922** | −49 |
| `app-core.js` 字节 | 195,751 | **193,538** | −2,213 |
| 顶层 `function` / `async function` | 255 | **254** | −1 |
| `app-core.js` SHA-256 | `2eaadab7…` | **`bc689c765e37623f9636ab072472307986a8ff56956e6a6c5977ad47b71de4fe`** | — |

> 关于「顶层函数从 237 涨到 255」：这不是"越拆越多"，而是**迁出实现后入口保留了命名转发面**——
> 每个迁出的行为都要留一个同名的转发，供 `lib/app-test-api.js`、`lib/app-views.js` 等以依赖形式注入回去。
> 计数口径见 §5。本轮净减 1（迁出 5 个实现体、新增 `noticesRuntimeDeps` 1 个装配函数、删死代码若干）。

## 3. 入口当前构成（254 个顶层函数）

分类互斥；脚本与对账见 §5。下表把**原稿值**与**脚本复算值（两套边界）**并排放，便于逐格核对：

| 类别 | 个数 | 代码行（原稿） | 复算·报告口径 | 复算·花括号收口 | 性质 |
|---|---|---|---|---|---|
| **A 装配与依赖注入** | 22 | 1,389 | 1,389 ✓ | 1,338 | 装配 21 个模块实例、fail-closed 校验契约、给每个模块注入取值函数 |
| **B 启动闸门与失败呈现** | 9 | 295 | 295 ✓ | 265 | 冷启动权威状态保护、失败面板、全局错误钩 |
| **C 实例方法薄转发** | 175 | 429 | 429 ✓ | 426 | `return appXxx.method(...)` 形态，平均 2.4 行 |
| **D 纯函数模块转发** | 11 | 31 | 33 | 31 | 11 支 `lib/ui-format.js` 转发（`uid`/`pad`/`fmtTime`/`fmtDate`/`relDue`/`escapeHtml`/`escapeAttr`/`toLocalInput`/`parseLocalInput`/`dayLabel`/`renderMarkdown`） |
| **E 仍留在入口的实现体** | **37** | **233** | 231 | 231 | 见 §4 逐项说明 |
| **合计** | **254** | **2,377** | **2,377** ✓ | **2,291** | — |

A+B 两类（原稿口径 1,684 行 / 71%；收口口径 1,603 行 / 70.0%）是**模块化之后入口的本职**：
没有别的地方可以放"把 21 个模块装起来并校验契约"这件事——放进任一模块都会让它反向依赖其余 20 个。

> **两条口径差异的来源（2026-09-24 修正，逐处清单见 §5.3）**
> 1. **函数体边界**：原稿用「从声明行到下一个同类声明的前一行」，会把**夹在函数之间的模块级
>    顶层语句**并进上一个函数。全文件共 **9 处 / 86 行**（最大两处：`RUNTIME_BINDING_PATHS` 46 行
>    并进 `describeGot`、启动钩子 25 行并进 `startApp`）。改用花括号收口后合计从 2,377 落到 2,291。
> 2. **D/E 两个成员放错了**：`renderMarkdown` 是 `lib/ui-format.js` 的纯转发却算在 E，
>    `pad2` 是本地纯函数却算在 D —— 两者正好互换。修正后 D 的 31 行与原稿数字相同，
>    E 由 233 落回 **231**（差的 2 行就是被误并进 `renderMarkdown` 的两条 `let`）。

## 4. E 类逐项归属说明（37 个 / 231 行）

判据沿用本仓既有红线：**归属 = 谁持有行为**。

### E-1 `handleNativeNotificationAction`（47 行，最大单项）

把原生通知动作翻译成**一组跨模块调用**：`openReviewSession` / `snoozeReview` / `skipReviewThisTime`
（整理会话）、`handleAlarmAction`（告警动作链）、`openDetail`（详情）、`hideAlert`、`toast`、`hasKnownRev`。

**为什么不进 `lib/app-native-coordinator.js`**：协调器当前只持有「排程 + 送达证据」的行为，
它的 `REQUIRED_DEPS` 里没有任何 UI 行为。把这个函数塞进去，协调器就要新增 6 个 UI/业务依赖，
依赖方向被反转（协调器 → UI）。新建一个「通知动作路由」模块则不减少任何行为、只是换个位置放，
还要再付一次「六处 + 一张表」的注册面。

**结论**：这是真正的**入口编排**，不是被漏掉的业务。是否要为它单开模块并显式接受「路由模块持有 UI 行为」，
需要裁决（见 §6 待裁决 Q1）。

### E-2 `applyParsedState`（18）/ `wrapUserOp`（12）

导入/外部输入落到 `state`，并统一包一层用户操作语义（失败提示 + 撤销边界）。
它横跨 `app-persistence` / `app-transaction` / 撤销三个模块，且必须在三者之前存在——
放进任一模块都会让另外两个反向依赖它。

### E-3 `setUserMode`（10）/ `setNativeReminderStatus`（8）

单一字段写入 + 触发 `save()` + 触发原生同步。这两个字段的**写入权**目前没有任何模块持有
（`app-model` 是纯谓词，`app-platform` 只持有宿主能力）。迁出等于新建一个"字段写入"模块。

### E-4 `writeIfChanged`（7）—— O6 单写入者

被**三方共用**：入口、`lib/app-setup.js`、`lib/app-review.js`（两者都以依赖形式注入）。
它是"某容器内容与上次逐字节相同时不写 DOM"的唯一实现。迁到任一模块，另外两方就要反向依赖那个模块。

### E-5 `renderHome`（6）/ `render`（5）

P2-F2 定下来的分工：**核心显式完成业务推进**（`promoteDue()` → `renderSetupEntry()` →
`renderHomeNotice()`），**展示实例只渲染首页 DOM**。这 6 行就是那个"推进"的清单本身，
搬进 `app-views` 会让 views 反过来驱动业务推进。

### E-6 `detailReminderStatusRow`（11）—— 下一个候选

把原生排程状态翻译成详情弹窗里的一行 HTML。它被 `lib/app-views.js` 当成依赖注入
（`app-views` 的 `need` 列表里明确有 `detailReminderStatusRow`）。
内容语义属于"送达证据"，与 `lib/delivery-evidence.js` 相邻。**这是下一轮最干净的迁出候选**（见 §6 Q2）。

### E-7 四~六行的编排残片（10 项 / 45 行）

`renderPwaStatus`(6) / `isAttentionDue`(5) / `isNativeAndroidRuntime`(5) / `bind`(5) /
`feedbackActionSpec`(4) / `labCancelAlarms`(4) / `describeAlarmDelivery`(4) /
`openSystemSetting`(4) / `openBackgroundGuide`(4) / `bindSetupReviewControls`(4)。

> **原稿这里写着 `renderMarkdown`(5)，是放错了**：它是 `lib/ui-format.js` 的**纯转发**
> （`return UiFormat.renderMarkdown(src)`），属于 D 类，不是入口实现体。它之所以被算进 E，
> 是因为「到下一个声明的前一行」这个边界把它**后面**的两条模块级 `let`（`PROJECT_COLORS` /
> `state`）并了进来，码行从 3 涨到 5、刚好越过 ≤4 这条线。详见 §5.2 / §5.3。
> 同段原稿写的「共约 117 行」也对不上（该项实为 109 行），已按实际拆分重写。

逐项迁出的收益（4–6 行）**低于**新增注册面 + 契约表 + 覆盖面断言的成本，也低于回归风险。
本轮不做，如实列出。

### E-8 三行的转发残片（17 项 / 51 行）

`deadlineStageKeyOf` / `inQuietHours` / `quietEnd` / `runAiOnCapture` / `saveAiSettings` /
`testAiConnection` / `refreshNotifyLab` / `labLog` / `bindDiagnostics` / `pad2` /
`stopPolling` / `exportData` / `importDataFile` / `buildLegacyBackupPayload` / `registerPwa` /
`bindInstall` / `bindNetwork`。

它们与 E-7 的区别是：**不是**对 `app*` 实例的 `return` 转发（因此没进 C 类），而是
① 走非 `app` 前缀实例（`diagnostics` / `NativeReminders` / `ai` / `backup`），形态为
`if (!ns) return <兜底>; return ns.x();`；或 ② 无返回值（`if (ns) ns.x();`）；
或 ③ 本地纯函数（`pad2`）。逐项迁出的 3 行收益同样低于新增注册面的成本。

> 注：`pad2` 是本地纯函数而不是模块转发，原稿把它算在 D 类、`renderMarkdown` 算在 E 类，
> 两者**正好互换**了。修正后的 D = 11 支 `lib/ui-format.js` 转发 / 31 行（数字与原稿相同）。

### E-9 `openSnoozeSheet`（11 行）—— **原稿漏登，本轮补上**

原稿的 37 项 E 里**有它**，但逐项说明里**没有它**，属于真漏。它是 E 类里 ≥7 行的长实现体之一
（共 8 个，清单见 `compose-stats.js` 的「长实现体」段），必须逐项给出所有权理由：

```js
function openSnoozeSheet(id) {
  if (isItemActionPending(id)) { rejectPendingItemCommand(); return false; }  // 事务侧命令闸门
  state.ui.snoozeId = id;                                                     // 直接写入口的 UI 状态
  snoozePick = null;                                                          // 重置入口私有选取
  snoozeBasis = "elapsed";                                                    // 重置入口私有的基准
  if ($("#snoozeCustom")) $("#snoozeCustom").value = "";                      // DOM 写入
  $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));            // DOM 写入
  closeSheet("sheetDetail"); openSheet("sheetSnooze");                        // 弹层切换
  return true;
}
```

**为什么留在入口**：它同时碰四样东西 —— 事务侧的待办命令闸门、入口持有的 `state.ui`、
入口私有的 `snoozePick` / `snoozeBasis`，以及 DOM。迁进 `lib/app-capture.js`（表单与弹层能力）
会让它反向依赖 `state` 与事务闸门；迁进 `lib/app-items.js` 则要它反向依赖 DOM 与弹层。
**判定：暂留，并登记为下一轮迁出候选**（与 E-6 `detailReminderStatusRow` 同级），取舍见 §6 Q4。

## 5. 复算方式

### 5.1 怎么复算（可执行）

```bash
export PATH="$HOME/.nvm/versions/node/v20.17.0/bin:$PATH"   # 本仓套件要求 Node 20.x
node docs/reviews/verification-runs/20260923T2336-p3ir-delivery/compose-stats.js
```

- 脚本：`compose-stats.js`（本 run 内，自包含，只读仓库根的 `app-core.js`）
- 落盘：`compose-partition.json`（254 个顶层函数逐个给出类别 + 码行数 + 起始行）
- 原始输出：`raw-logs/20-compose-stats.log`（退出码 0；`raw-logs/exit-codes.txt` 第三轮段）

脚本自带 6 项自检（**有牙齿**）：合成的「纯转发」必须落 C、合成的「实现体」必须落 E，
以及 A/B/D 三张名单必须逐一在源码中存在且互不重叠。任一项不成立即以 `✗` 开头并退出 1。

### 5.2 对账结果：原稿的每一组数字都复现了

| 类 | §3 原稿 | 脚本（报告口径，naive 边界） | 对账 |
|---|---|---|---|
| A | 22 / 1,389 | 22 / 1,389 | **MATCH** |
| B | 9 / 295 | 9 / 295 | **MATCH** |
| C | 175 / 429 | 175 / 429 | **MATCH** |
| D | 11 / 31 | 11 / 33 | 差 2 行 |
| E | 37 / 233 | 37 / 231 | 差 2 行 |
| **合计** | **254 / 2,377** | **254 / 2,377** | **MATCH** |

**结论：原稿的数字不是编的，是真跑出来的。** 上一轮的问题只是**脚本没有随 run 留存**，
导致「所有数字均可由本 run 的脚本复算」这句在当时为假。D/E 各差 2 行来自下面这条边界瑕疵。

### 5.3 边界瑕疵：86 行模块级语句被并进了函数体（9 处）

原口径「函数体 = 从声明行到**下一个同类声明的前一行**」会把**夹在函数之间的模块级顶层语句**
算进上一个函数。全文件共 9 处、86 行，逐处清单在 `raw-logs/20-compose-stats.log`：

| 被并进的函数 | 行数 | 实际是 |
|---|---|---|
| `describeGot` | 46 | `const RUNTIME_BINDING_PATHS = [...]`（运行期绑定路径表） |
| `startApp` | 25 | DOMContentLoaded 钩子 + `appTestApi` 组装 + `})();` 收尾 |
| `runtimeRoots` | 5 | `const RUNTIME_ROOT_PREFIX = {...}` |
| `startBusinessStartup` | 3 | `readyPromise` / `lastStartupFailure` / `initStarted` |
| `renderStartupFailure` | 2 | `restoreRetryInFlight` / `stateRecoveryPanelShown` |
| `renderMarkdown` | 2 | `PROJECT_COLORS` / `state` ← **就是 D/E 差的那 2 行** |
| `homeNoticeVerdict` | 1 | `const lastWrittenHtml = new WeakMap()` |
| `lastCompleteUndo` | 1 | `undoNativeCheckPending` |
| `handleQueryActions` | 1 | `globalErrorHandlerInstalled` |

改用**花括号收口**（真实边界）后：A **1,338** / B **265** / C **426** / D **31** / E **231**，合计 **2,291**。
A+B = 1,603 行 / **70.0%** —— 与 §3 的「约七成」结论一致，不改变任何判断。

### 5.4 修正后的 E 类：37 项 / 231 行（逐项可核）

| 分组 | 项数 | 行数 |
|---|---|---|
| E-1 `handleNativeNotificationAction` | 1 | 47 |
| E-2 `applyParsedState` / `wrapUserOp` | 2 | 30 |
| E-3 `setUserMode` / `setNativeReminderStatus` | 2 | 18 |
| E-4 `writeIfChanged` | 1 | 7 |
| E-5 `renderHome` / `render` | 2 | 11 |
| E-6 `detailReminderStatusRow` | 1 | 11 |
| E-7 四~六行编排残片 | 10 | 45 |
| E-8 三行转发残片 | 17 | 51 |
| E-9 `openSnoozeSheet` | 1 | 11 |
| **合计** | **37** | **231** |

其中 **≥7 行的「长实现体」共 8 个**：`handleNativeNotificationAction`(47) / `applyParsedState`(18) /
`wrapUserOp`(12) / `openSnoozeSheet`(11) / `detailReminderStatusRow`(11) / `setUserMode`(10) /
`setNativeReminderStatus`(8) / `writeIfChanged`(7)。**这 8 个是本表存在的理由** —— 其余 29 项
都是 3–6 行。E-9 是本轮补上的第 8 个。

## 6. 待裁决（不擅自实现）

- **Q1**：是否为 `handleNativeNotificationAction` 单开一个「通知动作路由」模块，
  并显式接受它持有 6 个 UI 行为依赖？（本轮判断：不开，理由见 E-1）
- **Q2**：下一轮是否把 `detailReminderStatusRow` 迁到 `lib/delivery-evidence.js` 或 `app-views`？
  （本轮判断：是下一个最干净的目标，但需要一次独立的六处注册 + 覆盖面断言）
- **Q3**：175 个薄转发是否要收敛成一张声明式的转发表（自动挂载、减少 429 行）？
  收益明确，但会改变 `lib/app-test-api.js` 的注入形态，属于结构性改动，需先裁决。
- **Q4**（2026-09-24 新增）：`openSnoozeSheet`（11 行，见 E-9）是迁出还是留？
  迁出要选一个持有「事务命令闸门 + `state.ui` + 弹层」的宿主，目前没有这样的模块；
  若判定迁出，建议与 Q2 的 `detailReminderStatusRow` 合并成一次「UI 编排迁出」小批次。
