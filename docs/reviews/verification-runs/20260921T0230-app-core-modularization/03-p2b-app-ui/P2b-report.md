# P2-b 实施报告：搬出共用展示能力 `lib/app-ui.js`

> 计划：`docs/handoff/2026-09-21-app-core-modularization-plan.md` §5「P2：先搬移独立 UI 与平台功能」
> run 目录：`docs/reviews/verification-runs/20260921T0230-app-core-modularization/03-p2b-app-ui/`
> 基线 HEAD：`3574824357dc7beb04cbd3e32aa413cd508e8484`（**本轮改动未提交、未推送**）

---

## 1. 这一步搬了什么

| 原位置（`app-core.js`） | 新位置 | 形态 |
| --- | --- | --- |
| `$` / `$$` | `lib/app-ui.js` | 实例属性（原为模块顶部单行箭头函数） |
| `openSheet` / `closeSheet` / `closeAllSheets` | 同上 | 实例方法 |
| `confirmDialog` | 同上 | 实例方法 |
| `toast` / `hideToast` + `toastTimer` | 同上 | 实例方法（**定时器随实现一起走**） |
| `safeExternalHref`（外链协议白名单） | 同上 | **模块级**纯函数 |
| `toLocalInput` / `parseLocalInput` | `lib/ui-format.js` | 纯函数（补进 P2 首批的同一层） |
| `dayLabel` | `lib/ui-format.js` | 纯函数（同上） |

装配方式：`AppUi.createUi(deps)` 由 **app-core 顶部**统一实例化，`deps` 只有一个
`isFeedbackSuppressed`，且**按取值函数注入**（理由见 §4）。app-core 侧只留 9 行别名绑定。

### 边界为什么这么切

计划 §4 把 `lib/app-ui.js` 描述为「DOM/格式化/安全输出、弹层、toast、确认框等共用展示能力」。
本轮的切法是：**按「是否碰宿主」划线**，而不是按功能名划线。

- `lib/ui-format.js` —— 纯函数（输入 → 字符串/数值），可注入 `now` 做固定时钟测试，Node 下可直接 `require`；
- `lib/app-ui.js` —— 碰 DOM / 碰 `setTimeout` / 需要 `window` 兜底的那批。

因此「格式化」这一块被拆到了两个文件里。这是计划允许的**小幅边界调整**（§4 允许「按真实依赖
小幅调整文件名和相邻边界」），已在两个文件的头部注释里互相写明归属。

---

## 2. 「搬移没改行为」怎么证

`toast` / `confirmDialog` 这类的不像 `fmtTime` 那样能逐字符串比对 —— 它们的作用是**改动 DOM 与会话状态**。
所以证据形式也换了一种，脚本：`scripts/verification/ui-dom-parity.js`。

做法：
1. **oracle = `git show HEAD:app-core.js` 里的搬移前原实现**（本轮未提交，HEAD 就是搬移前原文，
   不是我另写的副本）；
2. 两边都装在**同一套假 DOM + 假定时器**上，按**同一串步骤**驱动；
3. 每一步之后对全部 13 个节点拍快照（类集合 / `textContent` / `hidden` / **是否挂了 `onclick`**），
   并把「挂起中的定时器延时」一并记入；**逐步逐字段**比对。

**结果：16 个场景、590 个比对字段项，全部一致（PASS）。**

覆盖到的关键契约（每一条都真的走到了）：

- `closeSheet` 的 backdrop 口径是「**还有没有开着的层**」，不是「关了一次就撤」——
  为此假 DOM 里注册了两个 sheet，只注册一个永远分不出对错；
- `toast` 一个动作 / 两个动作 / `second` 形状不合法 / 连续两次（前一个定时器必须被撤）；
- 时长口径：无动作 2400、有动作 5000、显式 `durationMs`（含 `0` 这一档——`0` 是 falsy，
  所以「显式 0」与「未指定」会走不同分支，这是个真实的边界）；
- `confirmDialog` 三个出口（确定 / 取消 / 关闭）**各自的解析值**与「点完之后三个 `onclick` 必须被清干净」；
- `confirmDialog` 的兜底路径：没有 `#sheetConfirm` 时落到 `window.confirm`，
  含「`window.confirm` 抛错 ⇒ 保守取 `true`」这一支；
- `safeExternalHref` 26 项 URL 矩阵 × **两条分支**：有 `URL` 构造器 / 没有 `URL` 构造器
  （已登记降级）。含 `java\nscript:`、`ja\tvascript:`、大小写混杂、`data:`、相对路径、
  缺授权段、带 `\u0000` / `\u007f` 的串。

### 脚本自身的三条自检（缺一条上面就是恒真断言）

1. **反向对照**：把新实现的默认时长从 2400 改成 2500 ⇒ 必须被报出差异。**已验真（true）**。
2. **稳定性**：同一实现连跑两遍轨迹必须一致。**已验真（true）**。
3. **轨迹非空**：8 条对 oracle 轨迹的**正向**断言（例如「开 capture 后 `#sheetCapture` 含 `.open`」
   「关掉最后一层后 backdrop 不含 `.show`」「定时器到点后提示条收起」），
   并确认轨迹里真的出现过非空 DOM 状态与挂起定时器。**全部成立**。

> 第 3 条是必需的：没有它，「两边都什么都没做」也会得到 PASS。

---

## 3. 结构化判据与闸门

### `scripts/verification/parse-single-source.js` 新增 A3 段（97 → 137 项）

三类判据，缺一不可：

- **算法体标记必须消失** —— 11 条标记全部**从 HEAD 原样摘下**（不是我猜的形态），
  含 `(r || document).querySelector(s)`、`$("#backdrop").classList.add("show");`、
  `if (!$$(".sheet.open").length)`、`const duration = (opts && opts.durationMs) || (hasAction ? 5000 : 2400);`、
  `if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;` 等；
- **装配必须显式** —— 9 条别名绑定字符串必须存在（防「搬走了但没人知道搬到哪」）；
- **必须仍被真实引用** —— 11 种引用形状，见下方「两处误报」。

反向对照：把 `$("#backdrop").classList.add("show");` 塞回 app-core ⇒ 判据变红。**已验真**。

### 两处误报，都是我的断言写错（逐条核过源码才改）

1. **`toLocalInput` 的标记不唯一**。我最初用
   `return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +` 作标记，
   结果误报 —— 该前缀同时出现在 **`aiNowIso()`**（AI 请求用的**带时区偏移**的 ISO-8601 串）里。
   两支都要拼 `YYYY-MM-DD`，但**不是同一个函数**。已换成只属于 `toLocalInput` 的收尾行
   （`aiNowIso` 那行后面还接 `+ sign +`，收尾不同）。
   *这与上一轮 `dayLabel`/`fmtDate` 那次是同一类错误：标记必须只属于被搬移的那一支。*
2. **`closeAllSheets` 从来没有以 `closeAllSheets(` 的形式被调用过**。核对后：
   它只有两条路径 —— 作为 `#backdrop` 的 click 监听器传入、以及测试钩子里导出。
   改成按**引用形状**判定后通过。
   *（「绑了却完全没人引用」仍会被这条抓到，所以放宽的不是判据强度，而是判据形态。）*

### 闸门反例（`test-boot-combination.js` 新增 ⑩，202 → 208 项）

- **抽掉 `lib/app-ui.js` ⇒ `ready` 失败，且同时点名 `AppUi` 与 `AppUi.createUi`**；
- 抽掉后**不读库、不落库、不起 15 秒心跳**；
- 抽掉后**仍渲染出可见失败面板**（缺的正是 DOM 能力，不能因此静默）、
  面板里**没有可编辑控件**（`createElement` 只建了 `section`/`p`/`div`/`button`）、
  且**真的写出了「哪一支没起来」**（文案里点名 `AppUi`）；
- **正向**：正常组合下 `uiSurface()` 实测 9 项能力都在，且 `safeExternalHref` 三档判定
  返回真实值（`https` 放行、`javascript:` 与 `ja\tvascript:` 拒绝）。

> 为让「没有可编辑控件」和「面板上写了什么」能被**计数/取证**，harness 补了
> `CREATED`（建了哪些标签）与 `CREATED_TEXT`（写进了什么文字）两本台账 ——
> `renderStartupFailure` 全程不碰 `innerHTML`，只看 `innerHTML` 计数看不到它。

---

## 4. 一处必须写明的设计选择：活绑定

```
AppUi.createUi({ isFeedbackSuppressed: () => suppressUserFeedback })
                                          ^^^ 取值函数，不是取值
```

`suppressUserFeedback` 是 app-core 里那个「重放用户操作期间置真」的标志位，
而装配发生在 IIFE 顶部 —— 那一刻它**必然是 `false`**。按值传会把整段重放期的抑制逻辑
钉死成「永不抑制」，于是 M1（重放时不重复弹提示）静默失效，且**不报错**。

`parse-single-source.js` 里为此加了两条断言：注入形态必须是取值函数、且不得出现按值传的写法。

---

## 5. 加载链收口（六处 + 一处声明表）

| 位置 | 改动 |
| --- | --- |
| `index.html` | 新增 `<script src="lib/app-ui.js">`，排在 `ui-format.js` 之后 |
| `sw.js` | `ASSETS` 增加 `./lib/app-ui.js`；缓存版本 `v7 → v8` |
| `test-smoke.js` | 加载清单增加 `lib/app-ui.js` |
| `test-regressions.js` | `LIB_SOURCES` 增加 `lib/app-ui.js` |
| `test-boot-combination.js` | `EXPECTED_INDEX_SCRIPTS` 增一行（9 → 11 支，数量由数组长度派生） |
| `scripts/verification/production-scripts.js` | `NAMESPACE_LOCALS` 增加 `AppUi` —— **不加的后果是这个模块的引用完全不被闭合判定覆盖** |
| `app-core.js` | `REQUIRED_RUNTIME_EXPORTS` 增加 6 条（`AppUi` / `AppUi.createUi` / `AppUi.safeExternalHref` / `UiFormat.dayLabel` / `toLocalInput` / `parseLocalInput`） |

`LOAD_TIME_DEPENDENCIES` **未新增条目**：`lib/app-ui.js` 求值时不读 `AttentionLib` 的任何导出
（`document` 与 `URL` 都在**调用时**取），因此**没有加载期依赖**。这一条写进了 `index.html` 的注释里，
免得后人以为它是顺序约束。

`scripts/sync-www.js` 按 `DIRS = ["lib"]` **整目录按 `.js` 复制**，所以新模块会被自动带上，
不存在「构建成功但资源没进包」的静默缺口；`production-scripts.js` 的
`precacheProblems()` 与 `packagingProblems()` 均返回 `[]`。

---

## 6. 测试水位

| 套件 | 本轮前 | 本轮后 | 变化 |
| --- | --- | --- | --- |
| `test-unit.js` | 364 | **411** | +47（ui-format 补 10 项；app-ui 新增 37 项） |
| `test-native-reminders.js` | 321 | **321** | — |
| `test-boot-combination.js` | 202 | **208** | +6（app-ui 缺件与正向接线） |
| `test-smoke.js` | 256 | **256** | — |
| `test-regressions.js` | 730 | **730** | — |
| `parse-single-source.js` | 97 | **137** | +40（A3 段 + ui-format 补充三支） |
| **合计** | **1970** | **2063** | **+93，失败 0，退出码 0** |

另（一次性对照脚本，**不入** `npm test`）：
`ui-dom-parity.js` 590 项一致；`ui-format-parity.js` 567 项一致。

### `test-unit.js` 的一处基础设施改动

该文件此前只有 storage 一段异步，`finish()` 直接写在它的链尾 —— 隐含假定「异步只有一段」。
app-ui 的确认框**必须被 `await`**（它的返回值就是「确定/取消」这个契约本身），
再加一段后，**先到达的那段不能提前出结果**（否则后一段的断言会在 `process.exit` 之前被丢掉，
结果却看起来是「全过」）。为此加了 `beginAsyncSection()` 收尾门：每段自己销账，账平了才打印。
storage 段的两个 `finish()` 调用改为该段自己的销账函数。

> 中途踩到一个 TDZ：计数变量最初跟 `finish()` 一起放在文件尾部，而段首登记发生在文件中部，
> 于是报 `Cannot access 'asyncSectionsPending' before initialization`。声明已提到文件顶部，
> 并在注释里写明**为什么不能放在尾部**。

---

## 7. 规模

| | HEAD | 现在 |
| --- | --- | --- |
| `app-core.js` 行数 | 8,558 | **8,319** |
| `app-core.js` 字节 | 387,384 | **380,808** |
| `app-core.js` 顶层函数数 | 291 | **268** |

⚠️ **行数只掉了约 240 行（2.8%），不要把它当作进展指标。**
被删掉的算法体位置换成了说明注释（这一轮尤其多，因为要解释「为什么切在这里」
「为什么按取值函数注入」）。计划 §4 也明确：门槛是职责完整、无复制算法、依赖可说明，
**不能靠压缩代码或删注释达标**。真正的判据是 §1 那张表 —— 行为的所有权换了文件。

app-core 目标 ≤ 约 500 行（§4）。当前 8,319 行，**差距仍然极大**：P2 只走到了
「UI 工具 + 共用展示能力」，AI / 备份 / 诊断 / 引导 / 内容视图 / 表单以及 `bind()` 的逐功能拆分
**全部未开始**，P3 的持久化与事务整组迁移也**未开始**。

---

## 8. 本轮明确**没有**做的事

- **未提交、未推送**。所有改动保留在工作区，便于审阅与独立复验。
- **未做真机构建与实机验证**（属 P4）。不会把「构建成功」写成实机 PASS；
  本轮**连构建都没跑**（P4 才比 `assets/public` 与 APK）。
- **未做离线升级实测**（属 P4）。
- `downloadFile` **仍留在 app-core** —— 按计划它属 `lib/app-backup.js`（备份导出/SAF），
  本轮未动。
- `FeedbackLib ? … : null` 形式的**其余内联兜底**仍在源码里（闸门已保证实际不可达），
  按计划应在搬移对应功能时清理；本轮只清理了与本次搬移直接相关的那批（那批是 P1 的事）。
- `bind()` **仍是单个大函数**，本轮一行未拆。
- 未改 `app.js`（PRD 页交互，生产 `index.html` 不引用它），未接入或删除
  `lib/import-*` / `lib/export-format.js`。

---

## 9. 复算命令

```bash
cd /Users/qlyf/Developer/reminder
npm test                                                    # 六套 2063 全绿
node scripts/verification/ui-dom-parity.js                  # 590 项逐步逐字段一致
node scripts/verification/ui-format-parity.js               # 567 项逐项一致
node scripts/verification/parse-single-source.js            # 137 项，单一来源闭合
node -e "const p=require('./scripts/verification/production-scripts.js');\
console.log(p.runtimeDependencyCoverage('.').undeclared, p.inspectList('.',p.readIndexScripts('.')))"
```

**独立复验方请自行复跑**：`ui-dom-parity.js` 的反向对照（改一处时长必须变红）、
`test-boot-combination.js` 抽掉 `lib/app-ui.js` 的反例、以及
`parse-single-source.js` 的 A3 反向对照。自测**不等于**独立验收。
