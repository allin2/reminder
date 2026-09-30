# OPPO 覆盖安装与锁屏功能验证

> 本文保留第一阶段截至用户解锁前的结果。用户解锁后，通知列表可见性、取消与关闭按钮、用户声振确认、APP 进程重启和最终数据核对已补测，见 [解锁后补验](oppo-lockscreen-guide-completion-2026-09-30.md)。以下未完成项是第一阶段的历史状态。

## 结论

修复包已覆盖安装到 OPPO PKC130。真实 UI 设置入口与四条设置跳转正常；第一轮 60 秒测试在后台熄屏且锁定状态下自动亮屏并显示闹钟界面，延迟 574 ms。系统播放与振动均有运行证据。18 条既有事项全量数据保持一致。

不能将这轮记录视为完整功能验收：通知创建已确认，通知栏实际可见性尚未确认；原有声振诊断字段有误报；锁屏后的 WebView 异步回执在补测中超时；用户实际声振体验、完整停止按钮交互、重启后的 UI 状态、长待机与冷进程测试尚未完成。已请求用户解锁手机以完成后续 UI 检查，未收到回复。

## 环境与安装身份

- 用户授权：在 OPPO 重新安装修复包并验证功能。
- 设备：OPPO PKC130，Android 16 / API 36，`ro.build.version.oplusrom=V16.1.0`；序列号 `QSKFAE95CQEUJZ8L`。
- 工作分支 `docs/setup-60s-test-verification`，基线 HEAD `e603edceda8fcae450e2e59294ff25d6fe2e9ccb`；本轮未修改产品源码，未提交、未推送，既有修改和 `.claude/` 保留。
- 原调试包 SHA-256：`75401916ed82f46948ab643a0a012e537f189735e333fd9ef9f673860f76dd46`。原包覆盖被系统拒绝，原因 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，其签名与已安装应用不同。
- 本机既有发布密钥的公开证书指纹与 OPPO 已安装应用一致：`bbdaeece7fa34052a529e3fc3aaab2a4f6d688b7e60845750f10cd4e17469f0b`。使用该既有密钥为同一个 APK 重新签名，490 个非签名 ZIP 内容条目哈希全部一致；未卸载、未清数据。
- 实际安装包：`/Users/qlyf/Developer/reminder/releases/安心收件箱-lockscreen-guide-v51-oppo-debug.apk`，仍为可调试包。
- 实际安装与本地产物 SHA-256 均为 `bb2aaa05d514ae4f2700ad21ac523b8835d4bd0c86984ba7d4b55c879ea196e6`。签名验证通过，覆盖安装返回 `Success`，启动 ready=true。
- 安装前已保存旧 APK、应用私有数据 TAR、状态快照；本轮不包含卸载、清数据或修改手机权限/安全设置。

## 验证结果

| 检查 | 结果 | 当前候选证据 |
| --- | --- | --- |
| 覆盖安装与冷启动 | PASS | 安装与设备 APK 哈希相同，应用就绪，18 条事项保留 |
| 新版向导可达、说明和滚动 | PASS | 实际点击「我的 → 提醒设置」；说明包含三个厂商开关，按钮可滚动到达，无横向溢出 |
| 四条系统设置路由 | PASS | 应用详情、通知管理、悬浮窗列表、发送全屏通知实际 Activity 和截图；OPPO 悬浮窗入口进入系统应用列表，需要用户选择应用 |
| 厂商开关现状 | READ_ONLY_CONFIRMED | 通知管理显示锁屏与横幅均开启；全屏通知开启；通用通知、精确闹钟、悬浮窗与忽略电池优化均允许；未修改开关 |
| 手动确认与重新检查 | PASS | 实际按钮切换，状态显示「已手动检查 · 系统无法回读」，不套用系统已验证样式；最终保留已检查状态 |
| 第一轮锁屏自动显示 | PASS | 按开始按钮，回桌面并熄屏；Dozing、deviceLocked=1；自动亮屏至 Awake，前台 AlarmActivity，实际截图显示测试标题和四个按钮 |
| 第一轮声音与振动机制 | PASS | ringStarted：foreground/sound/vibrate=true；MediaPlayer 为 USAGE_ALARM、started、unmuted，扬声器闹钟音量 10；振动 running、当前 UID 属于本应用 |
| 人耳/触感体验 | NOT_CONFIRMED | 已向用户询问，尚无回复；不能用日志替代用户实际感受 |
| 测试结果身份与准确性 | PASS | trace 匹配，shownAt 为实际展示时间；DOM 显示本次展示已验证并明确不代表长待机可靠性；没有 `[object Object]` |
| 通知创建 | PASS | id=90003、importance=4、alarm channel、全屏 PendingIntent；notificationPosted=true |
| 通知栏实际可见性 | NOT_CONFIRMED | 第一次下拉未展开通知中心；第二次观察时手机已锁定/熄屏，截图无有效通知内容，不能当作可见或不可见的产品结论 |
| 第一轮停止 | PASS | 实际 Back 对应 native userAction=close，deliveryStopped=true；没有确认或完成业务事项 |
| 关闭按钮完整 UI 交互 | NOT_PERFORMED | 第二次补测未取得按钮可操作画面，最终使用绑定准确 id/token 的原生停止接口完成停止；不冒充按钮验证 |
| 测试清场 | PASS | 两次测试已停止；最终无 AlarmRingService、id=90003 通知或测试待触发排程 |
| 事项保护 | PASS | 安装前后及最终 18 条事项 full JSON 完全一致；规范化 SHA-256 均为 `2d6007009a0004ad72ca391b15cf0a280450b6719f5a974b7aaff1d8ff4f59e7` |
| WebView 重载后的保存状态 | PASS | 重载页面清除补测等待中的 JS 回调后，ready=true；18 条事项、手动检查标记和第二轮 trace 均保留；这是运行时/保存状态检查，手机锁定时未观察 UI |
| 重启后 UI 状态、长待机、冷进程 | NOT_PERFORMED | 不用短测试或开发机证据替代 |

## 第一轮时间线

测试身份：`90003:3313bf11-3a46-4944-89d3-cd2877c4f97c`，日期 2026-09-30（北京时间）。

- 开始：00:07:33.140；计划：00:08:33.152。
- 广播投递：00:08:33.331，比计划晚 179 ms。
- 窗口显示：00:08:33.726，比计划晚 574 ms。
- 停止：00:09:56 左右；native close / deliveryStopped，活跃投递清空。

## 两项发现与补测限制

1. **声振诊断字段不准确。** 第一轮 `ringStarted`、系统音频及振动均显示运行，但同次 `carrierSound=none`、`carrierVibrate=none`、`carrierForegroundService=false`。源码 `AlarmActivity.java:362` 在服务正在响时停止本地回落，并调用 `recordFallbackCarrier("none")` 覆盖载体记录。此为当前候选的已观察问题，本轮只记录，未修改候选源码或包。声音与振动功能证据独立于该字段。
2. **锁定后异步回执超时。** 第二次通过部署中的 `startSetupTestRun` 发起测试，WebView 回执超时，但原生 trace/AlarmManager 确认排程成功，trace 为 `90003:5c80b611-4c7b-40dd-8f7b-0d0766ae78d4`，计划 00:15:34.447，原生窗口记录 +203 ms 可见。观察脚本恢复已晚于触发时间，并主动回桌面/熄屏，因此它的黑屏截图不可归因于产品展示失败。未重排第三次测试。精确 token 的 `SystemBridge.stopAlarmDelivery` 已停止该投递，停止台账与系统快照均确认；原排程不再挂起。此次补测不能升级通知可见性、按钮交互或长待机结论。

补测清场后尝试普通 `am kill`，进程 PID 未变化，未当作冷启动通过。随后正常重载 WebView，终止等待中的测试 JS 回调并核对保存状态；未使用 `force-stop`，没有删除用户数据或取消业务闹钟。重载后仍无测试响铃服务和测试通知。

## 证据位置

原始日志、截图、旧 APK、私有备份与结果 JSON 均保留在本机，不入库：

`/Users/qlyf/Developer/reminder-archive/verification-runs/20260929T235853-oppo-lockscreen-guide/`

关键文件：`RESULTS.json`、`package-identity.json`、`signature-verification.txt`、`installed-apk-sha256.txt`、`app-before-install.json`、`final-app-state.json`、`test-run.json`、`locked-before-*`、`triggered.png`、`triggered-*`、`trace-current-test.json`、`final-stopped-*`。失败脚本及原始输出保留，没有覆盖成成功记录。
