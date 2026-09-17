# vivo R-1 当前 F5 真机验证 · 2026-09-18

## 结论

在 vivo V2238A / Android 16（API 36）上，使用原 F5 APK，开启“允许后台耗电”和“锁屏显示”后，息屏闹钟按时投递并显示全屏；再开启“自启动”后，应用进程已退出的情况下也由闹钟重新启动并显示全屏。**本次两个验收场景 PASS；不代表跨机型、重启、强行停止或长期可靠性通过。**

原先“应用侧无任何手段，唯一缺后台白名单”的表述不完整：本机至少存在后台投递、锁屏显示、冷启动三个独立限制。当前实验未改应用代码、未构建、未重装、未 root，也未写隐藏系统参数。

## 候选、环境与授权

- 用户授权：“现在手机处于开发模式，你可以控制手机推进工作”。通过 ADB 实际操作系统设置，逐项保存 UI XML/截图；未委派子代理。
- serial：`10ACBF2D3D000RS`，包名 `space.alliswell.inbox`，普通应用 UID `10190`。管理/采集由 ADB shell 执行；到点投递由系统 AlarmManager 驱动，没有在目标时间人工打开 App。
- 当前安装 F5 APK SHA-256：`68cd6203db96118423faa4daa0b69ffddcbdfee8ba3bf21f30dbbc1e1a80b246`。本轮从已安装 `base.apk` 重新读取哈希，与本地 F5 一致。
- 验证执行时仓库为 `main`，基线 HEAD `acbe3c539c88f00d836d448dafc31addf1496c90`，并有任务相关未提交修改。该历史 HEAD **不等于** F5 完整源码身份；后续同步提交固化了本轮任务相关源码、脚本与证据。
- run ID：`20260917T161905Z-r1-settings`（UTC 命名，北京时间 2026-09-18 00:19 起）。设备与主机均为北京时间。
- 独立测试事项：`r1_20260918_001`，标题“R-1 后台放行验证（测试）”。原有 7 条事项在试验前后逐字段一致。
- 原始证据：`docs/reviews/verification-runs/20260917T161905Z-r1-settings/`。

## 四轮单变量实验

各轮 LEAD=75 秒，均实际进入息屏、锁屏；通知/窗口快照在目标时间约 8 秒后只读采集，不唤醒屏幕。延迟以本次 trace 的 `scheduled.triggerAt` 为基准，使用同一个 token 关联接收和窗口事件。

| 轮次 | 配置与条件 | 本次广播延迟 | 全屏可见延迟 | 结果 |
| --- | --- | ---: | ---: | --- |
| battery-trial | 仅从“智能控制”改为“允许后台耗电”；锁屏显示关、自启动关；进程存活 | 62 ms | 未显示 | 投递恢复，完整验收 FAIL |
| lockscreen-trial | 在上轮基础上只开启“锁屏显示”；进程存活 | 84 ms | 936 ms | PASS：通知存在、窗口获得焦点、截图可见 |
| cold-trial | 与上轮同设置；应用 UID 自行 SIGKILL 后 PID 为空，`stopped=false`，自启动仍关 | 未收到 | 未显示 | FAIL：系统准点派发，观察窗口内没有 `am_proc_start` |
| autostart-trial | 在上轮基础上只开启“自启动”，重复退出进程 | 814 ms | 2584 ms | PASS：系统创建新进程，通知存在，窗口获得焦点、截图可见 |

关键证据：

- `battery-trial/summary.json`：token `1365176345:fcc2f300-376d-4333-acc0-b84ae639722f`。`received` 已出现，但窗口很快结束，`deliveryVisible=false`，截图黑屏。不能再归因为“进程收不到投递”。
- `lockscreen-trial/summary.json`：token `400246606:4148f5b3-b11a-40ed-b43c-2433683c0f1e`。`windowVisible`、`focus=true` 与 `deadline-screen.png` 相互印证。
- `cold-trial/summary.json`：token `1288883457:6a6a1df5-e3b1-456f-868d-11d871b3ab74`。目标时间 `1789662551490`，仅有系统唤醒，未有本次 `received`。此时 `attention_alarm.xml` 中的旧 `deliveryVisible=true` 属于上一轮，**不能误判为本轮成功**。
- `autostart-trial/summary.json`：token `1445069485:f7237e56-3eac-451c-afb7-0ccb3a8538db`。目标 `1789662754096`；系统 `am_proc_start` 时间 `1789662754134`、新 PID `16238`、启动原因 `broadcast/AlarmTestReceiver`；接收 `1789662754910`；窗口可见 `1789662756680`。
- 系统 `notification_alert`、通知记录的 sound key 是系统响铃证据；没有录音或人工听感验收，不把它写成声学输出实测。
- 两轮存活进程观察窗口内，events 未见本应用 `am_app_frozen`；这是本窗口日志结论，不等同长期不会冻结。

## 最终手机配置与收尾

实际开启并保留：

1. 电池 → 后台耗电管理 → 安心收件箱 → **允许后台耗电**。
2. 应用信息 → 查看所有权限 → **锁屏显示**。
3. 同页 → **自启动（开机启动 / 后台启动）**。

悬浮窗原本已经开启，保持不变；关联启动、后台弹出界面保持关闭。本轮 PASS 不能证明悬浮窗可以关闭，也不包含解锁亮屏时后台弹窗验收。

`background-options-before.xml` / `background-options-after.xml`、`all-permissions.xml` / `lockscreen-after.xml`、`autostart-before.xml` / `autostart-after.xml` 保存逐步状态。`background-final-clear-top.xml` 再次确认“允许后台耗电”。

收尾通过本次闹钟界面的“完成”按钮归档测试事项。`cleanup-verification.json` 确认：原有 7 条事项无字段差异，测试事项状态 `archived`，通知开关仍为 true；`schedules-after.xml` 不含测试事项。测试记录保留，不删除用户数据。手机已返回桌面并息屏。

## 可复用脚本与注意事项

- `vivo-alarm-screenoff-trial.sh` 完成本次两轮息屏试验。
- `vivo-selfkill-trial.sh` 补充 `triggerAt`、杀进程前 trace 与 events 采集、退出后 PID 为空检查，完成两轮冷启动试验。
- 新增 `capture-alarm-deadline.py`：与试验并行启动，按目标时间采集截图、窗口、通知、trace、投递台账；独立输出每次采集时间/退出码；拒绝覆盖已有快照。
- `tools-used/` 保存本轮所用可复用脚本快照。第一轮到点快照由等价的临时 Python 命令采集；其余三轮实际运行新工具。
- 旧脚本最后打印的“通知条数”是全文字符串出现次数；通知可能在最终取样前超时取消。验收使用目标时间 +8 秒的**匹配通知 ID 的实际记录**，不能把末尾 0 判为从未通知，或把 3 处匹配当作 3 条通知。

示例（两个终端，第一条 RUN 必须尚不存在；先明确授权并选择独立测试事项）：

```bash
SERIAL=10ACBF2D3D000RS ITEM_ID="测试事项ID" LABEL=r1 LEAD=75 SCREEN=off RUN="$PWD/docs/reviews/verification-runs/新运行ID" bash scripts/verification/vivo-alarm-screenoff-trial.sh
/usr/bin/python3 scripts/verification/capture-alarm-deadline.py "$PWD/docs/reviews/verification-runs/新运行ID" r1 --serial 10ACBF2D3D000RS
```

发现新的深链边界：`am start -W -a android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS` 可能返回“current task brought to front”，实际顶层为旧的 `SoftPermissionDetailActivity`。加 `-f 0x14000000`（NEW_TASK | CLEAR_TOP）后，本机实测回到 `BackgroundHighUsageActivity`，证据在 `background-deeplink-clear-top.txt`。应用当前 `openBackgroundSettings()` 尚未加入 CLEAR_TOP；其 `opened` 仅表示请求路径，不能当实际页面证明。此修复列入后续 UI 接线，本轮未改产品代码。

## 验证范围与剩余工作

本轮执行：4 次当前候选真机实验、UI 状态核对、截图检查、原有事项比对、脚本语法/CLI 检查、归档哈希校验。历史 1031 项产品测试为 INHERITED_EVIDENCE，本轮未重跑。

NOT_PERFORMED：重启恢复、系统“强行停止”、划掉最近任务、长时间待机、低电量/省电模式、多机型，以及扬声器实际声压/录音验收。

下一步是产品接线：分别解释后台耗电、自启动、锁屏显示；处理深链返回旧页面；提示“需要到系统设置确认”，不得伪造 OEM 权限已开启。Q1/Q3/Q4/Q5 产品选择尚待确定；Q2 本轮已获授权并完成，不再作为待用户操作的阻塞。
