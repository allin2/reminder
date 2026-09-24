#!/usr/bin/env python3
from pathlib import Path
root=Path(__file__).resolve().parents[2]; core=root/"app-core.js"; views=root/"lib/app-views.js"
s=core.read_text()
names=["projectByIdDom","priorityRankDom","actionButtonDom","renderItemCardDom","setBadgeDom","renderHomeDom","renderCalendarDom","renderArchiveListDom","renderFutureDom","renderNotesDom","renderStatsDom","syncUserModeDom","renderMeDom","renderPwaStatusDom","renderDom","refreshProjectSelectsDom","openDetailDom"]
def block(src,start):
 i=src.index("{",start); depth=0; quote=None; esc=False
 for j in range(i,len(src)):
  c=src[j]
  if quote:
   if esc: esc=False
   elif c=="\\": esc=True
   elif c==quote: quote=None
  elif c in ("'",'"',chr(96)): quote=c
  elif c=="{": depth+=1
  elif c=="}":
   depth-=1
   if not depth:return src[start:j+1]
 raise ValueError("unclosed")
chunks=[]
for n in names:
 start=s.index("  function "+n+"("); b=block(s,start); chunks.append(b.replace("function "+n+"(", "function "+n[:-3]+"(")); s=s[:start]+s[start+len(b):]
for n in ["homeCardSignatureRow","homeCardSignature"]:
 start=s.index("  function "+n+"("); b=block(s,start); chunks.append(b); s=s[:start]+s[start+len(b):]
start=s.index("  /** O6：首页卡片容器最后一次渲染用的签名")
end=s.index("\n\n",start); cache=s[start:end].replace("  ","",1); s=s[:start]+s[end:]
s=s.replace("  function homeRenderStatsSnapshot() { return appViews.homeRenderStats(); }\n  function resetHomeRenderStats() { return appViews.resetHomeRenderStats(); }\n","")
s=s.replace("homeRenderStats: () => Object.assign({}, homeRenderStatsSnapshot()),\n      resetHomeRenderStats,","homeRenderStats: () => Object.assign({}, appViews.homeRenderStats()),\n      resetHomeRenderStats: () => appViews.resetHomeRenderStats(),")
core.write_text(s)
prefix="""(function(root,factory){var api=factory();root.AttentionLib=root.AttentionLib||{};root.AttentionLib.AppViews=api;if(typeof module!==\"undefined\"&&module.exports)module.exports=api;})(typeof globalThis!==\"undefined\"?globalThis:this,function(){\"use strict\";
function createAppViews(deps){deps=deps||{};var need=['query','queryAll','getState','openSheet','openCapture','openDemoPreview','isAttentionDue','needsReviewItems','renderReviewEntry','inReviewHighlight','renderAiSub','ensureReviewSettings','detailReminderStatusRow','isTerminal','updateAppBadge','fmtTime','fmtDate','relDue','repeatLabel','dayLabel','escapeHtml','escapeAttr','safeExternalHref','sameDay','getNativeReminderStatus','getSwReg','isNativeAndroidRuntime'];var missing=need.filter(function(k){return typeof deps[k]!==\"function\";});if(missing.length)throw new Error(\"AppViews missing dependencies: \"+missing.join(','));var $=deps.query,$$=deps.queryAll,openSheet=deps.openSheet,openCapture=deps.openCapture,openDemoPreview=deps.openDemoPreview;var state=new Proxy({}, {get:function(_,k){return deps.getState()[k];},set:function(_,k,v){deps.getState()[k]=v;return true;}});var isAttentionDue=deps.isAttentionDue,needsReviewItems=deps.needsReviewItems,renderReviewEntry=deps.renderReviewEntry,inReviewHighlight=deps.inReviewHighlight,renderAiSub=deps.renderAiSub,ensureReviewSettings=deps.ensureReviewSettings,detailReminderStatusRow=deps.detailReminderStatusRow,isTerminal=deps.isTerminal,updateAppBadge=deps.updateAppBadge,fmtTime=deps.fmtTime,fmtDate=deps.fmtDate,relDue=deps.relDue,repeatLabel=deps.repeatLabel,dayLabel=deps.dayLabel,escapeHtml=deps.escapeHtml,escapeAttr=deps.escapeAttr,safeExternalHref=deps.safeExternalHref,sameDay=deps.sameDay;var nativeReminderStatus=deps.getNativeReminderStatus(),swReg=deps.getSwReg(),isNativeAndroidRuntime=deps.isNativeAndroidRuntime;
"""
suffix="""return {priorityRank:priorityRank,actionButton:actionButton,renderItemCard:renderItemCard,openDetail:openDetail,setBadge:setBadge,renderHome:renderHome,renderCalendar:renderCalendar,renderArchiveList:renderArchiveList,renderFuture:renderFuture,renderNotes:renderNotes,renderStats:renderStats,syncUserMode:syncUserMode,renderMe:renderMe,renderPwaStatus:renderPwaStatus,render:render,refreshProjectSelects:refreshProjectSelects,projectById:projectById,homeRenderStats:function(){return homeRenderStats;},resetHomeRenderStats:function(){homeViewSignature=null;homeRenderStats.builds=0;homeRenderStats.skipped=0;homeRenderStats.dueCards=0;homeRenderStats.activeCards=0;}};}
return {createAppViews:createAppViews};});
"""
views.write_text(prefix+"\n".join(chunks)+suffix)
