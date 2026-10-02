import {spawnSync} from 'node:child_process';
import {mkdirSync,cpSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url),base='/text-adventure-play';
const generate=spawnSync(process.execPath,['scripts/browser-assets.mjs'],{stdio:'inherit'});if(generate.status!==0)process.exit(generate.status||1);
mkdirSync('pages-site/public/sqlite',{recursive:true});
cpSync(require.resolve('sql.js/dist/sql-wasm.wasm'),'pages-site/public/sqlite/sql-wasm.wasm');
cpSync('public/icons','pages-site/public/icons',{recursive:true});
const build=spawnSync(process.execPath,[require.resolve('next/dist/bin/next'),'build','--webpack','pages-site'],{stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});if(build.status!==0)process.exit(build.status||1);
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?files(path.join(dir,f.name)):[path.join(dir,f.name)]);}
const all=files('pages-site/out'),assets=all.filter(f=>/\.(?:js|css|wasm|woff2?|png|svg)$/.test(f)).map(f=>base+'/'+path.relative('pages-site/out',f).replaceAll('\\','/'));
const version=readFileSync('pages-site/.next/BUILD_ID','utf8').trim();
let template=readFileSync('scripts/sw-template.js','utf8');
template=template.replace('const version=__VERSION__,precache=__PRECACHE__','const version='+JSON.stringify(version)+',precache='+JSON.stringify([base+'/',base+'/manifest.webmanifest',...assets]));
template=template.replaceAll("url.pathname.startsWith('/api/')","url.pathname.startsWith("+JSON.stringify(base+'/api/')+")").replaceAll("url.pathname.startsWith('/_next/static/')","url.pathname.startsWith("+JSON.stringify(base+'/_next/static/')+")").replaceAll("cache.match('/')",'cache.match('+JSON.stringify(base+'/')+')').replaceAll("'dayao-shell-'","'fiction-pages-shell-'");
writeFileSync('pages-site/out/sw.js',template);writeFileSync('pages-site/out/.nojekyll','');
for(const file of all)if(/\.(?:js|html|json|txt)$/.test(file)){
  const text=readFileSync(file,'utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAIza[A-Za-z0-9_-]{35}/.test(text))throw new Error('静态产物疑似包含真实凭据：'+file);
}
console.log('GitHub Pages static build: '+all.length+' files; browser SQLite, no server API/key/data uploaded.');
