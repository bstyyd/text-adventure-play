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
  const phase=repairing?'正文修正':draft.status==='generating'?'正文生成':draft.status==='extracting'?'记忆整理':'校验';
  const profile=draft.status==='extracting'?draft.extractProfile:draft.profile;
  if(!active)return null;
  return <div className="draft-progress">
    <p role="timer" aria-live="off">已等待 {seconds} 秒 · 完成后自动保存</p>
    <details><summary>生成详情</summary><p>{phase} · {profile.provider} / {profile.model}</p><p>已收到 {[...draft.body].length} 字符 · 请求 {draft.requestCount} 次 · 等待上限 {Math.round(profile.timeoutMs/1000)} 秒 · {complete?'正文已完整接收':'正文接收中'}</p></details>
  </div>;
}
