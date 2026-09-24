# PR #3 修复真机回归：实施与独立验收交接

日期：2026-09-24。状态：**仅计划，待实施**。实施方完成并自测后，交回独立验收方复验。实施方报告不得自称「独立 PASS」。

## 1. 基线与范围

- 仓库 `/Users/qlyf/Developer/reminder`，分支 `main`，HEAD 应为 `98fef24`（「fix: setup guide reads real native capabilities; stop sheet and badge leaks」）。开工先记录 `git rev-parse HEAD`、`git status --short` 以及下列文件的 SHA-256：`index.html`、`lib/feedback.js`、`lib/app-setup.js`、`app-core.js`、`sw.js`。HEAD 不是 `98fef24` 或上述文件有未提交改动时，**先停下报告**，不要继续。
- 本次只验证 PR #3 的 4 个修复在真机新包上生效，并做少量回归，**不修改产品源码**。发现缺陷时记录证据后报告，不要自行修复。
- 设备：vivo V2238A / Android 16，ADB 序列号 `10ACBF2D3D000RS`，包名 `space.alliswell.inbox`（User 0）。ADB 路径 `~/Library/Android/sdk/platform-tools/adb`。
- 可复用的工具：`docs/reviews/verification-runs/20260924T1526-a15-device-acceptance/devlib.py`，提供 CDP 执行、IDB 记录级快照与对比、捕获表单建项、通知栏与 uiautomator 操作。**把它复制到新 run 目录后再用，不要修改原文件**。复制后按新 run 目录调整 `RUN`、`CANDIDATE`、`RAW_PRIVATE` 等常量。

PR #3 的 4 个修复：

| 编号 | 修复 | 源码位置 |
|---|---|---|
| F1 | 设置引导从 `native.diag` 回读悬浮窗、全屏通知与电池优化能力；已开启的能力判为完成，不再要求去开启 | `lib/feedback.js` 中的 `setupSteps` |
| F2 | 原生状态仍是初始占位 `notifications: "unknown"` 时，首页不渲染设置卡片；状态读回后由 `onStatusChange` 重绘 | `lib/app-setup.js` 中的 `renderSetupEntry`，`app-core.js` 中的 `onStatusChange` |
| F3 | 收起的底部面板在关闭动画结束后 `visibility: hidden`，不再在导航栏下露出标题 | `index.html` 中的 `.sheet` / `.sheet.open` |
| F4 | `[hidden] { display: none !important; }`，首页角标为 0 时不再显示红色「0」 | `index.html` |

另外 `sw.js` 的缓存名应为 `attention-inbox-v43`。

## 2. 硬性禁止

1. 不执行 `git checkout/reset/stash/clean/commit/push`，不删除或覆盖任何现有文件，包括 `releases/` 下的 APK、`releases/candidates/` 下的旧候选和旧证据目录。
2. **不运行 `scripts/android-build.sh`**：它会覆盖 `releases/` 下固定文件名的产物。按第 3 节的步骤构建。
3. 不卸载应用，不清除应用数据，不 force-stop 后再测闹钟（force-stop 会清掉 AlarmManager 里的闹钟），不修改系统或安全设置，不更改 USB 模式（弹出「USB 已连接」时按返回键取消）。
4. vivo 安装拦截页只允许点「继续安装」。**出现密码、账号或验证码输入时立即停止，报告 NOT_PERFORMED**，不输入任何内容。
5. 用户真实数据：测试前记录用户现有事项的数量和 id 集合，只操作标题以 `R3` 开头的隔离事项，不修改、不删除任何其他事项。
6. 隐私：通知栏截图、完整的 `dumpsys notification`、原始 IDB 内容、导出文件**只能**存放在仓库外的私有目录（例如会话临时目录）。仓库内的证据只能包含：本包的通知记录段落（`devlib.notif_dump_pkg()` 的输出）、哈希、隔离事项字段，以及仅含本应用界面的截图。uiautomator 节点只在内存中筛选，不把其他应用的文本写进日志。
7. 不向任何外部服务发送数据。

## 3. 构建隔离候选包

1. 运行 `npm test`，保存完整日志，退出码必须为 0。
2. `npm run cap:sync`：同步 `www/` 与 Android 资源，`www/` 已被 gitignore。
3. 构建 Debug 包（不签发布包）：
   ```
   export JAVA_HOME=$HOME/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
   export ANDROID_HOME=$HOME/Library/Android/sdk
   cd android && ./gradlew assembleDebug
   ```
4. 把 `android/app/build/outputs/apk/debug/app-debug.apk` **复制**到新目录 `releases/candidates/<时间戳>-pr3-regression-candidate/app-debug.apk`，目录名必须全新，不能与已有目录重名。记录它的 SHA-256。
5. 资源闭包：`index.html`、`sw.js`、`manifest`、图标、`app-core.js`、`lib/*.js` 等全部运行时 Web 资源，在「源码 → `www/` → `android/app/src/main/assets/public/` → Gradle debug intermediate → 候选 APK 的 `assets/public/`」五层逐字节比对。输出缺失、多余和不一致的文件清单。可以参考 `docs/reviews/verification-runs/20260924T1405-p4-device-delivery/verify-resources.py`（复制后改路径）。APK 里 `sw.js` 的缓存名必须是 v43。

## 4. 真机步骤与通过标准

每一步都写进 `run.log`，并保存对应的 JSON 或截图。截图前先确认前台窗口是本应用（`mCurrentFocus` 含 `space.alliswell.inbox`）。如果不是，不要截图，先按返回键或回到本应用。

### R1 安装前后记录级比对
- 安装前：确认机上 base.apk 的哈希（预期为旧候选 `e14438de…`，以实际读到的为准）。然后用捕获表单建一条隔离事项 `R3P1-<时刻> 安装比对`，重要档，次日触发，并做一次 IDB 记录级快照。
- `adb install -r` 安装新候选，确认安装后机上 base.apk 的哈希等于新候选的哈希。
- 冷启动后再做一次快照，逐记录对比。
- **通过**：`kv/state` 与 localStorage 完全相同；若不同，只允许出现能逐字段解释的差异，并逐项列出。R3P1 的系统闹钟（`AlarmRingService`）安装后仍然存在。

### R2（F1）设置引导的判定
- 读取 `__ATTENTION_INBOX__.getNativeReminderStatus()`，记录 `notifications`、`exactAlarm`、`diag.canDrawOverlays`、`diag.canUseFullScreenIntent`、`diag.ignoringBatteryOptimizations`。
- 用手机上的 `AttentionLib.Feedback.setupSteps(status, __ATTENTION_INBOX__.setupStepsContext())` 计算每一步的 `done` 和 `verified`。
- 打开「我的 → 提醒设置」，读取 `#setupBody` 的文字并截图。
- **通过**：悬浮窗一步的判定与 diag 一致（两项都为 true 时 `done=true`、`verified=true`）；面板当前显示的步骤等于计算出的第一个未完成步骤；「我的」页提醒设置的副标题「还差 N 步」与计算结果一致。当前设备上预期「后台运行」未完成，悬浮窗已完成；以实际回读为准，并如实记录。

### R3（F2）冷启动时的设置卡片
- 前提：`settings.setupPromptStarted === true`。R1 用表单建了带时间的事项，会自动置为 true，要确认一下。
- 执行 `run-as space.alliswell.inbox kill -9 <pid>` 杀掉进程（不用 force-stop），然后 `am start` 冷启动。从 CDP 能连上开始，每 100 ms 采样一次 `#homeSetup.innerHTML` 与 `getNativeReminderStatus().notifications`，持续 10 秒，至少重复 3 轮。
- **通过**：所有采样中，只要 `notifications` 为 `unknown`，`#homeSetup` 就为空；任何一次采样都不出现「允许发通知」（前提是通知已授权）；状态读回后卡片出现，文字中的步数与 R2 一致。

### R4（F3）收起的面板
- 依次打开并关闭：设置面板（`#btnSetup`）、捕获面板（`openCapture`）、演示面板、事项详情（打开一条 R3 事项的详情）。每次关闭后等 0.5 秒，统计 `.sheet` 中 `getBoundingClientRect().top < innerHeight` 且 `getComputedStyle().visibility !== "hidden"` 的元素。
- 在首页、未来、笔记、我的 4 个标签页各截一张图，并用 `zoom` 或裁剪放大底部导航栏以下的区域。
- **通过**：统计数恒为 0；截图底部没有「演示（只读）」等面板标题；面板打开时可见、可交互（例如捕获面板的输入框能获得焦点）。

### R5（F4）首页角标
- 没有到期事项时：`#navBadge.hidden === true` 且 `getComputedStyle().display === "none"`，截图里首页图标上没有「0」。
- 建一条 1–2 分钟后到期的隔离事项 `R3B1-<时刻> 角标`（普通档）。到期后回到应用：角标可见，数字与到期数量一致。用业务命令完成或删除它后，角标再次隐藏。
- **通过**：以上三种状态都符合预期。

### R6 少量回归
- 对一条普通档隔离事项，在通知栏点「我知道了」：状态变为 `acknowledged` 并写入 IDB，通知被移除。分组通知的展开方式见 `devlib.tap_notification_action`。
- 对一条重要档隔离事项：应用在后台时到点弹出全屏面板，点「完成」后回到前台，内存与 IDB 都是已完成、通知已移除。
- **通过**：两项都符合预期。

### R7 清理与恢复
- 用 `__ATTENTION_INBOX__.deleteItem(id)` 删除所有 `R3` 开头的隔离事项。确认本包的系统闹钟中没有指向这些事项的项，通知中没有 R3 残留；杀进程冷启动后，IDB 中的事项 id 集合等于测试前记录的集合。
- 把 `settings.setupPromptStarted` 恢复成测试前的值。没有业务命令可用，参照上一轮做法：直接改 `state.settings` 后调用 `saveAsync()`，并在报告中注明这是非业务写入。
- 与测试开始前的快照相比，只允许出现 `settings.alarmEventLog` 新增的匿名条目，其余差异逐项列出。
- **通过**：满足以上各条。

## 5. 做不到时

任何一步无法完成（设备断开、安装被拦截、要求输入凭据、系统弹窗无法安全关闭等），把该步标为 `NOT_PERFORMED`，写明原因和已保留的证据，然后继续做后面相互独立的步骤。不要为了让步骤通过而绕开禁止项。

## 6. 交付物

在 `docs/reviews/verification-runs/<时间戳>-pr3-device-regression/` 下提交：
- `README.md`：身份（HEAD、源文件哈希、新候选 APK 的哈希与路径、安装前后机上 base.apk 的哈希）、R1–R7 的结论表（PASS / FAIL / NOT_PERFORMED + 证据路径）、偏差与残留、清理结果。结论写「实施方自测」，不写「独立验收」。
- `npm-test.log`、资源闭包结果（JSON）、`run.log`、各步 JSON，以及只含本应用界面的截图。
- 使用过的全部脚本，确保复验方可以直接重跑。
- 私有证据（通知栏截图、原始快照）的存放路径只写在 README 中，文件本身不入库。

完成后交回独立验收方。验收方会重新核对候选包哈希与手机上的包是否一致，重跑 R2–R5 的关键断言，审查证据的隐私合规，再给出结论。
