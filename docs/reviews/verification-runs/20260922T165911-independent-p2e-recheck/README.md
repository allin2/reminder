# P2-E `app-setup.js` 迁出：独立复验

Run：`20260922T165911-independent-p2e-recheck`  
结论：**PASS（源码、故障反例、生产浏览器与 APK 资源链）**。真实 Android 权限、设置跳转、通知和 60 秒闹钟保持 **NOT_PERFORMED**。

## 1. 验收身份

- 仓库：`/Users/qlyf/Developer/reminder`
- HEAD / `origin/main`：`3574824357dc7beb04cbd3e32aa413cd508e8484` / 同一 SHA
- `app-core.js`：`fe5e9c233aceba2ebedcff64326d4cf33f2351cdab982d78cfd6899d01062ac0`，382,314 字节
- `lib/app-setup.js`：`e7b000620da77777f0bd1cc5537d1f4a87aee0efc7aed6566d9248077a8ce112`，22,670 字节
- `index.html`：`094002ffe0cd3817e40ae959195e2a3db034aee47272361a7d913ff7e1b68d9c`
- `sw.js`：`f830a446f2cd95e68be0d9a6fd55037cc4f3a19c2763b30b3469f997f1c7a35c`，缓存 v19

工作区原有大量连续交付源码、证据和 APK。本次没有 checkout、restore、reset、stash、clean、提交或推送。构建前的 P2-D debug APK 已复制到本 run 的 `final/prebuild-app-debug.apk`，原哈希 `db829626…93fa`，没有把旧字节当成本轮候选。

## 2. 独立检查结论

### 唯一实现与所有权

- 首次提醒入口、setup 步骤、60 秒测试、反馈、投递归因和 token 限定停铃的算法体只在 `lib/app-setup.js`。
- core 对 11 个旧入口只保留单行实例转发；`state`、`save()`、NativeReminders、诊断实例与 review 业务仍由原所有者持有。
- `#btnSetup` 的点击绑定由 `appSetup.bind()` 持有并幂等；动态 `#setupEntry` 只在 `writeIfChanged()` 真正改写时绑定。review 与 diagnostics 的绑定没有被搬入 setup。
- 模块不反向引用 core；状态、原生状态、Feedback、桥和 diagnostics 都经函数/live getter 读取。

### 启动和加载闭环

- `AppSetup` 根、工厂和 12 个实例成员进入启动闸门；检查和绑定使用同一次工厂实例。
- 缺脚本、空命名空间、工厂空壳、工厂抛错以及逐一缺少 12 个实例成员，均在首次启动前得到可见失败，ready=false，且 IDB put、原生排程、2 秒轮询和 15 秒心跳均为零。
- `index.html`、SW v19、boot/smoke/regressions 和生产覆盖扫描器均加载 `lib/app-setup.js`；实例合同双向闭合，无遗漏或闲置成员。

### 行为边界

- 60 秒测试仍使用 id 90003 和 delay 60000，不创建业务事项；排程失败不替换上一轮 testRun。
- 只有开始时间之后且标题属于测试的投递才更新 seenAt；旧投递和普通业务提醒都不算本次。
- 重测后旧反馈不再点亮；停铃读取失败保持 unknown，不写 stoppedAt，也不说“没有正在响”或“已经停住”。确认空投递与 token 匹配且真正停住的两条正向路径仍成立。

## 3. 独立执行结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | exit 0；622 / 324 / 436 / 266 / 730 / 160，共 **2,538 / 0** |
| setup 生产浏览器 | exit 0；纯 Web ready/隐藏 + 假 Android 完整 setup，16 个子判据全部为 true |
| P2-D diagnostics 浏览器回归 | exit 0；4/4 |
| P2-C-S 导入浏览器回归 | exit 0；11/11 |
| 独立变异 | exit 0；标题归因、读失败、动态入口幂等、生产漏载 4/4 均被检出 |
| 语法 / diff | `node --check`、Python compile、`git diff --check` 全部 exit 0 |
| Android 构建 | `:app:assembleDebug`，BUILD SUCCESSFUL |
| 源码 → www → Android assets → APK | 24 个 Web 文件逐文件 SHA-256 一致，缺失 0 |

新 debug APK：`final/p2e-app-debug.apk`，SHA-256 `652ccd44240b4db6584cc3d14b9e88248ddce8fba653e484550d23bde0c2e158`。

## 4. 独立反例

`mutations/independent-p2e-mutations.js` 使用不同于实施方的变异点，只操作内存字符串：

1. 删除测试标题约束：时间合规的普通业务提醒被误算为本次，正式断言变红。
2. 在读取异常分支错误设置 `readOk=true`：读取失败被冒充空投递并写 stoppedAt，正式断言变红。
3. 删除动态入口的 `writeIfChanged` 早退：重复 render 把 click 监听从 1 叠成 2，正式断言变红。
4. 从 harness 加载集合漏掉 `lib/app-setup.js`：生产覆盖检查点名 `unaccounted-production-script:lib/app-setup.js`。

四项均满足 anchor 命中、健康对照为 true、变异结果为 false，产品源码前后哈希一致。

独立脚本第一次把 run 目录到仓库根少算一层，报 `MODULE_NOT_FOUND`；第二次错误地把 `coverageProblems()` 的对象结果当数组读取。两份原始错误日志均保留，修正的只有验收脚本，产品源码未变。

## 5. 实施证据差异

实施 README 记录直接 boot 水位为 434，但最终源码的实施 `npm test` 日志和本次独立实跑均为 436。该差异来自实施文档计数未同步，不影响最终测试结果；本报告以绑定最终源码哈希的 436 为准，没有改写实施 run。

## 6. 证据边界与下一步

- **NOT_PERFORMED**：当前 P2-E 候选在真实 Android 上申请权限、跳转系统设置、发出/停止 60 秒测试闹钟、锁屏观察及用户数据操作。
- 构建及资源一致性是开发机候选证据，不等于目标设备的通知或闹钟送达 PASS。
- P2-E 独立通过后，下一批进入 P2-F。为降低耦合风险，先迁 `app-content.js`（笔记、项目、搜索），再单独迁 `app-views.js`；每一支仍需单独实施和独立复验。
