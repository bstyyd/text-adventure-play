import initSqlJs from 'sql.js';
import type Database from 'better-sqlite3';
import {BrowserSqlite} from './sqlite';
import {BrowserStore,BrowserStorageError} from './store';
import {Repository} from '../storage/repository';
import {LocalSecurity} from '../security/local';
import {makeService} from '../server/make-service';
import {handle} from '../server/api-handler';
import {sitePath} from '../client/site-path';
import {createHash} from './crypto';
import type {Draft} from '../domain/types';

let opening:Promise<BrowserRuntime>|undefined;
class BrowserSecurity extends LocalSecurity{
  private localSession:ReturnType<LocalSecurity['create']>|undefined;
  override current(){return this.localSession??=this.create();}
  override cookie(){return '';}
}
class BrowserRuntime{
  private lease:string|undefined;
  private persistFailure:unknown;
  private recovering:Promise<void>|undefined;
  private initialData:Uint8Array;
  private version=0;
  private digest='';
  private cookie='';
  private csrf='';
  private pending=Promise.resolve();
  private writing=false;
  readonly repo:Repository;
  readonly security=new BrowserSecurity({mode:'lan',origins:[location.origin],passwordHash:'',isolated:true});
  readonly service:ReturnType<typeof makeService>;
  constructor(private db:BrowserSqlite,private store:BrowserStore,version:number,leaseUntil:number){
    this.version=version;
    this.repo=new Repository('/browser',{database:db as unknown as Database.Database,recoverDrafts:false,backup:async automatic=>{await this.flush();await this.store.backup(this.db.serialize(),automatic);return '此浏览器 IndexedDB 内的'+(automatic?'自动':'手动')+'完整备份';}});
    this.expired(leaseUntil);
    this.service=makeService({repo:this.repo,security:this.security,beforeAttempt:async()=>{await this.flush();if(this.persistFailure)throw this.persistFailure;}});
    this.initialData=this.db.serialize();
    const snapshot=()=>{if(this.lease)void this.flush().catch(error=>this.failed(error));};
    document.addEventListener('visibilitychange',snapshot);window.addEventListener('pagehide',snapshot);
  }
  private expired(until:number){
    if(until>Date.now())return;
    for(const draft of this.repo.all<Draft>('drafts'))if(['generating','extracting','validating'].includes(draft.status))this.repo.putDraft({...draft,status:'failed',failureStage:draft.status==='generating'?'generation':'extraction',bodyComplete:draft.bodyComplete??draft.status!=='generating',error:'原页面的生成已中断，最近草稿保留。请手动处理，不会自动重复调用模型。'});
  }
  private failed(error:unknown){
    if(this.persistFailure)return;
    this.persistFailure=error;
    const active=[...this.service.engine.active.values()];for(const job of active)job.controller.abort(error);
    this.recovering=(async()=>{
      await Promise.all(active.map(job=>job.promise));await this.pending.catch(()=>{});
      const drafts=this.repo.all<Draft>('drafts'),row=await this.store.read();
      this.db.replace(row.data||this.initialData);this.version=row.version;this.digest='';
      // Keep received prose in RAM for review, while official history is restored
      // exclusively from the last successful IndexedDB transaction.
      for(const draft of drafts)if(!this.repo.maybeDraft(draft.id)?.turnId&&this.repo.listSaves().some(save=>save.id===draft.saveId))this.repo.putDraft({...draft,status:'failed',turnId:null,error:'浏览器保存未完成；旧正式剧情保留，请导出备份、复制草稿并释放空间后重新打开。'});
    })();
  }
  private async refresh(){
    if(this.lease)return;
    const row=await this.store.read();
    if(row.version!==this.version){this.db.replace(row.data);this.version=row.version;this.digest='';}
    this.expired(row.leaseUntil);
  }
  private flush(){
    this.pending=this.pending.then(async()=>{
      if(!this.lease)return;
      const data=this.db.serialize(),digest=createHash('sha256').update(data).digest('hex') as string;
      if(digest===this.digest){await this.store.renew(this.lease);return;}
      this.version=await this.store.checkpoint(this.lease,this.version,data);this.digest=digest;
    });
    return this.pending;
  }
  private request(path:string,data?:unknown,signal?:AbortSignal){return new Request(location.origin+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{...(this.cookie?{cookie:this.cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:location.origin,'x-dayao-csrf':this.csrf})},body:data===undefined?undefined:JSON.stringify(data),signal});}
  async call(path:string,data?:unknown,signal?:AbortSignal){
    if(this.persistFailure){if(data!==undefined)throw this.persistFailure;await this.recovering;}
    const route=path.split('?')[0].split('/');
    if(route[0]==='ops')throw new BrowserStorageError('浏览器版没有服务器运维接口',403);
    if(data!==undefined&&!navigator.onLine&&/^(turns|suggestions|scenarios\/assist|providers|drafts\/.*\/(retry|repair))/.test(route.join('/')))throw new BrowserStorageError('当前离线，联网后才能生成新内容。',503);
    if(data!==undefined&&this.lease){
      const input=data as {clientRequestId?:string};
      const duplicate=route.join('/')==='turns'&&input.clientRequestId&&this.repo.maybeDraft(input.clientRequestId);
      if(!duplicate&&(route[0]!=='drafts'||route[2]!=='cancel'))throw new BrowserStorageError('本页仍在生成或保存，请等待原请求完成。');
      const response=await handle(this.request(path,data,signal),route,{security:this.security,service:this.service,dataDir:'当前浏览器 IndexedDB · 无服务器同步'});await this.flush();return response;
    }
    if(data===undefined){
      if(this.lease&&!this.persistFailure)await this.flush();else await this.refresh();
      const response=await handle(this.request(path,data,signal),route,{security:this.security,service:this.service,dataDir:'当前浏览器 IndexedDB · 无服务器同步'});
      if(path==='session'){
        this.cookie=(response.headers.get('set-cookie')||'').split(';')[0];this.csrf=(await response.clone().json()).csrf;
      }
      return response;
    }
    if(this.writing)throw new BrowserStorageError('本页正在保存，请等待，不会重复发送。');
    this.writing=true;let background=false;
    try{
      await this.refresh();const lease=crypto.randomUUID();await this.store.acquire(this.version,lease);this.lease=lease;
      const response=await handle(this.request(path,data,signal),route,{security:this.security,service:this.service,dataDir:'当前浏览器 IndexedDB · 无服务器同步'});
      await this.flush();
      if(this.service.engine.active.size){
        const active=[...this.service.engine.active.values()];
        const timer=setInterval(()=>void this.flush().catch(error=>this.failed(error)),2000);
        void Promise.all(active.map(job=>job.promise)).then(()=>this.flush()).catch(error=>this.failed(error)).finally(async()=>{clearInterval(timer);await this.pending.catch(()=>{});await this.store.release(lease).catch(()=>{});this.lease=undefined;this.writing=false;});
        background=true;
      }else await this.flush();
      return response;
    }catch(error){
      if(this.lease){for(const job of this.service.engine.active.values())job.controller.abort(error);await Promise.all([...this.service.engine.active.values()].map(job=>job.promise));if(!(error instanceof BrowserStorageError&&error.status===409))this.failed(error);}
      throw error;
    }finally{
      if(!background){if(this.lease)await this.store.release(this.lease).catch(()=>{});this.lease=undefined;this.writing=false;}
    }
  }
}
async function open(){
  const store=new BrowserStore(),row=await store.read(),SQL=await initSqlJs({locateFile:()=>sitePath('/sqlite/sql-wasm.wasm')});
  const db=new BrowserSqlite(SQL,row.data);
  if(row.data&&Number(db.pragma('user_version',{simple:true}))<3)await store.backup(row.data,true);
  return new BrowserRuntime(db,store,row.version,row.leaseUntil);
}
export async function browserRequest(path:string,data?:unknown,signal?:AbortSignal):Promise<Response>{
  try{return await (opening??=open()).then(runtime=>runtime.call(path,data,signal));}
  catch(error){return Response.json({error:error instanceof Error?error.message:'浏览器保存未完成，旧存档保留。'},{status:error instanceof BrowserStorageError?error.status:503});}
}
