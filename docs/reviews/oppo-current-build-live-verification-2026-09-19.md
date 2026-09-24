---
doc: review
date: 2026-09-19
device: OPPO PKC130 (Find X8 Pro) / Android 16 (API 36) / ColorOS 16.0.10.500(CN01)
build: releases/candidates/20260919-foreground-banner/app-debug.apk
buildSha256: dd58144c53753d9a229eed84c0a58616842fda21cf09a94ddf7cae1816401a1f
verdict: 部署通过 · 核心交互全通过 · 发现 1 项真缺陷（冷进程投递黑洞）
status: 待裁决（编号未分配）
followup: D70 两条前提经核验均不成立 → ../decisions/d70-prerequisites-verification-2026-09-19.md
---

# OPPO 真机 · 当前构建实机验收报告

> 设备：`QSKFAE95CQEUJZ8L` / `PKC130` / Android 16 (API 36) / ColorOS `PKC130_16.0.10.500(CN01)`
> 验收时刻：2026-09-19 21:26–22:05（GMT+8）
> 红线遵守：全程**只读 + 可逆探针**；未修改任何源码、未 rebuild；测试事项全部用可识别 ID 并已清理。

---

## 一、结论摘要

| 维度 | 结果 |
|---|---|
| 调试通道稳定性 | ✅ A-01…A-05 / B-01…B-07 全 PASS |
| 版本锁定与部署闭环 | ✅ 设备侧 `base.apk` sha256 与本地候选**逐字节一致** |
| 核心交互流程 | ✅ 7/7 PASS（新增/持久化/完成/延后/删除/ACK 周期/终态保护） |
| 投递场景（热进程 · 亮屏） | ✅ PASS，时延 86 ms |
| 投递场景（热进程 · **熄屏 + 锁屏**） | ✅ **PASS，时延 113 ms，全屏界面成功拉起** |
| 投递场景（**冷进程**） | ❌ **FAIL：系统发出闹钟但被 ColorOS 拦截，完全不响** |
| 验证脚本自身 | ⚠️ 发现 3 处缺陷（2 处误报 + 1 处归因错误） |

**一句话**：当前构建在真机上功能面与「亮屏/熄屏锁屏」投递均正常，但存在一个**用户可感的真缺陷** ——
**当应用进程不存活时，ColorOS 会拒绝由闹钟触发的服务/广播启动，闹钟彻底不响。**

---

## 二、验收对象与前置校验

### 2.1 「当前构建版本」如何锁定

工作树有大量未提交改动，本地存在 4 个候选包。**不能凭时间戳猜**，因此做 `assets/public/` 与仓库根的**逐字节比对**：

| 候选包 | 与当前源码一致 | 结论 |
|---|---|---|
| `releases/candidates/20260919-foreground-banner/app-debug.apk` | **15/15 一致 · 0 差异** | ✅ **即「当前构建」** |
| `releases/candidates/20260919-n4-window/app-debug-final.apk` | 有差异 | ✗ |
| `releases/candidates/20260919-n4-window/app-debug.apk` | 有差异 | ✗ |
| `releases/安心收件箱-debug.apk` | 有差异 | ✗ |

补充核验：候选包 DEX 内**含**新实现符号 `DirectBootUtils` / `systemNotificationPosted` /
`deliveryNotificationPosted` / `attention-alarm-v4`；设备上原装的 09-18 旧包**全都没有**。
（`attention-alarm-v3` 仍在，是 `LEGACY_CHANNEL_ID`，用于清理旧渠道，属预期。）

### 2.2 部署闭环

```
adb install -r → Success（流式安装，ColorOS 未弹安装拦截）
设备 base.apk sha256 = dd58144c53753d9a229eed84c0a58616842fda21cf09a94ddf7cae1816401a1f
本地候选     sha256 = dd58144c53753d9a229eed84c0a58616842fda21cf09a94ddf7cae1816401a1f   ← 一致
lastUpdateTime   = 2026-09-19 21:29:12（已更新）
firstInstallTime = 2026-09-18 01:54:51（未变 ⇒ 未卸载重装，用户数据保留）
```

---

## 三、投递场景验证（本次核心）

**方法学要点**：台账是 150 条**有界环形缓冲**，单次尾部采样会漏事件。本轮改为
**触发前强制保持目标屏幕状态 + 触发前 3 s 停止干预 + 4 s 周期累积去重台账**。

| 场景 | 进程 | 触发时屏幕 | 锁屏 | `received` | 时延 | 投递路径 | 现场证据 |
|---|---|---|---|---|---|---|---|
| `asleep` | 存活 | `Dozing` | **true** | ✅ | **113 ms** | `fsi+direct` | `shot_asleep_+3s.png` / `+8s.png` |
| `bg`（对照） | 存活 | `Awake` | false | ✅ | 86 ms | `direct+banner` | `shot_bg_+*.png` |
| `cold` | **已杀** | `Dozing` | true | ❌ | — | — | 仅 `scheduled`，无后续事件 |

`asleep` 现场截图**视觉确证**：熄屏 + 锁屏状态下，全屏闹钟界面成功拉起，
标题「后台验收3 asleep」、当前时间 21:45、四个停止入口（我知道了 / 稍后 2 小时 / 完成 / 关闭）齐全。
台账完整链路：

```
requested → unfreezerScheduled(alarmClock) → scheduled
→ carrierRecorded → ringStarted → received(lag 113ms)
→ environment(screenOn=true;locked=true;path=fsi+direct)
→ ringServiceRequested → launchRequested → systemNotificationPosted → notifyReturned
→ created → focus=true → windowVisible → windowSample×3
```

> ⚠️ **对既有认知的更正**：记忆中的 H-08「屏幕/界面拉不起来（只闻其声、不见其屏）」
> **在当前构建 + 当前设备状态上未复现**。当前设备 `SYSTEM_ALERT_WINDOW: allow`（悬浮窗已授予），
> 而 H-08 当时的归因正是 `launchLikelyBlocked(no SYSTEM_ALERT_WINDOW)`。这一条需要重新裁决。

> ⚠️ 本轮之前有一轮结论「`off` 模式未投递」是**错的** —— 那是台账环形缓冲把事件挤掉造成的读数假象；
> 复查完整台账后，该次实际投递成功（lag 7828 ms）。同样地，早先「熄屏态未投递」也被本轮推翻。

---

## 四、发现的问题

### P1（真缺陷 · 用户可感）冷进程时闹钟完全不响

**现象**：应用进程不存活时，闹钟到点后**无声音、无振动、无通知、无界面**，且**不会补投**（观察 60 s 无任何后续）。

**证据链（三层，全部可复算）**

1. **排程未丢**：`dumpsys alarm` 显示 `RTC_WAKEUP Alarm{3ec2bdc … origWhen 1789825907032}` 在
   kill 前后、触发前 5 s **始终在队列中且排第 1 位**，`component=…/.AlarmRingService`。

2. **系统确实发出了闹钟**（logcat）：
   ```
   21:51:47.032 V/AlarmManager: sending alarm Alarm{3ec2bdc … 
       component ComponentInfo{space.alliswell.inbox/…AlarmRingService} flags 0x9
   21:51:47.034 I/ActivityManager: Background started FGS: Allowed 
       [callingPackage: space.alliswell.inbox; uidState: NONE; code:SYSTEM_ALERT_WINDOW_PERMISSION;
        tempAllowListReason:<reasonCode:SYSTEM_ALLOW_LISTED>]      ← AOSP 层：批准
   ```

3. **被 ColorOS 拦截**（决定性）：
   ```
   21:51:47.035 I/OplusAppStartupManager: prevent start space.alliswell.inbox, 
       cmp {…/.AlarmRingService} by system[alarmManger]… Type ssfa, scenePriority 0
   21:51:47.035 W/OplusAppStartupManager: isAllowStartFromStartService: prevent start space.alliswell.inbox
   21:51:47.042 V/AlarmManager: sending alarm Alarm{2a2ea61 … component …AlarmTestReceiver}
   21:51:47.043 W/OplusAppStartupManager: prevent start …AlarmTestReceiver by broadcast system[alarmManger]
   ```
   ⇒ **服务路径（`AlarmRingService`）与广播路径（`AlarmTestReceiver`）两条都被否决**。
   触发后进程 `pid` 始终为空（从未被拉起）。

**有牙齿的对照组**（同闹钟路径、同屏幕状态，唯一变量 = 进程是否存活）

| 条件 | 进程 | `sending alarm` | `prevent start` | 结果 |
|---|---|---|---|---|
| 热 + 熄屏 | `12159` 存活 | 2 | **0** | ✅ 113 ms 投递成功 |
| 冷 + 熄屏 | 无进程 | 1 | **3** | ❌ 完全无投递 |

**排除项**：设备不处于 doze（`mState=ACTIVE`）；应用**在 deviceidle 白名单内**；
无 `STOPPED`/`SUSPENDED` 标记；`START_FOREGROUND`/`RUN_ANY_IN_BACKGROUND`/`BACKGROUND_START_ACTIVITY` 均为 `allow`。

**复现条件**

1. 设备：OPPO / ColorOS 16（Android 16），应用**未获「自启动 / 关联启动」授权**。
2. 应用进程已终止（本机只能用 `run-as <pkg> /system/bin/kill -9 <pid>` 达成 ——
   `am kill` 在该设备**无效**，pid 不变；`am force-stop` 会污染 `stopped=true`，禁用）。
3. 应用退到后台且**屏幕熄灭**。
4. 排一个精确闹钟（`setAlarmClock`，即重要档），到点观察。
5. 结果：`dumpsys alarm` 中该条目消失（被消费）、`pidof <pkg>` 始终为空、无任何投递。

**残余不确定性（须诚实标注）**
用于制造冷进程的是 `run-as kill -9`，系统日志把该次退出记为
`reason=2 (SIGNALED) … description=exit_self`，且 OPPO 在该时刻打过
`prevent restart service … scenePriority = -1`。因此**无法 100% 排除**「异常被杀」这一因素
与「任何冷进程」在 OPPO 策略中被区别对待。但旁证支持「与死法无关、与需不需要新建进程有关」：
每次 `kill -9` 之后用 `am start` 拉起主界面**均成功**，说明应用不在硬拉黑名单，被拦的只是**后台自启**。
同一 `prevent restart service … scenePriority = -1` 也在 OPPO 自家应用
（`com.oplus.pantanal.ums`、`com.heytap.pictorial`）上出现，非本应用特有。

**方向性建议（未实现，待裁决）**
- (a) 应用内做**自启动授权引导**（首次进入提醒用户到 ColorOS 设置开启「自启动/关联启动」）；
- (b) 评估不依赖「拉起进程」的兜底投递路径（例如由系统级 `fullScreenIntent` 通知独立承载首响）；
- (c) 至少在首页告知条上把这条**真实红线**暴露给用户（当前告知条未覆盖该场景）。
> 三者取舍需要裁决；按项目约定**裁决前不动代码**。

**处置进展（2026-09-19 晚）**
产品所有人已选定 **(a) 自启动授权引导**，并落成提案
[`../decisions/request-d70-cold-process-delivery-2026-09-19.md`](../decisions/request-d70-cold-process-delivery-2026-09-19.md)（**D70**，状态「待裁决」）。

该轮只读探测给出两个决定性结论，**修正了本节原先的三个候选的可行性判断**：

1. **自启动授权状态在应用内读不到** —— 三张 `settings` 表全量扫描（secure 720 / global 637 / system 834 行）
   **无任何相关键**；本包 54 条 appops **无对应 op**，且相关项（`RUN_ANY_IN_BACKGROUND` /
   `START_FOREGROUND` / `BACKGROUND_START_ACTIVITY` / `SYSTEM_ALERT_WINDOW`）**全部 `allow`**。
   ⇒ 无法做「状态告警」，`homeNoticeVerdict()` 的「只在能确证断链时出声」纪律使该形态从根上不成立。
2. **`lastAlarmDelivery` 检测不到本缺陷** —— 它的写入者是 `AlarmTestReceiver`，
   **正是被 ColorOS 拦掉的那个组件**；失败时它不执行，记录不会更新。

⇒ 唯一可用判定源是**跨进程事件特征**：`scheduled` 写于排程侧（`AlarmScheduler.java:129`）、
`received`/`delivered` 写于接收侧（`AlarmTestReceiver.java:129`）。
**P1 的代码级根因**也就此定位到 `lib/native-reminders.js:340`
（`if (rec && rec.state === "scheduled") continue;`）—— 冷进程被拦 ⇒ 永远无送达证据
⇒ 状态永远停在 `scheduled` ⇒ 每次对账都跳过 ⇒ **永不补投**（注释自己写着「无法判定是否送达」）。

---

### P2（验证脚本缺陷）F-03 误报：权限判定被「未安装的用户」覆盖

`scripts/device-verify.py` 报 `F-03 FAIL：POST_NOTIFICATIONS 未授予`。**独立复算证伪**：

```
@182  User 0:   installed=true   → POST_NOTIFICATIONS: granted=true, flags=[USER_SET|…]
@197  User 999: installed=false  → POST_NOTIFICATIONS: granted=false
```

`User 0`（机主，当前用户）**已授予**且带 `USER_SET`；`cmd appops get … POST_NOTIFICATION`
默认 `allow`；`pm list packages --user 999 <pkg>` **为空**（该包根本没装在 MultiApp 空间）。
脚本用「后者覆盖前者」的字典写法，被**未安装该包的 User 999** 覆盖 ⇒ 误报。
**同理 `SYSTEM_ALERT_WINDOW` 被判 `unknown`，实际 appops 为 `allow`。**
⇒ 修正方向：按 user 分组取值，只用当前用户 + `cmd appops` 作为权威源。

### P2（验证脚本缺陷）F-12 误判：断言「ID 集合完全相等」过于刚性

`F-12 FAIL` 的原始证据是 `persisted.has=true`、`restored.has=false`，看似存储失败，
但真正原因是运行期间**多出一个事项**导致「ID 集合完全相等」不成立 —— 而
`persisted=true` 恰好证明**跨重载持久化本身是成功的**。
更严重的是采样缺陷：脚本在触发后仅约 9 s 就取消排程，`never` 与 `delayed` 无法区分；
**本轮把观察窗拉到 45–60 s 后，`off` 模式的投递被证明其实是成功的**（首轮报 `False` 是 7.83 s 时延落在采样点之后的时序假阴性）。
⇒ 修正方向：断言改为「本次写入的项存在且内容一致 + 临时项已清理」，并用**累积台账**而非单点采样判定投递。

### P3（验证脚本归因粗糙）F-07 的 `frozen` 不属于本应用

`dumpsys alarm` 中的 frozen 相关项归属 **`com.oplus.athena`**（OPPO 自家自动冻结服务）：
```
RTC_WAKEUP #147: Alarm{e1450c4 … com.oplus.athena} action oplus.intent.action.AUTO_FROZEN_APPS
```
脚本把它当作本应用被冻结的提示，属归因错误。

### 待澄清（不可复现，不臆测根因）

首轮全量验证期间（21:29–21:35）观察到「一重载即自动归档一个重复序列父项」的一次性事件。
**复现实验给出干净否定**：A/B/C 三条路径（单纯重载 / 通知往返后重载 / 存储往返后重载）
各跑一次，探针项**只从 `waiting` 正常升为 `due`，从未被归档**；重载前后事项集合 35↔35 零差异。
原生动作队列 `pendingActions` 为空且 mtime 未变，DE 存储无副本 ⇒ **动作重放假设已被证据否定**。
**结论：不可复现的一次性事件，未定位根因，不作推测。** 若再次出现需现场取证。

---

## 五、覆盖范围与局限

**已覆盖**
- 通道：A-01…A-05（adb / 发现 / 授权 / 稳定性 ×3 / 身份与传输）、B-01…B-07（命令/时钟/文件/二进制/端口转发/日志/包管理往返）
- 功能：F-01…F-12（能力、安装版本、权限、后台策略、通知渠道 3/3、闹钟排程、进程、原生台账、Web `ready()`、业务逻辑、通知往返、存储往返）
- 交互：T-01…T-07（新增+持久化、完成+终态保护、延后、删除、ACK 周期新建实例、终态拒绝 ACK/稍后/完成）
- 投递：亮屏热进程、熄屏锁屏热进程、冷进程（+ 热对照 + 系统日志归因）

**未覆盖（NOT_PERFORMED，不签发 PASS）**
- 真实「用户从最近任务划掉应用」路径：`am kill` 无效、`kill -9` 非真实路径，本机无可信手段模拟。
- ColorOS「自启动/关联启动」授权的实际开关状态：厂商设置页无法从 adb 打开，未取得直接读值。
- 通知权限**被拒绝**时的降级路径：当前已授予，无法在不改动用户设置的前提下构造。
- 长期稳定性与「用户主动看 Future 的频率是否下降」：本文不涉及，需独立观察。

---

## 六、证据清单

| 目录（`docs/reviews/verification-runs/`） | 内容 |
|---|---|
| `20260919-oppo-connect-baseline/` | A/B 通道基线（A-01…B-07） |
| `20260919-oppo-current-build-full/` | F 全量功能验证（22 PASS / 1 WARN / 2 FAIL，FAIL 均为脚本缺陷） |
| `20260919-oppo-interaction/` | T-01…T-07 交互走查结果 |
| `20260919-oppo3-asleep/` | 熄屏锁屏投递（**PASS**，含 `shot_asleep_+3s/+8s.png` 现场截图） |
| `20260919-oppo3-bg/` | 亮屏他应用前台对照（PASS） |
| `20260919-oppo3-cold/` | 冷进程投递（**FAIL**） |
| `20260919-oppo-cold-diag/` | 冷进程专项诊断（`diag.json` 时间线 + `logcat-full.txt` 31867 行） |
| `20260919-oppo-warm-control/` | 热进程对照组（`prevent start` = 0） |
| `20260919-oppo-current-off/ -cold/ -other/` | 首轮矩阵（**判定为脚本采样假阴性，已被本轮取代**） |

**设备终态**：仍运行 `dd58144c…401a1f`（本次部署版本）；
用户数据未改动，测试事项 16 条已全部移除，剩余事项 30 条（`archived` 23 / `due` 2 / `waiting` 3 / `acknowledged` 2）。

---

## 七、待裁决事项（按项目约定，裁决前不动代码）

1. **P1 冷进程投递黑洞**：已选 (a) 自启动授权引导 → 建档为
   [`D70`](../decisions/request-d70-cold-process-delivery-2026-09-19.md)。
   **其后 D70 的两条前提经真机核验，均不成立**（见
   [`d70-prerequisites-verification`](../decisions/d70-prerequisites-verification-2026-09-19.md)）：
   - 提醒台账 `reminderEvents` **没有 `delivered` 写入者** ⇒「未送达」判定会系统性误报；
   - ColorOS 16 上自启动页**不可深链**，唯一可达页**已是最宽松设置**而拦截照旧 ⇒ 引导无有效目标。

   ⇒ 待裁决点已从 D70 的 Q1–Q4 **转为该核验文档 §4 的四个选项**（先做可达性实验 / 补送达证据 / 退回诚实告知 / 记为已知局限）。
2. **H-08 归因更正**：`SYSTEM_ALERT_WINDOW` 现已授予，旧归因不再成立 —— 是否正式撤销该条？
3. **验证脚本三处缺陷**（F-03 误报 / F-12 采样与断言 / F-07 归因）是否排期修复？
4. **`reminderEvents` 记不到送达**（D70 核验新发现）：今天无可见后果，但它让「这一条提醒到底有没有送到」**永远不可知**，
   也是任何「漏了要能说清」类能力的地基。是否作为独立工程债排期？
5. 裁决编号：本轮结论需在 `docs/decisions/` 建档（编号待分配，分配前须扫全仓 `docs/**.md` 实际占用）。
