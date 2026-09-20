# Grilling 后续修复与实机验收

- run-id：`20260920T154419Z-grilling-main-device`
- 基线提交：`c709d6186a3ed228eb17cfbdef2316d9069db494`
- 目标包：`space.alliswell.inbox`，`versionName 1.1`，`versionCode 2`
- 设备：OPPO PKC130 / Android 16（API 36）/ ColorOS `PKC130_16.0.10.500(CN01)`
- 结论：本次修复在源码、完整 JS 测试、Android 生产构建和连接实机上通过；自动设备检查保留 2 项环境警告，不提升为无条件的锁屏送达保证。

## 本次改变

1. 编辑既有事项时，只改标题、备注或标签不会重算或丢失原提醒时间；显式改期和显式清空仍分别生效，稍后事项保留 elapsed 调度元数据。
2. 增加初学者/正常模式。正常模式减少解释文字，但首页可靠性设置入口仍可见；模式可持久化并随备份恢复。
3. 后台、自启动、悬浮窗等设置入口改为“已访问”和“系统已验证”两套状态，打开设置不再被当作能力已经生效。
4. 60 秒测试把“已有结果”和“验证通过”分开；只有明确听到或看到才通过，没收到、不确定、停止测试都不会被标成成功。
5. 后台与全屏文案改为条件性说明，明确实际效果取决于系统和本机测试。
6. 应用版本更新为 `1.1 (2)`，重建并校验可分发生产 APK 与仓库内 debug APK。

## 自动验证

最终 `npm test`：`1814 passed / 0 failed`。

| 套件 | 通过 | 失败 |
| --- | ---: | ---: |
| unit | 337 | 0 |
| native reminders | 321 | 0 |
| boot combination | 170 | 0 |
| smoke | 256 | 0 |
| regressions | 730 | 0 |

完整测试包含编辑时间保留、显式改期/清空、稍后元数据跨重载、双模式、设置访问不冒充验证、60 秒测试反馈语义以及生产脚本组合反例。

## 实机验证

- USB/ADB 连续在线，无链路掉线。
- 设备自动检查：`PASS 24 / FAIL 0 / WARN 2 / SKIP 0`。通知排程/撤销、存储写入/恢复、WebView ready、业务逻辑、包管理和通道往返均通过。
- WebView 专项反例：正常模式切换后可靠性入口仍可见；后台/悬浮窗入口仅记为访问；没收到不算通过；仅改标题时 `triggerAt` 和 `localTrigger` 在重载前后保持；临时事项已删除，事项数量与 ID 集合恢复。
- 生产 APK 重新安装后冷启动成功，未带 `DEBUGGABLE` 标记；安装前后的用户数据未清空。
- 实机已安装 APK SHA-256 与冻结生产候选一致：`13631aa57dab731a8b2f250571f6c332e3031ec2d0e30bcb27bc9f6857fb8593`。
- 生产 APK 内嵌的 `app-core.js`、`index.html`、`lib/feedback.js` 与当前工作区逐字节哈希一致。

## 环境警告与证据边界

1. `dumpsys package` 未把部分特殊权限作为普通 grant 行列出；`appops` 实测 `SCHEDULE_EXACT_ALARM` 与 `SYSTEM_ALERT_WINDOW` 均为 `allow`。
2. 本次自动检查发现 3 个预期通知渠道中已有 2 个；未被本轮触发的渠道尚未创建。
3. 本轮验证了真实设备上的排程往返、运行时、存储和本次 UI/编辑反例；没有把这些证据写成“所有厂商、所有锁屏条件下必达”的结论。

## 产物身份

- 生产候选（本地保留，不纳入 Git）：`releases/candidates/20260920T154419Z-grilling-main-device/attention-inbox-release.apk`
- 生产候选 SHA-256：`13631aa57dab731a8b2f250571f6c332e3031ec2d0e30bcb27bc9f6857fb8593`
- 生产签名证书 SHA-256：`bbdaeece7fa34052a529e3fc3aaab2a4f6d688b7e60845750f10cd4e17469f0b`
- 仓库内 debug APK SHA-256：`378ee91e7f6c0e222b30ac51170bd5c6db08ddb3f6161319e81c8a94d7dea407`
- 原始实机证据保留在本地 `docs/reviews/verification-runs/20260920T154419Z-grilling-main-device/`，其中含设备诊断与用户界面截图，未纳入远端提交。

## 清理记录

用户确认删除的旧 `.stale-20260916` APK 已按字面量路径移入废纸篓，可恢复；源码、候选、历史证据和其他未跟踪文件未删除。
