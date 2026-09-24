# P2-F1 `app-content.js` 迁出：实施任务与独立验收计划

日期：2026-09-22。前置：P2-E 已由独立 run `20260922T165911-independent-p2e-recheck` 判定 PASS。状态：**交给其他 agent 实施；当前任务继续担任独立验收方。**

## 1. 本批范围与开工身份

本批只新增 `lib/app-content.js`，迁出笔记、项目和搜索能力；详情页与首页/日历/未来/归档/统计等视图留到 P2-F2 `app-views.js`。采用 UMD + `createAppContent(deps)`；模块求值零副作用，实例 `bind()` 幂等。

开工身份必须重新记录；计划时核心身份：

- HEAD / `origin/main`：`3574824357dc7beb04cbd3e32aa413cd508e8484`
- `app-core.js`：`fe5e9c233aceba2ebedcff64326d4cf33f2351cdab982d78cfd6899d01062ac0`
- `lib/app-setup.js`：`e7b000620da77777f0bd1cc5537d1f4a87aee0efc7aed6566d9248077a8ce112`
- 当前自动化：622 / 324 / 436 / 266 / 730 / 160，共 2,538 / 0

工作区仍有大量连续交付源码、生成资源、证据和 APK。禁止 checkout/restore/reset/stash/clean，不覆盖历史 run、release APK 或候选，不提交、不推送，不安装生产包。

## 2. 迁移清单与保留边界

从当前 `app-core.js` 迁出下列实现和私有状态：

- `openNote`
- `saveNote`
- `doSearch`
- `selectedColor`
- `renderProjectsSheet`
- `addProject`
- `deleteProject`
- 与上述能力独占的静态/委托绑定：`#btnSaveNote`、`#swNotePin`、`#btnNotePreview`、`#noteBody`、`#btnSearch`、`#searchInput`、`#btnProjects`、`#btnAddProject`、`[data-note]`、`[data-del-proj]`、`#projColors [data-color]`、`#btnNewNote`。

`applyProjectRemovalToItems(id)` 暂留 core，原因是它修改事项并 `bumpRev`，属于 P3 事项/事务命令。content 删除项目时必须调用注入的具名命令 `removeProjectFromItems(id)`；core 适配器继续走现有 `runUserOp(applyProjectRemovalToItems, [id])`。不得在模块内直接循环清理事项，不能绕过 active action 冲突域。

明确留在 core / 后续模块：

- `openDetail`、`renderItemCard`、`projectById`、`renderNotes`、`renderStats`、`renderMe`、`refreshProjectSelects` 的当前所有权；本批只经具名回调使用。
- `state`、`save()`、`render()`、统一确认框/toast/弹层、事务与持久化所有权。
- `PROJECT_COLORS` 可暂留 core 并经 getter 注入；不得复制出第二份颜色清单。若迁入 content，必须同时把初始状态默认颜色改为读取同一导出，证明只有一个来源。
- capture、views、setup、diagnostics、AI、backup、native、Java/Manifest/schema 均不在本批修改范围。

不改变笔记默认标题、置顶、预览、时间字段、搜索范围/分组/空态、项目 ID/颜色/删除确认、事项保留但去掉项目、保存提示及当前持久化调用时机。

## 3. 工厂与依赖合同

实例合同至少包含：

```text
bind
openNote
saveNote
doSearch
renderProjectsSheet
addProject
deleteProject
```

若 core、测试 hook 或后续装配还调用其他成员，逐项登记到 `APP_CONTENT_INSTANCE_CONTRACT`，并由 `contentInstanceCoverage()` 做双向闭合。检查与绑定必须使用同一次工厂实例。

所有可变数据走 live getter/具名函数，至少包括：

- DOM/UI：query、queryAll、getDocument、openSheet、closeSheet、toast、confirmDialog、escapeHtml、escapeAttr、renderMarkdown；
- 状态/持久化：getState、save、render；
- 共享展示：renderItemCard、refreshProjectSelects；
- 规则/命令：uid、getProjectColors、itemConflictsWithActiveAction、rejectPendingItemCommand、removeProjectFromItems。

不得缓存 `state.items/notes/projects/ui` 或装配时的项目颜色。不得注入整个可写 `ctx`，不得另建保存或事务路径。`bind()` 只绑定 content 拥有的选择器，实例内幂等；动态笔记、项目删除和颜色按钮走一条幂等 document 委托，不随 render 重复绑定。

## 4. 必须保持的行为

1. 新建笔记默认标题“无标题”，保存 title/body/project/pinned 和 createdAt/updatedAt；编辑保留 id/createdAt，只更新相关字段与 updatedAt。
2. 笔记预览继续走唯一 `renderMarkdown`，用户 HTML 不能变成可执行标签；隐藏/显示按钮和实时预览保持。
3. 搜索 trim + 小写后覆盖事项 title/note/tags/url、笔记 title/body、项目 name；空查询和无结果文案保持，所有用户文本继续转义。
4. 搜索结果中的事项继续复用当前 `renderItemCard`；卡片点击仍由详情/视图所有者处理，不复制详情路由。
5. 项目新增使用当前颜色，空名称拒绝；新增后 save、刷新项目面板及表单项目选择器、提示各一次。
6. 删除项目前先检查所有受影响事项是否与 active action 冲突；冲突时不改 projects/notes/items、不保存、不提示删除成功。
7. 删除成功保留事项与笔记，只清空关联 projectId；事项清理由注入的事务命令执行并 bump rev，笔记关联由 content 清理；最后走同一 save、重绘和提示。
8. 删除确认取消时零副作用；重复 bind 不重复确认、不重复 save、不重复创建笔记/项目。
9. P2-D/P2-E、capture、review 与 views 的既有 document 点击处理不得被截断或双触发。

## 5. 装配和加载闭环

- 增加 `AppContent` 必需命名空间、`createAppContent` 工厂及实例合同；缺脚本、空工厂、工厂抛错、逐成员缺失均在恢复/业务启动前可见失败，且 IDB put、排程和业务心跳为零。
- core 调用改走同一 `appContent` 实例；旧算法体、`selectedColor` 和 content 独占监听从 core 删除。
- `index.html` 在 `app-core.js` 前加载 `lib/app-content.js`。
- SW v19 → v20，并加入预缓存。
- 同步 boot EXPECTED、smoke VM、regressions LIB_SOURCES、`production-scripts.js` 命名空间与 `contentInstanceCoverage()`。
- `scripts/sync-www.js` 预计无需修改，但最终必须实测源码 → www → Android assets → APK。

## 6. 测试与可执行反例

### 模块行为

直接实例化真实 `lib/app-content.js`，覆盖：求值零副作用、全部 live getter、静态和 document 委托 bind 幂等、新建/编辑/置顶/预览、搜索各字段与转义、项目添加、删除取消、冲突拒绝、删除成功时事务命令恰一次、笔记/事项关联清理、save/render/提示次数。

旧 smoke/regressions 中对应生产 UI 路径必须继续驱动真实实例，不得复制算法或切片 core。需要测试 hook 时只转发当前实例。

### 启动反例

至少覆盖：缺脚本、空命名空间、工厂空壳、工厂抛错、逐一缺实例成员。每条要求 ready=false、可见点名且 IDB put/排程/2 秒与 15 秒业务定时器均为零。

### 至少四个变异

1. 删除 bind 幂等：重复绑定导致一次点击创建/保存两次，正式断言必须红。
2. 删除搜索/笔记输出转义：危险 HTML 出现在结果或预览链，正式安全断言必须红。
3. 项目删除绕过 `removeProjectFromItems` 或冲突检查：事项 rev/关联或在途保护断言必须红。
4. 清空实例合同或漏掉生产/harness 加载清单：静态闭合或 boot 必须红。

每条包含 anchor、健康对照、变异结果、产品哈希前后不变。变异仅用内存或临时副本。

### 浏览器与回归

新增 `scripts/verification/browser-content-check.py`，真实生产页至少覆盖：

- 纯 Web ready；
- 新建与编辑笔记、置顶、预览安全；
- 搜索事项/标签/项目/笔记及空态；
- 新增项目、取消删除、确认删除后事项仍在且 projectId 清空；
- 重复 bind 后一次点击只产生一次动作；
- P2-D diagnostics、P2-E setup 和导入检查继续通过。

最终执行完整 `npm test`、改动 JS `node --check`、Python compile、`git diff --check`、四组生产浏览器检查、隔离 debug APK 构建及全部 Web 资源逐字节比对。

## 7. 交接与独立验收

实施 run：`docs/reviews/verification-runs/<timestamp>-p2f1-app-content-extraction/`，包含 README、ownership、source hashes、原始测试/浏览器/变异日志、repo start/end、APK 资源 JSON（若实施方构建）和 NOT_PERFORMED。不得改旧 run。

真机数据、项目删除、文件/通知/设置等动作实施方不执行；明确记 NOT_PERFORMED。实施完成只报告自测，不得写独立 PASS。

独立验收将重新核对最终字节、content/视图/事务边界、所有权与监听唯一性，重跑完整自动化、生产浏览器、APK 比对，并另造“重复 bind”“危险搜索文本”“删除绕过事务”“漏加载/合同”反例。P2-F1 通过后才进入 P2-F2 `app-views.js`。

## 8. 可直接交给实施 agent 的指令

> 在 `/Users/qlyf/Developer/reminder` 执行 `docs/handoff/2026-09-22-p2f1-app-content-extraction-plan.md`。接续当前 dirty 工作区，把笔记、项目、搜索及其独占绑定完整迁到 UMD 工厂 `lib/app-content.js`。详情与通用视图留在 core/P2-F2；项目删除中的事项清理必须经 core 注入的现有事务命令，不能在模块里复制或绕过。闭合启动闸门、实例合同、index/SW v20、harness、生产覆盖、正式行为测试、浏览器与四类变异。保留所有既有修改、证据和 APK；不要 checkout/restore/reset/stash/clean，不提交推送，不执行真机或生产数据副作用。完成后产出独立新 run，只报告实施自测，交由当前任务复验。
