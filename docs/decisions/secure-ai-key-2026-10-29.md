# D74 · AI 密钥使用 Android Keystore 加密存储并排除系统备份

日期：2026-10-29。范围：P2 安全；Capacitor 7，minSdk 23 / targetSdk 36。

## 现状与决定

原来的 `settings.ai.apiKey` 与完整状态一起写入 IndexedDB、localStorage 镜像和 pending-replay 快照。模型默认值与内存配置保留该字段，方便现有 AI 请求和设置界面使用。`app-backup.js` 的旧格式导出恒将 apiKey/baseUrl 置空，`export-format.js` 通过设置白名单排除密钥与嵌套对象；两条导出路径继续保持此契约。

Android 新增 SecureKey 原生插件（get/set/remove）。AES 密钥由 AndroidKeyStore 生成并持有；使用 AES/GCM/NoPadding、每次加密由提供方生成新的随机 IV、128 位认证标签。CE SharedPreferences `secure_ai_key.xml` 只存 IV 和密文，不存明文或 AES 密钥；使用同步 commit 确认落盘后才允许清理旧明文。插件不记录密钥或底层异常信息。

Android 常规保存与 pending-replay 写回仅从独立快照删除 apiKey，prepareSnapshot 不访问安全存储。安全存储写入仅发生在 AI 设置保存与启动旧密钥迁移（包括 pending-replay 在脱敏写回前的迁移）。AI 设置先确认安全写入，再更新内存和保存状态；空字符串明确删除安全存储。平台明确为 Android 时，插件缺失或调用失败不能回落明文。Web/Node 继续使用原有存储兼容行为。启动迁移失败时阻止覆盖旧明文副本，保留密钥供重试；恢复成功后普通事项保存不依赖 Keystore。

启动先恢复权威状态，再迁移非空旧密钥或从 SecureKey 恢复内存配置；迁移成功后覆盖主库并清理 localStorage 镜像与 pending-replay 中的字段。IndexedDB 首次导入旧 localStorage 时，不再把明文复制进新库，而是交给启动迁移。失败保留尚未清理的原副本并提示重启重试；已确认写入安全存储的密钥不会因后续主库/镜像失败而丢失。重复启动可继续完成清理。权威数据优先，旧镜像不覆盖权威密钥。

“测试连接”通过调用参数传入临时配置，不再临时替换全局 settings.ai，避免其他事项保存恰好把测试输入持久化。Android 设置保存成功提示等待安全存储与状态提交完成。

## 备份和恢复

保留 allowBackup=true，增加 fullBackupContent（API ≤30）和 dataExtractionRules（API ≥31，cloud-backup 与 device-transfer 均覆盖）。两套规则仅排除 `sharedpref/secure_ai_key.xml`，保留 `root/app_webview/` 和其他 SharedPreferences，使事项、笔记、项目与原生排程可随云备份和换机迁移。

取舍：升级迁移会清理逻辑明文字段，但无法保证 Chromium 日志、WAL/LevelDB 历史残片的物理擦除；接受此边界以保留系统迁移的业务数据。规则不能撤回已有历史云备份，旧版备份可能仍含旧明文，恢复后需再次迁移。

Keystore 密钥不参与备份。残留密文被恢复、认证标签损坏或密钥失效导致解密失败时，原生插件确认清除密文后尽力删除失效别名，删除异常不影响返回 reset；写入时遇到存在但无密钥的别名，删除后重新生成。get/set/remove 保持 synchronized。插件返回 reset；界面提示“AI 密钥无法解密，已清除，请重新填写”。一般存储/桥接异常返回失败，不崩溃、不回退明文。正常 remove 仅清除密文，保留可复用的 AES 别名。

## 验证与边界

新增 `test-secure-ai-key.js`：迁移幂等、失败保留旧值、Android 无桥时迁移失败保留旧值、普通保存不调用桥接、Web 回退、安全存储恢复/重置提示、持久化与回放脱敏、旧格式/标准格式导出不含哨兵密钥、两代系统备份规则覆盖。生产组合启动测试新增真实脚本装配下的主库/镜像迁移与失败保留测试；现有 Android 测试环境补齐 SecureKey mock。

本次复审修复验证：`node test-secure-ai-key.js` 通过（包括普通保存零安全存储调用、设置安全写入失败不替换内存、回放迁移失败保留原副本、回调缺失及精准备份排除）；`npm test` 16/17 套件通过。唯一失败为 `test-native-reminders.js:337` 的跨时区子进程返回空 stdout 后 JSON.parse 失败，与此前记录一致，尚需外部环境复跑。SecureKeyPlugin 使用 Android 36 android.jar 与 Capacitor 7 已有编译类完成 javac 检查；本次未运行完整 Gradle 构建。`git diff --check` 通过。测试日志：`/tmp/secure-ai-fix-tests.log`。

Node mock 不能证明 AndroidKeyStore 的设备实现、系统 Backup Manager/OEM 换机行为或磁盘物理清除。真机需覆盖：

1. 安装旧版并设置哨兵密钥，分别准备 IDB、镜像、pending-replay；升级后检查密钥仍可请求 AI，三处不含 apiKey 明文，secure_ai_key.xml 只有 IV/密文；杀进程重开验证幂等。
2. 模拟安全写入失败，确认旧副本与内存密钥保留；解除故障重启后完成迁移。模拟状态写入/镜像清理失败，确认安全副本可用于后续重试。
3. 新填、修改、清空密钥；禁用 AI 后保存并重启；测试连接期间并发保存事项，确认测试输入不会持久化；导出两种格式并检索哨兵。
4. API 23/30 与 API 31/36 分别使用 Backup Manager 和设备迁移验证排除规则，确认仅排除 secure_ai_key.xml，事项、笔记、项目及原生排程均恢复，AI 密钥需重新填写。
5. 保留密文并删除 Keystore 别名，或篡改 GCM 密文，重启后确认提示重新填写且不崩溃；填写新密钥后能正常保存、重启及调用 AI。
