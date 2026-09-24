#!/usr/bin/env python3
"""证据脚本缺口 #2 的验证：`idb-wal-delta.py` 是否遍历**全部**新增记录、是否 fail closed。

全部夹具来自 2026-09-22 真机 WAL 的真实字节（/tmp/p2cr2/*.bin）：
  wal-live-t0.bin  启动前基线（137620 B）
  wal-boot5.bin    冷启动一次后（137639 B，只多出 19 B 的 count=0 空 WriteBatch）
夹具构造用**真实** CRC32C（LevelDB masked crc32c），并用真机记录反验我的实现：
  取 wal-boot5.bin 里 off=132907 的 count=5 写批量，重算 CRC 必须与文件里存的一致。

用法：python make-and-test.py <工具路径> <夹具目录> <真机字节目录>
"""
import os
import struct
import subprocess
import sys


# ── LevelDB 记录格式：crc32c(masked) | len(2 LE) | type(1) | payload ──────────
# ⚠️ 实测确认（真机 3 条记录全部自校验通过）：CRC 覆盖「**类型字节 + payload**」，
#    不是只覆盖 payload —— leveldb 的 `type_crc_[t] = crc32c(&t, 1)` 再 `Extend(…, payload)`。
_POLY = 0x82F63B78
_TABLE = []
for _i in range(256):
    _c = _i
    for _ in range(8):
        _c = (_c >> 1) ^ (_POLY if _c & 1 else 0)
    _TABLE.append(_c)


def crc32c(data, crc=0):
    crc ^= 0xFFFFFFFF
    for b in data:
        crc = (crc >> 8) ^ _TABLE[(crc ^ b) & 0xFF]
    return crc ^ 0xFFFFFFFF


def masked(crc):
    return (((crc >> 15) | (crc << 17)) + 0xA282EAD8) & 0xFFFFFFFF


def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def record(payload, rtype=1):
    crc = masked(crc32c(bytes([rtype]) + payload))
    return struct.pack("<IHB", crc, len(payload), rtype) + payload


def batch(seq, ops):
    """ops = [(tag, key, value)]；tag 1=put 0=delete"""
    out = bytearray(struct.pack("<QI", seq, len(ops)))
    for tag, key, value in ops:
        out.append(tag)
        out += varint(len(key)) + key
        if tag == 1:
            out += varint(len(value)) + value
    return bytes(out)


def parse_one(data, off=0):
    crc, length, rtype = struct.unpack_from("<IHB", data, off)
    payload = data[off + 7:off + 7 + length]
    ok = masked(crc32c(bytes([rtype]) + payload)) == crc
    return crc, length, rtype, payload, ok, off + 7 + length


def main():
    tool, fixdir, realdir = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(fixdir, exist_ok=True)
    py = sys.executable

    base = open(os.path.join(realdir, "wal-live-t0.bin"), "rb").read()
    onemark = open(os.path.join(realdir, "wal-boot5.bin"), "rb").read()
    marker = onemark[len(base):]                      # 真机那 19 B 空标记
    _mcrc, _mlen, _mtype, _mpl, _mok, _mend = parse_one(marker)
    assert len(marker) == 19 and _mok and _mlen == 12 and _mtype == 1, "空标记形状不符"
    assert struct.unpack_from("<I", _mpl, 8)[0] == 0, "空标记 count 应为 0"
    print("反验：真机 19 B 空标记 CRC32C 自校验 PASS（len=%d type=%d seq=%d count=0）"
          % (_mlen, _mtype, struct.unpack_from("<Q", _mpl, 0)[0]))

    # ── 反验：真机 off=132907 的 count=5 写批量，CRC 必须自校验通过 ──────────
    crc, length, rtype, payload, crc_ok, end = parse_one(onemark, 132907)
    seq5, cnt5 = struct.unpack_from("<QI", payload, 0)
    real_put_record = onemark[132907:end]             # 一条完整 FULL 记录（长度由解析给出）
    assert crc_ok, "真机记录 CRC 反验失败：我的 crc32c/mask 实现不对"
    assert cnt5 == 5 and rtype == 1, "真机 count=5 记录形状不符"
    print("反验：真机 off=132907 记录 CRC32C 自校验 PASS（payload=%d B count=%d end=%d）"
          % (len(payload), cnt5, end))
    print("")

    # ── 夹具 ────────────────────────────────────────────────────────────────
    fix = {}

    # ① 只有空标记（真机实测形状）
    fix["marker-only"] = (base, onemark, "NO_OPERATIONS", 0,
                          "只有 19 B 空 WriteBatch ⇒ 零键操作，不是提交")

    # ② 缺口 #2 的核心：**第一条 count=0、第二条 count=1 put**
    put1 = record(batch(seq5 + 100, [(1, b"state-key-01", b"v" * 20)]))
    b_marker_then_put = onemark + marker + put1
    fix["marker-then-1put"] = (onemark, b_marker_then_put, "HAS_OPERATIONS", 2,
                               "首条 count=0 + 次条 count=1 ⇒ 旧版只看 recs[0] 会误判无操作")

    # ③ 空标记 + 真机那条 count=5 写批量（真字节，非合成）
    b_marker_then_5 = onemark + marker + real_put_record
    fix["marker-then-real5put"] = (onemark, b_marker_then_5, "HAS_OPERATIONS", 2,
                                   "首条 count=0 + 次条真机 count=5 ⇒ 操作数应汇总为 5")

    # ④ 只有真机 count=5（没有前置空标记）
    fix["real5put-only"] = (onemark, onemark + real_put_record, "HAS_OPERATIONS", 2,
                            "真机 count=5 写批量 ⇒ 必须报红（判据有牙齿）")

    # ⑤ 轮转：前缀不一致
    rot = base[:500] + b"\x00" + base[501:] + b"\x00" * 30
    fix["rotated-prefix"] = (base, rot, "INCONCLUSIVE", 3, "前缀不一致 ⇒ 轮转，fail closed")

    # ⑥ 轮转：WAL 变小
    fix["rotated-shrink"] = (base, base[:-100], "INCONCLUSIVE", 3, "WAL 变小 ⇒ 轮转/压实")

    # ⑦ 截断：声明长度超出剩余
    fix["truncated-record"] = (base, base + put1[:10], "INCONCLUSIVE", 3,
                               "记录头声明长度 > 剩余字节 ⇒ 写入中断，fail closed")

    # ⑧ 残尾：不足一条记录头且非零
    fix["short-nonzero-tail"] = (base, base + b"\x01\x02\x03", "INCONCLUSIVE", 3,
                                 "残尾 3 B 非零填充 ⇒ 不可判定，fail closed")

    # ⑨ 无基线
    fix["no-baseline"] = (b"", base, "INCONCLUSIVE", 3, "基线为空 ⇒ 无从比较")

    # ⑩ 无变化
    fix["unchanged"] = (base, base, "NO_OPERATIONS", 0, "WAL 未变化")

    # ⑪ 独立验收方（run 20260922T110036）保存的原反例字节：
    #    43 B = 19 B 空标记 + 24 B「count=1 put」，它当时被判成 ops=0 / NO_OPERATIONS。
    #    注意：独立方存的 before.bin 是 **0 字节** ⇒ 那一对是退化口径（没有增量基线），
    #    本工具对该口径给 INCONCLUSIVE（fail closed），不再像旧版那样默认「无操作」。
    #    为验证「汇总」这一条修复，这里把同样的 43 B 接到真机 WAL 之后当**真正的增量**。
    indep_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "..", "..", "20260922T110036-independent-p2cr2-recheck", "evidence")
    indep_file = os.path.join(indep_dir, "wal-synthetic-after.bin")
    if os.path.exists(indep_file):
        ind = open(indep_file, "rb").read()
        assert len(ind) == 43, "独立方反例字节长度应为 43"
        fix["indep-43B-degenerate-baseline"] = (
            b"", ind, "INCONCLUSIVE", 3,
            "独立方的 before 是 0 B：无基线 ⇒ 不得默认「无操作」，fail closed")
        fix["indep-43B-as-increment"] = (
            onemark, onemark + ind, "HAS_OPERATIONS", 2,
            "同一 43 B 作为真增量：首条 count=0 + 次条 count=1 ⇒ 汇总 OPS=1")
    else:
        print("（跳过独立方反例夹具：未找到 %s）" % indep_file)

    # ── 跑 ──────────────────────────────────────────────────────────────────
    rows = []
    failed = 0
    for name, (a, b, want_v, want_rc, why) in fix.items():
        path_a = os.path.join(fixdir, name + ".before.bin")
        path_b = os.path.join(fixdir, name + ".after.bin")
        open(path_a, "wb").write(a)
        open(path_b, "wb").write(b)
        r = subprocess.run([py, tool, path_a, path_b], capture_output=True, text=True)
        got_v = ""
        got_ops = ""
        for line in r.stdout.splitlines():
            if line.startswith("VERDICT="):
                got_v = line.split("=", 1)[1]
            elif line.startswith("OPS="):
                got_ops = line.split("=", 1)[1]
        ok = (got_v == want_v and r.returncode == want_rc)
        if not ok:
            failed += 1
        rows.append((ok, name, want_v, want_rc, got_v, r.returncode, got_ops, why))

    print("%-3s %-22s %-14s %-4s %-14s %-4s %-5s  %s"
          % ("", "夹具", "期望VERDICT", "码", "实得VERDICT", "码", "OPS", "说明"))
    for ok, name, wv, wrc, gv, grc, ops, why in rows:
        print("%-3s %-22s %-14s %-4d %-14s %-4d %-5s  %s"
              % ("✓" if ok else "✗", name, wv, wrc, gv, grc, ops, why))

    # ── A/B：旧逻辑（只看 recs[0]）在同一夹具上会怎么判 ──────────────────────
    print("")
    print("── 对照：旧版「只解码 recs[0]」的逻辑 ──")
    old = os.path.join(fixdir, "OLD-LOGIC-probe.py")
    open(old, "w").write(
        "import struct,sys\n"
        "sys.path.insert(0, %r)\n"
        "import importlib.util\n"
        "spec = importlib.util.spec_from_file_location('wal', %r)\n"
        "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
        "a=open(sys.argv[1],'rb').read(); b=open(sys.argv[2],'rb').read()\n"
        "app=b[len(a):]; recs=m.parse_records(app)\n"
        "off,kind,pl=recs[0]                       # ← 旧版的行为：只看第一条\n"
        "seq,count,ents = m.decode_batch(pl)\n"
        "print('OLD_RECS0 count=%%d VERDICT=%%s'%%(count,'NO_OPERATIONS' if count==0 else 'HAS_OPERATIONS'))\n"
        % (os.path.dirname(os.path.abspath(tool)), os.path.abspath(tool)))
    for name in ("marker-then-1put", "marker-then-real5put"):
        r = subprocess.run([py, old, os.path.join(fixdir, name + ".before.bin"),
                            os.path.join(fixdir, name + ".after.bin")],
                           capture_output=True, text=True)
        new = subprocess.run([py, tool, os.path.join(fixdir, name + ".before.bin"),
                              os.path.join(fixdir, name + ".after.bin")],
                             capture_output=True, text=True)
        nv = [l for l in new.stdout.splitlines() if l.startswith("VERDICT=")]
        print("  %-22s 旧版: %-34s 新版: %s (exit=%d)"
              % (name, r.stdout.strip(), nv[0] if nv else "?", new.returncode))

    print("")
    print("OVERALL=%s（%d/%d 夹具符合预期）" % ("PASS" if failed == 0 else "FAIL", len(fix) - failed, len(fix)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
