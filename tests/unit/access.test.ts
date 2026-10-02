import { describe,it,expect } from 'vitest';
import { LocalSecurity,accessConfig,hashPassword,AccessError } from '../../src/security/local';
const password='fixture-only-test-password',passwordHash=hashPassword(password);
const config={mode:'public' as const,origins:['https://story.example'],passwordHash};
describe('private deployment access',()=>{
  it('fails closed on unsafe LAN/public configuration',()=>{
    expect(()=>accessConfig({APP_ACCESS_MODE:'lan'})).toThrow();
    expect(()=>accessConfig({APP_ACCESS_MODE:'public',APP_PASSWORD_HASH:passwordHash,APP_ORIGINS:'http://story.example',APP_DATA_DIR:'/data'})).toThrow();
    expect(()=>accessConfig({APP_ACCESS_MODE:'public',APP_PASSWORD_HASH:passwordHash,APP_ORIGINS:'https://story.example'})).toThrow();
    expect(accessConfig({APP_ACCESS_MODE:'public',APP_PASSWORD_HASH:passwordHash,APP_ORIGINS:'https://story.example',APP_DATA_DIR:'/data'}).mode).toBe('public');
  });
  it('guest may login but cannot read saves or call models; login rotates the token',()=>{
    const security=new LocalSecurity(config),guest=security.create();
    const req=(token=guest.token,csrf=guest.csrf)=>new Request('https://story.example/api/login',{method:'POST',headers:{host:'story.example',origin:'https://story.example',cookie:'dayao_session='+token,'x-dayao-csrf':csrf}});
    expect(()=>security.check(req())).toThrow('登录');
    expect(()=>security.login(req(),'wrong-password')).toThrow('口令');
    const session=security.login(req(),password);expect(session.token).not.toBe(guest.token);
    expect(security.check(req(session.token,session.csrf)).authenticated).toBe(true);
    expect(security.cookie(session)).toContain('Secure');expect(security.cookie(session)).toContain('HttpOnly');
    expect(()=>security.check(req())).toThrow('会话失效');
    security.logout(req(session.token,session.csrf));expect(()=>security.check(req(session.token,session.csrf))).toThrow();
  });
  it('limits login attempts even with rotated guest sessions and ignores spoofed forwarded IPs',()=>{
    const s=new LocalSecurity(config);
    for(let i=0;i<8;i++){const g=s.create();expect(()=>s.login(new Request('https://story.example/api/login',{method:'POST',headers:{cookie:'dayao_session='+g.token,'x-dayao-csrf':g.csrf,'x-forwarded-for':'192.0.2.'+i}}),'wrong')).toThrow('口令');}
    const g=s.create();try{s.login(new Request('https://story.example/api/login',{method:'POST',headers:{cookie:'dayao_session='+g.token,'x-dayao-csrf':g.csrf}}),password);throw new Error('should reject');}catch(e){expect((e as AccessError).status).toBe(429);}
  });
  it('enforces session cost limits, expiration and exact origin/host',()=>{
    let now=0;const s=new LocalSecurity(config,()=>now),session=s.create(true);
    const req=new Request('https://story.example/api/turns',{method:'POST',headers:{cookie:'dayao_session='+session.token,'x-dayao-csrf':session.csrf}});
    for(let i=0;i<12;i++)s.authorize(req,'turns');expect(()=>s.authorize(req,'turns')).toThrow('频繁');
    now=60001;expect(()=>s.authorize(req,'turns')).not.toThrow();
    expect(()=>s.host(new Request('https://story.example/api/saves',{headers:{origin:'https://evil.example'}}))).toThrow();
    expect(()=>s.host(new Request('https://evil.example/api/saves'))).toThrow();
    now=24*3600000+1;expect(()=>s.check(req)).toThrow('会话');
  });
  it('charges repair attempts against the same model limit as generation and extraction',()=>{
    const s=new LocalSecurity(config),session=s.create(true);
    const req=new Request('https://story.example/api/drafts/id/repair',{method:'POST',headers:{cookie:'dayao_session='+session.token,'x-dayao-csrf':session.csrf}});
    for(let i=0;i<12;i++)s.authorize(req,i%2?'turns':'drafts/id/repair');
    expect(()=>s.authorize(req,'drafts/id/repair')).toThrow('频繁');
  });
});
