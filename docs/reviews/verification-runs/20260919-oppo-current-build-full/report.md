# 设备连接与整体验证报告

- 运行目录：`docs/reviews/verification-runs/20260919-oppo-current-build-full`
- 开始：2026-09-19T13:29:25Z  结束：2026-09-19T13:29:50Z
- **结论：FAIL**（PASS 23 / FAIL 2 / WARN 1 / SKIP 0）

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
| A-04 | PASS | 连接稳定性（连续 3 次取样） | {"samples": ["device", "device", "device"], "transportIds": ["4"]} |
| A-05 | PASS | 设备身份与传输通道 | {"serial": "QSKFAE95CQEUJZ8L", "transport": "usb(有线)", "manufacturer": "OPPO", "model": "PKC130", "android": "16", "sdk": "36", "rom": ""} |
| B-01 | PASS | 命令通道往返 | {"sent": "dv37bbe797f142", "received": "dv37bbe797f142", "rc": 0} |
| B-02 | PASS | 设备时钟一致性 | {"deviceMs": 1789824568427, "hostMs": 1789824569256, "skewMs": -829} |
| B-03 | PASS | 文件通道一致性（64KB 往返） | {"algo": "sha256", "hostHash": "21b974536966782037aa7cf758a37070acfac7f06040c747c97986306bda7d45", "deviceHash": "21b974536966782037aa7cf758a37070acfac7f06040c747c97986306bda7d45", "pulledHash": "21b974536966782037aa7cf7… |
| B-04 | PASS | 二进制通道（exec-out 截屏） | {"bytes": 1856527, "rc": 0} |
| B-05 | PASS | 端口转发通道 | {"port": "64577", "listed": true, "rc": 0} |
| B-06 | PASS | 日志通道（logcat 回读） | {"marker": "dvlog9468ec6283", "matched": true, "logWriteRc": 0} |
| B-07 | PASS | 包管理通道（pm path） | {"out": "package:/data/app/~~SLW24pNx83tiBRk7O3xIDA==/space.alliswell.inbox-nlV5r86MAcSMMrQOykUqiA==/base.apk", "rc": 0} |
| F-01 | PASS | 设备能力（屏幕/电量/存储） | {"wmSize": "1080x2376", "wmDensity": "560\nOverride density: 480", "batteryLevel": 33, "batteryStatus": "2", "dataFree": "613294924", "wakefulness": "Awake"} |
| F-02 | PASS | 应用安装与版本 | {"versionName": "1.0", "versionCode": "1", "targetSdk": "34", "minSdk": "22", "firstInstallTime": "2026-09-18", "lastUpdateTime": "2026-09-19", "apkPath": "/data/app/~~SLW24pNx83tiBRk7O3xIDA==/space.alliswell.inbox-nlV5r… |
| F-03 | FAIL | 关键权限授予状态 | {"granted": {"POST_NOTIFICATIONS": false, "SCHEDULE_EXACT_ALARM": null, "USE_EXACT_ALARM": null, "USE_FULL_SCREEN_INTENT": true, "SYSTEM_ALERT_WINDOW": null, "RECEIVE_BOOT_COMPLETED": true, "WAKE_LOCK": true, "FOREGROUND… |
| F-04 | PASS | 后台策略（appops / 电池白名单） | {"ops": {"RUN_ANY_IN_BACKGROUND": "allow", "SYSTEM_ALERT_WINDOW": "allow", "START_FOREGROUND": "allow", "WAKE_LOCK": "allow"}, "batteryWhitelisted": true} |
| F-05 | PASS | 通知渠道（3/3） | {"expected": ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"], "found": ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"], "allChannelIds": ["000", "0001_importance", "0002_norm… |
| F-06 | PASS | 闹钟排程（dumpsys alarm） | {"entriesForPackage": 14, "frozenMarkers": 3, "sample": ["          type=RTC_WAKEUP tag=*walarm*:space.alliswell.inbox/com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher ", "          type=RTC_WAKEUP t… |
| F-07 | WARN | 进程与冻结态 | {"pid": null, "cgroupFrozenHint": false, "cgroup": ""} |
| F-08 | PASS | 原生排程台账（shared_prefs） | {"entries": 0} |
| F-09 | PASS | Web 运行时 ready() | {"ready": true, "items": 34, "notify": true, "scheduled": 0, "hasLib": "object", "capacitor": true, "plugins": ["App", "AppSettings", "LocalNotifications", "CapacitorCookies", "WebView", "CapacitorHttp", "SystemBridge"]} |
| F-10 | PASS | 业务逻辑真机回归 | {"parseTriggerable": true, "makeItemHasId": true, "makeItemDeliveryMode": "alarm", "isDueNow": true, "quietHoursType": "boolean", "uid": true} |
| F-11 | PASS | 通知排程往返（写入类） | {"pendingAfterSchedule": [1368375496, 905405446, 99001, 133935629, 490888281, 1711534025], "pendingAfterCancel": [1368375496, 905405446, 133935629, 490888281, 1711534025]} |
| F-12 | FAIL | 存储持久化往返（写入类） | {"persisted": true, "restored": false, "beforeCount": 34, "afterCount": 35} |
| D-01 | PASS | 结束时链路仍在线 | {"state": "device"} |
| D-02 | PASS | 全程链路掉线次数 | {"linkDrops": 0, "adbCalls": 53} |

> WARN = 环境限制导致无法判定，不算通过也不算失败；SKIP = 本次未启用。
