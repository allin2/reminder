# P3-H-R2 独立复验

**结论：P3-H-R2 范围 PASS。** 上轮两项限制均已闭合：`unbindAll()` 移除已挂载的 worker `statechange` 监听，并用世代检查阻止已排队的旧回调；五层资源表使用真实 Gradle debug intermediate，35 项均有非空哈希且逐字一致。此结论绑定本 run 所述源码、候选 APK 与设备，不覆盖 P4 离线跨版本升级或物理闹钟投递。

## 身份与现场

- `HEAD=origin/main=3574824357dc7beb04cbd3e32aa413cd508e8484`。工作区既有修改和未跟踪文件保留；本 run 只新增独立证据，不修改产品源码、旧候选或旧证据，不执行 checkout/stash/reset/clean/commit/push。
- 候选 `/Users/qlyf/Developer/reminder/releases/candidates/20260923T1852-p3hr2-candidate/app-debug.apk` SHA-256 `a0e192968a4e4c01ffbf959eb29fe81b39805a512acf4e6883af0a23be0c4a99`；设备 `10ACBF2D3D000RS` 的在机 `base.apk` SHA-256 相同。旧 P3-H/P3-H-R 候选仍分别为 `6fd03728a329f05e6a3676718779a161a0863ba6c76c99f2511072050c9fada0`、`dc1f21fe1578f4a8e8cc49eb0d4ed5a1e68fa4a1a521d2e19df667fc3e859554`。实施方 `source-hashes.json` 的 14 项在本 run 独立复算 0 偏差，见 `identity.json`。

## 独立复算

1. 上轮原样反例 `probe-unbind-statechange.js`：`before reg=1/worker=1/skipWaiting=0`，`unbindAll()` 后 `reg=0/worker=0/skipWaiting=0`，exit 0。新独立探针 `probe-stale-worker-callback.js` 保存并在解绑后直接执行已排队的旧回调：当前源码发送次数 0；仅移除 worker 回调里的世代检查，发送次数变 1。模块正式测试九项变异均检出，exit 0。此前注册幂等/失败重试反例原样复跑 exit 0，`register/updatefound/message/controllerchange` 均为 1，失败后第二次注册成功。
2. `npm test` exit 0：unit 642、native 324、boot 917、smoke 266、regressions 730、parse 160，共 3039 项显式计数断言，另含模块专项测试。`git diff --check` exit 0。原始日志、退出码均在本目录。
3. 独立五层哈希复算使用 `android/app/build/intermediates/assets/debug/public/`；源码、`www`、Android assets、真实 debug intermediate、APK 内资源 35/35 逐字一致，0 缺失，见 `resource-closure.json`。本轮实施方的 `verify-resources.py` 也不再以 `www` 哈希替代缺失中间层。
4. 真实 Chrome 生产页复跑验证 v37 SW 注册、激活、预缓存新模块与平台实例可用；独立真机 `am force-stop` 后冷启动，候选身份一致，`ready=true`、九项平台实例契约齐全、原生平台及桥检查通过。未重装设备应用。

## 浏览器脚本时序记录

第一次独立运行 `browser-platform-check.py` exit 1，唯一不满足项为 `initialBtnHidden=false`；同次 `ready=true`、v37 SW 已激活、预缓存命中、后续模拟安装提示与状态清理均正确。该按钮在 HTML 中带 `hidden`，但真实 Chrome 可能在脚本采样前自行派发 `beforeinstallprompt`，使它先行显示；隔离后重跑 exit 0。原始失败及重跑日志均保留。故该脚本的“采样时按钮必隐藏”断言有时序不稳定性，不作为产品修复失败证据；后续维护宜改为受控事件前后状态断言。其 `pwaStatusUpdates` 变量仍未被输出或断言，不能据此声称真实 Chrome 网络事件次数已验证；模块测试覆盖该计数。

## 仍未执行

- P4 旧 SW 缓存→v37 的真实断网/重连就地升级：`NOT_PERFORMED`。
- 真机物理响铃、振动、通知栏动作及 P3-G-R 自然弹条遮挡点击：`NOT_PERFORMED`；平台桥对象存在不替代这些行为证据。
