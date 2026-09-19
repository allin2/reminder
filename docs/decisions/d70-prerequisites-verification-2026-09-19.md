---
doc: finding
topic: D70 两项前置核验结果 —— U2「送达证据」与 U3「引导落点」均不成立
date: 2026-09-19
status: 待复议（阻塞 D70 的 Q1 与 4-2/4-3，**代码未动**）
relates: ./request-d70-cold-process-delivery-2026-09-19.md（D70 提案）· ../reviews/oppo-current-build-live-verification-2026-09-19.md（P1 一手证据）· ../reviews/verification-runs/20260919-u2-delivered-writer/u2-live-proof.json · ../reviews/verification-runs/20260919-u3-autostart-landing/
device: OPPO PKC130 (Find X8 Pro) / Android 16 (API 36) / ColorOS 16.0.10.500(CN01)
---

# D70 前置核验：两条前提**都不成立**

> 背景：产品所有人 2026-09-19 对 P1 选定方案 ①（自启动授权引导），并按「Grilling 推荐」授权推进。
> 提案 §5 Q1 明确写了前置条件 ——「**但前提是先核验 `delivered` 的全部写入点**」；
> §6 U2 / U3 也各自标了「❌ 未验证 —— 实现前必须先核」。
>
> **本轮把两处都核了。结论是：两处都不成立。** 因此**未写任何生产代码**（遵守「未获明确裁决前不实现任何内容」）。

---

## 0. 一句话

| 前置 | 结果 | 对 D70 的后果 |
|---|---|---|
| **U2** `delivered` 写入点 | ❌ **`reminderEvents` 根本没有 `delivered` 写入者** | 4-1「未送达」判定会**系统性误报**，Q1=(a) 不能按原规格实现 |
| **U3** 引导落点 | ❌ ColorOS 16 上**无法深链到自启动页**；唯一可达页**已是最宽松** | 4-2/4-3 会把用户送到**没有那个开关**的页面，且「开了就能修好」**无法验证** |

---

## 1. U2：`reminderEvents` 永远不会变成 `delivered`

### 1.1 代码证据（三处，互相印证）

| # | 位置 | 事实 |
|---|---|---|
| 1 | `lib/native-reminders.js:1172` | 送达回调的过滤条件是 `extra.managedKind === MANAGED_KIND && **extra.event === "deadline"** && extra.stageKey` —— **只认截止事件**，提醒事件（`event = primary/realert`，带的是 `reminderKey` 而不是 `stageKey`）被显式排除 |
| 2 | `app-core.js:3843-3856` | 唯一的「送达」写入者是 `markDeadlineDelivered`，它写的是 `it.**deadlineEvents**[event.stageKey]` —— 截止台账，不是提醒台账 |
| 3 | 全仓检索 | 不存在任何写入 `reminderEvents[key] = { state: "delivered" }` 的代码；`app-core.js` 里 `reminderEvents` 的 `delivered` 只出现在**保留**分支（3798 / 3807 行），从未被**写入** |
| 4 | Java 侧 | `android/app/src/main/java/space/alliswell/inbox/**` 内**没有任何 `notifyListeners`** ⇒ 走闹钟通道的首次提醒（重要/关键档）**连一个 JS 回调都没有** |

三态里的 `delivered` 因此是**不可达状态**：提醒台账只可能是 `scheduled` 或 `cancelled`。

### 1.2 真机现场对照实验（自足、可复算）

路径：`../reviews/verification-runs/20260919-u2-delivered-writer/u2-live-proof.json`

造一条 `priority:"important"`（走闹钟通道）的提醒并让它真的响，然后同时读**原生台账**与**三态台账**：

```
原生台账（alarm_trace）：
  requested → unfreezerScheduled → scheduled → carrierRecorded
  → received(1789827936114) → environment(screenOn=true;locked=false;path=direct+banner)
  → ringServiceRequested → launchRequested → systemNotificationPosted → notifyReturned
  → created → focus=true → windowVisible(via=focus;focused=true;shown=true)
  → windowSample ×3(after=300ms/800ms/1500ms; shown=true)
  ⇒ received = True , windowVisible = True      ← 确凿送达

三态台账（item.reminderEvents）：
  "0@1789827936000": { state: "scheduled" }     ← 就是那条真正响过的
  "1@1789829736000": { state: "scheduled" }
  "2@1789831536000": { state: "scheduled" }
  "3@1789833336000": { state: "scheduled" }
```

**一边是「界面已可见」的原生铁证，一边是同一时刻的提醒台账仍写着「已排期」。**

### 1.3 这为什么是致命的

D70 §4-1 的判定条件是「台账里存在 `state === "scheduled"` 且触发点已过」⇒ 判为「未送达」。
既然**送达了也不会写 `delivered`**，这条判据会在**每一次成功提醒后都成立** ——
不是偶发误报，是**系统性误报**，命中率接近 100%。

这恰好违反 D70 自己用来支撑 Q3 的理由：*「误报会毁掉整条告警的可信度，代价比漏报贵」*。
按原规格实现 4-1，等于亲手制造它承诺要避免的那种**「界面在撒谎」**——
也就是 D68 / A-2 存在的全部理由。

---

## 2. U3：ColorOS 16 上「自启动」既深链不到，也不是那个开关

### 2.1 实测调用结果

真机从 CDP 调 `SystemBridge.openAutoStartSettings()`：

```json
{"ok": true, "result": {"ok": true, "component": "app-details"}}
```

落点 = `com.android.settings/.applications.InstalledAppDetails`（应用详情页）。
即：**10 个厂商候选中没有一个命中**，走的是兜底分支。

原因（`SystemBridgePlugin.java:1216-1227` 的候选表）：里面只有
`com.coloros.safecenter.*` / `com.oppo.safe.*`（旧 ColorOS）以及小米/华为/vivo/三星/乐视 —— **没有 ColorOS 16 的组件**。

### 2.2 ColorOS 16 的真实组件，以及为什么用不了

`dumpsys package com.oplus.battery` 找到真实组件，逐个实测启动：

| 组件 | 结果 |
|---|---|
| `com.oplus.battery/com.oplus.startupapp.view.StartupAppListActivity` | ❌ `SecurityException: ... requires oplus.permission.OPLUS_COMPONENT_SAFE` |
| `com.oplus.battery/com.oplus.startupapp.view.AssociateStartActivity` | ❌ 同上 |
| `com.oplus.battery/com.oplus.startupapp.view.OptimizationAutoStartActivity` | ❌ 同上 |
| `com.oplus.battery/com.oplus.startupapp.view.PreventRecordActivity` | ❌ 同上 |

该权限是 OPPO 平台签名级权限，**第三方应用不可能持有** ⇒
**在 ColorOS 16 上，「自启动 / 关联启动」页面在技术上不可能被本应用直接打开**（连 adb 都被拒）。

### 2.3 唯一可达的那一页，已经是最宽松状态

兜底落点「应用详情」里可达 `耗电管理` →
`com.oplus.battery/com.oplus.powermanager.fuelgaue.PowerControlActivity`：

```
耗电行为控制
  ● 完全允许后台行为        ← 当前已选中（截图 confirmed）
  ○ 智能优化后台运行（推荐）
  ○ 限制后台运行
```

截图：`../reviews/verification-runs/20260919-u3-autostart-landing/landing-power-manage.png`

**而它已经是「完全允许后台行为」了，冷进程投递照样被 `OplusAppStartupManager: prevent start` 拦掉。**

另有观察（未断言因果）：应用详情页 **「管理闲置应用」当前为开启**。

### 2.4 这为什么是致命的

4-2 的设计前提是「**存在一个用户做得到、且做了就能修好的动作**」。
现在：**这个动作在哪一页都不知道**，而唯一能带用户到达的那一页已经是最宽松设置。

此时若照原规格上线引导，会发生两件坏事：
1. 用户被送到一个**没有那个开关**的页面，无从下手；
2. 引导词暗示「照做就能修好」，而**我们从未验证过任何动作能修好** —— 这正是
   D70 §6 想避免、但 §4-2 的原规格会实际制造的**虚假安全感**；
   也是我在方案对比里提示过的「我明明按它说的开过了，还是没用」。

---

## 3. 对 D70 原案 Q1–Q4 的重新判定

| 原判 | 原推荐 | 复核后状态 |
|---|---|---|
| **Q1** 要不要引入「未送达」判定 | (a) 引入 | ⛔ **前提不成立**。引入前必须先补「送达证据」（见 §4 选项 2）。**不是能不能做的问题，是数据不存在** |
| **Q2** 首用引导时机（新建第一个重要档事项时） | (a) | ⚠️ **建议不变**，但它引导去哪里（§4-3）失去了目标 |
| **Q3** 宽限期取值（以「回到 App」为观察点） | (c) | ⚠️ **建议不变**，但它服务的 4-1 暂时无法落地 |
| **Q4** 判定后是否补投 | (a) 只告知 | ⚠️ **建议不变**（且 4-1 未落地前此问为空转） |

即：**Q2 / Q3 / Q4 的判断本身没被推翻，被推翻的是它们共同依附的「能判定 + 能修好」这两个支点。**

---

## 4. 需要裁决：往下走哪条

**选项 1（推荐）· 先做「目标可达性」实验，再决定建不建引导**

① 的成立与否，取决于「**有没有一个用户做得到、且真能恢复冷进程投递的动作**」。这是可实验的，
三个候选动作、都在手机上、都可逆：

| # | 候选动作 | 当前状态 | 谁能做 |
|---|---|---|---|
| a | 关闭应用详情页的 **「管理闲置应用」** | **开** | 我可代做（改系统设置，**需你授权**） |
| b | 打开 ColorOS 的 **「自启动 / 关联启动」白名单** | 未知 | **只能你手动**（`手机管家` 或 `设置` 里找，不可深链） |
| c | 最近任务卡片 **上锁** | — | 只能你手动 |

做完任一项，我用**同一条冷进程注入路径**（`run-as <pkg> /system/bin/kill -9` + 真实 `setAlarmClock`）重跑，
看是否从「拦截」变成「投递成功」。
**只有找到能修好的动作，4-2/4-3 才有意义**；找不到，① 就应当放弃。

> 代价：a 会改你的手机设置（可改回）；b/c 需要你在手机上动几下。

**选项 2 · 补「送达证据」，让 4-1 第一次具备真实依据**

要做 4-1，必须先让提醒台账真的能记到送达。两处改动：

- **JS（小）**：`native-reminders.js:1172` 的送达回调增加「提醒」分支（现在只认 `deadline`）；
- **原生（中）**：闹钟通道把 `reminderKey` 记进持久投递台账。
  现成基础是 `ActiveAlarmStore`（已存 `{id, token, itemId, itemRev, title, body, receivedAt}`，**device-protected**，
  且 `AlarmTestReceiver.java:194` 在**真实送达时**写入）—— 缺 `reminderKey`，且 6h 过期对「次日回来看」太短，需要延长。
  再由 `status`（`applyReminderEvents` 已有回流通道）合并进台账。

> 代价：**动原生投递路径**。这与 D70 §7「改动面是纯 Web 层」的预估不符 ——
> 所以这一项必须单独裁决，我不擅自扩围。

**选项 3 · 退回「诚实告知」（原方案 ③），不承诺可修**

不做引导（目标不可达、有效性未证），只把「这一档在部分手机上被系统限制后**可能不响**」
如实写进首页告知条 / 排程时刻提示。零误报、零原生改动，符合 A-2 纪律。
代价：用户知道会漏，但**什么也做不了** —— 面对 D25/A-01 已作出的「重要档=闹钟级」承诺，这需要你确认是否接受。

**选项 4 · 维持现状，把 P1 记为已知局限**

不做任何界面改动。U5 本就承认「真实『划掉应用』路径的命中率未知」——
注意本机 `kill -9` 并非真实路径，且本机设置已是最宽松，**真实用户命中率仍属未知**。

### 我的推荐

**先做选项 1（成本低、且是其他一切的前提）。**
- 若找到可行动作 → 按它做 4-2/4-3，并在引导里只承诺「去这一页开这个开关」，不承诺更多；
- 若三个动作全无效 → 走选项 3，并把「重要档=闹钟级」这个承诺是否要收回（或加上前置条件）单独裁决；
- 选项 2 是独立的工程债：**无论选哪条**，`reminderEvents` 记不到送达本身都是缺陷（今天无可见后果，但它让「是否漏了」永远不可知），建议单独排期。

---

## 5. 本轮纪律声明

- **未改任何生产代码**，未 rebuild，未签发任何 PASS。
- **未改动设备任何设置**。仅导航过设置页面（应用详情 / 耗电管理 / 尝试自启动页），
  结束时已回桌面；测试事项 `u2proof_*` 已归档清理。
- **未断言因果**：`OplusAppStartupManager prevent start` 是当前**已知最可能**的拦截者，
  但「哪个用户开关能撤销它」**尚未验证**。
- 一个**反直觉的既有事实**一并记录：**唯一可达的最深设置已是「完全允许后台行为」，拦截仍然发生** ——
  这说明「自启动」很可能不是「耗电行为控制」这一族开关，但具体归属**未验证**。

## 6. 证据索引

| 内容 | 路径 |
|---|---|
| U2 现场对照实验原始数据 | `../reviews/verification-runs/20260919-u2-delivered-writer/u2-live-proof.json` |
| U3 落点截图（应用详情 / 耗电管理 / 自启动列表尝试） | `../reviews/verification-runs/20260919-u3-autostart-landing/` |
| P1 一手证据（含热/冷对照组） | `../reviews/oppo-current-build-live-verification-2026-09-19.md` |
| D70 原提案 | `./request-d70-cold-process-delivery-2026-09-19.md` |
