# PR #3 修复真机回归自测报告

- **报告性质**：实施方自测（待交回独立验收方复验，非独立验收结论）
- **测试日期**：2026-09-24 21:57–22:20 (Asia/Shanghai)
- **测试设备**：vivo V2238A / Android 16（ADB 序列号 `10ACBF2D3D000RS`），应用包名 `space.alliswell.inbox` (User 0)
- **总体结论**：**实施方自测全部通过（PASS）**。PR #3 涉及的 4 项缺陷修复（F1–F4）及基准回归（R1、R6、R7）在真机新构建候选包上均按预期生效，测试结束后环境与用户数据已完全恢复。

---

## 1. 基线与身份核验

| 项目 | 预期基线 / 要求 | 实测结果 | 核验结论 |
|---|---|---|---|
| Git HEAD | `98fef24` | `98fef249c55c49a9ff5b6fdd1bc5b8d861f7a99c` | 一致 |
| Git 状态 | 无受控文件修改 | `git status --short` 仅显示未跟踪的新 run 与 candidate 目录 | 一致 |
| `index.html` SHA-256 | PR #3 修复版本 | `27da0b4ada6a39c937f56f0d06dcc02b27ade98523eb081e8057746eda188d21` | 一致 |
| `lib/feedback.js` SHA-256 | PR #3 修复版本 | `67f579b166bee63b7bbc412e53b119feb2ba16ffcc08e15df240dd66f3f5f5e6` | 一致 |
| `lib/app-setup.js` SHA-256 | PR #3 修复版本 | `f5348eb45320a2612b22adea13712b79bddec73dcd08e79d2ede136c4b9bcbf5` | 一致 |
| `app-core.js` SHA-256 | PR #3 修复版本 | `c42cd9ed2957e160adfb0855c170bea795fb8ff11e1403f201283b2918bf81ad` | 一致 |
| `sw.js` SHA-256 | PR #3 修复版本 (v43) | `1c0fb224c5082609eb4816ec9528309792ba554fa00c6342bdff8ab67cb84ba5` | 一致 |
| 新候选 APK 路径 | 全新候选目录 | `releases/candidates/20260924T2157-pr3-regression-candidate/app-debug.apk` | 规范 |
| 新候选 APK SHA-256 | Debug 包构建产物 | `e2dff4efbcd5a27260c2cd1eff1f000caee7b9318fc1152204dbf9c53807d031` | 已记录 |
| 机上安装前 base.apk | 预期旧候选 `e14438de…` | `e14438de38b3ee05d678e15025d09c1adceebb51f67f3f8d954fb26488fe20c1` | 一致 |
| 机上覆写安装后 base.apk | 等于新候选哈希 | `e2dff4efbcd5a27260c2cd1eff1f000caee7b9318fc1152204dbf9c53807d031` | 一致 |
| 测试前用户数据基线 | 记录事项与设置 | 1 条真实事项（ID `i_24rm31samufjri6d`），`setupPromptStarted = true` | 记录在案 |

---

## 2. 候选包构建与 5 层资源闭包

1. **测试套件运行**：执行 `npm test`，退出码 0，全部 160 项单元与语义断言通过，无失败。日志完整保存在 `npm-test.log`。
2. **构建流水线**：
   - 执行 `npm run cap:sync` 同步 Web 资源；
   - 使用 OpenJDK 17 + Gradle 执行 `cd android && ./gradlew assembleDebug` 构建调试包；
   - 调试包复制至 `releases/candidates/20260924T2157-pr3-regression-candidate/app-debug.apk`。
3. **5 层资源闭包逐字节比对**：
   - 比对范围：源码根目录 → `www/` → `android/app/src/main/assets/public/` → Gradle 调试中间目录 `android/app/build/intermediates/assets/debug/public/` → 候选 APK 内 `assets/public/`；
   - 比对结果：共 39 个 Web 运行时文件，5 层 SHA-256 哈希全部逐字节一致（0 差异、0 缺失、0 多余）；
   - APK 内部 `assets/public/sw.js` 缓存名验证：`CACHE = "attention-inbox-v43"`，匹配预期；
   - 比对数据完整记录于 `resource-closure.json`。

---

## 3. 真机回归结论矩阵 (R1–R7)

| 编号 | 测试项 / 修复编号 | 实施方自测结论 | 核心判据与实测结果 | 证据路径 |
|---|---|---|---|---|
| **R1** | 安装前后记录级比对 | **PASS** | 1. 覆写安装前后基线与候选哈希严格一致；<br>2. 隔离事项 `R3P1` 的原生系统闹钟（`AlarmRingService`，origWhen `1790352060036`）安装后完好保留；<br>3. `kill -9` 冷启动后 IDB 事项无损保留（`itemsIdentical: 2`）；`settings.review` 差异仅由当前处于 21:30–23:00 晚间自投递窗口引起，完全可解释。 | `raw/step1-result.json`<br>`raw/step1-install-diff.json`<br>`raw/step1-post-install.png`<br>`raw/01-pre-install.idb-hashes.json`<br>`raw/02-post-install.idb-hashes.json` |
| **R2** | 设置引导判定 (F1) | **PASS** | 1. 真实能力回读：`diag.canDrawOverlays=true`、`diag.canUseFullScreenIntent=true`、`diag.ignoringBatteryOptimizations=false`；<br>2. 悬浮窗一步计算结果：`done=true`、`verified=true`，不再要求用户重复开启已启用的悬浮窗；<br>3. 计算得出未完成步数为 2 步（后台运行、60秒测试），第一个未完成步为「允许完全后台运行 (防冻结)」；<br>4. 「我的」页副标题显示「还差 2 步 · 检查必要设置 · 60 秒测试」；打开面板后 `#setupBody` 第一屏展示步骤即为「允许完全后台运行 (防冻结)」。 | `raw/step2-r2-result.json`<br>`raw/step2-setup-sheet.png` |
| **R3** | 冷启动设置卡片 (F2) | **PASS** | 1. 前提 `setupPromptStarted === true` 满足；<br>2. 执行 `kill -9` 杀掉进程后 `am start` 冷启动，每 100ms 采样 `#homeSetup` 与通知状态，完成 3 轮（共 268 个采样点）；<br>3. 在所有 `notifications === "unknown"` 的采样中，`#homeSetup` 恒为空，从未出现「允许发通知」字样；<br>4. 状态回读完成（`notifications === "granted"`）后，卡片正常出现，文案显示「还差 2 步：允许完全后台运行 (防冻结)」，与 R2 计算步数完全一致。 | `raw/step3-r3-result.json`<br>`raw/step3-home-setup-card.png` |
| **R4** | 收起的面板防露出 (F3) | **PASS** | 1. 依次打开并关闭：设置面板（`#sheetSetup`）、捕获面板（`#sheetItem`）、演示面板（`#sheetDemo`）、详情面板（`#sheetDetail`）；<br>2. 每次关闭 0.5s 后，检测 `.sheet` 中处于视口内且 `visibility !== "hidden"` 的泄露元素数量恒为 0；<br>3. 在 首页、未来、笔记、我的 4 个标签页截图并对底部导航栏下方（y: 2040–2400）进行放大裁剪，均无「演示（只读）」或任何面板标题露出现象；<br>4. 面板展开时均正常可见、可交互（如捕获面板输入框聚焦）。 | `raw/step4-r4-result.json`<br>`raw/step4-tab-*.png`<br>`raw/step4-tab-*-bottom.png` |
| **R5** | 首页角标显示与隐藏 (F4) | **PASS** | 1. 无到期事项时：`#navBadge.hidden === true`，计算样式 `display === "none"`，截图首页图标无红色「0」；<br>2. 隔离事项 `R3B1` 到期后：`#navBadge.hidden === false`，计算样式 `display === "grid"`，显示数字「1」；<br>3. 业务命令完成事项后：`#navBadge.hidden === true`，由于 `[hidden] { display: none !important; }` 生效，计算样式变为 `display === "none"`，角标干净隐藏。 | `raw/step5-r5-result.json`<br>`raw/step5-badge-hidden.png`<br>`raw/step5-badge-shown.png`<br>`raw/step5-badge-cleared.png` |
| **R6** | 基础回归 (通知与闹钟动作) | **PASS** | 1. 普通档事项 `R3N1`：应用在后台，到点从系统通知栏展开并点击「我知道了」，状态变为 `acknowledged` 并落库 IDB，系统通知被移除；<br>2. 重要档事项 `R3A1`：应用在后台，到点成功弹出全屏 `AlarmActivity`，点击「完成」后状态变为已完成（`status: "archived"`, `completedAt` 记录），系统通知被移除，回前台状态与 IDB 完全一致。 | `raw/step6-r6-result.json`<br>`raw/step6-alarm-activity.png`<br>`raw/step6-r3a1-completed.png` |
| **R7** | 清理与基线恢复 | **PASS** | 1. 业务命令 `deleteItem` 删除全部 R3 隔离事项；<br>2. 确认系统闹钟及通知栏中均无 R3 残留（闹钟数恢复为 0）；<br>3. 确认 `settings.setupPromptStarted` 保持基线值（True）；<br>4. `kill -9` 冷启动后 IDB 中事项 ID 集合严格等于测试前集合（仅含 `i_24rm31samufjri6d`）；<br>5. 与 `00-baseline` 相比，除 R6 写入的 2 条匿名去重 `alarmEventLog` 及自然时间心跳外，无任何其他残留。 | `raw/step7-r7-result.json`<br>`raw/step7-final-diff.json`<br>`raw/step7-final-app.png`<br>`raw/06-final-after-cleanup.idb-hashes.json` |

---

## 4. 偏差与残留说明

1. **`settings.alarmEventLog` 匿名条目**：新增两条匿名记录（`notification:2123506709:ack:1` 和 `a1790259486360_0_47311`），属于原生系统事件去重台账，按系统设计正常保留。
2. **`settings.review` 晚间窗口状态**：测试进行时正值 21:30–23:00 每日整理窗口，应用启动时按设计触发了正常的整理提醒逻辑，导致 `review.lastNotifiedAt` 和 `followupCount` 更新，与测试事项无关。
3. **零业务数据残留**：全部 4 条隔离事项（`R3P1`、`R3B1`、`R3N1`、`R3A1`）均已通过业务命令清理，用户原有唯一事项（`i_24rm31samufjri6d`）数据完好无损。

---

## 5. 隐私保护执行说明

本轮测试严格遵循隐私禁止项：
- **仓库外目录**：通知栏原始 UI dump、完整的 dumpsys notification、包含用户真实数据的 `raw.json` 原始快照均仅存放在仓库外的私有临时目录：
  `/private/tmp/pr3-device-regression-20260924T2157/raw_private/`
- **仓库内证据**：本 run 提交的所有证据文件仅包含哈希、R3 隔离测试字段、本包单包通知记录段落，以及仅在本应用前台获得焦点（`mCurrentFocus` 包含 `space.alliswell.inbox`）时截取的应用界面截图，杜绝任何外部个人隐私数据泄露。

---

## 6. 复跑指南

所有测试脚本均已保存在本 run 目录下，依赖 Python 3 及 `websocket-client`、`Pillow`，且均已配置端口自动转发：

```bash
cd docs/reviews/verification-runs/20260924T2157-pr3-device-regression

# 1. 验证 5 层资源闭包及 sw.js 缓存版本
python3 verify-resources.py

# 2. 依次重跑各回归步骤
python3 step1_install.py
python3 step2_r2_setup.py
python3 step3_r3_cold_start.py
python3 step4_r4_sheets.py
python3 step5_r5_badge.py
python3 step6_r6_regression.py
python3 step7_r7_cleanup.py
```
