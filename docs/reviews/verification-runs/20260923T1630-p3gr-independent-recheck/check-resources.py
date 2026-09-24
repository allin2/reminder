#!/usr/bin/env python3
"""Read-only five-layer hash check for the frozen 1605 candidate."""
import hashlib
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[4]
www = root / "www"
names = sorted(p.relative_to(www).as_posix() for p in www.rglob("*")
               if p.is_file() and p.name not in {"cordova.js", "cordova_plugins.js"})
intermediate = root / "android/app/build/intermediates/assets/debug/public"
if not intermediate.exists():
    intermediate = root / "android/app/build/intermediates/assets/debug/mergeDebugAssets/public"
apk = root / "releases/candidates/20260923T1605-p3gr-candidate/app-debug.apk"
problems = []

def digest(data):
    return hashlib.sha256(data).hexdigest()

with zipfile.ZipFile(apk) as archive:
    for name in names:
        paths = [root / name, www / name,
                 root / "android/app/src/main/assets/public" / name,
                 intermediate / name]
        hashes = [digest(p.read_bytes()) if p.is_file() else "MISSING" for p in paths]
        member = "assets/public/" + name
        hashes.append(digest(archive.read(member)) if member in archive.namelist() else "MISSING")
        if len(set(hashes)) != 1:
            problems.append((name, hashes))

print("resource-count=", len(names))
print("mismatch-count=", len(problems))
print("apk-sha256=", digest(apk.read_bytes()))
for name, hashes in problems:
    print("mismatch=", name, hashes)
raise SystemExit(bool(problems or len(names) != 34))
