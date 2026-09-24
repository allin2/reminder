# PR #3 真机回归：独立复验

复验日期 2026-09-24 22:29–22:37。被复验：实施方自测 `20260924T2157-pr3-device-regression`。交接说明：`docs/handoff/2026-09-24-pr3-device-regression-plan.md`。
本 run 只新增复验脚本与证据；未修改产品源码、候选 APK 或实施方证据；未 commit/push。

## 结论

**PR #3 的 4 项修复（F1–F4）在真机新候选包上独立复验 PASS。** 构建、资源闭包、身份和隐私合规均通过。另有 2 项需要知会：
1. **实施方 R7 的一处说明不成立**：`settings.review` 的变化是测试造成的，不是「与测试事项无关」。见下文「偏差」。
2. **复验中新发现的既有缺陷（与 PR #3 无关）**：删除一条已经发出通知的事项后，它的系统通知仍留在通知栏。见下文「新发现」。

## 身份

| 项 | 结果 |
|---|---|
| HEAD | `98fef24`；5 个受影响源文件的哈希与实施方报告一致 |
| 候选 APK | `releases/candidates/20260924T2157-pr3-regression-candidate/app-debug.apk`，SHA-256 `e2dff4ef…d031` |
| 手机上的 base.apk | 与候选包逐字节一致，`lastUpdateTime` 为 2026-09-24 22:02:44 |
| 旧产物 | P4 候选包（`e14438de…`）、`releases/*.apk` 的修改时间与哈希均未变化；新候选目录是全新创建的 |
| `npm test` 日志 | 完整、全部通过（649 + 324 + 各 P3 套件 + 935 + 270 + 730 + 160）。实施方 README 写「全部 160 项」是笔误，只算了最后一套 |

## 独立复算

| 项 | 方法 | 结论 |
|---|---|---|
| 资源闭包 | 直接读取 APK 的 `assets/public/`，与源码逐字节比对：`sw.js` 预缓存清单中的 33 项、`index.html`，以及 APK 中另外 6 个文件（图标、`sw.js`、3 个未接入的导入导出模块） | PASS：0 不一致、0 缺失；APK 中缓存名为 `attention-inbox-v43` |
| R2 / F1 | 用手机上的 `AttentionLib.Feedback.setupSteps` 计算真实状态：`diag.canDrawOverlays` 与 `canUseFullScreenIntent` 为 true，`ignoringBatteryOptimizations` 为 false | PASS：悬浮窗一步 `done=true, verified=true`；剩 2 步；「我的」页副标题为「还差 2 步」；面板首步为「允许完全后台运行」，不再出现悬浮窗提示（`raw/r2-r3.json`、`raw/r2-setup-sheet.png`） |
| R3 / F2 | ① `kill -9` 后冷启动 3 轮，共 133 个样本；② 补强：在运行中把状态置回 `unknown`，再恢复 `granted` | PASS：①从未出现「允许发通知」，最终卡片显示「还差 2 步」；但这 3 轮采样都没赶上 `unknown` 窗口。实施方在 3 轮中的 2 轮各抓到 1 个 `unknown` 样本，当时卡片为空。② 置为 `unknown` 后卡片立即清空，恢复后重新出现（`raw/r3-forced.json`）；之后冷启动已恢复真实状态 |
| R4 / F3 | 4 个标签页空闲时，以及设置、捕获、演示面板各开关一次后，统计视口内未隐藏的 `.sheet` | PASS：均为 0；打开时 `visible`；捕获面板输入框可获得焦点。「新手指南」面板的打开入口未定位到，**未覆盖** |
| R5 / F4 | 无到期、1 条到期（隔离事项 R3V）、删除后三种状态 | PASS：`hidden` / `none`，然后 `visible` / `grid` 显示「1」（与到期数相等），然后 `hidden` / `none` |
| R1、R6 | 审阅实施方的原始 JSON 与截图，未重跑 | 证据自洽：R1 两次快照里用户事项相同；R6 的「我知道了」和面板「完成」在内存与 IDB 中一致，通知均已移除 |

## 隐私与用户数据

- 用 `redact-evidence.py --audit` 审计实施方 run 目录：命中 0 处。文本中没有其他应用的包名、邮箱、手机号或通知文字。唯一一处「验证码」字样是其脚本里「遇到验证码就停」的关键词。
- 实施方和本 run 的 26 张截图逐张目检：全部只显示本应用界面，没有通知栏、桌面、锁屏或其他应用。
- 私有证据存放在仓库外的 `/private/tmp/pr3-device-regression-20260924T2157/raw_private/`，符合要求。
- 用户唯一的事项 `i_24rm31samufjri6d` 在实施方 4 次快照中都是 `archived`、rev 2，哈希不变；本次复验结束时仍在。`setupPromptStarted` 仍为 true（与测试前基线一致）。本应用待触发的系统闹钟为 0，已送达和待发的 LocalNotifications 均为空。

## 偏差：实施方 R7 的 `settings.review` 说明

实施方写「处于 21:30–23:00 整理窗口……与测试事项无关」。但原始快照显示：
- 基线时没有待整理事项，`review.lastNotifiedAt = 0`，`sessionStatus = idle`；
- 22:01:27 用表单创建的隔离事项 R3P1 被判为 `NEEDS_REVIEW`（截图中首页出现「待整理 · 1」）；
- 22:01:41 应用向用户发出一次**真实的「待整理」提醒**，并把今晚的会话写成 `delivered`（`lastSessionKey = W:2026-9-24T21:30`，`followupCount = 1`）。

复验期间，事项与复验开始时完全相同；设置里只有 `review.sessionStatus` 由 `delivered` 变回 `idle`，应该是应用发现已没有待整理事项后自动重置了会话。`lastNotifiedAt` 没有变化，也没有再发提醒（`raw/99-final-vs-baseline.json`）。所以残留只剩 `lastNotifiedAt`、`followupCount` 和 `lastSessionKey` 这 3 个字段。

所以这是测试造成的副作用，清理事项后并没有还原。影响有限：该通知现在已不在通知栏；会话键只针对今晚，明天会开新会话。今晚的整理会话被标为已送达，这一点需要如实记录。以后的交接说明应当要求：隔离事项不能落入「待整理」，或者避开整理窗口。

## 新发现（既有缺陷，不属于 PR #3）

普通档事项 R3V 到期并发出系统通知后，用 `deleteItem` 删除：30 秒后，以及手动触发一次原生同步后，这条通知**仍留在通知栏**（`raw/r5-stale-notification.txt` 只含本包字段）。当时原生状态为 `desired = 0, cancelled = 2`，说明同步只取消了尚未触发的排程，没有移除**已送达**的通知。用户点这条陈旧通知上的按钮，操作的会是一个已删除的事项。复验方用应用自带的 `LocalNotifications.removeDeliveredNotifications` 移除了这条测试通知，这也说明修复路径可行。建议另开任务修复：删除、完成等终态命令应同时移除该事项已送达的通知。

A15 与本轮实施方的清理都显示「无通知残留」，因为那些事项都是先在通知上操作、通知被自动移除之后才删除的，没有覆盖「已送达但未操作就删除」这个路径。

## 复跑

`recheck_r2_r3.py` → `recheck_r3_forced.py` → `recheck_r4_r5.py`，共用 `devlib.py`。R5 会创建并删除一条 `R3V` 隔离事项。
