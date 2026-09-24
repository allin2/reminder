/* P3-I: Test interface assembly module (__ATTENTION_INBOX__).
 * UMD factory: evaluation performs no I/O, no DOM querying, and no state mutation.
 */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppTestApi = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppTestApi(input) {
    const deps = input || {};
    const REQUIRED_DEPS = [
      "getState",
      "getAppItems",
      "getAppTransaction",
      "getAppNativeCoordinator",
      "getAppPlatform",
      "getAppAlerts",
      "getAppViews",
      "getAppReview",
      "getAppContent",
      "getAppCapture",
      "getAppSetup",
      "getDiagnostics",
      "getAppActionFeedback",
      "getAppEvents",
      "getAppPersistence",
      "getAi"
    ];
    REQUIRED_DEPS.forEach(function(name) {
      if (typeof deps[name] !== "function") {
        throw new Error("createAppTestApi(deps) 缺少必要依赖：" + name);
      }
    });

    let currentTestApi = null;

    function assembleTestApi() {
      const g = typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : root);
      if (!g) return null;

      currentTestApi = {
        get parseChineseTime() { return deps.getParseChineseTime ? deps.getParseChineseTime() : null; },
        makeItem: function(opts) { return deps.makeItem(opts); },
        get nextRepeatTrigger() { return deps.getNextRepeatTrigger ? deps.getNextRepeatTrigger() : null; },
        get nthWeekdayOfNextMonthByInstant() {
          const p = deps.getDatePrimitives ? deps.getDatePrimitives() : (root.AttentionLib && root.AttentionLib.DatePrimitives);
          return p ? p.nthWeekdayOfNextMonthByInstant : null;
        },
        get nthWeekdayOfNextMonthByDay() {
          const p = deps.getDatePrimitives ? deps.getDatePrimitives() : (root.AttentionLib && root.AttentionLib.DatePrimitives);
          return p ? p.nthWeekdayOfNextMonthByDay : null;
        },
        get nthWeekdayInMonth() { return deps.getNthWeekdayInMonth ? deps.getNthWeekdayInMonth() : null; },
        get lastDayOfMonth() { return deps.getLastDayOfMonth ? deps.getLastDayOfMonth() : null; },
        get repeatLabel() { return deps.getRepeatLabel ? deps.getRepeatLabel() : null; },
        findSimilarItems: function(title, selfId) { return deps.findSimilarItems ? deps.findSimilarItems(title, selfId) : []; },
        isDue: function(it) { return deps.isDue ? deps.isDue(it) : false; },
        inQuietHours: function(date, start, end) { return deps.inQuietHours ? deps.inQuietHours(date, start, end) : false; },
        quietEnd: function(date, start, end) { return deps.quietEnd ? deps.quietEnd(date, start, end) : null; },
        promoteDue: function() { return deps.promoteDue ? deps.promoteDue.apply(null, arguments) : null; },
        ackItem: function(id) { return deps.ackItem ? deps.ackItem(id) : false; },
        completeItem: function(id) { return deps.completeItem ? deps.completeItem(id) : false; },
        snoozeItem: function(id, when, basis) { return deps.snoozeItem ? deps.snoozeItem(id, when, basis) : false; },
        reopenItem: function(id) { return deps.reopenItem ? deps.reopenItem(id) : false; },
        restoreItem: function(id) { return deps.restoreItem ? deps.restoreItem(id) : false; },
        deleteItem: function(id) { return deps.deleteItem ? deps.deleteItem(id) : false; },
        seed: function(which) { return deps.seed ? deps.seed(which) : false; },
        get hasSpecificTimeWord() { return deps.getHasSpecificTimeWord ? deps.getHasSpecificTimeWord() : null; },
        fallbackTriggerAt: function(item, createdAt) { return deps.fallbackTriggerAt ? deps.fallbackTriggerAt(item, createdAt) : null; },
        resolveDeliveryMode: function(item) { return deps.resolveDeliveryMode ? deps.resolveDeliveryMode(item) : "notification"; },
        ensureReviewSettings: function(settings) { return deps.ensureReviewSettings ? deps.ensureReviewSettings.apply(null, arguments) : settings; },
        inReviewHighlight: function(it, now) { return deps.inReviewHighlight ? deps.inReviewHighlight(it, now) : false; },
        renderHome: function() { return deps.renderHome ? deps.renderHome.apply(null, arguments) : null; },
        homeRenderStats: function() {
          const v = deps.getAppViews();
          return v && typeof v.homeRenderStats === "function" ? Object.assign({}, v.homeRenderStats()) : {};
        },
        resetHomeRenderStats: function() {
          const v = deps.getAppViews();
          if (v && typeof v.resetHomeRenderStats === "function") v.resetHomeRenderStats();
        },
        nativeSyncStats: function() {
          const c = deps.getAppNativeCoordinator();
          if (c && typeof c.getNativeSyncMetrics === "function") return c.getNativeSyncMetrics();
          return { totalRequests: 0, runs: 0, deduped: 0, blockedByAuthority: 0, bySource: {} };
        },
        resetNativeSyncStats: function() {
          const c = deps.getAppNativeCoordinator();
          if (c && typeof c.getNativeSyncMetrics === "function") {
            const m = c.getNativeSyncMetrics();
            m.totalRequests = 0; m.runs = 0; m.deduped = 0; m.blockedByAuthority = 0; m.bySource = {};
          }
        },
        renderReviewEntry: function() { return deps.renderReviewEntry ? deps.renderReviewEntry.apply(null, arguments) : null; },
        renderReviewCard: function(it) { return deps.renderReviewCard ? deps.renderReviewCard.apply(null, arguments) : null; },
        openReviewSession: function() { return deps.openReviewSession ? deps.openReviewSession.apply(null, arguments) : null; },
        maybeReviewSession: function() { return deps.maybeReviewSession ? deps.maybeReviewSession.apply(null, arguments) : null; },
        needsReviewItems: function() { return deps.needsReviewItems ? deps.needsReviewItems.apply(null, arguments) : []; },
        detectNeedsReview: function(it) { return deps.detectNeedsReview ? deps.detectNeedsReview(it) : false; },
        reviewConfirm: function(it, opts) { return deps.reviewConfirm ? deps.reviewConfirm(it, opts) : null; },
        reviewSaveEdit: function(it, form) { return deps.reviewSaveEdit ? deps.reviewSaveEdit(it, form) : null; },
        reviewKeepCurrent: function(it) { return deps.reviewKeepCurrent ? deps.reviewKeepCurrent(it) : null; },
        resolveReviewTrigger: function(it, mode) { return deps.resolveReviewTrigger ? deps.resolveReviewTrigger(it, mode) : null; },
        markReviewDone: function(it, extra) { return deps.markReviewDone ? deps.markReviewDone(it, extra) : null; },
        markReviewTriggerPicked: function(v) {
          const r = deps.getAppReview();
          if (r && typeof r.markReviewTriggerPicked === "function") r.markReviewTriggerPicked(v);
        },
        stopRepeat: function(id) { return deps.stopRepeat ? deps.stopRepeat(id) : false; },
        resumeDeadlineProtection: function(id) { return deps.resumeDeadlineProtection ? deps.resumeDeadlineProtection(id) : false; },
        applyDeadlineEvents: function() {
          return deps.applyDeadlineEvents ? deps.applyDeadlineEvents.apply(null, arguments) : null;
        },
        markDeadlineDelivered: function() {
          return deps.markDeadlineDelivered ? deps.markDeadlineDelivered.apply(null, arguments) : null;
        },
        applyReminderEvents: function() {
          return deps.applyReminderEvents ? deps.applyReminderEvents.apply(null, arguments) : null;
        },
        replayPendingSnapshot: function() { return deps.replayPendingSnapshot ? deps.replayPendingSnapshot() : false; },
        showAlert: function(it) { return deps.showAlert ? deps.showAlert(it) : null; },
        hideAlert: function() { return deps.hideAlert ? deps.hideAlert() : null; },
        dismissAlert: function() { return deps.dismissAlert ? deps.dismissAlert() : null; },
        describeAlarmDelivery: function(it) { return deps.describeAlarmDelivery ? deps.describeAlarmDelivery(it) : ""; },
        homeNoticeVerdict: function(status, settings, native) { return deps.homeNoticeVerdict ? deps.homeNoticeVerdict(status, settings, native) : null; },
        renderHomeNotice: function() { return deps.renderHomeNotice ? deps.renderHomeNotice() : null; },
        renderPwaStatus: function() {
          const v = deps.getAppViews();
          return v && typeof v.renderPwaStatus === "function" ? v.renderPwaStatus.apply(v, arguments) : null;
        },
        setNativeReminderStatus: function(status) { return deps.setNativeReminderStatus ? deps.setNativeReminderStatus(status) : null; },
        handleAlarmAction: function(data) { return deps.handleAlarmAction ? deps.handleAlarmAction(data) : null; },
        completeActiveAlarm: function(alarm) { return deps.completeActiveAlarm ? deps.completeActiveAlarm(alarm) : Promise.resolve(false); },
        deliveryHandledByCommittedItem: function(alarm, item) { return deps.deliveryHandledByCommittedItem ? deps.deliveryHandledByCommittedItem(alarm, item) : false; },
        alarmEventSeen: function(id) { return deps.alarmEventSeen ? deps.alarmEventSeen(id) : false; },
        get transaction() { return deps.getAppTransaction(); },
        get items() { return deps.getAppItems(); },
        get nativeCoordinator() { return deps.getAppNativeCoordinator(); },
        getNativeReminderStatus: function() { return deps.getNativeReminderStatus ? deps.getNativeReminderStatus() : null; },
        getNativeSyncVersion: function() { return deps.getNativeSyncVersion ? deps.getNativeSyncVersion() : 0; },
        refreshNativeScheduleBasis: function(it) { return deps.refreshNativeScheduleBasis ? deps.refreshNativeScheduleBasis(it) : null; },
        syncNativeRemindersNow: function(src) { return deps.syncNativeRemindersNow ? deps.syncNativeRemindersNow(src) : Promise.resolve(); },
        queueNativeReminderSync: function(src) { return deps.queueNativeReminderSync ? deps.queueNativeReminderSync(src) : null; },
        runUserOp: function(name, op, args, opts) { return deps.runUserOp ? deps.runUserOp(name, op, args, opts) : null; },
        wrapUserOp: function(fn, opts) { return deps.wrapUserOp ? deps.wrapUserOp(fn, opts) : fn; },
        itemConflictsWithActiveAction: function(it) { return deps.itemConflictsWithActiveAction ? deps.itemConflictsWithActiveAction(it) : false; },
        isItemActionPending: function(id) { return deps.isItemActionPending ? deps.isItemActionPending(id) : false; },
        rejectPendingItemCommand: function() { return deps.rejectPendingItemCommand ? deps.rejectPendingItemCommand() : null; },
        takeReplayCreatedId: function(oldId) { return deps.takeReplayCreatedId ? deps.takeReplayCreatedId(oldId) : null; },
        inflightDepth: function() { return deps.inflightDepth ? deps.inflightDepth() : 0; },
        isFeedbackSuppressed: function() { return deps.isFeedbackSuppressed ? deps.isFeedbackSuppressed() : false; },
        shouldSuppressInnerSave: function() { return deps.shouldSuppressInnerSave ? deps.shouldSuppressInnerSave() : false; },
        ready: function() { return deps.ready ? deps.ready() : Promise.resolve(true); },
        handleNativeNotificationAction: function(evt) { return deps.handleNativeNotificationAction ? deps.handleNativeNotificationAction(evt) : null; },
        saveItemFromForm: function() { return deps.saveItemFromForm ? deps.saveItemFromForm() : null; },
        openDemoPreview: function() { return deps.openDemoPreview ? deps.openDemoPreview() : null; },
        demoPreviewRows: function() { return deps.demoPreviewRows ? deps.demoPreviewRows() : []; },
        undoNewItem: function(id, rev) { return deps.undoNewItem ? deps.undoNewItem(id, rev) : false; },
        undoLastComplete: function() { return deps.undoLastComplete ? deps.undoLastComplete() : false; },
        lastCompleteUndo: function() { return deps.lastCompleteUndo ? deps.lastCompleteUndo() : null; },
        startSetupTestRun: function() { return deps.startSetupTestRun ? deps.startSetupTestRun() : null; },
        stopSetupTestRun: function() { return deps.stopSetupTestRun ? deps.stopSetupTestRun() : null; },
        setupEvidenceHtml: function(s) { return deps.setupEvidenceHtml ? deps.setupEvidenceHtml(s) : ""; },
        setupStepsContext: function() { return deps.setupStepsContext ? deps.setupStepsContext() : null; },
        readDeliveryEvidence: function(it) { return deps.readDeliveryEvidence ? deps.readDeliveryEvidence(it) : null; },
        applyNativeDeliveryEvidence: function(it, ev) { return deps.applyNativeDeliveryEvidence ? deps.applyNativeDeliveryEvidence(it, ev) : null; },
        applyReminderDelivered: function(it, k) { return deps.applyReminderDelivered ? deps.applyReminderDelivered(it, k) : null; },
        detailReminderStatusRow: function(it) { return deps.detailReminderStatusRow ? deps.detailReminderStatusRow(it) : null; },
        itemScheduleEvidence: function(it) {
          const f = deps.getAppActionFeedback();
          return f && typeof f.itemScheduleEvidence === "function" ? f.itemScheduleEvidence(it) : null;
        },
        deliveryEvidenceReadable: function(it) { return deps.deliveryEvidenceReadable ? deps.deliveryEvidenceReadable(it) : false; },
        get deliveryEvidenceState() {
          const c = deps.getAppNativeCoordinator();
          return c && typeof c.getDeliveryEvidenceState === "function" ? c.getDeliveryEvidenceState() : null;
        },
        markTriggerPicked: function(v) {
          const c = deps.getAppCapture();
          if (c && typeof c.markTriggerPicked === "function") c.markTriggerPicked(v);
        },
        openCapture: function(opts) { return deps.openCapture ? deps.openCapture(opts) : null; },
        openEditItem: function(id) { return deps.openEditItem ? deps.openEditItem(id) : null; },
        resetItemSheet: function() { return deps.resetItemSheet ? deps.resetItemSheet() : null; },
        closeAllSheets: function() { return deps.closeAllSheets ? deps.closeAllSheets() : null; },
        get formSession() {
          const c = deps.getAppCapture();
          return c && typeof c.session === "function" ? c.session() : null;
        },
        clearAlert: function() {
          const a = deps.getAppAlerts();
          if (a && typeof a.clearAlert === "function") a.clearAlert();
        },
        get alerts() { return deps.getAppAlerts(); },
        get APP_ALERTS_INSTANCE_CONTRACT() { return deps.APP_ALERTS_INSTANCE_CONTRACT; },
        get platform() { return deps.getAppPlatform(); },
        get APP_PLATFORM_INSTANCE_CONTRACT() { return deps.APP_PLATFORM_INSTANCE_CONTRACT; },
        get actionFeedback() { return deps.getAppActionFeedback(); },
        get APP_ACTION_FEEDBACK_INSTANCE_CONTRACT() { return deps.APP_ACTION_FEEDBACK_INSTANCE_CONTRACT; },
        get events() { return deps.getAppEvents(); },
        get APP_EVENTS_INSTANCE_CONTRACT() { return deps.APP_EVENTS_INSTANCE_CONTRACT; },
        get testApi() { return deps.getAppTestApi ? deps.getAppTestApi() : null; },
        get APP_TEST_API_INSTANCE_CONTRACT() { return deps.APP_TEST_API_INSTANCE_CONTRACT; },
        get state() { return deps.getState() || Object.freeze({ items: [] }); },
        setUserMode: function(mode) { return deps.setUserMode ? deps.setUserMode(mode) : null; },
        syncUserMode: function() { return deps.syncUserMode ? deps.syncUserMode() : null; },
        save: function(opts) { return deps.save ? deps.save(opts) : null; },
        saveAsync: function(opts) { return deps.saveAsync ? deps.saveAsync(opts) : Promise.resolve(); },
        load: function() { return deps.load ? deps.load() : null; },
        loadAsync: function() { return deps.loadAsync ? deps.loadAsync() : Promise.resolve(); },
        get exportData() {
          const b = deps.getBackup ? deps.getBackup() : null;
          return b ? b.exportData : null;
        },
        buildLegacyBackupPayload: function() {
          if (deps.buildLegacyBackupPayload) return deps.buildLegacyBackupPayload();
          const b = deps.getBackup ? deps.getBackup() : null;
          return b && typeof b.buildLegacyBackupPayload === "function" ? b.buildLegacyBackupPayload() : null;
        },
        get noteExportAppVisibility() {
          const b = deps.getBackup ? deps.getBackup() : null;
          return b ? b.noteExportAppVisibility : null;
        },
        get normalizeAiResult() {
          return (root.AttentionLib && root.AttentionLib.AppAi && root.AttentionLib.AppAi.normalizeAiResult) ||
            (typeof AppAi !== "undefined" && AppAi.normalizeAiResult);
        },
        get extractJson() {
          return (root.AttentionLib && root.AttentionLib.AppAi && root.AttentionLib.AppAi.extractJsonObject) ||
            (typeof AppAi !== "undefined" && AppAi.extractJsonObject);
        },
        get ai() { return deps.getAi(); },
        get aiBusy() {
          const a = deps.getAi();
          return a && typeof a.isBusy === "function" ? a.isBusy() : null;
        },
        renderMarkdown: function(s) { return deps.renderMarkdown ? deps.renderMarkdown(s) : s; },
        uid: function() { return deps.uid ? deps.uid() : ""; },
        get startOfDay() { return deps.getStartOfDay ? deps.getStartOfDay() : null; },
        get addDays() { return deps.getAddDays ? deps.getAddDays() : null; },
        get sameDay() { return deps.getSameDay ? deps.getSameDay() : null; },
        get applyClock() { return deps.getApplyClock ? deps.getApplyClock() : null; },
        get storage() {
          if (deps.getStorage) return deps.getStorage();
          const p = deps.getAppPersistence ? deps.getAppPersistence() : null;
          return p && typeof p.getStorage === "function" ? p.getStorage() : null;
        },
        assertRuntimeDependencies: function(roots) { return deps.assertRuntimeDependencies ? deps.assertRuntimeDependencies(roots) : []; },
        renderStartupFailure: function(problems) { return deps.renderStartupFailure ? deps.renderStartupFailure(problems) : null; },
        get REQUIRED_RUNTIME_EXPORTS() { return deps.REQUIRED_RUNTIME_EXPORTS; },
        collectRuntimeBindings: function() { return deps.collectRuntimeBindings ? deps.collectRuntimeBindings() : null; },
        bindRuntime: function() { return deps.bindRuntime ? deps.bindRuntime() : []; },
        get RUNTIME_BINDING_PATHS() { return deps.RUNTIME_BINDING_PATHS; },
        get APP_UI_INSTANCE_CONTRACT() { return deps.APP_UI_INSTANCE_CONTRACT; },
        get APP_AI_INSTANCE_CONTRACT() { return deps.APP_AI_INSTANCE_CONTRACT; },
        get APP_BACKUP_INSTANCE_CONTRACT() { return deps.APP_BACKUP_INSTANCE_CONTRACT; },
        get APP_DIAGNOSTICS_INSTANCE_CONTRACT() { return deps.APP_DIAGNOSTICS_INSTANCE_CONTRACT; },
        get APP_CAPTURE_INSTANCE_CONTRACT() { return deps.APP_CAPTURE_INSTANCE_CONTRACT; },
        get APP_VIEWS_INSTANCE_CONTRACT() { return deps.APP_VIEWS_INSTANCE_CONTRACT; },
        get APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT() { return deps.APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT; },
        get APP_REVIEW_INSTANCE_CONTRACT() { return deps.APP_REVIEW_INSTANCE_CONTRACT; },
        startApp: function() { return deps.startApp ? deps.startApp() : Promise.resolve(true); },
        get diagnostics() { return deps.getDiagnostics(); },
        get setup() { return deps.getAppSetup(); },
        get content() { return deps.getAppContent(); },
        get views() { return deps.getAppViews(); },
        get review() { return deps.getAppReview(); },
        get reviewSurface() {
          const r = deps.getAppReview();
          if (!r) return { missing: true };
          return {
            hasEnsureSettings: typeof r.ensureReviewSettings === "function",
            hasDetectNeedsReview: typeof r.detectNeedsReview === "function",
            hasNeedsReviewItems: typeof r.needsReviewItems === "function",
            hasInReviewWindow: typeof r.inReviewWindow === "function",
            hasInReviewHighlight: typeof r.inReviewHighlight === "function",
            hasOpenReviewSession: typeof r.openReviewSession === "function",
            hasCurrentReviewItem: typeof r.currentReviewItem === "function",
            hasRenderReviewCard: typeof r.renderReviewCard === "function",
            hasRenderReviewEntry: typeof r.renderReviewEntry === "function",
            hasBindReviewControls: typeof r.bindReviewControls === "function",
            hasScheduleNextReviewAlarm: typeof r.scheduleNextReviewAlarm === "function"
          };
        },
        get platformSurface() {
          const p = deps.getAppPlatform();
          if (!p) return { missing: true };
          return {
            hasIsNative: typeof p.isNativeAndroidRuntime === "function",
            hasWaitForBridge: typeof p.waitForNativeBridge === "function",
            hasSystemBridge: typeof p.systemBridge === "function",
            hasAppSettings: typeof p.appSettingsPlugin === "function",
            hasBindInstall: typeof p.bindInstall === "function",
            hasBindNetwork: typeof p.bindNetwork === "function",
            hasRegisterPwa: typeof p.registerPwa === "function"
          };
        },
        get viewsSurface() {
          const v = deps.getAppViews();
          if (!v) return { missing: true };
          return {
            hasHome: typeof v.renderHome === "function",
            hasCard: typeof v.renderItemCard === "function",
            hasDetail: typeof v.openDetail === "function",
            hasFuture: typeof v.renderFuture === "function",
            hasMe: typeof v.renderMe === "function"
          };
        },
        get contentSurface() {
          const c = deps.getAppContent();
          if (!c) return { missing: true };
          return {
            hasBind: typeof c.bind === "function",
            hasNotes: typeof c.openNote === "function",
            hasSearch: typeof c.doSearch === "function",
            hasProjects: typeof c.deleteProject === "function"
          };
        },
        get captureSurface() {
          const c = deps.getAppCapture();
          if (!c) return { missing: true };
          return {
            hasBind: typeof c.bind === "function",
            hasSession: typeof c.session === "function",
            hasSnapshot: typeof c.snapshotItemForm === "function",
            hasOpen: typeof c.openCapture === "function",
            hasEdit: typeof c.openEditItem === "function",
            hasHint: typeof c.updateParseHint === "function"
          };
        },
        get setupSurface() {
          const s = deps.getAppSetup();
          if (!s) return { missing: true };
          return {
            hasBind: typeof s.bind === "function",
            hasPrompt: typeof s.maybePromptAndroidNotify === "function",
            hasTest: typeof s.startSetupTestRun === "function",
            hasStop: typeof s.stopSetupTestRun === "function",
            hasEvidence: typeof s.setupEvidenceHtml === "function"
          };
        },
        diagnosticsSurface: function() {
          const d = deps.getDiagnostics();
          if (!d) return { missing: true };
          return {
            hasBind: typeof d.bind === "function",
            hasRefresh: typeof d.refreshNotifyLab === "function",
            hasLabLog: typeof d.labLog === "function",
            hasCancel: typeof d.labCancelAlarms === "function",
            hasDescribe: typeof d.describeAlarmDelivery === "function",
            hasOpenSystem: typeof d.openSystemSetting === "function",
            hasOpenGuide: typeof d.openBackgroundGuide === "function"
          };
        },
        runtimeBindings: function() {
          return deps.runtimeBindings ? deps.runtimeBindings() : {};
        },
        startupFailure: function() {
          return deps.startupFailure ? deps.startupFailure() : null;
        },
        stateAuthority: function() {
          const p = deps.getAppPersistence();
          const c = deps.getAppNativeCoordinator();
          return Object.assign({}, p && typeof p.authoritySnapshot === "function" ? p.authoritySnapshot() : {
            status: "unconfirmed", report: null, attempts: 0, blockedWriteCount: 0,
            writesAllowed: false, mirrorBytes: null
          }, {
            nativeBlocked: c && typeof c.getNativeSyncMetrics === "function" ? c.getNativeSyncMetrics().blockedByAuthority : 0,
            recoveryPanel: deps.isStateRecoveryPanelShown ? deps.isStateRecoveryPanelShown() : false
          });
        },
        retryRestore: function() { return deps.retryRestore ? deps.retryRestore() : null; },
        uiSurface: function() { return deps.uiSurface ? deps.uiSurface() : {}; },
        aiSurface: function() { return deps.aiSurface ? deps.aiSurface() : {}; }
      };

      g.__ATTENTION_INBOX__ = currentTestApi;
      g.seedAttentionInbox = deps.seed;
      return currentTestApi;
    }

    function getTestApi() {
      return currentTestApi;
    }

    return {
      assembleTestApi: assembleTestApi,
      getTestApi: getTestApi
    };
  }

  return {
    createAppTestApi: createAppTestApi
  };
});
