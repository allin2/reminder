---
feature: release-gates
type: device-verification
status: verified
date: 2026-09-19
device: vivo V2238A (PD2238) · Android 16 (API 36)
decisions: D64 D65 D66 D67
relates: ../decisions/release-gates-2026-09-19.md
---

# D64–D67 上架门禁改造 · 真机验证记录

## 结论摘要

**D64 在「产物层」成立，且是本次唯一能给出硬证据的一项。**

| 待证事项 | 结论 | 证据强度 |
|---|---|---|
| 成品 APK 不再声明 `USE_EXACT_ALARM` | ✅ **成立** | **硬**（aapt2 读 APK 二进制清单） |
| 权限变更接收器已注册并能被系统唤起 | ✅ 成立 | 硬（系统广播表 + 端到端重排台账） |
| D65 投递时快照写入并回传 | ✅ 成立 | 硬（台账字段 + 回传 JSON） |
| D66 各排程路径带真实 `mode` | ✅ 成立 | 硬（台账三闹钟 `mode=alarmClock`） |
| **移除 `USE_EXACT_ALARM` 后本机是否降级** | ⚠️ **未降级**（见 §3，**与预期不同，如实记录**） | 硬（决定性探针） |

**两项必须说清的限制**：① 本机 ROM **不按 appop 判定** `canScheduleExactAlarms()`，
所以「用 `appops deny` 模拟未授权」这条路在本机不成立，D66 的**降级分支**因此**没有在本机被真正触发过**；
② 因此「Android 14 默认拒绝后是否优雅降级」在本机**仍是推断，不是实测**。

## 1. 环境

| 项 | 值 |
|---|---|
| 设备 | vivo V2238A（`10ACBF2D3D000RS`） |
| 系统 | **Android 16（API 36）**，ROM `PD2238_A_16.3.16.0.W10` |
| 构建 | `releases/安心收件箱-debug.apk`（2026-09-19 09:26，4,087,870 B） |
| 安装 | vivo 拦截弹窗 → 「已了解风险检测结果」→「继续安装」 |
| 基线权限态 | `POST_NOTIFICATIONS=granted`、`USE_FULL_SCREEN_INTENT=granted`、`SYSTEM_ALERT_WINDOW=ignore` |

## 2. 实测（逐条对应裁决）

### 2.1 `USE_EXACT_ALARM` 真的没了吗 —— 用 APK 回答，不用源码回答

这条单列，因为它是**本轮最重要的方法论修正**，且差点得出相反结论。

**失败的查法（文本检索）**：在 `android/app/build/intermediates/merged_manifests/debug/AndroidManifest.xml`
里 `grep USE_EXACT_ALARM` → **命中 3 次**，看上去像「D64 没生效」。

**真相**：AGP 会把**主清单里的注释块原样合并**进合并清单，命中的 3 行全是注释
（其中一行正是 D64 写下的「不再声明 `USE_EXACT_ALARM`」这句说明本身）。逐行核对后，
`uses-permission` 元素里**一条都没有**。

**权威查法（读二进制清单）**：

```bash
~/Library/Android/sdk/build-tools/34.0.0/aapt2 dump xmltree \
  --file AndroidManifest.xml "releases/安心收件箱-debug.apk" | grep -A1 uses-permission
```

注释被 AXML 编译器丢弃，结果是**干净的 12 条**，`USE_EXACT_ALARM` 不在其中：

```
DISABLE_KEYGUARD · FOREGROUND_SERVICE · FOREGROUND_SERVICE_MEDIA_PLAYBACK · INTERNET
POST_NOTIFICATIONS · RECEIVE_BOOT_COMPLETED · SCHEDULE_EXACT_ALARM · SYSTEM_ALERT_WINDOW
USE_FULL_SCREEN_INTENT · VIBRATE · WAKE_LOCK
space.alliswell.inbox.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION   ← Capacitor 注入
```

> **结论**：D64 在**产物层**成立。同时确立一条纪律：**核权限读 APK，不读源码/合并清单文本。**
> 已写入 [`docs/android-build.md`](../android-build.md) §3.2。

### 2.2 权限变更接收器：注册 + 真被唤起 + 真重排

- **注册**：`dumpsys` 系统广播表中可见 `android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`
  的新接收者（`ExactAlarmPermissionReceiver`）。
- **端到端**：**这条广播是受保护广播，第三方发不出来** ——
  `am broadcast … from uid=10190` 直接报
  `SecurityException: not allowed to send broadcast … from uid=10190`。
  因此改走**真实路径**：`appops set SCHEDULE_EXACT_ALARM allow` → **系统自行发出**该广播。
- **结果**（台账）：

```
exactAlarmPermissionChanged … rescheduling persisted alarms
  ├─ requested → scheduled   mode=alarmClock → unfreezerScheduled
  ├─ requested → scheduled   mode=alarmClock → unfreezerScheduled
  └─ requested → scheduled   mode=alarmClock → unfreezerScheduled
```

三个闹钟各自重排，且**记的是真实 `mode`**（同时验证了 D66 的「各路径带 mode」）。
接收器**没有把「收到广播」当成「已授权」**，而是自己实测
`canScheduleExactAlarms()` 后才重排 —— 这正是设计要点（广播只是触发时机）。

### 2.3 D66：静默降级被消掉

`AlarmScheduler.schedule` 三条路径都落一条带 `mode` 的台账；`scheduleUnfreezer` 的调用
**移出了精确排程的 try 块**。后者是关键：原实现一旦精确排程抛 `SecurityException`，
会连**解冻器都排不上**（而解冻器正是「响」的前提），整条链路静默失效且无痕。

### 2.4 D65：投递时快照

`lastAlarmDelivery` 回传新增 `exactAtDelivery` / `fsiAtDelivery`（投递**当时**的快照），
与既有的 `canDrawOverlays` / `canUseFullScreenIntent`（**活值**）并存，并在注释里标明
「**不要用活值解释历史投递**」—— 这与 H-08 的 `deliveryNotifyEnabled` 同构，
是本项目因「用现在的权限解释当时的结果」误诊过（D48）之后立的规矩。

## 3. ⚠️ 与预期不同：移除 `USE_EXACT_ALARM` 在本机**没有**造成降级

**预期的结果**是：移除后精确排程需用户授权，未授权时降级为非精确，可借此验证 D66 的降级分支。
**实测结果是**：本机**照旧精确**。过程与判据如下。

1. `appops set space.alliswell.inbox SCHEDULE_EXACT_ALARM deny` 之后，
   `diagnose().canExactAlarm` **仍为 `true`**；系统侧却确实记着
   `Last OP_SCHEDULE_EXACT_ALARM: u0a190:deny` —— 两者矛盾。
2. **决定性探针**（不读权限方法，直接看排程结果）：
   经 CDP 真实排一个闹钟（id `910001`），返回

```
{"ok":true,"exact":true,"alarmClock":true,"mode":"alarmClock"}
```

   ⇒ **该 vivo / Android 16 ROM 不按 appop 判定 `canScheduleExactAlarms()`**，
   本应用在该 ROM 上「无 `USE_EXACT_ALARM` 仍然精确」。

**因此**：

- ✅ 「移除 `USE_EXACT_ALARM` 不会让本机用户失去精确闹钟」—— 就本机而言，**已证**。
- ❌ 「Android 14 默认拒绝后优雅降级为非精确」—— 在本机**未被触发**，
  D66 的 `inexactNoPermission` 分支**仍是推断**。要实测它，需要一台**按标准 AOSP 行为判定**的
  设备（或把 targetSdk 提到 ≥33 的全新安装环境）。
- 记录方式：**如实写「未降级」，不编造降级已发生** —— 这正是 D58 那次教训
  （「凭印象下结论会把排查引向错误方向」）的正面应用。

## 4. 方法论坑（本轮新增两条）

1. **受保护广播无法用 `am broadcast` 模拟**（见 §2.2）。凡「官方说监听某广播」，
   先确认它是**受保护**的；是的话只能构造**真实业务路径**去触发它。
2. **残留响铃停不掉不是「停不了」，而是少传了 token**。
   `AlarmStopReceiver` 首行 `if (token == null) return;` —— 第一次停铃没带
   `--es alarmTraceToken` 就**静默返回**（又一次「安静地什么都不做」）。
   补上 token 后：音频活跃播放器 **1→0**、服务前台 **0**、振动 **IDLE**、
   台账 `deliveryStopped … ring service and fallback effects stopped`。
   **设备已还原干净**。

## 5. 未证 / 未做

| 项 | 状态 |
|---|---|
| D66 非精确降级分支在本机被真正触发 | ❌ 本机 ROM 不按 appop 判定 ⇒ 不可达 |
| `USE_FULL_SCREEN_INTENT` 的「清楚说明需求」文案 | ❌ 未审（官方政策要求，见裁决文档「已知缺口 3」） |
| 撤销精确闹钟权限的瞬间 | ❌ 接不住（官方只在**授予**时发广播）；靠排程前预检 + 开机重排兜底 |
| 降级后（非精确）如何主动告知用户 | ❌ 只在**投递时**归因，未在**排程时**提示 |

## 6. 证据可复现性

- 产物：`releases/安心收件箱-debug.apk`（09:26）
- 二进制清单：`aapt2 dump xmltree`（命令见 §2.1）
- 台账：`/data/data/space.alliswell.inbox/shared_prefs/{alarm_trace,attention_alarm}.xml`
- 测试水位（D64 落地后实测）：unit **249** · native **245** · smoke **204** · regressions **574** = **1272**，0 失败
- 反向验证：`node scripts/verification/reverse-check-d59.js` → **22/22**
- 设备已还原：通知权限 `granted`、`appop SCHEDULE_EXACT_ALARM` 回 `default`、无残留响铃、无遗留测试闹钟、端口转发已清

> 与之相邻的 D59 记录见 [`d59-alarm-carrier-device-verification-2026-09-19.md`](./d59-alarm-carrier-device-verification-2026-09-19.md)。
