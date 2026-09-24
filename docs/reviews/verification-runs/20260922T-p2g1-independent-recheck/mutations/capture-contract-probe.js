#!/usr/bin/env node
"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const ROOT=path.resolve(__dirname,"../../../../..");
const file=path.join(ROOT,"lib/app-capture.js"),source=fs.readFileSync(file,"utf8");
const sha=s=>crypto.createHash("sha256").update(s).digest("hex"),before=sha(source);
function load(src){const box={module:{exports:{}},exports:{},self:null};box.self=box;vm.runInNewContext(src,box,{filename:"app-capture.js"});return box.module.exports.createAppCapture;}
function fixture(factory){
  const state={items:[],projects:[],ui:{editItemId:null,pendingLowConf:null}},nodes={},doc=[];
  function cls(){return{v:new Set(),add(x){this.v.add(x)},remove(x){this.v.delete(x)},toggle(x,on){if(on)this.v.add(x);else this.v.delete(x)},contains(x){return this.v.has(x)}}}
  function node(id){return nodes[id]||(nodes[id]={id,value:"",textContent:"",innerHTML:"",hidden:false,disabled:false,dataset:{},listeners:[],classList:cls(),addEventListener(n,f){this.listeners.push({n,f})},setAttribute(){},focus(){}})}
  const chips=["normal","important"].map(p=>{const n=node("chip-"+p);n.dataset.p=p;return n});chips[0].classList.add("on");let low=false;
  const app=factory({query:node,queryAll:s=>s==="#capPriority .chip"?chips:s==="#capPriority .chip.on"?chips.filter(c=>c.classList.contains("on")):[],
    getDocument:()=>({addEventListener:(n,f)=>doc.push({n,f})}),getState:()=>state,getLowConfUserPicked:()=>low,setLowConfUserPicked:v=>{low=v},
    openSheet:()=>{},refreshProjectSelects:()=>{},openDetail:()=>{},toLocalInput:x=>x?"2026-09-23T09:30":"",parseLocalInput:x=>x?1:null,
    parseChineseTime:()=>({confidence:"none"}),nextRepeatPreview:()=>[],fmtDate:String,fmtTime:String,repeatLabel:()=>"",getFeedback:()=>({captureSummary:()=>({empty:true,text:""})}),
    escapeHtml:String,escapeAttr:String,setTimeout:()=>1,clearTimeout:()=>{}});
  return {app,node,chips,doc};
}
function exercise(src){const h=fixture(load(src));h.app.resetItemSheet();const s1=h.app.session();h.app.resetItemSheet();const sessionAdvanced=h.app.session()===s1+1;
  h.node("#capText").value="same";const plain=h.app.snapshotItemForm();h.node("#capTrigger").value="2026-09-23T09:30";h.app.markTriggerPicked(true);const picked=h.app.snapshotItemForm();
  const signatureDiff=h.app.formDraftSignature(plain)!==h.app.formDraftSignature(picked);h.app.bind();h.app.bind();
  const bindCounts={text:h.node("#capText").listeners.length,trigger:h.node("#capTrigger").listeners.length,doc:h.doc.length};
  return {sessionAdvanced,signatureDiff,bindCounts,bindIdempotent:bindCounts.text===3&&bindCounts.trigger===2&&bindCounts.doc===1};}
const sessionAnchor="  itemFormSession++;",signatureAnchor="const triggerPart = picked",bindAnchor="      if (bound) return;";
if(!source.includes(sessionAnchor)||!source.includes(signatureAnchor)||!source.includes(bindAnchor))throw new Error("mutation anchor missing");
const healthy=exercise(source),noSession=exercise(source.replace(sessionAnchor,"  /* mutation: session increment removed */")),
  noPickedSignature=exercise(source.replace(signatureAnchor,"const triggerPart = false")),
  duplicateBind=exercise(source.replace(bindAnchor,"      /* mutation: idempotence guard removed */"));
const after=sha(fs.readFileSync(file,"utf8"));
const report={before,after,healthy,noSession,noPickedSignature,duplicateBind,red:healthy.sessionAdvanced&&healthy.signatureDiff&&healthy.bindIdempotent&&
  !noSession.sessionAdvanced&&!noPickedSignature.signatureDiff&&!duplicateBind.bindIdempotent&&before===after};
fs.writeFileSync(path.join(__dirname,"capture-contract-probe.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));if(!report.red)process.exit(1);
