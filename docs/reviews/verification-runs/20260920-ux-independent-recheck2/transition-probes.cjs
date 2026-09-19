// Read-only VM probes: expose sandbox in the test harness in memory only.
const fs=require('fs'),path=require('path'),Module=require('module');
const root=path.resolve(__dirname,'../../../..'), filename=path.join(root,'test-regressions.js');
let src=fs.readFileSync(filename,'utf8').split('async function run()')[0];
src=src.replace('return {\n    app,','return {\n    sandbox,\n    app,');
const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(root);
m._compile(src+'\nmodule.exports={createApp,flush};',filename);
const {createApp,flush}=m.exports,E=require(path.join(root,'lib/delivery-evidence.js'));
const out=[];
async function fresh(){const h=createApp();await h.boot();return h;}

(async()=>{
 {const h=await fresh(),a=h.app,now=Date.now(),oldBase=now-31*60000,oldAt=now-60000,newBase=now-2*60000;
 const x=a.makeItem({title:'received history',status:'due',triggerAt:oldBase});x.triggerAt=oldBase;a.state.items=[x];
 a.applyReminderEvents([{itemId:x.id,key:'1@'+oldAt,at:oldAt}],oldBase,[]);
 const before=JSON.parse(JSON.stringify(x.reminderEvents));
 E.mergeEvidence([x],E.normalizeEvidence([{itemId:x.id,reminderKey:'1@'+oldAt,itemRev:String(x.rev),token:'received-old',carrier:'alarm',receivedAt:oldAt}]),now);
 const afterReceive=JSON.parse(JSON.stringify(x.reminderEvents));
 // Edit to an earlier clock time through the production save path.
 a.state.ui.editItemId=x.id;h.setField('#capText',x.title);
 const d=new Date(newBase);const z=n=>String(n).padStart(2,'0');
 h.setField('#capTrigger',`${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`);
 a.markTriggerPicked(true);a.saveItemFromForm();await flush(8);await a.saveAsync();
 const current=a.state.items.find(i=>i.id===x.id);a.applyReminderEvents([{itemId:x.id,key:'0@'+current.triggerAt,at:current.triggerAt}],now,[]);
 const status=E.evidenceStatusFor(current,{now,evidenceReadable:true,observable:true});
 out.push({id:'Y1-receipt-drops-round',pass:afterReceive['1@'+oldAt].roundBase===oldBase&&status.state!=='delivered',before,afterReceive,newTrigger:current.triggerAt,status});
 }
 {const h=await fresh(),a=h.app,now=Date.now(),oldBase=now-60000,oldAt=now+29*60000,newBase=now+5*60000;
 const x=a.makeItem({title:'upgrade history',status:'due',triggerAt:oldBase});x.triggerAt=oldBase;
 x.reminderEvents={['1@'+oldAt]:{at:oldAt,state:'scheduled'}};a.state.items=[x];
 a.snoozeItem(x.id,newBase,'elapsed');a.applyReminderEvents([{itemId:x.id,key:'0@'+newBase,at:newBase}],now,[{itemId:x.id,key:'1@'+oldAt,at:oldAt}]);
 const merged=E.mergeEvidence([x],E.normalizeEvidence([{itemId:x.id,reminderKey:'1@'+oldAt,itemRev:'1',token:'legacy',carrier:'alarm',receivedAt:oldAt}]),oldAt+1000);
 const status=E.evidenceStatusFor(x,{now:oldAt+1000,evidenceReadable:true,observable:true});
 out.push({id:'Y2-upgrade-unknown-round',pass:merged.applied===0&&status.state!=='delivered',merged,status});
 }
 {const h=await fresh(),a=h.app,text='明天下午3点提醒我取快递';a.openCapture();h.disk.hold=true;
 h.setField('#capText',text);const initialSession=a.formSession;a.saveItemFromForm();await flush(2);
 a.openCapture();h.setField('#capText',text);const newSession=a.formSession;
 h.disk.hold=false;h.releaseCommits();await flush(8);await a.saveAsync();
 out.push({id:'Y3-new-session-same-text',pass:h.fieldOf('#capText')===text,initialSession,newSession,input:h.fieldOf('#capText'),persistedCount:h.persisted().items.length});
 }
 fs.writeFileSync(path.join(__dirname,'transition-results.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));process.exit(out.every(x=>x.pass)?0:1);
})().catch(e=>{console.error(e);process.exit(2)});
