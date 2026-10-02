import type { Draft, View } from '../domain/types';
import type { OfflineCopy } from '../domain/offline';
import { allCopies, readLocal, writeLocal } from './storage';
import {readableLegacyView} from './legacy-copy';
import {sitePath} from './site-path';
let csrf='',offline=false,requiresLogin=false;
export class ApiError extends Error{constructor(message:string,public status:number){super(message);}}
export const isOffline=()=>offline;
export function setOffline(value:boolean){if(value!==offline){offline=value;window.dispatchEvent(new CustomEvent('dayao-connectivity',{detail:value}));}}
export async function offlineRead(path:string){
  const [name,query]=path.split('?'),parts=name.split('/'),params=new URLSearchParams(query);
  if(name==='session')return {csrf:'',authenticated:true,loginRequired:false,offline:true};
  if(name==='bootstrap'){
    const copies=await allCopies();if(!copies.length)throw new Error('当前离线，尚无已下载的存档。请先启动服务，或联网后下载存档供离线阅读。');
    return {...copies[0].bootstrap,saves:copies.map(c=>c.views[Object.keys(c.views)[0]].save)};
  }
  if(parts[0]==='saves'){
    const copy=await readLocal<OfflineCopy>('copy:'+parts[1]);if(!copy)throw new Error('此存档尚未完整下载，联网后才能查看。');
    const branch=params.get('branch')||copy.bootstrap.saves[0].currentBranchId,view=copy.views[branch];
    if(!view)throw new Error('此分支不在已下载范围内。');
    if(parts[2]==='characters')return copy.books[branch+':'+(params.get('at')||view.branch.headTurnId)];
    if(parts[2]==='export')return copy.archive;
    if(parts.length===2)return readableLegacyView(view);
  }
  if(parts[0]==='drafts'){
    const draft=await readLocal<Draft>('received:'+parts[1]);if(draft)return draft;
  }
  throw new Error('当前离线，此操作需要连接主存档服务。');
}
export async function api<T>(path:string,data?:unknown,signal?:AbortSignal):Promise<T>{
  if(process.env.NEXT_PUBLIC_STATIC_PAGES==='true'){
    setOffline(!navigator.onLine);
    const {browserRequest}=await import('../browser/runtime');
    const response=await browserRequest(path,data,signal),value=await response.json();
    if(!response.ok)throw new ApiError(value.error||'浏览器处理失败',response.status);
    return value as T;
  }
  if(offline||!navigator.onLine){setOffline(true);if(data!==undefined)throw new Error('当前离线，联网后才能生成新内容或修改主存档。输入草稿保留。');return offlineRead(path) as Promise<T>;}
  let res:Response;
  try{res=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',headers:data===undefined?{}:{'Content-Type':'application/json','x-dayao-csrf':csrf},body:data===undefined?undefined:JSON.stringify(data),signal});}
  catch(error){if(signal?.aborted)throw error;setOffline(true);if(data===undefined)return offlineRead(path) as Promise<T>;throw new Error('连接中断，请先查询原请求状态。不会自动重复发送；输入与草稿已保留。');}
  const value=await res.json();if(!res.ok){if(res.status===401&&requiresLogin)window.dispatchEvent(new Event('dayao-login'));throw new ApiError(value.error||'主存档服务请求失败',res.status);}
  if(path==='session'||path==='login')csrf=value.csrf;
  if(path==='session')requiresLogin=value.loginRequired;
  return value;
}
export async function apiResponse(path:string){
  if(process.env.NEXT_PUBLIC_STATIC_PAGES==='true')return (await import('../browser/runtime')).browserRequest(path);
  return fetch(sitePath('/api/'+path),{cache:'no-store',credentials:'same-origin'});
}
export async function rememberView(view:View){
  // This is only a recovery envelope, not an implicit full offline download.
  await writeLocal('recovery:'+view.save.id+':'+view.branch.id,{...view,turns:view.turns.slice(-30)});
}
export async function reconnect(){setOffline(false);return api<{csrf:string;authenticated:boolean;loginRequired:boolean}>('session');}
