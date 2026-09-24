# P2-F2 `app-views.js` 独立复验

判定：**PASS（开发机源码、生产浏览器与 debug APK 资源身份）**。Android 实机展示、离线升级与用户提醒送达 **NOT_PERFORMED**，不能由本判定外推。

## 身份与边界

- 仓库 `/Users/qlyf/Developer/reminder`；`main`、HEAD 与 `origin/main` 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`。工作区保留原有未提交修改（收尾 `git status --short` 155 行），未 checkout/stash/reset/clean、未提交推送、未安装生产包。
- 产品源码 SHA-256：`app-core.js` `3eff2c1107c1f6d1f577a0dd2ea37480364495c284c9480e4aeb62cdc0241125`；`lib/app-views.js` `2ef2c72b6319feb3414fd07914804296d4f9fa7888a834b3d95f1a98b2fafa37`；`index.html` `4405a69f59fa6013af20cbfc158205d3fe44030728110127273ab2227c5fc558`；`sw.js` `87e730acb7607e434a1fb6b11ee81085718c4841b942b8dca7e5f84869ae145e`（缓存 v21）。最终测试文件身份另见 `final/source-hashes-end.txt`，测试字节随后扩充但产品四文件未变。
- 初次独立复验的失败证据保存在相邻 run `20260922T195213-independent-p2f2-recheck`，涉及 `startOfDay`、`pad2` 未注入以及原生对象过早捕获。它们不是本次最终字节的 PASS 证据；本轮用直接实例测试和真实页面重放复验了修复。

## 复验结果

- `npm test` 最终独立重跑 exit 0：unit **635**、native **324**、boot **466**、smoke **266**、regressions **730**、parse **160**，合计 **2581/0**；原始输出 `final/npm-test-final.log`。`node --check` 三个产品脚本与 `git diff --check` 均 exit 0。
- boot 正式反例真实抽掉 `lib/app-views.js`、让工厂抛错、返回缺 `priorityRank` 的实例：均 `ready=false`，点名 AppViews，IDB put 和业务心跳为零。`test-unit.js` 直接实例覆盖归档日期与 review 时间注入、Web→native live getter、四种卡片 mode 与危险输入、详情暂停截止和周期、项目选择器保留值。
- 生产 Chrome：`browser/views.log`、`independent-views-ui.json`、`independent-views-matrix.json` 全绿。独立矩阵核对 due/active 折叠展开、四种动作、安全转义、未来筛选/日历/归档、置顶笔记、项目选中值、详情暂停截止和重复规则；前一独立脚本核对节点短路、项目改名重建、详情打开与危险 URL 纯文本降级。content/setup/diagnostics 浏览器回归全绿；导入格式 **11/11 PASS**。这些浏览器操作使用临时 Chrome profile，不碰设备数据。
- 独立变异：`mutations/home-orchestration-probe.json` 删除 core 的 `promoteDue()` 后，同一 `renderHome()` 路径健康 `waiting→due`、变异仍 `waiting`；`mutations/signature-security-probe.json` 删除项目名签名后漏重绘，移除卡片 URL 白名单后生成危险链接，两条均健康绿/变异红。源文件前后哈希不变。另重跑实施方真实工厂变异 M1/M2，结果见 `mutations/implementer-mutation-rerun.json`；boot 缺模块/实例为第四类反例。首页变异初次使用“DOM 不显示”为判据得到假红：业务状态未推进，但 `isAttentionDue` 仍可显示该卡片；原始观测保留在 `mutations/home-orchestration-initial-falsecriterion.json`，最终以状态为判据。
- 隔离构建：先保留旧 P2-F1 debug APK `apk/prebuild-app-debug.apk`，然后 `npm run cap:sync`、`:app:assembleDebug` 成功。新 APK `apk/p2f2-app-debug.apk` SHA-256 `ad14f9593b60d6aef2ad43246991141224c52398597662ca1179897e8b8d3bb3`；`apk/resource-chain.json` 核对 **26/26** Web 资源在源码、`www`、Android assets、APK 内逐字节一致（missing/mismatch 均空）。

## 未执行与后续

未做 Android 真机页面操作、离线 SW v20→v21 升级重放、正式签名包与生产发布。此 run 只验收 P2-F2 模块迁出；P2-G capture 和 P3 仍需单独实施与独立复验。实施方 run `20260922T-p2f2-app-views-extraction` 是自测，不能替代本 run。
