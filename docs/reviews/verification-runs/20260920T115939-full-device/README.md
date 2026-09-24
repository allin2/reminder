# 当前 `main` 实机全面功能验证

- 日期：2026-09-20（Asia/Shanghai）
- 源码：`main` / `4de5f597573bc2c45b51ba8ab18a279d054339a0`
- 设备：OPPO PKC130 / Android 16 / ColorOS 16.0.10 / `QSKFAE95CQEUJZ8L`
- 安装包：`current-debug.apk`
- APK SHA-256：`dfceaf1c673d8655562c1fad3ed67bae1caf8e84b7bcdd7dd0aef37dae125b63`
- 总结论：**FAIL / FIX_REQUIRED**

当前源码构建、自动测试、首次启动、数据主流程、普通系统通知、前台全屏闹钟和导入导出均通过。实机确认两个会直接造成漏提醒的阻断缺陷：

1. 已有时间的事项仅修改标题后，保存会把 `triggerAt` 清空，重启后仍为空。
2. 重要提醒在其他应用前台及熄屏锁屏时，到点后 60 秒内均未被应用接收；系统把两条精确闹钟的有效执行时刻统一调整到约 3 天后。冷进程两次复现也都无接收、无可见界面。

因此本轮不能签发“全面功能 PASS”，也不能以“前台闹钟能响”替代后台和锁屏送达。

## 1. 基线与身份

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| Git 基线 | `main` / `4de5f597...` | `baseline.json` |
| 当前源码构建 | PASS | `build.log`，Gradle 99 tasks，BUILD SUCCESSFUL |
| Web 资源进入 APK | PASS | `artifact.json`，14 个资源逐字节一致 |
| 主机 APK 与设备 APK | PASS | 两侧 SHA-256 均为 `dfceaf1c...125b63` |
| 设备权限 | PASS | 通知、精确闹钟、全屏通知均已授予；“允许后台使用”已开启 |
| 工作区保护 | PASS | 未修改产品源码、未提交、未推送；保留原有脏工作区与历史证据 |

设备验证前并未安装 `space.alliswell.inbox`。本轮从当前 HEAD 新建并安装调试包，因此应用内数据均为本轮合成数据，不涉及已有真实提醒。

## 2. 自动验证

| 检查 | 结果 |
| --- | --- |
| `npm test` | PASS：unit 330 / native 321 / smoke 244 / regression 715，共 1592 / 1592 |
| `:app:testDebugUnitTest` | PASS：26 / 26 |
| `:app:assembleDebug` | PASS |
| APK 资源身份 | PASS：根目录资源与 APK 内 14 个 Web 资源一致 |

自动测试通过只证明相应代码路径；下面的实机反例优先于测试绿灯。

## 3. 实机功能覆盖

| ID | 可观察行为 | 状态 | 实机结果与证据 |
| --- | --- | --- | --- |
| DV-01 | 首次启动不写入示例数据，通知关闭时明确告知 | implemented | PASS；`fresh-home.png`、`interaction.json` |
| DV-02 | 中文时间录入并保存，重复点击只落一条 | implemented | PASS；“明天下午3点…”生成 1 条事项，`capture-double-submit` |
| DV-03 | 仅修改标题不改变原提醒时间 | **divergent** | **FAIL**；保存前表单仍为 `2026-09-21T15:00`，保存后 `triggerAt=null`，重载后仍为空；`title-edit-counterexample.json`、`title-edit-after-reload.json` |
| DV-04 | ACK、稍后、完成互不混淆，终态拒绝旧动作 | implemented | PASS；ACK→snoozed(elapsed 2h)→archived，终态 ACK/稍后均返回 false；`interaction.json` |
| DV-05 | 状态在 WebView 重载后保持 | implemented | PASS；事项、笔记、项目 ID 和终态保持；`interaction.json` |
| DV-06 | 周期事项完成本期后生成下一期 | implemented | PASS；本期 archived，下一期 waiting；`extended.json` |
| DV-07 | 模糊时间进入待整理，可继续保留 | implemented | PASS；“以后看看…”进入 `NEEDS_REVIEW`，保留后仍在队列；`extended.json` |
| DV-08 | 归档恢复不自动提醒 | implemented | PASS；恢复后 `triggerAt=null`、`deadlinePaused=true`；`extended.json` |
| DV-09 | 项目、笔记、搜索 | implemented | PASS；中文项目和 Markdown 笔记保存并可搜索；`interaction.json`、`extended.json` |
| DV-10 | 导出实际落盘，取消不谎报成功 | implemented | PASS；系统保存器写入 3387 字节 JSON，取消返回 `cancelled` 且按钮恢复；`export-result.json`、`export-validation.json`、`export-cancel.json` |
| DV-11 | 导出的旧格式备份可重新导入 | implemented | PASS；事项 2、笔记 1、项目 1 的 ID 集合回环一致；`import-roundtrip.json` |
| DV-12 | 普通系统通知可见 | implemented | PASS；通知 ID 99021 被系统接收并在通知栏真实可见；`immediate-notification.png`、`immediate-notification.txt` |
| DV-13 | 前台重要提醒及时接收并显示全屏界面 | implemented | PASS；目标后约 132 ms `received`，`windowVisible=true`；`delivery-foreground/result.json`、`events.json`、`due-3-screen.png` |
| DV-14 | 其他应用前台时重要提醒仍按时送达 | **divergent** | **FAIL**；60 秒无 `received/windowVisible`，两条闹钟仍在队列，`adjustment≈+3d`；`delivery-other/result.json`、`due-60-alarm.txt` |
| DV-15 | 熄屏锁屏时重要提醒唤醒并可见 | **divergent** | **FAIL**；60 秒无 `received/windowVisible`，屏幕保持黑屏，`adjustment≈+3d`；`delivery-asleep/result.json`、`due-60-screen.png`、`due-60-alarm.txt` |
| DV-16 | 冷进程时重要提醒仍可送达 | **divergent** | **FAIL**；两次各观察 60 秒均无接收、无可见界面；`delivery-cold/result.json`、`delivery-cold-log/result.json` |
| DV-17 | 验证后不留下活动测试提醒 | implemented | PASS；所有合成事项已归档，LocalNotifications pending=0，active alarms=0，系统中无本包 `ACTION_TEST_ALARM` / `AlarmRingService` 条目；`cleanup.json`、`final-dumpsys-alarm.txt` |

## 4. 阻断缺陷

### F-01 编辑标题会静默取消提醒

稳定复现：

1. 新建“明天15点实机验证编辑反例”，保存后 `triggerAt=1789974000000`。
2. 打开编辑页，仅把标题改为“实机验证改标题反例”。
3. 保存前时间输入框仍显示 `2026-09-21T15:00`。
4. 保存后 `triggerAt=null`、`localTrigger=""`；WebView 重载后仍为空。

源码机制与观察一致：标题变化时 `saveItemFromForm()` 会重新解析新标题；新标题不含时间词，解析结果为低置信度。随后 `parsedLow ? null : ...` 优先把有效的原表单时间丢弃。原时间并非用户本次手动修改，所以 `triggerUserPicked=false`，无法进入 `explicitTime` 分支。

影响：用户只改标题或正文，就可能在无提示情况下失去原提醒，属于直接漏提醒缺陷。

最小修复方向：编辑已有事项时，如果用户没有改动/清空时间字段，标题重解析不得覆盖已有 `triggerAt`；只有显式修改时间或产品明确支持的“从标题重新解析时间”动作才可改变它。验收必须覆盖改标题、改备注、改标签、显式改期、显式清空和重启持久化。

### F-02 后台、锁屏和冷进程送达失败

同一 APK、同一权限、同一 `AlarmScheduler` 路径下：

| 场景 | 进程/界面 | 结果 |
| --- | --- | --- |
| App 前台 | 前台可见 | PASS，约 132 ms 接收并显示全屏闹钟 |
| 其他应用前台 | App 后台存活 | FAIL，60 秒无接收；系统排程调整约 +3 天 |
| 熄屏锁屏 | App 后台存活 | FAIL，60 秒无接收；系统排程调整约 +3 天 |
| 冷进程 | pid 为空 | FAIL，两次 60 秒无接收/可见证据 |

通知、精确闹钟、全屏通知和后台使用权限均已开启；应用未被 stopped/suspended，standby bucket 为 active。当前证据足以证明送达失败，但本轮冷进程日志没有再次捕获到厂商明确的 `prevent start` 行，因此冷进程的最终厂商归因保持未确认。

最小修复/诊断方向：

1. 先解释并复现 OPPO 在后台/熄屏后把 exact alarm 的 `policyWhenElapsed.adjustment` 改为约 +3 天的条件；不要把前台 PASS 当作修复。
2. 冷进程用连续系统日志和明确 token 绑定排程、系统派发、组件启动与可见界面，区分“系统未派发”和“派发后启动被拒”。
3. 修复后至少重跑其他应用前台、锁屏、冷进程三组，每组要求匹配 token、`received`、`windowVisible` 或屏幕证据，并验证 ACK/稍后/完成能停止声振和清理后续排程。

## 5. 验证边界

本轮未执行以下项目，状态保持 `NOT_PERFORMED`：

- 真实用户从最近任务划掉 App 的冷进程路径；本轮冷进程由 `run-as kill -9` 构造。
- 设备重启、首解锁前 Direct Boot、系统升级、时区/手动改时后的恢复。
- 深度 Doze 的长时间窗口、24 小时以上稳定性、长期重复/截止保护。
- 通知权限拒绝后的真实降级流程；本轮为验证提醒功能已授予权限。
- 分享入口、桌面/锁屏快捷入口、系统文件选择器手动选择导入文件。
- 数据库损坏与空间不足故障注入。

这些边界不抵消本轮已经复现的两个阻断缺陷。

## 6. 设备终态

- 当前测试 APK 仍安装在设备上，通知、精确闹钟和全屏通知权限保持开启。
- 所有合成事项均已归档；待触发通知为 0，活动闹钟为 0。
- 合成项目和笔记保留在新安装的测试数据目录中，便于复查；没有真实用户数据。
- 导出 JSON 保留在用户选择的设备位置，作为文件可见性证据。
- 产品源码未修改；本轮只新增验证证据和本报告。
