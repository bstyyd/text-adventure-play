import type {CreateScenarioInput} from './draft';
import type {ScenarioPackage} from './schema';
export const blankScenarioForm:CreateScenarioInput={title:'新剧本',world:'',playerName:'玩家角色',playerDescription:'',npcs:'',opening:'',style:'',rulesText:'',openingLocation:'',initialPresentIndices:[],relationshipEnabled:false,romanceEnabled:false,relationshipStats:'',worldStats:'',calendarType:'none',era:'',playerMode:'fixed',openingMode:'fixed'};
export function scenarioForm(p:ScenarioPackage):CreateScenarioInput{
 const stats=(kind:'relationshipStats'|'worldStats')=>p.rules[kind].map(s=>[s.key,s.displayName,s.min,s.max,s.initial].join('｜')).join('\n');
 return {title:p.manifest.title,world:p.world,playerName:p.player.name,playerDescription:p.player.description,npcs:p.characters.map(c=>[c.displayName,c.identity,c.description].join('｜')).join('\n'),opening:p.opening,style:p.style,rulesText:p.rules.notes,openingLocation:p.locations.find(l=>l.id===p.initialScene.locationId)?.name||'',initialPresentIndices:p.initialScene.present.map(id=>p.characters.findIndex(c=>c.stableId===id)).filter(i=>i>=0),relationshipEnabled:p.manifest.relationshipSystem.enabled,romanceEnabled:p.manifest.romanceSystem,relationshipStats:stats('relationshipStats'),worldStats:stats('worldStats'),calendarType:p.calendar.type,era:p.calendar.era,playerMode:p.manifest.playerMode,openingMode:p.manifest.openingMode};
}
