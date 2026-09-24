const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'snapshot');
const h=require(path.join(root,'test-boot-combination.js'));
const prod=require(path.join(root,'scripts/verification/production-scripts.js'));
const out=[];
const files=prod.readIndexScripts(root);
function summary(b){return {ready:b.ready,errors:b.loadErrors,consoleErrors:b.consoleErrors,dependencyProblems:b.app?.startupFailure(),puts:b.disk.puts,intervals:b.intervals,panels:b.insertions, nativeLoaded:!!b.sandbox.AttentionNativeReminders,calls:b.env.calls};}
async function test(name,options,action){const b=await h.bootCombination(options);const r={name,...summary(b)};if(action){try{r.action=await action(b)}catch(e){r.actionError=e.message}}out.push(r);}
async function main(){
 const saveReminder=async b=>{
  b.app.state.settings.dnd=false;
  b.app.state.settings.notify=true;
  const it=b.app.makeItem({title:'independent isolated reminder',status:'waiting',triggerAt:Date.now()+1800000,priority:'critical'});
  b.app.state.items.push(it);await b.app.saveAsync();await h.wait(350);
  return {saved:b.disk.idbValue.items.some(x=>x.id===it.id),schedule:b.env.calls.schedule.length,scheduleAlarm:b.env.calls.scheduleAlarm.length,startupFailure:b.app.startupFailure()};
 };
 await test('control-complete-android',{},saveReminder);
 await test('missing-native-script-android',{scripts:files.filter(f=>f!=='lib/native-reminders.js')},saveReminder);
 await test('missing-app-ui-control',{scripts:files.filter(f=>f!=='lib/app-ui.js')});
 const variants=path.join(__dirname,'variants');fs.mkdirSync(variants,{recursive:true});
 for(const [name,file,code] of [
  ['feedback-missing-setupSteps','lib/feedback.js','delete AttentionLib.Feedback.setupSteps;'],
  ['feedback-null','lib/feedback.js','AttentionLib.Feedback=null;'],
  ['evidence-missing-normalizeEvidence','lib/delivery-evidence.js','delete AttentionLib.DeliveryEvidence.normalizeEvidence;'],
  ['app-ui-incomplete-factory','lib/app-ui.js','AttentionLib.AppUi.createUi=()=>({});'],
  ['native-missing-constant','lib/reminder.js','delete AttentionLib.DEADLINE_GRACE_MS;']
 ]){
  const p=path.join(variants,name+'.js');fs.writeFileSync(p,fs.readFileSync(path.join(root,file),'utf8')+'\n'+code+'\n');
  await test(name,{overrides:{[file]:p}},name==='evidence-missing-normalizeEvidence'?async b=>b.app.applyNativeDeliveryEvidence([{itemId:'probe'}]):null);
 }
 // All scripts load successfully in their own order, then recover a missing parser before pressing retry.
 const b=await h.bootCombination({scripts:files.filter(f=>f!=='lib/parse-cn.js')});
 vm.runInContext(fs.readFileSync(path.join(root,'lib/parse-cn.js'),'utf8'),b.sandbox);
 out.push({name:'retry-after-parser-arrives',initialReady:b.ready,dependencyProblemsAfterArrival:b.app.assertRuntimeDependencies(),capturedParseType:typeof b.app.parseChineseTime});
 fs.writeFileSync(path.join(__dirname,'independent-probes.json'),JSON.stringify({coverage:prod.runtimeDependencyCoverage(root),results:out},null,2));
 console.log(out.map(x=>({name:x.name,ready:x.ready,puts:x.puts,errors:x.consoleErrors,action:x.action,actionError:x.actionError,capturedParseType:x.capturedParseType})));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
