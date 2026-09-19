#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导出契约核对（CP-002 / D46–D54 的守护）。

背景：`docs/compose/spec/schemas/attention-inbox.export.v1.schema.json` 是**对外契约**，
`lib/export-format.js` 是它的实现。两者一旦漂移，别人的程序读我们的导出件就会静默出错 ——
而"静默"正是本项目最不能接受的那种失败。

本脚本做三件事：
  1. 校验仓库里的样例（`attention-inbox.export.v1.example.json`）通过 schema；
  2. 用 node 现场跑 `lib/export-format.js` 生成一份导出件，同样必须通过 schema；
  3. 跑一组**负例**——每一例都必须被拒绝，否则说明某条约束其实没有生效。

用假数据"看起来能跑"不算数：只有负例也被拒了，才证明约束是真的。

用法：
  /Users/qlyf/.workbuddy/binaries/python/envs/default/bin/python \
      scripts/verification/export-schema-check.py

退出码：0 = 全部符合预期；1 = 存在不符合项（含"本该被拒却通过了"）。
"""

import copy
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCHEMA_PATH = os.path.join(
    ROOT, "docs", "compose", "spec", "schemas", "attention-inbox.export.v1.schema.json"
)
EXAMPLE_PATH = os.path.join(
    ROOT, "docs", "compose", "spec", "schemas", "attention-inbox.export.v1.example.json"
)

try:
    from jsonschema import Draft202012Validator
except ImportError:
    print("缺少 jsonschema。安装："
          "/Users/qlyf/.workbuddy/binaries/python/envs/default/bin/pip install jsonschema")
    sys.exit(1)


def find_node():
    for cand in (
        "/Users/qlyf/.workbuddy/binaries/node/versions/22.22.2-3/bin/node",
        "/usr/local/bin/node",
        "node",
    ):
        try:
            subprocess.run([cand, "-v"], capture_output=True, check=True)
            return cand
        except Exception:
            continue
    raise RuntimeError("找不到可用的 node")


# 现场生成用的 fixture —— 覆盖四条正交状态的每一种取值组合里最有代表性的几条
NODE_FIXTURE = r"""
const L = require(%(root)s + "/lib/export-format.js");
const now = new Date(2026, 8, 18, 15, 0, 0).getTime();
const mk = (o) => Object.assign({
  id: "x", title: "t", status: "waiting", priority: "normal",
  review_status: "READY", createdAt: now - 1000, tags: []
}, o);
const items = [
  mk({ id: "a", title: "交房租", triggerAt: now + 3 * 864e5,
       repeat: { every: "month", mode: "calendar" } }),
  mk({ id: "b", title: "报名截止", status: "acknowledged", priority: "important",
       triggerAt: null, acknowledgedAt: now - 36e5, deadlineAt: now + 5 * 864e5 }),
  mk({ id: "c", title: "待整理项", review_status: "NEEDS_REVIEW",
       isFallbackTrigger: true, triggerAt: now + 864e5 }),
  mk({ id: "d", title: "已归档", status: "archived" }),
  mk({ id: "f", title: "给爸妈打电话", triggerAt: now + 2 * 864e5,
       repeat: { every: "biweek", mode: "ack" } }),
  mk({ id: "g", title: "每月第2个周二开例会", triggerAt: now + 4 * 864e5,
       repeat: { every: "nthWeekday", mode: "calendar", nth: 2, dow: 2 } }),
  mk({ id: "h", title: "很长很长的一条标题".repeat(8), triggerAt: now + 6 * 864e5 })
];
const out = L.buildExport(items, {
  now: now, appVersion: "schema-check", internalSchema: 5,
  scope: { mode: "active" },
  extras: { settingsSubset: { quietStart: "23:00", defaultDeliveryMode: "alarm",
                              ai: { apiKey: "sk-LEAK", baseUrl: "https://leak.example" } } }
});
const ics = L.buildIcs(items, { now: now, scope: { mode: "active" } });
const enc = new TextEncoder();
const icsLines = ics.text.split("\r\n");
process.stdout.write(JSON.stringify({
  export: out,
  ics: {
    crlf: ics.text.indexOf("\r\n") > 0,
    dropped: ics.dropped,
    downgraded: ics.downgraded,
    maxLineBytes: Math.max.apply(null, icsLines.map(l => enc.encode(l).length)),
    allDtUtc: icsLines.filter(l => /^DT(START|END|STAMP|DUE):/.test(l)).every(l => /Z$/.test(l)),
    noAckRrule: ics.text.split("BEGIN:VEVENT").filter(b => b.indexOf("UID:f@attention-inbox") >= 0)[0]
                  .indexOf("RRULE:") < 0,
    hasContract: ics.text.indexOf("ACK != Complete") >= 0
  },
  secretHits: L.scanSecrets(out)
}));
"""


def build_live_export(node):
    code = NODE_FIXTURE % {"root": json.dumps(ROOT)}
    res = subprocess.run([node, "-e", code], capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError("node 生成导出件失败：\n" + res.stderr.strip()[-2000:])
    return json.loads(res.stdout)


def main():
    schema = json.load(open(SCHEMA_PATH, encoding="utf-8"))
    validator = Draft202012Validator(schema)
    example = json.load(open(EXAMPLE_PATH, encoding="utf-8"))
    live = build_live_export(find_node())

    results = []

    def check(label, ok, detail=""):
        results.append((label, bool(ok), detail))

    def errs(obj):
        return list(validator.iter_errors(obj))

    # ---- 正例 ----
    e = errs(example)
    check("样例文件通过 schema", not e, e[0].message[:120] if e else "")

    live_obj = live["export"]
    e = errs(live_obj)
    check("现场生成的导出件通过 schema", not e, e[0].message[:120] if e else "")

    # ---- 与代码侧的一致性 ----
    allowed_item = set(schema["$defs"]["item"]["properties"].keys())
    actual_item = set(live_obj["items"][0].keys())
    check("条目字段与 schema 完全一致",
          allowed_item == actual_item,
          "多 %s / 少 %s" % (sorted(actual_item - allowed_item), sorted(allowed_item - actual_item)))

    top_allowed = set(schema["properties"].keys())
    top_actual = set(live_obj.keys())
    check("顶层字段都在 schema 内", top_actual <= top_allowed, str(sorted(top_actual - top_allowed)))

    check("导出件不含任何密钥", not live["secretHits"], str(live["secretHits"])[:160])
    check("设置子集保留非密钥项",
          live_obj["extensions"]["internal"]["settings_subset"].get("quietStart") == "23:00")

    # ---- ACS 硬规定 ----
    ics = live["ics"]
    check("ICS 全用 CRLF", ics["crlf"])
    check("ICS 每行不超过 75 字节", ics["maxLineBytes"] <= 75, "最长 %s" % ics["maxLineBytes"])
    check("ICS 所有 DT 行都是 UTC", ics["allDtUtc"])
    check("ICS 里 ack 周期没有 RRULE", ics["noAckRrule"])
    check("ICS 写入 ACK != Complete 契约", ics["hasContract"])
    check("兜底且无截止的条目被排除在日历外", ics["dropped"] == 1, "dropped=%s" % ics["dropped"])
    check("兜底但有截止的条目降级为 VTODO", ics["downgraded"] == 1, "downgraded=%s" % ics["downgraded"])

    # ---- 负例：每一例都必须被拒绝 ----
    def must_reject(label, mutate):
        obj = copy.deepcopy(live_obj)
        mutate(obj)
        n = len(errs(obj))
        check("[负例] " + label, n > 0, "本该被拒却通过了")

    def set_all_attention(v):
        def f(o):
            for it in o["items"]:
                it["attention_status"] = v
        return f

    must_reject("把 attention_status 改成 DONE", set_all_attention("DONE"))
    must_reject("把 ACKNOWLEDGED 当 COMPLETED 用", set_all_attention("COMPLETED"))

    def strip_offset(o):
        for it in o["items"]:
            if it["trigger_at_iso"]:
                it["trigger_at_iso"] = it["trigger_at_iso"][:19]
    must_reject("时间串去掉时区偏移", strip_offset)

    def fake_ack_rrule(o):
        for it in o["items"]:
            if it.get("repeat") and it["repeat"].get("mode") == "ack":
                it["repeat"]["rrule"] = "FREQ=WEEKLY;INTERVAL=2"
    must_reject("给 ACK 周期伪造 RRULE", fake_ack_rrule)

    def nth_missing(o):
        for it in o["items"]:
            if it.get("repeat") and it["repeat"].get("every") == "nthWeekday":
                for k in ("nth", "dow"):
                    it["repeat"].pop(k, None)
    must_reject("nthWeekday 缺 nth/dow", nth_missing)

    must_reject("删掉顶层 scope", lambda o: o.pop("scope", None))
    must_reject("条目上多一个未声明字段", lambda o: o["items"][0].update({"unknown_field": 1}))
    must_reject("illegal importance", lambda o: o["items"][0].update({"importance": "URGENT"}))

    # ---- 输出 ----
    width = max(len(r[0]) for r in results)
    bad = 0
    print("== 导出契约核对 ==")
    for label, ok, detail in results:
        if not ok:
            bad += 1
        print("  %s %-*s %s" % ("✓" if ok else "✗", width, label, detail if not ok else ""))

    print("\n通过 %d / 共 %d" % (len(results) - bad, len(results)))
    if bad:
        print("存在 %d 项不符合预期。" % bad)
        return 1
    print("全部符合预期。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
