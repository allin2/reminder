# UI Redesign A 真机验证证据目录索引

- **验证批次**：`20260925T023832Z-ui-redesign-a-device`
- **执行时间**：2026-09-25 10:54:34 ~ 10:59:02 (UTC+8)
- **目标分支与提交**：`feat/ui-redesign-a` (`e948e54`)
- **验证设备**：OPPO PKC130 (Android 16, API 36, Serial `QSKFAE95CQEUJZ8L`)
- **视口配置**：物理 1080×2376，density 480，Web 视口宽 360dp，全面屏手势导航
- **数据完整性**：基准事项 18 条，全流程 0 数据丢失，测后严格恢复为 18 条

> ⚠️ **勘误**：F4 应为 FAIL、F2 应为 WARN，另有 4 轮执行未披露等问题，详见 [`ui-redesign-a-device-verification-2026-09-25.md`](../../ui-redesign-a-device-verification-2026-09-25.md) 文首「勘误与复测说明」。截图与 logcat 不入库；含真实标题的原始文件已归档，哈希见 `../ARCHIVED-RAW-2026-09-25.tsv`。

---

## 目录结构说明

```
.
├── README.md                           # 本索引文档
├── run.log                             # 自动化验证全流程运行日志
├── results_summary.json                # 21 项检查点判定摘要 JSON
├── screenshots/                        # 实机真机截图（32 张）
├── dom_and_state/                      # CDP 抓取的 DOM 计算样式与应用状态快照（21 份）
├── dumpsys/                            # 系统 dumpsys alarm / notification 证据
└── logcat/                             # 冷启动 logcat 异常日志抓取
```

---

## 检查项与证据映射表

| 检查项 | 标题 | 状态 | 截图凭据 | DOM / 状态数据凭据 | 系统服务 / 日志凭据 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **A1** | 首页到点标题、眉题与色条 | **PASS** | [`A1_home_due_cards.png`](screenshots/A1_home_due_cards.png) | [`A1_home_due_cards.json`](dom_and_state/A1_home_due_cards.json) | - |
| **A2** | 点「我知道了」进入已看到未完成且数字减1 | **PASS** | [`A2_home_after_ack.png`](screenshots/A2_home_after_ack.png) | [`A2_home_after_ack.json`](dom_and_state/A2_home_after_ack.json) | - |
| **A3** | 点「完成」归档并在「未来 → 已归档」可见 | **PASS** | [`A3_home_after_done.png`](screenshots/A3_home_after_done.png)<br>[`A3_future_archived_list.png`](screenshots/A3_future_archived_list.png) | [`A3_future_archived.json`](dom_and_state/A3_future_archived.json) | - |
| **A4** | 点「稍后」弹出面板并选时间后离开首页 | **PASS** | [`A4_snooze_sheet.png`](screenshots/A4_snooze_sheet.png)<br>[`A4_home_after_snooze.png`](screenshots/A4_home_after_snooze.png) | [`A4_snooze_result.json`](dom_and_state/A4_snooze_result.json) | - |
| **A5** | 首页清空后标题「现在很安静」与眉题「· 可以放心忘记」 | **PASS** | [`A5_home_quiet.png`](screenshots/A5_home_quiet.png) | [`A5_home_quiet.json`](dom_and_state/A5_home_quiet.json) | - |
| **A6** | 初学者/正常模式切换与 360dp 按钮文字排版 | **PASS** | [`A6_beginner_mode.png`](screenshots/A6_beginner_mode.png)<br>[`A6_normal_mode.png`](screenshots/A6_normal_mode.png) | [`A6_mode_checks.json`](dom_and_state/A6_mode_checks.json) | - |
| **B1** | 底部输入条多页面可见性与安全区布局 | **PASS** | [`B1_tab_home.png`](screenshots/B1_tab_home.png)<br>[`B1_tab_future.png`](screenshots/B1_tab_future.png)<br>[`B1_tab_notes.png`](screenshots/B1_tab_notes.png)<br>[`B1_tab_me.png`](screenshots/B1_tab_me.png)<br>[`B1_future_scroll_bottom.png`](screenshots/B1_future_scroll_bottom.png) | [`B1_fab_layout.json`](dom_and_state/B1_fab_layout.json) | - |
| **B2** | 点输入条打开录入面板且自动获得焦点 | **PASS** | [`B2_capture_sheet_open.png`](screenshots/B2_capture_sheet_open.png) | [`B2_capture_sheet.json`](dom_and_state/B2_capture_sheet.json) | - |
| **B3** | toast 提示出现在输入条上方不被遮挡 | **PASS** | [`B3_toast_position.png`](screenshots/B3_toast_position.png) | [`B3_toast_position.json`](dom_and_state/B3_toast_position.json) | - |
| **C1** | 四个快捷时间按钮计算与填入 | **PASS** | [`C1_quick_tonight.png`](screenshots/C1_quick_tonight.png)<br>[`C1_quick_tomorrow.png`](screenshots/C1_quick_tomorrow.png)<br>[`C1_quick_weekend.png`](screenshots/C1_quick_weekend.png)<br>[`C1_quick_monday.png`](screenshots/C1_quick_monday.png) | [`C1_quick_times.json`](dom_and_state/C1_quick_times.json) | - |
| **C2** | 快捷时间锁定后输入文本不被覆盖 | **PASS** | [`C2_retained_time.png`](screenshots/C2_retained_time.png) | [`C2_retained_time.json`](dom_and_state/C2_retained_time.json) | - |
| **C3** | 快捷时间保存落库与系统闹钟排程写入 | **PASS** | - | - | [`C3_dumpsys_alarm.txt`](dumpsys/C3_dumpsys_alarm.txt) |
| **C4** | 今晚 20:00 已过顺延至下一个整点 | **SKIP** | - | [`C4_unit_rollover.json`](dom_and_state/C4_unit_rollover.json) | - |
| **D1** | 未来页按今天/明天/本周/下周/更晚正确分组 | **PASS** | [`D1_future_groups.png`](screenshots/D1_future_groups.png) | [`D1_future_groups.json`](dom_and_state/D1_future_groups.json) | - |
| **D2** | 未来页行详情、修改独立触发与日历筛选清除 | **PASS** | [`D2_row_click_detail.png`](screenshots/D2_row_click_detail.png)<br>[`D2_edit_click_edit_sheet.png`](screenshots/D2_edit_click_edit_sheet.png)<br>[`D2_calendar_filtered.png`](screenshots/D2_calendar_filtered.png)<br>[`D2_calendar_cleared.png`](screenshots/D2_calendar_cleared.png) | [`D2_interaction_checks.json`](dom_and_state/D2_interaction_checks.json) | - |
| **D3** | 未来行超长标题单行省略与左侧色条 | **PASS** | [`D3_long_title_and_strips.png`](screenshots/D3_long_title_and_strips.png) | [`D3_row_styles.json`](dom_and_state/D3_row_styles.json) | - |
| **E1** | 缺权限时首页设置卡片展示与关闭持久化 | **WARN** | [`E1_home_setup_card.png`](screenshots/E1_home_setup_card.png) | [`E1_setup_status.json`](dom_and_state/E1_setup_status.json) | - |
| **E2** | 「我的」页分组、使用说明与 PRD 移除 | **PASS** | [`E2_me_tab_groups.png`](screenshots/E2_me_tab_groups.png)<br>[`E2_user_guide_sheet.png`](screenshots/E2_user_guide_sheet.png) | [`E2_me_checks.json`](dom_and_state/E2_me_checks.json) | - |
| **F1** | 关键事项全屏闹钟触发与我知道了回流 | **PASS** | [`F1_alarm_triggered.png`](screenshots/F1_alarm_triggered.png)<br>[`F1_home_after_ack_alarm.png`](screenshots/F1_home_after_ack_alarm.png) | [`F1_alarm_result.json`](dom_and_state/F1_alarm_result.json) | - |
| **F2** | 普通事项到点系统通知正常 | **WARN**（勘误） | [`F2_system_notification.png`](screenshots/F2_system_notification.png) | - | [`F2_dumpsys_notification.txt`](dumpsys/F2_dumpsys_notification.txt) |
| **F3** | 冷启动无启动失败面板且无阻断性 JS 报错 | **PASS** | [`F3_cold_boot_home.png`](screenshots/F3_cold_boot_home.png) | - | [`F3_logcat_errors.txt`](logcat/F3_logcat_errors.txt) |
| **F4** | 系统字体调大无重叠溢出且测后自动恢复 | **FAIL**（勘误） | [`F4_font_scale_large.png`](screenshots/F4_font_scale_large.png) | [`F4_font_scale_check.json`](dom_and_state/F4_font_scale_check.json) | - |
| **G** | 清理测试事项并核实事项数量恢复原样 | **PASS** | - | [`G_cleanup_result.json`](dom_and_state/G_cleanup_result.json) | - |
