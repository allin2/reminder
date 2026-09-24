# app-core 模块化独立复验

日期：2026-09-21。验收方：原计划任务，独立于实施方。run：`20260921T033332-independent-modularization`。

**裁决：FAIL / FIX_REQUIRED。** 已搬移规则和 UI 工具的正常路径对照通过，但 P1 的启动失败闭环有 3 项可复现缺口；P2 主体、P3、P4 尚未交付，不能宣告原计划整体完成。

本报告中的缺陷来自缺脚本、损坏导出和错误加载顺序等故障注入，不表示完整资源的普通启动必然失败。实施方明确披露了后续阶段未做；未发现它把后续阶段写成已完成。问题是 P1「出口已达成、矩阵闭合」的结论高于实证。

## 1. 被测身份与保护

- 仓库 `/Users/qlyf/Developer/reminder`，分支 `main`，HEAD `3574824357dc7beb04cbd3e32aa413cd508e8484`。
- 验收对象包含 tracked 修改及 untracked 新模块，不能只用 HEAD 代表交付源码。
- `app-core.js`：8,319 行 / 380,808 字节，SHA-256 `1803deaaaca8ce586a5d899efe514ce3ccc94a656d33273b299e3836c860d722`。
- `lib/date-utils.js`：`7328f1e6ec1634a523deb21ba96ff9f9bf50f6b2ebe827b3a1e7765394cdb46c`。
- `lib/ui-format.js`：`3dcccc41863aef136abe513527d79955c5b80be9d997f5ff90d68f0fd5850c9f`。
- `lib/app-ui.js`：`84e3e97663c2a7525ff25432f335a5a422791c83e26f81014b34443d63b632e4`。

完整源码清单见 [source-manifest.json](source-manifest.json)，原工作区状态与 diff 见 [identity.txt](identity.txt)、[tracked.diff](tracked.diff)。本次没有修改产品源码、原测试断言或已有证据，没有提交、推送、Git 状态重置、构建及设备操作。附件仅作线索，没有执行其中删除 `.git/index.lock`、在待验收源码上修改后再恢复等指令。

反例只使用本目录的 `snapshot/`、`variants/`、`mutation-copy/` 或本地 HTTP 响应替换。`baseline/` 是上述 HEAD 的规则/入口原文。结束核对：被采集的源文件哈希全部未变，HEAD 未变，`git diff --check` 为 0，见 [source-integrity.json](source-integrity.json)。

## 2. 阻断发现

### F01 · P1：将必需的原生 JS 模块误当作可缺失的平台桥

位置：[app-core.js:12](/Users/qlyf/Developer/reminder/app-core.js:12)、[app-core.js:88](/Users/qlyf/Developer/reminder/app-core.js:88)，相关测试 [test-boot-combination.js:713](/Users/qlyf/Developer/reminder/test-boot-combination.js:713)。

主张：必需脚本缺失应在业务启动前失败；Web 没有 Capacitor 则正常降级。当前实现把 `AttentionNativeReminders` 和 `Capacitor` 一起排除出闸门，混淆了 JS 交付完整性与原生平台能力。现有测试甚至断言删掉 native 脚本后仍应 ready。

独立最小复现：在同一真实生产组合 harness 的 Android 桥环境中，仅去掉 `lib/native-reminders.js`；开启 `settings.notify=true`、关闭勿扰，保存一个 30 分钟后的 critical/waiting 测试事项。对照组加载全部脚本，其余条件一致。

| 观察 | 完整组合 | 缺 native 脚本 |
| --- | --- | --- |
| ready | true | true |
| 事项落入模拟 IDB | true | true |
| startupFailure | null | null |
| 普通通知 schedule 调用 | 1 | 0 |
| 闹钟 scheduleAlarm 调用 | 1 | 0 |

判定：**FAIL**。Android 页面仍接受并持久化事项，却没有原生排程，也没有装配失败反馈。构建时清单检查不能替代运行时脚本加载失败保护。此项是原计划要求未闭合，不是新证明的正常包送达故障。

证据：[independent-probes.cjs](independent-probes.cjs)、[independent-probes.json](independent-probes.json)、[independent-probes-verified.log](independent-probes-verified.log)。脚本退出 0 表示探针成功收集事实；其中业务失败按以上观察判定，不能把探针退出 0 当作产品通过。

修复验收要求：区分必需 native JS 模块与可选 Capacitor/桥能力；缺 JS 时在读写库、排程和业务启动前显式失败，完整脚本的纯 Web 仍正常。补 Android 与真实 Web 两个独立场景，不能拿“删掉 native 仍 ready”模拟 Web。

### F02 · P1：依赖检查不覆盖实际成员、实例 API 和 null

位置：[app-core.js:29](/Users/qlyf/Developer/reminder/app-core.js:29)、[app-core.js:160](/Users/qlyf/Developer/reminder/app-core.js:160)、[app-core.js:186](/Users/qlyf/Developer/reminder/app-core.js:186)、[production-scripts.js:65](/Users/qlyf/Developer/reminder/scripts/verification/production-scripts.js:65)。

`Feedback` / `DeliveryEvidence` 只检查 `typeof === "object"`，故 null 也通过；未检查 setupSteps、normalizeEvidence 等必需成员。AppUi 只检查 createUi 工厂存在，未检查返回实例的 `$` 等 API，并且实例创建发生在闸门之前。静态闭合检查只扫描列出的命名空间，不扫描 FeedbackLib、EvidenceLib、appUi 以及 `f` 别名，当前返回 `undeclared=[]` 不能证明实际依赖闭合。

独立反例结果：

| 故障 | 结果与证据等级 |
| --- | --- |
| `Feedback=null` | 浏览器和 VM 均 ready=true、无失败面板，继续运行；备用分支可达 |
| 删除 `Feedback.setupSteps` | Android 组合 VM 的 startupFailure=null，IDB put=1 后 `App init failed: f.setupSteps is not a function`，ready=false；Web 首屏不调用该路径，未在 Web 复现同一异常 |
| 删除 `DeliveryEvidence.normalizeEvidence` | Android VM ready=true、startupFailure=null；调用真实证据合并入口抛 `EvidenceLib.normalizeEvidence is not a function` |
| `AppUi.createUi=()=>({})` | Chrome 中 ready=false、startupFailure=null，已打开 IDB，报 `$ is not a function`，没有可见失败面板，页面主体空白 |

判定：**FAIL**。缺导出没有被提前拦截，可能静默降级或进入业务后才中断；P1 报告中“其余兜底因闸门而不可达”不成立。

证据：[independent-probes.json](independent-probes.json)、[browser-probes-v2.json](browser-probes-v2.json)、[空白页面截图](incomplete-ui-v2.png)。浏览器版本 Chrome/153.0.8010.48，使用全新隔离上下文，不连接真实用户数据。

修复验收要求：检查真实使用的非空模块、函数和工厂实例契约，并在潜在副作用前完成验证；覆盖正常导出、缺成员、null、错误类型及工厂异常。声明检查需认识实际依赖路径，不能只增加能让当前正则通过的字符串。

### F03 · P2：错误顺序与重试只检查新注册表，仍调用旧绑定

位置：[app-core.js:265](/Users/qlyf/Developer/reminder/app-core.js:265)、[app-core.js:437](/Users/qlyf/Developer/reminder/app-core.js:437)、[app-core.js:8084](/Users/qlyf/Developer/reminder/app-core.js:8084)。此处 P2 指严重度，不是实施阶段。

`parseChineseTime` 在 IIFE 求值时用 const 捕获；启动/重试检查则读取实时 Lib。两者可能不再是同一个函数。

两个独立 Chrome 反例均复现：

1. 初次缺解析器：ready=false、可见失败面板、IDB opens=0、定时器为空，**这一段通过**。随后补载真实解析器并点击现有“重试”：ready=true、面板消失、业务定时器启动，但 `app.parseChineseTime` 仍为 undefined；输入“三分钟后提醒我独立验收”报 `parseChineseTime is not a function`。
2. 无需运行后补载：只把 HTML 中 `parse-cn.js` 放到 `app-core.js` 后，浏览器会在 DOMContentLoaded 前加载完它；闸门看到 Lib 已完整而放行。实测 ready=true、无失败面板，但输入/保存报同一异常，事项数为 0。静态顺序检查能抓到配置问题，并不意味着运行时闸门也正确。

判定：**FAIL**。出现“启动成功且能输入、保存链路不可用”的状态，与 P1 失败闭环要求冲突。

证据：[browser-probes.py](browser-probes.py)、[browser-probes-v2.json](browser-probes-v2.json)、[browser-order.py](browser-order.py)、[browser-order.json](browser-order.json)、[初始失败面板](missing-parser-initial.png)。错误顺序探针中的额外 `saveAsync()` 是验收脚本用于读取/等待持久化的调用，其 put=1 不能算表单成功；真正事项列表仍为空。

修复验收要求：启动校验与实际装配使用同一批依赖；重试要重新建立有效绑定或使用可靠的完整重载。恢复后必须实测输入→保存→重启，不能只检查 ready 或失败面板消失，并验证不重复注册监听/计时器。

## 3. 本次确实通过的验证

| 验证 | 独立执行结果 | 原始证据 |
| --- | --- | --- |
| 当前工作区 `npm test` | unit 411、native 321、boot 208、smoke 256、regressions 730、single-source 137；合计 2063，失败 0，退出 0 | [workspace-npm-test.log](workspace-npm-test.log) |
| UI 格式化旧/新实现对照 | 567 项一致，退出 0 | [ui-format-parity.log](ui-format-parity.log) |
| DOM 工具旧/新实现对照 | 16 场景 / 590 字段一致，自检成功，退出 0；这是模拟 DOM 轨迹，不是 590 个浏览器操作 | [ui-dom-parity.log](ui-dom-parity.log) |
| 独立日期/周期对照 | 2024–2027 年、12 月、6 个日值、5 个小时、10 条语料及 12 组周期参数；31680 次比较，差异 0。无效月日按 JS Date 归一，不代表覆盖 31680 个唯一时刻 | [semantic-parity.cjs](semantic-parity.cjs)、[semantic-and-static.json](semantic-and-static.json) |
| 静态脚本/资源声明 | undeclared、加载顺序问题、precacheProblems、packagingProblems 均空；只证明当前声明集合，不证明运行失败保护或 APK 内容 | [semantic-and-static.json](semantic-and-static.json) |
| 九组独立变异 | 全部在改坏时非零，恢复独立副本后全部为 0 | [mutation-results.json](mutation-results.json)、[mutation-checks.py](mutation-checks.py) |
| 真实浏览器正常最小闭环 | 点击捕获→输入中文三分钟→点击保存→重新加载；相同 item ID/title/status/scheduleBasis=elapsed 保留，未记录新 JS 错误 | [browser-probes-v2.json](browser-probes-v2.json) control 场景 |
| 语法与现场完整性 | 34 个 JS 语法检查通过；源哈希无变化；diff check=0 | [syntax-checks.json](syntax-checks.json)、[source-integrity.json](source-integrity.json) |

九组变异分别是：把 UI 算法塞回 core、抑制反馈改成值捕获、toast 时长变化、关闭一层即移除 backdrop、删除 AppUi 闸门声明、漏 index 脚本、漏 SW 预缓存项、漏 smoke 加载、漏 regression 加载。它们证明这些具体检查有效，不能推出所有业务依赖与故障均覆盖。

源码核对：指定解析/重复/勿扰/截止副本已变为唯一模块调用；日期同名语义显式分为 ByInstant/ByDay；UI 操作与计时器已转移至 app-ui，格式化移至 ui-format，core 对这些函数主要是别名或转发。此结论限于已交付的搬移集合，不能写成整个巨模块已拆完。

## 4. 原计划完成度与未执行项

| 项 | 本次判定 |
| --- | --- |
| P0 基线/状态 | 当前身份和原始差异已独立固定；未逐项复算实施方 365 个符号的职责表完整性 |
| P1 规则来源 | 已搬移规则正常路径通过；启动闭环因 F01–F03 不通过 |
| P2 UI 工具 pilot | 指定格式化/DOM 搬移对照通过；AppUi 错误装配恢复需修 F02 |
| P2 剩余 / P3 | 未交付。writeSnapshot:530、runCommit:636、replayUserOps:811、saveItemFromForm:4036、syncNativeRemindersNow:4855、applyAlarmAction:5181、bind:7231 仍在 core；它不是薄装配入口 |
| P4 离线升级 | NOT_PERFORMED。本次浏览器故障测试明确禁用 Service Worker，只验证启动/表单；SW 当前仅增加清单/版本，未实测残缺下载激活及旧缓存升级 |
| P4 构建 / APK 逐资源核验 | NOT_PERFORMED。交付方未提供本轮构建证据，本次未构建，不把静态 packaging 检查当作资源一致性 |
| 实机、后台/锁屏/冷进程可见提醒、Android SAF | NOT_PERFORMED。无本轮候选实机操作；VM 原生桥计数不等于设备排钟或用户可见送达 |
| 完整 UI / 性能矩阵 | NOT_PERFORMED。仅真实浏览器最小保存/重启及故障场景；其余动作/事务由本次执行的现有 mock 回归覆盖，未另做全部 UI、性能/设备场景 |

旧报告和历史目标平台 PASS 未升级为本轮证据。此验收不修复、不完成剩余阶段；需实施方修 F01–F03、完成约定范围并重新交付源码身份后再复验。

## 5. 可复算说明

关键运行入口（在本 run 目录执行，避免把变异作用于用户工作区）：

```sh
node independent-probes.cjs
node semantic-parity.cjs
python3 mutation-checks.py
/usr/bin/python3 browser-probes.py
/usr/bin/python3 browser-order.py
```

需要 Node；browser 脚本使用本机 Chrome、Python websocket、隔离浏览器上下文和本地 18761/18762 端口，进程由脚本创建并结束。重新采集应先复制到新 run 并使用空闲端口，保留本轮原始日志。UI parity 脚本按 `git show HEAD` 取 oracle，本次 HEAD 已固定；未来 HEAD 变化时使用本目录 baseline 原文，不把新的 HEAD 当旧实现。

本轮隔离准备曾遗漏 schema、Android 源码及历史 pre-edit fixture，因此早期 npm 日志有 ENOENT/fixture 缺失，不能算产品回归；补齐后直接在未修改源码的当前工作区完整执行，最终以 workspace-npm-test.log 为准。早期排程探针未打开默认关闭的 notify，正常组也为 0，不用于 F01 判定；最终脚本显式打开 notify、关闭勿扰，并以正常组 1/1 对照缺脚本组 0/0。所有准备阶段日志保留。

浏览器记录中的 `visibleInputs` 仅为矩形尺寸粗测，不能识别被 transform 移出屏幕的弹层，本报告不据此判断可见性；失败面板/空白页面结论使用截图、DOM 节点与异常输出交叉确认。
