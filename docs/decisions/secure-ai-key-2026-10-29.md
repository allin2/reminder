# D74 · AI 密钥使用 Android Keystore 加密存储并排除系统备份

日期：2026-10-29。范围：P2 安全；Capacitor 7，minSdk 23 / targetSdk 36。

## 现状与决定

原来的 `settings.ai.apiKey` 与完整状态一起写入 IndexedDB、localStorage 镜像和 pending-replay 快照。模型默认值与内存配置保留该字段，方便现有 AI 请求和设置界面使用。`app-backup.js` 的旧格式导出恒将 apiKey/baseUrl 置空，`export-format.js` 通过设置白名单排除密钥与嵌套对象；两条导出路径继续保持此契约。

Android 新增 SecureKey 原生插件（get/set/remove）。AES 密钥由 AndroidKeyStore 生成并持有；使用 AES/GCM/NoPadding、每次加密由提供方生成新的随机 IV、128 位认证标签。CE SharedPreferences `secure_ai_key.xml` 只存 IV 和密文，不存明文或 AES 密钥；使用同步 commit 确认落盘后才允许清理旧明文。插件不记录密钥或底层异常信息。

Android 所有常规保存与 pending-replay 写回，在持久化边界先写入安全存储，再从独立快照删除 apiKey。空字符串明确删除安全存储；缺字段表示已经脱敏，不执行删除。平台明确为 Android 时，插件缺失或调用失败不能回落明文。Web/Node 继续使用原有存储兼容行为。

启动先恢复权威状态，再迁移非空旧密钥或从 SecureKey 恢复内存配置；迁移成功后覆盖主库并清理 localStorage 镜像与 pending-replay 中的字段。IndexedDB 首次导入旧 localStorage 时，不再把明文复制进新库，而是交给启动迁移。失败保留尚未清理的原副本并提示重启重试；已确认写入安全存储的密钥不会因后续主库/镜像失败而丢失。重复启动可继续完成清理。权威数据优先，旧镜像不覆盖权威密钥。

“测试连接”通过调用参数传入临时配置，不再临时替换全局 settings.ai，避免其他事项保存恰好把测试输入持久化。Android 设置保存成功提示等待安全存储与状态提交完成。

## 备份和恢复

保留 allowBackup=true，增加 fullBackupContent（API ≤30）和 dataExtractionRules（API ≥31，cloud-backup 与 device-transfer 均覆盖）。两套规则明确排除 `secure_ai_key.xml`，并排除全部 SharedPreferences 与 `root/app_webview/`：SharedPreferences 不允许成为未来的密钥旁路，WebView 排除覆盖旧 localStorage/IndexedDB 及 Chromium 日志、WAL/LevelDB 的潜在残留。

取舍：系统备份/换机不恢复 WebView 业务状态和原生 SharedPreferences 设置、排程。需要保留事项时使用应用内手动导出/导入；导入后重建提醒。规则仅约束安装本版本之后生成的备份，不能撤回已存在的历史云备份。数据库字段删除也不保证闪存上的物理安全擦除，因此不能只靠清空字段保护系统备份。

Keystore 密钥不参与备份。残留密文被恢复、认证标签损坏或密钥失效导致解密失败时，原生插件清除密文和失效别名，返回 reset；界面提示“AI 密钥无法解密，已清除，请重新填写”。一般存储/桥接异常返回失败，不崩溃、不回退明文。正常 remove 仅清除密文，保留可复用的 AES 别名。

## 验证与边界

新增 `test-secure-ai-key.js`：迁移幂等、失败保留旧值、Android 无桥时拒绝明文、Web 回退、安全存储恢复/重置提示、持久化与回放脱敏、旧格式/标准格式导出不含哨兵密钥、两代系统备份规则覆盖。生产组合启动测试新增真实脚本装配下的主库/镜像迁移与失败保留测试；现有 Android 测试环境补齐 SecureKey mock。

本机除受限子进程的原生提醒套件外，16 个套件全部通过；新增安全套件通过；生产组合启动 945 项、smoke 304 项、回归 743 项通过。插件已用 Android 36 android.jar 与 Capacitor 7 的已有编译类完成 javac 检查。Gradle 构建受只读 ~/.gradle 锁文件限制，未完成完整 Android 构建。npm test 的 test-native-reminders.js 在跨时区子进程探针返回空 stdout 后 JSON.parse 失败；按任务约定不反复重试该受限子进程路径，需要外部复跑。

Node mock 不能证明 AndroidKeyStore 的设备实现、系统 Backup Manager/OEM 换机行为或磁盘物理清除。真机需覆盖：

1. 安装旧版并设置哨兵密钥，分别准备 IDB、镜像、pending-replay；升级后检查密钥仍可请求 AI，三处不含 apiKey 明文，secure_ai_key.xml 只有 IV/密文；杀进程重开验证幂等。
2. 模拟安全写入失败，确认旧副本与内存密钥保留；解除故障重启后完成迁移。模拟状态写入/镜像清理失败，确认安全副本可用于后续重试。
3. 新填、修改、清空密钥；禁用 AI 后保存并重启；测试连接期间并发保存事项，确认测试输入不会持久化；导出两种格式并检索哨兵。
4. API 23/30 与 API 31/36 分别使用 Backup Manager 和设备迁移验证排除规则，确认没有 WebView/SharedPreferences 密钥副本。
5. 保留密文并删除 Keystore 别名，或篡改 GCM 密文，重启后确认提示重新填写且不崩溃；填写新密钥后能正常保存、重启及调用 AI。
