# U1 修复：稍后面板入口 ReferenceError（回应 20260924T0909 独立复验）

状态：**实施方自测 PASS，待独立复验**。本轮为独立复验 U1 阻断项的修复 run；
旧证据（`20260923T2336-p3ir-delivery`、`20260924T0909-p3ir-independent-recheck`）原样保留。

## 缺陷与修法（对应复验「处置与复验条件」逐条）

`app-core.js` 的 `openSnoozeSheet()` 给 `snoozePick`/`snoozeBasis` 赋值，但这两个绑定
只存在于 `lib/app-events.js` `bind()` 的局部作用域，严格模式下用户点「稍后提醒」必抛
`ReferenceError`，面板打不开（缺陷沿袭自 P3-H-R2，非本轮新增，但验收不可判过）。

按裁决口径修复：

1. **选时状态上收**：`snoozePick`/`snoozeBasis` 提升为 app-events **实例级**状态
   （`lib/app-events.js`，紧邻 `let bound`），chips / 自定义输入 / 确认按钮的处理器
   与面板打开共用同一份。
2. **面板打开归实例**：实例新增 `openSnoozeSheet(id)`（闸门 → 置 `state.ui.snoozeId`
   → 重置选择 → 清自定义输入与 chip 高亮 → 关详情弹层 → 开稍后面板）；
   `[data-act=snooze]` 委托处理器改调实例自身方法。
3. **事务闸门具名注入**：`isItemActionPending` / `rejectPendingItemCommand` 加入
   `REQUIRED_DEPS` 并由 `eventsRuntimeDeps()` 提供；`openSnoozeSheet` 不再作为依赖注入
   （app-events 已自身持有，避免依赖入口转发）。
4. **入口只留薄转发**：`app-core.js` `openSnoozeSheet(id)` → `return appEvents.openSnoozeSheet(id)`。
5. **契约表**：`APP_EVENTS_INSTANCE_CONTRACT.instance` 增加 `openSnoozeSheet`；
   p3i 测试的 `CONTRACT_METHODS` 同步。
6. **SW 缓存 v39 → v40**。

## 改动文件

| 文件 | 变化 | SHA-256（前 8） |
|---|---|---|
| `lib/app-events.js` | 状态上收 + 实例 `openSnoozeSheet` + 具名闸门依赖 | `dffc0c55…` |
| `app-core.js` | 入口降为薄转发 + deps 注入替换 + 契约表 | `90d49cd2…` |
| `sw.js` | 缓存版本 v40 | `7287ed88…` |
| `scripts/verification/parse-single-source.js` | `$$` 引用形状判据如实更新（见下） | `db152e8f…` |
| `scripts/verification/p3i-modularization-tests.js` | 具名依赖替身 + 合同成员 | `485bddd8…` |

## 反例（`snooze-entry/`，对应复验四条要求 + 变异）

- **01-unit-snooze-entry.js（16 项断言，exit 0）**
  - T1 点按钮能打开：走 `bindListeners` 注册的**真实委托 click 处理器**派发
    `[data-act=snooze]`，面板打开、无 ReferenceError；
  - T2 闸门拒绝：`isItemActionPending` 命中 → 返回 false、`rejectPendingItemCommand`
    恰一次、面板不开、`snoozeId` 未被改写；
  - T3 重开不沿用旧值：选 tonight chip → 重开 → chip 高亮与自定义输入已清，
    未重选即确认 → 「请选择时间」且 `snoozeItem` 零调用；
  - T4 确认恰好一次：`snoozeItem(id, when≈now+10min, "elapsed")` 恰一次、面板关闭、
    弹条隐藏、第二次确认不再触发；
  - T5 变异对照：脚本内现场构造变异体（删掉「打开时重置」两行），重开场景**变红**
    （旧值被沿用、`snoozeItem` 被调用，MUTANT_RED=1）。
- **repro-snooze-entry-fixed.py / .log（真实 Chrome，exit 0）**：改编自验收方
  `repro-snooze-entry.py`（同环境参数：一次性 profile、`--no-sandbox`、`no_proxy=*`；
  `parents[4]→parents[5]` 修正子目录层级）。断言反转：`sheetOpen=true`、`errors=[]`；
  另测 R3 重开清空（自定义输入空、chip 高亮清、面板仍开）与 R4 确认恰好一次
  （`triggerAt` 精确推进到今晚 20:00、面板关闭）。本轮在源码上跑，五层闭合证明
  源码 == APK 内资源逐字节相同。
- 注意：单元替身环境的 `document` 必须在场景期间保持全局存活（app-events 的 `$/$$`
  运行时读全局 `document`）；首版替身在 `bind()` 后删掉它导致 T3 静默走过场，
  已修正 —— 这也是「恒真断言」的一种新形态，记录在案。

## 一处判据的如实更新（`parse-single-source.js`）

`openSnoozeSheet` 迁出后，app-core 里 `$$("#…")` **字面量**调用的最后一块随之消失
（修复的预期结果）。`UI_USAGE_SHAPES` 的 `$$(\"` 条目更新为 `$$(sel` —— app-core 中
剩余 8 处 `$$` 引用全部是注入模块 deps 的活引用；「绑了却完全没人引用」仍会被点名。
变化原因与日期已写入脚本内注释。

## 入口构成复算（`compose-stats.js` / `compose-stats.log`）

沿用上一轮复算器，对账数字更新为本轮报告口径，**六项自检全绿、六类全 MATCH**：

| 类别 | 个数 | naive 行数 | 对账 | 收口行数 |
|---|---|---|---|---|
| A 装配与依赖注入 | 22 | 1390 | MATCH | 1339 |
| B 启动闸门与失败呈现 | 9 | 295 | MATCH | 265 |
| C 实例方法薄转发 | **176**（+1） | 432 | MATCH | 429 |
| D 纯函数模块转发 | 11 | 33 | MATCH | 31 |
| E 仍留在入口的实现体 | **36**（−1） | **220**（−13） | MATCH | 220 |
| 合计 | 254 | 2370 | MATCH | 2284 |

`openSnoozeSheet` 由 E（11 行实现体）变为 C（3 行薄转发）；A +1 来自
`eventsRuntimeDeps` 的具名依赖替换。D 的 +2 行为 naive 边界假象，上一轮已披露，
本轮如实沿用。

## 水位

- `npm test` **3139/0**（exit 0）：unit 642 + native 324 + p3i **84**（+1，合同成员）
  + boot 933 + smoke 266 + regressions 730 + single-source **160**（判据更新后恢复闭合）；
  `raw-logs/01-npm-test.log`。
- 浏览器 views / capture 冒烟（沿用上一轮适配副本）：全部 ✓（`02/03`）。
- 五层资源闭合 **39/39**（`resource-closure.json`，"genuine intermediate hashes"）。
- 候选 APK：`releases/candidates/20260924T0950-u1-snooze-entry-fix-candidate/app-debug.apk`
  SHA-256 `340975ff957d8ee45d5da844450fd24e97bac431ba9d94bb59af1ff78f2c922e`。
- git：`HEAD == origin/main == 3574824`（未提交；工作区即交付身份）。

## 边界（NOT_PERFORMED，不继承、不豁免）

- 候选 APK 的真机物理交互、通知声振、冷进程闹钟：未执行（继承自独立复验的 NOT_PERFORMED）。
- P4 旧缓存（v39 及更早）离线升级：未执行。
- `browser-recovery-check.py`（Chrome+IDB 恢复计量）本轮未重跑：本轮改动不触及
  恢复/持久化路径，上一轮独立复验结果仍然有效；如需可补跑。

## 给独立复验的建议看点

1. 先跑 `snooze-entry/01-unit-snooze-entry.js`（应 16/0、MUTANT_RED=1），再跑
   `snooze-entry/repro-snooze-entry-fixed.py`（应 `U1_REAL_CHROME=PASS`）。
2. 复算 `compose-stats.js`（应六项自检绿 + 六类 MATCH）。
3. `verify-resources.py` 对 `340975ff…` 候选（应 39/39）。
4. 重点审 `lib/app-events.js` 的 `openSnoozeSheet` 与实例状态、`eventsRuntimeDeps`
   的具名注入、以及「chip 选中 → 重开 → 未重选确认」这条路径是否真的清干净。
