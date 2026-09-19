from pathlib import Path
import hashlib,json,zipfile,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[4];out=Path(__file__).resolve().parent;src=Path('/Users/qlyf/Developer/reminder')
sha=lambda b:hashlib.sha256(b).hexdigest()
files=['app-core.js','lib/delivery-evidence.js','test-unit.js','test-regressions.js']
r={'worktree':str(root),'files':{f:{'source':sha((src/f).read_bytes()),'reviewed':sha((root/f).read_bytes())} for f in files},'candidates':[]}
final=json.loads((root/'docs/reviews/verification-runs/20260920T011417-ux-y123-fix/final-hashes.json').read_text())
r['matchesReportedFinal']=all(r['files'][f]['reviewed']==final['productAndTestFiles'][f] for f in files)
for kind in ['debug','release']:
 old=src/f'releases/candidates/20260920T003000-ux-rework2/attention-inbox-{kind}-ux-rework2.apk';new=root/f'releases/candidates/20260920T014002-ux-y123-fix/attention-inbox-{kind}-ux-y123-fix.apk'
 with zipfile.ZipFile(old) as a,zipfile.ZipFile(new) as b:
  an=set(a.namelist());bn=set(b.namelist());diff=[n for n in sorted(an&bn) if a.read(n)!=b.read(n)]
  web=['index.html','app-core.js','sw.js']+[str(p.relative_to(root)) for p in sorted((root/'lib').glob('*.js'))]
  r['candidates'].append({'kind':kind,'sha256':sha(new.read_bytes()),'entryCount':len(bn),'added':sorted(bn-an),'removed':sorted(an-bn),'changed':diff,'all13WebAssetsEqual':all(b.read('assets/public/'+f)==(root/f).read_bytes() for f in web),'dexEqual':all(a.read(n)==b.read(n) for n in an&bn if n.endswith('.dex'))})
r['androidSuites']=[{k:v for k,v in ET.parse(p).getroot().attrib.items() if k in ['name','tests','failures','errors','skipped']} for p in (root/'android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml')]
(out/'artifact-results.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
