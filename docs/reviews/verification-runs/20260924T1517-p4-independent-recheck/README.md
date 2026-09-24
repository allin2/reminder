# P4 / Android 候选独立复验

结论：P4 桌面 Chromium 离线升级及故障回退 **PASS**；候选 Web 资源闭包 **PASS**；Android A15 **未闭合，不能签整体 PASS**。本 run 只写验收脚本与日志，未修改产品源码、候选 APK、手机数据或实施方证据。

## 身份

- HEAD = origin/main = `3574824357dc7beb04cbd3e32aa413cd508e8484`；工作区原有修改及未跟踪文件保留。
- 当前候选 `releases/candidates/20260924T1405-p4-device-candidate/app-debug.apk` SHA-256 `e14438de38b3ee05d678e15025d09c1adceebb51f67f3f8d954fb26488fe20c1`；`sw.js` SHA-256 `f22bb39e8d0c3146b8ab8de9265f89481c643a9891ac886e716052c68084d8f5`。
- 2026-09-24 实时只读 ADB：`10ACBF2D3D000RS` / vivo V2238A / Android 16，User 0 安装的 base.apk SHA 与候选相同，`firstInstallTime=2026-09-23 15:38:35`，`dataDir=/data/user/0/space.alliswell.inbox`。

## 独立复算

1. 历史夹具与冻结 APK：v40 夹具 41 个文件逐字节等于 U1 候选 `340975ff...`；v38 夹具 40 个文件逐字节等于 P3-I 候选 `c949ad28...`。两者各自 SW cache 名分别为 v40、v38。
2. `cross-version.log`：独立重跑 v40→v42、v38→v42；同 origin、持久 profile、真实 SW、离线读回事项，两组退出码 0。
3. `fault-injection.log`：独立重跑新模块 HTTP 500、既有模块 HTTP 500、连接中断，以及旧 install 逻辑变异；三组新逻辑在离线重载时 ready，旧逻辑 ready=false，退出码 0。
4. `cold-process.py` / `cold-process.log`：增加了实施方缺少的浏览器进程关闭后重开验证。v40→v42 更新后结束 Chrome 进程，用同一 profile 新起进程、网络与服务端双重断开；`ready=true`、controller=true、cache 仅 v42、IDB 隔离事项仍在。退出码 0。
5. `npm-test.log`：全量 `npm test` 退出码 0；643+324+84+935+266+730+160 = 3142，失败 0。`node --check sw.js` 与 `git diff --check` 退出码 0。
6. 独立逐字节检查 39 个产品 Web 资源：源码、www、Android assets、Gradle intermediate、候选 APK 均相同；候选 APK 与 Q2 候选的 Web 部分仅 `sw.js` 不同。

## Android 证据边界与缺口

- 实施方记录的三次 force-stop 后隔离事项三字段哈希相同，可支持该事项的持久化；不能代替安装前后整个 IDB 原始记录对比。其 `pre-install-device-backup.json` 是 localStorage 镜像与内存态快照，并非原始 IDB 备份；无清理后业务状态与安装前快照的独立比对。
- `03-notification-delivered-dumpsys-notif.txt` 有隔离标题、目标包、系统通知时间；`03-notification-delivered.png` 确有同标题全屏面板。这支持该轮系统发帖与可见面板，不证明物理声振、息屏穿透或冷进程唤醒。脚本只打印 `has_notif`，未断言它为 true；详情行是“正在处理”，并非送达完成证据。
- 脚本没有执行通知动作、回前台对账或 SAF 导出/导入，故 A15 中这些必需场景为 `NOT_PERFORMED`。
- “清理完成”不成立于保存的现场：脚本只 `state.items.splice` + `saveAsync()`，未走业务命令也没有验证原生通知取消；`04-final-clean.png` 仍显示隔离事项全屏面板，`04-final-clean-dumpsys-notif.txt` 仍有该事项通知。当前只读 dumpsys 未再见该通知，但不能据此改写当时的清理结论。
- 真机移动 Chrome PWA 安装及离线升级、物理声振、锁屏穿透、冷进程广播唤醒均 `NOT_PERFORMED`。

## 下一轮要求

沿用同一冻结候选，补一轮 A15 目标设备验收：安装前后权威记录级比对；隔离事项的通知动作与保存/重启结果；回前台对账；SAF；用业务命令清理并断言 IDB、通知、闹钟和屏幕无残留。每轮绑定同一事项的 id、reminderKey/trace token、时间、系统证据与截图。设备操作串行，不清数据、不覆盖候选和历史证据。若条件无法构造，逐项标 `NOT_PERFORMED`，不能签 A15 整体 PASS。
