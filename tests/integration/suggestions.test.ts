import { afterEach, describe, expect, it } from 'vitest';
import { SuggestionService } from '../../src/engine/suggestions';
import { MockProvider } from '../../src/llm/mock';
import { DEFAULT_PROFILES } from '../../src/llm/config';
import type { TextRequest } from '../../src/llm/types';
import type { Repository } from '../../src/storage/repository';
import { temporaryRepo, testEngine, inputFor } from '../helpers';

const repositories:Repository[]=[];
afterEach(()=>{for(const repo of repositories.splice(0))repo.close();});
class Capturing extends MockProvider{
  requests:TextRequest[]=[];
  override async generateText(r:TextRequest){if(r.system.startsWith('SUGGESTIONS'))this.requests.push(r);return super.generateText(r);}
}
function setup(provider=new Capturing(),profile=DEFAULT_PROFILES[0]){
  const repo=temporaryRepo();repositories.push(repo);const save=repo.createSave();
  const engine=testEngine(repo,provider);
  const service=new SuggestionService(repo,{provider:()=>provider,secret:()=>'',profiles:()=>({narrator:profile,extractor:DEFAULT_PROFILES[0]})});
  const request=()=>{const view=repo.view(save.id);return {saveId:save.id,branchId:view.branch.id,expectedHeadTurnId:view.branch.headTurnId,authorizeNetwork:true};};
  const turn=async(text:string)=>{const d=engine.start(inputFor(repo,save.id,text));return engine.wait(d.id);};
  return {repo,save,engine,service,provider,request,turn};
}
const signal=()=>new AbortController().signal;

describe('由当前可见原文生成行动建议',()=>{
  it('uses current prose without advancing history, memory, time or branch',async()=>{
    const env=setup();await env.turn('让沈彻进来');await env.turn('请解释账目差额。');
    const before=env.repo.view(env.save.id),result=await env.service.generate(env.request(),signal());
    expect(result.actions).toHaveLength(3);expect(result.actions.join('')).toContain('沈彻');expect(result.actions.join('')).toContain('账目');
    expect(env.provider.requests[0].messages[0].content).toContain('请解释账目差额');
    expect(env.repo.view(env.save.id)).toEqual(before);
  });
  it('excludes other saves, old future, OOC and private fact content',async()=>{
    const env=setup();await env.turn('OOC：只有出戏知道的哨兵');await env.turn('旧未来哨兵青铜鹤');
    const original=env.repo.view(env.save.id);env.repo.fork(env.save.id,original.branch.id,original.turns[0].id,'新分支');
    const other=env.repo.createSave();const otherDraft=env.engine.start(inputFor(env.repo,other.id,'另一卷册秘密哨兵'));await env.engine.wait(otherDraft.id);
    const prologue=env.repo.turn(original.turns[0].id);
    prologue.effects.facts.push({...prologue.effects.facts[0],id:crypto.randomUUID(),content:'不可见的事实哨兵',revealed:false});
    env.repo.db.prepare('UPDATE turns SET payload=? WHERE id=?').run(JSON.stringify(prologue),prologue.id);
    await env.service.generate(env.request(),signal());
    const payload=JSON.stringify(env.provider.requests[0]);
    expect(payload).not.toMatch(/旧未来哨兵|另一卷册秘密哨兵|出戏知道的哨兵|不可见的事实哨兵|privateNpcs/);
  });
  it('uses the displayed failed draft as uncommitted context, instead of stale prologue choices',async()=>{
    const env=setup(),committed=await env.turn('让沈彻进来');
    const draft={...committed,id:crypto.randomUUID(),status:'failed' as const,turnId:null,expectedHeadTurnId:env.repo.view(env.save.id).branch.headTurnId,body:'沈彻放下一封来自边关的信，等候询问。'};
    env.repo.putDraft(draft);
    const result=await env.service.generate({...env.request(),draftId:draft.id},signal());
    expect(result.actions.join('')).toContain('来信');expect(result.draftId).toBe(draft.id);
    const packet=JSON.parse(env.provider.requests[0].messages[0].content);expect(packet.draft).toMatchObject({body:draft.body,uncommitted:true});
    expect(env.repo.draft(draft.id)).toEqual(draft);expect(env.repo.view(env.save.id).turns).toHaveLength(2);
  });
  it.each(DEFAULT_PROFILES.slice(1))('uses the selected narrator provider $provider without silently switching to Mock',async profile=>{
    const env=setup(new Capturing(),{...profile,model:profile.model||'vendor/user-selected'});
    const result=await env.service.generate(env.request(),signal());
    expect(result.provider).toBe(profile.provider);expect(env.provider.requests[0].profile.id).toBe(profile.id);
    expect(result.model).toBe(profile.model||'vendor/user-selected');
  });
  it('a cloud request requires explicit action authorization',async()=>{
    const env=setup(new Capturing(),DEFAULT_PROFILES[2]);
    await expect(env.service.generate({...env.request(),authorizeNetwork:false},signal())).rejects.toMatchObject({code:'AUTHORIZATION_REQUIRED'});
    expect(env.provider.requests).toHaveLength(0);
  });
  it('repairs bad JSON at most once',async()=>{
    class Broken extends Capturing{override async generateText(r:TextRequest){const result=await super.generateText(r);return {...result,text:'broken JSON'};}}
    const env=setup(new Broken());await expect(env.service.generate(env.request(),signal())).rejects.toMatchObject({code:'SUGGESTION_FORMAT'});
    expect(env.provider.requests).toHaveLength(2);expect(env.repo.view(env.save.id).turns).toHaveLength(1);
  });
  it('rejects stale heads and drafts belonging to another save before calling a provider',async()=>{
    const env=setup(),stale=env.request();await env.turn('稍等。');
    await expect(env.service.generate(stale,signal())).rejects.toThrow(/进度/);
    const other=env.repo.createSave(),d=env.engine.start(inputFor(env.repo,other.id,'稍等。'));await env.engine.wait(d.id);
    await expect(env.service.generate({...env.request(),draftId:d.id},signal())).rejects.toThrow(/不属于/);
    expect(env.provider.requests).toHaveLength(0);
  });
  it('blocks duplicate requests and discards a response when history advances during generation',async()=>{
    let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
    class Slow extends Capturing{override async generateText(r:TextRequest){if(r.system.startsWith('SUGGESTIONS'))await barrier;return super.generateText(r);}}
    const env=setup(new Slow()),pending=env.service.generate(env.request(),signal());
    await expect(env.service.generate(env.request(),signal())).rejects.toThrow(/正在生成/);
    await env.turn('稍等。');release();await expect(pending).rejects.toThrow(/已丢弃/);
    expect(env.provider.requests).toHaveLength(1);
  });
  it('does not accept a draft changed during suggestion generation',async()=>{
    let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
    class Slow extends Capturing{override async generateText(r:TextRequest){if(r.system.startsWith('SUGGESTIONS'))await barrier;return super.generateText(r);}}
    const env=setup(new Slow()),d=await env.turn('稍等。');
    const draft={...d,id:crypto.randomUUID(),status:'failed' as const,turnId:null,expectedHeadTurnId:env.repo.view(env.save.id).branch.headTurnId};env.repo.putDraft(draft);
    const pending=env.service.generate({...env.request(),draftId:draft.id},signal());
    env.repo.putDraft({...draft,body:'另一份待核对的正文'});release();await expect(pending).rejects.toThrow(/草稿已变化/);
  });
});
