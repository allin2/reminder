## 顶层符号 → 目标模块分配表（自动生成）

来源：`app-core.js` @ 8559 行 / 387384 字节，293 个函数 + 72 个状态，共 365 个顶层符号。
生成器：`scripts/verification/module-map-gen.js`（改区间后重跑即可刷新本表）。

| 原行区间 | 负责的内容 | 目标归属 | 顶层符号数 | 符号 |
| --- | --- | --- | --- | --- |
| 1–47 | （入口）常量 / 依赖句柄 / 状态声明 | app-core.js + lib/app-model.js | 18 | KEY, SCHEMA, $, $$, Lib, NativeReminders, FeedbackLib, EvidenceLib, storage, storageReady, schemaMigrationNeeded, nativeReady, nativeSyncTimer, nativeInitPromise, triggerUserPicked, reviewTriggerUserPicked, itemFormSession, nativeReminderStatus |
| 48–105 | 通用工具：id / 补零 / 日期基础 / 相对时间 / HTML 文本转义 | lib/date-utils.js + lib/app-ui.js | 11 | uid, pad, startOfDay, endOfDay, addDays, sameDay, fmtTime, fmtDate, relDue, nextWeekend, escapeHtml |
| 106–177 | 属性转义 / 危险链接 / 本地时间输入 / 历史分组标签 | lib/app-ui.js + lib/date-utils.js | 4 | escapeAttr, safeExternalHref, toLocalInput, parseLocalInput |
| 178–231 | 日历原语：applyClock / 月末 / 第 N 个星期几 | lib/date-utils.js | 5 | dayLabel, applyClock, lastDayOfMonth, nthWeekdayInMonth, nthWeekdayOfNextMonth |
| 240–259 | 解析用日历原语：下周 X / 每月 N 号 | lib/date-utils.js | 3 | weekdayOfNextWeek, dayOfMonthIn, nextDayOfMonth |
| 261–283 | 周期标签与预览（重复实现） | 删除（唯一来源 lib/repeat.js） | 2 | repeatLabel, nextRepeatPreview |
| 284–300 | 浏览器下载 | lib/app-backup.js（平台分支） | 1 | downloadFile |
| 302–336 | 极简 Markdown 渲染 | lib/app-ui.js | 1 | renderMarkdown |
| 338–592 | 中文时间解析器副本 + CN_NUM + cnInt | 删除（唯一来源 lib/parse-cn.js） | 3 | CN_NUM, cnInt, parseChineseTime |
| 593–656 | 项目配色 / 初始 state | lib/app-model.js | 2 | PROJECT_COLORS, state |
| 657–1217 | 持久化：快照 / 提交链 / 重放 / 加载 / 模型规范化 | lib/app-persistence.js + lib/app-model.js | 38 | currentPayload, writeSnapshot, authoritativeBackendMissing, PENDING_REPLAY_KEY, markPendingReplay, readPendingReplay, clearPendingReplay, commitChain, runCommit, saveAsync, suppressInnerSave, save, inflightActionDepth, pendingUserOps, suppressUserFeedback, replayCreatedIds, activeActionScope, applyingActionDraft, itemConflictsWithActiveAction, isItemActionPending, rejectPendingItemCommand, commandConflicts, runUserOp, takeReplayCreatedId, recordArg, resolveArg, wrapUserOp, replayUserOps, applyParsedState, replayPendingSnapshot, loadAsync, loadSync, load, normalizeItem, resolveDeliveryMode, makeItem, projectById, bumpRev |
| 1218–1310 | 截止阶段身份 / 终态 / rev / 整理设置 | lib/app-model.js | 7 | deadlineStageKeyOf, isTerminal, hasKnownRev, isFallbackSuppressed, isAttentionDue, ensureReviewSettings, fallbackTriggerAt |
| 1311–1392 | 模糊内容判定 / 整理窗口规则 | lib/app-model.js + lib/app-review.js | 8 | hasSpecificTimeWord, VAGUE_RE, isVagueContent, detectNeedsReview, needsReviewItems, reviewSessionKey, nextReviewWindowStart, inReviewWindow |
| 1393–1710 | 整理会话：通知 / 会话 / 卡片 / 出口命令 | lib/app-review.js | 14 | fireReviewNotification, maybeReviewSession, openReviewSession, currentReviewItem, renderReviewCard, resolveReviewTrigger, markReviewDone, reviewConfirm, reviewSaveEdit, reviewKeepCurrent, reviewDelete, snoozeReview, skipReviewThisTime, inReviewHighlight |
| 1711–2083 | 首页告知条 / 渲染入口 / 周期推进 / 派生 / ACK | lib/app-views.js + lib/app-items.js | 16 | homeNoticeVerdict, lastWrittenHtml, writeIfChanged, renderHomeNotice, renderReviewEntry, scheduleNextReviewAlarm, isDue, parseHHMM, inQuietHours, quietEnd, promoteDue, nextRepeatTrigger, ensureSeriesId, seriesMembers, isUnstartedInstance, spawnNextInstance |
| 2084–2536 | 事项命令：稍后 / 完成 / 撤销 / 删除 / 恢复 / 停止周期 | lib/app-items.js | 16 | openSnoozeSheet, ackItem, advanceSeriesOnArchive, lastCompleteUndo, COMPLETE_UNDO_MS, undoNativeCheckPending, applyCompleteUndo, revertCompleteUndo, undoLastComplete, completeItem, snoozeItem, deleteItem, reopenItem, restoreItem, resumeDeadlineProtection, stopRepeat |
| 2537–3020 | 视图：卡片 / 首页 / 日历 / 归档 / 未来 / 笔记 / 统计 | lib/app-views.js | 15 | priorityRank, actionButton, renderItemCard, setBadge, updateAppBadge, homeCardSignatureRow, homeCardSignature, homeViewSignature, homeRenderStats, renderHome, renderCalendar, renderArchiveList, renderFuture, renderNotes, renderStats |
| 3021–3154 | 用户模式 / 个人页 / PWA 状态 | lib/app-views.js + lib/app-platform.js | 4 | syncUserMode, setUserMode, renderMe, renderPwaStatus |
| 3155–3472 | AI 请求与结果归一 / 表单协作 | lib/app-ai.js | 20 | render, refreshProjectSelects, aiConfig, aiReady, aiNowIso, aiSystemPrompt, aiChat, extractJson, parseIsoSafe, normalizeAiResult, aiParseCapture, aiPolishCapture, aiTestConnection, applyAiToForm, aiMergedDraft, aiBusy, runAiOnCapture, openAiSheet, saveAiSettings, renderAiSub |
| 3473–3560 | 弹层 / 确认框 / toast --- 共用展示能力 | lib/app-ui.js | 7 | openSheet, closeSheet, closeAllSheets, confirmDialog, toastTimer, toast, hideToast |
| 3561–4000 | 表单会话 / 保存反馈 / 有限撤销 | lib/app-capture.js | 21 | saveSubmitsInFlight, beginSaveSubmit, endSaveSubmit, setSaveButtonRunning, snapshotItemForm, formDraftSignature, restoreItemForm, saveSubmitToken, settleFailedDraft, keepDraftForRetry, itemScheduleEvidence, feedbackNativeSnapshot, feedbackItemSnapshot, feedbackVerdictFor, runFeedbackAction, feedbackWaiters, FEEDBACK_WAIT_MS, undoNewItem, announceSaveOutcome, settleSaveFeedback, resetItemSheet |
| 4001–4328 | 捕获 / 编辑表单：打开 / 复位 / 草稿 / 相似提示 | lib/app-capture.js | 18 | openCapture, openEditItem, formRepeat, updateRepeatPreview, normalizeText, findSimilarItems, renderSimilarHint, openLowConfSheet, similarTimer, pendingFinishSave, lowConfUserPicked, finishSaveAfterLowConf, setLowConfPick, maybeDailySummary, updateParseHint, renderCaptureSummary, applyItemEdit, applyNewItem |
| 4329–4628 | 表单保存命令（唯一落库边界） | lib/app-capture.js | 1 | saveItemFromForm |
| 4629–4835 | 详情 / 笔记 / 搜索 / 项目 | lib/app-content.js | 9 | openDetail, openNote, saveNote, doSearch, selectedColor, renderProjectsSheet, addProject, deleteProject, applyProjectRemovalToItems |
| 4836–5133 | 原生状态漏斗 / 两套三态台账 / 送达证据落盘 | lib/app-native.js | 10 | alertItem, dismissedAlerts, setNativeReminderStatus, refreshNativeScheduleBasis, sameIdSet, indexItemsById, applyDeadlineEvents, applyReminderEvents, reminderKeyInTriggerRange, markDeadlineDelivered |
| 5134–5566 | 原生对账调度 / 闹钟动作路由 | lib/app-native.js | 22 | nativeSyncInFlight, nativeSyncPending, nativeSyncVersion, nativeSyncMetrics, bumpNativeSyncVersion, syncNativeRemindersNow, ensureNativeReminders, queueNativeReminderSync, handleNativeNotificationAction, recentAlarmActions, ALARM_ACTION_DEDUP_MS, ALARM_EVENT_LOG_LIMIT, alarmEventClock, alarmEventSeen, rememberAlarmEvent, clonePayload, withDraftState, publishActionDraft, inflightAlarmActions, handleAlarmAction, performAlarmAction, applyAlarmAction |
| 5567–6202 | 平台桥获取 / 通知实验室 / 系统设置诊断 | lib/app-platform.js + lib/app-diagnostics.js | 18 | systemBridge, isNativeAndroidRuntime, waitForNativeBridge, appSettingsPlugin, diagnoseSystemBridge, setPill, labLog, describeAlarmDelivery, renderBackgroundVerdict, refreshNotifyLab, refreshAlarmTrace, labTraceTest, labShowNow, labScheduleAlarm, labCancelAlarms, labRequestNotify, openBackgroundGuide, openSystemSetting |
| 6203–6379 | 自启动引导 + 实验室绑定 | lib/app-diagnostics.js + lib/app-setup.js | 3 | autoStartLanding, openAutoStartHonest, bindNotifyLab |
| 6380–6540 | 即将到来行 / 送达证据读取 | lib/app-views.js + lib/app-native.js | 10 | pad2, renderUpcomingRow, deliveryEvidenceState, deliveryEvidenceInFlight, deliveryEvidenceReadable, readDeliveryEvidence, mergeEvidenceInto, applyNativeDeliveryEvidence, applyReminderDelivered, detailReminderStatusRow |
| 6541–7018 | 首次引导 / 自检 run / 用户反馈 / 设置步骤 | lib/app-setup.js | 17 | initializeNativeReminders, maybePromptAndroidNotify, noteFirstRemindSaved, renderSetupEntry, openSetupSheet, SETUP_TEST_ID, SETUP_TEST_TITLE, currentTestRun, deliveryBelongsToRun, startSetupTestRun, stopSetupTestRun, testFeedbackButtonsHtml, setupEvidenceHtml, setupStepsContext, renderSetupSheetBody, updateSetupEntry, runSetupStep |
| 7019–7165 | Web 弹条与 tick | lib/app-alerts.js | 8 | shouldSkipAlert, showSystemNotification, alertAutoHideTimer, showAlert, hideAlert, dismissAlert, applyAlertDismissal, tick |
| 7166–7504 | 备份导出 / 导入 / 演示预览 / 示例数据 | lib/app-backup.js | 15 | exportInProgress, exportOperationId, pendingNativeExport, EXPORT_RESULT_GRACE_MS, buildLegacyBackupPayload, setExportBusy, clearPendingNativeExport, noteExportAppVisibility, isShareCancellation, savedBackupMessage, exportData, importDataFile, demoPreviewRows, openDemoPreview, seed |
| 7505–8047 | bind()：全部事件绑定逐功能拆分 | 各模块 bindX() + app-core.js 装配 | 2 | applyShareParams, bind |
| 8048–8140 | PWA 注册与安装提示 | lib/app-platform.js | 3 | deferredInstallPrompt, registerPwa, bindInstall |
| 8141–8272 | 活动闹钟面板 / 网络 / query 动作 | lib/app-alerts.js + lib/app-platform.js | 9 | committedAlarmItems, deliveryHandledByCommittedItem, completeActiveAlarm, activeAlarmRefreshBusy, activeAlarmPanelSignature, refreshActiveAlarmPanel, activeAlarmPollTimer, bindNetwork, handleQueryActions |
| 8273–8387 | init / startApp：依赖验证 + 唯一启动 | app-core.js | 3 | init, readyPromise, startApp |
| 8388–8558 | wrapUserOp 装配 + __ATTENTION_INBOX__ 兼容入口 | app-core.js + lib/app-test-api.js | 1 | itemCommand |

区间覆盖检查：**365 / 365 个顶层符号全部落入区间**，无遗漏。
