# P3-G 真实设备（vivo V2238A）实机验证报告

> **设备信息**：
> - 型号：vivo V2238A（PD2238）· Android 16 / SDK 36 · OriginOS 16.0
> - 序列号：`10ACBF2D3D000RS`（USB 直连通道）
> - 被测包：`space.alliswell.inbox`
> - 被测候选 APK：`releases/candidates/20260923T1405-p3g-candidate/app-debug.apk`
> - 候选 SHA-256：`bc87fe0530330ab3011af2b3254b784fcc94a429ac34c470dca6b6f15b7f2783`
> - 在机安装产物 SHA-256：`bc87fe0530330ab3011af2b3254b784fcc94a429ac34c470dca6b6f15b7f2783`（完全一致）
> - 验证脚本：[`scripts/verification/p3g-device-verify.py`](file:///Users/qlyf/Developer/reminder/scripts/verification/p3g-device-verify.py)
> - 验证结论：**PASS**

---

## 1. 验证目标

在真实物理 Android 设备上针对 P3-G 迁移的 Web 提醒弹条、到期推进以及活动原生闹钟面板及其轮询能力进行端到端闭环验证：
1. 校验设备上安装运行的代码即为本轮构建的 P3-G 候选包；
2. 验证真实 WebView 环境下 `window.__ATTENTION_INBOX__.alerts` 的 17 项实例方法契约与单所有权装配；
3. 验证 Web 提醒弹条在真实 DOM 中的展示、关闭、“×” 30 分钟静音抑制、绑定幂等性及异常容错；
4. 验证活动原生闹钟面板的宿主挂载与无活跃闹钟时的隐藏能力；
5. 验证真实原生闹钟投递、声振响铃、活动闹钟卡片渲染与“完成事项”停止声振。

---

## 2. 验证过程与实测数据

### 2.1 安装包指纹双向校验
- 命令：`adb -s 10ACBF2D3D000RS shell sha256sum /data/app/~~SROxmW9Tz_XOKeSkpL6lbQ==/space.alliswell.inbox-1oc4SLJs35U7mUeOP4O8Iw==/base.apk`
- 实测 SHA-256：`bc87fe0530330ab3011af2b3254b784fcc94a429ac34c470dca6b6f15b7f2783`
- 本地候选 SHA-256：`bc87fe0530330ab3011af2b3254b784fcc94a429ac34c470dca6b6f15b7f2783`
- **结论：逐字节完全匹配（PASS）**。

### 2.2 Web 运行时与 17 项方法契约核验
- 通过 CDP 探测运行中的应用 WebView（PID: 27880）：
```json
{
  "hasA": true,
  "hasAlerts": true,
  "contractCount": 17,
  "missing": [],
  "pass": true
}
```
17 项实例方法（`showAlert`, `hideAlert`, `dismissAlert`, `applyAlertDismissal`, `shouldSkipAlert`, `showSystemNotification`, `tick`, `getAlertItem`, `clearAlert`, `bindAlertControls`, `handleNotificationAction`, `deliveryHandledByCommittedItem`, `completeActiveAlarm`, `refreshActiveAlarmPanel`, `startPolling`, `stopPolling`, `onVisibilityChange`）全部就绪且均为函数。

### 2.3 Web 提醒弹条与 30 分钟抑制
- 调度真实 DOM 交互：
  - 调用 `A.alerts.showAlert(testItem)`，`#alertBanner` 获得 `show` 与 `crit` class，标题与文案正确；
  - 触发 `await A.alerts.dismissAlert()`，弹条收起，`dismissedUntil` 推进 30 分钟（至 `1790151304312`），`shouldSkipAlert()` 返回 `true`；
  - 多次调用 `bindAlertControls()` 保持幂等；
- 实测结果：
```json
{
  "shown": true,
  "isCrit": true,
  "titleText": "🚨 关键提醒",
  "bodyText": "真机弹条自检事项",
  "dismissResult": true,
  "closed": true,
  "skippedNow": true,
  "itemSuppressedUntil": 1790151304312,
  "pass": true
}
```

### 2.4 活动原生闹钟面板基础能力
- 查询 `#activeAlarmPanel` 节点存在，`SystemBridge.activeAlarmDeliveries` 桥可用，无活动闹钟时面板处于 `hidden: true`。

### 2.5 真实原生闹钟投递、声振响铃与活动面板卡片操作
- **排程**：创建事项 `device_p3g_alarm_1790149506`（title: `P3-G 真机响铃 9506`），设置 18 秒后触发，保存后切入后台；
- **响铃触发**：
  - 到期瞬间，设备触发声振与系统通知；
  - 台账 `alarm_trace.xml` 记录 `deliveryStarted` 与 `received`；
  - `dumpsys audio` 记录 `USAGE_ALARM` 处于活跃播放状态；
- **前台展示与活动面板**：
  - 唤醒设备并调起主界面；
  - 轮询机制自动触发 `refreshActiveAlarmPanel`；
  - `#activeAlarmPanel` 展开显示（`panelHidden: false`），渲染卡片：
    ```
    闹钟待处理
    P3-G 真机响铃 9506
    全屏未显示时，也可以在这里处理。
    停止声振 完成事项
    ```
  - `deliveries` 列表准确命中当前活跃投递（ID: `133024820`，Token: `133024820:a1d9b2df-3bbf-40c1-91bc-0fb8456c958a`）；
- **完成事项与停止声振**：
  - 触发 `completeActiveAlarm`（模拟用户点击“完成事项”）；
  - 事项状态变更为 `archived`；
  - 活跃投递停止，剩余投递数归零（`remainingAlarmsCount: 0`）；
  - `dumpsys vibrator_manager` 确认振动完全清除（`CurrentVibration: null`）；
- **现场清理**：测试项已归档清除，设备恢复原状。

---

## 3. 证据产物汇总

全部原始记录与现场截图归档于当前目录：
- 结构化机器报告：[`device-report.json`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1540-p3g-device-verification/device-report.json)
- 现场截屏：
  - 弹条验证态：[`web-banner-verified.png`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1540-p3g-device-verification/web-banner-verified.png)
  - 闹钟响铃态：[`alarm-triggered.png`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1540-p3g-device-verification/alarm-triggered.png)
  - 前台面板态：[`app-foreground-with-alarm.png`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1540-p3g-device-verification/app-foreground-with-alarm.png)
  - 操作停止态：[`alarm-completed-stopped.png`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1540-p3g-device-verification/alarm-completed-stopped.png)
  - 清理恢复态：[`cleanup-final.png`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1540-p3g-device-verification/cleanup-final.png)
- 现场转储日志：
  - `*-vibrator.txt`
  - `*-audio.txt`
  - `*-notifications.txt`
  - `*-alarm-trace.xml`

---

## 4. 结论

在 USB 连接的真实 vivo V2238A 手机上，P3-G 候选包运行正常。Web 提醒弹条与活动原生闹钟面板在真实 Android 环境下的所有状态转换、交互、抑制及原生桥通信全部验证通过。
