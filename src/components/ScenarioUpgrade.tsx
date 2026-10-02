'use client';
import {useState} from 'react';
import type {ScenarioSummary} from '../scenario/schema';
import type {View} from '../domain/types';
import {requestId} from '../client/storage';
type Comparison={sections:string[];safe:boolean;before:ScenarioSummary;after:ScenarioSummary;note:string};
export function ScenarioUpgrade({view,scenarios,api,onChanged,disabled}:{view:View;scenarios:ScenarioSummary[];api:<T>(path:string,data?:unknown)=>Promise<T>;onChanged:()=>Promise<void>;disabled:boolean}){
 const [version,setVersion]=useState(''),[comparison,setComparison]=useState<Comparison|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const candidates=scenarios.filter(s=>s.packageId===view.save.scenarioPackageId&&s.version!==view.scenario.manifest.version);
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <details className="scenario-upgrade"><summary>升级此存档的剧本版本</summary><p>当前分支使用 {view.scenario.manifest.title} {view.scenario.manifest.version}。升级会保存一个配置节点；旧正文与旧节点的快照保留。</p>{!candidates.length?<p className="muted">没有其他已安装版本。请在剧本库编辑并安装新版本后查看。</p>:<><label>目标版本<select aria-label="存档目标剧本版本" value={version} onChange={e=>{setVersion(e.target.value);setComparison(null);}}><option value="">请选择</option>{candidates.map(s=><option key={s.version} value={s.version}>{s.version} · {s.title}</option>)}</select></label><button disabled={disabled||busy||!version} onClick={()=>void run(async()=>setComparison(await api<Comparison>('scenarios/compare',{saveId:view.save.id,branchId:view.branch.id,packageId:view.save.scenarioPackageId,version})))}>预览版本变更</button>{comparison&&<div><p>变更：{comparison.sections.join('、')||'无内容变更'}</p><p>{comparison.note}</p><button className="primary" disabled={!comparison.safe||disabled||busy} onClick={()=>void run(async()=>{await api('scenarios/upgrade',{saveId:view.save.id,branchId:view.branch.id,expectedHeadTurnId:view.branch.headTurnId,clientRequestId:requestId(),packageId:view.save.scenarioPackageId,version,confirmed:true});await onChanged();setComparison(null);})}>确认升级此分支</button></div>}</>}{error&&<p role="alert" className="error-text">{error}</p>}</details>;
}
