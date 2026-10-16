# 闹钟持续时间与睡眠统一补发：本地实现记录

日期：2026-09-30。起点：`main` / `757b6f05400e80146796e010447ddd6b3a13cad7`，实现保留在未提交工作区，原有 `.claude/` 保留。用户已要求增加两项功能，并确认每条事项在同一时间各自通知。

## 行为

- 「我的 → 闹钟持续时间」可输入 1–30 分钟整数，默认 5 分钟。Android 广播、解冻服务、全屏界面回落、快捷稍后、普通开机恢复及 Direct Boot 都携带相同持续时长。重复到达同一 token 不延长静音截止；自动止响不写 ACK 或完成。设置改变更新未来闹钟，不改当前已起响的单调计时。
- 「我的 → 睡眠勿扰 → 统一补发时间」可填 HH:MM，留空使用勿扰结束时刻。睡眠内时间被拒绝。23:00–07:30 的睡眠配置配合 09:15 补发，夜间和凌晨的普通事项分别排在次日 09:15。白天睡眠结束后指定时刻已过时用次日。
- 普通事项的首页判定、前台推进、原生预排共用有效时刻，原始 `triggerAt` / `localTrigger` 和版本不改写。勿扰期间的重要、关键与独立截止保护仍按既有规则执行。原载体选择保留，通知不聚合。
- 保存完成后同步原生投影；保存失败不关闭表单、恢复旧内存值并允许重试。备份白名单支持新字段，旧数据使用默认值，旧备份不覆盖缺失字段。SW 为 v52。

规格：[reminder-settings.md](../compose/spec/reminder-settings.md)，基线修订 A-02 已登记。

## 验证

| 层级 | 结果与边界 |
|---|---|
| `npm test` | PASS，退出 0。unit 714、native 338、boot 942、smoke 270、regressions 730、single-source 160，以及全部模块验证脚本均通过 |
| 生产页面浏览器交互 | PASS，实际 DOM、独立临时 Chrome profile、360×800；两个设置、非法输入、保存故障注入/重试、权威保存后刷新读回均通过；模拟 08:00 不提前推进/出现在首页，09:15 正常到期且原时间保持 |
| 视觉与滚动 | PASS，等待面板动画完成后两面板完整显示；文档 scrollY=0，无横向溢出。证据使用 `*-settled.png`；早期动画未结束的截图只作历史过程记录 |
| Android JVM | PASS，29 项测试，0 failure/error/skipped；新增 3 项覆盖 Intent 时长传递、CE/DE 持久化、同 token 不重置截止与自动止响状态。平台使用 JVM 替身，非真机声振证据 |
| `:app:assembleDebug` | PASS，新测试 APK 构建成功 |
| 资源闭包 | PASS，39 个 Web 运行时资源在源码、www、Android assets 和新 APK 内逐字节一致 |
| `git diff --check` | PASS |
| 新 APK 目标手机安装、实际声振时长、后台统一补发与重启送达 | NOT_PERFORMED；本次没有操作真实用户事项、手机设置或安装包 |

## 候选与证据

- 新候选：`/Users/qlyf/Developer/reminder/releases/candidates/20260930-reminder-settings-757b6f0/app-debug.apk`，不覆盖既有 1.3 发布包。
- SHA-256：`685450bc39f5f6d7cea6cb6f4a320783c45b8d5466e2e37dcc71fa00b9c3d8ba`。
- 身份：同目录 `identity.json` 保存运行时及 Java 源码哈希；debug 包版本仍为 1.3 / code 4，本次未进行版本发布。
- 证据：`/Users/qlyf/Developer/reminder-archive/verification-runs/20260930-reminder-settings-757b6f0`。最终浏览器依据 `browser-settled.log`、`quiet-settled.png`、`duration-settled.png`；`npm-test.log`、JVM XML 与 Android 构建日志并存。
- 本地复制资源时只复制清单中的文件，没有执行生成物清理。没有提交、推送或安装到手机。
