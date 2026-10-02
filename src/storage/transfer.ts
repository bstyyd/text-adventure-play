import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Repository } from './repository';
import { EvidenceSchema, FactProposalSchema, NewGameSchema, NpcIdSchema, ProviderIdSchema } from '../domain/types';
import type { Annotation, Bookmark, Branch, OocMessage, Save, Turn } from '../domain/types';
import { gameDate } from '../domain/calendar';
export { readingExport } from '../domain/reading-export';
import { blocks } from '../memory/context';
import { CharacterSchema, CharacterEventSchema, CharacterCorrectionSchema } from '../characters/schema';
import type { CharacterCorrection } from '../characters/schema';
import {builtInScenario,scenarioHash,validateScenario} from '../scenario/package';
import {ScenarioSchema} from '../scenario/schema';
import {migratedSave,migratedTurn} from '../scenario/legacy';
import {attachScenario} from '../scenario/runtime';
import { seedCharacters } from '../characters/world';
import { validateCharacterArchive } from '../characters/archive';
const id=z.string().uuid(),text=z.string().max(100000),short=z.string().max(600);
const date=z.object({year:z.number().int().min(1).max(9999),month:z.number().int().min(1).max(24),day:z.number().int().min(1).max(100000),minuteOfDay:z.number().int().min(0).max(1439),absoluteDay:z.number().int().min(0),period:short,calendarVersion:z.string().max(80),display:short.optional()}).strict();
const relationship=z.object({values:z.record(z.string().max(80),z.number().finite()),status:short}).strict();
const state=z.object({
  date,accessionDay:z.number().int(),location:short,locationId:z.string().max(100),weather:short,present:z.array(NpcIdSchema).max(64),sceneId:id,messageCount:z.number().int().min(0),sceneCount:z.number().int().min(1),originRegion:z.null(),
  relationships:z.record(NpcIdSchema,relationship),
  worldStats:z.record(z.string().max(80),z.number().finite()),romancePolicies:z.record(NpcIdSchema,z.enum(['disabled','available'])).optional(),
  events:z.array(z.object({key:short,type:z.string().max(80),npcIds:z.array(NpcIdSchema).max(64),status:z.enum(['eligible','queued','introduced','resolved','cancelled']),reason:short,triggerTurnId:id,priority:z.number(),introducedScene:id.optional()}).strict()).max(10000),
  eventKeys:z.array(short).max(10000),relationshipKeys:z.array(short).max(100000),sceneDeltas:z.record(z.string().max(180),z.number().min(-100).max(100)),
  neglect:z.record(NpcIdSchema,z.number().int().min(0)),exceptions:z.record(NpcIdSchema,z.array(short)),contacted:z.array(NpcIdSchema).max(64),
  factIds:z.array(id).max(100000),pendingThreads:z.array(short).max(100),
  storyThreads:z.array(z.object({id,type:z.string().max(80),content:short,status:z.enum(['open','resolved']),sourceTurnId:id,evidence:EvidenceSchema}).strict()).max(1000).optional(),
  dynamicLocations:z.array(z.object({id:z.string().max(100),name:short,sourceTurnId:id,evidence:EvidenceSchema,revealed:z.boolean().optional()}).strict()).max(1000).optional(),
}).strict();
const fact=FactProposalSchema.extend({id,sourceTurnId:id,gameDate:date,createdAt:z.iso.datetime(),version:z.number().int().min(1),propagation:z.array(short)}).strict();
const effects=z.object({
  facts:z.array(fact).max(100),knowledge:z.array(z.object({id,npcId:NpcIdSchema,factId:id,sourceTurnId:id,path:short,evidence:EvidenceSchema}).strict()).max(100),
  memories:z.array(z.object({id,factId:id,sourceTurnId:id,kind:short,content:short,importance:z.number().min(1).max(5)}).strict()).max(100),
  summaries:z.array(z.object({id,sourceTurnIds:z.array(id),cutoffTurnId:id,content:text,version:z.number().int().min(1)}).strict()).max(100),
  suggestedActions:z.array(short).max(4),diagnostics:z.array(short).max(100),
  characters:z.array(CharacterSchema).max(32).optional(),characterEvents:z.array(CharacterEventSchema).max(200).optional(),
}).strict();
const turnSchema=z.object({id,saveId:id,parentTurnId:id.nullable(),branchId:id,playerText:text,body:text,createdAt:z.iso.datetime(),state,effects,provider:ProviderIdSchema,model:short,requestId:id,usage:z.object({input:z.number().min(0),output:z.number().min(0)}).strict(),requestCount:z.number().int().min(0),kind:z.enum(['story','configuration']).optional(),memorySource:z.literal('local-review').optional(),scenarioSnapshotHash:z.string().length(64).optional(),playerName:z.string().max(100).optional()}).strict();
const branchSchema=z.object({id,saveId:id,name:short,parentBranchId:id.nullable(),forkTurnId:id.nullable(),headTurnId:id}).strict();
const saveSchema=z.object({id,title:short,createdAt:z.iso.datetime(),currentBranchId:id,initialConfig:NewGameSchema,canonVersion:z.string().max(80),scenarioPackageId:z.string().max(80),scenarioVersion:z.string().max(30),scenarioSnapshotHash:z.string().length(64),openingStatus:z.enum(['pending','ready']).optional()}).strict();
const bookmarkSchema=z.object({id,turnId:id,note:short}).strict();
const annotationSchema=z.object({id,branchId:id,sourceTurnId:id,factId:id,kind:z.enum(['pin','error','note']),text:short,createdAt:z.iso.datetime()}).strict();
const oocSchema=z.object({id,branchId:id,atTurnId:id,playerText:text,body:text,createdAt:z.iso.datetime()}).strict();
const payloadSchema=z.object({schemaVersion:z.literal(3),visibility:z.literal('full-restore-includes-hidden').optional(),canonVersion:z.string().max(80),calendarVersion:z.string().max(80),scenarioSnapshot:ScenarioSchema,scenarioSnapshots:z.record(z.string().length(64),ScenarioSchema).default({}),save:saveSchema,branches:z.array(branchSchema).min(1).max(10000),turns:z.array(turnSchema).min(1).max(100000),bookmarks:z.array(bookmarkSchema).max(100000),annotations:z.array(annotationSchema).max(100000),ooc:z.array(oocSchema).max(100000),characterCorrections:z.array(CharacterCorrectionSchema).max(100000).optional()}).strict();
export type SavePayload=z.infer<typeof payloadSchema>;
const checksum=(data:unknown)=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
export function exportSave(repo:Repository,saveId:string){
  const save=repo.save(saveId),branches=repo.all<Branch>('branches').filter(b=>b.saveId===saveId),turns=repo.all<Turn>('turns').filter(t=>t.saveId===saveId).map(t=>repo.turn(t.id));
  const visible=new Set(turns.map(t=>t.id)),bids=new Set(branches.map(b=>b.id));
  const scenarioSnapshot=repo.scenarios.fromSnapshot(save.scenarioSnapshotHash);
  const payload={schemaVersion:3,visibility:'full-restore-includes-hidden',canonVersion:save.canonVersion,calendarVersion:scenarioSnapshot.calendar.id,scenarioSnapshot,scenarioSnapshots:Object.fromEntries([...new Set([save.scenarioSnapshotHash,...turns.map(t=>t.scenarioSnapshotHash!)])].map(hash=>[hash,repo.scenarios.fromSnapshot(hash)])),save,branches,turns,
    bookmarks:repo.all<Bookmark>('bookmarks').filter(b=>visible.has(b.turnId)),
    annotations:repo.all<Annotation>('annotations').filter(a=>bids.has(a.branchId)),
    ooc:repo.all<OocMessage>('ooc_messages').filter(o=>bids.has(o.branchId)),
    characterCorrections:repo.all<CharacterCorrection>('character_corrections').filter(c=>c.saveId===saveId)};
  return {payload,sha256:checksum(payload)};
}
export function parseArchive(raw:string){
  if(Buffer.byteLength(raw)>20*1024*1024)throw new Error('存档超过20MB导入上限，请使用数据库备份恢复。');
  let wrapper:unknown;
  try{wrapper=JSON.parse(raw);}catch{throw new Error('仅接受本应用 JSON 存档，不支持 ZIP 或任意路径解压。');}
  const parsed=z.object({payload:z.unknown(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(wrapper);
  if(checksum(parsed.payload)!==parsed.sha256)throw new Error('存档完整性校验失败。');
  let normalized=parsed.payload as Record<string,unknown>;
  if(normalized.schemaVersion===1||normalized.schemaVersion===2){const p=normalized.scenarioSnapshot?validateScenario(normalized.scenarioSnapshot):builtInScenario(),hash=scenarioHash(p);normalized={...normalized,schemaVersion:3,scenarioSnapshot:p,calendarVersion:p.calendar.id,save:migratedSave(normalized.save,p,hash),turns:(normalized.turns as unknown[]).map(t=>migratedTurn(t,p,hash))};}
  const data=payloadSchema.parse(normalized),nodes=new Map(data.turns.map(t=>[t.id,t])),branchMap=new Map(data.branches.map(b=>[b.id,b]));
  validateScenario(data.scenarioSnapshot);
  if(scenarioHash(data.scenarioSnapshot)!==data.save.scenarioSnapshotHash||data.scenarioSnapshot.manifest.packageId!==data.save.scenarioPackageId||data.scenarioSnapshot.manifest.version!==data.save.scenarioVersion)throw new Error('存档绑定的剧本版本或哈希不一致');
  for(const [hash,p] of Object.entries(data.scenarioSnapshots)){validateScenario(p);if(hash!==scenarioHash(p)||p.manifest.packageId!==data.save.scenarioPackageId)throw new Error('剧本快照索引或所属剧本无效');}
  if(nodes.size!==data.turns.length||branchMap.size!==data.branches.length)throw new Error('重复节点或分支 ID。');
  if(!branchMap.has(data.save.currentBranchId))throw new Error('当前分支缺失。');
  const facts=new Map(data.turns.flatMap(t=>t.effects.facts).map(f=>[f.id,f]));
  const pathFor=(head:string)=>{
    const seen=new Set<string>();let next:string|null=head;
    while(next){if(seen.has(next)||!nodes.has(next))throw new Error('节点缺失或循环。');seen.add(next);next=nodes.get(next)!.parentTurnId;}
    return seen;
  };
  for(const branch of data.branches){
    if(branch.saveId!==data.save.id||!nodes.has(branch.headTurnId)||(branch.parentBranchId&&!branchMap.has(branch.parentBranchId)))throw new Error('分支引用无效。');
    const ancestry=pathFor(branch.headTurnId);
    if(branch.forkTurnId&&!ancestry.has(branch.forkTurnId))throw new Error('分叉点不在节点路径。');
  }
  for(const turn of data.turns){
    if(turn.saveId!==data.save.id||!branchMap.has(turn.branchId))throw new Error('节点跨存档或分支缺失。');
    const bound=turn.scenarioSnapshotHash&&data.scenarioSnapshots[turn.scenarioSnapshotHash]||data.scenarioSnapshot;attachScenario(turn as Turn,bound);
    if(turn.scenarioSnapshotHash&&turn.scenarioSnapshotHash!==scenarioHash(bound))throw new Error('存档包含不同剧本快照，不能忽略版本来源');
    if(turn.state.date.absoluteDay!==gameDate(turn.state.date.year,turn.state.date.month,turn.state.date.day,turn.state.date.minuteOfDay,bound.calendar).absoluteDay)throw new Error('日期与剧本日历不一致');
    for(const [key,value] of Object.entries(turn.state.worldStats)){const d=bound.rules.worldStats.find(d=>d.key===key);if(!d||value<d.min||value>d.max)throw new Error('世界数值与剧本不一致');}
    for(const rel of Object.values(turn.state.relationships))for(const [key,value] of Object.entries(rel.values)){const d=bound.rules.relationshipStats.find(d=>d.key===key);if(!d||value<d.min||value>d.max)throw new Error('人物数值与剧本不一致');}
    const visible=pathFor(turn.id),sources:Record<string,string>={player:turn.playerText,...blocks(turn.body)};
    for(const item of [...(turn.state.storyThreads||[]),...(turn.state.dynamicLocations||[])]){const source=nodes.get(item.sourceTurnId);if(!source||!visible.has(source.id)||!({player:source.playerText,...blocks(source.body)})[item.evidence.blockId]?.includes(item.evidence.quote))throw new Error('剧情线或临时地点来源不在可见路径');}
    for(const f of turn.effects.facts)if(f.sourceTurnId!==turn.id||!sources[f.evidence.blockId]?.includes(f.evidence.quote))throw new Error('事实来源或引文缺失。');
    for(const k of [...turn.effects.knowledge,...turn.effects.memories])if(k.sourceTurnId!==turn.id||!facts.has(k.factId)||!visible.has(facts.get(k.factId)!.sourceTurnId))throw new Error('人物记忆来源不在可见路径。');
    for(const s of turn.effects.summaries)if(!visible.has(s.cutoffTurnId)||!s.sourceTurnIds.every(v=>visible.has(v)))throw new Error('摘要引用了未来或另一分支。');
    if(!turn.state.factIds.every(f=>facts.has(f)&&visible.has(facts.get(f)!.sourceTurnId)))throw new Error('快照事实引用无效。');
  }
  for(const b of data.bookmarks)if(!nodes.has(b.turnId))throw new Error('书签来源缺失。');
  for(const a of data.annotations)if(!branchMap.has(a.branchId)||!nodes.has(a.sourceTurnId)||facts.get(a.factId)?.sourceTurnId!==a.sourceTurnId||!pathFor(branchMap.get(a.branchId)!.headTurnId).has(a.sourceTurnId))throw new Error('记忆标注来源缺失或跨分支。');
  for(const o of data.ooc)if(!branchMap.has(o.branchId)||!nodes.has(o.atTurnId)||!pathFor(branchMap.get(o.branchId)!.headTurnId).has(o.atTurnId))throw new Error('OOC 来源缺失或跨分支。');
  for(const turn of data.turns)if(!turn.parentTurnId&&!turn.effects.characters){
    if((parsed.payload as {schemaVersion:number}).schemaVersion!==1)throw new Error('动态人物创建记录缺失。');
    Object.assign(turn.effects,seedCharacters(turn as Turn,true));
  }
  validateCharacterArchive(data.turns as Turn[]);
  for(const c of data.characterCorrections||[]){
    const branch=branchMap.get(c.branchId),person=data.turns.flatMap(t=>t.effects.characters||[]).find(p=>p.id===c.characterId);
    if(c.saveId!==data.save.id||!branch||!pathFor(branch.headTurnId).has(c.recordedAtTurnId)||!pathFor(c.recordedAtTurnId).has(c.sourceTurnId)||!person||!pathFor(c.sourceTurnId).has(person.createdAtTurnId)||(c.resultBranchId&&!branchMap.has(c.resultBranchId)))throw new Error('人物纠错来源缺失或跨分支。');
  }
  return data;
}
export function importSave(repo:Repository,raw:string){
  const data=parseArchive(raw);
  const seedIds=new Set(data.scenarioSnapshot.characters.map(c=>c.stableId));
  const ids=new Map<string,string>(),map=(old:string)=>{if(seedIds.has(old)||old==='player'||!/^[0-9a-f-]{36}$/.test(old))return old;if(!ids.has(old))ids.set(old,crypto.randomUUID());return ids.get(old)!;};
  // Remap every UUID identity/reference, while leaving prose and quoted evidence byte-for-byte unchanged.
  const identityKeys=new Set(['id','saveId','branchId','parentTurnId','parentBranchId','forkTurnId','headTurnId','currentBranchId','sourceTurnId','recordedAtTurnId','cutoffTurnId','triggerTurnId','factId','atTurnId','requestId','sceneId','introducedScene','createdAtTurnId','createdByEventId','characterId','npcId','fromCharacterId','toCharacterId','knowerId','informationEventId','actorId','sourceEventId','validFromEventId','validUntilEventId','arrivedByEventId','establishedByEventId','endedByEventId','resultBranchId']);
  const identityArrays=new Set(['sourceTurnIds','factIds','knownBy','present','contacted','npcIds','candidates']);
  const walk=(value:unknown,key=''):unknown=>{
    if(key==='propagation'&&Array.isArray(value))return value.map(s=>{const text=String(s),colon=text.indexOf(':'),who=text.slice(0,colon);return colon>0&&NpcIdSchema.safeParse(who).success?map(who)+text.slice(colon):text;});
    if(Array.isArray(value))return identityArrays.has(key)?value.map(x=>map(x as string)):value.map(x=>walk(x));
    if(key==='scenarioSnapshot'||key==='scenarioSnapshots')return value;
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[/^[0-9a-f-]{36}$/.test(k)?map(k):k,walk(v,k)]));
    if(key==='subject'&&typeof value==='string'&&NpcIdSchema.safeParse(value).success)return map(value);
    return typeof value==='string'&&identityKeys.has(key)?map(value):value;
  };
  const copied=walk(data) as SavePayload;
  copied.save.title+=' · 导入';copied.save.createdAt=new Date().toISOString();
  repo.db.transaction(()=>{
    repo.scenarios.snapshot(copied.scenarioSnapshot);Object.values(copied.scenarioSnapshots).forEach(p=>repo.scenarios.snapshot(p));repo.putSave(copied.save as Save);copied.branches.forEach(b=>repo.putBranch(b as Branch));
    const pending=new Map(copied.turns.map(t=>[t.id,t])),inserted=new Set<string>();
    while(pending.size){let progress=false;for(const [id,t] of pending)if(!t.parentTurnId||inserted.has(t.parentTurnId)){repo.insertTurn(t as Turn);pending.delete(id);inserted.add(id);progress=true;}if(!progress)throw new Error('导入节点顺序无效。');}
    copied.bookmarks.forEach(b=>repo.putScoped('bookmarks',copied.save.id,b));
    copied.annotations.forEach(a=>repo.putScoped('annotations',copied.save.id,a));
    copied.ooc.forEach(o=>repo.putScoped('ooc_messages',copied.save.id,o));
    for(const c of copied.characterCorrections||[])repo.db.prepare('INSERT INTO character_corrections VALUES (?,?,?,?)').run(c.id,copied.save.id,c.sourceTurnId,JSON.stringify(c));
  })();
  return copied.save;
}
