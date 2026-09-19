# Y1–Y3 独立验收证据

工作树 `/Users/qlyf/.codex/worktrees/3547/reminder`；报告 `../../user-experience-y123-independent-acceptance-20260920.md`。
原探针从源工作区上一轮独立目录逐字节复制；通过当前工作树的真实生产 JS 和现有存储/DOM harness 执行。不操作真实用户数据。重跑建议复制到同层新 run 目录，避免覆盖本次证据。

- `transition-probes.cjs` → `transition-results.json` / `transition-run.log`：`node <本目录>/transition-probes.cjs`，Y1–Y3 全 true。
- `extended-probes.cjs` → `extended-results.json` / `extended-run.log`：同法，X1–X4 全 true。
- `probes.cjs` → `probe-results.json` / `probe-run.log`：同法；退出 0 仅说明跑完，需读取 actual。
- `npm-test.log`：工作树根执行 `npm test`，1592/1592，退出 0。
- `android-unit.log`：android 目录设置 `JAVA_HOME=/Users/qlyf/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home`，执行 `./gradlew :app:testDebugUnitTest --offline --rerun-tasks`；22/22，退出 0。
- `artifact-audit.py` → `artifact-results.json`：`python3 <本目录>/artifact-audit.py`。读取源/工作树哈希、正式两包与上轮两包 ZIP 字节、当前 Android XML；先跑单测，避免混入旧 XML。

GUI、安装、真机、签名重验、本轮新构建均 NOT_PERFORMED。测试并非目标设备证明。
