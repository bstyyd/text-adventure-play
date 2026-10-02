// Compatibility is deliberately isolated here. New engine state has no fixed stat columns.
import type { Save,State,Turn,NewGameConfig } from '../domain/types';
import type { ScenarioPackage } from './schema';
import { calendarDate } from './calendar';
export function migrateLegacyState(raw:unknown,p:ScenarioPackage):State{
  const s=structuredClone(raw) as State&{court?:Record<string,number>;relationships:Record<string,Record<string,unknown>>};
  if(s.court){s.worldStats=s.court;delete s.court;}
  for(const [id,r] of Object.entries(s.relationships))if(!r.values){s.relationships[id]={values:Object.fromEntries(p.rules.relationshipStats.map(d=>[d.key,Number(r[d.key]??d.initial)])),status:String(r.status||'')};}
  s.worldStats??={};s.locationId??=p.locations.find(l=>l.name===s.location)?.id||'legacy_'+s.sceneId;
  s.date=calendarDate(p.calendar,s.date.year,s.date.month,s.date.day,s.date.minuteOfDay);return s;
}
export function legacyNewGame(raw:Record<string,unknown>,p:ScenarioPackage){const {day,court,...rest}=raw;return {...rest,...(day!==undefined?{startDate:{...p.calendar.start,day}}:{}),...(court!==undefined?{worldStats:court}:{})};}
export function migratedSave(raw:unknown,p:ScenarioPackage,hash:string):Save{const s=raw as Save;return {...s,initialConfig:legacyNewGame(s.initialConfig as unknown as Record<string,unknown>,p) as NewGameConfig,scenarioPackageId:p.manifest.packageId,scenarioVersion:p.manifest.version,scenarioSnapshotHash:hash};}
export function migratedTurn(raw:unknown,p:ScenarioPackage,hash:string):Turn{const t=raw as Turn;return {...t,state:migrateLegacyState(t.state,p),scenarioSnapshotHash:t.scenarioSnapshotHash||hash};}
