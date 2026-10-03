import { afterEach,describe,expect,it,vi } from 'vitest';
import { TurnEngine } from '../../src/engine/engine';
import { draftRevision } from '../../src/engine/draft-review';
import { normalizeExtraction,MEMORY_NOTICES } from '../../src/engine/normalize-extraction';
import { publicDraft,publicView } from '../../src/characters/public';
import { characterWorld } from '../../src/characters/world';
import { MockProvider } from '../../src/llm/mock';
import { DEFAULT_PROFILES } from '../../src/llm/config';
import { exportSave,importSave } from '../../src/storage/transfer';
import type { Repository } from '../../src/storage/repository';
import { temporaryRepo,inputFor,emptyExtraction,putLegacyDraft } from '../helpers';

const prose='她心想先听听。\n\n沈彻推开门走进御书房。他说道：“北边出事了。”';
const player='看看来的人是谁，让对方进来';
const repos:Repository[]=[];
afterEach(()=>{for(const r of repos.splice(0))r.close();});
function setup(){
  const repo=temporaryRepo();repos.push(repo);const save=repo.createSave(),root=repo.view(save.id).turns[0];
  const x=emptyExtraction();
  x.sceneProposal={minutes:1,location:root.state.location,present:['shen_che'],weather:'春寒，夜静',evidence:{blockId:'b1',quote:'沈彻推开门走进御书房。'}};
  x.facts=[{kind:'claim',subject:'shen_che',content:'沈彻称北边出了事，细节未明。',evidence:{blockId:'b1',quote:'北边出事了'},knownBy:['shen_che'],revealed:true,importance:4}];
  x.eventProposals=[{key:'北边出事',status:'introduced',evidence:{blockId:'b1',quote:'北边出事了'}}];
  x.pendingThreads=['北边出事的细节尚未说明，待进一步禀报。'];x.validationWarnings=['参考意见及私密哨兵，不应返回浏览器'];
  const draft=putLegacyDraft(repo,save.id,player,prose,x);draft.requestCount=11;repo.putDraft(draft);
  const provider=vi.fn(()=>{throw Error('local save must not call a model');});
  const engine=new TurnEngine(repo,{provider,secret:()=>'',profiles:()=>({narrator:DEFAULT_PROFILES[0],extractor:DEFAULT_PROFILES[0]})});
  return {repo,save,root,draft,engine,provider,x};
}
describe('玩家决定正文与整理容错',()=>{
  it('automatically saves when the extractor includes player in NPC-only lists',async()=>{
    const e=setup();e.repo.putDraft({...e.draft,status:'cancelled'});
    e.x.sceneProposal!.present.push('player');e.x.facts[0].knownBy.push('player');
    class Narrator extends MockProvider{
      override async generateText(r:Parameters<MockProvider['generateText']>[0]){
        const result=await super.generateText(r);
        return {...result,text:r.system.startsWith('EXTRACTOR')?JSON.stringify(e.x):prose};
      }
    }
    const provider=new Narrator(),spy=vi.spyOn(provider,'generateText');
    const engine=new TurnEngine(e.repo,{provider:()=>provider,secret:()=>'',profiles:()=>({narrator:DEFAULT_PROFILES[0],extractor:DEFAULT_PROFILES[0]})});
    const d=await engine.wait(engine.start(inputFor(e.repo,e.save.id,player)).id);
    expect(d.status).toBe('committed');expect(d.requestCount).toBe(2);expect(spy).toHaveBeenCalledTimes(2);
    const turn=e.repo.view(e.save.id).turns.at(-1)!;
    expect(turn.state.present).toEqual(['shen_che']);expect(turn.effects.facts[0].knownBy).toEqual(['shen_che']);
    expect(turn.effects.diagnostics).toContain(MEMORY_NOTICES.player);
    expect(characterWorld(e.repo.view(e.save.id).turns).some(c=>c.id==='player')).toBe(false);
  });
  it('repairs an old player-list failure locally without another model call or rewriting prose',async()=>{
    const e=setup();e.draft.extraction!.sceneProposal!.present.push('player');e.draft.extraction!.facts[0].knownBy.push('player');
    const fact={...e.draft.extraction!.facts[0],kind:'intent' as const,subject:'player',content:'玩家想先听禀报。',knownBy:[],evidence:{blockId:'player',quote:player}};
    e.draft.extraction!.facts.push(fact);e.repo.putDraft(e.draft);
    const raw=structuredClone(e.draft.extraction!);
    const normalized=normalizeExtraction(e.root.state,player,prose,raw);
    expect(raw).toEqual(e.draft.extraction);expect(normalized.extraction.facts[1]).toEqual(fact);
    const saved=await e.engine.commitExtracted(e.draft.id,draftRevision(e.draft));
    expect(saved.status).toBe('committed');expect(saved.body).toBe(prose);expect(saved.requestCount).toBe(11);expect(e.provider).not.toHaveBeenCalled();
  });
  it('does not normalize unknown NPCs, hidden player knowledge or unsupported player NPC changes',async()=>{
    const e=setup(),before=exportSave(e.repo,e.save.id);
    for(const field of ['present','knownBy','hidden','knowledge','decision']){
      const draft=structuredClone(e.draft),x=draft.extraction!;
      x.sceneProposal!.present.push('player');
      if(field==='present')x.sceneProposal!.present.push('unknown-npc');
      if(field==='knownBy')x.facts[0].knownBy.push('unknown-npc');
      if(field==='hidden'){x.facts[0].revealed=false;x.facts[0].knownBy.push('player');}
      if(field==='knowledge')x.knowledgeProposals.push({npcId:'player',factIndex:0,path:'witness',evidence:x.facts[0].evidence});
      if(field==='decision'){x.facts[0].kind='confirmed_event';x.facts[0].subject='player';x.facts[0].knownBy.push('player');}
      e.repo.putDraft(draft);await expect(e.engine.commitExtracted(draft.id,draftRevision(draft))).rejects.toThrow();
      expect(exportSave(e.repo,e.save.id)).toEqual(before);expect(e.repo.draft(draft.id)).toEqual(draft);
    }
    expect(e.provider).not.toHaveBeenCalled();
  });
  it('normal generation saves with wording hints and model opinions, without a confirmation or repair request',async()=>{
    const env=setup();env.repo.putDraft({...env.draft,status:'cancelled'});
    class Narrator extends MockProvider{
      override async generateText(r:Parameters<MockProvider['generateText']>[0]){
        const result=await super.generateText(r);
        return {...result,text:r.system.startsWith('EXTRACTOR')?JSON.stringify(env.x):prose};
      }
    }
    const provider=new Narrator(),spy=vi.spyOn(provider,'generateText');
    const engine=new TurnEngine(env.repo,{provider:()=>provider,secret:()=>'',profiles:()=>({narrator:DEFAULT_PROFILES[0],extractor:DEFAULT_PROFILES[0]})});
    const started=engine.start(inputFor(env.repo,env.save.id,player)),d=await engine.wait(started.id);
    expect(d.status).toBe('committed');expect(d.body).toBe(prose);expect(d.requestCount).toBe(2);expect(spy).toHaveBeenCalledTimes(2);
    expect(env.repo.view(env.save.id).turns.at(-1)!.state.weather).toBe(env.root.state.weather);
  });
  it('locally saves a legacy weather failure unchanged, preserves facts, and is idempotent without network costs',async()=>{
    const e=setup(),publicBefore=publicDraft(e.draft),revision=publicBefore.localSaveRevision!;
    expect(publicBefore.extraction).toBeNull();expect(revision).toHaveLength(64);
    const d=await e.engine.commitExtracted(e.draft.id,revision),again=await e.engine.commitExtracted(d.id,revision);
    expect(d.status).toBe('committed');expect(d.requestCount).toBe(11);expect(d.body).toBe(prose);expect(again.turnId).toBe(d.turnId);expect(e.provider).not.toHaveBeenCalled();
    const view=e.repo.view(e.save.id),turn=view.turns.at(-1)!;
    expect(view.turns).toHaveLength(2);expect(turn.state.weather).toBe(e.root.state.weather);expect(turn.state.present).toEqual(['shen_che']);
    expect(turn.state.relationships).toEqual(e.root.state.relationships);expect(turn.effects.memories).toHaveLength(1);expect(turn.state.events.some(t=>t.key==='北边出事')).toBe(false);
    expect(turn.effects.diagnostics).toContain(MEMORY_NOTICES.weather);expect(turn.effects.diagnostics).toContain(MEMORY_NOTICES.events);expect(turn.effects.diagnostics).toContain(MEMORY_NOTICES.threads);
    expect(JSON.stringify(publicView(view))).not.toContain('私密哨兵');expect(publicView(view).turns.at(-1)!.effects.diagnostics).toEqual(turn.effects.diagnostics);
    const branch=e.repo.fork(e.save.id,view.branch.id,e.root.id,'修订前');expect(e.repo.view(e.save.id,branch.id).turns).toHaveLength(1);
    const restored=importSave(e.repo,JSON.stringify(exportSave(e.repo,e.save.id)));expect(restored.id).not.toBe(e.save.id);
  });
  it('preserves genuinely quoted weather changes and sourced unresolved threads; leaves the raw extraction untouched',()=>{
    const e=setup(),x=structuredClone(e.x);x.sceneProposal!.weather='下起小雨';x.pendingThreads=[x.facts[0].content];
    const copy=structuredClone(x),result=normalizeExtraction(e.root.state,player,prose+'\n\n窗外下起小雨。',x);
    expect(result.extraction.sceneProposal!.weather).toBe('下起小雨');expect(result.extraction.pendingThreads).toEqual(x.pendingThreads);expect(x).toEqual(copy);
    x.sceneProposal!.weather='大雪';expect(normalizeExtraction(e.root.state,player,prose,x).extraction.sceneProposal!.weather).toBe(e.root.state.weather);
  });
  it('local save still rejects fabricated evidence, unauthorized knowledge, and invented player decisions',async()=>{
    const e=setup(),before=exportSave(e.repo,e.save.id);
    for(const change of ['evidence','knowledge','decision']){
      const d=structuredClone(e.draft),fact=d.extraction!.facts[0];
      if(change==='evidence')fact.evidence.quote='根本没有说过';
      if(change==='knowledge')fact.knownBy=['gu_qingya'];
      if(change==='decision'){fact.subject='玄天华';fact.kind='confirmed_event';}
      e.repo.putDraft(d);await expect(e.engine.commitExtracted(d.id,draftRevision(d))).rejects.toThrow();
      expect(e.repo.draft(d.id)).toEqual(d);expect(exportSave(e.repo,e.save.id)).toEqual(before);
    }
    expect(e.provider).not.toHaveBeenCalled();
  });
  it('known but unavailable scheduled events cannot be introduced via advisory normalization',async()=>{
    const e=setup();e.root.state.events=[{key:'queued-event',type:'boundary',npcIds:['tuoba_ye'],status:'queued',reason:'fixture',triggerTurnId:e.root.id,priority:1}];
    e.repo.db.prepare('UPDATE turns SET payload=? WHERE id=?').run(JSON.stringify(e.root),e.root.id);
    e.draft.extraction!.eventProposals[0].key='queued-event';e.repo.putDraft(e.draft);
    await expect(e.engine.commitExtracted(e.draft.id,draftRevision(e.draft))).rejects.toThrow(/场景不允许/);
    expect(e.repo.view(e.save.id).turns).toHaveLength(1);
  });
  it('rejects stale versions, moved heads, active work and incomplete drafts',async()=>{
    const e=setup();await expect(e.engine.commitExtracted(e.draft.id,'0'.repeat(64))).rejects.toThrow(/草稿已更新/);
    e.engine.active.set(e.draft.branchId,{id:e.draft.id,controller:new AbortController(),promise:Promise.resolve()});
    await expect(e.engine.commitExtracted(e.draft.id,draftRevision(e.draft))).rejects.toThrow(/请求结束/);e.engine.active.clear();
    const incomplete={...e.draft,bodyComplete:false};e.repo.putDraft(incomplete);expect(publicDraft(incomplete).localSaveRevision).toBeUndefined();
    await expect(e.engine.commitExtracted(e.draft.id,draftRevision(incomplete))).rejects.toThrow(/完整/);
    e.repo.putDraft(e.draft);e.repo.putBranch({...e.repo.branch(e.draft.branchId),headTurnId:crypto.randomUUID()});
    await expect(e.engine.commitExtracted(e.draft.id,draftRevision(e.draft))).rejects.toThrow(/原进度/);
  });
  it('rolls back the entire local save if persistence fails, retaining the draft and all prior data',async()=>{
    const e=setup(),before=exportSave(e.repo,e.save.id),insert=e.repo.insertTurn.bind(e.repo);
    vi.spyOn(e.repo,'insertTurn').mockImplementation(t=>{insert(t);throw Error('disk fixture');});
    await expect(e.engine.commitExtracted(e.draft.id,draftRevision(e.draft))).rejects.toThrow('disk fixture');
    expect(exportSave(e.repo,e.save.id)).toEqual(before);expect(e.repo.draft(e.draft.id)).toEqual(e.draft);
  });
});
