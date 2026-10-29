"use strict";
const assert = require("assert");
const model = require("./lib/app-model").createAppModel({ uid: () => "x", now: () => 1000,
  getDefaultDeliveryMode: () => "notification", migrateNativeItem: () => {} });
const native = require("./lib/native-reminders");
const { recentDeliveryRows } = require("./lib/app-diagnostics");
let count = 0;
function test(name, f) { f(); count++; console.log("✓ " + name); }
const now = new Date(2030, 5, 5, 12).getTime();
const old = { id:"old", title:"旧事项", status:"waiting", priority:"normal", triggerAt:now+120000 };
const plan = (it, settings={}) => native.buildDesired([it], {notify:true,dnd:false,...settings}, now)[0];
test("D71 默认开启及缺键幂等迁移", () => {
  assert.strictEqual(model.createInitialState().settings.punctualPriority,true);
  const once = model.normalizeItem(old), twice = model.normalizeItem(JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(once, twice);
  assert.strictEqual(Object.hasOwn(once,"punctual_reminder"),false);
  assert.strictEqual(plan(twice).extra.punctual_reminder,true);
});
test("D71 显式关闭经重启仍关闭", () => {
  const once=model.normalizeItem({...old,punctual_reminder:false});
  const twice=model.normalizeItem(JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(once,twice); assert.strictEqual(plan(twice).extra.punctual_reminder,false);
});
test("D71 全局开关改变跟随事项身份，单事项覆盖双向成立", () => {
  assert.notStrictEqual(plan(old).extra.scheduleKey,plan(old,{punctualPriority:false}).extra.scheduleKey);
  assert.strictEqual(plan(old,{punctualPriority:false}).extra.punctual_reminder,false);
  assert.strictEqual(plan({...old,punctual_reminder:true},{punctualPriority:false}).extra.punctual_reminder,true);
  assert.strictEqual(plan({...old,punctual_reminder:false}).extra.punctual_reminder,false);
});
test("D71 整理兜底不自动升级", () => assert.strictEqual(plan({...old,isFallbackTrigger:true}).extra.punctual_reminder,false));
test("D73 通知成功提交才算送达，阻止通知不能伪造成功", () => {
  const events=[{token:"a",stage:"notificationScheduled",detail:"triggerAt=1000;mode=alarmClockNotification"},
    {token:"a",stage:"notificationReceived",at:2000},{token:"a",stage:"notificationPosted",at:2500},
    {token:"b",stage:"notificationReceived",at:3000},{token:"b",stage:"notificationBlocked",at:3001}];
  assert.deepStrictEqual(recentDeliveryRows(events,[]),[{token:"a",plannedAt:1000,receivedAt:2500,mode:"alarmClockNotification",delaySeconds:1.5}]);
});
test("D73 旧证据缺计划轨迹仍显示真实时间及未知模式", () => {
  const [r]=recentDeliveryRows([],[{token:"old",plannedAt:1000,receivedAt:4200}]);
  assert.strictEqual(r.delaySeconds,3.2); assert.match(r.mode,/未知/);
});
test("D73 证据与轨迹按 token 关联不串轮，最多十条且最近优先", () => {
  const es=Array.from({length:12},(_,i)=>({token:String(i),plannedAt:1000,receivedAt:2000+i}));
  const rows=recentDeliveryRows([{token:"11",stage:"notificationScheduled",detail:"triggerAt=1000;mode=inexactNotification"}],es);
  assert.strictEqual(rows.length,10); assert.strictEqual(rows[0].mode,"inexactNotification"); assert.strictEqual(rows[1].mode,"未知（旧证据）");
});
test("D71 旧备份缺键与显式 false 均兼容，新全局开关可往返且拒绝非法值", () => {
  const {validateBackupPayload}=require("./lib/app-backup");
  const payload={app:"attention-inbox",schema:5,exportedAt:"2026-10-28T00:00:00.000Z",
    items:[old,{...old,id:"off",punctual_reminder:false}],notes:[],projects:[],settings:{}};
  const legacy=validateBackupPayload(payload,5);
  assert.strictEqual(legacy.ok,true);
  assert.strictEqual(Object.hasOwn(legacy.sanitized.items[0],"punctual_reminder"),false);
  assert.strictEqual(legacy.sanitized.items[1].punctual_reminder,false);
  payload.settings.punctualPriority=false;
  const current=validateBackupPayload(JSON.parse(JSON.stringify(payload)),5);
  assert.strictEqual(current.ok,true);assert.strictEqual(current.sanitized.settings.punctualPriority,false);
  payload.settings.punctualPriority="false";assert.strictEqual(validateBackupPayload(payload,5).ok,false);
});
test("D71 review 默认策略开启时仍保持独立普通载体", () => {
  const rows=native.buildReviewDesired(2,{enabled:true,hour:21,minute:30,windowEndHour:23,windowEndMinute:0},now,{notify:true,punctualPriority:true});
  assert.ok(rows.length>0); rows.forEach(r=>{assert.strictEqual(r.extra.managedKind,"review-session");assert.notStrictEqual(r.extra.punctual_reminder,true);});
});


test("D71 精确权限广播只有统一 Receiver 入口", () => {
  const manifest = require("fs").readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  assert.strictEqual((manifest.match(/android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED/g)||[]).length, 1);
  assert.match(manifest, /ExactAlarmPermissionReceiver[\s\S]*SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED/);
});
test("D71 详情复用排程判定，兜底/review/闹钟档即使显式开启也不承诺普通准时保障", () => {
  for (const patch of [{isFallbackTrigger:true},{review_status:"NEEDS_REVIEW"},{managedKind:native.REVIEW_MANAGED_KIND},
      {priority:"critical"},{priority:"important"},{delivery_mode:"alarm"}]) {
    assert.strictEqual(native.usesPunctualNotification({...old,punctual_reminder:true,...patch},{}),false);
  }
  assert.strictEqual(native.usesPunctualNotification(old,{}),true);
  assert.match(require("fs").readFileSync("lib/app-views.js","utf8"), /usesPunctualNotification\(it, state.settings\)/);
});
console.log(`${count}/${count} 通过`);
