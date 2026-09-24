'use strict';
const fs=require('fs'); const path=require('path');
const ROOT='/Users/qlyf/Developer/reminder';
const h=require(path.join(ROOT,'test-boot-combination.js'));
const source=fs.readFileSync(path.join(ROOT,'lib/app-model.js'),'utf8');
const members=['SCHEMA','PROJECT_COLORS','createInitialState','normalizeItem','makeItem','resolveDeliveryMode','bumpRev','isTerminal','hasKnownRev'];
let passed=0, failed=0;
function check(name, cond, detail){ if(cond){passed++; console.log('PASS '+name);} else {failed++; console.log('FAIL '+name+' '+JSON.stringify(detail));} }
function zeroSideEffects(b){ return b.disk.puts===0 && b.env.calls.scheduleAlarm.length===0 && b.intervals.indexOf(15000)<0 && b.intervals.indexOf(2000)<0; }
function temp(name, suffix){ const f=path.join(__dirname,name+'.js'); fs.writeFileSync(f,source+'\n'+suffix+'\n'); return f; }
function memberObject(missing){ return members.filter(x=>x!==missing).map(x=> x==='SCHEMA'? 'SCHEMA:5' : x==='PROJECT_COLORS'? 'PROJECT_COLORS:[]' : JSON.stringify(x)+':function(){}').join(','); }
(async()=>{
 const scripts=h.prod.readIndexScripts(ROOT);
 const missing=await h.bootCombination({scripts:scripts.filter(x=>x!=='lib/app-model.js')});
 check('missing script fails closed', missing.ready===false && missing.app.startupFailure().some(p=>p.path==='AppModel') && zeroSideEffects(missing), {ready:missing.ready,p:missing.app.startupFailure(),puts:missing.disk.puts,ints:missing.intervals});
 const empty=await h.bootCombination({overrides:{'lib/app-model.js':temp('empty','AttentionLib.AppModel={};')}});
 check('empty namespace fails closed', empty.ready===false && empty.app.startupFailure().some(p=>p.path==='AppModel.createAppModel') && zeroSideEffects(empty), {ready:empty.ready,p:empty.app.startupFailure()});
 const throwing=await h.bootCombination({overrides:{'lib/app-model.js':temp('throwing',"AttentionLib.AppModel={createAppModel:function(){throw new Error('model-boom')}};")}});
 check('factory throw fails closed', throwing.ready===false && throwing.app.startupFailure().some(p=>p.path==='AppModel.createAppModel()') && zeroSideEffects(throwing), {ready:throwing.ready,p:throwing.app.startupFailure()});
 for(const m of members){
   const bad=await h.bootCombination({overrides:{'lib/app-model.js':temp('missing-'+m,`AttentionLib.AppModel={createAppModel:function(){return {${memberObject(m)}}}};`)}});
   check('missing member '+m, bad.ready===false && bad.app.startupFailure().some(p=>p.path==='AppModel.'+m) && zeroSideEffects(bad), {ready:bad.ready,p:bad.app.startupFailure(),puts:bad.disk.puts,ints:bad.intervals});
 }
 const good=await h.bootCombination({});
 check('healthy production instance',good.ready===true && good.app.state.schema===5 && good.app.state.items.length===0 && Array.isArray(good.app.state.ui.reviewQueue),{ready:good.ready,state:good.app.state});
 console.log(`RESULT pass=${passed} fail=${failed}`); process.exit(failed?1:0);
})().catch(e=>{console.error(e.stack||e);process.exit(2)});
