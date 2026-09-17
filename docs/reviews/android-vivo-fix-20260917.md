# vivo 真机缺陷修复（V1 / V2 / V3）

- **日期**：2026-09-17
- **输入**：`docs/reviews/vivo-device-test-2026-09-17.md`（vivo V2238A · Android 16 真机五维测试）
- **改动范围**：`AlarmTestReceiver.java` · `AlarmActivity.java` · `SystemBridgePlugin.java` · `app-core.js`
- **纪律**：只修缺陷，**不动产品逻辑**（Attention≠Task / Acknowledged≠Completed / 通知送达≠用户看到 三条红线未触碰，V0.2 基线未改）

---

## 1. 三个缺陷的因果链

```
V3 双路启动竞态 ──┐
                  ├─→ V1 后台全屏不可见（响了但看不见）
平台 BAL 拦截 ────┘
V1 + 归因靠猜 ──────→ V2 自检面板误诊「缺全屏通知权限」
```

先修 V3/V1（真缺陷），再修 V2（它决定了后续所有排查是否还会被带偏）。

---

## 2. V3：双路启动 → 一环境一路径

**改前**：`AlarmTestReceiver` 无条件同时做两件事 ——

1. 直起 `AlarmActivity`（`NEW_TASK|CLEAR_TOP|SINGLE_TOP`）；
2. 给通知挂 `setFullScreenIntent`，**指向同一个** `AlarmActivity`。

锁屏/息屏时系统会再启动一次，真机实测产生：

```
replaced different delivery → effectsStopped → audioStarted → duplicateIntent
```

即响铃被打断后重启；且同一 Activity 在 253 ms 内被拉起两次，与「窗口创建了却从未可见」直接相关。

**改后**：按投递环境**互斥**选路（平台语义依 AOSP 行为表，见测试报告 §5.5）：

| 投递环境 | 路径 | 理由 |
|---|---|---|
| 锁屏 / 息屏 / AOD | `fsi` | 全屏意图由系统接管，系统此时会真的全屏；直起既多余又是竞态源 |
| 解锁亮屏 + 非通话 | `direct` | 系统会把全屏意图降级成横幅，只能自己把界面拉起来（需 BAL 豁免） |
| 解锁亮屏 + 通话中 | `banner` | Q5：让路，只响铃 + 出横幅 |

```java
boolean backgroundDelivery = locked || !screenOn;
boolean fsiPath    = fullScreen && backgroundDelivery;
boolean directPath = fullScreen && !backgroundDelivery && !inCall;
```

同步把 `setFullScreenIntent` 收进 `if (fsiPath)`；非 FSI 路径先 `nm.cancel(id)`，
避免上一次投递残留的全屏意图继续留在系统里（现场出现过带**旧 delivery** 的 `replaced`）。

**保留不变**：Q5 的「锁屏时闹钟优先、不下让通话」语义不变（锁屏 + 通话仍走系统 FSI）。

---

## 3. V1：窗口自己作证「有没有显示出来」

**改前**：「可见」只认 `onWindowFocusChanged(true)` 写 `deliveryShownAt`。
真机实测后台被拉起时窗口可能**可见但拿不到焦点**（`focus=false; shown=false; visibility=4`），
于是 `deliveryShownAt` 永远是 0 —— 判据本身就把「没焦点」误读成了「没显示」。

**改后**：两条判据任一成立即认定已显示，并按 300 / 800 / 1500 ms 采三次：

```java
boolean shown   = view.isShown() && view.getWindowVisibility() == 0;
boolean focused = view.hasWindowFocus();
if (!shown && !focused) return;   // 都不到位就继续等
```

- 命中 → 写 `deliveryShownAt` + `deliveryVisible=true`，trace `windowVisible`
- 1.5 秒三次都没命中 → 写 `deliveryHiddenAt`，trace `windowHidden`（**如实记一笔「没送到眼前」**）
- `onDestroy` 兜底：到销毁都没判定为可见（例如被系统几百毫秒内收掉）也补记

声音**照旧继续响** —— 它是用户唯一的线索，不复位、不停播；只是不再假装这次投递成功。

新增台账字段（`SystemBridgePlugin.lastAlarmDelivery` 一并回读）：

| 字段 | 含义 |
|---|---|
| `path` | `fsi` / `direct` / `banner` —— 这次走的是哪条路 |
| `visible` | 界面是否真的显示出来 |
| `hiddenAt` | 判定「没能显示」的时刻（0 = 没判过） |

另在直起前预判并落盘：没有 `SYSTEM_ALERT_WINDOW` 时记 `launchLikelyBlocked`
（trace 里显示为「预计被系统拦下」）—— 把「只能靠猜」变成「有据可查」。

---

## 4. V2：自检面板按证据归因，不再猜权限、不再过度承诺

**改前**（`app-core.js` 的 `describeAlarmDelivery`）：`if (d.locked) → "缺「全屏通知」权限"`
—— 仅凭「锁屏且没弹出」就断定缺权限，而真机上该权限是 `granted=true`，
同一面板上一行还写着「全屏 OK」。**用户会因此反复去授权一个已经给了的权限**。

**改后**按「这次走的哪条路 + 缺哪项能力」逐步归因：

| 情形 | 结论文案 |
|---|---|
| 可用 `visible` / `shownAt` 判定已显示 | 「闹钟界面已经显示出来」 |
| 解锁 + 通话中（Q5 让路） | 「通话中 · 只响铃不抢屏（按设计）」 |
| 锁屏/息屏 + 缺 FSI 权限 | 「缺「全屏通知」权限 · 锁屏/息屏只能出横幅」 |
| 锁屏/息屏 + 权限齐备 | 「权限齐备，但系统没有展示这次全屏 · 请把这一行发给开发者」 |
| 解锁亮屏 + 无悬浮窗 | 「缺「显示在其他应用上层」· 解锁亮屏下后台启动界面被系统拦下」 |
| 权限齐备却仍未展示 | 「权限齐备，但界面没有被系统展示 · 请把这一行发给开发者」 |

**过度承诺**：`renderBackgroundVerdict` 的结论行原本无条件写
「系统里已挂 N 条提醒 · **关掉 App 后仍会按时响**」，依据只是「挂了几条」。
现在**把上一次投递的真实结局纳入判断**：

- 上次投递可见 → 「排程已经落到系统里。」（`已就绪`）
- 上次投递**没能送到眼前** → 「排程已经落到系统里（N 条），但**上一次到点没能把界面弹出来** —— 见上面「投递」一行。」（`有保留`，图标转 ⚠️）

**自相矛盾**：「全屏」一行 `fullOk` 时原文案是「解锁亮屏与锁屏都能弹全屏」，
与下一行「投递：锁屏也没弹出」并存时互相打脸。改为
「**权限齐备 · 能否弹出以「投递」一行为准**」，pill 也从「可全屏」改为「权限齐备」。

---

## 5. 测试

| 套件 | 结果 |
|---|---|
| `test-unit.js` | 105 / 105 |
| `test-native-reminders.js` | 166 / 166 |
| `test-smoke.js` | 175 / 175 |
| `test-regressions.js` | 567 / 567 |
| **合计** | **1013 / 1013 全绿** |

Java 侧 `javac` 语法级检查：0 处语法类错误（只剩「程序包 android.* 不存在」这类缺符号错误，属本机无 SDK 编译环境所致，非代码问题）。

**新增的守卫断言**（都是从「缺陷不许回归」倒推出来的）：

- `V3 两条启动路径互斥：锁屏/息屏只交给系统全屏意图，不再直起界面`
  —— 断言 `backgroundDelivery` / `fsiPath` / `directPath` 三者的形状，
  并**反断言** `setFullScreenIntent` 不能再出现在 `if (fullScreen)` 下的无条件位置、
  `directAllowed` 这个旧变量不许复活。
- `V1 原生按「窗口可见或获得焦点」判定显示，并落盘不可见时刻`
- `V1 投递路径写进台账并回读（fsi / direct / banner）`
- `V2 不再凭「锁屏」就断言缺「全屏通知」权限`
- `V2 权限齐备却没弹出时如实说「系统没有展示」，不编原因`
- `V2 排程落地不再无条件承诺「关掉 App 后仍会按时响」`

原 Q5 断言 `directAllowed = fullScreen && (!inCall || locked)` 因语义升级被替换为新断言，
覆盖强度是**提高**的（旧断言只查通话闸门，新断言同时查通话闸门与路径互斥）。

---

## 6. 未修 / 待真机复测

**本轮不修**（各有原因，不是遗漏）：

| 编号 | 项 | 为什么没修 |
|---|---|---|
| V4 | vivo 默认关闭该应用的横幅 / 锁屏显示 | 无公开 API 可读可写该 ROM 开关；只能引导用户在系统设置里开 |
| V5 | 6 个通知渠道中 3 个从未使用 | 属 E5 待裁决项（保留 `-v2` 还是回收改名），需产品裁决后再动 |
| V6 | 启动期偶发 `Cannot read properties of undefined (reading 'triggerEvent')` | 竞态发生在 Capacitor 自己的 `Bridge.java:868` 与其 JS 注入之间，非本项目代码；需升级 Capacitor 才能从根上消除 |
| V7 | 每次启动 4 条 `Line 353 Msg: undefined` | 可清理的调试残留，不影响功能 |
| V8 | 首装零排程（`notify` 默认 false） | 产品取向，需裁决「首启是否显式一问」 |
| V9 | 一键清理 / force-stop 阻断投递 | 系统标准行为；需产品决定是否加自启动引导 |

**必须真机复测的判据**（修好没有，用这三条判定，不要凭感觉）：

1. **锁屏/息屏到点** → 台账 `path=fsi`、`visible=true`、trace 里有 `windowVisible`；
   且**不得**再出现 `replaced` / `effectsStopped`（说明双路竞态已消除）。
2. **解锁亮屏 + 已授悬浮窗** → `path=direct`、`visible=true`；
   若未授悬浮窗 → trace 有 `launchLikelyBlocked`，自检面板说
   「缺「显示在其他应用上层」」，而**不再**说「缺全屏通知权限」。
3. **自检面板** → 「投递」一行与「全屏」一行不得再互相矛盾；
   若上一次投递失败，结论行必须显示「有保留」而不是 ✅。

---

## 7. 变更文件清单

```
android/.../AlarmTestReceiver.java   V3 路径互斥 + 新增 path/visible/hiddenAt 台账键 + 提取 canDrawOverlays()
android/.../AlarmActivity.java       V1 可见性双判据 + 三次采样 + markHidden 兜底
android/.../SystemBridgePlugin.java  lastAlarmDelivery 回传 path/visible/hiddenAt
app-core.js                          V2 describeAlarmDelivery 证据化归因 + 结论降级 + 文案去矛盾
test-native-reminders.js             新增 6 条守卫断言，替换 1 条被语义升级的旧断言
```
