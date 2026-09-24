/* The actual production UI handler diverges from the native alarm transaction for close. */
"use strict";
const fs=require("fs"), path=require("path"), Module=require("module");
const root=path.resolve(__dirname,"../../../..");
const file=path.join(root,"test-boot-combination.js");
const harness=new Module(file,module);
harness.filename=file;
harness.paths=Module._nodeModulePaths(path.dirname(file));
harness._compile(fs.readFileSync(file,"utf8")+"\nmodule.exports={bootCombination};",file);

(async()=>{
  const boot=await harness.exports.bootCombination();
  const app=boot.app;
  if(boot.ready!==true) throw new Error("production combination not ready");
  const item=app.makeItem({title:"close-route",status:"due",triggerAt:Date.now()-1000});
  app.state.items.push(item);
  await app.saveAsync();
  const event={action:"close",itemId:item.id,itemRev:item.rev,alarmEventId:"native-close-123"};
  app.state.ui.detailId=null;
  await app.handleAlarmAction(event);
  const directDetail=app.state.ui.detailId;
  app.state.ui.detailId=null;
  await app.handleNativeNotificationAction(event);
  const notificationDetail=app.state.ui.detailId;
  console.log(JSON.stringify({directDetail,notificationDetail,
    directClosesWithoutDetail:directDetail===null,
    fallbackUnexpectedlyOpensDetail:notificationDetail===item.id},null,2));
  if(notificationDetail===item.id) process.exitCode=2;
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
