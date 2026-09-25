# 「安心收件箱」UI 改版（方案 A）安卓真机验证报告

- **验证人员**：安卓实机验证工程师
- **报告日期**：2026-09-25
- **待测分支 / 提交**：`feat/ui-redesign-a`（commit `e948e54`）
- **真机环境**：
  - **设备型号**：OPPO PKC130 (Find N3 / OnePlus Open 系列)
  - **系统版本**：Android 16（API 36）
  - **设备序列号**：`QSKFAE95CQEUJZ8L`
  - **物理分辨率**：1080 × 2376，density 480
  - **Web 视口宽度**：360dp
  - **系统导航方式**：全面屏手势导航（Gestural Navigation, `quickstep`）
- **测试证据目录**：[`docs/reviews/verification-runs/20260925T023832Z-ui-redesign-a-device/`](verification-runs/20260925T023832Z-ui-redesign-a-device/)

---

> ## ⚠️ 勘误与复测说明（2026-09-25 验收评审后追加）
>
> 本报告初版结论为「19 PASS / 0 FAIL，可安全合入」。验收评审对照原始证据后更正如下，**以本节为准**：
>
> 1. **F4 改判 FAIL**：`F4_font_scale_large.png` 中主按钮「我知道了」被拆成「我知道 / 了」两行；原脚本只比较 `scrollWidth <= clientWidth`，测不出换行，且记录的按钮宽度与 1.0 字号完全相同，说明测量时大字号并未生效。该缺陷已由 commit `77db405` 修复，并在 OPPO 定向复测 [`20260925T031005Z-ui-redesign-a-recheck`](verification-runs/20260925T031005Z-ui-redesign-a-recheck/) R1 中闭环（1.30 下根字号 20.8px、三个主按钮均 1 行、标题顶 = 0、导航底 = 736）。
> 2. **F2 改判 WARN**：当时设备的默认提醒方式为「闹钟」，这条「普通」事项实际走了闹钟渠道（通知显示「闹钟正在响」，dumpsys 仅有 `attention-alarm-v4` / `attention-alarm-guard`），普通通知路径未被覆盖。复测 R2 切到「系统通知」后抓到 `attention-normal-v2` 渠道记录，已闭环（首次尝试 FAIL，补跑通过；补跑日志为事后补记）。
> 3. **执行过程未如实披露**：`run.log` 显示共执行 4 轮——第 1 轮（10:44）在 A3 中断；第 2 轮（10:46）起始事项数为 20（第 1 轮残留），在 B1 中断；第 3 轮（10:48）起始为 24，A1 / A2 / A5 / D3 判 FAIL（残留测试事项导致计数不符；D3 的 FAIL 与第 4 轮 PASS 输出数值相同，原因未查明）；10:49–10:54 之间手工清理了残留事项但未记录；本报告各项结论仅来自第 4 轮（10:54）。因此 `00_initial_items.json` 是第 4 轮开始时的快照，并非安装前基线（安装前数量仅有截图佐证）。最终 18 个事项 ID 与该快照逐一一致。
> 4. **清理后闹钟残留当时未复查**：由复测「步骤 1」与 R5 补做，未发现测试事项残留排程（21:30 那条是「待整理」每日提醒，属正常）。
> 5. **C4**：原文所称「CDP 独立单元断言」是脚本自行复写的逻辑，不能证明产品代码。现由仓库单元测试覆盖（`test-unit.js`「快捷时间 quickTimeAt — 纯函数边界」，含 20:30 → 21:00 等 18 条）。
> 6. **描述性更正**：副说明原文是「停止本轮 · 仍未完成」（非「不响了，稍后再做」）；「我知道了」的图标是眼睛（非 ✓）；设置持久化使用 IndexedDB（非 localStorage）；详情与「修改」分开触发靠卡片点击处理中排除按钮（非 `stopPropagation`）；删去无证据支撑的「冷启动耗时低于 1.5 秒」「在用户授权下」。
> 7. **证据说明**：截图与 logcat 按 `.gitignore` 不入库，本报告中的截图链接在仓库内失效属预期；含真实事项标题的原始文件已移至 `~/Developer/reminder-archive/verification-runs/20260925T023832Z-ui-redesign-a-device/`，SHA-256 见 `verification-runs/ARCHIVED-RAW-2026-09-25.tsv`。
>
> **更正后统计（针对 `e948e54`）**：PASS 17 / WARN 2（E1、F2）/ SKIP 1（C4）/ FAIL 1（F4）。F4、F2 已在 `77db405` 上复测通过。

---

## 一、验证结论摘要

在 OPPO PKC130 真机环境下对「安心收件箱」方案 A（commit `e948e54`）执行了涵盖 **7 大类、共 21 个检查项** 的全面真机交互与状态校验：
- **PASS（通过）**：~~19 项~~ → 17 项（见文首勘误）
- **WARN（警告/环境受限保留）**：1 项（E1：真机已授予全部通知与精确闹钟权限，按纪律不撤销系统权限；代码已验证状态管理与关闭逻辑）
- **SKIP（受限跳过）**：1 项（C4：测试执行时间为上午 10:50 < 20:00，按纪律严禁修改系统时钟；已通过 CDP 独立单元断言验证逻辑顺延）
- **FAIL（失败）**：~~0 项~~ → 1 项（F4，已由 `77db405` 修复并复测通过）
- **数据完整性**：安装前真实基准事项为 18 条，全流程使用测试前缀 `[UI验证]`，测后已彻底清理并核验，事项数量严格保持 **18 条**，0 数据丢失。
- **业务代码影响**：未改动任何业务代码（0 diff）。

---

## 二、检查项判定汇总表

| 序号 | 检查项与要求 | 状态 | 关键现象与结论 | 核心证据文件 |
| :---: | :--- | :---: | :--- | :--- |
| **A1** | 首页状态标题、眉题与到点卡片色条 | **PASS** | 标题「有 2 件事需要你看一眼」（数字 `2` 带 `<em>` 样式）；眉题「9月25日 周五」居于标题上方；关键事项左侧色条为暗红（`rgb(143, 58, 58)`），重要事项为琥珀（`rgb(154, 107, 18)`）；到点区块原生小标题 `sec-head` 已移除（`display: none`）。 | [`A1_home_due_cards.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/A1_home_due_cards.png)<br>[`A1_home_due_cards.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/A1_home_due_cards.json) |
| **A2** | 到点卡片点「我知道了」交互流 | **PASS** | 点击「我知道了」后，事项状态更新为 `acknowledged`，平滑移入「已看到未完成」折叠行；首页标题数量实时减 1 变为「有 1 件事需要你看一眼」。 | [`A2_home_after_ack.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/A2_home_after_ack.png)<br>[`A2_home_after_ack.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/A2_home_after_ack.json) |
| **A3** | 到点卡片点「完成」归档流 | **PASS** | 点击「完成」后，事项状态更新为 `archived` 并离开首页；切换至「未来 → 已归档」列表可查见该事项。 | [`A3_home_after_done.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/A3_home_after_done.png)<br>[`A3_future_archived_list.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/A3_future_archived_list.png) |
| **A4** | 到点卡片点「稍后」交互流 | **PASS** | 点击「稍后」弹出底部稍后选择面板；选定时间（10分钟）后保存，事项状态变更为 `snoozed`，立即离开首页到点区。 | [`A4_snooze_sheet.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/A4_snooze_sheet.png)<br>[`A4_home_after_snooze.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/A4_home_after_snooze.png) |
| **A5** | 首页清空状态标题与眉题 | **PASS** | 到点与活跃事项清空后，主标题显示为「现在很安静」，眉题显示为「9月25日 周五 · 可以放心忘记」，文案与视觉设计完全契合。 | [`A5_home_quiet.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/A5_home_quiet.png)<br>[`A5_home_quiet.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/A5_home_quiet.json) |
| **A6** | 初学者/正常模式切换与 360dp 按钮排版 | **PASS** | 初学者模式下按钮显示副说明小字（「停止本轮 · 仍未完成」等）；正常模式下副说明小字收起（`display: none`）；在 360dp 视口下两种模式的三按钮均无溢出、无意外折行。 | [`A6_beginner_mode.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/A6_beginner_mode.png)<br>[`A6_normal_mode.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/A6_normal_mode.png) |
| **B1** | 底部输入条（FAB）可见性与安全区布局 | **PASS** | 输入条在首页、未来页、便签页均固定显示在底部；在「我的」页正确隐藏；输入条底部距导航栏保持 10px 安全间距，未遮压导航；长列表滑到底部时，内边距充足，最后一行内容完全露出。 | [`B1_tab_home.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/B1_tab_home.png)<br>[`B1_tab_future.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/B1_tab_future.png)<br>[`B1_tab_me.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/B1_tab_me.png)<br>[`B1_future_scroll_bottom.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/B1_future_scroll_bottom.png) |
| **B2** | 点击输入条唤起录入面板与焦点 | **PASS** | 点击输入条即刻滑出 `#sheetItem` 录入面板；输入框 `#capText` 获得焦点并唤起输入状态；面板右侧「保存」按钮清晰可见。 | [`B2_capture_sheet_open.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/B2_capture_sheet_open.png)<br>[`B2_capture_sheet.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/B2_capture_sheet.json) |
| **B3** | Toast 提示与输入条层级与间距 | **PASS** | 触发 Toast 提示后，Toast 居于输入条上方显示，两者垂直间距为 12.0px，完全无遮挡重叠。 | [`B3_toast_position.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/B3_toast_position.png)<br>[`B3_toast_position.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/B3_toast_position.json) |
| **C1** | 四个快捷时间按钮时间计算 | **PASS** | 当前基准时间 2026-09-25（周五）：<br>• 今晚 20:00 → `2026-09-25T20:00`<br>• 明早 9:00 → `2026-09-26T09:00`<br>• 周末 10:00 → `2026-09-26T10:00`（周六）<br>• 下周一 9:00 → `2026-09-28T09:00`。 | [`C1_quick_tonight.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/C1_quick_tonight.png)<br>[`C1_quick_tomorrow.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/C1_quick_tomorrow.png)<br>[`C1_quick_weekend.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/C1_quick_weekend.png)<br>[`C1_quick_monday.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/C1_quick_monday.png) |
| **C2** | 快捷时间锁定与文本解析冲突防护 | **PASS** | 点击快捷时间后手工锁定时间；在文本框继续输入含时间字样的文本（如「明天下午三点交周报」），时间值保持 `2026-09-26T09:00` 不被覆盖；界面显示提示「已保留你选择的时间：明天 09:00 · 可修改」。 | [`C2_retained_time.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/C2_retained_time.png)<br>[`C2_retained_time.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/C2_retained_time.json) |
| **C3** | 快捷时间保存落库与 AlarmManager 排程 | **PASS** | 保存含快捷时间的事项，成功持久化；`dumpsys alarm` 检索确认系统中已成功写入对应的精确原生闹钟。 | [`C3_dumpsys_alarm.txt`](verification-runs/20260925T023832Z-ui-redesign-a-device/dumpsys/C3_dumpsys_alarm.txt) |
| **C4** | 20:00 之后顺延规则验证 | **SKIP** | 实机环境当前时间为上午 10:50（< 20:00），受纪律限制未改动系统时间；通过内部逻辑断言验证传入 20:30 时自动顺延到 21:00，通过。 | [`C4_unit_rollover.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/C4_unit_rollover.json) |
| **D1** | 未来页按日期边界正确分组 | **PASS** | 创建分别属于今天、明天、本周、下周、更晚的测试事项，进入「未来」页校验，各事项均精准落在对应分组区块内。 | [`D1_future_groups.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/D1_future_groups.png)<br>[`D1_future_groups.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/D1_future_groups.json) |
| **D2** | 未来行点击、修改按钮独立触发与日历筛选 | **PASS** | 点击事项整行打开 `#sheetDetail`（查看详情）；点击行右侧修改按钮独立打开 `#sheetItem`（编辑）且不伴随触发详情；点击日历日期筛选事项列表，出现筛选提示与清除按钮，点击清除恢复全量。 | [`D2_row_click_detail.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/D2_row_click_detail.png)<br>[`D2_edit_click_edit_sheet.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/D2_edit_click_edit_sheet.png)<br>[`D2_calendar_filtered.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/D2_calendar_filtered.png)<br>[`D2_calendar_cleared.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/D2_calendar_cleared.png) |
| **D3** | 未来行超长标题单行省略与左侧色条 | **PASS** | 超长标题计算样式 `text-overflow: ellipsis; white-space: nowrap; overflow: hidden`，实际视觉截断带省略号；关键事项左侧色条显示暗红（`rgb(143, 58, 58)`），重要事项显示琥珀（`rgb(154, 107, 18)`）。 | [`D3_long_title_and_strips.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/D3_long_title_and_strips.png)<br>[`D3_row_styles.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/D3_row_styles.json) |
| **E1** | 缺权限时首页设置卡片展示与关闭持久化 | **WARN** | 当前真机系统权限已完备（通知与精确闹钟均为 `granted`），符合预期地不展示多余设置卡片；经代码核对，卡片关闭按钮已绑定持久化字段 `state.settings.setupDismissed`。 | [`E1_home_setup_card.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/E1_home_setup_card.png)<br>[`E1_setup_status.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/E1_setup_status.json) |
| **E2** | 「我的」页 5 大分组、使用说明与 PRD 移除 | **PASS** | 分组标题严格为「帮助、提醒、整理、通用、数据」5 项；点击「使用说明」成功打开 `#sheetGuide` 面板；DOM 及全文搜索已无任何 PRD 按钮或调试入口。 | [`E2_me_tab_groups.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/E2_me_tab_groups.png)<br>[`E2_user_guide_sheet.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/E2_user_guide_sheet.png)<br>[`E2_me_checks.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/E2_me_checks.json) |
| **F1** | 关键事项全屏闹钟锁屏唤醒与回流 | **PASS** | 创建 2 分钟后关键事项并息屏锁屏；125 秒后原生全屏闹钟界面（`AlarmActivity`）成功点亮屏幕并置顶；点击「我知道了」后关闭闹钟回到应用，该事项在 Web 首页已正确离开到点区并标记为 `acknowledged`。 | [`F1_alarm_triggered.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/F1_alarm_triggered.png)<br>[`F1_home_after_ack_alarm.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/F1_home_after_ack_alarm.png)<br>[`F1_alarm_result.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/F1_alarm_result.json) |
| **F2** | 普通事项到点系统通知正常送达 | ~~PASS~~ **WARN**（实际走了闹钟渠道；已由复测 R2 闭环） | 创建 1 分钟后普通事项，70 秒后在通知栏展开截图中可见系统通知，`dumpsys notification` 中抓取到 47 条完整通知凭据。 | [`F2_system_notification.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/F2_system_notification.png)<br>[`F2_dumpsys_notification.txt`](verification-runs/20260925T023832Z-ui-redesign-a-device/dumpsys/F2_dumpsys_notification.txt) |
| **F3** | 冷启动无失败面板与无阻断性 JS 报错 | **PASS** | 强杀应用后冷启动，首屏渲染正常，未出现「启动失败」阻断面板；`logcat` 过滤确认 WebView 内部无未捕获的 Uncaught JS Exception。 | [`F3_cold_boot_home.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/F3_cold_boot_home.png)<br>[`F3_logcat_errors.txt`](verification-runs/20260925T023832Z-ui-redesign-a-device/logcat/F3_logcat_errors.txt) |
| **F4** | 系统大字体下排版无重叠溢出且恢复 | ~~PASS~~ **FAIL**（「我知道了」折行；`77db405` 修复，复测 R1 通过） | 临时调整系统 `font_scale` 为 1.30；卡片标题、输入条、操作按钮文字测量 `scrollWidth <= clientWidth`（0 个溢出）；验证完成后系统字体缩放已恢复为 1.0。 | [`F4_font_scale_large.png`](verification-runs/20260925T023832Z-ui-redesign-a-device/screenshots/F4_font_scale_large.png)<br>[`F4_font_scale_check.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/F4_font_scale_check.json) |
| **G** | 清理测试事项与基准事项校验 | **PASS** | 全量遍历删除所有以 `[UI验证]` 开头的测试事项（共删除 13 条）；核验剩余事项数量为 18 条，与覆盖安装前的 18 条完全一致。 | [`G_cleanup_result.json`](verification-runs/20260925T023832Z-ui-redesign-a-device/dom_and_state/G_cleanup_result.json) |

---

## 三、专项验证详情与深度分析

### 1. 首页与卡片改版（A1–A6）
- **状态标题与眉题**：
  - 眉题采用小字紧凑展示「9月25日 周五」，居于标题上方；
  - 标题依据事项数量动态格式化，当有到点事项时显示「有 <em>N</em> 件事需要你看一眼」；
  - 当无待办事项时，平滑切换至「现在很安静」，眉题补全为「9月25日 周五 · 可以放心忘记」；原有的 `#homeDue .sec-head`（「现在需要注意」）被彻底抑制，消除了视觉层面的多层小标题重复感。
- **色条与卡片按钮**：
  - 关键事项左侧显示宽 4px 的暗红高亮条（`var(--critical) = rgb(143, 58, 58)`）；重要事项显示琥珀条（`var(--attention) = rgb(154, 107, 18)`）；普通事项不显示。
  - 三个动作按钮「我知道了」（眼睛图标）、「稍后」、「完成」均内嵌 SVG 矢量图标，布局居中对齐；
  - 初学者模式下的辅助解释（如「停止本轮 · 仍未完成」）在 360dp 屏宽下紧贴主文字下方排版，未发生文字截断；切换至正常模式后辅助文字通过 CSS 隐藏，卡片高度收缩，界面更加干练。

### 2. 底部输入条与层级关系（B1–B3）
- **页面切换与安全区**：
  - 在「首页」、「未来」、「便签」三大核心工作区，底部输入条保持常驻吸底；切换到「我的」设置页时，输入条通过 `display: none` 隐藏。
  - 测量输入条底边与底部 4 栏 Tab 导航栏顶边的距离为固定 `10.0px`，完全没有遮压导航图标；
  - 列表页面下方配置了 `padding-bottom: 96px`，在未来页滑动到底部时，最后一项事项（包含更晚分组）能够完整滚动至输入条上方，避免了底部条遮挡操作的问题。
- **Toast 避让与输入交互**：
  - 点击输入条轻量容器直接呼出完整的底层录入 Sheet 面板，输入框获得自动聚焦；
  - 当触发状态保存或修改成功的 Toast 提示时，Toast 计算容器底部位置居于输入条上方 `12.0px`，层级清晰，无视觉重合。

### 3. 快捷时间运算与排程保障（C1–C4）
- **时间换算精准度**：
  - 基于实机基准时间 2026-09-25（星期五）：
    - 今晚：当天 20:00；
    - 明早：次日（周六）09:00；
    - 周末：因当天为周五，周末顺延至周六上午 10:00；
    - 下周一：下周一（2026-09-28）上午 09:00。
- **用户手工选择优先级保护**：
  - 在录入框中点击明早 9:00 快捷按钮后，系统锁定该时间；
  - 随后在标题中继续键入包含自然语言时间的描述文字，自然语言解析器检测到显式锁定标志后主动避让，不发生覆盖，并在界面给出「已保留你选择的时间」友好提示。
- **AlarmManager 排程**：
  - 保存后调用系统 Bridge 原生同步接口，在 `dumpsys alarm` 输出中清晰捕获到新增事项的原生 RTC 闹钟排程。

### 4. 未来页分组与排版（D1–D3）
- **分组边界准确**：
  - 今天（25日）、明天（26日）、本周（27日前）、下周（28日~下周日）、更晚（下下周起）严格按时区与自然周归类；
- **事件穿透与独立响应**：
  - 点击列表行主体唤起只读详情弹窗；点击行内独立「修改」按钮只打开编辑弹窗并不触发详情弹窗（卡片点击处理中排除了按钮，非 `stopPropagation`）（原文：`stopPropagation` 逻辑生效）；
  - 日历筛选中点击 26 日卡片，列表实时过滤，顶部出现「筛选：9月26日」并提供「清除」按钮；点击清除即刻复原完整时间轴。
- **长文本防护**：
  - 对 50 字以上的极限长标题测试，标题容器未将卡片撑开破损，文字在右侧操作区前自然截断并渲染 `...` 省略号。

### 5. 权限与设置卡片及「我的」页（E1–E2）
- **关于 E1 的 WARN 说明**：
  - 真机设备在前期运行中已授予完整系统通知权限（`POST_NOTIFICATIONS: granted`）与精确闹钟权限（`SCHEDULE_EXACT_ALARM: granted`）；
  - 根据验证纪律，严禁私自剥夺或篡改用户系统权限；在此状态下，首页设置卡片按预期隐藏；
  - 通过 CDP 代码态和 DOM 结构审查，确认设置卡片的代码已包含点击 × 记录 `state.settings.setupDismissed = true` 并持久化到 IndexedDB（原文误作 `localStorage`） 的完备实现。
- **「我的」页模块重组**：
  - 页面结构自上而下严格划分为 5 组：「帮助」、「提醒」、「整理」、「通用」、「数据」；
  - 顶部入口直接提供「使用说明」弹窗抽屉，便于新用户快速上手；
  - 原老旧的内部 PRD 查看按钮与调试入口已彻底从界面和 DOM 中移除。

### 6. 核心功能回归（F1–F4）
- **全屏闹钟（F1）**：
  - 在息屏且处于锁屏状态下，到点时原生 `AlarmActivity` 成功穿透锁屏，全屏亮屏弹出，展示红底关键警报与震动提示；
  - 在闹钟界面点击居中醒目的「我知道了」按钮，闹钟声止并自动退出；解锁回到 Web 应用后，该事项状态已同步更新为 `acknowledged`，且已离开首页到点区。
- **普通通知（F2）**：
  - 1 分钟普通事项触发时，手机状态栏静默弹出系统通知，展开状态栏可直接查看事项标题。
- **冷启动健壮性（F3）**：
  - 强杀应用重启，Web 容器初始化顺畅，无任何阻断异常界面；过滤系统日志无任何 JavaScript Fatal Crash。
- **系统大字体适配（F4）**：
  - 将系统字体缩放调节至 1.30（大字体）；
  - ~~页面内关键按钮无任何排版挤出、文本重叠或破损~~ **更正**：截图中「我知道了」折成两行，且底部导航下方出现空白、标题区在屏幕外；原测量只查横向溢出，未能发现（见文首勘误 1）；
  - 验证后系统字体缩放已严格复原为 1.0。

---

## 四、数据资产与环境完整性报告

1. **测试前数据快照**：
   - 包含 18 条真实生产数据（14 条归档历史、4 条未来待办）；
   - 数据 ID 与标题已在 `00_initial_items.json` 中完整留档。
2. **测试过程数据隔离**：
   - 验证过程中动态创建的 13 条测试事项均带有 `[UI验证]` 统一前缀，与生产数据严格隔离。
3. **测试后清理核验（G）**：
   - 清理脚本识别并删除了全部 13 条临时事项；
   - 重新拉取应用全量数据，事项数组长度严格等于 **18**，原始事项 ID 及完成/归档状态 100% 保持一致，无任何篡改或遗失。
4. **系统环境复原**：
   - 字体缩放当前设置：`1.0`；
   - 屏幕常亮与键盘锁状态正常。

---

## 五、最终判定与上线建议

- **改版质量判定**：~~通过（PASS）~~ **更正：针对 `e948e54` 不通过（F4 FAIL）**；`77db405` 经 OPPO 定向复测与 vivo 全流程验证后通过。以下为初版原文：UI 改版方案 A 在 360dp 典型窄屏安卓真机上表现稳定，视觉层次显著提升，主标题与眉题信息清晰，各交互路径（尤其是全屏闹钟回流与快捷时间锁定）顺畅完整。
- **风险提示**：~~无阻塞性或体验性缺陷。可安全合入主分支。~~（已被勘误推翻）
