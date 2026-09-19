#!/usr/bin/env python3
"""返工反向自检：拔掉每一处修复 → 对应断言必须变红 → 逐字节还原。

纪律（沿用本仓既有做法）：
  · 只在**生产源码**上做最小缺陷注入，不改测试；
  · 每次注入后跑**已有的**测试，"变红"的判据是
    `进程退出码 != 0` **且** `失败清单里出现以 "✗ " 开头的目标断言`；
    （只看子串会在输出里命中同名的 `✓` 行 —— 第一版就是这么误判的）
  · 还原用备份 `cp` 回去，并以 `shasum -a 256` 逐字节比对；
  · 沙箱下不用 `git checkout`。
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = "/Users/qlyf/Developer/reminder"
RUN = os.path.join(ROOT, "docs/reviews/verification-runs/20260919T235500-ux-rework")
BACKUP = os.path.join(RUN, "selfcheck-backup")

JAVA_HOME = os.path.expanduser("~/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home")

GRADLE = ("cd %s/android && JAVA_HOME=%s ./gradlew :app:testDebugUnitTest --offline --rerun-tasks"
          % (ROOT, JAVA_HOME))

APP = "app-core.js"
NAT = "lib/native-reminders.js"
EV = "lib/delivery-evidence.js"
STORE = "android/app/src/main/java/space/alliswell/inbox/DeliveryEvidenceStore.java"

# 每条：缺陷编号 / 文件 / 原片段 / 注入片段 / 替换次数 / 运行命令 / 必须变红的断言子串
INJECTIONS = [
    dict(id="F01-JS", file=EV,
         old='const ROW_FIELDS = ["itemId", "reminderKey", "plannedAt", "carrier", "receivedAt", "itemRev", "token"];',
         new='const ROW_FIELDS = ["itemId", "key", "at", "carrier", "receivedAt", "itemRev", "token"];',
         cmd="node test-native-reminders.js",
         expect="T03 Java 的线上字段名与 Web 侧逐一相同"),
    dict(id="F01-Java", file=STORE,
         old='static final String F_REMINDER_KEY = "reminderKey";\n  static final String F_PLANNED_AT = "plannedAt";',
         new='static final String F_REMINDER_KEY = "key";\n  static final String F_PLANNED_AT = "at";',
         cmd=GRADLE, expect="rowFieldsAreTheWebProtocol"),
    dict(id="F02", file=APP,
         old='saveSubmitsInFlight.has(submitToken)', count=2,
         new='saveSubmitsInFlight.has("legacy|" + rawPrefetch)',
         cmd="node test-regressions.js",
         expect="R1 第二次提交被同一份提交身份拒绝"),
    dict(id="F03", file=APP,
         old='        if (formDraftSignature(snapshotItemForm()) === draftSig) {\n          closeSheet("sheetItem");\n          resetItemSheet();\n          state.ui.tab = "home";\n        }',
         new='        {\n          closeSheet("sheetItem");\n          resetItemSheet();\n          state.ui.tab = "home";\n        }',
         cmd="node test-regressions.js",
         expect="R2 旧保存成功不清掉新输入"),
    dict(id="F04-commit", file=APP,
         old='    const applied = runUserOp(applyCompleteUndo, [command], {\n      userFacing: true,\n      // 目标 id 藏在参数里（参数是一份撤销记录），必须显式告诉冲突检查\n      scopeId: (c) => c && c.itemId,\n      name: "undoComplete"\n    });',
         new='    const applied = applyCompleteUndo(command);',
         cmd="node test-regressions.js",
         expect="R3 原生提交发布后仍未被覆盖"),
    dict(id="F04-feedback", file=APP,
         old='    const pending = save();\n    pending.then(() => {\n      toast("已撤销完成 · 这条仍在「未完成」里");',
         new='    save().catch(() => {});\n    toast("已撤销完成 · 这条仍在「未完成」里");\n    const pending = Promise.resolve();\n    pending.then(() => {',
         cmd="node test-regressions.js",
         expect="R6 落库之前绝不说「已撤销」"),
    dict(id="F05", file=NAT,
         old="            if (rec && rec.state === REMINDER_STATE_SUPPRESSED) continue;\n",
         new="",
         cmd="node test-regressions.js",
         expect="R5 不因撤销立刻补响已经过去的那一次"),
    dict(id="F07", file=APP,
         old='    if (bridge && bridge.activeAlarmDeliveries && bridge.stopAlarmDelivery) {\n      try {\n        const active = await bridge.activeAlarmDeliveries();',
         new='    if (false && bridge && bridge.activeAlarmDeliveries && bridge.stopAlarmDelivery) {\n      try {\n        const active = await bridge.activeAlarmDeliveries();',
         cmd="node test-regressions.js",
         expect="F07 停铃返回本次真正停掉的条数"),
    dict(id="F08", file=APP,
         old='        announceSaveOutcome(newId, { editing: false, draft: draft, persistence: "confirmed", needs: needs });',
         new='        announceSaveOutcome(newId, { editing: false, draft: draft, persistence: "confirmed", needs: needs });\n        if (needs) toast("已收下 · 待整理");',
         cmd="node test-regressions.js",
         expect="F08 撤销入口没有被第二条提示顶掉"),
]


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
    results.append({"id": "RESTORE", "status": "BYTE_IDENTICAL" if restore_ok else "MISMATCH"})

    with open(os.path.join(RUN, "reverse-selfcheck.json"), "w") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print("\n还原逐字节一致：%s" % restore_ok)
    return 1 if [r for r in results if r["status"] != "RED_AS_EXPECTED"
                 and r["status"] not in ("BYTE_IDENTICAL",)] else 0


if __name__ == "__main__":
    sys.exit(main())
