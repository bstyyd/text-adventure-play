import { createHash } from 'node:crypto';
import type { Evidence, Extraction, Effects, State, Turn } from '../domain/types';
import { prepareCharacters } from '../characters/reduce';
import { characterWorld } from '../characters/world';
import {scenarioFor} from '../scenario/runtime';
import { advanceDate } from '../domain/calendar';
import { applyRelation, canIntroduce, closeScene, scheduleEvents } from '../domain/rules';
import { blocks } from '../memory/context';
import { ValidationError } from './errors';
import { normalizeExtraction } from './normalize-extraction';
export { ValidationError } from './errors';
function fail(message:string):never{throw new ValidationError(message);}
const normalized=(s:string)=>s.replace(/[\s，。！？、：；“”"'!?,.:;]/g,'').toLowerCase();
const stableKey=(s:string)=>createHash('sha256').update(normalized(s)).digest('hex').slice(0,24);
function invitesVisitor(input:string,body:string,names:string[],arrivals:number){
  if(/不要|不准|不许|别让|别叫|别请|莫让|禁止|暂不|尚未|没有|拒绝|如果|假如|假设|要不要|是否|考虑|心想|心里|内心|他说|她说|据说|[？?]/.test(input))return false;
  if(names.some(n=>input.includes(n))&&/召|进来|请.{0,8}来|来见|前往|拜访|去往|会面/.test(input))return true;
  const unnamed=/(?:让|叫|请|准)(?:门外(?:的)?(?:那|这)?(?:个)?人|来人|来客|对方|他|她)(?:先|现在)?(?:进来|入内|入殿)|^(?:进来|请进)[。！!]?$/;
  if(arrivals!==1||!unnamed.test(input))return false;
  return Object.values(blocks(body)).some(block=>names.some(n=>block.includes(n))&&/推开|走进|迈进|进来|入内|入殿|进殿|跨进|走入/.test(block)&&!/(?:没有|并未|尚未|未曾|不肯|不愿).{0,8}(?:推开|走进|进来|入内|入殿|进殿)/.test(block));
}
export function validateAndReduce(previous:State,input:string,body:string,raw:Extraction,turnId:string,history:Turn[],identity={requestId:turnId,branchId:history.at(-1)?.branchId||''}):{state:State;effects:Effects}{
  const scenario=scenarioFor(history),isSeedId=(id:string)=>scenario.characters.some(c=>c.stableId===id);
  if(!history.length)fail('缺少存档历史，不能校验人物引用。');
  const normalizedExtraction=normalizeExtraction(previous,input,body,raw);
  const prepared=prepareCharacters(previous,input,body,normalizedExtraction.extraction,turnId,history,identity.requestId,identity.branchId);
  const x=prepared.extraction,NPCS=prepared.allViews;
  const source:Record<string,string>={player:input,...blocks(body)};
  const evidence=(e:Evidence)=>{
    if(!Object.hasOwn(source,e.blockId)||!source[e.blockId]?.includes(e.quote))fail('整理器的 blockId 或证据引文不在原文中。');
  };
  const all=[...x.facts,...x.knowledgeProposals,...x.relationshipEvidence,...x.eventProposals,...(x.worldStatEvidence||[]),...(x.proposedStoryThreads||[]),...(x.sceneProposal?[x.sceneProposal]:[])];
  all.forEach(p=>evidence(p.evidence));
  let state=structuredClone(previous);
  const proposal=x.sceneProposal;
  const authorizesTime=/等到|睡到|休息到|休息一|过夜|次日|启程|赶路|工作.*小时|处理.*时辰|等.*(?:小时|时辰|天)/.test(input);
  if(proposal){
    if(new Set(proposal.present).size!==proposal.present.length)fail('在场人物重复。');
    const changedLocation=proposal.location!==state.location;
    if(changedLocation&&!/前往|走到|去往|移步|出发|离开/.test(input))fail('地点变化缺少玩家授权。');
    if(proposal.minutes>5&&!authorizesTime)fail('大幅时间推进缺少玩家授权。');
    if(proposal.minutes>1440&&!/天|启程|赶路|出发/.test(input))fail('长途时间推进缺少授权。');
    const nextDate=advanceDate(state.date,proposal.minutes,scenario.calendar);
    if(nextDate.absoluteDay!==state.date.absoluteDay&&!authorizesTime)fail('跨日必须由玩家明确授权。');
    for(const id of proposal.present.filter(id=>!state.present.includes(id))){
      if(/心想|心里|内心|心理/.test(input))fail('内心描述不是联络授权。');
      const npc=NPCS.find(n=>n.id===id)!;
      if(!isSeedId(id)){
        const prior=characterWorld(history,'narrator').find(c=>c.id===id);
        if(!body.includes(npc.name)&&!npc.aliases.some(n=>body.includes(n)))fail('人物登场缺少正文依据。');
        if(prior?.location&&prior.location!==state.location&&!changedLocation&&proposal.minutes<60)fail('异地人物到场缺少合理行程，任命或提及不等于到场。');
        if(!/进来|走进|进入|进殿|站在|跪在|呈上|来到|说道|开口|答道|说[：：“]/.test(body))fail('人物只是被提及，尚无登场依据。');
        continue;
      }
      if(!invitesVisitor(input,body,[npc.name,...npc.aliases],proposal.present.filter(id=>!state.present.includes(id)).length))fail('人物到场缺少明确联络授权；可邀请门外来人，但不能把假设或传闻当成邀请。');
      if(!changedLocation&&proposal.minutes<(scenario.characters.find(c=>c.stableId===id)?.minTravelMinutes||0))fail('远方或行踪不明人物不能瞬移到场。');
    }
    for(const id of state.present.filter(id=>!proposal.present.includes(id))){
      const name=NPCS.find(n=>n.id===id)!.name;
      if(!new RegExp(name+'.{0,24}(告退|离开|退出|退下)').test(body)&&!changedLocation)fail('人物离场没有正文依据。');
    }
    if(changedLocation||proposal.minutes>=30||nextDate.absoluteDay!==state.date.absoluteDay)state=closeScene(state);
    const defined=scenario.locations.find(l=>l.name===proposal.location)||state.dynamicLocations?.find(l=>l.name===proposal.location);
    const locationId=defined?.id||(changedLocation?'location_'+stableKey(proposal.location):state.locationId);
    if(changedLocation&&!defined){if(proposal.evidence.blockId!=='player'||!proposal.evidence.quote.includes(proposal.location))fail('临时地点需要明确的玩家原文名称');state.dynamicLocations=[...(state.dynamicLocations||[]),{id:locationId,name:proposal.location,sourceTurnId:turnId,evidence:proposal.evidence}];}
    state={...state,locationId,date:nextDate,location:proposal.location,present:proposal.present,weather:proposal.weather};
  }
  if(/天已(?:经)?亮|翌日清晨|第二天到了/.test(body)&&state.date.absoluteDay===previous.date.absoluteDay)fail('正文时间与快照不一致。');
  const effects:Effects={facts:[],knowledge:[],memories:[],summaries:[],suggestedActions:x.suggestedActions,diagnostics:normalizedExtraction.diagnostics,characters:prepared.characters,characterEvents:prepared.characterEvents};
  for(const event of effects.characterEvents||[])event.gameTime={year:state.date.year,month:state.date.month,day:state.date.day,minuteOfDay:state.date.minuteOfDay};
  for(const event of effects.characterEvents||[])if(event.kind==='profile'&&event.data.field==='location'&&event.data.certainty==='confirmed'){
    const name=event.data.value;if(!scenario.locations.some(l=>l.name===name)&&!state.dynamicLocations?.some(l=>l.name===name))state.dynamicLocations=[...(state.dynamicLocations||[]),{id:'location_'+stableKey(name),name,sourceTurnId:turnId,evidence:event.evidence,revealed:event.revealed}];
  }
  for(const event of effects.characterEvents||[])if(event.kind==='profile'&&event.data.certainty==='confirmed'&&state.present.includes(event.characterId)){
    if(event.data.field==='location'&&event.data.value!==state.location)fail('人物地点履历与当前在场快照矛盾。');
    if(event.data.field==='availability'&&event.data.value!=='present')fail('人物离场履历与场景在场记录不一致。');
  }
  const knownFacts=history.flatMap(t=>t.effects.facts);
  const factByIndex=new Map<number,string>();
  for(const [index,f] of x.facts.entries()){
    if(/心想|心里|内心|心理/.test(input)&&f.evidence.blockId==='player'&&f.knownBy.length)fail('玩家内心不能自动传给 NPC。');
    if(f.kind==='confirmed_event'&&(/明日|打算|准备|计划|可能|怀疑|疑有|据说|传闻/.test(f.evidence.quote)||/已同意|已宣旨|已选择|已接受/.test(f.content)))fail('计划、传闻或无授权同意不能记为已确认事件。');
    if(f.kind==='confirmed_event'&&(f.subject===scenario.player.name||f.subject==='player')&&f.evidence.blockId!=='player')fail('玩家行动的事实必须引用玩家原文授权。');
    for(const id of f.knownBy)if(!state.present.includes(id)){
      if(!x.knowledgeProposals.some(k=>k.factIndex===index&&k.npcId===id&&k.path!=='witness'))fail('人物认知缺少在场或传播路径。');
    }
    const duplicate=knownFacts.find(old=>old.kind===f.kind&&old.subject===f.subject&&normalized(old.content)===normalized(f.content));
    if(duplicate){
      factByIndex.set(index,duplicate.id);
      const already=new Set([...duplicate.knownBy,...history.flatMap(t=>t.effects.knowledge).filter(k=>k.factId===duplicate.id).map(k=>k.npcId)]);
      for(const npcId of f.knownBy.filter(n=>state.present.includes(n)&&!already.has(n)))effects.knowledge.push({id:crypto.randomUUID(),npcId,factId:duplicate.id,sourceTurnId:turnId,path:'witness',evidence:f.evidence});
      continue;
    }
    const fact={...f,id:crypto.randomUUID(),sourceTurnId:turnId,gameDate:state.date,createdAt:new Date().toISOString(),version:1,propagation:f.knownBy.map(n=>n+':witness')};
    effects.facts.push(fact);factByIndex.set(index,fact.id);
    effects.memories.push({id:crypto.randomUUID(),factId:fact.id,sourceTurnId:turnId,kind:fact.kind,content:fact.content,importance:fact.importance});
    for(const id of fact.knownBy.filter(id=>state.present.includes(id)))effects.knowledge.push({id:crypto.randomUUID(),npcId:id,factId:fact.id,sourceTurnId:turnId,path:'witness',evidence:fact.evidence});
  }
  for(const k of x.knowledgeProposals){
    if(!x.facts[k.factIndex]||!factByIndex.has(k.factIndex))fail('认知引用不存在的事实。');
    if(k.path==='witness'&&!state.present.includes(k.npcId))fail('未在场人物不能见证。');
    const name=NPCS.find(n=>n.id===k.npcId)!.name;
    if(k.path!=='witness'&&(!k.evidence.quote.includes(name)||!/收到|送达|告知|转告|听到|查得|获知/.test(k.evidence.quote)))fail('传播必须有已经送达或获知的原文证据，寄出不等于收到。');
    effects.knowledge.push({id:crypto.randomUUID(),npcId:k.npcId,factId:factByIndex.get(k.factIndex)!,sourceTurnId:turnId,path:k.path,evidence:k.evidence});
  }
  for(const r of x.relationshipEvidence){
    if(!state.present.includes(r.npcId)&&!effects.knowledge.some(k=>k.npcId===r.npcId))fail('关系变化人物没有知情依据。');
    const category=scenario.rules.evidenceCategories.find(c=>c.key===r.category);
    if(!category)fail('未定义关系事件类别');
    if(r.evidence.blockId==='player'&&!category.playerWords.some(w=>r.evidence.quote.includes(w)))fail('普通对白或要求改分数不是有效关系事件。');
    if(r.evidence.blockId!=='player'&&!category.narrativeWords.some(w=>r.evidence.quote.includes(w)))fail('关系建议没有具体事件证据。');
    const key=r.npcId+':'+r.axis+':'+r.category+':'+stableKey(r.evidence.quote);
    state=applyRelation(state,r.npcId,r.axis,r.direction,key,scenario);
    if(r.category==='exception'){
      const old=state.exceptions[r.npcId]||[],k=stableKey(r.evidence.quote);
      state.exceptions[r.npcId]=[...new Set([...old,k])];
    }
  }
  for(const w of x.worldStatEvidence||[]){const def=scenario.rules.worldStats.find(d=>d.key===w.statKey);if(!def)fail('未定义世界数值');if(w.evidence.blockId!=='player')fail('世界状态变化须有玩家原文依据');const key='world:'+w.statKey+':'+stableKey(w.evidence.quote);if(state.relationshipKeys.includes(key))continue;const prev=state.sceneDeltas['world:'+w.statKey]||0,next=Math.max(-def.sceneLimit,Math.min(def.sceneLimit,prev+(w.direction==='positive'?def.step:-def.step)));state.worldStats[w.statKey]=Math.max(def.min,Math.min(def.max,state.worldStats[w.statKey]+next-prev));state.sceneDeltas['world:'+w.statKey]=next;state.relationshipKeys.push(key);}
  const addressed=[...NPCS.filter(n=>input.includes(n.name)).map(n=>n.id),...x.facts.filter(f=>f.evidence.blockId==='player').flatMap(f=>f.knownBy)];
  state.contacted=[...new Set([...state.contacted,...addressed.filter(n=>state.present.includes(n))])];
  state=scheduleEvents(state,turnId,scenario);
  for(const event of x.eventProposals){
    const existing=state.events.find(e=>e.key===event.key);
    if(!existing)fail('事件不存在或条件未满足。');
    if(event.status==='introduced'&&!canIntroduce(existing,state,scenario))fail('当前场景不允许引入该事件。');
    if(event.status==='introduced'&&scenario.rules.triggers.find(r=>r.id===existing.key.split(':')[0])?.witnessWords.length&&(!scenario.rules.triggers.find(r=>r.id===existing.key.split(':')[0])!.witnessWords.some(w=>event.evidence.quote.includes(w))||!state.present.some(n=>!existing.npcIds.includes(n)&&event.evidence.quote.includes(NPCS.find(p=>p.id===n)!.name))))fail('流言缺少见证者或明确传播依据。');
    if(event.status!=='introduced'&&existing.status!=='introduced')fail('尚未发生的事件不能直接解决。');
    existing.status=event.status;
    if(event.status==='introduced')existing.introducedScene=state.sceneId;
    else state.eventKeys.push(existing.key);
  }
  for(const thread of x.pendingThreads){
    if(!previous.pendingThreads.includes(thread)&&!x.facts.some(f=>f.content===thread))fail('未决事项没有事实来源。');
  }
  state.pendingThreads=[...new Set([...state.pendingThreads,...effects.facts.filter(f=>['intent','order','promise','unresolved'].includes(f.kind)).map(f=>f.content),...x.pendingThreads])].slice(-60);
  for(const thread of x.proposedStoryThreads||[]){
    if(!scenario.rules.storyThreadTypes.includes(thread.type))fail('未定义的剧情线类别');
    const old=thread.threadId?state.storyThreads?.find(t=>t.id===thread.threadId):undefined;
    if(thread.threadId&&!old)fail('剧情线不在当前分支');
    if(!thread.evidence.quote.includes(thread.content)&&!x.facts.some(f=>f.content===thread.content&&f.revealed))fail('剧情线内容没有原文或公开事实来源');
    if(thread.status==='resolved'&&!old)fail('不存在的剧情线不能直接完成');
    const item={id:old?.id||crypto.randomUUID(),type:thread.type,content:thread.content,status:thread.status,sourceTurnId:turnId,evidence:thread.evidence};
    state.storyThreads=[...(state.storyThreads||[]).filter(t=>t.id!==item.id),item];
  }
  state.factIds=[...state.factIds,...effects.facts.map(f=>f.id)];state.messageCount++;
  if(state.sceneId!==previous.sceneId){
    const scene=history.filter(t=>t.state.sceneId===previous.sceneId);
    if(scene.length)effects.summaries.push({id:crypto.randomUUID(),sourceTurnIds:scene.map(t=>t.id),cutoffTurnId:scene.at(-1)!.id,content:scene.flatMap(t=>t.effects.facts).map(f=>f.kind+'：'+f.content).join('\n').slice(0,3000)||'此场景未新增已整理事实，原文仍完整保留。',version:1});
  }
  return {state,effects};
}
