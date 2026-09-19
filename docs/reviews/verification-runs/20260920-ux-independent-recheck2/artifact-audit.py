import pathlib,json,hashlib,zipfile,xml.etree.ElementTree as ET
root=pathlib.Path(__file__).resolve().parents[4];out=pathlib.Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
prev=json.loads((root/'docs/reviews/verification-runs/20260919T235500-ux-rework/identity.json').read_text())
r={}
for field in ['sourceSha256','javaSha256']:
 r[field]={p:sha((root/p).read_bytes()) for p in prev[field]}
 r[field+'Changed']=[p for p,h in r[field].items() if h!=prev[field][p]]
r['candidates']=[]
for kind in ['debug','release']:
 old=root/f'releases/candidates/20260919T235500-ux-rework/attention-inbox-{kind}-ux-rework.apk'
 new=root/f'releases/candidates/20260920T003000-ux-rework2/attention-inbox-{kind}-ux-rework2.apk'
 with zipfile.ZipFile(old) as a,zipfile.ZipFile(new) as b:
  an=set(a.namelist());bn=set(b.namelist());diff=[n for n in sorted(an&bn) if sha(a.read(n))!=sha(b.read(n))]
  files=['index.html','app-core.js','sw.js']+[str(p.relative_to(root)) for p in sorted((root/'lib').glob('*.js'))]
  r['candidates'].append({'kind':kind,'sha256':sha(new.read_bytes()),'entryCount':len(bn),'added':sorted(bn-an),'removed':sorted(an-bn),'changed':diff,'all13WebAssetsEqual':all(b.read('assets/public/'+p)==(root/p).read_bytes() for p in files),'dexEqual':all(a.read(n)==b.read(n) for n in an&bn if n.endswith('.dex'))})
r['androidSuites']=[ET.parse(p).getroot().attrib for p in (root/'android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml')]
r['legacyDebugSha256']=sha((root/'releases/安心收件箱-debug.apk').read_bytes())
(out/'artifact-results.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({k:v for k,v in r.items() if k not in ['sourceSha256','javaSha256','androidSuites']},indent=2))
