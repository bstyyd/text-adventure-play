import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnEngine } from '../../src/engine/engine';
import { MockProvider } from '../../src/llm/mock';
import { ProviderError } from '../../src/llm/types';
import type { TextRequest } from '../../src/llm/types';
import type { Draft, Profile } from '../../src/domain/types';
import type { DraftReview } from '../../src/domain/draft-review';
import { DEFAULT_PROFILES } from '../../src/llm/config';
import { temporaryRepo, inputFor } from '../helpers';
import type { Repository } from '../../src/storage/repository';
import { exportSave, importSave } from '../../src/storage/transfer';
import { characterWorld } from '../../src/characters/world';
import { filterHistory, contextFor } from '../../src/memory/context';
const open:Repository[]=[];
afterEach(()=>{for(const r of open.splice(0))r.close();});
const body='殿门推开。沈彻走进御书房，在案前三步处站定。\n\n沈彻抱拳道：“北边出了事，细情尚待查证。”';
class TimeoutExtractor extends MockProvider{
  requests:Profile[]=[];
  override async extractJson(r:TextRequest):Promise<never>{this.requests.push(r.profile);r.onAttempt?.();throw new ProviderError('TIMEOUT','请求等待超时。');}
}
async function setup(playerText='看看来的人是谁，让对方进来',prose=body){
  const repo=temporaryRepo();open.push(repo);const save=repo.createSave();
  const extractor={...DEFAULT_PROFILES[1],model:'fixture/pro'},narrator=DEFAULT_PROFILES[0];
  repo.putProfile(extractor);repo.putProfile(narrator);
  const provider=new TimeoutExtractor(),engine=new TurnEngine(repo,{provider:()=>provider,secret:()=>'',profiles:()=>({narrator,extractor})});
  const started=engine.start(inputFor(repo,save.id,playerText),prose),draft=await engine.wait(started.id);
  return {repo,save,engine,provider,draft};
}
function reviewFor(engine:TurnEngine,draft:Draft):DraftReview{return {
  revision:engine.reviewContext(draft.id).revision,body:draft.body,confirmed:true,present:['shen_che'],characters:[],
  sceneEvidence:{blockId:'b0',quote:body.split('\n\n')[0]},
  facts:[{kind:'claim',content:'沈彻报告北边出了事，细情尚待查证。',subject:'shen_che',knownBy:['shen_che'],revealed:true,importance:3,evidence:{blockId:'b1',quote:'北边出了事，细情尚待查证。'}}],
};}
describe('草稿恢复与本地审阅',()=>{
  it('explicit retry can select the edited model without regenerating prose or changing global configuration',async()=>{
    const env=await setup('让沈彻进来');const selected={...env.draft.extractProfile,model:'fixture/flash',timeoutMs:180000};env.repo.putProfile(selected);
    env.engine.retry(env.draft.id,true);await env.engine.wait(env.draft.id);
    expect(env.provider.requests.at(-1)?.model).toBe('fixture/pro');
    env.engine.retry(env.draft.id,true,undefined,{extractProfileId:selected.id,timeoutMs:240000});
    const d=await env.engine.wait(env.draft.id);
    expect(env.provider.requests.at(-1)).toMatchObject({model:'fixture/flash',timeoutMs:240000});
    expect(d.body).toBe(env.draft.body);expect(d.profile).toEqual(env.draft.profile);expect(env.repo.profiles().find(p=>p.id===selected.id)?.timeoutMs).toBe(180000);
  });
  it('a selected replacement extractor can recover and commit the complete prose',async()=>{
    const env=await setup('让沈彻进来');const requestCount=env.draft.requestCount;
    const engine=new TurnEngine(env.repo,{provider:p=>p.provider==='mock'?new MockProvider():env.provider,secret:()=>'',profiles:()=>({narrator:DEFAULT_PROFILES[0],extractor:DEFAULT_PROFILES[0]})});
    engine.retry(env.draft.id,true,undefined,{extractProfileId:'mock'});const d=await engine.wait(env.draft.id);
    expect(d.status).toBe('committed');expect(d.body).toBe(body);expect(d.requestCount).toBe(requestCount+1);expect(env.provider.requests).toHaveLength(1);
  });
  it('invalid retry settings leave the failed draft untouched',async()=>{
    const env=await setup();expect(()=>env.engine.retry(env.draft.id,true,undefined,{extractProfileId:'missing'})).toThrow(/不存在/);
    expect(()=>env.engine.retry(env.draft.id,true,undefined,{timeoutMs:1})).toThrow();expect(env.repo.draft(env.draft.id)).toEqual(env.draft);
  });
  it('offline review atomically commits prose, presence and memory with no provider call; duplicate submission is idempotent',async()=>{
    const env=await setup(),review=reviewFor(env.engine,env.draft),count=env.draft.requestCount,root=env.repo.view(env.save.id).turns[0];
    const spy=vi.spyOn(env.provider,'extractJson');const results=await Promise.all([env.engine.commitReviewed(env.draft.id,review),env.engine.commitReviewed(env.draft.id,review)]);
    expect(results[0].turnId).toBe(results[1].turnId);expect(spy).not.toHaveBeenCalled();
    const v=env.repo.view(env.save.id),last=v.turns.at(-1)!;
    expect(v.turns).toHaveLength(2);expect(last).toMatchObject({body,playerText:env.draft.playerText,memorySource:'local-review',requestCount:count});
    expect(last.state.present).toEqual(['shen_che']);expect(last.state.date).toEqual(root.state.date);expect(last.state.relationships).toEqual(root.state.relationships);
    expect(last.effects.memories).toHaveLength(1);expect(last.effects.knowledge.map(k=>k.npcId)).toEqual(['shen_che']);
    expect(last.effects.suggestedActions).toEqual([]);
    expect(filterHistory(v.turns,{keyword:'细情尚待查证'}).map(t=>t.id)).toEqual([last.id]);
    expect(JSON.stringify(contextFor(v.turns,'北边发生何事','shen_che'))).toContain('细情尚待查证');
    const branch=env.repo.fork(env.save.id,v.branch.id,root.id,'事发前');expect(env.repo.view(env.save.id,branch.id).turns).toEqual([root]);
    const imported=importSave(env.repo,JSON.stringify(exportSave(env.repo,env.save.id)));
    expect(env.repo.all<{memorySource?:string}>('turns').filter(t=>t.memorySource==='local-review')).toHaveLength(2);expect(imported.id).not.toBe(env.save.id);
  });
  it('invalid evidence and unauthorized knowledge keep the entire original draft and branch unchanged',async()=>{
    const env=await setup(),review=reviewFor(env.engine,env.draft),before=exportSave(env.repo,env.save.id);
    review.facts[0].evidence.quote='不存在的引文';await expect(env.engine.commitReviewed(env.draft.id,review)).rejects.toThrow(/证据/);
    review.facts[0].evidence.quote='北边出了事，细情尚待查证。';review.facts[0].knownBy=['gu_qingya'];
    await expect(env.engine.commitReviewed(env.draft.id,review)).rejects.toThrow(/知情|认知/);
    expect(exportSave(env.repo,env.save.id)).toEqual(before);expect(env.repo.draft(env.draft.id)).toEqual(env.draft);
  });
  it('the player may keep prose with wording hints while factual sources are still checked',async()=>{
    const env=await setup(undefined,'她脑子里先跳出来一个数字。\n\n'+body),review=reviewFor(env.engine,env.draft);
    review.sceneEvidence={blockId:'b1',quote:body.split('\n\n')[0]};review.facts[0].evidence.blockId='b2';
    expect(env.provider.requests).toHaveLength(1);expect(env.draft.failureStage).toBe('extraction');
    const committed=await env.engine.commitReviewed(env.draft.id,review);
    expect(committed.status).toBe('committed');expect(committed.body).toBe(review.body);expect(env.provider.requests).toHaveLength(1);
  });
  it.each(['不要让对方进来','如果是沈彻，让他进来','要不要让门外的人进来？','据说她让沈彻进来'])('does not turn %s into an authorized arrival',async input=>{
    const env=await setup(input);await expect(env.engine.commitReviewed(env.draft.id,reviewFor(env.engine,env.draft))).rejects.toThrow(/授权/);
    expect(env.repo.view(env.save.id).turns).toHaveLength(1);
  });
  it('an unnamed invitation cannot select multiple people or teleport a distant NPC',async()=>{
    const env=await setup(),review=reviewFor(env.engine,env.draft);review.present.push('gu_qingya');
    await expect(env.engine.commitReviewed(env.draft.id,review)).rejects.toThrow(/授权/);
    review.present=['tuoba_ye'];review.body='拓跋野推开门走进御书房。';review.sceneEvidence={blockId:'b0',quote:review.body};review.facts[0]={...review.facts[0],subject:'tuoba_ye',knownBy:[],evidence:review.sceneEvidence};
    await expect(env.engine.commitReviewed(env.draft.id,review)).rejects.toThrow(/瞬移/);
  });
  it('a stale review and a moved head cannot overwrite newer work',async()=>{
    const env=await setup(),review=reviewFor(env.engine,env.draft);env.repo.putDraft({...env.draft,error:'另一窗口更新'});
    await expect(env.engine.commitReviewed(env.draft.id,review)).rejects.toThrow(/草稿已/);
    review.revision=env.engine.reviewContext(env.draft.id).revision;
    env.repo.putBranch({...env.repo.branch(env.draft.branchId),headTurnId:crypto.randomUUID()});
    await expect(env.engine.commitReviewed(env.draft.id,review)).rejects.toThrow(/原进度/);
  });
  it('a storage failure rolls back reopening a cancelled draft, all events, and the head',async()=>{
    const env=await setup();env.engine.cancel(env.draft.id);const before=env.repo.draft(env.draft.id),review=reviewFor(env.engine,before),archive=exportSave(env.repo,env.save.id);
    const insert=env.repo.insertTurn.bind(env.repo);vi.spyOn(env.repo,'insertTurn').mockImplementation(t=>{insert(t);throw new Error('disk failure fixture');});
    await expect(env.engine.commitReviewed(env.draft.id,review)).rejects.toThrow('disk failure fixture');
    expect(exportSave(env.repo,env.save.id)).toEqual(archive);expect(env.repo.draft(env.draft.id)).toEqual(before);
  });
  it('a new supporting person and evidence are committed together and never duplicated',async()=>{
    const prose='军需吏林澄走进御书房。林澄说道：“臣经手过这批粮。”',env=await setup('请军需吏林澄进来',prose);
    const review=reviewFor(env.engine,env.draft),evidence={blockId:'b0',quote:prose};
    review.present=['new:clerk'];review.sceneEvidence=evidence;review.characters=[{draftRef:'new:clerk',name:'林澄',identity:'军需吏',identityStatus:'confirmed',roleInStory:'说明粮务',evidence,knownBy:[]}];
    review.facts=[{kind:'claim',content:'林澄称曾经手这批粮。',subject:'new:clerk',knownBy:['new:clerk'],revealed:true,importance:3,evidence}];
    await env.engine.commitReviewed(env.draft.id,review);await env.engine.commitReviewed(env.draft.id,review);
    const world=characterWorld(env.repo.view(env.save.id).turns),person=world.find(c=>c.name==='林澄')!;
    expect(world).toHaveLength(7);expect(person.romancePolicy).toBe('disabled');expect(person.firstAppearanceTurnId).toBe(env.repo.draft(env.draft.id).turnId);
    expect(importSave(env.repo,JSON.stringify(exportSave(env.repo,env.save.id))).id).not.toBe(env.save.id);
  });
  it('local review cannot silently discard appointment events or save empty memory',async()=>{
    const env=await setup('任命沈彻为大将军'),review=reviewFor(env.engine,env.draft);
    await expect(env.engine.commitReviewed(env.draft.id,review)).rejects.toThrow(/任免/);
    review.facts=[];await expect(env.engine.commitReviewed(env.draft.id,review)).rejects.toThrow();expect(env.repo.view(env.save.id).turns).toHaveLength(1);
  });
});
