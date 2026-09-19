---
doc: decisions
topic: 闹钟档交付载体（H-08 机制性修复）
date: 2026-09-19
decided_by: 产品所有人
baseline: Attention_Inbox_V0.2_产品需求与业务规格基线.md + A-01
proposal: 无（本次不修订冻结基线）
spec: ../compose/spec/android-alarm-carrier.md
---

# 裁决 · 闹钟档交付载体（D58–D61）

> **来源**：H-08（无通知权限 + 息屏 = 闹钟完全静默）。
> **裁决方式**：产品所有人 2026-09-19 分三步给出方向 ——
> ① 在机制修复的 A/B/C 三个选项中选 **B（换投递机制）**；
> ② 追加口径「**借鉴成熟开源相关实现方案**」「**不光开源方案，还有一些成熟的提醒类产品，
> 这个响铃逻辑不是我们产品独特的地方，不需要有自己单独的逻辑**」；
> ③ 在收到「两档各照搬一套」的方案后给出「**我们不是也有闹钟提醒，也有日常的这种弹窗提醒吗**」，
> 最后对唯一前置项（推翻 F2）回复「**确认**」。
>
> **结论先行：本次裁决不修订冻结基线。** 它只把「闹钟档怎么把用户叫醒」这一实现层的载体选择
> 收敛到行业事实标准上，不改动 PRD 的任何产品语义 —— 因此 `V0.2-amendments.md` **不新增条目**，
> 也不新增变更提案（CP 只用于基线修订）。

## ⚠️ 编号说明

分配前已按 [`import-export-ruling-2026-09-18.md`](./import-export-ruling-2026-09-18.md) 记下的教训，
先扫描 `docs/**.md` 的**实际占用**（而非照记忆推）：

```
max = 57（D49–D54 = 导入/导出裁决；D55–D57 = 其实现期推定）
```

**本裁决自 D58 起编号。** 同一扫描确认 `docs/` 内不存在 D58 及以上的占用。

## 裁决表

| # | 问题 | 裁决 | 依据 |
|---|---|---|---|
| **D58** | **更正 D48 的归因** | 旧归因中「应用 post 高优先级通知换来 `NOTIFICATION_SERVICE` BAL 豁免」与「`setAlarmClock` 触发时系统放开 BAL」**两条均无文档支持，予以撤回**。官方 BAL 豁免清单为：可见窗口 / IME / **系统发送的 PendingIntent** / **SYSTEM_ALERT_WINDOW** / `START_ACTIVITIES_FROM_BACKGROUND` / 被已获权服务绑定 / launcher；**不含「发通知」，也不含「前台服务」**。`setAlarmClock` 官方给的豁免是**可后台启动前台服务**（"exact alarms aren't affected by foreground service launch restrictions"），不是 BAL | [secure-bal](https://developer.android.com/guide/components/activities/secure-bal) · [AlarmManager#setAlarmClock](https://developer.android.com/reference/android/app/AlarmManager) · 反例见下 |
| **D59** | **推翻 F2：闹钟档的声音与振动** | **所有权从通知收回应用**。闹钟档的声音由应用自播（`Ringtone`/`MediaPlayer` + `AudioAttributes.USAGE_ALARM` + `CONTENT_TYPE_SONIFICATION`，走 `STREAM_ALARM`），振动由应用自调 `Vibrator`。通知在闹钟档退化为**副产物**（台账 + 停止入口），**不再是声振载体**。F2 当年以「抗进程死亡」为理由把声音交给系统，代价正是「无通知权限 = 全静默」；该收益已由前台服务承接 | AOSP DeskClock `AlarmKlaxon` 自播、通知仅 `DEFAULT_LIGHTS`；TickTick「闹钟提醒」、Todoist「Urgent」、三星提醒「Strong」同构 |
| **D60** | **两档内部自洽（禁止档内混用）** | 判据是**每档内部必须整档照搬同一套成熟做法**，不是「全产品只能有一套」。**闹钟档**（关键/重要首次，含 `delivery_mode=alarm`）→ 完整**时钟套**；**提醒档**（普通档 + 全部后续补充轮次）→ 完整**提醒套**（现状已自洽，不改）。**禁止任何一档内部借另一套的部件** —— 现状正是「借时钟套的 FSI 亮屏 + 用提醒套的通知播声振」，这是 H-08 的直接成因 | [S2.1] 档位路由（D9 / D25 / A-01）· 用户口径「不需要有自己单独的逻辑」· 行业核证见下 |
| **D61** | **权限降级矩阵重写** | 取代 [`android-fullscreen-alarm.md`](../compose/spec/android-fullscreen-alarm.md) [S2.5] 中「无 `POST_NOTIFICATIONS` → 退回应用内提醒，不弹全屏」这一行。新规则：**无通知权限时闹钟档仍必须响铃 + 振动**（这是 D59 的直接后果，也是本次修复的目标）；屏幕/界面转为尽力而为；通知据实缺失，但**不得阻塞声振** | D59 · 平台事实：FGS 不需 `POST_NOTIFICATIONS`（"Apps don't need to request the POST_NOTIFICATIONS permission in order to launch a foreground service."） |

### 支撑裁决的三组外部事实

1. **行业收敛成两套，我们是缝合的第三种。**
   - **时钟类**（AOSP DeskClock / Google Clock / Alarmio / BlackyHawky / Fossify Clock）：自播音频 + 自调振动 + 全屏 Activity，通知仅副产物 → **无通知权限仍响**；且**几乎不含 signature 权限，三方完全可抄**。
   - **提醒类**（Tasks.org / Loop Habit / TickTick / Todoist / Microsoft To Do）：声振均走通知渠道 → **无权限即不响**，靠强引导，并把该取舍公开写进帮助文档。
   - **我们**：声音借通知播（提醒类做法）+ 亮屏借 FSI（时钟类做法）→ 权限一拒**三件同时归零**。
2. **「同产品内两档两套机制」是行业通行做法**：TickTick「闹钟提醒 / 通知提醒」、Todoist「普通 / Urgent（全屏闹钟破静音·DND）」、三星提醒「Light / Medium / Strong」。技术分水岭是 `setAlarmClock`（平台默认破 DND + 全屏 + 长鸣至确认）。
   **反证**：Google Calendar、Microsoft To Do、Notion 只做单档通知型 —— 故两档**非强制**，但只要产品同时提供闹钟与日常提醒，头部做法都是两档各照搬一套。
3. **我们已站在分水岭的闹钟一侧**：排程层早已用 `AlarmManager.setAlarmClock`（`SystemBridgePlugin.java:614`）。**本次是补完交付层，不是更换架构** —— 这也是 D58 那条错误注释能长期存在的原因：排程确实「能用」，只是交付没走完。

### 为什么旧归因必须撤回（它曾把排查引向错误方向）

真机 7 轮受控投递中，**「无通知权限 + 亮屏」成功 1/1**，且该轮经复核确认 App **确为后台**
（MainActivity `visible=false` / `state=STOPPED` / `lastVisibleTime` 早投递约 43 秒）。
同一权限态下息屏 0/4 而亮屏 1/1 —— 「通知权限 ⇒ BAL 豁免」**无法解释**该差异。
另有第 1、6 轮台账不含 `launchLikelyBlocked`，按 `AlarmTestReceiver.java:148-153` 反推
**当时「显示在其他应用上层」疑为已授予却仍被拦**。
因此旧归因既**无文档支持**，也与真机数据**不自洽**，仅保留「结构性缺陷是通知成为三合一单点」这一条（见 D59）。

## 实现期推定（D62–D63，未经单独裁决）

以下两条是实现中为避免「文档没写、代码各写各的」而做的细化推定，
**属 D59 的直接推论**。如与预期不符请指出。

| # | 推定 | 为什么必须现在定 |
|---|---|---|
| **D62** | **铃声单一声源 = 原生独占**。闹钟档响铃期间，WebView（`AlarmActivity` 内）**不得**再播音频；JS 侧只保留状态显示与动作提交。现有的「谁拥有声音」判定（`notificationOwnsSound()`）改写为「原生前台服务拥有声音」 | 双声源正是 V3 那次「两路同时拉起 → 响铃被打断重启（`effectsStopped` → `audioStarted` → `duplicateIntent`）」的成因。D59 把声音交给原生后，若 JS 继续播，会原样复现该缺陷 |
| **D63** | **停声入口按权限分叉**：有通知权限 → 通知的「停止声振」动作（现有 `AlarmStopReceiver`）；无通知权限 → **只能通过全屏界面内的按钮停**。若界面在无权限下也拉不起来，则以 `ActiveAlarmStore.MAX_AGE_MS` 兜底（维持 6h，D45 不变的既有裁决） | 现状停止入口只挂在通知上，D59 之后通知不再是载体；不把这条写死，就会出现「一直在响却关不掉」 |

## 待裁决（登记，不编号）

> **本节已于 2026-09-19 结清**（见「落地与真机验证」）。下表保留原始登记以留痕，
> 「现状」列已更新为结清结果；裁决详情见 [`release-gates-2026-09-19.md`](./release-gates-2026-09-19.md)。

| 事项 | 原状态 | 结清结果（2026-09-19） |
|---|---|---|
| **真机复验** | `NOT_PERFORMED` | ✅ **已完成**。D59 的「无通知权限仍响」在 vivo V2238A（Android 16）上确认成立；见 [`d59-alarm-carrier-device-verification-2026-09-19.md`](../reviews/d59-alarm-carrier-device-verification-2026-09-19.md) |
| **`USE_EXACT_ALARM` 上架资格** | 待裁决 | ✅ **已裁决 = D64**：不满足资格 ⇒ **从清单移除**，只留 `SCHEDULE_EXACT_ALARM`，并补齐官方迁移四步。**产物层已实测**（aapt2 读 APK 二进制清单，12 条权限不含它） |
| **A14+ `USE_FULL_SCREEN_INTENT` 检测与引导** | 待裁决 | ✅ **已结清，且更正**：**该门禁的检测 + 归因 + 引导三件早在 Q3-a/Q3-b 轮次就已交付** —— 本行原写「当前代码完全未处理」**是错的**（我照记忆推的，没回读代码）。详见 [`release-gates-2026-09-19.md`](./release-gates-2026-09-19.md) 开头的事实更正。**遗留一项**：官方要求的「清楚说明需求」文案未审 |
| **`FOREGROUND_SERVICE_MEDIA_PLAYBACK` 与 FGS 类型** | 随规格一并确认 | ✅ **已落地**（D59/T1）：`foregroundServiceType="mediaPlayback"` + 对应权限，真机确认 `types=0x00000002` |

## 对规格与提案的影响

| 文件 | 变更 |
|---|---|
| [`android-alarm-carrier.md`](../compose/spec/android-alarm-carrier.md) | **新建**；`status: decided`，承载 D58–D61 |
| [`android-fullscreen-alarm.md`](../compose/spec/android-fullscreen-alarm.md) | `decisions` 追加 D58–D61；[S2.1] 补「D25/A-01 已扩展至重要档」的过期说明；[S2.5] 交由新规格取代 |
| `change-proposals.md` | **无变更**（不修订基线，不新增 CP） |
| `V0.2-amendments.md` | **无变更**（本次不修订基线） |

---

## 落地与真机验证（2026-09-19）

用户裁定「开始落地并连接真机」后，T1–T9 全部落地。

| 项 | 状态 |
|---|---|
| T1–T8 代码与断言 | ✅ 完成（native 断言 210→234，新增反向验证脚本 10/10） |
| T9 真机验证 | ✅ 已在 vivo V2238A（**Android 16 / API 36**）执行 |

### 真机结果

- **D59 的核心承诺成立**：无通知权限 + 息屏下
  `AudioPlaybackConfiguration … uid:10190 state:started usage=USAGE_ALARM` **持续 3 分钟以上**，
  振动按波形 `{0,800,400,800,600}` 周期持续。对照旧实现同场景 **0/4**。
- **D61 的降级矩阵成立**：`ringStarted sound=true;vibrate=true` 与 `screenCarrierMissing`
  出现在**同一条链路**里 —— 「屏幕没有载体」不再被读成「整个闹钟哑了」。
- **T6 停铃闭环成立**：走真实 `AlarmStopReceiver`（等价于点通知的「停止声振」），
  音频活跃播放器 1→0、服务前台 0、振动 IDLE。

### 真机坐实了 D63 接受的那条风险

**界面/屏幕仍然拉不起来**：`dumpsys activity activities | grep AlarmActivity` = **0**、
屏幕全程 `Asleep`、台账 `launchLikelyBlocked (no SYSTEM_ALERT_WINDOW)`。

即：**「响」修好了，但无通知权限时用户面对的是「只闻其声、不见其屏、通知栏也没有」**，
唯一停止入口是解锁打开 App，否则响到 `MAX_AGE_MS`（6h）。

D63 当时把这个当作**可接受**的取舍。真机确认它**确实会发生**，且不是 D59 的回归 ——
界面卡在 BAL，而 BAL 与通知权限无关，是另一个坑。**是否仍接受该取舍，需要一次新的裁决。**
候选方向见规格「已知缺口 2」：(a) 引导 `SYSTEM_ALERT_WINDOW`、(b) 响铃期间持续重试拉起界面、
(c) 补充其他停止入口。**在裁决前不动代码。**

> **2026-09-19 更新**：已按产品所有人指示「给界面那一格出提案」，
> 出为独立提案 [`ui-reachability-proposal-2026-09-19.md`](./ui-reachability-proposal-2026-09-19.md)
> （含 BAL 官方例外逐条对照、四个候选的利弊、推荐组合、以及需回答的 Q1–Q6）。
> **仍处「未裁决」**，代码未动。该提案同时更正了本仓一处错误注释（见提案 §1.2）。

### 新登记（非本次修复引入，但同一类失效形态）

`AudioHardening background playback would be muted for space.alliswell.inbox, level: full`
（Android 15+ 后台音频硬化）。实测**未真的静音**（`state:started`、`mutedState:streamVolume`、
`STREAM_ALARM Muted: false`），推测由 `mediaPlayback` 前台服务豁免（**推断，未证**）。

之所以登记：这是「应用自播」这条路上第一次出现系统级告警，而它的失效形态会与 H-08
**完全一样** —— 安静地不响，没有任何错误。**需要一条能在真机上读到它的检查。**

### 另附两条事实更正

1. 真机是 **Android 16（API 36）**，`PD2238_A_16.3.16.0.W10`。此前记的「OriginOS 16」是
   **ROM 版本号**，被当成了 Android 版本 —— 会影响「A15/A16 新限制适不适用」的判断。
2. `SYSTEM_ALERT_WINDOW` 实测为 **`ignore`（关闭）**。此前复核中「第 1/6 轮 overlay 疑为开」的
   推测**不成立**：本轮三次投递的 `deliveryOverlay` 全为 `false`。
