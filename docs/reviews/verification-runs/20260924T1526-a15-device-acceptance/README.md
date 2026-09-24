# A15 目标真机补充验收（同一冻结候选）

日期 2026-09-24 15:26–15:54。设备 vivo V2238A / Android 16（`10ACBF2D3D000RS`），包 `space.alliswell.inbox` User 0。
本 run 只写验收脚本、日志与证据，未改产品源码、候选 APK 或历史证据；未 commit/push。

结论：**A15 仍不能签整体 PASS**。安装前后比对、通知按钮、全屏面板动作、后台存活进程回前台对账、SAF 导出/导入、业务命令清理都通过。冷进程送达 **FAIL**，还有两项 NOT_PERFORMED（见下）。

## 身份

- 候选 `releases/candidates/20260924T1405-p4-device-candidate/app-debug.apk` SHA-256 `e14438de38b3ee05d678e15025d09c1adceebb51f67f3f8d954fb26488fe20c1`。
- 安装前机上 base.apk 就是这个哈希。`adb install -r` 覆写安装后仍是这个哈希（`lastUpdateTime` 14:56:01 → 15:33:00）。安装时 vivo 的 `PackageInterceptActivity` 需要点「继续安装」，脚本只点了这个按钮，没有输入任何凭据。
- 测试前用户数据：0 条事项，只有设置（`01-pre-install.idb-hashes.json`）。

## 结果矩阵

| # | 场景 | 结论 | 证据 |
|---|---|---|---|
| 1 | 安装前后权威记录级比对：先经真实捕获表单写入隔离事项 P1（重要档，次日），再覆写安装，然后冷启动 | **PASS**。IDB `kv/state` 与 localStorage `attention-inbox-v2` 逐记录哈希完全相同。P1 的系统闹钟（`AlarmRingService` + `ACTION_TEST_ALARM` + 后续通知）安装后仍在 | `raw/02-pre-install*`、`raw/03-post-install*`、`raw/step1-install-diff.json`、`run.log` |
| 2a | 普通档系统通知「完成」（应用在后台，真实点击通知栏按钮） | **PASS**：`archived` + `completedAt`，rev 1→2，IDB 已落库，通知已移除 | `raw/step2-items.json` N1 |
| 2b | 通知「稍后 2 小时」 | **PASS**：`snoozed`，`triggerAt = snoozedAt + 7 200 000`，snoozeCount 1，IDB 已落库，通知已移除，新的 LocalNotifications 闹钟已登记 | N2；`raw/step5-cleanup.json` alarmsBefore |
| 2c | 通知「我知道了」 | **PASS**：`acknowledged` + `acknowledgedAt`，IDB 已落库，通知已移除 | N3 |
| 3a | 全屏面板「我知道了」，进程存活、应用在后台 → 回前台对账 | **PASS**：点击后 IDB 已为 `acknowledged`；回前台后内存与 IDB 一致；通知与 `AlarmRingService` 均已消失 | `raw/step3-items.json` A1 |
| 3b | 全屏面板「完成」 | **PASS**：`archived` + `completedAt`，回前台后一致。注意：原计划在这里测冷进程，但 `am kill` 没有终止进程（前后 pid 都是 6788），所以本项只算后台存活进程 | A2 |
| 3c | **冷进程**：`run-as kill -9` 结束进程（不用 force-stop，避免清掉闹钟）后到点 | **FAIL**。杀进程后系统闹钟仍已登记；15:47:00.013 logcat 有 `device_idle_wake_from_idle`（`AlarmRingService` 与 `ACTION_TEST_ALARM`），但没有本包的 `am_proc_start`，也没有面板、通知或响铃。15:50 手动打开后事项为 `due`，详情页如实显示「本次提醒结果尚未确认」，没有误报送达。属于计划外的既有 OEM 冷进程问题 | `raw/step3b-A3.json`、`raw/step3-A3-logcat-filtered.txt` |
| 4a | SAF 导出（真实 `#btnExport` → DocumentsUI「保存」到「下载」） | **PASS**：提示「已保存…位置：下载文件」。拉回的文件为 schema 5，7 条事项、notes、projects 与导出时 IDB 逐条字节相同 | `raw/step4-export*.json` |
| 4b | SAF 导入同一文件（真实 `#btnImport` → 系统选择器 → 应用确认框点「确定」） | **PASS**：提示「导入成功 · 7 条事项」；导入前后 IDB `kv/state` 与 localStorage 完全相同（无损往返） | `raw/04-pre-import*`、`raw/05-post-import*`、`raw/step4-import.json` |
| 5 | 业务命令清理：7 条隔离事项逐一调用 `deleteItem`（与 UI 删除按钮同一个已装饰命令） | **PASS（事项/通知/闹钟）**：原生 desired、scheduled、alarm 均为 0；本包系统闹钟 11→0；没有 A15 通知；`kill -9` 冷启动后 IDB 事项 0 条，与测试前一致 | `raw/step5-cleanup.json`、`raw/06-final-after-cleanup*` |
| — | 物理声音/振动、息屏锁屏穿透 | **NOT_PERFORMED**（本轮屏幕保持亮屏解锁；没有人在场判断声振） | — |
| — | 移动 Chrome PWA 安装与离线升级 | **NOT_PERFORMED** | — |

## 清理后的残留与副作用（如实记录）

1. `settings.alarmEventLog` 新增 5 条匿名事件 id（不含标题）。这是原生动作去重台账，有 `ALARM_EVENT_LOG_LIMIT` 上限，按设计保留，用于防止旧事件重放。
2. `settings.setupPromptStarted` 由 false 变为 true。原因是首次保存了带时间的事项（`noteFirstRemindSaved`）。首页因此多出「提醒还没准备好」卡片（`raw/step5-final-app.png`）。**已按用户要求回滚**，见下节。
3. 测试前系统里已有 2 个本包 LocalNotifications 闹钟（21:30、22:30，setAtTime 07:31，早于本 run），当时应用状态显示 desired 为 0。清理后的全量同步把它们一起取消了。
4. 手机上留下了导出文件 `/sdcard/Download/安心收件箱备份-2026-09-24.json`（只含测试事项，已全部删除）和临时文件 `/sdcard/a15-ui.xml`。**已按用户要求删除**。

## 用户要求的回滚（15:56）

- 按用户要求把 `settings.setupPromptStarted` 改回 false。这是直接改设置，没有走业务命令：先写 `state.settings`，再调用 `saveAsync`。杀进程冷启动后，`#homeSetup` 为空，首页卡片已消失（`raw/step6-after-rollback.png`）。与测试前基线（`01-pre-install`）相比，只剩 `settings.alarmEventLog` 不同；事项与其他顶层键都相同。
- 已删除手机上的导出文件 `/sdcard/Download/安心收件箱备份-2026-09-24.json` 和临时文件 `/sdcard/a15-ui.xml`；MediaStore 中已没有这个备份。

## 隐私处理

通知栏 UI dump 一度把其他应用的个人通知写进了 `run.log`，已脱敏。含他人通知的截图、完整 dumpsys、原始 IDB 快照和导出文件只放在仓库外的会话临时目录。仓库内证据只保留哈希、本包通知段落和隔离事项字段。

## 复跑

`step1_install.py` → `step2_notif.py` + `step2b_tap.py` → `step3_alarm.py` → `step3b_cold.py` → `step4_saf_export.py` → `step4_saf_import.py` → `step5_cleanup.py`，共用 `devlib.py`。
