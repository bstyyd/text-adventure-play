import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const files=['migrations/001_initial.sql','migrations/002_characters.sql','migrations/003_scenarios.sql','packages/dayao_empress/scenario.json'];
const data=Object.fromEntries(files.map(file=>['/app/'+file,readFileSync(file,'utf8')]));
mkdirSync('src/browser',{recursive:true});
writeFileSync('src/browser/data.generated.ts','// Generated only from public migrations and the built-in scenario.\nexport const browserFiles:Record<string,string>='+JSON.stringify(data)+';\n');
