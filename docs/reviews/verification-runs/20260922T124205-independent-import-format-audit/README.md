# P2-C-S 整库导入格式安全面：独立诊断与实施交接

- run：独立诊断，目录名见本文件所在路径
- 仓库：/Users/qlyf/Developer/reminder
- HEAD / origin/main：3574824357dc7beb04cbd3e32aa413cd508e8484
- 审查对象：lib/app-backup.js 的整库恢复入口 importDataFile()
- 角色：独立验收方；本轮不改产品源码
- 当前结论：**FIX_REQUIRED**
- 与前序结论关系：P2-C-R 权威状态保护仍为 PASS；本报告处理此前明确顺延的“导入格式安全面”，不回滚前序结论。

## 1. 结论

当前入口只验证 data.items 是数组。只要这一项成立，文件就会进入覆盖确认并可写入权威存储。以下不安全输入均被当前实现当成成功导入：

- app 为其他应用或缺失；
- schema 缺失、字符串、1 或 999；
- notes/projects 缺失或类型错误；
- settings 为数组，或带任意未知键；
- settings.ai 带非空 API key 与任意 HTTP endpoint；
- 顶层带未知字段；
- items 中是空对象、数字；
- 两个事项使用同一个 id。

唯一被拒绝的 null item 也已经先弹出“覆盖当前数据”确认框，说明完整字段校验发生得太晚。

这是整库恢复路径，错误输入的代价是覆盖当前权威数据，因此本批次应作为下一项阻断修复，先于普通 P2 后续功能。

## 2. 独立反例结果

隔离探针使用真实 lib/app-backup.js、假 FileReader 和可计数的 confirm/save/render/toast。每组从同一份旧状态开始，结果如下：

| 反例 | 当前结果 | 不安全影响 |
| --- | --- | --- |
| foreign-app / missing-app | 成功导入 | 任意含 items 数组的 JSON 可冒充本应用备份 |
| future-schema=999 | 成功导入 | 旧程序静默解释未来结构 |
| schema 为字符串、1 或缺失 | 成功导入 | 版本契约完全未执行 |
| missing-notes / notes-object | 成功，notes 变空数组 | 无提示清空全部笔记 |
| projects-object | 成功，projects 变空数组 | 无提示清空全部项目 |
| settings-array | 成功 | 容器类型不受约束 |
| settings-unknown | 成功并持久化未知键 | 任意设置字段进入权威状态 |
| ai-secret-and-endpoint | 成功 | 文件可注入 AI 密钥和 HTTP endpoint |
| empty-item / number-item | 成功，生成“未命名”事项 | 垃圾数据被伪装成正常恢复 |
| duplicate-item-id | 成功 | 稳定身份冲突，后续编辑/排程按 id 查找会歧义 |
| null-item | 拒绝但 confirm=1 | 无写入，但错误文件仍先进入覆盖确认 |
| valid schema 2 / 5 | 成功 | 正向兼容面可保留 |

原始证据：

- evidence/current-import-format-probe.js
- evidence/current-import-format-probe.json
- evidence/current-import-format-summary.txt
- evidence/import-source-lines.txt

## 3. 兼容口径裁决

### 3.1 这是整库备份契约

docs/compose/spec/schemas/attention-inbox.export.v1.schema.json 描述的是对外“内容导出”格式 attention-inbox.export/v1，不是整库备份格式。不得把它直接套在 importDataFile() 上，否则会混淆“内容追加”和“整库覆盖”。

本批次只处理 buildLegacyBackupPayload() 生成、importDataFile() 消费的整库备份。

### 3.2 身份与版本

采用以下明确口径：

- app 必须逐字等于 attention-inbox；
- schema 必须是整数；
- 最低支持 schema 2；
- 最高支持当前 deps.getSchema()，当前为 5；
- schema 2、3、4、5 均允许，由既有 normalizeItem 做向当前结构的迁移；
- schema 缺失、字符串、低于 2或高于当前版本均整体拒绝；
- 未来 schema 的提示应明确要求先更新应用，不得假装“格式错误”。

依据：

- Git 历史可确认整库备份存在于 schema 2、3、4、5；
- Release 1.0 / 1.1 及当前设备候选均为 schema 5；
- schema 2 起的导出外壳均包含 app、schema、exportedAt、items、notes、projects、settings。

证据：evidence/schema-compatibility.txt。

### 3.3 顶层与未知字段

顶层必须恰好包含：

- app
- schema
- exportedAt
- items
- notes
- projects
- settings

缺失或多出任何键都整体拒绝并点名 JSON path。未知字段不能静默忽略，因为这是覆盖式恢复；同 schema 下出现未知键意味着文件不属于已知契约、被改写或已经漂移。

exportedAt 必须是可解析、带时区的 ISO 时间字符串。

### 3.4 容器与记录

- items、notes、projects 必须都是数组；settings 必须是普通对象。
- 每个数组元素必须是普通对象，禁止 null、数组和原始类型。
- items、notes、projects 各自的 id 必须是非空字符串且在本集合内唯一。
- item.title 必须是非空字符串。
- project.name 必须是非空字符串。
- note 同时兼容旧形态 text，以及当前形态 title/body/projectId/pinned/createdAt/updatedAt；已出现的字段必须满足类型。
- item 允许字段采用 schema 2–5 历史字段并集；缺失的迁移字段继续交给 normalizeItem 补齐。
- 所有时间字段只允许有限数字或 null；计数和 rev 使用非负/正整数约束。
- tags 必须是字符串数组。
- priority、status、review_status、delivery_mode、scheduleBasis 使用当前代码已支持的枚举。
- repeat、deadlineEvents、reminderEvents 必须递归验证为已知形状，不能只检查 typeof object。
- item/note/project 内的未知字段整体拒绝并点名路径。

当前设备真实备份的字段集合保存在 evidence/device-current-backup-shape.json，应作为正向对照。

### 3.5 settings

只能接收 buildLegacyBackupPayload() 实际导出的白名单：

- notify
- dnd
- importantRepeat
- quietStart
- quietEnd
- dailySummary
- privacyNotify
- defaultDeliveryMode
- userMode
- ai

各键按类型检查；schema 2–4 中尚未出现的后加键可以缺失，缺失时保留当前默认。

ai 只允许 enabled、baseUrl、apiKey、model、autoOnSave。baseUrl 与 apiKey 在整库备份中是脱敏占位，必须为空字符串；非空时整体拒绝，不能让文件修改本机密钥或请求终点。未知 settings/ai 键整体拒绝。

不得再把未经筛选的 data.settings 交给 Object.assign。

## 4. 实现顺序

建议批次名：P2-C-S。

### 步骤 A：在 lib/app-backup.js 建立唯一验证器

新增一个纯函数，例如 validateBackupPayload(data, currentSchema)，返回：

- ok
- code
- path
- message
- sanitized 或规范化前的安全副本

验证器必须：

1. 先验证整个 JSON 树；
2. 在任何 confirm、状态读写、save、render 之前完成；
3. 不调用 normalizeItem，不接触 state；
4. 对错误点返回稳定 code/path，测试不得只匹配一条通用文案；
5. 使用 Object.keys/hasOwn 处理 __proto__、constructor 等特殊键，不能依赖原型链。

格式规则只保留这一份。不要在 app-core.js 再复制一套。

### 步骤 B：改成“验证和准备在前，覆盖在后”

importDataFile() 顺序固定为：

1. FileReader 读取；
2. JSON.parse；
3. validateBackupPayload 全树验证；
4. 在脱离 state 的临时对象中对所有 items 执行 normalizeItem，并构造白名单 settings；
5. 检查 getInflightActionDepth；
6. 弹出覆盖确认；
7. 用户确认后一次性替换 items/notes/projects/settings；
8. await deps.save()；
9. 提交兑现后 render + 成功提示。

第 3 或第 4 步任一失败时：

- confirm=0；
- state 序列化字节不变；
- save=0；
- render=0；
- 不排通知、不排闹钟；
- 只给一次明确失败提示。

提交失败后的既有语义保持不变：内存状态保留，提示“数据未能保存”；本批次不改 G01/G02 已验收行为。

### 步骤 C：缓存身份

lib/app-backup.js 内容变化后，将 sw.js 的缓存名从 v15 升至 v16，并补本轮说明。脚本 URL 不变，不换缓存会让已安装用户继续使用旧验证逻辑。

预期 app-core.js 零字节变化；装配依赖和实例 API 不需要改变。若验证器作为模块级测试出口导出，也不要把它加入运行时实例契约。

## 5. 必须新增的反例

### 身份和版本

- wrong app；
- missing app；
- missing schema；
- schema 为字符串、浮点、1、current+1；
- schema 2、3、4、5 正向通过。

### 顶层和容器

- 缺 items/notes/projects/settings；
- 四个字段分别为 null、数组/对象错型；
- 顶层未知键；
- exportedAt 缺失、无时区、不可解析。

### 记录和身份

- item 为 null、数字、数组、空对象；
- item id 缺失/空/非字符串；
- title 缺失/空/非字符串；
- items 重复 id；
- notes/projects 重复 id；
- 非法枚举、NaN/Infinity 等非 JSON 场景通过直接函数测试；
- tags 非数组或含非字符串；
- nested events/repeat 错型；
- item/note/project 未知键。

### settings

- 未知 settings 键；
- 未知 ai 键；
- settings 为数组；
- ai 为数组/null；
- apiKey 非空；
- baseUrl 非空；
- 每个布尔/时间/枚举键的错型。

### 整体拒绝零副作用

每条失败反例必须同时断言：

- 错误 path/code 正确；
- 未弹确认框；
- state 的 JSON 字节前后相同；
- save/render 均为 0；
- 没有 IndexedDB put；
- 没有通知、闹钟或心跳副作用。

### 正向和既有语义

- 本轮真实 buildLegacyBackupPayload() 可回环；
- schema 2 的历史形状可迁移到 schema 5；
- 用户取消确认后零副作用；
- valid 文件只有 confirm 后才改内存；
- save 挂起时不渲染、不报成功；
- save 拒绝仍用 G02 专属文案；
- FileReader onerror/onabort 保持 G01；
- in-flight 操作仍拒绝覆盖。

## 6. 变异要求

至少保存四个“拔掉修复必红”的变异：

- M-S1：移除 app 检查，wrong-app 重新被接受；
- M-S2：移除 schema 上界，future-schema 重新被接受；
- M-S3：移除未知 settings 键检查，injected 键进入 state；
- M-S4：把验证移到 confirm 之后，坏文件重新触发确认。

每个变异都要由同一条正式测试变红，不能另写只服务于变异的测试。

## 7. 验证分层

实施方最低交付：

1. 定向 Node 反例与 test-unit.js；
2. npm test 全量回归；
3. Chrome 真实文件 input：wrong-app、future-schema、坏字段三类均不出现确认且 IDB puts=0；valid 控制组必须能进入确认；
4. SW v16 加载链与离线资源检查；
5. 产品源码、测试、脚本和证据 SHA-256 清单；
6. 明确 NOT_PERFORMED。

独立验收追加：

1. 不复用实施方 harness，独立构造 wrong-app、future-schema、notes 错型、重复 id；
2. 真 Android 文件选择器执行至少两个无效文件，导入前后比较 IDB 原始记录哈希；
3. schema 5 合法备份回环并冷启动确认持久化；
4. 验证失败不进入确认、不写库、不触发原生排程；
5. 重新核对 APK 内 lib/app-backup.js 与验收源码逐字节一致。

## 8. 文件所有权与保护边界

实施方建议只修改：

- lib/app-backup.js
- test-unit.js
- 必要的浏览器验证脚本
- sw.js
- 本批次证据目录

预期不修改 app-core.js、lib/storage.js 或原生 Android 代码。

工作区当前包含大量未提交成果与历史证据。禁止 checkout/stash/reset；不得覆盖已有 run。提交时只能暂存本批次明确路径，且需用户另行授权。

## 9. 本轮 NOT_PERFORMED

- 未修改产品源码；
- 未验证修复后行为，因为修复尚未实施；
- 未重跑 npm test；
- 未构建 APK；
- 未在真机执行破坏性导入；
- 未提交或推送。

本轮真机仅只读调用 buildLegacyBackupPayload() 获取当前备份字段形状，没有触发导入或写库。
