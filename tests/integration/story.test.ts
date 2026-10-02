import { afterEach,describe,it,expect,vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync,readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { temporaryRepo,testEngine,inputFor } from '../helpers';
import { MockProvider } from '../../src/llm/mock';
import type { TextRequest } from '../../src/llm/types';
import type { StreamEvent } from '../../src/llm/types';
import { ProviderError } from '../../src/llm/types';
import { Repository } from '../../src/storage/repository';
import { contextFor,filterHistory } from '../../src/memory/context';
import { exportSave,importSave,parseArchive } from '../../src/storage/transfer';
import { TurnEngine } from '../../src/engine/engine';
import { DEFAULT_PROFILES } from '../../src/llm/config';
const open:Repository[]=[];
function setup(provider=new MockProvider()){const repo=temporaryRepo();open.push(repo);const save=repo.createSave();return {repo,save,engine:testEngine(repo,provider)};}
async function turn(env:ReturnType<typeof setup>,text:string){const d=env.engine.start(inputFor(env.repo,env.save.id,text));return env.engine.wait(d.id);}
afterEach(()=>{for(const repo of open.splice(0))if(repo.db.open)repo.close();});
describe('纵向链路与原子存档 M1 M2',()=>{
  it('complete prose survives extractor timeout; retry extracts without regenerating',async()=>{
    class TimeoutExtractor extends MockProvider{
      fail=true;bodyCalls=0;extractTimeouts:number[]=[];
      override async generateText(r:TextRequest){
        if(r.system.startsWith('EXTRACTOR')){this.extractTimeouts.push(r.profile.timeoutMs);if(this.fail)throw new ProviderError('TIMEOUT','请求等待超时。');}
        else this.bodyCalls++;
        return super.generateText(r);
      }
    }
    const provider=new TimeoutExtractor(),env=setup(provider),failed=await turn(env,'让沈彻进来');
    expect(failed).toMatchObject({status:'failed',bodyComplete:true,bodyFinishReason:'stop',failureStage:'extraction',failureCode:'TIMEOUT'});
    expect(failed.error).toContain('正文已完整接收');expect(env.repo.view(env.save.id).turns).toHaveLength(1);
    env.repo.putProfile({...DEFAULT_PROFILES[0],timeoutMs:180000});provider.fail=false;
    env.engine.retry(failed.id,true);const committed=await env.engine.wait(failed.id);
    expect(committed.status).toBe('committed');expect(committed.body).toBe(failed.body);
    expect(provider.bodyCalls).toBe(1);expect(provider.extractTimeouts).toEqual([90000,180000]);
  });
  it('partial prose cannot enter memory until the player explicitly reviews it',async()=>{
    class Partial extends MockProvider{
      override async *streamText(r:TextRequest):AsyncIterable<StreamEvent>{
        r.onAttempt?.();yield {type:'delta',text:'门外的人仍在等候。'};
        throw new ProviderError('OUTPUT_LIMIT','达到输出上限。',undefined,'门外的人仍在等候。','length');
      }
    }
    const env=setup(new Partial()),failed=await turn(env,'暂且等候。');
    expect(failed).toMatchObject({body:'门外的人仍在等候。',bodyComplete:false,failureStage:'generation',failureCode:'OUTPUT_LIMIT'});
    expect(()=>env.engine.retry(failed.id,true)).toThrow(/未确认完整/);expect(env.repo.view(env.save.id).turns).toHaveLength(1);
    env.engine.retry(failed.id,true,'门外的人仍在等候。\n\n廊下安静。');
    expect((await env.engine.wait(failed.id)).status).toBe('committed');
  });
  it('legacy drafts without finish metadata require explicit review',async()=>{
    const env=setup(),d=await turn(env,'让沈彻进来');
    const legacy={...d,id:crypto.randomUUID(),status:'failed' as const,turnId:null,bodyComplete:undefined,bodyFinishReason:undefined,expectedHeadTurnId:env.repo.view(env.save.id).branch.headTurnId};
    env.repo.putDraft(legacy);
    expect(()=>env.engine.retry(legacy.id,true)).toThrow(/核对/);expect(env.repo.draft(legacy.id).body).toBe(d.body);
  });
  it('a stream ending without a completion event never advances history',async()=>{
    class NoCompletion extends MockProvider{override async *streamText():AsyncIterable<StreamEvent>{yield {type:'delta',text:'半句未完'};}}
    const env=setup(new NoCompletion()),d=await turn(env,'稍等。');
    expect(d).toMatchObject({status:'failed',bodyComplete:false,failureStage:'generation',body:'半句未完'});
    expect(env.repo.view(env.save.id).turns).toHaveLength(1);
  });
  it('A01 A02 starts without generating, retains exact unresolved facts',()=>{const {repo,save}=setup(),v=repo.view(save.id);expect(v.turns).toHaveLength(1);expect(v.turns[0].requestCount).toBe(0);expect(v.turns[0].state.present).toEqual([]);expect(v.turns[0].effects.facts[0]).toMatchObject({kind:'unresolved',knownBy:[]});});
  it('B01 C05 C07 G08 ten same-night messages, idempotency, deduplicated memories',async()=>{
    const env=setup();await turn(env,'让沈彻进来');const request=inputFor(env.repo,env.save.id,'明日再查');
    env.engine.start(request);await env.engine.wait(request.clientRequestId);const same=env.engine.start(request);expect(same.status).toBe('committed');
    for(let i=0;i<8;i++)expect((await turn(env,'明日再查')).status).toBe('committed');
    const v=env.repo.view(env.save.id),head=v.turns.at(-1)!;
    expect(v.turns).toHaveLength(11);expect(head.state.date.day).toBe(28);expect(head.state.messageCount).toBe(10);expect(head.state.sceneCount).toBe(1);
    expect(v.turns.flatMap(t=>t.effects.facts).filter(f=>f.content==='明日再查')).toHaveLength(1);
    expect(head.state.relationships.shen_che).toMatchObject({values:{trust:70,affection:50}});
    const ctx=contextFor(v.turns,'记得承诺吗','shen_che');expect(ctx.system).toContain('明日再查');
  });
  it('B07 OOC stays outside canon and context',async()=>{const env=setup(),before=env.repo.view(env.save.id).turns.at(-1)!;const d=await turn(env,'OOC：不要推进时间');expect(d.status).toBe('committed');const v=env.repo.view(env.save.id);expect(v.turns.at(-1)).toEqual(before);expect(v.ooc).toHaveLength(1);expect(contextFor(v.turns,'你好',null).system).not.toContain('不要推进时间');});
  it('G01 F07 failed extraction does one repair, leaves draft; retry does not regenerate body',async()=>{
    class Flaky extends MockProvider{fail=true;extractCalls=0;bodyCalls=0;override async generateText(r:TextRequest){const result=await super.generateText(r);if(r.system.startsWith('EXTRACTOR')){this.extractCalls++;if(this.fail)return {...result,text:'{broken'};}else this.bodyCalls++;return result;}}
    const provider=new Flaky(),env=setup(provider),before=env.repo.view(env.save.id).turns.at(-1)!.id;
    const failed=await turn(env,'让沈彻进来');expect(failed.status).toBe('failed');expect(failed.body).not.toBe('');expect(provider.extractCalls).toBe(2);expect(env.repo.view(env.save.id).branch.headTurnId).toBe(before);
    provider.fail=false;env.engine.retry(failed.id,true);expect((await env.engine.wait(failed.id)).status).toBe('committed');expect(provider.bodyCalls).toBe(1);
  });
  it('G03 G04 branch lock rejects duplicate active generation while history remains readable',async()=>{
    class Slow extends MockProvider{override async generateText(r:TextRequest){await new Promise(resolve=>setTimeout(resolve,20));return super.generateText(r);}}
    const env=setup(new Slow()),d=env.engine.start(inputFor(env.repo,env.save.id));expect(()=>env.engine.start(inputFor(env.repo,env.save.id,'另一窗口'))).toThrow(/已有/);
    expect(env.repo.view(env.save.id).turns).toHaveLength(1);await env.engine.wait(d.id);
  });
  it('G05 transaction crash rolls back prose, state, memory and head',async()=>{
    const env=setup();const d=await turn(env,'让沈彻进来'),old=env.repo.turn(d.turnId!);
    const req=inputFor(env.repo,env.save.id,'问问');const draft={...d,id:req.clientRequestId,expectedHeadTurnId:old.id,turnId:null,status:'validating' as const};env.repo.putDraft(draft);
    const next={...old,id:crypto.randomUUID(),parentTurnId:old.id,requestId:draft.id,effects:{...old.effects,facts:[],knowledge:[],memories:[]}};
    expect(()=>env.repo.commit(draft,next,true)).toThrow(/Simulated/);expect(env.repo.view(env.save.id).branch.headTurnId).toBe(old.id);expect(()=>env.repo.turn(next.id)).toThrow();
  });
  it('G03 stale head conflict retains draft',async()=>{
    const env=setup(),original=env.repo.view(env.save.id).branch.headTurnId;
    const d=await turn(env,'让沈彻进来'),t=env.repo.turn(d.turnId!);
    const draft={...d,id:crypto.randomUUID(),expectedHeadTurnId:original,status:'validating' as const,turnId:null};env.repo.putDraft(draft);
    expect(()=>env.repo.commit(draft,{...t,id:crypto.randomUUID(),requestId:draft.id})).toThrow(/另一窗口/);expect(env.repo.draft(draft.id).status).toBe('validating');
  });
  it('G06 restart keeps committed nodes and marks in-flight draft recoverable',async()=>{const env=setup(),d=await turn(env,'让沈彻进来');env.repo.putDraft({...d,id:crypto.randomUUID(),status:'generating',turnId:null});const dir=env.repo.dir;env.repo.close();const reopened=new Repository(dir);open.push(reopened);const v=reopened.view(env.save.id);expect(v.turns).toHaveLength(2);expect(v.drafts[0].status).toBe('failed');});
  it('E11 G07 cancel never commits or consumes events; committed cancel is not rollback',async()=>{
    class Slow extends MockProvider{override async generateText(r:TextRequest){await new Promise(resolve=>setTimeout(resolve,30));return super.generateText(r);}}
    const env=setup(new Slow()),d=env.engine.start(inputFor(env.repo,env.save.id));env.engine.cancel(d.id);await env.engine.wait(d.id);expect(env.repo.view(env.save.id).turns).toHaveLength(1);
    const committed=await turn(env,'让沈彻进来');expect(env.engine.cancel(committed.id).status).toBe('committed');expect(env.repo.view(env.save.id).turns).toHaveLength(2);
  });
  it('F13 profile fixed during in-flight generation',async()=>{let selected=DEFAULT_PROFILES[0];class Slow extends MockProvider{override async generateText(r:TextRequest){await new Promise(resolve=>setTimeout(resolve,10));return super.generateText(r);}}const env=setup();const engine=new TurnEngine(env.repo,{provider:()=>new Slow(),secret:()=>'',profiles:()=>({narrator:selected,extractor:selected})});const d=engine.start(inputFor(env.repo,env.save.id));selected={...selected,model:'next-model'};await engine.wait(d.id);expect(env.repo.turn(env.repo.draft(d.id).turnId!).model).toBe('mock-novel-v1');});
});
describe('分支、日期、记忆 M4',()=>{
  it('D05 D06 D07 old future and summaries cannot leak through inherited ancestry',async()=>{
    const env=setup();await turn(env,'让沈彻进来');const split=env.repo.view(env.save.id).branch.headTurnId;
    await turn(env,'只有这一支的未来秘密：青铜鹤');await turn(env,'睡到明日');
    const old=env.repo.view(env.save.id),branch=env.repo.fork(env.save.id,old.branch.id,split,'未发生的未来');
    const fresh=env.repo.view(env.save.id,branch.id),ctx=contextFor(fresh.turns,'以前的秘密','shen_che');
    expect(fresh.turns).toHaveLength(2);expect(JSON.stringify(ctx)).not.toContain('青铜鹤');expect(fresh.turns.at(-1)!.state.date.day).toBe(28);
    expect(env.repo.view(env.save.id,old.branch.id).turns.some(t=>t.playerText.includes('青铜鹤'))).toBe(true);
  });
  it('C10 D01 D02 numeric cutoff, Chinese substring and aliases',async()=>{const env=setup();await turn(env,'让沈彻进来');await turn(env,'睡到明日');const v=env.repo.view(env.save.id),day=v.turns.at(-1)!.state.date.absoluteDay;expect(filterHistory(v.turns,{to:day,inclusive:false}).every(t=>t.state.date.day===28)).toBe(true);expect(filterHistory(v.turns,{to:day,inclusive:true})).toHaveLength(3);expect(filterHistory(v.turns,{keyword:'沈彻'}).length).toBeGreaterThan(0);expect(filterHistory(v.turns,{npc:'shen_che'}).length).toBeGreaterThan(0);});
  it('D03 D04 reading snapshots leaves head unchanged',async()=>{const env=setup();const first=env.repo.view(env.save.id).turns[0];await turn(env,'让沈彻进来');const latest=env.repo.view(env.save.id).branch.headTurnId;expect(env.repo.turn(first.id).state.present).toEqual([]);filterHistory(env.repo.view(env.save.id).turns,{keyword:'脚步'});expect(env.repo.view(env.save.id).branch.headTurnId).toBe(latest);});
  it('C11 style-reference sentinel never enters history or retrieval',()=>{const env=setup();env.repo.db.prepare('INSERT INTO style_references VALUES (?,?,?,?)').run(crypto.randomUUID(),'sample.md','唯一参考哨兵：早已赐婚','2026');const v=env.repo.view(env.save.id);expect(JSON.stringify(contextFor(v.turns,'哨兵',null))).not.toContain('早已赐婚');expect(filterHistory(v.turns,{keyword:'哨兵'})).toHaveLength(0);});
  it('C03 cross-save isolation and bounded context preserve ownership',async()=>{const env=setup();await turn(env,'孤档秘密');const other=env.repo.createSave({title:'另一本'});expect(JSON.stringify(contextFor(env.repo.view(other.id).turns,'秘密',null))).not.toContain('孤档秘密');expect(contextFor(env.repo.view(other.id).turns,'',null,[],7000).system).toContain('玩家唯一扮演玄天华');});
  it('C03 C07 repeated statement shares existing memory only with new witnesses',async()=>{
    const env=setup();await turn(env,'让沈彻进来');await turn(env,'明日再查');expect((await turn(env,'请顾青崖来见')).status).toBe('committed');
    const before=contextFor(env.repo.view(env.save.id).turns,'明日再查','gu_qingya').preview.facts.find(f=>f.content==='明日再查')!;
    expect(before.knownBy).not.toContain('gu_qingya');
    await turn(env,'明日再查');
    const v=env.repo.view(env.save.id),facts=v.turns.flatMap(t=>t.effects.facts).filter(f=>f.content==='明日再查');
    expect(facts).toHaveLength(1);expect(contextFor(v.turns,'明日再查','gu_qingya').preview.facts.find(f=>f.id===facts[0].id)!.knownBy).toContain('gu_qingya');
  });
});
describe('可恢复数据 M5 H03–H07',()=>{
  it('deleting a save first creates a complete backup and leaves other saves intact',async()=>{
    const env=setup();await turn(env,'让沈彻进来');
    const original=env.repo.view(env.save.id);
    env.repo.fork(env.save.id,original.branch.id,original.turns[0].id,'删除前分支');
    const other=env.repo.createSave({title:'保留的卷册'}),otherBefore=exportSave(env.repo,other.id);
    await env.repo.deleteSave(env.save.id);
    expect(()=>env.repo.save(env.save.id)).toThrow();
    expect(exportSave(env.repo,other.id)).toEqual(otherBefore);
    const backupDir=path.join(env.repo.dir,'backups');
    const files=readdirSync(backupDir).filter(f=>f.startsWith('manual-'));
    expect(files).toHaveLength(1);
    const backup=new Database(path.join(backupDir,files[0]),{readonly:true});
    try{
      expect(backup.pragma('integrity_check',{simple:true})).toBe('ok');
      expect(backup.prepare('SELECT COUNT(*) as n FROM saves').get()).toEqual({n:2});
      expect(backup.prepare('SELECT COUNT(*) as n FROM branches WHERE save_id=?').get(env.save.id)).toEqual({n:2});
      expect(backup.prepare('SELECT COUNT(*) as n FROM turns WHERE save_id=?').get(env.save.id)).toEqual({n:2});
    }finally{backup.close();}
  });
  it('failed backup prevents save deletion without changing its content',async()=>{
    const env=setup();await turn(env,'让沈彻进来');const before=exportSave(env.repo,env.save.id);
    const backup=vi.spyOn(env.repo,'backup').mockRejectedValueOnce(new Error('备份失败测试'));
    await expect(env.repo.deleteSave(env.save.id)).rejects.toThrow('备份失败测试');
    expect(exportSave(env.repo,env.save.id)).toEqual(before);backup.mockRestore();
  });
  it('H07 migration failure keeps original database and a verified backup',()=>{
    const env=setup(),dir=env.repo.dir;env.repo.db.pragma('user_version=0');env.repo.close();
    expect(()=>new Repository(dir)).toThrow();
    const original=new Database(path.join(dir,'dayao.sqlite'),{readonly:true});expect(original.prepare('SELECT COUNT(*) as n FROM saves').get()).toEqual({n:1});original.close();
    const file=readdirSync(dir).find(f=>f.startsWith('before-migration-'));expect(file).toBeTruthy();
    const backup=new Database(path.join(dir,file!),{readonly:true});expect(backup.pragma('integrity_check',{simple:true})).toBe('ok');backup.close();
  });
  it('D08 author revision branches without old future or a narrator call',async()=>{
    const env=setup();const original=await turn(env,'让沈彻进来'),old=env.repo.turn(original.turnId!);
    const branch=env.repo.fork(env.save.id,old.branchId,old.parentTurnId!,'作者修订');
    const request=inputFor(env.repo,env.save.id,'暂且等待。');
    const revised=env.engine.start(request,'门外的人停下脚步，等候回应。');await env.engine.wait(revised.id);
    const v=env.repo.view(env.save.id,branch.id);expect(v.turns.at(-1)!.body).toBe('门外的人停下脚步，等候回应。');expect(v.turns.at(-1)!.model).toBe('author-revision');expect(v.turns.at(-1)!.state.present).toEqual([]);
    expect(env.repo.turn(old.id).state.present).toContain('shen_che');
  });
  it('complete JSON roundtrip preserves date, branches, memory, original prose and source IDs',async()=>{
    const env=setup();await turn(env,'让沈彻进来');const old=env.repo.view(env.save.id);env.repo.fork(env.save.id,old.branch.id,old.turns[0].id,'分支');await turn(env,'明日再查');
    const archive=exportSave(env.repo,env.save.id);expect(JSON.stringify(archive)).not.toMatch(/apiKey|reasoning_content/);
    const save=importSave(env.repo,JSON.stringify(archive)),v=env.repo.view(save.id);
    expect(save.id).not.toBe(env.save.id);expect(v.branches).toHaveLength(2);expect(v.turns.at(-1)!.playerText).toBe('明日再查');expect(v.turns.at(-1)!.state.date).toEqual(env.repo.view(env.save.id).turns.at(-1)!.state.date);
    expect(()=>parseArchive(JSON.stringify(exportSave(env.repo,save.id)))).not.toThrow();
    expect(env.repo.listSaves()).toHaveLength(2);
  });
  it('rejects corruption, unsupported ZIP and oversized data',()=>{const env=setup(),archive=exportSave(env.repo,env.save.id);expect(()=>parseArchive(JSON.stringify({...archive,sha256:'0'.repeat(64)}))).toThrow(/完整性/);expect(()=>parseArchive('PK../../evil')).toThrow(/JSON/);expect(()=>parseArchive('x'.repeat(20*1024*1024+1))).toThrow(/20MB/);});
  it('rejects missing sources even with recomputed checksum',()=>{const env=setup(),archive=exportSave(env.repo,env.save.id);archive.payload.turns[0].parentTurnId=crypto.randomUUID();archive.sha256=createHash('sha256').update(JSON.stringify(archive.payload)).digest('hex');expect(()=>parseArchive(JSON.stringify(archive))).toThrow(/节点/);});
  it('WAL-safe backup is an independently readable complete database',async()=>{const env=setup();await turn(env,'让沈彻进来');const file=await env.repo.backup();expect(readFileSync(file).subarray(0,15).toString()).toBe('SQLite format 3');const db=new Database(file,{readonly:true});expect(db.pragma('integrity_check',{simple:true})).toBe('ok');expect(db.prepare('SELECT COUNT(*) as n FROM turns').get()).toEqual({n:2});db.close();});
});
