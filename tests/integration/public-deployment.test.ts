import {afterEach,describe,it,expect} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {PublicControl} from '../../src/server/public-control';
import {publicConfig} from '../../src/server/public-config';
import {LocalSecurity,hashPassword} from '../../src/security/local';
import {guardedProvider} from '../../src/server/guarded-provider';
import {makeService} from '../../src/server/service';
import {BaseProvider,type TextRequest,type TextResult} from '../../src/llm/types';
import {capabilities} from '../../src/llm/config';
import {exportSave} from '../../src/storage/transfer';
import {spawnSync} from 'node:child_process';
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const f of cleanups.splice(0).reverse())f();});
function setup(extra:Record<string,string>={}){
  const dir=mkdtempSync(path.resolve('.test-data','public-unit-'));
  const config=publicConfig({APP_PLAYER_MODE:'isolated',APP_ACCESS_MODE:'lan',APP_SHARED_PROVIDER:'mock',APP_DATA_DIR:dir,...extra})!;
  const control=new PublicControl(config);cleanups.push(()=>control.close());
  const security=new LocalSecurity({mode:'lan',origins:['http://localhost:4000'],passwordHash:'',isolated:true},()=>Date.now(),
    {sessions:control,principal:()=>control.createPlayer(),limit:(k,n,ms)=>control.limit(k,n,ms)});
  return {config,control,security,dir};
}
function req(token:string,csrf?:string){return new Request('http://localhost:4000/api/bootstrap',{method:csrf?'POST':'GET',
  headers:{host:'localhost:4000',cookie:'dayao_session='+token,...(csrf?{'x-dayao-csrf':csrf,origin:'http://localhost:4000'}:{})}});}
class CountedProvider extends BaseProvider{
  id='deepseek' as const;attempts=0;received:TextRequest|null=null;
  async generateText(r:TextRequest):Promise<TextResult>{this.received=r;await r.onAttempt?.();this.attempts++;return {text:'完成',finishReason:'stop',usage:{input:1,output:1},requestId:null,requestCount:1};}
  async listModels(){return {status:'unsupported' as const,models:[]};}
}
describe('public deployment isolation and spending controls',()=>{
  it('public startup refuses missing site model/key; Gemma retains exact native model',()=>{
    expect(()=>publicConfig({APP_PLAYER_MODE:'isolated',APP_ACCESS_MODE:'public',APP_DATA_DIR:'test'})).toThrow('真实');
    expect(()=>publicConfig({APP_PLAYER_MODE:'isolated',APP_ACCESS_MODE:'public',APP_DATA_DIR:'test',APP_SHARED_PROVIDER:'deepseek',APP_SHARED_MODEL:'deepseek-flash'})).toThrow('密钥');
    const c=publicConfig({APP_PLAYER_MODE:'isolated',APP_DATA_DIR:'test',APP_SHARED_PROVIDER:'google-gemma'})!;
    expect(c.profile.model).toBe('gemma-4-26b-a4b-it');
  });
  it('opaque identities survive process restart without storing raw cookies',()=>{
    const s=setup(),session=s.security.create();
    expect(session.authenticated).toBe(true);expect(s.security.loginRequired).toBe(false);
    expect(readFileSync(path.join(s.dir,'access.sqlite'))).not.toContain(Buffer.from(session.token));
    s.control.db.pragma('wal_checkpoint(TRUNCATE)');
    expect(readFileSync(path.join(s.dir,'access.sqlite')).includes(Buffer.from(session.token))).toBe(false);
    const reopened=new PublicControl(s.config);cleanups.push(()=>reopened.close());
    const security=new LocalSecurity(s.security.config,()=>Date.now(),{sessions:reopened});
    expect(security.check(req(session.token)).principalId).toBe(session.principalId);
    expect(()=>security.check(req(session.token+'0'))).toThrow();
    expect(()=>security.check(req(session.token,'wrong'))).toThrow('CSRF');
  });
  it('separate players cannot read, change, export or see one another’s jobs',async()=>{
    const s=setup(),a=s.security.create(),b=s.security.create();
    const one=makeService({dir:s.control.playerDir(a.principalId),control:s.control,playerId:a.principalId,security:s.security});
    const two=makeService({dir:s.control.playerDir(b.principalId),control:s.control,playerId:b.principalId,security:s.security});
    cleanups.push(()=>one.repo.close(),()=>two.repo.close());
    const save=one.repo.createSave({title:'玩家一的故事'}),view=one.repo.view(save.id),head=view.branch.headTurnId;
    const d=one.engine.start({clientRequestId:crypto.randomUUID(),saveId:save.id,branchId:view.branch.id,expectedHeadTurnId:head,playerText:'让门外来人进来',target:null,mode:'story'});
    await one.engine.wait(d.id);
    expect(one.repo.draft(d.id).status).toBe('committed');
    expect(two.repo.listSaves()).toEqual([]);expect(()=>two.repo.view(save.id)).toThrow();
    expect(()=>exportSave(two.repo,save.id)).toThrow();expect(two.repo.maybeDraft(d.id)).toBeUndefined();
    expect(()=>two.repo.switchBranch(save.id,view.branch.id)).toThrow();
    expect(one.engine.start({clientRequestId:d.id,saveId:save.id,branchId:view.branch.id,expectedHeadTurnId:head,playerText:d.playerText,target:null,mode:'story'}).turnId).toBe(one.repo.draft(d.id).turnId);
    const dir=one.repo.dir;one.repo.close();
    const reopened=makeService({dir,control:s.control,playerId:a.principalId,security:s.security});cleanups.push(()=>reopened.repo.close());
    expect(reopened.repo.view(save.id).turns).toHaveLength(2);
    expect(reopened.repo.draft(d.id).status).toBe('committed');
  });
  it('optional access password rotates session while retaining each player’s separate identity',()=>{
    const s=setup(),security=new LocalSecurity({...s.security.config,passwordHash:hashPassword('fixture-site-password')},()=>Date.now(),
      {sessions:s.control,principal:()=>s.control.createPlayer()}),a=security.create();
    expect(a.authenticated).toBe(false);
    const r=new Request('http://localhost:4000/api/login',{method:'POST',headers:{host:'localhost:4000',cookie:'dayao_session='+a.token,'x-dayao-csrf':a.csrf}});
    const signed=security.login(r,'fixture-site-password');
    expect(signed.principalId).toBe(a.principalId);expect(signed.token).not.toBe(a.token);
    expect(()=>security.check(req(a.token))).toThrow();expect(security.check(req(signed.token)).authenticated).toBe(true);
    security.logout(req(signed.token));expect(()=>security.check(req(signed.token))).toThrow();
  });
  it('personal/global/output budgets and rate limits remain enforced across restart',()=>{
    const s=setup({APP_LLM_DAILY_REQUESTS:'3',APP_PLAYER_DAILY_REQUESTS:'2',APP_LLM_DAILY_OUTPUT_TOKENS:'768'}),a=s.control.createPlayer(),b=s.control.createPlayer();
    s.control.reserveAttempt(a,50,256);s.control.reserveAttempt(a,50,256);
    expect(()=>s.control.reserveAttempt(a,50,256)).toThrow('额度');
    s.control.limit('persisted-test',1,60000);
    const reopened=new PublicControl(s.config);cleanups.push(()=>reopened.close());
    expect(()=>reopened.reserveAttempt(a,50,256)).toThrow('额度');
    expect(()=>reopened.limit('persisted-test',1,60000)).toThrow('频繁');
    reopened.reserveAttempt(b,50,256);
    expect(()=>s.control.reserveAttempt(b,50,256)).toThrow('额度');
    expect(s.control.usage('*')).toEqual({requests:3,output:768,input:150});
  });
  it('oversized input and forged player ID consume no model budget',()=>{
    const s=setup({APP_MAX_INPUT_BYTES:'4096'}),a=s.control.createPlayer();
    expect(()=>s.control.reserveAttempt(a,4097,256)).toThrow('输入上限');
    expect(()=>s.control.playerDir('../another-player')).toThrow();
    expect(()=>s.control.playerDir(crypto.randomUUID())).toThrow();
    expect(s.control.usage('*').requests).toBe(0);
  });
  it('real provider wrapper clamps output and charges each actual retry, never exposing the key',async()=>{
    const s=setup({APP_SHARED_PROVIDER:'deepseek',APP_SHARED_MODEL:'deepseek-flash',APP_MAX_OUTPUT_TOKENS:'512',APP_PLAYER_DAILY_REQUESTS:'2'}),id=s.control.createPlayer(),inner=new CountedProvider();
    const provider=guardedProvider(inner,s.control,id),profile={...s.config.profile,maxOutputTokens:16000};
    const request:TextRequest={profile,key:'fixture-secret',system:'叙事',messages:[{role:'user',content:'你好'}],signal:new AbortController().signal,capabilities:capabilities(profile)};
    await provider.generateText(request);await provider.generateText(request);
    await expect(provider.generateText(request)).rejects.toThrow('额度');
    expect(inner.attempts).toBe(2);expect(inner.received!.profile.maxOutputTokens).toBe(512);
    expect(s.control.usage(id).requests).toBe(2);
    expect(JSON.stringify(s.control.status(id))).not.toContain('fixture-secret');
    await expect(provider.generateText({...request,profile:{...profile,model:'more-expensive'}})).rejects.toThrow('配置');
  });
  it('concurrent attempts respect the persistent global quota transaction',()=>{
    const s=setup({APP_LLM_DAILY_REQUESTS:'1'}),a=s.control.createPlayer(),b=s.control.createPlayer(),other=new PublicControl(s.config);cleanups.push(()=>other.close());
    s.control.reserveAttempt(a,100,256);expect(()=>other.reserveAttempt(b,100,256)).toThrow('额度');
  });
  it('whole-site online backup restores identities and separate saves without overwriting source',()=>{
    const s=setup(),session=s.security.create(),one=makeService({dir:s.control.playerDir(session.principalId),control:s.control,playerId:session.principalId,security:s.security});
    cleanups.push(()=>one.repo.close());const save=one.repo.createSave({title:'恢复验收'});
    s.security.authorize(req(session.token),'bootstrap');
    s.control.db.pragma('wal_checkpoint(TRUNCATE)');
    expect(readFileSync(path.join(s.dir,'access.sqlite')).includes(Buffer.from(session.token))).toBe(false);
    const backup=spawnSync(process.execPath,['scripts/site-backup.mjs'],{encoding:'utf8',env:{...process.env,APP_PLAYER_MODE:'isolated',APP_DATA_DIR:s.dir}});
    expect(backup.status,backup.stderr).toBe(0);const info=JSON.parse(backup.stdout);
    expect(info.databases).toBe(2);
    const destination=path.join(s.dir,'restored'),restore=spawnSync(process.execPath,['scripts/site-restore.mjs',info.backup,destination],{encoding:'utf8'});
    expect(restore.status,restore.stderr).toBe(0);
    const restored=new PublicControl({...s.config,dir:destination});cleanups.push(()=>restored.close());
    expect(restored.get(session.token)?.principalId).toBe(session.principalId);
    const r=makeService({dir:restored.playerDir(session.principalId),control:restored,playerId:session.principalId});cleanups.push(()=>r.repo.close());
    expect(r.repo.view(save.id).save.title).toBe('恢复验收');
    const refused=spawnSync(process.execPath,['scripts/site-restore.mjs',info.backup,s.dir],{encoding:'utf8'});
    expect(refused.status).not.toBe(0);expect(one.repo.view(save.id).save.title).toBe('恢复验收');
  });
});
