# 滴答清单（TickTick CN）UI 逆向笔记 — 供安心收件箱借鉴

- **日期**: 2026-10-15
- **样本**: `cn.ticktick.task` v7.6.8.0 (versionCode 76800, minSdk 21 / targetSdk 36)
- **来源**: APKPure 公开镜像，SHA-256 `85f7d8cc2fa818d20806148c9179ea1c4564ee734a22ee86fff2e19b9a950f38`
- **方法**: REA `open_binary`(APK 归档盘点) + jadx 1.5.6 全量反编译 + aapt2 资源表映射。REA 的 jadx-MCP provider 需要 `REA_JADX_MCP_JAR` 环境变量未配置，按 skill 规定的 CLI 路线完成，证据等价。
- **产物**: `/tmp/tt-jadx/`（sources = Java 反编译，resources = 解码资源），`/tmp/tt-res.txt`、`/tmp/tt-map.txt`（资源名→混淆路径映射）。注意 /tmp 重启会清空。

## 0. 技术栈结论

- **纯原生 Android**（View 体系 + 大量 `com.ticktick.customview.*` 代码驱动 UI，未见 Compose/RN/Flutter 主链路）；MVP 式 presenter 接口（`setPresenter` 模式）。
- APK 做了 **AndResGuard 文件路径混淆**（`res/yJ0.xml` 等），但 `resources.arsc` 条目名完好 → `aapt2 dump resources` 可完整还原 名称→路径 映射，`aapt2 dump xmltree --file <路径>` 可解码任意二进制 XML。
- 布局 XML 是薄壳，真实 UI 结构在 custom view 类里（反编译源码才是主要证据源）。

## 1. 主题系统（最值得借鉴）

- **TT\* 视图家族**（`com.ticktick.task.theme.view`）：`TTButton / TTCheckBox / TTEditText / TTTextView / TTSwitchCompat / TTTabLayout / TTToolbar` 等 17 个 —— 每个系统控件都有主题感知子类，主题切换不需要重建界面。
- **色阶 token 体系**：每套主题一个主色 + 4 档固定透明度派生：
  - 默认主题 `#4772fa`（蓝）；备选主色：秋 `#f28749`、北京红 `#ff5850`、鸟 `#00bba9`、花 `#73b30e`、黑 `#171b2d` 等 20+ 套。
  - 派生规则（alpha hex）：`_100`=原色、`_36`=#5c…、`_18`=#2e…、`_10`=#1a…。
  - 对应安心收件箱 CSS 的 `--signal` / `--signal-soft` 双 token，可升级为 4 档（10%/18%/36%/100%）以覆盖边框、按压、浅底三态。

## 2. 优先级/四象限配色（与本项目四色语义同构）

| TickTick | 色值 | 安心收件箱对应 |
|---|---|---|
| `high_priority_color` | `@primary_red` | `--critical` #8f3a3a |
| `mid_priority_color` | `#f2b04b`（琥珀） | `--attention` #9a6b12 |
| `low_priority_color` | `#617fde`（蓝紫） | `--future` #3d5a80 |
| 四象限「重要且紧急」 | `#ff5f68` | — |
| 四象限「重要不紧急」 | `#ffb000` | — |

红/琥珀/蓝的三级语义配色两家完全同构；可互为色值校准参考。

## 3. 稍后（Snooze）九宫格 —— 对标本项目「稍后 6 档」

`SnoozeTimeLayout`（`reminder/popup/`）+ `SnoozePickLayout`：

- 2 行 icon+label 瓦片：**15 分钟 / 30 分钟 / 1 小时 / 3 小时 / 明天**(tag=分钟数 15/30/60/180/1440) / **自定义**。
- 扩展出口（按上下文动态显示）：
  - **下一小时**（整点推进 +1h 的「智能时间」）；
  - **跳过本次周期**（`skip_current_recurrence`，周期任务专属 —— 本项目周期事项可借鉴）；
  - **智能时间**（`item_smart_time`，tag 直接带 Date）；
  - **选择日期**（`tv_pick_date`）。
- 自定义 picker 双模式（分钟 vs 具体时刻），`getCustomSnoozeMode()` 持久化用户偏好。
- 用户偏好键：`snooze_conf`、`later_conf`（UserProfile 云同步）。

## 4. 提醒弹条（TaskReminderPopupView）—— 对标本项目「弹条/四出口」

- **聚合列表**：一次弹窗可挂多条内容（延后的旧提醒 + 周期子项 + checklist 子项，文本用 `"- "` / `"* "` 前缀区分），`PopupRecyclerView` 支持单击/双击手势。
- 底部出口：`btn_first` / `iv_close`(关闭) / `btn_last`(完成) / `iv_focus`(一键专注，番茄计时直达)。
- **胶囊按钮配色公式**：稍后 = 主文本色 8% alpha 圆角 8dp；完成 = accent 10% alpha —— 即本项目 `.pill` 的原生实现，证实「soft 底 + 同色文字」是跨平台共识。
- **最值得抄的机制：所有出口（包括关闭）都调 `CloseRemindUtils.startPushRemindJob()` 做「关闭后补偿推送」** —— 用户关掉弹窗后仍有一条兜底通知。这是「我知道了≠完成」之外的第二道防线，与本项目 D41 事务模型互补，建议引入。

## 5. 快速添加（QuickAdd）默认值装配体系

- `quickadd/defaults/` 下 **19 个字段默认值提供者**：`TitleDefault / DueDataDefault / PriorityDefault / ProjectDefault / TagsDefault / PositionDefault / PinDefault / TopBottomDefault / TaskKindDefault / CompletedDefault / NoteDefault...`
- 统一接口：`apply(Task2)` / `modify(Task2)` / `initial` —— 新建任务时按序装配默认值，与本项目「捕获永不失败 + 待整理兜底」是同一思想的字段级实现。
- 用户偏好键：`quick_date_config`（快捷时间 chips 可配置！本项目 `quick-times` 目前写死）、`customize_smart_time_conf`、`nlp_enabled`（自然语言解析开关）。

## 6. 底部导航可配置化

- `TabBarItem` 列表存于 `UserProfile.tab_bars` 并**云同步**；候选 tab：`tasks / calendar / today / summary / pomo / habit`。
- `TabBarConfigActivity` 提供编辑界面。本项目固定 4 tab，若未来扩展（笔记/统计/专注），配置化底栏是现成范式。

## 7. 提醒弹窗族谱（多实体分型）

`ReminderPopupActivity`（透明全屏 Activity）承载分型视图：`TaskReminderPopupView / HabitReminderPopupView / CalendarEventReminderPopupView / CourseReminderPopupView / CountdownReminderPopupView`，另有独立 `SnoozePopupActivity`。本项目全屏闹钟是单一 4 出口，若未来支持习惯/日历实体可借鉴分型注册模式。

## 8. 其他偏好键速查（UserProfile，均可借鉴语义）

`swipe_lr_short/long、swipe_rl_short/middle/long`（滑动快捷动作自定义）、`stick_reminder`、`alert_mode`、`alert_before_close`、`notification_mode`、`stick_nav_bar`、`calendar_view_conf`、`post_of_overdue`（过期任务归属策略）。

## 9. 复现分析的工作流（供后续版本对比）

```bash
# 资源表映射（名称→混淆路径）
aapt2 dump resources apk > res.txt
awk '$1=="resource"{name=$3; getline; if($3 ~ /^res\//) print name" "$3}' res.txt > map.txt
# 解码任意二进制 XML
aapt2 dump xmltree apk --file $(grep "^layout/activity_quick_add " map.txt | awk '{print $2}')
# 全量反编译
jadx -j 8 -d out apk
```

## 10. 许可边界

借鉴交互语义、信息架构与配色策略（思想层）；不得复制图标、Lottie 动画、文案与代码（表达层受版权保护）。
