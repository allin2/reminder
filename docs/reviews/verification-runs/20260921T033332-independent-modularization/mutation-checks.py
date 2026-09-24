import json,pathlib,re,shutil,subprocess
run=pathlib.Path(__file__).resolve().parent; work=run/'mutation-copy'
shutil.copytree(run/'snapshot',work,dirs_exist_ok=True)
node='/Users/qlyf/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'
results=[]
def execute(name,args):
 r=subprocess.run([node,*args],cwd=work,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=90)
 text=r.stdout.decode(errors='replace');(run/(name+'.log')).write_text(text+'\nEXIT_CODE='+str(r.returncode)+'\n')
 return {'exit':r.returncode,'failures':re.findall(r'^\s*✗.*$',text,re.M)[:12],'tail':text.splitlines()[-4:]}
cases=[
 ('copy-ui-algorithm','app-core.js',lambda s:s.replace('  function uid() {','  function uid() {\n    $("#backdrop").classList.add("show");',1),['scripts/verification/parse-single-source.js']),
 ('feedback-value-binding','app-core.js',lambda s:s.replace('isFeedbackSuppressed: () => suppressUserFeedback','isFeedbackSuppressed: suppressUserFeedback',1),['scripts/verification/parse-single-source.js']),
 ('toast-duration','lib/app-ui.js',lambda s:s.replace('hasAction ? 5000 : 2400','hasAction ? 5000 : 2500',1),['scripts/verification/ui-dom-parity.js']),
 ('close-sheet-backdrop','lib/app-ui.js',lambda s:s.replace('if (!$$(".sheet.open").length) $("#backdrop").classList.remove("show");','$("#backdrop").classList.remove("show");',1),['scripts/verification/ui-dom-parity.js']),
 ('missing-gate-declaration','app-core.js',lambda s:re.sub(r'^\s*\["AppUi.createUi"[^\n]+\n','\n',s,count=1,flags=re.M),['test-boot-combination.js']),
 ('missing-index-ui','index.html',lambda s:s.replace('<script src="lib/app-ui.js"></script>','',1),['test-boot-combination.js']),
 ('missing-precache-ui','sw.js',lambda s:s.replace('  "./lib/app-ui.js",','',1),['-e',"const p=require('./scripts/verification/production-scripts');const x=p.precacheProblems('.');console.log(x);process.exit(x.length?1:0)"]),
 ('missing-smoke-ui','test-smoke.js',lambda s:re.sub(r'^.*vm.runInContext\([^\n]+filename: "lib/app-ui.js"[^\n]*\n','',s,count=1,flags=re.M),['test-smoke.js']),
 ('missing-regression-ui','test-regressions.js',lambda s:re.sub(r'^\s*"lib/app-ui.js",[^\n]*\n','',s,count=1,flags=re.M),['test-regressions.js'])
]
for name,file,mut,args in cases:
 p=work/file;old=p.read_bytes();new=mut(old.decode()).encode()
 if old==new:raise RuntimeError('mutation did not apply: '+name)
 try:
  p.write_bytes(new);bad=execute('mutation-'+name,args)
 finally:p.write_bytes(old)
 good=execute('restored-'+name,args)
 results.append({'name':name,'detected':bad['exit']!=0,'restored':good['exit']==0,'bad':bad,'good':good})
 (run/'mutation-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
 print(name,'detected',bad['exit'],'restored',good['exit'],flush=True)
