#!/bin/bash
set -e
ADB=/Users/qlyf/Library/Android/sdk/platform-tools/adb
OUT="docs/reviews/verification-runs/20260924T1405-p4-device-delivery/identity.log"

echo "=== GIT INFO ===" > $OUT
echo "HEAD: $(git rev-parse HEAD)" >> $OUT
echo "origin/main: $(git rev-parse origin/main)" >> $OUT
echo "Status:" >> $OUT
git status --porcelain >> $OUT

echo "" >> $OUT
echo "=== RELEVANT FILES SHA-256 ===" >> $OUT
shasum -a 256 app-core.js sw.js index.html \
  lib/app-views.js lib/app-events.js lib/app-platform.js lib/app-notices.js \
  lib/app-alerts.js lib/app-native-coordinator.js lib/app-items.js \
  lib/delivery-evidence.js lib/native-reminders.js \
  releases/candidates/20260924T1035-p3iq2-detail-status-candidate/app-debug.apk >> $OUT

echo "" >> $OUT
echo "=== DEVICE INFO ===" >> $OUT
echo "Device Serial: 10ACBF2D3D000RS" >> $OUT
echo "Android Release: $($ADB -s 10ACBF2D3D000RS shell getprop ro.build.version.release)" >> $OUT
echo "Model: $($ADB -s 10ACBF2D3D000RS shell getprop ro.product.model)" >> $OUT
echo "Manufacturer: $($ADB -s 10ACBF2D3D000RS shell getprop ro.product.manufacturer)" >> $OUT
echo "Users:" >> $OUT
$ADB -s 10ACBF2D3D000RS shell pm list users >> $OUT
echo "Package Path:" >> $OUT
$ADB -s 10ACBF2D3D000RS shell pm path space.alliswell.inbox >> $OUT
echo "On-device Base APK SHA-256:" >> $OUT
$ADB -s 10ACBF2D3D000RS shell sha256sum /data/app/~~b-v18SRL8oHobSrhFYAD1g==/space.alliswell.inbox-HFbFwxJqJEfPJU1Fd7ZHMw==/base.apk >> $OUT

cat $OUT
