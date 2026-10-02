import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { Repository } from '../../src/storage/repository';
import { TurnEngine } from '../../src/engine/engine';
import { MockProvider } from '../../src/llm/mock';
import { ProviderError } from '../../src/llm/types';
import type { TextRequest, TextResult } from '../../src/llm/types';
import { DEFAULT_PROFILES } from '../../src/llm/config';
import type { Extraction, Profile } from '../../src/domain/types';
import { CharacterService } from '../../src/characters/service';
import { characterWorld, resolveMentions } from '../../src/characters/world';
import { publicView } from '../../src/characters/public';
import { contextFor } from '../../src/memory/context';
import { closeScene, scheduleEvents } from '../../src/domain/rules';
import { exportSave, importSave, parseArchive, readingExport } from '../../src/storage/transfer';
import { emptyExtraction, inputFor, temporaryRepo } from '../helpers';

const repos:Repository[]=[];afterEach(()=>{for(const repo of repos.splice(0))if(repo.db.open)repo.close();});
class Scripted extends MockProvider {
  body='灯下安静。';extraction:Extraction=emptyExtraction();fail=false;calls=0;
  override async generateText(r:TextRequest):Promise<TextResult>{
    r.onAttempt?.();r.signal.throwIfAborted();this.calls++;
    if(r.system.startsWith('EXTRACTOR')&&this.fail)throw new ProviderError('TIMEOUT','整理超时夹具');
    return {text:r.system.startsWith('EXTRACTOR')?JSON.stringify(this.extraction):this.body,finishReason:'stop',usage:{input:0,output:0},requestCount:1,requestId:null};
  }
}
function setup(){
  const repo=temporaryRepo();repos.push(repo);const save=repo.createSave(),provider=new Scripted();let profile:Profile=DEFAULT_PROFILES[0];
  const engine=new TurnEngine(repo,{provider:()=>provider,secret:()=>'',profiles:()=>({narrator:profile,extractor:profile})});
  const service=new CharacterService(repo),view=()=>repo.view(save.id),world=()=>characterWorld(view().turns);
  const turn=async(playerText:string,body:string,extra:Partial<Extraction>={})=>{
    provider.body=body;provider.extraction={...emptyExtraction(),...extra};const input=inputFor(repo,save.id,playerText),draft=engine.start(input);await engine.wait(draft.id);return {draft:repo.draft(draft.id),input};
  };
  const ok=async(playerText:string,body:string,extra:Partial<Extraction>={})=>{const r=await turn(playerText,body,extra);expect(r.draft.error).toBeNull();expect(r.draft.status).toBe('committed');return r;};
  const add=async(name='陆衡',presence:'present'|'mentioned'='mentioned',draftRef='new:clerk')=>{
    const body=presence==='present'?name+'走进门来，在案前站定。': '来信提及军需吏'+name+'，尚待回信。';
    const c=creation(name,body,draftRef);c.presence=presence;
    const state=view().turns.at(-1)!.state;
    await ok(presence==='present'?'请'+name+'进来。':'看一看信。',body,{proposedCharacterCreations:[c],
      ...(presence==='present'?{sceneProposal:{minutes:0,location:state.location,weather:state.weather,present:[...state.present,draftRef],evidence:{blockId:'b0',quote:body}}}:{})});
    return world().find(c=>!c.seedKey&&c.name===name)!;
  };
  return {repo,save,engine,provider,service,view,world,turn,ok,add,setProfile:(p:Profile)=>{profile=p;}};
}
const creation=(name:string,body:string,draftRef='new:clerk'):NonNullable<Extraction['proposedCharacterCreations']>[number]=>({
  draftRef,name,referenceName:name,identity:'军需吏',identityStatus:'confirmed',roleInStory:'提供军需线索',motivation:null,
  relevance:'supporting',presence:'mentioned',location:null,knownBy:[],revealed:true,evidence:{blockId:'b0',quote:body},
});
function change(id:string,field:NonNullable<Extraction['proposedCharacterChanges']>[number]['field'],value:string,quote:string,extra:Partial<NonNullable<Extraction['proposedCharacterChanges']>[number]>={}){
  return {ref:'profile-change',characterId:id,field,value,operation:'add' as const,certainty:'confirmed' as const,actorId:null,reason:'本轮明示',knownBy:[],revealed:true,evidence:{blockId:'b0',quote},...extra};
}
function office(quote:string,extra:Partial<NonNullable<Extraction['proposedOfficeChanges']>[number]>={}){
  return {ref:'appointment',characterId:'shen_che',assignmentRef:'new-office',title:'军需总管',organization:'大曜',assignmentKind:'concurrent' as const,stage:'ordered' as const,authorityScope:[],actorId:'player',reason:'本轮任职记录',authorization:null,authorityEventId:null,knownBy:[],revealed:true,evidence:{blockId:'player',quote},...extra};
}
const wrap=(payload:unknown)=>JSON.stringify({payload,sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')});

describe('动态人物补充验收 01–18',()=>{
  it('01 creates a source-linked individual atomically and reuses an idempotent request',async()=>{
    const e=setup(),body='军需吏陆衡走进門来，在案前站定。';
    const r=await e.ok('问军需情形。',body,{proposedCharacterCreations:[creation('陆衡',body)]});
    const c=e.world().find(c=>c.name==='陆衡')!;
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);expect(c.firstMentionTurnId).toBe(r.draft.turnId);expect(c.firstAppearanceTurnId).toBeNull();
    expect(e.engine.start(r.input).turnId).toBe(r.draft.turnId);expect(e.engine.retry(r.draft.id,true).turnId).toBe(r.draft.turnId);
    expect(e.repo.all('characters')).toHaveLength(7);expect(e.view().turns).toHaveLength(2);
  });
  it('02 aliases keep the same ID, memory and promise references',async()=>{
    const e=setup(),c=await e.add(),body='陆衡也被同僚称作陆书吏。';
    await e.ok('承诺明日再查账。',body,{proposedCharacterChanges:[change(c.id,'alias','陆书吏',body)],facts:[{kind:'promise',subject:c.id,content:'承诺明日再查账。',knownBy:[],revealed:true,importance:4,evidence:{blockId:'player',quote:'承诺明日再查账。'}}]});
    expect(e.world().find(p=>p.id===c.id)?.aliases).toContain('陆书吏');expect(resolveMentions('问陆书吏',e.world())[0].resolvedId).toBe(c.id);
    expect(e.view().turns.at(-1)?.effects.facts[0].subject).toBe(c.id);expect(e.world().find(p=>p.id===c.id)?.pendingThreads).toContain('承诺明日再查账。');
  });
  it('03 same names and offices remain distinct and ambiguous mentions keep candidates',async()=>{
    const e=setup(),body='两封来信各提及一名叫陆衡的军需吏，分别隶属不同营。';
    await e.ok('辨认来信。',body,{proposedCharacterCreations:[creation('陆衡',body,'new:a'),creation('陆衡',body,'new:b')]});
    const people=e.world().filter(c=>c.name==='陆衡');expect(people).toHaveLength(2);expect(people[0].id).not.toBe(people[1].id);
    expect(resolveMentions('陆衡',people)[0]).toMatchObject({resolvedId:null,candidates:people.map(c=>c.id)});
    const quote='信中只写了陆大人，暂不能判定指的是谁。';
    await e.ok('暂不合并。',quote,{unresolvedMentions:[{ref:'unclear',label:'陆大人',candidates:people.map(c=>c.id),knownBy:[],revealed:true,evidence:{blockId:'b0',quote}}]});
    expect(e.service.book(e.save.id).unresolvedMentions[0].candidates).toHaveLength(2);
  });
  it('04 an anonymous witness reveals a name on the original ID, not in past views',async()=>{
    const e=setup(),body='蒙面证人在廊外等候。';
    await e.ok('问来意。',body,{proposedCharacterCreations:[{...creation('蒙面证人',body),name:null}]});
    const before=e.view().turns.at(-1)!,c=e.world().find(c=>c.name==='蒙面证人')!;
    const reveal='经籍册核对，蒙面证人的真名确为周衡。';
    await e.ok('核对籍册。',reveal,{proposedCharacterChanges:[change(c.id,'name','周衡',reveal)]});
    expect(e.world().find(p=>p.id===c.id)?.name).toBe('周衡');
    expect(JSON.stringify(e.service.book(e.save.id,e.view().branch.id,before.id))).not.toContain('周衡');
    expect(e.repo.all('characters')).toHaveLength(7);
  });
  it('05 proposals do not appoint; explicit player orders and later activation have separate sources',async()=>{
    const e=setup(),proposal='考虑让沈彻兼任军需总管。';
    await e.ok(proposal,'文书尚未落定。',{proposedOfficeChanges:[office(proposal,{stage:'proposed'})]});
    const proposed=e.world()[0].offices.find(o=>o.title==='军需总管')!;expect(proposed.stage).toBe('proposed');
    const bad=await e.turn('先听意见。','沈彻军需总管的任命据说已下令。',{proposedOfficeChanges:[office('沈彻军需总管的任命据说已下令。',{assignmentRef:proposed.id,evidence:{blockId:'b0',quote:'沈彻军需总管的任命据说已下令。'}})]});
    expect(bad.draft.status).toBe('failed');e.engine.cancel(bad.draft.id);
    const command='任命沈彻兼任军需总管。';
    await e.ok(command,'文书按原令登记，生效手续待办。',{proposedOfficeChanges:[office(command,{assignmentRef:proposed.id})]});
    const ordered=e.world()[0].offices.find(o=>o.id===proposed.id)!;expect(ordered.stage).toBe('ordered');
    const body='沈彻兼任军需总管的任命正式生效。';
    await e.ok('查看手续。',body,{proposedOfficeChanges:[office(body,{assignmentRef:ordered.id,stage:'active',evidence:{blockId:'b0',quote:body}})]});
    expect(e.world()[0].offices.find(o=>o.id===ordered.id)?.stage).toBe('active');
    expect(e.world()[0].timeline.filter(t=>t.kind==='office'&&t.data.title==='军需总管')).toHaveLength(3);
  });
  it('06 a promotion preserves scores, promises and original prose and updates narrator titles',async()=>{
    const e=setup(),old=e.view().turns[0],before=structuredClone(old.state.relationships);
    const quote='任命沈彻兼任军需总管，即日起生效。';
    await e.ok(quote,'军需总管的文书依照原令登记。',{proposedOfficeChanges:[office(quote),office(quote,{ref:'activation',stage:'active'})]});
    expect(e.view().turns.at(-1)!.state.relationships).toEqual(before);expect(e.repo.turn(old.id).body).toBe(old.body);
    expect(e.view().turns.at(-1)!.state.pendingThreads).toEqual(old.state.pendingThreads);
    const ctx=JSON.parse(contextFor(e.view().turns,'问沈彻',null).system);expect(ctx.layer3.characters.find((c:{id:string})=>c.id==='shen_che').role).toContain('军需总管');
  });
  it.each(['substantive','acting','concurrent','commission','honorary'] as const)('07 preserves assignment kind %s and no authority from a bare title',async kind=>{
    const e=setup(),quote='任命沈彻兼任军需总管。';
    await e.ok(quote,'文书待生效。',{proposedOfficeChanges:[office(quote,{assignmentKind:kind})]});
    expect(e.world()[0].offices.at(-1)).toMatchObject({assignmentKind:kind,stage:'ordered',authorityScope:[]});
  });
  it('07 rejects appointments by an NPC without authority and honorary powers',async()=>{
    const e=setup(),body='顾青崖任命沈彻为军需总管。';
    const r=await e.turn('等候消息。',body,{proposedOfficeChanges:[office(body,{actorId:'gu_qingya',evidence:{blockId:'b0',quote:body}})]});
    expect(r.draft.error).toMatch(/职权|授权/);expect(e.view().turns).toHaveLength(1);
  });
  it('08 a remote appointment changes no location or presence',async()=>{
    const e=setup(),quote='授予拓跋野北境盟使荣誉称号。';
    await e.ok(quote,'册书尚待送出。',{proposedOfficeChanges:[office(quote,{characterId:'tuoba_ye',title:'北境盟使',assignmentKind:'honorary'})]});
    expect(e.view().turns.at(-1)!.state.present).toEqual([]);expect(e.world().find(c=>c.id==='tuoba_ye')?.location).toBeNull();
  });
  it('09 self-claimed identity confers no office; disclosure updates only actual recipients',async()=>{
    const e=setup(),body='赵平自称督粮官。';
    await e.ok('听其来意。',body,{proposedCharacterCreations:[{...creation('赵平',body),identity:'督粮官',identityStatus:'claim'}]});
    const c=e.world().find(c=>c.name==='赵平')!;expect(c.offices).toHaveLength(0);expect(c.notes[0].certainty).toBe('claim');expect(c.identity).toBe('自称：督粮官');
    const text='调查簿确认赵平实际身份为边营信使。';
    await e.ok('查验文书。',text,{proposedCharacterChanges:[change(c.id,'identity','边营信使',text,{revealed:true,knownBy:[c.id]})]});
    const secret=e.view().turns.at(-1)!.effects.characterEvents![0];
    expect(characterWorld(e.view().turns,'gu_qingya').some(p=>p.id===c.id)).toBe(false);
    const delivery='顾青崖收到核验文书，获知赵平的身份。';
    await e.ok('等回报。',delivery,{proposedKnowledgeChanges:[{ref:'delivery',knowerId:'gu_qingya',aboutCharacterId:c.id,informationEventRef:secret.id,certainty:'known',path:'letter',knownBy:[],revealed:true,evidence:{blockId:'b0',quote:delivery}}]});
    expect(characterWorld(e.view().turns,'gu_qingya').find(p=>p.id===c.id)?.identity).toBe('边营信使');
    expect(characterWorld(e.view().turns,'shen_che').some(p=>p.id===c.id)).toBe(false);
    expect(e.world().find(p=>p.id===c.id)?.identity).toBe('边营信使');
  });
  it('10 supporting characters have no romance bars or seed neglect triggers',async()=>{
    const e=setup(),c=await e.add('陆衡','present');expect(c.romancePolicy).toBe('disabled');
    let state=e.view().turns.at(-1)!.state;for(let i=0;i<4;i++)state=closeScene(state);
    expect(scheduleEvents(state,crypto.randomUUID(),e.repo.scenarios.fromSnapshot(e.save.scenarioSnapshotHash)).events.some(ev=>ev.npcIds.includes(c.id))).toBe(false);
    expect(state.relationships[c.id]).toBeUndefined();expect(state.neglect[c.id]).toBeUndefined();
  });
  it('11 follow is UI-only; explicit adult route configuration keeps the ID and memories',async()=>{
    const e=setup(),c=await e.add(),before=exportSave(e.repo,e.save.id);
    e.service.follow({saveId:e.save.id,branchId:e.view().branch.id,characterId:c.id,followed:true});expect(exportSave(e.repo,e.save.id)).toEqual(before);
    const policy=()=>({saveId:e.save.id,branchId:e.view().branch.id,characterId:c.id,expectedHeadTurnId:e.view().branch.headTurnId,clientRequestId:crypto.randomUUID(),romancePolicy:'available',confirmed:true});
    expect(()=>e.service.policy(policy())).toThrow(/成年/);
    const body='籍册核对陆衡年龄为26岁。';await e.ok('核对年岁。',body,{proposedCharacterChanges:[change(c.id,'age','26',body)]});
    const state=structuredClone(e.view().turns.at(-1)!.state),notes=e.world().find(p=>p.id===c.id)!.notes;
    const turn=e.service.policy(policy());expect(turn.kind).toBe('configuration');expect(turn.state).toEqual({...state,romancePolicies:{...state.romancePolicies,[c.id]:'available'}});
    expect(e.world().find(p=>p.id===c.id)).toMatchObject({id:c.id,romancePolicy:'available',notes});
  });
  it('12/13 forks and past search exclude future people, appointments and names',async()=>{
    const e=setup(),root=e.view().turns[0];await e.add('未来人物');
    const appointment='任命沈彻兼任军需总管。';await e.ok(appointment,'文书候办。',{proposedOfficeChanges:[office(appointment)]});
    const secret='信封收入暗格。';await e.ok('等回报。',secret,{proposedCharacterChanges:[change('shen_che','motivation','未来动机哨兵',secret,{revealed:false,knownBy:['shen_che']})]});
    const future=e.view().turns.at(-1)!.id,originalBranch=e.view().branch.id;
    const branch=e.repo.fork(e.save.id,originalBranch,root.id,'过去分支');
    expect(e.world()).toHaveLength(6);expect(e.service.book(e.save.id,branch.id,undefined,'未来')).toMatchObject({characters:[]});
    expect(()=>e.service.book(e.save.id,branch.id,future)).toThrow(/可见路径/);
    expect(contextFor(e.view().turns,'说一说',null).system).not.toContain('未来人物');
    expect(contextFor(e.view().turns,'问沈彻',null).system).not.toMatch(/军需总管|未来动机哨兵/);expect(e.world()[0].offices).toHaveLength(1);
  });
  it('14 validation failure and transaction failure cannot leave orphan people',async()=>{
    const e=setup(),body='军需吏陆衡等候。';
    const r=await e.turn('听候。',body,{proposedCharacterCreations:[{...creation('陆衡',body),evidence:{blockId:'b0',quote:'不存在的证据'}}]});
    expect(r.draft.status).toBe('failed');expect(r.draft.body).toBe(body);expect(e.repo.all('characters')).toHaveLength(6);expect(e.view().turns).toHaveLength(1);
    e.provider.extraction={...emptyExtraction(),proposedCharacterCreations:[creation('陆衡',body)]};
    const original=e.repo.commit.bind(e.repo);e.repo.commit=(draft,turn)=>original(draft,turn,true);
    e.engine.retry(r.draft.id,true);await e.engine.wait(r.draft.id);expect(e.repo.all('characters')).toHaveLength(6);expect(e.view().turns).toHaveLength(1);
    e.repo.commit=original;e.engine.retry(r.draft.id,true);await e.engine.wait(r.draft.id);expect(e.world().filter(c=>c.name==='陆衡')).toHaveLength(1);
  });
  it('15 export/import restores characters, careers, relationships and remapped references without keys',async()=>{
    const e=setup(),a=await e.add('陆衡'),b=await e.add('周宁');const body='陆衡与周宁确认二人为兄弟。';
    await e.ok('核对亲属。',body,{proposedRelationshipChanges:[{ref:'family',fromCharacterId:a.id,toCharacterId:b.id,relationshipRef:'brothers',category:'objective',relationshipType:'family',description:'兄弟',operation:'establish',knownBy:[],revealed:true,evidence:{blockId:'b0',quote:body}}]});
    const archive=exportSave(e.repo,e.save.id);expect(archive.payload.visibility).toBe('full-restore-includes-hidden');expect(JSON.stringify(archive)).not.toMatch(/API_KEY|apiKey|fixture-secret/);
    const copy=importSave(e.repo,JSON.stringify(archive)),world=characterWorld(e.repo.view(copy.id).turns),aa=world.find(c=>c.name==='陆衡')!,bb=world.find(c=>c.name==='周宁')!;
    expect(aa.id).not.toBe(a.id);expect(aa.relations[0]).toMatchObject({fromCharacterId:aa.id,toCharacterId:bb.id});expect(world.find(c=>c.id==='shen_che')).toBeDefined();
    expect(()=>parseArchive(JSON.stringify(exportSave(e.repo,copy.id)))).not.toThrow();
    const malformed=structuredClone(archive.payload);malformed.turns.at(-1)!.effects.characterEvents!.find(c=>c.kind==='relationship')!.data={...aa.relations[0],toCharacterId:crypto.randomUUID()};
    expect(()=>parseArchive(wrap(malformed))).toThrow(/人物/);
  });
  it('16 changing provider preserves the roster, offices and previous promises',async()=>{
    const e=setup();await e.add();const before=e.world();e.setProfile(DEFAULT_PROFILES[2]);await e.ok('等一等。','廊下安静。');
    expect(e.world().map(c=>({id:c.id,offices:c.offices,notes:c.notes}))).toEqual(before.map(c=>({id:c.id,offices:c.offices,notes:c.notes})));
  });
  it('17 old v1 database migration snapshots first and preserves payloads and seed references',()=>{
    const original=setup(),source=exportSave(original.repo,original.save.id).payload;
    mkdirSync('.test-data',{recursive:true});const dir=mkdtempSync(path.resolve('.test-data','legacy-')),db=new Database(path.join(dir,'dayao.sqlite'));
    db.exec(readFileSync('migrations/001_initial.sql','utf8'));
    db.prepare('INSERT INTO saves VALUES (?,?)').run(source.save.id,JSON.stringify(source.save));
    for(const b of source.branches)db.prepare('INSERT INTO branches VALUES (?,?,?,?)').run(b.id,b.saveId,b.headTurnId,JSON.stringify(b));
    const t=structuredClone(source.turns[0]);delete t.effects.characters;delete t.effects.characterEvents;
    const payload=JSON.stringify(t);db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?)').run(t.id,t.saveId,t.parentTurnId,t.branchId,t.requestId,payload);db.close();
    const upgraded=new Repository(dir);repos.push(upgraded);
    expect(upgraded.db.pragma('user_version',{simple:true})).toBe(3);
    expect(upgraded.turn(t.id)).toMatchObject({id:t.id,body:t.body,playerText:t.playerText,parentTurnId:t.parentTurnId,branchId:t.branchId,requestId:t.requestId});
    expect(upgraded.save(source.save.id)).toMatchObject({scenarioPackageId:'dayao_empress',scenarioVersion:'1.0.0'});
    expect(characterWorld(upgraded.view(source.save.id).turns).map(c=>c.id)).toEqual(original.world().map(c=>c.id));
    expect(upgraded.turn(t.id).state.relationships).toEqual(t.state.relationships);expect(upgraded.turn(t.id).effects.facts).toEqual(t.effects.facts);
    const backup=readdirSync(dir).find(n=>n.startsWith('before-characters-v2-'))!;expect(backup).toBeTruthy();
    const snapshot=new Database(path.join(dir,backup),{readonly:true});expect(snapshot.pragma('user_version',{simple:true})).toBe(1);expect(snapshot.prepare('SELECT payload FROM turns').get()).toEqual({payload});snapshot.close();
    const legacy=structuredClone(source) as Record<string,unknown>;legacy.schemaVersion=1;delete legacy.visibility;delete legacy.characterCorrections;legacy.turns=[t];
    const restored=importSave(original.repo,wrap(legacy));expect(characterWorld(original.repo.view(restored.id).turns)).toHaveLength(6);
  });
  it('18 private motivation and unconfirmed hidden identity cannot leak through roster, view, preview, or search',async()=>{
    const e=setup(),body='军需吏陆衡在廊外等候。',sentinel='不可公开的动机哨兵';
    await e.ok('听候。',body,{proposedCharacterCreations:[{...creation('陆衡',body),motivation:sentinel}]});
    const c=e.world().find(c=>c.name==='陆衡')!;
    expect(JSON.stringify(characterWorld(e.view().turns,'narrator'))).toContain(sentinel);
    expect(JSON.stringify(e.service.book(e.save.id))).not.toContain(sentinel);expect(e.service.book(e.save.id,undefined,undefined,sentinel).characters).toHaveLength(0);
    expect(JSON.stringify(publicView(e.view()))).not.toContain(sentinel);expect(JSON.stringify(contextFor(e.view().turns,'问陆衡',c.id).preview)).not.toContain(sentinel);
    expect(readingExport(e.save.title,e.view().turns)).not.toContain(sentinel);expect(JSON.stringify(exportSave(e.repo,e.save.id))).toContain(sentinel);
    // Internal identity speculation is deliberately unconfirmed; this asserts projection, not narrative truth.
    const clue='来信出自未署名写信人。',hidden='隐名哨兵丁九';
    await e.ok('收好来信。',clue,{proposedCharacterCreations:[{...creation(hidden,clue,'new:unknown'),referenceName:'未署名写信人',identity:'疑为内廷密使',identityStatus:'suspicion',presence:'hidden',revealed:false,knownBy:[]}]});
    expect(JSON.stringify(exportSave(e.repo,e.save.id))).toContain(hidden);
    expect(e.service.book(e.save.id).characters).toHaveLength(7);expect(JSON.stringify(e.service.book(e.save.id))).not.toContain(hidden);
    expect(e.service.book(e.save.id,undefined,undefined,hidden).characters).toHaveLength(0);expect(JSON.stringify(publicView(e.view()))).not.toContain(hidden);
    expect(JSON.stringify(contextFor(e.view().turns,'问陆衡',c.id).preview)).not.toContain(hidden);expect(readingExport(e.save.title,e.view().turns)).not.toContain(hidden);
  });
  it.each(['是否任命沈彻兼任军需总管？','不要任命沈彻兼任军需总管。','如果任命沈彻兼任军需总管，还需讨论。'])('does not launder a hypothetical or negated player quote: %s',async input=>{
    const e=setup(),quote='任命沈彻兼任军需总管';
    const r=await e.turn(input,'文书尚待讨论。',{proposedOfficeChanges:[office(input,{authorization:{sourceTurnId:null,evidence:{blockId:'player',quote}}})]});
    expect(r.draft.status).toBe('failed');expect(e.world()[0].offices).toHaveLength(1);
  });
  it('arrival and departure retain their own sources and do not move the character into the room',async()=>{
    const e=setup(),input='任命沈彻兼任军需总管，即日起生效。';
    await e.ok(input,'文书已核。',{proposedOfficeChanges:[office(input),office(input,{ref:'activated',stage:'active'})]});
    const assignment=e.world()[0].offices.find(o=>o.title==='军需总管')!;
    const arrived='沈彻抵达北营，军需总管正式到任。';
    await e.ok('等候到任消息。',arrived,{proposedOfficeChanges:[office(arrived,{assignmentRef:assignment.id,stage:'arrived',evidence:{blockId:'b0',quote:arrived}})],proposedCharacterChanges:[change('shen_che','location','北营',arrived)]});
    expect(e.world()[0]).toMatchObject({location:'北营',availability:'elsewhere'});expect(e.view().turns.at(-1)!.state.present).toEqual([]);
    const ended='免去沈彻军需总管一职。';await e.ok(ended,'文書已登记。',{proposedOfficeChanges:[office(ended,{assignmentRef:assignment.id,stage:'ended'})]});
    const last=e.world()[0].offices.find(o=>o.id===assignment.id)!;
    expect(last).toMatchObject({stage:'ended'});expect(last.validFromEventId).toBeTruthy();expect(last.arrivedByEventId).toBeTruthy();expect(last.validUntilEventId).toBeTruthy();
    const restored=importSave(e.repo,JSON.stringify(exportSave(e.repo,e.save.id)));expect(characterWorld(e.repo.view(restored.id).turns)[0].offices.at(-1)?.stage).toBe('ended');
  });
  it('earlier explicit delegation allows a scoped NPC appointment, not arbitrary titles',async()=>{
    const e=setup(),authorization='授权顾青崖全权任免大曜属官。';await e.ok(authorization,'文书记下所授范围。');
    const source=e.view().turns.at(-1)!.id,body='顾青崖任命沈彻兼任军需总管。';
    await e.ok('听候回报。',body,{proposedOfficeChanges:[office(body,{actorId:'gu_qingya',authorization:{sourceTurnId:source,evidence:{blockId:'player',quote:authorization}},evidence:{blockId:'b0',quote:body}})]});
    expect(e.world()[0].offices.at(-1)?.stage).toBe('ordered');
  });
  it('objective relationships and one-sided attitudes never create reciprocal trust',async()=>{
    const e=setup(),a=await e.add('陆衡'),b=await e.add('周宁'),body='陆衡对周宁抱有戒心。';
    await e.ok('观察。',body,{proposedRelationshipChanges:[{ref:'attitude',fromCharacterId:a.id,toCharacterId:b.id,relationshipRef:'watchful',category:'attitude',relationshipType:'rival',description:'抱有戒心',operation:'establish',knownBy:[a.id],revealed:true,evidence:{blockId:'b0',quote:body}}]});
    expect(e.world().find(c=>c.id===b.id)!.relations).toHaveLength(1);
    expect(characterWorld(e.view().turns,b.id).flatMap(c=>c.relations)).toHaveLength(0);
    expect(e.view().turns.at(-1)!.state.relationships[b.id]).toBeUndefined();
  });
  it('corrections are audited and a correction branch excludes the original future',async()=>{
    const e=setup(),c=await e.add(),source=c.firstMentionTurnId;await e.ok('继续等候。','灯下静了一阵。');
    const before=exportSave(e.repo,e.save.id),r=e.service.correct({saveId:e.save.id,branchId:e.view().branch.id,characterId:c.id,sourceTurnId:source,category:'identity',note:'这次认错了人，需从来源修订。',fork:true});
    expect(r.branch).not.toBeNull();expect(e.world()).toHaveLength(6);expect(e.repo.all('character_corrections')).toHaveLength(1);
    expect(e.repo.turn(source).body).toBe(before.payload.turns.find(t=>t.id===source)!.body);
    expect(()=>parseArchive(JSON.stringify(exportSave(e.repo,e.save.id)))).not.toThrow();
  });
  it('migration failure rolls back its DDL and preserves the original v1 database and snapshot',()=>{
    mkdirSync('.test-data',{recursive:true});const dir=mkdtempSync(path.resolve('.test-data','migration-failure-')),db=new Database(path.join(dir,'dayao.sqlite'));
    db.exec(readFileSync('migrations/001_initial.sql','utf8'));db.exec('CREATE TABLE character_events (sentinel TEXT)');db.prepare('INSERT INTO character_events VALUES (?)').run('原有资料');db.close();
    expect(()=>new Repository(dir)).toThrow();const after=new Database(path.join(dir,'dayao.sqlite'),{readonly:true});
    expect(after.pragma('user_version',{simple:true})).toBe(1);expect(after.prepare('SELECT * FROM character_events').all()).toEqual([{sentinel:'原有资料'}]);
    expect(after.prepare("SELECT name FROM sqlite_master WHERE name='characters'").get()).toBeUndefined();after.close();
    expect(readdirSync(dir).some(n=>n.startsWith('before-characters-v2-'))).toBe(true);
  });
  it('groups are not individuals and missing career extraction keeps inconsistent prose as draft',async()=>{
    const e=setup(),body='百姓们聚在城外。';const group=await e.turn('看看。',body,{proposedCharacterCreations:[creation('百姓们',body)]});
    expect(group.draft.error).toMatch(/群体/);e.engine.cancel(group.draft.id);
    const career=await e.turn('等一等。','沈彻军需总管的任命正式生效。');expect(career.draft.error).toMatch(/履历/);expect(e.view().turns).toHaveLength(1);
  });
  it('profile histories retain the previous value, including multiple changes in one turn',async()=>{
    const e=setup(),c=await e.add(),body='陆衡先停在北营，随后又抵达西营。';
    await e.ok('等回信。',body,{proposedCharacterChanges:[change(c.id,'location','北营',body),change(c.id,'location','西营',body,{ref:'second-location'})]});
    const events=e.view().turns.at(-1)!.effects.characterEvents!.filter(t=>t.kind==='profile');
    expect(events[0].before).toEqual({location:null});expect(events[1].before).toEqual({location:'北营'});
    expect(e.world().find(p=>p.id===c.id)?.location).toBe('西营');
  });
  it('a later correction does not appear in a prior-node projection',async()=>{
    const e=setup(),c=await e.add(),at=e.view().branch.headTurnId;await e.ok('继续等候。','灯影安静。');
    e.service.correct({saveId:e.save.id,branchId:e.view().branch.id,characterId:c.id,sourceTurnId:at,category:'history',note:'后来才获知的更正。',fork:false});
    expect(e.service.book(e.save.id).corrections).toHaveLength(1);expect(e.service.book(e.save.id,undefined,at).corrections).toHaveLength(0);
  });
  it('dismissal rebuilds stale character summaries without changing original text',async()=>{
    const e=setup(),root=e.view().turns[0],input='免去顾青崖御史大夫一职。',c=e.world().find(p=>p.id==='gu_qingya')!,job=c.offices[0];
    const summary={id:crypto.randomUUID(),sourceTurnIds:[root.id],cutoffTurnId:root.id,content:'顾青崖目前任御史大夫。',version:1};
    root.effects.summaries.push(summary);e.repo.db.prepare('UPDATE turns SET payload=? WHERE id=?').run(JSON.stringify(root),root.id);
    await e.ok(input,'文书记下免职事宜。',{proposedOfficeChanges:[office(input,{characterId:c.id,assignmentRef:job.id,title:job.title,assignmentKind:job.assignmentKind,stage:'ended'})]});
    const ctx=JSON.parse(contextFor(e.view().turns,'问顾青崖',c.id).system);
    expect(ctx.layer3.characters.find((n:{id:string})=>n.id===c.id).role).toBe('暂无生效职务');expect(ctx.layer3.rebuiltSummaries).toBeGreaterThan(0);
    expect(JSON.stringify(ctx.layer3.summaries)).not.toContain('目前任御史大夫');expect(e.repo.turn(root.id).effects.summaries).toContainEqual(summary);
  });
  it('an appointment cannot be inverted into a dismissal or treat not-yet-active as active',async()=>{
    const e=setup(),original=e.world()[0].offices[0],input='任命沈彻为镇北将军。';
    const wrong=await e.turn(input,'文书待办。',{proposedOfficeChanges:[office(input,{assignmentRef:original.id,title:original.title,assignmentKind:original.assignmentKind,stage:'ended'})]});
    expect(wrong.draft.error).toMatch(/免职/);e.engine.cancel(wrong.draft.id);
    const order='任命沈彻兼任军需总管。';await e.ok(order,'任职命令已登记。',{proposedOfficeChanges:[office(order)]});
    const pending=e.world()[0].offices.at(-1)!,body='沈彻兼任军需总管的任命尚未生效。';
    const early=await e.turn('查进展。',body,{proposedOfficeChanges:[office(body,{assignmentRef:pending.id,stage:'active',evidence:{blockId:'b0',quote:body}})]});
    expect(early.draft.error).toMatch(/未生效/);expect(e.world()[0].offices.at(-1)?.stage).toBe('ordered');
  });
});
