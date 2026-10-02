import Database from 'better-sqlite3';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import type {Session,SessionStore} from '../security/sessions';
import {AccessError} from '../security/local';
import {ProviderError} from '../llm/types';
import type {PublicConfig} from './public-config';
type Usage={requests:number;output:number;input:number};
export class PublicControl implements SessionStore{
  readonly db:Database.Database;
  activeCalls=0;
  constructor(public config:PublicConfig,private now=()=>Date.now()){
    mkdirSync(config.dir,{recursive:true,mode:0o700});
    this.db=new Database(path.join(config.dir,'access.sqlite'));
    this.db.pragma('journal_mode = WAL');this.db.pragma('busy_timeout = 5000');
    this.db.exec('CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL,authenticated INTEGER NOT NULL,principal_id TEXT NOT NULL REFERENCES players(id));'+
      'CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS usage(day TEXT NOT NULL,subject TEXT NOT NULL,requests INTEGER NOT NULL,output INTEGER NOT NULL,input INTEGER NOT NULL,PRIMARY KEY(day,subject));');
    this.db.pragma('foreign_keys = ON');
  }
  private hash(token:string){return createHash('sha256').update(token).digest('hex');}
  get(token:string):Session|undefined{
    if(!/^[a-f0-9]{64}$/.test(token))return;
    const row=this.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(this.hash(token)) as {csrf:string;expires:number;authenticated:number;principal_id:string}|undefined;
    return row?{token,csrf:row.csrf,expires:row.expires,authenticated:!!row.authenticated,principalId:row.principal_id}:undefined;
  }
  set(s:Session){this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?,?,?)').run(this.hash(s.token),s.csrf,s.expires,s.authenticated?1:0,s.principalId);}
  delete(token:string){this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(this.hash(token));}
  prune(now:number){this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);}
  limit(key:string,max:number,windowMs:number){
    key=this.hash(key); // Persistent rate keys must not store opaque session credentials.
    const allowed=this.db.transaction(()=>{
      const now=this.now();this.db.prepare('DELETE FROM limits WHERE expires<=?').run(now);
      const row=this.db.prepare('SELECT count FROM limits WHERE key=?').get(key) as {count:number}|undefined;
      if((row?.count||0)>=max)return false;
      this.db.prepare('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+windowMs);
      return true;
    })();
    if(!allowed)throw new AccessError('请求过于频繁，请稍后重试。',429);
  }
  createPlayer(){
    this.limit('new-player',10,60000);
    return this.db.transaction(()=>{
      const count=(this.db.prepare('SELECT count(*) AS n FROM players').get() as {n:number}).n;
      if(count>=this.config.maxPlayers)throw new AccessError('站点目前已达到玩家容量，请联系站长。',429);
      const id=randomUUID();this.db.prepare('INSERT INTO players VALUES(?,?)').run(id,this.now());return id;
    })();
  }
  playerDir(id:string){
    if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)||!this.db.prepare('SELECT 1 FROM players WHERE id=?').get(id))throw new AccessError('玩家身份无效。');
    return path.join(path.resolve(this.config.dir),'players',id);
  }
  private day(){return new Date(this.now()).toISOString().slice(0,10);}
  usage(subject:string):Usage{return this.db.prepare('SELECT requests,output,input FROM usage WHERE day=? AND subject=?').get(this.day(),subject) as Usage||{requests:0,output:0,input:0};}
  reserveAttempt(playerId:string,input:number,output:number){
    this.playerDir(playerId);
    if(input>this.config.maxInputBytes)throw new ProviderError('SITE_INPUT_LIMIT','本次上下文超过站点输入上限，请缩短输入或联系站长。',413);
    const accepted=this.db.transaction(()=>{
      const total=this.usage('*'),personal=this.usage(playerId),c=this.config;
      if(total.requests>=c.dailyRequests||personal.requests>=c.playerDailyRequests||total.output+output>c.dailyOutput||total.input+input>c.dailyInputBytes)return false;
      for(const subject of ['*',playerId])this.db.prepare('INSERT INTO usage VALUES(?,?,1,?,?) ON CONFLICT(day,subject) DO UPDATE SET requests=requests+1,output=output+excluded.output,input=input+excluded.input').run(this.day(),subject,output,input);
      return true;
    })();
    if(!accepted)throw new ProviderError('SITE_DAILY_LIMIT','今日站点或个人模型额度已用完；草稿保留，UTC 次日恢复。',429);
  }
  status(id:string){return {playerMode:'isolated' as const,providerMode:'site' as const,loginRequired:!!process.env.APP_PASSWORD_HASH,
    usedRequests:this.usage(id).requests,playerDailyRequests:this.config.playerDailyRequests,maxOutputTokens:this.config.maxOutput};}
  close(){this.db.close();}
}
