# 真机部分：尚未执行（设备离线）

> **补记（2026-09-22 10:30 设备接回后）**：本清单**已执行完毕**，结果归档在
> `../20260922T1030-p2cr2-device-recheck/`（该 run 的 `device-test-log.md` 逐条对应本文件的清单）。
> 本文件下面的内容是**当时**的原始状态记录，**不改写**；结论以新 run 为准。
> 两条关键差异：① 后台回收 `am kill` 仍造不出来（如实 NOT_PERFORMED，已补 AMS 绑定取证）；
> ② IDB 故障注入**改用磁盘层路线做成了**（改 `CURRENT` 指向不存在的 MANIFEST，不动 APK），
> 拿到了修复前 `loaded/writesAllowed=true/生成待回放凭据` 与修复后
> `failed/writesAllowed=false/无凭据` 的真机 A/B。

本文件是**待填**的。设备接回后按下面的脚本跑，结果逐条追加到这里。

## 现状

- `adb devices` 空列表；`system_profiler SPUSBDataType` 无 Android 设备。
- 候选 APK 已构建、逐字节比对通过，安装步骤**没有**执行。
- 因此本轮真机结论为 NOT_PERFORMED，详见 `not-performed.md`。

## 待跑清单（脚本已备好）

```bash
PKG=space.alliswell.inbox.exportrecheck
ADB=~/Library/Android/sdk/platform-tools/adb
RUN=docs/reviews/verification-runs/20260922T0055-p2cr-mirror-failclosed
CAND=releases/candidates/20260922T0055-p2cr-mirror-failclosed/attention-inbox-p2cr-mirror-failclosed-debug.apk

# 1) 安装前：存储基线（文件级 + 记录级）
bash scripts/verification/device-storage-hash.sh $PKG "A-install-before" | tee $RUN/device-storage-A-preinstall.txt

# 2) 安装候选包
$ADB install -r -d "$CAND"

# 3) 包身份：确认未重装 / 未清数据（firstInstallTime、lastUpdateTime、dataDir、userId）
$ADB shell "dumpsys package $PKG" | grep -E "versionCode=|versionName=|firstInstallTime|lastUpdateTime|userId=|dataDir=" | tee $RUN/package-identity.txt

# 4) 安装后、未启动
bash scripts/verification/device-storage-hash.sh $PKG "B-install-after" | tee $RUN/device-storage-B-postinstall.txt

# 5) 多轮 force-stop → 冷启动（每轮三时点：启动前 / 进程死亡后未启动 / 恢复完成后）
bash scripts/verification/p2cr-coldstart-rounds.sh "$RUN" 3 | tee $RUN/device-coldstart-rounds.txt

# 6) SIGKILL（后台回收的真机手段）
bash scripts/verification/p2cr-kill-modes.sh "$RUN" | tee $RUN/device-kill-modes.txt
```

## 本轮最想答的那个问题

上一轮查实「每次冷启动都产生一次权威提交」：WAL（`000003.log`）每轮稳定 +3276 B
（= 2 × 1638 字节的状态 JSON），而记录内容不变。这次修的是它的根因
（`migrateItem` 幂等），所以待跑清单里额外要钉一条：

> **连续两次冷启动，第二次冷启动后 WAL 大小不应增长**（「同一份内容不该被重写一遍」）。

自动化侧已有同义断言（B6「连续第二次冷启动不再产生任何提交 puts=0」），
真机侧需要这一条来证明它在真实 WebView / leveldb 上同样成立。
