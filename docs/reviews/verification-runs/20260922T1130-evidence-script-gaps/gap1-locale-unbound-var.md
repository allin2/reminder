# 缺口 #1 复现与修复取证：UTF-8 locale 下裸 `$VAR` 紧邻全角标点

## 缺陷

`scripts/verification/p2cr-coldstart-rounds.sh` 正文用全角标点（`（）：` 等）书写说明，
若变量引用写成裸 `$VAR` 且**紧跟**全角字符，bash 在 UTF-8 locale（`LC_CTYPE` ≠ `C`）下会把
多字节字符当作变量名的合法字符，于是去查一个不存在的变量名 ⇒ `set -u` 直接
`unbound variable` 并**中断脚本**（不是错值，是立刻退出）。

关键点：**这个缺陷在 `LC_CTYPE=C` 下不出现**。本仓日常是在 `LC_CTYPE=C` 的沙箱里跑的
（见下方矩阵第一行），所以一路绿灯；一旦换到任何 UTF-8 locale（用户的交互式终端、CI、
别的机器）就会炸。属于「环境相关的静默失败」。

## 复现（修复前，7 处）

扫描表达式：`\$[A-Za-z_][A-Za-z0-9_]*(?=[^\x00-\x7f])`，命中位置与原文：

```
  L121  $BASE_WAL    echo "BASE_WAL=$BASE_WAL（冷启动前 WAL 字节数；下面每轮与它比，看有没有新增提交）"
  L163  $A_RSHA      echo "  ✓ 记录级哈希 A==C（$A_RSHA）：冷启动后权威记录与启动前逐字节一致 ⇒ 未被空快照覆盖"
  L184  $C_WAL       echo "  WAL 字节：$BASE_WAL -> $C_WAL（相对 A 时点累计 +$((C_WAL - BASE_WAL)) B；**逐轮增量**见下面这一行）"
  L186  $KIND        echo "  ✓ 追加记录为**空标记**（OPS=0，RECORD_KIND=$KIND）：零键操作、序号不前进 ⇒ 本轮冷启动没有产生任何提交"
  L188  $KIND        echo "  · 追加记录无法解析（RECORD_KIND=$KIND）⇒ 记为信息项，见 wal-delta-round-$i.txt"
  L190  $KIND        echo "  ✗ 追加记录含 **$OPS 条真实操作**（RECORD_KIND=$KIND）⇒ 冷启动仍写回了数据，幂等未生效"
  L196  $WAL_REMOTE  echo "  ✗ WAL 拉取失败（$WAL_REMOTE）"
```

注意 L184/L186/L188/L190 这四处正是**判定行**（WAL 结论所在）—— 也就是说这个缺陷
恰好长在「最需要它跑完」的那几条输出上。

## 修复

`scripts/verification/p2cr-coldstart-rounds.sh`：
- 全脚本变量引用统一改成 `${VAR}` 花括号形式（不只这 7 处，`$ADB`/`$PKG`/`$PORT`/`$RUN`/
  `$ROUNDS`/`$PY`/`$1` 等一并改），从此**在任何 locale 下都按最长合法变量名结束**。
- 文件头补了成因与实测说明，避免后人再写回裸形式。
- `scripts/verification/p2cr-idb-fault-inject.sh` 同步扫过（本就 0 处）。

## 验证

1. 静态：裸变量扫描在修复后为 **0 处**（两个脚本）。
2. 动态：在 `LC_ALL=en_US.UTF-8` 下**真机跑完整 3 轮**，
   见同目录 `device-coldstart-rounds.txt`，脚本必须跑到 `OVERALL=...` 收尾而不是中途 unbound。
