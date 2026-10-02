import {z} from 'zod';
import {writeFileSync} from 'node:fs';
import {ScenarioSchema} from '../src/scenario/schema';
import {builtInScenario,publicScenario} from '../src/scenario/package';
writeFileSync('packages/scenario.schema.json',JSON.stringify(z.toJSONSchema(ScenarioSchema),null,2)+'\n');
writeFileSync('packages/dayao_empress/public.json',JSON.stringify(publicScenario(builtInScenario()),null,2)+'\n');
console.log('Generated schema and public-only legacy read projection. No database opened.');
