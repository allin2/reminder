# 本轮 NOT_PERFORMED

本文件只记录**没有做**的事。凡真做了的、以及做了一半的，都不在这里充数。
（「做了但不合格」不属本文件，属 README 的 FAIL 面 —— 本轮没有 FAIL 项。）

## 1. 后台回收（AMS 杀进程）终止方式

- 状态：**NOT_PERFORMED**。
- 原因：`am kill <pkg>` 与 `am kill-all` 都**拒绝执行**，进程仍活。本轮补了实机取证：
  应用进程持有到自身 WebView renderer 的绑定
  `ServiceRecord{… /org.chromium.content.app.SandboxedProcessService0:0}` /
  `ConnectionRecord{… flags=0x80000041}`（BIND_IMPORTANT｜BIND_AUTO_CREATE），
  `dumpsys activity processes` 亦可见 `packageDependencies={com.google.android.webview}` ⇒
  AMS 视其为「不可安全杀」。
- 影响范围：这条终止方式下的三时点复验**没有做**，不冒充 PASS。
- 替代证据：内核 SIGKILL（`run-as <pkg> kill -9`）本轮实测 **PASS**，
  且死亡窗口静止、记录级哈希 A==C、事件后判定 `loaded/authoritative`。
  LMK/后台回收的终止手段同样是 SIGKILL，故等价路径已覆盖。

## 2. WebView（JS）层的 IDB 故障注入

- 状态：**NOT_PERFORMED**（本轮改用磁盘层注入替代，见 README §3.7）。
- 原因：要在冷启动**之前**让页面里的 `indexedDB.open/get` 失败，必须往 APK 里塞补载脚本，
  改包即失去与源码的等价性。
- 替代证据：磁盘层注入（把 `CURRENT` 指向不存在的 MANIFEST）让 `indexedDB.open` 真的失败，
  且不动 APK；`get` 失败的独立分支由离线永久反例 B6（`get`/`open` 两种故障分别覆盖）+ M12 变异覆盖。

## 3. 「空镜像 + 空内存」的破坏性变体（IDB 1/1 → 0/0）

- 状态：**NOT_PERFORMED**。
- 原因：本轮的注入只让权威打不开，镜像仍是好的（`mirrorLen=2443`），因此内存里留下了可只读的旧数据，
  没有复现「两个存储同时归零」。要复现还得**同时清空镜像**，那会让测试机的数据真的归零。
  不做破坏性注入 —— 保留现场优先。
- 替代证据：离线永久反例 B6 的双启动分叉（IDB 两条 / 镜像一条，`get` 与 `open` 各一组），
  以及 M12 变异（把两条升格路径拧回 `LOAD_LOADED` 并拆掉凭据来源守卫后，覆盖重新出现）。

## 4. 修复前那次注入之后的「凭据回放」时序

- 状态：**NOT_PERFORMED**。
- 原因：修复前那次注入确实留下了 `attention-inbox-v2-pending-replay`（2809 字符）；
  若保持它不动、先复原权威再启动，会在健康启动时被回放。但那份快照的**内容与权威一致**
  （`mirrorSha16 == 0625aacabcd5068a`），回放观测不到任何数据差异，证据价值低；
  为让测试机回到干净状态，复原时把镜像目录一并还原（凭据随之移除）。事实已记录，链路由 B6 覆盖。

## 5. 「导入格式安全面」

- 状态：**NOT_PERFORMED**（按裁决顺延）。
- 原因：裁决要求 P2-C-R 通过独立复验后才能开始。本轮是 P2-C-R 的设备侧复验。

## 6. 提交 / 推送

- 状态：**NOT_PERFORMED**。HEAD 仍为 `3574824`，工作区保持脏条目交付状态。

## 7. 独立验收

- 状态：**NOT_PERFORMED**。本轮是**实施方**的设备侧复验，不构成独立验收；
  同一份协议需由独立方复跑（尤其 §3.7 的注入路线与 §3.3 的 `OPS` 判据）。
