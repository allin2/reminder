# 锁屏显示设置引导修复

## 结论与范围

针对 vivo V2238A 锁屏时只有声音、振动而无界面或通知的反馈，补齐应用内的厂商设置引导，并修正设置状态与 60 秒测试的成功判定。相关入口为「我的 → 提醒设置」。厂商开关不能由应用自动开启或可靠回读。

工作分支：`docs/setup-60s-test-verification`，基线 HEAD：`e603edceda8fcae450e2e59294ff25d6fe2e9ccb`。本次未提交、未推送。已有 `.claude/` 文件保持不变。

## 变更

- 新增必需检查项「检查锁屏显示与通知」，持续展示 vivo 路径：应用信息 → 查看所有权限 → 锁屏显示；应用通知设置 → 锁屏通知、悬浮通知。提供应用权限与通知设置两个入口，另保留悬浮窗、全屏通知入口。
- 区分系统确认、打开过设置、用户手动检查。用户确认仅记录「已手动检查 · 系统无法回读」，不会显示为权限已验证。通用权限全开及旧 `setupDone` 均不会掩盖新增检查。
- 60 秒测试保存原生返回的 trace，原生最新投递接口补充返回已有 trace。投递必须匹配本次 trace、完整测试标题和运行时间；旧测试及业务提醒不计入本次。
- 展示成功必须有本次可见窗口及实际展示时间，并且投递时锁屏或熄屏，在计划时间后 5 秒内显示。只有声振、已提交通知、历史 `seenAt`、用户选择「听到了 / 看到了」和迟到展示均不自动判为锁屏展示成功。
- 证据显示使用判读结果的 text，修复 `[object Object]`。异步读回期间启动新测试时，旧结果不能写入新运行。短测试不会清除后台能力未确认提示。
- SW 缓存从 v50 升至 v51，确保更新后的网页代码被加载。

## 验证

| 验证层级 | 结果 | 范围 |
| --- | --- | --- |
| JavaScript 项目必需检查 | PASS | `npm test` 全链退出 0；单元 703 项、回归 730 项全部通过 |
| 向导变异检查 | PASS | 5 项健康对照通过、变异全部变红；源码哈希保持不变 |
| 生产页浏览器交互 | PASS | Chrome 360 × 800；真实 DOM 设置按钮四条路由、手动检查与撤销、说明持续可见、状态准确、无横向溢出、停止按钮可滚动到达；原生桥为模拟 |
| Android JVM 与构建 | PASS | `testDebugUnitTest assembleDebug`；26 项 JVM 测试无失败，APK 生成成功 |
| 新 APK 覆盖安装 | BLOCKED | vivo 返回 `INSTALL_FAILED_ABORTED: User rejected permissions`；未绕过手机安装确认 |
| 新 APK vivo 设置跳转与锁屏测试 | NOT_PERFORMED | 依赖覆盖安装；手机仍保留旧 APK |

之前启用相关系统开关后的真实锁屏展示证据，属于旧 APK：`/Users/qlyf/Developer/reminder-archive/verification-runs/20260929T232549-lockscreen-display-repair/REPORT.md`。不能替代本次新 APK 的真机结果。独立通知栏可见性、长时间待机和其他厂商仍未验证。

## 产物与证据

- 新 APK：`/Users/qlyf/Developer/reminder/releases/安心收件箱-lockscreen-guide-v51-debug.apk`
- SHA-256：`75401916ed82f46948ab643a0a012e537f189735e333fd9ef9f673860f76dd46`
- 本轮原始日志、浏览器结果与截图：`/Users/qlyf/Developer/reminder-archive/verification-runs/20260929T234940-lockscreen-guide-repair/`
- 安装前保存了应用状态快照：12 条事项；既有安装包已备份为上述证据目录下的 `previous-installed.apk`，SHA-256 为 `efea673d1c48b1853baf37f73ca3103a02e287cfd7d684b3c6686ea1092d08dd`。
- 既有 `releases/安心收件箱-debug.apk` 未覆盖，历史候选与证据保留。
