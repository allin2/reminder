import pathlib,hashlib,zipfile,json,subprocess,xml.etree.ElementTree as ET
root=pathlib.Path(__file__).resolve().parents[4]
out=pathlib.Path(__file__).resolve().parent
files=['index.html','app-core.js','sw.js']+[str(p.relative_to(root)) for p in sorted((root/'lib').glob('*.js'))]
sha=lambda b:hashlib.sha256(b).hexdigest()
result={'HEAD':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'origin_main':subprocess.check_output(['git','rev-parse','origin/main'],cwd=root,text=True).strip(),'sources':{f:sha((root/f).read_bytes()) for f in files},'candidates':[]}
for apk in sorted((root/'releases/candidates/20260919T235500-ux-rework').glob('*.apk')):
 with zipfile.ZipFile(apk) as z:
  checks={f:sha(z.read('assets/public/'+f))==result['sources'][f] for f in files}
 result['candidates'].append({'path':str(apk.relative_to(root)),'sha256':sha(apk.read_bytes()),'web_assets_identical':checks})
result['android_suites']=[]
for p in sorted((root/'android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml')):
 e=ET.parse(p).getroot();result['android_suites'].append({k:e.attrib.get(k) for k in ['name','tests','failures','errors','skipped']})
(out/'artifacts.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
