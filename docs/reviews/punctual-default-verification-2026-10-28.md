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

## Gemini 复审逐条处置

1. **已修**：`app-native-coordinator.js` 的 onResume、延迟补读及主动补读共用权限变化判定，排入强制重建；并发对账保留 force 标志到下一轮。`native-reminders.js` 既有 force 路径调用 `pendingNotifications({restore:true})`，清除 alarmSignaturesCache / alarmExactnessCache 并重排双队列。冷启动原本已有无条件 force，本轮补回归验证旧 mode 降级。撤销会停止进程的系统行为已核对 Android 官方文档（见裁决补充），没有声称应用能在被停止时即时补排。
2. **已修**：Manifest 删除 NotificationScheduler 的精确权限广播注册，仅保留 ExactAlarmPermissionReceiver；专项断言全 Manifest 恰好一个 action，且归统一 Receiver。
3. **已修**：详情复用 `usesPunctualNotification`；兜底（包括显式 true）、待整理/review、首次重要/关键/显式 alarm 都不显示普通准时保障已开启。排程普通载体使用相同函数，重要/关键后续普通通知保留准时能力。
4. **已修**：取消再勾回全局默认值恢复 undefined，保存继续跟随全局；新增真实 change 事件测试。编辑未触碰旧覆盖不变。
5. **不删，有可达证据**：v68 普通通知曾默认 clock、scheduleKey 无 punctual 后缀，因此旧 clock 记录与当前 standard 可以同 key。`test-native-reminders.js` 既有 `v69 same-key v68 unmarked future clock reconfigures without cancel-first` 及 `rejected same-key mode conversion preserves accepted old queue` 直接覆盖成功及失败保留路径。新策略变更换 key 不代表历史载体不可达；源码补充兼容注释。
6. **已修**：unknown 状态保留本会话待弹窗请求，状态确认后通过 renderSetupEntry 补弹一次；新增 unknown → denied → 重复重绘测试。持久化设置入口仍保留；若 unknown 阶段进程终止，自动弹窗请求不跨进程恢复，用户仍能从首页入口进入。

### 本轮新增回归及最终复验

- unit 增加 4 条：取消勾选覆盖、勾回恢复跟随、unknown 不提前弹窗、denied 回读只补弹一次。
- native 增加 3 条：App.appStateChange → onResume → 实际 JS reconcile → bridge restore 请求及 mode 降级；已有闹钟签名缓存失效后重排；冷启动持久化旧 mode 降级。桥及 AlarmManager 为 mock，不冒充真机生命周期或系统撤销验收。
- coordinator 增加生命周期行为场景：冷启动 force、granted → denied 强制重建、重复 denied 不重复 force；新增对账先回读到 denied 时保留强制后续轮次的并发测试；原有行为/变异检查全部通过。
- 准时专项增加 2 条（11/11）：Manifest 单入口与详情共用策略（含六类反例）。
- 最终双时区 `npm test` 均为 16/16 套件；每时区主计数：unit 764、native 472、boot 942、smoke 304、regressions 743、准时专项 11；模块行为/变异与单一来源检查均通过，不混算成一个测试总数。
- `npm audit --json`：0 漏洞；`npm run cap:sync` 完成；Java 21 下 `assembleDebug testDebugUnitTest --no-daemon`：BUILD SUCCESSFUL，9 类 63 条 JVM 测试，0 failures / errors。
- 本轮 APK SHA-256：`4edb82f80f50beed89ffa9e0cae34b36bed206d30290eb2e39d3bf73ebceae21`（上方原轮次 SHA 为修复前产物）。
- 本轮未新增 Java 测试；原有 NotificationScheduler 撤销/恢复单测验证原生安装降级能力，新增 JS 生命周期测试验证生产接线，两者职责分开。
- 过程失败：首轮全套 15/16，提取共用判定误限制重要事项后续普通通知，定位并恢复普通载体策略，定向通过后全量复验。将测试升级为 App 前台事件时，一次把最后一次 pending 读取误当 restore 读取（后续还有 restore:false 的确认读取），改为只检查本次前台事件新增读取序列内的 restore:true 后通过。最终检查补集中状态入口时，首次误把 unknown → granted 初始化也当成权限变化，导致稳定对账多一轮；收窄为已知 granted/denied 之间变化后定向通过。未出现同一问题连续两次失败；未通过时未推送。

### 剩余边界

仍需 Android 14–16 / OPPO 真机验证系统设置撤销导致进程停止后重新启动、息屏投递及厂商电池策略。非精确降级只恢复队列，不保证准时。第 5 条兼容分支有历史数据依据，保留有意。其余旧数据 false 意图、送达不等于看到等限制仍按上文说明。
