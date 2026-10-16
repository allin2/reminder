# 体检报告 · 安心收件箱（真实浏览器复核：T8 Web + T2/T9 标注需浏览器项）

- **执行人**：Agent（真实浏览器复核线）
- **日期**：2026-10-15
- **代码版本**：HEAD `f79b1a7396c6f5493e43a27ec88e960f8b620ac3`（**现在未提交文件 48 个**，工作区含未提交改动）
- **设备与系统**：本机 macOS + Node v22.23.1；独立 headless Google Chrome（`--headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/chrome-health`）。**未使用 agent-browser、未触碰用户日常 Chrome**；驱动脚本写在 `/tmp`（未进仓库）。
- **视口**：390×844 mobile（`innerWidth=390`、`innerHeight=844`、`visualViewport.height=844`，已逐项校验，结论有效）
- **证据目录**：`docs/reviews/health-evidence-2026-10-15/T8/`
- **覆盖率**：计划 **10 项**，执行 **10 项**（T8-5 含 4 子项）；真机项跳过 2 项（T8 真机 WebView 部分、HC-T3-4）。**未修改任何产品代码**。

## 结论（3 句以内）

1. **HC-T8-1（P0）仍 ❌**：390 视口下 `document.documentElement.scrollHeight = 1680`（期望 844）。18 个收起态 `.sheet`（`position:absolute; bottom:0; transform:translateY(110%)`）把文档撑高；`#app` 只在 `@media (min-width:480px)` 才有 `overflow:hidden`，窄屏缺失。且 `body{overflow:hidden}` 挡不住程序化滚动（`window.scrollTo(0,323)` 实测生效）——视觉「上移」症状需真机软键盘触发，但结构隐患已确证。
2. **HC-T8-3 / 8-5 / 8-6 均 ❌**（无深色模式；开关/toast/面板缺 ARIA；未来页残留内部术语）；**HC-T8-5 的「面板焦点管理」✅**。
3. **HC-T9-1 / T9-2 离线 / T9-3 通知三态 真实浏览器复核全部 ✅**；**HC-T2-3 可达但自然输入几乎打不中（⚠️）**、**HC-T2-4 相似提示仍默认折叠（❌）**。

## 用例结果

| ID | 结果 | 证据（真实 390×844 运行值） | 备注 |
|---|---|---|---|
| HC-T8-1 | ❌ | 4 个面板逐个「打开→关闭」：`open(h=1680,y=0)` / `close(h=1680,y=0)`（记录=saw `sheetItem`、详情=`sheetDetail`、稍后=`sheetSnooze`、确认=`sheetDetail+sheetConfirm`）；另基线（不打开任何面板）即为 `h=1680,y=0` | 期望 844/0，实得 1680/0；第二轮 bug 结构未修 |
| HC-T8-1（聚焦输入框） | ❌ | 打开记录面板后 `#capText` 自动聚焦，`scrollY=0`、`scrollHeight=1680` | 桌面 headless 无软键盘焦点滚动；见反证 |
| HC-T8-3 深色模式 | ❌ | `setEmulatedMedia{prefers-color-scheme:dark}` 后 `body背景=rgb(244,243,239)`、`文字=rgb(20,24,29)`、`#alertBanner 背景=rgb(255,255,255)`；全站样式表 268 条规则中 `prefers-color-scheme` 命中 **0** | 无深色模式，夜间整屏亮色 |
| HC-T8-4 触控目标 | ❌ | 390 宽可见按钮合计 25 个（首页 6 / 我的 19），**<44px 共 11 个** | 明细见下方 P1-③ |
| HC-T8-5 无障碍 | ❌ | 开关 8 个：`role=switch` 0、`aria-checked` 0；`#toast` 无 `aria-live`/`role`；面板 18 个：`role=dialog` 0、`aria-modal` 0 | — |
| HC-T8-5 面板焦点 | ✅ | 打开记录面板后 `document.activeElement=#capText`（在面板内=true） | 焦点确实移入面板 |
| HC-T8-6 内部术语 | ❌ | 未来页可见文案命中 `Future`、`≠`、`默认隐藏`、`不占据首页`；实例：`「Future 默认不占据首页。默认隐藏 ≠ 不允许查看。」` | 面向用户的内部术语 |
| HC-T9-1 保存 toast | ✅ | `toast="已保存，本页关闭后不会有提醒"` | 明说关页不提醒 |
| HC-T9-1 我的状态行 | ✅ | `pwaSub="PWA 已就绪 · 通知未开 · 数据本地保存 · 网页版提醒仅在页面开着时有效，关键事项请用 Android App"` | 明说仅在页面开着时有效 |
| HC-T9-1 首页告知 | ❌ | 纯 Web 首页 `#homeNotice` 文本 = `""`（空） | 与 T9 报告 P2-② 一致，仍未修 |
| HC-T9-2 离线 | ✅ | 离线（`Network.emulateNetworkConditions offline:true`）下：捕获保存成功（items 8→9）、`ack/snooze/complete` 均返回 `true`；离线刷新后 items=9 且含离线新建项 | 离线可用 + 刷新数据仍在 |
| HC-T9-3 通知三态 | ✅ | denied→`Notification.permission=denied`，toast="通知权限未授予，将使用应用内提醒"；granted→toast="已开启本地通知"；reset→`permission=default`（未询问态调用 `requestPermission`） | 三态分支均有反馈；拒绝态未引导站点设置（见 P2-⑦） |
| HC-T2-3 低置信选择框 | ⚠️ | 20 条自然口语候选 `(low ∧ 具体时间词)` **命中 0 条**；但构造输入可达：`每月5日后付款`/`过两天前`/`三天后前` 保存后 `#sheetLowConf` 打开（见 `t2-3-01-lowconf.png`） | 非死分支，但自然输入几乎打不中 |
| HC-T2-3 纯模糊词 | ✅ | `过阵子看看` 保存后未弹选择框，落库标题被剥为 `看看` | 等同静默收下 |
| HC-T2-4 相似提示 | ❌ | 默认 `#btnCapMore aria-expanded="false"`、`#capAdvanced hidden=true`；`#similarHint` 有内容却处于折叠区内；`#btnCapMore.click()` 展开后 hint 才可见（`可能已有类似提醒（不会自动合并）· 看看`） | 首轮 P2-⑩ 仍在 |
| HC-T3-4 Android 计数 | ⏭ | — | 需真机 Android WebView，留给用户在场时做 |
| 控制台 | ✅ | 全程 `Runtime.exceptionThrown` + `Log.entryAdded(error)` = 0 | — |

## 发现的问题（按严重度排序）

### P0-① 窄屏下收起态底部面板把文档撑高到 1680px，且应用可被程序化滚动上移
- **违反条款**：第二轮 P0「面板会带走页面位置」；移动端「整屏上移、底部留白、导航被顶到中部」
- **复现（真实浏览器）**：390×844 打开 `http://127.0.0.1:8955/index.html` → 打开「记录/详情/稍后/确认」任一面板再关闭 → `document.documentElement.scrollHeight` 恒为 **1680**、`window.scrollY` 在桌面 headless 下保持 0。
- **根因证据**：
  1. 收起态 `.sheet` 是 `position:absolute; bottom:0; transform:translateY(110%)`（`visibility:hidden` 不占布局但**仍占滚动溢出**），最高面板 `#sheetAi/#sheetNotifyLab/#sheetGuide` 高 760px，`top=920/bottom=1680`，完全落在 844 视口下方——文档因此恒为 1680，**连面板都不用打开**。
  2. `#app` 仅在 `@media (min-width:480px)` 有 `overflow:hidden`，窄屏没有；`body{overflow:hidden}` **只挡用户滚动**。
  3. **反证**：临时（仅页面内）把全部 `.sheet` 设 `display:none` → `scrollHeight` 立刻回到 **844**。
  4. **可被程序化滚动**：`window.scrollTo(0,323)` → `scrollY=323`（尽管 `body{overflow:hidden}`）；`#capText.scrollIntoView({block:'center'})` → `scrollY=49`。故真机软键盘聚焦输入时的 scroll-into-view 会把整屏上移。
- **证据**：`t8-1-02-capture-focused.png`（正常态）、`t8-1-06-forced-shift-simulated.png`（模拟 `scrollY=323` 后：面板上移、下方大片空白、导航被顶到中部，即为该 bug 视觉后果）。
- **未复现部分**：桌面 headless 无软键盘，`#capText.focus()` 本身不触发滚动；真机 Android WebView 的即时视觉症状 **⏭ 需真机**。
- **建议修复**：给 `#app` 在**所有**宽度加 `overflow:hidden`（或 `contain:paint`），收起态 `.sheet` 改 `display:none`/`inert`。
- **验证方式**：390 视口下重复上述「打开→关闭」，`scrollHeight` 应恒为 844。

### P1-② 无深色模式，夜间整屏亮色
- **违反条款**：T8 深色/夜间可用性（HC-T8-3）
- **证据**：`setEmulatedMedia{prefers-color-scheme:dark}` 下 `body`/`#app` 背景仍为 `rgb(244,243,239)`、文字 `rgb(20,24,29)`；样式表 268 条规则无任何 `prefers-color-scheme` 命中。截图 `t8-3-01-dark-home.png`。
- **影响**：OLED 夜间/睡前使用刺眼。

### P1-③ 触控目标小于 44px（共 11 个）
- **违反条款**：移动可达性（HC-T8-4）
- **证据**（`buttons-measured.json`）：`修改`50×36、`删除`50×36、`#swNotify`46×28、`#swImp`46×28、`#swDnd`46×28、`#swPrivacy`46×28、`#swSummary`46×28、`seg-item 系统通知`157×40、`seg-item 闹钟提醒`157×40、`seg-item 初学者模式`157×40、`seg-item 正常模式`157×40。截图 `t8-4-01-me-buttons.png`。
- **说明**：开关轨道 28px 高、分段项/次要按钮 36–40px 高，均低于 44px。

### P1-④ 关键控件缺 ARIA 语义
- **违反条款**：HC-T8-5
- **证据**：8 个开关全无 `role="switch"`/`aria-checked`（仅 `aria-label`）；`#toast` 无 `aria-live`/`role`（屏幕阅读器不会播报保存结果）；18 个面板全无 `role="dialog"`/`aria-modal`。**好消息**：打开面板时焦点确实移入 `#capText`。`#btnCapMore` 有 `aria-expanded`（合理）。

### P2-⑤ 未来页残留内部术语
- **违反条款**：面向用户文案不得出现内部术语（HC-T8-6）
- **证据**：`「Future 默认不占据首页。默认隐藏 ≠ 不允许查看。」` 截图 `t8-6-01-future-terms.png`。

### P2-⑥ 「相似提醒」仍默认折叠在「更多选项」内
- **违反条款**：首轮 P2-⑩
- **证据**：默认 `#capAdvanced hidden=true`；`#similarHint` 已生成内容但被折叠区遮住；展开「更多选项」后才可见。截图 `t2-4-01-similar.png` / `t2-4-02-similar-expanded.png`。

### P2-⑦ HC-T2-3 极简选择框：非死分支，但自然口语命中率≈0
- **证据**：20 条自然候选（`月底交房租`、`下周三开会`、`12月5号交材料`、`下午三点一刻开会`…）无一满足 `low ∧ 具体时间词`；仅构造输入 `每月5日后付款`/`过两天前`/`三天后前` 能触发（弹层已实测打开）。候选矩阵见 `t2-lowconf-candidates.json`。
- **评估**：分支**活着**（可被触发），但普通用户说法的交集近乎空，等于极少弹；与 T2 报告「疑似死分支」方向一致（程度略缓）。

### P2-⑧（沿用 T9 P2-②）拒绝通知权限后不引导站点设置
- **证据（实测）**：`Browser.setPermission{notifications:denied}` 后点「本地通知」开关，toast=`通知权限未授予，将使用应用内提醒`，未出现「请到浏览器站点设置重新允许」的引导。截图 `t9-3-01-notify-denied.png`。

## 已知问题复核（对照 T2/T8/T9 报告与任务书第 4 节）

- **第二轮 P0（面板撑高/上移）**：**未修复**。`scrollHeight` 恒 1680，`#app` 窄屏无 `overflow:hidden`。
- **首轮 P2-⑩（相似提示折叠）**：**仍在**，见 P2-⑥。
- **T2 P2-②（低置信选择框疑似死分支）**：**部分辟谣**——分支可达（构造输入可弹），但自然输入几乎打不中，见 P2-⑦（级别由「死分支」降为「极低频」）。
- **T9 P2-①（拒绝后不引导站点设置）**：**确认仍在**，见 P2-⑧。
- **T9 P2-②（Web 首页无告知）**：**确认仍在**，`#homeNotice=""`。
- **T9-1/9-2/9-3**：真实浏览器复核**通过**（离线可用、三态有反馈、两处文案明说「关页不提醒」）。

## 需真机 / 仍无法复核（⏭）

1. **HC-T8-1 真机视觉症状**：桌面 headless 无软键盘，`focus()` 不触发滚动；「整屏上移、底部留白、导航居中」需 **Android WebView（真机）** 用软键盘聚焦输入框复现确认。
2. **HC-T3-4（Android 计数）**：需真机 Android WebView。
3. **深色夜间观感**：因无深色实现（整屏亮色）已成定论，但 OLED 夜间具体观感仍建议真机确认。
4. 本线在桌面 headless 下**无法**验真实软键盘遮挡、通知系统弹窗交互（headless 不弹交互框，已用 `Browser.setPermission` 模拟三态）。

## 附录

### A. 截图证据清单（`docs/reviews/health-evidence-2026-10-15/T8/`）
- `t8-1-01-capture-closed.png` 记录面板关闭态
- `t8-1-02-capture-focused.png` 记录面板打开+输入框聚焦（正常态）
- `t8-1-03/04/05-*.png` 详情/稍后/确认 关闭后态
- `t8-1-06-forced-shift-simulated.png` **模拟 `scrollY=323` 的上移/留白后果**（P0-① 视觉）
- `t8-3-01-dark-home.png` 深色模式请求下的首页（仍亮色）
- `t8-4-01-me-buttons.png` 「我的」按钮
- `t8-6-01-future-terms.png` 未来页内部术语
- `t9-1-01-save-toast.png`、`t9-1-02-me-status.png` 保存 toast / 我的状态行
- `t9-2-01-offline.png` 离线态
- `t9-3-01-notify-denied.png`、`t9-3-02-notify-granted.png` 通知拒绝/授权
- `t2-3-01-lowconf.png` 构造输入触发的低置信选择框
- `t2-4-01-similar.png`、`t2-4-02-similar-expanded.png` 相似提示折叠/展开
- 数据：`buttons-measured.json`、`t2-lowconf-candidates.json`、`future-innerText.txt`

### B. 复现命令与技术手法
1. 独立 headless Chrome（自带 profile 与调试端口，勿杀用户日常 Chrome）：
   `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/chrome-health --no-first-run --no-default-browser-check about:blank &`
2. Node 驱动：GET `http://127.0.0.1:9333/json/list` → 取 page target → 连 WebSocket → `Emulation.setDeviceMetricsOverride{width:390,height:844,deviceScaleFactor:1,mobile:true}` → `Page.enable`/`Runtime.enable` → `Page.navigate` 等 `Page.loadEventFired`，断言前先校验 `window.innerWidth≈390`。
3. 面板用**真实 DOM 点击**触发（`#fab` 打开记录；`[data-close]` 关闭；`views.openDetail(id)`→`[data-act=snooze|delete]` 打开稍后/确认），关闭用应用自身 `closeAllSheets()`；未使用伪造 hack。
4. 离线用 `Network.emulateNetworkConditions{offline:true}`；通知三态用 `Browser.setPermission` / `Browser.resetPermissions`；深色用 `Emulation.setEmulatedMedia{prefers-color-scheme:dark}`。
5. 驱动脚本与原始结果在 `/tmp/health-t8/`（`run.mjs`/`diag.mjs`/`results.json`/`diag.json`），**不在仓库内**。
