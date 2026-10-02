import legacyPublic from '../../packages/dayao_empress/public.json';
import type {PublicScenario} from '../scenario/schema';
import type {View,Save} from '../domain/types';
// Read-only projection for pre-scenario offline downloads. The original archive and its
// checksum stay untouched; reconnection downloads an authoritative new copy.
export function readableLegacyView(view:View):View{
 if(view.scenario)return view;
 const scenario=legacyPublic as PublicScenario;
 const save={...view.save,scenarioPackageId:'dayao_empress',scenarioVersion:'1.0.0'} as Save;
 const turns=view.turns.map(t=>{const state=structuredClone(t.state),raw=state as typeof state&{court?:Record<string,number>};
   state.worldStats??=raw.court||{};delete raw.court;
   for(const [id,rel] of Object.entries(state.relationships)){const old=rel as unknown as Record<string,unknown>;if(!old.values)state.relationships[id]={values:Object.fromEntries(scenario.rules.relationshipStats.map(d=>[d.key,Number(old[d.key]??d.initial)])),status:String(old.status||'')};}
   state.locationId??=scenario.locations.find(l=>l.name===state.location)?.id||'legacy_unknown';
   return {...t,state,playerName:scenario.player.name};
 });return {...view,save,turns,scenario};
}
