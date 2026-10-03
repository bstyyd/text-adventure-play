import {SecretVault} from '../security/local';
import type {Profile,ProviderId} from '../domain/types';

type SavedKey={id:string;provider:ProviderId;key:string};
const databaseName='interactive-fiction-provider-keys-v1';

// Credentials have their own database and never enter story snapshots or exports.
export class BrowserSecretVault extends SecretVault{
  private connection:Promise<IDBDatabase>|undefined;
  private entries=new Map<string,SavedKey>();
  private persisted=new Set<string>();
  private warning='';
  constructor(private name=databaseName){super();}
  private database(){
    return this.connection??=new Promise<IDBDatabase>((resolve,reject)=>{
      if(typeof indexedDB==='undefined'){reject(new Error('此浏览器无法记住密钥，请取消“在此设备记住 API Key”后保存。'));return;}
      const request=indexedDB.open(this.name,1);
      request.onupgradeneeded=()=>request.result.createObjectStore('keys',{keyPath:'id'});
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();this.connection=undefined;};resolve(request.result);};
      request.onerror=request.onblocked=()=>{this.connection=undefined;reject(new Error('无法访问本机密钥存储，请检查浏览器存储权限，或取消“在此设备记住 API Key”。'));};
    });
  }
  private async write(id:string,entry?:SavedKey){
    const db=await this.database();
    return new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('keys','readwrite'),store=tx.objectStore('keys');
      tx.oncomplete=()=>resolve();
      tx.onabort=tx.onerror=()=>reject(new Error('本机密钥未保存或清除，请检查存储权限与空间后重试。'));
      try{if(entry)store.put(entry);else store.delete(id);}catch{tx.abort();}
    });
  }
  async restore(profiles:Profile[]){
    try{
      const db=await this.database();
      const rows=await new Promise<SavedKey[]>((resolve,reject)=>{
        const request=db.transaction('keys').objectStore('keys').getAll();
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('无法读取本机密钥。'));
      });
      for(const row of rows){
        if(!row||typeof row.id!=='string'||typeof row.key!=='string'||!row.key||row.key.length>1000)continue;
        this.persisted.add(row.id);
        if(profiles.some(p=>p.id===row.id&&p.provider===row.provider&&p.provider!=='mock'))this.entries.set(row.id,row);
      }
      this.warning='';
    }catch{this.warning='无法读取已记住的 API Key。可以重新输入并取消“在此设备记住 API Key”，临时使用本页。';}
  }
  override set(profile:Profile,key:string){if(key)this.entries.set(profile.id,{id:profile.id,provider:profile.provider,key});}
  override get(profile:Profile){const row=this.entries.get(profile.id);return row?.provider===profile.provider?row.key:'';}
  override clear(id:string){this.entries.delete(id);this.persisted.delete(id);}
  override remembered(profile:Profile){return this.persisted.has(profile.id)&&!!this.get(profile);}
  override storageWarning(){return this.warning;}
  override async save(profile:Profile,key:string,remember=this.remembered(profile)){
    const secret=profile.provider==='mock'?'':key||this.get(profile);
    let storageChanged=false;
    if(remember&&secret){
      await this.write(profile.id,{id:profile.id,provider:profile.provider,key:secret});
      this.persisted.add(profile.id);storageChanged=true;
    }else if(this.persisted.has(profile.id)){
      await this.write(profile.id);this.persisted.delete(profile.id);storageChanged=true;
    }
    this.entries.delete(profile.id);
    if(secret)this.set(profile,secret);
    if(storageChanged)this.warning='';
  }
  override async forget(profile:Profile){
    await this.write(profile.id);this.clear(profile.id);this.warning='';
  }
  async close(){if(this.connection)(await this.connection).close();}
}
