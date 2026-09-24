# P2-C：数据备份整体迁出 app-core → lib/app-backup.js（实施方自测）

- run：`20260921T1330-p2c-app-backup-extraction`
- 日期：2026-09-21
- 基点：HEAD `3574824`（== origin/main），**工作区 98 条脏条目即交付身份**（未提交未推送）
- 前序：P2-A（run `20260921T0900-p2a-app-ai-extraction`）之后按计划顺序继续逐支收口；
  本轮只迁出**备份**一支；未执行 `checkout`/`restore`/`stash`；未覆盖旧 run/APK/证据；未进 P3。

## 1. 范围与做法

唯一实现体在新模块 `lib/app-backup.js`（UMD，导出 `createAppBackup(deps)` +
纯函数 `isShareCancellation` + 常量 `EXPORT_RESULT_GRACE_MS`），包含：
`buildLegacyBackupPayload`（**密钥排除**：`settings.ai.baseUrl/apiKey` 恒空串）、
`exportData`（原生 saveDocument / Web 分享 / `<a download>` 三通路，操作身份 + 在途闸门）、
`importDataFile`（确认 → 覆盖 → 同一条 `save()` 持久化边界）、
`noteExportAppVisibility`（原生「结果未返回」8 s 宽限闸门）、
`setExportBusy` / `clearPendingNativeExport`（实例内部）、`downloadFile`（Web 下载原语）。

`app-core.js` 中实现体整体删除（-221 行）、**不留转发壳、不留双实现**；
调用点一律写 `backup.xxx()`；实例内状态（`exportInProgress` / `exportOperationId` /
`pendingNativeExport`）随实例走，重试时整套换新。

**依赖全部按函数注入**（`backupRuntimeDeps()`，共 11 项）：`getState` / `getSchema` /
`normalizeItem` / `save` / `render` / `toast` / `confirmDialog` / `query` /
`isNativeAndroidRuntime` / `systemBridge` / `getInflightActionDepth`。
刻意不给：`state` 的独立写权（覆盖形状校验用注入的 `normalizeItem`）、
第二条持久化路径（导入走与表单/撤销**同一条** `save()`）、`inflightActionDepth` 的写权。
缺任一依赖 ⇒ 工厂即抛（不在静默降级里跑半套）。

**已知缺口（逐字保留、未修）**：Web 回退通路的 `<a download>` 在 Android 上没有落地出口
（「导出没有落地出口」待裁决 E1–E4）。修它属产品决策，必须先过裁决 —— 本轮不动。

## 2. 行为所有权变化

| 行为 | 迁出前 | 迁出后 |
|---|---|---|
| 备份快照构建（含密钥排除） | app-core.js | `lib/app-backup.js`（唯一实现） |
| 导出三通路 + 在途闸门 + 操作身份 | app-core.js | `lib/app-backup.js` |
| 原生导出「结果未返回」宽限闸门 | app-core.js | `lib/app-backup.js`（实例内状态） |
| Web 下载原语 `<a download>` | app-core.js | `lib/app-backup.js`（行为逐字保留） |
| 导入覆盖 + 确认 + 持久化 | app-core.js | `lib/app-backup.js`；持久化走**注入的同一 `save()`** |
| blur/focus/visibilitychange 监听注册 | app-core.js | 仍在入口（注册点），回调委托 `backup.noteExportAppVisibility` |
| 覆盖形状校验（`normalizeItem`） | app-core.js | 仍由入口注入 —— 模块不自造第二条解析规则 |

## 3. 同步的加载链（六处 + 一张表）

- `index.html`：`<script src="lib/app-backup.js">`（app-ai 之后、parse-cn 之前）
- `sw.js`：`ASSETS` 增加条目，缓存版本 v11→**v12**
- `test-smoke.js` / `test-regressions.js`（`LIB_SOURCES`）/ `test-boot-combination.js`
  （`EXPECTED_INDEX_SCRIPTS`）/ `production-scripts.js`（`NAMESPACE_PATHS` +
  `backupInstanceCoverage()`，与 ui/ai 同构的双向闭合）
- `REQUIRED_RUNTIME_EXPORTS` 声明表 +2 条（`AppBackup` / `AppBackup.createAppBackup`）
  —— 类型分布不变（function/object 均在白名单）

## 4. 反例（全部「拔掉修复必须变红」）

- `test-boot-combination.js` ⑫：抽掉 `lib/app-backup.js` ⇒ ready 失败、**只**点名
  AppBackup 系（无连带误报）、零读库零定时器、可见失败面板写明 AppBackup；
- B3 ⑤·4：`AppBackup.createAppBackup = () => ({})` 空壳 ⇒ 闸门逐项点名全部 4 个实例 API、
  既有绑定不被覆盖；⑤·5：工厂抛错 ⇒ 报 `AppBackup.createAppBackup() threw:…`；
- B4 **N8**（静态+运行时）：清空 `APP_BACKUP_INSTANCE_CONTRACT.instance` ⇒ 双向闭合报
  missingInContract ≥4；同一空壳重新被放行（对照面：未变异源码逐项点名）；
  收口断言证明 N8 只差 1 行、工作区未被改写；
- **收口断言的牙齿实录**：插入 AppBackup 声明后，N7 的删除终点锚一度把 AppBackup 的
  4 条声明**一并删掉**（变异从拔 4 条变成拔 9 条）—— 被既有行数收口断言当场报红，
  修正终点锚为下一条声明后回绿。这正是收口断言存在的意义；
- Chrome（真浏览器）：`shell-backup`（工厂空壳）与 `missing-app-backup`（整支 404）
  两个新用例，均判 ready=false、可见面板、opens=0/puts=0、失败清单全为 AppBackup 系。

## 5. 回归结果（八套全绿，exit 0，原始日志见 logs/）

| 套件 | 本轮 | P2-C 前 | Δ |
|---|---|---|---|
| test-unit | 465 通过 | 465 | 持平 |
| test-boot-combination | **322** 通过 | 308 | +14（⑫/⑤·4/⑤·5/N8） |
| test-smoke | 256 通过 | 256 | 持平（备份行为断言原样通过） |
| test-regressions | 730 通过 | 730 | 持平 |
| test-native-reminders | 321 通过 | 321 | 持平 |
| parse-single-source | 160 通过 | 160 | 持平（单一来源闭合） |
| ui-format-parity | 567 一致 | 567 | 持平 |
| ui-dom-parity | 590 一致（16 场景） | 590 | 持平 |

P2-A 的 2240 水位全部保留（465/321/308/256/730/160），本轮 boot 增至 322 ⇒ **2254**。
静态矩阵 `runtimeDependencyCoverage().problems` 为空；`backupInstanceCoverage` 双向闭合
（`missingInContract=[] unusedInContract=[]`），反向注入 `backup.brandNewBackupApi()` 当场报出。
Chrome 真浏览器 **12 用例 0 项断言不满足**（原 10 例 + 新 2 例），证据见 browser/。

## 6. 交付身份

- `source-hashes.txt`：15 个交付文件的 SHA-256（**工作区字节即交付身份**）
- `git-head.txt`：`3574824…`；`dirty-count.txt`：98；`dirty-files.txt`：全部脏条目清单
- 本轮未提交、未推送；未触碰任何旧 run 目录、旧 APK、旧验收证据。

## 7. NOT_PERFORMED（不得豁免成 PASS）

见 `not-performed.md`。要点：自测 ≠ 独立验收；「导出没有落地出口」缺陷**原样保留**
（待裁决 E1–E4）；导入路径在真实浏览器/真机上的端到端未验证；P2 剩余（诊断/引导/
内容视图/表单 + 逐功能拆 `bind()`）、P3、P4、APK、实机全部未做。
