import { describe,it,expect } from 'vitest';
import { LocalSecurity,SecretVault } from '../../src/security/local';
import { DEFAULT_PROFILES,capabilities } from '../../src/llm/config';
describe('H01 H02 H09 F05',()=>{
  it('host/origin/session/CSRF protect localhost writes',()=>{
    const security=new LocalSecurity(),session=security.create();
    const req=(extra:Record<string,string>={})=>new Request('http://127.0.0.1:3000/api/saves',{method:'POST',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000',cookie:'dayao_session='+session.token,'x-dayao-csrf':session.csrf,...extra}});
    expect(()=>security.check(req())).not.toThrow();
    for(const headers of [{origin:'https://evil.example'},{host:'evil.example'},{'x-dayao-csrf':'wrong'},{cookie:''},{'sec-fetch-site':'cross-site'}] as Record<string,string>[])expect(()=>security.check(req(headers))).toThrow();
  });
  it('keys live in vault only and per-profile credentials are independent',()=>{const vault=new SecretVault(),p=DEFAULT_PROFILES[1];vault.set(p,'local-secret');expect(vault.get(p)).toBe('local-secret');expect(JSON.stringify(p)).not.toContain('local-secret');expect(vault.get({...p,id:'other'})).not.toBe('local-secret');});
  it('Google Gemma schema and streaming remain unknown; unknown models conservative',()=>{expect(capabilities(DEFAULT_PROFILES[3])).toMatchObject({jsonSchema:'unknown',streaming:'unknown',systemInstruction:'supported'});expect(capabilities({...DEFAULT_PROFILES[2],model:'future-model'}).jsonObject).toBe('unknown');});
});
