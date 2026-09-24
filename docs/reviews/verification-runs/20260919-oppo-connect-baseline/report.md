# 设备连接与整体验证报告

- 运行目录：`docs/reviews/verification-runs/20260919-oppo-connect-baseline`
- 开始：2026-09-19T13:28:15Z  结束：2026-09-19T13:28:25Z
- **结论：FAIL**（PASS 20 / FAIL 1 / WARN 1 / SKIP 2）

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
| A-04 | PASS | 连接稳定性（连续 5 次取样） | {"samples": ["device", "device", "device", "device", "device"], "transportIds": ["4"]} |
| A-05 | PASS | 设备身份与传输通道 | {"serial": "QSKFAE95CQEUJZ8L", "transport": "usb(有线)", "manufacturer": "OPPO", "model": "PKC130", "android": "16", "sdk": "36", "rom": ""} |
| B-01 | PASS | 命令通道往返 | {"sent": "dvda3d01fd0d4c", "received": "dvda3d01fd0d4c", "rc": 0} |
| B-02 | PASS | 设备时钟一致性 | {"deviceMs": 1789824500626, "hostMs": 1789824501455, "skewMs": -829} |
| B-03 | PASS | 文件通道一致性（64KB 往返） | {"algo": "sha256", "hostHash": "3a7812433fa55be80fd15c1f9bba0c0941734d16802ea26b104d55722c2b480f", "deviceHash": "3a7812433fa55be80fd15c1f9bba0c0941734d16802ea26b104d55722c2b480f", "pulledHash": "3a7812433fa55be80fd15c1f… |
| B-04 | PASS | 二进制通道（exec-out 截屏） | {"bytes": 325708, "rc": 0} |
| B-05 | PASS | 端口转发通道 | {"port": "64050", "listed": true, "rc": 0} |
| B-06 | PASS | 日志通道（logcat 回读） | {"marker": "dvlogfb1c2ae519", "matched": true, "logWriteRc": 0} |
| B-07 | PASS | 包管理通道（pm path） | {"out": "package:/data/app/~~3GcZOHv_c6Owz4NeyFtU1A==/space.alliswell.inbox-nGW99T-vbEnLxQbuLVd09A==/base.apk", "rc": 0} |
| F-01 | PASS | 设备能力（屏幕/电量/存储） | {"wmSize": "1080x2376", "wmDensity": "560\nOverride density: 480", "batteryLevel": 33, "batteryStatus": "2", "dataFree": "613303728", "wakefulness": "Awake"} |
| F-02 | PASS | 应用安装与版本 | {"versionName": "1.0", "versionCode": "1", "targetSdk": "34", "minSdk": "22", "firstInstallTime": "2026-09-18", "lastUpdateTime": "2026-09-18", "apkPath": "/data/app/~~3GcZOHv_c6Owz4NeyFtU1A==/space.alliswell.inbox-nGW99… |
| F-03 | FAIL | 关键权限授予状态 | {"granted": {"POST_NOTIFICATIONS": false, "SCHEDULE_EXACT_ALARM": null, "USE_EXACT_ALARM": true, "USE_FULL_SCREEN_INTENT": true, "SYSTEM_ALERT_WINDOW": null, "RECEIVE_BOOT_COMPLETED": true, "WAKE_LOCK": true, "FOREGROUND… |
| F-04 | PASS | 后台策略（appops / 电池白名单） | {"ops": {"RUN_ANY_IN_BACKGROUND": "allow", "SYSTEM_ALERT_WINDOW": "allow", "START_FOREGROUND": "allow", "WAKE_LOCK": "allow"}, "batteryWhitelisted": true} |
| F-05 | PASS | 通知渠道（3/3） | {"expected": ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"], "found": ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"], "allChannelIds": ["000", "0001_importance", "0002_norm… |
| F-06 | PASS | 闹钟排程（dumpsys alarm） | {"entriesForPackage": 14, "frozenMarkers": 3, "sample": ["          type=RTC_WAKEUP tag=*walarm*:space.alliswell.inbox/com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher ", "          type=RTC_WAKEUP t… |
| F-07 | WARN | 进程与冻结态 | {"pid": null, "cgroupFrozenHint": false, "cgroup": ""} |
| F-08 | PASS | 原生排程台账（shared_prefs） | {"entries": 0} |
| F-09 | SKIP | Web 运行时 ready() | {} |
| F-10 | SKIP | 业务逻辑真机回归 | {} |
| D-01 | PASS | 结束时链路仍在线 | {"state": "device"} |
| D-02 | PASS | 全程链路掉线次数 | {"linkDrops": 0, "adbCalls": 50} |

> WARN = 环境限制导致无法判定，不算通过也不算失败；SKIP = 本次未启用。
