# 体检简报 · HC-T5-4 重启后恢复/补投（真机）

- **执行人**：Agent
- **执行日期**：2026-10-16（设备时钟；主控时区 America/Los_Angeles）
- **代码版本**：HEAD `f79b1a7396c6f5493e43a27ec88e960f8b620ac3`（feat(brand): 新图标 J），工作区 52 个未提交文件，**未修改任何产品代码、未 git 提交**
- **设备**：vivo V2238A，Android 16，序列号 10ACBF2D3D000RS，无锁屏密码
- **被测包**：debug 包 versionCode=4（2026-10-15 深夜安装，T5-0..T5-3 已在该包完成，见当期报告）

## 覆盖率

本次仅执行 HC-T5-4（重启后恢复/补投），**执行 1 项，跳过 0 项**。其他破坏性项（pm clear / uninstall / 改系统时间时区 / 权限开关）仍待用户同意，本次未执行。

## 用例：HC-T5-4 重启后恢复/补投 — ✅ PASS

### 步骤与判据

| 步骤 | 结果 | 证据 |
| --- | --- | --- |
| 重启前排程 1 条重要事项（now+7min，delivery_mode=alarm） | ✅ | `hc-t5-4-setup.txt`：`ACTION_TEST_ALARM` origWhen=1792134681016 flags=3（精确唤醒，`Next wake from idle` 即它）+ 同刻 `.AlarmRingService` 前台服务闹钟；渠道 v5 `mSound=null mVibrationEnabled=false mDeleted=false`，v4 `mDeleted=true` |
| `adb reboot`（用户已同意） | ✅ | 指令发出 15:04:47，`sys.boot_completed=1` 于 15:05:39，**开机约 52 秒** |
| 开机恢复排程（不打开 App） | ✅ | `hc-t5-4-boot-restore.txt`：进程 15:05:57 由系统以 **broadcast 方式**拉起（events 缓冲 `am_proc_start … {LocalNotificationRestoreReceiver}, {action = android.intent.action.LOCKED_BOOT_COMPLETED}`）；15:06:14-15 `ACTION_TEST_ALARM` + `.AlarmRingService` 以**原触发时刻 15:11:21.016、flags=3** 重新注册并成为 `Next wake from idle`；恢复完成后进程 15:06:29 被系统正常回收（`am_kill low memory`），闹钟留在系统 AlarmManager，不依赖进程存活 |
| 息屏+锁屏状态到点投递 | ✅ | `hc-t5-4-delivery.txt` + `hc-t5-4-lockscreen-delivery.png`：15:11:22.429 `AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true`；通知 `channel=attention-alarm-v5 category=alarm` 已投递（渠道无声无振动，铃声由前台服务承载 carrier=native）；FSI 把界面从息屏唤亮，全屏闹钟界面完整显示（标题/T5-4 重启恢复/15:11/我知道了等按钮），`Displayed .AlarmActivity +670ms` |
| plannedAt vs 实际偏差 | ✅ 可量化 | plannedAt 15:11:21.016 → 原生台账 `received` 15:11:21.978（**+962ms**）→ `ringStarted` 15:11:23.240 → 界面 Displayed 15:11:23.766（计划到全屏可见约 **2.75s**） |
| 单次单路、无双投 | ✅ | `hc-t5-4-trace.json`：token `395984606:…` 恰 3 个事件（received / ringStarted×1 / windowSample shown=true），无 `ringDuplicateStart`、无第二次 received；`hc-t5-4-readback.json`：`reminderEvents["0@1792134681000"].state=delivered`（receivedAt 与原生台账一致）、`remindCount=1` |
| 台账与实际投递一致 | ✅ | 原生 AlarmTrace（run-as 读 `shared_prefs/alarm_trace.xml`）与 JS 侧 reminderEvents、dumpsys 通知记录、logcat 链路四方互证 |

### 复核判定

**HC-T5-4 = PASS**：恢复排程 ✅（广播恢复、原时刻精确重排、无需打开 App）+ 到点投递 ✅（息屏锁屏下延迟 +962ms，全屏界面 2.75s 内可见）+ 单次单路 ✅（仅 v5 渠道、仅 1 条 ringStarted、remindCount=1）+ 无双投 ✅。

## 观察附注（非缺陷，如实记录）

1. **旧排程过期残留被正确消化**：昨日 T5-3 事项在 native 侧有一条未清理的历史排程（triggerAt 已过），reboot 后 BootRestore 将其判为 `alarmExpiredMissed`（台账 1792133501769），**未响铃、未重复补投** —— 处理正确。
2. **重要事项 followup 链属设计行为**：dumpsys 中 15:41/16:11/16:41 的 3 个 `TimedNotificationPublisher` 并非残留干扰，而是本事项（重要事项）的 followup 重提链，与首页卡片「重提醒中（第 1/4 次）」及 `reminderEvents` 的 3 条 scheduled 完全对应。
3. **开机早期窄窗口**：BOOT_COMPLETED 广播约在开机完成后 35s 才完成恢复注册；若闹钟恰排在开机后 0-35s 窗口，走的是 LOCKED_BOOT/DE 镜像恢复路径，本例未覆盖该窗口。

## 证据目录

`docs/reviews/health-evidence-2026-10-15/T5/`（文件内容注明实际执行时间 2026-10-16）：

- `hc-t5-4-setup.txt` — 重启前排程与渠道状态
- `hc-t5-4-alarm-after-boot.txt` — 重启后恢复注册（dumpsys alarm）
- `hc-t5-4-boot-restore.txt` — BOOT 广播拉起进程 + 恢复注册汇总
- `hc-t5-4-delivery.txt` — 到点投递（通知记录 + logcat 链路 + 屏幕状态）
- `hc-t5-4-lockscreen-delivery.png` — 息屏锁屏中 FSI 唤亮的全屏闹钟界面
- `hc-t5-4-trace.json` — AlarmTrace 台账摘录（单次单路判据）
- `hc-t5-4-readback.json` — CDP 读回事项状态（delivered / remindCount=1）
- `hc-t5-4-home-after.png` — 首页「重提醒中（第 1/4 次）」状态

## 仍待用户同意的破坏性项

- HC-T5-5/6：在系统设置手动关/开「闹钟和提醒」「通知」权限
- 改系统时间/时区类用例（HC-T5-11 等）
- `adb shell pm clear space.alliswell.inbox`
- `adb uninstall space.alliswell.inbox`
