# vivo 真机全面测试报告

- **测试时间**：2026-09-17 20:50 – 21:20
- **被测设备**：vivo V2238A（PD2238）· Android 16 / API 36 · OriginOS 16.0 · `PD2238_A_16.3.15.0.W10`
- **被测产物**：`releases/安心收件箱-window-fix-20260917-debug.apk`
  （SHA-256 `7fde31fa3903699a1179f529f58170be20af571a8bd90f8bea0c8e3a36c0ef87`，与 OPPO 交接文档记录一致）
- **设备侧 APK 校验**：`/data/app/~~T7RngKOLzLZKZ-Fx8PbxIQ==/space.alliswell.inbox-…/base.apk`
  SHA-256 与源产物**逐字一致** → 安装可信
- **取证手段**：run-as 读私有台账（debug 包可用）· WebView CDP 直读内部状态 · `dumpsys alarm / notification / package / power` · logcat
- **纪律**：全程只读为主；未卸载、未清用户数据；模拟器结论一概不当作真机结论

> ⚠️ 本报告中的真机结论**独立于**此前所有模拟器（API 34）结论。两处结论不一致时，以本报告为准。

---

## 1. 设备连接状态

| 项 | 值 |
|---|---|
| 序列号 | `10ACBF2D3D000RS`（USB，已授权） |
| 型号 | vivo V2238A |
| 系统 | Android 16 / API 36 · OriginOS 16.0 |
| 屏幕 | 1080×2400 @ 480dpi |
| CPU / 内存 | 8 核 / MemTotal 7,597,768 kB（≈7.6 GB） |
| 电量 | 77% → 94%（充电中） |
| 温度 | 电池 30.6 °C · **机身 44.6 °C（热状态 LIGHT 限流）** |
| 用户空间 | 机主（0）+ **XSpace（666）** ← 有分身空间，命令需注意 `--user` |
| 应用 | 测试前**未安装**（两个用户空间均无） |

**首轮安装被系统拒绝**：`INSTALL_FAILED_ABORTED: User rejected permissions`。经排查：

1. 首次失败时设备处于**锁屏态**（`isKeyguardShowing=true`、`deviceLocked=1`）→ 安装确认弹窗无法显示 → 直接判为拒绝
2. 解锁后仍被拒一次，随后弹出 `com.android.packageinstaller/PackageInterceptActivity` 并成功 —— 即 **vivo 的安装确认需要用户在设备上点一次**

> 顺带更正一个中间误判：本次一度把失败归因为「vivo 的『USB 调试(安全设置)』没开导致 `input` 被封锁」。
> **实测证明该判断错误** —— `input keyevent 26`（电源键）完整生效（Asleep → Awake → Asleep），`input` 通畅。

---

## 2. 应用可用性

| 项 | 结果 |
|---|---|
| 安装 | ✅ 成功（设备侧哈希与源产物一致） |
| 版本 | `versionName=1.0` / `versionCode=1` / minSdk 22 / **targetSdk 34** |
| **targetSdk 34 vs 系统 API 36** | 差两个大版本 —— 后台限制、精确闹钟、全屏通知策略均以 36 为准 |
| 冷启动 | ✅ 无崩溃、无 ANR；`Displayed +1932ms` |
| 首次渲染 | ✅ 首页正常（标题「安心收件箱」、现有 1 件需注意、卡片、四出口按钮、底部四页签、FAB） |
| 原生桥 | ✅ 7 个插件全部注册：`App / AppSettings / LocalNotifications / CapacitorCookies / WebView / CapacitorHttp / SystemBridge` |
| 数据落库 | ✅ 7 条种子事项正常读出 |

**启动期发现两条异常（见 §7 V6 / V7）**：偶发 `Uncaught TypeError`，以及每次启动 4 条 `console` 噪音。

---

## 3. 基本功能

| 功能 | 结果 | 说明 |
|---|---|---|
| 首页列表渲染 | ✅ | 7 条事项、标签、时间词、操作按钮齐全 |
| 底部页签切换 | ✅ | 首页 / 未来 / 笔记 / 我的 四个页签均可切换 |
| 操作出口 | ✅ | 「稍后 / 我知道了 / 完成」三出口在卡片上正常呈现 |
| 已看到未完成分组 | ✅ | 「已看到未完成 · 1」可展开 |
| 搜索 | ✅ | 存在 `#btnSearch` 入口 |
| 新建（FAB） | ⚠️ **NOT_PERFORMED** | 需要长表单交互，未在受控条件下完成（见 §8） |
| 完成 / 归档 / 恢复 / 删除 | ⚠️ **NOT_PERFORMED** | 会改动数据；在未确认前不主动触发 |
| 截止保护 | ⚠️ **NOT_PERFORMED** | 需构造截止窗口 |
| 内部状态可读性 | ✅ | CDP 可完整读出 `state.settings` / `state.items`，字段与模型一致 |
| 数据落库与回读 | ✅ | `saveAsync()` 后重启可读出（见 §5 各轮试验的台账持续性） |

---

## 4. 界面交互

| 项 | 结果 |
|---|---|
| DOM 可交互元素 | ✅ **90 个可见按钮**（`button` / `[role=button]` / 页签 / FAB） |
| 页签命中 | ✅ `.nav-item` 可按文本定位并点击生效 |
| WebView 视口 | 360×742（dp）· dpr 3 —— 相对 1080×2400 的 800dp 少了 58dp，为状态栏+导航栏占位，**非边到边布局**，属正常 |
| CDP 驱动能力 | ✅ 可直读 DOM/内部状态、直接派发点击（**不依赖 `input` 权限**，不受息屏速度影响） |
| 自检面板 | ✅ 可打开，结论条与各行状态位均正常渲染 |
| **自检面板结论正确性** | ❌ **误诊**（详见 §7 V2） |

**设备侧交互受限（非应用缺陷，但严重妨碍测试）**：即便已设 `stay_on_while_plugged_in=15` 且
`screen_off_timeout=600000`，屏幕仍频繁回到锁屏 —— 该 ROM 会覆盖 AOSP 的常亮设置。
这对自动化 UI 测试是硬障碍，**不是应用问题**。

---

## 5. 异常场景（本轮重点）

### 5.1 方法学警告（必须先读）

前几轮出现「到点没响」的结果，**其中一部分可能是我的注入方式造成的假象**：

- 我通过 CDP 直接改写 `item.triggerAt` 再 `saveAsync()`，**绕过了应用的表单路径**。
  应用自身的后台逻辑（`tick()` / 重算日程）可能把时间改回原定日程并撤销该闹钟。
- 因此「某轮没响」**不足以单独证明产品缺陷**。下文把每轮结论的可靠度标出来。

### 5.2 四轮受控试验

统一前置：应用已启动（清 stopped 态）、`notify=true`、通知权限已授予、
排程后回读 `dumpsys alarm` 确认系统侧 `origWhen` 与请求时刻一致。

| 轮次 | 场景 | 系统侧登记 | 是否投递 | 全屏可见 | 可靠度 |
|---|---|---|---|---|---|
| A | 后台 + 亮屏**锁屏** | ✅ 21:06:04.559 | ✅ 21:06:04.644 | ❌ **不可见** | 高 |
| B | 后台 + 亮屏**解锁** | ✅ 21:10:16.213 | ❌ 台账零记录 | — | 中（可能为注入假象） |
| C | 后台 + **关屏** | ✅ 21:13:24.045 | ✅ 21:13:24.096 | ❌ **不可见** | 高 |
| D | 后台 + 关屏 + 已授悬浮窗 | ✅ 21:16:09 | ❌ 台账零记录 | — | 中（同 B 的保留） |

### 5.3 `am force-stop` 不等价于「关掉应用」—— 一次方法学纠错

首次尝试用 `am force-stop` 模拟「关掉 App」，到点**完全无投递**。但这是**我的模拟方式错误**：

```
stopped=true          ← force-stop 把应用打进 Android 的「已停止」状态
AlarmManager 条目 42 → 10   ← 大部分闹钟被清掉
logcat 无任何广播记录
```

force-stop 后系统**有意**不投递广播，直到用户手动再次启动应用。**这是系统标准行为，不是应用缺陷。**
正确等价物是「从最近任务划掉」（进程被杀但应用不进入 stopped 态）；改用 `am kill` 后
在本机**无法生效**（见 §8）。

### 5.4 核心结论：**投递发生了，但界面从未可见**

这是本轮最重要的发现。同一应用、同一代码，唯一差别是**应用是否在前台**：

| 场景 | 台账 `windowSample`（`AlarmActivity.onResume` 后 1.2 秒采样） |
|---|---|
| 应用在**前台**（21:12:05） | `focus=true; shown=true; visibility=0; playing=true` → ✅ **可见** |
| 应用在**后台**（21:13:25） | `focus=false; shown=false; visibility=4; playing=true` → ❌ **不可见** |

`visibility=4` 表示窗口自始至终未可见；`shown=false` 表示视图未显示；`focus=false` 表示从未获得窗口焦点。

旁证链（轮次 C）：

```
21:13:24.064  received
21:13:24.087  environment      screenOn=false;locked=true;inCall=false
21:13:24.132  launchRequested
21:13:24.168  notifyReturned
21:13:24.553  replaced         different delivery     ← 第二次启动（FSI）带不同 token
21:13:24.561  effectsStopped                          ← 声音被停
21:13:24.696  audioStarted
21:13:24.704  duplicateIntent  same delivery
21:13:24.709  resumed
21:13:24.725  paused           finishing=false
21:13:24.889  stopped          finishing=false
21:13:25.914  windowSample     focus=false;shown=false;visibility=4;playing=true
```

同时：

- `dumpsys activity` 报 `ResumedActivity = space.alliswell.inbox/.AlarmActivity`
- 但 `dumpsys power` 报屏幕已 `Awake`，截图拍到的是**锁屏**（`docs/reviews/evidence-vivo-2026-09-17/03-*.png`）
- 投递台账 `deliveryShownAt = 0` —— **系统日志说 `Displayed .AlarmActivity +531ms`，而 Activity 自己从未记下「已显示」**

**用户感知 = 声音在响、屏幕亮了，但什么都没弹出来 → 「闹钟没响」。**

轮次 A（亮屏锁屏）是同一问题的另一种形态：`Displayed .AlarmActivity +531ms` 之后
**仅 188ms** 就被 `VRI[AlarmActivity] destructor()` 销毁（`paused(finishing=true)`），
声音在 `.639` 被停 —— 一闪而过。

---

## 6. 性能

| 指标 | 实测 | 判定 |
|---|---|---|
| 冷启动 ×3 | **1997 / 1812 / 1916 ms**（均值 ≈1908ms） | ✅ 优于 3 秒目标 |
| TOTAL PSS | **135,439 KB ≈ 132 MB** | ⚠️ 高于 100MB 参考线（WebView 应用属合理区间） |
| TOTAL RSS | 328,576 KB ≈ 321 MB | — |
| Java Heap | 24.3 MB 已用 / 39.6 MB | — |
| Native Heap | 28.6 MB / 30.5 MB | — |
| Graphics | 7.8 MB | — |
| CPU | 5.2% user + 0.8% kernel | ✅ 空闲态正常 |
| 渲染 jank | **样本不足（3 帧）** | ❌ **NOT_PERFORMED** |
| 机身温度 | SKIN **44.6 °C（LIGHT 限流）** | ⚠️ 数据受充电+高温污染 |

**说明**：设备当时正在充电且机身 44.6 °C、系统 Load 高达 18.47，所有性能数值都受此环境影响；
渲染 jank 需要在真实交互（滚动/切换）过程中采样才有效，本轮样本量不足。

---

## 7. 发现的问题

### V1 · P0 · 后台状态下全屏闹钟不可见（本轮核心缺陷）

- **现象**：应用不在前台时，到点后闹钟**确实投递、声音确实在响**，但全屏界面**从未可见**。
- **证据**：§5.4 的前台/后台对照 `windowSample`；`deliveryShownAt=0`；轮次 A 的 188ms 销毁。
- **影响**：用户完全无法看到提醒 → 感知为「闹钟没响」，与用户原始报障一致。
- **实测与权限无关**：`USE_FULL_SCREEN_INTENT` **已授予**，`canUseFullScreenIntent()` 为真。
  即便显式授予 `SYSTEM_ALERT_WINDOW`（`appops … allow`）后轮次 D 仍未改善。
- **推断方向（待独立验证，不在此下结论）**：后台启动 Activity 未获得窗口焦点；
  且**直起 Activity 与通知 FSI 双路启动同一 Activity** 相互竞争（见 V3）。

### V2 · P0 · 自检面板误诊，把用户引向错误的排查方向

自检面板实际输出（CDP 直读，21:17）：

```
结论:   ✅ 系统里已挂 10 条提醒（全屏闹钟 2 条）· 关掉 App 后仍会按时响
全屏:   解锁亮屏与锁屏都能弹全屏
投递:   只出了通知横幅 · 今天 21:17 · 锁屏也没弹出 · 缺「全屏通知」权限
日志:   诊断完成 · SDK 36 · 通知 OK · 精确闹钟 OK · 全屏 OK
```

三处问题：

1. **归因错误**：「缺『全屏通知』权限」与事实矛盾 ——
   `dumpsys package` 显示 `USE_FULL_SCREEN_INTENT: granted=true`，同一面板上一行还写着「全屏 OK」。
   代码里（`app-core.js` 的 `describeAlarmDelivery`）是 `if (d.locked) → "缺『全屏通知』权限"`，
   即**仅凭「锁屏且没弹出」就断定是缺权限**，而真实原因是后台启动被拦。
   用户会因此反复去授权一个**已经给了**的权限 —— 这正是「反复报障却总也修不好」的直接来源。
2. **过度承诺**：结论行的 `✅ … 关掉 App 后仍会按时响` 依据只是「系统里挂了 10 条」，
   而**排了 ≠ 会响 ≠ 会可见**。V1 证明这条结论在当前设备上是**错的**。
3. **同一面板结论自相矛盾**：`全屏: 都能弹全屏` 与 `投递: 锁屏也没弹出` 并存。

### V3 · P1 · 直起 Activity 与 FSI 双路启动竞态

`AlarmTestReceiver` 第 105 行直起 `AlarmActivity`，第 149 行又把通知的
`setFullScreenIntent` 指向**同一个** `AlarmActivity`（且意图都带 `NEW_TASK|CLEAR_TOP|SINGLE_TOP`）。
锁屏/息屏时系统会再启动一次，产生：

```
replaced different delivery → effectsStopped → audioStarted → duplicateIntent
```

即响铃被**中断后重起**，窗口可见性同时受损。代码注释（`AlarmTestReceiver.java:158-159`）
已记录对「MainActivity 覆盖 AlarmActivity」的担忧，但同类竞态并未消除。

### V4 · P1 · vivo 对该应用的横幅与锁屏显示被关闭

```
AppSettings: space.alliswell.inbox (10190) importance=DEFAULT userSet=false
             isShowHeadsUp=false  isShowKeyguard=false
```
对照同机 vivo 系统应用：`isShowHeadsUp=true isShowKeyguard=true`。

即：**即使通知成功发出，也不会以横幅出现、也不在锁屏显示**。
这会让 V1 的后果更严重（用户连通知兜底都看不到）。
**待你在系统设置里确认**：设置 → 通知与状态栏 → 安心收件箱 → 是否「横幅通知 / 锁屏显示」为关。

### V5 · P1 · 通知渠道冗余且命名易混（E5 待裁决项的现场证据）

当前渠道共 6 个：

| 渠道 ID | 名称 | importance | 是否被用过 |
|---|---|---|---|
| `attention-critical-v2` | 关键提醒 | 5 | ❌ 从未（`mLastNotificationUpdateTimeMs=0`） |
| `attention-important-v2` | 重要提醒 | 4 | ❌ 从未 |
| `attention-normal-v2` | 普通提醒 | 3 | ❌ 从未 |
| `attention-alarm-v3` | **提醒闹钟** | 4 | ✅ 本次投递（USAGE_ALARM） |
| `attention-bridge-v2` | **提醒测试** | 4 | ❌ 从未 |
| `default` | Default | 3 | — |

问题：**5 个业务渠道里有 3 个从未使用过**；「提醒闹钟」与「提醒测试」语义接近、用户无法分辨；
用户在系统通知设置里会看到一排含义不清的开关。这与既有的 E5 待裁决项（`-v2` 与旧渠道处置）正好对应，
本报告提供现场实测数据。

### V6 · P2 · 启动期偶发未捕获异常（原生→JS 注入竞态）

```
E Capacitor/Console: File: https://localhost/ - Line 1
  Msg: Uncaught TypeError: Cannot read properties of undefined (reading 'triggerEvent')
```

`Bridge.java:868` 执行 `window.Capacitor.triggerEvent(...)`，而 `window.Capacitor` 由
`native-bridge.js:222` 注入。原生在该 JS 就绪前发事件 → 抛错 → **该事件被静默丢弃**。

- **偶发性**：两次启动中复现 1 次（另一轮未复现）→ 确认为竞态，非必现
- **与既有缺陷同族**：与此前修过的「桥注入时间差」属于同一类问题

### V7 · P2 · 每次启动 4 条 console 噪音

```
I Capacitor/Console: File:  - Line 353 - Msg: undefined     ×4
```
每次启动稳定出现，属可清理的调试残留。

### V8 · P2 · 首装即「零排程」（产品取向，需裁决）

首装状态实测：

| 项 | 值 |
|---|---|
| `settings.notify` | `false`（D18/R1：只有用户能开） |
| `POST_NOTIFICATIONS` | 未授予（Android 13+ 运行时权限） |
| AlarmManager 本包条目 | **0 条** |
| 电池优化白名单 | 不在名单 |

即**刚装好的应用完全没有后台能力**，而界面上没有任何强提示。
这与之前几轮的判断一致，此处提供真机确认。**属产品取向，我未擅自改动。**

### V9 · P2 · 一键清理 / 强制停止会彻底阻断投递

`am force-stop` 后：应用进入 `stopped=true`、闹钟被清、到点零投递（§5.3）。
国产 ROM 的「一键加速 / 一键清理」正会执行 force-stop —— 用户清理一次之后闹钟即永久不响，
直到再次手动打开应用。建议在应用内给出明确引导（自启动 / 后台运行白名单）。

---

## 8. 未验证与方法论限制

### 未验证（NOT_PERFORMED）

- **`am kill` 无法在本机奏效**：vivo 保活策略下进程 8384 始终存活，
  无法真实模拟「从最近任务划掉应用」。→ **「进程被杀后能否投递」在本机未取得有效证据。**
- **渲染 jank**：仅采到 3 帧，样本不足。
- **真机重启后 `BootRestoreReceiver` 重排**：未做（需重启设备，会打断会话）。
- **覆盖升级路径**：未做。
- **锁屏亮屏下的全屏接管**：轮次 A 是「亮屏+锁屏」态，被 188ms 销毁；未单独验证。
- **vivo 专有开关**：「自启动」「后台弹出界面」「后台高耗电」均未开启，未测开启后的差异。
- **新建表单全链路 / 完成 / 归档 / 恢复 / 删除 / 撤销**：未做（会改动数据）。
- **电池实际耗电**：仅取瞬时 CPU，未做长时观测。
- **XSpace（用户 666）内的行为**：未测。

### 方法论限制（影响结论强度的因素）

1. **注入式排程**：直接改写 `item.triggerAt` 绕过表单路径，应用自身可能重算并撤销
   → 轮次 B / D 的「没响」**不能单独作为缺陷证据**（已在表中标注可靠度）。
2. **`am force-stop` 不是「关掉应用」**：它触发 Android 的 stopped 态语义（§5.3），已纠正。
3. **环境干扰**：设备充电中、机身 44.6 °C 处 LIGHT 限流、系统 Load 18.47 → 性能数据偏悲观。
4. **ROM 覆盖常亮设置**：`stay_on_while_plugged_in=15` 与 `screen_off_timeout=600000` 均被忽略，
   屏幕频繁回锁 → 大量截图拍到锁屏而非应用界面，UI 证据获取成本高。

### 测试期间对设备/应用做的改动（需知悉）

| 改动 | 说明 |
|---|---|
| 安装 debug 包 | 设备先前未安装 |
| `pm grant POST_NOTIFICATIONS` + `appops set POST_NOTIFICATION allow` | 等效用户点「允许」 |
| `settings.notify = true`（经 CDP） | 等效用户打开总开关 |
| `appops set SYSTEM_ALERT_WINDOW allow` | 仅轮次 D 用；设备上仍「未授权」于系统 UI |
| `svc power stayon true` | 仅充电期生效，**重启即失效**；测试结束建议复位 |
| 改写种子事项 `i_87wsnzxnmu5j3pv5`（报名截止）的触发时间 | 用于测试；该事项仍存在 |

**未做**：卸载、清除应用数据、修改系统设置项、变更用户数据之外的文件。

---

## 9. 复现命令速查

```bash
export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
ADB=$HOME/Library/Android/sdk/platform-tools/adb
S=10ACBF2D3D000RS
PKG=space.alliswell.inbox

# 只读取证装置（显式 -s、拒绝模拟器、未授权拒绝）
SERIAL=$S RUN=/tmp/vivo-test bash scripts/vivo-device-test.sh all
SERIAL=$S bash scripts/vivo-device-test.sh shot home

# CDP 直读内部状态（需 debug 包）
PID=$($ADB -s $S shell pidof $PKG | tr -d '\r' | awk '{print $1}')
$ADB -s $S forward tcp:9222 localabstract:webview_devtools_remote_$PID
/usr/bin/python3 scripts/android-cdp-eval.py "JSON.stringify(window.__ATTENTION_INBOX__.state.settings)"

# 私有台账（debug 包 run-as 可用；release 包必被拒）
$ADB -s $S shell run-as $PKG cat /data/data/$PKG/shared_prefs/alarm_trace.xml
$ADB -s $S shell run-as $PKG cat /data/data/$PKG/shared_prefs/attention_alarm.xml
$ADB -s $S shell run-as $PKG cat /data/data/$PKG/shared_prefs/attention_alarm_schedules.xml

# 系统侧落点与策略延后
$ADB -s $S shell dumpsys alarm | grep -A4 "space.alliswell.inbox"
#   app_standby=-- / device_idle=-- / battery_saver=-- 表示无策略延后
# 通知 AppSettings（横幅 / 锁屏显示）
$ADB -s $S shell dumpsys notification --noredact | grep -A1 "AppSettings: $PKG"

# 受控试验（亮屏/关屏 × 杀/不杀）
SERIAL=$S LABEL=X LEAD=70 SCREEN=off KILL=none bash /tmp/vivo-alarm-trial.sh

# 注意（本机反复踩到的坑）：
#   · am kill 在 vivo 上无效（保活）→ 无法模拟「划掉最近任务」
#   · am force-stop 会让应用进 stopped 态，广播被系统有意屏蔽 —— 不是「关掉应用」
#   · zsh 不做无引号分词：`CDP="python3 x.py"; $CDP "..."` 会失败，必须内联写
```

---

## 10. 结论摘要

| 维度 | 结论 |
|---|---|
| 连接状态 | ✅ 正常（Android 16 / API 36 真机，安装需设备侧确认一次） |
| 应用可用性 | ✅ 无崩溃、无 ANR、启动正常、桥完整 |
| 基本功能 | ✅ 列表/页签/操作出口正常；表单类操作 NOT_PERFORMED |
| 界面交互 | ✅ 90 个可交互元素、页签切换正常、CDP 可控；**自检面板结论不可信（V2）** |
| 异常场景 | ❌ **后台时全屏闹钟不可见（V1，P0）**；双路启动竞态（V3，P1） |
| 性能 | ✅ 冷启动 ≈1.9s、CPU 5.2%；⚠️ PSS 132MB；jank 样本不足 |

**最关键的一条**：在这台 vivo 上，闹钟**响了但看不见** —— 投递链路本身是通的
（`dumpsys alarm` 落点精确、`deliveryAt` 有记录、声音起过），断点在
**「把全屏界面真正推到用户眼前」这一步**。而自检面板会把这个断点**误报成「缺全屏通知权限」**，
从而把人引向一个已经给了的权限。

---

*取证原始文件：`/tmp/vivo-trials/`（四轮试验日志与台账快照）· 截图：`docs/reviews/evidence-vivo-2026-09-17/`*
