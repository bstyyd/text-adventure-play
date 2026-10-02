import {describe,it,expect,beforeAll,vi} from 'vitest';
import initSqlJs from 'sql.js';
import type {SqlJsStatic} from 'sql.js';
import type Database from 'better-sqlite3';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
import {BrowserSqlite} from '../../src/browser/sqlite';
import {BrowserStore} from '../../src/browser/store';
import {Repository} from '../../src/storage/repository';
import {inputFor,testEngine} from '../helpers';
import {exportSave,importSave} from '../../src/storage/transfer';
import {createHash} from '../../src/browser/crypto';
import {mkdtempSync,mkdirSync} from 'node:fs';
import path from 'node:path';
let SQL:SqlJsStatic;
beforeAll(async()=>{SQL=await initSqlJs();vi.stubGlobal('indexedDB',indexedDB);});
function fixture(data?:Uint8Array){mkdirSync('.test-data',{recursive:true});const db=new BrowserSqlite(SQL,data),repo=new Repository(mkdtempSync(path.resolve('.test-data','browser-sql-')),{database:db as unknown as Database.Database,backup:async()=> 'fixture-backup'});return {db,repo};}
describe('browser SQLite uses the original rules and archive format',()=>{
  it('SHA-256 matches existing portable source identifiers',()=>{expect(createHash('sha256').update('abc').digest('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');});
  it('prologue, AI mock commit, snapshot restore and repeated request are intact',async()=>{
    const f=fixture(),save=f.repo.createSave({title:'浏览器中文存档'}),input=inputFor(f.repo,save.id),engine=testEngine(f.repo);
    engine.start(input);const draft=await engine.wait(input.clientRequestId);expect(draft.status).toBe('committed');
    expect(engine.start(input).turnId).toBe(draft.turnId);expect(f.repo.view(save.id).turns).toHaveLength(2);
    const restored=fixture(f.db.serialize());expect(restored.repo.view(save.id).turns.at(-1)?.body).toBe(f.repo.view(save.id).turns.at(-1)?.body);expect(restored.repo.view(save.id).turns[0].state.present).toEqual([]);
    const fork=restored.repo.fork(save.id,restored.repo.save(save.id).currentBranchId,restored.repo.view(save.id).turns[0].id,'旧节点新分支');expect(restored.repo.view(save.id,fork.id).turns).toHaveLength(1);
    f.repo.close();restored.repo.close();
  });
  it('nested transaction and foreign keys still work after serializing',()=>{
    const {db,repo}=fixture();db.exec('CREATE TABLE fixture_parent(id INTEGER PRIMARY KEY); CREATE TABLE fixture_child(id INTEGER REFERENCES fixture_parent(id))');db.serialize();
    expect(()=>db.prepare('INSERT INTO fixture_child VALUES(?)').run(9)).toThrow();
    expect(()=>db.transaction(()=>{db.prepare('INSERT INTO fixture_parent VALUES(?)').run(1);db.transaction(()=>db.prepare('INSERT INTO fixture_child VALUES(?)').run(1))();throw new Error('rollback');})()).toThrow('rollback');
    expect(db.prepare('SELECT * FROM fixture_parent').all()).toEqual([]);expect(db.prepare('SELECT * FROM fixture_child').all()).toEqual([]);repo.close();
  });
  it('full JSON imports as a new save, preserving sources and leaving old saves',async()=>{
    const {repo}=fixture(),save=repo.createSave(),engine=testEngine(repo),input=inputFor(repo,save.id);engine.start(input);await engine.wait(input.clientRequestId);
    const archive=exportSave(repo,save.id),before=repo.view(save.id).turns.map(t=>t.body),copy=importSave(repo,JSON.stringify(archive));
    expect(copy.id).not.toBe(save.id);expect(repo.view(save.id).turns.map(t=>t.body)).toEqual(before);expect(repo.view(copy.id).turns.map(t=>t.body)).toEqual(before);repo.close();
  });
});
describe('IndexedDB commits and leases',()=>{
  it('persists across connection reopening, with a separate storage namespace',async()=>{
    const name='fixture-'+crypto.randomUUID(),a=new BrowserStore(Date.now,name);await a.acquire(0,'one');await a.checkpoint('one',0,new Uint8Array([1,2]));await a.release('one');await a.close();
    const b=new BrowserStore(Date.now,name);expect(await b.read()).toMatchObject({version:1,data:new Uint8Array([1,2]),leaseUntil:0});await b.close();
  });
  it('concurrent writers and stale versions cannot overwrite a save',async()=>{
    const name='fixture-'+crypto.randomUUID(),a=new BrowserStore(Date.now,name),b=new BrowserStore(Date.now,name);await a.acquire(0,'one');await expect(b.acquire(0,'two')).rejects.toThrow('另一页面');
    await a.checkpoint('one',0,new Uint8Array([3]));await expect(a.checkpoint('one',0,new Uint8Array([9]))).rejects.toThrow('版本');await a.release('one');await expect(b.acquire(0,'two')).rejects.toThrow('新进度');expect((await b.read()).data).toEqual(new Uint8Array([3]));await a.close();await b.close();
  });
  it('an expired writer cannot commit after another page takes over',async()=>{
    let now=100;const a=new BrowserStore(()=>now,'fixture-'+crypto.randomUUID());await a.acquire(0,'old');await a.checkpoint('old',0,new Uint8Array([1]));now+=45001;await a.acquire(1,'new');await expect(a.checkpoint('old',1,new Uint8Array([2]))).rejects.toThrow('权限');expect((await a.read()).data).toEqual(new Uint8Array([1]));await a.close();
  });
  it('quota failure preserves the previous bytes and revision',async()=>{
    const a=new BrowserStore(Date.now,'fixture-'+crypto.randomUUID());await a.acquire(0,'one');await a.checkpoint('one',0,new Uint8Array([1]));
    const original=IDBObjectStore.prototype.put,spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw new DOMException('fixture','QuotaExceededError');});
    await expect(a.checkpoint('one',1,new Uint8Array([2]))).rejects.toThrow('空间不足');spy.mockImplementation(original);spy.mockRestore();expect(await a.read()).toMatchObject({version:1,data:new Uint8Array([1])});await a.close();
  });
});
