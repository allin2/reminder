# P2-C `app-core.js` 备份模块迁出：独立复验

- run：`20260921T134843-independent-p2c-backup-recheck`
- 角色：独立验收方；未参与实现
- 待验对象：未提交工作区，基线 HEAD `3574824357dc7beb04cbd3e32aa413cd508e8484`
- 裁决：**P2-C 模块迁移 PASS_WITH_GAPS**

`lib/app-backup.js` 的单一实现、加载链、装配闸门、失败原子性和迁移前行为均通过独立复验。备份功能本身仍不能判完整 PASS：实施方已声明的 Android WebView 下载落地缺口仍在；本轮还独立确认了两个继承的导入缺口——文件读取失败无反馈，以及持久化提交尚未兑现便提示“导入成功”。

验收期间未执行 `checkout`、`restore`、`stash`、`reset`，未修改产品源码、测试源码或旧证据；只新增本 run 的日志、探针与报告。

## 交付身份

- `HEAD == origin/main == 3574824357dc7beb04cbd3e32aa413cd508e8484`
- 独立取证开始时 dirty count 为 100。实施方记录 98；新增的实施方 run 与本独立 run 各形成一个未跟踪目录，关键交付文件 SHA-256 与实施方 `source-hashes.txt` 逐项一致。
- `app-core.js`：8,510 行 / 403,228 字节，SHA-256 `f40e1b03efacaa9523b628b335dde91cfaa9c0065b6a961126fc712b398699f5`
- `lib/app-backup.js`：351 行 / 15,410 字节，SHA-256 `e4828f4b172b404275dfea67556e69596fcf18497bfa09f39c14233caea4a54a`
- 身份记录：`evidence/source-identity-start.txt`

## 验收记录

### F01 | 全量回归

- 命令：`npm test`
- 输出：unit `465/0`、native `321/0`、boot `322/0`、smoke `256/0`、regressions `730/0`、parse `160/0`，合计 **2254 通过、0 失败**，退出码 0。
- 判定：**PASS**
- 证据：`evidence/npm-test.log`、`evidence/npm-test.exit`

### F02 | UI 对照

- 命令：`ui-format-parity.js`、`ui-dom-parity.js`
- 输出：格式 **567** 项一致；DOM **16 场景 / 590 字段**一致；退出码均为 0。
- 判定：**PASS**
- 证据：`evidence/ui-format-parity.log`、`evidence/ui-dom-parity.log`、`evidence/ui.exit`

### F03 | 单一实现与求值期副作用

- 独立探针检查 `downloadFile`、`buildLegacyBackupPayload`、`setExportBusy`、`clearPendingNativeExport`、`noteExportAppVisibility`、`isShareCancellation`、`savedBackupMessage`、`exportData`、`importDataFile`。
- 输出：九个函数在 `app-core.js` 定义数均为 0，在 `lib/app-backup.js` 均为 1；模块求值只写 `AttentionLib.AppBackup`，没有启动定时器、监听、存储或 DOM 操作。
- 判定：**PASS**
- 证据：`evidence/independent-p2c-probe.js`、`evidence/independent-p2c-probe.json`

### F04 | 加载链与静态闭合

- 输出：`index.html` 和 SW 预缓存均只有一份 `lib/app-backup.js`；缓存名 v12；`runtime.problems=[]`、`precache=[]`、`packaging=[]`；备份实例 `missingInContract=[]`、`unusedInContract=[]`。
- 反例：向内存源码增加 `backup.independentMissing()` 后，仅出现 `missingInContract=["independentMissing"]`。
- 判定：**PASS**
- 证据：`evidence/static-coverage.json`、`evidence/independent-p2c-probe.json`

### F05 | 缺件、迟加载和失败重绑

- 缺整支模块：`ready=false`，只点名 `AppBackup` 与 `AppBackup.createAppBackup`；落库、通知排程、闹钟排程、心跳均为 0。
- 同页补载：`startApp()` 恢复为 true，绑定真实 `exportData`；第二次启动不增加心跳。
- 空壳工厂：四个实例成员全部被点名，失败重绑后 `exportData` 仍是此前健康实例的同一个函数。
- 判定：**PASS**
- 证据：`evidence/independent-p2c-probe.json`

### F06 | 导出行为

- 独立探针确认实例每次读取当前状态，备份内 `settings.ai.baseUrl/apiKey` 均为空，模型与非敏感开关保留。
- 原生替身路径只在 `saveDocument` 返回 `saved` 后提示成功，内容为旧兼容 JSON，按钮随后解除 busy。
- 判定：**PASS（代码/替身层）**
- 边界：真实 Android SAF 仍为 `NOT_PERFORMED`；WebView `<a download>` 无落地出口仍是已知缺陷。
- 证据：`evidence/independent-p2c-probe.json`

### F07 | Chrome 故障注入

- 输出：**12 用例、0 项断言不满足**。控制组 `ready=true / opens=1 / puts=1`；`shell-backup` 点名四个实例 API，`missing-app-backup` 点名两个模块导出，两者均 `opens=0 / puts=0` 且出现可见失败面板。
- 判定：**PASS**
- 证据：`evidence/browser-command.log`、`evidence/browser.exit`、`browser/browser-recovery.json`

### F08 | 真实 Chrome 导入链

- 独立创建真实 `File`，通过隐藏的 `#importFile` 触发生产 change 监听，点击生产确认框。
- 输出：确认框标题/正文正确；导入后 items/notes/projects 各为 1，`notify=false` 生效，IndexedDB `puts=1`，提示“导入成功 · 1 条事项”，刷新后事项仍存在；8 个判据全部通过。
- 判定：**PASS（桌面 Chrome）**
- 证据：`evidence/browser-import-probe.py`、`evidence/browser-import-command.log`、`evidence/browser-import.exit`、`browser/browser-import.json`

## 发现

### G01 | FileReader 失败时静默

- 位置：`lib/app-backup.js` 的 `importDataFile()` 只设置 `reader.onload`，没有 `reader.onerror` / `reader.onabort`。
- 独立反例：让 FileReader 触发读取错误，结果 `toast=[] / save=0 / render=0`，用户看不到任何结果。
- 基线核对：HEAD 旧实现同样没有错误处理，因此是**继承缺陷，不是迁移回归**。
- 影响：文件损坏、读取权限或内核读取失败时，导入按钮表现为“点了没反应”。
- 判定：**GAP；后续修复项**

### G02 | 持久化确认前提示导入成功

- 位置：`importDataFile()` 调用 `deps.save()` 后不等待返回的 Promise，立即 `render()` 并提示“导入成功”。入口注入的 `save()` 实际返回权威提交 Promise。
- 独立反例：让 `save()` 返回未兑现 Promise，提交仍未完成时已出现成功提示且完成渲染。
- 基线核对：HEAD 旧实现也是直接 `save(); render(); toast(...)`，因此同样是**继承缺陷，不是迁移回归**。
- 影响：用户在提示成功后立即关闭应用，或 IDB 提交随后失败时，导入数据可能只存在内存；“成功”高于证据等级。
- 判定：**GAP；备份可靠性阻断项**

## NOT_PERFORMED

- Android WebView 的真实文件导入。
- Android SAF `saveDocument` 的真实取消、失败、保存位置与 8 秒回调宽限。
- WebView `<a download>` 落地修复；当前已知不会形成真实备份文件。
- `notes/projects/settings` 的逐项外部输入形状校验与备份 schema/app 身份校验。
- P2 剩余模块、P3、P4、APK 构建、离线升级和实机验收。

## 推进建议

P2-C 的“迁移与单一来源”可收口，但备份功能不能写成完整 PASS。进入下一支 P2 前，应把 G01/G02 与既有 E1–E4 一起放入备份修复批次：读取失败明确反馈；导入成功必须等待 `await deps.save()` 权威兑现；WebView 导出改走 SAF，并分别处理 saved/cancelled/failed/unavailable/stale。上述修复完成后再做 Android 真机导入、导出和离线升级验收。
