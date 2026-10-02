import type { Evidence, Extraction, State, Turn } from '../domain/types';
import {scenarioFor,attachScenario} from '../scenario/runtime';
import { ValidationError } from '../engine/errors';
import { allCharacters, allCharacterEvents, characterWorld, stableId } from './world';
import type { Character, CharacterEvent, CharacterView, OfficeAssignment } from './schema';

const fail=(message:string):never=>{throw new ValidationError(message);};
const uncertain=/考虑|假如|如果|倘若|或许|可能|据说|传闻|自称|声称|提议|建议|打算|是否|要不要|能否|可否|不如|希望|设想|拟议|准备|计划|应当|听说|转述|说过|说要|曾说|[？?]|暂不|暂缓|不要|不准|未曾|未下令|并未|并非|(?:勿|别)(?:让|任命|授予|罢免|处罚|兼任|授权)|若(?:让|任|是|要)|不(?:予|再|必)?(?:任命|授予|罢免|处罚|兼任)|未(?:批准|授权|任命)/;
const orderWords=/任命|命.{0,12}任|兼任|代理|差遣|授予|封为|罢免|免去|革去|撤销|赐|罚|杖|拘押|处置/;
const blocks=(body:string)=>Object.fromEntries(body.split(/\n\s*\n/).filter(Boolean).map((text,i)=>['b'+i,text]));

export function prepareCharacters(previous:State,input:string,body:string,raw:Extraction,turnId:string,history:Turn[],requestId:string,branchId:string){
  const scenario=scenarioFor(history);
  const isSeedId=(id:string)=>scenario.characters.some(c=>c.stableId===id);
  const x=structuredClone(raw),saveId=history[0].saveId,old=characterWorld(history,'narrator');
  const characters:Character[]=[],events:CharacterEvent[]=[],mapping=new Map<string,string>();
  const ids=new Set(allCharacters(history).map(c=>c.id)),references=new Map<string,string>();
  const source:Record<string,string>={player:input,...blocks(body)};
  const evidence=(e:Evidence)=>{if(!source[e.blockId]?.includes(e.quote))fail('人物变更的来源引文不在本轮原文中。');};
  const reserve=(ref:string)=>{if(references.has(ref))fail('人物提案引用重复：'+ref);const id=stableId(requestId+':event:'+ref);references.set(ref,id);return id;};
  if(!scenario.manifest.dynamicCharacters&&x.proposedCharacterCreations?.length)fail('此剧本未启用动态人物');
  if(!scenario.manifest.roleSystem&&x.proposedOfficeChanges?.length)fail('此剧本未启用身份职务系统');
  for(const c of x.proposedCharacterCreations||[]){
    if(mapping.has(c.draftRef))fail('新人物 draftRef 重复。');
    mapping.set(c.draftRef,stableId(saveId+':'+requestId+':character:'+c.draftRef));reserve(c.draftRef);
  }
  for(const proposals of [x.proposedCharacterChanges,x.proposedOfficeChanges,x.proposedRelationshipChanges,x.proposedKnowledgeChanges,x.unresolvedMentions])
    for(const p of proposals||[])reserve(p.ref);
  const resolve=(ref:string,player=false)=>{
    if(ref==='player'&&player)return ref;
    const id=mapping.get(ref)||ref;if(!ids.has(id)&&![...mapping.values()].includes(id))fail('人物 ID 不在当前分支可见记录中：'+ref);return id;
  };
  if(x.sceneProposal)x.sceneProposal.present=x.sceneProposal.present.map(n=>resolve(n));
  for(const f of x.facts){if(f.subject.startsWith('new:')||ids.has(f.subject)||/^[0-9a-f-]{36}$/.test(f.subject))f.subject=resolve(f.subject);f.knownBy=f.knownBy.map(n=>resolve(n));}
  for(const k of x.knowledgeProposals)k.npcId=resolve(k.npcId);
  for(const r of x.relationshipEvidence){resolve(r.npcId);if(previous.relationships[r.npcId]?.values[r.axis]===undefined)fail('此人物尚未开放该数值，请记录有依据的态度或明确配置。');}
  const present=new Set([...previous.present,...(x.sceneProposal?.present||[])]);
  const view=(id:string)=>old.find(c=>c.id===id)||newViews.find(c=>c.id===id);
  const newViews:{id:string;name:string;aliases:string[];seedKey:null}[]=[];
  const names=(id:string)=>id==='player'?[scenario.player.name,...scenario.player.aliases]:view(id)?[view(id)!.name,...view(id)!.aliases]:[];
  const mentions=(text:string,id:string)=>names(id).some(n=>n&&text.includes(n));
  const common=(ref:string,characterId:string,p:{evidence:Evidence;revealed:boolean;knownBy:string[]},actorId:string|null=null)=>{
    evidence(p.evidence);const knownBy=[...new Set(p.knownBy.map(n=>resolve(n,true)))];
    if(!p.revealed&&knownBy.includes('player'))fail('玩家已知的信息不能被同时标成未公开。');
    for(const knower of knownBy)if(knower!=='player'&&knower!==characterId&&!present.has(knower))
      fail('人物变更的知情者未在场；远方获知须单独记录送达事件。');
    if(p.revealed&&!knownBy.includes('player'))knownBy.push('player');
    return {id:references.get(ref)!,saveId,branchId,sourceTurnId:turnId,characterId,actorId,before:null,
      gameTime:{year:previous.date.year,month:previous.date.month,day:previous.date.day,minuteOfDay:previous.date.minuteOfDay},
      recordedAt:new Date().toISOString(),revealed:p.revealed,knownBy,evidence:p.evidence,sourceKind:'story' as const};
  };
  const authorityText=(authorization:{sourceTurnId:string|null;evidence:Evidence}|null|undefined)=>{
    if(!authorization)return input;
    const sourceTurn=authorization.sourceTurnId?history.find(t=>t.id===authorization.sourceTurnId):null;
    if(authorization.sourceTurnId&&!sourceTurn)fail('授权来源不在当前分支的过去节点中。');
    if(authorization.evidence.blockId!=='player')fail('玩家授权必须来自玩家原文。');
    const value=sourceTurn?sourceTurn.playerText:input;
    if(!value.includes(authorization.evidence.quote))fail('授权引文不在玩家原文中。');
    if(uncertain.test(value))fail('不能截取假设或否定语句中的片段冒充授权。');
    return authorization.evidence.quote;
  };
  const playerOrder=(id:string,title:string,authorization?:{sourceTurnId:string|null;evidence:Evidence}|null)=>{
    const text=authorityText(authorization);
    if(uncertain.test(text)||!orderWords.test(text)||!mentions(text,id)||!text.includes(title))fail('任免、封赏或处罚缺少玩家明确授权；提议、假设和传闻不是已下令。');
  };
  const appointmentAction=(text:string,stage:string)=>{
    if(stage==='ordered'&&(!/任命|命.{0,12}任|兼任|代理|差遣|授予|封为|赐/.test(text)||/罢免|免去|革去|撤销|辞去|辞职|辞任/.test(text)))fail('玩家或行动者的原令不是授职，不能登记为任命命令。');
    if(stage==='ended'&&!/罢免|免去|革去|撤销|辞去|辞职|辞任/.test(text))fail('离任需要明确免职或辞职依据，授职命令不能当作免职。');
    if(stage!=='proposed'&&/(?:尚未|仍未|还未|未能|并未|还没|没有|未|不)(?:正式)?(?:生效|到任|抵达|履任|离任|下令|被?任命)/.test(text))fail('未生效、未到任或未下令不能记为已完成的任职阶段。');
  };
  for(const c of x.proposedCharacterCreations||[]){
    evidence(c.evidence);
    if(/们$|众人|众官|百姓|群体|军队|全体/.test(c.referenceName))fail('泛指群体不登记为独立人物。');
    if(!c.evidence.quote.includes(c.referenceName)&&!(c.name&&c.evidence.quote.includes(c.name)))fail('新人物名字或暂称缺少直接来源。');
    if(c.identityStatus==='confirmed'&&uncertain.test(c.evidence.quote))fail('自称或传闻只能登记为未确认身份。');
    const id=mapping.get(c.draftRef)!;newViews.push({id,name:c.name||c.referenceName,aliases:[c.referenceName],seedKey:null});
    if(c.presence==='present'&&!x.sceneProposal?.present.includes(id))fail('新人物登场必须与本轮在场快照一致。');
    if(c.presence==='mentioned'&&x.sceneProposal?.present.includes(id))fail('仅被提及的人物不能自动在场。');
    if(c.presence==='hidden'&&c.revealed)fail('隐藏人物不能同时标记为向玩家公开。');
    if(!c.revealed&&x.sceneProposal?.present.includes(id))fail('前台场景不能包含尚未公开的人物。');
    const base=common(c.draftRef,id,c);
    const {draftRef:_draftRef,evidence:_evidence,knownBy:_knownBy,revealed:_revealed,...data}=c;
    void _draftRef;void _evidence;void _knownBy;void _revealed;
    events.push({...base,kind:'created',data:{...data,romancePolicy:'disabled',age:null,legacy:false}});
    characters.push({id,saveId,seedKey:null,createdByEventId:base.id,createdAtTurnId:turnId,schemaVersion:1});ids.add(id);
  }
  for(const p of x.proposedCharacterChanges||[]){
    const id=resolve(p.characterId),actor=p.actorId?resolve(p.actorId,true):null;
    const base=common(p.ref,id,p,actor);
    const projection:Turn={...history.at(-1)!,id:turnId,branchId,effects:{...history.at(-1)!.effects,facts:[],characters,characterEvents:events}};
    const prior=characterWorld([...history,attachScenario(projection,scenario)],'narrator').find(c=>c.id===id);
    if(p.certainty==='confirmed'&&uncertain.test(p.evidence.quote))fail('身份自称、猜测或传闻不能直接确认为事实。');
    if(['name','alias','age','identity','faction','location','condition'].includes(p.field)&&!p.evidence.quote.includes(p.value))fail('人物身份或处境变更缺少直接原文证据。');
    if(isSeedId(id)&&['background','personality','motivation'].includes(p.field)&&p.operation==='set')fail('种子人物的既定背景不能被整项覆盖，可登记有来源的成长或新线索。');
    if(p.field==='age'&&(!/^\d{1,3}$/.test(p.value)||+p.value>150||isSeedId(id)))fail('年龄必须有明确数字依据，不能覆盖种子人物年龄。');
    if(p.field==='availability'&&!['present','elsewhere','unreachable','departed'].includes(p.value))fail('不支持的人物去向。');
    if(p.field==='lifeStatus'&&!['alive','deceased','unknown'].includes(p.value))fail('不支持的生存状态。');
    if(p.field==='availability'&&p.value==='present'&&!x.sceneProposal?.present.includes(id)&&!previous.present.includes(id))fail('在场状态与场景不一致。');
    if(actor==='player'&&p.field==='condition')playerOrder(id,p.value,p.authorization);
    if(['faction','lifeStatus','condition'].includes(p.field)&&!actor)fail('阵营、伤亡或处境变化须记录行动者和原因。');
    const priorField=({alias:'aliases',faction:'factions',condition:'conditions'} as Record<string,string>)[p.field]||p.field;
    const before=prior?{[p.field]:['background','personality','motivation'].includes(p.field)?prior.notes.filter(n=>n.field===p.field):Reflect.get(prior,priorField)??null}:null;
    events.push({...base,before,kind:'profile',data:{field:p.field,value:p.value,operation:p.operation,certainty:p.certainty,reason:p.reason}});
    if(p.certainty==='confirmed'&&['name','alias'].includes(p.field)){
      const reference=view(id);if(reference){reference.aliases=[...new Set([...reference.aliases,reference.name,p.value])];if(p.field==='name')reference.name=p.value;}
    }
  }
  const offices=new Map(old.flatMap(c=>c.offices).map(o=>[o.id,o]));
  for(const p of x.proposedOfficeChanges||[]){
    const id=resolve(p.characterId),actor=resolve(p.actorId,true),base=common(p.ref,id,p,actor);
    if(/^[0-9a-f-]{36}$/.test(p.assignmentRef)&&!offices.has(p.assignmentRef))fail('任职记录不在当前分支中。');
    const aid=offices.has(p.assignmentRef)?p.assignmentRef:stableId(requestId+':office:'+p.assignmentRef),prior=offices.get(aid);
    if(prior&&(prior.characterId!==id||prior.title!==p.title||prior.organization!==p.organization||prior.assignmentKind!==p.assignmentKind))fail('已有职务记录不可换人或改成另一职务，请新建任职记录。');
    if(!p.evidence.quote.includes(p.title)||!mentions(p.evidence.quote,id))fail('职务变更必须引用当事人与具体职务。');
    if(p.stage!=='proposed'&&uncertain.test(p.evidence.quote))fail('任职提议或传闻不能写成实际任命。');
    appointmentAction(p.evidence.quote,p.stage);
    if(actor==='player'&&['ordered','ended'].includes(p.stage))appointmentAction(authorityText(p.authorization),p.stage);
    if(!scenario.characters.some(c=>c.roles.some(r=>r.organization===p.organization))&&!p.evidence.quote.includes(p.organization))fail('新职务组织缺少原文依据。');
    if(p.assignmentKind==='honorary'&&p.authorityScope.length)fail('荣誉称号不自动赋予职权。');
    if(!prior&&p.authorityScope.some(scope=>!p.evidence.quote.includes(scope)))fail('新增职责或任免权限必须有原文依据。');
    if(prior&&JSON.stringify(prior.authorityScope)!==JSON.stringify(p.authorityScope))fail('职务流程不能悄悄扩大权限。');
    if(p.stage==='ordered'||p.stage==='ended'){
      if(actor==='player')playerOrder(id,p.title,p.authorization);
      else if(p.stage==='ended'&&actor===id&&/辞去|辞职|辞任/.test(p.evidence.quote)){
        // A resignation is the character's act, distinct from a sovereign's dismissal.
      }else{
        if(!mentions(p.evidence.quote,actor)||!orderWords.test(p.evidence.quote))fail('NPC 任免须有行动者实际下令的来源，称呼本身不授予职位。');
        const authority=[...allCharacterEvents(history),...events].find(e=>e.id===p.authorityEventId);
        const ownOffice=authority?.kind==='office'?offices.get(authority.data.id):undefined;
        const delegated=authorityText(p.authorization);
        const explicitDelegation=!!p.authorization&&!uncertain.test(delegated)&&/授权|全权/.test(delegated)&&mentions(delegated,actor)&&delegated.includes(p.organization)&&/任免|任用/.test(delegated);
        if(!explicitDelegation&&(!ownOffice||ownOffice.characterId!==actor||!['active','arrived'].includes(ownOffice.stage)||!ownOffice.authorityScope.includes('任免:'+p.organization)))fail('NPC 任免缺少有效职权或玩家明确授权。');
      }
    }
    if(p.stage==='proposed'&&prior&&prior.stage!=='proposed')fail('已生效任命不能退回提议阶段。');
    if(p.stage==='ordered'&&prior&&prior.stage!=='proposed')fail('任命不能重复下令或复活已离任职位。');
    if(p.stage==='active'&&(!prior||prior.stage!=='ordered'||!/生效|就任|履任/.test(p.evidence.quote)))fail('职务生效须有先前有效命令与生效证据。');
    if(p.stage==='arrived'&&(!prior||!['active','arrived'].includes(prior.stage)||!/到任|抵达|履任/.test(p.evidence.quote)))fail('到任须有生效职务和实际抵达依据。');
    if(p.stage==='ended'&&(!prior||prior.stage==='ended'))fail('离任须对应尚未结束的已有职务。');
    const next:OfficeAssignment={id:aid,characterId:id,title:p.title,organization:p.organization,roleType:p.roleType||'office',assignmentKind:p.assignmentKind,stage:p.stage,authorityScope:p.authorityScope,
      sourceEventId:base.id,validFromEventId:p.stage==='active'?base.id:prior?.validFromEventId||null,
      validUntilEventId:p.stage==='ended'?base.id:prior?.validUntilEventId||null,arrivedByEventId:p.stage==='arrived'?base.id:prior?.arrivedByEventId||null};
    offices.set(aid,next);events.push({...base,before:prior?{...prior}:null,kind:'office',data:next});
  }
  const relations=new Map(old.flatMap(c=>c.relations).map(r=>[r.id,r]));
  for(const p of x.proposedRelationshipChanges||[]){
    const from=resolve(p.fromCharacterId,true),to=resolve(p.toCharacterId,true);
    if(from===to)fail('人物不能与自己建立人际关系。');
    const owner=from==='player'?to:from,base=common(p.ref,owner,p,from);
    if(p.category==='objective'&&uncertain.test(p.evidence.quote))fail('传闻或自称不能直接建立客观人际关系。');
    if(!mentions(p.evidence.quote,from)||!mentions(p.evidence.quote,to))fail('关系来源须包含双方身份线索。');
    const rid=relations.has(p.relationshipRef)?p.relationshipRef:stableId(requestId+':relation:'+p.relationshipRef),prior=relations.get(rid);
    if(p.operation==='end'&&(!prior||prior.endedByEventId))fail('关系结束须对应有效关系。');
    if(prior&&(prior.fromCharacterId!==from||prior.toCharacterId!==to||prior.category!==p.category))fail('关系记录不能偷换主体。');
    const data={id:rid,fromCharacterId:from,toCharacterId:to,category:p.category,relationshipType:p.relationshipType,description:p.description,
      establishedByEventId:prior?.establishedByEventId||base.id,endedByEventId:p.operation==='end'?base.id:null};
    relations.set(rid,data);events.push({...base,before:prior?{...prior}:null,kind:'relationship',data});
  }
  for(const p of x.proposedKnowledgeChanges||[]){
    const about=resolve(p.aboutCharacterId),knower=resolve(p.knowerId,true),informationId=references.get(p.informationEventRef)||p.informationEventRef;
    const information=[...allCharacterEvents(history),...events].find(e=>e.id===informationId);
    if(!information||information.characterId!==about||information.kind==='knowledge')fail('人物认知引用的来源不存在或主体不匹配。');
    evidence(p.evidence);
    if(p.path==='witness'&&knower!=='player'&&!present.has(knower))fail('未在场人物不能自动获知身份变化。');
    if(p.path==='self'&&knower!==about)fail('自身认知不能用于转告别人。');
    if(!['witness','self'].includes(p.path)&&(!mentions(p.evidence.quote,knower)||!/收到|送达|获知|告知|查得|转告|听到/.test(p.evidence.quote)))fail('身份消息须有实际获知或送达证据。');
    // The acquiring person is allowed to be elsewhere; this event supplies the delivery path.
    const base=common(p.ref,about,{...p,knownBy:p.knownBy.filter(n=>resolve(n,true)!==knower)},knower);
    base.knownBy=[...new Set([...base.knownBy,knower])];
    if(knower==='player'&&!p.revealed)fail('玩家获知的信息必须向玩家显示。');
    events.push({...base,kind:'knowledge',data:{knowerId:knower,informationEventId:informationId,certainty:p.certainty,path:p.path}});
  }
  for(const p of x.unresolvedMentions||[]){
    const candidates=p.candidates.map(n=>resolve(n));
    const owner=candidates[0]||allCharacters(history)[0]?.id;
    if(!owner)fail('未解析提及缺少当前存档。');
    events.push({...common(p.ref,owner,p),kind:'mention',data:{label:p.label,candidates}});
  }
  const publicBefore=new Set(characterWorld(history).map(c=>c.id));
  for(const e of events)if(e.revealed&&e.kind==='created')publicBefore.add(e.characterId);
  for(const e of events)if(e.revealed&&e.kind==='relationship'&&[e.data.fromCharacterId,e.data.toCharacterId].some(id=>id!=='player'&&!publicBefore.has(id)))fail('公开关系不可泄露未公开人物。');
  for(const match of body.matchAll(/(?:名叫|名为|姓名是)([\u4e00-\u9fff]{2,4})(?=[，。、；“”])/g)){
    if(![...old,...newViews].some(c=>[c.name,...c.aliases].includes(match[1])))fail('正文引入了具名人物，但整理结果缺少人物登记；草稿保留。');
  }
  if(/(?:任命正式生效|已被罢免|正式到任|正式授予)/.test(body)&&!x.proposedOfficeChanges?.length)fail('正文出现职务变更，但整理结果没有对应履历。');
  return {extraction:x,characters,characterEvents:events,newViews,allViews:[...old,...newViews] as Pick<CharacterView,'id'|'name'|'aliases'|'seedKey'>[]};
}
