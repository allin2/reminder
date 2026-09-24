from pathlib import Path
import hashlib, zipfile, sys
root=Path.cwd()
run=Path('/tmp/p3b-independent-run-path').read_text().strip()
apk=root/run/'apk/p3b-app-debug.apk'
www=root/'www'
assets=root/'android/app/src/main/assets/public'
inter=root/'android/app/build/intermediates/assets/debug/public'
rels=sorted(p.relative_to(www).as_posix() for p in www.rglob('*') if p.is_file())
rows=[]; bad=[]
def h(b): return hashlib.sha256(b).hexdigest()
with zipfile.ZipFile(apk) as z:
    names=set(z.namelist())
    for rel in rels:
        paths=[root/rel,www/rel,assets/rel,inter/rel]
        data=[]
        for p in paths:
            if not p.is_file():
                bad.append(f'missing:{p}')
                data.append(b'')
            else: data.append(p.read_bytes())
        zp='assets/public/'+rel
        if zp not in names:
            bad.append('missing-apk:'+zp); apkb=b''
        else: apkb=z.read(zp)
        hashes=[h(x) for x in data+[apkb]]
        if len(set(hashes)) != 1: bad.append('mismatch:'+rel)
        rows.append((rel,*hashes))
out=root/run/'apk/resource-29-way-sha256.tsv'
out.write_text('path\tsource\twww\tandroid-assets\tintermediate\tapk\n'+'\n'.join('\t'.join(r) for r in rows)+'\n')
print(f'count={len(rels)}')
print(f'bad={len(bad)}')
for x in bad: print(x)
if len(rels)!=29 or bad: sys.exit(1)
