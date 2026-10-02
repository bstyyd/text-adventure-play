import type { Turn } from '../domain/types';
import { CharacterIdSchema } from '../domain/identity';
import {scenarioFor} from '../scenario/runtime';
import { allCharacterEvents, allCharacters } from './world';

export function validateCharacterArchive(turns:Turn[]){
  const isSeedId=(id:string)=>scenarioFor([turns[0]]).characters.some(c=>c.stableId===id);
  const nodes=new Map(turns.map(t=>[t.id,t])),characters=allCharacters(turns),events=allCharacterEvents(turns);
  const people=new Map(characters.map(c=>[c.id,c])),eventMap=new Map(events.map(e=>[e.id,e]));
  if(people.size!==characters.length||eventMap.size!==events.length)throw new Error('人物或履历 ID 重复。');
  for(const c of characters){
    const source=eventMap.get(c.createdByEventId);
    if(!source||source.kind!=='created'||source.characterId!==c.id||source.sourceTurnId!==c.createdAtTurnId||source.saveId!==c.saveId||
      (isSeedId(c.id)?c.seedKey!==c.id:c.seedKey!==null))throw new Error('人物创建来源或种子 ID 无效。');
  }
  for(const turn of turns){
    const ancestry=new Set<string>();let current:Turn|undefined=turn;
    while(current){if(ancestry.has(current.id))throw new Error('人物来源节点循环。');ancestry.add(current.id);current=current.parentTurnId?nodes.get(current.parentTurnId):undefined;}
    const person=(id:string,allowPlayer=false)=>{
      if(id==='player'&&allowPlayer)return;
      if(!CharacterIdSchema.safeParse(id).success||!people.has(id)||!ancestry.has(people.get(id)!.createdAtTurnId))throw new Error('人物引用来自其他分支、未来或不存在。');
    };
    for(const id of [...turn.state.present,...turn.state.contacted,...Object.keys(turn.state.relationships),...Object.keys(turn.state.romancePolicies||{}),...turn.state.events.flatMap(e=>e.npcIds),...turn.effects.facts.flatMap(f=>f.knownBy),...turn.effects.knowledge.map(k=>k.npcId)])person(id);
    for(const f of turn.effects.facts)if(f.subject.startsWith('new:')||people.has(f.subject)||/^[0-9a-f-]{36}$/.test(f.subject))person(f.subject);
    const local=turn.effects.characterEvents||[];
    const eventSource=(id:string|null,position:number)=>{
      if(!id)return;
      const source=eventMap.get(id);
      if(!source||!ancestry.has(source.sourceTurnId)||(source.sourceTurnId===turn.id&&local.findIndex(e=>e.id===id)>position))throw new Error('履历引用来自未来或另一分支。');
    };
    for(const [position,e] of local.entries()){
      if(e.saveId!==turn.saveId||e.sourceTurnId!==turn.id||e.branchId!==turn.branchId)throw new Error('履历来源节点或存档不匹配。');
      person(e.characterId);e.knownBy.forEach(id=>person(id,true));if(e.actorId)person(e.actorId,true);
      if(e.sourceKind==='story'){
        const source=e.evidence.blockId==='player'?turn.playerText:turn.body.split(/\n\s*\n/).filter(Boolean)[Number(e.evidence.blockId.slice(1))];
        if(!source?.includes(e.evidence.quote))throw new Error('履历来源引文缺失。');
      }else if(e.sourceKind==='configuration'){
        if(turn.kind!=='configuration'||e.kind!=='policy')throw new Error('配置履历不属于配置节点。');
      }else {
        const p=scenarioFor([turns[0]]),seed=p.characters.find(c=>c.stableId===e.characterId);
        const allowedProfile=e.kind==='profile'&&seed&&e.data.certainty==='confirmed'&&e.data.operation==='add'&&((e.data.field==='alias'&&seed.aliases.includes(e.data.value))||(e.data.field==='faction'&&!!seed.faction&&e.data.value===(p.factions.find(f=>f.id===seed.faction)?.name||seed.faction)));
        const allowedRelation=e.kind==='relationship'&&seed&&seed.relationships.some(r=>r.toCharacterId===e.data.toCharacterId&&e.data.fromCharacterId===seed.stableId&&r.category===e.data.category&&r.relationshipType===e.data.relationshipType&&r.description===e.data.description&&r.revealed===e.revealed&&JSON.stringify(r.knownBy)===JSON.stringify(e.knownBy));
        if(turn.parentTurnId!==null||!isSeedId(e.characterId)||!['created','office'].includes(e.kind)&&!allowedProfile&&!allowedRelation)throw new Error('仅种子初始记录可使用设定／旧档来源。');
      }
      if(e.kind==='created'&&people.get(e.characterId)?.createdByEventId!==e.id)throw new Error('同一人物重复创建。');
      if(e.kind==='office'){
        if(e.data.characterId!==e.characterId||e.data.sourceEventId!==e.id)throw new Error('职务主体或来源错误。');
        [e.data.validFromEventId,e.data.validUntilEventId,e.data.arrivedByEventId].forEach(id=>eventSource(id,position));
        for(const id of [e.data.validFromEventId,e.data.validUntilEventId,e.data.arrivedByEventId])if(id){const ref=eventMap.get(id);if(ref?.kind!=='office'||ref.data.id!==e.data.id)throw new Error('任职流程来源属于另一职务。');}
      }
      if(e.kind==='relationship'){
        person(e.data.fromCharacterId,true);person(e.data.toCharacterId,true);
        eventSource(e.data.establishedByEventId,position);eventSource(e.data.endedByEventId,position);
        for(const id of [e.data.establishedByEventId,e.data.endedByEventId])if(id){const ref=eventMap.get(id);if(ref?.kind!=='relationship'||ref.data.id!==e.data.id)throw new Error('关系来源属于另一关系。');}
      }
      if(e.kind==='knowledge'){
        person(e.data.knowerId,true);eventSource(e.data.informationEventId,position);
        if(eventMap.get(e.data.informationEventId)?.characterId!==e.characterId)throw new Error('人物认知主体错误。');
      }
      if(e.kind==='mention')e.data.candidates.forEach(id=>person(id));
    }
  }
}
