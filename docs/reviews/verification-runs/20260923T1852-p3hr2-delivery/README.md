# P3-H-R2 实施方自测与交付报告

**签署：实施方自测**（等待独立复验，不宣称独立 PASS）  
**交付批次**：P3-H-R2（收口 P3-H-R 独立复验两项限制：`unbindAll` worker 监听解绑与五层真实 intermediate 取证闭合）  
**交付时间**：2026-09-23 18:57  
**交付候选 APK**：`releases/candidates/20260923T1852-p3hr2-candidate/app-debug.apk`  
**候选 APK SHA-256**：`a0e192968a4e4c01ffbf959eb29fe81b39805a512acf4e6883af0a23be0c4a99`  

---

## 一、基线与现场状态保护

1. **Git 现场与零破坏保证**：
   - 当前工作区基于 `HEAD = origin/main = 3574824357dc7beb04cbd3e32aa413cd508e8484`；
   - 未执行 `git checkout`、`git stash`、`git reset`、`git clean`、`git commit`、`git push`；
   - 所有既有未跟踪文件、脏工作树及历史运行目录完整保留。
2. **历史候选与旧证据隔离**：
   - `releases/candidates/20260923T1719-p3h-candidate/app-debug.apk`（SHA-256: `6fd03728a329f05e6a3676718779a161a0863ba6c76c99f2511072050c9fada0`）保留未动；
   - `releases/candidates/20260923T1745-p3hr-candidate/app-debug.apk`（SHA-256: `dc1f21fe1578f4a8e8cc49eb0d4ed5a1e68fa4a1a521d2e19df667fc3e859554`）保留未动；
   - 历史证据目录 `20260923T1719-p3h-platform-extraction/`、`20260923T1726-p3h-independent-recheck/`、`20260923T1745-p3hr-delivery/`、`20260923T1756-p3hr-independent-recheck/` 完整保留未动。
3. **核心源码哈希基准**：
   - `app-core.js`: `12e841dcb401f584f17d3b0abf21d534315e0a6f89f515e172f38bdfe0c61e9e`（0 字节改动，严格与上一轮复验基线一致）；
   - `lib/app-platform.js`: `d4c22ee5fa2b8ea61ea8c82424dce31ce78420d9362e233567ab7a8a70d8b562`；
   - `sw.js`: `d69356a836781651e1cbd706f7e87f2f575a4c514d81d85cf10feffc976edbeb`（缓存版本推进至 `attention-inbox-v37`）；
   - 完整哈希台账见本目录 `source-hashes.json`。

---

## 二、两项遗留限制的修复与自测结果

### 1. 限制一修复：`unbindAll()` 时 worker `statechange` 解绑与世代隔离防护
- **根因分析**：
  在 P3-H-R 中，`reg.addEventListener("updatefound")` 触发后，若 `reg.installing` 存在，会为其挂载 `statechange` 监听；当调用 `unbindAll()` 时，仅移除了 `reg` 上的 `updatefound`，但遗漏了解绑已挂在 worker 上的 `statechange` 回调，且该回调未受 `swEpoch` 保护，导致在解绑后 worker 进入 `installed` 时仍会发送 `{ type: "SKIP_WAITING" }`。
- **实施变更**：
  1. 在 `lib/app-platform.js` 中新增模块私有状态 `installingWorker` 与 `workerStateChangeHandler`；
  2. 在 `registerPwa()` 的 `updatefound` 处理器中，若遇到新的 `installing` worker，先解绑旧 worker 的监听，再绑定新 worker，并在回调首行增加世代保护：`if (currentEpoch !== swEpoch) return;`；
  3. 在 `unbindAll()` 中，显式调用 `installingWorker.removeEventListener("statechange", workerStateChangeHandler)`，置空相关引用，并在入口递增 `swEpoch++`；
  4. 因 Web 模块内容变更，将 `sw.js` 预缓存推进至 `const CACHE = "attention-inbox-v37";`。
- **自测验证**：
  - **独立复验探针复测**：运行 `probe-unbind-statechange.js`，exit 0。
    ```json
    {"before":{"reg":1,"worker":1,"skipWaiting":0},"after":{"reg":0,"worker":0,"skipWaiting":0}}
    ```
    解绑后 `installed` 状态不再触发 `SKIP_WAITING`。
  - **变异测试扩展**：在 `scripts/verification/p3h-platform-tests.js` 增加变异 9（`mutant9_workerStateChangeNotUnboundOnUnbindAll`），当故意注释掉 `unbindAll()` 中的 worker 解绑时，测试变红；修复后 9/9 变异 100% 捕获，exit 0（详见 `p3h-platform-tests.log`）。

### 2. 限制二修复：五层资源核验使用真实 Gradle Intermediate 目录
- **根因分析**：
  上一轮实施方脚本误使用了不存在的 `.../mergeDebugAssets/public/` 路径，并在脚本中用 `inter_h or www_h` 替代，导致 35 条 `intermediate` 全为 `null`。
- **实施变更与验证**：
  1. 纠正为真实存在的 Gradle 中间构建路径：`android/app/build/intermediates/assets/debug/public/`；
  2. 编写 `verify-resources.py`，不包含任何兜底回退或 null 容忍逻辑；
  3. 对当前候选 APK 验证 35 个 Web 资源，5 层逐字节核对：
     - Layer 1: 源码根目录 (`/Users/qlyf/Developer/reminder/<file>`)
     - Layer 2: `www/<file>`
     - Layer 3: `android/app/src/main/assets/public/<file>`
     - Layer 4: `android/app/build/intermediates/assets/debug/public/<file>`
     - Layer 5: 候选 APK `assets/public/<file>`
  4. **核验结果**：**35/35 全部逐层一致**，0 处 mismatch，0 处 null，详见本目录 `resource-closure.json` 与 `verify-resources.log`（exit 0）。

---

## 三、完整自测与交付台账

| 验证项 | 验证命令/脚本 | 退出码 | 关键产物 / 证据 | 结果 |
| :--- | :--- | :---: | :--- | :---: |
| 1. 全量自动化测试 | `npm test` | 0 | `npm-test.log`, `npm-test.exit`（3039+ 断言全过） | PASS |
| 2. 平台模块与 9 变异测试 | `node scripts/verification/p3h-platform-tests.js` | 0 | `p3h-platform-tests.log`, `p3h-platform-tests.exit`（9/9 变异击中） | PASS |
| 3. SW 注册幂等与闭合探针 | `node probe-registration-closure.js` | 0 | `probe-registration-closure.log`（register=1/updatefound=1/message=1/controllerchange=1） | PASS |
| 4. Worker 解绑与世代探针 | `node probe-unbind-statechange.js` | 0 | `probe-unbind-statechange.log`（after: reg=0/worker=0/skipWaiting=0） | PASS |
| 5. 真实 Chrome 浏览器平台断言 | `python3 scripts/verification/browser-platform-check.py` | 0 | `browser-platform-check.log`（v37 缓存激活、平台 9 契约） | PASS |
| 6. 真实 Android 设备热验证 | `python3 scripts/verification/p3h-device-verify.py` | 0 | `device-verify.log`, `device-verify-summary.json`, `p3h-device-verify.png` | PASS |
| 7. 真实 Android 设备冷启动断言 | `am force-stop` + `p3h-device-verify.py` | 0 | `device-cold.log`（isNative=true, sysBridge=obj, appSettings=obj） | PASS |
| 8. 五层资源哈希逐层闭合 | `python3 verify-resources.py` | 0 | `resource-closure.json`（35/35 五层非空且哈希一致） | PASS |
| 9. 代码格式与 Git 冲突检查 | `git diff --check` | 0 | 终端检查无冲突、无非法空白 | PASS |

---

## 四、真实设备运行环境数据 (vivo V2238A, Serial: 10ACBF2D3D000RS)

- 在机 APK 路径：`/data/app/~~JHbUXyviOQ8WSaHIDut69g==/space.alliswell.inbox-DLb-zfhw18jF6WHR-OWz0A==/base.apk`
- 在机 APK SHA-256：`a0e192968a4e4c01ffbf959eb29fe81b39805a512acf4e6883af0a23be0c4a99`（与候选 APK 完全一致）
- CDP 实机断言结果：
  ```json
  {
    "ready": true,
    "hasPlatform": true,
    "hasAllContract": true,
    "contractLength": 9,
    "isNative": true,
    "hasSysBridge": true,
    "sysBridgeType": "object",
    "hasAppSettings": true,
    "appSettingsType": "object",
    "waitResult": true,
    "deferredPromptIsNull": true,
    "btnInstallHidden": true
  }
  ```

---

## 五、明确声明的 NOT_PERFORMED 项

1. **P4 跨版本离线原地升级**：未模拟从旧缓存版本（v36）断网直切 v37 的离线升级流程，属于 P4 范畴；
2. **物理声振与系统通知栏物理交互**：真机验证仅断言了原生桥绑定状态、无残留异常和无意外振动，未进行物理闹钟真实响铃拦截测试；
3. **P3-G-R 弹条遮挡重构**：未引入针对弹条 DOM 遮挡的额外布局改动。

---

## 六、交付物汇总

- 交付目录：`docs/reviews/verification-runs/20260923T1852-p3hr2-delivery/`
- 候选 APK：`releases/candidates/20260923T1852-p3hr2-candidate/app-debug.apk` (`a0e192968a4e4c01ffbf959eb29fe81b39805a512acf4e6883af0a23be0c4a99`)
- 实施工作已闭合，等待独立复验。
