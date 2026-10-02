'use client';
import {useEffect,useState} from 'react';
import type {PublicScenario,ScenarioSummary} from '../scenario/schema';
import type {Save} from '../domain/types';
type Api=<T>(path:string,data?:unknown)=>Promise<T>;
export function NewScenarioGame({scenarios,api,onStarted,initialPackageId,initialVersion}:{scenarios:ScenarioSummary[];api:Api;onStarted:(save:Save)=>Promise<void>;initialPackageId?:string;initialVersion?:string}){
  const initial=scenarios.find(s=>s.packageId===initialPackageId&&(!initialVersion||s.version===initialVersion))||scenarios[0];
  const [choice,setChoice]=useState(initial?initial.packageId+':'+initial.version:''),[config,setConfig]=useState<PublicScenario|null>(null),[title,setTitle]=useState(initial?.title+' · 新篇'),[name,setName]=useState(''),[description,setDescription]=useState(''),[selectedPlayer,setSelectedPlayer]=useState(''),[world,setWorld]=useState<Record<string,number>>({}),[date,setDate]=useState({year:1,month:1,day:1,minuteOfDay:0}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const selected=scenarios.find(s=>s.packageId+':'+s.version===choice),packageId=selected?.packageId,version=selected?.version;
  useEffect(()=>{let live=true;setConfig(null);if(!packageId)return;api<PublicScenario>('scenarios/'+packageId+'/play?version='+version).then(p=>{if(!live)return;setConfig(p);setName(p.player.name);setDescription(p.player.description);setSelectedPlayer('');setWorld(Object.fromEntries(p.rules.worldStats.map(s=>[s.key,s.initial])));setDate(p.calendar.start);setError('');}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[api,packageId,version]);
  return <form onSubmit={async e=>{e.preventDefault();if(!config||busy)return;setBusy(true);setError('');try{const playerSetup=config.manifest.playerMode==='customizable'?{name,description}:config.manifest.playerMode==='selectable'?{choiceId:selectedPlayer}:undefined;const save=await api<Save>('saves',{title,scenarioPackageId:config.manifest.packageId,scenarioVersion:config.manifest.version,worldStats:world,startDate:date,...(playerSetup?{playerSetup}:{})});await onStarted(save);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
    <label>选择剧本<select aria-label="选择剧本" value={choice} onChange={e=>{setChoice(e.target.value);const item=scenarios.find(s=>s.packageId+':'+s.version===e.target.value);setTitle(item?.title+' · 新篇');}}>{scenarios.map(s=><option key={s.packageId+':'+s.version} value={s.packageId+':'+s.version}>{s.title} · {s.version}</option>)}</select></label>
    <label>卷册名<input aria-label="卷册名" required maxLength={80} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    {config&&<><p>{config.manifest.description} · 玩家：{config.player.name}</p>
      {config.manifest.playerMode==='customizable'&&<><label>玩家姓名<input required value={name} onChange={e=>setName(e.target.value)}/></label><label>玩家人设<textarea value={description} onChange={e=>setDescription(e.target.value)}/></label></>}
      {config.manifest.playerMode==='selectable'&&<label>主角选项 ID<select required aria-label="选择主角" value={selectedPlayer} onChange={e=>setSelectedPlayer(e.target.value)}><option value="">请选择</option>{config.playerChoices.map(p=><option key={p.choiceId} value={p.choiceId}>{p.name}</option>)}</select></label>}
      <details className="new-defaults"><summary>新档高级设置 · 明确的产品默认值</summary><p>这个存档绑定所选版本快照。编辑剧本不会自动改变已有存档。当前数值和日历来自剧本定义。</p>
        {config.manifest.timeSystem&&<div className="recovery-settings">{(['year','month','day','minuteOfDay'] as const).map(key=><label key={key}>{({year:'开局年份',month:'开局月份',day:'开局日期',minuteOfDay:'当日分钟'})[key]}<input type="number" min={key==='minuteOfDay'?0:1} max={key==='minuteOfDay'?1439:undefined} value={date[key]} onChange={e=>setDate({...date,[key]:+e.target.value})}/></label>)}</div>}
        {config.rules.worldStats.map(s=><label key={s.key}>{s.displayName}<input aria-label={'初始 '+s.displayName} type="number" min={s.min} max={s.max} value={world[s.key]??s.initial} onChange={e=>setWorld({...world,[s.key]:+e.target.value})}/></label>)}
      </details>
      {config.manifest.openingMode==='generated_from_seed'&&<p>新档先保存开局条件。进入故事后点击“生成第一幕”才调用选定模型。</p>}
    </>}
    {error&&<p role="alert" className="error-text">{error}</p>}<button type="submit" className="primary" disabled={!config||busy||!title.trim()}>{busy?'正在创建…':'开始新故事'}</button>
  </form>;
}
