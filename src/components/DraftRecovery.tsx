'use client';
/* Hallmark · pre-emit critique: P4 H5 E4 S4 R5 V4
 * component: chat recovery · genre: editorial · theme: existing paper
 * states: default · hover · focus · active · disabled · loading · error · success
 */
import { useState } from 'react';
import type { Draft, Profile } from '../domain/types';
import { storyBodyIssues } from '../domain/story-body';
import { BodyIssues } from './BodyIssues';

export function DraftRecovery({draft,profiles,currentId,narrator,retry,repair,saveLocal,review,edit,hide}:{
  draft:Draft;profiles:Profile[];currentId:string;narrator:Profile;
  retry:(options:{extractOnly:boolean;extractProfileId?:string;timeoutMs?:number})=>Promise<void>;
  repair:()=>Promise<void>;
  saveLocal:()=>Promise<void>;
  review:()=>void;edit:()=>void;hide:()=>void;
}){
  const [choice,setChoice]=useState(''),[seconds,setSeconds]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const issues=storyBodyIssues(draft.playerText,draft.body);
  const storageFailure=/浏览器保存未完成|浏览器存储空间不足/.test(draft.error||'');
  const current=profiles.find(p=>p.id===currentId);
  const same=profiles.find(p=>p.id===draft.extractProfile.id&&p.provider===draft.extractProfile.provider&&p.model===draft.extractProfile.model);
  const chosen=(choice?profiles.find(p=>p.id===choice):same)||draft.extractProfile;
  const changed=!!current&&(current.provider!==draft.extractProfile.provider||current.model!==draft.extractProfile.model||current.id!==draft.extractProfile.id);
  async function start(extractOnly:boolean){
    setError('');const timeoutMs=(seconds===''?chosen.timeoutMs/1000:Number(seconds))*1000;
    if(!Number.isInteger(timeoutMs)||timeoutMs<5000||timeoutMs>300000){setError('等待时间请填写 5–300 秒。');return;}
    setPending(true);try{await retry({extractOnly,...(choice?{extractProfileId:choice}:{}),timeoutMs});}catch(e){setError((e as Error).message);}finally{setPending(false);}
  }
  async function localSave(){
    setPending(true);setError('');try{await saveLocal();}catch(e){setError((e as Error).message);}finally{setPending(false);}
  }
  return <div className="draft-recovery" aria-busy={pending} data-state={pending?'loading':error?'error':'default'}>
    {storageFailure&&<p className="recovery-storage" role="alert">浏览器保存未完成，旧正式剧情仍保留。请先导出存档并复制这段正文，再释放空间后重新打开。</p>}
    <div className="recovery-primary">
      {draft.localSaveRevision?<button className="outline" disabled={pending||storageFailure} title="重新校验后保存，不调用模型" onClick={()=>void localSave()}>保存这段剧情</button>:
        draft.body&&draft.bodyComplete===true?<button className="outline" disabled={pending||storageFailure} title="保留正文，重新整理记忆并保存；将调用所选模型" onClick={()=>void start(true)}>重试整理并自动保存</button>:
          <button className="outline" disabled={pending||storageFailure} onClick={()=>void start(false)}>重写草稿</button>}
      {pending&&<span role="status">处理中…</span>}
    </div>
    {error&&<div role="alert" className="error-text">保存未完成，正文仍已保留。<details><summary>查看原因</summary>{error}</details></div>}
    <details className="recovery-more"><summary>更多处理</summary><div className="recovery-content">
    {draft.error&&<p className="error-text">{draft.error}</p>}
    <p className="muted">{draft.bodyComplete===true?'正文已完整接收':'正文尚未确认完整，请核对后再保存'} · {[...draft.body].length} 字符 · 请求 {draft.requestCount} 次</p>
    {draft.localSaveRevision&&<p className="muted">“保存这段剧情”会重新校验已有正文和记忆，通过后写入存档；不调用模型。校验失败时仍保留草稿。</p>}
    <BodyIssues issues={issues}/>
    {issues.length>0&&draft.bodyComplete===true&&<details className="repair-entry"><summary>可选：让模型修正文</summary><p>自动修正将使用当前正文模型 {narrator.label} / {narrator.model}，保留原稿，修正一次后继续整理记忆与保存。{narrator.provider==='mock'?'这是本地 Mock 演练。':'将发送本段原文及当前分支上下文，可能计费。'}</p><button className="outline" disabled={pending} onClick={async()=>{setPending(true);setError('');try{await repair();}catch(e){setError((e as Error).message);}finally{setPending(false);}}}>自动修正并保存</button></details>}
    {draft.bodyRepair&&<details><summary>查看修正前原稿</summary><div className="prose">{draft.bodyRepair.originalBody}</div></details>}
    {draft.bodyRepair?.phase==='failed'&&draft.bodyRepair.candidateBody&&draft.bodyRepair.candidateBody!==draft.body&&<details><summary>查看未采用的修正稿</summary><div className="prose">{draft.bodyRepair.candidateBody}</div></details>}
    <p className="muted">上次记忆整理：{draft.extractProfile.provider} / {draft.extractProfile.model} · 等待上限 {draft.extractProfile.timeoutMs/1000} 秒</p>
    {changed&&<p className="recovery-note">当前设置已改为 {current.label} / {current.model}。这份草稿仍保留上次配置，可在下方切换。</p>}
    <details><summary>调整重试模型与等待时间</summary><div className="recovery-settings">
      <label>此次记忆整理模型<select aria-label="此次记忆整理模型" value={choice} onChange={e=>{setChoice(e.target.value);setSeconds('');}} disabled={pending}>
        <option value="">沿用草稿模型 · {draft.extractProfile.model}</option>
        {profiles.map(p=><option key={p.id} value={p.id}>{p.id===currentId?'当前设置 · ':''}{p.label} / {p.model}</option>)}
      </select></label>
      <label>此次整理等待 / 秒<input aria-label="此次整理等待 / 秒" type="number" min="5" max="300" value={seconds||chosen.timeoutMs/1000} onChange={e=>setSeconds(e.target.value)} disabled={pending}/></label>
    </div></details>
    <p className="muted">{'点击重试会'+(chosen.provider==='mock'?'使用离线 Mock 演练':'将正文发送到 '+chosen.label+'（'+chosen.provider+'），可能计费')+'。只重试整理会保留正文，参考提示不阻止保存。'}</p>
    <div className="button-row">
      {draft.localSaveRevision&&<button className="outline" disabled={pending||!draft.body||draft.bodyComplete!==true} onClick={()=>void start(true)}>重试整理并自动保存</button>}
      {draft.body&&draft.bodyComplete===true&&<button disabled={pending} onClick={()=>void start(false)}>重写草稿</button>}
      <button disabled={pending} onClick={edit}>核对／修订正文</button>
      <button disabled={pending} onClick={hide}>收起草稿</button>
    </div>
    <p className="muted">“重写草稿”会另行调用原正文模型 {draft.profile.model}，替换这份未提交正文。</p>
    {draft.mode==='story'&&draft.body&&<details className="local-review-entry"><summary>手动整理记忆（高级补救）</summary><p>通常由模型自动整理并保存。整理服务不可用时，也可自行填写正文、在场人物和记忆，一次提交保存。</p><button className="outline" disabled={pending} onClick={review}>本地审阅并保存</button></details>}
    </div></details>
  </div>;
}
