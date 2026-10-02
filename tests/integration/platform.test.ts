import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SQLiteStorageAdapter } from '../../src/platform/sqlite-storage';
import { StorageConflict } from '../../src/platform/contracts';
import { SecretVault } from '../../src/security/local';
import { DEFAULT_PROFILES } from '../../src/llm/config';

describe('portable platform records (isolated database)', () => {
  afterEach(()=>vi.unstubAllEnvs());
  it('preserves ownership and atomically refuses stale versions without partial records', async () => {
    const db = new Database(':memory:'), store = new SQLiteStorageAdapter(db);
    const key = {ownerId:'player-a',collection:'saves',id:'save-1'};
    await store.atomic([{...key,expectedRevision:null,value:{head:'old',trust:70}}]);
    expect(await store.read({...key,ownerId:'player-b'})).toBeNull();
    expect(await store.list('player-b','saves')).toEqual([]);
    await expect(store.atomic([{...key,expectedRevision:2,value:{head:'illegal'}},{...key,collection:'turns',id:'turn-1',expectedRevision:null,value:{body:'must not be written'}}])).rejects.toBeInstanceOf(StorageConflict);
    expect((await store.read<{head:string}>(key))?.value.head).toBe('old');
    expect(await store.list('player-a','turns')).toEqual([]);
    await store.atomic([{...key,expectedRevision:1,value:{head:'new',trust:72}},{...key,collection:'turns',id:'turn-1',expectedRevision:null,value:{body:'accepted'}}]);
    expect((await store.read(key))?.revision).toBe(2);
    expect(await store.list('player-a','turns')).toHaveLength(1);
    db.close();
  });
  it('rolls back all statements on a disk/constraint failure', async () => {
    const db = new Database(':memory:'), store = new SQLiteStorageAdapter(db);
    db.exec("CREATE TRIGGER fail_turn BEFORE INSERT ON platform_records WHEN NEW.collection='turns' BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END");
    await expect(store.atomic([{ownerId:'owner',collection:'saves',id:'s1',expectedRevision:null,value:{}},{ownerId:'owner',collection:'turns',id:'t1',expectedRevision:null,value:{}}])).rejects.toThrow('simulated disk failure');
    expect(await store.list('owner','saves')).toEqual([]);
    db.close();
  });
  it('rejects duplicate keys and invalid storage names before mutation', async () => {
    const db = new Database(':memory:'), store = new SQLiteStorageAdapter(db);
    const change={ownerId:'a',collection:'jobs',id:'id',expectedRevision:null,value:{status:'queued'}};
    await expect(store.atomic([change,change])).rejects.toThrow('重复');
    await expect(store.read({...change,collection:'jobs; DROP TABLE saves'})).rejects.toThrow('无效');
    expect(await store.list('a','jobs')).toEqual([]);
    db.close();
  });
  it('secret interface resolves server overrides without returning them as config', async () => {
    const vault = new SecretVault(), profile=DEFAULT_PROFILES[0];
    vault.set(profile,'test-platform-sentinel');
    expect(await vault.configured(profile)).toBe(true);
    expect(await vault.resolve(profile)).toBe('test-platform-sentinel');
    expect(JSON.stringify(profile)).not.toContain('test-platform-sentinel');
    vault.clear(profile.id);
  });
  it('supports Google AI server secrets while retaining existing GOOGLE_API_KEY configurations',async()=>{
    const vault=new SecretVault(),profile=DEFAULT_PROFILES[3];
    vi.stubEnv('GOOGLE_API_KEY','legacy-server-key');vi.stubEnv('GOOGLE_AI_API_KEY','');
    expect(await vault.resolve(profile)).toBe('legacy-server-key');
    vi.stubEnv('GOOGLE_AI_API_KEY','preferred-server-key');expect(await vault.resolve(profile)).toBe('preferred-server-key');
    vault.set(profile,'profile-memory-key');expect(await vault.resolve(profile)).toBe('profile-memory-key');
  });
});
