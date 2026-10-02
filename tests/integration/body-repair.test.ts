import { afterEach,describe,expect,it } from 'vitest';
import { MockProvider } from '../../src/llm/mock';
import { ProviderError } from '../../src/llm/types';
import type { TextRequest,TextResult } from '../../src/llm/types';
import { TurnEngine } from '../../src/engine/engine';
import { DEFAULT_PROFILES } from '../../src/llm/config';
import type { Repository } from '../../src/storage/repository';
import { temporaryRepo,putLegacyDraft } from '../helpers';

const good='殿门推开。沈彻走进御书房，在案前三步处站定。\n\n沈彻抱拳道：“北边出了事，细情尚待查证。”';
const original='她脑子里先跳出来的是那个数字——17%。\n\n'+good;
const open:Repository[]=[];
afterEach(()=>{for(const repo of open.splice(0))repo.close();});
async function setup(provider=new MockProvider()){
  const repo=temporaryRepo();open.push(repo);const save=repo.createSave();
  let chosen={...DEFAULT_PROFILES[0]};
  const engine=new TurnEngine(repo,{provider:()=>provider,secret:()=>'',profiles:()=>({narrator:chosen,extractor:chosen})});
  const draft=putLegacyDraft(repo,save.id,'让沈彻进来',original);
  return {repo,save,engine,draft,choose:(model:string)=>{chosen={...chosen,model};}};
}
describe('一次正文修正与自动保存',()=>{
  it('uses the current model, retains the original and atomically saves; duplicate calls are idempotent',async()=>{
    class Recording extends MockProvider{requests:TextRequest[]=[];override generateText(r:TextRequest){this.requests.push(r);return super.generateText(r);}}
    const provider=new Recording(),env=await setup(provider),root=env.repo.view(env.save.id).turns[0];
    expect(env.draft.requestCount).toBe(0);env.choose('current-model');
    env.engine.repair(env.draft.id);const d=await env.engine.wait(env.draft.id);
    expect(d).toMatchObject({status:'committed',body:good,playerText:'让沈彻进来',requestCount:2,bodyRepair:{originalBody:original,phase:'received'}});
    expect(provider.requests.map(r=>r.profile.model)).toEqual(['current-model','current-model']);
    expect(provider.requests[0].system).toContain('不增加新人物');
    const view=env.repo.view(env.save.id);expect(view.turns).toHaveLength(2);expect(view.turns[0]).toEqual(root);
    expect(view.turns[1].state.present).toEqual(['shen_che']);expect(view.turns[1].effects.memories).toHaveLength(1);
    expect(env.engine.repair(d.id).turnId).toBe(d.turnId);expect(provider.requests).toHaveLength(2);
  });
  it('does not loop when optional repair leaves a wording hint; full memory validation still runs',async()=>{
    class StillInvalid extends MockProvider{
      calls=0;override async generateText(r:TextRequest):Promise<TextResult>{if(!r.system.startsWith('BODY_REPAIR'))return super.generateText(r);this.calls++;r.onAttempt?.();return {text:'她心想先听听。\n\n'+good,finishReason:'stop',usage:{input:1,output:1},requestCount:1,requestId:null};}
    }
    const provider=new StillInvalid(),env=await setup(provider);
    env.engine.repair(env.draft.id);const d=await env.engine.wait(env.draft.id);
    expect(provider.calls).toBe(1);expect(d.status).toBe('committed');expect(d.body).toBe('她心想先听听。\n\n'+good);
    expect(d.bodyRepair).toMatchObject({originalBody:original,phase:'received'});expect(env.repo.view(env.save.id).turns).toHaveLength(2);
  });
  it('retains the original and any received partial repair on timeout, without advancing history',async()=>{
    class Timeout extends MockProvider{override async generateText(r:TextRequest):Promise<never>{r.onAttempt?.();throw new ProviderError('TIMEOUT','修正等待超时',undefined,'殿门推开，沈彻');}}
    const env=await setup(new Timeout());env.engine.repair(env.draft.id);const d=await env.engine.wait(env.draft.id);
    expect(d).toMatchObject({status:'failed',body:original,bodyComplete:true,bodyRepair:{originalBody:original,candidateBody:'殿门推开，沈彻',phase:'failed'}});
    expect(env.repo.view(env.save.id).turns).toHaveLength(1);
  });
  it('can retry only memory extraction after a successful repair without another repair request',async()=>{
    class MemoryFailure extends MockProvider{
      fail=true;repairs=0;
      override generateText(r:TextRequest){if(r.system.startsWith('BODY_REPAIR'))this.repairs++;return super.generateText(r);}
      override extractJson(r:TextRequest){if(this.fail){r.onAttempt?.();return Promise.reject(new ProviderError('TIMEOUT','整理超时'));}return super.extractJson(r);}
    }
    const provider=new MemoryFailure(),env=await setup(provider);env.engine.repair(env.draft.id);
    const failed=await env.engine.wait(env.draft.id);expect(failed).toMatchObject({body:good,status:'failed',failureStage:'extraction',bodyRepair:{originalBody:original}});
    expect(env.repo.view(env.save.id).turns).toHaveLength(1);
    provider.fail=false;env.engine.retry(failed.id,true);expect((await env.engine.wait(failed.id)).status).toBe('committed');
    expect(provider.repairs).toBe(1);expect(env.repo.view(env.save.id).turns).toHaveLength(2);
  });
  it('rejects overlapping repair requests and cancels without replacing the original or committing',async()=>{
    let release:()=>void=()=>{};
    class Slow extends MockProvider{override async generateText(r:TextRequest){await new Promise<void>(resolve=>{release=resolve;});return super.generateText(r);}}
    const env=await setup(new Slow());env.engine.repair(env.draft.id);
    await Promise.resolve();expect(()=>env.engine.repair(env.draft.id)).toThrow(/仍在运行/);
    env.engine.cancel(env.draft.id);release();const d=await env.engine.wait(env.draft.id);
    expect(d.status).toBe('cancelled');expect(d.body).toBe(original);expect(d.bodyRepair?.originalBody).toBe(original);
    expect(env.repo.view(env.save.id).turns).toHaveLength(1);
  });
  it('rejects incomplete prose and moved heads before starting a model request',async()=>{
    const env=await setup();env.repo.putDraft({...env.draft,bodyComplete:false});
    expect(()=>env.engine.repair(env.draft.id)).toThrow(/完整/);
    env.repo.putDraft(env.draft);env.repo.putBranch({...env.repo.branch(env.draft.branchId),headTurnId:crypto.randomUUID()});
    expect(()=>env.engine.repair(env.draft.id)).toThrow(/原进度/);expect(env.repo.draft(env.draft.id).requestCount).toBe(0);
  });
});
