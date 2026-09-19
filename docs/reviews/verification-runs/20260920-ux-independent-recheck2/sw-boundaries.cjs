const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'../../../..'),ctx={Response,caches:{match:async q=>q==='./index.html'?'HTML':undefined},self:{addEventListener(){}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),ctx);
(async()=>{const script=await ctx.offlineFallback({mode:'cors'}),navigation=await ctx.offlineFallback({mode:'navigate'});assert.equal(script.status,504);assert.equal(navigation,'HTML');const r={missingScriptStatus:script.status,navigationFallback:navigation,pass:true};fs.writeFileSync(path.join(__dirname,'sw-boundaries.json'),JSON.stringify(r,null,2));console.log(r)})().catch(e=>{console.error(e);process.exit(1)});
