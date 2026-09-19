# 安卓开发环境审计 · 2026-09-18

目的：对照**这一系列真机验证实际用到什么**，找出本机安卓环境里不必要 / 全程没起作用的组件。

> **执行结果（01:50 更新）**：已按用户确认执行，**全部移入废纸篓、未用 `rm`** ——
> `sdk/system-images`(4.2 G)、`sdk/emulator`(1.2 G)、`~/.android/avd`(1.5 G)、`~/.gradle/daemon`(10 M)。
> SDK 由 5.8 GB 降到 **498 MB**，构建与 adb 复查通过。
> **唯一未完成的**是 `/Library/Java/.../jdk-24.jdk`(389 M)：本机 `sudo` 被禁
> （`operation not permitted`），提权弹窗也被拒，需用户在自己的终端手动删。
> 空间要**清空废纸篓**后才真正释放。

- SDK 总量 **≈ 5.8 GB**（`~/Library/Android/sdk`）
- 另有 `~/.gradle` 937 MB、`~/.android/avd` 1.5 GB、`/Library/Java/.../jdk-24.jdk` 389 MB

---

## 1. 逐项判定

| 组件 | 体积 | 本轮验证是否用到 | 判定 |
| --- | --- | --- | --- |
| `platform-tools`（adb） | 37 MB | ✔ 全程（所有取证都靠它） | **保留** |
| `platforms;android-34` | 126 MB | ✔ `compileSdkVersion=34` | **保留** |
| `build-tools;34.0.0` | 187 MB | ✔ `aapt2`/`dexdump`/`zipalign`/`apksigner` 都用过 | **保留** |
| `cmdline-tools;latest` | 147 MB | △ 仅装机期（sdkmanager/avdmanager）用了一次 | 保留（以后加包还要用），但不再增长 |
| `system-images;android-34;google_apis;arm64-v8a` | **4.2 GB** | ✗ **本轮一次都没用** | **可删（最大项）** |
| `emulator` | **1.2 GB** | ✗ **本轮一次都没用**（模拟器进程此刻已不存在） | **可删（与上一条配套）** |
| `~/.android/avd/attention_api34` | **1.5 GB** | ✗ 本轮没用 | **可删** |
| `/Library/Java/.../jdk-24.jdk` | **389 MB** | ✗ **没用，而且有害** | **强烈建议删** |
| `~/Library/Java/.../temurin-17.jdk` | 309 MB | ✔ 构建必需（脚本显式 `JAVA_HOME` 指向它） | **保留** |
| `~/.gradle` | 937 MB | ✔ 构建必需（wrapper 439 MB + caches 487 MB） | 保留；`daemon` 日志 10 MB 可清 |
| `node_modules` | 61 MB | ✔ 四套测试 + `cap sync` | 保留 |
| 仓库内 `android/app/build` | 56 MB | △ 中间产物 | 可 `./gradlew clean`，随时重建 |
| 仓库内 `releases/*.apk` | 77 MB / 17 个 | △ 多数是历史实验包 | 可归档旧的（见 §3） |

---

## 2. 三条最值得动手的

### ① JDK 24 —— 没用，而且是已知的踩坑源（389 MB）

构建脚本 `scripts/android-build.sh:27` 显式把 `JAVA_HOME` 钉到 JDK 17，
因为 **AGP 8.2.1 / Gradle 8.2.1 不认 JDK 24**。也就是说这 389 MB 不仅没参与任何环节，
还是「忘了设 JAVA_HOME 就构建失败」这一坑的根源。删掉它反而能减少误用。

```bash
sudo rm -rf /Library/Java/JavaVirtualMachines/jdk-24.jdk
```

### ② 模拟器整套 —— 本轮零参与，合计 6.9 GB

`system-images` 4.2 GB + `emulator` 1.2 GB + AVD 数据 1.5 GB。

而且这个项目**本来就不该靠模拟器下结论**：`scripts/vivo-device-test.sh` 里写死了
「拒绝模拟器 —— 真机行为（厂商 ROM 策略）无法在模拟器上复现」。这一轮的全部结论
（`fast_freezer` 冻结、`Reason=frozen`、前台服务挡不住、杀进程也不重启）
**没有任何一条能在模拟器上复现**。

⚠️ **代价要说清楚**：当初手工装 `emulator` 包很痛苦（sdkmanager 拉 420 MB 必然被代理 TLS 中断，
要手工下载并补 `package.xml`）。重装步骤已记在 `.workbuddy/memory/MEMORY.md` 与
技能 `android-cli-apk-build-verify` 里，**可复现但慢**。若你还需要在别的 API 级别上验，
就别删。

### ③ 仓库内历史产物 —— 77 MB，且文件名无法区分新旧

`releases/` 下 17 个包，其中 `安心收件箱-debug.apk` 与
`安心收件箱-alarm-fix3/3b/3c/4/5-20260917-debug.apk` 是同一条构建链的多个快照（部分字节相同）。
真正该留的只有：最新调试包、已签名的发布包、以及 `*.idsig`。

---

## 3. 建议动作（按风险从低到高，均需你确认）

1. `./gradlew clean`（仓库内，重建成本 = 一次构建）→ 释放 56 MB
2. 归档 `releases/` 里 2026-09-17 之前的实验包 → 释放约 40 MB
3. 删 JDK 24 → 释放 389 MB，并消除一个踩坑源
4. 删模拟器整套（system-images + emulator + AVD）→ 释放 **6.9 GB**

## 4. 结论一句话

**这套环境本身已经很精简了**（无 Android Studio、无 NDK、只有一个 platform / 一个 build-tools、
没有多余的 sources 或系统镜像版本）。唯一的「大而无用」就是模拟器栈 6.9 GB 和 JDK 24。
而本轮能拿到结论，靠的是 `platform-tools` + `build-tools` + `platforms;android-34` + JDK 17
这四项加起来**不到 660 MB** —— 真机验证根本不需要模拟器。
