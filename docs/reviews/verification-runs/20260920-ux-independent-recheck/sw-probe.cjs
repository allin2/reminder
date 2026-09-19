// Execute production SW install/fetch handlers with an initially empty cache.
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'../../../..'),handlers={},cache=new Map(),base='https://fixture.invalid/';
const key=x=>new URL(typeof x==='string'?x:x.url,base).href;
const sandbox={URL,self:{location:{origin:new URL(base).origin},addEventListener:(n,f)=>handlers[n]=f,skipWaiting:async()=>{}},fetch:async()=>{throw Error('offline')},caches:{open:async()=>({addAll:async paths=>paths.forEach(p=>cache.set(key(p),fs.readFileSync(path.join(root,p==='./'?'index.html':p),'utf8')))}),match:async req=>cache.get(key(req))}};
vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),sandbox);
(async()=>{let installing;handlers.install({waitUntil:p=>installing=p});await installing;let response;handlers.fetch({request:{method:'GET',url:base+'lib/native-reminders.js'},respondWith:p=>response=p});const body=await response;
const result={precacheHasNativeBridge:cache.has(base+'lib/native-reminders.js'),offlineScriptResponseIsIndexHtml:body===fs.readFileSync(path.join(root,'index.html'),'utf8'),evidenceLevel:'production SW handlers with cache/network mocks; not browser or Android execution'};
fs.writeFileSync(path.join(__dirname,'sw-result.json'),JSON.stringify(result,null,2)+'\n');console.log(result);})();
