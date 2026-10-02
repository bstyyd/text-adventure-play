import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {sourceFiles} from './publish-source.mjs';
const owner='bstyyd',name='text-adventure-play';
const credentials=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\nusername='+owner+'\n\n',encoding:'utf8',env:{...process.env,GCM_INTERACTIVE:'Never'},timeout:30000});
if(credentials.status!==0)throw new Error('Git Credential Manager 尚未登录，请使用 GitHub 设备登录，不要粘贴令牌');
const token=credentials.stdout.split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);
if(!token)throw new Error('没有可用的 GitHub 登录凭据');
async function api(endpoint,data,method){
  const res=await fetch('https://api.github.com'+endpoint,{method:method||(data?'POST':'GET'),redirect:'error',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'text-adventure-deploy',Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(20000)});
  return {status:res.status,data:await res.json()};
}
const user=await api('/user');
if(user.status!==200||user.data.login!==owner)throw new Error('GitHub 登录身份不匹配或权限不可用，停止发布');
let repo=await api('/repos/'+owner+'/'+name),created=false;
if(repo.status===404){repo=await api('/user/repos',{name,description:'通用互动小说 / 文字冒险游戏，内置大曜女帝',private:true,auto_init:false});created=true;}
if(![200,201].includes(repo.status)||repo.data.full_name!==owner+'/'+name||!repo.data.permissions?.push)throw new Error('不能创建或写入独立仓库；HTTP '+repo.status+'，请检查 GitHub OAuth 仓库权限');
const refs=await api('/repos/'+owner+'/'+name+'/git/refs/heads');
const empty=refs.status===409||refs.status===404||refs.status===200&&Array.isArray(refs.data)&&!refs.data.length;
console.log(JSON.stringify({login:owner,repository:repo.data.html_url,private:repo.data.private,created,empty,published:false}));
if(process.argv.includes('--create-only'))process.exit(0);
const pages=process.argv.includes('--publish-pages');
if(!process.argv.includes('--publish')&&!pages)throw new Error('需要 --create-only、--publish 或 --publish-pages');
if(!empty)throw new Error('同名仓库已有内容；已检查，拒绝覆盖。需要先检查其历史并确认更新目标');
if(pages&&repo.data.private){repo=await api('/repos/'+owner+'/'+name,{private:false},'PATCH');if(repo.status!==200||repo.data.private)throw new Error('不能启用免费 Pages 所需的公开源码仓库');}
function git(args,capture=false){const result=spawnSync('git',args,{encoding:'utf8',env:{...process.env,GCM_INTERACTIVE:'Never'},stdio:capture?'pipe':'inherit'});if(result.status!==0)throw new Error('Git 操作失败，请检查登录与仓库权限');return result.stdout||'';}
const files=sourceFiles(true),allowed=new Set(files),staged=git(['diff','--cached','--name-only','-z'],true).split('\0').filter(Boolean);
if(staged.some(file=>!allowed.has(file)))throw new Error('已有暂存内容不在发布白名单；不改变现有暂存状态');
const remote=spawnSync('git',['remote','get-url','origin'],{encoding:'utf8'}),url=repo.data.clone_url;
if(remote.status===0&&remote.stdout.trim()!==url)throw new Error('origin 指向其他仓库；拒绝修改');
if(remote.status!==0)git(['remote','add','origin',url]);
const identity=spawnSync('git',['config','--local','--get','user.name'],{encoding:'utf8'});
if(!identity.stdout.trim())git(['config','--local','user.name',owner]);
const email=spawnSync('git',['config','--local','--get','user.email'],{encoding:'utf8'});
if(!email.stdout.trim())git(['config','--local','user.email',String(user.data.id)+'+'+owner+'@users.noreply.github.com']);
mkdirSync('.test-data',{recursive:true});const manifest=path.resolve('.test-data/github-publish-paths');writeFileSync(manifest,files.join('\0')+'\0');
git(['add','--pathspec-from-file='+manifest,'--pathspec-file-nul']);
const actual=git(['diff','--cached','--name-only','-z'],true).split('\0').filter(Boolean);if(actual.some(file=>!allowed.has(file)))throw new Error('暂存清单包含非白名单文件，停止发布');
git(['commit','-m',pages?'Publish browser interactive fiction on GitHub Pages':'Prepare interactive fiction deployment']);git(['branch','-M','main']);git(['push','-u','origin','main']);
if(pages){
  const existing=await api('/repos/'+owner+'/'+name+'/pages');
  if(existing.status===404){const enabled=await api('/repos/'+owner+'/'+name+'/pages',{build_type:'workflow'});if(enabled.status!==201)throw new Error('代码已推送，但启用 GitHub Pages 返回 '+enabled.status+'，请检查 Pages 权限');}
  else if(existing.status!==200)throw new Error('代码已推送，但无法确认 GitHub Pages 状态');
}
console.log(JSON.stringify({published:true,repository:repo.data.html_url,files:actual.length,commit:git(['rev-parse','HEAD'],true).trim()}));
