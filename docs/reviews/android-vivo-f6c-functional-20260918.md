# F6c 当前候选真机功能验证 · 2026-09-18

用户要求优先验证功能，30 分钟长待机暂缓。本轮不修改产品代码、不重装，不用旧 F5 证据代替当前候选验证。

## 环境与绑定

- 源工作区：`main`；验证执行时基线 HEAD 为 `acbe3c539c88f00d836d448dafc31addf1496c90`，候选来自当时工作区。后续同步提交固化了任务相关源码、脚本与证据；该历史基线 HEAD 不能单独重建候选。
- 候选：`releases/安心收件箱-alarm-fix6c-20260918-debug.apk`；启动验收和按钮测试前均读取机上 APK SHA-256，匹配 `7813017e5d7f9454bdafb5ead8ccfc5417f44c1242f096647eb16cf7032fa1c9`。
- vivo V2238A / Android 16，serial `10ACBF2D3D000RS`，debug UID 10190，ADB 操作身份为 shell；事项读写经本应用 WebView，取证经 run-as。
- 后台高耗电、锁屏显示、自启动已放行，悬浮窗既有开启；关联启动、后台弹出未放行。本轮没有改这些条件。
- USB 连接供电；不代表拔线、Doze、过夜、重启恢复或所有厂商手机验收。

## 当前候选唤起结果

证据：`verification-runs/20260917T165157Z-f6c-acceptance/`。

| 场景 | 接收延迟 | 界面可见延迟 | 判定 |
| --- | ---: | ---: | --- |
| 息屏 75 秒闹钟 | 90 ms | 886 ms | PASS |
| 自身 UID SIGKILL 后息屏 75 秒闹钟 | 811 ms | 2082 ms | PASS |
| 30 分钟息屏待机 | — | — | NOT_PERFORMED，按用户优先级延后 |

冷启动不是 force-stop；到点前 PID 空、包 stopped=false，events 中有系统 am_proc_start。两次均按当前 item/token 关联 scheduled、received、windowVisible 和活动通知；到点后 8 秒截图未通过人工唤屏取得，已目视确认测试标题与四按钮。机器摘要的 screenshotReview=PENDING 是采集时状态，后续 `visual-review.json` 记录人工复核 PASS；非冷启动场景的进程判断字段仅表示“不适用”。

两次清理后原有 8 条事项逐字段一致，测试事项归档且不残留原生闹钟。机器测到了界面和系统通知，未录音核实扬声器实际声音。

长待机执行器在冷启动清理后被监督进程中断；可能留下空的 standby30m 启动文件，不构成长待机证据。`long-standby-deferred.json` 记录原因。脚本后续增加 `--trials screenoff cold`，便于直接只跑这两项。

## 原生按钮功能

执行器：`scripts/verification/vivo-alarm-actions.py`，逐个创建独立测试事项，通过 UIAutomator 验证标题后点击真实原生按钮，动作后不主动启动 MainActivity，再读取 WebView 状态、原生轨迹、通知和两种排程。

证据：`verification-runs/20260918-f6c-actions-r3/`。四项均 PASS：

| 原生按钮 | 实际结果 |
| --- | --- |
| 关闭 | 当前效果停止、当前通知撤销；保持 due，未确认、未完成、时间不变；保留 3 个后续 LocalNotifications 提醒 |
| 我知道了 | 状态 acknowledged，写入 acknowledgedAt，未完成；当前效果停止、通知撤销 |
| 稍后 2 小时 | 状态 snoozed，按 elapsed 记录时长；新时间为点击后 7,200,416 ms；1 个原生首响、3 个后续通知，旧首响通知撤销 |
| 完成 | 状态 archived，写入 completedAt；当前通知撤销，原生闹钟及 LocalNotifications 均无本事项剩余排程 |

四次真实 userAction 均有匹配 token 的 effectsStopped，四次动作队列均已清空。每次原有事项逐字段不变；只归档独立测试记录，不删除用户数据。最终 WebView 重载后再次核对原有 8 条及测试记录持久化，见 `persistence-review.json`。

本轮没有复现需修改产品的故障。排程回读验证的是登记正确，未等待 2 小时或后续 30 分钟真实投递；这些不能计作准点送达 PASS。实际声音未录制，止响结论限于原生停止效果轨迹与活动通知撤销。

## 证据使用边界

- `20260918-f6c-actions`：采集器误读不存在的 trace 文件，INVALID_RUN；测试事项通过实际“完成”按钮收尾，保留失败记录。
- `20260918-f6c-actions-r2`：错误要求到点后仍为 waiting，且只读取首响闹钟表、漏读 LocalNotifications 后续通知；INVALID_ASSERTIONS，不据此报告产品故障。
- `20260918-f6c-actions-r3`：修正上述断言及采集范围后的独立重跑。
- 新证据与脚本已纳入本轮 `main` 同步范围；从同步后的 `main` 可取得本报告引用的交接材料与验证工具。
