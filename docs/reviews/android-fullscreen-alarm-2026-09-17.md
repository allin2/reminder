# 全屏闹钟真机不弹的完整诊断与修复（Q3 / Q5）— 2026-09-17

> 用户现象：应用内「10 秒后全屏闹钟」到点后，桌面只出现一条横幅通知，**没有全屏**。
> 结论：不是 Q2 回退，而是**平台规则 + 缺一项权限 + 没有自检手段**三件事叠加。
> 其中「缺权限」与「没有自检手段」已修复并复验；行为边界（通话中不抢屏）已按用户裁决实现。

---

## 1. 现象与定位

截图里那条通知的标题/正文（「安心收件箱闹钟测试 / 10 秒闹钟触发成功 · 可锁屏验证」）
来自应用内自检面板的 `labScheduleAlarm(10000, "10 秒")`（`app-core.js`），
它走的是 `SystemBridge.scheduleAlarm({fullScreen:true})` → `AlarmTestReceiver`。

也就是说：**闹钟准时响了、广播也到了，但全屏界面没起来。** 这与 Q2（排程时刻错）是两件事。

---

## 2. 平台规则：全屏由两道门决定

### 2.1 FSI（全屏 intent）官方行为表

`setFullScreenIntent` 在不同屏幕状态下的表现（AOSP: full-screen intent limits）：

| FSI 权限 | 解锁亮屏 | 锁屏 | 息屏 | AOD |
|---|---|---|---|---|
| 已授予 | **常驻横幅通知** | 弹全屏 | 弹全屏 | 弹全屏 |
| 被撤销 | 横幅 60s | 横幅 60s | 横幅 60s | 横幅 60s |

→ **解锁亮屏时，全屏 intent 被系统有意降级成横幅。** 这是平台设计，不是缺陷。
→ 所以「解锁也要全屏」只能靠另一条路：自己把 Activity 起起来。

### 2.2 自己起 Activity：后台启动限制（BAL）

Android 10 起，后台进程 `startActivity` 默认被拦。官方豁免清单里，第三方应用唯一能主动申请的
是 **`SYSTEM_ALERT_WINDOW`**（系统设置里的「显示在其他应用上层」/「悬浮窗」）。

拦截是**静默**的：`startActivity` 不抛异常，只写一行 logcat ——
原始代码里 `launched = true` 因此永远为真，后面的兜底分支永远不会执行。

```
E ActivityTaskManager: Background activity launch blocked [... callingUidProcState: RECEIVER ...]
I ActivityTaskManager: START u0 {...cmp=space.alliswell.inbox/.AlarmActivity} ... (BAL_BLOCK) result code=102
```

### 2.3 Android 14 起 USE_FULL_SCREEN_INTENT 变成「特殊应用访问权限」

只有通话/闹钟类应用默认授予；其余需用户在「特殊应用权限 → 全屏通知」里手动开。
未授予时 FSI 被**静默丢弃** —— 官方给出的自检入口是 `NotificationManager#canUseFullScreenIntent()`。

---

## 3. 三个根因

| # | 根因 | 性质 |
|---|---|---|
| Q3-a | 清单没声明 `SYSTEM_ALERT_WINDOW`，直起全屏必被 BAL 拦 | 实现缺失 |
| Q3-b | 从没检查 `canUseFullScreenIntent()`（API 34+），FSI 可能被撤销而无人知 | 实现缺失 |
| Q3-c | 投递结局无记录：`launched` 恒为真，界面上「成功」与「被拦」长得一模一样 | 可观测性缺失 |

Q3-c 是这次排查最贵的一环 —— 没有它，用户只能说「还是只弹通知」，
而代码侧连"有没有试过"都答不上来。

---

## 4. 修复

### 4.1 原生：补齐前提权限与能力探测（`SystemBridgePlugin`）

- 清单新增 `SYSTEM_ALERT_WINDOW`（唯一可申请的 BAL 豁免）。
- `diagnose()` 新增：`canDrawOverlays`、`canUseFullScreenIntent`、`alarmChannelImportance`、`alarmChannelId`。
- 新增三个跳转：`openOverlaySettings`（`ACTION_MANAGE_OVERLAY_PERMISSION`）、
  `openFullScreenIntentSettings`（API 34+ 用 `android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT`）、
  `openAutoStartSettings`（ColorOS / MIUI / EMUI / vivo / 三星等厂商自启动组件逐个试，全失败退回应用详情）。

### 4.2 原生：把「尝试」与「真的起来了」拆开落盘

`AlarmTestReceiver` 在起全屏**之前**写台账（顺序反了会被 Activity 覆盖）：

```
deliveryAt / deliveryAttempted / deliveryScreenOn / deliveryLocked / deliveryOverlay / deliveryInCall
```

`AlarmActivity.onCreate` 写 `deliveryShownAt`。`SystemBridgePlugin.lastAlarmDelivery()` 回读两者。

判据：**`attempted && !shownAt` ⇒ 全屏被拦**，且按投递时环境给出具体原因。

### 4.3 前端：自检面板说人话

- 状态行新增「全屏闹钟」：`解锁亮屏与锁屏都能弹全屏` / `缺「显示在其他应用上层」· 解锁亮屏只出横幅` / …
- 新增三行跳转入口（5 悬浮窗 / 6 全屏通知 / 7 自启动·后台弹出界面）。
- 新增「上次闹钟投递结果」行：`全屏闹钟已弹出 · 今天 14:15` 或 `只出了通知横幅 · … · 缺「显示在其他应用上层」`。
- 回到应用时自动刷新（`visibilitychange`），不必手点「刷新诊断」。

---

## 5. 复验证据（模拟器 API 34，`space.alliswell.inbox`）

统一场景：**应用退到桌面（后台）** 后 10 秒闹钟到点 —— 只有后台状态才会触发 BAL 判定。
截图存于 `docs/reviews/evidence-2026-09-17/`。

### 5.1 收回悬浮窗 → 精确复现用户截图

```
diagnose:          canDrawOverlays=false, canUseFullScreenIntent=true, sdkInt=34
台账:              attempted=true, shownAt=0, screenOn=true, locked=false, overlay=false
logcat:            Background activity launch blocked [... callingUidProcState: RECEIVER ...]
                   START ... .AlarmActivity ... (BAL_BLOCK) result code=102
屏幕:              桌面 + 顶部横幅通知（与用户截图一致）
```

> `evidence-2026-09-17/unlocked-no-overlay-banner-only.png`

### 5.2 授予悬浮窗 → 解锁亮屏也弹全屏

```
台账:              attempted=true, shownAt=1789625632524（deliveryAt 之后 95ms）
屏幕:              AlarmActivity 全屏（关键档 / 我知道了 / 稍后 2 小时 / 完成 / 关闭）
自检面板:          「全屏闹钟已弹出 · 今天 14:15」 pill=已全屏
```

> `evidence-2026-09-17/unlocked-with-overlay-fullscreen.png`

### 5.3 锁屏/息屏 → 不依赖悬浮窗也能全屏（用户核心诉求）

```
操作:  排 12 秒闹钟 → KEYCODE_SLEEP 熄屏 → 到点
台账:  screenOn=false, overlay=false, attempted=true, shownAt=1789625842113
屏幕:  屏幕被点亮并弹出全屏闹钟
```

即：**锁屏路径由系统 FSI 负责**（`AlarmActivity` 已声明 `showWhenLocked` / `turnScreenOn`），
不需要用户授予悬浮窗。

> `evidence-2026-09-17/screen-off-to-fullscreen.png`

### 5.4 解锁 + 正在通话 → 不抢屏（Q5）

```
操作:  adb emu gsm call 10086 接通 → 排 10 秒闹钟 → 退到桌面
台账:  inCall=true, overlay=true（**已授予悬浮窗**）, attempted=true, shownAt=0
屏幕:  顶部横幅通知，全屏未起来
```

注意 overlay=true 仍被拦 ⇒ 不是权限问题，而是**通话闸门主动让路**。

> `evidence-2026-09-17/in-call-no-takeover.png`

---

## 6. 行为裁决（Q5）：什么时候允许抢屏

用户原话：「锁屏状态下闹钟也可以全屏提醒；解锁状态下当然不能打断通话语音电话。」

| 场景 | 允许全屏 | 依据 |
|---|---|---|
| 锁屏 / 息屏 | 是 | 用户要求；由系统 FSI 拉起，不依赖悬浮窗 |
| 解锁 + 无通话 | 是 | 用户期望「唤醒」体验；靠直起（需悬浮窗） |
| 解锁 + 响铃/通话中 | **否**，只响铃 + 横幅 | 用户要求不得打断通话 |

实现：`boolean directAllowed = fullScreen && (!inCall || locked);`

通话判定用 `AudioManager.getMode()`（`MODE_RINGTONE` / `MODE_IN_CALL` / `MODE_IN_COMMUNICATION`）——
**不需要 `READ_PHONE_STATE` 权限**，且同时覆盖蜂窝通话与微信/WhatsApp 这类 VoIP。

`alarms` 仍照常响：闹钟渠道 `attention-alarm-v3` 带 `USAGE_ALARM` 音效，
通话中依然出声，只是不抢屏。

> 待用户确认的一点：**锁屏 + 通话中**当前按上表放行（锁屏优先，闹钟会盖住通话界面）。
> 若认为「任何状态下都不该盖住通话」，把闸门改成 `!inCall` 即可（一行）。

---

## 7. 测试

- `test-native-reminders.js` 新增 `Q3 全屏权限与投递台账契约`（17 项，**源码级契约检查**：
  读文件断言权限声明、台账键名三方一致、`recordAttempt` 先于 `startActivity`、
  前端按钮 id 在 HTML 与 app-core 两侧都接线、通话闸门正则等）。
  加这一节的理由：Q3 这类缺陷的形态是「多个文件必须对同一件事达成一致」，
  不一致不会有任何运行时异常，只会静默退化成「只弹通知」。
- 全量：unit **29** / native **134** / smoke **162** / regressions **567** = **892** 全绿（Q3 前 875）。

---

## 8. 未验证（NOT_PERFORMED）

- 真机（本轮全部在 API 34 模拟器上；用户机型为国产 ROM，另有「后台弹出界面」开关，需实机确认）。
- Android 15 / 16 上 BAL 对 `SYSTEM_ALERT_WINDOW` 的判定（有资料称 15 起 FGS 豁免额外要求
  「当前存在可见的悬浮窗」，BAL 本身是否同步收紧未实测）。
- AOD（息屏显示）状态下的 FSI 表现。
- 真 VoIP（微信/WhatsApp 通话）下的 `AudioManager.getMode()` 取值。
- 覆盖升级后渠道与权限状态是否保持。

---

## 9. 复现命令

```bash
ADB=~/Library/Android/sdk/platform-tools/adb
PKG=space.alliswell.inbox

# 安装 + 授权
$ADB install -r -d releases/安心收件箱-debug.apk
$ADB shell pm grant $PKG android.permission.POST_NOTIFICATIONS
$ADB shell appops set $PKG SYSTEM_ALERT_WINDOW allow    # 或 ignore 复现"只剩横幅"

# 打开 WebView 调试通道（清掉 *_PROXY，否则 127.0.0.1 会被代理走）
PID=$($ADB shell pidof $PKG | tr -d '\r' | awk '{print $1}')
$ADB forward tcp:9222 localabstract:webview_devtools_remote_$PID
/usr/bin/python3 scripts/android-cdp-eval.py \
  "(async function(){var b=window.Capacitor.Plugins.SystemBridge;\
   var d=await b.diagnose(); var l=await b.lastAlarmDelivery();\
   return JSON.stringify({d:d,l:l});})()"

# 排一个 10 秒全屏闹钟，然后退到桌面（后台才会触发 BAL 判定）
/usr/bin/python3 scripts/android-cdp-eval.py \
  "(async function(){return JSON.stringify(await window.Capacitor.Plugins.SystemBridge.scheduleAlarm({delayMs:10000,id:780011,title:'验证',body:'测试'}));})()"
$ADB shell input keyevent KEYCODE_HOME

# 到点后读台账（attempted=true 而 shownAt=0 ⇒ 全屏被拦）
$ADB shell run-as $PKG cat /data/data/$PKG/shared_prefs/attention_alarm.xml | grep delivery

# 锁屏场景：排钟后 KEYCODE_SLEEP，到点应亮屏弹全屏
$ADB shell input keyevent KEYCODE_SLEEP

# 通话场景：模拟来电并接听，再排钟 → 应只出横幅
$ADB emu gsm call 10086 && $ADB shell input keyevent KEYCODE_CALL
```

`scripts/android-cdp-eval.py` 需要 `websocket-client`：**用 `/usr/bin/python3`**（本机已验证该解释器带此模块，
managed python 3.13 没装）。
