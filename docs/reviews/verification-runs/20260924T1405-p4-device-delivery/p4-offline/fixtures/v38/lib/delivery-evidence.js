/* UX-T03 — 原生送达证据的回流合并与事后核查判定 — UMD
 *
 * 这块存在的理由（D70 前置核验的现场对照实验）：
 *   一条**真的响过**的重要档提醒，原生台账里 received → windowVisible 全在，
 *   而三态台账里它停在 `scheduled` —— 因为原生的 received/通知提交/界面可见
 *   从来没有一条通路回到 JS。于是任何「scheduled 且已过期 ⇒ 未送达」的判定
 *   都会在每次成功提醒后成立（近 100% 误报）。
 *   ⇒ 先补送达证据，再谈事后核查。本模块只做「正确观察」，不改变提醒次数/补投策略。
 *
 * 层级纪律（不许把前一层改名为后一层）：
 *   排程 → 系统接收 → 通知提交/声振请求 → 窗口可见 → 回到 Web → 持久化
 *   接收可确认时只写「系统已接收」；窗口创建不等于可见；声振请求不等于用户听到。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.AttentionLib = root.AttentionLib || {};
    // 具名命名空间：顶层平铺会与其它 lib 模块撞名
    root.AttentionLib.DeliveryEvidence = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * 事后核查的展示状态。
   *
   * **没有 `missed`**。缺证据只能是 unknown —— 不设一个任意分钟阈值把 unknown 变成 fail。
   */
  const STATUS = {
    DELIVERED: "delivered",       // 有本轮的送达证据
    PENDING: "pending",           // 计划时刻还没到
    PROCESSING: "processing",     // 刚到点 / 回读进行中
    UNKNOWN: "unknown",           // 时间已过但缺证据（含证据被淘汰、字段缺失）
    UNVERIFIABLE: "unverifiable"  // 本版本没登记过排程 / 载体未覆盖 / 升级前旧数据
  };

  const STATUS_TEXT = {
    delivered: "系统已接收这次提醒",
    pending: "还没到提醒时间",
    processing: "正在处理 · 稍后会自动更新",
    unknown: "本次提醒结果尚未确认",
    unverifiable: "这条记录的提醒无法核查"
  };

  /** 刚到点后多久内算「处理中」而不是「未知」。 */
  const PROCESSING_GRACE_MS = 90 * 1000;

  function keyAt(key) {
    const at = Number(String(key == null ? "" : key).split("@")[1]);
    return Number.isFinite(at) ? at : null;
  }

  /**
   * 规范字段名（**唯一协议**）。
   *
   * 原生 `DeliveryEvidenceStore.rowFor` 写出的键与此一一对应：
   *   `{ itemId, reminderKey, plannedAt, carrier, receivedAt, itemRev, token }`
   *
   * `key` / `at` 只作为**上一版原生**（2026-09-19 之前写进设备的那批行）的旧字段名被容忍，
   * 这不是第二套协议：新写入一律用规范名，旧名只为不让已装在设备上的旧行变成垃圾。
   */
  const ROW_FIELDS = ["itemId", "reminderKey", "plannedAt", "carrier", "receivedAt", "itemRev", "token"];
  const LEGACY_FIELDS = { key: "reminderKey", at: "plannedAt" };

  /**
   * 台账条目属于**哪一轮**（轮次身份）。
   *
   * 轮次身份 = 登记这条键时事项的 `triggerAt`（当前触发起点），登记时由
   * `applyReminderEvents` 写进条目（`roundBase`）。它必须满足两个方向：
   *   · 换一次提醒时间就换一轮 —— 旧承诺的键哪怕原定时刻晚于新起点（R-F06 的形态：
   *     旧轮 30 分钟前的首期 + 5 分钟前的追提醒，追提醒的键在时间上「落进」新轮范围），
   *     也不能算作这一轮；
   *   · **非排程字段编辑（改标题/备注）与同一时刻重排不换轮** —— 那两种情况下承诺没变，
   *     回执依然合法。所以这里比的是「轮」而不是「版本号相等」：机械要求 rev 相同
   *     会把合法证据误判成陈旧（rev 会因为改标题而推进）。
   *
   * 旧版本写入的条目没有 `roundBase`：身份默认**不可验证**，不能因为它碰巧落在
   * 当前时间范围内，就把它提升成当前轮的肯定证据。只有两种可证明迁移：
   *   · 旧键本身是 `0@triggerAt`（首期键精确锚定当前触发起点）；
   *   · 后续原生对账再次明确登记同一个当前轮键（由 `applyReminderEvents` 补字段）。
   * 其余升级前历史仍保留在台账里但不证明当前轮。未知不能冒充当前轮，正是 Y2 的边界。
   */
  function entryRoundBase(item, entry, key) {
    if (entry && typeof entry === "object" && entry.roundBase != null) {
      const explicit = Number(entry.roundBase);
      if (Number.isFinite(explicit)) return explicit;
    }
    const base = Number(item && item.triggerAt) || 0;
    if (base && /^0@/.test(String(key || "")) && keyAt(key) === base) return base;
    return null;
  }

  /** 把一行原生数据映射到规范字段名（不猜、不补默认值）。 */
  function canonicalRow(row) {
    const out = {};
    ROW_FIELDS.forEach(name => {
      if (row[name] !== undefined && row[name] !== null) out[name] = row[name];
    });
    Object.keys(LEGACY_FIELDS).forEach(legacy => {
      const name = LEGACY_FIELDS[legacy];
      if (out[name] === undefined && row[legacy] !== undefined && row[legacy] !== null) {
        out[name] = row[legacy];
      }
    });
    return out;
  }

  /**
   * 把原生回传的原始行规范成自足的值。
   *
   * 最小事件身份 = **事项 ID + 提醒键（逻辑轮次/原定时刻）+ 载体 + 接收时刻 + 事项版本**。
   * 五者缺一即 `missing-identity`，**不作数**：
   *   · 缺接收时刻 ⇒ 无法区分「这次真的收到」与「上次那条被读出来两次」；
   *   · 缺载体 ⇒ 说不清落在闹钟通道还是通知通道；
   *   · 缺版本 ⇒ 无法与本轮的排程身份对照（R4b 正是这么漏过去的）；
   *   · 时间戳或标题单独都不能作为身份。
   *
   * `at` 一律由**提醒键**推出，不读 `plannedAt`：键才是身份，两个来源会打架。
   */
  function normalizeEvidence(raw, source) {
    const out = [];
    const rows = Array.isArray(raw) ? raw : [];
    rows.forEach(rawRow => {
      if (!rawRow || typeof rawRow !== "object") return;
      const row = canonicalRow(rawRow);
      const itemId = row.itemId ? String(row.itemId) : "";
      const key = row.reminderKey ? String(row.reminderKey) : "";
      const carrier = row.carrier === "alarm" ? "alarm" : (row.carrier === "notification" ? "notification" : "");
      const receivedAt = Number(row.receivedAt) > 0 ? Number(row.receivedAt) : null;
      const itemRev = row.itemRev != null && String(row.itemRev) !== "" ? String(row.itemRev) : null;
      const reject = (reason) => {
        out.push({ valid: false, reason: reason, itemId: itemId, key: key, raw: rawRow });
      };
      if (!itemId || !key || !carrier || !receivedAt || !itemRev) {
        reject("missing-identity");
        return;
      }
      const at = keyAt(key);
      if (at == null) {
        reject("missing-identity");
        return;
      }
      out.push({
        valid: true,
        itemId: itemId,
        key: key,
        at: at,
        // 载体：闹钟通道（alarm）还是通知通道（notification）
        carrier: carrier,
        // 证据写下的时刻：恢复/补投后它与计划时刻不同，必须分开存
        receivedAt: receivedAt,
        itemRev: itemRev,
        token: row.token ? String(row.token) : null,
        source: source || "native",
        // 层级：到这一步只能证明「系统接收」，不能证明用户看到
        level: "received"
      });
    });
    return out;
  }

  /**
   * 幂等合并。
   *
   * 纪律：
   *  · 只写 `item.reminderEvents`，**绝不**改 `it.status` —— 完成事项不能因迟到回执复活；
   *  · 旧轮次（键的原定时刻早于当前触发起点）一律不写，新轮次不被污染；
   *  · **回执必须指向我们登记过的那一轮提醒**（见下）；
   *  · 重复/乱序回执按 (itemId, key) 去重，第二次合并不产生变化；
   *  · 身份缺失/字段缺失/事项已不存在 → 计入 unknownCount，**不反推失败**。
   *
   * **为什么还必须核对「已登记」**（独立验收 R4）：
   *   只比 `ev.at >= item.triggerAt` 挡不住旧轮的第 2 次追提醒 —— 它的原定时刻可以
   *   **晚于**新轮的首次时间（旧轮 31 分钟前开始、第 2 次追提醒 1 分钟前），于是时间下界
   *   成立、却根本不是这一轮。把「版本字段存在」当「已校验」也是同一种错。
   *   真正可验证的身份是**我们自己的排程登记**：`item.reminderEvents` 里由原生对账
   *   （`applyReminderEvents`，两个载体都覆盖）写下的键，就是我们真的对用户承诺过的那一轮。
   *   登记不到的键一律 unknown —— 宁可「尚未确认」，也不谎报「系统已接收」。
   *
   * **为什么登记过还不够，还要核对轮次**（独立复验 R-F06）：
   *   真实的对账会**保留**旧轮的键当历史，其中 `cancelled` 的那些会原样留着。
   *   而「稍后提醒」把时间往后推之后，旧轮追提醒的原定时刻常常**晚于**新的触发起点，
   *   于是时间下界照样成立、键也照样登记在案 —— 旧轮回执回来就把**新轮**抬成
   *   「系统已接收」，而新轮自己一条接收证据都没有。所以判据是
   *   「这条键属于**当前轮**」（`entryRoundBase` 见上），不是「这条键存在」。
   *
   * @returns {{changed:boolean, applied:number, deduped:number, unknown:number, reasons:string[]}}
   */
  function mergeEvidence(items, evidences, now) {
    const list = Array.isArray(items) ? items : [];
    const result = { changed: false, applied: 0, deduped: 0, unknown: 0, reasons: [] };
    const byId = new Map();
    list.forEach(it => { if (it && it.id) byId.set(it.id, it); });

    (Array.isArray(evidences) ? evidences : []).forEach(ev => {
      if (!ev || !ev.valid) {
        result.unknown++;
        if (ev && ev.reason) result.reasons.push(ev.reason);
        return;
      }
      const it = byId.get(ev.itemId);
      if (!it) { result.unknown++; result.reasons.push("item-missing"); return; }
      const base = Number(it.triggerAt) || 0;
      // 旧轮次回执：当前触发起点之前的键不再属于这条事项的有效承诺
      if (base && ev.at < base) {
        result.unknown++;
        result.reasons.push("stale-round");
        return;
      }
      if (!it.reminderEvents || typeof it.reminderEvents !== "object") it.reminderEvents = {};
      const prev = it.reminderEvents[ev.key];
      // 登记不到这一轮 ⇒ 无法把它锚到任何一个我们真的承诺过的提醒上
      if (!prev || typeof prev !== "object") {
        result.unknown++;
        result.reasons.push("unregistered-round");
        return;
      }
      // 登记过还不够：这条键可能是**上一轮**留下的（原定时刻落在当前范围内，但轮次已经换过）
      const roundBase = Number(it.triggerAt) || 0;
      const registeredRound = entryRoundBase(it, prev, ev.key);
      if (roundBase && registeredRound !== roundBase) {
        result.unknown++;
        result.reasons.push(registeredRound == null ? "unverifiable-round" : "superseded-round");
        return;
      }
      if (prev && typeof prev === "object" && prev.state === "delivered") {
        result.deduped++;
        return;
      }
      it.reminderEvents[ev.key] = Object.assign({}, prev, {
        at: prev && Number(prev.at) ? Number(prev.at) : ev.at,
        state: "delivered",
        receivedAt: ev.receivedAt || (now || Date.now()),
        carrier: ev.carrier,
        // scheduled → delivered 也必须保留轮次身份；否则一次正常回执就会把
        // 可验证条目重新降级成「身份缺失」，并在下一轮错误继承当前 triggerAt（Y1）。
        roundBase: registeredRound,
        // 这里刻意用「系统已接收」而不是「用户看到」
        level: "received",
        source: ev.source
      });
      result.applied++;
      result.changed = true;
    });
    return result;
  }

  /**
   * 一条事项的事后核查结论。
   *
   * @param {object} item
   * @param {object} ctx
   *   ctx.now
   *   ctx.evidenceReadable  证据通道本身是否读成功（false ⇒ 一律 unknown，不指控）
   *   ctx.observable        本版本是否登记过这条事项的排程（false ⇒ unverifiable）
   *   ctx.readbackInFlight  回读进行中 ⇒ processing
   */
  function evidenceStatusFor(item, ctx) {
    ctx = ctx || {};
    const now = ctx.now || Date.now();
    if (!item) return result(STATUS.UNVERIFIABLE, null);
    const events = item.reminderEvents && typeof item.reminderEvents === "object"
      ? item.reminderEvents : null;
    const keys = events ? Object.keys(events) : [];
    if (!keys.length) {
      return ctx.observable === false
        ? result(STATUS.UNVERIFIABLE, null)
        : result(STATUS.UNVERIFIABLE, null);
    }
    const planned = keys.map(k => ({
      key: k,
      at: keyAt(k),
      state: events[k] && events[k].state,
      roundBase: entryRoundBase(item, events[k], k)
    }));
    // **只认当前轮的证据**：`triggerAt` 之前的键属于被改掉时间的旧承诺；
    // 而原定时刻仍然落在范围内、轮次却已经换过（稍后提醒后的旧追提醒）的那些键，
    // 同样是历史 —— 它们即便是 delivered 也不能代表「这一次」已收到。
    // 这正是 R4 / R-F06 被误报的那一步。两条判据缺一不可。
    const base = Number(item.triggerAt) || 0;
    const inRound = planned.filter(p =>
      !base || (p.at != null && p.at >= base && p.roundBase === base));
    // 有历史，但没有一条能证明属于当前轮：保持「不可核查」。尤其不能把旧版
    // scheduled/cancelled/delivered 因缺 roundBase 而解释成当前轮（Y2）。
    if (base && !inRound.length) return result(STATUS.UNVERIFIABLE, null);
    const delivered = inRound.filter(p => p.state === "delivered");
    // 只认「已到点」的那些键 —— 未来的键当然没有证据
    const duePassed = inRound.filter(p => p.at != null && p.at <= now);
    if (delivered.length) {
      const latest = delivered.reduce((a, b) => (b.at > a.at ? b : a), delivered[0]);
      return result(STATUS.DELIVERED, latest.at);
    }
    if (!duePassed.length) {
      const next = inRound.filter(p => p.at != null).sort((a, b) => a.at - b.at)[0];
      return result(STATUS.PENDING, next ? next.at : (Number(item.triggerAt) || null));
    }
    // 到点了但没有证据
    if (ctx.evidenceReadable === false) return result(STATUS.UNKNOWN, null);
    const newestDue = duePassed.reduce((a, b) => (b.at > a.at ? b : a), duePassed[0]);
    if (ctx.readbackInFlight || now - newestDue.at < PROCESSING_GRACE_MS) {
      return result(STATUS.PROCESSING, newestDue.at);
    }
    return result(STATUS.UNKNOWN, newestDue.at);
  }

  function result(state, at) {
    return { state: state, text: STATUS_TEXT[state], at: at || null, isMissed: false };
  }

  return {
    STATUS,
    STATUS_TEXT,
    PROCESSING_GRACE_MS,
    // 原生线上格式的唯一读法（协议名 + 旧名容忍），供契约测试直接断言
    ROW_FIELDS,
    LEGACY_FIELDS,
    canonicalRow,
    normalizeEvidence,
    mergeEvidence,
    evidenceStatusFor,
    entryRoundBase,
    keyAt
  };
});
