# 「关掉 App 就不响」根因定位（Q6）— 2026-09-17

> 用户第三次报同一现象：**「现在还是无法在 app 未打开时闹钟响应」**。
> 前两轮（Q2 参数被静默丢弃、Q3/Q5 全屏投递）都不是这一条 —— 那些是「响得不正确」，
> 而这一条是**一条排程都没落**。本文是根治记录。

## 1. 现象的三段拆分

用户最初的描述「闹钟只有打开 app 才可以」其实包含了三段互不相同的链路，此前几轮
只修了其中两段：

| 段 | 机制 | 打开 App | 关掉 App |
|---|---|---|---|
| 应用内提醒 | `tick()` 每 15 秒扫 `status==='due'` 弹 `showAlert` | 有 | **无**（进程没了） |
| 原生排程 | `reconcile()` 投影到 `LocalNotifications` / `SystemBridge` | 有 | **应有** —— 但实际为 0 |
| 全屏闹钟 | 关键/重要档首次 → `AlarmManager.setAlarmClock` | 有 | **应有** —— 但实际为 0 |

后两段的「应有」全部落空。用户能看到的是：**打开 App 有提醒，关掉 App 什么都不响。**

## 2. 根因（源码级）

### 2.1 链条

```
index.html 不加载 capacitor.js
        ↓  window.Capacitor 完全依赖原生 WebView 注入
init() 在 DOMContentLoaded 就跑
        ↓  实测：此刻 window.Capacitor 还是 undefined，6 秒后 7 个插件才齐全
isNativeAndroid() === false
        ↓
initializeNativeReminders() 第一行 `if (!isNativeAndroid()) return`   ← 静默返回
        ↓
nativeReady 永远是 false
        ↓
queueNativeReminderSync() 首行守卫 `if (!nativeReady) return`         ← 丢弃每一次对账
        ↓
reconcile() 从未执行 → 原生 0 条排程
```

**关键点**：这两个 `return` 都是**静默**的。不抛错、不崩溃、界面照常可点、
应用内提醒照常弹（它不依赖原生）—— 所以现象只能被描述成「关掉 App 就不响」，
而这个描述里不含任何能指向代码的线索。

### 2.2 实测证据（模拟器 API 34）

同一块自检面板里同时出现这两行，就是时序铁证：

```
桥        : 平台 android · LocalNotifications 有 · SystemBridge 有   ← 查询时（t≈6s）已就绪
后台提醒  : 原生对账从未执行（启动时原生桥尚未就绪）                  ← init 时（t≈0s）尚未就绪
```

CDP 直读：`window.Capacitor` 存在、`getPlatform()` 返回 `android`、
插件为 `[App, AppSettings, LocalNotifications, CapacitorCookies, WebView, CapacitorHttp, SystemBridge]`。
即：**桥不是不在，是晚到**。而旧实现在这个时间差上永久放弃。

### 2.3 为什么此前几轮没发现

- 前几轮验证的是**自检面板的手动测试按钮**（直接调 `scheduleAlarm`，绕过 `reconcile`）
  和**已排好的排程是否投递** —— 两条都绕开了 `nativeReady` 守卫。
- 844 / 875 / 892 项测试都在 Node 里跑，`isNativeAndroid()` 由 mock 提供，
  不存在「注入时间差」这个真实变量。
- 界面此前**不显示任何排程数**，所以「0 条」这个事实不可见。

## 3. 修复

### 3.1 根治：初始化改为幂等、可重试、不阻塞（`app-core.js`）

```js
function ensureNativeReminders() {          // 新增
  if (nativeReady) return Promise.resolve(true);
  if (nativeInitPromise) return nativeInitPromise;   // 同一时刻只跑一次
  nativeInitPromise = initializeNativeReminders()
    .then(() => !!nativeReady)
    .catch(...)
    .then(ok => { nativeInitPromise = null; return ok; });  // 跑完置回 null → 允许重试
  return nativeInitPromise;
}

function queueNativeReminderSync() {
  if (!NativeReminders.reconcile) return;
  if (!nativeReady) {
    // 桥可能只是晚到 —— 补做初始化，成功后自己会再同步一次
    ensureNativeReminders().then(ok => { if (ok) queueNativeReminderSync(); });
    return;
  }
  ...
}
```

三处触发点：
1. `init()` 调 `ensureNativeReminders()`（**不 await**，不挡 seed / render / 15 秒心跳）；
2. `queueNativeReminderSync()` 在未就绪时补做，而不是丢弃请求；
3. `visibilitychange → visible` 时若仍未就绪，再试一遍（切回前台是天然的重试时机）。

`initializeNativeReminders()` 内部：等待从 3 秒放宽到 10 秒；仍失败则写入
`bridgeNotReady: true`（**可见**），而不是静默返回。

### 3.2 保护 Web 版：非安卓容器直接返回

```js
if (!isNativeAndroidRuntime()) return;   // 浏览器 / PWA：原生能力不适用
```

否则 Web 版会看到一句「桥未就绪」的误报。

### 3.3 顺带修掉的三个既有缺陷

| # | 缺陷 | 后果 |
|---|---|---|
| 1 | `isNativeAndroidRuntime()` 被 3 处调用、**全项目从未定义** | 点「精确闹钟 / 通知设置 / 电池优化」直接 `ReferenceError`，现场只表现为「点了没反应」 |
| 2 | `#swNotify` 在安卓上可落到 Web 通知分支 | WebView 的 `Notification.requestPermission()` 返回 `granted` → 开关显示「已开启」但系统权限没授予 → `enabled` 仍为 false → **零排程**，且界面完全看不出来。现在安卓上一律不走该分支，桥没就绪就明确拒绝 |
| 3 | 设置页把「你自己关了总开关」说成「通知未授权」 | 把用户往授权那条路上引，而他真正该做的是打开自己的开关 —— 于是反复授权、始终不响 |

### 3.4 可观测性：让「排了几条」变成界面上的一句话

自检面板新增：

- **结论条**（`#labVerdict`）—— 直接回答「关掉 App 后会不会响」，并指出**第一个断掉的环节**：
  原生对账从未执行 / 总开关未开 / 系统权限未授予 / 对账失败 / 零排程 / 已就绪；
- **后台提醒**（`#labBackground`）+ **已排提醒**（`#labScheduled`）—— 后者用
  `LocalNotifications.getPending()` 的**实数**，而不是「打算排几条」；
- **「立即重排后台提醒」**（`#labResync`）—— 强制对账一次并把结果写进日志。

## 4. 复验（模拟器 API 34，debug）

### 4.1 全新安装（等效用户装新包，开关默认关）

```
结论: ⚠️ 总开关未开 · 关掉 App 后不会有任何提醒。请打开「设置 → 本地通知」。
已排: 0 条待发
桥  : 平台 android · LocalNotifications 有 · SystemBridge 有
```

**与修复前对比**：同一场景此前显示「原生对账从未执行」——**现在这句话消失，
说明 `nativeReady` 成功置位、`reconcile` 真的跑过了**。这是修复生效的关键判据。

### 4.2 打开开关后，排程真的落进系统

```
getPending()      : 13 条
dumpsys alarm     : tag=*walarm*:space.alliswell.inbox.ACTION_TEST_ALARM
                    origWhen=2026-09-17 15:11:57.641
请求时刻          : 15:11:57.637        → 偏差 4ms
```

### 4.3 进程被杀后仍按点投递（用户核心诉求）

```
排钟 : 15:13:39
操作 : KEYCODE_HOME 退桌面 → am kill（杀后进程：[]）

15:13:39.163  Start proc 14033:space.alliswell.inbox/u0a200
              for broadcast {space.alliswell.inbox/.AlarmTestReceiver}
15:13:39.754  AttentionAlarm: deliver fullScreen=true screenOn=true locked=false
              inCall=false canDrawOverlays=false
通知栏         pkg=space.alliswell.inbox id=60485207
```

进程已被杀死，系统为广播**重新拉起进程**并完成投递。

## 5. 测试

新增 14 项源码级契约断言（`test-native-reminders.js` 的「Q6 原生链路静默失败与可观测性」），
其中一项是**通用扫描**：`app-core.js` 里所有「当守卫调用」的标识符必须真的有定义 ——
本次真凶 `isNativeAndroidRuntime` 正是这一类，手工断言只能抓已发现的那一个，
这个扫描抓的是同一类里的下一个。扫描前必须先剥注释，否则注释里举的例子会被当成真调用。

| 套件 | 数量 |
|---|---|
| test-unit.js | 29 |
| test-native-reminders.js | 153 |
| test-smoke.js | 162 |
| test-regressions.js | 567 |
| **合计** | **911**（修复前 892） |

## 6. 未验证（NOT_PERFORMED）

- **真机**：用户机型为国产 ROM，另有「自启动 / 后台弹出界面」专有开关，需实机确认。
  时序问题的严重程度与设备性能相关（注入越慢，时间差越大），但本修复不依赖具体时长。
- 冷启动极慢（>10 秒桥才就绪）的设备 —— 会落到 `bridgeNotReady`，需用户切回前台触发重试。
- 覆盖升级路径；重启后 `BootRestoreReceiver` 重排；AOD 下的 FSI。

## 7. 复现命令

```bash
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
PKG=space.alliswell.inbox
ADB=$HOME/Library/Android/sdk/platform-tools/adb

# 判据一：面板结论是「总开关未开」而不是「原生对账从未执行」
$ADB shell am start -n $PKG/.MainActivity && sleep 14
PID=$($ADB shell pidof $PKG | tr -d '\r' | awk '{print $1}')
$ADB forward tcp:9222 localabstract:webview_devtools_remote_$PID
/usr/bin/python3 scripts/android-cdp-eval.py \
  "(async function(){ document.querySelector('#btnNotifyLab').click(); await new Promise(r=>setTimeout(r,2000)); return ['.labVerdict','#labVerdict','#labScheduled'].map(function(s){return s+'='+(document.querySelector(s)||{}).textContent;}).join(' | '); })()"

# 判据二：排程真的落进系统
$ADB shell dumpsys alarm | grep -A3 alliswell
/usr/bin/python3 scripts/android-cdp-eval.py \
  "(async function(){ var p=await window.Capacitor.Plugins.LocalNotifications.getPending(); return p.notifications.length; })()"

# 判据三：杀掉进程后仍按点投递（必须先退桌面，否则 am kill 不杀前台进程）
$ADB shell input keyevent KEYCODE_HOME && sleep 3 && $ADB shell am kill $PKG
$ADB shell pidof $PKG                     # 应为空
# 等到点后：
$ADB logcat -d | grep -E "Start proc.*alliswell|AttentionAlarm"
$ADB shell dumpsys notification --noredact | grep "pkg=space.alliswell.inbox"
```

> 注意：`am force-stop` 会取消该应用的 AlarmManager 排程，**不能**用它模拟「关掉 App」。
> 用户从最近任务划掉等价于 `am kill`（进程没了，排程保留）。

## 8. 产物

| 文件 | SHA-256 |
|---|---|
| `releases/安心收件箱-release.apk` | `389eb1ce2690dab5314e0827b59f68336e933166847292a888bbac27920e8b83` |
| `releases/安心收件箱-debug.apk` | `e06604fe31cecd3953c233be48852ebc5a972dd239abfc4da3b64e2474fa271c` |

同签名覆盖安装即可，**不必卸载**（卸载会清空 IndexedDB）。
