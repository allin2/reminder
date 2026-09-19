# 三个优先项 · 返工实现报告

时间：2026-09-20 00:20 CST。run-id：`20260919T235500-ux-rework`。

起点是我方的独立验收把上一版判为 **FAIL / FIX_REQUIRED**，列出 F01–F08 八项问题
（[验收报告](user-experience-three-priorities-independent-acceptance-20260919.md)）。本报告只讲**这次返工改了什么、怎么证明的、还有什么没做**。

**结论先说：八项问题的产品代码都已改；独立验收给出的 R1–R7b/F07/F08 反例已全部转成有断言的回归并通过（JS 1517/1517、Android 22/22）；九处修复都做了「拔掉就变红」的反向自检。但本报告不宣布独立验收通过 —— 是否通过由验收方复验决定，且本轮仍未执行真机链路（V18/V19/V20 保持 NOT_PERFORMED）。**

---

## 1. 身份与边界

- 仓库 `/Users/qlyf/Developer/reminder`，分支 `main`，HEAD `8d1c2617cff3aac5c4450a949c9044b79f63a673`。
  **`HEAD == origin/main`，本轮未提交、未推送、未改 HEAD**；工作区仍有未提交改动（86 条，含本轮）。
- 身份文件（源码/Java/测试/候选 APK 哈希、相对失败轮的源码变化）：[identity.json](verification-runs/20260919T235500-ux-rework/identity.json)。
- 失败的上一版报告与其证据目录 `verification-runs/20260919T234129-ux-independent/` **原样保留**，本轮只新增文件。

**相对失败轮，被改动的源码只有 5 个文件**（identity.json `changedVsFailedRound`，逐字节比对）：

| 文件 | 失败轮 sha256（前 8） | 本轮 sha256（前 8） |
|---|---|---|
| `app-core.js` | `aff30d6f` | `e2fcad68` |
| `lib/native-reminders.js` | `10ef85fe` | `7c09fa1c` |
| `lib/feedback.js` | `f19a5a9a` | `7e9317d1` |
| `lib/delivery-evidence.js` | `01aa270f` | `33659312` |
| `.../DeliveryEvidenceStore.java` | `1467ead7` | `e9dae6f7` |

`index.html`、`sw.js` 的哈希没变 —— 因为本轮没有新增 `lib/*.js`（`feedback.js`/`delivery-evidence.js` 是上一轮就有的），所以不需要换缓存版本号。**这正好说明「缺陷不是靠改身份/换缓存掩盖的」**。

### 本轮没有做什么（明确边界）

- 未覆盖任何历史候选目录（`20260919-ux-three-priorities/` 等原样保留）。
- `releases/安心收件箱-debug.apk` 在构建时被脚本覆写，**构建后已按字节还原**到开工前状态；
  本次构建新产生的 release 产物已清除（细节见 §6）。
- 未清空/迁移用户数据，未改设备设置，未重启设备，未在真机上制造响铃。
- 未改 `docs/baseline/`、未改既有失败报告、未改 `docs/decisions/` 下任何裁决。
- **未宣布独立验收通过。**

---

## 2. F01–F08 逐条：根因 → 改法 → 变成哪条断言

### F01 [P1] 原生回执字段与 JS 读取不一致 ⇒ 真实证据进不了台账

**根因**：Java `rowFor()` 写 `{itemId, key, at, carrier, ...}`，JS `normalizeEvidence()` 只读 `row.reminderKey`。于是**每一条正常的原生回执都被判 missing-identity 丢掉**。同一通路还把原生 `available:false` 吞成 `available:true`（R7b）。

**改法**：把字段名收敛成**唯一协议**，两侧各自把名字暴露成常量，让测试可以直接比对：

- Java `DeliveryEvidenceStore.java:45`–`52`：`F_REMINDER_KEY = "reminderKey"`、`F_PLANNED_AT = "plannedAt"`，并导出 `ROW_FIELDS` 数组；`:146`–`147` 按规范名写入。
- JS `lib/delivery-evidence.js:63`：`ROW_FIELDS = ["itemId","reminderKey","plannedAt","carrier","receivedAt","itemRev","token"]`；`:64` 保留 `LEGACY_FIELDS = {key→reminderKey, at→plannedAt}` 仅作**读容错**。
- `lib/native-reminders.js:1265`–`1294`：`available:false` 如实转述（`not-native` / `bridge-unsupported` / 原生自报不可用三种理由分开），只有真读到才 `available:true`。`SystemBridgePlugin.java:925`/`938` 读失败一律 `available:false`。

**变成的断言**：新增 `test-native-reminders.js` 的 F01 往返契约 —— 从 Java 源码解出 `ROW_FIELDS`（经 `F_*` 常量映射）后与 `evidenceLib.ROW_FIELDS` **逐字比对**；断言旧名 `key`/`at` 已从 Java 协议移除；断言两侧键集相同。回归侧新增 R7/R7b：Java 真实行穿过桥后身份完整、并进台账后写成 `delivered`、桥说读不到时 `available:false`。

> 这条现在是**源码级往返契约**，不是「Java 测一次、JS 测一次」——独立验收指出的正是后者证明不了字段合同。

### F02 [P1] 保存防重用两套身份 ⇒ 连续回车落两条

**根因**：入口查 `new|文本|时间`，真正入集合的是 `new:<新ID>`（编辑 `edit:<ID>:<时间>`、AI `ai:<时间>`），**永远对不上**；保存按钮 disabled 也拦不住输入框 Enter 第二次调用。

**改法**：`app-core.js:4015` 起，`submitToken` 只在**一处**计算，接收、异步解析到提交完成**共用同一个 token**；`:4016` 入口查、`:4040` 解析后再查一次、`:3280` 只有集合空才恢复按钮。

**变成的断言**：R1 组 —— 扣住持久化连续调两次，第二次必须被同一份身份拒（旧实现两次都返回 true）、内存 1 条、权威存储 1 条，**外加对照组：提交结束后新的一条照常保存**（防止用「一律拒绝」蒙混）。

### F03 [P1] 上一笔保存的结果清掉用户新写的草稿

**根因**：持久化回调**无条件**关表单、重置；失败回调**无条件**把旧草稿盖回当前表单。没有表单会话/草稿版本概念。

**改法**：`app-core.js:3336` 引入 `formDraftSignature(snap)`，保存时对**自足快照**取签名（`:4084`、`:4157`）；成功回调只有 `:4104`/`:4163` 签名仍相等才关闭/重置，失败回调同样只在签名相等时才恢复旧草稿。

**变成的断言**：R2 组 —— 第一笔未提交时把输入改成「第二条尚未保存的输入」，释放第一笔后输入必须**不为空**；失败路径改成给一个显式找回入口，并明确说明「你正在写的内容没被动过」。

### F04 [P1] 撤销完成绕过事务日志 ⇒ 显示成功后又被权威草稿翻回已归档

**根因**：`undoLastComplete()` 直接改共享 state，没有进原生在途事务的冲突检查/命令日志，提交期间撤销不会被重放到随后发布的权威草稿；且**写完就提示「已撤销完成」**，落库失败时界面与磁盘不一致。

**改法**：`app-core.js:2168` 起，撤销变成受控命令 `runUserOp(applyCompleteUndo, [command], {userFacing:true, scopeId:(c)=>c.itemId, name:"undoComplete"})` —— 目标 id 藏在参数里，所以**显式告诉冲突检查 scope**。命令只携带自足值（重放时按 `itemId` 在当时的草稿里重新解析，不留旧对象引用）。`:2176`–`2187`：提示一律挂在 `save()` 的 `then` 里，失败则 `revertCompleteUndo(command)` + 恢复撤销入口 + 明确重试。

**变成的断言**：R3 组（原生 ACK 提交被扣住时撤销 → 撤销后立即回到未完成 → **释放提交后仍未被覆盖** → **重启后仍是撤销后状态**）+ R6 组（注入权威写入失败 → 落库前不说「已撤销」、可见状态退回、磁盘无假结果、重启一致、如实给重试入口）。

### F05 [P1] 跨原定时间撤销完成 ⇒ 立刻补投已取消的那一次

**根因**：撤销恢复 `waiting` 后保留 `cancelled` 台账，`buildDesired()` 于是生成 `catchUp:true` 的普通通知。代码旁注释声称有抑制，**但没实现**。

**改法**：新增 `REMINDER_STATE_SUPPRESSED`（`lib/native-reminders.js:122`）与 `suppressPastReminderReplay(item, now)`（`:124`–`134`）：撤销完成时把**本次完成期间被取消、且已跨过原定时刻**的提醒键标成 `suppressed`；`:374` 的计划生成分支遇到 `suppressed` 直接跳过。**抑制落在这一条键上，不动全局补投规则。**

**变成的断言**：R5 组 —— 用**真实取消 reducer** 走跨点时序，断言不产生 now+2s 的 catchUp；断言该轮次在台账里被标成 `suppressed`；**外加对照组：未被抑制的 cancelled 轮次仍然补投**（防止「把补投整个关掉」冒充修好）。

### F06 [P1] 旧回执不核轮次/版本 ⇒ 误报「新提醒已接收」

**根因**：合并只校验 `ev.at >= item.triggerAt`，不核对轮次身份；「版本字段存在」被当成「已校验」；展示是「存在任意 delivered 就显示已接收」。

**改法**：把**我们自己的排程登记**当唯一可验证身份 —— `lib/delivery-evidence.js:171`（早于当前触发起点 ⇒ `stale-round`）、`:179`–`182`（登记不到这一轮 ⇒ `unregistered-round`，宁可「尚未确认」也不谎报）；最小身份改成 5 项（`itemId` + `reminderKey` + `carrier` + `receivedAt>0` + `itemRev`，`:107` 缺一即 not-valid）。

**变成的断言**：`test-unit.js` 新增 `item2`（旧轮次 ⇒ `stale-round`）、`item2b`（新轮次登记键写入成功）、`item2c`（未登记轮次 ⇒ `applied===0 && unknown===1 && reasons[0]==="unregistered-round"`）；`test-regressions.js` T03 新增 `it3`（本轮内未登记不写）、`it4`（半套字段不作数 + 补全后写入成功 —— 证明拒绝不是通路故障）。

### F07 [P1] 「停止铃声」根本没有停铃路径

**根因**：按钮先 `labCancelAlarms()`，之后条件调用 `NativeReminders.stopAllAlarms` —— **该 API 在模块里不存在**，分支永不执行；正在响的服务没有任何停止路径。

**改法**：`app-core.js:6276` 新增 `stopSetupTestRun()`：按**活跃投递台账**取本次测试那条的 `id + token`，走已存在的 token 限定链路 `stopAlarmDelivery({id, token})` —— 只停指定 id 且 token 相符的那一条。`:6287` 用 `run.startedAt` 排除**上一次测试的残留**；`:6305`–`6307` 分三档如实说明停到了什么（「没找到正在响的」≠「停不掉」）。反馈与系统证据都绑定本次运行（`:6315` 只用本次运行之后的反馈；`setupEvidenceHtml` 不再无条件展示上一条业务闹钟）。

**变成的断言**：F07 组 —— 停铃返回本次真正停掉的条数（旧实现恒 0）、只停本次那一条（id+token 双重限定）、**绝不误停用户自己的闹钟**、上一次残留不算本次、本次运行记录被标成已停止。

### F08 [P2] 无时间记录的撤销入口被下一条 toast 顶掉

**根因**：`announceSaveOutcome()` 造出带撤销的反馈后，`needs` 分支**再发一条**不带撤销的 toast。

**改法**：`app-core.js:3602` 起，待整理语义改为 **`decorate()` 装饰同一个出口**（`:3603`–`3607`）——同一个 `toast` 承载「待整理」文字 + 「去整理」动作 + 撤销入口；三条分支（`:3609`、`:3615`、`:3623`）都带上同一个 `undoSecond`/`undoCtx`。

**变成的断言**：F08 组 —— 反馈里保留「待整理」、同一条里给出去整理入口、**撤销入口没有被第二条提示顶掉**。

> 这条断言第一版是**假绿**：旧实现隐藏 `#toastAction2` 时只置 `hidden=true`、**不清 `textContent`**，只读文字看不出差别。已给 harness 加 `hiddenOf()`，断言改为同时校验文字与 `hidden===false`。

---

## 3. 两套合同的收口方式（回应验收的返工要求）

验收要求「优先统一合同，而不是对每个失败加局部布尔」。本轮的做法：

1. **保存/撤销事务合同** —— 提交身份（`submitToken`，F02）、表单会话（`formDraftSignature`，F03）、业务版本（`rev` 比对，F04）、持久化（提示挂 `save().then`，F04/R6）、原生在途（`runUserOp` + `scopeId`，F04）、周期派生与对账副作用（撤销后的 native sync 单独走对账，F05）现在**共用一套先后顺序**：接收 → 解析（再查重）→ 入事务 → 提交 → 落库确认 → 才反馈。
2. **投递证据合同** —— Java 输出 → 桥 → JS 归一化 → 权威存储 → 详情展示由**一份真实样本贯穿**：`ROW_FIELDS` 两侧常量逐字比对 + R7 用 Java 真实行穿过生产 JS 桥与归一化 + R7b 覆盖读不到。**「不可用」与「空」在每一层都分开表达**（Java `available` / 桥 `available` / JS `available` / 展示 `unknown`）。
3. **首用测试闭环** —— 本次测试身份（`currentTestRun()`）、token 限定的可达停铃（`stopSetupTestRun`）、反馈与系统证据绑定本次运行、上次残留被排除。

---

## 4. 测试与命令（含退出值）

| 命令 | 结果 | 退出 | 日志 |
|---|---|---|---|
| `npm test` | unit **321** / native **321** / smoke **226** / regressions **649** = **1517**，失败 0 | 0 | [npm-test.log](verification-runs/20260919T235500-ux-rework/npm-test.log) |
| `./gradlew :app:testDebugUnitTest --offline --rerun-tasks` | **22** 条，失败 0（`ExampleUnitTest` 1 + `DeliveryEvidenceStoreTest` 13 + `ProductionJavaAlarmTest` 8） | 0 | [android-unit-rerun.log](verification-runs/20260919T235500-ux-rework/android-unit-rerun.log) / [android-results.json](verification-runs/20260919T235500-ux-rework/android-results.json) |

水位对比：失败轮是 **1475**（319+318+226+612）+ Android **19**；本轮 **1517** + **22**。
增量全部是返工断言：regressions **+37**、unit **+2**、native **+3**、Android **+3**。

Android 那次是**真实重跑**（`--rerun-tasks`，`66 actionable tasks: 66 executed`，BUILD SUCCESSFUL），不是 `UP-TO-DATE` 缓存。JDK 17 Temurin 显式指定 `JAVA_HOME`。

---

## 5. 反向自检（「对照组必须有牙齿」）

脚本：[reverse-selfcheck.py](verification-runs/20260919T235500-ux-rework/reverse-selfcheck.py)，结果：[reverse-selfcheck.json](verification-runs/20260919T235500-ux-rework/reverse-selfcheck.json)。

对 **9 处修复**各做一次**最小缺陷注入**，跑**已有的**测试（不改测试），要求「进程退出码 ≠ 0」**且**「失败清单里出现目标断言」；然后 `cp` 备份还原、`shasum` 逐字节比对。

| 注入 | 注入内容 | 必须变红的断言 | 结果 |
|---|---|---|---|
| `F01-JS` | `ROW_FIELDS` 改回 `key`/`at` | T03 Java 的线上字段名与 Web 侧逐一相同 | `RED_AS_EXPECTED` |
| `F01-Java` | `F_REMINDER_KEY="key"` / `F_PLANNED_AT="at"` | `rowFieldsAreTheWebProtocol` | `RED_AS_EXPECTED` |
| `F02` | 查重改回 `has("legacy\|" + rawPrefetch)` | R1 第二次提交被同一份提交身份拒绝 | `RED_AS_EXPECTED` |
| `F03` | 去掉 `formDraftSignature` 相等检查 | R2 旧保存成功不清掉新输入 | `RED_AS_EXPECTED` |
| `F04-commit` | `applyCompleteUndo(command)` 绕过 `runUserOp` | R3 原生提交发布后仍未被覆盖 | `RED_AS_EXPECTED` |
| `F04-feedback` | toast 提到 `save()` 之前 | R6 落库之前绝不说「已撤销」 | `RED_AS_EXPECTED` |
| `F05` | 删掉 `REMINDER_STATE_SUPPRESSED` 跳过分支 | R5 不因撤销立刻补响已经过去的那一次 | `RED_AS_EXPECTED` |
| `F07` | `if (false && bridge && ...)` 让停铃分支不可达 | F07 停铃返回本次真正停掉的条数 | `RED_AS_EXPECTED` |
| `F08` | 多补一条 `if (needs) toast(...)` | F08 撤销入口没有被第二条提示顶掉 | `RED_AS_EXPECTED` |
| — | 全部还原 | — | `RESTORE: BYTE_IDENTICAL` |

**9/9 变红，还原逐字节一致。**

两个必须说清楚的判据细节（都是第一版踩过的坑）：

- **只看子串会误判**：输出里同时存在同名的 `✓` 通过行，所以判据收紧为「`✗ ` 前缀 + 断言名」（Android 侧为「`FAILED` 后缀 + 方法名」）。
- **F08 的假绿**：旧实现隐藏撤销入口时只置 `hidden`、不清 `textContent`，只读文字看不出差别 ⇒ harness 增加 `hiddenOf()` 读 DOM 属性后才真的有牙齿。

一处**已知的牙齿边界**（如实记录）：`ProductionJavaAlarmTest` 用 `sun.misc.Unsafe` 写 `static final SDK_INT`，历史上出现过**顺序抖动**（同注入下两次中一次红）。本轮 9 次自检里它没有干扰判据，但这个不确定性依然存在 —— 看到它单独变红时先怀疑抖动，不要直接归因业务代码。

---

## 6. 构建产物核查（不是「构建成功」就算数）

构建：`bash scripts/android-build.sh both`（需沙箱外，`npx cap sync` 会撞沙箱的批量删除护栏）→ `BUILD SUCCESSFUL`。

| 候选 | 路径 | 大小 | sha256 |
|---|---|---|---|
| debug | `releases/candidates/20260919T235500-ux-rework/attention-inbox-debug-ux-rework.apk` | 4,113,436 | `e52005db471d06914d5571e8fb270f21179fa660a6e26fbae69d550db7b74f38` |
| release | `.../attention-inbox-release-ux-rework.apk` | 3,247,322 | `e1c47c3e1a32578111e4c268c7b0afb47f0b6a5d3b1d77056cd54efd37cc8390` |

校验和：[SHA256SUMS.txt](../../releases/candidates/20260919T235500-ux-rework/SHA256SUMS.txt)。

**逐字节核对**（[apk-web-assets.txt](verification-runs/20260919T235500-ux-rework/apk-web-assets.txt)）：把两个包里的 `assets/public/` 解出来，与工作区源码 `cmp` —— **13 个 Web 资源在两个包里全部 `IDENTICAL`**，`RESULT: ALL_WEB_ASSETS_BYTE_IDENTICAL`，退出 0。

含本轮被改的 `app-core.js`（`e2fcad68…`）、`lib/native-reminders.js`（`7c09fa1c…`）、`lib/delivery-evidence.js`（`33659312…`）、`lib/feedback.js`（`7e9317d1…`），也含 `lib/*.js` 全部 10 个文件。

**`releases/安心收件箱-debug.apk` 在构建时被脚本覆写，已在构建后按字节还原。** 沿用上一轮确立的做法
（该文件是 tracked 的、且开工前就带着一个与 HEAD 不同的工作区版本）：构建前备份 → 构建 → `cp` 还原 →
`shasum` 比对，**还原后等于开工前的 `186c28b9…`**（HEAD 里是 `cb6a9217…`，那个差异在返工开工前就存在，不是本轮造成的）。
构建新产生的 `releases/安心收件箱-release.apk` 与 `.idsig` 在开工前不存在，已一并删除恢复原状；
两份构建产物都完整保存在候选目录里，没有丢失。

---

## 7. 本轮额外发现（**未修**，待裁决）

做构建产物核查时，顺手核了「新增 `lib/*.js` 必须同时挂四处」这条约定（脚本与结果：[lib-registration.js](verification-runs/20260919T235500-ux-rework/lib-registration.js) / [lib-registration.json](verification-runs/20260919T235500-ux-rework/lib-registration.json)）。结论分两类，**都不是本轮的回归**：

1. **本轮的两个模块挂对了**：`feedback.js`、`delivery-evidence.js` 在 `index.html`、`sw.js`、`test-smoke.js`、`test-regressions.js` 四处齐全，`sw.js` 缓存版本同步从 `v3` 提到 `v4`。这条是**通过**的。
2. **一个陈年缺口**：`lib/native-reminders.js` **被 `index.html` 加载，但从来不在 `sw.js` 的 `ASSETS` 里** —— 在 HEAD（`v3`）就是这样，不是本轮引入。失败模式很窄但真实：**全新安装后、在该文件被在线加载过一次之前就离线打开**，Service Worker 的 `cache.addAll` 没预缓存它，`caches.match` 未命中会回落成 `./index.html`（HTML 当 JS 返回）⇒ 原生桥静默缺失。**未修**，因为不属于本次返工范围，且按本仓约定改产品行为需先裁决。
3. **三个「尚未接线」的 UMD 模块**：`lib/export-format.js`、`lib/import-extract.js`、`lib/import-map.js` 是浏览器可用的 UMD，但目前**只被 `test-unit.js` / `scripts/` 用 Node `require`**，`index.html` 与 `app-core.js` 都没用它们。因此它们**暂时不需要**挂四处 —— 但**一旦接线就会踩同一个坑**，先登记在这里。（这与「导出数据没有落地出口」的提案 `docs/decisions/proposal-export-file-visibility-20260919.md` 是同一片区域。）

---

## 8. 未完成项与残留风险

1. **真机链路全部 NOT_PERFORMED**：候选 APK 未装到设备、未回读设备侧 sha、未做真实投递观察窗。独立验收要求「先让反例变成有断言的回归并通过，**再**复验真实 Android 链路」—— 前半已完成，后半**未做**。
2. **V18 / V19 / V20 依然 NOT_PERFORMED**，原因与失败轮相同：都要改变设备现场（真实响铃最长数分钟 / 重启 / 跳设置页），超出本轮授权边界。**冷进程修复格不得记 PASS，也不算已修。**
3. **OEM 冷进程投递黑洞未解决**（D70 提案待裁决 Q1–Q4，代码未动）：ColorOS `OplusAppStartupManager: prevent start … Type ssfa` 拦截「为闹钟拉起已死进程」，AOSP 层明明已放行。
4. **导出仍没有落地出口**（本轮新写的 `lib/export-format.js` **尚未接线**，仍待裁决 E1–E4）：点「导出数据」弹成功提示但全机无文件；`downloadFile()` 不报成功也不报失败。与本轮 F01–F08 无关，但**用户能直接看到**。
5. **UX-T02 规格缺口未解**：60 秒测试仍没有独立事项通道，做一次测试会在用户数据里留一条普通事项。
6. **`test-native-reminders.js` 的 Java 源码正则**未收口（复核第 6 条），改法见 `docs/decisions/proposal-rework-round4-verification-fixes-2026-09-19.md` 条 3。
7. **F06 的「普通通知后台投递持久证据」仍未覆盖**：本轮只把实时监听这条通道打通并测透，LocalNotifications 的后台冷启动证据**未补齐**，不声称其已全通。这与验收 F01 的要求一致，此处如实标为**未覆盖**。
8. **`projects` 与 D-09 冲突**、`USE_FULL_SCREEN_INTENT` 文案未审 —— 均**原样遗留**。

---

## 9. 交付物与回交信息

- 报告：本文件。
- 证据目录：[`docs/reviews/verification-runs/20260919T235500-ux-rework/`](verification-runs/20260919T235500-ux-rework/)（含 README 说明每个文件怎么复现）。
- 候选：[`releases/candidates/20260919T235500-ux-rework/`](../../releases/candidates/20260919T235500-ux-rework/)（debug/release + `SHA256SUMS.txt`）。
- 分支/提交：**`main`，HEAD `8d1c2617…`，`HEAD == origin/main`，未提交未推送**；工作区 86 条未提交改动。
- 动作：**未提交、未推送、未改 HEAD、未装设备、未清用户数据、未改设备设置。**
- 需要决策或注意的：
  - `releases/安心收件箱-debug.apk` 已在构建后**按字节还原**到开工前的 `186c28b9…`；
    它与 HEAD（`cb6a9217…`）的差异是**返工开工前就存在的**，不是本轮造成的。
  - §7 的 `sw.js` ASSETS 漏 `lib/native-reminders.js`：是否立裁决修复。
  - §8 各项均**原样遗留**，未擅自处理。
- **是否通过由独立验收复验决定；本报告不自行宣布通过。**
