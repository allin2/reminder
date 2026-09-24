# 设备连接与整体验证报告

- 运行目录：`/Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260919T043405Z-device-verify`
- 开始：2026-09-19T04:34:05Z  结束：2026-09-19T04:34:32Z
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
| ro.build.display.id | PD2238_A_16.3.16.0.W10 |
| ro.vivo.os.version | 16.0 |
| serial | 10ACBF2D3D000RS |

## 结果明细

| 编号 | 状态 | 项目 | 说明 |
| --- | --- | --- | --- |
| A-01 | PASS | adb 可用 | Android Debug Bridge version 1.0.41 |
| A-02 | PASS | 设备发现 | {"serial": "10ACBF2D3D000RS"} |
| A-03 | PASS | 调试授权 | {"state": "device"} |
| A-04 | PASS | 连接稳定性（连续 3 次取样） | {"samples": ["device", "device", "device"], "transportIds": ["1"]} |
| A-05 | PASS | 设备身份与传输通道 | {"serial": "10ACBF2D3D000RS", "transport": "usb(有线)", "manufacturer": "vivo", "model": "V2238A", "android": "16", "sdk": "36", "rom": "16.0"} |
| B-01 | PASS | 命令通道往返 | {"sent": "dv8864e84ef8f4", "received": "dv8864e84ef8f4", "rc": 0} |
| B-02 | PASS | 设备时钟一致性 | {"deviceMs": 1789792447585, "hostMs": 1789792449171, "skewMs": -1586} |
| B-03 | PASS | 文件通道一致性（64KB 往返） | {"algo": "sha256", "hostHash": "a87fe3f380a669a1c1cfead4fbb69e74fe82c39c576a569ac4e7f7b2da5f2462", "deviceHash": "a87fe3f380a669a1c1cfead4fbb69e74fe82c39c576a569ac4e7f7b2da5f2462", "pulledHash": "a87fe3f380a669a1c1cfead4… |
| B-04 | PASS | 二进制通道（exec-out 截屏） | {"bytes": 3151869, "rc": 0} |
| B-05 | PASS | 端口转发通道 | {"port": "50083", "listed": true, "rc": 0} |
| B-06 | PASS | 日志通道（logcat 回读） | {"marker": "dvlog9ab97e264b", "matched": true, "logWriteRc": 0} |
| B-07 | PASS | 包管理通道（pm path） | {"out": "package:/data/app/~~EkLkzOfuVj_Hxh2WUIifNw==/space.alliswell.inbox-0YeUy8YTiyy_CWxXgRyL2A==/base.apk", "rc": 0} |
| F-01 | PASS | 设备能力（屏幕/电量/存储） | {"wmSize": "1080x2400", "wmDensity": "480", "batteryLevel": 100, "batteryStatus": "0", "dataFree": "79251928", "wakefulness": "Awake"} |
| F-02 | PASS | 应用安装与版本 | {"versionName": "1.0", "versionCode": "1", "targetSdk": "34", "minSdk": "22", "firstInstallTime": "2026-09-17", "lastUpdateTime": "2026-09-19", "apkPath": "/data/app/~~EkLkzOfuVj_Hxh2WUIifNw==/space.alliswell.inbox-0YeUy… |
| F-03 | WARN | 关键权限授予状态 | {"granted": {"POST_NOTIFICATIONS": true, "SCHEDULE_EXACT_ALARM": null, "USE_EXACT_ALARM": null, "USE_FULL_SCREEN_INTENT": true, "SYSTEM_ALERT_WINDOW": null, "RECEIVE_BOOT_COMPLETED": true, "WAKE_LOCK": true, "FOREGROUND_… |
| F-04 | PASS | 后台策略（appops / 电池白名单） | {"ops": {"POST_NOTIFICATION": "allow", "SYSTEM_ALERT_WINDOW": "ignore", "SCHEDULE_EXACT_ALARM": "default", "START_FOREGROUND": "allow", "WAKE_LOCK": "allow"}, "batteryWhitelisted": true} |
| F-05 | PASS | 通知渠道（3/3） | {"expected": ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"], "found": ["attention-alarm-v3", "attention-bridge-v2", "attention-alarm-guard"], "allChannelIds": ["10001", "10011", "10101", "110000",… |
| F-06 | PASS | 闹钟排程（dumpsys alarm） | {"entriesForPackage": 42, "frozenMarkers": 10, "sample": ["    RTC_WAKEUP #174: Alarm{27c34a4 type 0 origWhen 1789908660020 flags 3 windowLength 0 whenElapsed 130716187 maxWhenElapsed 130716187 repeatInterval 0 tag=*wala… |
| F-07 | PASS | 进程与冻结态 | {"pid": "11887", "cgroupFrozenHint": false, "cgroup": "5:net_prio:/\n4:memory:/apps/space.alliswell.inbox\n3:cpuset:/background\n2:cpu:/background\n1:blkio:/bg\n0::/apps/uid_10190/pid_11887"} |
| F-08 | PASS | 原生排程台账（shared_prefs） | {"entries": 0} |
| F-09 | PASS | Web 运行时 ready() | {"ready": true, "items": 30, "notify": true, "scheduled": 1, "hasLib": "object", "capacitor": true, "plugins": ["App", "AppSettings", "LocalNotifications", "CapacitorCookies", "WebView", "CapacitorHttp", "SystemBridge"]} |
| F-10 | PASS | 业务逻辑真机回归 | {"parseTriggerable": true, "makeItemHasId": true, "makeItemDeliveryMode": "alarm", "isDueNow": true, "quietHoursType": "boolean", "uid": true} |
| F-11 | PASS | 通知排程往返（写入类） | {"pendingAfterSchedule": [751195578, 130073715, 827967551, 1626975076, 99001, 699042348], "pendingAfterCancel": [751195578, 130073715, 827967551, 1626975076, 699042348]} |
| F-12 | PASS | 存储持久化往返（写入类） | {"persisted": true, "restored": true, "beforeCount": 30, "afterCount": 30} |
| D-01 | PASS | 结束时链路仍在线 | {"state": "device"} |
| D-02 | PASS | 全程链路掉线次数 | {"linkDrops": 0, "adbCalls": 54} |

> WARN = 环境限制导致无法判定，不算通过也不算失败；SKIP = 本次未启用。
