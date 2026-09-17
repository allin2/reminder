#!/usr/bin/env python3
"""Verify archived bytes offline; never contacts or changes the phone."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive', nargs='?', type=Path, default=root / 'docs/reviews/evidence-freezer-2026-09-17')
archive = parser.parse_args().archive
manifest = json.loads((archive / 'manifest.json').read_text())
failed = []
for entry in manifest['files']:
    path = archive / entry['path']
    if not path.is_file():
        failed.append(entry['path'] + ': missing')
        continue
    data = path.read_bytes()
    if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
        failed.append(entry['path'] + ': size/hash mismatch')
if failed:
    print('\n'.join(failed), file=sys.stderr)
    sys.exit(1)
print('PASS: %d archived files match manifest (integrity only, not device acceptance)' % len(manifest['files']))
