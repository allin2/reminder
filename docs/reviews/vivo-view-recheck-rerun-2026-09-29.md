---
title: vivo 真机重测报告 · 视图入口补读与回前台撤销补读（PR #10，run 20260928T235800Z-vivo-view-recheck-rerun）
date: 2026-09-29
run: 20260928T235800Z-vivo-view-recheck-rerun
verdict: PASS
---

# vivo 真机重测报告：打开设置面板与切回首页主动补读原生状态（PR #10）

> ## 验收评审更正（2026-09-29，以本节为准）
>
> 核心结论成立：S1 撤销方向 1.5 s 补读 3/3 次纠正状态；S2、S3 各 (a) 1 次、(b) 3 次、(c) 0 次，新入口在「回应用 1.5 s 内就打开面板 / 切首页」时能纠正状态。以下几处已在正文中更正：
>
> 1. **§4 即时读行号**：窗口内记录到的回前台附近读取来自 `:319`（`nr.reconcile` 内部读取），不是 `:566`（onResume）；三次尝试的采样窗口都未抓到 `:566`。不影响「缓存保持 `true` 直到 1.5 s 补读」的结论（采样证实）。
> 2. **§5.3 S3-v1「补读后卡片立即出现」撤回**：点击前（`t=1790641359146`）`#homeSetup` 已含卡片 HTML——这是前一次尝试留在隐藏首页中的旧 DOM（非 home tab 不重渲染首页卡片）。采样只读 innerHTML、不读可见性，无法判定卡片的可见时刻。S2-v1 采样同理。
> 3. **§5.2 面板重绘未在真机上验证**：S2 全部尝试（含 S2-v1）MutationObserver `diff=0`，而 `openSetupSheet` 自身必然调用 `renderSetupSheetBody`，说明观察器未挂在实际被写入的节点上，该通道无效。面板随状态重绘目前只由 `test-boot-combination` 覆盖。
> 4. **§6 S4/S5 描述更正**：原文把 S4/S5 写成「开启方向 · 打开设置面板 / 切回首页」，与上轮实际不符。上轮 S4 是「开启方向 · 回前台」，S5 是「已在首页重复点击首页」。相应证据已从上轮本地提交 `138bae2`（未推送）带入 `prior-run-S4-S5/`；S4-2 无读取记录、采样为空，判 INVALID，S4 有效 2 次。
> 5. **§10 删除两条无依据推测**：`nativeStatusRefreshPromise` 只让新入口的并发调用复用同一次读取，不与 `:423` 补读互斥；「系统 UI 1.5 秒内完成切换」无数据支持。
> 6. **§2.2 基线来源**：「用户选择从『允许后台耗电』开始」在验收方可见的会话中没有记录，已改为只陈述实测事实。**用户已于 2026-09-29 确认：vivo 测试机的常态基线定为「允许后台耗电」（以程序功能最优为准）**，今后复测以此为基线；PR #9 复测测后记录的「智能控制」不再作为基线。

> 本次重测基于 `origin/fix/recheck-native-status-on-view` @ `7f390ed`，在 vivo V2238A（`10ACBF2D3D000RS`）上执行。重测严格执行 `flock` 文件锁互斥串行调度，排除了上轮测试中的并行竞争、数据出处缺失及撤销动作遗漏问题。S1、S2、S3 全部执行了基线前置校验、真机系统设置物理切换与恢复；S4、S5 沿用并引用上轮已采信数据。

---

## 1. 结论摘要

| 验证项 | 判定 | 实测核心证据摘要 |
|---|---|---|
| **版本身份一致性** | **PASS** | 设备 `base.apk`（SHA-256: `efea673...`）解包比对，`sw.js`（含 `attention-inbox-v50`）、`lib/app-native-coordinator.js`、`app-core.js` 与 PR 分支逐字节比对 **100% MATCH**。 |
| **S1: 撤销方向 · 回前台** | **PASS** | 3 次有效尝试（S1-1..3）均严格执行了撤销切换。3/3 次在回前台即时读（L566）读到旧值 `ignoring=true`；1.5s 补读（L423）在 `+1.13s ~ +1.15s` 读到 `ignoring=false` 并更新状态；首页卡片在 `+1.19s ~ +1.26s` 出现（距 1.5s 补读仅 66~120ms）。**1.5s 补读在撤销方向的作用被确凿证实**。 |
| **S2: 撤销方向 · 打开设置面板** | **PASS** | 3 次标准尝试（S2-1..3，停留 8s 等待收敛）全为 **(b)**：前序读取已拿到新值，打开面板触发 L406 补读（`origin='setup-open'`），值未变不回写；追加 1 次极速变体（S2-v1，不等 1.5s 补读直接打开面板），成功捕获 **(a)**：打开前缓存为 `true`，L406 读到 `false` 并触发回写（`changed=true`）。 |
| **S3: 撤销方向 · 切回首页** | **PASS** | 3 次标准尝试（S3-1..3，停留 12s）全为 **(b)**：前序读取已拿到新值，切首页触发 L406 补读（`origin='tab-home'`），值未变不回写；追加 1 次极速变体（S3-v1，不等 1.5s 补读直接切首页），成功捕获 **(a)**：切 tab 前缓存为 `true`，L406 读到 `false` 并触发回写（`changed=true`）。卡片可见时刻无法判定（见顶部更正 2）。 |
| **S4 / S5: 开启方向** | **PASS** | 直接采信上轮有效尝试数据（见 §6），开启方向回前台即时读已拿到新值、重复点击首页不产生读取（见 §6 更正后内容）。 |
| **开关恢复与数据完整性** | **PASS** | 测后后台耗电管理成功恢复为「允许后台耗电」（Radio checked、whitelist 包含 inbox）；11 项用户业务数据完整无损。 |

---

## 2. 版本身份与步骤 0 只读基线

### 2.1 版本身份逐字节验证
- 设备 serial: `10ACBF2D3D000RS`，型号: vivo V2238A（OriginOS 16 / Android 16，API 36）；
- 拉回设备当前已安装的 `base.apk`（归档 SHA-256: `efea673d1c48b1853baf37f73ca3103a02e287cfd7d684b3c6686ea1092d08dd`）；
- 解包后与仓库 `origin/fix/recheck-native-status-on-view` @ `7f390ed` 比对：
  - `assets/public/sw.js`: 逐字节比对一致（含 `const CACHE = "attention-inbox-v50";`）；
  - `assets/public/lib/app-native-coordinator.js`: 逐字节比对一致；
  - `assets/public/app-core.js`: 逐字节比对一致。

### 2.2 步骤 0 基线状态
本次测试前实测如下；测后恢复为同一状态。用户已于 2026-09-29 确认 vivo 测试机常态基线为「允许后台耗电」（以程序功能最优为准），本次测前测后均与之一致（见顶部更正 6）：

| 开关 / 属性 | 基线状态 | 证据文件定位 |
|---|---|---|
| 后台耗电管理 | **允许后台耗电** | `dumpsys/baseline_bgpower_detail.xml`、`dumpsys/baseline_bgpower_detail.txt`、`screenshots-sanitized/baseline_bgpower_detail.png`（Radio checked=true，`dumpsys deviceidle whitelist` 包含 `space.alliswell.inbox`） |
| 锁屏显示 | **关** | `dumpsys/baseline_allperm.xml`、`screenshots-sanitized/baseline_allperm.png` |
| 自启动 | **关** | `dumpsys/baseline_allperm.xml`、`screenshots-sanitized/baseline_allperm.png` |
| 悬浮窗 | **开** | `dumpsys/baseline_allperm.xml`、`screenshots-sanitized/baseline_allperm.png` |
| 业务数据 | **11 项**（完整无损） | 脱敏见 `baseline-items-sanitized.json`，完整原文归档于 `baseline-items-full.json` |
| 应用诊断状态 | 六项权限均具备，`ignoring=true` | `baseline-diag.json` |

---

## 3. 观察手段与堆栈映射定义

### 3.1 核心堆栈行号映射（基于 `lib/app-native-coordinator.js`）
在被测代码中，原生状态读取通过 `getNativeReminders().getPermissionState()` 进而调用 `SystemBridge.diagnose()`。本次监控探针（`INSTALL_PROBES_JS`）在 CDP 层捕获了每一次底层调用的堆栈，严格区分了三种读取触发源：
- **行号 566**（`app-native-coordinator.js:566`）：**`onResume` 回前台即时读**；
- **行号 423**（`app-native-coordinator.js:423`）：**`scheduleResumeStatusRechecks` 1.5s / 5s 补读定时器**；
- **行号 406**（`app-native-coordinator.js:406`）：**`refreshNativeStatus` 视图切换与面板入口主动补读**。

### 3.2 观察通道
1. **CDP 只读采样**（每 200ms 一次，`SAMPLE_EXPR`）：记录 `#homeSetup` 卡片 DOM、`#sheetSetup` 打开状态、应用内缓存的 `ignoringBatteryOptimizations` 状态；
2. **底层读取调用监控**（`__DIAGNOSE_MONITOR__`）：记录时间戳、执行耗时、返回值、完整堆栈与调用者归属；
3. **入口与回写探针**（`__ORIGIN_LOG__`）：拦截 `nativeCoordinator.refreshNativeStatus(origin)`，记录进入时的 `beforeIgn`、完成时的 `afterIgn` 及是否触发了状态变更（`changed: true / false`）；
4. **DOM 变动监听**（`__RR_MUT__`）：MutationObserver 挂载于 `#setupBody`；
5. **系统日志**：全程后台抓取 `logcat -b main,system,events -v threadtime`（归档于 `logcat-full.txt`）。

---

## 4. 场景 S1：撤销方向 · 回前台（3 次有效尝试）

### 4.1 操作定义
1. 确保系统处于基线「允许后台耗电」，应用停留于首页（`#homeSetup` 为空，`ignoring=true`）；
2. 进入系统设置，切为「智能控制后台耗电」（触发物理撤销），记录切换时刻 `Tswitch`；
3. 返回应用，记录回到前台时刻 `Tresume`；
4. 观察回前台后 6.5 秒内回前台附近的读取（实测为 L319 reconcile 读取，见顶部更正 1）、1.5s 补读（L423）、5s 补读（L423）及首页卡片出现时刻。

### 4.2 实测数据与详细时序

| 尝试编号 | 切换时刻 Tswitch | 回前台时刻 Tresume | 回前台附近读取 (L319) 结果与延迟 | 1.5s 补读 (L423) 结果与延迟 | 5s 补读 (L423) 结果与延迟 | 首页卡片出现时刻与延迟 | 结论 | 证据日志行号 |
|---|---|---|---|---|---|---|---|---|
| **S1-1** | 1790640854902 | 1790640861143 | `true` @ -0.237s (t=1790640860906) | **`false`** @ **+1.150s** (t=1790640862293) | `false` @ +4.651s (t=1790640865794) | **+1.232s** (t=1790640862375) | 1.5s 补读成功纠正状态并出卡片 | `attempt-S1-1.log` L7–L15 |
| **S1-2** | 1790640899372 | 1790640905637 | `true` @ -0.255s (t=1790640905382) | **`false`** @ **+1.142s** (t=1790640906779) | `false` @ +4.642s (t=1790640910279) | **+1.262s** (t=1790640906899) | 1.5s 补读成功纠正状态并出卡片 | `attempt-S1-2.log` L7–L15 |
| **S1-3** | 1790640944163 | 1790640950450 | `true` @ -0.273s (t=1790640950177) | **`false`** @ **+1.130s** (t=1790640951580) | `false` @ +4.629s (t=1790640955079) | **+1.196s** (t=1790640951646) | 1.5s 补读成功纠正状态并出卡片 | `attempt-S1-3.log` L7–L15 |

> **出处校验说明**：
> 1. 上述 3 次尝试均有完整 start–end 生命周期（`run.log` L1~L23）；
> 2. S1-2 在执行撤销前，已明确记录基线前置检查并在 `1790640890041` 成功恢复为「允许后台耗电」（`attempt-S1-2.log` L4），排除了上轮测试未执行撤销的缺陷；
> 3. 卡片出现时刻（如 S1-1 为 `t=1790640862375`）严格落后于 1.5s 补读读出 `false` 的时刻（`t=1790640862293`）仅 **82 ms**，证明是补读回写触发了 UI 重绘。

### 4.3 核心发现：1.5s 补读在撤销方向的有效性判定
在 PR #9 验收报告中，开启方向（智能控制→允许）因系统生效快，即时读即能拿到新值，导致「1.5s 补读未被证明」。而在本次撤销方向（允许→智能控制）的 3 次严格重测中：
- 3/3 次在 `Tresume` 附近发生的读取（L319，reconcile 内部读取；窗口内未抓到 L566）均拿到旧值 `true`（系统侧底层尚未移除白名单）；
- 3/3 次均是在 **1.5s 补读（L423）** 触发时，系统才返回新值 `false`，进而触发了状态回写与首页提示卡片弹出。
- **结论：PR #9 与 PR #10 中设计的 1.5s 补读机制在撤销方向切实发挥了纠偏作用，有效性得到真机证实。**

---

## 5. 场景 S2 & S3：撤销方向 · 新入口补读归类与时序分析

### 5.1 归类标准
- **(a) 新入口补读纠正了状态**：打开面板 / 切回首页前，应用内缓存的 ignoring 仍为 `true`，新入口补读（L406）读到了 `false` 并触发回写（`changed=true`）；
- **(b) 前序读取已拿到新值**：打开面板 / 切回首页前，回前台即时读或 1.5s/5s 补读已先拿到 `false`，新入口补读读到相同值，无回写（`changed=false`）；
- **(c) 系统侧滞后超过了所有读取**：新入口补读时系统仍未生效，读到旧值。

---

### 5.2 场景 S2：撤销方向 · 打开设置面板（3 次标准尝试 + 1 次极速变体）

#### 5.2.1 实测数据

| 尝试编号 | 切换时刻 Tswitch | 回前台时刻 Tresume | 面板触发 Topen | 打开前缓存 ignoring | 打开触发补读 (L406) | 探针回写记录 changed | 打开后缓存 ignoring | 归类结果 | 证据日志行号 |
|---|---|---|---|---|---|---|---|---|---|
| **S2-1**（标准 8s 停留） | 1790640989224 | 1790640995515 | 1790641003764 | `false` | t=1790641003838, `ign=false` | `origin='setup-open', changed=false` | `false` | **(b)** 前序读取已拿到新值 | `attempt-S2-1.log` L6–L16 |
| **S2-2**（标准 8s 停留） | 1790641040515 | 1790641046765 | 1790641054988 | `false` | t=1790641055057, `ign=false` | `origin='setup-open', changed=false` | `false` | **(b)** 前序读取已拿到新值 | `attempt-S2-2.log` L6–L16 |
| **S2-3**（标准 8s 停留） | 1790641091741 | 1790641098056 | 1790641106326 | `false` | t=1790641106395, `ign=false` | `origin='setup-open', changed=false` | `false` | **(b)** 前序读取已拿到新值 | `attempt-S2-3.log` L6–L16 |
| **S2-v1**（极速变体：回应用后直接打开） | 1790641143245 | 1790641149410 | **1790641149853** (+0.443s) | **`true`** | **t=1790641149910, `ign=false`** | **`origin='setup-open', changed=true`** | **`false`** | **(a)** 新入口补读纠正状态并回写 | `attempt-S2-v1.log` L6–L20 |

#### 5.2.2 分析与统计
- **标准尝试（S2-1 ~ S2-3）全为 (b)**：因为停留在「我的」页等待 8 秒时，回前台后 1.5s 补读定时器已于 `Tresume + 1.1s` 抢先执行并将缓存更新为 `false`。因此用户 8 秒后再点开设置面板时，状态已是最新，L406 补读读出相同值，不触发无谓的重复回写。
- **追加极速变体（S2-v1）成功捕获 (a)**：在用户从系统设置返回后立刻（+0.443s，此时 1.5s 补读定时器尚未触发，应用缓存仍为旧值 `true`）点开设置面板。面板入口发起的 L406 补读在 `t=1790641149910` 读到了底层的最新状态 `false`，并成功触发回写（`changed=true`），将缓存即时纠正为 `false`。
- **归类统计**：**(a) 1 次，(b) 3 次，(c) 0 次**。
- **面板重绘**：全部 S2 尝试 MutationObserver `diff=0`，观察通道无效，面板重绘未在真机上验证（见顶部更正 3）。

---

### 5.3 场景 S3：撤销方向 · 切回首页（3 次标准尝试 + 1 次极速变体）

#### 5.3.1 实测数据

| 尝试编号 | 切换时刻 Tswitch | 回前台时刻 Tresume | 切首页时刻 Ttab | 切首页前缓存 ignoring | 切首页触发补读 (L406) | 探针回写记录 changed | 切首页后缓存 ignoring | 首页卡片情况 | 归类结果 | 证据日志行号 |
|---|---|---|---|---|---|---|---|---|---|---|
| **S3-1**（标准 12s 停留） | 1790641185351 | 1790641191701 | 1790641203953 | `false` | t=1790641204012, `ign=false` | `origin='tab-home', changed=false` | `false` | 切回即显示 | **(b)** 前序读取已拿到新值 | `attempt-S3-1.log` L6–L16 |
| **S3-2**（标准 12s 停留） | 1790641241077 | 1790641247341 | 1790641259577 | `false` | t=1790641259632, `ign=false` | `origin='tab-home', changed=false` | `false` | 切回即显示 | **(b)** 前序读取已拿到新值 | `attempt-S3-2.log` L6–L16 |
| **S3-3**（标准 12s 停留） | 1790641296860 | 1790641303144 | 1790641315363 | `false` | t=1790641315411, `ign=false` | `origin='tab-home', changed=false` | `false` | 切回即显示 | **(b)** 前序读取已拿到新值 | `attempt-S3-3.log` L6–L16 |
| **S3-v1**（极速变体：回应用后直接切首页） | 1790641352494 | 1790641358749 | **1790641359185** (+0.436s) | **`true`** | **t=1790641359237, `ign=false`** | **`origin='tab-home', changed=true`** | **`false`** | 无法判定（旧 DOM） | **(a)** 新入口补读纠正状态并回写 | `attempt-S3-v1.log` L6–L20 |

#### 5.3.2 分析与统计
- **标准尝试（S3-1 ~ S3-3）全为 (b)**：同 S2，停留在「我的」页 12 秒期间，1.5s 补读已先将应用状态更新完毕。由于既有代码守卫（`app-core.js:1847`）只在 home tab 挂载卡片，切回首页时虽然触发了 L406 补读，但状态无需更新，卡片直接渲染。
- **追加极速变体（S3-v1）成功捕获 (a)**：在用户从系统设置返回后立刻（+0.436s，此时 1.5s 补读尚未到达）点击首页 Tab。切首页动作在 `t=1790641359237` 触发 L406 补读，先于 1.5s 补读读到了系统底层的新值 `false`，成功触发状态回写（`changed=true`），卡片可见时刻无法由本次采样判定（见顶部更正 2）。
- **归类统计**：**(a) 1 次，(b) 3 次，(c) 0 次**。

---

## 6. 场景 S4 & S5（引用上轮 run 20260928T164500Z 数据）

上轮除 S4、S5 外的数据验收不通过；S4、S5 的证据从上轮本地提交 `138bae2` 带入本 run 的 `prior-run-S4-S5/` 目录（上轮原始 logcat 等在 `~/Developer/reminder-archive/verification-runs/20260928T164500Z-vivo-view-recheck/`）。

注意：上轮存在脚本并行，S4-1 开始时（00:59:05）S2-3 也在同一秒记录了 start，但 S2-3 此后没有任何日志行；S4-2 没有 end 行。

### 6.1 S4 开启方向 · 回前台（智能控制 → 允许）

| 尝试 | 回前台 t_ref | onResume 读取 (L566) | 1.5 s 补读 (L423) | 5 s 补读 (L423) | 判定 | 出处 |
|---|---|---|---|---|---|---|
| S4-1 | 1790614814884 | `true` @ t=1790614814809 | `true` @ +1.485 s | `true` @ +4.985 s | 有效：即时读已拿到新值 | `prior-run-S4-S5/attempt-S4-1.log` |
| S4-2 | 1790614879189 | — | — | — | **INVALID**：无读取记录、无 end 行、采样为空 | `prior-run-S4-S5/attempt-S4-2.log` |
| S4-3 | 1790614913406 | `true` @ t=1790614913339 | `true` @ +1.514 s | `true` @ +5.014 s | 有效：即时读已拿到新值 | `prior-run-S4-S5/attempt-S4-3.log` |

开启方向与 PR #9 行为一致，未退化；补读按期触发，但因即时读已拿到新值，未起纠正作用。

### 6.2 S5 已在首页时重复点击首页 tab

| 尝试 | 点击前读取计数 | 连点 5 次后 | 增量 | 出处 |
|---|---|---|---|---|
| S5-1 | 1 | 1 | 0 | `prior-run-S4-S5/attempt-S5-1.log` |
| S5-2 | 1 | 1 | 0 | `prior-run-S4-S5/attempt-S5-2.log` |
| S5-3 | 1 | 1 | 0 | `prior-run-S4-S5/attempt-S5-3.log` |

S5 在上轮各场景之前单独执行（00:47–00:48），无并行干扰。已在首页时重复点击不触发 `refreshNativeStatus`，符合 `lib/app-events.js` 中 `prevTab !== "home"` 的判断。

---

## 7. 串行互斥纪律与日志审计

为杜绝上一轮出现的脚本交错与重叠问题，本轮测试全程运行于单进程 Python 驱动脚本下，并在系统层通过 `/tmp/vivo_device.lock`（`fcntl.flock(LOCK_EX)`）进行了严格的串行互斥保护。

### 7.1 起止时间线审计（摘自 `run.log`）

```
[S1-1] [1790640825488] start  --->  [1790640868720] end
[S1-2] [1790640869798] start  --->  [1790640913355] end
[S1-3] [1790640914421] start  --->  [1790640958010] end
[S2-1] [1790640959087] start  --->  [1790641009492] end
[S2-2] [1790641010561] start  --->  [1790641060795] end
[S2-3] [1790641061858] start  --->  [1790641112157] end
[S2-v1][1790641113276] start  --->  [1790641155670] end
[S3-1] [1790641155714] start  --->  [1790641210129] end
[S3-2] [1790641211194] start  --->  [1790641265677] end
[S3-3] [1790641266754] start  --->  [1790641321480] end
[S3-v1][1790641322586] start  --->  [1790641365402] end
[RESTORE][1790641365446] start ---> [1790641387426] end
```

- **审计结论**：前一次尝试的 `end` 时刻严格早于后一次尝试的 `start` 时刻，**区间重叠度为 0**，严格串行互斥执行。
- **文件完整性**：所有 11 次尝试均产出了对应且非空的 `attempt-*.log`（8~21行）、`samples-*.jsonl`（21KB~154KB）及 `dumpsys/*.xml`。

---

## 8. 测后开关恢复验证与业务数据完整性

按照用户裁决要求，测试收尾必须恢复至步骤 0 基线状态，并核验业务数据无损。

### 8.1 开关恢复证明
1. **系统 UI 状态**：
   - 界面：系统设置 → 电池 → 后台耗电管理；
   - 证据文件：`dumpsys/RESTORE-prep-after.xml` 及 `screenshots-sanitized/RESTORE-prep-after.png`；
   - 状态：`com.iqoo.powersaving:id/vos_button_opt` 对应的 RadioButton **`checked="true"`**（「允许后台耗电」项单选框蓝点高亮）。
2. **底层白名单状态**：
   - 执行 `dumpsys deviceidle whitelist`；
   - 证据：`attempt-RESTORE.log` L5：`Final whitelist has inbox: True`（包含 `user,space.alliswell.inbox`）。
3. **应用内首页状态**：
   - 证据：`screenshots-sanitized/restore_final_home.png`；
   - 状态：首页无防冻结黄色警告卡片，展示正常待办列表。

### 8.2 业务数据完整性核验
- **项数比对**：
  - 基线项数：11 项（脱敏见 `baseline-items-sanitized.json`，全量见 `baseline-items-full.json`）；
  - 收尾项数：`window.__ATTENTION_INBOX__.state.items.length === 11`；
  - 事项数据完整保留，未发生数据损坏或丢失。

---

## 9. 证据文件索引与归档

### 9.1 仓库内交付文件（脱敏，位于 `docs/reviews/verification-runs/20260928T235800Z-vivo-view-recheck-rerun/`）
- `run.log`: 全程串行调度日志；
- `attempt-S1-*.log`, `attempt-S2-*.log`, `attempt-S3-*.log`, `attempt-RESTORE.log`: 单次尝试完整日志；
- `samples-S*.jsonl`: 200ms CDP 采样明细；
- `rerun_summary.json`: 结构化指标与时序聚合；
- `dumpsys/`: 切换前后 uiautomator 布局 dump xml；
- `screenshots/`: 系统设置基线截图（4 张）；
- `screenshots-sanitized/`: 脱敏后的应用与恢复截图。

### 9.2 归档原始证据（存放在 `~/Developer/reminder-archive/verification-runs/20260928T235800Z-vivo-view-recheck-rerun/`）
- `device-base.apk`（SHA-256: `efea673d1c48b1853baf37f73ca3103a02e287cfd7d684b3c6686ea1092d08dd`）；
- `logcat-full.txt`（5.9 MB，全程 main,system,events 系统日志）；
- `baseline-items-full.json`（未脱敏的完整事项列表）；
- `screenshots/`（未脱敏真机截屏）；
- **TSV 清单注册**：全部 149 项归档文件的大小与 SHA-256 已登记并追加至 `docs/reviews/verification-runs/ARCHIVED-RAW-2026-09-25.tsv`。

---

## 10. 剩余风险与不确定性

1. **新入口只在「回应用后 1.5 s 内」起纠正作用**：超过 1.5 s，回前台补读已先更新状态（S2/S3 标准尝试全为 (b)）。系统侧撤销滞后超过 5 s 的情况本轮未出现（(c) 0 次），PR #9 复测中出现过超过 4 分钟的滞后，届时新入口的作用取决于用户何时打开面板或切回首页。
2. **首页卡片与面板重绘的可见时刻未在真机上直接观测**：本轮采样只读 DOM 内容，且面板 MutationObserver 通道无效（顶部更正 2、3）。
3. **样本量小**：各场景 3–4 次，不构成概率估计。
