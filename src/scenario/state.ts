import type { NewGameConfig,State } from '../domain/types';
import type { ScenarioPackage } from './schema';
import { calendarDate } from './calendar';
export function initialScenarioState(p:ScenarioPackage,config:NewGameConfig):State{
  const start={...p.calendar.start,...config.startDate};const date=calendarDate(p.calendar,start.year,start.month,start.day,start.minuteOfDay);
  const worldStats=Object.fromEntries(p.rules.worldStats.map(s=>[s.key,config.worldStats?.[s.key]??s.initial]));
  for(const [key,value] of Object.entries(config.worldStats||{})){const d=p.rules.worldStats.find(s=>s.key===key);if(!d||value<d.min||value>d.max)throw new Error('世界数值未定义或超出范围');}
  const relationships=p.manifest.relationshipSystem.enabled?Object.fromEntries(p.characters.filter(c=>c.statPolicy!=='disabled').map(c=>[c.stableId,{values:Object.fromEntries(p.rules.relationshipStats.filter(s=>c.statPolicy!=='explicit'||Object.hasOwn(c.initialStats,s.key)).map(s=>[s.key,c.initialStats[s.key]??s.initial])),status:c.stateLabel}])):{};
  return {date,accessionDay:date.absoluteDay-p.initialScene.accessionOffsetDays,location:p.locations.find(l=>l.id===p.initialScene.locationId)!.name,locationId:p.initialScene.locationId,weather:p.initialScene.weather,present:[...p.initialScene.present],sceneId:crypto.randomUUID(),messageCount:0,sceneCount:1,originRegion:null,relationships,worldStats,romancePolicies:Object.fromEntries(p.characters.map(c=>[c.stableId,c.romancePolicy])),events:[],eventKeys:[],relationshipKeys:[],sceneDeltas:{},neglect:{},exceptions:{},contacted:[],factIds:[],pendingThreads:[...p.initialScene.pendingThreads]};
}
