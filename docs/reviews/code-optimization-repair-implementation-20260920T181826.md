# O3 / O6 独立验收阻断项修复

- run-id：`20260920T181826-code-optimization-repair`
- 日期：2026-09-20
- 仓库：`main` / `4de5f597573bc2c45b51ba8ab18a279d054339a0`
- 交付形态：未提交工作区字节
- 修复结论：**源码与浏览器复验 PASS**
- Android 实机：**NOT_PERFORMED**（本机 adb 未发现已连接或已授权设备）

## 修复内容

### F1：首页签名碰撞

`homeCardSignature` 改为序列化仅与首页显示有关的嵌套数组，不再用 `SEP`、`ROW` 和逗号拼接结构化数据。标签数组、事项字段和项目字段的边界因此不会被用户内容吞掉。

覆盖反例：

- `["work,home"]` 与 `["work", "home"]`；
- 标题/备注包含旧 `SEP` 字符；
- 项目字段包含旧 `ROW` 字符；
- 内容完全不变时仍然不重写 DOM。

### F2：畸形 HTTP(S) 被放行

运行环境存在 `URL` 构造器时，`new URL()` 抛错立即返回 `null`。字形兼容分支只在环境没有 `URL` 构造器时使用。

新增反例：`https://[`、`http://%zz`、`https://example.com:99999` 均降级为纯文本；正常 HTTPS 仍可点击。

## 验证

- 完整 `npm test`：unit 330 / native 321 / boot-combination 170 / smoke 255 / regressions 730，合计 **1806 通过 / 0 失败**。
- 原独立探针：12 / 12 通过，包含标签即时刷新、在途改期/完成/删除、重启持久化、取消失败重试和 memory 后端快照隔离。
- Chromium 153：标签保存后立即显示 `#work #home`，无需重载；随后无变化刷新保留原卡片节点和编辑按钮焦点。
- Chromium 153：3 个畸形 URL 均无 `href`；正常 HTTPS 仍生成链接；带引号事项 ID 仍保持单一 `data-id` 属性。
- `git diff --check`：通过。

## 边界

本轮没有提交、推送、覆盖 APK 或修改真实事项。浏览器使用隔离的合成数据。Android SDK 中 adb 可执行，但 `adb devices -l` 返回空设备列表，因此没有把浏览器结果写成实机 PASS。设备连接并授权后，可再基于这份新源码哈希构建 APK 做目标环境验证。

证据目录：`docs/reviews/verification-runs/20260920T181826-code-optimization-repair/`。
