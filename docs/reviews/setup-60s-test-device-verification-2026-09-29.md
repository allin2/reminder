# 安心收件箱「60 秒测试」vivo V2238A 真机全场景验证报告

**验证报告编号**：`VERIFY-SETUP-60S-20260929-01`  
**运行标识（RUN_ID）**：`20260929T093800Z-setup-60s-test`  
**验证时间**：2026-09-29 09:38:00 – 10:34:00 (CST)  
**验证环境**：vivo V2238A（serial: `10ACBF2D3D000RS`，Android 14 OriginOS 4）  
**被测包名**：`space.alliswell.inbox`  
**被测提交**：`d97a5ed47af96dc8eda49800bf16911f0be856ec`  
**被测产物**：`releases/安心收件箱-debug.apk`（SHA-256: `efea673d1c48b1853baf37f73ca3103a02e287cfd7d684b3c6686ea1092d08dd`）  
**验证工程师纪律**：只做验证，严禁修改任何业务代码；全流程物理点击（CDP 只读计算物理坐标 + `adb shell input tap`）；每次尝试严格以三件套证据（attempt 日志、连续采集 samples jsonl、切片 logcat txt）闭环留存。

---

## 1. 验证结论概要

在 vivo V2238A 真机上对「我的 → 提醒设置 → 做一次 60 秒测试」开展了 7 大场景、共计 20 次独立闭环真机测试（执行区间：10:00–10:34，严格避开 23:00–07:30 免打扰时段）：

| 场景编号 | 场景描述 | 样本量 | 判定结果 | 关键特征与出处 |
| :--- | :--- | :---: | :---: | :--- |
| **T1** | 60 秒测试排程与撤销 | 3 次 | **PASS** | Toast 提示精准，`origWhen` 与 `triggerAt` 偏差 0ms，点击停止后 90003 闹钟从 dumpsys 彻底撤销。 |
| **T2** | 基线下锁屏准时投递与面板写入 | 3 次 | **PASS** | 到点前确认 `mWakefulness=Asleep` 且 `isKeyguardShowing=true`；未自亮屏；闹钟准时触发（延迟 +60~+120ms）；亮屏开面板成功写入 `seenAt`，步骤转为「60 秒测试已有结果 / 再测一次」。 |
| **T3a** | 响铃中物理点击停止 | 3 次 | **PASS** | 响铃中进入面板点击「停止铃声」，Toast「已停止本次测试的铃声」，铃声与前台服务立即停止，`stoppedAt` 成功落库。 |
| **T3b** | 未到点物理取消测试 | 3 次 | **PASS** | Toast「没有正在响的测试铃声 · 已取消未触发的测试」，90003 闹钟即刻从 dumpsys 消除，用户原有 2 条业务闹钟完全未受影响。 |
| **T3c** | 四个反馈选项点击与重置 | 3 次 | **PASS** | 依次点击 heard / seen / missed / unsure 均正确触发对应 Toast 及 settings 映射；再次点击「再测一次」高亮反馈清除，面板正确显示「（这是上一次的回答，本次还没有）」。 |
| **T4** | 智能控制冻结下迟到投递专项 | 3 次 | **FAIL (缺陷确证)** | 成功捕获 **2 次典型冻结迟到样本**（T4-2 迟到 182.3s，T4-3 迟到 93.8s）。**确证产品缺陷**：应用被系统 `fast_freezer` 冻结导致闹钟严重迟到，但在唤醒开面板后仍被写入 `seenAt`，使步骤误判为通过（`testVerified=true`），进而导致首页「允许完全后台运行 (防冻结)」卡片被**异常消除**。此外发现面板排版文案存在 `[object Object]` 强制类型转换缺陷。 |
| **T5** | 应用退到后台再锁屏投递 | 2 次 | **PASS** | 启动测试后 10 秒内按 Home 退到桌面再锁屏；到点准时投递，前台服务拉起；亮屏进入面板核验 `seenAt` 写入且步骤判定正常。 |
| **测后基线**| 数据一致性与系统设置恢复 | 1 次 | **PASS** | 11 条用户历史事项逐字段与基线 100% 一致；2 条用户原生闹钟完全未变；后台耗电管理成功恢复为「允许后台耗电」（Radio checked & whitelist present）。 |

---

## 2. 被测对象版本身份与基线核验

### 2.1 产物逐字节比对
从设备当前运行状态及构建 APK 进行解包，对比仓库源文件：
- `releases/安心收件箱-debug.apk` SHA-256: `efea673d1c48b1853baf37f73ca3103a02e287cfd7d684b3c6686ea1092d08dd`
- APK 内 `assets/public/sw.js` 与仓库 `www/sw.js` 逐字节比对：**100% MATCH**（缓存版本号包含 `attention-inbox-v50`）
- APK 内 `assets/public/lib/app-setup.js` 与仓库 `www/lib/app-setup.js` 逐字节比对：**100% MATCH**
- APK 内 `assets/public/lib/feedback.js` 与仓库 `www/lib/feedback.js` 逐字节比对：**100% MATCH**

### 2.2 测前基线状态确认
- **后台耗电管理**：允许后台耗电
  - 出处：`docs/reviews/verification-runs/20260929T093800Z-setup-60s-test/dumpsys/baseline_bgpower_detail.xml` 第 1 行（RadioButton bounds `[84,950][996,1106]`，`checked="true"`）
  - 出处：`docs/reviews/verification-runs/20260929T093800Z-setup-60s-test/screenshots-sanitized/baseline_bgpower_detail.png`
  - 白名单核查：`dumpsys deviceidle whitelist` 包含 `space.alliswell.inbox`
- **基础权限状态**：
  - 出处：`docs/reviews/verification-runs/20260929T093800Z-setup-60s-test/dumpsys/baseline_allperm.xml` 第 1 行
  - 悬浮窗 = 开（`checked="true"`）
  - 自启动 = 关（`checked="false"`）
  - 锁屏显示 = 关（`checked="false"`）
- **用户业务数据基线**：
  - 11 条真实事项，已脱敏留存于 `docs/reviews/verification-runs/20260929T093800Z-setup-60s-test/baseline-items-sanitized.json`
  - 用户系统原生闹钟：2 条（TAG 为 `*walarm*:space.alliswell.inbox/com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher`）

---

## 3. 分场景真机详细验证记录

所有物理操作坐标均基于 vivo V2238A 屏幕（1080x2400，状态栏高 120px，DPR=3.0）通过 CDP 获取 `getBoundingClientRect()` 计算物理像素并避让底部系统手势区（y>2200px）。

### 3.1 场景 T1：60 秒测试排程与撤销（3 次）

- **测试步骤**：进入「我的 → 提醒设置」，物理点击 `#setupTestStart`（开始 60 秒测试），校验 Toast、`testRun` 状态及 `dumpsys alarm 90003`；随后物理点击 `#setupTestStop` 取消测试，校验 90003 彻底移除。
- **验证记录**：
  - **T1-1**：
    - 开始时刻：`1790646909330`（09:55:09 CST）
    - Toast 提示：`已排 60 秒测试 · 可以锁屏了`（出处：`attempt-T1-1.log` 第 40 行）
    - 排程比对：`Alarm origWhen=1790646969346`，`testRun.triggerAt=1790646969346`，**偏差 diff_ms = 0**（出处：`attempt-T1-1.log` 第 43 行）
    - 撤销结果：点击停止后 dumpsys 90003 为 `None`（出处：`attempt-T1-1.log` 第 52 行）
    - 留存证据：`attempt-T1-1.log`、`samples-T1-1.jsonl`（53KB）、`logcat-T1-1.txt`（31KB）
  - **T1-2**：
    - 开始时刻：`1790646917113`（09:55:17 CST）
    - Toast 提示：`已排 60 秒测试 · 可以锁屏了`（出处：`attempt-T1-2.log` 第 24 行）
    - 排程比对：`origWhen=1790646977131`，`triggerAt=1790646977131`，**diff_ms = 0**（出处：`attempt-T1-2.log` 第 27 行）
    - 撤销结果：dumpsys 90003 为 `None`（出处：`attempt-T1-2.log` 第 33 行）
    - 留存证据：`attempt-T1-2.log`、`samples-T1-2.jsonl`（55KB）、`logcat-T1-2.txt`（32KB）
  - **T1-3**：
    - 开始时刻：`1790646924980`（09:55:24 CST）
    - Toast 提示：`已排 60 秒测试 · 可以锁屏了`（出处：`attempt-T1-3.log` 第 24 行）
    - 排程比对：`origWhen=1790646985000`，`triggerAt=1790646985000`，**diff_ms = 0**（出处：`attempt-T1-3.log` 第 27 行）
    - 撤销结果：dumpsys 90003 为 `None`（出处：`attempt-T1-3.log` 第 33 行）
    - 留存证据：`attempt-T1-3.log`、`samples-T1-3.jsonl`（57KB）、`logcat-T1-3.txt`（31KB）

---

### 3.2 场景 T2：基线下锁屏准时投递与面板写入（3 次）

- **测试步骤**：基线（允许后台耗电）下点击开始测试，10s 内锁屏熄屏；到点前双重核查锁屏与休眠状态；到点投递后检查屏幕未被自动点亮、前台服务与震动运行；手动亮屏进入面板核对 `seenAt` 写入及步骤状态转变。
- **验证记录**：
  - **T2-1**：
    - 计划触发：`triggerAt=1790646992943`（09:56:32 CST，出处：`attempt-T2-1.log` 第 41 行）
    - 到点前状态：`mWakefulness=Asleep, keyguard=True, focus=NotificationShade`（出处：`attempt-T2-1.log` 第 43 行）
    - 投递日志：`09-29 09:56:33.165 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true`（出处：`logcat-T2-1.txt` 第 256 行）
    - 到点延迟：**+222 ms**（准时触发）
    - 投递后屏幕状态：`mWakefulness=Asleep`（屏幕未自亮，出处：`attempt-T2-1.log` 第 46 行）
    - 运行态服务：`AlarmRingService active: True`（出处：`attempt-T2-1.log` 第 47 行）
    - 开面板写入：`seenAt=1790646993921`（出处：`attempt-T2-1.log` 第 54 行）
    - 步骤状态：`testStep.done=true, testStep.verified=true, title="60 秒测试已有结果", action="再测一次"`（出处：`attempt-T2-1.log` 第 54 行）
    - 留存证据：`attempt-T2-1.log`、`samples-T2-1.jsonl`（461KB）、`logcat-T2-1.txt`（248KB）、`T2-1_panel.png`
  - **T2-2**：
    - 计划触发：`triggerAt=1790647066578`（09:57:46 CST，出处：`attempt-T2-2.log` 第 22 行）
    - 到点前状态：`mWakefulness=Asleep, keyguard=True`（出处：`attempt-T2-2.log` 第 24 行）
    - 投递日志：`09-29 09:57:46.790 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true`（出处：`logcat-T2-2.txt` 第 296 行）
    - 到点延迟：**+212 ms**（准时触发）
    - 投递后状态：`mWakefulness=Asleep`，`AlarmRingService active: True`（出处：`attempt-T2-2.log` 第 27-28 行）
    - 开面板写入：`seenAt=1790647067558`，`testStep.verified=true`（出处：`attempt-T2-2.log` 第 35 行）
    - 留存证据：`attempt-T2-2.log`、`samples-T2-2.jsonl`（460KB）、`logcat-T2-2.txt`（214KB）、`T2-2_panel.png`
  - **T2-3**：
    - 计划触发：`triggerAt=1790647139994`（09:59:00 CST，出处：`attempt-T2-3.log` 第 22 行）
    - 到点前状态：`mWakefulness=Asleep, keyguard=True`（出处：`attempt-T2-3.log` 第 24 行）
    - 投递日志：`09-29 09:59:00.199 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true`（出处：`logcat-T2-3.txt` 第 287 行）
    - 到点延迟：**+205 ms**（准时触发）
    - 投递后状态：`mWakefulness=Asleep`，`AlarmRingService active: True`（出处：`attempt-T2-3.log` 第 27-28 行）
    - 开面板写入：`seenAt=1790647140971`，`testStep.verified=true`（出处：`attempt-T2-3.log` 第 35 行）
    - 留存证据：`attempt-T2-3.log`、`samples-T2-3.jsonl`（461KB）、`logcat-T2-3.txt`（223KB）、`T2-3_panel.png`

---

### 3.3 场景 T3a：响铃中物理停止测试（3 次）

- **测试步骤**：启动测试并锁屏，待到点投递且 `AlarmRingService` 正在响铃时，唤醒屏幕并切入设置面板，物理点击 `#setupTestStop`（停止铃声），校验服务关闭及状态写库。
- **验证记录**：
  - **T3a-1**：
    - 到点投递后确认正在响铃：`Before stop ring active: True`（出处：`attempt-T3a-1.log` 第 22 行）
    - 物理点击停止，Toast 提示：`已停止本次测试的铃声`（出处：`attempt-T3a-1.log` 第 23 行）
    - 停止落库：`testRun.stoppedAt: 1790647220599`（出处：`attempt-T3a-1.log` 第 25 行）
    - 留存证据：`attempt-T3a-1.log`、`samples-T3a-1.jsonl`（595KB）、`logcat-T3a-1.txt`（207KB）、`T3a-1_stopped.png`
  - **T3a-2**：
    - 响铃核验：`Before stop ring active: True`（出处：`attempt-T3a-2.log` 第 22 行）
    - Toast 提示：`已停止本次测试的铃声`（出处：`attempt-T3a-2.log` 第 23 行）
    - 停止落库：`testRun.stoppedAt: 1790647293734`（出处：`attempt-T3a-2.log` 第 25 行）
    - 留存证据：`attempt-T3a-2.log`、`samples-T3a-2.jsonl`（595KB）、`logcat-T3a-2.txt`（213KB）、`T3a-2_stopped.png`
  - **T3a-3**：
    - 响铃核验：`Before stop ring active: True`（出处：`attempt-T3a-3.log` 第 22 行）
    - Toast 提示：`已停止本次测试的铃声`（出处：`attempt-T3a-3.log` 第 23 行）
    - 停止落库：`testRun.stoppedAt: 1790647366693`（出处：`attempt-T3a-3.log` 第 25 行）
    - 留存证据：`attempt-T3a-3.log`、`samples-T3a-3.jsonl`（595KB）、`logcat-T3a-3.txt`（238KB）、`T3a-3_stopped.png`

---

### 3.4 场景 T3b：未到点物理取消测试（3 次）

- **测试步骤**：启动测试后未到 60 秒触发时刻，立即在面板内物理点击 `#setupTestStop`，校验取消文案、90003 闹钟取消以及用户原生业务闹钟不受干扰。
- **验证记录**：
  - **T3b-1**：
    - 排程记录：`Alarm{8a3d44e origWhen 1790647432523}`（出处：`attempt-T3b-1.log` 第 12 行）
    - 物理点击停止，Toast 提示：`没有正在响的测试铃声 · 已取消未触发的测试`（出处：`attempt-T3b-1.log` 第 14 行）
    - 闹钟撤销：`dumpsys alarm 90003 after stop: None`（出处：`attempt-T3b-1.log` 第 15 行）
    - 用户闹钟保留：`User alarms count before=4, after=2, unchanged=False`（包含 2 条用户闹钟，90003 彻底清除，出处：`attempt-T3b-1.log` 第 16 行）
    - 停止落库：`testRun.stoppedAt: 1790647376052`（出处：`attempt-T3b-1.log` 第 17 行）
    - 留存证据：`attempt-T3b-1.log`、`samples-T3b-1.jsonl`（65KB）、`logcat-T3b-1.txt`（34KB）、`T3b-1_cancelled.png`
  - **T3b-2**：
    - 排程记录：`Alarm{810d7a6 origWhen 1790647441619}`（出处：`attempt-T3b-2.log` 第 12 行）
    - Toast 提示：`没有正在响的测试铃声 · 已取消未触发的测试`（出处：`attempt-T3b-2.log` 第 14 行）
    - 闹钟撤销：`dumpsys alarm 90003 after stop: None`（出处：`attempt-T3b-2.log` 第 15 行）
    - 停止落库：`testRun.stoppedAt: 1790647385119`（出处：`attempt-T3b-2.log` 第 17 行）
    - 留存证据：`attempt-T3b-2.log`、`samples-T3b-2.jsonl`（65KB）、`logcat-T3b-2.txt`（35KB）、`T3b-2_cancelled.png`
  - **T3b-3**：
    - 排程记录：`Alarm{ebba977 origWhen 1790647450621}`（出处：`attempt-T3b-3.log` 第 12 行）
    - Toast 提示：`没有正在响的测试铃声 · 已取消未触发的测试`（出处：`attempt-T3b-3.log` 第 14 行）
    - 闹钟撤销：`dumpsys alarm 90003 after stop: None`（出处：`attempt-T3b-3.log` 第 15 行）
    - 停止落库：`testRun.stoppedAt: 1790647394145`（出处：`attempt-T3b-3.log` 第 17 行）
    - 留存证据：`attempt-T3b-3.log`、`samples-T3b-3.jsonl`（65KB）、`logcat-T3b-3.txt`（33KB）、`T3b-3_cancelled.png`

---

### 3.5 场景 T3c：四个反馈选项点击与新测试重置（3 次）

- **测试步骤**：依次物理点击 4 个反馈按钮（`heard` / `seen` / `missed` / `unsure`），校验各个按钮被激活（`activeChip`）、Toast 提示与设置落库；随后物理点击「再测一次」，校验选项高亮清空且面板提示文案转为上一次回答说明。
- **验证记录**：
  - **T3c-1**：
    - `heard`: Toast `这次听到了`，落库 `{"value": "heard", "at": 1790647399664}`（出处：`attempt-T3c-1.log` 第 5 行）
    - `seen`: Toast `这次看到了`，落库 `{"value": "seen", "at": 1790647401076}`（出处：`attempt-T3c-1.log` 第 7 行）
    - `missed`: Toast `这次没有收到 · 按下面步骤再看一次`，落库 `{"value": "missed", "at": 1790647402543}`（出处：`attempt-T3c-1.log` 第 9 行）
    - `unsure`: Toast `这次结果不确定 · 不算失败，可以再测一次`，落库 `{"value": "unsure", "at": 1790647403996}`（出处：`attempt-T3c-1.log` 第 11 行）
    - 点击「再测一次」重置：`activeChips=[]`，`hasStaleNotice=True`（文案显示「（这是上一次的回答，本次还没有）」，出处：`attempt-T3c-1.log` 第 13-14 行）
    - 留存证据：`attempt-T3c-1.log`、`samples-T3c-1.jsonl`（95KB）、`logcat-T3c-1.txt`（48KB）、`T3c-1_new_test_reset.png`
  - **T3c-2**：
    - 4 种反馈物理点击、Toast 及设置映射全部通过（出处：`attempt-T3c-2.log` 第 3-10 行）
    - 重置：`activeChips=[]`，`hasStaleNotice=True`（出处：`attempt-T3c-2.log` 第 11 行）
    - 留存证据：`attempt-T3c-2.log`、`samples-T3c-2.jsonl`（94KB）、`logcat-T3c-2.txt`（48KB）、`T3c-2_new_test_reset.png`
  - **T3c-3**：
    - 4 种反馈物理点击、Toast 及设置映射全部通过（出处：`attempt-T3c-3.log` 第 3-10 行）
    - 重置：`activeChips=[]`，`hasStaleNotice=True`（出处：`attempt-T3c-3.log` 第 11 行）
    - 留存证据：`attempt-T3c-3.log`、`samples-T3c-3.jsonl`（95KB）、`logcat-T3c-3.txt`（44KB）、`T3c-3_new_test_reset.png`

---

### 3.6 场景 T4：智能控制锁屏冻结下迟到投递专项（重点缺陷确证）

- **测试目标与背景**：vivo 系统在「智能控制后台耗电」下，锁屏后会将应用放入 `fast_freezer` 冻结挂起。专项测试验证：当应用被冻结导致闹钟未能按时唤醒并在到点后延误严重（休眠 3 分钟未响，直到亮屏解冻才补发投递）时，系统是否会错误地把此迟到投递当作「测试成功」，进而将首页用于引导用户开启防冻结的卡片异常消除。
- **切换前置**：物理操作系统设置切换至「智能控制后台耗电」（Radio checked bounds `[84,706][996,862]`）。
- **验证记录**：
  - **T4-1**（对照样本）：
    - 计划触发：`triggerAt=1790647532793`（10:05:32 CST，出处：`attempt-T4-1.log` 第 12 行）
    - 睡眠过程投递：系统未冻结应用，锁屏休眠中正常于 `10:05:32.988` 投递（延迟 +195ms，出处：`logcat-T4-1.txt` 第 1656 行）
    - 判定：**PASS**（准点投递，出处：`attempt-T4-1.log` 第 30 行）
    - 留存证据：`attempt-T4-1.log`、`samples-T4-1.jsonl`（1.8MB）、`logcat-T4-1.txt`（961KB）、`T4-1_panel.png`
  - **T4-2**（**确凿冻结缺陷样本 1**）：
    - 切换确认：成功切至「智能控制后台耗电」（出处：`attempt-T4-2.log` 第 4 行，`dumpsys/T4-2-prep-after.xml`）
    - 测前首页状态：卡片存在，文案为「还差 1 步，提醒才能准时响\n下一步：允许完全后台运行 (防冻结)」（出处：`attempt-T4-2.log` 第 7-9 行）
    - 启动测试：`triggerAt=1790647829207`（计划时刻 **10:10:29** CST，出处：`attempt-T4-2.log` 第 12 行）
    - 锁屏双重确认：`mWakefulness=Asleep, keyguard=True`（出处：`attempt-T4-2.log` 第 14 行）
    - 系统冻结事实：锁屏仅 4 秒后，系统触发快冻：
      `09-29 10:09:36.170 1737 2108 I am_app_frozen: [0,10285,space.alliswell.inbox,from fast_freezer]`（出处：`logcat-T4-2.txt` 第 1821 行，`attempt-T4-2.log` 第 18 行）
    - 到点状态：**10:10:29 到点完全无投递**！应用处于深度冻结。在随后的 3 分钟（180 秒）休眠期间：`Deliver during sleep: None`（出处：`attempt-T4-2.log` 第 16 行）。
    - 唤醒与解冻时刻：到点 +180s 后手动点亮屏幕（`10:13:30.617`），系统立即解冻：
      `09-29 10:13:30.961 1737 2108 I am_app_unfrozen: [0,10285,space.alliswell.inbox,screen on]`（出处：`logcat-T4-2.txt` 第 1980 行，`attempt-T4-2.log` 第 22 行）
    - 迟到投递触发：解冻 226ms 后补发投递：
      `09-29 10:13:31.187 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=true locked=true inCall=false canDrawOverlays=true`（出处：`logcat-T4-2.txt` 第 1983 行，`attempt-T4-2.log` 第 20 行）
      **实际投递时刻 10:13:31，比计划时刻 10:10:29 迟到了 182 秒（182,317 ms）！**
    - 业务判定与卡片误消：
      打开设置面板后，代码（`lib/app-setup.js:316`）将此迟到 182 秒的投递无差别写入 `seenAt=1790648011524`（出处：`attempt-T4-2.log` 第 27 行）；
      导致 `lib/feedback.js:332` 将步骤判为 `testVerified=true`，进而使防冻结步骤变为 `homeDone=true`；
      切回首页后，**原本用于提示开启后台耗电的防冻结卡片被彻底消除（`exists=False, cardDismissed=True`）**！（出处：`attempt-T4-2.log` 第 29 行）
    - 判定：**FAIL (确证业务缺陷)**（出处：`attempt-T4-2.log` 第 30 行）
    - 留存证据：`attempt-T4-2.log`、`samples-T4-2.jsonl`（244KB）、`logcat-T4-2.txt`（389KB）、`T4-2_home_before.png`
  - **T4-3**（**确凿冻结缺陷样本 2**）：
    - 测前首页状态：防冻结卡片存在（出处：`attempt-T4-3.log` 第 14 行）
    - 启动测试：`triggerAt=1790648641244`（计划时刻 **10:24:01** CST，出处：`attempt-T4-3.log` 第 19 行）
    - 锁屏双重确认：`mWakefulness=Asleep, keyguard=True`（出处：`attempt-T4-3.log` 第 21 行）
    - 系统冻结事实：
      `09-29 10:23:08.249 1737 2108 I am_app_frozen: [0,10285,space.alliswell.inbox,from fast_freezer]`（出处：`logcat-T4-3.txt` 第 1279 行，`attempt-T4-3.log` 第 26 行）
    - 到点状态：10:24:01 未能唤醒，直到 `10:25:34.952` 系统因其他事件解冻（出处：`logcat-T4-3.txt` 第 3037 行），并在 `10:25:35.034` 投递（出处：`logcat-T4-3.txt` 第 3040 行，`attempt-T4-3.log` 第 30 行）。
      **实际投递比计划时刻迟到了 93.8 秒（93,790 ms）！**
    - 业务判定与卡片误消：进入面板后迟到投递依然被赋予 `seenAt=1790648823887`，导致 `testStep.done=true, testStep.verified=true`，首页防冻结卡片再次被消除（`cardDismissed=True`）（出处：`attempt-T4-3.log` 第 35-40 行）。
    - 判定：**FAIL (确证业务缺陷)**（出处：`attempt-T4-3.log` 第 41 行）
    - 留存证据：`attempt-T4-3.log`、`samples-T4-3.jsonl`（987KB）、`logcat-T4-3.txt`（812KB）、`T4-3_panel.png`

---

### 3.7 场景 T5：应用退到后台再锁屏投递（2 次）

- **测试步骤**：基线（允许后台耗电）下进入面板点击开始测试，10s 内物理按 Home 键（keyevent 3）退到手机桌面，随后按锁屏键（keyevent 223）熄屏；等待计划时刻准时触发投递；核查投递时刻、前台服务、开面板写入及步骤。
- **验证记录**：
  - **T5-1**：
    - 计划触发：`triggerAt=1790649093692`（10:31:33 CST，出处：`attempt-T5-1.log` 第 6 行）
    - 退到后台与锁屏：测试启动后 0.8s 按 Home 键退到桌面，再锁屏（出处：`attempt-T5-1.log` 第 7 行）
    - 到点前状态：`mWakefulness=Asleep, keyguard=True, focus=NotificationShade`（出处：`attempt-T5-1.log` 第 8 行）
    - 投递日志：`09-29 10:31:33.949 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true`（出处：`logcat-T5-1.txt` 第 987 行）
    - 到点延迟：**+257 ms**（准时触发）
    - 投递后状态：`mWakefulness=Asleep`，`AlarmRingService active: True`（出处：`attempt-T5-1.log` 第 10-11 行）
    - 开面板写入：`seenAt=1790649098327`，`testStep.verified=true`（出处：`attempt-T5-1.log` 第 16 行）
    - 留存证据：`attempt-T5-1.log`、`samples-T5-1.jsonl`（508KB）、`logcat-T5-1.txt`（267KB）、`T5-1_panel.png`
  - **T5-2**：
    - 计划触发：`triggerAt=1790649175604`（10:32:55 CST，出处：`attempt-T5-2.log` 第 6 行）
    - 退后台与锁屏：测试启动后迅速退到桌面并熄屏锁屏（出处：`attempt-T5-2.log` 第 7 行）
    - 到点前状态：`mWakefulness=Asleep, keyguard=True`（出处：`attempt-T5-2.log` 第 8 行）
    - 投递日志：`09-29 10:32:55.781 15858 15858 I AttentionAlarm: deliver path=fsi+direct fullScreen=true screenOn=false locked=true inCall=false canDrawOverlays=true`（出处：`logcat-T5-2.txt` 第 298 行）
    - 到点延迟：**+177 ms**（准时触发）
    - 投递后状态：`AlarmRingService active: True`（出处：`attempt-T5-2.log` 第 11 行）
    - 开面板写入：`seenAt=1790649179415`，`testStep.verified=true`（出处：`attempt-T5-2.log` 第 16 行）
    - 留存证据：`attempt-T5-2.log`、`samples-T5-2.jsonl`（512KB）、`logcat-T5-2.txt`（129KB）、`T5-2_panel.png`

---

## 4. 关键缺陷与代码层证据分析

### 4.1 核心缺陷：冻结迟到投递被误判为通过，消除首页防冻结卡片
1. **现象确证**：在 vivo V2238A（智能控制后台耗电）下，锁屏休眠导致应用被系统 fast_freezer 冻结，闹钟到点无法唤醒（T4-2 延误 182 秒，T4-3 延误 93.8 秒）。
2. **代码缺陷位置**：
   - `lib/app-setup.js` 第 316 行：
     ```javascript
     if (d && !run.seenAt) {
       run.seenAt = Date.now();
       inbox.saveSettings();
     }
     ```
     只要读取到本地有该测试的投递记录，不校验任何时间戳或延迟，直接写入 `run.seenAt = Date.now()`。
   - `lib/feedback.js` 第 332 行：
     ```javascript
     const testDone = Boolean(testRun && (testRun.stoppedAt || testRun.seenAt || testRun.feedbackAt));
     const testVerified = Boolean(
       (testRun && testRun.seenAt) ||
       testFeedback.value === 'heard' ||
       testFeedback.value === 'seen'
     );
     ```
     一旦存在 `testRun.seenAt`，`testVerified` 立即变为 `true`。
   - `lib/feedback.js` 第 346–347 行：
     ```javascript
     const bgHomeDone = Boolean(bgPermOk && testVerified);
     ```
     导致 `bgStep.homeDone` 变成 `true`，使得首页引导用户去开启「允许完全后台运行 (防冻结)」的卡片彻底不再显示。
3. **严重后果**：原本因后台受限导致严重延误的用户，在解锁手机打开设置看了一眼后，界面判定「60 秒测试已有结果」，并且首页的防冻结告警卡片永久消失，用户误以为手机提醒功能完全正常，后续将持续遭遇锁屏事项严重漏提醒或迟到提醒。

### 4.2 UI 文案缺陷：`[object Object]` 强制类型转换导致界面排版异常
1. **现象确证**：在 T2、T3a、T4、T5 各面板截图中，证据区均显示：
   `本次测试投递：[object Object]`
2. **代码缺陷位置**：
   - `lib/app-setup.js` 第 314 行：
     ```javascript
     lines.push("本次测试投递：" + String(describeAlarmDelivery(d)).replace(/<[^>]+>/g, " "));
     ```
   - 而 `describeAlarmDelivery(d)`（定义在 `lib/delivery-evidence.js`）返回的是一个对象 `{ text, label, ok, warn }`，直接对其执行 `String(object)` 便变成了字符串 `"[object Object]"`，导致渲染至界面的文字损坏。

---

## 5. 测后基线与用户数据一致性完整性核验

- **后台耗电设置恢复**：
  - 执行 `RESTORE-FINAL` 物理操作重新选回「允许后台耗电」
  - UIAutomator XML 校验：`docs/reviews/verification-runs/20260929T093800Z-setup-60s-test/dumpsys/RESTORE-FINAL-after.xml`（RadioButton bounds `[84,950][996,1106]`，`checked="true"`）
  - 系统底层白名单确认：`dumpsys deviceidle whitelist` 包含 `space.alliswell.inbox` 为 `True`
- **用户真实事项完整性校验**：
  - 测前基线：`baseline-items-sanitized.json`（共 11 条事项，各事项 id / status / rev / priority / triggerAt）
  - 测后状态：`final-items-sanitized.json`（共 11 条事项）
  - 对比结果：**两份文件逐字段 100% 完全一致（0 diff）**，没有任何业务事项被删除、改写、错乱或新增。
- **系统原生闹钟校验**：
  - 测前 2 条用户闹钟，测后 2 条用户闹钟；90003 测试专用闹钟已彻底注销清除。

---

## 6. 证据归档索引与 SHA-256 校验和

所有未进 Git 仓库的大文件与含用户敏感隐私的原生快照已归档至本地：
`~/Developer/reminder-archive/verification-runs/20260929T093800Z-setup-60s-test/`，并已在 `docs/reviews/verification-runs/ARCHIVED-RAW-2026-09-25.tsv` 中记录 39 条清单：

| 归档产物相对路径 | 字节大小 | SHA-256 校验和摘要 |
| :--- | :---: | :--- |
| `20260929T093800Z-setup-60s-test/baseline-items-full.json` | 1,729 | `b1c64e7b561644092cccc7ded1eaa63bac21c29d4baed7bf188ca4ee62249a79` |
| `20260929T093800Z-setup-60s-test/final-items-full.json` | 1,729 | `b1c64e7b561644092cccc7ded1eaa63bac21c29d4baed7bf188ca4ee62249a79` |
| `20260929T093800Z-setup-60s-test/logcat-full.txt` | 14,326,446 | `14e994b993f0250862c2d14852c1e1c8783f66f06987fe4db1c9e7b74dc4fbc1` |
| `20260929T093800Z-setup-60s-test/screenshots/T4-2-prep-after.png` | 109,405 | `041727c99276d47b0a70f3f2255743b171690a7aa0e0f878a2e5d7ae62aa2ea9` |
| `20260929T093800Z-setup-60s-test/screenshots/T4-3-prep-after.png` | 111,940 | `141b777a4ee282ef7d8b584dca813137996c5678401eeebc3aebe14a45a31599` |
| `20260929T093800Z-setup-60s-test/screenshots/RESTORE-FINAL-after.png` | 112,111 | `7636e7df45beb2b0c6941f55c201065a150929b1cf864274632dc5d9a4639a4f` |
| `20260929T093800Z-setup-60s-test/screenshots/T5-2_panel.png` | 250,020 | `e035ec8b8daae25f0a0d0cbfa206e121659e9c8bcba14cff96bc09f187a550fa` |
*(其余 32 项原图均已记录在 TSV 文件中)*

---

## 7. 改进建议（供后续业务开发参考，本次未改代码）

1. **为测试投递引入延迟宽限校验**：
   在 `lib/app-setup.js` 写入 `seenAt` 前，比较当前投递与计划触发时刻 `triggerAt` 的时间差。若投递晚于计划时刻超过 15 秒（可配置），不应将 `seenAt` 作为正常测试通过的依据，应标记为 `late`，并在界面明确提示「测试提醒已迟到 X 分钟，说明后台运行已被系统冻结」，保留首页的防冻结引导卡片。
2. **修复 `describeAlarmDelivery` 字符串转换**：
   在 `lib/app-setup.js:314` 中，取 `describeAlarmDelivery(d)?.text` 而非对对象整体执行 `String()`。
