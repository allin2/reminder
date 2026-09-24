/* 数据备份（导出 / 导入）—— UMD（P2-C 搬移）
 *
 * 为什么单独成文件：这一段原先挤在 `app-core.js`（约 200 行），但它其实是
 * **两个方向相反、彼此独立的事**：
 *   · **导出** —— 拍快照 → 原生 saveDocument / Web 分享 / `<a download>` 三条通路，
 *     附带「在途闸门 + 操作身份 + 原生结果丢失宽限」这整套防卡死机制；
 *   · **导入** —— 读文件 → 确认 → 覆盖四类状态 → 保存渲染。
 * 两者都不需要知道事务、原生排程或渲染细节，却因为写在 IIFE 里而顺手拿到了
 * `state` / `save()` / `toast()` 的全部闭包权限。迁出之后，它对外的权力只剩
 * `createAppBackup(deps)` 那张清单上写明的几项。
 *
 * 边界（刻意**不**搬的部分）：
 *   · 「覆盖什么、怎么确认」的**用户确认语义**由 `confirmDialog` 提供（注入）——
 *     模块不自己发明第二个确认 UI；
 *   · 导入后的持久化走注入的 `save()` —— 与表单/撤销是**同一条**持久化命令，
 *     不为导入另起第二条写库路径（模块化计划的硬约束）；
 *   · `inflightActionDepth`（提醒操作在途计数）只读不写 —— 那是事务层的所有权。
 *
 * 已知缺口（刻意保留，**不在本轮修复**）：导出的 Web 回退通路走 `<a download>`，
 * Android WebView 没有 `DownloadListener` 接应 ⇒ 全机不会有文件落地，这就是
 * 「导出没有落地出口」待裁决缺陷（E1–E4，代码未动）。搬移**逐字保持**该行为，
 * 不顺手修 —— 修它属于产品决策，必须先过裁决。
 *
 * P2-C-S（整库导入格式安全面）：`importDataFile()` 的入口契约由 `validateBackupPayload()`
 * 单独守 —— 它把「哪个文件能覆盖本机数据」从 `Array.isArray(items)` 升级成整树契约
 * （app 身份 / schema 2..当前 / 顶层与记录字段集合 / 枚举 / settings 白名单 /
 * AI 密钥必须为空）。定义与口径见文件内「整库备份的格式契约」一节。
 *
 * 装配方式：导出 `createAppBackup(deps)`，由**入口统一实例化**。
 * 本模块求值不注册监听、不开定时器、不碰全局状态、不发起任何 IO ——
 * `exportInProgress` / `exportOperationId` / `pendingNativeExport` 是**实例内**
 * 的可变状态（同一份导出在途闸门对整份实例生效）。
 *
 * 依赖为什么一律是**函数**（不是值）：`state` 是被加载/导入反复替换内容的活对象，
 * `systemBridge` / `isNativeAndroidRuntime` 跟着重试重建的绑定走（F03），
 * `$` 来自 `createUi()` 的实例。按值传进来，就等于把「补载脚本后点重试」
 * 这条路在备份链上再堵死一次。
 *
 * 依赖方向：本模块不反向导入 `app-core`，也不读 `AttentionLib`。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppBackup = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  /**
   * 原生保存「结果未返回」的宽限时长。
   *
   * 系统文件选择器正常返回时，Capacitor 的 ActivityCallback 会直接兑现 Promise；
   * 若宿主 Activity 回到前台却一直没结果（厂商回收/请求丢失），等这段宽限后
   * 恢复按钮可重试，并明确说「结果无法确认」—— 绝不报保存成功。
   */
  const EXPORT_RESULT_GRACE_MS = 8000;

  /**
   * 判断分享失败是不是「用户主动取消」。
   *
   * `navigator.share` 被取消时抛 `AbortError`，但各家内核不统一 —— 有的把「取消」
   * 写进 message。宁可逐字匹配两种形态，也不能把「用户取消」报成「分享失败」：
   * 那会吓到用户去重试一个他们刚刚主动放弃的动作。
   */
  function isShareCancellation(error) {
    if (!error) return false;
    const name = String(error.name || "");
    const message = String(error.message || error);
    return name === "AbortError" || /abort|cancel|取消/i.test(message);
  }

  /** 导出成功提示（原生 saveDocument 返回了落点信息时带上）。 */
  function savedBackupMessage(result, fallbackName) {
    const fileName = result && result.fileName ? String(result.fileName) : fallbackName;
    const location = result && result.locationLabel ? String(result.locationLabel) : "你选择的位置";
    return "已保存「" + fileName + "」 · 位置：" + location;
  }

  /* ==================================================================
   * P2-C-S：整库备份的**格式契约**（唯一验证器）
   * ==================================================================
   * 为什么必须有它：`importDataFile()` 是**覆盖式恢复**入口 —— 通过校验的那一刻，
   * 用户当前的 items / notes / projects / settings 会被整份替换。此前这一层只检查
   * `Array.isArray(data.items)`，于是「别的应用的备份」「未来 schema」「缺 notes 或
   * notes 错型（静默清空全部笔记）」「文件里塞进 AI 密钥与任意 HTTP endpoint」
   * 全都算导入成功（独立诊断 `20260922T124205-independent-import-format-audit`，18 组反例）。
   *
   * 三条纪律：
   *   ① **整棵树先验完，再动任何东西** —— 确认框、state、save、render 全部排在验证之后；
   *   ② **未知字段整体拒绝并点名路径** —— 这是覆盖式恢复：同 schema 下冒出未知键，
   *      意味着文件不属于已知契约（被改写或已漂移），静默忽略等于把漂移数据写进权威库；
   *   ③ 本函数是**纯函数**：不碰 `state`、不调 `normalizeItem`、不注册副作用、不读时钟，
   *      失败时返回稳定的 `code` + `path`（测试不许只匹配一条通用文案）。
   *
   * 口径依据：`docs/reviews/verification-runs/20260922T124205-independent-import-format-audit/README.md` §3。
   * 字段表不是手抄的第二份真相：items 的字段集合与 `app-core.js` 的 `normalizeItem()`
   * 返回字段做了**集合相等**断言（见 `test-unit.js` 的「契约 vs normalizeItem」一条）。
   *
   * ⚠️ 本验证器只作为**模块级测试出口**导出（`validateBackupPayload` / `BACKUP_CONTRACT`），
   * 不进运行时实例契约 —— `createAppBackup()` 返回的仍是原来的四个成员。
   */
  const BACKUP_APP_ID = "attention-inbox";
  const MIN_SUPPORTED_SCHEMA = 2;

  /** 顶层键集合：缺失或多出任何一个都整体拒绝（schema 2–5 的导出外壳均含这七个）。 */
  const TOP_LEVEL_KEYS = ["app", "schema", "exportedAt", "items", "notes", "projects", "settings"];

  /** items 允许字段 —— 与 `app-core.js` 的 `normalizeItem()` 返回字段逐一相等。 */
  const ITEM_KEYS = [
    "id", "title", "note", "tags", "url", "projectId", "priority", "status",
    "triggerAt", "windowStart", "windowEnd", "deadlineAt", "repeat", "createdAt",
    "acknowledgedAt", "completedAt", "snoozeCount", "deliveredAt", "remindCount",
    "lastRemindAt", "lastAlertShownAt", "scheduleBasis", "localTrigger", "snoozedAt",
    "snoozeDelayMs", "dismissedUntil", "review_status", "reviewed_at", "sourceTitle",
    "sourceApp", "delivery_mode", "isFallbackTrigger", "deadlineStageKey",
    "deadlineEvents", "reminderEvents", "deadlinePaused", "ackAdvancedAt", "rev",
    "seriesId", "repeatParentId"
  ];

  /** 笔记：旧形态 `text` 与当前形态的并集（app-core 的 `state.notes.push` 与历史数据）。 */
  const NOTE_KEYS = ["id", "text", "title", "body", "projectId", "pinned", "createdAt", "updatedAt"];

  /** 项目：`state.projects.push({ id: "p_" + uid(), name, color })`。 */
  const PROJECT_KEYS = ["id", "name", "color"];

  /** 设置：`buildLegacyBackupPayload()` 实际导出的白名单 —— 多一个键都拒绝。 */
  const SETTING_KEYS = ["notify", "dnd", "importantRepeat", "quietStart", "quietEnd",
    "dailySummary", "privacyNotify", "defaultDeliveryMode", "userMode", "ai"];

  /**
   * `settings.ai` 允许键。`baseUrl` / `apiKey` 在这个格式里是**脱敏占位**，
   * 只允许空串：备份文件会离开设备（分享 / 云盘），能改本机密钥或请求终点的
   * 文件不算备份。导入侧也**从不**用它们覆盖本机值（见 `mergeImportedSettings`）。
   */
  const AI_KEYS = ["enabled", "baseUrl", "apiKey", "model", "autoOnSave"];
  const AI_CLEARED_KEYS = ["baseUrl", "apiKey"];

  const ITEM_PRIORITIES = ["normal", "important", "critical"];
  const ITEM_STATUSES = ["waiting", "due", "snoozed", "acknowledged", "archived", "completed"];
  const REVIEW_STATUSES = ["READY", "NEEDS_REVIEW", "REVIEWED"];
  const DELIVERY_MODES = ["alarm", "notification"];
  const SCHEDULE_BASES = ["wall-clock", "elapsed"];
  const USER_MODES = ["beginner", "normal"];

  const REPEAT_KEYS = ["every", "mode", "nth", "dow"];
  const REPEAT_EVERY = ["day", "week", "biweek", "month", "monthEnd", "nthWeekday"];
  const REPEAT_MODES = ["calendar", "ack"];

  const DEADLINE_EVENT_KEYS = ["at", "state"];
  const DEADLINE_EVENT_STATES = ["scheduled", "delivered", "cancelled"];
  const REMINDER_EVENT_KEYS = ["at", "state", "roundBase", "receivedAt", "carrier",
    "level", "source", "suppressedAt"];
  const REMINDER_EVENT_STATES = ["scheduled", "delivered", "cancelled", "suppressed"];

  const ITEM_STRING_FIELDS = ["note", "url", "projectId", "sourceTitle", "sourceApp"];
  const ITEM_TIME_FIELDS = ["triggerAt", "windowStart", "windowEnd", "deadlineAt", "createdAt",
    "acknowledgedAt", "completedAt", "deliveredAt", "lastRemindAt", "lastAlertShownAt",
    "snoozedAt", "dismissedUntil", "reviewed_at", "ackAdvancedAt"];
  const NOTE_TIME_FIELDS = ["createdAt", "updatedAt"];
  const ITEM_NULLABLE_STRING_FIELDS = ["localTrigger", "deadlineStageKey", "seriesId", "repeatParentId"];
  const ITEM_BOOLEAN_FIELDS = ["isFallbackTrigger", "deadlinePaused"];
  const ITEM_COUNT_FIELDS = ["snoozeCount", "remindCount"];

  /** 供测试与人工核对使用的契约快照（冻结，防止调用方就地改写）。 */
  const BACKUP_CONTRACT = Object.freeze({
    app: BACKUP_APP_ID,
    minSchema: MIN_SUPPORTED_SCHEMA,
    topLevelKeys: TOP_LEVEL_KEYS.slice(),
    itemKeys: ITEM_KEYS.slice(),
    noteKeys: NOTE_KEYS.slice(),
    projectKeys: PROJECT_KEYS.slice(),
    settingKeys: SETTING_KEYS.slice(),
    aiKeys: AI_KEYS.slice(),
    aiClearedKeys: AI_CLEARED_KEYS.slice(),
    enums: Object.freeze({
      priority: ITEM_PRIORITIES.slice(),
      status: ITEM_STATUSES.slice(),
      reviewStatus: REVIEW_STATUSES.slice(),
      deliveryMode: DELIVERY_MODES.slice(),
      scheduleBasis: SCHEDULE_BASES.slice(),
      userMode: USER_MODES.slice(),
      repeatEvery: REPEAT_EVERY.slice(),
      repeatMode: REPEAT_MODES.slice(),
      deadlineEventState: DEADLINE_EVENT_STATES.slice(),
      reminderEventState: REMINDER_EVENT_STATES.slice()
    }),
    eventKeys: Object.freeze({
      deadlineEvents: DEADLINE_EVENT_KEYS.slice(),
      reminderEvents: REMINDER_EVENT_KEYS.slice()
    })
  });

  /** 稳定失败对象：`code` 机器可读，`path` 指到具体字段（测试按这两项断言）。 */
  function formatFailure(code, path, message) {
    return { ok: false, code: code, path: path, message: message };
  }

  function hasOwnKey(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
  }

  /**
   * 「JSON 原生普通对象」：`JSON.parse` 的产物、对象字面量、`Object.create(null)` 都算；
   * `null` / 数组 / `Date` / 类实例一律不算。**不查原型链** —— 所有取键都用
   * `Object.keys` + `hasOwnProperty`，于是 `__proto__`、`constructor` 只会作为
   * 普通未知键被点名拒绝，不会顺着原型链变成「已知字段」。
   */
  function isPlainRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function isFiniteNumberValue(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isIntegerValue(value) {
    return typeof value === "number" && Number.isInteger(value);
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
  }

  function isEnumValue(value, allowed) {
    return typeof value === "string" && allowed.indexOf(value) >= 0;
  }

  /** 第一个未知键的路径；全在允许集合里时返回 null。 */
  function firstUnknownKey(record, allowed, basePath) {
    const keys = Object.keys(record);
    for (let i = 0; i < keys.length; i++) {
      if (allowed.indexOf(keys[i]) < 0) return basePath + "." + keys[i];
    }
    return null;
  }

  /** 按顺序取第一个失败（`null` 表示这条过了）。 */
  function firstFailure(checks) {
    for (let i = 0; i < checks.length; i++) {
      if (checks[i]) return checks[i];
    }
    return null;
  }

  function checkStringField(record, key, path) {
    if (!hasOwnKey(record, key)) return null;
    if (typeof record[key] !== "string") {
      return formatFailure("field-type", path + "." + key, "必须是字符串");
    }
    return null;
  }

  function checkNullableStringField(record, key, path) {
    if (!hasOwnKey(record, key)) return null;
    if (record[key] === null) return null;
    if (!isNonEmptyString(record[key])) {
      return formatFailure("field-type", path + "." + key, "必须是非空字符串或 null");
    }
    return null;
  }

  /**
   * 严格带时区的 ISO 8601 时间字符串 ⇒ epoch 毫秒；不合规返回 null。
   *
   * B1（独立复验 20260922T134219）的根因：应用历史上把 `createdAt` 持久化成
   * `"2026-09-21T08:00:00+08:00"` 这样的带时区 ISO 字符串（`normalizeItem` 对
   * truthy createdAt 原样保留），而验证器只认数字 ⇒ **应用自己的导出过不了
   * 自己的导入**，「当前导出→当前导入」回环断裂。判据与 `exportedAt` 完全一致：
   * 必须显式带 `Z` 或 `±HH:MM` 时区、`Date.parse` 有效、且解析结果非负 ——
   * 无时区串、任意文字串、1970 前的日期（解析为负毫秒，会破坏「时间戳非负」
   * 的 sanitized 不变量）一律拒绝。绝不放宽成「任意字符串时间都接受」。
   */
  function parseIsoTimeField(value) {
    if (typeof value !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
      return null;
    }
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || ms < 0) return null;
    return ms;
  }

  /** 时间戳：非负 epoch 毫秒数字、null，或上述带时区 ISO 字符串。其余一律拒绝。 */
  function checkTimeField(record, key, path) {
    if (!hasOwnKey(record, key)) return null;
    if (record[key] === null) return null;
    if (isFiniteNumberValue(record[key]) && record[key] >= 0) return null;
    if (parseIsoTimeField(record[key]) !== null) return null;
    return formatFailure("field-type", path + "." + key,
      "时间戳必须是有限数字（毫秒）、null 或带时区的 ISO 时间字符串");
  }

  function checkBooleanField(record, key, path) {
    if (!hasOwnKey(record, key)) return null;
    if (typeof record[key] !== "boolean") {
      return formatFailure("field-type", path + "." + key, "必须是布尔值");
    }
    return null;
  }

  function checkCountField(record, key, path) {
    if (!hasOwnKey(record, key)) return null;
    if (!isIntegerValue(record[key]) || record[key] < 0) {
      return formatFailure("field-type", path + "." + key, "必须是非负整数");
    }
    return null;
  }

  function checkEnumField(record, key, path, allowed) {
    if (!hasOwnKey(record, key)) return null;
    if (!isEnumValue(record[key], allowed)) {
      return formatFailure("enum-invalid", path + "." + key,
        "取值不在支持的枚举里：" + allowed.join(" | "));
    }
    return null;
  }

  /* ---------- repeat / 事件台账：必须递归验到已知形状 ---------- */

  function checkRepeat(repeat, path) {
    if (!isPlainRecord(repeat)) {
      return formatFailure("field-type", path, "repeat 必须是普通对象或 null");
    }
    const unknown = firstUnknownKey(repeat, REPEAT_KEYS, path);
    if (unknown) {
      return formatFailure("unknown-key", unknown, "repeat 里出现未知字段");
    }
    if (!hasOwnKey(repeat, "every")) {
      return formatFailure("missing-key", path + ".every", "repeat 缺少 every");
    }
    if (!isEnumValue(repeat.every, REPEAT_EVERY)) {
      return formatFailure("enum-invalid", path + ".every",
        "repeat.every 不在支持的枚举里：" + REPEAT_EVERY.join(" | "));
    }
    if (hasOwnKey(repeat, "mode") && !isEnumValue(repeat.mode, REPEAT_MODES)) {
      return formatFailure("enum-invalid", path + ".mode",
        "repeat.mode 不在支持的枚举里：" + REPEAT_MODES.join(" | "));
    }
    // nth / dow 只约束「整数或 null」：取值范围（1..4 / -1、0..6）由生成方收窄
    // （parse-cn / app-ai 的 REPEAT_EVERY 白名单与 parseInt），格式层不重复一套边界，
    // 免得把模型给出的合法整数挡在恢复之外。
    const intFields = ["nth", "dow"];
    for (let i = 0; i < intFields.length; i++) {
      const key = intFields[i];
      if (!hasOwnKey(repeat, key) || repeat[key] === null) continue;
      if (!isIntegerValue(repeat[key])) {
        return formatFailure("field-type", path + "." + key, "必须是整数或 null");
      }
    }
    return null;
  }

  /**
   * 事件台账：`{ "<key>": { at, state, ... } }`。
   *
   * 为什么不能只查 `typeof === "object"`：这两张表是**补投准入**的唯一凭据
   * （`applyReminderEvents` / `applyDeadlineEvents` 按键查 `state`），
   * 一个 `{ state: "???" }` 或 `[]` 会静默改掉「这条提醒是否已消费」的判定。
   */
  function checkEventTable(table, path, allowedKeys, states) {
    if (!isPlainRecord(table)) {
      return formatFailure("field-type", path, "事件台账必须是普通对象");
    }
    const keys = Object.keys(table);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const entryPath = path + '["' + key + '"]';
      if (!isNonEmptyString(key)) {
        return formatFailure("event-key-invalid", path, "事件台账的键必须是非空字符串");
      }
      const entry = table[key];
      if (!isPlainRecord(entry)) {
        return formatFailure("field-type", entryPath, "事件条目必须是普通对象");
      }
      const unknown = firstUnknownKey(entry, allowedKeys, entryPath);
      if (unknown) {
        return formatFailure("unknown-key", unknown, "事件条目里出现未知字段");
      }
      if (!isEnumValue(entry.state, states)) {
        return formatFailure("enum-invalid", entryPath + ".state",
          "事件 state 不在支持的枚举里：" + states.join(" | "));
      }
      if (hasOwnKey(entry, "at")) {
        if (!isFiniteNumberValue(entry.at) || entry.at < 0) {
          return formatFailure("field-type", entryPath + ".at", "事件 at 必须是有限数字");
        }
      }
      const numericKeys = ["roundBase", "receivedAt", "suppressedAt"];
      for (let n = 0; n < numericKeys.length; n++) {
        const nk = numericKeys[n];
        if (!hasOwnKey(entry, nk) || entry[nk] === null) continue;
        if (!isFiniteNumberValue(entry[nk])) {
          return formatFailure("field-type", entryPath + "." + nk, "必须是有限数字");
        }
      }
      const textKeys = ["carrier", "level", "source"];
      for (let t = 0; t < textKeys.length; t++) {
        const tk = textKeys[t];
        if (!hasOwnKey(entry, tk) || entry[tk] === null) continue;
        if (typeof entry[tk] !== "string") {
          return formatFailure("field-type", entryPath + "." + tk, "必须是字符串");
        }
      }
    }
    return null;
  }

  /* ---------- 三类集合 ---------- */

  function checkItemRecord(record, path, seenIds) {
    const unknown = firstUnknownKey(record, ITEM_KEYS, path);
    if (unknown) return formatFailure("unknown-key", unknown, "事项里出现未知字段");
    if (!isNonEmptyString(record.id)) {
      return formatFailure("id-invalid", path + ".id", "事项 id 必须是非空字符串");
    }
    if (seenIds.has(record.id)) {
      return formatFailure("duplicate-id", path + ".id", "同一集合内 id 必须唯一");
    }
    seenIds.add(record.id);
    if (!isNonEmptyString(record.title)) {
      return formatFailure("title-invalid", path + ".title", "事项 title 必须是非空字符串");
    }
    if (hasOwnKey(record, "tags")) {
      if (!Array.isArray(record.tags)) {
        return formatFailure("field-type", path + ".tags", "tags 必须是字符串数组");
      }
      for (let i = 0; i < record.tags.length; i++) {
        if (typeof record.tags[i] !== "string") {
          return formatFailure("field-type", path + ".tags[" + i + "]", "tags 只能包含字符串");
        }
      }
    }
    for (let i = 0; i < ITEM_STRING_FIELDS.length; i++) {
      const bad = checkStringField(record, ITEM_STRING_FIELDS[i], path);
      if (bad) return bad;
    }
    for (let i = 0; i < ITEM_TIME_FIELDS.length; i++) {
      const bad = checkTimeField(record, ITEM_TIME_FIELDS[i], path);
      if (bad) return bad;
    }
    for (let i = 0; i < ITEM_NULLABLE_STRING_FIELDS.length; i++) {
      const bad = checkNullableStringField(record, ITEM_NULLABLE_STRING_FIELDS[i], path);
      if (bad) return bad;
    }
    for (let i = 0; i < ITEM_BOOLEAN_FIELDS.length; i++) {
      const bad = checkBooleanField(record, ITEM_BOOLEAN_FIELDS[i], path);
      if (bad) return bad;
    }
    for (let i = 0; i < ITEM_COUNT_FIELDS.length; i++) {
      const bad = checkCountField(record, ITEM_COUNT_FIELDS[i], path);
      if (bad) return bad;
    }
    if (hasOwnKey(record, "snoozeDelayMs") && record.snoozeDelayMs !== null) {
      if (!isFiniteNumberValue(record.snoozeDelayMs) || record.snoozeDelayMs < 0) {
        return formatFailure("field-type", path + ".snoozeDelayMs", "必须是有限数字（≥0）或 null");
      }
    }
    // rev：`hasKnownRev()` 把 0 当「版本未知」⇒ 该事项的旧通知版本校验被整体关闭。
    // 覆盖式恢复不接受这种「看起来正常、实际取消了保护」的取值。
    if (hasOwnKey(record, "rev")) {
      if (!isIntegerValue(record.rev) || record.rev < 1) {
        return formatFailure("field-type", path + ".rev", "rev 必须是正整数");
      }
    }
    const enums = [
      ["priority", ITEM_PRIORITIES], ["status", ITEM_STATUSES],
      ["review_status", REVIEW_STATUSES], ["delivery_mode", DELIVERY_MODES],
      ["scheduleBasis", SCHEDULE_BASES]
    ];
    for (let i = 0; i < enums.length; i++) {
      const key = enums[i][0];
      const allowed = enums[i][1];
      if (!hasOwnKey(record, key)) continue;
      if (record[key] === null) {
        // 只有「可空」的三个语义字段允许 null（normalizeItem 会按当前默认补齐）
        if (key === "delivery_mode" || key === "scheduleBasis") continue;
        return formatFailure("enum-invalid", path + "." + key, "取值不在支持的枚举里：" + allowed.join(" | "));
      }
      if (!isEnumValue(record[key], allowed)) {
        return formatFailure("enum-invalid", path + "." + key, "取值不在支持的枚举里：" + allowed.join(" | "));
      }
    }
    if (hasOwnKey(record, "repeat") && record.repeat !== null) {
      const bad = checkRepeat(record.repeat, path + ".repeat");
      if (bad) return bad;
    }
    if (hasOwnKey(record, "deadlineEvents")) {
      const bad = checkEventTable(record.deadlineEvents, path + ".deadlineEvents",
        DEADLINE_EVENT_KEYS, DEADLINE_EVENT_STATES);
      if (bad) return bad;
    }
    if (hasOwnKey(record, "reminderEvents")) {
      const bad = checkEventTable(record.reminderEvents, path + ".reminderEvents",
        REMINDER_EVENT_KEYS, REMINDER_EVENT_STATES);
      if (bad) return bad;
    }
    return null;
  }

  function checkNoteRecord(record, path, seenIds) {
    const unknown = firstUnknownKey(record, NOTE_KEYS, path);
    if (unknown) return formatFailure("unknown-key", unknown, "笔记里出现未知字段");
    if (!isNonEmptyString(record.id)) {
      return formatFailure("id-invalid", path + ".id", "笔记 id 必须是非空字符串");
    }
    if (seenIds.has(record.id)) {
      return formatFailure("duplicate-id", path + ".id", "同一集合内 id 必须唯一");
    }
    seenIds.add(record.id);
    const strings = ["text", "title", "body", "projectId"];
    for (let i = 0; i < strings.length; i++) {
      const bad = checkStringField(record, strings[i], path);
      if (bad) return bad;
    }
    if (hasOwnKey(record, "pinned") && typeof record.pinned !== "boolean") {
      return formatFailure("field-type", path + ".pinned", "必须是布尔值");
    }
    const times = NOTE_TIME_FIELDS;
    for (let i = 0; i < times.length; i++) {
      const bad = checkTimeField(record, times[i], path);
      if (bad) return bad;
    }
    return null;
  }

  function checkProjectRecord(record, path, seenIds) {
    const unknown = firstUnknownKey(record, PROJECT_KEYS, path);
    if (unknown) return formatFailure("unknown-key", unknown, "项目里出现未知字段");
    if (!isNonEmptyString(record.id)) {
      return formatFailure("id-invalid", path + ".id", "项目 id 必须是非空字符串");
    }
    if (seenIds.has(record.id)) {
      return formatFailure("duplicate-id", path + ".id", "同一集合内 id 必须唯一");
    }
    seenIds.add(record.id);
    if (!isNonEmptyString(record.name)) {
      return formatFailure("name-invalid", path + ".name", "项目 name 必须是非空字符串");
    }
    if (hasOwnKey(record, "color") && typeof record.color !== "string") {
      return formatFailure("field-type", path + ".color", "必须是字符串");
    }
    return null;
  }

  /** 数组容器 + 逐元素校验（`check` 负责元素是普通对象的判断由调用方前置）。 */
  function checkRecordList(list, listPath, check) {
    const seenIds = new Set();
    for (let i = 0; i < list.length; i++) {
      const path = listPath + "[" + i + "]";
      const record = list[i];
      if (!isPlainRecord(record)) {
        return formatFailure("record-type", path,
          "数组元素必须是普通对象（不允许 null / 数组 / 原始类型）");
      }
      const bad = check(record, path, seenIds);
      if (bad) return bad;
    }
    return null;
  }

  /* ---------- settings ---------- */

  function checkSettings(settings) {
    if (!isPlainRecord(settings)) {
      return formatFailure("container-type", "settings", "settings 必须是普通对象");
    }
    const unknown = firstUnknownKey(settings, SETTING_KEYS, "settings");
    if (unknown) return formatFailure("unknown-key", unknown, "设置里出现未知字段");

    const booleanKeys = ["notify", "dnd", "importantRepeat", "dailySummary", "privacyNotify"];
    for (let i = 0; i < booleanKeys.length; i++) {
      const bad = checkBooleanField(settings, booleanKeys[i], "settings");
      if (bad) return bad;
    }
    const clockKeys = ["quietStart", "quietEnd"];
    for (let i = 0; i < clockKeys.length; i++) {
      const key = clockKeys[i];
      if (!hasOwnKey(settings, key)) continue;
      // 独立复验 20260922T134219 §6 指出「文案说 HH:MM、判据只查非空」不一致；
      // 本轮选择收紧为合法 HH:MM（`reminder.js` 对非法值会静默回退默认时刻，
      // 与其让坏值落库再回退，不如在恢复入口挡下）。
      if (typeof settings[key] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings[key])) {
        return formatFailure("field-type", "settings." + key, "必须是形如 23:00 的合法 HH:MM 时刻");
      }
    }
    const enumKeys = [["defaultDeliveryMode", DELIVERY_MODES], ["userMode", USER_MODES]];
    for (let i = 0; i < enumKeys.length; i++) {
      const bad = checkEnumField(settings, enumKeys[i][0], "settings", enumKeys[i][1]);
      if (bad) return bad;
    }

    if (!hasOwnKey(settings, "ai")) return null;
    const ai = settings.ai;
    if (!isPlainRecord(ai)) {
      return formatFailure("field-type", "settings.ai", "ai 必须是普通对象");
    }
    const unknownAi = firstUnknownKey(ai, AI_KEYS, "settings.ai");
    if (unknownAi) return formatFailure("unknown-key", unknownAi, "AI 设置里出现未知字段");
    const aiBooleans = ["enabled", "autoOnSave"];
    for (let i = 0; i < aiBooleans.length; i++) {
      const bad = checkBooleanField(ai, aiBooleans[i], "settings.ai");
      if (bad) return bad;
    }
    const badModel = checkStringField(ai, "model", "settings.ai");
    if (badModel) return badModel;
    for (let i = 0; i < AI_CLEARED_KEYS.length; i++) {
      const key = AI_CLEARED_KEYS[i];
      if (!hasOwnKey(ai, key)) continue;
      if (typeof ai[key] !== "string") {
        return formatFailure("field-type", "settings.ai." + key, "必须是字符串");
      }
      if (ai[key] !== "") {
        // 备份里的密钥/终点是脱敏占位，只能为空；非空即视为注入尝试，整体拒绝。
        return formatFailure("ai-credential-not-empty", "settings.ai." + key,
          "备份中的 AI 密钥与请求终点必须为空串（脱敏占位）");
      }
    }
    return null;
  }

  function checkExportedAt(data) {
    const raw = data.exportedAt;
    if (typeof raw !== "string" || !raw) {
      return formatFailure("field-type", "exportedAt", "exportedAt 必须是非空字符串");
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
      return formatFailure("time-format", "exportedAt", "exportedAt 必须是带时区的 ISO 时间（如 2026-09-22T12:00:00.000Z）");
    }
    if (!Number.isFinite(Date.parse(raw))) {
      return formatFailure("time-format", "exportedAt", "exportedAt 不是可解析的时间");
    }
    return null;
  }

  /* ---------- 安全副本（只在整树验证通过后构造） ---------- */

  function pickFields(record, allowed) {
    const out = {};
    for (let i = 0; i < allowed.length; i++) {
      const key = allowed[i];
      if (hasOwnKey(record, key)) out[key] = record[key];
    }
    return out;
  }

  /**
   * B1 的一次性时间迁移：合规 ISO 字符串 ⇒ epoch 毫秒（就地改的是 `pickFields`
   * 产出的**新副本**，原始文件对象不动）。到这里验证已整树通过，字符串只可能
   * 是 `parseIsoTimeField` 认可的形态 —— 但仍走同一函数，不另写一套解析。
   * 数字与 null 原样保留；绝不能把字符串继续写进权威状态，否则下一轮导出
   * 还是字符串，迁移永远不收敛。
   */
  function sanitizeTimeFields(record, keys) {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!hasOwnKey(record, key)) continue;
      const ms = parseIsoTimeField(record[key]);
      if (ms !== null) record[key] = ms;
    }
    return record;
  }

  /**
   * 整库备份格式契约的唯一验证器。
   *
   * @param {*} data          `JSON.parse` 的结果
   * @param {number} currentSchema  `deps.getSchema()`（当前支持的最高版本）
   * @returns {{ok:true, sanitized:object} | {ok:false, code:string, path:string, message:string}}
   */
  function validateBackupPayload(data, currentSchema) {
    if (!isPlainRecord(data)) {
      return formatFailure("root-type", "$", "备份根必须是 JSON 对象");
    }
    // ① 身份：逐字等于应用标识，否则任何含 items 数组的 JSON 都能冒充本应用备份
    if (!hasOwnKey(data, "app")) {
      return formatFailure("app-missing", "app", "不是本应用的备份：缺少 app 标识");
    }
    if (data.app !== BACKUP_APP_ID) {
      return formatFailure("app-mismatch", "app", "不是本应用的备份：app 必须是 " + BACKUP_APP_ID);
    }
    // ② 版本：整数、不低于 2、不高于当前支持版本
    if (!hasOwnKey(data, "schema")) {
      return formatFailure("schema-missing", "schema", "缺少 schema 版本");
    }
    const schema = data.schema;
    if (!isIntegerValue(schema)) {
      return formatFailure("schema-type", "schema", "schema 必须是整数");
    }
    if (schema < MIN_SUPPORTED_SCHEMA) {
      const tooOld = formatFailure("schema-too-old", "schema",
        "备份版本过旧（schema " + schema + " < " + MIN_SUPPORTED_SCHEMA + "），无法恢复");
      tooOld.schema = schema;
      return tooOld;
    }
    if (!isIntegerValue(currentSchema)) {
      // 拿不到当前版本就 fail closed：绝不能把「未来 schema」当未知放过去
      return formatFailure("schema-limit-unavailable", "schema",
        "无法确定当前支持的 schema 版本，拒绝导入");
    }
    if (schema > currentSchema) {
      const tooNew = formatFailure("schema-too-new", "schema",
        "备份来自更新版本（schema " + schema + " > " + currentSchema + "），请先更新应用");
      tooNew.schema = schema;
      return tooNew;
    }
    // ③ 顶层键集合：缺失或多出都拒绝
    const unknown = firstUnknownKey(data, TOP_LEVEL_KEYS, "");
    if (unknown) {
      return formatFailure("unknown-key", unknown.replace(/^\./, ""), "顶层出现未知字段");
    }
    for (let i = 0; i < TOP_LEVEL_KEYS.length; i++) {
      if (!hasOwnKey(data, TOP_LEVEL_KEYS[i])) {
        return formatFailure("missing-key", TOP_LEVEL_KEYS[i],
          "顶层缺少必需字段 " + TOP_LEVEL_KEYS[i]);
      }
    }
    // ④ 容器类型
    if (!Array.isArray(data.items)) {
      return formatFailure("container-type", "items", "items 必须是数组");
    }
    if (!Array.isArray(data.notes)) {
      return formatFailure("container-type", "notes", "notes 必须是数组");
    }
    if (!Array.isArray(data.projects)) {
      return formatFailure("container-type", "projects", "projects 必须是数组");
    }
    // ⑤ 整树验证（全部先验完，再产出任何东西）
    const failure = firstFailure([
      checkExportedAt(data),
      checkRecordList(data.items, "items", checkItemRecord),
      checkRecordList(data.notes, "notes", checkNoteRecord),
      checkRecordList(data.projects, "projects", checkProjectRecord),
      checkSettings(data.settings)
    ]);
    if (failure) return failure;

    return {
      ok: true,
      code: "ok",
      path: "",
      message: "",
      sanitized: {
        app: BACKUP_APP_ID,
        schema: schema,
        exportedAt: data.exportedAt,
        items: data.items.map(function (record) {
          return sanitizeTimeFields(pickFields(record, ITEM_KEYS), ITEM_TIME_FIELDS);
        }),
        notes: data.notes.map(function (record) {
          return sanitizeTimeFields(pickFields(record, NOTE_KEYS), NOTE_TIME_FIELDS);
        }),
        projects: data.projects.map(function (record) { return pickFields(record, PROJECT_KEYS); }),
        settings: pickFields(data.settings, SETTING_KEYS)
      }
    };
  }

  /**
   * 失败提示：`schema-too-new` 与「不是本应用的备份」各有专属文案 ——
   * 把「请先更新应用」说成「格式不正确」会让人去修一个根本不该修的文件。
   * 其余格式错误点名具体路径（覆盖式恢复时，知道是哪个字段坏的最省事）。
   */
  function importFailureMessage(failure) {
    if (failure.code === "schema-too-new") {
      return "导入失败：这份备份来自更新版本（schema " + failure.schema +
        "）· 请先更新应用再导入";
    }
    if (failure.code === "schema-too-old") {
      return "导入失败：这份备份的版本过旧（schema " + failure.schema + "）· 无法恢复";
    }
    if (failure.code === "app-mismatch" || failure.code === "app-missing") {
      return "导入失败：这不是「安心收件箱」的备份文件";
    }
    return "导入失败：备份格式不正确（" + failure.path + "）";
  }

  /**
   * 白名单设置合并：只吸收备份里**出现过的白名单键**，其余键（`review` /
   * `notifyPrompted` / `onboardDone` / …）保留本机当前值 —— 它们不在导出白名单里，
   * 丢掉等于每次导入都把本机设置悄悄重置。
   *
   * `ai.baseUrl` / `ai.apiKey` **永远取本机值**：文件里的对应键被验证器钉死为空串，
   * 用它覆盖本机值只会把用户自己的密钥清掉；反向注入同样被验证器挡住。
   */
  function mergeImportedSettings(current, incoming) {
    const base = isPlainRecord(current) ? current : {};
    const next = Object.assign({}, base);
    for (let i = 0; i < SETTING_KEYS.length; i++) {
      const key = SETTING_KEYS[i];
      if (key === "ai") continue;
      if (hasOwnKey(incoming, key)) next[key] = incoming[key];
    }
    if (hasOwnKey(incoming, "ai")) {
      const incomingAi = incoming.ai;
      const currentAi = isPlainRecord(base.ai) ? base.ai : {};
      const ai = Object.assign({}, currentAi);
      const fromFile = ["enabled", "model", "autoOnSave"];
      for (let i = 0; i < fromFile.length; i++) {
        if (hasOwnKey(incomingAi, fromFile[i])) ai[fromFile[i]] = incomingAi[fromFile[i]];
      }
      const localOnly = ["baseUrl", "apiKey"];
      for (let i = 0; i < localOnly.length; i++) {
        const key = localOnly[i];
        if (hasOwnKey(ai, key)) continue;
        // 本机（极旧状态）连键都没有时补上：补的是文件里的脱敏占位，恒为空串。
        ai[key] = hasOwnKey(incomingAi, key) ? incomingAi[key] : "";
      }
      next.ai = ai;
    }
    return next;
  }

  /**
   * Web 下载原语：`<a download>` + Blob URL。
   *
   * ⚠️ 这是「导出没有落地出口」缺陷的现场：Android WebView 没有接应者，
   * 点击后**没有任何文件被创建**，而调用方只能提示「已发起下载」。
   * 行为逐字保留（见文件头），修复等裁决。
   */
  function downloadFile(name, content, type) {
    let url = null;
    try {
      const blob = new Blob([content], { type: type || "application/json" });
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function createAppBackup(deps) {
    deps = deps || {};

    const REQUIRED_DEPS = [
      "getSchema", "getState", "normalizeItem",
      "save", "render", "toast", "confirmDialog", "query",
      "isNativeAndroidRuntime", "systemBridge", "getInflightActionDepth"
    ];
    const missing = REQUIRED_DEPS.filter(function (k) { return typeof deps[k] !== "function"; });
    if (missing.length) {
      throw new Error("createAppBackup 缺少依赖：" + missing.join(" / "));
    }

    const $ = deps.query;

    /* ---------- 实例内在途状态（唯一写入者：本实例） ---------- */
    let exportInProgress = false;
    let exportOperationId = 0;
    let pendingNativeExport = null;

    /**
     * 旧版备份快照（v0.2 兼容格式）。
     *
     * ⚠️ **密钥排除在这里**：`settings.ai` 只带 `enabled` / `model` / `autoOnSave`，
     * `baseUrl` / `apiKey` 恒为空串 —— 备份文件会离开设备（分享/云盘），
     * 把 BYOK 密钥写进去等于把钥匙贴在包裹上。将来改导出格式时这条不能松。
     *
     * 只在 `exportData()` 的点击时刻拍一次：系统对话框停留再久，写入的仍是
     * 点击时的数据（操作身份 `operationId` 保证迟到结果不会写进新一轮）。
     */
    function buildLegacyBackupPayload() {
      const state = deps.getState();
      const settings = state.settings || {};
      return {
        app: "attention-inbox",
        schema: deps.getSchema(),
        exportedAt: new Date().toISOString(),
        items: state.items,
        notes: state.notes,
        projects: state.projects,
        settings: {
          notify: settings.notify,
          dnd: settings.dnd,
          importantRepeat: settings.importantRepeat,
          quietStart: settings.quietStart,
          quietEnd: settings.quietEnd,
          dailySummary: settings.dailySummary,
          privacyNotify: settings.privacyNotify,
          defaultDeliveryMode: settings.defaultDeliveryMode || "notification",
          userMode: settings.userMode || "beginner",
          // do not export AI secrets
          ai: {
            enabled: !!(settings.ai && settings.ai.enabled),
            baseUrl: "",
            apiKey: "",
            model: settings.ai && settings.ai.model ? settings.ai.model : "",
            autoOnSave: !!(settings.ai && settings.ai.autoOnSave)
          }
        }
      };
    }

    /** 导出在途时锁按钮 + 改说明文字；结束后无条件还原（包括失败路径）。 */
    function setExportBusy(busy) {
      const button = $("#btnExport");
      if (button) {
        button.disabled = !!busy;
        button.setAttribute("aria-busy", busy ? "true" : "false");
      }
      const sub = $("#exportSub");
      if (sub) sub.textContent = busy ? "正在等待保存结果…" : "JSON 备份到文件";
    }

    function clearPendingNativeExport(operationId) {
      const pending = pendingNativeExport;
      if (!pending || (operationId != null && pending.id !== operationId)) return;
      if (pending.timer) clearTimeout(pending.timer);
      pendingNativeExport = null;
    }

    /**
     * 原生导出的「结果未返回」宽限闸门（由入口的 blur/focus/visibilitychange 驱动）。
     *
     * 离开应用时暂停计时（用户正在系统文件选择器里是正常状态）；
     * 回到前台后若宽限期内仍无结果，判定「结果无法确认」：作废这轮操作身份、
     * 恢复按钮可重试 —— 但**绝不**宣称保存成功。
     */
    function noteExportAppVisibility(active) {
      const pending = pendingNativeExport;
      if (!pending) return;
      if (!active) {
        pending.leftApp = true;
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = null;
        return;
      }
      if (!pending.leftApp || pending.timer) return;
      pending.timer = setTimeout(() => {
        if (pendingNativeExport !== pending || !exportInProgress) return;
        pendingNativeExport = null;
        exportOperationId++;
        exportInProgress = false;
        setExportBusy(false);
        deps.toast("保存结果未返回 · 文件状态无法确认，请重试");
      }, EXPORT_RESULT_GRACE_MS);
    }

    /**
     * 导出入口：在途闸门 → 快照 → 按运行时分通路。
     *
     * 三条通路的优先级与提示文案**逐字保持搬移前行为**：
     *   1. 原生 Android（`saveDocument`）—— 真正的落地出口；
     *   2. Web 分享（`navigator.share` 带 File）—— 用户取消不算失败；
     *   3. `<a download>` —— 见文件头的已知缺口。
     *
     * 每一步都带操作身份：`operationId !== exportOperationId` 说明这轮已被
     * 宽限闸门作废，迟到结果直接丢弃（不 toast、不还原按钮 —— 那是新一轮的事）。
     */
    async function exportData() {
      if (exportInProgress) {
        deps.toast("导出正在进行 · 请先完成或取消保存");
        return { status: "busy" };
      }

      exportInProgress = true;
      const operationId = ++exportOperationId;
      setExportBusy(true);

      // 只在这里拍一次快照。即使系统对话框停留很久，最终写入的仍是点击时的数据。
      const payload = buildLegacyBackupPayload();
      const text = JSON.stringify(payload, null, 2);
      const name = "安心收件箱备份-" + new Date().toISOString().slice(0, 10) + ".json";
      const mimeType = "application/json";

      try {
        if (deps.isNativeAndroidRuntime()) {
          const bridge = deps.systemBridge();
          if (!bridge || typeof bridge.saveDocument !== "function") {
            deps.toast("当前版本缺少系统保存能力 · 文件未导出，请更新应用后重试");
            return { status: "unavailable" };
          }

          pendingNativeExport = { id: operationId, leftApp: false, timer: null };
          deps.toast("请选择保存位置和文件名");
          const result = await bridge.saveDocument({ fileName: name, content: text, mimeType });
          if (operationId !== exportOperationId) return { status: "stale" };
          clearPendingNativeExport(operationId);
          if (result && result.status === "saved") {
            deps.toast(savedBackupMessage(result, name));
            return result;
          }
          if (result && result.status === "cancelled") {
            deps.toast("已取消导出 · 未保存文件");
            return result;
          }
          deps.toast("导出失败 · 文件未保存，请重试");
          return Object.assign({ status: "failed" }, result || {});
        }

        let file = null;
        let canShareFile = false;
        if (typeof navigator.share === "function" && typeof navigator.canShare === "function"
            && typeof File === "function") {
          try {
            file = new File([text], name, { type: mimeType });
            canShareFile = !!navigator.canShare({ files: [file] });
          } catch (error) {
            canShareFile = false;
          }
        }
        if (canShareFile) {
          deps.toast("正在打开分享面板…");
          try {
            await navigator.share({ files: [file], title: "安心收件箱备份" });
            deps.toast("已分享「" + name + "」");
            return { status: "shared", fileName: name };
          } catch (error) {
            if (isShareCancellation(error)) {
              deps.toast("已取消分享 · 未再次发起下载");
              return { status: "cancelled" };
            }
            deps.toast("分享失败 · 未再次发起下载，请重试");
            return { status: "failed" };
          }
        }

        downloadFile(name, text, mimeType);
        deps.toast("已发起下载 · 请查看浏览器下载记录");
        return { status: "download-started", fileName: name };
      } catch (error) {
        if (operationId === exportOperationId) {
          clearPendingNativeExport(operationId);
          deps.toast("导出失败 · 文件未保存，请重试");
        }
        return { status: "failed" };
      } finally {
        if (operationId === exportOperationId) {
          clearPendingNativeExport(operationId);
          exportInProgress = false;
          setExportBusy(false);
        }
      }
    }

    /**
     * 导入：读文件 → 解析 → **整树验证** → 归一与准备 → 在途闸门 → 用户确认 →
     * 一次性覆盖 → 保存 → 渲染。
     *
     * 覆盖面与搬移前一致：items 逐条过 `normalizeItem`（导入文件是外部输入，
     * 不能信），notes/projects 只认数组，settings 白名单增量合并（缺键不删、密钥不覆盖）。
     * `inflightActionDepth > 0` 时拒绝 —— 提醒操作正写到一半，此时整体换血
     * 会造成「半新半旧」的台账。
     *
     * P2-C-S 的**顺序纪律**（独立诊断 `20260922T124205` 的核心结论）：
     *   验证与准备必须全部发生在 `confirmDialog` **之前**。此前确认框先弹、
     *   校验后置，于是「格式坏掉的文件」也会先问用户「要不要覆盖当前数据」——
     *   用户点头之后才发现文件不能用。现在坏文件在**任何**可见副作用之前就被拒：
     *   不弹确认框、不碰 state、不 save、不 render、不排提醒。
     *
     * 两个「成功提示 = 证据」的时点（独立复验 `20260921T134843` 的 G01/G02，
     * 均为搬移前就有的继承缺陷，此处一并修，本批次不改其语义）：
     *   · **读取失败不再静默** —— `onerror` / `onabort` 都要给反馈，
     *     「点了没反应」比失败提示更伤信任；
     *   · **「导入成功」在提交兑现之后才说** —— 注入的 `save()` 返回权威提交
     *     Promise（app-core `saveAsync` 的 `runCommit` 链），不 await 就报成功，
     *     用户拿着提示关掉应用，数据可能只存在内存里。
     *     提交失败时内存状态保留（与 app-core 保存失败路径同一语义），但不报成功。
     */
    function importDataFile(file) {
      const reader = new FileReader();
      reader.onload = async () => {
        // 1) 解析。非 JSON 保持搬移前的文案（「文件格式不正确」），
        //    与「文件是 JSON 但契约不满足」区分开 —— 两者的处置完全不同。
        let data = null;
        try {
          data = JSON.parse(String(reader.result || ""));
        } catch (parseError) {
          deps.toast("导入失败：文件格式不正确");
          return;
        }
        // 2) 整树验证（纯函数，不碰 state）。
        const verdict = validateBackupPayload(data, deps.getSchema());
        if (!verdict.ok) {
          deps.toast(importFailureMessage(verdict));
          return;
        }
        // 3) 归一与准备：全部写在**脱离 state 的临时对象**上 —— 确认被取消时
        //    不会留下半成品；`normalizeItem` 只读当前设置（defaultDeliveryMode）。
        let prepared = null;
        try {
          prepared = {
            items: verdict.sanitized.items.map(deps.normalizeItem),
            notes: verdict.sanitized.notes,
            projects: verdict.sanitized.projects,
            settings: mergeImportedSettings(deps.getState().settings, verdict.sanitized.settings)
          };
        } catch (normalizeError) {
          // 归一自身抛错（依赖坏掉）也不许进入确认框
          deps.toast("导入失败：备份格式不正确");
          return;
        }
        // 4) 在途闸门：提醒操作正在保存时，连问都不问。
        if (deps.getInflightActionDepth() > 0) {
          deps.toast("提醒操作正在保存 · 请稍后重新导入");
          return;
        }
        // 5) 到这里文件已经确定可用，才值得打断用户。
        const okImp = await deps.confirmDialog("导入将覆盖当前数据，继续？", "导入数据");
        if (!okImp) return;
        const state = deps.getState();
        state.items = prepared.items;
        state.notes = prepared.notes;
        state.projects = prepared.projects;
        state.settings = prepared.settings;
        // G02：内层 try 只为把「提交失败」和「文件格式错」分开 —— 后者的
        // 兜底文案对前者是误导（文件明明读对了）。
        try {
          await deps.save();
        } catch (saveError) {
          deps.toast("导入失败 · 数据未能保存，请重新导入");
          return;
        }
        deps.render();
        deps.toast("导入成功 · " + state.items.length + " 条事项");
      };
      // G01：读取失败/中止必须给反馈。
      reader.onerror = () => deps.toast("导入失败：文件读取失败，请重试");
      reader.onabort = () => deps.toast("导入失败 · 文件读取已取消");
      reader.readAsText(file);
    }

    return {
      buildLegacyBackupPayload: buildLegacyBackupPayload,
      exportData: exportData,
      importDataFile: importDataFile,
      noteExportAppVisibility: noteExportAppVisibility
    };
  }

  return {
    createAppBackup: createAppBackup,
    EXPORT_RESULT_GRACE_MS: EXPORT_RESULT_GRACE_MS,
    isShareCancellation: isShareCancellation,
    // P2-C-S：格式契约的**模块级测试出口**（不进运行时实例契约 —— 见文件内说明）。
    validateBackupPayload: validateBackupPayload,
    BACKUP_CONTRACT: BACKUP_CONTRACT
  };
});
