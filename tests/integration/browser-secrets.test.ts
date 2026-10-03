import {beforeAll,describe,it,expect,vi} from 'vitest';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
import {BrowserSecretVault} from '../../src/browser/secrets';
import {DEFAULT_PROFILES} from '../../src/llm/config';

beforeAll(()=>vi.stubGlobal('indexedDB',indexedDB));
const profile=DEFAULT_PROFILES[2],secret='local-key-fixture';
const name=()=> 'key-fixture-'+crypto.randomUUID();

describe('browser credentials are separate from story snapshots',()=>{
  it('restores a remembered key and keeps it when changing only the model',async()=>{
    const db=name(),first=new BrowserSecretVault(db);
    await first.save(profile,secret,true);await first.close();
    const second=new BrowserSecretVault(db),changed={...profile,model:'other-model'};
    await second.restore([changed]);
    expect(second.get(changed)).toBe(secret);expect(second.remembered(changed)).toBe(true);
    await second.save(changed,'',true);await second.close();
    const third=new BrowserSecretVault(db);await third.restore([changed]);expect(third.get(changed)).toBe(secret);await third.close();
  });
  it('temporary mode keeps this page usable but does not persist the key',async()=>{
    const db=name(),first=new BrowserSecretVault(db);
    await first.save(profile,secret,false);expect(first.get(profile)).toBe(secret);expect(first.remembered(profile)).toBe(false);
    const second=new BrowserSecretVault(db);await second.restore([profile]);expect(second.has(profile)).toBe(false);await second.close();
  });
  it('turning remembering off with a blank field deletes persistence and retains this page key',async()=>{
    const db=name(),first=new BrowserSecretVault(db);
    await first.save(profile,secret,true);await first.save(profile,'',false);
    expect(first.get(profile)).toBe(secret);expect(first.remembered(profile)).toBe(false);
    const second=new BrowserSecretVault(db);await second.restore([profile]);expect(second.has(profile)).toBe(false);
    await first.close();await second.close();
  });
  it('forgetting removes the current key and only its own persistent entry',async()=>{
    const db=name(),first=new BrowserSecretVault(db),other={...profile,id:'second-profile'};
    await first.save(profile,secret,true);await first.save(other,'other-local-key-fixture',true);
    await first.forget(profile);expect(first.has(profile)).toBe(false);expect(first.remembered(profile)).toBe(false);await first.close();
    const second=new BrowserSecretVault(db);await second.restore([profile,other]);
    expect(second.has(profile)).toBe(false);expect(second.get(other)).toBe('other-local-key-fixture');await second.close();
  });
  it('never reuses a credential when a configuration changes supplier',async()=>{
    const db=name(),first=new BrowserSecretVault(db),changed={...DEFAULT_PROFILES[1],id:profile.id};
    await first.save(profile,secret,true);expect(first.get(changed)).toBe('');await first.close();
    const second=new BrowserSecretVault(db);await second.restore([changed]);expect(second.has(changed)).toBe(false);
    await second.save(changed,'',true);await second.close();
    const third=new BrowserSecretVault(db);await third.restore([profile]);expect(third.has(profile)).toBe(false);await third.close();
  });
  it('failed persistence does not report a new key as saved or erase the previous one',async()=>{
    const db=name(),vault=new BrowserSecretVault(db);await vault.save(profile,secret,true);
    const original=IDBObjectStore.prototype.put,spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value,key){
      if(this.name==='keys')throw new DOMException('fixture','QuotaExceededError');
      return original.call(this,value,key);
    });
    try{await expect(vault.save(profile,'replacement-fixture',true)).rejects.toThrow('本机密钥未保存');}
    finally{spy.mockRestore();}
    expect(vault.get(profile)).toBe(secret);expect(vault.remembered(profile)).toBe(true);await vault.close();
    const restored=new BrowserSecretVault(db);await restored.restore([profile]);expect(restored.get(profile)).toBe(secret);await restored.close();
  });
  it('blocked key storage still permits temporary keys and does not stop opening the game',async()=>{
    vi.stubGlobal('indexedDB',undefined);
    try{
      const vault=new BrowserSecretVault(name());await vault.restore([profile]);expect(vault.storageWarning()).toContain('无法读取');
      await vault.save(profile,secret,false);expect(vault.get(profile)).toBe(secret);expect(vault.storageWarning()).toContain('无法读取');
      await expect(vault.save(profile,secret,true)).rejects.toThrow('此浏览器无法记住密钥');
    }finally{vi.stubGlobal('indexedDB',indexedDB);}
  });
});
