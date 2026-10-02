'use client';
import { useEffect, useState } from 'react';
import type { Draft } from '../domain/types';

export function DraftProgress({draft}:{draft:Draft}){
  const active=['generating','extracting','validating'].includes(draft.status);
  const [now,setNow]=useState(0);
  useEffect(()=>{
    if(!active)return;
    setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[active,draft.status]);
  const seconds=Math.max(0,Math.floor((now-Date.parse(draft.stageStartedAt||draft.createdAt))/1000));
  const complete=draft.bodyComplete===true;
  const repairing=draft.status==='generating'&&draft.bodyRepair?.phase==='generating';
  const label=repairing?'正在修正文，原稿已保留':complete?(draft.bodyFinishReason==='author'?'已收到你提交的正文 · 尚需校验':'正文已完整接收 · 模型已返回结束标志'):
    draft.bodyComplete===undefined?'旧草稿未记录结束状态，请核对全文':
      active?'尚未收到完整正文的结束标志':'正文未完成 · 当前内容仅是片段';
  const phase=repairing?'正文修正':draft.status==='generating'?'正文生成':draft.status==='extracting'?'记忆整理':'校验';
  const profile=draft.status==='extracting'?draft.extractProfile:draft.profile;
  return <div className="draft-progress" aria-live="polite">
    <p>{label} · 已收到 {[...draft.body].length} 字符</p>
    {active&&<p>{phase}已等待 {seconds} 秒{draft.status!=='validating'?' · 单次请求上限 '+Math.round(profile.timeoutMs/1000)+' 秒':''}。完成后自动保存为正式剧情，无需逐节确认；保存后仍可修改。</p>}
    {!active&&!complete&&<p>可重新生成，或打开“核对／修订正文”，确认完整后再整理记忆。</p>}
  </div>;
}
