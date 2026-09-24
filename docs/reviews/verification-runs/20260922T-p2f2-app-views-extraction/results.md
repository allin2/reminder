# Results

## Executed

- node --check app-core.js, lib/app-views.js and sw.js: PASS
- node test-boot-combination.js: PASS, 462 passed / 0 failed
- npm test: PASS
- node scripts/verification/p2f2-mutation-tests.js: PASS, four healthy controls and four in-memory counterexamples red; source hashes unchanged during the mutation run.
- python3 scripts/verification/browser-views-check.py: PASS; disposable Chrome profile verified home card, future tab, notes tab and the bound views surface.
- python3 scripts/verification/browser-content-check.py: PASS; retained P2-F1 production content flow.
- git diff --check: PASS

## Not performed

- Android debug APK build and source-to-www-to-assets-to-APK byte comparison: NOT_PERFORMED.
- Physical-device validation and any production-data operation: NOT_PERFORMED.

## Final source identity

- app-core.js: 3eff2c1107c1f6d1f577a0dd2ea37480364495c284c9480e4aeb62cdc0241125
- lib/app-views.js: 2ef2c72b6319feb3414fd07914804296d4f9fa7888a834b3d95f1a98b2fafa37
- index.html: 4405a69f59fa6013af20cbfc158205d3fe44030728110127273ab2227c5fc558
- sw.js: 87e730acb7607e434a1fb6b11ee81085718c4841b942b8dca7e5f84869ae145e
