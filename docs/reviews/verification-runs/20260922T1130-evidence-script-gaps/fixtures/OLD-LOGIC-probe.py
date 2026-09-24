import struct,sys
sys.path.insert(0, '/Users/qlyf/Developer/reminder/scripts/verification')
import importlib.util
spec = importlib.util.spec_from_file_location('wal', '/Users/qlyf/Developer/reminder/scripts/verification/idb-wal-delta.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
a=open(sys.argv[1],'rb').read(); b=open(sys.argv[2],'rb').read()
app=b[len(a):]; recs=m.parse_records(app)
off,kind,pl=recs[0]                       # ← 旧版的行为：只看第一条
seq,count,ents = m.decode_batch(pl)
print('OLD_RECS0 count=%d VERDICT=%s'%(count,'NO_OPERATIONS' if count==0 else 'HAS_OPERATIONS'))
