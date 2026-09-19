# 设备连接与整体验证报告

- 运行目录：`/Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260917T175059Z-device-verify`
- 开始：2026-09-17T17:50:59Z  结束：2026-09-17T17:51:26Z
- **结论：PASS_WITH_WARN**（PASS 25 / FAIL 0 / WARN 1 / SKIP 0）

## 环境

| 项 | 值 |
| --- | --- |
| host | QLYFdeMacBook-Air.local |
| adb | /Users/qlyf/Library/Android/sdk/platform-tools/adb |
| package | space.alliswell.inbox |
| liveMode | True |
| ro.product.manufacturer | vivo |
| ro.product.model | V2238A |
| ro.build.version.release | 16 |
| ro.build.version.sdk | 36 |
| ro.build.display.id | PD2238_A_16.3.15.0.W10 |
| ro.vivo.os.version | 16.0 |
| serial | 10ACBF2D3D000RS |

## 结果明细

| 编号 | 状态 | 项目 | 说明 |
| --- | --- | --- | --- |
| A-01 | PASS | adb 可用 | Android Debug Bridge version 1.0.41 |
| A-02 | PASS | 设备发现 | {"serial": "10ACBF2D3D000RS"} |
| A-03 | PASS | 调试授权 | {"state": "device"} |
| A-04 | PASS | 连接稳定性（连续 3 次取样） | {"samples": ["device", "device", "device"], "transportIds": ["15"]} |
| A-05 | PASS | 设备身份与传输通道 | {"serial": "10ACBF2D3D000RS", "transport": "usb(有线)", "manufacturer": "vivo", "model": "V2238A", "android": "16", "sdk": "36", "rom": "16.0"} |
| B-01 | PASS | 命令通道往返 | {"sent": "dve2cca2dd80a8", "received": "dve2cca2dd80a8", "rc": 0} |
| B-02 | PASS | 设备时钟一致性 | {"deviceMs": 1789667462883, "hostMs": 1789667463082, "skewMs": -199} |
| B-03 | PASS | 文件通道一致性（64KB 往返） | {"algo": "sha256", "hostHash": "5d6c4e6ad0626563469d5ebc3abc20ce009587f634d66247b1a7ac2d205bb33f", "deviceHash": "5d6c4e6ad0626563469d5ebc3abc20ce009587f634d66247b1a7ac2d205bb33f", "pulledHash": "5d6c4e6ad0626563469d5ebc… |
| B-04 | PASS | 二进制通道（exec-out 截屏） | {"bytes": 3147962, "rc": 0} |
| B-05 | PASS | 端口转发通道 | {"port": "62009", "listed": true, "rc": 0} |
| B-06 | PASS | 日志通道（logcat 回读） | {"marker": "dvlog675697a4ea", "matched": true, "logWriteRc": 0} |
| B-07 | PASS | 包管理通道（pm path） | {"out": "package:/data/app/~~TjZjgF55VOHpvV30Q2UWIw==/space.alliswell.inbox-60qAdd0p6oQz1YIctFFl-w==/base.apk", "rc": 0} |
| F-01 | PASS | 设备能力（屏幕/电量/存储） | {"wmSize": "1080x2400", "wmDensity": "480", "batteryLevel": 95, "batteryStatus": "0", "dataFree": "77682224", "wakefulness": "Awake"} |
| F-02 | PASS | 应用安装与版本 | {"versionName": "1.0", "versionCode": "1", "targetSdk": "34", "minSdk": "22", "firstInstallTime": "2026-09-17", "lastUpdateTime": "2026-09-18", "apkPath": "/data/app/~~TjZjgF55VOHpvV30Q2UWIw==/space.alliswell.inbox-60qAd… |
| F-03 | WARN | 关键权限授予状态 | {"granted": {"POST_NOTIFICATIONS": true, "SCHEDULE_EXACT_ALARM": null, "USE_EXACT_ALARM": true, "USE_FULL_SCREEN_INTENT": true, "SYSTEM_ALERT_WINDOW": null, "RECEIVE_BOOT_COMPLETED": true, "WAKE_LOCK": true, "FOREGROUND_… |
| F-04 | PASS | 后台策略（appops / 电池白名单） | {"ops": {"POST_NOTIFICATION": "allow", "SYSTEM_ALERT_WINDOW": "allow", "START_FOREGROUND": "allow", "WAKE_LOCK": "allow"}, "batteryWhitelisted": true} |
| F-05 | PASS | 通知渠道（3/3） | {"expected": ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"], "found": ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"], "allChannelIds": ["10001", "10011", "10101", "110000",… |
| F-06 | PASS | 闹钟排程（dumpsys alarm） | {"entriesForPackage": 93, "frozenMarkers": 13, "sample": ["        space.alliswell.inbox", "    RTC_WAKEUP #73: Alarm{d3de855 type 0 origWhen 1789687800000 flags 9 windowLength 0 whenElapsed 255218112 maxWhenElapsed 2552… |
| F-07 | PASS | 进程与冻结态 | {"pid": "25905", "cgroupFrozenHint": false, "cgroup": "5:net_prio:/\n4:memory:/apps/space.alliswell.inbox\n3:cpuset:/background\n2:cpu:/background\n1:blkio:/bg\n0::/apps/uid_10190/pid_25905"} |
| F-08 | PASS | 原生排程台账（shared_prefs） | {"entries": 0} |
| F-09 | PASS | Web 运行时 ready() | {"ready": true, "items": 20, "notify": true, "scheduled": 3, "hasLib": "object", "capacitor": true, "plugins": ["App", "AppSettings", "LocalNotifications", "CapacitorCookies", "WebView", "CapacitorHttp", "SystemBridge"]} |
| F-10 | PASS | 业务逻辑真机回归 | {"parseTriggerable": true, "makeItemHasId": true, "makeItemDeliveryMode": "alarm", "isDueNow": true, "quietHoursType": "boolean", "uid": true} |
| F-11 | PASS | 通知排程往返（写入类） | {"pendingAfterSchedule": [57763003, 751195578, 1142068250, 1795282634, 501017040, 81932500, 229904301, 1626975076, 932598262, 99001, 699042348, 726010301, 2143783577, 827967551, 130073715], "pendingAfterCancel": [5776300… |
| F-12 | PASS | 存储持久化往返（写入类） | {"persisted": true, "restored": true, "beforeCount": 20, "afterCount": 20} |
| D-01 | PASS | 结束时链路仍在线 | {"state": "device"} |
| D-02 | PASS | 全程链路掉线次数 | {"linkDrops": 0, "adbCalls": 54} |

> WARN = 环境限制导致无法判定，不算通过也不算失败；SKIP = 本次未启用。
