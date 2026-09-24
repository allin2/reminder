# 真机部分：已执行（设备接回后补跑）

本文件是修复轮 `20260922T0055-p2cr-mirror-failclosed` 留下的**待填**清单。
设备 `QSKFAE95CQEUJZ8L` 接回后，按下面这份清单逐条跑完，结果归档在
`docs/reviews/verification-runs/20260922T1030-p2cr2-device-recheck/`。
本文件只作**索引**，结论与原始输出以那个 run 为准。

## 执行环境

```bash
PKG=space.alliswell.inbox.exportrecheck
ADB=~/Library/Android/sdk/platform-tools/adb        # 不在 PATH 里，必须用绝对路径
RUN=docs/reviews/verification-runs/20260922T1030-p2cr2-device-recheck
CAND=releases/candidates/20260922T0055-p2cr-mirror-failclosed/attention-inbox-p2cr-mirror-failclosed-debug.apk
```

## 清单执行情况

| # | 步骤 | 结果 | 输出文件（在新 run 目录） |
|---|---|---|---|
| 1 | 安装前存储基线（文件级 + 记录级） | 完成 | `device-storage-A-preinstall.txt`、`device-wal-A-preinstall.txt`、`idb-record-A-preinstall.txt`、`state-raw-preinstall.json` |
| 2 | 安装候选包（`adb install -r -d`） | 完成 | `install-output.txt` |
| 3 | 包身份（未重装 / 未清数据） | 完成：`firstInstallTime` 未变 | `package-identity.txt`、`package-identity-final.txt` |
| 4 | 安装后、未启动的基线 | 完成 | `device-storage-B-postinstall.txt`、`device-wal-B-postinstall.txt` |
| 5 | 多轮 `force-stop → 冷启动`，每轮三时点 | 完成：3 轮，`OVERALL=PASS` | `device-coldstart-rounds.txt`、`wal-delta-round-1..3.txt` |
| 6 | SIGKILL 终止 | 完成：PASS | `device-kill-modes.txt` |
| 6b | 后台回收（`am kill`） | **NOT_PERFORMED**（AMS 拒绝杀，见下） | `device-kill-modes.txt` |
| 7 | 真机 IDB 故障注入 | 完成（改了注入路线，见下） | `fault-injection/`（7 个文件） |
| 8 | 清理设备临时文件 | 完成（`/data/local/tmp/p2cr2-inject` 已删；`/sdcard` 无本轮残留） | — |

## 本轮最想答的那个问题：有了答案

> **连续两次冷启动，第二次冷启动后 WAL 大小不应增长。**

设备上实测：WAL **每轮仍然 +19 B**，但把那 19 字节解开是
`crc32c(4) | len=0x0c(2) | type=1(1) | seq=548(8) | count=0(4)`
—— **`count=0` 的空 WriteBatch**，零键操作、序号不前进，是 leveldb 在 `reuse_logs`
恢复路径上追加的「日志已复用、恢复点在此」标记。

⇒ 「字节不增长」这条**问法本身**是错的（它把无害标记算成了提交）。
正确的判据是 **WriteBatch 里的操作条数**，本轮已实现为
`scripts/verification/idb-wal-delta.py`（`OPS=0` = 无提交；`OPS>0` = 真提交，退出码 2）。
按 `OPS` 判：**3 轮全部 `OPS=0`**；修复前那种 `count=2` 的「写回同值」提交在这套判据下照样报红
（用同一条 WAL 里 `count=5` / `count=4` 的真实批量做了对照，退出码都是 2）。

## 两处与清单不同的地方（都要记下来）

### ① 后台回收：仍造不出来，如实记 NOT_PERFORMED

`am kill` / `am kill-all` 都拒绝执行。本轮补上了**实机取证**：

```
* ServiceRecord{…  space.alliswell.inbox.exportrecheck/org.chromium.content.app.SandboxedProcessService0:0  c:…}
        ConnectionRecord{… CR IMP space.alliswell.inbox.exportrecheck/…:0:@… flags=0x80000041}
        ConnectionRecord{… CR WPRI space.alliswell.inbox.exportrecheck/…:0:@… flags=0x80000021}
```

应用进程持有到**自己的 WebView renderer** 的绑定（`0x80000041` = BIND_IMPORTANT|BIND_AUTO_CREATE），
`dumpsys activity processes` 里也可见 `packageDependencies={com.google.android.webview}` ⇒
AMS 视其为「不可安全杀」。等价路径由内核 SIGKILL 覆盖（LMK/后台回收的终止手段同样是 SIGKILL）。

### ② IDB 故障注入：换了一条路线，**做成了**

原清单说「不改包注入不了」⇒ 记为 NOT_PERFORMED。本轮换到**磁盘上的 leveldb**：
把 `CURRENT` 改成指向不存在的 `MANIFEST-000099`（只动这 1 个文件，装数据的 `000003.log` 一个字节没碰），
`indexedDB.open` 即失败。**APK 不改**，因此不影响与源码的等价性，事后退回备份完全复原。

同一注入打在两个包上：

| 观测量 | 修复前 `314321a2…` | 修复后 `62e5c876…` |
|---|---|---|
| `status` | `loaded` | **`failed`** |
| `writesAllowed` | `true` | **`false`** |
| 恢复面板 | 无 | **有且可见** |
| 待回放凭据 | **已生成**（2809 字符） | **无** |
| 试写一次 `saveAsync()` | 不抛错 | 抛 `state-authority-failed`，`blockedWriteCount` 0→1 |

复原后逐文件核对 **VERIFY=PASS**（IDB 与镜像各 5/5 文件逐字节一致），再启动两次均
`loaded/authoritative`、内容哈希仍是 `0625aacabcd5068a`。

## 顺带修掉的一个真机假故障

`adb forward` 建好、socket 也在、`pidof` 有 pid，但 `GET /json` **10 秒超时**。
真因不是代理、不是设备掉线：**应用退到了后台**，WebView 的 devtools 服务器此时不接受新连接。
把 Activity 提到前台（`am start`，幂等）后立刻 200。
⇒ 三个复验脚本已改为**每次 CDP 读取前先无条件 `am start`**（原来只在「进程不存在」时才启动，
漏掉了「进程在、但在后台」这第三种状态）。这条已写进设备验证 skill。
