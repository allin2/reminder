const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'snapshot'),base=path.join(__dirname,'baseline');
const parse=require(root+'/lib/parse-cn'),oldParse=require(base+'/lib/parse-cn');
const repeat=require(root+'/lib/repeat'),oldRepeat=require(base+'/lib/repeat');
let checks=0;const mismatches=[];
const corpus=['三分钟后提醒我开会','每月第2个周二开例会','每月底交房租','每月31号交费','下周一九点开会','下下周日看看','明天晚上8点','四十分钟以后提醒我','周末看看','下个月1号'];
function same(name,x,y){checks++;if(JSON.stringify(x)!==JSON.stringify(y))mismatches.push({name,x,y});}
for(let year=2024;year<=2027;year++)for(let month=0;month<12;month++)for(const day of [1,5,28,29,30,31])for(const hour of [0,9,10,11,23]){
 const now=new Date(year,month,day,hour,17,31);
 for(const text of corpus)same('parse '+now.toISOString()+' '+text,parse.parseChineseTime(text,now),oldParse.parseChineseTime(text,now));
 for(const rep of [{every:'day'},{every:'week'},{every:'month'},{every:'monthEnd'},{every:'nthWeekday',nth:1,dow:1},{every:'nthWeekday',nth:-1,dow:5}])for(const mode of ['calendar','ack']){
  const item={repeat:{...rep,mode},triggerAt:now.getTime(),acknowledgedAt:now.getTime()+86400000};
  same('repeat '+now.toISOString()+JSON.stringify(rep)+mode,repeat.nextRepeatTrigger(item),oldRepeat.nextRepeatTrigger(item));
 }
}
const p=require(root+'/scripts/verification/production-scripts');
const result={checks,mismatchCount:mismatches.length,mismatches:mismatches.slice(0,10),dependencies:p.runtimeDependencyCoverage(root).undeclared,loadOrder:p.inspectList(root,p.readIndexScripts(root)),precache:p.precacheProblems(root),packaging:p.packagingProblems(root)};
fs.writeFileSync(path.join(__dirname,'semantic-and-static.json'),JSON.stringify(result,null,2));
console.log(result);process.exit(mismatches.length?1:0);
