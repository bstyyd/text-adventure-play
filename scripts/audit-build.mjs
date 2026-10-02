import {readdirSync,readFileSync,writeFileSync,existsSync,lstatSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve('.'),next=path.join(root,'.next');
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?files(path.join(dir,f.name)):[path.join(dir,f.name)]);}
function privateFile(file){
  const name=file.replaceAll('\\','/');
  return /(?:^|\/)(?:DayaoNovel[^/]*|\.test-data|artifacts|spikes|tests|\.git|logs)(?:\/|$)|\.(?:sqlite|db)(?:[^/]*$)|(?:^|\/)\.env(?:\.|$)/i.test(name);
}
let removed=0,entries=0;
const traces=files(next).filter(f=>f.endsWith('.nft.json')&&!f.includes(path.sep+'standalone'+path.sep));
for(const file of traces){
  const trace=JSON.parse(readFileSync(file,'utf8'));
  const allowed=trace.files.filter(f=>!privateFile(path.resolve(path.dirname(file),f)));
  const excluded=trace.files.length-allowed.length;
  // The Windows build serves locally, so remove data-only NFT references after
  // tracing rather than let Next copy personal files into a standalone bundle.
  if(excluded&&process.platform==='win32'){
    writeFileSync(file,JSON.stringify({...trace,files:allowed}));removed+=excluded;
  }else if(excluded)throw new Error('生产追踪清单包含运行时数据；禁止发布：'+path.relative(root,file));
  for(const entry of allowed){
    const absolute=path.resolve(path.dirname(file),entry);
    if(!absolute.startsWith(root+path.sep))throw new Error('生产追踪引用工作区之外的文件；禁止发布');
  }
  entries+=allowed.length;
}
const standalone=path.join(next,'standalone');
if(process.platform!=='win32'&&!existsSync(path.join(standalone,'server.js')))throw new Error('缺少 Linux standalone 服务');
if(existsSync(standalone))for(const file of files(standalone)){
  if(privateFile(path.relative(standalone,file)))throw new Error('standalone 包含运行时数据；禁止发布');
  if(lstatSync(file).isSymbolicLink())throw new Error('standalone 包含未审计的链接；禁止发布');
}
console.log(JSON.stringify({audit:'production-files',ok:true,traces:traces.length,entries,removedDataReferences:removed,standalone:existsSync(standalone),privateFiles:0}));
