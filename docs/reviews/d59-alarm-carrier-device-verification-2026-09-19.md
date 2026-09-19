---
feature: android-alarm-carrier
type: device-verification
status: verified-with-gap
date: 2026-09-19
device: vivo V2238A (PD2238)
decisions: D58 D59 D60 D61 D63
---

# D59 闹钟档载体改造 · 真机验证记录

## 结论摘要

**D59 的核心承诺已在本机真机上成立**：无通知权限 + 息屏（锁屏）时，**铃声与振动照常**。

对照 2026-09-18 的旧实现实测（同一台机器、同一权限态、同一屏幕态）：**0/4**。
本轮同场景实测：铃声持续 **3 分钟以上**（`state:started usage=USAGE_ALARM`），振动按波形周期持续。

**但界面这一格仍然不可达** —— 见文末「剩余缺口」，那是 D63 显式接受的风险，本轮**未修**，也不在 D59 范围内。

---

## 1. 环境（含两条此前记录有误的事实）

| 项 | 值 |
|---|---|
| 设备 | vivo V2238A（`10ACBF2D3D000RS`） |
| **Android 版本** | **16（API 36）** |
| ROM | `PD2238_A_16.3.16.0.W10` |
| targetSdk / minSdk | 34 / 22 |
| 构建 | `releases/安心收件箱-debug.apk`（2026-09-19 08:59） |

### ⚠️ 事实更正 1：真机是 **Android 16**，不是「OriginOS 16」

此前若干轮记录里写的「vivo / OriginOS 16」是 **ROM 版本号**，被当成了 Android 版本。
`ro.build.version.release = 16` / `sdk = 36` —— 这是 **Android 16**。

**为什么这条重要**：Android 15/16 对前台服务与后台音频引入了新限制
（本轮实测已探到 `AudioHardening` 的告警，见 §4）。把 OS 版本认错会让「这些限制适不适用」判断错。
不过本应用 `targetSdk=34`，因此**只对 targetSdk 35/36 生效**的那些新限制多数不适用；
`foregroundServiceType` 的类型匹配要求是 targetSdk 34 就生效的，仍然适用。

### ⚠️ 事实更正 2：`SYSTEM_ALERT_WINDOW` 实测是**关闭**的

`appops get … SYSTEM_ALERT_WINDOW` → `ignore`。
此前在 2026-09-18 的复核里曾推测「第 1、6 轮 overlay 疑为开」——**本次读数不支持那个推测**。
本轮三次受控投递的 `deliveryOverlay` 均为 `false`。

其余基线：`POST_NOTIFICATIONS=granted`、`USE_FULL_SCREEN_INTENT=granted`（验证开始时）。
屏幕起点：`mWakefulness=Asleep` + `mDreamingLockscreen=true`。

---

## 2. 方法（两次失败与最终可用的路径）

这一节单独写，是因为**受控投递在这台机器上很容易做错**，而做错会得出相反的结论。

### ✗ 失败一：`am broadcast` 的 extras 被本地 shell 吃掉了

```bash
# 错误：本地 shell 先剥掉引号，设备端收到的是 --es body probe A
adb shell run-as PKG am broadcast … --es body "probe A" --es level critical --es alarmTraceToken d59A
```

症状**不是报错**，而是**静默错位**：`title` 正常，`body`/`level`/`alarmTraceToken` 全部丢失。
台账里表现为 `deliveryTrace` 为空字符串 —— 如果只看「广播 completed」会以为一切正常。

**正解**：整条命令用单引号包成**一个**参数交给设备端 shell：

```bash
adb shell 'run-as PKG /system/bin/am broadcast --user 0 -a … -n PKG/.AlarmTestReceiver --ei id 90002 --es title X --es alarmTraceToken T'
```

### ✗ 失败二：`am broadcast` 拉不起被冻结/已死的进程

```
Broadcasting: Intent { … }
Broadcast wait for finish timeout      ← 广播进了队列，但收件进程不在
```

`am broadcast` 没有 `FLAG_WAKE_FROM_IDLE` 特权。息屏冻结态、或 `pm revoke` 杀掉进程之后，
它**既不解冻也不拉起**，表现为超时且台账完全无记录。

### ✓ 正解：走真实 `setAlarmClock`（经 CDP 注入）

```bash
adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*'   # 取 pid
adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>          # 见下方端口坑
/usr/bin/python3 scripts/android-cdp-eval.py "(async () => { const r = await \
  window.Capacitor.Plugins.SystemBridge.scheduleAlarm({delayMs: 90000, id: 90002, title: 'D59C-noNotify', body: 'probe C'}); \
  return JSON.stringify(r); })()" 9223
```

返回：`{"ok":true,"exact":true,"alarmClock":true,"mode":"alarmClock","triggerAt":…,"trace":"90002:08e968f0-…"}`

系统里确认两条闹钟时钟都挂上了（**这是解冻与准点派发的前提**）：

```
RTC_WAKEUP #4  tag=*walarm*:space.alliswell.inbox.ACTION_TEST_ALARM   flags 0x3  exactAllowReason=policy_permission
RTC_WAKEUP #5  tag=*walarm*:space.alliswell.inbox/.AlarmRingService   flags 0x3  exactAllowReason=policy_permission
```

### ⚠️ 端口坑：本机 9222 被 Chrome 占用

```
lsof -nP -i :9222   →  Google Chrome … TCP 127.0.0.1:9222 (LISTEN)
adb forward tcp:9222 …  →  adb: error: cannot bind listener: Address already in use
```

用 **9223**。（此处 `adb forward --remove tcp:9222` 会报 `listener not found` —— 因为占用者根本不是 adb。）

---

## 3. 三个场景的实测结果

### Round A/B · 有通知权限 + 亮屏 + App 在后台

投递链路（`alarm_trace`，token `d59B`）：

```
received
environment              screenOn=true;locked=false;inCall=false;path=direct
ringServiceRequested     foreground service asked to hold sound+vibration
launchLikelyBlocked      no SYSTEM_ALERT_WINDOW
launchRequested          not proof of visibility
notifyReturned           silent; sound+vibration carried by AlarmRingService
carrierRecorded          sound=native;vibrate=native;foreground=true
ringStarted              carrier=native;foreground=true;sound=true;vibrate=true
```

客观读数：

```
AudioPlaybackConfiguration piid:135 type:MediaPlayer u/pid:10190/1740 state:started
  attr:AudioAttributes: usage=USAGE_ALARM content=CONTENT_TYPE_SONIFICATION
VibrationScaler: currentState = VIBRATING
STREAM_ALARM: Muted: false
ServiceRecord{.AlarmRingService} isForeground=true foregroundId=90090 types=0x00000002
  foregroundNoti=Notification(channel=attention-alarm-guard … vibrate=null sound=null …)
```

**要点**：
- `types=0x00000002` = `FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK` ✓（T1 生效）
- 前台通知 `sound=null vibrate=null` ✓（T2/T3：通知不再承载声振）
- **`launchLikelyBlocked` + `deliveryVisible=false`：界面被 BAL 拦下，但 `ringStarted sound=true;vibrate=true`** ——
  这正是 D59 的目的：**「响」不再被「亮」的失败连带**。

### Round C · **无通知权限 + 息屏锁屏**（H-08 的原始缺陷场景）

前置条件（实测）：

```
POST_NOTIFICATIONS: granted=false
AppSettings … importance=NONE
mWakefulness=Asleep ; mDreamingLockscreen=true
```

投递链路（token `90002:08e968f0-5aa8-4a7c-b722-dcd5ffe235f6`）：

```
requested                delayMs=90000
unfreezerScheduled       triggerAt=1789780076895;mode=alarmClock
scheduled                triggerAt=1789780076895;mode=alarmClock
carrierRecorded          sound=native;vibrate=native;foreground=true    ← 服务先起，铃声振动已接管
ringStarted              carrier=native;foreground=true;sound=true;vibrate=true
received                 ← 广播随后到达
environment              screenOn=false;locked=true;inCall=false;path=fsi+direct
screenCarrierMissing     system notifications disabled; full-screen intent has no carrier
                         (sound+vibration unaffected: carried by AlarmRingService)
ringServiceRequested     foreground service asked to hold sound+vibration
launchLikelyBlocked      no SYSTEM_ALERT_WINDOW
launchRequested          direct launch alongside full-screen intent
notifyReturned           silent; sound+vibration carried by AlarmRingService
ringDuplicateStart       same delivery already ringing; kept as-is      ← 幂等生效
```

客观读数（**这是本轮最关键的一行**）：

```
AudioPlaybackConfiguration piid:143 type:MediaPlayer u/pid:10190/24934 state:started
  attr:AudioAttributes: usage=USAGE_ALARM content=CONTENT_TYPE_SONIFICATION
```

持续观察：投递后 **3 分钟以上**仍是 `state:started`；振动 8 次采样得
`VIBRATING, IDLE, VIBRATING, VIBRATING, IDLE, VIBRATING, IDLE, VIBRATING`
—— 正是波形 `{0,800,400,800,600}` 的「振-停-振-停」节奏，**不是单次采样的假象**。

载体台账（归属判定生效，`deliveryTrace == carrierTrace`）：

```
deliveryNotifyEnabled = false          ← 无通知权限
deliveryScreenOn      = false          ← 息屏
deliveryLocked        = true           ← 锁屏
deliveryPath          = fsi+direct
carrierSound          = native         ← 铃声载体：App 自播
carrierVibrate        = native         ← 振动载体：App 自调
carrierForegroundService = true
deliveryTrace = carrierTrace = 90002:08e968f0-5aa8-4a7c-b722-dcd5ffe235f6
```

**对照结论**：旧实现同场景 **0/4**（不响铃、不振动、不亮屏）→ 现在**响铃 + 振动**。

顺带证到三件设计意图：
1. **载体由闹钟时钟位先派发**：`carrierRecorded` 出现在 `received` **之前** ——
   解冻器（F3）与响铃持有者（D59）合并后，铃声比广播更早起来。
2. **`ringDuplicateStart`**：广播侧再次请求时被识别为同一次投递，**没有**打断重播
   —— 这正是 V3「响铃被打断重启」的同类防护。
3. **`screenCarrierMissing`** 新文案落在台账里，且明确写出「sound+vibration unaffected」
   —— 旧文案会被读成「整个闹钟哑了」。

### Round D · 停止路径（T6）

用**真实的** `AlarmStopReceiver`（等价于点通知的「停止声振」），而非直接 kill 服务：

```bash
adb shell 'run-as PKG /system/bin/am broadcast --user 0 -a space.alliswell.inbox.STOP_DELIVERY \
  -n PKG/.AlarmStopReceiver --ei id 90002 --es alarmTraceToken 90002:08e968f0-…'
```

| 项 | 停前 | 停后 |
|---|---|---|
| 音频活跃播放器（uid 10190） | 1 | **0** |
| 服务 `isForeground=true` | 在 | **0** |
| 振动 | VIBRATING | **IDLE** |
| 台账 | — | `deliveryStopped notification, ring service and fallback effects stopped` |

**这一格是 D59 引入的新风险点**：铃声不再挂在通知上，「撤通知」不再自动停声。
`ActiveAlarmStore.stop()` 里那行 `AlarmRingService.requestStop(context)` 是**唯一**让它停下来的东西 ——
`reverse-check-d59.js` 的「T6 停铃收口缺失」用例已证明：删掉它，断言立刻变红。

---

## 4. 新发现的风险信号（本轮未修，登记）

### `AudioHardening background playback would be muted`

```
Events log: Hardening enforcement
09-19 09:01:58:447 AudioHardening background playback would be muted for space.alliswell.inbox (10190), level: full
09-19 09:02:29:424 AudioHardening background playback would be muted for space.alliswell.inbox (10190), level: full
```

Android 15+ 引入的后台音频硬化。**本次并未真的被静音** ——
同一时刻 `AudioPlaybackConfiguration … state:started`、`mutedState:streamVolume`（不是 `muted`），
且 `STREAM_ALARM: Muted: false`。合理推测是 `mediaPlayback` 前台服务使它豁免
（**这是推断，不是已证事实**）。

**为什么仍要登记**：这是「后台播放音频」这条路上第一次看到系统级告警，
而本方案的整个立足点就是「应用自己播」。若将来某版 ROM 把 `would be muted` 变成真的静音，
D59 会以同样安静的方式失效 —— 与 H-08 一模一样的失效形态。**需要一条能在真机上读到它的检查**。

---

## 5. 剩余缺口（D63 显式接受的风险，本轮**未修**）

| 要素 | 无通知权限 + 息屏时的实测 |
|---|---|
| 铃声 | ✅ 响 |
| 振动 | ✅ 振 |
| **屏幕** | ❌ 不亮（`mWakefulness` 全程 `Asleep`） |
| **界面** | ❌ 未拉起（`dumpsys activity activities \| grep AlarmActivity` = **0**） |

`launchLikelyBlocked`（`no SYSTEM_ALERT_WINDOW`）+ `launchRequested` 说明：
**声振已经与界面解耦，但界面本身依旧起不来** —— 它卡在 BAL，而 BAL 与通知权限无关，是另一个坑。

**用户侧的实际体验**：会听到闹钟一直响，但**看不到任何界面**，通知栏里也没有东西（无权限）。
唯一的停止入口是**解锁并打开 App**；若不做，铃声将一直响到 `MAX_AGE_MS`（6 小时）。

**这比修复前更糟的可能性没有被排除**（D63 已书面接受这一点）。要真正闭环，需要在**界面**这一格上
再往前走一步 —— 候选方向（**尚未裁决**）：

- (a) 引导用户授予 `SYSTEM_ALERT_WINDOW`（有文档依据，但靠用户配合）
- (b) 在响铃期间由服务**持续**尝试拉起界面，而不是只在投递瞬间试一次
- (c) 用「停止响铃」的其他入口兜底（音量键 / 电源键 / 服务内的超时策略）

**在裁决之前不应动代码。**

---

## 6. 证据可复现性

> ⚠️ **本节的数字是 D59 交付时点（09:10 之前）的水位，已被同日稍后的 D64–D67 门禁改造覆盖。**
> D64 之后的当前水位是：unit **249** · native **245** · smoke **204** · regressions **574**（0 失败）、
> 反向验证 **22/22**、构建物 `安心收件箱-debug.apk`（09:26）。
> 见 [`d64-release-gates-device-verification-2026-09-19.md`](./d64-release-gates-device-verification-2026-09-19.md)。
> 保留原数字是为了让「哪一轮改了多少」可追溯，**引用前请先实测**。

- 构建物：`releases/安心收件箱-debug.apk`（08:59 · D59 时点）
- 单元/回归：unit 249 · native 234 · smoke 197 · regressions 574（0 失败）
- 反向验证：`node scripts/verification/reverse-check-d59.js` → **10/10**（D59 时点；D64 后为 22/22）
- 真机台账：`/data/data/space.alliswell.inbox/shared_prefs/{alarm_trace,attention_alarm}.xml`
- 设备已恢复：通知权限**已还原为 granted**、无残留响铃、无遗留测试闹钟、端口转发已清
