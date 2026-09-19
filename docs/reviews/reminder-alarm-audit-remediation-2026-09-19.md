# 提醒与闹钟审查结论复核及整改

> 后续更新：用户已授权按 Grilling 推荐定案；N4 生产代码与测试已修复。下文保留上一轮时点；最新结果见 [硬窗口修复与实机交付](./reminder-window-implementation-2026-09-19.md)。

- 日期：2026-09-19；基线：main / 8d1c2617cff3aac5c4450a949c9044b79f63a673，加既有未提交工作区。
- 授权：用户要求检查审查结论并修复相关问题。保留他人修改；本轮仅修改测试与文档，未改生产 JS/Java，未提交/推送。
- 结论：**部分整改完成，不是提醒/闹钟全流程验收通过**。报告失真、文档漂移和可确定的断言缺口已处理；窗口策略尚需产品确认。

## 逐项判定

| 项目 | 复核结果与处理 |
|---|---|
| N1 | 成立。31 处 readSrc（含定义），其中 11 处直接读 Java。撤回“全部移除”宣称；保留静态接线守卫，不把静态/JS 仿真计为 Java 运行证明。 |
| N2 | 成立。交付报告改为真实 8 方法清单；Gradle 强制重跑，8 项通过。 |
| N3 | 成立。全屏规格、投递方式、产品逻辑统一为“代码已接线，目标设备完整验收未完成”；修正重要档与普通显式 alarm 的范围及到期前预排链路。 |
| N4 | 成立。60×2 的第三槽是 23:30，不是 23:00。纠正算术理由；原生关闭勿扰可排窗口外、应用内不可的差异仍存在。未擅改提醒策略。 |
| N5 C13/D10 | 审查误判。smoke 已直接调用 homeNoticeVerdict/promoteDue，native 已覆盖 NEEDS_REVIEW 不阻断真时间；补验收登记。 |
| N5 D11 | 新增真实 buildReviewDesired 测试：6 条事项每槽一条 Review 通知；增加事项数不增加槽位。 |
| N5 D13 | 新增真实 reviewConfirm + 模拟持久层测试：每处理一条立即核对落库，不追加 saveAsync 掩盖自动保存缺失；处理四条后重建 app，只剩六条待整理。 |
| N5 C15 | 不仅缺断言。新增双事项同刻独立 ID/排程测试；串行全屏展示未实现。最新四阶段交接第 59 行明确保持单声源替换、不引入队列，因此不能擅自实现旧规格承诺，验收保留部分覆盖。 |
| N6 | 不成立。smoke 已逐值断言 60min 和 maxFollowups=2，native 也有次数断言。真正不足是跨通路窗口一致性；D9 降为部分覆盖。 |
| N7 | schema5/G01 仍未实现；是跨状态建模的已登记范围，不在本轮报告/验收纠正中偷偷迁移。 |
| N8 | “未实现/仍全量重排”过时。当前已有串行合并、内部保存隔离、签名差量与有界日志。更新 D69 历史请求状态；原 1Hz 来源和当前设备长期表现未完整复验。 |
| N9 | 未提交工作区是交付约束与待整合状态，不是功能故障；保留不清理。 |

## 测试（本轮现测）

Run ID：`20260919T103321Z-audit-remediation`，环境：本机 macOS / Node / Temurin JDK 17；未操作 vivo。

| 执行 | 结果 | 证据等级 |
|---|---|---|
| npm test | unit 249 / native 294 / smoke 219 / regress 580，全部 0 失败；合计 1342 | 本地 JS 行为、mock 契约、静态与仿真混合套件；不得整体称原生行为通过 |
| node test-native-reminders.js（最终同刻时间固定后重跑） | 294 / 0 | 本地测试 |
| JAVA_HOME=Temurin17 ./gradlew :app:testDebugUnitTest --rerun-tasks | BUILD SUCCESSFUL，66 tasks executed；生产测试 8 / 0，另 1 项模板示例 | JVM 逻辑级、包含生产组件调用；非 Android 系统生命周期 |
| git diff --check | 无空白错误 | 差异格式检查，不是语法或业务证明 |

归档：[npm-test.log](./verification-runs/20260919T103321Z-audit-remediation/npm-test.log)、[native-final.log](./verification-runs/20260919T103321Z-audit-remediation/native-final.log)、[gradle.log](./verification-runs/20260919T103321Z-audit-remediation/gradle.log)、[生产 Java JUnit XML](./verification-runs/20260919T103321Z-audit-remediation/ProductionJavaAlarmTest.xml)。

## 真机与未完成项

- **INHERITED_EVIDENCE**：旧候选 `7bcb566355989fa9b73b6f776567c4b0d1c48ab243404347f71326c85db80851` 的 [cold metadata](./verification-runs/20260919-vivo-candidate/cold/metadata.json)、[due-screen.png](./verification-runs/20260919-vivo-candidate/cold/due-screen.png) 及同投递 windowVisible=true。只能证明该场景，不能概括 H-08 全通过，也不能说屏幕从未成功拉起；other/off 未获同等可见证据。
- `186c28b9...` 构建/安装为既有报告证据，本轮未重建/覆盖 APK、未安装、未重复实机投递，不将本轮测试与旧 APK 错绑。
- **NOT_PERFORMED**：本轮真机端到端、整机冷重启首解锁前、物理调时/调时区、权限改动；完整并发服务停止/迟到 Intent 与恢复故障注入。
- **待确认 N4**：建议窗口上界为硬边界，3 次仅上限，默认 21:30/22:30，用户主动“稍后”可越窗。已向用户提问，答复前维持原实现；还需覆盖更长窗口的首发/补发预算、跨午夜、勿扰顺延与稍后例外。
- **C15**：若仍要求逐个全屏展示，需要显式改变当前“替换、不新增队列”的交接边界，另行实现验收，不能只补文档标绿。

本报告优先于旧审查的 N6/N8/H-08 概括性结论；完整生命周期可靠性仍不能由这组局部绿灯推出。
