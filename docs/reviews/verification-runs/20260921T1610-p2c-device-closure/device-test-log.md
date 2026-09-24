# P2-C 真机收口 · 设备测试日志

- run: `20260921T1610-p2c-device-closure`
- 设备：QSKFAE95CQEUJZ8L（PKC130 / OPPO Find X8 Pro 卫星通信版），Android 16，构建 `PKC130_16.0.10.500(CN01)`
- 被测包：`space.alliswell.inbox.exportrecheck`（versionCode 2 / versionName 1.1，安装于 2026-09-21 16:10:02）
  - 隔离包名 = 生产包名 + `applicationIdSuffix=.exportrecheck`；**生产包 `space.alliswell.inbox` 全程未安装/未触碰**
- 候选 APK：`releases/candidates/20260921T1610-p2c-device-closure/attention-inbox-p2c-device-closure-debug.apk`
  - APK 内 22 个 Web 资源与源码逐字节一致（`apk-assets-byte-compare.txt`）
- 数据通道纪律：合成数据只写 **IDB 权威通道**（`attention-inbox`/kv/`state`）；WebView 有 IDB 时 localStorage 只是镜像，直写会被忽略

## 坐标换算（复现用）

- 视口 360×736 CSS px，DPR 3；应用窗口内容区起点 `mAppBounds=Rect(0,120-1080,2328)`
- 设备坐标：`x = css_x * 3`，`y = 120 + css_y * 3`
- WebView 内容不进 uiautomator 树 ⇒ 用 CDP 读 DOM `getBoundingClientRect()` 取坐标，再用 **真实 `adb shell input tap`** 触发（CDP 合成 click 不产生用户手势，**不会**唤起系统文件选择器）
- 「我的」页底部入口（滚到中心后，CSS）：导出数据 (180,368)、导入数据 (180,440)

## 用例结果

| # | 用例 | 步骤要点 | 观测 | 判定 |
|---|---|---|---|---|
| ① | 导出落盘（saved） | 导出数据 → 系统保存器 → 确认保存 | 文件真实落盘 `/sdcard/安心收件箱备份-2026-09-21.json`（542 B，空态快照） | PASS |
| ② | 同名导出 | 再次导出同名文件 | 系统建 `_1.json`；toast 显示**系统返回的真实文件名** | PASS |
| ③ | 快照内容 | 解包导出 JSON | schema 5 / 中文题名「P2C 复验事项」/ **AI 密钥字段排除**（无 `sk-`） | PASS |
| ④ | 导出取消 | 保存器内返回键 | toast「已取消导出 · 未保存文件」+ 按钮恢复 + 副文案还原 | PASS |
| ⑤ | **导入回环** | 我的→导入数据→选 `_1.json`→确认框「导入将覆盖当前数据，继续？」→确定 | IDB 与内存态均为 **1 项目 / 1 事项**，题名「P2C 复验事项」；toast「导入成功 · 1 条事项」 | PASS |
| ⑥ | **重启持久** | `am force-stop` → 冷启动（新 pid） | 状态仍为 1/1 + 题名一致；「未来 → 托管中的未来」列表可见该项 | PASS |
| ⑦ | **导入失败零误报** | 导入 77 B 非法 JSON（`aa-broken-import-test.json`） | toast「导入失败：文件格式不正确」；**IDB 原始字节前后逐字节一致**（sha256 `a22c3748c400e643…`，1638 B，`cmp` 无差异） | PASS |
| ⑧ | **在途强杀无残留** | 导出中（选择器在前）→ `force-stop` → 冷启动 | 导出按钮 `disabled=false`（无卡死）；无残留提示；IDB 哈希不变 | PASS |
| ⑨ | 宽限闸门输入路径 | 装探针记录 `visibilitychange`/`blur`/`focus`/Cordova `pause` | 选择器覆盖时**只发 `pause`**（不发 blur/VC，`visibilityState` 仍 visible）；按 HOME 才发 `vc=hidden`；回前台发 `vc=visible`+`resume`；随后真实 cancelled 结果到达 ⇒ **未误报**「保存结果未返回」 | PASS（输入路径 + 无误报） |
| ⑩ | 宽限 8 秒超时分支 | 导出中 → HOME → `force-stop com.coloros.filemanager`（令结果永不返回）→ 回前台等 >8 s | 平台**仍投递 RESULT_CANCELED** ⇒ 走到 toast「已取消导出」而非超时分支 | **NOT_PERFORMED** |

## 关键观察

1. **导出与导入走不同选择器**：导出（`saveDocument`/SAF create）→ `com.coloros.filemanager/.picker.PickerActivity`；导入（打开）→ `com.android.documentsui/.picker.PickActivity`。清理/导航脚本需分别处理。
2. **CDP 合成点击不够**：必须真实 `input tap`，否则 `PickActivity` 不起（缺用户手势）。这是中断前「导入回环未开始」的直接原因。
3. **选择器目录列表有缓存**：改名/新增文件后需关闭并重开选择器才刷新；列表排序 = 文件夹在前、文件在后（各自按名）。
4. **`ui` 字段是运行态**：内存态含 `ui.tab/futureSeg/...`，会随点击标签变化 ⇒ **度量副作用必须看 IDB 原始字节，不能对比内存态 JSON**（本轮首次度量即因此误判过一次，已纠正）。
5. **导入后 `ensureReviewSettings()` 会补默认值**（`settings.review`、`scheduledAlarmIds` 等）⇒ 导入后的内存态 ≠ 快照文件逐字节，属预期归一化。

## 证据文件

- 设备导出副本：`device-exports/安心收件箱备份-2026-09-21.json`、`device-exports/安心收件箱备份-2026-09-21_1.json`
- 失败导入前后 IDB 原始字节：`idb-state-before-failed-import.json` / `idb-state-after-failed-import.json`（两者 sha256 相同）
- 现场截图：`device-exports/shot-*.png`（导入前/确认框/导入后/首页/未来页/失败态/宽限态）
- 哈希清单：`device-artifacts-hashes.txt`

## 设备侧清理

测试残留已删（`/sdcard/ui-*.xml`、`/sdcard/shot-*.png`、`aa-broken-import-test.json`）；保留应用真实产出的两个备份 JSON 与既有 `安心收件箱备aareminder-verify-20260920-11593份-2026-09-20.json`（非本轮产物，未触碰）。
