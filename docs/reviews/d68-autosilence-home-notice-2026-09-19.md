# vivo 实机验证报告 · D68（响铃时限 / 首页硬告知 / 全屏意图文案）

- 日期：2026-09-19
- 设备：vivo V2238A（PD2238）· Android 16 / SDK 36 · OriginOS 16.0（`PD2238_A_16.3.15.0.W10`）
- 序列号：`10ACBF2D3D000RS`（USB 直连）
- 被测包：`space.alliswell.inbox`
- **本轮判定的候选包** APK SHA-256：`cb6a921717c2de35225e8ed47378079881ffb23b46de179557e67697cd76607f`
  （设备上 `pm path` 指向的 `base.apk` 与本地 `releases/安心收件箱-debug.apk` 双向核对一致）
- 证据目录（判定用）：`docs/reviews/verification-runs/20260919T023259Z-d68-autosilence-home-notice/`
- 另一轮**作废**的证据目录：`docs/reviews/verification-runs/20260919T020340Z-…`（首轮）与
  `20260919T022222Z-d68-autosilence-home-notice-r2/`（第二轮的 A-1 结论仍有效，但**它跑的 Web 层不是当前源码**，原因见 §七）

---

## 一、结论摘要

| 项 | 结论 |
|---|---|
| **D68-a** 响铃时限（生产值 **5 分钟**）自动静音 | ✅ **PASS** |
| **D68-a** 自动静音**不产生 ACK**、投递记录保留 | ✅ **PASS** |
| **D68-a** 静音后服务已停 ⇒ 铃声与振动已停（D59 口径） | ✅ **PASS** |
| **D68-a** 界面回落不得把铃声重新播起来（`wasAutoSilenced` 闸门） | ⚠️ **NOT_PERFORMED on device**（无法从外部驱动，见 §六）+ ✅ 台账侧等价证据 |
| **D68-b** 首页硬告知：权限撤销 → 出现 / 恢复 → 自动消失 | ✅ **PASS** |
| **D68-b** 总开关未开与权限未给**分开说** | ✅ **PASS** |
| **D68-c** 全屏意图用途说明随包交付、旧机制文案已清除 | ✅ **PASS** |
| **新增** 源 ↔ 交付物一致性前置检查 | ✅ **已生效**（且它当场拦下了一个陈旧候选包，见 §七） |

**一句话**：D68 的三条裁决在真机上全部生效；「响 5 分钟自己停、不写 ACK、记录保留」由**两份互相独立的记录**同时证实。
唯一没能在真机上驱动的是「界面回落重播」这一格（`AlarmActivity` 未导出，adb 无法以同 token 重启它），
已按 NOT_PERFORMED 记账并给出台账侧等价证据。

---

## 二、方法与前置

全部通过 adb + WebView CDP 驱动；**未使用 `am force-stop`**（会置 `stopped=true` 并被系统屏蔽广播，属已知禁忌）。

### 证据来源（**两路独立**，这是本轮最重要的方法改进）

| 来源 | 取法 | 性质 |
|---|---|---|
| **投递台账** | `run-as <pkg> cat shared_prefs/alarm_trace.xml` → 逐条解析 | 明细最全，但**有界**（见下） |
| **自动静音记录** | `shared_prefs/attention_alarm.xml` 的 `deliveryAt` / `autoSilencedAt` | 每个动作各写一次，**不会被后续重排冲掉** |
| 服务是否仍在跑 | `dumpsys activity services <pkg>` | D59 后「服务停」⇒「声振停」的硬判据 |
| 投递结局 | `lastAlarmDelivery()`（CDP） | 含 `path`/`visible`/`shownAt`/`locked` 等 |

### ⚠️ 台账是**有界环形缓冲** —— 取证必须累积，不能「拉一次」

`AlarmTrace.record` 只保留**最后 150 条**（`AlarmTrace.java:17`），而**一次「重排既有闹钟」就写 5 条**
（`cancelled`/`requested`/`item`/`unfreezerScheduled`/`scheduled`）⇒ 可用历史 ≈ **150 ÷ 5 = 30 轮**。

**上一版脚本正是这样崩的**：它每 3–5 秒读一次台账，等到最后还是读到空表
（`xml.etree.ElementTree.ParseError: no element found: line 1, column 0`），
而它要等的 `ringStarted` 早已被后续重排挤出窗口。

本轮脚本改为 `Ledger` 累积器：每 2 秒读一次、按 `(token, stage, at)` 去重累积。
两轮的实测记录：

| 轮次 | 读取次数 | 读空次数 | 累积事件 | 观测到的重排轮次 |
|---|---|---|---|---|
| r2（作废包） | 144 | 0 | 183 | 26 |
| **r3（判定包）** | **143** | **0** | **183** | **24** |

### 新增前置检查：**源 ↔ 交付物一致性**

设备上的包 == 本地候选包（sha256 核对）**证明不了「候选是用当前源码构建的」**。
本轮因此真的踩了一次（§七），所以脚本新增一道检查：把候选 APK 里 `assets/public/**`
的每个文件与**仓库根**的同名文件逐字节比对（`cap sync` 生成物如 `cordova*.js` 自动跳过）。

r3 的前置输出：`PREFLIGHT ok apk=cb6a921717c2 uid=None 源↔交付物=一致`，
15 个文件全部 `MATCH`（完整表见 `metadata.json → sourceArtifactConsistency`）。

---

## 三、D68-a · 响铃时限与自动静音（**判定用数据**）

测试事项：`d68_autosilence_1789785211` · `priority=critical` · `triggerAt = now + 30s`
测试手法：**刻意不注入任何测试用的静音窗口**。`EXTRA_AUTO_SILENCE_MS` 虽然存在，
但投递链路（`AlarmTestReceiver.fillDelivery`）**不转发它** ⇒ 真机上跑到的就是生产值。
代价是这一轮**真等了 5 分钟**。

| 观测 | 值 |
|---|---|
| token | `163740232:6df42479-0243-43c8-bd05-8b7de0e2f1c4` |
| `ringStarted` | `at=1789785240248` · `carrier=native;foreground=true;sound=true;vibrate=true` |
| 响铃中（30 s 时） | `AlarmRingService` **在跑** ⇒ 「先响了」这一前提成立 |
| `ringAutoSilenced` | `at=1789785540264` · `silencedAfter=300000ms; sound+vibration stopped; delivery record kept (unacknowledged, no ACK)` |
| **静音窗口（台账）** | **300016 ms** |
| **静音窗口（第二见证：`autoSilencedAt − deliveryAt`）** | **299962 ms** |
| 第二见证的 token | `autoSilencedTrace == deliveryTrace == token` ✔（说明两份记录说的是**同一次投递**） |
| 静音后服务 | **不在运行** ⇒ D59 口径下「声振已停」 |
| 静音后事项 | `status=due`、`priority=critical`、`rev=1` —— **未被改成 acknowledged/archived** |
| 投递结局 | `path=fsi+direct` · `visible=true` · `shownAt` 已写 · `locked=true` · `screenOn=false` · `autoSilenced=true` · `carrierSound=none` |

**两份独立记录相差 11 ms**（台账 1789785540264 vs prefs 1789785540253），且窗口都落在 300 s ± 30 s 容差内。

> 说明 `carrierSound=none`：D59 之后**声音不归通知管**，通知里本来就不带声音
> （`AlarmTestReceiver` 明确回 `notifyReturned silent; sound+vibration carried by AlarmRingService`）。
> 这个值**不是失败**，而是 D59 的预期形态。

`r2`（作废包，但 A-1 属原生层、不受 Web 层陈旧影响）给出同一结论：
`delta=300013 ms`、第二见证 `299964 ms`。

---

## 四、D68-b · 首页硬告知

三段全部由 adb 驱动（`pm revoke/grant POST_NOTIFICATIONS` 制造真实断链；注意该命令**会杀掉进程**，
所以「恢复后自动消失」这一格走的是冷启动，与用户「切回前台」是同一条 `getPermissionState → setNativeReminderStatus` 通路）。

| 场景 | `#homeNotice` | `data-notice-kind` | 高度 | 结论 |
|---|---|---|---|---|
| 撤销 `POST_NOTIFICATIONS` | 「**无法保证提醒** · 系统通知权限未授予：关掉 App 后不会有通知，屏幕也不会亮 —— 可能只剩铃声与振动。点这里去授权。」 | `permission` | 91 px | ✅ |
| 恢复权限（负向对照） | **空** | — | 0 | ✅ |
| 应用内总开关关掉 | 「**后台提醒已关闭** · 关掉 App 后不会有任何提醒。到「我的 → 本地通知」把它打开。」 | `switch` | 91 px | ✅ |

**文案纪律（D59）已随包交付**：真机读到的措辞是修正后的版本，
它**没有**说「闹钟不响」——因为 D59 之后声音不依赖通知权限；丢失的是**通知**与**屏幕**。

---

## 五、D68-c · 全屏意图用途说明

| 检查 | 结论 |
|---|---|
| 候选 APK 内 `assets/public/index.html` 含用途说明（「直接亮屏弹到最前」） | ✅ |
| 旧的机制描述（「Android 14+ 锁屏/息屏弹全屏的必要条件」）已不在包内 | ✅ |
| 自检面板截图（`q6-notify-lab-panel.png`） | ✅ 留档 |

---

## 六、防回归闸门：**为什么是 NOT_PERFORMED**

要验证的那条路径是 `AlarmActivity.onResume → restartAlarmEffects()`：
静音之后用户重新看到界面时，界面**不得**把铃声自己播起来（否则 5 分钟上限等于没生效）。

脚本按设计**沿用同一个 token** 去重启 `AlarmActivity`，两条路都被系统拒绝：

```
via=direct : SecurityException: Permission Denial: starting Intent { … cmp=space.alliswell.inbox/.AlarmActivity }
             from null (pid=…, uid=2000) not exported from uid 10190
via=run-as : SecurityException: Permission Denial: package=com.android.shell does not belong to uid=10190
```

根因：`AlarmActivity` 与 `AlarmTestReceiver` **都是 `android:exported="false"`**，
而 `adb shell` 的 uid 不在该包的 uid 集合里。**这条路径无法从外部驱动** —— 如实记为 NOT_PERFORMED，
不冒充 PASS（与 `vivo-d45a-device-verification-2026-09-18.md` 的口径一致）。

**替代证据（台账侧，同一 token）**：整段生命周期里 `ringStarted` **只出现 1 次**
（`a1RingStartedCountObserved = 1`），且静音后服务不在运行 ⇒「没有第二路声音被播起来」。
`a1GuardHeldFromLedger = true`。

该闸门的**可证伪性**由测试层保证：
`test-native-reminders.js` 的 D68 章节做源码级断言，
`scripts/verification/reverse-check-d59.js` **真的把闸门回退一次**并要求断言当场变红（31/31 全红）。

---

## 七、本轮两件事必须留档（都不是「测试通过」能盖过去的）

### 7.1 首轮与 r2 跑的是**陈旧候选包**（Web 层）

| 文件 | 状态 |
|---|---|
| `app-core.js` | **STALE_IN_APK** —— 包内 `0ba84ddfdb8e…`，工作树 `933b30226225…` |
| 其余 14 个 web 资源 | MATCH |

时间线：APK 构建于 **09:58:36**，`app-core.js` 在 **10:05:17** 被改（D59 文案纪律修正）。
于是 r2 真机读到的仍是**修正前**的措辞「关掉 App 后闹钟可能不响」——**那句在 D59 之后是错的**。
`sha256` 核对完全无法发现这一点（设备上的包确实等于本地候选）。
⇒ 已加 §二 的「源 ↔ 交付物一致性」前置检查；重建候选包（`cb6a9217…`）后 r3 全部 `MATCH`。

### 7.2 撞见一次「对账把台账打转」的现场，另案（D69）

两轮取证期间反复看到同一种形态：**对账每被触发一次，就把所有闹钟全量重排一遍**
（`lib/native-reminders.js:571-572` 的注释是明写的：「对 desired 全量重排」）。
r3 窗口内 24 轮、r2 窗口内 26 轮；节奏是**成对出现**（对内间隔 0.22–0.94 s），
对间 6–300 s（由事件驱动）。

**放大器已在代码层指名**：

```
Capacitor App 的 appStateChange(isActive)
  ├─ lib/native-reminders.js:1019 → drainAlarmActions → handleAlarmAction → queueNativeReminderSync()  (app-core.js:4208)
  └─ lib/native-reminders.js:1094 → handlers.onResume                        → queueNativeReminderSync()  (app-core.js:5039)
```

两条通路各自 `await` 原生往返，**落在 80 ms 去抖窗口之外** ⇒ 一次前台事件被记成**两轮全量重排**。

另有一次**连续 ~1 Hz 数十轮**的现场（10:04–10:09，台账被同一个闹钟的 30 轮刷满 150 条上限；
`dumpsys alarm` 显示期间**没有任何闹钟真的到点**、`performance.timeOrigin` 证明页面**没有重载**），
**4 次受控复现均未复现**。

r3 期间注入探针实测 **436 s**：`scheduleAlarm` 仅 **10 次**（≈0.02 次/秒，
对照风暴期 1 次/秒）、`appStateChange` 仅 **2 次** —— 即**观测期内没有风暴**，
且「Activity 反复 resume」这条假设在这 436 s 里**被排除**。
故：**放大器已指名到行，但 1 Hz 的驱动源仍未定位**，触发源不当作已证结论。

**按 2026-09-18 的流程约定：只出裁决请求，代码一行未动** →
[`../decisions/request-d69-reconcile-churn-2026-09-19.md`](../decisions/request-d69-reconcile-churn-2026-09-19.md)（D69，含 B/E/C 三方案的利弊与推荐）。

---

## 八、对设备与应用做的改动（**均已复位**）

| 改动 | 说明 | 状态 |
|---|---|---|
| 覆盖安装 debug 包 | `1cdd76ac…` → `cb6a9217…`（含 D68 全部改动 + 文案修正） | 保留（即判定用候选包） |
| `pm revoke` / `pm grant POST_NOTIFICATIONS` | 由脚本制造/恢复断链条件 | **已恢复 `granted`** |
| 测试事项 `d68_autosilence_*` | 独立 id 段，无既有事项复用 | **由脚本第 5 步 `completeItem` 收口** |
| 临时探针事项 `probe_1hz`（排查期手动创建） | 独立 id，已 `stopAlarmDelivery` + 从状态中移除 | **已清理** |
| CDP `adb forward` | 取证通道 | **已移除** |
| 未做 | 卸载、清除应用数据、修改用户既有事项、变更系统设置项 | — |

---

## 九、测试水位（**本轮实测**）

| 套件 | 结果 |
|---|---|
| `test-unit.js` | **249 / 0** |
| `test-native-reminders.js` | **259 / 0**（含 D68 章节 14 条源码级断言） |
| `test-smoke.js` | **219 / 0**（`11b A-2` 段 **15** 条行为级断言） |
| `test-regressions.js` | **574 / 0** |
| **合计** | **1301 / 0** |
| `scripts/verification/reverse-check-d59.js` | **31 / 31 全红**（含 9 条 D68 回退用例），恢复后全绿 |

> 规格 `android-alarm-carrier.md` 的 T10 原记「smoke 204→217（13 条）」，本轮实测为 **204→219（15 条）**
> —— 差的 2 条是 D59 文案纪律断言，写入时间晚于该行。**规格已按实测更正。**

---

## 十、复现方式

```bash
# 1. 构建并确认「源 ↔ 交付物」一致（脚本前置会强制检查）
npm run sync:www && JAVA_HOME=~/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
  npx cap sync android && bash scripts/android-build.sh debug
SHA=$(shasum -a 256 "releases/安心收件箱-debug.apk" | cut -d' ' -f1)

# 2. 安装（vivo 需要点确认框：复选框 540,2100 → 继续安装 540,2246）
~/Library/Android/sdk/platform-tools/adb install -r "releases/安心收件箱-debug.apk"

# 3. 真机验证（约 11–12 分钟，含生产值 5 分钟真实等待）
/usr/bin/python3 scripts/verification/d68-autosilence-home-notice.py \
  docs/reviews/verification-runs/$(date -u +%Y%m%dT%H%M%SZ)-d68-autosilence-home-notice \
  --serial 10ACBF2D3D000RS --sha256 "$SHA"
```

退出码 0 = 无失败项；`RESULTS.notPerformed` 列出的未执行项不算失败。
