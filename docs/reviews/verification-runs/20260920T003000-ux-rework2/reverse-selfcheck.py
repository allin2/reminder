#!/usr/bin/env python3
"""二次返工反向自检：拔掉每一处修复 → 对应断言必须变红 → 逐字节还原。

纪律（沿用本仓既有做法）：
  · 只在**生产源码**上做最小缺陷注入，不改测试；
  · 每次注入后跑**已有的**测试，"变红"的判据是
    `失败清单里出现以 "✗ " 开头的目标断言`（并同时要求退出码 != 0）；
    —— 只看子串会在输出里命中同名的 `✓` 行，第一版就是这么误判的；
  · 还原用备份 `cp` 回去，并以 `shasum -a 256` 逐字节比对；
  · 沙箱下不用 `git checkout`。

本轮的特别之处：**没有改动任何 Java**，所以 INJECTIONS 里不含 Gradle 条目；
`java_injections=0` 会写进 JSON，避免下游把"缺 Java 条目"误读成"跳过没做"。
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = "/Users/qlyf/Developer/reminder"
RUN = os.path.join(ROOT, "docs/reviews/verification-runs/20260920T003000-ux-rework2")
BACKUP = os.path.join(RUN, "selfcheck-backup")

APP = "app-core.js"
EV = "lib/delivery-evidence.js"
SW = "sw.js"

REGRESSIONS = "node test-regressions.js"
UNIT = "node test-unit.js"

# 每条：缺陷编号 / 文件 / 原片段 / 注入片段 / 运行命令 / 必须变红的断言子串
INJECTIONS = [
    # ---- R-F06：旧轮回执不得抬高当前轮（写侧）----
    dict(id="R-F06-write", file=EV,
         old='      const roundBase = Number(it.triggerAt) || 0;\n'
             '      if (roundBase && entryRoundBase(it, prev) !== roundBase) {',
         new='      const roundBase = Number(it.triggerAt) || 0;\n'
             '      if (false && roundBase && entryRoundBase(it, prev) !== roundBase) {',
         cmd=REGRESSIONS,
         expect="R-F06 旧轮回执不写入台账"),
    # ---- R-F06：轮次身份本身（unit 层）----
    dict(id="R-F06-identity", file=EV,
         old='      if (Number.isFinite(explicit)) return explicit;',
         new='      if (false && Number.isFinite(explicit)) return explicit;',
         cmd=UNIT,
         expect="R-F06 条目自带轮次身份时以它为准"),
    # ---- R-F06：旧轮 delivered 不得抬高当前轮（读侧）----
    dict(id="R-F06-status", file=EV,
         old='      !base || (p.at != null && p.at >= base && p.roundBase === base));',
         new='      !base || (p.at != null && p.at >= base));',
         cmd=REGRESSIONS,
         expect="R-F06b 但它不算当前轮的证据"),
    # ---- R-F06：保存反馈用的「本条排程证据」也要认轮（app-core 侧的第三处过滤）----
    dict(id="R-F06-schedule", file=APP,
         old='      return Number(round) === base;',
         new='      return true;',
         cmd=REGRESSIONS,
         expect="R-F06b 保存反馈用的「本条排程证据」也不认旧轮"),
    # ---- R-F03：AI 迟到结果不得无条件回填表单 ----
    dict(id="R-F03-late", file=APP,
         old='          if (formUntouched()) applyAiToForm(r, "AI 理解");',
         new='          applyAiToForm(r, "AI 理解");',
         cmd=REGRESSIONS,
         expect="R-F03 迟到结果不清空新草稿"),
    # ---- R-F03：落库内容必须取自冻结快照，而不是「跑完再读表单」----
    dict(id="R-F03-freeze", file=APP,
         old='      const src = (opts && opts.source) || snapshotItemForm();',
         new='      const src = snapshotItemForm();',
         cmd=REGRESSIONS,
         expect="R-F03 第一条**没有**串进第二条的备注"),
    # ---- R-F07：未确认就不许把 stoppedAt 当成功证据 ----
    dict(id="R-F07-stoppedAt", file=APP,
         old='    const confirmed = stopped > 0 || confirmedGone;\n    if (run && confirmed) {',
         new='    const confirmed = stopped > 0 || confirmedGone;\n    if (run) {',
         cmd=REGRESSIONS,
         expect="R-F07 未确认就不把 stoppedAt 当成功证据"),
    # ---- R-F07：读取失败不得冒充「没有正在响」----
    dict(id="R-F07-toast", file=APP,
         old='    } else if (!readOk) {',
         new='    } else if (false) {',
         cmd=REGRESSIONS,
         expect="R-F07 读取失败不说「没有正在响」"),
    # ---- SW：预缓存清单 + 回落规则（两个缺口各一条）----
    dict(id="SW-assets", file=SW,
         old='  "./lib/delivery-evidence.js",\n  "./lib/native-reminders.js",',
         new='  "./lib/delivery-evidence.js",',
         cmd=REGRESSIONS,
         expect="SW 新装预缓存覆盖 index.html 加载的**全部**脚本"),
    dict(id="SW-fallback", file=SW,
         old='      .catch(() => offlineFallback(req))',
         new='      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))',
         cmd=REGRESSIONS,
         expect="SW 缓存未命中的脚本"),
]

JAVA_INJECTIONS = 0   # 本轮未改 Java（见文件头说明）


def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def run(cmd):
    proc = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def failed_assertion(out, name):
    """只有**失败清单里的**那一条才算变红；同名的 `✓` 行、章节标题都不算。

    JS 侧失败行形如 `  ✗ <断言名> — <附注>`；
    Android 侧（Gradle/JUnit）形如 `<类> > <方法> FAILED`。
    """
    for line in out.splitlines():
        stripped = line.strip()
        if stripped.startswith("✗ ") and name in stripped:
            return True
        if stripped.endswith("FAILED") and name in stripped:
            return True
    return False


def main():
    os.makedirs(BACKUP, exist_ok=True)
    files = sorted({inj["file"] for inj in INJECTIONS})
    originals = {}
    for rel in files:
        src = os.path.join(ROOT, rel)
        shutil.copy2(src, os.path.join(BACKUP, rel.replace("/", "__")))
        originals[rel] = sha(src)
    with open(os.path.join(RUN, "selfcheck-original-sha256.json"), "w") as fh:
        json.dump(originals, fh, indent=2, sort_keys=True)
        fh.write("\n")

    results = []
    for inj in INJECTIONS:
        rel = inj["file"]
        path = os.path.join(ROOT, rel)
        dst = os.path.join(BACKUP, rel.replace("/", "__"))
        count = inj.get("count", 1)
        text = open(path, encoding="utf-8").read()
        found = text.count(inj["old"])
        if found != count:
            results.append({"id": inj["id"], "status": "INJECT-FAILED",
                            "detail": "anchor count=%d want=%d" % (found, count)})
            print("  !! %s 锚点数 %d != %d，跳过" % (inj["id"], found, count))
            continue
        open(path, "w", encoding="utf-8").write(text.replace(inj["old"], inj["new"]))
        print("  -> %s: 已注入缺陷" % inj["id"])
        code, out = run(inj["cmd"])
        red = code != 0 and failed_assertion(out, inj["expect"])
        entry = {
            "id": inj["id"],
            "file": rel,
            "status": "RED_AS_EXPECTED" if red else "STILL_GREEN",
            "exit": code,
            "expected": inj["expect"],
        }
        if not red:
            entry["observed_failures"] = [
                ln.strip() for ln in out.splitlines()
                if ln.strip().startswith("✗ ") or "FAILED" in ln
            ][:12]
        results.append(entry)
        print("     %s (exit=%s)" % (entry["status"], code))
        shutil.copy2(dst, path)

    restore_ok = True
    for rel, digest in originals.items():
        if sha(os.path.join(ROOT, rel)) != digest:
            restore_ok = False
            print("  !! 还原后哈希不一致：%s" % rel)
    results.append({"id": "RESTORE", "status": "BYTE_IDENTICAL" if restore_ok else "MISMATCH",
                    "java_injections": JAVA_INJECTIONS,
                    "original_sha256": originals})

    with open(os.path.join(RUN, "reverse-selfcheck.json"), "w") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print("\n还原逐字节一致：%s" % restore_ok)
    return 1 if [r for r in results if r["status"] != "RED_AS_EXPECTED"
                 and r["status"] not in ("BYTE_IDENTICAL",)] else 0


if __name__ == "__main__":
    sys.exit(main())
