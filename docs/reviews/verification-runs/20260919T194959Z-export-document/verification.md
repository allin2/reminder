# 导出文件可见性修复 · 验证记录

- 验证时间：2026-09-19～2026-09-20（Asia/Shanghai）
- 源码基线：`831c3c7298fb9c2b1df0b3e6f2726928d3105a28`
- 工作区：独立 Codex worktree，detached HEAD；未提交、未推送
- 设备：OPPO PKC130 / Android 16 / ColorOS，序列号 `QSKFAE95CQEUJZ8L`
- 验证包名：`space.alliswell.inbox.exporttest`（隔离数据目录）

## 结论

本次修复的核心行为通过：Android 导出会进入系统保存器，只有原生写流完成并关闭后才回报成功；取消、失败和结果未知均不报成功；同名文件由系统保存器另存为新文件；导出的旧版 JSON 可以重新导入并恢复事项、笔记和项目。

真实安装包 `space.alliswell.inbox` 未被覆盖，也未读取、修改或清空其数据。设备上原有安装包 SHA-256 为 `69c5761bc624a980937f62ffd93dedcf2f3dec0a9adea73b125013fa9eef6443`，与本工作树基线包不同，因此实机验证使用仅增加 `applicationIdSuffix=.exporttest` 和测试标签的临时隔离包。

## 需求追踪

| ID | 验收条件 | 结果 | 证据 |
|---|---|---|---|
| E1 | Android 使用系统保存对话框，文件实际落盘 | PASS | ColorOS 文件保存器选择“下载”；两个 1,985 字节 JSON 均存在且可解析 |
| E2 | 成功、取消、失败提示与真实结果一致 | PASS | 真机保存返回 `saved`；返回键取消得到 `cancelled`，按钮恢复；失败/无能力路径由自动化覆盖 |
| E3 | 每次导出均允许用户选择文件名和位置 | PASS | 两次导出均进入系统保存器；第二次同名保存生成 `_1.json` |
| E4 | Web 层共用单一 `saveDocument` 原生通道 | PASS | `exportData()` 在 Android 仅调用 `SystemBridge.saveDocument`，能力缺失时不回退到假下载 |
| E5 | 保持旧备份结构、中文和敏感字段边界 | PASS | 两个真机文件均为 schema 5，中文回环成功；AI `apiKey`、`baseUrl` 均为空 |

## 自动化验证

| 命令/检查 | 结果 |
|---|---|
| `node --check app-core.js` | PASS |
| `node --check test-smoke.js` | PASS |
| `node test-smoke.js` | 244 / 244 PASS |
| `node test-native-reminders.js` | 321 / 321 PASS |
| `npm test` | unit 330 / 330、native 321 / 321、smoke 244 / 244、regressions 715 / 715，均 0 失败 |
| `./gradlew :app:testDebugUnitTest`（JDK 17） | 26 / 26 PASS |
| `./gradlew :app:assembleDebug`（JDK 17） | PASS |
| `npm run cap:sync` | PASS |
| 根目录 / `www` / APK 内 `app-core.js` 与 `index.html` 哈希比对 | PASS，三处一致 |

新增 Java 单元测试覆盖中文 UTF-8、空内容、关闭输出流失败不得报成功、建议文件名净化。Smoke 覆盖旧 JSON 结构、点击时快照、重复点击、原生成功/取消/失败/缺能力、浏览器下载、分享取消、空数据和源码契约。

## 真机步骤与结果

1. 安装隔离测试包，确认初始状态为事项/笔记/项目各 0。
2. 写入仅供验证的合成数据：`导出回环事项`、`导出回环笔记`、`导出回环项目`。
3. 第一次导出到“下载”，原生返回：
   - `status=saved`
   - `fileName=安心收件箱备份-2026-09-19.json`
   - `bytesWritten=1985`
4. 第二次以相同建议名导出。系统保留首个文件并创建 `安心收件箱备份-2026-09-19_1.json`；App 显示系统返回的实际文件名。Provider 未给出可安全展示的逻辑路径，因此提示使用“你选择的位置”，没有伪造绝对路径。
5. 清空隔离包中的合成状态，从 `_1.json` 导入；恢复结果为事项/笔记/项目各 1，三个中文字段与测试 ID 匹配。
6. 再次发起导出并在系统保存器按返回键：得到 `{status:"cancelled"}`，导出按钮 `disabled=false`、`aria-busy=false`，副文案恢复“JSON 备份到文件”，提示“已取消导出 · 未保存文件”。

设备文件：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `安心收件箱备份-2026-09-19.json` | 1,985 | `37c8c171834ccd81e69db209d8521e25a9412d4e9a17e0d14586c55999b8d56a` |
| `安心收件箱备份-2026-09-19_1.json` | 1,985 | `23f305871471917cd4f2b3a1c1d4bbeafeb2d4890496bf8a8155569f9e10779b` |

原始导出文件保存在同目录的 `device-exports/`，可独立复算。

## 构建候选

- APK：`releases/candidates/20260919T194959Z-export-document/attention-inbox-export-document-debug.apk`
- SHA-256：`dfceaf1c673d8655562c1fad3ed67bae1caf8e84b7bcdd7dd0aef37dae125b63`
- 签名：Android debug signer
- 原有 `releases/安心收件箱-debug.apk` 未覆盖，SHA-256 仍为 `cb6a921717c2de35225e8ed47378079881ffb23b46de179557e67697cd76607f`

## 已知边界

- `lintDebug` 为 FAIL：10 个既有错误、60 个警告。错误位于既有的 `AlarmActivity.onBackPressed`、`DeliveryEvidenceStore` API 24 调用、`SystemBridgePlugin.ensureChannel` API 26 通知通道调用和 `AlarmActivity` 可见性常量；新加的 `saveDocument` 代码没有 lint 错误。报告位于 `android/app/build/intermediates/lint_intermediate_text_report/debug/lint-results-debug.txt`。
- 真实生产包安装验证为 **NOT_PERFORMED**：为保护设备上更新且内容不同的已安装包，未覆盖安装。真机功能证据来自同源码/资源、仅包名和标签隔离的测试包。
- 真机“输出流关闭失败”故障注入为 **NOT_PERFORMED**；该分支由 Java 单元测试和 Web 层失败用例覆盖。
- 按“不卸载、不删除”约束，隔离测试包和两份合成 JSON 仍保留在设备上；其中不含真实用户数据。
