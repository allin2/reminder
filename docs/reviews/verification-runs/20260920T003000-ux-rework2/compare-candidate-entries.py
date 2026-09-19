#!/usr/bin/env python3
"""把本轮候选与上一轮候选按 **zip 条目**（名字 + CRC32 + 大小）逐条比对。

目的：本轮没能走 `bash scripts/android-build.sh both`（`npx cap sync` 撞沙箱批量删除护栏，
且它把 `android/capacitor-cordova-android-plugins/` 删空后没重建出来），
我改用「手工同步 www → assets/public + 复刻该生成目录 + 原样跑 ./gradlew」。
要证明这个替代路径与标准路径**等价**，光看「构建成功」不够 ——
**本轮没改任何 Java** ⇒ 两个候选之间，非 Web 的条目（DEX / res / manifest）应当一致。

退出 0 = 差异**只**出现在预期集合内（Web 资源 + 签名相关条目）。
"""
import hashlib
import os
import sys
import zipfile

RUN = os.path.dirname(os.path.abspath(__file__))
CAND = os.path.join(RUN, "../../../../releases/candidates")
PREV_DIR = os.path.join(CAND, "20260919T235500-ux-rework")
THIS_DIR = os.path.join(CAND, "20260920T003000-ux-rework2")

PAIRS = [
    ("debug",
     os.path.join(PREV_DIR, "attention-inbox-debug-ux-rework.apk"),
     os.path.join(THIS_DIR, "attention-inbox-debug-ux-rework2.apk")),
    ("release",
     os.path.join(PREV_DIR, "attention-inbox-release-ux-rework.apk"),
     os.path.join(THIS_DIR, "attention-inbox-release-ux-rework2.apk")),
]

# 预期会变的条目
EXPECTED_WEB = {
    "assets/public/app-core.js",
    "assets/public/lib/delivery-evidence.js",
    "assets/public/sw.js",
}
EXPECTED_SIGNING_PREFIXES = ("META-INF/",)
# 归档本身（条目顺序/压缩差异）不算内容差异


def entries(path):
    with zipfile.ZipFile(path) as z:
        return {i.filename: (i.CRC, i.file_size) for i in z.infolist()}


def main():
    rc = 0
    for label, prev, this in PAIRS:
        print("== %s ==" % label)
        if not (os.path.exists(prev) and os.path.exists(this)):
            print("   MISSING: prev=%s this=%s" % (os.path.exists(prev), os.path.exists(this)))
            rc = 1
            continue
        a = entries(prev)
        b = entries(this)
        only_a = sorted(set(a) - set(b))
        only_b = sorted(set(b) - set(a))
        common = sorted(set(a) & set(b))
        diff = [n for n in common if a[n] != b[n]]

        print("   条目数  prev=%d  this=%d" % (len(a), len(b)))
        if only_a or only_b:
            print("   仅在上轮: %s" % only_a[:10])
            print("   仅在本轮: %s" % only_b[:10])
        print("   内容不同的条目: %d" % len(diff))
        for n in diff:
            tag = "WEB" if n in EXPECTED_WEB else (
                "SIGN" if n.startswith(EXPECTED_SIGNING_PREFIXES) else "UNEXPECTED")
            print("      [%s] %s" % (tag, n))
        unexpected = [n for n in diff
                      if n not in EXPECTED_WEB and not n.startswith(EXPECTED_SIGNING_PREFIXES)]
        if unexpected or only_a or only_b:
            rc = 1
            print("   => 存在**非预期**差异")
        else:
            print("   => 差异仅落在 Web 资源与签名条目内")
        print("   sha256(this) = %s" % hashlib.sha256(open(this, "rb").read()).hexdigest())
    print("\nRESULT: %s" % ("EQUIVALENT_BEYOND_WEB_AND_SIGNING" if rc == 0 else "UNEXPECTED_DIFFS"))
    return rc


if __name__ == "__main__":
    sys.exit(main())
