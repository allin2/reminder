# P2-C-S 整库导入格式安全面：独立复验

- run：本目录
- 仓库：/Users/qlyf/Developer/reminder
- HEAD / origin/main：3574824357dc7beb04cbd3e32aa413cd508e8484
- 实施方 run：20260922T1304-p2cs-import-format-hardening
- 角色：独立验收方
- 总结论：**FAIL / FIX_REQUIRED**

## 1. 裁决

身份、schema、未知字段、重复 id、AI 密钥/端点和零副作用拒绝等负向防线已在 Node 与 Chrome 中成立，但合法兼容面的核心正向条件失败：

**当前源码从设备现存权威状态生成的 schema 5 备份，无法通过当前源码自己的 validateBackupPayload()。**

因此本批次不能进入 Android 候选安装和破坏性导入，不能视为 P2-C-S 通过。

P2-C-R 权威状态保护结论不受影响；本次失败只约束 P2-C-S 整库格式加固。

## 2. 阻断项 B1：自家真实备份不能回环

设备测试包 space.alliswell.inbox.exportrecheck 当前为：

- loaded / authoritative / idb；
- 2 项事项、1 条笔记、1 个项目；
- 这批数据已在此前 P2-C 真机回环、冷启动和权威状态复验中持续保留。

从该应用真实调用 buildLegacyBackupPayload() 得到的 schema 5 文件包含：

- items[0].createdAt = "2026-09-21T08:00:00+08:00"
- notes[0].createdAt = "2026-09-21T08:00:00+08:00"

这两项是历史上已经进入并被应用保留的带时区 ISO 字符串。当前 app-core.js 的 normalizeItem() 对 truthy createdAt 原样保留，notes 也没有统一时间迁移，所以它们属于真实兼容面。

将这份真实状态交给当前源码哈希 e59f32c4… 的 buildLegacyBackupPayload() 再调用当前 validateBackupPayload()，结果为：

- ok=false
- code=field-type
- path=items[0].createdAt
- message=时间戳必须是有限数字（毫秒）或 null

把 item 的字符串时间仅在诊断副本中转换成毫秒后，下一处又失败在 notes[0].createdAt。两处都转换后才通过。

这证明失败不是旧安装包脚本造成的：当前源码的导出器和验证器在同一个 Node 进程内同样不能闭合。

证据：

- evidence/device-preexisting-backup.json
- evidence/device-preexisting-field-types.txt
- evidence/device-preexisting-backup-validation.json
- evidence/current-source-self-roundtrip.json
- evidence/compatibility-probes.json

## 3. 为什么实施方测试没有发现

实施方的“真实 schema 5 事项”是手工构造的 REAL_ITEM，所有时间字段都使用毫秒数字。Chrome 的 control-valid 和 legacy-schema2 同样只使用最小人工对象。

它们验证了严格格式的理想路径，但没有把以下对象作为正向夹具：

1. 设备现存状态；
2. 旧版本应用实际持久化过的状态；
3. buildLegacyBackupPayload() 对含历史字段类型状态的真实输出。

因此 106 条新增断言、四项变异与 Chrome 10/10 全绿，仍未覆盖“应用已经能够持有的数据必须能被应用自己的备份恢复”这一正向边界。

## 4. 已通过部分

### 源码身份

当前五个交付文件与实施方 source-hashes-after.txt 全部一致：

- app-core.js：c7e0e09f…
- lib/app-backup.js：e59f32c4…
- test-unit.js：288e7444…
- sw.js：b9ff15b6…
- browser-import-format-check.py：235104ee…

归档的 Chrome 脚本副本与工作区脚本逐字节一致。

### 自动化

独立重跑 npm test：exit 0。

- unit 598 / 0
- native 324 / 0
- boot 384 / 0
- smoke 257 / 0
- regressions 730 / 0
- parse 160 / 0

独立重跑 browser-import-format-check.py：10/10 PASS、exit 0。

已确认的负向行为：

- wrong-app、future-schema、缺 notes、notes 错型、重复 id、AI 密钥/端点、未知 settings 键；
- 全部不弹确认框；
- IDB put 增量为 0；
- 状态不变；
- toast 点名错误路径。

正向人工控制组 valid、cancel、schema 2 也按脚本预期通过。

证据：

- logs/npm-test.log
- logs/npm-test.exit
- logs/browser-import-format.stdout.log
- logs/browser-import-format.exit
- browser/browser-import-format.json

## 5. 最小修复要求

不要放宽成“任意字符串时间都接受”。建议在唯一验证器内明确兼容历史时间表示：

1. ITEM_TIME_FIELDS 与 note createdAt/updatedAt 接受：
   - 有限、非负 epoch 毫秒；或
   - 严格带时区且 Date.parse 有效的 ISO 字符串。
2. sanitized 副本必须把合规 ISO 字符串转换为 epoch 毫秒，完成一次性迁移；不能把字符串继续写回权威状态。
3. null 仍只在原本可空字段允许；createdAt 若作为必需事实，应明确是否允许缺失。
4. 非 ISO 字符串、无时区字符串、NaN、Infinity 和负数仍拒绝。
5. 新增两层正向反例：
   - 直接使用本次 evidence/device-preexisting-backup.json；
   - 用当前 buildLegacyBackupPayload() 对包含 ISO createdAt 的历史状态导出，再喂回当前验证器。
6. Chrome 新增 legacy-iso-time：必须进入确认，确认后 IDB put 0→1，冷启动读回的 item/note createdAt 为毫秒数字。
7. 保留现有所有负向反例与四项变异。

修复后 lib/app-backup.js 内容变化，sw.js 需从 v16 再升缓存身份。

## 6. 另外两项记录

### 实施报告文字错误

实施报告写 items/notes/projects “必须是数组且非空数组”，实际源码允许空数组，独立直测空库备份 ok=true。代码行为正确，报告应改为“必须是数组”；合法空库必须可备份和恢复。

### quietStart/quietEnd 的文案与判据不一致

验证器错误文案称必须是“形如 23:00”的字符串，实际只检查非空字符串，not-a-time 仍 ok=true。lib/reminder.js 会回退默认时刻，因此本轮不把它升级为阻断；实施方应选择：

- 收紧为合法 HH:MM；或
- 把文案改成真实判据，并把此项记入明确边界。

本项不能遮盖 B1。

## 7. NOT_PERFORMED

由于“真实自家备份可回环”这一前置 Gate 已失败，以下下游验收停止：

- 未为本批次构建 Android APK；
- 未覆盖安装测试包；
- 未执行真实 Android 文件选择器导入；
- 未执行 leveldb 文件层零副作用反例；
- 未执行合法备份导入后的 force-stop 冷启动持久化；
- 未验证修复后与 P2-C-R2 权威态保护的共存；
- 未提交、未推送。

停止下游是为避免用已知不能恢复现存合法数据的候选覆盖设备测试环境。生产包 space.alliswell.inbox 全程未触碰。

## 8. 复验恢复条件

实施方完成 B1 后，下一轮独立复验将按顺序执行：

1. 当前设备真实 payload 离线回环；
2. npm test 与独立 Chrome legacy-iso-time；
3. APK 内 22 项 Web 资源与工作区逐字节核对；
4. 覆盖安装 exportrecheck 测试包；
5. 两个无效文件经真实系统选择器导入，IDB 记录哈希和文件集合不变；
6. 合法备份导入，确认后记录变化；
7. force-stop 冷启动后保持 imported 数据且 state authority 为 loaded/authoritative/idb；
8. 原始测试数据按备份恢复并再次核对。
