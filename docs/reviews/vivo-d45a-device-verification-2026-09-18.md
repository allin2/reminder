# vivo 实机验证报告 · D44 / D45 修复与投递路径对照

- 日期：2026-09-18
- 设备：vivo V2238A（PD2238）· Android 16 / SDK 36 · OriginOS 16.0（`PD2238_A_16.3.15.0.W10`）
- 序列号：`10ACBF2D3D000RS`（USB 直连，adb 37.0.1）
- 被测包：`space.alliswell.inbox`
- APK SHA-256：`ae6c91724686cca33b0f8da50d30632fcf9bb0500c5b2cc47ab71119f4776b60`
  （= 仓库 `android/app/build/outputs/apk/debug/app-debug.apk`，含 D41–D45 全部改动；安装前后 sha256 双向核对一致）
- 证据目录：`docs/reviews/verification-runs/20260918-vivo-d45a/`

---

## 一、结论摘要

| 项 | 结论 |
|---|---|
| **D45-a** 遮挡期间继续响（无通知权限） | ✅ **PASS** |
| **D45-a** 遮挡期间继续响（有通知权限，振动） | ✅ **PASS** |
| **D45-b** 返回界面不叠加第二路铃声 | ✅ **PASS** |
| **N-01** 停止解耦（台账命中/未命中都能停） | ✅ **PASS** |
| **D44 / N-08** 截止补投去重 | ⚠️ **NOT_PERFORMED**（本轮未构造截止场景，见 §六） |
| **N-02** 声振生命周期配对 | ✅ **PASS**（即 D45-a 的观测面） |
| **N-03** 面板轮询与冷启动基线 | ⚠️ **NOT_PERFORMED**（属代码级，已由源码断言覆盖） |
| **新发现 H-08** 无通知权限时息屏闹钟完全静默 | 🔴 **已确认，高危**（见 §四） |

**一句话**：本次修复在真机上全部生效；但排查过程中确认了一个**独立的高危缺陷**——用户若未授予通知权限，息屏/锁屏时闹钟**不亮屏、不响铃、不振动**，用户完全错过。

---

## 二、方法与前置

全部通过 adb + CDP 驱动，未使用 `am force-stop`（会置 `stopped=true` 并由系统屏蔽广播，属已知禁忌）。

**观测手段（三路交叉，避免单一信号误判）**

| 信号 | 命令 | 说明 |
|---|---|---|
| 振动 | `dumpsys vibrator_manager` → `CurrentVibration` | 既有脚本已确立的口径 |
| **音频** | `dumpsys audio` → 过滤 `u/pid:10190/` 的 `state:started\|playing` | **本轮新增**，独立于振动的第二路证据 |
| 投递台账 | `run-as … cat shared_prefs/alarm_trace.xml` | XML 内嵌 HTML 转义 JSON，逐条时间戳可比对 |
| 前台/窗口 | `dumpsys activity activities` / `dumpsys window` | 判定 Activity 是否真的可见 |
| 电源 | `dumpsys power` → `mWakefulness` | 判定闹钟是否点亮屏幕 |

**测试期间对设备/应用做的改动（需知悉，均已复位）**

| 改动 | 说明 | 状态 |
|---|---|---|
| 覆盖安装 debug 包 | 设备原为 00:49 构建（`7813017e…`），升到 14:59 构建 | 保留（即最新修复版） |
| `pm revoke / grant POST_NOTIFICATIONS` | 制造/复原有权限条件 | **已恢复 `granted=true`** |
| `svc power stayon false` + `stay_on_while_plugged_in=0` | 为测息屏；先设 `true` 后复位 | 已复位（**注**：原值未能记录，回退为系统默认 0） |
| 诊断闹钟 id 918181–918186 | 独立 id 段，无事项绑定 | **全部 cancelAlarm + cancelNotification，残留 0** |

**未做**：卸载、清除应用数据、修改用户事项、变更系统设置项。

**一个必须记录的环境陷阱**：`pm revoke POST_NOTIFICATIONS` **会立即杀死应用进程**（实测进程从 pid 22348 → 不存在）。这不是权限撤销的副作用，而是 Android 的行为；类似地，撤销后 `notificationsEnabled` 由 `true` 变 `false`，`diagnose()` 可回读确认。

---

## 三、D45-a / D45-b / N-01 实机结论

### 3.1 场景 A：无通知权限（界面为唯一声源）+ 亮屏

从 `AlarmActivity` 被拉起、界面自播声音起跟踪：

| 阶段 | 振动 | 音频 playing | 前台 |
|---|---|---|---|
| T0 响铃中 | running=1 | 1（`usage=USAGE_ALARM`） | `.AlarmActivity` |
| **T1 按 HOME** | **running=1** | **1** | 桌面 |
| T2 返回界面 | running=1 | 1 | `.MainActivity` |
| T3 点「停止声振」 | **null** | **0** | `.MainActivity` |

**替代解释已排除**：`onStop` 是否真的触发过？台账给出了答案——

```
15:12:59.119 paused    finishing=false     ← 按 HOME
15:13:00.137 stopped   finishing=false     ★ onStop 确实执行
15:13:17.370 deliveryStopped / effectsStopped   ← 点停止
```

`stopped` 事件在案、且 `finishing=false`（非销毁路径），而声振仍在 → **只能是修复后的行为**。
同时 T3 证明 `stopAlarmEffects()` 本身有效（能把 running 打到 null），因此 T1/T2 的"仍在响"不是"停不掉"。

### 3.2 场景 E：有通知权限 + 按 HOME

| 阶段 | 界面振动 | 前台 |
|---|---|---|
| 响铃中 | running=1 | `.AlarmActivity` |
| **按 HOME** | **running=1** | `com.bbk.launcher2`（桌面） |
| 点「停止声振」 | running=0 | `.MainActivity` |

有权限时声音归系统通知渠道（界面 `playing=false`，符合 `notificationOwnsSound()` 设计），但**振动仍由界面驱动**——所以 D45-a 对多数用户同样生效：**遮挡后振动持续**。

**已接受的代价在此显形**：用户按 HOME 后界面不可见却仍振动，且（无权限场景）通知栏没有「停止声振」按钮，静音入口只剩"回到界面点关闭"。这是 D45-a 的既定取舍，非缺陷。

### 3.3 N-01

T3 的 `deliveryStopped` + 振动归零 + 音频归零，且当次面板文案为
「测试提醒或原事项已不存在，仍可停止声振」（`matchingItems:0`，即事项侧无从匹配）——
正是"台账/事项不一致时停止仍需生效"的场景，**通过**。

### 3.4 D45-b 幂等

T2（返回界面）后 `playing` 仍为 **1** 而非 2。若 `startAlarmSound()` 不幂等，返回时会新建第二个 `MediaPlayer` 使计数变 2。**未观察到叠加**。

---

## 四、🔴 新发现 H-08：无通知权限时，息屏闹钟完全静默（高危）

### 4.1 七次投递的对照矩阵

同一设备、同一 ROM、同一天、同一 APK，唯一受控变量是**通知权限**与**屏幕状态**：

| # | 时刻 | 通知权限 | 屏幕 | `path` | `launchRequested` | **`created`** | 屏幕被点亮 | 声音 | 振动 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 15:10:50 | ❌ 无 | 息屏锁屏 | `fsi+direct` | ✅ | ❌ | ❌ | ❌ | ❌ |
| 2 | 15:12:42 | ❌ 无 | 亮屏解锁 | `direct` | ✅ | ✅ | — | ✅ | ✅ |
| 3 | 15:13:59 | ❌ 无 | 息屏锁屏 | `fsi+direct` | ✅ | ❌ | ❌ | ❌ | ❌ |
| 4 | 15:14:51 | ✅ 有 | 息屏锁屏 | `fsi+direct` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 | 15:16:18 | ✅ 有 | 息屏锁屏 | `fsi+direct` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6 | 15:17:45 | ❌ 无 | 息屏锁屏 | `fsi+direct` | ✅ | ❌ | ❌ | ❌ | ❌ |
| 7 | 15:18:37 | ✅ 有 | 亮屏解锁 | `direct` | ✅ | ✅ | — | ✅ | ✅ |

**统计**：无权限 + 息屏 **0/4 成功**；有权限 + 息屏 **2/2 成功**；无权限 + 亮屏 **1/1 成功**。

### 4.2 断点位置

失败轮次的台账**每次都停在同一处**，是一条干净的因果链：

```
15:17:45.084 unfreezerStarted    foreground service torn down the freezer
15:17:45.131 received            ← 广播准点到达（误差 <30ms）
15:17:45.158 environment         screenOn=false;locked=true;inCall=false;path=fsi+direct
15:17:45.188 launchRequested     direct launch alongside full-screen intent   ← 直起已发出
15:17:45.209 notifyReturned      insistent; notify returned; not proof of display
（无 created / resumed / focus / windowVisible —— 到此为止）
```

即：**排程准点、反冻结生效、广播送达、`startActivity` 已调用**，但 **Activity 从未创建**。
`notifyReturned` 的 detail 自带警示 `not proof of display` —— 它只证明"调用返回"，不证明通知真的显示。

### 4.3 机制归因（**推断**，非直接日志证实）

两条证据指向同一根因：

1. **`AlarmTestReceiver.java:212`**：`builder.setFullScreenIntent(contentPi, true)` ——
   FSI 是 **Notification 的属性**。通知发不出去 → FSI 无载体 → 系统侧不存在"该用全屏意图拉起"这件事。
2. **直起需要 BAL 豁免**。09-17 取证文档曾记录系统给出
   `+30s0ms NOTIFICATION_SERVICE` 的 BAL 豁免——**该豁免的来源正是应用 post 了高优先级通知**。
   通知未 post → 无豁免 → `startActivity` 被静默拦下。

**本轮 logcat 未捕获到显式拒绝日志**（全量抓取 15:17:36–15:17:55，仅见 GC / avc 无关记录），
与项目既有的"BAL 拦截是静默的"记录一致。因此 **4.2 的现象是已确认的，4.3 的机制是推断**。
要把机制钉死，需要 SurfaceFlinger / `dumpsys activity` 的 `mLastBAL` 级证据（见 §六）。

### 4.4 业务影响

用户关掉通知权限（**Android 13+ 首次安装默认即未授予**，需用户主动允许），且手机在息屏/锁屏状态——
**闹钟不亮屏、不响铃、不振动，完全静默**。

这不是"少一条通知"，而是**用户会彻底错过**，直接违背产品红线「让用户不错过」。而且它发生在最典型的场景：
睡前设的闹钟、手机放在床头息屏。

---

## 五、对既有结论的澄清（含我自己的一次误判）

排查中我一度推断"09-17 那三次失败时通知权限未授予"，**该推断错误，此处更正**：

- `docs/reviews/vivo-device-test-2026-09-17.md:102` 明确四轮试验的统一前置是
  「应用已启动（清 stopped 态）、`notify=true`、**通知权限已授予**」；
- 同文档 `:290` 的「`POST_NOTIFICATIONS` 未授予」说的是**首装状态**（§V8），非试验前置；
- `:334` 记录了测试期执行过 `pm grant`，即为满足 `:102` 前置。

**那么 09-17 与本次的差异在哪？** 在代码：

- `AlarmTestReceiver.java:96-104` 注释记载了「V1 复测修正」——*此前*息屏/锁屏下 `directPath` 为 false，
  **完全不直起**，把可见性全押在 FSI 上；实测该押注不成立（`:117-121`），遂改为**直起与 FSI 并存**。
- 09-17 的 A/C 轮次正是"只有 FSI、没有直起"的形态 → 投递有记录但界面不可见。
- 本次的 `path=fsi+direct` 已是修正后形态 → 有权限时直起成功。

**所以 09-17 的结论依然成立**（当时那不直起的形态确实等于不投递），
而 **H-08 是叠加在其之上的第二个、独立的断点**：即便直起已并存，**无通知权限时它仍会被拦**。

---

## 六、未验证 / 未执行

| 项 | 原因 |
|---|---|
| D44 / N-08 截止补投去重 | 需构造"截止点已过 + 台账为空"的场景并等待对账，本轮未做；已由 `scripts/verification/deadline-quiet-probe.js` 在代码级覆盖 |
| N-03 面板轮询 / 冷启动基线 | WebView 内部行为，已由 `test-native-reminders.js` 源码级断言覆盖，真机无额外观测面 |
| H-08 的**机制**直接证据 | 需 `dumpsys activity` 的 BAL 拒绝明细或 `mLastBAL`；本轮 logcat 未捕获显式拒绝 |
| H-08 在**其它 ROM/机型**的普遍性 | 仅验证 vivo V2238A / Android 16；小米/华为/原生 AOSP 未测 |
| 开机恢复（`BootRestoreReceiver`） | 未重启设备 |
| 覆盖升级保留数据 | 本轮仅做同签名覆盖安装，未验跨版本数据迁移 |
| 免打扰（DND）时段投递 | 未构造 |
| `User 666`（XSpace） | 设备上存在该用户（`dumpsys` 返回 `Shell does not have permission to access user 666`），本轮未验 |
| 长时后台保活（Doze） | 未进入 Doze 观察 |

---

## 七、修复方向候选（H-08，**待裁决**，未擅自改动）

| 方向 | 做法 | 代价 |
|---|---|---|
| **A. 强制前置通知权限** | 首次进入即引导授予；未授予时在首页常驻醒目提示，并在保存事项时提示"此提醒在息屏下不会响" | 改动小、语义诚实；但不能替用户解决（用户仍可拒绝） |
| **B. 无权限时放弃 FSI、改走前台服务常驻** | 用 `startForeground` 换 BAL 豁免维持窗口 | 需前台服务 + 常驻通知，而**通知本身就没权限**——逻辑上可能不成立，需先验证 |
| **C. 无权限时把闹钟降级为「应用内到点提示 + 强提示授权」** | 承认系统层无法投递，改在用户下次打开时明确告知"你错过了 X 个提醒" | 不违背系统语义；但"不错过"的承诺在该用户群上打折 |
| **D. 记录并上报** | 台账写入 `deliveryBlocked`（已有 `launchLikelyBlocked` 的相近语义），自检面板如实显示 | 只解决可观测性，不解决投递 |

**我的倾向**：先做 **D + A**（把"被拦"变成可见事实 + 引导授权），
B 需要先验证"无通知权限时前台服务能否换来 BAL 豁免"（这本身是一个待验假设，不能直接写进方案）。

无论选哪条，都**不应由我单方面决定**——它牵涉"对未授权通知用户的产品承诺"这一业务判断（基线 §22）。

---

## 八、可复现方式

```bash
# 环境
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"

# 安装并核对哈希
adb -s 10ACBF2D3D000RS install -r android/app/build/outputs/apk/debug/app-debug.apk

# 制造无通知权限条件（注意：会杀死应用进程）
adb -s 10ACBF2D3D000RS shell pm revoke space.alliswell.inbox android.permission.POST_NOTIFICATIONS

# 复现 H-08：息屏下排诊断闹钟
adb -s 10ACBF2D3D000RS shell input keyevent KEYCODE_SLEEP
#   期望（有权限）：mWakefulness=Awake、topResumedActivity=.AlarmActivity、台账出现 created
#   实测（无权限）：mWakefulness=Asleep、无前台、台账止于 launchRequested

# 复原
adb -s 10ACBF2D3D000RS shell pm grant space.alliswell.inbox android.permission.POST_NOTIFICATIONS
```

台账解析（XML 内嵌转义 JSON）：

```python
import re, html, json
s = open("alarm_trace.xml").read()
ev = json.loads(html.unescape(re.search(r'name="events">(.*?)</string>', s, re.S).group(1)))
```

---

## 九、证据索引

| 文件 | 内容 |
|---|---|
| `…/20260918-vivo-d45a/baseline-*.txt` | 安装前基线（权限、振动、prefs、AlarmManager） |
| `…/run1/` | 首轮（含 UIAutomator 定位失败与息屏变量） |
| `…/scenario-A/` | D45-a 无权限亮屏：`t0-ring` / `t1-home` / `t2-back` / `t3-stopped` 各三路快照 |
| `…/scenario-B-asleep/` | 无权限息屏（失败复现 #2） |
| `…/scenario-C-asleep-withperm/` | 有权限息屏（成功 #1） |
| `…/scenario-C2-asleep-withperm/` | 有权限息屏（成功 #2） |
| `…/scenario-D-noperm-bal/` | 无权限息屏 + 全量 logcat（失败 #4） |
| `…/scenario-E-withperm-hidden/` | 有权限按 HOME 后振动持续 |
| `…/run2-tool-fixed/`、`…/run3-tool-fixed/` | 取证脚本修复前后的自检运行（run3 起 `stop-path.txt` = `cdp-panel-button`，断言依据 `CurrentVibration: null`） |

> 仓库根另有一个 `RUN/` 目录（11 MB，`metadata.json` 内 SHA-256 为 `7813017e…` = **本轮安装前**的旧包），
> 时间戳 14:19–14:21，早于本轮验证（15:06 起）。它**不是本轮产生**，未做处理，留待你确认。

---

## 十、工具侧问题（非产品缺陷，但影响取证）

1. **UIAutomator 看不到 WebView 文本**：`oppo-hidden-alarm.py:25` 依赖
   `uiautomator dump` 找 `text=='停止声振'`，在本设备上 `StopIteration` 失败，
   而同一时刻 CDP 读出的面板文本明确包含该按钮。改用 CDP `[data-alarm-stop]` 的 `click()`
   可走同一条真实事件处理链（`app-core.js:5684` 的 `addEventListener`），本轮即以此完成 N-01 验证。
2. **`KEYCODE_WAKEUP` 不保证保持唤醒**：首轮排程后 8 秒内设备已 `Asleep`，
   导致"熄屏"成为未受控变量。应以 `svc power stayon true` 显式保活，或把屏幕状态写进台账前置。
3. **脚本中断会留下响铃**：`oppo-hidden-alarm.py` 的清理在断言之后，
   断言失败即跳过清理。建议把清理放进 `try/finally`。
