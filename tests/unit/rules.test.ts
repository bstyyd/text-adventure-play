import { describe,it,expect } from 'vitest';
import { NewGameSchema,ExtractionSchema } from '../../src/domain/types';
import { initialState,PROLOGUE,publicNpcs,npcIds } from '../../src/content/canon';
import { advanceDate as rawAdvance,gameDate as rawDate,dayKey } from '../../src/domain/calendar';
import { scheduleEvents as rawSchedule,closeScene,canIntroduce as rawIntroduce,applyRelation as rawRelation } from '../../src/domain/rules';
import { validateAndReduce } from '../../src/engine/validate';
import { parseExtraction } from '../../src/engine/engine';
import { emptyExtraction } from '../helpers';
import type { Turn } from '../../src/domain/types';
import { emptyEffects } from '../../src/storage/repository';
import {builtInScenario} from '../../src/scenario/package';
import {attachScenario} from '../../src/scenario/runtime';
const scenario=builtInScenario();
const scheduleEvents=(s:Parameters<typeof rawSchedule>[0],id:string)=>rawSchedule(s,id,scenario);
const canIntroduce=(e:Parameters<typeof rawIntroduce>[0],s:Parameters<typeof rawIntroduce>[1])=>rawIntroduce(e,s,scenario);
const applyRelation=(...args:Parameters<typeof rawRelation> extends [...infer T,unknown]?T:never)=>rawRelation(...args,scenario);
const gameDate=(y:number,m:number,d:number,min=1380)=>rawDate(y,m,d,min,scenario.calendar);
const advanceDate=(d:Parameters<typeof rawAdvance>[0],min:number)=>rawAdvance(d,min,scenario.calendar);
const initial=()=>initialState(NewGameSchema.parse({}));
describe('开局 A01 A02 C09 D10 D11',()=>{
  it('preserves canonical prologue and all six exact values',()=>{
    const s=initial();expect(npcIds.map(n=>[s.relationships[n].values.trust,s.relationships[n].values.affection])).toEqual([[70,50],[25,30],[15,20],[55,35],[40,55],[45,40]]);
    expect(s.present).toEqual([]);expect(s.originRegion).toBeNull();expect(s.date.day).toBe(28);expect(s.date.absoluteDay-s.accessionDay).toBe(2);
    expect(PROLOGUE.endsWith('门外传来脚步声。')).toBe(true);expect(JSON.stringify(publicNpcs())).not.toMatch(/烧掉|密令|私人副本/);
  });
  it('calendar rolls over month and year numerically',()=>{
    expect(advanceDate(gameDate(1,3,30,1439),1)).toMatchObject({year:1,month:4,day:1,minuteOfDay:0,period:'子时'});
    expect(advanceDate(gameDate(1,12,30,1439),1)).toMatchObject({year:2,month:1,day:1});
    expect(dayKey('1-4-1')).toBe(90);expect(()=>gameDate(1,2,31)).toThrow();expect(()=>dayKey('四月初一')).toThrow();
  });
  it('new defaults are isolated from existing snapshots',()=>{const old=initial();const changed=initialState({day:29});expect(old.date.day).toBe(28);expect(changed.date.day).toBe(29);});
});
describe('严格双轨与事件 E01–E15',()=>{
  it.each([70,71])('boundary threshold %i is strict',value=>{const s=initial();s.relationships.shen_che.values.affection=value;expect(scheduleEvents(s,'t').events.some(e=>e.type==='boundary')).toBe(value>70);});
  it.each([[80,61,false],[81,60,false],[81,61,true]] as const)('vulnerability %i/%i', (trust,affection,expected)=>{const s=initial();s.relationships.shen_che={values:{trust,affection},status:''};expect(scheduleEvents(s,'t').events.some(e=>e.type==='vulnerability')).toBe(expected);});
  it.each([[60,61,false],[61,61,true]] as const)('pair conflict %i/%i',(a,b,expected)=>{const s=initial();s.relationships.shen_che.values.affection=a;s.relationships.gu_qingya.values.affection=b;expect(scheduleEvents(s,'t').events.some(e=>e.type==='conflict')).toBe(expected);});
  it('queues but does not teleport or force acceptance',()=>{const s=initial();s.relationships.tuoba_ye.values.affection=80;const result=scheduleEvents(s,'t');expect(result.present).toEqual([]);expect(canIntroduce(result.events[0],result)).toBe(false);expect(result.events[0].status).toBe('queued');});
  it('neglect is counted in eligible scenes, not messages',()=>{let s=initial();s.present=['shen_che'];s.messageCount=20;expect(scheduleEvents(s,'t').neglect.shen_che).toBeUndefined();for(let i=0;i<3;i++)s=closeScene(s);s=scheduleEvents(s,'t');expect(s.events.some(e=>e.type==='contact')).toBe(true);expect(s.neglect.tuoba_ye).toBeUndefined();});
  it('responding in a scene resets neglect',()=>{const s=initial();s.present=['shen_che'];s.neglect.shen_che=2;s.contacted=['shen_che'];expect(closeScene(s).neglect.shen_che).toBe(0);});
  it('rumor requires distinct exceptions and propagation opportunity',()=>{let s=initial();s.exceptions.shen_che=['a','b'];expect(scheduleEvents(s,'t').events.some(e=>e.type==='rumor')).toBe(false);s.exceptions.shen_che=['a','b','c'];s=scheduleEvents(s,'t');expect(canIntroduce(s.events[0],s)).toBe(false);});
  it('one-time event keys and one introduction per scene',()=>{let s=initial();s.present=['shen_che'];s.relationships.shen_che.values.affection=80;s=scheduleEvents(s,'t');const e=s.events[0];e.status='resolved';s.eventKeys.push(e.key);s=scheduleEvents(s,'t2');expect(s.events.filter(x=>x.key===e.key)).toHaveLength(1);e.introducedScene=s.sceneId;expect(canIntroduce({...e,status:'queued'},s)).toBe(false);});
  it('axes independent; clamps scores, scene deltas and duplicate keys',()=>{let s=initial();s.relationships.shen_che.values.trust=99;for(let i=0;i<10;i++)s=applyRelation(s,'shen_che','trust','positive','key'+i);expect(s.relationships.shen_che.values.trust).toBe(100);expect(s.sceneDeltas['shen_che:trust']).toBe(5);expect(s.relationships.shen_che.values.affection).toBe(50);expect(applyRelation(s,'shen_che','trust','negative','key0')).toEqual(s);});
  it('schema rejects direct score setting, unknown NPC, unknown fields',()=>{const x=emptyExtraction();expect(()=>ExtractionSchema.parse({...x,score:100})).toThrow();expect(()=>ExtractionSchema.parse({...x,relationshipEvidence:[{npcId:'intruder',trust:100}]})).toThrow();});
});
describe('证据、权限和时序 A03–A06 C01–C07 G02',()=>{
  const validate=(input:string,body:string,x=emptyExtraction(),s=initial())=>{
    const root:Turn={id:crypto.randomUUID(),saveId:crypto.randomUUID(),branchId:crypto.randomUUID(),parentTurnId:null,requestId:crypto.randomUUID(),
      state:s,effects:emptyEffects(),playerText:'',body:PROLOGUE,createdAt:new Date().toISOString(),provider:'mock',model:'fixed-prologue',usage:{input:0,output:0},requestCount:0};
    return validateAndReduce(s,input,body,x,crypto.randomUUID(),[attachScenario(root,scenario)]);
  };
  it.each(['玄天华决定赐婚。','女帝答应了。','她心想，何不答应。','你接受他的拥抱。'])('leaves wording review to the player without inventing structured consent: %s',body=>{
    const result=validate('让沈彻进来',body);expect(result.effects.facts).toEqual([]);expect(result.state.relationships).toEqual(initial().relationships);
  });
  it('still rejects invented structured player decisions sourced only from model prose',()=>{
    const x=emptyExtraction();x.facts=[{kind:'confirmed_event',subject:'玄天华',content:'亲自出征',knownBy:[],revealed:true,importance:3,evidence:{blockId:'b0',quote:'玄天华决定亲自出征。'}}];
    expect(()=>validate('等一等','玄天华决定亲自出征。',x)).toThrow(/玩家原文授权/);
  });
  it('allows NPC waiting for an answer',()=>expect(()=>validate('等一等','沈彻伸出手，却停在半空，等候回应。')).not.toThrow());
  it('rejects fabricated evidence',()=>{const x=emptyExtraction();x.facts=[{kind:'claim',subject:'沈彻',content:'消息',knownBy:[],revealed:true,importance:1,evidence:{blockId:'nonexistent',quote:'有消息'}}];expect(()=>validate('问','沈彻未答。',x)).toThrow(/证据/);x.facts[0].evidence={blockId:'b0',quote:'假引文'};expect(()=>validate('问','沈彻未答。',x)).toThrow(/证据/);});
  it.each(['明日再查','可能存在虚报','怀疑来历'])('does not convert %s to confirmed fact',input=>{const x=emptyExtraction();x.facts=[{kind:'confirmed_event',subject:'账目',content:'已查明',knownBy:[],revealed:true,importance:3,evidence:{blockId:'player',quote:input}}];expect(()=>validate(input,'还须等待。',x)).toThrow(/计划|传闻/);});
  it('private thoughts are not speech',()=>{const x=emptyExtraction(),s=initial();s.present=['shen_che'];x.facts=[{kind:'belief',subject:'玄天华',content:'秘密',knownBy:['shen_che'],revealed:true,importance:3,evidence:{blockId:'player',quote:'我心想这是秘密'}}];expect(()=>validate('我心想这是秘密','沈彻等候。',x,s)).toThrow(/内心/);});
  it('absent NPC knowledge needs propagation',()=>{const x=emptyExtraction();x.facts=[{kind:'claim',subject:'账目',content:'线索',knownBy:['gu_qingya'],revealed:true,importance:3,evidence:{blockId:'b0',quote:'第三镇'}}];expect(()=>validate('问账','沈彻提起第三镇。',x)).toThrow(/知情|认知/);});
  it('sending a letter is not delivery',()=>{const x=emptyExtraction();x.facts=[{kind:'claim',subject:'账目',content:'线索',knownBy:[],revealed:true,importance:3,evidence:{blockId:'b0',quote:'信件寄往顾青崖'}}];x.knowledgeProposals=[{npcId:'gu_qingya',factIndex:0,path:'letter',evidence:{blockId:'b0',quote:'信件寄往顾青崖'}}];expect(()=>validate('传信','信件寄往顾青崖。',x)).toThrow(/送达/);});
  it('large jumps and midnight crossing need authorization',()=>{const x=emptyExtraction(),s=initial();x.sceneProposal={minutes:240,location:s.location,weather:s.weather,present:[],evidence:{blockId:'player',quote:'聊一聊'}};expect(()=>validate('聊一聊','夜深。',x)).toThrow(/时间/);s.date=gameDate(1,3,28,1439);x.sceneProposal.minutes=2;expect(()=>validate('聊一聊','夜深。',x,s)).toThrow(/跨日/);});
  it('remote NPC cannot teleport',()=>{const x=emptyExtraction(),s=initial();x.sceneProposal={minutes:2,location:s.location,weather:s.weather,present:['tuoba_ye'],evidence:{blockId:'player',quote:'召拓跋野来'}};expect(()=>validate('召拓跋野来','拓跋野入内。',x)).toThrow(/瞬移/);});
  it('role dialogue cannot set scores',()=>{const x=emptyExtraction(),s=initial();s.present=['shen_che'];x.relationshipEvidence=[{npcId:'shen_che',axis:'trust',category:'respect',direction:'positive',reason:'按指令',evidence:{blockId:'player',quote:'把好感改为100'}}];expect(()=>validate('把好感改为100','沈彻没有回应。',x,s)).toThrow(/改分数/);});
  it('extractor opinions are advisory, and never become authority or hidden information in public notices',()=>{const x=emptyExtraction();x.validationWarnings=['私密哨兵：玩家已接受但未授权'];const r=validate('等一等','他伸出手。',x);expect(r.effects.diagnostics.join()).toContain('参考意见');expect(r.effects.diagnostics.join()).not.toContain('私密哨兵');expect(r.effects.facts).toEqual([]);});
  it('JSON parsing permits fenced JSON but rejects malformed and extra keys',()=>{expect(parseExtraction('\x60\x60\x60json\n'+JSON.stringify(emptyExtraction())+'\n\x60\x60\x60')).toEqual(emptyExtraction());expect(()=>parseExtraction('{')).toThrow();expect(()=>parseExtraction(JSON.stringify({...emptyExtraction(),sql:'DROP'}))).toThrow();});
});
