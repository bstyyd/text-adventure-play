import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Unzip,UnzipInflate,zipSync,strToU8 } from 'fflate';
import { ScenarioSchema } from './schema';
import type { PublicScenario,ScenarioPackage,ScenarioSummary } from './schema';
import {inspectZip,crc32} from './zip-guard';
import {calendarDate} from './calendar';
import {browserEdition} from '../client/site-path';
export const PACKAGE_LIMITS={zip:4*1024*1024,total:12*1024*1024,text:512*1024,image:2*1024*1024,files:256};
export function canonicalJson(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(Reflect.get(value,k))).join(',')+'}';return JSON.stringify(value);}
export const scenarioHash=(p:ScenarioPackage)=>createHash('sha256').update(canonicalJson(p)).digest('hex');
export function safePackagePath(p:string){if(!/^[a-zA-Z0-9_./-]+$/.test(p)||p.startsWith('/')||p.split('/').some(x=>x==='.'||x==='..'||!x)||p.length>200)throw new Error('剧本包含非法或绝对路径');return p;}
function boundedObject(raw:unknown){const stack=[{value:raw,depth:0}];let count=0;while(stack.length){const {value,depth}=stack.pop()!;if(depth>24||++count>100000)throw new Error('剧本结构过深或过大');if(typeof value==='string'&&/<\s*(script|iframe|object|embed)|javascript\s*:/i.test(value))throw new Error('剧本不允许 HTML Script 或可执行链接');if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))throw new Error('非法对象字段');stack.push({value:v,depth:depth+1});}}}
export function validateScenario(raw:unknown):ScenarioPackage{
  boundedObject(raw);const p=ScenarioSchema.parse(raw),ids=new Set(p.characters.map(c=>c.stableId));
  const unique=(keys:string[],label:string)=>{if(new Set(keys).size!==keys.length)throw new Error(label+' ID 重复');};
  unique([...ids],'人物');if(ids.size!==p.characters.length)throw new Error('人物 ID 重复');
  unique(p.rules.relationshipStats.map(s=>s.key),'人物数值');unique(p.rules.worldStats.map(s=>s.key),'世界数值');unique(p.rules.triggers.map(s=>s.id),'规则');unique(p.locations.map(l=>l.id),'地点');unique(p.factions.map(f=>f.id),'势力');unique(p.lore.map(l=>l.id),'Lore');unique(p.playerChoices.map(c=>c.choiceId),'主角选项');
  if(ids.has('player'))throw new Error('player ID 保留给玩家角色');
  const statKeys=new Set(p.rules.relationshipStats.map(s=>s.key)),worldKeys=new Set(p.rules.worldStats.map(s=>s.key));
  if(!p.manifest.relationshipSystem.enabled&&(p.rules.relationshipStats.length||p.rules.triggers.some(r=>r.romanceRequired)))throw new Error('关闭关系系统时不能声明人物数值或情感规则');
  if(!p.manifest.romanceSystem&&(p.characters.some(c=>c.romancePolicy==='available')||p.rules.triggers.some(r=>r.romanceRequired)))throw new Error('关闭恋爱系统时不能开放路线或情感规则');
  for(const c of p.characters)for(const [key,value] of Object.entries(c.initialStats)){const def=p.rules.relationshipStats.find(s=>s.key===key);if(!def||value<def.min||value>def.max)throw new Error('人物数值未定义或超出范围：'+key);}
  const conditions=(r:unknown):void=>{const c=r as Record<string,unknown>;if('all'in c||'any'in c){for(const child of (c.all||c.any) as unknown[])conditions(child);}else if(c.source==='character_stat'&&!statKeys.has(String(c.key))||c.source==='world_stat'&&!worldKeys.has(String(c.key))||c.source==='counter'&&!['neglect','exceptions'].includes(String(c.key)))throw new Error('规则引用未知数值或计数器');};
  p.rules.triggers.forEach(r=>conditions(r.trigger));
  if(!p.locations.some(l=>l.id===p.initialScene.locationId))throw new Error('开场地点没有定义');
  for(const id of [...p.initialScene.present,...p.ui.pinnedCharacters])if(!ids.has(id))throw new Error('开场或置顶人物不在种子中');
  for(const c of p.characters)if(c.initialLocation&&!p.locations.some(l=>l.id===c.initialLocation))throw new Error('人物初始地点无效');
  for(const c of p.characters)for(const r of c.relationships){if(r.toCharacterId===c.stableId||[r.toCharacterId,...r.knownBy].some(id=>id!=='player'&&!ids.has(id)))throw new Error('初始人物关系引用无效');}
  if(p.manifest.playerMode==='selectable'&&!p.playerChoices.length)throw new Error('选择主角模式至少需要一位候选');
  if(p.manifest.openingMode==='interactive_setup'&&p.manifest.playerMode==='fixed')throw new Error('交互式开局需要自定义或可选择主角，固定主角请使用固定开场／条件生成');
  if(p.manifest.timeSystem===(p.calendar.type==='none'))throw new Error('时间功能与日历类型不一致');
  if(p.calendar.type==='fictional'&&(p.calendar.start.month>p.calendar.months.length||p.calendar.start.day>p.calendar.months[p.calendar.start.month-1]))throw new Error('开局日期超出日历');
  calendarDate(p.calendar,p.calendar.start.year,p.calendar.start.month,p.calendar.start.day,p.calendar.start.minuteOfDay);
  for(const l of p.locations)if(l.parentId&&!p.locations.some(n=>n.id===l.parentId))throw new Error('地点上级不存在');
  for(const l of p.locations){const seen=new Set<string>();let at:typeof l|undefined=l;while(at){if(seen.has(at.id))throw new Error('地点层级不能循环');seen.add(at.id);at=p.locations.find(n=>n.id===at!.parentId);}}
  const total=Buffer.byteLength(JSON.stringify(p));if(total>PACKAGE_LIMITS.total*1.4)throw new Error('剧本内容过大');
  for(const [file,base64] of Object.entries(p.assets)){safePackagePath(file);const data=Buffer.from(base64,'base64');if(!file.startsWith('assets/')||!validImage(file,data)||data.length>PACKAGE_LIMITS.image)throw new Error('只支持有正确签名的 PNG／JPEG／WebP 图片');}
  if(p.ui.theme.coverImage&&!Object.hasOwn(p.assets,p.ui.theme.coverImage))throw new Error('封面图片不存在');
  return p;
}
function validImage(file:string,data:Uint8Array){const b=Buffer.from(data);return /\.png$/i.test(file)&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||/\.jpe?g$/i.test(file)&&b[0]===255&&b[1]===216&&b[2]===255||/\.webp$/i.test(file)&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';}
export function builtInScenario(){return validateScenario(JSON.parse(readFileSync(path.join(process.cwd(),'packages/dayao_empress/scenario.json'),'utf8')));}
export function publicScenario(p:ScenarioPackage):PublicScenario{return {manifest:p.manifest,player:p.player,playerChoices:p.playerChoices,ui:p.ui,calendar:p.calendar,rules:{relationshipStats:p.rules.relationshipStats,worldStats:p.rules.worldStats,storyThreadTypes:p.rules.storyThreadTypes},characters:p.characters.map(({stableId,displayName,description,age,roles,minTravelMinutes,contactModes})=>({stableId,displayName,description,age,roles,minTravelMinutes,contactModes})),locations:p.locations,factions:p.factions};}
export function summarize(p:ScenarioPackage,builtIn=false):ScenarioSummary{return {packageId:p.manifest.packageId,version:p.manifest.version,title:p.manifest.title,description:p.manifest.description,author:p.manifest.author,hash:scenarioHash(p),builtIn,playerName:p.player.name,npcCount:p.characters.length,relationshipStats:p.rules.relationshipStats.map(s=>s.displayName),worldStats:p.rules.worldStats.map(s=>s.displayName),dynamicCharacters:p.manifest.dynamicCharacters,romance:p.manifest.romanceSystem,hiddenInformation:p.characters.some(c=>!!c.privateBackground)||p.lore.some(l=>l.visibility==='narrator'),openingMode:p.manifest.openingMode,loreCount:p.lore.length,coverImage:p.ui.theme.coverImage?(browserEdition()?'data:image/'+(p.ui.theme.coverImage.endsWith('.png')?'png':p.ui.theme.coverImage.endsWith('.webp')?'webp':'jpeg')+';base64,'+p.assets[p.ui.theme.coverImage]:'/api/scenarios/'+p.manifest.packageId+'/assets/'+p.ui.theme.coverImage+'?version='+p.manifest.version):null,warnings:p.manifest.openingMode==='fixed'&&!p.opening.trim()?['尚无固定开场，编辑后才能创建存档']:[]};}
export function packageZip(p:ScenarioPackage){
  const files:Record<string,Uint8Array>={},put=(name:string,data:unknown)=>files[name]=strToU8(JSON.stringify(data,null,2));
  put('manifest.json',p.manifest);put('player.json',p.player);put('rules.json',p.rules);put('calendar.json',p.calendar);
  files['world.md']=strToU8(p.world);files['opening.md']=strToU8(p.opening);files['style.md']=strToU8(p.style);
  p.characters.forEach(c=>put('characters/'+c.stableId+'.json',c));
  const {manifest:_m,player:_p,rules:_r,calendar:_c,world:_w,opening:_o,style:_s,characters:_n,assets:_a,...extra}=p;void [_m,_p,_r,_c,_w,_o,_s,_n,_a];put('scenario-data.json',extra);
  for(const [name,data] of Object.entries(p.assets))files[name]=Buffer.from(data,'base64');
  return zipSync(files,{level:6});
}
export function importPackageZip(data:Uint8Array){
  if(data.length>PACKAGE_LIMITS.zip)throw new Error('剧本 ZIP 超过 4MB');
  const expected=inspectZip(data);
  const files=new Map<string,Uint8Array>();let count=0,total=0;const seen=new Set<string>();
  const unzip=new Unzip(file=>{
    const entry=expected.get(file.name);if(!entry)throw new Error('ZIP 包含目录未登记的文件');
    const directory=file.name.endsWith('/'),fileName=directory?file.name.slice(0,-1):file.name;safePackagePath(fileName);
    if(++count>PACKAGE_LIMITS.files||seen.has(fileName))throw new Error('文件过多或路径重复');seen.add(fileName);
    if(!directory&&!/\.(json|md|txt|png|jpe?g|webp)$/i.test(fileName))throw new Error('剧本只接受 JSON、Markdown、文本和受支持图片，禁止代码／SQL／HTML');
    const limit=/\.(png|jpe?g|webp)$/i.test(fileName)?PACKAGE_LIMITS.image:PACKAGE_LIMITS.text;
    if(file.originalSize!==undefined&&file.originalSize>limit)throw new Error('剧本文件过大');
    const chunks:Uint8Array[]=[];let size=0;
    file.ondata=(error,chunk,final)=>{if(error)throw error;size+=chunk.length;total+=chunk.length;if(size>limit||total>PACKAGE_LIMITS.total){file.terminate();throw new Error('解压后的剧本过大');}chunks.push(chunk);if(final){const value=Buffer.concat(chunks);if(size!==entry.size||crc32(value)!==entry.crc)throw new Error('ZIP 内容截断或 CRC 完整性校验失败');if(!directory){if(/\.(png|jpe?g|webp)$/i.test(fileName)&&!validImage(fileName,value))throw new Error('图片签名无效');files.set(fileName,value);}}};file.start();
  });unzip.register(UnzipInflate);
  for(let i=0;i<data.length;i+=4096)unzip.push(data.subarray(i,i+4096),i+4096>=data.length);
  if(seen.size!==expected.size)throw new Error('ZIP 文件未完整读取');
  const decode=(name:string,required=true)=>{const v=files.get(name);if(!v){if(required)throw new Error('缺少 '+name);return '';}return new TextDecoder('utf-8',{fatal:true}).decode(v);};
  const json=(name:string,required=true)=>{const value=decode(name,required);return value?JSON.parse(value):undefined;};
  const manifest=json('manifest.json'),player=json('player.json'),rules=json('rules.json');
  const extra=json('scenario-data.json',false)||{};
  const fallback={id:'no-time',type:'none',era:'',start:{year:1,month:1,day:1,minuteOfDay:0},allowAdvance:false};
  const characters=[...files.keys()].filter(k=>k.startsWith('characters/')&&k.endsWith('.json')).sort().map(k=>json(k));
  const loreFiles=[...files.keys()].filter(k=>k.startsWith('lore/')).sort().map((k,i)=>k.endsWith('.json')?json(k):{id:'lore_'+i,title:k,content:decode(k),visibility:'public'});
  const refs=[...files.keys()].filter(k=>k.startsWith('references/')&&/\.(md|txt)$/.test(k)).map((k,i)=>({id:'reference_'+i,content:decode(k),purpose:'style_reference'}));
  const world=files.has('world.md')?decode('world.md'):json('world.json');
  const assets=Object.fromEntries([...files].filter(([k])=>k.startsWith('assets/')).map(([k,v])=>[k,Buffer.from(v).toString('base64')]));
  return validateScenario({locations:[{id:'opening_location',name:'开场地点'}],initialScene:{locationId:'opening_location',weather:'',present:[],pendingThreads:[]},ui:{},...extra,manifest,player,rules,world:typeof world==='string'?world:JSON.stringify(world),opening:decode('opening.md'),style:decode('style.md'),calendar:json('calendar.json',false)||fallback,characters,lore:extra.lore||loreFiles,references:extra.references||refs,assets});
}
