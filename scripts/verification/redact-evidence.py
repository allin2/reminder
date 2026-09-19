#!/usr/bin/env python3
"""把真机取证转储里的**个人账号标识**替换成占位符，并留下可审计的脱敏清单。

为什么需要它
------------
`dumpsys notification` 之类的转储会带出**别的应用**的通知通道名。实测本机的邮件应用把
账号地址嵌进了通道 id：

    NotificationChannel{mId='^nc_1_mail_<account>@<provider>', mName=邮件, ...}

这段字符串与「OPPO 隐藏闹钟」这类结论**毫无关系**，但它会让账号地址永久进入 git 历史
（本仓有 GitHub 远端，推送后无法可靠撤回）。

设计约束
--------
1. **只替换规则文件里列出的字面量**，不做「聪明的」正则改写 —— 脱敏本身不能改变证据结构。
2. **规则（含原文）不进仓库**：本脚本自身**不含任何账号字面量**，规则从
   `scripts/verification/.redaction-rules.json`（已在 `.gitignore` 中）读取。
   仓库里只保留本脚本（逻辑）+ `REDACTION-MANIFEST.json`（字面量的 sha256 前缀与每个文件的
   原始/脱敏后 sha256）—— 足以复核「改了什么、改了几处、改前改后是什么哈希」，
   但不足以还原账号。第一版把字面量写在脚本里，等于换个文件继续泄漏，已被 `--audit` 拦下。
3. 默认**干跑**（只报告），必须显式 `--apply` 才写盘。
4. `--audit` 独立复查：全量扫描，确认规则里的字面量清零（**包含清单与脚本自身**）。

用法
----
    python3 scripts/verification/redact-evidence.py            # 干跑：列出所有命中
    python3 scripts/verification/redact-evidence.py --apply    # 执行并写清单
    python3 scripts/verification/redact-evidence.py --audit    # 复查（0 命中才退出 0）

规则文件格式（本地，勿入库）
--------------------------
    [{"literal": "<待脱敏的字面量>", "placeholder": "<mail-account-a>"}, ...]
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RULES_VERSION = "2026-09-19.2"
DEFAULT_RULES = "scripts/verification/.redaction-rules.json"
DEFAULT_TARGETS = ["docs/reviews/verification-runs", "RUN"]

EMAIL_RE = re.compile(rb"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,6}")
# 明显不是个人账号的形态：包名/类名里的 `x@com.android.foo`、日志里的 toString 输出
NOT_AN_ACCOUNT = re.compile(
    rb"@(com|android|oplus|coloros|vivo|miui|heytap|space|java|kotlin|Battery)\b"
)


def load_rules(path):
    p = ROOT / path
    if not p.exists():
        raise SystemExit(
            "找不到脱敏规则文件：%s\n"
            "该文件含待脱敏的原文，**故意不入库**。请按脚本头部注释的格式在本地创建，"
            "或把清单里记录的 literalSha256_16 与你知道的字符串对号后重建。" % path)
    raw = json.loads(p.read_text(encoding="utf-8"))
    return [(r["literal"].encode(), r["placeholder"].encode()) for r in raw]


def iter_files(targets):
    for t in targets:
        p = ROOT / t
        if p.is_file():
            yield p
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file():
                    yield f


def audit_tokens(targets, rules):
    """列出所有「像个人账号」的字符串，供人工核对是否还有漏网的账号。"""
    literals = [v for v, _ in rules]
    found = {}
    for f in iter_files(targets):
        try:
            data = f.read_bytes()
        except Exception:
            continue
        for m in set(EMAIL_RE.findall(data)):
            if NOT_AN_ACCOUNT.search(m) or any(v in m for v in literals):
                continue
            found.setdefault(m.decode("utf-8", "replace"), []).append(str(f.relative_to(ROOT)))
    return found


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="真正写盘（默认只做干跑）")
    ap.add_argument("--audit", action="store_true", help="只复查规则字面量是否已清零")
    ap.add_argument("--rules", default=DEFAULT_RULES)
    ap.add_argument("--targets", nargs="*", default=DEFAULT_TARGETS)
    ap.add_argument("--manifest", default="docs/reviews/verification-runs/REDACTION-MANIFEST.json")
    a = ap.parse_args()

    rules = load_rules(a.rules)
    targets = a.targets

    if a.audit:
        hits = 0
        for f in iter_files(targets):
            data = f.read_bytes()
            for value, _ in rules:
                if value in data:
                    print("残留:", f.relative_to(ROOT), "->",
                          hashlib.sha256(value).hexdigest()[:16])
                    hits += 1
        # 脚本自身与清单也不能含原文（第一版就是栽在这里）。
        # 规则文件**故意排除**：它的用途就是保存原文，且已 gitignore。
        for extra in (Path(__file__), ROOT / a.manifest):
            if extra.exists() and extra.is_file():
                data = extra.read_bytes()
                for value, _ in rules:
                    if value in data:
                        print("残留(工具自身):", extra.relative_to(ROOT))
                        hits += 1
        print("审计结果：%s（残留 %d 处）" % ("清零" if hits == 0 else "仍有命中", hits))
        return 0 if hits == 0 else 1

    manifest = []
    changed = 0
    for f in iter_files(targets):
        try:
            original = f.read_bytes()
        except Exception as error:
            print("跳过（读失败）:", f, error)
            continue
        # replaced 的键用占位符，不用原文 —— 清单要进仓库
        counts = {placeholder.decode(): original.count(value)
                  for value, placeholder in rules}
        if not any(counts.values()):
            continue
        redacted = original
        for value, placeholder in rules:
            redacted = redacted.replace(value, placeholder)
        changed += 1
        print("%s  %s  %s" % ("APPLY " if a.apply else "DRY   ",
                              f.relative_to(ROOT), json.dumps(counts, ensure_ascii=False)))
        manifest.append({
            "file": str(f.relative_to(ROOT)),
            "replaced": counts,
            "originalSha256": sha256(original),
            "redactedSha256": sha256(redacted),
            "originalBytes": len(original),
            "redactedBytes": len(redacted),
        })
        if a.apply:
            f.write_bytes(redacted)

    print()
    print("受影响文件：%d 个（%s）" % (changed, "已写盘" if a.apply else "干跑，未写盘"))
    if changed and not a.apply:
        print("加 --apply 才会真正改写；改写后请跑 --audit 复查。")
        return 0

    if a.apply:
        others = audit_tokens(targets, rules)
        out = {
            "rulesVersion": RULES_VERSION,
            # 只记字面量的哈希前缀：清单要进仓库，不能把账号本身写回去
            "rules": [{"literalSha256_16": hashlib.sha256(v).hexdigest()[:16],
                       "placeholder": p.decode()} for v, p in rules],
            "files": manifest,
            "otherAccountLikeTokens": sorted(others),
            "note": ("只替换规则文件中的字面量，不改变任何其他字节；清单里给出每个文件的"
                     "原始/脱敏后 sha256 以供复核。字面量以 sha256 前缀记录（不落原文），"
                     "校验方式是：sha256(待核字符串)[:16] 是否等于清单中的 literalSha256_16。"
                     "规则原文保存在本地未入库的 " + a.rules + "。"),
        }
        path = ROOT / a.manifest
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("清单已写入:", a.manifest)
        print("提醒：规则文件 %s 必须在 .gitignore 中。" % a.rules)
    return 0


if __name__ == "__main__":
    sys.exit(main())
