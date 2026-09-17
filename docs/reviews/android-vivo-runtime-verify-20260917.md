# vivo 真机运行时验证（V1 / V2 / V3 修复）· 2026-09-17

> **后续**：本文 §6 的 A-2「广播被 ROM 推迟 22–74 s」已在
> `docs/reviews/android-vivo-freezer-rootcause-20260917.md` 里定位到根因
> （`fast_freezer` 冻结 + 冻结态下任何投递都进不来），并给出了四次实验的证据与
> 仍需产品裁决的三个选项。本文的 §5 结论（接收侧「直起为主 + 全屏意图兜底」保持不变）仍然有效。

设备 `10ACBF2D3D000RS` · vivo V2238A · Android 16 / API 36 · OriginOS 16.0
验证对象：`releases/安心收件箱-vivo-fix-20260917-debug.apk`（SHA-256 `25d2fd10…`）

> 判据来自 `docs/reviews/android-vivo-fix-20260917.md` §6。本文只记实测，不给产品结论。

---

## 1. 交付链核验（先证明设备上跑的确实是修复包）

| 项目 | 值 |
| --- | --- |
| 设备侧 base.apk | `25d2fd102003f2fc038795be2e35abffb99f6e008dea3292d514eb2ed93a9008` |
| 本地修复包 | 同上（逐字节一致） |
| APK 内 `assets/public/app-core.js` | `2c49d70358a2ddb776876a901a0b74237817b61333d08fb7769527066eee8870` |
| 源 `app-core.js` | 同上 |

安装方式：`adb install -r`。首次在锁屏态被拒（`INSTALL_FAILED_ABORTED`，vivo 的
`PackageInterceptActivity` 确认框在锁屏下无法显示），**解锁后**由 `input tap` 完成勾选与确认，
`lastUpdateTime` 20:51:07 → 21:36:52。

---

## 2. 场景矩阵（三次投递，各自独立取证）

| # | 投递时环境 | path | deliveryVisible | AlarmActivity | 排定→投递延迟 | 用户感知 |
| --- | --- | --- | --- | --- | --- | --- |
| B | 解锁亮屏 + 已授悬浮窗 | `direct` | **true** | created → 可见 | 0.3 s | ✅ 正常全屏 |
| A1 | 息屏锁屏（采集时人为唤醒） | `fsi` | false | created 后 271 ms 销毁 | **74 s** | ❌ 无界面 |
| A2 | 息屏锁屏（全程静默） | `fsi` | false | **未创建** | **22 s** | ❌ 无界面、无声 |
| A3 | 息屏锁屏（全程静默） | `fsi` | false | **未创建** | **27 s** | ❌ 无界面、无声 |

环境取值均由 Receiver 自己落盘（`environment` 事件），非事后推断。

---

## 3. 场景 B（解锁亮屏）· 通过

台账：`deliveryPath=direct`、`deliveryVisible=true`、`deliveryShownAt=…495898`
（比 `deliveryAt=…495570` 晚 **328 ms**）、`deliveryHiddenAt=0`、`deliveryOverlay=true`。

事件链（`alarm_trace.xml`）：

```
received → environment(screenOn=true;locked=false;inCall=false;path=direct)
→ launchRequested → notifyReturned → created → audioState → audioStarted
→ resumed → focus(true) → windowVisible(via=focus)
→ windowSample 300/800/1500ms 全部 focus=true;shown=true;visibility=0
```

`replaced` / `duplicateIntent` / `effectsStopped` / `launchFailed` **各 0 次**。
`mCurrentFocus = AlarmActivity`，截图为证（`evidence-vivo-2026-09-17/06-direct-path.png`）。

**结论：V1 的可见性自证、V2 的归因、V3 的单路直起，在解锁亮屏这一格全部按设计工作。**

---

## 4. 场景 A（息屏锁屏）· 未通过 —— 本轮最重要的发现

### 4.1 系统全屏意图没有拉起 Activity

A2 的完整事件链：

```
21:45:23.917 scheduled | triggerAt=1789652783911      (21:46:23.911)
21:46:46.107 received                                  ← 延迟 22.2 s
21:46:46.147 environment | screenOn=false;locked=true;inCall=false;path=fsi
21:46:46.175 directSkipped | lockscreen path is handled by full-screen intent
21:46:46.221 notifyReturned | notify returned; not proof of display
（之后没有任何事件：没有 created、没有 audioStarted）
```

而 `dumpsys notification --noredact` 显示这条通知**一切齐备**：

```
id=90003 channel=attention-alarm-v3 importance=4 vis=PUBLIC category=alarm
fullscreenIntent=PendingIntent{… startActivity (allowlist: 87a5bfc:+30s0ms/0/NOTIFICATION_SERVICE/NotificationManagerService)}
```

也就是说：渠道是 HIGH、`USE_FULL_SCREEN_INTENT` 已授予、通知带 `fullscreenIntent`、
系统甚至已经给出 **30 秒的 BAL 豁免**，但 **AlarmActivity 始终没有被创建**。

**声音也没有** —— 因为声音只在 `AlarmActivity` 里播放（`audioStarted` 由它写）。
Activity 不起，用户就是彻底无感知。这正是原始报障「闹钟只有打开 App 才响」的现场。

### 4.2 广播本身还会被 ROM 推迟

三次投递的「排定 → `received`」延迟：**74 s / 22 s / 27 s**。
`dumpsys alarm` 的 stats 佐证应用确实被唤醒过：

```
u0a190:space.alliswell.inbox +128ms running, 2 wakeups:
    *walarm*:space.alliswell.inbox.ACTION_TEST_ALARM
```

CPU 被唤醒（wakeups 计数增长），但**广播投递被推后到设备被唤醒之后**。
设备当前**不在待机白名单**（`dumpsys deviceidle whitelist` 中无此包）。

### 4.3 A1 的附加现象

A1（采集前人为唤醒屏幕）里 Activity 确实 `created` 了，但：
`created → audioStarted → resumed → paused(finishing=true) → stopped → destroyed`，
全程 **271 ms**，`isFinishing()` 在所有回调里都是 true。`finish()` 的两个调用点
（TEST 通道 5 秒超时、按钮动作）都不适用于本次投递 —— 即这是**外部因素结束的**。
该场景带有「用 adb 唤醒屏幕」的人为干扰，不计入判定，仅存档。

---

## 5. 代码层面的结论：V3 的「互斥」假设被推翻

V3 当时把锁屏/息屏定为「只走系统全屏意图、不再直起」，理由是消除双路竞态。
真机取证表明这个假设**在这类 ROM 上不成立**：全屏意图并不可靠，把它当唯一投递路径，
等于把「用户能否看到闹钟」押在一个不工作的机制上。

同时也要说明：**竞态本身已经被修掉了，而且是另一处修的** ——
`AlarmActivity.onNewIntent` 对**同一 token** 只记 `duplicateIntent` 并保持响铃，
只有 token 不同才走 `replaced`。既然两条路径携带的是同一个 token，
「两条路都发」就不再会打断声音。

因此修正为：**直起是主路径，全屏意图是系统级兜底，两者并存**。
本次改动（`AlarmTestReceiver.java`）：

1. `directPath` 由「解锁亮屏专用」改回 `fullScreen && (!inCall || locked)` ——
   仅「解锁 + 通话中」让路（Q5 语义不变）；
2. 「锁屏/息屏」不再 `directSkipped`，与全屏意图一起直起；
3. `path` 取值改为 `fsi+direct` / `direct` / `banner`，台账能区分这次到底发了几路；
4. `launchRequested` 的 detail 标注 `alongside full-screen intent`，便于事后分辨。

测试：**native 168 / smoke 175 / regressions 567 / unit 105 = 1015 全绿**，
新增 2 条守卫断言，其中一条明确**反断言**旧的互斥写法不许复活
（`directPath = fullScreen && !backgroundDelivery` 不得再出现）。

---

## 6. 仍未解决 / 未验证

| 编号 | 事项 | 状态 |
| --- | --- | --- |
| A-1 | 息屏/锁屏下直起能否真的点亮屏幕并显示 | **待复测**（本次改动后尚未上机） |
| A-2 | 广播被 ROM 推迟 22–74 s | 应用侧无法直接修；需引导用户加入待机白名单/自启动白名单 |
| A-3 | 声音只在 AlarmActivity 播放，Activity 不起即无声 | 若 A-1 复测仍失败，需考虑 Receiver 侧声音兜底 |
| A-4 | vivo 对该应用 `isShowHeadsUp/isShowKeyguard=false`（V4） | 无公开 API 可读写，只能引导 |
| A-5 | 覆盖升级、重启重排、XSpace(666) 内行为 | 未验证 |

---

## 7. 复测判据（下一轮）

1. 息屏锁屏 → `path=fsi+direct` 且 `launchRequested` 出现（含 `alongside` 字样）；
2. `deliveryVisible=true`、`deliveryShownAt>0`，屏幕被点亮，截图能看到闹钟界面；
3. 若两条路径都被拉起，`duplicateIntent` 允许出现，但 **`replaced` 必须为 0、声音不得中断**；
4. 仍存在的延迟（A-2）单独记录，不计入本次修复的成败。

---

## 8. 证据文件

`docs/reviews/evidence-vivo-2026-09-17/`：`06-direct-path.png`（场景 B 成功全屏）。
其余原始 dump（`alarm_trace.xml`、`attention_alarm.xml`、`dumpsys alarm`、`dumpsys notification`）
采样于 `/tmp/vivo-verify/`，关键片段已摘录在本文各处。
