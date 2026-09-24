# 本轮 NOT_PERFORMED

本轮只记录**没有做**的事。凡真做了的、以及做了一半的，都不在这里充数。

## 1. 真机冷启动 / 真机故障注入（最重要的一条）

- 状态：**NOT_PERFORMED**。
- 原因：本轮执行到「构建候选 APK」完成时，`adb devices` 已返回空列表，
  `system_profiler SPUSBDataType` 里也没有任何 Android 设备。上一轮同一台
  设备（QSKFAE95CQEUJZ8L）跑完真机收口之后连接断开，本轮未能恢复。
- 影响范围：以下都没有做，也不声称做了 ——
  - 修复后候选包的真机冷启动三时点哈希；
  - 「每次冷启动都写一次权威提交」（WAL +3276 B/轮）是否在真机上消失；
  - 真机 `force-stop → 冷启动` 多轮；
  - 真机 IndexedDB `open/get` 故障注入。
- 上一轮（`20260921T2355-p2cr-authority-gate`）那 6 次冷启动**只代表修复前代码**，
  不升级为本轮 PASS。

## 2. 真机上的 IndexedDB open / get 故障注入

- 状态：**NOT_PERFORMED**（且即使设备在线也不可用）。
- 原因：不改动 APK 就无法在冷启动前注入 WebView 层的 IDB 故障，而改包即失去与源码的等价性。
- 替代证据：同源生产组合 harness 的双启动反例（B6），`get` 失败与 `open` 失败**分别**覆盖，
  并配 M12 变异对照证明断言有牙齿。

## 3. 后台回收（AMS 杀进程）

- 状态：**NOT_PERFORMED**（沿用上一轮结论，未重跑）。
- 原因：`am kill` / `am kill-all` 都杀不掉该进程 —— 它与 WebView 的 sandboxed 进程有绑定，
  AMS 判为不可安全杀。上一轮已实测并记录。
- 替代手段：内核 SIGKILL（`run-as <pkg> kill -9`）作为等价终止手段。

## 4. 桥初始化失败的真机注入

- 状态：**NOT_PERFORMED**（沿用上一轮结论）。
- 原因：要在冷启动时让原生桥不可用就得改包。
- 替代证据：组合 harness 的 `faults` 注入（8 条断言），含「桥故障 + 权威读失败」叠加场景。

## 5. 「导入格式安全面」

- 状态：**NOT_PERFORMED**（按裁决顺延）。
- 原因：裁决要求 P2-C-R 修复并通过独立复验后才能开始，本轮还在 P2-C-R 上。

## 6. 提交 / 推送

- 状态：**NOT_PERFORMED**。HEAD 仍为 `3574824`，工作区保持脏条目交付状态。
