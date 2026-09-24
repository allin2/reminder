#!/usr/bin/env python3
"""Independent source-to-candidate closure for the SW asset list plus sw.js."""
import hashlib
import pathlib
import re
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[4]
APK = ROOT / "releases/candidates/20260924T0950-u1-snooze-entry-fix-candidate/app-debug.apk"


def digest(data):
    return hashlib.sha256(data).hexdigest()


sw = (ROOT / "sw.js").read_text()
index = (ROOT / "index.html").read_text()
cache = re.search(r'const CACHE = "([^"]+)"', sw).group(1)
assets = re.search(r"const ASSETS = \[([\s\S]*?)\];", sw).group(1)
paths = sorted(set(
    item[2:] for item in re.findall(r'"(\.\/[^\"]+)"', assets) if item != "./"
) | {"sw.js"})
scripts = re.findall(r'<script\s+src="([^"]+)"', index)
missing_scripts = sorted(set(scripts) - set(paths))
print("CACHE", cache, "ASSETS", len(paths), "INDEX_SCRIPTS", len(scripts),
      "MISSING_SCRIPTS", missing_scripts)
print("APK_SHA256", digest(APK.read_bytes()))

problems = []
with zipfile.ZipFile(APK) as archive:
    for rel in paths:
        files = [
            ROOT / rel,
            ROOT / "www" / rel,
            ROOT / "android/app/src/main/assets/public" / rel,
            ROOT / "android/app/build/intermediates/assets/debug/public" / rel,
        ]
        hashes = [digest(file.read_bytes()) if file.exists() else "MISSING" for file in files]
        try:
            hashes.append(digest(archive.read("assets/public/" + rel)))
        except KeyError:
            hashes.append("MISSING")
        if len(set(hashes)) != 1:
            problems.append((rel, hashes))
print("CLOSURE_COUNT", len(paths), "MISMATCH_COUNT", len(problems))
print("PROBLEMS", problems)
if missing_scripts or problems:
    raise SystemExit(1)
