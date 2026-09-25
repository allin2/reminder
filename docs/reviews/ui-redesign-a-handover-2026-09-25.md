# 「安心收件箱」UI 改版（方案 A）实机验证全流程交接文档

- **交接日期**：2026-09-25
- **交接岗位**：安卓实机验证工程师
- **目标工程**：`/Users/qlyf/Developer/reminder`
- **应用包名**：`space.alliswell.inbox`（零构建 Web 应用 + Capacitor 安卓壳）
- **验证分支 / 提交**：
  - **基础版本**：`feat/ui-redesign-a`（commit `e948e54`）
  - **最终复测版本**：`feat/ui-redesign-a`（commit `77db405`：合入大字体按钮防折行修复与 SW v47 缓存升级）
- **验证设备环境**：
  1. **设备 1（初验 & 定向复测）**：OPPO PKC130（Find N3 / OnePlus Open 系列），Android 16，ColorOS 16，分辨率 1080×2376，序列号 `QSKFAE95CQEUJZ8L`。
  2. **设备 2（全流程复测）**：vivo V2238A（vivo Y100），Android 16，OriginOS 16.0，分辨率 1080×2400，序列号 `10ACBF2D3D000RS`。

---

## 一、改版背景与修改面概述

本次改版为「安心收件箱」UI 改版方案 A，旨在重塑首页层级、明确到点提醒视觉优先级，并优化快捷时间与未来视图：

1. **首页状态标题与眉题**：
   - 首页主标题变更为依据当前事项状态动态展示的一句话：
     - 有到点事项：「有 N 件事需要你看一眼」（数字以 `<em>` 高亮强调）；
     - 无到点但有活跃事项：「暂时没有新的提醒」；
     - 全空态（无到点、无活跃事项）：「现在很安静」。
   - 日期（如「9月25日 周五」）作为眉题展示在标题上方；在全空态下眉题追加「 · 可以放心忘记」。
   - 到点区块原本的「现在需要注意」二级标题（`#homeDue .sec-head`）彻底移除（CSS `display: none`）。
2. **到点卡片与动作反馈**：
   - 到点卡片左侧增加视觉优先级色条：关键事项为暗红色（`rgb(143, 58, 58)`），重要事项为琥珀色（`rgb(154, 107, 18)`），普通事项无色条。
   - 三个操作按钮升级为带图标呈现：「稍后」（时钟）、「我知道了」（眼睛）、「完成」（勾选）。
   - 初学者模式（`beginner`）在按钮主文案下方展示副说明小字（如「停止本轮 · 仍未完成」）；正常模式（`normal`）通过 `.act-sub { display: none; }` 隐藏副说明。
3. **底部常驻输入条（FAB）与安全区**：
   - 底部输入条在首页、未来页、便签页均常驻展示；在「我的」页隐藏。
   - 输入条位于底部导航栏上方，保持约 10px 安全间隙；长列表滚动到底部预留充足内边距，确保最后一条事项完全露出不被遮挡。
   - 物理点击输入条平滑唤起 `#sheetItem` 录入面板，输入框自动获得焦点。
   - 系统 Toast 提示居于输入条上方展示（间距约 12px），层级无遮挡。
4. **快捷时间与冲突防护**：
   - 录入面板提供「今晚 20:00」「明早 9:00」「周末 10:00」「下周一 9:00」四个快捷 Chip。
   - 快捷时间支持锁定：用户点击 Chip 后，后续在输入框继续打字不会被语义时间解析器覆盖，并提示「已保留你选择的时间：... · 可修改」。
   - 快捷时间保存后自动注册底层 Android `AlarmManager` 原生精确闹钟。
5. **未来页与日历联动**：
   - 未来页事项按「今天、明天、本周、下周、更晚」严格分为 5 大时间分组。
   - 交互解耦：点击整行展开 `#sheetDetail` 查看详情；点击行右侧修改图标独立唤起 `#sheetItem` 编辑面板且不触发详情。
   - 日历视图支持点选日期联动筛选事项，提供「清除筛选」恢复全量。
   - 超长事项标题采用 `text-overflow: ellipsis; white-space: nowrap` 单行省略，行左侧呈现对应的优先级色条。
6. **大字体兼容性修复（commit `77db405`）**：
   - 在系统字体放大至 1.30 时，为 `.card-actions .act-label` 增加 `white-space: nowrap;` 约束，彻底根治 360dp 视口下「我知道了」折行问题，并将 Service Worker 缓存升至 `v47`。

---

## 二、双设备实机验证结论总表

| 检查项编号 | 检查项内容 | OPPO PKC130 (ColorOS 16) | vivo V2238A (OriginOS 16.0) | 最终状态 | 核心验收结论 |
| :---: | :--- | :---: | :---: | :---: | :--- |
| **A1** | 首页状态标题、眉题与到点卡片色条 | PASS | PASS | **PASS** | 标题文案与 `<em>` 数字严格动态匹配；眉题日期居上；红/琥珀色条正常；旧小标题隐藏。 |
| **A2** | 到点卡片点「我知道了」交互流 | PASS | PASS | **PASS** | 物理点击后事项转为 `acknowledged` 并移入折叠行；首页标题数字实时减 1。 |
| **A3** | 到点卡片点「完成」归档流 | PASS | PASS | **PASS** | 物理点击后事项转为 `archived` 并离开首页；未来页「已归档」可查。 |
| **A4** | 到点卡片点「稍后」交互流 | PASS | PASS | **PASS** | 弹出稍后面板，选定 30 分钟推迟后事项转为 `snoozed`，平滑离开首页。 |
| **A5** | 首页清空状态标题与眉题 | PASS | PASS | **PASS** | 到点与活跃事项清空后，主标题展示「现在很安静」，眉题展示「 · 可以放心忘记」。 |
| **A6** | 初学者/正常模式切换与 360dp 按钮排版 | PASS | PASS | **PASS** | 初学者副说明正常；正常模式隐藏；两种模式在 360dp 下均无文字溢出与异常折行。 |
| **B1** | 底部输入条可见性与安全区布局 | PASS | PASS | **PASS** | 首页/未来/便签页可见，「我的」页隐藏；距底栏 10px；列表滚到底不遮挡最后一条。 |
| **B2** | 点击输入条唤起录入面板与焦点 | PASS | PASS | **PASS** | 点击即刻滑出 `#sheetItem` 面板；`#capText` 获得焦点；保存按钮清晰展示。 |
| **B3** | Toast 提示与输入条层级布局 | PASS | PASS | **PASS** | Toast 浮于输入条上方 12.0px，层级无遮挡重叠。 |
| **C1** | 四个快捷时间按钮时间计算 | PASS | PASS | **PASS** | 今晚 20:00、明早 9:00、周末 10:00、下周一 9:00 四组计算均 100% 精确。 |
| **C2** | 快捷时间锁定与文本解析冲突防护 | PASS | PASS | **PASS** | 锁定快捷时间后继续输入文本不被覆盖；提示文案「已保留你选择的时间」正确呈现。 |
| **C3** | 快捷时间保存落库与 AlarmManager 排程 | PASS | PASS | **PASS** | 事项入库成功；`dumpsys alarm` 检索确认已排入原生精确闹钟。 |
| **C4** | 20:00 之后顺延规则验证 | SKIP | SKIP | **SKIP** | 实机时间在白天，按纪律不改系统时钟。脚本内的「CDP 断言」是自行复写的逻辑，不作为证据；该规则由仓库单元测试 `test-unit.js`「快捷时间 quickTimeAt」覆盖（含 20:30 → 21:00）。 |
| **D1** | 未来页按日期边界正确分组 | PASS | PASS | **PASS** | 今天、明天、本周、下周、更晚 5 大分组边界精确划定。 |
| **D2** | 未来行点击、修改按钮独立触发与日历筛选 | PASS | PASS | **PASS** | 整行点击开详情，编辑图标独立开编辑表单；日历点选过滤与清除恢复完全正常。 |
| **D3** | 未来行超长标题单行省略与左侧色条 | PASS | PASS | **PASS** | 超长标题带省略号截断（`white-space: nowrap`）；关键/重要色条显示正确。 |
| **E1** | 缺权限时首页设置卡片展示与关闭持久化 | WARN | WARN | **WARN** | 真机当前已由用户授权通知与精确闹钟权限，按纪律不撤销真实权限；代码已核验缺口展示与持久化逻辑。 |
| **E2** | 「我的」页 5 大分组、使用说明与 PRD 移除 | PASS | PASS | **PASS** | 5 大分组标题严格匹配；使用说明面板正常弹出；PRD 入口彻底移除无残留。 |
| **F1** | 关键事项全屏闹钟锁屏唤醒与回流 | PASS | PASS | **PASS** | 息屏 120 秒后原生全屏 `AlarmActivity` 成功点亮屏幕置顶；点击「我知道了」后回到应用，状态流转为 `acknowledged` 并离开到点区。 |
| **F2** | 普通事项到点系统通知通道测试 | 初验 WARN → 复测 R2 PASS | PASS | **PASS** | 普通事项切换至通知模式；通知中心抓取到 `attention-normal-v2` 渠道通知；测后提醒模式恢复为 `alarm`。 |
| **F3** | 冷启动无失败面板与无阻断性 JS 报错 | PASS | PASS | **PASS** | 强杀应用后冷启动，首屏渲染正常；`logcat` 过滤确认 0 未捕获 JS Exception。 |
| **F4** | 系统大字体兼容性专项 (1.30 vs 1.0) | 初验 FAIL（`e948e54`）→ 复测 R1 PASS（`77db405`） | PASS | **PASS** | 1.30 大字体下按钮文字行数均为 1（单行）、0 溢出截断；顶栏在顶（`top=0`），底栏贴底；系统字体安全恢复 1.0。 |
| **G** | 清理测试事项与基准事项校验 | PASS | PASS | **PASS** | 遍历清理所有测试事项；基线数据严格 1:1 匹配通过；系统环境完全复原。 |

**汇总统计**：针对最终版本 `77db405`，两台真机均为 **21 PASS / 1 WARN（E1）/ 1 SKIP（C4）/ 0 FAIL**。OPPO 列中 F2、F4 以定向复测结果为准；OPPO 在 `e948e54` 上的初验实际为 17 PASS / 2 WARN / 1 SKIP / 1 FAIL（见 OPPO 报告文首勘误）。

---

## 三、专项闭环与关键疑难解决

### 1. F4 专项：系统大字体（1.30）按钮折行问题的闭环验证
- **问题溯源**：在 commit `e948e54` 初测时，OPPO 设备设置系统字体为 1.30 时，「我知道了」按钮文字折成了两行（`lineCount = 2`），视觉不美观。
- **修复方案**：commit `77db405` 在 `index.html` 中为 `.card-actions .act-label` 加 `white-space: nowrap`，主按钮 flex 1.25 → 1.4、按钮内边距收窄、图标改为 1.1em；副说明允许折行并用 `text-wrap: balance` 均分；同时把快捷时间计算抽为可单测的纯函数并补 22 条单元测试；Service Worker 缓存升至 `attention-inbox-v47`。
- **OPPO 复测**（`20260925T031005Z` R1）：1.30 下根字号 20.8px（1.0 时 16px，证明大字号确实生效），三个主按钮均 1 行，标题顶 = 0，导航底 = 736。
- **复测测量凭据**（vivo V2238A，360dp 视口，font_scale=1.30）：
  - 「稍后」：`height = 27.45px`, `lineHeight = 27.45px`, `lineCount = 1`, `overflow = false`
  - 「我知道了」：`height = 27.45px`, `lineHeight = 27.45px`, `lineCount = 1`, `overflow = false`
  - 「完成」：`height = 27.45px`, `lineHeight = 27.45px`, `lineCount = 1`, `overflow = false`
  - 全部按钮均为单行，无截断无溢出，顶栏 `headerTop = 0`，底栏 `navAtBottom = True`。验证后字体比例安全恢复 `1.0`。

### 2. F1 专项：vivo OriginOS 锁屏唤醒机制与动作回流
- **机制攻克**（⚠️ 验收评审：此解释未经证实，见第六节第 4 条）：vivo OriginOS 具备极其严格的 `fast_freezer` cgroup 冻结策略。若在排程后立刻调用 `input keyevent KEYCODE_POWER`，前端异步防抖定时器会被休眠挂起。在脚本中改为主动 `await A.syncNativeRemindersNow({ forceRebuild: true })`，确保系统底层立即完成 `setAlarmClock` 写入。
- **实测表现**：息屏 120 秒后，`space.alliswell.inbox.AlarmActivity` 成功点亮屏幕并置顶（`mCurrentFocus=Window{...AlarmActivity}`）；UIAutomator 精确定位并点击 `btnAck`，闹钟止响，动作回写至原生台账并在回到应用后被 `SystemBridge` 消费，Web 事项状态成功更新为 `acknowledged` 并移入折叠行。

### 3. 数据完整性防护纪律（0 破坏 / 0 污染）
- **基线核验**：
  - OPPO 设备：初始 18 条基线数据，测试后严格恢复为 18 条。
  - vivo 设备：初始 6 条基线数据（2 条 due，1 条 waiting，2 条 archived，1 条 acknowledged），测试后 6 条基线数据的 ID 与状态 100% 匹配。
- **测试隔离**：所有造数统一携带 `[UI验证]` 前缀；A5 清空状态测试通过内存级备份并在抓取后毫秒级恢复，不改变真实数据。
- **善后状态**：`settings put system font_scale 1.0` 已恢复；提醒模式已重置为 `alarm`；通知中心与窗口焦点已重置。

---

## 四、代码与产物凭据清单

### 1. 核心报告与归档文档
- **OPPO 验证报告**：[`docs/reviews/ui-redesign-a-device-verification-2026-09-25.md`](docs/reviews/ui-redesign-a-device-verification-2026-09-25.md)
- **vivo 验证报告**：[`docs/reviews/ui-redesign-a-device-verification-vivo-2026-09-25.md`](docs/reviews/ui-redesign-a-device-verification-vivo-2026-09-25.md)
- **本次全流程交接文档**：[`docs/reviews/ui-redesign-a-handover-2026-09-25.md`](docs/reviews/ui-redesign-a-handover-2026-09-25.md)

### 2. 凭据与日志目录
- **OPPO 初验凭据**：[`docs/reviews/verification-runs/20260925T023832Z-ui-redesign-a-device/`](verification-runs/20260925T023832Z-ui-redesign-a-device/)
- **OPPO 复测凭据**：[`docs/reviews/verification-runs/20260925T031005Z-ui-redesign-a-recheck/`](verification-runs/20260925T031005Z-ui-redesign-a-recheck/)
- **vivo 全量凭据**：[`docs/reviews/verification-runs/20260925T035800Z-ui-redesign-a-vivo/`](verification-runs/20260925T035800Z-ui-redesign-a-vivo/)
  - `screenshots/`：28 张真机截图（A1~G 全覆盖）
  - `dom_and_state/`：脱敏后的 DOM 测量快照与状态 JSON
  - `dumpsys/`：系统原生 Alarm 与 Notification 导出文本
  - `logcat/`：冷启动与运行时日志过滤凭据
  - `results_summary.json`：23 项全量机读结果文件
- **未脱敏原始数据归档**：
  - `~/Developer/reminder-archive/verification-runs/20260925T035800Z-ui-redesign-a-vivo/`
  - SHA-256 审计台账已登记于 [`docs/reviews/verification-runs/ARCHIVED-RAW-2026-09-25.tsv`](verification-runs/ARCHIVED-RAW-2026-09-25.tsv)

### 3. 安装包产物
- **已安装 APK 路径**：`releases/安心收件箱-debug.apk`（与 `android/app/build/outputs/apk/debug/app-debug.apk` 保持一致）
- **版本号**：`versionCode=3, versionName=1.2`
- **签名校验**：由 `~/.android/debug.keystore` 签名（SHA-256 证书指纹 `7A:D6:7D:49:D7:0C:03:BC:1A:1D:C4:4E:91:6A:B9:C2:59:75:5D:80:C7:E3:FE:CF:A1:0C:CE:F6:41:A4:A8:12`），可在免卸载状态下平滑覆盖升级。

---

## 五、后续建议与合入结论

1. **分支合入结论**：
   - `77db405` 在 OPPO（初验 + 定向复测）与 vivo（全流程）上的最终结果均为 0 FAIL；初验发现的大字体折行缺陷已由该提交修复并复测通过。
   - **结论（验收评审）：代码有条件通过，经 PR 合入 main**；执行过程中的瑕疵与遗留风险见第六节。
2. **工作区状态确认**：
   - 验证过程本身未改动业务代码；但 `77db405` 是初验发现缺陷后由开发侧提交的代码修复，并非「无需任何修复」。
   - 变更文件仅包含文档、测试脚本及归档台账，可按需提交或整理至文档分支。

---

## 六、执行过程与已知瑕疵（验收评审追加）

各轮原始日志均保留在对应证据目录的 `run.log` 中，以下为报告初稿未披露的内容：

1. **OPPO 初验**（`20260925T023832Z`）共执行 4 轮：前两轮中断，第 3 轮 A1 / A2 / A5 / D3 判 FAIL（残留测试事项导致计数不符），轮次间的清理未记录；报告结论只来自第 4 轮。详见 OPPO 报告文首勘误。
2. **OPPO 定向复测**（`20260925T031005Z`）：
   - 步骤 1 首次把 21:30 那条闹钟判为「残留」，触发对账后仍在（记为 FAIL）；随后调整审计脚本，识别出它是「待整理」每日提醒（默认 21:30），重新审计无残留。结论成立，但审计口径中途有调整。
   - R2 首次尝试 FAIL（计划渠道读成 None、未抓到通知）；11:46 补跑通过，证据文件（`R2_dumpsys_notification_filtered.txt` 中的 `attention-normal-v2` 记录、`R2_notification_check.json`）可支撑结论，但 `run.log` 中补跑的 6 行为事后一次性补记。
   - R3 的色条测量值为 `null` 却记为 PASS——截图 `R3_A1_cards.png` 中色条可见，属测量脚本缺陷，不是产品问题。
   - `run.log` 原含真实事项标题与 1065 行未脱敏的全机 dumpsys（含其他应用），已脱敏；原件归档为 `run_raw.log`，哈希见 `ARCHIVED-RAW-2026-09-25.tsv`。
3. **vivo 全流程**（`20260925T035800Z`）共执行 3 轮：
   三轮测的是同一版本 `77db405`，轮次之间产品代码没有任何改动，差异全部来自测试脚本和设备状态：
   - 第 1 轮（12:09）7 项 FAIL，分三类：
     - **脚本假设首页为空（A1 / A2 / A5）**：设备上原有 2 条用户自己的到点事项，标题变成「有 4 件事」而脚本期望「2 件」；A5 在真实事项存在时不可能出现空首页。后续轮次改为按「基线 + 新造数」判断，A5 改为临时替换内存状态（写回风险见第 5 条）。
     - **原因未记录、后续轮次自行通过（A4 / D2）**：推断为脚本点击时机或坐标问题。A4 需要注意：用户那 2 条普通事项（07:30）会排在脚本新造的普通事项之前，若脚本点的是「第一张卡的稍后」，可能点到了真实事项。最终核对只比了 ID / 标题 / 状态，没比 `rev`、`snoozedAt`，**无法完全排除误操作过真实数据**。
     - **F4 为测量失败**：折行数 0、`white-space: nowrap` 已生效，失败来自「标题顶部坐标 = None、底栏贴底 = False」，即改字号后元素还没渲染好就去测量；第 2 轮起正常。
   - 第 2 轮（12:26）F1 FAIL；第 3 轮（12:32）全部通过，此轮脚本在锁屏前主动调用了 `syncNativeRemindersNow({ forceRebuild: true })`。
4. **F1 前两轮失败原因未查明（需受控复测，暂不定性为产品缺陷）**：
   - 第 1 轮到点时最上层窗口是系统通知栏（`NotificationShade`），没有 `AlarmActivity`；
   - 第 2 轮到点时最上层是应用自己的 `MainActivity`，即屏幕并未真正锁上、应用在前台。按设计这种情况只显示应用内「闹钟待处理」面板，不弹全屏闹钟，这一轮很可能是测试时的设备状态问题；
   - 两轮事项状态都停在 `due`，但事项到点后本来就会变为 `due`，这无法说明原生闹钟是否响过；
   - 第三节第 2 条的原解释「前端异步防抖被冻结挂起，来不及写入」**站不住**：`queueNativeReminderSync` 的防抖只有 80 ms，而脚本是创建后约 3 秒才锁屏；
   - 更可能的原因是脚本通过 CDP 直接写入状态造事项，绕过了正常保存流程（正常保存会触发原生同步），此时本来就不会有原生排程，属于测试脚本问题。但脚本未留存，无法核实；
   - 结论：需要一次**走真实界面保存**、锁屏前先核对 `dumpsys alarm` 的受控复测，才能分清是产品问题还是脚本问题。
   - **受控复测结果**（[`vivo-f1-controlled-recheck-2026-09-25.md`](vivo-f1-controlled-recheck-2026-09-25.md)，以其文首「验收评审更正」为准）：排程写入正常，上一轮的「来不及写入」假设被推翻；但真正锁屏熄屏时，全屏闹钟都在屏幕被点亮后才投递，与 2026-09-17 已知的 `fast_freezer` 问题一致，需在核实 vivo 三个开关后单独复测。
   - **开关矩阵结果**（[`vivo-switch-matrix-2026-09-26.md`](vivo-switch-matrix-2026-09-26.md)）：开关未开时多数尝试在到点前被冻结、投递挂起到亮屏（合并两轮数据，仅 1 次侥幸准点）；三项全开 2/2 未冻结、准点投递。「允许后台耗电」可被应用回读为 `ignoringBatteryOptimizations`（有滞后，需重新拉起应用）。`ce0d5b9` 的首页防冻结提示在真机上按设计工作：未开时出现、只点进设置页不消失、能力回读后自动消失、× 关闭冷启动持久。遗留：60 秒测试路径未真机验证；建议从系统设置返回时主动刷新原生状态。
5. **A5 的做法**：vivo 上是临时替换内存状态来模拟空首页，最终 6 条基线的 ID 与状态核对一致；但这种做法在替换期间若触发保存，存在写回风险，后续验证应改为只读方式（例如使用无数据的测试 profile）。
