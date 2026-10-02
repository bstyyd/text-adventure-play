import { createHash } from 'node:crypto';
import {scenarioFor} from '../scenario/runtime';
import type { Turn } from '../domain/types';
import type { Character, CharacterEvent, CharacterView } from './schema';

// Request/event identities, never names or titles, are the inputs to stable IDs.
export function stableId(key:string){
  const hex=createHash('sha256').update(key).digest('hex').slice(0,32).split('');
  hex[12]='4';hex[16]='8';const s=hex.join('');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
export function seedCharacters(turn:Turn,legacy=false):{characters:Character[];characterEvents:CharacterEvent[]}{
  const characters:Character[]=[],characterEvents:CharacterEvent[]=[];
  const p=scenarioFor([turn]);
  for(const item of p.characters){
    const npc={id:item.stableId,name:item.displayName,role:item.identity||'身份未确认',public:item.description.slice(0,300)||'剧情作用尚未说明',age:item.age};
    const id=stableId(turn.id+':seed:'+npc.id);
    characters.push({id:npc.id,saveId:turn.saveId,seedKey:npc.id,createdByEventId:id,createdAtTurnId:turn.id,schemaVersion:1});
    const base={saveId:turn.saveId,branchId:turn.branchId,sourceTurnId:turn.id,characterId:npc.id,actorId:null,before:null,
      gameTime:{year:turn.state.date.year,month:turn.state.date.month,day:turn.state.date.day,minuteOfDay:turn.state.date.minuteOfDay},
      recordedAt:turn.createdAt,revealed:true,knownBy:['player',npc.id],sourceKind:legacy?'legacy' as const:'canon' as const,
      evidence:{blockId:legacy?'legacy':'canon',quote:legacy?'旧存档导入；任职经过及首次见面细节未知。':p.manifest.packageId+'：'+npc.name+'，'+npc.role+'。'}};
    characterEvents.push({...base,id,kind:'created',data:{name:npc.name,referenceName:npc.name,identity:npc.role,identityStatus:'confirmed',
      roleInStory:npc.public,motivation:null,relevance:item.importance,presence:turn.state.present.includes(npc.id)?'present':'elsewhere',location:item.initialLocation?p.locations.find(l=>l.id===item.initialLocation)?.name||null:null,romancePolicy:item.romancePolicy,age:npc.age,legacy}});
    for(const alias of item.aliases){const eid=stableId(id+':alias:'+alias);characterEvents.push({...base,id:eid,kind:'profile',data:{field:'alias',value:alias,operation:'add',certainty:'confirmed',reason:'剧本初始别名'}});}
    if(item.faction){const eid=stableId(id+':faction');characterEvents.push({...base,id:eid,kind:'profile',data:{field:'faction',value:p.factions.find(f=>f.id===item.faction)?.name||item.faction,operation:'add',certainty:'confirmed',reason:'剧本初始势力'}});}
    for(const [index,role] of item.roles.entries()){
      const eid=stableId(id+':role:'+index);
      characterEvents.push({...base,id:eid,kind:'office',data:{id:stableId(id+':assignment:'+index),characterId:npc.id,title:role.title,roleType:role.roleType,
        organization:role.organization,assignmentKind:role.assignmentKind,stage:'active',
        authorityScope:role.authorityScope,sourceEventId:eid,validFromEventId:null,validUntilEventId:null,arrivedByEventId:null}});
    }
    for(const [index,r] of item.relationships.entries()){const eid=stableId(id+':relation:'+index);characterEvents.push({...base,id:eid,revealed:r.revealed,knownBy:r.knownBy,kind:'relationship',data:{id:stableId(eid+':relation'),fromCharacterId:npc.id,toCharacterId:r.toCharacterId,category:r.category,relationshipType:r.relationshipType,description:r.description,establishedByEventId:eid,endedByEventId:null}});}
  }
  return {characters,characterEvents};
}
export function allCharacterEvents(turns:Turn[]){
  return turns.flatMap((turn,i)=>turn.effects.characterEvents||(i===0?seedCharacters(turn,true).characterEvents:[]));
}
export function allCharacters(turns:Turn[]){
  return turns.flatMap((turn,i)=>turn.effects.characters||(i===0?seedCharacters(turn,true).characters:[]));
}
export function characterWorld(turns:Turn[],perspective='player'):CharacterView[]{
  if(!turns.length)return [];
  const meta=new Map(allCharacters(turns).map(c=>[c.id,c]));
  const events=allCharacterEvents(turns),byId=new Map(events.map(e=>[e.id,e]));
  const visible=(e:CharacterEvent)=>perspective==='narrator'||(perspective==='player'?e.revealed:e.knownBy.includes(perspective));
  const observed:CharacterEvent[]=[];const observedIds=new Set<string>();
  for(const event of events){
    if(visible(event)){observed.push(event);observedIds.add(event.id);}
    if(event.kind==='knowledge'&&event.data.knowerId===perspective&&event.data.certainty==='known'){
      const information=byId.get(event.data.informationEventId);
      if(information&&!observedIds.has(information.id)){
        observed.push({...information,sourceTurnId:event.sourceTurnId,evidence:event.evidence,recordedAt:event.recordedAt,gameTime:event.gameTime,before:null,revealed:perspective==='player'});
        observedIds.add(information.id);
      }
    }
  }
  const result=new Map<string,CharacterView>();
  for(const e of observed){
    if(e.kind==='mention')continue;
    const c=meta.get(e.characterId);if(!c)continue;
    let view=result.get(c.id);
    if(!view){
      view={id:c.id,seedKey:c.seedKey,name:'姓名未知',canonicalName:null,aliases:[],identity:'身份未确认',roleInStory:'',
        relevance:'supporting',visibility:'mentioned',availability:'elsewhere',lifeStatus:'unknown',location:null,age:null,
        romancePolicy:'disabled',factions:[],conditions:[],firstMentionTurnId:e.sourceTurnId,firstAppearanceTurnId:null,lastInteractionTurnId:e.sourceTurnId,
        notes:[],offices:[],relations:[],timeline:[],pendingThreads:[],legacy:false,possibleDuplicates:[]};result.set(c.id,view);
    }
    if(e.kind!=='policy')view.lastInteractionTurnId=e.sourceTurnId;
    if(e.kind==='created'){
      const d=e.data;view.name=d.referenceName;view.canonicalName=d.identityStatus==='confirmed'?d.name:null;
      if(view.canonicalName)view.name=view.canonicalName;
      view.aliases=[...new Set([d.referenceName,...(d.name?[d.name]:[])])];view.identity=(d.identityStatus==='confirmed'?'':d.identityStatus==='claim'?'自称：':d.identityStatus==='rumor'?'传闻：':'待核：')+d.identity;view.roleInStory=d.roleInStory;
      view.relevance=d.relevance;view.visibility=d.presence==='mentioned'?'mentioned':d.presence==='hidden'?'hidden':'known';
      view.availability=d.presence==='present'?'present':'elsewhere';view.location=d.location;view.age=d.age;
      if(c.seedKey||d.presence==='present')view.lifeStatus='alive';
      view.romancePolicy=d.romancePolicy;view.legacy=d.legacy;
      if(d.presence==='present')view.firstAppearanceTurnId=e.sourceTurnId;
      view.notes.push({field:'identity',value:d.identity,certainty:d.identityStatus,sourceEventId:e.id,sourceTurnId:e.sourceTurnId});
      if(perspective==='narrator'&&d.motivation)view.notes.push({field:'motivation',value:d.motivation,certainty:'suspicion',sourceEventId:e.id,sourceTurnId:e.sourceTurnId});
    }else if(e.kind==='profile'){
      const d=e.data;view.notes.push({field:d.field,value:d.value,certainty:d.certainty,sourceEventId:e.id,sourceTurnId:e.sourceTurnId});
      if(d.certainty==='confirmed'){
        if(d.field==='name'){view.aliases=[...new Set([...view.aliases,view.name,d.value])];view.name=d.value;view.canonicalName=d.value;}
        if(d.field==='alias')view.aliases=d.operation==='remove'?view.aliases.filter(n=>n!==d.value):[...new Set([...view.aliases,d.value])];
        if(d.field==='identity')view.identity=d.value;
        if(d.field==='faction')view.factions=d.operation==='remove'?view.factions.filter(n=>n!==d.value):[...new Set([...view.factions,d.value])];
        if(d.field==='condition')view.conditions=d.operation==='remove'?view.conditions.filter(n=>n!==d.value):[...new Set([...view.conditions,d.value])];
        if(d.field==='location')view.location=d.value;
        if(d.field==='age')view.age=Number(d.value);
        if(d.field==='lifeStatus')view.lifeStatus=d.value as CharacterView['lifeStatus'];
        if(d.field==='availability')view.availability=d.value as CharacterView['availability'];
      }
    }else if(e.kind==='office')view.offices=[...view.offices.filter(o=>o.id!==e.data.id),e.data];
    else if(e.kind==='relationship'){
      for(const id of [e.data.fromCharacterId,e.data.toCharacterId]){
        const other=result.get(id);if(other)other.relations=[...other.relations.filter(r=>r.id!==e.data.id),e.data];
      }
    }else if(e.kind==='policy'){view.romancePolicy=e.data.romancePolicy;if(e.data.relevance)view.relevance=e.data.relevance;}
    // A public event may follow a secret one; never serialize its private "before" snapshot.
    const safe=structuredClone(e);if(perspective!=='narrator'){safe.before=null;if(safe.kind==='created')safe.data.motivation=null;}
    view.timeline.push(safe);
  }
  // Relationships are directed. Attach to both visible pages without synthesizing reverse attitudes.
  const relations=new Map(observed.filter(e=>e.kind==='relationship').map(e=>[e.data.id,e.data]));
  for(const view of result.values()){
    view.relations=[...relations.values()].filter(r=>(r.fromCharacterId===view.id||r.toCharacterId===view.id)&&[r.fromCharacterId,r.toCharacterId].every(id=>id==='player'||result.has(id)));
    for(const turn of turns)if(turn.kind!=='configuration'&&turn.state.present.includes(view.id)){
      view.firstAppearanceTurnId??=turn.id;view.lastInteractionTurnId=turn.id;view.visibility='known';
    }
    if(turns.at(-1)!.state.present.includes(view.id)){view.availability='present';view.location=turns.at(-1)!.state.location;}
    else if(view.availability==='present')view.availability='elsewhere';
    view.pendingThreads=turns.flatMap(t=>t.effects.facts).filter(f=>['promise','order','intent','unresolved'].includes(f.kind)&&
      (perspective==='narrator'||(perspective==='player'?f.revealed:f.knownBy.includes(perspective)))&&
      (f.subject===view.id||f.subject===view.name||view.aliases.includes(f.subject))).map(f=>f.content);
    view.timeline=view.timeline.map(e=>({...e,actorId:e.actorId==='player'||result.has(e.actorId||'')?e.actorId:null,knownBy:e.knownBy.filter(id=>id==='player'||result.has(id))}));
    const scenario=scenarioFor(turns);
    const values=turns.at(-1)!.state.relationships[view.id]?.values;
    if(values)view.stats={...values};
    view.locationId=view.location?(scenario.locations.find(l=>l.name===view.location)?.id||turns.at(-1)!.state.dynamicLocations?.find(l=>l.name===view.location)?.id||null):null;
    view.factionIds=view.factions.map(n=>scenario.factions.find(f=>f.id===n||f.name===n)?.id).filter((n):n is string=>!!n);
    view.possibleDuplicates=[...result.values()].filter(c=>c.id!==view.id&&c.name===view.name).map(c=>c.id);
  }
  return [...result.values()];
}
export function resolveMentions(text:string,characters:CharacterView[]){
  const labels=new Map<string,string[]>();
  for(const c of characters)for(const name of new Set([c.name,...c.aliases])){
    if(name.length<2||!text.includes(name))continue;
    labels.set(name,[...new Set([...(labels.get(name)||[]),c.id])]);
  }
  return [...labels].map(([label,candidates])=>({label,candidates,resolvedId:candidates.length===1?candidates[0]:null}));
}
