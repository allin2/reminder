# 提醒准时性改造交付记录（2026-10-28）

基于 `origin/fix/p1-sdk36` 创建 `feat/punctual-default`；未修改或推送 main / fix/p1-sdk36，无强推。

## 实现与文件

| 需求 | 实现 | 主要文件 |
|---|---|---|
| 默认准时 | 全局 punctualPriority 默认开；缺键跟随、事项布尔双向覆盖；有效策略进入排程身份；沿用原生 setAlarmClock 与 standard 分流，review 不升级 | lib/app-model.js、lib/native-reminders.js、lib/app-capture.js、lib/app-items.js、lib/app-events.js、lib/app-views.js、index.html |
| 迁移与备份 | normalize 保留缺键，重复归一化幂等；周期继承策略；备份可选全局布尔键，旧文件兼容、非法类型拒绝；编辑未触碰不固化覆盖 | lib/app-model.js、lib/app-items.js、lib/app-backup.js |
| 精确权限 | 首次保存真实时间无权限时一次设置引导；首页常驻轻提示可直达系统设置；恢复授权补齐普通通知持久化队列 | lib/app-setup.js、lib/app-notices.js、app-core.js、android/.../ExactAlarmPermissionReceiver.java |
| 延迟诊断 | AlarmTrace / DeliveryEvidence 按 token 关联，最近十次计划、实际送达、延迟秒数及调度模式；缺失字段显示未知；通知被阻止不算送达；无新增上传联网 | lib/app-diagnostics.js |

裁决 [D71–D73](../decisions/punctual-default-2026-10-28.md)，分配前实际最大为 D70。D71 修订 D60 对普通档借用时钟调度部件的限制（产品所有人本次拍板）；D64 不添加 USE_EXACT_ALARM 继续有效。产品逻辑及验收用例同步更新。

## 迁移限制

- 缺键 = 跟随全局，显式 false = 关闭，true = 开启；无需破坏性批量改写或一次性迁移标志，重复加载/导入幂等。
- **旧版本曾把未操作也存成 false，和用户明确关掉完全同形。不能从旧数据恢复这段历史意图。所有既存 false 保守保持关闭，仅仍缺键的旧事项自动跟随。** 这些旧事项可由用户在单事项勾选开启。此限制未隐藏，也未声称全部旧事项已默认开启。
- 新应用兼容旧备份；旧应用的严格白名单不保证接受新增设置字段。内容导出 v1 业务时间结构不变。

## 自动验证

- `TZ=Asia/Shanghai npm test`：16/16 套件通过。
- `TZ=UTC npm test`：16/16 套件通过。
- 两时区各主套件计数：unit 760、native 469、boot 942、smoke 304、regressions 743、单一来源检查 160；新增准时专项 9/9（另有原有模块行为/变异套件，未混算进上述断言总数）。
- 新增真实落盘/重启/编辑回归 7 条；新增首次权限引导、只提示一次及表单默认行为断言；新增专项覆盖迁移幂等、旧备份兼容、全局/事项覆盖、review、证据关联与被阻止通知。
- `npm audit --json`：总漏洞 0，high 0 / critical 0。
- `npm run cap:sync` 后，`cd android && JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew assembleDebug testDebugUnitTest --no-daemon`：BUILD SUCCESSFUL；9 个 JVM 测试类、63 条测试、0 failures / errors；其中 NotificationSchedulerTest 23 条，新增权限恢复链路测试 1 条。
- `aapt2 dump permissions` 读取实际 debug APK：有 SCHEDULE_EXACT_ALARM，无 USE_EXACT_ALARM。
- APK：`android/app/build/outputs/apk/debug/app-debug.apk`；SHA-256 `f4d18e48a18bc03ffd3ac83c7ee915d2bc32b324dc074a6888ddfd5d6ca8f4f1`。
- `git diff --check` 通过。

过程失败如实记录：初轮因旧默认摘要、首页边界预期失败，改为定向验证后修复；接收器源码守护断言随提取方法加强为双队列恢复检查；两时区并发测试争用历史固定 /tmp 文件，改为串行复验。新增重启回归首次误用 harness 属性，定向修正；随后 UTC 暴露同刻通知内部 ID 排序不等于输入顺序，改为按事项身份逐项校验，双时区定向验证通过。未通过时未推送。

## OPPO 真机验收（本轮未执行）

1. 安装 debug APK；开启通知及「闹钟和提醒」。新建两分钟后的普通事项，保持默认准时；确认系统下一个提醒时间出现。息屏后台等候，核对诊断 alarmClockNotification 的计划、送达及延迟秒数，确认无闹钟全屏长鸣。
2. 关闭全局准时优先，建另一事项，确认 exactNotification；单事项开启准时后确认回到 alarmClockNotification。全局开、单事项关时仍 exactNotification。核对每轮只送达一次。
3. 无精确权限首次保存有真实时间事项，确认仅一次引导；再次保存不反复弹窗。首页「提醒可能晚到」可进入系统设置。无权限诊断为 inexactNotification。
4. 保留未来普通事项和闹钟事项，授予精确权限，返回应用并核对提示消失、两队列自动重排；再次撤销，返回首页确认提示恢复与降级。补测授予后不手动编辑事项也能准时投递。
5. 触发整理窗口，确认始终 standard，无系统下一个闹钟占位。导入旧备份，分别验证缺键项随全局、显式 false 保留，重启仍一致。

## 残留风险

OPPO 冻结、息屏、电池策略的真实延迟尚待设备验证；setAlarmClock 不能承诺 OEM 绝对准时。通知提交 / 接收器触发证据不代表屏幕实际显示或用户已看到。轨迹有容量上限，计划模式被淘汰后显示未知；不凭当前权限猜测历史模式。撤销权限无对应系统广播，依赖回前台复读/对账，无法在进程被终止时即时展示首页提示。旧 false 的历史意图不可恢复，见上文迁移限制。
