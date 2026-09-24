# NOT_PERFORMED 清单（run `20260921T0900-p2a-app-ai-extraction`）

以下事项**本轮未执行**，验收时不得因测试全绿而豁免成 PASS。

## A. 流程性

1. **本 run 是实施方自测，不是独立验收。** 所有「全绿」结论仅代表实施方证据；
   是否通过由独立复验会话裁决。复验方请勿 `git checkout` / `git stash` —— 工作区脏改动即交付身份。
2. **未提交、未推送**（HEAD 仍为 `3574824` == origin/main，95 条脏条目）。

## B. 模块化计划内未做（P2 剩余 / P3 / P4）

3. P2 剩余：备份、诊断、引导（onboarding）、内容视图、表单等段的迁出；逐功能拆 `bind()`。
4. P3：持久化、事务、事项及原生协调的搬移。
5. P4：生产组合收口、离线升级实测、打包链逐字节比对（从 APK 解出 `assets/public/` 逐字节 cmp）。
6. APK 构建、真机（Android）验收：未做。AI 模块在 Android WebView 内的装配行为未实测。
7. `app-core.js` 仍约 4,000 行 —— 行数不是进展指标，判据是「谁持有行为」；本轮只迁出 AI 一支。

## C. 本轮明确不覆盖的行为面

8. **AI 真实网络请求端到端**：unit/regression 用的是注入的假 fetch；真实 BYOK 端点、
   迟到响应在真机上的表现未验证。
9. **元素值类型校验**：数组契约核对到「元素字段存在」，未核对元素字段的**值类型**
   （如 `value` 必须是 string）；函数返回值契约同样未做。
10. 既有 NOT_PERFORMED（沿用第五次复验清单，均未解除）：
    - P1 冷进程投递黑洞（ColorOS 自启动引导，D70 待裁决，代码未动）；
    - 导出没有落地出口（提示与事实相反，待裁决 E1–E4，代码未动）；
    - D69 对账全量重排（双通路绕过去抖）；
    - `projects` 与 D-09 冲突；`USE_FULL_SCREEN_INTENT` 文案未审；
    - `test-native-reminders.js` 的 Java 源码正则未处理；
    - V18/V19/V20（60 秒测试等）NOT_PERFORMED ⇒ 冷进程修复格不得 PASS。

## D. 复验建议入口

- 行为断言：`test-unit.js` P2-A 段（+54）；缺件/空壳/抛错反例：`test-boot-combination.js`
  B3 ⑤·2/⑤·3、⑪、B4 N6/N7；浏览器层：`browser-recovery-check.py`（10 用例，含 shell-ai / missing-app-ai）。
- 双向闭合：`node -e "require('./scripts/verification/production-scripts.js').aiInstanceCoverage(process.cwd())"`
  应为 `missingInContract=[] unusedInContract=[]`；`runtimeDependencyCoverage().problems` 应为空。
