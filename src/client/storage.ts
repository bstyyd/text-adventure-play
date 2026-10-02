import type { OfflineCopy } from '../domain/offline';
import { validateCopyReplacement, validateOfflineCopy } from './offline-copy';

const DB='dayao-browser-v1',STORE='records';
let opening:Promise<IDBDatabase>|undefined;
function database(){
  return opening??=new Promise<IDBDatabase>((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('浏览器不支持离线存储；请保持网页打开并导出备份。'));return;}
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
    request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=undefined;};resolve(request.result);};
    request.onerror=()=>{opening=undefined;reject(request.error);};
    request.onblocked=()=>{opening=undefined;reject(new Error('浏览器存储正被旧页面占用，请关闭旧页面后重试。'));};
  });
}
export async function readLocal<T>(key:string):Promise<T|undefined>{
  const db=await database();return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result as T|undefined);r.onerror=()=>reject(r.error);});
}
export async function writeLocal(key:string,value:unknown){
  const db=await database();return new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');if(value===undefined)tx.objectStore(STORE).delete(key);else tx.objectStore(STORE).put(value,key);
    tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error(tx.error?.name==='QuotaExceededError'?'浏览器存储空间不足；旧离线副本保留，请导出备份并释放空间。':'浏览器无法保存数据；请检查隐私模式／存储权限，并导出备份。'));
  });
}
export async function allCopies():Promise<OfflineCopy[]>{
  const db=await database();return new Promise((resolve,reject)=>{
    const r=db.transaction(STORE).objectStore(STORE).openCursor(),values:OfflineCopy[]=[];
    r.onsuccess=()=>{const c=r.result;if(c){if(String(c.key).startsWith('copy:'))values.push(c.value as OfflineCopy);c.continue();}else resolve(values);};r.onerror=()=>reject(r.error);
  });
}
export async function storeCopy(copy:OfflineCopy){
  validateOfflineCopy(copy);
  const db=await database();
  // Compare and replace in one transaction, including concurrent downloads from tabs.
  return new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),key='copy:'+copy.saveId;
    let failure:Error|undefined;
    tx.oncomplete=()=>resolve();
    tx.onabort=tx.onerror=()=>reject(failure||new Error(tx.error?.name==='QuotaExceededError'?'浏览器存储空间不足；旧离线副本保留，请导出备份并释放空间。':'浏览器无法保存数据；旧离线副本保留，请检查存储权限并导出备份。'));
    const request=store.get(key);
    request.onsuccess=()=>{
      try{validateCopyReplacement(copy,request.result as OfflineCopy|undefined);store.put(copy,key);}
      catch(error){failure=error instanceof DOMException?new Error(error.name==='QuotaExceededError'?'浏览器存储空间不足；旧离线副本保留，请导出备份并释放空间。':'浏览器无法保存数据；旧离线副本保留。'):error as Error;tx.abort();}
    };
  });
}
export function requestId(){
  // getRandomValues also works on HTTP LAN, where randomUUID may be unavailable.
  if(globalThis.crypto.randomUUID)return globalThis.crypto.randomUUID();
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const h=[...b].map(v=>v.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
export function storageError(error:unknown){return error instanceof Error?error.message:'浏览器存储不可用。';}
