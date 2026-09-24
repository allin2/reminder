const fs=require('fs'),path=require('path'),Module=require('module');
const root=process.argv[2],mod=new Module(path.join(root,'review-harness.cjs'));
mod.filename=path.join(root,'review-harness.cjs');mod.paths=Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(path.join(root,'test-regressions.js'),'utf8').split('async function run()')[0]+'\nmodule.exports={createApp,restartApp,flush};',mod.filename);
const {createApp,restartApp,flush}=mod.exports;
function localInputOf(t){const d=new Date(t),p=x=>String(x).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}
(async()=>{
 const results=[];
 for(const mode of ['title','time-words','metadata','snooze','clear','reschedule','ack-title']){
  const h=createApp(),a=await h.boot();a.state.settings.dnd=false;
  const original=Math.floor((Date.now()+86400000)/60000)*60000;
  const it=a.makeItem({id:'review-'+mode,title:'original',priority:'normal',status:'waiting',triggerAt:original});
  a.state.items=[it];await a.saveAsync();await flush(10);
  if(mode==='snooze') {await a.snoozeItem(it.id,Date.now()+7200000,'elapsed');await a.saveAsync();await flush(10);}
  if(mode==='ack-title'){await a.ackItem(it.id);await a.saveAsync();await flush(10);}
  const before=JSON.parse(JSON.stringify(a.state.items[0]));a.openEditItem(it.id);
  h.setField('#capText',mode==='time-words'?'后天18点新的标题':'changed title');
  if(mode==='metadata'){h.setField('#capNote','new note');h.setField('#capTags','one two');}
  if(mode==='clear'||mode==='reschedule'){h.setField('#capTrigger',mode==='clear'?'':localInputOf(original+3600000));a.markTriggerPicked(true);}
  a.saveItemFromForm();await flush(25);
  const memory=JSON.parse(JSON.stringify(a.state.items[0]));
  const restarted=await restartApp(h.disk),disk=restarted.app.state.items[0];
  const expected=mode==='clear'?null:mode==='reschedule'?original+3600000:before.triggerAt;
  let pass=memory.triggerAt===expected&&disk.triggerAt===expected;
  if(mode==='snooze')for(const k of ['scheduleBasis','snoozedAt','snoozeDelayMs','status'])pass=pass&&memory[k]===before[k]&&disk[k]===before[k];
  if(mode==='ack-title')pass=pass&&disk.status==='acknowledged';
  results.push({mode,pass,before,memory,disk});
 }
 console.log(JSON.stringify(results,null,2));if(results.some(x=>!x.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
