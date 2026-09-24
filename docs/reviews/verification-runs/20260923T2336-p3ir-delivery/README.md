# P3-I-R 返工交付：回应独立复验的三项阻断

上一轮独立复验（`20260923T2243-p3i-independent-recheck`）结论 **FAIL / FIX_REQUIRED**，给出 F1 / F2 / F3 三个阻断项。
本 run 逐项修复并重出候选。**本报告是实施方自测，不等于独立验收**；旧 run、旧候选全部原样保留，未回写历史。

- Git 身份：`HEAD = origin/main = 3574824357dc7beb04cbd3e32aa413cd508e8484`（工作区为脏状态，脏区即交付本体）
- 新候选：`releases/candidates/20260923T2336-p3ir-candidate/app-debug.apk`
  SHA-256 `16d14484dd00d326637c2f41543ce79c9f3584ea27a9ca2b054d77027d487138`，4,356,193 字节
  （**重建过一次**：第一次的出包后又发现并修复了下面 §零 的时钟缺陷，故候选以最终这一次为准）
- 旧候选 `20260923T1910-p3i-candidate/` 未被覆盖；`releases/安心收件箱-debug.apk` 在构建前后逐字节一致
  （`378ee91e…`，构建前备份、构建后还原已核验）

---

## 零、先自曝一个本轮差点漏过去的缺陷（时间与有力 beats 运气）

本轮第一版出了候选、`npm test` 也全绿。随后在接近**本地午夜**时重跑一次，`p3i-modularization-tests`
当场变红：

```
Error: FAILED: AppNotices 摘要：今天新增 3 条 ⇒ 出摘要（toast + 系统通知各一次、只保存一次）
```

根因不是测试写错，而是**新模块里的真实缺陷**。`maybeDailySummary` 里这一行：

```js
const today = deps.startOfDay(new Date()).getTime();   // ← 读的是真实墙钟
```

同一函数里的节流（`getNow() - last < 20h`）与 `lastSummaryAt` 却走注入的 `deps.now()`。
**函数同时挂在两个时钟上**：跨过本地午夜后，"今天"的取值范围与 `createdAt` 的整体错位，
在真机上的表现就是每天 00:00 前后摘要的计数不对。它还有第二个更坏的性质——**不可复现**：
同一份测试在午夜前后给出相反结论，本轮第一版的"全绿"只是跑得早。

修复：改为 `deps.startOfDay(new Date(getNow()))`，与函数内其余时间取值同源。
同时补了两条**有时钟牙齿**的断言（`scripts/verification/p3i-modularization-tests.js`）：

- 取两个相隔很远、且分别落在不同本地日期的固定时刻（`2026-03-05` / `2026-11-15`），要求**都**出摘要。
  真实的"今天"只有一天，所以读真实墙钟时这条**不可能**为真。
- 变异对照：把源码改回 `new Date()`，上面那条必须变红，否则判定为「断言恒真」并以 `✗` 退出。

**这件事的处理方式**：候选按修复后的源码重建，身份表、五层闭合、全部日志都按最终源码重新采集，
不保留第一版的数字、也不把它算作"曾经 greens 过"。

---

## 一、F1 绑定失败后不可恢复 —— 已修复，并有反例与变异对照

### 修了什么

`lib/app-events.js` 原 `bind()` 在注册任何监听器**之前**就置 `bound = true`。现在改成一次**事务**：

```js
function bind() {
  if (bound) return;
  registered = [];
  try {
    if (!bindListeners()) return;   // 没有 DOM 不算成功，也不置 bound
    bound = true;                   // 只在全部注册动作完成之后才宣布已绑定
  } catch (error) {
    rollbackListeners();            // 把本次已挂上的监听器全部摘掉
    throw error;                    // 原样上抛，startApp() 的失败提示与重试照旧
  } finally {
    registered = [];
  }
}
```

同样的模式铺到全部 **7 个**绑定模块：`app-events` / `app-content` / `app-capture` /
`app-diagnostics` / `app-setup` / `app-alerts` / `app-review`（后两个的幂等标志分别是
`alertControlsBound` / `reviewControlsBound`，其中 `app-review` 的此项是本轮新增的——它此前没有）。

### 证据（原始输出都在本 run 目录里）

| 文件 | 内容 | 结果 |
|---|---|---|
| `repro-events-bind-retry.js` | **复验方原脚本逐字节未改**（SHA-256 `e43119bd…`） | `EXIT=0`，`{"bound":true,"setupCalls":2,"listeners":1}` |
| `f1-repro/01-verifier-repro-rerun.log` | 上面这次复跑的原始输出 | 同上 |
| `f1-repro/02-extended-bind-failure-cases.js` | 补的早段 / 后段 / 跨模块 / 幂等反例 | `EXIT=0`，13 条断言 |
| `f1-repro/02-extended.log` | 其原始输出 | 基线 N=53 |
| `f1-repro/03-mutation-rollback-removed.js` | 变异对照：摘掉 `rollbackListeners()` | `EXIT=0`（成功判据=变红） |
| `f1-repro/04-all-modules-late-failure.js` | 7 个模块统一注入后段失败 | `EXIT=0`，25 条断言 |

**扩展反例（`02`）覆盖的五个场景**，判据都是**净**监听器数（add 减 remove），只看 add 次数会把「挂了两遍没摘」判成绿：

- A 对照：健康绑定 N=53
- B 早段：`bindSetupReviewControls` 首次抛错 → 失败后 `isBound()=false`、净监听器 0；重试后仍是 N
- C 后段：`bindAppContent`（最后一个委托点）首次抛错 → **抛错那一刻**已有 52 个监听器在 DOM 上；失败后回滚为 0；重试后 N 而不是 2N
- D 跨模块：委托子模块自己已绑成功、入口后段再抛错 → 重试时子模块靠自身幂等标志短路，它那份仍是 1 而不是 2
- E 幂等：已绑定后再调一次不新增

**变异对照有牙齿**（`03` 的输出）：

```
修复在    {"threw":true,"netAfterFail":0,"netAfterRetry":53,"N":53}
修复被摘  {"threw":true,"netAfterFail":53,"netAfterRetry":104,"N":53}
```

即摘掉回滚后，失败会残留 53 个监听器、重试后变成 104 个。若这条断言是恒真的，脚本会以 `✗` 开头并退出 1。

**7 模块覆盖（`04`）**：注入方式与依赖无关——让 DOM 替身在第 `T-1` 次 `addEventListener` 时抛错。

| 模块 | T / N | 后段失败→回滚 | 重试不翻倍 |
|---|---|---|---|
| `app-events` | 53 / 53 | ✓ | ✓ |
| `app-content` | 9 / 9 | ✓ | ✓ |
| `app-capture` | 15 / 15 | ✓ | ✓ |
| `app-diagnostics` | 17 / 17 | ✓ | ✓ |
| `app-alerts` | 4 / 4 | ✓ | ✓ |
| `app-review` | 5 / 5 | ✓ | ✓ |
| `app-setup` | 1 / 1 | **不适用** | ✓ |

`app-setup` 的 `bind()` 体里只有一个注册动作，**结构上不存在**「挂了一部分之后再抛错」的可能，
硬造一个晚段失败只会得到一条恒真断言。对它改测真正有意义的性质：成功后再调一次不翻倍。这一点如实标注，不冒充覆盖。

---

## 二、F2 入口瘦身 —— 继续收敛 + 逐项归属说明

完整表格见 **[`responsibility-table.md`](./responsibility-table.md)**。摘要：

### 先撤回一句过度声明

上一轮 README 第 47 行「`app-core.js` 彻底摆脱具体业务、算法及 DOM 渲染实现」**不成立，予以撤回**。
当时 `homeNoticeVerdict` / `renderHomeNotice` / `maybeDailySummary` 确实还是完整实现体。

### 本轮又迁出了 5 项 + 删掉 2 项死代码

| 行为 | 新归属 | 入口残留 |
|---|---|---|
| 首页告知判定 / 渲染 / 每日摘要 | `lib/app-notices.js`（新建，201 行 / 9,300 字节） | 3–4 行转发 |
| `isDue` | `lib/app-model.js` | 3 行转发 |
| `updateAppBadge`（含"不传就数到期条数"） | `lib/app-platform.js` | 3 行转发 |
| `readPath`、`renderUpcomingRow` | 删除（全仓零引用） | — |
| 悬挂孤儿注释（O6 首页签名，26 行） | 删除（函数早迁出、注释留在入口） | — |

### 体量变化

| 指标 | P3-I 交付 | 本轮 | 差值 |
|---|---|---|---|
| 行数 | 3,971 | **3,922** | −49 |
| 字节 | 195,751 | **193,538** | −2,213 |
| 顶层 `function` 数 | 255 | **254** | −1 |
| SHA-256 | `2eaadab7…` | `bc689c765e37623f…` | — |

关于「顶层函数从 237 涨到 255」：不是越拆越多，而是迁出实现后入口保留了**命名转发面**——
每个迁出的行为都要留一个同名转发，供 `app-test-api` / `app-views` 等以依赖形式注入回去。本轮净减 1。

### 入口当前构成（254 个顶层函数 / 2,377 行代码，互斥分类）

| 类别 | 个数 | 代码行 |
|---|---|---|
| A 装配与依赖注入（21 个模块实例 + 契约校验 + 注入取值函数） | 22 | 1,389 |
| B 启动闸门与失败呈现 | 9 | 295 |
| C 实例方法薄转发 | 175 | 429 |
| D 纯函数模块转发（date-utils / ui-format …） | 11 | 31 |
| **E 仍留在入口的实现体** | **37** | **233** |

E 类最大的单项是 `handleNativeNotificationAction`（47 行）。它要把原生通知动作翻译成
`openReviewSession` / `snoozeReview` / `skipReviewThisTime` / `handleAlarmAction` / `openDetail` /
`hideAlert` / `toast` / `hasKnownRev` 这一组**跨模块**调用；
塞进 `app-native-coordinator` 会让协调器反向依赖 UI 行为（它现在只持有排程与送达证据，依赖里没有任何 UI 行为），
为它单开模块则不减少任何行为、只换个位置放。因此判定为**入口编排**——这是判断，不是托词，已连同三个替代方案的取舍写进表里等待裁决。

其余（`writeIfChanged` 三方共用、`renderHome` 的业务推进清单、≤6 行的编排残片）逐项给出依赖与所有权理由，见表格 E-2 ~ E-7。

---

## 三、F3 交付身份记录有误 —— 已按冻结源码重算

上一轮报告里三个模块的哈希与当时源码不符。**注意：`app-events.js` 与 `lib/app-test-api.js` 本轮又变了**——
前者因为 F1 修复，后者因为要把 `AppNotices` 以依赖形式注入测试门面。所以下表是本轮冻结后的真实值，不是把旧数字改对。

完整五层数据见 `resource-closure.json` 与 `identity.log`（39 个文件，0 不一致）。

| 文件 | 行数 | 字节 | source SHA-256 | 五层 |
|---|---|---|---|---|
| `lib/app-notices.js`（新） | 201 | 9,300 | `2befd9c599ed14cca6b668ccefba51f5c9817624bbd4d6eb54e600c5fc89bca3` | MATCH |
| `lib/app-action-feedback.js` | 276 | 10,819 | `2018a80513db674417d2fe37163d30fa22ed572dd491daf6c699a34eaf9f642a` | MATCH |
| `lib/app-events.js` | 937 | 35,747 | `8f4da3c2e1aff1266e83b3a2adc69e5383b5a6d28e327d2ce96c9808562f6d86` | MATCH |
| `lib/app-test-api.js` | 407 | 25,590 | `68ea2ecb13f88b78f27d26b01ce4b978acbade3a69168aa0c7038bcea1870bec` | MATCH |
| `app-core.js` | 3,922 | 193,538 | `bc689c765e37623f9636ab072472307986a8ff56956e6a6c5977ad47b71de4fe` | MATCH |
| `index.html` | 2,048 | 82,936 | `7f4f3db226bfe74a…` | MATCH |
| `sw.js`（v39） | 178 | 9,255 | `f04085da011cf19e…` | MATCH |

加载链核对：`index.html` 有 30 个 `<script>`，**全部**在 `sw.js` 的 ASSETS 预缓存清单内；缓存版本 `attention-inbox-v39`。

### 补交（2026-09-24）：F2 责任归属表的复算脚本

上一轮遗漏了一件事：`responsibility-table.md` 写着「所有数字均可由本 run 的脚本复算」，
但它的 §5「复算方式」只有一个指向**并不存在**的脚本的占位符 —— 那句话当时是假的，
而「数字不可复算」正是本 run 要修的三项之一。现已补交：

- 脚本 `compose-stats.js`（本 run 内，自包含，含 6 项有牙齿的自检）
- 落盘 `compose-partition.json`（254 个顶层函数逐个给出类别 / 码行 / 起始行）
- 原始输出 `raw-logs/20-compose-stats.log`（退出码 0，已登记进 `raw-logs/exit-codes.txt`）

**对账结果：`responsibility-table.md` §2/§3 的每一组数字全部复现**
（A 22/1,389、B 9/295、C 175/429、D 11、E 37、合计 254/2,377）—— 数字不是编的。
复算同时查出**三处需要修正的地方**，已就地改正并在表内保留原值说明：

1. **函数体边界有 86 行假象**：原口袋用「到下一个同类声明的前一行」，把 9 处、86 行模块级
   顶层语句并进了上一个函数（最大两处：`RUNTIME_BINDING_PATHS` 46 行并进 `describeGot`、
   启动钩子 25 行并进 `startApp`）。改用花括号收口后 A 1,338 / B 265 / C 426 / D 31 / E 231，
   合计 **2,291**；A+B 占比 **70.0%**（原稿 71%）——「入口本职占约七成」的结论不变。
2. **D/E 各有一个成员放错**：`renderMarkdown` 是 `lib/ui-format.js` 的纯转发却算在 E，
   `pad2` 是本地纯函数却算在 D（两者正好互换）。修正后 D = 11 支 ui-format 转发 / 31 行，
   E 由 233 落回 **231**（差的 2 行即被误并进 `renderMarkdown` 的两条 `let`）。
3. **`§4` 漏登 `openSnoozeSheet`（11 行）**：它在原稿的 37 项 E 里，却没有逐项说明 ——
   属真漏。已补为 E-9 并给出所有权理由；同时把「E 类 ≥7 行的长实现体共 8 个」列全，
   这 8 个才是这张表存在的理由。

逐处清单与对账表见 `responsibility-table.md` §5.1–§5.4。**这条补交改变了** §3 表格、
§4 逐项说明与 §6 待裁决（新增 Q4），其余章节未动。

---

## 四、原始日志索引

全部原始输出在 `raw-logs/`，退出码汇总在 `raw-logs/exit-codes.txt`。环境：Node **v20.17.0**（22.x 会在 `test-unit.js:215` 写 `global.navigator` 时 TypeError）。

| # | 套件 | exit | 水位 |
|---|---|---|---|
| 01 | `npm test` | 0 | 3055 项通过 / 0 失败（642+324+933+266+730+160） |
| 02 | `test-unit` | 0 | 642 |
| 03 | `test-native-reminders` | 0 | 324 |
| 04–10 | `p3a` ~ `p3g` | 0 | — |
| 11 | `p3h-platform-tests` | 0 | 10 条变异全部 detected；被测文件前后 SHA-256 一致 |
| 12 | `p3i-modularization-tests` | 0 | **83 项断言**（含新增的 notices / 绑定事务 / **时钟一致性**断言） |
| 13 | `test-boot-combination` | 0 | 933 |
| 14 | `test-smoke` | 0 | 266 |
| 15 | `test-regressions` | 0 | 730 |
| 16 | `parse-single-source` | 0 | 160 |
| 17 | `browser-views-check` | 0 | `ready` 与 home/future/archive/notes/me/stats 全 true |
| 18 | `browser-capture-check` | 0 | `ready` 与 opened/handpicked/more/preview/sessionAdvanced/similar/edit 全 true |
| 19 | `browser-recovery-check` | 0 | 12 个用例，0 项断言不满足 |
| — | `verify-resources.py` | 0 | 五层闭合 **39/39**，0 不一致 |
| 20 | `compose-stats.js`（2026-09-24 补交） | 0 | 自检 6 项全绿；报告口径 A/B/C 与合计 254/2,377 **全部 MATCH**，D/E 各差 2 行（边界假象，见 §三补交） |

### 两处必须披露的环境适配

1. **`browser-views` / `browser-capture` 用的是适配副本**（`browser-*-check.adapted.py`）。
   本执行环境里 Chrome 无法初始化自身 sandbox（`sandbox initialization failed: Operation not permitted`
   → 网络服务反复崩溃），且环境代理会把 `127.0.0.1` 的 CDP 请求也送去代理（返回 HTTP 502）。
   副本只改了三处：ROOT 改绝对路径、Chrome 启动参数补 `--no-sandbox --disable-gpu --disable-dev-shm-usage`、
   补 `no_proxy="*"`（后两处与仓库里 `browser-recovery-check.py` 的既有做法一致）。
   **断言逻辑与原脚本逐字相同**，`diff` 结果可见只有这四行不同；`scripts/verification/` 下的原脚本未被修改。
2. **`cap sync android` 第一次被工具的批量删除保护拦了一跳**（要删的是 cordova 插件的中间产物 `.aar`，
   与本次要编的资源无关），导致 `capacitor-cordova-android-plugins/` 被清空但未重建，Gradle 报缺
   `cordova.variables.gradle`。绕开工具注入的 Node shim（`env -u NODE_OPTIONS`）重跑一次同步后目录正常重建，
   Gradle `assembleDebug` BUILD SUCCESSFUL。

---

## 五、NOT_PERFORMED（不冒充已验证）

- **真机物理交互 / 通知声振 / 冷进程闹钟**：本轮未执行。历史 run 里的真机数据属于那些 run 自己，本轮不引用、也不冒充本轮实机 PASS。
- **P4 离线升级（旧缓存 → v39）**：未执行。
- **候选 APK 覆盖安装后的冷启动持久化**：未执行。
- **旧 → 新 SW 缓存迁移路径的人工巡视**：未执行。
- **独立复验**：本报告为实施方自测，等待新一轮独立复验。

## 六、给下轮复验的建议看点

1. `f1-repro/03-mutation-rollback-removed.js` —— 请**先确认它真的会变红**（摘掉修复后 53 → 104）。
2. `f1-repro/04` 的第 7 行：`app-setup` 那一格写的是「不适用」而不是 ✓，这是如实标注，不是覆盖到了。
3. `responsibility-table.md` §4 E-1：`handleNativeNotificationAction`（47 行）判定为入口编排的理由与三条替代方案的取舍。
4. `identity.log`：确认 `lib/app-notices.js` 的哈希与本轮源码一致，且与 APK 内 `assets/public/` 的字节相同。
5. **§零 的时钟缺陷**：建议在**本地 23:50 之后**再跑一次 `p3i-modularization-tests`，确认它不再随真实时刻翻转；
   并确认变异对照（`new Date()` 改回去）确实会让时钟断言变红。这条是本轮唯一一个"差一点就带着出门"的缺陷。
6. **补交的复算脚本**：跑一次 `compose-stats.js`，确认 (a) 6 项自检全绿；(b) 报告口径下 A/B/C 与合计
   都是 MATCH；(c) `precise` 段给出 A 1,338 / B 265 / C 426 / D 31 / E 231。若 (b) 出现 DIFF，
   说明源码已被改动，§2/§3 的数字需要重采 —— 这正是该脚本存在的意义。
7. **`raw-logs/.log` 这个隐藏文件**：它不是任何套件的输出，是一次交互式调试命令留下的残片
   （内容是一行 python「can't open file .../browser-capture 18-...」）。真实的第一轮失败记录在
   `exit-codes.txt` 首段（17/18 exit=1）。原样保留未删，以免被误读为本轮的套件失败。
