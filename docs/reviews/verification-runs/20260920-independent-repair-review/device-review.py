import importlib.util,json,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('device',ROOT.parent/'20260920T124045-bg-diag/device.py')
d=importlib.util.module_from_spec(s);s.loader.exec_module(d)
def save(name,value):
    (ROOT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2))
results=d.ev('''(async()=>{
 const A=__ATTENTION_INBOX__;await A.ready();A.closeAllSheets();
 const out=[];const wait=()=>new Promise(r=>setTimeout(r,1100));
 const field=(id,value)=>{const el=document.querySelector(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
 const local=t=>{const x=new Date(t),p=n=>String(n).padStart(2,'0');return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;};
 for(const mode of ['title','time-words','metadata','snooze','clear','reschedule','ack-title']){
  const t=Math.floor((Date.now()+86400000)/60000)*60000;
  const title='独立复验原题-'+mode+'-'+Date.now();
  A.openCapture();field('#capText',title);field('#capTrigger',local(t));document.querySelector('#btnSaveItem').click();await wait();
  const it=A.state.items.find(x=>x.title===title);if(!it)throw new Error('production creation missing: '+title);
  if(mode==='snooze'){await A.snoozeItem(it.id,Date.now()+7200000,'elapsed');await wait();}
  if(mode==='ack-title'){await A.ackItem(it.id);await wait();}
  const before=JSON.parse(JSON.stringify(A.state.items.find(x=>x.id===it.id)));
  A.openEditItem(it.id);field('#capText',mode==='time-words'?'后天18点修改的标题':'独立复验修改后');
  if(mode==='metadata'){field('#capNote','复验备注');field('#capTags','复验 标签');}
  if(mode==='clear'||mode==='reschedule')field('#capTrigger',mode==='clear'?'':local(t+3600000));
  document.querySelector('#btnSaveItem').click();await wait();
  const after=JSON.parse(JSON.stringify(A.state.items.find(x=>x.id===it.id)));
  out.push({mode,id:it.id,before,after,expected:mode==='clear'?null:mode==='reschedule'?t+3600000:before.triggerAt});
 }
 return out;
})()''')
save('device-edits.json',results)
d.ev('setTimeout(()=>location.reload(),100);true');time.sleep(3)
ids=[x['id'] for x in results]
reloaded=d.ev('(async()=>{await __ATTENTION_INBOX__.ready();return __ATTENTION_INBOX__.state.items.filter(x=>'+json.dumps(ids)+'.includes(x.id));})()')
save('device-reloaded.json',reloaded)
checks=[]
for x in results:
    item=next(i for i in reloaded if i['id']==x['id'])
    ok=x['after']['triggerAt']==item['triggerAt']==x['expected']
    if x['mode']=='snooze':
        ok=ok and all(x['before'].get(k)==x['after'].get(k)==item.get(k) for k in ['scheduleBasis','snoozedAt','snoozeDelayMs','status'])
    if x['mode']=='ack-title':ok=ok and item['status']=='acknowledged'
    if x['mode']=='metadata':ok=ok and item['note']=='复验备注' and set(item['tags'])=={'复验','标签'}
    checks.append({'mode':x['mode'],'pass':ok,'id':x['id']})
save('device-checks.json',checks)
cleanup=d.ev('(async()=>{const A=__ATTENTION_INBOX__;for(const id of '+json.dumps(ids)+')await A.completeItem(id);await A.saveAsync();await new Promise(r=>setTimeout(r,2000));return A.state.items.filter(x=>'+json.dumps(ids)+'.includes(x.id));})()')
save('device-cleanup.json',cleanup)
print(json.dumps(checks,ensure_ascii=False))
