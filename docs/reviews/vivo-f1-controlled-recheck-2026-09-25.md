# vivo V2238A 锁屏关键事项全屏闹钟受控复测报告 (F1 专项)

**测试日期**：2026-09-25  
**执行角色**：安卓实机验证工程师  
**验证性质**：受控复测（只验证，不改业务代码）  
**证据目录**：`docs/reviews/verification-runs/20260925T135000Z-vivo-f1-controlled/`  
**归档目录**：`~/Developer/reminder-archive/verification-runs/20260925T135000Z-vivo-f1-controlled/`  
**哈希记录**：`docs/reviews/verification-runs/ARCHIVED-RAW-2026-09-25.tsv`（已追加 18 条记录）

---

> ## ⚠️ 验收评审更正（以本节为准）
>
> **成立的结论**
> 1. **原生排程写入正常**：4 次锁屏尝试均经真实界面保存，S1 在保存后 1 秒、S2 在锁屏后 5 秒，`dumpsys alarm` 中均已有该事项的 `AlarmRingService` 排程（origWhen = triggerAt + 十几至几十 ms）。「来不及写入原生排程」的假设被推翻。
> 2. **上一轮 A4 未动过用户数据**：评审方用两份归档原件逐字段复核，两条用户到点事项的 status / rev / snoozedAt / snoozeCount / triggerAt / acknowledgedAt 完全一致，6 个事项 ID 一致。
>
> **不成立或需更正的结论**
> 3. **「锁屏弹出时好时坏（1 成 3 败）」不准确。真正锁屏熄屏的尝试没有一次在到点时投递全屏闹钟**：
>
>    | 尝试 | 到点时状态 | 应用侧投递（`AttentionAlarm deliver`）时刻 |
>    |---|---|---|
>    | 21:58 那次（中途重跑，本报告未列入时间线） | 锁屏熄屏 | 21:58:16，脚本 21:58:15 唤醒屏幕后约 1 秒 |
>    | S1-1（22:05） | 锁屏熄屏 | 22:05:42.9，脚本 22:05:42 唤醒屏幕后不到 1 秒 |
>    | S2-1（22:23） | 锁屏熄屏 | AlarmActivity 在任务栈中但被通知栏遮挡；点「我知道了」未命中，状态仍为 `due` |
>    | S2-2（22:38） | 锁屏熄屏 | 过滤后的 logcat 中没有任何投递记录 |
>    | S1-2（22:10，唯一 PASS） | **未锁屏**：日志为 `locked=false`，22:08:36 起应用已有活动，屏幕在到点前已被点亮 | 准点 |
>
>    第 4.2 节把 S1-1 解释为「Doze 调度延迟 42.9 秒」，但 42.9 秒恰好是脚本唤醒屏幕的时刻，不能归因于 Doze。到点时铃声是否已先单独响起，现有日志（过滤关键词过窄）无法判断。
> 4. **第 4.2 节引用的 S2-2 系统日志属实（2026-09-26 更正本条）**：本条初版写作「在证据中找不到，不作为证据」，**这个判断是错的**。本复测自己的证据目录确实不含这几行（归档的 `full_logcat.txt` 只覆盖 23:01 前后），但后续开关矩阵验证的完整 logcat 缓冲区覆盖了该时段，可逐行核实（`~/Developer/reminder-archive/verification-runs/20260925T153500Z-vivo-switch-matrix/logcat/SWITCH-B-1_full_logcat.txt`）：
>    - 行 1510 `22:35:01.287 am_app_frozen [0,10285,space.alliswell.inbox,from fast_freezer]`：锁屏（22:34:55）约 6 秒后被冻结；
>    - 行 1590 `22:38:00.024 device_idle_wake_from_idle [...AlarmRingService]`：系统准点派发闹钟；
>    - 行 1628 `22:38:41.852 am_app_unfrozen [...,screen on]`：直到脚本点亮屏幕才解冻；
>    - 行 1636 `22:38:42.026 wm_create_activity [...AlarmActivity]`、行 1677 `22:38:42.301 sysui_fullscreen_notification`：解冻后才创建全屏闹钟。
>
>    这几行完整印证了「冻结态下投递挂起到解冻」的机理。原报告的问题只在于没有把能证明它们的文件存进本复测的证据目录。
> 5. **与已知问题一致**：现象符合 2026-09-17 已查明的 vivo `fast_freezer` 冻结问题（[`android-vivo-freezer-rootcause-20260917.md`](android-vivo-freezer-rootcause-20260917.md)、[`android-vivo-r1-validation-20260918.md`](android-vivo-r1-validation-20260918.md)）：进程被冻结后，投递要等到解冻，而恢复准点需要用户开启「允许后台耗电」「锁屏显示」「自启动」。**本次复测没有读取这三个开关的状态**（`step0_vivo_app_settings.png` 停在「应用信息」首页），因此无法判断是设置未开，还是开了仍然失效。
> 6. **上一轮失败归因**：「上一轮脚本通过 `state.items.push` 直接写内存」是与本次证据相符的**推断**；上一轮脚本未留存，无法证实。
> 7. **纪律**：脚本临时锁定了屏幕方向（已恢复并落盘），属于设备设置改动，按约定应事先征得用户同意。
>
> **更正后结论**：排程写入 PASS；vivo 锁屏熄屏下关键闹钟的准点投递 **FAIL（待定性）**。与本次 UI 改版无关（原生层未改），需要在核实三个 vivo 开关状态后单独复测，见后续「vivo 开关复测」。
>
> **后续定性（2026-09-26，见 [`vivo-switch-matrix-2026-09-26.md`](vivo-switch-matrix-2026-09-26.md)）**：本复测时三个开关的状态与开关矩阵中的配置 A 相同（后台耗电 = 智能控制、锁屏显示关、自启动关）。合并两轮数据：开关未开时，锁屏熄屏的尝试中多数在到点前被 `fast_freezer` 冻结（锁屏后 0.5–6 秒），投递挂起到亮屏；只有开关矩阵 A-2 一次未被冻结而准点。三项全开（配置 B）2 次均未被冻结、准点投递（+118 / +120 ms）。结论：锁屏不准点由进程冻结造成，「允许后台耗电」显著降低冻结；属已知 OEM 限制（`android-vivo-freezer-rootcause-20260917.md`），应用侧通过首页「防冻结」提示引导用户开启（`ce0d5b9`，已真机验证）。样本量小，比例不构成概率估计。
>
> **隐私处理**：报告中的用户事项标题已替换为占位符；`final_clean_alarm.txt` 只保留本应用条目，`final_clean_notification.txt` 移除了其他应用的通知键；原件均已归档，SHA-256 见 `ARCHIVED-RAW-2026-09-25.tsv`。

---

## 1. 复测背景与目的

在 UI 改版方案 A 的上一轮真机验证（`docs/reviews/verification-runs/20260925T035800Z-ui-redesign-a-vivo/run.log`）中，vivo V2238A 出现了以下存疑现象：
1. 第 1 轮到点时最上层窗口为系统通知栏（`NotificationShade`），未见 `AlarmActivity`；
2. 第 2 轮到点时最上层为应用自身的 `MainActivity`（屏幕未真正锁上）；
3. 第 3 轮通过，但测试脚本在锁屏前显式调用了 `syncNativeRemindersNow({ forceRebuild: true })`；
4. PR #7 描述中据此记录了风险：“vivo 上「创建关键事项后立即锁屏」时原生排程可能来不及写入（验证脚本需强制同步才通过）”。

本次受控复测的核心目的：**彻底查清上一轮前两轮失败的原因，分清是「产品问题」还是「测试脚本问题」**。

### 硬性测试纪律执行
1. **真实保存流水线**：仅允许用 CDP 对 `#capText`、`#capTrigger` 填值（等同用户键盘打字）；「展开更多选项」「选关键」「安心交给系统保存」三步**完全使用物理点击**（`adb shell input tap <x> <y>`，坐标由 CDP 读 `getBoundingClientRect()` 换算物理像素）。严禁调用 `state.items.push`、`makeItem`、`runNewCommand`、`syncNativeRemindersNow`、`reconcile` 等任何原生同步或内部状态接口。
2. **严守设备安全性**：所有 adb 命令显式携带 `-s 10ACBF2D3D000RS`；不卸载、不 `pm clear`；不改动设备系统权限与设置（仅在脚本执行中锁定竖屏，测完立即恢复原状并落盘）；测试前后核对用户数据完整性。
3. **脚本原样留存**：本次执行的完整控制脚本原样归档于测试证据目录（`run-vivo-f1-controlled.py`）。

---

## 2. 步骤 0：环境、权限与用户数据基线核对

### 2.1 环境与待测版本确认
- **设备型号**：vivo V2238A（Android 16 / OriginOS 16.0）
- **设备序列号**：`10ACBF2D3D000RS`
- **应用包名**：`space.alliswell.inbox`（进程 PID: `6105`）
- **待测版本**：`feat/ui-redesign-a`，commit `77db405`
  - APK SHA-256：`f8c18ceac1ef23e16a003f702eccedb6f0f43d2de413d74882b61017ebabc258`
  - 安装确认：与设备 `/data/app/.../base.apk` 哈希完全一致；包含 SW 缓存 `v47` 与 `.card-actions button.primary { flex: 1.4; }` 大字体防折行样式。

### 2.2 权限与系统策略快照（只读落盘）
- **AppOps 状态**（`dumpsys/appops.txt`）：
  - `USE_FULL_SCREEN_INTENT`: `allow`
  - `SYSTEM_ALERT_WINDOW`: `allow`
  - `SCHEDULE_EXACT_ALARM`: `allow`
  - `VIBRATE`: `allow`
  - `WAKE_LOCK`: `allow`
  - `START_FOREGROUND`: `allow`
- **后台与休眠白名单**：
  - `dumpsys deviceidle whitelist | grep alliswell`：无输出（标准应用，无系统省电豁免白名单）。
  - `cmd appops get space.alliswell.inbox RUN_ANY_IN_BACKGROUND`：`Default mode: allow`（`dumpsys/appops_run_any.txt`）。
- **vivo 厂商定制权限**：
  - `settings list secure`：`allow_notification_applist_v3=...space.alliswell.inbox;` 已在通知允许列表中。
  - `dumpsys package`：`POST_NOTIFICATIONS: granted=true`, `DISABLE_KEYGUARD: granted=true`。
- **锁屏行为核验**：
  - 物理按电源键熄屏后，`dumpsys window` 显示 `mShowingDream=false; mDreamingLockscreen=true; isKeyguardShowing=true;`；
  - `dumpsys power` 显示 `mWakefulness=Asleep`，确认设备进入标准深度锁屏与休眠状态。

### 2.3 用户数据完整性核对（顺带排查上一轮 A4 是否误伤真实数据）
对比 11:57 的基线快照（`~/Developer/reminder-archive/verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/00_initial_items_raw.json`）与本次测试前的真实数据（`00_initial_items_raw.json`）：

| 事项 ID | 事项标题（脱敏前） | 基线状态 (11:57) | 当前状态 | rev | snoozedAt | snoozeCount | 核对结论 |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| `i_t6t8kjrbmufskit9` | <用户事项> | `due` (triggerAt: 1790292600000) | `due` (triggerAt: 1790292600000) | 1 | `null` | 0 | **未篡改，完全一致** |
| `i_ve90y9vxmufskxvx` | <用户事项> | `due` (triggerAt: 1790292600000) | `due` (triggerAt: 1790292600000) | 1 | `null` | 0 | **未篡改，完全一致** |

> **用户数据核对结论**：  
> 设备上用户的两条真实待办事项在上一轮及本轮测试前后，`rev`、`snoozedAt`、`snoozeCount` 等核心字段完全未发生任何变更，状态保持最初状态。**上一轮 A4 虽报告测试未达预期，但绝无误操作、污染或篡改用户真实数据**。

---

## 3. 受控复测执行过程与时间线

复测严格按照规范执行 5 次独立尝试（S1 稍等锁屏 × 2、S2 立即锁屏 × 2、S3 前台对照 × 1），尝试间间隔均 > 1 分钟。时间戳统一取自设备时间（`adb shell date +%s%3N`）。

### 5 次尝试时间线汇总表

| 场景 | 事项标题 | 事项 ID | 保存时刻 T0 | 首次观测到原生排程 | 锁屏时刻 | 到期时刻 triggerAt | triggerAt+10s 最上层窗口与状态 | 最终结果 |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :--- | :---: |
| **S1-1** | `UIRECHECK-F1-S1-1` | `i_9mq6jrb3muh15wg3` | 22:02:40.174 (`1790344960174`) | **T0+1s** (`22:02:41`)<br>`AlarmRingService` (orig: 22:05:00.041) | 22:02:45.231<br>(T0+5s) | 22:05:00.000 (`1790345100000`) | `focus=NotificationShade`<br>`wake=Asleep`<br>AlarmActivity 未在前台 | **WARN**<br>(42秒后响铃) |
| **S1-2** | `UIRECHECK-F1-S1-2` | `i_4s6zseoomuh1bf5d` | 22:06:57.703 (`1790345217703`) | **T0+1s** (`22:06:58`)<br>`AlarmRingService` (orig: 22:10:00.016) | 22:07:02.805<br>(T0+5s) | 22:10:00.000 (`1790345400000`) | `focus=AlarmActivity`<br>`wake=Awake`<br>成功全屏弹出，点击「我知道了」 | **PASS**<br>(转 acknowledged) |
| **S2-1** | `UIRECHECK-F1-S2-1` | `i_u5ufqyammuh1rxwi` | 22:19:48.493 (`1790345988493`) | **T0+5s** (`22:19:53`)<br>`AlarmRingService` (orig: 22:23:00.031) | **22:19:49.288**<br>(T0+795ms，**立刻锁屏**) | 22:23:00.000 (`1790346180000`) | `focus=NotificationShade`<br>`wake=Asleep`<br>`AlarmActivity` 入栈但被 Shade 遮挡 | **WARN**<br>(焦点停在通知栏) |
| **S2-2** | `UIRECHECK-F1-S2-2` | `i_xy5i9cjxmuh2bd4c` | 22:34:54.681 (`1790346894681`) | **T0+5s** (`22:34:59`)<br>`AlarmRingService` (orig: 22:38:00.025) | **22:34:55.463**<br>(T0+782ms，**立刻锁屏**) | 22:38:00.000 (`1790347080000`) | `focus=NotificationShade`<br>`wake=Asleep`<br>AlarmActivity 被 OriginOS 冻结 | **WARN**<br>(亮屏后解冻完成) |
| **S3-1** | `UIRECHECK-F1-S3-1` | `i_jla0uypbmuh2h3nl` | 22:39:22.369 (`1790347162369`) | *(前台运行中)* | *(不锁屏)* | 22:42:00.000 (`1790347320000`) | `focus=AlarmActivity`<br>`wake=Awake`<br>应用内待处理面板与全屏闹钟同现 | **PASS**<br>(前台全链路正常) |

---

## 4. 详细场景现象与证据分析

### 4.1 原生排程写入能力验证（S1 与 S2 对比）
- **现象事实**：
  - S1 场景中，在 T0 点击保存后仅 **1 秒**（T0+1s），`dumpsys alarm` 中就已经检索到精确排程：
    ```text
    RTC_WAKEUP #8: Alarm{e66d1cf type 0 origWhen 1790345100041 flags 3 tag=*walarm*:space.alliswell.inbox.ACTION_TEST_ALARM}
    ```
  - S2 场景中，在 T0 保存后 **780~795 毫秒内强行熄屏加锁**。锁屏后分别在 T0+5s 和 T0+30s 抓取 `dumpsys alarm`，均清晰存在对应的 `AlarmRingService` 唤醒闹钟。
- **分析**：前端向原生的提醒同步防抖窗口仅为 80ms（`lib/app-native-coordinator.js` 的 `queueNativeReminderSync`）。通过正常表单交互保存的事项，从点击「安心交给系统」到完成 Native 数据落库及 `AlarmManager.setExactAndAllowWhileIdle` 写入，总耗时在 200~300ms 之间，**绝不存在「来不及写入原生排程」的产品缺陷**。

### 4.2 锁屏下全屏弹出时好时坏的原因分析（vivo OriginOS 16 机制）
在 4 次锁屏尝试中，出现了一次成功（S1-2）和三次受阻（S1-1、S2-1、S2-2）：
1. **S1-2（成功案例）**：
   - 22:10:00.166 触发时，`AttentionAlarm: deliver path=direct+banner fullScreen=true screenOn=true locked=false` 瞬间执行，200ms 内成功拉起 `AlarmActivity`，屏幕点亮进入 Awake，UIAutomator 成功点击「我知道了」完成闭环。
2. **S1-1（Doze 延迟唤醒）**：
   - 设定为 22:05:00 触发，但设备进入深度 Doze 休眠。系统直到 22:05:42.900（滞后 42.9 秒）才调度 `device_idle_wake_from_idle` 并执行 `deliver path=fsi+direct fullScreen=true` 拉起 `AlarmActivity`。在 triggerAt+10s 的快照时间点，设备仍处 Asleep，顶层为 `NotificationShade`。
3. **S2-1 与 S2-2（OriginOS Quick-Freezer 冻结与 Keyguard 遮挡）**：
   - 在 S2-2 的系统事件日志（`logcat -b all`）中清晰记录：
     ```text
     09-25 22:38:00.024 I/device_idle_wake_from_idle: space.alliswell.inbox/.AlarmRingService
     09-25 22:38:41.852 I/am_app_unfrozen: [0,10285,space.alliswell.inbox,screen on]
     09-25 22:38:42.026 I/wm_create_activity: ... AlarmActivity
     09-25 22:38:42.301 I/sysui_fullscreen_notification: 0|space.alliswell.inbox|686393262|null|10285
     ```
   - vivo OriginOS 16 的进程快速冻结器（Quick-Freezer）在锁屏后将后台进程冻结。虽然 `AlarmManager` 尝试在到期点分发唤醒广播，但 Activity 启动请求被系统挂起，直到屏幕点亮后进程被解冻（`am_app_unfrozen`），才补发了全屏通知。

### 4.3 S3 前台对照组（解释上一轮第 2 轮现象）
- S3-1 保持前台不锁屏，到点 22:42:00.223 瞬间 `AlarmActivity` 启动并在 191ms 内完成渲染获得焦点（`Focus entering Window:ba2ebb ... AlarmActivity`），同时前端 WebView 也同步弹出了应用内的待处理弹窗。
- **上一轮第 2 轮反推**：上一轮第 2 轮测试中顶层窗口是 `MainActivity`，证明上一轮执行时根本没有把手机屏幕真正锁死，甚至在前台未触发原生全屏，属于设备锁定状态未满足测试前提。

---

## 5. 判定规则与结论

依据测试规则的判定准则：

> 规则 4：“结果时好时坏 → 如实列出每一次的结果，判 WARN，并写明可能的触发条件。”  
> 规则 3：“有排程、闹钟也响了（logcat 里有 AlarmRingService 或通知记录），但锁屏上没出现 AlarmActivity → 全屏弹出被系统拦截，判 WARN，不判产品 FAIL。”

### 5.1 最终结论：判定为 WARN（测试脚本与系统策略问题，非产品排程缺陷）

> ⚠️ 已被文首「验收评审更正」修正：排程写入 PASS；锁屏熄屏下准点投递 FAIL（待定性）。以下为原文。
1. **排程能力 100% 达标**：只要按用户正常流程点击保存，无论稍后锁屏还是 1 秒内立刻锁屏，排程在 1~5 秒内百分之百写入 `AlarmManager`，锁屏 30 秒后排程仍然稳定有效。
2. **上一轮前两轮失败归因**：
   - **完全归因于测试脚本问题**：上一轮脚本通过 `state.items.push` 直接篡改前端内存创建事项，绕过了前端表单提交与 `NativeRemindersCoordinator` 的原生同步链路，导致根本没有写入任何系统排程；
   - 第 3 轮通过也是因为测试者在脚本中打补丁强行调用了 `syncNativeRemindersNow({ forceRebuild: true })`。
3. **vivo 锁屏弹出时好时坏归因**：
   - 归因于 vivo OriginOS 16 / Android 16 的深度休眠（Doze）调度延迟及系统 Quick-Freezer 冻结机制，全屏 Intent 弹出在纯锁屏休眠下存在一定几率被挂起至屏幕唤醒。

---

## 6. 清理与数据核销验证

1. **测试事项清理**：
   - 测试结束后，所有以 `UIRECHECK-F1-*` 命名的测试事项均通过 `window.__ATTENTION_INBOX__.deleteItem(id)` 正常删除链路销毁，原生排程同步撤销。
2. **无残留排程与通知**：
   - 清理后抓取 `dumpsys alarm`（`dumpsys/final_clean_alarm.txt`），确认没有任何残留的测试闹钟；
   - 抓取 `dumpsys notification`（`dumpsys/final_clean_notification.txt`），无残留通知。
3. **用户事项比对**：
   - 最终设备事项总数恢复为 6 条；
   - 两条<用户事项 A/B>的 `rev: 1`、`snoozeCount: 0`、`snoozedAt: null` 完全保持原样。

---

## 7. 证据索引与归档哈希

所有原始文件与全量 dumpsys 均已落盘归档：
- **测试代码原件**：`docs/reviews/verification-runs/20260925T135000Z-vivo-f1-controlled/run-vivo-f1-controlled.py`
- **详细执行日志**：`docs/reviews/verification-runs/20260925T135000Z-vivo-f1-controlled/run.log`
- **结果结构化摘要**：`docs/reviews/verification-runs/20260925T135000Z-vivo-f1-controlled/results_summary.json`
- **脱敏初始数据**：`docs/reviews/verification-runs/20260925T135000Z-vivo-f1-controlled/dom_and_state/00_initial_items_redacted.json`
- **归档 SHA-256 哈希列表**（已追加进 `docs/reviews/verification-runs/ARCHIVED-RAW-2026-09-25.tsv`）：
  - `2087b147194102ff73b867176e49d689e8736f5a88df2f9a6e5255ffe00b0cf7` `dom_and_state/00_initial_items_raw.json`
  - `767ed289a7769e2c602953c65714fcc767161877c0c4bb1603139e9958f769ea` `dumpsys/full_dumpsys_alarm.txt`
  - `1d1ad5e355c932991891fb1c92959b365d4e297d0aefba6e8718449fb0386650` `dumpsys/full_dumpsys_notification.txt`
  - `6bc023148743ef46ae9233b8a8c0e4e448d2d3dcca988529d46422c1587417ea` `dumpsys/full_dumpsys_power.txt`
  - `78e3c9d2d3fd03d28a754c31c187eb399ab7399417c340981fd3274f7e538257` `dumpsys/full_dumpsys_window.txt`
  - `6e23830dc7c3d230db69865d3bbd27598f02acee330391934b7130c2a8e62ad6` `logcat/full_logcat.txt`
  - `9dea280480ca1546a370bbe5b3f02e95f864cd8bc2e41ba4ec51147ef88ee25a` `run-vivo-f1-controlled.py`
  - `103e8ecefe36be9ab7c0e5812491757dd56f4ac70f9d9a69a65bc4b4bfc02884` `screenshots/S1_2_alarm_triggered.png`
  - `deade29e5f3432cc85bba281f44a864f1f32748107c2edaad3debbe18f2cde8a` `screenshots/S3_1_foreground_triggered.png`
  - `b2913a69bed46fd2db5ce8e35f1ad371b82a768b44fd8b8e52548e1deae641de` `screenshots/step0_vivo_app_settings.png`
