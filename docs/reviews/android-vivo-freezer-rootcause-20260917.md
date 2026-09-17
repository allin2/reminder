# vivo 真机「闹钟只有打开 App 才响」根因定位与修复复测 · 2026-09-17

> 2026-09-18 更新：R-1 已完成当前 F5 真机验证。允许后台耗电 + 锁屏显示恢复息屏全屏，自启动放行后冷启动也通过。本文保留历史实验，当前结论以 [R-1 验证报告](android-vivo-r1-validation-20260918.md) 和 [交接文档](../handoff/2026-09-18-android-alarm-freezer.md) 为准。

设备 `10ACBF2D3D000RS` · vivo V2238A · Android 16 / API 36 · OriginOS 16.0
被测包（按实验顺序）：

| 标签 | 文件 | SHA-256（前 16） |
| --- | --- | --- |
| F3 | `releases/安心收件箱-alarm-fix3-20260917-debug.apk` | `efc4c137f63b8860` |
| F3b | `releases/安心收件箱-alarm-fix3b-20260917-debug.apk` | `00bdec03c34b968e` |
| F3c | `releases/安心收件箱-alarm-fix3c-20260917-debug.apk` | `305b6d18e3aa0c5f` |

---

## 0. 一句话结论

**闹钟是准时的，App 是醒不过来的。**

系统的 `AlarmManager` 在预定时刻分秒不差地唤醒了设备并派发了闹钟；但此时应用进程已被
ROM 的 `fast_freezer` 冻进 cgroup，**冻结态下任何投递都进不了这个进程** —— 广播、前台服务启动、
连「闹钟时钟」形态的启动都不例外。用户于是看到「闹钟只有打开 App 才响」。

这是**系统状态**导致的失败，不是排程或投递逻辑的缺陷。应用侧的排程、投递、迟到补投全部按设计工作
（见 §3 的对照实验）。要真正准点响，只能让进程**不被冻结**，而这需要用户在 vivo 的后台白名单里放行。

---

## 1. 根因：`fast_freezer` 冻结 + 冻结态下的投递黑洞

### 1.1 冻结发生得极快

```
1789657149.931  1843  2149 I am_app_frozen: [0,10190,space.alliswell.inbox,from fast_freezer]
```

这次冻结距用户按 HOME 退到后台约 **4 秒**（screen 此时还是亮的）。

### 1.2 冻结期间，系统照常派发闹钟，但进程没醒

同一次实验（F3，息屏静默，闹钟定在 23:00:08.301）：

```
1789657208.338  1843  2390 I device_idle_wake_from_idle: [0,*walarm*:space.alliswell.inbox.ACTION_TEST_ALARM]
```

到此为止一切正常。但此后**该应用零事件**：没有 `am_app_unfrozen`、没有 `am_proc_start`、
没有 `wm_create_activity`、通知 0 条。台账里也**既没有 `received`（广播）也没有
`unfreezerStarted`（前台服务）** —— 两条排程都排上了，但一条都没被执行。

### 1.3 `dumpsys alarm` 把机制说得很清楚

冻结那一刻，AlarmManager 给该 UID 的**全部**闹钟打上挂起标记（dump 时刻 23:02:39.933，
`elapsed=-3m30s10ms` 与 `rtc=22:59:09.923` 互为印证 —— 正是 `am_app_frozen` 的同一毫秒）：

```
  u0a190:
    #1..#10: Reason=frozen   rtc=2026-09-17 22:59:09.923
      #6: tag=*walarm*:space.alliswell.inbox/.AlarmRingService      ← 解冻器也在被挂起之列
      #1..#5,#7..#10: tag=*walarm*:…TimedNotificationPublisher
```

而占「闹钟时钟」位（`flags 3` = `FLAG_WAKE_FROM_IDLE`）的那条**准点派发了**：

```
    +478ms 8 wakes 8 alarms, last -2m31s595ms: *walarm*:space.alliswell.inbox.ACTION_TEST_ALARM
    （23:02:39.933 − 2m31s595ms = 23:00:08.338，与 device_idle_wake_from_idle 同一毫秒）
```

### 1.4 「解冻后补投」是真的，但等于「用户碰手机才响」

F3 那次 23:00:08 的闹钟，**直到 23:04 把应用拉回前台才被投递**：token
`825138261:7951bacc-48a` 的 `received → notifyReturned → created` 出现在随后的对照实验窗口里。
这与更早一轮记录到的「晚 22–77 秒」是同一个现象的两个样本。

---

## 2. 四次实验与结果

| # | 包 | 场景 | 解冻器 | 广播投递 | 用户可见 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | F3 | 息屏静默（冻结） | ❌ 未执行 | ❌ 未送达 | ❌ | 两条都排上了，两条都没进来 |
| 2 | F3 | **保持前台**（未冻结） | ✅ `unfreezerStarted` | ✅ `received` | ✅ `deliveryVisible=true` | **机制本身可用** |
| 3 | F3b | 息屏静默（冻结） | ❌ 未执行 | ❌ 未送达 | ❌ | 把解冻器挪到闹钟时钟位**仍不够** |
| 4 | F3c | 前台服务持有 40 s，退后台 | — | — | — | **前台服务也挡不住冻结**（§4） |
| 5 | F3c | **进程被完全杀掉**后再等闹钟 | — | — | ❌ | **系统连进程都不重新拉起**（§4.2） |

实验 2 的完整台账（对照组，证明代码没问题）：

```
unfreezerStarted → received → notifyReturned(insistent) → unfreezerStopped(hold=8000ms)
deliveryAt       = 23:05:01.963   （目标 23:05:01）
deliveryPath     = direct
deliveryVisible  = true
deliveryShownAt  = 23:05:02.323   （比 deliveryAt 晚 360 ms）
```

实验 3 的处置：排程已确认两条都变成闹钟时钟（`flags 3`），系统在**同一毫秒**为两者各记一次
`device_idle_wake_from_idle`，但进程仍未解冻、通知仍 0 条：

```
1789658346.643  device_idle_wake_from_idle: [0,*walarm*:…/.AlarmRingService]
1789658346.643  device_idle_wake_from_idle: [0,*walarm*:….ACTION_TEST_ALARM]
（此后无 am_app_unfrozen / 无 received / 无 unfreezerStarted）
```

---

## 3. 代码侧改动（F3 → F3b）

改动只涉及排程形态，**没有改动产品行为**。

| 文件 | 改动 |
| --- | --- |
| `AlarmScheduler.scheduleUnfreezer(...)` | 新增 `AlarmClockInfo` 参数：有闹钟时钟位就用 `setAlarmClock` 排解冻器，否则退回 `setExactAndAllowWhileIdle`，并把实际形态写进台账 `unfreezerScheduled … mode=alarmClock|allowWhileIdle` |
| `AlarmScheduler.schedule(...)` | 投递载体仍是广播；把 `clockInfo` 透传给解冻器 |
| `SystemBridgePlugin.scheduleAlarmInternal(...)` | 把 `clockInfo` 传给解冻器（原先是内部变量，拿不到） |
| `AlarmRingService` | 新增测试钩子 `EXTRA_HOLD_MS`（前台身份保留时长可传入，默认仍是 8 s）；注释补录 `Reason=frozen` 取证与对照实验结果 |
| `test-native-reminders.js` | 断言随签名更新；新增「必须排在闹钟时钟位」「拿不到时钟位时如实记 mode」「两处注释保留 Reason=frozen 取证」「测试钩子存在」四条 |

测试：**unit 105 / native 180 / smoke 175 / regressions 567 = 1027 全绿**。

> 为什么要动这一处：实验 1 里解冻器自己也在 `Reason=frozen` 的被挂起名单里 —— 排成
> allow-while-idle 的解冻器在冻结态**根本没被派发**，等于没排。实验 3 证明修好这一条仍不够，
> 但它是必要条件：排错位的解冻器连机会都没有。

---

## 4. 反例：前台服务也不足以免冻

用 `EXTRA_HOLD_MS` 让前台服务持有 40 秒前台身份，然后退到后台观察：

```
probe3 → unfreezerStarted        （服务确实以前台身份在跑）
退到后台约 35 秒后：
1789658785.055  am_app_frozen: [0,10190,space.alliswell.inbox,from fast_freezer]
（此时 40 秒持有期尚未结束，台账里还没有 unfreezerStopped）
```

即：**这台 ROM 的冻结策略不看 AOSP 的 oom_adj**（前台服务本应把进程挡在 cached 之外），
它按厂商自己的后台策略冻。前台服务把「4 秒后被冻」延后到「约 35 秒后被冻」，但没有免除。

> 方法学记录（踩过的坑）：`run-as <pkg> am start-foreground-service` 会因为 `am` 默认
> `--user -2` 而抛 `SecurityException: … INTERACT_ACROSS_USERS`；以 shell 身份启动则被
> `exported=false` 拒绝。**必须加 `--user 0`**。前两轮「免冻」实验因此服务根本没起来，
> 结论作废，已重做。

### 4.2 更狠的一条：进程被完全杀掉，系统也不重新拉起

`fast_freezer` 只冻**活着的**进程，于是试了最后一招：让应用以自身 uid 发 SIGKILL 结束自己
（**不是** `am kill`、更不是 `am force-stop`，因此 `stopped=false`，不进停止态），
让系统在闹钟到点时**重新**拉起它。

```
23:51:25  自尽（kill -9 18624）
23:51:27  进程: []            ← 确实没了
          User 0: … stopped=false vStopped=false   ← 不在停止态，排程与静态接收器应当可用
23:52:31  目标时刻
1789660351.819  device_idle_wake_from_idle: [0,*walarm*:…/.AlarmRingService]
1789660351.819  device_idle_wake_from_idle: [0,*walarm*:….ACTION_TEST_ALARM]   ← 系统照常唤醒
23:53:27  进程: []             ← **没有被重新拉起**
          通知条数: 0；events 里没有 am_proc_start
```

**结论：不只是「冻」，这台 ROM 连本应用的后台自启动都不放行。** 没有活进程时，
系统宁可把闹钟派发出去也不启动目标进程 —— 这正是 vivo 「自启动 / 后台运行」白名单所管的开关。

这条把剩下的出路收敛到唯一一条：**用户必须在厂商设置里放行本应用**，应用侧无法自行绕过
（§5 中已验证：`cmd deviceidle whitelist`、7 项 `settings put`/`appops`/standby bucket 全部无效）。

---

## 5. 未解决 / 需要产品裁决

应用侧能做的已经做完，剩下的是产品决策，按 V0.2 §22「冲突先停下报告，不自行优化产品逻辑」交回裁决。

| 编号 | 选项 | 代价 / 前提 | 实测依据 |
| --- | --- | --- | --- |
| R-1 | **引导用户把应用加入 vivo 后台白名单**（自启动 / 后台高耗电 / 允许后台运行），并给出直达深链 | 需用户手动操作；**尚未在真机上验证放行后是否真的恢复准点** | §4.2 已证明「系统连进程都不重新拉起」，这是**唯一**剩下的出路；AOSP 侧白名单（`cmd deviceidle whitelist`）与 7 项 `settings`/`appops`/standby bucket 调参**全部实测无效**；也没有任何可读状态位可供应用自检 |
| R-2 | 常驻前台服务（「准点保障」） | 常驻通知，违反「低交互优先」；实测只买到约 35 秒 | §4 |
| R-3 | 维持现状：进度条退化为「解冻即补投」，自检面板如实说明 | 用户会看到「迟到」的提醒 | §1.4、V2 已改好的归因文案 |

R-1 的**深链**（逐条真机实测，`top` = 启动后真正在前台的 Activity）：

| 目标 | 结果 |
| --- | --- |
| `com.vivo.abe/…ExcessivePowerManagerActivity` | ❌ `Exception`，top 仍是桌面 —— **未导出** |
| `com.iqoo.secure/…appmanager.AppManagerActivity` | ❌ `Exception`，top 仍是桌面 —— **未导出** |
| `com.vivo.permissionmanager/.activity.PurviewActivity` | ❌ `Exception` |
| **`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`** | ✅ top = `com.iqoo.powersaving/.BackgroundHighUsageActivity` —— **正是「后台高耗电」页** |
| **`ACTION_APPLICATION_DETAILS_SETTINGS`**（`package:<本包>`） | ✅ top = `com.android.settings/.applications.InstalledAppDetails` |

> **方法学**：`cmd package resolve-activity` / `PackageManager.resolveActivity() != null`
> **只说明组件存在，不代表能启动**（`exported=false` 的组件照样解析得到）。
> 第一轮按解析结果写了厂商显式组件，真机全部打不开 —— 可用性只能靠 `am start` 实跑判定。
> 现已改为「先 `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`，失败再退到应用详情页」，
> 并把实际打开的那个回传给 JS（`opened`）。

应用侧**没有任何可读的状态位**能判断「是否被放行」（`fast_freezer` 在 appops / standby 之下，
`getAppStandbyBucket()` 返回厂商自定义值 `5`，`isBackgroundRestricted()` 大概率恒为 false）。
因此只能**症状式自检**：用一次真实的端到端自检（排一条近端闹钟 → 看是否准点送达）来判定，
而不是靠猜状态位。

另有两条遗留观察：

- **F4 幽灵闹钟**：F1 实验版用过的 `PendingIntent.getActivity` 闹钟在换形态后撤不掉，
  `dumpsys alarm` 里仍挂着 `tag=*walarm*:space.alliswell.inbox/.AlarmActivity`（2 次 wake，最后 22:46:30）。
  新版 `cancel()` 已覆盖三种形态，但只对「`filterEquals` 相同」的 Intent 有效 —— 换形态时
  **必须同时保证 Intent 的 action/data/type/category 一致**，否则会留下撤不掉的残留。
- `rom` 侧：本机 logcat 的 main/system 缓冲几乎被屏蔽（一次 2 分钟采集只有 31 行），
  framework 日志不可得；**唯一可用的框架取证通道是 events 缓冲**（`am_app_frozen`/`am_app_unfrozen`/
  `device_idle_wake_from_idle`/`wm_*`/`am_pss`），后续真机排查不要浪费时间在 main/system 上。

---

## 6. 复测判据（下一轮）

1. 先把应用加入 vivo 后台白名单，再跑同样的息屏静默实验；
2. 判据：闹钟时刻后 10 秒内出现 `unfreezerStarted` 且 `deliveryVisible=true`、通知 1 条；
   期间**不应**出现 `am_app_frozen`；
3. 若仍未通，R-1 判死，回到 R-2 / R-3 的取舍。

---

## 7. 证据文件

本次全部原始采集在 `/tmp/vivo-f3/`（`f3-a-*`、`f3-ctl-*`、`f3b-a-*`、`probe3-*`、`alarm-now.txt`、
`events-now.txt`）；脚本：`/tmp/vivo-f3-trial.sh`（息屏试验）、`/tmp/vivo-f3-control.sh`
（前台对照）、`/tmp/vivo-fgs-exempt-long.sh`（免冻试验）。
