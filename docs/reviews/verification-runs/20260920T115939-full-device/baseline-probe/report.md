# 设备连接与整体验证报告

- 运行目录：`/Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260920T115939-full-device/baseline-probe`
- 开始：2026-09-20T04:01:45Z  结束：2026-09-20T04:01:55Z
- **结论：FAIL**（PASS 21 / FAIL 1 / WARN 2 / SKIP 2）

## 环境

| 项 | 值 |
| --- | --- |
| host | QLYFdeMacBook-Air.local |
| adb | /Users/qlyf/Library/Android/sdk/platform-tools/adb |
| package | space.alliswell.inbox |
| liveMode | False |
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
| A-04 | PASS | 连接稳定性（连续 3 次取样） | {"samples": ["device", "device", "device"], "transportIds": ["15"]} |
| A-05 | PASS | 设备身份与传输通道 | {"serial": "QSKFAE95CQEUJZ8L", "transport": "usb(有线)", "manufacturer": "OPPO", "model": "PKC130", "android": "16", "sdk": "36", "rom": ""} |
| B-01 | PASS | 命令通道往返 | {"sent": "dvd1bdb8957c62", "received": "dvd1bdb8957c62", "rc": 0} |
| B-02 | PASS | 设备时钟一致性 | {"deviceMs": 1789876909486, "hostMs": 1789876909034, "skewMs": 452} |
| B-03 | PASS | 文件通道一致性（64KB 往返） | {"algo": "sha256", "hostHash": "3a57e80060b0684416cec53ae895e519052273a2c2fa72228897aeaaab00442e", "deviceHash": "3a57e80060b0684416cec53ae895e519052273a2c2fa72228897aeaaab00442e", "pulledHash": "3a57e80060b0684416cec53a… |
| B-04 | PASS | 二进制通道（exec-out 截屏） | {"bytes": 260112, "rc": 0} |
| B-05 | PASS | 端口转发通道 | {"port": "57441", "listed": true, "rc": 0} |
| B-06 | PASS | 日志通道（logcat 回读） | {"marker": "dvlog874526f884", "matched": true, "logWriteRc": 0} |
| B-07 | PASS | 包管理通道（pm path） | {"out": "package:/data/app/~~l8qFNhQ_eeVJ45HhODiZ9Q==/space.alliswell.inbox-Qt1FPot_C9wpvAVgsQBWhw==/base.apk", "rc": 0} |
| F-01 | PASS | 设备能力（屏幕/电量/存储） | {"wmSize": "1080x2376", "wmDensity": "560\nOverride density: 480", "batteryLevel": 100, "batteryStatus": "5", "dataFree": "613000008", "wakefulness": "Awake"} |
| F-02 | PASS | 应用安装与版本 | {"versionName": "1.0", "versionCode": "1", "targetSdk": "34", "minSdk": "22", "firstInstallTime": "2026-09-20", "lastUpdateTime": "2026-09-20", "apkPath": "/data/app/~~l8qFNhQ_eeVJ45HhODiZ9Q==/space.alliswell.inbox-Qt1FP… |
| F-03 | FAIL | 关键权限授予状态 | {"granted": {"POST_NOTIFICATIONS": false, "SCHEDULE_EXACT_ALARM": null, "USE_EXACT_ALARM": null, "USE_FULL_SCREEN_INTENT": true, "SYSTEM_ALERT_WINDOW": null, "RECEIVE_BOOT_COMPLETED": true, "WAKE_LOCK": true, "FOREGROUND… |
| F-04 | PASS | 后台策略（appops / 电池白名单） | {"ops": {"POST_NOTIFICATION": "ignore"}, "batteryWhitelisted": false} |
| F-05 | WARN | 通知渠道（0/3） | {"expected": ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"], "found": [], "allChannelIds": ["000", "0001_importance", "0002_normal", "001", "053316530413edba#voip_ringtone_channel_1780973913682", … |
| F-06 | PASS | 闹钟排程（dumpsys alarm） | {"entriesForPackage": 0, "frozenMarkers": 3, "sample": []} |
| F-07 | PASS | 进程与冻结态 | {"pid": "10641", "cgroupFrozenHint": true, "cgroup": "5:freezer:/\n4:memory:/apps/space.alliswell.inbox\n3:cpuset:/top-app\n2:cpu:/top-app\n1:blkio:/\n0::/apps/uid_10557/pid_10641"} |
| F-08 | WARN | 原生排程台账（shared_prefs） | {"rc": 1, "stderr": "cat: shared_prefs/attention_alarm_schedules.xml: No such file or directory\n"} |
| F-09 | PASS | Web 运行时 ready() | {"ready": true, "items": 0, "notify": false, "scheduled": 0, "hasLib": "object", "capacitor": true, "plugins": ["App", "AppSettings", "LocalNotifications", "CapacitorCookies", "WebView", "CapacitorHttp", "SystemBridge"]} |
| F-10 | PASS | 业务逻辑真机回归 | {"parseTriggerable": true, "makeItemHasId": true, "makeItemDeliveryMode": "alarm", "isDueNow": true, "quietHoursType": "boolean", "uid": true} |
| F-11 | SKIP | 通知排程往返（写入类） | {} |
| F-12 | SKIP | 存储持久化往返（写入类） | {} |
| D-01 | PASS | 结束时链路仍在线 | {"state": "device"} |
| D-02 | PASS | 全程链路掉线次数 | {"linkDrops": 0, "adbCalls": 53} |

> WARN = 环境限制导致无法判定，不算通过也不算失败；SKIP = 本次未启用。
