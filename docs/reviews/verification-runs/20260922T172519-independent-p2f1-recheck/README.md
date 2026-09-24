# P2-F1 `app-content.js` 独立复验

结论：**PASS（源码、生产交互、故障反例及 APK 资源链）**。当前候选的 Android 实机内容交互和持久化仍为 **NOT_PERFORMED**，不能把本次开发机证据写成实机 PASS。

## 身份与边界

- 仓库 `/Users/qlyf/Developer/reminder`；`main`、HEAD 与 `origin/main` 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`。工作区已有大量未提交源码、证据、候选和 APK，均予保留；未 checkout/restore/reset/stash/clean、提交或推送。
- `app-core.js` SHA-256 `61f24626c2d7332f19da652644d77e351392c325412d7efdcf379b23497e5a5f`，379,284 字节；`lib/app-content.js` `82be748ea5719244cb725602a78599c1daff9a7fc349128d3e64eb7d76ab4289`，10,478 字节。其余身份见 `source-hashes-final.txt`。开工至收尾产品哈希未变化；两份哈希台账的 HEAD 行仅空格格式不同。
- 构建前 P2-E debug APK 已复制为 `apk/prebuild-app-debug.apk`，SHA-256 `652ccd44240b4db6584cc3d14b9e88248ddce8fba653e484550d23bde0c2e158`，没有将旧候选当成本轮结果。

## 独立结论依据

对照 P2-E APK 中的旧 `app-core.js`，`final/p2e-to-p2f1-app-core.patch` 只显示内容工厂/合同/注入、六个单行转发、独占绑定迁移及测试 hook。笔记、搜索、项目算法体与 `selectedColor` 只在 `lib/app-content.js`；core 继续持有 `applyProjectRemovalToItems`，模块经注入的 `removeProjectFromItems(id)` 调用 `runUserOp(applyProjectRemovalToItems, [id])`。实例合同七项双向闭合，启动检查和实际绑定使用同一个实例；index、SW v20、boot/smoke/regressions 和打包链一致。

| 复验 | 实测 |
| --- | --- |
| `npm test` | exit 0；629 / 324 / 462 / 266 / 730 / 160，共 **2,571 / 0** |
| 语法 / 工作区 diff | JS、Python compile、`git diff --check` 均 exit 0 |
| 内容生产浏览器 | ready、笔记/事项/项目搜索、转义、项目新增删除均通过 |
| 独立生产页面 DOM 事件 | 新建/编辑笔记、置顶、预览转义、项目新增、删除取消/确认、重复 `bind()` 后动作唯一，10 个判据全 true；见 `browser/independent-content-ui.json` |
| 既有浏览器回归 | P2-E setup、P2-D diagnostics、导入格式 11/11，全部 exit 0 |
| 独立变异 | 重复绑定后实际点击双翻转、笔记 ID 属性逃逸、在途项目冲突检查缺失、生产漏载四项均健康通过/变异失败；源码前后哈希一致 |
| Android 构建 | `npm run cap:sync` 与 `:app:assembleDebug` exit 0 |
| 资源链 | **25** 个 Web 文件，源码 → `www` → Android assets → APK 四处 SHA-256 全相同，缺失/不一致均为 0 |

本轮 debug APK 为 `apk/p2f1-app-debug.apk`，SHA-256 `6909d73a87168c751a2ed7318e407f126ae5fe50bfe501bddc01b665e9775bd3`。这证明打包身份与开发机生产入口一致，不证明实机使用行为或通知送达。

## 反例与复验工具说明

`mutations/independent-p2f1-mutations.js` 与实施方变异独立：它实际派发置顶点击来检出重复监听；以恶意笔记 ID 验证属性转义；以 active action 冲突验证删除零副作用；从生产加载集合删 `lib/app-content.js` 验证覆盖扫描器点名。四项 `anchorFound/healthy/red=true`、`mutant=false`，exit 0。

验收脚本第一次把 run 目录到仓库根少算一层，产生 `MODULE_NOT_FOUND`；原始失败保存在 `mutations/initial-path-error.log`，修正的是本 run 内的独立脚本，产品源码未变。Android 构建的首次命令同样在运行 Gradle 前因日志路径误按 `android/` 解析而失败；修正为绝对路径后构建成功。两次工具路径错误不是产品测试红灯，未覆盖或伪装原始失败。

## 开口与下一步

- **NOT_PERFORMED**：本 P2-F1 APK 的 Android 实机安装、笔记/项目真实数据保存与冷启动回读、设备原生联动；不继承旧候选的实机 PASS。
- P2-F1 独立通过。下一支按 `docs/handoff/2026-09-21-app-core-modularization-plan.md` 进入 P2-F2 `app-views.js`，只迁视图/详情展示与它们的局部签名缓存；P3 事项事务、存储、原生协调继续留在 core。
