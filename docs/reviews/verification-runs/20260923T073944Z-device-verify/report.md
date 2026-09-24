# 设备连接与整体验证报告

- 运行目录：`/Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T073944Z-device-verify`
- 开始：2026-09-23T07:39:44Z  结束：2026-09-23T07:39:57Z
- **结论：PASS_WITH_WARN**（PASS 21 / FAIL 0 / WARN 3 / SKIP 2）

## 环境

| 项 | 值 |
| --- | --- |
| host | QLYFdeMacBook-Air.local |
| adb | /Users/qlyf/Library/Android/sdk/platform-tools/adb |
| package | space.alliswell.inbox |
| liveMode | False |
| ro.product.manufacturer | vivo |
| ro.product.model | V2238A |
| ro.build.version.release | 16 |
| ro.build.version.sdk | 36 |
| ro.build.display.id | PD2238_A_16.3.16.0.W10 |
| ro.vivo.os.version | 16.0 |
| serial | 10ACBF2D3D000RS |

## 结果明细

| 编号 | 状态 | 项目 | 说明 |
| --- | --- | --- | --- |
| A-01 | PASS | adb 可用 | Android Debug Bridge version 1.0.41 |
| A-02 | PASS | 设备发现 | {"serial": "10ACBF2D3D000RS"} |
| A-03 | PASS | 调试授权 | {"state": "device"} |
| A-04 | PASS | 连接稳定性（连续 3 次取样） | {"samples": ["device", "device", "device"], "transportIds": ["9"]} |
| A-05 | PASS | 设备身份与传输通道 | {"serial": "10ACBF2D3D000RS", "transport": "usb(有线)", "manufacturer": "vivo", "model": "V2238A", "android": "16", "sdk": "36", "rom": "16.0"} |
| B-01 | PASS | 命令通道往返 | {"sent": "dvd6d9e913feb8", "received": "dvd6d9e913feb8", "rc": 0} |
| B-02 | PASS | 设备时钟一致性 | {"deviceMs": 1790149187782, "hostMs": 1790149188363, "skewMs": -581} |
| B-03 | PASS | 文件通道一致性（64KB 往返） | {"algo": "sha256", "hostHash": "06d6ea8ed33c760a4b231339f3561097687513ff209f7ad0f1df0f6815d74ee8", "deviceHash": "06d6ea8ed33c760a4b231339f3561097687513ff209f7ad0f1df0f6815d74ee8", "pulledHash": "06d6ea8ed33c760a4b231339… |
| B-04 | PASS | 二进制通道（exec-out 截屏） | {"bytes": 3121722, "rc": 0} |
| B-05 | PASS | 端口转发通道 | {"port": "50264", "listed": true, "rc": 0} |
| B-06 | PASS | 日志通道（logcat 回读） | {"marker": "dvlog75f6a6d11f", "matched": true, "logWriteRc": 0} |
| B-07 | PASS | 包管理通道（pm path） | {"out": "package:/data/app/~~SROxmW9Tz_XOKeSkpL6lbQ==/space.alliswell.inbox-1oc4SLJs35U7mUeOP4O8Iw==/base.apk", "rc": 0} |
| F-01 | PASS | 设备能力（屏幕/电量/存储） | {"wmSize": "1080x2400", "wmDensity": "480", "batteryLevel": 95, "batteryStatus": "0", "dataFree": "79162796", "wakefulness": "Awake"} |
| F-02 | PASS | 应用安装与版本 | {"versionName": "1.1", "versionCode": "2", "targetSdk": "34", "minSdk": "22", "firstInstallTime": "2026-09-23", "lastUpdateTime": "2026-09-23", "apkPath": "/data/app/~~SROxmW9Tz_XOKeSkpL6lbQ==/space.alliswell.inbox-1oc4S… |
| F-03 | WARN | 关键权限授予状态 | {"granted": {"POST_NOTIFICATIONS": true, "SCHEDULE_EXACT_ALARM": null, "USE_EXACT_ALARM": null, "USE_FULL_SCREEN_INTENT": true, "SYSTEM_ALERT_WINDOW": null, "RECEIVE_BOOT_COMPLETED": true, "WAKE_LOCK": true, "FOREGROUND_… |
| F-04 | PASS | 后台策略（appops / 电池白名单） | {"ops": {"SYSTEM_ALERT_WINDOW": "default"}, "batteryWhitelisted": false} |
| F-05 | WARN | 通知渠道（0/3） | {"expected": ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"], "found": [], "allChannelIds": ["10001", "10011", "10101", "110000", "110010", "110020", "110030", "ABUSIVE_BACKGROUND_APPS", "ACCESSIBI… |
| F-06 | PASS | 闹钟排程（dumpsys alarm） | {"entriesForPackage": 0, "frozenMarkers": 14, "sample": []} |
| F-07 | PASS | 进程与冻结态 | {"pid": "27880", "cgroupFrozenHint": false, "cgroup": "5:net_prio:/\n4:memory:/apps/space.alliswell.inbox\n3:cpuset:/background\n2:cpu:/background\n1:blkio:/bg\n0::/apps/uid_10285/pid_27880"} |
| F-08 | WARN | 原生排程台账（shared_prefs） | {"rc": 1, "stderr": "cat: shared_prefs/attention_alarm_schedules.xml: No such file or directory\n"} |
| F-09 | PASS | Web 运行时 ready() | {"ready": true, "items": 0, "notify": false, "scheduled": 0, "hasLib": "object", "capacitor": true, "plugins": ["App", "AppSettings", "LocalNotifications", "CapacitorCookies", "WebView", "CapacitorHttp", "SystemBridge"]} |
| F-10 | PASS | 业务逻辑真机回归 | {"parseTriggerable": true, "makeItemHasId": true, "makeItemDeliveryMode": "alarm", "isDueNow": true, "quietHoursType": "boolean", "uid": true} |
| F-11 | SKIP | 通知排程往返（写入类） | {} |
| F-12 | SKIP | 存储持久化往返（写入类） | {} |
| D-01 | PASS | 结束时链路仍在线 | {"state": "device"} |
| D-02 | PASS | 全程链路掉线次数 | {"linkDrops": 0, "adbCalls": 53} |

> WARN = 环境限制导致无法判定，不算通过也不算失败；SKIP = 本次未启用。
