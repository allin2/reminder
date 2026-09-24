import hashlib,json,pathlib,zipfile,sys
root=pathlib.Path('/Users/qlyf/Developer/reminder')
run=pathlib.Path(sys.argv[1]); apk=run/'apk/p3a-app-debug.apk'
source=list(sorted((root/'www').rglob('*')))
source=[p for p in source if p.is_file()]
rows=[]
with zipfile.ZipFile(apk) as z:
 names=set(z.namelist())
 for p in source:
  rel=p.relative_to(root/'www').as_posix(); entry='assets/public/'+rel
  data=p.read_bytes(); zd=z.read(entry) if entry in names else None
  android=root/'android/app/src/main/assets/public'/rel
  intermediate=root/'android/app/build/intermediates/assets/debug/public'/rel
  row={'path':rel,'sourceSha256':hashlib.sha256(data).hexdigest(),'wwwToAndroid':android.is_file() and android.read_bytes()==data,'wwwToIntermediate':intermediate.is_file() and intermediate.read_bytes()==data,'wwwToApk':zd==data if zd is not None else False,'apkEntry':entry in names}
  rows.append(row)
 extras=sorted(n for n in names if n.startswith('assets/public/') and n not in {'assets/public/'+p.relative_to(root/'www').as_posix() for p in source})
out={'sourceAssetCount':len(source),'passCount':sum(all(r[k] for k in ('wwwToAndroid','wwwToIntermediate','wwwToApk','apkEntry')) for r in rows),'rows':rows,'generatedExtras':extras}
(run/'apk/resource-chain.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'sourceAssetCount':out['sourceAssetCount'],'passCount':out['passCount'],'generatedExtras':extras},ensure_ascii=False))
sys.exit(0 if out['sourceAssetCount']==28 and out['passCount']==28 else 1)
