import {readdirSync,lstatSync,readFileSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const roots=['app','src','pages-site/app','packages/dayao_empress','migrations','public/icons','deploy','.github/workflows'];
export const singles=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','next.config.ts','next-env.d.ts','postcss.config.mjs','Dockerfile','.dockerignore','.gitignore','.env.example','.env.production.example','PUBLIC_DEPLOYMENT.md','GITHUB_PAGES.md','GITHUB_PAGES_PLAN.md','pages-site/next.config.ts','pages-site/tsconfig.json','pages-site/next-env.d.ts',
  'scripts/pwa-build.mjs','scripts/audit-build.mjs','scripts/sw-template.js','scripts/container-start.mjs','scripts/site-backup.mjs','scripts/site-restore.mjs','scripts/publish-source.mjs','scripts/deployed-smoke.mjs','scripts/build-pages.mjs','scripts/browser-assets.mjs','scripts/serve-pages.mjs','scripts/browser-cors-check.mjs'];
export function sourceFiles(forRepository=false){
  const files=[];
  function add(file){
    const stat=lstatSync(file);if(stat.isSymbolicLink())throw new Error('源码包不允许链接：'+file);
    if(stat.isDirectory()){for(const f of readdirSync(file))add(file+'/'+f);}
    else if(stat.isFile())files.push(file);
  }
  for(const root of roots)if(existsSync(root))add(root);
  for(const file of singles)if(existsSync(file))add(file);
  if(forRepository){
    add('tests');
    for(const file of ['README.md','DEPLOYMENT.md','PUBLIC_DEPLOYMENT_RESULT.md','SCENARIO_GUIDE.md',
      'dayao-codex-design/AGENTS.md','dayao-codex-design/DESIGN.md','dayao-codex-design/ACCEPTANCE.md','dayao-codex-design/GAME_SETTING.md','dayao-codex-design/API_PROVIDERS.md','dayao-codex-design/SOURCES.md','dayao-codex-design/SCENARIO_ENGINE_ADDENDUM.md',
      'eslint.config.mjs','vitest.config.ts','playwright.config.ts','playwright.access.config.ts','playwright.mobile.config.ts','playwright.public.config.ts','playwright.pages.config.ts','scripts/serve.mjs','scripts/password.ts','scripts/data.ts','scripts/scenario-schema.ts','scripts/github-publish.mjs','scripts/github-status.mjs'])if(existsSync(file))add(file);
  }
  for(const file of files){
    if(/(?:^|\/)(?:node_modules|\.next|\.test-data|spikes|artifacts)(?:\/|$)|\.(?:sqlite|db|log)(?:-|$)|\.env\.(?!example$|production\.example$)/i.test(file))throw new Error('禁止打包数据或密钥文件：'+file);
    if(/\.(?:ts|tsx|mjs|js|json|md|ya?ml|env|example|conf|sh)$/.test(file)){
      const text=readFileSync(file,'utf8');
      if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAIza[A-Za-z0-9_-]{35}/.test(text))throw new Error('源码疑似包含凭据：'+file);
      if(/(?:^|\/)\.env\./.test(file)&&text.split(/\r?\n/).some(line=>line.trim()&&!line.startsWith('#')&&!/^[A-Z0-9_]+=$/.test(line)))throw new Error('环境示例必须只有空变量：'+file);
    }
  }
  return files.sort();
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve('scripts/publish-source.mjs')){
  const files=sourceFiles(),out=path.resolve(process.argv[2]||'.test-data/site-source.tar.gz');
  if(!out.startsWith(path.resolve('.test-data')+path.sep)||existsSync(out))throw new Error('源码包只能写到 .test-data 中的新文件');
  mkdirSync(path.dirname(out),{recursive:true});
  const list=out+'.list';writeFileSync(list,files.join('\n')+'\n',{flag:'wx'});
  const result=spawnSync('tar',['-czf',out,'-T',list],{stdio:'inherit'});
  if(result.status!==0)throw new Error('打包失败');
  console.log(JSON.stringify({archive:out,files:files.length,size:readFileSync(out).length,sha256:createHash('sha256').update(readFileSync(out)).digest('hex')}));
}
