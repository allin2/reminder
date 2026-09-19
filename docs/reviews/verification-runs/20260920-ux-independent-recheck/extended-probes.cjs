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
 { const h=await fresh(),a=h.app,now=Date.now(),oldBase=now-60000,oldAt=oldBase+30*60000,newAt=now+5*60000;
   const x=a.makeItem({title:'old-round receipt',status:'due',triggerAt:oldBase});x.triggerAt=oldBase;a.state.items=[x];
   a.applyReminderEvents([{itemId:x.id,key:'0@'+oldBase,at:oldBase},{itemId:x.id,key:'1@'+oldAt,at:oldAt}],oldBase-1000,[]);
   const oldRev=x.rev;a.snoozeItem(x.id,newAt,'elapsed');
   a.applyReminderEvents([{itemId:x.id,key:'0@'+newAt,at:newAt}],now,[{itemId:x.id,key:'1@'+oldAt,at:oldAt}]);
   const before=JSON.parse(JSON.stringify(x.reminderEvents));
   const merged=E.mergeEvidence([x],E.normalizeEvidence([{itemId:x.id,reminderKey:'1@'+oldAt,itemRev:String(oldRev),token:'old-round',carrier:'alarm',receivedAt:oldAt}]),oldAt+1000);
   const status=E.evidenceStatusFor(x,{now:oldAt+1000,evidenceReadable:true,observable:true});
   out.push({id:'X1-retained-old-round',expected:'no old receipt applied; current remains unconfirmed',pass:merged.applied===0&&status.state!=='delivered',oldRev,currentRev:x.rev,before,merged,status});
 }
 { const h=await fresh(),a=h.app;let resolve;
   h.sandbox.fetch=()=>new Promise(r=>resolve=r);
   a.state.settings.ai={enabled:true,autoOnSave:true,apiKey:'fixture-only',baseUrl:'https://fixture.invalid',model:'fixture'};
   h.setField('#capText','明天下午3点提醒我取快递');a.saveItemFromForm();
   h.setField('#capText','第二条尚未保存的草稿');h.setField('#capNote','第二条的备注');
   resolve({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({title:'取快递',trigger_at:new Date(Date.now()+86400000).toISOString(),note:'',tags:[],priority:'normal'})}}]})});
   await flush(12);await a.saveAsync();
   const input=h.fieldOf('#capText'),items=a.state.items.map(x=>({title:x.title,note:x.note}));
   out.push({id:'X2-ai-late-result',expected:'new draft preserved; first saved item must not contain second draft note',pass:input==='第二条尚未保存的草稿'&&!items.some(x=>x.note==='第二条的备注'),input,items});
 }
 {const h=await fresh(),a=h.app;h.setField('#capText','一些没有时间的记录');a.saveItemFromForm();await flush(8);await a.saveAsync();
  out.push({id:'X3-no-time-undo',pass:!h.hiddenOf('#toastAction2')&&h.textOf('#toastAction2')==='撤销',text:h.textOf('#toastText'),action:h.textOf('#toastAction2'),hidden:h.hiddenOf('#toastAction2')});}
 {const h=await fresh(),a=h.app,now=Date.now();a.state.settings.testRun={id:90003,startedAt:now-1000};
  global.Capacitor={Plugins:{SystemBridge:{activeAlarmDeliveries:async()=>{throw Error('bridge read failed')},stopAlarmDelivery:async()=>({stopped:false}),cancelAlarm:async()=>({ok:true})}}};
  const stopped=await a.stopSetupTestRun();const text=h.textOf('#toastText');out.push({id:'X4-stop-read-error',expected:'cannot confirm active ring state, show retry or unknown',pass:!text.includes('没有正在响'),stopped,text,stoppedAt:a.state.settings.testRun.stoppedAt});}
 fs.writeFileSync(path.join(__dirname,'extended-results.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));process.exit(out.every(x=>x.pass)?0:1);
})().catch(e=>{console.error(e);process.exit(2)});
