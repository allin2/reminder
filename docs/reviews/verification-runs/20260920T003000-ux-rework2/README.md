# 二次返工证据目录 · 20260920T003000-ux-rework2

对应报告：[`../../user-experience-three-priorities-rework2-20260920T003000.md`](../../user-experience-three-priorities-rework2-20260920T003000.md)

本轮起点是**第二次独立复验**判 **FAIL / FIX_REQUIRED** 的那份报告
（[`../../user-experience-three-priorities-independent-recheck-20260920.md`](../../user-experience-three-priorities-independent-recheck-20260920.md)），
它列出 3 个遗漏分支（R-F06 / R-F03 / R-F07）并对 SW 缺口作出裁决。

**两轮失败证据都原样保留、未被本目录覆盖：**

| 轮次 | 判决 | 报告 | 证据目录 |
|---|---|---|---|
| 首次独立验收 | FAIL（F01–F08） | `../../user-experience-three-priorities-independent-acceptance-20260919.md` | `../20260919T234129-ux-independent/` |
| 第一次返工 | 复验仍 FAIL（X1/X2/X4 + SW） | `../../user-experience-three-priorities-independent-recheck-20260920.md` | `../20260920-ux-independent-recheck/` |
| 第二次返工（本轮） | 待复验 | 见上方链接 | 本目录 |

## 目录内容

| 文件 | 是什么 | 怎么复现 |
|---|---|---|
| `npm-test.log` | `npm test` 全量四套件输出，**1572/1572**，退出 0 | `npm test` |
| `extended-probes.cjs` / `extended-results.json` / `extended-run.log` | 上一轮复验的 X1/X2/X4 反例探针，**逐字节复制**过来重跑（sha256 与来源目录一致），本轮应全 pass | `node extended-probes.cjs` |
| `probes.cjs` / `probe-results.json` / `probe-run.log` | 更早那批独立探针，同上逐字节复制 | `node probes.cjs` |
| `sw-probe.cjs` / `sw-result.json` / `sw-run.log` | SW 缺口探针（预缓存是否含原生桥、脚本离线是否回落成 HTML） | `node sw-probe.cjs` |
| `reverse-selfcheck.py` | 反向自检：10 处最小缺陷注入 → 目标断言必须变红 → 逐字节还原 | `python3 reverse-selfcheck.py` |
| `reverse-selfcheck.json` | 上面那次的结果：10/10 `RED_AS_EXPECTED` + `RESTORE: BYTE_IDENTICAL` | — |
| `selfcheck-backup/` | 注入前的源码备份（还原用，也是还原判据的来源） | — |
| `selfcheck-original-sha256.json` | 注入前 3 个生产文件的 sha256 | — |
| `apk-web-assets.sh` / `apk-web-assets.txt` | 从**候选 APK** 里解出 `assets/public/`，与工作区源码逐字节 `cmp` | `bash apk-web-assets.sh <apk>...` |
| `identity.js` / `identity.json` | 本轮 HEAD / 脏条目数 / 源码与 Java 哈希 / 候选 APK 哈希 / **相对上一轮失败候选**的源码变化 | `node identity.js`（须先跑 `apk-web-assets.sh`） |
| `REDACTION-MANIFEST.json` | 证据脱敏清单（沿用仓库既有约定） | — |

## 读这个目录时要注意的边界

- 这里全部是**行为/源码层证据**。真机投递、自然冷进程、重启、跳设置页、OEM 对照
  仍然 **NOT_PERFORMED**（原因见报告 §7），不要把这些日志读成「设备链路已验证」。
- 反向自检的「变红」判据是**失败清单里出现目标断言**（JS 侧 `✗ ` 前缀，Android 侧 `FAILED` 后缀），
  不是「输出里出现过这个字符串」—— 后者会命中同名的通过行，第一版就是这么误判的。
- **本轮未改任何 Java**，所以反向自检里没有 Gradle 条目（`reverse-selfcheck.json` 的
  `java_injections: 0` 是刻意登记的，避免被读成「跳过了没做」）。Java 未改这一事实由
  `identity.json` 的 `changedJavaVsFailedRound` 核验。
- 沙箱内批量删除有阈值护栏，`bash scripts/android-build.sh both` 因为 `npx cap sync` 会撞上，
  需要在沙箱外执行；这不影响产物内容，但会让「在沙箱里复现构建」失败。
- `extended-probes.cjs` / `probes.cjs` / `sw-probe.cjs` 是**从复验目录复制**的，不是本轮的产物；
  保留它们是为了让「同一批反例、同一份探针」这件事可复算（sha256 见 `identity.json` 之外的
  `shasum` 记录）。
