from device import *
out={}
def run(k,js):
 v=ev('(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();'+js+'})()');out[k]=v;save('interaction.json',out);print(k,json.dumps(v,ensure_ascii=False),flush=True);return v
run('capture-double-submit',"document.querySelector('#btnSaveItem').click();document.querySelector('#btnSaveItem').click();await new Promise(r=>setTimeout(r,1800));return A.state.items.map(x=>({id:x.id,title:x.title,triggerAt:x.triggerAt,status:x.status}));")
run('demo-read-only',"const n=A.state.items.length;A.openDemoPreview();const after=A.state.items.length;A.closeAllSheets();return {before:n,after,pass:n===after};")
run('project',"document.querySelector('[data-tab=me]').click();document.querySelector('#btnProjects').click();document.querySelector('#projName').value='实机验证项目';document.querySelector('#btnAddProject').click();await A.saveAsync();A.closeAllSheets();return A.state.projects.map(x=>({id:x.id,name:x.name}));")
run('note',"document.querySelector('[data-tab=notes]').click();document.querySelector('#fab').click();document.querySelector('#noteTitle').value='实机验证笔记';document.querySelector('#noteBody').value='# 中文记录\\n验证 **Markdown** 与持久化';document.querySelector('#noteProject').value=A.state.projects[0].id;document.querySelector('#btnSaveNote').click();await A.saveAsync();return A.state.notes.map(x=>({id:x.id,title:x.title,projectId:x.projectId}));")
run('edit',"const it=A.state.items[0];A.openEditItem(it.id);document.querySelector('#capText').value='实机验证已编辑';document.querySelector('#capNote').value='保留中文上下文';document.querySelector('#btnSaveItem').click();await new Promise(r=>setTimeout(r,1500));return A.state.items[0];")
run('ack',"const it=A.state.items[0];await A.ackItem(it.id);await A.saveAsync();return {status:it.status,pass:it.status==='acknowledged'};")
run('snooze',"const it=A.state.items[0];await A.snoozeItem(it.id,Date.now()+7200000);await A.saveAsync();return {status:it.status,basis:it.scheduleBasis,delay:it.snoozeDelayMs,pass:it.status==='snoozed'&&it.scheduleBasis==='elapsed'};")
run('complete-terminal',"const id=A.state.items[0].id;await A.completeItem(id);await A.saveAsync();const rejected=[await A.ackItem(id),await A.snoozeItem(id,Date.now()+3600000)];return {status:A.state.items[0].status,rejected,pass:A.state.items[0].status==='archived'&&rejected.every(x=>x===false)};")
run('restart-before',"return {items:A.state.items,notes:A.state.notes,projects:A.state.projects};")
ev('location.reload();true');time.sleep(3)
run('restart-after',"return {items:A.state.items,notes:A.state.notes,projects:A.state.projects};")
print('DONE',flush=True)
