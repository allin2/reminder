# 返工证据目录 · 20260919T235500-ux-rework

对应报告：[`../../user-experience-three-priorities-rework-20260919T235500.md`](../../user-experience-three-priorities-rework-20260919T235500.md)

本轮返工的起点是独立验收判 **FAIL / FIX_REQUIRED**、列出 F01–F08 八个问题的那份报告
（[`../../user-experience-three-priorities-independent-acceptance-20260919.md`](../../user-experience-three-priorities-independent-acceptance-20260919.md)）。
该失败报告与它自己的证据目录 `../20260919T234129-ux-independent/` **原样保留，未被本轮覆盖**。

## 目录内容

| 文件 | 是什么 | 怎么复现 |
|---|---|---|
| `npm-test.log` | `npm test` 全量四套件输出，**1517/1517**，退出 0 | `npm test` |
| `android-unit-rerun.log` | Android 单测真实重跑（`--rerun-tasks`，66 个 task 全部执行，非缓存） | 见下 |
| `android-results.json` | 上面那次重跑的逐类结果：22 条、0 失败 | — |
| `reverse-selfcheck.py` | 反向自检脚本：9 处最小缺陷注入 → 断言必须变红 → 逐字节还原 | `python3 reverse-selfcheck.py` |
| `reverse-selfcheck.json` | 上面那次的结果：9/9 `RED_AS_EXPECTED` + `RESTORE: BYTE_IDENTICAL` | — |
| `selfcheck-backup/` | 注入前的源码备份（还原用，也是还原判据的来源） | — |
| `selfcheck-original-sha256.json` | 注入前 4 个生产文件的 sha256 | — |
| `apk-web-assets.sh` / `apk-web-assets.txt` | 从**候选 APK** 里解出 `assets/public/`，与工作区源码逐字节 `cmp` | `bash apk-web-assets.sh <apk>...` |
| `lib-registration.js` / `lib-registration.json` | 「新增 `lib/*.js` 必须挂四处」的核对，并区分「已接线」与「尚未接线」 | `node lib-registration.js` |
| `identity.json` | 本轮 HEAD / 脏条目数 / 源码与 Java 哈希 / 候选 APK 哈希 / 相对失败轮的源码变化 | — |

复现 Android 单测（本机 JDK 17 Temurin）：

```sh
cd android && JAVA_HOME=~/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
  ./gradlew :app:testDebugUnitTest --offline --rerun-tasks
```

## 读这个目录时要注意的边界

- 这里全部是**行为/源码层证据**。真机投递、自然冷进程、重启、跳设置页、OEM 对照
  仍然 **NOT_PERFORMED**（原因见报告 §8），不要把这些日志读成「设备链路已验证」。
- `--rerun-tasks` 是刻意的：不加它 Gradle 可能直接 `UP-TO-DATE`，拿到的是缓存而不是本次结果。
- 反向自检的「变红」判据是**失败清单里出现目标断言**（JS 侧 `✗ ` 前缀，Android 侧 `FAILED` 后缀），
  不是「输出里出现过这个字符串」—— 后者会命中同名的通过行，第一版就是这么误判的。
- 沙箱内批量删除有阈值护栏，`bash scripts/android-build.sh both` 因为 `npx cap sync` 会撞上，
  需要在沙箱外执行；这不影响产物内容，但会让「在沙箱里复现构建」失败。
