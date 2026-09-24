#!/usr/bin/env python3
"""Compare every synced Web asset with source, Android assets, and the debug APK."""
import hashlib
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[5]
HERE = pathlib.Path(__file__).resolve().parent
APK = HERE / "p2g1-app-debug.apk"
WWW = ROOT / "www"
ANDROID = ROOT / "android/app/src/main/assets/public"


def digest(data):
    return hashlib.sha256(data).hexdigest()


paths = sorted(p.relative_to(WWW).as_posix() for p in WWW.rglob("*") if p.is_file())
rows = []
missing = []
mismatch = []
with zipfile.ZipFile(APK) as package:
    names = set(package.namelist())
    for rel in paths:
        locations = {
            "source": ROOT / rel,
            "www": WWW / rel,
            "android": ANDROID / rel,
        }
        row = {"path": rel}
        for label, item in locations.items():
            row[label] = digest(item.read_bytes()) if item.is_file() else None
        package_name = "assets/public/" + rel
        row["apk"] = digest(package.read(package_name)) if package_name in names else None
        row["equal"] = len(set(row[label] for label in ("source", "www", "android", "apk"))) == 1 and row["source"] is not None
        rows.append(row)
        if None in (row["source"], row["www"], row["android"], row["apk"]):
            missing.append(rel)
        elif not row["equal"]:
            mismatch.append(rel)

report = {"apk": str(APK), "apkSha256": digest(APK.read_bytes()), "files": len(rows),
          "missing": missing, "mismatch": mismatch, "rows": rows}
(HERE / "resource-chain.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({key: report[key] for key in ("apkSha256", "files", "missing", "mismatch")}, ensure_ascii=False))
raise SystemExit(0 if not missing and not mismatch else 1)
