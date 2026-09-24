# PR #4 真机验证：先验勿扰，再关勿扰验证陈旧通知撤除——实施与独立验收交接

日期：2026-09-25。状态：**仅计划，待实施**。实施方完成并自测后，交回独立验收方复验。实施方报告不得自称「独立 PASS」。

## 1. 基线与范围

- 仓库 `/Users/qlyf/Developer/reminder`。工作区当前应停在分支 `fix/remove-stale-delivered-notifications`，HEAD 为 `c8f4f8f`（PR #4「fix: remove stale delivered notifications during native reconcile」）。开工先记录 `git branch --show-current`、`git rev-parse HEAD`、`git status --short`，以及 `lib/native-reminders.js`、`sw.js`（应为 `attention-inbox-v44`）的 SHA-256。分支或 HEAD 不符、或者受控文件有未提交改动时，**先停下报告**，不要切换分支。
- 设备：vivo V2238A / Android 16，ADB 序列号 `10ACBF2D3D000RS`，包名 `space.alliswell.inbox`（User 0）。ADB：`~/Library/Android/sdk/platform-tools/adb`。
- 工具：把 `docs/reviews/verification-runs/20260924T2229-pr3-independent-recheck/devlib.py` **复制**到新的 run 目录后再使用，原文件不改。复制后调整其中的 `CANDIDATE`、`RAW_PRIVATE` 常量。已有辅助函数：`cdp_eval`、`idb_snapshot` / `diff_snapshots`、`create_item_via_form`、`item_state`、`idb_item`、`notif_records`、`notif_dump_pkg`、`tap_notification_action`、`ui_nodes`。
- 本次**不修改产品源码**。发现缺陷时记录证据后报告，不要修。

被验证的行为：
- **勿扰（已有功能）**：`settings.dnd = true` 时，触发时刻落在勿扰时段内的**普通档**事项，会延后到时段结束才发通知；**重要 / 关键档不受影响**，按时响全屏闹钟。规则见 `lib/reminder.js` 的 `inQuietHours` / `quietEnd` 和 `lib/native-reminders.js` 的 `effectiveTriggerAt`。开关是「我的」页的 `#swDnd`，时段在勿扰面板的 `#quietStart` / `#quietEnd` 中编辑，保存按钮为 `#btnSaveQuiet`。保存后会自动触发原生重新同步。
- **PR #4**：原生对账会撤掉**已送达**的事项通知，条件是：事项已删除；事项已完成或已归档；或送达后事项 `rev` 发生了变化（确认、完成、稍后、改时间都会推进 rev，单纯到期不会）。归属索引存放在本机 `localStorage` 的 `attention-inbox-delivered-notif-index` 键中；对账状态里有 `removedDeliveredIds` 和 `deliveredCleanupError` 两个字段。

## 2. 硬性禁止

1. 不执行 `git checkout/switch/reset/stash/clean/commit/push`，不删除或覆盖现有文件（包括 `releases/` 下的 APK、`releases/candidates/` 下的旧候选和旧证据）。**不运行 `scripts/android-build.sh`**。
2. 不卸载应用，不清除应用数据；测闹钟时不要 force-stop（它会清掉 AlarmManager 的闹钟），需要杀进程时用 `adb shell run-as space.alliswell.inbox kill -9 <pid>`。不修改系统或安全设置，不更改 USB 模式（弹出「USB 已连接」时按返回键取消）。
3. vivo 安装拦截页只允许点「继续安装」。**出现密码、账号或验证码输入时立即停止**，把该步标为 NOT_PERFORMED。
4. 用户数据：测试前记录用户现有事项的 id 集合和全部设置。只操作标题含 `RFX` 的隔离事项，不修改、不删除其他事项。本计划唯一允许改的用户设置是勿扰开关和勿扰时段，第 6 节必须把它们恢复到测试前的值。
5. **不能让隔离事项落入「待整理」**：上一轮用表单建的事项因为文本里没有可解析的时间，被判成 `NEEDS_REVIEW`，结果向用户发出了一条真实的「待整理」提醒。新建事项时必须：
   - 文本**以相对时间开头**，隔离标记只用**纯字母**，格式为 `N分钟后提醒我 RFX <场景名>`，例如 `2分钟后提醒我 RFX 勿扰普通甲`。标记里**不能带数字或中文数字**：像 `R4N1-001500` 这样的写法，解析器会读错，置信度变低，触发时间会错成约 7 天后（2026-09-25 已用 `lib/parse-cn.js` 实测）；
   - 只往 `#capText` 填文本，由应用解析时间：**不要**设置 `#capTrigger`，也不要调用 `markTriggerPicked`。`devlib.create_item_via_form` 会手工选时间，不能直接用，需要写一个只填文本、选优先级后调用 `saveItemFromForm()` 的变体；
   - 每次新建后立即断言：事项标题含 `RFX`，`review_status === "READY"`，`triggerAt` 与文本中的相对时间相差不到 60 秒。任一条不满足，立即用 `deleteItem` 删除并停止报告；
   - **整个测试不要安排在 21:30–23:00**（待整理时段）。
6. 隐私：通知栏截图、完整的 `dumpsys notification`、uiautomator 原始文本、原始 IDB 内容只能存放在仓库外的私有目录。仓库内的证据只能包含：本包的通知记录段落（`notif_dump_pkg()` 的输出）、哈希、RFX 事项字段，以及前台为本应用时的截图（截图前确认 `mCurrentFocus` 含 `space.alliswell.inbox`）。
7. 不向外部服务发送任何数据。

## 3. 构建候选包

1. 运行 `npm test`，保存完整日志，退出码必须为 0。
2. 运行 `npm run cap:sync`，然后：
   ```
   export JAVA_HOME=$HOME/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
   export ANDROID_HOME=$HOME/Library/Android/sdk
   cd android && ./gradlew assembleDebug
   ```
3. 把 `android/app/build/outputs/apk/debug/app-debug.apk` **复制**到全新目录 `releases/candidates/<时间戳>-pr4-candidate/app-debug.apk`，并记录 SHA-256。
4. 资源闭包：全部运行时 Web 资源在「源码 → `www/` → `android/app/src/main/assets/public/` → Gradle debug intermediate → APK `assets/public/`」五层逐字节一致；APK 里的 `lib/native-reminders.js` 与源码相同，`sw.js` 的缓存名为 v44。
5. `adb install -r` 安装候选包，确认机上 base.apk 的哈希等于候选包的哈希。安装前后各做一次 IDB 记录级快照，用户事项必须完全相同。

## 4. 阶段 A：勿扰开启时的效果

先记录当前设备时间和 `settings.dnd`、`quietStart`、`quietEnd`。按当前时间选一种方式：
- **A-默认**：当前时间落在用户自己的勿扰时段内（默认 23:00–07:30），并且离时段结束还不到 30 分钟，可以等到结束观察放行。这种情况直接使用用户的设置。
- **A-临时窗口**（其他时间都用这种）：通过勿扰面板，把时段临时改为「当前时间减 1 分钟」到「当前时间加 6 分钟」（精确到分钟），点 `#btnSaveQuiet` 保存，并确认 `settings.dnd === true`。临时窗口不能和 21:30–23:00 重叠。第 6 节必须恢复原来的时段。

步骤（各事项都按第 2 节第 5 条的格式新建，并完成新建后的断言）：

| 编号 | 操作 | 通过标准 |
|---|---|---|
| A1 | 新建普通档 `2分钟后提醒我 RFX 勿扰普通甲`，触发时刻落在勿扰时段内 | 新建后 1 分钟内，`Capacitor.Plugins.LocalNotifications.getPending()` 中该事项（`extra.itemId` 相同）的 `schedule.at` 等于勿扰结束时刻，而不是原定时刻；原定时刻过后 30 秒内，通知栏没有这条通知 |
| A2 | 新建重要档 `2分钟后提醒我 RFX 勿扰重要乙`（在表单中选「重要」） | 原定时刻起 60 秒内弹出全屏 `AlarmActivity`（勿扰不影响重要档）。点「完成」后内存与 IDB 都是已完成 |
| A3 | 等到勿扰结束时刻（A-临时窗口约 6 分钟；A-默认按实际时间） | 结束时刻后 90 秒内，A1 的通知送达通知栏；事项在应用中为到期 |
| A4 | A1 的通知送达后，**不在通知上操作**，直接在应用里用 `deleteItem` 删除这条 A1 事项 | 删除后 10 秒内这条通知从通知栏消失，并且对账状态 `removedDeliveredIds` 含该 id（这一条同时验证 PR #4） |

A 阶段结束后，如果用的是临时窗口，先把勿扰时段恢复成原值再进入 B 阶段。

## 5. 阶段 B：关闭勿扰后验证 PR #4

在「我的」页点 `#swDnd`，把勿扰关掉，确认 `settings.dnd === false`。**测试结束后必须恢复原值。** 下列普通档事项都按第 2 节第 5 条的格式新建（场景名各不相同，例如 `RFX 撤除删除丙`），并完成新建后的断言；每条都在应用在后台时等待送达，送达后再回到前台操作。

| 编号 | 场景 | 通过标准 |
|---|---|---|
| B0 | 勿扰已关，在原本属于勿扰时段的时间新建普通档（只有当前时间确实在用户原勿扰时段内时才做，否则标 N/A 并写明原因） | 按原定时刻送达，不再延后 |
| B1 | 送达后不在通知上操作，在应用内 `deleteItem` | 10 秒内通知消失；`removedDeliveredIds` 含该 id；再次冷启动后通知栏中也没有 |
| B2 | 送达后在应用内「我知道了」（`ackItem`） | 通知消失；事项为 `acknowledged` 并已写入 IDB |
| B3 | 送达后在应用内「完成」（`completeItem`） | 通知消失；事项已完成并已写入 IDB |
| B4 | 送达后在应用内「稍后」（`snoozeItem`，2 小时） | 旧通知消失；待发队列中有该事项新的排程，时间约为 +2 小时 |
| B5 | 送达后什么都不做，手动触发一次对账（`__ATTENTION_INBOX__.syncNativeRemindersNow('b5')`），并回到前台一次 | 通知**仍在**通知栏（未处理的到期事项不能被误撤）；`removedDeliveredIds` 不含它 |
| B6 | 送达后先 `kill -9` 杀掉进程，冷启动，再在应用内 `deleteItem` | 通知被撤掉（验证归属索引在进程重启后仍然有效） |
| B7 | 回归：送达后在**通知栏**点「我知道了」 | 事项为 `acknowledged`、写入 IDB、通知消失（原有行为不退化） |
| B8 | 观察项（不计 PASS/FAIL）：重要档事项正在全屏响铃时，在应用内删除它 | 如实记录响铃、全屏面板和通知是否消失。PR #4 没有覆盖这条路径，只作记录 |

每一条都记录：事项 id、通知 id（从 `getPending` 在送达前取得）、送达时刻、操作时刻、通知消失时刻，以及对账状态中的 `removedDeliveredIds` 和 `deliveredCleanupError`。

## 6. 清理与恢复

1. 用 `deleteItem` 删除所有标题含 `RFX` 的事项；本包系统闹钟中没有指向它们的项；通知栏中没有 RFX 通知；`getPending()` 中没有 RFX 排程。
2. 把 `settings.dnd`、`quietStart`、`quietEnd` 恢复成测试前的值（通过界面操作：`#swDnd` 和勿扰面板），并读回确认。
3. `kill -9` 冷启动后做一次 IDB 快照，和测试前对比：用户事项的 id 集合与内容哈希相同；设置中只允许 `alarmEventLog` 新增匿名条目，其余差异逐项列出并解释。`settings.review` 必须**没有**变化；如果变了，说明违反了第 2 节第 5 条，需要如实报告。
4. `localStorage` 的 `attention-inbox-delivered-notif-index` 不应再包含任何 RFX 事项的条目。

## 7. 做不到时

任何一步无法完成（时间窗口不合适、设备断开、安装被拦截、要求输入凭据等），把该步标为 `NOT_PERFORMED`，写明原因和已保留的证据，再继续后面相互独立的步骤。不要为了通过而绕开禁止项。

## 8. 交付物

在 `docs/reviews/verification-runs/<时间戳>-pr4-dnd-and-stale-notif/` 下提交：
- `README.md`：身份（分支、HEAD、源文件哈希、候选 APK 的哈希与路径、安装前后机上 base.apk 的哈希）、测试前的设置基线、A1–A4 和 B0–B8 的结论表（PASS / FAIL / NOT_PERFORMED / N/A + 证据路径 + 关键时刻）、恢复结果与残留。结论写「实施方自测」。
- `npm-test.log`、资源闭包 JSON、`run.log`、各步 JSON、只含本应用界面的截图，以及全部脚本。
- 私有证据的存放路径只写在 README 中，文件本身不入库。

完成后交回独立验收方。验收方会核对候选包与机上的包是否一致，重跑 A1、A4、B1、B5 等关键断言，审查隐私合规与用户设置的恢复情况，再给出结论。
