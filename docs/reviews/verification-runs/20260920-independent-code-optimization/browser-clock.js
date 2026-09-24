const AuditRealDate=Date;
let auditClockAt=new AuditRealDate(2026,8,20,23,59,0).getTime();
window.Date=class extends AuditRealDate {constructor(...args){super(...(args.length?args:[auditClockAt]))}static now(){return auditClockAt}};
window.__advanceAuditClock=ms=>{auditClockAt+=ms};
window.addEventListener('DOMContentLoaded',async()=>{
 const a=window.__ATTENTION_INBOX__;await a.ready();
 const host=document.getElementById('audit-controls');
 const start=document.createElement('button');start.textContent='加载跨日样本';host.appendChild(start);
 const next=document.createElement('button');next.textContent='推进90秒并刷新';host.appendChild(next);
 const status=document.createElement('pre');status.id='audit-clock-result';host.appendChild(status);
 const read=()=>status.textContent=JSON.stringify({clock:new Date().toISOString(),pills:Array.from(document.querySelectorAll('#homeDue .pill')).map(n=>n.textContent),cards:document.querySelectorAll('#homeDue article').length});
 start.onclick=()=>{a.state.items=[a.makeItem({id:'midnight',title:'跨日验收',status:'due',triggerAt:Date.now()-300000,deadlineAt:Date.now()+120000,lastAlertShownAt:Date.now(),priority:'normal'})];a.state.settings.notify=false;a.state.settings.sound=false;a.state.settings.vibrate=false;a.state.settings.dnd=false;a.state.ui.tab='home';a.renderHome();read()};
 next.onclick=()=>{window.__advanceAuditClock(90000);a.renderHome();read()};
});
