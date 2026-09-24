#!/usr/bin/env node
"use strict";
/* P2-G1 in-memory source mutations: healthy and mutant use the same behavior assertions. */
const crypto=require("crypto"),fs=require("fs"),path=require("path"),vm=require("vm");
const prod=require("./production-scripts.js"); const ROOT=path.resolve(__dirname,"../..");
const capPath=path.join(ROOT,"lib/app-capture.js"), corePath=path.join(ROOT,"app-core.js"), indexPath=path.join(ROOT,"index.html");
const sha=s=>crypto.createHash("sha256").update(s).digest("hex");
function factory(source){ const sb={module:{exports:{}},exports:{}}; vm.runInNewContext(source,sb,{filename:"app-capture.js"}); return sb.module.exports.createAppCapture; }
function fixture(source){ const nodes={}, state={items:[],projects:[],ui:{editItemId:null}}; let low=false;
 const node=s=>nodes[s]||(nodes[s]={value:"",textContent:"",innerHTML:"",hidden:false,disabled:false,dataset:{},classList:{toggle(){},add(){},remove(){},contains(){return false;}},addEventListener(){},setAttribute(){},focus(){}});
 const f=factory(source); return f({query:node,queryAll:()=>[],getDocument:()=>({addEventListener(){}}),getState:()=>state,getLowConfUserPicked:()=>low,setLowConfUserPicked:v=>{low=!!v;},openSheet(){},refreshProjectSelects(){},openDetail(){},toLocalInput:v=>String(v||""),parseLocalInput:v=>v?1:null,parseChineseTime:()=>({confidence:"none",trigger:0,deadline:0}),nextRepeatPreview:()=>[],fmtDate:String,fmtTime:String,repeatLabel:()=>"",getFeedback:()=>null,escapeHtml:String,escapeAttr:String,setTimeout:()=>0,clearTimeout(){}}); }
function scripts(text){ return Array.from(text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)).map(m=>m[1]); }
const capture=fs.readFileSync(capPath,"utf8"),core=fs.readFileSync(corePath,"utf8"),index=fs.readFileSync(indexPath,"utf8"),before={capture:sha(capture),core:sha(core),index:sha(index)},results=[];
function add(id,healthy,mutant){results.push({id,healthy,mutant,red:healthy&&!mutant});}
let a=fixture(capture); a.resetItemSheet();const s1=a.session();a.resetItemSheet(); const healthySession=a.session()===s1+1;
let b=fixture(capture.replace("itemFormSession++;","itemFormSession += 0;"));b.resetItemSheet();const m1=b.session();b.resetItemSheet();add("M1-session-increment",healthySession,b.session()===m1+1);
a=fixture(capture);a.resetItemSheet();a.markTriggerPicked(true);const x=a.snapshotItemForm();x.trigger="one";const y=Object.assign({},x,{trigger:"two"});const healthySig=a.formDraftSignature(x)!==a.formDraftSignature(y);
b=fixture(capture.replace("+ (snap.trigger || \"\")","+ \"\""));b.resetItemSheet();b.markTriggerPicked(true);const mx=b.snapshotItemForm();mx.trigger="one";const my=Object.assign({},mx,{trigger:"two"});add("M2-handpicked-time-signature",healthySig,b.formDraftSignature(mx)!==b.formDraftSignature(my));
const goodCoverage=prod.captureInstanceCoverage(ROOT);const mutantCore=core.replace('"bind", "session", "markTriggerPicked"','"bind", "markTriggerPicked"');const badCoverage=prod.captureInstanceCoverage(ROOT,{source:mutantCore});add("M3-instance-contract-member",goodCoverage.missingInContract.length===0,badCoverage.missingInContract.length===0);
const healthyList=scripts(index).includes("lib/app-capture.js");const mutantList=scripts(index.replace('<script src="lib/app-capture.js"></script>','')).includes("lib/app-capture.js");add("M4-production-load-list",healthyList,mutantList);
const after={capture:sha(fs.readFileSync(capPath,"utf8")),core:sha(fs.readFileSync(corePath,"utf8")),index:sha(fs.readFileSync(indexPath,"utf8"))};const report={purpose:"P2-G1 in-memory mutation proof",results,workspaceRestore:{before,after,restored:JSON.stringify(before)===JSON.stringify(after)}};console.log(JSON.stringify(report,null,2));if(!report.workspaceRestore.restored||results.some(x=>!x.red))process.exit(1);
