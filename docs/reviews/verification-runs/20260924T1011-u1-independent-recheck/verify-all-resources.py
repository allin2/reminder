#!/usr/bin/env python3
"""Independent five-layer closure of every synchronized web resource."""
import hashlib
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[4]
APK = ROOT / "releases/candidates/20260924T0950-u1-snooze-entry-fix-candidate/app-debug.apk"

def sha(data):
    return hashlib.sha256(data).hexdigest()

paths = sorted(p.relative_to(ROOT / "www") for p in (ROOT / "www").rglob("*")
               if p.is_file() and p.name not in {"cordova.js", "cordova_plugins.js"})
bad = []
with zipfile.ZipFile(APK) as archive:
    for rel in paths:
        layers = [ROOT / rel, ROOT / "www" / rel,
                  ROOT / "android/app/src/main/assets/public" / rel,
                  ROOT / "android/app/build/intermediates/assets/debug/public" / rel]
        hashes = [sha(p.read_bytes()) if p.is_file() else "MISSING" for p in layers]
        member = "assets/public/" + rel.as_posix()
        hashes.append(sha(archive.read(member)) if member in archive.namelist() else "MISSING")
        if len(set(hashes)) != 1 or "MISSING" in hashes:
            bad.append({"path": rel.as_posix(), "hashes": hashes})

print("APK_SHA256", sha(APK.read_bytes()))
print("FILES", len(paths), "MISMATCHES", len(bad))
for row in bad:
    print("MISMATCH", row)
assert len(paths) == 39 and not bad
