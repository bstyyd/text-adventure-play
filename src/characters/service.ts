import { z } from 'zod';
import { CharacterIdSchema } from '../domain/identity';
import type { Turn } from '../domain/types';
import { ConflictError, emptyEffects, Repository } from '../storage/repository';
import { CharacterCorrectionSchema } from './schema';
import type { CharacterBook, CharacterCorrection, CharacterEvent } from './schema';
import { allCharacterEvents, characterWorld } from './world';
import {scenarioFor} from '../scenario/runtime';

const scope={saveId:z.uuid(),branchId:z.uuid()};
export class CharacterService {
  constructor(private repo:Repository){}
  private history(saveId:string,branchId?:string,at?:string){
    const view=this.repo.view(saveId,branchId),index=at?view.turns.findIndex(t=>t.id===at):view.turns.length-1;
    if(index<0)throw new ConflictError('人物档案节点不在所选分支可见路径中。');
    return {view,turns:view.turns.slice(0,index+1)};
  }
  book(saveId:string,branchId?:string,at?:string,search=''):CharacterBook{
    const {view,turns}=this.history(saveId,branchId,at),all=characterWorld(turns),ids=new Set(all.map(c=>c.id));
    const visible=new Set(turns.map(t=>t.id)),query=search.trim().toLocaleLowerCase();
    const characters=all.filter(c=>!query||[c.name,...c.aliases,c.identity,...c.offices.map(o=>o.title),...c.factions].some(s=>s.toLocaleLowerCase().includes(query)));
    return {saveId,branchId:view.branch.id,atTurnId:turns.at(-1)!.id,characters,
      unresolvedMentions:allCharacterEvents(turns).filter(e=>e.kind==='mention').filter(e=>e.revealed).map(e=>({label:e.data.label,candidates:e.data.candidates.filter(id=>ids.has(id)),sourceTurnId:e.sourceTurnId})),
      followed:this.repo.setting<string[]>('characters:follow:'+saveId,[]).filter(id=>ids.has(id)),
      groups:Object.fromEntries(Object.entries(this.repo.setting<Record<string,string>>('characters:groups:'+saveId,{})).filter(([id])=>ids.has(id))),
      corrections:this.repo.all<CharacterCorrection>('character_corrections').filter(c=>c.saveId===saveId&&c.branchId===view.branch.id&&visible.has(c.sourceTurnId)&&visible.has(c.recordedAtTurnId)&&ids.has(c.characterId)),
      contextLimit:this.repo.setting('character-context-limit',12)};
  }
  follow(raw:unknown){
    const p=z.object({...scope,characterId:CharacterIdSchema,followed:z.boolean()}).strict().parse(raw);
    if(!this.book(p.saveId,p.branchId).characters.some(c=>c.id===p.characterId))throw new ConflictError('此人物不在当前可见人物簿中。');
    const old=this.repo.setting<string[]>('characters:follow:'+p.saveId,[]);
    this.repo.setSetting('characters:follow:'+p.saveId,p.followed?[...new Set([...old,p.characterId])]:old.filter(id=>id!==p.characterId));
    return {ok:true};
  }
  setBudget(raw:unknown){
    const p=z.object({contextLimit:z.number().int().min(6).max(40)}).strict().parse(raw);
    this.repo.setSetting('character-context-limit',p.contextLimit);return p;
  }
  group(raw:unknown){
    const p=z.object({...scope,characterId:CharacterIdSchema,label:z.string().trim().max(40)}).strict().parse(raw);
    if(!this.book(p.saveId,p.branchId).characters.some(c=>c.id===p.characterId))throw new ConflictError('此人物不在当前可见人物簿中');
    const labels={...this.repo.setting<Record<string,string>>('characters:groups:'+p.saveId,{})};if(p.label)labels[p.characterId]=p.label;else delete labels[p.characterId];this.repo.setSetting('characters:groups:'+p.saveId,labels);return {ok:true};
  }
  correct(raw:unknown){
    const p=z.object({...scope,characterId:CharacterIdSchema,sourceTurnId:z.uuid(),category:CharacterCorrectionSchema.shape.category,note:CharacterCorrectionSchema.shape.note,fork:z.boolean()}).strict().parse(raw);
    const {view,turns}=this.history(p.saveId,p.branchId,p.sourceTurnId),source=turns.at(-1)!;
    if(!characterWorld(turns).some(c=>c.id===p.characterId))throw new ConflictError('此节点尚未公开该人物，无法纠错。');
    return this.repo.db.transaction(()=>{
      const branch=p.fork?this.repo.fork(p.saveId,p.branchId,source.parentTurnId||source.id,'人物纠错 · '+this.repo.branch(p.branchId).name):null;
      const correction:CharacterCorrection={id:crypto.randomUUID(),saveId:p.saveId,branchId:p.branchId,sourceTurnId:p.sourceTurnId,recordedAtTurnId:view.branch.headTurnId,characterId:p.characterId,category:p.category,note:p.note,createdAt:new Date().toISOString(),resultBranchId:branch?.id||null};
      this.repo.db.prepare('INSERT INTO character_corrections VALUES (?,?,?,?)').run(correction.id,p.saveId,p.sourceTurnId,JSON.stringify(correction));
      return {correction,branch,playerText:source.playerText};
    })();
  }
  policy(raw:unknown){
    const p=z.object({...scope,characterId:CharacterIdSchema,expectedHeadTurnId:z.uuid(),clientRequestId:z.uuid(),romancePolicy:z.enum(['disabled','available']),relevance:z.enum(['recurring','supporting','incidental']).optional(),relationshipEnabled:z.boolean().optional(),confirmed:z.literal(true)}).strict().parse(raw);
    return this.repo.db.transaction(()=>{
      const duplicate=this.repo.all<Turn>('turns').find(t=>t.requestId===p.clientRequestId);
      if(duplicate){if(duplicate.saveId!==p.saveId||duplicate.branchId!==p.branchId||!duplicate.effects.characterEvents?.some(e=>e.kind==='policy'&&e.characterId===p.characterId&&e.data.romancePolicy===p.romancePolicy&&e.data.relevance===p.relevance&&e.data.relationshipEnabled===p.relationshipEnabled))throw new ConflictError('配置请求ID已用于另一操作。');return duplicate;}
      const {view,turns}=this.history(p.saveId,p.branchId),previous=turns.at(-1)!;
      if(view.branch.headTurnId!==p.expectedHeadTurnId)throw new ConflictError('进度已变化，请重新查看人物后配置。');
      if(view.drafts.some(d=>['generating','extracting','validating','failed'].includes(d.status)))throw new ConflictError('请先处理当前草稿，再配置人物路线。');
      const c=characterWorld(turns).find(c=>c.id===p.characterId);
      if(!c)throw new ConflictError('人物尚未公开。');
      const scenario=scenarioFor(turns);
      if(c.seedKey&&scenario.characters.find(n=>n.stableId===c.seedKey)?.immutableProfile)throw new ConflictError('本剧本锁定种子人物配置；请复制剧本后修改。');
      if(p.romancePolicy==='available'&&!scenario.manifest.romanceSystem)throw new ConflictError('本剧本关闭恋爱机制。');
      if(p.relationshipEnabled&&!scenario.manifest.relationshipSystem.enabled)throw new ConflictError('本剧本关闭人物数值系统。');
      if(p.romancePolicy==='available'&&(c.age===null||c.age<18))throw new ConflictError('只有已明确为成年人的人物才能开放恋爱路线；年龄未知时保持关闭。');
      const id=crypto.randomUUID(),eventId=crypto.randomUUID(),createdAt=new Date().toISOString(),state=structuredClone(previous.state);
      state.romancePolicies={...state.romancePolicies,[c.id]:p.romancePolicy};
      if(p.relationshipEnabled&&!state.relationships[c.id])state.relationships[c.id]={values:Object.fromEntries(scenario.rules.relationshipStats.map(s=>[s.key,s.dynamicDefault??s.initial])),status:''};
      if(p.relationshipEnabled===false)delete state.relationships[c.id];
      const event:CharacterEvent={id:eventId,saveId:p.saveId,branchId:p.branchId,sourceTurnId:id,characterId:c.id,kind:'policy',actorId:'player',before:{romancePolicy:c.romancePolicy},
        gameTime:{year:state.date.year,month:state.date.month,day:state.date.day,minuteOfDay:state.date.minuteOfDay},recordedAt:createdAt,revealed:true,knownBy:['player'],
        evidence:{blockId:'configuration',quote:'玩家明确确认人物配置。'},sourceKind:'configuration',data:{romancePolicy:p.romancePolicy,...(p.relevance?{relevance:p.relevance}:{}),...(p.relationshipEnabled!==undefined?{relationshipEnabled:p.relationshipEnabled}:{})}};
      const turn:Turn={id,saveId:p.saveId,branchId:p.branchId,parentTurnId:previous.id,playerText:'',body:'',state,
        effects:{...emptyEffects(),characters:[],characterEvents:[event]},createdAt,provider:'mock',model:'character-configuration',requestId:p.clientRequestId,requestCount:0,usage:{input:0,output:0},kind:'configuration'};
      this.repo.insertTurn(turn);this.repo.putBranch({...view.branch,headTurnId:id});return turn;
    })();
  }
}
