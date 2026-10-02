import type { Draft, View } from '../domain/types';
import { characterWorld } from './world';
import { draftRevision } from '../engine/draft-review';
import { MEMORY_NOTICES } from '../engine/normalize-extraction';

export function publicDraft(d:Draft){return {...d,extraction:null,localSaveRevision:d.extraction&&d.bodyComplete===true&&d.mode==='story'&&['failed','cancelled'].includes(d.status)?draftRevision(d):undefined};}
export function publicView(v:View):View{
  const characters=characterWorld(v.turns),revealed=new Set(v.turns.flatMap(t=>t.effects.facts).filter(f=>f.revealed).map(f=>f.id));
  const hidden=new Set(v.turns.flatMap(t=>t.effects.facts).filter(f=>!f.revealed).map(f=>f.content));
  return {...v,characters,drafts:v.drafts.map(publicDraft),turns:v.turns.map((t,index)=>{
    const known=characterWorld(v.turns.slice(0,index+1)),knownIds=new Set(known.map(c=>c.id));
    return {...t,characterNames:Object.fromEntries(known.map(c=>[c.id,c.name])),
      state:{...t.state,pendingThreads:t.state.pendingThreads.filter(p=>!hidden.has(p)),storyThreads:t.state.storyThreads?.filter(p=>!hidden.has(p.content)),dynamicLocations:t.state.dynamicLocations?.filter(l=>l.revealed!==false),present:t.state.present.filter(id=>knownIds.has(id)),relationships:Object.fromEntries(Object.entries(t.state.relationships).filter(([id])=>knownIds.has(id))),romancePolicies:t.state.romancePolicies?Object.fromEntries(Object.entries(t.state.romancePolicies).filter(([id])=>knownIds.has(id))):undefined},
      // Explicit projection, not an object spread of private character events.
      effects:{facts:t.effects.facts.filter(f=>f.revealed).map(f=>({...f,knownBy:f.knownBy.filter(id=>knownIds.has(id))})),
        knowledge:t.effects.knowledge.filter(k=>revealed.has(k.factId)&&knownIds.has(k.npcId)),
        memories:t.effects.memories.filter(m=>revealed.has(m.factId)),summaries:[],suggestedActions:t.effects.suggestedActions,diagnostics:t.effects.diagnostics.filter(d=>(Object.values(MEMORY_NOTICES) as string[]).includes(d))}};
  })};
}
