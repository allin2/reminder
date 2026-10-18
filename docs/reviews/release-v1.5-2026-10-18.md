# Release 1.5 发布记录

本轮按用户授权同步当前产品源码、推送远程并发布 Release 1.5。起点为 main / `a8fc54718d1b601c58c4cefd387fe0c220df8b79`，已有 3 个未推送提交及本轮 dirty 产品源码；远程 origin/main 没有新增提交。私有数据、原始取证、本地工具目录和无关插画不入库，冻结候选与首失败不改写。

## 范围与影响

- Android `space.alliswell.inbox`，versionName 1.5 / versionCode 6；npm 版本 1.5.0。沿用此前正式发布证书，不使用真机调试包的签名。
- 普通提醒增加按事项选择的「准时保障」，默认关闭；开启后可占用系统“下一个闹钟”位置。待整理继续使用标准调度，完整闹钟保持原路径。
- 普通通知原生定时、排程交接失败保护、过点有效队列保护、失败身份与补偿；同时纳入本地快捷记录、文本分享、待整理清单和界面修复及其回归检查。
- 发布前与 v69 冻结输入核对：174 个源文件、19 个构建输入全部一致。本轮产品变动仅为 Android/npm 版本元数据；Web 缓存继续 v69，42 个 Web 资源保持原字节。

## 验证计划与边界

直接执行当前源码 npm 全套、正式 release 构建及 lintVital、正式签名/版本/权限/资源闭包检查；JVM 使用既有 `-Xint` 夹具检查当前编译输出。任何完整性或签名失败停止发布，保留首次失败，最多进行有原因的局部修复，不扩大产品功能。

v69 的浏览器真实 DOM/IDB 开关、备份导入、重载及失败重试证据按未改组件继承。OPPO PKC130 / Android 16 的同源码 debug 包曾通过开关切换、后台横幅、息屏 AOD 和完整闹钟最短链路，候选 SHA-256 `09afcb7cb0d7d60d664b0fa636e8ba0076747b4d5c57eff0331fe1d15839ee6e`。正式包版本、构建类型和签名不同，不能继承该 APK 的整体实机 PASS；本轮正式包安装/自然到点实测记 **NOT_PERFORMED**。

普通标准调度在 OPPO 仍可能延迟；开启准时保障的短时成功不代表长待机、跨日、冷进程、其他厂商、所有权限组合或完整产品验收。旧 FAIL/UNKNOWN 保留。

原报告与证据保留在本地既有 `docs/reviews/verification-runs/20261017T153221Z-oppo-v56-full-acceptance/repair-control-20261018T060854Z/`，对应 implementation/rework-07、review/rework-07 和 device/20261018T144105Z-oppo-v69-optin。发布产物、构建日志和输入快照另存本地 `releases/v1.5-20261018/`，不覆盖原候选。

## 发布结果

- 发布标签：`v1.5`，发布入口：[Release 1.5](https://github.com/allin2/reminder/releases/tag/v1.5)。标签对应本次同步的最新源码；精确提交记录在发布附件 `release-manifest.json`。
- 正式 APK：`attention-inbox-v1.5.apk`，3,404,831 字节，SHA-256 `59f735b998180a614e60be4fbedc5b7ff43bc6daec3d1e9f763d1ee88179439f`。
- 正式签名证书 SHA-256：`bbdaeece7fa34052a529e3fc3aaab2a4f6d688b7e60845750f10cd4e17469f0b`。直接下载 1.3 原附件核验其哈希与证书，确认签名一致；支持覆盖同签名的正式旧版。调试包使用不同证书，不能直接覆盖，且不应为此卸载或清除原数据。

| 检查 | 结论 |
| --- | --- |
| `npm test` | PASS；15/15 套件，全部退出 0 |
| `assembleRelease`、`lintVitalRelease` | PASS；JDK 17 / Gradle 8.2.1，离线构建 |
| `testReleaseUnitTest` | PASS；58 项，失败/错误/跳过均 0，直接执行当前 release 编译输出；仅 `-Xint`，默认 JIT 为 NOT_PERFORMED |
| APK 身份、CRC、zipalign、签名 | PASS；1.5/6，v1/v2/v3 签名有效，与正式 1.3 证书相同 |
| 包内资源与权限 | PASS；42 个 Web 资源匹配源码/www/Android assets/v69；新增原生入口存在于 DEX；权限与 v69 相同，无 `USE_EXACT_ALARM` |
| 浏览器 DOM/IDB、导入与重载 | INHERITED_EVIDENCE；v69 未改 Web 字节及依赖，无重新执行声明 |
| OPPO 同源码短时后台/AOD/完整闹钟 | INHERITED_EVIDENCE；绑定原 v69 调试 APK，不是本次正式包整体实机 PASS |
| 正式 1.5 APK 安装、自然到点、长待机与跨日 | NOT_PERFORMED；不提升为全产品验收 |

输入清单相对 v69 仅 `package.json`、`package-lock.json`、`android/app/build.gradle` 的版本元数据及 `docs/acceptance-cases.md` 的公开报告链接改变；业务源码无漂移。两次本地编排失误（README 精确行匹配和清单包含元数据的首次断言）已记录在发布目录的 `first-failures.json`，不改写产品或旧失败结果。签名验证中 META-INF 的 v1 覆盖提示保留在日志；完整 APK 的 v2/v3 校验通过。

发布附件还包括 `SHA256SUMS.txt` 和 `release-manifest.json`。发布后以重新下载的附件哈希和远程 main/tag 对齐结果收口，本地保留完整日志及源输入快照。回退参考为未改写的 v1.3 正式附件；降级安装与数据向后兼容未经本轮验证，不承诺可无损降级。
