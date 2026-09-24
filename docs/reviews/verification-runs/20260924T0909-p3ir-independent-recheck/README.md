# P3-I-R 独立复验：FAIL / FIX_REQUIRED

本 run 只新增独立复验材料；产品源码、实施方 `20260923T2336-p3ir-delivery`、候选 APK 均未改动。`HEAD=origin/main=3574824357dc7beb04cbd3e32aa413cd508e8484`。

## 补交的复算证据：算术成立，语义验收未成立

把实施方 `compose-stats.js` 逐字节复制到本 run 后执行，退出码 0；两份脚本 SHA-256 同为 `88688c7c71b845076ee6bd56693ebc9b2fe9b9dfa16822f79e341ce83c878a5f`，两份 `compose-partition.json` SHA-256 同为 `ec8676c19bcbf48e4668408864d16b37e1ab6df4c59d3cbb90a83ff920c2abdd`。详见 `compose-stats.log`。

- 六项脚本自检均绿；报告口径 A 22/1389、B 9/295、C 175/429、合计 254/2377 与旧报告相符。D/E 的报告口径行数分别有 +2/−2 差异，实施方已在表中披露。
- 花括号收口口径独立复得 A 1338、B 265、C 426、D 31、E 231，合计 2291；9 处、86 行模块级语句误并入相邻函数，以及 `renderMarkdown`/`pad2` 分类更正也能重现。
- `compose-stats.js` 是函数数量与码行的复算器；其六项自检不验证跨模块状态所有权或用户点击路径。因此它不能单独证明 `openSnoozeSheet` 留在入口是安全的。

旧独立 F1 的原始反例本轮复跑退出码 0，`setupCalls=2, listeners=1`，见 `repro-events-bind-retry.log`。P3-I 模块测试独立复跑退出码 0、83 项断言通过，见 `p3i-modularization-tests.log`。独立核对 v39 的 30 支脚本全部预缓存；SW 清单与 `sw.js` 合计 34 个文件在源码、www、Android assets、debug intermediate、候选 APK 五层一致，见 `verify-identity.py` 和 `identity.log`。候选 APK SHA-256 为 `16d14484dd00d326637c2f41543ce79c9f3584ea27a9ca2b054d77027d487138`。

## 阻断 U1：用户点“稍后提醒”直接报 ReferenceError

`app-core.js:2974-2983` 的 `openSnoozeSheet()` 在严格模式下赋值 `snoozePick`、`snoozeBasis`，但 `app-core.js` 没有声明这两个绑定。唯一声明位于 `lib/app-events.js:511-512` 的 `bind()` 局部作用域，入口函数无法访问。责任表 E-9 称它们为“入口私有选取”，与实际源码不符。

`repro-snooze-entry.py` 用全新 Chrome profile 加载生产 `index.html`、等待 `ready=true`、在一次性浏览器状态中放入隔离事项并点击真实的 `[data-act=snooze]` 按钮。结果为 `buttonFound=true, sheetOpen=false, errors=["ReferenceError: snoozePick is not defined"]`，见 `repro-snooze-entry.log`。候选 APK 与当前源码逐字节一致，故候选包含同一路径。现有绿灯测试直接调用 `snoozeItem()`，没有覆盖打开稍后面板的用户入口。

`baseline-provenance.log` 显示 P3-H-R2 候选也有这个作用域错误（外层使用在 2509 行，唯一 `let` 在 `bind()` 内 3644 行）。它是被沿袭的缺陷，不应误写为 P3-I-R 新引入；但当前验收仍不能把坏的用户入口判为通过。

## 处置与复验条件

Q4 已有明确所有权证据：`snoozePick`/`snoozeBasis` 与 chips、时间输入、确认按钮均由 `lib/app-events.js` 持有。应由实施方让同一事件实例持有打开面板和选时状态；事务待办闸门作为具名依赖注入，入口仅保留必要薄转发。修复后须覆盖“点按钮能打开”“选中一个 chip 后关闭再打开时不沿用旧值”“待办事务被闸门拒绝”“正常确认调用 `snoozeItem` 一次”，并让删除该修复的变异变红。Q2 的详情证据行迁出可以独立排期，无须与这项故障捆绑。

实施方应另开修复 run 与唯一新候选，保留本次实施与独立证据；重跑相关测试、真实 Chrome 点击路径和资源闭合。`npm test` 全量、当前候选独立真机物理交互、通知声振、冷进程闹钟及 P4 旧缓存离线升级在本 run 均为 `NOT_PERFORMED`，不能从实施方自测继承为独立 PASS。
