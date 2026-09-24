# U1 独立复验：PASS（限定于稍后面板入口修复）

本次独立复验针对 `20260924T0909-p3ir-independent-recheck` 的 U1 阻断项。实施方 `20260924T0950-u1-snooze-entry-fix` 仅作为待验证对象。核对时 `HEAD=origin/main=3574824357dc7beb04cbd3e32aa413cd508e8484`，工作区已有未提交内容；本 run 未修改产品源码、旧候选或旧验收结论，也未提交、推送或还原工作区。

## 判定依据

1. 源码所有权：`lib/app-events.js` 的实例持有 `snoozePick/snoozeBasis` 和 `openSnoozeSheet(id)`；生产委托 click 直接调用该实例方法。待办事务闸门通过 `isItemActionPending`、`rejectPendingItemCommand` 两个具名依赖注入；`app-core.js` 的同名函数只作薄转发。打开时先过闸门，再写 `snoozeId`，清除时间输入与 chip 高亮，关闭详情并打开稍后面板。被拒绝时不修改 `snoozeId` 或打开面板。
2. 单元反例独立执行：`unit.log` 记录 T1–T5 **16/0、exit 0**，覆盖真实委托 click、待办拒绝、选中 chip 后重开清空、确认恰好调用一次，以及删掉重置语句后 `MUTANT_RED=1`。已审阅替身：全局 `document` 在场景期间存在，chip 前置确实写出非空值，反例不是空跑。
3. 真实 Chrome 独立执行：`chrome-snooze.log` 记录 `ready=true`、生产按钮存在、面板打开、`errors=[]`；选中 chip 后重开，输入和高亮均清空；再次选择并确认后面板关闭且 `triggerAt` 推进。额外编写 `repro-snooze-close-reopen.py`，通过生产「取消」按钮先关面板，再点卡片按钮重开；`chrome-close-reopen.log` 显示 `closedBeforeReopen=true`、`emptyConfirmBlocked=true`、旧值清空、重新选择后正常推进。旧验收方的原始“期待复现故障”脚本重跑输出 `sheetOpen=true, errors=[]`、exit 1（`old-failure-repro-now-fixed.log`）；该脚本的 exit 1 表示**旧故障未复现**，不是修复失败。确认调用次数由单元计数器证明，Chrome 用于验证生产用户路径与状态结果。
4. 既有绑定重试反例独立复跑：`bind-retry.log` 为 `setupCalls=2, listeners=1`、exit 0；U1 状态上收未破坏先前 F1 修复。P3-I 模块测试 **84/0**，单一来源解析 **160/0**。全量 `npm test` **3139/0、exit 0**（642+324+84+933+266+730+160）。入口构成复算六类 MATCH，254 个函数、naive 2370 行、花括号收口 2284 行；这些数字仅用于核对分类，不单独证明行为正确。
5. 交付身份：候选 APK SHA-256 为 `340975ff957d8ee45d5da844450fd24e97bac431ba9d94bb59af1ff78f2c922e`。独立 `verify-identity.py` 检查 SW v40、30 支页面脚本均在预缓存、34 项 SW 资源在源码/www/Android assets/debug intermediate/APK 五层一致；`verify-all-resources.py` 检查全部 39 项 Web 资源五层一致。与 P3-I-R 前一候选相比，APK 内 Web 资源只有 `app-core.js`、`lib/app-events.js`、`sw.js` 三项变化。

## 范围与未执行

- **U1 阻断解除。** 这不宣告整个 `app-core.js` 模块化工程或 P4 完成。Q2 `detailReminderStatusRow` 的所有权处理仍属另批工作。
- 当前候选真机物理交互、通知声振、冷进程闹钟，以及 v39/更旧缓存的 P4 离线就地升级：**NOT_PERFORMED**。浏览器恢复计量本轮未复跑，不能写成当前批次独立 PASS。
- 本 run 的 `compose-stats.js` 从实施方复制后在本目录执行，独立生成 `compose-partition.json` 并与实施方文件逐字节相同。最初直接运行实施方原脚本时，该脚本按自身路径重算了实施方 `compose-partition.json`；这是复验操作造成的证据目录写入，未改产品源码，且两份现存分区逐字节相同。另有一次绑定重试脚本路径写错、因 `MODULE_NOT_FOUND` 未执行，随即改用真实脚本路径重跑通过；前一次没有作为测试结果计入。

## 复算入口

- `unit.log`：`node docs/reviews/verification-runs/20260924T0950-u1-snooze-entry-fix/snooze-entry/01-unit-snooze-entry.js`
- `chrome-snooze.log`：`python3 docs/reviews/verification-runs/20260924T0950-u1-snooze-entry-fix/snooze-entry/repro-snooze-entry-fixed.py`
- `chrome-close-reopen.log`：`python3 docs/reviews/verification-runs/20260924T1011-u1-independent-recheck/repro-snooze-close-reopen.py`
- `old-failure-repro-now-fixed.log`：`python3 docs/reviews/verification-runs/20260924T0909-p3ir-independent-recheck/repro-snooze-entry.py`（预期 exit 1 且报告旧故障未复现）
- `verify-identity.py`、`verify-all-resources.py`：本 run 内的独立五层核对脚本；输出见 `identity.log`、`all-resources.log`
- 其余原始输出及退出码见 `p3i-tests.log`、`parse-single-source.log`、`npm-test.log`、`bind-retry.log`、`compose-stats.log`、`apk-web-diff.log`；文件哈希见 `sha256.txt`。
