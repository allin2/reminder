# 设备连接与整体验证报告

- 运行目录：`docs/reviews/verification-runs/20260920T154419Z-grilling-main-device/device-verify`
- 开始：2026-09-20T15:46:35Z  结束：2026-09-20T15:46:59Z
- **结论：PASS_WITH_WARN**（PASS 24 / FAIL 0 / WARN 2 / SKIP 0）

## 环境

| 项 | 值 |
| --- | --- |
| host | QLYFdeMacBook-Air.local |
| adb | /Users/qlyf/Library/Android/sdk/platform-tools/adb |
| package | space.alliswell.inbox |
| liveMode | True |
| ro.product.manufacturer | OPPO |
| ro.product.model | PKC130 |
| ro.build.version.release | 16 |
| ro.build.version.sdk | 36 |
| ro.build.display.id | PKC130_16.0.10.500(CN01) |
| serial | QSKFAE95CQEUJZ8L |

## 结果明细

| 编号 | 状态 | 项目 | 说明 |
| --- | --- | --- | --- |
| A-01 | PASS | adb 可用 | Android Debug Bridge version 1.0.41 |
| A-02 | PASS | 设备发现 | {"serial": "QSKFAE95CQEUJZ8L"} |
| A-03 | PASS | 调试授权 | {"state": "device"} |
| A-04 | PASS | 连接稳定性（连续 3 次取样） | {"samples": ["device", "device", "device"], "transportIds": ["5"]} |
| A-05 | PASS | 设备身份与传输通道 | {"serial": "QSKFAE95CQEUJZ8L", "transport": "usb(有线)", "manufacturer": "OPPO", "model": "PKC130", "android": "16", "sdk": "36", "rom": ""} |
| B-01 | PASS | 命令通道往返 | {"sent": "dvafdd0990e87f", "received": "dvafdd0990e87f", "rc": 0} |
| B-02 | PASS | 设备时钟一致性 | {"deviceMs": 1789919199603, "hostMs": 1789919198832, "skewMs": 771} |
| B-03 | PASS | 文件通道一致性（64KB 往返） | {"algo": "sha256", "hostHash": "2e03eaa5b519388067f433bd2fa22184ccb091a3a5721b99958727f25fc35157", "deviceHash": "2e03eaa5b519388067f433bd2fa22184ccb091a3a5721b99958727f25fc35157", "pulledHash": "2e03eaa5b519388067f433bd… |
| B-04 | PASS | 二进制通道（exec-out 截屏） | {"bytes": 187036, "rc": 0} |
| B-05 | PASS | 端口转发通道 | {"port": "53479", "listed": true, "rc": 0} |
| B-06 | PASS | 日志通道（logcat 回读） | {"marker": "dvlogddf99a4765", "matched": true, "logWriteRc": 0} |
| B-07 | PASS | 包管理通道（pm path） | {"out": "package:/data/app/~~JwIHrw531vPLArO0ezob2w==/space.alliswell.inbox-aa7zTK3h8yT9fXSJC4HqOQ==/base.apk", "rc": 0} |
| F-01 | PASS | 设备能力（屏幕/电量/存储） | {"wmSize": "1080x2376", "wmDensity": "560\nOverride density: 480", "batteryLevel": 89, "batteryStatus": "2", "dataFree": "612016496", "wakefulness": "Awake"} |
| F-02 | PASS | 应用安装与版本 | {"versionName": "1.1", "versionCode": "2", "targetSdk": "34", "minSdk": "22", "firstInstallTime": "2026-09-20", "lastUpdateTime": "2026-09-20", "apkPath": "/data/app/~~JwIHrw531vPLArO0ezob2w==/space.alliswell.inbox-aa7zT… |
| F-03 | WARN | 关键权限授予状态 | {"granted": {"POST_NOTIFICATIONS": true, "SCHEDULE_EXACT_ALARM": null, "USE_EXACT_ALARM": null, "USE_FULL_SCREEN_INTENT": true, "SYSTEM_ALERT_WINDOW": null, "RECEIVE_BOOT_COMPLETED": true, "WAKE_LOCK": true, "FOREGROUND_… |
| F-04 | PASS | 后台策略（appops / 电池白名单） | {"ops": {"RUN_ANY_IN_BACKGROUND": "allow", "SYSTEM_ALERT_WINDOW": "allow", "SCHEDULE_EXACT_ALARM": "allow", "START_FOREGROUND": "allow", "WAKE_LOCK": "allow"}, "batteryWhitelisted": true} |
| F-05 | WARN | 通知渠道（2/3） | {"expected": ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"], "found": ["attention-bridge-v2", "attention-alarm-guard"], "allChannelIds": ["000", "0001_importance", "0002_normal", "001", "053316530… |
| F-06 | PASS | 闹钟排程（dumpsys alarm） | {"entriesForPackage": 19, "frozenMarkers": 3, "sample": ["        space.alliswell.inbox", "    RTC_WAKEUP #119: Alarm{14dd1c type 0 origWhen 1789932600073 whenElapsed 261016642 space.alliswell.inbox} uid 10558 whenElapse… |
| F-07 | PASS | 进程与冻结态 | {"pid": "30189", "cgroupFrozenHint": true, "cgroup": "5:freezer:/\n4:memory:/apps/space.alliswell.inbox\n3:cpuset:/top-app\n2:cpu:/top-app\n1:blkio:/\n0::/apps/uid_10558/pid_30189"} |
| F-08 | PASS | 原生排程台账（shared_prefs） | {"entries": 0} |
| F-09 | PASS | Web 运行时 ready() | {"ready": true, "items": 6, "notify": true, "scheduled": 1, "hasLib": "object", "capacitor": true, "plugins": ["App", "AppSettings", "LocalNotifications", "CapacitorCookies", "WebView", "CapacitorHttp", "SystemBridge"]} |
| F-10 | PASS | 业务逻辑真机回归 | {"parseTriggerable": true, "makeItemHasId": true, "makeItemDeliveryMode": "alarm", "isDueNow": true, "quietHoursType": "boolean", "uid": true} |
| F-11 | PASS | 通知排程往返（写入类） | {"pendingAfterSchedule": [2089772097, 318731423, 888529060, 489530333, 225614150, 99001, 905500283, 164639442], "pendingAfterCancel": [2089772097, 318731423, 888529060, 489530333, 225614150, 905500283, 164639442]} |
| F-12 | PASS | 存储持久化往返（写入类） | {"persisted": true, "restored": true, "beforeCount": 6, "afterCount": 6} |
| D-01 | PASS | 结束时链路仍在线 | {"state": "device"} |
| D-02 | PASS | 全程链路掉线次数 | {"linkDrops": 0, "adbCalls": 54} |

> WARN = 环境限制导致无法判定，不算通过也不算失败；SKIP = 本次未启用。
