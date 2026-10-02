import {randomUUID,createHash} from 'node:crypto';
const origin=process.argv[2];
if(!origin||!origin.startsWith('https://')||!process.argv.includes('--authorize-network'))throw new Error('用法：node scripts/deployed-smoke.mjs https://实际游戏域名 --authorize-network（只发送一轮真实行动）');
let cookie='',csrf='';
async function api(name,data){
  const res=await fetch(origin+'/api/'+name,{method:data===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json','x-dayao-csrf':csrf,Origin:origin})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
  if(name==='session'){cookie=(res.headers.get('set-cookie')||'').split(';')[0];}
  const value=await res.json();if(!res.ok)throw new Error(value.error||'接口状态 '+res.status);
  return value;
}
const session=await api('session');csrf=session.csrf;
if(!session.authenticated)throw new Error('站点要求登录，请先以实际浏览器登录验证，不重放账号凭据');
const boot=await api('bootstrap'),profile=boot.profiles.find(p=>p.id===boot.selected.narrator);
if(!profile||profile.provider==='mock'||!profile.hasKey)throw new Error('站点没有可用的真实模型，未调用');
const save=await api('saves',{title:'上线验证 '+new Date().toISOString().slice(0,10)}),view=await api('saves/'+save.id),id=randomUUID();
await api('turns',{clientRequestId:id,saveId:save.id,branchId:view.branch.id,expectedHeadTurnId:view.branch.headTurnId,playerText:'门外是谁？让来人先报身份。',target:null,mode:'story'});
let draft;
for(let i=0;i<180;i++){
  draft=(await api('requests/'+id)).draft;
  if(draft&&['committed','failed','cancelled'].includes(draft.status))break;
  await new Promise(resolve=>setTimeout(resolve,2000));
}
if(draft?.status!=='committed')throw new Error('真实回合未保存：'+(draft?.error||draft?.status||'状态未知')+'；不会自动重发');
const reread=await api('saves/'+save.id),turn=reread.turns.find(t=>t.requestId===id);
if(!turn||reread.turns.filter(t=>t.requestId===id).length!==1)throw new Error('刷新读档未找到唯一正式节点');
console.log(JSON.stringify({verified:true,origin,provider:turn.provider,model:turn.model,saveId:save.id,turnId:turn.id,
  characters:turn.body.length,bodySha256:createHash('sha256').update(turn.body).digest('hex'),requestCount:turn.requestCount,usage:turn.usage},null,2));
