# Grilling 后续修复验证

- run ID：`20260920T152214Z-grilling-followup`
- 基线提交：`c709d6186a3ed228eb17cfbdef2316d9069db494`
- 工作区身份：以同目录 `source-hashes.txt` 为准；本轮未提交、未推送。

## 修复范围

1. 启动组合测试显式关闭勿扰，消除执行时段导致的 10 项误红。
2. 正常模式继续显示可靠性设置入口。
3. 后台与悬浮窗向导区分“打开过设置入口”和“系统能力已验证”。
4. 60 秒测试区分“已有结果”和“验证通过”；`没收到`、`不确定`、仅停止测试均不算通过。
5. 后台与全屏文案改为条件性说明，并明确以本机锁屏测试为准。
6. 已批准的一个 stale debug APK 移入废纸篓并写入维护台账。

## 自动验证

- `git diff --check`：PASS
- `npm test`：PASS
  - unit：337 / 0
  - native：321 / 0
  - boot-combination：170 / 0
  - smoke：256 / 0
  - regressions：730 / 0
  - 合计：1814 / 0
- 完整日志：`npm-test.log`

## 真实浏览器验证

用 Codex in-app browser 直接打开当前工作区 `index.html`：

- 页面与设置面板正常加载，无明显遮挡。
- 初学者模式与正常模式可来回切换。
- 正常模式下“提醒设置”入口仍可见。
- 自检页显示“为什么建议检查”，并明确“以本机 60 秒测试为准”。
- 验证后恢复初学者模式，关闭临时页面与本地 HTTP 服务。

这项只证明 Web UI 呈现与交互，不替代 Android 安装包和锁屏后台实机验收。

## 清理边界

本轮只移动：

`/Users/qlyf/Developer/reminder/releases/安心收件箱-debug.apk.stale-20260916`

恢复位置、大小、inode 与 SHA-256 见：

`docs/maintenance/20260920T152214Z-stale-apk-cleanup.md`

候选 APK、重复发布包、真机证据、工作树与其他未跟踪文件均未删除。
