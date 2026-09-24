# F01–F03 返工报告（实施方自测，**不是**独立验收）

日期：2026-09-21。run：`20260921T0411-f01f02f03-rework`。
上游：独立复验 [../20260921T033332-independent-modularization/README.md](../20260921T033332-independent-modularization/README.md)
（裁决 **FAIL / FIX_REQUIRED**，阻断项 F01 / F02 / F03）。

> **本报告的性质**：全部证据由**实施方**在**同一台机器**上产生。
> 它只能说明「这三条缺口在本轮工作区字节上不再复现」，**不能**替代第二次独立复验
> （自测 ≠ 独立验收是本案已经吃过一次亏的地方）。本报告**不**对 P2/P3/P4 的完成度作任何声明。

改动**未提交、未推送**（HEAD 仍 `3574824`，87 条未跟踪/未提交条目）。
⚠️ 验收方若用 `git checkout -- <file>` / `git stash`「还原现场」，会把交付物抹成基线
`3574824` 且不可恢复 —— 见文末 §6。

---

## 1. 逐条对照：复验说了什么 → 改了什么 → 拿什么证明

### F01 · 把必需的原生 JS 模块误当成可缺失的平台桥

**复验的实测形态**：只去掉 `lib/native-reminders.js`，Android 组合仍然 `ready=true`、
`startupFailure=null`，事项照旧落入模拟 IDB（put=1），而 `schedule` / `scheduleAlarm`
调用都是 0 —— 能存能改，一条提醒都不会响，界面也不说原因。

**改法**（`app-core.js`）：

1. 闸门不再排除 `AttentionNativeReminders`。它的理由本来就只对 `Capacitor` 成立
   （平台桥由原生 WebView 注入，纯 Web 缺席是正常状态），而 `lib/native-reminders.js`
   是**我们自己发的**脚本、`index.html` 里始终加载、UMD 无条件导出。
2. 新增真实 Web 场景：`loadCombination({ platform: "web" })` 让 `window.Capacitor`
   为 `undefined` 而**脚本一支不少**——这才是「纯 Web」。从前用「删掉 native 脚本」
   冒充纯 Web，正是这个缺陷得以藏身的地方（把缺陷写成了期望）。

**证据**（`evidence/npm-test.log`，B2 / B3 段）：

| 断言 | 位置 |
| --- | --- |
| 去掉 `lib/native-reminders.js` ⇒ `ready()===false` | `test-boot-combination.js` B2 反例 |
| 失败面板点名 `AttentionNativeReminders`，并写清后果「一条提醒都不会响」 | 同上 |
| 失败时 `disk.puts===0` 且没有 15 秒业务心跳（**副作用之前**就停住） | 同上 |
| 纯 Web（脚本齐全、无 Capacitor）⇒ `ready===true`，且 `isNativeAndroid()===false` | B2 ⑧ 边界 |
| 原生**成员**级缺件（`reconcile: undefined`，真的用改坏的源码启动）⇒ 闸门点名 | B3 ⑨（本轮新增） |
| 同一次失败：不读库、不排通知、不排闹钟 | B3 ⑨（本轮新增） |

`sw.js` 版本号 v8 → v9（加载层行为变了，旧缓存必须失效）。

### F02 · 依赖检查漏掉必需成员、实例 API 和 null

**复验的实测形态**：`typeof === "object"` 让 `null` 通过；未查 `setupSteps` /
`normalizeEvidence` 等成员；`AppUi` 只查工厂存在、不查实例 API（空壳工厂导致白屏）；
静态闭包扫描不认识 `FeedbackLib` / `EvidenceLib` / `appUi` / `f` 等别名。

**改法**：

1. `REQUIRED_RUNTIME_EXPORTS` 由 **46 条 → 69 条**（新增 23、删除 0，实测对比见下），
   新增明细全部是复验点名的那几处：
   `Feedback.actionSpec/setupSteps/testFeedbackVerdict/saveFeedback`（4）、
   `DeliveryEvidence.mergeEvidence/normalizeEvidence/evidenceStatusFor/entryRoundBase`（4）、
   原生模块 **14 条**（`AttentionNativeReminders` + `NativeReminders.*` 13 条）、
   `AttentionLib` 本身（1）。
   （注：`UiFormat.*` 与 `AppUi.safeExternalHref` 在修复前**已经**在表里，本轮没有新增它们。）
2. `null` 与 `undefined` 分开报（`describeGot`）：`got === null || typeof got !== want`。
3. 新增 `APP_UI_INSTANCE_CONTRACT`：连「`createUi` 返回的实例上有没有 `$` / `toast` /
   `openSheet` …」一起查；探测用的实例**就是业务要用的那一个**（同一个 deps、不另造）。
4. 静态闭包扫描改按**别名**归一（`FeedbackLib`→`Feedback`、`EvidenceLib`→`DeliveryEvidence`、
   `f`→`FeedbackLib`…），带**歧义保护**：`const f = e.target.files[0]` 这种同名不同义
   不得被算作别名（否则会误报）。带守卫的可选引用（`if (Ns.x)`）豁免但对齐登记。

**证据**：

| 断言 | 位置 |
| --- | --- |
| `Feedback = null` ⇒ 报 `path==="Feedback" && actual==="null"` | B3 ① |
| 失败时**不覆盖**既有绑定（兜底分支不会突然变可达） | B3 ① |
| 删 `Feedback.setupSteps` / `DeliveryEvidence.normalizeEvidence` ⇒ 逐条点名 | B3 ② |
| `createUi` 空壳 ⇒ **逐项点名 8 个实例 API**，且此时没继续读写库、旧绑定保持原样 | B3 ④ |
| `createUi` 抛异常 ⇒ 报 `AppUi.createUi() threw:boom`（不是启动链中途炸掉） | B3 ⑤ |
| 静态：`undeclared=[]`，`uiInstance.used === declared`（无缺、无冗余） | `evidence/static-checks.json` |
| 别名扫描：`ambiguousAliases:["f"]`（同名不同义被**排除**，不是被误采） | 同上 |

### F03 · 补载后「重试」显示成功，旧函数绑定却没更新

**复验的实测形态**：`parseChineseTime` 在 IIFE 求值时被 `const` 捕获，闸门却读实时
`Lib` ⇒ 两者可以不是同一个函数。补载解析器后点「重试」：`ready=true`、面板消失、
业务定时器起来，但 `app.parseChineseTime` 仍是 `undefined`，输入/保存报
`parseChineseTime is not a function`。**「启动成功、保存链路不可用」。**

**改法**：把「检查」与「绑定」合并成**同一次操作** `bindRuntime()`：

- 检查用的是即将绑定的那批值（`readRuntimePath(roots, …)`），绑定的就是刚才核对过的那批值
  —— 「检查过的」与「用的」不可能不是同一份；
- 绑定改用 `let`（不是 `const`），重试可以重建；
- `initStarted` 守卫，重试不得重复注册监听/计时器；
- 测试钩子改用 **getter** 导出（`get parseChineseTime()`），否则导出快照会把旧值钉死
  —— 这一条是实测踩出来的：shorthand 导出让「重试后」的断言看不见新绑定。

**证据**：

| 断言 | 位置 |
| --- | --- |
| 缺解析器 ⇒ `ready=false`，且**不起业务定时器**（干净的失败） | B3 ⑦ |
| 补载**真实** `lib/parse-cn.js` 后点「重试」⇒ `ready=true` | B3 ⑦ |
| 重试后绑定指向**当前**的 `Lib.parseChineseTime`（`"current"`） | B3 ⑦ |
| 15 秒心跳**只装了一次**（重试不重复注册） | B3 ⑦ |
| 重试后「输入 → 保存」**真的落库** | B3 ⑦ |
| `app-core.js` 排在 lib 之前 ⇒ `ready=false`，绑定保持**空**（不是绑上 undefined 后假装成功） | B3 ⑧ |
| 每个绑定路径都在必需声明表里（25 条，绑定不得超出闸门） | B3 ⑥ |

---

## 2. 反向对照：把修复拔掉，必须变红

「新断言现在是绿的」不构成证据 —— 恒真断言也是绿的。唯一判据是
**把修复退回去，断言会不会红**。做法是用 `overrides` 只换一个文件（生产清单与 harness
全都不动），即「同一组合、只有这一处差别」。这一段（B4）是**永久**留在套件里的，不是一次性探针。

| 反向编辑 | 期望 | 实测 |
| --- | --- | --- |
| **M1** 去掉 `got === null ||` | `Feedback` 自己那一条不再被点名 | ✅ `ready=false` 但只剩成员在报，`Feedback` 条目消失 |
| **M2** 闸门跳过**全部**原生条目 | 缺 native 时不再有装配失败反馈 | ✅ `startupFailure()===null`（无面板） |
| **M3** 闸门只跳过 `NativeReminders.reconcile` | `reconcile: undefined` 不再被点名 | ✅ 不再点名该成员 |

三条各有一道「前置」断言（补丁真的改到了源码）与一道「良构」断言（只差那一两行，
防止「把环境改坏了才变红」），末条核对工作区源码**一个字没动**。

**M2 的实测校正（重要，别照抄复验数字）**：把闸门拔掉后，缺陷态在本轮字节上**不是**
复验报告里那种「put=1 / schedule=0」，而是业务序列**跑不完** —— `NativeReminders`
被绑成 `null`，写到 `.migrateItem` 就抛 `Cannot read properties of null`，落库 0、排程 0，
而界面**依旧没有任何失败反馈**。复验量的是**修复前**的字节，这里量的是「把修复拔掉」的
字节 —— 同一个缺陷、不同字节，所以只断言两边都成立的部分，**不照搬它的表格数字**。

---

## 3. 真实浏览器复验（Chrome + CDP，带副作用计量）

脚本 `scripts/verification/browser-recovery-check.py`（headless Chrome 153、隔离
browser context、不连 Service Worker、不接任何真实用户数据、本地 18771/18772 端口）。

**本轮新增的能力**：每个新文档在**任何页面脚本求值之前**装 `indexedDB` 计量器
（`IDBFactory.open` 次数 + `IDBObjectStore.put/add/delete/clear` 次数）。
这一条是必需的 —— 面板上那句「本次未加载数据、未做迁移」是**产品自己的说法**，
不是证据；F01/F02 的关键恰恰是**副作用有没有真的发生**。

| 用例 | ready | IDB open | 写入 | 判定 |
| --- | --- | --- | --- | --- |
| control（纯 Web、脚本齐全） | true | 1 | **1** | PASS（写入 ≥1 证明**计量器有牙齿**） |
| missing-parser（补载前） | false | **0** | **0** | PASS + 可见失败面板 |
| missing-parser（补载后点重试） | **true** | 1 | **1** | PASS，`bindings.parseChineseTime==="current"`，保存落库 |
| missing-native | false | **0** | **0** | PASS（F01，面板 14 项点名 native） |
| feedback-member（删 `setupSteps`） | false | **0** | **0** | PASS（F02） |
| feedback-null（`Feedback=null`） | false | **0** | **0** | PASS（F02） |
| shell-ui（`createUi` 空壳） | false | **0** | **0** | PASS（F02，面板 8 项点名实例 API） |

**总计 6 个用例，0 项断言不满足，退出码 0**（有断言不满足时退出码 1）。

注意 `missing-parser` 的 `ready` 显示为 `None` 是**取数位置**问题：它的 ready 在
`readyBefore` / `retry` 两个子步骤里分别记录（false → true），最外层没有 ready 字段。

对照的是复验的浏览器证据：`AppUi.createUi=()=>({})` 那一条在复验里是
「`ready=false`、**已打开 IDB**、无可见失败面板、页面主体空白」；
本轮同一注入是 **open=0 / 写入=0 + 可见面板**。

---

## 4. 本轮水位（实测，不是推算）

`npm test` 全绿，退出码 0：

| 套件 | 本轮 | 复验时 | 差 |
| --- | --- | --- | --- |
| `test-unit.js` | 411 | 411 | — |
| `test-native-reminders.js` | 321 | 321 | — |
| `test-boot-combination.js` | **254** | 208 | **+46** |
| `test-smoke.js` | 256 | 256 | — |
| `test-regressions.js` | 730 | 730 | — |
| `parse-single-source.js` | **141** | 137 | +4 |
| **合计** | **2113** | 2063 | **+50** |

另：`ui-format-parity` 567 项一致 PASS；`ui-dom-parity` 16 场景 / 590 字段一致 PASS；
`runtimeDependencyCoverage` 的 `undeclared=[]`；`precacheProblems()` / `packagingProblems()`
均为 `[]`；`uiInstanceCoverage` 的 used 与 declared 完全相同（无缺、无冗余）。

⚠️ 复验报告里的 `boot 208 / single-source 137` 是**修复前**的水位，
引用时不要与 254 / 141 混用。

---

## 5. 仍然没做的（与复验报告 §4 一致，不因本轮修复而改变）

| 项 | 状态 |
| --- | --- |
| P2 剩余（AI / 备份 / 诊断 / 引导 / 内容视图 / 表单）与逐功能拆 `bind()` | **未做**。`downloadFile` 仍在 app-core（按计划属 `lib/app-backup.js`） |
| P3（持久化 / 提交重放事务 / 事项命令 / 原生协调整组迁出） | **未做**。app-core 仍 397,859 字节，不是薄装配入口 |
| P4 离线升级实测（残缺下载、旧缓存激活） | **NOT_PERFORMED**。本轮浏览器复验**刻意禁用 Service Worker**，只验启动/表单；SW 侧本轮只动了缓存版本号 |
| P4 打包链逐字节比对（源码 → www → Android assets → APK） | **NOT_PERFORMED**。本轮**没跑构建**，静态 `packagingProblems=[]` **不能**当作资源一致性证据 |
| 实机（Android 排钟、锁屏/冷进程可见提醒、SAF） | **NOT_PERFORMED**。VM 里的原生桥计数不等于设备排钟或用户可见送达 |
| 完整 UI / 性能矩阵 | **NOT_PERFORMED**。本轮只做真实浏览器最小保存/重启与故障场景 |

**因此本轮不得写成「整体拆分完成」**，也不得把任何实机项标 PASS。

---

## 6. 复算入口与保护性说明

在本 run 目录下执行（不要把变异作用到用户工作区）：

```sh
# 1) 六套测试（2113 项，退出码 0）
cd <repo> && npm test

# 2) UI 两个对照（567 / 590，PASS）
node scripts/verification/ui-format-parity.js
node scripts/verification/ui-dom-parity.js

# 3) 静态闭包 / 预缓存 / 打包声明
node -e 'const p=require("./scripts/verification/production-scripts.js");
  console.log(p.runtimeDependencyCoverage(".").undeclared,
              p.precacheProblems("."), p.packagingProblems("."));'

# 4) 真实浏览器复验（需要 Chrome；约 15 s）
BROWSER_CHECK_OUT=/tmp/attention-browser-recovery \
  /usr/bin/python3 scripts/verification/browser-recovery-check.py; echo "exit=$?"
```

**保护性说明（重要）**：

- 本轮改动**未提交、未推送**，HEAD 仍是 `3574824`。**独立验收对象必须包含工作区
  未跟踪文件**（`lib/*.js` 新模块、`scripts/verification/parse-single-source.js`、
  `ui-format-parity.js`、`ui-dom-parity.js`、`browser-recovery-check.py`），
  不能只用 HEAD 代表交付源码。
- ⚠️ **不要**用 `git checkout -- <file>` / `git stash` / `git reset` 去「还原现场」：
  会把交付物直接抹成基线且不可恢复。要备份就先 `cp` 到 `/tmp`，改完从备份拷回。
- 复验方自己的变异、探针、临时文件请放在自己的 run 目录或 `/tmp`，
  **不要**落在 `scripts/verification/` 下 —— 本轮已清理掉一处这样的遗留
  （`scripts/verification/browser-recovery-run/`，107 MB、内容为空壳 `[]`，
  已移出到 `/tmp/attention-browser-recovery-stale-*`）。
- 交付身份（每个文件的 SHA-256 + 字节数）见 `evidence/source-hashes.txt`，
  它是**工作区字节**的身份，不是 HEAD 的身份。`app-core.js` =
  `789ee3b7abbb2f4849ea1fea02c7cd5f9c133cbefd2822140eec93cccc0cc1ed`（397,859 字节）；
  复验时是 `1803deaa…`（380,808 字节）。

## 7. 证据文件清单

| 文件 | 内容 |
| --- | --- |
| `evidence/npm-test.log` | 六套测试完整输出（含 B3/B4 段） |
| `evidence/ui-format-parity.log` / `ui-dom-parity.log` | 两个 UI 对照 |
| `evidence/static-checks.json` | `undeclared` / 别名 / 歧义 / 守卫引用 / 实例契约 / 预缓存 / 打包 |
| `evidence/source-hashes.txt` | 交付身份的 SHA-256 与字节数 |
| `evidence/browser-recovery.json` | 6 个浏览器用例的逐项原始结果（含 `sideEffects`） |
| `evidence/browser-recovery-run.log` | 复验 stdout（含汇总与逐条 PASS/FAIL） |
| `evidence/browser-recovery-percase.log` | 逐用例一行 JSON |
| `evidence/chrome.log` | Chrome 启动/运行日志（环境排错用） |
