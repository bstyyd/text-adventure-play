import type { RuleCondition,ScenarioPackage } from './schema';
import type { State,StoryEvent } from '../domain/types';
export function evaluateRule(condition:RuleCondition,state:State,ids:string[]=[]):boolean{
  if('all'in condition)return condition.all.every(c=>evaluateRule(c,state,ids));if('any'in condition)return condition.any.some(c=>evaluateRule(c,state,ids));
  const compare=(n:number|undefined)=>{if(n===undefined||!Number.isFinite(n))return false;const v=condition.value;switch(condition.operator){case '>':return n>v;case '>=':return n>=v;case '<':return n<v;case '<=':return n<=v;case '==':return n===v;case '!=':return n!==v;}};
  if(condition.source==='world_stat')return compare(state.worldStats[condition.key]);
  if(!ids.length)return false;return ids.every(id=>compare(condition.source==='character_stat'?state.relationships[id]?.values[condition.key]:condition.key==='neglect'?state.neglect[id]??0:condition.key==='exceptions'?new Set(state.exceptions[id]||[]).size:undefined));
}
export function scheduleScenarioEvents(state:State,turnId:string,p:ScenarioPackage){
  const s=structuredClone(state);
  for(const rule of p.rules.triggers){
    if(rule.romanceRequired&&!p.manifest.romanceSystem)continue;
    const ids=rule.seedOnly?p.characters.map(c=>c.stableId):Object.keys(s.relationships);
    const groups=rule.scope==='world'?[[]]:rule.scope==='each'?ids.map(id=>[id]):ids.flatMap((id,i)=>ids.slice(i+1).map(other=>[id,other]));
    for(const group of groups){if(rule.romanceRequired&&!group.every(id=>(s.romancePolicies?.[id]||p.characters.find(c=>c.stableId===id)?.romancePolicy)==='available'))continue;if(!evaluateRule(rule.trigger,s,group))continue;const key=rule.id+(group.length?':'+[...group].sort().join(':'):'')+(rule.cooldownScenes?':'+Math.floor(s.sceneCount/rule.cooldownScenes):'');if(s.events.some(e=>e.key===key)||s.eventKeys.includes(key))continue;s.events.push({key,type:rule.eventType,npcIds:group,status:'queued',reason:rule.reason,triggerTurnId:turnId,priority:rule.priority});}
  }return s;
}
export function introduceScenarioEvent(event:StoryEvent,state:State,p:ScenarioPackage){const r=p.rules.triggers.find(r=>r.id===event.key.split(':')[0]);if(!r||state.eventKeys.includes(event.key)||!['queued','eligible'].includes(event.status)||state.events.some(e=>e.introducedScene===state.sceneId)||!event.npcIds.every(id=>state.present.includes(id)))return false;if(r.privateScene&&(state.present.length!==1||r.forbiddenLocations.some(l=>state.location.includes(l))))return false;return state.present.length>=r.minWitnesses;}
