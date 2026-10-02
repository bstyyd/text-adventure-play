import {scenarioFor,ownershipFor} from '../scenario/runtime';
import { z } from 'zod';
import { ExtractionSchema, TurnInputSchema } from '../domain/types';
import type { Capabilities, Draft, Extraction, Profile, TurnInput } from '../domain/types';
import { Repository, ConflictError } from '../storage/repository';
import { contextFor, blocks } from '../memory/context';
import { validateAndReduce, ValidationError } from './validate';
import type { LLMProvider, TextRequest } from '../llm/types';
import { ProviderError } from '../llm/types';
import { capabilities } from '../llm/config';
import { characterWorld, resolveMentions } from '../characters/world';
import { DraftReviewSchema } from '../domain/draft-review';
import { draftRevision, reviewedExtraction } from './draft-review';
import { storyBodyIssues } from '../domain/story-body';
export const RetryOptionsSchema=z.object({extractProfileId:z.string().min(1).max(80).optional(),timeoutMs:z.number().int().min(5000).max(300000).optional()}).strict();
type RetryOptions=z.infer<typeof RetryOptionsSchema>;
export type EngineDependencies={provider:(profile:Profile)=>LLMProvider;secret:(profile:Profile)=>string;profiles:()=>{narrator:Profile;extractor:Profile};capabilities?:(profile:Profile)=>Capabilities;style?:()=>string;characterLimit?:()=>number;reportFailure?:(profile:Profile,error:unknown)=>void};
export function parseExtraction(text:string):Extraction {
  const clean=text.trim().replace(/^\x60{3}(?:json)?\s*/,'').replace(/\s*\x60{3}$/,'');
  return ExtractionSchema.parse(JSON.parse(clean));
}
export function safeError(error:unknown){
  if(error instanceof ConflictError||error instanceof ValidationError||error instanceof ProviderError)return error.message;
  if(error instanceof z.ZodError)return '结构校验失败：'+error.issues.slice(0,3).map(i=>i.path.join('.')+' '+i.code).join('；');
  if(error instanceof SyntaxError)return '记忆整理不是有效 JSON。';
  if(error instanceof DOMException|| (error as {name?:string})?.name==='AbortError')return '请求已取消或超时；未提交。';
  return '本地处理失败，正文草稿已保留。请检查数据目录权限与服务状态。';
}
export class TurnEngine{
  active=new Map<string,{id:string;controller:AbortController;promise:Promise<void>}>();
  constructor(public repo:Repository,private deps:EngineDependencies){}
  start(raw:TurnInput,authoredBody?:string){
    const input=TurnInputSchema.parse(raw),old=this.repo.maybeDraft(input.clientRequestId);
    if(old){
      if(old.saveId!==input.saveId||old.branchId!==input.branchId||old.playerText!==input.playerText||old.expectedHeadTurnId!==input.expectedHeadTurnId)throw new ConflictError('请求 ID 已用于另一输入。');
      return old;
    }
    const branch=this.repo.branch(input.branchId);
    if(branch.saveId!==input.saveId||branch.headTurnId!==input.expectedHeadTurnId)throw new ConflictError('进度已改变，请刷新后再输入。');
    if(input.target&&!characterWorld(this.repo.path(branch.headTurnId,input.saveId)).some(c=>c.id===input.target))throw new ConflictError('交谈对象不在当前分支的已知人物中。');
    if(this.active.has(branch.id))throw new ConflictError('本分支已有生成请求。');
    if(this.repo.view(input.saveId,input.branchId).drafts.some(d=>d.status==='failed'&&d.expectedHeadTurnId===branch.headTurnId))throw new ConflictError('请先处理或收起未提交草稿，再继续故事。');
    const profiles=this.deps.profiles(),draft:Draft={
      id:input.clientRequestId,saveId:input.saveId,branchId:input.branchId,expectedHeadTurnId:input.expectedHeadTurnId,playerText:input.playerText,
      target:input.target,mode:input.mode==='ooc'||/^OOC[:：]/i.test(input.playerText)?'ooc':'story',body:authoredBody||'',status:authoredBody?'extracting':'generating',error:null,
      createdAt:new Date().toISOString(),profile:authoredBody?{...profiles.narrator,provider:'mock',model:'author-revision'}:structuredClone(profiles.narrator),extractProfile:structuredClone(profiles.extractor),
      turnId:null,requestCount:0,extraction:null,usage:{input:0,output:0},bodyComplete:!!authoredBody,
      bodyFinishReason:authoredBody?'author':undefined,stageStartedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    this.repo.putDraft(draft);this.launch(draft,!!authoredBody);return draft;
  }
  private launch(draft:Draft,extractOnly:boolean,repairBody=false){
    const controller=new AbortController();
    const generation={key:this.deps.secret(draft.profile),capabilities:this.deps.capabilities?.(draft.profile)||capabilities(draft.profile)};
    const extraction={key:this.deps.secret(draft.extractProfile),capabilities:this.deps.capabilities?.(draft.extractProfile)||capabilities(draft.extractProfile)};
    const promise=Promise.resolve().then(()=>this.run(draft,controller.signal,extractOnly,generation,extraction,repairBody)).finally(()=>this.active.delete(draft.branchId));
    this.active.set(draft.branchId,{id:draft.id,controller,promise});
  }
  async wait(id:string){const d=this.repo.draft(id);await this.active.get(d.branchId)?.promise;return this.repo.draft(id);}
  repair(id:string){
    const d=this.repo.draft(id);
    if(d.status==='committed')return d;
    if(this.active.has(d.branchId))throw new ConflictError('请求仍在运行。');
    if(!['failed','cancelled'].includes(d.status)||d.mode!=='story'||d.bodyComplete!==true)throw new ConflictError('只有已完整接收、已停止的剧情草稿可以自动修正。');
    if(this.repo.branch(d.branchId).headTurnId!==d.expectedHeadTurnId)throw new ConflictError('原进度已改变，请先从原节点另开分支。');
    if(!storyBodyIssues(d.playerText,d.body,this.repo.scenarios.fromSnapshot(this.repo.save(d.saveId).scenarioSnapshotHash).player).length)throw new ConflictError('正文没有此类待修正标记；可继续整理记忆或自行编辑正文。');
    const profiles=this.deps.profiles(),now=new Date().toISOString();
    const next:Draft={...d,status:'generating',error:null,extraction:null,failureStage:undefined,failureCode:undefined,
      profile:structuredClone(profiles.narrator),extractProfile:structuredClone(profiles.extractor),stageStartedAt:now,updatedAt:now,
      bodyRepair:{originalBody:d.bodyRepair?.originalBody??d.body,originalProfile:d.bodyRepair?.originalProfile??d.profile,startedAt:now,phase:'generating'}};
    this.repo.putDraft(next);this.launch(next,false,true);return next;
  }
  retry(id:string,extractOnly:boolean,body?:string,options:RetryOptions={}){
    options=RetryOptionsSchema.parse(options);
    let d=this.repo.draft(id);
    if(d.status==='committed')return d;
    if(this.active.has(d.branchId))throw new ConflictError('请求仍在运行。');
    if(this.repo.branch(d.branchId).headTurnId!==d.expectedHeadTurnId)throw new ConflictError('原进度已改变，请先从原节点另开分支。');
    if(extractOnly&&!d.body&&!body)throw new Error('没有可整理的草稿。');
    if(extractOnly&&!body&&d.bodyComplete!==true)throw new ProviderError('BODY_UNVERIFIED','这份草稿未确认完整。请先核对并修订正文，再整理；或重新生成正文。');
    const refresh=(p:Profile)=>{
      const current=this.repo.profiles().find(item=>item.id===p.id&&item.provider===p.provider&&item.model===p.model);
      return current?{...p,timeoutMs:current.timeoutMs,connectTimeoutMs:current.connectTimeoutMs,firstTextTimeoutMs:current.firstTextTimeoutMs,maxOutputTokens:current.maxOutputTokens,length:current.length}:p;
    };
    let extractProfile=refresh(d.extractProfile);
    if(options.extractProfileId){
      const selected=this.repo.profiles().find(p=>p.id===options.extractProfileId);
      if(!selected)throw new ConflictError('所选记忆整理配置不存在，请刷新设置。');
      extractProfile=structuredClone(selected);
    }
    if(options.timeoutMs)extractProfile={...extractProfile,timeoutMs:options.timeoutMs};
    d={...d,body:body??(extractOnly?d.body:''),status:extractOnly?'extracting':'generating',error:null,extraction:null,
      bodyComplete:extractOnly,bodyFinishReason:body?'author':extractOnly?d.bodyFinishReason:undefined,failureStage:undefined,failureCode:undefined,
      profile:refresh(d.profile),extractProfile,bodyRepair:d.bodyRepair?{...d.bodyRepair,phase:'received'}:undefined,stageStartedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    this.repo.putDraft(d);this.launch(d,extractOnly);return d;
  }
  reviewContext(id:string){
    const d=this.repo.draft(id),history=this.repo.path(d.expectedHeadTurnId,d.saveId),state=history.at(-1)!.state;
    return {playerName:scenarioFor(history).player.name,revision:draftRevision(d),body:d.body,playerText:d.playerText,location:state.location,present:state.present.filter(id=>characterWorld(history).some(c=>c.id===id)),
      characters:characterWorld(history).map(c=>({id:c.id,name:c.name,identity:c.identity}))};
  }
  async commitReviewed(id:string,raw:unknown){
    const review=DraftReviewSchema.parse(raw);
    let committedNow=false;
    const committed=this.repo.db.transaction(()=>{
      const d=this.repo.draft(id);
      if(d.status==='committed')return d;
      if(this.active.has(d.branchId)||!['failed','cancelled'].includes(d.status))throw new ConflictError('请先停止当前生成，再审阅草稿。');
      if(draftRevision(d)!==review.revision)throw new ConflictError('草稿已被其他操作更新，请关闭审阅并重新打开。');
      if(this.repo.branch(d.branchId).headTurnId!==d.expectedHeadTurnId)throw new ConflictError('原进度已改变，请从原节点另开分支。');
      if(d.mode!=='story')throw new ValidationError('OOC 不保存为正式剧情。');
      const history=this.repo.path(d.expectedHeadTurnId,d.saveId),x=reviewedExtraction(d,review,history),turnId=crypto.randomUUID();
      const result=validateAndReduce(history.at(-1)!.state,d.playerText,review.body,x,turnId,history,{requestId:d.id,branchId:d.branchId});
      if(d.target&&result.state.present.includes(d.target)&&!result.state.contacted.includes(d.target))result.state.contacted.push(d.target);
      const updated:Draft={...d,body:review.body,bodyComplete:true,bodyFinishReason:'author',extraction:x,status:'validating',error:null,failureStage:undefined,failureCode:undefined,updatedAt:new Date().toISOString()};
      // Enclose reopening, prose, facts, people and head movement in the same transaction.
      this.repo.putDraft(updated);
      this.repo.commit(updated,{id:turnId,saveId:d.saveId,branchId:d.branchId,parentTurnId:d.expectedHeadTurnId,playerText:d.playerText,body:review.body,
        state:result.state,effects:result.effects,createdAt:new Date().toISOString(),provider:d.profile.provider,model:d.profile.model,memorySource:'local-review',
        requestId:d.id,requestCount:d.requestCount,usage:d.usage});
      committedNow=true;
      return this.repo.draft(id);
    })();
    if(committedNow&&committed.turnId&&this.repo.turn(committed.turnId).state.messageCount%10===0)try{await this.repo.backup(true);this.repo.setSetting('backup-error','');}catch{this.repo.setSetting('backup-error','自动备份失败；正文已完整提交。请检查备份目录权限和磁盘空间，并手动备份。');}
    return committed;
  }
  async commitExtracted(id:string,revision:string){
    let committedNow=false;
    const committed=this.repo.db.transaction(()=>{
      const d=this.repo.draft(id);
      if(d.status==='committed')return d;
      if(this.active.has(d.branchId)||!['failed','cancelled'].includes(d.status))throw new ConflictError('请先等待当前请求结束。');
      if(draftRevision(d)!==revision)throw new ConflictError('草稿已更新，请刷新后再保存。');
      if(this.repo.branch(d.branchId).headTurnId!==d.expectedHeadTurnId)throw new ConflictError('原进度已改变，请从原节点另开分支。');
      if(d.mode!=='story'||d.bodyComplete!==true||!d.body.trim()||!d.extraction)throw new ValidationError('尚无完整正文和记忆整理结果，请先完成整理。');
      const history=this.repo.path(d.expectedHeadTurnId,d.saveId),turnId=crypto.randomUUID();
      const x=ExtractionSchema.parse(d.extraction);
      const result=validateAndReduce(history.at(-1)!.state,d.playerText,d.body,x,turnId,history,{requestId:d.id,branchId:d.branchId});
      if(d.target&&result.state.present.includes(d.target)&&!result.state.contacted.includes(d.target))result.state.contacted.push(d.target);
      const updated:Draft={...d,status:'validating',error:null,failureStage:undefined,failureCode:undefined,updatedAt:new Date().toISOString()};
      this.repo.putDraft(updated);
      this.repo.commit(updated,{id:turnId,saveId:d.saveId,branchId:d.branchId,parentTurnId:d.expectedHeadTurnId,playerText:d.playerText,body:d.body,
        state:result.state,effects:result.effects,createdAt:new Date().toISOString(),provider:d.profile.provider,model:d.profile.model,
        requestId:d.id,requestCount:d.requestCount,usage:d.usage});
      committedNow=true;return this.repo.draft(id);
    })();
    if(committedNow&&committed.turnId&&this.repo.turn(committed.turnId).state.messageCount%10===0)try{await this.repo.backup(true);this.repo.setSetting('backup-error','');}catch{this.repo.setSetting('backup-error','自动备份失败；正文已完整提交。请检查备份目录权限和磁盘空间，并手动备份。');}
    return committed;
  }
  cancel(id:string){
    const d=this.repo.draft(id);if(d.status==='committed')return d;
    this.active.get(d.branchId)?.controller.abort();
    const stopped={...d,status:'cancelled' as const,error:'已停止，草稿保留；上游请求仍可能计费。',updatedAt:new Date().toISOString()};
    this.repo.putDraft(stopped);return stopped;
  }
  private async run(draft:Draft,signal:AbortSignal,extractOnly:boolean,generation:Pick<TextRequest,'key'|'capabilities'>,extraction:Pick<TextRequest,'key'|'capabilities'>,repairBody=false){
    let d={...draft};
    let activeProfile=d.profile;
    let phase:NonNullable<Draft['failureStage']>=extractOnly?'extraction':'generation';
    const persist=()=>{signal.throwIfAborted();d.updatedAt=new Date().toISOString();this.repo.putDraft(d);};
    const onAttempt=()=>{d.requestCount++;persist();};
    try{
      const history=this.repo.path(d.expectedHeadTurnId,d.saveId),previous=history.at(-1)!.state;
      const scenario=scenarioFor(history),ownership=ownershipFor(scenario);
      const view=this.repo.view(d.saveId,d.branchId);
      const writingPreference=this.deps.style?.()||'';
      const context=contextFor(history,d.playerText,d.target,view.annotations,22000-writingPreference.length-200,this.deps.characterLimit?.()||12);
      const layered=JSON.parse(context.system);layered.layer2.writingPreference=writingPreference;layered.layer2.lengthTarget={short:'100–350字',normal:'300–700字',long:'600–1200字'}[d.profile.length];
      const system=JSON.stringify(layered);
      const request:TextRequest={profile:d.profile,...generation,system:d.mode==='ooc'?'OOC：讨论规则与文风，不修改游戏事实。\n'+ownership:system,messages:d.mode==='ooc'?[{role:'user',content:d.playerText}]:[...context.messages,{role:'user',content:d.playerText}],signal,onAttempt};
      if(repairBody){
        const result=await this.deps.provider(d.profile).generateText({...request,system:'BODY_REPAIR v1：修正未采用草稿中的玩家越权叙述。仅输出修正后的完整小说正文，不输出说明或JSON。保留NPC的姓名、已有动作、对白与场景信息，不增加新人物、情节、结论、时间或玩家行为。删除模型擅自补写的玩家角色内心、动作、决定和对白；以NPC及场景回应玩家原输入。\n'+ownership+'\n当前上下文：'+system,
          messages:[...context.messages,{role:'user',content:JSON.stringify({playerText:d.playerText,originalDraft:d.body,issues:storyBodyIssues(d.playerText,d.body)})}],format:'text',schema:undefined});
        signal.throwIfAborted();
        d.usage.input+=result.usage.input;d.usage.output+=result.usage.output;
        d.bodyRepair={...d.bodyRepair!,candidateBody:result.text,phase:'received'};persist();
        if(!result.text.trim())throw new ProviderError('EMPTY','修正模型返回了空正文，原稿保留。');
        d.body=result.text;d.bodyComplete=true;d.bodyFinishReason=result.finishReason;persist();
      }else if(!extractOnly){
        const provider=this.deps.provider(d.profile);let completed=false,lastWrite=0;
        for await(const event of provider.streamText(request)){
          signal.throwIfAborted();
          if(event.type==='delta'){d.body+=event.text;if(Date.now()-lastWrite>150){persist();lastWrite=Date.now();}}
          else{d.body=event.result.text;d.bodyComplete=true;d.bodyFinishReason=event.result.finishReason;d.usage.input+=event.result.usage.input;d.usage.output+=event.result.usage.output;completed=true;persist();}
        }
        if(!completed||!d.body.trim())throw new ProviderError('EMPTY','没有完整正文，无法提交。');
      }
      if(d.mode==='ooc'){
        signal.throwIfAborted();
        this.repo.db.transaction(()=>{
          this.repo.putScoped('ooc_messages',d.saveId,{id:d.id,branchId:d.branchId,atTurnId:d.expectedHeadTurnId,playerText:d.playerText,body:d.body,createdAt:new Date().toISOString()});
          d={...d,status:'committed'};this.repo.putDraft(d);
        })();return;
      }
      phase='extraction';d.status='extracting';d.stageStartedAt=new Date().toISOString();persist();
      const schema=z.toJSONSchema(ExtractionSchema) as Record<string,unknown>;
      const extractor=this.deps.provider(d.extractProfile);
      activeProfile=d.extractProfile;
      const format=extraction.capabilities.jsonSchema==='supported'?'json_schema':extraction.capabilities.jsonObject==='supported'?'json_object':'text';
      const roster=characterWorld(history,'narrator');
      const mentionList=resolveMentions(d.playerText+'\n'+d.body,roster);
      const relevant=new Set([...previous.present,...mentionList.flatMap(m=>m.candidates)]);
      const packet={playerText:d.playerText,body:d.body,calendar:scenario.calendar,player:scenario.player,rules:scenario.rules,charactersSeed:scenario.characters,blocks:{player:d.playerText,...blocks(d.body)},state:previous,
        characters:roster.filter(c=>relevant.has(c.id)).map(c=>({id:c.id,name:c.name,aliases:c.aliases,identity:c.identity,offices:c.offices,availability:c.availability,location:c.location,
          age:c.age,factions:c.factions,conditions:c.conditions,notes:c.notes.slice(-12),relations:c.relations,
          informationEvents:c.timeline.filter(e=>e.kind!=='knowledge').slice(-16).map(e=>({id:e.id,kind:e.kind,data:e.data,sourceTurnId:e.sourceTurnId,knownBy:e.knownBy,revealed:e.revealed}))})),
        characterIndex:characterWorld(history).slice(-100).map(c=>({id:c.id,name:c.name,aliases:c.aliases})),mentions:mentionList,
        authoritySources:history.slice(-12).filter(t=>/授权|任命|罢免|兼任|代理|差遣|授予|免去/.test(t.playerText)).map(t=>({sourceTurnId:t.id,playerText:t.playerText}))};
      const extractionRequest:TextRequest={
        profile:d.extractProfile,...extraction,signal,onAttempt,format,schema,
        system:'EXTRACTOR v1：只整理证据，不新增剧情。输出单个 JSON 对象，严格符合给定 JSON Schema。每项证据 blockId/quote 必须逐字存在。计划不是完成、说法不是真相、送信不等于收到。knownBy仅限确实听见或获知者。玩家心理私密；NPC秘密不共享。无关系证据就空数组，不从日常对白猜加分。时间通常0–2分钟，跨日须授权。sceneProposal没有变化可为null。pendingThreads只引用facts.content或既有事项。suggestedActions给3条紧接正文末段、可自由拒绝或改写的开放行动，不给收益或秘密。'+ownership+'\nSchema:'+JSON.stringify(schema),
        messages:[{role:'user',content:JSON.stringify(packet)}],
      };
      extractionRequest.system+='\n动态人物 v1：当前剧本所列人物只是种子，具体说话、执行任务、反复出现或明确被关注的个体应登记；泛指群体不要建档。新建用 new:localRef，由服务端分配稳定ID；本轮在场、事实subject、knownBy可引用new:localRef。已有人物改名、换官职或揭露身份仍用原ID，不按同名同姓同官职合并；不确定填unresolvedMentions候选。新增人物默认禁用恋爱，无须编造年龄身世。职务提议/下令/生效/到任/离任分别生成proposedOfficeChanges；同一任职记录各阶段复用assignmentRef。玩家任免处罚必须引用玩家明确原文或祖先节点授权，NPC说法不能当命令。生效须有ordered记录，荣誉不授职权，异地任命不改变位置。自称/传闻/秘密与确认信息分开，knownBy仅实际知情者；远方消息用proposedKnowledgeChanges记录已送达证据，informationEventRef指对应提案ref或已知事件ID。客观人际关系与单向态度分开。所有变化均须真实引文，缺少证据保持未知，不新增正文没有发生的事实。';
      extractionRequest.system+='\n整理约定：weather无明确新天气时逐字沿用state.weather，不缩写。eventProposals只能引用state.events已有key，普通军报或新剧情用facts记录，不另造事件key。pendingThreads不改写事实，引用facts.content或state.pendingThreads原文。正文措辞和疑似代演只记validationWarnings供玩家参考，不把它们当成玩家已授权的命令、任免或其他状态变化。';
      let x:Extraction|undefined;
      for(let attempt=0;attempt<2;attempt++){
        const r=await extractor.extractJson(extractionRequest);
        d.usage.input+=r.usage.input;d.usage.output+=r.usage.output;
        try{x=parseExtraction(r.text);break;}catch(error){
          if(attempt===1)throw error;
          extractionRequest.system+='\n仅修复 JSON 结构，不改动或新增情节。上次结果未通过解析/Schema，请从同一原文重新整理。';
        }
      }
      signal.throwIfAborted();
      phase='validation';d.extraction=x!;d.status='validating';d.stageStartedAt=new Date().toISOString();persist();
      const id=crypto.randomUUID();
      const result=validateAndReduce(previous,d.playerText,d.body,x!,id,history,{requestId:d.id,branchId:d.branchId});
      if(d.target&&result.state.present.includes(d.target)&&!result.state.contacted.includes(d.target))result.state.contacted.push(d.target);
      signal.throwIfAborted();
      this.repo.commit(d,{id,saveId:d.saveId,branchId:d.branchId,parentTurnId:d.expectedHeadTurnId,playerText:d.playerText,body:d.body,
        state:result.state,effects:result.effects,createdAt:new Date().toISOString(),provider:d.profile.provider,model:d.profile.model,
        requestId:d.id,requestCount:d.requestCount,usage:d.usage});
      if(result.state.messageCount%10===0)try{await this.repo.backup(true);this.repo.setSetting('backup-error','');}catch{this.repo.setSetting('backup-error','自动备份失败；正文已完整提交。请检查备份目录权限和磁盘空间，并手动备份。');}
    }catch(error){
      this.deps.reportFailure?.(activeProfile,error);
      const stored=this.repo.draft(d.id);
      if(stored.status==='committed')return;
      if(repairBody&&d.bodyRepair)d.bodyRepair={...d.bodyRepair,phase:'failed',...(error instanceof ProviderError&&error.partialText?{candidateBody:error.partialText}:{})};
      if(phase==='generation'&&error instanceof ProviderError&&!repairBody){
        if(error.partialText)d.body=error.partialText;
        d.bodyFinishReason=error.finishReason;
      }
      const prefix=repairBody&&phase==='generation'?'自动修正未完成，原稿保留：':phase==='generation'?(d.bodyComplete?'正文已完整接收，后续处理未完成：':'正文生成未完成：'):phase==='extraction'?'记忆整理失败，正文已完整接收、尚未保存为正式剧情：':d.extraction?'正文和记忆的校验未通过，尚未保存为正式剧情：':'正文检查未通过，尚未保存为正式剧情：';
      d={...d,status:signal.aborted?'cancelled':'failed',failureStage:phase,failureCode:error instanceof ProviderError?error.code:undefined,
        error:prefix+safeError(error),updatedAt:new Date().toISOString()};
      this.repo.putDraft(d);
    }
  }
}
