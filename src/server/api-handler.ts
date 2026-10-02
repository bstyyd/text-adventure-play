import { z } from 'zod';
import { service,requestSecurity,deploymentStatus,draining,drain,activeJobs } from '@/server/service';
import {createHash,timingSafeEqual} from 'node:crypto';
import { ProfileSchema, TurnInputSchema } from '@/domain/types';
import type { Annotation, Bookmark, NpcId } from '@/domain/types';
import { publicDraft, publicView } from '@/characters/public';
import {importPackageZip,packageZip,publicScenario} from '@/scenario/package';
import { ConflictError } from '@/storage/repository';
import { exportSave, importSave, readingExport } from '@/storage/transfer';
import { contextFor, filterHistory } from '@/memory/context';
import { dayKey } from '@/domain/calendar';
import { ENDPOINTS, capabilityKey } from '@/llm/config';
import { safeError, RetryOptionsSchema } from '@/engine/engine';
import { AccessError } from '@/security/local';
import {ProviderError} from '@/llm/types';
import { offlineCopy } from '@/storage/offline';
import type {RequestScope} from '@/server/request-scope';
const uuid=z.string().uuid();
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function body(request:Request,maxBytes=22*1024*1024){
  const reader=request.body?.getReader();if(!reader)return {};
  const chunks:Uint8Array[]=[];let bytes=0;
  while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>maxBytes){await reader.cancel();throw new Error('请求体超过接口允许大小');}chunks.push(r.value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export async function handle(request:Request,route:string[],scope?:RequestScope){
  const security=scope?.security||requestSecurity(),url=new URL(request.url),name=route.join('/');
  try{security.host(request);}catch{return response({error:'Host/Origin 校验失败，拒绝跨站访问。'},403);}
  if(name==='health'&&request.method==='GET')return response({ok:true});
  if(route[0]==='ops'){
    const secret=process.env.APP_DEPLOY_TOKEN||'',token=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
    if(secret.length<32||!timingSafeEqual(createHash('sha256').update(secret).digest(),createHash('sha256').update(token).digest()))return response({error:'操作未授权'},403);
    if(name==='ops/drain'&&request.method==='POST')drain(true);
    else if(name==='ops/resume'&&request.method==='POST')drain(false);
    else if(name!=='ops/status'||request.method!=='GET')return response({error:'未找到接口'},404);
    return response({activeJobs:activeJobs(),draining:draining()});
  }
  if(name==='session'&&request.method==='GET'){
    try{const session=security.session(request);
      return Response.json({csrf:session.csrf,authenticated:session.authenticated,loginRequired:security.loginRequired},{headers:{'Set-Cookie':security.cookie(session),'Cache-Control':'no-store'}});
    }catch(e){return response({error:(e as Error).message},e instanceof AccessError?e.status:400);}
  }
  if(name==='login'&&request.method==='POST'){
    try{security.check(request,false);security.limit('login-request',8,15*60000);const data=z.object({password:z.string().max(256)}).strict().parse(await body(request,2048));const session=security.login(request,data.password);
      return Response.json({csrf:session.csrf,authenticated:true},{headers:{'Set-Cookie':security.cookie(session),'Cache-Control':'no-store'}});
    }catch(e){return response({error:e instanceof z.ZodError?'登录格式不正确':(e as Error).message},e instanceof AccessError?e.status:400);}
  }
  let playerId:string;
  try{security.authorize(request,name);playerId=security.check(request).principalId;
    if(security.config.isolated&&request.method==='POST'&&/^(turns|suggestions|scenarios\/assist|providers\/|drafts\/.*\/(?:retry|repair))/.test(name))security.limit('player-model:'+playerId,3,60000);
  }catch(error){return response({error:(error as Error).message},error instanceof AccessError?error.status:403);}
  const s=scope?.service||service(playerId),deployment=scope?.deployment||deploymentStatus(playerId);
  const bootstrap=()=>({scenarios:s.repo.scenarios.list(),saves:s.repo.listSaves(),npcs:[],dataDir:scope?.dataDir||(deployment?'服务器持久磁盘 · 此浏览器身份的独立书库':s.repo.dir),profiles:s.repo.profiles().filter(p=>!deployment||p.id==='site-model').map(p=>({...p,hasKey:s.vault.has(p),capabilities:s.getCaps(p),endpoint:ENDPOINTS[p.provider]})),selected:{narrator:s.repo.setting('narrator','mock'),extractor:s.repo.setting('extractor','same')},style:s.repo.setting('style','克制，留白，以对白与动作推进。'),lastError:s.repo.setting('provider-error',''),backupError:s.repo.setting('backup-error',''),accessMode:s.security.config.mode,deployment});
  try{
    if(!scope&&draining()&&request.method==='POST'&&/^(turns|suggestions|scenarios\/assist|providers\/|drafts\/.*\/(?:retry|repair))/.test(name))throw new AccessError('站点正在更新，现有生成会继续完成；请稍后手动发送。',503);
    if(request.method==='GET'){
      if(name==='scenarios')return response(s.repo.scenarios.list());
      if(route[0]==='scenarios'&&route[1]){
        const p=s.repo.scenarios.get(route[1],url.searchParams.get('version')||undefined);
        if(route[2]==='play')return response(publicScenario(p));
        if(route[2]==='export')return new Response(Buffer.from(packageZip(p)),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="'+p.manifest.packageId+'-'+p.manifest.version+'-scenario.zip"','Cache-Control':'no-store'}});
        if(route[2]==='assets'){const key=route.slice(3).join('/');const v=p.assets[key];if(!v)throw new Error('图片不存在');return new Response(Buffer.from(v,'base64'),{headers:{'Content-Type':key.endsWith('.png')?'image/png':key.endsWith('.webp')?'image/webp':'image/jpeg','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});}
        return response(p);
      }
      if(name==='bootstrap')return response(bootstrap());
      if(route[0]==='requests'&&route[1]){const draft=s.repo.maybeDraft(uuid.parse(route[1]));return response({draft:draft?publicDraft(draft):null});}
      if(route[0]==='saves'&&route[1]){
        const saveId=uuid.parse(route[1]),branch=url.searchParams.get('branch')||undefined;
        if(route[2]==='offline')return response(offlineCopy(s.repo,saveId,bootstrap()));
        if(route[2]==='characters')return response(s.characters.book(saveId,branch,url.searchParams.get('at')||undefined,url.searchParams.get('q')||''));
        if(route[2]==='export'){
          const format=url.searchParams.get('format')||'json',view=s.repo.view(saveId,branch);
          if(format==='json')return response(exportSave(s.repo,saveId));
          const turns=filterHistory(view.turns,{from:dayKey(url.searchParams.get('from')||'',view.scenario.calendar),to:dayKey(url.searchParams.get('to')||'',view.scenario.calendar),inclusive:url.searchParams.get('inclusive')!=='false'});
          return new Response(readingExport(view.save.title,turns,format==='txt'?'txt':'md'),{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
        }
        if(route[2]==='context'){
          const v=s.repo.view(saveId,branch),ctx=contextFor(v.turns,url.searchParams.get('input')||'',url.searchParams.get('target') as NpcId|null,v.annotations).preview;
          return response({...ctx,facts:ctx.facts.filter(f=>f.revealed),hiddenCount:ctx.facts.filter(f=>!f.revealed).length});
        }
        return response(publicView(s.repo.view(saveId,branch)));
      }
      if(route[0]==='drafts'&&route[1])return response(route[2]==='review'?s.engine.reviewContext(uuid.parse(route[1])):publicDraft(s.repo.draft(uuid.parse(route[1]))));
      return response({error:'未找到接口'},404);
    }
    if(request.method!=='POST')return response({error:'不支持此方法'},405);
    const raw=await body(request);
    if(deployment&&name==='profiles')throw new AccessError('本站模型和密钥由站长通过服务器环境配置。',403);
    if(deployment&&name==='backup')throw new AccessError('整库备份由站长管理；请使用完整 JSON 导出备份自己的存档。',403);
    if(deployment&&typeof raw==='object'&&raw!==null&&'extractProfileId' in raw&&raw.extractProfileId!==undefined&&raw.extractProfileId!=='site-model')throw new AccessError('本站只开放站长配置的模型。',403);
    if(name==='scenarios/manual')return response(s.scenarios.manual(raw));
    if(name==='scenarios/preview')return response(s.scenarios.advanced(raw));
    if(name==='scenarios/assist')return response(await s.scenarios.assist(raw,request.signal));
    if(name==='scenarios/import'){const x=z.object({base64:z.string().max(6*1024*1024)}).strict().parse(raw);return response(s.repo.scenarios.preview(importPackageZip(Buffer.from(x.base64,'base64'))));}
    if(name==='scenarios/install'){const x=z.object({previewId:uuid,hash:z.string().length(64),confirmed:z.literal(true)}).strict().parse(raw);return response(s.repo.scenarios.confirm(x.previewId,x.hash));}
    if(name==='scenarios/delete'){const x=z.object({packageId:z.string(),version:z.string(),confirmation:z.string()}).strict().parse(raw);if(x.confirmation!==s.repo.scenarios.get(x.packageId,x.version).manifest.title)throw new Error('删除名称不匹配');return response(s.repo.scenarios.remove(x.packageId,x.version));}
    if(name==='scenarios/compare'){const x=z.object({saveId:uuid,branchId:uuid.optional(),packageId:z.string(),version:z.string()}).strict().parse(raw);const view=s.repo.view(x.saveId,x.branchId);return response(s.repo.scenarios.compare(view.turns.at(-1)!.scenarioSnapshotHash||view.save.scenarioSnapshotHash,x.packageId,x.version));}
    if(name==='scenarios/upgrade')return response(s.scenarios.upgrade(raw));
    if(name==='logout'){s.security.logout(request);return response({ok:true});}
    if(name==='characters/group')return response(s.characters.group(raw));
    if(name==='characters/follow')return response(s.characters.follow(raw));
    if(name==='characters/budget')return response(s.characters.setBudget(raw));
    if(name==='characters/correct')return response(s.characters.correct(raw));
    if(name==='characters/policy')return response({turnId:s.characters.policy(raw).id});
    if(name==='suggestions')return response(await s.suggestions.generate(raw,request.signal));
    if(name==='saves')return response(s.repo.createSave(raw as Parameters<typeof s.repo.createSave>[0]));
    if(name==='saves/import'){const data=z.object({archive:z.string().max(22*1024*1024)}).strict().parse(raw);return response(importSave(s.repo,data.archive));}
    if(name==='turns')return response(publicDraft(s.engine.start(TurnInputSchema.parse(raw))),202);
    if(name==='turns/revise'){
      const data=z.object({input:TurnInputSchema,body:z.string().min(1).max(100000)}).strict().parse(raw);
      if(data.input.mode!=='story')throw new Error('作者修订仅用于剧情分支');
      return response(publicDraft(s.engine.start(data.input,data.body)),202);
    }
    if(route[0]==='drafts'&&route[1]){
      const id=uuid.parse(route[1]);
      if(route[2]==='cancel')return response(publicDraft(s.engine.cancel(id)));
      if(route[2]==='repair'){z.object({}).strict().parse(raw);return response(publicDraft(s.engine.repair(id)),202);}
      if(route[2]==='save'){const data=z.object({revision:z.string().length(64)}).strict().parse(raw);return response(publicDraft(await s.engine.commitExtracted(id,data.revision)));}
      if(route[2]==='review')return response(publicDraft(await s.engine.commitReviewed(id,raw)));
      if(route[2]==='retry'){
        const data=z.object({extractOnly:z.boolean(),body:z.string().min(1).max(100000).optional(),...RetryOptionsSchema.shape}).strict().parse(raw);
        return response(publicDraft(s.engine.retry(id,data.extractOnly,data.body,{extractProfileId:data.extractProfileId,timeoutMs:data.timeoutMs})),202);
      }
    }
    if(route[0]==='saves'&&route[1]){
      const id=uuid.parse(route[1]);s.repo.save(id);
      if(route[2]==='fork'){
        const data=z.object({branchId:uuid,turnId:uuid,name:z.string().min(1).max(80)}).strict().parse(raw);
        return response(s.repo.fork(id,data.branchId,data.turnId,data.name));
      }
      if(route[2]==='switch'){const data=z.object({branchId:uuid}).strict().parse(raw);s.repo.switchBranch(id,data.branchId);return response({ok:true});}
      if(route[2]==='rename'){const data=z.object({title:z.string().trim().min(1).max(80)}).strict().parse(raw);s.repo.putSave({...s.repo.save(id),title:data.title});return response({ok:true});}
      if(route[2]==='delete'){
        const data=z.object({confirmation:z.string()}).strict().parse(raw);
        if(data.confirmation!==s.repo.save(id).title)throw new Error('删除确认名称不匹配');
        if([...s.engine.active.values()].some(a=>s.repo.draft(a.id).saveId===id))throw new Error('请先停止生成');
        await s.repo.deleteSave(id);return response({ok:true});
      }
      if(route[2]==='bookmark'){
        const data=z.object({turnId:uuid,note:z.string().max(600)}).strict().parse(raw);
        if(s.repo.turn(data.turnId).saveId!==id)throw new Error('书签来源不匹配');
        const old=s.repo.all<Bookmark>('bookmarks').find(b=>b.turnId===data.turnId);
        const mark={id:old?.id||crypto.randomUUID(),...data};s.repo.putScoped('bookmarks',id,mark);return response(mark);
      }
      if(route[2]==='annotate'){
        const data=z.object({branchId:uuid,sourceTurnId:uuid,factId:uuid,kind:z.enum(['pin','error','note']),text:z.string().max(600)}).strict().parse(raw);
        const view=s.repo.view(id,data.branchId);
        if(!view.turns.some(t=>t.id===data.sourceTurnId&&t.effects.facts.some(f=>f.id===data.factId)))throw new Error('记忆来源不在当前路径');
        const annotation:Annotation={id:crypto.randomUUID(),...data,createdAt:new Date().toISOString()};
        s.repo.putScoped('annotations',id,annotation);return response(annotation);
      }
    }
    if(name==='backup')return response({path:await s.repo.backup()});
    if(name==='profiles'){
      const data=z.object({profile:ProfileSchema,key:z.string().max(1000).optional(),select:z.boolean().default(false)}).strict().parse(raw);
      s.repo.putProfile(data.profile);if(data.key)s.vault.set(data.profile,data.key);
      if(data.select)s.repo.setSetting('narrator',data.profile.id);
      return response({ok:true});
    }
    if(name==='settings'){
      const data=z.object({narrator:z.string().max(80),extractor:z.string().max(80),style:z.enum(['克制，留白，以对白与动作推进。','对白更短，允许平静闲聊。','细写环境与停顿，保留回应空间。'])}).strict().parse(raw);
      if(deployment&&(data.narrator!=='site-model'||!['same','site-model'].includes(data.extractor)))throw new AccessError('本站模型由站长配置。',403);
      if(!s.repo.profiles().some(p=>p.id===data.narrator)||(data.extractor!=='same'&&!s.repo.profiles().some(p=>p.id===data.extractor)))throw new Error('模型配置不存在');
      Object.entries(data).forEach(([k,v])=>s.repo.setSetting(k,v));return response({ok:true});
    }
    if(name==='references'){
      const data=z.object({filename:z.string().max(160),content:z.string().max(500000)}).strict().parse(raw);
      if(!/\.(txt|md)$/i.test(data.filename))throw new Error('参考仅支持 TXT/MD');
      s.repo.db.prepare('INSERT INTO style_references VALUES (?,?,?,?)').run(crypto.randomUUID(),data.filename,data.content,new Date().toISOString());
      // Raw references never enter retrieval. Only aggregate sentence length chooses a fixed, fact-free style.
      const lines=data.content.split(/[。！？\n]/).filter(x=>x.trim());
      const mean=data.content.length/Math.max(lines.length,1);
      const guide=mean<40?'对白更短，允许平静闲聊。':'细写环境与停顿，保留回应空间。';
      s.repo.setSetting('style',guide);return response({guide,note:'仅参考写法，不导入剧情。只采用固定风格标签；原文隔离保存，不进入模型上下文。'});
    }
    if(name==='providers/test'||name==='providers/models'){
      const data=z.object({profileId:z.string(),authorizeNetwork:z.literal(true),structured:z.boolean().default(false)}).strict().parse(raw);
      const profile=s.repo.profiles().find(p=>p.id===data.profileId);if(!profile)throw new Error('模型配置不存在');
      const provider=s.provider(profile),caps=s.getCaps(profile),signal=AbortSignal.timeout(Math.min(profile.timeoutMs,90000));
      const req={profile,key:s.vault.get(profile),system:'仅输出 JSON 对象 {"ok":true}。',messages:[{role:'user' as const,content:'无剧情的结构化能力测试，输出 JSON。'}],signal,capabilities:caps};
      const began=Date.now();
      try{
        if(name==='providers/models')return response(await provider.listModels(req));
        const result=data.structured?await provider.extractJson({...req,capabilities:{...caps,jsonObject:'supported'},format:'json_object'}):await provider.testConnection(req);
        if(data.structured){z.object({ok:z.literal(true)}).strict().parse(JSON.parse(result.text));s.repo.setSetting('cap:'+capabilityKey(profile),{...caps,jsonObject:'supported',source:'probe',checkedAt:new Date().toISOString()});}
        s.repo.setSetting('provider-error','');
        return response({model:profile.model,latencyMs:Date.now()-began,text:result.text,requestCount:result.requestCount,note:profile.provider==='mock'?'Mock 本地契约结果':'真实 API 返回；未加入剧情'});
      }catch(error){
        s.repo.setSetting('provider-error',safeError(error));
        if(data.structured)s.repo.setSetting('cap:'+capabilityKey(profile),{...caps,jsonObject:'unknown',source:'probe',checkedAt:new Date().toISOString()});
        throw error;
      }
    }
    return response({error:'未找到接口'},404);
  }catch(error){
    const message=error instanceof Error&&!(error instanceof z.ZodError)?error.message:safeError(error);
    return response({error:message},error instanceof AccessError?error.status:error instanceof ConflictError?409:error instanceof ProviderError&&error.status?error.status:400);
  }
}
