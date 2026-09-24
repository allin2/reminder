#!/usr/bin/env python3
"""Check every current Web resource across source, sync output, intermediate and APK."""
import hashlib
import sys
import zipfile
from pathlib import Path

run = Path(__file__).resolve().parent
root = run.parents[3]
www = root / "www"
android = root / "android/app/src/main/assets/public"
intermediate = root / "android/app/build/intermediates/assets/debug/public"
apk = root / "android/app/build/outputs/apk/debug/app-debug.apk"
files = sorted(p.relative_to(www).as_posix() for p in www.rglob("*") if p.is_file()
               and p.name not in {"cordova.js", "cordova_plugins.js"})
problems = []
rows = ["path\tsource\twww\tandroid-assets\tintermediate\tapk"]

def digest(data):
    return hashlib.sha256(data).hexdigest()

with zipfile.ZipFile(apk) as archive:
    for relative in files:
        locations = [root / relative, www / relative, android / relative, intermediate / relative]
        hashes = []
        for location in locations:
            if not location.is_file():
                problems.append("missing:" + str(location))
                hashes.append("MISSING")
            else:
                hashes.append(digest(location.read_bytes()))
        apk_entry = "assets/public/" + relative
        if apk_entry not in archive.namelist():
            problems.append("missing-apk:" + apk_entry)
            hashes.append("MISSING")
        else:
            hashes.append(digest(archive.read(apk_entry)))
        if len(set(hashes)) != 1:
            problems.append("mismatch:" + relative)
        rows.append("\t".join([relative] + hashes))

(run / "resource-hashes.tsv").write_text("\n".join(rows) + "\n")
if len(files) != 32:
    problems.append("source-count:" + str(len(files)))
print("source-resource-count=" + str(len(files)))
print("mismatch-count=" + str(len(problems)))
for problem in problems:
    print(problem)
print("apk-sha256=" + digest(apk.read_bytes()))
sys.exit(1 if problems else 0)
