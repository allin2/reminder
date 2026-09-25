# vivo 开关矩阵验证：锁屏熄屏投递 × 三个系统开关 × 应用引导 · 2026-09-26

> run 目录：`docs/reviews/verification-runs/20260925T153500Z-vivo-switch-matrix/`
> 原始证据（全量 logcat、全机 dumpsys、含真实事项标题的快照）：`~/Developer/reminder-archive/verification-runs/20260925T153500Z-vivo-switch-matrix/`，SHA-256 逐文件登记于 `ARCHIVED-RAW-2026-09-25.tsv`。
> 本 run 由 2026-09-25 23:35 的会话开始、23:58 因脚本缺陷中断；2026-09-26 00:03 起由本会话续跑（用户同意续跑原 run，同意记录见 run.log `[RESUME-CONSENT]` 段）。

## 1. 环境与版本身份

| 项 | 值 |
| --- | --- |
| 设备 | vivo V2238A · Android 16 (API 36) · OriginOS 16.0 · serial `10ACBF2D3D000RS` |
| 应用 | `space.alliswell.inbox` · 版本 1.2 · UID 10285 |
| 仓库身份 | 分支 `feat/ui-redesign-a` · HEAD `ce0d5b9`（防冻结首页卡片修复） |
| 版本判据 | 设备 `base.apk`（sha256 `3dc563c0a39a9b9f…`）解包 `assets/public/` 与仓库逐字节比对：`sw.js`（`attention-inbox-v48`）、`index.html`、`app-core.js`、`lib/feedback.js`、`lib/app-setup.js`、`lib/app-events.js`、`lib/app-platform.js`、`lib/app-notices.js`、`lib/app-model.js` **全部 MATCH** |
| CDP 缓存判据 | `caches.keys()=[]`、SW 未注册 —— Capacitor WebView 上 SW/Cache API 不可用，任务书里「caches.keys() 应含 v48」的判据在该构建上**不可满足**，已改用上述 APK 解包比对（更强的身份证据） |
| 时段混淆 | 全部尝试处于应用内免打扰时段（quietStart 23:00 – quietEnd 07:30）内；A-2/B-1/B-2 在此时段准点投递，说明免打扰时段不阻断关键闹钟（至少本机构建） |

## 2. 步骤 0 原始状态（配置 A）

系统开关（step0 截图**已损坏**，见 §7；后台耗电原值有 XML 证据，另两项由 configB 切换动作推断）：

| 开关 | 原值 | 证据 |
| --- | --- | --- |
| 后台耗电 | **智能控制** | `dumpsys/configB_before_battery_options.xml`（切换前列表安心收件箱行=智能控制） |
| 锁屏显示 | **关**（推断） | configB 切换把它打开；step0 截图损坏 |
| 自启动 | **关**（推断） | 同上 |
| 悬浮窗 | 开（保持不变） | `resume_perm_list.png`（01:25，恢复前） |
| 关联启动 / 后台弹出界面 | 关 / 关（保持不变） | 同上 |

应用侧（CDP 只读，`dom_and_state/step0_*.json`）：
- `diag` 读取失败（null）—— 读取路径问题，续跑时已修复（见 §4）。
- `setupSteps` 五步全部未完成；首页有设置卡片，下一步 =「允许完全后台运行 (防冻结)」。
- `settings`：`setupDismissed=false`、`setupPromptStarted=true`、`backgroundVisited=null`、`overlayVisited=null`、`testRun=null`、`testFeedback=null`、`defaultDeliveryMode="alarm"`。
- 事项基线 6 条（脱敏版 `step0_items_redacted.json`；原件在归档）。

## 3. 步骤 1：应用引导检查（配置 A 下）

结论：**三项全 PASS**（run.log 行 1–38，截图 step1_01–10，注意截图已损坏、以 run.log 与 DOM 文本证据为准）。

1. **点进设置页不算解决** — PASS：从首页卡片点「去设置」落地 `com.iqoo.powersaving/.BackgroundHighUsageActivity`；返回后 `backgroundVisited=true`、`bgStep done=true / verified=false / homeDone=false`、**首页卡片仍在**（HTML 逐字节未变）。
2. **「我的 → 提醒设置」的悬浮窗步骤** — PASS（带一条观察）：overlay 行可进入设置流程、不弹首页提示、不影响卡片。观察：点击后 `topResumed` 仍是 `space.alliswell.inbox/.MainActivity`（跳转目标未离开应用，落地页截图 step1_06 已损坏，无法进一步确认落点）。
3. **× 关闭卡片** — PASS：点击 `#setupEntryDismiss` 后 toast「好的，之后可在『我的 → 提醒设置』里继续」，`#homeSetup` 清空、`setupDismissed=true`；`am force-stop` 后冷启动卡片**仍不出现**。验证后已恢复 `setupDismissed=false`、`backgroundVisited=null`（run.log 行 34–37）。

## 4. 步骤 2：开关矩阵（每种配置 2 次）

配置 C（三项全关）、配置 D（只开后台耗电）与步骤 3（60 秒测试）经用户同意**不做**（run.log `[RESUME-CONSENT]`）。投递时刻以 logcat `AttentionAlarm: deliver` 行为准（v2 脚本修正匹配后提取；文件名+行号见各试次 logcatEvidence）。

| 试次 | 配置 | T0 | triggerAt | 锁屏时刻 | T0+3s 排程 | 首次 deliver（logcat） | 投递延迟 | 屏幕自亮 | 铃声/振动 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SWITCH-A-1 | A | 23:41:14 | 23:44:00 | 23:41:24 | ✓（`ACTION_TEST_ALARM` origWhen 1790351040052） | 观察窗口内**无**；23:46:22.091 `path=direct+banner screenOn=true locked=false`（SWITCH-A-2 logcat 行 10073） | **+2:22**（外部解冻后才补投） | 否（窗口内无自亮） | 无 | **FAIL（挂起）** |
| SWITCH-A-2 | A | 23:46:51 | 23:50:00 | 23:47:01 | ✓（origWhen 1790351400017） | 23:50:00.260 `path=fsi+direct fullScreen=true screenOn=false locked=true`（SWITCH-A-2 logcat 行 16191） | **+260ms** | 是（投递所致，23:50:05 记录 Awake） | appops VIBRATE 累计 | **PASS（准点）** |
| SWITCH-B-1 | B | 23:54:31 | 23:57:00 | 23:54:42 | ✓（origWhen 1790351820028） | 23:57:00.120 `path=fsi+direct … locked=true`（SWITCH-B-1 logcat 行 14595） | **+120ms** | 是 | VIBRATE 2m3s（appops，响至超时） | **PASS（准点）** |
| SWITCH-B-2 | B | 01:14:22 | 01:17:00 | 01:14:31 | ✓（origWhen 1790356620020） | 01:17:00.118 `path=fsi+direct … locked=true`（SWITCH-B-2 logcat 行 8524） | **+118ms** | 是（01:17:06 AlarmActivity 获焦点，`mCurrentFocus` 直接可见） | VIBRATE 1m36s（响至「我知道了」） | **PASS（准点）** |

### 4.1 决定性机理：不是开关，是 fast_freezer 的冻结时机

- **A-1**：锁屏后 **0.5 秒**即被冻结 —— `am_app_frozen [0,10285,…,from fast_freezer]` @ 23:41:24.797（SWITCH-A-1 logcat 行 11004）。trigger 23:44:00 时进程冻着，`device_idle_wake_from_idle` 准点唤醒（23:44:00.052，SWITCH-B-2 logcat 行 2169–2170）但投递进不了冻结进程，观察窗口内零投递。23:46:21.993 `am_app_unfrozen [resume top activity]`（外部唤醒），**98ms 后**以 banner 路径补投 —— 与 freezer-rootcause 文档的「冻结态投递黑洞」机理完全一致。
- **A-2 / B-1 / B-2**：锁屏到 trigger 之间**无任何冻结事件**（A-2 下一次冻结在 23:52:25，B-1 在 B-1 窗口后），投递全部准点（118–260ms）。
- **同一配置 A，一次失败一次成功** ⇒ 三个开关不是投递准点的「决定性」变量；**锁屏后 fast_freezer 是否在 trigger 之前冻结进程**才是。R-1（09-18）单变量实验已证「允许后台耗电」恢复投递 —— 本轮补充：不开启时**也可能**准点（未被冻结时），开启显著降低被秒冻的概率（本轮 B 配置 2/2 未被冻结，A 配置 1/2 被秒冻；样本各 2，不构成概率估计）。

### 4.2 重点记录：vivo「允许后台耗电」能否被应用回读？

**能，但回读有延迟 / 需要应用重新拉起：**

| 时刻 | 系统开关 | `diag.ignoringBatteryOptimizations` | 来源 |
| --- | --- | --- | --- |
| 09-25 23:53（切到允许后立即） | 允许 | **false** | `configB_diag_and_steps.json` |
| 09-26 00:20（中断后，应用前台） | 允许 | **true** | RESUME-INSPECT3 |
| 09-26 01:21（恢复智能控制后，am start 重拉应用） | 智能控制 | **false** | FINAL-CHECK |

⇒ 该开关最终映射到 `isIgnoringBatteryOptimizations=true`（deviceidle whitelist 出现 `user,space.alliswell.inbox,10285`），**但切换后立即回读可能仍为 false**；用户开完开关回到应用，若应用不刷新原生状态，向导会继续显示未完成。恢复路径同样有滞后。

### 4.3 首页卡片随能力回读自动消失 / 重现 — 已真机验证

- 配置 B 生效后（00:20）：`background` 步骤 `done=true / verified=true / homeDone=true`，`#homeSetup` 为空（卡片消失）。
- 恢复配置 A 后（01:21，am start 重拉）：`background` 回落 `done=false / homeDone=false`，**首页卡片重新出现**（「还差 1 步…防冻结」）。

## 5. 引导评估结论（步骤 1 + §4.3）

| 检查项 | 判定 |
| --- | --- |
| 开关没开时，首页能否提示防冻结 | **PASS**（卡片出现、下一步指向正确） |
| 只点进设置页，会不会让提示错误消失 | **PASS**（visited 只推进向导 done，homeDone 仍 false，卡片保留） |
| 开关开了以后，提示能否自动消失 | **PASS**（能力回读 true → homeDone=true → 卡片消失；反向恢复同样验证） |
| vivo 回读滞留下，用户让提示消失的备选路径是否合理 | **WARN**：回读滞后意味着「开完开关立刻回到应用」时卡片可能仍在，需要用户重进应用或等待刷新；备选 = 60 秒测试（本轮 SKIP 未验证）或 × 关闭（已验证有效且冷启动持久）。建议：从系统设置页返回应用时主动刷新一次 diag。 |

## 6. 数据完整性

- 用户 6 条事项：id / status / rev / triggerAt / snoozedAt / snoozeCount / acknowledgedAt 与步骤 0 基线**逐字段一致**（FINAL-CHECK 01:21:51 vs `step0_items_redacted.json`）。
- SWITCH-* 测试事项：A-1/A-2/B-1 共 3 条在中断期间已被清理（**清理动作无 run.log 记录**，为上个会话中断后的未留痕操作 —— 如实注明）；B-2 由 v2 脚本正规删除并确认排程撤销（01:18:43 `sched_after=False`）。收尾时无 SWITCH 残留事项。
- `dumpsys alarm`：无测试事项待告排程（仅剩步骤 0 即存在的 2 条明日 review `TimedNotificationPublisher`）；`ACTION_TEST_ALARM`/`AlarmRingService` 仅出现在历史统计段（B-2 触发痕迹）。
- `dumpsys notification`：无本应用活跃通知记录（仅 UsageStats 历史）。
- 系统开关恢复（restore2_锁屏显示_post2.png / restore_bgpower_detail_after.png，01:20–01:21）：后台耗电=智能控制 ✓、锁屏显示=关 ✓、自启动=关 ✓、悬浮窗=开（原样）✓、关联启动/后台弹出界面=关（原样）✓。
- 应用内设置：`setupDismissed=false`、`backgroundVisited=null`、`testRun=null`、`testFeedback=null` —— 与步骤 0 一致（60 秒测试未做，无变化）。

## 7. 证据缺陷（如实声明）

1. **09-25 全部 154 张截图损坏不可恢复**：v1 脚本用 `adb shell screencap -p` 并做 `\r\n→\n` 替换，破坏 PNG 二进制流（含魔数 `0d 0a 1a`）。00:21 起改用 `exec-out` 无损。受影响：step0 三开关原值的截图证据、步骤 1 全部截图、A/B 试次的观察截图。**文字类证据（logcat、uiautomator XML、dumpsys、run.log）不受影响**；锁屏/投递判定均以 logcat+dumpsys 为准，不依赖截图。
2. **v1 脚本 NameError 中断**（`trial_summary` 先用后定义）：A-1/A-2/B-1 三次的「我知道了」确认、事项删除、摘要落盘从未执行；三事项的清理发生在中断后且无留痕。B-2 用修复后的 `run-matrix-v2.py` 完整走完全流程。
3. **v1 deliver 匹配假阴性**：匹配串 `AttentionAlarm deliver` 缺冒号，恒不匹配 ⇒ v1 报告的 "first deliver=None" 全部无效；本文表 §4 的投递时刻来自修正后的完整 logcat 分析（原始文件在归档，可复算）。
4. **configB 切换动作无 run.log 记录**（上个会话在 23:52–53 执行，无 consent 留痕）；本会话的 B-2 未改任何设置，恢复配置 A 的每一步已留痕（`[RESTORE]/[RESTORE2]`）。
5. 步骤 0 的 `diag` 读取失败（null）；已在续跑时用 `getNativeReminderStatus()` 修正。
6. C（三项全关）/ D（只开后台耗电）/ 60 秒测试：**SKIP**（用户决定），对应结论格不做推断。

## 8. 结论与建议

1. **锁屏熄屏不准点是不是开关导致的** —— 部分是，但不是全部：开关未开时确实可能被 `fast_freezer` 秒冻并挂起投递（A-1，延迟 2:22，外部解冻后 banner 补投）；但同一配置下也可能准点（A-2）。**真正决定准点与否的是锁屏后到 trigger 之间进程有没有被冻结**；三个开关通过降低冻结概率间接起作用。
2. **哪个开关起决定作用** —— 投递层：允许后台耗电（防冻结，R-1 单变量 + 本轮 B 2/2 无冻结）；显示层：锁屏显示（全屏，R-1）；冷进程启动：自启动（R-1）。本轮未做 C/D，无法在本轮内进一步分离三者的独立贡献。
3. **vivo「允许后台耗电」能否被应用回读** —— 能（最终映射到 `isIgnoringBatteryOptimizations` + deviceidle whitelist user 条目），但**有滞后 / 需要应用重新拉起**，切换后立即回读可能仍是旧值。
4. **首页防冻结提示真机表现** —— 符合 ce0d5b9 的设计意图：未开时出现、点进设置页不消失、能力回读 true 后自动消失（反向恢复亦验证）、× 关闭冷启动持久。
5. **PR #7（feat/ui-redesign-a / ce0d5b9）能否合入** —— **建议可以合入**：真机验证未发现应用侧阻断缺陷；防冻结首页提示行为符合设计且在真机上按预期工作。附带条件：① vivo 回读滞后建议跟进一次「从设置页返回时刷新 diag」的小改进；② 60 秒测试路径本轮未验证（SKIP）；③ 样本量小（每格 2 次），冻结时机随机性值得在后续版本观察。
