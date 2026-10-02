export type BrowserRecord={version:number;data?:Uint8Array;previous?:Uint8Array;lease?:string;leaseUntil:number;updatedAt:number};
const databaseName='interactive-fiction-pages-v1';
export class BrowserStorageError extends Error{constructor(message:string,public status=409){super(message);}}
export class BrowserStore{
  private connection:Promise<IDBDatabase>;
  constructor(private now=()=>Date.now(),name=databaseName){
    this.connection=new Promise((resolve,reject)=>{if(typeof indexedDB==='undefined'){reject(new BrowserStorageError('浏览器不支持 IndexedDB 存档，请更换浏览器。',503));return;}const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};request.onerror=()=>reject(new BrowserStorageError('浏览器存储不可用；请检查存储权限或隐私模式。',503));request.onblocked=()=>reject(new BrowserStorageError('旧页面占用存储，请关闭后重试。',503));});
  }
  private async mutate<T>(work:(store:IDBObjectStore,current:BrowserRecord)=>T){
    const db=await this.connection;
    return new Promise<T>((resolve,reject)=>{
      const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots'),request=store.get('primary');let result:T,failure:unknown;
      request.onsuccess=()=>{try{result=work(store,request.result||{version:0,leaseUntil:0,updatedAt:0});}catch(error){failure=error instanceof DOMException&&error.name==='QuotaExceededError'?new BrowserStorageError('浏览器存储空间不足，未覆盖旧存档。请导出备份并释放空间。',503):error;tx.abort();}};
      tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(failure||new BrowserStorageError(tx.error?.name==='QuotaExceededError'?'浏览器存储空间不足，未覆盖旧存档。请导出备份并释放空间。':'浏览器保存失败，未覆盖旧存档。请检查存储权限并导出备份。',503));
    });
  }
  async read():Promise<BrowserRecord>{const db=await this.connection;return new Promise((resolve,reject)=>{const request=db.transaction('snapshots').objectStore('snapshots').get('primary');request.onsuccess=()=>resolve(request.result||{version:0,leaseUntil:0,updatedAt:0});request.onerror=()=>reject(new BrowserStorageError('无法读取浏览器存档。',503));});}
  async acquire(version:number,lease:string){return this.mutate((store,row)=>{if(row.version!==version)throw new BrowserStorageError('另一页面已保存新进度；请刷新，不会覆盖。');if(row.lease&&row.leaseUntil>this.now())throw new BrowserStorageError('另一页面仍在生成或保存，请先等待原请求；不会重复调用模型。');store.put({...row,lease,leaseUntil:this.now()+45000},'primary');});}
  private valid(row:BrowserRecord,lease:string,version?:number){if(row.lease!==lease||row.leaseUntil<=this.now()||version!==undefined&&row.version!==version)throw new BrowserStorageError('保存权限或版本已变化；没有覆盖较新的存档，请刷新。');}
  async checkpoint(lease:string,version:number,data:Uint8Array){return this.mutate((store,row)=>{this.valid(row,lease,version);const next={...row,data,previous:row.data,version:version+1,updatedAt:this.now(),leaseUntil:this.now()+45000};store.put(next,'primary');return next.version;});}
  async renew(lease:string){return this.mutate((store,row)=>{this.valid(row,lease);store.put({...row,leaseUntil:this.now()+45000},'primary');});}
  async release(lease:string){return this.mutate((store,row)=>{if(row.lease===lease)store.put({...row,lease:undefined,leaseUntil:0},'primary');});}
  async backup(data:Uint8Array,automatic=false){return this.mutate(store=>{store.put({data,createdAt:this.now()},automatic?'automatic-backup':'manual-backup');});}
  async close(){(await this.connection).close();}
}
