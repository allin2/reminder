# 后台唤醒闹钟验收（Q2）— 2026-09-17

> 用户现象：「现在闹钟只有打开 app 才可以」。
> 结论：**两个独立原因叠加**，其中 Q2 是缺陷（已修复并复验），另一个是产品默认值（需用户裁决）。

---

## 1. 现象与两条根因

| # | 位置 | 性质 | 状态 |
|---|---|---|---|
| Q2 | `SystemBridgePlugin.scheduleAlarm` 静默丢弃 `delayMs`，全屏闹钟永远排在**对账后 10 秒** | 实现缺陷（平台契约） | **已修复并复验通过** |
| — | `settings.notify` 默认 `false`（`app-core.js:464`） | 产品默认值（D18 / R1：只有用户能打开） | 未改动，待裁决 |

两条都会表现为「只有打开 app 才响」：

- 默认开关关着 → `reconcile()` 里 `enabled === false` → `buildDesired` 返回空 → **原生一条排程都不落**，
  到点只能靠前台的 `tick()` 弹应用内提醒。
- 开关打开后 → 普通通知（LocalNotifications 通道）本来就能在后台响，
  但**全屏闹钟通道**因为 Q2 排在 10 秒后，等于「打开应用 10 秒后响一次」，关掉应用就再也等不到。

---

## 2. Q2 根因（源码级）

`SystemBridgePlugin.scheduleAlarm` 原来这样取参数：

```java
Number delayMsNum = call.getLong("delayMs", 10000L);   // ← 永远拿到 10000
```

而 Capacitor 的取值器做**装箱类型精确匹配**（`@capacitor/android` 6.x，`PluginCall.java:224-252`）：

```java
public Long getLong(String name, Long defaultValue) {
    Object value = this.data.opt(name);
    if (value == null) return defaultValue;
    if (value instanceof Long) return (Long) value;
    return defaultValue;              // ← 其余一律静默回退，不报错
}
```

JS→Java 的 JSON 整数按**取值范围**装箱：`delayMs = 300000` 落到 `Integer`，
`getLong` 只认 `Long` → 命中最后一行 → **参数被丢掉**。
（更远的时刻 `delayMs > 2^31-1`，约 24.8 天，反而成为 `Long` 而「恰好正确」——
这正是它藏得深的原因：短时提醒全错，远期提醒偶对。）

**现场证据（修复前，模拟器 API 34）**：

```
请求 delayMs = 300000
回读 {"ok":true,"id":770002,"exact":true,"alarmClock":true,
      "mode":"alarmClock","triggerAt":1789623349808,"delayMs":10000}
                                                  ^^^^^^^^^^^^^^ 请求 300000
```

`dumpsys alarm` 中三种闹钟全落在 `now + 1s ~ now + 10s`，而不是各自的 9/18、9/19：

```
RTC_WAKEUP #4: origWhen 2026-09-17 13:35:28.519   ← 本应 13:40:17
RTC_WAKEUP #5: origWhen 2026-09-17 13:35:28.523   ← 本应 2026-09-18 12:38
RTC_WAKEUP #6: origWhen 2026-09-17 13:35:28.529   ← 本应 2026-09-19 10:00
```

---

## 3. 修复

### 3.1 原生侧：按 `Number` 取数值（`android/.../SystemBridgePlugin.java`）

新增 `rawArg` / `longArg` / `intArg`，与装箱类型解耦（并容忍字符串形态），
`delayMs` / `at` / `id` / `itemRev` 全部改走它：

```java
private static long longArg(PluginCall call, String key, long fallback) {
  Object value = rawArg(call, key);              // call.getData().opt(key)
  if (value instanceof Number) return ((Number) value).longValue();
  if (value instanceof String) { try { return Long.parseLong(((String) value).trim()); } catch (Exception ignored) {} }
  return fallback;
}
```

`getLong` / `getInt` 在本文件已归零。

### 3.2 前端侧：排钟之后回读原生落的时刻（`lib/native-reminders.js`）

只断言「调用成功」抓不到这类缺陷 —— `scheduleAlarm` 一路 `resolve {ok:true}`。
`reconcileAlarms` 现在比对原生回传的 `triggerAt` 与**本次请求声明的时刻**
（`scheduleAlarm` 用 `发送时刻 + delayMs`，`scheduleAt` 用绝对时刻），
偏差 > `ALARM_TIME_TOLERANCE_MS`（3 秒）即记入 `errors`，`reliability` 变 `error`（用户可见）。

- 只在请求的是**未来时刻**时校验：过去时刻原生会夹到最小延迟，偏差属正常。
- 返回值缺 `triggerAt` 时不判断，兼容旧实现与测试替身。

---

## 4. 复验证据（修复后，模拟器 API 34）

### 4.1 桥契约

```
请求 delayMs = 300000
回读 {"ok":true,"id":771001,"exact":true,"alarmClock":true,
      "mode":"alarmClock","triggerAt":1789624152482,"delayMs":300000}
本地钟差 2ms
```

### 4.2 落点

```
目标时刻  2026/9/17 13:46:19
AlarmManager origWhen=2026-09-17 13:46:19.001   ← 毫秒级吻合
其余闹钟回到各自正确时刻：2026-09-18 12:38:00 / 2026-09-19 10:00:00
```

### 4.3 应用被杀掉后到点投递（关键一条）

```
13:44:29  adb shell input keyevent KEYCODE_HOME
13:44:32  adb shell am kill space.alliswell.inbox      ← 进程消失，模拟从最近任务划掉
13:46:19.040  ActivityManager: Start proc 7000:space.alliswell.inbox
              for broadcast {space.alliswell.inbox/…AlarmTestReceiver}
通知栏出现 id=754195851，标题「🚨 关键事项」
```

即：**应用进程已被杀死，闹钟仍在目标时刻准点唤醒系统并投递**。

---

## 5. 已知限制（非缺陷，平台行为）

- 全屏 `AlarmActivity` 的**直接** `startActivity` 在无可见窗口时会被系统拦：
  `Background activity launch blocked … BAL_BLOCK`。
  这是 Android 10+ 的正常约束。兜底路径是通知的 `fullScreenIntent`
  （由 SystemUI 发起，`BAL_ALLOW_PENDING_INTENT` 放行），
  在**锁屏/息屏**场景接管全屏；屏幕亮着时就表现为高优先级横幅通知。
- 模拟器上验证时 `POST_NOTIFICATIONS` 初始未授权，`appops POST_NOTIFICATION=ignore`
  → `reconcile` 的 `enabled` 恒为 false，必须先授权并打开应用内开关。

---

## 6. 测试

- 新增 7 项（`test-native-reminders.js` → 「Q2 排程时刻回读校验」）：
  契约替身改为**回传 `triggerAt`**（与真机一致），并支持 `honorsDelayMs:false`
  复刻「delayMs 被丢弃」的真机行为，断言偏差被发现、`reliability=error`、
  且漂移的闹钟仍要入账（否则事后撤不掉）。
- 全量：unit **29** / native **117** / smoke **162** / regressions **567** = **875** 全绿。

---

## 7. 未验证（NOT_PERFORMED）

- 真机（仅 API 34 模拟器）。
- 锁屏 / 息屏下的全屏接管是否如期弹出（模拟器未构造息屏场景）。
- 重启后 `BootRestoreReceiver` 的重排链路。
- 15 秒心跳 `tick()` 的端到端推进效果（沿用 V1 遗留）。
- 覆盖升级路径。

---

## 8. 复现命令

```bash
# 桥契约（最快的判据）
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell ps -A | grep alliswell | awk '{print $2}')
python3 scripts/android-cdp-eval.py "(async function(){
  var r = await window.Capacitor.Plugins.SystemBridge.scheduleAlarm({delayMs:300000,id:771001,title:'t',body:'b'});
  return JSON.stringify(r);
})()"
# 期望 delayMs=300000 且 triggerAt ≈ now+300000；缺陷态会是 delayMs=10000、now+10s

# 落点
adb shell dumpsys alarm | grep -A4 ACTION_TEST_ALARM | grep origWhen
```
