# 三处证据脚本缺口修复（冻结 checkpoint 前）

- run：`20260922T1130-evidence-script-gaps`
- 启动：`2026-09-22T11:31:40+0800`；结束：`2026-09-22T11:37:35+0800`
- 身份：实施方（本轮**只修证据脚本**，不动产品源码）
- 上游依据：独立复验 `20260922T110036-independent-p2cr2-recheck` 的第 7 节 T1 / T2 / T3
  ——「不要求回滚产品结论，但应在冻结 checkpoint 前完成并复跑其各自反例」
- 本轮范围：修 T1 / T2 / T3 三个脚本缺口 + 复跑各自反例。**不提交、不推送、不改产品源码**。

## 1. 结论

T1、T2、T3 三项**已修复并各自复跑反例**，均为「修复前必红、修复后转绿」的有牙齿对照。

| 缺口 | 文件 | 状态 |
|---|---|---|
| T1 变量紧邻全角标点 ⇒ `set -u` unbound variable | `scripts/verification/p2cr-coldstart-rounds.sh` | ✅ 已修，UTF-8 locale 下真机跑完 3 轮 |
| T2 WAL 判据只解析 `recs[0]` ⇒ 漏掉空标记后的真实写 | `scripts/verification/idb-wal-delta.py` | ✅ 已修，遍历汇总 + fail closed |
| T3 `verify` 不检查额外文件 ⇒ 目录残留仍 PASS | `scripts/verification/p2cr-idb-fault-inject.sh` | ✅ 已修，文件名集合双向差集 |

## 2. T1：变量紧邻全角标点

### 根因

脚本正文用全角标点（`（）：`）写说明，变量引用写成裸 `$VAR` 且紧跟全角字符时，
bash 在 UTF-8 locale（`LC_CTYPE` ≠ `C`）下把多字节字符当作变量名的合法字符，
于是去查一个不存在的变量名 ⇒ `set -u` 下直接 `unbound variable` **并中断脚本**。

**这是环境相关的静默失败**：沙箱日常是 `LC_CTYPE=C`，该缺陷不出现（一路绿灯）；
换到任何 UTF-8 locale（交互式终端、CI、别的机器）就炸。命中的 7 处里有 4 处
（`$C_WAL` / `$KIND` ×3）正是 **WAL 判定的输出行本身** —— 恰好长在「最需要它跑完」的位置。

复现矩阵与修复前原文见 `gap1-locale-unbound-var.md`、`gap1-locale-matrix.txt`。

### 修复（受影响文件与行号）

`scripts/verification/p2cr-coldstart-rounds.sh`（共 267 行）

| 行号 | 内容 |
|---|---|
| L33–L39 | 文件头补成因说明与实测记录，避免后人写回裸形式 |
| L**全脚本** | 变量引用统一改 `${VAR}`（花括号引用共 **134** 处，含 `$ADB`/`$PKG`/`$PORT`/`$RUN`/`$ROUNDS`/`$PY`/`$1`） |
| L142 | `WAL 拉取失败（${WAL_REMOTE}）` |
| L197 | `BASE_WAL=${BASE_WAL}（…` |
| L240 / L242 | 记录级哈希判定行 `A==C（${A_RSHA}）` / `A!=C：${A_RSHA} -> ${C_RSHA}` |

`scripts/verification/p2cr-idb-fault-inject.sh` 同步扫过（本就 0 处，未改）。

### 验证

1. 静态：修复后「紧邻非 ASCII 的裸 `$VAR`」扫描 = **0 处**（两脚本）。
2. 动态（硬证据）：`LC_ALL=en_US.UTF-8` 下**真机跑完整 3 轮** → `OVERALL=PASS`，exit 0。
   `device-coldstart-rounds.txt`：

   ```
   BASE_WAL=142637（冷启动前 WAL 字节数；下面每轮与它比，看有没有新增提交）
   WAL_LOGSET_A=[000003.log ]（权威 WAL 文件名集合；每轮复查，变了即判轮转⇒fail closed）
   ...
   ## [3] 判定
     ✓ 记录级哈希 A==C（0625aacabcd5068a）：冷启动后权威记录与启动前逐字节一致
     WAL 字节：142637 -> 142694（相对 A 时点累计 +57 B；…）
     ✓ 新增记录零键操作（OPS=0，RECORD_KIND=EMPTY_MARKER）⇒ 本轮冷启动没有产生任何提交
   ## 复验结束 2026-09-22T11:32:54+0800
   OVERALL=PASS
   ```

3. 与独立方仅加花括号的临时副本对比：本版是**全脚本统一**，不依赖「哪几行恰好挨着全角」。

## 3. T2：WAL 判据只解析第一条新增记录

### 根因

旧版 `analyse()` 只解码 `recs[0]`。遇到「第一条 `count=0` 空标记 + 第二条 `count=1` 真写」
就会**误判 `NO_OPERATIONS`** —— 把空标记之后的真实提交漏掉，验收假绿。

### 修复（受影响文件与行号）

`scripts/verification/idb-wal-delta.py`（共 285 行）

| 行号 | 内容 |
|---|---|
| L15–L24 | 文件头记 T2 修正与 fail-closed 口径 |
| L46–L47 | `MAX_DELTA_BYTES` / `MAX_OPS_PER_BATCH` 合理性上限 |
| L50 | 新增 `Incomplete` 异常（解析不完整统一升格） |
| L71–L127 | `parse_records()`：逐条走完全部新增记录；块填充识别；记录声明长度越界、跨块链缺 LAST、未知类型 ⇒ `Incomplete` |
| L129–L160 | `decode_batch()`：载荷 <12 B、count 超限、tag 非法、key/value 越界、载荷尾部未消费 ⇒ `Incomplete`（不再 IndexError 崩掉） |
| L162–L173 | `inconclusive()` 统一出口 |
| L**205–L231** | **关键修正**：`for ridx, (off, kind, pl) in enumerate(recs)` 遍历**全部**新增记录，`total_ops += count` 汇总 |
| L233 / L250 | `verdict = HAS_OPERATIONS if total_ops > 0 else NO_OPERATIONS` |
| L272 | 新增 `RECORDS_APPENDED=` 便于对账 |
| L277–L281 | 退出码：`2`=有操作 / **`3`=INCONCLUSIVE** / `0`=无操作 |

`scripts/verification/p2cr-coldstart-rounds.sh` 配套改造（原实现只认 `OPS=0`、把解析不出当「信息项」放过）：

| 行号 | 内容 |
|---|---|
| L138–L181 | 新增 `wal_verdict()`：只跑一次工具、读 `VERDICT` 分派；`HAS_OPERATIONS` ⇒ 失败，`INCONCLUSIVE` 或 VERDICT 缺失 ⇒ **fail closed 记失败**（不再当信息项） |
| L179 | 退出码自检：`rc:verdict` 必须落在 `0:NO_OPERATIONS` / `2:HAS_OPERATIONS` / `3:INCONCLUSIVE`，否则判失败 |
| L96–L99, L196–L198, L254–L259 | 新增 `wal_logset()` 与轮转守卫：每轮复查 `.log` 文件名集合，变了（权威 WAL 已换成新文件）⇒ fail closed（否则「写进了新日志」会被漏判成「没有提交」） |
| L260 | 调用 `wal_verdict "${i}"` |

### 验证（12/12 夹具，`wal-delta-tests.txt`）

夹具全部来自真机真实字节；构造用**真实 CRC32C**（并反验收束：真机 19 B 空标记与
`off=132907` 的 `count=5` 写批量两条记录 CRC 自校验均 PASS；顺带确认 LevelDB 的 CRC 覆盖
「**类型字节 + payload**」而非只覆盖 payload）。

```
✓ marker-only             NO_OPERATIONS  0    NO_OPERATIONS  0   0   只有 19 B 空 WriteBatch
✓ marker-then-1put        HAS_OPERATIONS 2    HAS_OPERATIONS 2   1   ← 旧版只看 recs[0] 会误判
✓ marker-then-real5put    HAS_OPERATIONS 2    HAS_OPERATIONS 2   5   真机 count=5 写批量
✓ real5put-only           HAS_OPERATIONS 2    HAS_OPERATIONS 2   5   判据有牙齿
✓ rotated-prefix          INCONCLUSIVE   3    INCONCLUSIVE   3   None 前缀不一致
✓ rotated-shrink          INCONCLUSIVE   3    INCONCLUSIVE   3   None WAL 变小
✓ truncated-record        INCONCLUSIVE   3    INCONCLUSIVE   3   None 记录声明长度越界
✓ short-nonzero-tail      INCONCLUSIVE   3    INCONCLUSIVE   3   None 残尾非零填充
✓ no-baseline             INCONCLUSIVE   3    INCONCLUSIVE   3   None 基线为空
✓ unchanged               NO_OPERATIONS  0    NO_OPERATIONS  0   None WAL 未变化
✓ indep-43B-degenerate-baseline INCONCLUSIVE 3 INCONCLUSIVE  3   None 独立方原反例口径（0 B 基线）
✓ indep-43B-as-increment  HAS_OPERATIONS 2    HAS_OPERATIONS 2   1  同一 43 B 作为真增量 ⇒ 汇总 OPS=1
OVERALL=PASS（12/12）
```

**用独立方保存的原反例字节复跑**（`gap2-independent-counterexample-replay.txt`）：

- 独立方当时的判定（存于其 `wal-parser-two-record-counterexample.json`）：
  `delta_bytes=43, records_appended=2, ops=0, verdict=NO_OPERATIONS` —— 漏掉了真实写。
- 修复后：同一 43 B 作为**真增量**（接到真机 WAL 之后）⇒ `OPS=1`、`VERDICT=HAS_OPERATIONS`、**exit 2**。
- 旧逻辑探针在同一字节上仍是 `OLD_RECS0 count=0 VERDICT=NO_OPERATIONS` ⇒ 对照有牙齿。
- 补一句口径说明：独立方保存的 `wal-synthetic-before.bin` 是 **0 字节**，所以它那一对是
  **退化口径**（没有增量基线）。本工具对该口径给 `NO_BASELINE / INCONCLUSIVE`（exit 3）——
  比旧版的 `NO_OPERATIONS` 更严格，方向正确：**没有基线就不能声称「无操作」**。
  两件事合起来（汇总 + fail closed）正好覆盖 T2 要求的全部内容。

## 4. T3：`verify` 不检查额外文件

### 根因

旧 `cmd_verify()` 只遍历 `SHA256SUMS` 里的文件逐个比哈希。设备目录里**多出来的**文件
（leveldb 新写的 `LOG`/`LOG.old`/`NNNNNN.log`、上次注入残留）根本不在被遍历的名单里，
于是照样 `VERIFY=PASS`，把「目录没还原干净」放过去。

### 修复（受影响文件与行号）

`scripts/verification/p2cr-idb-fault-inject.sh`（共 132 行）

| 行号 | 内容 |
|---|---|
| L15–L16 | 文件头更新 verify 语义说明 |
| L24–L29 | 补 verify 的**使用前提**（restore 之后、应用启动之前、进程已停止）与实测边界 |
| L83–L87 | 新增 ①「文件名集合必须一致」及其缺口注释 |
| L88–L91 | `want_list`（清单）/ `cur_list`（设备实际普通文件）与 `comm` 双向差集 `extra` / `missing` |
| L96–L108 | 多出 ⇒ 列出残留并判失败；缺失 ⇒ 列出并判失败 |
| L110–L121 | ② 保留原有的清单内逐字节比对 |

### 验证（`gap3-*.txt`）

以「备份 → 干净 verify → 注入残留 → 新/旧逻辑 A/B → 缺失方向 → 清理 → 全环路」逐步取证：

| 步骤 | 观测 | 期望 |
|---|---|---|
| ② 干净状态 | 集合 5/5，`VERIFY=PASS`，exit 0 | 无假红 |
| ④-a **旧逻辑**（残留 `CURRENT.bak-20260922` 在场） | `OLD_VERIFY=PASS` | **缺口确实存在** |
| ④-b **新逻辑**（同一状态） | `✗ 设备目录存在备份清单之外的文件：+ CURRENT.bak-20260922`，`VERIFY=FAIL`，exit 1 | 抓到残留 |
| ⑤ 缺失方向（清单加 `MANIFEST-000777`） | `✗ …缺失：- MANIFEST-000777`，`VERIFY=FAIL`，exit 1 | 双向都能抓 |
| ⑥ 清掉残留 | 集合回到 5/5，`VERIFY=PASS`，exit 0 | 清理后可复现转绿 |
| ⑦ 全环路 `corrupt → restore → verify` | `CORRUPTED_CURRENT=MANIFEST-000099` → `RESTORED=1` → `VERIFY=PASS`，exit 0 | restore 满足更严的 verify |
| ⑦ 续：启动应用 | `loaded/authoritative/idb`、`writesAllowed=true`、`pendingReplay=null`、试写不抛错 | 库可正常打开 |
| ⑧ 边界：启动**之后**再 verify | 集合仍 5/5，但 `000003.log`/`LOG`/`LOG.old` 报不一致 ⇒ `VERIFY=FAIL` | **正确行为**（leveldb 打开即追加/重写），已写进脚本头 |

注入用的是 `CURRENT.bak-20260922` 这个 leveldb **完全不读**的文件名（零风险），
并已 `rm -f` 清除；设备目录文件集合与开工前完全一致（5 个普通文件 + `LOCK`）。

## 5. 复述独立复验结论（`20260922T110036-independent-p2cr2-recheck`）

该轮由**独立验收方**出，结论我按原文复述、不改口径：

- **产品结论：PASS**
- **交付结论：PASS_WITH_FOLLOWUP** —— 三个证据脚本缺口（T1/T2/T3）须在**冻结 checkpoint 前**修复

其关闭的阻断项（原文第 1 节）：

1. IDB `get` 失败与 `open` 失败时，有效但陈旧的 localStorage 镜像都**只用于只读展示**；
   状态 `failed`、`writesAllowed=false`、业务心跳不启动。
2. 实际调用 `saveAsync()` 被 `state-authority-blocked`（真机错误文案 `state-authority-failed`）拦截，
   没有生成 pending replay。
3. 下一次健康启动仍从 IDB 读到完整权威数据，旧镜像没有覆盖新增事项。
4. `migrateItem()` 已幂等；连续健康冷启动不再产生状态 put。
5. 真机把 IDB `CURRENT` 指向不存在的 manifest 后，候选包按预期 fail closed；恢复后两个 LevelDB
   目录逐文件、逐字节以及**文件集合**完全一致，连续两次冷启动恢复正常。

其**交付身份**核验：HEAD 与 `origin/main` 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`；
候选 APK `62e5c876…`；设备已安装 base.apk 与候选 APK 逐字节相同；`firstInstallTime` 仍为
`2026-09-21 16:10:02`；22 个仓库 Web 资源与源码逐字节相同；实施方 9/9 源码哈希通过。
自动化：`npm test` **2347 通过 / 0 失败 / exit 0**；UI 格式 567 项一致；UI DOM 16 场景/590 字段一致；
Chrome 生产组合 12 用例 0 失败。真机三轮冷启动权威记录哈希恒为 `0625aacabcd5068a`(2443 B)、
每轮 WAL 增量精确 19 B / `OPS=0` / `seq=560`。

因此：**P2-C-R 产品门通过，可进入「导入格式安全面」**；T1–T3 属证据工程缺口，不要求回滚产品结论。

### 三项缺口状态（本轮收口）

| 缺口 | 修复前（独立方观测） | 本轮状态 |
|---|---|---|
| T1 | `set -u` 下 unbound variable，脚本直接退出；独立方用仅加花括号的副本才跑完 | ✅ 已修并**在 UTF-8 locale 下真机跑完 3 轮**（`OVERALL=PASS`） |
| T2 | 43 B 反例：`records_appended=2` 但 `ops=0 / NO_OPERATIONS` | ✅ 已修（遍历汇总 + INCONCLUSIVE fail closed）；用其**原反例字节**复跑得 `OPS=1 / exit 2` |
| T3 | 设备目录多出新文件仍 `VERIFY=PASS` | ✅ 已修（集合双向差集）；A/B 显示旧逻辑 PASS、新逻辑 FAIL exit 1 |

三项均**尚未经独立方复验**（本轮为实施方自验）——按本仓红线，自测 ≠ 独立验收。

## 6. 交付身份：本轮未变

| 项 | 值 |
|---|---|
| HEAD | `3574824357dc7beb04cbd3e32aa413cd508e8484`（未变） |
| 产品源码 9 项 | 与 R2 轮记录**逐字节相同**（本轮只改 `scripts/verification/` 下 3 个脚本） |
| 三个脚本的 git 状态 | 均为 `??`（未跟踪）⇒ 不在 HEAD 中，**未提交** |
| commit / push | **未执行** |
| 设备 | 已恢复应用前台（库 `loaded/authoritative`），IDB 目录文件集合复原 |

## 7. NOT_PERFORMED / 本轮未做

- **独立方复验 T1/T2/T3 的修复**：未做（本轮为实施方自验）。
- 产品侧任何改动：未做（本轮范围外，且裁决要求先完成 T1–T3）。
- 导入格式安全面、P2-C 再次独立复验、冻结 checkpoint、P2-D：未做。
- T3 的「轮转出更高编号 `.log`」真机形态未单独造（用 `CURRENT.bak-*` 代表残留新文件）；
  T2 的轮转分支由离线夹具（`rotated-prefix` / `rotated-shrink`）覆盖，T1 的轮转守卫
  已加但真机未发生轮转（`.log` 集合全程只有 `000003.log`）。
