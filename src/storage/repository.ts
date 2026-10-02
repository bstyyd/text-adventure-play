import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {builtInScenario} from '../scenario/package';
import {ScenarioLibrary} from '../scenario/library';
import {attachScenario} from '../scenario/runtime';
import {initialScenarioState} from '../scenario/state';
import {legacyNewGame,migratedSave,migratedTurn} from '../scenario/legacy';
import { NewGameSchema } from '../domain/types';
import type { Annotation, Bookmark, Branch, Draft, Effects, NewGameConfig, OocMessage, Profile, Save, Turn, View } from '../domain/types';
import type { Character, CharacterEvent } from '../characters/schema';
import { seedCharacters } from '../characters/world';

export class ConflictError extends Error {}
export const emptyEffects=():Effects=>({facts:[],knowledge:[],memories:[],summaries:[],suggestedActions:[],diagnostics:[]});
type Row={payload:string};
export class Repository {
  db:Database.Database;
  dir:string;
  scenarios:ScenarioLibrary;
  constructor(dir=process.env.APP_DATA_DIR || path.join(homedir(),'DayaoNovel'),options:{recoverDrafts?:boolean;database?:Database.Database;backup?:(automatic:boolean)=>Promise<string>}={recoverDrafts:true}){
    this.dir=path.resolve(dir);mkdirSync(this.dir,{recursive:true});
    const file=path.join(this.dir,'dayao.sqlite');
    this.db=options.database||new Database(file);
    this.cloudBackup=options.backup;
    this.db.pragma('journal_mode = WAL');this.db.pragma('foreign_keys = ON');this.db.pragma('busy_timeout = 5000');
    const version=this.db.pragma('user_version',{simple:true}) as number;
    if(version>3){this.db.close();throw new Error('数据库来自更新版本，请升级应用；原库未改动。');}
    if(version===0){
      // Migration snapshot includes the WAL through SQLite itself, never a bare file copy.
      if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length){
        const backup=path.join(this.dir,'before-migration-'+Date.now()+'.sqlite');
        this.db.prepare('VACUUM INTO ?').run(backup);
      }
      const sql=readFileSync(path.join(process.cwd(),'migrations','001_initial.sql'),'utf8');
      try{this.db.transaction(()=>this.db.exec(sql))();}catch(error){this.db.close();throw error;}
    }
    if(version<2){
      try{
        if(version===1){
          const backup=path.join(this.dir,'before-characters-v2-'+Date.now()+'-'+crypto.randomUUID().slice(0,8)+'.sqlite');
          this.db.prepare('VACUUM INTO ?').run(backup);
        }
        this.db.transaction(()=>{
          this.db.exec(readFileSync(path.join(process.cwd(),'migrations','002_characters.sql'),'utf8'));
          for(const turn of this.all<Turn>('turns').filter(t=>t.parentTurnId===null))this.insertCharacters(turn,seedCharacters(attachScenario(turn,builtInScenario()),true));
        })();
      }catch(error){this.db.close();throw error;}
    }
    this.scenarios=new ScenarioLibrary(this.db);
    if(version<3){
      if(this.all<Save>('saves').length)this.db.prepare('VACUUM INTO ?').run(path.join(this.dir,'before-scenarios-v3-'+Date.now()+'-'+crypto.randomUUID().slice(0,8)+'.sqlite'));
      this.db.transaction(()=>{
        this.db.exec(readFileSync(path.join(process.cwd(),'migrations','003_scenarios.sql'),'utf8'));this.scenarios.ensureBuiltIn();
        const p=this.scenarios.get(this.scenarios.list()[0].packageId),hash=this.scenarios.snapshot(p);
        for(const raw of this.all<Save>('saves'))this.putSave(migratedSave(raw,p,hash));
        for(const raw of this.all<Turn>('turns')){const t=migratedTurn(raw,p,hash);this.db.prepare('UPDATE turns SET payload=? WHERE id=?').run(JSON.stringify(t),t.id);this.indexStats(t);}
      })();
    }else this.scenarios.ensureBuiltIn();
    // A process restart cannot resume an in-flight network request.
    for(const draft of options.recoverDrafts?this.all<Draft>('drafts'):[]){
      if(['generating','extracting','validating'].includes(draft.status))
        this.putDraft({...draft,status:'failed',bodyComplete:draft.bodyComplete??(draft.status==='extracting'||draft.status==='validating'),failureStage:draft.status==='generating'?'generation':draft.status==='extracting'?'extraction':'validation',error:'服务已重启。草稿已保留；完整正文可重试整理，未完成的正文需重新生成或核对修订。'});
    }
  }
  close(){this.db.close();}
  private cloudBackup?:((automatic:boolean)=>Promise<string>);
  all<T>(table:string):T[]{return (this.db.prepare('SELECT payload FROM '+table).all() as Row[]).map(r=>JSON.parse(r.payload));}
  one<T>(table:string,id:string):T{
    const row=this.db.prepare('SELECT payload FROM '+table+' WHERE id=?').get(id) as Row|undefined;
    if(!row)throw new Error('记录不存在：'+table);
    return JSON.parse(row.payload);
  }
  save(id:string){return this.one<Save>('saves',id);}
  branch(id:string){return this.one<Branch>('branches',id);}
  turn(id:string){
    const turn=this.one<Turn>('turns',id);
    // Legacy immutable payloads are left byte-for-byte intact; hydrate the new source indexes.
    if(!turn.effects.characterEvents){
      turn.effects={...turn.effects,
        characters:(this.db.prepare('SELECT payload FROM characters WHERE turn_id=?').all(id) as Row[]).map(r=>JSON.parse(r.payload)),
        characterEvents:(this.db.prepare('SELECT payload FROM character_events WHERE turn_id=? ORDER BY rowid').all(id) as Row[]).map(r=>JSON.parse(r.payload))};
    }
    turn.playerName=this.scenarios.fromSnapshot(turn.scenarioSnapshotHash||this.save(turn.saveId).scenarioSnapshotHash).player.name;
    return attachScenario(turn,this.scenarios.fromSnapshot(turn.scenarioSnapshotHash||this.save(turn.saveId).scenarioSnapshotHash));
  }
  draft(id:string){return this.one<Draft>('drafts',id);}
  maybeDraft(id:string){const row=this.db.prepare('SELECT payload FROM drafts WHERE id=?').get(id) as Row|undefined;return row?JSON.parse(row.payload) as Draft:undefined;}
  listSaves(){return this.all<Save>('saves').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  putSave(s:Save){this.db.prepare('INSERT INTO saves VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(s.id,JSON.stringify(s));}
  putBranch(b:Branch){this.db.prepare('INSERT INTO branches VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET head_id=excluded.head_id,payload=excluded.payload').run(b.id,b.saveId,b.headTurnId,JSON.stringify(b));}
  putDraft(d:Draft){this.db.prepare('INSERT INTO drafts VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload').run(d.id,d.saveId,d.branchId,d.status,JSON.stringify(d));}
  private indexStats(t:Turn){for(const [id,r] of Object.entries(t.state.relationships))for(const [key,value] of Object.entries(r.values))this.db.prepare('INSERT INTO character_stats VALUES (?,?,?,?)').run(t.id,id,key,value);for(const [key,value] of Object.entries(t.state.worldStats))this.db.prepare('INSERT INTO world_stats VALUES (?,?,?)').run(t.id,key,value);}
  insertTurn(t:Turn){
    t.scenarioSnapshotHash??=t.parentTurnId?this.turn(t.parentTurnId).scenarioSnapshotHash:this.save(t.saveId).scenarioSnapshotHash;t.playerName??=this.scenarios.fromSnapshot(t.scenarioSnapshotHash||this.save(t.saveId).scenarioSnapshotHash).player.name;
    this.db.prepare('INSERT INTO turns VALUES (?,?,?,?,?,?)').run(t.id,t.saveId,t.parentTurnId,t.branchId,t.requestId,JSON.stringify(t));
    this.indexStats(t);
    for(const [table,items] of [['fact_events',t.effects.facts],['npc_knowledge_events',t.effects.knowledge],['memories',t.effects.memories],['summaries',t.effects.summaries]] as const){
      const insert=this.db.prepare('INSERT INTO '+table+' VALUES (?,?,?)');
      for(const item of items)insert.run(item.id,t.id,JSON.stringify(item));
    }
    this.insertCharacters(t,{characters:t.effects.characters||[],characterEvents:t.effects.characterEvents||[]});
  }
  private insertCharacters(turn:Turn,data:{characters:Character[];characterEvents:CharacterEvent[]}){
    for(const c of data.characters)this.db.prepare('INSERT INTO characters VALUES (?,?,?,?)').run(turn.saveId,c.id,turn.id,JSON.stringify(c));
    for(const e of data.characterEvents)this.db.prepare('INSERT INTO character_events VALUES (?,?,?,?,?)').run(e.id,turn.saveId,turn.id,e.characterId,JSON.stringify(e));
  }
  createSave(input:Partial<NewGameConfig>&{day?:number;court?:Record<string,number>}={}){
    const base=this.scenarios.get(input.scenarioPackageId||this.scenarios.list()[0].packageId,input.scenarioVersion);
    const config=NewGameSchema.parse(legacyNewGame(input,base)),p=structuredClone(base);
    if(p.manifest.playerMode==='customizable'){p.player.name=config.playerSetup?.name||p.player.name;p.player.description=config.playerSetup?.description??p.player.description;}
    if(p.manifest.playerMode==='selectable'){const selected=p.playerChoices.find(c=>c.choiceId===config.playerSetup?.choiceId);if(!selected)throw new Error('请先选择主角');const {choiceId:_choiceId,...player}=selected;void _choiceId;p.player=player;}
    if(p.manifest.playerMode==='fixed'&&config.playerSetup)throw new Error('固定主角不能改写人设');
    if(p.manifest.openingMode==='fixed'&&!p.opening.trim())throw new Error('此剧本尚无固定开场，请先编辑');
    const saveId=crypto.randomUUID(),branchId=crypto.randomUUID(),id=crypto.randomUUID(),createdAt=new Date().toISOString();
    const state=initialScenarioState(p,config),effects=emptyEffects();
    for(const f of p.initialFacts){const fact={...f,id:crypto.randomUUID(),sourceTurnId:id,gameDate:state.date,createdAt,version:1,propagation:[]};effects.facts.push(fact);effects.memories.push({id:crypto.randomUUID(),factId:fact.id,sourceTurnId:id,kind:fact.kind,content:fact.content,importance:fact.importance});}state.factIds=effects.facts.map(f=>f.id);
    return this.db.transaction(()=>{
      const hash=this.scenarios.snapshot(p);
      const save:Save={id:saveId,title:config.title,createdAt,currentBranchId:branchId,initialConfig:config,canonVersion:'scenario-schema-1',scenarioPackageId:p.manifest.packageId,scenarioVersion:p.manifest.version,scenarioSnapshotHash:hash,openingStatus:p.manifest.openingMode==='generated_from_seed'?'pending':'ready'};
      const branch:Branch={id:branchId,saveId,name:p.ui.branchName,parentBranchId:null,forkTurnId:null,headTurnId:id};
      const turn:Turn=attachScenario({id,saveId,parentTurnId:null,branchId,playerText:'',body:p.manifest.openingMode==='generated_from_seed'?'':p.opening,createdAt,state,effects,provider:'mock',model:'fixed-prologue',requestId:crypto.randomUUID(),usage:{input:0,output:0},requestCount:0,scenarioSnapshotHash:hash,playerName:p.player.name},p);
      Object.assign(turn.effects,seedCharacters(turn));this.putSave(save);this.putBranch(branch);this.insertTurn(turn);return save;
    })();
  }
  path(head:string,saveId?:string){
    const result:Turn[]=[],seen=new Set<string>();let next:string|null=head;
    while(next){
      if(seen.has(next)||seen.size>100000)throw new Error('节点链循环或过大');
      seen.add(next);const turn=this.turn(next);
      if(saveId&&turn.saveId!==saveId)throw new Error('跨存档节点被拒绝');
      result.push(turn);next=turn.parentTurnId;
    }
    return result.reverse();
  }
  view(saveId:string,branchId?:string):View{
    const save=this.save(saveId),branch=this.branch(branchId||save.currentBranchId);
    if(branch.saveId!==saveId)throw new Error('分支不属于此存档');
    const turns=this.path(branch.headTurnId,saveId),visible=new Set(turns.map(t=>t.id));
    return {save,branch,turns,scenario:this.scenarios.public(turns.at(-1)!.scenarioSnapshotHash||save.scenarioSnapshotHash),branches:this.all<Branch>('branches').filter(b=>b.saveId===saveId),
      drafts:this.all<Draft>('drafts').filter(d=>d.branchId===branch.id&&d.status!=='committed'),
      bookmarks:this.all<Bookmark>('bookmarks').filter(b=>visible.has(b.turnId)),
      annotations:this.all<Annotation>('annotations').filter(a=>a.branchId===branch.id&&visible.has(a.sourceTurnId)),
      ooc:this.all<OocMessage>('ooc_messages').filter(o=>o.branchId===branch.id&&visible.has(o.atTurnId))};
  }
  fork(saveId:string,fromBranchId:string,turnId:string,name='另一种可能'){
    if(!this.scenarios.fromSnapshot(this.turn(turnId).scenarioSnapshotHash||this.save(saveId).scenarioSnapshotHash).manifest.allowBranches)throw new Error('本剧本未开放分支');
    const from=this.branch(fromBranchId);
    if(from.saveId!==saveId||!this.path(from.headTurnId,saveId).some(t=>t.id===turnId))throw new Error('只能从本分支可见节点分叉');
    const branch:Branch={id:crypto.randomUUID(),saveId,name,parentBranchId:fromBranchId,forkTurnId:turnId,headTurnId:turnId};
    this.db.transaction(()=>{this.putBranch(branch);this.putSave({...this.save(saveId),currentBranchId:branch.id});})();
    return branch;
  }
  switchBranch(saveId:string,branchId:string){
    if(this.branch(branchId).saveId!==saveId)throw new Error('存档不匹配');
    this.putSave({...this.save(saveId),currentBranchId:branchId});
  }
  commit(draft:Draft,turn:Turn,failAfterInsert=false){
    return this.db.transaction(()=>{
      const stored=this.draft(draft.id);
      if(stored.status==='committed'&&stored.turnId)return this.turn(stored.turnId);
      if(stored.status==='cancelled')throw new ConflictError('请求已取消');
      const branch=this.branch(draft.branchId);
      if(branch.saveId!==draft.saveId||branch.headTurnId!==draft.expectedHeadTurnId)throw new ConflictError('另一窗口已推进剧情。草稿保留，请从原节点另开分支。');
      this.insertTurn(turn);
      if(failAfterInsert)throw new Error('Simulated transaction failure');
      this.putBranch({...branch,headTurnId:turn.id});
      if(this.save(draft.saveId).openingStatus==='pending')this.putSave({...this.save(draft.saveId),openingStatus:'ready'});
      this.putDraft({...draft,status:'committed',turnId:turn.id,error:null});
      return turn;
    })();
  }
  putScoped(table:'bookmarks'|'annotations'|'ooc_messages',saveId:string,value:Bookmark|Annotation|OocMessage){
    this.db.prepare('INSERT INTO '+table+' VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(value.id,saveId,JSON.stringify(value));
  }
  setting<T>(id:string,fallback:T):T{
    const r=this.db.prepare('SELECT payload FROM settings WHERE id=?').get(id) as Row|undefined;
    return r?JSON.parse(r.payload):fallback;
  }
  setSetting(id:string,value:unknown){this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(value));}
  profiles(){return this.all<Profile>('profiles');}
  putProfile(p:Profile){this.db.prepare('INSERT INTO profiles VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(p.id,JSON.stringify(p));}
  async backup(automatic=false){
    if(this.cloudBackup)return this.cloudBackup(automatic);
    const dir=path.join(this.dir,'backups');mkdirSync(dir,{recursive:true});
    const file=path.join(dir,(automatic?'auto-':'manual-')+Date.now()+'-'+crypto.randomUUID().slice(0,8)+'.sqlite');
    await this.db.backup(file);
    if(automatic){
      const files=readdirSync(dir).filter(f=>f.startsWith('auto-')&&f.endsWith('.sqlite')).sort().reverse();
      for(const old of files.slice(10)){const target=path.resolve(dir,old);if(path.dirname(target)===dir&&existsSync(target))unlinkSync(target);}
    }
    return file;
  }
  async deleteSave(id:string){
    await this.backup();
    this.db.transaction(()=>{
      const ids=(this.db.prepare('SELECT id FROM turns WHERE save_id=?').all(id) as {id:string}[]).map(x=>x.id);
      for(const table of ['character_corrections','character_events','characters'])this.db.prepare('DELETE FROM '+table+' WHERE save_id=?').run(id);
      for(const table of ['character_stats','world_stats','fact_events','npc_knowledge_events','memories','summaries'])for(const tid of ids)this.db.prepare('DELETE FROM '+table+' WHERE turn_id=?').run(tid);
      for(const table of ['bookmarks','annotations','ooc_messages','drafts','branches'])this.db.prepare('DELETE FROM '+table+' WHERE save_id=?').run(id);
      this.db.prepare('DELETE FROM turns WHERE save_id=?').run(id);this.db.prepare('DELETE FROM saves WHERE id=?').run(id);
    })();
  }
}
