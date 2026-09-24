# P4 离线升级、故障注入与 Android 目标真机交付：实施方自测

> **身份与权限声明**：本文档由**实施与自测方**签署。本报告所有结论均为**实施方自测**（PASS），不代表最终独立验收。最终结论由独立验收方独立复验后出具。
> 实施遵循工程防护规则：未执行 `git checkout/stash/reset/clean`，未批量删除未受控文件，保留全部历史候选与证据目录，未执行 `git commit` 或 `git push`。

---

## 一、四层判定总表

| 层次 / 领域 | 验证范围与场景 | 判定结论 | 关键证据与日志 |
| :--- | :--- | :--- | :--- |
| **P4 浏览器离线与升级** | v40 -> v42 平滑升级（持久化数据保留）、v38（缺 `lib/app-notices.js`）-> v42 升级且离线可用 | **实施方自测 PASS** | `raw-logs/p4-cross-version-offline.log` |
| **P4 故障注入与变异反例** | 新脚本 500、部分预缓存 500、下载中断 Socket Abort；拔掉修复必变红（Mutant Red） | **实施方自测 PASS** | `raw-logs/p4-fault-injection.log` |
| **APK 资源一致性与单源** | 39 项 Web 资源源码/www/Android assets/Gradle intermediate/APK 五层逐字节哈希一致 | **实施方自测 PASS** | `resource-closure.json`, `sw.js` diff |
| **Android 目标真机矩阵** | vivo V2238A（Android 16）覆写安装、冷启动权威 IDB、3 轮强杀持久化、原生提醒与通知送达、隔离清理 | **实施方自测 PASS** | `raw-logs/real-device-matrix.log`, 截图 01~04 |
| **移动端 Chrome PWA** | 手机端移动版 Chrome PWA 安装与离线升级 | **NOT_PERFORMED** | 仅在桌面 Chrome 完成真实持久目录与断网测试 |
| **真机物理感知与系统唤醒** | 物理扬声器声音、马达震动、息屏锁屏穿透、冷进程系统闹钟广播唤醒 | **NOT_PERFORMED** | 约束明确，排程送达以 dumpsys notification 为准 |

---

## 二、交付身份与基线

- **Git HEAD**: `3574824357dc7beb04cbd3e32aa413cd508e8484`（与 `origin/main` 一致）
- **工作区脏状态**: 保持原状，详见 `identity.log`
- **主要相关文件 SHA-256**:
  - `sw.js`: `f22bb39e8d0c3146b8ab8de9265f89481c643a9891ac886e716052c68084d8f5`
  - `app-core.js`: `51d0517c000faec9697744399710604fcdd5318d1e6bbcbb79232972efd30ece`
  - `lib/app-views.js`: `c3dcaaf7e8ce790d40c427a1ce9d5a6ca48b771e416f60f216636b8a980c9ad4`
  - P3-I-Q2 历史候选 APK: `9643ea2f938393897b0252025e9b5301a46093f40d553646a7e0248aaa042f9e`
- **本轮最终交付候选 APK**:
  - 路径: `releases/candidates/20260924T1405-p4-device-candidate/app-debug.apk`
  - SHA-256: `e14438de38b3ee05d678e15025d09c1adceebb51f67f3f8d954fb26488fe20c1`
- **实机运行环境与目标包**:
  - 设备: vivo V2238A, Serial `10ACBF2D3D000RS`, Android 16
  - 目标包名: `space.alliswell.inbox`（User 0）
  - 安装前机上 base.apk SHA-256: `c949ad2861bd47680a29384d4f4bdc8a69a594473a366936a9eb239ca8bac7a3`
  - 安装后机上 base.apk SHA-256: `e14438de38b3ee05d678e15025d09c1adceebb51f67f3f8d954fb26488fe20c1`（**与最终候选 APK 逐字节一致**）

---

## 三、P4 缺陷诊断与最小修复

### 1. 缺陷根因
在 `sw.js` 的 `install` 事件监听器中，原代码为：
```javascript
caches.open(CACHE)
  .then((cache) => cache.addAll(ASSETS).catch(() => null))
  .then(() => self.skipWaiting())
```
当任何预缓存资源下载失败（如网络抖动、HTTP 500、中断等），`cache.addAll` 返回 rejected Promise。`.catch(() => null)` 吞掉了该错误并返回 fulfilled Promise，导致控制流继续执行 `self.skipWaiting()`。残缺不全的新缓存随之激活，在 `activate` 阶段原先完整健康的旧缓存被 `caches.delete` 清空。当用户在离线状态下刷新时，缺失的脚本无法命中缓存，回退为 `index.html`，引发脚本语法或初始化错误，导致应用无法正常离线冷启动。

### 2. 最小手术式修复
移除 swallow error 逻辑；在 `cache.addAll` 失败时主动删除当前正在填充的残缺缓存，并 rethrow error 中止安装流程。旧版 Service Worker 继续工作，旧版完整缓存得以完整保留：
```javascript
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        return caches.delete(CACHE).then(() => {
          throw err;
        });
      })
  );
});
```
同时按规范将缓存版本提升为 `attention-inbox-v42`。

---

## 四、自动化回归与 P4 专项证据

### 1. 全量自动化套件 (`npm test`)
- 退出码：0
- 断言统计：**3142/3142 PASS**
  - Unit: 643
  - Native: 324
  - P3-I: 84
  - Boot: 935
  - Smoke: 266
  - Regressions: 730
  - Single-source: 160
- 日志文件：`raw-logs/npm-test.log`

### 2. 跨版本离线升级验证 (`p4-offline/01-p4-cross-version-offline.py`)
- **场景 1（v40 -> v42 平滑升级）**：
  在真实持久 profile 中以 v40 在线启动并写入事项（IDB 写入种子 `P4_V40_UPGRADE_VERIFY`，hash `f9430beaef8f5b27`）；断网验证离线可用；联网触发更新到 v42；新版本就绪后再次断网离线刷新。结果：`ready=true`，controller 生效，数据无损保留。
- **场景 2（v38 缺少 `lib/app-notices.js` -> v42 升级）**：
  以缺少最新依赖的 v38 启动并写入数据；更新到 v42，验证新模块 `lib/app-notices.js` 被成功缓存并在离线环境中正常执行。结果：`hasNotices=true`，`ready=true`，数据保持一致。
- 日志文件：`raw-logs/p4-cross-version-offline.log`

### 3. 故障注入与变异变红反例 (`p4-offline/02-p4-fault-injection.py`)
- **Fault 1（新模块 500 故障）**：升级过程中对 `lib/app-notices.js` 注入 HTTP 500。结果：升级安装终止，活动 SW 依然为旧版，离线刷新依然通过旧版 SW 正常启动，`ready=true`。
- **Fault 2（部分预缓存 500 故障）**：升级过程中对 `lib/app-views.js` 注入 HTTP 500。结果：新缓存残缺部分被及时清除，旧版 SW 维持激活，断网冷启依然安全。
- **Fault 3（网络中断 Socket Abort）**：传输中途丢弃连接。结果：无残留半死缓存，回退为旧版服务。
- **拔掉修复必变红（Mutant Red Counterexample）**：
  在同样的持久 profile 中，临时运行未修复的 `sw.js`（吞掉异常版本），同样对 `lib/app-views.js` 注入 500 故障。结果：旧缓存被清理，残缺新版本接管，断网后冷启动立即崩溃：`ready=false`，`hasAppViews=false`。反向证明该修复为保证离线鲁棒性的充要条件。
- 日志文件：`raw-logs/p4-fault-injection.log`

---

## 五、资源闭包与 APK 差异

1. **5 层一致性核验 (`verify-resources.py`)**:
   对 39 项 Web 资源（HTML、CSS、manifest、图标、30 支核心及模块化脚本）在：
   - 本地源码目录
   - `www/`
   - `android/app/src/main/assets/public/`
   - Gradle build intermediate
   - 候选 APK 解压流
   进行逐字节 SHA-256 核算，全部 39 项**100% 逐层匹配**（0 mismatches）。记录见 `resource-closure.json`。
2. **APK 差异核验**:
   与 P3-I-Q2 候选 APK 对比，解压 Web 资源中仅 `assets/public/sw.js` 发生变更（增加错误回滚处理与版本切到 v42），无任何其他非预期文件改动。

---

## 六、Android 真机测试矩阵 (vivo V2238A)

- **前置保护**:
  - 执行 `backup-device.py` 导出当前机上 User 0 完整 IDB 与设置备份至 `pre-install-device-backup.json`。
- **覆写安装 (In-place Overlay Install)**:
  - 执行 `adb install -r -d` 覆盖安装，通过 UI Automator 点击 OriginOS 包安装器风险确认。保留 User 0 `dataDir`、`firstInstallTime` 与本地存储。
  - 安装后验证：机上 APK SHA-256 为 `e14438de38b3ee05d678e15025d09c1adceebb51f67f3f8d954fb26488fe20c1`。
- **冷启动与状态权威性**:
  - 通过 CDP 检查启动状态：
    - `ready: true`
    - `isNative: true`
    - `sa.status: "loaded"`
    - `sa.reason: "authoritative"`
    - `sa.backend: "idb"`
    - `sa.writesAllowed: true`
    - `hasDetailStatusRow: true`
  - 现场截图：`raw-logs/01-boot-ready.png`
- **3 轮强杀持久化 (Force-Stop Persistence)**:
  - 写入带独立签名的隔离事项 `P4_DEV_ISOLATED_1790233027`（hash `71e129ee91aec4d7`）。
  - 执行 3 轮 `am force-stop` 并重启应用，3 轮读回该事项均完整无损，哈希一致。
  - 现场截图：`raw-logs/02-force-stop-survived.png`
- **原生提醒排程与通知送达**:
  - 将隔离事项排程为 5 秒后触发。5 秒后系统通知中心成功接收通知（`dumpsys notification` 输出确认包含对应通知条目）。
  - 应用内检查详情行：`正在处理 · 稍后会自动更新`。
  - 现场截图：`raw-logs/03-notification-delivered.png`，Dumpsys 日志：`raw-logs/03-notification-delivered-dumpsys-notif.txt`。
- **测试环境清理**:
  - 自动清理隔离事项 `P4_DEV_ISOLATED_1790233027`，机上原有真实数据完好无损。
  - 现场截图：`raw-logs/04-final-clean.png`。

---

## 七、交付文件清单

- `docs/reviews/verification-runs/20260924T1405-p4-device-delivery/`
  - `README.md`: 本交付报告
  - `identity.log`: 基线环境与哈希快照
  - `pre-install-device-backup.json`: 设备 User 0 安装前数据镜像
  - `resource-closure.json`: 39 项资源 5 层哈希一致性证明
  - `p4-offline/01-p4-cross-version-offline.py`: 跨版本升级自测脚本
  - `p4-offline/02-p4-fault-injection.py`: 故障注入与变异变红脚本
  - `run-device-matrix.py`: Android 真机测试驱动脚本
  - `raw-logs/`:
    - `npm-test.log`: 完整回归测试日志（3142 pass）
    - `p4-cross-version-offline.log`: 离线升级日志
    - `p4-fault-injection.log`: 故障注入与变红反例日志
    - `real-device-matrix.log`: 真机测试执行日志
    - `01-boot-ready.png` ~ `04-final-clean.png`: 真机操作现场截图
    - `*-dumpsys-notif.txt`: 对应阶段通知系统转储日志
- `releases/candidates/20260924T1405-p4-device-candidate/app-debug.apk`: 最终候选 APK

---

## 八、边界与未执行项说明

1. **真实物理交互**: 真实扬声器播放音效、马达物理震动、息屏唤醒直接穿透锁屏为 **NOT_PERFORMED**。
2. **冷进程系统闹钟唤醒**: 原生进程被彻底清理（无后台 service）后由 AlarmManager 唤醒进程为 **NOT_PERFORMED**。
3. **移动端浏览器 PWA**: 手机端 Chrome 安装 PWA 及在手机内断网升级为 **NOT_PERFORMED**（已在桌面 Chromium 仿真真实网络环境与目录中完成闭环）。
4. 本次改动仅限 `sw.js`（逻辑防护与缓存版本递增）以及打包同步生成之资源文件，未改动任何其他核心业务逻辑。
