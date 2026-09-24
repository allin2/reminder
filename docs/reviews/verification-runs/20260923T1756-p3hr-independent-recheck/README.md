# P3-H-R 独立复验

**结论：PASS_WITH_LIMITATIONS。** 原缺口的核心行为已收口：同一实例在途及成功后重复调用只发起一次 SW 注册、只绑定一条 `updatefound`，失败后可明确重试；当前候选的真实 Chrome 与 Android 启动成立。另发现一个只在显式 `unbindAll()` 后出现的残留 worker 回调，未证明会进入生产调用路径；实施方的“五层资源一致”表存在取证脚本错误，但本 run 用真实中间产物路径独立核验为 35/35 一致。P4 跨版本离线升级不在本结论内。

## 身份与保护

- `HEAD=origin/main=3574824357dc7beb04cbd3e32aa413cd508e8484`；现有脏工作区保留，未 checkout/stash/reset/clean/commit/push，未改产品源码或旧证据、候选。
- 复验候选：`/Users/qlyf/Developer/reminder/releases/candidates/20260923T1745-p3hr-candidate/app-debug.apk`，SHA-256 `dc1f21fe1578f4a8e8cc49eb0d4ed5a1e68fa4a1a521d2e19df667fc3e859554`。真机在机 `base.apk` 哈希一致；旧 P3-H 候选哈希仍为 `6fd03728a329f05e6a3676718779a161a0863ba6c76c99f2511072050c9fada0`。
- `identity.json` 复算实施方列出的 13 项源码/产物 SHA-256，0 项偏离；`app-core.js` 与上轮独立复验逐字一致。

## 独立执行结果

1. 独立 `probe-registration-closure.js`：在途重复与成功后重复均为 `register=1/updatefound=1/message=1/controllerchange=1`；第一次拒绝后，第二次注册成功。实施方 8 项模块变异测试独立重跑 exit 0，原始日志和退出码已存。
2. `npm test` exit 0：unit 642、native 324、boot 917、smoke 266、regressions 730、parse 160，共 3039 个显式计数断言，另含各模块专项测试。`git diff --check` exit 0。
3. 真实 Chrome 生产页脚本独立重跑 exit 0：v36 SW 注册、激活和平台模块预缓存均成立。真机候选 warm 与 `am force-stop` 后 cold 两次 CDP 检查均 `ready=true`，九项平台实例契约齐备，Android/桥判定为真；复验脚本检测到在机包与候选 SHA 一致，没有重装。
4. 独立五层核验使用实际 `android/app/build/intermediates/assets/debug/public/`：源码、`www`、Android assets、debug intermediate、候选 APK 的 **35 个 Web 文件哈希全部一致**，见 `resource-closure.json`。

## 证据修正与边界

- 实施方 `20260923T1745-p3hr-delivery/resource-closure.json` 的 35 条 `intermediate` **全部是 `null`**：脚本误用了 `.../assets/debug/mergeDebugAssets/public/`，并以 `inter_h or www_h` 替代缺失层，导致 `match=true`。该表只能证明其余四层，不能作为五层证据；本 run 的 `resource-closure.json` 用真实目录补证，不改写原报告。
- `scripts/verification/browser-platform-check.py` 中 `repeatPreservesReg` 仅比较重复调用前后的 registration 对象，不能计数 `register()` 或 `updatefound`；其 `pwaStatusUpdates` 变量未返回或断言。因此该浏览器脚本对“重复注册”和“网络副作用次数”的声称过强。核心次数由独立探针和模块测试证明；浏览器脚本只支持真实注册/缓存及所列 UI 状态。
- **新增非生产路径缺口**：若先发生 `updatefound` 并挂上 worker `statechange`，随后调用 `unbindAll()`，旧 worker 回调仍留存，之后 worker 进入 `installed` 仍发送 `SKIP_WAITING`。独立 `probe-unbind-statechange.js` 原样调用当前源码得到 `before.worker=1`、`after.worker=1`、`after.skipWaiting=1`，exit 2。当前仓库生产代码未调用 `unbindAll()`（仅测试使用），故不把它判作当前正常启动的阻断；不能宣称“解绑后所有 SW 回调失效”。如将 `unbindAll()` 用于未来生产恢复，须先保存并移除 worker 状态监听或加世代检查，并补变异反例。
- P4 旧缓存→v36 真实离线就地升级、原生闹钟声振/通知栏物理交互、P3-G-R 自然弹条遮挡路径均 `NOT_PERFORMED`。
