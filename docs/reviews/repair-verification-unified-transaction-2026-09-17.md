# 统一事务修复与验证报告（2026-09-17）

## 结论

T1 的直接复现与独立复核发现的 U2“完成提交期间接受稍后却静默丢失”均已关闭。统一模型现在是“隔离草稿 + 同事务域显式拒绝 + 无关命令重放”。当前自动化 **854/854** 通过：unit 29、native 105、smoke 161、regressions 559。没有提交、推送、覆盖源目录或访问用户数据库。

## 基线与交付边界

- Git 基线：`7972af7c516bb72040c82d62984384d59a1caae0`。
- 修复输入：`/Users/qlyf/Developer/reminder` 当时的 13 个 tracked 修改、`test-regressions.js`、`docs/decisions` 与 `docs/reviews`；导入前后逐文件 SHA-256 一致。
- 实施工作树：`/Users/qlyf/.codex/worktrees/5158/reminder`（detached HEAD，仅用于本次统一事务修复与验证）。
- 源目录未写入；`.workbuddy` 未复制；未 commit/push；工作树未自动清理。

## 修复结果

| 要求 | 实现与证据 | 状态 |
|---|---|---|
| 权威提交与可见状态分离 | `app-core.js` 的 `withDraftState`、`applyAlarmAction`、`publishActionDraft` | implemented |
| T1 依赖对象生命周期 | N 在 ACK 权威提交前不可见；提交后带 `repeatParentId`，可稍后并重载 | implemented |
| 稳定派生身份、无双实例 | `spawnNextInstance` 以 `repeatParentId` 幂等；重放注入原 id | implemented |
| 后续命令不丢 | 窗口期命令自足化记录，成功后按序重放；异常 fail-closed | implemented |
| U2 业务前置条件冲突 | 同事项/同周期未决时返回 `false`，保留输入与 UI；不显示成功，落定后可重试 | implemented |
| 重放业务拒绝 | reducer 返回 `false` 与抛错同样视为事务错误，不再静默继续 | implemented |
| 原生确认不早于提交 | 全屏队列沿用成功后 ACK；通知栏成功后才移除已送达通知 | implemented |
| 存储权威 | IDB 成功决定事务，localStorage 镜像失败不否定成功；fallback 回归保留 | implemented |
| 失败反馈 | 普通保存 Promise 失败保留内存并显示明确提示 | implemented |

## 验证

- `npm test`：29 + 105 + 161 + 559 = **854/854**。
- `test-regressions.js` 包含 T1 成功/失败直接场景，以及 **36 组**“原生 ACK/snooze/done × UI ACK/完成/稍后/编辑/删除/停止周期 × 原生成败”矩阵；逐组检查命令返回值、拒绝反馈、输入保留、内存、权威快照、同盘重载、事件台账和周期唯一性。
- 另有同周期阻塞、三个连续相关命令、无关事项继续执行并跨重启持久化，以及失败落定后重试的覆盖。
- `test-native-reminders.js` 新增“Promise 未完成/失败不得移除已送达通知”。
- mock 的 IDB 在 `put` 时结构化克隆、FIFO 完成并可逐笔失败；重启复用同一模拟磁盘。
- `node --check app-core.js lib/native-reminders.js`：通过。
- `git diff --check`：通过。

## 自审：从“原生成功但用户前置条件已变化”反推

- 原生 `done` 提交未决时，UI `snooze`、编辑、删除等不会再基于仍可见的 `due` 状态先报成功；统一在 reducer 前返回 `false`。
- 拒绝路径不调用 reducer、不排保存、不推进版本；编辑与稍后面板保留输入，详情/弹条不因失败返回而关闭。
- 原生成功后只发布其权威草稿；原生失败后仍是原确认状态。两种结果落定后，用户都可重新发起命令并按当时真实状态获得成功或正常业务拒绝。
- 不相关事项继续执行并记录；重放时若业务 reducer 意外返回 `false`，事务 fail-closed 并尝试以当前可见状态补偿权威快照，不再把 no-op 当成功。
- `seriesId` 与 `repeatParentId` 被纳入冲突域，避免用户从另一周期实例入口执行“停止重复”绕过同周期串行化。

## 未验证边界

Android Gradle `testDebugUnitTest lintDebug` 已尝试，但 Gradle 8.2.1 在配置阶段因 Java 24 报 `Unsupported class file major version 68`，测试与 Lint 均未开始，记为 **BLOCKED / NOT_PERFORMED**。项目存在未设执行位的 `android/gradlew`（本次用 `sh ./gradlew` 调用），但当前 shell 未发现 JDK 17、`adb` 或 `sdkmanager`。APK 安装、锁屏、Doze、进程杀死、开机恢复和真实通知交互均 **NOT_PERFORMED**；JS/mock 结果不构成安卓实机 PASS。

## 安全落回源目录

先在源目录确认当前改动仍与本报告基线一致，再仅应用本工作树相对源目录的增量：`app-core.js`、`lib/native-reminders.js`、`test-native-reminders.js`、`test-regressions.js`、`README.md` 与本报告/决策文件。应用后重新运行 `npm test` 与 `git diff --check`。不要用整目录覆盖，也不要带入 `.workbuddy`。
