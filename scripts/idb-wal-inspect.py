#!/usr/bin/env python3
"""解析设备上 WebView IndexedDB 的 leveldb WAL（000003.log），列出每次批量写的**内容**。

为什么需要它：本轮观察到「每次冷启动 WAL 都增长 3276 B（= 2×状态 JSON 长度）」，
而记录级哈希不变 —— 说明启动路径上存在一次「写回同值」的写入。
要判定它是不是「空快照覆盖」的机理面，必须知道**到底写了什么、写了几条**。

leveldb WAL 记录格式：
  [crc32c(4, LE) | length(2, LE) | type(1)] + payload
  type 1=FULL / 2=FIRST / 3=MIDDLE / 4=LAST
WriteBatch payload：
  seq(8, LE) | count(4, LE) | count × entry
  entry: tag(1: 1=put 0=delete) | key(varint len + bytes) | [value(varint len + bytes)]

用法：python scripts/idb-wal-inspect.py <wal本地路径> [只显示最后N条，默认20]
"""
import hashlib
import struct
import sys
import zlib


def read_varint(buf, i):
    shift = 0
    val = 0
    while True:
        b = buf[i]
        i += 1
        val |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return val, i


def parse_wal(data):
    """返回 [(offset, type, payload)]，只处理 FULL 记录（本项目场景足够）。"""
    recs = []
    i = 0
    n = len(data)
    while i + 7 <= n:
        crc, length, rtype = struct.unpack_from("<IHB", data, i)
        if length == 0 or i + 7 + length > n:
            i += 1
            continue
        # leveldb 的逻辑长度是 length，物理块填充另算；这里允许跨块直接读
        payload = data[i + 7:i + 7 + length]
        if rtype == 1:
            recs.append((i, rtype, payload))
            i += 7 + length
        elif rtype == 2:
            # 跨块：收集到 LAST
            j = i + 7 + length
            buf = bytearray(payload)
            ok = True
            while j + 7 <= n:
                c2, l2, t2 = struct.unpack_from("<IHB", data, j)
                buf += data[j + 7:j + 7 + l2]
                j += 7 + l2
                if t2 == 4:
                    break
                if l2 == 0:
                    ok = False
                    break
            if ok:
                recs.append((i, 2, bytes(buf)))
            i = j
        else:
            i += 7 + length
    return recs


def main():
    path = sys.argv[1]
    tail = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    data = open(path, "rb").read()
    recs = parse_wal(data)
    print("WAL 字节数=%d  FULL 记录数=%d" % (len(data), len(recs)))
    print("")
    out = []
    for off, rtype, payload in recs:
        if len(payload) < 12:
            continue
        seq, count = struct.unpack_from("<QI", payload, 0)
        i = 12
        entries = []
        for _ in range(count):
            if i >= len(payload):
                break
            tag = payload[i]; i += 1
            klen, i = read_varint(payload, i)
            key = payload[i:i + klen]; i += klen
            val = None
            if tag == 1:
                vlen, i = read_varint(payload, i)
                val = payload[i:i + vlen]; i += vlen
            entries.append((key, val))
        for key, val in entries:
            desc = "delete" if val is None else (
                "len=%d sha16=%s" % (len(val), hashlib.sha256(val).hexdigest()[:16]))
            out.append((off, seq, key.decode("utf-8", "replace"),
                        desc, val[:120] if val else b""))
    for off, seq, key, desc, head in out[-tail:]:
        print("off=%d seq=%d key=%-12s %s" % (off, seq, key, desc))
        if head:
            print("    head=%r" % head.decode("utf-8", "replace")[:110])
    print("")
    print("--- 汇总：按 key 统计写入次数 ---")
    from collections import Counter
    c = Counter(k for _, _, k, _, _ in out)
    for k, v in c.most_common():
        print("  %-14s %d 次" % (k, v))


if __name__ == "__main__":
    main()
