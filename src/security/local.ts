import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Profile } from '../domain/types';
import type { AuthProvider, Principal, SecretProvider } from '../platform/contracts';
import {MemorySessions,type SessionStore} from './sessions';
const envKeys={mock:'',siliconflow:'SILICONFLOW_API_KEY',deepseek:'DEEPSEEK_API_KEY','google-gemma':'GOOGLE_API_KEY'};
export class SecretVault implements SecretProvider{
  private keys=new Map<string,string>();
  set(profile:Profile,key:string){if(key)this.keys.set(profile.id,key);}
  get(profile:Profile){return this.keys.get(profile.id)||(profile.provider==='google-gemma'?process.env.GOOGLE_AI_API_KEY||process.env.GOOGLE_API_KEY:process.env[envKeys[profile.provider]])||'';}
  has(profile:Profile){return !!this.get(profile);}
  clear(id:string){this.keys.delete(id);}
  async resolve(profile:Profile){return this.get(profile);}
  async configured(profile:Profile){return this.has(profile);}
}
export type AccessConfig={mode:'local'|'lan'|'public';origins:string[];passwordHash:string;isolated?:boolean};
export function accessConfig(env:Record<string,string|undefined>=process.env):AccessConfig{
  const mode=env.APP_ACCESS_MODE||'local';
  if(!['local','lan','public'].includes(mode))throw new Error('APP_ACCESS_MODE 必须是 local、lan 或 public');
  const origins=(env.APP_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
  for(const origin of origins){const url=new URL(origin);if(url.origin!==origin||!['http:','https:'].includes(url.protocol))throw new Error('APP_ORIGINS 必须为完整来源，不能包含路径');}
  const passwordHash=env.APP_PASSWORD_HASH||'';
  const isolated=env.APP_PLAYER_MODE==='isolated';
  if(env.APP_PLAYER_MODE&&!['shared','isolated'].includes(env.APP_PLAYER_MODE))throw new Error('APP_PLAYER_MODE 必须为 shared 或 isolated');
  if(mode!=='local'){
    if(!origins.length||(!isolated||passwordHash)&&!/^scrypt:v1:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash))throw new Error('局域网／公网模式须配置 APP_ORIGINS 和有效 APP_PASSWORD_HASH；隔离访客模式可不设口令');
    if(isolated&&!env.APP_DATA_DIR)throw new Error('隔离访客模式须明确 APP_DATA_DIR');
    if(mode==='public'&&(!env.APP_DATA_DIR||origins.some(o=>!o.startsWith('https://'))))throw new Error('公网模式须使用 HTTPS 来源与持久 APP_DATA_DIR');
  }
  return {mode:mode as AccessConfig['mode'],origins,passwordHash,isolated};
}
export class AccessError extends Error{constructor(message:string,public status=401){super(message);}}
export function hashPassword(password:string,salt=randomBytes(16).toString('hex')){
  if(password.length<12||password.length>256)throw new Error('登录口令需要 12–256 个字符');
  return 'scrypt:v1:'+salt+':'+scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');
}
export class LocalSecurity implements AuthProvider{
  private sessions:SessionStore;
  private buckets=new Map<string,{count:number;until:number}>();
  constructor(public config=accessConfig(),private now=()=>Date.now(),private options:{sessions?:SessionStore;principal?:()=>string;limit?:(key:string,max:number,windowMs:number)=>void}={}){this.sessions=options.sessions||new MemorySessions();}
  get loginRequired(){return this.config.mode!=='local'&&(!this.config.isolated||!!this.config.passwordHash);}
  host(request:Request){
    const host=request.headers.get('host')||new URL(request.url).host;
    const allowed=this.config.mode==='local'?/^(127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(host):this.config.origins.some(o=>new URL(o).host===host);
    if(!allowed)throw new AccessError('不允许的 Host',403);
    const origin=request.headers.get('origin');
    if(origin&&(this.config.mode==='local'?!['http://'+host,'https://'+host].includes(origin):!this.config.origins.includes(origin)||new URL(origin).host!==host))throw new AccessError('跨站请求被拒绝',403);
    if(request.headers.get('sec-fetch-site')==='cross-site')throw new AccessError('跨站请求被拒绝',403);
  }
  limit(key:string,max:number,windowMs:number){
    if(this.options.limit){this.options.limit(key,max,windowMs);return;}
    const now=this.now();for(const [id,b] of this.buckets)if(b.until<=now)this.buckets.delete(id);
    let b=this.buckets.get(key);if(!b){b={count:0,until:now+windowMs};this.buckets.set(key,b);}
    if(++b.count>max)throw new AccessError('请求过于频繁，请稍后重试。',429);
  }
  create(authenticated=!this.loginRequired,principalId?:string){
    const now=this.now();this.sessions.prune(now);
    const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
    const session={token,csrf,authenticated,expires:now+(this.config.isolated?180:1)*24*60*60*1000,principalId:principalId||this.options.principal?.()||'single-player'};this.sessions.set(session);return session;
  }
  current(request:Request){
    const token=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('dayao_session='))?.slice(14);
    const session=token?this.sessions.get(token):undefined;
    return session&&session.expires>this.now()?session:undefined;
  }
  session(request:Request){this.host(request);this.limit('session',120,60000);return this.current(request)||this.create();}
  cookie(session:import('./sessions').Session){return 'dayao_session='+session.token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+(this.config.isolated?15552000:86400)+(this.config.mode==='public'?'; Secure':'');}
  check(request:Request,requireLogin=true){
    this.host(request);const session=this.current(request);
    if(!session)throw new AccessError('会话失效，请重新打开书库。');
    if(!['GET','HEAD'].includes(request.method)){
      const csrf=request.headers.get('x-dayao-csrf')||'';
      if(Buffer.byteLength(csrf)!==Buffer.byteLength(session.csrf)||!timingSafeEqual(Buffer.from(csrf),Buffer.from(session.csrf)))throw new AccessError('CSRF 校验失败',403);
    }
    if(requireLogin&&!session.authenticated)throw new AccessError('请先登录个人书库。');
    return session;
  }
  login(request:Request,password:string){
    const old=this.check(request,false);
    // Global limiting bounds rotating sessions, without trusting forwarded IP headers.
    this.limit('login',8,15*60000);
    const match=/^scrypt:v1:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(this.config.passwordHash);
    const valid=match&&password.length<=256&&timingSafeEqual(scryptSync(password,Buffer.from(match[1],'hex'),64),Buffer.from(match[2],'hex'));
    if(!valid)throw new AccessError('登录口令不正确。');
    this.sessions.delete(old.token);return this.create(true,old.principalId);
  }
  logout(request:Request){this.sessions.delete(this.check(request).token);}
  authorize(request:Request,route:string){
    const session=this.check(request);if(this.config.mode==='local')return;
    this.limit('api:'+session.token,300,60000);
    if(request.method==='POST')this.limit('write:'+session.token,80,60000);
    if(request.method==='POST'&&/^(turns|suggestions|scenarios\/assist|providers\/|drafts\/.*\/(?:retry|repair))/.test(route))this.limit('model',12,60000);
    if(route.endsWith('/offline'))this.limit('download:'+session.token,4,60000);
  }
  async requirePrincipal(request:Request,route:string):Promise<Principal>{
    this.authorize(request,route);
    return {id:this.check(request).principalId,kind:'player'};
  }
}
