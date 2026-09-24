# 根对象守卫 fail-closed 返工报告（实施方自测，**不是**独立验收）

- run：`20260921T0535-guard-fail-closed`
- 起因：第三次独立复验（`20260921T050350-independent-alias-recheck`）判 **FAIL / FIX_REQUIRED**。
  阻断点 F02-R2：扫描器把「模块对象存在」误当成「成员可选」—— 在真实调用
  `feedbackApi ? feedbackApi.setupSteps(...)` 上只把成员名换成未声明成员，结果仍是
  `undeclared=[] problems=[]`。根因是 `isGuardedRef()` 把 `Ns ?` / `Ns &&`
  （只短路了命名空间根本身）当成了成员存在性守卫。
- 修复路线（复验报告 §4 给出，逐条执行）：区分**模块守卫**与**成员守卫**，
  对被根守卫遮住的成员逐个处置，补两条永久反例 + 一条成员守卫对照，不扩展到 P2/P3，不构建 APK。

---

## 1. 改了什么

### ① `isGuardedRef()`：只认成员级守卫（production-scripts.js）

签名从 `(line, ns, ref)` 收成 `(line, ref)`，**删掉「根对象后跟 `&&`/`||`/`?` 即豁免」那一行**。
保留的三种豁免形态都**检查成员本身**：`if (… Ns.m …)`、`Ns.m && / || / ?`、`!Ns.m`。

为什么这是对的：扫描范围内每个命名空间根（`DatePrimitives` / `UiFormat` / `AppUi` /
`Feedback` / `DeliveryEvidence` / `NativeReminders` / `AttentionLib`）**本身就是必需声明**，
启动闸门已经保证它存在 ⇒ 那个 `?` / `&&` 永远走真分支，成员缺失时照样 `undefined(...)`。
所以根对象兜底要么是无效防御，要么该显式检查成员。

### ② 被根守卫遮住的 6 个成员：逐个处置（app-core.js）

| 成员 | 旧形态 | 处置 |
| --- | --- | --- |
| `Feedback.actionSpec` / `setupSteps` / `testFeedbackVerdict`、`DeliveryEvidence.entryRoundBase` | 根守卫下调用，**已在声明表** | 现在进入 `refs` 参与闭合判定（不再凭守卫豁免） |
| `Feedback.TEST_FEEDBACK` | `feedbackApi ? feedbackApi.TEST_FEEDBACK : [...]` | **新声明**（object）—— 缺了会静默退回硬编码数组 |
| `Feedback.UNDO_WINDOW_MS` | `(FeedbackLib && FeedbackLib.UNDO_WINDOW_MS) || 8000` | **新声明**（number）—— 缺了会静默把撤销窗口退回 8000 |

声明表 **71 → 73 条**。为此把静态扫描读表的类型取值从 `function|object` 扩到
`function|object|number|string|boolean`（与运行时闸门的 `typeof got !== want` 一致；
`UNDO_WINDOW_MS` 是声明表里第一条非 function/object 条目，硬写成 `"object"` 会让闸门误报）。

### ③ 永久反向测试（两个脚本各一套，都用 `options.source` / `overrides`，不动工作区源码）

| 编号 | 注入 | 必须发生 |
| --- | --- | --- |
| MUT-D | 真实位置 `feedbackApi ? feedbackApi.setupSteps(...)` ⇒ 成员换成 `independentGuardedMember` | 进 `undeclared` + `problems` 点名，**不**进 `guardedRefs` |
| MUT-E | 真实位置 `FeedbackLib ? FeedbackLib.actionSpec("ack")` ⇒ 同样换成员 | 同样变红（证明该缺口与别名解析无关） |
| 对照 | `if (FeedbackLib.independentOptionalMember) return …` | 仍进 `guardedRefs`（证明没把可选能力误判成必需） |
| N3 | 把「根对象守卫」加回扫描器（临时副本 + 末尾同名函数覆盖） | MUT-D / MUT-E **不再被报出来** ⇒ 正向断言不是恒真的；同时无守卫路径照样能抓（变异是外科手术式的） |
| ⑩（运行时） | `overrides` 把 `lib/feedback.js` 的 `UNDO_WINDOW_MS` / `TEST_FEEDBACK` 改成 `undefined`，真启动一次 | `ready=false`、闸门逐条点名、`puts=0 / schedule=0 / scheduleAlarm=0 / 无心跳` |

N3 的做法说明：函数声明产生的是**可写绑定**，模块内 `isGuardedRef` 只在运行时被
`runtimeDependencyCoverage()` 调用，所以在副本末尾追加一个同名函数即可覆盖；
副本写到 `os.tmpdir()` 再 `require`，工作区文件与 require 缓存都不动。

---

## 2. 原样复现独立方反例（`evidence/guard-coverage.json`）

同一处真实调用、同一处替换（`setupSteps` ⇒ `independentGuardedMember`）：

| | 修复前（旧扫描器口径） | 修复后（当前工作区） |
| --- | --- | --- |
| `undeclared` | `[]` | `[{path:"Feedback.independentGuardedMember", lines:[6637]}]` |
| `problems` | `[]` | `["undeclared-dependency:Feedback.independentGuardedMember（app-core.js:6637）"]` |
| `guardedRefs` | 含该成员（19 条） | 不含（12 条，全是真·成员守卫） |

（直接命名空间形态同向：`FeedbackLib ? FeedbackLib.independentGuardedMember("ack")` ⇒
`undeclared=[{…lines:[2175]}]`。）

探针第 3 段把「根对象守卫」加回扫描器、跑**同一份**变异源码，又得到
`undeclared=[] problems=[]` —— 与独立复验量到的 FAIL 形态逐字一致。
这条对照说明：变红是这次修复带来的，不是碰巧；也说明独立方的复现步骤是忠实的。

`guardedRefs` 现状：12 条，全部是 `NativeReminders.*` 的成员级守卫，且全部已在声明表里
（`if (NativeReminders.reconcile)` 这类形态）—— 没有「实际必需却只靠守卫兜底」的残留。

---

## 3. 本轮水位（实测）

| 套件 | 通过 | 失败 |
| --- | --- | --- |
| test-unit | 411 | 0 |
| test-native-reminders | 321 | 0 |
| test-boot-combination | **272**（上轮 261） | 0 |
| test-smoke | 256 | 0 |
| test-regressions | 730 | 0 |
| parse-single-source | **154**（上轮 149） | 0 |
| **合计** | **2144**（上轮 2128） | **0** |

`npm test` 退出码 **0**。UI 对照 **567 PASS / 590 PASS**。
真实浏览器（Chrome + CDP，IDB 副作用计量）**6 用例 0 失败、退出码 0**：
control `ready=True opens=1 puts=1`，五个故障场景全部 `ready=False opens=0 puts=0` + 可见面板。

---

## 4. 仍然没做的（不因本轮而改变）

- 整体拆分剩余阶段：P2 剩余（AI / 备份 / 诊断 / 引导 / 内容视图 / 表单、逐功能拆 `bind()`）、P3、P4。
- 离线升级实测、打包链逐字节比对、APK、实机验收（排钟 / 锁屏 / 冷进程 / SAF）——**全部未做**，
  本轮**没有**构建 APK，任何实机项仍是 NOT_PERFORMED。
- 这是**实施方自测**（同机同人），**不能替代第四次独立复验**，不得视为通过。
- 改动**未提交未推送**：HEAD `3574824` == `origin/main`，工作区 91 条未提交/未跟踪。
  交付身份见 `evidence/source-hashes.txt`（工作区字节；`app-core.js` 400,477 字节）。
  ⚠️ 复验方**不要**用 `git checkout -- <file>` / `git stash` 还原现场，会把交付物抹成基线且不可恢复。

---

## 5. 复算入口

```bash
cd /Users/qlyf/Developer/reminder

# 1) 六套测试（2144 项）
npm test

# 2) UI 两个对照（567 / 590）
node scripts/verification/ui-format-parity.js
node scripts/verification/ui-dom-parity.js

# 3) 守卫覆盖探针：修复后矩阵 + 独立反例复现 + 旧扫描器对照（本报告 §2 的原始输出）
node docs/reviews/verification-runs/20260921T0535-guard-fail-closed/evidence/guard-coverage-probe.js

# 4) 真实浏览器六个故障场景（需要 Chrome，约 15 s）
BROWSER_CHECK_OUT=/tmp/attention-browser-recovery \
  /usr/bin/python3 scripts/verification/browser-recovery-check.py

# 5) MUT-D / MUT-E / 对照 / N3 / ⑩ 都在套件里，随 npm test 一起跑；
#    只想看这一段：node test-boot-combination.js 2>&1 | grep -E "MUT-D|MUT-E|N3|UNDO_WINDOW"
```

## 6. 证据文件清单（`evidence/`）

| 文件 | 内容 |
| --- | --- |
| `npm-test.log` | 六套测试全量日志 + 退出码 0 |
| `ui-format-parity.log` / `ui-dom-parity.log` | 567 / 590 PASS |
| `browser-recovery-command.log` / `browser-recovery.json` / `browser-recovery-percase.log` / `chrome.log` | Chrome 六用例 + IDB 副作用计量 |
| `guard-coverage-probe.js` / `.log` / `guard-coverage.json` | 修复后矩阵、独立反例复现、旧扫描器对照、6 个迁移成员的归属 |
| `repo-state.txt` | HEAD / 分支 / 与 origin/main 关系 / 脏条目数 |
| `source-hashes.txt` | 交付身份（工作区字节 SHA-256，本轮改动文件已标 `*`） |
