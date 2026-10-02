// Legacy test/import facade. The runtime loads the bound Scenario Snapshot.
import {builtInScenario} from '../scenario/package';
import {initialScenarioState} from '../scenario/state';
import {legacyNewGame} from '../scenario/legacy';
import {NewGameSchema} from '../domain/types';
const p=builtInScenario();
export const CANON_VERSION='dayao-canon-1';
export const NPCS=p.characters.map(c=>({id:c.stableId,name:c.displayName,role:c.identity,age:c.age!,trust:c.initialStats.trust,affection:c.initialStats.affection,status:c.stateLabel,public:c.description,private:c.privateBackground}));
export const npcIds=NPCS.map(c=>c.id);
export const WORLD=p.world,PROLOGUE=p.opening;
export const publicNpcs=()=>NPCS.map(({id,name,role,age,public:description})=>({id,name,role,age,description}));
export const initialState=(config:unknown)=>initialScenarioState(p,NewGameSchema.parse(legacyNewGame(config as Record<string,unknown>,p)));
