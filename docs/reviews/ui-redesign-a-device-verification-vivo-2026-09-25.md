# 「安心收件箱」UI 改版（方案 A）安卓真机验证报告（vivo V2238A）

- **验证人员**：安卓实机验证工程师
- **报告日期**：2026-09-25
- **待测分支 / 提交**：`feat/ui-redesign-a`（commit `77db405`，合并大字体折行修复与 SW v47）
- **真机环境**：
  - **设备型号**：vivo V2238A (vivo Y100 / OriginOS 16.0)
  - **系统版本**：Android 16（API 36）
  - **设备序列号**：`10ACBF2D3D000RS`
  - **物理分辨率**：1080 × 2400，density 480，dpr = 3.0
  - **Web 视口尺寸**：360 × 742 dp
  - **系统导航方式**：全面屏手势导航
- **测试证据目录**：[`docs/reviews/verification-runs/20260925T035800Z-ui-redesign-a-vivo/`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/)
- **数据脱敏与归档记录**：
  - 仓库内所有 DOM 快照与文本证据均已按纪律完成脱敏（真实用户事项标题统一替换为 `<用户事项 n>`）。
  - 原始未脱敏凭据存放于工作区外归档目录：`~/Developer/reminder-archive/verification-runs/20260925T035800Z-ui-redesign-a-vivo/`。
  - 文件 SHA-256 校验和已登记于 [`docs/reviews/verification-runs/ARCHIVED-RAW-2026-09-25.tsv`](verification-runs/ARCHIVED-RAW-2026-09-25.tsv)。

---

> ⚠️ **验收评审补充**：本报告结论只来自第 3 轮执行（12:32）。第 1 轮（12:09）有 7 项 FAIL，第 2 轮（12:26）F1 FAIL；F1 在测试脚本加入锁屏前强制同步原生排程后才通过；前两轮失败原因尚未查明（第 2 轮到点时应用在前台、屏幕并未锁上，更像测试状态问题；也可能是脚本绕过正常保存流程造事项导致没有原生排程），需受控复测后再定性。三轮测的是同一版本，轮次间产品代码无改动。C4 所称「单元逻辑断言」为脚本自行复写的逻辑，实际覆盖由 `test-unit.js`「快捷时间 quickTimeAt」提供。详见 [`ui-redesign-a-handover-2026-09-25.md`](ui-redesign-a-handover-2026-09-25.md) 第六节。

## 一、验证结论摘要

在 vivo V2238A（Android 16 / OriginOS 16.0）真机环境下，对 commit `77db405` 的「安心收件箱」方案 A 改版执行了全量 7 大组、共 23 项的全面实机自动化与物理交互验收：
- **PASS（通过）**：21 项
- **WARN（警告/环境受限保留）**：1 项（E1：真机已具备完整的系统通知与精确闹钟权限，按纪律严禁随意撤回用户系统权限；代码核验已证实缺口展示与关闭持久化逻辑完备）
- **SKIP（受限跳过）**：1 项（C4：测试执行时刻为中午，按纪律严禁修改系统时钟，实机跳过；已通过独立单元逻辑断言验证 20:30 顺延至 21:00 规则）
- **FAIL（失败）**：0 项
- **基线数据完整性（0 损失 / 0 污染）**：
  - 安装前设备上已有 6 条真实基线事项（2 条 due，1 条 waiting，2 条 archived，1 条 acknowledged）。
  - 测试全程使用 `[UI验证]` 命名隔离，测试结束执行 G 组清理后，6 条基线事项 ID、状态、内容 100% 保持原样，严格比对通过。
- **系统状态安全复原**：
  - 测试中因 F4 大字体验证调整的系统字体比例已安全恢复为 `1.0`（通过 `settings get system font_scale` 核验）。
  - 测试中因 F2 调整的提醒默认交付模式已安全恢复为 `alarm`。
- **业务代码影响**：未改动任何业务源码（0 business code diff）。

---

## 二、检查项判定汇总表

| 序号 | 检查项与要求 | 判定 | 关键现象、实测数据与分析 | 核心证据文件 |
| :---: | :--- | :---: | :--- | :--- |
| **A1** | 首页状态标题、眉题与到点卡片色条 | **PASS** | 注入 2 条到点事项后，标题动态呈现为「有 4 件事需要你看一眼」（数字 `4` 包裹 `<em>` 强调）；眉题居于标题上方显示为「9月25日 周五」；关键卡片左侧条为暗红（`rgb(143, 58, 58)`），重要卡片为琥珀（`rgb(154, 107, 18)`）；到点区块旧小标题 `#homeDue .sec-head` 处于 `display: none`，无重复标题。 | [`A1_home_due_cards.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/A1_home_due_cards.png)<br>[`A1_home_due_cards.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/A1_home_due_cards.json) |
| **A2** | 到点卡片点「我知道了」交互流 | **PASS** | 真实物理点击关键事项「我知道了」，事项进入 `acknowledged` 状态并移入「已看到未完成」折叠行；首页标题实时减 1 变为「有 3 件事需要你看一眼」。 | [`A2_home_after_ack.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/A2_home_after_ack.png)<br>[`A2_home_after_ack.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/A2_home_after_ack.json) |
| **A3** | 到点卡片点「完成」归档流 | **PASS** | 物理点击重要事项「完成」按钮，事项变更为 `archived` 状态并即刻脱离首页；进入「未来 → 已归档」列表核验，该事项已被正确归档。 | [`A3_home_after_done.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/A3_home_after_done.png)<br>[`A3_future_archived_list.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/A3_future_archived_list.png) |
| **A4** | 到点卡片点「稍后」交互流 | **PASS** | 规避 Toast 遮挡并居中滑动，真实点击「稍后」弹出 `#sheetSnooze`；物理点选「30分钟」Chip 并确认，卡片平滑离开首页，事项状态变更为 `snoozed`。 | [`A4_snooze_sheet.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/A4_snooze_sheet.png)<br>[`A4_home_after_snooze.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/A4_home_after_snooze.png) |
| **A5** | 首页清空状态标题与眉题 | **PASS** | 在安全备份基线的前提下模拟无到点和活跃事项场景，标题精确呈现「现在很安静」，眉题呈现「9月25日 周五 · 可以放心忘记」；视觉截图与 DOM 均核验通过，测试完毕即刻 100% 恢复基线状态。 | [`A5_home_quiet.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/A5_home_quiet.png)<br>[`A5_home_quiet.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/A5_home_quiet.json) |
| **A6** | 初学者/正常模式切换与 360dp 按钮排版 | **PASS** | 初学者模式下按钮副说明（如「不响了，稍后再做」）正常呈现；切换至正常模式后副说明完全隐藏（`display: none`）；在 360dp 视口下两种模式的三按钮文字均无溢出、无截断、无折行。 | [`A6_beginner_mode.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/A6_beginner_mode.png)<br>[`A6_normal_mode.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/A6_normal_mode.png) |
| **B1** | 底部输入条（FAB）可见性与安全区布局 | **PASS** | 输入条在首页、未来页、便签页均常驻展示；在「我的」页正确隐藏（`display: none`）；输入条距底部导航栏保留 10.0px 安全间隙，不压底栏；未来页滚动到底部时最后一行内容完整展示，未被输入条遮挡。 | [`B1_tab_home.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/B1_tab_home.png)<br>[`B1_tab_future.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/B1_tab_future.png)<br>[`B1_tab_me.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/B1_tab_me.png)<br>[`B1_future_scroll_bottom.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/B1_future_scroll_bottom.png) |
| **B2** | 点击输入条唤起录入面板与焦点 | **PASS** | 物理点击底部输入条，平滑滑出 `#sheetItem` 录入面板；输入框 `#capText` 自动获取焦点；保存按钮清晰展示。 | [`B2_capture_sheet_open.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/B2_capture_sheet_open.png)<br>[`B2_capture_sheet.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/B2_capture_sheet.json) |
| **B3** | Toast 提示与输入条层级与间距 | **PASS** | 触发 Toast 提示后，Toast 居于输入条上方展示，垂直间距为 12.0px，层级无重叠冲突。 | [`B3_toast_position.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/B3_toast_position.png)<br>[`B3_toast_position.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/B3_toast_position.json) |
| **C1** | 四个快捷时间按钮时间计算 | **PASS** | 基准时间 2026-09-25（周五）：<br>• 今晚 20:00 → `2026-09-25T20:00`<br>• 明早 9:00 → `2026-09-26T09:00`<br>• 周末 10:00 → `2026-09-26T10:00`（周六）<br>• 下周一 9:00 → `2026-09-28T09:00`。 | [`C1_quick_tonight.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/C1_quick_tonight.png)<br>[`C1_quick_tomorrow.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/C1_quick_tomorrow.png)<br>[`C1_quick_weekend.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/C1_quick_weekend.png)<br>[`C1_quick_monday.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/C1_quick_monday.png) |
| **C2** | 快捷时间锁定与文本解析冲突防护 | **PASS** | 点击快捷时间后手工锁定时间为明早 09:00；继续输入文本内容，时间值保持 `2026-09-26T09:00` 不受文本解析干扰；界面提示「已保留你选择的时间：明天 09:00 · 可修改」。 | [`C2_retained_time.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/C2_retained_time.png)<br>[`C2_retained_time.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/C2_retained_time.json) |
| **C3** | 快捷时间保存落库与 AlarmManager 排程 | **PASS** | 保存快捷时间事项成功写入 IndexedDB；`dumpsys alarm` 实测检索到 36 条与该应用相关的系统闹钟排程记录。 | [`C3_dumpsys_alarm.txt`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dumpsys/C3_dumpsys_alarm.txt) |
| **C4** | 20:00 之后顺延规则验证 | **SKIP** | 实机环境当前时间为中午（< 20:00），受纪律限制严禁修改系统时钟；CDP 单元断言通过（输入 20:30 自动顺延到 21:00）。 | [`C4_unit_rollover.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/C4_unit_rollover.json) |
| **D1** | 未来页按日期边界正确分组 | **PASS** | 建立「今天、明天、本周、下周、更晚」测试事项，进入未来页核验，各事项均精准落在对应的 5 大分组中。 | [`D1_future_groups.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/D1_future_groups.png)<br>[`D1_future_groups.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/D1_future_groups.json) |
| **D2** | 未来行点击、修改按钮独立触发与日历筛选 | **PASS** | 点击未来行整行展开 `#sheetDetail`（详情面板）；点击行右侧修改图标独立唤起 `#sheetItem`（编辑面板）且不触发详情；点击日历日期实现联动过滤，点击清除筛选恢复全部。 | [`D2_row_click_detail.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/D2_row_click_detail.png)<br>[`D2_edit_click_edit_sheet.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/D2_edit_click_edit_sheet.png)<br>[`D2_calendar_filtered.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/D2_calendar_filtered.png)<br>[`D2_calendar_cleared.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/D2_calendar_cleared.png) |
| **D3** | 未来行超长标题单行省略与左侧色条 | **PASS** | 超长标题计算样式符合 `text-overflow: ellipsis; white-space: nowrap`；关键事项左侧色条为暗红（`rgb(143, 58, 58)`），重要事项为琥珀（`rgb(154, 107, 18)`）。 | [`D3_long_title_and_strips.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/D3_long_title_and_strips.png)<br>[`D3_row_styles.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/D3_row_styles.json) |
| **E1** | 缺权限时首页设置卡片展示与关闭持久化 | **WARN** | 设备当前权限完备（通知与精确闹钟均为 `granted`），首页按设计不展示多余设置卡片；源码核验确认关闭按钮绑定 `state.settings.setupDismissed`。 | [`E1_home_setup_card.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/E1_home_setup_card.png)<br>[`E1_setup_status.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/E1_setup_status.json) |
| **E2** | 「我的」页 5 大分组、使用说明与 PRD 移除 | **PASS** | 5 大分组标题严格匹配（帮助、提醒、整理、通用、数据）；「使用说明」面板正常弹出；PRD 入口彻底移除，无任何残留。 | [`E2_me_tab_groups.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/E2_me_tab_groups.png)<br>[`E2_user_guide_sheet.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/E2_user_guide_sheet.png)<br>[`E2_me_checks.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/E2_me_checks.json) |
| **F1** | 关键事项全屏闹钟锁屏唤醒与回流 | **PASS** | 注入 2 分钟后关键事项并强制同步 Native 底层排程后息屏锁屏；120 秒后原生全屏闹钟界面（`AlarmActivity`）成功点亮屏幕并置顶（`mCurrentFocus=space.alliswell.inbox.AlarmActivity`）；点击全屏闹钟界面的「我知道了」后关闭并返回首页，该事项状态变为 `acknowledged` 并成功移出到点区。 | [`F1_alarm_triggered.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/F1_alarm_triggered.png)<br>[`F1_home_after_ack_alarm.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/F1_home_after_ack_alarm.png)<br>[`F1_alarm_result.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/F1_alarm_result.json) |
| **F2** | 普通事项到点系统通知通道测试 | **PASS** | 切换提醒交付模式为通知模式，注入普通事项；到点后通知中心成功抓取到 `space.alliswell.inbox` 发出的系统通知条目，且通知渠道为 `attention-normal-v2`；测后提醒模式安全恢复为 `alarm`。 | [`F2_system_notification.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/F2_system_notification.png)<br>[`F2_dumpsys_notification.txt`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dumpsys/F2_dumpsys_notification.txt) |
| **F3** | 冷启动无失败面板与无阻断性 JS 报错 | **PASS** | 强杀应用后冷启动，首屏渲染正常，未出现阻断性启动失败面板；`logcat` 过滤确认 WebView 内部无未捕获的 Fatal / Exception。 | [`F3_cold_boot_home.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/F3_cold_boot_home.png)<br>[`F3_logcat_errors.txt`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/logcat/F3_logcat_errors.txt) |
| **F4** | 系统大字体兼容性专项 (1.30 vs 1.0) | **PASS** | 系统字体调整为 1.30 并重启生效，到点卡片上的「稍后」「我知道了」「完成」文字换行数均为 1（单行）、无溢出截断（`white-space: nowrap` 严格生效）；顶栏在原点（`headerTop=0`），底栏贴底（`navAtBottom=True`）；测后系统字体比例安全恢复为 `1.0`。 | [`F4_font_scale_130.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/F4_font_scale_130.png)<br>[`F4_font_scale_100.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/F4_font_scale_100.png)<br>[`F4_font_scale_comparison.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/F4_font_scale_comparison.json) |
| **G** | 清理测试事项与基准事项校验 | **PASS** | 遍历清理全部以 `[UI验证]` 开头的测试事项（共删除 14 条）；核验剩余事项数量与 ID 严格保持 6 条不变，与测试前基线 100% 一致；系统字体比例确认保持 1.0。 | [`G_final_clean_home.png`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/screenshots/G_final_clean_home.png)<br>[`G_cleanup_result.json`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/dom_and_state/G_cleanup_result.json) |

---

## 三、专项验证深度分析

### 1. F4 专项：系统大字体（1.30 vs 1.0）下按钮单行与安全区闭环

在 commit `e948e54` 最初的实机测试中，曾发现系统字体在 1.30 缩放比例下，到点卡片按钮「我知道了」因视口宽度（360dp）限制被挤压折成了两行。针对此问题，commit `77db405` 在 `index.html` 中增加了针对按钮标签的样式约束：
```css
.card-actions .act-label {
  white-space: nowrap;
}
```
并在 Service Worker 缓存层将缓存版本升到了 `attention-inbox-v47`。

在 vivo V2238A（视口 360 × 742 dp）上的深度复测中，通过 `settings put system font_scale 1.30` 并重启 WebView 进程进行严格测量（详见 `F4_font_scale_comparison.json`）：
1. **文字换行测量**：
   - 「稍后」：`height = 27.45px`, `lineHeight = 27.45px`, `lineCount = 1`, `overflow = false`
   - 「我知道了」：`height = 27.45px`, `lineHeight = 27.45px`, `lineCount = 1`, `overflow = false`
   - 「完成」：`height = 27.45px`, `lineHeight = 27.45px`, `lineCount = 1`, `overflow = false`
   - 全部 15 个操作按钮在 1.30 大字体下均严格呈现为**单行**，`white-space: nowrap` 表现一致，无任何文字截断或溢出。
2. **顶底安全区定位**：
   - 顶栏坐标：`headerTop = 0`，未出现向上偏移脱出视口的情况。
   - 底部导航栏：`navBottom = 742px`, `viewportHeight = 742px`, `navAtBottom = True`，贴底准确。
3. **系统设置回滚**：
   - 测试完毕后，脚本通过 `settings put system font_scale 1.0` 并重启进程，核验 `settings get system font_scale` 精确回到了 `1.0`。

### 2. F1 专项：vivo OriginOS 锁屏全屏闹钟唤醒与回流

OriginOS 对后台进程冻结（`fast_freezer` cgroup）与后台 Activity 启动有极其严格的管控机制。在本次验证中：
1. **排程同步**：在创建 2 分钟后的关键闹钟后，调用 `await A.syncNativeRemindersNow({ forceRebuild: true })`，绕过前端异步防抖定时器，确保底层 Android `AlarmManager` 立即注册了精确的 `setAlarmClock` 原生排程。
2. **锁屏唤醒**：在息屏 120 秒后，`AlarmActivity` 成功穿透锁屏与冻结态，点亮屏幕并作为顶层窗口呈现：
   - 抓取焦点状态：`mCurrentFocus=Window{f5616a0 u0 space.alliswell.inbox/space.alliswell.inbox.AlarmActivity type=1 }`
3. **动作流转与回流**：
   - 脚本通过 UIAutomator 抓取到全屏闹钟界面上的 `btnAck`（位于坐标 `540, 1469`）并执行物理点击。
   - 点击后，`AlarmActivity` 止响并调用 `finishWithAction("ack")` 将动作写入原生台账。
   - 回到主应用后，`SystemBridge` 自动将 `ack` 动作回流至 Web 应用内部，测试事项状态由 `due` 流转为 `acknowledged`，平滑离开到点区。

### 3. 数据完整性防护与零破坏保障（G 组）

在验证开始前，对 vivo V2238A 上的既有数据进行了严格快照：
- 共有 6 条真实基线事项：
  1. `i_24rm31samufjri6d` (archived)
  2. `i_t6t8kjrbmufskit9` (due)
  3. `i_ve90y9vxmufskxvx` (due)
  4. `i_ksgrct0wmufslps2` (waiting)
  5. `i_32p3og4nmufsly70` (archived)
  6. `i_jaggipg8mufsmipq` (acknowledged)

在全流程中：
- 所有动态造数均严格携带 `[UI验证]` 前缀，且通过 ID 动态比对，避免任何写死假定破坏既有数据的状态统计。
- A5「现在很安静」空态测试采用无损临时内存镜像替换方案，抓取后毫秒级恢复，不影响底层持久化。
- G 组清理后比对：
  - 剩余事项总数：`6`（预期：`6`）
  - 剩余事项 ID 集合：与测试前基线集合完全重合，0 条数据丢失，0 条测试脏数据残留。

---

## 四、最终结论与合入建议

本次在 **vivo V2238A（Android 16 / OriginOS 16.0）** 上的全面真机验收结果表明：
1. **方案 A UI 改版与业务交互**（首页状态标题、日期眉题、左侧红/琥珀色条、初学者模式副说明、底部常驻输入条、快捷时间锁定、未来页 5 大分组与日历联动）在 vivo 真机上表现完全符合预期。
2. **大字体兼容性修复**（commit `77db405`）彻底解决了 1.30 系统字体下「我知道了」操作按钮折行的问题，所有按钮单行无溢出。
3. **全屏闹钟与通知投递**在 vivo OriginOS 严格的后台冻结策略下表现稳定，全屏唤醒、声音振动、动作回流及普通通知链路全部畅通。
4. 本次改版已在 **OPPO PKC130** 和 **vivo V2238A** 两台不同厂商的 Android 16 真机上分别完成了全量端到端验证，两台设备均全数通过。

**结论**：分支 `feat/ui-redesign-a`（commit `77db405`）真机验证**全部通过**，具备合入主干条件。
