#!/usr/bin/env python3
"""Compare frozen U1 and Q2 APK payloads, including non-Web entries."""
import hashlib
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[4]
OLD = ROOT / "releases/candidates/20260924T0950-u1-snooze-entry-fix-candidate/app-debug.apk"
NEW = ROOT / "releases/candidates/20260924T1035-p3iq2-detail-status-candidate/app-debug.apk"

def sha(data):
    return hashlib.sha256(data).hexdigest()

with zipfile.ZipFile(OLD) as before, zipfile.ZipFile(NEW) as after:
    names_before = {x.filename for x in before.infolist() if not x.is_dir()}
    names_after = {x.filename for x in after.infolist() if not x.is_dir()}
    added = sorted(names_after - names_before)
    removed = sorted(names_before - names_after)
    changed = sorted(name for name in names_before & names_after if before.read(name) != after.read(name))
    web_changed = [x for x in changed if x.startswith("assets/public/")]
    other_changed = [x for x in changed if not x.startswith("assets/public/")]
    print("OLD_SHA256", sha(OLD.read_bytes()))
    print("NEW_SHA256", sha(NEW.read_bytes()))
    print("ADDED", added, "REMOVED", removed)
    print("WEB_CHANGED", web_changed)
    print("OTHER_CHANGED", other_changed)
    assert not added and not removed
    assert web_changed == ["assets/public/app-core.js", "assets/public/lib/app-views.js", "assets/public/sw.js"]
    assert other_changed == ["META-INF/CERT.RSA", "META-INF/CERT.SF", "META-INF/MANIFEST.MF"]
