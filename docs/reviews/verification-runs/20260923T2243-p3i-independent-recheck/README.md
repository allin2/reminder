# P3-I 独立复验：FAIL / FIX_REQUIRED

本 run 只读复核 P3-I 实施交付；未改产品源码、未覆盖候选 APK、未执行破坏性 Git 操作。实施方报告 `20260923T1910-p3i-delivery` 是线索，不是验收结论。

## 已复核的正面证据

- `HEAD=origin/main=3574824357dc7beb04cbd3e32aa413cd508e8484`；交付候选 `releases/candidates/20260923T1910-p3i-candidate/app-debug.apk` SHA-256 为 `c949ad2861bd47680a29384d4f4bdc8a69a594473a366936a9eb239ca8bac7a3`。
- 独立执行 `npm test`，退出码 0；独立执行 `browser-views-check.py` 与 `browser-capture-check.py`，均退出码 0，输出分别见 `browser-views.log`、`browser-capture.log`。这证明正常启动、视图与捕获路径可用，不证明异常绑定重试。
- 独立读取 `sw.js` 的预缓存清单与 `index.html` 脚本清单：v38，29 支脚本均被预缓存；33 个唯一文件在源码、www、Android assets、debug intermediate、候选 APK 五层 SHA-256 一致，详见 `identity.log`。本项只覆盖 SW 清单内文件及 `sw.js`，没有复用实施方的 38 项断言脚本。

## 阻断发现 F1：事件绑定失败后不能重试

`lib/app-events.js:293-298` 在取得 DOM、执行任何依赖绑定或注册监听器之前就设置 `bound = true`。`deps.bindSetupReviewControls()` 等后续步骤抛错时，下一次 `bind()` 在首行直接返回。`app-core.js` 的 `startApp()` 会把启动异常转成失败并允许重试，因此这不是孤立的测试状态：重试可以把应用带到部分绑定或零绑定状态。

`repro-events-bind-retry.js` 用交付模块原样运行，正常对照注册 1 个 document 监听器；让首次 `bindSetupReviewControls` 抛一次可恢复错误后，再调用 `bind()`，观察到 `bound=true, setupCalls=1, listeners=0`，正式断言以退出码 1 变红。原始输出在 `repro-events-bind-retry.log`。实施方测试只测成功后的重复绑定，不覆盖失败后重试。修复需使整个绑定过程在失败后可恢复，并处理部分监听器已注册时的重试防翻倍；只把 `bound=true` 移到末尾仍不足以处理后段抛错。

## 未完成的原目标 F2：入口仍承担具体业务

本轮 `app-core.js` 从 4,567 行/221,444 字节降至 3,971 行/195,751 字节，但顶层 `function`/`async function` 从 237 增至 255。原计划的约 500 行是审查触发线，不是机械硬门；关键问题是入口仍含可独立归属的实现体，例如 `homeNoticeVerdict`/`renderHomeNotice` (`app-core.js:2797-2898`)、`isDue` (`2910`)、`updateAppBadge` (`3046`)、`setUserMode` (`3102`)、`maybeDailySummary` (`3249`)。交付报告称入口“彻底摆脱具体业务、算法及 DOM 渲染实现”，与这些当前可执行代码不符。若这些职责确需留在入口，应逐项给出依赖和所有权理由；否则继续拆分并验证单一来源，不能把本批次当作最终瘦身收口。

## 交付证据需校正 F3

实施方 README 中三个新模块的字节/哈希身份与当前源码及候选不一致：

| 文件 | 报告 SHA-256 | 当前源码与候选 SHA-256 | 当前行/字节 |
| --- | --- | --- | --- |
| `lib/app-action-feedback.js` | `82136e69623e165842880b9195b05fe8050e8b159f8a37943d0e980327f12361` | `2018a80513db674417d2fe37163d30fa22ed572dd491daf6c699a34eaf9f642a` | 276 / 10,819 |
| `lib/app-events.js` | `c1bbcc3514a60b9687e1704e6c99446df6db9213192aa734d5885fbf803b0c25` | `d89d06f0c2937060d61b1560d6c652b45560fbcfcb21b8e5633b62e58e421a7a` | 878 / 33,479 |
| `lib/app-test-api.js` | `877e84e55fe9dc3f1406859e0a0d9275bf1cc19d45e0f7fe91b5c46d3284000a` | `580814237f4b6c8924455d381c059f12f316d93cc3c40a42e1fe2b3aa170777b` | 400 / 25,230 |

这不表示当前 APK 与源码不一致；独立五层检查对这些文件为 MATCH。实施方 run 目录也没有 npm、boot、Chrome 原始日志/退出码文件，README 的测试水位目前缺少可审阅的原始输出。返工应另开 run 保留本次原证据，按冻结后的实际源码、APK 和原始输出重新建表，不回写历史来掩盖差异。

## 下轮复验条件与边界

优先修 F1，并补早段、后段绑定抛错后重试、正常二次绑定不翻倍的反例；再按原目标收敛或明确登记 F2 的留存职责；重新构建唯一候选、核对加载链/资源身份，提交真实日志。旧候选及本 run 原样保留。

独立真机物理交互、通知声振、旧缓存到 v38 的 P4 离线升级均为 `NOT_PERFORMED`；实施方真机数据没有在本 run 冒充独立实机 PASS。
