# 整理硬窗口修复与实机交付

## 结论

按用户授权采用 Grilling 推荐决策，N4 生产逻辑、边界测试与文档已修复；本地验证通过。**后续已滑动解锁、完成正常安装确认并实机验证**：熄屏/冷进程可见投递通过，后台 other 声振启动但未展示全屏，不能标全场景 PASS。下文安装阻塞段为已解除的历史记录。

## 最新实机结果（当前候选，不是继承）

设备 vivo V2238A / Android 16 / `10ACBF2D3D000RS`；在机 SHA 三场均为 `c56218247b6720f113292644acea7a29ba5eaa25f9d516b186cbdfccd3d1330d`。用户说明无解锁密码后，通过向上滑动解锁，并在正常安装器勾选外部来源告知、点击继续安装；没有修改安全设置。

| 场景 | 到达延迟 | 原生声振启动/系统振动运行 | 全屏可见 | 判定 |
|---|---|---|---|---|
| other（设置应用前台） | 286ms | 是/是 | 否，截图仍为设置 | 投递通过，全屏 FAIL |
| off（熄屏） | 448ms | 是/是 | 是，匹配 token 的 windowVisible 与截图 | 本次场景 PASS |
| cold（熄屏且杀应用进程） | 935ms | 是/是 | 是，匹配 token 的 windowVisible 与截图 | 本次场景 PASS |

证据：[other](./verification-runs/20260919-n4-device/other/delivery-result.json)、[off](./verification-runs/20260919-n4-device/off/delivery-result.json)、[cold](./verification-runs/20260919-n4-device/cold/delivery-result.json)。cold-pid.json 证明触发前 pid 已为空。off/cold 的 due-screen.png 已人工视觉核对；other 图仍是系统设置。声音结论限于原生启动记录，未做麦克风物理听音；振动另有 dumpsys running 证据。

- **N4 设备 WebView/桥 PASS**：[review-window.json](./verification-runs/20260919-n4-device/review-window.json) 中默认两槽、勿扰终点排除、长窗三槽、跨午夜、主动稍后五项真实函数检查均通过；两条投影通知在 LocalNotifications 原生 pending 回读时间吻合，定向撤销无残留。采用独立 2030 年输入，不改系统时间或用户设置；这不等于真实等待到 23:00 的整晚端到端测试。
- **Token 隔离 PASS**：[token-isolation.json](./verification-runs/20260919-n4-device/token-isolation.json)：真实同 ID 两轮不同 token 投递；旧 token 停止返回 false，新投递仍在；当前 token 返回 true，测试投递清理完成。对应 token-trace.xml 保留原生证据。此场景不是所有不同 ID 并发组合的证明。
- 三个业务测试项均由脚本完成后归档，未删除原用户事项；各 cleaned-vibrator.txt 均无运行振动。独立 token 测试只取消自己的 ID，未全局撤销用户闹钟。
- 复用 alarm-device-matrix.py；新增 review-window-device.js 和 alarm-token-device.js 可经 android-cdp-eval.py 复跑；两脚本 node --check 与 git diff --check 通过。未改当前候选生产代码，未重绑候选哈希。

**剩余风险**：other 后台全屏未展示，本轮未改变权限或定位其完整原因；真实整晚 Review 到点展示、整机首次解锁前、调表/调时区及完整并发矩阵仍未执行。1350 条本地测试结果仍沿用本轮构建前验证，不冒称新增脚本后又重复运行了全套。

基线 main / `8d1c2617cff3aac5c4450a949c9044b79f63a673` 加既有脏工作区；未提交、未推送，未清理他人修改。决策见 [Grilling 定案](../decisions/reminder-window-grilling-2026-09-19.md)。

## 实现与验证映射

| 要求 | 修复 | 验证 |
|---|---|---|
| 默认硬窗口 | 普通槽位均须早于终点，勿扰锚点也不能越界；默认只有 21:30/22:30 | native 默认/终点/勿扰覆盖与部分顺延 |
| 首发 + 两次补发上限 | 应用内总预算改为 1 + maxFollowups，主动稍后总预算独立为 1 | smoke 长窗三次、默认两次 |
| 跨午夜 | 原生先找前一晚窗口剩余槽位；应用内维持同一窗口 key | native 午夜后 00:30/01:30，smoke 跨两天累计三次 |
| 零点与空窗口 | 0 不被默认值覆盖，起止相等为空窗口 | smoke 零点、native 空窗口 |
| 稍后与勿扰 | 主动稍后可以越窗；应用内也遵守勿扰，宽限期从顺延时刻算 | native 稍后槽位、smoke 23:20 顺延到 07:30，仅一次 |
| 多闹钟 | 按最新交接保留单声源替换，不实现串行队列 | 本轮未改 Java；实机旧 token 停止隔离待新包安装后验证 |

文件：`app-core.js`、`lib/native-reminders.js`、`test-native-reminders.js`、`test-smoke.js`，以及决策、产品逻辑、验收登记。未实施 schema5/G01。

## 本地验证 PASS

- `npm test`：unit **249** / native **297** / smoke **224** / regress **580**，合计 **1350**，全部 0 失败。
- `npm run sync:www`、`npx cap sync android` 后，Temurin JDK17 下 `./gradlew :app:testDebugUnitTest :app:assembleDebug`：BUILD SUCCESSFUL。Java 生产套件 8 项结果保留，未改 Java，Gradle 可复用测试结果；不称本轮强制重跑。
- `git diff --check` 通过。测试包含静态、mock、仿真与真实 JS 函数，不能整体解释为 Java/实机行为通过。
- APK 内 app-core.js/native-reminders.js 的 SHA 与当前源码逐一匹配。
- 初次补测误调用未导出的 inReviewWindow 已纠正为通过真实 maybeReviewSession 入口验证；以上均为修正后最终结果。

证据目录：[20260919-n4-window](./verification-runs/20260919-n4-window/)，含 npm-test.log、build.log、ProductionJavaAlarmTest.xml、source-sha256.txt。

## 候选与历史安装阻塞（已解除）

最终候选：`releases/candidates/20260919-n4-window/app-debug-final.apk`

SHA-256：`c56218247b6720f113292644acea7a29ba5eaa25f9d516b186cbdfccd3d1330d`

旧包另存 previous-debug.apk（`186c28b9...`）；原 releases/安心收件箱-debug.apk 未覆盖。app-debug.apk 为较早构建，最终只使用 app-debug-final.apk，不混用。

设备 vivo V2238A / `10ACBF2D3D000RS` 在线。普通 `adb install -r` 被系统拒绝：

```text
INSTALL_FAILED_ABORTED: User rejected permissions
```

唤醒屏幕后对最终候选安装仍失败。只读 window policy 显示 `KeyguardServiceDelegate showing=true`；这说明存在锁屏状态，但不能仅凭该错误证明唯一拒绝原因。在机 SHA 仍为 `186c28b912000d3e9c34137c75160b3c0ff2a5aba62bd4fed95eff2c1015a523`，新包未安装。原始记录：install.log、window-policy.txt、installed-sha256.txt。

未修改 USB 安装/安全设置，未绕过确认；未启动旧包投递测试冒充新候选验收。

## 原续验步骤（本轮已执行 1–4 的所列有限场景）

需设备持有人先解锁手机并允许正常 USB 安装确认；这不是产品规则待裁决，而是设备安全交互阻塞。

1. 安装上述 final APK，再核对设备 base.apk SHA 与候选完全一致，失败则停止后续。
2. 在当前 WebView 调用真实 buildReviewDesired，以独立输入验证默认两槽、勿扰、长窗、跨午夜及主动稍后，不修改用户全局设置。
3. 使用现有 `scripts/verification/alarm-device-matrix.py`，显式 `--serial 10ACBF2D3D000RS`，分别 `--mode other/off/cold`，每场使用新的证据目录。仅创建隔离测试事项，结束归档测试项并停止其投递；不动用户原事项。
4. 按 matching token 检查 received、ringStarted 中 sound/vibrate、windowVisible 及截图；声振与屏幕分别报告。再验证旧 token 不得停止当前新投递。
5. 若需 notification/persistence live 自检，先去除或规避现有 device-verify.py 中 package-wide `cmd alarm cancel` 兜底，不让全局撤销影响用户闹钟；当前未运行该 live 路径。

此前因安装阻塞记录的 NOT_PERFORMED 已由上方当前候选实测结果取代；旧候选证据仍仅 INHERITED_EVIDENCE。整机冷重启首解锁前、调表/调时区、权限篡改依照定案不执行。
