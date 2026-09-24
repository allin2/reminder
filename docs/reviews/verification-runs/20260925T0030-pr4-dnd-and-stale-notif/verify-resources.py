#!/usr/bin/env python3
"""5-layer resource closure verification for PR #4 candidate.
Verifies exact byte parity across:
1. Source root
2. www
3. android/app/src/main/assets/public
4. android/app/build/intermediates/assets/debug/public (actual Gradle debug intermediate)
5. Candidate APK assets/public/
Also asserts:
- lib/native-reminders.js inside candidate APK matches source lib/native-reminders.js
- sw.js inside candidate APK defines CACHE = "attention-inbox-v44"
"""
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

RUN_DIR = Path(__file__).resolve().parent
ROOT = RUN_DIR.parents[3]
WWW_DIR = ROOT / "www"
ANDROID_DIR = ROOT / "android/app/src/main/assets/public"
INTERMEDIATE_DIR = ROOT / "android/app/build/intermediates/assets/debug/public"
APK_PATH = ROOT / "releases/candidates/20260925T0030-pr4-candidate/app-debug.apk"

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def main():
    if not APK_PATH.is_file():
        print(f"ERROR: Candidate APK not found at {APK_PATH}", file=sys.stderr)
        sys.exit(1)

    if not INTERMEDIATE_DIR.is_dir():
        print(f"ERROR: Intermediate directory not found at {INTERMEDIATE_DIR}", file=sys.stderr)
        sys.exit(1)

    files = sorted(
        p.relative_to(WWW_DIR).as_posix()
        for p in WWW_DIR.rglob("*")
        if p.is_file() and p.name not in {"cordova.js", "cordova_plugins.js", ".DS_Store"}
    )

    rows = []
    mismatches = []

    with zipfile.ZipFile(APK_PATH) as archive:
        for rel in files:
            src_path = ROOT / rel
            www_path = WWW_DIR / rel
            and_path = ANDROID_DIR / rel
            int_path = INTERMEDIATE_DIR / rel
            apk_entry = "assets/public/" + rel

            src_h = digest(src_path.read_bytes()) if src_path.is_file() else None
            www_h = digest(www_path.read_bytes()) if www_path.is_file() else None
            and_h = digest(and_path.read_bytes()) if and_path.is_file() else None
            int_h = digest(int_path.read_bytes()) if int_path.is_file() else None
            apk_h = digest(archive.read(apk_entry)) if apk_entry in archive.namelist() else None

            all_hashes = [src_h, www_h, and_h, int_h, apk_h]
            is_match = (all(h is not None for h in all_hashes) and len(set(all_hashes)) == 1)

            row = {
                "path": rel,
                "layers": {
                    "source": src_h,
                    "www": www_h,
                    "android-assets": and_h,
                    "intermediate": int_h,
                    "apk": apk_h
                },
                "match": is_match
            }
            rows.append(row)
            if not is_match:
                mismatches.append(rel)

        # Verify sw.js cache name in APK
        apk_sw_content = archive.read("assets/public/sw.js").decode("utf-8")
        cache_match = re.search(r'const\s+CACHE\s*=\s*["\']([^"\']+)["\']', apk_sw_content)
        cache_name = cache_match.group(1) if cache_match else None

        # Verify lib/native-reminders.js
        native_reminders_src = digest((ROOT / "lib/native-reminders.js").read_bytes())
        native_reminders_apk = digest(archive.read("assets/public/lib/native-reminders.js"))
        native_reminders_ok = (native_reminders_src == native_reminders_apk)

    sw_version_ok = (cache_name == "attention-inbox-v44")

    out = {
        "apk": str(APK_PATH),
        "apk_sha256": digest(APK_PATH.read_bytes()),
        "count": len(files),
        "mismatches": mismatches,
        "sw_cache_name": cache_name,
        "sw_cache_ok": sw_version_ok,
        "native_reminders_match": native_reminders_ok,
        "native_reminders_sha256": native_reminders_src,
        "rows": rows
    }

    out_file = RUN_DIR / "resource-closure.json"
    out_file.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} entries to {out_file}")
    print(f"Total files: {len(files)}, Mismatches: {len(mismatches)}")
    print(f"sw.js cache name: {cache_name}, matches v44: {sw_version_ok}")
    print(f"lib/native-reminders.js matches source: {native_reminders_ok} ({native_reminders_src})")

    if len(files) != 39 or len(mismatches) != 0 or not sw_version_ok or not native_reminders_ok:
        print(f"ASSERTION FAILED in 5-layer check: files={len(files)}, mismatches={len(mismatches)}, sw_ok={sw_version_ok}, native_ok={native_reminders_ok}", file=sys.stderr)
        sys.exit(1)

    print("5-layer resource closure SUCCESS: 39/39 exact matches with genuine intermediate hashes, v44 sw.js cache, and identical lib/native-reminders.js!")

if __name__ == "__main__":
    main()
