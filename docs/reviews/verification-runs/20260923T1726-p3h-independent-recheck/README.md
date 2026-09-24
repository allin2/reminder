# P3-H 平台模块独立复验

结论：**PASS_WITH_LIMITATIONS**。本批次的平台单源迁移、生产装配、失败闸门、浏览器正常注册及当前候选的 Android 冷启动均通过独立复测。发现一项重复注册边界缺口；它不在当前正常冷启动路径上，但应用启动在注册 PWA 之后异常并重试时可能触发，建议单独收口。P4 离线跨版本升级不在本结论内。

## 身份与现场

- 复验对象：`HEAD=origin/main=3574824357dc7beb04cbd3e32aa413cd508e8484` 上的现有脏工作区；未 checkout/stash/reset/clean/commit/push，未修改产品源码、旧证据或候选。
- 候选：`/Users/qlyf/Developer/reminder/releases/candidates/20260923T1719-p3h-candidate/app-debug.apk`，SHA-256 `6fd03728a329f05e6a3676718779a161a0863ba6c76c99f2511072050c9fada0`。设备 `10ACBF2D3D000RS` 在机包哈希逐字一致，复验时无需重装。`firstInstallTime=2026-09-23 15:38:35`、`lastUpdateTime=17:21:17`、`dataDir=/data/user/0/space.alliswell.inbox`。
- 产品源码与候选哈希见 `source-hashes.json`。

## 独立结果

1. `npm test` exit 0：unit 642、native 324、boot 916、smoke 266、regressions 730、parse 160，合计 3038 个显式计数断言，另含各模块测试。P3-H 缺脚本、空命名空间、工厂抛错及九项实例 API 缺失反例均由生产组合测试覆盖；五项模块变异独立重跑全部变红。原始日志和退出码保留。
2. `production-scripts.packagingProblems()` 返回空；26 支按序脚本、30 个 SW 清单条目结构闭合。五层逐字节核对覆盖 **35 个 Web 文件**，源码、`www`、Android assets、debug intermediate、候选 APK 的哈希全部一致；记录见 `resource-closure.json`。实施方报告仅列四个文件的五层哈希，此处补齐全量。
3. 实施方 Chrome 生产页脚本独立重跑 exit 0，验证 Web 装配、安装提示与状态清理。另用独立 Chrome 临时 profile 走真实 `sw.js` 成功注册路径：注册对象与平台实例一致、worker 已激活、缓存名为 v35、`lib/app-platform.js` 已预缓存；见 `browser-sw-registration.log`。注册拒绝反例确认一次状态刷新、业务未被异常阻断、通知动作消息仍可转发；见 `probe-pwa-rejection.log`。
4. 设备在机包与候选一致；独立复跑平台 CDP 检查，随后 `am force-stop` 冷启动再跑：两次均 `ready=true`、九项实例契约齐备、原生判定/两项桥对象/桥等待为真、安装提示为空。原始结果见 `device-verify.log`、`device-cold.log` 与对应 JSON。此次未重新安装或更改 AppOps。
5. 静态复核：Capacitor 平台判定与 50ms 桥等待算法仅在 `lib/app-platform.js`；`app-native-coordinator.js` 和 `app-core.js` 使用依赖注入/转发。SW v35、`index.html`、smoke/regression/boot/production-scripts 链路同步。

## 限制与后续修复点

- **重复 `registerPwa()` 的更新监听器翻倍**：同一实例调用两次后，`sw.register` 为 2 次，registration 的 `updatefound` 监听器为 2 条；SW `message` 与 `controllerchange` 各为 1 条。原样源码运行的独立探针见 `probe-pwa-idempotency.js`/`.log`。正常 `startBusinessStartup()` 只执行一次；但若它在 `registerPwa()` 后异常、`startApp()` 重试，仍可能重复。实施方测试把第二次调用注释为 “idempotent call”，但只断言了后续消息效果，未计数这两处。建议让注册 Promise/注册对象的更新监听也幂等，并补原样重复调用和摘掉守卫的反例。此点按非阻断的生命周期边界缺口记录，不能称“所有 PWA 监听均防翻倍”。
- 实施方 Chrome 脚本将 `sw.js` 返回 404，故其结果不能支持 SW 成功注册结论；上面的独立 Chrome 脚本补了当前版本的正常成功路径，但**没有执行 v34→v35 真实离线就地升级**。P4 仍 `NOT_PERFORMED`。
- Chrome 脚本派发网络/可见性事件后未直接断言副作用次数；模块测试对网络、可见性及重复绑定做了精确计数，实际浏览器的副作用次数未测。Android 原生闹钟物理响铃与通知栏交互、P3-G-R 的自然弹条遮挡路径均 `NOT_PERFORMED`，不由平台桥对象存在推导 PASS。

本 run 只新增独立证据。`git diff --check` 退出 0。
