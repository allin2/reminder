# P2-C-S B1 修复：独立复验与 Android 真机收口

- run：`20260922T142800-independent-p2cs-b1-android-recheck`
- 仓库：`/Users/qlyf/Developer/reminder`
- HEAD / origin/main：`3574824357dc7beb04cbd3e32aa413cd508e8484`
- 实施方 run：`20260922T1400-p2cs-b1-iso-time-fix`
- 设备：`QSKFAE95CQEUJZ8L` / OPPO PKC130 / Android 16
- 隔离测试包：`space.alliswell.inbox.exportrecheck`
- 总结论：**PASS**

## 1. 裁决

上一轮阻断 B1 已关闭：当前 `lib/app-backup.js` 能接受设备历史状态中严格带时区的 ISO 时间，只在整树验证成功后于 sanitized 新副本中一次性迁移为 epoch 毫秒；输入对象不改写，非法字符串、无时区字符串、负数和 1970 年前时间继续拒绝。

独立 Node、Chrome、APK 字节身份与 Android 真文件选择器四层均成立。两个非法文件在真实 `DocumentsUI` 路径中被整体拒绝且权威存储零副作用；合法历史备份导入后，迁移结果经 `force-stop` 冷启动保持 `loaded / authoritative / idb`。

因此 P2-C-S 格式安全面可按本批次范围判定通过；P2-C-R / R2 既有结论未被破坏。

## 2. 源码与候选身份

实施方交付哈希与工作区逐字节一致：

- `lib/app-backup.js`：`6871da9c87c906b943762a75c73573cbf9b9c13c84c40e8860652f3a3c8104e0`
- `test-unit.js`：`989d841c0c40b767cba140ed3ef0577262be269aaa4c80db03f3bb1e7ade3ebe`
- `sw.js`：`a6728dfba3acb8d5eb4368a1e80246a6db62e778354655a0039e4`
- `browser-import-format-check.py`：`f5d638244072233ee55f08ba1c1f565b133eba2f405a6b72183f542f855f17ea`
- `app-core.js`：`c7e0e09fd4bdb4235c4a653cb07232ddb26d54adc04625ca18b5e84de7a47cda`

隔离候选：

- 路径：`releases/candidates/20260922T142800-independent-p2cs-b1-android-recheck/attention-inbox-p2cs-b1-debug.apk`
- SHA-256：`c945a66147e5c7b68da78416589823ed44b74fd23f5572040e13557f418ca3ae`
- APK 内 22 项产品 Web 资源与当前工作区逐字节一致；额外两项仅为 Capacitor 生成的 `cordova.js` / `cordova_plugins.js`。
- 设备已安装 `base.apk` 与候选 APK 逐字节一致。
- 临时 `applicationIdSuffix=.exportrecheck` 构建完成后，`android/app/build.gradle` 哈希前后相同，已还原。
- 覆盖安装后 `firstInstallTime` 仍为 `2026-09-21 16:10:02`，数据目录未变，说明没有卸载或清数据。

证据：`evidence/source-hashes*.txt`、`apk/apk-hash.txt`、`apk/badging.txt`、`apk/apk-assets-byte-compare.*`、`apk/candidate-installed-hashes.txt`、`evidence/build-gradle-restore.txt`、`device/package-*.txt`。

## 3. 离线与 Chrome 独立复验

### npm test

exit 0，共 **2462** 项通过、0 失败：

- unit 607
- native 324
- boot 384
- smoke 257
- regressions 730
- parse 160

### 真实 Chrome

`browser-import-format-check.py` 独立重跑 exit 0，**11/11 PASS**。新增 `legacy-iso-time` 直接读取上一轮独立复验保存的设备 payload，确认后 IDB put `0→1`，新页面冷启动读回的 item/note `createdAt` 全为 `number`；原 10 个正反例不变。

### 设备历史 payload 离线回环

独立直调当前验证器：

- 真实 payload 验证通过；
- item/note 的 `2026-09-21T08:00:00+08:00` 均转成 `1789948800000`；
- 输入对象逐字不变；
- 无时区字符串、普通文字、负数和 1970 年前 ISO 四个反例全部在 `items[0].createdAt` 拒绝。

证据：`logs/npm-test.log`、`logs/browser.stdout.log`、`browser/browser-import-format.json`、`evidence/device-payload-offline-roundtrip.json`。

## 4. Android 真机：安装前与覆盖安装

安装前权威记录：

- IDB SHA-256：`0625aacabcd5068ab0d762e44b25b2937a7bdc7a47004b3f3bea1e3e4e8f77d2`
- 2443 字节；2 个事项、1 条笔记、1 个项目。
- 历史字段仍为字符串：`items[0].createdAt`、`notes[0].createdAt` 均是 `2026-09-21T08:00:00+08:00`。

覆盖安装候选并首次启动后：

- IDB 原始记录与安装前 `cmp` 相同；
- 权威态为 `loaded / authoritative / idb`；
- `writesAllowed=true`、`blockedWriteCount=0`。

这证明候选覆盖安装本身没有迁移或改写用户状态，迁移只发生在用户确认合法导入之后。

## 5. Android 真文件选择器：两个非法文件零副作用

两个文件均由页面真实导入按钮的设备 `input tap` 唤起 `com.android.documentsui/.picker.PickActivity`，再在系统“下载”目录中点选；未用 CDP 合成文件 input。

### A. app 身份错误

- 文件：`aa-p2cs-wrong-app.json`
- 页面立即提示：`导入失败：这不是「安心收件箱」的备份文件`
- 未执行确认或保存步骤；事项/笔记/项目仍为 2/1/1。
- IDB 原始记录仍为 `0625aaca…` / 2443 B，前后逐字节相同。
- IDB 与镜像目录的文件数、总字节和组合哈希前后完全相同。

首次为该用例附加抓 WAL 时，主机 shell 把远端 `*.log` 提前展开，导致 `wrong-wal-name.txt` 为空、两份 `wrong-wal-*.bin` 为 0 字节；这些文件**不作为 WAL 结论证据**，原样保留为工具失败记录。本用例的零副作用结论只使用有效的 IDB 原始记录逐字节比较和两侧完整目录组合哈希；下一用例已修正命令并取得有效 WAL 证据。

### B. AI 密钥与端点注入

- 文件：`ab-p2cs-ai-secret.json`
- 页面立即点名：`导入失败：备份格式不正确（settings.ai.baseUrl）`
- 未执行确认或保存步骤；事项/笔记/项目仍为 2/1/1。
- IDB 原始记录前后逐字节相同。
- IDB 与镜像目录的文件数、总字节和组合哈希前后完全相同。
- IDB 普通文件集合前后相同；WAL 增量 `0 B`，`VERDICT=NO_OPERATIONS`。

证据：`device/picker-*.xml`、`device/wrong-*`、`device/secret-*`。

## 6. Android 合法历史备份与冷启动

合法文件 `ac-p2cs-valid-legacy-iso.json` 是候选安装前由测试包真实 `buildLegacyBackupPayload()` 导出的备份，并非重新构造的理想样本。

在系统选择器选中后：

- 页面显示 `导入数据 / 导入将覆盖当前数据，继续？`；
- 使用真实设备 tap 点“确定”；
- 成功提示为 `导入成功 · 2 条事项`；
- 2 个事项、1 条笔记、1 个项目及原有标题/ID 均保留；
- `items[0].createdAt` 与 `notes[0].createdAt` 均落库为数值 `1789948800000`；
- 第二个事项既有数值 `1790009208456` 原样保留；
- 权威记录变为 `bf50272a6257fb63025e4c01a77b222e986523b030833d3e09599c9b44f66d10` / 2415 B，证明迁移已经真实提交。

随后执行一轮 `force-stop → 冷启动`：

- 死亡窗口 3 秒间隔两次 IDB/镜像文件哈希完全相同；
- 冷启动前后权威记录均为 `bf50272a…` / 2415 B，逐字节一致；
- 页面判定始终为 `loaded / authoritative / idb`、`writesAllowed=true`、`blockedWriteCount=0`；
- WAL 仅增加 LevelDB 打开产生的 19 B 空 WriteBatch，解析为 `OPS=0 / EMPTY_MARKER / NO_OPERATIONS`，没有启动写回；
- 冷启动后 item/note 的 `createdAt` 仍全部为 `number`。

本次合法导入用的就是安装前备份，因此最终设备保持原来的 2/1/1 逻辑数据；原始 ISO 字符串按本修复设计完成一次性迁移，故最终原始记录哈希与安装前不同是预期结果，不能反向恢复成旧字符串。

证据：`device/valid-*`、`device/coldstart.log`、`device/coldstart/wal-delta-round-1.txt`、`device/final-*`。

## 7. 边界与现场

- 本轮验收命令未对生产包 `space.alliswell.inbox` 执行安装、覆盖、清数据或业务操作；仅用 `dumpsys package` 只读核对身份。最终仍为 `lastUpdateTime=2026-09-20 23:49:16`、`firstInstallTime=2026-09-20 15:07:22`。
- 未提交、未推送；HEAD 仍为 `3574824…`，保留既有脏工作区。
- 三个测试输入仍保留在测试设备 `/sdcard/Download/`：`aa-p2cs-wrong-app.json`、`ab-p2cs-ai-secret.json`、`ac-p2cs-valid-legacy-iso.json`。它们未删除，便于复算且避免未经明确授权删除设备文件。
- 本轮只裁决 P2-C-S 与 B1 修复；P2 剩余、P3、P4、正式生产 APK/发布签名与其他实机功能不在本结论范围。
