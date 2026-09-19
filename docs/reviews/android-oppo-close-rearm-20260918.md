# OPPO 闹钟无法关闭、再次设置失效：排查记录

用户报告：Find X8 首次闹钟响后无法关闭，直接关闭程序，随后再次设置提醒失效。关闭程序的具体操作尚待确认。

## 当前证据

- 检查源码：main / beeb9284a2e1f9a9ce394e4f2cbbf3d0608dc43d；保留已有工作区修改。
- macOS USB 枚举识别 OPPO PKC130；ADB 设备列表为空，mDNS 无调试服务。USB 连接已成立，但尚无可用的 ADB 调试连接。
- 未读取手机 APK、排程、通知、应用轨迹；未启动、停止、重装应用或修改手机权限，故障现场未由本轮操作改变。
- 原始连接记录：`verification-runs/20260918-oppo-close-rearm/`。

## 源码发现（不等于本次真机根因）

1. AlarmTestReceiver 对通知设置 FLAG_INSISTENT，由系统负责循环声音。AlarmActivity 的 stopAlarmEffects 仅清理自身播放器和震动；按钮经 finishWithAction 另行 cancelPostedNotification，撤销 currentAlarmId 通知。仅退出窗口与点击关闭按钮不是同一路径。
2. 不同投递进入 onNewIntent 时，代码停止旧界面效果、切换当前 ID，但保留旧通知。需要复测相邻/重叠闹钟，检查关闭当前窗口后是否还残留其他响铃通知；不能仅凭源码断言 ColorOS 的实际声音行为。
3. 目前没有证据证明“关不掉”和“再次排程失效”同根因，也不能把 vivo 的冻结结论套用到 OPPO。

## 接入后执行顺序

1. 先只读保存已安装 APK 身份、stopped 状态、AlarmManager、通知、events 及可读取的应用 trace，避免打开应用改变现场。
2. 核对用户采用划掉最近任务、强行停止还是其他退出方式。
3. 通过正常表单创建独立测试事项；记录排程、到点广播、窗口、通知。点击真实关闭按钮后确认通知移除、窗口退出及声振停止（声音需实际观察证据）。
4. 再设下一条，分别验证前台与息屏；如单条通过，再验证相邻闹钟与退出后重新设置。所有证据绑定本机 APK 和独立 token。

初始连接阶段真机验收为 NOT_PERFORMED；后续实测见下节。


## ADB 接通后的实测

设备为 PKC130，Android 16 / API 36，系统 PKC130_16.0.10.500(CN01)。手机 APK SHA-256 为 `7813017e5d7f9454bdafb5ead8ccfc5417f44c1242f096647eb16cf7032fa1c9`，与 F6c 一致。首次取证时 PID 28518 存在、主用户 stopped=false。

### 已复现：后台闹钟被系统代理推迟

用户现场的事项 `i_p6o9swk2mu5u9llr`，原生闹钟 ID 423925074，最终计划 1789668257487（手机 02:04:17.487）。baseline/alarm.txt 中广播和护航服务仍在 AlarmManager，requester 已过去约 10 分钟，但 adjustment 比 requester 多 259200000 ms（3 天）；对应 token 无 received。没有证据表明本次是排程被取消或进程已被强行停止。

受控第二轮 actions-r2 通过应用 makeItem/saveAsync 创建独立测试事项（不是正常表单 UI 验收），30 秒后触发，Home 后息屏，未修改权限。事项 `f6c_action_close_1789668972`，原生 ID 2125653363，最终计划 1789669002026。到点后约 10 秒的 r2-alarm.txt 仍显示广播、前台服务均被 adjustment 推后 3 天，r2-trace.xml 中没有 received，脚本因找不到目标闹钟 UI 停止。这轮是投递失败，不能据此判定关闭按钮失败。

runtime-logcat.txt 的 1789668982.815–.819：

- BroadcastQueue 对包 space.alliswell.inbox 设置 defer=true。
- OplusHansManager 记录 p_BC 和 p_alarm 10556。
- OplusAlarmAdjustment 调用 proxyAlarmsByUid(uid=10556, requester=1)。
- OplusAlarmAdjustMap 调用 addProxyUid；OplusBinderProxy 标明 calling: OFreezer。

因此本轮已确认 ColorOS 的冻结/闹钟代理链路阻止准时投递。3 天是当前系统排程调整值，不是等待 3 天实测后的迟到时长；具体哪个用户设置能解除该策略尚未做单变量试验。不能继续将它描述为已确认的 vivo fast_freezer 实现。

### 关闭与再设：证据及测试边界

- actions 首轮：闹钟准时送达，但脚本尚未点击时已经出现 done 动作，UI 标题断言失败；不能当作无人干预的关闭验收。
- foreground 首轮：close 动作、effectsStopped、通知移除、窗口销毁均存在；自动脚本却用电脑时间对比手机 trace，产生错误的 effectsStopped=false。已改为手机时钟。另一个差异来自上一轮测试事项的自然提醒记录更新，不能归为用户数据损坏。
- foreground-r2/close：关闭动作、停止效果、通知移除、事项保持 due、未写 ACK、保留后续排程等全部检查通过。该次实际 environment 为 screenOn=true、locked=true，不能仅凭目录名宣称严格的解锁前台对照。
- foreground-r2/ack：我知道了动作、停止效果、通知移除、acknowledged 状态均通过；整组未 PASS，因为既有用户事项的正常提醒更新了 lastRemindAt / lastAlertShownAt / remindCount。原始 before/after 已保留；本轮没有编辑该事项。
- 上述 close 后又成功收到下一条 ack 测试闹钟，说明应用没有因 close 永久丧失排程能力。
- “关闭”按当前设计只止本次响铃、不确认事项；后续提醒仍继续。它与“我知道了”“完成”的语义不同。

脚本 `scripts/verification/vivo-alarm-actions.py` 新增可选前台模式与动作选择，并改用手机点击时间。前台模式间隔发送 WAKEUP 防止自动息屏；每次仍需以 environment 和窗口证据确认实际状态。既有息屏默认行为保留。

实际扬声器是否停止不能仅由 effectsStopped 推断，待用户观察确认。没有安装新 APK、修改产品代码、厂商设置或系统权限。


### 最终补充验证与收尾

- 用户解锁后，snooze/snooze/result.json 全部检查通过。实际 environment 为 screenOn=true、locked=false、path=direct，真实按钮点击后设置约两小时 elapsed 排程；测试结束由应用完成该测试事项，避免两小时后再次打扰。
- done/done/result.json 全部检查通过：完成动作、停止效果、通知移除、归档、completedAt 以及原生/LocalNotifications 排程清空。两轮的原有事项快照均未变化。
- close 和 ack 的功能检查见上节；不把存在原有事项自然提醒更新的整组测试标为全绿。
- 所有本轮创建的测试事项均通过应用 completeItem 归档，保留条目；清理范围来自本轮 item-before.json 中的精确 ID。结果见 final-state.json，最终系统排程与 trace 已保存。
- 脚本 Python AST 语法检查、git diff --check 通过。没有改动 APK 或应用源码，没有提交/推送。本次是诊断完成，后台失效仍未修复；下一步需对 ColorOS 的可见后台/电池设置做单变量对照，确认哪项能解除 OFreezer 闹钟代理。
- 原始证据目录的 sha256-manifest.json 绑定文件哈希。设备原始日志可能含私人事项信息，当前只保存本地，没有发布。
