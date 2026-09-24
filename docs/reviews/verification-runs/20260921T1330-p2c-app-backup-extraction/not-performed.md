# NOT_PERFORMED 清单（run `20260921T1330-p2c-app-backup-extraction`）

以下事项**本轮未执行**，验收时不得因测试全绿而豁免成 PASS。

## A. 流程性

1. **本 run 是实施方自测，不是独立验收。** 是否通过由独立复验会话裁决；
   复验方请勿 `git checkout` / `git stash` —— 工作区脏改动即交付身份。
2. **未提交、未推送**（HEAD 仍为 `3574824` == origin/main，98 条脏条目）。

## B. 刻意保留、未修复的缺陷

3. **「导出没有落地出口」（待裁决 E1–E4，代码未动）**：Web 回退通路 `<a download>`
   在 Android 上没有接应者，点击后全机没有任何文件被创建；搬移**逐字保留**该行为。
   修复属产品决策，必须先过裁决 —— 不得把「行为保留」误读成「缺陷已修」。
4. **导入的格式安全面未扩大**：导入只校验 `data.items` 是数组、逐条过 `normalizeItem`；
   `notes` / `projects` / `settings` 的逐项形状校验与搬移前一致（未增强）。

## C. 本轮明确不覆盖的行为面

5. **真实浏览器/真机上的导入端到端**：`importDataFile` 依赖 `FileReader` + `confirmDialog`，
   Chrome 复检未覆盖导入链路；真机（Android WebView）导入未验证。
6. **原生 saveDocument 通路**：smoke 用假系统桥驱动；真机上的系统文件选择器行为未验证。
7. **导出在途闸门的真实时序**：8 秒宽限只在 smoke 的时间可控环境里验证过。

## D. 模块化计划内未做（P2 剩余 / P3 / P4）

8. P2 剩余：诊断、引导（onboarding）、内容视图、表单等段的迁出；逐功能拆 `bind()`。
9. P3：持久化、事务、事项及原生协调的搬移。
10. P4：生产组合收口、离线升级实测、打包链逐字节比对（APK 解包 cmp）、APK 构建、实机验收。
11. 沿用 P2-A run 的 NOT_PERFORMED：AI 真实网络端到端（假 fetch）、元素值类型与函数返回值
    契约、P1 冷进程投递黑洞（D70 待裁决）、V18/V19/V20 等 —— 均未解除。

## E. 复验建议入口

- 行为断言：`test-smoke.js` 原生保存/分享/下载/宽限闸门/密钥排除段（256 全过，原样通过）；
- 缺件/空壳/抛错反例：`test-boot-combination.js` ⑫、B3 ⑤·4/⑤·5、B4 N8；
- 双向闭合：`prod.backupInstanceCoverage(process.cwd())` 应为
  `missingInContract=[] unusedInContract=[]`；反向注入 `backup.<不存在的成员>` 必须报出；
- 浏览器层：`browser-recovery-check.py`（12 用例，含 shell-backup / missing-app-backup）。
