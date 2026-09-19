#!/usr/bin/env python3
"""Compare the accepted Y1/Y2/Y3 APKs with the last accepted local candidate.

Exit 0 only when both APKs have the same ZIP entry set and every changed entry
is either one of the two product files changed by this task or signature metadata.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import sys
import zipfile


REPO = Path(__file__).resolve().parents[4]
PREVIOUS = REPO / "releases/candidates/20260920T003000-ux-rework2"
CURRENT = REPO / "releases/candidates/20260920T014002-ux-y123-fix"
PAIRS = (
    (
        "debug",
        PREVIOUS / "attention-inbox-debug-ux-rework2.apk",
        CURRENT / "attention-inbox-debug-ux-y123-fix.apk",
    ),
    (
        "release",
        PREVIOUS / "attention-inbox-release-ux-rework2.apk",
        CURRENT / "attention-inbox-release-ux-y123-fix.apk",
    ),
)
EXPECTED_PRODUCT = {
    "assets/public/app-core.js",
    "assets/public/lib/delivery-evidence.js",
}


def entries(path: Path) -> dict[str, tuple[int, int]]:
    with zipfile.ZipFile(path) as archive:
        return {item.filename: (item.CRC, item.file_size) for item in archive.infolist()}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    failed = False
    for label, previous, current in PAIRS:
        before = entries(previous)
        after = entries(current)
        only_before = sorted(set(before) - set(after))
        only_after = sorted(set(after) - set(before))
        changed = sorted(name for name in before.keys() & after.keys() if before[name] != after[name])
        unexpected = [
            name
            for name in changed
            if name not in EXPECTED_PRODUCT and not name.startswith("META-INF/")
        ]

        print(f"== {label} ==")
        print(f"entries: previous={len(before)} current={len(after)}")
        print(f"only_previous: {only_before}")
        print(f"only_current: {only_after}")
        for name in changed:
            category = "PRODUCT" if name in EXPECTED_PRODUCT else "SIGNATURE"
            print(f"changed [{category}]: {name}")
        print(f"unexpected: {unexpected}")
        print(f"sha256(current): {sha256(current)}")
        if only_before or only_after or unexpected:
            failed = True

    result = "EXPECTED_PRODUCT_AND_SIGNATURE_DIFFS_ONLY" if not failed else "UNEXPECTED_DIFFS"
    print(f"RESULT: {result}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
