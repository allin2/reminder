'use strict';
const path=require('path');
const h=require(path.join('/Users/qlyf/Developer/reminder','test-boot-combination.js'));
(async()=>{
 const b=await h.bootCombination({idbValue:{schema:5,items:[],notes:[],projects:[],settings:{ai:{enabled:true}}}});
 const got=b.app.state.settings.ai;
 const want={enabled:true,baseUrl:'https://api.openai.com/v1',apiKey:'',model:'gpt-4o-mini',autoOnSave:false};
 const pass=b.ready===true && JSON.stringify(got)===JSON.stringify(want);
 console.log(JSON.stringify({pass,ready:b.ready,got,want},null,2)); process.exit(pass?0:1);
})().catch(e=>{console.error(e.stack||e);process.exit(2)});
