/* P3-I: Event & route binding controller.
 * UMD factory: evaluation performs no I/O, no DOM querying, and no state mutation.
 */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppEvents = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppEvents(input) {
    const deps = input || {};
    const REQUIRED_DEPS = [
      "getState",
      "render",
      "renderHome",
      "renderFuture",
      "renderMe",
      "openCapture",
      "closeSheet",
      "closeAllSheets",
      "openSheet",
      "openDetail",
      "openEditItem",
      "save",
      "saveItemFromForm",
      "setLowConfPick",
      "finishSaveAfterLowConf",
      "confirmDialog",
      "toast",
      "inflightDepth",
      "ackItem",
      "snoozeItem",
      "completeItem",
      "deleteItem",
      "reopenItem",
      "restoreItem",
      "stopRepeat",
      "resumeDeadlineProtection",
      "openSnoozeSheet",
      "setUserMode",
      "setNativeReminderStatus",
      "queueNativeReminderSync",
      "isNativeAndroidRuntime",
      "waitForNativeBridge",
      "openSystemSetting",
      "openReviewSession",
      "handleAlarmAction",
      "bindSetupReviewControls",
      "toLocalInput",
      "parseLocalInput",
      "nextWeekend",
      "addDays",
      "applyClock",
      "endOfDay",
      "pad",
      "uid",
      "escapeHtml",
      "hideAlert",
      "makeItem"
    ];
    REQUIRED_DEPS.forEach(function(name) {
      if (typeof deps[name] !== "function") {
        throw new Error("createAppEvents(deps) 缺少必要依赖：" + name);
      }
    });

    let bound = false;

    function getDoc() {
      if (typeof document !== "undefined") return document;
      return null;
    }

    function $(sel) {
      const d = getDoc();
      return d ? d.querySelector(sel) : null;
    }

    function $$(sel) {
      const d = getDoc();
      return d ? Array.from(d.querySelectorAll(sel)) : [];
    }

    function getNativeRemindersApi() {
      if (typeof deps.getNativeReminders === "function") {
        const n = deps.getNativeReminders();
        if (n) return n;
      }
      return (typeof AttentionNativeReminders !== "undefined" && AttentionNativeReminders) ||
        (root.AttentionNativeReminders || null);
    }

    /**
     * 演示内容（固定模板，与用户数据无关）。
     */
    function demoPreviewRows() {
      return [
        { title: "看看 Horolog 的调度设计", when: "本周六 10:00", tag: "普通 · 阅读", note: "写一句话就行，到点我会把这条推到你面前。" },
        { title: "报名截止，提前确认材料", when: "明天 09:00 · 截止还有 5 天", tag: "重要 · 有截止", note: "标为「重要」或「关键」的事项用闹钟提醒：声音更大，锁屏时会亮屏。" },
        { title: "交房租", when: "每月 1 日 09:00", tag: "每 1 个月 · 按日历", note: "周期事项点「完成」后会自动生成下一期。" },
        { title: "给爸妈打电话", when: "下周六 10:00", tag: "每两周 · 从我点过「我知道了」重新计时", note: "周期有两种计时方式；选错会让你以为它忘了提醒。" },
        { title: "有空看看这个项目", when: "还没定时间", tag: "会先收下 · 待整理", note: "没写时间的记录不会被拒绝，也不会冒充已经安排好了提醒。" }
      ];
    }

    function openDemoPreview() {
      const host = $("#demoBody");
      if (host) {
        host.innerHTML =
          '<p class="demo-note">这是只读预览：不会写入你的数据，也不会安排任何提醒。</p>' +
          demoPreviewRows().map(function(r) {
            return '<div class="demo-item">' +
              '<div class="demo-title">' + deps.escapeHtml(r.title) + "</div>" +
              '<div class="demo-when">' + deps.escapeHtml(r.when) + " · " + deps.escapeHtml(r.tag) + "</div>" +
              '<p style="font-size:0.82rem;color:var(--muted);margin-top:6px;line-height:1.5">' + deps.escapeHtml(r.note) + "</p>" +
              "</div>";
          }).join("");
      }
      deps.openSheet("sheetDemo");
    }

    function seed() {
      if (deps.inflightDepth() > 0) {
        deps.toast("提醒操作正在保存 · 请稍后再载入示例数据");
        return false;
      }
      const state = deps.getState();
      const now = new Date();
      state.projects = [
        { id: "p_work", name: "工作", color: "#1b6b4a" },
        { id: "p_read", name: "阅读", color: "#3d5a80" },
        { id: "p_life", name: "生活", color: "#9a6b12" }
      ];
      state.items = [
        deps.makeItem({
          title: "看看 Horolog 的调度设计",
          note: "GitHub 上那个开源调度库，重点看它的 cron 与重试策略",
          tags: ["阅读", "工程"],
          url: "https://github.com/search?q=horolog",
          projectId: "p_read",
          priority: "normal",
          status: "due",
          triggerAt: Date.now() - 5 * 60000
        }),
        deps.makeItem({
          title: "报名截止，提前确认材料",
          note: "需要成绩单扫描件 + 证件照",
          tags: ["行政"],
          projectId: "p_work",
          priority: "important",
          status: "waiting",
          triggerAt: deps.applyClock(deps.addDays(now, 1), Date.now()),
          deadlineAt: deps.endOfDay(deps.addDays(now, 5)).getTime()
        }),
        deps.makeItem({
          title: "交房租",
          projectId: "p_life",
          priority: "normal",
          status: "waiting",
          triggerAt: deps.applyClock(deps.addDays(now, 3), Date.now()),
          repeat: { mode: "calendar", every: "month" }
        }),
        deps.makeItem({
          title: "给爸妈打电话",
          projectId: "p_life",
          priority: "important",
          status: "waiting",
          triggerAt: deps.nextWeekend(now),
          repeat: { mode: "ack", every: "biweek" }
        }),
        deps.makeItem({
          title: "看看那篇注意力管理文章",
          note: "分享进来的，周末有空再读",
          tags: ["阅读"],
          url: "https://example.com/attention",
          projectId: "p_read",
          priority: "normal",
          status: "waiting",
          triggerAt: deps.nextWeekend(now)
        }),
        deps.makeItem({
          title: "续费域名",
          note: "已经确认过了，还没操作",
          projectId: "p_work",
          priority: "normal",
          status: "acknowledged",
          triggerAt: Date.now() - 86400000,
          acknowledgedAt: Date.now() - 3600000
        }),
        deps.makeItem({
          title: "买猫粮",
          projectId: "p_life",
          priority: "normal",
          status: "archived",
          triggerAt: Date.now() - 7200000,
          completedAt: Date.now() - 3600000
        })
      ];
      state.notes = [
        {
          id: deps.uid(),
          title: "注意力原则",
          body: "## 核心原则\n\n- Acknowledge ≠ Complete\n- Future 默认不占据首页\n- 通知送达 ≠ 用户看到\n\n> 放心忘记，而不是帮记住更多事情。",
          pinned: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: deps.uid(),
          title: "周末阅读清单",
          body: "1. Horolog 调度设计\n2. 本地优先架构文章\n3. RFC 5545 重复规则\n\n`本地优先` = 无网也能完成核心流程。",
          projectId: "p_read",
          createdAt: Date.now(),
          updatedAt: Date.now() - 86400000
        }
      ];
      const appModel = typeof deps.getAppModel === "function" ? deps.getAppModel() : null;
      const defaultSettings = appModel && typeof appModel.createInitialState === "function"
        ? appModel.createInitialState().settings
        : { notify: false, dnd: false, importantRepeat: false };
      state.settings = Object.assign(state.settings, {
        notify: defaultSettings.notify,
        dnd: defaultSettings.dnd,
        importantRepeat: defaultSettings.importantRepeat
      });
      deps.save();
      state.ui.tab = "home";
      deps.render();
      deps.toast("示例数据已载入");
      return true;
    }

    /**
     * 分享或深链参数处理
     */
    function applyShareParams() {
      if (typeof location === "undefined" || !location.search) return false;
      const params = new URLSearchParams(location.search);
      const text = params.get("text") || params.get("title") || "";
      const url = params.get("url") || params.get("link") || "";
      const body = params.get("body") || "";
      if (!text && !url && !body) return false;
      const title = text || (url ? url : body.slice(0, 40));
      deps.openCapture({
        title: title,
        url: url || (/^https?:\/\//.test(body) ? body : ""),
        note: body && body !== url ? body : ""
      });
      try {
        if (typeof history !== "undefined" && typeof history.replaceState === "function") {
          history.replaceState(null, "", location.pathname);
        }
      } catch (e) {}
      return true;
    }

    function handleQueryActions() {
      if (typeof location === "undefined" || !location.search) return;
      const params = new URLSearchParams(location.search);
      const tab = params.get("tab");
      const state = deps.getState();
      if (tab === "future" || tab === "notes" || tab === "me" || tab === "home") {
        state.ui.tab = tab;
        if (tab === "future") state.ui.futureSeg = "waiting";
      }
      const action = params.get("action");
      if (action === "capture") {
        setTimeout(function() { deps.openCapture(); }, 200);
      }
      if (action === "review" || params.get("itemId") === "review-session") {
        state.ui.tab = "home";
        setTimeout(function() { deps.openReviewSession(); }, 250);
      }
      const alarmAction = params.get("alarmAction");
      if (alarmAction) {
        deps.handleAlarmAction({
          action: alarmAction,
          itemId: params.get("alarmItem") || params.get("alarmItemId"),
          itemRev: params.get("alarmItemRev") || params.get("itemRev")
        });
        try {
          if (typeof history !== "undefined" && typeof history.replaceState === "function") {
            history.replaceState(null, "", location.pathname);
          }
        } catch (e) {}
      }
    }

    function bind() {
      if (bound) return;
      bound = true;

      const doc = getDoc();
      if (!doc) return;

      const diagnostics = typeof deps.getDiagnostics === "function" ? deps.getDiagnostics() : null;
      if (diagnostics && typeof diagnostics.bind === "function") diagnostics.bind();

      const appContent = typeof deps.getAppContent === "function" ? deps.getAppContent() : null;
      if (appContent && typeof appContent.bind === "function") appContent.bind();

      deps.bindSetupReviewControls();

      $$(".nav-item").forEach(function(btn) {
        btn.addEventListener("click", function() {
          deps.getState().ui.tab = btn.dataset.tab;
          deps.render();
        });
      });

      const fab = $("#fab");
      if (fab) fab.addEventListener("click", function() { deps.openCapture(); });

      const backdrop = $("#backdrop");
      if (backdrop) backdrop.addEventListener("click", deps.closeAllSheets);

      $$("[data-close]").forEach(function(b) {
        b.addEventListener("click", function() { deps.closeSheet(b.dataset.close); });
      });

      const appCapture = typeof deps.getAppCapture === "function" ? deps.getAppCapture() : null;
      if (appCapture && typeof appCapture.bind === "function") appCapture.bind();

      const btnSaveItem = $("#btnSaveItem");
      if (btnSaveItem) btnSaveItem.addEventListener("click", deps.saveItemFromForm);

      const capText = $("#capText");
      if (capText) {
        capText.addEventListener("keydown", function(e) {
          if (e.key === "Enter") deps.saveItemFromForm();
        });
      }

      $$("#lowConfChips .chip").forEach(function(c) {
        c.addEventListener("click", function() {
          const now = new Date();
          if (c.dataset.days) {
            deps.setLowConfPick(Date.now() + parseInt(c.dataset.days, 10) * 86400000, c);
          } else if (c.dataset.preset === "weekend") {
            deps.setLowConfPick(deps.nextWeekend(now), c);
          }
        });
      });

      const lowConfCustom = $("#lowConfCustom");
      if (lowConfCustom) {
        lowConfCustom.addEventListener("change", function() {
          const ts = deps.parseLocalInput(lowConfCustom.value);
          if (ts) deps.setLowConfPick(ts, null);
        });
      }

      const btnLowConfOk = $("#btnLowConfOk");
      if (btnLowConfOk) {
        btnLowConfOk.addEventListener("click", function() {
          const state = deps.getState();
          const customVal = lowConfCustom ? lowConfCustom.value : "";
          const ts = state.ui.pendingLowConf || deps.parseLocalInput(customVal);
          const capTrigger = $("#capTrigger");
          if (ts && capTrigger) capTrigger.value = deps.toLocalInput(ts);
          deps.closeSheet("sheetLowConf");
          deps.finishSaveAfterLowConf(ts);
        });
      }

      doc.addEventListener("click", async function(e) {
        const actBtn = e.target.closest("[data-act]");
        if (actBtn) {
          const id = actBtn.dataset.id;
          const act = actBtn.dataset.act;
          if (act === "ack") {
            if (deps.ackItem(id) !== false) { deps.closeSheet("sheetDetail"); deps.hideAlert(); }
          } else if (act === "done") {
            if (deps.completeItem(id) !== false) { deps.closeSheet("sheetDetail"); deps.hideAlert(); }
          } else if (act === "snooze") {
            deps.openSnoozeSheet(id);
          } else if (act === "reopen") {
            if (deps.reopenItem(id) !== false) deps.closeSheet("sheetDetail");
          } else if (act === "delete") {
            const okDel = await deps.confirmDialog("确定删除这条事项？", "删除");
            if (okDel) {
              if (deps.deleteItem(id) !== false) {
                deps.closeSheet("sheetDetail");
                deps.hideAlert();
              }
            }
          } else if (act === "restore") {
            if (deps.restoreItem(id) !== false) deps.closeSheet("sheetDetail");
          } else if (act === "stopRepeat") {
            if (deps.stopRepeat(id) !== false) deps.closeSheet("sheetDetail");
          } else if (act === "resumeDeadline") {
            if (deps.resumeDeadlineProtection(id) !== false) deps.closeSheet("sheetDetail");
          } else if (act === "open") {
            deps.openDetail(id);
          } else if (act === "edit") {
            deps.openEditItem(id);
          }
          return;
        }

        const calNav = e.target.closest("[data-cal]");
        if (calNav) {
          const state = deps.getState();
          const kind = calNav.dataset.cal;
          const cur = state.ui.calMonth ? new Date(state.ui.calMonth) : new Date();
          if (kind === "prev") cur.setMonth(cur.getMonth() - 1);
          else if (kind === "next") cur.setMonth(cur.getMonth() + 1);
          else {
            const t = new Date();
            state.ui.calMonth = t.getFullYear() + "-" + deps.pad(t.getMonth() + 1) + "-01";
            state.ui.calSelected = null;
            deps.renderFuture();
            return;
          }
          state.ui.calMonth = cur.getFullYear() + "-" + deps.pad(cur.getMonth() + 1) + "-01";
          state.ui.calSelected = null;
          deps.renderFuture();
          return;
        }

        const calDay = e.target.closest("[data-cal-day]");
        if (calDay) {
          const state = deps.getState();
          const day = parseInt(calDay.dataset.calDay, 10);
          state.ui.calSelected = state.ui.calSelected === day ? null : day;
          deps.renderFuture();
          return;
        }

        if (e.target.closest("#clearCalSel")) {
          const state = deps.getState();
          state.ui.calSelected = null;
          deps.renderFuture();
          return;
        }

        const card = e.target.closest(".card[data-id]");
        if (card && !e.target.closest("a") && !e.target.closest("button")) {
          deps.openDetail(card.dataset.id);
          return;
        }

        if (e.target.closest("#toggleActive")) {
          const state = deps.getState();
          state.ui.activeExpanded = !state.ui.activeExpanded;
          deps.renderHome();
          return;
        }
      });

      $$("#futureSeg .seg-item").forEach(function(b) {
        b.addEventListener("click", function() {
          const state = deps.getState();
          state.ui.futureSeg = b.dataset.seg;
          state.ui.calSelected = null;
          deps.render();
        });
      });

      $$("#futureFilters .chip").forEach(function(c) {
        c.addEventListener("click", function() {
          deps.getState().ui.futureFilter = c.dataset.filter;
          deps.render();
        });
      });

      $$("#notesFilters .chip").forEach(function(c) {
        c.addEventListener("click", function() {
          deps.getState().ui.notesFilter = c.dataset.nfilter;
          deps.render();
        });
      });

      let snoozePick = null;
      let snoozeBasis = "elapsed";
      $$("#snoozeChips .chip").forEach(function(c) {
        c.addEventListener("click", function() {
          $$("#snoozeChips .chip").forEach(function(x) { x.classList.remove("on"); });
          c.classList.add("on");
          const now = new Date();
          if (c.dataset.min) {
            snoozeBasis = "elapsed";
            snoozePick = Date.now() + parseInt(c.dataset.min, 10) * 60000;
          } else if (c.dataset.preset === "tonight") {
            snoozeBasis = "wall-clock";
            const d = new Date(); d.setHours(20, 0, 0, 0);
            if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
            snoozePick = d.getTime();
          } else if (c.dataset.preset === "tomorrow") {
            snoozeBasis = "wall-clock";
            const d = deps.addDays(now, 1); d.setHours(9, 0, 0, 0);
            snoozePick = d.getTime();
          } else if (c.dataset.preset === "weekend") {
            snoozeBasis = "wall-clock";
            snoozePick = deps.nextWeekend(now);
          }
          const snoozeCustom = $("#snoozeCustom");
          if (snoozeCustom) snoozeCustom.value = deps.toLocalInput(snoozePick);
        });
      });

      const snoozeCustom = $("#snoozeCustom");
      if (snoozeCustom) {
        snoozeCustom.addEventListener("change", function() {
          const v = snoozeCustom.value;
          if (v) {
            snoozePick = deps.parseLocalInput(v);
            snoozeBasis = "wall-clock";
          }
          $$("#snoozeChips .chip").forEach(function(x) { x.classList.remove("on"); });
        });
      }

      const btnApplySnooze = $("#btnApplySnooze");
      if (btnApplySnooze) {
        btnApplySnooze.addEventListener("click", function() {
          const state = deps.getState();
          const id = state.ui.snoozeId;
          let when = snoozePick;
          if (!when && snoozeCustom && snoozeCustom.value) {
            when = deps.parseLocalInput(snoozeCustom.value);
            snoozeBasis = "wall-clock";
          }
          if (!when) { deps.toast("请选择时间"); return; }
          if (deps.snoozeItem(id, when, snoozeBasis) === false) return;
          deps.closeSheet("sheetSnooze");
          deps.hideAlert();
          snoozePick = null;
          snoozeBasis = "elapsed";
          $$("#snoozeChips .chip").forEach(function(x) { x.classList.remove("on"); });
          if (snoozeCustom) snoozeCustom.value = "";
        });
      }

      const swNotify = $("#swNotify");
      if (swNotify) {
        swNotify.addEventListener("click", async function() {
          const state = deps.getState();
          const NativeReminders = getNativeRemindersApi();
          if (!state.settings.notify) {
            if (NativeReminders && typeof NativeReminders.isNativeAndroid === "function" && NativeReminders.isNativeAndroid()) {
              const status = await NativeReminders.requestNotificationPermission();
              deps.setNativeReminderStatus(status);
              state.settings.notify = status.notifications === "granted";
              state.settings.notifyPrompted = true;
              deps.toast(state.settings.notify ? "已开启 Android 原生通知" : "通知权限未授予，将使用应用内提醒");
              if (state.settings.notify) deps.queueNativeReminderSync();
            } else if (deps.isNativeAndroidRuntime()) {
              state.settings.notify = false;
              state.settings.notifyPrompted = true;
              const bridged = await deps.waitForNativeBridge(1500);
              if (bridged && NativeReminders && typeof NativeReminders.requestNotificationPermission === "function") {
                const status = await NativeReminders.requestNotificationPermission();
                deps.setNativeReminderStatus(status);
                state.settings.notify = status.notifications === "granted";
                deps.toast(state.settings.notify
                  ? "已开启 Android 原生通知"
                  : "通知权限未授予，请到系统设置手动允许");
                if (state.settings.notify) deps.queueNativeReminderSync();
              } else {
                deps.toast("原生通知桥未就绪，请完全退出后重开应用再试");
              }
            } else if (typeof window !== "undefined" && window.Notification &&
              typeof window.Notification.requestPermission === "function") {
              const perm = await window.Notification.requestPermission();
              state.settings.notify = perm === "granted";
              deps.toast(perm === "granted" ? "已开启本地通知" : "通知权限未授予，将使用应用内提醒");
            } else {
              deps.toast("当前环境不支持系统通知，将使用应用内提醒");
              state.settings.notify = false;
            }
          } else {
            state.settings.notify = false;
            deps.toast("已关闭本地通知");
          }
          deps.save(); deps.renderMe();
        });
      }

      const btnExactAlarm = $("#btnExactAlarm");
      if (btnExactAlarm) {
        btnExactAlarm.addEventListener("click", async function() {
          if (!deps.isNativeAndroidRuntime()) return;
          await deps.openSystemSetting("exact");
          try {
            const NativeReminders = getNativeRemindersApi();
            if (NativeReminders && typeof NativeReminders.getPermissionState === "function") {
              const status = await NativeReminders.getPermissionState();
              deps.setNativeReminderStatus(status);
              deps.queueNativeReminderSync();
              deps.renderMe();
            }
          } catch (error) {}
        });
      }

      const btnNotifySettings = $("#btnNotifySettings");
      if (btnNotifySettings) {
        btnNotifySettings.addEventListener("click", async function() {
          if (!deps.isNativeAndroidRuntime()) return;
          await deps.openSystemSetting("notify");
        });
      }

      const btnBatterySettings = $("#btnBatterySettings");
      if (btnBatterySettings) {
        btnBatterySettings.addEventListener("click", async function() {
          if (!deps.isNativeAndroidRuntime()) return;
          await deps.openSystemSetting("battery");
        });
      }

      const swDnd = $("#swDnd");
      if (swDnd) {
        swDnd.addEventListener("click", function() {
          const state = deps.getState();
          state.settings.dnd = !state.settings.dnd; deps.save(); deps.renderMe();
        });
      }

      const swImp = $("#swImp");
      if (swImp) {
        swImp.addEventListener("click", function() {
          const state = deps.getState();
          state.settings.importantRepeat = !state.settings.importantRepeat; deps.save(); deps.renderMe();
        });
      }

      $$("#userModeSeg .seg-item").forEach(function(btn) {
        btn.addEventListener("click", function() {
          deps.setUserMode(btn.dataset.mode);
        });
      });

      const btnUserGuide = $("#btnUserGuide");
      if (btnUserGuide) {
        btnUserGuide.addEventListener("click", function() { deps.openSheet("sheetGuide"); });
      }

      const btnSwitchToNormal = $("#btnSwitchToNormalFromGuide");
      if (btnSwitchToNormal) {
        btnSwitchToNormal.addEventListener("click", function() {
          deps.closeSheet("sheetGuide");
          deps.setUserMode("normal");
        });
      }

      $$("#deliveryModeSeg .seg-item").forEach(function(btn) {
        btn.addEventListener("click", function() {
          const state = deps.getState();
          state.settings.defaultDeliveryMode = btn.dataset.mode === "alarm" ? "alarm" : "notification";
          deps.save();
          deps.renderMe();
          deps.queueNativeReminderSync();
          deps.toast(state.settings.defaultDeliveryMode === "alarm"
            ? "默认提醒方式：闹钟（仅影响之后录入）"
            : "默认提醒方式：系统通知（仅影响之后录入）");
        });
      });

      const swSummary = $("#swSummary");
      if (swSummary) {
        swSummary.addEventListener("click", function() {
          const state = deps.getState();
          state.settings.dailySummary = !state.settings.dailySummary;
          if (state.settings.dailySummary) state.settings.lastSummaryAt = 0;
          deps.save(); deps.renderMe();
          deps.toast(state.settings.dailySummary ? "轻量摘要已开启" : "轻量摘要已关闭");
        });
      }

      const swPrivacy = $("#swPrivacy");
      if (swPrivacy) {
        swPrivacy.addEventListener("click", function() {
          const state = deps.getState();
          state.settings.privacyNotify = !state.settings.privacyNotify;
          deps.save(); deps.renderMe();
          deps.toast(state.settings.privacyNotify ? "锁屏隐私已开启" : "锁屏隐私已关闭");
        });
      }

      const btnQuiet = $("#btnQuiet");
      if (btnQuiet) {
        btnQuiet.addEventListener("click", function() {
          const state = deps.getState();
          const quietStart = $("#quietStart");
          const quietEnd = $("#quietEnd");
          if (quietStart) quietStart.value = state.settings.quietStart || "23:00";
          if (quietEnd) quietEnd.value = state.settings.quietEnd || "07:30";
          deps.openSheet("sheetQuiet");
        });
      }

      const btnSaveQuiet = $("#btnSaveQuiet");
      if (btnSaveQuiet) {
        btnSaveQuiet.addEventListener("click", function() {
          const state = deps.getState();
          const quietStart = $("#quietStart");
          const quietEnd = $("#quietEnd");
          state.settings.quietStart = (quietStart && quietStart.value) || "23:00";
          state.settings.quietEnd = (quietEnd && quietEnd.value) || "07:30";
          deps.save();
          deps.closeSheet("sheetQuiet");
          deps.renderMe();
          deps.toast("勿扰时段已更新");
        });
      }

      const getAi = function() {
        return typeof deps.getAi === "function" ? deps.getAi() : null;
      };

      const btnAi = $("#btnAi");
      if (btnAi) btnAi.addEventListener("click", function() { const a = getAi(); if (a) a.openAiSheet(); });

      const swAi = $("#swAi");
      if (swAi) {
        swAi.addEventListener("click", function() {
          swAi.classList.toggle("on");
        });
      }

      $$("#aiAutoChips .chip").forEach(function(ch) {
        ch.addEventListener("click", function() {
          $$("#aiAutoChips .chip").forEach(function(x) { x.classList.remove("on"); });
          ch.classList.add("on");
        });
      });

      const btnSaveAi = $("#btnSaveAi");
      if (btnSaveAi) btnSaveAi.addEventListener("click", function() {
        if (typeof deps.saveAiSettings === "function") deps.saveAiSettings();
        else { const a = getAi(); if (a) a.saveAiSettings(); }
      });

      const btnAiTest = $("#btnAiTest");
      if (btnAiTest) {
        btnAiTest.addEventListener("click", async function() {
          const a = getAi();
          if (!a && typeof deps.testAiConnection !== "function") return;
          const state = deps.getState();
          const prev = state.settings.ai;
          const aiBaseUrl = $("#aiBaseUrl");
          const aiApiKey = $("#aiApiKey");
          const aiModel = $("#aiModel");
          const activeChip = ($$("#aiAutoChips .chip.on")[0] || {});
          state.settings.ai = {
            enabled: swAi && swAi.classList.contains("on"),
            baseUrl: ((aiBaseUrl && aiBaseUrl.value) || "").trim().replace(/\/+$/, ""),
            apiKey: ((aiApiKey && aiApiKey.value) || "").trim(),
            model: ((aiModel && aiModel.value) || "").trim(),
            autoOnSave: activeChip.dataset && activeChip.dataset.auto === "on"
          };
          btnAiTest.disabled = true;
          btnAiTest.textContent = "测试中…";
          try {
            if (typeof deps.testAiConnection === "function") await deps.testAiConnection();
            else await a.testConnection();
            deps.toast("连接成功");
          } catch (e) {
            deps.toast("连接失败：" + (e && e.message ? e.message : "未知错误"));
          } finally {
            state.settings.ai = prev;
            btnAiTest.disabled = false;
            btnAiTest.textContent = "测试连接";
          }
        });
      }

      const btnAiParse = $("#btnAiParse");
      if (btnAiParse) btnAiParse.addEventListener("click", function() {
        if (typeof deps.runAiOnCapture === "function") deps.runAiOnCapture("parse");
        else { const a = getAi(); if (a) a.runOnCapture("parse"); }
      });

      const btnAiPolish = $("#btnAiPolish");
      if (btnAiPolish) btnAiPolish.addEventListener("click", function() {
        if (typeof deps.runAiOnCapture === "function") deps.runAiOnCapture("polish");
        else { const a = getAi(); if (a) a.runOnCapture("polish"); }
      });

      const getBackup = function() {
        return typeof deps.getBackup === "function" ? deps.getBackup() : null;
      };

      const btnExport = $("#btnExport");
      if (btnExport) btnExport.addEventListener("click", function() {
        if (typeof deps.exportData === "function") deps.exportData();
        else { const b = getBackup(); if (b) b.exportData(); }
      });

      const importFile = $("#importFile");
      const btnImport = $("#btnImport");
      if (btnImport && importFile) btnImport.addEventListener("click", function() { importFile.click(); });
      if (importFile) {
        importFile.addEventListener("change", function(e) {
          const selectedFile = e.target.files && e.target.files[0];
          if (selectedFile) {
            if (typeof deps.importDataFile === "function") deps.importDataFile(selectedFile);
            else { const b = getBackup(); if (b) b.importDataFile(selectedFile); }
          }
          e.target.value = "";
        });
      }

      const btnSeed = $("#btnSeed");
      if (btnSeed) {
        btnSeed.addEventListener("click", function() {
          try {
            openDemoPreview();
          } catch (e) {
            console.error(e);
            deps.toast("打开演示失败：" + (e && e.message ? e.message : "未知错误"));
          }
        });
      }

      const btnClear = $("#btnClear");
      if (btnClear) {
        btnClear.addEventListener("click", async function() {
          const ok = await deps.confirmDialog("确定清空本机全部事项、笔记与项目？", "清空数据");
          if (!ok) return;
          if (deps.inflightDepth() > 0) {
            deps.toast("提醒操作正在保存 · 请稍后再清空数据");
            return;
          }
          const state = deps.getState();
          state.items = []; state.notes = []; state.projects = [];
          deps.save(); deps.render(); deps.toast("已清空");
        });
      }

      const btnPrd = $("#btnPrd");
      if (btnPrd) {
        btnPrd.addEventListener("click", function() {
          if (typeof location !== "undefined") location.href = "prd.html";
        });
      }

      if (typeof deps.bindAlertControls === "function") {
        deps.bindAlertControls();
      } else {
        const appAlerts = typeof deps.getAppAlerts === "function" ? deps.getAppAlerts() : null;
        if (appAlerts && typeof appAlerts.bindAlertControls === "function") {
          appAlerts.bindAlertControls();
        }
      }
      if (typeof deps.bindDiagnostics === "function") {
        deps.bindDiagnostics();
      }
      if (typeof deps.bindAppContent === "function") {
        deps.bindAppContent();
      }
    }

    function isBound() {
      return bound;
    }

    return {
      bind: bind,
      isBound: isBound,
      applyShareParams: applyShareParams,
      handleQueryActions: handleQueryActions,
      demoPreviewRows: demoPreviewRows,
      openDemoPreview: openDemoPreview,
      seed: seed
    };
  }

  return {
    createAppEvents: createAppEvents
  };
});
