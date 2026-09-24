# P2-D 诊断模块迁出：独立复验

Run：`20260922T160029-independent-p2d-recheck`  
结论：**PASS（源码、浏览器与 APK 资源链）**。真机权限申请、设置跳转、通知发送与测试闹钟保持 **NOT_PERFORMED**。

## 1. 身份与范围

- 仓库：`/Users/qlyf/Developer/reminder`
- HEAD / `origin/main`：`3574824357dc7beb04cbd3e32aa413cd508e8484` / 同一 SHA
- 验收源码：
  - `app-core.js`：`205638c2adf37779350b36badf96f52b1fbed77034b75dc249a033105da84b79`
  - `lib/app-diagnostics.js`：`36f91c1b7612628e6b7fab7c6d99560afd132f72ecc6c3df4622ad5df3c78b54`
  - `index.html`：`8d3aa59cfbb40dd1ff6c7520da62506656fd5d689705b9845a79ff0ee13f6c69`
  - `sw.js`：`3f9964180dd7b84cdf88f150890557a74604f9088ececfc0df049a2b9265244c`
- 工作区原有大量修改、未跟踪源码、证据和 APK；验收没有 checkout/stash/reset/clean，没有提交或推送。
- 用户附件实际是另一个 `win7-coding-Agent` 项目的 WIN7-35 操作记录，与本仓库 P2-D 无关，未作为证据。

## 2. 独立检查结论

### 唯一实现与所有权

- 投递判读、诊断面渲染、trace、测试闹钟动作和系统设置导航只在 `lib/app-diagnostics.js` 保留实现体。
- `app-core.js` 只保留六个薄转发与实例装配；共享平台访问器仍留在 core。
- setup/review 控件由 `bindSetupReviewControls()` 保留在 core；诊断按钮及一个 `visibilitychange` 监听由实例 `bind()` 持有。
- 模块求值探针未观察到监听、计时器、DOM、state 或桥副作用。
- 模块没有反向导入 core；`AttentionLib` 只用于标准 UMD 浏览器导出。

### 启动和生产加载

- `AppDiagnostics` 命名空间、工厂和七个实例成员进入启动闸门。
- 缺模块、空实例、工厂抛错及缺实例成员均在业务启动前失败；正式 boot 反例同时断言无 IDB 写入和业务心跳。
- `index.html`、SW v18、boot/smoke/regressions 和 `production-scripts.js` 均包含新模块。
- 纯 Web 无 Capacitor 仍 ready，打开诊断面时如实显示桥不可用。

## 3. 独立执行结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | exit 0；607 / 324 / 400 / 266 / 730 / 160，共 **2,487 / 0** |
| 生产页面诊断检查 | exit 0；4/4：纯 Web、无桥面板、重复 bind、完整假桥与导航失败恢复 |
| 既有导入浏览器回归 | exit 0；11/11，合法/取消/历史 ISO/七类拒绝均保持 |
| 独立变异 | exit 0；5/5 都被检出 |
| `node --check` | exit 0 |
| `git diff --check` | exit 0 |
| APK 资源复算 | 19 个 Web 资源全部逐字节匹配，缺失 0 |

APK：`android/app/build/outputs/apk/debug/app-debug.apk`  
SHA-256：`db82962601a5bf0c8ce4df15edd688e082f19fc0552fb90c929f9ecc24e693fa`

## 4. 独立反例

`mutations/independent-mutations.js` 只在内存中修改临时源码，不改工作区产品文件：

1. carrier 判据改成恒 false：正常 `已响未亮` 变为 `无通知权限`，被抓住。
2. 删除投递时 overlay 快照优先：归因从“缺上层显示”漂成“当前权限齐备”，被抓住。
3. 删除 `if (bound) return`：监听数从 `17 → 17` 退化为 `17 → 34`，被抓住。
4. harness 漏载 `lib/app-diagnostics.js`：闭合检查点名 `unaccounted-production-script`。
5. 实例合同漏 `labLog`：双向覆盖输出 `missingInContract=["labLog"]`。

第一次运行该探针时，验收脚本把 run 目录到仓库根的相对层级少算一层，报 `MODULE_NOT_FOUND`；原始输出保留为 `independent-mutations.first-error.log`。修正的是验收脚本路径，产品源码未变。

## 5. 证据边界

- **NOT_PERFORMED**：当前候选的 Android 真机权限申请、系统设置跳转、发送测试通知、10/60 秒测试闹钟与取消。这些动作会改变设备状态，本轮没有执行。
- **NOT_PERFORMED**：生产包安装和用户数据操作。
- 本轮没有把历史 Android 原生送达结果重新签成 P2-D PASS；native 324/0 是开发机/JVM 与源码合同证据。
- 实施 run 的 `source-hashes.txt` 没列出已修改的 `test-regressions.js` 与 `scripts/verification/production-scripts.js`，且没有单独的 `ownership-map.md`。独立 run 已在 `source-hashes-start.txt`、`static-ownership.log` 和本报告中补齐，未把实施证据缺口伪装成不存在。

## 6. 判定与下一步

P2-D 的源码唯一实现、启动闸门、绑定幂等、生产加载、浏览器行为和 APK 资源链均成立，判 **PASS**。真机副作用场景的 NOT_PERFORMED 不阻断本次“模块迁出”验收，但不能据此声称真机权限或闹钟行为重新通过。

下一批进入 **P2-E：setup / 首次引导 / 自检流程迁出**。仍保留平台桥访问器、状态与持久化所有权在 core；实施后另做独立复验。
