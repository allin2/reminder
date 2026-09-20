# O1–O7 代码优化独立验收

- 日期：2026-09-20
- 被验收 run-id：`20260920T1706-code-optimization`
- 验收结论：**FAIL / FIX_REQUIRED**
- 交付身份：工作区字节；`source-hashes.txt` 中全部条目复核匹配
- 仓库身份：`main` / `4de5f597573bc2c45b51ba8ab18a279d054339a0`，未提交、未推送
- 验收方式：隔离字节快照 + 独立 Node 反例 + Chromium 153 真实浏览器；未改产品源码

## 1. 结论

O1–O7 的主要优化机制大多有效，但当前版本不能通过独立验收：发现 2 个能在真实浏览器稳定复现的用户可见回归。

1. **O6 首页签名碰撞导致保存后显示旧标签。** 标签从单项 `work,home` 改成两项 `work home` 后，内存和持久化数据已经是 `["work", "home"]`，首页仍显示 `#work,home`；重载后才显示 `#work #home`。编辑前源码没有该问题。
2. **O3 畸形 HTTP(S) 地址仍成为可点击链接。** `https://[`、`http://%zz`、`https://example.com:99999` 在真实 Chromium 中仍被渲染为 `<a>`。原因是 `new URL()` 抛错后继续进入本应只用于“环境没有 URL 构造器”的字形兜底。

因此验收状态是 `FIX_REQUIRED`。未发现 O2/O4/O5/O7 的阻断性回归；这些部分的局部 PASS 不覆盖上述失败。

## 2. 身份与隔离

- 交付方 `source-hashes.txt` 全部匹配当前工作区。
- 验收开始时复制 158 个相关源码/配置文件到临时隔离目录，生成 `snapshot-manifest.json`；测试、探针和 localhost 页面都读取这份隔离快照。
- 当前仓库已有大量既有 dirty/untracked 文件；验收未 reset、checkout、提交、推送、覆盖 APK 或修改用户事项。

## 3. 独立验证结果

| 范围 | 结果 | 独立观察 |
|---|---|---|
| 最终测试套件 | PASS | 隔离副本 `npm test`：unit 330 / native 321 / boot 165 / smoke 255 / regressions 730，共 1801 / 0 |
| O1 生产组合 | PASS，报告需纠正 | 真实 8 脚本组合、缺 native、app-core 前置反例均通过/按预期失败；但 regressions 并非原生恒为 undefined，它明确注入真实 native 模块并覆盖 `isNativeAndroid` |
| O2 defer/self-loop | PASS | 一次业务保存只执行一轮；600ms 后无新增对账；在途改期/完成/删除最终撤销旧计划、建立最新计划并可重启读回 |
| O3 URL/属性 | **FAIL** | 危险协议和引号 ID 通过；3 个畸形 HTTP(S) 仍可点击 |
| O4 调用内索引 | PASS | 独立复跑 n=100/500/2000 对照；2000 空台账长数组 find 比较从 2,001,000 降为 0；重复 ID 首项语义由交付套件覆盖 |
| O5 独立快照 | PASS | 正常保存 parse=1/stringify=2；FIFO 两笔保存落盘 A→B；失败不预发布；memory 后端未保存活对象变更不会污染读回或误停旧投递 |
| O6 折叠与签名 | **FAIL** | 1000 项折叠 0 卡片、展开 1000、稳定刷新保留节点和焦点、收起回到 0 均通过；标签数组签名碰撞失败 |
| O7 启动渲染 | PASS | 首页卡片容器从 3 次写入降为 1；深链/分享由交付套件覆盖；跨分钟与跨午夜文案在真实浏览器及时更新 |
| 取消失败补偿 | PASS | 首次撤销失败保留旧 ID，下一次保存重试后清空 |
| Android 实机 | NOT_PERFORMED | SDK 中 adb 可用，但 `adb devices -l` 没有已连接/已授权设备 |

## 4. 两个修复要求

### F1. 使用无歧义的首页视图签名

`homeCardSignature` 不能用未转义分隔符把结构化数据压成字符串。至少把标签数组编码为带边界的结构，例如对字段数组做 `JSON.stringify`，或使用长度前缀编码；同时覆盖项目 id/name/color、标题、备注、URL 中可能出现分隔符的情况。

必须加入反例：

- `["work,home"]` 与 `["work", "home"]`；
- 字段包含当前 `SEP`/`ROW` 字符；
- 修改后不重载即可看到新内容，同时无变化刷新仍保持原 DOM 节点和焦点。

### F2. URL 解析失败必须直接拒绝

只要环境存在 `URL` 构造器，`new URL(trimmed)` 抛错就应返回 `null`；字形兜底只能用于 `typeof URL !== "function"` 的环境。补测畸形 host、percent encoding、IPv6、端口和正常绝对 URL，并在真实浏览器确认不会生成 `<a>`。

## 5. 交付材料和证据边界

- 独立证据目录：`docs/reviews/verification-runs/20260920-independent-code-optimization/`
- 关键文件：`identity-check.json`、`snapshot-manifest.json`、`npm-test.log`、`independent-probes.json`、`perf-rerun.json`、`browser-results.json`
- Chromium 浏览器只验证 Web 运行时 DOM 和交互；没有 APK/Android 生命周期、真实桥、系统调度或设备内存证据。
- 实机未连接，本轮不得把 Android 项写成 PASS。设备可用后应以返工后的新源码哈希构建隔离 APK，再补安装、应用内编辑/折叠和提醒回归；当前失败无需等待实机即可成立。

## 6. 文档纠正

实现报告中“test-regressions 的 `AttentionNativeReminders` 恒为 undefined”不成立。`test-regressions.js` 在沙箱中注入 `Object.assign({}, native, { isNativeAndroid: () => false })`；独立运行时探针确认 `reconcile` 和 `onAlarmAction` 都是函数。`readHarnessLoadSets` 只解析 `LIB_SOURCES`，没有解析这条替代注入，因此 A4 的“缺口恰好是 native”对 regressions 属于误报。生产组合 harness 本身仍有价值；应修正覆盖清单和报告措辞。

## 7. 复验入口

返工后用新 run-id，保留本次失败证据。优先复验 F1/F2，然后重跑 1801 套件、独立在途对账/持久化反例和真实浏览器矩阵。两个失败关闭且原有通过项无回归后，再进入 Android 实机补验。
