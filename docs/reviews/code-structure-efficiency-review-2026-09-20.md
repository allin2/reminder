# 代码结构与执行效率审查报告

- 日期：2026-09-20
- 对象：当前工作区（未提交改动保留原样，本报告只读，未改任何代码）
- 方法：静态结构扫描 + 关键路径实测 + 与既有登记（DETAIL.md / docs/reviews）交叉核对
- 结论口径：本报告是**结构审查**，不是发布门禁；结论分「已证据支持」与「推断」两档，推断均标注。

## 1. 审查范围与可复算基线

| 指标 | 实测值 | 取证方式 |
|---|---|---|
| app-core.js | 8199 行 / 283 个函数 / 27 个分节 | node 脚本统计 |
| 单函数最长 | bind 508 行 · parseChineseTime 302 行 · saveItemFromForm 300 行 · startApp 173 行 | 同上 |
| lib/ | 10 个 UMD 模块，共 4052 行 | wc -l |
| index.html | 1920 行，1 个内联 `<style>`（74KB），8 个外部 script，0 个内联 script | 同上 |
| innerHTML 赋值 | 43 处 | app-core.js 全文统计 |
| `$()`/querySelector 调用 | 474 处 | 同上 |
| addEventListener | 115 处 | 同上 |
| state.items 全表扫描 | 66 处（forEach/filter/map/find） | 同上 |
| save() 调用点 | 约 60 处 | 同上 |
| Android Java | 约 6000 行 / 13 个类，最大 SystemBridgePlugin 1598 行 | wc -l |
| JS 测试水位（今日实测） | unit 330 / smoke 244 / regressions 730 / native 321 = **1625，0 失败** | 四套 suite 现场重跑 |

保存路径实测（Node 22，桌面；复现 writeSnapshot 616–643 + storage.js 69–71 的 2×stringify + 2×parse + 镜像 stringify）：

| 事项数 | payload | 每次保存序列化成本 |
|---|---|---|
| 100 | 44 KB | 0.44 ms |
| 500 | 219 KB | 2.09 ms |
| 2000 | 880 KB | 8.89 ms |

真机 WebView（JavaScriptCore，中端机）JSON 吞吐通常为桌面 Node 的 1/2～1/4，上表应乘 2–4 倍看。

## 2. 总体判断

**分层意图正确、部分兑现，但边界已被稀释到失效边缘。** `lib/`（UMD 纯逻辑）+ `app-core.js`（编排）+ 四件套注册纪律的设计是对的；现实是：8199 行的单 IIFE 同时承担纯逻辑、编排、视图、诊断四种角色；lib 与 app-core 的重复靠**运行时函数重绑定**兜底（app-core.js:2008–2010）；测试组合与生产组合**已经出现漂移**（§3 S-03）。

**执行效率：当前规模无实感问题，增长曲线明确，瓶颈模式先于绝对开销成立。** 真正的风险不是某一次操作慢，而是三个结构性放大器——**全量快照**（每次保存重写整个状态）、**全量重排**（每次回前台两轮原生对账）、**全量重渲染**（15 秒一次、无短路）。在「个人收件箱」预期数据量（数十至数百条）下所有热点合计毫秒级；到数千条事项 / 每条都带提醒台账时，保存路径率先成为可感知瓶颈。

## 3. 问题清单

严重度定义：**高** = 已正确性/可维护性实锤或有明确触发路径；**中** = 特定条件可达；**低** = 卫生问题。

### A. 代码结构

**S-01【高】app-core.js 是单文件巨模块，四种角色混在一个 IIFE**
证据：8199 行 / 283 函数；分节横跨 utils、中文解析器副本、状态与提交事务、延迟澄清、视图、AI、面板、表单、详情、搜索、项目、通知、原生草稿事务、送达证据、首用设置、导入导出、seed、演示、分享、事件、init。
影响：任一改动的影响面不可局部推断；code review 失真；「纯逻辑进 lib、app-core 只编排」的既定纪律（DETAIL.md §七）事实上已倒挂——301 行解析器副本、repeatLabel / inQuietHours / quietEnd / nextRepeatTrigger 副本都留在 app-core，只在运行时被 lib 覆盖（2008–2010 行、1744–1755 行）。运行时代价小，认知与维护代价大。

**S-02【高】app-core 与 lib 三处以上逻辑重复，靠运行时覆盖而非唯一来源**
证据：`parseChineseTime`（app-core 293–594 副本 vs lib/parse-cn.js）、`repeatLabel`（200 行副本）、`inQuietHours`/`quietEnd`（1743–1768，「Lib 有就用、没有就地实现」）、`nextRepeatTrigger`（1822 起，注释自称「与 lib/repeat.js 保持同一实现的副本」）。M-10 已登记此模式，缓解靠 `scripts/verification/parse-parity.js` 逐用例比对。
影响：改 lib 漏 app-core（或反向）不报错，只静默分叉；每次全量测试都要伺候两份实现。

**S-03【高·新发现】两个主力测试 harness 与生产脚本组合不一致，native-reminders.js 缺席**
证据：生产 index.html 加载 8 个脚本；`test-smoke.js` 沙箱只 `runInContext` 7 个（162–168 行，**缺 `lib/native-reminders.js`**，仅 596 行 `require` 过一次）；`test-regressions.js` 的 `LIB_SOURCES`（22–28 行）同样缺它（20 行 require、235 行不加载）。sw.js 的 `ASSETS` 与 index.html 现已一致（v5），缺口**只在测试侧**。
影响：两个 harness 里 `AttentionNativeReminders` 恒为 undefined → app-core.js:14 的 `|| {}` 兜底 → **原生提醒链路在测试中跑的永远是「没有原生层」的降级路径**。这正是本项目自己列为最高危失效模式的「写了/改了但没挂上」类；它也让「JS 1625 全绿」对原生侧变更的保护强度低于数字表面。同属四件套纪律的第三、第四处同时失守，不是偶然漂移，是纪律缺了收口断言（sw.js 已有「期望集合从 index.html 推导」的回归思路，harness 没有）。

**S-04【中】bind() 508 行一次挂 115 个监听；#capText 的 input 挂了两个独立监听**
证据：bind 7216–7724；`#capText` input 在 7233–7236 与 7251–7254 各挂一个，各自 debounce（120ms / 400ms），每次输入停顿分别触发 `updateParseHint`（全量中文解析）与 `renderSimilarHint`（全表扫描 + normalizeText）两条独立流水线。
影响：可读性差；小效率浪费（一次输入 burst 双份计算）。非缺陷，是结构异味的典型样本。

**S-05【中】约 700 行诊断实验室 UI 常驻生产包**
证据：`bindNotifyLab` / `describeAlarmDelivery` / `refreshNotifyLab` / `refreshAlarmTrace` / `labTraceTest` / `labShowNow` / `labScheduleAlarm` / `labCancelAlarms` / `renderBackgroundVerdict` 等集中在 5364–6084 行。
影响：仓库无 bundler、无构建期剥离 ⇒ 这些代码 100% 进生产包（app-core.js 366KB），同时把内部排程/取消/跟踪按钮暴露给生产用户。可分性问题，不是运行问题。

**S-06【低】渲染拼接的转义边界**
证据：renderItemCard 2489 行 `data-id` 直接用 `it.id` 拼接（内部生成 id，风险低）；2482 行 `escapeHtml(it.url)` 进 `href`——escapeHtml 只转义引号，不过滤 scheme（见 X-01）。

### B. 执行效率

**E-01【高】保存路径 = 2 次全量 stringify + 2 次全量 parse，另加 1 次镜像 stringify**
证据：`writeSnapshot`（app-core.js:616–643）stringify→parse（IDB 独立副本）→storage.save 内 `lsSet` 再 stringify（storage.js:69–71）→`committedAlarmItems = JSON.parse(json)`（626 行）。一次用户操作触发一次；调用点约 60 处；台账变化（applyDeadlineEvents / applyReminderEvents 尾部 save）、tick 中 promoteDue 变化也会触发。实测见 §1 表：2000 条时 8.89ms/次（桌面），真机估 18–36ms/次。
降级模式（无 IDB）更重：`markPendingReplay`（670–672）把整个 json 再嵌一层 stringify ⇒ 880KB 状态下单次保存 localStorage 写入 ≈ 1.8MB（主键+镜像+pending 三份），5MB 配额设备上有配额风险（本仓已有 export「无声失败」前科，同源）。
可立即做的：`const copy = JSON.parse(json)` 后 `committedAlarmItems = copy.items`，直接减掉一次全量 parse（零行为变化）。方向性的（item 分片存储/增量记账）触碰 H1/H2 提交契约，**需裁决后再动**。

**E-02【高】15 秒心跳全量重渲染，且没有签名短路**
证据：`tick()`（6827–6855）：每 15s → promoteDue（全表扫描 1775）→ maybeReviewSession → filter → renderHome（2515–2624，对 items 约 4 遍扫描 + needsReviewItems + **全列表 innerHTML 重建**）。同文件 7854 行的 refreshActiveAlarmPanel 已有 signature 短路先例，renderHome 没有。回前台（visibilitychange，7906–7915）还会 promoteDue + refreshActiveAlarmPanel(true) + tick 再叠加一轮。
影响：状态无变化时也重建整个列表 DOM + 重绑事件；43 处 innerHTML 赋值的账单由这一个函数承担大半。当前数据量 ms 级；模式问题是「任何变化都重建全列表」。

**E-03【高·已登记】D69：一次前台事件 = 两轮原生全量重排**
证据：appStateChange(isActive) 经 drainAlarmActions 与 onResume 两条通路各请求一次 reconcile，各绕过 80ms 去抖（lib/native-reminders.js:571–572 明写「对 desired 全量重排」）；每轮 `syncNativeRemindersNow` 还深拷贝 items + settings（app-core.js:4880–4881）。实测对内 0.22–0.94s。既是正确性问题（台账成对）也是效率问题。**提案待裁决，代码未动。**

**E-04【中】applyReminderEvents / applyDeadlineEvents 的 O(n²) find 与 stringify 比对**
证据：applyReminderEvents 4763–4764 `targetItemIds.forEach` 内 `state.items.find`；4811 行逐 item `JSON.stringify(prev) !== JSON.stringify(next)`。当大部分事项都带 reminderEvents 时，一次对账 = O(n²) + n 次序列化。
建议（零行为变化）：进入循环前建 `id→item` Map；比对改逐 key 遍历。

**E-05【中】2 秒轮询跨桥调用，无闹钟时纯空转**
证据：bindNetwork 7899 `setInterval(..., 2000)` → refreshActiveAlarmPanel（7835）：每次跨桥 `activeAlarmDeliveries()` + 每个 alarm 两次 `items.find` + signature stringify。signature 短路只挡住 DOM 重建，挡不住桥往返与扫描。
建议：无挂起闹钟时退避更长间隔或改事件驱动（原生到达时推消息）。

**E-06【低】init() 必然双 render()**
证据：8002/8005 分支各一次 + 8008 再一次。启动路径多一轮全量 renderHome。

**E-07【低】降级期 localStorage 三写**（已并入 E-01 描述）：主键 + 镜像 + pending 凭据。

### C. 安全/正确性附带发现

**X-01【中】`it.url` 未校验 scheme 即入 href**
证据：renderItemCard 2482。`escapeHtml` 不拦截 `javascript:` / `data:`；该 url 可来自用户输入，也可来自 AI 解析结果（LLM 输出不可信，且 AI 是可选 BYOK）。自伤为主，但 AI 通道使其具备被第三方内容驱动的可能。建议渲染前限定 http/https，其余降为纯文本。

**X-02【已知】导出无落地出口**（登记缺陷 6）：`downloadFile()`（app-core.js:223–239）走网页 `<a download>`，Android 无 DownloadListener/DownloadManager 接应、无成败上报 ⇒ 无条件弹成功；`navigator.canShare` 在本机 WebView 恒 undefined，分享分支是死代码。提案 E1–E4 待裁决，代码未动。与本报告 E-01 相关：无论落盘方案怎么定，都会走同一个「全量状态序列化」通道。

## 4. 影响程度汇总

| # | 问题 | 当前规模（≈50 条） | 增长后（500–2000 条） | 类型 |
|---|---|---|---|---|
| S-01/02 | 巨模块 + 双实现 | 无运行影响；维护成本随时付出 | 同左，成本线性上升 | 结构 |
| S-03 | harness 缺 native-reminders | 原生侧变更可能被误判为已覆盖 | 同左 | 结构/测试 |
| E-01 | 保存 2×stringify+2×parse | ≈0.3ms，无感 | 2–9ms/次（真机 2–4×），每次操作都付 | 效率 |
| E-02 | 15s 全量重渲染 | ms 级，无感 | 列表 DOM 重建随 n 线性增长 | 效率 |
| E-03 | 双轮全量重排（D69） | 0.2–0.9s 桥往返 | 随 n 再涨 | 效率/正确性 |
| E-04 | O(n²) 台账应用 | 无感 | n² 项，率先可感知 | 效率 |
| E-05 | 2s 轮询空转 | 每分钟 30 次无谓桥往返 | 扫描量随 alarms×items 涨 | 效率 |
| X-01 | url scheme | 潜在 | 潜在 | 安全 |

**效率结论（对用户问题的直接回答）**：结构不合理**确实**造成了效率影响，但影响是「条件触发」而非「当下可感知」——三条可验证的传导链：① 每次保存 = O(全状态) 序列化（实测表格）；② 每 15 秒 = O(全表) 重渲染；③ 每次回前台 = 2×O(全表) 原生重排。在预期数据量下合计毫秒级；随着事项积累（尤其每事项带 reminderEvents 台账）率先劣化的是 E-01/E-03/E-04。对低端机 + 数百条以上的用户，保存路径与回前台对账会先变成可感知卡顿。

## 5. 优化建议（按性价比排序；标注是否需先裁决）

立即可做（零行为变化，仅测试水位或引用方式）：
1. **补 harness 缺口（S-03）**：`lib/native-reminders.js` 加进 test-smoke.js 加载列表与 test-regressions.js 的 `LIB_SOURCES`；并加一条「期望脚本集合从 index.html 推导」的收口断言（sw.js v5 已有同款思路）。让 1625 绿真正覆盖生产组合。
2. **writeSnapshot 少一次全量 parse（E-01）**：`JSON.parse(json)` 结果复用给 `committedAlarmItems`。
3. **renderHome 加签名短路（E-02）**：照抄 refreshActiveAlarmPanel 7854 行的模式。
4. **applyReminderEvents/applyDeadlineEvents 建 Map、去 stringify 比对（E-04）**。
5. **url scheme 白名单（X-01）**：一行守卫。
6. **init() 去掉多余 render()（E-06）**。

需先裁决（触碰既有契约或决策）：
7. **D69 去重（E-03）**：两条通路合并为一次 reconcile（80ms 去抖真正生效）。提案在案。
8. **轮询退避/事件化（E-05）**：改原生侧 push 需动 Java 契约。
9. **保存架构（E-01 长期）**：item 分片或增量记账，触碰 H1/H2 提交契约与 schema 5 回放逻辑。
10. **拆 app-core（S-01/S-02）**：把解析器副本、repeat、quiet hours、render 切到 lib 唯一来源（M-10 的根治版），app-core 只留编排；建议随下一次大改动分期做，每期保持四件套纪律 + 逐字节收口。
11. **诊断 UI 出生产包（S-05）**：无 bundler 前提下可用 `?lab=1` 门控或独立文件按需加载。

## 6. 与既有登记的对应

- 已登记、本报告仅复核引用：D69 双轮重排（E-03）、M-10 app-core/lib 解析重复（S-02）、导出无落地出口（X-02）。
- 本报告**新发现**：S-03（harness 组合漂移，且四件套纪律中两处同时失守）、E-01 的实测量化与降级三写、E-02 的签名短路缺失、E-04 的 O(n²) 与 stringify 比对、E-05 空转量化、E-06 双 render、X-01 url scheme。
- 未改任何代码、未提交、未推送；既有候选与失败证据未覆盖。

## 7. 结论

结构合理性判定：**分层设计正确但执行走样**——巨模块、双实现、测试组合漂移三件事互相加固。执行效率判定：**当下无实感问题，但有明确的三条 O(n) 传导链与一个 O(n²) 点**，重度使用场景下保存路径与回前台对账先劣化。建议按 §5 的 1–6 先做零风险项，7–11 逐项走裁决流程；其中 S-03 与 E-01 的立即项性价比最高，且都与本项目「可复算、可收口」的既有方法论完全兼容。
