#!/usr/bin/env python3
"""比较前后两份 leveldb WAL，判定**新追加的记录里到底有没有真正的键操作**。

为什么必须有这个工具（2026-09-22 真机实测踩到）：
  用「WAL 字节数增长」当作「产生了提交」的代理判据是**错的**。
  leveldb 在 `reuse_logs` 恢复路径上会追加一个 **count=0 的空 WriteBatch**（7B 头 + 12B 载荷 = 19 B）
  作为「日志已复用、恢复点在此」的标记 —— 它一个键都不写，序号也不前进，
  但字节数每轮稳定 +19。粗判据会把这条无害标记判成「幂等未生效」而报红（假红）。

正确的判据是 **WriteBatch 里的操作条数（count）**：
  count == 0  ⇒ 空标记，零操作，不改变数据库 ⇒ 不算提交
  count  > 0  ⇒ 真有 put/delete ⇒ 才可能是「冷启动写回同值」那种要查的提交

本版修正（2026-09-22，证据脚本缺口 #2）：
  1) **遍历全部新增记录后汇总**。旧版只解码 `recs[0]`，遇到
     「第一条 count=0 空标记 + 第二条 count=1 真 put」这种增量会**误判 NO_OPERATIONS**
     （把真实提交漏掉 ⇒ 验收假绿）。现在把每条新增记录都解出来，OPS 取总和。
  2) **无法判定时返回 INCONCLUSIVE（fail closed）**，退出码 3，绝不当成「无操作」放过：
       · 前缀不一致 / WAL 变小            ⇒ ROTATED（轮转或重写，不是追加）
       · 尾部残留不足一条记录头且非零填充  ⇒ PARTIAL（写入中断）
       · 记录声明长度超出剩余字节          ⇒ PARTIAL
       · 未知记录类型 / 跨块链缺 LAST      ⇒ PARTIAL
       · WriteBatch 载荷不足 12 B 头       ⇒ PARTIAL
       · count 条操作按编码越界（截断）    ⇒ PARTIAL
       · 任一侧 WAL 为空（没有基线）        ⇒ NO_BASELINE
  3) WriteBatch 逐字段做边界检查，解析中途越界不再抛 IndexError 崩掉脚本。

用法：
  python scripts/idb-wal-delta.py <before.bin> <after.bin> [--json]

输出（每行一个事实）：
  DELTA_BYTES=<n>
  RECORD_KIND=EMPTY_MARKER | OPS | ROTATED | NONE | PARTIAL | NO_BASELINE
  OPS=<count>            ← 全部新增记录的操作数**总和**（无法判定时为 None）
  SEQ=<n>                ← 最后一条可解码记录的序号
  ENTRIES=<rec>#<tag>:<keylen>:<vallen>,…
  RECORDS_APPENDED=<n>   ← 解析出的新增记录条数
  NOTE=<说明>
  VERDICT=NO_OPERATIONS | HAS_OPERATIONS | INCONCLUSIVE
退出码：0 = 无操作；2 = 有真实操作（供脚本判红）；3 = 无法判定（fail closed，同样要判红）。
"""
import json
import struct
import sys

MAX_DELTA_BYTES = 64 * 1024 * 1024   # 追加区超过 64 MiB 视为异常（本场景单次增量只有几十字节）
MAX_OPS_PER_BATCH = 1_000_000        # count 字段的合理上限；超过即认为载荷不可信


class Incomplete(Exception):
    """解析不完整 —— 一律升格为 INCONCLUSIVE（fail closed）。"""


def rd_varint(buf, i):
    shift = 0
    val = 0
    while True:
        if i >= len(buf):
            raise Incomplete("varint 越界（载荷 %d 字节）" % len(buf))
        b = buf[i]
        i += 1
        val |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
        if shift > 63:
            raise Incomplete("varint 超过 63 位")
    return val, i


def parse_records(data):
    """把追加区解析成 [(offset, kind, payload)]。

    kind ∈ FULL | FRAG | PADDING。
    任何解析不完整都抛 Incomplete —— 调用方据此判 INCONCLUSIVE。
    """
    recs = []
    i = 0
    n = len(data)
    while i < n:
        rem = n - i
        if rem < 7:
            # 块尾零填充：leveldb 用全零补齐块内剩余空间
            if data[i:] == b"\x00" * rem:
                recs.append((i, "PADDING", None))
                i = n
                break
            raise Incomplete("偏移 %d 尾部残留 %d 字节：不足一条记录头且非零填充（写入中断）" % (i, rem))
        crc, length, rtype = struct.unpack_from("<IHB", data, i)
        if length == 0:
            # 7 B 全零块尾填充（crc=0 len=0 type=0）
            if crc == 0 and rtype == 0:
                recs.append((i, "PADDING", None))
                i += 7
                continue
            raise Incomplete("偏移 %d 处 length=0 但记录头非全零（crc=%d type=%d）" % (i, crc, rtype))
        if i + 7 + length > n:
            raise Incomplete("偏移 %d 处声明 %d 字节，但只剩 %d 字节（写入中断）"
                             % (i, length, n - i - 7))
        payload = data[i + 7:i + 7 + length]

        if rtype == 1:                                    # FULL
            recs.append((i, "FULL", payload))
            i += 7 + length
            continue
        if rtype not in (2, 3, 4):                        # FIRST/MIDDLE/LAST
            raise Incomplete("偏移 %d 处未知记录类型 %d" % (i, rtype))

        # 跨块记录（FIRST=2 → MIDDLE=3… → LAST=4）：拼装到 LAST 为止
        buf = bytearray(payload)
        j = i + 7 + length
        while True:
            if j + 7 > n:
                raise Incomplete("跨块记录（起点 %d）缺 LAST 块：剩余 %d 字节" % (i, n - j))
            _, l2, t2 = struct.unpack_from("<IHB", data, j)
            if l2 == 0 or j + 7 + l2 > n:
                raise Incomplete("跨块记录（起点 %d）后继块不完整" % i)
            buf += data[j + 7:j + 7 + l2]
            j += 7 + l2
            if t2 == 4:
                break
            if t2 != 3:
                raise Incomplete("跨块记录（起点 %d）遇到非法后继类型 %d" % (i, t2))
        recs.append((i, "FRAG", bytes(buf)))
        i = j
    return recs


def decode_batch(pl):
    """WriteBatch: seq(8 LE) | count(4 LE) | count × entry。字段全部做边界检查。"""
    if len(pl) < 12:
        raise Incomplete("WriteBatch 载荷只有 %d 字节，不足 12 字节头" % len(pl))
    seq = struct.unpack_from("<Q", pl, 0)[0]
    count = struct.unpack_from("<I", pl, 8)[0]
    if count > MAX_OPS_PER_BATCH:
        raise Incomplete("WriteBatch 声明 count=%d，超出合理上限 %d" % (count, MAX_OPS_PER_BATCH))
    entries = []
    k = 12
    for idx in range(count):
        if k >= len(pl):
            raise Incomplete("第 %d 条操作越界（载荷 %d 字节，已到 %d）" % (idx, len(pl), k))
        tag = pl[k]
        k += 1
        kl, k = rd_varint(pl, k)
        if k + kl > len(pl):
            raise Incomplete("第 %d 条操作 key 越界（需 %d 字节）" % (idx, kl))
        k += kl
        vlen = -1
        if tag == 1:
            vlen, k = rd_varint(pl, k)
            if k + vlen > len(pl):
                raise Incomplete("第 %d 条操作 value 越界（需 %d 字节）" % (idx, vlen))
            k += vlen
        elif tag != 0:
            raise Incomplete("第 %d 条操作 tag=%d 非法（应为 0=delete / 1=put）" % (idx, tag))
        entries.append((tag, kl, vlen))
    if k != len(pl):
        raise Incomplete("WriteBatch 载荷尾部有 %d 字节未消费（解析不可信）" % (len(pl) - k))
    return seq, count, entries


def inconclusive(kind, note, delta_bytes, records=None):
    return {
        "delta_bytes": delta_bytes,
        "record_kind": kind,
        "ops": None,
        "seq": None,
        "entries": [],
        "records_appended": 0 if records is None else records,
        "note": note,
        "verdict": "INCONCLUSIVE",
    }


def analyse(a, b):
    """绝不抛异常：任何解析不出的情况都返回 INCONCLUSIVE（fail closed）。"""
    if len(b) < len(a):
        return inconclusive("ROTATED", "WAL 变小（%d -> %d）：发生轮转或压实，不是追加"
                            % (len(a), len(b)), len(b) - len(a))
    if a and not b.startswith(a):
        # 前缀必须逐字节相同；否则说明这个文件被重写/换掉了，盯它的增量没有意义
        return inconclusive("ROTATED", "前缀不一致：WAL 被轮转/重写，不是追加（前 %d 字节已不同）"
                            % min(len(a), len(b)), len(b) - len(a))
    if not a or not b:
        return inconclusive("NO_BASELINE", "基线或当前 WAL 为空（before=%d B, after=%d B），无法比较"
                            % (len(a), len(b)), len(b) - len(a))
    if len(b) == len(a):
        return {"delta_bytes": 0, "record_kind": "NONE", "ops": None, "seq": None,
                "entries": [], "records_appended": 0, "note": "WAL 无变化",
                "verdict": "NO_OPERATIONS"}

    app = b[len(a):]
    if len(app) > MAX_DELTA_BYTES:
        return inconclusive("PARTIAL", "追加区 %d 字节，超过上限 %d（WAL 可能被整体重写）"
                            % (len(app), MAX_DELTA_BYTES), len(app))

    try:
        recs = parse_records(app)
    except Incomplete as exc:
        return inconclusive("PARTIAL", "追加区解析不完整：%s" % exc, len(app))

    if not recs:
        return inconclusive("PARTIAL", "追加区非空但解析不出任何记录", len(app))

    # ── 关键修正：遍历全部新增记录，逐条解码后**汇总**操作数 ──────────────
    total_ops = 0
    batches = []
    entries = []
    last_seq = None
    try:
        for ridx, (off, kind, pl) in enumerate(recs):
            if kind == "PADDING":
                continue
            seq, count, ents = decode_batch(pl)
            batches.append({"record_index": ridx, "offset": off, "record_type": kind,
                            "payload_bytes": len(pl), "seq": seq, "ops": count})
            last_seq = seq
            total_ops += count
            for tag, kl, vl in ents:
                entries.append("%d#%d:%d:%d" % (ridx, tag, kl, vl))
    except Incomplete as exc:
        d = inconclusive("PARTIAL", "新增记录解码不完整：%s" % exc, len(app), records=len(recs))
        d["records_appended"] = len(recs)
        d["batch_records"] = batches
        return d

    if not batches:
        # 只解析到块填充、没有 WriteBatch 记录 —— 不能当作「无操作」放过
        return inconclusive("PADDING_ONLY", "新增区只含块填充，没有可判定的 WriteBatch 记录",
                            len(app), records=len(recs))

    empty_markers = sum(1 for r in batches if r["ops"] == 0)
    if total_ops > 0:
        kind_label = "OPS"
    elif empty_markers == len(batches):
        kind_label = "EMPTY_MARKER"
    else:
        kind_label = "OPS"

    return {
        "delta_bytes": len(app),
        "record_kind": kind_label,
        "ops": total_ops,
        "seq": last_seq,
        "entries": entries,
        "records_appended": len(recs),
        "batch_records": batches,
        "note": "新增 %d 条记录、%d 条含 WriteBatch（其中空标记 %d 条），操作数合计 %d"
                % (len(recs), len(batches), empty_markers, total_ops),
        "verdict": "HAS_OPERATIONS" if total_ops > 0 else "NO_OPERATIONS",
    }


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    a = open(sys.argv[1], "rb").read()
    b = open(sys.argv[2], "rb").read()
    as_json = "--json" in sys.argv

    out = analyse(a, b)

    if as_json:
        print(json.dumps(out, ensure_ascii=False))
    else:
        print("DELTA_BYTES=%d" % out["delta_bytes"])
        print("RECORD_KIND=%s" % out["record_kind"])
        print("OPS=%s" % out["ops"])
        print("SEQ=%s" % out["seq"])
        print("ENTRIES=%s" % ",".join(out["entries"]))
        print("RECORDS_APPENDED=%s" % out.get("records_appended", 0))
        if out.get("note"):
            print("NOTE=%s" % out["note"])
        print("VERDICT=%s" % out["verdict"])

    if out["verdict"] == "HAS_OPERATIONS":
        return 2
    if out["verdict"] == "INCONCLUSIVE":
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
